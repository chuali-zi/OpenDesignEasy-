"""Minimal zero-dependency client for the Kimi OpenAI-compatible endpoint."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    raw = (REPO / ".env").read_text(encoding="utf-8-sig")
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
API_KEY = ENV.get("API_KEY", "")
BASE_URL = ENV.get("BASE_URL", "").rstrip("/")
MODEL = ENV.get("MODEL", "")


def chat(messages, *, tools=None, model=None, max_tokens=4096,
         temperature=1, timeout=300, extra=None):
    """One chat-completions call. Returns (message_dict, usage_dict, elapsed_s)."""
    payload = {
        "model": model or MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = tools
    if extra:
        payload.update(extra)

    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:800]
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from None
    elapsed = time.time() - start
    return body["choices"][0]["message"], body.get("usage", {}), elapsed


def chat_stream(messages, *, model=None, max_tokens=32000, temperature=1,
                timeout=1800, extra=None, progress_every=8000):
    """Streaming variant. Returns (message_dict, usage_dict, elapsed_s).

    Non-streaming requests with a large `max_tokens` hit the endpoint's nginx
    gateway timeout (observed: HTTP 504 at max_tokens=40000) because nothing is
    sent until generation finishes. Streaming keeps bytes flowing so the gateway
    stays happy, which is the only way to get long single-shot outputs.
    """
    payload = {
        "model": model or MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
        # OpenAI convention: ask the endpoint to emit a final usage chunk.
        # Harmless if unsupported -- we fall back to a char-based estimate.
        "stream_options": {"include_usage": True},
    }
    if extra:
        payload.update(extra)

    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    start = time.time()
    parts: list[str] = []
    usage: dict = {}
    finish_reason = None
    next_mark = progress_every
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if obj.get("usage"):
                    usage = obj["usage"]
                for ch in obj.get("choices") or []:
                    delta = ch.get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        parts.append(piece)
                    if ch.get("finish_reason"):
                        finish_reason = ch["finish_reason"]
                total = sum(len(p) for p in parts)
                if total >= next_mark:
                    print(f"    ... streamed {total} chars "
                          f"({time.time() - start:.0f}s)", flush=True)
                    next_mark = total + progress_every
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:800]
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from None

    content = "".join(parts)
    if not usage:
        usage = {"completion_tokens": None, "total_tokens": None,
                 "_note": "endpoint did not send usage in stream"}
    usage["_finish_reason"] = finish_reason

    # 端点会在过载时正常关闭流、只带一个 finish_reason（实测 `engine_overloaded`），
    # 既不返回 HTTP 错误也不返回内容。若在这里静默返回空串，调用方会把它当成一次
    # 成功生成并写出一个 0 字节的产物——失败要到看截图时才被发现。
    # 空产出永远不是有效结果，所以在最靠近事实的地方抛出来。
    if not content.strip():
        raise RuntimeError(
            f"stream returned no content (finish_reason={finish_reason!r}, "
            f"elapsed={time.time() - start:.0f}s)")

    return ({"role": "assistant", "content": content}, usage,
            time.time() - start)
