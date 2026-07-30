"""第二轮报告：三块视觉领地 × 两条实现基底，供人工挑选。

排版按**领地分组、基底并排**，因为要问用户的问题是两个而不是一个：
  1. 三块领地里你要哪一块（或哪几块）？
  2. 同一块领地下，手写 CSS 和设计系统这两条基底，产出的差别值不值得都保留？

agent 不做审美判断，只给客观指标和截图。

用法： python spikes/aesthetic-ab/report2.py
"""
from __future__ import annotations

import html
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

TERRITORIES = {
    "graphite": ("深色工作台",
                 "中性近黑底、单一暖强调色。对应你在第一轮里说「对照组也挺好看」的那种长相，"
                 "但这次带 token 纪律。"),
    "daylight": ("浅色产品面",
                 "近白中性底、极轻阴影 + 1px 描边。对应你说「框架的 AI 味反而最少」的那种长相。"),
    "paper": ("暖纸编辑台",
              "agent 自选方向时的固有落点，保留一块作对照——第一轮 B 组就在这里，"
              "这次去掉了强制反常动作并加了可读性下限。"),
}

ROUTES = {
    "bespoke": ("手写 CSS", "不用框架，直接按艺术方向写 CSS。"),
    "system": ("设计系统（离线 Tailwind）",
               "本地 <code>assets/tailwind.js</code>，把艺术方向注册成主题，"
               "禁用 Tailwind 默认调色板。"),
}


def esc(x) -> str:
    return html.escape(str(x if x is not None else ""))


def direction_block(d: dict | None) -> str:
    if not d or "_unparsed" in d:
        return "<p class='muted'>（无结构化方向）</p>"
    pal = d.get("palette") or {}
    typ = d.get("type") or {}
    sm = d.get("signature_move") or {}
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
    <tr><td>标题 / 正文</td><td><code>{esc(typ.get('display_family'))}</code> ·
        <code>{esc(typ.get('body_family'))}</code></td></tr>
    <tr><td>中文 / 等宽</td><td><code>{esc(typ.get('cjk_family'))}</code> ·
        <code>{esc(typ.get('mono_family'))}</code></td></tr>
    <tr><td>字号阶 / 间距阶</td><td><code>{esc(typ.get('scale_px'))}</code> ·
        <code>{esc(d.get('space_scale_px'))}</code></td></tr>
    <tr><td>版式原型</td><td>{esc(d.get('layout_archetype'))}</td></tr>
    <tr><td>对比度自检</td><td>{esc(pal.get('contrast_check'))}</td></tr>
  </table>
  <div class="move"><b>signature move：</b>{esc(sm.get('what'))}
    <div class="muted">它让什么更容易被找到：{esc(sm.get('serves'))}</div></div>
  {f'<div class="ap"><b>方向自订的禁止项：</b><ul>{aps}</ul></div>' if aps else ''}
</div>"""


def shots_of(run: str) -> str:
    out = ""
    for f, lab in (("desktop.png", "桌面 1440×900"), ("fullpage.png", "整页")):
        if (HERE / "shots2" / run / f).exists():
            out += (f'<figure><img src="shots2/{run}/{f}" alt="{esc(run)} {lab}">'
                    f'<figcaption>{lab}</figcaption></figure>')
    return out


def route_card(rec: dict | None, route: str, layered: dict) -> str:
    title, desc = ROUTES[route]
    if rec is None:
        return (f'<div class="route"><h4>{title}</h4>'
                f'<p class="bad">没有产出</p></div>')
    run = rec.get("run", "?")
    if rec.get("error"):
        return (f'<div class="route"><h4>{title}</h4>'
                f'<p class="bad">渲染失败：{esc(rec["error"])}</p></div>')
    blocked = rec.get("blocked_external") or []
    lay = layered.get(run) or {}
    ch, art = lay.get("chrome") or {}, lay.get("artifact") or {}
    ch_c = ch.get("colors")
    return f"""
