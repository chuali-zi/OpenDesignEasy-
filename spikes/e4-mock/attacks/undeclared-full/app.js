/* =====================================================================
 * ForgeDesk · Agent 工作台 —— 纯前端 Mock 实现
 *
 * 本文件不发起任何真实网络请求。所有“接口”均由下方的 mockApi 提供，
 * 通过 setTimeout 模拟网络延迟，数据来自内联假数据 + 规则模板生成。
 * 详见 MOCK.md。
 * ===================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
   * 1. 内联假数据：项目 / 会话 / 初始产物
   * ------------------------------------------------------------------ */
  var DB = {
    projects: [
      {
        id: "p-aurora",
        name: "极光数据看板",
        desc: "面向运营团队的实时指标可视化大屏",
        status: "running",
        statusText: "运行中",
        updatedAt: "10:24",
        sessionId: "sess-aurora-0007",
        messages: [
          { role: "user", text: "帮我把首页的访问量卡片挪到第一屏最左边。", time: "10:18" },
          { role: "agent", text: "已完成。访问量卡片已调整为第一屏首个组件，同时把它的时间粒度切换器保留在卡片右上角。预览已更新到 v1.0。", time: "10:19" }
        ],
        artifact: {
          badge: "Web 应用",
          title: "极光数据看板 · 首页",
          desc: "包含访问量、转化率、活跃用户三张核心指标卡片，以及一张 24 小时趋势折线图。当前为第一版可用布局。",
          code: [
            "// 极光数据看板 · 首页布局（生成代码）",
            "export const dashboard = {",
            "  layout: 'grid-12',",
            "  widgets: [",
            "    { type: 'metric-card', key: 'visits',    span: 4 },",
            "    { type: 'metric-card', key: 'conversion',span: 4 },",
            "    { type: 'metric-card', key: 'active',    span: 4 },",
            "    { type: 'line-chart',  key: 'trend-24h', span: 12 }",
            "  ]",
            "};"
          ],
          changelog: [
            { time: "10:19", note: "初始化三卡片 + 趋势图布局，生成 v1.0" }
          ]
        }
      },
      {
        id: "p-heron",
        name: "白鹭客服机器人",
        desc: "接入知识库的售前问答 Agent，支持多轮追问",
        status: "running",
        statusText: "运行中",
        updatedAt: "09:52",
        sessionId: "sess-heron-0021",
        messages: [
          { role: "user", text: "用户问运费的时候，回答里要带上包邮门槛。", time: "09:47" },
          { role: "agent", text: "已更新话术规则：所有涉及运费的回答都会附带「满 199 元包邮」的提示，并优先引用知识库最新运费表。预览中的对话脚本已同步到 v1.0。", time: "09:48" }
        ],
        artifact: {
          badge: "对话脚本",
          title: "白鹭客服 · 售前问答脚本",
          desc: "覆盖运费、退换货、优惠三类高频问题的多轮对话脚本，已接入知识库 v3。",
          code: [
            "// 白鹭客服 · 问答规则（生成代码）",
            "export const rules = [",
            "  { intent: 'shipping_fee', reply: 'template://freight_v2' },",
            "  { intent: 'return_policy', reply: 'template://return_v1' },",
            "  { intent: 'discount',      reply: 'template://coupon_v4' }",
            "];"
          ],
          changelog: [
            { time: "09:48", note: "运费话术附带包邮门槛提示，生成 v1.0" }
          ]
        }
      },
      {
        id: "p-mole",
        name: "鼹鼠周报生成器",
        desc: "从 Git 提交与任务看板自动汇总团队周报",
        status: "paused",
        statusText: "已暂停",
        updatedAt: "昨天",
        sessionId: "sess-mole-0003",
        messages: [
          { role: "user", text: "周报里把修复类提交单独成一节，别和新功能混在一起。", time: "昨天 17:32" },
          { role: "agent", text: "已调整汇总策略：提交记录按 feat / fix / chore 三类分节输出，fix 单独成节并统计缺陷关闭率。周报模板已生成 v1.0。", time: "昨天 17:33" }
        ],
        artifact: {
          badge: "文档模板",
          title: "团队周报 · 自动汇总模板",
          desc: "按新功能 / 缺陷修复 / 杂项三节组织内容，附缺陷关闭率与下周计划占位。",
          code: [
            "# 团队周报（自动生成模板）",
            "## 本周新功能",
            "- {{feat_commits}}",
            "## 缺陷修复（关闭率 {{fix_rate}}）",
            "- {{fix_commits}}",
            "## 下周计划",
            "- {{next_plan}}"
          ],
          changelog: [
            { time: "昨天 17:33", note: "提交按类型分节，fix 单独统计，生成 v1.0" }
          ]
        }
      },
      {
        id: "p-pixie",
        name: "精灵落地页",
        desc: "新产品发布用的营销落地页，含定价与预约表单",
        status: "draft",
        statusText: "草稿",
        updatedAt: "周一",
        sessionId: "sess-pixie-0001",
        messages: [
          { role: "user", text: "先给我搭一个落地页骨架：首屏标语、三栏卖点、定价、表单。", time: "周一 14:05" },
          { role: "agent", text: "已生成落地页骨架 v1.0：包含 Hero 标语区、三栏卖点、双档定价卡片和预约表单，配色暂用默认蓝灰主题。", time: "周一 14:06" }
        ],
        artifact: {
          badge: "静态页面",
          title: "精灵落地页 · 骨架",
          desc: "首屏标语 + 三栏卖点 + 双档定价 + 预约表单，默认蓝灰主题。",
          code: [
            "<!-- 精灵落地页 · 骨架（生成代码） -->",
            "<section class=\"hero\">…标语…</section>",
            "<section class=\"features\">…三栏卖点…</section>",
            "<section class=\"pricing\">…双档定价…</section>",
            "<section class=\"signup\">…预约表单…</section>"
          ],
          changelog: [
            { time: "周一 14:06", note: "生成落地页四段式骨架 v1.0" }
          ]
        }
      }
    ]
  };

  /* ------------------------------------------------------------------
   * 2. Mock API：模拟后端接口（setTimeout 模拟延迟，Promise 风格）
   *    同时暴露为 window.__mockApi__ 便于调试/测试。
   * ------------------------------------------------------------------ */
  var NETWORK_DELAY = { list: 260, session: 320, send: 900 + Math.floor(Math.random() * 600) };

  function delay(ms, value) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, ms); });
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function findProject(id) {
    for (var i = 0; i < DB.projects.length; i++) {
      if (DB.projects[i].id === id) return DB.projects[i];
    }
    return null;
  }

  /**
   * 规则式回复生成器：
   * 根据用户消息中的关键词命中规则，产出 (回复文本 + 产物补丁)。
   * 未命中时使用轮换模板生成兜底回复。所有内容均为前端模板推导，
   * 不依赖任何外部服务。
   */
  var REPLY_RULES = [
    {
      keys: ["颜色", "配色", "主题", "绿色", "红色", "蓝色", "深色", "浅色"],
      reply: function (p, msg) {
        return "收到，关于「" + msg + "」：我已更新配色方案，主色与强调色已按你的要求调整，并同步检查了对比度是否达标。右侧预览已生成新版本。";
      },
      patch: function () {
        return {
          codeLine: "  theme: { primary: 'updated', contrast: 'AA-pass' },",
          note: "调整主题配色并通过对比度校验"
        };
      }
    },
    {
      keys: ["按钮", "组件", "图标", "卡片", "表单", "导航"],
      reply: function (p, msg) {
        return "已完成组件层面的改动（" + msg + "）：相关组件已更新，间距与 hover 态一并处理。产物补丁已合入，右侧可查看最新版本。";
      },
      patch: function () {
        return {
          codeLine: "  components: { updated: true, hover: 'enabled', spacing: 8 },",
          note: "更新组件样式与交互态"
        };
      }
    },
    {
      keys: ["数据", "接口", "api", "API", "字段", "数据库"],
      reply: function (p, msg) {
        return "数据侧已处理（" + msg + "）：我补充了对应的接口字段映射与兜底空态，避免无数据时页面塌陷。预览中的产物已更新。";
      },
      patch: function () {
        return {
          codeLine: "  dataSource: { fallback: 'empty-state', mapping: 'patched' },",
          note: "补充数据字段映射与空态兜底"
        };
      }
    },
    {
      keys: ["部署", "发布", "上线", "构建"],
      reply: function (p, msg) {
        return "发布流程已就绪（" + msg + "）：构建脚本已补充产物压缩与版本号注入步骤，当前产物可一键发布到预发环境。版本号已在右侧预览中递增。";
      },
      patch: function () {
        return {
          codeLine: "  build: { minify: true, versionInjection: true },",
          note: "构建脚本加入压缩与版本注入"
        };
      }
    }
  ];

  var FALLBACK_OPENERS = ["明白，", "收到，", "好的，", "没问题，"];
  var fallbackCounter = 0;

  function generateAgentReply(project, userText) {
    var hit = null;
    for (var i = 0; i < REPLY_RULES.length; i++) {
      var rule = REPLY_RULES[i];
      for (var j = 0; j < rule.keys.length; j++) {
        if (userText.indexOf(rule.keys[j]) !== -1) { hit = rule; break; }
      }
      if (hit) break;
    }

    var replyText, patch;
    if (hit) {
      replyText = hit.reply(project, userText);
      patch = hit.patch();
    } else {
      var opener = FALLBACK_OPENERS[fallbackCounter % FALLBACK_OPENERS.length];
      fallbackCounter++;
      replyText = opener + "针对「" + userText + "」我已完成一版实现，应用在项目「" + project.name +
        "」上。改动要点：1) 按你的描述更新了对应模块；2) 保持现有结构兼容；3) 在右侧预览中递增了产物版本并追加了变更记录。如需调整方向，继续告诉我即可。";
      patch = {
        codeLine: "  revision: 'auto-" + (fallbackCounter) + "', // 来自指令：" + userText.slice(0, 24),
        note: "响应指令「" + userText.slice(0, 30) + "」的通用改动"
      };
    }
    return { text: replyText, patch: patch };
  }

  function nowTime() {
    var d = new Date();
    var hh = ("0" + d.getHours()).slice(-2);
    var mm = ("0" + d.getMinutes()).slice(-2);
    return hh + ":" + mm;
  }

  var mockApi = {
    /** 获取项目列表（模拟 GET /api/projects） */
    listProjects: function () {
      return delay(NETWORK_DELAY.list, clone(DB.projects).map(function (p) {
        return { id: p.id, name: p.name, desc: p.desc, status: p.status, statusText: p.statusText, updatedAt: p.updatedAt };
      }));
    },

    /** 获取某项目会话详情（模拟 GET /api/projects/:id/session） */
    getSession: function (projectId) {
      var p = findProject(projectId);
      if (!p) return delay(NETWORK_DELAY.session, null);
      return delay(NETWORK_DELAY.session, clone({
        sessionId: p.sessionId,
        projectName: p.name,
        messages: p.messages,
        artifact: p.artifact
      }));
    },

    /**
     * 发送消息并获取 Agent 回复（模拟 POST /api/projects/:id/messages）
     * 副作用：把消息写入内存 DB、推进产物版本、追加变更记录。
     */
    sendMessage: function (projectId, text) {
      var p = findProject(projectId);
      if (!p) return delay(200, { error: "project not found" });

      p.messages.push({ role: "user", text: text, time: nowTime() });
      var generated = generateAgentReply(p, text);
      var agentMsg = { role: "agent", text: generated.text, time: nowTime() };
      p.messages.push(agentMsg);

      // 推进产物：版本 +1、代码追加一行、变更记录追加一条
      p.artifact.code.splice(p.artifact.code.length - (p.artifact.code[p.artifact.code.length - 1].trim() === "};" ? 1 : 0), 0, generated.patch.codeLine);
      p.artifact.changelog.push({ time: nowTime(), note: generated.patch.note });
      p.artifact.desc = p.artifact.desc.replace(/。.*$/, "") + "。最近变更：" + generated.patch.note + "。";
      p.updatedAt = nowTime();

      return delay(NETWORK_DELAY.send, clone({
        agentMessage: agentMsg,
        artifact: p.artifact,
        version: p.artifact.changelog.length
      }));
    }
  };

  // 暴露给控制台 / 自动化测试使用
  window.__mockApi__ = mockApi;

  /* ------------------------------------------------------------------
   * 3. 视图层：渲染 + 事件绑定
   * ------------------------------------------------------------------ */
  var state = {
    currentProjectId: null,
    currentArtifact: null,
    sending: false,
    filter: ""
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var projectListEl = $("#projectList");
  var chatMessagesEl = $("#chatMessages");
  var chatInputEl = $("#chatInput");
  var btnSend = $("#btnSend");

  /* ---- 项目列表 ---- */
  function renderProjects(items) {
    projectListEl.innerHTML = "";
    var shown = 0;
    items.forEach(function (p) {
      if (state.filter && p.name.indexOf(state.filter) === -1 && p.desc.indexOf(state.filter) === -1) return;
      shown++;
      var li = document.createElement("li");
      li.className = "project-item" + (p.id === state.currentProjectId ? " is-active" : "");
      li.setAttribute("data-oey-object", "projects.item");
      li.setAttribute("data-project-id", p.id);
      li.innerHTML =
        '<span class="p-name" data-oey-object="projects.item.name"></span>' +
        '<span class="p-desc" data-oey-object="projects.item.desc"></span>' +
        '<span class="p-meta">' +
          '<span class="p-status ' + p.status + '" data-oey-object="projects.item.status">' + p.statusText + "</span>" +
          '<span data-oey-object="projects.item.updatedAt">' + p.updatedAt + "</span>" +
        "</span>";
      li.querySelector(".p-name").textContent = p.name;
      li.querySelector(".p-desc").textContent = p.desc;
      li.addEventListener("click", function () { selectProject(p.id); });
      projectListEl.appendChild(li);
    });
    $("#projectsEmpty").hidden = shown > 0;
    $("#projectsSummary").textContent = "共 " + items.length + " 个项目 · 当前显示 " + shown + " 个";
  }

  function loadProjects() {
    return mockApi.listProjects().then(function (items) {
      renderProjects(items);
      return items;
    });
  }

  /* ---- 会话 / 消息 ---- */
  function renderMessages(messages) {
    chatMessagesEl.innerHTML = "";
    messages.forEach(function (m) { appendMessageEl(m); });
    scrollChatToBottom();
  }

  function appendMessageEl(m) {
    var div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "msg-user" : "msg-agent");
    div.setAttribute("data-oey-object", "chat.message");
    div.innerHTML =
      '<div class="msg-role" data-oey-object="chat.message.role">' + (m.role === "user" ? "我" : "Agent") + "</div>" +
      '<div class="msg-text" data-oey-object="chat.message.text"></div>' +
      '<div class="msg-time" data-oey-object="chat.message.time">' + m.time + "</div>";
    div.querySelector(".msg-text").textContent = m.text;
    chatMessagesEl.appendChild(div);
  }

  function scrollChatToBottom() {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  /* ---- 预览区 ---- */
  function renderArtifact(artifact) {
    state.currentArtifact = artifact;
    var version = "v1." + (artifact.changelog.length - 1);
    $("#previewVersion").textContent = version;
    $("#cardBadge").textContent = artifact.badge;
    $("#cardTitle").textContent = artifact.title;
    $("#cardDesc").textContent = artifact.desc;
    $("#cardStats").textContent =
      "版本 " + version + " · 代码 " + artifact.code.length + " 行 · 变更 " + artifact.changelog.length + " 条";
    $("#previewCode").textContent = artifact.code.join("\n");

    var logEl = $("#previewLog");
    logEl.innerHTML = "";
    artifact.changelog.slice().reverse().forEach(function (entry) {
      var li = document.createElement("li");
      li.setAttribute("data-oey-object", "preview.changelog.entry");
      li.innerHTML = '<span class="log-time"></span><span class="log-note"></span>';
      li.querySelector(".log-time").textContent = entry.time;
      li.querySelector(".log-note").textContent = entry.note;
      logEl.appendChild(li);
    });
  }

  /* ---- 项目切换 ---- */
  function selectProject(projectId) {
    if (state.sending) return;
    state.currentProjectId = projectId;
    // 高亮列表项
    var items = projectListEl.querySelectorAll(".project-item");
    items.forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-project-id") === projectId);
    });
    chatMessagesEl.innerHTML = '<div class="msg msg-agent" data-oey-object="chat.message"><div class="msg-text" data-oey-object="chat.message.text">会话加载中…</div></div>';

    mockApi.getSession(projectId).then(function (session) {
      if (!session || state.currentProjectId !== projectId) return;
      $("#topbarProjectName").textContent = session.projectName;
      $("#chatSessionId").textContent = session.sessionId;
      renderMessages(session.messages);
      renderArtifact(session.artifact);
    });
  }

  /* ---- 发送消息 ---- */
  function setAgentBusy(busy) {
    var badge = $("#topbarAgentStatus");
    badge.textContent = busy ? "Agent 工作中…" : "Agent 空闲";
    badge.classList.toggle("is-busy", busy);
    badge.classList.toggle("is-idle", !busy);
    $("#chatTyping").hidden = !busy;
    btnSend.disabled = busy;
    state.sending = busy;
  }

  function sendCurrentMessage() {
    var text = chatInputEl.value.trim();
    if (!text || state.sending || !state.currentProjectId) return;
    chatInputEl.value = "";

    // 先乐观渲染用户消息
    var userMsg = { role: "user", text: text, time: nowTime() };
    appendMessageEl(userMsg);
    scrollChatToBottom();
    setAgentBusy(true);

    mockApi.sendMessage(state.currentProjectId, text).then(function (res) {
      // 移除刚才乐观渲染的那条，用服务端（mock）返回的完整消息重渲染最后两条
      chatMessagesEl.removeChild(chatMessagesEl.lastChild);
      var p = findProject(state.currentProjectId);
      var last2 = p.messages.slice(-2);
      last2.forEach(appendMessageEl);
      scrollChatToBottom();
      renderArtifact(res.artifact);
      // 更新列表中该项目的更新时间
      loadProjects();
      setAgentBusy(false);
      chatInputEl.focus();
    });
  }

  /* ------------------------------------------------------------------
   * 4. 事件绑定
   * ------------------------------------------------------------------ */
  $("#chatComposer").addEventListener("submit", function (e) {
    e.preventDefault();
    sendCurrentMessage();
  });

  chatInputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });

  $("#projectFilter").addEventListener("input", function (e) {
    state.filter = e.target.value.trim();
    loadProjects();
  });

  $("#btnRefreshProjects").addEventListener("click", function () {
    loadProjects();
  });

  document.querySelectorAll(".preview-tabs .tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".preview-tabs .tab").forEach(function (t) { t.classList.remove("is-active"); });
      tab.classList.add("is-active");
      var target = tab.getAttribute("data-tab");
      var map = { card: "#paneCard", code: "#paneCode", log: "#paneLog" };
      ["#paneCard", "#paneCode", "#paneLog"].forEach(function (sel) {
        $(sel).classList.toggle("is-active", sel === map[target]);
      });
    });
  });

  /* ------------------------------------------------------------------
   * 5. 启动
   * ------------------------------------------------------------------ */
  $("#topbarAgentStatus").classList.add("is-idle");
  loadProjects().then(function (items) {
    if (items.length > 0) selectProject(items[0].id);
  });
})();
