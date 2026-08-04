"""Run deterministic E8-E11 measurements for the framework baseline."""
from __future__ import annotations

import contextlib
import ctypes
import ctypes.wintypes as wt
import hashlib
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
PROFILE_NAME = "OEYdesignFrameworkSpike"

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
userenv = ctypes.WinDLL("userenv", use_last_error=True)
advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

userenv.CreateAppContainerProfile.argtypes = [
    wt.LPCWSTR,
    wt.LPCWSTR,
    wt.LPCWSTR,
    ctypes.c_void_p,
    wt.DWORD,
    ctypes.POINTER(ctypes.c_void_p),
]
userenv.CreateAppContainerProfile.restype = ctypes.c_long
userenv.DeriveAppContainerSidFromAppContainerName.argtypes = [
    wt.LPCWSTR,
    ctypes.POINTER(ctypes.c_void_p),
]
userenv.DeriveAppContainerSidFromAppContainerName.restype = ctypes.c_long
advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wt.LPWSTR)]
advapi32.ConvertSidToStringSidW.restype = wt.BOOL


class SecurityCapabilities(ctypes.Structure):
    _fields_ = [
        ("AppContainerSid", ctypes.c_void_p),
        ("Capabilities", ctypes.c_void_p),
        ("CapabilityCount", wt.DWORD),
        ("Reserved", wt.DWORD),
    ]


class StartupInfoEx(ctypes.Structure):
    class StartupInfo(ctypes.Structure):
        _fields_ = [
            ("cb", wt.DWORD),
            ("lpReserved", wt.LPWSTR),
            ("lpDesktop", wt.LPWSTR),
            ("lpTitle", wt.LPWSTR),
            ("dwX", wt.DWORD),
            ("dwY", wt.DWORD),
            ("dwXSize", wt.DWORD),
            ("dwYSize", wt.DWORD),
            ("dwXCountChars", wt.DWORD),
            ("dwYCountChars", wt.DWORD),
            ("dwFillAttribute", wt.DWORD),
            ("dwFlags", wt.DWORD),
            ("wShowWindow", wt.WORD),
            ("cbReserved2", wt.WORD),
            ("lpReserved2", ctypes.c_void_p),
            ("hStdInput", wt.HANDLE),
            ("hStdOutput", wt.HANDLE),
            ("hStdError", wt.HANDLE),
        ]

    _fields_ = [("StartupInfo", StartupInfo), ("lpAttributeList", ctypes.c_void_p)]


class ProcessInformation(ctypes.Structure):
    _fields_ = [
        ("hProcess", wt.HANDLE),
        ("hThread", wt.HANDLE),
        ("dwProcessId", wt.DWORD),
        ("dwThreadId", wt.DWORD),
    ]


def get_appcontainer_sid(name: str) -> tuple[ctypes.c_void_p, str]:
    sid = ctypes.c_void_p()
    hr = userenv.CreateAppContainerProfile(name, name, name, None, 0, ctypes.byref(sid))
    if hr < 0:
        derived = userenv.DeriveAppContainerSidFromAppContainerName(name, ctypes.byref(sid))
        if derived < 0:
            raise OSError(
                f"CreateAppContainerProfile hr=0x{hr & 0xFFFFFFFF:08X}; "
                f"derive hr=0x{derived & 0xFFFFFFFF:08X}"
            )
    sid_text = wt.LPWSTR()
    if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(sid_text)):
        raise OSError(f"ConvertSidToStringSidW failed: {ctypes.get_last_error()}")
    return sid, sid_text.value


