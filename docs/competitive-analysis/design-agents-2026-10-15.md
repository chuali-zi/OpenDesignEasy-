# OEYdesign 与设计/办公智能体：差距、证据与本轮选择

研究日期：2026-10-15。OEY 起点为已 fetch 核实的 `5dc969a1f1d7433cc711c0dd9ff28494493ce451`，不是旧 main。本轮在 Windows 独立分支 `codex/r6-evidence-handoff` 接续，原 `feat/studio` 的暂存、未暂存和未跟踪内容均保留。

## 结论先行

OEY 应继续把“三种可编辑原生文档、人工与 Agent 的共同历史、无头核心”做扎实。仅增加提示词、模板或把网页截图放进 Office，无法解决持续修改与可靠交付的问题。竞品已经在品牌系统、局部反馈、视觉检查和执行恢复上投入，不能把这些概念称作 OEY 首创。

本轮选择一个可验证的小闭环：**同一修订的交付检查 → 明确未验事项 → 重检并冻结素材 → 原生产物与摘要报告一起交付**。同时利用真实 Windows/Office 验证修复了原生另存文件读取与 PDF 中文字序的问题。没有重写 Pi 循环，没有增加用户逐步审批流程，也没有把 R6 的 TUI/Desktop 改成可选。

## 身份与证据等级

以下“官方说明”只证明公开描述；“源码核查”只证明所读快照有实现；“本机实测”限本轮实际执行的对象。没有登录竞品、购买订阅、上传项目材料或调用竞品 API，因此不排名真实模型生成质量。

