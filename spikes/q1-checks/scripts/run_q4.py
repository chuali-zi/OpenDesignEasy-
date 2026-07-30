"""Run Q4 against an independent computed-contract baseline and variants."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

from browser import chrome_browser  # noqa: E402
from contract_drift import COMPARATOR_VERSION, compare_contracts  # noqa: E402
from extract_computed import VERSION as EXTRACTOR_VERSION, extract_from_computed  # noqa: E402

FIXTURES = ROOT / "fixtures" / "q4"
OUTPUT = ROOT / "data" / "q4-results.json"
BASELINE_OUTPUT = ROOT / "data" / "q4-baseline-contract.json"
VIEWPORT = {"width": 1280, "height": 900}


def extract(browser, path: Path) -> dict:
    context = browser.new_context(viewport=VIEWPORT)
    page = context.new_page()
    page.goto(path.resolve().as_uri(), wait_until="load")
    contract = extract_from_computed(page)
    context.close()
    return contract


def rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    with chrome_browser() as browser:
        chrome_version = browser.version
        baseline = extract(browser, FIXTURES / "baseline.html")
        results = []
        for fixture in manifest:
            current = extract(browser, FIXTURES / fixture["file"])
            comparison = compare_contracts(baseline, current)
            if not comparison.get("comparable"):
                raise RuntimeError(f"incomparable contract for {fixture['id']}: {comparison}")
            expected_drift = bool(fixture["expected"])
            actual_drift = comparison["drift"]
            expected_types = set(fixture["expected"])
            actual_types = set(comparison["drift_types"])
            record = {
                **fixture, "detected": comparison["drift_types"],
                "classification": "tp" if expected_drift and actual_drift else "fn" if expected_drift else "fp" if actual_drift else "tn",
                "pass": expected_drift == actual_drift and expected_types.issubset(actual_types),
                "comparison": comparison,
                "contract": current,
            }
            results.append(record)
            print(f"{fixture['id']}: expected={fixture['expected']} detected={record['detected']}", flush=True)

    matrix = {key: sum(item["classification"] == key for item in results) for key in ("tp", "fn", "fp", "tn")}
    payload = {
        "status": "COMPLETED",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "signal_source": "live DOM anchors + rendered getComputedStyle DesignContract",
        "extractor_version": EXTRACTOR_VERSION,
        "comparator_version": COMPARATOR_VERSION,
        "browser": {"engine": "chromium", "channel": "chrome", "version": chrome_version},
        "viewport": VIEWPORT,
        "baseline_file": "baseline.html",
        "fixture_counts": {
            "drift": sum(bool(item["expected"]) for item in results),
            "control": sum(not item["expected"] for item in results),
        },
        "matrix": matrix,
        "drift_detection_rate": rate(matrix["tp"], matrix["tp"] + matrix["fn"]),
        "false_positive_rate": rate(matrix["fp"], matrix["fp"] + matrix["tn"]),
        "all_cases_matched": all(item["pass"] for item in results),
        "a3_reference_only": {
            "source": "../a3-render/a3_local_edit/RESULTS.json",
            "reported_contract_keep": "10/10",
            "not_reused_as_q4_measurement": True,
            "reason": "A3 used regex source tokens and its saved baseline had empty font-size/space sets",
        },
        "cases": results,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    BASELINE_OUTPUT.write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("matrix", "drift_detection_rate", "false_positive_rate", "all_cases_matched")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
