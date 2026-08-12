"""Small, replaceable Context & Evidence reference adapters."""

from __future__ import annotations

import csv
import hashlib
import io
import re
import struct
from dataclasses import replace
from pathlib import Path
from typing import Any, Protocol

from .domain import (
    BriefRecord,
    ConstraintProfile,
    ConstraintProfileRecord,
    ContextPackage,
    ContextRequirements,
    ContractError,
    DesignBrief,
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
from .ports import (
    EvidenceConfirmationPort,
    EvidenceInterpreterPort,
    EvidenceParserPort,
    EvidenceRepositoryPort,
    ProjectRepository,
)


class RepositoryReader(Protocol):
    def read_file(self, source: SourceAsset, locator: SourceLocator) -> bytes: ...


class LocalSourceStore:
    def __init__(self, data_root: str | Path, max_bytes: int = 1_000_000):
        self.root = Path(data_root).resolve()
        self.max_bytes = max_bytes

    def put(
        self,
        project_id: str,
        payload: bytes,
        media_type: str,
        filename: str,
        rights: RightsStatus,
    ) -> SourceAsset:
        return self.ingest(
            project_id=project_id,
            original_name=filename,
            media_type=media_type,
            payload=payload,
            rights=rights,
        )

    def ingest(
        self,
        *,
        project_id: str,
        original_name: str,
        media_type: str,
        payload: bytes,
        rights: RightsStatus,
    ) -> SourceAsset:
        if (
            not isinstance(payload, bytes)
            or not payload
            or len(payload) > self.max_bytes
        ):
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "invalid source payload")
        clean = re.sub(r"[^A-Za-z0-9._-]", "_", Path(original_name).name)
        if not clean or clean in {".", ".."} or "\x00" in original_name:
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "unsafe filename")
        kind = self._validate(payload, media_type)
        digest = hashlib.sha256(payload).hexdigest()
        project_scope = stable_id("source-scope", project_id)
        rel = Path("sources") / project_scope / digest[:2] / digest
        target = (self.root / rel).resolve()
        try:
            target.relative_to(self.root)
        except ValueError as exc:
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "storage escape") from exc
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != payload:
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "source digest path contains different bytes",
                )
        else:
            target.write_bytes(payload)
        return SourceAsset(
            stable_id("source", project_id, digest),
            project_id,
            1,
            kind,
            clean,
            media_type,
            len(payload),
            digest,
            str(rel).replace("\\", "/"),
            rights,
        )

    def read(self, source: SourceAsset) -> bytes:
        target = (self.root / source.storage_ref).resolve()
        try:
            target.relative_to(self.root)
        except ValueError as exc:
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "storage escape") from exc
        payload = target.read_bytes()
        if hashlib.sha256(payload).hexdigest() != source.sha256_digest:
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "source digest mismatch")
        return payload

    def get(self, source: SourceAsset) -> bytes:
        return self.read(source)

    @staticmethod
    def _validate(p: bytes, m: str) -> SourceKind:
        if m == "text/csv":
            if b"\x00" in p:
                raise ContractError(ErrorCategory.POLICY_BLOCKED, "CSV contains NUL")
            try:
                p.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED, "CSV must be UTF-8"
                ) from exc
            return SourceKind.STRUCTURED_FILE
        if m == "image/png":
            if (
                len(p) < 24
                or p[:8] != bytes((137, 80, 78, 71, 13, 10, 26, 10))
                or p[8:12] != (13).to_bytes(4, "big")
                or p[12:16] != b"IHDR"
            ):
                raise ContractError(ErrorCategory.POLICY_BLOCKED, "malformed PNG")
            w, h = struct.unpack(">II", p[16:24])
            if not w or not h or w * h > 100_000_000:
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED, "unsafe PNG dimensions"
                )
            return SourceKind.IMAGE
        if m == "image/jpeg":
            if len(p) < 4 or p[:2] != b"\xff\xd8" or p[-2:] != b"\xff\xd9":
                raise ContractError(ErrorCategory.POLICY_BLOCKED, "malformed JPEG")
            return SourceKind.IMAGE
        raise ContractError(ErrorCategory.POLICY_BLOCKED, "unsupported media type")


