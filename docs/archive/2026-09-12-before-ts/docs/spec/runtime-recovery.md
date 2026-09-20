# Phase 2：Project 与可恢复工作流基础

> 状态：v0.1，2026-07-24 采用。
> 上位规范：system-spec、implementation-plan、contract-skeleton。
> 配套决策：ADR-0001 runtime and persistence foundation。

## 1. 目标与非目标

Phase 2 把 Phase 1 的内存 reference harness 变成可在进程重启后恢复的产品状态基础，同时保持领域契约不依赖数据库或 workflow 框架。

本阶段必须提供：

- Project、Artifact、Workflow Run、命令结果和事件的持久生命周期；
- workflow start、pause、resume、cancel、query 与阶段 checkpoint；
- Client 按 cursor 重连并重放有序事件；
- revision 乐观并发、命令幂等和外部副作用对账；
- 项目历史恢复、审批失效、审计和失败注入；
- NEEDS_INPUT、BLOCKED、FAILED、CANCELED 的可演示行为。

本阶段不实现真实模型、真实渲染器、多节点调度、云对象存储或生产级高可用。

## 2. 持久真源边界

持久层至少保存以下相互独立的记录：

| 记录 | 所有权 | 恢复语义 |
|---|---|---|
| Project snapshot | Control Plane | 当前业务状态与 current pointers |
| Project revision snapshot | Control Plane | 只追加；历史恢复的来源 |
| Project event | Control Plane | 按 Project 单调 sequence 重放 |
| Command record | Control Plane | command ID、payload fingerprint、结果 |
| Workflow Run | Runtime | 执行状态，不拥有业务真源 |
| Stage checkpoint | Runtime | 输入 revision、输出引用、完成状态、attempt |
| Workflow event | Runtime | 按 Run 单调 sequence 重放 |
| Side-effect record | Delivery/runtime | claim、完成结果或失败；key 唯一 |
| Audit entry | Governance | 动作、结果、revision、耗时和安全元数据 |

Project snapshot 采用带 schema version 的序列化格式。大型原件与导出物只保存引用和摘要，不把文件正文写入事件、命令或审计。

## 3. 事务与 revision

- 每个 Project 命令在单一事务中验证 expected revision、写入新 snapshot、追加 revision snapshot 与 Project events，并记录命令结果。
- 更新使用乐观并发；数据库中的 revision 与 expected revision 不一致时返回 STALE_REVISION，事务不产生部分结果。
- 同一 command ID 与相同 payload fingerprint 返回原结果；同一 ID 携带不同 payload 时返回 DETERMINISTIC_FAILURE。
- ProjectCreated 从 revision 1 开始。恢复历史会复制所选业务内容形成 current revision + 1，并追加 ProjectRestored；不得删除后续历史。
- 历史恢复会失效旧审批和未完成交付链；已经释放的 Delivery Bundle 保持不可变。

## 4. Workflow Run 与 checkpoint

Run 状态为 PENDING、RUNNING、PAUSED、NEEDS_INPUT、BLOCKED、RETRY_WAIT、COMPLETED、FAILED 或 CANCELED。每个 stage checkpoint 记录：

- stage key 与顺序；
- input Project revision 和规范化 input fingerprint；
- attempt、最大重试和超时；
- status、output references 与错误类别；
- side-effect key（若有）；
- started、updated、completed 时间。

运行边界：

~~~text
start(project, kind, input_revision, idempotency_key)
pause(run, reason)
resume(run, input?)
cancel(run, reason)
query(run_or_project, after_event)
checkpoint(run, stage, input_fingerprint, output_refs)
~~~

相同 Run、stage 和 input fingerprint 已 COMPLETED 时，resume 直接复用 checkpoint；输入 revision 或 fingerprint 变化时必须建立新 Run 或显式重算，不覆盖原 checkpoint。

进程重启后，runtime 从持久 Run 和 checkpoint 继续。没有完成标记的阶段可以按错误与 retry policy 重新执行；已完成阶段和已完成副作用不能无条件重跑。

## 5. Pause、resume 与终止状态

