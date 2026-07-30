"""A3: 20 consecutive scoped local edits against one freshly generated page.

Round N+1 always edits round N's returned HTML, even when round N fails a
post-hoc check. The run is never resumed: every invocation removes prior A3
raw outputs and starts a new 20-round chain.
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import uuid
from collections import Counter
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPIKE_ROOT = HERE.parent
Q1_LIB = SPIKE_ROOT.parent / "q1-checks" / "lib"
sys.path.insert(0, str(SPIKE_ROOT / "lib"))
sys.path.insert(0, str(SPIKE_ROOT.parent / "_lib"))
sys.path.insert(0, str(Q1_LIB))

from bs4 import BeautifulSoup  # noqa: E402
from diffpng import diff_images  # noqa: E402
from htmlutil import (  # noqa: E402
    ancestor_anchor_keys,
    anchor_fingerprints,
    anchor_own_tag_signature,
    strip_code_fences,
)
from colors import normalize_color  # noqa: E402
from extract_computed import extract_from_computed  # noqa: E402
from kimi import chat  # noqa: E402
from render import DEFAULT_VIEWPORT, open_page  # noqa: E402

ROUND_COUNT = 20
VISUAL_ISOLATION_TOL = 0.002
API_ATTEMPT_WALL_LIMIT_S = 240
API_SOCKET_TIMEOUT_S = 235
RETRY_MAX_ATTEMPTS = 3
RETRY_BASE_DELAY_S = 5
RETRY_MAX_DELAY_S = 20
ROUNDS_DIR = HERE / "rounds"
RESULTS_PATH = HERE / "RESULTS.json"
RUN_STATUS_PATH = HERE / "RUN_STATUS.json"

EDIT_KIND_SEQUENCE = (
    "text",
    "attribute",
    "structure",
    "delete-element",
    "add-element",
) * 4

SYSTEM_PROMPT = """你是一个前端代码编辑器，负责对已批准的网页产物做局部反馈编辑。
你会拿到完整页面代码和一个明确声明的单一编辑作用域。输出会经过锚点保留、设计契约、分层视觉隔离、渲染健康四项独立事后校验。
只输出修改后的完整 HTML（从 <!doctype html> 到 </html>），不要解释，不要 markdown 代码块。"""

USER_TEMPLATE = """下面是当前已批准页面的完整代码。只完成本轮局部编辑，其余内容不要动。

## 唯一编辑作用域
data-oey-object="{ref}"

允许修改该锚点元素本身及其内部不含 data-oey-* 锚点的内容。页面其他部分均在作用域外。

## 编辑类型
{kind}

## 编辑指令
{instruction}

## 硬性约束
1. 不得新增、删除、重命名任何 data-oey-section 或 data-oey-object 锚点；不得修改作用域外元素的文本、属性、class、style 或标签结构。
2. 不得引入或删除 design contract token。只能使用以下现有 token：
   - 颜色: {colors}
   - 字号: {font_sizes}
   - 字重: {font_weights}
   - 间距: {space_values}
   - 字体族: {font_families}
3. 不得修改 <head> 或资源引用；不得引入脚本、外链、动画或非确定性内容。
4. 输出完整单文件 HTML，保留未修改部分。

## 当前完整页面代码
{html}
"""

BASELINE_TOPIC = "一家独立设计工作室的官网首页（含品牌介绍、案例展示、服务列表、客户评价、联系方式等区块）"

BASELINE_GEN_PROMPT = """生成一个单文件 HTML 页面，主题：{topic}

