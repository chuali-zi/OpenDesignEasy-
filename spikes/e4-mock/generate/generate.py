"""E4/Q7 spike: ask k3 to generate an agent-workbench frontend that fakes its own
backend via a mock layer, 8 independent times. No file is read back into the
prompt between runs -- each run is a fresh, independent generation.

Usage: python spikes/e4-mock/generate/generate.py [start_index] [end_index]
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join("spikes", "_lib"))
from kimi import chat  # noqa: E402

RUNS_ROOT = os.path.join("spikes", "e4-mock", "runs")

PROMPT = """你要生成一个「Agent 工作台」前端产品的静态原型：纯 HTML/CSS/JS，不依赖任何构建
工具、不依赖 npm 包、不引用任何 CDN 或外部网络资源（字体/图标/图片外链都不行），要能直接用
浏览器打开 index.html，或者放在一个本地静态文件服务器后面运行。

产品形态（自己设计具体的信息架构、文案、视觉风格，不要抄下面的措辞）：
- 项目列表区：展示若干个项目/会话，点击某一项要能真的切换「当前项目」，界面其他区域要跟着变化
- 对话区：用户可以输入一条消息并发送，发送后要能看到 agent 一侧产生的回复（哪怕是模拟的）
- 预览区：展示当前项目/当前对话对应的某种产出预览（可以是代码、卡片、图文、任何你觉得合理的东西）

硬约束（必须全部满足）：

1. 当前环境**没有真实后端**。你必须自己在前端造一个 mock 层，把上面三块交互全部跑通：点击项
   目要能真的切换、发消息要能真的产生新的响应内容、预览要能真的随切换/对话变化。不能是静态死
   页面（例如按钮点了没反应、列表点了内容不变）。mock 的具体实现方式你自己决定：内联假数据 +
   setTimeout 模拟网络延迟、拦截/覆盖 fetch 或 XMLHttpRequest、注册 Service Worker、暴露一个
   `window.__mockApi__` 之类的假客户端……只要交互跑得通，怎么造你自己判断。

2. 所有承担结构角色的容器元素上要带 `data-oey-section="<name>"` 锚点，容器内的关键信息元素上
   要带 `data-oey-object="<section>.<field>"` 锚点。例如：
   `<section data-oey-section="hero"><h1 data-oey-object="hero.title">…</h1></section>`
   项目列表容器、对话区容器、预览区容器都必须有各自的 data-oey-section，列表项、消息气泡、预
   览卡片等关键元素要有 data-oey-object。

3. 必须额外产出一个 `MOCK.md` 文件，如实、完整地声明：
   - 你 mock 了哪些接口/交互点（例如「项目列表」「发送消息后的回复」「预览内容」）
   - 每一处的数据来源：是纯虚构编造的，还是从某种规则/模板推导生成的（如果是推导，说明推导规
     则是什么）
   - 你用了什么技术手段实现 mock（fetch 拦截 / setTimeout / Service Worker / 内联数组 等）
   这份声明必须覆盖你在代码里实际写的所有 mock 行为，不能有遗漏。

4. 文件数量不限（可以拆 index.html / app.js / styles.css / 更多），但必须包含 index.html
   作为入口，必须包含 MOCK.md。

输出格式（严格遵守，除文件块外不要输出任何其他文字、不要寒暄、不要解释、不要用 markdown 代
码围栏 ``` ）：

对每一个文件，用下面的标记包裹，文件与文件之间紧接着写，不要有多余说明：

<<<FILE: 相对路径/文件名>>>
文件的完整内容
<<<END>>>

至少要输出 index.html 和 MOCK.md 两个文件块，外加你需要的其它文件块。"""


def parse_files(text: str) -> dict[str, str]:
    pattern = re.compile(r"<<<FILE:\s*(.+?)\s*>>>\r?\n(.*?)<<<END>>>", re.DOTALL)
    files: dict[str, str] = {}
    for m in pattern.finditer(text):
        path = m.group(1).strip().replace("\\", "/").lstrip("/")
        if not path or ".." in path.split("/"):
            continue
        files[path] = m.group(2)
    return files


def chat_with_retry(messages, *, max_tokens, max_retries=5):
    delay = 5
    for attempt in range(1, max_retries + 1):
        try:
            return chat(messages, max_tokens=max_tokens, temperature=1, timeout=600)
        except RuntimeError as exc:
            msg = str(exc)
            is_retryable = msg.startswith("HTTP 429") or msg.startswith("HTTP 5")
            if not is_retryable or attempt == max_retries:
                raise
            print(f"  retryable error ({msg[:120]}), backing off {delay}s (attempt {attempt}/{max_retries})")
            time.sleep(delay)
            delay = min(delay * 2, 60)


def run_once(idx: int) -> dict:
    messages = [
        {
            "role": "system",
            "content": "You output only the requested file blocks in the exact format "
            "given by the user. No prose before, between, or after file blocks.",
        },
        {"role": "user", "content": PROMPT},
    ]
    msg, usage, elapsed = chat_with_retry(messages, max_tokens=16000)
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning_content") or ""
    files = parse_files(content)

    run_dir = os.path.join(RUNS_ROOT, f"run-{idx:02d}")
    os.makedirs(run_dir, exist_ok=True)

    with open(os.path.join(run_dir, "_raw_response.txt"), "w", encoding="utf-8") as f:
        f.write(content)
    if reasoning:
        with open(os.path.join(run_dir, "_reasoning.txt"), "w", encoding="utf-8") as f:
            f.write(reasoning)

    written = []
    for relpath, filecontent in files.items():
        fullpath = os.path.join(run_dir, relpath)
        os.makedirs(os.path.dirname(fullpath) or run_dir, exist_ok=True)
        with open(fullpath, "w", encoding="utf-8") as f:
            f.write(filecontent)
        written.append(relpath)

    meta = {
        "idx": idx,
        "elapsed_s": round(elapsed, 1),
        "usage": usage,
        "file_count": len(written),
        "files": written,
        "has_index_html": "index.html" in written,
        "has_mock_md": "MOCK.md" in written,
        "raw_response_chars": len(content),
    }
    with open(os.path.join(run_dir, "_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return meta


if __name__ == "__main__":
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    os.makedirs(RUNS_ROOT, exist_ok=True)
    results = []
    for i in range(start, end + 1):
        print(f"=== generating run-{i:02d} ===", flush=True)
        t0 = time.time()
        try:
            meta = run_once(i)
            print(f"  ok: files={meta['files']} elapsed={meta['elapsed_s']}s "
                  f"usage={meta['usage']}", flush=True)
            results.append(meta)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED run-{i:02d}: {exc}", flush=True)
            results.append({"idx": i, "error": str(exc)})
        print(f"  wall={time.time() - t0:.1f}s", flush=True)
    summary_path = os.path.join(RUNS_ROOT, "_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"summary written to {summary_path}")
