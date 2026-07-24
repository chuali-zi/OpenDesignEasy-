from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from oeydesign.composition import SQLiteApplication
from oeydesign.control import ControlPlane
from oeydesign.domain import (
    ApproveDirection,
    ApproveExport,
    CancelWorkflow,
    ContextPackage,
    ContractError,
    CreateProject,
    DeliverArtifact,
    DesignBrief,
    ErrorCategory,
    GenerateCandidates,
    PauseWorkflow,
    PrepareProject,
    ProduceArtifact,
    ProjectState,
    ReconcileWorkflowStatus,
    RestoreProjectRevision,
    ResumeWorkflow,
    ValidateArtifact,
    WorkflowStatus,
    stable_id,
)
from oeydesign.persistence import (
    SQLiteCommandLedger,
    SQLiteProjectRepository,
    SQLiteStore,
    SQLiteTransactionalProjectWriter,
)
from oeydesign.recovery import DurableDeliveryPort
from oeydesign.runtime import FailureInjector, RecoverableStageRunner
from oeydesign.stubs import DeterministicDeliveryPort

FIXED_TIME = datetime(2026, 7, 24, 12, 0, tzinfo=UTC)


def send(app, project_id: str, command_type, command_id: str, **values):
    project = app.repository.get(project_id)
    return app.control.execute(
        command_type(
            command_id=command_id,
            project_id=project_id,
            expected_project_revision=project.revision,
            **values,
        )
    )


def create_ready(app, project_id: str) -> None:
    app.control.execute(
        CreateProject(
            command_id=f"{project_id}:create",
            project_id=project_id,
            name="Recoverable demo",
        )
    )
    send(
        app,
        project_id,
        PrepareProject,
        f"{project_id}:prepare",
        context_package=ContextPackage(
            id=stable_id("context", project_id),
            project_id=project_id,
            revision=1,
            confirmed_facts=("Confirmed fact",),
            source_refs=("source:brief#row=1",),
        ),
        brief=DesignBrief("Launch", "Design leaders", "web"),
    )


def create_producing(app, project_id: str) -> None:
    create_ready(app, project_id)
    candidates = send(
        app,
        project_id,
        GenerateCandidates,
        f"{project_id}:generate",
    ).value
    send(
        app,
        project_id,
        ApproveDirection,
        f"{project_id}:approve-direction",
        candidate_id=candidates[0].id,
        candidate_revision=candidates[0].revision,
    )


def deliver(app, project_id: str):
    create_producing(app, project_id)
    artifact = send(
        app,
        project_id,
        ProduceArtifact,
        f"{project_id}:produce",
    ).value
    send(app, project_id, ValidateArtifact, f"{project_id}:validate")
    send(
        app,
        project_id,
        ApproveExport,
        f"{project_id}:approve-export",
        artifact_id=artifact.id,
        artifact_revision=artifact.revision,
    )
    return send(
        app,
        project_id,
        DeliverArtifact,
        f"{project_id}:deliver",
        delivery_profile={"format": "zip"},
    )


def test_composition_root_recovers_project_commands_events_effects_and_restore(
    tmp_path: Path,
) -> None:
    database = tmp_path / "application.sqlite"
    project_id = "durable-project"
    with SQLiteApplication(
        database, data_root=tmp_path, clock=lambda: FIXED_TIME
    ) as app:
        delivered = deliver(app, project_id)
        project = app.repository.get(project_id)
        bundle = delivered.value
        cursor = project.events[-2].sequence
        after_cursor = app.events.after_sequence(project_id, cursor)
        assert [event.sequence for event in after_cursor] == [cursor + 1]
        assert app.side_effects.get(bundle.side_effect_key)["status"] == "COMPLETED"

        repeated = app.control.delivery.release(
            project.current_artifact,
            project.current_export,
            project.current_quality,
            project.approvals[bundle.approval_id],
            side_effect_key=bundle.side_effect_key,
        )
        assert repeated == bundle

        retry = app.control.execute(
            DeliverArtifact(
                command_id=f"{project_id}:deliver",
                project_id=project_id,
                expected_project_revision=7,
                delivery_profile={"format": "zip"},
            )
        )
        assert retry == delivered

        restored = send(
            app,
            project_id,
            RestoreProjectRevision,
            f"{project_id}:restore",
            source_revision=5,
        )
        project = app.repository.get(project_id)
        assert restored.state is ProjectState.VALIDATING
        assert project.restored_from_revision == 5
        assert project.deliveries == [bundle]
        assert project.current_export is None
        assert all(not approval.active for approval in project.approvals.values())
        assert app.repository.list_revisions(project_id) == tuple(range(1, 10))
        assert app.audit.query(project_id=project_id)

    with SQLiteApplication(
        database, data_root=tmp_path, clock=lambda: FIXED_TIME
    ) as reopened:
        project = reopened.repository.get(project_id)
        assert project.revision == 9
        assert project.state is ProjectState.VALIDATING
        assert reopened.ledger.get(f"{project_id}:deliver") is not None
        assert reopened.events.after_sequence(project_id, cursor)
        assert reopened.side_effects.get(bundle.side_effect_key)["result"] == bundle


