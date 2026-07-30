"""Tool implementations for the D1+E7 agent-loop spike.

Safety contract (do not weaken):
- read_file / list_files / write_file are REAL. They are hard-limited to a single
  session workspace directory via os.path.realpath containment checks performed
  BEFORE any filesystem access.
- run_command is a SIMULATED tool. It never calls subprocess/os.system/eval/exec
  and never executes model-supplied text. It returns canned or fault-injected
  output computed in pure Python from the *real* on-disk state of the sandboxed
  workspace (e.g. an "ls"-like listing), never by executing the command string.
"""
from __future__ import annotations

import json
import os
import shlex
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

TOOL_NAMES = {"read_file", "list_files", "write_file", "run_command"}

REQUIRED_PARAMS = {
    "read_file": ["path"],
    "list_files": ["path"],
    "write_file": ["path", "content"],
    "run_command": ["command"],
}

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": (
                "Read the full text content of a file inside your workspace. "
                "Path must be relative to the workspace root."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to the file, e.g. 'index.html'",
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": (
                "List files and directories inside a directory in your workspace. "
                "Path is relative to the workspace root; use '.' for the root."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative directory path, e.g. '.'",
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Create or overwrite a file inside your workspace with the given "
                "text content. Path must be relative to the workspace root. "
                "Parent directories are created automatically."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to the file, e.g. 'index.html'",
                    },
                    "content": {
                        "type": "string",
                        "description": "Full text content to write to the file.",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Run a shell command inside your sandboxed workspace (no network "
                "access). Returns stdout, stderr, and exit_code."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to run, e.g. 'ls -la'",
                    }
                },
                "required": ["command"],
            },
        },
    },
]


class SandboxViolation(Exception):
    pass


def resolve_in_workspace(workspace_dir: Path, rel_path: str) -> Path:
    """Resolve rel_path against workspace_dir and verify containment.

    Raises SandboxViolation if the resolved real path escapes the workspace.
    """
    if rel_path is None:
        raise SandboxViolation("path is missing")
    # Reject absolute paths outright (pathlib silently drops the left side of a
    # join when the right side is absolute, which would be surprising here).
    if os.path.isabs(rel_path):
        raise SandboxViolation(f"absolute paths are not allowed: {rel_path!r}")
    candidate = workspace_dir / rel_path
    workspace_real = Path(os.path.realpath(workspace_dir))
    candidate_real = Path(os.path.realpath(candidate))
    try:
        candidate_real.relative_to(workspace_real)
    except ValueError:
        raise SandboxViolation(
            f"resolved path escapes workspace: {rel_path!r} -> {candidate_real}"
        ) from None
    return candidate_real


@dataclass
class FaultPlan:
    """Which call (by 1-based ordinal, counted per tool name) should be faulted."""

    read_file_fail_at: int | None = None
    run_command_fail_at: int | None = None


@dataclass
class ToolCallCounters:
    read_file: int = 0
    list_files: int = 0
    write_file: int = 0
    run_command: int = 0


@dataclass
class ToolStats:
    total_calls: int = 0
    format_errors: int = 0
    format_error_detail: list[str] = field(default_factory=list)
    sandbox_violations: int = 0
    read_fault_triggered_at: int | None = None  # overall call index (1-based)
    run_command_fault_triggered_at: int | None = None
    calls_log: list[dict[str, Any]] = field(default_factory=list)


def _fake_ls(workspace_dir: Path, target: str) -> tuple[str, str, int]:
    try:
        real = resolve_in_workspace(workspace_dir, target or ".")
    except SandboxViolation as exc:
        return "", str(exc), 1
    if not real.exists():
        return "", f"ls: cannot access '{target}': No such file or directory", 2
    if real.is_file():
        return real.name, "", 0
    entries = sorted(p.name + ("/" if p.is_dir() else "") for p in real.iterdir())
    return "\n".join(entries), "", 0


def _fake_cat(workspace_dir: Path, target: str) -> tuple[str, str, int]:
    if not target:
        return "", "cat: missing operand", 1
    try:
        real = resolve_in_workspace(workspace_dir, target)
    except SandboxViolation as exc:
        return "", str(exc), 1
    if not real.exists() or not real.is_file():
        return "", f"cat: {target}: No such file or directory", 1
    try:
        return real.read_text(encoding="utf-8"), "", 0
    except UnicodeDecodeError:
        return "", f"cat: {target}: binary file not shown", 1