硬性要求：
1. 所有 CSS 在一个 <style> 内；无外部 CSS/JS/字体/CDN/http(s) 资源。
2. 至少 6 个顶层区块，各用唯一 data-oey-section="英文短横线名" 标记。
3. 全页至少 28 个唯一 data-oey-object。标题、正文、链接、图片等叶子元素均应有锚点。
4. 另外至少提供 8 个“容器型可编辑元素”：容器自身有唯一 data-oey-object，内部至少有 2 个直接子元素；这些子元素及后代不得有任何 data-oey-* 锚点。容器分布在页面不同区块，用于测试在单一作用域内加/删子元素。
5. 字体只用系统字体栈；不使用动画、transition、当前时间、随机数。
6. 颜色、字号、字重、间距形成有限 token 集，优先用 CSS 变量，避免随处创建新数值。
7. 页面在 1440x900 下可正常渲染，内容足够形成一张多屏长页面。
8. 只输出完整 HTML，不要解释或 markdown 围栏。
"""


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


class ApiAttemptTimeout(RuntimeError):
    pass


def _safe_error_message(exc: BaseException) -> str:
    message = re.sub(r"(?i)bearer\s+\S+", "Bearer [REDACTED]", str(exc))
    return message[:800]


def _chat_worker_file(request_path: Path, result_path: Path) -> None:
    """Run one request and atomically persist its bounded result."""
    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
        started = time.monotonic()
        result = chat(
            request["messages"],
            model="k3",
            max_tokens=request["max_tokens"],
            temperature=1,
            timeout=API_SOCKET_TIMEOUT_S,
        )
        message, usage, _elapsed = result
        payload = {
            "ok": True,
            "message": message,
            "usage": usage,
            "elapsed_s": time.monotonic() - started,
        }
    except BaseException as exc:  # The parent must receive a bounded, sanitized failure.
        payload = {
            "ok": False,
            "error_type": type(exc).__name__,
            "error": _safe_error_message(exc),
        }
    temp_path = result_path.with_suffix(result_path.suffix + ".tmp")
    _write_json(temp_path, payload)
    temp_path.replace(result_path)


def _worker_env() -> dict[str, str]:
    names = (
        "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA",
        "USERPROFILE", "APPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
        "PROGRAMDATA", "COMSPEC", "PATHEXT",
    )
    env = {name: os.environ[name] for name in names if name in os.environ}
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _chat_once_bounded(messages: list[dict], *, max_tokens: int) -> tuple[dict, dict, float]:
    """Enforce a real wall deadline using a disposable, clean-env worker."""
    attempt_id = f"{os.getpid()}-{time.time_ns()}-{uuid.uuid4().hex}"
    request_path = ROUNDS_DIR / f".api-request-{attempt_id}.json"
    result_path = ROUNDS_DIR / f".api-result-{attempt_id}.json"
    _write_json(request_path, {"messages": messages, "max_tokens": max_tokens})
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--chat-worker",
        str(request_path),
        str(result_path),
    ]
    started = time.monotonic()
    process = subprocess.Popen(
        command,
        cwd=str(SPIKE_ROOT.parent.parent),
        env=_worker_env(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        try:
            process.wait(timeout=API_ATTEMPT_WALL_LIMIT_S)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
            raise ApiAttemptTimeout(
                f"API attempt exceeded {API_ATTEMPT_WALL_LIMIT_S}s wall-clock limit"
            ) from None
        if not result_path.exists():
            raise RuntimeError(f"API worker exited without a result (exitcode={process.returncode})")
        payload = json.loads(result_path.read_text(encoding="utf-8"))
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        for path in (request_path, result_path, result_path.with_suffix(result_path.suffix + ".tmp")):
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    if not payload["ok"]:
        raise RuntimeError(f"{payload['error_type']}: {payload['error']}")
    return payload["message"], payload["usage"], time.monotonic() - started


def _is_retryable_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    retryable_types = (
        "timeout",
        "urlerror",
        "connectionerror",
        "connectionreseterror",
        "connectionabortederror",
        "brokenpipeerror",
        "remotedisconnected",
        "gaierror",
        "sslerror",
        "socketerror",
        "badstatusline",
        "incompleteread",
        "httpexception",
        "oserror",
    )
    return (
        isinstance(exc, ApiAttemptTimeout)
        or any(name in message for name in retryable_types)
        or any(status in message for status in ("http 408", "http 429"))
        or re.search(r"http 5\d\d", message) is not None
        or any(fragment in message for fragment in ("timed out", "temporary failure", "network is unreachable"))
    )


def chat_with_retry(messages: list[dict], *, max_tokens: int) -> tuple[dict, dict, float]:
    delay = RETRY_BASE_DELAY_S
    for attempt in range(1, RETRY_MAX_ATTEMPTS + 1):
        try:
            return _chat_once_bounded(messages, max_tokens=max_tokens)
        except (RuntimeError, OSError) as exc:
            if not _is_retryable_error(exc) or attempt == RETRY_MAX_ATTEMPTS:
                raise
            print(
                f"  retryable API error ({type(exc).__name__}); "
                f"backoff={delay}s attempt={attempt}/{RETRY_MAX_ATTEMPTS}",
                flush=True,
            )
            time.sleep(delay)
            delay = min(delay * 2, RETRY_MAX_DELAY_S)
    raise AssertionError("retry loop exhausted")


def get_llm_html(prompt_user: str, *, baseline: bool = False) -> tuple[str, dict, float]:
    system = (
        "你是前端代码生成器。只输出完整 HTML，不输出解释，不要 markdown 代码块。"
        if baseline
        else SYSTEM_PROMPT
    )
    message, usage, elapsed = chat_with_retry(
        [{"role": "system", "content": system}, {"role": "user", "content": prompt_user}],
        max_tokens=16000,
    )
    html_text = strip_code_fences(message.get("content") or "")
    validate_complete_html(html_text)
    return html_text, usage, elapsed


def validate_complete_html(html_text: str) -> None:
    """Reject empty, structurally incomplete, or visibly truncated model output."""
    text = html_text.strip()
    if not text:
        raise RuntimeError("model returned empty HTML")
    if "\x00" in text:
        raise RuntimeError("model returned HTML containing NUL")
    if re.match(r"(?is)\A<!doctype\s+html\s*>", text) is None:
        raise RuntimeError("model output must start with an HTML5 doctype")
    if re.search(r"(?is)</html\s*>\s*\Z", text) is None:
        raise RuntimeError("model output is truncated or has content after </html>")

    positions = []
    for tag in ("html", "head", "body"):
        opened = re.search(rf"(?is)<{tag}(?:\s[^>]*)?>", text)
        closed = re.search(rf"(?is)</{tag}\s*>", text)
        if opened is None or closed is None or opened.end() > closed.start():
            raise RuntimeError(f"model output lacks a complete <{tag}> element")
        positions.append((opened.start(), closed.start()))
    html_pos, head_pos, body_pos = positions
    if not (html_pos[0] < head_pos[0] < head_pos[1] < body_pos[0] < body_pos[1] < html_pos[1]):
        raise RuntimeError("model output has invalid html/head/body ordering")
    style_open = re.search(r"(?is)<style(?:\s[^>]*)?>", text)
    style_close = re.search(r"(?is)</style\s*>", text)
    if (
        style_open is None
        or style_close is None
        or not (head_pos[0] < style_open.start() < style_close.start() < head_pos[1])
    ):
        raise RuntimeError("model output requires a complete <style> inside <head>")


def _object_tags(html_text: str) -> list:
    soup = BeautifulSoup(html_text, "lxml")
    return list(soup.find_all(attrs={"data-oey-object": True}))


def _is_leaf_candidate(tag) -> bool:
    return tag.name != "img" and bool(tag.get_text(strip=True)) and tag.find() is None


def _is_container_candidate(tag) -> bool:
    direct_children = tag.find_all(recursive=False)
    if len(direct_children) < 2:
        return False
    for child in direct_children:
        if child.has_attr("data-oey-object") or child.has_attr("data-oey-section"):
            return False
        if child.find(attrs={"data-oey-object": True}) or child.find(attrs={"data-oey-section": True}):
            return False
    return True


def build_edit_plan(html_text: str) -> list[dict]:
    """Build an interleaved, deterministic, all-distinct 5x4 edit schedule."""
    tags = _object_tags(html_text)
    refs = [tag.get("data-oey-object") for tag in tags]
    if len(refs) != len(set(refs)):
        raise RuntimeError("baseline contains duplicate data-oey-object anchors")

    leaves = [tag for tag in tags if _is_leaf_candidate(tag)]
    containers = [tag for tag in tags if _is_container_candidate(tag)]
    if len(tags) < ROUND_COUNT or len(leaves) < 8 or len(containers) < 8:
        raise RuntimeError(
            f"baseline lacks schedule candidates: objects={len(tags)}, leaves={len(leaves)}, "
            f"containers={len(containers)}; need >=20/8/8"
        )

    def take_spread(pool: list, count: int, used: set[str]) -> list:
        chosen = []
        for occurrence in range(count):
            preferred = math.floor((occurrence + 0.5) * len(pool) / count) % len(pool)
            for offset in range(len(pool)):
                tag = pool[(preferred + offset) % len(pool)]
                ref = tag.get("data-oey-object")
                if ref not in used:
                    chosen.append(tag)
                    used.add(ref)
                    break
            else:
                raise RuntimeError("could not allocate distinct edit scopes")
        return chosen

    # Allocate scarce container/leaf scopes before generic attribute scopes so
    # an exactly-minimal valid baseline (8 containers, 8 leaves) still works.
    used: set[str] = set()
    container_scopes = take_spread(containers, 8, used)
    leaf_scopes = take_spread(leaves, 8, used)
    attribute_scopes = take_spread(tags, 4, used)
    assigned = {
        "text": leaf_scopes[0::2],
        "structure": leaf_scopes[1::2],
        "delete-element": container_scopes[0::2],
        "add-element": container_scopes[1::2],
        "attribute": attribute_scopes,
    }

    kind_seen: Counter = Counter()
    plan = []
    for round_idx, kind in enumerate(EDIT_KIND_SEQUENCE, start=1):
        occurrence = kind_seen[kind]
        kind_seen[kind] += 1
        chosen = assigned[kind][occurrence]
        ref = chosen.get("data-oey-object")
        plan.append({"round": round_idx, "kind": kind, "ref": ref, "baseline_tag": chosen.name})
    return plan


def build_instruction(kind: str, round_idx: int) -> str:
    if kind == "text":
        return f'仅把该元素的现有文字替换为“第 {round_idx} 轮更新内容：以清晰设计回应真实需求。”；标签和全部属性不变。'
    if kind == "attribute":
        return f'仅为该作用域元素新增或更新 title 属性为“第 {round_idx} 轮局部说明”；不要改任何其他属性或内容。'
    if kind == "structure":
        return "仅在该作用域元素内部，用一个不带任何属性的 <span> 包裹现有全部文字；文字、作用域元素标签及其属性均不变。"
    if kind == "delete-element":
        return "仅删除该作用域容器的最后一个直接子元素；该子元素不含 data-oey-* 锚点。容器本身及其他子元素不变。"
    if kind == "add-element":
        return (
            f"仅在该作用域容器末尾新增一个直接子元素，沿用现有直接子元素的标签和已有 class，"
            f"简短文字为“新增项目 {round_idx}”；不得添加 data-oey-*、id、style 或新 class。"
        )
    raise ValueError(f"unknown edit kind: {kind}")


def _capture_anchor_geometry(page) -> list[dict]:
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-oey-section], [data-oey-object]')).map((el, index) => {
            const rect = el.getBoundingClientRect();
            const kind = el.hasAttribute('data-oey-section') ? 'section' : 'object';
            const value = el.getAttribute(kind === 'section' ? 'data-oey-section' : 'data-oey-object');
            return {
                key: `${kind}:${value}`,
                dom_index: index,
                box: {
                    x0: rect.left + window.scrollX,
                    y0: rect.top + window.scrollY,
                    x1: rect.right + window.scrollX,
                    y1: rect.bottom + window.scrollY
                }
            };
        })"""
    )


