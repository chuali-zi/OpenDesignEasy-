"""D2 spike, step 1: generate 4 independent candidate front-ends for the
"OEYdesign agent workbench" scenario ("本仓库 -> agent 前端页",
design-intelligence-spec.md SS4.2/SS4.3).

Each candidate is ONE fresh, independent chat session (system + user only, no
history from other candidates) -- SS4.3 requires this explicitly: sharing
context makes later candidates converge toward earlier ones. Each candidate is
told a DIFFERENT differentiation axis to explore (narrative / layout / color
temperature / density), per SS4.2's "candidate_count" planning table.

Usage: python spikes/d2-aesthetic/generate_candidates.py [cand_ids...]
  e.g. python spikes/d2-aesthetic/generate_candidates.py 1 2 3 4
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.join("spikes", "_lib"))
sys.path.insert(0, os.path.join("spikes", "d2-aesthetic", "lib"))
from kimi import chat  # noqa: E402
from blocks import parse_files, write_files  # noqa: E402

ROOT = os.path.join("spikes", "d2-aesthetic")
CAND_ROOT = os.path.join(ROOT, "candidates")

REPO_FACTS = """\
关于 OEYdesign 这个仓库的事实（来自 docs/prd.md、README.md、product-client/），
写文案时只能用这些事实，不能编造仓库里没有的功能：

- OEYdesign 的产品定位（来自 docs/prd.md）：一个叫 design_agent 的系统。目标是让一个多模态、
  兼容多种底层模型的 agent，理解用户哪怕模糊的自然语言需求，产出「好看」且可导出的设计产物
  （网页 / PPT / 文档），必要时用生图能力配图，信息不确定时主动向用户提问，而不是套模板。

- 当前实现进度（README.md）：Phase 1 建立了确定性契约骨架，Phase 2 加上可恢复的运行时，
  Phase 3 加上可溯源的 Context & Evidence 基线，Phase 4 交付了一个人手写的「产品外壳」参照
  前端 product-client/（内部代号「编辑部校样台 / PROOF DESK」，隐喻报纸校对流程）。持久化用
  SQLite，各模块目前是确定性 stub 适配器（Design / Artifact / Quality / Delivery）。

- product-client/ 现有信息架构（这是当前唯一真实存在的前端，功能范围要对得上，但你不必照抄它
  的视觉或措辞）：
  * 顶部：品牌区、当前 EDITION 标记、项目切换下拉（可在多个 project 间切换）、当前项目状态戳、
    Workspace / Settings 两个视图的切换
  * 左侧 Activity 区：项目状态（如 NO PROJECT）、活动日志（时间序列事件列表）、「下一步可执行
    操作」区域、两个反馈表单——「整体方向批注」（对当前方向不满意，要求换一种叙事/语气/视觉）
    和「事实 / 策略纠正」（指出事实、权利或策略问题）
  * 中间 Proof Canvas：展示当前 revision 的候选/产出预览，标注 REVISION 号，空状态显示
    「选择或新建一个项目以开始校样」
  * 右侧 Inspector：项目文件树、Constraint profile（约束档案）、Quality & approvals（质量结论
    与审批记录）、Feedback & delivery（反馈与交付记录）
  * Settings 视图：创建新 demo 项目的表单，字段包括项目名称、Constraint preset
    （三选一：开放探索 / 设计引导 / 规范生产）、Template role
    （四选一：参考样例 / 起始脚手架 / 设计系统 / 交付合同）

- 领域语言（如果要在界面文案里提到这些概念，必须用对，不能杜撰新语义）：
  * Project 会经历「生成候选方向（可能不止一个）→ 用户对某个方向给反馈或批准 → 批准后产出
    正式 Artifact → 质量复核（硬检查 + 审美两条独立轨道）→ 通过后才能导出交付」这样一条流程。
  * 反馈分两种粒度：对整体方向不满意（要求换一个做法）、和对局部内容不满意（要求微调某个具体
    位置）。这两种反馈的处理方式不同，界面上通常需要分开表达。
  * 质量结论分「硬错误」（客观、会挡住交付）和「审美发现」（主观建议，不挡交付，用户自己判断）
    两类，不能混成一个分数。

你现在要做的不是重新实现 product-client/，而是为「同一个 OEYdesign agent 工作台」这个产品设计
一个**你自己的**前端方向，功能范围要覆盖上面列出的核心能力（项目/项目切换、活动或过程记录、
候选或产出预览、约束与质量信息、两种粒度的反馈入口），但叙事、版式、视觉、文案完全由你决定。
"""

AXES = [
    {
        "id": 1,
        "key": "narrative",
        "label": "叙事框架 / narrative metaphor",
        "guidance": """\
