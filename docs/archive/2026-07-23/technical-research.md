# Design Agent 技术与开源产品调研

> 归档状态：本研究保留为 2026-07-23 的决策依据；当前正式架构以 `docs/architecture.md` 与 `docs/spec/` 为准。

调研快照：2026-07-23

## 1. 执行结论

这个产品在技术上可实现，但不能把它做成“一个大模型提示词 + HTML 模板库”。PRD 中真正有竞争力的部分是四个闭环：

1. 从模糊需求、项目仓库和杂乱参考资料中形成可确认的设计意图。
2. 将内容、风格、素材和事实来源变成可追踪的结构化项目状态。
3. 对 Web、PPT、DOCX 使用不同的专业渲染器，同时共享上层内容和设计系统。
4. 通过真实渲染、确定性检查、视觉模型评审和用户局部反馈持续修复，而不是一次性生成。

目前没有单一开源项目覆盖全部需求。最合理的实现不是完整 fork 某一个项目，而是组合其成熟机制：

| 能力 | 首选参考或依赖 | 采用方式 |
|---|---|---|
| 产品工作台、agent adapter、预览、版本、导出 | [Open Design](https://github.com/nexu-io/open-design) | 复用协议和部分模块，不能直接作为多租户后端 |
| Web 源码与画布对象映射 | [Onlook](https://github.com/onlook-dev/onlook) | 借鉴稳定对象 ID、AST 定位和 Git checkpoint |
| 结构化视觉编辑和 agent tools | [OpenPencil](https://github.com/open-pencil/open-pencil) | 借鉴 scene graph、typed tools、undo integration |
| Web 生成与浏览器运行时 | [bolt.diy](https://github.com/stackblitz-labs/bolt.diy) | 借鉴工作台和 action runner，不采用 XML action 作为核心协议 |
| PPT 规划、生成和视觉反思 | [PPTAgent / DeepPresenter](https://github.com/icip-cas/PPTAgent) | 深度借鉴 inspect-render-reflect 和 HTML/PPTX 转换经验 |
| 设计系统可读协议 | [design.md](https://github.com/google-labs-code/design.md) | 扩展为 StyleProfile 基础，不作为完整 Artifact IR |
| 文档解析和证据结构 | [Docling](https://github.com/docling-project/docling) | 作为默认文档解析器，原生 OOXML 解析仍需补充 |
| 安全执行 | [E2B](https://github.com/e2b-dev/E2B) 或同等级 microVM 沙箱 | MVP 使用托管沙箱，规模化后再评估自建 |
| 模型抽象和 UI stream | [AI SDK](https://github.com/vercel/ai) | 作为 TypeScript 模型边界 |
| 长任务恢复 | [Workflow SDK](https://github.com/vercel/workflow) | 作为 durable workflow，不把 chat history 当任务状态 |

推荐总原则：

> 共享 `ContentGraph + AssetManifest + StyleProfile + DesignBrief`，分别编译为 `WebProject`、`DeckIR`、`ReportIR`。不要强行让 HTML、PPTX、DOCX 或一个通用 Canvas 成为所有产物的唯一真源。

## 2. 对 PRD 的技术解读

PRD 可以归纳成七类系统能力：

| PRD 意图 | 技术含义 |
|---|---|
| 强设计能力、必须好看 | 需要设计规划、候选方向、约束布局、渲染评分和可回归的质量门，不只是更强模型 |
| 兼容各种模型 | 需要 capability-based model registry，而不是把业务状态绑定到 OpenAI/Anthropic 消息格式 |
| 左聊右预览、设置可视化 | 需要持久化工作区、事件流、对象选择、局部编辑、版本和任务状态 |
| Web、PPT、Docs | 需要三个专业 Artifact IR 和 exporter，共享内容图、素材、风格和 provenance |
| 多模态参考物 | 需要原始文件保存、原生结构提取、OCR/VLM、去重聚类、来源定位和权限标签 |
| 模糊意图和主动追问 | 需要 clarification gate、结构化 brief 和 workflow interrupt |
| 生图、风格模仿 | 需要素材规划、模型调度、风格 token、构图规则、版权和生成来源记录 |

这个产品不是普通聊天应用。一次任务可能持续数十分钟，期间包含上传解析、研究、追问、生成图片、运行代码、渲染、批评、重试、审批和导出，因此必须是可恢复 workflow。

## 3. 市场和产品基线

商业产品已经把以下体验变成基线：

1. 生成前追问受众、目标、内容范围、风格和交付格式。
2. 先展示大纲或多个方向，再进行高成本生成。
3. 聊天、结构树、画布或预览同时存在。
4. 支持截图、URL、文档、品牌资产和代码仓库作为上下文。
5. 能点选对象进行局部修改，而不是整份重新生成。
6. 每次生成形成版本，支持 compare、restore 或 branch。
7. 交付物可编辑，不只是一张长图或整页截图。

相关产品包括 [Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)、[v0](https://v0.app/docs/quickstart)、[Lovable](https://docs.lovable.dev/features/projects/editor)、[Gamma](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma)、[Canva](https://www.canva.com/ai-assistant/) 和 [GenSpark](https://www.genspark.ai/helpcenter/ai-slides)。商业产品只能用于观察外部体验，不能据此推断内部架构。

值得形成差异化的不是“也能生成”，而是：

1. Web、PPT、文档共享同一份已确认事实、素材和品牌规则。
2. 每条结论可回到输入文件的具体页、区域、截图或仓库文件。
3. 用户对一个对象的批注可以变成可追踪的 agent 任务并验证是否解决。
4. 输出明确区分事实、模型推断、编辑性文案和 AI 生成素材。
5. 通过真实导出文件重新渲染进行质量检查，而不是只看编辑器预览。

## 4. 开源类似产品深度结论

### 4.1 Open Design

[Open Design](https://github.com/nexu-io/open-design) 是当前产品形态最接近 PRD 的开源项目。它具有 Next.js Web、Express daemon、Electron shell、SQLite、普通项目文件、HTTP/SSE、设计系统、skills、plugins、media、预览和导出。

值得复用：

1. `RuntimeAgentDef` 数据驱动的 agent adapter 设计。
2. 外部 coding-agent CLI 与内部统一 SSE 事件之间的转换。
3. HTML `srcDoc`/URL 双预览路径和 opaque-origin iframe 思路。
4. 文件版本元数据、恢复时创建新版本的不可变历史思路。
5. HTML、图片、PDF 和双轨 PPTX 导出。
6. Web、daemon、contracts 分层。

关键源码和文档：

- [Architecture](https://github.com/nexu-io/open-design/blob/main/docs/architecture.md)
- [Agent adapters](https://github.com/nexu-io/open-design/blob/main/docs/agent-adapters.md)
- [Runtime registry](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/runtimes/registry.ts)
- [Preview render mode](https://github.com/nexu-io/open-design/blob/main/apps/web/src/components/file-viewer-render-mode.ts)
- [Deck export](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/deck-export.ts)
- [File versions](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/project-file-versions.ts)

不能直接照搬：

1. 它的默认信任边界是本地单用户，daemon 和 SQLite 没有完整用户/租户模型。
2. 多个 coding agent 使用 broad permission 或危险模式启动，不适合共享宿主机。
3. 当前 run 日志不等于 durable resume，daemon 重启会终止活跃任务。
4. provider key 和部分配置需要迁移到真正 secret manager。
5. editable PPTX 仍有字体换行、裁切和 Office 兼容问题。
6. bundled branded design systems 的来源、商标和再分发权限需要单独审查。

结论：采用 **compose**。将 Open Design 视为可审计的单用户 worker 或源码参考，自建 control plane、认证、租户、调度、secret、审计和 durable workflow。

### 4.2 Onlook

[Onlook](https://github.com/onlook-dev/onlook) 最有价值的能力是源码感知的视觉编辑。它通过 AST instrumentation 和稳定 `data-oid` 将预览中的对象映射回源码，并使用 CodeSandbox 执行项目。

值得借鉴：

- [Root agent](https://github.com/onlook-dev/onlook/blob/main/packages/ai/src/agents/root.ts)
- [Agent toolset](https://github.com/onlook-dev/onlook/blob/main/packages/ai/src/tools/toolset.ts)
- [Code filesystem and OID](https://github.com/onlook-dev/onlook/blob/main/packages/file-system/src/code-fs.ts)
- [Branch schema](https://github.com/onlook-dev/onlook/blob/main/packages/db/src/schema/project/branch.ts)

结论：Web 的对象级编辑必须采用稳定 ID + AST 映射，不能依靠 CSS selector 或字符串替换。

### 4.3 OpenPencil

[OpenPencil](https://github.com/open-pencil/open-pencil) 展示了 scene graph、90+ 设计工具、typed tool loop、undo/redo 和多 provider 的组合方式。其 AI mutation 会在执行前后接入快照和 undo entry。

值得借鉴：

- [AI transport](https://github.com/open-pencil/open-pencil/blob/main/src/app/ai/chat/transports.ts)
- [Provider adapters](https://github.com/open-pencil/open-pencil/blob/main/src/app/ai/chat/model.ts)
- [AI tools](https://github.com/open-pencil/open-pencil/blob/main/src/app/ai/tools/index.ts)
- [Undo manager](https://github.com/open-pencil/open-pencil/blob/main/packages/scene-graph/src/undo.ts)

结论：所有可变更设计的工具都应产出 validated patch、before/after snapshot 和可逆历史，而不是让模型直接覆盖整个文件。

### 4.4 bolt.diy、Open Lovable、Dyad、E2B Fragments

[bolt.diy](https://github.com/stackblitz-labs/bolt.diy) 值得借鉴 WebContainer 生命周期、文件工作台、ZIP 和部署适配，但其 XML-like action protocol 不应成为核心数据协议。

[Open Lovable](https://github.com/firecrawl/open-lovable) 适合参考 prompt-to-site 和品牌抽取流程，但基于 `<file>` block 的流式解析和部分进程全局 sandbox 状态不适合生产。

[Dyad](https://github.com/dyad-sh/dyad) 的本地桌面、Git context、视觉编辑和 MCP 很有参考价值，但 `src/pro/` 使用 FSL，竞争性商业产品不可未经审查直接复用。

[E2B Fragments](https://github.com/e2b-dev/fragments) 是结构化生成和远端沙箱的好样例，但版本、协作和 agent 迭代较弱。

### 4.5 design.md、Agentation、Huashu Design

[design.md](https://github.com/google-labs-code/design.md) 使用 YAML frontmatter 存机器可验证 token，Markdown 存人类可读设计原则，并支持 lint、reference、diff 和 CSS/Tailwind/DTCG export。它是 Apache-2.0，但当前仍是 alpha，单位和结构明显偏 Web。

结论：用它作为 `StyleProfile` authoring layer，并增加 slide、document、asset rights、motion、chart、composition 和 export constraints 扩展。

[Agentation](https://github.com/benjitaylor/agentation) 的价值是结构化对象反馈闭环：对象定位、intent、severity、thread、acknowledged、resolved、dismissed。它还收集 computed style、a11y、bounding box 和 React source 信息。

结论：其 PolyForm Shield 许可证存在竞争性使用限制，不直接集成。clean-room 定义自己的 `ObjectRef` 和 `FeedbackEvent`。

[Huashu Design](https://github.com/alchaincyf/huashu-design) 值得借鉴三方向探索、Concept gate、六维 critique 和 HTML/PDF/PPTX 双轨导出。它也证明 editable PPTX 必须在设计阶段限制 gradient、复杂滤镜和 DOM 结构。

结论：采用工作流和 rubric 思路，不把 DOM 当跨媒介唯一真源。

## 5. 推荐系统架构

```text
Browser / Desktop Shell
  |-- Chat
  |-- Artifact tree
  |-- Canvas / Preview
  |-- Inspector / Comments
  `-- Settings / Providers / Export
                |
         API / Control Plane
  auth, tenancy, policy, quotas, secrets
                |
       Durable Design Workflow
  intake -> analyze -> clarify -> plan
  -> generate -> render -> critique
  -> approve -> export
                |
  +-------------+--------------+
  |             |              |
Model Layer  Artifact Core  Worker Plane
AI SDK       Postgres       parser workers
providers    object store   sandbox workers
image APIs   revisions      export workers
MCP adapter  provenance     deploy workers
  |             |              |
  +-------------+--------------+
                |
 ContentGraph + AssetManifest + StyleProfile
                |
  +-------------+--------------+
  |             |              |
WebProject    DeckIR        ReportIR
  |             |              |
Web renderer  PPTX/PDF     DOCX/PDF
```

### 5.1 前端工作台

推荐 `Next.js + React + TypeScript`，桌面版本后续用 Electron 或 Tauri 包装，不在首版维护两套业务逻辑。

工作台至少包含：

1. 左侧对话和 clarification form。
2. 中间可选的文件、页面、slide、章节树。
3. 右侧真实预览、对象选择和属性 inspector。
4. 版本、diff、restore 和 branch。
5. 模型、图片 provider、字体、品牌、导出设置的可视化配置。
6. 导出任务、警告、缺失字体、素材权利和质量报告。

富文本文档编辑可用 [Tiptap](https://github.com/ueberdosis/tiptap)，代码编辑可用 Monaco，PPT/固定画布使用 DOM/SVG 或 Konva，但内部对象必须绑定稳定 ID。

### 5.2 Agent runtime

推荐初始组合：

1. [AI SDK](https://github.com/vercel/ai) 负责 provider abstraction、multimodal message、typed tools、structured output 和 UI streaming。
2. [Workflow SDK](https://github.com/vercel/workflow) 负责 durable step、retry、suspend/resume、stream recovery 和 PostgreSQL world。
3. 应用自有 capability registry 负责模型选择、价格级别、地区、隐私、上下文、vision、tools、strict schema 和 image generation 能力。
4. MCP 只作为工具互操作 adapter，不承担授权、沙箱、任务恢复或业务状态。
5. [LiteLLM](https://github.com/BerriAI/litellm) 等到需要统一虚拟 key、跨应用预算和集中路由时再引入。

不要保存某个 provider 的 thread、file、assistant 或 message schema 作为唯一真源。模型应按任务角色配置：

```text
reasoning.high
reasoning.fast
vision.analysis
structured.extraction
image.generate
image.edit
embedding.text
embedding.visual
```

### 5.3 多 Agent 设计

不建议首版做自由运行的 swarm。应使用一个显式、可恢复的 workflow，仅在适合并行的步骤启动 bounded specialist agents：

| Agent | 输入 | 输出 |
|---|---|---|
| Intake Agent | 用户目标和上传物 | 缺失信息、风险、任务分类 |
| Research Agent | 仓库、文档、允许的 Web 来源 | 带 provenance 的事实和素材候选 |
| Brief Agent | 内容图、用户回答 | DesignBrief 和验收条件 |
| Style Agent | 参考图、主题、品牌规范 | StyleProfile 和 style evidence |
| Content Agent | 事实、受众、结构 | 页面/章节/slide semantic content |
| Layout Agent | 内容、风格、renderer capability | WebProject/DeckIR/ReportIR patch |
| Asset Agent | 素材需求和 rights policy | 复用、检索或生成的素材 |
| Critic Agent | 真实渲染、rubric、hard-check 结果 | 对象级问题和修复建议 |
| Export Agent | 已批准 revision | 目标文件、manifest、验证结果 |

Research、Style、Asset 可以并行；Layout 必须等 brief 和 semantic content 稳定；Critic 只返回 patch 建议，不应无边界重做整份设计。

### 5.4 核心数据层

建议最少定义以下领域对象：

```text
Project
DesignBrief
AssetManifest
ContentNode / ContentEdge
StyleProfile
Artifact
ArtifactRevision
ObjectRef
FeedbackEvent
RenderJob
QualityReport
ExportJob
Deployment
WorkflowRun
Approval
```

关键原则：

1. 原始文件 immutable，以 SHA-256 和 object storage URI 标识。
2. parser observation、model interpretation 和 human confirmation 分开保存。
3. 每个事实、图片和变换保留来源区域、模型、版本、时间和 rights。
4. 每次 agent mutation 是 transaction；验证成功后才发布 revision。
5. 大二进制不进入 prompt 或 workflow checkpoint，只传 immutable ID 和短期 signed URL。

### 5.5 StyleProfile

`StyleProfile` 可以兼容 design.md/DTCG 思路，但需要包含 token 之外的构图规则：

```yaml
tokens:
  color.brand.primary: "#17324D"
  typography.heading.family: "Inter"
  spacing.section: "48px"
composition:
  grid: "12-column editorial"
  density: "airy"
  hierarchy: "one dominant focal point"
assets:
  logo:
    source: "asset://logo"
    rights: "internal-approved"
media:
  web:
    breakpoints: [390, 768, 1440]
  slides:
    aspectRatio: "16:9"
    safeArea: "0.35in"
  documents:
    pageSize: "A4"
    bodyFlow: "paginated"
```

Style 模仿应提取高层视觉语法，不默认复制参考作品的具体构图和资产。未知权利的图片可用于分析，不应默认出现在公开导出物中。

## 6. 多模态参考资料实现

详细专题见 [reference-ingestion-architecture.md](./reference-ingestion-architecture.md)。推荐 pipeline：

```text
upload
-> MIME/security scan
-> immutable blob + AssetManifest
-> native parser / repository analyzer
-> layout parser / OCR fallback
-> region-level observations
-> ContentGraph + provenance
-> dedup / cluster / retrieve
-> brief + clarification
-> style and asset-use plan
```

推荐组件：

| 能力 | 推荐 |
|---|---|
| PDF/DOCX/PPTX/图片结构解析 | Docling |
| 广泛 connector 和 fallback | Unstructured |
| 中文、表格和复杂截图 OCR | PaddleOCR |
| exact/near duplicate | SHA-256 + pHash/dHash |
| text-image retrieval | OpenCLIP + Qdrant |
| 内容关系和 provenance | PostgreSQL 起步，不急于引入 graph DB |
| 生成来源和内容凭证 | 内部 provenance ledger，可选 C2PA |

必须原生结构优先：

1. PPTX 先读 theme、master、layout、placeholder、geometry、crop 和 z-order。
2. DOCX 先读 styles、numbering、sections、headers/footers、tables 和 drawings。
3. Web/repository 先读源码、CSS、设计 token、组件和现有 assets。
4. PDF/图片才主要依赖 layout parser、OCR 和 VLM。

VLM 描述是解释，不是原始事实。渗透测试截图中的文本也必须视为不可信内容，不能让其中的 prompt injection 获得工具权限。

## 7. Web 产物实现

Web 产物以真实项目文件为 canonical source，同时维护结构化 manifest 和对象映射。

推荐链路：

```text
Brief + ContentGraph + StyleProfile
-> page/component plan
-> controlled scaffold
-> typed file/AST patches
-> sandbox build
-> isolated preview origin
-> desktop/mobile screenshots
-> deterministic checks + VLM critique
-> revision
```

关键技术：

1. 生成元素注入稳定 `data-design-id`，并维护 ID 到 AST node/source range 的映射。
2. 点选对象后通过严格 origin/source/schema 校验的 `postMessage` 返回编辑器。
3. CSS token 和结构化组件参数优先修改，任意源码 patch 次之。
4. Vite HMR 用于预览；revision 切换时先构建新环境再原子切换 iframe。
5. 普通预览使用独立 origin 和 `iframe sandbox`，不能与主应用共享 cookie 或 localStorage。
6. 安装依赖、执行 server code 和 build 必须在服务端沙箱，不把 iframe 当安全边界。
7. 导出支持 source ZIP、静态 bundle、GitHub commit 和 Vercel/Netlify deployment。

首版可以限制为 React/Vite/Next.js 的少量受控模板，而不是声称支持任意框架。

## 8. PPT 产物实现

PPT 是当前最适合验证“强设计 + 多模态 + 可编辑导出”的垂直切片。最合理的核心是 typed `DeckIR`，不是 Markdown、任意 HTML 或 PPTX 本身。

```ts
type SlideElement = {
  id: string
  kind: "text" | "image" | "shape" | "table" | "chart" | "diagram" | "formula"
  semanticRole: string
  content: unknown
  frame: { x: number; y: number; w: number; h: number }
  constraints: { minFontSize?: number; maxLines?: number; allowSplit?: boolean }
  exportMode: "native" | "svg" | "raster"
  provenance?: unknown
}
```

推荐链路：

1. Research/Content Agent 生成带证据的大纲。
2. 用户确认叙事、页数和受众。
3. Style Agent 给出 2-3 个真实差异化视觉方向。
4. Layout Agent 从有限但可组合的 layout primitives 选择结构。
5. constraint solver 和 Chromium 负责真实字体测量、safe area、overflow 和 overlap。
6. React DOM/SVG 或 Konva 根据 DeckIR 预览。
7. PptxGenJS 将文本、图片、基础形状、表格和常见图表输出为原生对象。
8. 公式使用 LaTeX/MathML 确定性渲染为 SVG，知识图谱从结构化节点和边确定性布局；复杂滤镜才局部栅格化。生图模型不能生成事实性公式、图表或图谱。
9. Playwright 输出 screenshot/PDF。
10. LibreOffice 或 PowerPoint 重新渲染 PPTX，与基准截图做视觉差异检查。

最值得参考的源码：

- [DeepPresenter inspect_slide](https://github.com/icip-cas/PPTAgent/blob/main/deeppresenter/tools/reflect.py)
- [DeepPresenter HTML to PPTX](https://github.com/icip-cas/PPTAgent/blob/main/deeppresenter/html2pptx/html2pptx.js)
- [PptxGenJS](https://github.com/gitbrent/PptxGenJS)
- [Presenton](https://github.com/presenton/presenton)
- [presentation-ai exporter](https://github.com/allweonedev/presentation-ai/blob/main/src/components/presentation/export/contentWalker.ts)
- [Slidev export limitations](https://github.com/slidevjs/slidev/blob/main/docs/guide/exporting.md)

不要把 Slidev/Marp 的整页图片 PPTX 当成“可编辑 PPTX”。产品应明确提供：

| 模式 | 优先级 | 行为 |
|---|---|---|
| Editable | 对象可编辑优先 | 限制复杂视觉，文本和常见形状保持原生 |
| Fidelity | 视觉保真优先 | 允许复杂区域或整页栅格化 |
| Hybrid | 默认 | 原生文本/图表 + 栅格背景或复杂装饰 |

## 9. DOCX/报告产物实现

DOCX 是三类产物中最难保证 round-trip 的格式。不能采用 `DOCX -> HTML -> 编辑 -> DOCX` 作为唯一链路，因为容易丢失 styles、numbering、sections、fields、text boxes、headers/footers 和 pagination。

推荐三层状态：

```text
ReportIR
  |-- Web editing projection
  |-- DOCX template projection
  `-- PDF pagination projection
```

对于渗透测试报告：

1. Docling/Unstructured/PaddleOCR 解析材料。
2. 构建 `EvidenceIR`，每条证据保存文件 hash、页码、bbox、OCR、VLM interpretation、confidence 和 review status。
3. 生成严格 `ReportIR`，finding 引用 evidence IDs。
4. 用户确认 scope、客户、报告语言和模板映射。
5. .NET Open XML SDK 或 Java docx4j 克隆模板中的真实段落、表格行和格式。
6. 使用 OPC allowlist 重建输出包，只复制已确认安全的样式、主题、编号和版式部件。
7. 默认删除宏、ActiveX、OLE、外部关系、远程模板、不需要的 custom XML、修订、批注和隐藏元数据。
8. LibreOffice/Gotenberg 转 PDF，PDF.js 展示真实分页。
9. Open XML Validator、关系完整性和视觉回归作为导出门。

推荐工具：

| 能力 | 推荐 |
|---|---|
| 结构化内容编辑 | Tiptap + Yjs/Hocuspocus |
| DOCX 精确编译 | Open XML SDK 或 docx4j |
| 最终 Word 级精修 | Collabora Online，可选 |
| 浏览器原生 DOCX 实验 | SuperDoc，需先做真实模板回归 |
| Office 转 PDF | Gotenberg + LibreOffice |
| 分页预览 | PDF.js |

[ONLYOFFICE DocumentServer](https://github.com/ONLYOFFICE/DocumentServer) 功能成熟，但 AGPL 和附加许可需要在嵌入商业产品前审查。[SuperDoc](https://github.com/superdoc-dev/superdoc) 也存在 AGPL/商业许可边界。

## 10. 视觉质量闭环

“必须好看”不能只依赖 VLM 打分。推荐四层质量门：

| 层 | 检查 |
|---|---|
| Schema | 必填字段、字数、数据、来源、素材权利、renderer capability |
| Structural | overflow、clipping、overlap、safe area、字体、断链、导出错误 |
| Accessibility | contrast、字号、reading order、alt text、reduced motion |
| Visual | hierarchy、balance、coherence、originality、style adherence、asset fitness |

修复顺序必须确定：

1. 压缩或改写内容。
2. 调整局部间距和字号，但不突破最低字号。
3. 切换同语义的替代 layout。
4. 拆页或拆章节。
5. 最后才重新生成整个页面或 slide。

VLM critic 必须输出结构化、对象级结果：

```json
{
  "criterion": "visual-hierarchy",
  "score": 3,
  "confidence": 0.84,
  "objectRef": "slide-03/chart",
  "evidence": "Chart saturation competes with the title.",
  "suggestedPatch": "Reduce chart saturation and increase title whitespace."
}
```

每个 artifact 最多 2-3 次自动 repair。patch 只有在 hard checks 继续通过且目标分数提高时才接受。高风险报告和公开发布需要人工审批。

## 11. 安全与部署

必须按不可信输入和不可信生成代码设计：

1. 上传文件检查 MIME、malware、macro、OLE、ActiveX、external relation 和 ZIP bomb。
2. OCR、parser、Office converter 和 repo analyzer 运行在低权限隔离 worker。
3. 每个项目使用临时沙箱，非 root、只读基础镜像、无 Docker socket。
4. 限制 CPU、内存、进程、磁盘、网络、执行时间和输出大小。
5. 构建和预览 worker 默认完全断网；依赖和字体由独立缓存代理预取，不允许生成代码直接访问 registry/CDN。
6. 必须出网的可信 connector 限制 method、path、body、response size，并阻断 RFC1918、localhost、cloud metadata 和 DNS rebinding。
7. package lifecycle scripts 默认关闭，需要时提升到高风险沙箱并提示用户。
8. provider key、OAuth token 和部署凭据只在 control plane/secret manager，绝不注入生成代码沙箱。
9. GitHub、部署、公开分享、删除和高成本生成需要显式批准。
10. iframe 使用独立 origin、CSP、sandbox，并严格校验 postMessage origin/source/schema。
11. 所有 blob、preview、export、cache、signed URL 和 telemetry 执行 tenant/project/object-level authorization。
12. 敏感项目定义数据驻留、保留期、删除传播、备份清除、支持人员访问和审计策略；日志默认不记录文件内容。

MVP 优先使用 E2B 或同等级远端隔离。普通 Docker 适合可信内部任务，不足以单独作为恶意多租户代码的最终安全边界。WebContainers 可以作为低延迟增强，但商业许可、浏览器兼容和资源边界需要单独评估。

部署形态建议：

```text
Web app/control plane
PostgreSQL
S3-compatible object storage
Workflow workers
Parser/OCR workers
Sandbox workers
PPTX/DOCX/PDF export workers
Preview gateway on isolated domains
OpenTelemetry collector
```

这是产品化后的逻辑边界，不代表 MVP 要立即拆成所有微服务。首版应采用模块化单体、PostgreSQL、对象存储、一个任务队列和托管沙箱；parser、export、sandbox 只在需要不同权限或运行时依赖时拆为 worker。认证和项目级隔离不能推迟，但多租户计费、复杂配额、deployment worker 和完整审批服务可以后置。

## 12. MVP 和路线图

### Phase 0：验证关键假设

Phase 0 同时验证产品和技术，不先搭通用 agent 平台。产品侧需要先确认一个 ICP 和一个 JTBD；建议起点是“需要把技术项目资料制作成 6-10 页项目介绍 PPT 的小型技术团队”，但必须通过访谈验证，而不是直接写死。

验收：

1. 访谈并试用 10 个目标用户，记录现有制作时间、主要返工原因、交付接受率和付费意愿。临时产品门槛是至少 6 人将痛点评为 4/5 以上，至少 3 人愿意提供真实项目进入持续 pilot 或付费试用。
2. 建立 24-30 个权利清晰的真实案例集，覆盖中文/英文、纯资料、资料+截图和数据密集型内容。约 70% 用于开发，其余至少 8 个作为冻结测试集；每例保存事实清单、source regions、人工参考 deck 和版本信息。
3. 限制输入为最多 5 个文件、100 页、200 MB 和一个已授权仓库；超限时先采样并让用户选择范围。
4. 一个主模型和一个 fallback 通过 vision extraction、strict brief schema 和 deck planning conformance test。
5. workflow 能中断追问，并在刷新或进程重启后恢复；forced crash 不产生重复副作用。
6. 生成一个 artifact，真实渲染后执行一次对象级修复。

### Phase 1：PPT 垂直切片

选择“结构化项目资料 + 已授权图片 -> 8 页项目介绍 PPT”作为首个完整场景。先隔离验证内容规划、版式和导出，再逐步加入杂乱截图和仓库自动分析，避免结果不好时无法定位故障层。

范围：

1. 固定输入契约、brief/outline 确认、左聊右预览和 slide tree。
2. 单一视觉方向、6-8 个可组合 layout primitives 和固定字体包。
3. typed DeckIR、真实字体测量、overflow/overlap hard checks。
4. 文本和图片替换；首版不做通用 inspector、对象评论、branch 和 AI 生图。
5. PDF 和 fidelity PPTX 导出；editable PPTX 作为独立 spike，不作为首版 go-live blocker。

### Phase 1 验收 Scorecard

在开始开发前根据真实基线填写目标值，不能只用“看起来不错”验收：

| 指标 | 首版硬门槛或记录方式 |
|---|---|
| 重大无来源事实 | 0 |
| 引用完整性 | 所有事实性数字和结论均有有效 source region |
| Overflow/非预期 overlap | 0 |
| PDF/PPTX 打开失败 | 0 |
| 冻结集任务成功率 | 暂定 >= 85% |
| 盲测偏好率 | 相对固定模板/商业基线暂定 >= 60% |
| 无需整份重做接受率 | 目标用户暂定 >= 70% |
| 人工修订时间 | 中位数 <= 20 分钟，且比原流程降低 >= 50% |
| 首个完整预览时延 | P50 <= 5 分钟，P95 <= 10 分钟 |
| 审批后最终导出时延 | P95 <= 2 分钟 |
| 单份可变成本 | 暂定 <= 3 美元，含模型、OCR、沙箱、渲染和存储 |

这些数值是进入实现前的临时约束，Phase 0 获得真实基线后只能通过有记录的决策修改。冻结测试集不能参与 prompt/layout 调试；输出由两名独立评审者盲评，分歧由目标用户仲裁，并固定 rubric、baseline 产品版本、模型版本和 renderer 版本。VLM 评分只用于发现候选问题，最终质量以用户/设计师盲评、采用率和人工修订时间校准。超出成本或时延预算时，依次降级视觉候选数、自动修复次数和 critic 模型等级。

### Phase 1.1：产品化 PPT 工作台

在 Scorecard 达标后再增加 2-3 个视觉方向、AI 装饰性配图、对象级评论、局部 inspector、版本恢复和仅支持文本/图片/基础形状的 editable PPTX。认证环境、PowerPoint 版本、操作系统、字体包和视觉容差必须固定。

人工门也应固定：brief gate 确认受众和目标，outline gate 确认事实与叙事，asset gate 处理低置信度和使用权，export gate 审阅最终文件。每次选择、驳回、人工修改和耗时都写回评测数据，而不是只留在聊天记录。

### Phase 2：Web 产物

范围：

1. 少量受控 React/Vite/Next.js scaffold。
2. stable design ID、AST mapping 和 visual inspector。
3. 服务端 sandbox、HMR、desktop/mobile QA。
4. ZIP、GitHub 和 Vercel/Netlify。

### Phase 3：DOCX/报告

范围：

1. EvidenceIR 和严格 ReportIR。
2. 首批固定模板和可视化 template mapping。
3. Open XML compiler、PDF pagination 和结构/视觉校验。
4. Tiptap 协作和可选 Collabora final edit。

### 暂不建议首版实现

1. 完整 Figma/Canva 自由画布。
2. 任意 Web 技术栈和通用全栈后端。
3. 企业级多人光标、离线 CRDT 冲突处理和复杂 RBAC。
4. 自研图片基础模型。
5. 无损支持任意 DOCX/PPTX 模板。
6. Skills marketplace 和数百模板。
7. 自建 Firecracker/Kubernetes sandbox 平台。

## 13. 技术选型建议

| 层 | 建议 |
|---|---|
| Web/控制台 | Next.js + React + TypeScript |
| Agent/model | AI SDK + application capability registry |
| Durable workflow | Workflow SDK + PostgreSQL world |
| Product database | PostgreSQL |
| Blob storage | S3 compatible object storage |
| Retrieval | PostgreSQL FTS 起步，视觉/文本量上来后使用 Qdrant |
| Ingestion workers | Python + Docling + PaddleOCR |
| Web sandbox | MVP E2B；后续按成本/合规评估 microVM 自建 |
| Web render/test | Playwright + Vite |
| PPT preview/export | DeckIR + DOM/SVG/Konva + PptxGenJS + LibreOffice |
| DOCX | ReportIR + Open XML SDK/docx4j + Gotenberg + PDF.js |
| Rich text | Tiptap；需要协作时加 Yjs/Hocuspocus |
| Design profile | Internal StyleProfile + design.md/DTCG import/export adapters |
| Observability | OpenTelemetry |
| Secrets | 云 secret manager 或 OS credential vault |

## 14. 关键风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 单一 IR 过度抽象 | 三种格式都做不好 | 上层共享语义，输出使用专用 IR |
| 模型更换导致行为漂移 | 兼容性名存实亡 | capability contract + provider conformance tests |
| PPTX/DOCX 预览与 Office 不一致 | 用户导出后布局破坏 | 导出文件重新渲染和 golden regression |
| 风格模仿涉及版权/商标 | 无法公开使用素材 | provenance、rights policy、只提取高层视觉语法 |
| 任意代码和恶意附件 | 凭据泄露或宿主逃逸 | 独立 sandbox、egress control、secret isolation |
| VLM 质量分不稳定 | 自动修复越修越差 | hard checks 优先、对象级证据、bounded repair |
| 开源项目许可混合 | 商业发布风险 | 依赖锁定时执行 SBOM 和 legal review |
| Open Design 上游快速变化 | fork 维护成本高 | 选择性 compose、固定 audited commit、契约隔离 |

需要重点审查的许可包括 Agentation PolyForm Shield、Dyad `src/pro` FSL、ONLYOFFICE/SuperDoc AGPL、MinerU 附加条款、各类模型权重和训练数据许可，以及 WebContainer 商业嵌入条款。

## 15. 最终建议

项目最应该自研和长期拥有的核心不是 chat UI，也不是某个模型 adapter，而是：

1. `ContentGraph`：事实、结构、来源和不确定性。
2. `AssetManifest`：素材、权利、变换和生成 lineage。
3. `StyleProfile`：token、构图规则和跨媒介覆盖。
4. `Artifact IRs`：WebProject、DeckIR、ReportIR。
5. `ObjectRef + FeedbackEvent`：对象级人机协作协议。
6. `QualityReport`：真实渲染后的可解释质量门。
7. `Durable Workflow`：追问、审批、重试、恢复和审计。

开源项目可以显著缩短 UI、provider、parser、sandbox、renderer 和 exporter 的建设周期，但产品壁垒会来自这些自有数据契约、评测集、修复策略和跨产物一致性。

建议首先完成收窄后的 PPT 垂直切片，并从第一天建立真实案例回归集。只有当 PPT 的内容正确性、视觉质量、导出可靠性、用户采用率、人工修订时间和单份成本达到预设门槛，才进入产品化 PPT 工作台并扩到 Web、DOCX；否则同时铺开三条渲染链会迅速消耗工程资源，却难以证明“强设计能力”。

## 16. 相关专题

- [模型无关的 Agent Runtime 调研](./runtime-research.zh.md)（[English](./runtime-research.md)）
- [参考资料摄入与视觉质量架构](./reference-ingestion-architecture.zh.md)（[English](./reference-ingestion-architecture.md)）
- [Product requirements](../../prd.md)
