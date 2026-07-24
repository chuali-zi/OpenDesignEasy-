from __future__ import annotations

from dataclasses import fields, replace
from datetime import UTC, datetime

import pytest

from oeydesign import (
    Approval,
    ApprovalAction,
    ApproveDirection,
    ApproveExport,
    ArtifactRevision,
    Candidate,
    ConstraintPreset,
    ContextPackage,
    ContractError,
    ControlPlane,
    CreateProject,
    DeliverArtifact,
    DeliveryBundle,
    DesignBrief,
    DeterministicArtifactPort,
    DeterministicDeliveryPort,
    DeterministicDesignPort,
    DeterministicQualityPort,
    ErrorCategory,
    ExportCandidate,
    FeedbackKind,
    Finding,
    FindingKind,
    GateVerdict,
    GenerateCandidates,
    InMemoryWorkflowRuntime,
    PrepareProject,
    ProduceArtifact,
    ProjectState,
    QualityDecision,
    RenderBundle,
    SubmitFeedback,
    TemplateRole,
    ValidateArtifact,
    WorkflowStatus,
    canonical_json,
    stable_id,
)

FIXED_TIME = datetime(2026, 7, 24, 9, 0, tzinfo=UTC)


def control_plane(**ports: object) -> ControlPlane:
    return ControlPlane(clock=lambda: FIXED_TIME, **ports)


def current(cp: ControlPlane, project_id: str):
    return cp.repository.get(project_id)


def send(cp: ControlPlane, project_id: str, command_type, command_id: str, **kwargs):
    project = current(cp, project_id)
    return cp.execute(
        command_type(
            command_id=command_id,
            project_id=project_id,
            expected_project_revision=project.revision,
            **kwargs,
        )
    )


def create_ready(
    cp: ControlPlane,
    *,
    project_id: str = "project_demo",
    preset: ConstraintPreset = ConstraintPreset.DESIGN_GUIDED,
    template_role: TemplateRole = TemplateRole.REFERENCE_SAMPLE,
) -> str:
    cp.execute(
        CreateProject(
            command_id="01-create",
            project_id=project_id,
            name="Demo",
            preset=preset,
            template_role=template_role,
        )
    )
    context = ContextPackage(
        id=stable_id("context", project_id, 1),
        project_id=project_id,
        revision=1,
        confirmed_facts=("OEYdesign is a design workspace.",),
        source_refs=("source:brief",),
    )
    send(
        cp,
        project_id,
        PrepareProject,
        "02-prepare",
        context_package=context,
        brief=DesignBrief("Create a launch story", "Product leaders", "web"),
    )
    return project_id


def create_candidates(cp: ControlPlane, project_id: str) -> tuple[Candidate, ...]:
    return send(
        cp,
        project_id,
        GenerateCandidates,
        "03-generate",
        candidate_count=3,
    ).value


def produce_to_ready_for_delivery(cp: ControlPlane, project_id: str):
    candidates = create_candidates(cp, project_id)
    send(
        cp,
        project_id,
        ApproveDirection,
        "04-approve-direction",
        candidate_id=candidates[0].id,
        candidate_revision=candidates[0].revision,
    )
    artifact = send(
        cp,
        project_id,
        ProduceArtifact,
        "05-produce",
        medium="web",
    ).value
    decision = send(
        cp, project_id, ValidateArtifact, "06-validate", render_profile={"width": 1440}
    ).value
    assert not decision.hard_errors
    send(
        cp,
        project_id,
        ApproveExport,
        "07-approve-export",
        artifact_id=artifact.id,
        artifact_revision=artifact.revision,
    )
    return artifact


def full_flow(cp: ControlPlane, project_id: str = "project_demo"):
    create_ready(cp, project_id=project_id)
    produce_to_ready_for_delivery(cp, project_id)
    return send(
        cp,
        project_id,
        DeliverArtifact,
        "08-deliver",
        delivery_profile={"format": "zip"},
    )


