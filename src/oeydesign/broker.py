"""Trusted, auditable fetch boundary for E13-style dependency access."""

from __future__ import annotations

import hashlib
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from urllib.parse import urlsplit

from .domain import ContractError, ErrorCategory
from .ports import AuditLogPort


@dataclass(frozen=True, slots=True)
class FetchPolicy:
    allowed_urls: tuple[str, ...]
    max_bytes: int = 50_000_000
    timeout_seconds: float = 60.0

    def __post_init__(self) -> None:
        if self.max_bytes <= 0 or self.timeout_seconds <= 0:
            raise ValueError("Fetch policy limits must be positive")
        normalized = tuple(dict.fromkeys(self.allowed_urls))
        if normalized != self.allowed_urls:
            raise ValueError("Fetch policy URLs must be unique and ordered")
        for url in self.allowed_urls:
            _validate_url(url)


@dataclass(frozen=True, slots=True)
class FetchRequest:
    url: str
    session_id: str
    project_id: str
    headers: Mapping[str, str] = MappingProxyType({})


@dataclass(frozen=True, slots=True)
class FetchResult:
    url: str
    status: int
    content_type: str
    payload: bytes
    sha256_digest: str


class TrustedFetchBroker:
    """Fetches only exact, approved URLs and never persists response bodies."""

    capability_version = "trusted-fetch-broker/1"

    def __init__(
        self,
        policy: FetchPolicy,
        *,
        audit_log: AuditLogPort | None = None,
        opener: Callable[..., object] | None = None,
    ) -> None:
        self.policy = policy
        self.audit_log = audit_log
        self._opener = opener or urllib.request.urlopen

    def fetch(self, request: FetchRequest) -> FetchResult:
        if request.url not in self.policy.allowed_urls:
            raise _policy("Fetch URL is not explicitly approved")
        if not request.session_id or not request.project_id:
            raise _policy("Fetch request requires session and project identity")
        for key, value in request.headers.items():
            if not isinstance(key, str) or not isinstance(value, str):
                raise _policy("Fetch headers must be text")
            if "\x00" in key or "\x00" in value:
                raise _policy("Fetch headers contain unsafe data")
        _validate_url(request.url)
        try:
            http_request = urllib.request.Request(
                request.url,
                headers=dict(request.headers),
                method="GET",
            )
            with self._opener(
                http_request,
                timeout=self.policy.timeout_seconds,
            ) as response:
                effective_url = str(response.geturl())
                if effective_url != request.url:
                    raise _policy("Fetch redirects are not allowed")
                status = int(getattr(response, "status", 200))
                content_type = str(response.headers.get("Content-Type", ""))
                payload = response.read(self.policy.max_bytes + 1)
        except ContractError:
            raise
        except urllib.error.HTTPError as exc:
            self._audit(request, outcome=f"HTTP_{exc.code}", digest=None)
            raise ContractError(
                ErrorCategory.RETRYABLE,
                f"Trusted fetch returned HTTP {exc.code}",
            ) from exc
        except (OSError, TimeoutError) as exc:
            self._audit(request, outcome="NETWORK_ERROR", digest=None)
            raise ContractError(
                ErrorCategory.RETRYABLE,
                "Trusted fetch failed",
            ) from exc
        if len(payload) > self.policy.max_bytes:
            self._audit(request, outcome="SIZE_LIMIT", digest=None)
            raise _policy("Trusted fetch response exceeds the size limit")
        digest = hashlib.sha256(payload).hexdigest()
        self._audit(request, outcome="COMPLETED", digest=digest)
        return FetchResult(request.url, status, content_type, payload, digest)

    def _audit(
        self,
        request: FetchRequest,
        *,
        outcome: str,
        digest: str | None,
    ) -> None:
        if self.audit_log is None:
            return
        metadata: dict[str, object] = {
            "url": request.url,
            "session_id": request.session_id,
            "broker_version": self.capability_version,
            "sha256_digest": digest,
        }
        self.audit_log.record(
            project_id=request.project_id,
            action="trusted_fetch",
            outcome=outcome,
            metadata=metadata,
        )


def _validate_url(url: str) -> None:
    try:
        parsed = urlsplit(url)
    except ValueError as exc:
        raise _policy("Fetch URL is invalid") from exc
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise _policy("Fetch URL must be HTTPS without credentials or fragments")


def _policy(message: str) -> ContractError:
    return ContractError(ErrorCategory.POLICY_BLOCKED, message)
