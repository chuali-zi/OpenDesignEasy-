from __future__ import annotations

import os
from pathlib import Path

import pytest

from oeydesign import (
    ApproveDirection,
    ApproveExport,
    ContextPackage,
    CreateProject,
    DeliverArtifact,
    DesignBrief,
    GenerateCandidates,
    Phase6Application,
    PrepareProject,
    ProduceArtifact,
    ProjectState,
    ValidateArtifact,
    stable_id,
)


def _send(
    app: Phase6Application,
    project_id: str,
    command: type,
    key: str,
    **data: object,
):
    project = app.repository.get(project_id)
    return app.control.execute(
        command(
            command_id=key,
            project_id=project_id,
            expected_project_revision=project.revision,
            **data,
        )
    )


@pytest.mark.skipif(os.name != "nt", reason="Real P6 slice requires Windows Chrome")
def test_all_eight_slots_run_one_real_delivery_slice(tmp_path: Path) -> None:
    dependency_image = (
        Path(__file__).resolve().parents[1]
        / "spikes"
        / "e8-e12-framework"
        / "node_modules"
    )
    if not dependency_image.is_dir():
        pytest.skip("Frozen framework dependency image is unavailable")
    database = tmp_path / "p6.sqlite"
    project_id = "p6-eight-slot"
    with Phase6Application(
        database,
        data_root=tmp_path,
        dependency_image=dependency_image,
    ) as app:
        app.require_real_slice_ready()
        app.control.execute(
            CreateProject(
                command_id="01-create",
                project_id=project_id,
                name="Eight-slot acceptance",
            )
        )
        context = ContextPackage(
            stable_id("context", project_id, 1),
            project_id,
            1,
            ("OEYdesign creates reviewable Web artifacts.",),
            ("repository:p6",),
        )
        _send(
            app,
            project_id,
            PrepareProject,
            "02-prepare",
            context_package=context,
            brief=DesignBrief(
                "Present the P6 vertical slice", "Product team", "web"
            ),
        )
        candidates = _send(
            app,
            project_id,
            GenerateCandidates,
            "03-generate",
            candidate_count=2,
        ).value
        assert len(candidates) == 2
        _send(
            app,
            project_id,
            ApproveDirection,
            "04-direction",
            candidate_id=candidates[0].id,
            candidate_revision=1,
            impact="Use Graphite Signal",
        )
        artifact = _send(
            app,
            project_id,
            ProduceArtifact,
            "05-produce",
            medium="web",
        ).value
        decision = _send(
            app,
            project_id,
            ValidateArtifact,
            "06-validate",
            render_profile={"width": 1440, "height": 900},
        ).value
        assert not decision.hard_errors
        _send(
            app,
            project_id,
            ApproveExport,
            "07-approve-export",
            artifact_id=artifact.id,
            artifact_revision=artifact.revision,
            impact="Release immutable local ZIP",
        )
        delivered = _send(
            app,
            project_id,
            DeliverArtifact,
            "08-deliver",
            delivery_profile={"format": "zip", "profile": "production"},
        )
        assert delivered.state is ProjectState.DELIVERED
        project = app.repository.get(project_id)
        assert project.current_export is not None
        assert project.current_quality is not None
        assert project.current_quality.target_kind == "export"
        assert project.current_export.manifest["archive_crc_ok"] is True
        assert project.current_export.manifest["rerender"]["healthy"] is True
        assert Path(project.deliveries[0].manifest["archive_path"]).is_file()

    with Phase6Application(
        database,
        data_root=tmp_path,
        dependency_image=dependency_image,
    ) as reopened:
        project = reopened.repository.get(project_id)
        assert project.state is ProjectState.DELIVERED
        assert len(project.deliveries) == 1
