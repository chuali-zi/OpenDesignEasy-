"""Q4 computed DesignContract comparison, independent from A3's regex path."""
from __future__ import annotations

from typing import Any

COMPARATOR_VERSION = "q4-computed-contract-diff-v1"


def compare_contracts(baseline: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    if baseline.get("extractor_version") != current.get("extractor_version"):
        return {
            "comparable": False,
            "reason": "extractor_version_mismatch",
            "baseline_version": baseline.get("extractor_version"),
            "current_version": current.get("extractor_version"),
        }

    base_tokens = baseline["tokens"]
    cur_tokens = current["tokens"]
    base_colors = {item["value"] for item in base_tokens["color"]}
    cur_colors = {item["value"] for item in cur_tokens["color"]}
    token_drift = {
        "color": sorted(cur_colors - base_colors),
        "font_size": sorted(set(cur_tokens["type"]["font_size"]) - set(base_tokens["type"]["font_size"])),
        "space": sorted(set(cur_tokens["space"]) - set(base_tokens["space"])),
    }
    base_anchors = {(a["kind"], a["id"]) for a in baseline["anchors"]}
    cur_anchors = {(a["kind"], a["id"]) for a in current["anchors"]}
    missing = [
        {"kind": kind, "id": anchor_id}
        for kind, anchor_id in sorted(base_anchors - cur_anchors)
    ]
    types = [name for name, values in token_drift.items() if values]
    if missing:
        types.append("anchor")
    return {
        "comparable": True,
        "drift": bool(types),
        "drift_types": types,
        "new_tokens": token_drift,
        "missing_anchors": missing,
    }
