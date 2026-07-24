"""SQLite-backed workflow runtime and deterministic failure injection."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .domain import (
    CheckpointStatus,
    ContractError,
    ErrorCategory,
    StageCheckpoint,
    WorkflowProgressEvent,
    WorkflowRun,
    WorkflowStatus,
    canonical_json,
    stable_id,
    utc_now,
)
from .paths import resolve_database_path


class SQLiteWorkflowRuntime:
    """Durable single-node implementation of the WorkflowRuntimePort."""

    def __init__(
        self,
        database: str | Path,
        *,
        data_root: str | Path | None = None,
        clock: Callable[[], datetime] = utc_now,
        busy_timeout_ms: int = 5_000,
    ) -> None:
        self.database = resolve_database_path(database, data_root)
        self.clock = clock
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(
            self.database,
            check_same_thread=False,
            isolation_level=None,
        )
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA foreign_keys = ON")
        if self.database != ":memory:":
            self._connection.execute("PRAGMA journal_mode = WAL")
        self._connection.execute(f"PRAGMA busy_timeout = {int(busy_timeout_ms)}")
        self._migrate()

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def start(
        self,
        project_id: str,
        workflow_kind: str,
        input_revision: int,
        idempotency_key: str,
    ) -> WorkflowRun:
        with self._lock, self._transaction():
            existing = self._connection.execute(
                """
                SELECT id FROM workflow_runs
                WHERE project_id = ? AND workflow_kind = ?
                  AND input_revision = ? AND idempotency_key = ?
                """,
                (project_id, workflow_kind, input_revision, idempotency_key),
            ).fetchone()
            if existing:
                run_id = str(existing["id"])
            else:
                run_id = stable_id(
                    "run",
                    project_id,
                    workflow_kind,
                    input_revision,
                    idempotency_key,
                )
                timestamp = self.clock().isoformat()
                self._connection.execute(
                    """
                    INSERT INTO workflow_runs (
                        id, project_id, workflow_kind, input_revision,
                        idempotency_key, status, current_stage,
                        completed_stages_json, side_effect_keys_json,
                        attempt, max_attempts, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        project_id,
                        workflow_kind,
                        input_revision,
                        idempotency_key,
                        WorkflowStatus.RUNNING.value,
                        "start",
                        "[]",
                        "[]",
                        0,
                        3,
                        timestamp,
                        timestamp,
                    ),
                )
                self._append_event(
                    run_id,
                    project_id,
                    "WorkflowStarted",
                    "start",
                    "Run started",
                )
        return self.query(run_id)[0]

    def resume(
        self, run_id: str, resume_input: Mapping[str, Any] | None = None
    ) -> WorkflowRun:
        with self._lock, self._transaction():
            row = self._run_row(run_id)
            status = WorkflowStatus(row["status"])
            if status is WorkflowStatus.COMPLETED:
                return self._run_from_row(row)
            if status in {WorkflowStatus.CANCELED, WorkflowStatus.FAILED}:
                raise ContractError(
                    ErrorCategory.INVALID_TRANSITION,
                    f"Cannot resume a {status.value.lower()} workflow",
                )
            message = "Run resumed"
            if resume_input:
                message += " with input"
            timestamp = self.clock().isoformat()
            self._connection.execute(
                """
                UPDATE workflow_runs
                SET status = ?, pause_reason = NULL,
                    error_category = NULL, error_message = NULL, updated_at = ?
                WHERE id = ?
                """,
                (WorkflowStatus.RUNNING.value, timestamp, run_id),
            )
            self._append_event(
                run_id,
                str(row["project_id"]),
                "WorkflowResumed",
                str(row["current_stage"]),
                message,
                {"has_resume_input": bool(resume_input)},
            )
        return self.query(run_id)[0]

    def pause(self, run_id: str, reason: str) -> WorkflowRun:
        with self._lock, self._transaction():
            row = self._run_row(run_id)
            status = WorkflowStatus(row["status"])
            if status is WorkflowStatus.COMPLETED:
                raise ContractError(
                    ErrorCategory.INVALID_TRANSITION,
                    "A completed workflow cannot be paused",
                )
            if status is WorkflowStatus.PAUSED:
                return self._run_from_row(row)
            timestamp = self.clock().isoformat()
            self._connection.execute(
                """
                UPDATE workflow_runs
                SET status = ?, pause_reason = ?, updated_at = ?
                WHERE id = ?
                """,
                (WorkflowStatus.PAUSED.value, reason, timestamp, run_id),
            )
            self._append_event(
                run_id,
                str(row["project_id"]),
                "WorkflowPaused",
                str(row["current_stage"]),
                reason,
            )
        return self.query(run_id)[0]

    def cancel(self, run_id: str, reason: str) -> WorkflowRun:
        with self._lock, self._transaction():
            row = self._run_row(run_id)
            status = WorkflowStatus(row["status"])
            if status is WorkflowStatus.COMPLETED:
                raise ContractError(
                    ErrorCategory.INVALID_TRANSITION,
                    "A completed workflow cannot be canceled",
                )
            if status is WorkflowStatus.CANCELED:
                return self._run_from_row(row)
            timestamp = self.clock().isoformat()
            self._connection.execute(
                """
                UPDATE workflow_runs
                SET status = ?, pause_reason = ?, updated_at = ?
                WHERE id = ?
                """,
                (WorkflowStatus.CANCELED.value, reason, timestamp, run_id),
            )
            self._append_event(
                run_id,
                str(row["project_id"]),
                "WorkflowCanceled",
                str(row["current_stage"]),
                reason,
            )
        return self.query(run_id)[0]

    def query(
        self, run_or_project_id: str, *, after_event: int = 0
    ) -> tuple[WorkflowRun, ...]:
        with self._lock:
            direct = self._connection.execute(
                "SELECT * FROM workflow_runs WHERE id = ?", (run_or_project_id,)
            ).fetchone()
            if direct:
                rows = (direct,)
            else:
                rows = tuple(
                    self._connection.execute(
                        """
                        SELECT * FROM workflow_runs
                        WHERE project_id = ?
                        ORDER BY created_at, id
                        """,
                        (run_or_project_id,),
                    ).fetchall()
                )
            if not rows:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Workflow run or Project does not exist",
                    details={"run_or_project_id": run_or_project_id},
                )
            return tuple(
                self._run_from_row(row, after_event=after_event) for row in rows
            )

    def complete(
        self,
        run_id: str,
        *,
        stage: str,
        output_refs: tuple[str, ...] = (),
        side_effect_key: str | None = None,
    ) -> WorkflowRun:
        with self._lock, self._transaction():
            row = self._run_row(run_id)
            completed = list(json.loads(str(row["completed_stages_json"])))
            if stage not in completed:
                completed.append(stage)
                side_effects = list(json.loads(str(row["side_effect_keys_json"])))
                if side_effect_key and side_effect_key not in side_effects:
                    side_effects.append(side_effect_key)
                timestamp = self.clock().isoformat()
                self._connection.execute(
                    """
                    UPDATE workflow_runs
                    SET status = ?, current_stage = ?,
                        completed_stages_json = ?, side_effect_keys_json = ?,
                        error_category = NULL, error_message = NULL, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        WorkflowStatus.COMPLETED.value,
                        stage,
                        canonical_json(completed),
                        canonical_json(side_effects),
                        timestamp,
                        run_id,
                    ),
                )
                self._append_event(
                    run_id,
                    str(row["project_id"]),
                    "WorkflowProgressed",
                    stage,
                    f"Completed with {len(output_refs)} output(s)",
                    {"output_refs": output_refs},
                )
        return self.query(run_id)[0]

    def checkpoint(
        self,
        run_id: str,
        *,
        stage: str,
        input_fingerprint: str,
        output_refs: tuple[str, ...] = (),
        side_effect_key: str | None = None,
    ) -> StageCheckpoint:
        with self._lock, self._transaction():
            self._run_row(run_id)
            existing = self._checkpoint_row(run_id, stage, input_fingerprint)
            if existing and existing["status"] == CheckpointStatus.COMPLETED.value:
                return self._checkpoint_from_row(existing)
            attempt = int(existing["attempt"]) if existing else 1
            timestamp = self.clock().isoformat()
            self._connection.execute(
                """
                INSERT INTO workflow_checkpoints (
                    run_id, stage, input_fingerprint, status, attempt,
                    output_refs_json, side_effect_key, created_at, updated_at,
                    completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id, stage, input_fingerprint) DO UPDATE SET
                    status = excluded.status,
                    output_refs_json = excluded.output_refs_json,
                    side_effect_key = excluded.side_effect_key,
                    updated_at = excluded.updated_at,
                    completed_at = excluded.completed_at
                """,
                (
                    run_id,
                    stage,
                    input_fingerprint,
                    CheckpointStatus.COMPLETED.value,
                    attempt,
                    canonical_json(output_refs),
                    side_effect_key,
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )
        self.complete(
            run_id,
            stage=stage,
            output_refs=output_refs,
            side_effect_key=side_effect_key,
        )
        checkpoint = self.get_checkpoint(run_id, stage, input_fingerprint)
        assert checkpoint
        return checkpoint

    def get_checkpoint(
        self, run_id: str, stage: str, input_fingerprint: str
    ) -> StageCheckpoint | None:
        with self._lock:
            row = self._checkpoint_row(run_id, stage, input_fingerprint)
            return self._checkpoint_from_row(row) if row else None

    def list_checkpoints(self, run_id: str) -> tuple[StageCheckpoint, ...]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM workflow_checkpoints
                WHERE run_id = ? ORDER BY created_at, stage
                """,
                (run_id,),
            ).fetchall()
            return tuple(self._checkpoint_from_row(row) for row in rows)

    def record_failure(
        self,
        run_id: str,
        *,
        stage: str,
        input_fingerprint: str,
        category: ErrorCategory,
        message: str,
        attempt: int,
        max_attempts: int,
        status: WorkflowStatus,
    ) -> StageCheckpoint:
        if status not in {
            WorkflowStatus.RETRY_WAIT,
            WorkflowStatus.NEEDS_INPUT,
            WorkflowStatus.BLOCKED,
            WorkflowStatus.FAILED,
        }:
            raise ValueError(f"Unsupported failure status {status.value}")
        checkpoint_status = (
            CheckpointStatus.RETRY_WAIT
            if status is WorkflowStatus.RETRY_WAIT
            else CheckpointStatus.FAILED
        )
        event_type = {
            WorkflowStatus.RETRY_WAIT: "WorkflowRetryScheduled",
            WorkflowStatus.NEEDS_INPUT: "WorkflowNeedsInput",
            WorkflowStatus.BLOCKED: "WorkflowBlocked",
            WorkflowStatus.FAILED: "WorkflowFailed",
        }[status]
        with self._lock, self._transaction():
            row = self._run_row(run_id)
            timestamp = self.clock().isoformat()
            self._connection.execute(
                """
                INSERT INTO workflow_checkpoints (
                    run_id, stage, input_fingerprint, status, attempt,
                    output_refs_json, error_category, error_message,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id, stage, input_fingerprint) DO UPDATE SET
                    status = excluded.status,
                    attempt = excluded.attempt,
                    error_category = excluded.error_category,
                    error_message = excluded.error_message,
                    updated_at = excluded.updated_at
                """,
                (
                    run_id,
                    stage,
                    input_fingerprint,
                    checkpoint_status.value,
                    attempt,
                    "[]",
                    category.value,
                    message,
                    timestamp,
                    timestamp,
                ),
            )
            self._connection.execute(
                """
                UPDATE workflow_runs
                SET status = ?, current_stage = ?, error_category = ?,
                    error_message = ?, attempt = ?, max_attempts = ?,
                    pause_reason = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    status.value,
                    stage,
                    category.value,
                    message,
                    attempt,
                    max_attempts,
                    message if status is WorkflowStatus.NEEDS_INPUT else None,
                    timestamp,
                    run_id,
                ),
            )
            self._append_event(
                run_id,
                str(row["project_id"]),
                event_type,
                stage,
                message,
                {
                    "category": category.value,
                    "attempt": attempt,
                    "max_attempts": max_attempts,
                },
            )
        checkpoint = self.get_checkpoint(run_id, stage, input_fingerprint)
        assert checkpoint
        return checkpoint

    def _migrate(self) -> None:
        with self._lock:
            self._connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS workflow_schema (
                    version INTEGER NOT NULL
                );
                INSERT INTO workflow_schema(version)
                SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM workflow_schema);

                CREATE TABLE IF NOT EXISTS workflow_runs (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    workflow_kind TEXT NOT NULL,
                    input_revision INTEGER NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    status TEXT NOT NULL,
                    current_stage TEXT NOT NULL,
                    completed_stages_json TEXT NOT NULL,
                    side_effect_keys_json TEXT NOT NULL,
                    pause_reason TEXT,
                    error_category TEXT,
                    error_message TEXT,
                    attempt INTEGER NOT NULL,
                    max_attempts INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(project_id, workflow_kind, input_revision, idempotency_key)
                );

                CREATE INDEX IF NOT EXISTS idx_workflow_runs_project
                ON workflow_runs(project_id, created_at);

                CREATE TABLE IF NOT EXISTS workflow_events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    id TEXT NOT NULL UNIQUE,
                    run_id TEXT NOT NULL REFERENCES workflow_runs(id),
                    project_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    message TEXT NOT NULL,
                    details_json TEXT NOT NULL,
                    occurred_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_workflow_events_run
                ON workflow_events(run_id, sequence);

                CREATE TABLE IF NOT EXISTS workflow_checkpoints (
                    run_id TEXT NOT NULL REFERENCES workflow_runs(id),
                    stage TEXT NOT NULL,
                    input_fingerprint TEXT NOT NULL,
                    status TEXT NOT NULL,
                    attempt INTEGER NOT NULL,
                    output_refs_json TEXT NOT NULL,
                    error_category TEXT,
                    error_message TEXT,
                    side_effect_key TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT,
                    PRIMARY KEY(run_id, stage, input_fingerprint)
                );
                """
            )

    def _append_event(
        self,
        run_id: str,
        project_id: str,
        event_type: str,
        stage: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        local_number = int(
            self._connection.execute(
                "SELECT COUNT(*) FROM workflow_events WHERE run_id = ?", (run_id,)
            ).fetchone()[0]
        )
        timestamp = self.clock().isoformat()
        event_id = stable_id(
            "workflow-event",
            run_id,
            local_number + 1,
            event_type,
            stage,
            message,
        )
        self._connection.execute(
            """
            INSERT INTO workflow_events (
                id, run_id, project_id, event_type, stage,
                message, details_json, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                run_id,
                project_id,
                event_type,
                stage,
                message,
                canonical_json(dict(details or {})),
                timestamp,
            ),
        )

    def _run_row(self, run_id: str) -> sqlite3.Row:
        row = self._connection.execute(
            "SELECT * FROM workflow_runs WHERE id = ?", (run_id,)
        ).fetchone()
        if not row:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Workflow run does not exist",
                details={"workflow_run_id": run_id},
            )
        return row

    def _run_from_row(self, row: sqlite3.Row, *, after_event: int = 0) -> WorkflowRun:
        events = tuple(
            self._event_from_row(event)
            for event in self._connection.execute(
                """
                SELECT * FROM workflow_events
                WHERE run_id = ? AND sequence > ?
                ORDER BY sequence
                """,
                (str(row["id"]), after_event),
            ).fetchall()
        )
        category = row["error_category"]
        return WorkflowRun(
            id=str(row["id"]),
            project_id=str(row["project_id"]),
            workflow_kind=str(row["workflow_kind"]),
            input_revision=int(row["input_revision"]),
            idempotency_key=str(row["idempotency_key"]),
            status=WorkflowStatus(str(row["status"])),
            current_stage=str(row["current_stage"]),
            completed_stages=tuple(json.loads(str(row["completed_stages_json"]))),
            side_effect_keys=tuple(json.loads(str(row["side_effect_keys_json"]))),
            events=events,
            pause_reason=row["pause_reason"],
            error_category=ErrorCategory(str(category)) if category else None,
            error_message=row["error_message"],
            attempt=int(row["attempt"]),
            max_attempts=int(row["max_attempts"]),
        )

    @staticmethod
    def _event_from_row(row: sqlite3.Row) -> WorkflowProgressEvent:
        return WorkflowProgressEvent(
            sequence=int(row["sequence"]),
            event_type=str(row["event_type"]),
            stage=str(row["stage"]),
            message=str(row["message"]),
            id=str(row["id"]),
            project_id=str(row["project_id"]),
            occurred_at=datetime.fromisoformat(str(row["occurred_at"])),
            details=json.loads(str(row["details_json"])),
        )

    def _checkpoint_row(
        self, run_id: str, stage: str, input_fingerprint: str
    ) -> sqlite3.Row | None:
        return self._connection.execute(
            """
            SELECT * FROM workflow_checkpoints
            WHERE run_id = ? AND stage = ? AND input_fingerprint = ?
            """,
            (run_id, stage, input_fingerprint),
        ).fetchone()

    @staticmethod
    def _checkpoint_from_row(row: sqlite3.Row) -> StageCheckpoint:
        category = row["error_category"]
        return StageCheckpoint(
            run_id=str(row["run_id"]),
            stage=str(row["stage"]),
            input_fingerprint=str(row["input_fingerprint"]),
            status=CheckpointStatus(str(row["status"])),
            attempt=int(row["attempt"]),
            output_refs=tuple(json.loads(str(row["output_refs_json"]))),
            error_category=ErrorCategory(str(category)) if category else None,
            error_message=row["error_message"],
            side_effect_key=row["side_effect_key"],
        )

    class _Transaction:
        def __init__(self, connection: sqlite3.Connection) -> None:
            self.connection = connection

        def __enter__(self) -> None:
            self.connection.execute("BEGIN IMMEDIATE")

        def __exit__(self, exc_type, exc, traceback) -> None:
            if exc_type is None:
                self.connection.execute("COMMIT")
            else:
                self.connection.execute("ROLLBACK")

    def _transaction(self) -> _Transaction:
        return self._Transaction(self._connection)


@dataclass(frozen=True, slots=True)
class InjectedFailure:
    category: ErrorCategory
    message: str
    remaining: int
    timeout: bool = False


class WorkflowStageError(Exception):
    def __init__(
        self, category: ErrorCategory, message: str, *, timeout: bool = False
    ) -> None:
        super().__init__(message)
        self.category = category
        self.timeout = timeout


class FailureInjector:
    def __init__(self) -> None:
        self._rules: dict[str, InjectedFailure] = {}

    def inject(
        self,
        stage: str,
        category: ErrorCategory,
        *,
        times: int = 1,
        message: str | None = None,
        timeout: bool = False,
    ) -> None:
        self._rules[stage] = InjectedFailure(
            category,
            message or f"Injected {category.value.lower()} at {stage}",
            times,
            timeout,
        )

    def inject_timeout(self, stage: str, *, times: int = 1) -> None:
        self.inject(
            stage,
            ErrorCategory.RETRYABLE,
            times=times,
            message=f"Injected timeout at {stage}",
            timeout=True,
        )

    def maybe_raise(self, stage: str) -> None:
        rule = self._rules.get(stage)
        if not rule or rule.remaining <= 0:
            return
        self._rules[stage] = InjectedFailure(
            rule.category,
            rule.message,
            rule.remaining - 1,
            rule.timeout,
        )
        raise WorkflowStageError(rule.category, rule.message, timeout=rule.timeout)


@dataclass(frozen=True, slots=True)
class StageExecution:
    run: WorkflowRun
    checkpoint: StageCheckpoint
    reused: bool


class RecoverableStageRunner:
    def __init__(
        self,
        runtime: SQLiteWorkflowRuntime,
        *,
        injector: FailureInjector | None = None,
    ) -> None:
        self.runtime = runtime
        self.injector = injector or FailureInjector()

    def run_stage(
        self,
        run_id: str,
        stage: str,
        input_value: object,
        operation: Callable[[], tuple[str, ...]],
        *,
        max_attempts: int = 3,
        side_effect_key: str | None = None,
    ) -> StageExecution:
        fingerprint = stable_id("stage-input", input_value)
        checkpoint = self.runtime.get_checkpoint(run_id, stage, fingerprint)
        if checkpoint and checkpoint.status is CheckpointStatus.COMPLETED:
            return StageExecution(self.runtime.query(run_id)[0], checkpoint, True)

        for attempt in range(1, max_attempts + 1):
            run = self.runtime.query(run_id)[0]
            if run.status in {
                WorkflowStatus.PAUSED,
                WorkflowStatus.NEEDS_INPUT,
                WorkflowStatus.RETRY_WAIT,
            }:
                self.runtime.resume(run_id)
            try:
                self.injector.maybe_raise(stage)
                output_refs = operation()
            except WorkflowStageError as exc:
                status = self._failure_status(
                    exc.category, attempt=attempt, max_attempts=max_attempts
                )
                checkpoint = self.runtime.record_failure(
                    run_id,
                    stage=stage,
                    input_fingerprint=fingerprint,
                    category=exc.category,
                    message=str(exc),
                    attempt=attempt,
                    max_attempts=max_attempts,
                    status=status,
                )
                if status is WorkflowStatus.RETRY_WAIT:
                    continue
                return StageExecution(self.runtime.query(run_id)[0], checkpoint, False)
            checkpoint = self.runtime.checkpoint(
                run_id,
                stage=stage,
                input_fingerprint=fingerprint,
                output_refs=output_refs,
                side_effect_key=side_effect_key,
            )
            return StageExecution(self.runtime.query(run_id)[0], checkpoint, False)

        raise AssertionError("retry loop exited without a result")

    @staticmethod
    def _failure_status(
        category: ErrorCategory, *, attempt: int, max_attempts: int
    ) -> WorkflowStatus:
        if category is ErrorCategory.RETRYABLE:
            return (
                WorkflowStatus.RETRY_WAIT
                if attempt < max_attempts
                else WorkflowStatus.FAILED
            )
        if category is ErrorCategory.NEEDS_INPUT:
            return WorkflowStatus.NEEDS_INPUT
        if category in {
            ErrorCategory.POLICY_BLOCKED,
            ErrorCategory.CAPABILITY_UNAVAILABLE,
        }:
            return WorkflowStatus.BLOCKED
        return WorkflowStatus.FAILED
