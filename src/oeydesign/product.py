"""Durable product-facing messages, jobs, file sets, and provider settings."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import time
from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Any

from .domain import ContractError, ErrorCategory, canonical_json, stable_id, utc_now
from .persistence import SQLiteStore


class ProductMessageRole(StrEnum):
    USER = "USER"
    ASSISTANT = "ASSISTANT"


class AgentJobStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


@dataclass(frozen=True, slots=True)
class ProductMessage:
    id: str
    project_id: str
    role: ProductMessageRole
    text: str
    client_message_id: str | None
    run_id: str | None
    target_id: str | None = None
    target_revision: int | None = None
    object_ref: str | None = None
    created_at: str = field(default_factory=lambda: utc_now().isoformat())


@dataclass(frozen=True, slots=True)
class AgentJob:
    id: str
    project_id: str
    kind: str
    idempotency_key: str
    status: AgentJobStatus
    stage: str
    input: Mapping[str, Any]
    created_at: str
    updated_at: str
    sequence: int
    steps: int = 0
    total_tokens: int = 0
    renders: int = 0
    elapsed_seconds: float = 0.0
    result: Mapping[str, Any] = field(default_factory=dict)
    error_category: str | None = None
    error_message: str | None = None
    cancel_requested: bool = False
    pause_requested: bool = False


@dataclass(frozen=True, slots=True)
class ArtifactFileSet:
    id: str
    project_id: str
    owner_kind: str
    owner_id: str
    owner_revision: int
    source_tree_sha256: str
    dist_tree_sha256: str
    storage_ref: str
    source_files: Mapping[str, str]
    dist_files: Mapping[str, str]
    metadata: Mapping[str, Any]
    created_at: str


@dataclass(frozen=True, slots=True)
class ProviderSettings:
    provider: str = "kimi"
    base_url: str = ""
    model: str = ""
    credential_configured: bool = False


@dataclass(frozen=True, slots=True)
class ProductReadiness:
    ready: bool
    blockers: tuple[str, ...]
    capabilities: Mapping[str, str]
    provider: ProviderSettings


class ProductStore:
    """Additive schema sharing the application's SQLite connection."""

    def __init__(self, store: SQLiteStore) -> None:
        self.store = store
        self._request_lock = threading.Lock()
        with store._lock:
            store.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS product_messages (
                    message_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    client_message_id TEXT,
                    created_at TEXT NOT NULL,
                    snapshot TEXT NOT NULL,
                    UNIQUE(project_id, client_message_id)
                );
                CREATE INDEX IF NOT EXISTS idx_product_messages_project
                    ON product_messages(project_id, created_at, message_id);
                CREATE TABLE IF NOT EXISTS agent_jobs (
                    job_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL,
                    sequence INTEGER NOT NULL UNIQUE,
                    updated_at TEXT NOT NULL,
                    snapshot TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_agent_jobs_status
                    ON agent_jobs(status, sequence);
                CREATE TABLE IF NOT EXISTS artifact_file_sets (
                    file_set_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    owner_kind TEXT NOT NULL,
                    owner_id TEXT NOT NULL,
                    owner_revision INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    snapshot TEXT NOT NULL,
                    UNIQUE(owner_kind, owner_id, owner_revision)
                );
                CREATE INDEX IF NOT EXISTS idx_file_sets_project
                    ON artifact_file_sets(project_id, created_at);
                CREATE TABLE IF NOT EXISTS provider_settings (
                    provider TEXT PRIMARY KEY,
                    base_url TEXT NOT NULL,
                    model TEXT NOT NULL,
                    credential_configured INTEGER NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS product_requests (
                    request_key TEXT PRIMARY KEY,
                    fingerprint TEXT NOT NULL,
                    result_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )
            store.connection.commit()
        self.pause_interrupted_jobs()

    def run_idempotent(
        self,
        *,
        request_key: str,
        fingerprint: str,
        operation: Callable[[], str],
    ) -> str:
        _label(request_key, "request key")
        _label(fingerprint, "request fingerprint")
        with self._request_lock:
            with self.store._lock:
                row = self.store.connection.execute(
                    "SELECT fingerprint, result_id FROM product_requests "
                    "WHERE request_key = ?",
                    (request_key,),
                ).fetchone()
            if row is not None:
                if str(row["fingerprint"]) != fingerprint:
                    raise ContractError(
                        ErrorCategory.DETERMINISTIC_FAILURE,
                        "Idempotency key was reused with a different request",
                    )
                return str(row["result_id"])
            result_id = operation()
            _label(result_id, "idempotent result")
            with self.store.transaction() as conn:
                conn.execute(
                    "INSERT INTO product_requests VALUES (?, ?, ?, ?)",
                    (request_key, fingerprint, result_id, utc_now().isoformat()),
                )
            return result_id

    def add_message(self, message: ProductMessage) -> ProductMessage:
        _message(message)
        payload = canonical_json(_message_document(message))
        with self.store.transaction() as conn:
            if message.client_message_id:
                row = conn.execute(
                    "SELECT snapshot FROM product_messages "
                    "WHERE project_id = ? AND client_message_id = ?",
                    (message.project_id, message.client_message_id),
                ).fetchone()
                if row is not None:
                    return _message_from_document(json.loads(row["snapshot"]))
            conn.execute(
                "INSERT INTO product_messages VALUES (?, ?, ?, ?, ?)",
                (
                    message.id,
                    message.project_id,
                    message.client_message_id,
                    message.created_at,
                    payload,
                ),
            )
        return message

    def message_job(self, project_id: str, client_message_id: str) -> AgentJob | None:
        """Return the job a client message was durably associated with, if any."""

        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT snapshot FROM product_messages "
                "WHERE project_id = ? AND client_message_id = ?",
                (project_id, client_message_id),
            ).fetchone()
            if row is None:
                return None
            message = _message_from_document(json.loads(row["snapshot"]))
            if not message.run_id:
                return None
            job = self.store.connection.execute(
                "SELECT snapshot FROM agent_jobs WHERE job_id = ?",
                (message.run_id,),
            ).fetchone()
        return None if job is None else _job_from_document(json.loads(job["snapshot"]))

    def add_message_for_existing_job(
        self, message: ProductMessage, job_id: str
    ) -> tuple[ProductMessage, AgentJob]:
        """Atomically bind a clarification message to its resumed intake job."""

        _message(message)
        with self.store.transaction() as conn:
            job_row = conn.execute(
                "SELECT snapshot FROM agent_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if job_row is None:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE, "Job not found"
                )
            job = _job_from_document(json.loads(job_row["snapshot"]))
            existing = conn.execute(
                "SELECT snapshot FROM product_messages "
                "WHERE project_id = ? AND client_message_id = ?",
                (message.project_id, message.client_message_id),
            ).fetchone()
            if existing is not None:
                saved = _message_from_document(json.loads(existing["snapshot"]))
                if _message_request_fingerprint(saved) != _message_request_fingerprint(
                    message
                ):
                    raise ContractError(
                        ErrorCategory.DETERMINISTIC_FAILURE,
                        "client_message_id was reused with different feedback",
                    )
                return saved, job
            bound = ProductMessage(
                message.id,
                message.project_id,
                message.role,
                message.text,
                message.client_message_id,
                job.id,
                message.target_id,
                message.target_revision,
                message.object_ref,
                message.created_at,
            )
            conn.execute(
                "INSERT INTO product_messages VALUES (?, ?, ?, ?, ?)",
                (
                    bound.id,
                    bound.project_id,
                    bound.client_message_id,
                    bound.created_at,
                    canonical_json(_message_document(bound)),
                ),
            )
        return bound, job

    def add_message_and_create_job(
        self,
        message: ProductMessage,
        *,
        kind: str,
        idempotency_key: str,
        input: Mapping[str, Any],
    ) -> tuple[ProductMessage, AgentJob]:
        """Atomically persist a user message and reserve its one Agent job."""

        _message(message)
        _label(kind, "job kind")
        _label(idempotency_key, "idempotency key")
        now = utc_now().isoformat()
        with self.store.transaction() as conn:
            existing_job_row = conn.execute(
                "SELECT snapshot FROM agent_jobs WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing_job_row is not None:
                existing_job = _job_from_document(
                    json.loads(existing_job_row["snapshot"])
                )
                existing_message_row = conn.execute(
                    "SELECT snapshot FROM product_messages "
                    "WHERE project_id = ? AND client_message_id = ?",
                    (message.project_id, message.client_message_id),
                ).fetchone()
                if existing_message_row is None:
                    raise ContractError(
                        ErrorCategory.DETERMINISTIC_FAILURE,
                        "Idempotent Agent job has no matching product message",
                    )
                existing_message = _message_from_document(
                    json.loads(existing_message_row["snapshot"])
                )
                if _message_request_fingerprint(
                    existing_message
                ) != _message_request_fingerprint(message):
                    raise ContractError(
                        ErrorCategory.DETERMINISTIC_FAILURE,
                        "client_message_id was reused with different feedback",
                    )
                return existing_message, existing_job
            active = conn.execute(
                "SELECT 1 FROM agent_jobs WHERE project_id = ? "
                "AND status IN (?, ?, ?) LIMIT 1",
                (
                    message.project_id,
                    AgentJobStatus.RUNNING.value,
                    AgentJobStatus.QUEUED.value,
                    AgentJobStatus.PAUSED.value,
                ),
            ).fetchone()
            if active is not None:
                raise ContractError(
                    ErrorCategory.INVALID_TRANSITION,
                    "Project already has an active Agent job",
                )
            existing_message_row = None
            if message.client_message_id:
                existing_message_row = conn.execute(
                    "SELECT snapshot FROM product_messages "
                    "WHERE project_id = ? AND client_message_id = ?",
                    (message.project_id, message.client_message_id),
                ).fetchone()
            saved = (
                message
                if existing_message_row is None
                else _message_from_document(
                    json.loads(existing_message_row["snapshot"])
                )
            )
            if _message_request_fingerprint(saved) != _message_request_fingerprint(
                message
            ):
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "client_message_id was reused with different feedback",
                )
            sequence = int(
                conn.execute(
                    "SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM agent_jobs"
                ).fetchone()["value"]
            )
            job_id = stable_id("job", message.project_id, kind, idempotency_key)
            bound = ProductMessage(
                saved.id,
                saved.project_id,
                saved.role,
                saved.text,
                saved.client_message_id,
                job_id,
                saved.target_id,
                saved.target_revision,
                saved.object_ref,
                saved.created_at,
            )
            if existing_message_row is None:
                conn.execute(
                    "INSERT INTO product_messages VALUES (?, ?, ?, ?, ?)",
                    (
                        bound.id,
                        bound.project_id,
                        bound.client_message_id,
                        bound.created_at,
                        canonical_json(_message_document(bound)),
                    ),
                )
            else:
                conn.execute(
                    "UPDATE product_messages SET snapshot = ? WHERE message_id = ?",
                    (canonical_json(_message_document(bound)), bound.id),
                )
            job_input = dict(input)
            if "message_id" in job_input:
                job_input["message_id"] = bound.id
            job = AgentJob(
                job_id,
                message.project_id,
                kind,
                idempotency_key,
                AgentJobStatus.QUEUED,
                "queued",
                MappingProxyType(job_input),
                now,
                now,
                sequence,
            )
            conn.execute(
                "INSERT INTO agent_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    job.id,
                    job.project_id,
                    job.kind,
                    job.idempotency_key,
                    job.status.value,
                    job.sequence,
                    now,
                    canonical_json(_job_document(job)),
                ),
            )
        return bound, job

    def list_messages(self, project_id: str) -> tuple[ProductMessage, ...]:
        with self.store._lock:
            rows = self.store.connection.execute(
                "SELECT snapshot FROM product_messages WHERE project_id = ? "
                "ORDER BY created_at, message_id",
                (project_id,),
            ).fetchall()
        return tuple(
            _message_from_document(json.loads(row["snapshot"])) for row in rows
        )

    def create_job(
        self,
        *,
        project_id: str,
        kind: str,
        idempotency_key: str,
        input: Mapping[str, Any],
    ) -> AgentJob:
        _label(project_id, "project_id")
        _label(kind, "job kind")
        _label(idempotency_key, "idempotency key")
        now = utc_now().isoformat()
        with self.store.transaction() as conn:
            existing = conn.execute(
                "SELECT snapshot FROM agent_jobs WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing is not None:
                return _job_from_document(json.loads(existing["snapshot"]))
            sequence = int(
                conn.execute(
                    "SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM agent_jobs"
                ).fetchone()["value"]
            )
            job = AgentJob(
                stable_id("job", project_id, kind, idempotency_key),
                project_id,
                kind,
                idempotency_key,
                AgentJobStatus.QUEUED,
                "queued",
                MappingProxyType(dict(input)),
                now,
                now,
                sequence,
            )
            conn.execute(
                "INSERT INTO agent_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    job.id,
                    project_id,
                    kind,
                    idempotency_key,
                    job.status.value,
                    sequence,
                    now,
                    canonical_json(_job_document(job)),
                ),
            )
        return job

    def get_job(self, job_id: str) -> AgentJob:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT snapshot FROM agent_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
        if row is None:
            raise ContractError(ErrorCategory.DETERMINISTIC_FAILURE, "Job not found")
        return _job_from_document(json.loads(row["snapshot"]))

    def next_queued(self) -> AgentJob | None:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT snapshot FROM agent_jobs WHERE status = ? "
                "ORDER BY sequence LIMIT 1",
                (AgentJobStatus.QUEUED.value,),
            ).fetchone()
        return None if row is None else _job_from_document(json.loads(row["snapshot"]))

    def claim_next_queued(
        self, *, supported_kinds: Collection[str] | None = None
    ) -> AgentJob | None:
        """Atomically transition the first runnable FIFO job to ``RUNNING``.

        Reading a queued row and updating it in separate transactions permits two
        application processes to execute the same job.  The selection and state
        compare-and-swap deliberately share one ``BEGIN IMMEDIATE`` transaction
        so SQLite serializes competing local workers.
        """

        kinds = tuple(sorted(set(supported_kinds or ())))
        if supported_kinds is not None and not kinds:
            return None
        with self.store.transaction() as conn:
            running = conn.execute(
                "SELECT 1 FROM agent_jobs WHERE status = ? LIMIT 1",
                (AgentJobStatus.RUNNING.value,),
            ).fetchone()
            if running is not None:
                return None
            clauses = ["status = ?"]
            parameters: list[Any] = [AgentJobStatus.QUEUED.value]
            if kinds:
                clauses.append("kind IN (" + ", ".join("?" for _ in kinds) + ")")
                parameters.extend(kinds)
            row = conn.execute(
                "SELECT snapshot FROM agent_jobs WHERE "
                + " AND ".join(clauses)
                + " ORDER BY sequence LIMIT 1",
                tuple(parameters),
            ).fetchone()
            if row is None:
                return None
            queued = _job_from_document(json.loads(row["snapshot"]))
            running = _job_replace(
                queued,
                status=AgentJobStatus.RUNNING,
                stage="starting",
                pause_requested=False,
                cancel_requested=False,
            )
            claimed = conn.execute(
                "UPDATE agent_jobs SET status = ?, updated_at = ?, snapshot = ? "
                "WHERE job_id = ? AND status = ?",
                (
                    running.status.value,
                    running.updated_at,
                    canonical_json(_job_document(running)),
                    running.id,
                    AgentJobStatus.QUEUED.value,
                ),
            )
            if claimed.rowcount != 1:
                return None
            return running

    def list_jobs(self, project_id: str) -> tuple[AgentJob, ...]:
        with self.store._lock:
            rows = self.store.connection.execute(
                "SELECT snapshot FROM agent_jobs WHERE project_id = ? "
                "ORDER BY sequence",
                (project_id,),
            ).fetchall()
        return tuple(_job_from_document(json.loads(row["snapshot"])) for row in rows)

    def update_job(self, job: AgentJob) -> AgentJob:
        with self.store.transaction() as conn:
            row = conn.execute(
                "SELECT snapshot FROM agent_jobs WHERE job_id = ?", (job.id,)
            ).fetchone()
            if row is None:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE, "Job not found"
                )
            current = _job_from_document(json.loads(row["snapshot"]))
            if current.project_id != job.project_id or current.sequence != job.sequence:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE, "Job identity changed"
                )
            terminal = {
                AgentJobStatus.COMPLETED,
                AgentJobStatus.FAILED,
                AgentJobStatus.CANCELED,
            }
            requested = job
            if current.status in terminal and job.status is not current.status:
                return current
            if (
                current.status is AgentJobStatus.PAUSED
                and job.status is AgentJobStatus.RUNNING
            ):
                return current
            if current.status is AgentJobStatus.RUNNING:
                if job.status is AgentJobStatus.PAUSED:
                    requested = _job_replace(current, pause_requested=True)
                elif job.status is AgentJobStatus.CANCELED:
                    requested = _job_replace(current, cancel_requested=True)
                elif job.status is AgentJobStatus.RUNNING:
                    requested = _job_replace(
                        job,
                        pause_requested=(
                            current.pause_requested or job.pause_requested
                        ),
                        cancel_requested=(
                            current.cancel_requested or job.cancel_requested
                        ),
                    )
            updated = AgentJob(
                requested.id,
                requested.project_id,
                requested.kind,
                requested.idempotency_key,
                requested.status,
                requested.stage,
                MappingProxyType(dict(requested.input)),
                requested.created_at,
                utc_now().isoformat(),
                requested.sequence,
                requested.steps,
                requested.total_tokens,
                requested.renders,
                requested.elapsed_seconds,
                MappingProxyType(dict(requested.result)),
                requested.error_category,
                requested.error_message,
                requested.cancel_requested,
                requested.pause_requested,
            )
            conn.execute(
                "UPDATE agent_jobs SET status = ?, updated_at = ?, snapshot = ? "
                "WHERE job_id = ?",
                (
                    updated.status.value,
                    updated.updated_at,
                    canonical_json(_job_document(updated)),
                    updated.id,
                ),
            )
        return updated

    def settle_running_job(
        self,
        job_id: str,
        *,
        status: AgentJobStatus,
        stage: str,
        elapsed_increment: float,
        result: Mapping[str, Any] | None = None,
        error_category: str | None = None,
        error_message: str | None = None,
    ) -> AgentJob:
        """Atomically settle a running job without overwriting late controls."""

        with self.store.transaction() as conn:
            row = conn.execute(
                "SELECT snapshot FROM agent_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if row is None:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE, "Job not found"
                )
            current = _job_from_document(json.loads(row["snapshot"]))
            if current.status is not AgentJobStatus.RUNNING:
                return current
            resolved_status = status
            resolved_stage = stage
            if current.cancel_requested:
                resolved_status = AgentJobStatus.CANCELED
                resolved_stage = "canceled"
            elif current.pause_requested:
                resolved_status = AgentJobStatus.PAUSED
                resolved_stage = "paused"
            settled = _job_replace(
                current,
                status=resolved_status,
                stage=resolved_stage,
                elapsed_seconds=current.elapsed_seconds + max(0.0, elapsed_increment),
                result=MappingProxyType(dict(result or {})),
                error_category=(
                    error_category if resolved_status is AgentJobStatus.FAILED else None
                ),
                error_message=(
                    error_message if resolved_status is AgentJobStatus.FAILED else None
                ),
                pause_requested=False,
                cancel_requested=resolved_status is AgentJobStatus.CANCELED,
            )
            conn.execute(
                "UPDATE agent_jobs SET status = ?, updated_at = ?, snapshot = ? "
                "WHERE job_id = ? AND status = ?",
                (
                    settled.status.value,
                    settled.updated_at,
                    canonical_json(_job_document(settled)),
                    settled.id,
                    AgentJobStatus.RUNNING.value,
                ),
            )
            return settled

    def project_has_active_job(self, project_id: str, *, except_id: str = "") -> bool:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT 1 FROM agent_jobs WHERE project_id = ? AND job_id != ? "
                "AND status IN (?, ?, ?) LIMIT 1",
                (
                    project_id,
                    except_id,
                    AgentJobStatus.RUNNING.value,
                    AgentJobStatus.QUEUED.value,
                    AgentJobStatus.PAUSED.value,
                ),
            ).fetchone()
        return row is not None

    def pause_interrupted_jobs(self) -> None:
        with self.store.transaction() as conn:
            rows = conn.execute(
                "SELECT snapshot FROM agent_jobs WHERE status = ?",
                (AgentJobStatus.RUNNING.value,),
            ).fetchall()
            for row in rows:
                job = _job_from_document(json.loads(row["snapshot"]))
                paused = _job_replace(
                    job,
                    status=AgentJobStatus.PAUSED,
                    stage="interrupted",
                    pause_requested=False,
                )
                conn.execute(
                    "UPDATE agent_jobs SET status = ?, updated_at = ?, snapshot = ? "
                    "WHERE job_id = ?",
                    (
                        paused.status.value,
                        paused.updated_at,
                        canonical_json(_job_document(paused)),
                        paused.id,
                    ),
                )

    def request_pause_running_jobs(self) -> tuple[AgentJob, ...]:
        """Request cooperative pauses without claiming that a running tool stopped.

        A provider call can be in flight when the desktop process begins its
        shutdown.  We persist the pause request first; the worker observes it at
        its next tool boundary and records the durable ``PAUSED`` terminal state.
        """

        paused: list[AgentJob] = []
        with self.store.transaction() as conn:
            rows = conn.execute(
                "SELECT snapshot FROM agent_jobs WHERE status = ?",
                (AgentJobStatus.RUNNING.value,),
            ).fetchall()
            for row in rows:
                job = _job_from_document(json.loads(row["snapshot"]))
                requested = _job_replace(job, pause_requested=True)
                conn.execute(
                    "UPDATE agent_jobs SET updated_at = ?, snapshot = ? "
                    "WHERE job_id = ? AND status = ?",
                    (
                        requested.updated_at,
                        canonical_json(_job_document(requested)),
                        requested.id,
                        AgentJobStatus.RUNNING.value,
                    ),
                )
                paused.append(requested)
        return tuple(paused)

    def save_provider_settings(self, settings: ProviderSettings) -> None:
        if settings.provider != "kimi":
            raise ValueError("Only the Kimi provider is supported in the Web MVP")
        if len(settings.base_url) > 2_048 or len(settings.model) > 200:
            raise ValueError("Provider setting is too long")
        now = utc_now().isoformat()
        with self.store.transaction() as conn:
            conn.execute(
                "INSERT INTO provider_settings VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(provider) DO UPDATE SET base_url = excluded.base_url, "
                "model = excluded.model, credential_configured = "
                "excluded.credential_configured, updated_at = excluded.updated_at",
                (
                    settings.provider,
                    settings.base_url,
                    settings.model,
                    int(settings.credential_configured),
                    now,
                ),
            )

    def provider_settings(self) -> ProviderSettings:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT provider, base_url, model, credential_configured "
                "FROM provider_settings WHERE provider = 'kimi'"
            ).fetchone()
        if row is None:
            return ProviderSettings()
        return ProviderSettings(
            str(row["provider"]),
            str(row["base_url"]),
            str(row["model"]),
            bool(row["credential_configured"]),
        )

    def add_file_set(self, file_set: ArtifactFileSet) -> ArtifactFileSet:
        with self.store.transaction() as conn:
            existing = conn.execute(
                "SELECT snapshot FROM artifact_file_sets WHERE owner_kind = ? "
                "AND owner_id = ? AND owner_revision = ?",
                (
                    file_set.owner_kind,
                    file_set.owner_id,
                    file_set.owner_revision,
                ),
            ).fetchone()
            if existing is not None:
                current = _file_set_from_document(json.loads(existing["snapshot"]))
                current_body = _file_set_document(current)
                requested_body = _file_set_document(file_set)
                current_body.pop("created_at", None)
                requested_body.pop("created_at", None)
                if current_body != requested_body:
                    raise ContractError(
                        ErrorCategory.DETERMINISTIC_FAILURE,
                        "Artifact revision already has a different file set",
                    )
                return current
            conn.execute(
                "INSERT INTO artifact_file_sets VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    file_set.id,
                    file_set.project_id,
                    file_set.owner_kind,
                    file_set.owner_id,
                    file_set.owner_revision,
                    file_set.created_at,
                    canonical_json(_file_set_document(file_set)),
                ),
            )
        return file_set

    def get_file_set(self, file_set_id: str) -> ArtifactFileSet:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT snapshot FROM artifact_file_sets WHERE file_set_id = ?",
                (file_set_id,),
            ).fetchone()
        if row is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE, "File set not found"
            )
        return _file_set_from_document(json.loads(row["snapshot"]))

    def file_set_for(
        self, owner_kind: str, owner_id: str, owner_revision: int
    ) -> ArtifactFileSet | None:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT snapshot FROM artifact_file_sets WHERE owner_kind = ? "
                "AND owner_id = ? AND owner_revision = ?",
                (owner_kind, owner_id, owner_revision),
            ).fetchone()
        return (
            None
            if row is None
            else _file_set_from_document(json.loads(row["snapshot"]))
        )


