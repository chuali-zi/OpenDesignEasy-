# Phase 1：契约骨架

> 状态：v0.1，2026-07-24 采用。
> 上位规范：`system-spec.md`、`implementation-plan.md`。
> 范围：系统级语义与可替换接缝；不选择真实模型、渲染器、数据库或工作流框架。

## 1. 目的与边界

本规范把总体 Spec 的概念收敛为可执行的最小契约，使确定性 stub 可以证明完整项目流程，同时不把某个供应商或内部算法固化为系统语言。

Phase 1 必须证明：

- Client 只提交项目命令，不依赖任何具体端口实现；
- Project Control Plane 是业务状态的唯一提交者；
- Design、Artifact、Quality 与 Delivery 只交换项目内可寻址的版本；
- 命令重试不会产生重复交付；
- 任意端口实现只要通过相同 conformance tests，就能替换 stub。

本阶段不定义传输协议、持久化、供应商消息、真实媒介 IR 或三大模块的内部结构。

## 2. 身份与 revision 语义

Project、Workflow Run、Candidate、Artifact、Render、Quality Decision、Approval 与 Delivery Bundle 都有独立且不复用的身份。

- Project revision 是 Control Plane 接受一次业务变更后的单调递增序号。
- Candidate 与 Artifact 各自维护单调递增 revision，并记录其父 revision。
- 恢复历史版本会创建新 revision，不移动或删除历史。
- 命令除创建 Project 外都携带 `expected_project_revision`；不匹配时拒绝为 `STALE_REVISION`。
- Approval 绑定明确对象、对象 revision、动作和已知影响。目标发生方向级或实质内容变化后，旧 Approval 不再授权后续动作。
- Quality Decision 只对其目标 revision 有效。
- Delivery Bundle 必须同时引用 Artifact revision、实际 export revision、最终 Quality Decision 和 export Approval。

项目 ID 与各对象 ID 都是实现无关的不透明值。供应商 thread、message、file、memory 或 tool ID 不能成为上述身份。

## 3. Project 状态机

正常路径如下：

```text
NEW -> INGESTING -> READY_FOR_DESIGN -> DESIGNING
  -> AWAITING_DIRECTION_APPROVAL -> PRODUCING -> VALIDATING
  -> AWAITING_EXPORT_APPROVAL -> READY_TO_DELIVER
  -> DELIVERING -> DELIVERED
```

补充规则：

- `INGESTING -> READY_FOR_DESIGN` 只在 Context Package、Design Brief 和有效 Constraint Profile 都存在时发生。
- 实质不确定性使当前运行进入 `NEEDS_INPUT`；用户补充后回到被中断阶段。
- 方向拒绝或方向级反馈从 `AWAITING_DIRECTION_APPROVAL` 回到 `DESIGNING`。
- 可修复硬错误从 `VALIDATING` 回到 `PRODUCING`，并产生新 Artifact revision。
- 任一运行态可进入 `BLOCKED`、`FAILED` 或 `CANCELED`；已完成 revision 保留。
- `DELIVERED` 后的修改启动新的 revision、验证与交付链，不能改写旧 Delivery Bundle。
- 状态只能由 Control Plane 在验证 workflow 结果后提交；端口不能直接修改状态。

Phase 1 的 stub 可使用已确认的最小 Context Package 跳过真实解析，但仍须显式提交 `INGESTING` 与 `READY_FOR_DESIGN` 事件。

## 4. 命令、事件与错误

### 4.1 命令

命令表达意图，至少包含命令 ID、Project ID、期望 Project revision 和调用者意图。最小命令集为：

| 命令 | 作用 |
|---|---|
| `CreateProject` | 创建 Project 与初始 Constraint Profile |
| `PrepareProject` | 接入已确认的 Phase 1 Context Package |
| `GenerateCandidates` | 规划并生成完整候选 |
| `ApproveDirection` | 批准某一 Candidate revision |
| `SubmitFeedback` | 提交方向、Artifact 局部或事实/策略反馈 |
| `ProduceArtifact` | 从已批准方向生产目标媒介 Artifact |
| `ValidateArtifact` | 渲染并取得 Quality Decision |
| `ApproveExport` | 批准目标 Artifact revision 的导出 |
| `DeliverArtifact` | 导出、复验并释放 Delivery Bundle |
| `CancelWorkflow` | 取消可取消的运行 |

同一个命令 ID 的重试必须返回同一已提交结果，不能重复业务变更或副作用。

### 4.2 事件

事件表达已经提交的事实，至少包含事件 ID、Project ID、Project revision、类型和发生时间。最小事件族为：

- Project 与状态：`ProjectCreated`、`ProjectStateChanged`；
- Context：`ProjectPrepared`、`InputRequested`；
- Design：`CandidatesCreated`、`DirectionApproved`、`CandidateRevised`；
- Production：`ArtifactCreated`、`ArtifactRevised`、`ArtifactRendered`；
- Quality：`QualityAssessed`、`TransitionBlocked`；
- Approval：`ApprovalGranted`、`ApprovalInvalidated`；
- Delivery：`ExportCreated`、`ExportVerified`、`DeliveryReleased`；
- Runtime：`WorkflowStarted`、`WorkflowProgressed`、`WorkflowPaused`、`WorkflowResumed`、`WorkflowCanceled`、`WorkflowFailed`。

事件是只追加的事实；不得以修改旧事件表达恢复或更正。

### 4.3 错误类别

