"""Persistent P6 workspace/session and trusted tool-loop primitives."""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any, Protocol

from .domain import ContractError, ErrorCategory, SourceAsset, SourceLocator, stable_id
from .repository import RepositoryFileSummary

if TYPE_CHECKING:
    from .capabilities import CapabilityClient, ProviderResponse
    from .renderer import TrustedWebRenderer
    from .sandbox import SandboxCommand, SandboxLauncher, SandboxLimits, SandboxResult


class RepositorySnapshotReader(Protocol):
    def list_files(self, source: SourceAsset) -> tuple[RepositoryFileSummary, ...]: ...

    def read_file(self, source: SourceAsset, locator: SourceLocator) -> bytes: ...


class WorkspaceScope:
    REPO = "repo"
    WORK = "work"
    OUT = "out"
    AGENT = ".agent"


_WRITE_SCOPES = frozenset({WorkspaceScope.WORK, WorkspaceScope.OUT})
_ALL_SCOPES = frozenset(
    {WorkspaceScope.REPO, WorkspaceScope.WORK, WorkspaceScope.OUT, WorkspaceScope.AGENT}
)


@dataclass(frozen=True, slots=True)
class AgentBudget:
    max_steps: int = 60
    max_total_tokens: int = 250_000
    max_seconds: float = 900.0
    max_renders: int = 3
    steps: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    elapsed_seconds: float = 0.0
    renders: int = 0

    def __post_init__(self) -> None:
        if (
            self.max_steps <= 0
            or self.max_total_tokens <= 0
            or self.max_seconds <= 0
            or self.max_renders < 0
            or min(
                self.steps,
                self.prompt_tokens,
                self.completion_tokens,
                self.reasoning_tokens,
                self.elapsed_seconds,
                self.renders,
            )
            < 0
        ):
            raise ValueError("Agent budget limits and counters must be non-negative")

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens + self.reasoning_tokens

    def charge(
        self,
        *,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        reasoning_tokens: int = 0,
        elapsed_seconds: float = 0.0,
        render: bool = False,
    ) -> AgentBudget:
        values = (
            prompt_tokens,
            completion_tokens,
            reasoning_tokens,
            elapsed_seconds,
        )
        if any(value < 0 for value in values):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Budget charges cannot be negative",
            )
        candidate = replace(
            self,
            steps=self.steps + 1,
            prompt_tokens=self.prompt_tokens + prompt_tokens,
            completion_tokens=self.completion_tokens + completion_tokens,
            reasoning_tokens=self.reasoning_tokens + reasoning_tokens,
            elapsed_seconds=self.elapsed_seconds + elapsed_seconds,
            renders=self.renders + int(render),
        )
        if candidate.steps > candidate.max_steps:
            raise _budget("step limit exhausted")
        if candidate.total_tokens > candidate.max_total_tokens:
            raise _budget("token limit exhausted")
        if candidate.elapsed_seconds > candidate.max_seconds:
            raise _budget("wall-clock limit exhausted")
        if candidate.renders > candidate.max_renders:
            raise _budget("render limit exhausted")
        return candidate


@dataclass(frozen=True, slots=True)
class AgentTurn:
    sequence: int
    tool: str
    outcome: str
    path_hash: str | None = None
    input_bytes: int = 0
    output_bytes: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    elapsed_seconds: float = 0.0
    render: bool = False


@dataclass(frozen=True, slots=True)
class AgentSession:
    id: str
    project_id: str
    workspace_id: str
    status: str
    stage: str
    capability_version: str
    budget: AgentBudget
    turns: tuple[AgentTurn, ...] = ()
    started_at: float = 0.0
    updated_at: float = 0.0


@dataclass(frozen=True, slots=True)
class AgentRunResult:
    session: AgentSession
    completed: bool
    last_render_healthy: bool
    errors: tuple[str, ...] = ()