class JobControl:
    def __init__(self, store: ProductStore, job_id: str) -> None:
        self.store = store
        self.job_id = job_id

    def checkpoint(self, stage: str) -> AgentJob:
        job = self.store.get_job(self.job_id)
        if job.cancel_requested:
            raise JobCanceled()
        if job.pause_requested:
            raise JobPaused()
        return self.store.update_job(_job_replace(job, stage=stage))

    def add_usage(
        self, *, steps: int, total_tokens: int, renders: int
    ) -> AgentJob:
        job = self.store.get_job(self.job_id)
        return self.store.update_job(
            _job_replace(
                job,
                steps=job.steps + max(0, steps),
                total_tokens=job.total_tokens + max(0, total_tokens),
                renders=job.renders + max(0, renders),
            )
        )

    def wait_for_input(self) -> None:
        raise JobPaused("needs-input")


class JobCanceled(Exception):
    pass


class JobPaused(Exception):
    def __init__(self, stage: str = "paused") -> None:
        self.stage = stage
        super().__init__(stage)


JobHandler = Callable[[AgentJob, JobControl], Mapping[str, Any]]


class AgentJobRunner:
    """One durable FIFO worker; handlers run outside HTTP request threads."""

    def __init__(self, store: ProductStore) -> None:
        self.store = store
        self._handlers: dict[str, JobHandler] = {}
        self._condition = threading.Condition()
        self._closing = False
        self._thread = threading.Thread(
            target=self._loop, name="oeydesign-agent-worker", daemon=True
        )
        self._thread.start()

    def register(self, kind: str, handler: JobHandler) -> None:
        _label(kind, "job kind")
        self._handlers[kind] = handler
        with self._condition:
            self._condition.notify_all()

    def wake(self) -> None:
        """Wake the FIFO worker after an externally reserved durable job."""

        with self._condition:
            self._condition.notify_all()

    def submit(
        self,
        *,
        project_id: str,
        kind: str,
        idempotency_key: str,
        input: Mapping[str, Any],
    ) -> AgentJob:
        if self.store.project_has_active_job(project_id):
            existing = next(
                (
                    job
                    for job in self.store.list_jobs(project_id)
                    if job.idempotency_key == idempotency_key
                ),
                None,
            )
            if existing is None:
                raise ContractError(
                    ErrorCategory.INVALID_TRANSITION,
                    "Project already has an active Agent job",
                )
            return existing
        job = self.store.create_job(
            project_id=project_id,
            kind=kind,
            idempotency_key=idempotency_key,
            input=input,
        )
        with self._condition:
            self._condition.notify_all()
        return job

    def pause(self, job_id: str) -> AgentJob:
        job = self.store.get_job(job_id)
        if job.status is AgentJobStatus.QUEUED:
            return self.store.update_job(
                _job_replace(job, status=AgentJobStatus.PAUSED, stage="paused")
            )
        if job.status is AgentJobStatus.RUNNING:
            return self.store.update_job(_job_replace(job, pause_requested=True))
        return job

    def resume(self, job_id: str) -> AgentJob:
        job = self.store.get_job(job_id)
        if job.status is not AgentJobStatus.PAUSED:
            return job
        resumed = self.store.update_job(
            _job_replace(
                job,
                status=AgentJobStatus.QUEUED,
                stage="queued",
                pause_requested=False,
            )
        )
        with self._condition:
            self._condition.notify_all()
        return resumed

    def cancel(self, job_id: str) -> AgentJob:
        job = self.store.get_job(job_id)
        if job.status in {
            AgentJobStatus.QUEUED,
            AgentJobStatus.PAUSED,
        }:
            return self.store.update_job(
                _job_replace(
                    job,
                    status=AgentJobStatus.CANCELED,
                    stage="canceled",
                    cancel_requested=True,
                )
            )
        if job.status is AgentJobStatus.RUNNING:
            return self.store.update_job(_job_replace(job, cancel_requested=True))
        return job

    @property
    def is_alive(self) -> bool:
        return self._thread.is_alive()

    def close(self, *, timeout: float = 5.0) -> bool:
        """Begin cooperative shutdown and report whether the worker has stopped.

        Callers must keep the SQLite store open when this returns ``False`` and
        wait for :meth:`wait` before closing it.  This makes a long in-flight
        provider request safe instead of letting its worker access a closed
        connection after an arbitrary five-second timeout.
        """

        self._closing = True
        self.store.request_pause_running_jobs()
        with self._condition:
            self._condition.notify_all()
        if threading.current_thread() is not self._thread:
            self._thread.join(timeout=max(0.0, timeout))
        return not self._thread.is_alive()

    def wait(self, *, timeout: float | None = None) -> bool:
        """Wait for a previously requested shutdown to finish."""

        if threading.current_thread() is self._thread:
            return False
        self._thread.join(timeout=timeout)
        return not self._thread.is_alive()

    def _loop(self) -> None:
        while not self._closing:
            if not self._handlers:
                with self._condition:
                    self._condition.wait(timeout=0.25)
                continue
            running = self.store.claim_next_queued(
                supported_kinds=tuple(self._handlers)
            )
            if running is None:
                with self._condition:
                    self._condition.wait(timeout=0.25)
                continue
            if self._closing:
                # ``close`` may have raced with the claim.  Keep the work
                # durable and resumable instead of entering its handler.
                self.store.update_job(
                    _job_replace(
                        running,
                        status=AgentJobStatus.PAUSED,
                        stage="interrupted",
                    )
                )
                return
            handler = self._handlers.get(running.kind)
            if handler is None:
                # A handler may be unregistered only by a future extension;
                # retain the claimed work as resumable rather than losing it.
                self.store.update_job(
                    _job_replace(
                        running,
                        status=AgentJobStatus.PAUSED,
                        stage="handler-unavailable",
                    )
                )
                continue
            started = time.monotonic()
            control = JobControl(self.store, running.id)
            try:
                control.checkpoint("starting")
                result = handler(running, control)
                # A handler may have returned immediately after an in-flight
                # provider call.  Honor a concurrent pause/cancel before it
                # can be committed as a completed run.
                control.checkpoint("finalizing")
                self.store.settle_running_job(
                    running.id,
                    status=AgentJobStatus.COMPLETED,
                    stage="completed",
                    result=result,
                    elapsed_increment=time.monotonic() - started,
                )
            except JobPaused as exc:
                self.store.settle_running_job(
                    running.id,
                    status=AgentJobStatus.PAUSED,
                    stage=exc.stage,
                    elapsed_increment=time.monotonic() - started,
                )
            except JobCanceled:
                self.store.settle_running_job(
                    running.id,
                    status=AgentJobStatus.CANCELED,
                    stage="canceled",
                    elapsed_increment=time.monotonic() - started,
                )
            except ContractError as exc:
                self.store.settle_running_job(
                    running.id,
                    status=AgentJobStatus.FAILED,
                    stage="failed",
                    elapsed_increment=time.monotonic() - started,
                    error_category=exc.category.value,
                    error_message=str(exc),
                )
            except Exception:
                self.store.settle_running_job(
                    running.id,
                    status=AgentJobStatus.FAILED,
                    stage="failed",
                    elapsed_increment=time.monotonic() - started,
                    error_category=ErrorCategory.DETERMINISTIC_FAILURE.value,
                    error_message="Agent job failed",
                )