class CsvEvidenceParser:
    capability_version: str = "csv-header/1"
    supported_media_types: tuple[str, ...] = ("text/csv",)

    def parse(self, s: SourceAsset, p: bytes) -> tuple[EvidenceRecord, ...]:
        rows = list(csv.reader(io.StringIO(p.decode("utf-8"))))
        if not rows or not rows[0] or len(rows) > 1_001:
            raise ContractError(ErrorCategory.POLICY_BLOCKED, "invalid CSV structure")
        if max(len(row) for row in rows) > 100:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED, "CSV has too many columns"
            )
        headers = tuple(
            self._header_key(value, index)
            for index, value in enumerate(rows[0], start=1)
        )
        records: list[EvidenceRecord] = []
        for column, (header, value) in enumerate(
            zip(headers, rows[0], strict=True), start=1
        ):
            records.append(
                self._record(
                    s,
                    evidence_key=f"csv.header.{column}",
                    value=value,
                    row=1,
                    column=column,
                    header=header,
                )
            )
        for row_index, row in enumerate(rows[1:], start=2):
            for column, value in enumerate(row, start=1):
                header = (
                    headers[column - 1]
                    if column <= len(headers)
                    else f"column_{column}"
                )
                records.append(
                    self._record(
                        s,
                        evidence_key=f"csv.{header}",
                        value=value,
                        row=row_index,
                        column=column,
                        header=header,
                    )
                )
        return tuple(records)

    def _record(
        self,
        source: SourceAsset,
        *,
        evidence_key: str,
        value: str,
        row: int,
        column: int,
        header: str,
    ) -> EvidenceRecord:
        locator = SourceLocator(
            source.id,
            source.revision,
            {"row": row, "column": header, "column_index": column},
        )
        return EvidenceRecord(
            stable_id("evidence", source.id, source.revision, locator),
            source.project_id,
            1,
            EvidenceLayer.NATIVE_OBSERVATION,
            evidence_key,
            value,
            locator,
            1.0,
            (),
            source.rights,
            self.capability_version,
        )

    @staticmethod
    def _header_key(value: str, column: int) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
        return normalized or f"column_{column}"


class PngEvidenceParser:
    capability_version: str = "png-header/1"
    supported_media_types: tuple[str, ...] = ("image/png",)

    def parse(self, s: SourceAsset, p: bytes) -> tuple[EvidenceRecord, ...]:
        LocalSourceStore._validate(p, "image/png")
        w, h = struct.unpack(">II", p[16:24])
        loc = SourceLocator(s.id, s.revision, {"region": "whole-image"})
        return (
            EvidenceRecord(
                stable_id("evidence", s.id, w, h),
                s.project_id,
                1,
                EvidenceLayer.NATIVE_OBSERVATION,
                "image.dimensions",
                {"width": w, "height": h},
                loc,
                1.0,
                (),
                s.rights,
                self.capability_version,
            ),
        )


class DeterministicEvidenceInterpreter(EvidenceInterpreterPort):
    capability_version = "evidence-interpreter-stub/1"

    def __init__(self, confidence: float = 0.5) -> None:
        self.confidence = confidence

    def interpret(
        self,
        source: SourceAsset,
        observations: tuple[EvidenceRecord, ...],
        *,
        purpose: str,
    ) -> tuple[EvidenceRecord, ...]:
        return tuple(
            _interpretation_record(
                observation,
                {"purpose": purpose, "observation": observation.value},
                self.confidence,
                self.capability_version,
            )
            for observation in observations
            if observation.locator.source_id == source.id
        )


class HumanEvidenceConfirmer(EvidenceConfirmationPort):
    capability_version = "human-confirmation/1"

    def confirm(
        self,
        evidence: EvidenceRecord,
        *,
        confirmed_value: Any | None = None,
    ) -> EvidenceRecord:
        value = evidence.value if confirmed_value is None else confirmed_value
        return EvidenceRecord(
            stable_id("evidence", "human", evidence.id, value),
            evidence.project_id,
            evidence.revision + 1,
            EvidenceLayer.HUMAN_CONFIRMATION,
            evidence.evidence_key,
            value,
            evidence.locator,
            1.0,
            (evidence.id,),
            evidence.rights,
            self.capability_version,
        )


def _interpretation_record(
    evidence: EvidenceRecord,
    value: Any,
    confidence: float,
    capability_version: str,
) -> EvidenceRecord:
    if not 0.0 <= confidence <= 1.0:
        raise ContractError(
            ErrorCategory.DETERMINISTIC_FAILURE,
            "Evidence confidence must be between zero and one",
        )
    return EvidenceRecord(
        stable_id(
            "evidence",
            "machine",
            evidence.id,
            value,
            confidence,
            capability_version,
        ),
        evidence.project_id,
        evidence.revision + 1,
        EvidenceLayer.MACHINE_INTERPRETATION,
        evidence.evidence_key,
        value,
        evidence.locator,
        confidence,
        (evidence.id,),
        evidence.rights,
        capability_version,
    )


