from __future__ import annotations

from pathlib import Path

import pytest

from oeydesign import (
    DeterministicArtifactPort,
    DeterministicDeliveryPort,
    DeterministicDesignPort,
    DeterministicQualityPort,
    Phase6Application,
    Phase6Bindings,
    Phase6Profile,
)


class RealDesignForTest(DeterministicDesignPort):
    capability_version = "design-test-real/1"


class RealArtifactForTest(DeterministicArtifactPort):
    capability_version = "artifact-test-real/1"


class RealQualityForTest(DeterministicQualityPort):
    capability_version = "quality-test-real/1"


class RealDeliveryForTest(DeterministicDeliveryPort):
    capability_version = "delivery-test-real/1"


class RealRepositoryForTest:
    capability_version = "repository-test-real/1"


def test_phase6_scaffold_boots_but_does_not_claim_real_readiness(
    tmp_path: Path,
) -> None:
    with Phase6Application(tmp_path / "p6.sqlite", data_root=tmp_path) as app:
        assert not app.readiness.ready
        assert "context.repository" not in app.readiness.missing
        assert "agent.engine" in app.readiness.missing
        with pytest.raises(RuntimeError, match="agent.engine"):
            app.require_real_slice_ready()


def test_phase6_profile_freezes_first_slice_choices() -> None:
    profile = Phase6Profile()

    assert profile.scenario == "repository-to-agent-workbench"
    assert profile.medium == "web"
    assert profile.framework_profile == "react-mui-native-esbuild/1"
    assert profile.renderer_profile == "playwright-system-chrome/1"
    assert profile.sandbox_profile == "appcontainer-job-broker/1"
    assert profile.generated_images is False


def test_real_bindings_are_injected_and_satisfy_readiness(tmp_path: Path) -> None:
    design = RealDesignForTest()
    artifact = RealArtifactForTest()
    quality = RealQualityForTest()
    delivery = RealDeliveryForTest()
    bindings = Phase6Bindings(
        design=design,
        artifact=artifact,
        quality=quality,
        delivery=delivery,
        repository_ingestion=RealRepositoryForTest(),
        infrastructure_versions={
            "agent.engine": "agent-engine-test/1",
            "render.web": "renderer-test/1",
            "framework.build": "framework-builder-test/1",
        },
    )

    with Phase6Application(
        tmp_path / "ready.sqlite", data_root=tmp_path, bindings=bindings
    ) as app:
        assert app.readiness.ready
        app.require_real_slice_ready()
        assert app.control.design is design
        assert app.control.artifact is artifact
        assert app.control.quality is quality
        assert app.control.delivery.inner is delivery
        assert app.repository_ingestion is bindings.repository_ingestion


def test_explicit_stub_bindings_do_not_satisfy_real_slots(tmp_path: Path) -> None:
    bindings = Phase6Bindings(
        design=DeterministicDesignPort(),
        artifact=DeterministicArtifactPort(),
        quality=DeterministicQualityPort(),
        delivery=DeterministicDeliveryPort(),
    )

    with Phase6Application(
        tmp_path / "stub.sqlite", data_root=tmp_path, bindings=bindings
    ) as app:
        assert "design.intelligence" in app.readiness.missing
        assert "delivery.release" in app.readiness.missing


def test_infrastructure_declaration_cannot_spoof_a_port_binding(
    tmp_path: Path,
) -> None:
    bindings = Phase6Bindings(
        infrastructure_versions={"design.intelligence": "fake-design/1"}
    )

    with Phase6Application(
        tmp_path / "spoof.sqlite", data_root=tmp_path, bindings=bindings
    ) as app:
        assert "design.intelligence" in app.readiness.missing
        assert app.readiness.version_for("design.intelligence") is None