class ArtifactFileSetStore:
    """Content-addressed immutable file trees outside SQLite."""

    def __init__(self, data_root: str | Path, repository: ProductStore) -> None:
        self.data_root = Path(data_root).resolve()
        self.root = self.data_root / "product-file-sets"
        self.root.mkdir(parents=True, exist_ok=True)
        self.repository = repository

    def save(
        self,
        *,
        project_id: str,
        owner_kind: str,
        owner_id: str,
        owner_revision: int,
        source: Mapping[str, bytes | str],
        dist: Mapping[str, bytes | str],
        metadata: Mapping[str, Any] | None = None,
    ) -> ArtifactFileSet:
        source_bytes = _normalize_file_mapping(source)
        dist_bytes = _normalize_file_mapping(dist)
        source_hashes = _hashes(source_bytes)
        dist_hashes = _hashes(dist_bytes)
        source_tree = _tree_hash(source_hashes)
        dist_tree = _tree_hash(dist_hashes)
        file_set_id = stable_id(
            "fileset",
            project_id,
            owner_kind,
            owner_id,
            owner_revision,
            source_tree,
            dist_tree,
        )
        relative = Path("product-file-sets") / file_set_id[:2] / file_set_id
        target = (self.data_root / relative).resolve()
        target.relative_to(self.data_root)
        if target.exists():
            _verify_tree(target / "source", source_hashes)
            _verify_tree(target / "dist", dist_hashes)
        else:
            suffix = f".tmp-{os.getpid()}-{time.time_ns()}"
            temporary = target.with_name(target.name + suffix)
            (temporary / "source").mkdir(parents=True)
            (temporary / "dist").mkdir()
            _write_tree(temporary / "source", source_bytes)
            _write_tree(temporary / "dist", dist_bytes)
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.replace(temporary, target)
            except OSError:
                if target.exists():
                    shutil.rmtree(temporary, ignore_errors=True)
                    _verify_tree(target / "source", source_hashes)
                    _verify_tree(target / "dist", dist_hashes)
                else:
                    raise
        record = ArtifactFileSet(
            file_set_id,
            project_id,
            owner_kind,
            owner_id,
            owner_revision,
            source_tree,
            dist_tree,
            relative.as_posix(),
            MappingProxyType(source_hashes),
            MappingProxyType(dist_hashes),
            MappingProxyType(dict(metadata or {})),
            utc_now().isoformat(),
        )
        return self.repository.add_file_set(record)

    def read(self, file_set: ArtifactFileSet, tree: str, relative: str) -> bytes:
        if tree not in {"source", "dist"}:
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "Unknown file-set tree")
        normalized = _safe_relative(relative)
        expected = (
            file_set.source_files if tree == "source" else file_set.dist_files
        ).get(normalized)
        if expected is None:
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "File is not in file set")
        root = (self.data_root / file_set.storage_ref / tree).resolve()
        root.relative_to(self.data_root)
        target = (root / Path(normalized)).resolve()
        target.relative_to(root)
        if target.is_symlink() or not target.is_file():
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED, "File-set member unavailable"
            )
        payload = target.read_bytes()
        if hashlib.sha256(payload).hexdigest() != expected:
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "File-set member changed")
        return payload


