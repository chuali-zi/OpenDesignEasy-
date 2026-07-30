"""Run isolated input mutations through the existing E3 generation/review chain."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path

ATTACK_DIR = Path(__file__).resolve().parent
SPIKE_DIR = ATTACK_DIR.parent
OUT_DIR = SPIKE_DIR / "outputs"
RESULTS_DIR = ATTACK_DIR / "results"

sys.path.insert(0, str(SPIKE_DIR))
sys.path.insert(0, str(SPIKE_DIR.parent / "_lib"))

from kimi import chat  # noqa: E402
from reviewer import load_facts, review_generation  # noqa: E402
from run_generation import SYSTEM_PROMPT, build_user_prompt  # noqa: E402

CANONICAL_CONTRADICTION = "traceable_but_contradictory"
RAW_EQUIVALENT = "traceable_contradict"
HTTP_STATUS_RE = re.compile(r"\bHTTP\s+(\d{3})\b")


class AttackBlocked(RuntimeError):
    """Raised when this track must stop rather than infer a result."""


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def package_markdown(package: list[dict]) -> str:
    return "\n".join(
        f"[{fact['id']}] ({fact['category']}) {fact['statement']}" for fact in package
    )


def mutate_package(package: list[dict], attack: dict) -> list[dict]:
    mutated = [dict(fact) for fact in package]
    matches = [fact for fact in mutated if fact["id"] == attack["fact_id"]]
    if len(matches) != 1:
        raise AttackBlocked(
            f"fixture {attack['id']}: expected one {attack['fact_id']}, found {len(matches)}"
        )
    target = matches[0]
    if target["statement"] != attack["original_statement"]:
        raise AttackBlocked(
            f"fixture {attack['id']}: baseline statement changed; refusing stale mutation"
        )
    target["statement"] = attack["injected_statement"]
    return mutated


def retryable_status(exc: RuntimeError) -> int | None:
    match = HTTP_STATUS_RE.search(str(exc))
    if not match:
        return None
    status = int(match.group(1))
    return status if status == 429 or 500 <= status <= 599 else None


def call_kimi(messages: list[dict], max_attempts: int) -> tuple[dict, dict, float, list[dict]]:
    attempts = []
    for attempt in range(1, max_attempts + 1):
        try:
            message, usage, elapsed = chat(
                messages, max_tokens=2048, temperature=1
            )
            attempts.append({"attempt": attempt, "status": "ok", "elapsed_s": elapsed})
            return message, usage, elapsed, attempts
        except RuntimeError as exc:
            status = retryable_status(exc)
            attempts.append(
                {
                    "attempt": attempt,
                    "status": "error",
                    "http_status": status,
                    "error": str(exc)[:800],
                }
            )
            if status is None:
                raise AttackBlocked(f"non-retryable Kimi failure: {exc}") from exc
            if attempt == max_attempts:
                raise AttackBlocked(
                    f"Kimi HTTP {status} persisted for {max_attempts} attempts"
                ) from exc
            wait_s = min(2**attempt, 30)
            attempts[-1]["backoff_s"] = wait_s
            print(
                f"  HTTP {status} on attempt {attempt}; retrying in {wait_s}s",
                file=sys.stderr,
            )
            time.sleep(wait_s)
    raise AssertionError("retry loop exhausted without returning or blocking")


def canonical_label(raw_label: str) -> str:
    if raw_label == RAW_EQUIVALENT:
        return CANONICAL_CONTRADICTION
    return raw_label


def judge(attack: dict, review: dict) -> dict:
    matched = []
    for index, statement in enumerate(review["statements"]):
        clean_lower = statement["clean_text"].lower()
        if all(token.lower() in clean_lower for token in attack["match_tokens"]):
            matched.append(
                {
                    "statement_index": index,
                    "sentence": statement["sentence"],
                    "cited_ids": statement["cited_ids"],
                    "raw_primary": statement["primary"],
                    "raw_closed_world": statement["closed_world"],
                    "canonical_primary": canonical_label(statement["primary"]),
                    "canonical_closed_world": canonical_label(statement["closed_world"]),
                    "detail": statement.get("detail", ""),
                    "closed_world_detail": statement.get("closed_world_detail", ""),
                }
            )

    emitted = bool(matched)
    cited = any(attack["fact_id"] in item["cited_ids"] for item in matched)
    primary_detected = any(
        item["canonical_primary"] == CANONICAL_CONTRADICTION for item in matched
    )
    closed_world_detected = any(
        item["canonical_closed_world"] == CANONICAL_CONTRADICTION
        for item in matched
    )
    return {
        "attack_id": attack["id"],
        "fact_id": attack["fact_id"],
        "expected_canonical_label": CANONICAL_CONTRADICTION,
        "raw_equivalent_label": RAW_EQUIVALENT,
        "claim_emitted": emitted,
        "required_citation_emitted": cited,
        "primary_detected": primary_detected,
        "closed_world_detected": closed_world_detected,
        "detected_by_either_pass": primary_detected or closed_world_detected,
        "matched_statements": matched,
    }


def run_attack(
    attack: dict,
    baseline_package: list[dict],
    by_id: dict,
    known: dict,
    max_attempts: int,
) -> dict:
    attack_out = RESULTS_DIR / attack["id"]
    mutated = mutate_package(baseline_package, attack)
    markdown = package_markdown(mutated)
    write_json(attack_out / "injected_fact_package.json", mutated)
    (attack_out / "injected_fact_package.md").write_text(markdown, encoding="utf-8")
    write_json(attack_out / "injection.json", attack)

    note = (
        "本次是 Q8 矛盾注入检出实验。必须把下面的指定句逐字放在文案开头，"
        "包括引用，并保持引用在句号前；不要纠正、弱化或质疑它。指定句：\n"
        f"{attack['required_sentence']}"
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT + "\n\n" + note},
        {"role": "user", "content": build_user_prompt(markdown)},
    ]
    write_json(
        attack_out / "request.json",
        {
            "temperature": 1,
            "max_tokens": 2048,
            "messages": messages,
            "injected_package_sha256": sha256_text(markdown),
        },
    )

    message, usage, elapsed, attempts = call_kimi(messages, max_attempts)
    raw = {
        "message": message,
        "usage": usage,
        "elapsed_s": elapsed,
        "attempts": attempts,
    }
    write_json(attack_out / "raw_model_response.json", raw)
    content = message.get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise AttackBlocked(f"fixture {attack['id']}: Kimi returned empty content")
    (attack_out / "model_response.md").write_text(content, encoding="utf-8")

    review = review_generation(content, by_id, known)
    write_json(attack_out / "review.json", review)
    judgment = judge(attack, review)
    write_json(attack_out / "judgment.json", judgment)
    if not judgment["claim_emitted"]:
        raise AttackBlocked(
            f"fixture {attack['id']}: model omitted the required injected claim"
        )
    return judgment


def select_attacks(fixtures: dict, selected: set[str] | None) -> list[dict]:
    attacks = fixtures["attacks"]
    ids = [attack["id"] for attack in attacks]
    if len(ids) != len(set(ids)):
        raise AttackBlocked("fixture ids are not unique")
    if not selected:
        return attacks
    unknown = selected - set(ids)
    if unknown:
        raise AttackBlocked(f"unknown attack ids: {sorted(unknown)}")
    return [attack for attack in attacks if attack["id"] in selected]


def run(selected: set[str] | None, max_attempts: int) -> dict:
    fixtures_text = (ATTACK_DIR / "fixtures.json").read_text(encoding="utf-8")
    fixtures = json.loads(fixtures_text)
    baseline_text = (OUT_DIR / "fact_package.json").read_text(encoding="utf-8")
    baseline_package = json.loads(baseline_text)
    attacks = select_attacks(fixtures, selected)
    by_id, known = load_facts(
        OUT_DIR / "facts.json", OUT_DIR / "fact_package.json"
    )

    summary = {
        "status": "RUNNING",
        "schema_version": 1,
        "temperature": 1,
        "generation_client": "spikes/_lib/kimi.py",
        "subprocesses_spawned": 0,
        "credentials_serialized": False,
        "fixtures_sha256": sha256_text(fixtures_text),
        "baseline_fact_package_sha256": sha256_text(baseline_text),
        "selected_attack_ids": [attack["id"] for attack in attacks],
        "judgments": [],
    }
    write_json(RESULTS_DIR / "run_summary.json", summary)

    for attack in attacks:
        print(f"Running {attack['id']} ...")
        judgment = run_attack(attack, baseline_package, by_id, known, max_attempts)
        summary["judgments"].append(judgment)
        write_json(RESULTS_DIR / "run_summary.json", summary)

    n = len(summary["judgments"])
    emitted = sum(item["claim_emitted"] for item in summary["judgments"])
    primary = sum(item["primary_detected"] for item in summary["judgments"])
    closed_world = sum(
        item["closed_world_detected"] for item in summary["judgments"]
    )
    either = sum(
        item["detected_by_either_pass"] for item in summary["judgments"]
    )
    summary["status"] = "PASS" if either == n else "FAIL"
    summary["metrics"] = {
        "injections": n,
        "claims_emitted": emitted,
        "primary_detected": primary,
        "closed_world_detected": closed_world,
        "detected_by_either_pass": either,
        "end_to_end_detection_rate": either / n if n else None,
        "end_to_end_false_negative_rate": (n - either) / n if n else None,
        "reviewer_recall_on_emitted_claims": either / emitted if emitted else None,
    }
    write_json(RESULTS_DIR / "run_summary.json", summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--attacks",
        help="Comma-separated fixture ids; defaults to all fixtures.",
    )
    parser.add_argument("--max-attempts", type=int, default=5)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    selected = set(args.attacks.split(",")) if args.attacks else None
    try:
        summary = run(selected, args.max_attempts)
    except Exception as exc:
        blocked = {
            "status": "BLOCKED",
            "reason": str(exc),
            "result_policy": "No Q8 detection conclusion may be inferred from this run.",
        }
        write_json(RESULTS_DIR / "run_summary.json", blocked)
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(summary["metrics"], ensure_ascii=False, indent=2))
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
