/* ============================================================
   DARKROOM · OEYdesign agent 工作台（纯前端 mock 原型）
   mock 实现：内存数据 + window.__oeyMock__ 假客户端 +
   setTimeout 模拟网络延迟。无任何外部依赖。
   ============================================================ */

(function () {
  "use strict";

  /* ----------------------------------------------------------
   * 1. Mock 数据层（数据声明详见 MOCK.md）
   * ---------------------------------------------------------- */

  var DB = {
    projects: [
      {
        id: "p-tea",
        name: "霓虹茶室 · 品牌官网",
        medium: "网页",
        status: "方向待确认",
        preset: "设计引导",
        role: "起始脚手架",
        revision: 3,
        activeCandidateId: "a",
        nextStep: "在两个候选方向中选定一个，或投递整体方向反馈要求换一批。",
        candidates: [
          {
            id: "a",
            label: "候选 A",
            concept: "夜色茶单 · 深沉暖调，强调营业至凌晨的城市感",
            palette: ["#1a120c", "#e8a33d", "#f0e7d8", "#6e4a2a"],
            page: {
              bg: "#1a120c", fg: "#f0e7d8", accent: "#e8a33d",
              heroImg: "linear-gradient(135deg,#3a2410 0%,#e8a33d 130%,#5a3418 100%)",
              logo: "霓虹茶室",
              links: ["茶单", "空间", "预约"],
              h1: "把夜晚泡进一盏茶里",
              sub: "营业至凌晨两点的城市茶室。今晚供应：焙火乌龙、冷萃白牡丹。",
              cta: "查看今晚茶单",
              cards: [
                { t: "深夜茶单", d: "22:00 后限定三支茶，配一份手写笺。" },
                { t: "吧台预约", d: "仅八个位置，建议提前一天留位。" },
                { t: "茶寄服务", d: "当月茶样可邮寄，附冲泡卡。" }
              ],
              text: "我们相信茶不只属于白天。霓虹茶室想把「夜里也有一个安静去处」这件事，做得像街灯一样理所当然。",
              footer: "NEON TEAHOUSE · 02:00 CLOSE"
            }
          },
          {
            id: "b",
            label: "候选 B",
            concept: "晨雾茶山 · 浅色清新，强调产地与四季",
            palette: ["#f4efe4", "#5d7a52", "#2c2a24", "#c9b48a"],
            page: {
              bg: "#f4efe4", fg: "#2c2a24", accent: "#5d7a52",
              heroImg: "linear-gradient(160deg,#dfe7d2 0%,#8aa87c 80%,#5d7a52 100%)",
              logo: "霓虹茶室",
              links: ["产地", "四季茶", "到店"],
              h1: "从山雾到茶杯，只要一个清晨",
              sub: "与三处小产区茶园直采合作，按节气轮换供应。",
              cta: "看看本季茶",
              cards: [
                { t: "直采产地", d: "安溪、阿里山、狮峰，三处小茶园。" },
                { t: "节气轮换", d: "每个节气上新一支，过季即下架。" },
                { t: "清晨焙茶", d: "每日 6:00 开炉，店内可见焙茶过程。" }
              ],
              text: "茶的味道从山里开始。我们把产地的清晨搬进城里，让你在第一杯茶里喝到当天刚焙好的火香。",
              footer: "NEON TEAHOUSE · SEASONAL"
            }
          }
        ],
        activity: [
          { time: "09:02", actor: "system", text: "项目创建于「设计引导」preset，模板角色：起始脚手架。" },
          { time: "09:03", actor: "agent", text: "理解需求：为一家夜间营业的茶室做品牌官网，风格描述模糊（“有氛围感”）。" },
          { time: "09:05", actor: "agent", text: "需求存在不确定处，已向用户提问：目标客群是夜归上班族还是茶爱好者？" },
          { time: "09:11", actor: "user", text: "回答提问：两类都要兼顾，但优先夜归人群。" },
          { time: "09:18", actor: "agent", text: "产出 R3 两个候选方向：「夜色茶单」与「晨雾茶山」，等待用户选择或反馈。" }
        ],
        quality: { hard: [], aesthetic: [], ran: false },
        feedbackLog: []
      },
      {
        id: "p-report",
        name: "季度财报 · 管理层 PPT",
        medium: "PPT",
        status: "质量复核中",
        preset: "规范生产",
        role: "交付合同",
        revision: 5,
        activeCandidateId: "a",
        nextStep: "等待质量复核完成；已发现 1 个硬错误，修复前不可导出。",
        candidates: [
          {
            id: "a",
            label: "校样 R5",
            concept: "深色财务底 + 单页一个结论，图表去装饰",
            palette: ["#14161c", "#e8a33d", "#e8e6df", "#4a5568"],
            page: {
              bg: "#14161c", fg: "#e8e6df", accent: "#e8a33d",
              heroImg: "linear-gradient(120deg,#232936 0%,#4a5568 60%,#e8a33d 160%)",
              logo: "Q3 财报",
              links: ["摘要", "收入", "风险"],
              h1: "本季度只有一个结论：增长回到产品线 A",
              sub: "管理层版 · 12 页 · 每页一个论点，数据均可溯源至附表。",
              cta: "翻到摘要页",
              cards: [
                { t: "P2 摘要", d: "营收 +14%，全部由产品线 A 贡献。" },
                { t: "P6 明细", d: "区域数据表格 · 当前存在溢出问题。" },
                { t: "P10 风险", d: "三条风险，按影响排序。" }
              ],
              text: "设计原则：数字先行，装饰让位。所有图表仅使用两种明度，避免彩虹配色干扰判断。",
              footer: "CONFIDENTIAL · Q3 REVIEW"
            }
          }
        ],
        activity: [
          { time: "08:30", actor: "user", text: "批准了 R4 方向「深色财务底」，进入正式 Artifact 产出。" },
          { time: "08:41", actor: "agent", text: "产出 R5 正式校样（12 页），提交质量复核。" },
          { time: "08:52", actor: "system", text: "质量复核启动：硬检查与审美检查两条轨道并行。" },
          { time: "08:53", actor: "system", text: "硬检查发现 1 项问题：P6 数据表格溢出页面边界。" }
        ],
        quality: {
          ran: true,
          hard: ["P6 区域数据表格横向溢出页面边界（超出 24pt），导出会裁切内容。"],
          aesthetic: [
            "P3 图表配色与封面主色不完全一致，建议统一为同一琥珀色系。",
            "页脚页码字号偏小（9pt），投影场景下可能看不清。"
          ]
        },
        feedbackLog: [
          { kind: "direction", time: "08:12", text: "R3 整体太像营销物料，要求换成“董事会阅读”的语气。", aspects: ["叙事", "语气"] }
        ]
      },
      {
        id: "p-slowpost",
        name: "独立刊物《慢递》· 创刊号网页",
        medium: "网页",
        status: "已批准 · 可交付",
        preset: "开放探索",
        role: "参考样例",
        revision: 7,
        activeCandidateId: "a",
        nextStep: "硬检查已通过，可以导出交付；2 条审美建议由你自行判断是否采纳。",
        candidates: [
          {
            id: "a",
            label: "校样 R7",
            concept: "报纸排版感 + 大幅留白，刊物编号系统",
            palette: ["#f6f1e7", "#22201b", "#b3492e", "#8a8378"],
            page: {
              bg: "#f6f1e7", fg: "#22201b", accent: "#b3492e",
              heroImg: "linear-gradient(105deg,#e8e0cf 0%,#b3492e 220%)",
              logo: "慢递 · SLOW POST",
              links: ["创刊词", "目录", "订阅"],
              h1: "一封走得很慢的刊物",
              sub: "创刊号 · 六篇长文，关于「等待」这件事。纸质同期发行。",
              cta: "读创刊词",
              cards: [
                { t: "栏目 · 驿站", d: "城市角落的等待场景速写。" },
                { t: "栏目 · 回信", d: "读者来信的延迟回复计划。" },
                { t: "栏目 · 慢评", d: "出版三个月后才写的书评。" }
              ],
              text: "《慢递》不追热点。所有文章至少在事件发生一个月后才动笔，我们相信时间是一种编辑。",
              footer: "ISSUE 001 · PRINTED & WEB"
            }
          }
        ],
        activity: [
          { time: "10:05", actor: "user", text: "批准 R6 方向「报纸排版感」。" },
          { time: "10:20", actor: "agent", text: "产出 R7 正式 Artifact，并调用生图能力补齐 2 张栏目标题配图。" },
          { time: "10:31", actor: "system", text: "质量复核完成：硬检查 0 项问题；审美发现 2 项（不阻挡交付）。" },
          { time: "10:31", actor: "system", text: "交付闸口已打开，可导出。" }
        ],
        quality: {
          ran: true,
          hard: [],
          aesthetic: [
            "首屏留白可以再多一档，刊物感会更强。",
            "栏目卡片标题的衬线字与正文混排时灰度略跳，建议正文降半档字重。"
          ]
        },
        feedbackLog: [
          { kind: "local", time: "09:58", target: "创刊词第二段", fkind: "措辞", text: "「拖延」改成「等待」，避免负面联想。" }
        ]
      },
      {
        id: "p-fest",
        name: "山地音乐节 · 海报落地页",
        medium: "网页",
        status: "方向生成中",
        preset: "开放探索",
        role: "参考样例",
        revision: 0,
        activeCandidateId: null,
        nextStep: "agent 正在生成第一批候选方向，稍候回来查看。",
        candidates: [],
        activity: [
          { time: "11:40", actor: "system", text: "项目创建，需求原文：“海报风格的落地页，要野一点”。" },
          { time: "11:41", actor: "agent", text: "需求模糊（“野一点”），已提问：偏向自然山野还是街头涂鸦气质？" },
          { time: "11:42", actor: "agent", text: "正在生成候选方向…" }
        ],
        quality: { hard: [], aesthetic: [], ran: false },
        feedbackLog: []
      }
    ]
  };

  /* ----------------------------------------------------------
   * 2. Mock API 客户端（setTimeout 模拟延迟）
   * ---------------------------------------------------------- */

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function nowTime() {
    var d = new Date();
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  function findProject(id) {
    for (var i = 0; i < DB.projects.length; i++) {
      if (DB.projects[i].id === id) return DB.projects[i];
    }
    return null;
  }

  var __oeyMock__ = {
    listProjects: function () {
      return delay(120).then(function () { return DB.projects.slice(); });
    },
    getProject: function (id) {
      return delay(180).then(function () { return findProject(id) || null; });
    },
    selectCandidate: function (projectId, candidateId) {
      return delay(150).then(function () {
        var p = findProject(projectId);
        if (!p) return null;
        p.activeCandidateId = candidateId;
        p.activity.unshift({
          time: nowTime(), actor: "user",
          text: "查看了「" + candLabel(p, candidateId) + "」。"
        });
        return p;
      });
    },
    submitDirectionFeedback: function (projectId, payload) {
      return delay(650).then(function () {
        var p = findProject(projectId);
        if (!p) return null;
        p.feedbackLog.unshift({
          kind: "direction", time: nowTime(),
          aspects: payload.aspects, text: payload.text
        });
        p.status = "已提交方向反馈";
        p.revision += 1;
        p.nextStep = "方向反馈已收到：agent 将基于批注生成新一批候选方向。";
        p.activity.unshift({
          time: nowTime(), actor: "user",
          text: "投递<b>整体方向反馈</b>（" + payload.aspects.join("/") + "）：" + escapeText(payload.text)
        });
        p.activity.unshift({
          time: nowTime(), actor: "agent",
          text: "收到方向反馈，将放弃当前方向，重新生成候选（进入 R" + p.revision + "）。"
        });
        return p;
      });
    },
    submitLocalFeedback: function (projectId, payload) {
      return delay(500).then(function () {
        var p = findProject(projectId);
        if (!p) return null;
        p.feedbackLog.unshift({
          kind: "local", time: nowTime(),
          target: payload.target, fkind: payload.fkind, text: payload.text
        });
        p.nextStep = "局部微调已记录：agent 将在当前校样上原位修改「" + payload.target + "」，方向不变。";
        p.activity.unshift({
          time: nowTime(), actor: "user",
          text: "投递<b>局部微调</b>（" + payload.fkind + " · " + escapeText(payload.target) + "）：" + escapeText(payload.text)
        });
        p.activity.unshift({
          time: nowTime(), actor: "agent",
          text: "已登记局部微调，将在当前校样原位处理，不影响整体方向。"
        });
        return p;
      });
    },
    createProject: function (data) {
      return delay(700).then(function () {
        var p = {
          id: "p-" + Math.random().toString(36).slice(2, 8),
          name: data.name,
          medium: "网页",
          status: "方向生成中",
          preset: data.preset,
          role: data.role,
          revision: 0,
          activeCandidateId: null,
          nextStep: "agent 正在理解需求并生成第一批候选方向。",
          candidates: [],
          activity: [
            { time: nowTime(), actor: "system", text: "项目创建于「" + data.preset + "」preset，模板角色：" + data.role + "。" },
            { time: nowTime(), actor: "agent", text: "开始理解需求，正在生成候选方向…" }
          ],
          quality: { hard: [], aesthetic: [], ran: false },
          feedbackLog: []
        };
        DB.projects.unshift(p);
        return p;
      });
    }
  };

  window.__oeyMock__ = __oeyMock__;

  /* ----------------------------------------------------------
   * 3. 视图渲染
   * ---------------------------------------------------------- */

  var state = { activeProjectId: null };

  var el = {};
  function $(id) { return document.getElementById(id); }

  function escapeText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function candLabel(p, cid) {
    for (var i = 0; i < p.candidates.length; i++) {
      if (p.candidates[i].id === cid) return p.candidates[i].label;
    }
    return cid;
  }

  function activeCandidate(p) {
    if (!p || !p.candidates.length) return null;
    for (var i = 0; i < p.candidates.length; i++) {
      if (p.candidates[i].id === p.activeCandidateId) return p.candidates[i];
    }
    return p.candidates[0];
  }

  /* --- 顶栏状态戳 --- */
  function renderTopbar(p) {
    var stamp = el.topbarStatus;
    stamp.className = "status-stamp";
    if (!p) {
      stamp.textContent = "未选择项目";
      stamp.classList.add("is-idle");
      return;
    }
    stamp.textContent = p.status.toUpperCase ? p.status : p.status;
    if (p.quality.ran && p.quality.hard.length > 0) stamp.classList.add("is-hard");
    else if (p.quality.ran && p.quality.hard.length === 0) stamp.classList.add("is-ok");
  }

  /* --- 左栏项目列表 --- */
  function renderProjects() {
    el.projectList.innerHTML = "";
    DB.projects.forEach(function (p) {
      var li = document.createElement("li");
      li.className = "project-item" + (p.id === state.activeProjectId ? " is-active" : "");
      li.setAttribute("data-oey-object", "projects.item");
      li.setAttribute("data-project-id", p.id);
      li.innerHTML =
        '<span class="p-name" data-oey-object="projects.item.name">' + escapeText(p.name) + "</span>" +
        '<span class="p-meta">' +
        '<span class="p-status" data-oey-object="projects.item.status">' + escapeText(p.status) + "</span>" +
        "<span>" + escapeText(p.medium) + " · R" + p.revision + "</span>" +
        "</span>";
      li.addEventListener("click", function () { selectProject(p.id); });
      el.projectList.appendChild(li);
    });
  }

  /* --- 中栏预览 --- */
  function renderPreview(p) {
    var c = activeCandidate(p);
    el.previewProjectName.textContent = p ? p.name : "—";
    el.previewRevision.textContent = p ? "REVISION R" + p.revision : "R–";
    el.previewUrl.textContent = p ? "darkroom://proof/" + p.id : "darkroom://proof";

    // 候选 tab
    el.candidateTabs.innerHTML = "";
    if (p && p.candidates.length) {
      p.candidates.forEach(function (cand) {
        var b = document.createElement("button");
        b.className = "cand-tab" + (cand.id === p.activeCandidateId ? " is-active" : "");
        b.textContent = cand.label;
        b.setAttribute("data-oey-object", "preview.candidateTab");
        b.addEventListener("click", function () {
          __oeyMock__.selectCandidate(p.id, cand.id).then(function (updated) {
            renderAll(updated);
          });
        });
        el.candidateTabs.appendChild(b);
      });
    }

    // 画布
    if (!p) {
      el.previewCanvas.innerHTML =
        '<div class="empty-state" data-oey-object="preview.empty">' +
        '<p class="empty-mark">◍</p><p>在左侧底片夹中选择或新建一个项目，开始冲洗方向。</p></div>';
    } else if (!c) {
      el.previewCanvas.innerHTML =
        '<div class="empty-state" data-oey-object="preview.empty">' +
        '<p class="empty-mark">◌</p><p>方向正在生成中——agent 产出第一批候选后会出现在这里。</p></div>';
    } else {
      el.previewCanvas.innerHTML = pageHTML(c.page);
    }

    // 元信息
    el.previewConcept.textContent = c ? c.concept : "—";
    el.previewPalette.innerHTML = "";
    if (c) {
      c.palette.forEach(function (hex) {
        var s = document.createElement("span");
        s.className = "swatch";
        s.style.background = hex;
        s.title = hex;
        el.previewPalette.appendChild(s);
      });
    }
  }

  function pageHTML(pg) {
    var cards = pg.cards.map(function (c) {
      return '<div class="pg-card" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);">' +
        "<b>" + escapeText(c.t) + "</b>" + escapeText(c.d) + "</div>";
    }).join("");
    return (
      '<div class="pg" style="background:' + pg.bg + ";color:" + pg.fg + ';">' +
        '<div class="pg-nav">' +
          '<span class="pg-logo" style="color:' + pg.accent + ';">' + escapeText(pg.logo) + "</span>" +
          '<span class="pg-links">' + pg.links.map(escapeText).join("<span></span>") + "</span>" +
        "</div>" +
        '<div class="pg-hero">' +
          '<div class="pg-hero-img" style="background:' + pg.heroImg + ';"></div>' +
          '<div class="pg-h1">' + escapeText(pg.h1) + "</div>" +
          '<div class="pg-sub">' + escapeText(pg.sub) + "</div>" +
          '<span class="pg-cta" style="background:' + pg.accent + ";color:" + pg.bg + ';">' + escapeText(pg.cta) + "</span>" +
        "</div>" +
        '<div class="pg-cards">' + cards + "</div>" +
        '<div class="pg-text">' + escapeText(pg.text) + "</div>" +
        '<div class="pg-footer">' + escapeText(pg.footer) + "</div>" +
      "</div>"
    );
  }

  /* --- 右栏 · 冲洗记录 --- */
  function renderActivity(p) {
    el.activityList.innerHTML = "";
    if (!p) {
      el.nextStep.textContent = "";
      return;
    }
    p.activity.forEach(function (ev) {
      var li = document.createElement("li");
      li.className = "activity-item actor-" + ev.actor;
      li.setAttribute("data-oey-object", "activity.item");
      li.innerHTML =
        '<span class="a-time">' + escapeText(ev.time) + "</span>" +
        '<span class="a-dot"></span>' +
        '<span class="a-text">' + ev.text + "</span>";
      el.activityList.appendChild(li);
    });
    el.nextStep.innerHTML = p.nextStep ? "<b>下一步</b>" + escapeText(p.nextStep) : "";
  }

  /* --- 右栏 · 显影检查 --- */
  function renderQuality(p) {
    if (!p) {
      el.qPreset.textContent = el.qRole.textContent = el.qMedium.textContent = "—";
      el.qualityGate.textContent = "—";
      el.qualityGate.className = "gate";
      el.hardList.innerHTML = el.aesList.innerHTML = "";
      return;
    }
    el.qPreset.textContent = p.preset;
    el.qRole.textContent = p.role;
    el.qMedium.textContent = p.medium;

    var gate = el.qualityGate;
    if (!p.quality.ran) {
      gate.textContent = "质量复核尚未运行（产出正式 Artifact 后自动启动）";
      gate.className = "gate is-pending";
    } else if (p.quality.hard.length > 0) {
      gate.textContent = "✕ 交付闸口关闭：存在 " + p.quality.hard.length + " 个硬错误";
      gate.className = "gate is-blocked";
    } else {
      gate.textContent = "✓ 硬检查通过 · 交付闸口打开（审美发现不阻挡交付）";
      gate.className = "gate is-open";
    }

    fillTrack(el.hardList, p.quality.ran ? p.quality.hard : [], p.quality.ran ? "硬检查未发现客观错误。" : "尚未运行。");
    fillTrack(el.aesList, p.quality.ran ? p.quality.aesthetic : [], p.quality.ran ? "暂无审美建议。" : "尚未运行。");
  }

  function fillTrack(ul, items, emptyText) {
    ul.innerHTML = "";
    if (!items.length) {
      var li = document.createElement("li");
      li.className = "li-empty";
      li.textContent = emptyText;
      ul.appendChild(li);
      return;
    }
    items.forEach(function (t) {
      var li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });
  }

  /* --- 右栏 · 标注记录 --- */
  function renderFeedbackLog(p) {
    el.feedbackLog.innerHTML = "";
    if (!p || !p.feedbackLog.length) {
      el.feedbackLog.innerHTML = '<li class="li-empty">当前项目还没有投递过标注。</li>';
      return;
    }
    p.feedbackLog.forEach(function (f) {
      var li = document.createElement("li");
      var kindLabel = f.kind === "direction" ? "整体方向" : "局部微调";
      var kindCls = f.kind === "direction" ? "k-direction" : "k-local";
      var body = f.kind === "direction"
        ? "[" + f.aspects.join("/") + "] " + f.text
        : "[" + f.fkind + " · " + f.target + "] " + f.text;
      li.innerHTML =
        '<span class="fl-kind ' + kindCls + '">' + kindLabel + "</span>" +
        '<span class="fl-time">' + escapeText(f.time) + "</span>" +
        escapeText(body);
      el.feedbackLog.appendChild(li);
    });
  }

  function renderAll(p) {
    renderTopbar(p);
    renderProjects();
    renderPreview(p);
    renderActivity(p);
    renderQuality(p);
    renderFeedbackLog(p);
  }

  function selectProject(id) {
    state.activeProjectId = id;
    __oeyMock__.getProject(id).then(function (p) { renderAll(p); });
  }

  /* ----------------------------------------------------------
   * 4. Toast
   * ---------------------------------------------------------- */

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove("is-show"); }, 2600);
  }

  /* ----------------------------------------------------------
   * 5. 事件绑定
   * ---------------------------------------------------------- */

  function bind() {
    el.directionForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var p = findProject(state.activeProjectId);
      if (!p) { toast("请先选择一个项目"); return; }
      var aspects = [];
      el.directionForm.querySelectorAll("input[type=checkbox]:checked").forEach(function (cb) {
        aspects.push(cb.value);
      });
      if (!aspects.length) { toast("请至少勾选一个不满意的方面"); return; }
      var text = el.directionText.value.trim();
      if (!text) return;
      var btn = el.directionForm.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "投递中…";
      __oeyMock__.submitDirectionFeedback(p.id, { aspects: aspects, text: text }).then(function (updated) {
        btn.disabled = false;
        btn.textContent = "要求换一个方向";
        el.directionText.value = "";
        renderAll(updated);
        toast("方向反馈已投递 · 当前方向将被放弃，等待新一批候选");
      });
    });

    el.localForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var p = findProject(state.activeProjectId);
      if (!p) { toast("请先选择一个项目"); return; }
      var target = el.localTarget.value.trim();
      var text = el.localText.value.trim();
      if (!target || !text) return;
      var btn = el.localForm.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "投递中…";
      __oeyMock__.submitLocalFeedback(p.id, {
        target: target, fkind: el.localKind.value, text: text
      }).then(function (updated) {
        btn.disabled = false;
        btn.textContent = "提交局部微调";
        el.localTarget.value = "";
        el.localText.value = "";
        renderAll(updated);
        toast("局部微调已记录 · 将在当前校样原位处理");
      });
    });

    el.toggleNewProject.addEventListener("click", function () {
      el.newProjectForm.classList.toggle("hidden");
    });

    el.newProjectForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = el.npName.value.trim();
      if (!name) return;
      var btn = el.newProjectForm.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "登记中…";
      __oeyMock__.createProject({
        name: name,
        preset: el.npPreset.value,
        role: el.npRole.value
      }).then(function (p) {
        btn.disabled = false;
        btn.textContent = "登记并开始生成方向";
        el.npName.value = "";
        el.newProjectForm.classList.add("hidden");
        state.activeProjectId = p.id;
        renderAll(p);
        toast("新项目已登记 · agent 正在生成候选方向");
      });
    });
  }

  /* ----------------------------------------------------------
   * 6. 启动
   * ---------------------------------------------------------- */

  function boot() {
    [
      "topbarStatus", "projectList", "toggleNewProject", "newProjectForm",
      "npName", "npPreset", "npRole",
      "previewProjectName", "previewRevision", "previewUrl", "candidateTabs",
      "previewCanvas", "previewConcept", "previewPalette",
      "activityList", "nextStep",
      "qPreset", "qRole", "qMedium", "qualityGate", "hardList", "aesList",
      "directionForm", "directionText", "localForm", "localTarget", "localKind", "localText",
      "feedbackLog", "toast"
    ].forEach(function (id) { el[id] = $(id); });

    bind();

    __oeyMock__.listProjects().then(function (projects) {
      if (projects.length) {
        state.activeProjectId = projects[0].id;
        renderAll(projects[0]);
      } else {
        renderAll(null);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
