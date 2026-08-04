# OEYdesign documentation

## 正式文档

- [Product requirements](./prd.md)：产品原始目标与场景。
- [Overall architecture](./architecture.md)：已审核通过的架构原则与系统分层。
- [System specification](./spec/system-spec.md)：规范性的总体组件、状态、接口和端到端流程。
- [Implementation plan](./spec/implementation-plan.md)：架构落地阶段、依赖、交付物和验收门。
- [Phase 1 contract skeleton](./spec/contract-skeleton.md)：代码中立的生命周期、端口与 stub 验收契约。
- [Phase 2 runtime recovery](./spec/runtime-recovery.md)：持久状态、checkpoint、重连、幂等与失败恢复契约。
- [Phase 3 Context & Evidence](./spec/context-evidence-baseline.md)：原件、证据分层、来源、权利与 Context Package 契约。
- [Phase 4 Product Shell](./spec/product-shell-stub-flow.md)：Project 驱动的工作台、stub 产品闭环、反馈、质量门与交付契约。

## Phase 5 内部规范（已冻结）

- [Agent Engine](./spec/agent-engine-spec.md)（v0.6 🔒）：工作区、工具目录、agent 循环、自验证闭环、沙箱与预算。另外三份的基础。
- [Design Intelligence](./spec/design-intelligence-spec.md)：候选表示、design contract、模型能力平面与创作 loop。
- [Artifact Production](./spec/artifact-production-spec.md)：Web 可运行产物、对象标识、真实渲染、导出与取舍语义。
- [Quality & Governance](./spec/quality-governance-spec.md)：双轨评估、硬检查、审美 rubric、修复边界与交付门。

`system-spec.md`、`context-evidence-baseline.md` 与 `implementation-plan.md` v0.2 已于
2026-08-03 审核通过并冻结。ADR-0002～0005 同日接受，Phase 6 已进入骨架阶段。

- [Phase 6 plan and Luna handoff](./phase6/README.md)：P6.0 骨架、P6.1～P6.6 分段工作与退出条件。

## 决策与归档

- [Architecture decision records](./adr/README.md)：后续重大架构决策的记录入口。
- [Archived research](./archive/README.md)：技术、运行时、参考摄入研究及历史调研日志。归档材料仅作为决策证据，不覆盖正式架构和 Spec。
