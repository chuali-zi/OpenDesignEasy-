"""Vendor-neutral capability registry and trusted Kimi host adapter."""

from __future__ import annotations

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


class KimiTrustedAdapter:
    """Minimal OpenAI-compatible Kimi client; credentials never leave this object."""

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
    ) -> ProviderResponse:
        if not messages or not model or max_tokens < 1:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Provider request is incomplete",
            )
        body = json.dumps(
            {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": stream,
                **({"stream_options": {"include_usage": True}} if stream else {}),
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self._base_url}/chat/completions",
            data=body,
            headers={
                "Accept": "text/event-stream" if stream else "application/json",
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        started = time.monotonic()
        try:
            with urllib.request.urlopen(  # noqa: S310 - trusted adapter endpoint
                request, timeout=self.timeout_seconds
            ) as response:
                if stream:
                    result = self._read_stream(response)
                else:
                    result = self._read_json(response)
        except urllib.error.HTTPError as exc:
            raise ContractError(
                ErrorCategory.RETRYABLE,
                f"Provider returned HTTP {exc.code}",
            ) from exc
        except (OSError, TimeoutError) as exc:
            raise ContractError(
                ErrorCategory.RETRYABLE,
                "Provider request failed",
            ) from exc
        elapsed = time.monotonic() - started
        if not result.content.strip():
            category = (
                ErrorCategory.RETRYABLE
                if result.finish_reason in {"engine_overloaded", "length"}
                else ErrorCategory.CAPABILITY_UNAVAILABLE
            )
            raise ContractError(
                category,
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
            document = json.loads(response.read().decode("utf-8"))
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
        except (KeyError, IndexError, TypeError, ValueError, UnicodeDecodeError) as exc:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Provider response schema is invalid",
            ) from exc

    @staticmethod
    def _read_stream(response: Any) -> ProviderResponse:
        pieces: list[str] = []
        usage: Mapping[str, int] = {}
        finish_reason: str | None = None
        for raw in response:
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
                if delta.get("content"):
                    pieces.append(str(delta["content"]))
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
