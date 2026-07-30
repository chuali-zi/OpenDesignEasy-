"""Q7 spike, step 4: compare the code-only detector's findings against what
MOCK.md actually declares, to compute a declaration-completeness rate and to
test whether "mock exists but was not declared" can be caught deterministically.

This script is the ONLY place that reads MOCK.md. detector.py never does.

Usage:
    python spikes/e4-mock/detector/compare.py --all
    python spikes/e4-mock/detector/compare.py <run_dir>
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from detector import scan_run  # noqa: E402

RUNS_ROOT = os.path.join("spikes", "e4-mock", "runs")

# Keyword sets used to decide whether MOCK.md's prose *mentions* a given
# category of mock behaviour. This is a deterministic textual cross-check,
# not a semantic/LLM judgement -- it only asks "does the declaration text
# contain wording for this category of mock technique".
DECLARATION_KEYWORDS = {
    "FETCH_XHR_INTERCEPT": ["fetch", "xhr", "xmlhttprequest", "拦截"],
    "SERVICE_WORKER": ["service worker", "serviceworker", "sw.js", "service-worker"],
    "INLINE_FAKE_DATA": [
        "硬编码", "内联", "虚构", "假数据", "mock data", "hardcode", "hard-code",
        "编造", "数组", "array", "demo data", "样例数据", "示例数据",
    ],
    "TIMEOUT_FAKE_DELAY": ["settimeout", "延迟", "模拟网络", "network delay", "延时", "async delay"],
    "MOCK_PATH_REFERENCE": ["mock/", ".mock.json", "mock 目录", "mock文件"],
}


def declared_categories(mock_md_text: str) -> set[str]:
    text_lower = mock_md_text.lower()
    declared = set()
    for category, keywords in DECLARATION_KEYWORDS.items():
        if any(kw.lower() in text_lower for kw in keywords):
            declared.add(category)
    return declared


def audit_run(run_dir: str) -> dict:
    """Run the code-only detector, then separately check MOCK.md coverage."""
    detected = scan_run(run_dir)
    detected_categories = set(detected["categories_detected"])

    mock_path = os.path.join(run_dir, "MOCK.md")
    has_mock_md = os.path.isfile(mock_path)
    mock_text = ""
    if has_mock_md:
        mock_text = open(mock_path, encoding="utf-8", errors="replace").read()
    declared = declared_categories(mock_text) if has_mock_md else set()

    undeclared = detected_categories - declared  # mock exists in code, not mentioned in MOCK.md
    over_declared = declared - detected_categories  # claimed but code-detector found no evidence

    if detected_categories:
        completeness = len(detected_categories & declared) / len(detected_categories)
    else:
        completeness = 1.0  # vacuously complete: nothing to declare

    verdict = "OK"
    if not has_mock_md and detected_categories:
        verdict = "HARD_ERROR_NO_MOCK_MD"
    elif undeclared:
        verdict = "HARD_ERROR_UNDECLARED_MOCK"

    return {
        "run_dir": os.path.basename(run_dir.rstrip("/\\")),
        "has_mock_md": has_mock_md,
        "detected_categories": sorted(detected_categories),
        "declared_categories": sorted(declared),
        "undeclared_categories": sorted(undeclared),
        "over_declared_categories": sorted(over_declared),
        "declaration_completeness": round(completeness, 3),
        "verdict": verdict,
        "signal_count": detected["signal_count"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--runs-root", default=RUNS_ROOT)
    args = ap.parse_args()

    if args.all:
        results = []
        for name in sorted(os.listdir(args.runs_root)):
            run_dir = os.path.join(args.runs_root, name)
            if os.path.isdir(run_dir) and name.startswith("run-"):
                r = audit_run(run_dir)
                results.append(r)
                print(f"{r['run_dir']}: verdict={r['verdict']} "
                      f"completeness={r['declaration_completeness']} "
                      f"undeclared={r['undeclared_categories']}")
        out_path = os.path.join(args.runs_root, "_compare_summary.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"summary -> {out_path}")
    elif args.target:
        r = audit_run(args.target)
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        ap.error("provide a target dir or --all")


if __name__ == "__main__":
    main()
