"""Recovery-safe adapters for external effects."""

from __future__ import annotations

from .domain import (
    Approval,
    ArtifactRevision,
    ContractError,
    DeliveryBundle,
    DeliveryReconciliation,
    ErrorCategory,
    ExportCandidate,
    QualityDecision,
    SideEffectReconciliationStatus,
)
from .ports import AuditLogPort, DeliveryPort, SideEffectLedgerPort


class DurableDeliveryPort:
    """Guards a delivery adapter with a durable side-effect claim."""

    def __init__(
        self,
        inner: DeliveryPort,
        ledger: SideEffectLedgerPort,
        *,
        audit_log: AuditLogPort | None = None,
    ) -> None:
        self.inner = inner
        self.ledger = ledger
        self.audit_log = audit_log
        self.capability_version = f"durable({inner.capability_version})"

    @property
    def ready_for_p6(self) -> bool:
        return bool(getattr(self.inner, "ready_for_p6", False))

    def release(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        *,
        side_effect_key: str,
    ) -> DeliveryBundle:
        project_id = artifact.lineage.project_id
        claim = self.ledger.claim(
            side_effect_key,
            project_id=project_id,
            action="delivery.release",
            target_revision=artifact.revision,
        )
        if claim["status"] == "COMPLETED":
            result = claim.get("result")
            if not isinstance(result, DeliveryBundle):
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Stored delivery result has an unexpected type",
                )
            return result
        if not claim.get("claimed", False):
            raise ContractError(
                ErrorCategory.RETRYABLE,
                "Delivery side effect is already claimed",
                details={"side_effect_key": side_effect_key},
            )
        if claim.get("recovery_required", False):
            reconciliation = self._reconcile(
                artifact,
                export,
                decision,
                approval,
                side_effect_key,
            )
            if reconciliation.status is SideEffectReconciliationStatus.COMPLETED:
                if reconciliation.bundle is None:
                    raise ContractError(
                        ErrorCategory.DETERMINISTIC_FAILURE,
                        "Completed delivery reconciliation has no bundle",
                    )
                self.ledger.complete(side_effect_key, reconciliation.bundle)
                return reconciliation.bundle
            if reconciliation.status is SideEffectReconciliationStatus.UNKNOWN:
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED,
                    "Delivery outcome is unknown and requires reconciliation",
                    details={"side_effect_key": side_effect_key},
                )
        try:
            bundle = self.inner.release(
                artifact,
                export,
                decision,
                approval,
                side_effect_key=side_effect_key,
            )
            self.ledger.complete(side_effect_key, bundle)
        except Exception as error:
            self.ledger.fail(side_effect_key, type(error).__name__)
            self._audit(
                project_id,
                artifact.revision,
                approval.id,
                side_effect_key,
                "FAILED",
            )
            raise
        self._audit(
            project_id,
            artifact.revision,
            approval.id,
            side_effect_key,
            "SUCCEEDED",
        )
        return bundle

    def reconcile(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        *,
        side_effect_key: str,
    ) -> DeliveryReconciliation:
        return self._reconcile(
            artifact,
            export,
            decision,
            approval,
            side_effect_key,
        )

    def _reconcile(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        side_effect_key: str,
    ) -> DeliveryReconciliation:
        reconcile = getattr(self.inner, "reconcile", None)
        if not callable(reconcile):
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Delivery adapter cannot reconcile an expired side-effect claim",
                details={"side_effect_key": side_effect_key},
            )
        result = reconcile(
            artifact,
            export,
            decision,
            approval,
            side_effect_key=side_effect_key,
        )
        if not isinstance(result, DeliveryReconciliation):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Delivery reconciliation returned an unexpected result",
            )
        return result

    def _audit(
        self,
        project_id: str,
        revision: int,
        approval_id: str,
        side_effect_key: str,
        outcome: str,
    ) -> None:
        if self.audit_log is None:
            return
        self.audit_log.record(
            project_id=project_id,
            action="delivery.release",
            revision=revision,
            outcome=outcome,
            metadata={
                "approval_id": approval_id,
                "side_effect_key": side_effect_key,
                "capability_version": self.inner.capability_version,
            },
        )
