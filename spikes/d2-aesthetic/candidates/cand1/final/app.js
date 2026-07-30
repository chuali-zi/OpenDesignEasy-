/* ═══════════════════════════════════════════════════════════════
   OEYdesign · 远航台 VOYAGE HELM — 前端 mock 层 + 交互
   无真实后端：window.__mockApi__ 为模拟客户端，
   所有数据内联，所有"请求"经 setTimeout 模拟网络延迟。
   ═══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  /* ─────────── 1. 内联假数据（虚构 demo 项目） ─────────── */

  var DB = {
    projects: [
      {
        id: "voy-aurora",
        code: "VOY-03",
        name: "极光咖啡 · 秋季新品着陆页",
        status: "candidates",            // candidates | approved | inspecting | ready | delivered
        constraintPreset: "设计引导",
        templateRole: "起始脚手架",
        revision: 2,
        selectedCandidate: "c1",
        approvedCandidate: null,
        candidates: [
          {
            id: "c1", code: "HEADING-A",
            title: "「晨雾森林」叙事线",
            desc: "以产地雾林为开篇，慢节奏长滚动，冷绿灰配色，强调手冲仪式感。",
            palette: ["#2e4a3f", "#7fa08c", "#e6e2d6"],
            heroTitle: "雾散之前，咖啡已醒",
            heroText: "海拔 1,800 米的晨雾庄园，本季只烘 300 公斤。",
            cols: ["产地日志", "冲煮参数", "预约试饮"]
          },
          {
            id: "c2", code: "HEADING-B",
            title: "「都市补给站」叙事线",
            desc: "快节奏模块化排版，黑金对比，主打通勤场景的即取即走。",
            palette: ["#17130c", "#d8a24a", "#f2ede2"],
            heroTitle: "八分钟，从街角到工位",
            heroText: "秋季限定桂花冷萃，全城 42 个补给点同步上架。",
            cols: ["最近补给点", "本周豆单", "会员快线"]
          }
        ],
        quality: { hard: [], soft: [] },
        patchTargets: ["首屏主标题", "产地数据段", "价格与预约区", "页脚版权信息"],
        files: [
          { t: "dir", n: "aurora-landing/" },
          { t: "f", n: "brief.notes.md" },
          { t: "f", n: "constraints.profile.json" },
          { t: "dir", n: "candidates/" },
          { t: "f", n: "heading-a.preview.html" },
          { t: "f", n: "heading-b.preview.html" },
          { t: "dir", n: "evidence/" },
          { t: "f", n: "origin-facts.sheet" }
        ],
        log: [
          { time: "09:12", kind: "sys", text: "航次 VOY-03 建档，挂「起始脚手架」样板旗。" },
          { time: "09:14", kind: "agent", text: "解析模糊需求：「想要一个秋天感觉的咖啡页」→ 拆解出 2 条候选航向。" },
          { time: "09:31", kind: "agent", text: "HEADING-A / HEADING-B 候选校样已铺上海图桌，等待批示。" }
        ],
        records: [
          { tag: "FB", text: "<b>整体反馈 ×1</b>：首版被批「太像连锁品牌」，已废弃。" },
          { tag: "REV", text: "<b>R1 → R2</b>：按反馈重新生成两条候选航向。" }
        ]
      },
      {
        id: "voy-atlas",
        code: "VOY-07",
        name: "Atlas 咨询 · 年度行业报告 PPT",
        status: "inspecting",
        constraintPreset: "规范生产",
        templateRole: "交付合同",
        revision: 4,
        selectedCandidate: "c1",
        approvedCandidate: "c1",
        candidates: [
          {
            id: "c1", code: "HEADING-A",
            title: "「年鉴编辑部」叙事线",
            desc: "严肃栅格、衬线大标题、图表优先，符合交付合同中的版式条款。",
            palette: ["#1a2332", "#b03a2e", "#f4f1ea"],
            heroTitle: "2025 出海行业年鉴",
            heroText: "47 组数据 · 12 个深访 · 3 条趋势主线。",
            cols: ["趋势总览", "数据图集", "方法论附录"]
          }
        ],
        quality: {
          hard: [
            { ok: false, text: "第 9 页图表缺数据来源注记（合同条款 C-4）" },
            { ok: false, text: "附录页字体未嵌入，导出 PDF 会替换字形" }
          ],
          soft: [
            { text: "第 3 页大标题字距略紧，可放宽 2%" },
            { text: "章节页红色使用频次偏高，后半程可降温" }
          ]
        },
        patchTargets: ["第 3 页标题", "第 9 页图表", "附录页字体", "封底联系方式"],
        files: [
          { t: "dir", n: "atlas-report/" },
          { t: "f", n: "contract.terms.md" },
          { t: "f", n: "constraints.profile.json" },
          { t: "dir", n: "artifacts/" },
          { t: "f", n: "annual-report.r4.pptx" },
          { t: "dir", n: "quality/" },
          { t: "f", n: "inspection.r4.report" }
        ],
        log: [
          { time: "08:02", kind: "sys", text: "航次 VOY-07 建档，按「交付合同」样板旗锁定版式条款。" },
          { time: "10:40", kind: "user", text: "批准 HEADING-A 航向，进入正式产出。" },
          { time: "11:05", kind: "agent", text: "Artifact R4 产出完毕，转入出港检查。" },
          { time: "11:06", kind: "quality", text: "硬检查：2 处暗礁警报；审美轨道：2 条瞭望员笔记。" }
        ],
        records: [
          { tag: "APV", text: "<b>HEADING-A 获批准</b>，R4 为当前正式 Artifact。" },
          { tag: "QA", text: "<b>出港检查未过</b>：2 项硬错误待清礁。" },
          { tag: "FB", text: "<b>局部修补 ×2</b>：已处理图表配色、附录页码。" }
        ]
      },
      {
        id: "voy-tide",
        code: "VOY-11",
        name: "潮汐乐队 · 巡演纪录片网页",
        status: "ready",
        constraintPreset: "开放探索",
        templateRole: "参考样例",
        revision: 3,
        selectedCandidate: "c1",
        approvedCandidate: "c1",
        candidates: [
          {
            id: "c1", code: "HEADING-A",
            title: "「深夜电台」叙事线",
            desc: "暗底+噪点纹理，采访逐字稿与现场照片穿插，像一档深夜广播。",
            palette: ["#101418", "#4fb3a9", "#e8f1ef"],
            heroTitle: "浪把声音推上岸",
            heroText: "十四座城市，二十六场演出，一部跟拍了 218 天的纪录片。",
            cols: ["巡演地图", "逐字稿选段", "上线日期"]
          }
        ],
        quality: {
          hard: [],
          soft: [
            { text: "移动端下首屏视频海报帧可再压暗一档，突出标题" }
          ]
        },
        patchTargets: ["首屏视频区", "巡演地图", "逐字稿引文", "购票按钮"],
        files: [
          { t: "dir", n: "tide-doc/" },
          { t: "f", n: "references.moodboard.md" },
          { t: "f", n: "constraints.profile.json" },
          { t: "dir", n: "artifacts/" },
          { t: "f", n: "tide-doc-site.r3.html" },
          { t: "f", n: "assets.manifest" }
        ],
        log: [
          { time: "14:20", kind: "sys", text: "航次 VOY-11 建档，「开放探索」航行令，仅挂参考样例旗。" },
          { time: "15:47", kind: "user", text: "批准 HEADING-A：「就是这个深夜电台的感觉」。" },
          { time: "16:10", kind: "quality", text: "出港检查通过：0 硬错误，1 条审美笔记留存。" },
          { time: "16:10", kind: "sys", text: "R3 已具备出港资格，可交付导出。" }
        ],
        records: [
          { tag: "APV", text: "<b>HEADING-A 获批准</b>。" },
          { tag: "QA", text: "<b>出港检查通过</b>，无硬错误。" },
          { tag: "DLV", text: "<b>待交付</b>：等待船长下达离港令。" }
        ]
      }
    ]
  };

  /* ─────────── 2. mock 客户端：window.__mockApi__ ─────────── */

  var LATENCY = 260;

  function delay(fn, ms) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(fn()); }, ms == null ? LATENCY : ms);
    });
  }

  function findProject(id) {
    for (var i = 0; i < DB.projects.length; i++) {
      if (DB.projects[i].id === id) return DB.projects[i];
    }
    return null;
  }

  function nowTime() {
    var d = new Date();
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  function appendLog(p, kind, text) {
    p.log.push({ time: nowTime(), kind: kind, text: text });
  }

  window.__mockApi__ = {
    listProjects: function () {
      return delay(function () {
        return DB.projects.map(function (p) {
          return { id: p.id, code: p.code, name: p.name, status: p.status };
        });
      });
    },
    getProject: function (id) {
      return delay(function () { return findProject(id); });
    },
    /* 整体方向反馈：换叙事/语气/视觉 → 生成一条新候选航向 */
    submitDirectionFeedback: function (id, aspect, message) {
      return delay(function () {
        var p = findProject(id); if (!p) return null;
        appendLog(p, "user", "改航线令（换" + aspect + "）：" + message);
        p.records.unshift({ tag: "FB", text: "<b>整体反馈 · 换" + aspect + "</b>：" + escapeHtml(message) });
        p.status = "candidates";
        p.approvedCandidate = null;
        p.revision += 1;
        var n = p.candidates.length + 1;
        var neo = synthesizeCandidate(p, aspect, n);
        p.candidates.push(neo);
        p.selectedCandidate = neo.id;
        appendLog(p, "agent", "收到改航线令，废弃当前航向，新候选 " + neo.code + " 已生成（R" + p.revision + "）。");
        return p;
      }, 700);
    },
    /* 局部修补反馈：不动整体，只登记定点修正 */
    submitPatchFeedback: function (id, target, message) {
      return delay(function () {
        var p = findProject(id); if (!p) return null;
        appendLog(p, "user", "局部修补令（" + target + "）：" + message);
        p.records.unshift({ tag: "FB", text: "<b>局部修补 · " + escapeHtml(target) + "</b>：" + escapeHtml(message) });
        appendLog(p, "agent", "修补令已登记，将在当前航向上定点微调「" + target + "」，整体航线不变。");
        return p;
      }, 500);
    },
    approveCandidate: function (id, candId) {
      return delay(function () {
        var p = findProject(id); if (!p) return null;
        p.approvedCandidate = candId;
        p.selectedCandidate = candId;
        p.status = "inspecting";
        var c = p.candidates.filter(function (x) { return x.id === candId; })[0];
        appendLog(p, "user", "批准航向 " + c.code + "「" + c.title + "」，转入正式产出。");
        appendLog(p, "agent", "Artifact R" + p.revision + " 产出完毕，转入出港检查（硬检查 + 审美双轨）。");
        p.records.unshift({ tag: "APV", text: "<b>" + c.code + " 获批准</b>，R" + p.revision + " 为当前正式 Artifact。" });
        /* 模拟质量引擎跑一遭 */
        var qr = synthesizeQuality(p);
        p.quality = qr;
        appendLog(p, "quality", "出港检查结论：" + qr.hard.filter(function(h){return !h.ok;}).length + " 项暗礁警报，" + qr.soft.length + " 条瞭望员笔记。");
        if (qr.hard.every(function (h) { return h.ok; })) {
          p.status = "ready";
          appendLog(p, "sys", "无硬错误，R" + p.revision + " 具备出港资格。");
        }
        return p;
      }, 900);
    },
    deliver: function (id) {
      return delay(function () {
        var p = findProject(id); if (!p) return null;
        if (p.status !== "ready") return { error: "blocked" };
        p.status = "delivered";
        appendLog(p, "sys", "离港令下达：R" + p.revision + " 已导出交付，航次归档。");
        p.records.unshift({ tag: "DLV", text: "<b>已交付</b>：R" + p.revision + " 导出完成。" });
        return p;
      }, 600);
    },
    createProject: function (spec) {
      return delay(function () {
        var seq = DB.projects.length + 3;
        var code = "VOY-" + ("0" + (seq * 1 + 9)).slice(-2);
        var p = {
          id: "voy-" + Date.now(),
          code: code,
          name: spec.name,
          status: "candidates",
          constraintPreset: spec.preset,
          templateRole: spec.role,
          revision: 1,
          selectedCandidate: "c1",
          approvedCandidate: null,
          candidates: [synthesizeCandidate({ name: spec.name }, "初始", 1)],
          quality: { hard: [], soft: [] },
          patchTargets: ["首屏主标题", "核心数据段", "行动按钮区", "页脚信息"],
          files: [
            { t: "dir", n: spec.name.replace(/[·\s]/g, "-").toLowerCase() + "/" },
            { t: "f", n: "constraints.profile.json" },
            { t: "dir", n: "candidates/" },
            { t: "f", n: "heading-a.preview.html" }
          ],
          log: [
            { time: nowTime(), kind: "sys", text: "航次 " + code + " 在船坞登记，挂「" + spec.role + "」样板旗，航行令：" + spec.preset + "。" },
            { time: nowTime(), kind: "agent", text: "已生成首条候选航向 HEADING-A，铺上海图桌等待批示。" }
          ],
          records: [{ tag: "NEW", text: "<b>新航次登记</b>：" + escapeHtml(spec.name) }]
        };
        DB.projects.push(p);
        return p;
      }, 650);
    }
  };

  /* 由规则推导生成新候选（规则见 MOCK.md） */
  function synthesizeCandidate(p, aspect, n) {
    var MOODS = {
      "叙事": { title: "「逆行编年史」叙事线", desc: "倒叙结构：先抛结论，再逐层回溯证据，制造悬念感。", hero: "结局已定，故事才刚开始" },
      "语气": { title: "「老友耳语」叙事线", desc: "第二人称、短句、口语化，像朋友在吧台边讲给你听。", hero: "跟你讲个事，别外传" },
      "视觉": { title: "「纸上拼贴」叙事线", desc: "手撕纸边、胶带贴纸、留白呼吸感，拒绝栅格洁癖。", hero: "把灵感先贴在墙上" },
      "初始": { title: "「开阔海平线」叙事线", desc: "默认首航方案：大图开篇、三段式结构、稳妥节奏。", hero: p.name ? p.name.split("·")[0].trim() : "新航次", }
    };
    var PALETTES = [
      ["#223843", "#d8a24a", "#eff1f3"],
      ["#3b2f4a", "#e26d5a", "#f4efe6"],
      ["#1e3a34", "#4fb3a9", "#e8f1ef"]
    ];
    var m = MOODS[aspect] || MOODS["初始"];
    var pal = PALETTES[n % PALETTES.length];
    return {
      id: "c" + n + "-" + Date.now(),
      code: "HEADING-" + String.fromCharCode(64 + n),
      title: m.title,
      desc: m.desc + "（响应「换" + aspect + "」改航线令）",
      palette: pal,
      heroTitle: m.hero,
      heroText: "由 agent 依据最新反馈重新规划的第 " + n + " 条候选航向。",
      cols: ["栏目一", "栏目二", "栏目三"]
    };
  }

  /* 由规则推导生成质量结论（规则见 MOCK.md） */
  function synthesizeQuality(p) {
    var HARD_POOL = [
      "导出包缺少交付合同要求的来源注记",
      "有一处外链资源未本地化，离线环境会断图",
      "对比度抽测：一处正文/底色比值 3.1，低于 4.5 门槛"
    ];
    var SOFT_POOL = [
      "首屏视觉重心略偏左，可向右回 4%",
      "标题字号阶梯跨度过大，中间可补一档",
      "配图色温不统一，建议整体偏暖半档"
    ];
    var hard = [];
    var hardCount = p.revision % 3 === 0 ? 0 : 1; /* 规则：逢 3 倍数 revision 无硬错误 */
    for (var i = 0; i < hardCount; i++) hard.push({ ok: false, text: HARD_POOL[(p.revision + i) % HARD_POOL.length] });
    var soft = [{ text: SOFT_POOL[p.revision % SOFT_POOL.length] }];
    return { hard: hard, soft: soft };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ─────────── 3. 视图状态 + 渲染 ─────────── */

  var state = { currentId: null, current: null, view: "bridge", directionAspect: "叙事" };
  var $ = function (id) { return document.getElementById(id); };

  var STATUS_MAP = {
    candidates: { cls: "sailing", text: "在航 · 候选待批示" },
    inspecting: { cls: "review", text: "出港检查中" },
    ready: { cls: "ready", text: "具备出港资格" },
    delivered: { cls: "sailing", text: "已交付 · 归档" }
  };

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  function renderAll() {
    var p = state.current;
    renderHead(p);
    renderLog(p);
    renderNextMoves(p);
    renderChart(p);
    renderInstruments(p);
    renderPatchTargets(p);
  }

  function renderHead(p) {
    $("voyageCode").textContent = p ? p.code + " · " + p.name : "— 未挂旗 —";
    var dot = $("statusDot"), txt = $("statusText");
    if (!p) {
      dot.className = "flag-dot";
      txt.textContent = "锚泊中 · 无航次";
    } else {
      var s = STATUS_MAP[p.status] || STATUS_MAP.candidates;
      var blocked = p.status === "inspecting" && p.quality.hard.some(function (h) { return !h.ok; });
      dot.className = "flag-dot " + (blocked ? "blocked" : s.cls);
      txt.textContent = blocked ? "检查未过 · 硬错误挡港" : s.text;
    }
  }

  function renderLog(p) {
    $("logState").textContent = p
      ? p.code + " · " + p.constraintPreset + " · R" + p.revision
      : "NO VOYAGE · 无在航项目";
    var ol = $("logList");
    ol.innerHTML = "";
    if (!p) return;
    p.log.slice().reverse().forEach(function (e) {
      var li = document.createElement("li");
      li.innerHTML =
        '<span class="log-time">' + e.time + '</span>' +
        '<span class="log-kind k-' + e.kind + '">' + kindName(e.kind) + '</span>' +
        '<span class="log-text">' + escapeHtml(e.text) + "</span>";
      ol.appendChild(li);
    });
  }

  function kindName(k) {
    return { agent: "AGENT", user: "船长", sys: "系统", quality: "质检" }[k] || k;
  }

  function renderNextMoves(p) {
    var box = $("nextMoves");
    box.innerHTML = "";
    var moves = [];
    if (!p) {
      moves.push({ label: "去「船坞」登记新航次", tag: "DOCK", fn: function () { switchView("harbor"); } });
    } else if (p.status === "candidates") {
      moves.push({ label: "在海图桌挑选并批准一条航向", tag: "APV", fn: focusChart });
      moves.push({ label: "都不满意？发「改航线令」换方向", tag: "HAIL", fn: function () { $("directionText").focus(); } });
    } else if (p.status === "inspecting") {
      if (p.quality.hard.some(function (h) { return !h.ok; })) {
        moves.push({ label: "用「局部修补令」清除硬错误所指位置", tag: "FIX", fn: function () { $("patchText").focus(); } });
      }
    } else if (p.status === "ready") {
      moves.push({ label: "下达离港令 · 导出交付", tag: "DLV", fn: doDeliver });
    } else if (p.status === "delivered") {
      moves.push({ label: "航次已归档，可切换其它航线", tag: "LOG", fn: null, disabled: true });
    }
    moves.forEach(function (m) {
      var b = document.createElement("button");
      b.className = "move-btn";
      b.innerHTML = '<span class="mv-tag">[' + m.tag + "]</span>" + m.label;
      b.disabled = !!m.disabled;
      if (m.fn) b.addEventListener("click", m.fn);
      box.appendChild(b);
    });
  }

  function focusChart() {
    var el = document.querySelector(".cand-card.selected");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderChart(p) {
    var rail = $("candidateRail");
    var stage = $("proofStage");
    rail.innerHTML = "";
    if (!p) {
      $("revStamp").textContent = "REV —";
      stage.innerHTML = "";
      stage.appendChild(buildEmptySea());
      return;
    }
    $("revStamp").textContent = "REV R" + p.revision;
    p.candidates.forEach(function (c) {
      var card = document.createElement("div");
      card.className = "cand-card" +
        (p.selectedCandidate === c.id ? " selected" : "") +
        (p.approvedCandidate === c.id ? " approved" : "");
      var badge = p.approvedCandidate === c.id
        ? '<span class="cand-badge b-approved">已批准的航向</span>'
        : '<span class="cand-badge b-pending">候选 · 待批示</span>';
      var canApprove = p.status === "candidates" && p.approvedCandidate !== c.id;
      card.innerHTML =
        '<div class="cand-code">' + c.code + " · R" + p.revision + "</div>" +
        '<div class="cand-title">' + escapeHtml(c.title) + "</div>" +
        '<div class="cand-desc">' + escapeHtml(c.desc) + "</div>" +
        badge +
        '<div class="cand-actions">' +
          '<button class="mini-btn act-view">铺上海图桌</button>' +
          '<button class="mini-btn act-approve"' + (canApprove ? "" : " disabled") + ">批准此航向</button>" +
        "</div>";
      card.querySelector(".act-view").addEventListener("click", function (ev) {
        ev.stopPropagation();
        p.selectedCandidate = c.id;
        renderChart(p);
      });
      card.querySelector(".act-approve").addEventListener("click", function (ev) {
        ev.stopPropagation();
        doApprove(c.id);
      });
      rail.appendChild(card);
    });
    var sel = p.candidates.filter(function (c) { return c.id === p.selectedCandidate; })[0] || p.candidates[0];
    stage.innerHTML = "";
    stage.appendChild(buildProof(p, sel));
  }

  function buildEmptySea() {
    var d = document.createElement("div");
    d.className = "empty-sea";
    d.innerHTML =
      '<svg viewBox="0 0 64 64" class="empty-ico"><path d="M8 44c6-4 10-4 16 0s10 4 16 0 10-4 16 0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 52c6-4 10-4 16 0s10 4 16 0 10-4 16 0" fill="none" stroke="currentColor" stroke-width="2" opacity=".5"/><path d="M32 10v22M32 12l14 16H32" fill="none" stroke="currentColor" stroke-width="2"/></svg>' +
      "<p>海图桌空着。在左上方选定一条航线，或在「船坞」开辟新航次，候选设计会铺在这里。</p>";
    return d;
  }

  function buildProof(p, c) {
    var wrap = document.createElement("div");
    wrap.className = "proof-frame";
    var pal = c.palette;
    var cols = c.cols.map(function (t, i) {
      return '<div class="mock-col"><b>' + escapeHtml(t) + '</b>内容由 agent 依据证据基线填充。<div class="mock-bar" style="width:' + (60 + i * 15) + "%;background:" + pal[1] + '"></div></div>';
    }).join("");
    wrap.innerHTML =
      '<div class="proof-urlbar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
      "<span>proof://" + p.code.toLowerCase() + "/" + c.code.toLowerCase() + " · rev " + p.revision + "</span></div>" +
      '<div class="proof-body">' +
        '<div class="mock-hero" style="background:linear-gradient(120deg,' + pal[0] + "," + pal[0] + 'cc);color:' + pal[2] + '">' +
          "<h4>" + escapeHtml(c.heroTitle) + "</h4><p>" + escapeHtml(c.heroText) + "</p>" +
        "</div>" +
        '<div class="mock-cols">' + cols + "</div>" +
      "</div>" +
      '<div class="proof-caption"><span>' + escapeHtml(p.name) + " · " + escapeHtml(c.title) + '</span>' +
      '<span class="cap-flag">' + (p.approvedCandidate === c.id ? "★ 正式 Artifact" : "候选校样 · 未批准") + "</span></div>";
    return wrap;
  }

  function renderInstruments(p) {
    var ft = $("fileTree"), so = $("sailingOrders"),
        hl = $("hardList"), sl = $("softList"), rl = $("recordList");
    ft.innerHTML = ""; so.innerHTML = ""; hl.innerHTML = ""; sl.innerHTML = ""; rl.innerHTML = "";
    if (!p) {
      ft.innerHTML = '<li class="dir">（空仓）</li>';
      so.innerHTML = "<dt>航行令</dt><dd>—</dd>";
      hl.innerHTML = '<li class="ok">无航次，未检</li>';
      sl.innerHTML = '<li class="ok">无航次，未检</li>';
      return;
    }
    p.files.forEach(function (f) {
      var li = document.createElement("li");
      li.textContent = f.n;
      if (f.t === "dir") li.className = "dir";
      ft.appendChild(li);
    });
    so.innerHTML =
      "<dt>航行令</dt><dd>" + escapeHtml(p.constraintPreset) + "</dd>" +
      "<dt>样板旗</dt><dd>" + escapeHtml(p.templateRole) + "</dd>" +
      "<dt>航次编号</dt><dd class=\"mono\">" + p.code + "</dd>" +
      "<dt>当前修订</dt><dd class=\"mono\">R" + p.revision + "</dd>";
    /* 硬错误轨道 */
    if (p.status === "candidates") {
      hl.innerHTML = '<li class="ok">尚未批准航向，未启动检查</li>';
      sl.innerHTML = '<li class="ok">尚未批准航向，未启动检查</li>';
    } else {
      if (p.quality.hard.length === 0) {
        hl.innerHTML = '<li class="ok">0 项暗礁警报 · 硬检查通过</li>';
      } else {
        p.quality.hard.forEach(function (h) {
          var li = document.createElement("li");
          li.textContent = h.text;
          hl.appendChild(li);
        });
      }
      if (p.quality.soft.length === 0) {
        sl.innerHTML = '<li class="ok">暂无瞭望员笔记</li>';
      } else {
        p.quality.soft.forEach(function (s) {
          var li = document.createElement("li");
          li.textContent = s.text;
          sl.appendChild(li);
        });
      }
    }
    p.records.forEach(function (r) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="rec-tag">[' + r.tag + "]</span>" + r.text;
      rl.appendChild(li);
    });
  }

  function renderPatchTargets(p) {
    var sel = $("patchTarget");
    sel.innerHTML = "";
    var targets = p ? p.patchTargets : ["（先选定航线）"];
    targets.forEach(function (t) {
      var o = document.createElement("option");
      o.textContent = t;
      sel.appendChild(o);
    });
  }

  /* ─────────── 4. 动作 ─────────── */

  function loadProject(id) {
    if (!id) {
      state.currentId = null; state.current = null;
      renderAll();
      return;
    }
    window.__mockApi__.getProject(id).then(function (p) {
      state.currentId = id; state.current = p;
      renderAll();
      toast("已切换航线：" + p.code + " · " + p.name);
    });
  }

  function doApprove(candId) {
    if (!state.current) return;
    toast("批示传送中……");
    window.__mockApi__.approveCandidate(state.current.id, candId).then(function (p) {
      state.current = p;
      renderAll();
      var blocked = p.quality.hard.some(function (h) { return !h.ok; });
      toast(blocked ? "出港检查发现硬错误，已挡港" : "出港检查通过，具备出港资格");
    });
  }

  function doDeliver() {
    if (!state.current) return;
    window.__mockApi__.deliver(state.current.id).then(function (res) {
      if (res && res.error) { toast("存在硬错误，离港令被驳回"); return; }
      state.current = res;
      renderAll();
      toast("已离港 · 交付完成");
    });
  }

  /* ─────────── 5. 事件绑定 ─────────── */

  function switchView(v) {
    state.view = v;
    $("bridgeView").classList.toggle("hidden", v !== "bridge");
    $("harborView").classList.toggle("hidden", v !== "harbor");
    $("tabBridge").classList.toggle("active", v === "bridge");
    $("tabHarbor").classList.toggle("active", v === "harbor");
  }

  $("tabBridge").addEventListener("click", function () { switchView("bridge"); });
  $("tabHarbor").addEventListener("click", function () { switchView("harbor"); });

  $("projectSelect").addEventListener("change", function (e) {
    loadProject(e.target.value);
  });

  /* 改航线令：aspect 切换 */
  $("directionAspect").addEventListener("click", function (e) {
    var btn = e.target.closest(".seg-btn");
    if (!btn) return;
    this.querySelectorAll(".seg-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    state.directionAspect = btn.getAttribute("data-aspect");
  });

  $("formDirection").addEventListener("submit", function (e) {
    e.preventDefault();
    var ack = $("directionAck");
    if (!state.current) { ack.textContent = "⚠ 先在上方选定一条航线，才能发令。"; return; }
    var msg = $("directionText").value.trim();
    if (!msg) { ack.textContent = "⚠ 写一句你想换成的方向，再发令。"; return; }
    ack.textContent = "发令中……";
    window.__mockApi__.submitDirectionFeedback(state.current.id, state.directionAspect, msg).then(function (p) {
      state.current = p;
      renderAll();
      $("directionText").value = "";
      ack.textContent = "✓ 改航线令已送达，新候选已铺上海图桌。";
      toast("agent 已重新规划航向（R" + p.revision + "）");
    });
  });

  $("formPatch").addEventListener("submit", function (e) {
    e.preventDefault();
    var ack = $("patchAck");
    if (!state.current) { ack.textContent = "⚠ 先在上方选定一条航线，才能发令。"; return; }
    var msg = $("patchText").value.trim();
    if (!msg) { ack.textContent = "⚠ 写清楚要修什么，再发令。"; return; }
    ack.textContent = "发令中……";
    window.__mockApi__.submitPatchFeedback(state.current.id, $("patchTarget").value, msg).then(function (p) {
      state.current = p;
      renderAll();
      $("patchText").value = "";
      ack.textContent = "✓ 修补令已登记，将定点微调，不动整体航线。";
    });
  });

  /* 船坞表单 */
  function bindPick(rowId) {
    $(rowId).addEventListener("click", function (e) {
      var btn = e.target.closest(".pick");
      if (!btn) return;
      this.querySelectorAll(".pick").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
    });
  }
  bindPick("presetPick");
  bindPick("rolePick");

  $("formNewVoyage").addEventListener("submit", function (e) {
    e.preventDefault();
    var ack = $("harborAck");
    var name = $("newName").value.trim();
    if (!name) { ack.textContent = "⚠ 给航次起个名字。"; return; }
    var preset = document.querySelector("#presetPick .pick.active").getAttribute("data-value");
    var role = document.querySelector("#rolePick .pick.active").getAttribute("data-value");
    ack.textContent = "登记中……";
    window.__mockApi__.createProject({ name: name, preset: preset, role: role }).then(function (p) {
      return window.__mockApi__.listProjects().then(function (list) {
        rebuildSelect(list);
        $("projectSelect").value = p.id;
        $("newName").value = "";
        ack.textContent = "✓ 航次 " + p.code + " 登记完成，正在驶向驾驶台……";
        switchView("bridge");
        loadProject(p.id);
      });
    });
  });

  /* ─────────── 6. 启动 ─────────── */

  function rebuildSelect(list) {
    var sel = $("projectSelect");
    sel.innerHTML = "";
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "— 未选定航线 —";
    sel.appendChild(none);
    list.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.code + " · " + p.name;
      sel.appendChild(o);
    });
  }

  window.__mockApi__.listProjects().then(function (list) {
    rebuildSelect(list);
    renderAll();
  });

})();
