(function () {
  var stage   = document.getElementById('stage');
  var scaler  = document.getElementById('scaler');
  var art     = document.getElementById('artboard');
  var overlay = document.getElementById('regOverlay');
  var label   = overlay.querySelector('.reg-label');
  var bench   = document.getElementById('bench');
  var msgs    = document.getElementById('msgs');
  var toastEl = document.getElementById('toast');

  var pinned = null;
  var toastTimer = null;

  /* ---------- 套准锚点：定位角标到目标对象 ---------- */
  function place(id) {
    var t = art.querySelector('[data-oey-object="' + id + '"]');
    if (!t) { overlay.classList.remove('on'); return; }
    var sr = stage.getBoundingClientRect();
    var r  = t.getBoundingClientRect();
    overlay.style.left   = (r.left - sr.left - 8) + 'px';
    overlay.style.top    = (r.top  - sr.top  - 8) + 'px';
    overlay.style.width  = (r.width  + 16) + 'px';
    overlay.style.height = (r.height + 16) + 'px';
    label.textContent = id;
    overlay.classList.add('on');
  }
  function hide() { overlay.classList.remove('on'); }

  function refreshChips() {
    document.querySelectorAll('.obj-chip').forEach(function (c) {
      c.classList.toggle('pinned', c.dataset.target === pinned);
    });
  }
  function pin(id)   { pinned = id; refreshChips(); place(id); }
  function unpin()   { pinned = null; refreshChips(); hide(); }

  /* 对话内 chip：悬停预览，点击常驻（事件委托，覆盖后续新增消息） */
  msgs.addEventListener('mouseover', function (e) {
    var c = e.target.closest('.obj-chip');
    if (c) place(c.dataset.target);
  });
  msgs.addEventListener('mouseout', function (e) {
    var c = e.target.closest('.obj-chip');
    if (c) { pinned ? place(pinned) : hide(); }
  });
  msgs.addEventListener('click', function (e) {
    var c = e.target.closest('.obj-chip');
    if (!c) return;
    pinned === c.dataset.target ? unpin() : pin(c.dataset.target);
  });

  /* 画板内直接点选对象 → 常驻角标 */
  art.addEventListener('click', function (e) {
    var o = e.target.closest('[data-oey-object]');
    if (o) pin(o.dataset.oeyObject);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') unpin();
  });
  window.addEventListener('resize', function () { if (pinned) place(pinned); });
  bench.addEventListener('scroll', function () { if (pinned) place(pinned); });

  /* ---------- 视图宽度 ---------- */
  var views = { desktop: 920, tablet: 720, phone: 400 };
  document.querySelectorAll('.view-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.view-btn').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      art.style.width = views[b.dataset.view] + 'px';
      setTimeout(function () { applyZoom(); if (pinned) place(pinned); }, 300);
    });
  });

  /* ---------- 缩放 ---------- */
  var levels = [0.75, 1, 1.25], zi = 1;
  var zoomPct = document.getElementById('zoomPct');
  function applyZoom() {
    var s = levels[zi];
    scaler.style.transform = 'scale(' + s + ')';
    scaler.style.transformOrigin = 'top left';
    scaler.style.width  = art.offsetWidth  * s + 'px';
    scaler.style.height = art.offsetHeight * s + 'px';
    zoomPct.textContent = Math.round(s * 100) + '%';
    if (pinned) requestAnimationFrame(function () { place(pinned); });
  }
  document.getElementById('zoomOut').addEventListener('click', function () {
    if (zi > 0) { zi--; applyZoom(); }
  });
  document.getElementById('zoomIn').addEventListener('click', function () {
    if (zi < levels.length - 1) { zi++; applyZoom(); }
  });
  window.addEventListener('load', applyZoom);
  applyZoom();

  /* ---------- 版本面板（默认收起，点开即有内容） ---------- */
  var verToggle = document.getElementById('verToggle');
  var verPanel  = document.getElementById('verPanel');
  verToggle.addEventListener('click', function (e) {
    e.stopPropagation();
    verPanel.classList.toggle('hidden');
  });
  verPanel.addEventListener('click', function (e) {
    var row = e.target.closest('.ver-row');
    if (row) toast('已切换到 ' + row.dataset.ver + ' 预览（mock），当前交付版本仍为 v4');
  });

  /* ---------- 导出 ---------- */
  var expBtn  = document.getElementById('expBtn');
  var expMenu = document.getElementById('expMenu');
  expBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    expMenu.classList.toggle('hidden');
  });
  expMenu.addEventListener('click', function (e) {
    var item = e.target.closest('.exp-item');
    if (item) {
      toast('已加入导出队列：' + item.dataset.file + '（mock）');
      expMenu.classList.add('hidden');
    }
  });
  document.addEventListener('click', function () {
    expMenu.classList.add('hidden');
    verPanel.classList.add('hidden');
  });

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------- 对话：发送 + mock agent 回应 ---------- */
  var composer = document.getElementById('composer');
  var input    = document.getElementById('input');

  var keywords = [
    ['副标题', 'hero-sub'], ['标题', 'hero-title'],
    ['按钮', 'cta-primary'], ['购买', 'cta-primary'],
    ['价格', 'pricing-card-3'], ['推荐', 'pricing-card-3'], ['订阅', 'pricing-card-3'],
    ['导航', 'nav-store-link'], ['门店', 'nav-store-link'],
    ['页脚', 'footer-legal'], ['备案', 'footer-legal']
  ];

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function scrollBottom() { msgs.scrollTop = msgs.scrollHeight; }

  function appendUser(text) {
    var d = document.createElement('div');
    d.className = 'msg';
    d.innerHTML =
      '<div class="flex items-baseline gap-2">' +
        '<span class="text-14 font-semibold">你</span>' +
        '<span class="font-mono text-12 text-ink-muted">刚刚</span>' +
      '</div>' +
      '<p class="mt-1 text-14 leading-relaxed">' + esc(text) + '</p>';
    msgs.appendChild(d);
    scrollBottom();
  }

  function appendTyping() {
    var d = document.createElement('div');
    d.className = 'msg-agent';
    d.innerHTML = '<span class="lead"></span>' +
      '<div class="flex-1 min-w-0"><span class="typing"><i></i><i></i><i></i></span></div>';
    msgs.appendChild(d);
    scrollBottom();
    return d;
  }

  function appendAgent(text) {
    var chipId = null;
    for (var i = 0; i < keywords.length; i++) {
      if (text.indexOf(keywords[i][0]) !== -1) { chipId = keywords[i][1]; break; }
    }
    var body = chipId
      ? '收到，我会在 v5 中处理。涉及对象 <button type="button" class="obj-chip" data-target="' + chipId + '">' + chipId + '</button> ，已先在画板上用角标标出，方便你确认我要改的是不是它。'
      : '收到，我会在 v5 中处理。这条属于整体调整，改完我会逐条说明涉及的对象，并用角标逐一标出。';

    var d = document.createElement('div');
    d.className = 'msg-agent';
    d.innerHTML =
      '<span class="lead"></span>' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-baseline gap-2">' +
          '<span class="text-14 font-semibold">OEY</span>' +
          '<span class="ver">v5</span>' +
          '<span class="font-mono text-12 text-ink-muted">刚刚</span>' +
        '</div>' +
        '<p class="mt-1 text-14 leading-relaxed">' + body + '</p>' +
      '</div>';
    msgs.appendChild(d);
    scrollBottom();
    if (chipId) pin(chipId);
  }

  composer.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value.trim();
    if (!v) return;
    appendUser(v);
    input.value = '';
    var t = appendTyping();
    setTimeout(function () { t.remove(); appendAgent(v); }, 900);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });
})();