<div class="route">
  <h4>{title} <span class="muted">— {run}</span></h4>
  <p class="muted">{desc}</p>
  <table class="m">
    <tr><td><b>外壳</b>色数 / 字阶</td>
        <td class="{'good' if isinstance(ch_c, int) and ch_c <= 8 else 'warn'}">{esc(ch_c)} / {len(ch.get('sizes') or [])}</td>
        <td>内层产物色数 / 字阶</td><td>{esc(art.get('colors'))} / {len(art.get('sizes') or [])}</td></tr>
    <tr><td>锚点 sec/obj</td><td>{esc(rec.get('anchors_section'))} / {esc(rec.get('anchors_object'))}</td>
        <td>console error</td><td>{len(rec.get('console_errors') or [])}</td></tr>
    <tr><td>被阻断的外链</td><td class="{'good' if not blocked else 'bad'}">{len(blocked)}</td>
        <td>输出截断</td><td>{'是' if rec.get('truncated') else '否'}</td></tr>
    <tr><td>耗时 / token</td><td colspan="3">{esc(rec.get('total_elapsed_s'))}s ·
        {esc(rec.get('total_tokens'))}</td></tr>
  </table>
  <div class="shots">{shots_of(run)}</div>
</div>"""


def main() -> None:
    recs = {r.get("run"): r for r in json.loads(
        (HERE / "shots2_summary.json").read_text(encoding="utf-8"))}
    layered = {r.get("run"): r for r in json.loads(
        (HERE / "layered_metrics.json").read_text(encoding="utf-8"))}

    lay_rows = "".join(
        f"<tr><td>{esc(r.get('round'))}</td><td>{esc(r.get('run'))}</td>"
        f"<td class=\"{'good' if (r.get('chrome') or {}).get('colors', 99) <= 8 else 'warn'}\">"
        f"{esc((r.get('chrome') or {}).get('colors'))}</td>"
        f"<td>{esc((r.get('artifact') or {}).get('colors'))}</td>"
        f"<td>{esc((r.get('page') or {}).get('colors'))}</td></tr>"
        for r in json.loads((HERE / "layered_metrics.json").read_text(encoding="utf-8")))

    blocks = ""
    for terr, (tname, tdesc) in TERRITORIES.items():
        first = recs.get(f"{terr}-bespoke") or recs.get(f"{terr}-system") or {}
        blocks += f"""
<div class="terr">
  <h2><span class="tag">{esc(terr)}</span> {tname}</h2>
  <p class="armdesc">{tdesc}</p>
  {direction_block(first.get('direction'))}
  <div class="grid">
    {route_card(recs.get(f'{terr}-bespoke'), 'bespoke', layered)}
    {route_card(recs.get(f'{terr}-system'), 'system', layered)}
  </div>
</div>"""

    doc = f"""<!doctype html><html lang="zh"><meta charset="utf-8">