def _message(value: ProductMessage) -> None:
    _label(value.id, "message id")
    _label(value.project_id, "project id")
    if not value.text.strip() or len(value.text) > 8_000:
        raise ValueError("Message text is invalid")


def _label(value: str, name: str) -> None:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > 240
        or "\x00" in value
    ):
        raise ValueError(f"{name} is invalid")


def _message_document(value: ProductMessage) -> dict[str, Any]:
    return {
        "id": value.id,
        "project_id": value.project_id,
        "role": value.role.value,
        "text": value.text,
        "client_message_id": value.client_message_id,
        "run_id": value.run_id,
        "target_id": value.target_id,
        "target_revision": value.target_revision,
        "object_ref": value.object_ref,
        "created_at": value.created_at,
    }


def _message_from_document(value: Mapping[str, Any]) -> ProductMessage:
    return ProductMessage(
        str(value["id"]),
        str(value["project_id"]),
        ProductMessageRole(str(value["role"])),
        str(value["text"]),
        value.get("client_message_id"),
        value.get("run_id"),
        value.get("target_id"),
        value.get("target_revision"),
        value.get("object_ref"),
        str(value["created_at"]),
    )


def _message_request_fingerprint(value: ProductMessage) -> str:
    return canonical_json(
        {
            "project_id": value.project_id,
            "role": value.role.value,
            "text": value.text,
            "client_message_id": value.client_message_id,
            "target_id": value.target_id,
            "target_revision": value.target_revision,
            "object_ref": value.object_ref,
        }
    )


