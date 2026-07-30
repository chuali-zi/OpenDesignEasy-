/* OEYdesign · 环线 THE LOOP — 内联 mock 数据层
 * 所有数据均为虚构的 demo 内容，字段结构参照 docs/prd.md 与 product-client/ 的信息架构：
 * 候选方向 → 反馈/批准 → 正式 Artifact → 质量双轨复核 → 导出交付。
 */
window.__OEP_DATA__ = {
  projects: [
    {
      id: "p-dawnbrew",
      name: "黎明咖啡 · 品牌落地页",
      kind: "网页",
      status: "等待方向反馈",
      statusTone: "busy",
      brief: "一家只做早晨六点到十点营业的社区咖啡店，想要一个「让人想早起」的单页网站。",
      preset: "设计引导",
      templateRole: "起始脚手架",
      revision: { no: 3, note: "第 3 轮候选 · 根据上一轮「太冷」的反馈调暖了色板", updatedAt: "2025-06-18 09:42" },
      regions: ["首屏主视觉", "标题文案", "产品列表", "品牌故事", "配色"],
      preview: {
        type: "web",
        kicker: "DAWN BREW · 城市晨光",
        headline: "把清晨的第一杯，做成一天的开场白。",
        cta: "探索今日菜单",
        colA: { title: "今日菜单", text: "晨雾拿铁 / 烤橙美式 / 六点限定的海盐可颂，卖到十点就收摊。" },
        colB: { title: "品牌故事", text: "店主相信一天的好坏在早上就定了调，所以这家店只陪你看日出。" },
        palette: ["#ff5c33", "#e8b44a", "#2b1c14"]
      },
      events: [
        { t: "06-14 10:02", actor: "user", text: "提出需求：「一家只开早上的咖啡店，想要个让人想早起的网站」。" },
        { t: "06-14 10:03", actor: "agent", text: "需求有模糊处，主动追问：目标来客是谁？「想早起」是温暖感还是效率感？" },
        { t: "06-14 11:20", actor: "user", text: "回复澄清：客群是附近上班族，要温暖、慢一点的感觉。" },
        { t: "06-15 09:10", actor: "agent", text: "生成 2 个候选方向：A「报纸晨刊风」/ B「日出渐变色卡片」，等待选择。" },
        { t: "06-15 15:44", actor: "user", text: "选择方向 B，但批注：整体偏冷，不像早晨。" },
        { t: "06-17 08:31", actor: "agent", text: "产出 Revision 2 正式 Artifact，进入质量复核。" },
        { t: "06-17 08:33", actor: "quality", text: "复核完成：0 个硬错误，2 条审美发现（不挡交付）。" },
        { t: "06-18 09:42", actor: "agent", text: "按「偏冷」批注重出 Revision 3，色板整体调暖，等待方向反馈。" }
      ],
      constraints: {
        tone: "温暖、慢节奏、口语化",
        palette: "暖橙 + 麦金 + 深烘棕",
        rules: [
          "不使用冷蓝/科技灰作为主色",
          "首屏必须出现营业时间（06:00–10:00）",
          "文案不出现「精品」「匠心」等滥用词"
        ]
      },
      quality: {
        hard: [],
        aesthetic: [
          "「品牌故事」段落行长偏长，建议收窄到 52 字符以内",
          "主按钮与背景对比度虽达标，但 hover 态反馈偏弱，可增强"
        ]
      },
      feedbackLog: [
        { t: "06-15 15:44", type: "整体方向", text: "方向 B 保留，但整体偏冷，不像早晨。" }
      ],
      delivery: {
        state: "wait",
        note: "Revision 3 尚未获批，暂无待交付的正式 Artifact。",
        records: []
      }
    },
    {
      id: "p-q3deck",
      name: "Q3 产品发布会 PPT",
      kind: "PPT",
      status: "交付被硬错误拦截",
      statusTone: "blocked",
      brief: "为 Q3 发布会准备一份 12 页演讲 PPT，面向渠道伙伴，重点是新品的三个核心数据。",
      preset: "规范生产",
      templateRole: "交付合同",
      revision: { no: 1, note: "第 1 轮候选 · 首次出稿", updatedAt: "2025-06-19 14:05" },
      regions: ["封面页", "数据页", "结尾页"],
      preview: {
        type: "deck",
        slides: [
          { n: "01 / 12", t: "把「快」做成一种习惯", bar: "fill-a" },
          { n: "07 / 12", t: "三个数字看懂 Q3 新品", bar: "fill-b" },
          { n: "12 / 12", t: "下一季度，一起提速", bar: "fill-a" }
        ]
      },
      events: [
        { t: "06-18 16:20", actor: "user", text: "提出需求：Q3 发布会 PPT，12 页，面向渠道伙伴。" },
        { t: "06-18 16:21", actor: "agent", text: "追问：三个核心数据的口径与可公开范围？演讲人时长？" },
        { t: "06-18 17:02", actor: "user", text: "回复数据口径，授权全部公开，演讲 20 分钟。" },
        { t: "06-19 11:15", actor: "agent", text: "生成 1 个候选方向（规范生产 preset 下只出单稿），进入内部整理。" },
        { t: "06-19 14:05", actor: "agent", text: "产出 Revision 1 正式 Artifact，自动进入质量复核。" },
        { t: "06-19 14:07", actor: "quality", text: "复核完成：1 个硬错误（第 7 页引用数据缺少来源标注），交付闸门关闭。" }
      ],
      constraints: {
        tone: "克制、可信、数据优先",
        palette: "墨黑 + 信号橙单点强调",
        rules: [
          "每页只讲一件事",
          "所有引用数据必须标注来源",
          "禁止使用 3D 图表与阴影效果"
        ]
      },
      quality: {
        hard: [
          { code: "HARD-SRC-001", text: "第 7 页「三个数字」引用数据缺少来源标注，违反约束「所有引用数据必须标注来源」。" }
        ],
        aesthetic: [
          "封面页标题字重与副标题拉不开层级，建议加大对比",
          "结尾页留白偏少，演讲收尾节奏会显得赶"
        ]
      },
      feedbackLog: [],
      delivery: {
        state: "blocked",
        note: "交付闸门关闭：1 个硬错误待处理。补齐来源标注后可重新复核。",
        records: []
      }
    },
    {
      id: "p-inkds",
      name: "INK 设计系统规范文档",
      kind: "文档",
      status: "已交付",
      statusTone: "ok",
      brief: "把团队口头约定的排版与组件规则，沉淀成一份可对外交付的设计系统规范文档。",
      preset: "规范生产",
      templateRole: "设计系统",
      revision: { no: 5, note: "第 5 轮 · 已定稿并导出", updatedAt: "2025-06-12 18:30" },
      regions: ["文档封面", "排版规则", "组件清单"],
      preview: {
        type: "doc",
        title: "INK Design System · 规范 v1.0",
        edition: "EDITION 05 · FINAL",
        paras: [
          "INK 约定：一切排版从基线网格出发，一切组件从字号阶梯出发。",
          "本规范覆盖：字体阶梯、间距刻度、组件状态、禁用清单四个部分。"
        ],
        ruleLine: "规则示例 — 正文行高恒为字号的 1.65 倍，任何页面不得例外。"
      },
      events: [
        { t: "06-05 09:00", actor: "user", text: "提出需求：把口头约定沉淀成规范文档，要能对外交付。" },
        { t: "06-05 09:01", actor: "agent", text: "追问：读者是内部设计师还是外部合作方？决定措辞的严格程度。" },
        { t: "06-06 10:40", actor: "agent", text: "生成 2 个候选方向：A「手册体」/ B「条款体」。" },
        { t: "06-06 15:12", actor: "user", text: "批准方向 B「条款体」，要求逐条编号、可引用。" },
        { t: "06-08 17:55", actor: "agent", text: "产出 Revision 4 Artifact，质量复核发现 1 个硬错误（条款编号断档）。" },
        { t: "06-09 10:22", actor: "user", text: "局部批注：「组件清单」的状态命名与正文不一致，只改这一处。" },
        { t: "06-12 18:24", actor: "agent", text: "产出 Revision 5，复核通过：0 硬错误，1 条审美发现（不影响交付）。" },
        { t: "06-12 18:30", actor: "system", text: "导出 ink-design-system-v1.0.pdf，交付完成。" }
      ],
      constraints: {
        tone: "条款化、可引用、零歧义",
        palette: "黑白灰 + 单一校样蓝",
        rules: [
          "每条规则必须可编号引用",
          "禁止出现「尽量」「大约」等模糊词",
          "所有组件必须给出禁用示例"
        ]
      },
      quality: {
        hard: [],
        aesthetic: [
          "「组件清单」表格密度偏高，打印版可考虑拆页"
        ]
      },
      feedbackLog: [
        { t: "06-06 15:12", type: "整体方向", text: "批准方向 B「条款体」。" },
        { t: "06-09 10:22", type: "局部微调", text: "「组件清单」的状态命名与正文不一致，只改这一处。" }
      ],
      delivery: {
        state: "ok",
        note: "交付闸门开放，Revision 5 已导出。",
        records: [
          { t: "06-12 18:30", text: "ink-design-system-v1.0.pdf · 42 页 · 随交付合同归档" }
        ]
      }
    }
  ]
};
