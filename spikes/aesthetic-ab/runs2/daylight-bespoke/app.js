/* OEYdesign 工作台 — mock 交互 */
(function () {
  "use strict";

  var page = document.getElementById("page");
  var overlay = document.getElementById("regOverlay");
  var regLabel = document.getElementById("regLabel");
  var canvas = document.getElementById("canvas");
  var artboard = document.getElementById("artboard");
  var chat = document.getElementById("chat");
  var toastEl = document.getElementById("toast");

  var pinnedEl = null;   // 被点击钉选的对象
  var hoverEl = null;    // 悬停临时指向的对象
  var toastTimer = null;

  /* ---------- Toast ---------- */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2200);
  }

  /* ---------- 套准锚点 ---------- */
  function positionOverlay(el) {
    var pr = page.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    overlay.style.left = (r.left - pr.left) + "px";
    overlay.style.top = (r.top - pr.top) + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";
    regLabel.textContent = el.getAttribute("data-oey-object");
    overlay.classList.add("on");
  }

  function repaint() {
    var el = hoverEl || pinnedEl;
    if (el) {
      positionOverlay(el);
    } else {
      overlay.classList.remove("on");
    }
  }

  function syncChipSelection() {
    var chips = document.querySelectorAll(".obj-chip");
    for (var i = 0; i < chips.length; i++) {
      var hit = pinnedEl && chips[i].getAttribute("data-target") === pinnedEl.getAttribute("data-oey-object");
      chips[i].classList.toggle("sel", !!hit);
    }
  }

  function pin(el) {
    if (pinnedEl === el) {
      pinnedEl = null; // 再点一次取消选中
    } else {
      pinnedEl = el;
    }
    syncChipSelection();
    repaint();
  }

  function findObject(id) {
    return page.querySelector('[data-oey-object="' + id + '"]');
  }

  function bindChip(chip) {
    var el = findObject(chip.getAttribute("data-target"));
    if (!el) return;
    chip.addEventListener("mouseenter", function () {
      hoverEl = el;
      repaint();
    });
    chip.addEventListener("mouseleave", function () {
      hoverEl = null;
      repaint();
    });
    chip.addEventListener("click", function () {
      pin(el);
      // 把对象滚动进画布视野
      var pr = page.getBoundingClientRect();
      var r = el.getBoundingClientRect();
      var target = canvas.scrollTop + (r.top - pr.top) - canvas.clientHeight / 2 + r.height / 2 + (pr.top - canvas.getBoundingClientRect().top + canvas.scrollTop - canvas.scrollTop);
      canvas.scrollTo({ top: Math.max(0, canvas.scrollTop + (r.top - canvas.getBoundingClientRect().top) - canvas.clientHeight / 2 + r.height / 2), behavior: "smooth" });
      setTimeout(repaint, 350);
    });
  }

  var chips = document.querySelectorAll(".obj-chip");
  for (var i = 0; i < chips.length; i++) bindChip(chips[i]);

  /* 画布内点击对象 -> 反向定位到 chip */
  var objs = page.querySelectorAll("[data-oey-object]");
  for (var j = 0; j < objs.length; j++) {
    (function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        pin(el);
      });
    })(objs[j]);
  }

  window.addEventListener("resize", repaint);

  /* ---------- 预览尺寸切换 ---------- */
  var devBtns = document.querySelectorAll(".dev-btn");
  for (var k = 0; k < devBtns.length; k++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        for (var m = 0; m < devBtns.length; m++) devBtns[m].classList.remove("is-on");
        btn.classList.add("is-on");
        artboard.className = "artboard w-" + btn.getAttribute("data-w");
        setTimeout(repaint, 240);
      });
    })(devBtns[k]);
  }

  /* ---------- 版本面板 ---------- */
  var versionsToggle = document.getElementById("versionsToggle");
  var versionList = document.getElementById("versionList");
  var vNow = document.getElementById("vNow");
  var tbVer = document.getElementById("tbVer");

  versionsToggle.addEventListener("click", function () {
    var open = versionList.hidden;
    versionList.hidden = !open;
    versionsToggle.setAttribute("aria-expanded", String(open));
  });

  function setCurrentVersion(v) {
    var rows = versionList.querySelectorAll(".version-row");
    for (var i = 0; i < rows.length; i++) {
      var isCur = rows[i].getAttribute("data-v") === v;
      rows[i].classList.toggle("is-current", isCur);
      var badge = rows[i].querySelector(".v-badge");
      if (isCur && !badge) {
        var b = document.createElement("span");
        b.className = "v-badge";
        b.textContent = "当前";
        rows[i].appendChild(b);
      } else if (!isCur && badge) {
        badge.remove();
      }
    }
    vNow.textContent = v + " 当前";
    tbVer.textContent = v;
  }

  versionList.addEventListener("click", function (e) {
    var row = e.target.closest(".version-row");
    if (!row) return;
    setCurrentVersion(row.getAttribute("data-v"));
    toast("已切换到 " + row.getAttribute("data-v") + "（mock）");
  });

  /* ---------- 导出 ---------- */
  function doExport() {
    toast("已导出 焙野咖啡-落地页-" + tbVer.textContent + ".zip（mock）");
  }
  document.getElementById("exportTop").addEventListener("click", doExport);
  document.getElementById("exportBench").addEventListener("click", doExport);

  /* ---------- 对话发送（mock 往返） ---------- */
  var composer = document.getElementById("composer");
  var input = document.getElementById("composerInput");
  var nextVersion = 5;

  function scrollChat() {
    chat.scrollTop = chat.scrollHeight;
  }

  function addUserTurn(text) {
    var turn = document.createElement("div");
    turn.className = "turn user";
    var meta = document.createElement("div");
    meta.className = "turn-meta";
    var who = document.createElement("span");
    who.className = "who";
    who.textContent = "你";
    var time = document.createElement("span");
    time.className = "mono time";
    time.textContent = "14:3" + Math.min(9, 5 + (nextVersion - 5));
    meta.appendChild(who);
    meta.appendChild(time);
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    turn.appendChild(meta);
    turn.appendChild(bubble);
    chat.appendChild(turn);
  }

  function addAgentTurn(vTag, htmlText, chipTarget) {
    var turn = document.createElement("div");
    turn.className = "turn agent";
    var spine = document.createElement("div");
    spine.className = "spine";
    var vchip = document.createElement("span");
    vchip.className = "mono vchip";
    vchip.textContent = vTag;
    var line = document.createElement("span");
    line.className = "spine-line";
    spine.appendChild(vchip);
    spine.appendChild(line);

    var body = document.createElement("div");
    body.className = "turn-body";
    var meta = document.createElement("div");
    meta.className = "turn-meta";
    var who = document.createElement("span");
    who.className = "who";
    who.textContent = "OEY";
    var time = document.createElement("span");
    time.className = "mono time";
    time.textContent = "14:3" + Math.min(9, 6 + (nextVersion - 5));
    meta.appendChild(who);
    meta.appendChild(time);
    var p = document.createElement("p");
    p.textContent = htmlText + " ";
    if (chipTarget) {
      var chip = document.createElement("button");
      chip.className = "obj-chip";
      chip.type = "button";
      chip.setAttribute("data-target", chipTarget);
      chip.textContent = chipTarget;
      p.appendChild(chip);
      bindChip(chip);
    }
    body.appendChild(meta);
    body.appendChild(p);
    turn.appendChild(spine);
    turn.appendChild(body);
    chat.appendChild(turn);
  }

  composer.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    addUserTurn(text);
    scrollChat();

    var v = "v" + nextVersion;
    setTimeout(function () {
      addAgentTurn(v, "收到，已按这条反馈处理并生成 " + v + "。点击引用可在画布上确认我定位的对象；若理解有偏差，直接指出即可。", "hero-title");
      // 版本列表追加新版本
      var li = document.createElement("li");
      li.className = "version-row";
      li.setAttribute("data-v", v);
      li.innerHTML = '<span class="mono v-tag">' + v + '</span>' +
        '<span class="v-desc">你的最新反馈</span>' +
        '<span class="mono v-time">14:3' + Math.min(9, 6 + (nextVersion - 5)) + '</span>';
      versionList.insertBefore(li, versionList.firstChild);
      setCurrentVersion(v);
      nextVersion++;
      scrollChat();
      toast("已生成 " + v + "（mock）");
    }, 800);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  /* ---------- 产物内订阅表单（内层自己的 mock） ---------- */
  var pSubForm = document.getElementById("pSubForm");
  var pSubNote = document.getElementById("pSubNote");
  pSubForm.addEventListener("submit", function (e) {
    e.preventDefault();
    pSubNote.textContent = "订阅成功，下一封月历随周三的豆子一起发出。";
  });

  /* 点击产物卡片按钮的反馈 */
  var cardBtns = page.querySelectorAll(".p-card-foot button");
  for (var c = 0; c < cardBtns.length; c++) {
    (function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        b.textContent = "已加入";
        setTimeout(function () { b.textContent = "加入清单"; }, 1200);
      });
    })(cardBtns[c]);
  }
})();