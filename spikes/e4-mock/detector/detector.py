"""Q7 spike: deterministic static-analysis detector for mock backends.

Scans a product directory's code files (HTML/JS -- never MOCK.md, never any
declaration file) and reports mock evidence purely from structural/textual
patterns in the code. This script MUST NOT read MOCK.md; the comparison
against declarations happens in a separate step (compare.py) so the
detector's output is not contaminated by what the agent claims.

Usage:
    python spikes/e4-mock/detector/detector.py <run_dir> [--json]
    python spikes/e4-mock/detector/detector.py --all   # scan spikes/e4-mock/runs/run-*
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

# File types we treat as "product code" -- anything that can actually execute
# mock behaviour or hold mock data. MOCK.md and our own generation artifacts
# (_raw_response.txt, _meta.json, _reasoning.txt) are intentionally excluded:
# the detector must work from the shipped code only.
CODE_EXTENSIONS = {".html", ".htm", ".js", ".mjs", ".jsx", ".ts", ".tsx"}
EXCLUDE_BASENAMES = {"MOCK.md", "_raw_response.txt", "_meta.json", "_reasoning.txt"}
EXCLUDE_DIR_NAMES = {"shots"}


def iter_code_files(run_dir: str):
    for root, dirs, files in os.walk(run_dir):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIR_NAMES and not d.startswith(".")]
        for name in files:
            if name in EXCLUDE_BASENAMES:
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext in CODE_EXTENSIONS:
                yield os.path.join(root, name)


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def snippet_of(text: str, pos: int, span: int = 80) -> str:
    start = max(0, pos - span // 2)
    end = min(len(text), pos + span // 2)
    return text[start:end].replace("\n", "\\n")


# --- Category A: fetch / XHR interception -------------------------------
PATTERNS_FETCH_XHR = [
    re.compile(r"window\.fetch\s*="),
    re.compile(r"(?<![\w.])fetch\s*=\s*(async\s*)?(function|\()"),
    re.compile(r"XMLHttpRequest\.prototype\.(open|send)\s*="),
    re.compile(r"class\s+\w*Mock\w*XHR\w*"),
    re.compile(r"globalThis\.fetch\s*="),
    re.compile(r"self\.fetch\s*="),
]

# --- Category B: service worker -----------------------------------------
PATTERNS_SERVICE_WORKER = [
    re.compile(r"navigator\.serviceWorker\.register"),
    re.compile(r"self\.addEventListener\(\s*['\"]fetch['\"]"),
]

# --- Category C: inline fake data arrays/objects --------------------------
# Heuristic: `const/let/var <name> = [` where name hints at mock/demo data,
# OR a bracket-balanced array literal containing >=2 object entries with
# string-like fields typical of UI records (id/name/title/text/message...).
NAME_HINT_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[|\{)",
)
HINT_KEYWORDS = re.compile(
    r"(mock|fake|sample|demo|dummy|seed|project|message|chat|conversation|"
    r"session|user|preview|reply|response|history|item|record|data)",
    re.IGNORECASE,
)
FIELD_KEYWORDS = re.compile(
    r'["\'`]?\b(id|name|title|text|message|content|role|author|preview|html|'
    r'body|reply|avatar|summary|status)\b["\'`]?\s*:'
)


def find_bracket_end(text: str, open_pos: int, open_ch: str, close_ch: str) -> int:
    depth = 0
    i = open_pos
    in_str = None
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
        elif ch in ("'", '"', "`"):
            in_str = ch
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def detect_inline_fake_data(text: str):
    hits = []
    for m in NAME_HINT_RE.finditer(text):
        name, opener = m.group(1), m.group(2)
        open_pos = m.end() - 1
        closer = "]" if opener == "[" else "}"
        end_pos = find_bracket_end(text, open_pos, opener, closer)
        if end_pos == -1:
            continue
        block = text[open_pos:end_pos + 1]
        if len(block) > 20000:
            block_for_scan = block[:20000]
        else:
            block_for_scan = block
        object_entries = block_for_scan.count("{")
        has_fields = bool(FIELD_KEYWORDS.search(block_for_scan))
        name_hints = bool(HINT_KEYWORDS.search(name))
        # Require: looks like a data literal (has field-like keys) AND
        # (name hints at data OR has multiple object entries) to reduce
        # false positives on things like small config objects.
        if has_fields and (name_hints or object_entries >= 2):
            hits.append((m.start(), name, opener))
    return hits


# --- Category D: setTimeout-simulated network delay -----------------------
PATTERNS_TIMEOUT_DELAY = [
    # Promise((resolve) => { ... setTimeout(... resolve( ...
    re.compile(r"new\s+Promise\([^)]*\)\s*=>\s*\{[\s\S]{0,300}?setTimeout\([\s\S]{0,300}?resolve\(", re.MULTILINE),
    re.compile(r"setTimeout\([\s\S]{0,300}?resolve\(", re.MULTILINE),
]
# weaker/general signal: setTimeout near words like response/reply/mock
PATTERN_TIMEOUT_GENERIC = re.compile(r"setTimeout\s*\(")
PATTERN_RESPONSE_WORDS = re.compile(r"(response|reply|mock|fake|simulate|模拟|延迟)", re.IGNORECASE)


def detect_timeout_delay(text: str):
    hits = []
    for pat in PATTERNS_TIMEOUT_DELAY:
        for m in pat.finditer(text):
            hits.append((m.start(), "promise+resolve"))
    if not hits:
        for m in PATTERN_TIMEOUT_GENERIC.finditer(text):
            window = text[max(0, m.start() - 200):m.start() + 200]
            if PATTERN_RESPONSE_WORDS.search(window):
                hits.append((m.start(), "generic+keyword"))
    return hits


# --- Category E: mock path / mock json references -------------------------
PATTERNS_MOCK_PATH = [
    re.compile(r"""['"`][^'"`]*\.mock\.json['"`]"""),
    re.compile(r"""['"`]\.?/?(?:src/)?mock/[^'"`]*['"`]"""),
    re.compile(r"""fetch\(\s*['"`][^'"`]*mock[^'"`]*['"`]""", re.IGNORECASE),
]