def simulate_run_command(
    workspace_dir: Path, command: str, call_ordinal: int, fault_at: int | None
) -> dict[str, Any]:
    """Simulated run_command. Never executes `command`; parses it only to decide
    which canned response to fabricate. Grounds ls/cat output in the real
    (sandboxed) filesystem so responses feel realistic without ever shelling out.
    """
    is_fault_turn = fault_at is not None and call_ordinal == fault_at
    try:
        tokens = shlex.split(command, posix=True) if command else []
    except ValueError:
        tokens = command.split() if command else []
    cmd0 = tokens[0] if tokens else ""

    if is_fault_turn:
        # Simulate a plausible sandbox failure: missing binary / nonzero exit.
        stderr = f"/bin/sh: 1: {cmd0 or command[:40]}: not found"
        return {"stdout": "", "stderr": stderr, "exit_code": 127, "simulated": True}

    if cmd0 in ("ls", "dir"):
        target = tokens[1] if len(tokens) > 1 else "."
        out, err, code = _fake_ls(workspace_dir, target)
        return {"stdout": out, "stderr": err, "exit_code": code, "simulated": True}
    if cmd0 in ("cat", "type"):
        target = tokens[1] if len(tokens) > 1 else ""
        out, err, code = _fake_cat(workspace_dir, target)
        return {"stdout": out, "stderr": err, "exit_code": code, "simulated": True}
    if cmd0 == "wc":
        target = tokens[-1] if len(tokens) > 1 else ""
        out, err, code = _fake_cat(workspace_dir, target)
        if code == 0:
            lines = out.count("\n") + (1 if out and not out.endswith("\n") else 0)
            words = len(out.split())
            chars = len(out)
            return {
                "stdout": f"{lines} {words} {chars} {target}",
                "stderr": "",
                "exit_code": 0,
                "simulated": True,
            }
        return {"stdout": "", "stderr": err, "exit_code": code, "simulated": True}
    if cmd0 == "echo":
        return {
            "stdout": " ".join(tokens[1:]),
            "stderr": "",
            "exit_code": 0,
            "simulated": True,
        }
    # Anything else (npm, node, python, git, tidy, ...): sandbox has no such
    # tools installed. Generic, deterministic, not-a-real-execution response.
    return {
        "stdout": "",
        "stderr": f"/bin/sh: 1: {cmd0 or command[:40]}: not found",
        "exit_code": 127,
        "simulated": True,
    }


def validate_call(name: str, arguments_raw: str) -> tuple[dict | None, str | None]:
    """Validate a raw tool call. Returns (parsed_args, error_message).

    error_message is None on success. On failure, parsed_args is None and
    error_message categorizes: unknown function name, invalid JSON arguments,
    or missing required parameters.
    """
    if name not in TOOL_NAMES:
        return None, f"unknown_function: no such tool '{name}'"
    try:
        args = json.loads(arguments_raw) if arguments_raw else {}
    except (json.JSONDecodeError, TypeError):
        return None, f"invalid_json_arguments: could not parse arguments for '{name}'"
    if not isinstance(args, dict):
        return None, f"invalid_json_arguments: arguments for '{name}' is not an object"
    missing = [p for p in REQUIRED_PARAMS[name] if p not in args or args[p] is None]
    if missing:
        return None, f"missing_required_params: {missing} for '{name}'"
    return args, None


def execute_tool(
    workspace_dir: Path,
    name: str,
    args: dict,
    counters: ToolCallCounters,
    fault_plan: FaultPlan,
    stats: ToolStats,
    overall_call_index: int,
) -> str:
    """Execute one validated tool call. Returns a string result to send back to
    the model as the tool message content. Mutates counters/stats for fault
    bookkeeping.
    """
    if name == "read_file":
        counters.read_file += 1
        is_fault = (
            fault_plan.read_file_fail_at is not None
            and counters.read_file == fault_plan.read_file_fail_at
        )
        if is_fault:
            stats.read_fault_triggered_at = overall_call_index
            return json.dumps(
                {"error": f"FileNotFoundError: '{args['path']}' does not exist"}
            )
        try:
            real = resolve_in_workspace(workspace_dir, args["path"])
        except SandboxViolation as exc:
            stats.sandbox_violations += 1
            return json.dumps({"error": f"SandboxViolation: {exc}"})
        if not real.exists():
            return json.dumps(
                {"error": f"FileNotFoundError: '{args['path']}' does not exist"}
            )
        if not real.is_file():
            return json.dumps({"error": f"IsADirectoryError: '{args['path']}'"})
        try:
            content = real.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return json.dumps({"error": f"UnicodeDecodeError: '{args['path']}'"})
        return json.dumps({"path": args["path"], "content": content})

    if name == "list_files":
        counters.list_files += 1
        try:
            real = resolve_in_workspace(workspace_dir, args["path"])
        except SandboxViolation as exc:
            stats.sandbox_violations += 1
            return json.dumps({"error": f"SandboxViolation: {exc}"})
        if not real.exists():
            return json.dumps(
                {"error": f"FileNotFoundError: '{args['path']}' does not exist"}
            )
        if not real.is_dir():
            return json.dumps({"error": f"NotADirectoryError: '{args['path']}'"})
        entries = sorted(
            p.name + ("/" if p.is_dir() else "") for p in real.iterdir()
        )
        return json.dumps({"path": args["path"], "entries": entries})

    if name == "write_file":
        counters.write_file += 1
        try:
            real = resolve_in_workspace(workspace_dir, args["path"])
        except SandboxViolation as exc:
            stats.sandbox_violations += 1
            return json.dumps({"error": f"SandboxViolation: {exc}"})
        real.parent.mkdir(parents=True, exist_ok=True)
        real.write_text(args["content"], encoding="utf-8")
        return json.dumps(
            {"path": args["path"], "bytes_written": len(args["content"].encode("utf-8"))}
        )

    if name == "run_command":
        counters.run_command += 1
        is_fault = (
            fault_plan.run_command_fail_at is not None
            and counters.run_command == fault_plan.run_command_fail_at
        )
        result = simulate_run_command(
            workspace_dir,
            args["command"],
            counters.run_command,
            fault_plan.run_command_fail_at if is_fault else None,
        )
        if is_fault:
            stats.run_command_fault_triggered_at = overall_call_index
        return json.dumps(result)

    raise AssertionError(f"unreachable: {name}")
