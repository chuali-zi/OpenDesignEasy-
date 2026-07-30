from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright


OUT = Path(__file__).resolve().parent
RAW = OUT / "raw"
PAGES = (
    ("seedream-api-reference", "https://www.volcengine.com/docs/82379/1541523?lang=zh"),
    ("volcengine-terms", "https://www.volcengine.com/docs/6256/64982?lang=zh"),
    ("generative-model-terms", "https://www.volcengine.com/docs/6561/1533787?lang=zh"),
)
ENV_ALLOWLIST = (
    "APPDATA",
    "COMSPEC",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
)


def isolate_environment() -> None:
    allowed = {name: os.environ[name] for name in ENV_ALLOWLIST if name in os.environ}
    os.environ.clear()
    os.environ.update(allowed)


def main() -> int:
    isolate_environment()
    RAW.mkdir(parents=True, exist_ok=True)
    records = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        try:
            context = browser.new_context(locale="zh-CN", viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            for page_id, url in PAGES:
                record = {"page_id": page_id, "requested_url": url}
                try:
                    response = page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                    page.wait_for_timeout(10_000)
                    body = page.evaluate("document.body ? document.body.innerText : ''")
                    record.update(
                        {
                            "http_status": response.status if response else None,
                            "final_url": page.url,
                            "title": page.title(),
                            "body_text": body,
                        }
                    )
                    (RAW / f"{page_id}.txt").write_text(body + "\n", encoding="utf-8")
                except PlaywrightError as error:
                    record["failure"] = {"type": type(error).__name__, "message": str(error)}
                records.append(record)
            context.close()
        finally:
            browser.close()

    result = {"captured_at": datetime.now(timezone.utc).isoformat(), "pages": records}
    (RAW / "official-rights-pages.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"CAPTURED: {len(records)} official page(s); raw/official-rights-pages.json written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
