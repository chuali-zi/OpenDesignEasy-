import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from htmlutil import extract_contract, anchor_fingerprints, materialize_single_file, strip_code_fences

SAMPLE = '''```html
<!doctype html>
<html><head><meta charset="utf-8">
<style>
body{font-family: -apple-system, sans-serif; color:#111827; background:#ffffff; padding: 24px;}
h1{font-size: 32px; font-weight: 700; margin-bottom: 16px;}
p{font-size: 16px; font-weight: 400;}
.btn{background:#2563eb; color:#fff; padding: 12px 24px; border-radius: 8px;}
</style>
</head>
<body>
<section data-oey-section="hero">
  <h1 data-oey-object="hero.title">Hello World</h1>
  <p data-oey-object="hero.body">Some body text.</p>
  <img data-oey-object="hero.image" alt="icon" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==">
  <button data-oey-object="hero.cta" class="btn">Click me</button>
</section>
</body></html>
```'''

def main():
    html = strip_code_fences(SAMPLE)
    print("stripped ok, len=", len(html))
    contract = extract_contract({"index.html": html})
    print("contract:", contract.to_dict())
    fps = anchor_fingerprints(html)
    print("fingerprints keys:", list(fps.keys()))
    for k, (count, fp) in fps.items():
        print(f"  {k} (x{count}): {fp[:80]}")
    out_dir = Path(__file__).parent / "materialized_test"
    manifest = materialize_single_file(html, out_dir)
    print("materialize manifest:", manifest)
    print("index.html exists:", (out_dir / "index.html").exists())
    print("styles.css exists:", (out_dir / "styles.css").exists())

if __name__ == "__main__":
    main()
