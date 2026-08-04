"""Durable Phase 2 composition root."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from .agent_engine import AgentEngineScaffold
from .broker import TrustedFetchBroker
from .builder import NativeEsbuildBuilder
from .capabilities import CapabilityRegistry
from .context import DeterministicContextAssembler, EvidenceService, LocalSourceStore
from .control import ControlPlane
from .delivery import ValidatedDeliveryPort
from .domain import utc_now
from .evidence_persistence import SQLiteEvidenceRepository
from .framework_artifact import FrameworkArtifactContract
from .persistence import (
    SQLiteAuditLog,
    SQLiteCommandLedger,
    SQLiteEventStore,
    SQLiteProjectRepository,
    SQLiteSideEffectLedger,
    SQLiteStore,
    SQLiteTransactionalProjectWriter,
)
from .ports import (
    ArtifactProductionPort,
    DeliveryPort,
    DesignIntelligencePort,
    QualityGovernancePort,
)
from .quality import WebQualityPort
from .recovery import DurableDeliveryPort
from .renderer import TrustedWebRenderer
from .repository import RepositoryIngestion
from .runtime import SQLiteWorkflowRuntime
from .sandbox import default_sandbox_launcher
from .stubs import (
    DeterministicArtifactPort,
    DeterministicDeliveryPort,
    DeterministicDesignPort,
    DeterministicQualityPort,
)


class SQLiteApplication:
    """Owns the recoverable adapters and their connection lifecycle."""

    def __init__(
        self,
        database: str | Path,
        *,
        data_root: str | Path,
        clock: Callable[[], datetime] = utc_now,
        design: DesignIntelligencePort | None = None,
        artifact: ArtifactProductionPort | None = None,
        quality: QualityGovernancePort | None = None,
        delivery: DeliveryPort | None = None,
        repository_ingestion: RepositoryIngestion | None = None,
        trusted_fetch_broker: TrustedFetchBroker | None = None,
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
        self.repository_ingestion = (
            repository_ingestion
            if repository_ingestion is not None
            else RepositoryIngestion(
                self.evidence_repository,
                data_root,
                project_repository=self.repository,
            )
        )
        self.source_store = LocalSourceStore(data_root)
        self.evidence = EvidenceService(
            self.evidence_repository,
            self.source_store,
            project_repository=self.repository,
            repository_reader=self.repository_ingestion,
        )
        self.context_assembler = DeterministicContextAssembler()
        self.capabilities = CapabilityRegistry()
        self.framework_artifact = FrameworkArtifactContract()
        self.sandbox_launcher = default_sandbox_launcher()
        self.framework_builder = NativeEsbuildBuilder(
            launcher=self.sandbox_launcher
        )
        self.renderer = TrustedWebRenderer()
        self.quality_checks = WebQualityPort()
        self.trusted_fetch_broker = trusted_fetch_broker
        self.agent_engine = AgentEngineScaffold(
            data_root,
            repository_reader=self.repository_ingestion,
            sandbox_launcher=self.sandbox_launcher,
            renderer=self.renderer,
            workspace_root=(
                self.sandbox_launcher.workspace_base(data_root)
                if self.sandbox_launcher.available
                and hasattr(self.sandbox_launcher, "workspace_base")
                else None
            ),
        )
        durable_delivery = DurableDeliveryPort(
            delivery if delivery is not None else DeterministicDeliveryPort(),
            self.side_effects,
            audit_log=self.audit,
        )
        self.delivery_validation = ValidatedDeliveryPort(durable_delivery)
        self.control = ControlPlane(
            repository=self.repository,
            ledger=self.ledger,
            runtime=self.runtime,
            design=design if design is not None else DeterministicDesignPort(),
            artifact=(
                artifact if artifact is not None else DeterministicArtifactPort()
            ),
            quality=(quality if quality is not None else DeterministicQualityPort()),
            delivery=durable_delivery,
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