_COMPUTED_TOKEN_VALUES_JS = r"""
() => {
    const borderSides = [
        ['borderTopColor', 'borderTopWidth', 'borderTopStyle'],
        ['borderRightColor', 'borderRightWidth', 'borderRightStyle'],
        ['borderBottomColor', 'borderBottomWidth', 'borderBottomStyle'],
        ['borderLeftColor', 'borderLeftWidth', 'borderLeftStyle'],
    ];
    const spaceProps = [
        'paddingTop','paddingRight','paddingBottom','paddingLeft',
        'marginTop','marginRight','marginBottom','marginLeft','rowGap','columnGap'
    ];
    const out = {colors: [], font_families: [], font_sizes: [], font_weights: [], spaces: []};
    for (const el of document.querySelectorAll('body, body *')) {
        const cs = getComputedStyle(el);
        if (cs.color && cs.color !== 'rgba(0, 0, 0, 0)') out.colors.push(cs.color);
        if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
            out.colors.push(cs.backgroundColor);
        }
        for (const [colorProp, widthProp, styleProp] of borderSides) {
            if (cs[styleProp] !== 'none' && parseFloat(cs[widthProp]) > 0) {
                const value = cs[colorProp];
                if (value && value !== 'rgba(0, 0, 0, 0)') out.colors.push(value);
            }
        }
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
            const value = cs.outlineColor;
            if (value && value !== 'rgba(0, 0, 0, 0)') out.colors.push(value);
        }
        if (cs.fontFamily) out.font_families.push(cs.fontFamily);
        const size = parseFloat(cs.fontSize);
        if (!Number.isNaN(size)) out.font_sizes.push(size);
        const weight = Number(cs.fontWeight === 'normal' ? 400 : cs.fontWeight === 'bold' ? 700 : cs.fontWeight);
        if (!Number.isNaN(weight)) out.font_weights.push(weight);
        for (const prop of spaceProps) {
            const value = parseFloat(cs[prop]);
            if (!Number.isNaN(value) && value !== 0) out.spaces.push(value);
        }
    }
    return out;
}
"""


