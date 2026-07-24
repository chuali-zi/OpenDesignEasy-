from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from oeydesign.domain import (
    ContextPackage,
    ContractError,
    ErrorCategory,
    EvidenceLayer,
    EvidenceRecord,
    RightsStatus,
    SourceAsset,
    SourceKind,
    SourceLocator,
)
from oeydesign.evidence_persistence import SQLiteEvidenceRepository
from oeydesign.persistence import SQLiteStore


def source(
    *,
    project_id: str = "project-1",
    revision: int = 1,
    rights: RightsStatus = RightsStatus.UNKNOWN,
) -> SourceAsset:
    return SourceAsset(
        id="source-1",
        project_id=project_id,
        revision=revision,
        kind=SourceKind.STRUCTURED_FILE,
        original_name="facts.csv",
        media_type="text/csv",
        byte_size=8,
        sha256_digest="abc123",
        storage_ref="sources/ab/abc123",
        rights=rights,
    )


def evidence(value: str = "OEYdesign") -> EvidenceRecord:
    return EvidenceRecord(
        id="evidence-1",
        project_id="project-1",
        revision=1,
        layer=EvidenceLayer.NATIVE_OBSERVATION,
        evidence_key="csv.product",
        value=value,
        locator=SourceLocator("source-1", 1, {"row": 2, "column": "product"}),
        confidence=1.0,
        derived_from=(),
        rights=RightsStatus.UNKNOWN,
        capability_version="csv-test/1",
    )


def package() -> ContextPackage:
    locator = SourceLocator("source-1", 1, {"row": 2, "column": "product"})
    return ContextPackage(
        id="context-1",
        project_id="project-1",
        revision=1,
        confirmed_facts=("OEYdesign",),
        source_refs=("source:source-1@1#row=2&column=product",),
        evidence_refs=(locator,),
        analysis_asset_refs=(SourceLocator("source-1", 1, {"region": "whole"}),),
        brief_record_id="brief-1",
        brief_record_revision=1,
        constraint_record_id="constraints-1",
        constraint_record_revision=1,
    )


def test_source_evidence_and_context_survive_reopen(tmp_path: Path) -> None:
    database = tmp_path / "evidence.sqlite"
    store = SQLiteStore(database, data_root=tmp_path)
    repository = SQLiteEvidenceRepository(store)
    original_source = source()
    original_evidence = evidence()
    original_package = package()
    repository.add_source(original_source)
    repository.add_evidence((original_evidence,))
    repository.save_context(original_package)
    repository.add_source(
        replace(
            original_source,
            revision=2,
            rights=RightsStatus.CLEARED_FOR_DELIVERY,
        )
    )
    assert repository.get_source(original_source.id, 1) == original_source
    assert repository.list_sources(original_source.project_id)[0].revision == 2
    store.close()

    store = SQLiteStore(database, data_root=tmp_path)
    reopened = SQLiteEvidenceRepository(store)
    assert reopened.get_evidence(original_evidence.id) == original_evidence
    assert reopened.latest_context(original_source.project_id) == original_package
    assert (
        reopened.get_source(original_source.id).rights
        is RightsStatus.CLEARED_FOR_DELIVERY
    )
    store.close()


def test_append_only_collisions_and_cross_project_lineage_are_rejected(
    tmp_path: Path,
) -> None:
    store = SQLiteStore(tmp_path / "evidence.sqlite", data_root=tmp_path)
    repository = SQLiteEvidenceRepository(store)
    original = source()
    repository.add_source(original)
    repository.add_source(original)

    with pytest.raises(ContractError) as skipped_revision:
        repository.add_source(replace(original, revision=3))
    assert skipped_revision.value.category is ErrorCategory.DETERMINISTIC_FAILURE

    with pytest.raises(ContractError) as cross_project:
        repository.add_source(replace(original, revision=2, project_id="project-2"))
    assert cross_project.value.category is ErrorCategory.DETERMINISTIC_FAILURE

    child = replace(
        evidence(),
        id="evidence-child",
        layer=EvidenceLayer.MACHINE_INTERPRETATION,
        derived_from=("missing-parent",),
        confidence=0.5,
    )
    with pytest.raises(ContractError) as missing_parent:
        repository.add_evidence((child,))
    assert missing_parent.value.category is ErrorCategory.DETERMINISTIC_FAILURE
    assert repository.list_evidence("project-1") == ()
    store.close()


def test_context_locator_must_resolve_inside_project(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "evidence.sqlite", data_root=tmp_path)
    repository = SQLiteEvidenceRepository(store)
    repository.add_source(source())
    invalid = replace(
        package(),
        evidence_refs=(SourceLocator("missing", 1, {"row": 1}),),
    )
    with pytest.raises(ContractError) as missing_source:
        repository.save_context(invalid)
    assert missing_source.value.category is ErrorCategory.DETERMINISTIC_FAILURE
    assert repository.latest_context("project-1") is None
    store.close()
