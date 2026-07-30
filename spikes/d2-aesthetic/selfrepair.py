"""D2/E2 spike, step 2: self-verification + self-repair loop (agent-engine-spec.md
SS6). For each candidate, generated independently in generate_candidates.py:

  round 1: render the freshly generated v1 code, screenshot + collect console
            errors/warnings, failed requests, page errors, viewport overflow
            (all deterministic, code-only measurements -- lib/checks.py).
  round R (R=2,3): send the PREVIOUS round's screenshot (base64 data URI) back
            to k3 along with the objective signals, ask it to look at its own
            render and either declare NO_ISSUES or list concrete issues + emit
            full replacement content for the changed files only. Apply changes,
            re-render, screenshot round R. Stop early if NO_ISSUES.

This script does NOT judge whether the visual result improved -- it only
records what the model *said* (issue count, which files it touched) and what
the deterministic checks measured (error/overflow counts per round). Whether
those changes made the page better-looking is explicitly left for human review
(see spikes/d2-aesthetic/RESULT.md and review.html).

Usage: python spikes/d2-aesthetic/selfrepair.py [cand_ids...]
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.join("spikes", "_lib"))
sys.path.insert(0, os.path.join("spikes", "d2-aesthetic", "lib"))
from kimi import chat  # noqa: E402
from blocks import parse_files, write_files  # noqa: E402
from render_util import render_and_measure  # noqa: E402

ROOT = os.path.join("spikes", "d2-aesthetic")
CAND_ROOT = os.path.join(ROOT, "candidates")
SHOTS_ROOT = os.path.join(ROOT, "shots")
MAX_ROUNDS = 3

ISSUES_RE = re.compile(r"<<<ISSUES>>>\s*(.*?)\s*<<<END_ISSUES>>>", re.DOTALL)


def chat_with_retry(messages, *, max_tokens, max_retries=5):
    delay = 5
    for attempt in range(1, max_retries + 1):
        try:
            return chat(messages, max_tokens=max_tokens, temperature=1, timeout=1200)
        except (RuntimeError, TimeoutError) as exc:
            msg = str(exc)
            is_retryable = isinstance(exc, TimeoutError) or msg.startswith("HTTP 429") or msg.startswith("HTTP 5")
            if not is_retryable or attempt == max_retries:
                raise
            print(f"    retryable error ({msg[:150]}), backing off {delay}s", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 60)


def load_files(version_dir: str) -> dict[str, str]:
    files = {}
    for dirpath, _dirnames, filenames in os.walk(version_dir):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, version_dir).replace("\\", "/")
            try:
                with open(full, "r", encoding="utf-8") as f:
                    files[rel] = f.read()
            except UnicodeDecodeError:
                pass  # skip binary, none expected at this stage
    return files


def png_data_uri(path: str) -> str:
    with open(path, "rb") as f:
        b = f.read()
    return "data:image/png;base64," + base64.b64encode(b).decode("ascii")


def summarize(items: list[str], n=5) -> list[str]:
    return items[:n]


def build_repair_prompt(cand_id: int, axis_label: str, intent_text: str, round_no: int,
                         render_result: dict) -> str:
    ov = render_result.get("overflow") or {}
    ov_count = ov.get("overflow_count", 0)
    ov_examples = [e.get("selector") for e in ov.get("overflow_elements", [])][:5]
    return f"""你正在为你自己在第一步生成的 OEYdesign agent 工作台候选做自我验证（延续你自己的
工作区，候选 {cand_id}，差异轴：{axis_label}）。你当时给出的设计意图是：

{intent_text[:1500]}

下面是这份代码在真实 Chrome（1440x900 视口）渲染后的截图（第 {round_no} 轮），以及自动化检查
拿到的客观信号（这些数字和列表是真实测得的，不是猜测）：

- console error 数量：{len(render_result['console_errors'])}，示例：{summarize(render_result['console_errors'])}
- console warning 数量：{len(render_result['console_warnings'])}
- 请求失败数量：{len(render_result['failed_requests'])}，示例：{summarize(render_result['failed_requests'])}
- 未捕获异常数量：{len(render_result['page_errors'])}，示例：{summarize(render_result['page_errors'])}
- 视口宽度内溢出的元素数量：{ov_count}，示例选择器：{ov_examples}
- 页面是否成功加载：{render_result['load_ok']}

