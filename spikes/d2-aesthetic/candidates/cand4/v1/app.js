/* ============================================================
 * AIRROOM · OEY 设计播控台
 * 纯前端 mock 层：window.__mockApi__
 * 所有数据内联于本文件，延迟用 setTimeout 模拟。
 * 详见 MOCK.md。
 * ============================================================ */
(function () {
  "use strict";

  /* ---------------- Mock 数据库（内联假数据） ---------------- */
  var DB = {
    projects: [
      {
        id: "p-lanting",
        name: "澜庭地产 · 品牌落地页",
        kind: "网页",
        status: "awaiting_feedback",
        revision: 3,
        constraint: {
          preset: "设计引导",
          role: "起始脚手架",
          notes: ["主色限定品牌蓝系", "单页长度 ≤ 5 屏", "允许生图配图，须标注来源"]
        },
        candidates: [
          { id: "c-lt-a", title: "方向 A · 极简编辑部", summary: "大留白、衬线标题、单栏叙事", seed: 11, state: "pending", notes: [] },
          { id: "c-lt-b", title: "方向 B · 都会霓虹", summary: "深色底、高对比、数据可视化开场", seed: 47, state: "pending", notes: [] },
          { id: "c-lt-c", title: "方向 C · 私邸画册", summary: "横向翻阅、大图满屏、弱文字", seed: 83, state: "rejected", notes: [
            { spot: "首屏主标题", text: "标题与 logo 距离过近", time: "13:58" }
          ]}
        ],
        quality: null,
        deliveries: [],
        events: [
          { time: "14:21", actor: "agent", kind: "candidate", text: "生成候选方向 A / B（REVISION 3），等待审阅" },
          { time: "14:20", actor: "system", kind: "revision", text: "进入 REVISION 3" },
          { time: "13:58", actor: "user", kind: "local-feedback", text: "局部微调：方向 C 首屏主标题与 logo 距离过近" },
          { time: "13:41", actor: "user", kind: "direction-feedback", text: "退回整体方向（视觉语言）：画册感过强，不像落地页" },
          { time: "13:12", actor: "agent", kind: "candidate", text: "生成候选方向 C（REVISION 2）" },
          { time: "12:50", actor: "agent", kind: "question", text: "澄清提问：落地页首要转化目标是预约到访还是留资？" },
          { time: "12:47", actor: "user", kind: "answer", text: "回复澄清：首要目标是预约到访" },
          { time: "12:02", actor: "system", kind: "create", text: "项目创建，载入约束档案「设计引导 / 起始脚手架」" }
        ],
        feedbackLog: [
          { type: "local", aspect: null, text: "标题与 logo 距离过近", spot: "首屏主标题", time: "13:58", rev: 2 },
          { type: "direction", aspect: "视觉语言", text: "画册感过强，不像落地页", spot: null, time: "13:41", rev: 2 }
        ]
      },
      {
        id: "p-keynote",
        name: "季度产品发布会 · 演示文稿",
        kind: "PPT",
        status: "in_review",
        revision: 5,
        constraint: {
          preset: "规范生产",
          role: "交付合同",
          notes: ["16:9，共 14 页", "字体仅允许系统栈", "所有数据须标注来源页脚"]
        },
        candidates: [
          { id: "c-kn-a", title: "选定方向 · 发布会叙事线", summary: "问题—解法—证据—路线图 四幕结构", seed: 29, state: "selected", notes: [
            { spot: "第 6 页图表", text: "柱状图配色与品牌色冲突", time: "11:20" }
          ]}
        ],
        quality: {
          hard: [
            { loc: "第 6 页 · 图表", text: "增长数据缺来源标注，违反约束「数据须标注来源页脚」" },
            { loc: "第 11 页 · 路线图", text: "出现未经确认的发布日期（2025-Q3），事实待核对" }
          ],
          aesthetic: [
            { loc: "第 3 页", text: "标题字距略紧，建议 +0.05em" },
            { loc: "第 8 页", text: "左右两栏视觉重量不均，右栏偏空" },
            { loc: "全局", text: "强调色出现 3 种色相，建议收敛到 2 种" }
          ]
        },
        deliveries: [],
        events: [
          { time: "15:03", actor: "system", kind: "hard", text: "质量复核：硬错误 ×2，导出已锁定" },
          { time: "15:03", actor: "system", kind: "review", text: "质量复核：审美发现 ×3（不挡交付）" },
          { time: "14:44", actor: "user", kind: "approve", text: "批准方向「发布会叙事线」，产出正式 Artifact" },
          { time: "14:10", actor: "agent", kind: "candidate", text: "生成候选（REVISION 5），融合第 6 页微调意见" },
          { time: "11:20", actor: "user", kind: "local-feedback", text: "局部微调：第 6 页图表配色与品牌色冲突" },
          { time: "10:02", actor: "system", kind: "create", text: "项目创建，载入约束档案「规范生产 / 交付合同」" }
        ],
        feedbackLog: [
          { type: "local", aspect: null, text: "柱状图配色与品牌色冲突", spot: "第 6 页图表", time: "11:20", rev: 4 }
        ]
      },
      {
        id: "p-whitepaper",
        name: "皓石科技 · 行业白皮书",
        kind: "文档",
        status: "delivered",
        revision: 2,
        constraint: {
          preset: "开放探索",
          role: "参考样例",
          notes: ["A4 竖版，预计 18–22 页", "中英双语摘要", "配图优先信息图，风格克制"]
        },
        candidates: [
          { id: "c-wp-a", title: "选定方向 · 研究报告体", summary: "章节导言 + 数据小节 + 页边批注", seed: 64, state: "selected", notes: [] }
        ],
        quality: { hard: [], aesthetic: [
          { loc: "第 9 页", text: "信息图灰度层级可再多一档" }
        ]},
        deliveries: [
          { time: "昨日 17:22", target: "PDF 导出", note: "REVISION 2 · 硬错误 0 通过后交付" }
        ],
        events: [
          { time: "昨日 17:22", actor: "system", kind: "delivery", text: "已交付：PDF 导出（REVISION 2）" },
          { time: "昨日 17:20", actor: "system", kind: "review", text: "质量复核通过：硬错误 0 · 审美发现 1（用户已确认接受）" },
          { time: "昨日 16:58", actor: "user", kind: "approve", text: "批准方向「研究报告体」" },
          { time: "昨日 15:30", actor: "agent", kind: "candidate", text: "生成候选（REVISION 2），含 4 张生图信息图（已标注来源）" },
          { time: "昨日 14:05", actor: "system", kind: "create", text: "项目创建，载入约束档案「开放探索 / 参考样例」" }
        ],
        feedbackLog: []
      },
      {
        id: "p-coffee",
        name: "山雾咖啡 · 小程序首页",
        kind: "网页",
        status: "needs_clarification",
        revision: 1,
        constraint: {
          preset: "设计引导",
          role: "设计系统",
          notes: ["移动端 375pt 基准", "沿用既有设计系统色板", "首屏必须露出会员入口"]
        },
        candidates: [],
        quality: null,
        deliveries: [],
        events: [
          { time: "16:12", actor: "agent", kind: "question", text: "澄清提问：首页主推「到店自取」还是「外卖配送」？两者信息架构不同，暂不生候选" },
          { time: "16:10", actor: "agent", kind: "analysis", text: "解析需求：描述模糊，关键转化路径缺失，触发主动提问" },
          { time: "15:55", actor: "user", kind: "create", text: "输入需求：「给咖啡店做个小程序首页，好看一点」" },
          { time: "15:55", actor: "system", kind: "create", text: "项目创建，载入约束档案「设计引导 / 设计系统」" }
        ],
        feedbackLog: []
      }
    ]
  };

  /* ---------------- Mock API ---------------- */
  function latency() { return 200 + Math.random() * 300; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function now() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function findProject(id) {
    for (var i = 0; i < DB.projects.length; i++) if (DB.projects[i].id === id) return DB.projects[i];
    return null;
  }
  var ASPECT_LABEL = { narrative: "叙事结构", tone: "语气口吻", visual: "视觉语言" };
  var CANDIDATE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  window.__mockApi__ = {
    listProjects: function () {
      return new Promise(function (res) {
        setTimeout(function () {
          res(clone(DB.projects.map(function (p) {
            return { id: p.id, name: p.name, kind: p.kind, status: p.status, revision: p.revision };
          })));
        }, latency());
      });
    },
    getProject: function (id) {
      return new Promise(function (res, rej) {
        setTimeout(function () {
          var p = findProject(id);
          if (p) res(clone(p)); else rej(new Error("project not found: " + id));
        }, latency());
      });
    },
    /* 粒度 A：整体方向退回 —— 候选全部作废，revision +1，2.6s 后模拟 agent 生成新候选 */
    submitDirectionFeedback: function (id, payload) {
      return new Promise(function (res) {
        setTimeout(function () {
          var p = findProject(id);
          if (!p) return res({ ok: false, error: "no project" });
          p.candidates.forEach(function (c) { c.state = "rejected"; });
          var aspectLabel = ASPECT_LABEL[payload.aspect] || payload.aspect;
          p.feedbackLog.unshift({ type: "direction", aspect: aspectLabel, text: payload.note || "（未附说明）", spot: null, time: now(), rev: p.revision });
          p.events.unshift({ time: now(), actor: "user", kind: "direction-feedback", text: "退回整体方向（" + aspectLabel + "）：" + (payload.note || "未附说明") });
          p.revision += 1;
          p.status = "generating";
          p.events.unshift({ time: now(), actor: "agent", kind: "revision", text: "收到整体方向退回，进入 REVISION " + p.revision + "，重新生成中…" });
          res({ ok: true, revision: p.revision });
          setTimeout(function () {
            var letter = CANDIDATE_LETTERS[p.candidates.length % 26];
            p.candidates.push({
              id: "c-gen-" + Math.random().toString(36).slice(2, 8),
              title: "方向 " + letter + " · 按反馈重生成",
              summary: "基于「" + aspectLabel + "」反馈重新生成的候选（mock）",
              seed: Math.floor(Math.random() * 900) + 10,
              state: "pending",
              notes: []
            });
            p.status = "awaiting_feedback";
            p.events.unshift({ time: now(), actor: "agent", kind: "candidate", text: "已根据整体方向反馈生成新候选（REVISION " + p.revision + "，模拟）" });
            if (state.currentId === p.id) renderProject(p.id);
          }, 2600);
        }, latency());
      });
    },
    /* 粒度 B：局部微调 —— 挂在指定候选上，不影响整体方向与 revision */
    submitLocalFeedback: function (id, payload) {
      return new Promise(function (res) {
        setTimeout(function () {
          var p = findProject(id);
          if (!p) return res({ ok: false, error: "no project" });
          var c = null;
          p.candidates.forEach(function (x) { if (x.id === payload.candidateId) c = x; });
          if (!c) return res({ ok: false, error: "no candidate" });
          var entry = { spot: payload.spot || "（未指定位置）", text: payload.note || "（无内容）", time: now() };
          c.notes.push(entry);
          p.feedbackLog.unshift({ type: "local", aspect: null, text: entry.text, spot: c.title + " · " + entry.spot, time: now(), rev: p.revision });
          p.events.unshift({ time: now(), actor: "user", kind: "local-feedback", text: "局部微调：" + c.title + " · " + entry.spot + " —— " + entry.text });
          res({ ok: true, noteCount: c.notes.length });
        }, latency());
      });
    },
    exportArtifact: function (id) {
      return new Promise(function (res) {
        setTimeout(function () {
          var p = findProject(id);
          if (!p || !p.quality) return res({ ok: false, error: "no artifact" });
          if (p.quality.hard.length > 0) return res({ ok: false, error: "hard errors remain" });
          p.status = "delivered";
          p.deliveries.unshift({ time: now(), target: "导出包（mock）", note: "REVISION " + p.revision + " · 硬错误 0 通过后交付" });
          p.events.unshift({ time: now(), actor: "system", kind: "delivery", text: "已交付：导出包（REVISION " + p.revision + "，模拟）" });
          res({ ok: true });
        }, latency());
      });
    }
  };

  /* ---------------- 状态映射 ---------------- */
  var STATUS_LABEL = {
    awaiting_feedback: "候选待审",
    needs_clarification: "待澄清",
    in_review: "质量复核中",
    approved: "已通过",
    delivered: "已交付",
    generating: "生成中"
  };
  var CAND_STATE = { pending: "待审", rejected: "已退回", selected: "已选定" };
  var ACTOR_LABEL = { agent: "AGENT", user: "USER", system: "SYS" };

  var state = { currentId: null };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 缩略预览：由 seed 确定性推导 ---------------- */
  function seededRand(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  var PALETTES = [
    ["#1f3a5f", "#58a6ff", "#d7dde6", "#0e1622"],
    ["#3d2c1e", "#ffb224", "#e8dcc8", "#171310"],
    ["#1e3d33", "#3fb950", "#d7e6dd", "#101714"],
    ["#33244d", "#bc8cff", "#e2d9f2", "#14101c"]
  ];
  function renderThumb(container, seed, label) {
    container.innerHTML = "";
    var frame = document.createElement("div");
    frame.className = "thumb-frame";
    var rnd = seededRand(seed);
    var pal = PALETTES[Math.floor(rnd() * PALETTES.length)];
    frame.style.background = pal[3];
    /* 标题条 */
    var bar = document.createElement("div");
    bar.className = "thumb-block";
    bar.style.cssText = "left:6%;top:8%;width:" + (30 + rnd() * 30) + "%;height:7%;background:" + pal[1];
    frame.appendChild(bar);
    /* 内容块 4-7 个 */
    var n = 4 + Math.floor(rnd() * 4);
    for (var i = 0; i < n; i++) {
      var b = document.createElement("div");
      b.className = "thumb-block";
      var w = 12 + rnd() * 30, h = 8 + rnd() * 22;
      b.style.cssText = "left:" + (5 + rnd() * (88 - w)) + "%;top:" + (22 + rnd() * (70 - h)) +
        "%;width:" + w + "%;height:" + h + "%;background:" + pal[Math.floor(rnd() * 3)] +
        ";opacity:" + (0.35 + rnd() * 0.6);
      frame.appendChild(b);
    }
    var tag = document.createElement("span");
    tag.className = "thumb-label";
    tag.textContent = label;
    frame.appendChild(tag);
    container.appendChild(frame);
  }

  /* ---------------- 渲染 ---------------- */
  function setLoading(on) {
    var panels = document.querySelectorAll(".panel");
    for (var i = 0; i < panels.length; i++) panels[i].classList.toggle("loading", on);
  }

  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = msg;
    $("toast-host").appendChild(t);
    setTimeout(function () { t.remove(); }, 3400);
  }

  function renderProjectList(list) {
    $("projects-count").textContent = list.length + " 个项目";
    var sel = $("project-switch");
    sel.innerHTML = "";
    var ul = $("project-list");
    ul.innerHTML = "";
    list.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === state.currentId) opt.selected = true;
      sel.appendChild(opt);

      var li = document.createElement("li");
      li.className = "project-item" + (p.id === state.currentId ? " active" : "");
      li.setAttribute("data-oey-object", "projects.item");
      li.dataset.id = p.id;
      li.innerHTML =
        '<div class="p-name"></div>' +
        '<div class="p-row"><span class="p-kind"></span>' +
        '<span class="status-chip st-' + p.status + '">' + (STATUS_LABEL[p.status] || p.status) + '</span></div>' +
        '<div class="p-row"><span>REVISION ' + p.revision + '</span><span>' + p.id + '</span></div>';
      li.querySelector(".p-name").textContent = p.name;
      li.querySelector(".p-kind").textContent = p.kind;
      li.addEventListener("click", function () { selectProject(p.id); });
      ul.appendChild(li);
    });
  }

  function renderPreview(p) {
    $("preview-revision").textContent = "REVISION " + p.revision + " · " + (STATUS_LABEL[p.status] || p.status);
    var canvas = $("preview-canvas");
    var empty = $("preview-empty");
    var active = p.candidates.filter(function (c) { return c.state !== "rejected"; });
    var selected = null;
    for (var i = 0; i < active.length; i++) if (active[i].state === "selected") selected = active[i];
    if (!selected && active.length) selected = active[0];

    if (!selected) {
      canvas.style.display = "none";
      empty.hidden = false;
      $("preview-empty-sub").textContent =
        p.status === "needs_clarification"
          ? "agent 判断需求信息不足，已在过程记录中提出澄清问题，回复后才会生成候选。"
          : "该项目还没有生成候选方向。";
    } else {
      empty.hidden = true;
      canvas.style.display = "flex";
      renderThumb(canvas, selected.seed, selected.title + " · REVISION " + p.revision);
    }

    var strip = $("candidate-strip");
    strip.innerHTML = "";
    p.candidates.forEach(function (c) {
      var li = document.createElement("li");
      li.className = "candidate-card " + c.state + (selected && c.id === selected.id ? " selected" : "");
      li.setAttribute("data-oey-object", "preview.candidate-item");
      var notesBadge = c.notes.length ? '<span class="c-notes-badge">微调 ×' + c.notes.length + "</span>" : "<span></span>";
      li.innerHTML =
        '<div class="c-title"></div><div class="c-summary"></div>' +
        '<div class="c-meta"><span class="c-state-' + c.state + '">' + CAND_STATE[c.state] + "</span>" + notesBadge + "</div>";
      li.querySelector(".c-title").textContent = c.title;
      li.querySelector(".c-summary").textContent = c.summary;
      li.addEventListener("click", function () {
        if (c.state === "rejected") return;
        strip.querySelectorAll(".candidate-card").forEach(function (x) { x.classList.remove("selected"); });
        li.classList.add("selected");
        renderThumb(canvas, c.seed, c.title + " · REVISION " + p.revision);
      });
      strip.appendChild(li);
    });

    /* 局部反馈表单的候选下拉同步 */
    var fbSel = $("fb-local-candidate");
    fbSel.innerHTML = "";
    var targets = p.candidates.filter(function (c) { return c.state !== "rejected"; });
    if (!targets.length) {
      var o = document.createElement("option");
      o.value = ""; o.textContent = "（无可反馈的候选）";
      fbSel.appendChild(o);
    }
    targets.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id; o.textContent = c.title;
      fbSel.appendChild(o);
    });
  }

  function renderTimeline(p) {
    $("timeline-count").textContent = p.events.length + " 条";
    var ul = $("timeline-list");
    ul.innerHTML = "";
    p.events.forEach(function (e) {
      var li = document.createElement("li");
      li.className = "timeline-item kind-" + e.kind;
      li.setAttribute("data-oey-object", "timeline.item");
      li.innerHTML =
        '<span class="t-time"></span>' +
        '<span class="t-actor actor-' + e.actor + '">' + ACTOR_LABEL[e.actor] + "</span>" +
        '<span class="t-text"></span>';
      li.querySelector(".t-time").textContent = e.time;
      li.querySelector(".t-text").textContent = e.text;
      ul.appendChild(li);
    });
  }

  function renderConstraints(p) {
    $("constraint-preset").textContent = p.constraint.preset;
    $("constraint-role").textContent = p.constraint.role;
    var ul = $("constraint-notes");
    ul.innerHTML = "";
    p.constraint.notes.forEach(function (n) {
      var li = document.createElement("li");
      li.textContent = n;
      ul.appendChild(li);
    });
  }

  function renderQuality(p) {
    var hardList = $("hard-list"), aesList = $("aesthetic-list");
    hardList.innerHTML = ""; aesList.innerHTML = "";
    var exportBtn = $("export-btn"), exportState = $("export-state");

    if (!p.quality) {
      $("hard-count").textContent = "—";
      $("aesthetic-count").textContent = "—";
      hardList.innerHTML = '<li class="track-empty">尚无质量结论：需先批准方向、产出正式 Artifact 后进入复核。</li>';
      aesList.innerHTML = '<li class="track-empty">—</li>';
      exportState.textContent = "导出：未进入复核";
      exportState.className = "export-state";
      exportBtn.disabled = true;
      return;
    }
    var hard = p.quality.hard, aes = p.quality.aesthetic;
    $("hard-count").textContent = hard.length;
    $("aesthetic-count").textContent = aes.length;
    if (!hard.length) hardList.innerHTML = '<li class="track-empty">硬错误 0 · 客观轨道通过</li>';
    hard.forEach(function (q) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="q-loc"></span><span class="q-text"></span>';
      li.querySelector(".q-loc").textContent = q.loc;
      li.querySelector(".q-text").textContent = q.text;
      hardList.appendChild(li);
    });
    if (!aes.length) aesList.innerHTML = '<li class="track-empty">无审美发现</li>';
    aes.forEach(function (q) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="q-loc"></span><span class="q-text"></span>';
      li.querySelector(".q-loc").textContent = q.loc;
      li.querySelector(".q-text").textContent = q.text;
      aesList.appendChild(li);
    });

    if (p.status === "delivered") {
      exportState.textContent = "导出：已交付";
      exportState.className = "export-state open";
      exportBtn.disabled = true;
    } else if (hard.length > 0) {
      exportState.textContent = "导出：已锁定（硬错误 ×" + hard.length + "）";
      exportState.className = "export-state locked";
      exportBtn.disabled = true;
    } else {
      exportState.textContent = "导出：可交付（审美发现不挡交付）";
      exportState.className = "export-state open";
      exportBtn.disabled = false;
    }
  }

  function renderDelivery(p) {
    $("delivery-count").textContent = p.deliveries.length;
    var ul = $("delivery-list");
    ul.innerHTML = "";
    if (!p.deliveries.length) {
      ul.innerHTML = '<li class="delivery-empty">尚无交付记录</li>';
      return;
    }
    p.deliveries.forEach(function (d) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="d-body"></span><span class="d-time"></span>';
      li.querySelector(".d-body").textContent = d.target + " · " + d.note;
      li.querySelector(".d-time").textContent = d.time;
      ul.appendChild(li);
    });
  }

  function renderFeedbackLog(p) {
    var ul = $("feedback-log");
    ul.innerHTML = "";
    if (!p.feedbackLog.length) {
      ul.innerHTML = '<li class="delivery-empty">暂无反馈记录</li>';
      return;
    }
    p.feedbackLog.forEach(function (f) {
      var li = document.createElement("li");
      var tag = f.type === "direction" ? "整体方向" : "局部微调";
      li.innerHTML =
        '<span class="fl-tag ' + f.type + '">' + tag + "</span>" +
        '<span class="fl-text"></span>' +
        '<span class="fl-meta"></span>';
      li.querySelector(".fl-text").textContent = (f.aspect ? f.aspect + " · " : "") + f.text;
      li.querySelector(".fl-meta").textContent =
        (f.spot ? f.spot + " · " : "") + "REV " + f.rev + " · " + f.time;
      ul.appendChild(li);
    });
  }

  function renderTopbar(p) {
    var chip = $("topbar-status-chip");
    chip.textContent = STATUS_LABEL[p.status] || p.status;
    chip.className = "status-chip st-" + p.status;
    $("topbar-rev").textContent = p.name + " · REVISION " + p.revision;
  }

  function renderAll(p) {
    renderTopbar(p);
    renderPreview(p);
    renderTimeline(p);
    renderConstraints(p);
    renderQuality(p);
    renderDelivery(p);
    renderFeedbackLog(p);
  }

  function renderProject(id) {
    setLoading(true);
    Promise.all([window.__mockApi__.listProjects(), window.__mockApi__.getProject(id)])
      .then(function (r) {
        renderProjectList(r[0]);
        renderAll(r[1]);
        setLoading(false);
      })
      .catch(function (e) {
        setLoading(false);
        toast("加载失败：" + e.message, "err");
      });
  }

  function selectProject(id) {
    if (id === state.currentId) return;
    state.currentId = id;
    renderProject(id);
  }

  /* ---------------- 事件绑定 ---------------- */
  $("project-switch").addEventListener("change", function (e) {
    selectProject(e.target.value);
  });

  $("fb-direction-submit").addEventListener("click", function () {
    var note = $("fb-direction-note").value.trim();
    var aspect = $("fb-direction-aspect").value;
    var btn = this;
    btn.disabled = true;
    window.__mockApi__.submitDirectionFeedback(state.currentId, { aspect: aspect, note: note })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) return toast("提交失败：" + r.error, "err");
        $("fb-direction-note").value = "";
        toast("已退回整体方向（" + (ASPECT_LABEL[aspect] || aspect) + "），agent 正在重新生成候选…");
        renderProject(state.currentId);
      });
  });

  $("fb-local-submit").addEventListener("click", function () {
    var candidateId = $("fb-local-candidate").value;
    var spot = $("fb-local-spot").value.trim();
    var note = $("fb-local-note").value.trim();
    if (!candidateId) return toast("当前项目没有可反馈的候选", "err");
    if (!note) return toast("请填写微调意见内容", "err");
    var btn = this;
    btn.disabled = true;
    window.__mockApi__.submitLocalFeedback(state.currentId, { candidateId: candidateId, spot: spot, note: note })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) return toast("提交失败：" + r.error, "err");
        $("fb-local-spot").value = "";
        $("fb-local-note").value = "";
        toast("微调意见已记录到候选（该候选现有 " + r.noteCount + " 条意见）", "ok");
        renderProject(state.currentId);
      });
  });

  $("export-btn").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    window.__mockApi__.exportArtifact(state.currentId).then(function (r) {
      if (!r.ok) { btn.disabled = false; return toast("导出被拒绝：" + r.error, "err"); }
      toast("导出完成，已写入交付记录（模拟）", "ok");
      renderProject(state.currentId);
    });
  });

  /* 顶栏时钟 */
  setInterval(function () {
    var d = new Date();
    $("topbar-clock").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }, 1000);

  /* ---------------- 启动 ---------------- */
  window.__mockApi__.listProjects().then(function (list) {
    state.currentId = list[0].id;
    renderProject(state.currentId);
  });
})();
