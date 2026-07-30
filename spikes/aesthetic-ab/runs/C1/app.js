/* =====================================================
 * OEYdesign 工作台 · 纯前端 Mock
 * 数据流：versions[] → renderArtifact() → 画布
 * 交互：对话 / 对象级反馈 / 版本切换 / 导出 全部本地跑通
 * ===================================================== */

/* ---------- 调色板 ---------- */
const PALETTES = {
  indigo:  { name: '靛蓝',   main: '#6366f1', dark: '#4f46e5', soft: '#eef2ff' },
  emerald: { name: '翡翠绿', main: '#10b981', dark: '#059669', soft: '#ecfdf5' },
  amber:   { name: '琥珀橙', main: '#f59e0b', dark: '#d97706', soft: '#fffbeb' },
  rose:    { name: '玫瑰红', main: '#f43f5e', dark: '#e11d48', soft: '#fff1f2' },
};
const PALETTE_ORDER = ['indigo', 'emerald', 'amber', 'rose'];

/* ---------- 文案池（用于“改写文案” mock） ---------- */
const COPY_POOL = {
  'hero.title': [
    '让团队协作，自动流转',
    '工作流，像流水一样顺畅',
    '把重复交给机器，把创造还给团队',
    '一个中枢，调度整个团队的工作流',
  ],
  'hero.sub': [
    'FlowDock 把分散在聊天、表格与邮件里的任务，编排成可视化的自动化流水线，远程团队也能像同处一室一样协作。',
    '无需写代码，用拖拽就能搭建跨工具的自动化流程。FlowDock 已帮助 2,000+ 远程团队每周节省 11 个小时。',
    '从需求到交付，每一步都有迹可循。FlowDock 让你的团队专注于创造，而不是追赶进度。',
  ],
  'hero.cta': ['免费开始使用', '立即免费体验', '开启 14 天试用', '创建我的第一个流程'],
};

/* ---------- 静态内容 ---------- */
const FEATURES = [
  { icon: '⚡', title: '可视化流程编排', desc: '拖拽节点即可串联审批、通知与数据同步，流程逻辑一目了然。' },
  { icon: '🔗', title: '120+ 工具集成', desc: 'Slack、飞书、Notion、Jira 开箱即连，数据在工具间自由流动。' },
  { icon: '📊', title: '实时效能看板', desc: '每个流程的耗时、阻塞点自动汇总，让协作瓶颈无处遁形。' },
];
const PLANS = [
  { name: 'Starter', price: '¥0', unit: '/人/月', feats: ['3 条自动化流程', '基础集成', '社区支持'], hot: false },
  { name: 'Pro', price: '¥68', unit: '/人/月', feats: ['无限流程', '全部 120+ 集成', '效能看板', '优先支持'], hot: true },
  { name: 'Enterprise', price: '定制', unit: '', feats: ['SSO / 审计日志', '私有化部署', '专属客户成功'], hot: false },
];

/* ---------- 版本快照 ---------- */
const versions = [
  { v: 1, label: '初始生成', time: '10:12', data: { accent: 'indigo',  headline: COPY_POOL['hero.title'][0], sub: COPY_POOL['hero.sub'][0], cta: COPY_POOL['hero.cta'][0], big: false, testimonial: false } },
  { v: 2, label: '换主标题 + 绿色主色', time: '10:15', data: { accent: 'emerald', headline: COPY_POOL['hero.title'][1], sub: COPY_POOL['hero.sub'][0], cta: COPY_POOL['hero.cta'][1], big: false, testimonial: false } },
  { v: 3, label: '加入客户评价', time: '10:18', data: { accent: 'emerald', headline: COPY_POOL['hero.title'][1], sub: COPY_POOL['hero.sub'][0], cta: COPY_POOL['hero.cta'][1], big: false, testimonial: true } },
];

/* ---------- 全局状态 ---------- */
const state = {
  artifact: 'web',          // web | ppt | docx
  vIdx: versions.length - 1,
  device: 'desktop',
  zoom: 1,
  slide: 0,
  selected: null,           // 当前选中的 data-oey-object
};

/* ---------- DOM 引用 ---------- */
const $ = (s) => document.querySelector(s);
const chatScroll = $('#chatScroll');
const artifactWrap = $('#artifactWrap');
const artifactScaler = $('#artifactScaler');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const now = () => new Date().toTimeString().slice(0, 5);
const curData = () => versions[state.vIdx].data;

/* =====================================================
 * 画布渲染
 * ===================================================== */
