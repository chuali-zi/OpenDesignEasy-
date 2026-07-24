# OEYdesign Specifications

本目录承接已采用架构的规范化设计。

- [System specification](./system-spec.md)：系统级组件、状态、接口、流程和不变量。
- [Implementation plan](./implementation-plan.md)：规范落地顺序、工作流和验收门。
- [Contract skeleton](./contract-skeleton.md)：Phase 1 的生命周期、端口、命令、事件、错误和 stub 验收契约。
- [Runtime recovery](./runtime-recovery.md)：Phase 2 的持久状态、workflow checkpoint、重连与副作用契约。

后续计划补充：

- `design-intelligence-spec.md`：智能设计层内部架构与技术选择；
- `artifact-production-spec.md`：Artifact 生产层及 Web/PPT/DOCX 实现架构；
- `quality-governance-spec.md`：质量、修复、策略和治理内部架构。

以上三个模块当前只受 `system-spec.md` 的宏观接口约束，内部实现仍为 TODO。
