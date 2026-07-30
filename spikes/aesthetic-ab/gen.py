"""审美对比实验：三组 × 2 次，同一份 brief。

问题：agent 自由生成的前端「AI 味」太重（求平均 / 没有观点）。
三条候选解法，实测对比：

  A  baseline      —— 当前做法，自由生成。对照组。
  B  art-direction —— 两阶段：先让 agent 输出**处方性艺术方向**（确切色值、字体配对、
                      间距阶、版式原型、一个刻意的反常动作 + 理由），展示后再严格按它实现。
                      反均值化装置是「强制显式承诺 + 必须有一处越界」，不是库的大小。
  C  framework     —— 引入 Tailwind CDN，用成熟组件模式实现。

三组的 brief、媒介、布局方向完全相同，只有「怎么约束创作」不同。

预算：max_tokens=40000（E4 实测 16000 会截断导致产物不完整），不因预算做减法。

用法：
    python spikes/aesthetic-ab/gen.py            # 跑全部 6 次
    python spikes/aesthetic-ab/gen.py A 1        # 只跑 A 组第 1 次
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "_lib"))
from kimi import chat, chat_stream  # noqa: E402

OUT = HERE / "runs"
OUT.mkdir(exist_ok=True)

MAX_TOKENS = 40000

# ---------------------------------------------------------------- 共用 brief
BRIEF = """\
为 OEYdesign 这个产品做一个 Web 工作台前端页面。

OEYdesign 是一个多模态设计 agent：用户用自然语言描述需求，它理解意图后产出可交付的
Web / PPT / DOCX 设计成品，支持真实预览、对象级反馈、版本与导出。

布局要求（硬性）：
- **两栏**：左侧是「窄」的对话栏，右侧是「大」的设计成果预览区。预览区必须占据主要视觉面积。
- 不要三栏。不要把项目树/检查器做成独立主栏——那些信息放进可展开面板或预览区的次级位置。
- 参考心智模型：类似 Claude 的 artifact 界面（左聊天、右大画布）。

内容要求：
- 对话栏要有真实感的多轮对话内容（用户提需求 / agent 回应），不要 lorem ipsum。
- 预览区要展示一个「正在被设计的产物」，并有版本、状态、导出入口。
- 结构元素带 data-oey-section / data-oey-object 锚点属性。
- 没有后端，自己造 mock 把交互跑通（点击、发消息能有真实反应）。

产出格式：
- 输出多文件项目，用如下分隔标记，不要用 markdown 代码块包裹：
  ===FILE: index.html===
  <内容>
  ===FILE: styles.css===
  <内容>
- 至少包含 index.html。CSS/JS 可内联也可分文件。
"""

SYS_BASE = "你是一个资深前端工程师。严格按要求输出文件内容，不输出任何解释性文字。"

# ---------------------------------------------------------------- A: baseline
A_USER = BRIEF

# ---------------------------------------------------------------- B: art direction
B_STAGE1_SYS = """\
你是一个有明确审美主张的艺术指导（art director），不是通用助手。

你的任务是为一个界面**先定一个艺术方向**，然后才允许写代码。

关键约束：**禁止求平均。** 不要给出「深色主题 + 蓝紫渐变 + 圆角卡片 + 系统字体」
这类最常见、最安全的组合——那是训练数据的众数，不是设计。

你必须做出**可辩护的具体选择**，并且必须包含一处**刻意的反常动作**
（deliberate distinctive move）：一个别人不会这么干、但你能说清为什么成立的决定。
例如超大字号的数字、一道贯穿的硬分隔线、整体中性里唯一一处高饱和、
非常规的栏宽比例、把标题做成小字而把正文做成大字，等等。

只输出 JSON，不要任何其他文字。"""

B_STAGE1_USER = """\
为下面这个界面定艺术方向。

{brief}

输出 JSON，字段如下（所有颜色必须是确切的 hex 值，字体必须是真实可用的 font-family 栈）：

{{
  "direction_name": "给这个方向起个名字",
  "rationale": "为什么这个方向适合这个产品，2-3 句",
  "palette": {{
    "bg": "#...", "surface": "#...", "ink": "#...",
    "ink_muted": "#...", "accent": "#...", "accent_role": "这个强调色用在哪、为什么",
    "unusual_relationship": "这组颜色里哪一对关系是不常见的，为什么成立"
  }},
  "type": {{
    "display_family": "标题字体栈", "body_family": "正文字体栈",
    "pairing_rationale": "为什么这两个配在一起",
    "scale_px": [从小到大的字号阶，5-7 个数字]
  }},
  "space_scale_px": [间距阶，5-7 个数字],
  "layout_archetype": "版式原型的名字 + 一句描述（两栏比例、对齐方式、留白策略）",
  "distinctive_move": {{
    "what": "那一处刻意的反常动作具体是什么",
    "why": "为什么它成立而不是错误"
  }},
  "anti_patterns": ["这个方向下明确禁止出现的 3-4 件事"]
}}"""

B_STAGE2_SYS = """\
你是一个资深前端工程师，正在实现一份**已经定稿**的艺术方向。

铁律：
- 只能使用艺术方向里给出的色值、字体、字号阶、间距阶。**不得引入方向之外的新值。**
- `distinctive_move` **必须**在页面上真实实现出来，而且要明显。它不是装饰，是这个设计的立意。
- `anti_patterns` 里列的东西**一件都不许出现**。
- 不输出任何解释性文字，只输出文件内容。"""

B_STAGE2_USER = """\
按下面这份已定稿的艺术方向实现界面。

=== 艺术方向（不可偏离）===
{direction}

=== 界面需求 ===
{brief}"""

# ---------------------------------------------------------------- C: framework
C_USER = """\
{brief}

