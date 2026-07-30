"""方向收敛度量：判断一组艺术方向是不是同一个方向换了个名字。

为什么需要它：`RESULT2.md` §5 发现，让 agent 自己定方向时，三个刻意不同的气质种子
产出了几乎相同的方向（强调色 #C23B1B / #C2500F / #C2410C，连前两位都一样）。
这条结论当时是靠肉眼看 hex 得出的——**不可复现，也没法当验收判据**。

本模块把它变成确定性度量，`design-intelligence-spec.md` 假设 D2 的判据引用它。
下一步要建领地库，必须有一把尺子能回答「新加的这块领地，跟已有的真的不同吗」。

度量与判据：
  · **配色分离度（阻断判据）** —— 取 bg / ink / accent 三个角色成对 CIE76 ΔE 的**最大值**，
    即「有没有任何一个角色把这两份方向明确分开」。用 ΔE 而不是 RGB 欧氏距离，是因为
    RGB 距离与人眼感知不成比例，深色区的差异会被系统性低估——而本产品有一块深色领地。
  · **隐喻重合（提示，不阻断）** —— direction_name 的词元交集。它**不能**当判据：标定发现
    已采纳的两块领地（灯箱校样台 / 红笔校样台）共享「校样台」，配色却相距 ΔE 88。
    模型的概念框架会独立于视觉种子收敛到「校样台」，这是提示人工去查 signature_move
    是否真的不同，不是否决理由。

阈值从标定数据里读出来，不是拍的：两组已知结论的角色最大 ΔE 分别落在 6.7–12.2 与
87.1–95.0，中间是一条 7 倍宽的空隙。取 25 在空隙内，且 ΔE 25 本身已远超「明显不同色」。

用法：
    python spikes/aesthetic-ab/convergence.py                 # 跑标定 + 判定
    python spikes/aesthetic-ab/convergence.py <dir> [<dir>…]  # 判定指定的方向 JSON
"""
from __future__ import annotations

import json
import re
import sys
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).resolve().parent

# 标定得出（见 calibrate()）：已知收敛组的角色最大 ΔE 上界 12.2，已知分开组的下界 87.1。
# 25 落在这条空隙里，两侧各留 2× 与 3.5× 余量。含义不是「好/坏」，是「人眼看是不是同一个方向」。
DELTA_E_SEPARATION = 25.0

# 领地名里高频出现、不承担区分度的词，比交集时剔除
NAME_STOPWORDS = {"台", "the", "of", "and"}


