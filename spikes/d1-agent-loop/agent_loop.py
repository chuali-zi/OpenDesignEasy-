"""Minimal agent loop for the D1+E7 spike.

Drives one Kimi k3 session against the sandboxed tool set in tools.py until the
model stops calling tools (self-terminate), a step budget is hit, or an
unrecoverable API error occurs. Never executes model output as code (see
tools.py header for the safety contract).
"""
from __future__ import annotations

import json
import random
import sys
import time
from pathlib import Path
from typing import Any

SPIKE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SPIKE_DIR))
sys.path.insert(0, str(SPIKE_DIR.parent / "_lib"))

from kimi import chat  # noqa: E402
from tools import (  # noqa: E402
    FaultPlan,
    ToolCallCounters,
    ToolStats,
    TOOLS_SCHEMA,
    execute_tool,
    validate_call,
)

MAX_STEPS = 20
MAX_TOKENS_PER_CALL = 16384
SESSION_WALLCLOCK_LIMIT_S = 480  # safety guard, not the metric under test
RETRY_MAX_ATTEMPTS = 5
RETRY_BASE_DELAY_S = 2.0

TASK_PROMPT = """You are working alone inside a sandboxed workspace directory. \
You have four tools: read_file, list_files, write_file, run_command. All paths \
you pass to tools must be relative to the workspace root (e.g. 'index.html'), \
never absolute.

Task: build a single-page HTML file for a small product landing page.

Requirements:
1. Use write_file to create 'index.html' in the workspace root with: a valid \
HTML5 doctype, a <title>, a <header> containing a short nav, a <main> section \
with at least one heading and one paragraph of real (non-lorem-ipsum) text \
about a fictional product of your choosing, and a <footer>.
2. After writing the file, use read_file to read it back and check the content \
is what you intended (self-check). This step is required.
3. You may use list_files to see what's in your workspace, and run_command for \
shell inspection (e.g. 'ls', 'cat index.html') if it helps you verify your work.
4. If any tool call returns an error, diagnose the problem and adjust your \
approach (retry, fix the path, fix the content, or try another tool) rather \
than giving up or repeating the exact same failing call forever.
5. When you are confident index.html is complete and correct, stop calling \
tools and reply with a short plain-text summary of what you built. Do not call \
any more tools after that final summary.

Work only inside your workspace; do not attempt to access anything outside it.
"""

SYSTEM_PROMPT = (
    "You are a careful coding agent operating autonomously in a sandboxed "
    "workspace. You must accomplish the task using only the provided tools. "
    "Think step by step, use tools to make progress, and verify your own work "
    "before declaring completion."
)


def _json_loads_safe(raw: str) -> dict:
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _is_retryable_error(msg: str) -> bool:
    return "HTTP 429" in msg or any(f"HTTP 5{d}" in msg for d in "0123456789")


def _call_with_retry(messages, tools) -> tuple[dict, dict, float]:
    attempt = 0
    while True:
        try:
            return chat(
                messages,
                tools=tools,
                max_tokens=MAX_TOKENS_PER_CALL,
                temperature=1,
            )
        except RuntimeError as exc:
            msg = str(exc)
            attempt += 1
            if not _is_retryable_error(msg) or attempt > RETRY_MAX_ATTEMPTS:
                raise
            delay = RETRY_BASE_DELAY_S * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
            time.sleep(delay)


def run_session(session_id: str, workspace_dir: Path, fault_plan: FaultPlan) -> dict[str, Any]:
    workspace_dir.mkdir(parents=True, exist_ok=True)

    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": TASK_PROMPT},
    ]

    counters = ToolCallCounters()
    stats = ToolStats()
    overall_call_index = 0

    usage_totals = {"prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0, "total_tokens": 0}
    api_elapsed_total = 0.0
    step = 0
    termination_reason = None
    fatal_error = None
    session_start = time.time()

    while True:
        if time.time() - session_start > SESSION_WALLCLOCK_LIMIT_S:
            termination_reason = "wallclock_limit"
            break
        if step >= MAX_STEPS:
            termination_reason = "step_limit"
            break

        step += 1
        try:
            message, usage, elapsed = _call_with_retry(messages, TOOLS_SCHEMA)
        except RuntimeError as exc:
            termination_reason = "api_error"
            fatal_error = str(exc)[:500]
            break

        api_elapsed_total += elapsed
        for k in usage_totals:
            usage_totals[k] += usage.get(k, 0) or 0
        # reasoning tokens may live under a nested key depending on API version
        if "completion_tokens_details" in usage and isinstance(
            usage["completion_tokens_details"], dict
        ):
            usage_totals["reasoning_tokens"] += usage["completion_tokens_details"].get(
                "reasoning_tokens", 0
            ) or 0

        tool_calls = message.get("tool_calls") or []
        assistant_msg = {
            "role": "assistant",
            "content": message.get("content") or "",
        }
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls
        messages.append(assistant_msg)

        if not tool_calls:
            termination_reason = "self_terminated"
            break

        for tc in tool_calls:
            overall_call_index += 1
            stats.total_calls += 1
            tc_id = tc.get("id")
            fn = tc.get("function") or {}
            name = fn.get("name")
            arguments_raw = fn.get("arguments")

            args, err = validate_call(name, arguments_raw)
            if err is not None:
                stats.format_errors += 1
                stats.format_error_detail.append(err)
                result_content = f'{{"error": "{err}"}}'
            else:
                result_content = execute_tool(
                    workspace_dir,
                    name,
                    args,
                    counters,
                    fault_plan,
                    stats,
                    overall_call_index,
                )

            result_ok = None
            if err is None:
                try:
                    result_ok = "error" not in _json_loads_safe(result_content)
                except Exception:
                    result_ok = None
            args_key = None
            if err is None and isinstance(args, dict):
                args_key = args.get("path") or args.get("command")
            is_fault = overall_call_index in (
                stats.read_fault_triggered_at,
                stats.run_command_fault_triggered_at,
            )
            stats.calls_log.append(
                {
                    "idx": overall_call_index,
                    "step": step,
                    "name": name,
                    "format_ok": err is None,
                    "result_ok": result_ok,
                    "args_key": args_key,
                    "is_fault": is_fault,
                }
            )

            if tc_id is None:
                # Cannot address a tool response without an id; conversation
                # cannot continue validly. Treat as a fatal format error.
                termination_reason = "malformed_tool_call_no_id"
                break
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": result_content,
                }
            )

        if termination_reason:
            break

    wall_clock_s = time.time() - session_start

    return {
        "session_id": session_id,
        "termination_reason": termination_reason,
        "fatal_error": fatal_error,
        "steps": step,
        "tool_calls_total": stats.total_calls,
        "format_errors": stats.format_errors,
        "format_error_detail": stats.format_error_detail,
        "sandbox_violations": stats.sandbox_violations,
        "read_fault_planned_at": fault_plan.read_file_fail_at,
        "read_fault_triggered_at": stats.read_fault_triggered_at,
        "run_command_fault_planned_at": fault_plan.run_command_fail_at,
        "run_command_fault_triggered_at": stats.run_command_fault_triggered_at,
        "prompt_tokens": usage_totals["prompt_tokens"],
        "completion_tokens": usage_totals["completion_tokens"],
        "reasoning_tokens": usage_totals["reasoning_tokens"],
        "total_tokens": usage_totals["total_tokens"],
        "api_elapsed_total_s": round(api_elapsed_total, 2),
        "wall_clock_s": round(wall_clock_s, 2),
        "calls_log": stats.calls_log,
        "final_message": messages[-1] if messages and messages[-1]["role"] == "assistant" else None,
    }
