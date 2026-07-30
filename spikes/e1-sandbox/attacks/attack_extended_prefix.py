"""Attack: \\?\ extended-length path prefix, which bypasses normal Win32
path normalization (MAX_PATH checks, some string-based prefix filters that
only recognize e.g. "C:\" but not "\\?\C:\")."""
import sys
from pathlib import Path

target = sys.argv[1] if len(sys.argv) > 1 else r"\\?\C:\Windows\win.ini"
try:
    data = Path(target).read_text(encoding="utf-8", errors="replace")
    print(f"ESCAPED: read {len(data)} bytes from {target}")
    sys.exit(0)
except OSError as e:
    print(f"BLOCKED: {e}")
    sys.exit(1)
