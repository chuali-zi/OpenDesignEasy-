"""Read-only, authorized repository snapshots for the first P6 slice."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from .domain import (
    ContractError,
    ErrorCategory,
    EvidenceLayer,
    EvidenceRecord,
    RightsStatus,
    SourceAsset,
    SourceKind,
    SourceLocator,
    canonical_json,
    stable_id,
)
from .ports import EvidenceRepositoryPort, ProjectRepository

_EXCLUDED_DIRECTORY_NAMES = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        "dist",
        "build",
        "out",
        ".next",
        ".vite",
        ".cache",
        "coverage",
        "__pycache__",
        ".venv",
        "venv",
    }
)
_CREDENTIAL_NAMES = frozenset(
    {
        ".npmrc",
        ".pypirc",
        "credentials",
        "credentials.json",
        "secret",
        "secrets",
        "secrets.json",
        "id_rsa",
        "id_ed25519",
    }
)
_CREDENTIAL_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".crt")
_MANIFEST_VERSION = 1


@dataclass(frozen=True, slots=True)
class RepositoryAuthorization:
    """Opaque host-side authorization produced by an explicit user selection."""

    root: str
    authorization_id: str
    device: int
    inode: int

    @classmethod
    def from_user_selection(cls, root: str | Path) -> RepositoryAuthorization:
        candidate = Path(root)
        try:
            if candidate.is_symlink() or _is_reparse(candidate.lstat()):
                raise _policy("Repository root cannot be a link or junction")
            resolved = candidate.resolve(strict=True)
            stat = resolved.stat()
        except ContractError:
            raise
        except (FileNotFoundError, OSError) as exc:
            raise _policy("Repository root is unavailable") from exc
        if not resolved.is_dir():
            raise _policy("Repository root must be a directory")
        return cls(
            str(resolved),
            stable_id("repository-authorization", str(resolved)),
            int(stat.st_dev),
            int(stat.st_ino),
        )

    def current_root(self) -> Path:
        candidate = Path(self.root)
        try:
            if candidate.is_symlink() or _is_reparse(candidate.lstat()):
                raise _policy("Authorized repository root became a link or junction")
            resolved = candidate.resolve(strict=True)
            stat = resolved.stat()
        except ContractError:
            raise
        except (FileNotFoundError, OSError) as exc:
            raise _policy("Authorized repository root is unavailable") from exc
        if (
            not resolved.is_dir()
            or int(stat.st_dev) != self.device
            or int(stat.st_ino) != self.inode
        ):
            raise _policy("Authorized repository root changed")
        return resolved


@dataclass(frozen=True, slots=True)
class RepositoryFileSummary:
    path: str
    byte_size: int
    sha256_digest: str
    line_count: int


@dataclass(frozen=True, slots=True)
class RepositoryIngestionResult:
    source: SourceAsset
    observations: tuple[EvidenceRecord, ...]
    files: tuple[RepositoryFileSummary, ...]


@dataclass(frozen=True, slots=True)
class _CollectedFile:
    summary: RepositoryFileSummary
    payload: bytes


class RepositoryIngestion:
    """Materialize an authorized repository as a bounded read-only snapshot."""

    capability_version = "repository-ingestion/1"
    p6_slot = "context.repository"
    ready_for_p6 = True
    media_type = "application/x-oeydesign-repository"

    def __init__(
        self,
        repository: EvidenceRepositoryPort,
        data_root: str | Path,
        *,
        project_repository: ProjectRepository | None = None,
        max_files: int = 5_000,
        max_bytes: int = 50_000_000,
    ) -> None:
        if max_files < 1 or max_bytes < 1:
            raise ValueError("Repository limits must be positive")
        self.repository = repository
        self.data_root = Path(data_root).resolve()
        self.project_repository = project_repository
        self.max_files = max_files
        self.max_bytes = max_bytes

    @staticmethod
    def authorize(root: str | Path) -> RepositoryAuthorization:
        return RepositoryAuthorization.from_user_selection(root)

    def ingest_repository(
        self,
        project_id: str,
        authorization: RepositoryAuthorization,
        *,
        rights: RightsStatus = RightsStatus.ANALYSIS_ONLY,
    ) -> RepositoryIngestionResult:
        if self.project_repository is not None:
            self.project_repository.get(project_id)
        if not isinstance(authorization, RepositoryAuthorization):
            raise _policy("Repository ingestion requires an authorization handle")
        root = authorization.current_root()
        files = self._collect(root)
        manifest = {
            "version": _MANIFEST_VERSION,
            "files": [
                {
                    "path": item.summary.path,
                    "byte_size": item.summary.byte_size,
                    "sha256_digest": item.summary.sha256_digest,
                    "line_count": item.summary.line_count,
                }
                for item in files
            ],
        }
        manifest_payload = canonical_json(manifest).encode("utf-8")
        digest = hashlib.sha256(manifest_payload).hexdigest()
        scope = stable_id("source-scope", project_id)
        artifact_root = self.data_root / "sources" / scope / digest[:2] / digest
        repo_root = artifact_root / "repo"
        self._materialize(artifact_root, repo_root, manifest_payload, files)
        original_name = root.name or root.anchor or "repository"
        source = SourceAsset(
            stable_id("source", project_id, "repository", digest),
            project_id,
            1,
            SourceKind.CODE_REPOSITORY,
            _clean_name(original_name),
            self.media_type,
            sum(item.summary.byte_size for item in files),
            digest,
            str(repo_root.relative_to(self.data_root)).replace("\\", "/"),
            rights,
        )
        self.repository.add_source(source)
        observations = self._observations(source, files)
        self.repository.add_evidence(observations)
        return RepositoryIngestionResult(
            source, observations, tuple(item.summary for item in files)
        )

    def read_file(self, source: SourceAsset, locator: SourceLocator) -> bytes:
        if source.kind is not SourceKind.CODE_REPOSITORY:
            raise _policy("Source is not a code repository")
        if locator.source_id != source.id or locator.source_revision != source.revision:
            raise _policy("Repository locator does not match Source revision")
        selector = locator.selector
        relative = selector.get("path")
        if not isinstance(relative, str):
            raise _policy("Repository locator requires a relative path")
        normalized = _safe_relative_path(relative)
        manifest = self._load_manifest(source)
        expected = next(
            (item for item in manifest["files"] if item["path"] == normalized), None
        )
        if expected is None:
            raise _policy("Repository file is not in the authorized snapshot")
        target = self._safe_snapshot_path(source, normalized)
        try:
            payload = target.read_bytes()
        except (FileNotFoundError, OSError) as exc:
            raise _policy("Repository snapshot file is unavailable") from exc
        if (
            len(payload) != int(expected["byte_size"])
            or hashlib.sha256(payload).hexdigest() != expected["sha256_digest"]
        ):
            raise _policy("Repository snapshot file digest mismatch")
        return payload

    def list_files(self, source: SourceAsset) -> tuple[RepositoryFileSummary, ...]:
        manifest = self._load_manifest(source)
        return tuple(
            RepositoryFileSummary(
                str(item["path"]),
                int(item["byte_size"]),
                str(item["sha256_digest"]),
                int(item["line_count"]),
            )
            for item in manifest["files"]
            if isinstance(item, dict)
        )

    def _collect(self, root: Path) -> tuple[_CollectedFile, ...]:
        collected: list[_CollectedFile] = []
        folded_paths: set[str] = set()
        total_bytes = 0

        def visit(directory: Path, relative_directory: PurePosixPath) -> None:
            nonlocal total_bytes
            try:
                with os.scandir(directory) as iterator:
                    entries = sorted(iterator, key=lambda entry: entry.name)
            except OSError as exc:
                raise _policy("Repository directory cannot be read") from exc
            for entry in entries:
                name = entry.name
                relative = relative_directory / name
                try:
                    entry_stat = entry.stat(follow_symlinks=False)
                except OSError as exc:
                    raise _policy("Repository entry cannot be inspected") from exc
                if entry.is_symlink() or _is_reparse(entry_stat):
                    raise _policy(f"Repository link or junction rejected: {relative}")
                if entry.is_dir(follow_symlinks=False):
                    if name.casefold() in _EXCLUDED_DIRECTORY_NAMES:
                        continue
                    visit(Path(entry.path), relative)
                    continue
                if not entry.is_file(follow_symlinks=False):
                    continue
                if _is_credential_file(name):
                    continue
                if len(collected) >= self.max_files:
                    raise _policy("Repository file count exceeds the limit")
                try:
                    before = entry.stat(follow_symlinks=False)
                    size = int(before.st_size)
                    if size < 0 or total_bytes + size > self.max_bytes:
                        raise _policy("Repository size exceeds the limit")
                    with Path(entry.path).open("rb") as stream:
                        payload = stream.read(self.max_bytes - total_bytes + 1)
                    after = entry.stat(follow_symlinks=False)
                except ContractError:
                    raise
                except OSError as exc:
                    raise _policy("Repository file cannot be read") from exc
                if len(payload) != size or (
                    int(before.st_size),
                    int(before.st_mtime_ns),
                    int(before.st_ino),
                ) != (
                    int(after.st_size),
                    int(after.st_mtime_ns),
                    int(after.st_ino),
                ):
                    raise _policy("Repository file changed during ingestion")
                normalized = relative.as_posix()
                folded = normalized.casefold()
                if folded in folded_paths:
                    raise _policy("Repository paths differ only by case")
                folded_paths.add(folded)
                summary = RepositoryFileSummary(
                    normalized,
                    size,
                    hashlib.sha256(payload).hexdigest(),
                    _line_count(payload),
                )
                collected.append(_CollectedFile(summary, payload))
                total_bytes += size

        visit(root, PurePosixPath())
        return tuple(collected)

    @staticmethod
    def _materialize(
        artifact_root: Path,
        repo_root: Path,
        manifest_payload: bytes,
        files: tuple[_CollectedFile, ...],
    ) -> None:
        manifest_path = artifact_root / "manifest.json"
        if artifact_root.exists():
            if not artifact_root.is_dir() or not manifest_path.is_file():
                raise _collision("Repository snapshot directory is incomplete")
            try:
                if manifest_path.read_bytes() != manifest_payload:
                    raise _collision("Repository snapshot manifest collision")
            except OSError as exc:
                raise _policy("Repository snapshot cannot be verified") from exc
            return
        artifact_root.mkdir(parents=True, exist_ok=False)
        repo_root.mkdir()
        for item in files:
            target = repo_root / Path(item.summary.path)
            resolved = target.resolve()
            try:
                resolved.relative_to(repo_root.resolve())
            except ValueError as exc:
                raise _policy("Repository snapshot path escaped") from exc
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(item.payload)
        manifest_path.write_bytes(manifest_payload)

    def _observations(
        self, source: SourceAsset, files: tuple[_CollectedFile, ...]
    ) -> tuple[EvidenceRecord, ...]:
        records: list[EvidenceRecord] = []
        for item in files:
            summary = item.summary
            locator = SourceLocator(
                source.id,
                source.revision,
                {
                    "path": summary.path,
                    "line_start": 1,
                    "line_end": summary.line_count,
                },
            )
            records.append(
                EvidenceRecord(
                    stable_id("evidence", source.id, "file", summary.path),
                    source.project_id,
                    1,
                    EvidenceLayer.NATIVE_OBSERVATION,
                    f"repository.file.{summary.path}",
                    {
                        "path": summary.path,
                        "byte_size": summary.byte_size,
                        "sha256_digest": summary.sha256_digest,
                        "line_count": summary.line_count,
                    },
                    locator,
                    1.0,
                    (),
                    source.rights,
                    self.capability_version,
                )
            )
        root_locator = SourceLocator(
            source.id,
            source.revision,
            {"path": ".", "line_start": 1, "line_end": 1},
        )
        records.insert(
            0,
            EvidenceRecord(
                stable_id("evidence", source.id, "manifest"),
                source.project_id,
                1,
                EvidenceLayer.NATIVE_OBSERVATION,
                "repository.manifest",
                {"file_count": len(files), "byte_size": source.byte_size},
                root_locator,
                1.0,
                (),
                source.rights,
                self.capability_version,
            ),
        )
        return tuple(records)

    def _load_manifest(self, source: SourceAsset) -> dict[str, Any]:
        if source.kind is not SourceKind.CODE_REPOSITORY:
            raise _policy("Source is not a code repository")
        artifact_root = (self.data_root / source.storage_ref).resolve().parent
        try:
            artifact_root.relative_to(self.data_root)
            payload = (artifact_root / "manifest.json").read_bytes()
        except (ValueError, FileNotFoundError, OSError) as exc:
            raise _policy("Repository snapshot manifest is unavailable") from exc
        if hashlib.sha256(payload).hexdigest() != source.sha256_digest:
            raise _policy("Repository snapshot manifest digest mismatch")
        try:
            manifest = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise _policy("Repository snapshot manifest is invalid") from exc
        if (
            not isinstance(manifest, dict)
            or manifest.get("version") != _MANIFEST_VERSION
            or not isinstance(manifest.get("files"), list)
        ):
            raise _policy("Repository snapshot manifest has an unsupported shape")
        return manifest

    def _safe_snapshot_path(self, source: SourceAsset, relative: str) -> Path:
        root = (self.data_root / source.storage_ref).resolve()
        try:
            root.relative_to(self.data_root)
        except ValueError as exc:
            raise _policy("Repository storage reference escaped") from exc
        target = (root / Path(relative)).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise _policy("Repository locator escaped the snapshot") from exc
        current = root
        for part in PurePosixPath(relative).parts:
            current = current / part
            if current.is_symlink():
                raise _policy("Repository snapshot symbolic link rejected")
        return target


def _safe_relative_path(value: str) -> str:
    if not value or "\x00" in value or "\\" in value:
        raise _policy("Repository locator path is unsafe")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise _policy("Repository locator path must be relative")
    return path.as_posix()


def _is_credential_file(name: str) -> bool:
    lowered = name.casefold()
    return (
        lowered.startswith(".env")
        or lowered in _CREDENTIAL_NAMES
        or lowered.endswith(_CREDENTIAL_SUFFIXES)
    )


def _is_reparse(value: os.stat_result) -> bool:
    return bool(int(getattr(value, "st_file_attributes", 0)) & 0x400)


def _line_count(payload: bytes) -> int:
    if not payload:
        return 1
    return max(1, payload.count(b"\n") + 1)


def _clean_name(value: str) -> str:
    cleaned = "".join(
        char if char.isalnum() or char in "._-" else "_" for char in value
    )
    return cleaned or "repository"


def _policy(message: str) -> ContractError:
    return ContractError(ErrorCategory.POLICY_BLOCKED, message)


def _collision(message: str) -> ContractError:
    return ContractError(ErrorCategory.DETERMINISTIC_FAILURE, message)
