"""Vendor-neutral capability registry and trusted chat-completions adapter."""

from __future__ import annotations

import inspect
import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Protocol
from urllib.parse import urlsplit

from .domain import ContractError, ErrorCategory

_MAX_PROVIDER_RESPONSE_BYTES = 2_000_000
_MAX_PROVIDER_STREAM_BYTES = 32_000_000


class CapabilitySlot:
    DESIGN_DIRECTION = "design.direction"
    DESIGN_COMPOSE = "design.compose"
    DESIGN_CRITIQUE = "design.critique"
    ARTIFACT_EDIT = "artifact.edit"
    QUALITY_AESTHETIC = "quality.aesthetic"
    IMAGE_GENERATE = "image.generate"


@dataclass(frozen=True, slots=True)
class CapabilityBinding:
    slot: str
    provider: str
    model: str
    capability_version: str
    accepts_images: bool = False
    streaming: bool = True


@dataclass(frozen=True, slots=True)
class ProviderResponse:
    content: str
    usage: Mapping[str, int]
    elapsed_seconds: float
    finish_reason: str | None


class CapabilityClient(Protocol):
    def chat(
        self,
        messages: list[Mapping[str, Any]],
        *,
        model: str,
        max_tokens: int,
        temperature: float,
        stream: bool,
        reasoning_effort: str | None = None,
        on_stream_chunk: Callable[[str], None] | None = None,
    ) -> ProviderResponse: ...


class CapabilityRegistry:
    """Stores only slot bindings; provider payloads never enter this registry."""

    capability_version = "capability-registry/1"

    def __init__(self, bindings: tuple[CapabilityBinding, ...] = ()) -> None:
        self._bindings: dict[str, CapabilityBinding] = {}
        for binding in bindings:
            self.register(binding)

    def register(self, binding: CapabilityBinding) -> None:
        if not binding.slot or not binding.provider or not binding.model:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Capability binding requires slot, provider, and model",
            )
        if (
            not binding.capability_version
            or "stub" in binding.capability_version.casefold()
        ):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Capability binding requires a non-stub version",
            )
        existing = self._bindings.get(binding.slot)
        if existing is not None and existing != binding:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Capability slot is already bound",
                details={"slot": binding.slot},
            )
        self._bindings[binding.slot] = binding

    def require(self, slot: str) -> CapabilityBinding:
        try:
            return self._bindings[slot]
        except KeyError as exc:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Capability slot is not bound",
                details={"slot": slot},
            ) from exc

    def snapshot(self) -> Mapping[str, CapabilityBinding]:
        return MappingProxyType(dict(sorted(self._bindings.items())))

    def probe(
        self,
        slot: str,
        probe: Callable[[CapabilityBinding], bool],
    ) -> CapabilityBinding:
        binding = self.require(slot)
        try:
            available = probe(binding)
        except Exception as exc:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Capability probe failed",
                details={"slot": slot},
            ) from exc
        if not available:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Capability probe rejected binding",
                details={"slot": slot},
            )
        return binding


def stream_callback_options(
    client: CapabilityClient,
    callback: Callable[[str], None],
) -> dict[str, Callable[[str], None]]:
    """Add the optional stream hook while preserving legacy fake adapters."""

    try:
        parameters = inspect.signature(client.chat).parameters.values()
    except (TypeError, ValueError):
        return {}
    if any(
        parameter.name == "on_stream_chunk"
        or parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in parameters
    ):
        return {"on_stream_chunk": callback}
    return {}


def reasoning_effort_options(
    client: CapabilityClient, effort: str
) -> dict[str, str]:
    """Request structured-task effort without breaking legacy fake adapters."""

    try:
        parameters = inspect.signature(client.chat).parameters.values()
    except (TypeError, ValueError):
        return {}
    if any(
        parameter.name == "reasoning_effort"
        or parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in parameters
    ):
        return {"reasoning_effort": effort}
    return {}


