"""渲染审美对比实验的产物并截图 + 采集客观指标。

对每个 runs/<ARM><IDX>/ 目录：
  1. 本地静态 server 托起（避免 file:// 的 CORS 问题）
  2. 真实 Chrome 加载（channel="chrome"，bundled chromium 未下载）
  3. 采集 console error / 失败请求 / 锚点数 / 是否两栏
  4. 桌面 1440x900 截图 + 全页截图
  5. 用 D3 的计算样式抽取器取 design contract（颜色/字号/间距实际用了多少）

外链请求一律阻断（Tailwind CDN 例外：C 组必须放行才能渲染，见 ALLOW_CDN）。

用法： python spikes/aesthetic-ab/shoot.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPIKES = HERE.parent
sys.path.insert(0, str(SPIKES / "a3-render" / "lib"))
sys.path.insert(0, str(SPIKES / "q1-checks" / "lib"))

from render import serve_dir  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

try:
    from extract_computed import extract_from_computed
except Exception:  # noqa: BLE001
    extract_from_computed = None

RUNS = HERE / "runs"
SHOTS = HERE / "shots"
SHOTS.mkdir(exist_ok=True)

# 第一轮：C 组的 Tailwind CDN 和 A2/B1/B2 的 Google Fonts 都必须放行才能渲染。
# 第二轮（`--offline`）：产物已被 vendor.py 离线化，放行列表清空，任何外链都会被
# 阻断并记入 blocked_external —— 用来证明产物在零网络下仍然渲染一致。
ALLOW_CDN: tuple[str, ...] = (
    "cdn.tailwindcss.com", "fonts.googleapis.com", "fonts.gstatic.com")

TWO_COL_JS = """
() => {
  const vw = window.innerWidth;
  // 找出直接子元素中最宽的两个块，判断是否构成"窄+宽"两栏
  const cands = [...document.querySelectorAll('body *')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.height > window.innerHeight * 0.5 && r.width > vw * 0.12;
  }).map(e => {
    const r = e.getBoundingClientRect();
    return {w: r.width, x: r.left, tag: e.tagName,
            sec: e.getAttribute('data-oey-section') || ''};
  }).sort((a,b) => a.x - b.x);
  return {viewport_w: vw, tall_blocks: cands.slice(0, 6)};
}
"""


def shoot(d: Path) -> dict:
    name = d.name
    rec: dict = {"run": name}
    entry = "index.html"
    if not (d / entry).exists():
        rec["error"] = "no index.html"
        return rec
    out = SHOTS / name
    out.mkdir(parents=True, exist_ok=True)

    console_errors: list[str] = []
    failed: list[str] = []
    blocked_external: list[str] = []

    with serve_dir(d) as base:
        with sync_playwright() as p:
            b = p.chromium.launch(channel="chrome")
            try:
                pg = b.new_page(viewport={"width": 1440, "height": 900})

                def route(r, q):
                    u = q.url
                    if u.startswith(base) or any(h in u for h in ALLOW_CDN):
                        r.continue_()
                    else:
                        blocked_external.append(u)
                        r.abort("blockedbyclient")

                pg.route("**/*", route)
                pg.on("console", lambda m: console_errors.append(m.text)
                      if m.type == "error" and "favicon" not in m.text else None)
                pg.on("requestfailed", lambda q: failed.append(q.url)
                      if "favicon" not in q.url else None)

                pg.goto(f"{base}/{entry}", wait_until="domcontentloaded", timeout=30000)
                try:
                    pg.wait_for_load_state("networkidle", timeout=6000)
                except Exception:  # noqa: BLE001
                    pass
                pg.wait_for_timeout(1200)

                pg.screenshot(path=str(out / "desktop.png"))
                pg.screenshot(path=str(out / "fullpage.png"), full_page=True)

                rec["anchors_section"] = pg.evaluate(
                    "document.querySelectorAll('[data-oey-section]').length")
                rec["anchors_object"] = pg.evaluate(
                    "document.querySelectorAll('[data-oey-object]').length")
                rec["layout"] = pg.evaluate(TWO_COL_JS)
                rec["title"] = pg.title()

                if extract_from_computed is not None:
                    try:
                        c = extract_from_computed(pg)
                        rec["contract"] = {
                            "colors": len(c["tokens"]["color"]),
                            "font_families": c["tokens"]["type"]["font_family"],
                            "font_sizes": c["tokens"]["type"]["font_size"],
                            "space": len(c["tokens"]["space"]),
                        }
                    except Exception as exc:  # noqa: BLE001
                        rec["contract_error"] = f"{type(exc).__name__}: {exc}"[:120]
                pg.close()
            finally:
                b.close()

    rec["console_errors"] = console_errors[:6]
    rec["failed_requests"] = failed[:6]
    rec["blocked_external"] = sorted(set(blocked_external))[:8]
    m = d / "_meta.json"
    if m.exists():
        meta = json.loads(m.read_text(encoding="utf-8"))
        rec["truncated"] = meta.get("truncated")
        rec["files"] = meta.get("files")
        rec["total_elapsed_s"] = meta.get("total_elapsed_s")
        rec["direction"] = meta.get("direction")
        tot = 0
        for s in meta.get("stages", []):
            tot += (s.get("usage") or {}).get("total_tokens") or 0
        rec["total_tokens"] = tot
    print(f"[{name}] anchors={rec.get('anchors_section')}/{rec.get('anchors_object')} "
          f"console_err={len(console_errors)} blocked={len(set(blocked_external))}")
    return rec


def main() -> None:
    global RUNS, SHOTS, ALLOW_CDN
    summary = HERE / "shots_summary.json"
    if "--offline" in sys.argv:
        RUNS = HERE / "offline"
        SHOTS = HERE / "shots_offline"
        SHOTS.mkdir(exist_ok=True)
        ALLOW_CDN = ()
        summary = HERE / "shots_offline_summary.json"
        print("[offline] 放行列表已清空：任何外链请求都会被阻断")
    elif "--round2" in sys.argv:
        # 第二轮的产物自带离线资产，从设计上就不该有外链，所以同样清空放行列表：
        # 任何非本地请求都会被记进 blocked_external，直接暴露出来。
        RUNS = HERE / "runs2"
        SHOTS = HERE / "shots2"
        SHOTS.mkdir(exist_ok=True)
        ALLOW_CDN = ()
        summary = HERE / "shots2_summary.json"
        print("[round2] 零网络渲染：任何外链请求都会被阻断并记录")

    recs = []
    for d in sorted(RUNS.iterdir()):
        if d.is_dir() and not d.name.startswith("_"):
            try:
                recs.append(shoot(d))
            except Exception as exc:  # noqa: BLE001
                print(f"[{d.name}] FAILED {type(exc).__name__}: {exc}")
                recs.append({"run": d.name, "error": f"{type(exc).__name__}: {exc}"[:200]})
    summary.write_text(
        json.dumps(recs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {summary}")


if __name__ == "__main__":
    main()
