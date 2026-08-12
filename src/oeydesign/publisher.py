"""Immutable local Delivery adapter with receipt-based reconciliation."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

from .domain import (
    Approval,
    ArtifactRevision,
    ContractError,
    DeliveryBundle,
    DeliveryReconciliation,
    ErrorCategory,
    ExportCandidate,
    Lineage,
    QualityDecision,
    SideEffectReconciliationStatus,
    canonical_json,
    stable_id,
)


class LocalImmutableDeliveryPort:
    capability_version = "delivery-local-immutable/1"
    p6_slot = "delivery.release"
    ready_for_p6 = True

    def __init__(self, data_root: str | Path) -> None:
        self.root = Path(data_root).resolve() / "deliveries"
        self.root.mkdir(parents=True, exist_ok=True)

    def release(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        *,
        side_effect_key: str,
    ) -> DeliveryBundle:
        archive = Path(str(export.manifest["archive_path"]))
        expected = str(export.manifest["archive_sha256"])
        if not archive.is_file() or _sha256(archive) != expected:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Delivery source archive is missing or changed",
            )
        target = self.root / f"{side_effect_key}.zip"
        receipt = self.root / f"{side_effect_key}.json"
        if target.exists() and _sha256(target) != expected:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Immutable delivery target has conflicting bytes",
            )
        if not target.exists():
            temporary = target.with_suffix(".tmp")
            shutil.copy2(archive, temporary)
            os.replace(temporary, target)
        bundle = self._bundle(
            artifact, export, decision, approval, side_effect_key, target, expected
        )
        body = canonical_json(
            {
                "bundle_id": bundle.id,
                "side_effect_key": side_effect_key,
                "archive_path": str(target),
                "archive_sha256": expected,
            }
        )
        if receipt.exists() and receipt.read_text(encoding="utf-8") != body:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Immutable delivery receipt conflicts with this release",
            )
        if not receipt.exists():
            temporary_receipt = receipt.with_suffix(".tmp")
            temporary_receipt.write_text(body, encoding="utf-8")
            os.replace(temporary_receipt, receipt)
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
        target = self.root / f"{side_effect_key}.zip"
        receipt = self.root / f"{side_effect_key}.json"
        if not target.exists() and not receipt.exists():
            return DeliveryReconciliation(
                SideEffectReconciliationStatus.SAFE_TO_RETRY,
                reason="No local delivery side effect exists",
            )
        if not target.is_file() or not receipt.is_file():
            return DeliveryReconciliation(
                SideEffectReconciliationStatus.UNKNOWN,
                reason="Local delivery is only partially present",
            )
        expected = str(export.manifest["archive_sha256"])
        try:
            record = json.loads(receipt.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return DeliveryReconciliation(
                SideEffectReconciliationStatus.UNKNOWN,
                reason="Local delivery receipt is unreadable",
            )
        if (
            _sha256(target) != expected
            or record.get("side_effect_key") != side_effect_key
            or record.get("archive_sha256") != expected
        ):
            return DeliveryReconciliation(
                SideEffectReconciliationStatus.UNKNOWN,
                reason="Local delivery receipt or archive does not reconcile",
            )
        return DeliveryReconciliation(
            SideEffectReconciliationStatus.COMPLETED,
            self._bundle(
                artifact,
                export,
                decision,
                approval,
                side_effect_key,
                target,
                expected,
            ),
            "Immutable archive and receipt match",
        )

    def _bundle(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        side_effect_key: str,
        target: Path,
        archive_hash: str,
    ) -> DeliveryBundle:
        return DeliveryBundle(
            stable_id("delivery", side_effect_key),
            1,
            Lineage(
                artifact.lineage.project_id,
                export.lineage.workflow_run_id,
                self.capability_version,
            ),
            artifact.id,
            artifact.revision,
            export.id,
            decision.id,
            approval.id,
            side_effect_key,
            {
                "archive_path": str(target),
                "archive_sha256": archive_hash,
                "export_revision": export.revision,
                "delivery_profile": export.manifest.get("delivery_profile", {}),
            },
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
