"""第二轮：把「艺术方向」和「实现基底」拆成两个正交维度。

第一轮把 A/B/C 摆成三选一，但它们其实不在同一个轴上：

    B（艺术方向）解决的是「有没有观点」——这是**约束创作**的问题。
    C（Tailwind）解决的是「组件层次熟不熟」——这是**实现基底**的问题。
    A（baseline）不是一条路线，是「两个都没有」。

所以第二轮的结构是：艺术方向阶段**常开**，实现基底**可选**。用户要的
「A 和 C 都做、做成可选」落在基底这一维；第一轮 B 组难看的三个病因在 prompt 里逐条修掉。

第一轮 B 组难看的三个病因（都可从 shots/B1、shots/B2 验证）：

  1. **强制「刻意的反常动作」把新奇本身当成了目标。** B1 那个 96px 红色 v3
     不对齐任何东西、不承担任何信息，读起来像渲染错误而不是决定。
     本轮换成 signature_move，并强制它必须写明「让哪一条具体信息更容易被找到」——
     新奇只能是功能的副产品。
  2. **prompt 里没有任何人体工学下限。** 于是方向可以合法地把正文定成 13px 等宽 +
     全大写标签 + 1px 细线网格，B2 就是这样，读一屏很累。本轮加了 6 条硬性可读性下限。
  3. **stage 2 的注意力被「严守方向」吃光了，内容塌了。** B1 左栏基本空着，
     而 brief 明确要求多轮对话。本轮把内容饱满度写成不合格判据，并在铁律里
     明确「内容优先于风格」。

外加一条第一轮没人提的结构性错误：**B 组让工作台的艺术方向蔓延进了预览区里的产物**。
预览区里那个东西是「别人的产品」，它长什么样是用户的成品，不该被工作台外壳同化——
B2 把一个咖啡品牌落地页也做成了等宽校对表。这条写进 brief 作为硬性隔离规则。

字体与 Tailwind 全部来自 `_vendor` 离线包，产物不得含任何 https:// 外链。

用法：
    python spikes/aesthetic-ab/gen2.py                    # 3 方向 × 2 基底 = 6 个产物
    python spikes/aesthetic-ab/gen2.py product bespoke    # 只跑一个
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "_lib"))
sys.path.insert(0, str(HERE))
from kimi import chat, chat_stream  # noqa: E402
from vendor import install_pack, install_tailwind, pack_manifest  # noqa: E402
from gen import split_files, strip_fences  # noqa: E402

OUT = HERE / "runs2"
OUT.mkdir(exist_ok=True)
MAX_TOKENS = 40000

# --------------------------------------------------------------- 共用约束块
LEGIBILITY = """\
可读性下限（硬性，任意一条违反即判不合格）：
1. 正文**不得**使用等宽字体。等宽只允许出现在代码、ID、时间戳、纯数值上。
2. 需要连续阅读的文字 ≥ 14px。对话内容、说明文字都属于此类。
3. 正文与其背景的对比度 ≥ 7:1；次要文字 ≥ 4.5:1。
4. 全大写只允许用于 ≤ 2 个词的标签，且必须加字距；不得用于句子、正文、对话内容。
5. 可点击的行 / 按钮高度 ≥ 32px。
6. 不得出现大面积空白面板——每个可见面板都必须装着真实内容。"""

TWO_LAYERS = """\
这个界面里有**两层设计**，必须分开处理：
- **外层** = OEYdesign 工作台外壳（顶栏、对话栏、工具条、版本 / 状态 / 导出）。
  艺术方向管的是这一层。
- **内层** = 预览区里那个「正在被设计的产物」。它是**别人的产品**（例如某个品牌的
  落地页），有它自己的视觉语言。**工作台的配色、字体、版式一律不得蔓延进去。**
  内层必须看起来像一个真实的、可交付的成品，而不是工作台外壳的延伸。

