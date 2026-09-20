> **历史资料：已被 2026-09-12 的 D 路线替代。** 当前方案见 [文档入口](../README.md)与 [ADR-0006](0006-full-typescript-design-platform.md)：全 TypeScript、Pi SDK、完整直接编辑、人机双向同步、Web/CLI/TUI/Desktop 共用核心。
> 下文的“当前”“冻结”“已接受”、Python/sidecar/兼容层建议和阶段验收只适用于旧版本，不约束新实现。原文保留用于理解旧代码、研究结论与数据迁入；不能据此宣布新重构已完成。

# ADR-0003：能力平面与首批 provider 绑定

> 状态：**已被 ADR-0006 取代；仅作历史记录。**
> 原状态（历史）：**已接受**。
> 日期：2026-08-03。
> 决策范围：Design/Quality 能力槽、首批模型绑定、版本观测与降级。

## 上下文

系统端口必须 vendor-neutral，但 Phase 6 需要一个可运行的首批绑定。D1/D3/D6/D7/D8 已验证 Kimi
长会话工具调用、长输出、图像输入与结构抽取的可行边界；D4/D5 的生图权利仍不足以成为首片硬依赖。
如果把 provider payload 或模型名写进 Project domain，后续替换会破坏生命周期与恢复契约。

## 决策

- 保留规范中的 capability slots；Project、Command、Event 与三大 Port 不出现 provider 私有字段。
- P6 首批绑定：
  - `design.direction`、`design.compose`、`artifact.edit`：Kimi `k3` 系列兼容端点；
  - `design.critique`：绑定经过启动探针确认可接收图像输入的 Kimi 实例；
  - `quality.aesthetic`：与创作会话分离的 critique 调用；
  - `image.generate`：Seedream adapter 保留，但在首个 P6 场景中**可选且默认关闭**。
- 每个 adapter 暴露稳定的 `capability_version`，Lineage、预算账本和评估记录只保存该版本与计量，
  不保存 prompt、reasoning 正文、文件正文或凭据。
- 会话启动必须执行能力探针；静默返回空图像、缺工具调用或响应 schema 不符均判
  `CAPABILITY_UNAVAILABLE`，不得降格为成功。
- 模型调用采用流式传输；预算按累积 prompt、completion、reasoning、步骤和墙钟分别记录。
- provider key 只存在于 trusted adapter 进程内存/受控 secret source，不进入工作区、子进程 env、
  事件、ledger 或导出物。
- 生图缺失时，P6 继续使用仓库已有资产、CSS/SVG/浏览器原生图形；不生成误导性假图片占位。

## 备选方案

### 全部能力绑定一个模型

配置最少，但图像输入、工具调用、长输出和审美复核能力并不等价，且无法独立替换失败槽位。

### 等生图权利完全确认后再进入 P6

会让一个非必需能力阻塞仓库到 Web Artifact 的核心闭环。首片不依赖生图更符合当前证据。

### 在领域对象中保存 provider payload

调试方便，但造成供应商锁定并扩大敏感数据持久化面，拒绝采用。

## 影响

P6 可以先完成无生图的真实候选、Artifact、Quality 和 Delivery；模型/endpoint 可按 slot 替换。
代价是必须实现 capability registry、启动探针、计量与明确降级，并为测试提供确定性 fake adapter。

## 替换条件

当 Kimi 在真实 P6 样本中持续违反完成率、成本或时延预算，或其他 provider 通过同一 slot conformance
时可替换绑定。Seedream 只有在权利、凭据和输出 lineage 都通过后才可默认启用；这些变化不修改 Port。
