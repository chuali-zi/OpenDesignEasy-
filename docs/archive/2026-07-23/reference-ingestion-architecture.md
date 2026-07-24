# Design Agent: Reference Ingestion and Visual Quality Architecture

> Archive status: retained as research evidence from 2026-07-23. The adopted architecture and current specifications live under `docs/architecture.md` and `docs/spec/`.

> Research snapshot: 2026-07-23. Activity dates below are the latest upstream commits observed during research, not release dates. Licenses cover repositories unless a separate model/license note is shown.

## 1. Recommendation

Build the system as five replaceable layers rather than one large multimodal prompt:

1. **Ingestion gateway** preserves originals, detects file type, extracts native structure, and invokes OCR only where needed.
2. **Content graph** stores claims, visual regions, relationships, confidence, and source-level provenance.
3. **Style compiler** converts native themes and inferred visual traits into portable design tokens plus composition rules.
4. **Design compilers** consume the shared semantic core and produce dedicated `WebProject`, `DeckIR`, or `ReportIR` representations for their renderers.
5. **Quality loop** combines deterministic validation, rendered screenshots, multimodal criticism, and bounded repairs.

Recommended initial stack:

- Docling as the primary PDF/DOCX/PPTX/image parser, with native OOXML/CSS extraction ahead of rendered-image inference.
- Unstructured as a connector and partitioning fallback; PaddleOCR for difficult OCR and multilingual screenshots.
- PostgreSQL/object storage as the system of record and Qdrant for visual/text retrieval. Keep graph records in PostgreSQL first; add a graph database only after queries require it.
- OpenCLIP embeddings plus cryptographic and perceptual hashes for image retrieval and deduplication.
- An internal StyleProfile with tested design.md and DTCG import/export adapters as the portable style contract.
- Playwright for Web rendering, LibreOffice or equivalent headless rendering for PPTX/DOCX, and a provider-neutral VLM critic.
- C2PA metadata where available, backed by an internal provenance ledger for every asset and generated derivative.

MinerU and Marker should be optional parser adapters, not defaults, because their repository/model licensing needs more product-specific review.

## 2. Evaluated Projects

### Ingestion, OCR, and Layout

