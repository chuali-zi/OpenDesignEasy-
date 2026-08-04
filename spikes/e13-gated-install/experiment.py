"""E13: gated dependency install in a separate network-capable AppContainer child."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "spikes" / "_lib"))

from windows_appcontainer import appcontainer_profile, clean_env, start_process


PROFILE = "OEYdesignE13InstallSpike"
PACKAGE = "is-number"
VERSION = "7.0.0"
PACKAGE_URL = f"https://registry.npmjs.org/{PACKAGE}/-/{PACKAGE}-{VERSION}.tgz"
EXPERIMENT_KEY_NAME = "OEY_E13_EXPERIMENT_KEY"
EXPERIMENT_KEY_VALUE = "e13-disposable-experiment-value"
RESULT = HERE / "result.json"


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


def run_child(command: str, sid, cwd: Path, capabilities: tuple[str, ...], timeout_s: float) -> dict:
    started = time.monotonic()
    with start_process(command, sid, cwd, capabilities=capabilities, env=clean_env()) as process:
        code = process.wait(timeout_s)
        if code is None:
            process.terminate(124)
        return {
            "pid": process.pid,
            "returncode": 124 if code is None else code,
            "timed_out": code is None,
            "elapsed_s": round(time.monotonic() - started, 3),
            "capabilities": list(capabilities),
        }


def read_int(path: Path) -> int | None:
    try:
        return int(path.read_text(encoding="utf-8", errors="replace").strip())
    except (OSError, ValueError):
        return None


def contains_value(root: Path, value: str) -> bool:
    needle = value.encode("utf-8")
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            if needle in path.read_bytes():
                return True
        except OSError:
            pass
    return False


def main() -> None:
    os.environ[EXPERIMENT_KEY_NAME] = EXPERIMENT_KEY_VALUE
    sid, sid_text, package_ac = appcontainer_profile(PROFILE)
    workspace = package_ac / "Temp" / "install"
    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True)
    comspec = os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe")

    # The normal agent process keeps zero capabilities and cannot fetch even the
    # exact package URL that the later gate will approve.
    agent_dir = workspace / "agent-probe"
    agent_dir.mkdir()
    agent_batch = agent_dir / "run.bat"
    agent_batch.write_text(
        "@echo off\r\n"
        f'if defined {EXPERIMENT_KEY_NAME} (echo visible>"{agent_dir / "env.txt"}") else (echo absent>"{agent_dir / "env.txt"}")\r\n'
        f'curl.exe --ssl-revoke-best-effort --connect-timeout 3 --max-time 8 --fail --silent --show-error "{PACKAGE_URL}" -o "{agent_dir / "blocked.tgz"}" > "{agent_dir / "curl.log"}" 2>&1\r\n'
        f'echo %ERRORLEVEL% > "{agent_dir / "curl.rc"}"\r\n',
        encoding="utf-8",
    )
    agent = run_child(f'"{comspec}" /d /c call "{agent_batch}"', sid, agent_dir, (), 15)
    agent.update({
        "network_rc": read_int(agent_dir / "curl.rc"),
        "download_created": (agent_dir / "blocked.tgz").exists(),
        "experiment_key_visible": (agent_dir / "env.txt").read_text(encoding="utf-8").strip() == "visible",
        "network_log": (agent_dir / "curl.log").read_text(encoding="utf-8", errors="replace")[:1000],
    })

    install_dir = workspace / "approved-install"
    package_dir = install_dir / "node_modules" / PACKAGE
    package_dir.mkdir(parents=True)
    lockfile = install_dir / "package-lock.json"
    lockfile.write_text(
        json.dumps({
            "name": "oey-e13-probe",
            "lockfileVersion": 3,
            "requires": True,
            "packages": {
                "": {"dependencies": {PACKAGE: VERSION}},
                f"node_modules/{PACKAGE}": {"version": VERSION, "resolved": PACKAGE_URL},
            },
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    lock_before = sha256(lockfile)
    request_record = {
        "session_id": "e13-experiment-session",
        "tool": "install_dependency",
        "package": PACKAGE,
        "version": VERSION,
        "registry": "https://registry.npmjs.org",
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }
    (install_dir / "gate-request.json").write_text(
        json.dumps(request_record, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    archive = install_dir / "dependency.tgz"
    fetch_started = time.monotonic()
    fetch_error = None
    try:
        request = urllib.request.Request(PACKAGE_URL, headers={"User-Agent": "OEYdesign-E13-Spike/1"})
        with urllib.request.urlopen(request, timeout=60) as response:
            archive.write_bytes(response.read())
    except Exception as exc:
        fetch_error = f"{type(exc).__name__}: {exc}"
    broker_fetch = {
        "trusted_process": "engine fetch broker",
        "approved_url": PACKAGE_URL,
        "elapsed_s": round(time.monotonic() - fetch_started, 3),
        "returncode": 0 if fetch_error is None else 1,
        "error": fetch_error,
        "experiment_key_available_to_broker": EXPERIMENT_KEY_NAME in os.environ,
        "experiment_key_persisted": False,
    }

    installer_batch = install_dir / "install.bat"
    installer_batch.write_text(
        "@echo off\r\n"
        f'if defined {EXPERIMENT_KEY_NAME} (echo visible>"{install_dir / "env.txt"}") else (echo absent>"{install_dir / "env.txt"}")\r\n'
        f'tar.exe -xzf "{archive}" -C "{package_dir}" --strip-components 1 > "{install_dir / "tar.log"}" 2>&1\r\n'
        f'echo %ERRORLEVEL% > "{install_dir / "tar.rc"}"\r\n'
        "if errorlevel 1 exit /b 21\r\n"
        "exit /b 0\r\n",
        encoding="utf-8",
    )
    granted_at = datetime.now(timezone.utc).isoformat()
    installer = run_child(
        f'"{comspec}" /d /c call "{installer_batch}"',
        sid,
        install_dir,
        (),
        90,
    )
    manifest = tree_manifest(package_dir)
    installed_package = json.loads((package_dir / "package.json").read_text(encoding="utf-8")) if (package_dir / "package.json").exists() else {}
    archive_hash = sha256(archive) if archive.exists() else None
    tree_hash = tree_digest(manifest) if manifest else None
    ledger_entry = {
        **request_record,
        "granted_at": granted_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "grant": {
            "network_process": "trusted engine fetch broker",
            "install_process": "independent zero-capability AppContainer child",
            "approved_url": PACKAGE_URL,
        },
        "result": "succeeded" if broker_fetch["returncode"] == 0 and installer["returncode"] == 0 else "failed",
        "returncode": installer["returncode"],
        "resolved_url": PACKAGE_URL,
        "archive_sha256": archive_hash,
        "lockfile_sha256": sha256(lockfile),
        "dependency_tree_sha256": tree_hash,
        "dependency_files": len(manifest),
    }
    ledger = install_dir / "side-effect-ledger.jsonl"
    ledger.write_text(json.dumps(ledger_entry, ensure_ascii=False) + "\n", encoding="utf-8")

    record = {
        "profile": PROFILE,
        "sid": sid_text,
        "dependency": f"{PACKAGE}@{VERSION}",
        "agent_run_command": agent,
        "gate": request_record,
        "broker_fetch": broker_fetch,
        "installer": {
            **installer,
            "extract_rc": read_int(install_dir / "tar.rc"),
            "experiment_key_visible": (install_dir / "env.txt").read_text(encoding="utf-8").strip() == "visible",
            "installed_version": installed_package.get("version"),
        },
        "evidence": {
            "lockfile_sha256_before": lock_before,
            "lockfile_sha256_after": sha256(lockfile),
            "archive_sha256": archive_hash,
            "dependency_tree_sha256": tree_hash,
            "dependency_files": len(manifest),
            "ledger_entries": len(ledger.read_text(encoding="utf-8").splitlines()),
        },
    }
    record["checks"] = {
        "agent_zero_capability_network_denied": (agent["network_rc"] not in (None, 0) or agent["returncode"] not in (0, 20)) and not agent["download_created"],
        "network_limited_to_trusted_broker": broker_fetch["returncode"] == 0 and installer["capabilities"] == [],
        "approved_install_succeeded": installer["returncode"] == 0 and record["installer"]["extract_rc"] == 0,
        "requested_version_installed": installed_package.get("version") == VERSION,
        "lockfile_unchanged": lock_before == sha256(lockfile),
        "tree_hash_recorded": tree_hash is not None and ledger_entry["dependency_tree_sha256"] == tree_hash,
        "audit_ledger_complete": ledger_entry["result"] == "succeeded" and ledger_entry["archive_sha256"] is not None,
        "experiment_key_absent_from_children": not agent["experiment_key_visible"] and not record["installer"]["experiment_key_visible"],
        "experiment_key_value_absent_from_workspace": not contains_value(workspace, EXPERIMENT_KEY_VALUE),
    }
    record["passed"] = all(record["checks"].values())
    RESULT.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(record, ensure_ascii=False, indent=2))
    raise SystemExit(0 if record["passed"] else 1)


if __name__ == "__main__":
    main()
