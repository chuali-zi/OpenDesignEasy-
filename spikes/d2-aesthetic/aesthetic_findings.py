"""Q2 spike material: for each candidate's FINAL self-repair-round screenshot,
ask k3 for aesthetic findings per quality-governance-spec.md SS4.1's rubric.

What this script measures OBJECTIVELY (and only this):
  - for every finding, whether its target_ref is a real anchor
    (data-oey-section / data-oey-object) that actually exists in the
    candidate's final HTML -- extracted deterministically by lib/checks.py,
    not by asking the model to grade itself.
  - "valid rate" = valid target_refs / total findings, per candidate and overall.

It does NOT judge whether a finding's aesthetic content is correct. That is
explicitly left to human review (see RESULT.md / review.html).

Usage: python spikes/d2-aesthetic/aesthetic_findings.py [cand_ids...]
Requires selfrepair.py to have already produced candidates/cand{N}/final/ and
candidates/cand{N}/rounds.json.
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.join("spikes", "d2-aesthetic", "lib"))
from checks import extract_anchors  # noqa: E402
from aesthetic import call_assess, RUBRIC_DIMENSIONS  # noqa: E402

ROOT = os.path.join("spikes", "d2-aesthetic")
CAND_ROOT = os.path.join(ROOT, "candidates")
Q2_ROOT = os.path.join(ROOT, "q2")

AXIS_LABELS = {
    1: "叙事框架 / narrative metaphor",
    2: "版式结构 / layout & information architecture",
    3: "色彩温度与基调 / color temperature & mood",
    4: "信息密度与节奏 / information density & rhythm",
}


def load_final_files(cand_id: int) -> dict[str, str]:
    final_dir = os.path.join(CAND_ROOT, f"cand{cand_id}", "final")
    files = {}
    for dirpath, _d, filenames in os.walk(final_dir):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, final_dir).replace("\\", "/")
            try:
                with open(full, "r", encoding="utf-8") as f:
                    files[rel] = f.read()
            except UnicodeDecodeError:
                pass
    return files


def load_intent(cand_id: int) -> str:
    for cand_dir in (os.path.join(CAND_ROOT, f"cand{cand_id}", "final"),
                      os.path.join(CAND_ROOT, f"cand{cand_id}", "v1")):
        p = os.path.join(cand_dir, "INTENT.md")
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8") as f:
                return f.read()
    return ""


def final_screenshot(cand_id: int) -> str:
    with open(os.path.join(CAND_ROOT, f"cand{cand_id}", "rounds.json"), "r", encoding="utf-8") as f:
        rounds = json.load(f)
    return rounds["final_screenshot"]


def run_one(cand_id: int) -> dict:
    files = load_final_files(cand_id)
    anchors = extract_anchors(files)
    intent = load_intent(cand_id)
    shot = final_screenshot(cand_id)
    axis_label = AXIS_LABELS[cand_id]

    print(f"  [cand{cand_id}] asking for aesthetic findings on {shot} ...", flush=True)
    result = call_assess(cand_id, axis_label, intent, anchors["all_refs"], shot)

    findings = result["findings"]
    valid_refs = set(anchors["all_refs"])
    checked = []
    valid_count = 0
    dims_seen = set()
    for f in findings:
        ref = f.get("target_ref", "") if isinstance(f, dict) else ""
        dim = f.get("dimension", "") if isinstance(f, dict) else ""
        is_valid = ref in valid_refs
        if is_valid:
            valid_count += 1
        if dim:
            dims_seen.add(dim)
        checked.append({**f, "target_ref_valid": is_valid} if isinstance(f, dict) else {"raw": f, "target_ref_valid": False})

    out = {
        "cand_id": cand_id,
        "axis_label": axis_label,
        "screenshot": shot,
        "anchor_count": len(anchors["all_refs"]),
        "anchors": anchors,
        "finding_count": len(findings),
        "valid_target_ref_count": valid_count,
        "valid_target_ref_rate": (valid_count / len(findings)) if findings else None,
        "dimensions_covered": sorted(dims_seen),
        "dimension_coverage_count": len(dims_seen),
        "findings": checked,
        "parse_error": result["parse_error"],
        "usage": result["usage"],
        "elapsed_s": result["elapsed_s"],
    }
    with open(os.path.join(Q2_ROOT, f"cand{cand_id}.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    with open(os.path.join(Q2_ROOT, f"cand{cand_id}_raw.txt"), "w", encoding="utf-8") as f:
        f.write(result["raw_content"])
    return out


if __name__ == "__main__":
    ids = [int(a) for a in sys.argv[1:]] or [1, 2, 3, 4]
    os.makedirs(Q2_ROOT, exist_ok=True)
    all_results = []
    total_findings = 0
    total_valid = 0
    for cid in ids:
        t0 = time.time()
        try:
            r = run_one(cid)
            print(f"  [cand{cid}] findings={r['finding_count']} valid_rate={r['valid_target_ref_rate']} "
                  f"wall={time.time()-t0:.1f}s", flush=True)
            total_findings += r["finding_count"]
            total_valid += r["valid_target_ref_count"]
            all_results.append(r)
        except Exception as exc:  # noqa: BLE001
            print(f"  [cand{cid}] FAILED: {exc}", flush=True)
            all_results.append({"cand_id": cid, "error": str(exc)})

    summary = {
        "rubric_dimensions": RUBRIC_DIMENSIONS,
        "total_findings": total_findings,
        "total_valid_target_refs": total_valid,
        "overall_valid_target_ref_rate": (total_valid / total_findings) if total_findings else None,
        "per_candidate": [
            {"cand_id": r.get("cand_id"), "finding_count": r.get("finding_count"),
             "valid_target_ref_rate": r.get("valid_target_ref_rate"),
             "dimension_coverage_count": r.get("dimension_coverage_count")}
            for r in all_results
        ],
    }
    with open(os.path.join(Q2_ROOT, "_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"summary: {json.dumps(summary, ensure_ascii=False)}")