这一版的差异轴是【叙事框架】。请为整个界面选一个具体、有辨识度的隐喻或叙事视角（例如：飞行
驾驶舱、新闻编辑部、指挥调度塔、实验记录本、乐谱/排练室，或你自己想到的其它隐喻——要具体、
贯穿全局，不要泛泛地说「现代简洁风」）。这个隐喻要体现在板块命名、文案语气、符号/图标选择、
甚至交互措辞上，让人一眼能感觉到「这是什么类型的工作场景」。版式结构、配色、信息密度你自己
判断，服务于叙事即可，不必刻意求奇。""",
    },
    {
        "id": 2,
        "key": "layout",
        "label": "版式结构 / layout & information architecture",
        "guidance": """\
这一版的差异轴是【版式结构】。请明确选择一种与常见「左中右三栏仪表盘」不同的信息组织方式
（例如：单列纵向叙事流、命令面板/聚焦式交互、卡片瀑布流、时间轴驱动的纵深展开，或你自己设计
的其它结构），并让这个结构选择真正影响用户完成核心任务（切换项目、看候选/产出、给反馈、看
质量结论）时走的路径，而不只是把同样的区块换个网格摆放。叙事语气、配色你自己判断。""",
    },
    {
        "id": 3,
        "key": "color_temperature",
        "label": "色彩温度与基调 / color temperature & mood",
        "guidance": """\
这一版的差异轴是【色彩温度与基调】。请明确选择一种具体、有主张的配色方向（例如：暖色纸感/
印刷感、冷色高对比技术感、深色沉浸模式、克制的近似单色+一个强调色，或你自己判断更贴切的
方向），并让这个基调体现在整体氛围而不只是按钮颜色——背景、卡片、文字对比、状态提示颜色都
要服从这个基调，且要满足基本的可读对比度。版式结构、信息密度你自己判断。""",
    },
    {
        "id": 4,
        "key": "density",
        "label": "信息密度与节奏 / information density & rhythm",
        "guidance": """\
这一版的差异轴是【信息密度与节奏】。请明确选择一种密度取向（例如：数据密集、专业工具感，
一屏尽量多暴露状态与指标；或者相反，克制留白、一次只呈现少量与当前决策相关的信息，其余折叠
或渐进展开），并让这个选择具体体现在每个板块（项目列表、过程记录、候选/产出预览、约束与质量
信息）分别展示多少内容、以什么密度排布。叙事隐喻、配色你自己判断。""",
    },
]


def build_prompt(axis: dict) -> str:
    return f"""你要为 OEYdesign 项目生成一个「agent 工作台」前端产品的静态原型：纯 HTML/CSS/JS，
不依赖任何构建工具、不依赖 npm 包、不引用任何 CDN 或外部网络资源（字体/图标/图片外链都不行），
要能直接放在一个本地静态文件服务器后面用浏览器打开 index.html 运行。

{REPO_FACTS}

{axis['guidance']}

产品必须覆盖的功能范围（自己设计具体的信息架构、文案、视觉风格，不要抄 product-client 的措辞）：
- 项目列表/切换：能看到若干个项目，切换后界面其它区域要跟着真的变化
- 过程/活动记录：能看到 agent 或系统产生的一系列事件或步骤记录
- 候选或产出预览：展示当前项目对应的某种设计产出预览（网页方向的候选、或校样、或版本），要能
  随项目切换而变化
- 反馈入口：至少体现「对整体方向不满意」和「对局部内容不满意」这两种不同粒度的反馈方式
- 质量/约束信息：某种形式的约束档案或质量结论展示（不需要做真的质量引擎，展示合理的 mock 数据
  即可，但硬错误类和审美建议类信息不能混成一个分数）

硬约束（必须全部满足）：

1. 当前环境**没有真实后端**。你必须自己在前端造一个 mock 层，把上面的交互全部跑通：项目切换要
   真的切换、候选/预览要真的随项目变化、提交反馈要有真实可见的响应（哪怕是模拟的确认或状态变化）。
   不能是静态死页面。mock 的具体实现方式你自己决定：内联假数据 + setTimeout 模拟延迟、拦截/
   覆盖 fetch、暴露一个 window.__mockApi__ 之类的假客户端……只要交互跑得通，怎么造你自己判断。

2. 所有承担结构角色的容器元素上要带 `data-oey-section="<name>"` 锚点，容器内的关键信息元素上要
   带 `data-oey-object="<section>.<field>"` 锚点。例如：
   `<section data-oey-section="hero"><h1 data-oey-object="hero.title">…</h1></section>`
   项目列表、过程记录、候选/产出预览、反馈入口、质量/约束信息这几大板块都必须有各自的
   data-oey-section，其中的关键元素要有 data-oey-object。这是后续做局部反馈定位的唯一依据，
   缺锚点的区域会被判定为无法精确修改。

