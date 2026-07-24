"""SQLite reference persistence adapters for Phase 2."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterable, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .domain import CommandRecord, ContractError, DomainEvent, ErrorCategory, Project
from .paths import resolve_database_path
from .serialization import dumps, loads


class SQLiteStore:
    def __init__(
        self,
        path: str | Path,
        *,
        data_root: str | Path | None = None,
        busy_timeout_ms: int = 5_000,
    ) -> None:
        self.path = resolve_database_path(path, data_root)
        self._lock = threading.RLock()
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        if self.path != ":memory:":
            self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.execute(f"PRAGMA busy_timeout = {int(busy_timeout_ms)}")
        self._migrate()

    def close(self) -> None:
        with self._lock:
            self.connection.close()

    def _migrate(self) -> None:
        with self._lock:
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY
                );
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL,
                    snapshot TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS project_revisions (
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    revision INTEGER NOT NULL,
                    snapshot TEXT NOT NULL,
                    PRIMARY KEY (project_id, revision)
                );
                CREATE TABLE IF NOT EXISTS project_events (
                    project_id TEXT NOT NULL REFERENCES projects(id),
                    sequence INTEGER NOT NULL,
                    event_id TEXT NOT NULL UNIQUE,
                    event_json TEXT NOT NULL,
                    PRIMARY KEY (project_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS command_ledger (
                    command_id TEXT PRIMARY KEY,
                    fingerprint TEXT NOT NULL,
                    record_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id TEXT,
                    run_id TEXT,
                    action TEXT NOT NULL,
                    revision INTEGER,
                    outcome TEXT,
                    metadata_json TEXT NOT NULL,
                    occurred_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS side_effects (
                    effect_key TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    result_json TEXT,
                    lease_until TEXT,
                    updated_at TEXT NOT NULL,
                    project_id TEXT,
                    action TEXT,
                    revision INTEGER,
                    error TEXT
                );
                INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
                """
            )
            columns = {
                row["name"]
                for row in self.connection.execute("PRAGMA table_info(side_effects)")
            }
            for name, type_name in (
                ("project_id", "TEXT"),
                ("action", "TEXT"),
                ("revision", "INTEGER"),
                ("error", "TEXT"),
            ):
                if name not in columns:
                    self.connection.execute(
                        f"ALTER TABLE side_effects ADD COLUMN {name} {type_name}"
                    )
            self.connection.commit()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                yield self.connection
                self.connection.commit()
            except Exception:
                self.connection.rollback()
                raise


class SQLiteProjectRepository:
    def __init__(self, store: SQLiteStore) -> None:
        self.store = store

    def add(self, project: Project) -> None:
        snapshot = dumps(project)
        try:
            with self.store.transaction() as conn:
                conn.execute(
                    "INSERT INTO projects VALUES (?, ?, ?)",
                    (project.id, project.revision, snapshot),
                )
                conn.execute(
                    "INSERT INTO project_revisions VALUES (?, ?, ?)",
                    (project.id, project.revision, snapshot),
                )
                self._append_events(conn, project.id, project.events)
        except sqlite3.IntegrityError as exc:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Project already exists",
                details={"project_id": project.id},
            ) from exc

    def _read(self, query: str, arguments: tuple[Any, ...], message: str) -> Project:
        with self.store._lock:
            row = self.store.connection.execute(query, arguments).fetchone()
        if row is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                message,
                details={"project_id": arguments[0]},
            )
        value = loads(row["snapshot"])
        if not isinstance(value, Project):
            raise TypeError("Project snapshot decoded to unexpected type")
        return value

    def get(self, project_id: str) -> Project:
        return self._read(
            "SELECT snapshot FROM projects WHERE id = ?",
            (project_id,),
            "Project does not exist",
        )

    def get_revision(self, project_id: str, revision: int) -> Project:
        return self._read(
            "SELECT snapshot FROM project_revisions "
            "WHERE project_id = ? AND revision = ?",
            (project_id, revision),
            "Project revision does not exist",
        )

    def list_revisions(self, project_id: str) -> tuple[int, ...]:
        with self.store._lock:
            rows = self.store.connection.execute(
                "SELECT revision FROM project_revisions "
                "WHERE project_id = ? ORDER BY revision",
                (project_id,),
            ).fetchall()
        if not rows:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Project does not exist",
                details={"project_id": project_id},
            )
        return tuple(row["revision"] for row in rows)

    def save(self, project: Project, *, expected_revision: int) -> None:
        snapshot = dumps(project)
        with self.store.transaction() as conn:
            current = conn.execute(
                "SELECT revision FROM projects WHERE id = ?", (project.id,)
            ).fetchone()
            if current is None:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Project does not exist",
                    details={"project_id": project.id},
                )
            if current["revision"] != expected_revision:
                raise ContractError(
                    ErrorCategory.STALE_REVISION,
                    "Project changed before commit",
                    current_revision=current["revision"],
                )
            conn.execute(
                "UPDATE projects SET revision = ?, snapshot = ? WHERE id = ?",
                (project.revision, snapshot, project.id),
            )
            conn.execute(
                "INSERT INTO project_revisions VALUES (?, ?, ?)",
                (project.id, project.revision, snapshot),
            )
            self._append_events(conn, project.id, project.events)

    @staticmethod
    def _append_events(
        conn: sqlite3.Connection, project_id: str, events: Iterable[DomainEvent]
    ) -> None:
        for event in events:
            payload = dumps(event)
            existing = conn.execute(
                "SELECT event_id, event_json FROM project_events "
                "WHERE project_id = ? AND sequence = ?",
                (project_id, event.sequence),
            ).fetchone()
            if existing is not None:
                if (
                    existing["event_id"] != event.id
                    or existing["event_json"] != payload
                ):
                    raise ContractError(
                        ErrorCategory.DETERMINISTIC_FAILURE,
                        "Project event sequence conflicts with persisted history",
                        details={
                            "project_id": project_id,
                            "sequence": event.sequence,
                        },
                    )
                continue
            conn.execute(
                "INSERT INTO project_events VALUES (?, ?, ?, ?)",
                (project_id, event.sequence, event.id, payload),
            )


