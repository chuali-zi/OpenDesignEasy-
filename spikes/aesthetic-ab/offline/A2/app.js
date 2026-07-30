/* ═══════════ OEYdesign 工作台 · mock 交互层 ═══════════ */

/* ── 版本数据 ── */
const VERSIONS = [
  {
    id: 1, time: "10:24", note: "初版生成：米白底 + 深绿主色，Hero + 卖点卡片骨架。",
    title: "让每一杯，都值得等待",
    sub: "精品咖啡豆订阅，小批量烘焙，产地直送。<br>为认真对待早晨的人准备。",
    accent: "#2f6b4f", bg: "#f7f4ee", ink: "#22301f", card: "#fffdf8", line: "#e4ddcd"
  },
  {
    id: 2, time: "10:32", note: "主标题文案重写：从口号改为具象场景描写。",
    title: "晨光落进杯子之前，<br>豆子在锅里醒来",
    sub: "每周小批量烘焙，48 小时内从烘豆机直达你的滤杯。<br>这一杯的新鲜，以小时计。",
    accent: "#2f6b4f", bg: "#f7f4ee", ink: "#22301f", card: "#fffdf8", line: "#e4ddcd"
  },
  {
    id: 3, time: "10:39", note: "CTA 对比度修复（AAA）；卖点区确认三列栅格 + 悬停动效。当前版本。",
    title: "晨光落进杯子之前，<br>豆子在锅里醒来",
    sub: "每周小批量烘焙，48 小时内从烘豆机直达你的滤杯。<br>这一杯的新鲜，以小时计。",
    accent: "#245c42", bg: "#f7f4ee", ink: "#1e2c1b", card: "#fffdf8", line: "#ddd5c2"
  }
];
let versions = [...VERSIONS];
let currentVersion = 3;
let versionSeq = 3;

/* ── 对象元数据 ── */
const OBJECT_META = {
  "nav":               { name: "顶部导航",       type: "导航栏",   v: "v1", note: "含品牌 Logo 与四个栏目链接，吸顶行为未启用。" },
  "nav-logo":          { name: "品牌标识",       type: "文本 Logo", v: "v1", note: "字标组合，Accent 色用于 \"Coffee\" 部分。" },
  "nav-links":         { name: "导航链接组",     type: "链接组",   v: "v1", note: "四个锚点链接，移动端折叠为抽屉菜单。" },
  "hero-eyebrow":      { name: "眉题标签",       type: "文本",     v: "v1", note: "等宽字体 + 加宽字距，建立品类语境。" },
  "hero-title":        { name: "主标题",         type: "标题",     v: "v2", note: "v2 重写为场景化文案；当前字重 800 / 字距 -1。" },
  "hero-sub":          { name: "副标题",         type: "文本",     v: "v2", note: "两行结构：交付承诺 + 价值强化。" },
  "hero-cta-row":      { name: "CTA 按钮组",     type: "容器",     v: "v3", note: "主按钮实心 + 次按钮文字链，间距 14px。" },
  "hero-cta":          { name: "主 CTA 按钮",    type: "按钮",     v: "v3", note: "v3 修复对比度至 7.1（AAA），含悬停上浮。" },
  "hero-cta-secondary":{ name: "次 CTA 链接",    type: "链接",     v: "v3", note: "指向烘焙曲线说明页（占位）。" },
  "feature-card-1":    { name: "卖点卡 · 浅焙",  type: "卡片",     v: "v3", note: "三列栅格第 1 列。" },
  "feature-card-2":    { name: "卖点卡 · 鲜达",  type: "卡片",     v: "v3", note: "三列栅格第 2 列。" },
  "feature-card-3":    { name: "卖点卡 · 溯源",  type: "卡片",     v: "v3", note: "三列栅格第 3 列。" },
  "footer-copy":       { name: "版权信息",       type: "文本",     v: "v1", note: "含品牌 slogan 呼应。" },
  "footer-links":      { name: "社媒链接",       type: "链接组",   v: "v1", note: "三个社媒占位链接。" }
};

