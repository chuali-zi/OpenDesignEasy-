"""Objective, deterministic checks used by the D2/E2/Q2/Q3 spike.

No model calls in this file. Everything here is code-only measurement:
overflow detection via a real Chrome viewport, and anchor extraction via
regex over the candidate's own HTML source (data-oey-section / data-oey-object).
"""
from __future__ import annotations

import re

OVERFLOW_JS = """
() => {
  const vw = window.innerWidth;
  const results = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right - vw > 1) {
      let sel = el.tagName.toLowerCase();
      if (el.id) sel += '#' + el.id;
      else if (typeof el.className === 'string' && el.className.trim()) {
        sel += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
      }
      results.push({ selector: sel, right_overflow_px: Math.round(rect.right - vw) });
    }
  }
  return {
    viewport_width: vw,
    doc_scroll_width: document.documentElement.scrollWidth,
    overflow_count: results.length,
    overflow_elements: results.slice(0, 20),
  };
}
"""

SECTION_RE = re.compile(r'data-oey-section\s*=\s*"([^"]+)"')
OBJECT_RE = re.compile(r'data-oey-object\s*=\s*"([^"]+)"')


def measure_overflow(page) -> dict:
    """Run OVERFLOW_JS in the given live Playwright page. Returns a plain dict."""
    return page.evaluate(OVERFLOW_JS)


def extract_anchors(files: dict[str, str]) -> dict:
    """Regex-extract data-oey-section / data-oey-object anchors from all HTML-ish
    file contents in `files` (path -> content). Deterministic, no model involved.
    """
    sections: set[str] = set()
    objects: set[str] = set()
    for _path, content in files.items():
        for m in SECTION_RE.finditer(content):
            sections.add(m.group(1))
        for m in OBJECT_RE.finditer(content):
            objects.add(m.group(1))
    return {
        "sections": sorted(sections),
        "objects": sorted(objects),
        "all_refs": sorted(sections | objects),
    }
