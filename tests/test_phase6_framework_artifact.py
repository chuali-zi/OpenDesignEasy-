from __future__ import annotations

from pathlib import Path

import pytest

from oeydesign.agent_engine import WorkspaceManager, WorkspaceScope
from oeydesign.builder import NativeEsbuildBuilder
from oeydesign.domain import ContractError
from oeydesign.framework_artifact import (
    AnchorRegistry,
    FrameworkArtifactContract,
    FrameworkProfile,
    StrictThemeFactory,
)
from oeydesign.sandbox import SandboxResult

TOKENS = {
    "background": "#141311",
    "foreground": "#EDEAE3",
    "accent": "#E8602C",
    "border": "#3A3732",
    "muted": "#8B857B",
    "focus": "#F4B860",
}


def framework_files() -> dict[str, str]:
    return {
        "package.json": '{"dependencies":{"react":"19.1.1"}}',
        "package-lock.json": '{"lockfileVersion":3}',
        "index.html": (
            '<main data-oey-section="hero">'
            '<h1 data-oey-object="hero:title">Hello</h1>'
            "</main>"
        ),
        "src/main.jsx": "export const App = () => null;",
    }


def test_strict_theme_and_anchor_registry_are_deterministic() -> None:
    theme = StrictThemeFactory().build(TOKENS)
    assert tuple(theme.tokens) == tuple(TOKENS)
    assert theme.material_theme["palette"]["primary"] == "#E8602C"
    refs = AnchorRegistry().extract(framework_files()["index.html"])
    assert refs == {
        "hero:title": '[data-oey-object="hero:title"]',
        "section:hero": '[data-oey-section="hero"]',
    }

    with pytest.raises(ContractError) as duplicate:
        AnchorRegistry().extract(
            '<div data-oey-object="same"></div><p data-oey-object="same"></p>'
        )
    assert duplicate.value.category.value == "DETERMINISTIC_FAILURE"


def test_framework_contract_freezes_profile_tree_and_lock_hash() -> None:
    files = framework_files()
    plan = FrameworkArtifactContract().prepare(
        files,
        lockfile=files["package-lock.json"],
        theme_tokens=TOKENS,
    )
    assert plan.profile == FrameworkProfile()
    assert plan.profile.id == "react-mui-native-esbuild/1"
    assert plan.lockfile_sha256
    assert plan.source_tree_sha256
    assert plan.object_refs["hero:title"] == '[data-oey-object="hero:title"]'

    with pytest.raises(ContractError) as external:
        FrameworkArtifactContract().prepare(
            {**files, "src/main.jsx": 'fetch("https://example.com")'},
            lockfile=files["package-lock.json"],
            theme_tokens=TOKENS,
        )
    assert external.value.category.value == "POLICY_BLOCKED"

    with pytest.raises(ContractError) as version:
        FrameworkArtifactContract().prepare(
            {
                **files,
                "package.json": '{"dependencies":{"react":"18.3.1"}}',
            },
            lockfile=files["package-lock.json"],
            theme_tokens=TOKENS,
        )
    assert version.value.category.value == "DETERMINISTIC_FAILURE"


class _BuilderLauncher:
    available = True
    capability_version = "fixture-sandbox/1"

    def run(self, workspace, command, *, limits=None):
        del command, limits
        workspace.write_file(
            WorkspaceScope.WORK, "dist/assets/app.js", b"bundle"
        )
        return SandboxResult(0, b"", b"", False)


def test_native_builder_is_only_a_sandboxed_esbuild_boundary(tmp_path: Path) -> None:
    files = framework_files()
    plan = FrameworkArtifactContract().prepare(
        files,
        lockfile=files["package-lock.json"],
        theme_tokens=TOKENS,
    )
    workspace = WorkspaceManager(tmp_path / "data").open("project", "candidate")
    dependencies = tmp_path / "dependencies"
    dependencies.mkdir()
    builder = NativeEsbuildBuilder(
        launcher=_BuilderLauncher(), dependency_image=dependencies
    )
    first = builder.build(plan, workspace)
    second = builder.build(plan, workspace)
    assert first.dist_tree_sha256 == second.dist_tree_sha256
    assert workspace.read_file(WorkspaceScope.OUT, "assets/app.js") == b"bundle"
    assert "artifact-manifest.json" in first.output_files