违反这一条，用户就看不出自己的成品究竟长什么样——这个产品的核心功能就失效了。"""

BRIEF = f"""\
为 OEYdesign 这个产品做一个 Web 工作台前端页面。

OEYdesign 是一个多模态设计 agent：用户用自然语言描述需求，它理解意图后产出可交付的
Web / PPT / DOCX 设计成品，支持真实预览、对象级反馈、版本与导出。

布局要求（硬性）：
- **两栏**：左侧是「窄」的对话栏，右侧是「大」的设计成果预览区。预览区必须占据主要视觉面积。
- 不要三栏。不要把项目树 / 检查器做成独立主栏——那些信息放进可展开面板或预览区的次级位置。
- 参考心智模型：类似 Claude 的 artifact 界面（左聊天、右大画布）。

{TWO_LAYERS}

内容要求（硬性）：
- 对话栏必须有**至少 6 轮**真实往返：用户提出具体的修改意见（例如「主标题太长，压到两行内」），
  agent 回应说明它改了什么。要能从对话里看出这个产物是被迭代出来的。
  对话栏空着、或只有一两条、或用 lorem ipsum，均判不合格。
- 预览区要展示一个完整成型的产物，并有版本、状态、导出入口。
- 结构元素带 data-oey-section / data-oey-object 锚点属性。
- 没有后端，自己造 mock 把交互跑通（点击、发消息能有真实反应）。

{LEGIBILITY}

产出格式：
- 输出多文件项目，用如下分隔标记，不要用 markdown 代码块包裹：
  ===FILE: index.html===
  <内容>
  ===FILE: styles.css===
  <内容>
- 至少包含 index.html。CSS/JS 可内联也可分文件。
"""

OFFLINE_RULE = """\
离线硬性要求：产物要在**完全无网络**的沙箱里渲染，**不得出现任何 https:// 外链**
（CDN、Google Fonts、图床一律禁止）。需要的字体和框架都已经在本地 assets/ 里备好，
按下面的说明引用本地路径即可。图片一律用 CSS / 内联 SVG 造，不要引用外部图片。"""

# --------------------------------------------------------------- 方向种子
# 第一版种子（现代产品 / 编辑设计 / 精密仪器）只圈定「气质」，把配色和隐喻留给
# agent 自己定。结果三份方向几乎完全重合——见 runs2/_convergence/：
# 底色 #F6F2E9 / #F2EFE7 / #F5F2EC，强调色 #C23B1B / #C2500F / #C2410C，
# 隐喻全是「校样台」。加上第一轮 B 组的两次，**5/5 落在同一处**。
#
# 结论：「禁止求平均」不产生原创，只是把落点从第一众数挪到第二众数——而且因为
# prompt 里点名排除了第一众数（深色 + 蓝紫渐变 + 圆角卡片），第二落点是确定的。
# 所以**方向的多样性必须从模型之外供给**。
#
# 下面这三块是**指定的视觉领地**：钉死模型反复收敛的那几个变量（外壳明度、
# 强调色温度、分层手段），其余（确切色值、字体配对、版式比例、signature_move）
# 仍然由艺术指导自己定。两块领地对应用户在第一轮里明确说好看的两种长相
# （A 组的深色工作台、C 组的浅色产品面），第三块保留 agent 自己的落点作对照。
MOODS = {
    "graphite": "深色工作台外壳：中性的近黑到深灰底（**不是深蓝、不是深紫**），"
                "强调色只有一个且必须是暖色，只用在最重要的那一处动作上。"
                "深色的理由是让预览区里那张白底样张跳出来，不是为了炫技。"
                "分层靠极轻的描边和底色差，不靠发光。"
                "明确禁止：蓝紫渐变、发光边框、玻璃拟态、霓虹色。",
    "daylight": "浅色中性外壳：近白到浅灰的中性底（**不得用暖纸色 / 米色 / 奶油色**，"
                "那是 paper 领地）。克制、明亮、可信，像一个成熟的专业软件。"
                "层次靠一层非常轻的阴影加 1px 描边建立，不靠彩色块面。"
                "强调色只有一个。明确禁止：彩色渐变、大面积品牌色铺底。",
    "paper": "暖纸色编辑台：纸面底色、衬线标题、红笔批注的语言，"
             "秩序靠基线对齐、字重层级和留白建立，不用卡片和边框切块。"
             "（这是 agent 自选方向时的固有落点，保留一块作对照。）",
}

ROUTES = ("bespoke", "system")


def _font_menu() -> str:
    man = pack_manifest()
    by_role: dict[str, list[str]] = {}
    for family, e in man.items():
        by_role.setdefault(e["role"], []).append(family)
    lines = [f"  - {role}: " + " / ".join(sorted(fams))
             for role, fams in sorted(by_role.items())]
    return "\n".join(lines)


# --------------------------------------------------------------- stage 1
S1_SYS = """\
你是一个有明确审美主张的艺术指导（art director），不是通用助手。
你的任务是为一个界面**先定一个艺术方向**，然后才允许写代码。