def test_happy_path_has_explicit_states_lineage_and_verified_delivery():
    cp = control_plane()
    result = full_flow(cp)
    project = current(cp, result.project_id)

    assert result.state is ProjectState.DELIVERED
    assert len(project.deliveries) == 1
    assert project.current_render.id != project.current_export.id
    assert project.deliveries[0].export_id == project.current_export.id
    assert project.deliveries[0].quality_decision_id == project.current_quality.id
    assert project.current_quality.target_kind == "export"
    assert project.current_quality.aesthetic_findings
    assert not project.current_quality.hard_errors

    state_path = [
        event.payload["to"]
        for event in project.events
        if event.event_type == "ProjectStateChanged"
    ]
    assert state_path == [
        "INGESTING",
        "READY_FOR_DESIGN",
        "DESIGNING",
        "AWAITING_DIRECTION_APPROVAL",
        "PRODUCING",
        "VALIDATING",
        "AWAITING_EXPORT_APPROVAL",
        "READY_TO_DELIVER",
        "DELIVERING",
        "DELIVERED",
    ]
    for value in (
        *project.candidate_history,
        *project.artifact_history,
        *project.render_history,
        *project.export_history,
        *project.quality_history,
        *project.deliveries,
    ):
        assert value.lineage.project_id == project.id
        assert value.lineage.workflow_run_id
        assert value.lineage.capability_version.endswith("/1")


def test_prepare_only_reaches_ready_with_context_brief_and_constraints():
    cp = control_plane()
    project_id = cp.execute(
        CreateProject(command_id="create-needs-input", project_id="needs_input")
    ).project_id
    result = send(cp, project_id, PrepareProject, "prepare-incomplete")
    assert result.state is ProjectState.NEEDS_INPUT
    assert set(result.value) == {"context_package", "design_brief"}

    context = ContextPackage(
        stable_id("context", project_id),
        project_id,
        1,
        ("confirmed",),
        ("source:1",),
    )
    result = send(
        cp,
        project_id,
        PrepareProject,
        "prepare-complete",
        context_package=context,
        brief=DesignBrief("Goal", "Audience", "web"),
    )
    assert result.state is ProjectState.READY_FOR_DESIGN
    assert current(cp, project_id).constraints.runtime_permissions.level == "strict"


def test_illegal_transition_and_stale_revision_do_not_mutate_project():
    cp = control_plane()
    project_id = cp.execute(
        CreateProject(command_id="create-stale", project_id="stale")
    ).project_id
    with pytest.raises(ContractError) as illegal:
        send(cp, project_id, GenerateCandidates, "generate-too-early")
    assert illegal.value.category is ErrorCategory.INVALID_TRANSITION
    assert current(cp, project_id).revision == 1

    with pytest.raises(ContractError) as stale:
        cp.execute(
            PrepareProject(
                command_id="stale-command",
                project_id=project_id,
                expected_project_revision=0,
            )
        )
    assert stale.value.category is ErrorCategory.STALE_REVISION
    assert current(cp, project_id).revision == 1


def test_actual_export_hard_error_blocks_release_and_invalidates_approval():
    cp = control_plane()
    project_id = create_ready(cp)
    produce_to_ready_for_delivery(cp, project_id)
    result = send(
        cp,
        project_id,
        DeliverArtifact,
        "08-broken-export",
        delivery_profile={"format": "zip", "simulate_hard_error": True},
    )
    project = current(cp, project_id)

    assert result.state is ProjectState.PRODUCING
    assert isinstance(result.value, QualityDecision)
    assert result.value.hard_errors
    assert project.deliveries == []
    assert all(
        not approval.active
        for approval in project.approvals.values()
        if approval.action is ApprovalAction.EXPORT
    )
    assert "TransitionBlocked" in [event.event_type for event in project.events]


def test_command_and_delivery_retries_are_idempotent():
    cp = control_plane()
    first = full_flow(cp)
    project_before = current(cp, first.project_id)
    duplicate = cp.execute(
        DeliverArtifact(
            command_id="08-deliver",
            project_id=first.project_id,
            expected_project_revision=7,
            delivery_profile={"format": "zip"},
        )
    )
    project_after = current(cp, first.project_id)

    assert duplicate.value.id == first.value.id
    assert duplicate.project_revision == first.project_revision
    assert len(project_after.deliveries) == 1
    assert len(project_after.events) == len(project_before.events)

    delivery = DeterministicDeliveryPort()
    bundle_one = project_after.deliveries[0]
    approval = project_after.approvals[bundle_one.approval_id]
    direct_one = delivery.release(
        project_after.current_artifact,
        project_after.current_export,
        project_after.current_quality,
        approval,
        side_effect_key=bundle_one.side_effect_key,
    )
    direct_two = delivery.release(
        project_after.current_artifact,
        project_after.current_export,
        project_after.current_quality,
        approval,
        side_effect_key=bundle_one.side_effect_key,
    )
    assert direct_one is direct_two


