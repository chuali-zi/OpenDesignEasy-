from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from oeydesign.composition import SQLiteApplication
from oeydesign.domain import (
    ContextRequirements,
    ContractError,
    CreateProject,
    DesignBrief,
    GenerateCandidates,
    PrepareProject,
    ProjectState,
    RightsStatus,
    constraint_profile,
)

FIXED_TIME = datetime(2026, 7, 24, 14, 0, tzinfo=UTC)
PRIVATE_BRIEF = "PRIVATE-BRIEF-GOAL-99"


def send(app, project_id: str, command_type, command_id: str, **values):
    project = app.repository.get(project_id)
    return app.control.execute(
        command_type(
            command_id=command_id,
            project_id=project_id,
            expected_project_revision=project.revision,
            **values,
        )
    )


def test_evidence_to_control_plane_and_design_survives_restart(
    tmp_path: Path,
) -> None:
    database = tmp_path / "application.sqlite"
    project_id = "evidence-project"
    payload = b"product,claim\nOEYdesign,PRIVATE-EVIDENCE-42\n"
    with SQLiteApplication(
        database, data_root=tmp_path, clock=lambda: FIXED_TIME
    ) as app:
        app.control.execute(
            CreateProject(
                command_id="evidence:create",
                project_id=project_id,
                name="Evidence demo",
            )
        )
        with pytest.raises(ContractError):
            app.evidence.ingest_parse(
                "missing-project",
                payload,
                "text/csv",
                "facts.csv",
                RightsStatus.UNKNOWN,
            )

        source, native = app.evidence.ingest_parse(
            project_id,
            payload,
            "text/csv",
            "facts.csv",
            RightsStatus.ANALYSIS_ONLY,
        )
        fact = next(record for record in native if record.evidence_key == "csv.product")
        interpretation = app.evidence.interpret(fact, "OEYdesign", 0.3)
        brief_draft = app.evidence.draft_brief(
            project_id, DesignBrief(PRIVATE_BRIEF, "Product leaders", "web")
        )
        constraints_draft = app.evidence.draft_constraints(
            project_id, constraint_profile()
        )
        requirements = ContextRequirements(
            required_fact_keys=("csv.product",),
            required_delivery_source_ids=(source.id,),
        )
        unconfirmed = app.context_assembler.assemble(
            project_id=project_id,
            sources=(source,),
            evidence=(*native, interpretation),
            requirements=requirements,
            brief=brief_draft,
            constraints=constraints_draft,
            revision=1,
        )
        assert "brief-confirmation" in unconfirmed.material_uncertainties
        assert "constraint-confirmation" in unconfirmed.material_uncertainties

        brief = app.evidence.confirm_brief(brief_draft)
        constraints = app.evidence.confirm_constraints(constraints_draft)
        blocked_context = app.context_assembler.assemble(
            project_id=project_id,
            sources=(source,),
            evidence=(*native, interpretation),
            requirements=requirements,
            brief=brief,
            constraints=constraints,
            revision=1,
        )
        app.evidence_repository.save_context(blocked_context)
        blocked = send(
            app,
            project_id,
            PrepareProject,
            "evidence:prepare-blocked",
            context_package=blocked_context,
            brief=brief.brief,
        )
        assert blocked.state is ProjectState.NEEDS_INPUT
        assert "low-confidence:csv.product" in blocked_context.material_uncertainties
        assert any(
            issue.startswith(f"rights:{source.id}")
            for issue in blocked_context.material_uncertainties
        )

        confirmation = app.evidence.confirm(interpretation, "OEYdesign")
        cleared = app.evidence.revise_rights(source, RightsStatus.CLEARED_FOR_DELIVERY)
        ready_context = app.context_assembler.assemble(
            project_id=project_id,
            sources=app.evidence_repository.list_sources(project_id),
            evidence=app.evidence_repository.list_evidence(project_id),
            requirements=requirements,
            brief=brief,
            constraints=constraints,
            revision=2,
        )
        app.evidence_repository.save_context(ready_context)
        ready = send(
            app,
            project_id,
            PrepareProject,
            "evidence:prepare-ready",
            context_package=ready_context,
            brief=brief.brief,
        )
        assert ready.state is ProjectState.READY_FOR_DESIGN
        candidates = send(
            app,
            project_id,
            GenerateCandidates,
            "evidence:generate",
        ).value
        assert candidates
        assert candidates[0].source_refs == ready_context.source_refs
        project_events = app.repository.get(project_id).events
        assert "PRIVATE-EVIDENCE-42" not in repr(project_events)
        assert PRIVATE_BRIEF not in repr(project_events)
        assert all("brief_goal" not in event.payload for event in project_events)
        assert ready_context.delivery_asset_refs[0].source_revision == cleared.revision

    with SQLiteApplication(
        database, data_root=tmp_path, clock=lambda: FIXED_TIME
    ) as reopened:
        assert reopened.evidence_repository.latest_context(project_id) == ready_context
        assert (
            reopened.evidence_repository.get_source(source.id).rights
            is RightsStatus.CLEARED_FOR_DELIVERY
        )
        resolved_source, resolved_payload = reopened.evidence.resolve(
            project_id, confirmation.locator
        )
        assert resolved_source.revision == 1
        assert resolved_payload == payload
        project = reopened.repository.get(project_id)
        assert project.state is ProjectState.AWAITING_DIRECTION_APPROVAL
        assert project.context_package == ready_context