| Project | License | Latest activity | Best use | Important limitation |
|---|---|---:|---|---|
| [Docling](https://github.com/docling-project/docling) | MIT | 2026-07-23 | Default structured document conversion; page/layout/table/picture hierarchy | Native theme/style fidelity still requires OOXML/CSS-specific extraction |
| [MinerU](https://github.com/opendatalab/MinerU) | Apache-2.0 plus additional terms | 2026-07-10 | Strong PDF reading order, formulas, and tables | Online-service attribution; commercial-license thresholds must be reviewed before adoption |
| [Unstructured](https://github.com/Unstructured-IO/unstructured) | Apache-2.0 | 2026-07-15 | Broad connector ecosystem and partitioning fallback | Normalized elements lose some authoring-tool semantics |
| [Marker](https://github.com/datalab-to/marker) | Apache-2.0 code | 2026-07-20 | Fast PDF-to-Markdown/JSON conversion | Model weights use a modified OpenRAIL-M license and need separate review |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0 | 2026-07-22 | Multilingual OCR, document orientation, tables | OCR output needs a separate semantic/layout reconciliation pass |
| [olmOCR](https://github.com/allenai/olmocr) | Apache-2.0 | 2026-03-25 | High-quality PDF transcription and reading order | More specialized than a complete mixed-asset ingestion layer |
| [MarkItDown](https://github.com/microsoft/markitdown) | MIT | 2026-07-21 | Lightweight text conversion for indexing and previews | Not a sufficient layout/style representation on its own |

Selection rule: use native extraction first, structural conversion second, OCR third, and VLM interpretation last. A rendered screenshot is evidence about appearance, not a replacement for editable source structure.

### Multimodal Retrieval and Graph Construction

| Project | License | Latest activity | Best use | Important limitation |
|---|---|---:|---|---|
| [RAG-Anything](https://github.com/HKUDS/RAG-Anything) | MIT | 2026-07-20 | Reference architecture for routing text/image/table/equation modalities into graph-aware RAG | Its graph schema is not a complete design/provenance schema |
| [RAGFlow](https://github.com/infiniflow/ragflow) | Apache-2.0 | 2026-07-23 | Full document-RAG product and chunking reference | Heavy platform dependency if only its parser/retrieval pieces are needed |
| [ColPali](https://github.com/illuin-tech/colpali) | MIT | 2026-06-10 | Page-image retrieval that retains visual layout cues | GPU/storage cost; results still need region-level evidence links |
| [GraphRAG](https://github.com/microsoft/graphrag) | MIT | 2026-07-18 | Entity/community extraction patterns for large corpora | Expensive and unnecessary for a small per-project reference set |
| [Qdrant](https://github.com/qdrant/qdrant) | Apache-2.0 | 2026-07-17 | Text and image vector retrieval with metadata filters | It is not the authoritative provenance or relationship store |

### Style, Images, Provenance, and QA

| Project | License | Latest activity | Role |
|---|---|---:|---|
| [Style Dictionary](https://github.com/style-dictionary/style-dictionary) | Apache-2.0 | 2026-06-21 | Transform normalized design tokens into target-specific formats |
| [OpenCLIP](https://github.com/mlfoundations/open_clip) | MIT code; verify each weight dataset/license | 2026-07-17 | Cross-modal image/text retrieval and semantic clustering |
| [imagededup](https://github.com/idealo/imagededup) | Apache-2.0 | 2025-08-15 | Perceptual/embedding deduplication reference |
| [C2PA Rust SDK](https://github.com/contentauth/c2pa-rs) | MIT OR Apache-2.0 | 2026-07-22 | Read/write signed content credentials where available |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | 2026-07-23 | Deterministic browser rendering, viewport testing, and screenshots |
| [BackstopJS](https://github.com/garris/BackstopJS) | MIT | 2024-09-07 | Visual-regression workflow reference; activity is comparatively low |
| [ImageReward](https://github.com/zai-org/ImageReward) | Apache-2.0 code; verify weights | 2025-10-29 | Optional image preference signal, never the sole design-quality judge |

Model weights, training datasets, and generated-output terms must be reviewed separately from repository licenses.

### Comparable Agents

| Project | License | Latest activity | Reusable idea |
|---|---|---:|---|
| [PPTAgent / DeepPresenter](https://github.com/icip-cas/PPTAgent) | MIT | 2026-06-28 | Planner/research/design separation, browser rendering, slide inspection, and content/visual/coherence evaluation |
| [screenshot-to-code](https://github.com/abi/screenshot-to-code) | MIT | 2026-07-22 | Tool-state loop, asset extraction, desktop/mobile screenshots returned to the model |
| [OpenUI](https://github.com/wandb/openui) | Apache-2.0 | 2026-06-30 | Conversational UI generation and live previews |
| [OmniParser](https://github.com/microsoft/OmniParser) | MIT | 2026-07-20 | Screenshot region detection and semantic grounding |
| [UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop) | Apache-2.0 | 2026-07-01 | Visual computer-use agent patterns and model/tool separation |

Useful implementation entry points:

- [DeepPresenter orchestration](https://github.com/icip-cas/PPTAgent/blob/main/deeppresenter/main.py)
- [DeepPresenter render and reflection tools](https://github.com/icip-cas/PPTAgent/blob/main/deeppresenter/tools/reflect.py)
- [PPTEval evaluation pipeline](https://github.com/icip-cas/PPTAgent/blob/main/pptagent/ppteval/ppteval.py)
- [screenshot-to-code agent loop](https://github.com/abi/screenshot-to-code/blob/main/backend/agent/engine.py)
- [screenshot-to-code Playwright renderer](https://github.com/abi/screenshot-to-code/blob/main/backend/preview_screenshot/playwright_backend.py)
- [screenshot-to-code asset extraction](https://github.com/abi/screenshot-to-code/blob/main/backend/asset_extraction.py)
- [RAG-Anything parser registry](https://github.com/HKUDS/RAG-Anything/blob/main/raganything/parser.py)
- [RAG-Anything modality processors](https://github.com/HKUDS/RAG-Anything/blob/main/raganything/modalprocessors.py)

## 3. End-to-End Pipeline

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

### 3.1 Upload and Manifest

- Store every original as an immutable blob identified by SHA-256.
- Detect MIME from bytes, not the filename; run archive-bomb, malware, size, and page-count guards.
- Record ownership, source URL, declared license, C2PA state, consent, and allowed output contexts before retrieval.
- Version parser output independently so a parser upgrade does not mutate old evidence.

### 3.2 Structural Extraction

- **PPTX:** read theme, masters, layouts, placeholders, relationships, text runs, geometry, crop, and z-order before rendering slides.
- **DOCX:** read styles, theme, numbering, sections, headers/footers, tables, drawings, and tracked metadata before page rendering.
- **Web/repository:** parse source and CSSOM; capture computed styles at representative breakpoints; index README, code symbols, tests, diagrams, and existing assets.
- **PDF/image:** recover page geometry, text blocks, tables, figures, and reading order; OCR image-only, missing-text, or low-confidence regions. Treat every OCR result as untrusted input.
- Keep parser observations separate from model interpretations. For example, `font_size=24pt` is an observation; `visual_role=section_heading` is an interpretation.

### 3.3 Content Graph

Use typed nodes such as `document`, `page`, `region`, `claim`, `entity`, `event`, `table`, `figure`, `code_symbol`, `requirement`, and `style_observation`. Use typed edges such as `contains`, `supports`, `contradicts`, `depicts`, `references`, `derived_from`, `same_as`, and `near_duplicate_of`.

Retrieval should return a bundle rather than an isolated chunk:

- the requested node;
- its source region and page screenshot;
- parent/child context;
- supporting and contradicting evidence;
- license and usage constraints;
- text and visual similarity scores.

### 3.4 Intent and Clarification Gate

Generate an explicit brief containing audience, goal, output type, required facts, desired tone, style references, must-use assets, forbidden assets, and unresolved questions. Ask the user only when an unresolved item would materially alter factual correctness, rights, brand, or document structure. Cosmetic ambiguities can be handled with stated defaults.

### 3.5 Style Compilation

Extract style in this priority order:

1. Native themes, masters, named styles, CSS variables, and computed styles.
2. Repeated geometry: grids, margins, rhythm, radius, border, image treatment, and density.
3. Rendered-page analysis: palette, typography roles, alignment, whitespace, and visual hierarchy.
4. VLM descriptions for semantic traits that cannot be measured directly.

Normalize the result into DTCG-compatible tokens plus rules that tokens alone cannot express:

- tokens: color, typography, spacing, size, border, radius, shadow, motion;
- composition: grid, hierarchy, density, image/text ratio, alignment, recurring motifs;
- examples: representative crops linked to their source regions;
- confidence: observed, inferred, or user-declared per value;
- output overrides: Web, slide, and document-specific constraints.

Do not copy a reference literally unless the user has requested replication and usage rights permit it. Style similarity should preserve high-level visual grammar while content and composition remain task-specific.

### 3.6 Image Pipeline

1. Compute SHA-256 for exact duplicates.
2. Normalize orientation/color profile and compute pHash/dHash for near duplicates.
3. Detect crops and screenshots that contain other candidate assets.
4. Create OpenCLIP embeddings for text-image retrieval and a visual-only embedding when fine-grained appearance matters.
5. Cluster per project with HDBSCAN; use UMAP only for inspection, not as the retrieval representation.
6. Assign role candidates such as evidence, logo, product UI, portrait, diagram, decoration, background, or unsafe/irrelevant.
7. Rank by semantic relevance, visual quality, aspect-ratio fitness, uniqueness, rights, and source confidence.
8. Preserve crop/resize/generation lineage for every derivative.

Evidence screenshots must never be silently treated as decorative assets. Generated images must be labeled and must not replace factual screenshots, charts, equations, or test evidence without explicit disclosure.

## 4. Core Data Contracts

These examples show the minimum durable information. Provider-specific model responses should be stored only as debug artifacts, not as application contracts.

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

## 5. Provenance and Confidence Rules

- Never overwrite originals, parser observations, or previous model interpretations; append versioned derivations.
- Every factual sentence in an output must resolve to one or more source regions or be labeled as generated/editorial content.
- Confidence belongs to a field or claim, not to an entire document. Record parser confidence, model confidence, cross-source agreement, and human confirmation separately.
- Contradictions remain first-class graph edges. Do not merge them into a falsely certain summary.
- Enforce rights at retrieval and export time with states such as `approved`, `analysis_only`, `restricted`, `unknown`, and `generated`.
- An asset with unknown rights may inform style analysis but should not be emitted into a public artifact by default.
- Record model/provider/version, prompt template version, input node IDs, transformation parameters, and timestamps for generated text, images, and repairs.

## 6. Visual Quality Loop

Run cheaper deterministic checks before model criticism:

- schema validity, missing fonts/assets, broken links, and export failures;
- overflow, clipping, overlap, safe areas, minimum font size, contrast, and reading order;
- responsive breakpoints for Web and page/slide bounds for documents;
- citation integrity, missing evidence captions, duplicate images, and rights violations;
- density, alignment, token consistency, image resolution, and aspect-ratio distortion.

Then render the actual artifact and ask a VLM critic to return structured findings against a fixed rubric: hierarchy, legibility, composition, coherence, style adherence, claim-evidence entailment, asset fitness, accessibility, and output-specific usability. Citation existence and region validity are deterministic checks; whether evidence semantically supports a claim is probabilistic and requires a model or human review. Give the repair agent the finding, affected element IDs, source constraints, and output-specific artifact representation rather than asking it to regenerate the whole artifact.

Use a maximum of three repair iterations. Accept a patch only if hard checks still pass and the targeted score improves without a significant regression elsewhere. Keep screenshots and scores for regression testing, but require human approval for high-stakes reports and externally published work.

Suggested release gates:

- zero export, overflow, missing-asset, unsupported-claim, and rights errors;
- WCAG AA contrast for normal Web text unless a documented exception exists;
- all evidence figures linked to source regions;
- minimum rubric score 4/5 for legibility, hierarchy, coherence, and factual grounding;
- explicit approval when the critic and deterministic checks disagree on a high-severity issue.

## 7. Model-Agnostic Interfaces

Expose capability contracts rather than provider names:

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

Each adapter declares supported media, context limits, structured-output reliability, privacy region, cost class, and fallback behavior. Persist canonical outputs after schema validation. This makes local, hosted, and future models interchangeable without contaminating the content graph with provider formats.

## 8. Delivery Roadmap

### Phase 1: Evidence-Safe MVP

- Upload PDF, PPTX, DOCX, images, and repositories.
- Immutable manifest, Docling/native extraction, PaddleOCR fallback, and source-region viewer.
- PostgreSQL/object storage/Qdrant with hybrid text-image retrieval.
- Brief generation with clarification questions.
- One Web renderer and one PPTX renderer consuming the same semantic core through dedicated `WebProject` and `DeckIR` representations.
- Deterministic validation plus screenshot/VLM critique and one repair pass.

### Phase 2: Style and Asset Intelligence

- Native theme/CSS extraction and DTCG token compiler.
- Exact/near-duplicate image pipeline, clustering, role classification, and rights filters.
- DOCX output, reusable style profiles, multi-breakpoint QA, and regression corpus.

### Phase 3: Production Controls

- C2PA signing/verification, organization policy, audit UI, human approval workflow, cost/routing policies, parser/model evaluation harness, and bounded multi-agent orchestration.

## 9. What Not to Do

- Do not flatten every input to Markdown and discard coordinates, themes, and relationships.
- Do not place raw VLM captions directly into final copy without evidence reconciliation.
- Do not use vector similarity as proof that an image is relevant, licensed, or factually valid.
- Do not let the critic repair a binary export failure with aesthetic prompt changes.
- Do not regenerate an entire document for a local defect; patch stable element IDs.
- Do not claim “model agnostic” while persisting one provider's messages or tool-call schema as the domain model.
- Do not use a single aesthetic reward score as the definition of “good-looking.” Quality must combine constraints, task fitness, visual judgment, and user approval.

## 10. Decision Summary

The safest and shortest route is a **native-first, evidence-preserving ingestion layer**, a **typed content graph with region provenance**, an **internal style profile with design.md/DTCG adapters**, and **output-specific artifact representations repaired through rendered feedback**. Open-source projects can supply parsers, retrieval, rendering, and useful agent patterns, but no evaluated project alone covers factual provenance, style imitation, asset rights, multi-format rendering, and visual quality. Those concerns should remain explicit contracts in the product architecture.
