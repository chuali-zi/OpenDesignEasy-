"""Attack: check whether the child process's environment carries any
credential-shaped variable (API_KEY, BASE_URL, SECRET, TOKEN, PASSWORD).
Does NOT print any value found -- only reports which key names leaked, per
the instruction to never print API keys."""
import os
import sys

MARKERS = ("API_KEY", "BASE_URL", "SECRET", "TOKEN", "PASSWORD", "CREDENTIAL")
leaked = [k for k in os.environ if any(m in k.upper() for m in MARKERS)]
if leaked:
    print(f"ESCAPED: credential-shaped env keys present: {leaked}")
    sys.exit(0)
else:
    print(f"BLOCKED: no credential-shaped env keys found (total env keys: {len(os.environ)})")
    sys.exit(1)