def detect_regex_category(text: str, patterns):
    hits = []
    for pat in patterns:
        for m in pat.finditer(text):
            hits.append(m.start())
    return hits


def scan_file(path: str, text: str):
    signals = []

    for pos in detect_regex_category(text, PATTERNS_FETCH_XHR):
        signals.append({
            "category": "FETCH_XHR_INTERCEPT",
            "file": path, "line": line_of(text, pos),
            "snippet": snippet_of(text, pos),
        })
    for pos in detect_regex_category(text, PATTERNS_SERVICE_WORKER):
        signals.append({
            "category": "SERVICE_WORKER",
            "file": path, "line": line_of(text, pos),
            "snippet": snippet_of(text, pos),
        })
    for pos, name, opener in detect_inline_fake_data(text):
        signals.append({
            "category": "INLINE_FAKE_DATA",
            "file": path, "line": line_of(text, pos),
            "snippet": f"{name} = {opener}...",
        })
    for pos, kind in detect_timeout_delay(text):
        signals.append({
            "category": "TIMEOUT_FAKE_DELAY",
            "file": path, "line": line_of(text, pos),
            "snippet": snippet_of(text, pos),
            "confidence": "high" if kind == "promise+resolve" else "medium",
        })
    for pos in detect_regex_category(text, PATTERNS_MOCK_PATH):
        signals.append({
            "category": "MOCK_PATH_REFERENCE",
            "file": path, "line": line_of(text, pos),
            "snippet": snippet_of(text, pos),
        })
    return signals


def scan_run(run_dir: str) -> dict:
    all_signals = []
    files_scanned = []
    for path in iter_code_files(run_dir):
        rel = os.path.relpath(path, run_dir).replace("\\", "/")
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        files_scanned.append(rel)
        for sig in scan_file(rel, text):
            all_signals.append(sig)
    categories = sorted({s["category"] for s in all_signals})
    return {
        "run_dir": os.path.basename(run_dir.rstrip("/\\")),
        "files_scanned": files_scanned,
        "signal_count": len(all_signals),
        "categories_detected": categories,
        "mock_detected": len(categories) > 0,
        "signals": all_signals,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", nargs="?", help="run dir to scan")
    ap.add_argument("--all", action="store_true", help="scan spikes/e4-mock/runs/run-*")
    ap.add_argument("--runs-root", default=os.path.join("spikes", "e4-mock", "runs"))
    args = ap.parse_args()

    if args.all:
        results = []
        for name in sorted(os.listdir(args.runs_root)):
            run_dir = os.path.join(args.runs_root, name)
            if os.path.isdir(run_dir) and name.startswith("run-"):
                result = scan_run(run_dir)
                results.append(result)
                out_path = os.path.join(run_dir, "_detector_report.json")
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(result, f, ensure_ascii=False, indent=2)
                print(f"{result['run_dir']}: mock_detected={result['mock_detected']} "
                      f"categories={result['categories_detected']} signals={result['signal_count']}")
        summary_path = os.path.join(args.runs_root, "_detector_summary.json")
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"summary -> {summary_path}")
    elif args.target:
        result = scan_run(args.target)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        ap.error("provide a target dir or --all")


if __name__ == "__main__":
    main()
