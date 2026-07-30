from __future__ import annotations

import json
import threading
from http.client import HTTPConnection
from pathlib import Path
from typing import Any

import pytest

from oeydesign.composition import SQLiteApplication
from oeydesign.domain import (
    ConstraintPreset,
    ContractError,
    ErrorCategory,
    ProjectState,
    TemplateRole,
)
from oeydesign.product_shell import ProductShellService, make_server


def create_demo(
    service: ProductShellService,
    command_id: str = "p4:create",
    *,
    preset: ConstraintPreset = ConstraintPreset.DESIGN_GUIDED,
    role: TemplateRole = TemplateRole.REFERENCE_SAMPLE,
) -> dict[str, Any]:
    return service.create_demo(
        {
            "command_id": command_id,
            "name": f"Proof {command_id}",
            "preset": preset.value,
            "template_role": role.value,
        }
    )


def act(
    service: ProductShellService,
    project: dict[str, Any],
    action: str,
    command_id: str,
    **values: Any,
) -> dict[str, Any]:
    return service.command(
        project["id"],
        {
            "command_id": command_id,
            "expected_revision": project["revision"],
            "action": action,
            **values,
        },
    )


def advance_to_artifact(
    service: ProductShellService, project: dict[str, Any], prefix: str
) -> dict[str, Any]:
    project = act(service, project, "generate_candidates", f"{prefix}:generate")
    candidate = project["candidates"][0]
    project = act(
        service,
        project,
        "approve_direction",
        f"{prefix}:approve-direction",
        candidate_id=candidate["id"],
        candidate_revision=candidate["revision"],
    )
    return act(service, project, "produce_artifact", f"{prefix}:produce")


def advance_to_delivery_ready(
    service: ProductShellService, project: dict[str, Any], prefix: str
) -> dict[str, Any]:
    project = advance_to_artifact(service, project, prefix)
    project = act(service, project, "validate_artifact", f"{prefix}:validate")
    return act(service, project, "approve_export", f"{prefix}:approve-export")


def test_complete_product_flow_is_idempotent_and_recovers(tmp_path: Path) -> None:
    database = tmp_path / "shell.sqlite"
    with SQLiteApplication(database, data_root=tmp_path) as app:
        service = ProductShellService(app)
        project = create_demo(
            service,
            preset=ConstraintPreset.GOVERNED_PRODUCTION,
            role=TemplateRole.DELIVERY_CONTRACT,
        )
        assert project["state"] == ProjectState.READY_FOR_DESIGN.value
        assert project["preset"] == ConstraintPreset.GOVERNED_PRODUCTION.value
        assert project["template_role"] == TemplateRole.DELIVERY_CONTRACT.value
        assert (
            service.create_demo(
                {
                    "command_id": "p4:create",
                    "name": "Proof p4:create",
                    "preset": ConstraintPreset.GOVERNED_PRODUCTION.value,
                    "template_role": TemplateRole.DELIVERY_CONTRACT.value,
                }
            )
            == project
        )

        project = advance_to_delivery_ready(service, project, "p4")
        deliver_body = {
            "command_id": "p4:deliver",
            "expected_revision": project["revision"],
            "action": "deliver",
            "delivery_profile": {"format": "zip"},
        }
        delivered = service.command(project["id"], deliver_body)
        duplicate = service.command(project["id"], deliver_body)
        assert delivered == duplicate
        assert delivered["state"] == ProjectState.DELIVERED.value
        assert len(delivered["deliveries"]) == 1
        assert delivered["deliveries"][0]["manifest"]["format"] == "zip"
        assert delivered["deliveries"][0]["export_id"]
        assert delivered["deliveries"][0]["export_revision"] == 1
        assert delivered["deliveries"][0]["quality_decision_id"]
        assert delivered["deliveries"][0]["approval_id"]
        assert delivered["quality"]["verdict"] == "PASS"
        assert delivered["quality"]["aesthetic_findings"]
        assert delivered["quality"]["hard_errors"] == []
        assert delivered["focus"]["kind"] == "artifact"
        assert all("provider" not in key.lower() for key in delivered)
        project_id = delivered["id"]
        last_sequence = delivered["activity"][-2]["sequence"]
        expected_tail = service.events(project_id, last_sequence)

    with SQLiteApplication(database, data_root=tmp_path) as reopened:
        service = ProductShellService(reopened)
        recovered = service.project(project_id)
        assert recovered == delivered
        assert service.projects() == [
            {
                "id": recovered["id"],
                "name": recovered["name"],
                "state": recovered["state"],
                "revision": recovered["revision"],
            }
        ]
        assert service.events(project_id, last_sequence) == expected_tail


