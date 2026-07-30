"""A4: does materialization (single-file -> index.html+styles.css+assets/)
change the rendered result?

10 trials. Each trial: ask k3 for one self-contained single-file HTML page
(inline <style>, one inline data: URI asset, data-oey-* anchors), render it,
deterministically materialize-split it, render the split version, diff.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import shutil
import socket
import sys
import time
import traceback
import urllib.error
from pathlib import Path

from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
SPIKE_ROOT = HERE.parent
sys.path.insert(0, str(SPIKE_ROOT / "lib"))
sys.path.insert(0, str(SPIKE_ROOT.parent / "_lib"))

from kimi import API_KEY, chat  # noqa: E402
from htmlutil import materialize_single_file  # noqa: E402
from render import render_file_to_png  # noqa: E402
from diffpng import diff_images  # noqa: E402

TOPICS = [
    "一家精品咖啡店的落地页", "一款个人理财App的介绍页", "一个自由职业设计师的作品集主页",
    "一家瑜伽工作室的课程报名页", "一款开源命令行工具的文档首页", "一家本地面包店的菜单展示页",
    "一个线上读书会的活动页", "一款智能家居设备的产品页", "一家宠物寄养服务的落地页",
    "一个城市马拉松赛事的报名页",
]

MODEL = "k3"
MAX_TOKENS = 16000
API_TIMEOUT_S = 600
RETRY_MAX_ATTEMPTS = 4
RETRY_BASE_DELAY_S = 5

_DATA_URI_RE = re.compile(
    r"data:([a-z0-9.+-]+/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)",
    re.IGNORECASE,
)
_EXTERNAL_URL_RE = re.compile(r"^(?:https?|ftp):/{2}|^//", re.IGNORECASE)
_MOTION_RE = re.compile(
    r"@keyframes\b|(?:^|[;{])\s*(?:-[a-z]+-)?(?:animation|transition)(?:-[a-z-]+)?\s*:"
    r"|requestAnimationFrame\s*\(|\.animate\s*\(",
    re.IGNORECASE | re.MULTILINE,
)

SYSTEM_PROMPT = """你是一个前端代码生成器。只输出代码，不输出任何解释性文字，不要用 markdown 代码块包裹。"""

USER_TEMPLATE = """生成一个单文件 HTML 页面，主题：{topic}

