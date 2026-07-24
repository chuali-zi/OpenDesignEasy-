"""Vendor-neutral domain language shared by every OEYdesign adapter."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import UTC, datetime
from enum import Enum, StrEnum
from typing import Any


def utc_now() -> datetime:
    return datetime.now(UTC)


def _json_default(value: object) -> object:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if isinstance(value, tuple):
        return list(value)
    raise TypeError(f"Cannot canonicalize {type(value).__name__}")


def canonical_json(value: object) -> str:
    """Return the stable representation used for fingerprints and stub IDs."""
    return json.dumps(
        value,
        default=_json_default,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def stable_id(prefix: str, *parts: object) -> str:
    digest = hashlib.sha256(canonical_json(parts).encode("utf-8")).hexdigest()[:20]
    return f"{prefix}_{digest}"


class ProjectState(StrEnum):
    NEW = "NEW"
    INGESTING = "INGESTING"
    NEEDS_INPUT = "NEEDS_INPUT"
    READY_FOR_DESIGN = "READY_FOR_DESIGN"
    DESIGNING = "DESIGNING"
    AWAITING_DIRECTION_APPROVAL = "AWAITING_DIRECTION_APPROVAL"
    PRODUCING = "PRODUCING"
    VALIDATING = "VALIDATING"
    AWAITING_EXPORT_APPROVAL = "AWAITING_EXPORT_APPROVAL"
    READY_TO_DELIVER = "READY_TO_DELIVER"
    DELIVERING = "DELIVERING"
    DELIVERED = "DELIVERED"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


class ErrorCategory(StrEnum):
    RETRYABLE = "RETRYABLE"
    NEEDS_INPUT = "NEEDS_INPUT"
    POLICY_BLOCKED = "POLICY_BLOCKED"
    CAPABILITY_UNAVAILABLE = "CAPABILITY_UNAVAILABLE"
    DETERMINISTIC_FAILURE = "DETERMINISTIC_FAILURE"
    STALE_REVISION = "STALE_REVISION"
    INVALID_TRANSITION = "INVALID_TRANSITION"
    QUALITY_GATE_FAILED = "QUALITY_GATE_FAILED"


class ConstraintPreset(StrEnum):
    OPEN_EXPLORATION = "OPEN_EXPLORATION"
    DESIGN_GUIDED = "DESIGN_GUIDED"
    GOVERNED_PRODUCTION = "GOVERNED_PRODUCTION"


class TemplateRole(StrEnum):
    REFERENCE_SAMPLE = "REFERENCE_SAMPLE"
    STARTER_SCAFFOLD = "STARTER_SCAFFOLD"
    DESIGN_SYSTEM = "DESIGN_SYSTEM"
    DELIVERY_CONTRACT = "DELIVERY_CONTRACT"


class FeedbackKind(StrEnum):
    DIRECTION = "DIRECTION"
    ARTIFACT_LOCAL = "ARTIFACT_LOCAL"
    FACT_OR_POLICY = "FACT_OR_POLICY"


class ApprovalAction(StrEnum):
    COMMIT_DIRECTION = "COMMIT_DIRECTION"
    EXPORT = "EXPORT"


class WorkflowStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    NEEDS_INPUT = "NEEDS_INPUT"
    BLOCKED = "BLOCKED"
    RETRY_WAIT = "RETRY_WAIT"
    COMPLETED = "COMPLETED"
    CANCELED = "CANCELED"
    FAILED = "FAILED"


class GateVerdict(StrEnum):
    PASS = "PASS"
    REPAIR = "REPAIR"
    BLOCK = "BLOCK"


class FindingKind(StrEnum):
    AESTHETIC = "AESTHETIC"
    HARD_ERROR = "HARD_ERROR"


class CheckpointStatus(StrEnum):
    RUNNING = "RUNNING"
    RETRY_WAIT = "RETRY_WAIT"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class SideEffectStatus(StrEnum):
    CLAIMED = "CLAIMED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class SideEffectReconciliationStatus(StrEnum):
    COMPLETED = "COMPLETED"
    SAFE_TO_RETRY = "SAFE_TO_RETRY"
    UNKNOWN = "UNKNOWN"


class ContractError(Exception):
    def __init__(
        self,
        category: ErrorCategory,
        message: str,
        *,
        current_revision: int | None = None,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.category = category
        self.current_revision = current_revision
        self.details = dict(details or {})


@dataclass(frozen=True, slots=True)
class ConstraintSetting:
    level: str
    source: str
    value: str = ""


@dataclass(frozen=True, slots=True)
class ConstraintProfile:
    preset: ConstraintPreset
    template_role: TemplateRole
    facts_evidence: ConstraintSetting
    content_narrative: ConstraintSetting
    brand_style: ConstraintSetting
    composition_template: ConstraintSetting
    delivery_properties: ConstraintSetting
    runtime_permissions: ConstraintSetting


def constraint_profile(
    preset: ConstraintPreset = ConstraintPreset.DESIGN_GUIDED,
    template_role: TemplateRole = TemplateRole.REFERENCE_SAMPLE,
) -> ConstraintProfile:
    creative_level = {
        ConstraintPreset.OPEN_EXPLORATION: "open",
        ConstraintPreset.DESIGN_GUIDED: "guided",
        ConstraintPreset.GOVERNED_PRODUCTION: "strict",
    }[preset]
    template_level = {
        TemplateRole.REFERENCE_SAMPLE: "open",
        TemplateRole.STARTER_SCAFFOLD: "guided",
        TemplateRole.DESIGN_SYSTEM: "guided",
        TemplateRole.DELIVERY_CONTRACT: "strict",
    }[template_role]
    return ConstraintProfile(
        preset=preset,
        template_role=template_role,
        facts_evidence=ConstraintSetting("strict", "system-safety"),
        content_narrative=ConstraintSetting(creative_level, "preset"),
        brand_style=ConstraintSetting(creative_level, "preset"),
        composition_template=ConstraintSetting(template_level, "template-role"),
        delivery_properties=ConstraintSetting("strict", "target-format"),
        runtime_permissions=ConstraintSetting("strict", "system-safety"),
    )


@dataclass(frozen=True, slots=True)
class DesignBrief:
    goal: str
    audience: str
    medium: str
    acceptance_direction: str = "Clear, usable, and visually intentional"


@dataclass(frozen=True, slots=True)
class ContextPackage:
    id: str
    project_id: str
    revision: int
    confirmed_facts: tuple[str, ...]
    source_refs: tuple[str, ...]
    material_uncertainties: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Lineage:
    project_id: str
    workflow_run_id: str
    capability_version: str


@dataclass(frozen=True, slots=True, kw_only=True)
class Command:
    command_id: str
    project_id: str | None = None
    expected_project_revision: int | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class CreateProject(Command):
    name: str = "Untitled project"
    preset: ConstraintPreset = ConstraintPreset.DESIGN_GUIDED
    template_role: TemplateRole = TemplateRole.REFERENCE_SAMPLE
    constraints: ConstraintProfile | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class PrepareProject(Command):
    context_package: ContextPackage | None = None
    brief: DesignBrief | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class GenerateCandidates(Command):
    candidate_count: int = 3


@dataclass(frozen=True, slots=True, kw_only=True)
class ApproveDirection(Command):
    candidate_id: str = ""
    candidate_revision: int = 0
    impact: str = "Approve this design direction as the production baseline"


@dataclass(frozen=True, slots=True, kw_only=True)
class SubmitFeedback(Command):
    kind: FeedbackKind = FeedbackKind.DIRECTION
    target_id: str = ""
    target_revision: int = 0
    text: str = ""
    object_ref: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class ProduceArtifact(Command):
    medium: str = "web"
    fidelity_mode: str = "balanced"


@dataclass(frozen=True, slots=True, kw_only=True)
class ValidateArtifact(Command):
    render_profile: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True, kw_only=True)
class ApproveExport(Command):
    artifact_id: str = ""
    artifact_revision: int = 0
    impact: str = "Create a local export candidate for final verification"


@dataclass(frozen=True, slots=True, kw_only=True)
class DeliverArtifact(Command):
    delivery_profile: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True, kw_only=True)
class CancelWorkflow(Command):
    workflow_run_id: str = ""
    reason: str = "Canceled by user"


@dataclass(frozen=True, slots=True, kw_only=True)
class PauseWorkflow(Command):
    workflow_run_id: str = ""
    reason: str = "Paused by user"


@dataclass(frozen=True, slots=True, kw_only=True)
class ResumeWorkflow(Command):
    workflow_run_id: str = ""
    resume_input: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True, kw_only=True)
class ReconcileWorkflowStatus(Command):
    workflow_run_id: str = ""


@dataclass(frozen=True, slots=True, kw_only=True)
class RestoreProjectRevision(Command):
    source_revision: int = 0


@dataclass(frozen=True, slots=True)
class DomainEvent:
    id: str
    sequence: int
    project_id: str
    project_revision: int
    event_type: str
    occurred_at: datetime
    payload: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class WorkflowProgressEvent:
    sequence: int
    event_type: str
    stage: str
    message: str
    id: str = ""
    project_id: str = ""
    occurred_at: datetime | None = None
    details: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class WorkflowRun:
    id: str
    project_id: str
    workflow_kind: str
    input_revision: int
    idempotency_key: str
    status: WorkflowStatus
    current_stage: str
    completed_stages: tuple[str, ...] = ()
    side_effect_keys: tuple[str, ...] = ()
    events: tuple[WorkflowProgressEvent, ...] = ()
    pause_reason: str | None = None
    error_category: ErrorCategory | None = None
    error_message: str | None = None
    attempt: int = 0
    max_attempts: int = 3


@dataclass(frozen=True, slots=True)
class StageCheckpoint:
    run_id: str
    stage: str
    input_fingerprint: str
    status: CheckpointStatus
    attempt: int
    output_refs: tuple[str, ...] = ()
    error_category: ErrorCategory | None = None
    error_message: str | None = None
    side_effect_key: str | None = None


@dataclass(frozen=True, slots=True)
class AuditEntry:
    id: str
    sequence: int
    project_id: str
    workflow_run_id: str | None
    action: str
    outcome: str
    project_revision: int | None
    metadata: Mapping[str, Any]
    occurred_at: datetime


@dataclass(frozen=True, slots=True)
class SideEffectRecord:
    key: str
    project_id: str
    action: str
    target_revision: int
    status: SideEffectStatus
    result: Mapping[str, Any] | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class DesignStrategy:
    id: str
    lineage: Lineage
    context_package_id: str
    brief: DesignBrief
    constraints: ConstraintProfile
    candidate_count: int


@dataclass(frozen=True, slots=True)
class Candidate:
    id: str
    revision: int
    parent_revision: int | None
    lineage: Lineage
    title: str
    concept: str
    preview_html: str
    creative_owner: str
    template_role: TemplateRole
    constraints: ConstraintProfile
    source_refs: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Approval:
    id: str
    project_id: str
    action: ApprovalAction
    target_id: str
    target_revision: int
    impact: str
    active: bool = True
    invalidated_reason: str | None = None


@dataclass(frozen=True, slots=True)
class ApprovedDirection:
    id: str
    lineage: Lineage
    candidate_id: str
    candidate_revision: int
    approval_id: str
    baseline_preview_html: str


@dataclass(frozen=True, slots=True)
class ArtifactRevision:
    id: str
    revision: int
    parent_revision: int | None
    lineage: Lineage
    direction_id: str
    medium: str
    fidelity_mode: str
    content: str
    object_refs: Mapping[str, str]
    tradeoffs: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RenderBundle:
    id: str
    revision: int
    lineage: Lineage
    artifact_id: str
    artifact_revision: int
    rendered_content: str
    profile: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ExportCandidate:
    id: str
    revision: int
    lineage: Lineage
    artifact_id: str
    artifact_revision: int
    exported_content: str
    manifest: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class Finding:
    kind: FindingKind
    code: str
    message: str
    severity: str
    target_ref: str
    repairable: bool = False


@dataclass(frozen=True, slots=True)
class QualityDecision:
    id: str
    revision: int
    lineage: Lineage
    target_kind: str
    target_id: str
    target_revision: int
    artifact_id: str | None
    artifact_revision: int | None
    aesthetic_findings: tuple[Finding, ...]
    hard_errors: tuple[Finding, ...]
    risks: tuple[str, ...]
    verdict: GateVerdict


@dataclass(frozen=True, slots=True)
class RemediationRequest:
    id: str
    target_id: str
    target_revision: int
    instructions: tuple[str, ...]
    protected_constraints: ConstraintProfile
    max_attempts: int


@dataclass(frozen=True, slots=True)
class GateDecision:
    authorized: bool
    requested_action: str
    quality_decision_id: str
    approval_ids: tuple[str, ...]
    reason: str


@dataclass(frozen=True, slots=True)
class DeliveryBundle:
    id: str
    revision: int
    lineage: Lineage
    artifact_id: str
    artifact_revision: int
    export_id: str
    quality_decision_id: str
    approval_id: str
    side_effect_key: str
    manifest: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class DeliveryReconciliation:
    status: SideEffectReconciliationStatus
    bundle: DeliveryBundle | None = None
    reason: str = ""


@dataclass(frozen=True, slots=True)
class FeedbackRecord:
    id: str
    kind: FeedbackKind
    target_id: str
    target_revision: int
    text: str
    object_ref: str | None
    routed_to: tuple[str, ...]


@dataclass(slots=True)
class Project:
    id: str
    name: str
    constraints: ConstraintProfile
    revision: int = 0
    state: ProjectState = ProjectState.NEW
    context_package: ContextPackage | None = None
    brief: DesignBrief | None = None
    strategy: DesignStrategy | None = None
    candidates: dict[str, Candidate] = field(default_factory=dict)
    candidate_history: list[Candidate] = field(default_factory=list)
    approved_direction: ApprovedDirection | None = None
    current_artifact: ArtifactRevision | None = None
    artifact_history: list[ArtifactRevision] = field(default_factory=list)
    current_render: RenderBundle | None = None
    render_history: list[RenderBundle] = field(default_factory=list)
    current_export: ExportCandidate | None = None
    export_history: list[ExportCandidate] = field(default_factory=list)
    current_quality: QualityDecision | None = None
    quality_history: list[QualityDecision] = field(default_factory=list)
    approvals: dict[str, Approval] = field(default_factory=dict)
    deliveries: list[DeliveryBundle] = field(default_factory=list)
    feedback: list[FeedbackRecord] = field(default_factory=list)
    events: list[DomainEvent] = field(default_factory=list)
    active_run_id: str | None = None
    status_reason: str | None = None
    resume_state: ProjectState | None = None
    restored_from_revision: int | None = None


@dataclass(frozen=True, slots=True)
class CommandResult:
    project_id: str
    project_revision: int
    state: ProjectState
    event_ids: tuple[str, ...]
    value: Any = None


@dataclass(frozen=True, slots=True)
class CommandRecord:
    fingerprint: str
    result: CommandResult
