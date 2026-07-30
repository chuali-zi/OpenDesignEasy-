"""Assembles the static, double-click-openable human review page from all the
artifacts produced by generate_candidates.py / selfrepair.py /
aesthetic_findings.py / stability.py.

This script does not call any model and does not make any aesthetic judgment.
It only reads JSON/PNG artifacts already on disk and renders them into HTML
with relative paths, per the task's requirement that review.html work by
double-clicking (no server, no absolute paths).

Usage: python spikes/d2-aesthetic/build_review.py
"""
from __future__ import annotations

import html
import json
import os

ROOT = os.path.join("spikes", "d2-aesthetic")
CAND_ROOT = os.path.join(ROOT, "candidates")
Q2_ROOT = os.path.join(ROOT, "q2")
Q3_ROOT = os.path.join(ROOT, "q3")

AXIS_LABELS = {
    1: "叙事框架 / narrative metaphor",
    2: "版式结构 / layout & information architecture",
    3: "色彩温度与基调 / color temperature & mood",
    4: "信息密度与节奏 / information density & rhythm",
}


def esc(s) -> str:
    return html.escape(str(s) if s is not None else "")


def read_json(path):
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def read_text(path):
    if not os.path.isfile(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def rel_from_review(p: str) -> str:
    """review.html lives at spikes/d2-aesthetic/review.html; artifact paths in
    the JSON are already relative to the repo root starting with
    spikes/d2-aesthetic/..., so strip that prefix for relative <img src>.
    """
    p = p.replace("\\", "/")
    prefix = "spikes/d2-aesthetic/"
    if p.startswith(prefix):
        return p[len(prefix):]
    return p


def candidate_block(cand_id: int) -> str:
    axis = AXIS_LABELS.get(cand_id, "?")
    cand_dir = os.path.join(CAND_ROOT, f"cand{cand_id}")
    rounds = read_json(os.path.join(cand_dir, "rounds.json"))
    intent = read_text(os.path.join(cand_dir, "final", "INTENT.md")) or read_text(os.path.join(cand_dir, "v1", "INTENT.md"))
    mock = read_text(os.path.join(cand_dir, "final", "MOCK.md")) or read_text(os.path.join(cand_dir, "v1", "MOCK.md"))
    q2 = read_json(os.path.join(Q2_ROOT, f"cand{cand_id}.json"))
    q3 = read_json(os.path.join(Q3_ROOT, f"cand{cand_id}.json"))

    if rounds is None:
        return f"""<section class="cand" id="cand{cand_id}">
  <h2>候选 {cand_id} <span class="axis">差异轴：{esc(axis)}</span></h2>
  <p class="missing">未生成成功（未找到 candidates/cand{cand_id}/rounds.json）。</p>
</section>"""

    final_shot = rel_from_review(rounds["final_screenshot"])

    round_imgs = []
    for r in rounds["rounds"]:
        shot = rel_from_review(r["screenshot"])
        review = r.get("model_review")
        issue_html = ""
        if review and not isinstance(review, dict) is False and review is not None:
            if "error" in review:
                issue_html = f'<p class="err">model review failed: {esc(review["error"])}</p>'
            else:
                issues = review.get("issues", [])
                issue_html = f'<p><b>模型提出 {len(issues)} 条问题</b>, 改了 {review.get("files_changed_count", 0)} 个文件</p>'
                if issues:
                    issue_html += "<ul>" + "".join(f"<li>{esc(i)}</li>" for i in issues) + "</ul>"
        round_imgs.append(f"""
        <figure class="round">
          <img src="{esc(shot)}" alt="候选{cand_id} round {r['round']}" loading="lazy">
          <figcaption>
            round {r['round']} &middot;
            console error {r['console_error_count']} &middot;
            warning {r['console_warning_count']} &middot;
            failed req {r['failed_request_count']} &middot;
            page error {r['page_error_count']} &middot;
            overflow {esc(r['overflow_count'])} &middot;
            load_ok {r['load_ok']}
            {issue_html}
          </figcaption>
        </figure>""")

    q2_html = "<p class='missing'>Q2 未生成</p>"
    if q2 and "error" not in q2:
        rows = []
        for f in q2.get("findings", []):
            if not isinstance(f, dict):
                continue
            valid = f.get("target_ref_valid")
            mark = "valid-ref" if valid else "invalid-ref"
            rows.append(f"""<tr class="{mark}">
              <td>{esc(f.get('dimension'))}</td>
              <td>{esc(f.get('target_ref'))} {'&#10003;' if valid else '&#10007;'}</td>
              <td>{esc(f.get('issue'))}</td>
              <td>{esc(f.get('suggestion'))}</td>
            </tr>""")
        rate = q2.get("valid_target_ref_rate")
        rate_str = f"{rate*100:.0f}%" if isinstance(rate, (int, float)) else "n/a"
        q2_html = f"""<p>发现数：{q2.get('finding_count')} &middot; 锚点有效率（客观测）：{rate_str}
        &middot; 维度覆盖：{esc(', '.join(q2.get('dimensions_covered', [])))}</p>
        <table class="findings"><thead><tr><th>维度</th><th>target_ref</th><th>问题</th><th>建议</th></tr></thead>
        <tbody>{''.join(rows) if rows else '<tr><td colspan="4">（无发现）</td></tr>'}</tbody></table>"""

    q3_html = "<p class='missing'>Q3 未生成</p>"
    if q3 and "error" not in q3:
        cols = []
        for run in q3.get("runs", []):
            items = "".join(
                f"<li>[{esc(f.get('dimension'))}] {esc(f.get('target_ref'))}: {esc(f.get('issue'))[:60]}</li>"
                for f in run.get("findings", []) if isinstance(f, dict)
            )
            cols.append(f"""<div class="q3run">
              <h4>run {run['run']}</h4>
              <p>{run['finding_count']} 条 &middot; 维度 {esc(', '.join(run['dimensions']))}</p>
              <ul>{items or '<li>(无)</li>'}</ul>
            </div>""")
        dj = q3.get("dimension_mean_pairwise_jaccard")
        rj = q3.get("target_ref_mean_pairwise_jaccard")
        dj_str = f"{dj:.2f}" if isinstance(dj, (int, float)) else "n/a"
        rj_str = f"{rj:.2f}" if isinstance(rj, (int, float)) else "n/a"
        q3_html = f"""<p>维度覆盖跨次平均 Jaccard 重合度（客观测）：{dj_str} &middot;
        target_ref 跨次平均 Jaccard 重合度（客观测）：{rj_str} &middot;
        维度交集：{esc(', '.join(q3.get('dimension_intersection', [])))}</p>
        <div class="q3grid">{''.join(cols)}</div>"""

    return f"""<section class="cand" id="cand{cand_id}">
  <h2>候选 {cand_id} <span class="axis">差异轴：{esc(axis)}</span></h2>
  <div class="hero">
    <img src="{esc(final_shot)}" alt="候选{cand_id} 最终截图" class="final-shot" loading="lazy">
    <div class="meta">
      <details open><summary>模型自述设计意图（INTENT.md 原文）</summary><pre>{esc(intent) or '(未产出 INTENT.md)'}</pre></details>
      <details><summary>Mock 声明（MOCK.md 原文）</summary><pre>{esc(mock) or '(未产出 MOCK.md)'}</pre></details>
    </div>
  </div>
  <h3>E2 自验证自修复：各轮截图</h3>
  <div class="rounds">{''.join(round_imgs)}</div>
  <h3>Q2 审美发现（待人工审核：说得对不对）</h3>
  {q2_html}
  <h3>Q3 rubric 跨次稳定性（同一张截图重复评估 5 次，待人工审核：哪次更准）</h3>
  {q3_html}
</section>"""


CSS = """
body { font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif; margin: 0; padding: 0 0 60px; background: #f4f4f2; color: #1b1b1b; }
header.top { background: #111; color: #fff; padding: 20px 28px; position: sticky; top: 0; z-index: 10; }
header.top h1 { margin: 0 0 6px; font-size: 20px; }
header.top p { margin: 4px 0; font-size: 13px; line-height: 1.6; color: #f0d060; }
header.top .note { color: #ccc; }
nav.jump { padding: 10px 28px; background: #222; color: #ccc; font-size: 13px; }
nav.jump a { color: #9cf; margin-right: 14px; }
main { max-width: 1400px; margin: 0 auto; padding: 20px 28px; }
section.cand { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 28px; }
section.cand h2 { margin-top: 0; }
.axis { font-weight: normal; font-size: 14px; color: #555; margin-left: 10px; }
.hero { display: flex; gap: 20px; flex-wrap: wrap; }
.hero .final-shot { max-width: 560px; width: 100%; border: 1px solid #ccc; border-radius: 4px; }
.hero .meta { flex: 1; min-width: 300px; }
.hero pre { white-space: pre-wrap; font-size: 12px; background: #f7f7f5; border: 1px solid #eee; padding: 10px; max-height: 260px; overflow: auto; }
.rounds { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px; }
.rounds figure.round { margin: 0; flex: 0 0 320px; }
.rounds figure.round img { width: 100%; border: 1px solid #ccc; border-radius: 4px; }
.rounds figcaption { font-size: 11px; color: #444; margin-top: 6px; line-height: 1.5; }
.rounds figcaption ul { margin: 4px 0 0; padding-left: 16px; }
table.findings { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
table.findings th, table.findings td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
table.findings th { background: #f0f0ee; }
tr.invalid-ref td:nth-child(2) { color: #b00; font-weight: bold; }
tr.valid-ref td:nth-child(2) { color: #076; }
.q3grid { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 8px; }
.q3run { flex: 0 0 250px; background: #f7f7f5; border: 1px solid #eee; border-radius: 4px; padding: 10px; font-size: 12px; }
.q3run h4 { margin: 0 0 4px; }
.q3run ul { margin: 4px 0 0; padding-left: 16px; }
.missing { color: #a00; }
footer { max-width: 1400px; margin: 0 auto; padding: 10px 28px 40px; color: #777; font-size: 12px; }
"""


def build() -> str:
    blocks = "\n".join(candidate_block(i) for i in (1, 2, 3, 4))
    gen_summary = read_json(os.path.join(CAND_ROOT, "_gen_summary.json")) or []
    repair_summary = read_json(os.path.join(CAND_ROOT, "_repair_summary.json")) or []
    q2_summary = read_json(os.path.join(Q2_ROOT, "_summary.json")) or {}
    q3_summary = read_json(os.path.join(Q3_ROOT, "_summary.json")) or {}

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>D2/E2/Q2/Q3 人工审核页 -- OEYdesign agent 工作台候选</title>
<style>{CSS}</style>
</head>
<body>
<header class="top">
  <h1>D2 / E2 / Q2 / Q3 spike 物料 -- 待人工审核</h1>
  <p>以下内容待人工审核，agent 未做审美判断。本页只呈现物料与客观测得的指标（console error / 溢出
  数量 / target_ref 有效率 / 跨次重合度），不包含任何「哪个更好看」「修复是否变好」「审美发现对不对」
  「rubric 结论质量」的结论 -- 这些判断留给你。</p>
  <p class="note">方法与全部客观指标见同目录 RESULT.md。截图用相对路径引用，双击本文件在浏览器打开即可，
  不需要起服务器。</p>
</header>
<nav class="jump">跳转：
  <a href="#cand1">候选1 · 叙事</a>
  <a href="#cand2">候选2 · 版式</a>
  <a href="#cand3">候选3 · 色彩温度</a>
  <a href="#cand4">候选4 · 信息密度</a>
  <a href="RESULT.md">RESULT.md（客观指标全文）</a>
</nav>
<main>
{blocks}
</main>
<footer>
  生成汇总: {len(gen_summary)} 个候选生成记录 &middot; 自修复汇总: {len(repair_summary)} 条 &middot;
  Q2 总发现数: {esc(q2_summary.get('total_findings'))}，整体锚点有效率: {esc(q2_summary.get('overall_valid_target_ref_rate'))} &middot;
  Q3 重复次数: {esc(q3_summary.get('repeats'))}
</footer>
</body>
</html>"""


if __name__ == "__main__":
    out_path = os.path.join(ROOT, "review.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(build())
    print(f"wrote {out_path}")
