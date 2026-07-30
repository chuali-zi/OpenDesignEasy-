/* 环线 THE LOOP — 界面层
 * 结构：单轴纵深主线。顶部横带切换项目 = 切换你在读哪一条「环线」；
 * 主线上的每个站点（候选舞台 / 两级反馈 / 回路记录 / 约束 / 质量双轨 / 交付）
 * 都随项目整体重渲染。
 */
(function () {
  const api = window.__mockApi__;
  const $ = (sel) => document.querySelector(sel);

  const els = {
    tabs: $("#railTabs"),
    status: $("#railStatus"),
    spine: $("#spine"),
    stageTitle: $("#stageTitle"),
    stageBrief: $("#stageBrief"),
    stageRevision: $("#stageRevision"),
    stageNote: $("#stageNote"),
    stagePreview: $("#stagePreview"),
    stageEmpty: $("#stageEmpty"),
    directionChips: $("#directionChips"),
    directionInput: $("#directionInput"),
    directionSubmit: $("#directionSubmit"),
    localRegion: $("#localRegion"),
    localInput: $("#localInput"),
    localSubmit: $("#localSubmit"),
    loopCount: $("#loopCount"),
    loopList: $("#loopList"),
    constraintPreset: $("#constraintPreset"),
    constraintRole: $("#constraintRole"),
    constraintTone: $("#constraintTone"),
    constraintPalette: $("#constraintPalette"),
    constraintRules: $("#constraintRules"),
    qualityVerdict: $("#qualityVerdict"),
    qualityHard: $("#qualityHard"),
    qualityAesthetic: $("#qualityAesthetic"),
    deliveryStatus: $("#deliveryStatus"),
    deliveryList: $("#deliveryList"),
    toast: $("#toast"),
    modalMask: $("#modalMask"),
    npName: $("#npName"),
    npPreset: $("#npPreset"),
    npRole: $("#npRole")
  };

  const state = { projects: [], currentId: null, detail: null, freshEvents: 0 };
  const ACTOR_LABEL = { agent: "design_agent", user: "你", system: "系统", quality: "质量复核" };

  /* ---------- 提示 ---------- */
  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), 2800);
  }

  /* ---------- 顶部项目横带 ---------- */
  function renderRail() {
    els.tabs.innerHTML = "";
    state.projects.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rail-tab" + (p.id === state.currentId ? " active" : "");
      btn.innerHTML = `<span class="dot ${p.statusTone}"></span><span>${p.name}</span><span class="tab-kind">${p.kind}</span>`;
      btn.addEventListener("click", () => selectProject(p.id));
      els.tabs.appendChild(btn);
    });
  }

  function renderStatus(p) {
    els.status.textContent = p.status;
    els.status.className = "rail-status " + (p.statusTone || "");
  }

  /* ---------- 候选预览（三种产物形态） ---------- */
  function regionBlock(name, inner) {
    return `<div data-region="${name}"><span class="region-tag">${name}</span>${inner}</div>`;
  }

  function renderPreview(p) {
    const pv = p.preview;
    if (!pv) {
      els.stagePreview.innerHTML = "";
      els.stagePreview.hidden = true;
      els.stageEmpty.hidden = false;
      return;
    }
    els.stagePreview.hidden = false;
    els.stageEmpty.hidden = true;

    if (pv.type === "web") {
      const swatches = pv.palette
        .map((c) => `<span class="pv-swatch" style="background:${c}"></span>`)
        .join("");
      els.stagePreview.innerHTML = `
        <div class="pv-web">
          ${regionBlock("首屏主视觉", `
            <div class="pv-hero">
              <div class="pv-kicker">${pv.kicker}</div>
              <h3 data-region="标题文案">${pv.headline}</h3>
              <span class="pv-cta">${pv.cta}</span>
            </div>`)}
          <div class="pv-cols">
            ${regionBlock("产品列表", `<h4>${pv.colA.title}</h4><p>${pv.colA.text}</p>`)}
            ${regionBlock("品牌故事", `<h4>${pv.colB.title}</h4><p>${pv.colB.text}</p>`)}
          </div>
          ${regionBlock("配色", `<div style="margin-top:14px">${swatches}<span style="font-size:12px;color:var(--muted)">当前色板</span></div>`)}
        </div>`;
    } else if (pv.type === "deck") {
      const regionNames = ["封面页", "数据页", "结尾页"];
      els.stagePreview.innerHTML = `
        <div class="pv-deck">
          ${pv.slides.map((s, i) => `
            <div class="pv-slide" data-region="${regionNames[i] || "第 " + s.n + " 页"}">
              <span class="n">${s.n}</span>
              <span class="t">${s.t}</span>
              <span class="bar ${s.bar}"></span>
            </div>`).join("")}
        </div>`;
    } else if (pv.type === "doc") {
      els.stagePreview.innerHTML = `
        <div class="pv-doc">
          ${regionBlock("文档封面", `<h4>${pv.title}</h4><div class="doc-ed">${pv.edition}</div>`)}
          ${regionBlock("排版规则", pv.paras.map((t) => `<p>${t}</p>`).join("") + `<div class="rule-line">${pv.ruleLine}</div>`)}
          ${regionBlock("组件清单", `<p>组件状态命名、禁用示例清单（略）——点此区块可对它提局部批注。</p>`)}
        </div>`;
    }

    /* 点选预览区块 = 帮局部反馈定位 */
    els.stagePreview.querySelectorAll("[data-region]").forEach((node) => {
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        const name = node.getAttribute("data-region");
        const opt = [...els.localRegion.options].find((o) => o.value === name);
        if (opt) els.localRegion.value = name;
        els.stagePreview.querySelectorAll("[data-region]").forEach((n) => n.classList.remove("region-picked"));
        node.classList.add("region-picked");
        toast(`已定位到「${name}」，在下面写这一处的批注`);
        document.querySelector('[data-oey-section="feedback-local"]').scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  /* ---------- 各站点渲染 ---------- */
  function renderStage(p) {
    els.stageTitle.textContent = p.name;
    els.stageBrief.textContent = p.brief;
    els.stageRevision.textContent = p.revision.no > 0 ? `REVISION ${String(p.revision.no).padStart(2, "0")}` : "尚无候选";
    els.stageNote.textContent = p.revision.note + " · " + p.revision.updatedAt;
    renderPreview(p);
  }

  function renderLocalRegions(p) {
    els.localRegion.innerHTML = "";
    if (!p.regions.length) {
      els.localRegion.innerHTML = `<option value="">（还没有可批注的内容）</option>`;
      els.localRegion.disabled = true;
      return;
    }
    els.localRegion.disabled = false;
    p.regions.forEach((r) => {
      const o = document.createElement("option");
      o.value = r;
      o.textContent = r;
      els.localRegion.appendChild(o);
    });
  }

  function renderLoop(p) {
    els.loopCount.textContent = `· ${p.events.length} 步`;
    els.loopList.innerHTML = "";
    p.events.forEach((ev, i) => {
      const li = document.createElement("li");
      const fresh = state.freshEvents > 0 && i >= p.events.length - state.freshEvents;
      li.className = "loop-item" + (fresh ? " fresh" : "");
      li.innerHTML = `
        <span class="t">${ev.t}</span>
        <span class="actor ${ev.actor}">${ACTOR_LABEL[ev.actor] || ev.actor}</span>
        <span class="text">${ev.text}</span>`;
      els.loopList.appendChild(li);
    });
    state.freshEvents = 0;
  }

  function renderConstraints(p) {
    els.constraintPreset.textContent = p.preset;
    els.constraintRole.textContent = p.templateRole;
    els.constraintTone.textContent = p.constraints.tone;
    els.constraintPalette.textContent = p.constraints.palette;
    els.constraintRules.innerHTML = p.constraints.rules.map((r) => `<li>${r}</li>`).join("");
  }

  function renderQuality(p) {
    const hard = p.quality.hard;
    if (hard.length > 0) {
      els.qualityVerdict.textContent = `交付闸门：关闭 · ${hard.length} 个硬错误待处理`;
      els.qualityVerdict.className = "gate closed";
    } else {
      els.qualityVerdict.textContent = "交付闸门：开放 · 无硬错误";
      els.qualityVerdict.className = "gate open";
    }
    els.qualityHard.innerHTML = hard.length
      ? hard.map((h) => `<li><span class="code">${h.code}</span>${h.text}</li>`).join("")
      : `<li class="none">没有硬错误。</li>`;
    els.qualityAesthetic.innerHTML = p.quality.aesthetic.length
      ? p.quality.aesthetic.map((a) => `<li>${a}</li>`).join("")
      : `<li class="none">暂无审美发现。</li>`;
  }

  function renderDelivery(p) {
    const d = p.delivery;
    els.deliveryStatus.textContent = d.note;
    els.deliveryStatus.className = "delivery-status " + d.state;
    els.deliveryList.innerHTML = d.records.length
      ? d.records.map((r) => `<li><span>${r.text}</span><span class="when">${r.t}</span></li>`).join("")
      : `<li class="empty-note">还没有导出过任何文件。</li>`;
  }

  function renderDetail(p) {
    renderStatus(p);
    renderStage(p);
    renderLocalRegions(p);
    renderLoop(p);
    renderConstraints(p);
    renderQuality(p);
    renderDelivery(p);
    els.spine.classList.remove("fade-in");
    void els.spine.offsetWidth;
    els.spine.classList.add("fade-in");
  }

  /* ---------- 交互 ---------- */
  async function selectProject(id) {
    if (id === state.currentId && state.detail) return;
    state.currentId = id;
    renderRail();
    els.status.textContent = "载入中…";
    els.status.className = "rail-status";
    state.detail = await api.getProject(id);
    renderDetail(state.detail);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pickChipGroup(container, cb) {
    container.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      container.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
      cb(chip);
    });
  }

  pickChipGroup(els.directionChips, (chip) => {
    els.directionInput.value = chip.getAttribute("data-preset");
    els.directionInput.focus();
  });

  els.directionSubmit.addEventListener("click", async () => {
    const text = els.directionInput.value.trim();
    if (!text) { toast("先写一句：这个方向哪里不对"); return; }
    if (!state.detail) return;
    els.directionSubmit.disabled = true;
    const before = state.detail.events.length;
    const res = await api.submitDirectionFeedback(state.currentId, text);
    els.directionSubmit.disabled = false;
    state.detail = res.project;
    state.freshEvents = res.project.events.length - before;
    els.directionInput.value = "";
    els.directionChips.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
    syncSummary(res.project);
    renderDetail(res.project);
    toast(res.message);
  });

  els.localSubmit.addEventListener("click", async () => {
    const region = els.localRegion.value;
    const text = els.localInput.value.trim();
    if (!region) { toast("这个项目还没有可批注的区块"); return; }
    if (!text) { toast("写一句：这一处想怎么改"); return; }
    els.localSubmit.disabled = true;
    const before = state.detail.events.length;
    const res = await api.submitLocalFeedback(state.currentId, region, text);
    els.localSubmit.disabled = false;
    state.detail = res.project;
    state.freshEvents = res.project.events.length - before;
    els.localInput.value = "";
    document.querySelectorAll("[data-region]").forEach((n) => n.classList.remove("region-picked"));
    syncSummary(res.project);
    renderDetail(res.project);
    toast(res.message);
  });

  function syncSummary(p) {
    const s = state.projects.find((x) => x.id === p.id);
    if (s) { s.status = p.status; s.statusTone = p.statusTone; }
    renderRail();
  }

  /* ---------- 新案子弹层 ---------- */
  let npPresetVal = "开放探索";
  let npRoleVal = "参考样例";
  pickChipGroup(els.npPreset, (chip) => (npPresetVal = chip.getAttribute("data-val")));
  pickChipGroup(els.npRole, (chip) => (npRoleVal = chip.getAttribute("data-val")));

  $("#btnNewProject").addEventListener("click", () => {
    els.modalMask.hidden = false;
    els.npName.value = "";
    els.npName.focus();
  });
  $("#npCancel").addEventListener("click", () => (els.modalMask.hidden = true));
  els.modalMask.addEventListener("click", (e) => {
    if (e.target === els.modalMask) els.modalMask.hidden = true;
  });
  $("#npSubmit").addEventListener("click", async () => {
    const name = els.npName.value.trim();
    if (!name) { toast("给案子起个名字"); return; }
    const res = await api.createProject({ name, preset: npPresetVal, role: npRoleVal });
    els.modalMask.hidden = true;
    state.projects.push({
      id: res.project.id, name: res.project.name, kind: res.project.kind,
      status: res.project.status, statusTone: res.project.statusTone
    });
    toast(res.message);
    state.currentId = null; /* 强制重新载入 */
    await selectProject(res.project.id);
  });

  /* ---------- 启动 ---------- */
  (async function init() {
    state.projects = await api.listProjects();
    renderRail();
    if (state.projects.length) await selectProject(state.projects[0].id);
  })();
})();
