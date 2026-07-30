"""Real-browser rendering helper shared by all A3-A6 trials.

Serves a directory over a loopback-only HTTP server (127.0.0.1, random free
port) and loads it in real Chrome via Playwright (channel="chrome", per
spikes/README known constraint: no bundled chromium download available).

Serving over HTTP instead of file:// is a deliberate choice, not a
convenience: file:// blocks fetch()/XHR to sibling files under Chrome's
same-origin rules, which would break the mock-layer pages in A6 before we
even get to test them. artifact-production-spec.md SS4.4 says a real
Renderer starts a loopback-only dev server when a product needs one -- this
mirrors that, using nothing but Python's stdlib http.server (no shell
commands from model output are ever executed; this server only ever serves
static files the harness itself wrote).
"""
from __future__ import annotations

import functools
import http.server
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_VIEWPORT = {"width": 1440, "height": 900}


@contextmanager
def serve_dir(root: Path):
    """Serve `root` on 127.0.0.1:<random free port>. Yields base URL."""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)


@dataclass
class RenderResult:
    screenshot_path: Path
    console_errors: list[str] = field(default_factory=list)
    console_warnings: list[str] = field(default_factory=list)
    failed_requests: list[str] = field(default_factory=list)
    page_errors: list[str] = field(default_factory=list)


def render_file_to_png(
    entry_dir: Path,
    entry_file: str,
    out_png: Path,
    viewport: dict | None = None,
    wait_ms: int = 250,
    full_page: bool = True,
) -> RenderResult:
    """Load entry_dir/entry_file over a loopback HTTP server, screenshot to out_png."""
    viewport = viewport or DEFAULT_VIEWPORT
    result = RenderResult(screenshot_path=out_png)
    with serve_dir(entry_dir) as base_url:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome")
            try:
                page = browser.new_page(viewport=viewport)

                def on_console(msg):
                    try:
                        loc_url = (msg.location or {}).get("url", "")
                    except Exception:
                        loc_url = ""
                    if loc_url.endswith("/favicon.ico"):
                        return
                    if msg.type == "error":
                        result.console_errors.append(msg.text)
                    elif msg.type == "warning":
                        result.console_warnings.append(msg.text)

                page.on("console", on_console)
                page.on("requestfailed", lambda req: (
                    result.failed_requests.append(f"{req.url} :: {req.failure}")
                    if not req.url.endswith("/favicon.ico") else None
                ))
                page.on("pageerror", lambda exc: result.page_errors.append(str(exc)))

                # Offline sandbox, per artifact-production-spec.md SS4.4: only the
                # local static server is reachable. External resources must FAIL
                # FAST and be recorded -- letting them hang makes "networkidle"
                # never settle and times the whole render out.
                _block_external(page, base_url)

                _goto_settled(page, f"{base_url}/{entry_file}")
                page.wait_for_timeout(wait_ms)
                out_png.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(out_png), full_page=full_page)
            finally:
                browser.close()
    return result


def _block_external(page, base_url: str) -> None:
    """Abort every request that isn't served by our local static server.

    Mirrors the A2 spike's approved approach: `route.abort("blockedbyclient")`
    surfaces the failure in both `requestfailed` and console, so an offline
    render still *reports* the missing resource instead of silently hanging.
    """
    def handler(route, request):
        if request.url.startswith(base_url):
            route.continue_()
        else:
            route.abort("blockedbyclient")

    page.route("**/*", handler)


def _goto_settled(page, url: str, *, nav_timeout_ms: int = 20000,
                  idle_timeout_ms: int = 5000) -> None:
    """Navigate with a bounded wait.

    `networkidle` alone is fragile: one never-resolving request hangs the whole
    render. We first wait for `domcontentloaded` (hard requirement), then give
    the network a bounded chance to go idle and proceed regardless.
    """
    page.goto(url, wait_until="domcontentloaded", timeout=nav_timeout_ms)
    try:
        page.wait_for_load_state("networkidle", timeout=idle_timeout_ms)
    except Exception:
        pass  # bounded best-effort; a busy page must not fail the render


@contextmanager
def open_page(entry_dir: Path, entry_file: str, viewport: dict | None = None, wait_ms: int = 250):
    """Context manager yielding a live Playwright `page` for interaction tests (A6).

    Server + browser stay alive for the `with` block so the caller can click,
    inspect bounding boxes, etc. before teardown.
    """
    viewport = viewport or DEFAULT_VIEWPORT
    with serve_dir(entry_dir) as base_url:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome")
            try:
                page = browser.new_page(viewport=viewport)
                _block_external(page, base_url)
                _goto_settled(page, f"{base_url}/{entry_file}")
                page.wait_for_timeout(wait_ms)
                yield page
            finally:
                browser.close()
