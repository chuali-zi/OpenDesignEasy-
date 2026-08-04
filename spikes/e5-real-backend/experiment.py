"""E5: launch and exercise a real backend inside AppContainer + Job Object."""
from __future__ import annotations

import json
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "spikes" / "_lib"))

from windows_appcontainer import appcontainer_profile, clean_env, start_process


PROFILE = "OEYdesignE5BackendSpike"
RESULT = HERE / "result.json"
EXPERIMENT_KEY = "e5-not-a-secret"


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def request(url: str, body: bytes | None = None) -> dict:
    req = urllib.request.Request(url, data=body, method="POST" if body is not None else "GET")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def read_http_message(stream) -> bytes:
    data = bytearray()
    while b"\r\n\r\n" not in data:
        chunk = stream.read(1)
        if not chunk:
            break
        data.extend(chunk)
    headers, _, initial = bytes(data).partition(b"\r\n\r\n")
    length = 0
    for line in headers.split(b"\r\n"):
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":", 1)[1].strip())
    body = bytearray(initial)
    while len(body) < length:
        chunk = stream.read(length - len(body))
        if not chunk:
            break
        body.extend(chunk)
    return headers + b"\r\n\r\n" + bytes(body)


class SpoolBroker(socketserver.ThreadingTCPServer):
    allow_reuse_address = False

    def __init__(self, address, queue: Path):
        self.queue = queue

        class Handler(socketserver.StreamRequestHandler):
            def handle(handler_self):
                incoming = read_http_message(handler_self.rfile)
                request_id = f"{time.time_ns()}-{threading.get_ident()}"
                request_path = self.queue / f"{request_id}.req"
                temporary_path = self.queue / f"{request_id}.req.tmp"
                response_path = self.queue / f"{request_id}.resp"
                temporary_path.write_bytes(incoming)
                temporary_path.replace(request_path)
                deadline = time.monotonic() + 5
                while not response_path.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                if not response_path.exists():
                    raise TimeoutError("sandboxed backend did not answer spool request")
                response = response_path.read_bytes()
                response_path.unlink()
                handler_self.wfile.write(response)

        super().__init__(address, Handler)


def wait_ready(path: Path, process, timeout_s: float = 15) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if path.exists():
            return
        code = process.wait(0)
        if code is not None:
            raise RuntimeError(f"backend exited before ready: {code}")
        time.sleep(0.1)
    raise TimeoutError("backend did not become ready")


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def compile_backend(output: Path) -> dict:
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET" / "Framework64" / "v4.0.30319" / "csc.exe"
    command = [str(compiler), "/nologo", "/optimize+", f"/out:{output}", str(HERE / "BackendProbe.cs")]
    run = subprocess.run(command, cwd=HERE, capture_output=True, text=True, check=False)
    if run.returncode != 0:
        raise RuntimeError(run.stdout + run.stderr)
    return {"compiler": str(compiler), "returncode": run.returncode}


def main() -> None:
    os.environ["OEY_E5_EXPERIMENT_KEY"] = EXPERIMENT_KEY
    sid, sid_text, package_ac = appcontainer_profile(PROFILE)
    workspace = package_ac / "Temp" / "backend"
    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True)
    backend = workspace / "backend-probe.exe"
    compilation = compile_backend(backend)
    ready = workspace / "ready.txt"
    outside = ROOT / "spikes" / "e5-real-backend-outside-secret.txt"
    outside.write_text(EXPERIMENT_KEY, encoding="utf-8")
    port = free_port()
    queue = workspace / "broker-spool"
    queue.mkdir()
    command = f'"{backend}" "{queue}" "{ready}" "{outside}"'

    record = {
        "profile": PROFILE,
        "sid": sid_text,
        "sandbox": "AppContainer zero capability + Job Object; trusted host loopback-to-spool broker",
        "bind": f"127.0.0.1:{port}",
        "backend_transport": str(queue),
        "compilation": compilation,
    }
    try:
        process = start_process(command, sid, workspace, env=clean_env())
        broker = None
        try:
            wait_ready(ready, process)
            broker = SpoolBroker(("127.0.0.1", port), queue)
            broker_thread = threading.Thread(target=broker.serve_forever, daemon=True)
            broker_thread.start()
            health = request(f"http://127.0.0.1:{port}/health")
            echo_input = '{"message":"real backend round trip"}'
            echo = request(f"http://127.0.0.1:{port}/echo", echo_input.encode("utf-8"))
            record.update({
                "pid": process.pid,
                "health": health,
                "echo": echo,
                "backend_alive_during_test": process.wait(0) is None,
            })
        finally:
            process.terminate()
            record["backend_exit_after_job_teardown"] = process.wait(2) is not None
            if broker is not None:
                broker.shutdown()
                broker.server_close()
            process.close()
        time.sleep(0.3)
        record["broker_port_closed_after_session_teardown"] = not port_open(port)
    finally:
        try:
            outside.unlink()
        except FileNotFoundError:
            pass

    record["checks"] = {
        "real_http_health": record.get("health", {}).get("ok") is True,
        "real_post_round_trip": record.get("echo", {}).get("echo") == echo_input,
        "outside_file_denied": record.get("health", {}).get("outside_readable") is False,
        "host_experiment_key_not_in_child": record.get("health", {}).get("experiment_key_visible") is False,
        "backend_lifetime_bound_to_job": record.get("backend_exit_after_job_teardown") is True,
        "broker_port_closed_after_session_teardown": record.get("broker_port_closed_after_session_teardown") is True,
    }
    record["passed"] = all(record["checks"].values())
    RESULT.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(record, ensure_ascii=False, indent=2))
    raise SystemExit(0 if record["passed"] else 1)


if __name__ == "__main__":
    main()
