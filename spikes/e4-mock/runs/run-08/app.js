/* ============================================================
 * ForgeDesk · Agent 工作台（纯前端 Mock 原型）
 * 无任何后端依赖。所有数据由下方 mock 层提供。
 * ============================================================ */

(function () {
  "use strict";

  /* ----------------------------------------------------------
   * 1. Mock 数据源（内联假数据，全部为虚构）
   * ---------------------------------------------------------- */

  var SEED_PROJECTS = [
    {
      id: "p-aurora",
      name: "极光客服机器人",
      tag: "对话 Agent",
      model: "forge-lite-3",
      desc: "面向电商场景的多轮售后问答机器人",
      createdAt: "2024-05-12",
      messages: [
        { role: "user", text: "帮我看看上周的退货工单主要集中在哪些品类？", time: "10:02" },
        { role: "agent", text: "我统计了一下：上周退货工单共 214 条，其中服饰类占 41%，数码配件占 27%，家居用品占 18%。服饰类的退货原因 TOP1 是「尺码不符」，建议在商品详情页增加尺码对照卡片，我可以帮你生成。", time: "10:02" }
      ]
    },
    {
      id: "p-atlas",
      name: "Atlas 报表生成器",
      tag: "数据分析",
      model: "forge-pro-2",
      desc: "把原始 CSV 变成可交互经营周报",
      createdAt: "2024-06-03",
      messages: [
        { role: "user", text: "这周 GMV 环比怎么样？", time: "14:30" },
        { role: "agent", text: "本周 GMV 为 ¥1,284,300，环比上涨 6.8%。增长主要由华东区贡献（+12.3%），华南区下滑 3.1%。我已把周报骨架写入 preview，你可以直接查看代码页。", time: "14:31" }
      ]
    },
    {
      id: "p-quill",
      name: "Quill 文案助手",
      tag: "内容创作",
      model: "forge-lite-3",
      desc: "为新媒体团队批量生成标题与摘要",
      createdAt: "2024-06-20",
      messages: []
    },
    {
      id: "p-sentinel",
      name: "Sentinel 告警巡检",
      tag: "运维 Agent",
      model: "forge-ops-1",
      desc: "定时巡检服务日志并汇总异常模式",
      createdAt: "2024-07-01",
      messages: [
        { role: "user", text: "昨晚有没有异常告警？", time: "09:15" },
        { role: "agent", text: "昨晚 02:00–05:00 之间共触发 7 条告警，其中 5 条来自 payment-gateway 的连接池耗尽（已自动扩容恢复），2 条为磁盘水位预警（80% 阈值）。建议把 payment-gateway 连接池上限从 64 提到 128，需要我出变更单吗？", time: "09:16" }
      ]
    }
  ];

  // Agent 回复模板池（模板 + 用户输入推导）
  var REPLY_TEMPLATES = [
    "收到。关于「{q}」，我先拆解一下思路：\n1. 确认目标与约束；\n2. 拉取相关上下文（{ctx}）；\n3. 产出初稿并自检。\n当前项目是「{project}」，我会按它的设定来处理。你可以继续补充细节。",
    "好的，我基于「{project}」的上下文分析了你的问题「{q}」。\n初步结论：这是一个可以分两步走的任务，第一步先做最小可行版本，第二步再迭代。右侧预览区已经同步了最新产出，可以查看。",
    "明白。你提到的「{q}」和当前项目的「{ctx}」模块有关。\n我的建议是：先小步验证，再扩大范围。我已经在预览里更新了对应的代码草稿，如果方向不对，告诉我调整。",
    "这是一个不错的切入点。围绕「{q}」，我结合「{project}」的历史记录给出三点：\n· 先做数据/结构确认；\n· 再写可运行的最小实现；\n· 最后补上边界处理。\n详细草稿见右侧预览面板。"
  ];

  var CONTEXT_HINTS = ["配置项", "历史对话", "知识库片段", "任务清单", "输出模板"];

  /* ----------------------------------------------------------
   * 2. Mock API 层：模拟异步后端
   *    技术：Promise + setTimeout 模拟网络延迟
   * ---------------------------------------------------------- */

  function delay(min, max) {
    var ms = min + Math.random() * (max - min);
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function nowTime() {
    var d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // 预览代码：由项目 + 对话轮次推导生成
  function generateCodePreview(project) {
    var rounds = Math.floor(project.messages.length / 2);
    var lines = [];
    lines.push("// ForgeDesk 自动生成 · 项目产出草稿");
    lines.push("// 项目: " + project.name + " (" + project.id + ")");
    lines.push("// 模型: " + project.model + " · 已完成 " + rounds + " 轮对话");
    lines.push("");
    lines.push("export const config = {");
    lines.push("  project: \"" + project.id + "\",");
    lines.push("  agent: \"" + project.model + "\",");
    lines.push("  tag: \"" + project.tag + "\",");
    lines.push("  steps: [");
    for (var i = 0; i < Math.min(rounds + 1, 6); i++) {
      var src = project.messages[i * 2];
      var label = src ? src.text.slice(0, 16) : "初始化任务";
      lines.push("    { step: " + (i + 1) + ", task: \"" + label.replace(/"/g, "'") + "\" },");
    }
    lines.push("  ],");
    lines.push("};");
    lines.push("");
    lines.push("export function run(ctx) {");
    lines.push("  // 根据当前对话状态推导下一步动作");
    lines.push("  return ctx.plan(config.steps).execute();");
    lines.push("}");
    return lines.join("\n");
  }

  function generateReply(project, userText) {
    var tpl = pick(REPLY_TEMPLATES);
    return tpl
      .replace(/\{q\}/g, userText.length > 24 ? userText.slice(0, 24) + "…" : userText)
      .replace(/\{project\}/g, project.name)
      .replace(/\{ctx\}/g, pick(CONTEXT_HINTS));
  }

  // 暴露给外部的假客户端（也是 mock 的一部分）
  var mockApi = {
    // 模拟 GET /api/projects
    listProjects: function () {
      return delay(200, 500).then(function () {
        return SEED_PROJECTS.map(function (p) {
          return {
            id: p.id, name: p.name, tag: p.tag, desc: p.desc,
            createdAt: p.createdAt, messageCount: p.messages.length
          };
        });
      });
    },
    // 模拟 GET /api/projects/:id
    getProject: function (id) {
      return delay(150, 400).then(function () {
        return SEED_PROJECTS.find(function (p) { return p.id === id; }) || null;
      });
    },
    // 模拟 POST /api/projects
    createProject: function (name) {
      return delay(250, 500).then(function () {
        var p = {
          id: "p-" + Math.random().toString(36).slice(2, 8),
          name: name,
          tag: "自定义",
          model: pick(["forge-lite-3", "forge-pro-2"]),
          desc: "手动创建的项目（Mock 生成）",
          createdAt: new Date().toISOString().slice(0, 10),
          messages: []
        };
        SEED_PROJECTS.push(p);
        return p;
      });
    },
    // 模拟 POST /api/projects/:id/messages（发送消息 → 返回 agent 回复）
    sendMessage: function (projectId, text) {
      var started = Date.now();
      return delay(700, 1800).then(function () {
        var project = SEED_PROJECTS.find(function (p) { return p.id === projectId; });
        if (!project) throw new Error("项目不存在");
        var userMsg = { role: "user", text: text, time: nowTime() };
        var agentMsg = { role: "agent", text: generateReply(project, text), time: nowTime() };
        project.messages.push(userMsg, agentMsg);
        return {
          user: userMsg,
          agent: agentMsg,
          latencyMs: Date.now() - started,
          tokens: Math.round(text.length * 1.6 + agentMsg.text.length * 1.4)
        };
      });
    },
    // 模拟 GET /api/projects/:id/preview
    getPreview: function (projectId) {
      return delay(120, 300).then(function () {
        var project = SEED_PROJECTS.find(function (p) { return p.id === projectId; });
        if (!project) return null;
        return {
          fileName: "output/" + project.id + ".draft.js",
          code: generateCodePreview(project),
          summary: "「" + project.name + "」是一个" + project.tag + "类项目，创建于 " +
            project.createdAt + "，使用模型 " + project.model + "。当前已积累 " +
            project.messages.length + " 条消息，产出草稿会随对话推进自动更新。",
          activities: project.messages.slice(-6).reverse().map(function (m) {
            return { role: m.role, text: m.text.slice(0, 40), time: m.time };
          })
        };
      });
    }
  };

  window.__mockApi__ = mockApi; // 供调试/测试直接调用

  /* ----------------------------------------------------------
   * 3. 应用状态与渲染
   * ---------------------------------------------------------- */

  var state = {
    projects: [],
    currentId: null,
    sending: false,
    lastLatency: null,
    lastTokens: 0,
    filter: ""
  };

  var $ = function (sel) { return document.querySelector(sel); };

  var els = {
    list: $("#projectList"),
    count: $("#projectCount"),
    search: $("#projectSearch"),
    title: $("#chatTitle"),
    model: $("#chatModel"),
    status: $("#chatStatus"),
    meta: $("#chatMetaText"),
    scroll: $("#messageScroll"),
    typing: $("#typingIndicator"),
    composer: $("#composer"),
    input: $("#composerInput"),
    send: $("#btnSend"),
    previewTitle: $("#previewTitle"),
    previewSub: $("#previewSub"),
    codeFile: $("#codeFileName"),
    codeContent: $("#codeContent"),
    summaryText: $("#summaryText"),
    activityList: $("#activityList"),
    statMessages: $("#statMessages"),
    statRounds: $("#statRounds"),
    statTokens: $("#statTokens"),
    statLatency: $("#statLatency")
  };

  function currentProject() {
    return state.projects.find(function (p) { return p.id === state.currentId; }) || null;
  }

  /* ---- 项目列表 ---- */
  function renderProjectList() {
    var kw = state.filter.trim().toLowerCase();
    var visible = state.projects.filter(function (p) {
      return !kw || p.name.toLowerCase().indexOf(kw) >= 0 || (p.tag || "").toLowerCase().indexOf(kw) >= 0;
    });
    els.list.innerHTML = "";
    visible.forEach(function (p) {
      var li = document.createElement("li");
      li.className = "project-item" + (p.id === state.currentId ? " active" : "");
      li.setAttribute("data-oey-object", "projects.item");
      li.setAttribute("data-project-id", p.id);
      li.innerHTML =
        '<div class="project-item-name" data-oey-object="projects.item.name">' +
          "<span>" + escapeHtml(p.name) + "</span>" +
          '<span class="project-item-tag" data-oey-object="projects.item.tag">' + escapeHtml(p.tag) + "</span>" +
        "</div>" +
        '<div class="project-item-desc" data-oey-object="projects.item.desc">' + escapeHtml(p.desc) + "</div>" +
        '<div class="project-item-meta" data-oey-object="projects.item.meta">' +
          "<span>" + p.createdAt + "</span><span>" + p.messages.length + " 条消息</span>" +
        "</div>";
      li.addEventListener("click", function () { switchProject(p.id); });
      els.list.appendChild(li);
    });
    els.count.textContent = visible.length + " 个项目";
  }

  /* ---- 对话区 ---- */
  function renderChat() {
    var p = currentProject();
    els.scroll.innerHTML = "";
    if (!p) {
      els.title.textContent = "未选择项目";
      els.model.textContent = "—";
      els.meta.textContent = "—";
      return;
    }
    els.title.textContent = p.name;
    els.model.textContent = p.model;
    els.meta.textContent = p.tag + " · 创建于 " + p.createdAt + " · " + p.messages.length + " 条消息";

    if (p.messages.length === 0) {
      var empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.setAttribute("data-oey-object", "chat.empty");
      empty.innerHTML = "这个项目还没有对话。<br>在下方输入第一条消息，Agent 会给出回复。";
      els.scroll.appendChild(empty);
      return;
    }
    p.messages.forEach(function (m) { els.scroll.appendChild(buildMsgNode(m)); });
    els.scroll.scrollTop = els.scroll.scrollHeight;
  }

  function buildMsgNode(m) {
    var wrap = document.createElement("div");
    wrap.className = "msg " + (m.role === "user" ? "user" : "agent");
    wrap.setAttribute("data-oey-object", m.role === "user" ? "chat.message.user" : "chat.message.agent");
    wrap.innerHTML =
      '<div class="msg-avatar">' + (m.role === "user" ? "我" : "AI") + "</div>" +
      "<div>" +
        '<div class="msg-bubble" data-oey-object="chat.message.bubble">' + escapeHtml(m.text) + "</div>" +
        '<div class="msg-time" data-oey-object="chat.message.time">' + m.time + "</div>" +
      "</div>";
    return wrap;
  }

  /* ---- 预览区 ---- */
  function renderPreview() {
    var p = currentProject();
    if (!p) return;
    els.previewSub.textContent = p.name + " · " + p.model;
    mockApi.getPreview(p.id).then(function (pv) {
      if (state.currentId !== p.id) return; // 防止快速切换串数据
      els.codeFile.textContent = pv.fileName;
      els.codeContent.textContent = pv.code;
      els.summaryText.textContent = pv.summary;
      els.activityList.innerHTML = "";
      if (pv.activities.length === 0) {
        var li = document.createElement("li");
        li.textContent = "暂无动态，发送一条消息试试。";
        els.activityList.appendChild(li);
      } else {
        pv.activities.forEach(function (a) {
          var li = document.createElement("li");
          li.innerHTML = "<b>" + (a.role === "user" ? "你" : "Agent") + "</b> · " + a.time +
            "<br>" + escapeHtml(a.text) + (a.text.length >= 40 ? "…" : "");
          els.activityList.appendChild(li);
        });
      }
      els.statMessages.textContent = p.messages.length;
      els.statRounds.textContent = Math.floor(p.messages.length / 2);
      els.statTokens.textContent = state.lastTokens;
      els.statLatency.textContent = state.lastLatency == null ? "—" : state.lastLatency + " ms";
    });
  }

  /* ---- 交互动作 ---- */
  function switchProject(id) {
    if (state.currentId === id) return;
    state.currentId = id;
    state.lastLatency = null;
    renderProjectList();
    renderChat();
    renderPreview();
  }

  function setSending(on) {
    state.sending = on;
    els.send.disabled = on;
    els.typing.classList.toggle("hidden", !on);
    els.status.textContent = on ? "生成中" : "空闲";
    els.status.classList.toggle("busy", on);
  }

  function sendCurrentMessage() {
    var p = currentProject();
    var text = els.input.value.trim();
    if (!p || !text || state.sending) return;
    els.input.value = "";
    setSending(true);
    mockApi.sendMessage(p.id, text)
      .then(function (res) {
        state.lastLatency = res.latencyMs;
        state.lastTokens += res.tokens;
        renderChat();
        renderProjectList(); // 消息数变化
        renderPreview();
      })
      .catch(function (err) {
        alert("发送失败：" + err.message);
      })
      .finally(function () { setSending(false); });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---- 事件绑定 ---- */
  els.composer.addEventListener("submit", function (e) {
    e.preventDefault();
    sendCurrentMessage();
  });

  els.input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });

  els.search.addEventListener("input", function () {
    state.filter = els.search.value;
    renderProjectList();
  });

  $("#btnNewProject").addEventListener("click", function () {
    var name = prompt("新项目名称：");
    if (!name || !name.trim()) return;
    mockApi.createProject(name.trim()).then(function (p) {
      state.projects.push(p);
      switchProject(p.id);
    });
  });

  $("#btnClearChat").addEventListener("click", function () {
    var p = currentProject();
    if (!p) return;
    if (!confirm("确定清空「" + p.name + "」的全部对话吗？")) return;
    p.messages = [];
    renderChat();
    renderProjectList();
    renderPreview();
  });

  $("#btnCopy").addEventListener("click", function () {
    var text = els.codeContent.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        $("#btnCopy").textContent = "已复制";
        setTimeout(function () { $("#btnCopy").textContent = "复制"; }, 1200);
      });
    }
  });

  $("#previewTabs").addEventListener("click", function (e) {
    var btn = e.target.closest(".tab-btn");
    if (!btn) return;
    document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    var tab = btn.getAttribute("data-tab");
    $("#panelCode").classList.toggle("hidden", tab !== "code");
    $("#panelSummary").classList.toggle("hidden", tab !== "summary");
    $("#panelStats").classList.toggle("hidden", tab !== "stats");
  });

  /* ---- 启动 ---- */
  mockApi.listProjects().then(function () {
    state.projects = SEED_PROJECTS;
    if (state.projects.length > 0) {
      state.currentId = state.projects[0].id;
    }
    renderProjectList();
    renderChat();
    renderPreview();
  });

})();
