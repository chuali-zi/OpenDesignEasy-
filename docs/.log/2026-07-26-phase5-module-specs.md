# 2026-07-26 Phase 5 模块内部 Spec

产出三份 v0.1 草案：`design-intelligence-spec.md`、`artifact-production-spec.md`、
`quality-governance-spec.md`。本轮只写文档，未动代码，pytest 48 项基线保持通过。

本轮定下的五项决策：首个媒介 Web；首个场景「空白自然语言 → 产品官网」；候选表示为模型直出完整
HTML/CSS，批准时机械抽取 design contract（tokens + anchors）；模型编排为自建 vendor-neutral
capability harness，首批绑定 Kimi 与 Seedream；spike 与 ADR 单列，不在本轮执行。

关键取舍：「方向=代码本身」会让 DIRECTION 与 ARTIFACT_LOCAL 两条反馈路径失去区分依据。解法是把
区分点从表示形式移到作用域——方向反馈由 Design 重出整份，局部反馈由 Artifact 定点改写锚点片段，
并用确定性抽取的 design contract 让 Quality 能机械判定契约偏离，不依赖模型主观判断。

契约兼容性：`ports.py` 三个 Protocol 签名未改；domain 只规划两个新增可选字段
（`ApprovedDirection.design_contract`、`ArtifactRevision.files`）。

一处对计划的修正：`RightsStatus` 没有 `GENERATED` 值，生成图改为按服务条款落到
`ANALYSIS_ONLY` 或 `CLEARED_FOR_DELIVERY`，条款结论本身成为 spike 项 D5。

未覆盖：所选场景无原件输入，Phase 3 的解析与溯源路径在 Phase 6 得不到验证；已在 Spec 中显式标注，
并要求生成图走 SourceAsset + EvidenceRecord 以保留一条真实的权利检查路径。

同步更新：两个 README 索引、`implementation-plan.md` 的 Phase 5 状态/G4/G5/下一步、
`adr/README.md` 的 ADR-0002 与 ADR-0003 预告。
