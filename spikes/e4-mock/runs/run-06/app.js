/* =========================================================================
 * app.js —— 界面层：只依赖 window.__mockApi__，不直接碰数据
 * ========================================================================= */
(function () {
  'use strict';

  var api = window.__mockApi__;

  var state = {
    projects: [],        // 列表摘要
    currentId: null,     // 当前项目 id
    current: null,       // 当前项目完整数据
    sending: false,
    keyword: ''          // 列表搜索关键词
  };

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    list: $('project-list'),
    count: $('project-count'),
    search: $('project-search'),
    btnNew: $('btn-new-project'),
    chatName: $('chat-project-name'),
    chatDesc: $('chat-project-desc'),
    chatStatus: $('chat-status'),
    messages: $('chat-messages'),
    input: $('chat-input'),
    send: $('chat-send'),
    pvType: $('preview-type'),
    pvBody: $('preview-body'),
    pvMeta: $('preview-meta')
  };

  /* ---------------- 工具 ---------------- */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var KIND_LABEL = { card: '图文卡片', code: '代码片段', steps: '任务清单' };

  /* ================= 项目列表渲染 ================= */
  function renderList() {
    var kw = state.keyword.trim().toLowerCase();
    var visible = state.projects.filter(function (p) {
      return !kw || p.name.toLowerCase().indexOf(kw) >= 0;
    });

    els.count.textContent = String(state.projects.length);
    els.list.innerHTML = visible.map(function (p) {
      var dotClass = p.status === 'running' ? 'dot-running'
                   : p.status === 'draft' ? 'dot-draft' : 'dot-idle';
      return '' +
        '<li class="project-item' + (p.id === state.currentId ? ' active' : '') + '"' +
        '    data-id="' + p.id + '" data-oey-object="project-list.item">' +
        '  <div class="project-item-top">' +
        '    <span class="project-item-name" data-oey-object="project-list.item-name">' + escapeHtml(p.name) + '</span>' +
        '    <span class="project-item-dot ' + dotClass + '" data-oey-object="project-list.item-status"></span>' +
        '  </div>' +
        '  <div class="project-item-last" data-oey-object="project-list.item-last">' + escapeHtml(p.lastMessage || '（暂无消息）') + '</div>' +
        '  <div class="project-item-time" data-oey-object="project-list.item-time">更新于 ' + escapeHtml(p.updatedAt) + '</div>' +
        '</li>';
    }).join('');

    if (!visible.length) {
      els.list.innerHTML = '<li class="project-item" data-oey-object="project-list.item">' +
        '<div class="project-item-last">没有匹配的项目</div></li>';
    }
  }

  /* ================= 对话区渲染 ================= */
  function renderChat() {
    var p = state.current;
    if (!p) {
      els.chatName.textContent = '—';
      els.chatDesc.textContent = '—';
      els.messages.innerHTML = '';
      return;
    }
    els.chatName.textContent = p.name;
    els.chatDesc.textContent = p.desc;

    els.messages.innerHTML = p.messages.map(function (m) {
      var isUser = m.role === 'user';
      var hint = (!isUser && m.artifact)
        ? '<div class="msg-artifact-hint" data-oey-object="chat.message-artifact-hint">▸ 本轮有新产出：' +
          escapeHtml(m.artifact.title) + '（已在预览区展示）</div>'
        : '';
      return '' +
        '<div class="msg ' + (isUser ? 'msg-user' : 'msg-agent') + '" data-oey-object="chat.message">' +
        '  <div class="msg-inner">' +
        '    <div class="msg-meta" data-oey-object="chat.message-meta">' +
        (isUser ? '我' : 'Agent') + ' · ' + escapeHtml(m.time || '') + '</div>' +
        '    <div class="msg-bubble" data-oey-object="chat.message-bubble">' + escapeHtml(m.text) + '</div>' +
        hint +
        '  </div>' +
        '</div>';
    }).join('');

    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function showTyping() {
    var div = document.createElement('div');
    div.className = 'msg msg-agent';
    div.id = 'typing-row';
    div.setAttribute('data-oey-object', 'chat.message');
    div.innerHTML = '<div class="msg-inner"><div class="msg-bubble">' +
      '<span class="typing"><i></i><i></i><i></i></span></div></div>';
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
  }
  function hideTyping() {
    var t = $('typing-row');
    if (t) t.remove();
  }

  function setBusy(busy) {
    state.sending = busy;
    els.send.disabled = busy;
    els.chatStatus.textContent = busy ? 'Agent 思考中…' : '就绪';
    els.chatStatus.classList.toggle('busy', busy);
  }

  /* ================= 预览区渲染 ================= */
  function latestArtifact(project) {
    if (!project) return null;
    for (var i = project.messages.length - 1; i >= 0; i--) {
      if (project.messages[i].artifact) return project.messages[i].artifact;
    }
    return null;
  }

  function renderPreview() {
    var p = state.current;
    var art = latestArtifact(p);

    if (!p || !art) {
      els.pvType.textContent = '—';
      els.pvBody.innerHTML = '<div class="preview-empty" data-oey-object="preview.empty">' +
        (p ? '这个项目还没有产出，发一条消息试试。' : '选择左侧项目后，这里会展示对应的产出。') + '</div>';
      els.pvMeta.textContent = '—';
      return;
    }

    els.pvType.textContent = KIND_LABEL[art.kind] || art.kind;
    els.pvMeta.textContent = '来源：' + p.name + ' · 更新于 ' + p.updatedAt;

    var html = '';
    if (art.kind === 'code') {
      html = '<div data-oey-object="preview.card">' +
        '<div class="pv-title" data-oey-object="preview.card-title">' + escapeHtml(art.title) + '</div>' +
        '<div class="pv-code"><div class="pv-code-head"><span class="dots"><i></i><i></i><i></i></span>' +
        escapeHtml(art.title) + '</div>' +
        '<pre data-oey-object="preview.card-body">' + escapeHtml(art.code) + '</pre></div></div>';
    } else if (art.kind === 'steps') {
      html = '<div data-oey-object="preview.card">' +
        '<div class="pv-title" data-oey-object="preview.card-title">' + escapeHtml(art.title) + '</div>' +
        '<div class="pv-steps" data-oey-object="preview.card-body">' +
        art.steps.map(function (s) {
          return '<div class="pv-step"><div class="pv-step-text">' + escapeHtml(s) + '</div></div>';
        }).join('') +
        '</div></div>';
    } else { // card
      var stats = (art.stats || []).map(function (s) {
        return '<div class="pv-stat"><div class="pv-stat-num">' + escapeHtml(s.num) + '</div>' +
          '<div class="pv-stat-label">' + escapeHtml(s.label) + '</div></div>';
      }).join('');
      html = '<div class="pv-card" data-oey-object="preview.card">' +
        '<div class="pv-title" data-oey-object="preview.card-title">' + escapeHtml(art.title) + '</div>' +
        '<div class="pv-desc" data-oey-object="preview.card-body">' + escapeHtml(art.desc).replace(/\n/g, '<br>') + '</div>' +
        (stats ? '<div class="pv-stats">' + stats + '</div>' : '') +
        '</div>';
    }
    els.pvBody.innerHTML = html;
  }

  /* ================= 交互 ================= */
  function selectProject(id) {
    if (state.sending || id === state.currentId) return;
    state.currentId = id;
    renderList(); // 先高亮，内容异步到达
    els.chatName.textContent = '加载中…';
    api.getProject(id).then(function (p) {
      if (state.currentId !== id) return; // 防止快速连点的竞态
      state.current = p;
      renderChat();
      renderPreview();
    });
  }

  function sendCurrentMessage() {
    var text = els.input.value.trim();
    if (!text || state.sending || !state.currentId) return;

    els.input.value = '';
    setBusy(true);

    // 乐观渲染用户消息
    state.current.messages.push({ role: 'user', text: text, time: '刚刚' });
    renderChat();
    showTyping();

    api.sendMessage(state.currentId, text).then(function (reply) {
      hideTyping();
      // 用服务端（mock）回包修正本地时间并追加 agent 回复
      var msgs = state.current.messages;
      msgs[msgs.length - 1].time = reply.time;
      msgs.push(reply);
      state.current.updatedAt = reply.time;

      // 同步列表摘要
      var summary = state.projects.filter(function (p) { return p.id === state.currentId; })[0];
      if (summary) {
        summary.lastMessage = reply.text.length > 30 ? reply.text.slice(0, 30) + '…' : reply.text;
        summary.updatedAt = reply.time;
      }

      setBusy(false);
      renderList();
      renderChat();
      renderPreview();
      els.input.focus();
    });
  }

  function createProject() {
    if (state.sending) return;
    var name = window.prompt('新项目名称：', '未命名项目');
    if (!name || !name.trim()) return;
    api.createProject(name.trim()).then(function (p) {
      state.projects.unshift({
        id: p.id, name: p.name, desc: p.desc, status: p.status,
        updatedAt: p.updatedAt,
        lastMessage: p.messages[p.messages.length - 1].text.slice(0, 30)
      });
      state.currentId = null; // 强制 selectProject 走完整加载
      selectProject(p.id);
      renderList();
    });
  }

  /* ================= 事件绑定 ================= */
  els.list.addEventListener('click', function (e) {
    var item = e.target.closest('.project-item[data-id]');
    if (item) selectProject(item.getAttribute('data-id'));
  });
  els.send.addEventListener('click', sendCurrentMessage);
  els.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });
  els.search.addEventListener('input', function () {
    state.keyword = els.search.value;
    renderList();
  });
  els.btnNew.addEventListener('click', createProject);

  /* ================= 启动 ================= */
  api.listProjects().then(function (list) {
    state.projects = list;
    renderList();
    if (list.length) selectProject(list[0].id);
  });
})();
