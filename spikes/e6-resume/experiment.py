"""E6 spike orchestrator: workspace + turn-history resume vs. rerun-from-zero.

Method
------
1. Calibrate: run one uninterrupted session to completion to get a baseline
   total step count T0.
2. Pick 3 interrupt points at ~25% / 50% / 75% of T0 (absolute step counts).
3. For each interrupt point, 3 repeats (9 groups total). Each repeat:
   a. Run a session live, but simulate a crash right after `interrupt` steps
      have completed and been persisted (AgentSession.save() already ran).
      This "precrash" segment is IDENTICAL sunk cost shared by both paths
      below -- it already happened before the (simulated) restart.
   b. Path A (resume): copy the crashed workspace as-is, AgentSession.load()
      it (pure disk read, no in-memory carryover), continue run() to
      completion. Its cumulative budget already includes the precrash cost.
   c. Path B (rerun): wipe the workspace, start a brand new session from
      turn 1, run to completion. Total cost for this path =
      precrash budget (wasted, sunk, not reusable) + this fresh run's cost.
4. Detect duplicate work: any write_file in the post-crash tool_log of the
   resume path whose target path was already write_file'd successfully
   before the crash.
5. Validate final artifacts structurally (not aesthetically, per spikes
   README) for both paths.

Everything is written under spikes/e6-resume/results/.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

SPIKE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SPIKE_DIR))

from session import AgentSession  # noqa: E402

RESULTS_DIR = SPIKE_DIR / "results"
RUNS_DIR = RESULTS_DIR / "runs"
RAW_DIR = RESULTS_DIR / "raw"
CALIBRATION_DIR = RESULTS_DIR / "calibration"

CALIBRATION_MAX_STEPS = 16
COMPLETION_MAX_STEPS = 22  # generous cap for resume/rerun completion phases
REPEATS_PER_POINT = 3
FRACTIONS = (0.25, 0.50, 0.75)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def validate_site(work_dir: Path) -> dict:
    """Structural (not aesthetic) equivalence check. Per spikes/README.md we
    do not judge aesthetics -- only whether the artifact is a usable 3-file
    site by simple structural markers."""
    result = {"ok": True, "files": {}}
    checks = {
        "index.html": lambda t: ("<html" in t.lower() and "<title" in t.lower()
                                  and "styles.css" in t and "script.js" in t),
        "styles.css": lambda t: "{" in t and "}" in t,
        "script.js": lambda t: ("function" in t or "addeventlistener" in t.lower()
                                 or "console.log" in t),
    }
    for name, check in checks.items():
        p = work_dir / name
        if not p.exists():
            result["files"][name] = {"exists": False, "structurally_ok": False, "bytes": 0}
            result["ok"] = False
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        ok = bool(text.strip()) and check(text)
        result["files"][name] = {"exists": True, "structurally_ok": ok, "bytes": len(text)}
        if not ok:
            result["ok"] = False
    return result


def written_paths_before(tool_log: list[dict], cutoff_step: int) -> set[str]:
    return {
        e["path"]
        for e in tool_log
        if e.get("tool") == "write_file" and e.get("ok") and e.get("step", 0) <= cutoff_step and e.get("path")
    }


def read_paths_before(tool_log: list[dict], cutoff_step: int) -> set[str]:
    return {
        e["path"]
        for e in tool_log
        if e.get("tool") == "read_file" and e.get("ok") and e.get("step", 0) <= cutoff_step and e.get("path")
    }


def calibrate() -> int:
    if CALIBRATION_DIR.exists():
        shutil.rmtree(CALIBRATION_DIR)
    log("=== calibration run (uninterrupted, full completion) ===")
    sess = AgentSession(CALIBRATION_DIR)
    sess.start_fresh()
    reason = sess.run(max_steps=CALIBRATION_MAX_STEPS)
    log(f"calibration termination={reason} steps={sess.budget.steps} "
        f"tokens={sess.budget.total_tokens} wall_s={sess.budget.wall_clock_s}")
    (RESULTS_DIR / "calibration_summary.json").write_text(
        json.dumps(
            {
                "termination_reason": reason,
                "budget": sess.budget.to_dict(),
                "tool_log": sess.tool_log,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return sess.budget.steps


def run_one(run_id: str, interrupt_step: int) -> dict:
    run_dir = RUNS_DIR / run_id
    if run_dir.exists():
        shutil.rmtree(run_dir)
    precrash_dir = run_dir / "precrash"
    resume_dir = run_dir / "resume"
    rerun_dir = run_dir / "rerun"

    log(f"--- {run_id}: precrash phase (target interrupt at step {interrupt_step}) ---")
    precrash = AgentSession(precrash_dir)
    precrash.start_fresh()
    precrash_reason = precrash.run(max_steps=CALIBRATION_MAX_STEPS, stop_after_steps=interrupt_step)
    precrash_budget = precrash.budget.to_dict()
    precrash_tool_log = list(precrash.tool_log)
    log(f"{run_id}: precrash termination={precrash_reason} steps={precrash_budget['steps']}")

    finished_early = precrash_reason != "simulated_crash"
    written_before = written_paths_before(precrash_tool_log, precrash_budget["steps"])
    read_before = read_paths_before(precrash_tool_log, precrash_budget["steps"])

    # ---------------- Path A: resume ----------------
    shutil.copytree(precrash_dir, resume_dir)
    log(f"{run_id}: resume phase (loading persisted state from disk)")
    sess_resume = AgentSession.load(resume_dir)
    assert sess_resume.budget.steps == precrash_budget["steps"], "budget must not reset on load"
    resume_reason = sess_resume.run(max_steps=COMPLETION_MAX_STEPS)
    total_a = sess_resume.budget.to_dict()
    resume_post_log = [e for e in sess_resume.tool_log if e.get("step", 0) > precrash_budget["steps"]]
    dup_writes = [e for e in resume_post_log if e.get("tool") == "write_file" and e.get("path") in written_before]
    dup_reads = [e for e in resume_post_log if e.get("tool") == "read_file" and e.get("path") in read_before]
    validate_a = validate_site(resume_dir / "work")
    final_msg_a = sess_resume.messages[-1]["content"] if sess_resume.messages and sess_resume.messages[-1]["role"] == "assistant" else ""
    log(f"{run_id}: resume termination={resume_reason} total_steps={total_a['steps']} "
        f"dup_writes={len(dup_writes)} dup_reads={len(dup_reads)} valid={validate_a['ok']}")

    # ---------------- Path B: rerun from zero ----------------
    log(f"{run_id}: rerun-from-zero phase")
    sess_rerun = AgentSession(rerun_dir)
    sess_rerun.start_fresh()
    rerun_reason = sess_rerun.run(max_steps=COMPLETION_MAX_STEPS)
    fresh_budget = sess_rerun.budget.to_dict()
    total_b = {
        "steps": precrash_budget["steps"] + fresh_budget["steps"],
        "prompt_tokens": precrash_budget["prompt_tokens"] + fresh_budget["prompt_tokens"],
        "completion_tokens": precrash_budget["completion_tokens"] + fresh_budget["completion_tokens"],
        "reasoning_tokens": precrash_budget["reasoning_tokens"] + fresh_budget["reasoning_tokens"],
        "total_tokens": precrash_budget["total_tokens"] + fresh_budget["total_tokens"],
        "api_elapsed_s": round(precrash_budget["api_elapsed_s"] + fresh_budget["api_elapsed_s"], 3),
        "wall_clock_s": round(precrash_budget["wall_clock_s"] + fresh_budget["wall_clock_s"], 3),
    }
    validate_b = validate_site(rerun_dir / "work")
    log(f"{run_id}: rerun termination={rerun_reason} fresh_steps={fresh_budget['steps']} "
        f"total_steps={total_b['steps']} valid={validate_b['ok']}")

    savings = {
        k: (round((total_b[k] - total_a[k]) / total_b[k] * 100, 1) if total_b[k] else 0.0)
        for k in ("steps", "total_tokens", "wall_clock_s")
    }

    record = {
        "run_id": run_id,
        "interrupt_step_target": interrupt_step,
        "finished_before_interrupt": finished_early,
        "precrash": {
            "termination_reason": precrash_reason,
            "budget": precrash_budget,
            "written_paths": sorted(written_before),
        },
        "path_a_resume": {
            "termination_reason": resume_reason,
            "total_budget": total_a,
            "post_resume_tool_calls": len(resume_post_log),
            "duplicate_writes": dup_writes,
            "duplicate_reads": dup_reads,
            "validate": validate_a,
            "final_message_preview": (final_msg_a or "")[:300],
        },
        "path_b_rerun": {
            "termination_reason": rerun_reason,
            "fresh_only_budget": fresh_budget,
            "total_budget": total_b,
            "validate": validate_b,
        },
        "savings_pct_resume_vs_rerun": savings,
    }
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / f"{run_id}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    return record


def main() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    t0 = calibrate()
    interrupt_points = sorted({max(1, min(t0 - 1, round(f * t0))) for f in FRACTIONS})
    log(f"calibration T0={t0} steps -> interrupt points={interrupt_points}")
    # Guarantee exactly 3 distinct points if T0 is large enough; if rounding
    # collapsed two fractions to the same integer, nudge apart within bounds.
    if len(interrupt_points) < 3 and t0 >= 4:
        pts = sorted(interrupt_points)
        candidates = list(range(1, t0))
        # fill missing distinct points evenly across the valid range
        while len(pts) < 3 and len(pts) < len(candidates):
            for c in candidates:
                if c not in pts:
                    pts.append(c)
                    break
            pts = sorted(set(pts))
        interrupt_points = pts[:3] if len(pts) >= 3 else pts
        log(f"adjusted interrupt points -> {interrupt_points}")

    all_records = []
    for ip in interrupt_points:
        for r in range(1, REPEATS_PER_POINT + 1):
            run_id = f"ip{ip}_r{r}"
            rec = run_one(run_id, ip)
            all_records.append(rec)

    summary = {
        "calibration_T0_steps": t0,
        "interrupt_points": interrupt_points,
        "repeats_per_point": REPEATS_PER_POINT,
        "records": all_records,
    }
    (RESULTS_DIR / "raw_data.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    log(f"=== DONE. {len(all_records)} groups written to results/raw_data.json ===")


if __name__ == "__main__":
    main()
