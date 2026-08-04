"""P6 delivery gate contract layered ahead of durable side effects."""

from __future__ import annotations

from collections.abc import Mapping

from .domain import (
    Approval,
    ApprovalAction,
    ArtifactRevision,
    ContractError,
    DeliveryBundle,
    DeliveryReconciliation,
    ErrorCategory,
    ExportCandidate,
    GateVerdict,
    QualityDecision,
)
from .ports import DeliveryPort


class ValidatedDeliveryPort:
    """Rejects stale or failed quality/export inputs before any side effect."""

    capability_version = "delivery-validation/1"

    def __init__(self, inner: DeliveryPort) -> None:
        self.inner = inner
        self.capability_version = (
            f"{self.capability_version}({inner.capability_version})"
        )

    def release(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        *,
        side_effect_key: str,
    ) -> DeliveryBundle:
        self._validate(artifact, export, decision, approval)
        return self.inner.release(
            artifact,
            export,
            decision,
            approval,
            side_effect_key=side_effect_key,
        )

    def reconcile(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        *,
        side_effect_key: str,
    ) -> DeliveryReconciliation:
        self._validate(artifact, export, decision, approval)
        return self.inner.reconcile(
            artifact,
            export,
            decision,
            approval,
            side_effect_key=side_effect_key,
        )

    @staticmethod
    def _validate(
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
    ) -> None:
        if decision.verdict is not GateVerdict.PASS or decision.hard_errors:
            raise ContractError(
                ErrorCategory.QUALITY_GATE_FAILED,
                "Delivery requires a passing Quality decision",
                details={"quality_decision_id": decision.id},
            )
        if (
            export.artifact_id != artifact.id
            or export.artifact_revision != artifact.revision
            or decision.artifact_id != artifact.id
            or decision.artifact_revision != artifact.revision
        ):
            raise ContractError(
                ErrorCategory.STALE_REVISION,
                "Delivery inputs do not target the same artifact revision",
            )
        if (
            not approval.active
            or approval.action is not ApprovalAction.EXPORT
            or approval.target_id != artifact.id
            or approval.target_revision != artifact.revision
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Delivery requires a matching active export approval",
            )
        if not isinstance(export.manifest, Mapping):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Export manifest is invalid",
            )
