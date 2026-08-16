from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from oeydesign.composition import SQLiteApplication
from oeydesign.domain import (
    ContextRequirements,
    ContractError,
    CreateProject,
    DesignBrief,
    RightsStatus,
    SourceKind,
    SourceLocator,
    constraint_profile,
)


def create_project(
    app: SQLiteApplication, project_id: str = "repository-project"
) -> None:
    app.control.execute(
        CreateProject(
            command_id=f"{project_id}:create",
            project_id=project_id,
            name="Repository P6 fixture",
        )
    )


def make_repository(root: Path) -> None:
    (root / "src").mkdir(parents=True)
    (root / "src" / "main.py").write_text(
        "def render():\n    return 'stable'\n", encoding="utf-8"
    )
    (root / "README.md").write_text("# Fixture\n", encoding="utf-8")
    (root / ".git").mkdir()
    (root / ".git" / "config").write_text("secret git metadata", encoding="utf-8")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "hidden.js").write_text("hidden", encoding="utf-8")
    (root / "dist").mkdir()
    (root / "dist" / "bundle.js").write_text("built", encoding="utf-8")
    (root / ".env").write_text("TOKEN=do-not-copy", encoding="utf-8")
    (root / "private.pem").write_text("PRIVATE KEY", encoding="utf-8")


def test_authorized_repository_snapshot_has_safe_file_line_evidence_and_recovers(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    database = data_root / "application.sqlite"
    user_repo = tmp_path / "user-repo"
    make_repository(user_repo)
    original_main = (user_repo / "src" / "main.py").read_bytes()

    with SQLiteApplication(database, data_root=data_root) as app:
        create_project(app)
        authorization = app.repository_ingestion.authorize(user_repo)
        result = app.repository_ingestion.ingest_repository(
            "repository-project", authorization
        )
        source = result.source
        assert source.kind is SourceKind.CODE_REPOSITORY
        assert source.rights is RightsStatus.ANALYSIS_ONLY
        assert {item.path for item in result.files} == {"README.md", "src/main.py"}
        assert all("TOKEN" not in repr(record.value) for record in result.observations)

        main_record = next(
            record
            for record in result.observations
            if record.value.get("path") == "src/main.py"
        )
        assert main_record.locator.selector == {
            "path": "src/main.py",
            "line_start": 1,
            "line_end": 3,
        }
        resolved_source, payload = app.evidence.resolve(
            "repository-project", main_record.locator
        )
        assert resolved_source == source
        assert payload == (user_repo / "src" / "main.py").read_bytes()

        brief = app.evidence.confirm_brief(
            app.evidence.draft_brief(
                "repository-project",
                DesignBrief("Build a workbench", "designers", "web"),
            )
        )
        constraints = app.evidence.confirm_constraints(
            app.evidence.draft_constraints("repository-project", constraint_profile())
        )
        package = app.context_assembler.assemble(
            project_id="repository-project",
            sources=(source,),
            evidence=result.observations,
            requirements=ContextRequirements(),
            brief=brief,
            constraints=constraints,
            revision=1,
        )
        app.evidence_repository.save_context(package)
        assert any(
            locator.selector.get("path") == "src/main.py"
            for locator in package.analysis_asset_refs
        )

        # The user's tree is never the persisted snapshot.
        (user_repo / "src" / "main.py").write_text("changed\n", encoding="utf-8")

    with SQLiteApplication(database, data_root=data_root) as reopened:
        source = reopened.evidence_repository.get_source(source.id)
        records = reopened.evidence_repository.list_evidence("repository-project")
        main_record = next(
            record
            for record in records
            if record.value.get("path") == "src/main.py"
        )
        _, payload = reopened.evidence.resolve(
            "repository-project", main_record.locator
        )
        assert payload == original_main
        assert (
            reopened.evidence_repository.latest_context("repository-project")
            == package
        )
        assert source.sha256_digest == result.source.sha256_digest


def test_repository_ingestion_ignores_local_runtime_artifacts_without_dropping_assets(
    tmp_path: Path,
) -> None:
    git = shutil.which("git")
    if git is None:
        pytest.skip("Git is unavailable")
    data_root = tmp_path / "data-root"
    database = data_root / "repository.sqlite"
    user_repo = tmp_path / "oeydesign-like"
    (user_repo / "src").mkdir(parents=True)
    (user_repo / "src" / "main.py").write_text("print('safe')\n")
    (user_repo / "README.md").write_text("# fixture\n")
    (user_repo / ".gitignore").write_text(
        "data/\npytest_tmp/\n.ruff_cache/\nnul\n", encoding="utf-8"
    )
    subprocess.run(
        [git, "init", "--quiet", str(user_repo)],
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    (user_repo / "package-lock.json").write_text('{"lockfileVersion":3}\n')
    (user_repo / "public").mkdir()
    (user_repo / "public" / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\nfixture")
    (user_repo / "data").mkdir()
    (user_repo / "data" / "oeydesign.sqlite").write_text("volatile", encoding="utf-8")
    (user_repo / "pytest_tmp").mkdir()
    (user_repo / "pytest_tmp" / "screenshot.png").write_bytes(b"changing")
    (user_repo / ".ruff_cache").mkdir()
    (user_repo / ".ruff_cache" / "cache").write_text("cache")
    (user_repo / "src" / "oeydesign.egg-info").mkdir()
    (user_repo / "src" / "oeydesign.egg-info" / "PKG-INFO").write_text("cache")

    with SQLiteApplication(database, data_root=data_root) as app:
        create_project(app, "runtime-artifacts-project")
        result = app.repository_ingestion.ingest_repository(
            "runtime-artifacts-project",
            app.repository_ingestion.authorize(user_repo),
        )

    paths = {item.path for item in result.files}
    assert "package-lock.json" in paths
    assert "public/logo.png" in paths
    assert not any(path.startswith("data/") for path in paths)
    assert not any(path.startswith("pytest_tmp/") for path in paths)
    assert not any(path.startswith(".ruff_cache/") for path in paths)
    assert not any(path.endswith(".egg-info/PKG-INFO") for path in paths)


def test_repository_authorization_and_locator_escape_are_hard_failures(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    database = data_root / "security.sqlite"
    user_repo = tmp_path / "repo"
    make_repository(user_repo)

    with SQLiteApplication(database, data_root=data_root) as app:
        create_project(app, "security-project")
        with pytest.raises(ContractError) as direct_path:
            app.repository_ingestion.ingest_repository("security-project", user_repo)  # type: ignore[arg-type]
        assert direct_path.value.category.value == "POLICY_BLOCKED"

        result = app.repository_ingestion.ingest_repository(
            "security-project", app.repository_ingestion.authorize(user_repo)
        )
        valid = next(
            record
            for record in result.observations
            if record.value.get("path") == "src/main.py"
        )
        with pytest.raises(ContractError) as escape:
            app.repository_ingestion.read_file(
                result.source,
                SourceLocator(result.source.id, 1, {"path": "../outside.py"}),
            )
        assert escape.value.category.value == "POLICY_BLOCKED"
        assert app.repository_ingestion.read_file(result.source, valid.locator)

    link = tmp_path / "repo-link"
    try:
        os.symlink(user_repo, link, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symbolic links are unavailable in this environment")
    with SQLiteApplication(
        tmp_path / "link-data" / "link.sqlite", data_root=tmp_path / "link-data"
    ) as app:
        with pytest.raises(ContractError) as symlink:
            app.repository_ingestion.authorize(link)
        assert symlink.value.category.value == "POLICY_BLOCKED"
