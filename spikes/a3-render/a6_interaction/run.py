"""A6: can declared interaction paths on JS+mock pages be checked automatically?

3 generated pages, each declaring its interactions as a small JSON DSL
(INTERACTIONS.json) alongside the page. Page 3 also has a mock backend layer
(fetch('mock/reviews.json')) per artifact-production-spec.md SS4.7.

DSL per interaction:
  {
    "name": str,
    "trigger_selector": css selector to click,
    "action": "click",
    "expect_selector": css selector whose state should change,
    "expect_property": "textContent" | "class" | "style" | <attr name>,
    "expect_mode": "changed" | "contains",
    "expect_value": str|null   # substring required in expect_property AFTER
                                 click (and required ABSENT before click) when
                                 expect_mode == "contains"
  }

The harness reads the property BEFORE the click, clicks trigger_selector,
reads the property AFTER, and judges pass/fail per expect_mode. This is a
real click on a real rendered DOM via Playwright, not a static analysis.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPIKE_ROOT = HERE.parent
sys.path.insert(0, str(SPIKE_ROOT / "lib"))
sys.path.insert(0, str(SPIKE_ROOT.parent / "_lib"))

from kimi import chat  # noqa: E402
from htmlutil import strip_code_fences  # noqa: E402
from render import serve_dir  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

SYSTEM_PROMPT = "你是一个前端代码生成器。严格按输出格式要求，不要输出多余解释文字，不要用 markdown 代码块包裹任何部分。"

INTERACTIONS_SCHEMA_NOTE = """交互声明 JSON 数组的 schema（每个元素）:
{
  "name": "简短英文标识",
  "trigger_selector": "CSS选择器,指向要点击的元素",
  "action": "click",
  "expect_selector": "CSS选择器,指向点击后状态应发生变化的元素",
  "expect_property": "textContent 或 class 或 style 或其他HTML属性名(如 aria-hidden)",
  "expect_mode": "changed 或 contains",
  "expect_value": "当 expect_mode 为 contains 时,点击后应出现在 expect_property 中的子串(且点击前不应包含);expect_mode 为 changed 时填 null"
}"""

PAGE_A_PROMPT = f"""生成一个单文件 HTML 页面(可包含 <script>,不要外部依赖/外链),实现两个精确的交互:

1. 『+1 计数器』：按钮 data-oey-object="counter.button"，点击后 data-oey-object="counter.display" 元素的文本内容里的数字加 1（初始显示 0）。
2. 『标签页切换』：两个标签按钮 data-oey-object="tabs.tab-a" 与 data-oey-object="tabs.tab-b"，两个面板 data-oey-object="tabs.panel-a" 与 data-oey-object="tabs.panel-b"。初始只有 panel-a 可见。点击 tab-b 后，panel-b 的 class 属性或 style 属性必须发生真实、可被自动化脚本检测的变化（变为可见）。

{INTERACTIONS_SCHEMA_NOTE}

输出格式(严格按此顺序):
先输出完整 index.html 内容(从 <!doctype html> 到 </html>,不要 markdown 围栏);
另起一行写 -----INTERACTIONS-----;
然后输出上述两个交互组成的 JSON 数组(不要 markdown 围栏)。
不要输出任何其它解释文字。"""

PAGE_B_PROMPT = f"""生成一个单文件 HTML 页面(可包含 <script>,不要外部依赖/外链),实现两个精确的交互:

1. 『移动端导航开关』：按钮 data-oey-object="nav.toggle"，点击后菜单元素 data-oey-object="nav.menu" 的 class 属性中会加上 "open"（初始 class 不包含 "open"）。
2. 『FAQ 手风琴』：问题按钮 data-oey-object="faq.question-1"，点击后回答面板 data-oey-object="faq.answer-1" 的 aria-hidden 属性从 "true" 变为 "false"（初始必须是 "true"）。

{INTERACTIONS_SCHEMA_NOTE}

输出格式(严格按此顺序):
先输出完整 index.html 内容(从 <!doctype html> 到 </html>,不要 markdown 围栏);
另起一行写 -----INTERACTIONS-----;
然后输出上述两个交互组成的 JSON 数组(不要 markdown 围栏)。
不要输出任何其它解释文字。"""

PAGE_C_PROMPT = f"""生成一个单文件 HTML 页面 + mock 数据层，实现:

