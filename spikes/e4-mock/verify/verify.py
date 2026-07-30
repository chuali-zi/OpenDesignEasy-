"""E4 spike: verify with a real browser that the agent-authored mock frontend
actually runs the interaction, not just that it parses.

For each run dir under spikes/e4-mock/runs/run-*:
  1. serve the dir over a local static HTTP server (no CDN/file:// CORS issues)
  2. load index.html in real Chrome (channel="chrome" -- no bundled chromium)
  3. collect console errors + failed resource loads
  4. heuristically locate a "project list" and a "chat" interaction area via
     data-oey-section attributes, click a second project item, send a chat
     message, and check whether the DOM actually changed
  5. screenshot before/after into spikes/e4-mock/shots/run-XX/
  6. write spikes/e4-mock/runs/run-XX/_verify_report.json

Usage: python spikes/e4-mock/verify/verify.py [run_name ...]
       python spikes/e4-mock/verify/verify.py --all
"""
from __future__ import annotations

import functools
import http.server
import json
import os
import sys
import threading
import time

from playwright.sync_api import sync_playwright

RUNS_ROOT = os.path.join("spikes", "e4-mock", "runs")
SHOTS_ROOT = os.path.join("spikes", "e4-mock", "shots")


def free_port() -> int:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(directory: str):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    port = free_port()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    httpd.RequestHandlerClass.log_message = lambda *a, **k: None  # silence
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, port


PROJECT_KEYWORDS = ["project", "session", "conversation", "workspace", "item", "list", "项目", "会话", "工作台"]
CHAT_KEYWORDS = ["chat", "message", "conversation", "dialog", "对话", "消息", "聊天"]
PREVIEW_KEYWORDS = ["preview", "artifact", "output", "canvas", "预览", "产出", "画布"]

# Control-ish elements we don't want to mistake for a clickable "row": refresh
# buttons, filter inputs, add/new buttons, etc. Excluded by keyword match on
# either their own text or their data-oey-object attribute value.
ROW_BLACKLIST_KEYWORDS = [
    "refresh", "filter", "search", "new", "add", "create", "刷新", "筛选",
    "搜索", "新建", "添加", "title", "summary", "empty", "head",
]


def find_repeated_rows(page, section_name: str):
    """Find elements that look like repeated list rows inside a section:
    prefer <li>, then elements whose data-oey-object value repeats (a
    template-loop signature), excluding obvious control elements."""
    sel = f'[data-oey-section="{section_name}"]'

    li_rows = page.query_selector_all(f"{sel} li")
    if len(li_rows) >= 2:
        return li_rows

    # gather (element handle, attr value) for all data-oey-object descendants
    infos = page.eval_on_selector_all(
        f"{sel} [data-oey-object]",
        """els => els.map((e, i) => ({
            idx: i,
            value: e.getAttribute('data-oey-object'),
            text: (e.innerText || '').trim().slice(0, 200)
        }))""",
    )
    handles = page.query_selector_all(f"{sel} [data-oey-object]")

    from collections import Counter
    counts = Counter(info["value"] for info in infos)
    repeated_values = {v for v, c in counts.items() if c >= 2}
    rows = []
    for info, handle in zip(infos, handles):
        val = (info["value"] or "").lower()
        if info["value"] in repeated_values and info["text"]:
            if any(kw in val for kw in ROW_BLACKLIST_KEYWORDS):
                continue
            rows.append(handle)
    if rows:
        return rows

    # last resort: any button/a in the section, minus blacklisted labels
    fallback = page.query_selector_all(f"{sel} button, {sel} a")
    filtered = []
    for el in fallback:
        try:
            txt = (el.inner_text() or "").strip().lower()
        except Exception:
            txt = ""
        attr = (el.get_attribute("data-oey-object") or "").lower()
        if any(kw in txt or kw in attr for kw in ROW_BLACKLIST_KEYWORDS):
            continue
        if txt:
            filtered.append(el)
    return filtered


def snapshot_text(page, selector="body"):
    try:
        return page.eval_on_selector(selector, "el => el.innerText")
    except Exception:
        return ""


