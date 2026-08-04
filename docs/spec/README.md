# OEYdesign Specifications

本目录承接已采用架构的规范化设计。

- [System specification](./system-spec.md)：系统级组件、状态、接口、流程和不变量。
- [Implementation plan](./implementation-plan.md)：规范落地顺序、工作流和验收门。
- [Contract skeleton](./contract-skeleton.md)：Phase 1 的生命周期、端口、命令、事件、错误和 stub 验收契约。
- [Runtime recovery](./runtime-recovery.md)：Phase 2 的持久状态、workflow checkpoint、重连与副作用契约。
- [Context & Evidence baseline](./context-evidence-baseline.md)：Phase 3 的原件接入、证据分层、来源定位、权利与 Context Package 契约。
- [Product Shell stub flow](./product-shell-stub-flow.md)：Phase 4 的可恢复工作台、产品动作、stub 闭环与界面验收契约。

Phase 5 的内部规范：

- [Agent Engine](./agent-engine-spec.md)（v0.6 🔒 已冻结）：工作区、工具目录、agent 循环、自验证闭环、session 续跑、沙箱与预算；E1–E13 已终结，ADR-0005 已接受受限 `framework` profile。**另外三份的基础**；
- [Design Intelligence](./design-intelligence-spec.md)（v0.4 🔒 已冻结）：候选表示、design contract、艺术方向阶段与视觉领地库、模型能力平面与创作 loop；
- [Artifact Production](./artifact-production-spec.md)（v0.4 🔒 已冻结）：Web 可运行产物、对象标识、真实渲染、离线 vendor 供给、导出与取舍语义；
- [Quality & Governance](./quality-governance-spec.md)（v0.3 🔒 已冻结）：双轨评估、硬检查清单、审美 rubric、修复边界与交付门。

四份规范的首个垂直媒介为 Web，首个真实场景为「本仓库 → agent 前端页（含自造 mock 后端）」。
它们不改变 `ports.py` 中三个 Protocol 的方法签名。四份均已冻结，其变更必须通过版本化 Spec
或 ADR；仍被凭据阻塞的假设（Design Intelligence 的 D4/D5 生图）例外，变更范围限于对应小节。

审美方向已裁决：首批视觉领地为 **`graphite` 深色工作台**与 **`paper` 暖纸编辑台**，
入库判据（分离度 ≥ 25）与标定见 `design-intelligence-spec.md` §4.2.3 和
`spikes/aesthetic-ab/convergence.py`。

核心原则：**沙箱内最大自由，边界上严格纪律**。agent 在阶段内部拥有工作区与工具，自主创作、
运行与自修，不被逐步监督；进入项目真源的只有经端口返回并由 Control Plane 验证的产出，外部副作用
仍需审批。

配套的既有规范升版（v0.2，2026-08-03 已冻结）：`system-spec.md`（§5 增加 Agent Workspace 与 Agent
Session 概念身份）、`context-evidence-baseline.md`（仓库只读接入与授权根路径规则）、
`implementation-plan.md`（Phase 5 范围与场景变更）。

Phase 6 已启动，P6.0 组合根、P6.1 只读仓库/Context adapter、P6.2 workspace/session/action-loop
边界、P6.3 capability registry/broker、P6.4 framework artifact/renderer/builder 契约，以及 P6.5
确定性 Quality hard-check/delivery gate 边界已完成。
分段计划和 Luna 接力入口见 [Phase 6 plan](../phase6/README.md)；真实 agent、provider、renderer 与端到端交付
未齐备前不得标记 G5 完成。
