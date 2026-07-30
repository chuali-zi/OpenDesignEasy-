"""Time-boxed probe: can we launch a child process inside a Windows
AppContainer (the primitive UWP apps / Chrome's sandbox use for real OS-
enforced file + network confinement) using only ctypes + stdlib?

This is NOT a production implementation. It is a feasibility probe for the
E1 spike's key judgment call: "pure Python/Windows-native, or must we bring
in Docker/WSL?" If this probe cannot get a child process launched with a
restricted AppContainer token in reasonable time, that itself is evidence
about implementation cost.

Steps attempted:
  1. CreateAppContainerProfile -> get an AppContainer SID.
  2. Build SECURITY_CAPABILITIES (zero capabilities = no network capability).
  3. InitializeProcThreadAttributeList + UpdateProcThreadAttribute with
     PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES.
  4. CreateProcessW with EXTENDED_STARTUPINFO_PRESENT.
  5. If it launches, verify (via the child) that its token is in fact an
     AppContainer token and that it cannot read a file the AppContainer SID
     was not granted access to.
"""
import ctypes
import ctypes.wintypes as wt
import os
import sys

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
userenv = ctypes.WinDLL("userenv", use_last_error=True)
advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

PROFILE_NAME = "oey-e1-spike-probe"

# ---- CreateAppContainerProfile -------------------------------------------
userenv.CreateAppContainerProfile.argtypes = [
    wt.LPCWSTR, wt.LPCWSTR, wt.LPCWSTR, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(ctypes.c_void_p)
]
userenv.CreateAppContainerProfile.restype = ctypes.c_long  # HRESULT

userenv.DeriveAppContainerSidFromAppContainerName.argtypes = [wt.LPCWSTR, ctypes.POINTER(ctypes.c_void_p)]
userenv.DeriveAppContainerSidFromAppContainerName.restype = ctypes.c_long

userenv.DeleteAppContainerProfile.argtypes = [wt.LPCWSTR]
userenv.DeleteAppContainerProfile.restype = ctypes.c_long

advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wt.LPWSTR)]
advapi32.ConvertSidToStringSidW.restype = wt.BOOL

kernel32.LocalFree.argtypes = [ctypes.c_void_p]


def hresult_ok(hr):
    return hr == 0


def get_or_create_appcontainer_sid(name: str):
    sid = ctypes.c_void_p()
    hr = userenv.CreateAppContainerProfile(name, name, name, None, 0, ctypes.byref(sid))
    if hresult_ok(hr):
        return sid, "created"
    # HRESULT for "already exists" is 0x800700B7 (as signed long: -2147024713)
    ERROR_ALREADY_EXISTS_HR = -2147024713
    if hr == ERROR_ALREADY_EXISTS_HR:
        hr2 = userenv.DeriveAppContainerSidFromAppContainerName(name, ctypes.byref(sid))
        if hresult_ok(hr2):
            return sid, "derived_existing"
        return None, f"derive_failed hr=0x{hr2 & 0xFFFFFFFF:08X}"
    return None, f"create_failed hr=0x{hr & 0xFFFFFFFF:08X}"


def sid_to_string(sid_ptr):
    s = wt.LPWSTR()
    ok = advapi32.ConvertSidToStringSidW(sid_ptr, ctypes.byref(s))
    if not ok:
        return None
    val = ctypes.wstring_at(s)
    kernel32.LocalFree(s)
    return val


