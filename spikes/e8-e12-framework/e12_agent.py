"""E12: run one complete framework candidate creation with real build/render loops."""
from __future__ import annotations

import base64
import json
import os
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
RESULTS = HERE / "results"
WORKSPACE = HERE / "workspaces" / "e12-candidate"
sys.path.insert(0, str(HERE.parent / "_lib"))
sys.path.insert(0, str(HERE))

from experiment import MEASURE_SCRIPT, serve, sha256  # noqa: E402
from kimi import chat_stream  # noqa: E402


MAX_STEPS = 60
MAX_TOTAL_TOKENS = 250_000
MAX_WALLCLOCK_S = 900
MAX_TOKENS_PER_CALL = 40_000
MAX_RENDER_LOOPS = 3

SYSTEM_PROMPT = """You are an autonomous senior product designer and React engineer.
Work only through the supplied tools. The project already has fixed React, esbuild, and MUI
dependencies; never add or install dependencies. Diagnose build/render errors from tool output.
Do not finish until the page builds and you have inspected at least one real screenshot."""

TASK_PROMPT = """Create a complete production-quality OEYdesign framework candidate in the existing app.

OEYdesign is a multimodal design agent workspace: natural-language creation, real artifact preview,
object-level feedback, versions, and export. Build a two-column desktop workspace with a narrow
conversation rail and a dominant artifact preview. The conversation must show at least six realistic
user/agent exchanges; the preview must be a complete independent deliverable with its own visual
language, not an extension of the workspace shell.

Required workflow:
1. First write `DIRECTION.json`: a concise art direction with exactly six shell color tokens, type scale,
   spacing scale, layout, signature move, and anti-patterns.
2. Implement with React components and MUI. Register the six colors in `src/theme.js`; override component
   defaults/states that would introduce extra palette colors. Do not use external URLs, images, fonts, CDN,
   or network requests. Use CSS/inline SVG for visual assets.
3. Put `data-oey-section="conversation"` on the conversation region,
   `data-oey-preview-root="artifact"` on the inner deliverable, and stable unique `data-oey-object` values
   on feedback targets. Reused components must receive the anchor as a prop.
4. Use run_build, then render_preview. Inspect the returned screenshot. If you find a layout, legibility,
   completeness, or hierarchy issue, edit and repeat; at most three renders.
5. Finish only after a successful build and screenshot review. Summarize what you verified.

Hard usability floors: readable text >=14px, body contrast >=7:1, secondary contrast >=4.5:1, interactive
height >=32px, no empty panels, no chat bubbles, no gradients/glass/neon. Shell and inner artifact must be
visually distinct. Use only paths relative to the workspace."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List project files except node_modules and build output.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a UTF-8 project file using a relative path.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or replace a UTF-8 project file using a relative path.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                "required": ["path", "content"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_build",
            "description": "Run the fixed offline esbuild production bundle. No arbitrary command is accepted.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "render_preview",
            "description": "Render the latest successful dist with all external requests blocked and capture a screenshot.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
]


def safe_path(raw: str) -> Path:
    candidate = Path(raw)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("path must be relative and stay inside workspace")
    resolved = (WORKSPACE / candidate).resolve()
    try:
        resolved.relative_to(WORKSPACE.resolve())
    except ValueError as exc:
        raise ValueError("path escapes workspace") from exc
    if "node_modules" in candidate.parts or candidate.parts[:1] in [("dist",), (".agent",)]:
        raise ValueError("dependency, build, and agent-state paths are read-only")
    return resolved


def prepare_workspace() -> None:
    if WORKSPACE.exists():
        shutil.rmtree(WORKSPACE)
    WORKSPACE.mkdir(parents=True)
    for name in ("package.json", "package-lock.json", "index.html", "vite.config.js"):
        shutil.copy2(HERE / name, WORKSPACE / name)
    (WORKSPACE / "src").mkdir()
    shutil.copy2(HERE / "src" / "main.jsx", WORKSPACE / "src" / "main.jsx")
    (WORKSPACE / "src" / "theme.js").write_text(
        "import { createTheme } from '@mui/material/styles'\n\n"
        "export const theme = createTheme({ palette: { mode: 'dark' } })\n",
        encoding="utf-8",
    )
    (WORKSPACE / "src" / "App.jsx").write_text(
        "export default function App() { return <main>Build the OEYdesign workspace.</main> }\n",
        encoding="utf-8",
    )
    (WORKSPACE / ".agent" / "shots").mkdir(parents=True)


def build_project() -> dict[str, Any]:
    started = time.time()
    try:
        output = WORKSPACE / "dist" / "assets" / "app.js"
        output.parent.mkdir(parents=True, exist_ok=True)
        clean_env = {
            key: os.environ[key]
            for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP")
            if key in os.environ
        }
        clean_env["NODE_PATH"] = str(HERE / "node_modules")
        result = subprocess.run(
            [
                str(HERE / "node_modules" / "@esbuild" / "win32-x64" / "esbuild.exe"),
                str(WORKSPACE / "src" / "main.jsx"),
                "--bundle",
                f"--outfile={output}",
                "--format=esm",
                "--platform=browser",
                "--jsx=automatic",
                "--minify",
            ],
            cwd=WORKSPACE,
            env=clean_env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode == 0:
            shutil.copy2(HERE / "index.esbuild.html", WORKSPACE / "dist" / "index.html")
        return {
            "ok": result.returncode == 0,
            "exit_code": result.returncode,
            "elapsed_s": round(time.time() - started, 2),
            "stdout": result.stdout[-4000:],
            "stderr": result.stderr[-4000:],
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "exit_code": 124, "elapsed_s": round(time.time() - started, 2), "error": "build timeout"}


def render_project(render_index: int) -> tuple[dict[str, Any], Path | None]:
    dist = WORKSPACE / "dist"
    if not (dist / "index.html").exists():
        return {"ok": False, "error": "dist/index.html is missing; run_build first"}, None
    screenshot = WORKSPACE / ".agent" / "shots" / f"render-{render_index:02d}.png"
    external: list[str] = []
    console_errors: list[str] = []
    started = time.time()
    try:
        with serve(dist) as base_url, sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome")
            try:
                page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

                def route_request(route, request):
                    if request.url.startswith(base_url):
                        route.continue_()
                    else:
                        external.append(request.url)
                        route.abort("blockedbyclient")

                page.route("**/*", route_request)
                page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
                page.goto(f"{base_url}/index.html", wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(1000)
                metrics = page.evaluate(MEASURE_SCRIPT)
                text_length = page.locator("body").inner_text().__len__()
                page.screenshot(path=str(screenshot), full_page=True)
            finally:
                browser.close()
        return {
            "ok": not external and not console_errors,
            "elapsed_s": round(time.time() - started, 2),
            "external_requests": external,
            "console_errors": console_errors,
            "preview_root_found": metrics["previewRootFound"],
            "shell_color_count": metrics["shellColorCount"],
            "shell_colors": metrics["shellColors"],
            "object_anchor_count": len(metrics["objectAnchors"]),
            "unique_object_anchor_count": len(set(metrics["objectAnchors"])),
            "text_length": text_length,
            "screenshot": str(screenshot.relative_to(WORKSPACE)),
            "screenshot_sha256": sha256(screenshot),
        }, screenshot
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "elapsed_s": round(time.time() - started, 2), "error": f"{type(exc).__name__}: {exc}"[:1000]}, None


def execute_tool(name: str, arguments: dict, state: dict[str, Any]) -> tuple[dict[str, Any], Path | None]:
    try:
        if name == "list_files":
            files = [
                path.relative_to(WORKSPACE).as_posix()
                for path in sorted(WORKSPACE.rglob("*"))
                if path.is_file() and "node_modules" not in path.parts and "dist" not in path.parts and ".agent" not in path.parts
            ]
            return {"files": files}, None
        if name == "read_file":
            path = safe_path(arguments["path"])
            return {"path": arguments["path"], "content": path.read_text(encoding="utf-8")[:80_000]}, None
        if name == "write_file":
            path = safe_path(arguments["path"])
            path.parent.mkdir(parents=True, exist_ok=True)
            content = arguments["content"]
            if len(content) > 200_000:
                raise ValueError("file exceeds 200,000 characters")
            path.write_text(content, encoding="utf-8")
            return {"ok": True, "path": arguments["path"], "characters": len(content)}, None
        if name == "run_build":
            state["build_count"] += 1
            result = build_project()
            state["builds"].append(result)
            return result, None
        if name == "render_preview":
            if state["render_count"] >= MAX_RENDER_LOOPS:
                return {"ok": False, "error": f"render limit {MAX_RENDER_LOOPS} reached"}, None
            state["render_count"] += 1
            result, screenshot = render_project(state["render_count"])
            state["renders"].append(result)
            return result, screenshot
        return {"ok": False, "error": f"unknown tool: {name}"}, None
    except (OSError, KeyError, ValueError, json.JSONDecodeError) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:1000]}, None


def call_with_retry(messages: list[dict], remaining_s: float) -> tuple[dict, dict, float]:
    for attempt in range(2):
        try:
            timeout = max(5, min(180, int(remaining_s - 5)))
            return chat_stream(
                messages,
                tools=TOOLS,
                max_tokens=MAX_TOKENS_PER_CALL,
                temperature=1,
                timeout=timeout,
                progress_every=4000,
            )
        except (RuntimeError, TimeoutError, OSError) as exc:
            retryable = isinstance(exc, (TimeoutError, OSError)) or "HTTP 429" in str(exc) or "HTTP 5" in str(exc)
            if not retryable or attempt == 1:
                raise RuntimeError(f"model call failed: {type(exc).__name__}: {exc}") from exc
            time.sleep((2 ** attempt) + random.random())
    raise RuntimeError("unreachable retry state")


def usage_reasoning(usage: dict) -> int:
    details = usage.get("completion_tokens_details")
    return int((details or {}).get("reasoning_tokens") or usage.get("reasoning_tokens") or 0)


def run_agent() -> dict[str, Any]:
    prepare_workspace()
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": TASK_PROMPT},
    ]
    state: dict[str, Any] = {"build_count": 0, "render_count": 0, "builds": [], "renders": []}
    usage_totals = {"prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0, "total_tokens": 0}
    call_log: list[dict[str, Any]] = []
    started = time.time()
    termination = "unknown"
    fatal_error = None

    for step in range(1, MAX_STEPS + 1):
        if time.time() - started >= MAX_WALLCLOCK_S:
            termination = "wallclock_limit"
            break
        if usage_totals["total_tokens"] >= MAX_TOTAL_TOKENS:
            termination = "token_limit"
            break
        remaining_s = MAX_WALLCLOCK_S - (time.time() - started)
        print(f"step {step}: calling model ({remaining_s:.0f}s remaining)", flush=True)
        try:
            message, usage, elapsed = call_with_retry(messages, remaining_s)
        except RuntimeError as exc:
            termination = "api_error"
            fatal_error = str(exc)[:1000]
            break
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            usage_totals[key] += int(usage.get(key) or 0)
        usage_totals["reasoning_tokens"] += usage_reasoning(usage)

        tool_calls = message.get("tool_calls") or []
        assistant_message = {"role": "assistant", "content": message.get("content") or ""}
        if tool_calls:
            assistant_message["tool_calls"] = tool_calls
        messages.append(assistant_message)
        call_log.append({
            "step": step,
            "api_elapsed_s": round(elapsed, 2),
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "reasoning_tokens": usage_reasoning(usage),
            "tool_names": [(call.get("function") or {}).get("name") for call in tool_calls],
        })
        print(
            f"step {step}: {len(tool_calls)} tools, total_tokens={usage_totals['total_tokens']}, api={elapsed:.1f}s",
            flush=True,
        )

        if not tool_calls:
            if state["render_count"] == 0:
                messages.append({"role": "user", "content": "The required real screenshot review is still missing. Continue with run_build and render_preview."})
                continue
            termination = "self_terminated"
            break

        screenshots: list[Path] = []
        for tool_call in tool_calls:
            function = tool_call.get("function") or {}
            try:
                arguments = json.loads(function.get("arguments") or "{}")
                if not isinstance(arguments, dict):
                    raise ValueError("arguments must be an object")
            except (json.JSONDecodeError, ValueError) as exc:
                result, screenshot = {"ok": False, "error": f"invalid arguments: {exc}"}, None
            else:
                result, screenshot = execute_tool(function.get("name", ""), arguments, state)
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.get("id"),
                "content": json.dumps(result, ensure_ascii=False),
            })
            if screenshot:
                screenshots.append(screenshot)
        for screenshot in screenshots:
            encoded = base64.b64encode(screenshot.read_bytes()).decode("ascii")
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": "Inspect this exact render_preview screenshot. State any issue internally, then edit if needed or finish if it meets the brief."},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}},
                ],
            })
    else:
        step = MAX_STEPS
        termination = "step_limit"

    session_wallclock_s = time.time() - started
    final_build = build_project()
    final_render, final_screenshot = render_project(state["render_count"] + 1)
    direction = WORKSPACE / "DIRECTION.json"
    direction_valid = False
    direction_data = None
    if direction.exists():
        try:
            direction_data = json.loads(direction.read_text(encoding="utf-8"))
            direction_valid = isinstance(direction_data, dict)
        except json.JSONDecodeError:
            pass
    app_source = (WORKSPACE / "src" / "App.jsx").read_text(encoding="utf-8", errors="replace")
    mui_used = "@mui/material" in app_source
    anchor_count = final_render.get("object_anchor_count", 0)
    complete = all(
        [
            termination == "self_terminated",
            usage_totals["total_tokens"] <= MAX_TOTAL_TOKENS,
            session_wallclock_s <= MAX_WALLCLOCK_S,
            direction_valid,
            mui_used,
            final_build.get("ok"),
            final_render.get("ok"),
            final_render.get("preview_root_found"),
            anchor_count >= 6,
            anchor_count == final_render.get("unique_object_anchor_count"),
            final_render.get("text_length", 0) >= 500,
            state["render_count"] >= 1,
        ]
    )

    exported = RESULTS / "e12-candidate"
    if exported.exists():
        shutil.rmtree(exported)
    exported.mkdir(parents=True)
    shutil.copytree(WORKSPACE / "src", exported / "src")
    for name in ("DIRECTION.json", "index.html", "vite.config.js", "package.json", "package-lock.json"):
        source = WORKSPACE / name
        if source.exists():
            shutil.copy2(source, exported / name)
    if final_screenshot:
        shutil.copy2(final_screenshot, RESULTS / "e12-final.png")

    return {
        "hypothesis": "A complete framework candidate fits the proposed budget",
        "budget": {"steps": MAX_STEPS, "total_tokens": MAX_TOTAL_TOKENS, "wallclock_s": MAX_WALLCLOCK_S, "render_loops": MAX_RENDER_LOOPS},
        "termination": termination,
        "fatal_error": fatal_error,
        "steps": step,
        "wallclock_s": round(session_wallclock_s, 2),
        "diagnostic_wallclock_s": round(time.time() - started - session_wallclock_s, 2),
        **usage_totals,
        "build_count_during_agent": state["build_count"],
        "render_count_during_agent": state["render_count"],
        "builds": state["builds"],
        "renders": state["renders"],
        "final_build": final_build,
        "final_render": final_render,
        "direction_valid": direction_valid,
        "direction": direction_data,
        "mui_used": mui_used,
        "call_log": call_log,
        "passed": complete,
    }


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    output = RESULTS / "e12.json"
    if output.exists():
        attempts = RESULTS / "e12-attempts"
        attempts.mkdir(exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        shutil.copy2(output, attempts / f"e12-{stamp}.json")
    result = run_agent()
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"E12: {'PASS' if result['passed'] else 'FAIL'}")
    print(f"steps={result['steps']} tokens={result['total_tokens']} wallclock={result['wallclock_s']}s")
    print(output)


if __name__ == "__main__":
    main()
