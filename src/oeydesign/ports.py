"""Replaceable, vendor-neutral ports for the Phase 1 contract."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from .domain import (
    Approval,
    ApprovedDirection,
    ArtifactRevision,
    Candidate,
    CommandRecord,
    ConstraintProfile,
    ContextPackage,
    DeliveryBundle,
    DesignBrief,
    DesignStrategy,
    ExportCandidate,
    FeedbackRecord,
    GateDecision,
    Project,
    QualityDecision,
    RemediationRequest,
    RenderBundle,
    WorkflowRun,
)


class ProjectRepository(Protocol):
    def add(self, project: Project) -> None: ...

    def get(self, project_id: str) -> Project: ...

    def save(self, project: Project, *, expected_revision: int) -> None: ...


class CommandLedger(Protocol):
    def get(self, command_id: str) -> CommandRecord | None: ...

    def record(self, command_id: str, record: CommandRecord) -> None: ...


class WorkflowRuntimePort(Protocol):
    def start(
        self,
        project_id: str,
        workflow_kind: str,
        input_revision: int,
        idempotency_key: str,
    ) -> WorkflowRun: ...

    def resume(
        self, run_id: str, resume_input: Mapping[str, Any] | None = None
    ) -> WorkflowRun: ...

    def cancel(self, run_id: str, reason: str) -> WorkflowRun: ...

    def query(
        self, run_or_project_id: str, *, after_event: int = 0
    ) -> tuple[WorkflowRun, ...]: ...

    def complete(
        self,
        run_id: str,
        *,
        stage: str,
        output_refs: tuple[str, ...] = (),
        side_effect_key: str | None = None,
    ) -> WorkflowRun: ...


class DesignIntelligencePort(Protocol):
    capability_version: str

    def plan_design(
        self,
        context: ContextPackage,
        brief: DesignBrief,
        constraints: ConstraintProfile,
        capabilities: Mapping[str, str],
        run: WorkflowRun,
        *,
        candidate_count: int,
    ) -> DesignStrategy: ...

    def create_candidates(
        self,
        strategy: DesignStrategy,
        context: ContextPackage,
        run: WorkflowRun,
    ) -> tuple[Candidate, ...]: ...

    def revise_candidate(
        self,
        candidate: Candidate,
        feedback: FeedbackRecord,
        context: ContextPackage,
        run: WorkflowRun,
    ) -> Candidate: ...

    def commit_direction(
        self,
        candidate: Candidate,
        approval: Approval,
        run: WorkflowRun,
    ) -> ApprovedDirection: ...


class ArtifactProductionPort(Protocol):
    capability_version: str

    def materialize(
        self,
        direction: ApprovedDirection,
        *,
        medium: str,
        fidelity_mode: str,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> ArtifactRevision: ...

    def apply_artifact_change(
        self,
        artifact: ArtifactRevision,
        feedback: FeedbackRecord,
        run: WorkflowRun,
    ) -> ArtifactRevision: ...

    def render_artifact(
        self,
        artifact: ArtifactRevision,
        render_profile: Mapping[str, Any],
        run: WorkflowRun,
    ) -> RenderBundle: ...

    def export_artifact(
        self,
        artifact: ArtifactRevision,
        delivery_profile: Mapping[str, Any],
        run: WorkflowRun,
    ) -> ExportCandidate: ...


class QualityGovernancePort(Protocol):
    capability_version: str

    def assess_candidate(
        self,
        candidate: Candidate,
        brief: DesignBrief,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> QualityDecision: ...

    def assess_artifact(
        self,
        subject: RenderBundle | ExportCandidate,
        delivery_profile: Mapping[str, Any],
        context: ContextPackage,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> QualityDecision: ...

    def plan_remediation(
        self,
        decision: QualityDecision,
        current_revision: int,
        constraints: ConstraintProfile,
    ) -> RemediationRequest: ...

    def authorize_transition(
        self,
        decision: QualityDecision,
        requested_action: str,
        approvals: tuple[Approval, ...],
    ) -> GateDecision: ...


class DeliveryPort(Protocol):
    capability_version: str

    def release(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        *,
        side_effect_key: str,
    ) -> DeliveryBundle: ...