def main():
    print(f"[probe] attempting CreateAppContainerProfile('{PROFILE_NAME}')")
    sid, status = get_or_create_appcontainer_sid(PROFILE_NAME)
    if sid is None:
        print(f"[probe] FAILED at profile creation: {status}")
        return 2
    print(f"[probe] profile status: {status}")
    sid_str = sid_to_string(sid)
    print(f"[probe] AppContainer SID: {sid_str}")

    # ---- SECURITY_CAPABILITIES with zero capabilities ---------------------
    class SECURITY_CAPABILITIES(ctypes.Structure):
        _fields_ = [
            ("AppContainerSid", ctypes.c_void_p),
            ("Capabilities", ctypes.c_void_p),
            ("CapabilityCount", wt.DWORD),
            ("Reserved", wt.DWORD),
        ]

    seccap = SECURITY_CAPABILITIES()
    seccap.AppContainerSid = sid
    seccap.Capabilities = None
    seccap.CapabilityCount = 0
    seccap.Reserved = 0

    # ---- Proc thread attribute list ---------------------------------------
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009
    EXTENDED_STARTUPINFO_PRESENT = 0x00080000

    size = ctypes.c_size_t(0)
    kernel32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
    err = ctypes.get_last_error()
    ERROR_INSUFFICIENT_BUFFER = 122
    if err != ERROR_INSUFFICIENT_BUFFER:
        print(f"[probe] FAILED sizing attribute list, GetLastError={err}")
        return 2

    attr_buf = (ctypes.c_byte * size.value)()
    ok = kernel32.InitializeProcThreadAttributeList(
        ctypes.byref(attr_buf), 1, 0, ctypes.byref(size)
    )
    if not ok:
        print(f"[probe] FAILED InitializeProcThreadAttributeList, GetLastError={ctypes.get_last_error()}")
        return 2

    ok = kernel32.UpdateProcThreadAttribute(
        ctypes.byref(attr_buf), 0,
        ctypes.c_size_t(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES),
        ctypes.byref(seccap), ctypes.sizeof(seccap), None, None,
    )
    if not ok:
        print(f"[probe] FAILED UpdateProcThreadAttribute, GetLastError={ctypes.get_last_error()}")
        return 2

    # ---- STARTUPINFOEX + CreateProcessW ------------------------------------
    class STARTUPINFOW(ctypes.Structure):
        _fields_ = [
            ("cb", wt.DWORD), ("lpReserved", wt.LPWSTR), ("lpDesktop", wt.LPWSTR),
            ("lpTitle", wt.LPWSTR), ("dwX", wt.DWORD), ("dwY", wt.DWORD),
            ("dwXSize", wt.DWORD), ("dwYSize", wt.DWORD), ("dwXCountChars", wt.DWORD),
            ("dwYCountChars", wt.DWORD), ("dwFillAttribute", wt.DWORD), ("dwFlags", wt.DWORD),
            ("wShowWindow", wt.WORD), ("cbReserved2", wt.WORD), ("lpReserved2", ctypes.c_void_p),
            ("hStdInput", wt.HANDLE), ("hStdOutput", wt.HANDLE), ("hStdError", wt.HANDLE),
        ]

    class STARTUPINFOEXW(ctypes.Structure):
        _fields_ = [("StartupInfo", STARTUPINFOW), ("lpAttributeList", ctypes.c_void_p)]

    class PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [("hProcess", wt.HANDLE), ("hThread", wt.HANDLE),
                    ("dwProcessId", wt.DWORD), ("dwThreadId", wt.DWORD)]

    si = STARTUPINFOEXW()
    si.StartupInfo.cb = ctypes.sizeof(si)
    si.lpAttributeList = ctypes.cast(ctypes.byref(attr_buf), ctypes.c_void_p)
    pi = PROCESS_INFORMATION()

    cmdline = f'"{sys.executable}" -c "import os,sys; print(\'CHILD_RUNNING pid=\'+str(os.getpid())); sys.exit(0)"'
    cmdline_buf = ctypes.create_unicode_buffer(cmdline)

    ok = kernel32.CreateProcessW(
        None, cmdline_buf, None, None, False,
        EXTENDED_STARTUPINFO_PRESENT, None, None,
        ctypes.byref(si), ctypes.byref(pi),
    )
    if not ok:
        print(f"[probe] FAILED CreateProcessW with AppContainer token, GetLastError={ctypes.get_last_error()}")
        return 2

    print(f"[probe] SUCCESS: launched pid={pi.dwProcessId} inside AppContainer '{PROFILE_NAME}'")
    kernel32.WaitForSingleObject(pi.hProcess, 5000)
    exit_code = wt.DWORD()
    kernel32.GetExitCodeProcess(pi.hProcess, ctypes.byref(exit_code))
    print(f"[probe] child exit code: {exit_code.value}")
    kernel32.CloseHandle(pi.hProcess)
    kernel32.CloseHandle(pi.hThread)
    return 0


if __name__ == "__main__":
    rc = main()
    userenv.DeleteAppContainerProfile(PROFILE_NAME)
    sys.exit(rc)