请你像真的在做自验证一样：仔细看这张截图，结合上面的客观信号，找出你认为存在的问题（可以是
功能没跑通、data-oey 锚点缺失或位置不对、布局溢出/重叠/截断、对比度太低难以辨认、也可以是你
自己发现的其它具体问题）。不要为了凑数量硬找问题，也不要因为怕麻烦而忽略明显问题。

如果你发现了问题：把每条问题写成一句话放进一个 JSON 字符串数组，然后只输出【发生了变化】的
文件的完整新内容（没变化的文件不要重复输出，也不要输出你没有改动的文件）。

如果你确认没有问题、这一版已经达到你认为完成的状态：JSON 数组留空 `[]`，并且不要输出任何
文件块。

输出格式（严格遵守，除下面的标记块外不要输出任何其它文字、不要寒暄、不要解释、不要用 markdown
代码围栏）：

<<<ISSUES>>>
["问题描述 1", "问题描述 2"]
<<<END_ISSUES>>>
<<<FILE: 相对路径/文件名>>>
文件的完整新内容
<<<END>>>
(如有更多变化的文件，继续按上面格式追加；如果 ISSUES 为空数组，这里不要有任何 FILE 块)"""


def run_repair_round(cand_id: int, axis_label: str, intent_text: str, round_no: int,
                      render_result: dict, screenshot_path: str) -> dict:
    prompt = build_repair_prompt(cand_id, axis_label, intent_text, round_no, render_result)
    messages = [
        {
            "role": "system",
            "content": "You output only the requested marker blocks in the exact format "
            "given by the user. No prose before, between, or after them.",
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": png_data_uri(screenshot_path)}},
            ],
        },
    ]
    msg, usage, elapsed = chat_with_retry(messages, max_tokens=16000)
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning_content") or ""

    issues: list[str] = []
    m = ISSUES_RE.search(content)
    if m:
        raw = m.group(1).strip()
        try:
            issues = json.loads(raw)
            if not isinstance(issues, list):
                issues = [str(issues)]
        except json.JSONDecodeError:
            issues = [raw] if raw and raw != "[]" else []

    changed_files = parse_files(content)

    return {
        "issues": issues,
        "changed_files": changed_files,
        "usage": usage,
        "elapsed_s": round(elapsed, 1),
        "raw_response_chars": len(content),
        "_raw_content": content,
        "_reasoning": reasoning,
    }


def repair_one_candidate(cand_id: int, axis_label: str) -> dict:
    v1_dir = os.path.join(CAND_ROOT, f"cand{cand_id}", "v1")
    if not os.path.isdir(v1_dir):
        raise FileNotFoundError(f"no v1 dir for cand{cand_id}, run generate_candidates.py first")

    intent_path = os.path.join(v1_dir, "INTENT.md")
    intent_text = ""
    if os.path.isfile(intent_path):
        with open(intent_path, "r", encoding="utf-8") as f:
            intent_text = f.read()

    current_files = load_files(v1_dir)
    current_version_dir = v1_dir
    rounds_log = []

    for round_no in range(1, MAX_ROUNDS + 1):
        shot_path = os.path.join(SHOTS_ROOT, f"cand{cand_id}_round{round_no}.png")
        entry_dir = Path(current_version_dir)
        print(f"  [cand{cand_id}] round {round_no}: rendering {entry_dir} ...", flush=True)
        render_result = render_and_measure(entry_dir, "index.html", Path(shot_path))
        round_entry = {
            "round": round_no,
            "source_version_dir": current_version_dir,
            "screenshot": shot_path,
            "console_error_count": len(render_result["console_errors"]),
            "console_warning_count": len(render_result["console_warnings"]),
            "failed_request_count": len(render_result["failed_requests"]),
            "page_error_count": len(render_result["page_errors"]),
            "overflow_count": (render_result.get("overflow") or {}).get("overflow_count"),
            "load_ok": render_result["load_ok"],
            "console_errors": render_result["console_errors"],
            "failed_requests": render_result["failed_requests"],
            "page_errors": render_result["page_errors"],
            "overflow_elements": (render_result.get("overflow") or {}).get("overflow_elements"),
        }

        if round_no == MAX_ROUNDS:
            round_entry["model_review"] = None
            rounds_log.append(round_entry)
            break

        print(f"  [cand{cand_id}] round {round_no}: asking model to self-review ...", flush=True)
        try:
            review = run_repair_round(cand_id, axis_label, intent_text, round_no, render_result, shot_path)
        except Exception as exc:  # noqa: BLE001
            print(f"  [cand{cand_id}] round {round_no}: model review FAILED: {exc}", flush=True)
            round_entry["model_review"] = {"error": str(exc)}
            rounds_log.append(round_entry)
            break

        round_entry["model_review"] = {
            "issue_count": len(review["issues"]),
            "issues": review["issues"],
            "files_changed": sorted(review["changed_files"].keys()),
            "files_changed_count": len(review["changed_files"]),
            "usage": review["usage"],
            "elapsed_s": review["elapsed_s"],
        }
        rounds_log.append(round_entry)

        raw_dir = os.path.join(CAND_ROOT, f"cand{cand_id}")
        with open(os.path.join(raw_dir, f"_raw_repair_round{round_no}.txt"), "w", encoding="utf-8") as f:
            f.write(review["_raw_content"])
        if review["_reasoning"]:
            with open(os.path.join(raw_dir, f"_reasoning_repair_round{round_no}.txt"), "w", encoding="utf-8") as f:
                f.write(review["_reasoning"])

        if not review["issues"] and not review["changed_files"]:
            print(f"  [cand{cand_id}] round {round_no}: model declared NO_ISSUES, stopping", flush=True)
            break

        next_version_dir = os.path.join(CAND_ROOT, f"cand{cand_id}", f"v{round_no + 1}")
        os.makedirs(next_version_dir, exist_ok=True)
        for rel, content in current_files.items():
            full = os.path.join(next_version_dir, rel)
            os.makedirs(os.path.dirname(full) or next_version_dir, exist_ok=True)
            with open(full, "w", encoding="utf-8") as f:
                f.write(content)
        write_files(next_version_dir, review["changed_files"])
        current_files = {**current_files, **review["changed_files"]}
        current_version_dir = next_version_dir

    final_dir = os.path.join(CAND_ROOT, f"cand{cand_id}", "final")
    os.makedirs(final_dir, exist_ok=True)
    for rel, content in current_files.items():
        full = os.path.join(final_dir, rel)
        os.makedirs(os.path.dirname(full) or final_dir, exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)

    result = {
        "cand_id": cand_id,
        "rounds": rounds_log,
        "rounds_used": len(rounds_log),
        "final_version_dir": final_dir,
        "final_screenshot": rounds_log[-1]["screenshot"],
    }
    with open(os.path.join(CAND_ROOT, f"cand{cand_id}", "rounds.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    return result


AXIS_LABELS = {
    1: "叙事框架 / narrative metaphor",
    2: "版式结构 / layout & information architecture",
    3: "色彩温度与基调 / color temperature & mood",
    4: "信息密度与节奏 / information density & rhythm",
}


if __name__ == "__main__":
    ids = [int(a) for a in sys.argv[1:]] or [1, 2, 3, 4]
    os.makedirs(SHOTS_ROOT, exist_ok=True)
    all_results = []
    for cid in ids:
        print(f"=== self-repair cand{cid} ===", flush=True)
        t0 = time.time()
        try:
            res = repair_one_candidate(cid, AXIS_LABELS[cid])
            print(f"  done: rounds_used={res['rounds_used']} wall={time.time()-t0:.1f}s", flush=True)
            all_results.append(res)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED cand{cid}: {exc}", flush=True)
            all_results.append({"cand_id": cid, "error": str(exc)})
    summary_path = os.path.join(CAND_ROOT, "_repair_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"summary written to {summary_path}")
