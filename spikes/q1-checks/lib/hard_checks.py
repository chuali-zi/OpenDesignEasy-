"""Rendered hard checks for Q1.

All observations come from a live DOM and getComputedStyle(). The checker
deliberately requires data-oey anchors so every finding is actionable.
"""
from __future__ import annotations

from typing import Any

from colors import blend_over, contrast_ratio, normalize_color

CHECKER_VERSION = "q1-rendered-hard-checks-v1"

_TEXT_JS = r"""
() => {
  const visible = el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' &&
      parseFloat(cs.opacity) > 0 && r.width > 0 && r.height > 0;
  };
  const anchorFor = el => {
    const a = el.closest('[data-oey-object],[data-oey-section]');
    if (!a) return null;
    return a.hasAttribute('data-oey-object')
      ? `object:${a.getAttribute('data-oey-object')}`
      : `section:${a.getAttribute('data-oey-section')}`;
  };
  const result = [];
  for (const el of document.querySelectorAll('body, body *')) {
    if (!visible(el)) continue;
    const text = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim()).join(' ').trim();
    if (!text) continue;
    const anchor = anchorFor(el);
    if (!anchor) continue;
    const chain = [];
    for (let cur = el; cur; cur = cur.parentElement) chain.unshift(cur);
    const backgrounds = chain.map(n => getComputedStyle(n).backgroundColor);
    const cs = getComputedStyle(el);
    result.push({
      anchor, tag: el.tagName.toLowerCase(), text: text.slice(0, 80),
      color: cs.color, backgrounds,
      fontSize: parseFloat(cs.fontSize), fontWeight: parseFloat(cs.fontWeight) || 400
    });
  }
  return result;
}
"""

_OVERFLOW_JS = r"""
() => {
  const anchorName = el => el.hasAttribute('data-oey-object')
    ? `object:${el.getAttribute('data-oey-object')}`
    : `section:${el.getAttribute('data-oey-section')}`;
  const visible = (el, cs, r) => cs.display !== 'none' &&
    cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0 &&
    r.width > 0 && r.height > 0;
  const anchors = [];
  for (const el of document.querySelectorAll('[data-oey-object],[data-oey-section]')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, cs, r)) continue;
    anchors.push({
      anchor: anchorName(el),
      rect: {left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height},
      clientWidth: el.clientWidth, clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
      overflowX: cs.overflowX, overflowY: cs.overflowY
    });
  }
  return {
    viewportWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    anchors
  };
}
"""

_FOCUS_SETUP_JS = r"""
() => {
  const candidates = Array.from(document.querySelectorAll(
    'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
  )).filter(el => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return !el.disabled && cs.display !== 'none' && cs.visibility !== 'hidden' &&
      r.width > 0 && r.height > 0 && el.closest('[data-oey-object],[data-oey-section]');
  });
  const snap = el => {
    const cs = getComputedStyle(el);
    return {
      outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor, boxShadow: cs.boxShadow,
      borderTop: cs.borderTop, borderRight: cs.borderRight,
      borderBottom: cs.borderBottom, borderLeft: cs.borderLeft,
      backgroundColor: cs.backgroundColor
    };
  };
  const baseline = {};
  candidates.forEach((el, i) => {
    el.setAttribute('data-q1-focus-index', String(i));
    baseline[String(i)] = snap(el);
  });
  document.body.setAttribute('tabindex', '-1');
  document.body.focus();
  return {count: candidates.length, baseline};
}
"""

_FOCUS_CURRENT_JS = r"""
() => {
  const el = document.activeElement;
  if (!el || !el.hasAttribute('data-q1-focus-index')) return null;
  const a = el.closest('[data-oey-object],[data-oey-section]');
  const cs = getComputedStyle(el);
  return {
    index: el.getAttribute('data-q1-focus-index'),
    anchor: a.hasAttribute('data-oey-object')
      ? `object:${a.getAttribute('data-oey-object')}`
      : `section:${a.getAttribute('data-oey-section')}`,
    tag: el.tagName.toLowerCase(), focusVisible: el.matches(':focus-visible'),
    style: {
      outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor, boxShadow: cs.boxShadow,
      borderTop: cs.borderTop, borderRight: cs.borderRight,
      borderBottom: cs.borderBottom, borderLeft: cs.borderLeft,
      backgroundColor: cs.backgroundColor
    }
  };
}
"""


def _opaque_background(backgrounds: list[str]) -> str:
    current = "#ffffff"
    for raw in backgrounds:
        color = normalize_color(raw)
        if not color or color == "transparent":
            continue
        current = blend_over(color, current) if color.startswith("rgba(") else color
    return current


