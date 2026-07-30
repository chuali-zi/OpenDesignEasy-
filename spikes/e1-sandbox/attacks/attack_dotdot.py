"""Attack: relative path traversal via ../../ to read a file outside workspace."""
import sys
from pathlib import Path

target = sys.argv[1] if len(sys.argv) > 1 else r"..\..\secret\credentials.txt"
try:
    data = Path(target).read_text(encoding="utf-8", errors="replace")
    print(f"ESCAPED: read {len(data)} bytes from {target}")
    print(f"CONTENT_PREFIX: {data[:80]!r}")
    sys.exit(0)
except OSError as e:
    print(f"BLOCKED: {e}")
    sys.exit(1)