def _capture_computed_contract(page, source_html: str) -> dict:
    contract = extract_from_computed(page, source_text=source_html)
    raw = page.evaluate(_COMPUTED_TOKEN_VALUES_JS)
    colors = {value for raw_value in raw["colors"] if (value := normalize_color(raw_value)) is not None}
    contract["observed_token_values"] = {
        "color": sorted(colors),
        "font_family": sorted(set(raw["font_families"])),
        "font_size": sorted({round(float(value), 1) for value in raw["font_sizes"]}),
        "font_weight": sorted({int(float(value)) for value in raw["font_weights"]}),
        "space": sorted({round(float(value), 1) for value in raw["spaces"]}),
    }
    return contract


def render_revision(entry_dir: Path, out_stem: Path, source_html: str) -> dict:
    """Render one revision once and save fixed-viewport plus full-page PNGs."""
    health = {"console_errors": [], "console_warnings": [], "failed_requests": [], "page_errors": []}
    viewport_path = out_stem.with_suffix(".viewport.png")
    full_path = out_stem.with_suffix(".full.png")
    with open_page(entry_dir, "index.html", viewport=DEFAULT_VIEWPORT) as page:
        def on_console(message):
            try:
                location_url = (message.location or {}).get("url", "")
            except Exception:
                location_url = ""
            if location_url.endswith("/favicon.ico"):
                return
            if message.type == "error":
                health["console_errors"].append(message.text)
            elif message.type == "warning":
                health["console_warnings"].append(message.text)

        page.on("console", on_console)
        page.on(
            "requestfailed",
            lambda request: health["failed_requests"].append(f"{request.url} :: {request.failure}")
            if not request.url.endswith("/favicon.ico")
            else None,
        )
        page.on("pageerror", lambda exc: health["page_errors"].append(str(exc)))
        page.reload(wait_until="domcontentloaded", timeout=20000)
        try:
            page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass
        page.wait_for_timeout(250)
        page.evaluate("window.scrollTo(0, 0)")
        geometry = _capture_anchor_geometry(page)
        computed_contract = _capture_computed_contract(page, source_html)
        page.screenshot(path=str(viewport_path), full_page=False)
        page.screenshot(path=str(full_path), full_page=True)
    contract_path = out_stem.with_suffix(".computed-contract.json")
    _write_json(contract_path, computed_contract)
    return {
        "health": health,
        "geometry": geometry,
        "computed_contract": computed_contract,
        "computed_contract_file": contract_path.name,
        "viewport_screenshot": viewport_path.name,
        "full_screenshot": full_path.name,
    }