def _alpha(raw: str) -> float:
    normalized = normalize_color(raw)
    if normalized == "transparent":
        return 0.0
    if normalized and normalized.startswith("rgba("):
        return float(normalized.rsplit(",", 1)[1].rstrip(")"))
    return 1.0 if normalized else 0.0


def check_contrast(page) -> list[dict[str, Any]]:
    findings = []
    for item in page.evaluate(_TEXT_JS):
        background = _opaque_background(item["backgrounds"])
        foreground = normalize_color(item["color"])
        if not foreground or not background.startswith("#"):
            continue
        effective_fg = blend_over(foreground, background) if foreground.startswith("rgba(") else foreground
        if not effective_fg.startswith("#"):
            continue
        ratio = contrast_ratio(effective_fg, background)
        large = item["fontSize"] >= 24 or (item["fontSize"] >= 18.66 and item["fontWeight"] >= 700)
        threshold = 3.0 if large else 4.5
        if ratio + 1e-9 < threshold:
            findings.append({
                "category": "contrast", "target_ref": item["anchor"],
                "reason": "text contrast below WCAG AA",
                "ratio": round(ratio, 3), "threshold": threshold,
                "computed_color": item["color"], "composited_foreground": effective_fg,
                "composited_background": background, "text": item["text"],
            })
    return findings


def check_overflow(page) -> list[dict[str, Any]]:
    raw = page.evaluate(_OVERFLOW_JS)
    findings = []
    seen = set()
    for item in raw["anchors"]:
        reasons = []
        rect = item["rect"]
        if rect["left"] < -1 or rect["right"] > raw["viewportWidth"] + 1:
            reasons.append("anchor extends outside the horizontal viewport")
        if item["overflowX"] in ("hidden", "clip") and item["scrollWidth"] > item["clientWidth"] + 1:
            reasons.append("horizontal content is clipped")
        if item["overflowY"] in ("hidden", "clip") and item["scrollHeight"] > item["clientHeight"] + 1:
            reasons.append("vertical content is clipped")
        if reasons and item["anchor"] not in seen:
            seen.add(item["anchor"])
            findings.append({
                "category": "overflow", "target_ref": item["anchor"],
                "reason": "; ".join(reasons),
                "computed_overflow": [item["overflowX"], item["overflowY"]],
                "client_size": [item["clientWidth"], item["clientHeight"]],
                "scroll_size": [item["scrollWidth"], item["scrollHeight"]],
                "rect": item["rect"],
            })
    if raw["documentScrollWidth"] > raw["viewportWidth"] + 1 and not findings:
        findings.append({
            "category": "overflow", "target_ref": "document:root",
            "reason": "document is wider than the viewport",
            "viewport_width": raw["viewportWidth"],
            "document_scroll_width": raw["documentScrollWidth"],
        })
    return findings


def _has_focus_indicator(before: dict[str, str], after: dict[str, str]) -> bool:
    outline_width = float(after["outlineWidth"].removesuffix("px") or 0)
    outline = after["outlineStyle"] not in ("none", "hidden") and outline_width >= 1 and _alpha(after["outlineColor"]) > 0.05
    shadow = after["boxShadow"] != "none" and after["boxShadow"] != before["boxShadow"]
    changed_surface = after["backgroundColor"] != before["backgroundColor"]
    changed_border = any(after[key] != before[key] for key in ("borderTop", "borderRight", "borderBottom", "borderLeft"))
    return outline or shadow or changed_surface or changed_border


def check_focus(page) -> list[dict[str, Any]]:
    setup = page.evaluate(_FOCUS_SETUP_JS)
    findings = []
    visited = set()
    for _ in range(setup["count"] + 1):
        page.keyboard.press("Tab")
        current = page.evaluate(_FOCUS_CURRENT_JS)
        if not current or current["index"] in visited:
            continue
        visited.add(current["index"])
        before = setup["baseline"][current["index"]]
        if not current["focusVisible"] or not _has_focus_indicator(before, current["style"]):
            findings.append({
                "category": "focus", "target_ref": current["anchor"],
                "reason": "keyboard focus has no visible computed-style indicator",
                "tag": current["tag"], "focus_visible": current["focusVisible"],
                "before": before, "focused": current["style"],
            })
    return findings


def run_hard_checks(page) -> list[dict[str, Any]]:
    return check_contrast(page) + check_overflow(page) + check_focus(page)
