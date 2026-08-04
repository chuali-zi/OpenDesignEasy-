"""Deterministic framework artifact contracts used before native build execution."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from html.parser import HTMLParser
from types import MappingProxyType

from .domain import ContractError, ErrorCategory, canonical_json


@dataclass(frozen=True, slots=True)
class FrameworkProfile:
    react: str = "19.1.1"
    react_dom: str = "19.1.1"
    mui: str = "7.3.1"
    emotion: str = "11.14.1"
    esbuild: str = "0.25.12"

    @property
    def id(self) -> str:
        return "react-mui-native-esbuild/1"


@dataclass(frozen=True, slots=True)
class StrictTheme:
    tokens: Mapping[str, str]
    material_theme: Mapping[str, Mapping[str, str]]


class StrictThemeFactory:
    """Builds the only supported six-token framework theme."""

    capability_version = "strict-theme/1"
    token_names = (
        "background",
        "foreground",
        "accent",
        "border",
        "muted",
        "focus",
    )

    def build(self, tokens: Mapping[str, str]) -> StrictTheme:
        if (
            not isinstance(tokens, Mapping)
            or not all(isinstance(name, str) for name in tokens)
            or tuple(sorted(tokens)) != tuple(sorted(self.token_names))
        ):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework theme must declare exactly six role tokens",
            )
        normalized = {
            name: value.upper()
            for name, value in tokens.items()
            if isinstance(value, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", value)
        }
        if len(normalized) != len(self.token_names):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework theme tokens must be opaque six-digit colors",
            )
        material_theme = {
            "palette": {
                "background": normalized["background"],
                "text": normalized["foreground"],
                "primary": normalized["accent"],
            },
            "grey": {"500": normalized["muted"]},
            "action": {
                "active": normalized["foreground"],
                "focus": normalized["focus"],
            },
            "divider": {"default": normalized["border"]},
        }
        return StrictTheme(
            MappingProxyType(normalized),
            MappingProxyType(
                {key: MappingProxyType(value) for key, value in material_theme.items()}
            ),
        )


class _AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        for attribute, prefix in (
            ("data-oey-object", ""),
            ("data-oey-section", "section:"),
        ):
            value = values.get(attribute)
            if value is None:
                continue
            if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,120}", value):
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Framework anchor contains an unsafe identity",
                )
            key = f"{prefix}{value}"
            if key in self.refs:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Framework anchor identity is duplicated",
                    details={"anchor": key},
                )
            selector = f'[{attribute}="{value}"]'
            self.refs[key] = selector


class AnchorRegistry:
    """Extracts stable object references from built/renderable HTML."""

    capability_version = "object-registry/1"

    def extract(self, html: str) -> Mapping[str, str]:
        if not isinstance(html, str) or not html.strip():
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework artifact HTML is empty",
            )
        parser = _AnchorParser()
        try:
            parser.feed(html)
            parser.close()
        except ContractError:
            raise
        except Exception as exc:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework artifact HTML cannot be parsed",
            ) from exc
        return MappingProxyType(dict(sorted(parser.refs.items())))


@dataclass(frozen=True, slots=True)
class FrameworkArtifactPlan:
    profile: FrameworkProfile
    source_files: Mapping[str, str]
    lockfile_sha256: str
    source_tree_sha256: str
    theme: StrictTheme
    object_refs: Mapping[str, str]


class FrameworkArtifactContract:
    """Validates the source/lockfile tree; native esbuild consumes this plan later."""

    capability_version = "framework-artifact-contract/1"
    _required = frozenset({"package.json", "package-lock.json", "index.html"})

    def __init__(
        self,
        *,
        profile: FrameworkProfile | None = None,
        theme_factory: StrictThemeFactory | None = None,
        anchor_registry: AnchorRegistry | None = None,
        max_files: int = 5_000,
        max_bytes: int = 50_000_000,
    ) -> None:
        if max_files < 1 or max_bytes < 1:
            raise ValueError("Framework artifact limits must be positive")
        self.profile = profile or FrameworkProfile()
        self.theme_factory = theme_factory or StrictThemeFactory()
        self.anchor_registry = anchor_registry or AnchorRegistry()
        self.max_files = max_files
        self.max_bytes = max_bytes

    def prepare(
        self,
        files: Mapping[str, str | bytes],
        *,
        lockfile: str | bytes,
        theme_tokens: Mapping[str, str],
    ) -> FrameworkArtifactPlan:
        normalized = _normalize_files(files)
        if len(normalized) > self.max_files or sum(
            len(content.encode("utf-8")) for content in normalized.values()
        ) > self.max_bytes:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Framework artifact exceeds the source tree limit",
            )
        if not self._required.issubset(normalized):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework artifact is missing a required manifest or entry file",
            )
        if normalized["package-lock.json"] != _as_text(lockfile):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework package-lock does not match the source tree",
            )
        self._validate_manifest(normalized)
        for path, content in normalized.items():
            if path == "package-lock.json":
                continue
            if re.search(r"https?://", content, flags=re.IGNORECASE):
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED,
                    "Framework runtime files must not contain external URLs",
                    details={"path": path},
                )
        theme = self.theme_factory.build(theme_tokens)
        object_refs = self.anchor_registry.extract(normalized["index.html"])
        lock_hash = hashlib.sha256(normalized["package-lock.json"].encode()).hexdigest()
        source_hash = _tree_hash(normalized)
        return FrameworkArtifactPlan(
            self.profile,
            MappingProxyType(normalized),
            lock_hash,
            source_hash,
            theme,
            object_refs,
        )

    def _validate_manifest(self, files: Mapping[str, str]) -> None:
        try:
            package = json.loads(files["package.json"])
            lock = json.loads(files["package-lock.json"])
        except (json.JSONDecodeError, TypeError) as exc:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework package manifests must be valid JSON",
            ) from exc
        if not isinstance(package, dict) or not isinstance(lock, dict):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework package manifests have an invalid shape",
            )
        dependencies = package.get("dependencies", {})
        if not isinstance(dependencies, dict):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework package dependencies have an invalid shape",
            )
        expected = {
            "react": self.profile.react,
            "react-dom": self.profile.react_dom,
            "@mui/material": self.profile.mui,
            "@emotion/styled": self.profile.emotion,
            "esbuild": self.profile.esbuild,
        }
        for name, version in expected.items():
            if name in dependencies and dependencies[name] != version:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Framework dependency version is outside the frozen profile",
                    details={"dependency": name, "expected": version},
                )
        packages = lock.get("packages", {})
        if packages and not isinstance(packages, dict):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework lockfile packages have an invalid shape",
            )
        root = packages.get("") if isinstance(packages, dict) else None
        if isinstance(root, dict):
            locked_dependencies = root.get("dependencies", {})
            if isinstance(locked_dependencies, dict):
                for name, _version in expected.items():
                    if (
                        name in dependencies
                        and name in locked_dependencies
                        and locked_dependencies[name] != dependencies[name]
                    ):
                        raise ContractError(
                            ErrorCategory.DETERMINISTIC_FAILURE,
                            "Framework lockfile does not match package dependencies",
                            details={"dependency": name},
                        )


def _normalize_files(files: Mapping[str, str | bytes]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    folded: set[str] = set()
    for path, content in files.items():
        if not isinstance(path, str) or not path or "\\" in path:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Framework file path is unsafe",
            )
        parts = path.split("/")
        if path.startswith("/") or any(part in {"", ".", ".."} for part in parts):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Framework file path must be relative",
            )
        if path in normalized:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework file path is duplicated",
            )
        if path.casefold() in folded:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Framework file path differs only by case",
            )
        folded.add(path.casefold())
        normalized[path] = _as_text(content)
    return dict(sorted(normalized.items()))


def _as_text(value: str | bytes) -> str:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Framework source files must be UTF-8 text in this profile",
            ) from exc
    if isinstance(value, str):
        return value
    raise ContractError(
        ErrorCategory.POLICY_BLOCKED,
        "Framework source content must be text or UTF-8 bytes",
    )


def _tree_hash(files: Mapping[str, str]) -> str:
    entries = [
        (path, hashlib.sha256(content.encode("utf-8")).hexdigest())
        for path, content in files.items()
    ]
    return hashlib.sha256(canonical_json(entries).encode("utf-8")).hexdigest()
