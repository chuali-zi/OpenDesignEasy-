from __future__ import annotations

import pytest

from oeydesign.delivery import ValidatedDeliveryPort
from oeydesign.domain import (
    Approval,
    ApprovalAction,
    ArtifactRevision,
    ContractError,
    ExportCandidate,
    GateVerdict,
    Lineage,
    QualityDecision,
)
from oeydesign.stubs import DeterministicDeliveryPort


def _inputs() -> tuple[ArtifactRevision, ExportCandidate, QualityDecision, Approval]:
    lineage = Lineage("project-1", "run-1", "artifact/1")
    artifact = ArtifactRevision(
        "artifact-1",
        1,
        None,
        lineage,
        "direction-1",
        "web",
        "balanced",
        "<main />",
        {},
    )
    export = ExportCandidate(
        "export-1",
        1,
        lineage,
        artifact.id,
        artifact.revision,
        "<main />",
        {
            "format": "web",
            "archive_crc_ok": True,
            "archive_sha256": "a" * 64,
            "member_hashes": {"index.html": "b" * 64},
            "pixel_diff_ratio": 0.0,
            "rerender": {
                "trusted_render": True,
                "independent_unpack": True,
                "healthy": True,
            },
        },
    )
    decision = QualityDecision(
        "quality-1",
        1,
        lineage,
        "export",
        export.id,
        1,
        artifact.id,
        artifact.revision,
        (),
        (),
        (),
        GateVerdict.PASS,
    )
    approval = Approval(
        "approval-1",
        "project-1",
        ApprovalAction.EXPORT,
        artifact.id,
        artifact.revision,
        "release",
    )
    return artifact, export, decision, approval


def test_validated_delivery_rejects_failed_quality_before_inner_side_effect() -> None:
    artifact, export, decision, approval = _inputs()
    delivery = ValidatedDeliveryPort(DeterministicDeliveryPort())
    bundle = delivery.release(
        artifact,
        export,
        decision,
        approval,
        side_effect_key="effect-1",
    )
    assert bundle.artifact_revision == 1

    failed = QualityDecision(
        decision.id,
        decision.revision,
        decision.lineage,
        decision.target_kind,
        decision.target_id,
        decision.target_revision,
        decision.artifact_id,
        decision.artifact_revision,
        (),
        (),
        (),
        GateVerdict.BLOCK,
    )
    with pytest.raises(ContractError) as blocked:
        delivery.release(
            artifact,
            export,
            failed,
            approval,
            side_effect_key="effect-2",
        )
    assert blocked.value.category.value == "QUALITY_GATE_FAILED"