def test_same_normalized_input_is_deterministic_across_fresh_harnesses():
    left = control_plane()
    right = control_plane()
    left_result = full_flow(left, "stable-project")
    right_result = full_flow(right, "stable-project")
    left_project = current(left, left_result.project_id)
    right_project = current(right, right_result.project_id)

    assert canonical_json(left_project.candidate_history) == canonical_json(
        right_project.candidate_history
    )
    assert canonical_json(left_project.artifact_history) == canonical_json(
        right_project.artifact_history
    )
    assert canonical_json(left_project.quality_history) == canonical_json(
        right_project.quality_history
    )
    assert left_result.value == right_result.value


def test_all_core_ports_can_be_replaced_without_changing_commands():
    class AlternateDesign(DeterministicDesignPort):
        capability_version = "alternate-design/1"

    class AlternateArtifact(DeterministicArtifactPort):
        capability_version = "alternate-artifact/1"

    class AlternateQuality(DeterministicQualityPort):
        capability_version = "alternate-quality/1"

    class AlternateDelivery(DeterministicDeliveryPort):
        capability_version = "alternate-delivery/1"

    cp = control_plane(
        design=AlternateDesign(),
        artifact=AlternateArtifact(),
        quality=AlternateQuality(),
        delivery=AlternateDelivery(),
    )
    result = full_flow(cp)
    project = current(cp, result.project_id)

    assert (
        project.candidate_history[0].lineage.capability_version == "alternate-design/1"
    )
    assert project.current_artifact.lineage.capability_version == "alternate-artifact/1"
    assert project.current_quality.lineage.capability_version == "alternate-quality/1"
    assert project.deliveries[0].lineage.capability_version == "alternate-delivery/1"


def test_candidate_hard_error_blocks_direction_approval():
    class RejectingCandidateQuality(DeterministicQualityPort):
        def assess_candidate(self, candidate, brief, constraints, run):
            decision = super().assess_candidate(candidate, brief, constraints, run)
            hard_error = Finding(
                FindingKind.HARD_ERROR,
                "CANDIDATE_STRUCTURE",
                "Candidate cannot be rendered safely.",
                "error",
                candidate.id,
            )
            return replace(
                decision,
                hard_errors=(hard_error,),
                verdict=GateVerdict.BLOCK,
            )

    cp = control_plane(quality=RejectingCandidateQuality())
    project_id = create_ready(cp)
    candidates = create_candidates(cp, project_id)
    with pytest.raises(ContractError) as blocked:
        send(
            cp,
            project_id,
            ApproveDirection,
            "04-blocked-approval",
            candidate_id=candidates[0].id,
            candidate_revision=1,
        )
    assert blocked.value.category is ErrorCategory.QUALITY_GATE_FAILED
    assert current(cp, project_id).state is ProjectState.AWAITING_DIRECTION_APPROVAL


def test_direction_local_and_fact_feedback_use_distinct_routes():
    cp = control_plane()
    project_id = create_ready(cp)
    candidates = create_candidates(cp, project_id)
    send(
        cp,
        project_id,
        ApproveDirection,
        "04-approve-direction",
        candidate_id=candidates[0].id,
        candidate_revision=1,
    )
    revised_direction = send(
        cp,
        project_id,
        SubmitFeedback,
        "05-direction-feedback",
        kind=FeedbackKind.DIRECTION,
        target_id=candidates[0].id,
        target_revision=1,
        text="Use a calmer narrative",
    ).value
    project = current(cp, project_id)
    assert revised_direction.revision == 2
    assert project.feedback[-1].routed_to == ("design",)
    assert project.approved_direction is None
    assert any(not approval.active for approval in project.approvals.values())

    send(
        cp,
        project_id,
        ApproveDirection,
        "06-reapprove-direction",
        candidate_id=revised_direction.id,
        candidate_revision=2,
    )
    artifact = send(cp, project_id, ProduceArtifact, "07-produce", medium="web").value
    revised_artifact = send(
        cp,
        project_id,
        SubmitFeedback,
        "08-local-feedback",
        kind=FeedbackKind.ARTIFACT_LOCAL,
        target_id=artifact.id,
        target_revision=artifact.revision,
        object_ref="hero:title",
        text="Shorten the title",
    ).value
    project = current(cp, project_id)
    assert revised_artifact.revision == 2
    assert project.feedback[-1].routed_to == ("artifact",)
    assert project.state is ProjectState.VALIDATING

    send(cp, project_id, ValidateArtifact, "09-revalidate")
    send(
        cp,
        project_id,
        ApproveExport,
        "10-export-approval",
        artifact_id=revised_artifact.id,
        artifact_revision=2,
    )
    result = send(
        cp,
        project_id,
        SubmitFeedback,
        "11-fact-feedback",
        kind=FeedbackKind.FACT_OR_POLICY,
        target_id=revised_artifact.id,
        target_revision=2,
        text="The cited amount is incorrect",
    )
    project = current(cp, project_id)
    assert result.state is ProjectState.NEEDS_INPUT
    assert project.feedback[-1].routed_to == ("context", "quality")
    assert all(not approval.active for approval in project.approvals.values())


