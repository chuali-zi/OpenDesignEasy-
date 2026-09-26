# OEYdesign 文档与实施状态

> 当前有效路线：**D / 全 TypeScript / Pi SDK / 直接编辑 / 多客户端**。用户于 2026-09-12 明确采用。
> 状态截至 2026-09-20：R1 已完成 Windows 开发基线验证；R2 Deck 编辑与原生导出已完成本轮验收；R3 产品 Pi 会话已接入，现有兼容服务的共同创作、恢复与图片链路已实测通过，原生 K3 的文本、工具及截图识别也已实测通过。见[本轮验收](spec/r2-r3-validation.md)与[实施计划](spec/implementation-plan.md)。跨平台干净安装留在 R7。
> 2026-09-26：R4 Web 文档、无头生产与 DOM 编辑基础已实现，阶段检查见 [R4 记录](spec/r4-web-validation.md)。R4 完整验收与 R5–R7 尚未完成。

## 阅读顺序与效力

用户当前指令优先；产品范围由 [PRD](prd.md)规定，技术决策见 [ADR-0006](adr/0006-full-typescript-design-platform.md)，职责与依赖见 [架构](architecture.md)，详细行为由本页列出的当前 Spec 承接。实施状态只以 [实施计划](spec/implementation-plan.md)中的状态表为准。

旧文档中的冻结条款、Python 端口、Phase 6 退出条件不约束新实现。原文快照见 [重构前归档](archive/2026-09-12-before-ts/INDEX.md)。

## 当前有效规范

| 文档 | 负责回答 |
|---|---|
| [PRD](prd.md) | 产品目标、直接编辑与四端必做范围 |
| [架构](architecture.md) | 全 TS 核心、依赖方向、技术栈、设计真源 |
| [系统规范](spec/system-spec.md) | 概念、命令/事件、运行入口、项目状态 |
| [编辑文档规范](spec/editor-document-spec.md) | 三媒介模型、拖拽/缩放/图层、人机同步、冲突和撤销 |
| [Agent 引擎](spec/agent-engine-spec.md) | Pi 公共 SDK、工具、消息、取消、上下文 |
| [设计智能](spec/design-intelligence-spec.md) | 自主创作、视觉方向、确认、参考使用与连续修改 |
| [资料与上下文](spec/context-evidence-baseline.md) | TS 解析、原件、风格、事实、模板及模型上下文 |
| [产物生产](spec/artifact-production-spec.md) | Web/PPTX/DOCX/PDF 生产、导入、可编辑性和格式边界 |
| [运行与恢复](spec/runtime-recovery.md) | SQLite、会话、输入、版本、重启、数据导入 |
| [质量规范](spec/quality-governance-spec.md) | 编辑正确性、设计质量、实际导出与必要验证 |
| [客户端规范](spec/clients-spec.md) | Web、CLI、TUI、Desktop、进程与分发 |
| [实施计划](spec/implementation-plan.md) | 全量替换阶段、依赖、完成标准、风险与退役 |
| [R1 兼容性与状态](spec/r1-compatibility.md) | Node/SQLite、Pi faux、Konva/ProseMirror 验证与当前未完成项 |
| [R2/R3 实现与验收](spec/r2-r3-validation.md) | Deck 编辑、实际 Office、产品 agent、真实兼容服务与使用入口 |
| [R4 Web 实现与验证](spec/r4-web-validation.md) | Web 文档、无头生产、源码和 DOM 编辑的阶段进度与边界 |

## 实施状态

| 项目 | 状态 |
|---|---|
| D 路线、直接编辑、多客户端 | 已采用 |
| 当前规范与历史失效标记 | 已更新 |
| TS document/runtime/media、SQLite、命令/历史/事件与 owner 锁 | R1 已完成 Windows 开发基线验证 |
| CLI 无头项目/文档/节点/历史/事件/SVG 路径 | R1 已完成；更广媒介能力继续按阶段实现 |
| Pi 0.85.1 产品 AgentSession | 已接入 runtime；真实兼容服务文本、工具、图片、问答恢复通过；原生 K3 文本、工具、截图识别实测通过 |
| Node 24.21.0 与 Electron 44.3.0 utilityProcess/SQLite | R1 Windows x64 实际宿主验证通过；跨平台干净安装留到 R7 |
| Web host、React/Vite、Konva/ProseMirror Deck 编辑与原生导出 | 完整编辑与图片/表格/图表路径通过 Chrome 4/4；实际 Office 打开及视觉复验通过 |
| TUI、Desktop 完整产品及 Web/Deck/Doc 全部生产能力 | 后续阶段未完成 |
| Web 文档、统一历史、CLI/host/agent、静态与 React 源码生产 | R4 进行中；DOM 选择/拖动/缩放/旋转、图层/图片/源码与冲突恢复已实现；Chrome 编辑回归 9/9，完整编辑和产品构建/导入继续推进 |
| 旧数据导入与 Python 退役 | 尚未实施 |

2026-09-20 已补齐图片裁切与原件、富文本、吸附/对齐、表格图表、PDF/PNG 和实际 PowerPoint 打开路径。真实兼容服务完成了讨论、生成三页、保留人工标题改动并扩展第四页、提问重启回答，以及一次实际图片生成/识图/插入/截图检查。开发检查还覆盖共享历史、输入幂等、取消、Pi 压缩、恢复和 CLI 连接 Web owner。最终完成条件与待验项见本轮验收及实施计划。

R2/R3 的交付面向交互式 Deck。Web 文档生产、Doc、TUI、Desktop、旧数据迁移和跨平台发行继续在 R4–R7 实施；当前代码不通过旧 Python 补齐这些能力。R1 隔离 faux 检查是历史基线，R3 产品接入有独立的实际验证记录。

## 旧实现与研究

- [旧 Studio 使用说明](studio/README.md)、[旧 Studio v1 契约](studio/contract.md)：仅用于运行、理解和导入旧产品。
- [旧 Phase 6](phase6/README.md)、[Phase 1 契约](spec/contract-skeleton.md)、[Phase 4 stub](spec/product-shell-stub-flow.md)：历史方案。
- [ADR 索引](adr/README.md)：ADR-0001～0005 是旧架构记录，ADR-0006 为当前采用决策。
- [历史归档](archive/README.md)：原始产品愿景、旧规范与调查。
- [旧竞品分析](competitive-analysis/opendesign-vs-oeydesign-2026-08-06.md)：日期受限的研究，不决定当前技术路线。
- 仓库中的 deepseek-harness-adapter 和 spikes 仅作历史研究；其中的 Python sidecar 推荐与冻结口径已被 D 路线替代。
