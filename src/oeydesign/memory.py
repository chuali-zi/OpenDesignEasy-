"""In-memory reference adapters used by Phase 1 conformance tests."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import replace
from typing import Any

from .domain import (
    CheckpointStatus,
    CommandRecord,
    ContractError,
    ErrorCategory,
    Project,
    StageCheckpoint,
    WorkflowProgressEvent,
    WorkflowRun,
    WorkflowStatus,
    stable_id,
)


class InMemoryProjectRepository:
    def __init__(self) -> None:
        self._projects: dict[str, Project] = {}
        self._revisions: dict[str, dict[int, Project]] = {}

    def add(self, project: Project) -> None:
        if project.id in self._projects:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Project already exists",
                details={"project_id": project.id},
            )
        self._projects[project.id] = deepcopy(project)
        self._revisions[project.id] = {project.revision: deepcopy(project)}

    def get(self, project_id: str) -> Project:
        try:
            return deepcopy(self._projects[project_id])
        except KeyError as exc:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Project does not exist",
                details={"project_id": project_id},
            ) from exc

    def save(self, project: Project, *, expected_revision: int) -> None:
        stored = self._projects.get(project.id)
        if stored is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Project does not exist",
                details={"project_id": project.id},
            )
        if stored.revision != expected_revision:
            raise ContractError(
                ErrorCategory.STALE_REVISION,
                "Project changed before the command could commit",
                current_revision=stored.revision,
            )
        self._projects[project.id] = deepcopy(project)
        self._revisions[project.id][project.revision] = deepcopy(project)

    def get_revision(self, project_id: str, revision: int) -> Project:
        try:
            return deepcopy(self._revisions[project_id][revision])
        except KeyError as exc:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Project revision does not exist",
                details={"project_id": project_id, "revision": revision},
            ) from exc

    def list_revisions(self, project_id: str) -> tuple[int, ...]:
        try:
            return tuple(sorted(self._revisions[project_id]))
        except KeyError as exc:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Project does not exist",
                details={"project_id": project_id},
            ) from exc


class InMemoryCommandLedger:
    def __init__(self) -> None:
        self._records: dict[str, CommandRecord] = {}

    def get(self, command_id: str) -> CommandRecord | None:
        record = self._records.get(command_id)
        return deepcopy(record) if record else None

    def record(self, command_id: str, record: CommandRecord) -> None:
        existing = self._records.get(command_id)
        if existing and existing.fingerprint != record.fingerprint:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Command ID was reused with a different payload",
                details={"command_id": command_id},
            )
        self._records[command_id] = deepcopy(record)


class InMemoryWorkflowRuntime:
    def __init__(self) -> None:
        self._runs: dict[str, WorkflowRun] = {}
        self._by_key: dict[str, str] = {}
        self._checkpoints: dict[tuple[str, str, str], StageCheckpoint] = {}

    def start(
        self,
        project_id: str,
        workflow_kind: str,
        input_revision: int,
        idempotency_key: str,
    ) -> WorkflowRun:
        request_key = stable_id(
            "workflow-request",
            project_id,
            workflow_kind,
            input_revision,
            idempotency_key,
        )
        if request_key in self._by_key:
            return self._runs[self._by_key[request_key]]
        run_id = stable_id(
            "run", project_id, workflow_kind, input_revision, idempotency_key
        )
        event = WorkflowProgressEvent(1, "WorkflowStarted", "start", "Run started")
        run = WorkflowRun(
            id=run_id,
            project_id=project_id,
            workflow_kind=workflow_kind,
            input_revision=input_revision,
            idempotency_key=idempotency_key,
            status=WorkflowStatus.RUNNING,
            current_stage="start",
            events=(event,),
        )
        self._runs[run.id] = run
        self._by_key[request_key] = run.id
        return run

    def resume(
        self, run_id: str, resume_input: Mapping[str, Any] | None = None
    ) -> WorkflowRun:
        run = self._get(run_id)
        if run.status is WorkflowStatus.COMPLETED:
            return run
        if run.status in {WorkflowStatus.CANCELED, WorkflowStatus.FAILED}:
            raise ContractError(
                ErrorCategory.INVALID_TRANSITION,
                f"Cannot resume a {run.status.value.lower()} workflow",
            )
        event = WorkflowProgressEvent(
            len(run.events) + 1,
            "WorkflowResumed",
            run.current_stage,
            "Run resumed" if not resume_input else "Run resumed with input",
        )
        run = replace(run, status=WorkflowStatus.RUNNING, events=run.events + (event,))
        self._runs[run.id] = run
        return run

    def pause(self, run_id: str, reason: str) -> WorkflowRun:
        run = self._get(run_id)
        if run.status is WorkflowStatus.COMPLETED:
            raise ContractError(
                ErrorCategory.INVALID_TRANSITION,
                "A completed workflow cannot be paused",
            )
        if run.status is WorkflowStatus.PAUSED:
            return run
        event = WorkflowProgressEvent(
            len(run.events) + 1, "WorkflowPaused", run.current_stage, reason
        )
        run = replace(
            run,
            status=WorkflowStatus.PAUSED,
            pause_reason=reason,
            events=run.events + (event,),
        )
        self._runs[run.id] = run
        return run

    def cancel(self, run_id: str, reason: str) -> WorkflowRun:
        run = self._get(run_id)
        if run.status is WorkflowStatus.COMPLETED:
            raise ContractError(
                ErrorCategory.INVALID_TRANSITION,
                "A completed workflow cannot be canceled",
            )
        if run.status is WorkflowStatus.CANCELED:
            return run
        event = WorkflowProgressEvent(
            len(run.events) + 1, "WorkflowCanceled", run.current_stage, reason
        )
        run = replace(run, status=WorkflowStatus.CANCELED, events=run.events + (event,))
        self._runs[run.id] = run
        return run

    def query(
        self, run_or_project_id: str, *, after_event: int = 0
    ) -> tuple[WorkflowRun, ...]:
        direct = self._runs.get(run_or_project_id)
        runs = (
            (direct,)
            if direct
            else tuple(
                run
                for run in self._runs.values()
                if run.project_id == run_or_project_id
            )
        )
        if not runs:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Workflow run or Project does not exist",
                details={"run_or_project_id": run_or_project_id},
            )
        if after_event <= 0:
            return runs
        return tuple(
            replace(
                run,
                events=tuple(
                    event for event in run.events if event.sequence > after_event
                ),
            )
            for run in runs
        )

    def complete(
        self,
        run_id: str,
        *,
        stage: str,
        output_refs: tuple[str, ...] = (),
        side_effect_key: str | None = None,
    ) -> WorkflowRun:
        run = self._get(run_id)
        if stage in run.completed_stages:
            return run
        message = "Completed"
        if output_refs:
            message += f" with {len(output_refs)} output(s)"
        event = WorkflowProgressEvent(
            len(run.events) + 1, "WorkflowProgressed", stage, message
        )
        side_effect_keys = run.side_effect_keys
        if side_effect_key and side_effect_key not in side_effect_keys:
            side_effect_keys += (side_effect_key,)
        run = replace(
            run,
            status=WorkflowStatus.COMPLETED,
            current_stage=stage,
            completed_stages=run.completed_stages + (stage,),
            side_effect_keys=side_effect_keys,
            events=run.events + (event,),
        )
        self._runs[run.id] = run
        return run

    def checkpoint(
        self,
        run_id: str,
        *,
        stage: str,
        input_fingerprint: str,
        output_refs: tuple[str, ...] = (),
        side_effect_key: str | None = None,
    ) -> StageCheckpoint:
        key = (run_id, stage, input_fingerprint)
        existing = self._checkpoints.get(key)
        if existing and existing.status is CheckpointStatus.COMPLETED:
            return existing
        checkpoint = StageCheckpoint(
            run_id=run_id,
            stage=stage,
            input_fingerprint=input_fingerprint,
            status=CheckpointStatus.COMPLETED,
            attempt=1,
            output_refs=output_refs,
            side_effect_key=side_effect_key,
        )
        self._checkpoints[key] = checkpoint
        self.complete(
            run_id,
            stage=stage,
            output_refs=output_refs,
            side_effect_key=side_effect_key,
        )
        return checkpoint

    def get_checkpoint(
        self, run_id: str, stage: str, input_fingerprint: str
    ) -> StageCheckpoint | None:
        return self._checkpoints.get((run_id, stage, input_fingerprint))

    def _get(self, run_id: str) -> WorkflowRun:
        try:
            return self._runs[run_id]
        except KeyError as exc:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Workflow run does not exist",
                details={"workflow_run_id": run_id},
            ) from exc
