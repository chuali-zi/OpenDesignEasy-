from __future__ import annotations

from oeydesign.domain import (
    Approval,
    ApprovalAction,
    ContextPackage,
    GateVerdict,
    Lineage,
    RenderBundle,
    WorkflowRun,
    WorkflowStatus,
    constraint_profile,
)
from oeydesign.quality import WebQualityPort


def _run() -> WorkflowRun:
    return WorkflowRun(
        "run-1",
        "project-1",
        "quality",
        1,
        "quality-1",
        WorkflowStatus.RUNNING,
        "quality",
    )


def _context() -> ContextPackage:
    return ContextPackage("context-1", "project-1", 1, (), ())


def _render(content: str, profile: dict[str, object] | None = None) -> RenderBundle:
    trusted: dict[str, object] = {
        "trusted_render": True,
        "screenshot_sha256": "a" * 64,
        "chrome_version": "150.0",
        "healthy": True,
        "dom_metrics": {
            "object_anchors": ["hero"],
            "unique_object_anchors": 1,
            "scroll_width": 1440,
            "client_width": 1440,
            "computed_styles": {"hero": {"display": "block"}},
        },
    }
    trusted.update(profile or {})
    return RenderBundle(
        "render-1",
        1,
        Lineage("project-1", "run-1", "renderer/1"),
        "artifact-1",
        1,
        content,
        trusted,
    )


def test_quality_hard_track_detects_runtime_and_accessibility_failures() -> None:
    decision = WebQualityPort().assess_artifact(
        _render(
            '<main data-oey-section="hero"><img src="/logo.svg"></main>',
            {"console_errors": ("boom",)},
        ),
        {"profile": "demo"},
        _context(),
        constraint_profile(),
        _run(),
    )
    assert decision.verdict is GateVerdict.BLOCK
    assert {finding.code for finding in decision.hard_errors} == {
        "IMAGE_ALT_MISSING",
        "CONSOLE_ERRORS",
    }
    assert all(finding.kind.value == "HARD_ERROR" for finding in decision.hard_errors)


def test_declared_mock_is_demo_notice_but_production_block() -> None:
    quality = WebQualityPort()
    subject = _render(
        '<main data-oey-object="data"><script>window.fetch = fake</script></main>',
        {"mock_declared": True},
    )
    demo = quality.assess_artifact(
        subject,
        {"profile": "demo", "mock_declared": True},
        _context(),
        constraint_profile(),
        _run(),
    )
    assert demo.verdict is GateVerdict.PASS
    assert demo.aesthetic_findings[0].code == "MOCK_DEMO_NOTICE"

    production = quality.assess_artifact(
        subject,
        {"profile": "production", "mock_declared": True},
        _context(),
        constraint_profile(),
        _run(),
    )
    assert production.verdict is GateVerdict.BLOCK
    assert production.hard_errors[0].code == "MOCK_PRODUCTION"


def test_render_decision_cannot_authorize_delivery() -> None:
    quality = WebQualityPort()
    decision = quality.assess_artifact(
        _render('<main data-oey-object="hero"></main>'),
        {"profile": "demo"},
        _context(),
        constraint_profile(),
        _run(),
    )
    approval = Approval(
        "approval-1",
        "project-1",
        ApprovalAction.EXPORT,
        "artifact-1",
        1,
        "release",
    )
    gate = quality.authorize_transition(decision, "deliver", (approval,))
    assert gate.authorized is False