class AgentLoop:
    """Small tool-calling loop that consumes the durable session boundary.

    The provider receives a JSON action envelope rather than a vendor-specific
    tool schema.  Tool results stay in memory for the current call; the
    session store records only hashes, byte counts, and error labels.
    """

    capability_version = "agent-loop/1"

    def __init__(
        self,
        client: CapabilityClient,
        *,
        renderer: TrustedWebRenderer | None = None,
        session_manager: AgentSessionManager | None = None,
        sandbox_launcher: SandboxLauncher | None = None,
        build_action: Callable[[AgentWorkspace], Any] | None = None,
        allowed_tools: frozenset[str] | None = None,
        validation_only: bool = False,
        boundary_check: Callable[[str], Any] | None = None,
    ) -> None:
        if sandbox_launcher is None:
            from .sandbox import default_sandbox_launcher

            sandbox_launcher = default_sandbox_launcher()
        self.client = client
        self.renderer = renderer
        self.sessions = session_manager or AgentSessionManager()
        self.sandbox = sandbox_launcher
        self.build_action = build_action
        self.allowed_tools = allowed_tools
        self.validation_only = validation_only
        self.last_render_result: Any | None = None
        self.boundary_check = boundary_check

    def run(
        self,
        workspace: AgentWorkspace,
        session_id: str,
        *,
        goal: str,
        model: str,
        context: Mapping[str, Any] | None = None,
        max_tokens: int = 32_000,
        temperature: float = 1.0,
    ) -> AgentRunResult:
        if not goal.strip() or not model.strip():
            raise _invalid("Agent loop requires a goal and model")
        session = self.sessions.load(workspace, session_id)
        if session.status in {"PAUSED", "RETRY_WAIT"}:
            session = self.sessions.resume(workspace, session_id)
        if session.status != "RUNNING":
            raise _invalid("Agent loop requires a running session")
        allowed_tool_text = (
            ", ".join(sorted(self.allowed_tools))
            if self.allowed_tools is not None
            else (
                "read_file, list_files, read_repo, write_file, delete_file, "
                "run_command, run_build, render, complete"
            )
        )
        messages: list[Mapping[str, Any]] = [
            {
                "role": "system",
                "content": (
                    "Return only JSON: {\"actions\":[...],\"done\":false}. "
                    "Every action must be an object, for example "
                    "{\"actions\":[{\"tool\":\"run_build\"}],\"done\":false}. "
                    f"Allowed actions in this session are: {allowed_tool_text}. "
                    "Use run_build before render when it is available."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {"goal": goal, "context": dict(context or {})},
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            },
        ]
        errors: list[str] = []
        last_render_healthy: bool | None = None
        last_build_hash: str | None = None
        render_build_hash: str | None = None
        screenshot_reviewed = True
        screenshot_pending = False
        while True:
            for attempt in range(3):
                try:
                    if self.boundary_check is not None:
                        self.boundary_check("provider-request")
                    response = self.client.chat(
                        messages,
                        model=model,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        stream=True,
                    )
                    if self.boundary_check is not None:
                        self.boundary_check("provider-response")
                    break
                except ContractError as exc:
                    if exc.category is not ErrorCategory.RETRYABLE or attempt == 2:
                        raise
                    time.sleep(2**attempt)
            try:
                document = _action_document(response.content)
            except ContractError as exc:
                errors.append(exc.category.value)
                messages = _append_tool_result(
                    messages,
                    "protocol",
                    {
                        "ok": False,
                        "error": str(exc),
                        "required": (
                            "Return JSON with actions as a list of objects, each "
                            "containing a tool field."
                        ),
                    },
                )
                self._record_model_turn(
                    workspace,
                    session_id,
                    response,
                    outcome="protocol_error",
                )
                continue
            reviewed_screenshot_this_turn = screenshot_pending
            if screenshot_pending:
                screenshot_reviewed = True
                screenshot_pending = False
                messages = _scrub_render_images(messages)
            if reviewed_screenshot_this_turn and self.validation_only:
                if last_render_healthy is True:
                    self._record_model_turn(
                        workspace,
                        session_id,
                        response,
                        outcome="complete",
                    )
                    session = self.sessions.complete(workspace, session_id)
                    return AgentRunResult(
                        session, True, last_render_healthy, tuple(errors)
                    )
                raise _invalid(
                    "Validation-only review received an unhealthy screenshot"
                )
            actions = document["actions"]
            if not actions:
                if document.get("done") is True:
                    completion_error = _completion_error(
                        last_render_healthy=last_render_healthy,
                        build_required=self.build_action is not None,
                        last_build_hash=last_build_hash,
                        render_build_hash=render_build_hash,
                        screenshot_reviewed=screenshot_reviewed,
                    )
                    if completion_error:
                        errors.append(completion_error)
                        messages = _append_tool_result(
                            messages,
                            "complete",
                            {"ok": False, "error": errors[-1]},
                        )
                        self._record_model_turn(
                            workspace,
                            session_id,
                            response,
                            outcome="validation_failed",
                        )
                        session = self.sessions.load(workspace, session_id)
                        continue
                    self._record_model_turn(
                        workspace,
                        session_id,
                        response,
                        outcome="complete",
                    )
                    session = self.sessions.complete(workspace, session_id)
                    return AgentRunResult(
                        session, True, last_render_healthy, tuple(errors)
                    )
                errors.append("provider returned no actions")
                messages = _append_tool_result(
                    messages,
                    "protocol",
                    {"ok": False, "error": errors[-1]},
                )
                self._record_model_turn(
                    workspace,
                    session_id,
                    response,
                    outcome="protocol_error",
                )
                continue

            usage = _usage_values(response.usage)
            for index, action in enumerate(actions):
                tool = action.get("tool")
                if self.boundary_check is not None:
                    self.boundary_check(f"tool:{tool or 'invalid'}")
                if self.validation_only and tool == "render":
                    action = {
                        "tool": "render",
                        "scope": WorkspaceScope.OUT,
                        "entry": "index.html",
                    }
                try:
                    result, is_render, path, input_bytes, output_bytes = self._execute(
                        workspace, action
                    )
                    if tool in {"write_file", "delete_file", "run_command"}:
                        last_build_hash = None
                        render_build_hash = None
                        last_render_healthy = None
                        if self.build_action is not None:
                            screenshot_reviewed = False
                    if tool == "run_build" and result.get("ok"):
                        last_build_hash = str(result["dist_tree_sha256"])
                        render_build_hash = None
                        last_render_healthy = None
                        screenshot_reviewed = False
                    if is_render:
                        if self.build_action is not None and last_build_hash is None:
                            raise _invalid(
                                "render requires a fresh successful run_build"
                            )
                        last_render_healthy = bool(result.get("healthy"))
                        render_build_hash = last_build_hash
                        screenshot_pending = bool(result.get("screenshot_data_url"))
                    outcome = "ok"
                except ContractError as exc:
                    result = {
                        "ok": False,
                        "error": str(exc),
                        "category": exc.category.value,
                    }
                    errors.append(exc.category.value)
                    is_render = tool == "render"
                    path = (
                        action.get("path")
                        if isinstance(action.get("path"), str)
                        else None
                    )
                    input_bytes = 0
                    output_bytes = 0
                    outcome = exc.category.value
                session = self.sessions.record_turn(
                    workspace,
                    session_id,
                    tool=str(tool or "invalid"),
                    outcome=outcome,
                    path=path,
                    input_bytes=input_bytes,
                    output_bytes=output_bytes,
                    prompt_tokens=usage["prompt_tokens"] if index == 0 else 0,
                    completion_tokens=usage["completion_tokens"] if index == 0 else 0,
                    reasoning_tokens=usage["reasoning_tokens"] if index == 0 else 0,
                    elapsed_seconds=response.elapsed_seconds if index == 0 else 0.0,
                    render=is_render,
                )
                visible_result = result
                if is_render and result.get("screenshot_data_url"):
                    visible_result = dict(result)
                    visible_result.pop("screenshot_data_url", None)
                messages = _append_tool_result(
                    messages, str(tool or "invalid"), visible_result
                )
                if is_render and result.get("screenshot_data_url"):
                    messages = _append_render_image(
                        messages,
                        str(result["screenshot_data_url"]),
                        validation_only=self.validation_only,
                    )

            if document.get("done") is True:
                completion_error = _completion_error(
                    last_render_healthy=last_render_healthy,
                    build_required=self.build_action is not None,
                    last_build_hash=last_build_hash,
                    render_build_hash=render_build_hash,
                    screenshot_reviewed=screenshot_reviewed,
                )
                if completion_error is None:
                    session = self.sessions.complete(workspace, session_id)
                    return AgentRunResult(
                        session, True, last_render_healthy, tuple(errors)
                    )
                messages = _append_tool_result(
                    messages,
                    "complete",
                    {
                        "ok": False,
                        "error": completion_error,
                    },
                )

    def _record_model_turn(
        self,
        workspace: AgentWorkspace,
        session_id: str,
        response: ProviderResponse,
        *,
        outcome: str,
    ) -> None:
        usage = _usage_values(response.usage)
        self.sessions.record_turn(
            workspace,
            session_id,
            tool="model",
            outcome=outcome,
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            reasoning_tokens=usage["reasoning_tokens"],
            elapsed_seconds=response.elapsed_seconds,
        )

    def _execute(
        self,
        workspace: AgentWorkspace,
        action: Mapping[str, Any],
    ) -> tuple[Any, bool, str | None, int, int]:
        tool = action.get("tool")
        if not isinstance(tool, str):
            raise _invalid("Agent action requires a tool")
        if self.allowed_tools is not None and tool not in self.allowed_tools:
            raise _policy(f"Tool is not enabled for this session: {tool}")
        scope = action.get("scope", WorkspaceScope.WORK)
        path = action.get("path", "")
        if not isinstance(scope, str) or not isinstance(path, str):
            raise _policy("Agent tool scope and path must be text")
        if tool in {"read_file", "read_repo"}:
            selected_scope = WorkspaceScope.REPO if tool == "read_repo" else scope
            payload = workspace.read_file(selected_scope, path)
            return (
                {"ok": True, "path": path, "content": _bounded_text(payload)},
                False,
                path,
                0,
                len(payload),
            )
        if tool == "list_files":
            files = workspace.list_files(scope)
            return {"ok": True, "files": files}, False, None, 0, len(files)
        if tool == "write_file":
            _require_agent_editable(path)
            content = action.get("content")
            if not isinstance(content, str):
                raise _policy("write_file requires text content")
            payload = content.encode("utf-8")
            workspace.write_file(scope, path, payload)
            return {"ok": True, "bytes": len(payload)}, False, path, len(payload), 0
        if tool == "delete_file":
            _require_agent_editable(path)
            workspace.delete_file(scope, path)
            return {"ok": True}, False, path, 0, 0
        if tool == "run_command":
            from .sandbox import SandboxCommand

            executable = action.get("executable")
            args = action.get("args", ())
            if not isinstance(executable, str) or not isinstance(args, list | tuple):
                raise _policy("run_command requires an executable and argument list")
            command = SandboxCommand(
                executable,
                tuple(str(value) for value in args),
                cwd_scope=scope,
                cwd=path or ".",
            )
            result = self.sandbox.run(workspace, command)
            output = result.stdout + result.stderr
            return (
                {
                    "ok": result.exit_code == 0 and not result.timed_out,
                    "exit_code": result.exit_code,
                    "timed_out": result.timed_out,
                    "stdout": _bounded_text(result.stdout),
                    "stderr": _bounded_text(result.stderr),
                },
                False,
                path or None,
                0,
                len(output),
            )
        if tool == "run_build":
            if self.build_action is None:
                raise _capability("No trusted framework builder is configured")
            build = self.build_action(workspace)
            return (
                {
                    "ok": True,
                    "capability_version": build.capability_version,
                    "source_tree_sha256": build.source_tree_sha256,
                    "lockfile_sha256": build.lockfile_sha256,
                    "dependency_tree_sha256": build.dependency_tree_sha256,
                    "dist_tree_sha256": build.dist_tree_sha256,
                    "output_files": dict(build.output_files),
                    "stdout": build.stdout,
                    "stderr": build.stderr,
                },
                False,
                None,
                0,
                len(build.stdout.encode()) + len(build.stderr.encode()),
            )
        if tool == "render":
            if self.renderer is None:
                raise _capability("No trusted renderer is configured")
            if scope not in {WorkspaceScope.WORK, WorkspaceScope.OUT}:
                raise _policy("Renderer may only inspect work or out")
            entry = action.get("entry", "index.html")
            if not isinstance(entry, str):
                raise _policy("render requires a text entry path")
            result = self.renderer.render(workspace._base(scope), entry)
            self.last_render_result = result
            screenshot_data_url = None
            screenshot_bytes = 0
            screenshot_path = getattr(result, "screenshot_path", None)
            if screenshot_path:
                import base64

                screenshot = Path(screenshot_path).read_bytes()
                screenshot_bytes = len(screenshot)
                screenshot_data_url = (
                    "data:image/png;base64,"
                    + base64.b64encode(screenshot).decode("ascii")
                )
            return (
                {
                    "ok": result.healthy,
                    "render_id": result.id,
                    "healthy": result.healthy,
                    "screenshot_sha256": getattr(result, "screenshot_sha256", None),
                    "screenshot_data_url": screenshot_data_url,
                    "chrome_version": getattr(result, "chrome_version", None),
                    "console_errors": getattr(result, "console_errors", ()),
                    "page_errors": getattr(result, "page_errors", ()),
                    "failed_requests": getattr(result, "failed_requests", ()),
                    "dom_metrics": dict(getattr(result, "dom_metrics", {})),
                },
                True,
                entry,
                0,
                screenshot_bytes,
            )
        if tool == "complete":
            return {"ok": True}, False, None, 0, 0
        raise _policy(f"Unknown agent tool: {tool}")

def _action_document(content: str) -> dict[str, Any]:
    candidate = content.strip() if isinstance(content, str) else content
    if isinstance(candidate, str) and candidate.startswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            candidate = "\n".join(lines[1:-1]).strip()
    try:
        document = json.loads(candidate)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ContractError(
            ErrorCategory.RETRYABLE,
            "Provider response is not a JSON agent action envelope",
        ) from exc
    if not isinstance(document, dict) or not isinstance(document.get("actions"), list):
        raise ContractError(
            ErrorCategory.RETRYABLE,
            "Agent action envelope has an invalid shape",
        )
    actions: list[Mapping[str, Any]] = []
    for action in document["actions"]:
        if not isinstance(action, Mapping):
            raise ContractError(
                ErrorCategory.RETRYABLE,
                "Agent action must be an object",
            )
        actions.append(action)
    document["actions"] = actions
    return document


def _require_agent_editable(path: str) -> None:
    normalized = path.replace("\\", "/").casefold()
    if normalized in {"package.json", "package-lock.json"} or normalized.startswith(
        ("node_modules/", ".agent/", "dist/")
    ):
        raise _policy("Agent cannot edit the frozen framework or build output")


def _append_tool_result(
    messages: list[Mapping[str, Any]], tool: str, result: Mapping[str, Any]
) -> list[Mapping[str, Any]]:
    updated = list(messages)
    updated.append(
        {
            "role": "user",
            "content": (
                f"Trusted tool result for {tool}: "
                + json.dumps(result, ensure_ascii=False, separators=(",", ":"))
            ),
        }
    )
    return updated


def _append_render_image(
    messages: list[Mapping[str, Any]],
    screenshot_data_url: str,
    *,
    validation_only: bool = False,
) -> list[Mapping[str, Any]]:
    updated = list(messages)
    updated.append(
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Inspect this exact trusted Chrome screenshot. This is a "
                        "validation-only session: do not call another tool; return "
                        'exactly {"actions":[],"done":true} after inspection.'
                        if validation_only
                        else "Inspect the screenshot, edit if needed, and complete "
                        "only when it satisfies the goal."
                    ),
                },
                {"type": "image_url", "image_url": {"url": screenshot_data_url}},
            ],
        }
    )
    return updated


