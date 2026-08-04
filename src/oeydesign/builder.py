"""Trusted native-esbuild builder boundary for the frozen framework profile."""

from __future__ import annotations

import hashlib
import os
import shutil
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from .agent_engine import AgentWorkspace, WorkspaceScope
from .domain import ContractError, ErrorCategory, canonical_json
from .framework_artifact import FrameworkArtifactPlan
from .sandbox import SandboxCommand, SandboxLauncher


@dataclass(frozen=True, slots=True)
class FrameworkBuildResult:
    capability_version: str
    profile_id: str
    source_tree_sha256: str
    lockfile_sha256: str
    dependency_tree_sha256: str
    dist_tree_sha256: str
    output_files: Mapping[str, str]
    stdout: str
    stderr: str


class NativeEsbuildBuilder:
    """Materializes a plan and invokes esbuild only through a native launcher."""

    capability_version = "native-esbuild/1"

    def __init__(
        self,
        *,
        executable: str = "esbuild",
        launcher: SandboxLauncher | None = None,
        dependency_image: str | Path | None = None,
    ) -> None:
        if not executable:
            raise ValueError("esbuild executable is required")
        if launcher is None:
            from .sandbox import default_sandbox_launcher

            launcher = default_sandbox_launcher()
        configured_image = dependency_image or os.environ.get(
            "OEYDESIGN_FRAMEWORK_DEPENDENCIES"
        )
        self.dependency_image = (
            Path(configured_image).resolve() if configured_image else None
        )
        self.executable = executable
        self.launcher = launcher

    @property
    def available(self) -> bool:
        return bool(
            self.launcher.available
            and self.dependency_image is not None
            and self.dependency_image.is_dir()
        )

    def build(
        self,
        plan: FrameworkArtifactPlan,
        workspace: AgentWorkspace,
        *,
        entrypoint: str = "src/main.jsx",
    ) -> FrameworkBuildResult:
        if entrypoint not in plan.source_files:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework entrypoint is not in the prepared source tree",
            )
        _safe_relative(entrypoint)
        for path, content in plan.source_files.items():
            workspace.write_file(WorkspaceScope.WORK, path, content.encode("utf-8"))
        if self.dependency_image is None or not self.dependency_image.is_dir():
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Frozen framework dependency image is unavailable",
            )
        dependencies = workspace.work_root / "node_modules"
        if dependencies.exists():
            shutil.rmtree(dependencies)
        shutil.copytree(self.dependency_image, dependencies)
        dependency_hash = _directory_hash(dependencies)
        output_path = "dist/assets/app.js"
        executable = self.executable
        if executable == "esbuild":
            executable = "node_modules/@esbuild/win32-x64/esbuild.exe"
        command = SandboxCommand(
            executable,
            (
                entrypoint,
                "--bundle",
                "--format=esm",
                "--platform=browser",
                "--jsx=automatic",
                "--minify",
                f"--outfile={output_path}",
            ),
            cwd_scope=WorkspaceScope.WORK,
        )
        result = self.launcher.run(workspace, command)
        if result.timed_out or result.exit_code != 0:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Native esbuild failed",
                details={
                    "exit_code": result.exit_code,
                    "timed_out": result.timed_out,
                },
            )
        bundle = workspace.read_file(WorkspaceScope.WORK, output_path)
        html = plan.source_files["index.html"].encode("utf-8")
        workspace.write_file(WorkspaceScope.WORK, "dist/index.html", html)
        workspace.write_file(WorkspaceScope.OUT, "assets/app.js", bundle)
        workspace.write_file(WorkspaceScope.OUT, "index.html", html)
        manifest = {
            "version": 1,
            "capability_version": self.capability_version,
            "profile": plan.profile.id,
            "source_tree_sha256": plan.source_tree_sha256,
            "lockfile_sha256": plan.lockfile_sha256,
            "dependency_tree_sha256": dependency_hash,
            "dist_files": {
                "assets/app.js": hashlib.sha256(bundle).hexdigest(),
                "index.html": hashlib.sha256(html).hexdigest(),
            },
        }
        manifest_payload = canonical_json(manifest).encode("utf-8")
        workspace.write_file(
            WorkspaceScope.OUT,
            "artifact-manifest.json",
            manifest_payload,
        )
        output_files = MappingProxyType(
            {
                "assets/app.js": hashlib.sha256(bundle).hexdigest(),
                "index.html": hashlib.sha256(html).hexdigest(),
                "artifact-manifest.json": hashlib.sha256(manifest_payload).hexdigest(),
            }
        )
        dist_hash = _tree_hash(
            {
                path: workspace.read_file(WorkspaceScope.OUT, path)
                for path in output_files
            }
        )
        return FrameworkBuildResult(
            self.capability_version,
            plan.profile.id,
            plan.source_tree_sha256,
            plan.lockfile_sha256,
            dependency_hash,
            dist_hash,
            output_files,
            _bounded_text(result.stdout),
            _bounded_text(result.stderr),
        )


def _safe_relative(value: str) -> None:
    if (
        not value
        or "\x00" in value
        or "\\" in value
        or value.startswith("/")
        or any(part in {"", ".", ".."} for part in value.split("/"))
    ):
        raise ContractError(
            ErrorCategory.POLICY_BLOCKED,
            "Framework build path must be relative",
        )


def _tree_hash(files: Mapping[str, bytes]) -> str:
    entries = [
        (path, hashlib.sha256(content).hexdigest())
        for path, content in sorted(files.items())
    ]
    return hashlib.sha256(canonical_json(entries).encode("utf-8")).hexdigest()


def _directory_hash(root: Path) -> str:
    return _tree_hash(
        {
            path.relative_to(root).as_posix(): path.read_bytes()
            for path in sorted(root.rglob("*"))
            if path.is_file() and not path.is_symlink()
        }
    )


def _bounded_text(payload: bytes, limit: int = 32_000) -> str:
    return payload[:limit].decode("utf-8", "replace")
