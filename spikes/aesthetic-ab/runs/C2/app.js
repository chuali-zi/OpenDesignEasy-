/* =========================================================
   OEYdesign Studio · 前端 Mock 交互
   无后端：消息、版本、导出、对象级反馈全部本地模拟
   ========================================================= */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

/* ---------------- 全局状态 ---------------- */
const state = {
  version: 3,
  maxVersion: 3,
  mode: 'web',           // web | ppt | docx
  selected: null,        // { el, label, path }
  busy: false
};

/* ---------------- 版本数据 ---------------- */
const DARK_HERO = 'bg-gradient-to-br from-neutral-900 via-neutral-800 to-amber-950';
const VERSIONS = {
  1: {
    title: '一杯山野，清醒一整天',
    sub: '云南高海拔产区直采，低温慢萃，保留完整花果香气。',
    heroCls: 'bg-gradient-to-br from-emerald-50 via-white to-amber-50',
    titleCls: 'text-neutral-900',
    subCls: 'text-neutral-600',
    badgeCls: 'bg-emerald-100 text-emerald-800',
    ctaCls: 'bg-emerald-600 text-white hover:bg-emerald-700',
    ghostCls: 'text-emerald-800 hover:bg-emerald-100/60',
    statsCls: 'text-neutral-900'
  },
  2: {
    title: '从产地到杯中，72 小时',
    sub: '深烘焙基调 · 冷萃工艺全程可视：苦感更低，回甘更长。',
    heroCls: DARK_HERO,
    titleCls: 'text-white',
    subCls: 'text-neutral-300',
    badgeCls: 'bg-white/10 text-amber-300 ring-1 ring-white/20',
    ctaCls: 'bg-amber-500 text-neutral-900 hover:bg-amber-400',
    ghostCls: 'text-neutral-300 hover:bg-white/10',
    statsCls: 'text-white'
  },
  3: {
    title: '山野咖啡，把清晨还给你',
    sub: '卖点前置 · 价格锚点 ¥89/盒 · 首单立减 20 元，今晚截止。',
    heroCls: DARK_HERO,
    titleCls: 'text-white',
    subCls: 'text-neutral-300',
    badgeCls: 'bg-white/10 text-amber-300 ring-1 ring-white/20',
    ctaCls: 'bg-amber-500 text-neutral-900 hover:bg-amber-400',
    ghostCls: 'text-neutral-300 hover:bg-white/10',
    statsCls: 'text-white'
  }
};
const GEN_TITLES = ['清晨第一杯，交给山野', '慢一点，把咖啡喝明白', '把山野，装进口袋'];

/* ---------------- 工具 ---------------- */
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg) {
  const root = $('#toast-root');
  const t = document.createElement('div');
  t.className = 'toast-in pointer-events-auto flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-xl ring-1 ring-white/10';
  t.innerHTML = '<svg class="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' + escapeHtml(msg);
  root.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(6px)';
    setTimeout(() => t.remove(), 320);
  }, 2600);
}

/* ---------------- 版本应用 ---------------- */
function setCls(id, cls) {
  const el = document.getElementById(id);
  el.className = el.dataset.base + ' ' + cls;
}

function applyVersion(v, animate = true) {
  const d = VERSIONS[v];
  if (!d) return;
  state.version = v;

  setCls('web-hero', d.heroCls);
  const title = $('#hero-title');
  title.textContent = d.title;
  setCls('hero-title', d.titleCls);
  const sub = $('#hero-sub');
  sub.textContent = d.sub;
  setCls('hero-sub', d.subCls);
  setCls('hero-badge', d.badgeCls);
  setCls('hero-cta', d.ctaCls);
  setCls('hero-ghost', d.ghostCls);
  setCls('hero-stats', d.statsCls);

  renderVersionPills();
  renderStatus();

  if (animate) {
    const wrap = $('#artifact-wrap');
    wrap.classList.remove('fade-swap');
    void wrap.offsetWidth;
    wrap.classList.add('fade-swap');
  }
}

function renderVersionPills() {
  const wrap = $('#version-pills');
  wrap.innerHTML = '';
  for (let i = 1; i <= state.maxVersion; i++) {
    const b = document.createElement('button');
    b.className = 'h-7 rounded-md px-2.5 text-xs font-medium transition ' + (
      i === state.version
        ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200'
        : 'text-neutral-500 hover:text-neutral-900'
    );
    b.textContent = 'v' + i;
    b.onclick = () => { setMode('web'); applyVersion(i); };
    wrap.appendChild(b);
  }
}