关键约束：**禁止求平均。** 不要给出「深色主题 + 蓝紫渐变 + 圆角卡片 + 系统字体」
这类最常见最安全的组合——那是训练数据的众数，不是设计。你必须做出可辩护的具体选择。

同样关键的另一半：**不要为了不像别人而牺牲可用性。** 新奇本身不是目标。
一个让人读起来累的界面是失败的，哪怕它很独特。你的方向要经得起「每天用八小时」的检验。

你必须包含一处 signature_move —— 这个方向最识别得出来的一处处理。但它必须**同时**
完成一件功能上的事：让某一条具体信息更容易被找到、更容易被判断。
如果你想不出它服务于什么，就说明它是装饰，换一个。

只输出 JSON，不要任何其他文字。"""

S1_USER = """\
为下面这个界面定艺术方向。

=== 气质出发点（只圈定范围，具体选择仍然由你定）===
{mood}

=== 界面需求 ===
{brief}

=== 可用字体（**只能从这份离线清单里选**，写表里的确切族名）===
{fonts}

注意：界面文字是中文。cjk_family 必须选一个 cjk-* 角色的族，否则中文会掉回系统字体，
你定的字体方向在中文上就完全不生效。

输出 JSON，字段如下（所有颜色必须是确切 hex 值）：

{{
  "direction_name": "给这个方向起个名字",
  "rationale": "为什么这个方向适合这个产品，2-3 句",
  "palette": {{
    "bg": "#...", "surface": "#...", "ink": "#...", "ink_muted": "#...",
    "line": "#...", "accent": "#...",
    "accent_role": "这个强调色用在哪、为什么只用在那里",
    "contrast_check": "ink 对 bg、ink_muted 对 surface 的对比度各是多少（估算即可），确认满足 7:1 / 4.5:1"
  }},
  "type": {{
    "display_family": "标题字体（清单内）", "body_family": "正文字体（清单内，不得是 mono）",
    "cjk_family": "中文字体（清单内 cjk-* 角色）", "mono_family": "等宽字体（清单内，只用于数值/ID）",
    "pairing_rationale": "为什么这几个配在一起",
    "scale_px": [从小到大的字号阶，5-7 个数字，最小的正文级别不得小于 14]
  }},
  "space_scale_px": [间距阶，5-7 个数字],
  "layout_archetype": "版式原型的名字 + 一句描述（两栏比例、对齐方式、留白策略）",
  "signature_move": {{
    "what": "这个方向最识别得出来的一处处理具体是什么",
    "serves": "它让**哪一条具体信息**更容易被找到或判断",
    "why_not_decoration": "为什么它不是装饰"
  }},
  "anti_patterns": ["这个方向下明确禁止出现的 3-4 件事"]
}}"""

# --------------------------------------------------------------- stage 2
S2_COMMON = """\
铁律（优先级从高到低）：
1. **内容优先于风格。** 先把 brief 的内容要求做满、做清楚，再谈风格。
   对话栏空着、面板空着，无论视觉多好都判不合格。