def launch_in_appcontainer(command: str, sid, cwd: Path, timeout_s: int = 120) -> int:
    attribute = 0x00020009
    extended_startup = 0x00080000
    wait_timeout = 0x00000102

    size = ctypes.c_size_t()
    kernel32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
    buffer = (ctypes.c_ubyte * size.value)()
    attribute_list = ctypes.cast(buffer, ctypes.c_void_p)
    if not kernel32.InitializeProcThreadAttributeList(attribute_list, 1, 0, ctypes.byref(size)):
        raise OSError(f"InitializeProcThreadAttributeList failed: {ctypes.get_last_error()}")

    capabilities = SecurityCapabilities(sid, None, 0, 0)
    if not kernel32.UpdateProcThreadAttribute(
        attribute_list,
        0,
        ctypes.c_size_t(attribute),
        ctypes.byref(capabilities),
        ctypes.sizeof(capabilities),
        None,
        None,
    ):
        raise OSError(f"UpdateProcThreadAttribute failed: {ctypes.get_last_error()}")

    startup = StartupInfoEx()
    startup.StartupInfo.cb = ctypes.sizeof(StartupInfoEx)
    startup.lpAttributeList = attribute_list
    process = ProcessInformation()
    ok = kernel32.CreateProcessW(
        None,
        ctypes.create_unicode_buffer(command),
        None,
        None,
        False,
        extended_startup,
        None,
        str(cwd),
        ctypes.byref(startup),
        ctypes.byref(process),
    )
    if not ok:
        raise OSError(f"CreateProcessW failed: {ctypes.get_last_error()}")
    try:
        waited = kernel32.WaitForSingleObject(process.hProcess, timeout_s * 1000)
        if waited == wait_timeout:
            subprocess.run(
                ["taskkill.exe", "/PID", str(process.dwProcessId), "/T", "/F"],
                capture_output=True,
                timeout=15,
                check=False,
            )
            return 124
        exit_code = wt.DWORD()
        kernel32.GetExitCodeProcess(process.hProcess, ctypes.byref(exit_code))
        return exit_code.value
    finally:
        kernel32.CloseHandle(process.hProcess)
        kernel32.CloseHandle(process.hThread)
        kernel32.DeleteProcThreadAttributeList(attribute_list)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_manifest(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): sha256(path)
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def tree_digest(manifest: dict[str, str]) -> str:
    body = "\n".join(f"{name}\0{digest}" for name, digest in sorted(manifest.items()))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def read_int(path: Path) -> int | None:
    try:
        return int(path.read_text(encoding="utf-8", errors="replace").strip())
    except (OSError, ValueError):
        return None


def copy_project(destination: Path) -> dict:
    if destination.exists():
        shutil.rmtree(destination)
    started = time.time()

    def ignore(directory: str, names: list[str]) -> set[str]:
        if Path(directory).resolve() != HERE:
            return set()
        return {name for name in names if name in {"dist", "out", "results", "workspaces", ".log"}}

    shutil.copytree(HERE, destination, ignore=ignore)
    paths = [path for path in destination.rglob("*")]
    longest = max(paths, key=lambda path: len(str(path)))
    return {
        "elapsed_s": round(time.time() - started, 3),
        "files": sum(path.is_file() for path in paths),
        "max_path_length": len(str(longest)),
        "max_path": str(longest),
    }


