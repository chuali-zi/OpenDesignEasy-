"""Attack: allocate memory well past a configured Job Object cap, to test
whether ProcessMemoryLimit/JobMemoryLimit actually terminates the process
(Windows Job Object memory limits work by failing the allocation / killing
the process on commit-limit breach, not by throttling)."""
import sys

MB = 1024 * 1024
chunks = []
try:
    for i in range(4096):  # up to ~4 GB if unchecked
        chunks.append(bytearray(MB))
        if i % 100 == 0:
            print(f"allocated {i} MB", flush=True)
    print("ESCAPED: allocated full 4096 MB without being killed")
    sys.exit(0)
except MemoryError:
    print(f"SELF_LIMITED: MemoryError after {len(chunks)} MB (Python-level, not job object)")
    sys.exit(1)
