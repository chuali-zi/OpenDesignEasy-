"""Deterministic, side-effect-free implementations of the system ports."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from html import escape
from typing import Any

from .domain import (
    Approval,
    ApprovalAction,
    ApprovedDirection,
    ArtifactRevision,
    Candidate,
    ConstraintProfile,
    ContextPackage,
    DeliveryBundle,
    DeliveryReconciliation,
    DesignBrief,
    DesignStrategy,
    ExportCandidate,
    FeedbackRecord,
    Finding,
    FindingKind,
    GateDecision,
    GateVerdict,
    Lineage,
    QualityDecision,
    RemediationRequest,
    RenderBundle,
    SideEffectReconciliationStatus,
    TemplateRole,
    WorkflowRun,
    canonical_json,
    stable_id,
)


class DeterministicDesignPort:
    capability_version = "design-stub/1"

    def plan_design(
        self,
        context: ContextPackage,
        brief: DesignBrief,
        constraints: ConstraintProfile,
        capabilities: Mapping[str, str],
        run: WorkflowRun,
        *,
        candidate_count: int,
    ) -> DesignStrategy:
        del capabilities
        count = max(2, min(candidate_count, 4))
        lineage = Lineage(context.project_id, run.id, self.capability_version)
        return DesignStrategy(
            id=stable_id(
                "strategy",
                context.id,
                brief,
                constraints,
                count,
                self.capability_version,
            ),
            lineage=lineage,
            context_package_id=context.id,
            brief=brief,
            constraints=constraints,
            candidate_count=count,
        )

    def create_candidates(
        self,
        strategy: DesignStrategy,
        context: ContextPackage,
        run: WorkflowRun,
    ) -> tuple[Candidate, ...]:
        concepts = (
            ("Signal & Structure", "Editorial clarity with a crisp cobalt signal"),
            ("Warm Intelligence", "Human, tactile typography with amber accents"),
            ("Future Field", "Spatial layers with mint and ultraviolet energy"),
            ("Quiet Precision", "Measured monochrome with one decisive highlight"),
        )
        candidates: list[Candidate] = []
        for index, (title, concept) in enumerate(
            concepts[: strategy.candidate_count], start=1
        ):
            candidate_id = stable_id("candidate", strategy.id, index)
            preview = self._preview(
                title,
                concept,
                strategy.brief.goal,
                strategy.constraints.template_role,
                index,
            )
            candidates.append(
                Candidate(
                    id=candidate_id,
                    revision=1,
                    parent_revision=None,
                    lineage=Lineage(
                        context.project_id, run.id, self.capability_version
                    ),
                    title=title,
                    concept=concept,
                    preview_html=preview,
                    creative_owner="deterministic-design-stub",
                    template_role=strategy.constraints.template_role,
                    constraints=strategy.constraints,
                    source_refs=context.source_refs,
                )
            )
        return tuple(candidates)

    def revise_candidate(
        self,
        candidate: Candidate,
        feedback: FeedbackRecord,
        context: ContextPackage,
        run: WorkflowRun,
    ) -> Candidate:
        note = escape(feedback.text)
        preview = candidate.preview_html.replace(
            "</section>", f'<p data-feedback="direction">{note}</p></section>'
        )
        return replace(
            candidate,
            revision=candidate.revision + 1,
            parent_revision=candidate.revision,
            lineage=Lineage(context.project_id, run.id, self.capability_version),
            concept=f"{candidate.concept} · revised: {feedback.text}",
            preview_html=preview,
        )

    def commit_direction(
        self,
        candidate: Candidate,
        approval: Approval,
        run: WorkflowRun,
    ) -> ApprovedDirection:
        return ApprovedDirection(
            id=stable_id("direction", candidate.id, candidate.revision, approval.id),
            lineage=Lineage(
                candidate.lineage.project_id, run.id, self.capability_version
            ),
            candidate_id=candidate.id,
            candidate_revision=candidate.revision,
            approval_id=approval.id,
            baseline_preview_html=candidate.preview_html,
        )

    @staticmethod
    def _preview(
        title: str,
        concept: str,
        goal: str,
        template_role: TemplateRole,
        index: int,
    ) -> str:
        palettes = (
            ("#eef3ff", "#1737d1", "#10162f"),
            ("#fff1df", "#e65d2f", "#332219"),
            ("#eafff7", "#7048e8", "#102a27"),
            ("#f2f1ed", "#111111", "#343434"),
        )
        background, accent, ink = palettes[index - 1]
        return (
            f'<section data-candidate="{index}" '
            f'data-template-role="{template_role.value}" data-contract="preserved" '
            f'style="background:{background};color:{ink};padding:48px;min-height:360px">'
            f'<small style="color:{accent}">OEY / DIRECTION 0{index}</small>'
            f'<h1 style="font-size:42px;max-width:12ch">{escape(title)}</h1>'
            f'<p style="max-width:48ch">{escape(concept)}</p>'
            f"<strong>{escape(goal)}</strong>"
            "</section>"
        )


class DeterministicArtifactPort:
    capability_version = "artifact-stub/1"

    def materialize(
        self,
        direction: ApprovedDirection,
        *,
        medium: str,
        fidelity_mode: str,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> ArtifactRevision:
        artifact_id = stable_id("artifact", direction.id, medium)
        content = (
            f'<main data-artifact="{artifact_id}" data-medium="{escape(medium)}" '
            f'data-template-role="{constraints.template_role.value}" '
            f'data-contract="preserved">{direction.baseline_preview_html}</main>'
        )
        return ArtifactRevision(
            id=artifact_id,
            revision=1,
            parent_revision=None,
            lineage=Lineage(
                direction.lineage.project_id, run.id, self.capability_version
            ),
            direction_id=direction.id,
            medium=medium,
            fidelity_mode=fidelity_mode,
            content=content,
            object_refs={
                "page:1": "main",
                "hero:title": "section > h1",
                "hero:summary": "section > p",
            },
        )

    def apply_artifact_change(
        self,
        artifact: ArtifactRevision,
        feedback: FeedbackRecord,
        run: WorkflowRun,
    ) -> ArtifactRevision:
        target = feedback.object_ref or "artifact"
        note = escape(feedback.text)
        content = artifact.content.replace(
            "</main>",
            f'<aside data-change-target="{escape(target)}">{note}</aside></main>',
        )
        if "[break-contract]" in feedback.text:
            content = content.replace(
                'data-contract="preserved"', 'data-contract="violated"'
            )
        return replace(
            artifact,
            revision=artifact.revision + 1,
            parent_revision=artifact.revision,
            lineage=Lineage(
                artifact.lineage.project_id, run.id, self.capability_version
            ),
            content=content,
        )

    def render_artifact(
        self,
        artifact: ArtifactRevision,
        render_profile: Mapping[str, Any],
        run: WorkflowRun,
    ) -> RenderBundle:
        return RenderBundle(
            id=stable_id("render", artifact.id, artifact.revision, render_profile),
            revision=1,
            lineage=Lineage(
                artifact.lineage.project_id, run.id, self.capability_version
            ),
            artifact_id=artifact.id,
            artifact_revision=artifact.revision,
            rendered_content=f"render::{artifact.content}",
            profile=dict(render_profile),
        )

    def export_artifact(
        self,
        artifact: ArtifactRevision,
        delivery_profile: Mapping[str, Any],
        run: WorkflowRun,
    ) -> ExportCandidate:
        profile = dict(delivery_profile)
        payload = f"export::{artifact.content}::{canonical_json(profile)}"
        if profile.get("simulate_hard_error"):
            payload += "::[hard-error]"
        return ExportCandidate(
            id=stable_id("export", artifact.id, artifact.revision, profile),
            revision=1,
            lineage=Lineage(
                artifact.lineage.project_id, run.id, self.capability_version
            ),
            artifact_id=artifact.id,
            artifact_revision=artifact.revision,
            exported_content=payload,
            manifest={
                "medium": artifact.medium,
                "fidelity_mode": artifact.fidelity_mode,
                "format": profile.get("format", artifact.medium),
            },
        )


class DeterministicQualityPort:
    capability_version = "quality-stub/1"

    def assess_candidate(
        self,
        candidate: Candidate,
        brief: DesignBrief,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> QualityDecision:
        del brief
        hard_errors = self._hard_errors(
            candidate.preview_html, candidate.id, constraints
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
        )

    def assess_artifact(
        self,
        subject: RenderBundle | ExportCandidate,
        delivery_profile: Mapping[str, Any],
        context: ContextPackage,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> QualityDecision:
        del delivery_profile, context
        content = (
            subject.rendered_content
            if isinstance(subject, RenderBundle)
            else subject.exported_content
        )
        hard_errors = self._hard_errors(content, subject.id, constraints)
        return self._decision(
            target_kind="render" if isinstance(subject, RenderBundle) else "export",
            target_id=subject.id,
            target_revision=subject.revision,
            artifact_id=subject.artifact_id,
            artifact_revision=subject.artifact_revision,
            project_id=subject.lineage.project_id,
            run=run,
            hard_errors=hard_errors,
        )

    def plan_remediation(
        self,
        decision: QualityDecision,
        current_revision: int,
        constraints: ConstraintProfile,
    ) -> RemediationRequest:
        return RemediationRequest(
            id=stable_id("remediation", decision.id, current_revision),
            target_id=decision.target_id,
            target_revision=current_revision,
            instructions=tuple(finding.message for finding in decision.hard_errors),
            protected_constraints=constraints,
            max_attempts=2,
        )

    def authorize_transition(
        self,
        decision: QualityDecision,
        requested_action: str,
        approvals: tuple[Approval, ...],
    ) -> GateDecision:
        matching = tuple(approval for approval in approvals if approval.active)
        quality_passed = (
            decision.verdict is GateVerdict.PASS and not decision.hard_errors
        )
        if requested_action == "deliver":
            matching = tuple(
                approval
                for approval in matching
                if approval.action is ApprovalAction.EXPORT
                and approval.target_id == decision.artifact_id
                and approval.target_revision == decision.artifact_revision
            )
            authorized = quality_passed and bool(matching)
        else:
            authorized = quality_passed
        return GateDecision(
            authorized=authorized,
            requested_action=requested_action,
            quality_decision_id=decision.id,
            approval_ids=tuple(approval.id for approval in matching),
            reason="Quality and approval requirements passed"
            if authorized
            else "Quality or approval requirements did not pass",
        )

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
    ) -> QualityDecision:
        aesthetic = (
            Finding(
                FindingKind.AESTHETIC,
                "AESTHETIC_HIERARCHY",
                "The direction has a clear focal point; tune supporting rhythm.",
                "suggestion",
                target_id,
            ),
        )
        verdict = GateVerdict.REPAIR if hard_errors else GateVerdict.PASS
        return QualityDecision(
            id=stable_id(
                "quality",
                target_kind,
                target_id,
                target_revision,
                tuple(finding.code for finding in hard_errors),
            ),
            revision=1,
            lineage=Lineage(project_id, run.id, self.capability_version),
            target_kind=target_kind,
            target_id=target_id,
            target_revision=target_revision,
            artifact_id=artifact_id,
            artifact_revision=artifact_revision,
            aesthetic_findings=aesthetic,
            hard_errors=hard_errors,
            risks=(),
            verdict=verdict,
        )

    @staticmethod
    def _hard_errors(
        content: str, target_id: str, constraints: ConstraintProfile
    ) -> tuple[Finding, ...]:
        findings: list[Finding] = []
        if "[hard-error]" in content:
            findings.append(
                Finding(
                    FindingKind.HARD_ERROR,
                    "EXPORT_INTEGRITY",
                    "The actual export failed deterministic integrity validation.",
                    "error",
                    target_id,
                    True,
                )
            )
        if (
            constraints.template_role is TemplateRole.DELIVERY_CONTRACT
            and 'data-contract="violated"' in content
        ):
            findings.append(
                Finding(
                    FindingKind.HARD_ERROR,
                    "DELIVERY_CONTRACT_VIOLATION",
                    "A locked delivery-contract region was changed.",
                    "error",
                    target_id,
                    True,
                )
            )
        return tuple(findings)


class DeterministicDeliveryPort:
    capability_version = "delivery-stub/1"

    def __init__(self) -> None:
        self._by_side_effect_key: dict[str, DeliveryBundle] = {}

    def release(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        *,
        side_effect_key: str,
    ) -> DeliveryBundle:
        existing = self._by_side_effect_key.get(side_effect_key)
        if existing:
            return existing
        bundle = self._build_bundle(
            artifact, export, decision, approval, side_effect_key
        )
        self._by_side_effect_key[side_effect_key] = bundle
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
        bundle = self._by_side_effect_key.get(side_effect_key)
        if bundle is None:
            bundle = self._build_bundle(
                artifact, export, decision, approval, side_effect_key
            )
            self._by_side_effect_key[side_effect_key] = bundle
        return DeliveryReconciliation(
            SideEffectReconciliationStatus.COMPLETED,
            bundle,
            "The deterministic local bundle is derivable from its stable key",
        )

    def _build_bundle(
        self,
        artifact: ArtifactRevision,
        export: ExportCandidate,
        decision: QualityDecision,
        approval: Approval,
        side_effect_key: str,
    ) -> DeliveryBundle:
        bundle = DeliveryBundle(
            id=stable_id("delivery", side_effect_key),
            revision=1,
            lineage=Lineage(
                artifact.lineage.project_id,
                export.lineage.workflow_run_id,
                self.capability_version,
            ),
            artifact_id=artifact.id,
            artifact_revision=artifact.revision,
            export_id=export.id,
            quality_decision_id=decision.id,
            approval_id=approval.id,
            side_effect_key=side_effect_key,
            manifest=dict(export.manifest),
        )
        return bundle
