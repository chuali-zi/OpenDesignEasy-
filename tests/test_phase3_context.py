from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from oeydesign.context import (
    CsvEvidenceParser,
    DeterministicContextAssembler,
    EvidenceService,
    LocalSourceStore,
)
from oeydesign.domain import (
    BriefRecord,
    ConstraintProfileRecord,
    ContextRequirements,
    ContractError,
    DesignBrief,
    EvidenceLayer,
    RightsStatus,
    constraint_profile,
)


class Repo:
    def __init__(self) -> None:
        self.sources = {}
        self.evidence = {}
        self.contexts = {}

    def add_source(self, source) -> None:
        self.sources[(source.id, source.revision)] = source

    def get_source(self, source_id, revision=None):
        if revision is not None:
            return self.sources[(source_id, revision)]
        matches = [
            source
            for (candidate_id, _), source in self.sources.items()
            if candidate_id == source_id
        ]
        return max(matches, key=lambda source: source.revision)

    def list_sources(self, project_id):
        latest = {}
        for source in self.sources.values():
            if source.project_id == project_id:
                latest[source.id] = max(
                    source,
                    latest.get(source.id, source),
                    key=lambda item: item.revision,
                )
        return tuple(latest.values())

    def add_evidence(self, records) -> None:
        self.evidence.update({record.id: record for record in records})

    def get_evidence(self, evidence_id):
        return self.evidence[evidence_id]

    def list_evidence(self, project_id):
        return tuple(
            record
            for record in self.evidence.values()
            if record.project_id == project_id
        )

    def save_context(self, package) -> None:
        self.contexts[package.project_id] = package

    def latest_context(self, project_id):
        return self.contexts.get(project_id)


def png_header(width: int = 2, height: int = 3) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\rIHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + b"\x08\x02\x00\x00\x00"
    )


def confirmed_inputs(project_id: str = "project"):
    brief = BriefRecord(
        "brief-1",
        project_id,
        1,
        DesignBrief("Launch", "Design leaders", "web"),
        True,
    )
    constraints = ConstraintProfileRecord(
        "constraints-1", project_id, 1, constraint_profile(), True
    )
    return brief, constraints


def test_csv_png_provenance_layers_rights_and_resolution(tmp_path: Path) -> None:
    repository = Repo()
    service = EvidenceService(repository, LocalSourceStore(tmp_path))
    payload = b"product,value\nOEYdesign,1\n"
    csv_source, native = service.ingest_parse(
        "project",
        payload,
        "text/csv",
        "../facts.csv",
        RightsStatus.UNKNOWN,
    )
    fact = next(record for record in native if record.evidence_key == "csv.product")
    assert fact.locator.selector == {
        "row": 2,
        "column": "product",
        "column_index": 1,
    }
    machine = service.interpret(fact, "OEY design", 0.4)
    human = service.confirm(machine, "OEYdesign")
    assert machine.derived_from == (fact.id,)
    assert human.layer is EvidenceLayer.HUMAN_CONFIRMATION
    assert human.derived_from == (machine.id,)
    assert human.rights is RightsStatus.UNKNOWN
    resolved_source, resolved_payload = service.resolve("project", human.locator)
    assert resolved_source == csv_source
    assert resolved_payload == payload
    assert csv_source.original_name == "facts.csv"
    with pytest.raises(ContractError) as cross_project:
        service.resolve("other-project", human.locator)
    assert cross_project.value.category.value == "POLICY_BLOCKED"

    revised = service.revise_rights(csv_source, RightsStatus.CLEARED_FOR_DELIVERY)
    assert revised.revision == 2
    assert (
        repository.get_source(csv_source.id).rights is RightsStatus.CLEARED_FOR_DELIVERY
    )

    _, image_records = service.ingest_parse(
        "project",
        png_header(),
        "image/png",
        "photo.png",
        RightsStatus.ANALYSIS_ONLY,
    )
    assert image_records[0].value == {"width": 2, "height": 3}
    assert image_records[0].locator.selector == {"region": "whole-image"}