| 名称 | 本次采用的身份 | 证据与限制 |
|---|---|---|
| Open Design | 用户本机 `D:\projects2\opendesign`；origin 是 `chuali-zi/OpenDesgin_Lite`，team 是 `Bistu-OSSDT-2026/OpenDesignLite` | 只读核验 HEAD `7eed2f8a1e25f7372cdc73d8eddb4ca64738603c`、README、beauty-pipeline/validation-observation 及对应 Rust 源码。当前本机方向已是桌面 BYOK Design Agent；公开 team README 仍有更早的 Lite/MCP 口径，不能混用。未运行此产品。参见 [fork](https://github.com/chuali-zi/OpenDesgin_Lite) 与 [team 仓库](https://github.com/Bistu-OSSDT-2026/OpenDesignLite)。 |
| Codex | OpenAI Codex，区分 CLI、IDE、桌面应用与 ChatGPT Work 的文件界面 | 官方说明明确 CLI 可写文件但没有图形预览/批注；其他界面的文件预览能力不同。不能把某篇“用 Codex 做设计工具”的实验当作 Codex 自带完整编辑器。依据 [Work with files](https://learn.chatgpt.com/docs/artifacts-viewer?surface=app)、[长任务实验](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)、[远程工作说明](https://developers.openai.com/blog/mastering-codex-remote-for-engineering)。 |
| Claude Design | 已确认是 Anthropic 的官方产品/Artifact 模板，不再作为未证实名称推断 | 2026-04-17 [公告](https://www.anthropic.com/news/claude-design-anthropic-labs)与[当前使用指南](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)均可核验；独立版本与当前集成入口有迁移差异，不能把旧公告套餐当现状。Docs/Slides 是相关但不同的模板，见 [Artifacts 指南](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)。未实测账号能力。 |
| ZCode | 本报告对标 `zcode.z.ai` 的智谱产品 | [用户协议](https://zcode.z.ai/cn/terms)确认运营主体；[官方首页](https://zcode.z.ai/cn)定位编程 Harness、Goal 与多智能体执行。若用户实际指另一个同名项目，本行需重新确认，不能泛化为所有 ZCode。 |
| WorkBuddy | 腾讯 WorkBuddy，全场景办公桌面工作台 | 官方[快速开始](https://www.codebuddy.ai/docs/zh/workbuddy/Quickstart)、[结果查看](https://www.codebuddy.ai/docs/zh/workbuddy/Results)、[权限模式](https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes)及[计费说明](https://www.codebuddy.ai/docs/workbuddy/pricing)。结果区有产物、文件、变更、网页预览，不等同于已证明对象级直接编辑。页面抓取偶有超时；可检索官方正文已读取的部分与未建立的能力分开。 |

## 从意图到交付的差别

“未建立”表示公开资料/本次源码不足以证明，**不表示竞品一定没有**。以下是链路取舍分析，不是性能榜。

| 环节 | Open Design 本机快照 | Codex | Claude Design / 相关 Docs、Slides | ZCode | WorkBuddy | OEY 当前代码与缺口 |
|---|---|---|---|---|---|---|
| 用户意图 | 内置设计 brief/direction 流水线 | 通用目标、仓库、技能与工具 | 对话加画布、设计上下文 | 编程 Goal/工作区 | 自然语言办公任务 | Pi 对话与媒介 schema 已有；用户目标尚未成为结构化验收依据 |
| 素材进入 | 本地文件、design context/asset plan | 工作区、附件与插件，取决于入口权限 | 品牌系统、代码/设计文件与上传 | 工作区、技能；资料能力未建立 | 本地授权目录与产物 | TS Office/PDF/CSV/OCR/缓存已实现；事实/许可来源锚点不足 |
| 内容结构 | HTML、Markdown、HTML slides | 由具体任务代码/工具生成 | 可生成设计、文档、幻灯片 | 由代码任务组织 | 可产出文档/PPT等 | Doc section/PM、Deck page/node、Web DOM 是不同原生模型，不强塞为同一种画布 |
| 视觉版式 | 明确方向、观察、critique/repair 代码 | 可写 UI、运行验证；质量依赖任务闭环 | 品牌组件、画布细调和设计检查 | 首页演示不足以证明专业排版质量 | 结果预览不等于专业版式引擎 | 能编辑和渲染；尚无完整任务化设计批评/修正闭环 |
| 可编辑性 | 文件与预览为核心；非完整对象画布 | 文件/代码编辑，预览随入口变化 | 官方提供直接文字/布局编辑 | 代码变更与撤销 | 文件变更视图；对象编辑未建立 | 三媒介支持范围内直接编辑、缩放/旋转、历史；复杂外部工程/Office仍有限 |
| 局部修改 | stable ref、source locator 与 revision 约束 | 差异、批注或定位到代码，依入口 | 内联评论、画布精调 | 仓库/文件级任务 | 文件差异与对话 | 稳定 ID + 前置条件 + 共同撤销是基础；尚缺用户可读的修改影响预览 |
| 跨格式复用 | 多种 artifact，当前主要静态文件 | 可跨文件执行，语义同步由任务实现 | 文件导入、应用连接与交接 | 通用执行可扩展；媒介语义未建立 | 跨文件办公处理 | 共用核心不等于事实自动同步；尚无“一处事实更新，三媒介受控更新” |
| 证据引用 | revision/evidence/gate 已有源码 | 来源、检查和持久笔记由工作流承载 | 公开设计能力不能证明逐对象事实溯源 | 未建立 | 本地资料处理不能证明逐对象引用 | 本轮增加交付版本/文件/素材摘要；事实、引用和许可证仍明确未核实 |
| 预览/导出一致 | rendered observation 与 export 证据 | 可运行实际检查；不能只信生成成功 | 公告支持 PDF/PPTX/HTML，真实一致性未实测 | 未建立 | 预览产物；真实 Office 一致性未实测 | 本轮绑定产物版本，并补实际 Word/PPT 合成往返；字体替代仍有差异 |
| 自动反馈/恢复 | 有限修正周期、fresh evidence/gate | 长程执行、工具反馈、steer/恢复 | 对话迭代与直接编辑 | Goal/长任务/协作 | 任务、文件差异、权限/备份 | 冲突、owner、取消、重开已有；新检查不自动改设计或伪造视觉完成 |
| 成本 | BYOK，不能从本地优先推出模型离线 | 订阅/API/执行环境依入口 | 受计划额度约束 | 官方模型计划/额度 | 计划与积分，区域和促销可能变化 | 本轮模型费用为 0；没有同题同预算实测，不推断性价比 |
| 隐私 | 本地存储与受控外发边界 | 取决于工作区/云任务/插件 | 云产品及授权连接 | 具体数据政策需单独核查 | 授权工作区与权限模式 | 核心可离线；新交付只打包所选产物，不归档项目目录/资料库/聊天；产物本身不脱敏 |

## 与 OEY 模块对应的优先缺口

1. `runtime/agent-service.ts` 已有媒介提示、读/写/预览/导出工具，但没有统一的、可供用户查看的“检查了什么/尚未检查什么”。本轮用共享 delivery 服务补齐最小入口，不建第二个 agent loop。
2. `media/artifact.ts` 能导出多个格式，原来产物、静态问题与原生应用验收没有同一份收据。本轮将导出字节、修订、文档摘要和素材摘要绑定；不把 hash 当事实真实性或审美质量证明。
3. `runtime/assets.ts` 与 `media/references.ts` 已有资料内容和缓存。本机原生验证发现普通 Office 另存被误拒绝、PPT 格式 run 被拆成多行、中文 PDF 回退字体字序错误，已做有界修复。事实到具体段落/对象的引用关系仍是后续工作。
4. `editor` 已有直接编辑，不应改成聊天生成整页图片。下一条高价值路径是“用户指出一处问题 → 展示受影响对象/格式 → 保留其他人工内容”，但本轮不扩进跨文档事务或通用工作流。
5. 字体与目标渲染器仍是交付风险。相同字号、纸张和同题正文，只能证明本夹具的测量，不足以承诺任意 Word/PPT 文件无损往返。

## 创新假设与本轮取舍

| 候选组合 | 用户价值与假设 | 新颖性与本轮决定 |
|---|---|---|
| 版本绑定的原生交付收据 | 改后旧报告不能继续使用；接收者能核对实际产物摘要并看到未验事项 | 版本证据已见于 Open Design 等产品；不宣称首创。本轮选择它，因为三媒介可共用、离线可测、能直接减少错版交付 |
| 带来源的事实/术语跨媒介更新 | 同一事实被 Web、Deck、Doc 复用，资料更新后提出局部修改并保护人工改写 | 新颖性未证明；需先定义最小来源锚点、失效/人工解除关联规则。本轮不将聊天历史变为第二份事实真源 |
| 按修改影响复查的目标渲染证据 | 仅重看受影响页面/断点，分别保留浏览器、Word、PowerPoint 的当前版本结果 | 竞品已有局部反馈与观察；可能的价值在统一模型和多客户端组合。本轮只把未验项说清，不自动运行 Office 或宣称审美完成 |

## 这次能证明什么

实施与 Windows 结果见 [交付检查规范与验收](../spec/checked-delivery.md)。所有文档、PPT、Web 演示均为通过 OEY 命令/API 写入的**固定合成夹具**；浏览器下载由真实产品 UI 完成，Agent 工具编排用 Pi 离线 faux provider。它们不能证明 K2.8 从自然语言完成创作的端到端质量，也不是 Codex 代制作品冒充 OEY 模型生成。

真实模型闭环建议下一次明确授权后，以 `K2.8 / kimi-for-coding` 从 OEY Web 对话或 CLI `agent run` 开始，限定合成资料、三格式任务、人工局部修改、取消/撤销、保存重开和产品导出；保存 run/tool/命令/产物版本的对应关系。建议费用上限 **US$1 总额**、最多 6 次模型请求、总输入 60,000 / 总输出 4,000 tokens、12 次工具调用、3 分钟；须先核对该路由单价能覆盖此上限。现有预算器限制请求/tokens/工具/超时，尚无金额硬封顶，故本轮没有擅自执行或扩大真实调用。不得读取/显示/迁移 key，不修改网络权限，不订阅竞品。
