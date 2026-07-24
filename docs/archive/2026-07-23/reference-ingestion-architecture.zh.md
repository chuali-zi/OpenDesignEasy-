# Design Agent：参考资料摄入与视觉质量架构

> 归档状态：本研究保留为 2026-07-23 的决策依据；当前正式架构以 `docs/architecture.md` 与 `docs/spec/` 为准。

> 调研快照：2026-07-23。下文活动日期为调研时观察到的最新上游提交，不是发布日期。许可覆盖仓库本身；若有单独模型/许可说明会另行标注。

## 1. 建议

把系统建成五层可替换架构，而不是一个巨型多模态提示词：

1. **摄入网关**：保留原件、识别文件类型、提取原生结构，仅在需要处调用 OCR。
2. **内容图**：存储断言、视觉区域、关系、置信度与来源级 provenance。
3. **风格编译器**：把原生主题与推断视觉特征转为可移植设计 token，外加构图规则。
4. **设计编译器**：消费共享语义核心，分别为渲染器生成专用 `WebProject`、`DeckIR` 或 `ReportIR`。
5. **质量闭环**：组合确定性校验、渲染截图、多模态批评与有界修复。

推荐初始栈：

- Docling 作为默认 PDF/DOCX/PPTX/图片解析器；原生 OOXML/CSS 提取优先于渲染图推断。
- Unstructured 作为 connector 与分区兜底；PaddleOCR 处理困难 OCR 与多语言截图。
- PostgreSQL/对象存储作为系统真源，Qdrant 做视觉/文本检索。图记录先放 PostgreSQL；仅当查询确实需要时再引入图数据库。
- OpenCLIP embeddings，加上加密哈希与感知哈希，用于图片检索与去重。
- 内部 StyleProfile，配合经过测试的 design.md 与 DTCG 导入/导出 adapter，作为可移植风格契约。
- Playwright 做 Web 渲染；LibreOffice 或同等无头渲染做 PPTX/DOCX；provider 中立的 VLM critic。
- 在可用处使用 C2PA 元数据，并以内部 provenance ledger 支撑每个素材与生成衍生件。

MinerU 与 Marker 应作为可选 parser adapter，而不是默认项，因为其仓库/模型许可需要更产品特定的审查。

## 2. 已评估项目

### 摄入、OCR 与版面

