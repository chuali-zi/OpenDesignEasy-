from __future__ import annotations

import io
import json
from unittest.mock import patch

import pytest

from oeydesign.capabilities import (
    CapabilityBinding,
    CapabilityRegistry,
    CapabilitySlot,
    KimiTrustedAdapter,
)
from oeydesign.domain import ContractError


def test_capability_registry_is_vendor_neutral_and_probeable() -> None:
    registry = CapabilityRegistry(
        (
            CapabilityBinding(
                CapabilitySlot.DESIGN_COMPOSE,
                "kimi",
                "k3",
                "kimi-design-compose/1",
            ),
        )
    )
    binding = registry.require(CapabilitySlot.DESIGN_COMPOSE)
    assert binding.provider == "kimi"
    assert registry.probe(
        CapabilitySlot.DESIGN_COMPOSE, lambda item: item.model == "k3"
    ) == binding
    assert tuple(registry.snapshot()) == (CapabilitySlot.DESIGN_COMPOSE,)
    with pytest.raises(ContractError) as duplicate:
        registry.register(
            CapabilityBinding(
                CapabilitySlot.DESIGN_COMPOSE,
                "other",
                "model",
                "other-design/1",
            )
        )
    assert duplicate.value.category.value == "DETERMINISTIC_FAILURE"


def test_trusted_kimi_adapter_never_accepts_missing_or_unapproved_credentials() -> None:
    with pytest.raises(ContractError) as missing:
        KimiTrustedAdapter.from_environment({})
    assert missing.value.category.value == "CAPABILITY_UNAVAILABLE"

    with pytest.raises(ContractError) as unsafe:
        KimiTrustedAdapter(
            api_key="experiment-key",
            base_url="file:///tmp/provider",
        )
    assert unsafe.value.category.value == "POLICY_BLOCKED"

    with pytest.raises(ContractError):
        KimiTrustedAdapter(
            api_key="experiment-key",
            base_url="http://127.0.0.1.attacker.example/provider",
        )

    adapter = KimiTrustedAdapter(
        api_key="experiment-key",
        base_url="http://127.0.0.1:9999",
    )
    assert "experiment-key" not in repr(adapter)
    assert "redacted" in repr(adapter)


def test_kimi_adapter_bounds_and_validates_provider_responses() -> None:
    valid = {
        "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1},
    }
    parsed = KimiTrustedAdapter._read_json(
        io.BytesIO(json.dumps(valid).encode("utf-8"))
    )
    assert parsed.content == "ok"

    with pytest.raises(ContractError) as malformed:
        KimiTrustedAdapter._read_json(io.BytesIO(b'{"choices":[]}'))
    assert malformed.value.category.value == "CAPABILITY_UNAVAILABLE"

    with pytest.raises(ContractError) as overlong:
        KimiTrustedAdapter._read_json(io.BytesIO(b"x" * 2_000_001))
    assert overlong.value.category.value == "CAPABILITY_UNAVAILABLE"


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args: object) -> None:
        return None


def _captured_request_document(
    adapter: KimiTrustedAdapter,
    **chat_kwargs: object,
) -> tuple[str, dict[str, object]]:
    captured: list[object] = []

    def fake_urlopen(request, *, timeout):  # type: ignore[no-untyped-def]
        captured.extend((request, timeout))
        return _Response(
            b'{"choices":[{"message":{"content":"READY"},"finish_reason":"stop"}]}'
        )

    with patch("oeydesign.capabilities.urllib.request.urlopen", fake_urlopen):
        adapter.chat(
            [{"role": "user", "content": "ping"}],
            model="k3",
            max_tokens=16,
            temperature=0,
            stream=False,
            **chat_kwargs,
        )
    request = captured[0]
    return request.full_url, json.loads(request.data.decode("utf-8"))


def test_kimi_coding_chat_completions_uses_provider_default_sampling() -> None:
    url, document = _captured_request_document(
        KimiTrustedAdapter(
            api_key="experiment-key",
            base_url="https://api.kimi.com/coding/v1",
        )
    )

    assert url == "https://api.kimi.com/coding/v1/chat/completions"
    assert document == {
        "model": "k3",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 16,
        "stream": False,
        "reasoning_effort": "high",
    }


def test_other_openai_compatible_endpoints_keep_requested_sampling() -> None:
    _, document = _captured_request_document(
        KimiTrustedAdapter(
            api_key="experiment-key",
            base_url="https://api.moonshot.ai/v1",
        )
    )

    assert document["temperature"] == 0


def test_kimi_coding_probe_can_use_a_lower_valid_reasoning_effort() -> None:
    _, document = _captured_request_document(
        KimiTrustedAdapter(
            api_key="experiment-key",
            base_url="https://api.kimi.com/coding/v1",
        ),
        reasoning_effort="low",
    )
    assert document["reasoning_effort"] == "low"


def test_kimi_coding_rejects_invalid_reasoning_effort_before_networking() -> None:
    adapter = KimiTrustedAdapter(
        api_key="experiment-key",
        base_url="https://api.kimi.com/coding/v1",
    )
    with pytest.raises(ContractError) as invalid:
        adapter.chat(
            [{"role": "user", "content": "ping"}],
            model="k3",
            max_tokens=16,
            temperature=0,
            stream=False,
            reasoning_effort="medium",
        )
    assert invalid.value.category.value == "DETERMINISTIC_FAILURE"


def test_stream_callback_is_optional_and_provider_neutral() -> None:
    chunks: list[str] = []
    response = KimiTrustedAdapter._read_stream(
        io.BytesIO(
            b'data: {"choices":[{"delta":{"content":"REA"}}]}\n'
            b'data: {"choices":[{"delta":{"content":"DY"},"finish_reason":"stop"}]}\n'
            b"data: [DONE]\n"
        ),
        on_chunk=chunks.append,
    )
    assert response.content == "READY"
    assert chunks == ["REA", "DY"]


def test_reasoning_stream_reports_progress_without_exposing_reasoning() -> None:
    chunks: list[str] = []
    response = KimiTrustedAdapter._read_stream(
        io.BytesIO(
            b'data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n'
            b'data: {"choices":[{"delta":{"content":"READY"}}]}\n'
            b"data: [DONE]\n"
        ),
        on_chunk=chunks.append,
    )

    assert response.content == "READY"
    assert chunks == ["", "READY"]
    assert "private" not in repr(chunks)
