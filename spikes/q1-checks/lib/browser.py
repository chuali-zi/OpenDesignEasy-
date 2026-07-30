"""Shared Playwright chrome-channel helper. No bundled chromium is
installed (spikes/README.md constraint) so every launch() call must pass
channel="chrome"."""
from __future__ import annotations

from contextlib import contextmanager

from playwright.sync_api import sync_playwright

VIEWPORT = {"width": 1280, "height": 900}


@contextmanager
def chrome_page(html: str | None = None, *, viewport: dict | None = None):
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        try:
            context = browser.new_context(viewport=viewport or VIEWPORT)
            page = context.new_page()
            if html is not None:
                page.set_content(html, wait_until="load")
            yield page
            context.close()
        finally:
            browser.close()


@contextmanager
def chrome_browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        try:
            yield browser
        finally:
            browser.close()