@pytest.mark.parametrize(
    ("template_role", "expected_hard_errors"),
    [
        (TemplateRole.REFERENCE_SAMPLE, 0),
        (TemplateRole.DELIVERY_CONTRACT, 1),
    ],
)
def test_template_roles_have_observable_quality_behavior(
    template_role: TemplateRole, expected_hard_errors: int
):
    cp = control_plane()
    project_id = create_ready(
        cp, project_id=f"role-{template_role.value}", template_role=template_role
    )
    candidates = create_candidates(cp, project_id)
    assert all(candidate.template_role is template_role for candidate in candidates)
    send(
        cp,
        project_id,
        ApproveDirection,
        "04-approve-direction",
        candidate_id=candidates[0].id,
        candidate_revision=1,
    )
    artifact = send(cp, project_id, ProduceArtifact, "05-produce").value
    send(
        cp,
        project_id,
        SubmitFeedback,
        "06-break-contract",
        kind=FeedbackKind.ARTIFACT_LOCAL,
        target_id=artifact.id,
        target_revision=1,
        text="[break-contract] change locked structure",
    )
    decision = send(cp, project_id, ValidateArtifact, "07-validate").value
    assert len(decision.hard_errors) == expected_hard_errors


def test_workflow_boundary_is_queryable_resumable_cancelable_and_idempotent():
    runtime = InMemoryWorkflowRuntime()
    run = runtime.start("project", "design", 3, "run-key")
    assert runtime.start("project", "design", 3, "run-key") == run
    same_key_other_project = runtime.start("project-2", "design", 3, "run-key")
    assert same_key_other_project.id != run.id
    assert runtime.query("project") == (run,)

    resumed = runtime.resume(run.id, {"answer": "continue"})
    replay = runtime.query(run.id, after_event=1)[0]
    assert resumed.status is WorkflowStatus.RUNNING
    assert [event.event_type for event in replay.events] == ["WorkflowResumed"]

    canceled = runtime.cancel(run.id, "user stopped")
    assert canceled.status is WorkflowStatus.CANCELED
    with pytest.raises(ContractError) as error:
        runtime.resume(run.id)
    assert error.value.category is ErrorCategory.INVALID_TRANSITION

    other = runtime.start("project", "validate", 4, "other-key")
    completed = runtime.complete(other.id, stage="render", output_refs=("render:1",))
    duplicate = runtime.complete(other.id, stage="render", output_refs=("render:1",))
    assert completed == duplicate
    assert completed.completed_stages == ("render",)


def test_command_id_collision_and_wrong_approval_target_are_rejected():
    cp = control_plane()
    project_id = create_ready(cp)
    candidates = create_candidates(cp, project_id)
    command = ApproveDirection(
        command_id="04-approve",
        project_id=project_id,
        expected_project_revision=current(cp, project_id).revision,
        candidate_id=candidates[0].id,
        candidate_revision=1,
    )
    cp.execute(command)
    with pytest.raises(ContractError) as collision:
        cp.execute(
            ApproveDirection(
                command_id="04-approve",
                project_id=project_id,
                expected_project_revision=command.expected_project_revision,
                candidate_id=candidates[1].id,
                candidate_revision=1,
            )
        )
    assert collision.value.category is ErrorCategory.DETERMINISTIC_FAILURE

    artifact = send(cp, project_id, ProduceArtifact, "05-produce").value
    send(cp, project_id, ValidateArtifact, "06-validate")
    with pytest.raises(ContractError) as stale:
        send(
            cp,
            project_id,
            ApproveExport,
            "07-wrong-target",
            artifact_id=artifact.id,
            artifact_revision=99,
        )
    assert stale.value.category is ErrorCategory.STALE_REVISION


def test_contract_values_do_not_expose_vendor_message_schema():
    contract_types = (
        Candidate,
        ArtifactRevision,
        RenderBundle,
        ExportCandidate,
        QualityDecision,
        DeliveryBundle,
        Approval,
    )
    forbidden_prefixes = ("vendor_", "provider_", "thread_", "assistant_message")
    for contract_type in contract_types:
        names = {item.name for item in fields(contract_type)}
        assert not any(name.startswith(forbidden_prefixes) for name in names), (
            contract_type.__name__
        )
