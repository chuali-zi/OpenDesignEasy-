"""Durable Phase 2 composition root."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from .context import DeterministicContextAssembler, EvidenceService, LocalSourceStore
from .control import ControlPlane
from .domain import utc_now
from .evidence_persistence import SQLiteEvidenceRepository
from .persistence import (
    SQLiteAuditLog,
    SQLiteCommandLedger,
    SQLiteEventStore,
    SQLiteProjectRepository,
    SQLiteSideEffectLedger,
    SQLiteStore,
    SQLiteTransactionalProjectWriter,
)
from .recovery import DurableDeliveryPort
from .runtime import SQLiteWorkflowRuntime
from .stubs import DeterministicDeliveryPort


class SQLiteApplication:
    """Owns the recoverable adapters and their connection lifecycle."""

    def __init__(
        self,
        database: str | Path,
        *,
        data_root: str | Path,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self.store = SQLiteStore(database, data_root=data_root)
        self.repository = SQLiteProjectRepository(self.store)
        self.ledger = SQLiteCommandLedger(self.store)
        self.events = SQLiteEventStore(self.store)
        self.audit = SQLiteAuditLog(self.store)
        self.side_effects = SQLiteSideEffectLedger(self.store)
        self.writer = SQLiteTransactionalProjectWriter(self.store)
        self.runtime = SQLiteWorkflowRuntime(database, data_root=data_root, clock=clock)
        self.evidence_repository = SQLiteEvidenceRepository(self.store)
        self.source_store = LocalSourceStore(data_root)
        self.evidence = EvidenceService(
            self.evidence_repository,
            self.source_store,
            project_repository=self.repository,
        )
        self.context_assembler = DeterministicContextAssembler()
        delivery = DurableDeliveryPort(
            DeterministicDeliveryPort(), self.side_effects, audit_log=self.audit
        )
        self.control = ControlPlane(
            repository=self.repository,
            ledger=self.ledger,
            runtime=self.runtime,
            delivery=delivery,
            transactional_writer=self.writer,
            audit_log=self.audit,
            clock=clock,
        )

    def close(self) -> None:
        self.runtime.close()
        self.store.close()

    def __enter__(self) -> SQLiteApplication:
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.close()
