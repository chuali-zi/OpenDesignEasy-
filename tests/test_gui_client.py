from __future__ import annotations

import hashlib
import io
import json
import threading
import zipfile
from dataclasses import dataclass, field
from http.client import HTTPConnection
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

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


def _delivery_zip() -> bytes:
    files = {
        "source/package.json": b'{"private":true}',
        "dist/index.html": b"<!doctype html><title>Verified</title>",
    }
    hashes = {
        name: hashlib.sha256(payload).hexdigest()
        for name, payload in sorted(files.items())
    }

    def tree(prefix: str) -> str:
        values = {
            name[len(prefix) :]: digest
            for name, digest in hashes.items()
            if name.startswith(prefix)
        }
        encoded = json.dumps(
            dict(sorted(values.items())),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        return hashlib.sha256(encoded).hexdigest()

    manifest = {
        "version": 1,
        "files": hashes,
        "source_tree_sha256": tree("source/"),
        "dist_tree_sha256": tree("dist/"),
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, payload in files.items():
            archive.writestr(name, payload)
        archive.writestr(
            "oeydesign-manifest.json",
            json.dumps(manifest, separators=(",", ":"), sort_keys=True),
        )
    return output.getvalue()


def _custom_delivery_zip(
    members: dict[str, bytes],
    *,
    manifest_files: dict[str, str] | None = None,
    symlink: str | None = None,
) -> bytes:
    """Produce deliberately malformed downloads without touching disk."""

    hashes = {
        name: hashlib.sha256(payload).hexdigest()
        for name, payload in sorted(members.items())
    }
    expected = manifest_files if manifest_files is not None else hashes
    source_tree = {
        name.removeprefix("source/"): digest
        for name, digest in expected.items()
        if name.startswith("source/")
    }
    dist_tree = {
        name.removeprefix("dist/"): digest
        for name, digest in expected.items()
        if name.startswith("dist/")
    }

    def digest(tree: dict[str, str]) -> str:
        encoded = json.dumps(
            dict(sorted(tree.items())),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        return hashlib.sha256(encoded).hexdigest()

    manifest = {
        "version": 1,
        "files": expected,
        "source_tree_sha256": digest(source_tree),
        "dist_tree_sha256": digest(dist_tree),
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
        if symlink is not None:
            entry = zipfile.ZipInfo(symlink)
            entry.external_attr = 0o120777 << 16
            archive.writestr(entry, b"target")
        archive.writestr(
            "oeydesign-manifest.json",
            json.dumps(manifest, separators=(",", ":"), sort_keys=True),
        )
    return output.getvalue()


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
        app.product_store.append_activity(
            project_id=project.id,
            job_id="run-desktop-stream",
            type="stream",
            stage="provider-request",
            summary="Kimi is streaming the next action",
            details={"chunks": 5, "bytes_received": 128},
        )
        activity = backend.get_project_activity(project.id, after_sequence=0)
        assert len(activity) == 1
        assert activity[0].job_id == "run-desktop-stream"
        assert "chunks: 5" in activity[0].detail

        repository = tmp_path / "repository"
        repository.mkdir()
        (repository / "README.md").write_text("# Read-only source", encoding="utf-8")
        backend.attach_repository(project.id, str(repository))

        image_path = tmp_path / "reference.png"
        image_path.write_bytes(_png())
        second_image_path = tmp_path / "reference-2.png"
        second_payload = io.BytesIO()
        Image.new("RGB", (33, 24), "#ef6a50").save(second_payload, "PNG")
        second_image_path.write_bytes(second_payload.getvalue())
        backend.upload_images(
            project.id, [str(image_path), str(second_image_path)]
        )
        recovered = backend.get_project(project.id)
        assert {source.kind for source in recovered.sources} == {
            "repository",
            "image",
        }
        images = [source for source in recovered.sources if source.kind == "image"]
        assert len(images) == 2

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
        with pytest.raises(RuntimeError, match="already open"):
            DesktopRuntime(data_root=tmp_path)
        runtime.backend.pause_run("run-1")
        assert fake.jobs.actions == [("run-1", "pause")]
        assert runtime.backend._json("GET", "/api/runs/run-1")["status"] == "RUNNING"
        api_origin = urlsplit(runtime.backend.base_url)
        connection = HTTPConnection(api_origin.hostname, api_origin.port)
        connection.request("GET", "/api/session")
        response = connection.getresponse()
        response.read()
        assert response.status == 403
        connection.close()
        assert runtime.backend.preview_base_url != runtime.backend.base_url
        preview_origin = urlsplit(runtime.backend.preview_base_url or "")
        connection = HTTPConnection(preview_origin.hostname, preview_origin.port)
        connection.request("GET", "/api/session")
        response = connection.getresponse()
        response.read()
        assert response.status == 404
        connection.close()
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


def test_http_backend_rewrites_preview_to_its_isolated_origin() -> None:
    backend = HttpBackend(
        "http://127.0.0.1:8765",
        preview_base_url="http://127.0.0.1:43210",
    )
    isolated = backend.absolute_preview_url(
        "/api/previews/fileset-1/index.html?token=preview-token"
    )
    assert isolated == (
        "http://127.0.0.1:43210/preview/preview-token/"
        "fileset-1/index.html"
    )
    with pytest.raises(ValueError, match="capability token"):
        backend.absolute_preview_url("/api/previews/fileset-1/index.html")


@pytest.mark.parametrize(
    "preview_url",
    [
        "/api/previews/fileset-1/../index.html?token=preview-token",
        "/api/previews/fileset-1/assets\\bundle.js?token=preview-token",
        "/api/previews//index.html?token=preview-token",
        "/api/previews/fileset-1/index.html?token=preview-token#fragment",
        "https://untrusted.invalid/api/previews/fileset-1/index.html?token=x",
    ],
)
def test_http_backend_rejects_unsafe_preview_rewrite_paths(preview_url: str) -> None:
    backend = HttpBackend(
        "http://127.0.0.1:8765",
        preview_base_url="http://127.0.0.1:43210",
    )
    with pytest.raises(ValueError):
        backend.absolute_preview_url(preview_url)


def test_delivery_download_is_verified_before_replacing_destination(
    tmp_path: Path,
) -> None:
    backend = HttpBackend("http://127.0.0.1:8765")
    backend._request = lambda *args, **kwargs: _delivery_zip()  # type: ignore[method-assign]
    target = tmp_path / "delivery.zip"
    assert backend.download_delivery("delivery-1", str(target)) == str(
        target.resolve()
    )
    assert zipfile.is_zipfile(target)

    original = target.read_bytes()
    backend._request = lambda *args, **kwargs: b"not a zip"  # type: ignore[method-assign]
    with pytest.raises(ValueError, match="valid ZIP"):
        backend.download_delivery("delivery-1", str(target))
    assert target.read_bytes() == original


@pytest.mark.parametrize(
    "payload, expected_error",
    [
        (
            _custom_delivery_zip(
                {
                    "source/package.json": b"{}",
                    "dist/index.html": b"ok",
                    "../outside.txt": b"nope",
                }
            ),
            "unsafe ZIP member",
        ),
        (
            _custom_delivery_zip(
                {"source/package.json": b"{}", "dist/index.html": b"ok"},
                symlink="source/linked-file",
            ),
            "unsafe ZIP member",
        ),
        (
            _custom_delivery_zip(
                {"source/package.json": b"{}", "dist/index.html": b"ok"},
                manifest_files={
                    "source/package.json": "0" * 64,
                    "dist/index.html": "1" * 64,
                },
            ),
            "file hash verification failed",
        ),
    ],
)
def test_delivery_verification_rejects_unsafe_or_tampered_archives_without_overwrite(
    tmp_path: Path, payload: bytes, expected_error: str
) -> None:
    backend = HttpBackend("http://127.0.0.1:8765")
    backend._request = lambda *args, **kwargs: payload  # type: ignore[method-assign]
    target = tmp_path / "delivery.zip"
    target.write_bytes(b"known good existing download")

    with pytest.raises(ValueError, match=expected_error):
        backend.download_delivery("delivery-1", str(target))

    assert target.read_bytes() == b"known good existing download"
