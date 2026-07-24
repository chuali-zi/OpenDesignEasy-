"""Filesystem policy helpers for durable local state."""

from __future__ import annotations

from pathlib import Path

from .domain import ContractError, ErrorCategory


def resolve_database_path(
    database: str | Path, data_root: str | Path | None = None
) -> str:
    """Return a validated SQLite path, preventing writes outside ``data_root``."""
    if str(database) == ":memory:":
        return ":memory:"
    if data_root is None:
        raise ContractError(
            ErrorCategory.POLICY_BLOCKED, "file database requires data_root"
        )
    root = Path(data_root).resolve()
    requested = Path(database)
    target = (root / requested if not requested.is_absolute() else requested).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ContractError(
            ErrorCategory.POLICY_BLOCKED, "database path is outside data_root"
        ) from exc
    target.parent.mkdir(parents=True, exist_ok=True)
    return str(target)
