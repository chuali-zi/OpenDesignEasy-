"""Trusted native-esbuild builder boundary for the frozen framework profile."""

from __future__ import annotations

import hashlib
import os
import shutil
import threading
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
    p6_slot = "framework.build"

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
        self._dependency_hash: str | None = None
        self._dependency_hash_lock = threading.Lock()

    @property
    def available(self) -> bool:
        return bool(
            self.launcher.available
            and self.dependency_image is not None
            and self.dependency_image.is_dir()
        )

    @property
    def ready_for_p6(self) -> bool:
        return self.available

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
        dependency_hash = self._frozen_dependency_hash()
        dependencies = workspace.work_root / "node_modules"
        marker = dependencies / ".oeydesign-image-sha256"
        current_hash = (
            marker.read_text(encoding="ascii").strip()
            if marker.is_file() and not marker.is_symlink()
            else ""
        )
        executable_in_image = (
            dependencies / "@esbuild" / "win32-x64" / "esbuild.exe"
        )
        if current_hash != dependency_hash or not executable_in_image.is_file():
            if dependencies.exists():
                shutil.rmtree(dependencies)
            cached = self._cached_dependency_image(workspace, dependency_hash)
            shutil.copytree(cached, dependencies, copy_function=_link_or_copy)
            marker.write_text(dependency_hash, encoding="ascii")
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
        source_html = plan.source_files["index.html"]
        html = source_html.replace(
            'src="/src/main.jsx"', 'src="./assets/app.js"'
        ).replace('src="src/main.jsx"', 'src="./assets/app.js"')
        html = html.encode("utf-8")
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

    def _frozen_dependency_hash(self) -> str:
        with self._dependency_hash_lock:
            if self._dependency_hash is None:
                if self.dependency_image is None:
                    raise ContractError(
                        ErrorCategory.CAPABILITY_UNAVAILABLE,
                        "Frozen framework dependency image is unavailable",
                    )
                self._dependency_hash = _directory_hash(self.dependency_image)
            return self._dependency_hash

    def _cached_dependency_image(
        self, workspace: AgentWorkspace, dependency_hash: str
    ) -> Path:
        if self.dependency_image is None:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Frozen framework dependency image is unavailable",
            )
        workspace_base = workspace.root.parent.parent.resolve()
        cache_root = (workspace_base / "_dependency-cache").resolve()
        cache_name = f"d{dependency_hash[:16]}"
        cached = (cache_root / cache_name).resolve()
        try:
            cached.relative_to(cache_root)
        except ValueError as exc:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Dependency cache escaped the workspace base",
            ) from exc
        marker = cached / ".oeydesign-image-sha256"
        with self._dependency_hash_lock:
            if not marker.is_file() or marker.read_text(encoding="ascii").strip() != (
                dependency_hash
            ):
                if cached.exists():
                    shutil.rmtree(cached)
                cache_root.mkdir(parents=True, exist_ok=True)
                staging = cache_root / f"{cache_name}.tmp"
                if staging.exists():
                    shutil.rmtree(staging)
                try:
                    shutil.copytree(self.dependency_image, staging)
                except OSError as exc:
                    raise ContractError(
                        ErrorCategory.CAPABILITY_UNAVAILABLE,
                        "Frozen dependency image could not be cached",
                    ) from exc
                (staging / ".oeydesign-image-sha256").write_text(
                    dependency_hash, encoding="ascii"
                )
                staging.replace(cached)
        return cached


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


def _link_or_copy(source: str, target: str) -> str:
    try:
        os.link(source, target)
        return target
    except OSError:
        return shutil.copy2(source, target)
