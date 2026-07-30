"""Driver script for the D1+E7 spike: run N independent agent sessions and
collect raw metrics + a summary. Never executes model-generated commands (see
tools.py). Run with --smoke first to validate wiring on a single session
before committing to a full 20-session run (per spikes/README.md convention).

Usage:
  python run_sessions.py --smoke
  python run_sessions.py --n 20
  python run_sessions.py --n 20 --start 1 --out results/raw.json
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from html.parser import HTMLParser
from pathlib import Path

SPIKE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SPIKE_DIR))

from agent_loop import run_session  # noqa: E402
from tools import FaultPlan  # noqa: E402

WORKSPACES_DIR = SPIKE_DIR / "workspaces"
RESULTS_DIR = SPIKE_DIR / "results"


class _LenientParser(HTMLParser):
    pass


def validate_artifact(workspace_dir: Path) -> dict:
    index = workspace_dir / "index.html"
    exists = index.exists() and index.is_file()
    parseable = False
    size_bytes = 0
    error = None
    if exists:
        try:
            content = index.read_text(encoding="utf-8")
            size_bytes = len(content.encode("utf-8"))
            parser = _LenientParser()
            parser.feed(content)
            parser.close()
            parseable = True
        except Exception as exc:  # noqa: BLE001 - want any parse failure recorded
            error = f"{type(exc).__name__}: {exc}"
    else:
        # also check other .html files in case the model used a different name
        others = list(workspace_dir.glob("*.html")) if workspace_dir.exists() else []
        if others:
            error = f"index.html missing; found instead: {[p.name for p in others]}"
    return {
        "exists": exists,
        "parseable": parseable,
        "size_bytes": size_bytes,
        "error": error,
        "valid": exists and parseable,
    }


def compute_recovery(result: dict, fault_type: str) -> str:
    """Returns 'not_triggered' | 'recovered' | 'not_recovered'.

    Definition (documented in RESULT.md methodology):
    - not_triggered: the model never made a call of the relevant tool at the
      designated ordinal, so the injected fault never fired.
    - recovered: the fault fired, the session still self-terminated with a
      valid final artifact, AND the model did not immediately repeat the exact
      same failing call right after the fault with no change.
    - not_recovered: fault fired but the session failed to reach a valid
      completed state, or the model's very next action was an unchanged
      repeat of the failing call that failed again.
    """
    key = "read_fault_triggered_at" if fault_type == "read_file" else "run_command_fault_triggered_at"
    triggered_at = result.get(key)
    if triggered_at is None:
        return "not_triggered"
    calls = sorted(result["calls_log"], key=lambda c: c["idx"])
    fault_entry = next((c for c in calls if c["idx"] == triggered_at), None)
    next_entry = next((c for c in calls if c["idx"] == triggered_at + 1), None)
    immediate_repeat_failed = False
    if fault_entry and next_entry:
        same_call = (
            next_entry["name"] == fault_entry["name"]
            and next_entry.get("args_key") == fault_entry.get("args_key")
        )
        if same_call and next_entry.get("result_ok") is False:
            immediate_repeat_failed = True
    completed_ok = (
        result.get("termination_reason") == "self_terminated"
        and result.get("artifact", {}).get("valid") is True
    )
    if completed_ok and not immediate_repeat_failed:
        return "recovered"
    return "not_recovered"


def run_one(session_id: str, verbose: bool = False) -> dict:
    workspace_dir = WORKSPACES_DIR / session_id
    fault_plan = FaultPlan(read_file_fail_at=1, run_command_fail_at=1)
    if verbose:
        print(f"[{session_id}] starting, workspace={workspace_dir}")
    result = run_session(session_id, workspace_dir, fault_plan)
    result["artifact"] = validate_artifact(workspace_dir)
    result["read_recovery"] = compute_recovery(result, "read_file")
    result["run_command_recovery"] = compute_recovery(result, "run_command")
    if verbose:
        print(
            f"[{session_id}] done: termination={result['termination_reason']} "
            f"steps={result['steps']} tool_calls={result['tool_calls_total']} "
            f"format_errors={result['format_errors']} "
            f"artifact_valid={result['artifact']['valid']} "
            f"read_recovery={result['read_recovery']} "
            f"cmd_recovery={result['run_command_recovery']} "
            f"tokens={result['total_tokens']} wall_s={result['wall_clock_s']}"
        )
    return result


def summarize(results: list[dict]) -> dict:
    def q(vals, f):
        return round(f(vals), 1) if vals else None

    steps = [r["steps"] for r in results]
    tokens = [r["total_tokens"] for r in results if r["total_tokens"]]
    prompt_tok = [r["prompt_tokens"] for r in results if r["prompt_tokens"]]
    completion_tok = [r["completion_tokens"] for r in results if r["completion_tokens"]]
    reasoning_tok = [r["reasoning_tokens"] for r in results if r["reasoning_tokens"]]
    wall = [r["wall_clock_s"] for r in results]
    tool_calls = [r["tool_calls_total"] for r in results]
    format_errors = sum(r["format_errors"] for r in results)
    total_calls = sum(r["tool_calls_total"] for r in results)

    n = len(results)
    completed = sum(1 for r in results if r["termination_reason"] == "self_terminated")
    step_limited = sum(1 for r in results if r["termination_reason"] == "step_limit")
    api_errors = sum(1 for r in results if r["termination_reason"] == "api_error")
    artifact_valid = sum(1 for r in results if r["artifact"]["valid"])

    def recovery_rate(field):
        vals = [r[field] for r in results]
        triggered = [v for v in vals if v != "not_triggered"]
        recovered = [v for v in vals if v == "recovered"]
        return {
            "triggered_count": len(triggered),
            "recovered_count": len(recovered),
            "rate": round(len(recovered) / len(triggered), 3) if triggered else None,
        }

    return {
        "n_sessions": n,
        "completed_self_terminated": completed,
        "step_limited": step_limited,
        "api_errors": api_errors,
        "artifact_valid_count": artifact_valid,
        "completion_rate": round(completed / n, 3) if n else None,
        "artifact_valid_rate": round(artifact_valid / n, 3) if n else None,
        "tool_calls_total_all_sessions": total_calls,
        "format_errors_total": format_errors,
        "format_error_rate": round(format_errors / total_calls, 4) if total_calls else None,
        "steps": {"min": min(steps) if steps else None, "median": q(steps, statistics.median), "max": max(steps) if steps else None},
        "total_tokens": {"min": min(tokens) if tokens else None, "median": q(tokens, statistics.median), "max": max(tokens) if tokens else None},
        "prompt_tokens": {"min": min(prompt_tok) if prompt_tok else None, "median": q(prompt_tok, statistics.median), "max": max(prompt_tok) if prompt_tok else None},
        "completion_tokens": {"min": min(completion_tok) if completion_tok else None, "median": q(completion_tok, statistics.median), "max": max(completion_tok) if completion_tok else None},
        "reasoning_tokens": {"min": min(reasoning_tok) if reasoning_tok else None, "median": q(reasoning_tok, statistics.median), "max": max(reasoning_tok) if reasoning_tok else None},
        "wall_clock_s": {"min": min(wall) if wall else None, "median": q(wall, statistics.median), "max": max(wall) if wall else None},
        "tool_calls_per_session": {"min": min(tool_calls) if tool_calls else None, "median": q(tool_calls, statistics.median), "max": max(tool_calls) if tool_calls else None},
        "read_file_fault_recovery": recovery_rate("read_recovery"),
        "run_command_fault_recovery": recovery_rate("run_command_recovery"),
        "sandbox_violations_total": sum(r["sandbox_violations"] for r in results),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true", help="run a single smoke-test session and exit")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--out", type=str, default=str(RESULTS_DIR / "raw.json"))
    args = ap.parse_args()

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)

    if args.smoke:
        result = run_one("smoke", verbose=True)
        out_path = RESULTS_DIR / "smoke.json"
        out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"wrote {out_path}")
        return

    results = []
    for i in range(args.start, args.start + args.n):
        sid = f"s{i:02d}"
        result = run_one(sid, verbose=True)
        results.append(result)
        # write incrementally so partial progress isn't lost
        Path(args.out).write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    summary = summarize(results)
    summary_path = RESULTS_DIR / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"\nwrote {args.out} and {summary_path}")


if __name__ == "__main__":
    main()
