"""HTML/CSS parsing helpers shared by A3-A6: LLM-output cleanup, design
contract extraction (design-intelligence-spec.md SS3), single-file -> split
materialization (artifact-production-spec.md SS4.1).

These extractors are intentionally simple regex-based scans, not a real CSS
parser. That is a known simplification for spike purposes (see RESULT.md);
it is adequate because the test pages are generated to a controlled style
(inline <style>, no external stylesheets, no CSS-in-JS) so regex recall is
high, but a production extractor would need a real CSS/HTML parser.
"""
from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path

from bs4 import BeautifulSoup

FENCE_RE = re.compile(r"^```(?:html|css|js|json)?\s*\n?|\n?```\s*$", re.MULTILINE)


def strip_code_fences(text: str) -> str:
    """Best-effort: pull the first fenced code block out, or strip stray fences."""
    text = text.strip()
    m = re.search(r"```(?:html|htm)?\s*\n(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # No fence found (or model complied with "no markdown"): return as-is,
    # after trimming any leftover leading/trailing fence markers.
    return FENCE_RE.sub("", text).strip()


ANCHOR_RE = re.compile(
    r'data-oey-(section|object)\s*=\s*"([^"]*)"'
)

COLOR_RE = re.compile(
    r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b"
    r"|rgba?\([^)]*\)"
    r"|hsla?\([^)]*\)"
)

FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*([^;]+);")
FONT_SIZE_RE = re.compile(r"font-size\s*:\s*([0-9.]+(?:px|rem|em|%))\s*;")
FONT_WEIGHT_RE = re.compile(r"font-weight\s*:\s*([0-9]{3}|normal|bold|lighter|bolder)\s*;")
SPACE_PROP_RE = re.compile(
    r"(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?\s*:\s*([^;]+);"
)
SPACE_VALUE_RE = re.compile(r"([0-9.]+(?:px|rem|em|%))")

STYLE_BLOCK_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.DOTALL | re.IGNORECASE)
DATA_URI_RE = re.compile(r'["\'(]\s*(data:[a-zA-Z0-9.+/-]+;base64,[A-Za-z0-9+/=]+)\s*["\')]')


def normalize_color(c: str) -> str:
    return c.strip().lower()


@dataclass
class DesignContract:
    colors: list = field(default_factory=list)
    font_families: list = field(default_factory=list)
    font_sizes: list = field(default_factory=list)
    font_weights: list = field(default_factory=list)
    space_values: list = field(default_factory=list)
    anchors: list = field(default_factory=list)  # ["section:hero", "object:hero.title", ...]
    extractor_version: str = "spike-v1"

    def to_dict(self):
        return asdict(self)

    def token_set(self) -> set:
        """All non-anchor tokens flattened, for drift comparison."""
        s = set()
        s.update(f"color:{c}" for c in self.colors)
        s.update(f"font-family:{f}" for f in self.font_families)
        s.update(f"font-size:{f}" for f in self.font_sizes)
        s.update(f"font-weight:{f}" for f in self.font_weights)
        s.update(f"space:{v}" for v in self.space_values)
        return s


def extract_css_text(html_or_css_texts: list) -> str:
    """Pull all <style> block contents + raw .css file contents into one string."""
    parts = []
    for text in html_or_css_texts:
        parts.extend(m.group(1) for m in STYLE_BLOCK_RE.finditer(text))
        if "<style" not in text.lower() and "<html" not in text.lower():
            # looks like a standalone .css file
            parts.append(text)
    return "\n".join(parts)


def extract_anchors(html_text: str) -> list:
    out = []
    for m in ANCHOR_RE.finditer(html_text):
        kind, value = m.group(1), m.group(2)
        out.append(f"{kind}:{value}")
    return out


def extract_contract(files: dict, extractor_version: str = "spike-v1") -> DesignContract:
    """files: {relative_path: text_content}. Scans all .html for anchors (in
    document order of the entry file if present), all <style> + .css text for
    tokens.
    """
    css_text = extract_css_text(list(files.values()))

    colors = sorted({normalize_color(c) for c in COLOR_RE.findall(css_text)})

    font_families = set()
    for m in FONT_FAMILY_RE.finditer(css_text):
        font_families.add(m.group(1).strip().lower())
    font_families = sorted(font_families)

    font_sizes = sorted({m.group(1) for m in FONT_SIZE_RE.finditer(css_text)})
    font_weights = sorted({m.group(1) for m in FONT_WEIGHT_RE.finditer(css_text)})

    space_values = set()
    for m in SPACE_PROP_RE.finditer(css_text):
        for v in SPACE_VALUE_RE.findall(m.group(1)):
            if v != "0":
                space_values.add(v)
    space_values = sorted(space_values)

    anchors = []
    # Prefer index.html / entry ordering if present, else concatenate all html files.
    html_files = {k: v for k, v in files.items() if k.endswith(".html")}
    entry = html_files.get("index.html") or (next(iter(html_files.values())) if html_files else "")
    for text in ([entry] if entry else []) or html_files.values():
        anchors.extend(extract_anchors(text))
    if not anchors:
        for text in html_files.values():
            anchors.extend(extract_anchors(text))

    return DesignContract(
        colors=colors,
        font_families=font_families,
        font_sizes=font_sizes,
        font_weights=font_weights,
        space_values=space_values,
        anchors=anchors,
        extractor_version=extractor_version,
    )


# ---------------------------------------------------------------------------
# Element-level anchor fingerprints (A3 "anchor preservation" check)
# ---------------------------------------------------------------------------

_WS_RE = re.compile(r"\s+")


