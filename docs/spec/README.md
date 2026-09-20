# 当前规范

> TS 重构 v1，2026-09-12。D 路线已采用；实现状态统一见 [实施计划](implementation-plan.md)。

由 [PRD](../prd.md)、[架构](../architecture.md)和 [ADR-0006](../adr/0006-full-typescript-design-platform.md)确定范围。以下文件共同描述一个新 TS 产品，不要求兼容旧 Python 内部接口。

| 规范 | 职责 |
|---|---|
| [系统](system-spec.md) | 项目、文档、命令、事件与运行身份 |
| [编辑文档](editor-document-spec.md) | 媒介 schema、完整直接编辑、人机同步与撤销 |
| [Agent 引擎](agent-engine-spec.md) | Pi SDK、工具、交互、终止与上下文 |
| [设计智能](design-intelligence-spec.md) | 创作策略、连续修改、视觉方向与用户选择 |
| [资料与上下文](context-evidence-baseline.md) | 全 TS 解析、事实、风格、模板与资料引用 |
| [产物生产](artifact-production-spec.md) | 原生对象、Web/PPTX/DOCX/PDF、导入与交付 |
| [运行与恢复](runtime-recovery.md) | 存储、输入、版本、重连与旧数据迁入 |
| [质量](quality-governance-spec.md) | 编辑正确性、视觉质量、实际导出与必要测试 |
| [客户端](clients-spec.md) | Web / CLI / TUI / Desktop 及无 Python 分发 |
| [实施计划](implementation-plan.md) | R0–R7 全量迁移顺序、交付标准与风险 |

文档模型与操作语义只在编辑规范定义，其他规范引用，不各自复制一套。系统规范定义信封与运行概念，Agent 工具和客户端复用它。

[contract-skeleton](contract-skeleton.md)和 [product-shell-stub-flow](product-shell-stub-flow.md)是旧阶段记录，不是新实现的接口模板。历史 Spec 原文见 [迁移前快照](../archive/2026-09-12-before-ts/INDEX.md)。
