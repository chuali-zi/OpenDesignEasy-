"""Tool implementations for the E6 resume spike.

Safety constraint for this spike (per task instructions): only three tools
exist, all L0/L1 per agent-engine-spec.md 4.1/4.2 -- no run_command, no
network. read_file / write_file / list_files are REAL filesystem operations,
hard-limited to a single workspace `work/` directory via
os.path.realpath containment checks performed BEFORE any filesystem access.
Anything that resolves outside the workspace is a hard SandboxViolation.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

TOOL_NAMES = {"read_file", "write_file", "list_files"}

REQUIRED_PARAMS = {
    "read_file": ["path"],
    "write_file": ["path", "content"],
    "list_files": ["path"],
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
            "name": "write_file",
            "description": (
                "Create or overwrite a file inside your workspace with the "
                "given text content. Path must be relative to the workspace "
                "root. Parent directories are created automatically."
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
            "name": "list_files",
            "description": (
                "List files and directories inside a directory in your "
                "workspace. Path is relative to the workspace root; use '.' "
                "for the root."
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
]


class SandboxViolation(Exception):
    pass


def resolve_in_workspace(work_dir: Path, rel_path: str) -> Path:
    """Resolve rel_path against work_dir and verify containment.

    Raises SandboxViolation if the resolved real path escapes work_dir.
    """
    if rel_path is None:
        raise SandboxViolation("path is missing")
    if os.path.isabs(rel_path):
        raise SandboxViolation(f"absolute paths are not allowed: {rel_path!r}")
    candidate = work_dir / rel_path
    work_real = Path(os.path.realpath(work_dir))
    candidate_real = Path(os.path.realpath(candidate))
    try:
        candidate_real.relative_to(work_real)
    except ValueError:
        raise SandboxViolation(
            f"resolved path escapes workspace: {rel_path!r} -> {candidate_real}"
        ) from None
    return candidate_real


def validate_call(name: str, arguments_raw: str) -> tuple[dict | None, str | None]:
    """Validate a raw tool call. Returns (parsed_args, error_message)."""
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


def execute_tool(work_dir: Path, name: str, args: dict) -> tuple[str, bool, str | None]:
    """Execute one validated tool call.

    Returns (result_content_json_str, ok, path_arg). `ok` and `path_arg` are
    for the tool_log only (per runtime-recovery.md 8 allowlist: no file
    content or prompt text goes into the log, only counts/paths/outcomes).
    """
    path_arg = args.get("path") if isinstance(args, dict) else None

    if name == "read_file":
        try:
            real = resolve_in_workspace(work_dir, args["path"])
        except SandboxViolation as exc:
            return json.dumps({"error": f"SandboxViolation: {exc}"}), False, path_arg
        if not real.exists():
            return (
                json.dumps({"error": f"FileNotFoundError: '{args['path']}' does not exist"}),
                False,
                path_arg,
            )
        if not real.is_file():
            return json.dumps({"error": f"IsADirectoryError: '{args['path']}'"}), False, path_arg
        try:
            content = real.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return json.dumps({"error": f"UnicodeDecodeError: '{args['path']}'"}), False, path_arg
        return json.dumps({"path": args["path"], "content": content}), True, path_arg

    if name == "write_file":
        try:
            real = resolve_in_workspace(work_dir, args["path"])
        except SandboxViolation as exc:
            return json.dumps({"error": f"SandboxViolation: {exc}"}), False, path_arg
        real.parent.mkdir(parents=True, exist_ok=True)
        real.write_text(args["content"], encoding="utf-8")
        return (
            json.dumps(
                {"path": args["path"], "bytes_written": len(args["content"].encode("utf-8"))}
            ),
            True,
            path_arg,
        )

    if name == "list_files":
        try:
            real = resolve_in_workspace(work_dir, args["path"])
        except SandboxViolation as exc:
            return json.dumps({"error": f"SandboxViolation: {exc}"}), False, path_arg
        if not real.exists():
            return (
                json.dumps({"error": f"FileNotFoundError: '{args['path']}' does not exist"}),
                False,
                path_arg,
            )
        if not real.is_dir():
            return json.dumps({"error": f"NotADirectoryError: '{args['path']}'"}), False, path_arg
        entries = sorted(p.name + ("/" if p.is_dir() else "") for p in real.iterdir())
        return json.dumps({"path": args["path"], "entries": entries}), True, path_arg

    raise AssertionError(f"unreachable tool name: {name}")