- pause 只停止后续阶段，不回滚已提交 Project revision。
- resume 必须验证 Project current revision 仍与 Run 输入或明确的 resume input 兼容。
- cancel 将 Run 标为 CANCELED，并由 Control Plane 将可取消的 Project 运行态提交为 CANCELED；已完成 Artifact 与历史仍保留。
- NEEDS_INPUT 记录缺失信息、恢复目标 stage 和安全的 resume token，不把敏感正文写入 token。
- POLICY_BLOCKED、CAPABILITY_UNAVAILABLE 等不可自动继续的条件进入 BLOCKED。
- 确定性不可恢复错误进入 FAILED。
- retryable error 或 timeout 在剩余 attempt 内进入 RETRY_WAIT；耗尽后进入 FAILED。

## 6. Client 重连与事件

Project events 和 Workflow events 都使用数据库分配的单调 sequence。Client 保存最后确认的 cursor，并使用：

~~~text
query project events(project_id, after_sequence)
query workflow events(run_id, after_sequence)
~~~

重新连接先读取最新 Project snapshot，再重放 cursor 后事件。事件允许至少一次读取，因此 Client 以 event ID 去重；Project snapshot 仍是界面恢复真源。

事件 payload 只包含可展示的状态、引用、计数和原因摘要。原始用户内容、附件正文、凭据与供应商响应不进入默认事件日志。

## 7. 审批与副作用对账

外部副作用执行两步协议：

1. 在事务中以稳定 side-effect key claim；
2. 执行后记录 COMPLETED 及规范化结果引用。

相同 key 已 COMPLETED 时返回已保存结果；处于 CLAIMED 且租约有效时不并发执行；租约过期时先对账，再决定补记完成或安全重试。

稳定 key 至少包含 Project、动作、目标 revision、Approval、实际 export revision 和 delivery profile fingerprint。审批必须 active 且与目标 revision/action 匹配。Artifact、方向、事实或策略发生超出批准范围的变化时追加 ApprovalInvalidated。

Phase 2 只模拟本地 delivery 副作用，但必须使用与未来 adapter 相同的 ledger。

## 8. 失败注入与观测

测试工具可以在指定 Run/stage/attempt 注入：

- RETRYABLE；
- TIMEOUT；
- NEEDS_INPUT；
- POLICY_BLOCKED；
- CAPABILITY_UNAVAILABLE；
- DETERMINISTIC_FAILURE。

审计至少记录 Project、Run、command/action、输入 revision、结果类别、attempt、耗时、capability version、Approval 和 side-effect key。审计 metadata 使用 allowlist，不记录 prompt、文件正文、token、凭据或完整用户输入。

## 9. 持久化适配器契约

SQLite reference adapter 必须：

- 打开 foreign keys、WAL 和 busy timeout；
- 所有路径由部署配置给出，并限制在应用数据根；
- 使用参数化 SQL；
- 以 schema migration 初始化，不依赖手工建表；
- 关闭并重新打开数据库后恢复同一 Project、Run、events、command result 和 side-effect result；
- 不把 SQLite row 或 ORM 对象暴露给 domain/Client。

Repository、Runtime、EventStore、AuditLog 和 SideEffectLedger 保持独立端口；未来 PostgreSQL 或外部 workflow runtime 通过 conformance tests 替换。

## 10. Phase 2 验收

自动化验收至少证明：

1. 关闭并重建 composition root 后，Project、Artifact、Run 和 cursor 后事件可恢复；
2. command retry、stage retry 和 delivery retry 不重复 revision 或副作用；
3. stale revision 与 command ID payload collision 被拒绝；
4. pause/resume/cancel/query 与 Project 状态一致；
5. restore revision 创建新 revision、保留历史并失效审批；
6. NEEDS_INPUT、BLOCKED、FAILED、CANCELED 均有持久状态和可读原因；
7. retryable/timeout obey bounded retry，已完成 stage 不重跑；
8. 审计可按 Project/Run 查询且不含敏感正文；
9. Client 使用 after_sequence 重连不会丢失或重复应用事件；
10. SQLite adapter 可以被同一 persistence conformance suite 驱动。
