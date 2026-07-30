"""A5/Q6: does re-rendering an EXPORTED artifact match the Artifact's own
render?

Reuses the 10 materialized artifacts produced by a4_materialize/run.py
(spikes/a3-render/a4_materialize/trial_NN/materialized/) as the 10
`ArtifactRevision` sources. For each:

  1. "export" = zip the materialized dir (spec SS4.5: "打包为可交付的静态站点
     (目录或压缩包)")
  2. unzip it into a fresh directory (spec SS4.5: "导出物必须能重新进入验证
     ... 而不是只做一次哈希校验")
  3. render BOTH the original materialized artifact and the unzipped export,
     diff the two screenshots

This deliberately reuses a4's screenshots for the "Artifact render" side
where possible (a4 already rendered `materialized/`) but re-renders here
too for an apples-to-apples pair captured in the same pass.
"""
from __future__ import annotations

import json
import shutil
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPIKE_ROOT = HERE.parent
sys.path.insert(0, str(SPIKE_ROOT / "lib"))

from render import render_file_to_png  # noqa: E402
from diffpng import diff_images  # noqa: E402

A4_DIR = SPIKE_ROOT / "a4_materialize"


def zip_dir(src: Path, zip_path: Path):
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(src.rglob("*")):
            if f.is_file():
                zf.write(f, f.relative_to(src))


def unzip_dir(zip_path: Path, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(dest)


def run_trial(idx: int) -> dict:
    src_materialized = A4_DIR / f"trial_{idx:02d}" / "materialized"
    record = {"idx": idx}
    if not src_materialized.exists():
        record["error"] = f"source not found: {src_materialized} (run a4_materialize/run.py first)"
        return record

    trial_dir = HERE / f"trial_{idx:02d}"
    trial_dir.mkdir(parents=True, exist_ok=True)

    zip_path = trial_dir / "export.zip"
    unzipped_dir = trial_dir / "export_unzipped"
    zip_dir(src_materialized, zip_path)
    record["zip_bytes"] = zip_path.stat().st_size
    unzip_dir(zip_path, unzipped_dir)

    src_files = sorted(p.relative_to(src_materialized) for p in src_materialized.rglob("*") if p.is_file())
    unz_files = sorted(p.relative_to(unzipped_dir) for p in unzipped_dir.rglob("*") if p.is_file())
    record["file_list_match"] = [str(p) for p in src_files] == [str(p) for p in unz_files]
    record["file_count"] = len(src_files)

    try:
        r1 = render_file_to_png(src_materialized, "index.html", trial_dir / "artifact.png")
        r2 = render_file_to_png(unzipped_dir, "index.html", trial_dir / "export.png")
    except Exception as exc:  # noqa: BLE001
        record["error"] = f"render failed: {exc}"
        return record

    record["artifact_console_errors"] = r1.console_errors
    record["artifact_failed_requests"] = r1.failed_requests
    record["export_console_errors"] = r2.console_errors
    record["export_failed_requests"] = r2.failed_requests

    diff = diff_images(trial_dir / "artifact.png", trial_dir / "export.png")
    record["diff"] = diff.to_dict()
    return record


def main():
    trial_dirs = [A4_DIR / f"trial_{idx:02d}" for idx in range(1, 11)]
    missing = [d / "materialized" for d in trial_dirs if not (d / "materialized").exists()]
    if missing:
        print(f"ERROR: run a4_materialize/run.py first (missing {missing[0]}).")
        sys.exit(1)

    results = []
    for d in trial_dirs:
        idx = int(d.name.split("_")[1])
        print(f"=== export trial {idx} ===", flush=True)
        rec = run_trial(idx)
        results.append(rec)
        status = "ERROR" if "error" in rec else "OK"
        diff_ratio = rec.get("diff", {}).get("diff_ratio")
        print(f"  -> {status} diff_ratio={diff_ratio}", flush=True)
        if "error" in rec:
            print(f"  !! {rec['error']}", flush=True)

    (HERE / "SUMMARY.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("done, wrote SUMMARY.json")


if __name__ == "__main__":
    main()
