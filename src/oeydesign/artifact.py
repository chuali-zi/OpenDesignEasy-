"""Production Web artifact, export, and rerender adapter for P6."""

from __future__ import annotations

import hashlib
import os
import shutil
import zipfile
from collections.abc import Mapping
from dataclasses import replace
from html import escape
from pathlib import Path, PurePosixPath
from typing import Any

from .domain import (
    ApprovedDirection,
    ArtifactRevision,
    ConstraintProfile,
    ContractError,
    ErrorCategory,
    ExportCandidate,
    FeedbackRecord,
    Lineage,
    RenderBundle,
    WorkflowRun,
    canonical_json,
    stable_id,
)
from .framework_artifact import AnchorRegistry
from .renderer import RenderProfile, RenderResult, TrustedWebRenderer


class WebArtifactProduction:
    """Materializes, renders, exports, safely unpacks, and rerenders Web output."""

    capability_version = "artifact-web-production/1"
    p6_slot = "artifact.production"
    ready_for_p6 = True

    def __init__(
        self,
        data_root: str | Path,
        *,
        renderer: TrustedWebRenderer | None = None,
    ) -> None:
        self.root = Path(data_root).resolve() / "p6-artifacts"
        self.root.mkdir(parents=True, exist_ok=True)
        self.renderer = renderer or TrustedWebRenderer()
        self.anchors = AnchorRegistry()

    def materialize(
        self,
        direction: ApprovedDirection,
        *,
        medium: str,
        fidelity_mode: str,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> ArtifactRevision:
        if medium != "web":
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "The first production slice supports Web artifacts only",
            )
        html = direction.baseline_preview_html
        refs = dict(self.anchors.extract(html))
        artifact_id = stable_id("artifact", direction.id, medium)
        return ArtifactRevision(
            artifact_id,
            1,
            None,
            Lineage(direction.lineage.project_id, run.id, self.capability_version),
            direction.id,
            medium,
            fidelity_mode,
            html,
            refs,
            ("Generated images are disabled; the artifact is fully offline.",),
            {"index.html": html},
        )

    def apply_artifact_change(
        self,
        artifact: ArtifactRevision,
        feedback: FeedbackRecord,
        run: WorkflowRun,
    ) -> ArtifactRevision:
        if feedback.object_ref and feedback.object_ref not in artifact.object_refs:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Artifact feedback references an unknown object",
            )
        target = escape(feedback.object_ref or "artifact")
        note = escape(feedback.text)
        content = artifact.content.replace(
            "</main>",
            f'<aside class="revision" data-change-target="{target}">{note}</aside>'
            "</main>",
        )
        refs = dict(self.anchors.extract(content))
        if set(refs) != set(artifact.object_refs):
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Local artifact change altered stable object anchors",
            )
        return replace(
            artifact,
            revision=artifact.revision + 1,
            parent_revision=artifact.revision,
            lineage=Lineage(
                artifact.lineage.project_id, run.id, self.capability_version
            ),
            content=content,
            object_refs=refs,
            files={"index.html": content},
        )

    def render_artifact(
        self,
        artifact: ArtifactRevision,
        render_profile: Mapping[str, Any],
        run: WorkflowRun,
    ) -> RenderBundle:
        root = self._materialize_files(artifact)
        result = self.renderer.render(root, profile=_render_profile(render_profile))
        profile = _render_evidence(result)
        profile["trusted_render"] = True
        profile["source_tree_sha256"] = _files_hash(self._files(artifact))
        return RenderBundle(
            stable_id("render", artifact.id, artifact.revision, profile),
            1,
            Lineage(
                artifact.lineage.project_id, run.id, self.capability_version
            ),
            artifact.id,
            artifact.revision,
            artifact.content,
            profile,
        )

    def export_artifact(
        self,
        artifact: ArtifactRevision,
        delivery_profile: Mapping[str, Any],
        run: WorkflowRun,
    ) -> ExportCandidate:
        profile = dict(delivery_profile)
        export_id = stable_id("export", artifact.id, artifact.revision, profile)
        files = self._files(artifact)
        source_hash = _files_hash(files)
        files["artifact-manifest.json"] = canonical_json(
            {
                "artifact_id": artifact.id,
                "artifact_revision": artifact.revision,
                "source_tree_sha256": source_hash,
                "files": {
                    name: hashlib.sha256(content.encode()).hexdigest()
                    for name, content in sorted(files.items())
                },
            }
        )
        export_root = self.root / "exports"
        export_root.mkdir(parents=True, exist_ok=True)
        archive = export_root / f"{export_id}.zip"
        payload = _zip_payload(files)
        if archive.exists() and archive.read_bytes() != payload:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Existing immutable export does not match this revision",
            )
        if not archive.exists():
            temporary = archive.with_suffix(".tmp")
            temporary.write_bytes(payload)
            os.replace(temporary, archive)
        unpacked = self.root / "verified" / export_id
        if unpacked.exists():
            shutil.rmtree(unpacked)
        unpacked.mkdir(parents=True)
        member_hashes = _safe_unpack(archive, unpacked)
        artifact_render = self.renderer.render(self._materialize_files(artifact))
        rerender = self.renderer.render(unpacked)
        if not rerender.healthy:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "The unpacked export failed trusted Chrome rerendering",
            )
        manifest = {
            "format": profile.get("format", "zip"),
            "archive_path": str(archive),
            "archive_sha256": hashlib.sha256(payload).hexdigest(),
            "archive_crc_ok": True,
            "member_hashes": member_hashes,
            "source_tree_sha256": source_hash,
            "delivery_profile": profile,
            "rerender": {
                **_render_evidence(rerender),
                "trusted_render": True,
                "independent_unpack": True,
            },
            "artifact_render_sha256": artifact_render.screenshot_sha256,
            "pixel_diff_ratio": (
                0.0
                if artifact_render.screenshot_sha256 == rerender.screenshot_sha256
                else 1.0
            ),
            "mock_declared": False,
        }
        return ExportCandidate(
            export_id,
            1,
            Lineage(
                artifact.lineage.project_id, run.id, self.capability_version
            ),
            artifact.id,
            artifact.revision,
            files["index.html"],
            manifest,
        )

    def _materialize_files(self, artifact: ArtifactRevision) -> Path:
        root = self.root / "renders" / artifact.id / str(artifact.revision)
        root.mkdir(parents=True, exist_ok=True)
        for relative, content in self._files(artifact).items():
            target = root / _safe_relative(relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        return root

    @staticmethod
    def _files(artifact: ArtifactRevision) -> dict[str, str]:
        return dict(artifact.files or {"index.html": artifact.content})


def _render_profile(values: Mapping[str, Any]) -> RenderProfile:
    return RenderProfile(
        viewport_width=int(values.get("width", values.get("viewport_width", 1440))),
        viewport_height=int(
            values.get("height", values.get("viewport_height", 1000))
        ),
    )


def _render_evidence(result: RenderResult) -> dict[str, Any]:
    return {
        "renderer": TrustedWebRenderer.capability_version,
        "chrome_version": result.chrome_version,
        "screenshot_path": result.screenshot_path,
        "screenshot_sha256": result.screenshot_sha256,
        "console_errors": result.console_errors,
        "page_errors": result.page_errors,
        "failed_requests": result.failed_requests,
        "dom_metrics": dict(result.dom_metrics),
        "healthy": result.healthy,
    }


def _safe_relative(value: str) -> Path:
    path = PurePosixPath(value)
    if (
        not value
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
        or "\\" in value
    ):
        raise ContractError(ErrorCategory.POLICY_BLOCKED, "Unsafe artifact path")
    return Path(*path.parts)


def _files_hash(files: Mapping[str, str]) -> str:
    entries = [
        (name, hashlib.sha256(content.encode()).hexdigest())
        for name, content in sorted(files.items())
    ]
    return hashlib.sha256(canonical_json(entries).encode()).hexdigest()


def _zip_payload(files: Mapping[str, str]) -> bytes:
    from io import BytesIO

    output = BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            _safe_relative(name)
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content.encode("utf-8"))
    return output.getvalue()


def _safe_unpack(archive_path: Path, destination: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    folded: set[str] = set()
    total = 0
    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip() is not None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE, "Export archive CRC failed"
            )
        for member in archive.infolist():
            relative = _safe_relative(member.filename)
            mode = (member.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED,
                    "Export archive symbolic links are not allowed",
                )
            folded_name = member.filename.casefold()
            if folded_name in folded or member.is_dir():
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED,
                    "Export archive has duplicate or unsupported members",
                )
            folded.add(folded_name)
            total += member.file_size
            if len(folded) > 5_000 or total > 50_000_000:
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED, "Export archive exceeds limits"
                )
            payload = archive.read(member)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            hashes[member.filename] = hashlib.sha256(payload).hexdigest()
    return dict(sorted(hashes.items()))
