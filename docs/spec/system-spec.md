# 系统规范：项目、文档与操作

> TS 重构 v1，2026-09-12。目标行为，尚未实现。
> 上位规范：[架构](../architecture.md)。本文替代旧 Control Plane / Phase 6 系统契约。

## 1. 职责

Project Runtime 是项目的应用入口，组合 Document Kernel、Pi 会话、存储、资料和媒介工具。Kernel 决定操作是否有效及如何改变文档。客户端和 agent 不直接修改数据库或导出文件来改变设计。

本版没有通用 capability 注册平台、旧 API 翻译层或自建模型工具循环。HTTP、IPC、终端只是相同业务入口的不同 I/O。

## 2. 核心身份

| 概念 | 定义 |
|---|---|
| Project | 文档、资料、资产、会话、设置和项目事件的容器 |
| Document | 一份 Web、Deck 或 Doc 设计的权威可编辑状态，含 schemaVersion 与 revision |
| Page / Section / Node | 媒介内稳定目标；名称和 DOM selector 不承担身份 |
| Asset | 原件、图片、字体等文件及元数据；文档通过 assetId 引用 |
| DesignDecision | 用户选择、已确认约束、风格与内容决策 |
| Command | 一次有身份、基准和前置条件的修改请求 |
| Operation | 命令内最小语义操作；一个命令可原子提交多个操作 |
| Revision | 文档每次成功修改后单调增加的修订号 |
| Version | 用户或系统标记的设计快照；不是每一帧鼠标位置 |
| Session / Run | 持续对话及一次活动执行；与文档历史分别管理 |
| Input | 已接收的用户消息、纠偏或问题回复，具有 inputId |
| Event | 已提交状态变化或临时执行活动的通知 |

一个项目可含多种媒介。第一版文档命令只修改一个 documentId；跨文档创作逐份提交，并显示部分完成情况，不实现分布式事务。

## 3. 统一修改信封

以下是目标 TS 契约草图；具体类型在实现时从共享包导出，客户端不能另造含义相似的 JSON。

~~~ts
type CommandEnvelope = {
  commandId: string;
  projectId: string;
  documentId: string;
  actorId: string;
  actorKind: "human" | "agent" | "system";
  clientId: string;
  runId?: string;
  baseRevision: number;
  preconditions: EditPrecondition[];
  operations: DocumentOperation[];
  label: string;
};
~~~

actor 与 run 由可信宿主绑定，不能相信浏览器任意填写的身份。preconditions 是 Kernel 可检验的节点存在性、属性旧值、父关系和文本版本等，不是模型的一段声明。

处理顺序：

1. 检查项目 owner、命令去重及 run 是否仍允许写入。
2. 读取当前文档，校验身份、schema、目标、锁定与前置条件。
3. 对陈旧命令按编辑规范判断能否重放，或返回冲突。
4. 在内存中计算全部操作及反向数据；任何一步失败均不提交该批次。
5. 事务保存文档、命令结果、操作与持久事件，随后广播提交结果。

相同 commandId 与相同请求再次提交返回原结果，不重复修改；同 ID 不同内容返回错误。幂等只覆盖文档提交，不代表模型计费、第三方生图等外部副作用恰好执行一次。

成功结果含 commandId、documentId、revision、changedNodeIds 和项目事件序号。失败使用清晰类别：invalid、conflict、locked、cancelled、busy、not_found；附涉及目标及当前修订，不能伪装成功。

## 4. 读取与视图

读取接口支持项目摘要、文档快照、节点/子树、页面、变更范围、资产及明确版本。agent 先取相关内容，不必每次拿整个项目。

稳定目标格式至少含 projectId、documentId、pageId 或 sectionId、nodeId、revision；文本选择额外携带可映射的位置/范围。页面标题、选中 DOM 的文字只是辅助说明。

图形客户端可以进行本地乐观预演；服务器提交失败后，恢复到当前权威状态并解释冲突。一个客户端的选择、缩放和面板展开状态，不改变其他客户端的设计，也不写文档历史。

## 5. 事件

持久事件使用 projectId、单调 seq、eventId、type、必要的 documentId/revision、payload。核心类型为 document.changed、version.created、input.accepted、input.resolved、run.status、question.opened/answered、asset.added、export.finished/failed。

模型 text_delta、工具的中间输出、手势预演属于临时活动，不逐 token 写项目事务日志。临时输出可丢失，已提交的文档与已接收输入不能靠 SSE 内存补偿。

客户端重连先按 lastSeq 补事件；超出保留范围则获取快照与新的 seq。应用事件只更新本地视图，不能重新调用原命令。事件里的修订号使旧渲染结果不会覆盖新设计。

## 6. 执行状态与输入

run 的产品状态为 running、waiting_input、cancelling、completed、cancelled、failed；无活动 run 时会话为 idle。Pi 内部 turn、重试与压缩是运行活动，不另造产品项目状态机。

用户输入明确区分：

- message：空闲时开始或继续讨论/创作。
- steer：当前活动仍存在时加入纠偏；不会自动撤销已提交修改。
- follow_up：当前工作结束后继续的任务。
- answer：回复一个明确 questionId。
- cancel：停止活动执行，并禁止该 run 后续写入。

客户端收到 input.accepted 意味着 runtime 已持久保存该输入；不等于模型已读取或已经完成。消费、取消和失败状态要可见。

停止不会自动回滚此前成功的编辑。用户可以通过同一历史撤销；生成或导出中途停止的未完成文件不得冒充最终产物。

## 7. 跨客户端与执行所有权

每个项目有一个活动写入 owner，所有业务写入串行到它的提交入口。命令计算与渲染可在工作进程进行，提交仍回到 owner。

CLI 可以直接在进程中打开无头 runtime；TUI 同样可独立使用。Web 和 Desktop 通过宿主调用核心。已有 owner 时允许受控本地连接或清楚报占用，不能开启第二个互不知情的 agent writer。实现与重启规则见 [恢复规范](runtime-recovery.md)。

本版面向本地单用户多客户端，不引入多人账号服务或 CRDT。但“单用户”不能作为忽略人工与 agent 并发修改的理由。

## 8. 导出与外部工作

渲染、导出和构建读取固定 revision 快照。结果记录来源 revision、文件与实际完成状态；若用户已继续编辑，界面标明“来自修订 N”，不覆盖当前视图。

普通资料导入和编辑执行用户当前授权。发布、覆盖外部原件或产生新外部副作用按具体用户意图处理，不把所有节点修改变成审批请求。

必要验收集中在命令原子性、去重、冲突、事件重连和四端一致性，详见 [质量规范](quality-governance-spec.md)。