def _geometry_map(render_record: dict) -> tuple[list[str], dict[str, dict]]:
    order = []
    boxes = {}
    for item in render_record["geometry"]:
        key = item["key"]
        order.append(key)
        boxes.setdefault(key, item["box"])
    return order, boxes


def _axis_relation(a0: float, a1: float, b0: float, b1: float, epsilon: float = 1.0) -> str:
    if a1 <= b0 + epsilon:
        return "before"
    if b1 <= a0 + epsilon:
        return "after"
    return "overlap"


def check_geometry_relationships(previous: dict, current: dict, scope_key: str) -> dict:
    """L1: preserve DOM order plus stable same-row/same-column relations.

    A local edit may push every downstream box without changing layout intent.
    Pairs that stop sharing a row/column are therefore reflow, not L1 failures;
    L2/L3 remain responsible for detecting visible out-of-scope changes.
    """
    old_order, old_boxes = _geometry_map(previous)
    new_order, new_boxes = _geometry_map(current)
    old_outside = [key for key in old_order if key != scope_key]
    new_outside = [key for key in new_order if key != scope_key]
    missing = sorted(set(old_outside) - set(new_outside))
    added = sorted(set(new_outside) - set(old_outside))
    order_changed = old_outside != new_outside
    common = [key for key in old_outside if key in new_boxes]
    changed_pairs = []
    compared_pairs = set()
    same_row_pairs = 0
    same_column_pairs = 0
    total_pairs = len(common) * (len(common) - 1) // 2
    for left, right in combinations(common, 2):
        old_box = old_boxes[left]
        new_box = new_boxes[left]
        old_other = old_boxes[right]
        new_other = new_boxes[right]
        old_x = _axis_relation(old_box["x0"], old_box["x1"], old_other["x0"], old_other["x1"])
        new_x = _axis_relation(new_box["x0"], new_box["x1"], new_other["x0"], new_other["x1"])
        old_y = _axis_relation(old_box["y0"], old_box["y1"], old_other["y0"], old_other["y1"])
        new_y = _axis_relation(new_box["y0"], new_box["y1"], new_other["y0"], new_other["y1"])
        if old_y == new_y == "overlap":
            same_row_pairs += 1
            compared_pairs.add((left, right))
            if old_x != new_x:
                changed_pairs.append(
                    {"left": left, "right": right, "axis": "row/x", "before": old_x, "after": new_x}
                )
        if old_x == new_x == "overlap":
            same_column_pairs += 1
            compared_pairs.add((left, right))
            if old_y != new_y:
                changed_pairs.append(
                    {"left": left, "right": right, "axis": "column/y", "before": old_y, "after": new_y}
                )
    passed = not missing and not added and not order_changed and not changed_pairs
    return {
        "pass": passed,
        "applicable": True,
        "outside_anchor_count": len(old_outside),
        "total_pair_count": total_pairs,
        "compared_pair_count": len(compared_pairs),
        "same_row_relation_count": same_row_pairs,
        "same_column_relation_count": same_column_pairs,
        "reflow_immune_skipped_pair_count": total_pairs - len(compared_pairs),
        "spatial_selection_rule": (
            "compare horizontal order only when the pair overlaps vertically before and after; "
            "compare vertical order only when it overlaps horizontally before and after"
        ),
        "missing": missing,
        "added": added,
        "relative_order_changed": order_changed,
        "changed_relative_position_pairs": changed_pairs,
        "before_geometry": {key: old_boxes[key] for key in old_outside if key in old_boxes},
        "after_geometry": {key: new_boxes[key] for key in new_outside if key in new_boxes},
    }


