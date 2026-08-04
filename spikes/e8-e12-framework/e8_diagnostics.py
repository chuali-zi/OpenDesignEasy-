"""Discriminate E8 path-resolution and child-pipe failures in AppContainer."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from experiment import (
    HERE,
    PROFILE_NAME,
    RESULTS,
    copy_project,
    get_appcontainer_sid,
    launch_in_appcontainer,
    run_e10_e11,
    tree_digest,
    tree_manifest,
)


DRIVE = "S:"


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")[:4000]


def run_case(name: str, command: str, sid, workspace: Path, timeout_s: int = 30) -> dict:
    case_dir = workspace / "diagnostics" / name
    case_dir.mkdir(parents=True, exist_ok=True)
    batch = case_dir / "run.bat"
    log = case_dir / "output.log"
    rc_file = case_dir / "rc.txt"
    batch.write_text(
        "@echo off\r\n"
        f"{command} > \"{log}\" 2>&1\r\n"
        f"echo %ERRORLEVEL% > \"{rc_file}\"\r\n",
        encoding="utf-8",
    )
    comspec = os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe")
    started = time.time()
    launch_cwd = Path(f"{DRIVE}\\") if name.startswith("mapped_") else workspace
    launcher_rc = launch_in_appcontainer(
        f'"{comspec}" /d /c call "{batch}"', sid, launch_cwd, timeout_s=timeout_s
    )
    elapsed = round(time.time() - started, 3)
    try:
        command_rc = int(read_text(rc_file).strip())
    except ValueError:
        command_rc = None
    return {
        "name": name,
        "command": command,
        "launcher_rc": launcher_rc,
        "command_rc": command_rc,
        "elapsed_s": elapsed,
        "launch_cwd": str(launch_cwd),
        "timed_out": launcher_rc == 124,
        "output": read_text(log),
    }


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    sid, sid_text = get_appcontainer_sid(PROFILE_NAME)
    package_root = Path(os.environ["LOCALAPPDATA"]) / "Packages" / PROFILE_NAME / "AC" / "Temp" / "fw-diag"
    workspace = package_root / "w"
    package_root.mkdir(parents=True, exist_ok=True)
    copy_stats = copy_project(workspace)
    runtime = workspace / "runtime"
    runtime.mkdir(exist_ok=True)
    node_source = Path(subprocess.check_output(["where.exe", "node"], text=True).splitlines()[0].strip())
    shutil.copy2(node_source, runtime / "node.exe")
    dependency_before = tree_manifest(workspace / "node_modules")

    (workspace / "probe.cjs").write_text(
        "const fs = require('fs');\n"
        "const path = require('path');\n"
        "console.log(JSON.stringify({cwd: process.cwd(), main: __filename, "
        "packageBytes: fs.readFileSync('package.json').length, "
        "react: require.resolve('react/package.json'), joined: path.join(process.cwd(), 'src')}));\n",
        encoding="utf-8",
    )
    (workspace / "pipe-probe.cjs").write_text(
        "const { spawnSync } = require('child_process');\n"
        "const r = spawnSync(process.execPath, ['-e', 'console.log(\"child-ok\")'], "
        "{ encoding: 'utf8', timeout: 5000 });\n"
        "console.log(JSON.stringify({status:r.status, signal:r.signal, stdout:r.stdout, "
        "stderr:r.stderr, error:r.error && {code:r.error.code,message:r.error.message}}));\n",
        encoding="utf-8",
    )
    (workspace / "inherit-probe.cjs").write_text(
        "const { spawnSync } = require('child_process');\n"
        "const r = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'inherit', timeout: 5000 });\n"
        "console.log(JSON.stringify({status:r.status, signal:r.signal, error:r.error && r.error.message}));\n",
        encoding="utf-8",
    )
    (workspace / "import-vite.mjs").write_text(
        "import { version } from 'vite';\nconsole.log(version);\n",
        encoding="utf-8",
    )

    subprocess.run(["subst.exe", DRIVE, "/D"], capture_output=True, check=False)
    mapped = subprocess.run(
        ["subst.exe", DRIVE, str(workspace)], capture_output=True, text=True, check=False
    )
    cases: list[dict] = []
    try:
        cases.append(
            run_case(
                "absolute_main",
                f'"{workspace / "runtime" / "node.exe"}" "{workspace / "probe.cjs"}"',
                sid,
                workspace,
            )
        )
        cases.append(
            run_case("mapped_main", r"S:\runtime\node.exe S:\probe.cjs", sid, workspace)
        )
        cases.append(
            run_case(
                "mapped_import_vite",
                r"S:\runtime\node.exe S:\import-vite.mjs",
                sid,
                workspace,
            )
        )
        cases.append(
            run_case("mapped_child_pipe", r"S:\runtime\node.exe S:\pipe-probe.cjs", sid, workspace, 20)
        )
        cases.append(
            run_case("mapped_child_inherit", r"S:\runtime\node.exe S:\inherit-probe.cjs", sid, workspace, 20)
        )
        cases.append(
            run_case(
                "mapped_vite_default",
                r"S:\runtime\node.exe S:\node_modules\vite\bin\vite.js build --emptyOutDir --outDir S:\out\default",
                sid,
                workspace,
                45,
            )
        )
        cases.append(
            run_case(
                "mapped_vite_no_esbuild",
                r"S:\runtime\node.exe S:\node_modules\vite\bin\vite.js build --config S:\vite.no-esbuild.config.js --configLoader runner --emptyOutDir --outDir S:\out\no-esbuild",
                sid,
                workspace,
                90,
            )
        )
        cases.append(
            run_case(
                "mapped_esbuild_cli",
                r"S:\node_modules\@esbuild\win32-x64\esbuild.exe S:\src\main.jsx --bundle --outfile=S:\out\esbuild-a\assets\app.js --format=esm --platform=browser --jsx=automatic --minify && copy /Y S:\index.esbuild.html S:\out\esbuild-a\index.html",
                sid,
                workspace,
                45,
            )
        )
        cases.append(
            run_case(
                "mapped_esbuild_cli_repeat",
                r"S:\node_modules\@esbuild\win32-x64\esbuild.exe S:\src\main.jsx --bundle --outfile=S:\out\esbuild-b\assets\app.js --format=esm --platform=browser --jsx=automatic --minify && copy /Y S:\index.esbuild.html S:\out\esbuild-b\index.html",
                sid,
                workspace,
                45,
            )
        )
    finally:
        unmapped = subprocess.run(
            ["subst.exe", DRIVE, "/D"], capture_output=True, text=True, check=False
        )

    esbuild_a = workspace / "out" / "esbuild-a"
    esbuild_b = workspace / "out" / "esbuild-b"
    manifest_a = tree_manifest(esbuild_a) if esbuild_a.exists() else {}
    manifest_b = tree_manifest(esbuild_b) if esbuild_b.exists() else {}
    dependency_after = tree_manifest(workspace / "node_modules")
    render_checks = run_e10_e11(esbuild_a) if (esbuild_a / "index.html").exists() else None

    record = {
        "profile": PROFILE_NAME,
        "sid": sid_text,
        "node": subprocess.check_output([str(node_source), "--version"], text=True).strip(),
        "libuv": subprocess.check_output([str(node_source), "-p", "process.versions.uv"], text=True).strip(),
        "copy": copy_stats,
        "drive": DRIVE,
        "map_rc": mapped.returncode,
        "map_stderr": mapped.stderr,
        "unmap_rc": unmapped.returncode,
        "cases": cases,
        "dependency_image": {
            "files_before": len(dependency_before),
            "files_after": len(dependency_after),
            "tree_before": tree_digest(dependency_before),
            "tree_after": tree_digest(dependency_after),
            "unchanged": dependency_before == dependency_after,
        },
        "esbuild_determinism": {
            "a": manifest_a,
            "b": manifest_b,
            "tree_a": tree_digest(manifest_a),
            "tree_b": tree_digest(manifest_b),
            "byte_identical": bool(manifest_a) and manifest_a == manifest_b,
        },
        "esbuild_render_checks": render_checks,
    }
    output = RESULTS / "e8-diagnostics.json"
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    for case in cases:
        state = "TIMEOUT" if case["timed_out"] else f"rc={case['command_rc']}"
        print(f"{case['name']}: {state} ({case['elapsed_s']}s)")
    print(output)


if __name__ == "__main__":
    main()
