# Model-agnostic agent runtime research

> Archive status: retained as research evidence from 2026-07-23. The adopted architecture and current specifications live under `docs/architecture.md` and `docs/spec/`.

Research snapshot: 2026-07-23

## Executive decision

Use a TypeScript-first runtime with this initial composition:

1. **AI SDK 7** for provider abstraction, multimodal model messages, structured output, tool calls, streaming, image generation, and UI stream types.
2. **Workflow SDK 4** for durable orchestration, retries, suspension/resumption, replay, streaming recovery, and long-running jobs. Use its official PostgreSQL world for self-hosting.
3. **Application-owned schemas and policy** for project state, model capability routing, tool authorization, budgets, and artifact manifests.
4. **PostgreSQL** for product records and workflow durability, plus S3-compatible object storage for uploaded references and generated artifacts.
5. **OpenTelemetry** from the first implementation. Record model, task class, tokens, estimated cost, latency, retry/fallback reason, tool decision, and artifact IDs, but redact prompts and files by default.
6. **MCP TypeScript SDK v1** only as an optional tool/resource interoperability adapter. MCP is not the agent runtime.
7. **Direct AI SDK provider packages initially**. Add LiteLLM as a separate gateway only after cross-provider failover, centralized virtual keys, team budgets, or independent cost governance becomes an actual operational need.

Do not start with a free-running multi-agent swarm. Model the product as an explicit durable design workflow, and use a bounded agent loop only inside steps that genuinely require exploration.

This recommendation is the smallest stack that currently covers both sides of the PRD: a responsive TypeScript web application and durable-recovery primitives for user-interruptible design jobs. Recovery is only reliable after workflow versions are pinned, side effects are idempotent, and migration/reconciliation behavior is tested. The stack also avoids coupling the product to a hosted Vercel runtime because Workflow SDK has an official self-hosted PostgreSQL backend.

## Why the decision changed

Older comparisons often classify AI SDK as an in-memory model/UI library. That is no longer complete for AI SDK 7:

