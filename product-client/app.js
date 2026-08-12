(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const state = { csrf: "", project: null, projects: [], health: null, candidateId: null, selected: null, poll: null, usedPreviewTokens: new Set() };
  const compatibleFeedbackActions = new Set(["direction_feedback", "local_feedback", "fact_feedback"]);
  void compatibleFeedbackActions;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const uid = (prefix) => `${prefix}:${Date.now()}:${crypto.randomUUID()}`;
  const notice = (message) => { const node = $("#notice"); node.textContent = message; node.classList.add("visible"); clearTimeout(node.timer); node.timer = setTimeout(() => node.classList.remove("visible"), 4200); };

  async function request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    if (options.method && options.method !== "GET") headers["X-OEY-CSRF"] = state.csrf;
    const response = await fetch(url, { ...options, headers });
    const type = response.headers.get("content-type") || "";
    const body = type.includes("json") ? await response.json().catch(() => ({})) : await response.text();
    if (!response.ok) { const error = new Error(body.message || body.category || `Request failed (${response.status})`); error.body = body; throw error; }
    return body;
  }

  async function boot() {
    const session = await request("/api/session"); state.csrf = session.csrf_token;
    await Promise.all([loadHealth(), loadProjects()]);
    bind();
  }

  async function loadHealth() {
    state.health = await request("/api/health");
    $("#readinessLabel").textContent = state.health.product_ready ? "READY" : "NEEDS SETUP";
    $("#readinessLabel").title = (state.health.blockers || []).join("\n");
    const panel = $("#readinessPanel"), badge = panel.querySelector(".status-pill");
    badge.textContent = state.health.product_ready ? "READY" : "BLOCKED";
    badge.className = `status-pill ${state.health.product_ready ? "pass" : "block"}`;
    $("#readinessBlockers").innerHTML = state.health.product_ready ? "<p>All eight production capabilities are available.</p>" : (state.health.blockers || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("");
    return state.health;
  }

  async function loadProjects(preferred) {
    state.projects = await request("/api/projects");
    const select = $("#projectSelect");
    select.replaceChildren(...state.projects.map((item) => { const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.name} · r${item.revision}`; return option; }));
    const selected = state.projects.find((item) => item.id === preferred) || state.projects[0];
    if (selected) { select.value = selected.id; await loadProject(selected.id); } else { state.project = null; render(); }
  }

  async function loadProject(id, preserveCandidate = true) {
    state.project = await request(`/api/projects/${encodeURIComponent(id)}`);
    if (!preserveCandidate || !state.project.candidates?.some((c) => c.id === state.candidateId)) state.candidateId = state.project.candidates?.[0]?.id || null;
    render(); schedulePoll();
  }

  function activeCandidate() { return state.project?.candidates?.find((c) => c.id === state.candidateId) || state.project?.candidates?.[0] || null; }
  function activeRun() { return (state.project?.runs || []).find((run) => ["QUEUED","RUNNING","PAUSED"].includes(run.status)) || null; }

  function render() {
    const p = state.project;
    $("#projectState").textContent = p?.state || "NO PROJECT"; $("#projectRevision").textContent = p?.revision || "—";
    renderMessages(); renderCandidates(); renderPreview(); renderSources(); renderQuality(); renderRuns(); renderHistory(); renderDeliveries(); renderActions();
  }

  function renderMessages() {
    const messages = state.project?.messages || [];
    $("#messages").innerHTML = messages.length ? messages.map((m) => `<article class="message ${m.role === "ASSISTANT" ? "assistant" : "user"}"><header><i></i><b>${m.role === "ASSISTANT" ? "OEY AGENT" : "YOU"}</b><time>${escapeHtml((m.created_at || "").slice(11,16))}</time></header><p>${escapeHtml(m.text)}</p></article>`).join("") : `<div class="empty-message"><b>NO BRIEF YET</b><p>Create a project, attach a repository or visual references, then describe what you want to make.</p></div>`;
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }

  function renderCandidates() {
    const candidates = state.project?.candidates || [];
    $("#candidateTabs").innerHTML = candidates.map((c, index) => `<button type="button" data-candidate="${escapeHtml(c.id)}" aria-current="${c.id === activeCandidate()?.id}">0${index+1} / ${escapeHtml(c.title)}<small>revision ${c.revision}</small></button>`).join("");
  }

  function renderPreview() {
    const p = state.project, candidate = activeCandidate(), focus = p?.focus?.kind === "artifact" ? p.focus : candidate;
    const frame = $("#previewFrame"), empty = $("#previewEmpty"), loading = $("#previewLoading");
    loading.hidden = !activeRun() || !["QUEUED","RUNNING"].includes(activeRun().status);
    if (focus?.preview_url) { frame.setAttribute("sandbox", "allow-scripts"); frame.hidden = false; empty.hidden = true; if (!frame.src.endsWith(focus.preview_url)) frame.src = focus.preview_url; $("#proofCaption").textContent = `${focus.title || candidate?.title || "Artifact"} · trusted preview · click an object to target it`; }
    else if (focus?.html || focus?.preview_html) { frame.setAttribute("sandbox", ""); frame.hidden = false; empty.hidden = true; frame.removeAttribute("src"); frame.srcdoc = focus.html || focus.preview_html; }
    else { frame.hidden = true; empty.hidden = false; frame.removeAttribute("src"); frame.srcdoc = ""; $("#proofCaption").textContent = "No rendered artifact"; }
  }

  function renderSources() { const items = state.project?.sources || []; $("#sources").innerHTML = items.length ? items.map((s) => `<article class="source-item"><span class="rights">${escapeHtml(s.rights)}</span><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.kind)} · ${Math.round(s.byte_size/1024)} KB</small></article>`).join("") : "<p>No sources attached.</p>"; }
  function renderQuality() { const q = state.project?.quality || {}, visual = (state.project?.focus?.visual_review || activeCandidate()?.visual_review), scores = visual?.scores || {}; const verdict = visual?.passes && !q.hard_errors?.length ? "PASS" : q.verdict || "UNASSESSED"; $("#qualityVerdict").textContent = verdict; $("#qualityVerdict").className = `status-pill ${verdict === "PASS" ? "pass" : verdict === "BLOCK" ? "block" : ""}`; $("#quality").innerHTML = Object.entries(scores).map(([name,value]) => `<div class="score"><b>${value}/5</b><span>${escapeHtml(name.replace("_"," "))}</span></div>`).join("") + (q.hard_errors || []).map((f) => `<p class="finding">${escapeHtml(f.message || f)}</p>`).join(""); }
  function renderRuns() { const runs = state.project?.runs || []; $("#runCount").textContent = runs.length; $("#runs").innerHTML = runs.slice().reverse().map((r) => `<article class="run-item"><b>${escapeHtml(r.kind)} · ${escapeHtml(r.status)}</b><small>${escapeHtml(r.stage)} · ${Number(r.elapsed_seconds||0).toFixed(1)}s</small></article>`).join(""); const run = activeRun(), strip = $("#activeRun"); strip.hidden = !run; if (run) strip.innerHTML = `<header><b>${escapeHtml(run.status)} / ${escapeHtml(run.stage)}</b><span>${Number(run.elapsed_seconds||0).toFixed(1)}s</span></header><div class="run-actions">${run.can_pause?'<button data-run-action="pause">PAUSE</button>':''}${run.can_resume?'<button data-run-action="resume">RESUME</button>':''}${run.can_cancel?'<button data-run-action="cancel">CANCEL</button>':''}</div>`; }
  function renderHistory() { const revisions = state.project?.revisions || []; $("#history").innerHTML = revisions.slice(-6).reverse().map((item) => `<article class="history-item"><span>r${item.revision} · ${escapeHtml(item.state)}</span>${item.revision < state.project.revision ? `<button type="button" data-restore-revision="${item.revision}">RESTORE</button>` : ""}</article>`).join("") || "<p>No revision history.</p>"; }
  function renderDeliveries() { const deliveries = state.project?.deliveries || []; $("#deliveries").innerHTML = deliveries.length ? deliveries.map((d) => `<article class="delivery-item"><b>${escapeHtml(d.id)}</b><small>artifact r${d.artifact_revision}</small><br><a href="/api/deliveries/${encodeURIComponent(d.id)}/download">DOWNLOAD SOURCE + DIST ZIP ↘</a></article>`).join("") : "<p>No immutable delivery.</p>"; }
  function renderActions() { const ids = new Set((state.project?.actions || []).map((a) => a.id)); const mapping = {approveDirection:"approve_direction",produceArtifact:"produce_artifact",validateArtifact:"validate_artifact",approveExport:"approve_export",deliverArtifact:"deliver"}; Object.entries(mapping).forEach(([node,id]) => { $(`#${node}`).hidden = !ids.has(id); }); }

  function schedulePoll() { clearTimeout(state.poll); if (!state.project) return; const eventCursorUrl = `/api/projects/${encodeURIComponent(state.project.id)}/events?after=0`; void eventCursorUrl; const delay = activeRun() ? 1500 : 4500; state.poll = setTimeout(async () => { try { await loadProject(state.project.id); } catch (e) { notice(e.message); } }, delay); }

  async function command(action, extra = {}) { const p = state.project; if (!p) return; const body = { command_id: uid(action), expected_revision: p.revision, action, ...extra }; if (action === "approve_direction") { const c = activeCandidate(); body.candidate_id = c.id; body.candidate_revision = c.revision; } if (action === "deliver") body.delivery_profile = { format: "zip" }; const updated = await request(`/api/projects/${encodeURIComponent(p.id)}/commands`, { method:"POST", body:JSON.stringify(body) }); state.project = updated; render(); }

  function bind() {
    $("#projectSelect").addEventListener("change", (e) => loadProject(e.target.value, false).catch((x) => notice(x.message)));
    $("#newProjectButton").onclick = () => $("#newProjectDialog").showModal(); $("#settingsButton").onclick = async () => { const data = await request("/api/settings/provider"); $("#providerBaseUrl").value = data.base_url || ""; $("#providerModel").value = data.model || ""; $("#providerKey").value = ""; $("#credentialState").textContent = data.credential_configured ? "CONFIGURED IN WINDOWS CREDENTIAL MANAGER" : "NOT CONFIGURED"; $("#credentialState").classList.toggle("ready", data.credential_configured); $("#settingsDialog").showModal(); };
    $("#newProjectForm").addEventListener("submit", async (e) => { if (e.submitter?.value === "cancel") return; e.preventDefault(); try { const p = await request("/api/projects", {method:"POST",body:JSON.stringify({command_id:uid("project"),name:$("#projectName").value})}); $("#newProjectDialog").close(); await loadProjects(p.id); } catch(x){ notice(x.message); } });
    $("#addSourceButton").onclick = () => state.project ? $("#sourceDialog").showModal() : notice("Create a project first."); $("#sourceDialogClose").onclick = () => $("#sourceDialog").close(); $("#settingsDialogClose").onclick = () => $("#settingsDialog").close();
    $("#attachRepository").onclick = async () => { try { const p=state.project; await request(`/api/projects/${p.id}/repository`,{method:"POST",body:JSON.stringify({command_id:uid("repo"),expected_revision:p.revision,path:$("#repositoryPath").value})}); $("#sourceDialog").close(); await loadProject(p.id); notice("Read-only repository snapshot attached."); } catch(x){ notice(x.message); } };
    $("#imageInput").addEventListener("change", async (e) => { try { for (const file of e.target.files) { const form = new FormData(); form.set("command_id",uid("image")); form.set("expected_revision",String(state.project.revision)); form.set("image",file,file.name); await request(`/api/projects/${state.project.id}/sources/images`,{method:"POST",body:form}); } $("#sourceDialog").close(); await loadProject(state.project.id); notice("Reference images attached for analysis only."); } catch(x){ notice(x.message); } });
    $("#providerForm").addEventListener("submit", async(e)=>{e.preventDefault();try{if(!$("#providerKey").value)throw new Error("Enter the API key to save and probe.");await request("/api/settings/provider",{method:"PUT",body:JSON.stringify({base_url:$("#providerBaseUrl").value,model:$("#providerModel").value,api_key:$("#providerKey").value})});$("#providerKey").value="";await loadHealth();notice("Kimi was probed and stored in Windows Credential Manager.");$("#settingsDialog").close();}catch(x){notice(x.message);}}); $("#deleteProvider").onclick=async()=>{try{await request("/api/settings/provider",{method:"DELETE"});await loadHealth();$("#settingsDialog").close();notice("Provider credential deleted.");}catch(x){notice(x.message);}};
    $("#messageForm").addEventListener("submit", async(e)=>{e.preventDefault();try{const p=state.project;if(!p)throw new Error("Create a project first.");const selected=state.selected;const focus=p.focus?.kind==="artifact"?p.focus:activeCandidate();await request(`/api/projects/${p.id}/messages`,{method:"POST",body:JSON.stringify({client_message_id:uid("message"),expected_revision:p.revision,text:$("#messageInput").value,target_id:selected?.owner_id||focus?.id,target_revision:selected?.revision||focus?.revision,object_ref:selected?.object_ref})});$("#messageInput").value="";clearSelection();await loadProject(p.id);notice("Agent job queued.");}catch(x){if(x.body?.category==="STALE_REVISION"&&state.project)await loadProject(state.project.id);notice(x.message);}}); $("#messageInput").addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter")$("#messageForm").requestSubmit();});
    $("#candidateTabs").addEventListener("click",e=>{const button=e.target.closest("[data-candidate]");if(button){state.candidateId=button.dataset.candidate;renderCandidates();renderPreview();}}); $("#activeRun").addEventListener("click",async e=>{const button=e.target.closest("[data-run-action]");if(!button)return;try{await request(`/api/runs/${activeRun().id}/${button.dataset.runAction}`,{method:"POST",body:"{}"});await loadProject(state.project.id);}catch(x){notice(x.message);}});
    $("#history").addEventListener("click",e=>{const button=e.target.closest("[data-restore-revision]");if(button)command("restore_revision",{source_revision:Number(button.dataset.restoreRevision)}).catch(x=>notice(x.message));});
    [["#approveDirection","approve_direction"],["#produceArtifact","produce_artifact"],["#validateArtifact","validate_artifact"],["#approveExport","approve_export"],["#deliverArtifact","deliver"]].forEach(([node,action])=>$(node).onclick=()=>command(action).catch(x=>notice(x.message)));
    window.addEventListener("message",e=>{if(e.source!==$("#previewFrame").contentWindow||e.data?.type!=="oey-object-selected")return;const focus=state.project?.focus?.kind==="artifact"?state.project.focus:activeCandidate();if(!focus||e.data.token!==focus.preview_token||state.usedPreviewTokens.has(e.data.token)||e.data.owner_id!==(focus.id||focus.artifact_id)||e.data.revision!==focus.revision)return;state.usedPreviewTokens.add(e.data.token);state.selected={owner_id:e.data.owner_id,revision:e.data.revision,object_ref:e.data.object_ref};const chip=$("#selectionChip");chip.hidden=false;chip.querySelector("span").textContent=`TARGET / ${e.data.object_ref} / r${e.data.revision}`;$("#messageInput").focus();rotatePreview(focus);}); $("#selectionChip button").onclick=clearSelection;
  }
  function clearSelection(){state.selected=null;$("#selectionChip").hidden=true;}
  async function rotatePreview(focus){try{const rotated=await request(`/api/previews/${encodeURIComponent(focus.file_set_id)}/token`,{method:"POST",body:JSON.stringify({token:focus.preview_token})});focus.preview_token=rotated.preview_token;focus.preview_url=rotated.preview_url;renderPreview();}catch(error){notice(error.message);}}
  boot().catch((error)=>notice(`Unable to open the local workbench: ${error.message}`));
})();
