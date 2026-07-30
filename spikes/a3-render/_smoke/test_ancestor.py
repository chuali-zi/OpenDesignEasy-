import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from htmlutil import anchor_fingerprints, anchor_own_tag_signature, ancestor_anchor_keys

OLD = '''<section data-oey-section="hero">
  <h1 data-oey-object="hero.title">Hello World</h1>
  <p data-oey-object="hero.body">Some body text.</p>
</section>'''

NEW_GOOD = '''<section data-oey-section="hero">
  <h1 data-oey-object="hero.title">Brand New Title</h1>
  <p data-oey-object="hero.body">Some body text.</p>
</section>'''

NEW_BAD = '''<section data-oey-section="hero">
  <h1 data-oey-object="hero.title">Brand New Title</h1>
  <p data-oey-object="hero.body">SNEAKILY CHANGED</p>
</section>'''

scope_key = "object:hero.title"
ancestors = ancestor_anchor_keys(OLD, scope_key)
print("ancestors:", ancestors)

for label, new in [("good edit", NEW_GOOD), ("bad edit (sibling touched)", NEW_BAD)]:
    fp_old = anchor_fingerprints(OLD)
    fp_new = anchor_fingerprints(new)
    sig_old = anchor_own_tag_signature(OLD)
    sig_new = anchor_own_tag_signature(new)
    changed = []
    for k in set(fp_old) & set(fp_new):
        if k == scope_key:
            continue
        if k in ancestors:
            if sig_old[k][1] != sig_new[k][1]:
                changed.append(f"{k} (own tag/attrs changed)")
            continue
        if fp_old[k][1] != fp_new[k][1]:
            changed.append(k)
    print(label, "-> changed_out_of_scope:", changed)
