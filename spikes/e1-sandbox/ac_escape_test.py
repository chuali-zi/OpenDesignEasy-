"""E1 follow-up: run the six escape probes INSIDE a zero-capability AppContainer.

All container-side I/O targets live in the AppContainer's own package folder,
which Windows ACLs for the container SID automatically (no icacls, no admin,
no ancestor-traverse grants -- that was the bug in the first two attempts).

Probe targets planted outside the container are cleaned up at the end.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from appcontainer_v2 import PROFILE_NAME, get_ac_sid, launch_in_appcontainer  # noqa: E402


def main() -> None:
    sid, sid_str = get_ac_sid(PROFILE_NAME)
    ac = Path(os.environ["LOCALAPPDATA"]) / "Packages" / PROFILE_NAME / "AC"
    ws = ac / "Temp" / "ws"
    ws.mkdir(parents=True, exist_ok=True)
    for f in ws.glob("r_*"):
        try:
            f.unlink()
        except OSError:
            pass
    (ws / "inside.txt").write_text("INSIDE-OK", encoding="utf-8")

    repo_secret = HERE / "outside_secret.txt"
    repo_secret.write_text("OUTSIDE-SECRET", encoding="utf-8")
    profile_secret = Path(os.environ["USERPROFILE"]) / "oey_outside_secret.txt"
    profile_secret.write_text("PROFILE-SECRET", encoding="utf-8")
    write_probe = HERE / "r_write_outside.txt"
    if write_probe.exists():
        write_probe.unlink()

    # NOTE: driving the probes through a .bat file inside the AC folder does not
    # work (cmd exits 1 before running anything). Each probe is therefore its own
    # inline `cmd /c` invocation -- slower, but unambiguous about which specific
    # operation the container allowed or denied.
    comspec = os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe")
    rcs = {}

    def run(tag: str, inner: str) -> None:
        try:
            rcs[tag] = launch_in_appcontainer(f'"{comspec}" /c {inner}', sid, str(ws))
        except OSError as exc:
            # A launch failure is itself a sandbox result (e.g. the container is
            # not permitted to spawn that binary at all), not a harness bug.
            rcs[tag] = f"launch-failed: {exc}"

    run("A", f'type "{ws / "inside.txt"}" > "{ws / "r_A.txt"}" 2>&1')
    run("B1", f'type "{repo_secret}" > "{ws / "r_B_repo.txt"}" 2>&1')
    run("B2", f'type "{profile_secret}" > "{ws / "r_B_profile.txt"}" 2>&1')
    run("C", f'type "C:\\Windows\\win.ini" > "{ws / "r_C.txt"}" 2>&1')
    run("E", f'echo W > "{ws / "r_E.txt"}" 2>&1')
    run("F", f'echo W > "{write_probe}" 2>&1')
    run("D", f'certutil -urlcache -split -f http://example.com '
             f'"{ws / "n.bin"}" > "{ws / "r_D.txt"}" 2>&1')
    rc = rcs
    print(f"child exit codes = {rcs}")

    def rd(name: str) -> str | None:
        p = ws / name
        if not p.exists():
            return None
        return p.read_text(encoding="utf-8", errors="replace").strip()[:120]

    def verdict(text: str | None) -> str:
        if text is None:
            return "BLOCKED(no output)"
        low = text.lower()
        if "denied" in low or "cannot find" in low or "failed" in low:
            return "DENIED"
        return "ALLOWED"

    rows = [
        ("A  read inside workspace  (want ALLOW)", rd("r_A.txt")),
        ("B1 read repo file outside (want DENY)", rd("r_B_repo.txt")),
        ("B2 read user profile      (want DENY)", rd("r_B_profile.txt")),
        ("C  read C:\\Windows\\win.ini (info)", rd("r_C.txt")),
        ("E  write inside workspace (want ALLOW)", rd("r_E.txt")),
        ("D  network via certutil   (want DENY)", rd("r_D.txt")),
    ]
    results = {"ac_sid": sid_str, "child_rc": rc, "probes": {}}
    print(f"{'probe':40s} {'verdict':20s} output")
    for name, text in rows:
        v = verdict(text)
        results["probes"][name] = {"verdict": v, "output": text}
        print(f"{name:40s} {v:20s} {(text or '')[:44]}")

    f_allowed = write_probe.exists()
    results["probes"]["F  write outside (want DENY)"] = {
        "verdict": "ALLOWED !!" if f_allowed else "DENIED", "output": None}
    print(f"{'F  write outside          (want DENY)':40s} "
          f"{'ALLOWED !!' if f_allowed else 'DENIED':20s}")

    (HERE / "ac_escape_result.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    for p in (repo_secret, profile_secret, write_probe):
        try:
            p.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    main()
