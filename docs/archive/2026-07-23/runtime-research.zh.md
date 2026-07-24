# 模型无关的 Agent Runtime 调研

> 归档状态：本研究保留为 2026-07-23 的决策依据；当前正式架构以 `docs/architecture.md` 与 `docs/spec/` 为准。

调研快照：2026-07-23

## 执行结论

采用 TypeScript 优先的 runtime，初始组合如下：

1. **AI SDK 7**：负责 provider 抽象、多模态模型消息、结构化输出、tool call、流式传输、图片生成，以及 UI stream 类型。
2. **Workflow SDK 4**：负责 durable 编排、重试、挂起/恢复、replay、流恢复与长任务。自托管时使用其官方 PostgreSQL world。
3. **应用自有 schema 与策略**：负责项目状态、模型能力路由、工具授权、预算与 artifact manifest。
4. **PostgreSQL**：存放产品记录与 workflow 持久化；上传参考资料与生成产物使用 S3 兼容对象存储。
5. **从第一版就接入 OpenTelemetry**。记录模型、任务类别、token、预估成本、时延、重试/降级原因、工具决策与 artifact ID；默认脱敏 prompt 与文件内容。
6. **MCP TypeScript SDK v1** 仅作为可选的工具/资源互操作 adapter。MCP 不是 agent runtime。
7. **初期直接使用 AI SDK provider 包**。仅当跨 provider 故障转移、集中虚拟 key、团队预算或独立成本治理成为真实运维需求时，再把 LiteLLM 作为独立网关引入。

不要从自由运行的多 agent swarm 起步。把产品建模为显式、可恢复的设计 workflow；仅在真正需要探索的步骤内使用有界 agent loop。

这是目前同时覆盖 PRD 两侧需求的最小栈：响应式 TypeScript Web 应用，以及可被用户中断的设计任务所需的 durable recovery 原语。只有在 workflow 版本钉死、副作用可幂等、且迁移/对账行为经过测试后，恢复才可靠。该栈也不必绑定托管式 Vercel runtime，因为 Workflow SDK 有官方自托管 PostgreSQL 后端。

## 为何结论有所变化

旧对比常把 AI SDK 归类为内存中的模型/UI 库。对 AI SDK 7 来说，这已不完整：

