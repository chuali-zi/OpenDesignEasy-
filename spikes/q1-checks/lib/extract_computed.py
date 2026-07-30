"""Method B: design contract extraction from getComputedStyle() on a real
render (Playwright, channel="chrome" -- no bundled chromium available per
spikes/README.md).

Renders the page, walks every element, and reads its *resolved* computed
style. This resolves CSS variables, inheritance, and anything set by JS at
load time -- source-regex cannot do any of that. Trade-off: color/font
"counts" here mean "how many rendered elements carry this value" (inherited
properties like `color` propagate to every descendant), which is a
different frequency signal than "how many CSS declarations mention it".
"""
from __future__ import annotations

from colors import normalize_color
from contract_common import (
    COLOR_THRESHOLD_COMPUTED,
    ExtractionError,
    build_contract,
)

VERSION = "d3-computed-style-v1"

_EVAL_JS = r"""
() => {
  // border-color / outline-color are only meaningful signals when a border
  // or outline is actually rendered. getComputedStyle() resolves a color
  // for EVERY element regardless (default border-color: currentColor),
  // so counting them unconditionally massively over-counts the page's
  // dominant text color as an "accent" -- filter to width>0 && style!=none.
  const borderSides = [
    ['borderTopColor', 'borderTopWidth', 'borderTopStyle'],
    ['borderRightColor', 'borderRightWidth', 'borderRightStyle'],
    ['borderBottomColor', 'borderBottomWidth', 'borderBottomStyle'],
    ['borderLeftColor', 'borderLeftWidth', 'borderLeftStyle'],
  ];
  const spaceProps = [
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'marginTop','marginRight','marginBottom','marginLeft',
    'rowGap','columnGap'
  ];
  const out = { colors: [], families: [], sizes: [], weights: [], spaces: [], anchors: [] };
  const all = Array.from(document.querySelectorAll('body, body *'));
  for (const el of all) {
    const cs = getComputedStyle(el);
    const cv = cs.color;
    if (cv && cv !== 'rgba(0, 0, 0, 0)') out.colors.push([cv, 'foreground']);
    const bg = cs.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)') out.colors.push([bg, 'background']);
    for (const [colorProp, widthProp, styleProp] of borderSides) {
      if (cs[styleProp] === 'none' || parseFloat(cs[widthProp]) === 0) continue;
      const v = cs[colorProp];
      if (v && v !== 'rgba(0, 0, 0, 0)') out.colors.push([v, 'accent']);
    }
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
      const v = cs.outlineColor;
      if (v && v !== 'rgba(0, 0, 0, 0)') out.colors.push([v, 'accent']);
    }
    out.families.push(cs.fontFamily);
    const sz = parseFloat(cs.fontSize);
    if (!Number.isNaN(sz)) out.sizes.push(sz);
    const fw = cs.fontWeight;
    out.weights.push(fw);
    for (const prop of spaceProps) {
      const raw = cs[prop];
      const val = parseFloat(raw);
      if (!Number.isNaN(val) && val !== 0) out.spaces.push(val);
    }
  }
  document.querySelectorAll('[data-oey-section],[data-oey-object]').forEach(el => {
    if (el.hasAttribute('data-oey-section')) out.anchors.push(['section', el.getAttribute('data-oey-section')]);
    if (el.hasAttribute('data-oey-object')) out.anchors.push(['object', el.getAttribute('data-oey-object')]);
  });
  return out;
}
"""


def extract_from_computed(page, *, source_text: str | None = None) -> dict:
    """`page` is a live Playwright Page that already has content loaded
    (caller controls navigation/goto so this module has no I/O policy of
    its own).

    KNOWN LIMITATION (measured by this spike, see RESULT.md): a real
    browser's HTML5 parser has mandatory error recovery and essentially
    never refuses to produce a DOM -- garbage text with no markup at all
    still renders as a valid (nearly empty) page. Computed-style extraction
    alone therefore cannot distinguish "malformed input" from "legitimately
    sparse page". If the raw source text is available we reuse the same
    coarse "does this even look like markup" check as the source-regex
    extractor; without it, this method silently degrades to an empty-ish
    contract instead of raising -- which is exactly the gap this spike is
    reporting, not hiding.
    """
    if source_text is not None and ("<" not in source_text or ">" not in source_text):
        raise ExtractionError(
            "no tag-like structure found in source; not parseable as markup "
            "(caught via source-text pre-check, not by the renderer itself)"
        )
    try:
        body_count = page.evaluate("document.body ? document.body.querySelectorAll('*').length : -1")
    except Exception as exc:  # noqa: BLE001 - genuinely any JS/eval failure means unparseable
        raise ExtractionError(f"page.evaluate failed: {exc}") from None
    if body_count < 0:
        raise ExtractionError("document.body is missing -- page did not parse into a DOM")

    try:
        raw = page.evaluate(_EVAL_JS)
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError(f"computed-style walk failed: {exc}") from None

    color_occurrences: list[tuple[str, str]] = []
    for value, role in raw["colors"]:
        norm = normalize_color(value)
        if norm is None:
            continue
        color_occurrences.append((norm, role))

    weight_map = {"normal": 400, "bold": 700}
    font_weights = []
    for w in raw["weights"]:
        if w in weight_map:
            font_weights.append(weight_map[w])
        else:
            try:
                font_weights.append(int(float(w)))
            except (TypeError, ValueError):
                continue

    return build_contract(
        version=VERSION,
        color_occurrences=color_occurrences,
        font_families=[f for f in raw["families"] if f],
        font_sizes_px=[float(s) for s in raw["sizes"]],
        font_weights=font_weights,
        space_values_px=[float(s) for s in raw["spaces"]],
        anchors=[(k, v) for k, v in raw["anchors"]],
        color_threshold=COLOR_THRESHOLD_COMPUTED,
    )
