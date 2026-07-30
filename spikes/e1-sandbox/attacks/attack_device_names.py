"""Attack: reserved Windows device names (CON, PRN, AUX, NUL, COM1, LPT1).

These aren't a confidentiality escape by themselves, but they are a known
class of Windows-specific footguns: a naive path-prefix sandbox check might
see "workspace/CON" as "inside the root" (string-wise) while the OS resolves
it to a device, not a file -- potential for hangs (CON blocks on console
input) or crashes in the parent if it isn't ready for a device object where
it expected a regular file.
"""
import sys
from pathlib import Path

names = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"]
results = {}
for name in names:
    p = Path(name)
    try:
        # NUL is the interesting one: writes succeed and vanish silently.
        with open(p, "w", encoding="utf-8") as f:
            f.write("probe")
        results[name] = "OPENED_FOR_WRITE"
    except OSError as e:
        results[name] = f"BLOCKED: {e}"

for name, res in results.items():
    print(f"{name}: {res}")

# Exit 0 always -- this attack is informational, not a binary escape/block.
sys.exit(0)