<title>OEYdesign 审美实验第二轮 — 挑一个（或几个）</title>
<style>
body{{font:15px/1.65 system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#12100e;color:#f0ece6}}
header{{padding:26px 32px;background:#1c1815;border-bottom:2px solid #d9762b}}
h1{{margin:0 0 6px;font-size:23px}}
.sub{{color:#a49585;font-size:14px}}
.note{{background:#2a1f14;border-left:4px solid #d9762b;padding:14px 18px;margin:18px 32px;border-radius:4px}}
.note b{{color:#f7b267}}
.terr{{margin:30px 32px;padding:20px;background:#171412;border:1px solid #332c25;border-radius:10px}}
h2{{margin:0 0 4px;font-size:19px}}
.tag{{display:inline-block;background:#d9762b;color:#12100e;font-weight:700;padding:2px 10px;border-radius:4px;margin-right:8px}}
.armdesc{{color:#a49585;font-size:14px;margin:0 0 16px}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}}
.route{{padding:16px;background:#1e1a17;border:1px solid #332c25;border-radius:8px;min-width:0}}
h4{{margin:0 0 4px;font-size:15px}}
.m,.kv{{border-collapse:collapse;font-size:13px;margin:10px 0 12px;width:100%}}
.m td,.kv td{{border:1px solid #332c25;padding:5px 11px}}
.m td:nth-child(odd),.kv td:first-child{{color:#a49585;white-space:nowrap}}
.good{{color:#7ee29b;font-weight:700}}
.warn{{color:#f7b267;font-weight:700}}
.bad{{color:#e28787;font-weight:700}}
.shots{{display:flex;gap:12px;overflow-x:auto;padding-bottom:6px}}
figure{{margin:0;flex:0 0 auto}}
img{{width:600px;border:1px solid #332c25;border-radius:5px;display:block;background:#000}}
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
<h1>审美实验第二轮 — 现在是「挑」，不是「三选一」</h1>
<div class="sub">3 块视觉领地 × 2 条实现基底 · 同一份 brief 与同一份艺术方向 · Kimi k3 流式 max_tokens=40000 ·
真实 Chrome、<b>全程零网络</b>渲染</div>
</header>

<div class="note">
<b>这一轮和上一轮的结构不同。</b>上一轮把 A/B/C 摆成三选一，但它们不在同一个轴上：
「有没有艺术方向」是约束创作的问题，「用不用设计系统」是实现基底的问题。这一轮把两者拆开：
<b>艺术方向阶段常开</b>，<b>实现基底可选</b>。<br><br>
<b>每块领地下的两张图吃的是同一份艺术方向</b>，所以左右差异只能归因于实现基底，
不会和方向的差异混在一起。<br><br>
<b>三块领地是被指定的，不是 agent 自选的。</b>原因见 <code>RESULT2.md</code>：
让 agent 自己定方向时，5 次独立生成全部收敛到「暖纸色 + 砖橙 + 校样台」，
强调色连前两位都一样。方向的多样性必须从模型之外供给。
</div>

<div class="terr">
<h2>分层测量：第一轮那个「token 纪律」结论错在哪</h2>
<p class="armdesc">第一轮用<b>整页</b>颜色数判定 B 组胜出（5-7 色 vs A 的 23-31）。但产物里有两层设计，
这个口径把它们算成了一层。分层量之后：B2 的<b>内层产物只有 4 色，比外壳还少，整页数等于外壳数</b>——
意思是那张咖啡落地页整个用的就是工作台的调色板，<b>两层根本没隔离</b>。
第一轮把「没做出独立产物」当成了「token 纪律好」。</p>
<table class="m" style="width:auto">
  <tr><td>轮次</td><td>产物</td><td>外壳色数</td><td>内层色数</td><td>整页色数</td></tr>
  {lay_rows}
</table>
<p class="armdesc">第二轮 6/6 的<b>外壳都是 5-6 色</b>，和第一轮 B 组持平甚至更好；
整页数变高完全来自内层产物有了自己的视觉语言——那是硬性要求，不是纪律退步。<br>
<b>这条同时说明：两条基底的 token 纪律没有差别（都是 5-6 色）。</b>
纪律来自艺术方向阶段，不来自基底。所以两条基底可以都留成选项，不用担心其中一条更容易失控。</p>
<p class="muted">口径说明：分层测量用的阈值与 D3 抽取器不同（这里按「同一 rgb 值出现 ≥2 次」计），
所以绝对数只在本表内部可比。表内第一轮的数据量的是 <code>offline/</code> 副本，
因为 <code>runs/C1</code>、<code>runs/C2</code> 仍指向 Tailwind CDN，在零网络下会量到一个没上样式的页面。
画布识别是几何规则（视口内、右侧、面积 ≥18%、背景色异于 body 的最大元素），
每行都打印了选中元素的尺寸可人工核对。</p>
</div>

{blocks}

<div class="q">
<h3>需要你判断的</h3>
<ol>
<li><b>三块领地里，哪些值得保留成可选项？</b>可以多选，也可以说「这块换个方向重做」。</li>
<li><b>同一块领地下，左右两条基底的差别，够不够大到两条都留？</b>
    如果差别很小，那就只留一条，产品里少一个选项。</li>
<li><b>可读性下限起作用了吗？</b>第一轮 B 组「看起来很累」的病因我判断是等宽正文 + 全大写标签 +
    发丝线网格。这一轮把这些写成了硬性下限。</li>
<li><b>内容饱满度补上了吗？</b>第一轮 B1 左栏基本空着。这一轮要求至少 6 轮真实对话。</li>
</ol>
</div>
</html>"""
    out = HERE / "report2.html"
    out.write_text(doc, encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
