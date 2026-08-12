from __future__ import annotations

import io
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from gui_client.backend import BackendError, HttpBackend
from gui_client.runtime import DesktopRuntime
from oeydesign.credentials import MemoryCredentialStore
from oeydesign.product_shell import make_server
from oeydesign.web_mvp import ProductApplication


def _png() -> bytes:
    payload = io.BytesIO()
    Image.new("RGB", (32, 24), "#ffd93d").save(payload, "PNG")
    return payload.getvalue()


def test_http_backend_real_project_sources_and_safe_blocker(tmp_path: Path) -> None:
    app = ProductApplication(
        tmp_path / "oeydesign.sqlite",
        data_root=tmp_path,
        credentials=MemoryCredentialStore(),
    )
    server = make_server(app, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        backend = HttpBackend(f"http://127.0.0.1:{server.server_port}")
        status, blockers = backend.health()
        assert status == "needs_configuration"
        assert blockers

        summary = backend.create_project("Desktop test")
        assert backend.list_projects() == [summary]
        project = backend.get_project(summary.id)
        assert project.revision == 1

        repository = tmp_path / "repository"
        repository.mkdir()
        (repository / "README.md").write_text("# Read-only source", encoding="utf-8")
        backend.attach_repository(project.id, str(repository))

        image_path = tmp_path / "reference.png"
        image_path.write_bytes(_png())
        backend.upload_images(project.id, [str(image_path)])
        recovered = backend.get_project(project.id)
        assert {source.kind for source in recovered.sources} == {
            "repository",
            "image",
        }

        with pytest.raises(BackendError) as blocked:
            backend.send_message(project.id, "Create a repository introduction page")
        assert blocked.value.category == "CAPABILITY_UNAVAILABLE"
        assert "traceback" not in str(blocked.value).casefold()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        app.close()


@dataclass
class _Value:
    value: str


@dataclass
class _Job:
    id: str
    project_id: str
    kind: str = "revision"
    status: _Value = field(default_factory=lambda: _Value("RUNNING"))
    stage: str = "render"
    steps: int = 3
    total_tokens: int = 1200
    renders: int = 1
    elapsed_seconds: float = 2.5
    result: dict[str, Any] = field(default_factory=dict)
    error_category: str | None = None
    error_message: str | None = None

class _FakeStore:
    def get_job(self, job_id: str) -> _Job:
        return _Job(job_id, "project-1")


class _FakeJobs:
    def __init__(self) -> None:
        self.actions: list[tuple[str, str]] = []

    def pause(self, job_id: str) -> _Job:
        self.actions.append((job_id, "pause"))
        return _Job(job_id, "project-1")

    resume = pause
    cancel = pause


class _FakeApplication:
    def __init__(self) -> None:
        self.product_store = _FakeStore()
        self.jobs = _FakeJobs()
        self.closed = False

    def close(self) -> None:
        self.closed = True


def test_http_backend_run_action_uses_csrf_and_desktop_runtime_closes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = _FakeApplication()
    monkeypatch.setattr(
        "oeydesign.web_mvp.ProductApplication", lambda *args, **kwargs: fake
    )
    with DesktopRuntime(data_root=tmp_path) as runtime:
        runtime.backend.pause_run("run-1")
        assert fake.jobs.actions == [("run-1", "pause")]
        assert runtime.backend._json("GET", "/api/runs/run-1")["status"] == "RUNNING"
    assert fake.closed is True


def test_project_projection_keeps_preview_revision_and_visual_gate() -> None:
    backend = HttpBackend("http://127.0.0.1:8765")
    project = backend._project(
        {
            "id": "project-1",
            "name": "Projection",
            "state": "VALIDATING",
            "revision": 7,
            "candidates": [
                {
                    "id": "candidate-1",
                    "revision": 2,
                    "title": "Field Notes",
                    "preview_url": (
                        "/api/previews/fileset-1/index.html?token=preview-token"
                    ),
                    "visual_review": {
                        "verdict": "PASS",
                        "scores": {
                            "hierarchy": 5,
                            "composition": 4,
                            "typography": 4,
                            "color": 5,
                            "goal_fit": 5,
                            "originality": 4,
                        },
                    },
                }
            ],
            "focus": {
                "kind": "candidate",
                "id": "candidate-1",
                "revision": 2,
                "title": "Field Notes",
                "preview_url": (
                    "/api/previews/fileset-1/index.html?token=preview-token"
                ),
            },
            "quality": None,
            "approvals": [],
            "messages": [],
            "runs": [],
            "sources": [],
            "deliveries": [],
            "revisions": [{"revision": 7, "state": "VALIDATING"}],
            "actions": [{"id": "validate_artifact"}],
            "settings": {
                "product_readiness": {"blockers": []},
            },
        }
    )
    assert project.candidates[0].revision == 2
    assert project.candidates[0].preview_url.startswith(
        "http://127.0.0.1:8765/api/previews/"
    )
    assert project.candidates[0].visual_review["verdict"] == "PASS"
    assert project.actions == ["validate_artifact"]
    assert project.history[0].current is True
