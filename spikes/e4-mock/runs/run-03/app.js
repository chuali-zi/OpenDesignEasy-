/* Orbit Agent 工作台 —— 应用逻辑（数据全部来自 window.__mockApi__） */
(function () {
  'use strict';

  var api = window.__mockApi__;

  var state = {
    projects: [],
    currentId: null,
    messages: [],
    preview: null,
    sending: false
  };

  /* ---------- DOM 引用 ---------- */
  var el = {
    topbarName: document.getElementById('topbar-project-name'),
    topbarModel: document.getElementById('topbar-project-model'),
    projectCount: document.getElementById('project-count'),
    projectList: document.getElementById('project-list'),
    messageList: document.getElementById('message-list'),
    typing: document.getElementById('typing-indicator'),
    composer: document.getElementById('composer'),
    input: document.getElementById('composer-input'),
    sendBtn: document.getElementById('composer-send'),
    previewKind: document.getElementById('preview-kind'),
    previewBody: document.getElementById('preview-body'),
    previewMeta: document.getElementById('preview-meta')
  };

  /* ---------- 渲染：项目列表 ---------- */
  function renderProjects() {
    el.projectCount.textContent = String(state.projects.length);
    el.projectList.innerHTML = '';

    state.projects.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'project-item' + (p.id === state.currentId ? ' active' : '');
      li.setAttribute('data-oey-object', 'projects.item');
      li.setAttribute('data-project-id', p.id);

      var name = document.createElement('span');
      name.className = 'project-item-name';
      name.setAttribute('data-oey-object', 'projects.item-name');
      name.textContent = p.name;

      var desc = document.createElement('span');
      desc.className = 'project-item-desc';
      desc.setAttribute('data-oey-object', 'projects.item-desc');
      desc.textContent = p.desc;

      var foot = document.createElement('div');
      foot.className = 'project-item-foot';

      var dot = document.createElement('span');
      dot.className = 'status-dot status-' + p.status;

      var status = document.createElement('span');
      status.setAttribute('data-oey-object', 'projects.item-status');
      status.textContent = p.statusLabel;

      var meta = document.createElement('span');
      meta.setAttribute('data-oey-object', 'projects.item-meta');
      meta.textContent = (p.messageCount || 0) + ' 条消息 · ' + (p.lastActive || '');

      foot.appendChild(dot);
      foot.appendChild(status);
      foot.appendChild(meta);

      li.appendChild(name);
      li.appendChild(desc);
      li.appendChild(foot);

      li.addEventListener('click', function () {
        selectProject(p.id);
      });

      el.projectList.appendChild(li);
    });
  }

  /* ---------- 渲染：顶栏 ---------- */
  function renderTopbar() {
    var p = null;
    state.projects.forEach(function (item) {
      if (item.id === state.currentId) p = item;
    });
    el.topbarName.textContent = p ? p.name : '—';
    el.topbarModel.textContent = p ? p.model : '—';
  }

  /* ---------- 渲染：对话区 ---------- */
  function buildMessageEl(msg) {
    var row = document.createElement('div');
    row.className = 'message-row ' + msg.role;

    var bubble = document.createElement('div');
    bubble.className = 'message';
    bubble.setAttribute('data-oey-object', 'conversation.message');
    bubble.setAttribute('data-role', msg.role);

    var role = document.createElement('span');
    role.className = 'message-role';
    role.setAttribute('data-oey-object', 'conversation.message-role');
    role.textContent = msg.role === 'user' ? '你' : 'Orbit Agent';

    var text = document.createElement('div');
    text.className = 'message-text';
    text.setAttribute('data-oey-object', 'conversation.message-text');
    text.textContent = msg.text;

    var time = document.createElement('span');
    time.className = 'message-time';
    time.setAttribute('data-oey-object', 'conversation.message-time');
    time.textContent = msg.time || '';

    bubble.appendChild(role);
    bubble.appendChild(text);
    bubble.appendChild(time);
    row.appendChild(bubble);
    return row;
  }

  function scrollToBottom() {
    el.messageList.scrollTop = el.messageList.scrollHeight;
  }

  function renderConversation() {
    el.messageList.innerHTML = '';
    state.messages.forEach(function (msg) {
      el.messageList.appendChild(buildMessageEl(msg));
    });
    scrollToBottom();
  }

  function appendMessage(msg) {
    state.messages.push(msg);
    el.messageList.appendChild(buildMessageEl(msg));
    scrollToBottom();
  }

  function setTyping(on) {
    el.typing.classList.toggle('hidden', !on);
    if (on) scrollToBottom();
  }

  /* ---------- 渲染：预览区 ---------- */
  function renderPreview(flash) {
    var p = state.preview;
    el.previewBody.innerHTML = '';
    if (!p) {
      el.previewKind.textContent = '—';
      el.previewMeta.textContent = '—';
      var empty = document.createElement('div');
      empty.className = 'preview-empty';
      empty.setAttribute('data-oey-object', 'preview.empty');
      empty.textContent = '暂无产出';
      el.previewBody.appendChild(empty);
      return;
    }

    el.previewKind.textContent = p.kindLabel;

    var card = document.createElement('article');
    card.className = 'preview-card' + (flash ? ' flash' : '');
    card.setAttribute('data-oey-object', 'preview.card');

    var head = document.createElement('div');
    head.className = 'preview-card-head';
    head.setAttribute('data-oey-object', 'preview.card-title');
    head.textContent = p.title;

    var pre = document.createElement('pre');
    var code = document.createElement('code');
    code.setAttribute('data-oey-object', 'preview.code');
    code.textContent = p.code;
    pre.appendChild(code);

    card.appendChild(head);
    card.appendChild(pre);
    el.previewBody.appendChild(card);

    el.previewMeta.textContent =
      '更新于 ' + (p.updatedAt || '—') + ' · 基于第 ' + (p.turn || 1) + ' 轮对话推导生成';
  }

  /* ---------- 交互：切换项目 ---------- */
  function selectProject(id) {
    if (state.sending) return; // 发送进行中不允许切换，避免上下文错乱
    state.currentId = id;
    renderProjects();
    renderTopbar();
    el.messageList.innerHTML = '';
    renderPreview(false);

    api.getMessages(id).then(function (messages) {
      if (state.currentId !== id) return;
      state.messages = messages;
      renderConversation();
    });

    api.getPreview(id).then(function (preview) {
      if (state.currentId !== id) return;
      state.preview = preview;
      renderPreview(false);
    });
  }

  /* ---------- 交互：发送消息 ---------- */
  function send() {
    var text = el.input.value.trim();
    if (!text || state.sending || !state.currentId) return;

    state.sending = true;
    el.sendBtn.disabled = true;
    el.input.value = '';

    // 乐观插入用户消息
    appendMessage({ role: 'user', text: text, time: currentTime() });
    setTyping(true);

    api.sendMessage(state.currentId, text).then(function (res) {
      // 用服务端（mock）返回的正式消息替换乐观消息：这里直接追加 agent 回复
      appendMessage(res.agentMessage);
      state.preview = res.preview;
      renderPreview(true);

      // 同步项目列表中的计数与活跃时间
      state.projects.forEach(function (p) {
        if (p.id === state.currentId) {
          p.messageCount = res.project.messageCount;
          p.lastActive = res.project.lastActive;
        }
      });
      renderProjects();
    }).catch(function (err) {
      appendMessage({ role: 'agent', text: '（mock 层异常：' + err.message + '）', time: currentTime() });
    }).finally(function () {
      setTyping(false);
      state.sending = false;
      el.sendBtn.disabled = false;
      el.input.focus();
    });
  }

  function currentTime() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- 事件绑定 ---------- */
  el.composer.addEventListener('submit', function (e) {
    e.preventDefault();
    send();
  });

  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  /* ---------- 启动 ---------- */
  api.listProjects().then(function (projects) {
    state.projects = projects;
    renderProjects();
    if (projects.length > 0) {
      selectProject(projects[0].id);
    }
  });
})();