function renderStatus() {
  const pill = $('#status-pill');
  const isCur = state.version === state.maxVersion;
  pill.className = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ' + (
    isCur ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-neutral-100 text-neutral-500 ring-neutral-200'
  );
  pill.innerHTML = '<span class="h-1.5 w-1.5 rounded-full ' + (isCur ? 'bg-amber-500' : 'bg-neutral-400') + '"></span>' +
    'v' + state.version + ' · ' + (isCur ? '待确认' : '历史版本');
}

function createVersion() {
  state.maxVersion += 1;
  const n = state.maxVersion;
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  VERSIONS[n] = Object.assign({}, VERSIONS[3], {
    title: GEN_TITLES[(n - 4) % GEN_TITLES.length],
    sub: '基于你的反馈迭代 · ' + time + ' 自动生成'
  });
  applyVersion(n);
  return n;
}

/* ---------------- 产物模式切换 ---------------- */
function setMode(mode) {
  state.mode = mode;
  ['web', 'ppt', 'docx'].forEach((m) => {
    document.getElementById('artifact-' + m).classList.toggle('hidden', m !== mode);
  });
  $$('#mode-tabs [data-mode]').forEach((b) => {
    const active = b.dataset.mode === mode;
    b.className = 'flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ' + (
      active ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200' : 'text-neutral-500 hover:text-neutral-800'
    );
  });
  clearSelection();
}

/* ---------------- 对象级选择 / 反馈 ---------------- */
function clearSelection() {
  $$('#canvas .oey-selected').forEach((el) => {
    el.classList.remove('oey-selected', 'ring-2', 'ring-brand-500', 'ring-offset-2', 'relative');
  });
  $$('#canvas .oey-sel-tag').forEach((el) => el.remove());
  state.selected = null;
  $('#sel-chip').classList.add('hidden');
  renderInspector();
}

function selectObject(el) {
  clearSelection();
  el.classList.add('oey-selected', 'ring-2', 'ring-brand-500', 'ring-offset-2', 'relative');
  const tag = document.createElement('div');
  tag.className = 'oey-sel-tag absolute -top-2.5 left-3 z-10 inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-0.5 text-[10px] font-medium text-white shadow-md';
  tag.innerHTML = '<svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>' + escapeHtml(el.dataset.oeyLabel);
  el.appendChild(tag);

  state.selected = { el, label: el.dataset.oeyLabel, path: el.dataset.oeyObject };
  $('#sel-chip-label').textContent = el.dataset.oeyLabel;
  $('#sel-chip').classList.remove('hidden');
  renderInspector();
}

function renderInspector() {
  const bar = $('#inspector');
  if (!state.selected) {
    bar.innerHTML =
      '<svg class="h-3.5 w-3.5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="M5.1 8 2.2 7.2"/><path d="M14 4.1 12 6"/><path d="m6 12-1.9 2"/></svg>' +
      '<span class="text-neutral-400">点击画布中的任意区块，可进行<b class="text-neutral-600">对象级反馈</b>（引用、圈改、重生成）</span>' +
      '<span class="ml-auto text-neutral-300">data-oey-section="canvas"</span>';
    return;
  }
  bar.innerHTML =
    '<span class="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 font-medium text-brand-700 ring-1 ring-brand-200">' +
      '<span class="h-1.5 w-1.5 rounded-full bg-brand-500"></span>' + escapeHtml(state.selected.label) + '</span>' +
    '<code class="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">data-oey-object="' + escapeHtml(state.selected.path) + '"</code>' +
    '<button id="insp-quote" class="rounded-md border border-neutral-200 px-2 py-1 font-medium text-neutral-600 shadow-sm hover:bg-neutral-50 transition">引用到对话</button>' +
    '<button id="insp-clear" class="rounded-md px-2 py-1 text-neutral-400 hover:text-neutral-700 transition">取消选中</button>';
  $('#insp-quote').onclick = () => $('#composer-input').focus();
  $('#insp-clear').onclick = clearSelection;
}

