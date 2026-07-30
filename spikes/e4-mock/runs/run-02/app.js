/* =====================================================================
 * Nexus Agent 工作台 —— 纯前端静态原型
 *
 * 本文件包含两部分：
 *   1) window.__mockApi__ —— 一个完全在前端实现的假后端客户端，
 *      用「内联数据 + 规则推导 + setTimeout 延迟」模拟网络接口。
 *   2) UI 层 —— 项目列表 / 对话区 / 预览区 的渲染与交互。
 *
 * 所有 mock 行为的详细声明见 MOCK.md。
 * ===================================================================== */

(function () {
  "use strict";

  /* ==================================================================
   * 一、内联假数据（纯虚构）
   * ================================================================== */

  var SEED_PROJECTS = [
    {
      id: "p-website",
      name: "官网重构助手",
      desc: "把旧官网迁移到语义化静态页面",
      color: "#5b8cff",
      status: "进行中",
      kindLabel: "代码产出",
      messages: [
        { role: "user", text: "先帮我看一下旧站首页的结构问题。", time: "10:02" },
        { role: "agent", text: "已分析旧首页：存在 3 层无意义 div 嵌套、内联样式 27 处、缺少语义化标签。建议先落地一个 header/nav/main/footer 的骨架，我已在右侧预览区生成初版代码。", time: "10:02" }
      ],
      artifact: {
        kind: "code",
        title: "index.html · 语义化骨架 v1",
        meta: "由 agent 在会话初始化时生成",
        code: [
          "<!DOCTYPE html>",
          "<html lang=\"zh-CN\">",
          "<head>",
          "  <meta charset=\"UTF-8\">",
          "  <title>公司官网 · 重构版</title>",
          "</head>",
          "<body>",
          "  <header class=\"site-header\">…</header>",
          "  <nav class=\"site-nav\">…</nav>",
          "  <main>",
          "    <section class=\"hero\">…</section>",
          "    <section class=\"features\">…</section>",
          "  </main>",
          "  <footer class=\"site-footer\">…</footer>",
          "</body>",
          "</html>"
        ].join("\n")
      }
    },
    {
      id: "p-weekly",
      name: "周报撰写助手",
      desc: "每周五自动汇总产出周报草稿",
      color: "#3ecf8e",
      status: "待命",
      kindLabel: "图文报告",
      messages: [
        { role: "user", text: "这周的周报先起个草稿。", time: "周五 16:40" },
        { role: "agent", text: "已按「本周进展 / 数据亮点 / 下周计划」三段式生成草稿，摘要卡片在右侧预览区。数据亮点部分是占位数字，记得替换成真实数据。", time: "周五 16:41" }
      ],
      artifact: {
        kind: "report",
        title: "本周周报 · 草稿 v1",
        meta: "三段式模板自动生成",
        paragraphs: [
          "本周进展：完成官网信息架构梳理，输出重构方案并与设计侧对齐；周报自动化流程跑通首轮。",
          "数据亮点（占位）：页面平均加载耗时下降 38%，核心流程转化率环比 +6.2%。",
          "下周计划：落地首页语义化重构；补充周报数据采集脚本，去掉手工填数环节。"
        ],
        stats: [
          { label: "完成任务", value: "7" },
          { label: "进行中", value: "3" },
          { label: "阻塞项", value: "1" }
        ]
      }
    },
    {
      id: "p-data",
      name: "数据分析助手",
      desc: "对导出报表做快速解读",
      color: "#f0b429",
      status: "进行中",
      kindLabel: "数据表格",
      messages: [
        { role: "user", text: "看一下上季度各渠道的注册量。", time: "昨天 11:20" },
        { role: "agent", text: "已整理成对照表放在右侧预览区。自然搜索占比最高（41%），但环比增速最快的是社群渠道（+18%），建议下周拆一下社群的获客路径。", time: "昨天 11:21" }
      ],
      artifact: {
        kind: "table",
        title: "Q3 各渠道注册量对照",
        meta: "示例报表 · 数据为虚构",
        columns: ["渠道", "注册量", "占比", "环比"],
        rows: [
          ["自然搜索", "12,480", "41%", "+4%"],
          ["社群裂变", "6,930", "23%", "+18%"],
          ["广告投放", "6,120", "20%", "-3%"],
          ["老带新", "4,890", "16%", "+7%"]
        ]
      }
    },
    {
      id: "p-blank",
      name: "新会话 · 未命名",
      desc: "空白项目，还没有任何产出",
      color: "#9b6bff",
      status: "空闲",
      kindLabel: "暂无产出",
      messages: [
        { role: "agent", text: "你好，我是这个项目的专属 agent。告诉我你想做什么，例如「帮我生成一段代码」「出一份总结」「整理成表格」，产出会实时显示在右侧预览区。", time: "刚刚" }
      ],
      artifact: null
    }
  ];

  /* ==================================================================
   * 二、Mock 客户端：window.__mockApi__
   *
   * 技术手段：内联数据 + 规则推导 + setTimeout 模拟网络延迟。
   * 没有发起任何真实网络请求。
   * ================================================================== */

  var LATENCY_MIN = 250;
  var LATENCY_MAX = 700;

  function delay(value) {
    var ms = LATENCY_MIN + Math.random() * (LATENCY_MAX - LATENCY_MIN);
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(value); }, ms);
    });
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function nowTime() {
    var d = new Date();
    var h = String(d.getHours()).padStart(2, "0");
    var m = String(d.getMinutes()).padStart(2, "0");
    return h + ":" + m;
  }

  /* ---------- 回复与产出的「规则推导」引擎 ---------- */

  function pick(arr, seed) {
    return arr[seed % arr.length];
  }

  /**
   * 根据用户输入文本推导 agent 回复 + 预览产出更新。
   * 规则（与 MOCK.md 一致）：
   *  - 含「代码/code/函数/接口」→ 生成代码型产出，代码内容按输入长度生成行数；
   *  - 含「总结/报告/周报/汇总」→ 生成报告型产出，段落由输入关键词拼接；
   *  - 含「表/数据/统计/对比」→ 生成表格型产出，行由输入分词生成；
   *  - 其它 → 纯文本回复，不更新预览。
   */
  function deriveReply(project, userText, historyCount) {
    var text = userText.trim();
    var lower = text.toLowerCase();
    var seed = text.length + historyCount;

    var isCode = /代码|code|函数|接口|脚本/i.test(lower);
    var isReport = /总结|报告|周报|汇总|复盘/.test(text);
    var isTable = /表格|数据|统计|对比|清单/.test(text);

    if (isCode) {
      var fnName = "task_" + (historyCount + 1);
      var lines = [
        "// 由 nexus-1 根据指令生成：" + (text.length > 24 ? text.slice(0, 24) + "…" : text),
        "function " + fnName + "(input) {",
        "  const payload = normalize(input);"
      ];
      var extra = 2 + (seed % 4); // 由输入长度推导出 2~5 行占位逻辑
      for (var i = 0; i < extra; i++) {
        lines.push("  step" + (i + 1) + "(payload); // TODO: 与真实逻辑对齐");
      }
      lines.push("  return payload;");
      lines.push("}");
      return {
        text: pick([
          "收到，已生成一版代码草稿放在右侧预览区，共 " + lines.length + " 行。占位步骤数量是按你这条指令的长度推导的，接入真实逻辑前先把 TODO 补掉。",
          "已在预览区更新代码卡片。这版是骨架实现，行内 TODO 的数量由指令长度决定，方便你评估还剩多少工作量。"
        ], seed),
        artifact: {
          kind: "code",
          title: project.name + " · 代码草稿 v" + (historyCount + 1),
          meta: "由规则引擎按指令长度生成 · " + nowTime(),
          code: lines.join("\n")
        }
      };
    }

    if (isReport) {
      var keywords = text.split(/[，,。.\s、；;]+/).filter(function (w) { return w.length >= 2; }).slice(0, 3);
      if (keywords.length === 0) keywords = ["整体工作"];
      return {
        text: "已按「进展 / 亮点 / 计划」三段式生成总结草稿，正文围绕你提到的「" + keywords.join("」「") + "」展开，摘要卡片已同步到预览区。数字均为占位，请替换为真实数据。",
        artifact: {
          kind: "report",
          title: project.name + " · 总结草稿 v" + (historyCount + 1),
          meta: "三段式模板 · 关键词取自你的指令 · " + nowTime(),
          paragraphs: [
            "进展：围绕「" + keywords[0] + "」的推进已完成阶段性目标，关键节点均已对齐。",
            "亮点（占位）：" + (keywords[1] || keywords[0]) + "相关指标环比 +" + (3 + seed % 15) + "%，整体走势向好。",
            "计划：下一步聚焦「" + (keywords[2] || keywords[0]) + "」，并补齐数据回收链路。"
          ],
          stats: [
            { label: "覆盖要点", value: String(keywords.length) },
            { label: "草稿版本", value: "v" + (historyCount + 1) },
            { label: "待核对", value: String(1 + seed % 3) }
          ]
        }
      };
    }

    if (isTable) {
      var words = text.split(/[，,。.\s、；;]+/).filter(function (w) { return w.length >= 1; }).slice(0, 4);
      if (words.length === 0) words = ["默认项"];
      var rows = words.map(function (w, idx) {
        return [
          w.length > 8 ? w.slice(0, 8) : w,
          String((seed + idx * 7) % 90 + 10) + "," + String((seed * (idx + 3)) % 900 + 100),
          String(5 + ((seed + idx * 11) % 40)) + "%",
          (idx % 2 === 0 ? "+" : "-") + (1 + (seed + idx) % 12) + "%"
        ];
      });
      return {
        text: "已把你的指令拆成 " + rows.length + " 个维度整理成对照表，放在右侧预览区。表内数值由固定伪随机规则生成，仅作布局演示，不要当作真实数据使用。",
        artifact: {
          kind: "table",
          title: project.name + " · 数据对照 v" + (historyCount + 1),
          meta: "行由指令分词生成 · 数值为伪随机占位 · " + nowTime(),
          columns: ["维度", "量级", "占比", "环比"],
          rows: rows
        }
      };
    }

    return {
      text: pick([
        "明白了。你这条指令没有命中代码 / 总结 / 表格的生成规则，所以我先记录为待办。试试加上「生成代码」「出一份总结」或「整理成表格」，预览区会立刻给出对应产出。",
        "已收到并归档。当前这条更像讨论而非产出型指令，我暂不改动预览区。如果要我产出东西，可以在指令里说明想要代码、报告还是表格。",
        "好的，我记下了（这是本会话第 " + (historyCount + 1) + " 条消息）。需要可交付的产出时，直接说「帮我写代码 / 写总结 / 做表格」即可。"
      ], seed),
      artifact: null
    };
  }

  /* ---------- mock 接口 ---------- */

  var mockApi = {
    /** 项目列表：返回内联种子数据的摘要 */
    listProjects: function () {
      return delay(clone(SEED_PROJECTS).map(function (p) {
        return {
          id: p.id, name: p.name, desc: p.desc,
          color: p.color, status: p.status,
          messageCount: p.messages.length
        };
      }));
    },

    /** 打开项目：返回完整会话与产出 */
    openProject: function (id) {
      var p = SEED_PROJECTS.find(function (x) { return x.id === id; });
      if (!p) return delay(null);
      p.status = "进行中";
      return delay(clone(p));
    },

    /** 新建项目：前端本地创建，立即入列 */
    createProject: function () {
      var n = SEED_PROJECTS.filter(function (p) { return p.id.indexOf("p-custom-") === 0; }).length + 1;
      var p = {
        id: "p-custom-" + Date.now(),
        name: "新会话 · " + n,
        desc: "本地新建的空项目",
        color: "#e06c9f",
        status: "空闲",
        kindLabel: "暂无产出",
        messages: [
          { role: "agent", text: "项目已创建。发一条指令试试，比如「帮我生成一段代码」。", time: nowTime() }
        ],
        artifact: null
      };
      SEED_PROJECTS.unshift(p);
      return delay(clone(p));
    },

    /** 发送消息：规则推导回复，并把回复与产出写回项目 */
    sendMessage: function (projectId, userText) {
      var p = SEED_PROJECTS.find(function (x) { return x.id === projectId; });
      if (!p) return delay({ error: "project not found" });

      var t = nowTime();
      p.messages.push({ role: "user", text: userText, time: t });

      var derived = deriveReply(p, userText, p.messages.length);
      p.messages.push({ role: "agent", text: derived.text, time: t });
      if (derived.artifact) {
        p.artifact = derived.artifact;
        p.kindLabel = derived.artifact.kind === "code" ? "代码产出"
                    : derived.artifact.kind === "report" ? "图文报告" : "数据表格";
      }

      return delay({
        reply: clone(p.messages[p.messages.length - 1]),
        artifact: clone(p.artifact),
        kindLabel: p.kindLabel
      });
    }
  };

  window.__mockApi__ = mockApi;

  /* ==================================================================
   * 三、UI 层
   * ================================================================== */

  var state = {
    projects: [],
    currentId: null,
    sending: false
  };

  var els = {
    projectList: document.getElementById("projectList"),
    chatTitle: document.getElementById("chatTitle"),
    chatSubtitle: document.getElementById("chatSubtitle"),
    chatMessages: document.getElementById("chatMessages"),
    typing: document.getElementById("typingIndicator"),
    composer: document.getElementById("composer"),
    input: document.getElementById("composerInput"),
    sendBtn: document.getElementById("composerSend"),
    previewBody: document.getElementById("previewBody"),
    previewKind: document.getElementById("previewKind"),
    netStatus: document.getElementById("netStatus"),
    btnNew: document.getElementById("btnNewProject")
  };

  function setBusy(busy, label) {
    els.netStatus.textContent = busy ? (label || "mock 请求中…") : "mock 链路正常";
    els.netStatus.classList.toggle("busy", busy);
  }

  /* ---------- 项目列表渲染 ---------- */

  function renderProjects() {
    els.projectList.innerHTML = "";
    state.projects.forEach(function (p) {
      var li = document.createElement("li");
      li.className = "project-item" + (p.id === state.currentId ? " active" : "");
      li.setAttribute("data-oey-object", "projects.item");
      li.dataset.projectId = p.id;

      var dot = document.createElement("span");
      dot.className = "project-dot";
      dot.style.background = p.color;
      dot.setAttribute("data-oey-object", "projects.item.dot");

      var name = document.createElement("span");
      name.className = "project-name";
      name.textContent = p.name;
      name.setAttribute("data-oey-object", "projects.item.name");

      var meta = document.createElement("span");
      meta.className = "project-meta";
      meta.textContent = p.desc;
      meta.setAttribute("data-oey-object", "projects.item.meta");

      var status = document.createElement("span");
      status.className = "project-status";
      status.textContent = p.status;
      status.setAttribute("data-oey-object", "projects.item.status");

      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(meta);
      li.appendChild(status);

      li.addEventListener("click", function () { switchProject(p.id); });
      els.projectList.appendChild(li);
    });
  }

  /* ---------- 对话区渲染 ---------- */

  function appendMessage(msg) {
    var wrap = document.createElement("div");
    wrap.className = "msg " + (msg.role === "user" ? "msg-user" : "msg-agent");
    wrap.setAttribute("data-oey-object", "chat.message");

    var author = document.createElement("div");
    author.className = "msg-author";
    author.textContent = msg.role === "user" ? "我" : "nexus-1 · agent";
    author.setAttribute("data-oey-object", "chat.message.author");

    var bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.textContent = msg.text;
    bubble.setAttribute("data-oey-object", "chat.message.text");

    var time = document.createElement("div");
    time.className = "msg-time";
    time.textContent = msg.time || "";
    time.setAttribute("data-oey-object", "chat.message.time");

    wrap.appendChild(author);
    wrap.appendChild(bubble);
    wrap.appendChild(time);
    els.chatMessages.appendChild(wrap);
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  function renderMessages(messages) {
    els.chatMessages.innerHTML = "";
    messages.forEach(appendMessage);
  }

  /* ---------- 预览区渲染 ---------- */

  function makeCard(titleText, metaText) {
    var card = document.createElement("article");
    card.className = "preview-card";
    card.setAttribute("data-oey-object", "preview.card");

    var title = document.createElement("h3");
    title.className = "preview-card-title";
    title.textContent = titleText;
    title.setAttribute("data-oey-object", "preview.card.title");

    var content = document.createElement("div");
    content.className = "preview-card-content";
    content.setAttribute("data-oey-object", "preview.card.content");

    var foot = document.createElement("div");
    foot.className = "preview-card-foot";
    foot.textContent = metaText || "";
    foot.setAttribute("data-oey-object", "preview.card.meta");

    card.appendChild(title);
    card.appendChild(content);
    card.appendChild(foot);
    return { card: card, content: content };
  }

  function renderPreview(artifact, kindLabel, flash) {
    els.previewBody.innerHTML = "";
    els.previewKind.textContent = kindLabel || "暂无产出";

    if (!artifact) {
      var empty = document.createElement("div");
      empty.className = "preview-empty";
      empty.textContent = "当前项目还没有产出。在对话里发出指令后，这里会实时更新。";
      empty.setAttribute("data-oey-object", "preview.empty");
      els.previewBody.appendChild(empty);
      return;
    }

    var parts = makeCard(artifact.title, artifact.meta);

    if (artifact.kind === "code") {
      var pre = document.createElement("pre");
      pre.className = "preview-code";
      pre.textContent = artifact.code;
      parts.content.appendChild(pre);
    } else if (artifact.kind === "report") {
      if (artifact.stats && artifact.stats.length) {
        var statRow = document.createElement("div");
        statRow.className = "preview-stat-row";
        artifact.stats.forEach(function (s) {
          var box = document.createElement("div");
          box.className = "preview-stat";
          var b = document.createElement("b");
          b.textContent = s.value;
          var span = document.createElement("span");
          span.textContent = s.label;
          box.appendChild(b);
          box.appendChild(span);
          statRow.appendChild(box);
        });
        parts.content.appendChild(statRow);
      }
      artifact.paragraphs.forEach(function (pText) {
        var p = document.createElement("p");
        p.textContent = pText;
        p.style.marginTop = "8px";
        parts.content.appendChild(p);
      });
    } else if (artifact.kind === "table") {
      var table = document.createElement("table");
      table.className = "preview-table";
      var thead = document.createElement("thead");
      var trHead = document.createElement("tr");
      artifact.columns.forEach(function (c) {
        var th = document.createElement("th");
        th.textContent = c;
        trHead.appendChild(th);
      });
      thead.appendChild(trHead);
      table.appendChild(thead);
      var tbody = document.createElement("tbody");
      artifact.rows.forEach(function (row) {
        var tr = document.createElement("tr");
        row.forEach(function (cell) {
          var td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      parts.content.appendChild(table);
    }

    if (flash) parts.card.classList.add("flash");
    els.previewBody.appendChild(parts.card);
  }

  /* ---------- 交互流程 ---------- */

  function switchProject(id) {
    if (state.sending || id === state.currentId) return;
    state.currentId = id;
    renderProjects();
    els.chatTitle.textContent = "加载中…";
    els.chatSubtitle.textContent = "";
    els.chatMessages.innerHTML = "";
    renderPreview(null, "加载中…", false);

    setBusy(true, "正在打开项目…");
    mockApi.openProject(id).then(function (project) {
      setBusy(false);
      if (!project || state.currentId !== id) return;
      els.chatTitle.textContent = project.name;
      els.chatSubtitle.textContent = project.desc;
      renderMessages(project.messages);
      renderPreview(project.artifact, project.kindLabel, false);
    });
  }

  function sendCurrentMessage() {
    var text = els.input.value.trim();
    if (!text || state.sending || !state.currentId) return;

    state.sending = true;
    els.sendBtn.disabled = true;
    els.input.value = "";

    // 用户消息立即上屏（乐观渲染），同时走 mock 接口拿回复
    appendMessage({ role: "user", text: text, time: "" });
    els.typing.classList.remove("hidden");
    setBusy(true, "agent 生成中…");

    mockApi.sendMessage(state.currentId, text).then(function (res) {
      els.typing.classList.add("hidden");
      setBusy(false);
      state.sending = false;
      els.sendBtn.disabled = false;
      if (!res || res.error) return;

      appendMessage(res.reply);
      if (res.artifact) {
        renderPreview(res.artifact, res.kindLabel, true);
      }
      // 列表里的状态/消息数同步刷新
      mockApi.listProjects().then(function (list) {
        state.projects = list;
        renderProjects();
      });
    });
  }

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

  els.btnNew.addEventListener("click", function () {
    if (state.sending) return;
    setBusy(true, "正在创建项目…");
    mockApi.createProject().then(function (p) {
      setBusy(false);
      return mockApi.listProjects().then(function (list) {
        state.projects = list;
        state.currentId = null; // 强制触发完整切换
        renderProjects();
        switchProject(p.id);
      });
    });
  });

  /* ---------- 启动 ---------- */

  setBusy(true, "正在加载项目列表…");
  mockApi.listProjects().then(function (list) {
    setBusy(false);
    state.projects = list;
    renderProjects();
    if (list.length) switchProject(list[0].id);
  });

})();