def test_feedback_routes_create_distinct_revisions_and_invalidate_approvals(
    tmp_path: Path,
) -> None:
    with SQLiteApplication(tmp_path / "feedback.sqlite", data_root=tmp_path) as app:
        service = ProductShellService(app)
        project = create_demo(service, "feedback:create")
        project = act(service, project, "generate_candidates", "feedback:generate")
        candidate = project["candidates"][0]
        project = act(
            service,
            project,
            "approve_direction",
            "feedback:approve-one",
            candidate_id=candidate["id"],
            candidate_revision=1,
        )
        project = act(
            service,
            project,
            "direction_feedback",
            "feedback:direction",
            target_id=candidate["id"],
            target_revision=1,
            text="Use a calmer editorial direction",
        )
        revised = project["candidates"][0]
        assert revised["revision"] == 2
        assert project["feedback"][-1]["routed_to"] == ["design"]
        assert any(not item["active"] for item in project["approvals"])

        project = act(
            service,
            project,
            "approve_direction",
            "feedback:approve-two",
            candidate_id=revised["id"],
            candidate_revision=2,
        )
        project = act(service, project, "produce_artifact", "feedback:produce")
        artifact_revision = project["focus"]["artifact_revision"]
        project = act(
            service,
            project,
            "local_feedback",
            "feedback:local",
            target_id=project["focus"]["artifact_id"],
            target_revision=artifact_revision,
            object_ref="hero:title",
            text="Shorten the title",
        )
        assert project["focus"]["artifact_revision"] == artifact_revision + 1
        assert project["feedback"][-1]["routed_to"] == ["artifact"]
        assert project["feedback"][-1]["object_ref"] == "hero:title"

        project = act(service, project, "validate_artifact", "feedback:validate")
        project = act(service, project, "approve_export", "feedback:approve-export")
        project = act(
            service,
            project,
            "fact_feedback",
            "feedback:fact",
            text="The approved claim needs correction",
        )
        assert project["state"] == ProjectState.NEEDS_INPUT.value
        assert project["feedback"][-1]["routed_to"] == ["context", "quality"]
        assert all(not item["active"] for item in project["approvals"])


def test_actual_export_hard_error_cannot_be_bypassed(tmp_path: Path) -> None:
    with SQLiteApplication(tmp_path / "gate.sqlite", data_root=tmp_path) as app:
        service = ProductShellService(app)
        ready = advance_to_delivery_ready(
            service,
            create_demo(service, "gate:create"),
            "gate",
        )
        blocked = act(
            service,
            ready,
            "deliver",
            "gate:broken-export",
            delivery_profile={"format": "zip", "simulate_hard_error": True},
        )
        assert blocked["state"] == ProjectState.PRODUCING.value
        assert blocked["deliveries"] == []
        assert blocked["quality"]["hard_errors"][0]["code"] == "EXPORT_INTEGRITY"
        assert all(
            not item["active"]
            for item in blocked["approvals"]
            if item["action"] == "EXPORT"
        )
        assert "deliver" not in {item["id"] for item in blocked["actions"]}
        with pytest.raises(ContractError) as bypass:
            act(service, blocked, "deliver", "gate:bypass")
        assert bypass.value.category is ErrorCategory.INVALID_TRANSITION


@pytest.mark.parametrize("preset", tuple(ConstraintPreset))
def test_all_constraint_presets_are_observable(
    tmp_path: Path, preset: ConstraintPreset
) -> None:
    with SQLiteApplication(
        tmp_path / f"{preset.value}.sqlite", data_root=tmp_path
    ) as app:
        project = create_demo(
            ProductShellService(app),
            f"preset:{preset.value}",
            preset=preset,
        )
        expected = {
            ConstraintPreset.OPEN_EXPLORATION: "open",
            ConstraintPreset.DESIGN_GUIDED: "guided",
            ConstraintPreset.GOVERNED_PRODUCTION: "strict",
        }[preset]
        assert project["preset"] == preset.value
        assert project["constraints"]["settings"]["brand_style"]["level"] == expected


@pytest.mark.parametrize("role", tuple(TemplateRole))
def test_all_template_roles_reach_candidate_and_constraint_behavior(
    tmp_path: Path, role: TemplateRole
) -> None:
    with SQLiteApplication(
        tmp_path / f"{role.value}.sqlite", data_root=tmp_path
    ) as app:
        service = ProductShellService(app)
        project = create_demo(service, f"role:{role.value}", role=role)
        project = act(service, project, "generate_candidates", f"role:{role.value}:gen")
        assert project["template_role"] == role.value
        assert all(
            item["template_role"] == role.value for item in project["candidates"]
        )
        assert all(
            f'data-template-role="{role.value}"' in item["preview_html"]
            for item in project["candidates"]
        )


