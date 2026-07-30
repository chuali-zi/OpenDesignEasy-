"""Step 3 of the E3/D7/Q8 spike: automated repo-fact consistency reviewer.

Given one generation (k3's "what is this project" copy, with [Fxxxx] citation
markers) and the ground-truth facts.json, classify every factual statement
into one of three buckets per quality-governance-spec.md SS3.5:

  traceable_correct   -- cites a real fact id, content matches      (fine)
  untraceable         -- no usable citation found                   (spec: hint, not error)
  traceable_contradict-- cites a real fact id, content conflicts     (spec: HARD ERROR)

This is deliberately a RULE-BASED heuristic reviewer (substring/number/
identifier matching), not an LLM judge -- Q8 asks whether repo-fact
consistency "can be automatically re-checked" at all; a cheap deterministic
checker is the strongest and most falsifiable version of that claim.

Two independent scoring passes are computed per statement:
  primary     -- strict, citation-bound: only trusts what the generation
                 itself cited (matches SS3.5's literal "must resolve via
                 SourceLocator" wording).
  closed_world-- also runs independent grounding/contradiction search across
                 the FULL fact set (543 facts), ignoring whether the model
                 cited anything. Because the extractor enumerates the whole
                 repo (not a sample), "this identifier appears nowhere in the
                 full fact set" is itself decent negative evidence -- so a
                 subset of "primary=untraceable" statements can be reclassified
                 as "closed_world=traceable_contradict". That gap is exactly
                 the data needed to answer whether SS3.5's untraceable-is-just-
                 a-hint policy is too lenient.

This script never executes anything the reviewed text says; it only does
string/regex comparison against facts.json.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SPIKE_DIR = Path(__file__).resolve().parent
OUT_DIR = SPIKE_DIR / "outputs"

CITATION_RE = re.compile(r"\[F(\d{4})\]")
NUMBER_RE = re.compile(r"\d+(?:\.\d+){0,2}")
BACKTICK_RE = re.compile(r"`([^`]+)`")
CAMEL_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*\b")
SNAKE_RE = re.compile(r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b")

FRAMEWORK_NAMES = [
    "fastapi", "django", "flask", "pydantic", "uvicorn", "react", "vue",
    "angular", "express", "spring", "numpy", "pandas", "requests",
    "sqlalchemy", "pytorch", "tensorflow", "docker", "kubernetes", "redis",
    "postgresql", "mongodb", "graphql", "grpc", "celery", "gunicorn",
    "starlette", "aiohttp", "httpx",
]

SENT_SPLIT_RE = re.compile(r"[。！？\n]+")


def load_facts(path: Path = OUT_DIR / "facts.json", package_path: Path = OUT_DIR / "fact_package.json"):
    data = json.loads(path.read_text(encoding="utf-8"))
    facts = data["facts"]
    by_id = {f["id"]: f for f in facts}

    total_tests = None
    total_test_files = None
    total_deps = None
    dep_names: list[str] = []
    module_count = 0
    for f in facts:
        if f["category"] == "test_count_aggregate":
            total_tests = f["evidence"]["total"]
            total_test_files = f["evidence"]["file_count"]
        if f["category"] == "dependency":
            dep_names = f["evidence"].get("dependencies", [])
            total_deps = len(dep_names)
        if f["category"] == "python_module":
            module_count += 1

    full_blob = "\n".join(reference_text(f) for f in facts)

    package_ids: set[str] = set()
    package_blob = ""
    if package_path.exists():
        pkg = json.loads(package_path.read_text(encoding="utf-8"))
        package_ids = {p["id"] for p in pkg}
        package_blob = "\n".join(reference_text(by_id[i]) for i in package_ids if i in by_id)

    known = {
        "total_tests": total_tests,
        "total_test_files": total_test_files,
        "total_deps": total_deps,
        "dep_names": [d.lower() for d in dep_names],
        "module_count": module_count,
        "full_blob": full_blob,
        "package_ids": package_ids,
        "package_blob": package_blob,
    }
    return by_id, known


def reference_text(fact: dict) -> str:
    return fact["statement"] + " " + json.dumps(fact.get("evidence", {}), ensure_ascii=False)


def split_statements(text: str) -> list[str]:
    parts = [p.strip() for p in SENT_SPLIT_RE.split(text)]
    return [p for p in parts if p]


def extract_citations(sentence: str):
    ids = [f"F{m}" for m in CITATION_RE.findall(sentence)]
    clean = CITATION_RE.sub("", sentence).strip()
    return clean, ids


def extract_claim_tokens(clean_text: str):
    numbers = NUMBER_RE.findall(clean_text)
    backticks = BACKTICK_RE.findall(clean_text)
    camels = CAMEL_RE.findall(clean_text)
    snakes = SNAKE_RE.findall(clean_text)
    identifiers = sorted(set(backticks) | set(camels) | set(snakes))
    frameworks = [fw for fw in FRAMEWORK_NAMES if fw in clean_text.lower()]
    return {"numbers": numbers, "identifiers": identifiers, "frameworks": frameworks}


def has_specific_claim(tokens: dict) -> bool:
    return bool(tokens["numbers"] or tokens["identifiers"] or tokens["frameworks"])


def dependency_contradiction(tokens: dict, known: dict) -> str | None:
    if tokens["frameworks"] and known["total_deps"] == 0:
        named = [fw for fw in tokens["frameworks"] if fw not in known["dep_names"]]
        if named:
            return (f"claims framework(s) {named} in use, but real dependency fact says "
                     f"0 runtime dependencies")
    return None


def aggregate_number_contradiction(clean_text: str, known: dict) -> str | None:
    m = re.search(r"(\d+)\s*(?:个|条)\s*测试函数", clean_text)
    if m and known["total_tests"] is not None:
        n = int(m.group(1))
        if n != known["total_tests"]:
            return f"claims {n} test functions, real total is {known['total_tests']}"
    m = re.search(r"(\d+)\s*(?:个|条)\s*测试文件", clean_text)
    if m and known["total_test_files"] is not None:
        n = int(m.group(1))
        if n != known["total_test_files"]:
            return f"claims {n} test files, real total is {known['total_test_files']}"
    m = re.search(r"(\d+)\s*个\s*(?:运行时)?依赖", clean_text)
    if m and known["total_deps"] is not None:
        n = int(m.group(1))
        if n != known["total_deps"]:
            return f"claims {n} dependencies, real total is {known['total_deps']}"
    return None


def token_support_level(token: str, cited_ref: str, package_blob: str, full_blob: str, lower: bool = False) -> str:
    """Where can this token be found? cited > package > repo > none.

    'cited'   -- inside the reference text of the fact id(s) this exact
                 sentence attached ([Fxxxx]).
    'package' -- not in that citation, but present in the fact_package.json
                 the model was actually given (i.e. real, offered content
                 that just wasn't cited on this particular clause -- a
                 citation-hygiene gap, not a fabrication).
    'repo'    -- not offered to the model at all, but present somewhere in
                 the full 543-fact repo scan (content the model could not
                 plausibly have obtained from the given context).
    'none'    -- not found anywhere in the exhaustive repo scan.
    """
    needle = token.lower() if lower else token
    hay_cited = cited_ref.lower() if lower else cited_ref
    hay_pkg = package_blob.lower() if lower else package_blob
    hay_full = full_blob.lower() if lower else full_blob
    if needle in hay_cited:
        return "cited"
    if needle in hay_pkg:
        return "package"
    if needle in hay_full:
        return "repo"
    return "none"


def grounding_report(tokens: dict, cited_facts: list[dict], known: dict) -> dict:
    cited_ref = "\n".join(reference_text(f) for f in cited_facts)
    levels = {}
    for n in tokens["numbers"]:
        levels[f"number:{n}"] = token_support_level(n, cited_ref, known["package_blob"], known["full_blob"])
    for ident in tokens["identifiers"]:
        levels[f"identifier:{ident}"] = token_support_level(ident, cited_ref, known["package_blob"], known["full_blob"])
    for fw in tokens["frameworks"]:
        levels[f"framework:{fw}"] = token_support_level(fw, cited_ref, known["package_blob"], known["full_blob"], lower=True)
    return levels


def classify_statement(sentence: str, by_id: dict, known: dict) -> dict:
    clean, cited_ids = extract_citations(sentence)
    tokens = extract_claim_tokens(clean)
    record = {
        "sentence": sentence,
        "clean_text": clean,
        "cited_ids": cited_ids,
        "tokens": tokens,
    }
    if not has_specific_claim(tokens):
        record["primary"] = "not_a_factual_claim"
        record["closed_world"] = "not_a_factual_claim"
        record["detail"] = ""
        return record

    valid_ids = [i for i in cited_ids if i in by_id]
    invalid_ids = [i for i in cited_ids if i not in by_id]
    cited_facts = [by_id[i] for i in valid_ids]

    dep_c = dependency_contradiction(tokens, known)
    agg_c = aggregate_number_contradiction(clean, known)
    independent_contradiction = dep_c or agg_c

    levels = grounding_report(tokens, cited_facts, known)
    record["token_levels"] = levels
    worst = "cited"
    order = {"cited": 0, "package": 1, "repo": 2, "none": 3}
    for lvl in levels.values():
        if order[lvl] > order[worst]:
            worst = lvl
    undercited_tokens = [k for k, v in levels.items() if v == "package"]
    outofpackage_tokens = [k for k, v in levels.items() if v == "repo"]
    fabricated_tokens = [k for k, v in levels.items() if v == "none"]

    # --- primary (citation-bound, but tolerant of same-sentence under-citation
    #     of content that WAS offered in the package -- see token_support_level) ---
    if independent_contradiction:
        record["primary"] = "traceable_contradict"
        record["detail"] = independent_contradiction
    elif not valid_ids:
        record["primary"] = "untraceable"
        record["detail"] = (f"invalid citation ids: {invalid_ids}" if invalid_ids
                             else "no citation given")
    elif fabricated_tokens:
        record["primary"] = "traceable_contradict"
        record["detail"] = f"cited, but claims content absent from entire repo scan: {fabricated_tokens}"
    elif outofpackage_tokens:
        record["primary"] = "untraceable"
        record["detail"] = f"cited id resolves, but claim content was never offered to the model: {outofpackage_tokens}"
    else:
        record["primary"] = "traceable_correct"
        record["detail"] = (f"undercited but real/offered content: {undercited_tokens}" if undercited_tokens else "")

    # --- closed world (independent, ignores citation entirely) ---
    if independent_contradiction:
        record["closed_world"] = "traceable_contradict"
        record["closed_world_detail"] = independent_contradiction
    elif fabricated_tokens:
        code_shaped = [t.split(":", 1)[1] for t in fabricated_tokens
                        if t.startswith("identifier:") and
                        (CAMEL_RE.fullmatch(t.split(":", 1)[1]) or SNAKE_RE.fullmatch(t.split(":", 1)[1]))]
        if code_shaped:
            record["closed_world"] = "traceable_contradict"
            record["closed_world_detail"] = f"exhaustive-absence: {code_shaped} not found anywhere in repo scan"
        else:
            record["closed_world"] = "untraceable"
            record["closed_world_detail"] = f"not found anywhere: {fabricated_tokens}"
    else:
        record["closed_world"] = "traceable_correct"
        record["closed_world_detail"] = ""

    return record


def review_generation(text: str, by_id: dict, known: dict) -> dict:
    statements = split_statements(text)
    results = [classify_statement(s, by_id, known) for s in statements]
    tally_primary = {}
    tally_cw = {}
    for r in results:
        tally_primary[r["primary"]] = tally_primary.get(r["primary"], 0) + 1
        tally_cw[r["closed_world"]] = tally_cw.get(r["closed_world"], 0) + 1
    return {"statements": results, "tally_primary": tally_primary, "tally_closed_world": tally_cw}


def review_file(gen_path: Path, by_id: dict, known: dict) -> dict:
    text = gen_path.read_text(encoding="utf-8")
    return review_generation(text, by_id, known)


def main():
    by_id, known = load_facts()
    gen_files = sorted(OUT_DIR.glob(sys.argv[1] if len(sys.argv) > 1 else "gen_*.md"))
    gen_files = [g for g in gen_files if not g.stem.endswith("_all")]
    reviews_dir = SPIKE_DIR / "reviews"
    reviews_dir.mkdir(exist_ok=True)

    all_primary = {}
    all_cw = {}
    per_gen_summary = []
    for gf in gen_files:
        review = review_file(gf, by_id, known)
        out_path = reviews_dir / f"{gf.stem}_review.json"
        out_path.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")
        for k, v in review["tally_primary"].items():
            all_primary[k] = all_primary.get(k, 0) + v
        for k, v in review["tally_closed_world"].items():
            all_cw[k] = all_cw.get(k, 0) + v
        per_gen_summary.append({"file": gf.name, "primary": review["tally_primary"],
                                 "closed_world": review["tally_closed_world"]})
        print(f"{gf.name}: primary={review['tally_primary']} closed_world={review['tally_closed_world']}")

    summary = {"per_generation": per_gen_summary, "aggregate_primary": all_primary,
               "aggregate_closed_world": all_cw}
    (reviews_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2),
                                                encoding="utf-8")
    print("\nAGGREGATE primary:", all_primary)
    print("AGGREGATE closed_world:", all_cw)


if __name__ == "__main__":
    main()
