"""Deterministically materialize the Q1 and Q4 HTML fixture corpora."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
Q1_DIR = ROOT / "fixtures" / "q1"
Q4_DIR = ROOT / "fixtures" / "q4"


def page(title: str, body: str, extra_css: str = "", script: str = "") -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; min-height: 100%; }}
    body {{ background: #ffffff; color: #161616; font: 16px/1.5 Arial, sans-serif; }}
    main {{ width: calc(100% - 32px); max-width: 760px; margin: 24px auto; }}
    .panel {{ padding: 24px; border: 1px solid #767676; border-radius: 8px; }}
    button, input, a, [tabindex] {{ font: inherit; }}
    {extra_css}
  </style>
</head>
<body>
  <main data-oey-section="fixture">{body}</main>
  {f'<script>{script}</script>' if script else ''}
</body>
</html>
"""


def q1_cases() -> list[dict]:
    return [
        {
            "id": "violation_contrast_opaque", "expected": ["contrast"],
            "html": page("Opaque low contrast", '<p class="target" data-oey-object="fixture.target">Low contrast opaque text</p>', ".target { color:#999999; }")
        },
        {
            "id": "violation_contrast_alpha_text", "expected": ["contrast"],
            "html": page("Alpha text contrast", '<p class="target" data-oey-object="fixture.target">Translucent dark text</p>', ".target { color:rgba(0,0,0,.35); }")
        },
        {
            "id": "violation_contrast_alpha_background", "expected": ["contrast"],
            "html": page("Alpha background contrast", '<p class="target" data-oey-object="fixture.target">White on translucent black</p>', ".target { color:#ffffff; background:rgba(0,0,0,.35); padding:16px; }")
        },
        {
            "id": "violation_contrast_nested_alpha", "expected": ["contrast"],
            "html": page("Nested alpha contrast", '<div class="surface"><p class="target" data-oey-object="fixture.target">Translucent white text</p></div>', ".surface { background:#1f2937; padding:16px; } .target { color:rgba(255,255,255,.35); }")
        },
        {
            "id": "violation_overflow_fixed_width", "expected": ["overflow"],
            "html": page("Fixed width overflow", '<div class="target" data-oey-object="fixture.target">A fixed 1400 pixel panel</div>', ".target { width:1400px; padding:16px; background:#e7eef8; }")
        },
        {
            "id": "violation_overflow_nowrap_clip", "expected": ["overflow"],
            "html": page("Clipped single line", '<p class="target" data-oey-object="fixture.target">This important sentence is much wider than its deliberately narrow container.</p>', ".target { width:220px; white-space:nowrap; overflow:hidden; }")
        },
        {
            "id": "violation_overflow_vertical_clip", "expected": ["overflow"],
            "html": page("Clipped vertical text", '<p class="target" data-oey-object="fixture.target">Line one needs to remain visible.<br>Line two is also required.<br>Line three is clipped.</p>', ".target { width:260px; height:42px; overflow:hidden; }")
        },
        {
            "id": "violation_overflow_min_grid", "expected": ["overflow"],
            "html": page("Minimum grid overflow", '<div class="target"><span>First wide cell</span><span>Second wide cell</span><span>Third wide cell</span></div>', ".target { display:grid; grid-template-columns:repeat(3,280px); gap:16px; min-width:872px; }", "document.querySelector('.target').setAttribute('data-oey-object','fixture.target');")
        },
        {
            "id": "violation_focus_button", "expected": ["focus"],
            "html": page("Invisible button focus", '<button class="target" data-oey-object="fixture.target">Continue</button>', ".target:focus, .target:focus-visible { outline:none; box-shadow:none; }")
        },
        {
            "id": "violation_focus_link", "expected": ["focus"],
            "html": page("Invisible link focus", '<a class="target" data-oey-object="fixture.target" href="#end">Read details</a><div id="end"></div>', ".target { color:#0645ad; } .target:focus, .target:focus-visible { outline:0; box-shadow:none; }")
        },
        {
            "id": "violation_focus_input", "expected": ["focus"],
            "html": page("Invisible input focus", '<label data-oey-object="fixture.label">Email <input class="target" data-oey-object="fixture.target" value="reader@example.test"></label>', ".target { border:2px solid #555; padding:8px; } .target:focus, .target:focus-visible { outline:none; box-shadow:none; border-color:#555; }")
        },
        {
            "id": "violation_focus_tabindex", "expected": ["focus"],
            "html": page("Invisible custom focus", '<div class="target panel" tabindex="0" data-oey-object="fixture.target">Keyboard-operable card</div>', ".target:focus, .target:focus-visible { outline:none; box-shadow:none; }")
        },
        {
            "id": "clean_opaque_accessible", "expected": [],
            "html": page("Clean opaque", '<section class="panel" data-oey-object="fixture.target"><p>Readable opaque text</p><button>Continue</button></section>', ".panel { color:#222; } button:focus-visible { outline:3px solid #005fcc; outline-offset:2px; }")
        },
        {
            "id": "clean_alpha_accessible", "expected": [],
            "html": page("Clean alpha", '<p class="target" data-oey-object="fixture.target">High contrast after alpha composition</p>', ".target { color:rgba(0,0,0,.8); background:rgba(255,255,255,.75); padding:16px; }")
        },
        {
            "id": "clean_responsive_wrap", "expected": [],
            "html": page("Clean responsive", '<div class="target" data-oey-object="fixture.target"><span>Alpha</span><span>Beta</span><span>Gamma</span></div>', ".target { display:flex; flex-wrap:wrap; gap:16px; } .target span { flex:1 1 180px; padding:16px; background:#eef2f7; }")
        },
        {
            "id": "clean_intentional_scroll", "expected": [],
            "html": page("Clean scroll region", '<div class="target" data-oey-object="fixture.target"><div class="wide">An intentionally scrollable timeline with visible scrollbar behavior.</div></div>', ".target { width:100%; overflow-x:auto; padding:8px; border:1px solid #555; } .wide { width:900px; }")
        },
        {
            "id": "clean_custom_focus", "expected": [],
            "html": page("Clean custom focus", '<a class="target" data-oey-object="fixture.target" href="#done">Open report</a><div id="done"></div>', ".target { color:#0645ad; display:inline-block; padding:8px; } .target:focus-visible { outline:none; box-shadow:0 0 0 3px #ffbf47; }")
        },
        {
            "id": "clean_browser_focus", "expected": [],
            "html": page("Clean browser focus", '<button data-oey-object="fixture.target">Use browser focus ring</button>', "button { padding:8px 16px; }")
        },
    ]