def test_stale_revision_and_invalid_shell_input_are_rejected(tmp_path: Path) -> None:
    with SQLiteApplication(tmp_path / "invalid.sqlite", data_root=tmp_path) as app:
        service = ProductShellService(app)
        with pytest.raises(ValueError):
            service.create_demo({})
        with pytest.raises(ValueError):
            service.create_demo(
                {"command_id": "bad-role", "template_role": "VENDOR_PRIVATE_ROLE"}
            )
        project = create_demo(service, "invalid:create")
        with pytest.raises(ValueError):
            service.command(
                project["id"],
                {"command_id": "missing-revision", "action": "generate_candidates"},
            )
        with pytest.raises(ContractError) as stale:
            service.command(
                project["id"],
                {
                    "command_id": "stale",
                    "expected_revision": 1,
                    "action": "generate_candidates",
                },
            )
        assert stale.value.category is ErrorCategory.STALE_REVISION
        with pytest.raises(ValueError):
            act(service, project, "provider_private_action", "invalid:action")


def http_request(
    port: int, method: str, path: str, body: dict[str, Any] | str | None = None
) -> tuple[int, dict[str, str], bytes]:
    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    if isinstance(body, dict):
        payload = json.dumps(body).encode("utf-8")
    elif isinstance(body, str):
        payload = body.encode("utf-8")
    else:
        payload = None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    connection.request(method, path, body=payload, headers=headers)
    response = connection.getresponse()
    raw = response.read()
    result = (
        response.status,
        {key.lower(): value for key, value in response.headers.items()},
        raw,
    )
    connection.close()
    return result


def test_http_boundary_serves_shell_and_safe_api_errors(tmp_path: Path) -> None:
    app = SQLiteApplication(tmp_path / "http.sqlite", data_root=tmp_path)
    static_dir = Path(__file__).parents[1] / "product-client"
    with pytest.raises(ValueError):
        make_server(app, host="0.0.0.0", static_dir=static_dir)
    server = make_server(app, port=0, static_dir=static_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_port
    try:
        status, headers, html = http_request(port, "GET", "/")
        assert status == 200
        assert headers["content-type"].startswith("text/html")
        assert "frame-ancestors 'none'" in headers["content-security-policy"]
        assert b'id="workspace"' in html

        status, _, raw = http_request(
            port,
            "POST",
            "/api/projects",
            {
                "command_id": "http:create",
                "name": "HTTP proof",
                "preset": "DESIGN_GUIDED",
                "template_role": "REFERENCE_SAMPLE",
            },
        )
        assert status == 201
        project = json.loads(raw)
        status, _, raw = http_request(
            port,
            "POST",
            f"/api/projects/{project['id']}/commands",
            {
                "command_id": "http:stale",
                "expected_revision": 1,
                "action": "generate_candidates",
            },
        )
        error = json.loads(raw)
        assert status == 409
        assert error["category"] == ErrorCategory.STALE_REVISION.value
        assert "stack" not in raw.decode("utf-8").lower()
        assert "details" not in error

        status, _, raw = http_request(
            port, "GET", f"/api/projects/{project['id']}/events?after=0"
        )
        assert status == 200
        assert json.loads(raw)
        status, _, raw = http_request(port, "GET", "/../pyproject.toml")
        assert status == 404
        assert json.loads(raw)["category"] == "NOT_FOUND"
        status, _, raw = http_request(port, "POST", "/api/projects", "not-json")
        assert status == 400
        assert json.loads(raw)["category"] == "INVALID_REQUEST"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        app.close()


def test_static_client_has_accessibility_and_no_shadow_business_store() -> None:
    root = Path(__file__).parents[1] / "product-client"
    html = (root / "index.html").read_text(encoding="utf-8")
    css = (root / "styles.css").read_text(encoding="utf-8")
    script = (root / "app.js").read_text(encoding="utf-8")
    combined = f"{html}\n{css}\n{script}".lower()

    assert '<html lang="zh-cn">' in html.lower()
    assert "<main" in html and "<nav" in html and "<aside" in html
    assert 'aria-live="polite"' in html
    assert 'role="status"' in html
    assert "focus-visible" in css
    assert "prefers-reduced-motion" in css
    assert "@media" in css
    assert 'frame.setAttribute("sandbox", "")' in script
    assert "crypto.randomUUID()" in script
    assert "direction_feedback" in script
    assert "local_feedback" in script
    assert "fact_feedback" in script
    assert "fallbackActions" not in script
    assert "/events?after=" in script
    assert 'for="localFeedback"' in html
    assert 'data-mobile-panel="activityRail"' in html
    assert 'data-mobile-open="true"' in css
    assert "localstorage" not in combined
    assert "sessionstorage" not in combined
    assert "https://" not in combined
    assert "供应商 payload" in combined
