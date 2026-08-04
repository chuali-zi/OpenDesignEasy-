"""P6 sandbox launcher boundary.

The launcher is deliberately separate from the durable workspace/session code.
On the frozen Windows profile the production implementation must create an
AppContainer process, attach it to a Job Object before resume, and use a clean
allowlist environment.  This module exposes that contract on every platform;
the unavailable implementation never falls back to an unsafe host subprocess.
"""

from __future__ import annotations

import hashlib
import os
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import PurePosixPath
from types import MappingProxyType
from typing import Protocol

from .agent_engine import AgentWorkspace, WorkspaceScope
from .domain import ContractError, ErrorCategory


@dataclass(frozen=True, slots=True)
class SandboxLimits:
    max_seconds: float = 900.0
    max_memory_bytes: int = 512 * 1024 * 1024
    max_output_bytes: int = 1_000_000
    max_processes: int = 32

    def __post_init__(self) -> None:
        if (
            self.max_seconds <= 0
            or self.max_memory_bytes <= 0
            or self.max_output_bytes <= 0
            or self.max_processes <= 0
        ):
            raise ValueError("Sandbox limits must be positive")


@dataclass(frozen=True, slots=True)
class SandboxCommand:
    """A shell-free command request for a trusted launcher."""

    executable: str
    args: tuple[str, ...] = ()
    cwd_scope: str = WorkspaceScope.WORK
    cwd: str = "."
    env: Mapping[str, str] = MappingProxyType({})
    capabilities: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if (
            not isinstance(self.executable, str)
            or not self.executable
            or "\x00" in self.executable
            or any(character in self.executable for character in "|;&<>\n\r")
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Sandbox executable is unsafe",
            )
        if self.cwd_scope not in {WorkspaceScope.WORK, WorkspaceScope.OUT}:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Sandbox cwd must be work or out",
            )
        _relative(self.cwd)
        if any(not isinstance(value, str) or "\x00" in value for value in self.args):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Sandbox command arguments are unsafe",
            )
        if any(
            not isinstance(name, str)
            or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", name)
            or not isinstance(value, str)
            or "\x00" in value
            for name, value in self.env.items()
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Sandbox environment is not an allowlist-safe mapping",
            )
        if any(
            not isinstance(capability, str)
            or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", capability)
            for capability in self.capabilities
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Sandbox capability name is unsafe",
            )


@dataclass(frozen=True, slots=True)
class SandboxResult:
    exit_code: int | None
    stdout: bytes
    stderr: bytes
    timed_out: bool
    stdout_truncated: bool = False
    stderr_truncated: bool = False


class SandboxLauncher(Protocol):
    capability_version: str
    available: bool

    def run(
        self,
        workspace: AgentWorkspace,
        command: SandboxCommand,
        *,
        limits: SandboxLimits | None = None,
    ) -> SandboxResult: ...


class UnavailableSandboxLauncher:
    """Fail closed when the native platform launcher is not installed."""

    capability_version = "appcontainer-job-broker/unavailable"
    available = False

    def run(
        self,
        workspace: AgentWorkspace,
        command: SandboxCommand,
        *,
        limits: SandboxLimits | None = None,
    ) -> SandboxResult:
        del workspace, command, limits
        raise ContractError(
            ErrorCategory.CAPABILITY_UNAVAILABLE,
            "Native AppContainer sandbox launcher is unavailable",
        )