3. 必须额外产出一个 `MOCK.md` 文件，如实、完整地声明：
   - 你 mock 了哪些接口/交互点
   - 每一处的数据来源：是纯虚构编造的，还是从某种规则/模板推导生成的（如果是推导，说明规则）
   - 你用了什么技术手段实现 mock（fetch 拦截 / setTimeout / 内联数组 等）

4. 必须额外产出一个 `INTENT.md` 文件（200-400 字，中文或英文均可），说明：
   - 你在这一版里针对指定差异轴具体做了哪些选择（不要复述题目，要说你自己的具体决定）
   - 你给这个产品起的名字/定位（如果有）
   - 你认为这一版最能体现差异轴的 2-3 个具体位置（可以用 data-oey-section 名字指出）

5. 文件数量不限（可以拆 index.html / app.js / styles.css / 更多），但必须包含 index.html 作为
   入口，必须包含 MOCK.md 和 INTENT.md。

输出格式（严格遵守，除文件块外不要输出任何其他文字、不要寒暄、不要解释、不要用 markdown 代码
围栏 ```）：

对每一个文件，用下面的标记包裹，文件与文件之间紧接着写，不要有多余说明：

<<<FILE: 相对路径/文件名>>>
文件的完整内容
<<<END>>>

至少要输出 index.html、MOCK.md、INTENT.md 三个文件块，外加你需要的其它文件块。"""


def chat_with_retry(messages, *, max_tokens, max_retries=5):
    delay = 5
    for attempt in range(1, max_retries + 1):
        try:
            return chat(messages, max_tokens=max_tokens, temperature=1, timeout=1200)
        except (RuntimeError, TimeoutError) as exc:
            msg = str(exc)
            is_retryable = isinstance(exc, TimeoutError) or msg.startswith("HTTP 429") or msg.startswith("HTTP 5")
            if not is_retryable or attempt == max_retries:
                raise
            print(f"  retryable error ({msg[:150]}), backing off {delay}s (attempt {attempt}/{max_retries})", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 60)


def generate_one(axis: dict) -> dict:
    prompt = build_prompt(axis)
    messages = [
        {
            "role": "system",
            "content": "You output only the requested file blocks in the exact format "
            "given by the user. No prose before, between, or after file blocks.",
        },
        {"role": "user", "content": prompt},
    ]
    msg, usage, elapsed = chat_with_retry(messages, max_tokens=30000)
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning_content") or ""
    files = parse_files(content)

    cand_dir = os.path.join(CAND_ROOT, f"cand{axis['id']}", "v1")
    os.makedirs(cand_dir, exist_ok=True)
    with open(os.path.join(CAND_ROOT, f"cand{axis['id']}", "_raw_v1.txt"), "w", encoding="utf-8") as f:
        f.write(content)
    if reasoning:
        with open(os.path.join(CAND_ROOT, f"cand{axis['id']}", "_reasoning_v1.txt"), "w", encoding="utf-8") as f:
            f.write(reasoning)

    written = write_files(cand_dir, files)

    meta = {
        "cand_id": axis["id"],
        "axis_key": axis["key"],
        "axis_label": axis["label"],
        "elapsed_s": round(elapsed, 1),
        "usage": usage,
        "file_count": len(written),
        "files": written,
        "has_index_html": "index.html" in written,
        "has_mock_md": "MOCK.md" in written,
        "has_intent_md": "INTENT.md" in written,
        "raw_response_chars": len(content),
    }
    with open(os.path.join(CAND_ROOT, f"cand{axis['id']}", "_meta_v1.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return meta


if __name__ == "__main__":
    ids = [int(a) for a in sys.argv[1:]] or [a["id"] for a in AXES]
    os.makedirs(CAND_ROOT, exist_ok=True)
    results = []
    for axis in AXES:
        if axis["id"] not in ids:
            continue
        print(f"=== generating cand{axis['id']} (axis={axis['key']}) ===", flush=True)
        t0 = time.time()
        try:
            meta = generate_one(axis)
            print(f"  ok: files={meta['files']} elapsed={meta['elapsed_s']}s usage={meta['usage']}", flush=True)
            results.append(meta)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED cand{axis['id']}: {exc}", flush=True)
            results.append({"cand_id": axis["id"], "error": str(exc)})
        print(f"  wall={time.time() - t0:.1f}s", flush=True)
    summary_path = os.path.join(CAND_ROOT, "_gen_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"summary written to {summary_path}")
