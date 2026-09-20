> **历史资料：已被 2026-09-12 的 D 路线替代。** 当前方案见 [文档入口](../README.md)与 [ADR-0006](../adr/0006-full-typescript-design-platform.md)：全 TypeScript、Pi SDK、完整直接编辑、人机双向同步、Web/CLI/TUI/Desktop 共用核心。
> 下文的“当前”“冻结”“已接受”、Python/sidecar/兼容层建议和阶段验收只适用于旧版本，不约束新实现。原文保留用于理解旧代码、研究结论与数据迁入；不能据此宣布新重构已完成。

# OpenDesign × OeyDesign 源码级竞品分析

> 审计日期：2026-08-06（America/Los_Angeles）  
> OpenDesign 仓库：`nexu-io/open-design`  
> 固定源码快照：`4e47119edb47e235ec0893bfca1210f8f32af436`  
> OeyDesign 基线：本工作区当前源码与文档  
> 结论性质：产品、架构、运行时、安全、质量、工程与战略的源码审计，不是仅基于 README 的功能清单

快速导航：

- [结论、方法与成熟度](#0-先说结论)
- [产品交互、架构与运行时](#4-产品与交互最值得学习的部分)
- [安全、恢复与交付](#6-安全最容易被sandbox一词误导的部分)
- [生态、Preview 与工程质量](#8-skillstemplatesdesign-systemsplugins生态是真的但数字要去重)
- [宣传核对与全维度矩阵](#11-宣传源码与成熟度核对)
- [学习清单、目标架构与路线图](#13-oey-应当直接学习什么)
- [对照实验、指标与风险](#17-建议的对照实验与验收基准)
- [最终建议与证据索引](#20-最终建议具体做与不做)

## 0. 先说结论

### 0.1 一句话判断

OpenDesign 已经是一个产品面非常宽、分发非常快、能把多种本地 Coding Agent 包装成设计工作台的“本地优先 AI 创作 IDE”；OeyDesign 目前还不是同等成熟度的终端产品，但在 revision 约束、证据 lineage、可恢复工作流、OS 级隔离、确定性构建、独立重渲染、质量门和不可变交付上，拥有比 OpenDesign 更扎实的可信执行底座。

因此最优策略不是 fork OpenDesign、追着它的页面和目录数量跑，而是：

1. 学它已经验证过的产品主链和分发方法；
2. 用 OeyDesign 自己的 durable runtime、evidence、sandbox、quality、delivery 重新实现；
3. 把“可信、可恢复、可证明”做成显性的用户价值，而不是只留在底层；
4. 先闭合一个极强的 Web/HTML 创作闭环，再扩 Deck、Document、Image、Video、Team、Marketplace；
5. 外部 CLI 兼容可以做，但必须作为权限边界清晰的可选执行模式，不能覆盖 Oey 的安全默认值。

### 0.2 最重要的非对称

| 维度 | OpenDesign 当前强项 | OeyDesign 当前强项 | 战略含义 |
|---|---|---|---|
| 产品入口 | Home、项目、会话、Studio、文件、预览、编辑、导出、设置、插件、设计系统、自动化 | Phase 4 proof desk 仍是主要可见 UI | Oey 首要任务是把已完成底座接成真实产品主链 |
| Agent 接入 | 26 个 runtime definition，覆盖约 25 个本地 CLI executable 及 BYOK 路径 | 受控的 AgentLoop、预算、动作 envelope、Kimi adapter | 学 adapter 控制面，不复制宽权限默认值 |
| 运行真相 | daemon 统一 API；run 有 JSON/JSONL 和内存态 | SQLite workflow/event/checkpoint、command ledger、side-effect claim/reconcile | Oey 应以 durable DB 为 run 真相源，并加 SSE/进程管理 |
| 安全 | loopback/public bind、Origin/Host、SSRF、路径、HMAC folder picker、iframe 均有防护 | Windows AppContainer + Job Object + allowlist env + fail closed | Oey 的执行隔离是结构性优势；OpenDesign 的 preview sandbox 不能替代它 |
| 质量 | prompt 约束、自检/critique、广泛测试、丰富 export | 真 Chrome、computed style、稳定 anchor、export 独立重渲染、哈希与 receipt | 继续把质量做成可审计证据，不降级成“模型说通过” |
| 生态 | skills、templates、design systems、plugins、craft、MCP、CLI | capability/evidence contract 更清晰，生态基本空白 | 先建立少而精、可验证的 bundle；不要先追目录数量 |
| 工程规模 | 极高开发速度、巨大测试资产、跨平台包装 | 小而清晰、契约优先 | 学发布体系；避免 10k–18k 行巨石文件和核心 `@ts-nocheck` |

### 0.3 竞争策略建议

OeyDesign 不应把自己定义为“另一个功能更少的 OpenDesign”，而应定位为：

> 面向严肃交付的 governed design agent workspace：每个输入有来源，每个决策有 revision，每个执行有权限边界，每个结果有质量证据，每次导出都可重现、可核验、可恢复。

OpenDesign 更像“尽可能接入你电脑上的 agent，然后快速产出真实文件”；OeyDesign 最有机会成为“让 agent 产出的设计在组织环境中真正可信、可批准、可复现、可交付”。两者可以有相似的工作台外观，但底层承诺不应相同。

---

## 1. 研究对象、方法与限制

### 1.1 为什么确认是这个 OpenDesign

用户所说“GitHub 星特别多的 OpenDesign”对应 [`nexu-io/open-design`](https://github.com/nexu-io/open-design)。审计当天 GitHub 页面显示约 84.1k stars、9.8k forks、446 issues、340 pull requests 和 3,119 commits；这些数字是时间点快照，会继续变化。

仓库公开定位是开源 Claude Design 替代、本地优先桌面应用，以用户已有 Coding Agent CLI 为设计引擎，覆盖 prototype、dashboard/live artifact、deck、image、video，并提供 HTML/PDF/PPTX/MP4 等输出。公开能力与发布节奏可参见[仓库主页](https://github.com/nexu-io/open-design)和[发布页](https://github.com/nexu-io/open-design/releases)。

### 1.2 源码拉取与固定方式

为避免分析期间 `main` 漂移，审计固定到：

```text
commit: 4e47119edb47e235ec0893bfca1210f8f32af436
time:   2026-08-06T21:17:25+08:00
title:  ci: right-size UI P0 runners to medium (#6502)
```

本次采用 `--filter=blob:none --no-checkout --depth 1` 的 partial clone，并 sparse checkout 核心应用、包、工具、规范、测试和代表性生态目录。完整树结构和文件数量通过 `git ls-tree -r HEAD` 统计，因此目录盘点覆盖整个 commit；源码逐行审计重点覆盖：

- `apps/daemon`
- `apps/web`
- `apps/desktop`
- `packages`
- `tools`
- `e2e`
- `docs`
- `specs`
- `scripts`
- plugin runtime、代表性 official plugins、skills、design templates、design systems

没有把 OpenDesign 整仓复制进 OeyDesign，也没有把竞品源代码作为依赖。这避免污染本仓库，同时通过 commit permalink 保证结论可复查。

### 1.3 多代理审计分工

本报告由三条独立源码审计线交叉汇总：

1. 产品/前端/交互：信息架构、关键旅程、Studio、preview、export、desktop/web、a11y、i18n、实现漂移；
2. daemon/agent/runtime：adapter、run、SSE、进程、恢复、MCP、plugin pipeline、权限和 artifact；
3. 质量/生态/工程：测试、CI、打包发布、部署、安全、隐私、生态真实性、可维护性。

最终结论由主审计对 OeyDesign 当前 Phase 6 代码和证据重新校准。特别是：Oey 根 README 仍写“Phase 6 scaffold”，但 [`docs/phase6/README.md`](../phase6/README.md) 已记录 2026-08-04 的首个真实纵切闭环；所以不能只读根 README 就把 Oey 当前状态定格在 stub，也不能把 Phase 6 后端闭环误认为产品 UI 已成熟。

### 1.4 动态验证边界

- OeyDesign 当前工作区执行 `python -m pytest`：`69 passed, 2 skipped`，耗时约 3.35 秒；受限沙箱内 loopback socket 测试会因权限失败，允许本机 loopback 后全套通过。
- OpenDesign 需要 Node ~24 与 pnpm 10.33.x；审计环境有 Node 24.15.0，但没有 pnpm，且未安装竞品依赖，因此没有声称执行了它的完整测试套件。
- OpenDesign 的动态成熟度判断来自源码、测试资产、CI/发布配置、公开 release 记录和显式维护路线图；凡是没有端到端执行验证的宣传项，都在本报告中标记为“源码支撑”“部分实现”“隐藏/占位”或“未动态验证”。
- 文件行数、目录数、测试 case 数用于理解规模和风险，不直接等同于质量。

---

## 2. 两边当前到底是什么产品

### 2.1 OpenDesign：真实心智不是“画布”，而是 AI 创作 IDE

OpenDesign 的核心不是 Figma 式自由绘制画布。它的真实主链是：

```text
Home / Registry
    ↓ 选择 creation surface、skill/template、design system、agent/model
Project + Conversation
    ↓ brief / question-form / run / streamed events
Canonical project files
    ↓
File Workspace + sandboxed Preview
    ↓ comment / inspect / draw / tweak / manual edit / version
Export / Present / Deploy / Share
```

这套心智非常重要。用户并不需要先理解 agent、技能协议、artifact manifest 或 provider；他们看到的是“选一个开始方式，描述需求，逐步产生文件，在右边看结果并交付”。daemon 承担项目、会话、文件、agent、registry、export 的业务权威，Web UI 和 `od` CLI 使用同一组 HTTP API，而不是各自实现业务规则。源码说明见 [`docs/architecture.md` 组件拓扑和所有权](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/architecture.md#L55-L110)。

### 2.2 OeyDesign：底层纵切已真实，产品壳仍停在 proof desk

OeyDesign 当前必须分成两层看：

**底层能力层已经超出 scaffold：**

- repository ingestion；
- native Windows AppContainer/Job launcher；
- Agent session、budget、action loop 和 Kimi 看图纵切；
- React/MUI/native-esbuild 冻结构建；
- 系统 Chrome 渲染、截图、DOM anchor、运行时证据；
- Artifact、确定性 ZIP、安全解包、独立重渲染；
- computed-style/overflow/anchor/export quality；
- `Validated → Durable → LocalImmutable` delivery 和重启 reconcile。

这些在 [`docs/phase6/README.md`](../phase6/README.md) 第 1–5 节有明确证据和冻结边界。

**但用户可见层仍不是完整 Agent Studio：**

- 根 [`README.md`](../../README.md) 和 product shell 文档仍描述 Phase 4 proof desk；
- [`product-client/index.html`](../../product-client/index.html) 是项目状态、候选、反馈、质量、批准、活动的三栏证明界面；
- [`product-client/app.js`](../../product-client/app.js) 的 preview 使用空 sandbox 的 `srcdoc` iframe，能够安全显示 proof，但没有真实 conversation、run stream、file workspace、source editor、agent/model 设置和多格式 export 体验；
- AgentEngine、Phase6Application 和 product shell 尚未组合成同一条用户主链。

所以 Oey 的问题不是“完全没有真实能力”，而是“真实能力没有被产品化地串起来”。这是比重写底座更可解、也更应优先解决的问题。

### 2.3 成熟度对比表

评分仅表示当前源码快照下的相对成熟度，5 代表已形成广泛、可见、可运行的产品能力，不能跨维度相加。

| 维度 | OpenDesign | OeyDesign | 解释 |
|---|---:|---:|---|
| 首次使用与 onboarding | 4.5 | 1.5 | OD 有桌面安装、CLI 探测、运行时/模型设置；Oey 主要靠命令启动 proof desk |
| 创建入口与类型 | 5.0 | 1.5 | OD 六个 UI tab、多种 skill mode；Oey 当前聚焦 Web 纵切 |
| Conversation/Run | 4.5 | 2.0 | OD 已产品化；Oey 有 loop/runtime 但未接 UI/control plane |
| 文件/预览/反馈 | 4.5 | 2.5 | OD 表面丰富；Oey 安全与证据强但工作台弱 |
| Export 广度 | 4.5 | 2.0 | OD 多格式；Oey 当前主要是 Web ZIP |
| Export 可信度 | 3.0 | 5.0 | Oey 有确定性打包、解包重渲染、hash/receipt 链 |
| Provider/CLI 兼容 | 5.0 | 2.0 | OD 约 25 CLI executable + BYOK；Oey 首个 Kimi adapter |
| 可恢复/幂等 | 3.0 | 4.5 | OD active run 重启失败；Oey durable tables/ledger 强但未接 agent 主链 |
| 执行隔离 | 2.0 | 4.0 | OD 常依赖 CLI 自身权限；Oey 真 OS sandbox，但仅 Windows |
| 质量证据 | 3.0 | 5.0 | OD 多为 prompt/lint/critique；Oey 有真实 renderer/export gate |
| 生态与分发 | 5.0 | 1.0 | OD 极宽；Oey 尚未进入 marketplace 阶段 |
| 工程可维护性 | 2.5 | 4.0 | OD 巨石和 suppressions 明显；Oey 小而契约清晰，但文档漂移存在 |
| 跨平台包装 | 4.5 | 1.5 | OD macOS/Windows/Desktop/Docker/Web；Oey 强隔离纵切仅 Windows |

---

## 3. OpenDesign 源码规模与工程形态

### 3.1 完整树目录规模

固定 commit 的全树元数据统计中，主要目录文件数大致为：

| 目录 | 文件数 | 说明 |
|---|---:|---|
| `apps/` | 4,008 | daemon、web、desktop、packaged 等产品主体 |
| `design-systems/` | 4,005 | 品牌说明、tokens、components、资产与 provenance |
| `plugins/` | 1,815 | official、community、registry、spec |
| `design-templates/` | 747 | 各 creation mode 的渲染模板 |
| `skills/` | 356 | functional skills 与说明 |
| `packages/` | 306 | contracts、platform、plugin runtime 等共享包 |
| `tools/` | 224 | dev、pack、release、guard 工具 |
| `e2e/` | 183 | Playwright/desktop/packaged 测试 |
| `docs/` | 176 | 架构、协议、部署、适配器、运维 |
| `prompt-templates/` | 107 | 图像/视频等提示模板 |
| `.github/` | 97 | CI、release、issue/PR 流程 |
| `specs/` | 71 | 当前和历史规范、维护路线图 |

完整树还显示约：

- 152 个 design-system 顶层目录，151 个 `DESIGN.md`；
- 114 个 design-template 目录和 114 个 `SKILL.md`；
- 162 个 skill 目录和 162 个 `SKILL.md`；
- official plugins 下约 460 个 `open-design.json`；
- 106 个 prompt template JSON；
- 27 个 runtime definition `.ts`；
- 19 个 locale 文件。

目录数说明其生态和营销素材极其丰富，但不等价于同数量的独立可执行能力。后文会拆解其中 lightweight stubs、manifest 包装、prompt delegation 和真实 worker 的区别。

### 3.2 核心代码体量

对 sparse checkout 的简单行数统计：

| 范围 | 约 LOC |
|---|---:|
| daemon `src` | 226,194 |
| daemon tests | 227,249 |
| web `src/app` | 470,970 |
| web tests | 203,386 |
| desktop src/tests | 20,571 |
| packages | 40,899 |
| tools | 25,722 |
| e2e | 74,399 |

其中 locale、大量数据和超大组件会放大 LOC；它只能说明变更成本和认知负担很高。

最值得警惕的生产文件：

| 文件 | 行数 |
|---|---:|
| `apps/web/src/components/FileViewer.tsx` | 17,815 |
| `apps/daemon/src/server.ts` | 13,985 |
| `apps/web/src/components/ProjectView.tsx` | 12,140 |
| `apps/daemon/src/cli.ts` | 11,362 |
| `apps/web/src/components/SettingsDialog.tsx` | 9,121 |
| `apps/web/src/components/FileWorkspace.tsx` | 8,594 |
| `apps/web/src/components/ChatComposer.tsx` | 5,986 |
| `apps/web/src/components/DesignSystemFlow.tsx` | 5,809 |
| `apps/web/src/App.tsx` | 5,225 |

13 个前端热点文件合计约 80,801 行。尤其 `ProjectView → ChatPane` 的超长 props、`FileViewer` 同时判断 renderer/project kind/manifest/file kind/export/bridge 等职责，是 Oey 不应复制的结构。

### 3.3 项目自己也承认这些风险

OpenDesign 的 [`maintainability-roadmap.md`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/specs/current/maintainability-roadmap.md#L29-L48) 明确把以下项目列为 P0/P1：

- daemon 核心模块仍有 `@ts-nocheck`；
- shared web/daemon contract 采用不完整；
- daemon HTTP/FS/spawn 边界 runtime validation 不完整；
- local capability 安全边界需显式化；
- agent process lifecycle 缺 first-class manager；
- `server.ts` 仍过大；
- error、SSE、SQLite migration、test pyramid、observability 仍不完整。

在固定快照中，`server.ts`、`cli.ts`、`runtimes/runs.ts` 开头仍有 `// @ts-nocheck`。这不是说 OpenDesign 不可靠，而是说明它用巨大的集成功能和发布速度换来了持续重构成本。Oey 应学习其边界文档和渐进拆分方式，而不是先制造同样的巨石再治理。

---

## 4. 产品与交互：最值得学习的部分

### 4.1 新建项目的产品分层

OpenDesign UI 提供六个创建 tab：Prototype、Live Artifact、Deck、Template、Media、Other；Media 再分 Image、Video、Audio。Skill registry 则使用 `prototype`、`deck`、`template`、`design-system`、`image`、`video`、`audio` 七种 mode。二者不是一一对应，UI 表示用户任务，registry mode 表示 daemon 如何索引 instruction bundle。源码说明见 [`docs/modes.md`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/modes.md#L5-L27)。

值得学的不是“做六个 tab”，而是两点：

1. 用户选择的是工作结果，不是技术协议；
2. 产品 metadata 与 registry routing 分离，使 UI 可以变而底层 bundle 不必同步改名。

Oey 的 P0 只需一个明确的 `Web` surface，P1 再增加 `Deck` 与 `Document`。不要在主链未闭合前复制 Media/Other 的广度。

### 4.2 结构化澄清，而不是无休止追问

OpenDesign 的 discovery prompt 只允许在“未解决且会实质影响结果”的需求上追问；问题表单硬上限 5 个，要求给默认建议，输出后停止，让 host 收集答案后再进入下一轮。它通过 `<question-form>` 作为 assistant 文本 artifact，由前端解析；不是 provider-native tool call。

这与 Oey PRD 的方向高度一致，建议直接吸收为产品 contract：

- `Run.status = NEEDS_INPUT`；
- `QuestionForm` 有 schema、question id、建议默认、阻塞原因；
- 答案作为新 command/message 写入 durable history；
- 不允许同时存在 provider tool question、普通聊天追问和另一套 modal 三种机制；
- 最多 5 个，只有 material ambiguity 才问；
- 用户不回答时允许使用已展示默认继续，但要留下 decision evidence。

OpenDesign 对此的源码约束见 [`apps/daemon/src/prompts/discovery.ts`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/prompts/discovery.ts#L25-L93)。

### 4.3 两栏 Studio 是 Oey 最该立刻采用的外壳

推荐 Oey P0 固定：

```text
┌────────────────────────┬─────────────────────────────────────┐
│ Conversation / Run     │ Artifact Workspace                  │
│                        │                                     │
│ brief                  │ Preview | Source | Files | Evidence │
│ question form          │                                     │
│ todo/progress          │ viewport / inspect / comment        │
│ model/tool events      │                                     │
│ errors/retry           │ quality / approval / export drawer  │
└────────────────────────┴─────────────────────────────────────┘
```

这会让现有 Project revision、candidate、quality、approval、activity 不再消失，而是放到更符合工作节奏的位置：

- Project 是 aggregate；
- Conversation/Run 在左；
- Artifact/File/Preview 在右；
- Context/Evidence、Quality、Approval、Delivery 是 drawer/tab 和显式 gate；
- 每个 UI 状态都来自 daemon projection，不另建 browser-only 项目数据库。

### 4.4 文件即交付物

OpenDesign 有两种执行 profile：

1. filesystem CLI：外部 Coding Agent 在 project workspace 写 canonical files；
2. text/BYOK：模型无文件工具，输出一个完整 `<artifact>`，host 解析并物化成文件。

两条路径最后都进入同一 File Workspace 和 Preview。对应数据流见 [`docs/architecture.md`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/architecture.md#L175-L199)。

这是非常好的产品统一点。Oey 应做得更严格：所有物化都产生 `ArtifactManifest`、`FileVersion`、source revision、hash、lineage 和 generation profile；无论 CLI 写文件还是 BYOK host materialize，后续 build/render/quality/export 都走相同的可信链。

### 4.5 反馈不只是聊天文字

OpenDesign 已有或部分已有：

- preview 元素 inspect；
- comment selection；
- draw/annotation；
- manual edit；
- tweak/palette bridge；
- version；
- present；
- 不同 artifact 的 export。

Oey 已有稳定 `data-oey-*` anchor 和 revision-bound feedback，这正好能做得比竞品更可靠。推荐反馈模型：

```text
Feedback
  id
  project_id
  artifact_id
  source_revision
  anchor_id
  locator_snapshot
  viewport
  kind: comment | draw | local_edit | fact_correction
  payload
  author
  status
```

任何“把这个按钮放大”“这段事实错了”都不应只是下一轮 prompt 字符串；要先绑定 artifact revision 和 stable anchor，再转成 agent context。这样 revision 后能判断 feedback 是否仍适用，避免对错版本动刀。

### 4.6 Capability-aware 降级

OpenDesign Web 和 Desktop 共用产品树，但 Desktop host 提供可信 folder picker、截图、console、offscreen export、open path 等能力。Web 端可能显示 unavailable、要求下载 desktop 或使用替代 exporter。

Oey 应把这个思路进一步 contract 化：

```text
CapabilityState = AVAILABLE | DEGRADED | UNAVAILABLE
reason_code
required_host
required_runtime
fallback
verified_at
```

按钮是否显示、为什么不可用、替代路径是什么，都来自 capability projection，而不是组件中按平台和文件名散落判断。

---

## 5. OpenDesign 架构与运行时

### 5.1 总体拓扑

OpenDesign 的当前架构是：

```text
browser / Electron renderer
          │ same-origin HTTP + SSE
          ▼
Next.js web app
          │ /api rewrite
          ▼
Express daemon
   ├─ SQLite + daemon-owned project files
   ├─ skills / templates / design systems / plugins
   ├─ preview / export / import / media / automation
   └─ runtime registry → local CLI / ACP process
                          └─ event stream + file writes / text artifact
```

开发由 `tools-dev` 管理 daemon/web/desktop sidecars；桌面打包通过 packaged launcher 和 IPC 发现 web URL；生产 daemon 可把静态 Next export 和 `/api/*` 同源提供；Docker 使用单服务形态。公开或共享部署必须配置 API auth、allowed origins 和 SSE proxy。

这个拓扑的高价值原则：

- daemon 是高权限 capability server；
- Web 不直接执行本地进程或拥有第二份持久化真相；
- UI 与 CLI 走同一业务 API；
- desktop 只是 host capability，不复制一套产品；
- transport 使用普通 HTTP + SSE，易调试、易被 CLI/MCP/自动化消费。

Oey 当前的 `SQLiteApplication`、product shell、Phase6Application、AgentEngine 应合并成同一 composition root，而不是继续各自证明正确。

### 5.2 Adapter 是 OpenDesign 最值得学习的后端设计

OpenDesign 不自研另一套完整 agent loop。它把模型调用、tool use、context、permission、resume、cancel 委托给用户现有 Coding Agent CLI；自身负责探测、构造 prompt/argv/cwd、启动、流解析、统一事件和 UI。

每个 agent adapter 是一个 data spec，而不是 subclass。核心字段包括：

- id/name/bin/fallbackBins；
- version probe、auth probe、model discovery；
- buildArgs；
- prompt via stdin/file 及 input format；
- stream format/event parser；
- image、MCP、resume 等 capability。

这使新增同协议 CLI 多数只需增加一个 definition；只有新 wire format 才加 parser。详见 [`docs/agent-adapters.md`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/agent-adapters.md#L5-L27)。

固定快照的 adapter 约分布为：

| 协议族 | runtime 示例/数量形态 |
|---|---|
| `claude-stream-json` | Claude、Amp、CodeBuddy |
| `json-event-stream` | Codex、Cursor Agent、OpenCode、Mimo、BYOK OpenCode |
| `copilot-stream-json` | Copilot |
| `qoder-stream-json` | Qoder |
| `acp-json-rpc` | AMR/Vela、Devin、Hermes、Kimi、Kiro、Kilo、Reasonix、Trae、Vibe |
| `pi-rpc` | Pi |
| `plain` | Aider、Antigravity、AtomCode、DeepSeek、Grok Build、Qwen |

兼容性并不意味着能力对称：native resume、MCP injection、image path、auth probe、model list、structured tool/file event 只覆盖部分 adapter。Oey UI 必须读 capability，而不能看到“支持 3 个 agent”就假设三者行为完全一致。

### 5.3 Run 与 SSE：产品化领先，持久恢复仍有缺口

OpenDesign 已有真实 run 主链：create/reuse、先订阅再启动、SSE/AG-UI mapping、structured event、cancel、watchdog、process group kill、部分 native session resume、一次副作用感知 retry。

但运行真相仍有关键边界：

- run state 和 JSONL event 能落盘；
- live replay 主要依赖进程内 ring；
- daemon 重启时，非终态 run 会被明确标记 failed，而不是继续运行；
- 多个 run 可对同一 cwd 产生竞争，检测到 contended 不等于写隔离；
- 外部 CLI 自身的 session resume 能力不一致。

Oey 的最佳组合不是照搬，而是：

```text
SQLite durable event log = 唯一真相
in-memory ring          = 热缓存
SSE Last-Event-ID       = 重连协议
Run worker/process mgr  = 执行控制
workspace lease         = 单写隔离
child retry run         = 可追踪恢复
side-effect ledger      = 幂等与不确定结果 reconcile
```

### 5.4 Oey AgentLoop 的真实位置

Oey 当前 AgentLoop 有预算、turn metadata、JSON action envelope、tool dispatcher 和 completion evidence gate；session 文件不保存 prompt、正文和凭据，预算续跑不重置。这些是很好的安全/审计约束。

但它尚缺：

- background RunService；
- chat/run/SSE/cancel 产品 API；
- provider partial delta 和 abort；
- process lifecycle service；
- native provider session resume；
- workspace lease；
- Agent action 与 side-effect ledger 的事务接合；
- 对 malformed/partial stream、401/403、429/5xx 的精细错误分类。

`KimiClient` 当前会完整累计 stream 后返回，且部分 HTTP 错误分类过于宽松。P0 应先把它接入 durable run，P1 再抽象 adapter，不要直接追 26 个 CLI。

### 5.5 推荐的 Oey AgentAdapterDef

```text
AgentAdapterDef
  id / display_name / executable
  detection_probe
  auth_probe
  model_discovery
  prompt_transport
  stream_protocol
  build_invocation
  resume_strategy
  cancel_strategy
  mcp_strategy
  image_support
  filesystem_profile
  required_sandbox
  network_policy
  capability_version
```

首批建议只做三个代表：

1. Oey Native/Kimi：验证现有受控 loop；
2. Codex 或 Claude：验证 structured local CLI；
3. OpenAI-compatible BYOK text artifact：验证无 filesystem tool profile。

每一个 adapter 必须通过同一 conformance：探测、模型、auth、stream、取消、超时、写边界、网络、resume 退化、错误映射、evidence 产出。

---

## 6. 安全：最容易被“sandbox”一词误导的部分

### 6.1 OpenDesign 并非没有安全工程

源码中有多层实际保护：

- daemon 默认 loopback bind；public/non-loopback 要 token、origin 等配置；
- API bearer、Origin/Host validation；
- BYOK proxy 和 remote fetch 有 SSRF policy，阻止内网、link-local、CGNAT 等目标；
- project file path 做 root containment；
- folder import 使用 canonical path，并由 desktop native picker 签发短期、单次 HMAC token；
- artifact/plugin preview 使用 sandboxed iframe；
- iframe message handler 验证发送 frame/window；
- plugin 安装有 manifest、来源、capability/trust/snapshot 等边界；
- tool gateway 有短期、scope 化、仅存 hash、run 终态 revoke 的 token 思路。

这些都值得 Oey 学习，特别是 public deployment 边界和 folder picker trust chain。架构安全说明见 [`docs/architecture.md`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/architecture.md#L228-L261)。

### 6.2 但 preview sandbox 不等于 agent execution sandbox

这是本次最关键的源码级结论之一。

OpenDesign 的 `OD_SANDBOX_MODE` 默认关闭；启用后核心行为是重映射 `HOME`、`USERPROFILE`、XDG、temp、Codex/Claude/OpenCode config 等目录，并限制某些 import root。见 [`sandbox-mode.ts`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/sandbox-mode.ts#L37-L49) 和[环境重映射](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/sandbox-mode.ts#L106-L194)。这是一种数据/配置隔离辅助，不是通用 OS 强制执行沙箱。

更直接的证据：

- Claude adapter 添加 `--permission-mode bypassPermissions`；见 [`claude.ts`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/runtimes/defs/claude.ts#L52-L88)。
- Codex 在 Windows/WSL 选择 `danger-full-access`；macOS/Linux 虽用 `workspace-write`，但显式打开 network access；见 [`codex.ts`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/runtimes/defs/codex.ts#L116-L127) 和[启动参数](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/runtimes/defs/codex.ts#L187-L227)。
- spawn env 默认保留用户 inherited environment，让外部 CLI 像用户终端中一样读取其登录/config；Settings configured env 还能覆盖。见 [`runtimes/env.ts`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/runtimes/env.ts#L28-L49)。

这符合 OpenDesign “信任本机用户、复用已有 CLI”的产品选择，但不能拿“sandboxed iframe preview”推导出 agent 进程不会访问 workspace 外文件、凭据或网络。

### 6.3 Oey 的安全优势与代价

Oey 的 Windows launcher 使用 AppContainer + Job Object：

- 零 capabilities；
- package 目录内随机临时盘符；
- executable 必须在隔离 workspace 内；
- allowlist env；
- 时间、内存、进程数和输出限制；
- 网络/真实 backend 只经 trusted broker；
- 非 Windows 不静默退回 host execution，而是 fail closed。

这是真正的 OS 权限边界，是 Oey 最重要的技术资产之一。但代价也必须正视：

- 当前只支持 Windows；
- PATH 上任意编译器/CLI 不能直接当作安全可执行文件；
- 需要工具镜像、签名/哈希、broker、平台级 sandbox adapter；
- 如果产品为了快速接外部 CLI 而直接绕过 launcher，这个优势会立刻消失。

### 6.4 推荐双模式，而不是模糊承诺

建议产品显式提供：

**Governed mode（默认）**

- Oey native loop 或经过批准的 adapter；
- OS sandbox；
- deny-by-default network；
- allowlisted tools/env/root；
- durable events、side-effect ledger；
- 完整 quality/delivery gate。

**External CLI compatibility mode（可选）**

- 复用用户已安装的 Claude/Codex/OpenCode 等；
- UI 清楚展示实际 sandbox、network、workspace 和 credential 权限；
- 每次安装/首次运行授权；
- 无法满足 Oey sandbox 时不能标记为 governed；
- 产物仍必须进入 Oey 的 materialize/build/render/quality/export 链。

这样既能获得 OpenDesign 的兼容速度，也不会用一个“Sandbox”开关掩盖不同保证级别。

### 6.5 隐私与遥测

OpenDesign 的 [`PRIVACY.md`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/PRIVACY.md#L7-L22) 写明：项目、生成文件、BYOK key 保持本地；但 product analytics/quality traces 默认开启、可退出，配置了 telemetry destination 的 build 中 safety/reliability telemetry 始终开启，普通 analytics toggle 不能关闭。

可选 content channel 可能包含 prompt、assistant response、tool input/output、prompt stack context 和附件/artifact manifest metadata；虽然会截断和清洗，仍属于高敏感设计工作数据。删除数据会轮换本地匿名 ID 并关闭可选 channel，但不会关闭 safety exception，也不会同步删除已收到的历史数据。见 [`PRIVACY.md`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/PRIVACY.md#L24-L62) 和[删除语义](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/PRIVACY.md#L103-L109)。

Oey 建议：

- 默认全关闭，首次明确 opt-in；
- safety telemetry 也提供真实总开关；
- prompt/tool/file content 独立、二次 consent；
- enterprise/offline build 在编译期不含 destination；
- UI 展示最后发送时间、类别、payload preview；
- evidence/rights/客户内容永不进入默认遥测；
- retention、删除和 processor 清晰可验证。

---

## 7. 数据、恢复、并发与交付可信度

### 7.1 OpenDesign 的持久化优势

OpenDesign 不是浏览器 localStorage demo。daemon 管理 SQLite、managed project workspace、conversation/message、文件版本、插件/automation/memory 等状态；`OD_DATA_DIR` 是统一数据根。folder import 是例外：它引用用户选择的外部 root，但后续文件操作仍受该 root containment 约束。参见 [`docs/architecture.md`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/architecture.md#L148-L162)。

它的工程价值在于：

- 页面 reload 不丢 project/conversation/file；
- CLI 与 UI 看到同一数据；
- managed 与 imported project 有清楚差别；
- project file 是可外部编辑的真实文件；
- run 有状态和事件记录；
- exporter、plugin、automation 有产品级落点。

### 7.2 OpenDesign 的恢复边界

但“有持久化”不等于“运行可跨崩溃继续”：

- 活跃运行由进程内 manager/map 控制；
- SSE replay 的快速路径依赖 memory ring；
- daemon 启动时把之前的非终态 run 转为 failed；
- 部分 CLI session id 可 resume，但 daemon 任务本身不会自动 reattach；
- 同一个 workspace 的并发写缺少强 lease/branch 隔离；
- process cancel/TERM/KILL 做得比 Oey 当前好，但 lifecycle manager 仍被项目自己列为未完成维护项。

这是一种诚实、合理的失败语义，优于假装继续；但它和 Oey 的目标“可恢复长流程”仍有距离。

### 7.3 Oey durable foundation 的优势

Oey 的 `SQLiteWorkflowRuntime` 已有：

- WAL、busy timeout、线程锁；
- 基于 project/kind/revision/idempotency key 的 run start；
- run/event/checkpoint durable table；
- pause/cancel/resume/query after sequence；
- recoverable stage runner；
- project revision optimistic check；
- command ledger；
- event after-sequence；
- side-effect lease/idempotency/reconcile；
- project mutation 和 command commit 的事务边界。

它比 OpenDesign 的 memory-first live run 更适合成为可恢复事实源。当前缺口是：它还不是后台 scheduler/process manager，AgentLoop 的 file/command/render action 也还没统一走 side-effect ledger。

### 7.4 正确的合并方向

```text
HTTP command
    ↓ validate expected project revision + idempotency key
Durable Run row (QUEUED)
    ↓ worker lease
Workspace snapshot / single-writer lease
    ↓
Sandboxed agent process / native provider loop
    ↓ durable RunEvent + SideEffectClaim per action
Checkpoint ───── crash ─────► resume or explicit child retry
    ↓
Artifact materialize
    ↓ build → render → quality → approval → export → delivery
    ↓
Immutable receipt bound to artifact/export revision
```

内存只做优化，不做真相；恢复不了的外部进程明确失败，但已有 event/effect/checkpoint 不丢，retry 是有 lineage 的新 child run。

### 7.5 Export：广度与可信度的取舍

OpenDesign 覆盖 HTML、ZIP、PDF、PPTX、Markdown、截图/image、MP4 等路径，部分 export 依赖 desktop host 或 agent skill，并有 capability-aware fallback。这是很强的产品优势。

但 Oey 的 Web export 链在保证级别上更强：

- source/build hash 绑定；
- deterministic archive order/timestamp/permission；
- manifest、CRC、逐文件 hash；
- 拒绝 traversal、symlink、duplicate、超限内容；
- 解包到新位置；
- 独立 Chrome 重渲染；
- runtime anchor、console/page/request、screenshot evidence；
- immutable publish + receipt + reconcile。

注意当前 screenshot equality 更接近 bytes hash 的 0/1 等价，而不是完善的 perceptual diff；后续应升级成可解释的 pixel/perceptual threshold，并保留 DOM/computed-style 双证据。

Oey 不应为了快速增加 PDF/PPTX 把这条链丢掉。正确做法是让每个 exporter 实现同一 contract：

```text
prepare → export → unpack/inspect → independent render/parse
       → quality gate → receipt → immutable publish
```

---

## 8. Skills、Templates、Design Systems、Plugins：生态是真的，但数字要去重

### 8.1 OpenDesign 的四个主要 extension plane

| Surface | 作用 | 典型内容 |
|---|---|---|
| Functional Skill | agent 工作方法/能力 | `SKILL.md`、prompt、工具要求 |
| Design Template | creation workflow 的渲染蓝图 | `SKILL.md`、模板资产 |
| Design System | 品牌规则 | `DESIGN.md`、tokens、components、assets、provenance |
| Plugin | 可安装、marketplace 化的 bundle | `open-design.json` + skill/template/system/pipeline payload |

另有 Craft 作为通用规则组合。这套分层能满足不同作者和分发场景，但用户和维护者很容易混淆“功能 skill”“渲染 template”“保存的 project template”“design-system mode”“design system 产品页”“plugin wrapper”。Oey 初期不需要这么多 plane。

### 8.2 做得好的 registry 机制

- user root 先于 bundled root；相同 id 可 shadow；
- listing request 时重扫，安装后无需重启；
- active bundles 被复制到项目 `.od-skills`，避免依赖全局 symlink；
- design system 可组合 usage、`DESIGN.md`、`tokens.css`、components、文件索引、craft、skill；
- remote import 有 private network、path traversal、link 等拒绝；
- plugin 有 manifest schema、capability、trust、snapshot、install/upgrade/uninstall；
- UI 与 `od` CLI 复用相同 API；
- `SKILL.md` 可被适配成 plugin manifest。

这些是非常可学的“文件系统协议 + registry”设计。Oey 可用不可变 revision、provenance 和 conformance test 把它做得更可信。

### 8.3 生态数字为什么不能简单相加

固定 commit 的真实目录拆解大致是：

- `skills/`：162 个 `SKILL.md`；
- `design-templates/`：114 个 `SKILL.md`；
- `design-systems/`：151 组 `DESIGN.md`；
- `plugins/_official/`：约 460 个 manifest；
- `plugins/community/`：约 10 个 manifest；
- official 分布约为 atoms 13、design-system wrappers 143、examples 183、image templates 45、scenarios 13、video 63。

但存在大量重叠：

- 114 个 design-template 中 113 个名称也出现在 official examples；
- 143 个 design-system plugin 是相同 design-system 内容的 marketplace wrapper；
- curated skill 中不少是 frontmatter + 简短说明 + 上游链接的 lightweight stub；项目自己的 [`skills/AGENTS.md`](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/skills/AGENTS.md) 明确允许这种形式；
- stub 会指导用户安装/复制上游资产，不代表原工作流已 vendored、可离线运行或经过同等质量验证；
- README 在不同位置出现 277 与 261 official plugins，tree/registry 口径又不同；
- 114 个 template、151 个 system、460 个 install manifest 是三个有价值的分发表面，但不能相加宣传成 725 个独立执行能力。

准确说法应是“广泛的可发现目录、可安装包装和品牌上下文”，而不是“每项都是独立、深度实现的 agent worker”。

### 8.4 Plugin pipeline 的实现真实性

运行时专项审计确认：plugin 安装、权限/trust、snapshot、pipeline timeline 和 SQLite 记账是真实实现；但固定快照 24 个 built-in atom 中，只有 `critique-theater` 产生可观察评分读取，其余 23 个是 permissive no-op/乐观执行形态。

这说明“编排控制面已实现”与“每个 atom 具备独立执行语义”必须分开描述。Oey 的 pipeline atom 应只有三态：

- `IMPLEMENTED_VERIFIED`
- `PROMPT_DELEGATED`
- `UNAVAILABLE`

不得以默认 `ok=true`、`user.confirmed=true` 或 manifest 存在来宣称执行成功。每个 atom 必须声明输入、输出、副作用、权限、证据、重试和 conformance。

### 8.5 Design system 的真正价值和风险

OpenDesign 已证明 `DESIGN.md` 是极好的传播与组合媒介：人可读、agent 可读、可版本化、可与 token/components 一起发布。Oey 应学习 package shape，但只先做 3–5 个黄金系统：

```text
design-system/
  manifest.json
  DESIGN.md
  tokens.css
  components/
  assets/
  provenance.json
  licenses/
  fixtures/
  evaluations/
```

每个必须记录：来源、抓取/审阅日期、权利与商标状态、版本、人工/生成、quality score、支持 artifact surface、已验证 exporter。

OpenDesign 大量品牌名称、字体、截图、tokens、同步生成物存在逐项 license/NOTICE/SBOM 压力。Apache-2.0 仓库许可证不能自动授予第三方商标、字体、截图和品牌视觉资产的权利。Oey 当前根目录甚至缺正式 LICENSE，更应在做 catalog 之前补齐治理。

### 8.6 Oey 的最小生态模型

P1/P2 建议先统一成一个 `CapabilityBundle`，用 `kind` 区分：

```text
CapabilityBundle
  id / version / kind
  instructions
  input_schema
  supported_surfaces
  required_tools
  required_network
  required_permissions
  assets
  provenance
  signatures
  conformance
  lifecycle: bundled | installed | disabled | quarantined
```

初期只提供：

- Design System；
- Creation Recipe（合并 functional skill + rendering template 的用户心智）；
- Tool Connector。

等真实作者和使用数据出现后，再拆 Marketplace、Plugin、Automation、Community，避免提前制造五套 registry。

---

## 9. Preview、编辑桥与 Artifact 模型

### 9.1 OpenDesign preview 的正确理解

File Workspace 使用 sandboxed iframe；HTML 可通过 daemon URL 或 `srcDoc`。inspect/comment/palette/edit/tweak 等 host bridge 需要 `srcDoc`。切换 render mode 时会同时保持 URL/srcDoc frame mounted，减少 reload flash；message handler 验证来源 frame 和 active window。

普通 `srcDoc` preview 主要允许 script/download；某些 powered preview 会加 `allow-same-origin`、popup、forms、modals、pointer-lock 等。每个 surface 的 capability 应单独审计，不能只看到 `<iframe sandbox>` 就判定同等安全。

### 9.2 OpenDesign 当前分类复杂度

`FileViewer.tsx` 已经要同时根据 project kind、artifact manifest、renderer、file kind、class/filename 和 host capability 推断：

- 用哪个 renderer；
- 是否可 preview；
- 是否可 inspect/comment/edit/present；
- 能导出什么；
- URL 还是 srcDoc；
- Web 还是 Desktop；
- fallback/error message。

这正是 17,815 行组件形成的原因之一。Oey 必须把决策前移到 daemon 的 manifest/capability projection。

### 9.3 推荐 ArtifactManifest

```json
{
  "schema_version": 1,
  "artifact_id": "art_...",
  "project_id": "prj_...",
  "surface": "web",
  "renderer": "html",
  "entry_file": "index.html",
  "source_revision": 7,
  "design_system_revision": 3,
  "generation_profile": "governed-filesystem",
  "capabilities": {
    "preview": "AVAILABLE",
    "source_edit": "AVAILABLE",
    "comment": "AVAILABLE",
    "inspect": "AVAILABLE",
    "present": "UNAVAILABLE",
    "exports": ["html", "zip", "pdf"]
  },
  "source_hash": "sha256:...",
  "provenance_refs": ["ctx_...", "ev_..."],
  "created_by_run": "run_..."
}
```

前端只渲染 projection，不猜规则。新增 deck/document/image renderer 时，扩展 manifest 和 exporter registry，不扩张一个全知 `FileViewer`。

### 9.4 Preview bridge 的安全规则

- 每个 frame 有不可预测 nonce；
- host 验证 `event.source`、origin/opaque-origin strategy、frame id、project/artifact/revision；
- bridge message 用 versioned schema；
- comment/inspect 可读，edit/tweak 是单独授权；
- preview 无法直接调用 daemon 高权限 API；
- file/network 请求由 broker 记录；
- `allow-same-origin` 必须逐 surface 论证；
- preview 权限与 agent process 权限完全分开显示。

---

## 10. 工程质量、测试、CI 与发布

### 10.1 OpenDesign 的工程投入是真实的

静态统计约有 1,499 个 test/spec 文件、15,555 个测试调用，daemon、web、desktop、packages、tools、e2e 都有大量测试。项目还有：

- contract/typecheck/guard；
- cross-app import boundary；
- packaged leaf boundary；
- route/DB/agent/SSE/critique/media/connector/filesystem tests；
- Playwright/UI/desktop/packaged smoke；
- macOS/Windows/Linux optional lane；
- Docker、Compose、Helm、Nix；
- installer/update/release workflows；
- issue/PR/release notes/metrics/contributor/landing 运维自动化。

这说明它不是“只有 stars 的 demo”。团队已经处理过启动失败、原生模块、sidecar、跨平台、release artifact 等真实问题。

### 10.2 测试门禁仍有洞

专项审计没有发现统一 coverage threshold/config。完整 non-visual UI 12-shard pool 主要由 `workflow_dispatch` 触发，部分 P0 文件不进入普通 merge lane；存在显式 skipped/todo，包括一些 DesignSystemFlow 和 Critique 分类。数量很强，不代表每个关键路径都成为 required merge gate。

OpenDesign 自己的维护路线图也承认 test pyramid、migration、process lifecycle、SSE、observability 仍不完整。这种透明度值得肯定。

### 10.3 发布速度与发布风险

2026-08-05 的 0.18.0、8 月 3 日的 0.17.0、7 月 23 日的 0.16.1 显示非常高的交付速度；0.18.0 带 team workspace 和 Codex plugin 等能力。历史 0.4.0 曾发生 packaged startup blocker，0.4.1 hotfix 增加 packaged boot acceptance gate。参见[公开 Releases](https://github.com/nexu-io/open-design/releases)。

正确解读是：

- 其 release machinery 和响应速度是竞争优势；
- 其产品变化快，文档、registry 数字、route placeholder 和实际实现会暂时漂移；
- 高速发布必须由 packaged boot、upgrade、migration、full UI health、回滚持续约束。

### 10.4 自动更新和供应链

OpenDesign 有 metadata、payload checksum、codesign/notarization 等流程，但专项审计未发现独立内置公钥/TUF/Sigstore 等价的 update authenticity 验证。Checksum 能检测传输损坏，不能在 metadata 与 payload 同一信任域被攻破时证明发布者真实性。

Oey 当前更早：

- `pyproject.toml` 版本 0.1.0；
- runtime dependencies 为空；
- 无 `.github` CI/release；
- 根 LICENSE 缺失；
- 没有安装器、自动更新、SBOM、签名和 channel matrix。

这不是现阶段的架构缺陷，但在任何外部发行前必须补齐。推荐最小 release gate：

1. Python 3.11/3.12/3.13 CI；
2. pytest、lint、type/static check；
3. Windows native Phase6 acceptance；
4. packaged install/boot/uninstall/upgrade smoke；
5. lock、SBOM、artifact hash；
6. platform code signing；
7. independent update metadata signature；
8. provenance attestation；
9. rollback 和 data migration backup test。

### 10.5 Oey 仓库卫生

当前 Oey 仓库包含大量 spike 输出、smoke materialization、round/result/log/evidence 文件，并且工作区已有大量既存改动。它们在研究阶段有价值，但会显著放大 code review、status、打包和 provenance 认知面。

建议把内容分为：

- source + small deterministic fixtures；
- immutable golden evidence，按 manifest 管理；
- local run outputs，默认不跟踪；
- release evidence，由 CI artifact/attestation 保存。

不要删除已有用户证据；应先制定迁移和保留策略。

---

## 11. 宣传、源码与成熟度核对

### 11.1 有强源码支撑的 OpenDesign 能力

- Next/React Web、Express daemon、Electron desktop/packaged sidecar；
- SQLite project/conversation/message/file 管理；
- 26 runtime definitions、并行探测和多种 stream parser；
- filesystem 与 text-artifact 两类 generation profile；
- chat/run SSE、cancel、watchdog、process group kill；
- File Workspace、sandbox iframe preview、多种 host bridge；
- 多种 export 路径；
- design system/skill/template/plugin registry；
- BYOK proxy、SSRF guard；
- Docker/self-host 形态；
- i18n locale 资产；
- 大规模测试和发布自动化。

### 11.2 有条件成立或容易被误读

| 声明/表象 | 源码级解释 |
|---|---|
| Local-first | 项目/文件/keys 本地成立；选择的 agent/provider 仍会访问外部服务，telemetry 也可能发送 |
| Sandboxed | preview iframe 有 sandbox；agent process 不是统一 OS sandbox |
| 25 CLIs | definition/exec 广度真实，但 resume/MCP/image/auth/tool/file 能力不对称 |
| 100+ skills | registry 真实，但许多 curated entry 是轻量 stub/上游入口 |
| 151 design systems | 上下文/资料包真实，不等于品牌官方组件 SDK 或授权认证 |
| 460 official plugin manifests | install/discovery 包装真实，不等于 460 个独立 worker |
| Multi-agent critique | 多 persona/role 在单 CLI 流内运行，不是通用 child-agent scheduler |
| Run recovery | 能保存终态和 session 信息；daemon 重启时 active run 不会透明续跑 |
| Pipeline implemented | 调度/记录真实；23/24 built-in atom 缺独立可观察 worker |
| Self-host/team | 可部署和团队 shell 不等于完整多租户、HA、企业 RBAC/identity isolation |

### 11.3 明确漂移、隐藏或占位

- `Library` 功能代码存在，但 `LIBRARY_UI_VISIBLE = false`；
- `members`、`board`、`workspace-settings` 在固定快照仍渲染 placeholder；
- `collab-demo` route 注释明确 demo identity/visibility 尚未完全接入；
- README 同时出现 277 与 261 official plugin 数字，tree/registry 又有其他口径；
- README 一处仍把 PPTX 写作 agent-driven，而当前 runtime export 已有 screenshot/programmatic 路径；
- README roadmap 的部分旧未完成项与当前代码/发布状态并不同步；
- 一些组件定义但没有稳定消费者，部分文案仍硬编码。

这类漂移在高速项目中正常，但 Oey 应从一开始自动生成 capability/status 文档，避免 README 成为第二真相源。

### 11.4 Oey 自身也有文档漂移

根 README 第 10–13 行仍写 Phase 6 是 scaffold、real repository/agent/renderer/provider 为 follow-up；Phase6 README 已明确 2026-08-04 首个真实纵切完成。建议立即把根 README 改成：

- Phase 6 first vertical slice complete；
- P6.6 fault injection 和 external UAT pending；
- product shell 尚未接入完整 agent studio；
- Windows native governed mode 可用范围；
- 当前 supported artifact/export。

本报告只提出修正文案建议，没有修改这些既存用户文件。

---

## 12. 全维度对比矩阵

| 维度 | OpenDesign | OeyDesign | 谁领先 / 为什么 |
|---|---|---|---|
| 产品主链 | 已闭合 Project→Conversation→Run→Files→Preview→Export | 后端纵切真实，UI/control plane 未接 | OD |
| 用户心智 | 清楚的 AI 创作 IDE | proof desk 偏内部状态机 | OD |
| 创建 surface | Web/mobile/deck/live/media/other | Web 首片 | OD，Oey 不应立刻追宽 |
| Agent 广度 | 约 25 CLI executable + BYOK | Kimi concrete + native loop | OD |
| Agent 可控性 | 委托外部 CLI，能力/权限异构 | action schema、预算、完成门可控 | Oey 潜力更强 |
| Stream | 多协议统一事件、SSE | provider 累计后返回，无产品流 | OD |
| 进程管理 | cancel/watchdog/process group | sandbox 同步执行，无 run service | OD |
| Durable run | JSON/JSONL + memory live state | SQLite run/event/checkpoint | Oey 底座 |
| 崩溃续跑 | active run 转 failed，部分 CLI session resume | durable stage 可恢复，agent 未接 | 两边都未完整，Oey 架构更合适 |
| 并发写 | 同 cwd 可能竞争 | 尚无并发调度 | 两边都需 lease/snapshot |
| 幂等副作用 | 感知副作用后限制 retry | command/side-effect ledger/reconcile | Oey |
| Tool/MCP | scoped token、MCP 注入但 adapter 不对称 | 内部 dispatcher，无 MCP | OD 产品化领先 |
| Preview 安全 | iframe/bridge 防线好 | 空 sandbox srcdoc + trusted renderer | 各有优势；Oey renderer 证据强 |
| Agent OS isolation | 默认依赖 CLI，常 bypass/danger | AppContainer + Job + fail closed | Oey，限 Windows |
| Public API 安全 | token/origin/host/SSRF 较成熟 | loopback 小攻击面，public 模型未建 | OD |
| Artifact | 多表面、manifest/heuristic 混合 | Web contract 清楚、source hash 严 | 广度 OD，严谨 Oey |
| Export | 格式广、fallback 成熟 | Web ZIP + 独立重渲染/receipt | 广度 OD，可信度 Oey |
| Quality | prompt self-check/critique/lint | Chrome/computed/export evidence gate | Oey |
| Evidence/provenance | 有 bundle provenance、项目引用较弱 | Context/Evidence lineage/rights/confidence | Oey |
| Revision/approval | 有 file/version/编辑路径 | aggregate revision + approval 精确绑定 | Oey |
| Design systems | 151、产品页、抽取/选择 | 4 visual territories、严格 token | 生态 OD，验证 Oey |
| Plugin/marketplace | 真 registry/安装，执行深度不一 | 无 | OD |
| Desktop | macOS/Windows/Linux lane | 无产品化 desktop shell | OD |
| Docker/self-host | 已有 | 无 | OD |
| i18n | 19 locale 文件、广泛 t() | 中文 proof UI，无系统 i18n | OD |
| a11y | 有实践和测试但超大 UI 有缺口 | 小 UI 基线，真实 E2E 不足 | OD 当前领先 |
| 测试规模 | 约 1,499 文件/15,555 调用 | 69 pass/2 skip | OD |
| 测试确定性 | 大而有 merge-lane 缺口 | 小而 contract-focused | 不同阶段 |
| 类型/模块 | TS contract 在迁移，核心 nocheck/巨石 | Python 模块小、契约清楚 | Oey |
| 发布/更新 | 多平台 release 成熟，真实性链可加固 | 未建立 | OD |
| 隐私默认 | optional opt-out + always-on safety | 无 telemetry，未经历运营验证 | Oey 目前更保守 |
| 许可证 | Apache-2.0，但品牌资产治理压力 | 根 LICENSE 缺失 | OD 基础好；两边都有待补 |
| 社区/增长 | 高 stars、强内容/发布运营 | 尚未形成 | OD |

---

## 13. Oey 应当直接学习什么

### 13.1 产品层

1. 两栏 Studio：Chat/Run + Artifact Workspace；
2. brief → material question → run → file → preview → feedback → export 的连续主链；
3. 文件是真实交付物，BYOK artifact 最终也物化为文件；
4. question form 只问 material ambiguity、最多 5 个、有建议默认；
5. Todo/progress/tool/file/error 都流式可见；
6. preview/source/files/evidence 在同一 workspace；
7. comment/draw/inspect/manual edit 进入稳定 anchor/revision；
8. capability-aware export 和清楚的 degraded reason；
9. Web/Desktop 共产品树、host capability 分层；
10. onboarding 先探测可用 agent/model/provider，再让用户开始。

### 13.2 架构层

1. daemon 单一业务权威；
2. UI、CLI、MCP/automation 共享版本化 HTTP API；
3. HTTP snapshot + SSE events；
4. agent adapter 使用 data spec + generic engine；
5. runtime detection 并发、fault-isolated、探测与实际 launch path 一致；
6. capability matrix，而不是 adapter 名称分支；
7. desktop trusted picker + short-lived HMAC；
8. run-scoped tool token；
9. user bundle shadow precedence 和 request-time discovery；
10. packaged boot 作为 release acceptance。

### 13.3 工程/运营层

1. 跨 app import guard 和 contract boundary；
2. CI path scope + nightly/full fallback；
3. desktop/package/e2e/release 的真实 smoke；
4. issue、release notes、troubleshooting、operational docs 版本化；
5. capability/status 从 registry 生成；
6. 分发入口：desktop、CLI、MCP、Docker，但按阶段建设；
7. i18n 从一开始使用 key，不积累硬编码；
8. 模板/设计系统有 source、license、provenance 和评价。

---

## 14. Oey 不应照搬什么

1. **不默认 `bypassPermissions` 或 `danger-full-access`。** 外部 CLI 兼容必须显式标级别。
2. **不把 HOME/XDG 重映射叫完整 sandbox。** 文案必须区分 data isolation、preview sandbox、process sandbox。
3. **不把 active run 真相只放内存。** SQLite event log 是权威，ring 仅缓存。
4. **不让两个 run 直接写同一 cwd。** 用 lease、snapshot/branch、optimistic merge。
5. **不复制 10k–18k 行中枢文件。** 按 domain slice 拆组件和 service。
6. **不在安全/路由/CLI 核心使用长期类型抑制。** 边界必须 runtime validate。
7. **不先做四五套 extension plane。** 先统一 bundle，再由真实需求分化。
8. **不把 wrapper、translation、stub、template 相加成独立能力数。** 对外数字自动去重并标深度。
9. **不把 prompt self-critique 当唯一 quality gate。** 继续真实 renderer/computed/export evidence。
10. **不把 pipeline 默认值当成功。** 未执行就是 unavailable/prompt-delegated。
11. **不默认采集 telemetry。** 不用“删除 ID”替代删除历史数据。
12. **不把 checksum 当 update authenticity。** 需要独立签名信任根。
13. **不在主链未闭合前追 Video/Audio/Team/Marketplace。** 页面数不是当前胜负手。
14. **不大量打包品牌资产后再补授权。** provenance/license/trademark 必须前置。
15. **不把 Docker 部署等同企业能力。** 多租户、RBAC、HA、KMS、审计/驻留是独立工作。

---

## 15. 推荐的 Oey 目标架构

### 15.1 领域模型

```text
Workspace
└─ Project (aggregate revision)
   ├─ Conversation
   │  ├─ Message
   │  └─ Run
   │     ├─ RunEvent
   │     ├─ Checkpoint
   │     ├─ SideEffectClaim
   │     └─ ContextAttachment
   ├─ Artifact
   │  ├─ ArtifactManifest
   │  └─ FileVersion[]
   ├─ DesignSystemRevision
   ├─ ConstraintProfile
   ├─ Feedback[]
   ├─ QualityDecision
   ├─ Approval (revision-bound)
   ├─ ExportReceipt
   └─ DeliveryReceipt
```

保留现有 Project revision 作为 aggregate optimistic concurrency；Conversation、Run、Artifact、FileVersion 各自有 identity/version。所有 mutation 都有 command id、expected revision、actor、timestamp、reason、event sequence。

### 15.2 服务拓扑

```text
Web / Desktop shell / CLI / MCP
              │
              ▼
Oey API daemon
  ├─ Project/Conversation/Run API
  ├─ durable event stream (SQLite + SSE)
  ├─ Context/Evidence service
  ├─ Artifact/File service
  ├─ Capability/Bundle registry
  ├─ Quality/Approval/Export/Delivery
  └─ Run orchestrator
       ├─ Governed native adapter → OS sandbox → trusted brokers
       ├─ Structured external CLI adapter → declared permission mode
       └─ BYOK text artifact adapter → host materializer
```

### 15.3 前端切片

```text
features/project-shell
features/conversations
features/runs
features/artifacts
features/file-workspace
features/preview
features/feedback
features/context-evidence
features/quality-approval
features/export-delivery
features/execution-profiles
features/capability-bundles
platform/web
platform/desktop
ui/primitives
```

`App` 只装配 routes/providers。`ProjectShell` 不认识具体 provider/exporter；`ArtifactViewer` 不推断业务类型；Settings 按 account/runtime/privacy/system 拆分；feature 自带 contract adapter、state reducer/query、components 和 tests。

### 15.4 Run 状态机

```text
QUEUED
  → PREPARING
  → NEEDS_INPUT ── answer ──► PREPARING
  → RUNNING
  → MATERIALIZING
  → BUILDING
  → RENDERING
  → VERIFYING
  → WAITING_APPROVAL
  → EXPORTING
  → DELIVERED

任一执行态：
  → CANCELING → CANCELED
  → FAILED_RETRYABLE → child retry
  → FAILED_FATAL
  → FAILED_UNCERTAIN_EFFECT → RECONCILING
```

每个 terminal 和 retry transition 都产生 durable event；timeout 不得用半成品伪装成功。

### 15.5 质量层

质量分三层，不能混用：

1. **Contract checks**：schema、manifest、路径、版本、hash、完整性；
2. **Deterministic render checks**：Chrome、console/page/request、anchor、overflow、contrast、computed style、responsive、export rerender；
3. **Semantic/design review**：模型 critique、brand fit、信息层级、内容准确性，需要 evidence/评分/人工批准。

模型自评只能属于第 3 层辅助信号，不能覆盖前两层硬失败。

---

## 16. 分阶段路线图

### P0：0–30 天——把真实底座接成最小可用产品

**目标：一个用户可以从 brief 开始，经真实 agent 生成 HTML 文件，预览、反馈、批准、导出，重启后状态仍一致。**

交付：

1. 更新根 README，准确区分 Phase6 backend closure 与 product UI gap；
2. 冻结 `Project/Conversation/Message/Run/RunEvent/Artifact/FileVersion` v1 contract；
3. 用 SQLite runtime 实现异步 `RunService`、worker lease、durable event log；
4. `POST /runs`、`GET /runs/:id`、`POST /cancel`、SSE + `Last-Event-ID`；
5. 将现有 Kimi/native AgentLoop 接入第一个 adapter；
6. 一个 OpenAI-compatible text artifact adapter；
7. 两栏 Studio：Chat/Run + Preview/Source/Files；
8. `<question-form>` → durable `NEEDS_INPUT`；
9. HTML materialize、build、trusted render、quality、approval、ZIP/export receipt 全接通；
10. workspace 单写 lease；
11. Agent action 接 side-effect claim/reconcile；
12. 明确 Governed / External Compatibility mode UI；
13. 根 LICENSE、第三方政策、基础 CI；
14. browser E2E 覆盖完整 happy path 和 reload recovery。

P0 不做：Marketplace、Community、Team Board、Video、Audio、通用 Browser/Terminal、20+ agents。

**P0 退出门：**

- 一条真实任务端到端完成；
- 任何状态可从 SQLite 重建；
- SSE 断线/重连不丢不重；
- 同 revision 双写被 lease/revision 拒绝；
- cancel 在 provider、command、render 阶段可传播；
- 未批准 revision 无法 export/deliver；
- export 解包重渲染通过；
- unauthorized FS/network 测试为零容忍；
- Windows packaged boot smoke 通过；
- README capability 与 registry 自动一致。

### P1：31–90 天——把工作台做成真正好用

1. 引入 Codex 或 Claude structured CLI adapter；
2. adapter capability/readiness UI：auth、model、resume、image、MCP、sandbox、network；
3. run-scoped tool gateway/token；
4. provider 增量 stream、abort、401/403 fatal、429/5xx bounded retry；
5. inspect/comment/draw/local edit 绑定 stable anchor/revision；
6. Artifact/File version history 与 restore；
7. Web responsive viewport、source/manual edit；
8. HTML/ZIP/PDF 三个真实 exporter；
9. Context/Evidence 直接显示在工作台；
10. 3–5 个黄金 Design System/Creation Recipe，每个有 fixture、provenance、license、quality；
11. desktop thin host：trusted folder picker、open path、offscreen export；
12. P6.6 fault injection matrix 和外部用户验收；
13. fake CLI replay harness、process kill/restart、malformed stream、concurrent workspace tests；
14. i18n key 化、keyboard、skip link、reduced motion、screen reader E2E。

**P1 退出门：**

- 三种 execution profile 的 conformance 全通过；
- 90% 支持场景用户无需手改即可导出；
- crash/retry lineage 可审计；
- comment 精确命中原 revision/anchor；
- Web/Desktop capability 差异有自动测试；
- 所有 bundle 安装有来源、权限、hash 和可撤销状态。

### P2：91–180 天——扩大表面但保持可信

1. Deck surface：slide manifest、present、PDF/PPTX；
2. Document/Report surface：Markdown/HTML/DOCX/PDF，作为差异化一等能力；
3. image generation 作为 Web/Deck/Document 的内容工具，再决定是否独立 Media tab；
4. macOS/Linux sandbox adapter：Seatbelt、Landlock/seccomp/container 等，经 conformance 后开放 governed；
5. CapabilityBundle registry、import/install/upgrade/disable/quarantine；
6. plugin permission diff、signature、revocation/kill switch；
7. signed installers、SBOM、attestation、independent updater authenticity；
8. 可选 Docker/headless，但只承诺 single tenant；
9. design evidence benchmark 和盲评；
10. 小型、经审核的 registry，不以数量为 KPI。

### P3：主链和信任指标稳定之后

1. 只读分享、comment collaboration；
2. owner/editor/viewer 与 conflict resolution；
3. repeatable task/automation；
4. marketplace/community；
5. enterprise OIDC/RBAC/KMS/audit export/data residency；
6. Video/Audio/HyperFrames 等高成本 surface。

---

## 17. 建议的对照实验与验收基准

不要用“生成一个好看的 landing page”做唯一 benchmark。建议对 OpenDesign 与 Oey 使用相同机器、相同模型、相同输入和资产，记录完整事件和产物。

### 17.1 任务集

| 编号 | 任务 | 检验目标 |
|---|---|---|
| B1 | 信息完整的 SaaS landing page | 首次 preview 时间、无追问直接启动、视觉质量 |
| B2 | 故意缺品牌/受众/CTA 的 brief | 是否只问 material question、默认是否合理 |
| B3 | 有 DESIGN.md 的现有 React repo 改版 | repository ingestion、最小改动、真实组件复用 |
| B4 | dashboard + supplied CSV/reference images | evidence lineage、事实准确、数据使用 |
| B5 | 对具体按钮做 comment/draw/local edit | anchor 精度、revision 稳定、局部改动范围 |
| B6 | agent 运行中 kill daemon/CLI | durable events、状态分类、恢复/重试 lineage |
| B7 | prompt 诱导读取 workspace 外 secret/访问网络 | 权限边界、audit、阻断率 |
| B8 | export 后篡改 ZIP/路径/资源 | integrity、safe extract、独立 rerender |
| B9 | provider 返回 401、429、partial JSON、hung stream | error taxonomy、retry、cancel、timeout |
| B10 | 两个 run 同时改同一 revision | lease、冲突、merge、无 silent overwrite |
| B11 | PDF/PPTX/Document 导出 | 格式可用性和 source revision 绑定 |
| B12 | 安装一个高权限 bundle/plugin | 权限 disclosure、强制、撤销、snapshot |

### 17.2 指标

**效率：**

- time to first usable preview；
- time to approved artifact；
- model/tool turns；
- token/cost；
- manual repair time；
- cancel latency。

**质量：**

- blind design rubric score；
- responsive/a11y/overflow/console error；
- factual correctness；
- brand token adherence；
- localized edit precision；
- export visual/structural equivalence。

**可信度：**

- unauthorized write/network attempts blocked；
- crash recovery success；
- duplicate side effects；
- event gaps/duplicates；
- artifact/source/export revision mismatch；
- provenance completeness；
- deterministic rebuild/export rate。

**产品：**

- onboarding success；
- first task completion；
- question abandonment；
- preview-to-approval conversion；
- export success；
- 7/28-day return；
- bundle install-to-use conversion。

### 17.3 评分原则

- README 声称支持但当前环境 unavailable，记为 degraded，不记完全成功；
- 模型口头说“已检查”不算质量通过；
- 文件存在不等于 artifact 可 render/export；
- daemon 重启后标 failed 是诚实失败，不当作续跑成功；
- 用户手工修复后的结果与一键结果分开；
- catalog item 被发现、安装、执行、产生合格结果是四个不同指标；
- 所有结果保存 prompt/model/version/commit/machine/permission profile，才能复现。

---

## 18. 北极星指标与防虚荣指标

### 18.1 Oey 建议北极星

> 每周“从真实 brief 到经过批准并成功导出的可信 artifact”数量。

它同时要求产品被使用、agent 真运行、质量门通过、用户批准、export 成功，比 stars、注册数、模板数更接近价值。

### 18.2 支撑指标

- 首次 usable preview P50/P95；
- approved export success rate；
- crash/restart recovery rate；
- deterministic rebuild/export rate；
- zero unauthorized FS/network incident；
- feedback anchor hit rate；
- manual patch-free completion rate；
- evidence/provenance completeness；
- provider/adapter conformance pass rate；
- bundle install success 和首次真实使用率；
- packaged crash-free sessions；
- privacy opt-in rate与实际发送透明度。

### 18.3 不应作为主要 KPI

- 仓库文件/目录数；
- design system/template/plugin manifest 总数；
- 支持 agent 名称数；
- 生成 artifact 数但不看批准/导出；
- 模型自评通过率；
- GitHub stars 单值；
- 页面/route 数；
- 测试 case 数但不看关键 gate 覆盖。

---

## 19. 风险登记与优先级

| 风险 | 概率 | 影响 | 当前侧重 | 缓解 |
|---|---:|---:|---|---|
| 为追竞品宽度稀释核心主链 | 高 | 高 | Oey | P0 明确禁区，只有 exit gate 后扩面 |
| 外部 CLI 绕过安全优势 | 高 | 极高 | Oey | 双模式、显式权限、governed 不可降级 |
| AgentLoop 与 ledger 未接导致不确定副作用 | 中高 | 高 | Oey | action 前 claim、事务 commit、reconcile |
| Windows-only 限制采用 | 高 | 高 | Oey | P2 平台 sandbox conformance，不做危险 fallback |
| proof desk 与真实 backend 长期分裂 | 高 | 高 | Oey | P0 统一 daemon/composition root |
| 根 README/phase 文档漂移 | 高 | 中 | Oey | capability/status 生成、发布检查 |
| 缺 CI/license/release 影响外部信任 | 高 | 高 | Oey | P0 补根基，发行前签名/SBOM |
| OpenDesign 生态数字诱导错误投资顺序 | 高 | 中 | 决策 | 以成功执行/留存而非目录数 benchmark |
| 品牌/字体/截图授权 | 中高 | 高 | 双方 | 逐项 provenance/license/trademark matrix |
| 大组件/daemon 巨石导致回归 | 已发生 | 高 | OpenDesign 借鉴 | Oey feature slice + complexity budget |
| telemetry 伤害本地优先信任 | 中 | 高 | 双方 | 默认关闭、总开关、payload preview |
| updater 同信任域被攻破 | 低中 | 极高 | 发行 | 独立签名/TUF/Sigstore、signer identity |

---

## 20. 最终建议：具体做与不做

### 现在就做

1. 把 Oey 已有 Phase6 真实能力接进一个新的两栏 Studio；
2. 建 durable RunService + SSE，而不是再写一个同步 demo；
3. 让 AgentLoop action 使用 side-effect ledger 和 workspace lease；
4. 加 question form 和 `NEEDS_INPUT`；
5. 用一个 native/Kimi、一个 structured CLI、一个 BYOK profile 验证 adapter；
6. 对每个执行 profile 显示真实权限级别；
7. 保留并展示 evidence、quality、approval、export receipt；
8. 补 CI、LICENSE、发布最小信任链；
9. 用 3–5 个黄金 Design System/Recipe 建评测，不做 100+ catalog；
10. 用 B1–B12 benchmark 定期对照 OpenDesign。

### 暂时不做

1. fork/换皮 OpenDesign；
2. 复制其巨型组件或 daemon server 组织方式；
3. 追 25 个 CLI；
4. 追 460 plugin manifest；
5. 先做 Team/Community/Marketplace；
6. 先做 Video/Audio；
7. 以 prompt critique 代替 hard quality gate；
8. 为兼容性关闭 AppContainer 而不告知用户；
9. 以目录数、stars 或 route 数判断竞争胜负。

### 最终决策

**不建议 fork OpenDesign。建议把它作为产品 UX、adapter control plane、分发与运维的成熟参考实现；用 Oey 自身契约重新实现关键模式。**

如果只能选一个战略动作：

> 以 Oey 的 SQLite runtime 为真相源，实现异步 Agent RunService，把现有 AgentLoop 接为第一个 governed adapter，再把真实 Conversation → Run → Artifact/File → Preview → Quality → Approval → Export 主链放进两栏 Studio。

这个动作会同时缩小产品差距，并保住 OpenDesign 最难快速复制的 Oey 优势：权限、恢复、证据和交付可信度。

---

## 21. 关键证据索引

### 21.1 OpenDesign 架构/产品

- [仓库主页与公开产品定位](https://github.com/nexu-io/open-design)
- [Releases 与版本节奏](https://github.com/nexu-io/open-design/releases)
- [`docs/architecture.md`：runtime shapes、拓扑、所有权](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/architecture.md#L18-L110)
- [`docs/architecture.md`：registry、data root、preview](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/architecture.md#L126-L173)
- [`docs/architecture.md`：两种 generation profile、HTTP/SSE](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/architecture.md#L175-L226)
- [`docs/modes.md`：UI creation surface 与 skill mode](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/modes.md#L5-L90)
- [`apps/web/src/router.ts`：routes 与 team/collab 注释](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/web/src/router.ts#L13-L174)
- [`apps/web/src/components/EntryShell.tsx`：team placeholder](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/web/src/components/EntryShell.tsx#L1791-L1877)
- [`apps/web/src/features/libraryUi.ts`：Library hidden flag](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/web/src/features/libraryUi.ts#L1-L3)

### 21.2 OpenDesign Agent/Runtime

- [`docs/agent-adapters.md`：委托整个 agent loop 的战略](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/agent-adapters.md#L5-L17)
- [`docs/agent-adapters.md`：data-spec adapter 和 generic engine](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/agent-adapters.md#L19-L69)
- [`docs/agent-adapters.md`：adapter catalog](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/agent-adapters.md#L133-L150)
- [`apps/daemon/src/prompts/discovery.ts`：material question form](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/prompts/discovery.ts#L25-L93)
- [`packages/plugin-runtime/src/adapters/agent-skill.ts`：SKILL adapter 和 deferred parameter](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/packages/plugin-runtime/src/adapters/agent-skill.ts#L36-L77)

### 21.3 OpenDesign 安全/隐私

- [`docs/architecture.md`：folder picker HMAC 和 security boundaries](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/architecture.md#L228-L261)
- [`sandbox-mode.ts`：默认关闭](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/sandbox-mode.ts#L37-L49)
- [`sandbox-mode.ts`：目录和环境重映射](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/sandbox-mode.ts#L106-L194)
- [`claude.ts`：bypassPermissions](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/runtimes/defs/claude.ts#L52-L88)
- [`codex.ts`：Windows/WSL danger-full-access 条件](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/runtimes/defs/codex.ts#L116-L127)
- [`codex.ts`：实际 sandbox/network argv](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/runtimes/defs/codex.ts#L187-L227)
- [`runtimes/env.ts`：保留 inherited CLI environment](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/apps/daemon/src/runtimes/env.ts#L28-L49)
- [`PRIVACY.md`：local-first 与两类 telemetry](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/PRIVACY.md#L7-L35)
- [`PRIVACY.md`：content 和 always-on diagnostics](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/PRIVACY.md#L37-L62)
- [`PRIVACY.md`：删除语义](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/PRIVACY.md#L95-L109)

### 21.4 OpenDesign 工程/生态

- [`maintainability-roadmap.md`：P0/P1 风险](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/specs/current/maintainability-roadmap.md#L29-L48)
- [`maintainability-roadmap.md`：partial/planned workstreams](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/specs/current/maintainability-roadmap.md#L50-L79)
- [`docs/skills-protocol.md`：skills 协议与 discovery](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/docs/skills-protocol.md)
- [`skills/AGENTS.md`：curated lightweight stubs 规则](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/skills/AGENTS.md)
- [`README.md`：plugin 数字和结构](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/README.md#L472-L546)
- [`README.md`：架构、export、roadmap 数字](https://github.com/nexu-io/open-design/blob/4e47119edb47e235ec0893bfca1210f8f32af436/README.md#L550-L618)

### 21.5 OeyDesign 当前源码

- [`README.md`：仍停留在 scaffold 的根级说明](../../README.md)
- [`docs/phase6/README.md`：真实纵切、冻结边界、剩余 P6.6](../phase6/README.md)
- [`docs/prd.md`：产品方向](../prd.md)
- [`product-client/index.html`：当前 proof desk](../../product-client/index.html)
- [`product-client/app.js`：revision refresh、activity、sandbox preview、commands](../../product-client/app.js)
- [`src/oeydesign/runtime.py`：durable workflow/event/checkpoint/recovery](../../src/oeydesign/runtime.py)
- [`src/oeydesign/persistence.py`：revision、command、event、side-effect ledger](../../src/oeydesign/persistence.py)
- [`src/oeydesign/agent_engine.py`：session、budget、turn/action loop](../../src/oeydesign/agent_engine.py)
- [`src/oeydesign/capabilities.py`：capability registry 与 Kimi adapter](../../src/oeydesign/capabilities.py)
- [`src/oeydesign/sandbox.py`：fail-closed native sandbox contract](../../src/oeydesign/sandbox.py)
- [`src/oeydesign/_windows_appcontainer.py`：Windows AppContainer/Job 实现](../../src/oeydesign/_windows_appcontainer.py)
- [`src/oeydesign/artifact.py`：artifact、deterministic export、safe extract/rerender](../../src/oeydesign/artifact.py)
- [`src/oeydesign/renderer.py`：trusted Chrome render evidence](../../src/oeydesign/renderer.py)
- [`src/oeydesign/quality.py`：quality gate](../../src/oeydesign/quality.py)
- [`src/oeydesign/publisher.py`：immutable publish/receipt/reconcile](../../src/oeydesign/publisher.py)
- [`src/oeydesign/phase6.py`：八槽 composition root](../../src/oeydesign/phase6.py)

---

## 22. 审计结语

OpenDesign 最值得尊重的地方，是它把一个很容易停留在概念演示的“AI 设计 Agent”真正推进到了本地 daemon、多种 Coding Agent、多平台 desktop、真实文件、预览编辑、多格式导出、生态目录、CI/发布和增长运营阶段。它证明了用户愿意把设计工具理解为“会话 + 文件 + 预览 + 品牌 + 交付”的 agent-native workspace。

它最昂贵的代价也已经写在源码里：核心巨石、类型抑制、异构 CLI 权限、active run 恢复缺口、生态包装率、遥测默认、品牌授权和高速发布下的文档漂移。

OeyDesign 当前更早，但不是没有筹码。它已经拥有竞品相对薄弱的 revision/evidence/recovery/sandbox/quality/delivery 契约。真正的风险不是“底层不够”，而是继续让这些能力停在分散的 Phase 证明和 proof desk 中，迟迟没有变成用户能感知的完整工作流。

下一阶段应坚持“少而真”：先闭合一个能用、能恢复、能证明、能安全导出的 Web 设计任务；再用相同 contract 扩展 agent、surface 和生态。这样 Oey 学到的是 OpenDesign 的产品化与分发能力，同时避开它最难偿还的技术债。