/* ── DOM 引用 ── */
const $ = (s) => document.querySelector(s);
const chatScroll = $("#chatScroll");
const chatForm = $("#chatForm");
const chatTextarea = $("#chatTextarea");
const sendBtn = $("#sendBtn");
const feedbackBar = $("#feedbackBar");
const feedbackTag = $("#feedbackTag");
const artifact = $("#artifact");
const artifactFrame = $("#artifactFrame");
const statusBadge = $("#statusBadge");
const statusText = $("#statusText");
const versionStrip = $("#versionStrip");

let selectedObject = null;   // 当前选中对象锚点
let agentBusy = false;

/* ═══ 工具函数 ═══ */
function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function scrollChat() { chatScroll.scrollTop = chatScroll.scrollHeight; }
function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  $("#toastRoot").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 2800);
}
function setStatus(status, text) {
  statusBadge.dataset.status = status;
  statusText.textContent = text;
}

/* ═══ 对话渲染 ═══ */
function appendMessage(role, html, feedbackRef = null) {
  const wrap = document.createElement("div");
  wrap.className = `msg msg-${role}`;
  const avatar = role === "user" ? "KC" : "Œ";
  wrap.innerHTML = `
    <div class="msg-avatar ${role}">${avatar}</div>
    <div class="msg-body">
      ${feedbackRef ? `<div class="msg-feedback-ref">◎ ${feedbackRef}</div>` : ""}
      <div class="msg-text">${html}</div>
      <div class="msg-time">${now()}</div>
    </div>`;
  chatScroll.appendChild(wrap);
  scrollChat();
  return wrap;
}
function appendTyping() {
  const wrap = document.createElement("div");
  wrap.className = "msg msg-agent";
  wrap.innerHTML = `<div class="msg-avatar agent">Œ</div>
    <div class="msg-body"><div class="msg-text"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
  chatScroll.appendChild(wrap);
  scrollChat();
  return wrap;
}

/* ═══ 版本管理 ═══ */
function renderVersionStrip() {
  versionStrip.innerHTML = "";
  versions.forEach(v => {
    const b = document.createElement("button");
    b.className = "v-chip" + (v.id === currentVersion ? " active" : "");
    b.textContent = `v${v.id}`;
    b.onclick = () => applyVersion(v.id, true);
    versionStrip.appendChild(b);
  });
}
function renderVersionsPanel() {
  const list = $("#versionsList");
  list.innerHTML = "";
  [...versions].reverse().forEach(v => {
    const item = document.createElement("div");
    item.className = "ver-item" + (v.id === currentVersion ? " active" : "");
    item.innerHTML = `
      <div class="ver-item-head"><b>v${v.id}</b><span>${v.time}</span></div>
      <p>${v.note}</p>`;
    item.onclick = () => { applyVersion(v.id, true); };
    list.appendChild(item);
  });
}
function applyVersion(id, announce) {
  const v = versions.find(x => x.id === id);
  if (!v) return;
  currentVersion = id;
  artifact.style.setProperty("--af-accent", v.accent);
  artifact.style.setProperty("--af-bg", v.bg);
  artifact.style.setProperty("--af-ink", v.ink);
  artifact.style.setProperty("--af-card", v.card);
  artifact.style.setProperty("--af-line", v.line);
  $("#afTitle").innerHTML = v.title;
  $("#afSub").innerHTML = v.sub;
  setStatus("done", `已完成 · v${id}`);
  renderVersionStrip();
  renderVersionsPanel();
  if (announce) toast(`已切换到 v${id}`, "info");
}
function createVersion(partial, note) {
  versionSeq += 1;
  const base = versions.find(v => v.id === currentVersion);
  const nv = { ...base, id: versionSeq, time: now(), note, ...partial };
  versions.push(nv);
  applyVersion(versionSeq, false);
  return nv;
}

/* ═══ Agent 模拟 ═══ */
function agentRespond(userText, feedbackRef) {
  agentBusy = true;
  sendBtn.disabled = true;
  setStatus("working", "生成中…");
  const typing = appendTyping();

  setTimeout(() => {
    typing.remove();
    const lower = userText.toLowerCase();
    let reply;

    if (/蓝|配色|颜色|色彩/.test(userText)) {
      const nv = createVersion(
        { accent: "#2b5f8f", bg: "#f3f5f8", ink: "#1c2a3a", card: "#ffffff", line: "#d8dfe8" },
        "配色方案调整：主色由深绿转为静谧蓝灰，整体气质更冷。"
      );
      reply = `收到。我把主色从深绿切换为静谧蓝灰 <code>#2B5F8F</code>，底色同步调成冷灰白，保持你要求的安静质感。已发布 <b>v${nv.id}</b>，右侧可实时查看；不满意随时让我回滚。`;
    } else if (/标题|文案|slogan/i.test(userText)) {
      reply = `关于主标题，我准备了两个备选方向：<br>1. 「把山谷的早晨，烘进这一支豆子」（产地叙事）<br>2. 「慢下来的人，先喝到春天」（人群情绪）<br>告诉我偏好的话我直接替换并发新版本，或者点击右侧主标题给我更具体的反馈。`;
    } else if (/按钮|cta/i.test(lower)) {
      reply = `CTA 当前对比度 7.1，已通过 AAA。如果你想要更强的转化引导，我建议增加一个「首单立减 ¥20」的辅助标签，要我加上吗？`;
    } else if (/导出|ppt|docx|交付/.test(lower)) {
      reply = `当前 v${currentVersion} 已可交付。点击右上角「导出」即可获得 Web 静态包 / PPT 演示稿 / DOCX 品牌规范，三份产物会从同一设计源生成，样式保持一致。`;
    } else if (feedbackRef) {
      const meta = OBJECT_META[feedbackRef];
      const nv = createVersion({}, `对象级修改：${meta ? meta.name : feedbackRef} 已按反馈调整。`);
      reply = `已记录你对 <b>${meta ? meta.name : feedbackRef}</b> 的反馈：「${escapeHtml(userText)}」。我按这个方向做了调整并发布 <b>v${nv.id}</b>，预览区已更新。如果偏差较大，可以继续点选该对象补充说明。`;
    } else {
      reply = `明白，我记下了：「${escapeHtml(userText)}」。两个推进方式供你选：<br>1. 我直接按这个理解改一版，发布 v${versionSeq + 1}；<br>2. 你点击预览里的具体元素做对象级反馈，我改得更精准。<br>你倾向哪种？`;
    }

    appendMessage("agent", reply);
    setStatus("done", `已完成 · v${currentVersion}`);
    agentBusy = false;
    sendBtn.disabled = false;
  }, 1100 + Math.random() * 700);
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* ═══ 发送消息 ═══ */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatTextarea.value.trim();
  if (!text || agentBusy) return;
  const ref = selectedObject;
  appendMessage("user", escapeHtml(text), ref);
  chatTextarea.value = "";
  chatTextarea.style.height = "auto";
  clearFeedbackTarget();
  agentRespond(text, ref);
});
chatTextarea.addEventListener("input", () => {
  chatTextarea.style.height = "auto";
  chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 120) + "px";
});
chatTextarea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatForm.requestSubmit(); }
});

