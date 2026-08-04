"""Validate shell color ownership across resting and interactive states."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright

from experiment import HERE, RESULTS, serve


TOKENS = {
    "rgb(20, 19, 17)",
    "rgb(30, 28, 25)",
    "rgb(237, 234, 227)",
    "rgb(168, 162, 154)",
    "rgb(51, 48, 43)",
    "rgb(232, 96, 44)",
}

SCAN = r"""
() => {
  const preview = document.querySelector('[data-oey-preview-root]');
  const excluded = new Set(preview ? [preview, ...preview.querySelectorAll('*')] : []);
  const properties = [
    'color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
    'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor',
    'caretColor', 'columnRuleColor', 'fill', 'stroke', 'boxShadow', 'textShadow',
  ];
  const colors = {};
  const add = (value, element, property, pseudo = '') => {
    if (!value || value === 'none' || value === 'rgba(0, 0, 0, 0)') return;
    const matches = value.match(/rgba?\([^)]*\)/g) || [];
    for (const color of matches) {
      if (color === 'rgba(0, 0, 0, 0)') continue;
      if (!colors[color]) colors[color] = [];
      if (colors[color].length < 4) {
        colors[color].push({
          tag: element.tagName,
          className: String(element.className || '').slice(0, 100),
          property,
          pseudo,
        });
      }
    }
  };
  for (const element of document.querySelectorAll('body, body *')) {
    if (excluded.has(element)) continue;
    for (const pseudo of ['', '::before', '::after']) {
      const style = getComputedStyle(element, pseudo || null);
      if (pseudo && style.content === 'none') continue;
      for (const property of properties) {
        if ((property === 'fill' || property === 'stroke') &&
            !['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'].includes(element.tagName.toLowerCase())) {
          continue;
        }
        add(style[property], element, property, pseudo);
      }
    }
  }
  return colors;
}
"""


def build_fixture() -> Path:
    output = RESULTS / "e11-strict-build"
    if output.exists():
        shutil.rmtree(output)
    (output / "assets").mkdir(parents=True)
    env = {
        key: os.environ[key]
        for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP")
        if key in os.environ
    }
    env["NODE_PATH"] = str(HERE / "node_modules")
    result = subprocess.run(
        [
            str(HERE / "node_modules" / "@esbuild" / "win32-x64" / "esbuild.exe"),
            str(HERE / "src" / "main.jsx"),
            "--bundle",
            f"--outfile={output / 'assets' / 'app.js'}",
            "--format=esm",
            "--platform=browser",
            "--jsx=automatic",
            "--minify",
        ],
        cwd=HERE,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-4000:])
    shutil.copy2(HERE / "index.esbuild.html", output / "index.html")
    return output


def main() -> None:
    build = build_fixture()
    states: dict[str, dict] = {}
    with serve(build) as base_url, sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.route(
                "**/*",
                lambda route, request: route.continue_()
                if request.url.startswith(base_url)
                else route.abort("blockedbyclient"),
            )
            page.goto(f"{base_url}/index.html", wait_until="networkidle", timeout=30000)
            states["rest"] = page.evaluate(SCAN)

            buttons = page.locator("button")
            for index in range(buttons.count()):
                buttons.nth(index).hover()
                page.wait_for_timeout(50)
                states[f"hover_button_{index}"] = page.evaluate(SCAN)

            buttons.first.focus()
            page.wait_for_timeout(50)
            states["focus_button_0"] = page.evaluate(SCAN)
            buttons.first.evaluate("element => { element.disabled = true }")
            page.wait_for_timeout(50)
            states["disabled_button_0"] = page.evaluate(SCAN)
        finally:
            browser.close()

    union = sorted({color for colors in states.values() for color in colors})
    leaks = {
        state: {color: samples for color, samples in colors.items() if color not in TOKENS}
        for state, colors in states.items()
    }
    leaks = {state: values for state, values in leaks.items() if values}
    record = {
        "declared_tokens": sorted(TOKENS),
        "states": states,
        "union": union,
        "union_count": len(union),
        "unowned_by_state": leaks,
        "passed": len(union) == 6 and not leaks and set(union) == TOKENS,
    }
    output = RESULTS / "e11-diagnostics.json"
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"E11 strict states: {'PASS' if record['passed'] else 'FAIL'} ({len(union)} colors)")
    print(output)


if __name__ == "__main__":
    main()
