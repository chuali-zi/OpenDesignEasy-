"""Deterministic Web hard-check track for P6 Quality/Governance."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

from .domain import (
    Approval,
    ApprovalAction,
    Candidate,
    ConstraintProfile,
    ContextPackage,
    ContractError,
    DesignBrief,
    ErrorCategory,
    ExportCandidate,
    Finding,
    FindingKind,
    GateDecision,
    GateVerdict,
    Lineage,
    QualityDecision,
    RemediationRequest,
    RenderBundle,
    TemplateRole,
    WorkflowRun,
    stable_id,
)
from .framework_artifact import AnchorRegistry
from .ports import QualityGovernancePort


@dataclass(frozen=True, slots=True)
class WebCheckSummary:
    mock_signals: tuple[str, ...]
    anchors: tuple[str, ...]


class WebQualityPort(QualityGovernancePort):
    """Runs trusted-render and export-integrity gates for the P6 Web slice."""

    capability_version = "quality-web-governance/1"
    p6_slot = "quality.governance"
    ready_for_p6 = True
    _mock_patterns = (
        (
            "FETCH_XHR_INTERCEPT",
            re.compile(r"(?:window\.fetch\s*=|XMLHttpRequest\.prototype\.)"),
        ),
        ("SERVICE_WORKER", re.compile(r"serviceWorker\s*\.\s*register")),
        ("INLINE_FAKE_DATA", re.compile(r"\b(?:fake|fixture|sample)Data\b")),
        ("TIMEOUT_FAKE_DELAY", re.compile(r"setTimeout\s*\(")),
        ("MOCK_PATH_REF", re.compile(r"(?:mock/|\.mock\.(?:json|ts|js)\b)")),
    )

    def __init__(self, *, anchor_registry: AnchorRegistry | None = None) -> None:
        self.anchors = anchor_registry or AnchorRegistry()

    def assess_candidate(
        self,
        candidate: Candidate,
        brief: DesignBrief,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> QualityDecision:
        del brief
        hard_errors, aesthetic, _summary = self._check(
            candidate.preview_html,
            candidate.id,
            profile={},
            delivery_profile={},
            constraints=constraints,
            artifact_stage=False,
        )
        return self._decision(
            target_kind="candidate",
            target_id=candidate.id,
            target_revision=candidate.revision,
            artifact_id=None,
            artifact_revision=None,
            project_id=candidate.lineage.project_id,
            run=run,
            hard_errors=hard_errors,
            aesthetic=aesthetic,
        )

    def assess_artifact(
        self,
        subject: RenderBundle | ExportCandidate,
        delivery_profile: Mapping[str, Any],
        context: ContextPackage,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> QualityDecision:
        del context
        profile = (
            subject.profile if isinstance(subject, RenderBundle) else subject.manifest
        )
        content = (
            subject.rendered_content
            if isinstance(subject, RenderBundle)
            else subject.exported_content
        )
        hard_errors, aesthetic, _summary = self._check(
            content,
            subject.id,
            profile=profile,
            delivery_profile=delivery_profile,
            constraints=constraints,
            artifact_stage=True,
        )
        if isinstance(subject, RenderBundle):
            metrics = profile.get("dom_metrics", {})
            if (
                profile.get("trusted_render") is not True
                or not profile.get("screenshot_sha256")
                or not profile.get("chrome_version")
                or profile.get("healthy") is not True
            ):
                hard_errors += (
                    _finding(
                        "TRUSTED_RENDER_EVIDENCE_MISSING",
                        "Artifact Quality requires healthy system-Chrome evidence.",
                        subject.id,
                    ),
                )
            if isinstance(metrics, Mapping):
                objects = metrics.get("object_anchors", ())
                unique = metrics.get("unique_object_anchors", 0)
                if not objects or unique != len(objects):
                    hard_errors += (
                        _finding(
                            "RUNTIME_ANCHORS_INVALID",
                            "Rendered object anchors must exist and be unique.",
                            subject.id,
                        ),
                    )
                if metrics.get("scroll_width", 0) > metrics.get("client_width", 0):
                    hard_errors += (
                        _finding(
                            "VIEWPORT_OVERFLOW",
                            "Rendered content overflows the target viewport.",
                            subject.id,
                        ),
                    )
                if not metrics.get("computed_styles"):
                    hard_errors += (
                        _finding(
                            "COMPUTED_STYLE_EVIDENCE_MISSING",
                            "Quality requires computed styles from rendered objects.",
                            subject.id,
                        ),
                    )
        else:
            rerender = profile.get("rerender", {})
            evidence_ok = (
                profile.get("archive_crc_ok") is True
                and bool(profile.get("archive_sha256"))
                and isinstance(profile.get("member_hashes"), Mapping)
                and bool(profile.get("member_hashes"))
                and isinstance(rerender, Mapping)
                and rerender.get("trusted_render") is True
                and rerender.get("independent_unpack") is True
                and rerender.get("healthy") is True
                and bool(rerender.get("screenshot_sha256"))
                and float(profile.get("pixel_diff_ratio", 1.0)) <= 0.002
            )
            if not evidence_ok:
                hard_errors += (
                    _finding(
                        "EXPORT_RERENDER_EVIDENCE_MISSING",
                        "Export Quality requires CRC, member hashes, and an "
                        "independent Chrome rerender.",
                        subject.id,
                    ),
                )
        return self._decision(
            target_kind="render" if isinstance(subject, RenderBundle) else "export",
            target_id=subject.id,
            target_revision=subject.revision,
            artifact_id=subject.artifact_id,
            artifact_revision=subject.artifact_revision,
            project_id=subject.lineage.project_id,
            run=run,
            hard_errors=hard_errors,
            aesthetic=aesthetic,
        )

    def plan_remediation(
        self,
        decision: QualityDecision,
        current_revision: int,
        constraints: ConstraintProfile,
    ) -> RemediationRequest:
        repairable = tuple(
            finding.message
            for finding in decision.hard_errors
            if finding.repairable
        )
        return RemediationRequest(
            stable_id("remediation", decision.id, current_revision),
            decision.target_id,
            current_revision,
            repairable,
            constraints,
            max_attempts=2,
        )

    def authorize_transition(
        self,
        decision: QualityDecision,
        requested_action: str,
        approvals: tuple[Approval, ...],
    ) -> GateDecision:
        active = tuple(approval for approval in approvals if approval.active)
        passed = decision.verdict is GateVerdict.PASS and not decision.hard_errors
        if requested_action == "deliver":
            if decision.target_kind != "export":
                active = ()
            active = tuple(
                approval
                for approval in active
                if decision.target_kind == "export"
                and approval.action is ApprovalAction.EXPORT
                and approval.target_id == decision.artifact_id
                and approval.target_revision == decision.artifact_revision
            )
        authorized = passed and (requested_action != "deliver" or bool(active))
        return GateDecision(
            authorized,
            requested_action,
            decision.id,
            tuple(approval.id for approval in active),
            "Quality and approval requirements passed"
            if authorized
            else "Quality hard checks or matching approval did not pass",
        )

    def _check(
        self,
        content: str,
        target_id: str,
        *,
        profile: Mapping[str, Any],
        delivery_profile: Mapping[str, Any],
        constraints: ConstraintProfile,
        artifact_stage: bool,
    ) -> tuple[tuple[Finding, ...], tuple[Finding, ...], WebCheckSummary]:
        hard: list[Finding] = []
        aesthetic: list[Finding] = []
        if not isinstance(content, str) or not content.strip():
            hard.append(
                _finding(
                    "EMPTY_RENDER",
                    "A real rendered artifact is required before Quality can assess "
                    "it.",
                    target_id,
                )
            )
            return tuple(hard), (), WebCheckSummary((), ())

        parser = _AccessibilityParser()
        try:
            parser.feed(content)
            parser.close()
        except Exception as exc:
            hard.append(
                _finding(
                    "HTML_PARSE_FAILED",
                    "Rendered HTML could not be parsed.",
                    target_id,
                )
            )
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Web Quality HTML parser failed",
            ) from exc
        try:
            anchors = tuple(self.anchors.extract(content))
        except ContractError as exc:
            hard.append(_finding("ANCHOR_INVALID", str(exc), target_id))
            anchors = ()
        if parser.images_without_alt:
            hard.append(
                _finding(
                    "IMAGE_ALT_MISSING",
                    "Every rendered image must declare an alt attribute.",
                    target_id,
                )
            )
        if re.search(
            r"https?://|(?:src|href)\s*=\s*['\"]//",
            content,
            re.IGNORECASE,
        ):
            hard.append(
                _finding(
                    "EXTERNAL_RESOURCE",
                    "Rendered artifacts may not depend on external resources.",
                    target_id,
                )
            )
        for key in ("console_errors", "page_errors", "failed_requests"):
            values = profile.get(key, ())
            if isinstance(values, (list, tuple)) and values:
                hard.append(
                    _finding(
                        key.upper(),
                        f"Renderer reported {key.replace('_', ' ')}.",
                        target_id,
                    )
                )
        signals = tuple(
            name for name, pattern in self._mock_patterns if pattern.search(content)
        )
        if artifact_stage and signals:
            declared = bool(
                profile.get("mock_declared")
                or delivery_profile.get("mock_declared")
                or delivery_profile.get("mock")
            )
            if not declared:
                hard.append(
                    _finding(
                        "MOCK_UNDECLARED",
                        "Rendered mock behavior must be declared before delivery.",
                        target_id,
                    )
                )
            elif delivery_profile.get("profile") == "production":
                hard.append(
                    _finding(
                        "MOCK_PRODUCTION",
                        "Declared mock behavior cannot pass a production delivery "
                        "profile.",
                        target_id,
                    )
                )
            else:
                aesthetic.append(
                    Finding(
                        FindingKind.AESTHETIC,
                        "MOCK_DEMO_NOTICE",
                        "Demo delivery contains a declared mock layer.",
                        "warning",
                        target_id,
                        False,
                    )
                )
        if (
            artifact_stage
            and constraints.template_role is TemplateRole.DELIVERY_CONTRACT
            and not anchors
        ):
            hard.append(
                _finding(
                    "DELIVERY_ANCHORS_MISSING",
                    "A delivery-contract artifact must expose stable data-oey anchors.",
                    target_id,
                )
            )
        return tuple(hard), tuple(aesthetic), WebCheckSummary(signals, anchors)

    def _decision(
        self,
        *,
        target_kind: str,
        target_id: str,
        target_revision: int,
        artifact_id: str | None,
        artifact_revision: int | None,
        project_id: str,
        run: WorkflowRun,
        hard_errors: tuple[Finding, ...],
        aesthetic: tuple[Finding, ...],
    ) -> QualityDecision:
        return QualityDecision(
            stable_id(
                "quality",
                target_kind,
                target_id,
                target_revision,
                self.capability_version,
            ),
            1,
            Lineage(project_id, run.id, self.capability_version),
            target_kind,
            target_id,
            target_revision,
            artifact_id,
            artifact_revision,
            aesthetic,
            hard_errors,
            (),
            GateVerdict.BLOCK if hard_errors else GateVerdict.PASS,
        )


class _AccessibilityParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images_without_alt = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() != "img":
            return
        values = dict(attrs)
        if not isinstance(values.get("alt"), str):
            self.images_without_alt = True


def _finding(code: str, message: str, target_id: str) -> Finding:
    return Finding(FindingKind.HARD_ERROR, code, message, "error", target_id, True)