def test_pause_resume_failure_reconciliation_and_cancel_are_durable(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workflow-project.sqlite"
    with SQLiteApplication(
        database, data_root=tmp_path, clock=lambda: FIXED_TIME
    ) as app:
        project_id = "needs-input-project"
        create_producing(app, project_id)
        project = app.repository.get(project_id)
        run = app.runtime.start(project_id, "long-design", project.revision, "manual")
        paused = send(
            app,
            project_id,
            PauseWorkflow,
            f"{project_id}:pause",
            workflow_run_id=run.id,
            reason="Review requested",
        ).value
        assert paused.status is WorkflowStatus.PAUSED
        assert app.repository.get(project_id).state is ProjectState.PRODUCING
        resumed = send(
            app,
            project_id,
            ResumeWorkflow,
            f"{project_id}:resume",
            workflow_run_id=run.id,
            resume_input={"answer": "continue"},
        ).value
        assert resumed.status is WorkflowStatus.RUNNING

        injector = FailureInjector()
        injector.inject("source-confirmation", ErrorCategory.NEEDS_INPUT)
        failed_stage = RecoverableStageRunner(app.runtime, injector=injector).run_stage(
            run.id, "source-confirmation", {"source": 1}, lambda: ("ok",)
        )
        assert failed_stage.run.status is WorkflowStatus.NEEDS_INPUT
        reconciled = send(
            app,
            project_id,
            ReconcileWorkflowStatus,
            f"{project_id}:reconcile",
            workflow_run_id=run.id,
        )
        assert reconciled.state is ProjectState.NEEDS_INPUT
        assert app.repository.get(project_id).status_reason
        send(
            app,
            project_id,
            ResumeWorkflow,
            f"{project_id}:resume-input",
            workflow_run_id=run.id,
            resume_input={"source_confirmed": True},
        )
        assert app.repository.get(project_id).state is ProjectState.PRODUCING

        canceled_id = "canceled-project"
        create_producing(app, canceled_id)
        canceled_project = app.repository.get(canceled_id)
        canceled_run = app.runtime.start(
            canceled_id, "produce", canceled_project.revision, "cancel"
        )
        canceled = send(
            app,
            canceled_id,
            CancelWorkflow,
            f"{canceled_id}:cancel",
            workflow_run_id=canceled_run.id,
            reason="User stopped",
        )
        assert canceled.state is ProjectState.CANCELED

        blocked_id = "blocked-project"
        create_producing(app, blocked_id)
        blocked_project = app.repository.get(blocked_id)
        blocked_run = app.runtime.start(
            blocked_id, "produce", blocked_project.revision, "blocked"
        )
        blocked_injector = FailureInjector()
        blocked_injector.inject("policy", ErrorCategory.POLICY_BLOCKED)
        RecoverableStageRunner(app.runtime, injector=blocked_injector).run_stage(
            blocked_run.id, "policy", {}, lambda: ("unused",)
        )
        blocked = send(
            app,
            blocked_id,
            ReconcileWorkflowStatus,
            f"{blocked_id}:reconcile",
            workflow_run_id=blocked_run.id,
        )
        assert blocked.state is ProjectState.BLOCKED

        failed_id = "failed-project"
        create_producing(app, failed_id)
        failed_project = app.repository.get(failed_id)
        failed_run = app.runtime.start(
            failed_id, "produce", failed_project.revision, "failed"
        )
        failed_injector = FailureInjector()
        failed_injector.inject("materialize", ErrorCategory.DETERMINISTIC_FAILURE)
        RecoverableStageRunner(app.runtime, injector=failed_injector).run_stage(
            failed_run.id, "materialize", {}, lambda: ("unused",)
        )
        failed = send(
            app,
            failed_id,
            ReconcileWorkflowStatus,
            f"{failed_id}:reconcile",
            workflow_run_id=failed_run.id,
        )
        assert failed.state is ProjectState.FAILED

    with SQLiteApplication(
        database, data_root=tmp_path, clock=lambda: FIXED_TIME
    ) as reopened:
        assert reopened.repository.get(canceled_id).state is ProjectState.CANCELED
        blocked_project = reopened.repository.get(blocked_id)
        assert blocked_project.state is ProjectState.BLOCKED
        assert blocked_project.status_reason == "Injected policy_blocked at policy"
        assert reopened.repository.get(failed_id).state is ProjectState.FAILED


def test_transaction_writer_rolls_back_project_when_command_record_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = SQLiteStore(tmp_path / "atomic.sqlite", data_root=tmp_path)
    repository = SQLiteProjectRepository(store)
    ledger = SQLiteCommandLedger(store)
    writer = SQLiteTransactionalProjectWriter(store)

    def explode(*_args, **_kwargs) -> None:
        raise RuntimeError("simulated command-ledger failure")

    monkeypatch.setattr(writer, "_record", explode)
    control = ControlPlane(
        repository=repository,
        ledger=ledger,
        transactional_writer=writer,
        clock=lambda: FIXED_TIME,
    )
    with pytest.raises(RuntimeError, match="simulated command-ledger failure"):
        control.execute(
            CreateProject(
                command_id="atomic:create",
                project_id="atomic-project",
            )
        )
    with pytest.raises(ContractError):
        repository.get("atomic-project")
    assert ledger.get("atomic:create") is None
    store.close()


def test_expired_delivery_claim_is_reconciled_before_release(tmp_path: Path) -> None:
    class CountingDelivery(DeterministicDeliveryPort):
        def __init__(self) -> None:
            super().__init__()
            self.release_calls = 0
            self.reconcile_calls = 0

        def release(self, *args, **kwargs):
            self.release_calls += 1
            return super().release(*args, **kwargs)

        def reconcile(self, *args, **kwargs):
            self.reconcile_calls += 1
            return super().reconcile(*args, **kwargs)

    database = tmp_path / "reconcile.sqlite"
    with SQLiteApplication(
        database, data_root=tmp_path, clock=lambda: FIXED_TIME
    ) as app:
        delivered = deliver(app, "reconcile-project")
        project = app.repository.get("reconcile-project")
        artifact = project.current_artifact
        export = project.current_export
        decision = project.current_quality
        assert artifact and export and decision
        approval = project.approvals[delivered.value.approval_id]
        effect_key = stable_id("crash-window", project.id, project.revision)
        app.side_effects.claim(
            effect_key,
            project_id=project.id,
            action="delivery.release",
            target_revision=artifact.revision,
            lease_seconds=0,
        )
        inner = CountingDelivery()
        executed = inner.release(
            artifact,
            export,
            decision,
            approval,
            side_effect_key=effect_key,
        )
        durable = DurableDeliveryPort(inner, app.side_effects)
        reconciled = durable.release(
            artifact,
            export,
            decision,
            approval,
            side_effect_key=effect_key,
        )
        assert reconciled == executed
        assert inner.release_calls == 1
        assert inner.reconcile_calls == 1
        assert app.side_effects.get(effect_key)["status"] == "COMPLETED"


def test_resume_rejects_changed_project_without_explicit_compatibility(
    tmp_path: Path,
) -> None:
    database = tmp_path / "resume-compatibility.sqlite"
    with SQLiteApplication(
        database, data_root=tmp_path, clock=lambda: FIXED_TIME
    ) as app:
        project_id = "resume-project"
        create_ready(app, project_id)
        project = app.repository.get(project_id)
        run = app.runtime.start(project_id, "long-design", project.revision, "manual")
        send(
            app,
            project_id,
            PauseWorkflow,
            f"{project_id}:pause",
            workflow_run_id=run.id,
        )
        send(
            app,
            project_id,
            GenerateCandidates,
            f"{project_id}:generate-after-pause",
        )
        with pytest.raises(ContractError) as stale:
            send(
                app,
                project_id,
                ResumeWorkflow,
                f"{project_id}:unsafe-resume",
                workflow_run_id=run.id,
            )
        assert stale.value.category is ErrorCategory.STALE_REVISION
        current_revision = app.repository.get(project_id).revision
        resumed = send(
            app,
            project_id,
            ResumeWorkflow,
            f"{project_id}:confirmed-resume",
            workflow_run_id=run.id,
            resume_input={"compatible_project_revision": current_revision},
        )
        assert resumed.value.status is WorkflowStatus.RUNNING
