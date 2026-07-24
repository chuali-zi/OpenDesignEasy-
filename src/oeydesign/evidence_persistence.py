"""SQLite persistence adapter for evidence, sources, and context packages."""

from __future__ import annotations

from typing import Any, TypeVar, cast

from .domain import (
    ContextPackage,
    ContractError,
    ErrorCategory,
    EvidenceRecord,
    SourceAsset,
    SourceLocator,
)
from .persistence import SQLiteStore
from .serialization import dumps, loads

T = TypeVar("T")


class SQLiteEvidenceRepository:
    """Append-only Phase 3 repository sharing the application SQLite store."""

    def __init__(self, store: SQLiteStore) -> None:
        self.store = store
        with store._lock:
            store.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS evidence_schema (
                    version INTEGER PRIMARY KEY
                );
                CREATE TABLE IF NOT EXISTS evidence_sources (
                    source_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    project_id TEXT NOT NULL,
                    snapshot TEXT NOT NULL,
                    PRIMARY KEY (source_id, revision)
                );
                CREATE INDEX IF NOT EXISTS idx_evidence_sources_project
                ON evidence_sources(project_id, source_id, revision);
                CREATE TABLE IF NOT EXISTS evidence_records (
                    evidence_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    snapshot TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_evidence_records_project
                ON evidence_records(project_id, revision, evidence_id);
                CREATE TABLE IF NOT EXISTS evidence_contexts (
                    project_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    context_id TEXT NOT NULL UNIQUE,
                    snapshot TEXT NOT NULL,
                    PRIMARY KEY (project_id, revision)
                );
                INSERT OR IGNORE INTO evidence_schema(version) VALUES (1);
                """
            )
            store.connection.commit()

    @staticmethod
    def _collision(message: str, **details: Any) -> ContractError:
        return ContractError(
            ErrorCategory.DETERMINISTIC_FAILURE, message, details=details
        )

    @classmethod
    def _decode(cls, payload: str, expected: type[T]) -> T:
        value = loads(payload)
        if not isinstance(value, expected):
            raise cls._collision(
                "Evidence snapshot decoded to an unexpected type",
                expected=expected.__name__,
            )
        return cast(T, value)

    def add_source(self, source: SourceAsset) -> None:
        with self.store.transaction() as conn:
            same = conn.execute(
                "SELECT project_id, snapshot FROM evidence_sources "
                "WHERE source_id = ? AND revision = ?",
                (source.id, source.revision),
            ).fetchone()
            if same is not None:
                if (
                    same["project_id"] != source.project_id
                    or self._decode(same["snapshot"], SourceAsset) != source
                ):
                    raise self._collision(
                        "Source ID/revision collision",
                        source_id=source.id,
                        revision=source.revision,
                    )
                return
            history = conn.execute(
                "SELECT project_id, MAX(revision) AS revision "
                "FROM evidence_sources WHERE source_id = ? GROUP BY project_id",
                (source.id,),
            ).fetchone()
            if history is not None and history["project_id"] != source.project_id:
                raise self._collision(
                    "Source belongs to another Project", source_id=source.id
                )
            expected_revision = 1 if history is None else int(history["revision"]) + 1
            if source.revision != expected_revision:
                raise self._collision(
                    "Source revisions must be append-only and contiguous",
                    source_id=source.id,
                    expected_revision=expected_revision,
                )
            conn.execute(
                "INSERT INTO evidence_sources VALUES (?, ?, ?, ?)",
                (source.id, source.revision, source.project_id, dumps(source)),
            )

    def get_source(self, source_id: str, revision: int | None = None) -> SourceAsset:
        query = "SELECT snapshot FROM evidence_sources WHERE source_id = ?"
        arguments: tuple[Any, ...] = (source_id,)
        if revision is not None:
            query += " AND revision = ?"
            arguments += (revision,)
        query += " ORDER BY revision DESC LIMIT 1"
        with self.store._lock:
            row = self.store.connection.execute(query, arguments).fetchone()
        if row is None:
            raise self._collision(
                "Source does not exist", source_id=source_id, revision=revision
            )
        return self._decode(row["snapshot"], SourceAsset)

    def list_sources(self, project_id: str) -> tuple[SourceAsset, ...]:
        with self.store._lock:
            rows = self.store.connection.execute(
                """
                SELECT source.snapshot
                FROM evidence_sources AS source
                JOIN (
                    SELECT source_id, MAX(revision) AS revision
                    FROM evidence_sources
                    WHERE project_id = ?
                    GROUP BY source_id
                ) AS latest
                ON source.source_id = latest.source_id
                AND source.revision = latest.revision
                WHERE source.project_id = ?
                ORDER BY source.source_id
                """,
                (project_id, project_id),
            ).fetchall()
        return tuple(self._decode(row["snapshot"], SourceAsset) for row in rows)

    def add_evidence(self, records: tuple[EvidenceRecord, ...]) -> None:
        with self.store.transaction() as conn:
            for record in records:
                source = conn.execute(
                    "SELECT project_id FROM evidence_sources "
                    "WHERE source_id = ? AND revision = ?",
                    (record.locator.source_id, record.locator.source_revision),
                ).fetchone()
                if source is None or source["project_id"] != record.project_id:
                    raise self._collision(
                        "Evidence source is missing or belongs to another Project",
                        evidence_id=record.id,
                    )
                for parent_id in record.derived_from:
                    parent = conn.execute(
                        "SELECT project_id FROM evidence_records WHERE evidence_id = ?",
                        (parent_id,),
                    ).fetchone()
                    if parent is None or parent["project_id"] != record.project_id:
                        raise self._collision(
                            "Evidence lineage is missing or crosses Projects",
                            evidence_id=record.id,
                            parent_id=parent_id,
                        )
                row = conn.execute(
                    "SELECT project_id, snapshot FROM evidence_records "
                    "WHERE evidence_id = ?",
                    (record.id,),
                ).fetchone()
                if row is not None:
                    if (
                        row["project_id"] != record.project_id
                        or self._decode(row["snapshot"], EvidenceRecord) != record
                    ):
                        raise self._collision(
                            "Evidence ID collision", evidence_id=record.id
                        )
                    continue
                conn.execute(
                    "INSERT INTO evidence_records VALUES (?, ?, ?, ?)",
                    (record.id, record.project_id, record.revision, dumps(record)),
                )

    def get_evidence(self, evidence_id: str) -> EvidenceRecord:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT snapshot FROM evidence_records WHERE evidence_id = ?",
                (evidence_id,),
            ).fetchone()
        if row is None:
            raise self._collision("Evidence does not exist", evidence_id=evidence_id)
        return self._decode(row["snapshot"], EvidenceRecord)

    def list_evidence(self, project_id: str) -> tuple[EvidenceRecord, ...]:
        with self.store._lock:
            rows = self.store.connection.execute(
                "SELECT snapshot FROM evidence_records WHERE project_id = ? "
                "ORDER BY revision, evidence_id",
                (project_id,),
            ).fetchall()
        return tuple(self._decode(row["snapshot"], EvidenceRecord) for row in rows)

    def save_context(self, package: ContextPackage) -> None:
        with self.store.transaction() as conn:
            same = conn.execute(
                "SELECT context_id, snapshot FROM evidence_contexts "
                "WHERE project_id = ? AND revision = ?",
                (package.project_id, package.revision),
            ).fetchone()
            if same is not None:
                if (
                    same["context_id"] != package.id
                    or self._decode(same["snapshot"], ContextPackage) != package
                ):
                    raise self._collision(
                        "Context revision collision",
                        project_id=package.project_id,
                        revision=package.revision,
                    )
                return
            reused_id = conn.execute(
                "SELECT project_id FROM evidence_contexts WHERE context_id = ?",
                (package.id,),
            ).fetchone()
            if reused_id is not None:
                raise self._collision("Context ID collision", context_id=package.id)
            latest = conn.execute(
                "SELECT MAX(revision) AS revision FROM evidence_contexts "
                "WHERE project_id = ?",
                (package.project_id,),
            ).fetchone()
            expected_revision = (
                1 if latest["revision"] is None else int(latest["revision"]) + 1
            )
            if package.revision != expected_revision:
                raise self._collision(
                    "Context revisions must be append-only and contiguous",
                    project_id=package.project_id,
                    expected_revision=expected_revision,
                )
            self._validate_locators(conn, package)
            conn.execute(
                "INSERT INTO evidence_contexts VALUES (?, ?, ?, ?)",
                (package.project_id, package.revision, package.id, dumps(package)),
            )

    @classmethod
    def _validate_locators(cls, conn: Any, package: ContextPackage) -> None:
        locators: tuple[SourceLocator, ...] = (
            package.evidence_refs
            + package.analysis_asset_refs
            + package.delivery_asset_refs
        )
        for locator in locators:
            row = conn.execute(
                "SELECT project_id FROM evidence_sources "
                "WHERE source_id = ? AND revision = ?",
                (locator.source_id, locator.source_revision),
            ).fetchone()
            if row is None or row["project_id"] != package.project_id:
                raise cls._collision(
                    "Context locator is missing or crosses Projects",
                    source_id=locator.source_id,
                )

    def latest_context(self, project_id: str) -> ContextPackage | None:
        with self.store._lock:
            row = self.store.connection.execute(
                "SELECT snapshot FROM evidence_contexts WHERE project_id = ? "
                "ORDER BY revision DESC LIMIT 1",
                (project_id,),
            ).fetchone()
        if row is None:
            return None
        return self._decode(row["snapshot"], ContextPackage)
