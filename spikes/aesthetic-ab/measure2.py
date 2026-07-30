"""分层测量 token 纪律：工作台外壳 vs 预览区里的产物。

为什么需要这个：第一轮用「整页实际颜色数」判定 token 纪律性，B 组 5-7 色胜出。
但这个口径把**两层设计**算成了一层——预览区里那个「正在被设计的产物」是别人的产品，
按第二轮的硬性要求它**必须**有自己的视觉语言。于是：

  · 整页色数低，可能意味着两层没隔离（第一轮 B2 就是把咖啡落地页也做成了等宽校对表）；
  · 整页色数高，可能只是内层产物有自己的品牌色，外壳其实很守纪律。

所以「整页色数」既不是越低越好、也不是越高越好，它根本不是一个可用的判据。
必须分层量：**外壳守不守它自己的方向**，和**内层是不是真的独立**，是两个问题。

分层规则（几何 + 视觉，无需产物配合）：
预览画布 = 位于视口右侧 22% 之后、面积占视口 ≥ 18%、且背景色与 body 背景色不同的
最大元素。这条规则对应人眼看到的那张「压在台面上的样张」。规则判错时本脚本会打印
选中元素的尺寸，可人工核对。

用法： python spikes/aesthetic-ab/measure2.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "a3-render" / "lib"))

from render import serve_dir  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

SPLIT_JS = r"""
() => {
  const vw = innerWidth, vh = innerHeight;
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  let canvas = null, best = 0;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (r.left < vw * 0.22) continue;
    // 视口外的元素不可能是用户看到的那张样张。graphite-bespoke 有一个
    // x=1440（正好在视口右缘外）的收起态检查器面板，不加这条会被选成画布。
    if (r.left > vw * 0.75) continue;
    if (area < vw * vh * 0.18) continue;
    if (getComputedStyle(el).backgroundColor === bodyBg) continue;
    if (area > best) { best = area; canvas = el; }
  }

  const borderSides = [
    ['borderTopColor','borderTopWidth','borderTopStyle'],
    ['borderRightColor','borderRightWidth','borderRightStyle'],
    ['borderBottomColor','borderBottomWidth','borderBottomStyle'],
    ['borderLeftColor','borderLeftWidth','borderLeftStyle'],
  ];
  const scan = (els) => {
    const colors = {}, sizes = {}, fams = {};
    for (const el of els) {
      const cs = getComputedStyle(el);
      const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
      if (cs.color && cs.color !== 'rgba(0, 0, 0, 0)') bump(colors, cs.color);
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)')
        bump(colors, cs.backgroundColor);
      for (const [c, w, s] of borderSides) {
        if (cs[s] === 'none' || parseFloat(cs[w]) === 0) continue;
        if (cs[c] && cs[c] !== 'rgba(0, 0, 0, 0)') bump(colors, cs[c]);
      }
      bump(sizes, Math.round(parseFloat(cs.fontSize)));
      bump(fams, cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
    }
    // 与 D3 抽取器一致：出现次数过少的值视为噪声，不计入 token 阶
    const keep = (o, min) => Object.entries(o)
        .filter(([, n]) => n >= min).map(([k]) => k);
    return {
      colors: keep(colors, 2).length,
      sizes: keep(sizes, 2).map(Number).sort((a, b) => a - b),
      families: keep(fams, 2),
      elements: els.length,
    };
  };

  const all = Array.from(document.querySelectorAll('body, body *'));
  const inCanvas = canvas ? Array.from(canvas.querySelectorAll('*')).concat([canvas]) : [];
  const inSet = new Set(inCanvas);
  const chrome = all.filter(e => !inSet.has(e));
  const cr = canvas ? canvas.getBoundingClientRect() : null;
  return {
    canvas_found: !!canvas,
    canvas_rect: cr ? {x: Math.round(cr.left), y: Math.round(cr.top),
                       w: Math.round(cr.width), h: Math.round(cr.height)} : null,
    canvas_tag: canvas ? (canvas.tagName + (canvas.getAttribute('data-oey-section')
                          ? '[' + canvas.getAttribute('data-oey-section') + ']' : '')) : null,
    chrome: scan(chrome),
    artifact: scan(inCanvas),
    page: scan(all),
  };
}
"""


def measure(d: Path) -> dict:
    with serve_dir(d) as base:
        with sync_playwright() as p:
            b = p.chromium.launch(channel="chrome")
            try:
                pg = b.new_page(viewport={"width": 1440, "height": 900})
                pg.route("**/*", lambda r, q: r.continue_()
                         if q.url.startswith(base) else r.abort("blockedbyclient"))
                pg.goto(f"{base}/index.html", wait_until="domcontentloaded",
                        timeout=30000)
                try:
                    pg.wait_for_load_state("networkidle", timeout=6000)
                except Exception:  # noqa: BLE001
                    pass
                pg.wait_for_timeout(1500)
                rec = pg.evaluate(SPLIT_JS)
                pg.close()
            finally:
                b.close()
    rec["run"] = d.name
    return rec


def main() -> None:
    # 第一轮量 `offline/` 而不是 `runs/`：`runs/C1`、`runs/C2` 仍然指向 Tailwind CDN，
    # 而这里的渲染器阻断一切外链，量到的会是一个没上样式的页面（实测 C1 只有 8 色，
    # 而联网渲染是 17 色）。`offline/` 是同一份代码换成本地 vendor 资产的副本。
    roots = [(HERE / "offline", "第一轮"), (HERE / "runs2", "第二轮")]
    out: list[dict] = []
    for root, label in roots:
        if not root.exists():
            continue
        for d in sorted(root.iterdir()):
            if not d.is_dir() or d.name.startswith("_"):
                continue
            if not (d / "index.html").exists():
                continue
            try:
                rec = measure(d)
            except Exception as exc:  # noqa: BLE001
                rec = {"run": d.name, "error": f"{type(exc).__name__}: {exc}"[:200]}
            rec["round"] = label
            out.append(rec)
            c, a, pg = (rec.get("chrome") or {}), (rec.get("artifact") or {}), (rec.get("page") or {})
            print(f"[{rec['round']}] {rec['run']:20} "
                  f"外壳 {c.get('colors', '-'):>3}色/{len(c.get('sizes') or []):>2}阶  "
                  f"内层 {a.get('colors', '-'):>3}色/{len(a.get('sizes') or []):>2}阶  "
                  f"整页 {pg.get('colors', '-'):>3}色  "
                  f"画布={rec.get('canvas_tag')} {rec.get('canvas_rect')}", flush=True)
    (HERE / "layered_metrics.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {HERE / 'layered_metrics.json'}")


if __name__ == "__main__":
    main()
