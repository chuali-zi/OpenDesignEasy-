# OEYdesign 文档与实施状态

> 当前有效路线：**D / 全 TypeScript / Pi SDK / 直接编辑 / 多客户端**。用户于 2026-09-12 明确采用。
> 状态截至 2026-09-20：R1 已完成 Windows 开发基线验证；R2 基础 Web 路径通过 Chrome 3/3 实测，Node 24 全 workspace TypeScript 检查、Web production build 与 29/29 单元/集成检查通过；R2 整体仍未完成。下表和[实施计划](spec/implementation-plan.md)记录当前证据与剩余范围；跨平台干净安装留在 R7。

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

## 实施状态

| 项目 | 状态 |
|---|---|
| D 路线、直接编辑、多客户端 | 已采用 |
| 当前规范与历史失效标记 | 已更新 |
| TS document/runtime/media、SQLite、命令/历史/事件与 owner 锁 | R1 已完成 Windows 开发基线验证 |
| CLI 无头项目/文档/节点/历史/事件/SVG 路径 | R1 已完成；更广媒介能力继续按阶段实现 |
| Pi 0.85.1 faux AgentSession 与公共控制点 | R1 隔离检查通过；产品 agent 集成属于尚未开始的 R3 |
| Node 24.21.0 与 Electron 44.3.0 utilityProcess/SQLite | R1 Windows x64 实际宿主验证通过；跨平台干净安装留到 R7 |
| Web host、React/Vite 壳、Konva 编辑基础与 Deck 原生对象路径 | 基础路径 Chrome 3/3、单元/集成 29/29 通过；R2 整体仍在进行 |
| TUI、Desktop 完整产品及 Web/Deck/Doc 全部生产能力 | 后续阶段未完成 |
| 旧数据导入与 Python 退役 | 尚未实施 |

2026-09-20 的 R2 基础验证通过 Node 24 全 workspace TypeScript 检查、Web production build、29/29 单元/集成检查，以及 Chrome 3/3：基本文字保存、几何属性、撤销/重做、重新载入和 PPTX 下载；鼠标拖动、角点缩放和属性旋转；切换文档时旧版本列表响应不会覆盖新选择。单纯缩放视口不增加文档修订。PPTX 重复 `pPr` 已修复，三页 XML 检查通过；图片、完整富文本、吸附/对齐、PDF、实际 Office 打开和完整 R2 验收仍未完成。

R1 完成说明共享无头核心、CLI 路径和 Windows 开发运行基线成立，不等于 Web、TUI、Desktop 或完整图形编辑已经完成。R2 的基础浏览器路径通过也不代表 R2 全部完成。R1 的 Pi faux 检查只验证 SDK 接入方法，不代表产品 agent 已接入；该集成与人机共同创作属于 R3。仍不允许将“先做 Deck”解读成取消 Web、Doc 或其他客户端，也不允许将尚未实现的模块通过调用旧 Python 工具视为完成。

## 旧实现与研究

- [旧 Studio 使用说明](studio/README.md)、[旧 Studio v1 契约](studio/contract.md)：仅用于运行、理解和导入旧产品。
- [旧 Phase 6](phase6/README.md)、[Phase 1 契约](spec/contract-skeleton.md)、[Phase 4 stub](spec/product-shell-stub-flow.md)：历史方案。
- [ADR 索引](adr/README.md)：ADR-0001～0005 是旧架构记录，ADR-0006 为当前采用决策。
- [历史归档](archive/README.md)：原始产品愿景、旧规范与调查。
- [旧竞品分析](competitive-analysis/opendesign-vs-oeydesign-2026-08-06.md)：日期受限的研究，不决定当前技术路线。
- 仓库中的 deepseek-harness-adapter 和 spikes 仅作历史研究；其中的 Python sidecar 推荐与冻结口径已被 D 路线替代。
