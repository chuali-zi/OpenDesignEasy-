"""Run Q1 rendered hard-check fixtures and persist the raw confusion data."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

from browser import chrome_browser  # noqa: E402
from hard_checks import CHECKER_VERSION, run_hard_checks  # noqa: E402

FIXTURES = ROOT / "fixtures" / "q1"
OUTPUT = ROOT / "data" / "q1-results.json"
VIEWPORTS = [
    {"name": "desktop", "width": 1280, "height": 900},
    {"name": "mobile", "width": 390, "height": 844},
]
CATEGORIES = ("contrast", "overflow", "focus")


def matrix(cases: list[dict], category: str) -> dict[str, int]:
    values = {"tp": 0, "fn": 0, "fp": 0, "tn": 0}
    for case in cases:
        expected = category in case["expected"]
        actual = category in case["detected"]
        values["tp" if expected and actual else "fn" if expected else "fp" if actual else "tn"] += 1
    return values


def rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    results = []
    with chrome_browser() as browser:
        chrome_version = browser.version
        for fixture in manifest:
            per_viewport = []
            all_findings = []
            for viewport in VIEWPORTS:
                context = browser.new_context(viewport={"width": viewport["width"], "height": viewport["height"]})
                page = context.new_page()
                page.goto((FIXTURES / fixture["file"]).resolve().as_uri(), wait_until="load")
                findings = run_hard_checks(page)
                for finding in findings:
                    finding["viewport"] = viewport["name"]
                all_findings.extend(findings)
                per_viewport.append({"viewport": viewport, "findings": findings})
                context.close()
            detected = sorted({finding["category"] for finding in all_findings})
            results.append({**fixture, "detected": detected, "pass": detected == sorted(fixture["expected"]), "runs": per_viewport})
            print(f"{fixture['id']}: expected={fixture['expected']} detected={detected}", flush=True)

    matrices = {category: matrix(results, category) for category in CATEGORIES}
    total = {key: sum(values[key] for values in matrices.values()) for key in ("tp", "fn", "fp", "tn")}
    payload = {
        "status": "COMPLETED",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "signal_source": "live DOM + getComputedStyle + keyboard Tab",
        "checker_version": CHECKER_VERSION,
        "browser": {"engine": "chromium", "channel": "chrome", "version": chrome_version},
        "viewports": VIEWPORTS,
        "fixture_counts": {
            "violation": sum(bool(item["expected"]) for item in results),
            "clean": sum(not item["expected"] for item in results),
        },
        "matrices": matrices,
        "overall_matrix": total,
        "overall_detection_rate": rate(total["tp"], total["tp"] + total["fn"]),
        "overall_false_positive_rate": rate(total["fp"], total["fp"] + total["tn"]),
        "all_cases_matched": all(item["pass"] for item in results),
        "cases": results,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("matrices", "overall_matrix", "overall_detection_rate", "overall_false_positive_rate", "all_cases_matched")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