def _scrub_render_images(
    messages: list[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    updated: list[Mapping[str, Any]] = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            updated.append(message)
            continue
        if not any(
            isinstance(part, Mapping) and part.get("type") == "image_url"
            for part in content
        ):
            updated.append(message)
            continue
        updated.append(
            {
                "role": message.get("role", "user"),
                "content": "Trusted Chrome screenshot was delivered and inspected.",
            }
        )
    return updated


def _completion_error(
    *,
    last_render_healthy: bool | None,
    build_required: bool,
    last_build_hash: str | None,
    render_build_hash: str | None,
    screenshot_reviewed: bool,
) -> str | None:
    if build_required and last_build_hash is None:
        return "complete requires a successful trusted run_build"
    if last_render_healthy is not True:
        return "complete requires a healthy trusted Chrome render"
    if build_required and render_build_hash != last_build_hash:
        return "complete requires a render of the latest successful build"
    if not screenshot_reviewed:
        return "complete requires a model turn after the Chrome screenshot"
    return None


def _usage_values(usage: Mapping[str, int]) -> dict[str, int]:
    return {
        key: max(0, int(usage.get(key, 0)))
        for key in ("prompt_tokens", "completion_tokens", "reasoning_tokens")
    }


def _bounded_text(payload: bytes, limit: int = 50_000) -> str:
    return payload[:limit].decode("utf-8", "replace")


@dataclass(frozen=True, slots=True)
class AgentWorkspace:
    id: str
    project_id: str
    root: Path
    repo_root: Path
    work_root: Path
    out_root: Path
    agent_root: Path

    def _base(self, scope: str) -> Path:
        if scope not in _ALL_SCOPES:
            raise _policy("Unknown workspace scope")
        return {
            WorkspaceScope.REPO: self.repo_root,
            WorkspaceScope.WORK: self.work_root,
            WorkspaceScope.OUT: self.out_root,
            WorkspaceScope.AGENT: self.agent_root,
        }[scope]

    def _target(self, scope: str, relative: str) -> Path:
        base = self._base(scope).resolve()
        path = _safe_relative(relative)
        target = (base / Path(path)).resolve()
        try:
            target.relative_to(base)
        except ValueError as exc:
            raise _policy("Workspace path escaped its scope") from exc
        current = base
        for part in PurePosixPath(path).parts:
            current = current / part
            if current.is_symlink():
                raise _policy("Workspace symbolic links are not allowed")
        return target

    def read_file(self, scope: str, relative: str) -> bytes:
        target = self._target(scope, relative)
        try:
            return target.read_bytes()
        except (FileNotFoundError, OSError) as exc:
            raise _policy("Workspace file is unavailable") from exc

    def write_file(self, scope: str, relative: str, payload: bytes) -> None:
        if scope not in _WRITE_SCOPES:
            raise _policy("Only work and out scopes are writable")
        if not isinstance(payload, bytes):
            raise _policy("Workspace payload must be bytes")
        target = self._target(scope, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink():
            raise _policy("Workspace symbolic links are not allowed")
        try:
            target.write_bytes(payload)
        except OSError as exc:
            raise _policy("Workspace file cannot be written") from exc

    def delete_file(self, scope: str, relative: str) -> None:
        if scope not in _WRITE_SCOPES:
            raise _policy("Only work and out scopes are writable")
        target = self._target(scope, relative)
        if target.is_symlink():
            raise _policy("Workspace symbolic links are not allowed")
        try:
            target.unlink()
        except (FileNotFoundError, OSError) as exc:
            raise _policy("Workspace file cannot be deleted") from exc

    def list_files(self, scope: str) -> tuple[str, ...]:
        base = self._base(scope).resolve()
        files: list[str] = []
        for path in sorted(base.rglob("*")):
            if path.is_symlink():
                raise _policy("Workspace symbolic links are not allowed")
            if path.is_file():
                files.append(path.relative_to(base).as_posix())
        return tuple(files)


class WorkspaceManager:
    """Creates project-scoped persistent workspaces under the data root."""

    capability_version = "workspace-storage/1"

    def __init__(
        self,
        data_root: str | Path,
        *,
        repository_reader: RepositorySnapshotReader | None = None,
        workspace_root: str | Path | None = None,
    ) -> None:
        self.data_root = Path(data_root).resolve()
        self.base = (
            Path(workspace_root).resolve()
            if workspace_root is not None
            else self.data_root / "workspaces"
        )
        self.compact_paths = workspace_root is not None
        self.base.mkdir(parents=True, exist_ok=True)
        self.repository_reader = repository_reader

    def open(
        self,
        project_id: str,
        workspace_id: str,
        *,
        repository: SourceAsset | None = None,
    ) -> AgentWorkspace:
        if not project_id or not workspace_id:
            raise _policy("Project and workspace IDs are required")
        if self.compact_paths:
            project_directory = "p" + hashlib.sha256(
                project_id.encode("utf-8")
            ).hexdigest()[:8]
            workspace_directory = "w" + hashlib.sha256(
                f"{project_id}\0{workspace_id}".encode()
            ).hexdigest()[:8]
        else:
            project_directory = stable_id("workspace-project", project_id)
            workspace_directory = stable_id("workspace", project_id, workspace_id)
        root = (self.base / project_directory / workspace_directory).resolve()
        try:
            root.relative_to(self.base.resolve())
        except ValueError as exc:
            raise _policy("Workspace root escaped data root") from exc
        paths = {
            "repo": root / WorkspaceScope.REPO,
            "work": root / WorkspaceScope.WORK,
            "out": root / WorkspaceScope.OUT,
            "agent": root / WorkspaceScope.AGENT,
        }
        manifest_path = paths["agent"] / "workspace.json"
        if root.exists():
            if not manifest_path.is_file():
                raise _collision("Workspace exists without a manifest")
            manifest = _load_json(manifest_path)
            if (
                manifest.get("project_id") != project_id
                or manifest.get("id") != workspace_id
            ):
                raise _collision("Workspace identity collision")
            if (
                repository is not None
                and manifest.get("repository_id") != repository.id
            ):
                raise _collision("Workspace repository binding collision")
        else:
            for directory in paths.values():
                directory.mkdir(parents=True, exist_ok=True)
            _write_json(
                manifest_path,
                {
                    "version": 1,
                    "id": workspace_id,
                    "project_id": project_id,
                    "repository_id": repository.id if repository else None,
                    "repository_revision": repository.revision if repository else None,
                },
            )
        workspace = AgentWorkspace(
            workspace_id,
            project_id,
            root,
            paths["repo"],
            paths["work"],
            paths["out"],
            paths["agent"],
        )
        if repository is not None and not workspace.list_files(WorkspaceScope.REPO):
            self._mount_repository(workspace, repository)
        return workspace

    def _mount_repository(self, workspace: AgentWorkspace, source: SourceAsset) -> None:
        if self.repository_reader is None:
            raise _capability("No repository snapshot reader is configured")
        summaries = self.repository_reader.list_files(source)
        for summary in summaries:
            path = summary.path
            payload = self.repository_reader.read_file(
                source,
                SourceLocator(
                    source.id,
                    source.revision,
                    {
                        "path": path,
                        "line_start": 1,
                        "line_end": summary.line_count,
                    },
                ),
            )
            target = workspace._target(WorkspaceScope.REPO, path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            try:
                target.chmod(0o444)
            except OSError:
                pass
        for directory in sorted(workspace.repo_root.rglob("*"), reverse=True):
            if directory.is_dir() and not directory.is_symlink():
                try:
                    directory.chmod(0o555)
                except OSError:
                    pass
        try:
            workspace.repo_root.chmod(0o555)
        except OSError:
            pass


class AgentSessionManager:
    """Persists turn metadata and cumulative budget without prompt/file content."""

    capability_version = "session-store/1"

    def start(
        self,
        workspace: AgentWorkspace,
        *,
        session_id: str,
        stage: str,
        budget: AgentBudget | None = None,
        capability_version: str = "agent-session/1",
    ) -> AgentSession:
        path = self._path(workspace, session_id)
        if path.exists():
            raise _collision("Agent session already exists")
        now = time.time()
        session = AgentSession(
            session_id,
            workspace.project_id,
            workspace.id,
            "RUNNING",
            _label(stage),
            _label(capability_version),
            budget or AgentBudget(),
            started_at=now,
            updated_at=now,
        )
        _write_json(path, _session_json(session))
        return session

    def load(self, workspace: AgentWorkspace, session_id: str) -> AgentSession:
        path = self._path(workspace, session_id)
        if not path.is_file():
            raise _policy("Agent session does not exist")
        session = _session_from_json(_load_json(path))
        if (
            session.workspace_id != workspace.id
            or session.project_id != workspace.project_id
        ):
            raise _policy("Agent session belongs to another workspace")
        return session

    def resume(self, workspace: AgentWorkspace, session_id: str) -> AgentSession:
        session = self.load(workspace, session_id)
        if session.status in {"COMPLETED", "CANCELED"}:
            raise _invalid("Completed or canceled sessions cannot resume")
        session = replace(session, status="RUNNING", updated_at=time.time())
        self._save(workspace, session)
        return session

    def record_turn(
        self,
        workspace: AgentWorkspace,
        session_id: str,
        *,
        tool: str,
        outcome: str,
        path: str | None = None,
        input_bytes: int = 0,
        output_bytes: int = 0,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        reasoning_tokens: int = 0,
        elapsed_seconds: float = 0.0,
        render: bool = False,
    ) -> AgentSession:
        session = self.load(workspace, session_id)
        if session.status != "RUNNING":
            raise _invalid("Only running sessions accept turns")
        if min(input_bytes, output_bytes) < 0:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Turn byte counts cannot be negative",
            )
        try:
            budget = session.budget.charge(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                reasoning_tokens=reasoning_tokens,
                elapsed_seconds=elapsed_seconds,
                render=render,
            )
        except ContractError:
            exhausted = replace(
                session,
                status="BUDGET_EXHAUSTED",
                updated_at=time.time(),
            )
            self._save(workspace, exhausted)
            raise
        turn = AgentTurn(
            len(session.turns) + 1,
            _label(tool),
            _label(outcome),
            _path_hash(path),
            input_bytes,
            output_bytes,
            prompt_tokens,
            completion_tokens,
            reasoning_tokens,
            elapsed_seconds,
            render,
        )
        updated = replace(
            session,
            budget=budget,
            turns=session.turns + (turn,),
            updated_at=time.time(),
        )
        self._save(workspace, updated)
        return updated

    def pause(self, workspace: AgentWorkspace, session_id: str) -> AgentSession:
        return self._set_status(workspace, session_id, "PAUSED")

    def cancel(self, workspace: AgentWorkspace, session_id: str) -> AgentSession:
        return self._set_status(workspace, session_id, "CANCELED")

    def complete(self, workspace: AgentWorkspace, session_id: str) -> AgentSession:
        session = self.load(workspace, session_id)
        if session.status not in {"RUNNING", "PAUSED"}:
            raise _invalid("Only active sessions can complete")
        return self._set_status(workspace, session_id, "COMPLETED")

    def _set_status(
        self, workspace: AgentWorkspace, session_id: str, status: str
    ) -> AgentSession:
        session = self.load(workspace, session_id)
        updated = replace(session, status=status, updated_at=time.time())
        self._save(workspace, updated)
        return updated

    @staticmethod
    def _path(workspace: AgentWorkspace, session_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,120}", session_id):
            raise _policy("Unsafe agent session ID")
        return workspace.agent_root / f"session-{session_id}.json"

    def _save(self, workspace: AgentWorkspace, session: AgentSession) -> None:
        _write_json(self._path(workspace, session.id), _session_json(session))


class AgentEngineScaffold:
    """P6.2 durable state facade bound to the configured native sandbox."""

    capability_version = "agent-engine-scaffold/1"
    p6_slot = "agent.engine"
    ready_for_p6 = False

    def __init__(
        self,
        data_root: str | Path,
        *,
        repository_reader: RepositorySnapshotReader | None = None,
        sandbox_launcher: SandboxLauncher | None = None,
        renderer: TrustedWebRenderer | None = None,
        workspace_root: str | Path | None = None,
        build_action: Callable[[AgentWorkspace], Any] | None = None,
    ) -> None:
        if sandbox_launcher is None:
            from .sandbox import default_sandbox_launcher

            sandbox_launcher = default_sandbox_launcher()
        self.workspaces = WorkspaceManager(
            data_root,
            repository_reader=repository_reader,
            workspace_root=workspace_root,
        )
        self.sessions = AgentSessionManager()
        self.sandbox = sandbox_launcher
        self.renderer = renderer
        self.build_action = build_action
        self.ready_for_p6 = bool(self.sandbox.available and self.renderer is not None)

    def open_workspace(
        self,
        project_id: str,
        workspace_id: str,
        *,
        repository: SourceAsset | None = None,
    ) -> AgentWorkspace:
        return self.workspaces.open(
            project_id, workspace_id, repository=repository
        )

    def run_command(
        self,
        workspace: AgentWorkspace,
        command: SandboxCommand,
        *,
        limits: SandboxLimits | None = None,
    ) -> SandboxResult:
        """Run only through the configured native launcher; never host fallback."""

        return self.sandbox.run(workspace, command, limits=limits)

    def create_loop(self, client: CapabilityClient) -> AgentLoop:
        return AgentLoop(
            client,
            renderer=self.renderer,
            session_manager=self.sessions,
            sandbox_launcher=self.sandbox,
            build_action=self.build_action,
        )


def _safe_relative(value: str) -> str:
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        raise _policy("Workspace path is unsafe")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise _policy("Workspace path must be relative")
    return path.as_posix()


def _label(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(
        r"[A-Za-z0-9_.:/-]{1,100}", value
    ):
        return "invalid"
    return value


def _path_hash(path: str | None) -> str | None:
    if path is None:
        return None
    return hashlib.sha256(path.encode("utf-8")).hexdigest()


def _session_json(session: AgentSession) -> dict[str, object]:
    return {
        "version": 1,
        "id": session.id,
        "project_id": session.project_id,
        "workspace_id": session.workspace_id,
        "status": session.status,
        "stage": session.stage,
        "capability_version": session.capability_version,
        "started_at": session.started_at,
        "updated_at": session.updated_at,
        "budget": {
            "max_steps": session.budget.max_steps,
            "max_total_tokens": session.budget.max_total_tokens,
            "max_seconds": session.budget.max_seconds,
            "max_renders": session.budget.max_renders,
            "steps": session.budget.steps,
            "prompt_tokens": session.budget.prompt_tokens,
            "completion_tokens": session.budget.completion_tokens,
            "reasoning_tokens": session.budget.reasoning_tokens,
            "elapsed_seconds": session.budget.elapsed_seconds,
            "renders": session.budget.renders,
        },
        "turns": [
            {
                "sequence": turn.sequence,
                "tool": turn.tool,
                "outcome": turn.outcome,
                "path_hash": turn.path_hash,
                "input_bytes": turn.input_bytes,
                "output_bytes": turn.output_bytes,
                "prompt_tokens": turn.prompt_tokens,
                "completion_tokens": turn.completion_tokens,
                "reasoning_tokens": turn.reasoning_tokens,
                "elapsed_seconds": turn.elapsed_seconds,
                "render": turn.render,
            }
            for turn in session.turns
        ],
    }


def _session_from_json(document: Mapping[str, object]) -> AgentSession:
    if document.get("version") != 1:
        raise _policy("Unsupported agent session version")
    budget_document = document.get("budget")
    if not isinstance(budget_document, dict):
        raise _policy("Agent session budget is invalid")
    try:
        budget = AgentBudget(
            **{
                key: budget_document[key]
                for key in (
                    "max_steps",
                    "max_total_tokens",
                    "max_seconds",
                    "max_renders",
                    "steps",
                    "prompt_tokens",
                    "completion_tokens",
                    "reasoning_tokens",
                    "elapsed_seconds",
                    "renders",
                )
            }
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise _policy("Agent session budget is invalid") from exc
    turns_document = document.get("turns", [])
    if not isinstance(turns_document, list):
        raise _policy("Agent session turns are invalid")
    try:
        turns = tuple(
            AgentTurn(**turn) for turn in turns_document if isinstance(turn, dict)
        )
    except (TypeError, ValueError) as exc:
        raise _policy("Agent session turns are invalid") from exc
    return AgentSession(
        str(document.get("id", "")),
        str(document.get("project_id", "")),
        str(document.get("workspace_id", "")),
        str(document.get("status", "")),
        str(document.get("stage", "")),
        str(document.get("capability_version", "")),
        budget,
        turns,
        float(document.get("started_at", 0.0)),
        float(document.get("updated_at", 0.0)),
    )


def _load_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise _policy("Agent metadata is unavailable or invalid") from exc
    if not isinstance(value, dict):
        raise _policy("Agent metadata has an invalid shape")
    return value


def _write_json(path: Path, value: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _policy(message: str) -> ContractError:
    return ContractError(ErrorCategory.POLICY_BLOCKED, message)


def _capability(message: str) -> ContractError:
    return ContractError(ErrorCategory.CAPABILITY_UNAVAILABLE, message)


def _budget(message: str) -> ContractError:
    return ContractError(ErrorCategory.CAPABILITY_UNAVAILABLE, message)


def _invalid(message: str) -> ContractError:
    return ContractError(ErrorCategory.INVALID_TRANSITION, message)


def _collision(message: str) -> ContractError:
    return ContractError(ErrorCategory.DETERMINISTIC_FAILURE, message)