/* ═══ 对象选择 & 对象级反馈 ═══ */
artifact.addEventListener("click", (e) => {
  const obj = e.target.closest("[data-oey-object]");
  clearSelection();
  if (!obj) { renderInspector(null); return; }
  const anchor = obj.dataset.oeyObject;
  selectedObject = anchor;
  obj.classList.add("oey-selected");
  openPanel("inspectorPanel");
  renderInspector(anchor);
  showFeedbackTarget(anchor);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { clearSelection(); closeAllPanels(); clearFeedbackTarget(); }
});
function clearSelection() {
  artifact.querySelectorAll(".oey-selected").forEach(el => el.classList.remove("oey-selected"));
  selectedObject = null;
}
function showFeedbackTarget(anchor) {
  feedbackTag.textContent = anchor;
  feedbackBar.hidden = false;
  chatTextarea.placeholder = "对该对象提出修改意见，Enter 发送…";
  chatTextarea.focus();
}
function clearFeedbackTarget() {
  feedbackBar.hidden = true;
  chatTextarea.placeholder = "描述你的修改想法，或点击右侧元素进行对象级反馈…";
  clearSelection();
}
$("#feedbackClose").onclick = clearFeedbackTarget;
$("#btnFeedbackFromInsp").onclick = () => { if (selectedObject) { showFeedbackTarget(selectedObject); } };

