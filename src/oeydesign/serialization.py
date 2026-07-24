"""Versioned, dependency-free JSON serialization for OEYdesign domain values."""

from __future__ import annotations

import importlib
import json
from dataclasses import fields, is_dataclass
from datetime import datetime
from enum import Enum
from typing import Any, cast

SCHEMA_VERSION = 1
_TYPE = "__oeydesign_type__"


def _name(value: type[object]) -> str:
    return f"{value.__module__}:{value.__qualname__}"


def _resolve(name: str) -> type[object]:
    module_name, _, qualname = name.partition(":")
    if module_name != "oeydesign.domain" or not qualname:
        raise ValueError(f"Unsupported serialized type: {name}")
    value: object = importlib.import_module(module_name)
    for part in qualname.split("."):
        value = getattr(value, part)
    if not isinstance(value, type):
        raise ValueError(f"Serialized type is not a class: {name}")
    return value


def _encode(value: Any) -> Any:
    if isinstance(value, Enum):
        return {_TYPE: "enum", "class": _name(type(value)), "value": value.value}
    if isinstance(value, datetime):
        return {_TYPE: "datetime", "value": value.isoformat()}
    if is_dataclass(value) and not isinstance(value, type):
        return {
            _TYPE: "dataclass",
            "class": _name(type(value)),
            "fields": {
                field.name: _encode(getattr(value, field.name))
                for field in fields(value)
            },
        }
    if isinstance(value, tuple):
        return {_TYPE: "tuple", "items": [_encode(item) for item in value]}
    if isinstance(value, list):
        return [_encode(item) for item in value]
    if isinstance(value, dict):
        return {
            _TYPE: "dict",
            "items": [[_encode(key), _encode(item)] for key, item in value.items()],
        }
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"Cannot serialize {type(value).__name__}")


def _decode(value: Any) -> Any:
    if isinstance(value, list):
        return [_decode(item) for item in value]
    if not isinstance(value, dict):
        return value
    kind = value.get(_TYPE)
    if kind is None:
        return {key: _decode(item) for key, item in value.items()}
    if kind == "datetime":
        return datetime.fromisoformat(value["value"])
    if kind == "tuple":
        return tuple(_decode(item) for item in value["items"])
    if kind == "dict":
        return {_decode(key): _decode(item) for key, item in value["items"]}
    cls = cast(Any, _resolve(value["class"]))
    if kind == "enum":
        return cls(value["value"])
    if kind == "dataclass":
        return cls(**{key: _decode(item) for key, item in value["fields"].items()})
    raise ValueError(f"Unknown serialized value kind: {kind}")


def dumps(value: Any) -> str:
    """Encode a domain value in a schema-versioned JSON envelope."""
    return json.dumps(
        {"schema_version": SCHEMA_VERSION, "value": _encode(value)},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def loads(payload: str) -> Any:
    """Decode a payload produced by :func:`dumps`."""
    document = json.loads(payload)
    if document.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(
            f"Unsupported schema version: {document.get('schema_version')}"
        )
    return _decode(document["value"])


serialize = dumps
deserialize = loads
