"""Step 2 of the E3/D7/Q8 spike: ask k3 to write a ~300-500 char "what is this
project" introduction grounded ONLY in the extracted fact package, citing an
input fact id for every factual claim.

Runs N independent generations (default 10, temperature=1 -- the only value
k3 accepts per spikes/README.md) and writes each raw response + usage under
outputs/gen_XX.json / gen_XX.md.

Never executes any command the model might mention in its output text --
this script only sends a chat request and stores the text response.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from kimi import chat  # noqa: E402

SPIKE_DIR = Path(__file__).resolve().parent
OUT_DIR = SPIKE_DIR / "outputs"

SYSTEM_PROMPT = (
    "你是一个只依据给定事实写作的助手。你会收到一份关于某个代码仓库的事实清单，"
    "每条事实有一个形如 [F0001] 的编号。你的任务是为这个项目撰写一段面向最终用户的"
    "「这个项目是什么」介绍文案（大约 300-500 个汉字），风格类似产品前端页面上的项目"
    "简介。\n\n"
    "硬性要求：\n"
    "1. 文案中每一句包含具体事实性陈述（数字、模块名、类名、依赖、测试数量、目录结构等）"
    "的话，句末必须用 [Fxxxx] 标注它依据的是清单中的哪一条或哪几条事实编号。\n"
    "2. 不得引用清单中不存在的编号，不得编造未在清单中出现的具体事实（模块名、类名、"
    "依赖名、数字等）。\n"
    "3. 允许写不需要引用编号的总结性/过渡性语句（例如整体定位的归纳判断），但这类"
    "语句不能包含具体的、可核实的事实细节。\n"
    "4. 只输出这段介绍文案本身，不要输出其他解释、前后缀或 Markdown 标题。\n"
    "5. 直接使用中文撰写。"
)


def build_user_prompt(fact_package_md: str) -> str:
    return (
        "以下是从一个代码仓库中确定性提取出的事实清单（每条已标注编号）：\n\n"
        f"{fact_package_md}\n\n"
        "请基于以上事实撰写介绍文案，并按系统提示的要求标注引用编号。"
    )


def run(n: int = 10, out_prefix: str = "gen", fact_package_path: Path | None = None,
        extra_system_note: str = ""):
    fact_package_path = fact_package_path or (OUT_DIR / "fact_package.md")
    fact_package_md = fact_package_path.read_text(encoding="utf-8")
    system_prompt = SYSTEM_PROMPT + (("\n\n" + extra_system_note) if extra_system_note else "")
    user_prompt = build_user_prompt(fact_package_md)

    results = []
    for i in range(1, n + 1):
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        attempt = 0
        while True:
            attempt += 1
            try:
                message, usage, elapsed = chat(messages, max_tokens=2048, temperature=1)
                break
            except RuntimeError as exc:
                if attempt >= 5:
                    raise
                wait = min(2 ** attempt, 30)
                print(f"  gen {i:02d} attempt {attempt} failed ({exc}); retrying in {wait}s", file=sys.stderr)
                time.sleep(wait)

        content = message.get("content", "")
        reasoning = message.get("reasoning_content", "")
        record = {
            "index": i,
            "content": content,
            "reasoning_content_len": len(reasoning) if reasoning else 0,
            "usage": usage,
            "elapsed_s": elapsed,
        }
        results.append(record)
        (OUT_DIR / f"{out_prefix}_{i:02d}.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (OUT_DIR / f"{out_prefix}_{i:02d}.md").write_text(content, encoding="utf-8")
        print(f"  gen {i:02d}: {len(content)} chars, usage={usage}, elapsed={elapsed:.1f}s")

    (OUT_DIR / f"{out_prefix}_all.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return results


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    print(f"Running {n} generations against k3 ...")
    run(n=n)
    print("Done.")
