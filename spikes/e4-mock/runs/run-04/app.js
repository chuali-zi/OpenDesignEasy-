(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const jitter = () => 380 + Math.floor(Math.random() * 520);
  const hash = (input) => {
    let h = 2166136261;
    for (const ch of String(input)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h >>> 0);
  };
  const pick = (arr, seed) => arr[hash(seed) % arr.length];

  const nowLabel = () => new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

  const seedProjects = [
    {
      id: "atlas",
      name: "Atlas 发布助手",
      status: "运行中",
      accent: "#7c5cff",
      summary: "负责把发布说明、风险检查和回滚步骤整理成可执行清单。",
      updated: "09:42",
      messages: [
        { role: "agent", text: "我已载入 Atlas 的发布上下文。当前聚焦：灰度策略、数据库迁移、告警阈值。", at: "09:40" },
        { role: "user", text: "先给我一版上线前检查重点。", at: "09:41" },
        { role: "agent", text: "重点三项：1) 迁移脚本必须可回滚；2) 灰度从 5% 开始，观察 20 分钟；3) 支付错误率超过 0.8% 立即熔断。", at: "09:42" }
      ],
      preview: {
        kind: "checklist",
        title: "上线前检查清单",
        items: ["备份生产库并验证恢复点", "确认 feature flag 默认关闭", "灰度批次：5% → 25% → 100%", "错误率 > 0.8% 自动回滚"]
      }
    },
    {
      id: "nova",
      name: "Nova 落地页生成",
      status: "待确认",
      accent: "#00d1a7",
      summary: "根据产品一句话描述生成营销页结构、文案片段和内联样式代码。",
      updated: "昨天",
      messages: [
        { role: "agent", text: "Nova 已准备三种页面骨架：价值主张型、对比型、案例驱动型。", at: "昨天" }
      ],
      preview: {
        kind: "code",
        title: "hero-section.html",
        language: "html",
        code: "<section class=\"hero\">\n  <h1>把重复运营交给 Agent</h1>\n  <p>从目标到产出，一条指令完成草稿。</p>\n  <button>查看工作流</button>\n</section>"
      }
    },
    {
      id: "quill",
      name: "Quill 文档问答",
      status: "暂停",
      accent: "#ffb454",
      summary: "把会议纪要、需求摘录和待办转成可追溯问答线程。",
      updated: "周一",
      messages: [
        { role: "agent", text: "Quill 当前索引 18 篇文档，最近冲突：权限模型在两个 PRD 中描述不一致。", at: "周一" }
      ],
      preview: {
        kind: "metrics",
        title: "知识库健康度",
        metrics: [
          { label: "已索引文档", value: "18" },
          { label: "待解决冲突", value: "2" },
          { label: "平均引用", value: "4.7" }
        ],
        note: "建议先统一权限模型，再开放跨项目问答。"
      }
    },
    {
      id: "orbit",
      name: "Orbit 数据巡检",
      status: "运行中",
      accent: "#ff6b81",
      summary: "定时巡检指标异常，把异常片段翻译成可排障线索。",
      updated: "08:15",
      messages: [
        { role: "agent", text: "过去 24 小时发现 3 次延迟尖刺，均集中在结算服务批处理窗口。", at: "08:15" }
      ],
      preview: {
        kind: "metrics",
        title: "巡检快照",
        metrics: [
          { label: "异常事件", value: "3" },
          { label: "P95 延迟", value: "812ms" },
          { label: "影响任务", value: "7" }
        ],
        note: "建议把批处理窗口从 02:00 调整到 03:30，并增加队列深度告警。"
      }
    }
  ];

  const db = {
    activeId: "atlas",
    projects: structuredClone(seedProjects)
  };

  function snippetFrom(text) {
    const clean = String(text).replace(/\s+/g, " ").trim();
    return clean.length > 34 ? clean.slice(0, 34) + "…" : clean || "未命名指令";
  }

  function makeCode(project, userText) {
    const fn = "task_" + (hash(project.id + userText) % 997);
    return [
      "// 由 ForgeDesk mock agent 生成",
      "export async function " + fn + "(input) {",
      "  const goal = " + JSON.stringify(snippetFrom(userText)) + ";",
      "  const policy = { retries: 2, timeoutMs: 1200, audit: true };",
      "  const steps = [" + JSON.stringify(project.summary.slice(0, 18)) + ", \"verify\", \"report\"];",
      "  return { goal, policy, steps, project: " + JSON.stringify(project.name) + " };",
      "}"
    ].join("\n");
  }

  function replyFor(project, userText) {
    const text = userText.toLowerCase();
    const seed = project.id + "|" + userText + "|" + project.messages.length;
    const openers = ["收到。", "可以，我按当前项目上下文处理。", "已理解，先给你一个可执行版本。"];

    if (/代码|code|函数|实现|snippet/.test(text)) {
      return {
        text: pick(openers, seed) + " 我把「" + snippetFrom(userText) + "」转成了一个可审查的代码片段，并同步到右侧预览。参数、重试和审计点都已标注。",
        preview: { kind: "code", title: "generated-task.js", language: "javascript", code: makeCode(project, userText) }
      };
    }
    if (/清单|检查|checklist|上线|发布|风险/.test(text)) {
      return {
        text: pick(openers, seed) + " 我按风险从高到低重排了检查项：先保证可回滚，再看灰度比例，最后确认告警接收人。",
        preview: {
          kind: "checklist",
          title: project.name + " · 风险清单",
          items: ["回滚路径已在沙箱演练", "关键指标看板已绑定值班人", "变更窗口避开业务高峰", "失败阈值触发后自动暂停后续批次"]
        }
      };
    }
    if (/指标|数据|metric|巡检|异常|延迟/.test(text)) {
      const n = hash(seed) % 5 + 1;
      return {
        text: pick(openers, seed) + " 我抽取了最近的指标轮廓：异常不算多，但集中在相同依赖上。建议先看队列深度，再看下游超时。",
        preview: {
          kind: "metrics",
          title: project.name + " · 指标草稿",
          metrics: [
            { label: "样本窗口", value: n + "h" },
            { label: "疑似根因", value: String(hash(seed) % 3 + 1) },
            { label: "建议动作", value: "2" }
          ],
          note: "该面板由规则模板根据消息关键词生成，非真实监控数据。"
        }
      };
    }
    return {
      text: pick(openers, seed) + " 针对「" + snippetFrom(userText) + "」，我建议下一步产出一张执行卡：目标、约束、验收信号各一行，避免 agent 在没有验收标准时继续扩散范围。",
      preview: {
        kind: "card",
        title: "执行卡草案",
        body: "目标：" + snippetFrom(userText) + "\n约束：保持当前项目「" + project.name + "」上下文，不引入外部服务。\n验收：预览区出现可复用产出，且能被下一轮对话继续修改。"
      }
    };
  }

  function snapshot() {
    const project = db.projects.find((p) => p.id === db.activeId) || db.projects[0];
    return structuredClone({ activeId: db.activeId, project, projects: db.projects });
  }

  window.__mockApi__ = {
    meta: { latency: "setTimeout 380-900ms", persistence: "memory-only", network: false },
    async listProjects() { await wait(jitter()); return structuredClone(db.projects); },
    async getActive() { await wait(120); return snapshot(); },
    async selectProject(id) {
      await wait(180);
      if (db.projects.some((p) => p.id === id)) db.activeId = id;
      return snapshot();
    },
    async createProject(name) {
      await wait(260);
      const id = "p" + (hash(name + Date.now()) % 100000);
      const project = {
        id,
        name: name || "未命名 Agent 项目",
        status: "待确认",
        accent: pick(["#7c5cff", "#00d1a7", "#ffb454", "#ff6b81"], name),
        summary: "由前端 mock 创建的空项目，等待第一条指令生成上下文。",
        updated: nowLabel(),
        messages: [{ role: "agent", text: "新项目已创建。给我一条目标，我会生成首版产出预览。", at: nowLabel() }],
        preview: { kind: "card", title: "空白画布", body: "还没有产出。发送一条消息，右侧会生成首版执行卡。" }
      };
      db.projects.unshift(project);
      db.activeId = id;
      return snapshot();
    },
    async sendMessage(projectId, text) {
      await wait(jitter());
      const project = db.projects.find((p) => p.id === projectId);
      if (!project) throw new Error("project not found");
      const userMsg = { role: "user", text, at: nowLabel() };
      project.messages.push(userMsg);
      const generated = replyFor(project, text);
      const agentMsg = { role: "agent", text: generated.text, at: nowLabel() };
      project.messages.push(agentMsg);
      project.preview = generated.preview;
      project.updated = nowLabel();
      project.status = "运行中";
      return structuredClone({ project, userMsg, agentMsg });
    }
  };

  const els = {
    list: $("#projectList"),
    search: $("#projectSearch"),
    newProjectBtn: $("#newProjectBtn"),
    chatTitle: $("#chatTitle"),
    chatSummary: $("#chatSummary"),
    projectStatus: $("#projectStatus"),
    messageCount: $("#messageCount"),
    messageList: $("#messageList"),
    composer: $("#composer"),
    input: $("#composerInput"),
    sendBtn: $("#sendBtn"),
    previewKind: $("#previewKind"),
    previewBody: $("#previewBody"),
    statusText: $("#statusText")
  };

  let state = { activeId: null, project: null, projects: [] };
  let sending = false;

  function setStatus(text) { els.statusText.textContent = text; }

  function projectMatches(p, q) {
    if (!q) return true;
    return (p.name + " " + p.summary + " " + p.status).toLowerCase().includes(q.toLowerCase());
  }

  function renderProjects() {
    const q = els.search.value.trim();
    const visible = state.projects.filter((p) => projectMatches(p, q));
    els.list.innerHTML = "";
    if (!visible.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.setAttribute("data-oey-object", "projects.empty");
      li.textContent = "没有匹配的项目";
      els.list.appendChild(li);
      return;
    }
    for (const p of visible) {
      const li = document.createElement("li");
      li.className = "project-item" + (p.id === state.activeId ? " active" : "");
      li.setAttribute("data-oey-object", "projects.item");
      li.dataset.projectId = p.id;
      li.innerHTML = `
        <div class="project-name"><span data-oey-object="projects.item.name"></span><span style="color:${p.accent}">●</span></div>
        <div class="project-desc" data-oey-object="projects.item.summary"></div>
        <div class="project-meta"><span data-oey-object="projects.item.status"></span><span data-oey-object="projects.item.updated"></span></div>`;
      $("[data-oey-object='projects.item.name']", li).textContent = p.name;
      $("[data-oey-object='projects.item.summary']", li).textContent = p.summary;
      $("[data-oey-object='projects.item.status']", li).textContent = p.status;
      $("[data-oey-object='projects.item.updated']", li).textContent = p.updated;
      li.addEventListener("click", async () => {
        if (p.id === state.activeId) return;
        setStatus("正在切换项目…");
        state = await window.__mockApi__.selectProject(p.id);
        renderAll();
        setStatus("已切换到「" + state.project.name + "」");
      });
      els.list.appendChild(li);
    }
  }

  function renderConversation() {
    const p = state.project;
    if (!p) return;
    els.chatTitle.textContent = p.name;
    els.chatSummary.textContent = p.summary;
    els.projectStatus.textContent = p.status;
    els.messageCount.textContent = p.messages.length + " 条";
    els.messageList.innerHTML = "";
    for (const m of p.messages) {
      const div = document.createElement("article");
      div.className = "message " + m.role;
      div.setAttribute("data-oey-object", "conversation.message");
      div.dataset.role = m.role;
      div.innerHTML = `<span class="who" data-oey-object="conversation.message.role"></span><span data-oey-object="conversation.message.text"></span><span class="who" data-oey-object="conversation.message.time"></span>`;
      $("[data-oey-object='conversation.message.role']", div).textContent = m.role === "user" ? "You" : "Agent";
      $("[data-oey-object='conversation.message.text']", div).textContent = m.text;
      $("[data-oey-object='conversation.message.time']", div).textContent = m.at;
      els.messageList.appendChild(div);
    }
    els.messageList.scrollTop = els.messageList.scrollHeight;
  }

  function metricHtml(metric) {
    return `<div class="metric" data-oey-object="preview.metric"><b></b><span></span></div>`;
  }

  function renderPreview() {
    const p = state.project;
    if (!p) return;
    const pv = p.preview;
    els.previewKind.textContent = pv.kind;
    els.previewBody.innerHTML = "";
    const card = document.createElement("section");
    card.className = "preview-card";
    card.setAttribute("data-oey-object", "preview.card");
    card.innerHTML = `<header><h3 data-oey-object="preview.card.title"></h3><span class="badge" data-oey-object="preview.card.project"></span></header><div class="card-body" data-oey-object="preview.card.body"></div>`;
    $("[data-oey-object='preview.card.title']", card).textContent = pv.title;
    $("[data-oey-object='preview.card.project']", card).textContent = p.name;
    const body = $("[data-oey-object='preview.card.body']", card);

    if (pv.kind === "code") {
      body.innerHTML = `<pre data-oey-object="preview.code"></pre>`;
      $("[data-oey-object='preview.code']", body).textContent = pv.code;
    } else if (pv.kind === "checklist") {
      const ul = document.createElement("ul");
      ul.className = "checklist";
      ul.setAttribute("data-oey-object", "preview.checklist");
      pv.items.forEach((item) => {
        const li = document.createElement("li");
        li.setAttribute("data-oey-object", "preview.checklist.item");
        li.textContent = item;
        ul.appendChild(li);
      });
      body.appendChild(ul);
    } else if (pv.kind === "metrics") {
      const grid = document.createElement("div");
      grid.className = "metric-grid";
      grid.setAttribute("data-oey-object", "preview.metrics");
      pv.metrics.forEach((m) => {
        const holder = document.createElement("div");
        holder.innerHTML = metricHtml(m);
        const node = holder.firstElementChild;
        $("b", node).textContent = m.value;
        $("span", node).textContent = m.label;
        grid.appendChild(node);
      });
      const note = document.createElement("p");
      note.setAttribute("data-oey-object", "preview.note");
      note.style.marginTop = "12px";
      note.style.color = "var(--muted)";
      note.textContent = pv.note;
      body.append(grid, note);
    } else {
      const pre = document.createElement("pre");
      pre.setAttribute("data-oey-object", "preview.text");
      pre.textContent = pv.body;
      body.appendChild(pre);
    }
    els.previewBody.appendChild(card);
  }

  function renderAll() {
    renderProjects();
    renderConversation();
    renderPreview();
  }

  function showTyping() {
    const div = document.createElement("article");
    div.className = "message agent typing";
    div.id = "typingBubble";
    div.setAttribute("data-oey-object", "conversation.message");
    div.dataset.role = "agent";
    div.innerHTML = `<span class="who" data-oey-object="conversation.message.role">Agent</span><span data-oey-object="conversation.message.text">正在组织回复并更新预览…</span>`;
    els.messageList.appendChild(div);
    els.messageList.scrollTop = els.messageList.scrollHeight;
  }

  function hideTyping() { $("#typingBubble")?.remove(); }

  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = els.input.value.trim();
    if (!text || sending || !state.project) return;
    sending = true;
    els.sendBtn.disabled = true;
    els.input.disabled = true;
    setStatus("agent 正在生成回复…");
    const localUser = { role: "user", text, at: nowLabel() };
    state.project.messages.push(localUser);
    renderConversation();
    showTyping();
    try {
      const result = await window.__mockApi__.sendMessage(state.project.id, text);
      state.project = result.project;
      const idx = state.projects.findIndex((p) => p.id === state.project.id);
      if (idx >= 0) state.projects[idx] = result.project;
      els.input.value = "";
      hideTyping();
      renderAll();
      setStatus("已生成回复，并同步刷新预览");
    } catch (err) {
      hideTyping();
      setStatus("发送失败：" + err.message);
    } finally {
      sending = false;
      els.sendBtn.disabled = false;
      els.input.disabled = false;
      els.input.focus();
    }
  });

  els.input.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      els.composer.requestSubmit();
    }
  });

  els.search.addEventListener("input", renderProjects);

  els.newProjectBtn.addEventListener("click", async () => {
    const name = window.prompt("新项目名称：", "Untitled Agent " + (state.projects.length + 1));
    if (name === null) return;
    setStatus("正在创建 mock 项目…");
    state = await window.__mockApi__.createProject(name.trim());
    renderAll();
    setStatus("已创建并切换到「" + state.project.name + "」");
  });

  (async function init() {
    setStatus("正在装载 mock 数据…");
    state = await window.__mockApi__.getActive();
    renderAll();
    setStatus("就绪 · 当前项目：" + state.project.name);
    els.input.focus();
  })();
})();
