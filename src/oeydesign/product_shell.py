"""Dependency-free HTTP adapter for the recoverable Phase 4 product shell."""

from __future__ import annotations

import json
import mimetypes
from argparse import ArgumentParser
from dataclasses import asdict, is_dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from .domain import (
    ApproveDirection,
    ApproveExport,
    ConstraintPreset,
    ContextPackage,
    ContractError,
    CreateProject,
    DeliverArtifact,
    DesignBrief,
    FeedbackKind,
    GenerateCandidates,
    PrepareProject,
    ProduceArtifact,
    Project,
    ProjectState,
    SubmitFeedback,
    TemplateRole,
    ValidateArtifact,
    stable_id,
)

_MAX_BODY = 64 * 1024
_SENSITIVE = {"content", "prompt", "token", "secret", "database", "stack", "provider"}
_CSP = (
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; "
    "object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'"
)
_ACTION_LABELS = {
    "generate_candidates": ("生成候选", "primary"),
    "approve_direction": ("批准当前方向", "approval"),
    "direction_feedback": ("提交整体反馈", "secondary"),
    "produce_artifact": ("生产 Artifact", "primary"),
    "local_feedback": ("提交局部修改", "secondary"),
    "fact_feedback": ("纠正事实或策略", "warning"),
    "validate_artifact": ("验证 Artifact", "primary"),
    "approve_export": ("批准当前 revision 导出", "approval"),
    "deliver": ("验证实际导出并交付", "approval"),
}


def _safe(value: Any) -> Any:
    if is_dataclass(value):
        value = asdict(value)  # type: ignore[arg-type]
    if isinstance(value, dict):
        return {
            str(k): _safe(v)
            for k, v in value.items()
            if str(k).lower() not in _SENSITIVE
        }
    if isinstance(value, (list, tuple)):
        return [_safe(v) for v in value]
    if hasattr(value, "value"):
        return value.value
    return (
        value
        if isinstance(value, (str, int, float, bool)) or value is None
        else str(value)
    )


def _constraints(p: Project) -> dict[str, Any]:
    names = (
        "facts_evidence",
        "content_narrative",
        "brand_style",
        "composition_template",
        "delivery_properties",
        "runtime_permissions",
    )
    return {
        "preset": p.constraints.preset.value,
        "template_role": p.constraints.template_role.value,
        "settings": {
            n: {
                "level": getattr(p.constraints, n).level,
                "source": getattr(p.constraints, n).source,
                "value": getattr(p.constraints, n).value,
            }
            for n in names
        },
    }