class KimiTrustedAdapter:
    """Minimal OpenAI-compatible client; credentials never leave this object."""

    capability_version = "kimi-openai-compatible/1"

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout_seconds: float = 900.0,
    ) -> None:
        if not api_key or not _approved_base_url(base_url):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Trusted provider adapter requires a non-empty key and approved "
                "base URL",
            )
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        if timeout_seconds <= 0:
            raise ValueError("Provider timeout must be positive")
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_environment(
        cls,
        environment: Mapping[str, str] | None = None,
        *,
        key_name: str = "OEYDESIGN_KIMI_API_KEY",
        base_url_name: str = "OEYDESIGN_KIMI_BASE_URL",
    ) -> KimiTrustedAdapter:
        values = os.environ if environment is None else environment
        api_key = values.get(key_name, "")
        base_url = values.get(base_url_name, "")
        if not api_key or not base_url:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Trusted provider credentials are unavailable",
            )
        return cls(api_key=api_key, base_url=base_url)

    def __repr__(self) -> str:
        return f"KimiTrustedAdapter(base_url={self._base_url!r}, api_key=<redacted>)"

    def chat(
        self,
        messages: list[Mapping[str, Any]],
        *,
        model: str,
        max_tokens: int,
        temperature: float = 1.0,
        stream: bool = True,
        reasoning_effort: str | None = None,
        on_stream_chunk: Callable[[str], None] | None = None,
    ) -> ProviderResponse:
        if not messages or not model or max_tokens < 1:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Provider request is incomplete",
            )
        request_document: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        # Kimi Code's OpenAI-compatible endpoint accepts Chat Completions but K3
        # rejects caller-controlled sampling values. Keep the general adapter's
        # sampling behaviour for ordinary OpenAI-compatible providers.
        coding_profile = _kimi_coding_profile(self._base_url, model)
        if not coding_profile:
            request_document["temperature"] = temperature
        if coding_profile and model.casefold().startswith("k3"):
            selected_effort = reasoning_effort or "high"
            if selected_effort not in {"low", "high", "max"}:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Kimi K3 reasoning effort must be low, high, or max",
                )
            request_document["reasoning_effort"] = selected_effort
        if stream:
            request_document["stream_options"] = {"include_usage": True}
        body = json.dumps(request_document, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            f"{self._base_url}/chat/completions",
            data=body,
            headers={
                "Accept": "text/event-stream" if stream else "application/json",
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "User-Agent": "OEYdesign-Agent/1",
            },
            method="POST",
        )
        started = time.monotonic()
        try:
            with urllib.request.urlopen(  # noqa: S310 - trusted adapter endpoint
                request, timeout=self.timeout_seconds
            ) as response:
                if stream:
                    result = self._read_stream(response, on_chunk=on_stream_chunk)
                else:
                    result = self._read_json(response)
        except urllib.error.HTTPError as exc:
            category = (
                ErrorCategory.CAPABILITY_UNAVAILABLE
                if exc.code in {401, 403}
                else ErrorCategory.RETRYABLE
            )
            raise ContractError(
                category,
                f"Provider returned HTTP {exc.code}",
            ) from exc
        except (OSError, TimeoutError) as exc:
            raise ContractError(
                ErrorCategory.RETRYABLE,
                "Provider request failed",
            ) from exc
        elapsed = time.monotonic() - started
        if not result.content.strip():
            raise ContractError(
                ErrorCategory.RETRYABLE,
                "Provider returned empty content",
            )
        return ProviderResponse(
            result.content,
            result.usage,
            elapsed,
            result.finish_reason,
        )

    @staticmethod
    def _read_json(response: Any) -> ProviderResponse:
        try:
            raw = response.read(_MAX_PROVIDER_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_PROVIDER_RESPONSE_BYTES:
                raise ContractError(
                    ErrorCategory.CAPABILITY_UNAVAILABLE,
                    "Provider response exceeds the trusted size limit",
                )
            document = json.loads(raw.decode("utf-8"))
            choice = document["choices"][0]
            message = choice["message"]
            content = message.get("content") or ""
            usage = _usage(document.get("usage"))
            return ProviderResponse(
                content,
                usage,
                0.0,
                choice.get("finish_reason"),
            )
        except ContractError:
            raise
        except (KeyError, IndexError, TypeError, ValueError, UnicodeDecodeError) as exc:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Provider response schema is invalid",
            ) from exc

    @staticmethod
    def _read_stream(
        response: Any,
        *,
        on_chunk: Callable[[str], None] | None = None,
    ) -> ProviderResponse:
        pieces: list[str] = []
        usage: Mapping[str, int] = {}
        finish_reason: str | None = None
        stream_bytes = 0
        content_bytes = 0
        for raw in response:
            stream_bytes += len(raw)
            if stream_bytes > _MAX_PROVIDER_STREAM_BYTES:
                raise ContractError(
                    ErrorCategory.CAPABILITY_UNAVAILABLE,
                    "Provider stream exceeds the trusted transport size limit",
                )
            line = raw.decode("utf-8", "replace").strip()
            if not line or not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                document = json.loads(payload)
            except json.JSONDecodeError:
                continue
            usage = _usage(document.get("usage")) or usage
            for choice in document.get("choices") or ():
                delta = choice.get("delta") or {}
                # Reasoning models can spend a long interval emitting only a
                # private reasoning channel. Signal transport progress without
                # forwarding that text to the product/UI callback.
                if delta.get("reasoning_content") is not None and on_chunk is not None:
                    on_chunk("")
                if delta.get("content"):
                    content = str(delta["content"])
                    content_bytes += len(content.encode("utf-8"))
                    if content_bytes > _MAX_PROVIDER_RESPONSE_BYTES:
                        raise ContractError(
                            ErrorCategory.CAPABILITY_UNAVAILABLE,
                            "Provider response exceeds the trusted size limit",
                        )
                    pieces.append(content)
                    if on_chunk is not None:
                        on_chunk(content)
                if choice.get("finish_reason"):
                    finish_reason = str(choice["finish_reason"])
        return ProviderResponse("".join(pieces), usage, 0.0, finish_reason)


def _usage(value: Any) -> Mapping[str, int]:
    if not isinstance(value, Mapping):
        return {}
    return MappingProxyType(
        {
            key: int(item)
            for key, item in value.items()
            if key
            in {
                "prompt_tokens",
                "completion_tokens",
                "reasoning_tokens",
                "total_tokens",
            }
            and isinstance(item, (int, float))
        }
    )


def _approved_base_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if (
        not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        return False
    if parsed.scheme == "https":
        return True
    if parsed.scheme != "http":
        return False
    return parsed.hostname in {"127.0.0.1", "localhost", "::1"}


def _kimi_coding_profile(base_url: str, model: str) -> bool:
    """Return whether this request uses the Kimi Code Chat Completions profile.

    This is endpoint capability detection, rather than a model-name rule: Kimi's
    ordinary Platform API and unrelated OpenAI-compatible endpoints retain their
    caller-selected temperature. The Code subscription endpoint is deliberately
    scoped because its coding models reject sampling overrides with HTTP 400.
    """

    parsed = urlsplit(base_url)
    path = parsed.path.rstrip("/")
    return (
        parsed.hostname == "api.kimi.com"
        and (path == "/coding" or path.startswith("/coding/"))
        and bool(model.strip())
    )
