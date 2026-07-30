/* ============================================================
 * Nexus 工作台 —— 纯前端 mock 层 + 界面逻辑
 * 无任何网络请求：所有“接口”都是本地异步函数（setTimeout 模拟延迟）
 * ============================================================ */

(function () {
  'use strict';

  /* ---------------- 工具 ---------------- */

  function delay(min, max) {
    var ms = min + Math.random() * (max - min);
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------- 组件模板（预览产物的拼装素材） ---------------- */

  var COMPONENT_BUILDERS = {
    hero: function (p) {
      return '<header class="hero"><h1>' + escapeHtml(p.name) + '</h1>' +
        '<p>' + escapeHtml(p.desc) + '</p></header>';
    },
    card: function () {
      return '<section class="card"><h3>特性卡片</h3>' +
        '<p>这是 agent 生成的一张介绍卡片，用来承载任意说明性内容。</p></section>';
    },
    button: function () {
      return '<section class="block"><button class="cta">立即体验</button></section>';
    },
    table: function () {
      return '<section class="card"><h3>数据表格</h3><table>' +
        '<tr><th>指标</th><th>今日</th><th>环比</th></tr>' +
        '<tr><td>访问量</td><td>12,480</td><td>+8.2%</td></tr>' +
        '<tr><td>转化率</td><td>3.6%</td><td>+0.4%</td></tr>' +
        '<tr><td>跳出率</td><td>41%</td><td>-2.1%</td></tr>' +
        '</table></section>';
    },
    form: function () {
      return '<section class="card"><h3>报名表单</h3>' +
        '<div class="field"><label>姓名</label><input placeholder="请输入姓名"></div>' +
        '<div class="field"><label>邮箱</label><input placeholder="name@example.com"></div>' +
        '<button class="cta">提交</button></section>';
    },
    quote: function (text) {
      return '<section class="card quote"><p>“' + escapeHtml(text) + '”</p></section>';
    }
  };

  /* 把项目当前的组件数组拼装成一份完整 HTML 文档 */
  function renderArtifact(project) {
    var body = project.components.map(function (c) {
      return COMPONENT_BUILDERS[c.type](c.arg !== undefined ? c.arg : project);
    }).join('\n');

    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>' +
      'body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
      'background:#f6f7fb;color:#23262d;padding:32px;display:flex;flex-direction:column;gap:16px;}' +
      '.hero{background:linear-gradient(135deg,' + project.accent + ',#8a5cff);color:#fff;' +
      'border-radius:14px;padding:36px 28px;}' +
      '.hero h1{margin:0 0 8px;font-size:26px;}' +
      '.hero p{margin:0;opacity:.85;font-size:14px;}' +
      '.card{background:#fff;border:1px solid #e4e7ee;border-radius:12px;padding:20px 22px;}' +
      '.card h3{margin:0 0 10px;font-size:16px;}' +
      '.card p{margin:0;font-size:14px;color:#555b66;line-height:1.7;}' +
      '.quote p{font-style:italic;color:#333;}' +
      '.block{text-align:center;padding:8px 0;}' +
      '.cta{background:' + project.accent + ';color:#fff;border:none;border-radius:8px;' +
      'padding:10px 26px;font-size:14px;cursor:pointer;}' +
      'table{width:100%;border-collapse:collapse;font-size:13px;}' +
      'th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eceff4;}' +
      'th{color:#8b93a3;font-weight:600;}' +
      '.field{margin-bottom:12px;}' +
      '.field label{display:block;font-size:12px;color:#8b93a3;margin-bottom:4px;}' +
      '.field input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #dde1e9;' +
      'border-radius:8px;font-size:13px;}' +
      '</style></head><body>' + body + '</body></html>';
  }

  /* ---------------- 回复生成规则（关键词 → 组件 / 主题变更） ---------------- */

  var ACCENT_MAP = [
    { re: /蓝/, color: '#4f7cff', label: '蓝色' },
    { re: /红/, color: '#e5534b', label: '红色' },
    { re: /绿/, color: '#2da86e', label: '绿色' },
    { re: /紫/, color: '#8a5cff', label: '紫色' },
    { re: /橙/, color: '#f08a24', label: '橙色' }
  ];

  /**
   * 根据用户输入推导 agent 回复与产物变更。
   * 返回 { replyText, changed, changeLabel }
   */
  function generateReply(project, userText) {
    var text = String(userText);
    var changes = [];

    // 主题色规则
    for (var i = 0; i < ACCENT_MAP.length; i++) {
      if (ACCENT_MAP[i].re.test(text) && /(颜色|主题|色|色调|配色)/.test(text)) {
        project.accent = ACCENT_MAP[i].color;
        changes.push('把主题色切换成了' + ACCENT_MAP[i].label);
        break;
      }
    }

    // 组件规则
    if (/按钮|button/i.test(text)) {
      project.components.push({ type: 'button' });
      changes.push('新增了一个行动按钮');
    }
    if (/表格|数据|table/i.test(text)) {
      project.components.push({ type: 'table' });
      changes.push('插入了一张数据表格');
    }
    if (/表单|报名|输入框|form/i.test(text)) {
      project.components.push({ type: 'form' });
      changes.push('生成了一个报名表单');
    }
    if (/卡片|介绍|特性|card/i.test(text)) {
      project.components.push({ type: 'card' });
      changes.push('补充了一张介绍卡片');
    }
    if (/引用|一句话|标语|slogan/i.test(text)) {
      var slogan = text.replace(/引用|一句话|标语|slogan|加|写|个|一条|：|:/gi, '').trim() || '让想法自己长成产品';
      project.components.push({ type: 'quote', arg: slogan });
      changes.push('加入了一条引用文案');
    }

    if (changes.length > 0) {
      project.version += 1;
      return {
        replyText: '收到，我已经完成以下调整：\n· ' + changes.join('\n· ') +
          '\n右侧预览已更新到 v' + project.version + '，你可以继续描述下一步需求。',
        changed: true,
        changeLabel: '已更新预览 → v' + project.version
      };
    }

    // 无命中规则：纯模板化闲聊回复，不改产物
    var fallbacks = [
      '明白了。不过这个需求我还没法直接落成页面改动——试试让我「加一个按钮」「插入数据表格」「生成报名表单」或「把主题改成紫色」。',
      '已记录你的想法。目前我支持的改动包括：按钮、卡片、数据表格、表单、引用文案，以及蓝/红/绿/紫/橙五种主题色。',
      '收到。这条消息没有触发任何页面变更，预览保持 v' + project.version + ' 不变。你可以换个更具体的说法试试。'
    ];
    return {
      replyText: fallbacks[Math.floor(Math.random() * fallbacks.length)],
      changed: false,
      changeLabel: null
    };
  }

  /* ---------------- 种子数据（纯虚构） ---------------- */

  function seedProject(id, name, desc, accent, convo, components) {
    return {
      id: id,
      name: name,
      desc: desc,
      accent: accent,
      version: 1,
      updatedAt: Date.now() - Math.floor(Math.random() * 86400000),
      conversation: convo,
      components: components
    };
  }

  var projects = [
    seedProject('p1', '官网落地页', '产品官网首屏与转化区块', '#4f7cff',
      [
        { role: 'user', text: '帮我搭一个产品官网的落地页骨架。' },
        { role: 'user', text: '帮我搭一个产品官网的落地页骨架。'.replace('帮我', '先帮我') }
      ].slice(0, 1).concat([
        { role: 'agent', text: '已生成首屏 Hero 与一张介绍卡片（v1）。可以继续让我加按钮、表格或调整主题色。', tag: '已更新预览 → v1' }
      ]),
      [{ type: 'hero' }, { type: 'card' }]),

    seedProject('p2', '数据看板', '运营指标一览页面', '#2da86e',
      [
        { role: 'user', text: '我需要一个展示运营数据的看板页。' },
        { role: 'agent', text: '看板骨架已就绪（v1）：绿色主题 Hero + 介绍卡片。对我说「加数据表格」即可填入指标。', tag: '已更新预览 → v1' }
      ],
      [{ type: 'hero' }, { type: 'card' }]),

    seedProject('p3', '活动报名页', '线下活动报名落地页', '#f08a24',
      [
        { role: 'user', text: '做一页活动报名页，主题用橙色。' },
        { role: 'agent', text: '已按橙色主题生成首屏（v1）。对我说「生成报名表单」即可加入姓名/邮箱填写区。', tag: '已更新预览 → v1' }
      ],
      [{ type: 'hero' }]),

    seedProject('p4', '个人博客', '极简风格的博客首页', '#8a5cff',
      [
        { role: 'user', text: '给我的博客首页打个底。' },
        { role: 'agent', text: '紫色主题的博客首屏已生成（v1）。想加引用标语或介绍卡片随时说。', tag: '已更新预览 → v1' }
      ],
      [{ type: 'hero' }, { type: 'quote', arg: '写作是把模糊的想法钉在纸上。' }])
  ];

  var newProjectCounter = 0;

  /* ---------------- Mock API（暴露到 window.__mockApi__） ---------------- */

  var MockAPI = {
    /** 拉取项目列表（模拟 200~500ms 网络延迟） */
    listProjects: function () {
      return delay(200, 500).then(function () {
        return projects.map(function (p) {
          return { id: p.id, name: p.name, desc: p.desc, updatedAt: p.updatedAt };
        });
      });
    },

    /** 拉取某个项目的完整状态：会话 + 产物（模拟 300~700ms） */
    getProject: function (id) {
      return delay(300, 700).then(function () {
        var p = projects.find(function (x) { return x.id === id; });
        if (!p) throw new Error('project not found: ' + id);
        return {
          id: p.id,
          name: p.name,
          desc: p.desc,
          version: p.version,
          conversation: p.conversation.slice(),
          artifactHtml: renderArtifact(p)
        };
      });
    },

    /** 发送消息，返回 agent 回复（模拟 700~1600ms "思考" 时间） */
    sendMessage: function (id, text) {
      return delay(700, 1600).then(function () {
        var p = projects.find(function (x) { return x.id === id; });
        if (!p) throw new Error('project not found: ' + id);
        p.conversation.push({ role: 'user', text: text });
        var result = generateReply(p, text);
        var agentMsg = { role: 'agent', text: result.replyText };
        if (result.changeLabel) agentMsg.tag = result.changeLabel;
        p.conversation.push(agentMsg);
        p.updatedAt = Date.now();
        return {
          reply: agentMsg,
          changed: result.changed,
          version: p.version,
          artifactHtml: result.changed ? renderArtifact(p) : null
        };
      });
    },

    /** 新建项目（名称按计数器规则生成） */
    createProject: function () {
      return delay(300, 600).then(function () {
        newProjectCounter += 1;
        var p = seedProject(
          'p-new-' + newProjectCounter,
          '未命名项目 ' + newProjectCounter,
          '从空白开始的构建会话',
          '#4f7cff',
          [{ role: 'agent', text: '新项目已创建，这是一个空白产物。描述你的第一个需求吧，例如「加一张介绍卡片」。' }],
          [{ type: 'hero' }]
        );
        projects.unshift(p);
        return { id: p.id, name: p.name, desc: p.desc, updatedAt: p.updatedAt };
      });
    }
  };

  window.__mockApi__ = MockAPI;

  /* ---------------- 界面逻辑 ---------------- */

  var els = {
    projectList: document.getElementById('projectList'),
    btnNewProject: document.getElementById('btnNewProject'),
    chatProjectName: document.getElementById('chatProjectName'),
    chatProjectDesc: document.getElementById('chatProjectDesc'),
    chatStatus: document.getElementById('chatStatus'),
    messageList: document.getElementById('messageList'),
    composer: document.getElementById('composer'),
    composerInput: document.getElementById('composerInput'),
    btnSend: document.getElementById('btnSend'),
    previewVersion: document.getElementById('previewVersion'),
    previewFileName: document.getElementById('previewFileName'),
    previewFrame: document.getElementById('previewFrame'),
    previewEmpty: document.getElementById('previewEmpty')
  };

  var state = {
    currentProjectId: null,
    pending: false
  };

  function setAgentStatus(text, busy) {
    els.chatStatus.textContent = text;
    els.chatStatus.classList.toggle('busy', !!busy);
  }

  function renderProjectList(list) {
    els.projectList.innerHTML = '';
    list.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'project-item' + (p.id === state.currentProjectId ? ' active' : '');
      li.setAttribute('data-oey-object', 'sidebar.project');
      li.setAttribute('data-project-id', p.id);

      var name = document.createElement('span');
      name.className = 'project-name';
      name.setAttribute('data-oey-object', 'sidebar.project.name');
      name.textContent = p.name;

      var meta = document.createElement('span');
      meta.className = 'project-meta';
      meta.setAttribute('data-oey-object', 'sidebar.project.meta');
      meta.textContent = p.desc;

      li.appendChild(name);
      li.appendChild(meta);
      li.addEventListener('click', function () { selectProject(p.id); });
      els.projectList.appendChild(li);
    });
  }

  function appendMessage(msg) {
    var div = document.createElement('div');
    div.className = 'msg ' + msg.role;
    div.setAttribute('data-oey-object', 'chat.message');
    div.setAttribute('data-role', msg.role);
    div.textContent = msg.text;
    if (msg.tag) {
      var tag = document.createElement('span');
      tag.className = 'msg-tag';
      tag.setAttribute('data-oey-object', 'chat.message.tag');
      tag.textContent = msg.tag;
      div.appendChild(document.createElement('br'));
      div.appendChild(tag);
    }
    els.messageList.appendChild(div);
    els.messageList.scrollTop = els.messageList.scrollHeight;
    return div;
  }

  function renderConversation(conversation) {
    els.messageList.innerHTML = '';
    conversation.forEach(appendMessage);
  }

  function renderPreview(artifactHtml, version, projectName) {
    if (artifactHtml) {
      els.previewFrame.srcdoc = artifactHtml;
      els.previewFrame.style.display = 'block';
      els.previewEmpty.classList.remove('visible');
    } else {
      els.previewFrame.style.display = 'none';
      els.previewEmpty.classList.add('visible');
    }
    els.previewVersion.textContent = 'v' + version;
    els.previewFileName.textContent = (projectName || 'artifact') + '/index.html';
  }

  function refreshListActive() {
    var items = els.projectList.querySelectorAll('.project-item');
    items.forEach(function (li) {
      li.classList.toggle('active', li.getAttribute('data-project-id') === state.currentProjectId);
    });
  }

  /** 切换当前项目：重新拉取会话与产物 */
  function selectProject(id) {
    if (state.pending || id === state.currentProjectId) return;
    state.currentProjectId = id;
    refreshListActive();
    setAgentStatus('加载中…', true);
    MockAPI.getProject(id).then(function (data) {
      if (state.currentProjectId !== id) return; // 防止快速点击串台
      els.chatProjectName.textContent = data.name;
      els.chatProjectDesc.textContent = data.desc;
      renderConversation(data.conversation);
      renderPreview(data.artifactHtml, data.version, data.name);
      setAgentStatus('agent 空闲', false);
    });
  }

  /** 发送消息 */
  els.composer.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = els.composerInput.value.trim();
    if (!text || state.pending || !state.currentProjectId) return;

    state.pending = true;
    els.btnSend.disabled = true;
    els.composerInput.value = '';

    appendMessage({ role: 'user', text: text });
    var typingEl = document.createElement('div');
    typingEl.className = 'msg agent typing';
    typingEl.setAttribute('data-oey-object', 'chat.message.typing');
    typingEl.textContent = 'agent 正在思考…';
    els.messageList.appendChild(typingEl);
    els.messageList.scrollTop = els.messageList.scrollHeight;
    setAgentStatus('agent 生成中…', true);

    MockAPI.sendMessage(state.currentProjectId, text).then(function (res) {
      typingEl.remove();
      appendMessage(res.reply);
      if (res.changed && res.artifactHtml) {
        renderPreview(res.artifactHtml, res.version, els.chatProjectName.textContent);
      } else {
        els.previewVersion.textContent = 'v' + res.version;
      }
    }).finally(function () {
      state.pending = false;
      els.btnSend.disabled = false;
      setAgentStatus('agent 空闲', false);
      els.composerInput.focus();
    });
  });

  /** 新建项目 */
  els.btnNewProject.addEventListener('click', function () {
    if (state.pending) return;
    setAgentStatus('创建项目中…', true);
    MockAPI.createProject().then(function () {
      return MockAPI.listProjects();
    }).then(function (list) {
      renderProjectList(list);
      state.currentProjectId = null; // 强制 selectProject 生效
      selectProject(list[0].id);
    });
  });

  /** 启动：加载列表并选中第一个项目 */
  MockAPI.listProjects().then(function (list) {
    renderProjectList(list);
    if (list.length > 0) selectProject(list[0].id);
  });

})();
