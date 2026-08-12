"""Trusted host renderer contract for the frozen Web profile."""

from __future__ import annotations

import hashlib
import threading
import time
from collections.abc import Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import MappingProxyType
from typing import Any
from urllib.parse import quote

from .domain import ContractError, ErrorCategory, stable_id


@dataclass(frozen=True, slots=True)
class RenderProfile:
    channel: str = "chrome"
    viewport_width: int = 1440
    viewport_height: int = 1000
    device_scale_factor: float = 1.0
    timeout_ms: int = 30_000
    motion: str = "reduce"

    def as_mapping(self) -> MappingProxyType:
        return MappingProxyType(
            {
                "channel": self.channel,
                "viewport": MappingProxyType(
                    {
                        "width": self.viewport_width,
                        "height": self.viewport_height,
                    }
                ),
                "device_scale_factor": self.device_scale_factor,
                "timeout_ms": self.timeout_ms,
                "motion": self.motion,
            }
        )


@dataclass(frozen=True, slots=True)
class RenderResult:
    id: str
    entry: str
    profile: Mapping[str, Any]
    screenshot_path: str | None
    console_errors: tuple[str, ...]
    page_errors: tuple[str, ...]
    failed_requests: tuple[str, ...]
    elapsed_seconds: float
    screenshot_sha256: str | None = None
    chrome_version: str | None = None
    dom_metrics: Mapping[str, Any] = MappingProxyType({})

    @property
    def healthy(self) -> bool:
        return not (
            self.console_errors or self.page_errors or self.failed_requests
        )