硬性要求：
1. 整个页面必须是一个独立的 .html 文件：所有 CSS 写在一个 <style> 标签内（放在 <head> 里），不引用任何外部 CSS/JS/字体文件。
2. 至少 3 个顶层区块，每个区块的最外层容器打上 data-oey-section="区块名" 属性（英文小写短横线命名）。
3. 每个区块内至少 2 个可编辑元素（标题/正文/按钮/图片等），打上 data-oey-object="区块名.元素名" 属性。
4. 页面中至少有一处图片资源，用内联 base64 data URI 引用（可以是一个简单的 SVG 图标，通过 <img src="data:image/svg+xml;base64,...."> 或 CSS background-image 引用）。
5. 字体只用系统字体栈（如 -apple-system, "Segoe UI", sans-serif），不要 @import 或 @font-face 外部字体。
6. 不要使用 CSS 动画、transition、@keyframes，不要显示当前时间/随机数等非确定性内容（这是渲染截图比对的测试要求，必须遵守）。
7. 不要引用任何外部 URL（无 http(s):// 资源、无 CDN、无外链）。
8. 控制在 300 行以内；使用紧凑 CSS 和一个很小的 SVG data URI，不要为了视觉丰富堆叠重复卡片或长文案。
9. 只输出完整 HTML 代码本身，不要任何解释文字，不要 markdown 围栏。
"""


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def _redact(value):
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if key.lower() in {"api_key", "authorization", "access_token"} else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, str):
        redacted = value.replace(API_KEY, "[REDACTED]") if API_KEY else value
        return re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", redacted, flags=re.IGNORECASE)
    return value


def validate_html(html: str) -> dict:
    errors = []
    stripped = html.strip()
    if not stripped:
        return {"valid": False, "errors": ["empty response"], "section_count": 0, "object_counts": [], "decodable_data_uri_count": 0}

    if not re.match(r"^<!doctype\s+html\s*>", stripped, re.IGNORECASE):
        errors.append("missing leading <!doctype html>")
    if not re.search(r"</html>\s*$", stripped, re.IGNORECASE):
        errors.append("missing trailing </html>")

    for tag in ("html", "head", "body"):
        opens = len(re.findall(rf"<{tag}\b[^>]*>", stripped, re.IGNORECASE))
        closes = len(re.findall(rf"</{tag}\s*>", stripped, re.IGNORECASE))
        if opens != 1 or closes != 1:
            errors.append(f"{tag} must have exactly one opening and closing tag (got {opens}/{closes})")

    style_opens = len(re.findall(r"<style\b[^>]*>", stripped, re.IGNORECASE))
    style_closes = len(re.findall(r"</style\s*>", stripped, re.IGNORECASE))
    if style_opens < 1 or style_opens != style_closes:
        errors.append(f"style must be present and fully closed (got {style_opens}/{style_closes})")

    soup = BeautifulSoup(stripped, "lxml")
    sections = list(soup.find_all(attrs={"data-oey-section": True}))
    object_counts = [len(section.find_all(attrs={"data-oey-object": True})) for section in sections]
    if len(sections) < 3:
        errors.append(f"requires at least 3 data-oey-section elements (got {len(sections)})")
    for index, count in enumerate(object_counts, start=1):
        if count < 2:
            errors.append(f"section {index} requires at least 2 data-oey-object descendants (got {count})")

    decodable_data_uris = 0
    for match in _DATA_URI_RE.finditer(stripped):
        try:
            raw = base64.b64decode(match.group(2), validate=True)
        except (ValueError, base64.binascii.Error):
            continue
        if match.group(1).lower().startswith("image/") and raw:
            decodable_data_uris += 1
    if decodable_data_uris < 1:
        errors.append("requires at least 1 decodable base64 image data URI")

    style_text = "\n".join(tag.get_text() for tag in soup.find_all("style"))
    url_values = []
    for tag in soup.find_all(True):
        for attr in ("href", "src", "action", "formaction", "poster", "cite"):
            value = tag.get(attr)
            if isinstance(value, str):
                url_values.append(value.strip())
    css_urls = re.findall(r"(?:url\s*\(|@import\s+)[\"']?([^\"')\s;]+)", style_text, re.IGNORECASE)
    if any(_EXTERNAL_URL_RE.search(value) for value in url_values + css_urls):
        errors.append("external URL is forbidden")

    inline_styles = "\n".join(str(tag.get("style")) for tag in soup.find_all(style=True))
    scripts = "\n".join(tag.get_text() for tag in soup.find_all("script"))
    motion_source = "\n".join((style_text, inline_styles, scripts))
    if soup.find("marquee") or _MOTION_RE.search(motion_source):
        errors.append("animation or transition is forbidden")

    return {
        "valid": not errors,
        "errors": errors,
        "section_count": len(sections),
        "object_counts": object_counts,
        "decodable_data_uri_count": decodable_data_uris,
    }


def _is_retryable_api_error(exc: Exception) -> bool:
    message = str(exc)
    return (
        isinstance(exc, (TimeoutError, socket.timeout, urllib.error.URLError))
        or bool(re.search(r"HTTP (?:429|5\d\d)\b", message))
    )


def get_page(topic: str, trial_dir: Path) -> tuple[str, dict, float, dict]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": USER_TEMPLATE.format(topic=topic)},
    ]
    delay = RETRY_BASE_DELAY_S
    last_problem = "generation failed"
    for attempt in range(1, RETRY_MAX_ATTEMPTS + 1):
        started = time.perf_counter()
        try:
            msg, usage, elapsed = chat(
                messages,
                model=MODEL,
                max_tokens=MAX_TOKENS,
                temperature=1,
                timeout=API_TIMEOUT_S,
            )
        except Exception as exc:  # noqa: BLE001
            wall_elapsed = time.perf_counter() - started
            retryable = _is_retryable_api_error(exc)
            last_problem = f"API error: {exc}"
            _write_json(
                trial_dir / f"generation_attempt_{attempt:02d}.json",
                {
                    "attempt": attempt,
                    "message": None,
                    "usage": {},
                    "elapsed_s": round(wall_elapsed, 3),
                    "validation": {"valid": False, "errors": [_redact(last_problem)]},
                    "retryable": retryable,
                },
            )
            if not retryable or attempt == RETRY_MAX_ATTEMPTS:
                raise RuntimeError(last_problem) from exc
        else:
            content = msg.get("content") or ""
            html = content.strip()
            validation = validate_html(html)
            _write_json(
                trial_dir / f"generation_attempt_{attempt:02d}.json",
                {
                    "attempt": attempt,
                    "message": _redact(msg),
                    "usage": _redact(usage),
                    "elapsed_s": elapsed,
                    "validation": validation,
                    "retryable": not validation["valid"],
                },
            )
            if validation["valid"]:
                return html, usage, elapsed, validation
            last_problem = "invalid output: " + "; ".join(validation["errors"])
            if attempt == RETRY_MAX_ATTEMPTS:
                raise RuntimeError(last_problem)

        print(
            f"  retrying generation; backoff={delay}s attempt={attempt}/{RETRY_MAX_ATTEMPTS}: "
            f"{_redact(last_problem)[:240]}",
            flush=True,
        )
        time.sleep(delay)
        delay = min(delay * 2, 60)
    raise AssertionError("retry loop exhausted")


def run_trial(idx: int, topic: str) -> dict:
    trial_dir = HERE / f"trial_{idx:02d}"
    single_dir = trial_dir / "single"
    split_dir = trial_dir / "materialized"
    single_dir.mkdir(parents=True, exist_ok=True)

    record = {"idx": idx, "topic": topic}
    try:
        html, usage, elapsed, validation = get_page(topic, trial_dir)
    except Exception as exc:  # noqa: BLE001
        record["error"] = f"generation failed: {exc}"
        return record

    (single_dir / "index.html").write_text(html, encoding="utf-8")
    record["usage"] = usage
    record["gen_elapsed_s"] = round(elapsed, 2)
    record["html_bytes"] = len(html.encode("utf-8"))
    record["validation"] = validation

    try:
        manifest = materialize_single_file(html, split_dir)
        record["materialize_manifest"] = manifest
    except Exception as exc:  # noqa: BLE001
        record["error"] = f"materialize failed: {exc}\n{traceback.format_exc()}"
        return record

    try:
        r1 = render_file_to_png(single_dir, "index.html", trial_dir / "single.png")
        r2 = render_file_to_png(split_dir, "index.html", trial_dir / "materialized.png")
    except Exception as exc:  # noqa: BLE001
        record["error"] = f"render failed: {exc}\n{traceback.format_exc()}"
        return record

    record["single_console_errors"] = r1.console_errors
    record["single_failed_requests"] = r1.failed_requests
    record["single_page_errors"] = r1.page_errors
    record["materialized_console_errors"] = r2.console_errors
    record["materialized_failed_requests"] = r2.failed_requests
    record["materialized_page_errors"] = r2.page_errors

    diff = diff_images(trial_dir / "single.png", trial_dir / "materialized.png")
    record["diff"] = diff.to_dict()
    return record


def _recover_trial_from_disk(idx: int, topic: str) -> dict | None:
    """Rebuild a checkpoint after an external runner interruption, without API use."""
    trial_dir = HERE / f"trial_{idx:02d}"
    source_path = trial_dir / "single" / "index.html"
    if not source_path.is_file():
        return None
    attempts = sorted(trial_dir.glob("generation_attempt_*.json"), reverse=True)
    for attempt_path in attempts:
        try:
            attempt = json.loads(attempt_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if attempt.get("validation", {}).get("valid"):
            break
    else:
        return None

    html = source_path.read_text(encoding="utf-8")
    validation = validate_html(html)
    if not validation["valid"]:
        return None
    record = {
        "idx": idx,
        "topic": topic,
        "usage": attempt.get("usage", {}),
        "gen_elapsed_s": round(float(attempt.get("elapsed_s", 0)), 2),
        "html_bytes": len(html.encode("utf-8")),
        "validation": validation,
        "run_mode": "recovered_after_external_interrupt",
    }
    split_dir = trial_dir / "materialized"
    if split_dir.exists():
        shutil.rmtree(split_dir)
    try:
        record["materialize_manifest"] = materialize_single_file(html, split_dir)
        r1 = render_file_to_png(trial_dir / "single", "index.html", trial_dir / "single.png")
        r2 = render_file_to_png(split_dir, "index.html", trial_dir / "materialized.png")
    except Exception:
        return None
    record["single_console_errors"] = r1.console_errors
    record["single_failed_requests"] = r1.failed_requests
    record["single_page_errors"] = r1.page_errors
    record["materialized_console_errors"] = r2.console_errors
    record["materialized_failed_requests"] = r2.failed_requests
    record["materialized_page_errors"] = r2.page_errors
    record["diff"] = diff_images(trial_dir / "single.png", trial_dir / "materialized.png").to_dict()
    return record


def _valid_completed_prefix() -> list[dict]:
    summary_path = HERE / "SUMMARY.json"
    if not summary_path.exists():
        return []
    try:
        records = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot resume invalid SUMMARY.json: {exc}") from exc
    if not isinstance(records, list):
        raise RuntimeError("cannot resume: SUMMARY.json must contain a list")

    completed = []
    by_idx = {record.get("idx"): record for record in records if isinstance(record, dict)}
    for idx in range(1, len(TOPICS) + 1):
        record = by_idx.get(idx)
        trial_dir = HERE / f"trial_{idx:02d}"
        required = (
            trial_dir / "single" / "index.html",
            trial_dir / "materialized" / "index.html",
            trial_dir / "single.png",
            trial_dir / "materialized.png",
        )
        reusable = (
            record
            and "error" not in record
            and record.get("validation", {}).get("valid")
            and all(path.is_file() for path in required)
            and validate_html(required[0].read_text(encoding="utf-8"))["valid"]
        )
        if not reusable:
            record = _recover_trial_from_disk(idx, TOPICS[idx - 1])
            if record is None:
                break
            print(f"recover: rebuilt completed trial_{idx:02d} without API", flush=True)
        completed.append(record)
    return completed


def _prepare_run(resume: bool) -> list[dict]:
    completed = _valid_completed_prefix() if resume else []
    first_pending = len(completed) + 1
    for idx in range(first_pending, len(TOPICS) + 1):
        trial_dir = HERE / f"trial_{idx:02d}"
        if trial_dir.exists():
            shutil.rmtree(trial_dir)
    if not resume:
        summary_path = HERE / "SUMMARY.json"
        if summary_path.exists():
            summary_path.unlink()
    return completed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--resume",
        action="store_true",
        help="reuse only the contiguous, fully validated trial prefix in SUMMARY.json",
    )
    args = parser.parse_args()
    results = _prepare_run(args.resume)
    _write_json(HERE / "SUMMARY.json", results)
    if results:
        print(f"resume: reusing validated trial_01..{len(results):02d}", flush=True)
    for idx, topic in enumerate(TOPICS[len(results):], start=len(results) + 1):
        print(f"=== trial {idx}/10: {topic} ===", flush=True)
        rec = run_trial(idx, topic)
        rec["run_mode"] = "resumed" if args.resume else "fresh"
        results.append(rec)
        _write_json(HERE / "SUMMARY.json", results)
        status = "ERROR" if "error" in rec else "OK"
        diff_ratio = rec.get("diff", {}).get("diff_ratio")
        print(f"  -> {status}  diff_ratio={diff_ratio}", flush=True)
        if "error" in rec:
            print(f"  !! {rec['error']}", flush=True)
            (HERE / "SUMMARY.json").write_text(
                json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print("BLOCKED: stopping A4 after first failed trial", flush=True)
            sys.exit(1)

    (HERE / "SUMMARY.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("done, wrote SUMMARY.json")


if __name__ == "__main__":
    main()
