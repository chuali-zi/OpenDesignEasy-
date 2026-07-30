"""Shared DesignContract data shape + builder used by both extractors.

Kept identical between the source-regex and computed-style extractors so
their outputs are structurally comparable (same JSON shape, same field
semantics) even though the *values that populate them* come from different
signals.
"""
from __future__ import annotations

import json
from collections import Counter
from typing import Any

COLOR_THRESHOLD_SOURCE = 2   # min CSS-declaration occurrences (source-regex method)
COLOR_THRESHOLD_COMPUTED = 2  # min rendered-element occurrences (computed-style method)


class ExtractionError(Exception):
    """Raised when the input cannot be parsed at all. Extractors MUST raise
    this rather than returning an empty/partial DesignContract, per
    design-intelligence-spec.md §3: "抽取失败...必须报 DETERMINISTIC_FAILURE，
    不得产出空 contract 蒙混过关"."""


def infer_role(role_counts: Counter) -> str:
    """Pick the majority property-context for a color value. Tie-break order
    background > foreground > accent (background/foreground are structurally
    more decisive than an accent hit)."""
    if not role_counts:
        return "accent"
    best = max(role_counts.values())
    winners = {r for r, c in role_counts.items() if c == best}
    for pref in ("background", "foreground", "accent"):
        if pref in winners:
            return pref
    return sorted(winners)[0]


def build_contract(
    *,
    version: str,
    color_occurrences: list[tuple[str, str]],  # (normalized_value, role_context)
    font_families: list[str],
    font_sizes_px: list[float],
    font_weights: list[int],
    space_values_px: list[float],
    anchors: list[tuple[str, str]],  # (kind, id) in document order
    color_threshold: int,
) -> dict[str, Any]:
    value_counts: Counter = Counter()
    role_counts: dict[str, Counter] = {}
    for value, role in color_occurrences:
        value_counts[value] += 1
        role_counts.setdefault(value, Counter())[role] += 1

    colors = [
        {"value": v, "role": infer_role(role_counts[v]), "count": value_counts[v]}
        for v in value_counts
        if value_counts[v] >= color_threshold
    ]
    colors.sort(key=lambda c: (-c["count"], c["value"]))

    seen_anchor = set()
    ordered_anchors = []
    for kind, aid in anchors:
        key = (kind, aid)
        if key in seen_anchor:
            continue
        seen_anchor.add(key)
        ordered_anchors.append({"kind": kind, "id": aid})

    return {
        "extractor_version": version,
        "tokens": {
            "color": colors,
            "type": {
                "font_family": sorted(set(font_families)),
                "font_size": sorted(set(round(v, 1) for v in font_sizes_px)),
                "font_weight": sorted(set(font_weights)),
            },
            "space": sorted(set(round(v, 1) for v in space_values_px)),
        },
        "anchors": ordered_anchors,
    }


def canonical_json(contract: dict[str, Any]) -> str:
    """Stable serialization used for the cross-run-identical determinism
    check: two contracts are 'identical' iff this string is byte-equal."""
    return json.dumps(contract, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