| 类别 | 语义 | 默认处理 |
|---|---|---|
| `RETRYABLE` | 短暂失败，同输入可安全重试 | 有界重试 |
| `NEEDS_INPUT` | 缺少会实质改变结果的信息或批准 | 暂停等待用户 |
| `POLICY_BLOCKED` | 权利、安全、权限或策略拒绝 | 进入 `BLOCKED` |
| `CAPABILITY_UNAVAILABLE` | 当前能力不能满足必要模态或可靠性 | 合法降级或 `BLOCKED` |
| `DETERMINISTIC_FAILURE` | 相同输入必然失败 | 进入 `FAILED` |
| `STALE_REVISION` | 命令针对的 Project revision 已过期 | 返回当前 revision，不执行 |
| `INVALID_TRANSITION` | 当前状态不接受该命令 | 不执行 |
| `QUALITY_GATE_FAILED` | 存在阻断交付的硬错误 | 返回修复或阻断路径 |

错误不得携带或要求 Client 理解供应商原始响应。

## 5. Workflow Runtime Boundary

运行时拥有执行状态，不拥有 Project 业务状态。它提供四个逻辑操作：

```text
start(project, workflow_kind, input_revision, idempotency_key) -> Workflow Run
resume(run, resume_token_or_input) -> Workflow Run
cancel(run, reason) -> Workflow Run
query(run_or_project, after_event?) -> Run Snapshot + ordered progress events
```

每个阶段声明输入 revision、输出引用、完成标记和副作用键。已完成阶段在相同输入下恢复时不得重跑；只有输入 revision、策略或显式重算请求变化才可重新计算。

Phase 1 可以同步、内存执行这些操作；Phase 2 才实现进程重启后的恢复。

## 6. 三个核心 Port

### 6.1 Design Intelligence

```text
planDesign(context, brief, constraints, capabilities) -> Design Strategy
createCandidates(strategy, context) -> Candidate Set
reviseCandidate(candidate_revision, feedback, context) -> Candidate Revision
commitDirection(candidate_revision, approval) -> Approved Design Direction
```

Candidate 必须包含可预览内容、创作责任、模板角色、有效约束和输入来源引用。方向确认前允许整体重做；确认后保留批准基准。

### 6.2 Artifact Production

```text
materialize(direction, target_profile, constraints) -> Artifact Revision
applyArtifactChange(artifact_revision, change_request) -> Artifact Revision
renderArtifact(artifact_revision, render_profile) -> Render Bundle
exportArtifact(artifact_revision, delivery_profile) -> Export Candidate
```

正式 `materialize` 只接受已批准方向。Artifact 属于单一媒介；修改产生新 revision。Render 与 export 是不同结果，export 必须重新进入 Quality。

### 6.3 Quality & Governance

```text
assessCandidate(candidate_render, brief, constraints) -> Quality Decision
assessArtifact(render_bundle, delivery_profile, context) -> Quality Decision
planRemediation(quality_decision, current_revision) -> Remediation Request
authorizeTransition(quality_decision, requested_action, approvals) -> Gate Decision
```

Quality Decision 分开记录：

- 非阻断的审美发现；
- 事实、权利、安全和格式等硬错误；
- 风险与已知降级；
- 明确的 gate 结论。

审美发现不能单独否决用户选择；任何未解决的硬错误都不能授权正式交付。

## 7. Feedback、模板与交付规则

Feedback 先分类再路由：

| 分类 | 示例 | 路由 |
|---|---|---|
| `DIRECTION` | “整体不喜欢，换一种叙事和风格” | Design `reviseCandidate` |
| `ARTIFACT_LOCAL` | “把 hero 标题改短” | Artifact `applyArtifactChange` |
| `FACT_OR_POLICY` | “金额错误，这张图无公开授权” | Context + Quality；Phase 1 记录为需重验 |

对象引用优先级为稳定对象、页面/幻灯片/章节、整个 Artifact。无法定位时必须显式降级，不能猜测对象。

模板四种角色的最小可观察行为为：

| 角色 | Design | Artifact | Quality |
|---|---|---|---|
| 参考样例 | 可重构，只保留风格证据 | 不要求保留结构 | 偏离仅作审美信号 |
| 起始脚手架 | 可重组、替换、扩展 | 保留有用对象关系 | 结构偏离通常警告 |
| 设计系统 | 在 token/组件规则内创造 | 保留系统语义 | 规则违背按严重度警告或阻断 |
| 交付合同 | 仅在开放区域创作 | 保留锁定结构 | 锁定区域偏离是硬错误 |

交付顺序固定为：

```text
approved artifact revision
  -> export candidate
  -> assess actual export
  -> final gate + matching export approval
  -> release immutable Delivery Bundle
```

写文件、分享、部署、发送、删除、权限提升和显著成本调用都视为外部副作用，必须使用稳定幂等键。Phase 1 的 Delivery stub 只模拟释放行为。

## 8. Stub 与 conformance 验收

所有 Phase 1 stub 必须：

- 对相同规范化输入产生确定性结果；
- 输出 Project、对象 revision、Workflow Run 和 capability version 的关系；
- 不调用网络、不读取供应商会话、不执行真实发布；
- 能通过与未来实现共用的端口测试。

Phase 1 退出测试至少覆盖：

1. `CreateProject -> PrepareProject -> GenerateCandidates -> ApproveDirection -> ProduceArtifact -> ValidateArtifact -> ApproveExport -> DeliverArtifact`；
2. 合法与非法状态迁移、过期 revision 和审批对象不匹配；
3. Quality 同时返回审美发现与硬错误，并由硬错误阻止交付；
4. 同一 delivery 命令或 workflow 重试只生成一个 Delivery Bundle；
5. 以另一个 conformance 实现替换任一端口时，Client 命令流程不变；
6. 核心契约和输出中没有供应商消息 schema。