def _job_document(value: AgentJob) -> dict[str, Any]:
    return {
        "id": value.id,
        "project_id": value.project_id,
        "kind": value.kind,
        "idempotency_key": value.idempotency_key,
        "status": value.status.value,
        "stage": value.stage,
        "input": dict(value.input),
        "created_at": value.created_at,
        "updated_at": value.updated_at,
        "sequence": value.sequence,
        "steps": value.steps,
        "total_tokens": value.total_tokens,
        "renders": value.renders,
        "elapsed_seconds": value.elapsed_seconds,
        "result": dict(value.result),
        "error_category": value.error_category,
        "error_message": value.error_message,
        "cancel_requested": value.cancel_requested,
        "pause_requested": value.pause_requested,
    }


def _job_from_document(value: Mapping[str, Any]) -> AgentJob:
    return AgentJob(
        str(value["id"]),
        str(value["project_id"]),
        str(value["kind"]),
        str(value["idempotency_key"]),
        AgentJobStatus(str(value["status"])),
        str(value["stage"]),
        MappingProxyType(dict(value.get("input", {}))),
        str(value["created_at"]),
        str(value["updated_at"]),
        int(value["sequence"]),
        int(value.get("steps", 0)),
        int(value.get("total_tokens", 0)),
        int(value.get("renders", 0)),
        float(value.get("elapsed_seconds", 0.0)),
        MappingProxyType(dict(value.get("result", {}))),
        value.get("error_category"),
        value.get("error_message"),
        bool(value.get("cancel_requested", False)),
        bool(value.get("pause_requested", False)),
    )