def _scope_box(render_record: dict, scope_key: str) -> dict | None:
    return _geometry_map(render_record)[1].get(scope_key)


def check_visual_isolation(previous: dict, current: dict, scope_key: str) -> dict:
    """Apply artifact-production-spec.md SS4.3.1 L1/L2/L3 in order."""
    layer1 = check_geometry_relationships(previous, current, scope_key)
    old_scope = _scope_box(previous, scope_key)
    new_scope = _scope_box(current, scope_key)

    old_viewport = ROUNDS_DIR / previous["viewport_screenshot"]
    new_viewport = ROUNDS_DIR / current["viewport_screenshot"]
    if old_scope is None or new_scope is None:
        layer2 = {
            "pass": False,
            "applicable": True,
            "reason": "scope geometry missing",
            "threshold": VISUAL_ISOLATION_TOL,
        }
    else:
        above_y = max(0, min(DEFAULT_VIEWPORT["height"], math.floor(min(old_scope["y0"], new_scope["y0"]))))
        viewport_diff = diff_images(
            old_viewport,
            new_viewport,
            exclude_bboxes=[(0, above_y, DEFAULT_VIEWPORT["width"], DEFAULT_VIEWPORT["height"])],
        )
        layer2 = {
            "pass": (
                not viewport_diff.size_mismatch
                and viewport_diff.diff_ratio is not None
                and viewport_diff.diff_ratio <= VISUAL_ISOLATION_TOL
            ),
            "applicable": True,
            "region": [0, 0, DEFAULT_VIEWPORT["width"], above_y],
            "threshold": VISUAL_ISOLATION_TOL,
            **viewport_diff.to_dict(),
        }

    old_full = ROUNDS_DIR / previous["full_screenshot"]
    new_full = ROUNDS_DIR / current["full_screenshot"]
    full_diff = diff_images(
        old_full,
        new_full,
        exclude_bboxes=(
            [
                (old_scope["x0"], old_scope["y0"], old_scope["x1"], old_scope["y1"]),
                (new_scope["x0"], new_scope["y0"], new_scope["x1"], new_scope["y1"]),
            ]
            if old_scope is not None and new_scope is not None
            else None
        ),
    )
    if full_diff.size_mismatch:
        layer3 = {
            "pass": True,
            "applicable": False,
            "status": "reflow_skipped",
            "threshold": VISUAL_ISOLATION_TOL,
            **full_diff.to_dict(),
        }
    elif old_scope is None or new_scope is None:
        layer3 = {
            "pass": False,
            "applicable": True,
            "status": "compared",
            "reason": "scope geometry missing",
            "threshold": VISUAL_ISOLATION_TOL,
            **full_diff.to_dict(),
        }
    else:
        layer3 = {
            "pass": full_diff.diff_ratio is not None and full_diff.diff_ratio <= VISUAL_ISOLATION_TOL,
            "applicable": True,
            "status": "compared",
            "threshold": VISUAL_ISOLATION_TOL,
            "excluded_scope_boxes": [old_scope, new_scope],
            **full_diff.to_dict(),
        }

    return {
        "pass": layer1["pass"] and layer2["pass"] and layer3["pass"],
        "scope_key": scope_key,
        "layer1_geometry_relationships": layer1,
        "layer2_pixels_above_scope": layer2,
        "layer3_full_page": layer3,
    }


def check_anchor_preservation(previous_html: str, current_html: str, ref: str) -> dict:
    scope_key = f"object:{ref}"
    ancestors = ancestor_anchor_keys(previous_html, scope_key)
    old_fingerprints = anchor_fingerprints(previous_html)
    new_fingerprints = anchor_fingerprints(current_html)
    old_signatures = anchor_own_tag_signature(previous_html)
    new_signatures = anchor_own_tag_signature(current_html)
    old_keys = set(old_fingerprints)
    new_keys = set(new_fingerprints)
    missing = sorted(old_keys - new_keys)
    added = sorted(new_keys - old_keys)
    changed = []
    for key in sorted(old_keys & new_keys):
        if key == scope_key:
            continue
        if key in ancestors:
            if old_signatures[key][1] != new_signatures[key][1]:
                changed.append(f"{key} (own tag/attrs changed)")
            continue
        if old_fingerprints[key][1] != new_fingerprints[key][1]:
            changed.append(key)
        if new_fingerprints[key][0] > 1:
            changed.append(f"{key} (duplicated x{new_fingerprints[key][0]})")
    return {
        "pass": not missing and not added and not changed,
        "missing": missing,
        "added": added,
        "changed_out_of_scope": changed,
        "ancestors_checked_by_own_signature": sorted(ancestors),
    }


