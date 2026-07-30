"""Deterministic CSS color normalization (no external deps).

Goal: many source spellings of "the same" color must normalize to one
canonical token so drift/recall comparisons aren't swamped by spelling
noise. Canonical form:

  - opaque color  -> "#rrggbb" lowercase hex
  - color w/ alpha < 1 -> "rgba(r,g,b,a)" with a rounded to 2 decimals
  - unrecognized / unresolved (var(), currentColor, inherit, transparent)
    -> returned as a normalized keyword string, never silently dropped
"""
from __future__ import annotations

import re

# CSS Level-4 extended named colors (subset covering the common web palette;
# exact RGB accuracy is not load-bearing for this spike -- what matters is
# that the SAME name always maps to the SAME value, which a fixed dict
# guarantees regardless of table completeness).
NAMED_COLORS: dict[str, tuple[int, int, int]] = {
    "black": (0, 0, 0), "white": (255, 255, 255), "red": (255, 0, 0),
    "green": (0, 128, 0), "blue": (0, 0, 255), "yellow": (255, 255, 0),
    "cyan": (0, 255, 255), "aqua": (0, 255, 255), "magenta": (255, 0, 255),
    "fuchsia": (255, 0, 255), "silver": (192, 192, 192), "gray": (128, 128, 128),
    "grey": (128, 128, 128), "maroon": (128, 0, 0), "olive": (128, 128, 0),
    "purple": (128, 0, 128), "teal": (0, 128, 128), "navy": (0, 0, 128),
    "orange": (255, 165, 0), "pink": (255, 192, 203), "brown": (165, 42, 42),
    "gold": (255, 215, 0), "coral": (255, 127, 80), "salmon": (250, 128, 114),
    "tomato": (255, 99, 71), "orchid": (218, 112, 214), "indigo": (75, 0, 130),
    "violet": (238, 130, 238), "crimson": (220, 20, 60), "khaki": (240, 230, 140),
    "plum": (221, 160, 221), "ivory": (255, 255, 240), "beige": (245, 245, 220),
    "azure": (240, 255, 255), "lavender": (230, 230, 250), "chocolate": (210, 105, 30),
    "tan": (210, 180, 140), "whitesmoke": (245, 245, 245), "gainsboro": (220, 220, 220),
    "slategray": (112, 128, 144), "slategrey": (112, 128, 144),
    "steelblue": (70, 130, 180), "royalblue": (65, 105, 225),
    "dodgerblue": (30, 144, 255), "skyblue": (135, 206, 235),
    "lightskyblue": (135, 206, 250), "forestgreen": (34, 139, 34),
    "seagreen": (46, 139, 87), "darkgreen": (0, 100, 0), "darkred": (139, 0, 0),
    "darkblue": (0, 0, 139), "lightblue": (173, 216, 230), "lightgreen": (144, 238, 144),
    "lightgray": (211, 211, 211), "lightgrey": (211, 211, 211),
    "darkgray": (169, 169, 169), "darkgrey": (169, 169, 169),
    "dimgray": (105, 105, 105), "dimgrey": (105, 105, 105),
    "cornflowerblue": (100, 149, 237), "midnightblue": (25, 25, 112),
    "mediumblue": (0, 0, 205), "darkslategray": (47, 79, 79),
    "darkslategrey": (47, 79, 79), "darkorange": (255, 140, 0),
    "darkviolet": (148, 0, 211), "deeppink": (255, 20, 147),
    "hotpink": (255, 105, 180), "firebrick": (178, 34, 34),
    "chartreuse": (127, 255, 0), "lawngreen": (124, 252, 0),
    "lime": (0, 255, 0), "limegreen": (50, 205, 50),
    "mediumseagreen": (60, 179, 113), "mediumspringgreen": (0, 250, 154),
    "springgreen": (0, 255, 127), "turquoise": (64, 224, 208),
    "mediumturquoise": (72, 209, 204), "darkturquoise": (0, 206, 209),
    "lightcyan": (224, 255, 255), "paleturquoise": (175, 238, 238),
    "powderblue": (176, 224, 230), "lightsteelblue": (176, 196, 222),
    "cadetblue": (95, 158, 160), "darkcyan": (0, 139, 139),
    "darkgoldenrod": (184, 134, 11), "goldenrod": (218, 165, 32),
    "lightgoldenrodyellow": (250, 250, 210), "palegoldenrod": (238, 232, 170),
    "moccasin": (255, 228, 181), "navajowhite": (255, 222, 173),
    "peachpuff": (255, 218, 185), "peru": (205, 133, 63),
    "sienna": (160, 82, 45), "saddlebrown": (139, 69, 19),
    "sandybrown": (244, 164, 96), "burlywood": (222, 184, 135),
    "wheat": (245, 222, 179), "rosybrown": (188, 143, 143),
    "indianred": (205, 92, 92), "lightcoral": (240, 128, 128),
    "darksalmon": (233, 150, 122), "lightsalmon": (255, 160, 122),
    "orangered": (255, 69, 0), "mediumvioletred": (199, 21, 133),
    "palevioletred": (219, 112, 147), "mediumorchid": (186, 85, 211),
    "darkorchid": (153, 50, 204), "blueviolet": (138, 43, 226),
    "mediumpurple": (147, 112, 219), "rebeccapurple": (102, 51, 153),
    "thistle": (216, 191, 216), "mediumslateblue": (123, 104, 238),
    "slateblue": (106, 90, 205), "darkslateblue": (72, 61, 139),
    "aliceblue": (240, 248, 255), "ghostwhite": (248, 248, 255),
    "honeydew": (240, 255, 240), "mintcream": (245, 255, 250),
    "seashell": (255, 245, 238), "linen": (250, 240, 230),
    "oldlace": (253, 245, 230), "floralwhite": (255, 250, 240),
    "cornsilk": (255, 248, 220), "lemonchiffon": (255, 250, 205),
    "lightyellow": (255, 255, 224), "snow": (255, 250, 250),
    "mistyrose": (255, 228, 225), "antiquewhite": (250, 235, 215),
    "papayawhip": (255, 239, 213), "blanchedalmond": (255, 235, 205),
    "bisque": (255, 228, 196), "lightpink": (255, 182, 193),
    "yellowgreen": (154, 205, 50), "olivedrab": (107, 142, 35),
    "darkkhaki": (189, 183, 107), "darkolivegreen": (85, 107, 47),
    "darkseagreen": (143, 188, 143), "palegreen": (152, 251, 152),
    "greenyellow": (173, 255, 47), "aquamarine": (127, 255, 212),
    "mediumaquamarine": (102, 205, 170), "lightseagreen": (32, 178, 170),
    "deepskyblue": (0, 191, 255),
}