class EvidenceService:
    def __init__(
        self,
        repository: EvidenceRepositoryPort,
        store: LocalSourceStore,
        parsers: tuple[EvidenceParserPort, ...] | None = None,
        confirmer: EvidenceConfirmationPort | None = None,
        project_repository: ProjectRepository | None = None,
        repository_reader: RepositoryReader | None = None,
    ) -> None:
        self.repository = repository
        self.store = store
        if parsers is None:
            configured_parsers: tuple[EvidenceParserPort, ...] = (
                CsvEvidenceParser(),
                PngEvidenceParser(),
            )
        else:
            configured_parsers = parsers
        self.parsers = {
            media_type: parser
            for parser in configured_parsers
            for media_type in parser.supported_media_types
        }
        self.confirmer = confirmer or HumanEvidenceConfirmer()
        self.project_repository = project_repository
        self.repository_reader = repository_reader

    def ingest(self, project_id, payload, media_type, filename, rights):
        return self.ingest_parse(project_id, payload, media_type, filename, rights)

    def resolve(
        self, project_id: str, locator: SourceLocator
    ) -> tuple[SourceAsset, bytes]:
        source = self.repository.get_source(locator.source_id, locator.source_revision)
        if source.project_id != project_id:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Source locator belongs to another Project",
            )
        if source.kind is SourceKind.CODE_REPOSITORY:
            if self.repository_reader is None:
                raise ContractError(
                    ErrorCategory.CAPABILITY_UNAVAILABLE,
                    "No repository reader is configured",
                )
            return source, self.repository_reader.read_file(source, locator)
        return source, self.store.read(source)

    def revise_rights(self, source: SourceAsset, rights: RightsStatus) -> SourceAsset:
        if source.rights is rights:
            return source
        revised = SourceAsset(
            source.id,
            source.project_id,
            source.revision + 1,
            source.kind,
            source.original_name,
            source.media_type,
            source.byte_size,
            source.sha256_digest,
            source.storage_ref,
            rights,
        )
        self.repository.add_source(revised)
        return revised

    def ingest_parse(
        self,
        project_id: str,
        payload: bytes,
        media_type: str,
        filename: str,
        rights: RightsStatus,
    ) -> tuple[SourceAsset, tuple[EvidenceRecord, ...]]:
        if self.project_repository is not None:
            self.project_repository.get(project_id)
        parser = self.parsers.get(media_type)
        if parser is None:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "No evidence parser supports the declared media type",
            )
        source = self.store.ingest(
            project_id=project_id,
            original_name=filename,
            media_type=media_type,
            payload=payload,
            rights=rights,
        )
        self.repository.add_source(source)
        records = parser.parse(source, payload)
        self.repository.add_evidence(records)
        return source, records

    def draft_brief(
        self, project_id: str, brief: DesignBrief, *, revision: int = 1
    ) -> BriefRecord:
        return BriefRecord(
            stable_id("brief", project_id, revision, brief),
            project_id,
            revision,
            brief,
            False,
        )

    @staticmethod
    def confirm_brief(record: BriefRecord) -> BriefRecord:
        return replace(record, revision=record.revision + 1, confirmed=True)

    def draft_constraints(
        self,
        project_id: str,
        profile: ConstraintProfile,
        *,
        revision: int = 1,
    ) -> ConstraintProfileRecord:
        return ConstraintProfileRecord(
            stable_id("constraints", project_id, revision, profile),
            project_id,
            revision,
            profile,
            False,
        )

    @staticmethod
    def confirm_constraints(
        record: ConstraintProfileRecord,
    ) -> ConstraintProfileRecord:
        return replace(record, revision=record.revision + 1, confirmed=True)

    def record_interpretation(
        self,
        evidence: EvidenceRecord,
        value: Any,
        confidence: float,
        capability_version="machine/1",
    ) -> EvidenceRecord:
        record = _interpretation_record(evidence, value, confidence, capability_version)
        self.repository.add_evidence((record,))
        return record

    def interpret(
        self,
        evidence: EvidenceRecord,
        value: Any,
        confidence: float,
        capability_version: str = "machine/1",
    ) -> EvidenceRecord:
        return self.record_interpretation(
            evidence, value, confidence, capability_version
        )

    def confirm(
        self, evidence: EvidenceRecord, value: Any | None = None
    ) -> EvidenceRecord:
        record = self.confirmer.confirm(evidence, confirmed_value=value)
        self.repository.add_evidence((record,))
        return record