def check_contract_preservation(baseline: dict, current: dict) -> dict:
    """Compare rendered value sets, never source tokens or occurrence counts."""
    baseline_values = baseline["observed_token_values"]
    current_values = current["observed_token_values"]
    new_tokens = {
        kind: sorted(set(current_values[kind]) - set(baseline_values[kind]))
        for kind in baseline_values
    }
    absent_baseline_tokens = {
        kind: sorted(set(baseline_values[kind]) - set(current_values[kind]))
        for kind in baseline_values
    }
    baseline_anchors = {(item["kind"], item["id"]) for item in baseline["anchors"]}
    current_anchors = {(item["kind"], item["id"]) for item in current["anchors"]}
    missing_anchors = [
        {"kind": kind, "id": anchor_id}
        for kind, anchor_id in sorted(baseline_anchors - current_anchors)
    ]
    added_anchors = [
        {"kind": kind, "id": anchor_id}
        for kind, anchor_id in sorted(current_anchors - baseline_anchors)
    ]
    has_new_tokens = any(new_tokens.values())
    return {
        "pass": not has_new_tokens and not missing_anchors,
        "extractor_version": current["extractor_version"],
        "comparison_basis": "rendered computed-style value sets plus DOM anchors; counts ignored",
        "new_tokens": new_tokens,
        "missing_baseline_anchors": missing_anchors,
        "added_anchors_diagnostic": added_anchors,
        "absent_baseline_tokens_diagnostic": absent_baseline_tokens,
    }


def _contract_prompt_values(contract: dict) -> dict[str, str]:
    tokens = contract["tokens"]
    return {
        "colors": ", ".join(item["value"] for item in tokens["color"]) or "(none)",
        "font_sizes": ", ".join(f"{value:g}px" for value in tokens["type"]["font_size"]) or "(none)",
        "font_weights": ", ".join(str(value) for value in tokens["type"]["font_weight"]) or "(none)",
        "space_values": ", ".join(f"{value:g}px" for value in tokens["space"]) or "(none)",
        "font_families": ", ".join(tokens["type"]["font_family"]) or "(none)",
    }


def check_render_health(previous: dict, current: dict) -> dict:
    keys = ("console_errors", "failed_requests", "page_errors")
    previous_counts = {key: len(previous["health"][key]) for key in keys}
    current_counts = {key: len(current["health"][key]) for key in keys}
    return {
        "pass": all(current_counts[key] <= previous_counts[key] for key in keys),
        "previous_counts": previous_counts,
        "current_counts": current_counts,
        **current["health"],
    }


def _persist_results(status: str, baseline: dict, plan: list[dict], rounds: list[dict]) -> None:
    distribution = dict(sorted(Counter(item["kind"] for item in plan).items()))
    result = {
        "status": status,
        "model": "k3",
        "temperature": 1,
        "round_count": ROUND_COUNT,
        "continuous_chain": True,
        "reset_after_failed_check": False,
        "resumed": False,
        "api_attempt_wall_limit_s": API_ATTEMPT_WALL_LIMIT_S,
        "api_retry_max_attempts": RETRY_MAX_ATTEMPTS,
        "api_retry_delays_s": [RETRY_BASE_DELAY_S * (2**index) for index in range(RETRY_MAX_ATTEMPTS - 1)],
        "visual_isolation_threshold": VISUAL_ISOLATION_TOL,
        "viewport": DEFAULT_VIEWPORT,
        "edit_type_distribution": distribution,
        "edit_plan": plan,
        "baseline": baseline,
        "rounds": rounds,
    }
    _write_json(RESULTS_PATH, result)