/* 检查器渲染 */
function renderInspector(anchor) {
  const empty = $("#inspectorEmpty");
  const content = $("#inspectorContent");
  if (!anchor || !OBJECT_META[anchor]) {
    empty.hidden = false; content.hidden = true; return;
  }
  const m = OBJECT_META[anchor];
  empty.hidden = true; content.hidden = false;
  $("#inspAnchor").textContent = anchor;
  $("#inspType").textContent = m.type;
  $("#inspName").textContent = m.name;
  $("#inspVersion").textContent = m.v;
  $("#inspNote").textContent = m.note;
}

/* ═══ 面板管理（抽屉，非第三栏） ═══ */
function openPanel(id) {
  const target = $("#" + id);
  const wasHidden = target.hidden;
  closeAllPanels();
  if (wasHidden) target.hidden = false;
}
function closeAllPanels() {
  $("#versionsPanel").hidden = true;
  $("#inspectorPanel").hidden = true;
}
document.querySelectorAll("[data-close-panel]").forEach(btn => {
  btn.onclick = () => { $("#" + btn.dataset.closePanel).hidden = true; };
});
$("#btnVersions").onclick = () => { renderVersionsPanel(); openPanel("versionsPanel"); };
$("#btnInspector").onclick = () => openPanel("inspectorPanel");

/* ═══ 设备切换 & 缩放 ═══ */
document.querySelectorAll(".device-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".device-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    artifactFrame.className = "artifact-frame device-" + btn.dataset.device;
    applyZoom();
  };
});
$("#zoomSelect").onchange = applyZoom;
function applyZoom() {
  const z = $("#zoomSelect").value;
  if (z === "fit") { artifactFrame.style.transform = ""; return; }
  const ratio = parseInt(z, 10) / 100;
  artifactFrame.style.transform = `scale(${ratio})`;
}

/* ═══ 导出 ═══ */
const exportMenu = $("#exportMenu");
$("#btnExport").onclick = (e) => { e.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; };
document.addEventListener("click", (e) => {
  if (!e.target.closest(".export-wrap")) exportMenu.hidden = true;
});
exportMenu.querySelectorAll("[data-export]").forEach(btn => {
  btn.onclick = () => {
    exportMenu.hidden = true;
    const kind = btn.dataset.export;
    const label = { web: "Web 静态站点包", ppt: "PPT 演示文稿", docx: "DOCX 品牌规范" }[kind];
    setStatus("working", "导出中…");
    setTimeout(() => {
      setStatus("done", `已完成 · v${currentVersion}`);
      toast(`✓ ${label} 已生成（v${currentVersion} · mock）`);
      appendMessage("agent", `已基于 v${currentVersion} 生成 <b>${label}</b>，下载任务已加入队列。三种格式的产物共享同一设计源，视觉保持一致。`);
    }, 900);
  };
});

/* ═══ 对话中的版本跳转 chips ═══ */
chatScroll.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-goto-version]");
  if (chip) applyVersion(parseInt(chip.dataset.gotoVersion, 10), true);
});

/* ═══ 初始化 ═══ */
renderVersionStrip();
renderVersionsPanel();
applyVersion(3, false);
setTimeout(() => {
  appendMessage("agent", `👋 欢迎回来。当前产物停在 <b>v3</b>，已通过可访问性检查。你可以继续用自然语言提需求，或直接点击右侧画布中的元素做对象级反馈——改完随时可以一键导出 Web / PPT / DOCX。`);
}, 600);