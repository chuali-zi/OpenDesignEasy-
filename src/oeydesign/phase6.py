"""Phase 6 composition scaffold and honest readiness gate.

This module deliberately does not implement the real adapters.  It gives those
adapters stable slots, keeps the Phase 1-4 deterministic fallback usable, and
prevents a fallback-backed application from being reported as a real P6 slice.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path
from types import MappingProxyType

from .composition import SQLiteApplication
from .ports import (
    ArtifactProductionPort,
    DeliveryPort,
    DesignIntelligencePort,
    QualityGovernancePort,
)
from .repository import RepositoryIngestion

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


@dataclass(frozen=True)
class Phase6Bindings:
    """Real adapter candidates supplied by the P6 assembly layer.

    Infrastructure versions cover capabilities that are not yet represented by
    the Phase 1 port protocols.  A version is evidence of assembly, not evidence
    that its conformance tests passed; the P6 plan owns those exit checks.
    """

    design: DesignIntelligencePort | None = None
    artifact: ArtifactProductionPort | None = None
    quality: QualityGovernancePort | None = None
    delivery: DeliveryPort | None = None
    repository_ingestion: RepositoryIngestion | None = None
    infrastructure_versions: Mapping[str, str] = field(default_factory=dict)

    def capability_versions(self) -> Mapping[str, str]:
        versions = {
            key: value.strip()
            for key, value in self.infrastructure_versions.items()
            if (
                key in P6_INFRASTRUCTURE_CAPABILITIES
                and value.strip()
                and "stub" not in value.casefold()
                and "scaffold" not in value.casefold()
            )
        }
        port_bindings = (
            ("context.repository", self.repository_ingestion),
            ("design.intelligence", self.design),
            ("artifact.production", self.artifact),
            ("quality.governance", self.quality),
            ("delivery.release", self.delivery),
        )
        for slot, adapter in port_bindings:
            if adapter is None:
                continue
            version = adapter.capability_version.strip()
            if version and "stub" not in version.casefold():
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
        self.bindings = replace(
            requested_bindings,
            repository_ingestion=self.repository_ingestion,
        )
        self.readiness = assess_phase6_readiness(self.profile, self.bindings)

    def require_real_slice_ready(self) -> None:
        if not self.readiness.ready:
            missing = ", ".join(self.readiness.missing)
            raise RuntimeError(f"Phase 6 real slice is not ready; missing: {missing}")
