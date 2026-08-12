from __future__ import annotations

import io
import json

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