def _job_replace(job: AgentJob, **changes: Any) -> AgentJob:
    values = _job_document(job)
    values.update(changes)
    values["status"] = (
        values["status"].value
        if isinstance(values["status"], AgentJobStatus)
        else values["status"]
    )
    values["updated_at"] = utc_now().isoformat()
    return _job_from_document(values)


def _file_set_document(value: ArtifactFileSet) -> dict[str, Any]:
    return {
        "id": value.id,
        "project_id": value.project_id,
        "owner_kind": value.owner_kind,
        "owner_id": value.owner_id,
        "owner_revision": value.owner_revision,
        "source_tree_sha256": value.source_tree_sha256,
        "dist_tree_sha256": value.dist_tree_sha256,
        "storage_ref": value.storage_ref,
        "source_files": dict(value.source_files),
        "dist_files": dict(value.dist_files),
        "metadata": dict(value.metadata),
        "created_at": value.created_at,
    }


def _file_set_from_document(value: Mapping[str, Any]) -> ArtifactFileSet:
    return ArtifactFileSet(
        str(value["id"]),
        str(value["project_id"]),
        str(value["owner_kind"]),
        str(value["owner_id"]),
        int(value["owner_revision"]),
        str(value["source_tree_sha256"]),
        str(value["dist_tree_sha256"]),
        str(value["storage_ref"]),
        MappingProxyType(dict(value["source_files"])),
        MappingProxyType(dict(value["dist_files"])),
        MappingProxyType(dict(value.get("metadata", {}))),
        str(value["created_at"]),
    )


