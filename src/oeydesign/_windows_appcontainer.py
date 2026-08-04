"""Windows AppContainer process creation used by the production sandbox.

This module is imported lazily on Windows. It intentionally contains only the
native process primitive; policy and workspace validation live in sandbox.py.
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path

if os.name != "nt":
    raise RuntimeError("AppContainer process creation requires Windows")


kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
userenv = ctypes.WinDLL("userenv", use_last_error=True)
advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

CREATE_SUSPENDED = 0x00000004
CREATE_UNICODE_ENVIRONMENT = 0x00000400
EXTENDED_STARTUPINFO_PRESENT = 0x00080000
STARTF_USESTDHANDLES = 0x00000100
PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009
WAIT_TIMEOUT = 0x00000102
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000


class SidAndAttributes(ctypes.Structure):
    _fields_ = [("Sid", ctypes.c_void_p), ("Attributes", wt.DWORD)]


class SecurityCapabilities(ctypes.Structure):
    _fields_ = [
        ("AppContainerSid", ctypes.c_void_p),
        ("Capabilities", ctypes.POINTER(SidAndAttributes)),
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


class IoCounters(ctypes.Structure):
    _fields_ = [
        (name, ctypes.c_uint64)
        for name in (
            "ReadOperationCount",
            "WriteOperationCount",
            "OtherOperationCount",
            "ReadTransferCount",
            "WriteTransferCount",
            "OtherTransferCount",
        )
    ]


class JobBasicLimitInformation(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_int64),
        ("PerJobUserTimeLimit", ctypes.c_int64),
        ("LimitFlags", wt.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wt.DWORD),
        ("Affinity", ctypes.c_void_p),
        ("PriorityClass", wt.DWORD),
        ("SchedulingClass", wt.DWORD),
    ]


class JobExtendedLimitInformation(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", JobBasicLimitInformation),
        ("IoInfo", IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


@dataclass(frozen=True, slots=True)
class NativeResult:
    exit_code: int | None
    timed_out: bool
    stdout_path: Path
    stderr_path: Path
    profile_sid: str
    drive: str


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
advapi32.ConvertSidToStringSidW.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(wt.LPWSTR),
]
advapi32.ConvertSidToStringSidW.restype = wt.BOOL
kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wt.LPCWSTR]
kernel32.CreateJobObjectW.restype = wt.HANDLE
kernel32.SetInformationJobObject.argtypes = [
    wt.HANDLE,
    ctypes.c_int,
    ctypes.c_void_p,
    wt.DWORD,
]
kernel32.SetInformationJobObject.restype = wt.BOOL
kernel32.AssignProcessToJobObject.argtypes = [wt.HANDLE, wt.HANDLE]
kernel32.AssignProcessToJobObject.restype = wt.BOOL
kernel32.TerminateJobObject.argtypes = [wt.HANDLE, wt.UINT]
kernel32.TerminateJobObject.restype = wt.BOOL
kernel32.WaitForSingleObject.argtypes = [wt.HANDLE, wt.DWORD]
kernel32.WaitForSingleObject.restype = wt.DWORD
kernel32.GetExitCodeProcess.argtypes = [wt.HANDLE, ctypes.POINTER(wt.DWORD)]
kernel32.GetExitCodeProcess.restype = wt.BOOL
kernel32.ResumeThread.argtypes = [wt.HANDLE]
kernel32.ResumeThread.restype = wt.DWORD
kernel32.CloseHandle.argtypes = [wt.HANDLE]
kernel32.CloseHandle.restype = wt.BOOL

_PROFILE_CACHE: dict[str, tuple[ctypes.c_void_p, str, Path]] = {}
_NATIVE_LOCK = threading.RLock()


def ensure_profile(name: str) -> tuple[ctypes.c_void_p, str, Path]:
    with _NATIVE_LOCK:
        cached = _PROFILE_CACHE.get(name)
        if cached is not None:
            return cached
        sid = ctypes.c_void_p()
        created = userenv.CreateAppContainerProfile(
            name, name, name, None, 0, ctypes.byref(sid)
        )
        if created < 0:
            derived = userenv.DeriveAppContainerSidFromAppContainerName(
                name, ctypes.byref(sid)
            )
            if derived < 0:
                raise OSError(
                    f"CreateAppContainerProfile=0x{created & 0xFFFFFFFF:08X}; "
                    f"derive=0x{derived & 0xFFFFFFFF:08X}"
                )
        text_sid = wt.LPWSTR()
        if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(text_sid)):
            raise ctypes.WinError(ctypes.get_last_error())
        package_ac = Path(os.environ["LOCALAPPDATA"]) / "Packages" / name / "AC"
        package_ac.mkdir(parents=True, exist_ok=True)
        record = (sid, text_sid.value, package_ac.resolve())
        _PROFILE_CACHE[name] = record
        return record


def run_process(
    *,
    profile_name: str,
    workspace_root: Path,
    executable_relative: Path,
    args: tuple[str, ...],
    cwd_relative: Path,
    env: dict[str, str],
    timeout_seconds: float,
    memory_limit_bytes: int,
    process_limit: int,
    output_directory: Path,
) -> NativeResult:
    """Launch one zero-capability process, assigned to a Job before resume."""

    with _NATIVE_LOCK:
        profile_sid, text_sid, _package_root = ensure_profile(profile_name)
        drive = _map_workspace(workspace_root)
        try:
            mapped_root = Path(f"{drive}\\")
            mapped_executable = mapped_root / executable_relative
            mapped_cwd = mapped_root / cwd_relative
            mapped_env = dict(env)
            output_directory.mkdir(parents=True, exist_ok=True)
            (workspace_root / ".agent" / "tmp").mkdir(parents=True, exist_ok=True)
            stdout_path = output_directory / "stdout.bin"
            stderr_path = output_directory / "stderr.bin"
            return _create_process(
                profile_sid=profile_sid,
                text_sid=text_sid,
                drive=drive,
                executable=mapped_executable,
                args=args,
                cwd=mapped_cwd,
                env=mapped_env,
                timeout_seconds=timeout_seconds,
                memory_limit_bytes=memory_limit_bytes,
                process_limit=process_limit,
                stdout_path=stdout_path,
                stderr_path=stderr_path,
            )
        finally:
            subprocess.run(
                ["subst.exe", drive, "/D"],
                check=False,
                capture_output=True,
            )


def _map_workspace(root: Path) -> str:
    mask = kernel32.GetLogicalDrives()
    for letter in "ZYXWVUTSRQPONMLKJIHGFED":
        bit = 1 << (ord(letter) - ord("A"))
        if mask & bit:
            continue
        drive = f"{letter}:"
        result = subprocess.run(
            ["subst.exe", drive, str(root)],
            check=False,
            capture_output=True,
        )
        if result.returncode == 0:
            return drive
    raise OSError("No free drive letter is available for AppContainer execution")


def _environment_block(env: dict[str, str]) -> ctypes.Array:
    body = "\0".join(
        f"{key}={value}"
        for key, value in sorted(env.items(), key=lambda item: item[0].upper())
    )
    return ctypes.create_unicode_buffer(body + "\0\0")


def _create_process(
    *,
    profile_sid: ctypes.c_void_p,
    text_sid: str,
    drive: str,
    executable: Path,
    args: tuple[str, ...],
    cwd: Path,
    env: dict[str, str],
    timeout_seconds: float,
    memory_limit_bytes: int,
    process_limit: int,
    stdout_path: Path,
    stderr_path: Path,
) -> NativeResult:
    security = SecurityCapabilities(profile_sid, None, 0, 0)
    size = ctypes.c_size_t()
    kernel32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
    attribute_buffer = (ctypes.c_ubyte * size.value)()
    attribute_list = ctypes.cast(attribute_buffer, ctypes.c_void_p)
    if not kernel32.InitializeProcThreadAttributeList(
        attribute_list, 1, 0, ctypes.byref(size)
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    process = ProcessInformation()
    job = None
    fds: list[int] = []
    try:
        if not kernel32.UpdateProcThreadAttribute(
            attribute_list,
            0,
            ctypes.c_size_t(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES),
            ctypes.byref(security),
            ctypes.sizeof(security),
            None,
            None,
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        startup = StartupInfoEx()
        startup.StartupInfo.cb = ctypes.sizeof(StartupInfoEx)
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES
        startup.lpAttributeList = attribute_list
        import msvcrt

        for path, flags in (
            (Path(os.devnull), os.O_RDONLY | os.O_BINARY),
            (stdout_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_BINARY),
            (stderr_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_BINARY),
        ):
            fd = os.open(path, flags, 0o600)
            fds.append(fd)
            os.set_handle_inheritable(msvcrt.get_osfhandle(fd), True)
        startup.StartupInfo.hStdInput = msvcrt.get_osfhandle(fds[0])
        startup.StartupInfo.hStdOutput = msvcrt.get_osfhandle(fds[1])
        startup.StartupInfo.hStdError = msvcrt.get_osfhandle(fds[2])
        environment = _environment_block(env)
        command_line = subprocess.list2cmdline([str(executable), *args])
        flags = (
            EXTENDED_STARTUPINFO_PRESENT
            | CREATE_UNICODE_ENVIRONMENT
            | CREATE_SUSPENDED
        )
        if not kernel32.CreateProcessW(
            None,
            ctypes.create_unicode_buffer(command_line),
            None,
            None,
            True,
            flags,
            ctypes.cast(environment, ctypes.c_void_p),
            str(cwd),
            ctypes.byref(startup),
            ctypes.byref(process),
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        for fd in fds:
            os.close(fd)
        fds.clear()
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            kernel32.TerminateProcess(process.hProcess, 1)
            raise ctypes.WinError(ctypes.get_last_error())
        limits = JobExtendedLimitInformation()
        limits.BasicLimitInformation.LimitFlags = (
            JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_JOB_MEMORY
            | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        )
        limits.BasicLimitInformation.ActiveProcessLimit = process_limit
        limits.JobMemoryLimit = memory_limit_bytes
        if not kernel32.SetInformationJobObject(
            job,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            ctypes.byref(limits),
            ctypes.sizeof(limits),
        ):
            kernel32.TerminateProcess(process.hProcess, 1)
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel32.AssignProcessToJobObject(job, process.hProcess):
            kernel32.TerminateProcess(process.hProcess, 1)
            raise ctypes.WinError(ctypes.get_last_error())
        if kernel32.ResumeThread(process.hThread) == 0xFFFFFFFF:
            kernel32.TerminateJobObject(job, 1)
            raise ctypes.WinError(ctypes.get_last_error())
        kernel32.CloseHandle(process.hThread)
        process.hThread = None
        waited = kernel32.WaitForSingleObject(
            process.hProcess, max(1, int(timeout_seconds * 1000))
        )
        timed_out = waited == WAIT_TIMEOUT
        if timed_out:
            kernel32.TerminateJobObject(job, 124)
            kernel32.WaitForSingleObject(process.hProcess, 5_000)
            exit_code = None
        else:
            code = wt.DWORD()
            if not kernel32.GetExitCodeProcess(process.hProcess, ctypes.byref(code)):
                raise ctypes.WinError(ctypes.get_last_error())
            exit_code = int(code.value)
        return NativeResult(
            exit_code,
            timed_out,
            stdout_path,
            stderr_path,
            text_sid,
            drive,
        )
    finally:
        for fd in fds:
            os.close(fd)
        if process.hThread:
            kernel32.CloseHandle(process.hThread)
        if process.hProcess:
            kernel32.CloseHandle(process.hProcess)
        if job:
            kernel32.CloseHandle(job)
        if attribute_list:
            kernel32.DeleteProcThreadAttributeList(attribute_list)
