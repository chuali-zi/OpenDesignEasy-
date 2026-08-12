"""Production Design Intelligence adapter for the first P6 Web slice."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from html import escape

from .domain import (
    Approval,
    ApprovedDirection,
    Candidate,
    ConstraintProfile,
    ContextPackage,
    ContractError,
    DesignBrief,
    DesignStrategy,
    ErrorCategory,
    FeedbackRecord,
    Lineage,
    WorkflowRun,
    stable_id,
)
from .framework_artifact import AnchorRegistry


class TerritoryDesignIntelligence:
    """Assigns distinct visual territories and emits complete offline candidates."""

    capability_version = "design-territories-web/1"
    p6_slot = "design.intelligence"
    ready_for_p6 = True

    _territories = (
        (
            "Graphite Signal",
            "Editorial graphite surfaces with one amber operational signal",
            ("#F2EFE8", "#191A1D", "#D89B2B", "#B8B2A7", "#706A61", "#FFF8E8"),
            "serif",
        ),
        (
            "Paper Ledger",
            "Warm paper, ruled structure, and a decisive vermilion annotation",
            ("#FFF9ED", "#28211B", "#C94A2A", "#D8CDBB", "#75695D", "#FFF2D5"),
            "sans-serif",
        ),
        (
            "Cobalt Index",
            "Dense information index with cobalt navigation and quiet neutral fields",
            ("#F4F6FA", "#151A24", "#2855D9", "#C9CFDB", "#697386", "#EAF0FF"),
            "sans-serif",
        ),
        (
            "Moss Workshop",
            "Tactile workshop rhythm with moss accents and broad breathing room",
            ("#F3F1E7", "#20251F", "#55734A", "#C8C8B8", "#687064", "#EEF4E8"),
            "serif",
        ),
    )

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
        return DesignStrategy(
            stable_id(
                "strategy",
                context.id,
                brief,
                constraints,
                count,
                self.capability_version,
            ),
            Lineage(context.project_id, run.id, self.capability_version),
            context.id,
            brief,
            constraints,
            count,
        )

    def create_candidates(
        self,
        strategy: DesignStrategy,
        context: ContextPackage,
        run: WorkflowRun,
    ) -> tuple[Candidate, ...]:
        candidates: list[Candidate] = []
        for index, territory in enumerate(
            self._territories[: strategy.candidate_count], start=1
        ):
            title, concept, palette, family = territory
            candidate_id = stable_id("candidate", strategy.id, title)
            candidates.append(
                Candidate(
                    candidate_id,
                    1,
                    None,
                    Lineage(context.project_id, run.id, self.capability_version),
                    title,
                    concept,
                    self._candidate_html(
                        candidate_id,
                        title,
                        concept,
                        strategy.brief,
                        palette,
                        family,
                        index,
                    ),
                    "oeydesign-territory-engine",
                    strategy.constraints.template_role,
                    strategy.constraints,
                    context.source_refs,
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
        revised = candidate.preview_html.replace(
            "</main>",
            f'<aside class="revision" data-oey-object="revision-note">{note}</aside>'
            "</main>",
        )
        AnchorRegistry().extract(revised)
        return replace(
            candidate,
            revision=candidate.revision + 1,
            parent_revision=candidate.revision,
            lineage=Lineage(context.project_id, run.id, self.capability_version),
            concept=f"{candidate.concept}; revised direction: {feedback.text}",
            preview_html=revised,
        )

    def commit_direction(
        self,
        candidate: Candidate,
        approval: Approval,
        run: WorkflowRun,
    ) -> ApprovedDirection:
        if (
            not approval.active
            or approval.target_id != candidate.id
            or approval.target_revision != candidate.revision
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Direction approval does not match the candidate revision",
            )
        anchors = AnchorRegistry().extract(candidate.preview_html)
        if not anchors:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Approved direction has no stable object anchors",
            )
        return ApprovedDirection(
            stable_id("direction", candidate.id, candidate.revision, approval.id),
            Lineage(
                candidate.lineage.project_id, run.id, self.capability_version
            ),
            candidate.id,
            candidate.revision,
            approval.id,
            candidate.preview_html,
        )

    @staticmethod
    def _candidate_html(
        candidate_id: str,
        title: str,
        concept: str,
        brief: DesignBrief,
        palette: tuple[str, ...],
        family: str,
        index: int,
    ) -> str:
        background, foreground, accent, border, muted, focus = palette
        template = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title><style>
:root { --background:__BG__; --foreground:__FG__; --accent:__ACCENT__;
--border:__BORDER__; --muted:__MUTED__; --focus:__FOCUS__; }
* { box-sizing:border-box }
body { margin:0; background:var(--background); color:var(--foreground);
font:16px/1.5 Arial,sans-serif }
main { min-height:100vh; padding:clamp(28px,6vw,88px) }
.eyebrow { color:var(--accent); font-weight:800; letter-spacing:.14em }
h1 { font:700 clamp(52px,9vw,128px)/.9 __FAMILY__;
max-width:10ch; margin:.5em 0 }
.grid { display:grid; grid-template-columns:2fr 1fr; gap:32px;
border-top:1px solid var(--border); padding-top:28px }
.card { border:1px solid var(--border); padding:24px;
background:var(--focus) }
.meta { color:var(--muted) }
a { color:var(--foreground); text-decoration-thickness:2px }
a:focus-visible { outline:3px solid var(--accent); outline-offset:4px }
.revision { margin-top:32px; border-left:6px solid var(--accent); padding:16px }
@media(max-width:720px) { .grid { grid-template-columns:1fr }
h1 { font-size:54px } }
</style></head><body><main data-oey-preview-root="artifact"
data-oey-section="direction-__INDEX__">
<p class="eyebrow">DIRECTION 0__INDEX__ / __TITLE_UPPER__</p>
<h1 data-oey-object="hero-title">__GOAL__</h1>
<section class="grid" data-oey-object="content-grid"><div>
<h2>__CONCEPT__</h2><p>__AUDIENCE__ should understand the primary action
immediately, with a complete narrative rather than an empty shell.</p></div>
<article class="card" data-oey-object="action-card">
<strong>Ready for review</strong><p class="meta">Offline Web candidate,
stable anchors, responsive layout</p>
<a href="#details">Inspect direction</a></article></section>
<section id="details" data-oey-object="details"><h2>Design intent</h2>
<p>Candidate __ID__ uses one accent, explicit hierarchy, and durable object
references.</p></section></main></body></html>"""
        replacements = {
            "__TITLE__": escape(title),
            "__TITLE_UPPER__": escape(title.upper()),
            "__GOAL__": escape(brief.goal),
            "__CONCEPT__": escape(concept),
            "__AUDIENCE__": escape(brief.audience),
            "__ID__": escape(candidate_id),
            "__INDEX__": str(index),
            "__BG__": background,
            "__FG__": foreground,
            "__ACCENT__": accent,
            "__BORDER__": border,
            "__MUTED__": muted,
            "__FOCUS__": focus,
            "__FAMILY__": family,
        }
        for key, value in replacements.items():
            template = template.replace(key, value)
        return template