页面加载时不显示评论列表。按钮 data-oey-object="reviews.load-button"，点击后通过 fetch('mock/reviews.json') 异步加载数据，把结果渲染进 data-oey-object="reviews.list" 容器（例如渲染若干 <li>）。渲染完成后 reviews.list 的 textContent 必须从空（或仅空白）变为非空。

mock/reviews.json 是你编的假数据：一个 JSON 数组，3-5 条评论，每条含 author 和 text 字段。
另外写一份 MOCK.md，一两句话声明：mock 了 fetch('mock/reviews.json') 这个接口，数据是编造的示例数据。
页面会被部署为 index.html 与 mock/reviews.json 同级的同源静态站点（本地 HTTP 服务器托管），用相对路径 'mock/reviews.json' 即可，没有跨域问题。

{INTERACTIONS_SCHEMA_NOTE}
（这次只声明这一个交互：点击 load-button 后 reviews.list 的 textContent 从空变为非空，expect_mode 用 "changed"）

输出格式(严格按此顺序，每部分之间用给定分隔行分隔，各部分内容都不要 markdown 围栏):
先输出完整 index.html 内容;
另起一行写 -----MOCKJSON-----;
输出 mock/reviews.json 的 JSON 内容;
另起一行写 -----MOCKMD-----;
输出 MOCK.md 的内容;
另起一行写 -----INTERACTIONS-----;
输出交互声明 JSON 数组。
不要输出任何其它解释文字。"""


def call_llm(prompt: str) -> str:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}]
    msg, usage, elapsed = chat(messages, max_tokens=8000)
    return msg.get("content") or "", usage, elapsed


def split_sections(text: str, markers: list) -> dict:
    """Split `text` on lines like '-----MARKER-----' into {marker: content}.

    First chunk (before any marker) is keyed as "MAIN".
    """
    pattern = "|".join(re.escape(f"-----{m}-----") for m in markers)
    parts = re.split(f"({pattern})", text)
    out = {"MAIN": parts[0]}
    i = 1
    while i < len(parts) - 1:
        marker = parts[i].strip("-")
        out[marker] = parts[i + 1]
        i += 2
    return out


def build_page_a():
    raw, usage, elapsed = call_llm(PAGE_A_PROMPT)
    sections = split_sections(raw, ["INTERACTIONS"])
    html = strip_code_fences(sections.get("MAIN", ""))
    interactions_text = strip_code_fences(sections.get("INTERACTIONS", "[]"))
    page_dir = HERE / "page_01_tabs_counter"
    page_dir.mkdir(parents=True, exist_ok=True)
    (page_dir / "index.html").write_text(html, encoding="utf-8")
    (page_dir / "INTERACTIONS.json").write_text(interactions_text, encoding="utf-8")
    return page_dir, usage, elapsed


def build_page_b():
    raw, usage, elapsed = call_llm(PAGE_B_PROMPT)
    sections = split_sections(raw, ["INTERACTIONS"])
    html = strip_code_fences(sections.get("MAIN", ""))
    interactions_text = strip_code_fences(sections.get("INTERACTIONS", "[]"))
    page_dir = HERE / "page_02_nav_faq"
    page_dir.mkdir(parents=True, exist_ok=True)
    (page_dir / "index.html").write_text(html, encoding="utf-8")
    (page_dir / "INTERACTIONS.json").write_text(interactions_text, encoding="utf-8")
    return page_dir, usage, elapsed


def build_page_c():
    raw, usage, elapsed = call_llm(PAGE_C_PROMPT)
    sections = split_sections(raw, ["MOCKJSON", "MOCKMD", "INTERACTIONS"])
    html = strip_code_fences(sections.get("MAIN", ""))
    mock_json = strip_code_fences(sections.get("MOCKJSON", "[]"))
    mock_md = strip_code_fences(sections.get("MOCKMD", ""))
    interactions_text = strip_code_fences(sections.get("INTERACTIONS", "[]"))
    page_dir = HERE / "page_03_mock_reviews"
    (page_dir / "mock").mkdir(parents=True, exist_ok=True)
    (page_dir / "index.html").write_text(html, encoding="utf-8")
    (page_dir / "mock" / "reviews.json").write_text(mock_json, encoding="utf-8")
    (page_dir / "MOCK.md").write_text(mock_md, encoding="utf-8")
    (page_dir / "INTERACTIONS.json").write_text(interactions_text, encoding="utf-8")
    return page_dir, usage, elapsed


def get_prop(page, selector: str, prop: str):
    js = """(el, prop) => {
        if (prop === 'textContent') return el.textContent;
        if (prop === 'class') return el.className;
        if (prop === 'style') return el.getAttribute('style') || '';
        return el.getAttribute(prop);
    }"""
    return page.eval_on_selector(selector, js, prop)


def run_interactions(page_dir: Path) -> list:
    interactions_path = page_dir / "INTERACTIONS.json"
    results = []
    try:
        interactions = json.loads(interactions_path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return [{"error": f"could not parse INTERACTIONS.json: {exc}"}]

    with serve_dir(page_dir) as base_url:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome")
            try:
                for spec in interactions:
                    page = browser.new_page(viewport={"width": 1280, "height": 800})
                    console_errors = []
                    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
                    rec = {"name": spec.get("name"), "spec": spec}
                    try:
                        page.goto(f"{base_url}/index.html", wait_until="networkidle")
                        page.wait_for_timeout(200)

                        trigger = spec["trigger_selector"]
                        expect_sel = spec["expect_selector"]
                        prop = spec["expect_property"]
                        mode = spec["expect_mode"]
                        value = spec.get("expect_value")

                        trigger_count = page.locator(trigger).count()
                        expect_count = page.locator(expect_sel).count()
                        rec["trigger_found"] = trigger_count > 0
                        rec["expect_target_found"] = expect_count > 0

                        if trigger_count == 0 or expect_count == 0:
                            rec["clicked"] = False
                            rec["pass"] = False
                            rec["reason"] = "trigger or expect_selector not found in DOM"
                        else:
                            before = get_prop(page, expect_sel, prop)
                            page.locator(trigger).first.click()
                            page.wait_for_timeout(600)  # allow JS/mock fetch to settle
                            after = get_prop(page, expect_sel, prop)
                            rec["clicked"] = True
                            rec["before"] = before
                            rec["after"] = after

                            if mode == "changed":
                                passed = (before or "") != (after or "")
                            elif mode == "contains":
                                passed = (value not in (before or "")) and (value in (after or ""))
                            else:
                                passed = False
                                rec["reason"] = f"unknown expect_mode: {mode}"
                            rec["pass"] = bool(passed)
                    except Exception as exc:  # noqa: BLE001
                        rec["pass"] = False
                        rec["error"] = str(exc)
                    rec["console_errors"] = console_errors
                    page.close()
                    results.append(rec)
            finally:
                browser.close()
    return results


def main():
    builders = [("page_01_tabs_counter", build_page_a), ("page_02_nav_faq", build_page_b), ("page_03_mock_reviews", build_page_c)]
    all_results = {}
    for label, builder in builders:
        print(f"=== generating {label} ===", flush=True)
        try:
            page_dir, usage, elapsed = builder()
        except Exception as exc:  # noqa: BLE001
            all_results[label] = {"error": f"generation failed: {exc}"}
            continue
        print(f"  generated in {elapsed:.1f}s", flush=True)
        print(f"=== running interactions for {label} ===", flush=True)
        try:
            interaction_results = run_interactions(page_dir)
        except Exception as exc:  # noqa: BLE001
            interaction_results = [{"error": f"interaction run failed: {exc}"}]
        all_results[label] = {"usage": usage, "gen_elapsed_s": round(elapsed, 2), "interactions": interaction_results}
        for r in interaction_results:
            print(f"  {r.get('name')}: pass={r.get('pass')} reason={r.get('reason', r.get('error',''))}", flush=True)

    (HERE / "SUMMARY.json").write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("done, wrote SUMMARY.json")


if __name__ == "__main__":
    main()
