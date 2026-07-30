import json
import sys

sys.path.insert(0, "lib")
from browser import chrome_page  # noqa: E402
from contract_common import ExtractionError  # noqa: E402
from extract_computed import extract_from_computed  # noqa: E402

print("start", flush=True)

sample = """
<!doctype html>
<html><head><style>
body { color: #222222; background-color: #ffffff; font-family: Arial, sans-serif; }
h1 { font-size: 32px; font-weight: 700; color: #222222; margin-bottom: 16px; }
p { font-size: 16px; color: #222222; margin-bottom: 8px; }
.btn { background: #ff6600; color: white; padding: 12px 24px; border-radius: 4px; }
.card { padding: 16px; margin: 8px; background-color: rgb(255,255,255); border: 1px solid #eeeeee; }
</style></head>
<body>
<section data-oey-section="hero">
<h1 data-oey-object="hero.title">Hello</h1>
<p data-oey-object="hero.summary">World</p>
<button class="btn" style="background:#ff6600;color:#fff;padding:12px 24px;">Go</button>
</section>
</body></html>
"""

print("launching chrome...", flush=True)
with chrome_page(sample) as page:
    print("page loaded, extracting...", flush=True)
    c = extract_from_computed(page, source_text=sample)
    print(json.dumps(c, indent=2), flush=True)

print("second launch: garbage text", flush=True)
with chrome_page("garbage text no tags at all") as page:
    try:
        c3 = extract_from_computed(page, source_text="garbage text no tags at all")
        print("FAIL should raise", flush=True)
    except ExtractionError as e:
        print("OK raised:", e, flush=True)

print("done", flush=True)