# Values that cannot/should not be resolved to an RGB triplet. Kept verbatim
# (normalized to lowercase, whitespace-collapsed) rather than dropped, per
# the "no silent empty contract" rule.
UNRESOLVED_KEYWORDS = {"transparent", "currentcolor", "inherit", "initial", "unset", "none"}

_HEX3 = re.compile(r"^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$")
_HEX4 = re.compile(r"^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$")
_HEX6 = re.compile(r"^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$")
_HEX8 = re.compile(r"^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$")
_RGB = re.compile(
    r"^rgba?\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*(?:,\s*([\d.]+%?)\s*)?\)$"
)
_HSL = re.compile(
    r"^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+%?)\s*)?\)$"
)


def _clamp(v: float, lo: float = 0, hi: float = 255) -> int:
    return int(round(min(hi, max(lo, v))))


def _hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    h = (h % 360) / 360.0
    s /= 100.0
    l /= 100.0
    if s == 0:
        r = g = b = l
    else:
        def hue2rgb(p, q, t):
            if t < 0:
                t += 1
            if t > 1:
                t -= 1
            if t < 1 / 6:
                return p + (q - p) * 6 * t
            if t < 1 / 2:
                return q
            if t < 2 / 3:
                return p + (q - p) * (2 / 3 - t) * 6
            return p
        q = l * (1 + s) if l < 0.5 else l + s - l * s
        p = 2 * l - q
        r = hue2rgb(p, q, h + 1 / 3)
        g = hue2rgb(p, q, h)
        b = hue2rgb(p, q, h - 1 / 3)
    return _clamp(r * 255), _clamp(g * 255), _clamp(b * 255)