function renderArtifact() {
  state.selected = null;
  hideInspector();
  const vd = curData();
  const p = PALETTES[vd.accent];
  artifactWrap.style.setProperty('--oey-accent', p.main);

  if (state.artifact === 'web') {
    artifactWrap.style.width = state.device === 'desktop' ? '1024px' : '390px';
    artifactWrap.innerHTML = renderWeb(vd, p);
  } else if (state.artifact === 'ppt') {
    artifactWrap.style.width = '1024px';
    artifactWrap.innerHTML = renderPPT(vd, p);
  } else {
    artifactWrap.style.width = '820px';
    artifactWrap.innerHTML = renderDocx(vd, p);
  }
  artifactScaler.style.transform = `scale(${state.zoom})`;
  $('#zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
  updateStats();
}

function renderWeb(vd, p) {
  const mobile = state.device === 'mobile';
  const hCls = vd.big
    ? (mobile ? 'text-4xl' : 'text-6xl lg:text-7xl')
    : (mobile ? 'text-3xl' : 'text-5xl lg:text-6xl');

  return `
  <div class="overflow-hidden rounded-2xl bg-white shadow-pop ring-1 ring-zinc-200" data-oey-section="page">
    <!-- 导航 -->
    <div data-oey-section="nav" class="flex items-center justify-between border-b border-zinc-100 px-8 py-4">
      <div class="flex items-center gap-2">
        <div class="flex h-7 w-7 items-center justify-center rounded-lg text-white text-xs font-bold" style="background:${p.main}">F</div>
        <span class="text-sm font-semibold tracking-tight">FlowDock</span>
      </div>
      ${mobile ? '' : `<div class="flex items-center gap-6 text-sm text-zinc-500">
        <span class="hover:text-zinc-900 cursor-pointer">产品</span><span class="hover:text-zinc-900 cursor-pointer">解决方案</span><span class="hover:text-zinc-900 cursor-pointer">定价</span><span class="hover:text-zinc-900 cursor-pointer">博客</span>
      </div>`}
      <button data-oey-object="nav.cta" data-oey-label="导航按钮" class="rounded-lg px-3.5 py-1.5 text-sm font-medium text-white" style="background:${p.main}">${esc(vd.cta)}</button>
    </div>

    <!-- Hero -->
    <div data-oey-section="hero" class="px-8 ${mobile ? 'py-12' : 'py-20'} text-center" style="background:linear-gradient(180deg, ${p.soft} 0%, #ffffff 85%)">
      <span data-oey-object="hero.badge" data-oey-label="Hero 徽标" class="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium ring-1 ring-inset" style="color:${p.dark}; --tw-ring-color:${p.main}33">
        ✨ FlowDock 2.0 现已发布
      </span>
      <h1 data-oey-object="hero.title" data-oey-label="Hero 主标题" class="mx-auto mt-5 max-w-3xl font-bold leading-tight tracking-tight text-zinc-900 ${hCls}">${esc(vd.headline)}</h1>
      <p data-oey-object="hero.sub" data-oey-label="Hero 副文案" class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-500">${esc(vd.sub)}</p>
      <div class="mt-8 flex ${mobile ? 'flex-col' : ''} items-center justify-center gap-3">
        <button data-oey-object="hero.cta" data-oey-label="主行动按钮" class="rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm" style="background:${p.main}">${esc(vd.cta)}</button>
        <button data-oey-object="hero.cta2" data-oey-label="次行动按钮" class="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-zinc-700 ring-1 ring-inset ring-zinc-200">▶ 观看 2 分钟演示</button>
      </div>
      <!-- 产品示意 -->
      <div data-oey-object="hero.visual" data-oey-label="Hero 产品图" class="mx-auto mt-12 max-w-2xl rounded-2xl bg-white p-4 text-left shadow-pop ring-1 ring-zinc-200">
        <div class="mb-3 flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-full bg-red-400"></span><span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span><span class="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
          <span class="ml-2 text-[10px] text-zinc-400 font-mono">flowdock.app/pipeline</span>
        </div>
        ${['需求收集 → 自动分派', '设计评审 → 飞书通知', '发布上线 → 数据归档'].map((t, i) => `
        <div class="mb-2 flex items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2.5 ring-1 ring-inset ring-zinc-100">
          <span class="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold text-white" style="background:${p.main}">${i + 1}</span>
          <span class="text-xs text-zinc-600">${t}</span>
          <span class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium" style="background:${p.soft}; color:${p.dark}">运行中</span>
        </div>`).join('')}
      </div>
    </div>

    <!-- Logo 墙 -->
    <div data-oey-section="logos" class="border-y border-zinc-100 px-8 py-8 text-center">
      <p class="text-xs font-medium uppercase tracking-widest text-zinc-400">深受 2,000+ 远程团队信赖</p>
      <div class="mt-4 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-lg font-semibold text-zinc-300">
        <span>Nordwind</span><span>Hexalab</span><span>量子猫</span><span>Driftly</span><span>山海科技</span>
      </div>
    </div>

    <!-- 功能 -->
    <div data-oey-section="features" class="px-8 py-16">
      <h2 class="text-center text-2xl font-bold tracking-tight">为远程协作而生的自动化</h2>
      <div class="mt-10 grid ${mobile ? 'grid-cols-1' : 'grid-cols-3'} gap-5">
        ${FEATURES.map((f, i) => `
        <div data-oey-object="features.card.${i + 1}" data-oey-label="功能卡片 · ${f.title}" class="rounded-2xl bg-zinc-50 p-6 ring-1 ring-inset ring-zinc-100 hover:ring-2 transition" style="--tw-ring-color:${p.main}55">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl text-lg" style="background:${p.soft}">${f.icon}</div>
          <h3 class="mt-4 text-sm font-semibold">${f.title}</h3>
          <p class="mt-1.5 text-xs leading-relaxed text-zinc-500">${f.desc}</p>
        </div>`).join('')}
      </div>
    </div>

    ${vd.testimonial ? `
    <!-- 客户评价 -->
    <div data-oey-section="testimonial" class="px-8 pb-16">
      <figure data-oey-object="testimonial.quote" data-oey-label="客户评价" class="mx-auto max-w-2xl rounded-2xl p-8 text-center ring-1 ring-inset" style="background:${p.soft}; --tw-ring-color:${p.main}33">
        <blockquote class="text-lg font-medium leading-relaxed text-zinc-800">“接入 FlowDock 之后，我们跨时区的交付周期缩短了 40%。它现在是团队里唯一一个没人愿意关掉的工具。”</blockquote>
        <figcaption class="mt-4 flex items-center justify-center gap-3">
          <span class="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white" style="background:${p.main}">陈</span>
          <span class="text-left"><span class="block text-sm font-semibold">陈默</span><span class="block text-xs text-zinc-500">Nordwind · 工程负责人</span></span>
        </figcaption>
      </figure>
    </div>` : ''}

    <!-- 定价 -->
    <div data-oey-section="pricing" class="border-t border-zinc-100 bg-zinc-50/60 px-8 py-16">
      <h2 class="text-center text-2xl font-bold tracking-tight">简单透明的定价</h2>
      <div class="mt-10 grid ${mobile ? 'grid-cols-1' : 'grid-cols-3'} gap-5">
        ${PLANS.map((pl, i) => `
        <div data-oey-object="pricing.card.${i + 1}" data-oey-label="定价卡 · ${pl.name}" class="relative rounded-2xl bg-white p-6 ${pl.hot ? 'shadow-pop ring-2' : 'ring-1 ring-inset ring-zinc-200'}" style="${pl.hot ? `--tw-ring-color:${p.main}` : ''}">
          ${pl.hot ? `<span class="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white" style="background:${p.main}">最受欢迎</span>` : ''}
          <h3 class="text-sm font-semibold">${pl.name}</h3>
          <p class="mt-3"><span class="text-3xl font-bold tracking-tight">${pl.price}</span><span class="text-xs text-zinc-400">${pl.unit}</span></p>
          <ul class="mt-4 space-y-2 text-xs text-zinc-600">
            ${pl.feats.map((f) => `<li class="flex items-center gap-2"><span style="color:${p.main}">✓</span>${f}</li>`).join('')}
          </ul>
          <button class="mt-5 w-full rounded-lg py-2 text-xs font-semibold ${pl.hot ? 'text-white' : 'text-zinc-700 ring-1 ring-inset ring-zinc-200'}" style="${pl.hot ? `background:${p.main}` : ''}">选择 ${pl.name}</button>
        </div>`).join('')}
      </div>
    </div>

    <!-- 页脚 -->
    <div data-oey-section="footer" class="flex ${mobile ? 'flex-col gap-3' : ''} items-center justify-between border-t border-zinc-100 px-8 py-6 text-xs text-zinc-400">
      <span>© 2024 FlowDock Inc.</span>
      <div class="flex gap-5"><span>隐私政策</span><span>服务条款</span><span>联系我们</span></div>
    </div>
  </div>`;
}

function renderPPT(vd, p) {
  const slides = [
    { t: '封面', body: `
      <div class="flex h-full flex-col items-center justify-center text-center text-white" style="background:linear-gradient(135deg, ${p.main}, ${p.dark})">
        <span class="rounded-full bg-white/15 px-3 py-1 text-xs">FlowDock 2.0 产品介绍</span>
        <h1 class="mt-6 text-5xl font-bold tracking-tight">${esc(vd.headline)}</h1>
        <p class="mt-4 max-w-lg text-sm text-white/80">${esc(vd.sub)}</p>
      </div>` },
    { t: '核心功能', body: `
      <div class="flex h-full flex-col bg-white p-12">
        <h2 class="text-3xl font-bold tracking-tight">核心功能</h2>
        <div class="mt-8 grid flex-1 grid-cols-3 gap-5">
          ${FEATURES.map((f) => `<div class="rounded-2xl bg-zinc-50 p-5 ring-1 ring-inset ring-zinc-100"><div class="text-2xl">${f.icon}</div><h3 class="mt-3 text-sm font-semibold">${f.title}</h3><p class="mt-1.5 text-xs leading-relaxed text-zinc-500">${f.desc}</p></div>`).join('')}
        </div>
      </div>` },
    { t: '定价方案', body: `
      <div class="flex h-full flex-col bg-white p-12">
        <h2 class="text-3xl font-bold tracking-tight">定价方案</h2>
        <div class="mt-8 grid flex-1 grid-cols-3 gap-5">
          ${PLANS.map((pl) => `<div class="rounded-2xl p-5 ${pl.hot ? 'text-white' : 'bg-zinc-50 ring-1 ring-inset ring-zinc-100'}" style="${pl.hot ? `background:${p.main}` : ''}"><h3 class="text-sm font-semibold">${pl.name}</h3><p class="mt-2 text-2xl font-bold">${pl.price}<span class="text-xs font-normal opacity-70">${pl.unit}</span></p><ul class="mt-3 space-y-1.5 text-xs ${pl.hot ? 'text-white/85' : 'text-zinc-500'}">${pl.feats.map((f) => `<li>· ${f}</li>`).join('')}</ul></div>`).join('')}
        </div>
      </div>` },
  ];
  return `
  <div data-oey-section="ppt">
    <div class="aspect-video w-[960px] overflow-hidden rounded-xl shadow-pop ring-1 ring-zinc-200" data-oey-object="ppt.slide.${state.slide + 1}" data-oey-label="幻灯片 · ${slides[state.slide].t}">
      ${slides[state.slide].body}
    </div>
    <div class="mt-4 flex justify-center gap-3">
      ${slides.map((s, i) => `
      <button class="slide-thumb w-36 overflow-hidden rounded-lg ring-2 transition ${i === state.slide ? '' : 'ring-zinc-200 opacity-60 hover:opacity-100'}" style="${i === state.slide ? `--tw-ring-color:${p.main}` : ''}" data-slide="${i}">
        <div class="flex aspect-video items-center justify-center bg-white text-[10px] font-medium text-zinc-500">${i + 1} · ${s.t}</div>
      </button>`).join('')}
    </div>
  </div>`;
}

function renderDocx(vd, p) {
  return `
  <div data-oey-section="docx" class="rounded-xl bg-white px-14 py-14 shadow-pop ring-1 ring-zinc-200">
    <p class="text-xs font-medium uppercase tracking-widest" style="color:${p.dark}">产品方案文档 · v${versions[state.vIdx].v}</p>
    <h1 data-oey-object="docx.title" data-oey-label="文档标题" class="mt-3 font-serif text-4xl font-bold tracking-tight">${esc(vd.headline)}</h1>
    <p class="mt-2 text-xs text-zinc-400">FlowDock 产品团队 · 最后编辑 ${now()}</p>
    <hr class="my-8 border-zinc-100" />
    <h2 data-oey-object="docx.h1" data-oey-label="章节 · 背景" class="text-lg font-semibold">一、项目背景</h2>
    <p data-oey-object="docx.p1" data-oey-label="正文段落" class="mt-3 text-sm leading-7 text-zinc-600">${esc(vd.sub)} 本方案旨在通过官网落地页、演示文稿与产品文档三种载体，统一传达 FlowDock 2.0 的核心价值主张。</p>
    <h2 class="mt-8 text-lg font-semibold">二、核心功能</h2>
    <ul class="mt-3 space-y-2 text-sm leading-7 text-zinc-600">
      ${FEATURES.map((f) => `<li class="flex gap-2"><span style="color:${p.main}">▪</span><span><strong>${f.title}</strong>：${f.desc}</span></li>`).join('')}
    </ul>
    <h2 class="mt-8 text-lg font-semibold">三、定价一览</h2>
    <table data-oey-object="docx.table" data-oey-label="定价表格" class="mt-3 w-full border-collapse text-sm">
      <thead><tr class="bg-zinc-50 text-left text-xs text-zinc-500">
        <th class="border border-zinc-200 px-3 py-2 font-medium">方案</th><th class="border border-zinc-200 px-3 py-2 font-medium">价格</th><th class="border border-zinc-200 px-3 py-2 font-medium">适用团队</th>
      </tr></thead>
      <tbody class="text-zinc-600">
        <tr><td class="border border-zinc-200 px-3 py-2">Starter</td><td class="border border-zinc-200 px-3 py-2">¥0 /人/月</td><td class="border border-zinc-200 px-3 py-2">5 人以下试用</td></tr>
        <tr><td class="border border-zinc-200 px-3 py-2 font-medium" style="color:${p.dark}">Pro</td><td class="border border-zinc-200 px-3 py-2">¥68 /人/月</td><td class="border border-zinc-200 px-3 py-2">成长期远程团队</td></tr>
        <tr><td class="border border-zinc-200 px-3 py-2">Enterprise</td><td class="border border-zinc-200 px-3 py-2">定制报价</td><td class="border border-zinc-200 px-3 py-2">合规要求高的组织</td></tr>
      </tbody>
    </table>
    <p class="mt-10 text-center text-[10px] text-zinc-300">— 第 1 页 / 共 3 页 · 由 OEYdesign 生成 —</p>
  </div>`;
}

/* =====================================================
 * 版本管理
 * ===================================================== */
function commitVersion(desc, mutate) {
  const data = JSON.parse(JSON.stringify(versions[state.vIdx].data));
  mutate(data);
  const v = { v: versions.length + 1, label: desc, time: now(), data };
  versions.push(v);
  state.vIdx = versions.length - 1;
  renderArtifact();
  renderVersionUI();
  return v;
}

function renderVersionUI() {
  const cur = versions[state.vIdx];
  $('#versionLabel').textContent = `v${cur.v} · ${cur.label}`;

  const isLatest = state.vIdx === versions.length - 1;
  const badge = $('#statusBadge');
  if (isLatest) {
    badge.className = 'inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200';
    badge.innerHTML = `<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>已同步 · v${cur.v}`;
  } else {
    badge.className = 'inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200';
    badge.innerHTML = `<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>查看历史 · v${cur.v}`;
  }

  $('#versionMenu').innerHTML = [...versions].reverse().map((v) => {
    const idx = versions.indexOf(v);
    return `
    <button class="ver-item flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-zinc-50 ${idx === state.vIdx ? 'is-current' : ''}" data-vidx="${idx}">
      <span class="ver-check text-indigo-600">✓</span>
      <span class="flex-1">
        <span class="block text-sm font-medium text-zinc-800">v${v.v} · ${esc(v.label)}</span>
        <span class="block text-[11px] text-zinc-400">${v.time}${idx === versions.length - 1 ? ' · 最新' : ''}</span>
      </span>
    </button>`;
  }).join('');
}

function updateStats() {
  const secs = artifactWrap.querySelectorAll('[data-oey-section]').length;
  const objs = artifactWrap.querySelectorAll('[data-oey-object]').length;
  $('#statSections').textContent = `${secs} 个版块`;
  $('#statObjects').textContent = `${objs} 个可反馈对象`;
  $('#statUpdated').textContent = `更新于 ${versions[state.vIdx].time}`;
}

/* =====================================================
 * 对话
 * ===================================================== */
function agentAvatar() {
  return `<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>
  </div>`;
}

function artifactCard(card) {
  return `
  <button class="msg-card mt-2.5 flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-zinc-200 shadow-card hover:ring-indigo-300 transition" data-cardv="${card.v}" data-cardart="${card.art || 'web'}">
    <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
      ${card.art === 'ppt' ? '📽️' : card.art === 'docx' ? '📝' : '🖥️'}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-xs font-semibold text-zinc-800">${esc(card.title)}</span>
      <span class="block text-[11px] text-zinc-400">v${card.v} · ${esc(card.desc)}</span>
    </span>
    <span class="text-[11px] font-medium text-indigo-600">查看 →</span>
  </button>`;
}

function addAgentMsg(text, card) {
  const el = document.createElement('div');
  el.className = 'oey-msg flex gap-2.5';
  el.innerHTML = `${agentAvatar()}
    <div class="min-w-0 flex-1">
      <div class="rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-800">${text}</div>
      ${card ? artifactCard(card) : ''}
    </div>`;
  chatScroll.appendChild(el);
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function addUserMsg(text) {
  const el = document.createElement('div');
  el.className = 'oey-msg flex justify-end';
  el.innerHTML = `<div class="max-w-[85%] rounded-2xl rounded-tr-md bg-zinc-900 px-3.5 py-2.5 text-sm leading-relaxed text-white">${esc(text)}</div>`;
  chatScroll.appendChild(el);
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function showTyping() {
  const el = document.createElement('div');
  el.id = 'typingRow';
  el.className = 'oey-msg flex gap-2.5';
  el.innerHTML = `${agentAvatar()}<div class="oey-typing flex items-center gap-1 rounded-2xl rounded-tl-md bg-zinc-100 px-4 py-3"><span></span><span></span><span></span></div>`;
  chatScroll.appendChild(el);
  chatScroll.scrollTop = chatScroll.scrollHeight;
}
const hideTyping = () => $('#typingRow')?.remove();

/* ---------- Agent 回复逻辑（mock 意图理解） ---------- */
const GENERIC_REPLIES = [
  '收到。我记下了这条意见，会在下一轮迭代里把它和现有版式一起评估——如果你想让它立刻生效，可以试试点一下画布上对应的对象，直接给对象级反馈。',
  '明白。这个方向可行，不过我建议先保留当前版本作为对照。你可以用左侧快捷指令或点击画布对象来触发具体修改，我会为每次改动生成新版本，方便随时回退。',
  '好的。这条需求涉及整体风格，我需要更具体一点的信息：比如参考网站、品牌色或关键词（“更年轻”、“更企业级”）。补充后我马上出新版本。',
];

function agentRespond(text) {
  const t = text.toLowerCase();

  if (/ppt|幻灯片|演示/.test(t)) {
    state.artifact = 'ppt'; syncTabs(); renderArtifact();
    return { text: '已把同一份内容重排为 <strong>PPT 演示文稿</strong>：封面 / 核心功能 / 定价方案 三页，版式与配色沿用当前版本。点下方缩略图可切换页面。', card: { v: versions[state.vIdx].v, title: 'FlowDock 产品介绍.pptx', desc: '3 页 · 16:9', art: 'ppt' } };
  }
  if (/docx|word|文档/.test(t)) {
    state.artifact = 'docx'; syncTabs(); renderArtifact();
    return { text: '已生成 <strong>DOCX 产品方案文档</strong> 视图，包含背景、功能与定价表格，适合直接发给合作方评审。', card: { v: versions[state.vIdx].v, title: 'FlowDock 产品方案.docx', desc: '3 页 · A4', art: 'docx' } };
  }
  if (/导出/.test(t)) {
    return { text: '点击画布右上角的 <strong>「导出」</strong> 即可。支持 PNG / PDF / PPTX / DOCX 四种格式，也可以复制分享链接给同事在线查看当前版本。' };
  }
  if (/暖色|颜色|配色|主色|换.*色/.test(t)) {
    const order = ['amber', 'rose', 'indigo', 'emerald'];
    const cur = curData().accent;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    const v = commitVersion(`切换主色为${PALETTES[next].name}`, (d) => { d.accent = next; });
    return { text: `已将整体主色切换为 <strong>「${PALETTES[next].name}」</strong>，按钮、徽标、强调卡片的对比度也一并校准过了。`, card: { v: v.v, title: 'FlowDock 官网落地页', desc: v.label } };
  }
  if (/标题|冲击力|文案/.test(t)) {
    const pool = COPY_POOL['hero.title'];
    const next = pool[(pool.indexOf(curData().headline) + 1) % pool.length];
    const v = commitVersion('改写 Hero 主标题', (d) => { d.headline = next; });
    return { text: `主标题已改为 <strong>「${esc(next)}」</strong>，更有画面感一些。不满意可以继续说“再换一版”。`, card: { v: v.v, title: 'FlowDock 官网落地页', desc: v.label } };
  }
  if (/评价|客户|信任|证言/.test(t)) {
    const v = commitVersion(curData().testimonial ? '更新客户评价样式' : '加入客户评价', (d) => { d.testimonial = true; });
    return { text: '已在定价区前加入<strong>客户评价版块</strong>，引用 Nordwind 工程负责人的证言来增强信任感。', card: { v: v.v, title: 'FlowDock 官网落地页', desc: v.label } };
  }
  return { text: GENERIC_REPLIES[Math.floor(Math.random() * GENERIC_REPLIES.length)] };
}

let sending = false;
function sendMessage(text) {
  text = text.trim();
  if (!text || sending) return;
  sending = true;
  addUserMsg(text);
  $('#composer').value = '';
  showTyping();
  setTimeout(() => {
    hideTyping();
    const r = agentRespond(text);
    addAgentMsg(r.text, r.card);
    sending = false;
  }, 900 + Math.random() * 600);
}

/* =====================================================
 * 对象级反馈（画布选中 + 检查器）
 * ===================================================== */
function clearSelection() {
  artifactWrap.querySelectorAll('.oey-selected').forEach((n) => n.classList.remove('oey-selected'));
  state.selected = null;
}
function hideInspector() { $('#inspector').classList.add('hidden'); }

function selectObject(node) {
  clearSelection();
  node.classList.add('oey-selected');
  state.selected = node.dataset.oeyObject;
  $('#inspLabel').textContent = node.dataset.oeyLabel || node.dataset.oeyObject;
  $('#inspPath').textContent = node.dataset.oeyObject;
  $('#inspector').classList.remove('hidden');
}

artifactWrap.addEventListener('mouseover', (e) => {
  const n = e.target.closest('[data-oey-object]');
  artifactWrap.querySelectorAll('.oey-hover').forEach((x) => x.classList.remove('oey-hover'));
  if (n && !n.classList.contains('oey-selected')) n.classList.add('oey-hover');
});
artifactWrap.addEventListener('click', (e) => {
  const thumb = e.target.closest('.slide-thumb');
  if (thumb) { state.slide = +thumb.dataset.slide; renderArtifact(); return; }
  const n = e.target.closest('[data-oey-object]');
  if (n) { e.stopPropagation(); selectObject(n); }
});
$('#canvasScroll').addEventListener('click', (e) => {
  if (!e.target.closest('#artifactWrap') && !e.target.closest('#inspector')) { clearSelection(); hideInspector(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { clearSelection(); hideInspector(); } });
$('#inspClose').addEventListener('click', () => { clearSelection(); hideInspector(); });

function cycleCopy(key, field) {
  const pool = COPY_POOL[key];
  const next = pool[(pool.indexOf(curData()[field]) + 1) % pool.length];
  commitVersion(`改写 ${key}`, (d) => { d[field] = next; });
  return next;
}

document.querySelectorAll('.qa').forEach((btn) => btn.addEventListener('click', () => {
  if (!state.selected) return;
  const kind = btn.dataset.qa;
  const key = state.selected;
  if (kind === 'rewrite') {
    if (key === 'hero.title') { const n = cycleCopy(key, 'headline'); addAgentMsg(`已把 <strong>hero.title</strong> 改写为「${esc(n)}」，并生成新版本。`, { v: versions.length, title: 'FlowDock 官网落地页', desc: versions[versions.length - 1].label }); }
    else if (key === 'hero.sub') { const n = cycleCopy(key, 'sub'); addAgentMsg('副文案已换一版，语气更强调效率收益。', { v: versions.length, title: 'FlowDock 官网落地页', desc: versions[versions.length - 1].label }); }
    else if (key === 'hero.cta' || key === 'nav.cta') { const n = cycleCopy('hero.cta', 'cta'); addAgentMsg(`按钮文案已改为「${esc(n)}」。`, { v: versions.length, title: 'FlowDock 官网落地页', desc: versions[versions.length - 1].label }); }
    else toast(`「${key}」暂无备选文案（mock）`);
  } else if (kind === 'accent') {
    const next = PALETTE_ORDER[(PALETTE_ORDER.indexOf(curData().accent) + 1) % PALETTE_ORDER.length];
    commitVersion('对象级换色', (d) => { d.accent = next; });
    addAgentMsg(`已将强调色切换为 <strong>「${PALETTES[next].name}」</strong>，该对象及关联组件已同步。`, { v: versions.length, title: 'FlowDock 官网落地页', desc: versions[versions.length - 1].label });
  } else if (kind === 'bigger') {
    if (key === 'hero.title') {
      const to = !curData().big;
      commitVersion(to ? '放大主标题' : '恢复主标题字号', (d) => { d.big = to; });
      addAgentMsg(to ? '主标题已放大一档，视觉重心更集中。' : '主标题字号已恢复默认。', { v: versions.length, title: 'FlowDock 官网落地页', desc: versions[versions.length - 1].label });
    } else toast('字号调整目前仅支持 hero.title（mock）');
  }
}));

$('#inspSend').addEventListener('click', () => {
  const v = $('#inspInput').value.trim();
  if (!v || !state.selected) return;
  const target = state.selected;
  $('#inspInput').value = '';
  addUserMsg(`[${target}] ${v}`);
  showTyping();
  setTimeout(() => {
    hideTyping();
    const cv = commitVersion(`对象反馈 · ${target}`, () => {});
    addAgentMsg(`已收到对 <strong>${target}</strong> 的反馈：「${esc(v)}」。我先按当前理解应用了一版（v${cv.v}），如果需要更精确的调整，可以补充参考或数值。`, { v: cv.v, title: 'FlowDock 官网落地页', desc: cv.label });
  }, 1000);
});

/* =====================================================
 * 工具栏交互
 * ===================================================== */
function syncTabs() {
  document.querySelectorAll('.art-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.art === state.artifact));
  document.querySelectorAll('.dev-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.dev === state.device));
  $('#deviceGroup').style.opacity = state.artifact === 'web' ? '1' : '.35';
  $('#deviceGroup').style.pointerEvents = state.artifact === 'web' ? 'auto' : 'none';
}
document.querySelectorAll('.art-tab').forEach((b) => b.addEventListener('click', () => {
  state.artifact = b.dataset.art; syncTabs(); renderArtifact();
}));
document.querySelectorAll('.dev-tab').forEach((b) => b.addEventListener('click', () => {
  state.device = b.dataset.dev; syncTabs(); if (state.artifact === 'web') renderArtifact();
}));

const ZOOMS = [0.7, 0.85, 1, 1.15];
$('#zoomIn').addEventListener('click', () => { state.zoom = ZOOMS[Math.min(ZOOMS.indexOf(state.zoom) + 1, ZOOMS.length - 1)] ?? 1; renderArtifact(); });
$('#zoomOut').addEventListener('click', () => { state.zoom = ZOOMS[Math.max(ZOOMS.indexOf(state.zoom) - 1, 0)] ?? 0.7; renderArtifact(); });

/* 下拉菜单通用开合 */
function bindMenu(btnId, menuId) {
  const btn = $(btnId), menu = $(menuId);
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.add('hidden'); });
}
bindMenu('#versionBtn', '#versionMenu');
bindMenu('#exportBtn', '#exportMenu');

$('#versionMenu').addEventListener('click', (e) => {
  const item = e.target.closest('.ver-item');
  if (!item) return;
  state.vIdx = +item.dataset.vidx;
  renderVersionUI(); renderArtifact();
  $('#versionMenu').classList.add('hidden');
});

document.querySelectorAll('.export-item').forEach((b) => b.addEventListener('click', () => {
  const cur = versions[state.vIdx];
  toast(b.dataset.fmt === '分享链接'
    ? '已复制链接：oey.design/s/flowdock-v' + cur.v + '（mock）'
    : `已导出 FlowDock-v${cur.v} · ${b.dataset.fmt}（mock）`);
  $('#exportMenu').classList.add('hidden');
}));

/* 消息里的产物卡片 → 跳转对应版本/视图 */
chatScroll.addEventListener('click', (e) => {
  const card = e.target.closest('.msg-card');
  if (!card) return;
  const idx = versions.findIndex((v) => v.v === +card.dataset.cardv);
  if (idx > -1) state.vIdx = idx;
  state.artifact = card.dataset.cardart || 'web';
  syncTabs(); renderVersionUI(); renderArtifact();
  toast(`已跳转到 v${card.dataset.cardv} · ${card.dataset.cardart.toUpperCase()} 视图`);
});

/* 输入区 */
$('#sendBtn').addEventListener('click', () => sendMessage($('#composer').value));
$('#composer').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e.target.value); }
});
document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => sendMessage(c.dataset.prompt)));

