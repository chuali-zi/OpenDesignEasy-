"""生成审美对比实验的 HTML 报告，供人工审核。

只呈现客观指标与截图，**不做审美判断**——那是用户的事。

用法： python spikes/aesthetic-ab/report.py
"""
from __future__ import annotations

import html
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARMS = {
    "A": ("baseline 自由生成", "对照组。当前做法：把 brief 直接交给 agent，不加任何审美约束。"),
    "B": ("处方性艺术方向", "两阶段。先让 agent 输出确切色值/字体配对/间距阶/版式原型/"
                      "<b>一处刻意的反常动作</b>，再严格按它实现。反均值化装置是"
                      "「强制显式承诺 + 必须越界一次」。"),
    "C": ("Tailwind 组件框架", "引入 Tailwind CDN，用成熟组件模式（shadcn/Tailwind UI 风格）实现。"),
}


def esc(x) -> str:
    return html.escape(str(x if x is not None else ""))


def direction_block(d: dict | None) -> str:
    if not d or "_unparsed" in d:
        return "<p class='muted'>（无结构化方向）</p>"
    pal = d.get("palette") or {}
    typ = d.get("type") or {}
    dm = d.get("distinctive_move") or {}
    swatches = "".join(
        f'<span class="sw" style="background:{esc(v)}" title="{esc(k)}: {esc(v)}"></span>'
        for k, v in pal.items() if isinstance(v, str) and v.startswith("#"))
    aps = "".join(f"<li>{esc(a)}</li>" for a in (d.get("anti_patterns") or []))
    return f"""
<div class="dir">
  <div class="dirname">{esc(d.get('direction_name'))}</div>
  <p class="muted">{esc(d.get('rationale'))}</p>
  <div class="swrow">{swatches}</div>
  <table class="kv">
    <tr><td>标题字体</td><td><code>{esc(typ.get('display_family'))}</code></td></tr>
    <tr><td>正文字体</td><td><code>{esc(typ.get('body_family'))}</code></td></tr>
    <tr><td>字号阶</td><td><code>{esc(typ.get('scale_px'))}</code></td></tr>
    <tr><td>间距阶</td><td><code>{esc(d.get('space_scale_px'))}</code></td></tr>
    <tr><td>版式原型</td><td>{esc(d.get('layout_archetype'))}</td></tr>
    <tr><td>不常见的颜色关系</td><td>{esc(pal.get('unusual_relationship'))}</td></tr>
  </table>
  <div class="move"><b>刻意的反常动作：</b>{esc(dm.get('what'))}
    <div class="muted">为什么成立：{esc(dm.get('why'))}</div></div>
  {f'<div class="ap"><b>明确禁止：</b><ul>{aps}</ul></div>' if aps else ''}
</div>"""


def card(rec: dict) -> str:
    run = rec.get("run", "?")
    if rec.get("error"):
        return f'<section class="cand"><h3>{esc(run)}</h3>' \
               f'<p class="bad">渲染失败：{esc(rec["error"])}</p></section>'
    lay = rec.get("layout") or {}
    blocks = lay.get("tall_blocks") or []
    colw = " / ".join(f"{b.get('w', 0):.0f}px" for b in blocks[:3]) or "n/a"
    con = rec.get("contract") or {}
    trunc = rec.get("truncated")
    shots = ""
    for f, lab in (("desktop.png", "桌面 1440×900"), ("fullpage.png", "整页")):
        p = HERE / "shots" / run / f
        if p.exists():
            shots += (f'<figure><img src="shots/{run}/{f}" alt="{run} {lab}">'
                      f'<figcaption>{lab}</figcaption></figure>')
    return f"""
<section class="cand">
  <h3>{esc(run)} {'<span class="b bad">输出被截断</span>' if trunc else ''}</h3>
  <table class="m">
    <tr><td>锚点 section/object</td><td>{esc(rec.get('anchors_section'))} / {esc(rec.get('anchors_object'))}</td>
        <td>console error</td><td>{len(rec.get('console_errors') or [])}</td></tr>
    <tr><td>实际用到的颜色数</td><td>{esc(con.get('colors'))}</td>
        <td>字号阶数</td><td>{esc(len(con.get('font_sizes') or []))}</td></tr>
    <tr><td>字体族</td><td colspan="3"><code>{esc(', '.join((con.get('font_families') or [])[:4]))}</code></td></tr>
    <tr><td>最宽三块宽度</td><td>{esc(colw)}</td>
        <td>被阻断的外链</td><td>{len(rec.get('blocked_external') or [])}</td></tr>
    <tr><td>生成耗时</td><td>{esc(rec.get('total_elapsed_s'))}s</td>
        <td>总 token</td><td>{esc(rec.get('total_tokens'))}</td></tr>
    <tr><td>文件</td><td colspan="3"><code>{esc(', '.join(rec.get('files') or []))}</code></td></tr>
  </table>
  {direction_block(rec.get('direction')) if rec.get('direction') else ''}
  <div class="shots">{shots}</div>
</section>"""


