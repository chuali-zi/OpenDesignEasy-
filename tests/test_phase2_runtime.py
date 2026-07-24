import pytest

from oeydesign.domain import ContractError, ErrorCategory, WorkflowStatus
from oeydesign.runtime import (
    FailureInjector,
    RecoverableStageRunner,
    SQLiteWorkflowRuntime,
)


def test_restart_cursor_pause_resume_cancel_and_checkpoint_reuse(tmp_path):
    path = tmp_path / "runtime.sqlite"
    rt = SQLiteWorkflowRuntime(path, data_root=tmp_path)
    run = rt.start("project", "design", 1, "key")
    rt.pause(run.id, "wait")
    assert rt.resume(run.id).status is WorkflowStatus.RUNNING
    first = rt.checkpoint(
        run.id, stage="plan", input_fingerprint="input", output_refs=("out",)
    )
    assert (
        rt.checkpoint(run.id, stage="plan", input_fingerprint="input").output_refs
        == first.output_refs
    )
    events = rt.query(run.id, after_event=0)[0].events
    assert events
    assert rt.query(run.id, after_event=events[-1].sequence)[0].events == ()
    rt.close()
    rt = SQLiteWorkflowRuntime(path, data_root=tmp_path)
    restored = rt.query(run.id)[0]
    assert "plan" in restored.completed_stages
    cancelable = rt.start("project", "other", 1, "cancel-key")
    assert rt.cancel(cancelable.id, "stop").status is WorkflowStatus.CANCELED
    rt.close()


def test_failure_injection_is_bounded_and_checkpoint_reuse(tmp_path):
    rt = SQLiteWorkflowRuntime(tmp_path / "runtime.sqlite", data_root=tmp_path)
    run = rt.start("p", "produce", 1, "key")
    injector = FailureInjector()
    injector.inject_timeout("render", times=2)
    calls = []
    result = RecoverableStageRunner(rt, injector=injector).run_stage(
        run.id,
        "render",
        {"v": 1},
        lambda: calls.append(1) or ("render",),
        max_attempts=3,
    )
    assert result.checkpoint.status.value == "COMPLETED" and len(calls) == 1
    reused = RecoverableStageRunner(rt).run_stage(
        run.id, "render", {"v": 1}, lambda: (_ for _ in ()).throw(AssertionError())
    )
    assert reused.reused
    injector.inject("blocked", ErrorCategory.POLICY_BLOCKED)
    blocked = RecoverableStageRunner(rt, injector=injector).run_stage(
        run.id, "blocked", {}, lambda: ("x",)
    )
    assert blocked.run.status is WorkflowStatus.BLOCKED


def test_database_path_cannot_escape_data_root(tmp_path):

    with pytest.raises(ContractError) as error:
        SQLiteWorkflowRuntime(tmp_path.parent / "outside.sqlite", data_root=tmp_path)
    assert error.value.category is ErrorCategory.POLICY_BLOCKED