| 项目 | 许可 | 最近活动 | 最佳用途 | 重要限制 |
|---|---|---:|---|---|
| [Docling](https://github.com/docling-project/docling) | MIT | 2026-07-23 | 默认结构化文档转换；页/版面/表/图层次 | 原生主题/样式保真仍需 OOXML/CSS 专用提取 |
| [MinerU](https://github.com/opendatalab/MinerU) | Apache-2.0 加附加条款 | 2026-07-10 | 强 PDF 阅读顺序、公式与表格 | 在线服务署名；采用前须审查商业许可门槛 |
| [Unstructured](https://github.com/Unstructured-IO/unstructured) | Apache-2.0 | 2026-07-15 | 广泛 connector 生态与分区兜底 | 归一化元素会丢失部分创作工具语义 |
| [Marker](https://github.com/datalab-to/marker) | Apache-2.0 代码 | 2026-07-20 | 快速 PDF 转 Markdown/JSON | 模型权重使用修改版 OpenRAIL-M，需单独审查 |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0 | 2026-07-22 | 多语言 OCR、文档朝向、表格 | OCR 输出需单独语义/版面对齐 |
| [olmOCR](https://github.com/allenai/olmocr) | Apache-2.0 | 2026-03-25 | 高质量 PDF 转录与阅读顺序 | 比完整混合素材摄入层更专科 |
| [MarkItDown](https://github.com/microsoft/markitdown) | MIT | 2026-07-21 | 轻量文本转换，用于索引与预览 | 本身不足以作为版面/风格表示 |

选型规则：原生提取优先，结构转换其次，OCR 第三，VLM 解释最后。渲染截图是外观证据，不能替代可编辑源结构。

### 多模态检索与图构建

| 项目 | 许可 | 最近活动 | 最佳用途 | 重要限制 |
|---|---|---:|---|---|
| [RAG-Anything](https://github.com/HKUDS/RAG-Anything) | MIT | 2026-07-20 | 将 text/image/table/equation 模态路由进图感知 RAG 的参考架构 | 其图 schema 不是完整的设计/provenance schema |
| [RAGFlow](https://github.com/infiniflow/ragflow) | Apache-2.0 | 2026-07-23 | 完整文档 RAG 产品与分块参考 | 若只需 parser/检索部件，平台依赖过重 |
| [ColPali](https://github.com/illuin-tech/colpali) | MIT | 2026-06-10 | 保留视觉版面线索的页图检索 | GPU/存储成本；结果仍需区域级证据链接 |
| [GraphRAG](https://github.com/microsoft/graphrag) | MIT | 2026-07-18 | 大语料实体/社区提取模式 | 对小型每项目参考集过贵且不必要 |
| [Qdrant](https://github.com/qdrant/qdrant) | Apache-2.0 | 2026-07-17 | 带元数据过滤的文本与图片向量检索 | 不是权威 provenance 或关系存储 |

### 风格、图片、Provenance 与 QA

| 项目 | 许可 | 最近活动 | 角色 |
|---|---|---:|---|
| [Style Dictionary](https://github.com/style-dictionary/style-dictionary) | Apache-2.0 | 2026-06-21 | 把归一化设计 token 转为目标特定格式 |
| [OpenCLIP](https://github.com/mlfoundations/open_clip) | MIT 代码；核实每个权重数据集/许可 | 2026-07-17 | 跨模态图文检索与语义聚类 |
| [imagededup](https://github.com/idealo/imagededup) | Apache-2.0 | 2025-08-15 | 感知/embedding 去重参考 |
| [C2PA Rust SDK](https://github.com/contentauth/c2pa-rs) | MIT OR Apache-2.0 | 2026-07-22 | 在可用处读写签名内容凭证 |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | 2026-07-23 | 确定性浏览器渲染、视口测试与截图 |
| [BackstopJS](https://github.com/garris/BackstopJS) | MIT | 2024-09-07 | 视觉回归工作流参考；活动相对较低 |
| [ImageReward](https://github.com/zai-org/ImageReward) | Apache-2.0 代码；核实权重 | 2025-10-29 | 可选图片偏好信号，绝不能单独充当设计质量裁判 |

模型权重、训练数据集与生成输出条款必须与仓库许可分开审查。

### 可比 Agent

| 项目 | 许可 | 最近活动 | 可复用思路 |
|---|---|---:|---|
| [PPTAgent / DeepPresenter](https://github.com/icip-cas/PPTAgent) | MIT | 2026-06-28 | 规划/研究/设计分离、浏览器渲染、幻灯片检查，以及内容/视觉/连贯性评估 |
| [screenshot-to-code](https://github.com/abi/screenshot-to-code) | MIT | 2026-07-22 | 工具状态循环、素材提取、桌面/移动截图回传模型 |
| [OpenUI](https://github.com/wandb/openui) | Apache-2.0 | 2026-06-30 | 对话式 UI 生成与实时预览 |
| [OmniParser](https://github.com/microsoft/OmniParser) | MIT | 2026-07-20 | 截图区域检测与语义 grounding |
| [UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop) | Apache-2.0 | 2026-07-01 | 视觉 computer-use agent 模式与模型/工具分离 |

有用实现入口：

- [DeepPresenter orchestration](https://github.com/icip-cas/PPTAgent/blob/main/deeppresenter/main.py)
- [DeepPresenter render and reflection tools](https://github.com/icip-cas/PPTAgent/blob/main/deeppresenter/tools/reflect.py)
- [PPTEval evaluation pipeline](https://github.com/icip-cas/PPTAgent/blob/main/pptagent/ppteval/ppteval.py)
- [screenshot-to-code agent loop](https://github.com/abi/screenshot-to-code/blob/main/backend/agent/engine.py)
- [screenshot-to-code Playwright renderer](https://github.com/abi/screenshot-to-code/blob/main/backend/preview_screenshot/playwright_backend.py)
- [screenshot-to-code asset extraction](https://github.com/abi/screenshot-to-code/blob/main/backend/asset_extraction.py)
- [RAG-Anything parser registry](https://github.com/HKUDS/RAG-Anything/blob/main/raganything/parser.py)
- [RAG-Anything modality processors](https://github.com/HKUDS/RAG-Anything/blob/main/raganything/modalprocessors.py)

## 3. 端到端流水线

```text
upload
  -> immutable blob + security/type scan
  -> asset manifest
  -> native parser / layout parser / OCR / repository analyzer
  -> normalized content graph + source regions
  -> exact and near-duplicate reconciliation
  -> semantic retrieval indexes
  -> intent brief + clarification gate
  -> style profile + asset-use plan
  -> WebProject / DeckIR / ReportIR
  -> dedicated Web/PPTX/DOCX renderer
  -> deterministic checks
  -> screenshot/page rendering
  -> VLM design critic
  -> bounded patch loop
  -> export + provenance/QA report
```

### 3.1 上传与 Manifest

- 每个原件以 SHA-256 标识的不可变 blob 存储。
- 从字节检测 MIME，而不是文件名；运行 archive-bomb、malware、大小与页数防护。
- 在检索前记录所有权、来源 URL、声明许可、C2PA 状态、同意与允许的输出上下文。
- 独立版本化 parser 输出，使 parser 升级不会篡改旧证据。

### 3.2 结构提取

- **PPTX：** 在渲染幻灯片前读取 theme、masters、layouts、placeholders、relationships、text runs、geometry、crop 与 z-order。
- **DOCX：** 在分页渲染前读取 styles、theme、numbering、sections、headers/footers、tables、drawings 与 tracked metadata。
- **Web/仓库：** 解析源码与 CSSOM；在代表性断点捕获 computed styles；索引 README、代码符号、测试、图示与现有 assets。
- **PDF/图片：** 恢复页几何、文本块、表格、图与阅读顺序；对纯图、缺字或低置信区域做 OCR。把每个 OCR 结果当作不可信输入。
- 把 parser 观察与模型解释分开。例如 `font_size=24pt` 是观察；`visual_role=section_heading` 是解释。

### 3.3 内容图

使用 typed 节点，如 `document`、`page`、`region`、`claim`、`entity`、`event`、`table`、`figure`、`code_symbol`、`requirement`、`style_observation`。使用 typed 边，如 `contains`、`supports`、`contradicts`、`depicts`、`references`、`derived_from`、`same_as`、`near_duplicate_of`。

检索应返回一个 bundle，而不是孤立 chunk：

- 请求的节点；
- 其来源区域与页面截图；
- 父子上下文；
- 支持与矛盾证据；
- 许可与使用约束；
- 文本与视觉相似度分数。

### 3.4 意图与 Clarification Gate

生成显式 brief，包含受众、目标、输出类型、必需事实、期望语气、风格参考、必用素材、禁用素材与未决问题。仅当未决项会实质改变事实正确性、权利、品牌或文档结构时才追问用户。外观歧义可用声明的默认值处理。

### 3.5 风格编译

按此优先级提取风格：

1. 原生 themes、masters、命名样式、CSS 变量与 computed styles。
2. 重复几何：网格、边距、节奏、圆角、边框、图片处理与密度。
3. 渲染页分析：色板、字体角色、对齐、留白与视觉层级。
4. 对无法直接测量的语义特征使用 VLM 描述。

把结果归一化为 DTCG 兼容 token，外加 token 单独无法表达的规则：

- tokens：颜色、字体、间距、尺寸、边框、圆角、阴影、动效；
- composition：网格、层级、密度、图文比、对齐、重复母题；
- examples：代表性裁切，并链接其来源区域；
- confidence：每个值标记为 observed、inferred 或 user-declared；
- output overrides：Web、幻灯片与文档特定约束。

除非用户请求复刻且使用权允许，否则不要字面复制参考。风格相似应保留高层视觉语法，内容与构图仍按任务定制。

### 3.6 图片流水线

1. 用 SHA-256 找精确重复。
2. 归一化朝向/色彩配置，用 pHash/dHash 找近似重复。
3. 检测包含其他候选素材的裁切与截图。
4. 为图文检索创建 OpenCLIP embeddings；当细粒度外观重要时再加视觉专用 embedding。
5. 按项目用 HDBSCAN 聚类；UMAP 仅用于检查，不作检索表示。
6. 分配角色候选：证据、logo、产品 UI、人像、图示、装饰、背景或不安全/无关。
7. 按语义相关、视觉质量、宽高比适配、独特性、权利与来源置信度排序。
8. 为每个衍生件保留 crop/resize/generation lineage。

证据截图绝不能被静默当作装饰素材。生成图必须标注，且不得在无明确披露时替换事实性截图、图表、公式或测试证据。

## 4. 核心数据契约

这些示例展示最少 durable 信息。Provider 特定模型响应只应作为调试产物保存，不作应用契约。

### Asset Manifest

```json
{
  "asset_id": "ast_01J...",
  "blob": {"sha256": "...", "mime": "application/pdf", "bytes": 1842201},
  "source": {"kind": "upload", "name": "test-report.pdf", "uploaded_by": "usr_..."},
  "rights": {
    "owner": "unknown",
    "license": "unknown",
    "allowed_uses": ["analysis"],
    "c2pa": {"status": "absent"}
  },
  "processing": {
    "status": "ready",
    "parser": "docling",
    "parser_version": "...",
    "artifacts": ["art_layout_...", "art_pages_..."]
  },
  "quality": {"ocr_confidence": 0.94, "warnings": []}
}
```

### Content Graph Record

```json
{
  "node_id": "clm_01J...",
  "type": "claim",
  "value": "The endpoint allowed unauthenticated access.",
  "confidence": 0.91,
  "source_regions": [
    {"asset_id": "ast_...", "page": 7, "bbox": [0.08, 0.21, 0.91, 0.48], "text_span": [412, 486]}
  ],
  "derivation": {
    "kind": "vlm_interpretation",
    "model": "vision-provider/model-version",
    "input_nodes": ["reg_..."],
    "created_at": "2026-07-23T00:00:00Z"
  },
  "edges": [
    {"type": "supported_by", "target": "reg_..."},
    {"type": "contradicts", "target": "clm_..."}
  ]
}
```

### Style Profile

```json
{
  "style_profile_id": "sty_01J...",
  "tokens": {
    "color.brand.primary": {"$type": "color", "$value": "#17324D", "confidence": 0.98},
    "space.section": {"$type": "dimension", "$value": "48px", "confidence": 0.82},
    "font.heading.family": {"$type": "fontFamily", "$value": ["Inter", "Arial"], "confidence": 0.95}
  },
  "composition": {
    "grid": "12-column editorial",
    "density": "airy",
    "image_treatment": "full-bleed with dark overlay",
    "rules": ["one dominant focal point per canvas", "left-align long-form copy"]
  },
  "sources": [
    {"asset_id": "ast_...", "region_id": "reg_...", "kind": "native_theme"}
  ],
  "overrides": {"pptx": {}, "docx": {}, "web": {}}
}
```

### QA Report

```json
{
  "run_id": "qa_01J...",
  "artifact_id": "out_...",
  "render": {"engine": "chromium", "viewport": [1440, 1000], "screenshots": ["blob_..."]},
  "checks": [
    {"id": "overflow", "severity": "error", "status": "pass"},
    {"id": "contrast", "severity": "error", "status": "fail", "location": "slide:4/title"},
    {"id": "unsupported_claim", "severity": "error", "status": "pass"}
  ],
  "critic": {
    "rubric_version": "design-v1",
    "scores": {"hierarchy": 4, "coherence": 5, "legibility": 3, "asset_fitness": 4},
    "findings": ["Slide 4 title loses contrast over the image."]
  },
  "repairs": [{"iteration": 1, "patches": ["patch_..."], "result": "improved"}],
  "decision": "blocked"
}
```

## 5. Provenance 与置信度规则

- 永不覆盖原件、parser 观察或先前模型解释；追加版本化衍生。
- 输出中每个事实性句子必须能解析到一个或多个来源区域，或标注为 generated/editorial 内容。
- 置信度属于字段或断言，不属于整份文档。分别记录 parser 置信度、模型置信度、跨源一致与人工确认。
- 矛盾保留为一等图边。不要合并成虚假确定的摘要。
- 在检索与导出时强制权利状态，如 `approved`、`analysis_only`、`restricted`、`unknown`、`generated`。
- 权利未知的素材可用于风格分析，但默认不应进入公开产物。
- 为生成文本、图片与修复记录 model/provider/version、prompt 模板版本、输入节点 ID、变换参数与时间戳。

## 6. 视觉质量闭环

先跑更便宜的确定性检查，再做模型批评：

- schema 有效性、缺失字体/素材、断链与导出失败；
- overflow、裁切、重叠、安全区、最低字号、对比度与阅读顺序；
- Web 的响应式断点，以及文档的页/幻灯片边界；
- 引用完整性、缺失证据说明、重复图片与权利违规；
- 密度、对齐、token 一致性、图片分辨率与宽高比失真。

然后渲染真实产物，并让 VLM critic 按固定 rubric 返回结构化发现：层级、可读性、构图、连贯性、风格遵循、断言-证据蕴含、素材适配、无障碍，以及输出特定可用性。引用是否存在与区域是否有效是确定性检查；证据是否在语义上支持断言是概率性的，需要模型或人工审阅。给修复 agent 的应是发现、受影响元素 ID、来源约束，以及输出特定 artifact 表示，而不是要求整份重生。

最多三次修复迭代。仅当 hard checks 仍通过、目标分数提升且别处无明显回退时才接受 patch。保留截图与分数用于回归测试，但对高风险报告与对外发布要求人工审批。

建议发布门槛：

- 零导出、overflow、缺失素材、无来源断言与权利错误；
- 普通 Web 文本达到 WCAG AA 对比度，除非有书面例外；
- 所有证据图链接到来源区域；
- 可读性、层级、连贯性与事实 grounding 的 rubric 最低 4/5；
- 当 critic 与确定性检查在高严重度问题上分歧时，需显式审批。

## 7. 模型无关接口

暴露能力契约，而不是 provider 名称：

```text
parse_document(input) -> parser_artifact
ocr(regions, languages) -> observations
embed_text(items) -> vectors
embed_image(items) -> vectors
understand_visual(regions, schema) -> interpretations
generate_text(context, schema) -> structured_copy
generate_image(brief, constraints) -> generated_asset
critique(render_bundle, rubric) -> qa_findings
```

每个 adapter 声明支持的媒体、上下文限制、结构化输出可靠性、隐私地区、成本等级与降级行为。在 schema 校验后持久化规范输出。这样本地、托管与未来模型可互换，而不会用 provider 格式污染内容图。

## 8. 交付路线图

### Phase 1：证据安全 MVP

- 上传 PDF、PPTX、DOCX、图片与仓库。
- 不可变 manifest、Docling/原生提取、PaddleOCR 兜底，以及来源区域查看器。
- PostgreSQL/对象存储/Qdrant，混合图文检索。
- 带追问的 brief 生成。
- 一个 Web 渲染器与一个 PPTX 渲染器，经专用 `WebProject` 与 `DeckIR` 消费同一语义核心。
- 确定性校验 + 截图/VLM 批评，以及一次修复。

### Phase 2：风格与素材智能

- 原生 theme/CSS 提取与 DTCG token 编译器。
- 精确/近似重复图片流水线、聚类、角色分类与权利过滤。
- DOCX 输出、可复用风格配置、多断点 QA 与回归语料。

### Phase 3：生产控制

- C2PA 签名/校验、组织策略、审计 UI、人工审批工作流、成本/路由策略、parser/模型评测 harness，以及有界多 agent 编排。

## 9. 不要做什么

- 不要把所有输入压成 Markdown，并丢掉坐标、主题与关系。
- 不要把原始 VLM 说明直接放进终稿，而不做证据对齐。
- 不要把向量相似当作图片相关、已授权或事实有效的证明。
- 不要让 critic 用审美 prompt 改动去“修”二进制导出失败。
- 不要为局部缺陷重生整份文档；对稳定元素 ID 打 patch。
- 不要一边声称“模型无关”，一边把某个 provider 的消息或 tool-call schema 当作领域模型持久化。
- 不要用单一审美奖励分定义“好看”。质量必须组合约束、任务适配、视觉判断与用户审批。

## 10. 决策摘要

最稳且最短的路径是：**原生优先、证据保留的摄入层**，**带区域 provenance 的 typed 内容图**，**带 design.md/DTCG adapter 的内部风格配置**，以及**经渲染反馈修复的输出特定 artifact 表示**。开源项目可提供 parser、检索、渲染与有用 agent 模式，但没有一个已评估项目单独覆盖事实 provenance、风格模仿、素材权利、多格式渲染与视觉质量。这些关注点应作为产品架构中的显式契约保留。

---

英文原文：[reference-ingestion-architecture.md](./reference-ingestion-architecture.md)
