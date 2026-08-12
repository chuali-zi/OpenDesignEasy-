"""Phase 6 production composition and object-graph readiness gate."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any

from .artifact import WebArtifactProduction
from .builder import NativeEsbuildBuilder
from .composition import SQLiteApplication
from .delivery import ValidatedDeliveryPort
from .design import TerritoryDesignIntelligence
from .ports import (
    ArtifactProductionPort,
    DeliveryPort,
    DesignIntelligencePort,
    QualityGovernancePort,
)
from .publisher import LocalImmutableDeliveryPort
from .quality import WebQualityPort
from .recovery import DurableDeliveryPort
from .repository import RepositoryIngestion
from .stubs import (
    DeterministicArtifactPort,
    DeterministicDeliveryPort,
    DeterministicDesignPort,
    DeterministicQualityPort,
)

P6_REQUIRED_CAPABILITIES = (
    "context.repository",
    "agent.engine",
    "design.intelligence",
    "artifact.production",
    "render.web",
    "quality.governance",
    "delivery.release",
    "framework.build",
)

P6_INFRASTRUCTURE_CAPABILITIES = frozenset(
    {"agent.engine", "render.web", "framework.build"}
)


@dataclass(frozen=True)
class Phase6Profile:
    """Frozen choices for the first real vertical slice."""

    scenario: str = "repository-to-agent-workbench"
    medium: str = "web"
    framework_profile: str = "react-mui-native-esbuild/1"
    renderer_profile: str = "playwright-system-chrome/1"
    sandbox_profile: str = "appcontainer-job-broker/1"
    generated_images: bool = False
    required_capabilities: tuple[str, ...] = P6_REQUIRED_CAPABILITIES

    def __post_init__(self) -> None:
        if self.required_capabilities != P6_REQUIRED_CAPABILITIES:
            raise ValueError("The eight Phase 6 capability slots cannot be replaced")


@dataclass(frozen=True)
class Phase6Bindings:
    """Real adapter candidates supplied by the P6 assembly layer.

    Every slot is represented by the runtime object actually used by the app.
    ``infrastructure_versions`` is retained only for old callers and is ignored
    by readiness; strings cannot satisfy a capability gate.
    """

    design: DesignIntelligencePort | None = None
    artifact: ArtifactProductionPort | None = None
    quality: QualityGovernancePort | None = None
    delivery: DeliveryPort | None = None
    repository_ingestion: RepositoryIngestion | None = None
    agent: Any | None = None
    renderer: Any | None = None
    builder: Any | None = None
    infrastructure_versions: Mapping[str, str] = field(default_factory=dict)

    def capability_versions(self) -> Mapping[str, str]:
        versions: dict[str, str] = {}
        bindings = (
            ("context.repository", self.repository_ingestion),
            ("agent.engine", self.agent),
            ("design.intelligence", self.design),
            ("artifact.production", self.artifact),
            ("render.web", self.renderer),
            ("quality.governance", self.quality),
            ("delivery.release", self.delivery),
            ("framework.build", self.builder),
        )
        for slot, adapter in bindings:
            if _real_binding(slot, adapter):
                version = str(adapter.capability_version).strip()
                versions[slot] = version
        return MappingProxyType(versions)


@dataclass(frozen=True)
class Phase6Readiness:
    required: tuple[str, ...]
    versions: tuple[tuple[str, str], ...]
    missing: tuple[str, ...]

    @property
    def ready(self) -> bool:
        return not self.missing

    def version_for(self, capability: str) -> str | None:
        return dict(self.versions).get(capability)


def assess_phase6_readiness(
    profile: Phase6Profile, bindings: Phase6Bindings
) -> Phase6Readiness:
    versions = bindings.capability_versions()
    missing = tuple(
        slot for slot in profile.required_capabilities if slot not in versions
    )
    return Phase6Readiness(
        required=profile.required_capabilities,
        versions=tuple(sorted(versions.items())),
        missing=missing,
    )


class Phase6Application(SQLiteApplication):
    """P6 composition root; deterministic fallbacks never satisfy readiness."""

    def __init__(
        self,
        database: str | Path,
        *,
        data_root: str | Path,
        bindings: Phase6Bindings | None = None,
        profile: Phase6Profile | None = None,
        dependency_image: str | Path | None = None,
    ) -> None:
        self.profile = profile or Phase6Profile()
        requested_bindings = bindings or Phase6Bindings()
        super().__init__(
            database,
            data_root=data_root,
            design=requested_bindings.design,
            artifact=requested_bindings.artifact,
            quality=requested_bindings.quality,
            delivery=requested_bindings.delivery,
            repository_ingestion=requested_bindings.repository_ingestion,
        )
        configured_image = dependency_image or _default_dependency_image()
        self.framework_builder = NativeEsbuildBuilder(
            launcher=self.sandbox_launcher,
            dependency_image=configured_image,
        )
        self.agent_engine.capability_version = "agent-engine-appcontainer/1"
        self.agent_engine.ready_for_p6 = bool(
            self.agent_engine.ready_for_p6 and self.framework_builder.ready_for_p6
        )
        design = requested_bindings.design or TerritoryDesignIntelligence()
        artifact = requested_bindings.artifact or WebArtifactProduction(
            data_root, renderer=self.renderer
        )
        quality = requested_bindings.quality or WebQualityPort()
        if requested_bindings.delivery is None:
            publisher: DeliveryPort = LocalImmutableDeliveryPort(data_root)
        else:
            publisher = requested_bindings.delivery
        if isinstance(publisher, ValidatedDeliveryPort):
            delivery = publisher
        else:
            durable = DurableDeliveryPort(
                publisher,
                self.side_effects,
                audit_log=self.audit,
            )
            delivery = ValidatedDeliveryPort(durable)
        self.quality_checks = quality
        self.delivery_validation = delivery
        self.control.design = design
        self.control.artifact = artifact
        self.control.quality = quality
        self.control.delivery = delivery
        self.bindings = Phase6Bindings(
            design=design,
            artifact=artifact,
            quality=quality,
            delivery=delivery,
            repository_ingestion=self.repository_ingestion,
            agent=self.agent_engine,
            renderer=self.renderer,
            builder=self.framework_builder,
        )
        self.control.capability_versions = dict(self.bindings.capability_versions())
        self.readiness = assess_phase6_readiness(self.profile, self.bindings)

    def require_real_slice_ready(self) -> None:
        if not self.readiness.ready:
            missing = ", ".join(self.readiness.missing)
            raise RuntimeError(f"Phase 6 real slice is not ready; missing: {missing}")


_REQUIRED_METHODS = {
    "context.repository": ("authorize", "ingest_repository", "list_files", "read_file"),
    "agent.engine": ("open_workspace", "create_loop", "run_command"),
    "design.intelligence": (
        "plan_design",
        "create_candidates",
        "revise_candidate",
        "commit_direction",
    ),
    "artifact.production": (
        "materialize",
        "apply_artifact_change",
        "render_artifact",
        "export_artifact",
    ),
    "render.web": ("render",),
    "quality.governance": (
        "assess_candidate",
        "assess_artifact",
        "plan_remediation",
        "authorize_transition",
    ),
    "delivery.release": ("release", "reconcile"),
    "framework.build": ("build",),
}


def _real_binding(slot: str, adapter: Any | None) -> bool:
    if adapter is None or getattr(adapter, "p6_slot", None) != slot:
        return False
    if isinstance(
        adapter,
        (
            DeterministicDesignPort,
            DeterministicArtifactPort,
            DeterministicQualityPort,
            DeterministicDeliveryPort,
        ),
    ):
        return False
    if not bool(getattr(adapter, "ready_for_p6", False)):
        return False
    version = str(getattr(adapter, "capability_version", "")).strip()
    rejected = ("stub", "scaffold", "unavailable")
    if not version or any(marker in version.casefold() for marker in rejected):
        return False
    return all(
        callable(getattr(adapter, name, None)) for name in _REQUIRED_METHODS[slot]
    )


def _default_dependency_image() -> Path | None:
    candidate = (
        Path(__file__).resolve().parents[2]
        / "spikes"
        / "e8-e12-framework"
        / "node_modules"
    )
    return candidate if candidate.is_dir() else None
