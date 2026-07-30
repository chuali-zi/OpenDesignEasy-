"""Shared aesthetic-assessment call used by both Q2 (aesthetic_findings.py) and
Q3 (stability.py). Rubric dimensions taken verbatim from
docs/spec/quality-governance-spec.md SS4.1 (five dimensions, no composite score,
every finding must carry a target_ref, no severity/verdict beyond text).

This module only builds the prompt and parses the response. It does not judge
whether findings are correct -- that verification (target_ref validity against
real anchors) happens in the caller using lib/checks.py, which is deterministic.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join("spikes", "_lib"))
from kimi import chat  # noqa: E402

RUBRIC_DIMENSIONS = ["视觉层级", "留白节奏", "对比", "排版一致性", "意图契合"]

JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def png_data_uri(path: str) -> str:
    with open(path, "rb") as f:
        b = f.read()
    return "data:image/png;base64," + base64.b64encode(b).decode("ascii")


def build_assess_prompt(cand_id: int, axis_label: str, intent_text: str, all_refs: list[str]) -> str:
    refs_preview = ", ".join(all_refs[:40]) if all_refs else "(未能提取到 data-oey-* 锚点)"
    return f"""你在评审 OEYdesign agent 工作台的一个候选前端方向（候选 {cand_id}，差异轴：
{axis_label}）。它的设计意图自述是：

{intent_text[:1200]}

下面是这个候选的真实渲染截图。请依据以下五个维度给出审美发现（这是 quality-governance-spec.md
§4.1 的 rubric，原样使用，不要增删维度）：

1. 视觉层级：焦点是否明确，重要信息是否先被看到
2. 留白节奏：疏密是否有意图，还是均匀铺满
3. 对比：大小、粗细、颜色的对比是否形成结构
4. 排版一致性：字号阶与间距阶是否被贯彻，还是随机
5. 意图契合：与该候选自述的设计意图是否一致

规则：
- 每条发现必须指向一个具体锚点（target_ref），不接受「整体感觉一般」这类无法定位的评语。
  这个候选页面里实际存在的锚点包括（只能从这些里面选，不能编造不存在的锚点）：
  {refs_preview}
- 每条发现必须说明问题是什么、建议方向是什么，但不要替用户做最终决定（不要说"必须改成xxx"，
  说"可以考虑xxx"这种建议语气）。
- 不是每个维度都必须有发现；如果某个维度你看不出具体、可指向锚点的问题，可以跳过，不要为了凑
  数量编造。
- 不要输出综合评分或总体好坏结论。只输出逐条发现。

严格按下面的 JSON 格式输出，不要输出任何其它文字、不要用 markdown 代码围栏：

{{"findings": [{{"dimension": "视觉层级", "target_ref": "锚点名", "issue": "问题描述", "suggestion": "建议方向"}}]}}

如果某个维度没有发现就不要在数组里放该维度的条目。findings 数组可以为空。"""


def call_assess(cand_id: int, axis_label: str, intent_text: str, all_refs: list[str],
                  screenshot_path: str, max_tokens: int = 4096) -> dict:
    prompt = build_assess_prompt(cand_id, axis_label, intent_text, all_refs)
    messages = [
        {
            "role": "system",
            "content": "You output only the requested JSON object. No prose, no markdown fences.",
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": png_data_uri(screenshot_path)}},
            ],
        },
    ]
    delay = 5
    for attempt in range(1, 6):
        try:
            msg, usage, elapsed = chat(messages, max_tokens=max_tokens, temperature=1, timeout=1200)
            break
        except (RuntimeError, TimeoutError) as exc:
            error = str(exc)
            retryable = isinstance(exc, TimeoutError) or error.startswith("HTTP 429") or error.startswith("HTTP 5")
            if not retryable or attempt == 5:
                raise
            print(f"    retryable error ({error[:150]}), backing off {delay}s", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 60)
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning_content") or ""

    findings = []
    parse_error = None
    try:
        parsed = json.loads(content)
        findings = parsed.get("findings", [])
    except json.JSONDecodeError:
        m = JSON_BLOCK_RE.search(content)
        if m:
            try:
                parsed = json.loads(m.group(0))
                findings = parsed.get("findings", [])
            except json.JSONDecodeError as exc:
                parse_error = str(exc)
        else:
            parse_error = "no JSON object found in response"

    return {
        "findings": findings if isinstance(findings, list) else [],
        "parse_error": parse_error,
        "usage": usage,
        "elapsed_s": round(elapsed, 1),
        "raw_content": content,
        "reasoning": reasoning,
    }