class DeterministicContextAssembler:
    capability_version = "context-assembler/1"

    def assemble(
        self,
        *,
        project_id,
        sources: tuple[SourceAsset, ...],
        evidence: tuple[EvidenceRecord, ...],
        requirements: ContextRequirements,
        brief: BriefRecord,
        constraints: ConstraintProfileRecord,
        revision: int,
    ) -> ContextPackage:
        if (
            brief.project_id != project_id
            or constraints.project_id != project_id
            or any(source.project_id != project_id for source in sources)
            or any(record.project_id != project_id for record in evidence)
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Context inputs cannot cross Project boundaries",
            )
        if not 0.0 <= requirements.minimum_interpretation_confidence <= 1.0:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Minimum interpretation confidence must be between zero and one",
            )
        confirmed_records: dict[str, EvidenceRecord] = {}
        for record in sorted(evidence, key=lambda item: (item.revision, item.id)):
            if record.layer is EvidenceLayer.HUMAN_CONFIRMATION:
                confirmed_records[record.evidence_key] = record
        issues: list[str] = []
        for key in requirements.required_fact_keys:
            if key in confirmed_records:
                continue
            interpretations = tuple(
                record
                for record in evidence
                if record.layer is EvidenceLayer.MACHINE_INTERPRETATION
                and record.evidence_key == key
            )
            if (
                interpretations
                and max(item.confidence for item in interpretations)
                < requirements.minimum_interpretation_confidence
            ):
                issues.append(f"low-confidence:{key}")
            elif interpretations:
                issues.append(f"confirmation-required:{key}")
            else:
                issues.append(f"missing-fact:{key}")
        source_by_id = {source.id: source for source in sources}
        delivery = {
            source.id
            for source in sources
            if source.rights is RightsStatus.CLEARED_FOR_DELIVERY
        }
        for source_id in requirements.required_delivery_source_ids:
            source = source_by_id.get(source_id)
            if source is None:
                issues.append(f"missing-asset:{source_id}")
            elif source.id not in delivery:
                issues.append(f"rights:{source_id}:{source.rights.value}")
        if not brief.confirmed:
            issues.append("brief-confirmation")
        if not constraints.confirmed:
            issues.append("constraint-confirmation")
        confirmed = tuple(
            f"{key}={record.value}" for key, record in sorted(confirmed_records.items())
        )
        confirmed_locators = tuple(
            record.locator for _, record in sorted(confirmed_records.items())
        )
        source_refs = tuple(_locator_ref(locator) for locator in confirmed_locators)
        analysis_refs_list: list[SourceLocator] = []
        for source in sources:
            if source.rights is RightsStatus.PROHIBITED:
                continue
            if source.kind is SourceKind.CODE_REPOSITORY:
                repository_locators = tuple(
                    record.locator
                    for record in evidence
                    if record.locator.source_id == source.id
                    and record.locator.source_revision == source.revision
                    and record.layer is EvidenceLayer.NATIVE_OBSERVATION
                )
                analysis_refs_list.extend(
                    repository_locators
                    or (
                        SourceLocator(
                            source.id,
                            source.revision,
                            {"path": ".", "line_start": 1, "line_end": 1},
                        ),
                    )
                )
            else:
                analysis_refs_list.append(
                    SourceLocator(
                        source.id,
                        source.revision,
                        {"region": "whole-source"},
                    )
                )
        analysis_refs = tuple(analysis_refs_list)
        delivery_refs = tuple(
            locator for locator in analysis_refs if locator.source_id in delivery
        )
        return ContextPackage(
            stable_id(
                "context",
                project_id,
                revision,
                confirmed,
                source_refs,
                issues,
                brief,
                constraints,
            ),
            project_id,
            revision,
            confirmed,
            source_refs,
            tuple(sorted(set(issues))),
            confirmed_locators,
            analysis_refs,
            delivery_refs,
            brief.id,
            brief.revision,
            constraints.id,
            constraints.revision,
            {
                "assembler_version": self.capability_version,
                "source_rights": {source.id: source.rights.value for source in sources},
            },
        )


def _locator_ref(locator: SourceLocator) -> str:
    return (
        f"source:{locator.source_id}@{locator.source_revision}#"
        f"{canonical_json(locator.selector)}"
    )
