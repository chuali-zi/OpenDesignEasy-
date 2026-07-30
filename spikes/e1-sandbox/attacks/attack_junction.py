"""Attack: create a Windows junction (mklink /J) inside the workspace that
points outside it, then read through the junction. Simulates a malicious
agent trying to defeat a prefix-based path check by creating a reparse
point whose *logical* path is inside the root but whose *physical* target
is not.
"""
import subprocess
import sys
from pathlib import Path

target_dir = sys.argv[1] if len(sys.argv) > 1 else str(Path.home())
junc_name = "escape_junction"

r = subprocess.run(
    ["cmd", "/c", "mklink", "/J", junc_name, target_dir],
    capture_output=True, text=True,
)
if r.returncode != 0:
    print(f"BLOCKED: could not create junction: {r.stderr or r.stdout}")
    sys.exit(1)

try:
    entries = list(Path(junc_name).iterdir())
    print(f"ESCAPED: junction created, listed {len(entries)} entries in {target_dir}")
    print(f"SAMPLE: {[e.name for e in entries[:5]]}")
    sys.exit(0)
except OSError as e:
    print(f"PARTIAL: junction created but traversal blocked: {e}")
    sys.exit(1)
finally:
    subprocess.run(["cmd", "/c", "rmdir", junc_name], capture_output=True)
