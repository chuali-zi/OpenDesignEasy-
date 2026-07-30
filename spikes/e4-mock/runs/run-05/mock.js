/* =========================================================================
 * mock.js — 本地 Mock 层
 * 本文件是整个原型的唯一「数据源」。没有任何真实网络请求：
 *  - 所有数据都是内联在下方 db 对象里的虚构内容；
 *  - 通过 window.__mockApi__ 暴露一个返回 Promise 的假客户端；
 *  - 用 setTimeout 模拟网络延迟；
 *  - Agent 回复与预览变更由模板 + 规则在前端即时推导生成（见 craftReply）。
 * 详细声明见 MOCK.md。
 * ========================================================================= */
(function () {
  'use strict';

  /* 各接口的模拟延迟（毫秒） */
  var LATENCY = {
    projects: 160,       // 拉取项目列表
    conversation: 240,   // 拉取某个项目的会话
    preview: 140,        // 拉取某个项目的预览产物
    replyMin: 650,       // Agent 回复延迟下限
    replyMax: 1500       // Agent 回复延迟上限
  };

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var T0 = Date.now();
  function ago(minutes) { return T0 - minutes * 60000; }

  /* ------------------------- 内存数据库（纯虚构种子数据） ------------------------- */
  var db = {
    seq: 0,
    projects: [
      { id: 'p-aurora', name: '极光数据看板', desc: '实时运营指标可视化', status: '运行中', accent: '#5eead4' },
      { id: 'p-forge',  name: 'Forge 脚手架',  desc: '命令行项目初始化工具', status: '运行中', accent: '#93c5fd' },
      { id: 'p-lumen',  name: 'Lumen 文档站',  desc: '静态文档生成与托管',   status: '暂停',   accent: '#fbbf24' },
      { id: 'p-pixel',  name: 'Pixel 头像工坊', desc: 'SVG 头像批量生成',     status: '运行中', accent: '#f0abfc' }
    ],

    conversations: {
      'p-aurora': [
        { id: 'm-a1', role: 'user',  ts: ago(52), text: '帮我把看板首屏的指标卡片搭出来，先放活跃会话、平均延迟和任务成功率三个。' },
        { id: 'm-a2', role: 'agent', ts: ago(51), text: '已完成第一版：三张指标卡片横向排布，数值带了趋势徽标（上升/下降）。产物已写入预览区的 dashboard.html，版本 v0.1。' },
        { id: 'm-a3', role: 'user',  ts: ago(30), text: '成功率那张卡片的趋势方向标反了，顺便把栅格固定成三列。' },
        { id: 'm-a4', role: 'agent', ts: ago(29), text: '已修正成功率卡片的 trend 标记，并把栅格改为固定 3 列。预览已更新到 v0.2，改动记录在修订 #2。' }
      ],
      'p-forge': [
        { id: 'm-f1', role: 'user',  ts: ago(90), text: '给我写一个 CLI 入口，支持 forge create <template>，默认模板叫 starter。' },
        { id: 'm-f2', role: 'agent', ts: ago(88), text: '已生成 cli.js 初版：解析 process.argv，缺省模板为 starter，成功/失败都有退出码处理。预览区可看，当前 v0.1。' }
      ],
      'p-lumen': [
        { id: 'm-l1', role: 'user',  ts: ago(200), text: '起草一份「快速开始」文档，包含安装、目录约定和构建命令三节。' },
        { id: 'm-l2', role: 'agent', ts: ago(198), text: '草稿已写入 quickstart.md（v0.1），三节结构都齐了，目录约定用列表呈现，方便后续同步到导航。' }
      ],
      'p-pixel': [
        { id: 'm-p1', role: 'user',  ts: ago(140), text: '先做一个默认头像：圆角深色底、琥珀色圆形脑袋、底部一条蓝色横条。' },
        { id: 'm-p2', role: 'agent', ts: ago(138), text: '已生成 default-avatar.svg（v0.1）：64×64 视口、14px 圆角深色底、琥珀色头部与蓝色横条，另加了两点眼睛。' }
      ]
    },

    previews: {
      'p-aurora': {
        title: '实时指标卡片',
        fileName: 'dashboard.html',
        language: 'html',
        version: 2,
        code: [
          '<section class="metric-grid">',
          '  <article class="metric" data-trend="up">',
          '    <h3>活跃会话</h3>',
          '    <strong>1,284</strong>',
          '    <span class="delta">+12.4%</span>',
          '  </article>',
          '  <article class="metric" data-trend="down">',
          '    <h3>平均延迟</h3>',
          '    <strong>212ms</strong>',
          '    <span class="delta">-8.1%</span>',
          '  </article>',
          '  <article class="metric" data-trend="up">',
          '    <h3>任务成功率</h3>',
          '    <strong>98.2%</strong>',
          '    <span class="delta">+0.6%</span>',
          '  </article>',
          '</section>'
        ].join('\n'),
        revisions: [
          { n: 1, summary: '初版三卡片栅格与趋势徽标', ts: ago(51) },
          { n: 2, summary: '修正成功率趋势方向并固定 3 列', ts: ago(29) }
        ]
      },
      'p-forge': {
        title: 'CLI 入口脚本',
        fileName: 'cli.js',
        language: 'javascript',
        version: 1,
        code: [
          '#!/usr/bin/env node',
          "const { scaffold } = require('./scaffold');",
          '',
          'const args = process.argv.slice(2);',
          "const template = args[0] || 'starter';",
          '',
          'scaffold({ template, cwd: process.cwd() })',
          '  .then(report => {',
          '    console.log(`created ${report.files} files from "${template}"`);',
          '  })',
          '  .catch(err => {',
          "    console.error('scaffold failed:', err.message);",
          '    process.exit(1);',
          '  });'
        ].join('\n'),
        revisions: [
          { n: 1, summary: '生成 CLI 入口初版（默认 starter 模板）', ts: ago(88) }
        ]
      },
      'p-lumen': {
        title: '快速开始文档草稿',
        fileName: 'quickstart.md',
        language: 'markdown',
        version: 1,
        code: [
          '# Lumen 文档站 · 快速开始',
          '',
          '## 安装',
          '在任意静态服务器上托管 `dist/` 目录即可。',
          '',
          '## 目录约定',
          '- `docs/` 存放 Markdown 源文件',
          '- `docs/nav.yml` 控制左侧导航顺序',
          '- `assets/` 存放本地图片与附件',
          '',
          '## 构建',
          '执行 `lumen build`，输出到 `dist/`。'
        ].join('\n'),
        revisions: [
          { n: 1, summary: '起草快速开始三节结构', ts: ago(198) }
        ]
      },
      'p-pixel': {
        title: '默认头像 SVG',
        fileName: 'default-avatar.svg',
        language: 'svg',
        version: 1,
        code: [
          '<svg viewBox="0 0 64 64" width="128" height="128">',
          '  <rect width="64" height="64" rx="14" fill="#1e293b"/>',
          '  <circle cx="32" cy="26" r="10" fill="#f59e0b"/>',
          '  <rect x="14" y="42" width="36" height="8" rx="4" fill="#38bdf8"/>',
          '  <circle cx="28" cy="24" r="2" fill="#0f172a"/>',
          '  <circle cx="36" cy="24" r="2" fill="#0f172a"/>',
          '</svg>'
        ].join('\n'),
        revisions: [
          { n: 1, summary: '生成默认头像初版', ts: ago(138) }
        ]
      }
    }
  };

  function uid(prefix) { return prefix + '-' + (++db.seq) + '-' + Date.now(); }

  function findProject(id) {
    for (var i = 0; i < db.projects.length; i++) {
      if (db.projects[i].id === id) return db.projects[i];
    }
    return null;
  }

  /* ------------------------- Agent 回复生成（规则推导） -------------------------
   * 推导规则：
   * 1. 用一组正则对用户输入做「意图分类」，命中第一个匹配项；都不命中走兜底。
   * 2. 回复正文由固定模板拼接：引用用户输入（截断）+ 意图标签 + 项目名
   *    + 该意图预置的执行步骤编号列表 + 本次修订号与版本号。
   * 3. 副作用：预览产物 version +1、revisions 追加一条（摘要=用户输入截断）、
   *    代码尾部追加一行注释（注释风格由 language 推导）。
   * --------------------------------------------------------------------------- */
  var REPLY_RULES = [
    {
      match: /(颜色|配色|主题|深色|浅色|样式|字体|圆角)/,
      tag: '视觉样式调整',
      steps: [
        '定位产物中的样式相关片段，抽出需要调整的取值',
        '按你的方向生成候选方案，取对比度与一致性更好的一版',
        '写回产物并把改动登记到修订记录'
      ]
    },
    {
      match: /(性能|很慢|卡顿|优化|速度|加载)/,
      tag: '性能优化',
      steps: [
        '梳理产物中可能造成开销的结构',
        '给出改动前后的取舍说明，优先低风险项',
        '应用优化并更新预览版本'
      ]
    },
    {
      match: /(报错|bug|错误|失败|异常|不生效|不对)/i,
      tag: '缺陷排查',
      steps: [
        '对照你描述的现象定位可疑片段',
        '给出最小修复并说明根因',
        '回归检查相邻结构，确认没有引入新问题'
      ]
    },
    {
      match: /(新增|增加|添加|加一个|加个|做个|做一个|再来)/,
      tag: '功能新增',
      steps: [
        '在现有产物结构上找到最合适的挂载点',
        '按既有风格补齐新增部分，保持视觉/结构一致',
        '更新预览并记录本次修订'
      ]
    },
    {
      match: null, /* 兜底规则 */
      tag: '常规迭代',
      steps: [
        '通读当前产物最新版本，确认可复用的结构',
        '在最小改动范围内实现你描述的调整',
        '更新预览并把改动写入修订记录'
      ]
    }
  ];

  function pickRule(text) {
    for (var i = 0; i < REPLY_RULES.length; i++) {
      var r = REPLY_RULES[i];
      if (r.match && r.match.test(text)) return r;
    }
    return REPLY_RULES[REPLY_RULES.length - 1];
  }

  function truncate(s, max) {
    var t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  function commentFor(language, content) {
    if (language === 'javascript') return '// ' + content;
    return '<!-- ' + content + ' -->'; /* html / markdown / svg 均可承载 HTML 注释 */
  }

  function craftReply(project, userText) {
    var rule = pickRule(userText);
    var pv = db.previews[project.id];

    /* —— 副作用：推进预览产物 —— */
    var n = pv.revisions.length + 1;
    var summary = truncate(userText, 20);
    pv.version += 1;
    pv.revisions.push({ n: n, summary: summary, ts: Date.now() });
    pv.code = pv.code + '\n' + commentFor(pv.language, 'rev ' + n + ': ' + summary);

    /* —— 组装回复正文 —— */
    var body =
      '收到。我把「' + truncate(userText, 16) + '」归类为「' + rule.tag + '」，将在「' + project.name + '」上按以下顺序执行：\n\n' +
      rule.steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n') +
      '\n\n改动已落到预览产物：修订 #' + n + '，版本升至 v0.' + pv.version +
      '。你可以继续补充约束，我会在现有结果上增量调整。';

    return { id: uid('m'), role: 'agent', text: body, ts: Date.now() };
  }

  /* ------------------------- 假客户端 ------------------------- */
  window.__mockApi__ = {

    /* 项目列表：返回项目 + 会话消息数（由会话数组长度推导） */
    listProjects: function () {
      return wait(LATENCY.projects).then(function () {
        return clone(db.projects.map(function (p) {
          return {
            id: p.id,
            name: p.name,
            desc: p.desc,
            status: p.status,
            accent: p.accent,
            msgCount: db.conversations[p.id].length
          };
        }));
      });
    },

    /* 会话历史 */
    getConversation: function (projectId) {
      return wait(LATENCY.conversation).then(function () {
        var project = findProject(projectId);
        if (!project) throw new Error('mock: project not found: ' + projectId);
        return { project: clone(project), messages: clone(db.conversations[projectId]) };
      });
    },

    /* 预览产物 */
    getPreview: function (projectId) {
      return wait(LATENCY.preview).then(function () {
        var pv = db.previews[projectId];
        if (!pv) throw new Error('mock: preview not found: ' + projectId);
        return clone(pv);
      });
    },

    /* 发送消息：先落库用户消息，延迟后生成并存入 Agent 回复，返回该回复 */
    sendMessage: function (projectId, text) {
      var project = findProject(projectId);
      var conv = db.conversations[projectId];
      if (!project || !conv) {
        return wait(120).then(function () { throw new Error('mock: project not found: ' + projectId); });
      }
      conv.push({ id: uid('m'), role: 'user', text: String(text), ts: Date.now() });
      return wait(randInt(LATENCY.replyMin, LATENCY.replyMax)).then(function () {
        var reply = craftReply(project, text);
        conv.push(reply);
        return clone(reply);
      });
    }
  };
})();
