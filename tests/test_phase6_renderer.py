from __future__ import annotations

from pathlib import Path

import pytest

from oeydesign.domain import ContractError
from oeydesign.renderer import RenderProfile, TrustedWebRenderer


def test_frozen_renderer_profile_is_explicit_and_stable() -> None:
    profile = RenderProfile()
    assert profile.channel == "chrome"
    assert profile.viewport_width == 1440
    assert profile.viewport_height == 1000
    assert profile.device_scale_factor == 1.0
    assert profile.motion == "reduce"
    assert profile.as_mapping()["viewport"] == {"width": 1440, "height": 1000}


def test_renderer_rejects_unsafe_roots_and_non_frozen_channels(tmp_path: Path) -> None:
    root = tmp_path / "artifact"
    root.mkdir()
    (root / "index.html").write_text("<main>ok</main>", encoding="utf-8")
    renderer = TrustedWebRenderer()

    with pytest.raises(ContractError) as escaped:
        renderer.render(root, "../outside.html")
    assert escaped.value.category.value == "POLICY_BLOCKED"

    with pytest.raises(ContractError) as missing:
        renderer.render(root, "missing.html")
    assert missing.value.category.value == "POLICY_BLOCKED"

    with pytest.raises(ContractError) as channel:
        renderer.render(root, profile=RenderProfile(channel="chromium"))
    assert channel.value.category.value == "POLICY_BLOCKED"
