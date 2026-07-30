"""Builds the curated fact package handed to k3 (Step 2 of the E3/D7/Q8 spike).

Deterministically filters spikes/e3-repo-facts/outputs/facts.json down to the
categories relevant for a "what is this project" introduction (drops the very
granular python_method / test_function / file_exists facts to keep the prompt
a reasonable size -- 180 facts / ~32k chars instead of 543 / much more).

Writes:
  outputs/fact_package.json  -- [{id, category, statement}, ...] (also used by
                                 the reviewer to know exactly what was offered)
  outputs/fact_package.md    -- human-readable numbered list, same content,
                                 this is the literal text embedded in the k3 prompt
"""
from __future__ import annotations

import json
from pathlib import Path

SPIKE_DIR = Path(__file__).resolve().parent
OUT_DIR = SPIKE_DIR / "outputs"

KEEP_CATEGORIES = {
    "directory_listing",
    "python_module",
    "python_class",
    "python_function",
    "dependency",
    "build_dependency",
    "config",
    "test_count_aggregate",
    "test_file_count",
    "file_syntax_error",
}


def build(facts_path: Path = OUT_DIR / "facts.json"):
    data = json.loads(facts_path.read_text(encoding="utf-8"))
    facts = data["facts"]
    kept = [f for f in facts if f["category"] in KEEP_CATEGORIES]

    package = [{"id": f["id"], "category": f["category"], "statement": f["statement"]} for f in kept]
    (OUT_DIR / "fact_package.json").write_text(
        json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    lines = [f"[{p['id']}] ({p['category']}) {p['statement']}" for p in package]
    (OUT_DIR / "fact_package.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"Kept {len(package)}/{len(facts)} facts across categories: "
          f"{sorted({p['category'] for p in package})}")
    return package


if __name__ == "__main__":
    build()