def main() -> None:
    if ROUNDS_DIR.exists():
        shutil.rmtree(ROUNDS_DIR)
    ROUNDS_DIR.mkdir(parents=True)
    for path in (RESULTS_PATH, RUN_STATUS_PATH):
        if path.exists():
            path.unlink()
    _write_json(RUN_STATUS_PATH, {"status": "RUNNING", "resumed": False, "rounds_complete": 0})

    print("=== fresh baseline ===", flush=True)
    baseline_html, baseline_usage, baseline_elapsed = get_llm_html(
        BASELINE_GEN_PROMPT.format(topic=BASELINE_TOPIC), baseline=True
    )
    baseline_path = ROUNDS_DIR / "round_00.html"
    baseline_path.write_text(baseline_html, encoding="utf-8")
    plan = build_edit_plan(baseline_html)
    _write_json(ROUNDS_DIR / "edit_plan.json", plan)

    render_dir = ROUNDS_DIR / "render_00"
    render_dir.mkdir()
    (render_dir / "index.html").write_text(baseline_html, encoding="utf-8")
    previous_render = render_revision(render_dir, ROUNDS_DIR / "round_00", baseline_html)
    baseline_contract = previous_render["computed_contract"]
    _write_json(ROUNDS_DIR / "contract_00.json", baseline_contract)
    baseline_record = {
        "revision": 0,
        "html": baseline_path.name,
        "usage": baseline_usage,
        "elapsed_s": round(baseline_elapsed, 2),
        "anchor_count": len(baseline_contract["anchors"]),
        "contract": baseline_contract,
        "render": previous_render,
    }
    _write_json(ROUNDS_DIR / "round_00.json", baseline_record)
    print(
        f"baseline chars={len(baseline_html)} anchors={len(baseline_contract['anchors'])} "
        f"distribution={dict(Counter(item['kind'] for item in plan))}",
        flush=True,
    )

    previous_html = baseline_html
    round_records = []
    _persist_results("RUNNING", baseline_record, plan, round_records)
    for plan_item in plan:
        round_idx = plan_item["round"]
        ref = plan_item["ref"]
        kind = plan_item["kind"]
        instruction = build_instruction(kind, round_idx)
        prompt_tokens = _contract_prompt_values(previous_render["computed_contract"])
        prompt = USER_TEMPLATE.format(
            ref=ref,
            kind=kind,
            instruction=instruction,
            **prompt_tokens,
            html=previous_html,
        )
        print(f"=== round {round_idx}/{ROUND_COUNT}: scope={ref} kind={kind} ===", flush=True)
        current_html, usage, elapsed = get_llm_html(prompt)
        html_path = ROUNDS_DIR / f"round_{round_idx:02d}.html"
        html_path.write_text(current_html, encoding="utf-8")

        current_render_dir = ROUNDS_DIR / f"render_{round_idx:02d}"
        current_render_dir.mkdir()
        (current_render_dir / "index.html").write_text(current_html, encoding="utf-8")
        current_render = render_revision(
            current_render_dir, ROUNDS_DIR / f"round_{round_idx:02d}", current_html
        )

        checks = {
            "anchor_preservation": check_anchor_preservation(previous_html, current_html, ref),
            "contract_preservation": check_contract_preservation(
                baseline_contract, current_render["computed_contract"]
            ),
            "visual_isolation": check_visual_isolation(previous_render, current_render, f"object:{ref}"),
            "render_health": check_render_health(previous_render, current_render),
        }
        record = {
            **plan_item,
            "instruction": instruction,
            "html": html_path.name,
            "usage": usage,
            "elapsed_s": round(elapsed, 2),
            "render": current_render,
            "checks": checks,
            "all_pass": all(check["pass"] for check in checks.values()),
        }
        round_records.append(record)
        _write_json(ROUNDS_DIR / f"round_{round_idx:02d}.json", record)
        _persist_results("RUNNING", baseline_record, plan, round_records)
        _write_json(
            RUN_STATUS_PATH,
            {"status": "RUNNING", "resumed": False, "rounds_complete": len(round_records)},
        )
        visual = checks["visual_isolation"]
        print(
            f"  anchor={checks['anchor_preservation']['pass']} "
            f"contract={checks['contract_preservation']['pass']} "
            f"visual={visual['pass']} "
            f"(L1={visual['layer1_geometry_relationships']['pass']} "
            f"L2={visual['layer2_pixels_above_scope']['pass']} "
            f"L3={visual['layer3_full_page']['status']}:"
            f"{visual['layer3_full_page']['pass']}) "
            f"health={checks['render_health']['pass']}",
            flush=True,
        )

        # Deliberately chain forward even after any failed check.
        previous_html = current_html
        previous_render = current_render

    _persist_results("COMPLETE", baseline_record, plan, round_records)
    _write_json(
        RUN_STATUS_PATH,
        {"status": "COMPLETE", "resumed": False, "rounds_complete": len(round_records)},
    )
    print("complete: wrote 20-round RESULTS.json", flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--chat-worker":
        _chat_worker_file(Path(sys.argv[2]), Path(sys.argv[3]))
        raise SystemExit(0)
    try:
        main()
    except Exception as exc:  # A broken/incomplete chain is not interpretable A3 evidence.
        blocked = {
            "status": "BLOCKED",
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
        }
        _write_json(RUN_STATUS_PATH, blocked)
        print(f"BLOCKED: {blocked['error']}", file=sys.stderr, flush=True)
        raise