class ProductShellService:
    def __init__(self, app: Any) -> None:
        self.app = app

    @staticmethod
    def _cid(body: dict[str, Any]) -> str:
        value = body.get("command_id")
        if not isinstance(value, str) or not value.strip() or len(value) > 160:
            raise ValueError("command_id must be a non-empty string")
        return value.strip()

    @staticmethod
    def _revision(body: dict[str, Any]) -> int:
        value = body.get("expected_revision")
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError("expected_revision must be a positive integer")
        return value

    @staticmethod
    def _positive(body: dict[str, Any], name: str) -> int:
        value = body.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError(f"{name} must be a positive integer")
        return value

    @staticmethod
    def _text(body: dict[str, Any], name: str) -> str:
        value = body.get(name)
        if not isinstance(value, str) or not value.strip() or len(value) > 8000:
            raise ValueError(f"{name} must be a non-empty string")
        return value.strip()

    @staticmethod
    def _enum(body: dict[str, Any], name: str, enum: type[Any], default: Any) -> Any:
        value = body.get(name, default.value)
        if not isinstance(value, str):
            raise ValueError(f"{name} must be a string")
        try:
            return enum(value)
        except ValueError as exc:
            raise ValueError(f"Unsupported {name}") from exc

    def create_demo(self, body: dict[str, Any]) -> dict[str, Any]:
        cid = self._cid(body)
        name = body.get("name", "Demo project")
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            raise ValueError("name must be a non-empty string")
        preset = self._enum(
            body, "preset", ConstraintPreset, ConstraintPreset.DESIGN_GUIDED
        )
        role = self._enum(
            body, "template_role", TemplateRole, TemplateRole.REFERENCE_SAMPLE
        )
        result = self.app.control.execute(
            CreateProject(
                command_id=cid, name=name.strip(), preset=preset, template_role=role
            )
        )
        p = self.app.repository.get(result.project_id)
        if p.state is ProjectState.NEW:
            self.app.control.execute(
                PrepareProject(
                    command_id=f"{cid}:prepare",
                    project_id=p.id,
                    expected_project_revision=p.revision,
                    context_package=ContextPackage(
                        id=stable_id("context", p.id, "phase4-demo"),
                        project_id=p.id,
                        revision=1,
                        confirmed_facts=("Demo content has been confirmed",),
                        source_refs=(),
                        metadata={"source": "phase4-deterministic-demo"},
                    ),
                    brief=DesignBrief(
                        "Demonstrate a complete delivery", "Reviewers", "web"
                    ),
                )
            )
        return self.project(p.id)

    def projects(self) -> list[dict[str, Any]]:
        return [
            {"id": p.id, "name": p.name, "state": p.state.value, "revision": p.revision}
            for p in self.app.repository.list_projects()
        ]

    @staticmethod
    def _actions(p: Project) -> list[dict[str, str]]:
        states = {
            ProjectState.READY_FOR_DESIGN: ("generate_candidates", "fact_feedback"),
            ProjectState.AWAITING_DIRECTION_APPROVAL: (
                "approve_direction",
                "direction_feedback",
                "fact_feedback",
            ),
            ProjectState.PRODUCING: (
                "produce_artifact",
                "direction_feedback",
                "local_feedback",
                "fact_feedback",
            ),
            ProjectState.VALIDATING: (
                "validate_artifact",
                "direction_feedback",
                "local_feedback",
                "fact_feedback",
            ),
            ProjectState.AWAITING_EXPORT_APPROVAL: (
                "approve_export",
                "direction_feedback",
                "local_feedback",
                "fact_feedback",
            ),
            ProjectState.READY_TO_DELIVER: (
                "deliver",
                "direction_feedback",
                "local_feedback",
                "fact_feedback",
            ),
            ProjectState.DELIVERED: (
                "direction_feedback",
                "local_feedback",
                "fact_feedback",
            ),
        }
        action_ids = list(states.get(p.state, ()))
        if p.current_artifact is None and "local_feedback" in action_ids:
            action_ids.remove("local_feedback")
        return [
            {
                "id": action,
                "label": _ACTION_LABELS[action][0],
                "tone": _ACTION_LABELS[action][1],
            }
            for action in action_ids
        ]

    def project(self, project_id: str) -> dict[str, Any]:
        p = self.app.repository.get(project_id)
        q, a = p.current_quality, p.current_artifact
        exports_by_id = {item.id: item for item in p.export_history}
        selected_candidate = next(iter(p.candidates.values()), None)
        if p.approved_direction:
            selected_candidate = p.candidates.get(
                p.approved_direction.candidate_id, selected_candidate
            )
        if a:
            focus = {
                "kind": "artifact",
                "id": a.id,
                "revision": a.revision,
                "artifact_id": a.id,
                "artifact_revision": a.revision,
                "title": f"Artifact r{a.revision}",
                "html": a.content,
            }
        elif selected_candidate:
            focus = {
                "kind": "candidate",
                "id": selected_candidate.id,
                "revision": selected_candidate.revision,
                "title": selected_candidate.title,
                "html": selected_candidate.preview_html,
            }
        else:
            focus = None
        return {
            "id": p.id,
            "name": p.name,
            "state": p.state.value,
            "revision": p.revision,
            "preset": p.constraints.preset.value,
            "template_role": p.constraints.template_role.value,
            "constraints": _constraints(p),
            "tree": {
                "context": bool(p.context_package),
                "brief": bool(p.brief),
                "strategy": p.strategy.id if p.strategy else None,
                "candidate_count": len(p.candidates),
                "approved_direction": p.approved_direction.id
                if p.approved_direction
                else None,
                "artifact": None if not a else {"id": a.id, "revision": a.revision},
                "export": None
                if not p.current_export
                else {"id": p.current_export.id, "revision": p.current_export.revision},
            },
            "candidates": [
                {
                    "id": x.id,
                    "revision": x.revision,
                    "title": x.title,
                    "concept": x.concept,
                    "preview_html": x.preview_html,
                    "template_role": x.template_role.value,
                    "constraint_preset": x.constraints.preset.value,
                }
                for x in p.candidates.values()
            ],
            "focus": focus,
            "quality": None
            if not q
            else {
                "id": q.id,
                "revision": q.revision,
                "verdict": q.verdict.value,
                "aesthetic_findings": [_safe(x) for x in q.aesthetic_findings],
                "hard_errors": [_safe(x) for x in q.hard_errors],
            },
            "approvals": [
                {
                    "id": x.id,
                    "action": x.action.value,
                    "target_id": x.target_id,
                    "target_revision": x.target_revision,
                    "active": x.active,
                    "invalidated_reason": x.invalidated_reason,
                }
                for x in p.approvals.values()
            ],
            "feedback": [
                {
                    "id": x.id,
                    "kind": x.kind.value,
                    "target_id": x.target_id,
                    "target_revision": x.target_revision,
                    "text": x.text,
                    "object_ref": x.object_ref,
                    "routed_to": list(x.routed_to),
                }
                for x in p.feedback
            ],
            "deliveries": [
                {
                    "id": x.id,
                    "revision": x.revision,
                    "artifact_id": x.artifact_id,
                    "artifact_revision": x.artifact_revision,
                    "export_id": x.export_id,
                    "export_revision": exports_by_id[x.export_id].revision,
                    "quality_decision_id": x.quality_decision_id,
                    "approval_id": x.approval_id,
                    "manifest": _safe(x.manifest),
                }
                for x in p.deliveries
            ],
            "activity": [
                {
                    "id": x.id,
                    "sequence": x.sequence,
                    "type": x.event_type,
                    "event_type": x.event_type,
                    "revision": x.project_revision,
                }
                for x in p.events
            ],
            "actions": self._actions(p),
            "settings": {
                "capabilities": (
                    {"slot": "Design Intelligence", "binding": "deterministic stub"},
                    {"slot": "Artifact Production", "binding": "deterministic stub"},
                    {"slot": "Quality & Governance", "binding": "deterministic stub"},
                ),
                "template_role": p.constraints.template_role.value,
                "permissions": {
                    "level": p.constraints.runtime_permissions.level,
                    "source": p.constraints.runtime_permissions.source,
                },
                "export": {
                    "location": "local delivery bundle",
                    "actual_export_verification": "required",
                },
            },
        }

    def events(self, project_id: str, after: int) -> list[dict[str, Any]]:
        if isinstance(after, bool) or not isinstance(after, int) or after < 0:
            raise ValueError("after must be a non-negative integer")
        self.app.repository.get(project_id)
        event_store = getattr(self.app, "events", None)
        events = (
            event_store.after_sequence(project_id, after)
            if event_store is not None and hasattr(event_store, "after_sequence")
            else tuple(
                item
                for item in self.app.repository.get(project_id).events
                if item.sequence > after
            )
        )
        return [
            {
                "id": x.id,
                "sequence": x.sequence,
                "type": x.event_type,
                "revision": x.project_revision,
                "payload": _safe(dict(x.payload)),
            }
            for x in events
        ]

    def command(self, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
        cid, rev = self._cid(body), self._revision(body)
        action = body.get("action")
        if not isinstance(action, str):
            raise ValueError("action must be a string")
        p = self.app.repository.get(project_id)
        if action == "generate_candidates":
            count = body.get("candidate_count", 3)
            if (
                isinstance(count, bool)
                or not isinstance(count, int)
                or not 2 <= count <= 4
            ):
                raise ValueError("candidate_count must be between 2 and 4")
            c: Any = GenerateCandidates(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
                candidate_count=count,
            )
        elif action == "approve_direction":
            c = ApproveDirection(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
                candidate_id=self._text(body, "candidate_id"),
                candidate_revision=self._positive(body, "candidate_revision"),
            )
        elif action in {"direction_feedback", "local_feedback", "fact_feedback"}:
            kind = {
                "direction_feedback": FeedbackKind.DIRECTION,
                "local_feedback": FeedbackKind.ARTIFACT_LOCAL,
                "fact_feedback": FeedbackKind.FACT_OR_POLICY,
            }[action]
            first_candidate = next(iter(p.candidates.values()), None)
            if kind is FeedbackKind.DIRECTION:
                default_id = (
                    p.approved_direction.candidate_id
                    if p.approved_direction
                    else (first_candidate.id if first_candidate else None)
                )
                default_rev = (
                    p.approved_direction.candidate_revision
                    if p.approved_direction
                    else (first_candidate.revision if first_candidate else None)
                )
            elif kind is FeedbackKind.ARTIFACT_LOCAL:
                default_id = p.current_artifact.id if p.current_artifact else None
                default_rev = (
                    p.current_artifact.revision if p.current_artifact else None
                )
            elif p.current_artifact:
                default_id, default_rev = (
                    p.current_artifact.id,
                    p.current_artifact.revision,
                )
            elif p.approved_direction:
                default_id, default_rev = (
                    p.approved_direction.candidate_id,
                    p.approved_direction.candidate_revision,
                )
            elif first_candidate:
                default_id, default_rev = first_candidate.id, first_candidate.revision
            elif p.context_package:
                default_id, default_rev = (
                    p.context_package.id,
                    p.context_package.revision,
                )
            else:
                default_id, default_rev = None, None
            target, target_rev = (
                body.get("target_id", default_id),
                body.get("target_revision", default_rev),
            )
            if not isinstance(target, str) or not target:
                raise ValueError("target_id is required for this feedback")
            if (
                isinstance(target_rev, bool)
                or not isinstance(target_rev, int)
                or target_rev < 1
            ):
                raise ValueError("target_revision must be a positive integer")
            object_ref = body.get("object_ref")
            if object_ref is not None and (
                not isinstance(object_ref, str)
                or not object_ref.strip()
                or len(object_ref) > 240
            ):
                raise ValueError("object_ref must be a short non-empty string")
            c = SubmitFeedback(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
                kind=kind,
                target_id=target,
                target_revision=target_rev,
                text=self._text(body, "text"),
                object_ref=object_ref.strip() if isinstance(object_ref, str) else None,
            )
        elif action == "produce_artifact":
            c = ProduceArtifact(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
            )
        elif action == "validate_artifact":
            c = ValidateArtifact(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
            )
        elif action == "approve_export":
            if not p.current_artifact:
                raise ValueError("No artifact is available for export approval")
            c = ApproveExport(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
                artifact_id=p.current_artifact.id,
                artifact_revision=p.current_artifact.revision,
            )
        elif action == "deliver":
            c = DeliverArtifact(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
                delivery_profile=self._profile(body),
            )
        else:
            raise ValueError("Unknown action")
        self.app.control.execute(c)
        return self.project(project_id)

    @staticmethod
    def _profile(body: dict[str, Any]) -> dict[str, Any]:
        p = body.get("delivery_profile", {})
        if (
            not isinstance(p, dict)
            or any(not isinstance(k, str) for k in p)
            or set(p) - {"format", "simulate_hard_error"}
            or any(isinstance(v, (dict, list)) for v in p.values())
        ):
            raise ValueError("Unsupported delivery_profile")
        if "format" in p and (
            not isinstance(p["format"], str) or not p["format"].strip()
        ):
            raise ValueError("delivery format must be a non-empty string")
        if "simulate_hard_error" in p and not isinstance(
            p["simulate_hard_error"], bool
        ):
            raise ValueError("simulate_hard_error must be boolean")
        return p


def _not_found(error: ContractError) -> bool:
    return error.details.get("project_id") is not None and "does not exist" in str(
        error
    )


def _default_static_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "product-client"


def make_handler(
    service: ProductShellService, static_dir: str | Path | None = None
) -> type[BaseHTTPRequestHandler]:
    root = Path(static_dir or _default_static_dir()).resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = "OEYdesignShell/1"

        def _json(self, status: int, payload: Any) -> None:
            raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy",
                _CSP,
            )
            self.end_headers()
            self.wfile.write(raw)

        def _error(self, error: Exception) -> None:
            if isinstance(error, ContractError):
                self._json(
                    404 if _not_found(error) else 409,
                    {
                        "category": error.category.value,
                        "message": str(error),
                        "current_revision": error.current_revision,
                    },
                )
            elif isinstance(error, (ValueError, TypeError, UnicodeDecodeError)):
                self._json(400, {"category": "INVALID_REQUEST", "message": str(error)})
            else:
                self._json(
                    500,
                    {
                        "category": "INTERNAL_ERROR",
                        "message": "The local shell could not complete this request",
                    },
                )

        def _static(self, path: str) -> None:
            target = (
                root
                / ("index.html" if path in {"", "/"} else unquote(path).lstrip("/"))
            ).resolve()
            if (root != target and root not in target.parents) or not target.is_file():
                self._json(
                    404, {"category": "NOT_FOUND", "message": "Resource was not found"}
                )
                return
            raw = target.read_bytes()
            mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header(
                "Content-Type",
                f"{mime}; charset=utf-8"
                if mime.startswith("text/")
                or mime in {"application/javascript", "application/json"}
                else mime,
            )
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Content-Security-Policy",
                _CSP,
            )
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            try:
                path = parsed.path
                if path == "/api/health":
                    self._json(200, {"status": "ok"})
                elif path == "/api/projects":
                    self._json(200, service.projects())
                elif path.startswith("/api/projects/") and path.endswith("/events"):
                    parts = path.split("/")
                    if len(parts) != 5 or not parts[3]:
                        raise ValueError("Invalid project path")
                    self._json(
                        200,
                        service.events(
                            parts[3], int(parse_qs(parsed.query).get("after", ["0"])[0])
                        ),
                    )
                elif path.startswith("/api/projects/"):
                    parts = path.split("/")
                    if len(parts) != 4 or not parts[3]:
                        raise ValueError("Invalid project path")
                    self._json(200, service.project(parts[3]))
                else:
                    self._static(path)
            except Exception as e:
                self._error(e)

        def do_POST(self) -> None:
            try:
                size = int(self.headers.get("Content-Length", "-1"))
                if size < 0 or size > _MAX_BODY:
                    raise ValueError("Request body is missing or too large")
                body = json.loads(self.rfile.read(size).decode("utf-8"))
                if not isinstance(body, dict):
                    raise ValueError("JSON request body must be an object")
                path = urlparse(self.path).path
                if path == "/api/projects":
                    self._json(201, service.create_demo(body))
                elif path.startswith("/api/projects/") and path.endswith("/commands"):
                    parts = path.split("/")
                    if len(parts) != 5 or not parts[3]:
                        raise ValueError("Invalid project path")
                    self._json(200, service.command(parts[3], body))
                else:
                    self._json(
                        404,
                        {"category": "NOT_FOUND", "message": "Resource was not found"},
                    )
            except Exception as e:
                self._error(e)

        def log_message(self, _format: str, *args: Any) -> None:
            del args

    return Handler


def make_server(
    app: Any,
    host: str = "127.0.0.1",
    port: int = 0,
    static_dir: str | Path | None = None,
) -> ThreadingHTTPServer:
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("The unauthenticated Phase 4 shell is loopback-only")
    return ThreadingHTTPServer(
        (host, port), make_handler(ProductShellService(app), static_dir)
    )


def main(argv: list[str] | None = None) -> int:
    parser = ArgumentParser(description="Run the local OEYdesign Phase 4 shell")
    parser.add_argument("--database", default="oeydesign.sqlite")
    parser.add_argument("--data-root", default="data/product-shell")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--static-dir", type=Path, default=_default_static_dir())
    args = parser.parse_args(argv)

    from .composition import SQLiteApplication

    with SQLiteApplication(args.database, data_root=args.data_root) as app:
        server = make_server(app, args.host, args.port, args.static_dir)
        print(f"OEYdesign shell listening on http://{args.host}:{server.server_port}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