def _normalize_tag_str(tag) -> str:
    """Canonicalize a bs4 Tag's outer HTML: sorted attrs, collapsed whitespace."""
    attrs = {k: (" ".join(v) if isinstance(v, list) else v) for k, v in tag.attrs.items()}
    attr_str = " ".join(f'{k}="{attrs[k]}"' for k in sorted(attrs))
    inner = _WS_RE.sub(" ", tag.decode_contents()).strip()
    return f"<{tag.name} {attr_str}>{inner}</{tag.name}>"


def anchor_own_tag_signature(html_text: str) -> dict:
    """Like anchor_fingerprints but only the tag's OWN name+attrs, no children.

    Used for ancestor anchors of the edit scope: an ancestor's subtree is
    expected to change (it contains the edited descendant), but the
    ancestor's own tag/attributes should not.
    """
    soup = BeautifulSoup(html_text, "lxml")
    out: dict = {}
    for kind, attr in (("section", "data-oey-section"), ("object", "data-oey-object")):
        for tag in soup.find_all(attrs={attr: True}):
            value = tag.get(attr)
            key = f"{kind}:{value}"
            attrs = {k: (" ".join(v) if isinstance(v, list) else v) for k, v in tag.attrs.items()}
            attr_str = " ".join(f'{k}="{attrs[k]}"' for k in sorted(attrs))
            sig = f"<{tag.name} {attr_str}>"
            if key in out:
                out[key] = (out[key][0] + 1, out[key][1])
            else:
                out[key] = (1, sig)
    return out


def ancestor_anchor_keys(html_text: str, scope_key: str) -> set:
    """Which anchor keys (section:x / object:y) are ANCESTORS of scope_key's element.

    scope_key like 'object:hero.title'. Returns the set of ancestor anchor
    keys (e.g. {'section:hero'}) -- these legitimately have different
    subtree content after an in-scope edit to their descendant, so they are
    checked by tag-signature only, not full-subtree identity.
    """
    kind, _, value = scope_key.partition(":")
    attr = "data-oey-section" if kind == "section" else "data-oey-object"
    soup = BeautifulSoup(html_text, "lxml")
    tag = soup.find(attrs={attr: value})
    if tag is None:
        return set()
    out = set()
    for parent in tag.parents:
        if not hasattr(parent, "attrs"):
            continue
        if parent.attrs.get("data-oey-section"):
            out.add(f"section:{parent.attrs['data-oey-section']}")
        if parent.attrs.get("data-oey-object"):
            out.add(f"object:{parent.attrs['data-oey-object']}")
    return out


def anchor_fingerprints(html_text: str) -> dict:
    """Map 'section:<name>' / 'object:<name>' -> (count, canonical_outer_html_of_first_match).

    count > 1 flags a duplicated anchor (also a violation if it happens
    outside the declared scope). Uses lxml via bs4 for real tree parsing
    (regex is not reliable enough for "is this subtree byte-identical").
    """
    soup = BeautifulSoup(html_text, "lxml")
    out: dict = {}
    for kind, attr in (("section", "data-oey-section"), ("object", "data-oey-object")):
        for tag in soup.find_all(attrs={attr: True}):
            value = tag.get(attr)
            key = f"{kind}:{value}"
            fp = _normalize_tag_str(tag)
            if key in out:
                out[key] = (out[key][0] + 1, out[key][1])  # keep first fingerprint, bump count
            else:
                out[key] = (1, fp)
    return out


# ---------------------------------------------------------------------------
# Materialization: single-file HTML -> index.html + styles.css + assets/
# ---------------------------------------------------------------------------

_MIME_EXT = {
    "image/svg+xml": "svg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}


def materialize_single_file(html_text: str, out_dir: Path) -> dict:
    """Deterministic split: extract <style> to styles.css, data: URIs to assets/.

    Returns a manifest dict of what was extracted, for logging.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = out_dir / "assets"

    manifest = {"style_extracted": False, "assets": []}

    # 1. Extract inline data: URIs to assets/, rewrite references.
    counter = [0]

    def _replace_data_uri(m):
        uri = m.group(1)
        header, b64data = uri.split(",", 1)
        mime = header.split(";")[0].removeprefix("data:")
        ext = _MIME_EXT.get(mime, "bin")
        counter[0] += 1
        fname = f"asset_{counter[0]}.{ext}"
        assets_dir.mkdir(parents=True, exist_ok=True)
        raw = base64.b64decode(b64data)
        (assets_dir / fname).write_bytes(raw)
        manifest["assets"].append({"file": f"assets/{fname}", "mime": mime, "bytes": len(raw)})
        quote = m.group(0)[0]
        return f"{quote}assets/{fname}{quote}"

    html_text = DATA_URI_RE.sub(_replace_data_uri, html_text)

    # 2. Extract <style> block(s) to styles.css, replace with <link>.
    style_bodies = [m.group(1) for m in STYLE_BLOCK_RE.finditer(html_text)]
    if style_bodies:
        css_text = "\n\n".join(s.strip() for s in style_bodies)
        (out_dir / "styles.css").write_text(css_text, encoding="utf-8")
        manifest["style_extracted"] = True

        def _strip_style(_m):
            return ""

        html_text = STYLE_BLOCK_RE.sub(_strip_style, html_text, count=len(style_bodies))
        link_tag = '<link rel="stylesheet" href="styles.css">'
        if "</head>" in html_text:
            html_text = html_text.replace("</head>", f"  {link_tag}\n</head>", 1)
        else:
            html_text = link_tag + "\n" + html_text

    (out_dir / "index.html").write_text(html_text, encoding="utf-8")
    return manifest
