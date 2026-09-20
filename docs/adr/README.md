# 架构决策记录

当前战略决策为 [ADR-0006](0006-full-typescript-design-platform.md)：用户于 2026-09-12 采用全 TypeScript、Pi SDK、完整直接编辑、人机同步与四端共享核心。

| ADR | 当前效力 |
|---|---|
| [0006：全 TypeScript 交互设计平台](0006-full-typescript-design-platform.md) | 已采用，目标实现尚未完成 |
| [0001：运行与持久化](0001-runtime-persistence-foundation.md) | 旧实现记录，被 0006 取代 |
| [0002：Web 渲染与验证](0002-web-rendering-validation.md) | 旧实现记录，被 0006 取代 |
| [0003：能力与 provider](0003-capability-provider-bindings.md) | 旧实现记录，被 0006 取代 |
| [0004：工作区与沙箱](0004-agent-workspace-sandbox.md) | 旧实现记录，被 0006 取代 |
| [0005：框架应用基底](0005-framework-application-base.md) | 旧实现记录，被 0006 取代 |

旧记录中的“已接受”只代表当时的决定，不与 0006 并列约束新实现。局部工程原则可参考，但不得恢复旧 Python 运行链、强制 Phase 6 流程或受限视觉 profile。

当前范围与行为由 [PRD](../prd.md)、[架构](../architecture.md)、[Spec](../spec/README.md)共同说明。新的实质决策应更新相应规范；日常实现无需为每个小修改新增 ADR 或审批。