def run_e8_e9() -> tuple[dict, Path]:
    node_source_raw = subprocess.check_output(["where.exe", "node"], text=True).splitlines()[0]
    node_source = Path(node_source_raw.strip())
    sid, sid_text = get_appcontainer_sid(PROFILE_NAME)
    package_root = Path(os.environ["LOCALAPPDATA"]) / "Packages" / PROFILE_NAME / "AC" / "Temp" / "fw"
    workspace = package_root / "w"
    package_root.mkdir(parents=True, exist_ok=True)
    copy_stats = copy_project(workspace)
    runtime = workspace / "runtime"
    runtime.mkdir(exist_ok=True)
    node_copy = runtime / "node.exe"
    shutil.copy2(node_source, node_copy)

    dependencies_before = tree_manifest(workspace / "node_modules")
    lock_before = sha256(workspace / "package-lock.json")

    batch = workspace / "run.bat"
    build_a = workspace / "out" / "build-a"
    vite = workspace / "node_modules" / "vite" / "bin" / "vite.js"
    batch.write_text(
        "@echo off\r\n"
        f'echo started > "{workspace / "started.txt"}"\r\n'
        f'runtime\\node.exe --version > "{workspace / "node-version.log"}" 2>&1\r\n'
        f'echo %ERRORLEVEL% > "{workspace / "node-version.rc"}"\r\n'
        f'"{node_copy}" "{vite}" build --emptyOutDir --outDir "{build_a}" > "{workspace / "build-a.log"}" 2>&1\r\n'
        f'echo %ERRORLEVEL% > "{workspace / "build-a.rc"}"\r\n'
        f'curl.exe --connect-timeout 3 http://1.1.1.1 -o "{workspace / "network.bin"}" > "{workspace / "network.log"}" 2>&1\r\n'
        f'echo %ERRORLEVEL% > "{workspace / "network.rc"}"\r\n'
        "exit /b 0\r\n",
        encoding="utf-8",
    )
    comspec = os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe")
    started = time.time()
    launch_rc = launch_in_appcontainer(f'"{comspec}" /d /c call "{batch}"', sid, workspace, timeout_s=30)
    elapsed = round(time.time() - started, 3)

    dependencies_after = tree_manifest(workspace / "node_modules")
    lock_after = sha256(workspace / "package-lock.json")
    build_a_rc = read_int(workspace / "build-a.rc")
    node_version_rc = read_int(workspace / "node-version.rc")
    network_rc = read_int(workspace / "network.rc")
    network_log = (workspace / "network.log").read_text(encoding="utf-8", errors="replace")[:1000] if (workspace / "network.log").exists() else ""
    build_log = (workspace / "build-a.log").read_text(encoding="utf-8", errors="replace")[:2000] if (workspace / "build-a.log").exists() else ""
    copied_node_version = (workspace / "node-version.log").read_text(encoding="utf-8", errors="replace").strip() if (workspace / "node-version.log").exists() else ""

    e8 = {
        "profile": PROFILE_NAME,
        "appcontainer_sid": sid_text,
        "capability_count": 0,
        "node_source": str(node_source),
        "node_copy": str(node_copy),
        "node_version": subprocess.check_output([str(node_source), "--version"], text=True).strip(),
        "copy": copy_stats,
        "launch_rc": launch_rc,
        "batch_started": (workspace / "started.txt").exists(),
        "elapsed_s": elapsed,
        "copied_node_version_rc": node_version_rc,
        "copied_node_version": copied_node_version,
        "build_a_rc": build_a_rc,
        "build_log": build_log,
        "network_probe_rc": network_rc,
        "network_output_created": (workspace / "network.bin").exists(),
        "network_log": network_log,
        "dependency_files": len(dependencies_before),
        "dependency_digest_before": tree_digest(dependencies_before),
        "dependency_digest_after": tree_digest(dependencies_after),
        "dependency_image_unchanged": dependencies_before == dependencies_after,
        "lockfile_unchanged": lock_before == lock_after,
    }
    e8["passed"] = all(
        [
            launch_rc == 0,
            node_version_rc == 0,
            copied_node_version.startswith("v"),
            build_a_rc == 0,
            network_rc not in (None, 0),
            not e8["network_output_created"],
            e8["dependency_image_unchanged"],
            e8["lockfile_unchanged"],
        ]
    )

    host_a = RESULTS / "host-build-a"
    host_b = RESULTS / "host-build-b"
    for output in (host_a, host_b):
        if output.exists():
            shutil.rmtree(output)
    host_logs = []
    for output in (host_a, host_b):
        run = subprocess.run(
            [
                str(node_source),
                str(HERE / "node_modules" / "vite" / "bin" / "vite.js"),
                "build",
                "--emptyOutDir",
                "--outDir",
                str(output),
            ],
            cwd=HERE,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        host_logs.append({"returncode": run.returncode, "stdout": run.stdout[-2000:], "stderr": run.stderr[-2000:]})
    manifest_a = tree_manifest(host_a) if host_a.exists() else {}
    manifest_b = tree_manifest(host_b) if host_b.exists() else {}
    e9 = {
        "environment": "host build using the same fixed lockfile and dependency image",
        "runs": host_logs,
        "build_a_files": manifest_a,
        "build_b_files": manifest_b,
        "build_a_tree_sha256": tree_digest(manifest_a),
        "build_b_tree_sha256": tree_digest(manifest_b),
        "same_relative_paths": sorted(manifest_a) == sorted(manifest_b),
        "byte_identical": bool(manifest_a) and manifest_a == manifest_b,
    }
    e9["passed"] = e9["same_relative_paths"] and e9["byte_identical"]
    return {"e8": e8, "e9": e9}, host_a


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args) -> None:
        return


