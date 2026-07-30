"""Attack: UNC path access, e.g. \\localhost\C$\... or a network share."""
import sys
from pathlib import Path

# \\localhost\C$ maps to C:\ via the administrative share (may be blocked by
# permissions/SMB signing rather than by the sandbox itself -- that's a
# useful distinction to capture).
target = sys.argv[1] if len(sys.argv) > 1 else r"\\localhost\C$\Windows\win.ini"
try:
    data = Path(target).read_text(encoding="utf-8", errors="replace")
    print(f"ESCAPED: read {len(data)} bytes from {target}")
    sys.exit(0)
except OSError as e:
    print(f"BLOCKED: {e}")
    sys.exit(1)
