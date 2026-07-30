"""Attack: spawn a detached grandchild that outlives the direct child, to
test whether the sandbox's timeout kill actually reaps the whole process
tree (Job Object) or just the immediate child (naive proc.kill()).

The grandchild writes an incrementing heartbeat to a marker file every
0.5s. The orchestrator kills the *parent* (this script) after a short
timeout, then watches the marker file: if the counter keeps climbing after
the kill, the grandchild survived -- proof the tree was not fully reaped.
"""
import subprocess
import sys
import time

marker = sys.argv[1] if len(sys.argv) > 1 else "grandchild_marker.txt"

heartbeat_code = (
    "import time\n"
    f"p = r'{marker}'\n"
    "i = 0\n"
    "while i < 240:\n"
    "    with open(p, 'w', encoding='utf-8') as f:\n"
    "        f.write(str(i))\n"
    "    time.sleep(0.5)\n"
    "    i += 1\n"
)

subprocess.Popen(
    [sys.executable, "-c", heartbeat_code],
    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
)
print("grandchild spawned, parent now sleeping")
time.sleep(120)