- [`@ai-sdk/workflow`](https://ai-sdk.dev/docs/agents/workflow-agent) now provides `WorkflowAgent`, whose tool executions can be durable workflow steps and whose approval state survives process restarts.
- The underlying open-source [Workflow SDK](https://github.com/vercel/workflow) provides event-log persistence, automatic step retries, hooks/webhooks, resumable streams, and deterministic replay.
- Its official [`@workflow/world-postgres`](https://github.com/vercel/workflow/tree/main/packages/world-postgres) implementation uses PostgreSQL and Graphile Worker for self-hosted durable storage and job processing. The runtime registry is visible in [`worlds-manifest.json`](https://github.com/vercel/workflow/blob/main/worlds-manifest.json).

AI SDK's ordinary `ToolLoopAgent` and memory integrations remain in-memory/conversation features. Durability exists only when work is placed inside Workflow SDK and side effects are implemented as `"use step"` functions.

## Product fit

The PRD requires more than a chatbot. A job may read a repository and many references, ask the user for missing information, generate images, iteratively render and critique a web page/PPT/document, and export the result. That implies these durable phases:

1. Intake and file quarantine.
2. Reference extraction and repository inventory.
3. Intent and constraint synthesis.
4. Clarification interrupt when required fields or permissions are missing.
5. Design brief and artifact plan.
6. Parallel content, layout, and image generation.
7. Deterministic rendering in an isolated workspace.
8. Visual/structural critique and bounded revision loop.
9. User review interrupt when a consequential choice cannot be inferred.
10. Export, manifest generation, and delivery.

Each phase should have a typed input/output schema. The workflow owns transitions and retry boundaries; the model proposes typed decisions inside those boundaries.

## Recommended architecture

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

### State ownership

Keep four different forms of state separate:

| State | Owner | Purpose |
|---|---|---|
| Product/project state | Application schema in PostgreSQL | Source of truth for brief, references, artifact versions, approvals, and export status |
| Workflow execution state | Workflow SDK event log | Replay, retries, suspended hooks, active step, and stream cursor |
| Conversation/UI state | Application-owned `UIMessage[]` | Renderable chat history and approval parts |
| Large binary artifacts | Object storage plus DB manifest | Uploads, screenshots, generated images, PPTX/DOCX, web bundles, and previews |

Do not treat chat history, a framework checkpoint blob, or an LLM provider conversation ID as the project source of truth.

### Canonical model interface

The application should expose task-oriented model roles instead of provider model IDs:

```text
reasoning.high
reasoning.fast
vision.analysis
structured.extraction
image.generate
image.edit
embedding.default
```

For every configured deployment, store an application-owned capability record:

- accepted input modalities and file limits;
- tool calling and strict structured-output support;
- image generation/edit support;
- context and output limits;
- streaming support;
- region/data-retention constraints;
- price and concurrency limits;
- provider-specific options that a task is permitted to use.

Routing must reject an incapable model before making a request. A fallback must preserve required capabilities; a cheap text model is not a valid fallback for a vision or strict-schema task.

### Tool boundary

Tools should be application capabilities, not direct aliases for shell commands or arbitrary MCP tools. Every call should pass this sequence:

1. Resolve authenticated user, tenant, project, and workflow run.
2. Validate input schema and normalize paths/URLs.
3. Check tool allowlist, project roots, requested side effects, and budget.
4. Require approval for destructive, externally visible, costly, or privilege-elevating actions.
5. Execute in the correct isolation boundary.
6. Persist an idempotency key and audit event.
7. Validate and size-limit output before returning it to the model.

AI SDK explicitly notes that forwarding a sandbox interface does not itself create an isolation boundary. Rendering generated web code, running repository commands, and converting documents therefore require a real container or hosted sandbox with filesystem, network, process, memory, and time limits.

## Shortlist comparison

Ratings describe framework-native support, not what can be custom-built around it.

| Candidate | Layer | Providers and multimodal | Structured tools/streaming | Durable resume and HITL | Cost/access governance | Main concern | Verdict |
|---|---|---|---|---|---|---|---|
| AI SDK 7 + Workflow SDK 4 | Model/UI plus durable runtime | Strong; broad TS providers, media parts, image/video APIs | Strong; typed tools, schema output, UI streams | Strong when using `WorkflowAgent` or explicit workflow steps | Build app policy; OTel usage available | Newer durability integration; workflow code must be deterministic | **Recommended** |
| Mastra | Full TS agent platform | Strong; uses AI SDK provider generations | Strong | Strong snapshots, `suspend()`/`resume()`, active-run restart | Built-in usage/cost observability; app auth still needed | Large surface and framework-owned storage/workflow semantics | Runner-up for faster all-in-one platform |
| LangGraph JS | Low-level graph runtime | Via LangChain/model adapters | Strong but more adapter-dependent | Very strong checkpoints, interrupts, time travel | Mostly external/LangSmith or custom | Graph/checkpointer semantics and `@langchain/core` types spread easily | Runner-up for complex graph control |
| LiteLLM | Python SDK and model gateway | Very broad OpenAI-shaped provider normalization | Good at gateway endpoints and streaming | Not an agent checkpoint/runtime | Excellent routing, virtual keys, budgets, spend | Extra service; provider-specific semantics can leak or be flattened | Optional gateway, not runtime |
| PydanticAI | Python agent framework | Strong and strongly typed | Strong | Strong only through Temporal, DBOS, Prefect, Restate, etc. | OTel/Logfire; custom auth/budgets | Introduces Python service and a second durable system | Python-heavy alternative |
| OpenAI Agents SDK JS/Python | Agent loop, handoffs, sessions | Has model/provider interfaces and AI SDK extension | Strong tools, guardrails, streaming | Serializable run state/HITL, but sessions are not a general durable workflow engine | Built-in tracing; custom governance | Default concepts and hosted tools favor OpenAI Responses | Useful specialist library, not default runtime |
| LlamaIndex Python | Data/RAG and agents | Broad Python ecosystem | Strong data and retrieval tools | Workflow support, but not the best TS app fit | Custom | Better as an ingestion/RAG library than product runtime | Use selectively if needed |
| LlamaIndex.TS / workflows-ts | Former TS data/workflow stack | Historically adequate | Adequate | Snapshot features existed | Custom | Both repositories were archived and marked deprecated on 2026-04-30 | Reject for new work |
| MCP | Interoperability protocol | Carries text/image/audio/resource content | Tools/resources/prompts over JSON-RPC | Progress/cancel/resumable transport, not crash-safe job execution | OAuth transport auth, not host tool policy | Servers and tool metadata are untrusted; no sandbox or runtime | Adapter only |

### License and ecosystem snapshot

| Project | Primary ecosystem | License relevant to this evaluation |
|---|---|---|
| AI SDK | TypeScript/JavaScript | [Apache-2.0](https://github.com/vercel/ai/blob/main/LICENSE) |
| Workflow SDK | TypeScript/JavaScript | [Apache-2.0](https://github.com/vercel/workflow/blob/main/LICENSE.md) |
| Mastra | TypeScript/JavaScript | [Apache-2.0 core](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md); code under any `ee/` directory uses the Mastra Enterprise License |
| LangGraph JS | TypeScript/JavaScript | [MIT](https://github.com/langchain-ai/langgraphjs/blob/main/LICENSE) |
| LiteLLM | Python service/SDK, language-neutral HTTP clients | [MIT core](https://github.com/BerriAI/litellm/blob/main/LICENSE); `enterprise/` is separately licensed |
| PydanticAI | Python | [MIT](https://github.com/pydantic/pydantic-ai/blob/main/LICENSE) |
| OpenAI Agents SDK JS/Python | TypeScript and Python, separate SDKs | [MIT JS](https://github.com/openai/openai-agents-js/blob/main/LICENSE) and [MIT Python](https://github.com/openai/openai-agents-python/blob/main/LICENSE) |
| LlamaIndex | Python; former TS repositories deprecated | [MIT Python](https://github.com/run-llama/llama_index/blob/main/LICENSE) and [MIT former TS](https://github.com/run-llama/LlamaIndexTS/blob/main/LICENSE) |
| MCP specification/official SDKs | Protocol plus TypeScript/Python SDKs | License varies by repository, branch, and file. Check the pinned specification and each SDK independently; non-spec documentation may be CC-BY-4.0. |

Licenses above apply to the open-source repositories, not hosted services, model APIs, bundled third-party packages, or enterprise features. A dependency/license scan is still required when implementation versions are pinned.

## Detailed findings

### AI SDK 7

Best fit for the web-facing and model-facing layers:

- A published language-model specification and provider packages abstract model calls without requiring the Vercel AI Gateway. Direct providers and OpenAI-compatible endpoints are supported.
- `generateText`/`streamText` combine provider-normalized tool calls with Zod, Valibot, or JSON Schema validation.
- Structured output can be streamed and combined with tool calls.
- Request controls include retries, total/step/chunk/tool timeouts, and cancellation.
- OpenTelemetry records model calls, tool execution, usage, latency, and stream timing. Inputs and outputs are recorded by default after telemetry registration, so production configuration must explicitly disable or redact sensitive payloads.
- Tool approval exists, but provider-executed tools are controlled provider-side and do not pass through local approval in the same way. High-risk tools should remain application-executed.
- Memory providers and chat persistence are not substitutes for durable workflow state.

Key implementation paths:

- [Provider language-model specification](https://github.com/vercel/ai/tree/main/packages/provider/src/language-model)
- [`generateText` implementation](https://github.com/vercel/ai/tree/main/packages/ai/src/generate-text)
- [`streamText` implementation](https://github.com/vercel/ai/tree/main/packages/ai/src/generate-text)
- [`WorkflowAgent`](https://github.com/vercel/ai/blob/main/packages/workflow/src/workflow-agent.ts)
- [AI SDK license](https://github.com/vercel/ai/blob/main/LICENSE): Apache-2.0

Lock-in control:

- Persist application `UIMessage` records and domain objects, not only provider responses or `ModelMessage[]`.
- Put model selection behind the application task-role registry.
- Keep provider options in a narrow adapter and test all required modalities per provider.
- Do not use provider-hosted files, threads, memory, or tools as the only copy of state.

### Workflow SDK 4

Best fit for durable job orchestration in the recommended stack:

- A `"use workflow"` function is deterministic orchestration code. Its step results are persisted in an event log and replayed after failure.
- A `"use step"` function has normal Node.js access, is retried automatically, and persists its result.
- Workflows can suspend on steps, timers, and webhooks without consuming active compute.
- Streaming data can be replayed to reconnecting clients.
- Workflow runs are version-sensitive; releases need a run migration/versioning policy.
- Step retries imply at-least-once side-effect risk. External writes need idempotency keys or reconciliation.
- The workflow sandbox limits packages and Node APIs. Keep orchestration simple and move I/O into steps.

Key implementation paths:

- [Workflow SDK repository](https://github.com/vercel/workflow)
- [Workflow engine packages](https://github.com/vercel/workflow/tree/main/packages)
- [Official PostgreSQL world](https://github.com/vercel/workflow/tree/main/packages/world-postgres)
- [Runtime registry](https://github.com/vercel/workflow/blob/main/worlds-manifest.json)
- [Workflow SDK license](https://github.com/vercel/workflow/blob/main/LICENSE.md): Apache-2.0

Lock-in control:

- Keep each step input/output as versioned application schemas.
- Store durable business state outside the workflow event log.
- Make steps callable as ordinary functions and avoid importing workflow APIs into domain logic.
- Wrap start/resume/query operations behind a small `JobRuntime` interface.

### Mastra

Mastra is the closest all-in-one alternative. It offers agents, typed workflows, workflow snapshots, suspend/resume, storage adapters, memory, MCP, observability, a server, and Studio. Its workflow snapshots persist across deployments and restarts when a durable store is configured.

It is a good choice if the team values one integrated framework and Studio more than a smaller dependency surface. It is not the default because the recommended stack already needs AI SDK UI, while Mastra itself depends on multiple AI SDK provider generations. Adding Mastra would place workflow, storage, memory, server, and observability semantics behind a much larger framework boundary.

Key implementation paths:

- [Workflow core](https://github.com/mastra-ai/mastra/tree/main/packages/core/src/workflows)
- [Agent core](https://github.com/mastra-ai/mastra/tree/main/packages/core/src/agent)
- [Storage interfaces](https://github.com/mastra-ai/mastra/tree/main/packages/core/src/storage)
- [Observability packages](https://github.com/mastra-ai/mastra/tree/main/observability)
- [MCP package](https://github.com/mastra-ai/mastra/tree/main/packages/mcp)
- [License mapping](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md): core Apache-2.0; any `ee/` directory uses the Mastra Enterprise License

### LangGraph JS

LangGraph has the strongest explicit graph/checkpoint mental model among the TS candidates. Checkpointers persist per-thread graph snapshots, stores persist cross-thread memory, and `interrupt()` plus `Command({ resume })` support indefinite human pauses.

Important execution caveat: resuming an interrupt restarts the containing node from its beginning. Code before the interrupt runs again, so side effects must be idempotent or moved to another node. This is correct durable-execution behavior but must shape the whole implementation.

Choose LangGraph instead if dynamic graph topology, state time travel, checkpoint inspection, or sophisticated parallel branch interrupts are more important than the smallest web stack.

Key implementation paths:

- [Graph runtime](https://github.com/langchain-ai/langgraphjs/tree/main/libs/langgraph/src)
- [Checkpoint packages](https://github.com/langchain-ai/langgraphjs/tree/main/libs)
- [Persistence documentation](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Interrupt documentation](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [License](https://github.com/langchain-ai/langgraphjs/blob/main/LICENSE): MIT

### LiteLLM

LiteLLM solves a different problem: normalize and govern access to many model deployments through an OpenAI-shaped SDK/proxy. Its router supports deployment load balancing, cooldowns, retries, provider/model fallbacks, latency/cost/rate-aware strategies, and Redis-backed shared usage state. Its proxy supports virtual keys, model allowlists, budgets, spend logs, and an admin UI.

Reasons not to deploy it on day one:

- It adds a Python service, operational database, and usually Redis.
- AI SDK already supplies direct provider abstraction and request retries.
- OpenAI-shaped normalization cannot erase real differences in tool semantics, media formats, reasoning controls, generated files, and provider-hosted tools.
- Several governance features are enterprise-only; verify required routes and UI features against the license before committing.

Add it when centralized governance across multiple applications/providers is worth the service boundary. Keep capability routing in the application even then.

Key implementation paths:

- [`litellm/router.py`](https://github.com/BerriAI/litellm/blob/main/litellm/router.py)
- [`litellm/proxy/proxy_server.py`](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py)
- [Model price/capability map](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
- [License](https://github.com/BerriAI/litellm/blob/main/LICENSE): core outside `enterprise/` is MIT; `enterprise/` has separate terms

### Python candidates

PydanticAI is the strongest Python alternative for typed agents and model abstraction. Its official durable execution support intentionally delegates to Temporal, DBOS, Prefect, or Restate. That is appropriate for a Python-first platform, but it is more infrastructure than this TS-first product needs initially.

LlamaIndex Python remains useful for specialized ingestion and retrieval. Its former TypeScript framework and TypeScript workflow repository are archived and explicitly deprecated, so they should not anchor a new TS runtime.

OpenAI Agents SDK is lightweight and has model/provider interfaces, tools, guardrails, sessions, HITL run state, tracing, MCP, and an AI SDK extension. It is still centered on OpenAI Responses and hosted tool concepts by default, and conversation sessions are not equivalent to a general durable workflow event log.

## MCP assessment

The latest published stable specification at this research date is `2025-11-25`. Use stable SDK v1.x for production and negotiate or pin the protocol version actually supported by both client and server. Both official TypeScript and Python SDK repositories describe their v2 lines as pre-release and recommend v1.x for production.

### What MCP contributes

- Standard JSON-RPC lifecycle and capability negotiation.
- Server features: tools, resources, and prompts.
- Client features: sampling, filesystem roots, and elicitation.
- Standard `stdio` and Streamable HTTP transports.
- Optional progress notifications and cancellation.
- SSE event IDs and `Last-Event-ID` for transport reconnection/redelivery.
- Optional OAuth 2.1-based authorization for HTTP transports.

### What MCP does not contribute

- Durable application jobs or crash-safe workflow checkpoints.
- Exactly-once tool execution.
- Tool sandboxing or host filesystem enforcement.
- Authorization of an individual tool's business effect.
- Cost budgets, model fallback, or provider routing.
- Trust in tool descriptions, annotations, prompts, or returned content.

Progress ends with the active request. Cancellation is advisory and may race with completion. Stream resumption redelivers transport events, not application state. A session ID is not authentication and must not be used as such.

### Required host controls

- Treat every server, tool description, schema, prompt, and resource as untrusted input.
- Show the exact local server startup command and require consent before spawning it.
- Prefer `stdio` for local servers; sandbox child processes and grant explicit roots/network access.
- For Streamable HTTP, validate `Origin`, bind local services to loopback, authenticate every request, and use cryptographically random user-bound session IDs.
- Validate OAuth discovery URLs against SSRF, redirect, private-address, DNS-rebinding, and dangerous-scheme attacks.
- Never pass an MCP access token through to a downstream API. Bind and validate token audience, use PKCE and the OAuth resource indicator, and request least-privilege incremental scopes.
- Elicitation must not collect secrets. Sampling and elicitation UIs must identify the requesting server and allow accept, decline, and cancel.
- Roots are hints/boundaries exchanged by protocol; the host and server must still enforce canonicalized path access.
- Rate-limit tool listing, calls, progress, sampling, and elicitation. Size-limit and content-scan results before putting them into model context.

Key sources and paths:

- [MCP specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
- [Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [Roots](https://modelcontextprotocol.io/specification/2025-11-25/client/roots)
- [Sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)
- [TypeScript SDK v1](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)
- [Python SDK v1](https://github.com/modelcontextprotocol/python-sdk/tree/v1.x)
- [Specification license](https://github.com/modelcontextprotocol/specification/blob/main/LICENSE); inspect the pinned [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) and [Python SDK](https://github.com/modelcontextprotocol/python-sdk/tree/v1.x) licenses separately

## Lock-in rules

Model independence is an application architecture property, not a framework checkbox. Apply these rules:

1. Own the domain schemas for project, brief, reference, artifact, approval, model task, and tool result.
2. Keep provider messages at the adapter edge. Store normalized application messages plus raw provider metadata only when needed for diagnostics.
3. Give every external side effect an application idempotency key.
4. Put workflow-framework calls behind a narrow runtime interface.
5. Keep large files out of checkpoints and prompts; pass immutable artifact IDs and signed URLs.
6. Do not depend on a provider's thread, file, hosted tool, or memory as the only source of truth.
7. Maintain contract tests for each provider/task role using text, image input, file input, tool call, strict schema, streaming, cancellation, and error normalization.
8. Export OpenTelemetry rather than relying only on a framework-hosted trace UI.
9. Version workflow and state schemas and define what happens to runs started on an older deployment.
10. Make the fallback decision from capability and policy records, not from exception text alone.

## Cost and reliability policy

Implement this in the application before adding a gateway:

- Per-request and per-project maximum model steps.
- Maximum input bytes, extracted text, images, and context tokens.
- Per-task model allowlist and maximum price class.
- Retry only transient failures; never blindly retry invalid prompts, policy blocks, or deterministic tool errors.
- Exponential backoff with jitter and provider `Retry-After` support.
- Fallback only before user-visible output begins, unless the step can be safely restarted from a checkpoint.
- Record actual selected deployment and fallback reason.
- Prevent recursive agent/tool loops with both a step limit and a wall-clock/cost budget.
- Use deterministic cache keys only for tasks whose privacy and freshness requirements permit caching.

If several applications or tenants later need centrally administered virtual keys, model access, provider failover, and spend limits, put LiteLLM between AI SDK and providers. Do not move product workflow state into the gateway.

## Suggested proof of concept

Before committing the runtime, build one vertical slice rather than a generic agent platform:

1. Next.js chat accepts a prompt and 3-5 reference images/files.
2. A Workflow SDK run stores references and executes typed analysis steps.
3. AI SDK routes vision analysis and structured brief generation through two different providers.
4. The workflow suspends for one clarification and resumes after a page refresh or process restart.
5. It generates one image, renders one web artifact in an isolated worker, captures a preview, critiques it, and performs at most one revision.
6. The client reconnects to the durable stream.
7. OpenTelemetry shows model/tool/workflow spans and estimated cost without storing file contents.
8. A forced crash during analysis and a forced transient provider failure prove checkpoint recovery and idempotent side effects.
9. A provider switch proves that canonical state and artifact rendering do not depend on provider-specific message IDs.

Acceptance criteria should include recovery and policy behavior, not only output quality.

## Official source index

### Recommended stack

- [AI SDK providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [AI SDK tool calling and approval](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK settings, retries, cancellation, and timeouts](https://ai-sdk.dev/docs/ai-sdk-core/settings)
- [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [AI SDK WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent)
- [Workflow SDK foundations](https://useworkflow.dev/docs/foundations)
- [Workflow and step semantics](https://useworkflow.dev/docs/foundations/workflows-and-steps)
- [Workflow SDK repository](https://github.com/vercel/workflow)

### Alternatives and gateway

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