class WindowsAppContainerLauncher:
    """Zero-capability AppContainer launcher with pre-resume Job assignment."""

    capability_version = "appcontainer-job-broker/1"
    available = os.name == "nt"

    def __init__(self, profile_name: str = "OEYdesign.Phase6") -> None:
        if not re.fullmatch(r"[A-Za-z0-9.]{1,64}", profile_name):
            raise ValueError("Unsafe AppContainer profile name")
        self.profile_name = profile_name
        self.last_profile_sid: str | None = None
        self.last_drive: str | None = None

    @property
    def package_root(self):
        if not self.available:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Windows AppContainer is unavailable on this platform",
            )
        from ._windows_appcontainer import ensure_profile

        return ensure_profile(self.profile_name)[2]

    def workspace_base(self, data_root: str | os.PathLike[str]):
        digest = hashlib.sha256(
            os.path.normcase(os.path.abspath(data_root)).encode("utf-8")
        ).hexdigest()[:8]
        return self.package_root / "p6" / digest

    def run(
        self,
        workspace: AgentWorkspace,
        command: SandboxCommand,
        *,
        limits: SandboxLimits | None = None,
    ) -> SandboxResult:
        if not self.available:
            return UnavailableSandboxLauncher().run(workspace, command, limits=limits)
        if command.capabilities:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Agent and build commands must use a zero-capability AppContainer",
            )
        selected = limits or SandboxLimits()
        root = workspace.root.resolve()
        try:
            root.relative_to(self.package_root)
        except ValueError as exc:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Sandbox workspace must be inside the AppContainer package directory",
            ) from exc
        cwd = workspace._target(command.cwd_scope, command.cwd)
        executable_input = command.executable.replace("\\", "/")
        executable_path = PurePosixPath(executable_input)
        if (
            executable_path.is_absolute()
            or any(part in {"", ".", ".."} for part in executable_path.parts)
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Sandbox executable must be a workspace-relative file",
            )
        executable = (cwd / os.fspath(executable_path)).resolve()
        try:
            executable.relative_to(root)
        except ValueError as exc:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Sandbox executable escaped the workspace",
            ) from exc
        if not executable.is_file() or executable.is_symlink():
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Sandbox executable is unavailable inside the dependency image",
            )
        output_directory = workspace.agent_root / "launcher" / str(time.time_ns())
        environment = {
            key: os.environ[key]
            for key in (
                "COMSPEC",
                "LOCALAPPDATA",
                "OS",
                "PATH",
                "PATHEXT",
                "SYSTEMROOT",
                "TEMP",
                "TMP",
                "WINDIR",
            )
            if key in os.environ
        }
        environment.update(command.env)
        from ._windows_appcontainer import run_process

        try:
            native = run_process(
                profile_name=self.profile_name,
                workspace_root=root,
                executable_relative=executable.relative_to(root),
                args=command.args,
                cwd_relative=cwd.relative_to(root),
                env=environment,
                timeout_seconds=selected.max_seconds,
                memory_limit_bytes=selected.max_memory_bytes,
                process_limit=selected.max_processes,
                output_directory=output_directory,
            )
        except OSError as exc:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Native AppContainer process creation failed",
                details={"winerror": getattr(exc, "winerror", None)},
            ) from exc
        self.last_profile_sid = native.profile_sid
        self.last_drive = native.drive
        stdout, stdout_truncated = _bounded_output(
            native.stdout_path, selected.max_output_bytes
        )
        stderr, stderr_truncated = _bounded_output(
            native.stderr_path, selected.max_output_bytes
        )
        return SandboxResult(
            native.exit_code,
            stdout,
            stderr,
            native.timed_out,
            stdout_truncated,
            stderr_truncated,
        )


def default_sandbox_launcher() -> SandboxLauncher:
    if os.name == "nt":
        return WindowsAppContainerLauncher()
    return UnavailableSandboxLauncher()


def _relative(value: str) -> str:
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        raise ContractError(
            ErrorCategory.POLICY_BLOCKED,
            "Sandbox path is unsafe",
        )
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        if value != ".":
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Sandbox path must stay within its scope",
            )
    return path.as_posix()


def _bounded_output(path, limit: int) -> tuple[bytes, bool]:
    try:
        with path.open("rb") as stream:
            payload = stream.read(limit + 1)
    except OSError:
        return b"", False
    return payload[:limit], len(payload) > limit