2. **可读性下限不可协商。** 它高于艺术方向：如果方向里的某个值会撞破下限，按下限走。
3. 颜色、字体、字号阶、间距阶只能用艺术方向里给出的值，不得引入方向外的新值。
4. signature_move 必须真实实现，而且必须真的完成 `serves` 里写的那件事。
5. anti_patterns 一件都不许出现。
6. 不输出任何解释性文字，只输出文件内容。"""

S2_BESPOKE_SYS = f"""\
你是一个资深前端工程师，正在实现一份**已经定稿**的艺术方向。手写 CSS，不使用任何框架。

字体已在本地备好，用这一行引入（不要写任何其他字体链接）：
  <link rel="stylesheet" href="assets/fonts/fonts.css">
然后在 CSS 里直接用艺术方向给出的族名。

{OFFLINE_RULE}

{S2_COMMON}"""

S2_SYSTEM_SYS = f"""\
你是一个资深前端工程师，用 **Tailwind CSS** 实现一份**已经定稿**的艺术方向。

Tailwind 和字体都已在本地备好，用这两行引入（不要写任何 CDN 链接）：
  <link rel="stylesheet" href="assets/fonts/fonts.css">
  <script src="assets/tailwind.js"></script>
紧接着用内联 config 把艺术方向注册成主题：
  <script>
    tailwind.config = {{ theme: {{ extend: {{
      colors: {{ bg:'…', surface:'…', ink:'…', 'ink-muted':'…', line:'…', accent:'…' }},
      fontFamily: {{ display:[…], body:[…], mono:[…] }},
      fontSize: {{ … 艺术方向的字号阶 … }},
      spacing:  {{ … 艺术方向的间距阶 … }}
    }} }} }}
  </script>

**这条路线上一轮就是在这里失败的**：产物用掉了 17-30 个颜色，全部来自 Tailwind 的默认调色板。
所以：
- **禁止使用 Tailwind 的默认调色板**——slate-* / gray-* / zinc-* / blue-* / emerald-* 等一律不许出现。
  颜色只能用你上面注册进去的那几个语义名。
- 字号只能用注册进去的那几阶，不许用 text-xs / text-sm 这类默认阶。
- 组件层次（shadow / ring / border / rounded / spacing）请用成熟的组件模式做，
  但每个值都必须落在艺术方向的阶上。

{OFFLINE_RULE}

{S2_COMMON}"""

S2_USER = """\
按下面这份已定稿的艺术方向实现界面。

=== 艺术方向（不可偏离）===
{direction}

