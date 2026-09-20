# Agent 引擎规范：直接使用 Pi SDK

> TS 重构 v1，2026-09-12。Pi 是新 runtime 的执行核心，尚未接入。
> 当前研究基线为 Pi 0.85.1；实现时锁定公开发布版本及 lockfile，不能把研究 checkout 的 main 当成发布契约。

## 1. 集成方式与分工

packages/runtime 内直接创建 Pi AgentSession，使用 @earendil-works/pi-coding-agent 的公共 SDK。Pi 负责 provider 通信、消息流、模型工具循环、会话上下文与压缩；OEY 负责项目、设计文档、输入接收、设计工具、问题状态和产品事件。

不另建通用 AgentBackend 适配平台，不连接旧 Python agent，不复制一套 while-loop 来接管 Pi 的模型执行。runtime 内可有普通会话模块和工具函数，但其职责是产品集成，不是同时支持多个旧 harness。

采用 SDK 的 AgentSession / SessionManager 路径，不混用 Pi 新实验 harness、server/client 或不同会话格式。SDK 研究版本的 SessionManager v3 与实验新格式不是同一保存协议。

## 2. 会话创建

每个产品会话关联一个明确的项目和 Pi session。显式设置模型、项目目录、系统提示、工具列表、会话目录、资源加载和设置来源。

不默认加载用户机器上所有 Pi 扩展、技能和祖先目录提示文件。OEY 的产品提示、技能与项目引用由自身配置提供；用户显式接入扩展时再处理其能力范围。

设置 cwd 不等于文件访问隔离。默认设计工具访问项目受管内容；Pi 默认的全功能 bash/write/edit 不自动成为设计工具。需要构建 Web 代码时，使用受管工作目录和明确的构建工具。

语言栈统一不消除 provider 差异。模型是否支持图片、工具、思考参数与取消要按实际配置检查；不能把所有自定义 OpenAI-compatible URL 都视为同一种协议。

## 3. 工具集合

工具名以下为产品语义草案，实际注册名称应遵守 provider 的字符限制，例如使用下划线；不是现有可调用命令。

| 语义 | 工作方式 |
|---|---|
| project.read / document.read / document.query | 读取当前文档、节点、选区、约束和局部上下文 |
| document.apply | 提交共享命令，返回修订、目标变化或冲突 |
| design.decide | 保存用户选择、设计原则与已确认事实 |
| reference.read / reference.parse | 读取原件、结构、样式、页图及可追溯片段 |
| asset.generate / asset.import | 生成或导入素材，保存后返回 assetId |
| render.preview / render.inspect | 渲染指定修订，返回图像与可用的结构检查 |
| source.update / source.build | 修改受管 Web 模块并构建；源码变更也进入文档版本 |
| artifact.export | 从固定修订导出实际格式，记录真实结果 |
| user.ask | 打开可恢复的问题，等待对应 answer |
| version.create / version.restore | 使用产品设计版本，不导航 Pi 分支冒充回退作品 |

资料读取、图像生成与导出可以返回进度，但中间日志不是设计提交。新建图片只有显式插入文档后才成为设计内容。

文档修改按批次顺序执行；不接受多个工具同时覆盖同一 snapshot。Pi 研究版本默认允许并行工具，应显式配置设计写操作的顺序语义。独立的只读读取与渲染可并行，仍须标注所读修订。

## 4. 交互，不规定固定生产流水线

Agent 根据用户意图选择讨论、查看、探索、创建、修改或导出。不存在每轮强制“计划 → 完整生成 → 截图 → 复审 → 总结”的动作清单。

已授权的清晰修改直接执行。会改变用途、事实或整体方向的未知项才提问。用户只想讨论时不改作品；用户要求直接完成时，不为了流程而等待候选审批。

活动中提交新消息，按用户选择成为 steer 或 follow_up。人工拖拽是文档命令，不自动成为“取消旧 run 并重新完整生成”。

## 5. 输入、纠偏与停止

输入先以 inputId 写入 OEY 存储，再确认接收，随后交给 Pi。通过公共 custom message 元数据关联输入 ID 和 Pi session entry；图片与文本内容按 SDK 支持的消息形式传入。关联细节需在 R3 验证，不能依赖私有字段补丁。

