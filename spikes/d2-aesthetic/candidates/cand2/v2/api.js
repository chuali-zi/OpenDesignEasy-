/* 环线 THE LOOP — mock API 客户端
 * 没有真实后端：所有「接口」都是这个文件里的本地函数，
 * 用 setTimeout 模拟网络延迟，数据直接读写 window.__OEP_DATA__ 的内联数组。
 * 暴露为 window.__mockApi__，界面层（app.js）只通过它取数/提交。
 */
(function () {
  const db = window.__OEP_DATA__;
  const LATENCY_MIN = 160;
  const LATENCY_SPAN = 240;

  function wait() {
    return new Promise((resolve) =>
      setTimeout(resolve, LATENCY_MIN + Math.random() * LATENCY_SPAN)
    );
  }
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  function find(id) {
    return db.projects.find((p) => p.id === id);
  }
  function now() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  window.__mockApi__ = {
    /* 项目横带：只回摘要字段 */
    async listProjects() {
      await wait();
      return db.projects.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        status: p.status,
        statusTone: p.statusTone
      }));
    },

    /* 进入某个项目：回完整详情 */
    async getProject(id) {
      await wait();
      const p = find(id);
      if (!p) throw new Error("project not found: " + id);
      return clone(p);
    },

    /* 整体方向反馈：推翻当前候选，状态变为重审中 */
    async submitDirectionFeedback(id, text) {
      await wait();
      const p = find(id);
      if (!p) throw new Error("project not found: " + id);
      const t = now();
      p.status = "方向重审中";
      p.statusTone = "busy";
      p.feedbackLog.push({ t, type: "整体方向", text });
      p.events.push({ t, actor: "user", text: `推翻整体方向：「${text}」` });
      p.events.push({ t, actor: "agent", text: "收到方向级批注，当前候选作废，正在重新构思方向…" });
      return { project: clone(p), message: "已记录：这个方向推翻，agent 开始重做" };
    },

    /* 局部反馈：方向保留，只登记一处微调 */
    async submitLocalFeedback(id, region, text) {
      await wait();
      const p = find(id);
      if (!p) throw new Error("project not found: " + id);
      const t = now();
      p.feedbackLog.push({ t, type: "局部微调", text: `「${region}」${text}` });
      p.events.push({ t, actor: "user", text: `局部批注 ·「${region}」：${text}` });
      p.events.push({ t, actor: "agent", text: `已把「${region}」列入微调队列，方向不变，只改这一处。` });
      return { project: clone(p), message: `已记录对「${region}」的局部批注` };
    },

    /* 新案子：按固定规则生成一个「刚起步」的项目骨架 */
    async createProject({ name, preset, role }) {
      await wait();
      const t = now();
      const p = {
        id: "p-" + Math.random().toString(36).slice(2, 8),
        name,
        kind: "待定",
        status: "需求澄清中",
        statusTone: "busy",
        brief: "（新案子，需求尚未澄清完整）",
        preset,
        templateRole: role,
        revision: { no: 0, note: "尚无候选 · 等待需求澄清", updatedAt: t },
        regions: [],
        preview: null,
        events: [
          { t, actor: "system", text: `项目创建：preset「${preset}」/ template role「${role}」。` },
          { t, actor: "agent", text: "需求还不够清楚，先不急着出稿——正在整理要问你的问题。" },
          { t, actor: "agent", text: "提出澄清问题：产物是网页、PPT 还是文档？给谁看？什么叫「好看」？" }
        ],
        constraints: {
          tone: "待澄清",
          palette: "待澄清",
          rules: ["（约束档案将在需求澄清后生成）"]
        },
        quality: { hard: [], aesthetic: [] },
        feedbackLog: [],
        delivery: { state: "wait", note: "还没有可交付的 Artifact。", records: [] }
      };
      db.projects.push(p);
      return { project: clone(p), message: `「${name}」已进入环线` };
    }
  };
})();
