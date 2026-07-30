from __future__ import annotations

import hashlib
import json
import struct
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
RAW = OUT / "raw"
IMAGES = OUT / "images"
RETRY_DELAYS = (2, 4)

PROMPTS = {
    "paper_cut": (
        "A single cobalt-blue ceramic teapot with one orange leaf beside it, centered on a warm "
        "cream background. Handmade layered paper-cut illustration, visibly cut paper edges, flat "
        "shapes, limited cobalt orange and cream palette, soft cast shadows, no text, no logo."
    ),
    "studio_photo": (
        "A single cobalt-blue ceramic teapot with one orange leaf beside it, centered on a warm "
        "cream seamless background. Premium studio product photograph, physically realistic glazed "
        "ceramic, crisp specular highlights, shallow depth of field, softbox lighting, no text, no logo."
    ),
}

CASES = (
    ("square-paper-cut", "2048x2048", "paper_cut"),
    ("square-studio-photo", "2048x2048", "studio_photo"),
    ("wide-paper-cut", "2560x1440", "paper_cut"),
    ("wide-studio-photo", "2560x1440", "studio_photo"),
)


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip().strip('"').strip("'")
    return values


def image_type(data: bytes, content_type: str) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8"):
        return "jpg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    if "png" in content_type:
        return "png"
    if "webp" in content_type:
        return "webp"
    return "jpg"


def image_size(data: bytes) -> tuple[int, int]:
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data.startswith(b"\xff\xd8"):
        offset = 2
        while offset + 9 <= len(data):
            if data[offset] != 0xFF:
                offset += 1
                continue
            marker = data[offset + 1]
            offset += 2
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                continue
            if offset + 2 > len(data):
                break
            length = struct.unpack(">H", data[offset : offset + 2])[0]
            if marker in range(0xC0, 0xD4) and marker not in (0xC4, 0xC8, 0xCC):
                height, width = struct.unpack(">HH", data[offset + 3 : offset + 7])
                return width, height
            offset += length
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        kind = data[12:16]
        if kind == b"VP8X" and len(data) >= 30:
            width = 1 + int.from_bytes(data[24:27], "little")
            height = 1 + int.from_bytes(data[27:30], "little")
            return width, height
    raise ValueError("unsupported image format for dimension check")


def sanitized_response(body: dict) -> dict:
    clean = dict(body)
    clean_data = []
    for item in body.get("data", []):
        if not isinstance(item, dict):
            continue
        clean_data.append({key: value for key, value in item.items() if key not in {"url", "b64_json"}})
    clean["data"] = clean_data
    return clean


def request_json(url: str, key: str, payload: dict) -> tuple[dict, int, int]:
    encoded = json.dumps(payload).encode("utf-8")
    for attempt in range(len(RETRY_DELAYS) + 1):
        request = urllib.request.Request(
            url,
            data=encoded,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            method="POST",
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                body = json.loads(response.read().decode("utf-8"))
                return body, response.status, round((time.perf_counter() - started) * 1000)
        except urllib.error.HTTPError as error:
            latency_ms = round((time.perf_counter() - started) * 1000)
            error_body = error.read().decode("utf-8", "replace")[:4000]
            if error.code not in (429, 500, 502, 503, 504) or attempt == len(RETRY_DELAYS):
                raise RuntimeError(
                    json.dumps(
                        {"http_status": error.code, "latency_ms": latency_ms, "body": error_body},
                        ensure_ascii=False,
                    )
                ) from None
            retry_after = error.headers.get("Retry-After")
            delay = RETRY_DELAYS[attempt]
            if retry_after and retry_after.isdigit():
                delay = min(30, max(delay, int(retry_after)))
            time.sleep(delay)
        except urllib.error.URLError as error:
            raise RuntimeError(f"endpoint connection failed: {error.reason}") from None
    raise AssertionError("unreachable")


def download(url: str) -> tuple[bytes, str, int]:
    started = time.perf_counter()
    with urllib.request.urlopen(urllib.request.Request(url), timeout=120) as response:
        data = response.read()
        content_type = response.headers.get_content_type()
    return data, content_type, round((time.perf_counter() - started) * 1000)


def main() -> int:
    values = load_env(ROOT / ".env")
    missing = [name for name in ("ARK_API_KEY", "ARK_BASE_URL", "ARK_MODEL_ID") if not values.get(name)]
    if missing:
        print("BLOCKED: missing " + ", ".join(missing))
        return 2

    RAW.mkdir(parents=True, exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    run = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": values["ARK_BASE_URL"],
        "model": values["ARK_MODEL_ID"],
        "retry_policy": {"statuses": [429, 500, 502, 503, 504], "delays_seconds": list(RETRY_DELAYS)},
        "cases": [],
        "status": "RUNNING",
    }

    try:
        for case_id, size, style in CASES:
            payload = {
                "model": values["ARK_MODEL_ID"],
                "prompt": PROMPTS[style],
                "size": size,
                "response_format": "url",
                "watermark": False,
            }
            record = {"case_id": case_id, "style": style, "request": payload}
            run["cases"].append(record)
            body, status, latency_ms = request_json(
                values["ARK_BASE_URL"], values["ARK_API_KEY"], payload
            )
            record.update(
                {
                    "http_status": status,
                    "generation_latency_ms": latency_ms,
                    "response_metadata": sanitized_response(body),
                }
            )
            data_items = body.get("data")
            if not isinstance(data_items, list) or len(data_items) != 1 or not data_items[0].get("url"):
                raise RuntimeError("unexpected response: exactly one data[0].url was required")
            image_data, content_type, download_ms = download(data_items[0]["url"])
            suffix = image_type(image_data, content_type)
            path = IMAGES / f"{case_id}.{suffix}"
            path.write_bytes(image_data)
            width, height = image_size(image_data)
            record["image"] = {
                "path": path.relative_to(OUT).as_posix(),
                "content_type": content_type,
                "bytes": len(image_data),
                "sha256": hashlib.sha256(image_data).hexdigest(),
                "width": width,
                "height": height,
                "download_latency_ms": download_ms,
                "requested_size_match": f"{width}x{height}" == size,
            }
        run["status"] = "COMPLETED"
        return_code = 0
    except Exception as error:
        run["status"] = "BLOCKED"
        run["failure"] = {"type": type(error).__name__, "message": str(error)}
        return_code = 2
    finally:
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        (RAW / "run.json").write_text(
            json.dumps(run, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    print(f"{run['status']}: {len(run['cases'])} case(s) attempted; raw/run.json written")
    return return_code


if __name__ == "__main__":
    sys.exit(main())