- steer 在 Pi 的工具批次/turn 边界进入后续模型上下文，不能承诺即刻中断已运行的长工具。
- follow_up 在当前工作自然结束后继续。
- cancel 请求 SDK 中止，并使 runtime 拒绝该 run 的后续提交。工具通过 AbortSignal 停止子进程或请求；已返回的晚到结果也不能继续写文档。
- 新建或继续 run 使用新的身份，不能误接收前一个 run 的回调。

模型流停止、当前工具结束与产品 completed 是不同时间点。自动重试和压缩可能继续工作，产品不能仅凭第一个 agent_end 就提前标记完成，应结合 SDK 活动、队列和本次 prompt 的最终结果判断。

停止保留已经提交的设计，用户可单独撤销；不能悄悄丢弃成功修改或把剩余队列误称为已经处理。

## 6. 可恢复提问

user.ask 先持久保存 questionId、问题、选项、允许的自由文本和关联 run，再通知客户端。用户答案通过 answer 输入回到该问题；客户端重启后仍可看到待答问题。

提问不是一个在工具线程里无限等待的 Promise。runtime 设置 waiting_input，并使用 Pi 公共 beforeToolCall / shouldStopAfterTurn 等控制点阻止后续依赖答案的写入及下一轮模型请求。

不能只让某个工具返回 terminate 就假设整批已停：研究版本的该标志具有整批条件。应在 R3 验证“提问与写入同时被模型请求”的情况。普通用户问题不要求再套审批层。

## 7. 设计上下文

每轮上下文按需求包括当前目标、用户新输入、选区的稳定身份、相关文档修订、最近人工修改、已确认设计决定、需要的参考片段及当前截图。

文档是权威状态，历史模型文字只解释过程。压缩后重建上下文必须读取当前设计与决定，不能用旧摘要覆盖人工编辑。

大项目先读概要和目标子树，需要时再取页面、图片、表格与源码。旧截图在设计变化后标记过期；视觉判断优先当前修订。

多个候选可由同一 agent 创建独立候选文档或版本。多 agent 编排不是本版 runtime 的必备机制，不为候选比较先建设代理平台。

## 8. 会话持久化与恢复边界

Pi 会话记录不等于产品输入队列或文档提交记录。研究版本部分队列位于内存，会话写盘也有时序；SSE 中看到消息不代表产品恢复已经可靠。

OEY 保存输入接收状态、项目事件与文档提交；Pi 保存对话语义。两者通过明确 ID 关联，避免维护另一份可独立驱动模型的聊天真源。重启发现结果不确定时，显示中断与待处理输入，不自动重放可能已付费的生图或外部动作。

完整规则见 [运行与恢复](runtime-recovery.md)。文档提交可以幂等；跨 provider 调用不承诺恰好执行一次。

## 9. 配置与运行质量

模型和图片服务配置位于 runtime，客户端仅使用受控设置入口；API key 不进入文档、日志正文、导出包或浏览器预览。手工编辑、已有资料查看与不依赖模型的导出不要求模型凭据。

用户可看到正在处理的对象、工具活动、等待原因和失败原因。取消、错误与局部成功使用真实状态。预算与最大运行时用于防止意外持续运行，不规定每件作品必须经历固定轮数。

## 10. 必要集成验证

用固定工具和少量真实模型用例验证：持续多轮、人工修改后读取、局部冲突、活动中 steer、follow_up、停止后的晚到结果、混合批次提问、压缩后续改、进程重启后的输入状态。

核心编辑规则先做确定性测试；真实模型用例验证交互和 provider 行为，不用大量付费测试重复测数据库规则。

## 11. 已核对依据

- [Pi SDK v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)：嵌入式会话、工具与资源入口。
- [Agent 执行契约](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/types.ts)：工具模式、steering、终止与 turn 控制。
- [AgentSession 实现](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts)、[SessionManager 实现](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/session-manager.ts)：输入关联、队列与保存时序。

以上支撑集成边界，不代表 OEY 已具备这些行为。