def main() -> None:
    recs = json.loads((HERE / "shots_summary.json").read_text(encoding="utf-8"))
    by_arm: dict[str, list[dict]] = {"A": [], "B": [], "C": []}
    for r in recs:
        a = (r.get("run") or "?")[0]
        by_arm.setdefault(a, []).append(r)

    sections = ""
    for arm in ("A", "B", "C"):
        title, desc = ARMS[arm]
        cards = "".join(card(r) for r in by_arm.get(arm, []))
        sections += f"""
<div class="arm">
  <h2><span class="tag">{arm}</span> {title}</h2>
  <p class="armdesc">{desc}</p>
  {cards or '<p class="muted">（无产出）</p>'}
</div>"""

    doc = f"""<!doctype html><html lang="zh"><meta charset="utf-8">
<title>OEYdesign 审美对比实验 — 人工审核</title>
<style>
body{{font:15px/1.65 system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#12100e;color:#f0ece6}}
header{{padding:26px 32px;background:#1c1815;border-bottom:2px solid #d9762b}}
h1{{margin:0 0 6px;font-size:23px}}
.sub{{color:#a49585;font-size:14px}}
.note{{background:#2a1f14;border-left:4px solid #d9762b;padding:14px 18px;margin:18px 32px;border-radius:4px}}
.note b{{color:#f7b267}}
.arm{{margin:30px 32px;padding:20px;background:#171412;border:1px solid #332c25;border-radius:10px}}
h2{{margin:0 0 4px;font-size:19px}}
.tag{{display:inline-block;background:#d9762b;color:#12100e;font-weight:700;padding:2px 10px;border-radius:4px;margin-right:8px}}
.armdesc{{color:#a49585;font-size:14px;margin:0 0 16px}}
.cand{{margin:16px 0;padding:16px;background:#1e1a17;border:1px solid #332c25;border-radius:8px}}
h3{{margin:0 0 10px;font-size:16px}}
.b{{font-size:11px;padding:2px 8px;border-radius:10px;margin-left:6px}}
.bad{{background:#4b2020;color:#e28787}}
.m,.kv{{border-collapse:collapse;font-size:13px;margin-bottom:12px}}
.m td,.kv td{{border:1px solid #332c25;padding:5px 11px}}
.m td:nth-child(odd),.kv td:first-child{{color:#a49585;white-space:nowrap}}
.shots{{display:flex;gap:14px;overflow-x:auto;padding-bottom:6px}}
figure{{margin:0;flex:0 0 auto}}
img{{width:520px;border:1px solid #332c25;border-radius:5px;display:block;background:#000}}
figcaption{{font-size:11px;color:#a49585;margin-top:5px}}
.dir{{background:#141b18;border-left:3px solid #4a8f6b;padding:12px 14px;border-radius:4px;margin:12px 0}}
.dirname{{font-weight:700;color:#7ee29b;margin-bottom:4px}}
.swrow{{display:flex;gap:6px;margin:10px 0}}
.sw{{width:34px;height:34px;border-radius:4px;border:1px solid #332c25}}
.move{{background:#1c1712;padding:10px 12px;border-radius:4px;margin-top:10px}}
.ap ul{{margin:4px 0 0 18px;padding:0}}
.muted{{color:#a49585;font-size:13px}}
code{{font-size:12px;color:#d9c9b5}}
.q{{margin:20px 32px 44px;padding:16px 20px;background:#161e1a;border-left:4px solid #4a8f6b;border-radius:4px}}
.q h3{{margin:0 0 8px;font-size:15px;color:#7ee29b}}
</style>
<header>
<h1>OEYdesign 审美对比实验 — 人工审核</h1>
<div class="sub">同一份 brief（两栏：左窄聊天 / 右大预览）· 三组 × 2 次 · Kimi k3 · 流式生成 max_tokens=40000 · 真实 Chrome 渲染</div>
</header>

<div class="note">
<b>agent 未做任何审美判断。</b>表格里全是客观指标（锚点数、console error、实际用了几个颜色/字号、
栏宽、被阻断的外链、成本）。<b>「哪组好看」由你判断。</b><br><br>
要检验的问题：<b>「AI 味」的根因是求平均</b>——那么破解它靠的是「换成人做的组件」（C 组）
还是「强制模型先承诺一个具体观点」（B 组）？A 组是对照。
</div>

{sections}

<div class="q">
<h3>需要你判断的</h3>
<ol>
<li><b>三组里哪一组明显更不像 AI 做的？</b> 还是都还不行？</li>
<li><b>B 组的「刻意反常动作」有没有真的落地？</b> 卡片里写了它承诺做什么，看截图对不对得上。</li>
<li><b>C 组值不值那个代价？</b> Tailwind 要走 CDN，意味着渲染沙箱必须放行网络——
    而我们刚用 AppContainer 把网络彻底关掉。如果 C 组没有压倒性优势，这个代价不划算。</li>
<li>如果都不满意，下一步该加什么：更强的方向策展库、参考图输入、还是自修复循环里加审美判据？</li>
</ol>
</div>
</html>"""
    out = HERE / "report.html"
    out.write_text(doc, encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
