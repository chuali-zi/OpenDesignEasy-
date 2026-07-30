[F0063] (directory_listing) Repository top level (after exclusions) contains directories: docs, lab30min, product-client, src, tests; and top-level files: .gitignore, AGENT.MD, README.md, nul, pyproject.toml.
[F0064] (python_module) Module `src/oeydesign/__init__.py` has 223 lines. Module docstring: "OEYdesign contract-first reference implementation."
[F0065] (python_module) Module `src/oeydesign/composition.py` has 74 lines. Module docstring: "Durable Phase 2 composition root."
[F0070] (python_class) Class `SQLiteApplication` is defined in `src/oeydesign/composition.py`. Has 4 method(s): __init__, close, __enter__, __exit__.
[F0071] (python_module) Module `src/oeydesign/context.py` has 616 lines. Module docstring: "Small, replaceable Context & Evidence reference adapters."
[F0078] (python_class) Class `LocalSourceStore` is defined in `src/oeydesign/context.py`. Has 6 method(s): __init__, put, ingest, read, get, _validate.
[F0082] (python_class) Class `CsvEvidenceParser` is defined in `src/oeydesign/context.py`. Fields: capability_version: str, supported_media_types: tuple[str, ...]. Has 3 method(s): parse, _record, _header_key.
[F0084] (python_class) Class `PngEvidenceParser` is defined in `src/oeydesign/context.py`. Fields: capability_version: str, supported_media_types: tuple[str, ...]. Has 1 method(s): parse.
[F0087] (python_class) Class `DeterministicEvidenceInterpreter` is defined in `src/oeydesign/context.py` inheriting from EvidenceInterpreterPort. Has 2 method(s): __init__, interpret.
[F0089] (python_class) Class `HumanEvidenceConfirmer` is defined in `src/oeydesign/context.py` inheriting from EvidenceConfirmationPort. Has 1 method(s): confirm.
[F0090] (python_function) Top-level function `def _interpretation_record(evidence: EvidenceRecord, value: Any, confidence: float, capability_version: str) -> EvidenceRecord` is defined in `src/oeydesign/context.py`.
[F0103] (python_class) Class `EvidenceService` is defined in `src/oeydesign/context.py`. Has 12 method(s): __init__, ingest, resolve, revise_rights, ingest_parse, draft_brief, confirm_brief, draft_constraints, confirm_constraints, record_interpretation, interpret, confirm.
[F0105] (python_class) Class `DeterministicContextAssembler` is defined in `src/oeydesign/context.py`. Has 1 method(s): assemble.
[F0106] (python_function) Top-level function `def _locator_ref(locator: SourceLocator) -> str` is defined in `src/oeydesign/context.py`.
[F0107] (python_module) Module `src/oeydesign/control.py` has 1226 lines. Module docstring: "Project Control Plane: the only writer of Project business state."
[F0143] (python_class) Class `QuantumControlPlane` is defined in `src/oeydesign/control.py`. Has 35 methods.
[F0144] (python_module) Module `src/oeydesign/domain.py` has 689 lines. Module docstring: "Vendor-neutral domain language shared by every OEYdesign adapter."
[F0145] (python_function) Top-level function `def utc_now() -> datetime` is defined in `src/oeydesign/domain.py`.
[F0146] (python_function) Top-level function `def _json_default(value: object) -> object` is defined in `src/oeydesign/domain.py`.
[F0147] (python_function) Top-level function `def canonical_json(value: object) -> str` is defined in `src/oeydesign/domain.py`. Docstring: "Return the stable representation used for fingerprints and stub IDs."
[F0148] (python_function) Top-level function `def stable_id(prefix: str, *parts: object) -> str` is defined in `src/oeydesign/domain.py`.
[F0149] (python_class) Class `ProjectState` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0150] (python_class) Class `ErrorCategory` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0151] (python_class) Class `ConstraintPreset` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0152] (python_class) Class `TemplateRole` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0153] (python_class) Class `FeedbackKind` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0154] (python_class) Class `ApprovalAction` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0155] (python_class) Class `WorkflowStatus` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0156] (python_class) Class `GateVerdict` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0157] (python_class) Class `FindingKind` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0158] (python_class) Class `CheckpointStatus` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0159] (python_class) Class `SideEffectStatus` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0160] (python_class) Class `SideEffectReconciliationStatus` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0161] (python_class) Class `SourceKind` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0162] (python_class) Class `EvidenceLayer` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0163] (python_class) Class `RightsStatus` is defined in `src/oeydesign/domain.py` inheriting from StrEnum. Has no methods.
[F0165] (python_class) Class `ContractError` is defined in `src/oeydesign/domain.py` inheriting from Exception. Has 1 method(s): __init__.
[F0166] (python_class) Class `ConstraintSetting` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: level: str, source: str, value: str. Has no methods.
[F0167] (python_class) Class `ConstraintProfile` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: preset: ConstraintPreset, template_role: TemplateRole, facts_evidence: ConstraintSetting, content_narrative: ConstraintSetting, brand_style: ConstraintSetting, composition_template: ConstraintSetting, delivery_properties: ConstraintSetting, runtime_permissions: ConstraintSetting. Has no methods.
[F0168] (python_function) Top-level function `def constraint_profile(preset: ConstraintPreset = ConstraintPreset.DESIGN_GUIDED, template_role: TemplateRole = TemplateRole.REFERENCE_SAMPLE) -> ConstraintProfile` is defined in `src/oeydesign/domain.py`.
[F0169] (python_class) Class `DesignBrief` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: goal: str, audience: str, medium: str, acceptance_direction: str. Has no methods.
[F0170] (python_class) Class `ContextPackage` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, project_id: str, revision: int, confirmed_facts: tuple[str, ...], source_refs: tuple[str, ...], material_uncertainties: tuple[str, ...], evidence_refs: tuple[SourceLocator, ...], analysis_asset_refs: tuple[SourceLocator, ...], delivery_asset_refs: tuple[SourceLocator, ...], brief_record_id: str | None, brief_record_revision: int | None, constraint_record_id: str | None, constraint_record_revision: int | None, metadata: Mapping[str, Any]. Has no methods.
[F0171] (python_class) Class `SourceAsset` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, project_id: str, revision: int, kind: SourceKind, original_name: str, media_type: str, byte_size: int, sha256_digest: str, storage_ref: str, rights: RightsStatus. Has no methods.
[F0172] (python_class) Class `SourceLocator` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: source_id: str, source_revision: int, selector: Mapping[str, Any]. Has no methods.
[F0173] (python_class) Class `EvidenceRecord` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, project_id: str, revision: int, layer: EvidenceLayer, evidence_key: str, value: Any, locator: SourceLocator, confidence: float, derived_from: tuple[str, ...], rights: RightsStatus, capability_version: str. Has no methods.
[F0174] (python_class) Class `BriefRecord` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, project_id: str, revision: int, brief: DesignBrief, confirmed: bool. Has no methods.
[F0175] (python_class) Class `ConstraintProfileRecord` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, project_id: str, revision: int, profile: ConstraintProfile, confirmed: bool. Has no methods.
[F0176] (python_class) Class `ContextRequirements` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: required_fact_keys: tuple[str, ...], required_delivery_source_ids: tuple[str, ...], minimum_interpretation_confidence: float. Has no methods.
[F0177] (python_class) Class `Lineage` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: project_id: str, workflow_run_id: str, capability_version: str. Has no methods.
[F0178] (python_class) Class `Command` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: command_id: str, project_id: str | None, expected_project_revision: int | None. Has no methods.
[F0179] (python_class) Class `CreateProject` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: name: str, preset: ConstraintPreset, template_role: TemplateRole, constraints: ConstraintProfile | None. Has no methods.
[F0180] (python_class) Class `PrepareProject` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: context_package: ContextPackage | None, brief: DesignBrief | None. Has no methods.
[F0181] (python_class) Class `GenerateCandidates` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: candidate_count: int. Has no methods.
[F0182] (python_class) Class `ApproveDirection` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: candidate_id: str, candidate_revision: int, impact: str. Has no methods.
[F0183] (python_class) Class `SubmitFeedback` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: kind: FeedbackKind, target_id: str, target_revision: int, text: str, object_ref: str | None. Has no methods.
[F0184] (python_class) Class `ProduceArtifact` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: medium: str, fidelity_mode: str. Has no methods.
[F0185] (python_class) Class `ValidateArtifact` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: render_profile: Mapping[str, Any]. Has no methods.
[F0186] (python_class) Class `ApproveExport` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: artifact_id: str, artifact_revision: int, impact: str. Has no methods.
[F0187] (python_class) Class `DeliverArtifact` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: delivery_profile: Mapping[str, Any]. Has no methods.
[F0188] (python_class) Class `CancelWorkflow` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: workflow_run_id: str, reason: str. Has no methods.
[F0189] (python_class) Class `PauseWorkflow` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: workflow_run_id: str, reason: str. Has no methods.
[F0190] (python_class) Class `ResumeWorkflow` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: workflow_run_id: str, resume_input: Mapping[str, Any]. Has no methods.
[F0191] (python_class) Class `ReconcileWorkflowStatus` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: workflow_run_id: str. Has no methods.
[F0192] (python_class) Class `RestoreProjectRevision` is defined in `src/oeydesign/domain.py` inheriting from Command decorated with dataclass(frozen=True, slots=True, kw_only=True). Fields: source_revision: int. Has no methods.
[F0193] (python_class) Class `DomainEvent` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, sequence: int, project_id: str, project_revision: int, event_type: str, occurred_at: datetime, payload: Mapping[str, Any]. Has no methods.
[F0194] (python_class) Class `WorkflowProgressEvent` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: sequence: int, event_type: str, stage: str, message: str, id: str, project_id: str, occurred_at: datetime | None, details: Mapping[str, Any]. Has no methods.
[F0195] (python_class) Class `WorkflowRun` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, project_id: str, workflow_kind: str, input_revision: int, idempotency_key: str, status: WorkflowStatus, current_stage: str, completed_stages: tuple[str, ...], side_effect_keys: tuple[str, ...], events: tuple[WorkflowProgressEvent, ...], pause_reason: str | None, error_category: ErrorCategory | None, error_message: str | None, attempt: int, max_attempts: int. Has no methods.
[F0196] (python_class) Class `StageCheckpoint` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: run_id: str, stage: str, input_fingerprint: str, status: CheckpointStatus, attempt: int, output_refs: tuple[str, ...], error_category: ErrorCategory | None, error_message: str | None, side_effect_key: str | None. Has no methods.
[F0197] (python_class) Class `AuditEntry` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, sequence: int, project_id: str, workflow_run_id: str | None, action: str, outcome: str, project_revision: int | None, metadata: Mapping[str, Any], occurred_at: datetime. Has no methods.
[F0198] (python_class) Class `SideEffectRecord` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: key: str, project_id: str, action: str, target_revision: int, status: SideEffectStatus, result: Mapping[str, Any] | None, error: str | None. Has no methods.
[F0199] (python_class) Class `DesignStrategy` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, lineage: Lineage, context_package_id: str, brief: DesignBrief, constraints: ConstraintProfile, candidate_count: int. Has no methods.
[F0200] (python_class) Class `Candidate` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, revision: int, parent_revision: int | None, lineage: Lineage, title: str, concept: str, preview_html: str, creative_owner: str, template_role: TemplateRole, constraints: ConstraintProfile, source_refs: tuple[str, ...]. Has no methods.
[F0201] (python_class) Class `Approval` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, project_id: str, action: ApprovalAction, target_id: str, target_revision: int, impact: str, active: bool, invalidated_reason: str | None. Has no methods.
[F0202] (python_class) Class `ApprovedDirection` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, lineage: Lineage, candidate_id: str, candidate_revision: int, approval_id: str, baseline_preview_html: str. Has no methods.
[F0203] (python_class) Class `ArtifactRevision` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, revision: int, parent_revision: int | None, lineage: Lineage, direction_id: str, medium: str, fidelity_mode: str, content: str, object_refs: Mapping[str, str], tradeoffs: tuple[str, ...]. Has no methods.
[F0204] (python_class) Class `RenderBundle` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, revision: int, lineage: Lineage, artifact_id: str, artifact_revision: int, rendered_content: str, profile: Mapping[str, Any]. Has no methods.
[F0205] (python_class) Class `ExportCandidate` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, revision: int, lineage: Lineage, artifact_id: str, artifact_revision: int, exported_content: str, manifest: Mapping[str, Any]. Has no methods.
[F0206] (python_class) Class `Finding` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: kind: FindingKind, code: str, message: str, severity: str, target_ref: str, repairable: bool. Has no methods.
[F0207] (python_class) Class `QualityDecision` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, revision: int, lineage: Lineage, target_kind: str, target_id: str, target_revision: int, artifact_id: str | None, artifact_revision: int | None, aesthetic_findings: tuple[Finding, ...], hard_errors: tuple[Finding, ...], risks: tuple[str, ...], verdict: GateVerdict. Has no methods.
[F0208] (python_class) Class `RemediationRequest` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, target_id: str, target_revision: int, instructions: tuple[str, ...], protected_constraints: ConstraintProfile, max_attempts: int. Has no methods.
[F0209] (python_class) Class `GateDecision` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: authorized: bool, requested_action: str, quality_decision_id: str, approval_ids: tuple[str, ...], reason: str. Has no methods.
[F0210] (python_class) Class `DeliveryBundle` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, revision: int, lineage: Lineage, artifact_id: str, artifact_revision: int, export_id: str, quality_decision_id: str, approval_id: str, side_effect_key: str, manifest: Mapping[str, Any]. Has no methods.
[F0211] (python_class) Class `DeliveryReconciliation` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: status: SideEffectReconciliationStatus, bundle: DeliveryBundle | None, reason: str. Has no methods.
[F0212] (python_class) Class `FeedbackRecord` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: id: str, kind: FeedbackKind, target_id: str, target_revision: int, text: str, object_ref: str | None, routed_to: tuple[str, ...]. Has no methods.
[F0213] (python_class) Class `Project` is defined in `src/oeydesign/domain.py` decorated with dataclass(slots=True). Fields: id: str, name: str, constraints: ConstraintProfile, revision: int, state: ProjectState, context_package: ContextPackage | None, brief: DesignBrief | None, strategy: DesignStrategy | None, candidates: dict[str, Candidate], candidate_history: list[Candidate], approved_direction: ApprovedDirection | None, current_artifact: ArtifactRevision | None, artifact_history: list[ArtifactRevision], current_render: RenderBundle | None, render_history: list[RenderBundle], current_export: ExportCandidate | None, export_history: list[ExportCandidate], current_quality: QualityDecision | None, quality_history: list[QualityDecision], approvals: dict[str, Approval], deliveries: list[DeliveryBundle], feedback: list[FeedbackRecord], events: list[DomainEvent], active_run_id: str | None, status_reason: str | None, resume_state: ProjectState | None, restored_from_revision: int | None. Has no methods.
[F0214] (python_class) Class `CommandResult` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: project_id: str, project_revision: int, state: ProjectState, event_ids: tuple[str, ...], value: Any. Has no methods.
[F0215] (python_class) Class `CommandRecord` is defined in `src/oeydesign/domain.py` decorated with dataclass(frozen=True, slots=True). Fields: fingerprint: str, result: CommandResult. Has no methods.
[F0216] (python_module) Module `src/oeydesign/evidence_persistence.py` has 286 lines. Module docstring: "SQLite persistence adapter for evidence, sources, and context packages."
[F0229] (python_class) Class `SQLiteEvidenceRepository` is defined in `src/oeydesign/evidence_persistence.py`. Has 12 method(s): __init__, _collision, _decode, add_source, get_source, list_sources, add_evidence, get_evidence, list_evidence, save_context, _validate_locators, latest_context.
[F0230] (python_module) Module `src/oeydesign/memory.py` has 316 lines. Module docstring: "In-memory reference adapters used by Phase 1 conformance tests."
[F0238] (python_class) Class `InMemoryProjectRepository` is defined in `src/oeydesign/memory.py`. Has 7 method(s): __init__, add, get, list_projects, save, get_revision, list_revisions.
[F0242] (python_class) Class `InMemoryCommandLedger` is defined in `src/oeydesign/memory.py`. Has 3 method(s): __init__, get, record.
[F0253] (python_class) Class `InMemoryWorkflowRuntime` is defined in `src/oeydesign/memory.py`. Has 10 method(s): __init__, start, resume, pause, cancel, query, complete, checkpoint, get_checkpoint, _get.
[F0254] (python_module) Module `src/oeydesign/paths.py` has 30 lines. Module docstring: "Filesystem policy helpers for durable local state."
[F0255] (python_function) Top-level function `def resolve_database_path(database: str | Path, data_root: str | Path | None = None) -> str` is defined in `src/oeydesign/paths.py`. Docstring: "Return a validated SQLite path, preventing writes outside ``data_root``."
[F0256] (python_module) Module `src/oeydesign/persistence.py` has 577 lines. Module docstring: "SQLite reference persistence adapters for Phase 2."
[F0261] (python_class) Class `SQLiteStore` is defined in `src/oeydesign/persistence.py`. Has 4 method(s): __init__, close, _migrate, transaction.
[F0271] (python_class) Class `SQLiteProjectRepository` is defined in `src/oeydesign/persistence.py`. Has 9 method(s): __init__, add, _read, get, list_projects, get_revision, list_revisions, save, _append_events.
[F0275] (python_class) Class `SQLiteCommandLedger` is defined in `src/oeydesign/persistence.py`. Has 3 method(s): __init__, get, record.
[F0278] (python_class) Class `SQLiteEventStore` is defined in `src/oeydesign/persistence.py`. Has 2 method(s): __init__, after_sequence.
[F0282] (python_class) Class `SQLiteAuditLog` is defined in `src/oeydesign/persistence.py`. Has 3 method(s): __init__, record, query.
[F0288] (python_class) Class `SQLiteSideEffectLedger` is defined in `src/oeydesign/persistence.py`. Has 5 method(s): __init__, claim, complete, get, fail.
[F0293] (python_class) Class `SQLiteTransactionalProjectWriter` is defined in `src/oeydesign/persistence.py`. Has 4 method(s): __init__, add_with_command, save_with_command, _record.
[F0294] (python_module) Module `src/oeydesign/ports.py` has 380 lines. Module docstring: "Replaceable, vendor-neutral ports for the Phase 1 contract."
[F0299] (python_class) Class `ProjectRepository` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 4 method(s): add, get, list_projects, save.
[F0302] (python_class) Class `RevisionedProjectRepository` is defined in `src/oeydesign/ports.py` inheriting from ProjectRepository, Protocol. Has 2 method(s): get_revision, list_revisions.
[F0305] (python_class) Class `CommandLedger` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 2 method(s): get, record.
[F0308] (python_class) Class `TransactionalProjectWriter` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 2 method(s): add_with_command, save_with_command.
[F0310] (python_class) Class `ProjectEventStore` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 1 method(s): after_sequence.
[F0313] (python_class) Class `AuditLogPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 2 method(s): record, query.
[F0318] (python_class) Class `SideEffectLedgerPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 4 method(s): claim, complete, fail, get.
[F0321] (python_class) Class `SourceIngestionPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 2 method(s): ingest, read.
[F0323] (python_class) Class `EvidenceParserPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Fields: capability_version: str, supported_media_types: tuple[str, ...]. Has 1 method(s): parse.
[F0325] (python_class) Class `EvidenceInterpreterPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Fields: capability_version: str. Has 1 method(s): interpret.
[F0327] (python_class) Class `EvidenceConfirmationPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Fields: capability_version: str. Has 1 method(s): confirm.
[F0329] (python_class) Class `SourceResolverPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 1 method(s): resolve.
[F0338] (python_class) Class `EvidenceRepositoryPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 8 method(s): add_source, get_source, list_sources, add_evidence, get_evidence, list_evidence, save_context, latest_context.
[F0340] (python_class) Class `ContextAssemblerPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Fields: capability_version: str. Has 1 method(s): assemble.
[F0349] (python_class) Class `WorkflowRuntimePort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Has 8 method(s): start, resume, pause, cancel, query, complete, checkpoint, get_checkpoint.
[F0354] (python_class) Class `DesignIntelligencePort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Fields: capability_version: str. Has 4 method(s): plan_design, create_candidates, revise_candidate, commit_direction.
[F0359] (python_class) Class `ArtifactProductionPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Fields: capability_version: str. Has 4 method(s): materialize, apply_artifact_change, render_artifact, export_artifact.
[F0364] (python_class) Class `QualityGovernancePort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Fields: capability_version: str. Has 4 method(s): assess_candidate, assess_artifact, plan_remediation, authorize_transition.
[F0367] (python_class) Class `DeliveryPort` is defined in `src/oeydesign/ports.py` inheriting from Protocol. Fields: capability_version: str. Has 2 method(s): release, reconcile.
[F0368] (python_module) Module `src/oeydesign/product_shell.py` has 733 lines. Module docstring: "Dependency-free HTTP adapter for the recoverable Phase 4 product shell."
[F0369] (python_function) Top-level function `def _safe(value: Any) -> Any` is defined in `src/oeydesign/product_shell.py`.
[F0370] (python_function) Top-level function `def _constraints(p: Project) -> dict[str, Any]` is defined in `src/oeydesign/product_shell.py`.
[F0384] (python_class) Class `ProductShellService` is defined in `src/oeydesign/product_shell.py`. Has 13 method(s): __init__, _cid, _revision, _positive, _text, _enum, create_demo, projects, _actions, project, events, command, _profile.
[F0385] (python_function) Top-level function `def _not_found(error: ContractError) -> bool` is defined in `src/oeydesign/product_shell.py`.
[F0386] (python_function) Top-level function `def _default_static_dir() -> Path` is defined in `src/oeydesign/product_shell.py`.
[F0387] (python_function) Top-level function `def make_handler(service: ProductShellService, static_dir: str | Path | None = None) -> type[BaseHTTPRequestHandler]` is defined in `src/oeydesign/product_shell.py`.
[F0388] (python_function) Top-level function `def make_server(app: Any, host: str = '127.0.0.1', port: int = 0, static_dir: str | Path | None = None) -> ThreadingHTTPServer` is defined in `src/oeydesign/product_shell.py`.
[F0389] (python_function) Top-level function `def main(argv: list[str] | None = None) -> int` is defined in `src/oeydesign/product_shell.py`.
[F0390] (python_module) Module `src/oeydesign/recovery.py` has 180 lines. Module docstring: "Recovery-safe adapters for external effects."
[F0396] (python_class) Class `DurableDeliveryPort` is defined in `src/oeydesign/recovery.py`. Has 5 method(s): __init__, release, reconcile, _reconcile, _audit.
[F0397] (python_module) Module `src/oeydesign/runtime.py` has 809 lines. Module docstring: "SQLite-backed workflow runtime and deterministic failure injection."
[F0418] (python_class) Class `SQLiteWorkflowRuntime` is defined in `src/oeydesign/runtime.py`. Has 20 method(s): __init__, close, start, resume, pause, cancel, query, complete, checkpoint, get_checkpoint, list_checkpoints, record_failure, _migrate, _append_event, _run_row, _run_from_row, _event_from_row, _checkpoint_row, _checkpoint_from_row, _transaction.
[F0419] (python_class) Class `InjectedFailure` is defined in `src/oeydesign/runtime.py` decorated with dataclass(frozen=True, slots=True). Fields: category: ErrorCategory, message: str, remaining: int, timeout: bool. Has no methods.
[F0421] (python_class) Class `WorkflowStageError` is defined in `src/oeydesign/runtime.py` inheriting from Exception. Has 1 method(s): __init__.
[F0426] (python_class) Class `FailureInjector` is defined in `src/oeydesign/runtime.py`. Has 4 method(s): __init__, inject, inject_timeout, maybe_raise.
[F0427] (python_class) Class `StageExecution` is defined in `src/oeydesign/runtime.py` decorated with dataclass(frozen=True, slots=True). Fields: run: WorkflowRun, checkpoint: StageCheckpoint, reused: bool. Has no methods.
[F0431] (python_class) Class `RecoverableStageRunner` is defined in `src/oeydesign/runtime.py`. Has 3 method(s): __init__, run_stage, _failure_status.
[F0432] (python_module) Module `src/oeydesign/serialization.py` has 103 lines. Module docstring: "Versioned, dependency-free JSON serialization for OEYdesign domain values."
[F0433] (python_function) Top-level function `def _name(value: type[object]) -> str` is defined in `src/oeydesign/serialization.py`.
[F0434] (python_function) Top-level function `def _resolve(name: str) -> type[object]` is defined in `src/oeydesign/serialization.py`.
[F0435] (python_function) Top-level function `def _encode(value: Any) -> Any` is defined in `src/oeydesign/serialization.py`.
[F0436] (python_function) Top-level function `def _decode(value: Any) -> Any` is defined in `src/oeydesign/serialization.py`.
[F0437] (python_function) Top-level function `def dumps(value: Any) -> str` is defined in `src/oeydesign/serialization.py`. Docstring: "Encode a domain value in a schema-versioned JSON envelope."
[F0438] (python_function) Top-level function `def loads(payload: str) -> Any` is defined in `src/oeydesign/serialization.py`. Docstring: "Decode a payload produced by :func:`dumps`."
[F0439] (python_module) Module `src/oeydesign/stubs.py` has 528 lines. Module docstring: "Deterministic, side-effect-free implementations of the system ports."
[F0445] (python_class) Class `DeterministicDesignPort` is defined in `src/oeydesign/stubs.py`. Has 5 method(s): plan_design, create_candidates, revise_candidate, commit_direction, _preview.
[F0450] (python_class) Class `DeterministicArtifactPort` is defined in `src/oeydesign/stubs.py`. Has 4 method(s): materialize, apply_artifact_change, render_artifact, export_artifact.
[F0457] (python_class) Class `DeterministicQualityPort` is defined in `src/oeydesign/stubs.py`. Has 6 method(s): assess_candidate, assess_artifact, plan_remediation, authorize_transition, _decision, _hard_errors.
[F0462] (python_class) Class `DeterministicDeliveryPort` is defined in `src/oeydesign/stubs.py`. Has 4 method(s): __init__, release, reconcile, _build_bundle.
[F0463] (python_module) Module `lab30min/01_p1_tour.py` has 186 lines. Module docstring: "Lab 1 — 理解 Phase 1：契约骨架"
[F0464] (python_function) Top-level function `def show(title: str, value: object) -> None` is defined in `lab30min/01_p1_tour.py`.
[F0465] (python_function) Top-level function `def main() -> None` is defined in `lab30min/01_p1_tour.py`.
[F0466] (file_syntax_error) File `lab30min/handwrite.py` failed to parse as Python: invalid non-printable character U+FEFF (handwrite.py, line 1).
[F0467] (python_module) Module `lab30min/my_main.py` has 67 lines. Module docstring: "============================================================"
[F0468] (python_function) Top-level function `def main() -> None` is defined in `lab30min/my_main.py`.
[F0469] (python_module) Module `lab30min/my_main_blank.py` has 32 lines. Module docstring: "空白卷：自己默写流程。不会就看 my_main.py。"
[F0470] (python_function) Top-level function `def main() -> None` is defined in `lab30min/my_main_blank.py`.
[F0471] (python_module) Module `lab30min/simple_lab.py` has 137 lines. Module docstring: "给实验用的极简外壳：把 ControlPlane 藏起来，你只记「下一步叫什么」。"
[F0484] (python_class) Class `Lab` is defined in `lab30min/simple_lab.py`. Has 12 method(s): __init__, _send, create, prepare, generate, approve_direction, produce, validate, approve_export, deliver, state_path, summary.
[F0498] (test_file_count) File `tests/test_phase1_harness.py` contains 13 test function(s) (596 lines total).
[F0504] (test_file_count) File `tests/test_phase2_integration.py` contains 5 test function(s) (438 lines total).
[F0509] (test_file_count) File `tests/test_phase2_persistence.py` contains 4 test function(s) (183 lines total).
[F0513] (test_file_count) File `tests/test_phase2_runtime.py` contains 3 test function(s) (65 lines total).
[F0519] (test_file_count) File `tests/test_phase3_context.py` contains 5 test function(s) (313 lines total).
[F0523] (test_file_count) File `tests/test_phase3_evidence_persistence.py` contains 3 test function(s) (151 lines total).
[F0525] (test_file_count) File `tests/test_phase3_integration.py` contains 1 test function(s) (170 lines total).
[F0534] (test_file_count) File `tests/test_phase4_product_shell.py` contains 8 test function(s) (426 lines total).
[F0535] (test_count_aggregate) Repository has 8 test files under tests/ containing 42 test function(s) in total (statically counted via ast, tests not executed).
[F0536] (dependency) pyproject.toml declares 0 runtime dependencies (dependencies = []).
[F0537] (build_dependency) pyproject.toml [build-system] requires: setuptools>=68.
[F0538] (config) pyproject.toml requires-python = ">=3.11".
[F0539] (config) pyproject.toml [project].name = "oeydesign".
[F0540] (config) pyproject.toml [project].version = "0.1.0".
[F0541] (config) pyproject.toml [project].description = "Contract-first reference implementation for OEYdesign".
[F0542] (config) pyproject.toml [tool.pytest.ini_options] = {"pythonpath": ["src"], "testpaths": ["tests"], "addopts": "-p no:cacheprovider"}.
[F0543] (config) pyproject.toml [tool.ruff] target-version='py311', line-length=88.