def _alpha_from(raw: str | None) -> float:
    if raw is None:
        return 1.0
    raw = raw.strip()
    if raw.endswith("%"):
        return round(float(raw[:-1]) / 100.0, 4)
    return round(float(raw), 4)


def normalize_color(raw: str) -> str | None:
    """Normalize one CSS color value to a canonical token.

    Returns None if the input does not look like a color at all (caller
    should not count it). Returns a keyword string for unresolved dynamic
    values (transparent/currentColor/var(...)/inherit) rather than raising,
    per "unresolved-but-not-crashing" -- those are reported separately by
    callers, never silently merged into the color set.
    """
    if raw is None:
        return None
    s = raw.strip().lower()
    if not s:
        return None
    if s in UNRESOLVED_KEYWORDS:
        return s
    if s.startswith("var(") or s.startswith("url("):
        return s
    if s in NAMED_COLORS:
        r, g, b = NAMED_COLORS[s]
        return f"#{r:02x}{g:02x}{b:02x}"

    m = _HEX6.match(s)
    if m:
        return f"#{m.group(1).lower()}{m.group(2).lower()}{m.group(3).lower()}"
    m = _HEX8.match(s)
    if m:
        r, g, b, a = m.groups()
        alpha = int(a, 16) / 255.0
        if alpha >= 0.999:
            return f"#{r.lower()}{g.lower()}{b.lower()}"
        return f"rgba({int(r,16)},{int(g,16)},{int(b,16)},{round(alpha,2)})"
    m = _HEX3.match(s)
    if m:
        r, g, b = (c * 2 for c in m.groups())
        return f"#{r.lower()}{g.lower()}{b.lower()}"
    m = _HEX4.match(s)
    if m:
        r, g, b, a = (c * 2 for c in m.groups())
        alpha = int(a, 16) / 255.0
        if alpha >= 0.999:
            return f"#{r.lower()}{g.lower()}{b.lower()}"
        return f"rgba({int(r,16)},{int(g,16)},{int(b,16)},{round(alpha,2)})"

    m = _RGB.match(s)
    if m:
        r_raw, g_raw, b_raw, a_raw = m.groups()

        def chan(v: str) -> int:
            if v.endswith("%"):
                return _clamp(float(v[:-1]) / 100.0 * 255)
            return _clamp(float(v))
        r, g, b = chan(r_raw), chan(g_raw), chan(b_raw)
        alpha = _alpha_from(a_raw)
        if alpha >= 0.999:
            return f"#{r:02x}{g:02x}{b:02x}"
        return f"rgba({r},{g},{b},{alpha})"

    m = _HSL.match(s)
    if m:
        h_raw, s_raw, l_raw, a_raw = m.groups()
        r, g, b = _hsl_to_rgb(float(h_raw), float(s_raw), float(l_raw))
        alpha = _alpha_from(a_raw)
        if alpha >= 0.999:
            return f"#{r:02x}{g:02x}{b:02x}"
        return f"rgba({r},{g},{b},{alpha})"

    return None


def relative_luminance(hexcolor: str) -> float:
    """WCAG relative luminance for an opaque #rrggbb color."""
    h = hexcolor.lstrip("#")
    r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = lin(r), lin(g), lin(b)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(hex_a: str, hex_b: str) -> float:
    la, lb = relative_luminance(hex_a), relative_luminance(hex_b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def blend_over(fg_rgba: str, bg_hex: str) -> str:
    """Alpha-composite an rgba(...) foreground over an opaque #rrggbb
    background, returning an opaque #rrggbb. Used so contrast math has a
    single opaque pair even when the top layer is translucent."""
    m = _RGB.match(fg_rgba.strip().lower())
    if not m:
        return fg_rgba
    r, g, bch, a_raw = m.groups()
    a = _alpha_from(a_raw)
    fr, fg_, fb = float(r), float(g), float(bch)
    h = bg_hex.lstrip("#")
    br, bg2, bb = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    out_r = _clamp(fr * a + br * (1 - a))
    out_g = _clamp(fg_ * a + bg2 * (1 - a))
    out_b = _clamp(fb * a + bb * (1 - a))
    return f"#{out_r:02x}{out_g:02x}{out_b:02x}"