技术要求（硬性）：
- 使用 **Tailwind CSS**，通过 CDN 引入：
  <script src="https://cdn.tailwindcss.com"></script>
- 采用成熟的组件模式实现（类似 shadcn/ui、Tailwind UI 的做法）：
  合理的 shadow / ring / border 层次、一致的 rounded 尺度、
  规范的 spacing scale、语义化的颜色 token。
- 尽量少写自定义 CSS，优先用 Tailwind 的原子类。
"""


def strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        lines = t.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        t = "\n".join(lines)
    return t


def split_files(text: str) -> dict[str, str]:
    """Parse the ===FILE: name=== convention into {name: content}."""
    files: dict[str, str] = {}
    cur = None
    buf: list[str] = []
    for line in strip_fences(text).splitlines():
        s = line.strip()
        if s.startswith("===FILE:") and s.endswith("==="):
            if cur:
                files[cur] = "\n".join(buf).strip()
            cur = s[len("===FILE:"):-3].strip()
            buf = []
        else:
            buf.append(line)
    if cur:
        files[cur] = "\n".join(buf).strip()
    if not files:
        # model ignored the convention -> treat whole body as index.html
        files["index.html"] = strip_fences(text)
    return files


def write_run(arm: str, idx: int, files: dict[str, str], meta: dict) -> Path:
    d = OUT / f"{arm}{idx}"
    d.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        safe = name.replace("\\", "/").split("/")[-1]
        (d / safe).write_text(content, encoding="utf-8")
    (d / "_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return d


def run_one(arm: str, idx: int) -> dict:
    t0 = time.time()
    meta: dict = {"arm": arm, "idx": idx, "max_tokens": MAX_TOKENS}

    if arm == "A":
        msg, usage, el = chat_stream(
            [{"role": "system", "content": SYS_BASE},
             {"role": "user", "content": A_USER}],
            max_tokens=MAX_TOKENS, timeout=1800)
        body = msg.get("content") or ""
        meta["stages"] = [{"stage": "gen", "usage": usage, "elapsed_s": el}]

    elif arm == "B":
        # stage 1: art direction -- cached to disk so a stage-2 timeout does not
        # force regenerating the direction (and thus changing the experiment).
        cache = OUT / f"_direction_{arm}{idx}.json"
        if cache.exists():
            blob = json.loads(cache.read_text(encoding="utf-8"))
            direction, raw_dir, u1, e1 = (blob["direction"], blob["raw"],
                                          blob["usage"], blob["elapsed_s"])
            print(f"    [reuse cached direction] {cache.name}")
        else:
            m1, u1, e1 = chat(
                [{"role": "system", "content": B_STAGE1_SYS},
                 {"role": "user", "content": B_STAGE1_USER.format(brief=BRIEF)}],
                max_tokens=4000, timeout=900)
            raw_dir = strip_fences(m1.get("content") or "")
            try:
                direction = json.loads(raw_dir)
            except json.JSONDecodeError:
                direction = {"_unparsed": raw_dir}
            cache.write_text(json.dumps(
                {"direction": direction, "raw": raw_dir,
                 "usage": u1, "elapsed_s": e1}, ensure_ascii=False, indent=2),
                encoding="utf-8")
            print(f"    [direction] {direction.get('direction_name')}")
        meta["direction"] = direction
        meta["direction_raw"] = raw_dir

        # stage 2: implement strictly within it
        m2, u2, e2 = chat_stream(
            [{"role": "system", "content": B_STAGE2_SYS},
             {"role": "user", "content": B_STAGE2_USER.format(
                 direction=json.dumps(direction, ensure_ascii=False, indent=2),
                 brief=BRIEF)}],
            max_tokens=MAX_TOKENS, timeout=1800)
        body = m2.get("content") or ""
        meta["stages"] = [
            {"stage": "direction", "usage": u1, "elapsed_s": e1},
            {"stage": "implement", "usage": u2, "elapsed_s": e2},
        ]

    elif arm == "C":
        msg, usage, el = chat_stream(
            [{"role": "system", "content": SYS_BASE},
             {"role": "user", "content": C_USER.format(brief=BRIEF)}],
            max_tokens=MAX_TOKENS, timeout=1800)
        body = msg.get("content") or ""
        meta["stages"] = [{"stage": "gen", "usage": usage, "elapsed_s": el}]

    else:
        raise ValueError(arm)

    files = split_files(body)
    meta["files"] = sorted(files)
    meta["raw_chars"] = len(body)
    meta["total_elapsed_s"] = round(time.time() - t0, 1)
    last = meta["stages"][-1]["usage"]
    meta["truncated"] = (last.get("_finish_reason") == "length"
                         or last.get("completion_tokens") == MAX_TOKENS)
    d = write_run(arm, idx, files, meta)
    print(f"[{arm}{idx}] files={meta['files']} chars={meta['raw_chars']} "
          f"truncated={meta['truncated']} {meta['total_elapsed_s']}s -> {d}")
    return meta


def main() -> None:
    if len(sys.argv) >= 3:
        run_one(sys.argv[1].upper(), int(sys.argv[2]))
        return
    metas = []
    for arm in ("A", "B", "C"):
        for idx in (1, 2):
            try:
                metas.append(run_one(arm, idx))
            except Exception as exc:  # noqa: BLE001
                print(f"[{arm}{idx}] FAILED: {type(exc).__name__}: {exc}")
                metas.append({"arm": arm, "idx": idx, "error": str(exc)[:300]})
    (OUT / "_all.json").write_text(
        json.dumps(metas, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT / '_all.json'}")


if __name__ == "__main__":
    main()