class SQLiteCommandLedger:
    def __init__(self, store: SQLiteStore) -> None:
        self.store = store

    def get(self, command_id: str) -> CommandRecord | None:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT record_json FROM command_ledger WHERE command_id = ?",
                (command_id,),
            ).fetchone()
        return None if row is None else loads(row["record_json"])

    def record(self, command_id: str, record: CommandRecord) -> None:
        with self.store.transaction() as conn:
            row = conn.execute(
                "SELECT fingerprint FROM command_ledger WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            if row and row["fingerprint"] != record.fingerprint:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Command ID was reused with a different payload",
                    details={"command_id": command_id},
                )
            if not row:
                conn.execute(
                    "INSERT INTO command_ledger VALUES (?, ?, ?)",
                    (command_id, record.fingerprint, dumps(record)),
                )


class SQLiteEventStore:
    def __init__(self, store: SQLiteStore) -> None:
        self.store = store

    def after_sequence(
        self, project_id: str, after_sequence: int = 0
    ) -> tuple[DomainEvent, ...]:
        with self.store._lock:
            rows = self.store.connection.execute(
                "SELECT event_json FROM project_events "
                "WHERE project_id = ? AND sequence > ? ORDER BY sequence",
                (project_id, after_sequence),
            ).fetchall()
        return tuple(loads(row["event_json"]) for row in rows)


class SQLiteAuditLog:
    ALLOWED_METADATA = frozenset(
        {
            "attempt",
            "capability_version",
            "approval_id",
            "side_effect_key",
            "reason",
            "duration_ms",
            "error_category",
        }
    )

    def __init__(self, store: SQLiteStore) -> None:
        self.store = store

    def record(
        self,
        *,
        project_id: str | None,
        action: str,
        revision: int | None = None,
        outcome: str | None = None,
        run_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        safe = {
            key: value
            for key, value in (metadata or {}).items()
            if key in self.ALLOWED_METADATA
        }
        with self.store.transaction() as conn:
            conn.execute(
                "INSERT INTO audit_log(project_id, run_id, action, revision, "
                "outcome, metadata_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    project_id,
                    run_id,
                    action,
                    revision,
                    outcome,
                    dumps(safe),
                    datetime.now(UTC).isoformat(),
                ),
            )

    def query(
        self, *, project_id: str | None = None, run_id: str | None = None
    ) -> tuple[dict[str, Any], ...]:
        clauses, args = [], []
        if project_id is not None:
            clauses.append("project_id = ?")
            args.append(project_id)
        if run_id is not None:
            clauses.append("run_id = ?")
            args.append(run_id)
        with self.store._lock:
            rows = self.store.connection.execute(
                "SELECT * FROM audit_log"
                + (" WHERE " + " AND ".join(clauses) if clauses else "")
                + " ORDER BY id",
                args,
            ).fetchall()
        return tuple(
            {**dict(row), "metadata": loads(row["metadata_json"])} for row in rows
        )