/* 对话栏收起 / 展开 */
$('#collapseChat').addEventListener('click', () => {
  $('#chatPanel').classList.add('hidden');
  $('#reopenChat').classList.remove('hidden');
  $('#reopenChat').classList.add('inline-flex');
});
$('#reopenChat').addEventListener('click', () => {
  $('#chatPanel').classList.remove('hidden');
  $('#reopenChat').classList.add('hidden');
});

/* =====================================================
 * Toast
 * ===================================================== */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'oey-toast pointer-events-auto flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-pop';
  el.innerHTML = `<span class="text-emerald-400">✓</span>${esc(msg)}`;
  $('#toastBox').appendChild(el);
  setTimeout(() => { el.classList.add('oey-leaving'); setTimeout(() => el.remove(), 250); }, 2600);
}

/* =====================================================
 * 初始化：灌入真实感对话 + 首次渲染
 * ===================================================== */
function seedChat() {
  addUserMsg('你好，帮我给 FlowDock 做一个官网落地页。产品是面向远程团队的自动化工作流工具，想要专业、干净一点的风格。');
  addAgentMsg('理解 ✅ 我按经典 SaaS 官网结构来组织：<strong>导航 / 主视觉 / 功能矩阵 / 定价 / 页脚</strong>。配色先用靛蓝做主色，走冷静、可信赖的气质，先出一版给你看。', { v: 1, title: 'FlowDock 官网落地页', desc: '初始生成 · 5 个版块' });
  addUserMsg('整体不错。主标题有点平，换个更有画面感的；另外主色换成绿色系试试，想更“生长”一点。');
  addAgentMsg('已调整两处：主标题改为 <strong>「工作流，像流水一样顺畅」</strong>；主色从靛蓝切换为 <strong>翡翠绿</strong>，按钮与徽标的对比度也一起校过了。', { v: 2, title: 'FlowDock 官网落地页', desc: '换主标题 + 绿色主色' });
  addUserMsg('定价区上面加一段客户评价，增强信任感。');
  addAgentMsg('已在定价区前加入<strong>客户评价版块</strong>，引用了 Nordwind 工程负责人的证言。当前就是画布上这版（v3）。你可以直接点击画布里的任何对象给我反馈，比如主标题、按钮、定价卡。', { v: 3, title: 'FlowDock 官网落地页', desc: '加入客户评价' });
}

seedChat();
syncTabs();
renderVersionUI();
renderArtifact();