def test_only_material_uncertainty_and_rights_enter_context(tmp_path: Path) -> None:
    repository = Repo()
    service = EvidenceService(repository, LocalSourceStore(tmp_path))
    source, records = service.ingest_parse(
        "project",
        b"product\nOEYdesign\n",
        "text/csv",
        "facts.csv",
        RightsStatus.ANALYSIS_ONLY,
    )
    fact = next(record for record in records if record.evidence_key == "csv.product")
    low = service.interpret(fact, "Maybe OEY", 0.2)
    image, image_records = service.ingest_parse(
        "project",
        png_header(),
        "image/png",
        "mood.png",
        RightsStatus.UNKNOWN,
    )
    unrelated = service.interpret(image_records[0], "calm", 0.1)
    brief, constraints = confirmed_inputs()
    assembler = DeterministicContextAssembler()
    blocked = assembler.assemble(
        project_id="project",
        sources=repository.list_sources("project"),
        evidence=(low, unrelated),
        requirements=ContextRequirements(
            required_fact_keys=("csv.product",),
            required_delivery_source_ids=(source.id,),
        ),
        brief=brief,
        constraints=constraints,
        revision=1,
    )
    assert blocked.confirmed_facts == ()
    assert "low-confidence:csv.product" in blocked.material_uncertainties
    assert not any(
        "image.dimensions" in issue for issue in blocked.material_uncertainties
    )
    assert blocked.delivery_asset_refs == ()

    confirmed = service.confirm(low, "OEYdesign")
    cleared = service.revise_rights(source, RightsStatus.CLEARED_FOR_DELIVERY)
    ready = assembler.assemble(
        project_id="project",
        sources=(cleared, image),
        evidence=(low, unrelated, confirmed),
        requirements=ContextRequirements(
            required_fact_keys=("csv.product",),
            required_delivery_source_ids=(source.id,),
        ),
        brief=brief,
        constraints=constraints,
        revision=2,
    )
    assert ready.material_uncertainties == ()
    assert ready.confirmed_facts == ("csv.product=OEYdesign",)
    assert ready.source_refs[0].startswith(f"source:{source.id}@1#")
    assert ready.delivery_asset_refs[0].source_revision == 2
    assert ready.brief_record_id == brief.id
    assert ready.constraint_record_revision == constraints.revision


def test_machine_confidence_never_replaces_confirmation_and_prohibited_is_excluded(
    tmp_path: Path,
) -> None:
    repository = Repo()
    service = EvidenceService(repository, LocalSourceStore(tmp_path))
    source, records = service.ingest_parse(
        "project",
        b"brand\nOEYdesign\n",
        "text/csv",
        "brand.csv",
        RightsStatus.PROHIBITED,
    )
    fact = next(record for record in records if record.evidence_key == "csv.brand")
    high_confidence = service.interpret(fact, "OEYdesign", 0.99)
    brief, constraints = confirmed_inputs()

    package = DeterministicContextAssembler().assemble(
        project_id="project",
        sources=(source,),
        evidence=(high_confidence,),
        requirements=ContextRequirements(required_fact_keys=("csv.brand",)),
        brief=brief,
        constraints=constraints,
        revision=1,
    )

    assert package.confirmed_facts == ()
    assert package.material_uncertainties == ("confirmation-required:csv.brand",)
    assert package.analysis_asset_refs == ()
    assert package.delivery_asset_refs == ()


def test_parser_replacement_preserves_downstream_context_contract(
    tmp_path: Path,
) -> None:
    class AlternateCsvParser(CsvEvidenceParser):
        capability_version = "alternate-csv/1"

        def parse(self, source, payload):
            return tuple(
                replace(record, capability_version=self.capability_version)
                for record in super().parse(source, payload)
            )

    packages = []
    for name, parser in (
        ("default", CsvEvidenceParser()),
        ("alternate", AlternateCsvParser()),
    ):
        repository = Repo()
        service = EvidenceService(
            repository,
            LocalSourceStore(tmp_path / name),
            parsers=(parser,),
        )
        source, records = service.ingest_parse(
            "project",
            b"product\nOEYdesign\n",
            "text/csv",
            "facts.csv",
            RightsStatus.CLEARED_FOR_DELIVERY,
        )
        fact = next(
            record for record in records if record.evidence_key == "csv.product"
        )
        confirmation = service.confirm(fact)
        brief, constraints = confirmed_inputs()
        packages.append(
            DeterministicContextAssembler().assemble(
                project_id="project",
                sources=(source,),
                evidence=(confirmation,),
                requirements=ContextRequirements(required_fact_keys=("csv.product",)),
                brief=brief,
                constraints=constraints,
                revision=1,
            )
        )
    assert packages[0] == packages[1]
    assert "alternate-csv/1" not in repr(packages[1])


def test_rejects_unsafe_or_tampered_inputs(tmp_path: Path) -> None:
    limited = LocalSourceStore(tmp_path, max_bytes=3)
    with pytest.raises(ContractError):
        limited.put("project", b"1234", "text/csv", "facts.csv", RightsStatus.UNKNOWN)
    with pytest.raises(ContractError):
        LocalSourceStore(tmp_path).put(
            "project", b"bad", "image/png", "image.png", RightsStatus.UNKNOWN
        )
    with pytest.raises(ContractError):
        LocalSourceStore(tmp_path).put(
            "project", b"a\x00b", "text/csv", "facts.csv", RightsStatus.UNKNOWN
        )

    store = LocalSourceStore(tmp_path)
    source = store.put(
        "project", b"fact\n", "text/csv", "facts.csv", RightsStatus.UNKNOWN
    )
    target = tmp_path / source.storage_ref
    target.write_bytes(b"tampered")
    with pytest.raises(ContractError):
        store.read(source)