class TrustedWebRenderer:
    """Runs Playwright in the trusted host; generated code gets no host tools."""

    capability_version = "playwright-system-chrome/1"
    p6_slot = "render.web"
    ready_for_p6 = True

    def render(
        self,
        root: str | Path,
        entry: str | Path = "index.html",
        *,
        profile: RenderProfile | None = None,
        save_screenshot: bool = True,
    ) -> RenderResult:
        root_input = Path(root)
        if root_input.is_symlink():
            raise _policy("Renderer root cannot be a symbolic link")
        root_path = root_input.resolve()
        entry_path = (root_path / Path(entry)).resolve()
        try:
            entry_path.relative_to(root_path)
        except ValueError as exc:
            raise _policy("Renderer entry escaped artifact root") from exc
        if not root_path.is_dir() or not entry_path.is_file():
            raise _policy("Renderer root or entry is unavailable")
        for candidate in root_path.rglob("*"):
            if candidate.is_symlink():
                raise _policy("Renderer symbolic links are not allowed")
        current = root_path
        for part in entry_path.relative_to(root_path).parts:
            current = current / part
            if current.is_symlink():
                raise _policy("Renderer symbolic links are not allowed")
        selected = profile or RenderProfile()
        if selected.channel != "chrome":
            raise _policy("Frozen renderer profile requires system Chrome")
        entry_relative = entry_path.relative_to(root_path).as_posix()
        profile_fingerprint = {
            "channel": selected.channel,
            "viewport_width": selected.viewport_width,
            "viewport_height": selected.viewport_height,
            "device_scale_factor": selected.device_scale_factor,
            "timeout_ms": selected.timeout_ms,
            "motion": selected.motion,
        }
        screenshot_path = (
            root_path
            / ".agent"
            / "renders"
            / f"{stable_id('render', entry_relative, profile_fingerprint)}.png"
            if save_screenshot
            else None
        )
        if screenshot_path is not None:
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise _capability("Playwright is not installed") from exc

        console_errors: list[str] = []
        page_errors: list[str] = []
        failed_requests: list[str] = []
        chrome_version: str | None = None
        dom_metrics: Mapping[str, Any] = MappingProxyType({})
        started = time.monotonic()
        try:
            with _serve(root_path) as base_url, sync_playwright() as playwright:
                try:
                    browser = playwright.chromium.launch(
                        channel=selected.channel,
                        headless=True,
                    )
                except PlaywrightError as exc:
                    raise _capability(
                        "System Chrome is unavailable for the frozen renderer profile"
                    ) from exc
                with browser:
                    chrome_version = browser.version
                    context = browser.new_context(
                        viewport={
                            "width": selected.viewport_width,
                            "height": selected.viewport_height,
                        },
                        device_scale_factor=selected.device_scale_factor,
                    )
                    with context:
                        page = context.new_page()
                        page.on(
                            "console",
                            lambda message: (
                                console_errors.append(message.text)
                                if message.type == "error"
                                else None
                            ),
                        )
                        page.on(
                            "pageerror",
                            lambda error: page_errors.append(str(error)),
                        )
                        page.on(
                            "requestfailed",
                            lambda request: failed_requests.append(request.url),
                        )

                        def route_handler(route: Any) -> None:
                            url = route.request.url
                            root_url = base_url.rstrip("/") + "/"
                            if (
                                url.startswith(root_url)
                                or url.startswith(("data:", "about:"))
                            ):
                                route.continue_()
                            else:
                                route.abort()

                        page.route("**/*", route_handler)
                        page.goto(
                            f"{base_url}/{quote(entry_relative)}",
                            wait_until="networkidle",
                            timeout=selected.timeout_ms,
                        )
                        page.emulate_media(reduced_motion=selected.motion)
                        page.wait_for_timeout(300)
                        raw_metrics = page.evaluate(
                            """() => {
                              const objects = [...document.querySelectorAll(
                                '[data-oey-object]')]
                                .map((node) => node.getAttribute('data-oey-object'));
                              const sections = [...document.querySelectorAll(
                                '[data-oey-section]')]
                                .map((node) => node.getAttribute('data-oey-section'));
                              const styles = {};
                              for (const node of document.querySelectorAll(
                                '[data-oey-object]')) {
                                const id = node.getAttribute('data-oey-object');
                                const style = getComputedStyle(node);
                                styles[id] = {
                                  color: style.color,
                                  backgroundColor: style.backgroundColor,
                                  fontFamily: style.fontFamily,
                                  fontSize: style.fontSize,
                                  fontWeight: style.fontWeight,
                                  lineHeight: style.lineHeight,
                                  display: style.display
                                };
                              }
                              return {
                                object_anchors: objects,
                                unique_object_anchors: new Set(objects).size,
                                section_anchors: sections,
                                unique_section_anchors: new Set(sections).size,
                                computed_styles: styles,
                                focusable_count: document.querySelectorAll(
                                  'a[href],button,input,select,textarea,[tabindex]'
                                ).length,
                                text_length: (document.body.innerText || '').length,
                                scroll_width: document.documentElement.scrollWidth,
                                client_width: document.documentElement.clientWidth,
                                scroll_height: document.documentElement.scrollHeight
                              };
                            }"""
                        )
                        dom_metrics = MappingProxyType(dict(raw_metrics))
                        if screenshot_path is not None:
                            page.screenshot(path=str(screenshot_path), full_page=True)
        except ContractError:
            raise
        except PlaywrightError as exc:
            raise _capability("Trusted renderer execution failed") from exc
        screenshot_sha256 = (
            hashlib.sha256(screenshot_path.read_bytes()).hexdigest()
            if screenshot_path is not None and screenshot_path.is_file()
            else None
        )
        return RenderResult(
            stable_id("render", entry_relative, profile_fingerprint),
            entry_relative,
            selected.as_mapping(),
            str(screenshot_path) if screenshot_path is not None else None,
            tuple(console_errors),
            tuple(page_errors),
            tuple(failed_requests),
            time.monotonic() - started,
            screenshot_sha256,
            chrome_version,
            dom_metrics,
        )


def _policy(message: str) -> ContractError:
    return ContractError(ErrorCategory.POLICY_BLOCKED, message)


def _capability(message: str) -> ContractError:
    return ContractError(ErrorCategory.CAPABILITY_UNAVAILABLE, message)


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        del format, args


@contextmanager
def _serve(root: Path):
    def handler(*args: Any, **kwargs: Any) -> _QuietHandler:
        return _QuietHandler(*args, directory=str(root), **kwargs)

    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
