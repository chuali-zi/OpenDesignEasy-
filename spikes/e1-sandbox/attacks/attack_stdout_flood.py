"""Attack: flood stdout with far more data than the parent's output cap, to
test whether the parent's capture is truncated safely (without deadlocking
on a full OS pipe buffer, and without ballooning parent memory)."""
import sys

line = "A" * 1000 + "\n"
# 50,000 lines * 1001 bytes ~= 50 MB, comfortably over any sane 1MB cap.
for _ in range(50_000):
    sys.stdout.write(line)
sys.stdout.flush()
print("FLOOD_COMPLETE", file=sys.stderr)
