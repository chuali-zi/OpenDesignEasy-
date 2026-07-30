"""Attack: outbound network access via urllib (stdlib, no proxy cooperation
required by the caller -- i.e. this simulates code that does NOT politely
respect HTTP_PROXY/HTTPS_PROXY, which is the realistic threat model for
untrusted/generated code)."""
import socket
import sys
import urllib.request

url = sys.argv[1] if len(sys.argv) > 1 else "http://example.com"

# First: raw TCP connect, bypasses any urllib-level proxy handling entirely.
try:
    s = socket.create_connection(("example.com", 80), timeout=5)
    s.close()
    print("ESCAPED(socket): raw TCP connect to example.com:80 succeeded")
except OSError as e:
    print(f"BLOCKED(socket): {e}")

# Second: urllib.request, which *does* respect HTTP_PROXY/HTTPS_PROXY env
# vars by default -- useful to know whether proxy-env mitigation matters at
# all for this specific call path.
try:
    with urllib.request.urlopen(url, timeout=5) as resp:
        body = resp.read(200)
    print(f"ESCAPED(urllib): fetched {len(body)} bytes from {url}")
    sys.exit(0)
except Exception as e:
    print(f"BLOCKED(urllib): {e}")
    sys.exit(1)