def find_section_by_keywords(page, keywords):
    """Return the data-oey-section value whose name/text matches keywords, or None."""
    sections = page.eval_on_selector_all(
        "[data-oey-section]",
        "els => els.map(e => ({name: e.getAttribute('data-oey-section'), text: e.innerText.slice(0,200)}))",
    )
    lowered_kw = [k.lower() for k in keywords]
    for sec in sections:
        name = (sec.get("name") or "").lower()
        text = (sec.get("text") or "").lower()
        if any(k in name for k in lowered_kw) or any(k in text for k in lowered_kw):
            return sec.get("name")
    return None


def verify_run(run_name: str, headless: bool = True) -> dict:
    run_dir = os.path.join(RUNS_ROOT, run_name)
    report = {
        "run": run_name,
        "load_ok": False,
        "console_errors": [],
        "failed_requests": [],
        "sections_found": [],
        "project_switch": {"attempted": False, "changed": False, "detail": ""},
        "chat_send": {"attempted": False, "changed": False, "detail": ""},
        "classification": "UNKNOWN",
        "screenshots": [],
    }

    index_path = os.path.join(run_dir, "index.html")
    if not os.path.isfile(index_path):
        report["classification"] = "COMPLETELY_UNUSABLE"
        report["detail"] = "no index.html produced"
        return report

    shots_dir = os.path.join(SHOTS_ROOT, run_name)
    os.makedirs(shots_dir, exist_ok=True)

    httpd, port = start_server(run_dir)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=headless)
            page = browser.new_page(viewport={"width": 1440, "height": 900})

            console_errors = []
            failed_requests = []
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            page.on("pageerror", lambda exc: console_errors.append(f"pageerror: {exc}"))
            page.on("requestfailed", lambda req: failed_requests.append(
                f"{req.method} {req.url} -> {req.failure}"))
            page.on("response", lambda resp: failed_requests.append(f"{resp.status} {resp.url}")
                     if resp.status >= 400 else None)

            try:
                page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="load", timeout=20000)
                page.wait_for_timeout(800)
                report["load_ok"] = True
            except Exception as exc:  # noqa: BLE001
                report["classification"] = "COMPLETELY_UNUSABLE"
                report["detail"] = f"page.goto failed: {exc}"
                browser.close()
                return report

            shot0 = os.path.join(shots_dir, "01-initial.png")
            page.screenshot(path=shot0, full_page=True)
            report["screenshots"].append(shot0)

            sections = page.eval_on_selector_all(
                "[data-oey-section]", "els => els.map(e => e.getAttribute('data-oey-section'))")
            report["sections_found"] = sections

            body_before = snapshot_text(page)

            # ---- Try project switch ----
            proj_section = find_section_by_keywords(page, PROJECT_KEYWORDS)
            if proj_section:
                report["project_switch"]["attempted"] = True
                candidates = find_repeated_rows(page, proj_section)
                target = candidates[1] if len(candidates) > 1 else (candidates[0] if candidates else None)
                if target:
                    try:
                        target.click(timeout=5000)
                        page.wait_for_timeout(1200)
                        body_after_click = snapshot_text(page)
                        changed = body_after_click != body_before
                        report["project_switch"]["changed"] = changed
                        report["project_switch"]["detail"] = (
                            "DOM text changed after clicking a project-list item"
                            if changed else "DOM text identical after click"
                        )
                        shot1 = os.path.join(shots_dir, "02-after-project-click.png")
                        page.screenshot(path=shot1, full_page=True)
                        report["screenshots"].append(shot1)
                    except Exception as exc:  # noqa: BLE001
                        report["project_switch"]["detail"] = f"click failed: {exc}"
                else:
                    report["project_switch"]["detail"] = "no clickable candidate rows found"
            else:
                report["project_switch"]["detail"] = "no section matched project keywords"

            # ---- Try chat send ----
            chat_section = find_section_by_keywords(page, CHAT_KEYWORDS)
            if chat_section:
                report["chat_send"]["attempted"] = True
                sel = f'[data-oey-section="{chat_section}"]'
                input_el = page.query_selector(f'{sel} textarea') or page.query_selector(f'{sel} input[type="text"]') \
                    or page.query_selector(f'{sel} input:not([type])') or page.query_selector(f'{sel} [contenteditable="true"]')
                send_btn = page.query_selector(f'{sel} button[type="submit"]') or page.query_selector(f'{sel} button')
                if input_el:
                    try:
                        before_html = page.eval_on_selector(sel, "el => el.innerHTML.length")
                        probe_text = "spike-e4 ping 测试消息"
                        input_el.click()
                        input_el.fill(probe_text)
                        if send_btn:
                            send_btn.click(timeout=5000)
                        else:
                            input_el.press("Enter")
                        page.wait_for_timeout(2500)
                        after_html = page.eval_on_selector(sel, "el => el.innerHTML.length")
                        body_now = snapshot_text(page)
                        contains_probe = probe_text in body_now
                        changed = after_html != before_html or contains_probe
                        report["chat_send"]["changed"] = changed
                        report["chat_send"]["detail"] = (
                            f"chat area innerHTML length {before_html} -> {after_html}; "
                            f"probe text present={contains_probe}"
                        )
                        shot2 = os.path.join(shots_dir, "03-after-chat-send.png")
                        page.screenshot(path=shot2, full_page=True)
                        report["screenshots"].append(shot2)
                    except Exception as exc:  # noqa: BLE001
                        report["chat_send"]["detail"] = f"send failed: {exc}"
                else:
                    report["chat_send"]["detail"] = "no input/textarea found in chat section"
            else:
                report["chat_send"]["detail"] = "no section matched chat keywords"

            report["console_errors"] = console_errors[:50]
            report["failed_requests"] = failed_requests[:50]
            # favicon.ico 404s are a browser default-request artifact, not a
            # mock/interaction defect -- flagged separately so they don't
            # drown out real resource failures in the summary.
            report["console_errors_excluding_favicon"] = [
                e for e in console_errors if "favicon" not in e.lower()
            ][:50]
            report["failed_requests_excluding_favicon"] = [
                r for r in failed_requests if "favicon" not in r.lower()
            ][:50]

            browser.close()
    finally:
        httpd.shutdown()

    # classification
    ps_ok = report["project_switch"]["attempted"] and report["project_switch"]["changed"]
    cs_ok = report["chat_send"]["attempted"] and report["chat_send"]["changed"]
    hard_errors = [e for e in report["console_errors"]]
    if not report["load_ok"]:
        report["classification"] = "COMPLETELY_UNUSABLE"
    elif ps_ok and cs_ok:
        report["classification"] = "FULLY_INTERACTIVE"
    elif ps_ok or cs_ok:
        report["classification"] = "PARTIALLY_INTERACTIVE"
    else:
        report["classification"] = "COMPLETELY_UNUSABLE"

    out_path = os.path.join(run_dir, "_verify_report.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return report


def main():
    args = sys.argv[1:]
    if not args or args == ["--all"]:
        names = sorted(
            n for n in os.listdir(RUNS_ROOT)
            if n.startswith("run-") and os.path.isdir(os.path.join(RUNS_ROOT, n))
        )
    else:
        names = args

    results = []
    for name in names:
        print(f"=== verifying {name} ===", flush=True)
        try:
            r = verify_run(name)
            print(f"  classification={r['classification']} sections={r.get('sections_found')} "
                  f"project_switch={r['project_switch']} chat_send={r['chat_send']} "
                  f"console_errors={len(r['console_errors'])} failed_requests={len(r['failed_requests'])}",
                  flush=True)
        except Exception as exc:  # noqa: BLE001
            r = {"run": name, "classification": "ERROR", "detail": str(exc)}
            print(f"  ERROR: {exc}", flush=True)
        results.append(r)

    summary_path = os.path.join(RUNS_ROOT, "_verify_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"summary -> {summary_path}")


if __name__ == "__main__":
    main()
