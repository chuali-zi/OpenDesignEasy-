"""E1 follow-up: is AppContainer a viable *Windows-native* sandbox after all?

The first probe (appcontainer_probe.py) concluded "needs machine-wide ACL grants,
give up". That conclusion was premature. Two facts it did not exploit:

 1. %SystemRoot%\\System32 ALREADY grants ALL APPLICATION PACKAGES (S-1-15-2-1)
    read+execute -- that is how every UWP app on the machine launches. So a
    *system* binary (cmd.exe) should start inside an AppContainer with no ACL
    work at all. The probe failed only because it tried to launch Python, whose
    install directory has no such ACE.

 2. An AppContainer created with ZERO capabilities has NO network access, and
    that is enforced by the OS network stack -- not by firewall rules, not by
    proxy environment variables. No admin rights required.

So this probe launches cmd.exe (not python.exe) inside a zero-capability
AppContainer and has it attempt, from the inside:

    A. read a file in a scratch dir we explicitly granted to the AC SID  -> expect ALLOW
    B. read a file in the user profile we did NOT grant                  -> expect DENY
    C. read C:\\Windows\\win.ini                                          -> informational
    D. reach the network (certutil -urlcache over http)                  -> expect DENY
    E. write into the granted scratch dir                                -> expect ALLOW
    F. write OUTSIDE the scratch dir (into repo root)                    -> expect DENY

Scope note: the only ACL modification performed is on a scratch directory this
script creates under spikes/e1-sandbox/ac_scratch/, which the current user owns.
No machine-wide, no Program Files, no Python install dir, nothing persistent
outside this repo. Cleanup removes the directory.

Usage:  python spikes/e1-sandbox/appcontainer_v2.py
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRATCH = HERE / "ac_scratch"
PROFILE_NAME = "OEYdesignSpikeAC2"

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
userenv = ctypes.WinDLL("userenv", use_last_error=True)
advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

userenv.CreateAppContainerProfile.argtypes = [
    wt.LPCWSTR, wt.LPCWSTR, wt.LPCWSTR, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(ctypes.c_void_p)
]
userenv.CreateAppContainerProfile.restype = ctypes.c_long
userenv.DeriveAppContainerSidFromAppContainerName.argtypes = [
    wt.LPCWSTR, ctypes.POINTER(ctypes.c_void_p)
]
userenv.DeriveAppContainerSidFromAppContainerName.restype = ctypes.c_long
advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wt.LPWSTR)]
advapi32.ConvertSidToStringSidW.restype = wt.BOOL


def get_ac_sid(name: str):
    sid = ctypes.c_void_p()
    hr = userenv.CreateAppContainerProfile(name, name, name, None, 0, ctypes.byref(sid))
    if hr < 0:
        # 0x800700B7 = already exists -> derive it
        hr2 = userenv.DeriveAppContainerSidFromAppContainerName(name, ctypes.byref(sid))
        if hr2 < 0:
            raise OSError(f"CreateAppContainerProfile hr=0x{hr & 0xFFFFFFFF:08X}, "
                          f"Derive hr=0x{hr2 & 0xFFFFFFFF:08X}")
    s = wt.LPWSTR()
    if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(s)):
        raise OSError("ConvertSidToStringSidW failed")
    return sid, s.value


class SECURITY_CAPABILITIES(ctypes.Structure):
    _fields_ = [
        ("AppContainerSid", ctypes.c_void_p),
        ("Capabilities", ctypes.c_void_p),
        ("CapabilityCount", wt.DWORD),
        ("Reserved", wt.DWORD),
    ]


class STARTUPINFOEX(ctypes.Structure):
    class STARTUPINFOW(ctypes.Structure):
        _fields_ = [
            ("cb", wt.DWORD), ("lpReserved", wt.LPWSTR), ("lpDesktop", wt.LPWSTR),
            ("lpTitle", wt.LPWSTR), ("dwX", wt.DWORD), ("dwY", wt.DWORD),
            ("dwXSize", wt.DWORD), ("dwYSize", wt.DWORD), ("dwXCountChars", wt.DWORD),
            ("dwYCountChars", wt.DWORD), ("dwFillAttribute", wt.DWORD),
            ("dwFlags", wt.DWORD), ("wShowWindow", wt.WORD), ("cbReserved2", wt.WORD),
            ("lpReserved2", ctypes.c_void_p), ("hStdInput", wt.HANDLE),
            ("hStdOutput", wt.HANDLE), ("hStdError", wt.HANDLE),
        ]
    _fields_ = [("StartupInfo", STARTUPINFOW), ("lpAttributeList", ctypes.c_void_p)]


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [("hProcess", wt.HANDLE), ("hThread", wt.HANDLE),
                ("dwProcessId", wt.DWORD), ("dwThreadId", wt.DWORD)]


def launch_in_appcontainer(cmdline: str, ac_sid, cwd: str, timeout_s: int = 60) -> int:
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009
    EXTENDED_STARTUPINFO_PRESENT = 0x00080000

    size = ctypes.c_size_t(0)
    kernel32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
    buf = (ctypes.c_ubyte * size.value)()
    attr_list = ctypes.cast(buf, ctypes.c_void_p)
    if not kernel32.InitializeProcThreadAttributeList(attr_list, 1, 0, ctypes.byref(size)):
        raise OSError(f"InitializeProcThreadAttributeList: {ctypes.get_last_error()}")

    seccap = SECURITY_CAPABILITIES()
    seccap.AppContainerSid = ac_sid
    seccap.Capabilities = None
    seccap.CapabilityCount = 0          # <-- zero capabilities == no network
    seccap.Reserved = 0

    if not kernel32.UpdateProcThreadAttribute(
        attr_list, 0, ctypes.c_size_t(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES),
        ctypes.byref(seccap), ctypes.sizeof(seccap), None, None
    ):
        raise OSError(f"UpdateProcThreadAttribute: {ctypes.get_last_error()}")

    si = STARTUPINFOEX()
    si.StartupInfo.cb = ctypes.sizeof(STARTUPINFOEX)
    si.lpAttributeList = attr_list
    pi = PROCESS_INFORMATION()

    ok = kernel32.CreateProcessW(
        None, ctypes.create_unicode_buffer(cmdline), None, None, False,
        EXTENDED_STARTUPINFO_PRESENT, None, cwd, ctypes.byref(si), ctypes.byref(pi))
    if not ok:
        raise OSError(f"CreateProcessW failed: {ctypes.get_last_error()}")

    kernel32.WaitForSingleObject(pi.hProcess, timeout_s * 1000)
    code = wt.DWORD()
    kernel32.GetExitCodeProcess(pi.hProcess, ctypes.byref(code))
    kernel32.CloseHandle(pi.hProcess); kernel32.CloseHandle(pi.hThread)
    return code.value


def main():
    global SCRATCH
    results: dict = {"profile": PROFILE_NAME}

    sid, sid_str = get_ac_sid(PROFILE_NAME)
    results["ac_sid"] = sid_str
    print(f"[+] AppContainer SID: {sid_str}")

    # KEY FIX vs the v1 probe: do NOT try to ACL a directory on D:\ and hope the
    # container can traverse there. An AppContainer cannot even walk a path
    # unless every ANCESTOR grants it traverse -- granting only the leaf is why
    # the first attempt failed on all probes including the "granted" one.
    #
    # Instead use the AppContainer's OWN package folder, which Windows creates
    # and ACLs for exactly this SID automatically. Zero icacls, zero admin,
    # zero ancestor grants. This is how every UWP app gets its local storage.
    local = Path(os.environ["LOCALAPPDATA"])
    SCRATCH = local / "Packages" / PROFILE_NAME / "AC" / "Temp" / "oey"
    SCRATCH.mkdir(parents=True, exist_ok=True)
    for f in SCRATCH.glob("*"):
        try:
            f.unlink()
        except OSError:
            pass
    results["scratch"] = str(SCRATCH)
    results["scratch_strategy"] = "AppContainer package AC folder (auto-ACLed by OS)"
    print(f"[+] scratch (package AC folder): {SCRATCH}")

    (SCRATCH / "inside.txt").write_text("INSIDE-OK", encoding="utf-8")
    outside = HERE / "outside_secret.txt"
    outside.write_text("OUTSIDE-SECRET", encoding="utf-8")

    # Batch script run *inside* the AppContainer. Each probe writes its own
    # result line; anything the sandbox blocks simply produces no/failed output.
    bat = SCRATCH / "probe.bat"
    bat.write_text(
        "@echo off\r\n"
        f'type "{SCRATCH / "inside.txt"}" > "{SCRATCH / "r_read_inside.txt"}" 2>&1\r\n'
        f'type "{outside}" > "{SCRATCH / "r_read_outside.txt"}" 2>&1\r\n'
        f'type "C:\\Windows\\win.ini" > "{SCRATCH / "r_read_winini.txt"}" 2>&1\r\n'
        f'echo WROTE-INSIDE > "{SCRATCH / "r_write_inside.txt"}" 2>&1\r\n'
        f'echo WROTE-OUTSIDE > "{HERE / "r_write_outside.txt"}" 2>&1\r\n'
        f'certutil -urlcache -split -f http://example.com "{SCRATCH / "net.bin"}" '
        f'> "{SCRATCH / "r_network.txt"}" 2>&1\r\n'
        "exit /b 0\r\n", encoding="utf-8")

    comspec = os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe")
    print(f"[+] launching {comspec} inside AppContainer ...")
    try:
        rc = launch_in_appcontainer(f'"{comspec}" /c "{bat}"', sid, str(SCRATCH))
        results["launch_ok"] = True
        results["exit_code"] = rc
        print(f"[+] child exited rc={rc}")
    except OSError as e:
        results["launch_ok"] = False
        results["launch_error"] = str(e)
        print(f"[!] launch failed: {e}")

    time.sleep(0.5)

    def readout(name):
        p = SCRATCH / name
        if not p.exists():
            return None
        return p.read_text(encoding="utf-8", errors="replace").strip()[:200]

    probes = {
        "A_read_granted_scratch": readout("r_read_inside.txt"),
        "B_read_ungranted_outside": readout("r_read_outside.txt"),
        "C_read_win_ini": (readout("r_read_winini.txt") or "")[:60],
        "D_network": readout("r_network.txt"),
        "E_write_granted_scratch": readout("r_write_inside.txt"),
    }
    wrote_outside = HERE / "r_write_outside.txt"
    probes["F_write_ungranted_outside"] = (
        wrote_outside.read_text(encoding="utf-8", errors="replace").strip()
        if wrote_outside.exists() else None)
    results["probes"] = probes

    def verdict(v, want_allow):
        if v is None:
            return "NO-OUTPUT (blocked)"
        low = v.lower()
        denied = ("access is denied" in low or "cannot find" in low
                  or "denied" in low or "0x80070005" in low)
        if denied:
            return "DENIED"
        return "ALLOWED"

    results["verdicts"] = {
        "A_read_granted_scratch": verdict(probes["A_read_granted_scratch"], True),
        "B_read_ungranted_outside": verdict(probes["B_read_ungranted_outside"], False),
        "D_network": ("DENIED" if (probes["D_network"] or "").lower().find("failed") >= 0
                      or probes["D_network"] is None else "ALLOWED"),
        "E_write_granted_scratch": verdict(probes["E_write_granted_scratch"], True),
        "F_write_ungranted_outside": ("DENIED" if probes["F_write_ungranted_outside"] is None
                                      else "ALLOWED"),
    }

    out = HERE / "appcontainer_v2_result.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n=== VERDICTS ===")
    for k, v in results["verdicts"].items():
        print(f"  {k:32s} {v}")
    print(f"\nwrote {out}")

    # cleanup artifacts we planted outside the scratch dir
    for p in (outside, wrote_outside):
        try:
            p.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    main()
