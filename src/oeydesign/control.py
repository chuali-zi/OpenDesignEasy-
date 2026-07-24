"""Project Control Plane: the only writer of Project business state."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import replace
from datetime import datetime

from .domain import (
    Approval,
    ApprovalAction,
    ApproveDirection,
    ApproveExport,
    ArtifactRevision,
    CancelWorkflow,
    Candidate,
    Command,
    CommandRecord,
    CommandResult,
    ContractError,
    CreateProject,
    DeliverArtifact,
    DomainEvent,
    ErrorCategory,
    FeedbackKind,
    FeedbackRecord,
    GenerateCandidates,
    PrepareProject,
    ProduceArtifact,
    Project,
    ProjectState,
    QualityDecision,
    SubmitFeedback,
    ValidateArtifact,
    WorkflowRun,
    canonical_json,
    constraint_profile,
    stable_id,
    utc_now,
)
from .memory import (
    InMemoryCommandLedger,
    InMemoryProjectRepository,
    InMemoryWorkflowRuntime,
)
from .ports import (
    ArtifactProductionPort,
    CommandLedger,
    DeliveryPort,
    DesignIntelligencePort,
    ProjectRepository,
    QualityGovernancePort,
    WorkflowRuntimePort,
)
from .stubs import (
    DeterministicArtifactPort,
    DeterministicDeliveryPort,
    DeterministicDesignPort,
    DeterministicQualityPort,
)

_ALLOWED_TRANSITIONS: dict[ProjectState, set[ProjectState]] = {
    ProjectState.NEW: {ProjectState.INGESTING, ProjectState.CANCELED},
    ProjectState.INGESTING: {
        ProjectState.READY_FOR_DESIGN,
        ProjectState.NEEDS_INPUT,
        ProjectState.BLOCKED,
        ProjectState.FAILED,
        ProjectState.CANCELED,
    },
    ProjectState.NEEDS_INPUT: {
        ProjectState.INGESTING,
        ProjectState.DESIGNING,
        ProjectState.VALIDATING,
        ProjectState.CANCELED,
    },
    ProjectState.READY_FOR_DESIGN: {
        ProjectState.DESIGNING,
        ProjectState.NEEDS_INPUT,
        ProjectState.CANCELED,
    },
    ProjectState.DESIGNING: {
        ProjectState.AWAITING_DIRECTION_APPROVAL,
        ProjectState.NEEDS_INPUT,
        ProjectState.BLOCKED,
        ProjectState.FAILED,
        ProjectState.CANCELED,
    },
    ProjectState.AWAITING_DIRECTION_APPROVAL: {
        ProjectState.DESIGNING,
        ProjectState.PRODUCING,
        ProjectState.NEEDS_INPUT,
        ProjectState.CANCELED,
    },
    ProjectState.PRODUCING: {
        ProjectState.DESIGNING,
        ProjectState.VALIDATING,
        ProjectState.NEEDS_INPUT,
        ProjectState.BLOCKED,
        ProjectState.FAILED,
        ProjectState.CANCELED,
    },
    ProjectState.VALIDATING: {
        ProjectState.DESIGNING,
        ProjectState.PRODUCING,
        ProjectState.AWAITING_EXPORT_APPROVAL,
        ProjectState.NEEDS_INPUT,
        ProjectState.BLOCKED,
        ProjectState.FAILED,
        ProjectState.CANCELED,
    },
    ProjectState.AWAITING_EXPORT_APPROVAL: {
        ProjectState.DESIGNING,
        ProjectState.READY_TO_DELIVER,
        ProjectState.VALIDATING,
        ProjectState.NEEDS_INPUT,
        ProjectState.CANCELED,
    },
    ProjectState.READY_TO_DELIVER: {
        ProjectState.DESIGNING,
        ProjectState.DELIVERING,
        ProjectState.VALIDATING,
        ProjectState.NEEDS_INPUT,
        ProjectState.CANCELED,
    },
    ProjectState.DELIVERING: {
        ProjectState.DELIVERED,
        ProjectState.PRODUCING,
        ProjectState.BLOCKED,
        ProjectState.FAILED,
        ProjectState.CANCELED,
    },
    ProjectState.DELIVERED: {
        ProjectState.DESIGNING,
        ProjectState.VALIDATING,
        ProjectState.NEEDS_INPUT,
    },
    ProjectState.BLOCKED: set(),
    ProjectState.FAILED: set(),
    ProjectState.CANCELED: set(),
}


class ControlPlane:
    def __init__(
        self,
        *,
        repository: ProjectRepository | None = None,
        ledger: CommandLedger | None = None,
        runtime: WorkflowRuntimePort | None = None,
        design: DesignIntelligencePort | None = None,
        artifact: ArtifactProductionPort | None = None,
        quality: QualityGovernancePort | None = None,
        delivery: DeliveryPort | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self.repository = (
            repository if repository is not None else InMemoryProjectRepository()
        )
        self.ledger = ledger if ledger is not None else InMemoryCommandLedger()
        self.runtime = runtime if runtime is not None else InMemoryWorkflowRuntime()
        self.design = design if design is not None else DeterministicDesignPort()
        self.artifact = (
            artifact if artifact is not None else DeterministicArtifactPort()
        )
        self.quality = quality if quality is not None else DeterministicQualityPort()
        self.delivery = (
            delivery if delivery is not None else DeterministicDeliveryPort()
        )
        self.clock = clock

    def execute(self, command: Command) -> CommandResult:
        fingerprint = stable_id("command", command)
        prior = self.ledger.get(command.command_id)
        if prior:
            if prior.fingerprint != fingerprint:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Command ID was reused with a different payload",
                    details={"command_id": command.command_id},
                )
            return prior.result

        if isinstance(command, CreateProject):
            result = self._create_project(command)
            self.ledger.record(command.command_id, CommandRecord(fingerprint, result))
            return result

        if not command.project_id:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE, "project_id is required"
            )
        project = self.repository.get(command.project_id)
        if command.expected_project_revision != project.revision:
            raise ContractError(
                ErrorCategory.STALE_REVISION,
                "Command targets a stale Project revision",
                current_revision=project.revision,
            )

        expected_revision = project.revision
        first_event = len(project.events)
        project.revision += 1
        value = self._dispatch(project, command)
        self.repository.save(project, expected_revision=expected_revision)
        result = CommandResult(
            project_id=project.id,
            project_revision=project.revision,
            state=project.state,
            event_ids=tuple(event.id for event in project.events[first_event:]),
            value=value,
        )
        self.ledger.record(command.command_id, CommandRecord(fingerprint, result))
        return result

    def _create_project(self, command: CreateProject) -> CommandResult:
        project_id = command.project_id or stable_id("project", command.command_id)
        constraints = command.constraints or constraint_profile(
            command.preset, command.template_role
        )
        project = Project(
            id=project_id,
            name=command.name,
            constraints=constraints,
            revision=1,
        )
        event = self._emit(
            project,
            "ProjectCreated",
            {"name": project.name, "state": project.state.value},
        )
        self.repository.add(project)
        return CommandResult(
            project.id, project.revision, project.state, (event.id,), project
        )

    def _dispatch(self, project: Project, command: Command) -> object:
        if isinstance(command, PrepareProject):
            return self._prepare(project, command)
        if isinstance(command, GenerateCandidates):
            return self._generate_candidates(project, command)
        if isinstance(command, ApproveDirection):
            return self._approve_direction(project, command)
        if isinstance(command, SubmitFeedback):
            return self._submit_feedback(project, command)
        if isinstance(command, ProduceArtifact):
            return self._produce(project, command)
        if isinstance(command, ValidateArtifact):
            return self._validate(project, command)
        if isinstance(command, ApproveExport):
            return self._approve_export(project, command)
        if isinstance(command, DeliverArtifact):
            return self._deliver(project, command)
        if isinstance(command, CancelWorkflow):
            return self._cancel(project, command)
        raise ContractError(
            ErrorCategory.INVALID_TRANSITION,
            f"Unsupported command {type(command).__name__}",
        )

    def _prepare(self, project: Project, command: PrepareProject) -> object:
        self._require(project, ProjectState.NEW, ProjectState.NEEDS_INPUT)
        context = command.context_package
        brief = command.brief
        if context and context.project_id != project.id:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Context Package belongs to another Project",
            )
        self._transition(project, ProjectState.INGESTING)
        project.context_package = context
        project.brief = brief
        missing: list[str] = []
        if not context:
            missing.append("context_package")
        if not brief:
            missing.append("design_brief")
        if context:
            missing.extend(context.material_uncertainties)
        if missing:
            self._emit(project, "InputRequested", {"material_issues": tuple(missing)})
            self._transition(project, ProjectState.NEEDS_INPUT)
            return tuple(missing)
        assert context and brief
        self._emit(
            project,
            "ProjectPrepared",
            {
                "context_package_id": context.id,
                "brief_goal": brief.goal,
            },
        )
        self._transition(project, ProjectState.READY_FOR_DESIGN)
        return context

    def _generate_candidates(
        self, project: Project, command: GenerateCandidates
    ) -> tuple[Candidate, ...]:
        self._require(project, ProjectState.READY_FOR_DESIGN)
        assert project.context_package and project.brief
        self._transition(project, ProjectState.DESIGNING)
        run = self._start_run(project, "design", command.command_id)
        strategy = self.design.plan_design(
            project.context_package,
            project.brief,
            project.constraints,
            {},
            run,
            candidate_count=command.candidate_count,
        )
        candidates = self.design.create_candidates(
            strategy, project.context_package, run
        )
        project.strategy = strategy
        project.candidates = {candidate.id: candidate for candidate in candidates}
        project.candidate_history.extend(candidates)
        for candidate in candidates:
            decision = self.quality.assess_candidate(
                candidate, project.brief, project.constraints, run
            )
            project.quality_history.append(decision)
        self._emit(
            project,
            "CandidatesCreated",
            {
                "candidate_ids": tuple(candidate.id for candidate in candidates),
                "quality_decision_ids": tuple(
                    decision.id
                    for decision in project.quality_history
                    if decision.target_kind == "candidate"
                    and decision.target_id in project.candidates
                ),
            },
        )
        self._finish_run(
            project,
            run,
            "create-candidates",
            tuple(candidate.id for candidate in candidates),
        )
        self._transition(project, ProjectState.AWAITING_DIRECTION_APPROVAL)
        return candidates

    def _approve_direction(self, project: Project, command: ApproveDirection) -> object:
        self._require(project, ProjectState.AWAITING_DIRECTION_APPROVAL)
        candidate = self._candidate_target(
            project, command.candidate_id, command.candidate_revision
        )
        candidate_quality = next(
            (
                decision
                for decision in reversed(project.quality_history)
                if decision.target_kind == "candidate"
                and decision.target_id == candidate.id
                and decision.target_revision == candidate.revision
            ),
            None,
        )
        if (
            not candidate_quality
            or not self.quality.authorize_transition(
                candidate_quality, "commit-direction", ()
            ).authorized
        ):
            raise ContractError(
                ErrorCategory.QUALITY_GATE_FAILED,
                "Candidate revision did not pass its Quality gate",
            )
        approval = Approval(
            id=stable_id(
                "approval",
                project.id,
                ApprovalAction.COMMIT_DIRECTION,
                candidate.id,
                candidate.revision,
            ),
            project_id=project.id,
            action=ApprovalAction.COMMIT_DIRECTION,
            target_id=candidate.id,
            target_revision=candidate.revision,
            impact=command.impact,
        )
        project.approvals[approval.id] = approval
        self._emit(
            project,
            "ApprovalGranted",
            {
                "approval_id": approval.id,
                "action": approval.action.value,
                "target_id": candidate.id,
                "target_revision": candidate.revision,
            },
        )
        run = self._start_run(project, "commit-direction", command.command_id)
        project.approved_direction = self.design.commit_direction(
            candidate, approval, run
        )
        self._emit(
            project,
            "DirectionApproved",
            {
                "direction_id": project.approved_direction.id,
                "candidate_id": candidate.id,
                "candidate_revision": candidate.revision,
            },
        )
        self._finish_run(
            project,
            run,
            "commit-direction",
            (project.approved_direction.id,),
        )
        self._transition(project, ProjectState.PRODUCING)
        return project.approved_direction

    def _produce(self, project: Project, command: ProduceArtifact) -> ArtifactRevision:
        self._require(project, ProjectState.PRODUCING)
        if not project.approved_direction:
            raise ContractError(
                ErrorCategory.INVALID_TRANSITION,
                "Production requires an approved direction",
            )
        run = self._start_run(project, "produce", command.command_id)
        artifact = self.artifact.materialize(
            project.approved_direction,
            medium=command.medium,
            fidelity_mode=command.fidelity_mode,
            constraints=project.constraints,
            run=run,
        )
        project.current_artifact = artifact
        project.artifact_history.append(artifact)
        self._emit(
            project,
            "ArtifactCreated",
            {"artifact_id": artifact.id, "artifact_revision": artifact.revision},
        )
        self._finish_run(project, run, "materialize", (artifact.id,))
        self._transition(project, ProjectState.VALIDATING)
        return artifact

    def _validate(self, project: Project, command: ValidateArtifact) -> object:
        self._require(project, ProjectState.VALIDATING)
        artifact = self._artifact_target(project)
        assert project.context_package
        run = self._start_run(project, "validate", command.command_id)
        render = self.artifact.render_artifact(artifact, command.render_profile, run)
        project.current_render = render
        project.render_history.append(render)
        self._emit(
            project,
            "ArtifactRendered",
            {
                "render_id": render.id,
                "artifact_id": artifact.id,
                "artifact_revision": artifact.revision,
            },
        )
        decision = self.quality.assess_artifact(
            render,
            {},
            project.context_package,
            project.constraints,
            run,
        )
        project.current_quality = decision
        project.quality_history.append(decision)
        self._emit_quality(project, decision)
        gate = self.quality.authorize_transition(
            decision, "request-export-approval", ()
        )
        if gate.authorized:
            self._transition(project, ProjectState.AWAITING_EXPORT_APPROVAL)
        else:
            remediation = self.quality.plan_remediation(
                decision, artifact.revision, project.constraints
            )
            self._emit(
                project,
                "TransitionBlocked",
                {
                    "category": ErrorCategory.QUALITY_GATE_FAILED.value,
                    "remediation_id": remediation.id,
                },
            )
            self._transition(project, ProjectState.PRODUCING)
        self._finish_run(project, run, "validate", (render.id, decision.id))
        return decision

    def _approve_export(self, project: Project, command: ApproveExport) -> Approval:
        self._require(project, ProjectState.AWAITING_EXPORT_APPROVAL)
        artifact = self._artifact_target(
            project, command.artifact_id, command.artifact_revision
        )
        if (
            not project.current_quality
            or project.current_quality.artifact_id != artifact.id
            or project.current_quality.artifact_revision != artifact.revision
        ):
            raise ContractError(
                ErrorCategory.QUALITY_GATE_FAILED,
                "The current Artifact revision has no passing Quality Decision",
            )
        approval = Approval(
            id=stable_id(
                "approval",
                project.id,
                ApprovalAction.EXPORT,
                artifact.id,
                artifact.revision,
            ),
            project_id=project.id,
            action=ApprovalAction.EXPORT,
            target_id=artifact.id,
            target_revision=artifact.revision,
            impact=command.impact,
        )
        project.approvals[approval.id] = approval
        self._emit(
            project,
            "ApprovalGranted",
            {
                "approval_id": approval.id,
                "action": approval.action.value,
                "target_id": artifact.id,
                "target_revision": artifact.revision,
            },
        )
        self._transition(project, ProjectState.READY_TO_DELIVER)
        return approval

    def _deliver(self, project: Project, command: DeliverArtifact) -> object:
        self._require(project, ProjectState.READY_TO_DELIVER)
        artifact = self._artifact_target(project)
        assert project.context_package
        approval = self._matching_export_approval(project, artifact)
        self._transition(project, ProjectState.DELIVERING)
        run = self._start_run(project, "deliver", command.command_id)
        export = self.artifact.export_artifact(artifact, command.delivery_profile, run)
        side_effect_key = stable_id(
            "delivery-effect",
            project.id,
            artifact.id,
            artifact.revision,
            export.id,
            export.revision,
            approval.id,
            canonical_json(command.delivery_profile),
        )
        project.current_export = export
        project.export_history.append(export)
        self._emit(
            project,
            "ExportCreated",
            {
                "export_id": export.id,
                "artifact_id": artifact.id,
                "artifact_revision": artifact.revision,
            },
        )
        decision = self.quality.assess_artifact(
            export,
            command.delivery_profile,
            project.context_package,
            project.constraints,
            run,
        )
        project.current_quality = decision
        project.quality_history.append(decision)
        self._emit_quality(project, decision)
        self._emit(
            project,
            "ExportVerified",
            {"export_id": export.id, "quality_decision_id": decision.id},
        )
        gate = self.quality.authorize_transition(
            decision, "deliver", tuple(project.approvals.values())
        )
        if not gate.authorized:
            self._invalidate_approvals(
                project,
                actions=(ApprovalAction.EXPORT,),
                reason="Actual export failed final verification",
            )
            self._emit(
                project,
                "TransitionBlocked",
                {
                    "category": ErrorCategory.QUALITY_GATE_FAILED.value,
                    "quality_decision_id": decision.id,
                },
            )
            self._finish_run(project, run, "verify-export", (export.id, decision.id))
            self._transition(project, ProjectState.PRODUCING)
            return decision
        bundle = self.delivery.release(
            artifact,
            export,
            decision,
            approval,
            side_effect_key=side_effect_key,
        )
        if not any(item.id == bundle.id for item in project.deliveries):
            project.deliveries.append(bundle)
        self._emit(
            project,
            "DeliveryReleased",
            {
                "delivery_id": bundle.id,
                "side_effect_key": side_effect_key,
            },
        )
        self._finish_run(
            project,
            run,
            "release-delivery",
            (bundle.id,),
            side_effect_key=side_effect_key,
        )
        self._transition(project, ProjectState.DELIVERED)
        return bundle

    def _submit_feedback(self, project: Project, command: SubmitFeedback) -> object:
        if command.kind is FeedbackKind.DIRECTION:
            return self._direction_feedback(project, command)
        if command.kind is FeedbackKind.ARTIFACT_LOCAL:
            return self._artifact_feedback(project, command)
        return self._fact_feedback(project, command)

    def _direction_feedback(
        self, project: Project, command: SubmitFeedback
    ) -> Candidate:
        self._require(
            project,
            ProjectState.AWAITING_DIRECTION_APPROVAL,
            ProjectState.PRODUCING,
            ProjectState.VALIDATING,
            ProjectState.AWAITING_EXPORT_APPROVAL,
            ProjectState.READY_TO_DELIVER,
            ProjectState.DELIVERED,
        )
        assert project.context_package and project.brief
        candidate = self._candidate_target(
            project, command.target_id, command.target_revision
        )
        record = self._record_feedback(project, command, ("design",))
        self._invalidate_approvals(
            project,
            actions=(ApprovalAction.COMMIT_DIRECTION, ApprovalAction.EXPORT),
            reason="Direction-level feedback changed the approved baseline",
        )
        project.approved_direction = None
        self._transition(project, ProjectState.DESIGNING)
        run = self._start_run(project, "revise-direction", command.command_id)
        revised = self.design.revise_candidate(
            candidate, record, project.context_package, run
        )
        project.candidates[revised.id] = revised
        project.candidate_history.append(revised)
        decision = self.quality.assess_candidate(
            revised, project.brief, project.constraints, run
        )
        project.quality_history.append(decision)
        self._emit(
            project,
            "CandidateRevised",
            {"candidate_id": revised.id, "candidate_revision": revised.revision},
        )
        self._emit_quality(project, decision)
        self._finish_run(project, run, "revise-candidate", (revised.id, decision.id))
        self._transition(project, ProjectState.AWAITING_DIRECTION_APPROVAL)
        return revised

    def _artifact_feedback(
        self, project: Project, command: SubmitFeedback
    ) -> ArtifactRevision:
        self._require(
            project,
            ProjectState.PRODUCING,
            ProjectState.VALIDATING,
            ProjectState.AWAITING_EXPORT_APPROVAL,
            ProjectState.READY_TO_DELIVER,
            ProjectState.DELIVERED,
        )
        artifact = self._artifact_target(
            project, command.target_id, command.target_revision
        )
        record = self._record_feedback(project, command, ("artifact",))
        self._invalidate_approvals(
            project,
            actions=(ApprovalAction.EXPORT,),
            reason="Artifact revision changed",
        )
        run = self._start_run(project, "revise-artifact", command.command_id)
        revised = self.artifact.apply_artifact_change(artifact, record, run)
        project.current_artifact = revised
        project.artifact_history.append(revised)
        self._emit(
            project,
            "ArtifactRevised",
            {"artifact_id": revised.id, "artifact_revision": revised.revision},
        )
        self._finish_run(project, run, "apply-artifact-change", (revised.id,))
        self._transition(project, ProjectState.VALIDATING)
        return revised

    def _fact_feedback(
        self, project: Project, command: SubmitFeedback
    ) -> FeedbackRecord:
        self._require(
            project,
            ProjectState.READY_FOR_DESIGN,
            ProjectState.AWAITING_DIRECTION_APPROVAL,
            ProjectState.PRODUCING,
            ProjectState.VALIDATING,
            ProjectState.AWAITING_EXPORT_APPROVAL,
            ProjectState.READY_TO_DELIVER,
            ProjectState.DELIVERED,
        )
        record = self._record_feedback(project, command, ("context", "quality"))
        self._invalidate_approvals(
            project,
            actions=(ApprovalAction.COMMIT_DIRECTION, ApprovalAction.EXPORT),
            reason="Fact or policy feedback requires revalidation",
        )
        self._emit(
            project,
            "InputRequested",
            {"reason": "fact-or-policy-correction", "feedback_id": record.id},
        )
        self._transition(project, ProjectState.NEEDS_INPUT)
        return record

    def _cancel(self, project: Project, command: CancelWorkflow) -> WorkflowRun:
        if not command.workflow_run_id:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "workflow_run_id is required",
            )
        runs = self.runtime.query(command.workflow_run_id)
        if len(runs) != 1:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "workflow_run_id did not resolve to one run",
            )
        run = runs[0]
        if run.project_id != project.id:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Workflow belongs to another Project",
            )
        canceled = self.runtime.cancel(run.id, command.reason)
        project.active_run_id = canceled.id
        self._emit(
            project,
            "WorkflowCanceled",
            {"workflow_run_id": canceled.id, "reason": command.reason},
        )
        self._transition(project, ProjectState.CANCELED)
        return canceled

    def _start_run(
        self, project: Project, workflow_kind: str, idempotency_key: str
    ) -> WorkflowRun:
        run = self.runtime.start(
            project.id, workflow_kind, project.revision, idempotency_key
        )
        project.active_run_id = run.id
        self._emit(
            project,
            "WorkflowStarted",
            {"workflow_run_id": run.id, "workflow_kind": workflow_kind},
        )
        return run

    def _finish_run(
        self,
        project: Project,
        run: WorkflowRun,
        stage: str,
        output_refs: tuple[str, ...],
        *,
        side_effect_key: str | None = None,
    ) -> WorkflowRun:
        completed = self.runtime.complete(
            run.id,
            stage=stage,
            output_refs=output_refs,
            side_effect_key=side_effect_key,
        )
        project.active_run_id = completed.id
        self._emit(
            project,
            "WorkflowProgressed",
            {
                "workflow_run_id": completed.id,
                "stage": stage,
                "status": completed.status.value,
                "output_refs": output_refs,
            },
        )
        return completed

    def _record_feedback(
        self,
        project: Project,
        command: SubmitFeedback,
        routed_to: tuple[str, ...],
    ) -> FeedbackRecord:
        record = FeedbackRecord(
            id=stable_id(
                "feedback",
                project.id,
                command.kind,
                command.target_id,
                command.target_revision,
                command.text,
                command.object_ref,
            ),
            kind=command.kind,
            target_id=command.target_id,
            target_revision=command.target_revision,
            text=command.text,
            object_ref=command.object_ref,
            routed_to=routed_to,
        )
        project.feedback.append(record)
        self._emit(
            project,
            "FeedbackRecorded",
            {
                "feedback_id": record.id,
                "kind": record.kind.value,
                "routed_to": record.routed_to,
            },
        )
        return record

    def _invalidate_approvals(
        self,
        project: Project,
        *,
        actions: Iterable[ApprovalAction],
        reason: str,
    ) -> None:
        action_set = set(actions)
        for approval_id, approval in tuple(project.approvals.items()):
            if approval.active and approval.action in action_set:
                project.approvals[approval_id] = replace(
                    approval, active=False, invalidated_reason=reason
                )
                self._emit(
                    project,
                    "ApprovalInvalidated",
                    {"approval_id": approval.id, "reason": reason},
                )

    def _matching_export_approval(
        self, project: Project, artifact: ArtifactRevision
    ) -> Approval:
        approvals = [
            approval
            for approval in project.approvals.values()
            if approval.active
            and approval.action is ApprovalAction.EXPORT
            and approval.target_id == artifact.id
            and approval.target_revision == artifact.revision
        ]
        if not approvals:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Delivery requires a matching active export Approval",
            )
        return approvals[-1]

    def _candidate_target(
        self, project: Project, target_id: str, target_revision: int
    ) -> Candidate:
        candidate = project.candidates.get(target_id)
        if not candidate or candidate.revision != target_revision:
            raise ContractError(
                ErrorCategory.STALE_REVISION,
                "Candidate target is stale",
                details={"candidate_id": target_id},
            )
        return candidate

    def _artifact_target(
        self,
        project: Project,
        target_id: str | None = None,
        target_revision: int | None = None,
    ) -> ArtifactRevision:
        artifact = project.current_artifact
        if (
            not artifact
            or (target_id is not None and artifact.id != target_id)
            or (target_revision is not None and artifact.revision != target_revision)
        ):
            raise ContractError(
                ErrorCategory.STALE_REVISION,
                "Artifact target is stale",
                details={"artifact_id": target_id},
            )
        return artifact

    @staticmethod
    def _require(project: Project, *states: ProjectState) -> None:
        if project.state not in states:
            expected = ", ".join(state.value for state in states)
            raise ContractError(
                ErrorCategory.INVALID_TRANSITION,
                f"{project.state.value} does not accept this command; "
                f"expected {expected}",
            )

    def _transition(self, project: Project, new_state: ProjectState) -> None:
        if project.state is new_state:
            return
        if new_state not in _ALLOWED_TRANSITIONS[project.state]:
            raise ContractError(
                ErrorCategory.INVALID_TRANSITION,
                f"Illegal transition {project.state.value} -> {new_state.value}",
            )
        old_state = project.state
        project.state = new_state
        self._emit(
            project,
            "ProjectStateChanged",
            {"from": old_state.value, "to": new_state.value},
        )

    def _emit_quality(self, project: Project, decision: QualityDecision) -> DomainEvent:
        return self._emit(
            project,
            "QualityAssessed",
            {
                "quality_decision_id": decision.id,
                "target_id": decision.target_id,
                "aesthetic_findings": len(decision.aesthetic_findings),
                "hard_errors": len(decision.hard_errors),
                "verdict": decision.verdict.value,
            },
        )

    def _emit(
        self, project: Project, event_type: str, payload: dict[str, object]
    ) -> DomainEvent:
        sequence = len(project.events) + 1
        event = DomainEvent(
            id=stable_id(
                "event",
                project.id,
                project.revision,
                sequence,
                event_type,
                payload,
            ),
            sequence=sequence,
            project_id=project.id,
            project_revision=project.revision,
            event_type=event_type,
            occurred_at=self.clock(),
            payload=payload,
        )
        project.events.append(event)
        return event
