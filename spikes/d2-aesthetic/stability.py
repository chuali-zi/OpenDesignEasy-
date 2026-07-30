"""Q3 spike material: repeat the SAME aesthetic assessment on the SAME
screenshot 5 independent times (fresh call each time, no shared context
between repeats -- same isolation principle as D2's candidate independence),
per quality-governance-spec.md SS11 Q3: "同一截图重复评估的结论一致性".

What this script measures OBJECTIVELY (and only this), across the 5 repeats
of a given candidate's final screenshot:
  - dimension coverage: which of the 5 rubric dimensions appeared in each run,
    and how much that set overlaps across runs (union / intersection / mean
    pairwise Jaccard).
  - target_ref set overlap: same Jaccard-style overlap, computed on the set of
    target_ref values cited in each run.

It does NOT judge which run's findings were "more correct" -- that is
explicitly left to human review.

Usage: python spikes/d2-aesthetic/stability.py [cand_ids...] [--repeats N]
Requires aesthetic_findings.py's anchor extraction to be reproducible; this
script re-extracts anchors itself from candidates/cand{N}/final/ so it can run
independently of aesthetic_findings.py's own findings.
"""
from __future__ import annotations

import itertools
import json
import os
import sys
import time

sys.path.insert(0, os.path.join("spikes", "d2-aesthetic", "lib"))
from checks import extract_anchors  # noqa: E402
from aesthetic import call_assess, RUBRIC_DIMENSIONS  # noqa: E402

ROOT = os.path.join("spikes", "d2-aesthetic")
CAND_ROOT = os.path.join(ROOT, "candidates")
Q3_ROOT = os.path.join(ROOT, "q3")

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


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def mean_pairwise_jaccard(sets: list[set]) -> float | None:
    pairs = list(itertools.combinations(range(len(sets)), 2))
    if not pairs:
        return None
    vals = [jaccard(sets[i], sets[j]) for i, j in pairs]
    return sum(vals) / len(vals)


def run_one_candidate(cand_id: int, repeats: int) -> dict:
    files = load_final_files(cand_id)
    anchors = extract_anchors(files)
    intent = load_intent(cand_id)
    shot = final_screenshot(cand_id)
    axis_label = AXIS_LABELS[cand_id]

    runs = []
    for i in range(1, repeats + 1):
        print(f"  [cand{cand_id}] stability run {i}/{repeats} ...", flush=True)
        result = call_assess(cand_id, axis_label, intent, anchors["all_refs"], shot)
        findings = result["findings"]
        dims = {f.get("dimension", "") for f in findings if isinstance(f, dict) and f.get("dimension")}
        refs = {f.get("target_ref", "") for f in findings if isinstance(f, dict) and f.get("target_ref")}
        valid_refs = set(anchors["all_refs"])
        valid_count = sum(1 for r in refs if r in valid_refs)
        runs.append({
            "run": i,
            "finding_count": len(findings),
            "dimensions": sorted(dims),
            "target_refs": sorted(refs),
            "valid_target_ref_count": valid_count,
            "parse_error": result["parse_error"],
            "findings": findings,
        })

    dim_sets = [set(r["dimensions"]) for r in runs]
    ref_sets = [set(r["target_refs"]) for r in runs]
    dim_union = sorted(set().union(*dim_sets)) if dim_sets else []
    dim_intersection = sorted(set.intersection(*dim_sets)) if dim_sets else []
    ref_union = sorted(set().union(*ref_sets)) if ref_sets else []
    ref_intersection = sorted(set.intersection(*ref_sets)) if ref_sets else []

    out = {
        "cand_id": cand_id,
        "axis_label": axis_label,
        "screenshot": shot,
        "repeats": repeats,
        "anchor_count": len(anchors["all_refs"]),
        "runs": runs,
        "dimension_union": dim_union,
        "dimension_union_count": len(dim_union),
        "dimension_intersection": dim_intersection,
        "dimension_intersection_count": len(dim_intersection),
        "dimension_mean_pairwise_jaccard": mean_pairwise_jaccard(dim_sets),
        "target_ref_union_count": len(ref_union),
        "target_ref_intersection": ref_intersection,
        "target_ref_intersection_count": len(ref_intersection),
        "target_ref_mean_pairwise_jaccard": mean_pairwise_jaccard(ref_sets),
    }
    with open(os.path.join(Q3_ROOT, f"cand{cand_id}.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    repeats = 5
    if "--repeats" in args:
        idx = args.index("--repeats")
        repeats = int(args[idx + 1])
        del args[idx:idx + 2]
    ids = [int(a) for a in args] or [1, 2, 3, 4]

    os.makedirs(Q3_ROOT, exist_ok=True)
    all_results = []
    for cid in ids:
        t0 = time.time()
        try:
            r = run_one_candidate(cid, repeats)
            print(f"  [cand{cid}] dim_jaccard={r['dimension_mean_pairwise_jaccard']} "
                  f"ref_jaccard={r['target_ref_mean_pairwise_jaccard']} wall={time.time()-t0:.1f}s", flush=True)
            all_results.append(r)
        except Exception as exc:  # noqa: BLE001
            print(f"  [cand{cid}] FAILED: {exc}", flush=True)
            all_results.append({"cand_id": cid, "error": str(exc)})

    summary = {
        "rubric_dimensions": RUBRIC_DIMENSIONS,
        "repeats": repeats,
        "per_candidate": [
            {"cand_id": r.get("cand_id"),
             "dimension_mean_pairwise_jaccard": r.get("dimension_mean_pairwise_jaccard"),
             "target_ref_mean_pairwise_jaccard": r.get("target_ref_mean_pairwise_jaccard"),
             "dimension_intersection_count": r.get("dimension_intersection_count")}
            for r in all_results
        ],
    }
    with open(os.path.join(Q3_ROOT, "_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"summary: {json.dumps(summary, ensure_ascii=False)}")
