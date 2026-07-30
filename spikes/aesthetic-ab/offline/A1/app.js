/* ═══════════ OEYdesign 工作台 · mock 逻辑 ═══════════ */
(function () {
  'use strict';

  /* ---------- 状态 ---------- */
  const COLOR_POOL = { 橙:'#FF7A45', 蓝:'#4F7CFF', 绿:'#2FBF8F', 紫:'#8B6CFF', 金:'#E8A93F', 红:'#F0524F' };

  const state = {
    file: 'web',            // web | deck | doc
    device: 'desktop',
    slide: 0,
    selected: null,         // 当前选中对象元素
    feedback: {},           // objectId -> [ {text, time, status} ]
    versions: [
      { id:'v1.0', note:'首版生成', time:'14:02',
        cfg:{ accent:'#4F7CFF', heroTitle:'Lumen — 你的第二大脑',
              heroSub:'一站式收集、整理与复用你的知识资产，让每一条信息都有处可寻。',
              cta:'免费开始使用' } },
      { id:'v1.1', note:'文案迭代', time:'14:05',
        cfg:{ accent:'#4F7CFF', heroTitle:'把碎片信息，变成清晰结构',
              heroSub:'从收集、结构化到复用，Lumen 帮你走完知识整理的最后一公里。',
              cta:'免费开始使用' } },
      { id:'v1.2', note:'主色调整', time:'14:09',
        cfg:{ accent:'#FF7A45', heroTitle:'把碎片信息，变成清晰结构',
              heroSub:'从收集、结构化到复用，Lumen 帮你走完知识整理的最后一公里。',
              cta:'免费开始使用' } }
    ]
  };

  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const now = () => { const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const curVer = () => state.versions.find(v=>v.id===state.currentVersion) || state.versions[state.versions.length-1];
  state.currentVersion = 'v1.2';

  /* ---------- Toast ---------- */
  function toast(icon, title, sub, type='success', life=2600) {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = `<span class="t-icon">${icon}</span><span>${title}${sub?`<small>${sub}</small>`:''}</span>`;
    $('#toasts').appendChild(t);
    if (life) setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(), 320); }, life);
    return t;
  }

  /* ---------- 状态闪烁 ---------- */
  function flashStatus(doneText) {
    const pill = $('#statusPill'), badge = $('#syncBadge'), canvas = $('#canvas');
    pill.innerHTML = '<i class="dot busy"></i>渲染中…';
    badge.innerHTML = '<i class="dot busy"></i>同步中…';
    canvas.classList.add('rendering');
    setTimeout(()=>{
      canvas.classList.remove('rendering');
      pill.innerHTML = '<i class="dot ok"></i>已就绪';
      badge.innerHTML = `<i class="dot ok"></i>已同步 · ${state.currentVersion}`;
      if (doneText) {} 
    }, 900);
  }

  /* ═══════════ 产物渲染 ═══════════ */
  function obj(id, name) { return `data-oey-object="${id}" data-oey-name="${name}"`; }

  function webHTML(cfg) {
    const t = cfg.heroTitle.replace(/(清晰结构|第二大脑|各就其位)/, '<em>$1</em>');
    return `
    <div class="art-web" style="--aa:${cfg.accent}">
      <nav class="art-nav" ${obj('navbar','顶部导航')}>
        <div class="art-logo" ${obj('logo','品牌 Logo')}><i>◆</i> Lumen</div>
        <div class="art-links" ${obj('nav-links','导航链接')}><span>产品</span><span>方案</span><span>定价</span><span>博客</span></div>
        <button class="art-btn ghost" ${obj('nav-login','登录按钮')}>登录</button>
      </nav>
      <header class="art-hero" ${obj('hero','Hero 主视觉')}>
        <span class="art-eyebrow" ${obj('hero-eyebrow','眉题标签')}>LUMEN 2.0 · 现已发布</span>
        <h1 ${obj('hero-title','主标题')}>${t}</h1>
        <p class="sub" ${obj('hero-sub','副标题')}>${cfg.heroSub}</p>
        <div class="art-cta-row" ${obj('hero-cta','CTA 按钮组')}>
          <button class="art-btn solid">${cfg.cta}</button>
          <button class="art-btn ghost">▶ 观看 2 分钟演示</button>
        </div>
        <div class="art-visual" ${obj('hero-visual','产品界面图')}>
          <div class="av-bar">
            <span class="cdot" style="background:#f0524f"></span><span class="cdot" style="background:#e8a93f"></span><span class="cdot" style="background:#2fbf8f"></span>
            <span class="url">app.lumen.site / workspace</span>
          </div>
          <div class="av-body">
            <div class="av-side"><span class="sk on" style="width:70%"></span><span class="sk" style="width:85%"></span><span class="sk" style="width:60%"></span><span class="sk" style="width:78%"></span></div>
            <div class="av-main">
              <div class="av-card"><div class="t"></div><div class="l"></div><div class="l short"></div><span class="tag">已结构化</span></div>
              <div class="av-card"><div class="t"></div><div class="l"></div><div class="l"></div><div class="l short"></div></div>
              <div class="av-card"><div class="t"></div><div class="l short"></div><span class="tag">AI 摘要</span></div>
              <div class="av-card"><div class="t"></div><div class="l"></div><div class="l short"></div></div>
            </div>
          </div>
        </div>
      </header>
      <section class="art-section" ${obj('features','特性区块')}>
        <div class="art-sec-head"><h2>为「整理」而生的三件事</h2><p>不堆砌功能，只解决信息从混沌到有序的关键路径。</p></div>
        <div class="feat-grid">
          <div class="feat-card" ${obj('feat-1','特性卡片 · 收集')}><div class="fi">⌘</div><h3>一键收集</h3><p>网页、PDF、聊天记录，任意来源的内容都能一键汇入，自动保留出处。</p></div>
          <div class="feat-card" ${obj('feat-2','特性卡片 · 结构化')}><div class="fi">▦</div><h3>自动结构化</h3><p>AI 识别内容类型与主题，自动生成大纲、标签与双向链接。</p></div>
          <div class="feat-card" ${obj('feat-3','特性卡片 · 复用')}><div class="fi">↻</div><h3>随处复用</h3><p>整理好的结构可一键导出为文档、幻灯片或 API，流入你的工作流。</p></div>
        </div>
      </section>
      <section class="art-section art-quote" ${obj('testimonial','用户证言')}>
        <blockquote>「我们团队的周报撰写时间从 3 小时降到 <span>20 分钟</span>，因为素材早就被整理好了。」</blockquote>
        <div class="who">— 陈默，某科技公司内容负责人</div>
      </section>
      <section class="art-section art-banner" ${obj('cta-banner','底部转化区')}>
        <h2>现在开始，让信息各就其位</h2>
        <p>免费版包含全部核心功能，无需绑定信用卡。</p>
        <button class="art-btn solid" style="padding:13px 30px;font-size:14.5px">${cfg.cta}</button>
      </section>
      <footer class="art-footer" ${obj('footer','页脚')}>
        <span>© 2024 Lumen Inc.</span><span>隐私 · 条款 · 联系我们</span>
      </footer>
    </div>`;
  }

  function deckSlides(cfg) {
    return [
      { k:'封面', title:cfg.heroTitle, sub:cfg.heroSub },
      { k:'痛点', title:'信息碎片化的三个代价', points:['找不回：70% 的收藏从未被再次打开','理不顺：素材散落在 5+ 个工具中','用不上：写作时依然从零开始'] },
      { k:'方案', title:'Lumen 的结构化引擎', points:['全渠道一键收集，自动保留出处','AI 生成大纲、标签与双向链接','结构即资产，可导出、可协作'] },
      { k:'对比', title:'为什么不是又一个笔记软件', points:['笔记软件存「内容」，Lumen 存「结构」','从收集到交付，一条流水线走完','为团队知识资产设计，而非个人仓库'] },
      { k:'数据', title:'早期用户的真实反馈', points:['周报撰写时间 −89%','素材复用率 ×3.2','两周留存 61%'] },
      { k:'行动', title:'现在开始，让信息各就其位', sub:'免费版包含全部核心功能 · lumen.site' }
    ];
  }

  function deckHTML(cfg) {
    const slides = deckSlides(cfg);
    const s = slides[state.slide] || slides[0];
    return `
    <div class="art-deck">
      <div class="deck-thumbs">
        ${slides.map((sl,i)=>`
          <div class="dthumb ${i===state.slide?'active':''}" data-slide="${i}" ${obj('slide-thumb-'+i,'幻灯片缩略 '+(i+1))} style="--aa:${cfg.accent}">
            <div class="dt-num">${String(i+1).padStart(2,'0')} / ${sl.k}</div>
            <div class="dt-title">${sl.title}</div>
          </div>`).join('')}
      </div>
      <div class="deck-stage">
        <div class="slide" style="--sa:${cfg.accent}" ${obj('slide-main','当前幻灯片 · '+s.k)}>
          <span class="s-kicker">${s.k.toUpperCase()==='封面'?'LUMEN 2.0':s.k}</span>
          <h2>${s.title}</h2>
          ${s.sub?`<p class="s-sub">${s.sub}</p>`:''}
          ${s.points?`<ul>${s.points.map(p=>`<li>${p}</li>`).join('')}</ul>`:''}
          <span class="s-brand">◆ LUMEN</span>
          <span class="s-page">${state.slide+1} / ${slides.length}</span>
        </div>
      </div>
    </div>`;
  }

  function docHTML(cfg) {
    return `
    <div class="art-doc">
      <div class="doc-page" style="--da:${cfg.accent}">
        <div ${obj('doc-head','文档标题区')}>
          <span class="doc-tag">DESIGN BRIEF · CONFIDENTIAL</span>
          <h1>Lumen 品牌落地页 · 设计说明</h1>
          <div class="doc-meta">版本 ${state.currentVersion} · OEYdesign 自动生成 · ${now()}</div>
        </div>
        <h2 ${obj('doc-s1','章节 · 设计目标')}>1. 设计目标</h2>
        <p>为 Lumen 2.0 发布会提供品牌落地页，核心心智为「把碎片信息变成清晰结构」。页面需在 8 秒内传达产品价值，并将访客引导至免费注册。</p>
        <h2 ${obj('doc-s2','章节 · 视觉系统')}>2. 视觉系统</h2>
        <table ${obj('doc-table','设计令牌表')}>
          <tr><th>令牌</th><th>值</th><th>用途</th></tr>
          <tr><td>brand / primary</td><td><span class="sw" style="background:${cfg.accent}"></span>${cfg.accent}</td><td>CTA、强调、图标</td></tr>
          <tr><td>surface / base</td><td><span class="sw" style="background:#fafbfd"></span>#FAFBFD</td><td>页面背景</td></tr>
          <tr><td>text / primary</td><td><span class="sw" style="background:#14161c"></span>#14161C</td><td>标题与正文</td></tr>
          <tr><td>radius / card</td><td>13px</td><td>卡片圆角</td></tr>
        </table>
        <h2 ${obj('doc-s3','章节 · 页面结构')}>3. 页面结构</h2>
        <p>导航 → Hero（标题 / 副标题 / CTA / 产品图）→ 三大特性 → 用户证言 → 底部转化 → 页脚。所有区块均支持对象级反馈与单独重生成。</p>
        <h2 ${obj('doc-s4','章节 · 主文案')}>4. 主文案</h2>
        <p><b>主标题：</b>${cfg.heroTitle}<br><b>副标题：</b>${cfg.heroSub}<br><b>CTA：</b>${cfg.cta}</p>
      </div>
    </div>`;
  }

  function renderArtifact() {
    const cfg = curVer().cfg;
    const canvas = $('#canvas');
    canvas.innerHTML = state.file==='web' ? webHTML(cfg) : state.file==='deck' ? deckHTML(cfg) : docHTML(cfg);
    state.selected = null;
    $('#inspector').hidden = true;
    updateFoot();
    bindCanvasEvents();
  }

  function updateFoot() {
    const names = { web:'index.html', deck:'deck.pptx', doc:'brief.docx' };
    const devNames = { desktop:'桌面 1280', tablet:'平板 768', mobile:'手机 390' };
    const n = $('#canvas').querySelectorAll('[data-oey-object]').length;
    $('#footInfo').textContent = `${names[state.file]} · ${state.file==='web'?devNames[state.device]:state.file==='deck'?'幻灯片 '+(state.slide+1)+'/6':'A4 纵向'} · ${n} 个对象 · ${state.currentVersion}`;
  }

  /* ═══════════ 对象选择 & 检查器 ═══════════ */
  function bindCanvasEvents() {
    $$('#canvas [data-oey-object]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        selectObject(el);
      });
    });
    // 缩略图切换
    $$('#canvas .dthumb').forEach(th => {
      th.addEventListener('click', e => {
        state.slide = +th.dataset.slide;
        renderArtifact();
      });
    });
  }

  function selectObject(el) {
    if (state.selected) state.selected.classList.remove('oey-selected');
    state.selected = el;
    el.classList.add('oey-selected');
    openInspector(el);
  }

  function openInspector(el) {
    const insp = $('#inspector');
    const id = el.dataset.oeyObject, name = el.dataset.oeyName;
    $('#inspName').textContent = name;
    $('#inspPath').textContent = `${state.file==='web'?'index.html':state.file==='deck'?'deck.pptx':'brief.docx'} › [data-oey-object="${id}"]`;
    // 属性
    const cfg = curVer().cfg;
    const props = [
      ['类型', el.tagName.toLowerCase()],
      ['区块 ID', id],
      ['版本', state.currentVersion]
    ];
    if (id==='hero-title') props.push(['文本', cfg.heroTitle]);
    if (id==='hero-sub') props.push(['文本', cfg.heroSub]);
    if (id==='hero-cta'||id==='cta-banner') props.push(['主色', `<span class="swatch" style="background:${cfg.accent}"></span>${cfg.accent}`]);
    if (id==='logo') props.push(['字重', '800']);
    $('#inspProps').innerHTML = props.map(p=>`<div class="prop-row"><span class="pk">${p[0]}</span><span class="pv">${p[1]}</span></div>`).join('');
    renderFbList(id);
    insp.hidden = false;
  }

  function renderFbList(id) {
    const list = state.feedback[id] || [];
    $('#fbList').innerHTML = list.length
      ? list.map(f=>`<div class="fb-item">${f.text}<span class="fb-meta">${f.time} · <span class="st">${f.status}</span></span></div>`).join('')
      : '<div class="fb-empty">暂无反馈。选中对象后提出的意见，agent 会逐条处理。</div>';
  }

  $('#inspClose').addEventListener('click', ()=>{
    $('#inspector').hidden = true;
    if (state.selected) { state.selected.classList.remove('oey-selected'); state.selected=null; }
  });

  $('#fbForm').addEventListener('submit', e=>{
    e.preventDefault();
    if (!state.selected) return;
    const id = state.selected.dataset.oeyObject;
    const name = state.selected.dataset.oeyName;
    const text = $('#fbInput').value.trim();
    if (!text) return;
    (state.feedback[id] = state.feedback[id] || []).push({ text, time: now(), status:'已采纳，排队应用' });
    $('#fbInput').value = '';
    renderFbList(id);
    agentSay(`已记录你对 <b>${name}</b> 的反馈：「${text}」。我会在下一轮修改中应用，并标记到该对象的修改历史。`, null, 1100);
    setTimeout(()=>{
      const f = state.feedback[id];
      if (f && f.length) { f[f.length-1].status='已应用 ✓'; if (!$('#inspector').hidden) renderFbList(id); }
    }, 2600);
  });

  // 点击空白处取消选择
  $('#canvasWrap').addEventListener('click', e=>{
    if (e.target === $('#canvasWrap') || e.target === $('#canvas')) {
      if (state.selected) { state.selected.classList.remove('oey-selected'); state.selected=null; }
      $('#inspector').hidden = true;
    }
  });

  /* ═══════════ 版本系统 ═══════════ */
  function refreshVersionMenu() {
    const menu = $('#versionMenu');
    menu.innerHTML = '<div class="menu-title">版本历史</div>' + state.versions.slice().reverse().map((v,i)=>`
      <button class="ver-item ${v.id===state.currentVersion?'cur':''}" data-ver="${v.id}">
        <span class="vid">${v.id}</span>
        <span class="vinfo"><b>${v.note}</b><small>${v.time} · 主色 ${v.cfg.accent}</small></span>
        ${i===0?'<span class="vtag">最新</span>':''}
      </button>`).join('');
    $$('#versionMenu .ver-item').forEach(b=>{
      b.addEventListener('click', ()=>{
        setVersion(b.dataset.ver);
        hideMenus();
      });
    });
    const latest = state.versions[state.versions.length-1];
    $('#verLabel').textContent = state.currentVersion;
    $('#syncBadge').innerHTML = `<i class="dot ok"></i>已同步 · ${latest.id}`;
  }

  function setVersion(id) {
    state.currentVersion = id;
    $('#verLabel').textContent = id;
    refreshVersionMenu();
    renderArtifact();
    flashStatus();
  }

  function bumpVersion(note, mutate) {
    const cfg = JSON.parse(JSON.stringify(curVer().cfg));
    mutate(cfg);
    const id = 'v1.' + state.versions.length;
    state.versions.push({ id, note, time: now(), cfg });
    state.currentVersion = id;
    refreshVersionMenu();
    renderArtifact();
    flashStatus();
    return id;
  }

  $('#versionBtn').addEventListener('click', e=>{
    e.stopPropagation();
    $('#exportMenu').hidden = true;
    $('#versionMenu').hidden = !$('#versionMenu').hidden;
  });

  /* ═══════════ 导出 ═══════════ */
  const EXPORT_META = {
    web:{ name:'Web 站点包', file:'lumen-site.zip' },
    ppt:{ name:'演示文稿', file:'lumen-deck.pptx' },
    docx:{ name:'设计说明文档', file:'lumen-brief.docx' },
    png:{ name:'PNG 长图', file:'lumen-page.png' }
  };
  $('#exportBtn').addEventListener('click', e=>{
    e.stopPropagation();
    $('#versionMenu').hidden = true;
    $('#exportMenu').hidden = !$('#exportMenu').hidden;
  });
  $$('#exportMenu .menu-item').forEach(b=>{
    b.addEventListener('click', ()=>{
      hideMenus();
      doExport(b.dataset.export);
    });
  });
  function doExport(kind) {
    const m = EXPORT_META[kind];
    const t = toast('⟳', `正在导出${m.name}…`, `${m.file} · 基于 ${state.currentVersion}`, 'working', 0);
    setTimeout(()=>{
      t.classList.add('out'); setTimeout(()=>t.remove(), 300);
      toast('✓', `${m.name}导出完成`, `${m.file} 已开始下载`);
    }, 1700);
  }

  $('#shareBtn').addEventListener('click', ()=> toast('↗','分享链接已复制','仅协作成员可查看 · 有效期 7 天'));
  $('#refreshBtn').addEventListener('click', ()=>{ renderArtifact(); flashStatus(); });

  document.addEventListener('click', hideMenus);
  function hideMenus(){ $('#exportMenu').hidden = true; $('#versionMenu').hidden = true; }

  /* ═══════════ 文件切换 / 设备切换 ═══════════ */
  $$('.ftab').forEach(b=>{
    b.addEventListener('click', ()=>{
      $$('.ftab').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      state.file = b.dataset.file;
      renderArtifact();
      flashStatus();
    });
  });
  $$('#deviceToggle .dev').forEach(b=>{
    b.addEventListener('click', ()=>{
      $$('#deviceToggle .dev').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      state.device = b.dataset.device;
      const c = $('#canvas');
      c.classList.remove('device-desktop','device-tablet','device-mobile');
      c.classList.add('device-'+state.device);
      if (state.file!=='web') { state.file='web'; $$('.ftab').forEach(x=>x.classList.toggle('active', x.dataset.file==='web')); renderArtifact(); }
      updateFoot();
    });
  });

  /* ═══════════ 对话系统 ═══════════ */
  const messages = $('#messages');

  function scrollBottom(){ messages.scrollTop = messages.scrollHeight; }

  function addUserMsg(text) {
    const d = document.createElement('div');
    d.className = 'msg user';
    d.innerHTML = `<div class="msg-body"><div class="msg-text"></div><div class="msg-time">${now()}</div></div>`;
    d.querySelector('.msg-text').textContent = text;
    messages.appendChild(d);
    scrollBottom();
  }

  function showTyping() {
    const d = document.createElement('div');
    d.className = 'msg agent typing';
    d.innerHTML = `<div class="msg-avatar">◈</div><div class="msg-body"><div class="msg-text"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></div></div>`;
    messages.appendChild(d);
    scrollBottom();
    return d;
  }

  function artCard(verId, note) {
    const fileNames = { web:['▦','Web 落地页 · index.html'], deck:['▤','演示文稿 · deck.pptx'], doc:['▥','设计文档 · brief.docx'] };
    const f = fileNames[state.file];
    return `<div class="art-card current" data-goto-version="${verId}" data-goto-file="${state.file}">
      <span class="art-card-icon">${f[0]}</span>
      <span class="art-card-info"><b>${f[1]}</b><small>${verId} · ${note} · 当前版本</small></span>
      <span class="art-card-act">查看 →</span>
    </div>`;
  }

  function agentSay(html, card, delay=1200, after) {
    const typing = showTyping();
    setTimeout(()=>{
      typing.remove();
      const d = document.createElement('div');
      d.className = 'msg agent';
      d.innerHTML = `<div class="msg-avatar">◈</div><div class="msg-body"><div class="msg-text">${html}</div>${card||''}<div class="msg-time">${now()} · 刚生成</div></div>`;
      messages.appendChild(d);
      scrollBottom();
      if (after) after();
    }, delay);
  }

  /* 意图处理 */
  function processIntent(text) {
    const t = text.toLowerCase();

    // PPT
    if (/ppt|幻灯|演示|deck/.test(t)) {
      state.file = 'deck';
      $$('.ftab').forEach(x=>x.classList.toggle('active', x.dataset.file==='deck'));
      const vid = bumpVersion('生成 PPT 演示稿', ()=>{});
      agentSay(`已基于落地页 ${state.currentVersion} 的内容结构生成 <b>6 页演示文稿</b>：封面、痛点、方案、对比、数据与行动页，主色与 Web 版保持一致。点击左侧缩略图可切换页面，右侧即为真实预览。`, artCard(vid,'PPT 生成'), 1600);
      return;
    }
    // DOCX
    if (/docx|文档|说明|brief/.test(t)) {
      state.file = 'doc';
      $$('.ftab').forEach(x=>x.classList.toggle('active', x.dataset.file==='doc'));
      const vid = bumpVersion('生成设计说明文档', ()=>{});
      agentSay(`已生成 <b>设计说明文档 brief.docx</b>，包含设计目标、视觉系统令牌表、页面结构与主文案四个章节，可直接交付给开发或市场团队。`, artCard(vid,'DOCX 生成'), 1500);
      return;
    }
    // 导出
    if (/导出|下载/.test(t)) {
      agentSay('好的，正在为你打包当前版本……', null, 900, ()=> doExport(state.file==='deck'?'ppt':state.file==='doc'?'docx':'web'));
      return;
    }
    // 颜色
    const colorKey = Object.keys(COLOR_POOL).find(k=>t.includes(k));
    if (colorKey || /颜色|主色|色调/.test(t)) {
      const c = COLOR_POOL[colorKey] || '#2FBF8F';
      const vid = bumpVersion('主色调整', cfg=>{ cfg.accent = c; });
      agentSay(`已将主色切换为 <code>${c}</code>（${colorKey||'绿'}色系），CTA、图标、标签与文档令牌已全局同步。背景维持中性灰，保证对比度达到 WCAG AA。`, artCard(vid,'主色调整'), 1400);
      return;
    }
    // 标题
    if (/标题|文案|slogan/i.test(t)) {
      const m = text.match(/「(.+?)」|"([^"]+)"|“(.+?)”/);
      const newTitle = m ? (m[1]||m[2]||m[3]) : '让每一条信息，都各就其位';
      const vid = bumpVersion('标题文案迭代', cfg=>{ cfg.heroTitle = newTitle; });
      agentSay(`主标题已更新为「<b>${newTitle}</b>」，并同步到 PPT 封面页与设计文档的主文案章节。字距收紧 1%，视觉重心更稳。`, artCard(vid,'标题迭代'), 1300);
      return;
    }
    // 移动端
    if (/手机|移动|响应式/.test(t)) {
      $$('#deviceToggle .dev').forEach(x=>x.classList.remove('active'));
      $('#deviceToggle .dev[data-device="mobile"]').classList.add('active');
      state.device = 'mobile';
      $('#canvas').classList.remove('device-desktop','device-tablet');
      $('#canvas').classList.add('device-mobile');
      updateFoot();
      agentSay('已切换到 <b>移动端视口（390px）</b> 预览。当前布局在小屏下会自动堆叠，Hero 标题降为 28px，CTA 全宽展示。如需针对移动端单独调整，直接告诉我就行。', null, 1200);
      return;
    }
    // 默认：通用打磨
    const vid = bumpVersion('细节优化', ()=>{});
    agentSay(`收到。我按你的描述做了一轮整体打磨：统一了卡片圆角与投影层级、收紧了区块间距节奏，并复查了全页对比度。改动已保存为新版本，可随时在左上角版本菜单回退。`, artCard(vid,'细节优化'), 1500);
  }

  $('#composer').addEventListener('submit', e=>{
    e.preventDefault();
    const v = $('#composerInput').value.trim();
    if (!v) return;
    $('#composerInput').value = '';
    addUserMsg(v);
    processIntent(v);
  });

  // 快捷 chips
  $$('.chip').forEach(c=>{
    c.addEventListener('click', ()=>{
      const p = c.dataset.prompt;
      addUserMsg(p);
      processIntent(p);
    });
  });

  // 聊天中的版本卡片跳转
  messages.addEventListener('click', e=>{
    const card = e.target.closest('.art-card');
    if (!card) return;
    const file = card.dataset.gotoFile, ver = card.dataset.gotoVersion;
    if (file && state.file!==file) {
      state.file = file;
      $$('.ftab').forEach(x=>x.classList.toggle('active', x.dataset.file===file));
    }
    if (ver) setVersion(ver); else renderArtifact();
    toast('▸', `已定位到 ${ver}`, file==='web'?'index.html':file==='deck'?'deck.pptx':'brief.docx');
  });

  // 对话栏收起
  $('#collapseBtn').addEventListener('click', ()=>{
    const p = $('.chat-panel');
    p.classList.toggle('collapsed');
    $('#collapseBtn').textContent = p.classList.contains('collapsed') ? '⟩' : '⟨';
    if (p.classList.contains('collapsed')) {
      // 收起后提供悬浮 reopen
      let rb = $('#reopenBtn');
      if (!rb) {
        rb = document.createElement('button');
        rb.id = 'reopenBtn';
        rb.className = 'tb-btn';
        rb.style.cssText = 'position:absolute;left:12px;top:64px;z-index:70;';
        rb.textContent = '💬 对话';
        rb.addEventListener('click', ()=>{ p.classList.remove('collapsed'); rb.remove(); $('#collapseBtn').textContent='⟨'; });
        document.body.appendChild(rb);
      }
    }
  });

  // 项目重命名
  $('#projectName').addEventListener('click', function(){
    const cur = this.textContent;
    const input = document.createElement('input');
    input.value = cur;
    input.style.cssText = 'background:var(--panel-2);border:1px solid var(--accent);border-radius:6px;color:#fff;font-size:14px;font-weight:600;padding:2px 6px;outline:none;';
    this.replaceWith(input);
    input.focus(); input.select();
    const commit = ()=>{
      const span = document.createElement('span');
      span.className = 'project-name'; span.id = 'projectName';
      span.textContent = input.value.trim() || cur;
      span.addEventListener('click', ()=> span.dispatchEvent(new Event('click')));
      input.replaceWith(span);
      span.onclick = arguments.callee; // 简单起见：刷新绑定
      location.reload === null; // no-op
      span.addEventListener('click', renameHandler);
      toast('✓','项目已重命名', span.textContent);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); });
  });
  function renameHandler(){ $('#projectName').click(); }

  /* ═══════════ 初始化 ═══════════ */
  refreshVersionMenu();
  renderArtifact();
  scrollBottom();
})();