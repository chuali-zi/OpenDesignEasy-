from __future__ import annotations

import os
from pathlib import Path

import pytest

from oeydesign import Phase6Application, Phase6Bindings, Phase6Profile
from oeydesign.phase6 import assess_phase6_readiness
from oeydesign.stubs import (
    DeterministicArtifactPort,
    DeterministicDeliveryPort,
    DeterministicDesignPort,
    DeterministicQualityPort,
)


def test_missing_dependency_image_keeps_infrastructure_not_ready(
    tmp_path: Path,
) -> None:
    with Phase6Application(
        tmp_path / "p6.sqlite",
        data_root=tmp_path,
        dependency_image=tmp_path / "missing-node-modules",
    ) as app:
        assert not app.readiness.ready
        assert "framework.build" in app.readiness.missing
        assert "agent.engine" in app.readiness.missing
        with pytest.raises(RuntimeError, match="agent.engine"):
            app.require_real_slice_ready()


def test_phase6_profile_freezes_all_eight_slots() -> None:
    profile = Phase6Profile()
    assert len(profile.required_capabilities) == 8
    assert profile.framework_profile == "react-mui-native-esbuild/1"
    assert profile.renderer_profile == "playwright-system-chrome/1"
    assert profile.sandbox_profile == "appcontainer-job-broker/1"
    with pytest.raises(ValueError, match="eight Phase 6"):
        Phase6Profile(required_capabilities=())


def test_version_strings_and_renamed_stubs_cannot_fill_all_slots() -> None:
    class RenamedDesignStub(DeterministicDesignPort):
        capability_version = "design-called-real/1"
        p6_slot = "design.intelligence"
        ready_for_p6 = True

    readiness = assess_phase6_readiness(
        Phase6Profile(),
        Phase6Bindings(
            design=RenamedDesignStub(),
            artifact=DeterministicArtifactPort(),
            quality=DeterministicQualityPort(),
            delivery=DeterministicDeliveryPort(),
            infrastructure_versions={
                "agent.engine": "fake-agent/1",
                "render.web": "fake-renderer/1",
                "framework.build": "fake-builder/1",
            },
        ),
    )
    assert not readiness.ready
    assert "agent.engine" in readiness.missing
    assert "framework.build" in readiness.missing
    assert "design.intelligence" in readiness.missing
    assert "artifact.production" in readiness.missing


@pytest.mark.skipif(os.name != "nt", reason="AppContainer profile is Windows-only")
def test_default_phase6_object_graph_binds_all_real_slots(tmp_path: Path) -> None:
    dependency_image = (
        Path(__file__).resolve().parents[1]
        / "spikes"
        / "e8-e12-framework"
        / "node_modules"
    )
    if not dependency_image.is_dir():
        pytest.skip("Frozen framework dependency image is unavailable")
    with Phase6Application(
        tmp_path / "ready.sqlite",
        data_root=tmp_path,
        dependency_image=dependency_image,
    ) as app:
        app.require_real_slice_ready()
        assert len(app.readiness.versions) == 8
        assert app.control.design is app.bindings.design
        assert app.control.artifact is app.bindings.artifact
        assert app.control.quality is app.bindings.quality
        assert app.control.delivery is app.delivery_validation
