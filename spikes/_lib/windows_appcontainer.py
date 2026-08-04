"""Small Windows AppContainer + Job Object harness shared by engine spikes.

Run this module with Windows Python.  It deliberately exposes only the pieces
needed by E5/E13: profile creation, optional capability SIDs, a clean child
environment, process-tree lifetime control, and temporary loopback exemption.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
from dataclasses import dataclass
from pathlib import Path


if os.name != "nt":
    raise RuntimeError("windows_appcontainer must run with Windows Python")


kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
userenv = ctypes.WinDLL("userenv", use_last_error=True)
advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

CREATE_SUSPENDED = 0x00000004
CREATE_UNICODE_ENVIRONMENT = 0x00000400
EXTENDED_STARTUPINFO_PRESENT = 0x00080000
PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009
WAIT_TIMEOUT = 0x00000102
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
SE_GROUP_ENABLED = 0x00000004

# WELL_KNOWN_SID_TYPE values from WinNT.h.
CAPABILITY_SID_TYPES = {
    "internetClient": 85,
    "internetClientServer": 86,
    "privateNetworkClientServer": 87,
}

ENV_ALLOWLIST = (
    "COMSPEC",
    "LOCALAPPDATA",
    "OS",
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "WINDIR",
)


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
    _fields_ = [(name, ctypes.c_uint64) for name in (
        "ReadOperationCount",
        "WriteOperationCount",
        "OtherOperationCount",
        "ReadTransferCount",
        "WriteTransferCount",
        "OtherTransferCount",
    )]


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
kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wt.LPCWSTR]
kernel32.CreateJobObjectW.restype = wt.HANDLE
kernel32.SetInformationJobObject.argtypes = [wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD]
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
advapi32.CreateWellKnownSid.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(wt.DWORD)]
advapi32.CreateWellKnownSid.restype = wt.BOOL


def appcontainer_profile(name: str) -> tuple[ctypes.c_void_p, str, Path]:
    sid = ctypes.c_void_p()
    hr = userenv.CreateAppContainerProfile(name, name, name, None, 0, ctypes.byref(sid))
    if hr < 0:
        derived = userenv.DeriveAppContainerSidFromAppContainerName(name, ctypes.byref(sid))
        if derived < 0:
            raise OSError(
                f"CreateAppContainerProfile=0x{hr & 0xFFFFFFFF:08X}; "
                f"derive=0x{derived & 0xFFFFFFFF:08X}"
            )
    text_sid = wt.LPWSTR()
    if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(text_sid)):
        raise ctypes.WinError(ctypes.get_last_error())
    package_ac = Path(os.environ["LOCALAPPDATA"]) / "Packages" / name / "AC"
    package_ac.mkdir(parents=True, exist_ok=True)
    return sid, text_sid.value, package_ac


def clean_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = {key: os.environ[key] for key in ENV_ALLOWLIST if key in os.environ}
    env["PYTHONIOENCODING"] = "utf-8"
    if extra:
        env.update(extra)
    return env


def _environment_block(env: dict[str, str]):
    body = "\0".join(f"{key}={value}" for key, value in sorted(env.items(), key=lambda item: item[0].upper()))
    return ctypes.create_unicode_buffer(body + "\0\0")


def _capability_sid(name: str):
    sid_type = CAPABILITY_SID_TYPES[name]
    size = wt.DWORD(0)
    advapi32.CreateWellKnownSid(sid_type, None, None, ctypes.byref(size))
    buffer = (ctypes.c_ubyte * size.value)()
    if not advapi32.CreateWellKnownSid(sid_type, None, ctypes.byref(buffer), ctypes.byref(size)):
        raise ctypes.WinError(ctypes.get_last_error())
    return buffer, ctypes.cast(buffer, ctypes.c_void_p)


@dataclass
class AppContainerProcess:
    process_handle: int
    job_handle: int
    pid: int
    attribute_list: ctypes.c_void_p
    _attribute_buffer: object
    _capability_buffers: list[object]
    _capability_array: object | None
    _environment_buffer: object
    _closed: bool = False

    def wait(self, timeout_s: float) -> int | None:
        waited = kernel32.WaitForSingleObject(self.process_handle, int(timeout_s * 1000))
        if waited == WAIT_TIMEOUT:
            return None
        code = wt.DWORD()
        if not kernel32.GetExitCodeProcess(self.process_handle, ctypes.byref(code)):
            raise ctypes.WinError(ctypes.get_last_error())
        return code.value

    def terminate(self, exit_code: int = 1) -> None:
        if self.job_handle:
            kernel32.TerminateJobObject(self.job_handle, exit_code)

    def close(self) -> None:
        if self._closed:
            return
        self.terminate()
        if self.process_handle:
            kernel32.CloseHandle(self.process_handle)
        if self.job_handle:
            kernel32.CloseHandle(self.job_handle)
        if self.attribute_list:
            kernel32.DeleteProcThreadAttributeList(self.attribute_list)
        self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def start_process(
    command: str,
    profile_sid,
    cwd: Path,
    *,
    capabilities: tuple[str, ...] = (),
    env: dict[str, str] | None = None,
    memory_limit_bytes: int = 512 * 1024 * 1024,
) -> AppContainerProcess:
    capability_buffers: list[object] = []
    sid_values: list[ctypes.c_void_p] = []
    for name in capabilities:
        buffer, sid = _capability_sid(name)
        capability_buffers.append(buffer)
        sid_values.append(sid)
    capability_array = None
    capability_pointer = None
    if sid_values:
        array_type = SidAndAttributes * len(sid_values)
        capability_array = array_type(*[SidAndAttributes(sid, SE_GROUP_ENABLED) for sid in sid_values])
        capability_pointer = ctypes.cast(capability_array, ctypes.POINTER(SidAndAttributes))
    security = SecurityCapabilities(
        profile_sid,
        capability_pointer,
        len(sid_values),
        0,
    )

    size = ctypes.c_size_t()
    kernel32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
    attribute_buffer = (ctypes.c_ubyte * size.value)()
    attribute_list = ctypes.cast(attribute_buffer, ctypes.c_void_p)
    if not kernel32.InitializeProcThreadAttributeList(attribute_list, 1, 0, ctypes.byref(size)):
        raise ctypes.WinError(ctypes.get_last_error())
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
    startup.lpAttributeList = attribute_list
    process = ProcessInformation()
    environment = _environment_block(env or clean_env())
    flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED
    ok = kernel32.CreateProcessW(
        None,
        ctypes.create_unicode_buffer(command),
        None,
        None,
        False,
        flags,
        ctypes.cast(environment, ctypes.c_void_p),
        str(cwd),
        ctypes.byref(startup),
        ctypes.byref(process),
    )
    if not ok:
        kernel32.DeleteProcThreadAttributeList(attribute_list)
        raise ctypes.WinError(ctypes.get_last_error())

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
    limits.BasicLimitInformation.ActiveProcessLimit = 32
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
    return AppContainerProcess(
        process.hProcess,
        job,
        process.dwProcessId,
        attribute_list,
        attribute_buffer,
        capability_buffers,
        capability_array,
        environment,
    )