def _srgb_to_lab(hex_color: str) -> tuple[float, float, float]:
    """sRGB hex -> CIE L*a*b*（D65）。纯函数，无依赖。"""
    h = hex_color.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = lin(r), lin(g), lin(b)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.00000
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t) + (16 / 116)

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(c1: str, c2: str) -> float:
    """CIE76 色差。够用：这里要区分的是「几乎一样」和「明显不同」，不是印刷级配色。"""
    l1, a1, b1 = _srgb_to_lab(c1)
    l2, a2, b2 = _srgb_to_lab(c2)
    return ((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2) ** 0.5


def _tokens(name: str) -> set[str]:
    """从方向名里取词元。中文按字切，西文按词切——中文没有词边界，按字切足以发现
    「校样台 / 校准台 / 打样房」这类共享字根的重合。"""
    latin = set(re.findall(r"[A-Za-z]{2,}", name.lower()))
    cjk = set(re.findall(r"[\u4e00-\u9fff]", name))
    return (latin | cjk) - NAME_STOPWORDS


ROLES = ("bg", "ink", "accent")


def compare(a: dict, b: dict) -> dict:
    pa, pb = a.get("palette") or {}, b.get("palette") or {}
    des = {}
    for role in ROLES:
        va, vb = pa.get(role), pb.get(role)
        des[role] = delta_e(va, vb) if (va and vb) else None
    shared = _tokens(a.get("direction_name") or "") & _tokens(b.get("direction_name") or "")
    vals = [v for v in des.values() if v is not None]
    # 取最大值：问的是「有没有任何一个角色把这两份方向分开」，不是「平均差多少」。
    # 平均会被两个相同角色稀释掉唯一那个不同的角色。
    separation = max(vals) if vals else None
    return {
        "pair": (a.get("direction_name"), b.get("direction_name")),
        "delta_e": des,
        "separation": separation,
        "shared_name_tokens": sorted(shared),
        "palette_converged": separation is not None and separation < DELTA_E_SEPARATION,
        "metaphor_overlap": bool(shared),
    }


def load(paths: list[Path]) -> list[dict]:
    out = []
    for p in paths:
        blob = json.loads(p.read_text(encoding="utf-8"))
        out.append(blob.get("direction", blob))
    return out


def judge(dirs: list[dict], label: str) -> dict:
    pairs = [compare(a, b) for a, b in combinations(dirs, 2)]
    conv = [p for p in pairs if p["palette_converged"]]
    meta = [p for p in pairs if p["metaphor_overlap"]]
    print(f"\n=== {label} ({len(dirs)} 份方向, {len(pairs)} 对) ===")
    for p in pairs:
        de = p["delta_e"]
        verdict = "收敛 ✗" if p["palette_converged"] else "分开 ✓"
        note = f"  [提示] 名称重合「{''.join(p['shared_name_tokens'])}」" if p["metaphor_overlap"] else ""
        print(f"  {p['pair'][0]}  ×  {p['pair'][1]}")
        print(f"    ΔE  bg={de['bg']:.1f}  ink={de['ink']:.1f}  accent={de['accent']:.1f}"
              f"   -> 分离度 {p['separation']:.1f}  {verdict}{note}")
    seps = [p["separation"] for p in pairs if p["separation"] is not None]
    out = {
        "label": label,
        "n_directions": len(dirs),
        "n_pairs": len(pairs),
        "threshold": DELTA_E_SEPARATION,
        "separation_min": min(seps) if seps else None,
        "separation_max": max(seps) if seps else None,
        "palette_converged_pairs": len(conv),
        "metaphor_overlap_pairs": len(meta),
        "pairs": pairs,
    }
    print(f"  -> 分离度区间 [{out['separation_min']:.1f}, {out['separation_max']:.1f}]，"
          f"收敛 {len(conv)}/{len(pairs)} 对，名称重合 {len(meta)}/{len(pairs)} 对")
    return out


def calibrate() -> list[dict]:
    """用两组已知结论的真实数据标定阈值。

    一组是**已知收敛**的（agent 自选方向，肉眼可见三份几乎一样），
    一组是**已知分开**的（外部供给领地后的产物）。阈值必须把这两组分到两边——
    这样它才是从数据里读出来的，不是拍的。
    """
    conv_dir = HERE / "runs2" / "_convergence"
    runs2 = HERE / "runs2"
    out = []
    if conv_dir.exists():
        out.append(judge(load(sorted(conv_dir.glob("_direction_*.json"))),
                         "已知收敛组：agent 自选方向（气质种子）"))
    seeded = sorted(runs2.glob("_direction_*.json"))
    if seeded:
        out.append(judge(load(seeded), "已知分开组：外部供给领地（含未采纳的 daylight）"))

    if len(out) == 2:
        # 阈值必须把两组已知结论分到两边。分不开就说明这把尺子没用，不能让它悄悄通过。
        lo, hi = out[0]["separation_max"], out[1]["separation_min"]
        assert lo < DELTA_E_SEPARATION <= hi, (
            f"阈值 {DELTA_E_SEPARATION} 未能分开标定组：收敛组上界 {lo:.1f}，分开组下界 {hi:.1f}")
        print(f"\n[标定] 收敛组上界 {lo:.1f} < 阈值 {DELTA_E_SEPARATION} <= 分开组下界 {hi:.1f}，"
              f"空隙 {hi / lo:.1f}×。判据成立。")

    adopted = [runs2 / "_direction_graphite.json", runs2 / "_direction_paper.json"]
    if all(p.exists() for p in adopted):
        out.append(judge(load(adopted), "已冻结领地库：graphite + paper"))
    return out


def main() -> None:
    if len(sys.argv) > 1:
        paths = [Path(p) for p in sys.argv[1:]]
        judge(load(paths), "指定方向")
        return
    verdicts = calibrate()
    (HERE / "convergence_report.json").write_text(
        json.dumps(verdicts, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {HERE / 'convergence_report.json'}")


if __name__ == "__main__":
    main()
