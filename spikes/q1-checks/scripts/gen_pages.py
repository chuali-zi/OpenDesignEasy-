"""D3 corpus generation: ask k3 for 15 style-diverse, self-contained single
HTML pages. We do NOT execute anything the model returns -- its output is
HTML/CSS text that we save to disk. No tool calls, no shell commands are
requested or run here.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, "spikes/_lib")
from kimi import chat  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PAGES_DIR = ROOT / "pages"
PAGES_DIR.mkdir(exist_ok=True)

BRIEFS = [
    ("01_brutalist_portfolio", "a brutalist personal design-portfolio homepage, harsh black/white/one accent, huge type"),
    ("02_saas_dashboard_landing", "a marketing landing page for a B2B SaaS analytics dashboard product, blue/indigo corporate palette"),
    ("03_minimal_blog", "a minimalist single-column reading blog homepage, warm off-white background, serif body text"),
    ("04_ecommerce_product", "an e-commerce single product detail page for sneakers, bold accent color, price + add to cart"),
    ("05_dark_admin_panel", "a dark-mode admin panel overview page with stat cards and a sidebar nav, near-black background"),
    ("06_playful_kids_app", "a playful landing page for a kids' learning app, bright saturated multi-color palette, rounded shapes"),
    ("07_corporate_law_firm", "a conservative corporate law firm homepage, navy and gold, serif headings, trustworthy tone"),
    ("08_restaurant_menu", "a restaurant homepage with a menu section, warm earthy palette, elegant script-ish display font stack"),
    ("09_fitness_landing", "a high-energy fitness/gym landing page, red/black palette, bold condensed headings"),
    ("10_crypto_exchange", "a crypto exchange marketing landing page, dark background with neon green/purple accents"),
    ("11_nonprofit_donation", "a nonprofit donation campaign landing page, hopeful green/teal palette, large donate CTA"),
    ("12_photography_portfolio", "a photography portfolio homepage, near-black background so photos pop, minimal chrome"),
    ("13_real_estate_listing", "a real-estate single listing detail page, clean whites with a deep green accent"),
    ("14_music_streaming", "a music streaming app landing page, dark purple/pink gradient-heavy palette"),
    ("15_news_article", "a news publication article reading page, classic black-on-white editorial serif typography"),
]

SYSTEM = """You write a single self-contained HTML page for a design-extraction test.
Hard requirements, follow exactly:
1. Output ONLY the raw HTML document, starting with <!doctype html> and nothing before or after it. No markdown fences, no commentary.
2. Everything inline in ONE file: all CSS inside a single <style> tag in <head>. No external stylesheets, no external fonts (no @import, no Google Fonts, no CDN links), no external images, no external JS. Use font stacks of system/generic fonts only (e.g. Arial, Georgia, 'Segoe UI', sans-serif).
3. Use plain CSS colors only: hex (#rrggbb), rgb()/rgba(), hsl()/hsla(), or standard named colors. No CSS custom properties (no var(--x)), no color-mix(), no currentColor for background/text roles.
4. Establish a real design system baked into the CSS: reuse the SAME color values across multiple rules (don't invent a new one-off color for every element), a font-size scale of around 5-7 distinct sizes reused across headings/body/labels, and a spacing scale of around 4-6 distinct padding/margin/gap values reused across the layout. This repetition is required, not optional -- a page that uses a different color/size everywhere is wrong for this test.
5. The page must have at least 6 structural regions, each wrapped in an element carrying a data-oey-section="<name>" attribute, and at least 12 elements total (across those sections) carrying data-oey-object="<section>.<name>" attributes on meaningful content (headings, paragraphs, buttons, images, list items, form fields, etc). Use lowercase dot.separated names, e.g. data-oey-section="hero", data-oey-object="hero.title".
6. Include realistic placeholder copy (no lorem ipsum gibberish -- write real-sounding sentences for the described product/subject), and normal semantic HTML landmarks (header/nav/main/footer as fits).
7. No JavaScript is required; if you include any, it must not be required for the page to render its content.
8. Length target: substantial but not enormous -- roughly 150-320 lines of HTML total.
"""


def strip_fences(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:html)?\s*(.*?)\s*```$", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    return text


def gen_one(name: str, brief: str, attempt: int = 0) -> str:
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"Build this page: {brief}."},
    ]
    try:
        msg, usage, elapsed = chat(messages, max_tokens=8000, temperature=1)
    except RuntimeError as exc:
        if attempt < 4 and ("429" in str(exc) or "HTTP 5" in str(exc)):
            backoff = 2 ** attempt * 3
            print(f"  retrying {name} after {backoff}s ({exc})", flush=True)
            time.sleep(backoff)
            return gen_one(name, brief, attempt + 1)
        raise
    content = msg.get("content") or ""
    html = strip_fences(content)
    print(f"  {name}: {elapsed:.1f}s, usage={usage}", flush=True)
    return html


def main() -> None:
    manifest = []
    for name, brief in BRIEFS:
        out_path = PAGES_DIR / f"{name}.html"
        if out_path.exists() and out_path.stat().st_size > 200:
            print(f"skip existing {name}")
            manifest.append({"name": name, "brief": brief, "path": str(out_path), "cached": True})
            continue
        print(f"generating {name} ...", flush=True)
        html = gen_one(name, brief)
        out_path.write_text(html, encoding="utf-8")
        manifest.append({"name": name, "brief": brief, "path": str(out_path), "cached": False})
    (PAGES_DIR / "_manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("done, wrote", len(manifest), "entries")


if __name__ == "__main__":
    main()
