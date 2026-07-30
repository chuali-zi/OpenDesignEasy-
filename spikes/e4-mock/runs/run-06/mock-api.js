/* =========================================================================
 * mock-api.js —— 纯前端 Mock 层
 *
 * 本文件在没有真实后端的情况下，模拟出一个"REST 风格"的异步 API：
 *   MockApi.listProjects()                 -> GET    /api/projects
 *   MockApi.getProject(id)                 -> GET    /api/projects/:id
 *   MockApi.sendMessage(projectId, text)   -> POST   /api/projects/:id/messages
 *   MockApi.createProject(name)            -> POST   /api/projects
 *
 * 实现手段：
 *   1. 全部数据是内联在 DB 常量里的纯虚构数组；
 *   2. 用 Promise + setTimeout 模拟 300~900ms 的随机网络延迟；
 *   3. Agent 的回复不是写死的，而是由 generateReply() 按关键词规则
 *      从模板推导生成（规则见函数注释及 MOCK.md）；
 *   4. 通过 window.__mockApi__ 暴露给界面层使用。
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------------- 模拟网络延迟 ---------------- */
  function latency() {
    return 300 + Math.random() * 600; // 300 ~ 900ms
  }
  function respond(producer) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(producer()); }, latency());
    });
  }

  /* ---------------- 内联虚构数据 ---------------- */
  var DB = {
    projects: [
      {
        id: 'p-landing',
        name: '官网落地页生成',
        desc: '根据一句话简介生成营销落地页的文案与结构',
        status: 'running',
        updatedAt: '10:24',
        messages: [
          { role: 'user', text: '帮我做一版面向独立开发者的落地页，产品是 Markdown 笔记同步工具。', time: '10:18' },
          {
            role: 'agent',
            text: '收到。我按「痛点 → 方案 → 特性 → 行动号召」的经典结构起草了一版落地页大纲，主标语突出"离线优先、秒级同步"。预览区可以看到完整的卡片式结构，需要调整语气或补充价格区块的话直接说。',
            time: '10:19',
            artifact: {
              kind: 'card',
              title: '落地页大纲 · SyncMD',
              desc: '主标语：写下即同步，灵感不落地。\n\n目标人群：跨设备写作的独立开发者与文字工作者。核心卖点提炼为三条：离线优先的本地存储、端到端加密同步、纯 Markdown 无锁定。页面结构为 Hero / 痛点对比 / 三特性卡片 / 用户评价 / CTA 五段。',
              stats: [
                { num: '5', label: '页面区块' },
                { num: '3', label: '核心卖点' },
                { num: '2', label: '备选标语' },
                { num: 'A/B', label: '建议测试' }
              ]
            }
          }
        ]
      },
      {
        id: 'p-report',
        name: '每周数据周报',
        desc: '自动汇总产品核心指标并生成图文周报',
        status: 'idle',
        updatedAt: '昨天 18:02',
        messages: [
          { role: 'user', text: '生成本周的数据周报，重点关注留存。', time: '昨天 17:58' },
          {
            role: 'agent',
            text: '本周周报已生成。整体 DAU 环比 +6.2%，但次日留存下滑了 1.8 个百分点，主要集中在新注册用户的 Android 端。我在报告卡里标红了这个风险项，并附了两条排查建议。',
            time: '昨天 18:02',
            artifact: {
              kind: 'card',
              title: '数据周报 · 第 42 周',
              desc: 'DAU 12,480（环比 +6.2%），周活 58,310（+3.1%）。⚠ 次日留存 31.4%，环比 -1.8pt，下滑集中在 Android 新客。建议：1) 检查新版启动页加载耗时；2) 对新客首日推送做分组对照。',
              stats: [
                { num: '12,480', label: 'DAU' },
                { num: '+6.2%', label: '环比' },
                { num: '31.4%', label: '次日留存' },
                { num: '-1.8pt', label: '留存变化' }
              ]
            }
          }
        ]
      },
      {
        id: 'p-component',
        name: 'React 组件工坊',
        desc: '用自然语言描述生成可复用的 React 组件代码',
        status: 'running',
        updatedAt: '09:47',
        messages: [
          { role: 'user', text: '写一个带加载态的按钮组件，支持 disabled。', time: '09:45' },
          {
            role: 'agent',
            text: '已生成 AsyncButton 组件：接受 loading / disabled 两个 props，loading 时自动禁用点击并显示旋转指示符。代码在右侧预览区，未引入任何第三方依赖。',
            time: '09:47',
            artifact: {
              kind: 'code',
              title: 'AsyncButton.jsx',
              code: 'export function AsyncButton({ loading, disabled, children, onClick }) {\n  return (\n    <button\n      className={loading ? "btn is-loading" : "btn"}\n      disabled={loading || disabled}\n      onClick={onClick}\n    >\n      {loading ? <span className="spinner" /> : children}\n    </button>\n  );\n}'
            }
          }
        ]
      },
      {
        id: 'p-plan',
        name: '发布计划编排',
        desc: '把模糊的上线想法拆解成可执行的任务清单',
        status: 'draft',
        updatedAt: '周一 14:11',
        messages: [
          { role: 'user', text: '我们下周想灰度上线新版搜索，帮我拆一下计划。', time: '周一 14:08' },
          {
            role: 'agent',
            text: '已把「新版搜索灰度上线」拆成 5 步执行清单，按「准备 → 小流量 → 观察 → 扩量 → 全量」编排，并标注了每一步的负责人角色与回滚条件，见右侧预览。',
            time: '周一 14:11',
            artifact: {
              kind: 'steps',
              title: '新版搜索 · 灰度上线清单',
              steps: [
                '准备阶段：补齐搜索核心指标看板（QPS / 无结果率 / 点击率），确认回滚开关可用。',
                '小流量：内部员工 + 1% 随机用户，持续 24 小时。',
                '观察：无结果率不高于旧版 105%，崩溃率为 0，否则立即回滚。',
                '扩量：提升至 20% 流量，观察 48 小时并收集反馈。',
                '全量：100% 放量，旧版代码保留一个迭代周期后下线。'
              ]
            }
          }
        ]
      }
    ]
  };

  /* ---------------- 工具 ---------------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function nowTime() {
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function findProject(id) {
    for (var i = 0; i < DB.projects.length; i++) {
      if (DB.projects[i].id === id) return DB.projects[i];
    }
    return null;
  }
  function excerpt(text, n) {
    text = String(text).replace(/\s+/g, ' ').trim();
    return text.length > n ? text.slice(0, n) + '…' : text;
  }

  /* =========================================================================
   * Agent 回复生成器（规则模板推导，非写死文案）
   *
   * 规则：
   *   1. 消息含「组件/代码/按钮/函数/code」→ 生成 code 类产出 + 代码说明回复；
   *   2. 含「报告/周报/数据/统计/指标」   → 生成 card 类数据卡片 + 解读回复；
   *   3. 含「计划/步骤/清单/方案/安排/拆解」→ 生成 steps 类任务清单 + 说明回复；
   *   4. 其他                               → 生成 card 类"理解摘要"卡片 + 摘要回复。
   * 所有模板都会把用户原文片段、当前项目名、消息序号注入，因此同样一句话
   * 在不同项目里、或同一项目里说多次，得到的内容也不完全一样。
   * ========================================================================= */
  function generateReply(project, userText) {
    var turn = project.messages.length + 1;
    var quote = excerpt(userText, 18);

    if (/组件|代码|按钮|函数|脚本|code/i.test(userText)) {
      return {
        text: '明白，我把「' + quote + '」当作一个编码任务来处理。结合「' + project.name + '」的上下文，我生成了一段可直接使用的实现（第 ' + turn + ' 轮产出），代码已同步到右侧预览区；如果你想换语言或调整参数命名，继续说就行。',
        artifact: {
          kind: 'code',
          title: 'snippet-' + project.id.replace(/^p-/, '') + '-r' + turn + '.js',
          code:
            '// 需求: ' + excerpt(userText, 40) + '\n' +
            '// 由 ' + project.name + ' · 第 ' + turn + ' 轮生成\n' +
            'function buildSolution() {\n' +
            '  const input = "' + excerpt(userText, 24).replace(/"/g, '\\"') + '";\n' +
            '  const steps = input.split(/[，,。.;；]/).filter(Boolean);\n' +
            '  return steps.map((s, i) => ({ order: i + 1, task: s.trim(), done: false }));\n' +
            '}\n\n' +
            'module.exports = { buildSolution };'
        }
      };
    }

    if (/报告|周报|日报|数据|统计|指标|分析/.test(userText)) {
      var seed = (userText.length * 7 + turn * 13) % 90;
      return {
        text: '好的，我围绕「' + quote + '」整理了一份数据视角的摘要卡：核心数值基于该会话第 ' + turn + ' 轮的上下文推算（演示环境为规则生成），风险项和建议已一并写入，完整卡片见预览区。',
        artifact: {
          kind: 'card',
          title: '数据摘要 · ' + project.name,
          desc: '主题：' + excerpt(userText, 40) + '\n\n整体表现平稳，综合得分 ' + (60 + seed % 35) + '/100。发现 1 个需要关注的波动项，建议先核对口径再下结论；下轮可补充对比维度做交叉验证。',
          stats: [
            { num: String(60 + seed % 35), label: '综合得分' },
            { num: '+' + (seed % 9 + 1) + '.' + (seed % 9) + '%', label: '环比变化' },
            { num: String(seed % 4 + 1), label: '风险项' },
            { num: 'R' + turn, label: '生成轮次' }
          ]
        }
      };
    }

    if (/计划|步骤|清单|方案|安排|拆解|流程/.test(userText)) {
      return {
        text: '我把「' + quote + '」拆成了一份 4 步执行清单（这是该会话第 ' + turn + ' 次拆解，粒度比上一轮更细）。每一步都带了验收标准，右侧预览区可以逐项查看，觉得节奏太紧或太松都可以让我重排。',
        artifact: {
          kind: 'steps',
          title: '执行清单 · ' + excerpt(userText, 12),
          steps: [
            '明确目标：把「' + excerpt(userText, 20) + '」收敛为一句可验收的结果描述。',
            '盘点依赖：列出涉及的人、数据与工具，标出当前缺口。',
            '小步验证：先用最小范围跑通一次，记录耗时与阻塞点。',
            '复盘推广：验证通过后固化流程，并在「' + project.name + '」内沉淀为模板。'
          ]
        }
      };
    }

    return {
      text: '收到「' + quote + '」。我按「' + project.name + '」的语境做了理解摘要并同步到预览区：目前我提炼出 1 个核心诉求和 2 个待确认点。你可以直接补充细节，或者说"拆成计划"/"生成代码"，我会切换对应的产出形式。',
      artifact: {
        kind: 'card',
        title: '理解摘要 · 第 ' + turn + ' 轮',
        desc: '原始输入：' + excerpt(userText, 60) + '\n\n核心诉求：围绕该主题获得可执行的下一步。待确认：① 期望的产出形态（文档 / 代码 / 清单）；② 时间或范围约束。',
        stats: [
          { num: '1', label: '核心诉求' },
          { num: '2', label: '待确认点' },
          { num: String(turn), label: '会话轮次' },
          { num: project.name.length + '字', label: '项目名长度' }
        ]
      }
    };
  }

  /* ---------------- Mock API（模拟 REST 端点） ---------------- */
  var MockApi = {
    // GET /api/projects
    listProjects: function () {
      return respond(function () {
        return clone(DB.projects).map(function (p) {
          return {
            id: p.id, name: p.name, desc: p.desc,
            status: p.status, updatedAt: p.updatedAt,
            lastMessage: p.messages.length ? excerpt(p.messages[p.messages.length - 1].text, 30) : ''
          };
        });
      });
    },

    // GET /api/projects/:id
    getProject: function (id) {
      return respond(function () {
        var p = findProject(id);
        if (!p) throw new Error('project not found: ' + id);
        return clone(p);
      });
    },

    // POST /api/projects/:id/messages
    // 会把用户消息入库存档，并返回 agent 的推导式回复（含产出 artifact）
    sendMessage: function (projectId, text) {
      var p = findProject(projectId);
      if (!p) return Promise.reject(new Error('project not found: ' + projectId));
      var t = nowTime();
      p.messages.push({ role: 'user', text: text, time: t });
      p.updatedAt = t;

      return respond(function () {
        var reply = generateReply(p, text);
        var msg = { role: 'agent', text: reply.text, time: nowTime(), artifact: reply.artifact };
        p.messages.push(msg);
        p.updatedAt = msg.time;
        return clone(msg);
      });
    },

    // POST /api/projects
    createProject: function (name) {
      return respond(function () {
        var t = nowTime();
        var p = {
          id: 'p-' + Math.random().toString(36).slice(2, 8),
          name: name,
          desc: '新建项目（Mock 生成），发一条消息试试',
          status: 'draft',
          updatedAt: t,
          messages: [{
            role: 'agent',
            text: '你好，我是「' + name + '」的专属 Agent。直接告诉我你的目标，我会给出回复并把产出同步到预览区。',
            time: t,
            artifact: {
              kind: 'card',
              title: '项目已就绪 · ' + name,
              desc: '这是一个全新的空白项目。发送任意消息后，我会根据关键词生成代码、数据卡片或任务清单等产出。',
              stats: [
                { num: '0', label: '历史轮次' },
                { num: '3', label: '支持的产出类型' }
              ]
            }
          }]
        };
        DB.projects.unshift(p);
        return clone(p);
      });
    }
  };

  window.__mockApi__ = MockApi;
})();
