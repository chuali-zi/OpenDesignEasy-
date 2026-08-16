"""Backend abstraction layer for the OEYdesign desktop GUI client.

This module deliberately does NOT import anything from ``src/oeydesign``.
It defines the data model and the ``Backend`` protocol the GUI talks to,
plus two implementations:

- ``MockBackend``: in-memory fake data so the shell can run standalone.
- ``HttpBackend``: the real loopback product-shell HTTP adapter.

Real service notes:
  The real service is provided by ``src/oeydesign/product_shell.py``'s
  ``main()`` and listens on loopback ``http://127.0.0.1:8765``.
  Non-GET requests require an ``X-OEY-CSRF`` header (obtain a token via
  ``GET /api/session``), and write operations must carry ``command_id``
  plus ``expected_revision`` for optimistic concurrency.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import mimetypes
import os
import secrets
import tempfile
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlsplit
from urllib.request import Request, urlopen

# ---------------------------------------------------------------------------
# Data model (covers what the web workbench uses)
# ---------------------------------------------------------------------------


@dataclass
class ProjectSummary:
    id: str
    name: str
    revision: int


@dataclass
class Message:
    id: str
    role: str  # "user" | "assistant" | "system"
    text: str
    timestamp: str


@dataclass
class Candidate:
    id: str
    title: str
    status: str  # e.g. "proposed" | "approved" | "rejected"
    preview_html: str = ""
    revision: int = 1
    preview_url: str = ""
    visual_review: dict[str, Any] = field(default_factory=dict)


@dataclass
class ActivityEvent:
    """A safe, user-facing progress entry for an agent run.

    ``summary`` is deliberately a concise operational update (for example,
    "Rendered desktop preview"), not private model reasoning.  ``sequence``
    is monotonic within a run so clients can merge events delivered by an
    eventual incremental endpoint without re-rendering the whole activity
    stream.
    """

    sequence: int
    phase: str
    summary: str
    kind: str = "status"  # status | tool | build | render | quality | error
    timestamp: str = ""
    detail: str = ""
    job_id: str = ""


@dataclass
class RunInfo:
    id: str
    status: str  # "running" | "paused" | "done" | "cancelled" | "failed"
    elapsed: str
    stage: str = ""
    can_pause: bool | None = None
    can_resume: bool | None = None
    can_cancel: bool | None = None
    error_category: str = ""
    error_message: str = ""
    activity: list[ActivityEvent] = field(default_factory=list)
    activity_cursor: int = 0


@dataclass
class SourceInfo:
    id: str
    kind: str  # "repository" | "image" | "note" | ...
    label: str


@dataclass
class QualityInfo:
    verdict: str  # e.g. "pass" | "fail" | "pending"
    visual_score: int
    hard_errors: list[str] = field(default_factory=list)
    visual_verdict: str = "pending"


@dataclass
class RevisionInfo:
    revision: int
    label: str
    current: bool


@dataclass
class DeliveryInfo:
    id: str
    label: str


@dataclass
class PreviewTarget:
    kind: str
    id: str
    revision: int
    title: str
    preview_url: str = ""
    visual_review: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProjectState:
    id: str
    name: str
    revision: int
    messages: list[Message] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)
    runs: list[RunInfo] = field(default_factory=list)
    sources: list[SourceInfo] = field(default_factory=list)
    quality: QualityInfo | None = None
    history: list[RevisionInfo] = field(default_factory=list)
    deliveries: list[DeliveryInfo] = field(default_factory=list)
    readiness: str = "draft"  # e.g. "draft" | "ready" | "blocked"
    blockers: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    focus: PreviewTarget | None = None


# ---------------------------------------------------------------------------
# Backend protocol
# ---------------------------------------------------------------------------


class Backend(Protocol):
    """Interface the GUI panels talk to. Implementations: Mock/Http."""

    def health(self) -> tuple[str, list[str]]:
        """GET /api/health -> (status, blockers)."""
        ...

    def list_projects(self) -> list[ProjectSummary]:
        """GET /api/projects."""
        ...

    def create_project(self, name: str) -> ProjectSummary:
        """POST /api/projects."""
        ...

    def get_project(self, project_id: str) -> ProjectState:
        """GET /api/projects/{id}."""
        ...

    def get_project_activity(
        self, project_id: str, *, after_sequence: int = 0
    ) -> list[ActivityEvent]:
        """GET /api/projects/{id}/activity?after=<cursor>."""
        ...

    def send_message(
        self,
        project_id: str,
        text: str,
        object_ref: str | None = None,
        target_id: str | None = None,
        target_revision: int | None = None,
    ) -> None:
        """POST /api/projects/{id}/messages."""
        ...

    def attach_repository(self, project_id: str, path: str) -> None:
        """POST /api/projects/{id}/repository."""
        ...

    def upload_images(self, project_id: str, paths: list[str]) -> None:
        """POST /api/projects/{id}/sources/images."""
        ...

    def run_command(
        self,
        project_id: str,
        command: str,
        *,
        candidate_id: str | None = None,
        source_revision: int | None = None,
    ) -> None:
        """POST /api/projects/{id}/commands.

        Commands: approve_direction / produce_artifact / validate_artifact /
        approve_export / deliver / restore_revision.
        """
        ...

    def pause_run(self, run_id: str) -> None: ...

    def resume_run(self, run_id: str) -> None: ...

    def cancel_run(self, run_id: str) -> None: ...

    def get_provider(self) -> dict:
        """GET /api/settings/provider."""
        ...

    def save_provider(self, base_url: str, model: str, api_key: str) -> dict:
        """PUT /api/settings/provider."""
        ...

    def delete_provider(self) -> None:
        """DELETE /api/settings/provider."""
        ...

    def download_delivery(self, delivery_id: str, destination: str) -> str:
        """GET /api/deliveries/{id}/download into a chosen local file."""
        ...


# ---------------------------------------------------------------------------
# Mock implementation
# ---------------------------------------------------------------------------

# DEMO ONLY - 替换为 HttpBackend 接入真实服务
_ALL_ACTIONS = [
    "approve_direction",
    "produce_artifact",
    "validate_artifact",
    "approve_export",
    "deliver",
]

_MOCK_REPLIES = [
    "好呀！我画了两个新方向，去右边的候选里看看吧～",
    "收到！我把这个想法记到小纸条上啦 ✏️",
    "嗯嗯，让我想想…… 先画个草图给你看看！",
    "这个主意真棒，我给它涂上了彩虹色！",
]


class MockBackend:
    """In-memory fake backend with demo data.

    DEMO ONLY - 替换为 HttpBackend 接入真实服务.
    """

    def __init__(self) -> None:
        self._counter = itertools.count(1)
        self._provider: dict | None = None
        self._projects: dict[str, ProjectState] = {}
        self._seed_demo_projects()

    # -- demo data ---------------------------------------------------------

    def _next_id(self, prefix: str) -> str:
        return f"{prefix}-{next(self._counter):04d}"

    @staticmethod
    def _now() -> str:
        return time.strftime("%H:%M:%S")

    def _seed_demo_projects(self) -> None:
        p1 = ProjectState(
            id="proj-demo-0001",
            name="小恐龙的生日海报",
            revision=3,
            messages=[
                Message(
                    "msg-0001",
                    "user",
                    "我想要一张恐龙生日派对的海报！",
                    "09:30:12",
                ),
                Message(
                    "msg-0002",
                    "assistant",
                    "太棒了！我画了两个方向：蜡笔恐龙 和 剪纸气球，你看看～",
                    "09:30:48",
                ),
                Message("msg-0003", "user", "我喜欢蜡笔恐龙！", "09:31:20"),
            ],
            candidates=[
                Candidate(
                    "cand-0001",
                    "蜡笔小恐龙",
                    "approved",
                    "<p>蜡笔涂鸦风，绿色小恐龙戴派对帽</p>",
                ),
                Candidate(
                    "cand-0002",
                    "剪纸气球",
                    "proposed",
                    "<p>彩色剪纸拼贴，气球和彩带</p>",
                ),
            ],
            runs=[
                RunInfo("run-0001", "done", "12s"),
                RunInfo(
                    "run-0002",
                    "running",
                    "3s",
                    stage="quality review",
                    activity=[
                        ActivityEvent(1, "Plan", "Mapped the birthday-poster brief."),
                        ActivityEvent(
                            2, "Tools", "Checked the dinosaur reference image.", "tool"
                        ),
                        ActivityEvent(
                            3, "Build", "Built two visual directions.", "build"
                        ),
                        ActivityEvent(
                            4,
                            "Render",
                            "Rendered the approved crayon direction.",
                            "render",
                        ),
                        ActivityEvent(
                            5,
                            "Quality",
                            "Checking contrast and print-safe spacing…",
                            "quality",
                        ),
                    ],
                    activity_cursor=5,
                ),
            ],
            sources=[
                SourceInfo("src-0001", "note", "孩子口述：要绿色恐龙"),
                SourceInfo("src-0002", "image", "参考图：恐龙贴纸.png"),
            ],
            quality=QualityInfo(verdict="pass", visual_score=86, hard_errors=[]),
            history=[
                RevisionInfo(1, "初稿：两个方向", False),
                RevisionInfo(2, "选定蜡笔恐龙", False),
                RevisionInfo(3, "上色完成", True),
            ],
            deliveries=[DeliveryInfo("dlv-0001", "海报 v1 (PNG)")],
            readiness="ready",
            blockers=[],
            actions=["produce_artifact", "validate_artifact", "approve_export"],
        )
        p2 = ProjectState(
            id="proj-demo-0002",
            name="太空猫网站",
            revision=1,
            messages=[
                Message("msg-0101", "user", "做一个太空猫的网站！", "10:02:41"),
                Message(
                    "msg-0102",
                    "assistant",
                    "喵～我准备了「星空涂鸦」和「像素火箭」两个方向！",
                    "10:03:05",
                ),
            ],
            candidates=[
                Candidate(
                    "cand-0101", "星空涂鸦", "proposed", "<p>深蓝星空+手绘星球</p>"
                ),
                Candidate(
                    "cand-0102", "像素火箭", "proposed", "<p>复古像素风火箭起飞</p>"
                ),
            ],
            runs=[RunInfo("run-0101", "paused", "45s")],
            sources=[SourceInfo("src-0101", "repository", "D:/projects2/space-cat")],
            quality=QualityInfo(
                verdict="pending", visual_score=0, hard_errors=["尚未生成作品"]
            ),
            history=[RevisionInfo(1, "头脑风暴中", True)],
            deliveries=[],
            readiness="blocked",
            blockers=["还没有选定方向", "缺少配色参考图"],
            actions=["approve_direction"],
        )
        self._projects[p1.id] = p1
        self._projects[p2.id] = p2

    # -- protocol implementation --------------------------------------------

    def health(self) -> tuple[str, list[str]]:
        return "ok", []

    def list_projects(self) -> list[ProjectSummary]:
        return [
            ProjectSummary(id=p.id, name=p.name, revision=p.revision)
            for p in self._projects.values()
        ]

    def create_project(self, name: str) -> ProjectSummary:
        pid = self._next_id("proj")
        state = ProjectState(
            id=pid,
            name=name,
            revision=0,
            messages=[
                Message(
                    self._next_id("msg"),
                    "assistant",
                    f"新项目「{name}」建好啦！告诉我你想画什么吧～",
                    self._now(),
                )
            ],
            history=[RevisionInfo(0, "空白画布", True)],
            readiness="draft",
            actions=["approve_direction"],
        )
        self._projects[pid] = state
        return ProjectSummary(id=pid, name=name, revision=0)

    def get_project(self, project_id: str) -> ProjectState:
        return self._projects[project_id]

    def get_project_activity(
        self, project_id: str, *, after_sequence: int = 0
    ) -> list[ActivityEvent]:
        return [
            event
            for run in self._projects[project_id].runs
            for event in run.activity
            if event.sequence > after_sequence
        ]

    def send_message(
        self,
        project_id: str,
        text: str,
        object_ref: str | None = None,
        target_id: str | None = None,
        target_revision: int | None = None,
    ) -> None:
        del target_id, target_revision
        state = self._projects[project_id]
        suffix = f"（关于 {object_ref}）" if object_ref else ""
        state.messages.append(
            Message(self._next_id("msg"), "user", text + suffix, self._now())
        )
        reply_idx = len(state.messages) % len(_MOCK_REPLIES)
        state.messages.append(
            Message(
                self._next_id("msg"),
                "assistant",
                _MOCK_REPLIES[reply_idx],
                self._now(),
            )
        )
        state.revision += 1

    def attach_repository(self, project_id: str, path: str) -> None:
        state = self._projects[project_id]
        state.sources.append(SourceInfo(self._next_id("src"), "repository", path))
        state.revision += 1

    def upload_images(self, project_id: str, paths: list[str]) -> None:
        state = self._projects[project_id]
        for path in paths:
            label = path.replace("\\", "/").rsplit("/", 1)[-1]
            state.sources.append(SourceInfo(self._next_id("src"), "image", label))
        state.revision += 1

    def run_command(
        self,
        project_id: str,
        command: str,
        *,
        candidate_id: str | None = None,
        source_revision: int | None = None,
    ) -> None:
        """Advance the demo actions state machine (simple in-memory sim)."""
        del candidate_id, source_revision
        state = self._projects[project_id]
        if command == "restore_revision":
            state.history.append(
                RevisionInfo(state.revision + 1, "回到了之前的画", True)
            )
            for rev in state.history[:-1]:
                rev.current = False
        elif command in _ALL_ACTIONS:
            if command in state.actions:
                state.actions.remove(command)
            idx = _ALL_ACTIONS.index(command)
            if idx + 1 < len(_ALL_ACTIONS):
                nxt = _ALL_ACTIONS[idx + 1]
                if nxt not in state.actions:
                    state.actions.append(nxt)
            if command == "deliver":
                state.deliveries.append(
                    DeliveryInfo(
                        self._next_id("dlv"),
                        f"交付物 rev{state.revision + 1}",
                    )
                )
            if command == "validate_artifact":
                state.quality = QualityInfo(
                    verdict="pass", visual_score=92, hard_errors=[]
                )
        state.runs.append(
            RunInfo(
                self._next_id("run"),
                "done",
                "1s",
                stage="complete",
                activity=[
                    ActivityEvent(1, "Plan", f"Queued {command.replace('_', ' ')}."),
                    ActivityEvent(
                        2, "Build", "Completed the requested production step.", "build"
                    ),
                    ActivityEvent(
                        3, "Quality", "Recorded the resulting project state.", "quality"
                    ),
                ],
                activity_cursor=3,
            )
        )
        state.revision += 1
        if not state.actions:
            state.readiness = "ready"
            state.blockers = []

    def pause_run(self, run_id: str) -> None:
        self._set_run_status(run_id, {"running"}, "paused")

    def resume_run(self, run_id: str) -> None:
        self._set_run_status(run_id, {"paused"}, "running")

    def cancel_run(self, run_id: str) -> None:
        self._set_run_status(run_id, {"running", "paused"}, "cancelled")

    def _set_run_status(self, run_id: str, allowed: set[str], new_status: str) -> None:
        for state in self._projects.values():
            for run in state.runs:
                if run.id == run_id and run.status in allowed:
                    run.status = new_status
                    return

    def get_provider(self) -> dict:
        if self._provider is None:
            return {}
        return dict(self._provider)

    def save_provider(self, base_url: str, model: str, api_key: str) -> dict:
        self._provider = {
            "base_url": base_url,
            "model": model,
            "api_key": api_key,
        }
        return dict(self._provider)

    def delete_provider(self) -> None:
        self._provider = None

    def download_delivery(self, delivery_id: str, destination: str) -> str:
        Path(destination).write_bytes(f"mock delivery {delivery_id}\n".encode())
        return destination


# ---------------------------------------------------------------------------
# HTTP implementation
# ---------------------------------------------------------------------------


class BackendError(RuntimeError):
    """A sanitized product-shell error suitable for direct GUI display."""

    def __init__(
        self,
        category: str,
        message: str,
        *,
        status: int = 0,
        current_revision: int | None = None,
    ) -> None:
        super().__init__(message)
        self.category = category
        self.status = status
        self.current_revision = current_revision


class HttpBackend:
    """Typed, loopback-only client for the real product-shell API."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8765",
        *,
        preview_base_url: str | None = None,
        capability_token: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self._validate_loopback_origin(base_url, "desktop backend")
        if preview_base_url is not None:
            self._validate_loopback_origin(preview_base_url, "preview server")
        self.base_url = base_url.rstrip("/")
        self.preview_base_url = (
            preview_base_url.rstrip("/") if preview_base_url is not None else None
        )
        self._capability_token = capability_token or ""
        self.timeout = timeout
        self._csrf_token = ""
        self._states: dict[str, ProjectState] = {}

    # -- public API -------------------------------------------------------

    def health(self) -> tuple[str, list[str]]:
        """GET /api/health."""
        data = self._json("GET", "/api/health")
        return str(data.get("status", "unavailable")), [
            str(item) for item in data.get("blockers", [])
        ]

    def list_projects(self) -> list[ProjectSummary]:
        """GET /api/projects."""
        data = self._json("GET", "/api/projects")
        return [
            ProjectSummary(
                id=str(item["id"]),
                name=str(item.get("name", "Untitled Web project")),
                revision=int(item.get("revision", 1)),
            )
            for item in data
        ]

    def create_project(self, name: str) -> ProjectSummary:
        """POST /api/projects."""
        data = self._json(
            "POST",
            "/api/projects",
            {
                "command_id": self._command_id("create"),
                "name": name,
            },
        )
        state = self._project(data)
        self._states[state.id] = state
        return ProjectSummary(state.id, state.name, state.revision)

    def get_project(self, project_id: str) -> ProjectState:
        """GET /api/projects/{id}."""
        data = self._json("GET", f"/api/projects/{quote(project_id, safe='')}")
        state = self._project(data)
        self._states[state.id] = state
        return state

    def get_project_activity(
        self, project_id: str, *, after_sequence: int = 0
    ) -> list[ActivityEvent]:
        """Fetch worker-supplied safe activity without blocking the Qt thread."""
        try:
            path = (
                f"/api/projects/{quote(project_id, safe='')}/activity"
                f"?after={after_sequence}"
            )
            data = self._json(
                "GET",
                path,
            )
        except BackendError as exc:
            if exc.status in {404, 405}:
                return []
            raise
        items = data.get("activity", data) if isinstance(data, dict) else data
        return self._activity(items)

    def send_message(
        self,
        project_id: str,
        text: str,
        object_ref: str | None = None,
        target_id: str | None = None,
        target_revision: int | None = None,
    ) -> None:
        """POST /api/projects/{id}/messages."""
        state = self._state(project_id)
        client_id = self._command_id("message")
        body: dict[str, Any] = {
            "client_message_id": client_id,
            "command_id": client_id,
            "expected_revision": state.revision,
            "text": text,
        }
        if target_id is not None or target_revision is not None:
            if not target_id or target_revision is None:
                raise ValueError("A feedback target needs both ID and revision")
            body["target_id"] = target_id
            body["target_revision"] = target_revision
        if object_ref:
            body["object_ref"] = object_ref
        self._json(
            "POST",
            f"/api/projects/{quote(project_id, safe='')}/messages",
            body,
        )

    def attach_repository(self, project_id: str, path: str) -> None:
        """POST /api/projects/{id}/repository."""
        state = self._state(project_id)
        self._json(
            "POST",
            f"/api/projects/{quote(project_id, safe='')}/repository",
            {
                "command_id": self._command_id("repository"),
                "expected_revision": state.revision,
                "path": path,
            },
        )

    def upload_images(self, project_id: str, paths: list[str]) -> None:
        """POST /api/projects/{id}/sources/images."""
        state = self._state(project_id)
        for value in paths:
            path = Path(value)
            payload = path.read_bytes()
            media_type = mimetypes.guess_type(path.name)[0] or ""
            if media_type not in {"image/png", "image/jpeg"}:
                raise ValueError(f"Unsupported reference image: {path.name}")
            command_id = self._command_id("image")
            boundary = f"oey-{secrets.token_hex(16)}"
            body = self._multipart(
                boundary,
                {
                    "command_id": command_id,
                    "expected_revision": str(state.revision),
                },
                path.name,
                media_type,
                payload,
            )
            self._request(
                "POST",
                f"/api/projects/{quote(project_id, safe='')}/sources/images",
                body,
                content_type=f"multipart/form-data; boundary={boundary}",
            )
            # Each successful image ingestion advances the durable project
            # revision.  The next member must use that revision, not the stale
            # value captured before the batch began.
            state = self.get_project(project_id)

    def run_command(
        self,
        project_id: str,
        command: str,
        *,
        candidate_id: str | None = None,
        source_revision: int | None = None,
    ) -> None:
        """POST /api/projects/{id}/commands."""
        state = self._state(project_id)
        body: dict[str, Any] = {
            "action": command,
            "command_id": self._command_id(command),
            "expected_revision": state.revision,
        }
        if command == "generate_candidates":
            body["candidate_count"] = 2
        elif command == "approve_direction":
            candidate = self._candidate(state, candidate_id)
            body["candidate_id"] = candidate.id
            body["candidate_revision"] = candidate.revision
        elif command == "produce_artifact":
            body.update({"medium": "web", "fidelity_mode": "production"})
        elif command == "validate_artifact":
            body["render_profile"] = {"width": 1440, "height": 1000}
        elif command == "deliver":
            body["delivery_profile"] = {
                "format": "zip",
                "profile": "editable-source-and-dist",
            }
        elif command == "restore_revision":
            if source_revision is None:
                raise ValueError("A source revision is required for restore")
            body["source_revision"] = source_revision
        data = self._json(
            "POST",
            f"/api/projects/{quote(project_id, safe='')}/commands",
            body,
        )
        self._states[project_id] = self._project(data)

    def pause_run(self, run_id: str) -> None:
        self._run_action(run_id, "pause")

    def resume_run(self, run_id: str) -> None:
        self._run_action(run_id, "resume")

    def cancel_run(self, run_id: str) -> None:
        self._run_action(run_id, "cancel")

    def get_provider(self) -> dict:
        """GET /api/settings/provider."""
        return dict(self._json("GET", "/api/settings/provider"))

    def save_provider(self, base_url: str, model: str, api_key: str) -> dict:
        """PUT /api/settings/provider."""
        return dict(
            self._json(
                "PUT",
                "/api/settings/provider",
                {"base_url": base_url, "model": model, "api_key": api_key},
            )
        )

    def delete_provider(self) -> None:
        """DELETE /api/settings/provider."""
        self._json("DELETE", "/api/settings/provider", {})

    def download_delivery(self, delivery_id: str, destination: str) -> str:
        raw = self._request(
            "GET", f"/api/deliveries/{quote(delivery_id, safe='')}/download"
        )
        target = Path(destination).resolve()
        if not target.parent.is_dir():
            raise ValueError("The selected download folder is unavailable")
        handle, temporary = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".part", dir=target.parent
        )
        os.close(handle)
        temporary_path = Path(temporary)
        try:
            temporary_path.write_bytes(raw)
            self._validate_delivery_zip(temporary_path)
            os.replace(temporary_path, target)
        finally:
            temporary_path.unlink(missing_ok=True)
        return str(target)

    def absolute_preview_url(self, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or parsed.fragment:
            raise ValueError("Preview URL is outside the trusted route")
        parts = parsed.path.split("/", 4)
        if (
            len(parts) != 5
            or parts[:3] != ["", "api", "previews"]
            or not parts[3]
            or not parts[4]
        ):
            raise ValueError("Preview URL is outside the trusted route")
        if self.preview_base_url is not None:
            token = parse_qs(parsed.query).get("token", [""])[0]
            if not token:
                raise ValueError("Preview URL has no capability token")
            file_set_id = unquote(parts[3])
            relative = unquote(parts[4])
            relative_path = PurePosixPath(relative)
            if (
                relative_path.is_absolute()
                or ".." in relative_path.parts
                or "\\" in relative
            ):
                raise ValueError("Preview URL contains an unsafe path")
            return (
                f"{self.preview_base_url}/preview/"
                f"{quote(token, safe='')}/{quote(file_set_id, safe='')}/"
                f"{quote(relative, safe='/')}"
            )
        return self.base_url + value

    @staticmethod
    def _validate_loopback_origin(value: str, label: str) -> None:
        parsed = urlsplit(value.rstrip("/"))
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
        ):
            raise ValueError(f"The {label} must be a plain loopback HTTP URL")

    @staticmethod
    def _validate_delivery_zip(path: Path) -> None:
        """Verify the downloaded archive before it replaces a user-visible file."""

        try:
            with zipfile.ZipFile(path) as archive:
                if archive.testzip() is not None:
                    raise ValueError("Downloaded delivery failed its CRC check")
                infos = archive.infolist()
                if not infos or len(infos) > 5_000:
                    raise ValueError("Downloaded delivery has an invalid member count")
                names: set[str] = set()
                hashes: dict[str, str] = {}
                total = 0
                for member in infos:
                    name = member.filename
                    relative = PurePosixPath(name)
                    mode = (member.external_attr >> 16) & 0o170000
                    if (
                        member.is_dir()
                        or not name
                        or "\\" in name
                        or relative.is_absolute()
                        or ".." in relative.parts
                        or mode == 0o120000
                        or name.casefold() in names
                    ):
                        raise ValueError(
                            "Downloaded delivery contains an unsafe ZIP member"
                        )
                    names.add(name.casefold())
                    total += member.file_size
                    if total > 50_000_000:
                        raise ValueError("Downloaded delivery exceeds the size limit")
                    payload = archive.read(member)
                    hashes[name] = hashlib.sha256(payload).hexdigest()
                try:
                    manifest = json.loads(archive.read("oeydesign-manifest.json"))
                except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ValueError(
                        "Downloaded delivery has no valid OEYdesign manifest"
                    ) from exc
        except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
            raise ValueError("Downloaded delivery is not a valid ZIP archive") from exc
        if not isinstance(manifest, dict) or manifest.get("version") != 1:
            raise ValueError("Downloaded delivery manifest version is invalid")
        expected = manifest.get("files")
        if not isinstance(expected, dict) or not expected:
            raise ValueError("Downloaded delivery manifest has no file hashes")
        actual_members = {name for name in hashes if name != "oeydesign-manifest.json"}
        if set(expected) != actual_members:
            raise ValueError("Downloaded delivery members do not match its manifest")
        if any(
            not isinstance(digest, str) or hashes.get(name) != digest
            for name, digest in expected.items()
        ):
            raise ValueError("Downloaded delivery file hash verification failed")
        if "dist/index.html" not in actual_members or not any(
            name.startswith("source/") for name in actual_members
        ):
            raise ValueError("Downloaded delivery is missing source or dist content")
        for prefix, tree_field in (
            ("source/", "source_tree_sha256"),
            ("dist/", "dist_tree_sha256"),
        ):
            tree = {
                name[len(prefix) :]: digest
                for name, digest in expected.items()
                if name.startswith(prefix)
            }
            encoded = json.dumps(
                dict(sorted(tree.items())),
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode()
            if hashlib.sha256(encoded).hexdigest() != manifest.get(tree_field):
                raise ValueError(f"Downloaded delivery {prefix[:-1]} tree hash failed")

    # -- transport --------------------------------------------------------

    def _run_action(self, run_id: str, action: str) -> None:
        self._json(
            "POST",
            f"/api/runs/{quote(run_id, safe='')}/{action}",
            {"command_id": self._command_id(f"run-{action}")},
        )

    def _state(self, project_id: str) -> ProjectState:
        return self._states.get(project_id) or self.get_project(project_id)

    @staticmethod
    def _candidate(state: ProjectState, candidate_id: str | None) -> Candidate:
        if candidate_id:
            candidate = next(
                (item for item in state.candidates if item.id == candidate_id), None
            )
            if candidate is not None:
                return candidate
        if not state.candidates:
            raise ValueError("No candidate is available for approval")
        return state.candidates[0]

    @staticmethod
    def _command_id(prefix: str) -> str:
        return f"gui:{prefix}:{secrets.token_urlsafe(18)}"

    def _session(self, *, refresh: bool = False) -> None:
        if self._csrf_token and not refresh:
            return
        data = self._json("GET", "/api/session", _session_call=True)
        token = data.get("csrf_token")
        if not isinstance(token, str) or not token:
            raise BackendError("INVALID_RESPONSE", "Local session is unavailable")
        self._csrf_token = token

    def _json(
        self,
        method: str,
        path: str,
        payload: Any = None,
        *,
        _session_call: bool = False,
    ) -> Any:
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        raw = self._request(
            method,
            path,
            body,
            content_type="application/json",
            _session_call=_session_call,
        )
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BackendError(
                "INVALID_RESPONSE", "The local service returned invalid data"
            ) from exc

    def _request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        *,
        content_type: str = "application/octet-stream",
        _session_call: bool = False,
        _retry_csrf: bool = True,
    ) -> bytes:
        is_write = method != "GET"
        if is_write and not _session_call:
            self._session()
        headers = {"Accept": "application/json", "User-Agent": "OEYdesign-GUI/1"}
        if self._capability_token:
            headers["X-OEY-Desktop-Capability"] = self._capability_token
        if body is not None:
            headers["Content-Type"] = content_type
        if is_write:
            headers["Origin"] = self.base_url
            headers["X-OEY-CSRF"] = self._csrf_token
        request = Request(
            self.base_url + path,
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return response.read()
        except HTTPError as exc:
            error = self._http_error(exc)
            if (
                is_write
                and _retry_csrf
                and error.status == 403
                and "csrf" in str(error).casefold()
            ):
                self._session(refresh=True)
                return self._request(
                    method,
                    path,
                    body,
                    content_type=content_type,
                    _session_call=_session_call,
                    _retry_csrf=False,
                )
            raise error from None
        except (URLError, TimeoutError, OSError) as exc:
            raise BackendError(
                "SERVICE_UNAVAILABLE",
                "The local OEYdesign service is not reachable",
            ) from exc

    @staticmethod
    def _http_error(error: HTTPError) -> BackendError:
        try:
            payload = json.loads(error.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = {}
        category = str(payload.get("category", "HTTP_ERROR"))
        message = str(payload.get("message", "The local request failed"))
        revision = payload.get("current_revision")
        return BackendError(
            category,
            message,
            status=error.code,
            current_revision=revision if isinstance(revision, int) else None,
        )

    @staticmethod
    def _multipart(
        boundary: str,
        fields: dict[str, str],
        filename: str,
        media_type: str,
        payload: bytes,
    ) -> bytes:
        chunks: list[bytes] = []
        marker = f"--{boundary}\r\n".encode()
        for name, value in fields.items():
            chunks.extend(
                (
                    marker,
                    (f'Content-Disposition: form-data; name="{name}"\r\n\r\n').encode(),
                    value.encode("utf-8"),
                    b"\r\n",
                )
            )
        safe_name = Path(filename).name.replace('"', "_")
        chunks.extend(
            (
                marker,
                (
                    'Content-Disposition: form-data; name="image"; '
                    f'filename="{safe_name}"\r\n'
                ).encode(),
                f"Content-Type: {media_type}\r\n\r\n".encode(),
                payload,
                b"\r\n",
                f"--{boundary}--\r\n".encode(),
            )
        )
        return b"".join(chunks)

    # -- projection -------------------------------------------------------

    def _project(self, data: dict[str, Any]) -> ProjectState:
        approved = {
            str(item.get("target_id"))
            for item in data.get("approvals", [])
            if item.get("active") and item.get("action") == "COMMIT_DIRECTION"
        }
        candidates = [
            Candidate(
                id=str(item["id"]),
                title=str(item.get("title", "Untitled direction")),
                status="approved" if str(item["id"]) in approved else "proposed",
                preview_html=str(item.get("preview_html", "")),
                revision=int(item.get("revision", 1)),
                preview_url=self._preview(item.get("preview_url", "")),
                visual_review=dict(item.get("visual_review") or {}),
            )
            for item in data.get("candidates", [])
        ]
        focus_data = data.get("focus")
        focus = None
        if isinstance(focus_data, dict):
            focus = PreviewTarget(
                kind=str(focus_data.get("kind", "candidate")),
                id=str(focus_data.get("id", "")),
                revision=int(focus_data.get("revision", 1)),
                title=str(focus_data.get("title", "Rendered artifact")),
                preview_url=self._preview(focus_data.get("preview_url", "")),
                visual_review=dict(focus_data.get("visual_review") or {}),
            )
        messages = [
            Message(
                id=str(item["id"]),
                role=str(item.get("role", "USER")).lower(),
                text=str(item.get("text", "")),
                timestamp=str(item.get("created_at", "")),
            )
            for item in data.get("messages", [])
        ]
        runs = [self._run(item) for item in data.get("runs", [])]
        sources = [
            SourceInfo(
                id=str(item["id"]),
                kind=self._source_kind(str(item.get("kind", "note"))),
                label=str(item.get("name", "source")),
            )
            for item in data.get("sources", [])
        ]
        quality_data = data.get("quality")
        review = (focus.visual_review if focus else {}) or {}
        quality = None
        if isinstance(quality_data, dict) or review:
            hard_errors = [
                self._finding_text(item)
                for item in (quality_data or {}).get("hard_errors", [])
            ]
            scores = review.get("scores", review)
            numeric = [
                float(scores.get(name, 0))
                for name in (
                    "hierarchy",
                    "composition",
                    "typography",
                    "color",
                    "goal_fit",
                    "originality",
                )
                if isinstance(scores, dict)
                and isinstance(scores.get(name), int | float)
            ]
            visual_score = round(sum(numeric) / len(numeric) * 20) if numeric else 0
            quality = QualityInfo(
                verdict=str((quality_data or {}).get("verdict", "pending")).lower(),
                visual_score=visual_score,
                hard_errors=hard_errors,
                visual_verdict=str(review.get("verdict", "pending")).lower(),
            )
        deliveries = [
            DeliveryInfo(
                id=str(item["id"]),
                label=(
                    f"Immutable Web ZIP · artifact r"
                    f"{item.get('artifact_revision', item.get('revision', '?'))}"
                ),
            )
            for item in data.get("deliveries", [])
        ]
        revision = int(data.get("revision", 1))
        history = [
            RevisionInfo(
                revision=int(item["revision"]),
                label=self._history_label(item),
                current=int(item["revision"]) == revision,
            )
            for item in data.get("revisions", [])
        ]
        product_health = (
            data.get("settings", {}).get("product_readiness", {})
            if isinstance(data.get("settings"), dict)
            else {}
        )
        blockers = [str(item) for item in product_health.get("blockers", [])]
        project_state = str(data.get("state", "NEW"))
        if project_state == "NEEDS_INPUT":
            blockers = ["The Agent needs one more answer.", *blockers]
        if blockers or project_state in {"NEEDS_INPUT", "FAILED"}:
            readiness = "blocked"
        elif project_state == "NEW":
            readiness = "draft"
        else:
            readiness = "ready"
        actions = [str(item.get("id", "")) for item in data.get("actions", [])]
        return ProjectState(
            id=str(data["id"]),
            name=str(data.get("name", "Untitled Web project")),
            revision=revision,
            messages=messages,
            candidates=candidates,
            runs=runs,
            sources=sources,
            quality=quality,
            history=history,
            deliveries=deliveries,
            readiness=readiness,
            blockers=blockers,
            actions=actions,
            focus=focus,
        )

    def _preview(self, value: Any) -> str:
        if isinstance(value, str) and value:
            return self.absolute_preview_url(value)
        return ""

    @staticmethod
    def _activity(items: Any) -> list[ActivityEvent]:
        if not isinstance(items, list):
            return []
        events: list[ActivityEvent] = []
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            raw_detail = item.get("detail", item.get("details", ""))
            if isinstance(raw_detail, dict):
                detail = " · ".join(
                    f"{str(key).replace('_', ' ')}: {value}"
                    for key, value in raw_detail.items()
                )
            else:
                detail = str(raw_detail or "")
            events.append(
                ActivityEvent(
                    sequence=int(item.get("sequence", index) or index),
                    phase=str(item.get("phase", item.get("stage", "Working"))),
                    summary=str(item.get("summary", item.get("message", "Working…"))),
                    kind=str(item.get("kind", item.get("type", "status"))).lower(),
                    timestamp=str(item.get("timestamp", item.get("created_at", ""))),
                    detail=detail,
                    job_id=str(item.get("job_id", "")),
                )
            )
        return events

    @classmethod
    def _run(cls, item: dict[str, Any]) -> RunInfo:
        seconds = float(item.get("elapsed_seconds", 0) or 0)
        return RunInfo(
            id=str(item["id"]),
            status=str(item.get("status", "QUEUED")).lower(),
            elapsed=f"{seconds:.1f}s",
            stage=str(item.get("stage", "")),
            can_pause=bool(item.get("can_pause")),
            can_resume=bool(item.get("can_resume")),
            can_cancel=bool(item.get("can_cancel")),
            error_category=str(item.get("error_category") or ""),
            error_message=str(item.get("error_message") or ""),
            activity=cls._activity(item.get("activity", [])),
            activity_cursor=int(item.get("activity_cursor", 0) or 0),
        )

    @staticmethod
    def _source_kind(value: str) -> str:
        return {
            "CODE_REPOSITORY": "repository",
            "IMAGE": "image",
        }.get(value.upper(), value.lower())

    @staticmethod
    def _finding_text(value: Any) -> str:
        if isinstance(value, dict):
            return str(value.get("message") or value.get("category") or "hard error")
        return str(value)

    @staticmethod
    def _history_label(item: dict[str, Any]) -> str:
        state = str(item.get("state", "revision")).replace("_", " ").title()
        artifact = item.get("artifact_revision")
        return f"{state}{f' · artifact r{artifact}' if artifact else ''}"