- [`@ai-sdk/workflow`](https://ai-sdk.dev/docs/agents/workflow-agent) 现已提供 `WorkflowAgent`：其 tool 执行可作为 durable workflow step，审批状态可在进程重启后存活。
- 底层开源 [Workflow SDK](https://github.com/vercel/workflow) 提供事件日志持久化、自动 step 重试、hooks/webhooks、可恢复流与确定性 replay。
- 官方 [`@workflow/world-postgres`](https://github.com/vercel/workflow/tree/main/packages/world-postgres) 使用 PostgreSQL 与 Graphile Worker 做自托管 durable 存储与任务处理。runtime 注册表见 [`worlds-manifest.json`](https://github.com/vercel/workflow/blob/main/worlds-manifest.json)。

AI SDK 普通的 `ToolLoopAgent` 与 memory 集成仍是内存/会话能力。只有把工作放进 Workflow SDK，并把副作用实现为 `"use step"` 函数时，才具备真正的 durability。

## 产品契合度

PRD 需要的不只是聊天机器人。一次任务可能读取仓库与大量参考资料、向用户追问缺失信息、生成图片、迭代渲染并批评网页/PPT/文档，最后导出结果。这意味着这些 durable 阶段：

1. 接入与文件隔离（quarantine）。
2. 参考资料提取与仓库清单。
3. 意图与约束综合。
4. 当必填字段或权限缺失时进入 clarification interrupt。
5. 设计 brief 与 artifact plan。
6. 并行内容、版式与图片生成。
7. 在隔离工作区中确定性渲染。
8. 视觉/结构批评与有界修订循环。
9. 当关键选择无法推断时进入用户审阅 interrupt。
10. 导出、manifest 生成与交付。

每个阶段都应有 typed 输入/输出 schema。workflow 拥有转移与重试边界；模型只在这些边界内提出 typed 决策。

## 推荐架构

```text
Browser / Next.js
  |  AI SDK UI stream + project events
  v
Application API
  |  auth, quotas, project records, policy checks
  v
Workflow SDK
  |  durable event log, retries, hooks, resumable streams
  |-- AI SDK provider interface
  |     |-- OpenAI / Anthropic / Google / compatible providers
  |     `-- optional LiteLLM gateway later
  |-- trusted application tools
  |-- optional MCP client adapters
  `-- isolated render/export workers

PostgreSQL: app state + workflow world
Object storage: uploads, extracted assets, previews, exports
OpenTelemetry: model/workflow/tool spans and cost metadata
```

### 状态归属

把四种状态分开：

| 状态 | 归属 | 用途 |
|---|---|---|
| 产品/项目状态 | PostgreSQL 中的应用 schema | brief、参考资料、artifact 版本、审批与导出状态的真源 |
| Workflow 执行状态 | Workflow SDK 事件日志 | replay、重试、挂起 hooks、当前 step、流游标 |
| 对话/UI 状态 | 应用自有 `UIMessage[]` | 可渲染聊天历史与审批部件 |
| 大二进制产物 | 对象存储 + DB manifest | 上传、截图、生成图、PPTX/DOCX、Web bundle 与预览 |

不要把聊天历史、框架 checkpoint blob，或 LLM provider conversation ID 当作项目真源。

### 规范模型接口

应用应暴露面向任务的模型角色，而不是 provider 模型 ID：

```text
reasoning.high
reasoning.fast
vision.analysis
structured.extraction
image.generate
image.edit
embedding.default
```

对每个已配置的部署，保存应用自有的能力记录：

- 接受的输入模态与文件限制；
- tool calling 与严格结构化输出支持；
- 图片生成/编辑支持；
- 上下文与输出限制；
- 流式支持；
- 地区/数据保留约束；
- 价格与并发限制；
- 任务允许使用的 provider 特定选项。

路由必须在发请求前拒绝能力不足的模型。降级必须保留所需能力；廉价文本模型不能作为 vision 或严格 schema 任务的有效降级。

### 工具边界

工具应是应用能力，而不是 shell 命令或任意 MCP 工具的直接别名。每次调用应经过：

1. 解析已认证用户、租户、项目与 workflow run。
2. 校验输入 schema，并规范化路径/URL。
3. 检查工具白名单、项目根、请求的副作用与预算。
4. 对破坏性、对外可见、高成本或提权操作要求审批。
5. 在正确的隔离边界中执行。
6. 持久化幂等键与审计事件。
7. 校验并限制输出大小后再返回给模型。

AI SDK 明确指出：转发 sandbox 接口本身并不构成隔离边界。因此渲染生成的 Web 代码、运行仓库命令、转换文档，都需要真实的容器或托管沙箱，并限制文件系统、网络、进程、内存与时间。

## 候选对比

评分描述的是框架原生支持，而不是围绕它可定制的能力。

| 候选 | 层级 | Provider 与多模态 | 结构化工具/流式 | Durable resume 与 HITL | 成本/访问治理 | 主要顾虑 | 结论 |
|---|---|---|---|---|---|---|---|
| AI SDK 7 + Workflow SDK 4 | 模型/UI + durable runtime | 强；广泛 TS provider、媒体部件、图片/视频 API | 强；typed tools、schema 输出、UI streams | 使用 `WorkflowAgent` 或显式 workflow steps 时强 | 自建应用策略；可用 OTel usage | durability 集成较新；workflow 代码必须确定性 | **推荐** |
| Mastra | 完整 TS agent 平台 | 强；使用 AI SDK provider generations | 强 | 强 snapshots、`suspend()`/`resume()`、活跃 run 重启 | 内建 usage/cost 可观测；仍需应用鉴权 | 表面大，存储/workflow 语义由框架拥有 | 若想更快 all-in-one 平台，可作为次选 |
| LangGraph JS | 低层图 runtime | 经 LangChain/model adapters | 强，但更依赖 adapter | 非常强的 checkpoints、interrupts、time travel | 主要靠外部/LangSmith 或自建 | Graph/checkpointer 语义与 `@langchain/core` 类型易扩散 | 复杂图控制可作为次选 |
| LiteLLM | Python SDK 与模型网关 | 非常广的 OpenAI 形 provider 归一化 | 网关端点与流式良好 | 不是 agent checkpoint/runtime | 优秀路由、虚拟 key、预算、花费 | 额外服务；provider 特定语义可能泄漏或被压平 | 可选网关，非 runtime |
| PydanticAI | Python agent 框架 | 强且强类型 | 强 | 仅通过 Temporal、DBOS、Prefect、Restate 等才强 | OTel/Logfire；自建鉴权/预算 | 引入 Python 服务与第二套 durable 系统 | Python 向替代方案 |
| OpenAI Agents SDK JS/Python | Agent loop、handoffs、sessions | 有 model/provider 接口与 AI SDK 扩展 | 强 tools、guardrails、streaming | 可序列化 run state/HITL，但 sessions 不是通用 durable workflow 引擎 | 内建 tracing；治理需自建 | 默认概念与托管工具偏向 OpenAI Responses | 有用的专科库，非默认 runtime |
| LlamaIndex Python | 数据/RAG 与 agents | 广泛 Python 生态 | 强数据与检索工具 | 有 workflow 支持，但不是最佳 TS 应用契合 | 自建 | 更适合作为 ingestion/RAG 库而非产品 runtime | 需要时选择性使用 |
| LlamaIndex.TS / workflows-ts | 前 TS 数据/workflow 栈 | 历史上够用 | 够用 | 曾有 snapshot 能力 | 自建 | 两仓库均于 2026-04-30 归档并标记废弃 | 新工作拒绝 |
| MCP | 互操作协议 | 可携带 text/image/audio/resource 内容 | 经 JSON-RPC 提供 tools/resources/prompts | progress/cancel/可恢复传输，非崩溃安全的任务执行 | OAuth 传输鉴权，非宿主工具策略 | server 与工具元数据不可信；无 sandbox 或 runtime | 仅作 adapter |

### 许可与生态快照

| 项目 | 主要生态 | 与本次评估相关的许可 |
|---|---|---|
| AI SDK | TypeScript/JavaScript | [Apache-2.0](https://github.com/vercel/ai/blob/main/LICENSE) |
| Workflow SDK | TypeScript/JavaScript | [Apache-2.0](https://github.com/vercel/workflow/blob/main/LICENSE.md) |
| Mastra | TypeScript/JavaScript | [Apache-2.0 core](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md)；任意 `ee/` 目录使用 Mastra Enterprise License |
| LangGraph JS | TypeScript/JavaScript | [MIT](https://github.com/langchain-ai/langgraphjs/blob/main/LICENSE) |
| LiteLLM | Python 服务/SDK，语言中立 HTTP 客户端 | [MIT core](https://github.com/BerriAI/litellm/blob/main/LICENSE)；`enterprise/` 另行许可 |
| PydanticAI | Python | [MIT](https://github.com/pydantic/pydantic-ai/blob/main/LICENSE) |
| OpenAI Agents SDK JS/Python | TypeScript 与 Python，独立 SDK | [MIT JS](https://github.com/openai/openai-agents-js/blob/main/LICENSE) 与 [MIT Python](https://github.com/openai/openai-agents-python/blob/main/LICENSE) |
| LlamaIndex | Python；前 TS 仓库已废弃 | [MIT Python](https://github.com/run-llama/llama_index/blob/main/LICENSE) 与 [MIT 前 TS](https://github.com/run-llama/LlamaIndexTS/blob/main/LICENSE) |
| MCP 规范/官方 SDK | 协议 + TypeScript/Python SDK | 许可因仓库、分支、文件而异。需分别检查钉死的规范与每个 SDK；非规范文档可能为 CC-BY-4.0。 |

以上许可适用于开源仓库，不包括托管服务、模型 API、捆绑第三方包或企业功能。实现版本钉死后仍需做依赖/许可扫描。

## 详细发现

### AI SDK 7

最适合面向 Web 与面向模型的层：

- 已发布的语言模型规范与 provider 包可抽象模型调用，不必依赖 Vercel AI Gateway。支持直连 provider 与 OpenAI 兼容端点。
- `generateText`/`streamText` 将 provider 归一化的 tool call 与 Zod、Valibot 或 JSON Schema 校验结合。
- 结构化输出可流式传输，并可与 tool call 组合。
- 请求控制包括重试、总/step/chunk/tool 超时与取消。
- OpenTelemetry 记录模型调用、工具执行、usage、时延与流时序。遥测注册后默认会记录输入输出，因此生产配置必须显式关闭或脱敏敏感载荷。
- 存在 tool approval，但 provider 侧执行的工具由 provider 控制，不会以同样方式经过本地审批。高风险工具应保持由应用执行。
- Memory provider 与聊天持久化不能替代 durable workflow 状态。

关键实现路径：

- [Provider language-model specification](https://github.com/vercel/ai/tree/main/packages/provider/src/language-model)
- [`generateText` implementation](https://github.com/vercel/ai/tree/main/packages/ai/src/generate-text)
- [`streamText` implementation](https://github.com/vercel/ai/tree/main/packages/ai/src/generate-text)
- [`WorkflowAgent`](https://github.com/vercel/ai/blob/main/packages/workflow/src/workflow-agent.ts)
- [AI SDK license](https://github.com/vercel/ai/blob/main/LICENSE)：Apache-2.0

锁定控制：

- 持久化应用 `UIMessage` 记录与领域对象，而不仅是 provider 响应或 `ModelMessage[]`。
- 把模型选择放在应用任务角色注册表之后。
- 将 provider 选项收在窄 adapter 内，并按 provider 测试所有所需模态。
- 不要把 provider 托管的 files、threads、memory 或 tools 当作唯一状态副本。

### Workflow SDK 4

最适合推荐栈中的 durable 任务编排：

- `"use workflow"` 函数是确定性编排代码。其 step 结果持久化在事件日志中，失败后可 replay。
- `"use step"` 函数有正常 Node.js 访问能力，自动重试，并持久化结果。
- Workflow 可在 steps、timers、webhooks 上挂起，而不消耗活跃计算。
- 流数据可 replay 给重新连接的客户端。
- Workflow runs 对版本敏感；发布需要 run 迁移/版本策略。
- Step 重试意味着至少一次副作用风险。外部写入需要幂等键或对账。
- Workflow sandbox 限制包与 Node API。编排应保持简单，把 I/O 移入 steps。

关键实现路径：

- [Workflow SDK repository](https://github.com/vercel/workflow)
- [Workflow engine packages](https://github.com/vercel/workflow/tree/main/packages)
- [Official PostgreSQL world](https://github.com/vercel/workflow/tree/main/packages/world-postgres)
- [Runtime registry](https://github.com/vercel/workflow/blob/main/worlds-manifest.json)
- [Workflow SDK license](https://github.com/vercel/workflow/blob/main/LICENSE.md)：Apache-2.0

锁定控制：

- 把每个 step 的输入/输出保持为版本化的应用 schema。
- 把 durable 业务状态存放在 workflow 事件日志之外。
- 让 steps 可作为普通函数调用，避免把 workflow API 导入领域逻辑。
- 用小型 `JobRuntime` 接口封装 start/resume/query 操作。

### Mastra

Mastra 是最接近的 all-in-one 替代方案。它提供 agents、typed workflows、workflow snapshots、suspend/resume、storage adapters、memory、MCP、可观测性、server 与 Studio。在配置 durable store 时，其 workflow snapshots 可跨部署与重启持久化。

若团队更看重一体化框架与 Studio，而不是更小的依赖面，它是好选择。不作为默认，是因为推荐栈已需要 AI SDK UI，而 Mastra 本身又依赖多代 AI SDK provider。引入 Mastra 会把 workflow、存储、memory、server 与可观测语义放到更大框架边界之后。

关键实现路径：

- [Workflow core](https://github.com/mastra-ai/mastra/tree/main/packages/core/src/workflows)
- [Agent core](https://github.com/mastra-ai/mastra/tree/main/packages/core/src/agent)
- [Storage interfaces](https://github.com/mastra-ai/mastra/tree/main/packages/core/src/storage)
- [Observability packages](https://github.com/mastra-ai/mastra/tree/main/observability)
- [MCP package](https://github.com/mastra-ai/mastra/tree/main/packages/mcp)
- [License mapping](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md)：core Apache-2.0；任意 `ee/` 目录使用 Mastra Enterprise License

### LangGraph JS

在 TS 候选中，LangGraph 拥有最强的显式图/checkpoint 心智模型。Checkpointer 持久化每线程图快照，store 持久化跨线程记忆，`interrupt()` 加 `Command({ resume })` 支持无限期人工暂停。

重要执行注意：恢复 interrupt 会从包含该 interrupt 的节点开头重新执行。interrupt 之前的代码会再跑一遍，因此副作用必须幂等，或移到另一节点。这是正确的 durable-execution 行为，但必须据此塑造整体实现。

若动态图拓扑、状态 time travel、checkpoint 检查或复杂并行分支 interrupt，比最小 Web 栈更重要，则选择 LangGraph。

关键实现路径：

- [Graph runtime](https://github.com/langchain-ai/langgraphjs/tree/main/libs/langgraph/src)
- [Checkpoint packages](https://github.com/langchain-ai/langgraphjs/tree/main/libs)
- [Persistence documentation](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Interrupt documentation](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [License](https://github.com/langchain-ai/langgraphjs/blob/main/LICENSE)：MIT

### LiteLLM

LiteLLM 解决的是另一类问题：通过 OpenAI 形 SDK/proxy 归一化并治理对许多模型部署的访问。其 router 支持部署负载均衡、冷却、重试、provider/model 降级、时延/成本/速率感知策略，以及基于 Redis 的共享 usage 状态。其 proxy 支持虚拟 key、模型白名单、预算、花费日志与管理 UI。

不在第一天部署的原因：

- 增加 Python 服务、运维数据库，通常还有 Redis。
- AI SDK 已提供直连 provider 抽象与请求重试。
- OpenAI 形归一化无法抹平工具语义、媒体格式、推理控制、生成文件与 provider 托管工具的真实差异。
- 若干治理功能仅企业版可用；承诺前需按许可核对所需路由与 UI 功能。

当跨多个应用/provider 的集中治理值得引入服务边界时再加入。即便如此，能力路由仍应留在应用内。

关键实现路径：

- [`litellm/router.py`](https://github.com/BerriAI/litellm/blob/main/litellm/router.py)
- [`litellm/proxy/proxy_server.py`](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py)
- [Model price/capability map](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
- [License](https://github.com/BerriAI/litellm/blob/main/LICENSE)：`enterprise/` 之外的 core 为 MIT；`enterprise/` 有单独条款

### Python 候选

PydanticAI 是 typed agents 与模型抽象方面最强的 Python 替代。其官方 durable execution 有意委托给 Temporal、DBOS、Prefect 或 Restate。这适合 Python 优先平台，但对本 TS 优先产品初期基础设施偏重。

LlamaIndex Python 对专用 ingestion 与检索仍有用。其前 TypeScript 框架与 TypeScript workflow 仓库已归档并明确废弃，不应锚定新的 TS runtime。

OpenAI Agents SDK 轻量，具备 model/provider 接口、tools、guardrails、sessions、HITL run state、tracing、MCP 与 AI SDK 扩展。默认仍以 OpenAI Responses 与托管工具概念为中心，且对话 sessions 不等于通用 durable workflow 事件日志。

## MCP 评估

截至本调研日期，最新已发布稳定规范为 `2025-11-25`。生产使用稳定 SDK v1.x，并协商或钉死客户端与服务端实际支持的协议版本。官方 TypeScript 与 Python SDK 仓库均将其 v2 线描述为预发布，并建议生产使用 v1.x。

### MCP 贡献什么

- 标准 JSON-RPC 生命周期与能力协商。
- 服务端能力：tools、resources、prompts。
- 客户端能力：sampling、filesystem roots、elicitation。
- 标准 `stdio` 与 Streamable HTTP 传输。
- 可选 progress 通知与取消。
- SSE 事件 ID 与 `Last-Event-ID`，用于传输重连/重投递。
- HTTP 传输可选基于 OAuth 2.1 的鉴权。

### MCP 不贡献什么

- Durable 应用任务或崩溃安全的 workflow checkpoint。
- Exactly-once 工具执行。
- 工具沙箱或宿主文件系统强制执行。
- 单个工具业务效果的授权。
- 成本预算、模型降级或 provider 路由。
- 对工具描述、注解、prompt 或返回内容的信任。

Progress 随活跃请求结束。取消是建议性的，可能与完成竞态。流恢复重投递传输事件，而非应用状态。Session ID 不是鉴权，不得当作鉴权使用。

### 必需的宿主控制

- 把每个 server、工具描述、schema、prompt 与 resource 都当作不可信输入。
- 展示确切的本地 server 启动命令，并在派生前要求同意。
- 本地 server 优先 `stdio`；沙箱化子进程，并显式授予 roots/网络访问。
- 对 Streamable HTTP：校验 `Origin`，本地服务绑定 loopback，认证每个请求，使用密码学随机且绑定用户的 session ID。
- 校验 OAuth discovery URL，防 SSRF、redirect、私有地址、DNS rebinding 与危险 scheme 攻击。
- 切勿把 MCP access token 透传给下游 API。绑定并校验 token audience，使用 PKCE 与 OAuth resource indicator，并请求最小权限、渐进式 scopes。
- Elicitation 不得收集密钥。Sampling 与 elicitation UI 必须标识请求方 server，并允许接受、拒绝与取消。
- Roots 是协议交换的提示/边界；宿主与 server 仍必须强制规范化路径访问。
- 对工具列举、调用、progress、sampling 与 elicitation 做限流。结果进入模型上下文前做大小限制与内容扫描。

关键来源与路径：

- [MCP specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
- [Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [Roots](https://modelcontextprotocol.io/specification/2025-11-25/client/roots)
- [Sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)
- [TypeScript SDK v1](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)
- [Python SDK v1](https://github.com/modelcontextprotocol/python-sdk/tree/v1.x)
- [Specification license](https://github.com/modelcontextprotocol/specification/blob/main/LICENSE)；分别检查钉死的 [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) 与 [Python SDK](https://github.com/modelcontextprotocol/python-sdk/tree/v1.x) 许可

## 锁定规则

模型无关是应用架构属性，不是框架勾选项。遵守这些规则：

1. 拥有 project、brief、reference、artifact、approval、model task、tool result 的领域 schema。
2. 把 provider 消息留在 adapter 边缘。存储归一化的应用消息；仅在诊断需要时保留原始 provider 元数据。
3. 给每个外部副作用一个应用幂等键。
4. 把 workflow 框架调用放在窄 runtime 接口之后。
5. 大文件不进 checkpoint 与 prompt；传递不可变 artifact ID 与签名 URL。
6. 不依赖 provider 的 thread、file、托管工具或 memory 作为唯一真源。
7. 为每个 provider/任务角色维护契约测试：文本、图片输入、文件输入、tool call、严格 schema、流式、取消与错误归一化。
8. 导出 OpenTelemetry，而不只依赖框架托管的 trace UI。
9. 对 workflow 与状态 schema 做版本化，并定义旧部署启动的 runs 如何处理。
10. 降级决策来自能力与策略记录，而不是仅凭异常文本。

## 成本与可靠性策略

在引入网关前，先在应用内实现：

- 每请求与每项目的最大模型 steps。
- 最大输入字节、提取文本、图片与上下文 token。
- 每任务模型白名单与最高价格等级。
- 仅重试瞬时失败；从不盲目重试无效 prompt、策略阻断或确定性工具错误。
- 带抖动的指数退避，并支持 provider `Retry-After`。
- 仅在用户可见输出开始前降级，除非该 step 可从 checkpoint 安全重启。
- 记录实际选定的部署与降级原因。
- 用 step 上限与墙钟/成本预算同时阻止递归 agent/tool 循环。
- 仅对隐私与新鲜度允许缓存的任务使用确定性缓存键。

若多个应用或租户日后需要集中管理虚拟 key、模型访问、provider 故障转移与花费上限，把 LiteLLM 放在 AI SDK 与 providers 之间。不要把产品 workflow 状态迁入网关。

## 建议的概念验证

在锁定 runtime 前，先做一个垂直切片，而不是通用 agent 平台：

1. Next.js 聊天接受一个 prompt 与 3–5 个参考图片/文件。
2. Workflow SDK run 存储参考资料，并执行 typed 分析 steps。
3. AI SDK 通过两个不同 provider 路由 vision 分析与结构化 brief 生成。
4. Workflow 挂起一次 clarification，并在页面刷新或进程重启后恢复。
5. 生成一张图，在隔离 worker 中渲染一个 Web artifact，捕获预览，批评它，最多修订一次。
6. 客户端重连到 durable stream。
7. OpenTelemetry 展示模型/工具/workflow spans 与预估成本，且不存储文件内容。
8. 分析期间强制崩溃，以及一次强制瞬时 provider 失败，证明 checkpoint 恢复与幂等副作用。
9. Provider 切换证明规范状态与 artifact 渲染不依赖 provider 特定 message ID。

验收标准应包含恢复与策略行为，而不只是输出质量。

## 官方来源索引

### 推荐栈

- [AI SDK providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [AI SDK tool calling and approval](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK settings, retries, cancellation, and timeouts](https://ai-sdk.dev/docs/ai-sdk-core/settings)
- [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [AI SDK WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent)
- [Workflow SDK foundations](https://useworkflow.dev/docs/foundations)
- [Workflow and step semantics](https://useworkflow.dev/docs/foundations/workflows-and-steps)
- [Workflow SDK repository](https://github.com/vercel/workflow)

### 替代方案与网关

- [Mastra workflows](https://mastra.ai/docs/workflows/overview)
- [Mastra suspend/resume](https://mastra.ai/docs/workflows/suspend-and-resume)
- [Mastra observability](https://mastra.ai/docs/observability/overview)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LiteLLM routing](https://docs.litellm.ai/docs/routing)
- [LiteLLM virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys)
- [LiteLLM spend tracking](https://docs.litellm.ai/docs/proxy/cost_tracking)
- [PydanticAI durable execution](https://ai.pydantic.dev/durable_execution/overview/)
- [OpenAI Agents SDK JS](https://github.com/openai/openai-agents-js)
- [LlamaIndex.TS deprecation notice](https://github.com/run-llama/LlamaIndexTS)
- [LlamaIndex workflows-ts deprecation notice](https://github.com/run-llama/workflows-ts)

---

英文原文：[runtime-research.md](./runtime-research.md)
