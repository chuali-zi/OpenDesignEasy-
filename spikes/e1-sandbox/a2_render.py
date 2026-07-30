"""A2 spike: isolated rendering on Windows via Playwright, channel="chrome"
(per spikes/README.md known constraint -- no bundled chromium downloaded).

Threat model note (see RESULT.md): this is a DIFFERENT boundary than E1's
general subprocess sandbox. The untrusted artifact here is HTML/CSS/JS
*content*, executed inside Chromium's own renderer process (already
sandboxed by Google) and driven entirely through the Playwright API. The
artifact's JS cannot reach the OS directly -- it can only do what a web
page can do. So "no network" for THIS specific tool is enforced by
intercepting requests at the Playwright/CDP layer, which the page content
has no way to bypass (short of a Chromium sandbox-escape vulnerability,
out of scope for this spike).

Checks:
  1. Local page loads, local CSS/JS/image resolve.
  2. External resources (image + script) are BLOCKED and the failure is
     captured as a fact (console + failed-request log), not silently
     swallowed.
  3. console.log / console.error both captured.
  4. A hard time limit on page.goto / overall run.
  5. A screenshot is produced.
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
FIXTURE = HERE / "a2_fixture" / "index.html"
SCREENSHOT_OUT = HERE / "a2_screenshot.png"

ALLOWED_HOSTS = {"", "localhost", "127.0.0.1"}  # "" covers file:// requests


def host_of(url: str) -> str:
    from urllib.parse import urlparse
    return urlparse(url).hostname or ""


def main():
    console_messages = []
    failed_requests = []
    blocked_requests = []

    t_start = time.monotonic()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})

        def route_handler(route):
            url = route.request.url
            h = host_of(url)
            if h in ALLOWED_HOSTS or url.startswith("file:"):
                route.continue_()
            else:
                blocked_requests.append(url)
                route.abort("blockedbyclient")

        context.route("**/*", route_handler)

        page = context.new_page()
        page.on("console", lambda msg: console_messages.append(
            {"type": msg.type, "text": msg.text}
        ))
        page.on("requestfailed", lambda req: failed_requests.append(
            {"url": req.url, "failure": req.failure}
        ))

        goto_ok = True
        goto_error = None
        try:
            page.goto(FIXTURE.as_uri(), timeout=8000, wait_until="networkidle")
        except Exception as e:  # noqa: BLE001 -- want to capture and report, not crash
            goto_ok = False
            goto_error = str(e)

        title = page.title()
        page.screenshot(path=str(SCREENSHOT_OUT))
        elapsed = time.monotonic() - t_start

        browser.close()

    report = {
        "elapsed_s": round(elapsed, 3),
        "goto_ok": goto_ok,
        "goto_error": goto_error,
        "title": title,
        "console_messages": console_messages,
        "failed_requests": failed_requests,
        "blocked_by_route": blocked_requests,
        "screenshot": str(SCREENSHOT_OUT),
        "screenshot_exists": SCREENSHOT_OUT.exists(),
        "screenshot_bytes": SCREENSHOT_OUT.stat().st_size if SCREENSHOT_OUT.exists() else 0,
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))

    out_path = HERE / "a2_result.json"
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


if __name__ == "__main__":
    main()
