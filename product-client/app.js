(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  let project = null;
  let candidateFocus = null;

  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );

  const describe = (value) => {
    if (value === null || value === undefined || value === "") return "—";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  };

  const showNotice = (message) => {
    $("#notice").textContent = message;
  };

  async function request(url, options = {}) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body.current_revision !== undefined && project?.id) {
        await loadProject(project.id, { preserveFocus: true });
      }
      const error = new Error(
        body.message || body.category || `请求失败（${response.status}）`,
      );
      error.category = body.category;
      throw error;
    }
    return body;
  }

  async function loadProjects(preferredId) {
    const projects = await request("/api/projects");
    const select = $("#projectSelect");
    select.replaceChildren(
      ...projects.map((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.name} · r${item.revision}`;
        return option;
      }),
    );
    const selected =
      projects.find((item) => item.id === preferredId) || projects[0];
    if (selected) {
      select.value = selected.id;
      await loadProject(selected.id);
    } else {
      project = null;
      render();
    }
  }

  async function loadProject(id, { preserveFocus = false } = {}) {
    project = await request(`/api/projects/${encodeURIComponent(id)}`);
    if (!preserveFocus) candidateFocus = null;
    await syncActivity(false);
    render();
  }

  async function syncActivity(renderAfter = true) {
    if (!project) return;
    const activity = Array.isArray(project.activity) ? project.activity : [];
    const cursor = activity.reduce(
      (highest, item) => Math.max(highest, Number(item.sequence) || 0),
      0,
    );
    const updates = await request(
      `/api/projects/${encodeURIComponent(project.id)}/events?after=${cursor}`,
    );
    if (updates.length) {
      const known = new Set(activity.map((item) => item.id));
      project.activity = [
        ...activity,
        ...updates.filter((item) => !known.has(item.id)),
      ];
      if (renderAfter) render();
    }
  }

  function selectedCandidate() {
    const candidates = Array.isArray(project?.candidates)
      ? project.candidates
      : [];
    return (
      candidates.find((candidate) => candidate.id === candidateFocus) ||
      candidates[0] ||
      null
    );
  }

  function currentFocus() {
    return project?.focus && typeof project.focus === "object"
      ? project.focus
      : {};
  }

  function focusHtml(candidate) {
    const focus = currentFocus();
    if (focus.kind === "artifact") {
      return focus.html || focus.content || project?.focus_preview || "";
    }
    return (
      candidate?.preview ||
      candidate?.preview_html ||
      focus.preview ||
      focus.html ||
      focus.content ||
      project?.focus_preview ||
      ""
    );
  }

  function renderPreview(candidate) {
    const canvas = $("#canvas");
    canvas.replaceChildren();
    const sheet = document.createElement("article");
    sheet.className = "proof-sheet";
    sheet.innerHTML = `
      <div class="proof-meta">
        <span class="tag">${escapeHtml(project?.state || "NO STATE")}</span>
        <span class="tag">${escapeHtml(project?.constraints?.template_role || project?.template_role || "NO TEMPLATE")}</span>
      </div>
      <h2>${escapeHtml(currentFocus().kind === "artifact" ? currentFocus().title : candidate?.title || currentFocus().title || "Current proof")}</h2>
    `;

    const preview = focusHtml(candidate);
    if (preview) {
      const frame = document.createElement("iframe");
      frame.className = "preview-frame";
      frame.title = `${candidate?.title || project?.name || "项目"} 安全预览`;
      frame.setAttribute("sandbox", "");
      frame.srcdoc = String(preview);
      sheet.append(frame);
    } else {
      const empty = document.createElement("p");
      empty.textContent = "当前阶段尚无可渲染校样，请从左侧推进下一步。";
      sheet.append(empty);
    }

    const candidates = Array.isArray(project?.candidates)
      ? project.candidates
      : [];
    if (candidates.length) {
      const heading = document.createElement("h2");
      heading.textContent = "候选方向";
      sheet.append(heading);
      const list = document.createElement("div");
      list.className = "candidates";
      candidates.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "candidate";
        button.dataset.candidate = item.id;
        button.setAttribute("aria-current", String(item.id === candidate?.id));
        button.innerHTML = `${escapeHtml(item.title || item.id)}<small>revision ${escapeHtml(item.revision)}</small>`;
        list.append(button);
      });
      sheet.append(list);
    }
    canvas.append(sheet);
  }

  function renderList(target, items, formatter, emptyText) {
    target.innerHTML = items.length
      ? items.map(formatter).join("")
      : `<p>${escapeHtml(emptyText)}</p>`;
  }

  function renderSettings() {
    const values = project?.settings || {};
    const entries = Object.entries(values);
    $("#projectSettings").innerHTML = entries.length
      ? entries
          .map(
            ([key, value]) =>
              `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(describe(value))}</dd>`,
          )
          .join("")
      : "<dt>Configuration</dt><dd>当前项目尚无 settings 投影。</dd>";
  }

  function render() {
    if (!project) {
      $("#stamp").value = "未载入项目";
      $("#status").textContent = "NO PROJECT";
      $("#directionForm").hidden = true;
      $("#factForm").hidden = true;
      $("#localForm").hidden = true;
      $("#actions").innerHTML = "<p>请在 Settings 创建演示项目。</p>";
      renderSettings();
      return;
    }

    const focus = currentFocus();
    const candidate = selectedCandidate();
    const constraints = project.constraints || {};
    const quality = project.quality || {};
    const actions = Array.isArray(project.actions) ? project.actions : [];
    const actionIds = actions.map((action) =>
      typeof action === "string" ? action : action.id,
    );
    const formActions = new Set([
      "direction_feedback",
      "local_feedback",
      "fact_feedback",
    ]);
    const commandActions = actions.filter(
      (action) => !formActions.has(typeof action === "string" ? action : action.id),
    );

    $("#stamp").value = `REV ${project.revision} · ${project.state}`;
    $("#status").textContent = `${project.state} — ${project.name}`;
    $("#proofRevision").textContent = project.revision ?? "—";
    const tree = project.tree || {};
    $("#tree").innerHTML = `
      <p><strong>${escapeHtml(project.name)}</strong></p>
      <p><span class="tag">${escapeHtml(project.preset || constraints.preset || "PROJECT")}</span>
      <span class="tag">${escapeHtml(project.template_role || constraints.template_role || "NO ROLE")}</span></p>
      <p>Focus: ${escapeHtml(focus.kind || focus.id || focus.artifact_id || "—")}</p>
      <ul>${Object.entries(tree)
        .map(
          ([key, value]) =>
            `<li><span>${escapeHtml(key)}</span><b>${escapeHtml(describe(value))}</b></li>`,
        )
        .join("")}</ul>
    `;

    renderList(
      $("#activity"),
      Array.isArray(project.activity) ? project.activity : [],
      (item) =>
        `<li><strong>${escapeHtml(item.event_type || item.type || "Event")}</strong><br><small>${escapeHtml(item.message || item.stage || `sequence ${item.sequence ?? "—"}`)}</small></li>`,
      "活动将在项目开始后出现。",
    );

    $("#actions").innerHTML = commandActions.length
      ? commandActions
          .map((action) => {
            const item = typeof action === "string" ? { id: action } : action;
            return `<button type="button" class="${escapeHtml(item.tone || "")}" data-action="${escapeHtml(item.id)}">${escapeHtml(item.label || item.id)}</button>`;
          })
          .join("")
      : "<p>使用下方批注入口，或等待新的合法动作。</p>";

    const constraintEntries = Object.entries(constraints.settings || constraints);
    $("#constraints").innerHTML = constraintEntries.length
      ? constraintEntries
          .map(
            ([key, value]) =>
              `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(describe(value))}</dd>`,
          )
          .join("")
      : "<dt>Profile</dt><dd>尚无约束投影</dd>";

    const aesthetic = quality.aesthetic_findings || quality.aesthetic || [];
    const hardErrors = quality.hard_errors || [];
    $("#quality").innerHTML = `
      <p><strong>Verdict:</strong> ${escapeHtml(quality.verdict || "—")}</p>
      ${aesthetic.map((item) => `<div class="finding">AESTHETIC · ${escapeHtml(item.message || item)}</div>`).join("") || '<p>暂无审美 findings</p>'}
      ${hardErrors.map((item) => `<div class="finding hard">HARD ERROR · ${escapeHtml(item.message || item)}</div>`).join("") || '<p>无硬错误</p>'}
    `;

    renderList(
      $("#approvals"),
      Array.isArray(project.approvals) ? project.approvals : [],
      (item) =>
        `<div class="approval">${item.active === false ? "○" : "✓"} ${escapeHtml(item.action)} · ${escapeHtml(item.target_id || "target")} r${escapeHtml(item.target_revision ?? "—")}</div>`,
      "尚无审批",
    );
    renderList(
      $("#feedback"),
      Array.isArray(project.feedback) ? project.feedback : [],
      (item) =>
        `<div class="approval">${escapeHtml(item.kind)} → ${escapeHtml(describe(item.routed_to))}</div>`,
      "尚无反馈",
    );
    renderList(
      $("#delivery"),
      Array.isArray(project.deliveries) ? project.deliveries : [],
      (item) =>
        `<div class="delivery-item"><strong>Delivery ${escapeHtml(item.id || item)} · r${escapeHtml(item.revision ?? "—")}</strong><br>Export ${escapeHtml(item.export_id || "—")} · r${escapeHtml(item.export_revision ?? "—")}<br>Quality ${escapeHtml(item.quality_decision_id || "—")}<br>Approval ${escapeHtml(item.approval_id || "—")}</div>`,
      "尚未交付",
    );

    renderPreview(candidate);
    const artifactId = focus.artifact_id;
    $("#directionForm").hidden = !actionIds.includes("direction_feedback");
    $("#factForm").hidden = !actionIds.includes("fact_feedback");
    $("#localForm").hidden =
      !artifactId || !actionIds.includes("local_feedback");
    $("#breakContract").closest("label").hidden =
      (project.template_role || constraints.template_role) !== "DELIVERY_CONTRACT";
    renderSettings();
  }

  async function sendCommand(action, extra = {}) {
    if (!project) return;
    const candidate = selectedCandidate();
    const focus = currentFocus();
    const payload = {
      command_id: crypto.randomUUID(),
      action,
      expected_revision: project.revision,
      ...extra,
    };

    if (action === "approve_direction" && candidate) {
      payload.candidate_id = candidate.id;
      payload.candidate_revision = candidate.revision;
    }
    if (action === "direction_feedback" && candidate) {
      payload.target_id = candidate.id;
      payload.target_revision = candidate.revision;
    }
    if (action === "fact_feedback") {
      const targetId = focus.artifact_id || focus.id || candidate?.id;
      const targetRevision =
        focus.artifact_revision || focus.revision || candidate?.revision;
      if (targetId && targetRevision) {
        payload.target_id = targetId;
        payload.target_revision = targetRevision;
      }
    }
    if (action === "local_feedback") {
      payload.target_id = focus.artifact_id || focus.id;
      payload.target_revision = focus.artifact_revision || focus.revision;
    }

    try {
      project = await request(
        `/api/projects/${encodeURIComponent(project.id)}/commands`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      render();
      showNotice(`已提交：${action}`);
    } catch (error) {
      showNotice(`${error.message}；项目已按服务端 revision 刷新。`);
    }
  }

  function showPanel(panel) {
    const settings = panel === "settings";
    $("#workspace").hidden = settings;
    $("#settings").hidden = !settings;
    document.querySelectorAll("[data-panel]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.panel === panel),
      );
    });
    if (settings) renderSettings();
  }

  $("#projectSelect").addEventListener("change", (event) => {
    candidateFocus = null;
    loadProject(event.target.value).catch((error) => showNotice(error.message));
  });

  $("#actions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button) sendCommand(button.dataset.action);
  });

  $("#canvas").addEventListener("click", (event) => {
    const button = event.target.closest("[data-candidate]");
    if (button) {
      candidateFocus = button.dataset.candidate;
      render();
    }
  });

  $("#directionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#directionFeedback");
    sendCommand("direction_feedback", { text: input.value.trim() });
  });

  $("#factForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#factFeedback");
    sendCommand("fact_feedback", { text: input.value.trim() });
  });

  $("#localForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("#localFeedback").value.trim();
    const qaSuffix = $("#breakContract").checked ? " [break-contract]" : "";
    sendCommand("local_feedback", {
      text: text + qaSuffix,
      object_ref: $("#objectRef").value,
    });
  });

  $("#createForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      command_id: crypto.randomUUID(),
      name: String(data.get("name") || "Demo project").trim(),
      preset: data.get("preset"),
      template_role: data.get("template_role"),
    };
    try {
      const created = await request("/api/projects", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      candidateFocus = null;
      await loadProjects(created.id || created.project_id);
      showPanel("workspace");
      showNotice("演示项目已创建并准备完成。 ");
    } catch (error) {
      showNotice(error.message);
    }
  });

  document.querySelector(".masthead nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-panel]");
    if (button) showPanel(button.dataset.panel);
  });

  document.querySelector(".mobile-toggles").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mobile-panel]");
    if (!button) return;
    const panel = document.getElementById(button.dataset.mobilePanel);
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    panel.dataset.mobileOpen = String(!expanded);
  });

  window.setInterval(() => {
    syncActivity().catch((error) => showNotice(error.message));
  }, 5000);

  loadProjects().catch((error) => {
    showNotice(`无法连接本地 API：${error.message}`);
  });
})();