def q4_page(*, copy: str = "Stable design contract", card_order: tuple[str, ...] = ("alpha", "beta"),
            extra_card: bool = False, wrapper: bool = False, equivalent_css: bool = False,
            extra_attr: bool = False, omit_subtitle: bool = False, runtime_anchor: bool = True,
            drift: str | None = None, omit_beta: bool = False) -> str:
    color = "rgb(32, 32, 32)" if equivalent_css else "#202020"
    extra_css = ""
    if drift == "color":
        extra_css = ".drift-a, .drift-b { color:#b00020; }"
    elif drift == "font_size":
        extra_css = ".drift-a, .drift-b { font-size:27px; }"
    elif drift == "space":
        extra_css = ".drift-a, .drift-b { padding:37px; }"
    elif drift == "combined":
        extra_css = ".drift-a, .drift-b { color:#ff00aa; }"
    cards = []
    for idx, name in enumerate(card_order):
        if name == "beta" and omit_beta:
            continue
        drift_class = " drift-a" if idx == 0 and drift in ("color", "font_size", "space", "combined") else ""
        attr = ' aria-label="Stable card"' if extra_attr and idx == 0 else ""
        cards.append(f'<article class="card{drift_class}" data-oey-object="cards.{name}"{attr}><strong>{name.title()}</strong><p>Existing token values.</p></article>')
    if extra_card:
        cards.append('<article class="card" data-oey-object="cards.gamma"><strong>Gamma</strong><p>Uses existing tokens.</p></article>')
    second_drift = '<p class="drift-b" data-oey-object="cards.drift-helper">Second drift target.</p>' if drift in ("color", "font_size", "space", "combined") else ""
    grid = f'<div class="grid">{"".join(cards)}</div>{second_drift}'
    if wrapper:
        grid = f'<div>{grid}</div>'
    subtitle = "" if omit_subtitle else '<p data-oey-object="hero.subtitle">Normal edits must not be reported as drift.</p>'
    runtime_script = "" if not runtime_anchor else """
    const item = document.createElement('p');
    item.className = 'runtime';
    item.setAttribute('data-oey-object', 'cards.runtime');
    item.textContent = 'Rendered runtime anchor';
    document.querySelector('[data-oey-section="cards"]').appendChild(item);
    """
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Q4 contract fixture</title><style>
* {{ box-sizing:border-box; }}
html, body {{ margin:0; }}
body {{ color:{color}; background:#ffffff; font:16px/1.5 Arial,sans-serif; }}
main {{ padding:24px; }}
h1 {{ color:{color}; font-size:32px; font-weight:700; margin:0 0 16px; }}
p {{ color:{color}; font-size:16px; margin:0 0 16px; }}
.grid {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }}
.card {{ color:{color}; background:#f2f4f7; padding:16px; border:1px solid #667085; }}
.card strong {{ color:{color}; display:block; font-size:20px; font-weight:700; margin-bottom:8px; }}
.runtime {{ color:{color}; padding:8px; background:#f2f4f7; }}
{extra_css}
</style></head><body><main>
<section data-oey-section="hero"><h1 data-oey-object="hero.title">{copy}</h1>{subtitle}</section>
<section data-oey-section="cards">{grid}</section>
</main><script>{runtime_script}</script></body></html>
"""


def q4_cases() -> tuple[str, list[dict]]:
    baseline = q4_page()
    cases = [
        {"id": "control_copy_edit", "expected": [], "html": q4_page(copy="Updated copy without visual drift")},
        {"id": "control_reorder", "expected": [], "html": q4_page(card_order=("beta", "alpha"))},
        {"id": "control_add_existing_card", "expected": [], "html": q4_page(extra_card=True)},
        {"id": "control_wrapper", "expected": [], "html": q4_page(wrapper=True)},
        {"id": "control_equivalent_css", "expected": [], "html": q4_page(equivalent_css=True)},
        {"id": "control_attribute_edit", "expected": [], "html": q4_page(extra_attr=True)},
        {"id": "control_copy_and_reorder", "expected": [], "html": q4_page(copy="Another approved wording", card_order=("beta", "alpha"))},
        {"id": "control_runtime_same_dom", "expected": [], "html": q4_page(copy="Runtime DOM remains stable")},
        {"id": "drift_new_color", "expected": ["color"], "html": q4_page(drift="color")},
        {"id": "drift_new_font_size", "expected": ["font_size"], "html": q4_page(drift="font_size")},
        {"id": "drift_new_space", "expected": ["space"], "html": q4_page(drift="space")},
        {"id": "drift_missing_static_anchor", "expected": ["anchor"], "html": q4_page(omit_subtitle=True)},
        {"id": "drift_missing_runtime_anchor", "expected": ["anchor"], "html": q4_page(runtime_anchor=False)},
        {"id": "drift_combined", "expected": ["color", "anchor"], "html": q4_page(drift="combined", omit_beta=True)},
    ]
    return baseline, cases


def write_corpus(directory: Path, cases: list[dict]) -> None:
    manifest = []
    for case in cases:
        filename = f"{case['id']}.html"
        (directory / filename).write_text(case["html"], encoding="utf-8")
        manifest.append({"id": case["id"], "file": filename, "expected": case["expected"]})
    (directory / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    Q1_DIR.mkdir(parents=True, exist_ok=True)
    Q4_DIR.mkdir(parents=True, exist_ok=True)
    write_corpus(Q1_DIR, q1_cases())
    baseline, cases = q4_cases()
    (Q4_DIR / "baseline.html").write_text(baseline, encoding="utf-8")
    write_corpus(Q4_DIR, cases)
    print(f"wrote {len(q1_cases())} Q1 fixtures and {len(cases)} Q4 variants", flush=True)


if __name__ == "__main__":
    main()
