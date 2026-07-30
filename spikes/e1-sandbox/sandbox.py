"""Candidate Windows sandbox: pure Python stdlib + ctypes + subprocess.

Scope (per agent-engine-spec.md §8):
  - file root confinement
  - network blocked by default
  - process count / lifetime bounded, tree killable
  - wall-clock time limit
  - memory limit + output truncation
  - credentials never entering child env

This module intentionally does NOT try to be clever. It is a *candidate* --
the attack scripts in attacks/ are what actually prove or disprove each
claim. Read RESULT.md for the verdict, not this file's docstring.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import sys
import time
import threading
from dataclasses import dataclass, field
from pathlib import Path

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

# ---------------------------------------------------------------------------
# Job Object plumbing (time / memory / process-tree kill)
# ---------------------------------------------------------------------------

JobObjectExtendedLimitInformation = 9
JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
JOB_OBJECT_LIMIT_PROCESS_TIME = 0x00000002


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", ctypes.c_uint64),
        ("WriteOperationCount", ctypes.c_uint64),
        ("OtherOperationCount", ctypes.c_uint64),
        ("ReadTransferCount", ctypes.c_uint64),
        ("WriteTransferCount", ctypes.c_uint64),
        ("OtherTransferCount", ctypes.c_uint64),
    ]


class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
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


class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


kernel32.CreateJobObjectW.restype = wt.HANDLE
kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wt.LPCWSTR]
kernel32.SetInformationJobObject.restype = wt.BOOL
kernel32.SetInformationJobObject.argtypes = [
    wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD,
]
kernel32.AssignProcessToJobObject.restype = wt.BOOL
kernel32.AssignProcessToJobObject.argtypes = [wt.HANDLE, wt.HANDLE]
kernel32.TerminateJobObject.restype = wt.BOOL
kernel32.TerminateJobObject.argtypes = [wt.HANDLE, wt.UINT]
kernel32.CloseHandle.argtypes = [wt.HANDLE]


class JobObject:
    """Windows Job Object wrapper: process-tree kill + memory cap."""

    def __init__(self, memory_limit_bytes: int | None = None, kill_on_close: bool = True):
        self.handle = kernel32.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        flags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        if kill_on_close:
            flags |= JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        info.BasicLimitInformation.ActiveProcessLimit = 64  # generous cap, not 1
        if memory_limit_bytes:
            flags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY
            info.ProcessMemoryLimit = memory_limit_bytes
            info.JobMemoryLimit = memory_limit_bytes
        info.BasicLimitInformation.LimitFlags = flags

        ok = kernel32.SetInformationJobObject(
            self.handle,
            JobObjectExtendedLimitInformation,
            ctypes.byref(info),
            ctypes.sizeof(info),
        )
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())

    def assign(self, process_handle: int) -> bool:
        return bool(kernel32.AssignProcessToJobObject(self.handle, wt.HANDLE(process_handle)))

    def terminate(self, exit_code: int = 1) -> bool:
        return bool(kernel32.TerminateJobObject(self.handle, exit_code))

    def close(self):
        if self.handle:
            kernel32.CloseHandle(self.handle)
            self.handle = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


# ---------------------------------------------------------------------------
# Credential-stripped environment
# ---------------------------------------------------------------------------

CREDENTIAL_KEY_MARKERS = ("API_KEY", "BASE_URL", "SECRET", "TOKEN", "PASSWORD", "CREDENTIAL")

# Minimal allowlist a child needs to run Python at all.
ENV_ALLOWLIST = ("SYSTEMROOT", "PATH", "PATHEXT", "TEMP", "TMP", "OS", "COMSPEC")


def build_clean_env(extra: dict | None = None) -> dict:
    """Construct a child environment from scratch -- never os.environ.copy()."""
    env = {}
    for key in ENV_ALLOWLIST:
        val = os.environ.get(key)
        if val is not None:
            env[key] = val
    # Force UTF-8 child I/O per spikes/README known constraint.
    env["PYTHONIOENCODING"] = "utf-8"
    if extra:
        for k, v in extra.items():
            env[k] = v
    # Defensive: refuse to let any credential-shaped key slip in via `extra`.
    leaked = [k for k in env if any(m in k.upper() for m in CREDENTIAL_KEY_MARKERS)]
    if leaked:
        raise ValueError(f"refusing to build child env: credential-shaped keys present: {leaked}")
    return env


# ---------------------------------------------------------------------------
# Output capture with truncation (avoid unbounded pipe buffering in parent)
# ---------------------------------------------------------------------------


@dataclass
class CapturedOutput:
    data: bytearray = field(default_factory=bytearray)
    truncated: bool = False
    limit: int = 1_000_000  # 1 MB default cap

    def feed(self, chunk: bytes):
        if self.truncated:
            return
        remaining = self.limit - len(self.data)
        if remaining <= 0:
            self.truncated = True
            return
        self.data.extend(chunk[:remaining])
        if len(chunk) > remaining:
            self.truncated = True

    def text(self) -> str:
        return self.data.decode("utf-8", errors="replace")


def _pump(stream, out: CapturedOutput, stop_evt: threading.Event):
    """Read a pipe in a background thread, feeding a bounded buffer.

    Keeps reading (and discarding past the cap) so the child never blocks on
    a full pipe buffer -- a flood attack must not be able to deadlock the
    parent, it should just get truncated.
    """
    try:
        while True:
            chunk = stream.read(65536)
            if not chunk:
                break
            out.feed(chunk)
    except (ValueError, OSError):
        pass
    finally:
        stop_evt.set()


# ---------------------------------------------------------------------------
# Path confinement check (harness-side convention, NOT an OS boundary)
# ---------------------------------------------------------------------------


def is_path_confined(candidate: str, root: Path) -> bool:
    """Best-effort check that `candidate` resolves inside `root`.

    IMPORTANT: this is a courtesy check the *harness* can apply to arguments
    IT constructs (e.g. a tool call payload naming a file to write). It is
    NOT an OS-level enforcement and provides ZERO protection against
    arbitrary code the child process chooses to execute -- arbitrary code
    just calls open() directly and this function is never in the path.
    See RESULT.md attack table for the empirical proof.
    """
    root = root.resolve()
    try:
        resolved = Path(candidate).resolve(strict=False)
    except (OSError, ValueError):
        return False
    try:
        resolved.relative_to(root)
        return True
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Sandbox run result + runner
# ---------------------------------------------------------------------------


@dataclass
class SandboxResult:
    returncode: int | None
    timed_out: bool
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool
    elapsed_s: float
    job_terminated: bool = False


def run_sandboxed(
    args: list[str],
    cwd: Path,
    timeout_s: float = 10.0,
    memory_limit_bytes: int | None = 256 * 1024 * 1024,
    extra_env: dict | None = None,
    output_limit: int = 1_000_000,
) -> SandboxResult:
    """Run a child process under a Job Object with time/memory/env limits.

    This is the "hardened" candidate: Job Object for process-tree kill +
    memory cap, clean env for credential isolation, bounded output capture.
    It does NOT confine the filesystem or the network -- see RESULT.md.
    """
    env = build_clean_env(extra_env)
    start = time.monotonic()

    proc = subprocess.Popen(
        args,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )

    job = JobObject(memory_limit_bytes=memory_limit_bytes)
    assigned = job.assign(proc._handle)

    out = CapturedOutput(limit=output_limit)
    err = CapturedOutput(limit=output_limit)
    stop_out, stop_err = threading.Event(), threading.Event()
    t_out = threading.Thread(target=_pump, args=(proc.stdout, out, stop_out), daemon=True)
    t_err = threading.Thread(target=_pump, args=(proc.stderr, err, stop_err), daemon=True)
    t_out.start()
    t_err.start()

    timed_out = False
    job_terminated = False
    try:
        proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        timed_out = True
        # Kill the whole tree via the Job Object -- this is the point of
        # using a Job Object instead of proc.kill(): grandchildren die too.
        if assigned:
            job_terminated = job.terminate()
        else:
            # Fallback path if job assignment failed for some reason.
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                capture_output=True,
            )
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

    t_out.join(timeout=2)
    t_err.join(timeout=2)
    job.close()

    elapsed = time.monotonic() - start
    return SandboxResult(
        returncode=proc.returncode,
        timed_out=timed_out,
        stdout=out.text(),
        stderr=err.text(),
        stdout_truncated=out.truncated,
        stderr_truncated=err.truncated,
        elapsed_s=elapsed,
        job_terminated=job_terminated,
    )


if __name__ == "__main__":
    # Smoke test.
    ws = Path(__file__).parent / "workspace"
    ws.mkdir(exist_ok=True)
    r = run_sandboxed([sys.executable, "-c", "print('hello from sandbox')"], cwd=ws, timeout_s=5)
    print(r)
