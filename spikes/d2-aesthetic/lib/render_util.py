"""Render helper for this spike: real Chrome via Playwright, serving a candidate's
files over a loopback HTTP server (not file://, so fetch()/mock layers work).

Reuses spikes/a3-render/lib/render.py's `serve_dir` (imported, not copied) for the
loopback static server, since that helper is already validated for this repo's
Playwright setup (channel="chrome", no bundled chromium -- see spikes/README.md).
Only writes inside spikes/d2-aesthetic/, per this spike's constraint.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "a3-render", "lib"))
from render import serve_dir, DEFAULT_VIEWPORT  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from checks import measure_overflow  # noqa: E402


def render_and_measure(entry_dir: Path, entry_file: str, out_png: Path,
                        viewport: dict | None = None, wait_ms: int = 350) -> dict:
    """Serve entry_dir, load entry_file in real Chrome, screenshot + collect
    console/network/page errors + overflow measurement. Returns a plain dict
    (JSON-serializable) so callers can dump it straight to disk.
    """
    viewport = viewport or DEFAULT_VIEWPORT
    result: dict = {
        "screenshot": str(out_png),
        "console_errors": [],
        "console_warnings": [],
        "failed_requests": [],
        "page_errors": [],
        "load_ok": False,
        "overflow": None,
    }
    with serve_dir(entry_dir) as base_url:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome")
            try:
                page = browser.new_page(viewport=viewport)

                def on_console(msg):
                    if msg.type == "error":
                        result["console_errors"].append(msg.text)
                    elif msg.type == "warning":
                        result["console_warnings"].append(msg.text)

                page.on("console", on_console)
                page.on("requestfailed", lambda req: result["failed_requests"].append(
                    f"{req.url} :: {req.failure}"
                ))
                page.on("pageerror", lambda exc: result["page_errors"].append(str(exc)))

                try:
                    page.goto(f"{base_url}/{entry_file}", wait_until="networkidle", timeout=20000)
                    result["load_ok"] = True
                except Exception as exc:  # noqa: BLE001
                    result["page_errors"].append(f"goto failed: {exc}")

                page.wait_for_timeout(wait_ms)
                out_png.parent.mkdir(parents=True, exist_ok=True)
                try:
                    page.screenshot(path=str(out_png), full_page=True)
                except Exception as exc:  # noqa: BLE001
                    result["page_errors"].append(f"screenshot failed: {exc}")

                try:
                    result["overflow"] = measure_overflow(page)
                except Exception as exc:  # noqa: BLE001
                    result["overflow"] = {"error": str(exc)}
            finally:
                browser.close()
    return result
