"""Method A: design contract extraction by regexing CSS/HTML source text.

Does NOT render anything. Reads <style> blocks + inline style="" attributes
+ data-oey-* attributes directly from the text. Fast, no browser needed.
Known limitation (surfaced by the spike): cannot resolve CSS custom
properties (var(--x)) or anything set via JS -- those pass through as an
opaque "var(...)" token rather than a resolved color/size.
"""
from __future__ import annotations

import re

from colors import normalize_color
from contract_common import (
    COLOR_THRESHOLD_SOURCE,
    ExtractionError,
    build_contract,
)

VERSION = "d3-source-regex-v1"

_STYLE_BLOCK = re.compile(r"<style[^>]*>(.*?)</style>", re.IGNORECASE | re.DOTALL)
_INLINE_STYLE = re.compile(r'style\s*=\s*"([^"]*)"', re.IGNORECASE)
_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_DECL = re.compile(r"([a-zA-Z-]+)\s*:\s*([^;{}]+);")
_ANCHOR = re.compile(r'data-oey-(section|object)\s*=\s*"([^"]*)"', re.IGNORECASE)

_COLOR_PROPS = {
    "color": "foreground",
    "background": "background",
    "background-color": "background",
    "border": "accent",
    "border-color": "accent",
    "border-top-color": "accent",
    "border-right-color": "accent",
    "border-bottom-color": "accent",
    "border-left-color": "accent",
    "outline": "accent",
    "outline-color": "accent",
    "box-shadow": "accent",
    "fill": "accent",
    "stroke": "accent",
    "text-decoration-color": "accent",
    "caret-color": "accent",
    "accent-color": "accent",
}
_SPACE_PROPS = {
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "gap", "row-gap", "column-gap",
}

_COLOR_TOKEN = re.compile(
    r"#[0-9a-fA-F]{3,8}\b"
    r"|rgba?\([^)]*\)"
    r"|hsla?\([^)]*\)"
    r"|\b[a-zA-Z]{3,}\b"
)
_LEN_TOKEN = re.compile(r"(-?[\d.]+)(px|rem|em|pt|%)?")


def _px(value: float, unit: str | None) -> float | None:
    if unit in (None, "px", ""):
        return value
    if unit == "rem" or unit == "em":
        return value * 16.0
    if unit == "pt":
        return value * (96.0 / 72.0)
    return None  # % and unresolved units: skip, documented limitation


def _sanity_check(html: str) -> None:
    if not html or not html.strip():
        raise ExtractionError("empty input")
    if "<" not in html or ">" not in html:
        raise ExtractionError("no tag-like structure found; not parseable as markup")
    for tag in ("html", "body"):
        opens = len(re.findall(rf"<{tag}[\s>]", html, re.IGNORECASE))
        closes = len(re.findall(rf"</{tag}\s*>", html, re.IGNORECASE))
        if opens != closes:
            raise ExtractionError(
                f"unbalanced <{tag}>: {opens} open vs {closes} close -- "
                "looks truncated/malformed, refusing to guess"
            )


def extract_from_source(html: str) -> dict:
    _sanity_check(html)

    css_text = "\n".join(m.group(1) for m in _STYLE_BLOCK.finditer(html))
    css_text = _COMMENT.sub("", css_text)
    inline_texts = _INLINE_STYLE.findall(html)

    color_occurrences: list[tuple[str, str]] = []
    font_families: list[str] = []
    font_sizes: list[float] = []
    font_weights: list[int] = []
    space_values: list[float] = []

    def consume_declarations(text: str) -> None:
        for prop_raw, val_raw in _DECL.findall(text):
            prop = prop_raw.strip().lower()
            val = val_raw.strip()
            if prop in _COLOR_PROPS:
                role = _COLOR_PROPS[prop]
                for tok in _COLOR_TOKEN.findall(val):
                    norm = normalize_color(tok)
                    if norm is None:
                        continue
                    if norm in ("solid", "none", "dashed", "dotted", "double", "auto"):
                        continue
                    color_occurrences.append((norm, role))
            elif prop == "font-family":
                cleaned = ", ".join(
                    p.strip().strip("'\"") for p in val.split(",") if p.strip()
                )
                if cleaned:
                    font_families.append(cleaned)
            elif prop == "font-size":
                m = _LEN_TOKEN.match(val)
                if m:
                    px = _px(float(m.group(1)), m.group(2))
                    if px is not None and px > 0:
                        font_sizes.append(px)
            elif prop == "font-weight":
                kw = {"normal": 400, "bold": 700}
                if val.lower() in kw:
                    font_weights.append(kw[val.lower()])
                elif re.fullmatch(r"\d{3}", val):
                    font_weights.append(int(val))
            elif prop in _SPACE_PROPS:
                for num, unit in _LEN_TOKEN.findall(val):
                    px = _px(float(num), unit)
                    if px is not None and px != 0:
                        space_values.append(abs(px))

    consume_declarations(css_text)
    # Inline style="" attributes: wrap each so the shared declaration parser
    # (which expects a trailing ';') still matches the last property.
    for raw in inline_texts:
        consume_declarations(raw if raw.rstrip().endswith(";") else raw + ";")

    anchors = [(m.group(1).lower(), m.group(2)) for m in _ANCHOR.finditer(html)]

    return build_contract(
        version=VERSION,
        color_occurrences=color_occurrences,
        font_families=font_families,
        font_sizes_px=font_sizes,
        font_weights=font_weights,
        space_values_px=space_values,
        anchors=anchors,
        color_threshold=COLOR_THRESHOLD_SOURCE,
    )