/* ---------------- 对话 ---------------- */
function scrollChat() {
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function appendUser(text) {
  const div = document.createElement('div');
  div.dataset.oeyObject = 'message';
  div.className = 'msg-in flex flex-col items-end';
  const bubble = document.createElement('div');
  bubble.className = 'max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutral-900 px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-sm';
  bubble.textContent = text;
  const time = document.createElement('span');
  time.className = 'mt-1 text-[10px] text-neutral-400';
  time.textContent = nowTime();
  div.appendChild(bubble);
  div.appendChild(time);
  $('#messages').appendChild(div);
  scrollChat();
}

function artifactCardHTML(opts) {
  if (!opts) return '';
  const label = opts.mode === 'ppt' ? '演示文稿 · 8 页' : opts.mode === 'docx' ? '文档 · 6 页' : '网页 · 5 个区块';
  const icon = opts.mode === 'ppt'
    ? '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m9 21 3-3 3 3"/>'
    : opts.mode === 'docx'
      ? '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'
      : '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>';
  return (
    '<div class="mt-2.5 flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">' +
      '<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-600">' +
        '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>' +
      '</div>' +
      '<div class="min-w-0 flex-1">' +
        '<div class="truncate text-[13px] font-medium">' + escapeHtml(opts.title || '山野咖啡 · 品牌落地页') + '</div>' +
        '<div class="text-[11px] text-neutral-500">' + label + (opts.version ? ' · v' + opts.version : '') + '</div>' +
      '</div>' +
      '<button data-goto-version="' + (opts.version || state.version) + '" data-goto-mode="' + (opts.mode || 'web') + '" class="shrink-0 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 shadow-sm transition hover:bg-neutral-50">查看</button>' +
    '</div>'
  );
}

function appendAgent(html, cardOpts) {
  const div = document.createElement('div');
  div.dataset.oeyObject = 'message';
  div.className = 'msg-in flex gap-2.5';
  div.innerHTML =
    '<div class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700">' +
      '<svg class="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/></svg>' +
    '</div>' +
    '<div class="min-w-0 flex-1">' +
      '<div class="rounded-2xl rounded-tl-md border border-neutral-200 bg-white px-3.5 py-3 text-sm leading-relaxed shadow-sm">' +
        html + artifactCardHTML(cardOpts) +
      '</div>' +
      '<span class="mt-1 block text-[10px] text-neutral-400">' + nowTime() + ' · 耗时 ' + (6 + Math.floor(Math.random() * 8)) + 's</span>' +
    '</div>';
  $('#messages').appendChild(div);
  scrollChat();
}

let typingEl = null;
function showTyping() {
  typingEl = document.createElement('div');
  typingEl.className = 'msg-in flex gap-2.5';
  typingEl.innerHTML =
    '<div class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700">' +
      '<svg class="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/></svg>' +
    '</div>' +
    '<div class="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-neutral-200 bg-white px-4 py-3.5 shadow-sm">' +
      '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>' +
    '</div>';
  $('#messages').appendChild(typingEl);
  scrollChat();
}
function hideTyping() {
  if (typingEl) { typingEl.remove(); typingEl = null; }
}

/* ---------------- Agent 回复策略（mock） ---------------- */
function respond(text) {
  const t = text.toLowerCase();

  if (/ppt|演示|路演|幻灯/.test(t)) {
    setMode('ppt');
    appendAgent(
      '<p>已基于当前 <b>v' + state.version + '</b> 视觉规范生成 <b>路演 PPT 初稿（8 页）</b>：封面 / 市场机会 / 产品工艺 / 视觉规范 / 页面结构 / 定价 / 增长计划 / 封底。右侧已切到「演示文稿」视图，点击幻灯片任意区域可单独提反馈。</p>',
      { mode: 'ppt', title: '山野咖啡 · 品牌路演' }
    );
    return;
  }

  if (/docx|文档|word|方案/.test(t)) {
    setMode('docx');
    appendAgent(
      '<p>已把本次设计决策整理为 <b>品牌方案文档（6 页）</b>：项目背景、视觉规范（含色板）、页面结构、文案稿、导出与部署说明。右侧已切到「文档」视图。</p>',
      { mode: 'docx', title: '山野咖啡品牌方案' }
    );
    return;
  }

  if (/导出|下载|交付/.test(t)) {
    appendAgent(
      '<p>可以。右上角「导出」支持 <b>PNG / PDF / HTML 代码 / PPTX / DOCX</b> 五种格式。已为你预生成 v' + state.version + ' 的 PDF 提案，HTML 代码包可直接部署到静态托管。</p>'
    );
    toast('PDF 提案已生成（mock）');
    return;
  }

  // 针对选中对象的反馈
  if (state.selected) {
    const label = state.selected.label;
    const n = createVersion();
    const chipEscaped = escapeHtml(text.length > 40 ? text.slice(0, 40) + '…' : text);
    appendAgent(
      '<p>已记录对 <span class="rounded bg-brand-50 px-1.5 py-0.5 text-[13px] font-medium text-brand-700 ring-1 ring-brand-200">' + escapeHtml(label) + '</span> 的反馈：“' + chipEscaped + '”。</p>' +
      '<p class="mt-1.5">处理方式：仅重生成该区块，其余区块与 v' + (n - 1) + ' 保持一致，避免全局漂移。已生成 <b>v' + n + '</b>，可用版本键对比差异。</p>',
      { mode: 'web', version: n }
    );
    clearSelection();
    return;
  }

  // 通用修改 → 生成新版本
  const n = createVersion();
  appendAgent(
    '<p>收到。我的理解：在现有深色方向上继续收敛文案与节奏。已生成 <b>v' + n + '</b>：</p>' +
    '<ul class="mt-1.5 space-y-1 text-neutral-600">' +
      '<li class="flex gap-1.5"><span class="text-brand-500">·</span>首屏标题替换为更短的行动句式</li>' +
      '<li class="flex gap-1.5"><span class="text-brand-500">·</span>保留 v3 的卖点前置与价格锚点结构</li>' +
    '</ul>' +
    '<p class="mt-2 text-neutral-600">右侧已自动切换到新版本，可点 v1–v' + n + ' 对比历史。</p>',
    { mode: 'web', version: n }
  );
}

/* ---------------- 发送 ---------------- */
function sendMessage() {
  const input = $('#composer-input');
  const text = input.value.trim();
  if (!text || state.busy) return;

  appendUser(text);
  input.value = '';
  input.style.height = 'auto';
  state.busy = true;
  showTyping();

  setTimeout(() => {
    hideTyping();
    respond(text);
    state.busy = false;
  }, 900 + Math.random() * 700);
}

/* ---------------- 事件绑定 ---------------- */
document.addEventListener('DOMContentLoaded', () => {

  // 初始化版本与状态
  applyVersion(3, false);
  renderInspector();
  setMode('web');

  // 发送
  $('#send-btn').addEventListener('click', sendMessage);
  const input = $('#composer-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });

  // 建议 chips
  $$('.suggest-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      input.value = chip.textContent.trim();
      sendMessage();
    });
  });

  // 模式 tabs
  $$('#mode-tabs [data-mode]').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });

  // 画布对象选择（事件委托）
  $('#canvas').addEventListener('click', (e) => {
    const obj = e.target.closest('[data-oey-object]');
    if (!obj) return;
    if (state.selected && state.selected.el === obj) {
      clearSelection();
      return;
    }
    selectObject(obj);
  });

  // 对话中卡片"查看"按钮（事件委托）
  $('#messages').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-goto-version]');
    if (!btn) return;
    const mode = btn.dataset.gotoMode || 'web';
    setMode(mode);
    if (mode === 'web') applyVersion(parseInt(btn.dataset.gotoVersion, 10));
    toast('已切换到 ' + (mode === 'ppt' ? '演示文稿' : mode === 'docx' ? '文档' : 'v' + btn.dataset.gotoVersion + ' 预览'));
  });

  // 取消选中 chip
  $('#sel-chip-x').addEventListener('click', clearSelection);

  // 导出菜单
  const exportBtn = $('#export-btn');
  const exportMenu = $('#export-menu');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!exportMenu.classList.contains('hidden') && !e.target.closest('#export-menu')) {
      exportMenu.classList.add('hidden');
    }
  });
  $$('#export-menu [data-export]').forEach((item) => {
    item.addEventListener('click', () => {
      exportMenu.classList.add('hidden');
      const modeName = state.mode === 'ppt' ? '品牌路演' : state.mode === 'docx' ? '品牌方案' : '落地页 v' + state.version;
      toast('已开始导出 ' + item.dataset.export + ' · ' + modeName + '（mock）');
    });
  });

  // 分享 / 帮助 / 历史 / 新对话
  $('#share-btn').addEventListener('click', () => toast('预览链接已复制到剪贴板（mock）'));
  $('#help-btn').addEventListener('click', () => toast('帮助中心（mock）'));
  $('#history-btn').addEventListener('click', () => toast('历史会话（mock）'));
  $('#new-chat-btn').addEventListener('click', () => toast('已创建新对话（mock）'));

  scrollChat();
});