@contextlib.contextmanager
def serve(root: Path):
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(root), **kwargs)
    with socketserver.TCPServer(("127.0.0.1", 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_address[1]}"
        finally:
            server.shutdown()
            thread.join(timeout=5)


MEASURE_SCRIPT = r"""
() => {
  const root = document.querySelector('[data-oey-preview-root]');
  const all = Array.from(document.querySelectorAll('body, body *'));
  const inner = new Set(root ? [root, ...root.querySelectorAll('*')] : []);
  const shell = all.filter((element) => !inner.has(element));
  const counts = {};
  const add = (value) => {
    if (!value || value === 'rgba(0, 0, 0, 0)') return;
    counts[value] = (counts[value] || 0) + 1;
  };
  for (const element of shell) {
    const style = getComputedStyle(element);
    add(style.color);
    add(style.backgroundColor);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (style[`border${side}Style`] !== 'none' && parseFloat(style[`border${side}Width`]) > 0) {
        add(style[`border${side}Color`]);
      }
    }
  }
  const kept = Object.fromEntries(Object.entries(counts).filter(([, count]) => count >= 2));
  const anchors = Array.from(document.querySelectorAll('*')).flatMap((element) =>
    Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith('data-oey-'))
      .map((attribute) => ({ name: attribute.name, value: attribute.value }))
  );
  return {
    previewRootFound: Boolean(root),
    shellElements: shell.length,
    shellColors: kept,
    shellColorCount: Object.keys(kept).length,
    anchors,
    objectAnchors: anchors.filter((anchor) => anchor.name === 'data-oey-object').map((anchor) => anchor.value),
  };
}
"""


def run_e10_e11(build_root: Path) -> dict:
    expected = [f"card-{index:02d}" for index in range(1, 21)]
    external_requests: list[str] = []
    console_errors: list[str] = []
    with serve(build_root) as base_url, sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 900})

            def route_request(route, request):
                if request.url.startswith(base_url):
                    route.continue_()
                else:
                    external_requests.append(request.url)
                    route.abort("blockedbyclient")

            page.route("**/*", route_request)
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            page.goto(f"{base_url}/index.html", wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(800)
            measured = page.evaluate(MEASURE_SCRIPT)
            screenshot = RESULTS / "fixture.png"
            screenshot.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(screenshot), full_page=True)
        finally:
            browser.close()

    object_anchors = measured["objectAnchors"]
    card_anchors = [anchor for anchor in object_anchors if anchor.startswith("card-")]
    e10 = {
        "expected_reused_component_instances": 20,
        "rendered_card_anchors": card_anchors,
        "rendered_card_anchor_count": len(card_anchors),
        "unique_card_anchor_count": len(set(card_anchors)),
        "missing": sorted(set(expected) - set(card_anchors)),
        "unexpected": sorted(set(card_anchors) - set(expected)),
        "all_data_oey_attributes": measured["anchors"],
        "external_requests": external_requests,
        "console_errors": console_errors,
    }
    e10["passed"] = (
        card_anchors == expected
        and len(set(card_anchors)) == 20
        and not external_requests
        and not console_errors
    )
    e11 = {
        "measurement": "computed styles outside data-oey-preview-root; repeated >=2",
        "reference_range": "5-6 colors",
        "preview_root_found": measured["previewRootFound"],
        "shell_elements": measured["shellElements"],
        "shell_colors": measured["shellColors"],
        "shell_color_count": measured["shellColorCount"],
        "screenshot": str(screenshot.relative_to(HERE)),
        "screenshot_sha256": sha256(screenshot),
    }
    e11["passed"] = e11["preview_root_found"] and e11["shell_color_count"] <= 6
    return {"e10": e10, "e11": e11}


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    records, build_root = run_e8_e9()
    records.update(run_e10_e11(build_root))
    records["environment"] = {
        "platform": os.name,
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "npm": subprocess.check_output(["npm.cmd", "--version"], text=True).strip(),
        "package_lock_sha256": sha256(HERE / "package-lock.json"),
    }
    output = RESULTS / "e8-e11.json"
    output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    for experiment in ("e8", "e9", "e10", "e11"):
        print(f"{experiment.upper()}: {'PASS' if records[experiment]['passed'] else 'FAIL'}")
    print(output)


if __name__ == "__main__":
    main()
