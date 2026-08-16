(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const intakeStates = new Set(["NEW", "NEEDS_INPUT"]);
  const runningStates = new Set(["QUEUED", "RUNNING"]);
  const activeStates = new Set(["QUEUED", "RUNNING", "PAUSED"]);
  const compatibleFeedbackActions = new Set(["direction_feedback", "local_feedback", "fact_feedback"]);
  const eventsCompatibilityRoute = "/events?after=";
  const defaultKimiBaseUrl = ["https:", "", "api.kimi.com", "coding", "v1"].join("/");
  void compatibleFeedbackActions;
  void eventsCompatibilityRoute;
  const state = {
    csrf: "",
    project: null,
    projects: [],
    health: null,
    candidateId: null,
    selected: null,
    poll: null,
    activityCursor: 0,
    activities: [],
    usedPreviewTokens: new Set(),
    selectedProjectId: null,
  };

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);

  const uid = (prefix) => `${prefix}:${Date.now()}:${crypto.randomUUID()}`;

  function notice(message) {
    const node = $("#notice");
    node.textContent = message;
    node.classList.add("visible");
    clearTimeout(node.timer);
    node.timer = setTimeout(() => node.classList.remove("visible"), 4500);
  }

  function setMarkup(node, markup) {
    if (node.innerHTML !== markup) node.innerHTML = markup;
  }

  async function request(url, options = {}, retryingSession = false) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    if (options.method && options.method !== "GET") {
      headers["X-OEY-CSRF"] = state.csrf;
    }
    const response = await fetch(url, { ...options, headers });
    const type = response.headers.get("content-type") || "";
    const body = type.includes("json")
      ? await response.json().catch(() => ({}))
      : await response.text();
    if (!response.ok) {
      if (
        !retryingSession &&
        options.method &&
        options.method !== "GET" &&
        response.status === 403 &&
        (body.category === "POLICY_BLOCKED" || body.message)
      ) {
        await loadSession();
        return request(url, options, true);
      }
      const error = new Error(
        body.message || body.category || `Request failed (${response.status})`,
      );
      error.body = body;
      throw error;
    }
    return body;
  }

  async function loadSession() {
    const session = await request("/api/session", {}, true);
    state.csrf = session.csrf_token;
  }

  async function boot() {
    await loadSession();
    bind();
    await Promise.all([loadHealth(), loadProjects()]);
  }

  async function loadHealth() {
    state.health = await request("/api/health");
    renderHealth();
  }

  async function loadProjects(preferred) {
    state.projects = await request("/api/projects");
    const select = $("#projectSelect");
    select.replaceChildren(
      ...state.projects.map((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.name} · r${item.revision}`;
        return option;
      }),
    );
    const selected =
      state.projects.find((item) => item.id === preferred) ||
      state.projects[state.projects.length - 1];
    if (selected) {
      state.selectedProjectId = selected.id;
      select.value = selected.id;
      await loadProject(selected.id, { resetActivity: true });
    } else {
      state.selectedProjectId = null;
      state.project = null;
      resetActivity();
      render();
    }
  }

  async function loadProject(id, options = {}) {
    const wasDifferent = state.project?.id !== id;
    const loaded = await request(`/api/projects/${encodeURIComponent(id)}`);
    if (state.selectedProjectId && id !== state.selectedProjectId) return;
    state.project = loaded;
    if (wasDifferent || options.resetActivity) {
      resetActivity();
      state.usedPreviewTokens.clear();
      state.selected = null;
    }
    if (
      options.preserveCandidate === false ||
      !state.project.candidates?.some((candidate) => candidate.id === state.candidateId)
    ) {
      state.candidateId = state.project.candidates?.[0]?.id || null;
    }
    await loadActivity();
    render();
    schedulePoll();
  }

  function resetActivity() {
    state.activityCursor = 0;
    state.activities = [];
  }

  async function loadActivity() {
    if (!state.project) return;
    const events = await request(
      `/api/projects/${encodeURIComponent(state.project.id)}/activity?after=${state.activityCursor}`,
    );
    if (!events.length) return;
    state.activities.push(...events);
    state.activities = state.activities.slice(-120);
    state.activityCursor = Math.max(...events.map((item) => item.sequence));
  }

  function activeCandidate() {
    return (
      state.project?.candidates?.find((candidate) => candidate.id === state.candidateId) ||
      state.project?.candidates?.[0] ||
      null
    );
  }

  function activeRun() {
    return state.project?.runs?.find((run) => activeStates.has(run.status)) || null;
  }

  function latestRun() {
    const runs = state.project?.runs || [];
    return runs[runs.length - 1] || null;
  }

  function focusTarget() {
    return state.project?.focus?.kind === "artifact" ? state.project.focus : activeCandidate();
  }

  function previewToken(focus) {
    if (!focus) return "";
    if (focus.preview_token) return focus.preview_token;
    try {
      const url = new URL(focus.preview_url || "", window.location.href);
      const queryToken = url.searchParams.get("token");
      if (queryToken) return queryToken;
      const parts = url.pathname.split("/").filter(Boolean);
      const previewIndex = parts.lastIndexOf("preview");
      return previewIndex >= 0 && parts.length > previewIndex + 1
        ? decodeURIComponent(parts[previewIndex + 1])
        : "";
    } catch (_error) {
      return "";
    }
  }

  function render() {
    const project = state.project;
    $("#projectState").textContent = project?.state || "NO PROJECT";
    $("#projectRevision").textContent = project?.revision || "-";
    renderMessages();
    renderCandidates();
    renderPreview();
    renderSources();
    renderQuality();
    renderRuns();
    renderActivity();
    renderHistory();
    renderDeliveries();
    renderActions();
  }

  function renderHealth() {
    if (!state.health) return;
    const ready = Boolean(state.health.product_ready);
    $("#readinessLabel").textContent = ready ? "READY" : "BLOCKED";
    $("#readinessLabel").title = (state.health.blockers || []).join("\n");
    const badge = $("#readinessPanel").querySelector(".status-pill");
    badge.textContent = ready ? "READY" : "BLOCKED";
    badge.className = `status-pill ${ready ? "pass" : "block"}`;
    $("#readinessBlockers").innerHTML = ready
      ? "<p>All production capabilities are available.</p>"
      : (state.health.blockers || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("");
  }

  function renderMessages() {
    const messages = state.project?.messages || [];
    $("#messages").innerHTML = messages.length
      ? messages.map((message) => `
        <article class="message ${message.role === "ASSISTANT" ? "assistant" : "user"}">
          <header><b>${message.role === "ASSISTANT" ? "OEY AGENT" : "YOU"}</b><time>${escapeHtml((message.created_at || "").slice(11, 16))}</time></header>
          <p>${escapeHtml(message.text)}</p>
        </article>`).join("")
      : `<div class="empty-message"><b>NO BRIEF YET</b><p>Create a project, attach a repository or visual references, then describe what you want to make.</p></div>`;
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }

  function renderCandidates() {
    const candidates = state.project?.candidates || [];
    setMarkup($("#candidateTabs"), candidates.map((candidate, index) => `
      <button type="button" data-candidate="${escapeHtml(candidate.id)}" aria-current="${candidate.id === activeCandidate()?.id}">
        0${index + 1} / ${escapeHtml(candidate.title)}
        <small>revision ${candidate.revision}</small>
      </button>`).join(""));
  }

  function renderPreview() {
    const run = activeRun();
    const focus = focusTarget();
    const frame = $("#previewFrame");
    const empty = $("#previewEmpty");
    const loading = $("#previewLoading");
    loading.hidden = !run || !runningStates.has(run.status);
    if (focus?.preview_url) {
      focus.preview_token = previewToken(focus);
      const url = new URL(focus.preview_url, window.location.href).href;
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      frame.hidden = false;
      empty.hidden = true;
      if (frame.src !== url) frame.src = url;
      $("#proofCaption").textContent = `${focus.title || "Artifact"} · trusted preview · click an object to target it`;
      return;
    }
    if (focus?.html || focus?.preview_html) {
      frame.setAttribute("sandbox", "");
      frame.hidden = false;
      empty.hidden = true;
      frame.removeAttribute("src");
      frame.srcdoc = focus.html || focus.preview_html;
      $("#proofCaption").textContent = `${focus.title || "Preview"} · legacy preview`;
      return;
    }
    frame.hidden = true;
    frame.removeAttribute("src");
    frame.srcdoc = "";
    empty.hidden = false;
    $("#proofCaption").textContent = "No trusted render yet - keep talking to the Agent.";
  }

  function renderSources() {
    const sources = state.project?.sources || [];
    $("#sources").innerHTML = sources.length
      ? sources.map((source) => `
        <article class="source-item">
          <span class="rights">${escapeHtml(source.rights)}</span>
          <b>${escapeHtml(source.name)}</b>
          <small>${escapeHtml(source.kind)} · ${Math.round(source.byte_size / 1024)} KB</small>
        </article>`).join("")
      : "<p>No sources attached.</p>";
  }

  function renderQuality() {
    const quality = state.project?.quality || {};
    const visual = state.project?.focus?.visual_review || activeCandidate()?.visual_review;
    const scores = visual?.scores || {};
    const verdict = visual?.passes && !quality.hard_errors?.length
      ? "PASS"
      : quality.verdict || "UNASSESSED";
    $("#qualityVerdict").textContent = verdict;
    $("#qualityVerdict").className = `status-pill ${verdict === "PASS" ? "pass" : verdict === "BLOCK" ? "block" : ""}`;
    const scoreMarkup = Object.entries(scores).map(
      ([name, value]) => `<div class="score"><b>${escapeHtml(value)}/5</b><span>${escapeHtml(name.replace("_", " "))}</span></div>`,
    ).join("");
    const findings = (quality.hard_errors || []).map(
      (finding) => `<p class="finding">${escapeHtml(finding.message || finding)}</p>`,
    ).join("");
    $("#quality").innerHTML = scoreMarkup + findings || "<p>Not assessed yet.</p>";
  }

  function renderRuns() {
    const runs = state.project?.runs || [];
    $("#runCount").textContent = runs.length;
    setMarkup($("#runs"), runs.length
      ? runs.slice().reverse().map((run) => `
        <article class="run-item">
          <b>${escapeHtml(run.kind)} · ${escapeHtml(run.status)}</b>
          <small>${escapeHtml(run.stage)} · ${Number(run.elapsed_seconds || 0).toFixed(1)}s · steps ${run.steps || 0} · tokens ${run.total_tokens || 0}</small>
          ${run.error_message ? `<p>${escapeHtml(run.error_category || "ERROR")}: ${escapeHtml(run.error_message)}</p>` : ""}
        </article>`).join("")
      : "<p>No runs yet.</p>");
    const run = activeRun() || latestRun();
    const strip = $("#activeRun");
    strip.hidden = !run;
    if (run) {
      setMarkup(strip, `
        <header><b>${escapeHtml(run.status)} · ${escapeHtml(run.stage)}</b><span>${Number(run.elapsed_seconds || 0).toFixed(1)}s</span></header>
        <p>${escapeHtml(run.error_message || "renders: " + (run.renders || 0) + " · steps: " + (run.steps || 0) + " · total tokens: " + (run.total_tokens || 0))}</p>
        <small>${escapeHtml(run.error_category || "RUN")}: renders ${run.renders || 0} · steps ${run.steps || 0} · total tokens ${run.total_tokens || 0}</small>
        <div class="run-actions">
          ${activeStates.has(run.status) && run.can_pause ? '<button data-run-action="pause" type="button">PAUSE</button>' : ""}
          ${activeStates.has(run.status) && run.can_resume ? '<button data-run-action="resume" type="button">RESUME</button>' : ""}
          ${activeStates.has(run.status) && run.can_cancel ? '<button data-run-action="cancel" type="button">CANCEL</button>' : ""}
        </div>`);
    }
  }

  function renderActivity() {
    const node = $("#activityLog");
    if (!state.activities.length) {
      node.innerHTML = "<article><b>IDLE · WAITING</b><p>No Agent run yet.</p></article>";
      return;
    }
    const condensed = [];
    for (const event of state.activities) {
      const previous = condensed[condensed.length - 1];
      if (
        previous && previous.type === event.type &&
        previous.stage === event.stage && previous.summary === event.summary
      ) {
        previous.repeat = (previous.repeat || 1) + 1;
        previous.details = event.details;
      } else {
        condensed.push({ ...event, repeat: 1 });
      }
    }
    node.innerHTML = condensed.slice(-14).map((event) => {
      const detail = event.details || {};
      const progress = [
        detail.tool ? `tool ${detail.tool}` : "",
        Number.isFinite(detail.chunks) ? `${detail.chunks} chunks` : "",
        Number.isFinite(detail.bytes_received) ? `${detail.bytes_received} bytes` : "",
        detail.error_message ? `${detail.error_category || "ERROR"}: ${detail.error_message}` : "",
        event.repeat > 1 ? `${event.repeat} updates` : "",
      ].filter(Boolean).join(" · ");
      return `
        <article class="${event.type === "usage" ? "usage" : ""}">
          <b>${escapeHtml(event.stage)} · ${escapeHtml(event.type)}</b>
          <p>${escapeHtml(event.summary)}</p>
          ${progress ? `<small>${escapeHtml(progress)}</small>` : ""}
        </article>`;
    }).join("");
    node.scrollTop = node.scrollHeight;
  }

  function renderHistory() {
    const revisions = state.project?.revisions || [];
    setMarkup($("#history"), revisions.length
      ? revisions.slice(-6).reverse().map((item) => `
        <article class="history-item">
          <span>r${item.revision} · ${escapeHtml(item.state)}</span>
          ${item.revision < state.project.revision ? `<button type="button" data-restore-revision="${item.revision}">RESTORE</button>` : ""}
        </article>`).join("")
      : "<p>No revision history.</p>");
  }

  function renderDeliveries() {
    const deliveries = state.project?.deliveries || [];
    $("#deliveries").innerHTML = deliveries.length
      ? deliveries.map((delivery) => `
        <article class="delivery-item">
          <b>${escapeHtml(delivery.id)}</b>
          <small>artifact r${delivery.artifact_revision}</small>
          <a href="/api/deliveries/${encodeURIComponent(delivery.id)}/download">DOWNLOAD SOURCE + DIST ZIP ↘</a>
        </article>`).join("")
      : "<p>No immutable delivery.</p>";
  }

  function renderActions() {
    const actionIds = new Set((state.project?.actions || []).map((action) => action.id));
    const mapping = {
      approveDirection: "approve_direction",
      produceArtifact: "produce_artifact",
      validateArtifact: "validate_artifact",
      approveExport: "approve_export",
      deliverArtifact: "deliver",
    };
    Object.entries(mapping).forEach(([node, action]) => {
      $(`#${node}`).hidden = !actionIds.has(action);
    });
    const run = activeRun();
    $("#sendButton").disabled = Boolean(run && runningStates.has(run.status));
  }

  function schedulePoll() {
    clearTimeout(state.poll);
    if (!state.project) return;
    const projectId = state.project.id;
    const run = activeRun();
    const delay = run && runningStates.has(run.status) ? 900 : 3500;
    state.poll = setTimeout(async () => {
      try {
        if (projectId !== state.selectedProjectId) return;
        await loadProject(projectId, { preserveCandidate: true });
      } catch (error) {
        notice(error.message);
        schedulePoll();
      }
    }, delay);
  }

  async function command(action, extra = {}) {
    const project = state.project;
    if (!project) return;
    const body = {
      command_id: uid(action),
      expected_revision: project.revision,
      action,
      ...extra,
    };
    if (action === "approve_direction") {
      const candidate = activeCandidate();
      if (!candidate) throw new Error("No candidate is available.");
      body.candidate_id = candidate.id;
      body.candidate_revision = candidate.revision;
    }
    if (action === "deliver") body.delivery_profile = { format: "zip" };
    state.project = await request(
      `/api/projects/${encodeURIComponent(project.id)}/commands`,
      { method: "POST", body: JSON.stringify(body) },
    );
    await loadActivity();
    render();
  }

  function bind() {
    $("#projectSelect").addEventListener("change", (event) => {
      state.selectedProjectId = event.target.value;
      loadProject(event.target.value, { preserveCandidate: false, resetActivity: true })
        .catch((error) => notice(error.message));
    });
    $("#newProjectButton").onclick = () => $("#newProjectDialog").showModal();
    $("#settingsButton").onclick = openSettings;
    $("#newProjectForm").addEventListener("submit", createProject);
    $("#addSourceButton").onclick = () =>
      state.project ? $("#sourceDialog").showModal() : notice("Create a project first.");
    $("#sourceDialogClose").onclick = () => $("#sourceDialog").close();
    $("#settingsDialogClose").onclick = () => $("#settingsDialog").close();
    $("#attachRepository").onclick = attachRepository;
    $("#imageInput").addEventListener("change", uploadImages);
    $("#providerForm").addEventListener("submit", saveProvider);
    $("#deleteProvider").onclick = deleteProvider;
    $("#messageForm").addEventListener("submit", sendMessage);
    $("#messageInput").addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        $("#messageForm").requestSubmit();
      }
    });
    $("#candidateTabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-candidate]");
      if (!button) return;
      state.candidateId = button.dataset.candidate;
      renderCandidates();
      renderPreview();
    });
    $("#activeRun").addEventListener("click", runAction);
    $("#history").addEventListener("click", (event) => {
      const button = event.target.closest("[data-restore-revision]");
      if (button) {
        command("restore_revision", {
          source_revision: Number(button.dataset.restoreRevision),
        }).catch((error) => notice(error.message));
      }
    });
    [
      ["#approveDirection", "approve_direction"],
      ["#produceArtifact", "produce_artifact"],
      ["#validateArtifact", "validate_artifact"],
      ["#approveExport", "approve_export"],
      ["#deliverArtifact", "deliver"],
    ].forEach(([node, action]) => {
      $(node).onclick = () => command(action).catch((error) => notice(error.message));
    });
    window.addEventListener("message", acceptPreviewSelection);
    $("#selectionChip button").onclick = clearSelection;
  }

  async function createProject(event) {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    try {
      const project = await request("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          command_id: uid("project"),
          name: $("#projectName").value,
        }),
      });
      $("#newProjectDialog").close();
      await loadProjects(project.id);
    } catch (error) {
      notice(error.message);
    }
  }

  async function openSettings() {
    try {
      const settings = await request("/api/settings/provider");
      $("#providerBaseUrl").value = settings.base_url || defaultKimiBaseUrl;
      $("#providerModel").value = settings.model || "k3";
      $("#providerKey").value = "";
      $("#credentialState").textContent = settings.credential_configured
        ? "CONFIGURED IN WINDOWS CREDENTIAL MANAGER"
        : "NOT CONFIGURED";
      $("#credentialState").classList.toggle("ready", settings.credential_configured);
      $("#settingsDialog").showModal();
    } catch (error) {
      notice(error.message);
    }
  }

  async function attachRepository() {
    try {
      const project = state.project;
      if (!project) throw new Error("Create a project first.");
      await request(`/api/projects/${encodeURIComponent(project.id)}/repository`, {
        method: "POST",
        body: JSON.stringify({
          command_id: uid("repo"),
          expected_revision: project.revision,
          path: $("#repositoryPath").value,
        }),
      });
      $("#sourceDialog").close();
      await loadProject(project.id, { resetActivity: true });
      notice("Read-only repository snapshot attached.");
    } catch (error) {
      notice(error.message);
    }
  }

  async function uploadImages(event) {
    try {
      const project = state.project;
      if (!project) throw new Error("Create a project first.");
      for (const file of event.target.files) {
        const form = new FormData();
        form.set("command_id", uid("image"));
        form.set("expected_revision", String(state.project.revision));
        form.set("image", file, file.name);
        await request(`/api/projects/${encodeURIComponent(project.id)}/sources/images`, {
          method: "POST",
          body: form,
        });
        await loadProject(project.id, { preserveCandidate: true });
      }
      $("#sourceDialog").close();
      notice("Reference images attached for analysis only.");
    } catch (error) {
      notice(error.message);
    } finally {
      event.target.value = "";
    }
  }

  async function saveProvider(event) {
    event.preventDefault();
    try {
      if (!$("#providerKey").value) throw new Error("Enter the API key to save and probe.");
      await request("/api/settings/provider", {
        method: "PUT",
        body: JSON.stringify({
          base_url: $("#providerBaseUrl").value,
          model: $("#providerModel").value,
          api_key: $("#providerKey").value,
        }),
      });
      $("#providerKey").value = "";
      await loadHealth();
      $("#settingsDialog").close();
      notice("Kimi was probed and stored in Windows Credential Manager.");
    } catch (error) {
      notice(error.message);
    }
  }

  async function deleteProvider() {
    try {
      await request("/api/settings/provider", { method: "DELETE" });
      await loadHealth();
      $("#settingsDialog").close();
      notice("Provider credential deleted.");
    } catch (error) {
      notice(error.message);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    try {
      const project = state.project;
      if (!project) throw new Error("Create a project first.");
      const body = {
        client_message_id: uid("message"),
        expected_revision: project.revision,
        text: $("#messageInput").value,
      };
      if (state.selected) {
        body.target_id = state.selected.owner_id;
        body.target_revision = state.selected.revision;
        body.object_ref = state.selected.object_ref;
      } else if (!intakeStates.has(project.state)) {
        const focus = focusTarget();
        if (focus?.id && focus?.revision) {
          body.target_id = focus.id;
          body.target_revision = focus.revision;
        }
      }
      await request(`/api/projects/${encodeURIComponent(project.id)}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      $("#messageInput").value = "";
      clearSelection();
      await loadProject(project.id);
      notice("Agent job queued.");
    } catch (error) {
      if (error.body?.category === "STALE_REVISION" && state.project) {
        await loadProject(state.project.id);
      }
      notice(error.message);
    }
  }

  async function runAction(event) {
    const button = event.target.closest("[data-run-action]");
    if (!button) return;
    try {
      const run = activeRun();
      if (!run) return;
      await request(`/api/runs/${encodeURIComponent(run.id)}/${button.dataset.runAction}`, {
        method: "POST",
        body: "{}",
      });
      await loadProject(state.project.id);
    } catch (error) {
      notice(error.message);
    }
  }

  function acceptPreviewSelection(event) {
    const frame = $("#previewFrame");
    if (event.source !== frame.contentWindow || event.data?.type !== "oey-object-selected") {
      return;
    }
    const focus = focusTarget();
    const token = previewToken(focus);
    if (
      !focus ||
      event.data.token !== token ||
      state.usedPreviewTokens.has(event.data.token) ||
      event.data.owner_id !== (focus.id || focus.artifact_id) ||
      event.data.revision !== focus.revision
    ) {
      return;
    }
    state.usedPreviewTokens.add(event.data.token);
    state.selected = {
      owner_id: event.data.owner_id,
      revision: event.data.revision,
      object_ref: event.data.object_ref,
    };
    const chip = $("#selectionChip");
    chip.hidden = false;
    chip.querySelector("span").textContent =
      `TARGET / ${event.data.object_ref} / r${event.data.revision}`;
    $("#messageInput").focus();
    rotatePreviewToken(focus);
  }

  function clearSelection() {
    state.selected = null;
    $("#selectionChip").hidden = true;
  }

  async function rotatePreviewToken(focus) {
    try {
      const rotated = await request(
        `/api/previews/${encodeURIComponent(focus.file_set_id)}/token`,
        { method: "POST", body: JSON.stringify({ token: previewToken(focus) }) },
      );
      focus.preview_token = rotated.preview_token;
      focus.preview_url = rotated.preview_url;
      renderPreview();
    } catch (error) {
      notice(error.message);
    }
  }

  boot().catch((error) => notice(`Unable to open the local workbench: ${error.message}`));
})();
