"""Orchestrator: run the full E1 attack matrix and record empirical results.

Runs each attack under:
  - "naive"    : plain subprocess.run(cwd=workspace), no protections beyond
                 the child's cwd. This is the baseline "did anyone even try"
                 mode.
  - "hardened" : sandbox.run_sandboxed() -- Job Object (time/memory/tree
                 kill) + clean env (no credential leak) + bounded output
                 capture. Does NOT add filesystem or network confinement;
                 that's the point of separating results by attack class.

Writes spikes/e1-sandbox/attack_results.json (raw data) and prints a
markdown table to stdout for pasting into RESULT.md.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import sandbox  # noqa: E402

HERE = Path(__file__).parent
WORKSPACE = HERE / "workspace"
ATTACKS = HERE / "attacks"
OUTSIDE_SECRET = HERE / "outside_secret" / "credentials.txt"
PY = sys.executable

WORKSPACE.mkdir(exist_ok=True)

results: list[dict] = []


def record(name: str, mode: str, outcome: str, detail: str, extra: dict | None = None):
    row = {"attack": name, "mode": mode, "outcome": outcome, "detail": detail}
    if extra:
        row.update(extra)
    results.append(row)
    print(f"[{outcome:9s}] {name:28s} ({mode:9s}) {detail}")


def naive_run(args, cwd, timeout=10, env=None):
    e = os.environ.copy()
    if env:
        e.update(env)
    try:
        r = subprocess.run(
            args, cwd=str(cwd), env=e, capture_output=True, text=True,
            timeout=timeout, errors="replace",
        )
        return r.returncode, r.stdout, r.stderr, False
    except subprocess.TimeoutExpired as ex:
        return None, ex.stdout or "", ex.stderr or "", True


# ---------------------------------------------------------------------------
# 1. File root escape attacks
# ---------------------------------------------------------------------------

file_attacks = [
    ("dotdot_relative", "attack_dotdot.py", [str(Path("..") / "outside_secret" / "credentials.txt")]),
    ("absolute_path", "attack_absolute.py", [str(OUTSIDE_SECRET)]),
    ("absolute_windir", "attack_absolute.py", [r"C:\Windows\win.ini"]),
    ("junction_escape", "attack_junction.py", [str(Path.home())]),
    ("unc_admin_share", "attack_unc.py", [r"\\localhost\C$\Windows\win.ini"]),
    ("extended_length_prefix", "attack_extended_prefix.py", [r"\\?\C:\Windows\win.ini"]),
]

for name, script, extra_args in file_attacks:
    args = [PY, str(ATTACKS / script)] + extra_args
    # naive: cwd-only confinement
    rc, out, err, timed_out = naive_run(args, cwd=WORKSPACE, timeout=10)
    outcome = "ESCAPED" if (rc == 0) else ("BLOCKED" if rc == 1 else "ERROR")
    record(name, "naive", outcome, (out.strip() or err.strip())[:150])

    # hardened: JobObject + clean env, same cwd confinement, NO extra FS guard
    r = sandbox.run_sandboxed(args, cwd=WORKSPACE, timeout_s=10)
    outcome = "ESCAPED" if (r.returncode == 0) else ("BLOCKED" if r.returncode == 1 else "ERROR")
    record(name, "hardened", outcome, (r.stdout.strip() or r.stderr.strip())[:150])

# device names: informational, not escape/block binary
args = [PY, str(ATTACKS / "attack_device_names.py")]
rc, out, err, _ = naive_run(args, cwd=WORKSPACE, timeout=10)
record("device_names", "naive", "INFO", out.strip().replace("\n", " | ")[:300])

# ---------------------------------------------------------------------------
# 2. Network attacks
# ---------------------------------------------------------------------------

net_args = [PY, str(ATTACKS / "attack_network.py"), "http://example.com"]

rc, out, err, _ = naive_run(net_args, cwd=WORKSPACE, timeout=10)
outcome = "ESCAPED" if "ESCAPED" in out else "BLOCKED"
record("network_no_mitigation", "naive", outcome, out.strip().replace("\n", " | ")[:300])

# Proxy-env mitigation attempt: point HTTP(S)_PROXY at an unreachable local
# port. Tests whether this blocks (a) urllib (proxy-aware) and (b) raw
# sockets (proxy-unaware -- the realistic threat model for generated code).
rc, out, err, _ = naive_run(
    net_args, cwd=WORKSPACE, timeout=10,
    env={"HTTP_PROXY": "http://127.0.0.1:1", "HTTPS_PROXY": "http://127.0.0.1:1",
         "http_proxy": "http://127.0.0.1:1", "https_proxy": "http://127.0.0.1:1"},
)
record("network_proxy_env_mitigation", "naive+proxyenv", "INFO", out.strip().replace("\n", " | ")[:300])

# Firewall rule creation without elevation (expected to fail -- confirms the
# admin-rights requirement empirically rather than by assertion).
fw = subprocess.run(
    ["netsh", "advfirewall", "firewall", "add", "rule",
     "name=e1_spike_probe_delete_me", "dir=out", "action=block",
     f'program="{PY}"', "enable=yes"],
    capture_output=True, text=True,
)
fw_outcome = "BLOCKED_NEEDS_ADMIN" if fw.returncode != 0 else "SUCCEEDED"
record("firewall_rule_without_admin", "naive", fw_outcome, (fw.stdout + fw.stderr).strip()[:200])
if fw.returncode == 0:
    subprocess.run(["netsh", "advfirewall", "firewall", "delete", "rule",
                     "name=e1_spike_probe_delete_me"], capture_output=True)

# ---------------------------------------------------------------------------
# 3. Timeout / process-tree kill
# ---------------------------------------------------------------------------

marker_naive = WORKSPACE / "marker_naive.txt"
marker_hard = WORKSPACE / "marker_hard.txt"
for p in (marker_naive, marker_hard):
    if p.exists():
        p.unlink()

# naive: proc.kill() only kills the immediate child, not the tree.
gargs_naive = [PY, str(ATTACKS / "attack_grandchild_sleep.py"), str(marker_naive)]
proc = subprocess.Popen(gargs_naive, cwd=str(WORKSPACE), env=os.environ.copy(),
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    proc.wait(timeout=2)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait(timeout=5)
time.sleep(1)
val1 = marker_naive.read_text() if marker_naive.exists() else None
time.sleep(2)
val2 = marker_naive.read_text() if marker_naive.exists() else None
still_running = val1 is not None and val2 is not None and int(val2) > int(val1)
record("timeout_grandchild_kill", "naive",
       "GRANDCHILD_SURVIVED" if still_running else "GRANDCHILD_REAPED",
       f"heartbeat before={val1!r} after={val2!r}")

# hardened: Job Object terminate kills the whole tree.
gargs_hard = [PY, str(ATTACKS / "attack_grandchild_sleep.py"), str(marker_hard)]
r = sandbox.run_sandboxed(gargs_hard, cwd=WORKSPACE, timeout_s=2)
time.sleep(1)
val1 = marker_hard.read_text() if marker_hard.exists() else None
time.sleep(2)
val2 = marker_hard.read_text() if marker_hard.exists() else None
still_running = val1 is not None and val2 is not None and int(val2) > int(val1)
record("timeout_grandchild_kill", "hardened",
       "GRANDCHILD_SURVIVED" if still_running else "GRANDCHILD_REAPED",
       f"timed_out={r.timed_out} job_terminated={r.job_terminated} heartbeat before={val1!r} after={val2!r}")

# ---------------------------------------------------------------------------
# 4. Memory limit
# ---------------------------------------------------------------------------

mem_args = [PY, str(ATTACKS / "attack_memory.py")]

rc, out, err, timed_out = naive_run(mem_args, cwd=WORKSPACE, timeout=25)
lines = [l for l in out.strip().splitlines() if l]
outcome = "ESCAPED_NO_LIMIT" if (lines and "ESCAPED" in lines[-1]) else "PROCESS_LIMITED"
record("memory_limit", "naive_no_cap", outcome, (lines[-1] if lines else "")[:150])

r = sandbox.run_sandboxed(mem_args, cwd=WORKSPACE, timeout_s=25, memory_limit_bytes=100 * 1024 * 1024)
out_lines = [l for l in r.stdout.strip().splitlines() if l]
last_alloc = out_lines[-1] if out_lines else "(no output before kill)"
outcome = "JOB_KILLED" if (r.returncode not in (0,) or r.timed_out) else "NOT_LIMITED"
record("memory_limit", "hardened_100MB_cap", outcome,
       f"returncode={r.returncode} timed_out={r.timed_out} last_line={last_alloc!r}")

# ---------------------------------------------------------------------------
# 5. Output flood / truncation
# ---------------------------------------------------------------------------

flood_args = [PY, str(ATTACKS / "attack_stdout_flood.py")]

t0 = time.monotonic()
rc, out, err, timed_out = naive_run(flood_args, cwd=WORKSPACE, timeout=30)
t1 = time.monotonic()
record("output_flood", "naive_uncapped", "COMPLETED" if not timed_out else "TIMED_OUT",
       f"captured {len(out)} bytes in {t1 - t0:.2f}s (no cap applied)")

r = sandbox.run_sandboxed(flood_args, cwd=WORKSPACE, timeout_s=30, output_limit=1_000_000)
record("output_flood", "hardened_1MB_cap",
       "TRUNCATED" if r.stdout_truncated else "NOT_TRUNCATED",
       f"captured {len(r.stdout)} bytes, truncated={r.stdout_truncated}, elapsed={r.elapsed_s:.2f}s, "
       f"child_returncode={r.returncode}")

# ---------------------------------------------------------------------------
# 6. Credential isolation
# ---------------------------------------------------------------------------

cred_args = [PY, str(ATTACKS / "attack_credential_read.py")]
FAKE_KEY = "sk-fake-not-a-real-credential-0000000000"  # never the real .env value

rc, out, err, _ = naive_run(cred_args, cwd=WORKSPACE, timeout=10, env={"API_KEY": FAKE_KEY})
outcome = "LEAKED" if rc == 0 else "NOT_LEAKED"
record("credential_isolation", "naive_env_copy_plus_key", outcome, out.strip()[:200])

r = sandbox.run_sandboxed(cred_args, cwd=WORKSPACE, timeout_s=10, extra_env=None)
# sanity: build_clean_env must never see FAKE_KEY unless we pass it in extra_env
outcome = "LEAKED" if r.returncode == 0 else "NOT_LEAKED"
record("credential_isolation", "hardened_clean_env", outcome, r.stdout.strip()[:200])

# ---------------------------------------------------------------------------
# Write results
# ---------------------------------------------------------------------------

out_path = HERE / "attack_results.json"
out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
print(f"\nWrote {len(results)} result rows to {out_path}")