=== 界面需求 ===
{brief}"""


# --------------------------------------------------------------- 执行
def get_direction(mood: str) -> tuple[dict, dict, float]:
    """同一个方向要被两条基底路线各实现一次，所以缓存到磁盘并复用。

    这是本轮实验设计的关键：两条路线吃的是**同一份方向**，
    因此产出的差异只能归因于实现基底，不会和方向的差异混在一起。
    """
    cache = OUT / f"_direction_{mood}.json"
    if cache.exists():
        blob = json.loads(cache.read_text(encoding="utf-8"))
        print(f"    [reuse direction] {mood}: {blob['direction'].get('direction_name')}")
        return blob["direction"], blob["usage"], blob["elapsed_s"]

    msg, usage, el = chat(
        [{"role": "system", "content": S1_SYS},
         {"role": "user", "content": S1_USER.format(
             mood=MOODS[mood], brief=BRIEF, fonts=_font_menu())}],
        max_tokens=4000, timeout=900)
    raw = strip_fences(msg.get("content") or "")
    try:
        direction = json.loads(raw)
    except json.JSONDecodeError:
        direction = {"_unparsed": raw}
    cache.write_text(json.dumps(
        {"direction": direction, "raw": raw, "usage": usage, "elapsed_s": el},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"    [direction] {mood}: {direction.get('direction_name')}")
    return direction, usage, el


def _families(direction: dict) -> list[str]:
    t = direction.get("type") or {}
    keys = ("display_family", "body_family", "cjk_family", "mono_family")
    seen: list[str] = []
    for k in keys:
        v = (t.get(k) or "").strip()
        # 方向里可能写成字体栈 "Inter, sans-serif"，取第一段并去引号
        v = v.split(",")[0].strip().strip("'\"")
        if v and v not in seen:
            seen.append(v)
    return seen


def _implement(sys_prompt: str, direction: dict, attempts: int = 3):
    """实现阶段带重试：端点过载时会正常关流但一个字都不发（`engine_overloaded`）。

    这类失败与 prompt 无关，重试就能过；但**不能**把空产出当成结果——
    `kimi.chat_stream` 现在会直接抛，这里只负责重试。
    """
    user = S2_USER.format(
        direction=json.dumps(direction, ensure_ascii=False, indent=2), brief=BRIEF)
    last: Exception | None = None
    for i in range(attempts):
        try:
            return chat_stream(
                [{"role": "system", "content": sys_prompt},
                 {"role": "user", "content": user}],
                max_tokens=MAX_TOKENS, timeout=1800)
        except RuntimeError as exc:
            last = exc
            print(f"    retry {i + 1}/{attempts}: {exc}", flush=True)
            time.sleep(10 * (i + 1))
    raise RuntimeError(f"implement failed after {attempts} attempts") from last


def run_one(mood: str, route: str) -> dict:
    t0 = time.time()
    direction, u1, e1 = get_direction(mood)
    sys_prompt = S2_BESPOKE_SYS if route == "bespoke" else S2_SYSTEM_SYS

    msg, u2, e2 = _implement(sys_prompt, direction)
    files = split_files(msg.get("content") or "")

    name = f"{mood}-{route}"
    d = OUT / name
    d.mkdir(parents=True, exist_ok=True)
    for fname, content in files.items():
        (d / fname.replace("\\", "/").split("/")[-1]).write_text(
            content, encoding="utf-8")

    # 离线资产由 harness 装配，不靠模型自己去取——模型只被告知本地路径。
    wanted = _families(direction)
    installed = install_pack(d, wanted)
    if route == "system":
        install_tailwind(d)

    meta = {
        "run": name, "mood": mood, "route": route, "direction": direction,
        "fonts_requested": wanted, "fonts_installed": installed,
        "files": sorted(files),
        "stages": [{"stage": "direction", "usage": u1, "elapsed_s": e1},
                   {"stage": "implement", "usage": u2, "elapsed_s": e2}],
        "truncated": u2.get("_finish_reason") == "length",
        "total_elapsed_s": round(time.time() - t0, 1),
    }
    (d / "_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    missing = [f for f in wanted if f not in installed]
    print(f"[{name}] files={meta['files']} fonts={installed} "
          f"{'MISSING=' + str(missing) if missing else ''} "
          f"truncated={meta['truncated']} {meta['total_elapsed_s']}s")
    return meta


def main() -> None:
    if len(sys.argv) >= 3:
        run_one(sys.argv[1], sys.argv[2])
        return

    # 方向先串行生成（便宜、且要被两条路线共享），实现阶段再并行。
    for mood in MOODS:
        get_direction(mood)

    jobs = [(m, r) for m in MOODS for r in ROUTES]
    metas: list[dict] = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = {pool.submit(run_one, m, r): (m, r) for m, r in jobs}
        for f, (m, r) in futs.items():
            try:
                metas.append(f.result())
            except Exception as exc:  # noqa: BLE001
                print(f"[{m}-{r}] FAILED: {type(exc).__name__}: {exc}")
                metas.append({"run": f"{m}-{r}", "error": str(exc)[:300]})

    (OUT / "_all.json").write_text(
        json.dumps(metas, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT / '_all.json'}")


if __name__ == "__main__":
    main()
