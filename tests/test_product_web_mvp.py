from __future__ import annotations

import io
import json
import os
import threading
import time
from http.client import HTTPConnection
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from oeydesign.capabilities import ProviderResponse
from oeydesign.credentials import KIMI_CREDENTIAL_TARGET, MemoryCredentialStore
from oeydesign.domain import ContractError, ErrorCategory, RightsStatus
from oeydesign.product import AgentJobStatus
from oeydesign.product_shell import ProductShellService, make_server
from oeydesign.web_mvp import ProductApplication, parse_intake_decision


def _app(
    root: Path,
    *,
    dependency_image: Path | None = None,
    credentials: MemoryCredentialStore | None = None,
) -> ProductApplication:
    return ProductApplication(
        root / "oeydesign.sqlite",
        data_root=root,
        dependency_image=dependency_image,
        credentials=credentials or MemoryCredentialStore(),
    )


def _png() -> bytes:
    payload = io.BytesIO()
    Image.new("RGB", (48, 32), "#d9ff43").save(payload, "PNG")
    return payload.getvalue()


def _request(
    port: int,
    method: str,
    path: str,
    *,
    payload: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    connection = HTTPConnection("127.0.0.1", port, timeout=10)
    connection.request(method, path, payload, headers or {})
    response = connection.getresponse()
    raw = response.read()
    connection.close()
    return response.status, json.loads(raw)


def test_production_shell_starts_blocked_and_enforces_origin_csrf(
    tmp_path: Path,
) -> None:
    app = _app(tmp_path)
    server = make_server(app, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_port
    try:
        status, session = _request(port, "GET", "/api/session")
        assert status == 200
        status, health = _request(port, "GET", "/api/health")
        assert status == 200
        assert health["product_ready"] is False
        assert "deterministic" not in repr(health).casefold()

        body = json.dumps({"command_id": "create:1", "name": "Real project"}).encode()
        status, rejected = _request(
            port,
            "POST",
            "/api/projects",
            payload=body,
            headers={"Content-Type": "application/json"},
        )
        assert status == 403
        assert rejected["category"] == ErrorCategory.POLICY_BLOCKED.value

        trusted = {
            "Content-Type": "application/json",
            "Origin": f"http://127.0.0.1:{port}",
            "X-OEY-CSRF": session["csrf_token"],
        }
        status, project = _request(
            port, "POST", "/api/projects", payload=body, headers=trusted
        )
        assert status == 201
        assert project["state"] == "NEW"
        activity = app.product_store.append_activity(
            project_id=project["id"],
            job_id="job-visible-progress",
            type="stream",
            stage="provider-request",
            summary="Kimi is streaming the next action",
            details={"chunks": 3, "content": "must-not-leak"},
        )
        status, progress = _request(
            port,
            "GET",
            f"/api/projects/{project['id']}/activity?after=0",
        )
        assert status == 200
        assert progress[0]["sequence"] == activity.sequence
        assert progress[0]["details"] == {"chunks": 3}
        status, no_progress = _request(
            port,
            "GET",
            f"/api/projects/{project['id']}/activity?after={activity.sequence}",
        )
        assert status == 200
        assert no_progress == []
        message = json.dumps(
            {
                "client_message_id": "message:1",
                "expected_revision": project["revision"],
                "text": "Create a project introduction page.",
            }
        ).encode()
        status, blocked = _request(
            port,
            "POST",
            f"/api/projects/{project['id']}/messages",
            payload=message,
            headers=trusted,
        )
        assert status == 503
        assert blocked["category"] == ErrorCategory.CAPABILITY_UNAVAILABLE.value
        assert "traceback" not in repr(blocked).casefold()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        app.close()


def test_reference_images_are_decoded_analysis_only_and_recoverable(
    tmp_path: Path,
) -> None:
    credentials = MemoryCredentialStore()
    app = _app(tmp_path, credentials=credentials)
    project = app.create_empty_project(command_id="project:1", name="Image intake")
    source = app.images.ingest(
        project_id=project.project_id,
        filename="reference.png",
        media_type="image/png",
        payload=_png(),
    )
    assert source.rights is RightsStatus.ANALYSIS_ONLY
    assert app.images.read(source) == _png()
    with pytest.raises(ContractError) as mismatch:
        app.images.ingest(
            project_id=project.project_id,
            filename="spoof.jpg",
            media_type="image/jpeg",
            payload=_png(),
        )
    assert mismatch.value.category is ErrorCategory.POLICY_BLOCKED
    with pytest.raises(ContractError) as duplicate:
        app.images.ingest(
            project_id=project.project_id,
            filename="same.png",
            media_type="image/png",
            payload=_png(),
        )
    assert duplicate.value.category is ErrorCategory.POLICY_BLOCKED
    app.close()

    reopened = _app(tmp_path, credentials=credentials)
    try:
        restored = reopened.evidence_repository.list_sources(project.project_id)
        assert [item.id for item in restored] == [source.id]
        assert reopened.images.read(restored[0]) == _png()
    finally:
        reopened.close()


def test_multipart_image_api_uses_revision_and_analysis_only_rights(
    tmp_path: Path,
) -> None:
    app = _app(tmp_path)
    service = ProductShellService(app)
    project = service.create_project({"command_id": "project:1", "name": "Upload"})
    server = make_server(app, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_port
    try:
        _, session = _request(port, "GET", "/api/session")
        boundary = "----oeydesign-test-boundary"
        chunks = [
            (
                f"--{boundary}\r\nContent-Disposition: form-data; "
                'name="command_id"\r\n\r\nimage:1\r\n'
            ).encode(),
            (
                f"--{boundary}\r\nContent-Disposition: form-data; "
                'name="expected_revision"\r\n\r\n'
                f"{project['revision']}\r\n"
            ).encode(),
            (
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
                'filename="reference.png"\r\nContent-Type: image/png\r\n\r\n'
            ).encode()
            + _png()
            + b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
        body = b"".join(chunks)
        status, uploaded = _request(
            port,
            "POST",
            f"/api/projects/{project['id']}/sources/images",
            payload=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Origin": f"http://127.0.0.1:{port}",
                "X-OEY-CSRF": session["csrf_token"],
            },
        )
        assert status == 201
        assert uploaded["rights"] == RightsStatus.ANALYSIS_ONLY.value
        repeated_status, repeated = _request(
            port,
            "POST",
            f"/api/projects/{project['id']}/sources/images",
            payload=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Origin": f"http://127.0.0.1:{port}",
                "X-OEY-CSRF": session["csrf_token"],
            },
        )
        assert repeated_status == 201
        assert repeated["id"] == uploaded["id"]
        assert len(app.evidence_repository.list_sources(project["id"])) == 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        app.close()


@pytest.mark.skipif(os.name != "nt", reason="Product composition is Windows-only")
def test_product_readiness_recomputes_after_credential_changes(tmp_path: Path) -> None:
    dependency_image = (
        Path(__file__).parents[1]
        / "spikes"
        / "e8-e12-framework"
        / "node_modules"
    )
    if not dependency_image.is_dir():
        pytest.skip("Frozen dependency image is unavailable")
    credentials = MemoryCredentialStore()
    app = _app(
        tmp_path,
        dependency_image=dependency_image,
        credentials=credentials,
    )
    try:
        assert app.product_readiness.ready is False
        app.provider.configure(
            base_url="https://example.test/v1",
            model="fixture",
            api_key="highly-secret-value",
            probe=False,
        )
        readiness = app.product_readiness
        assert readiness.ready is True
        assert readiness.capabilities["design.intelligence"] == (
            "agent-design-compose/1"
        )
        assert "highly-secret-value" not in repr(readiness)
        cleared = app.provider.delete()
        assert cleared.base_url == ""
        assert cleared.model == ""
        assert app.product_readiness.ready is False
    finally:
        app.close()


def test_provider_settings_can_be_reprobed_without_reentering_the_secret(
    tmp_path: Path,
) -> None:
    credentials = MemoryCredentialStore()
    app = ProductApplication(
        tmp_path / "provider-reuse.sqlite",
        data_root=tmp_path,
        credentials=credentials,
    )
    try:
        app.provider.configure(
            base_url="https://example.test/v1",
            model="first-model",
            api_key="credential-kept-in-windows",
            probe=False,
        )
        updated = app.provider.configure(
            base_url="https://example.test/v2",
            model="second-model",
            api_key=None,
            probe=False,
        )
        assert updated.base_url == "https://example.test/v2"
        assert updated.model == "second-model"
        assert credentials.read(KIMI_CREDENTIAL_TARGET) == (
            "credential-kept-in-windows"
        )
    finally:
        app.close()


def test_product_application_refuses_a_second_runtime_for_the_same_database(
    tmp_path: Path,
) -> None:
    database = tmp_path / "single-runtime.sqlite"
    first = ProductApplication(
        database,
        data_root=tmp_path,
        credentials=MemoryCredentialStore(),
    )
    try:
        with pytest.raises(RuntimeError, match="already open"):
            ProductApplication(
                database,
                data_root=tmp_path,
                credentials=MemoryCredentialStore(),
            )
    finally:
        first.close()
    reopened = ProductApplication(
        database,
        data_root=tmp_path,
        credentials=MemoryCredentialStore(),
    )
    reopened.close()


def test_intake_parser_enforces_one_structured_question() -> None:
    decision = parse_intake_decision(
        json.dumps(
            {
                "status": "NEEDS_INPUT",
                "question": "Who is the primary audience?",
                "material_uncertainties": ["audience"],
                "image_analyses": [],
            }
        )
    )
    assert decision.status == "NEEDS_INPUT"
    assert decision.question == "Who is the primary audience?"
    with pytest.raises(ContractError):
        parse_intake_decision('{"status":"NEEDS_INPUT","image_analyses":[]}')


def test_preview_selection_tokens_rotate_once(tmp_path: Path) -> None:
    app = _app(tmp_path)
    try:
        service = ProductShellService(app)
        first = service._preview_token("fileset-1", "candidate-1", 1)
        assert service._preview_token("fileset-1", "candidate-1", 1) == first
        rotated = service.rotate_preview_token("fileset-1", {"token": first})
        assert rotated["preview_token"] != first
        with pytest.raises(ContractError) as reused:
            service.rotate_preview_token("fileset-1", {"token": first})
        assert reused.value.category is ErrorCategory.POLICY_BLOCKED
    finally:
        app.close()


def test_needs_input_resumes_the_same_durable_intake_job(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class IntakeClient:
        def __init__(self) -> None:
            self.count = 0

        def chat(self, messages, **kwargs):
            del messages, kwargs
            self.count += 1
            if self.count == 1:
                payload = {
                    "status": "NEEDS_INPUT",
                    "question": "Who is the primary audience?",
                    "goal": "",
                    "audience": "",
                    "material_uncertainties": ["audience"],
                    "image_analyses": [],
                }
            else:
                payload = {
                    "status": "READY",
                    "question": None,
                    "goal": "Explain the product",
                    "audience": "Technical buyers",
                    "confirmed_facts": ["Audience is technical buyers"],
                    "material_uncertainties": [],
                    "image_analyses": [],
                }
            return ProviderResponse(
                json.dumps(payload),
                {"prompt_tokens": 3, "completion_tokens": 2},
                0.01,
                "stop",
            )

    monkeypatch.delenv("OEYDESIGN_FRAMEWORK_DEPENDENCIES", raising=False)
    app = _app(tmp_path)
    app.require_product_ready = lambda: None  # type: ignore[method-assign]
    client = IntakeClient()
    app.provider.require = lambda: (client, "fixture")  # type: ignore[method-assign]
    try:
        created = app.create_empty_project(command_id="project:1", name="Clarify")
        first = app.submit_message(
            project_id=created.project_id,
            client_message_id="message:1",
            expected_revision=1,
            text="Create a landing page.",
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            paused = app.product_store.get_job(first.id)
            if paused.status is AgentJobStatus.PAUSED:
                break
            time.sleep(0.05)
        assert paused.status is AgentJobStatus.PAUSED
        assert paused.stage == "needs-input"
        project = app.repository.get(created.project_id)
        assert project.state.value == "NEEDS_INPUT"

        resumed = app.submit_message(
            project_id=created.project_id,
            client_message_id="message:2",
            expected_revision=project.revision,
            text="The primary audience is technical buyers.",
        )
        assert resumed.id == first.id
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            completed = app.product_store.get_job(first.id)
            if completed.status in {
                AgentJobStatus.COMPLETED,
                AgentJobStatus.FAILED,
            }:
                break
            time.sleep(0.05)
        assert completed.status is AgentJobStatus.COMPLETED, completed.error_message
        assert completed.total_tokens == 10
        repeated = app.submit_message(
            project_id=created.project_id,
            client_message_id="message:2",
            expected_revision=project.revision,
            text="The primary audience is technical buyers.",
        )
        assert repeated.id == first.id
        assert len(app.product_store.list_jobs(created.project_id)) == 1
        messages = app.product_store.list_messages(created.project_id)
        assert messages[-2].run_id == first.id
        assert app.repository.get(created.project_id).state.value == (
            "AWAITING_DIRECTION_APPROVAL"
        )
    finally:
        app.close()