class SQLiteSideEffectLedger:
    def __init__(self, store: SQLiteStore) -> None:
        self.store = store

    def claim(
        self,
        effect_key: str,
        *,
        project_id: str,
        action: str,
        target_revision: int,
        lease_seconds: int = 60,
    ) -> dict[str, Any]:
        now = datetime.now(UTC)
        lease = datetime.fromtimestamp(now.timestamp() + lease_seconds, UTC).isoformat()
        trace = (project_id, action, target_revision)
        with self.store.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM side_effects WHERE effect_key = ?", (effect_key,)
            ).fetchone()
            if row and trace != (row["project_id"], row["action"], row["revision"]):
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Side-effect key was reused with different trace metadata",
                )
            if row and row["status"] == "COMPLETED":
                return {"status": "COMPLETED", "result": loads(row["result_json"])}
            if row and row["lease_until"] and row["lease_until"] > now.isoformat():
                return {
                    "status": "CLAIMED",
                    "claimed": False,
                    "recovery_required": False,
                }
            if row:
                conn.execute(
                    "UPDATE side_effects SET status = ?, lease_until = ?, "
                    "updated_at = ?, error = NULL WHERE effect_key = ?",
                    ("CLAIMED", lease, now.isoformat(), effect_key),
                )
            else:
                conn.execute(
                    "INSERT INTO side_effects(effect_key, status, result_json, "
                    "lease_until, updated_at, project_id, action, revision) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        effect_key,
                        "CLAIMED",
                        None,
                        lease,
                        now.isoformat(),
                        project_id,
                        action,
                        target_revision,
                    ),
                )
        return {"status": "CLAIMED", "claimed": True, "recovery_required": bool(row)}

    def complete(self, effect_key: str, result: Any) -> Any:
        with self.store.transaction() as conn:
            row = conn.execute(
                "SELECT status, result_json FROM side_effects WHERE effect_key = ?",
                (effect_key,),
            ).fetchone()
            if row is None:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Side effect must be claimed before completion",
                )
            if row["status"] == "COMPLETED":
                if loads(row["result_json"]) != result:
                    raise ContractError(
                        ErrorCategory.DETERMINISTIC_FAILURE,
                        "Completed side effect cannot be overwritten",
                    )
                return result
            conn.execute(
                "UPDATE side_effects SET status = ?, result_json = ?, "
                "lease_until = NULL, updated_at = ?, error = NULL "
                "WHERE effect_key = ?",
                ("COMPLETED", dumps(result), datetime.now(UTC).isoformat(), effect_key),
            )
        return result

    def get(self, effect_key: str) -> dict[str, Any] | None:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT * FROM side_effects WHERE effect_key = ?", (effect_key,)
            ).fetchone()
        if row is None:
            return None
        return {
            "status": row["status"],
            "result": loads(row["result_json"]) if row["result_json"] else None,
            "project_id": row["project_id"],
            "action": row["action"],
            "revision": row["revision"],
            "error": row["error"],
        }

    def fail(self, effect_key: str, error: str) -> None:
        with self.store.transaction() as conn:
            row = conn.execute(
                "SELECT status FROM side_effects WHERE effect_key = ?", (effect_key,)
            ).fetchone()
            if row is None:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Side effect must be claimed before failure",
                )
            if row["status"] == "COMPLETED":
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Completed side effect cannot fail",
                )
            conn.execute(
                "UPDATE side_effects SET status = ?, lease_until = NULL, "
                "updated_at = ?, error = ? WHERE effect_key = ?",
                (
                    "FAILED",
                    datetime.now(UTC).isoformat(),
                    error.splitlines()[0][:128],
                    effect_key,
                ),
            )


class SQLiteTransactionalProjectWriter:
    """Commits aggregate snapshots, events, and idempotency record atomically."""

    def __init__(self, store: SQLiteStore) -> None:
        self.store = store

    def add_with_command(
        self, project: Project, command_id: str, record: CommandRecord
    ) -> None:
        snapshot = dumps(project)
        try:
            with self.store.transaction() as conn:
                conn.execute(
                    "INSERT INTO projects VALUES (?, ?, ?)",
                    (project.id, project.revision, snapshot),
                )
                conn.execute(
                    "INSERT INTO project_revisions VALUES (?, ?, ?)",
                    (project.id, project.revision, snapshot),
                )
                SQLiteProjectRepository._append_events(conn, project.id, project.events)
                self._record(conn, command_id, record)
        except sqlite3.IntegrityError as exc:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE, "Project already exists"
            ) from exc

    def save_with_command(
        self,
        project: Project,
        *,
        expected_revision: int,
        command_id: str,
        record: CommandRecord,
    ) -> None:
        snapshot = dumps(project)
        with self.store.transaction() as conn:
            current = conn.execute(
                "SELECT revision FROM projects WHERE id = ?", (project.id,)
            ).fetchone()
            if current is None:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE, "Project does not exist"
                )
            if current["revision"] != expected_revision:
                raise ContractError(
                    ErrorCategory.STALE_REVISION,
                    "Project changed before commit",
                    current_revision=current["revision"],
                )
            conn.execute(
                "UPDATE projects SET revision = ?, snapshot = ? WHERE id = ?",
                (project.revision, snapshot, project.id),
            )
            conn.execute(
                "INSERT INTO project_revisions VALUES (?, ?, ?)",
                (project.id, project.revision, snapshot),
            )
            SQLiteProjectRepository._append_events(conn, project.id, project.events)
            self._record(conn, command_id, record)

    @staticmethod
    def _record(
        conn: sqlite3.Connection, command_id: str, record: CommandRecord
    ) -> None:
        row = conn.execute(
            "SELECT fingerprint FROM command_ledger WHERE command_id = ?", (command_id,)
        ).fetchone()
        if row and row["fingerprint"] != record.fingerprint:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Command ID was reused with a different payload",
            )
        if not row:
            conn.execute(
                "INSERT INTO command_ledger VALUES (?, ?, ?)",
                (command_id, record.fingerprint, dumps(record)),
            )