def _normalize_file_mapping(values: Mapping[str, bytes | str]) -> dict[str, bytes]:
    result: dict[str, bytes] = {}
    folded: set[str] = set()
    total = 0
    for name, content in sorted(values.items()):
        relative = _safe_relative(name)
        if relative.casefold() in folded:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED, "File-set paths differ only by case"
            )
        if _credential_name(PurePosixPath(relative).name):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED, "Credential-like files are forbidden"
            )
        folded.add(relative.casefold())
        payload = content.encode("utf-8") if isinstance(content, str) else content
        if not isinstance(payload, bytes):
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "File-set bytes invalid")
        total += len(payload)
        if len(result) >= 5_000 or total > 50_000_000:
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "File set exceeds limits")
        result[relative] = payload
    if not result:
        raise ContractError(ErrorCategory.POLICY_BLOCKED, "File set cannot be empty")
    return result


def _safe_relative(value: str) -> str:
    path = PurePosixPath(value)
    if (
        not isinstance(value, str)
        or not value
        or "\x00" in value
        or "\\" in value
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ContractError(ErrorCategory.POLICY_BLOCKED, "Unsafe file-set path")
    return path.as_posix()


def _credential_name(name: str) -> bool:
    value = name.casefold()
    return (
        value.startswith(".env")
        or value
        in {
            "credentials",
            "credentials.json",
            "secrets",
            "secrets.json",
            ".npmrc",
            ".pypirc",
        }
        or value.endswith((".pem", ".key", ".p12", ".pfx"))
    )


def _hashes(values: Mapping[str, bytes]) -> dict[str, str]:
    return {
        name: hashlib.sha256(payload).hexdigest()
        for name, payload in sorted(values.items())
    }


def _tree_hash(values: Mapping[str, str]) -> str:
    payload = canonical_json(dict(sorted(values.items()))).encode()
    return hashlib.sha256(payload).hexdigest()


def _write_tree(root: Path, values: Mapping[str, bytes]) -> None:
    for name, payload in values.items():
        target = root / Path(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)


def _verify_tree(root: Path, hashes: Mapping[str, str]) -> None:
    actual: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "File set has a symlink")
        if path.is_file():
            name = path.relative_to(root).as_posix()
            actual[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != dict(hashes):
        raise ContractError(ErrorCategory.DETERMINISTIC_FAILURE, "File set changed")
