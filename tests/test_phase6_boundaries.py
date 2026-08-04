from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import pytest

from oeydesign.broker import FetchPolicy, FetchRequest, TrustedFetchBroker
from oeydesign.domain import ContractError
from oeydesign.sandbox import (
    SandboxCommand,
    UnavailableSandboxLauncher,
    default_sandbox_launcher,
)


@dataclass
class _Headers:
    values: dict[str, str]

    def get(self, key: str, default: str = "") -> str:
        return self.values.get(key, default)


class _Response:
    status = 200
    headers = _Headers({"Content-Type": "application/octet-stream"})

    def __init__(self, payload: bytes, url: str) -> None:
        self.payload = payload
        self.url = url

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def geturl(self) -> str:
        return self.url

    def read(self, limit: int = -1) -> bytes:
        return self.payload if limit < 0 else self.payload[:limit]


def test_fetch_broker_requires_exact_https_url_and_records_only_hash() -> None:
    calls: list[tuple[object, float]] = []

    def opener(request: object, *, timeout: float) -> _Response:
        calls.append((request, timeout))
        return _Response(b"archive", "https://registry.example/pkg.tgz")

    broker = TrustedFetchBroker(
        FetchPolicy(("https://registry.example/pkg.tgz",), max_bytes=64),
        opener=opener,
    )
    result = broker.fetch(
        FetchRequest(
            "https://registry.example/pkg.tgz",
            session_id="session-1",
            project_id="project-1",
        )
    )
    assert result.payload == b"archive"
    assert result.sha256_digest
    assert calls

    with pytest.raises(ContractError) as not_allowed:
        broker.fetch(
            FetchRequest(
                "https://registry.example/other.tgz",
                session_id="session-1",
                project_id="project-1",
            )
        )
    assert not_allowed.value.category.value == "POLICY_BLOCKED"

    with pytest.raises(ContractError):
        FetchPolicy(("http://registry.example/pkg.tgz",))


def test_sandbox_command_is_shell_free_and_non_windows_launcher_fails_closed(
    tmp_path: Path,
) -> None:
    command = SandboxCommand("esbuild", ("src/main.jsx", "--bundle"))
    assert command.cwd_scope == "work"
    assert default_sandbox_launcher().available is (os.name == "nt")

    with pytest.raises(ContractError) as unsafe:
        SandboxCommand("sh;echo")
    assert unsafe.value.category.value == "POLICY_BLOCKED"

    with pytest.raises(ContractError) as unavailable:
        UnavailableSandboxLauncher().run(None, command)  # type: ignore[arg-type]
    assert unavailable.value.category.value == "CAPABILITY_UNAVAILABLE"
