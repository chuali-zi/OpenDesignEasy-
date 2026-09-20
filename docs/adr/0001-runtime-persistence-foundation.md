> **历史资料：已被 2026-09-12 的 D 路线替代。** 当前方案见 [文档入口](../README.md)与 [ADR-0006](0006-full-typescript-design-platform.md)：全 TypeScript、Pi SDK、完整直接编辑、人机双向同步、Web/CLI/TUI/Desktop 共用核心。
> 下文的“当前”“冻结”“已接受”、Python/sidecar/兼容层建议和阶段验收只适用于旧版本，不约束新实现。原文保留用于理解旧代码、研究结论与数据迁入；不能据此宣布新重构已完成。

# ADR-0001：Phase 2 runtime 与持久化基础

> 状态：**已被 ADR-0006 取代；仅作历史记录。**
> 原状态（历史）：已接受，用于 Phase 2 单机 reference foundation。
> 日期：2026-07-24。
> 决策范围：Project、events、workflow checkpoints、command idempotency、audit 与 side-effect ledger。

## 上下文

Phase 1 已用内存 adapter 验证领域契约，但进程退出会丢失 Project、Run、事件和幂等记录。Phase 2 需要证明重启恢复、乐观 revision、事件重连和副作用对账，同时不能让数据库或 workflow 产品改变已冻结的项目语言。

首个基础面向本地开发、自动化测试和单机演示。当前没有证据要求多节点 worker、跨区域高可用或独立 workflow 集群。

## 决策

采用 Python 模块化单体中的 SQLite reference adapters：

- Python dataclass domain 保持框架中立；
- sqlite3 负责单机事务、Project snapshots、revision history、events、commands、workflow runs、checkpoints、audit 和 side effects；
- Project 以版本化 JSON snapshot 保存，关系表只承担并发、查询、事件顺序和幂等边界；
- 数据库启用 foreign keys、WAL、busy timeout，并以显式 migration 初始化；
- Control Plane 继续依赖 Repository、CommandLedger、EventStore、AuditLog 与 SideEffectLedger 端口；
- workflow 使用应用自有的 durable stage/checkpoint adapter，不引入外部 workflow 框架；
- 文件与未来大型 Artifact 放在受控数据根，数据库只保存引用、摘要和 lineage。

SQLite 是 Phase 2 部署 adapter，不是系统级契约。生产数据库和 workflow runtime 仍可替换。

## 选择理由

SQLite 提供真实事务、唯一约束、进程重启恢复和极少部署依赖，足以验证 Phase 2 风险。应用自有 checkpoints 可以先固定恢复与副作用语义，避免尚无真实负载时把 Temporal、队列或某个云运行时的消息模型扩散到 Project domain。

使用 versioned JSON snapshot 可以让 Phase 1 dataclass aggregate 快速持久化；独立 events、commands、runs 和 side effects 表仍保留需要数据库约束的边界。未来若对象查询需求增长，可以把热点字段投影为列或迁移到关系模型，而不改变 Client 命令。

## 备选方案

### 纯 JSON 文件

依赖最少，但并发 revision、原子命令结果、event cursor 和 side-effect claim 都需要重新实现文件锁与恢复协议，风险高于 SQLite。

### 直接 PostgreSQL

生产扩展路径更强，但增加本地部署和测试依赖；当前单机闭环没有足够证据承担这项成本。Repository conformance 保留后续迁移。

### SQLAlchemy

可以提高数据库可移植性，但 Phase 2 使用的 SQL 很少且边界明确。先使用 sqlite3 能减少抽象层与迁移复杂度；若接入 PostgreSQL，再通过单独 ADR 选择 SQL toolkit。

### 外部 durable workflow engine

具备调度、timer 和分布式 worker 能力，但会过早固定运行时操作模型。Phase 2 先用自有 checkpoint 证明语义，首个真实垂直切片出现多 worker、长 timer 或运营需求后再 spike。

## 影响

正面影响：

- 单一应用进程和单一数据库文件即可演示恢复；
- transaction、unique key 和 event sequence 可真实测试；
- 不增加领域层第三方依赖；
- 未来 adapter 替换仍使用同一 conformance suite。

限制与风险：

- SQLite 是单机写入模型，不承诺多 worker 水平扩展；
- JSON snapshot 不适合复杂跨 Project 分析；
- 长时间事务会阻塞写入，因此工具执行必须在事务外，使用 claim/checkpoint 协调；
- schema version 与 migration 必须从第一版存在；
- Windows 文件锁和异常退出必须进入测试。

## 替换触发条件

出现以下任一证据时重新评估：

- 需要多个 API/worker 实例并发写同一数据集；
- 写锁等待或 event 吞吐超过首个垂直场景预算；
- 需要高可用、在线备份、组织级隔离或复杂查询；
- 任务需要数小时 timer、跨节点 activities、worker lease 与运营控制台；
- SQLite 到目标部署平台的持久卷语义不可靠。

替换必须先让 PostgreSQL 或外部 runtime adapter 通过 Phase 2 conformance tests，再修改部署配置；不得要求 Client 或三大核心 Port 改变项目流程。
