"""离线资产 vendor 包：证伪「框架路线必须联网」。

背景：`RESULT.md` §4.2 断言 Tailwind 必须走 CDN，因此框架路线与零 capability 的
AppContainer 沙箱不可调和。这个断言只对「渲染时联网」成立，对「预取到本地再渲染」
不成立——而且它漏掉了一个更大的事实：**A2 / B1 / B2 也在从 Google Fonts 拉字体**，
离线资产供给根本不是框架路线独有的成本，是所有路线的共同前提。

本模块把外链资产在**开发期**取到 `spikes/_vendor/`，在**产出期**复制进
artifact 的 `assets/` 并改写引用。取包这一步发生在沙箱之外；沙箱里跑的产物
只读本地文件，网络可以保持全关。

用法：
    python spikes/aesthetic-ab/vendor.py fetch          # 建 vendor 缓存
    python spikes/aesthetic-ab/vendor.py apply runs/C1  # 离线化一个产物（原地）
    python spikes/aesthetic-ab/vendor.py apply-all      # 离线化 runs/ 下全部
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENDOR = HERE.parent / "_vendor"

# Google Fonts 只在 UA 是真实浏览器时才返回 woff2；否则退化成 ttf 甚至 403。
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# Tailwind Play CDN 是浏览器内 JIT 编译器，本身就是一个自包含 JS 文件。
# 固定版本号而不是取 latest：vendor 包必须可复现。
TAILWIND_PLAY_URL = "https://cdn.tailwindcss.com/3.4.16"
TAILWIND_PLAY_NAME = "tailwind-play-3.4.16.js"

# --------------------------------------------------------------- 字体供给表
# 第二轮的产物不再自己去 CDN 找字体：它只能从这张**已经离线可用**的表里挑。
# 这把「字体可用性」从运行期的网络问题变成了生成期的一个封闭选项集——
# 模型选不到表外的字体，也就不会产出一个必须联网才好看的产物。
#
# 覆盖面按用途划分：中文正文 / 中文标题 / 西文无衬线 / 西文衬线 / 等宽。
# 中文族是必需的——产品界面是中文，缺 CJK 字形会静默回退到系统字体，
# 让艺术方向在中文文本上完全失效（第一轮 B 组的中文其实就没吃到 IBM Plex Mono）。
FONT_PACK = {
    "Noto Sans SC": ("cjk-sans", "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap"),
    "Noto Serif SC": ("cjk-serif", "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&display=swap"),
    "Inter": ("latin-sans", "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"),
    "Space Grotesk": ("latin-sans", "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap"),
    "Source Serif 4": ("latin-serif", "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap"),
    "Fraunces": ("latin-serif", "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&display=swap"),
    "IBM Plex Sans": ("latin-sans", "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap"),
    "IBM Plex Mono": ("mono", "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap"),
    "JetBrains Mono": ("mono", "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap"),
}

PACK = VENDOR / "pack"

# 实验产物实际用到的字体族（从 runs/*/index.html 的 Google Fonts 链接里抽出来的）。
FONT_CSS_URLS = {
    "b1": "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap",
    "b2": "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,650&family=IBM+Plex+Mono:wght@400;500&display=swap",
    "a2": "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;600&display=swap",
}


def _get(url: str, *, binary: bool = False, attempts: int = 4):
    """取一个 URL。fetch 阶段跑在开发机的真实网络上，抖动是常态，所以带重试。"""
    req = urllib.request.Request(url, headers={
        "User-Agent": BROWSER_UA,
        "Accept": "*/*",
    })
    last: Exception | None = None
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
            return raw if binary else raw.decode("utf-8")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
            print(f"    retry {i + 1}/{attempts} {url.rsplit('/', 1)[-1]}: "
                  f"{type(exc).__name__}")
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"fetch failed after {attempts} attempts: {url}") from last


# --------------------------------------------------------------- fetch 阶段
def fetch() -> dict:
    """把外链资产取到 vendor 缓存。这一步在沙箱之外、开发期执行。"""
    VENDOR.mkdir(parents=True, exist_ok=True)
    fonts_dir = VENDOR / "fonts"
    fonts_dir.mkdir(exist_ok=True)
    manifest: dict = {"tailwind": {}, "fonts": {}}

    # 1. Tailwind Play CDN 的 JS
    tw_path = VENDOR / TAILWIND_PLAY_NAME
    if not tw_path.exists():
        data = _get(TAILWIND_PLAY_URL, binary=True)
        tw_path.write_bytes(data)
    manifest["tailwind"] = {
        "source": TAILWIND_PLAY_URL,
        "file": TAILWIND_PLAY_NAME,
        "bytes": tw_path.stat().st_size,
    }
    print(f"[tailwind] {TAILWIND_PLAY_NAME} {tw_path.stat().st_size} bytes")

    # 2. Google Fonts：先取 css2，再把里面每个 woff2 抓下来并改写成本地相对路径
    for key, url in FONT_CSS_URLS.items():
        css = _get(url)
        woff_urls = sorted(set(re.findall(r"url\((https://[^)]+?\.woff2)\)", css)))
        local_css = css
        got = 0
        for wurl in woff_urls:
            name = f"{key}-{wurl.rsplit('/', 1)[-1]}"
            dest = fonts_dir / name
            if not dest.exists():
                dest.write_bytes(_get(wurl, binary=True))
            local_css = local_css.replace(wurl, f"fonts/{name}")
            got += 1
        css_name = f"fonts-{key}.css"
        (VENDOR / css_name).write_text(local_css, encoding="utf-8")
        manifest["fonts"][key] = {
            "source": url, "css": css_name, "woff2_count": got,
        }
        print(f"[fonts:{key}] {css_name} + {got} woff2")

    (VENDOR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


# --------------------------------------------------- 字体供给表的取包 / 装配
def _slug(family: str) -> str:
    return family.lower().replace(" ", "-")


def fetch_pack() -> dict:
    """把字体供给表整体取到 `_vendor/pack/`，每族一份 CSS + 自己的 woff2 目录。"""
    PACK.mkdir(parents=True, exist_ok=True)
    manifest: dict = {}
    for family, (role, url) in FONT_PACK.items():
        slug = _slug(family)
        fdir = PACK / slug
        fdir.mkdir(exist_ok=True)
        css = _get(url)
        woff_urls = sorted(set(re.findall(r"url\((https://[^)]+?\.woff2)\)", css)))
        for wurl in woff_urls:
            dest = fdir / wurl.rsplit("/", 1)[-1]
            if not dest.exists():
                dest.write_bytes(_get(wurl, binary=True))
            css = css.replace(wurl, f"{slug}/{dest.name}")
        (PACK / f"{slug}.css").write_text(css, encoding="utf-8")
        size = sum(f.stat().st_size for f in fdir.glob("*.woff2"))
        manifest[family] = {"role": role, "slug": slug, "source": url,
                            "files": len(woff_urls), "bytes": size}
        print(f"[pack] {family:16} {role:11} {len(woff_urls):>3} files "
              f"{size / 1024:>8.0f} KB")
    (PACK / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def pack_manifest() -> dict:
    return json.loads((PACK / "manifest.json").read_text(encoding="utf-8"))


def install_pack(run_dir: Path, families: list[str]) -> list[str]:
    """把选中的字体族装进产物的 `assets/fonts/`，返回实际装上的族名。

    产物只需要 `<link rel="stylesheet" href="assets/fonts/fonts.css">` 一行；
    它在零网络下可用，因为所有 woff2 都在同一棵树里。
    """
    man = pack_manifest()
    dest = run_dir / "assets" / "fonts"
    dest.mkdir(parents=True, exist_ok=True)
    chunks, installed = [], []
    for family in families:
        entry = man.get(family)
        if entry is None:
            continue
        slug = entry["slug"]
        shutil.copytree(PACK / slug, dest / slug, dirs_exist_ok=True)
        chunks.append((PACK / f"{slug}.css").read_text(encoding="utf-8"))
        installed.append(family)
    (dest / "fonts.css").write_text("\n".join(chunks), encoding="utf-8")
    return installed


def install_tailwind(run_dir: Path) -> str:
    dest = run_dir / "assets"
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(VENDOR / TAILWIND_PLAY_NAME, dest / "tailwind.js")
    return "assets/tailwind.js"


# --------------------------------------------------------------- apply 阶段
def _which_font_key(html: str) -> str | None:
    for key, url in FONT_CSS_URLS.items():
        # 只比 family 参数，忽略 &display 等差异
        fams = re.findall(r"family=([^&:]+)", url)
        if all(f"family={f}" in html for f in fams):
            return key
    return None


def apply(run_dir: Path) -> dict:
    """把一个产物离线化：复制 vendor 资产进 assets/，改写 index.html 的外链。"""
    idx = run_dir / "index.html"
    html = idx.read_text(encoding="utf-8")
    assets = run_dir / "assets"
    rec: dict = {"run": run_dir.name, "rewrites": []}

    # Tailwind
    if "cdn.tailwindcss.com" in html:
        assets.mkdir(exist_ok=True)
        shutil.copy2(VENDOR / TAILWIND_PLAY_NAME, assets / "tailwind.js")
        html = re.sub(
            r'<script src="https://cdn\.tailwindcss\.com[^"]*"></script>',
            '<script src="assets/tailwind.js"></script>', html)
        rec["rewrites"].append("tailwind -> assets/tailwind.js")

    # Google Fonts
    if "fonts.googleapis.com/css2" in html:
        key = _which_font_key(html)
        if key is None:
            rec["font_error"] = "no vendored css matches this html"
        else:
            assets.mkdir(exist_ok=True)
            (assets / "fonts").mkdir(exist_ok=True)
            css = (VENDOR / f"fonts-{key}.css").read_text(encoding="utf-8")
            for w in (VENDOR / "fonts").glob(f"{key}-*.woff2"):
                shutil.copy2(w, assets / "fonts" / w.name)
            (assets / "fonts.css").write_text(css, encoding="utf-8")
            # preconnect 到 Google 的两行在离线下毫无意义，一并删掉
            html = re.sub(
                r'\s*<link rel="preconnect" href="https://fonts\.g[^"]*"[^>]*/?>', "", html)
            html = re.sub(
                r'<link[^>]*href="https://fonts\.googleapis\.com/css2[^"]*"[^>]*/?>',
                '<link rel="stylesheet" href="assets/fonts.css">', html)
            rec["rewrites"].append(f"fonts({key}) -> assets/fonts.css")

    idx.write_text(html, encoding="utf-8")
    leftover = re.findall(r'(?:src|href)="(https?://[^"]+)"', html)
    rec["remaining_external"] = sorted(set(leftover))
    print(f"[{run_dir.name}] {rec['rewrites'] or 'no external refs'} "
          f"| leftover={len(rec['remaining_external'])}")
    return rec


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fetch"
    if cmd == "fetch":
        fetch()
    elif cmd == "fetch-pack":
        fetch_pack()
    elif cmd == "apply":
        apply(Path(sys.argv[2]).resolve())
    elif cmd == "apply-all":
        # 原始 runs/ 保持不动（它是实验记录）；离线化产物另存一份供对照渲染。
        out = HERE / "offline"
        if out.exists():
            shutil.rmtree(out)
        recs = []
        for d in sorted((HERE / "runs").iterdir()):
            if d.is_dir() and (d / "index.html").exists():
                shutil.copytree(d, out / d.name)
                recs.append(apply(out / d.name))
        (out / "_vendor_report.json").write_text(
            json.dumps(recs, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nwrote {out / '_vendor_report.json'}")
    else:
        raise SystemExit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main()
