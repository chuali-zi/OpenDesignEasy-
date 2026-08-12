"""Dependency-free HTTP adapter for the recoverable Phase 4 product shell."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import secrets
from argparse import ArgumentParser
from dataclasses import asdict, is_dataclass
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse, urlsplit

from .domain import (
    ApproveDirection,
    ApproveExport,
    ConstraintPreset,
    ContextPackage,
    ContractError,
    CreateProject,
    DeliverArtifact,
    DesignBrief,
    ErrorCategory,
    FeedbackKind,
    GenerateCandidates,
    PrepareProject,
    ProduceArtifact,
    Project,
    ProjectState,
    RestoreProjectRevision,
    SubmitFeedback,
    TemplateRole,
    ValidateArtifact,
    canonical_json,
    stable_id,
)

_MAX_BODY = 11 * 1024 * 1024
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
            and not str(k).lower().endswith("_path")
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
        self.csrf_token = secrets.token_urlsafe(32)
        self.session_id = secrets.token_urlsafe(18)
        self.preview_tokens: dict[str, tuple[str, str, int]] = {}
        self.preview_bindings: dict[tuple[str, str, int], str] = {}

    def _preview_token(self, file_set_id: str, owner_id: str, revision: int) -> str:
        binding = (file_set_id, owner_id, revision)
        token = self.preview_bindings.get(binding)
        if token is None:
            token = secrets.token_urlsafe(24)
            self.preview_bindings[binding] = token
            self.preview_tokens[token] = binding
        return token

    @property
    def production(self) -> bool:
        return hasattr(self.app, "product_store")

    def session(self) -> dict[str, Any]:
        return {"session_id": self.session_id, "csrf_token": self.csrf_token}

    def health(self) -> dict[str, Any]:
        if not self.production:
            return {
                "status": "demo",
                "technical_ready": True,
                "product_ready": False,
                "capabilities": {},
                "provider": {"configured": False, "model": None},
                "blockers": ["Deterministic demo mode is active"],
            }
        readiness = self.app.product_readiness
        return {
            "status": "ready" if readiness.ready else "needs_configuration",
            "technical_ready": self.app.framework_builder.ready_for_p6,
            "product_ready": readiness.ready,
            "capabilities": dict(readiness.capabilities),
            "provider": {
                "provider": readiness.provider.provider,
                "configured": readiness.provider.credential_configured,
                "model": readiness.provider.model,
            },
            "blockers": list(readiness.blockers),
        }

    def provider_settings(self) -> dict[str, Any]:
        if not self.production:
            return {
                "provider": "kimi",
                "base_url": "",
                "model": "",
                "credential_configured": False,
            }
        settings = self.app.provider.settings()
        return {
            "provider": settings.provider,
            "base_url": settings.base_url,
            "model": settings.model,
            "credential_configured": settings.credential_configured,
        }

    def configure_provider(self, body: dict[str, Any]) -> dict[str, Any]:
        if not self.production:
            raise ValueError("Provider settings are unavailable in demo mode")
        api_key = self._text(body, "api_key")
        base_url = self._text(body, "base_url")
        model = self._text(body, "model")
        self.app.provider.configure(
            base_url=base_url, model=model, api_key=api_key, probe=True
        )
        return self.provider_settings()

    def delete_provider(self) -> dict[str, Any]:
        if not self.production:
            raise ValueError("Provider settings are unavailable in demo mode")
        self.app.provider.delete()
        return self.provider_settings()

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

    def create_project(self, body: dict[str, Any]) -> dict[str, Any]:
        if not self.production:
            return self.create_demo(body)
        cid = self._cid(body)
        name = body.get("name", "Untitled Web project")
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            raise ValueError("name must be a non-empty string")
        result = self.app.create_empty_project(command_id=cid, name=name.strip())
        return self.project(result.project_id)

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
        projection = {
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
            "revisions": [
                {
                    "revision": revision,
                    "state": snapshot.state.value,
                    "candidate_count": len(snapshot.candidates),
                    "artifact_revision": (
                        snapshot.current_artifact.revision
                        if snapshot.current_artifact
                        else None
                    ),
                }
                for revision in self.app.repository.list_revisions(project_id)[-50:]
                for snapshot in (
                    self.app.repository.get_revision(project_id, revision),
                )
            ],
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
        if self.production:
            projection["messages"] = self.messages(project_id)
            projection["runs"] = [
                self._job(item) for item in self.app.product_store.list_jobs(project_id)
            ]
            projection["sources"] = [
                {
                    "id": source.id,
                    "name": source.original_name,
                    "kind": source.kind.value,
                    "media_type": source.media_type,
                    "byte_size": source.byte_size,
                    "rights": source.rights.value,
                }
                for source in self.app.evidence_repository.list_sources(project_id)
            ]
            projection["settings"] = {
                "capabilities": [
                    {"slot": key, "binding": value}
                    for key, value in self.app.readiness.versions
                ],
                "product_readiness": self.health(),
                "template_role": p.constraints.template_role.value,
                "permissions": {
                    "level": p.constraints.runtime_permissions.level,
                    "source": p.constraints.runtime_permissions.source,
                },
                "export": {
                    "location": "immutable local source + dist ZIP",
                    "actual_export_verification": "required",
                },
            }
            for item in projection["candidates"]:
                file_set = self.app.product_store.file_set_for(
                    "candidate", item["id"], item["revision"]
                )
                if file_set is not None:
                    token = self._preview_token(
                        file_set.id, item["id"], item["revision"]
                    )
                    item["file_set_id"] = file_set.id
                    item["preview_url"] = (
                        f"/api/previews/{file_set.id}/index.html?token={token}"
                    )
                    item["preview_token"] = token
                    item["visual_review"] = _safe(
                        file_set.metadata.get("visual_review")
                    )
            if a:
                file_set = self.app.product_store.file_set_for(
                    "artifact", a.id, a.revision
                )
                if file_set is not None and projection["focus"]:
                    token = self._preview_token(file_set.id, a.id, a.revision)
                    projection["focus"]["file_set_id"] = file_set.id
                    projection["focus"]["preview_url"] = (
                        f"/api/previews/{file_set.id}/index.html?token={token}"
                    )
                    projection["focus"]["preview_token"] = token
                    projection["focus"]["visual_review"] = _safe(
                        file_set.metadata.get("visual_review")
                    )
        return projection

    def attach_repository(
        self, project_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        if not self.production:
            raise ValueError("Repository ingestion is unavailable in demo mode")
        self._cid(body)
        revision = self._revision(body)
        project = self.app.repository.get(project_id)
        if project.revision != revision:
            raise ContractError(
                ErrorCategory.STALE_REVISION,
                "Project revision changed",
                current_revision=project.revision,
            )
        path = self._text(body, "path")
        fingerprint = hashlib.sha256(
            canonical_json(
                {"project_id": project_id, "revision": revision, "path": path}
            ).encode()
        ).hexdigest()

        def ingest() -> str:
            existing = tuple(
                source
                for source in self.app.evidence_repository.list_sources(project_id)
                if source.kind.value == "CODE_REPOSITORY"
            )
            if existing:
                raise ValueError("Project already has a repository")
            result = self.app.repository_ingestion.ingest_repository(
                project_id, self.app.repository_ingestion.authorize(path)
            )
            return result.source.id

        source_id = self.app.product_store.run_idempotent(
            request_key=f"repository:{project_id}:{self._cid(body)}",
            fingerprint=fingerprint,
            operation=ingest,
        )
        source = next(
            item
            for item in self.app.evidence_repository.list_sources(project_id)
            if item.id == source_id
        )
        return {
            "source": {
                "id": source.id,
                "name": source.original_name,
                "file_count": len(self.app.repository_ingestion.list_files(source)),
                "byte_size": source.byte_size,
                "rights": source.rights.value,
            },
            "project": self.project(project_id),
        }

    def upload_image(
        self,
        project_id: str,
        *,
        command_id: str,
        expected_revision: int,
        filename: str,
        media_type: str,
        payload: bytes,
    ) -> dict[str, Any]:
        if not self.production:
            raise ValueError("Reference images are unavailable in demo mode")
        if not command_id.strip() or len(command_id) > 160:
            raise ValueError("command_id must be a non-empty string")
        if (
            isinstance(expected_revision, bool)
            or not isinstance(expected_revision, int)
            or expected_revision < 1
        ):
            raise ValueError("expected_revision must be a positive integer")
        project = self.app.repository.get(project_id)
        if project.revision != expected_revision:
            raise ContractError(
                ErrorCategory.STALE_REVISION,
                "Project revision changed",
                current_revision=project.revision,
            )
        fingerprint = hashlib.sha256(
            canonical_json(
                {
                    "project_id": project_id,
                    "revision": expected_revision,
                    "filename": filename,
                    "media_type": media_type,
                    "payload_sha256": hashlib.sha256(payload).hexdigest(),
                }
            ).encode()
        ).hexdigest()

        def ingest() -> str:
            return self.app.images.ingest(
                project_id=project_id,
                filename=filename,
                media_type=media_type,
                payload=payload,
            ).id

        source_id = self.app.product_store.run_idempotent(
            request_key=f"image:{project_id}:{command_id}",
            fingerprint=fingerprint,
            operation=ingest,
        )
        source = next(
            item
            for item in self.app.evidence_repository.list_sources(project_id)
            if item.id == source_id
        )
        return {
            "id": source.id,
            "name": source.original_name,
            "media_type": source.media_type,
            "byte_size": source.byte_size,
            "rights": source.rights.value,
        }

    def messages(self, project_id: str) -> list[dict[str, Any]]:
        if not self.production:
            return []
        self.app.repository.get(project_id)
        return [
            {
                "id": message.id,
                "role": message.role.value,
                "text": message.text,
                "run_id": message.run_id,
                "target_id": message.target_id,
                "target_revision": message.target_revision,
                "object_ref": message.object_ref,
                "created_at": message.created_at,
            }
            for message in self.app.product_store.list_messages(project_id)
        ]

    def send_message(self, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
        if not self.production:
            raise ValueError("Agent messages are unavailable in demo mode")
        client_id = self._text(body, "client_message_id")
        target_revision = body.get("target_revision")
        if target_revision is not None and (
            isinstance(target_revision, bool)
            or not isinstance(target_revision, int)
            or target_revision < 1
        ):
            raise ValueError("target_revision must be a positive integer")
        job = self.app.submit_message(
            project_id=project_id,
            client_message_id=client_id,
            expected_revision=self._revision(body),
            text=self._text(body, "text"),
            target_id=body.get("target_id"),
            target_revision=target_revision,
            object_ref=body.get("object_ref"),
        )
        return {"run": self._job(job), "project_id": project_id}

    def run(self, job_id: str) -> dict[str, Any]:
        if not self.production:
            raise ValueError("Agent jobs are unavailable in demo mode")
        return self._job(self.app.product_store.get_job(job_id))

    def run_action(self, job_id: str, action: str) -> dict[str, Any]:
        if not self.production:
            raise ValueError("Agent jobs are unavailable in demo mode")
        handlers = {
            "pause": self.app.jobs.pause,
            "resume": self.app.jobs.resume,
            "cancel": self.app.jobs.cancel,
        }
        try:
            job = handlers[action](job_id)
        except KeyError as exc:
            raise ValueError("Unknown run action") from exc
        return self._job(job)

    def preview(
        self, file_set_id: str, relative: str, token: str | None
    ) -> tuple[bytes, str]:
        if not self.production:
            raise ValueError("Product previews are unavailable in demo mode")
        file_set = self.app.product_store.get_file_set(file_set_id)
        payload = self.app.file_sets.read(file_set, "dist", relative)
        mime = mimetypes.guess_type(relative)[0] or "application/octet-stream"
        if relative == "index.html":
            bound = self.preview_tokens.get(token or "")
            if bound is None or bound[0] != file_set_id:
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED, "Preview token is invalid"
                )
            bridge = _preview_bridge(token or "", bound[1], bound[2])
            text = payload.decode("utf-8")
            payload = text.replace("</body>", bridge + "</body>").encode("utf-8")
        return payload, mime

    def rotate_preview_token(
        self, file_set_id: str, body: dict[str, Any]
    ) -> dict[str, str]:
        token = self._text(body, "token")
        binding = self.preview_tokens.get(token)
        if binding is None or binding[0] != file_set_id:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED, "Preview token is invalid"
            )
        self.preview_tokens.pop(token, None)
        self.preview_bindings.pop(binding, None)
        replacement = self._preview_token(*binding)
        return {
            "preview_token": replacement,
            "preview_url": (
                f"/api/previews/{file_set_id}/index.html?token={replacement}"
            ),
        }

    def download(self, delivery_id: str) -> tuple[bytes, str]:
        if not self.production:
            raise ValueError("Product downloads are unavailable in demo mode")
        for project in self.app.repository.list_projects():
            delivery = next(
                (item for item in project.deliveries if item.id == delivery_id), None
            )
            if delivery is None:
                continue
            archive = Path(str(delivery.manifest.get("archive_path", "")))
            if not archive.is_file():
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "Delivery archive is unavailable",
                )
            return archive.read_bytes(), f"{delivery.id}.zip"
        raise ContractError(ErrorCategory.DETERMINISTIC_FAILURE, "Delivery not found")

    @staticmethod
    def _job(job: Any) -> dict[str, Any]:
        return {
            "id": job.id,
            "project_id": job.project_id,
            "kind": job.kind,
            "status": job.status.value,
            "stage": job.stage,
            "steps": job.steps,
            "total_tokens": job.total_tokens,
            "renders": job.renders,
            "elapsed_seconds": job.elapsed_seconds,
            "result": _safe(dict(job.result)),
            "error_category": job.error_category,
            "error_message": job.error_message,
            "can_pause": job.status.value == "RUNNING",
            "can_resume": job.status.value == "PAUSED",
            "can_cancel": job.status.value in {"QUEUED", "RUNNING", "PAUSED"},
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
            medium = body.get("medium", "web")
            fidelity_mode = body.get("fidelity_mode", "production")
            if medium != "web" or not isinstance(fidelity_mode, str):
                raise ValueError("Web MVP supports only Web artifact production")
            c = ProduceArtifact(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
                medium=medium,
                fidelity_mode=fidelity_mode,
            )
        elif action == "validate_artifact":
            render_profile = body.get("render_profile", {})
            if not isinstance(render_profile, dict):
                raise ValueError("render_profile must be an object")
            width = render_profile.get("width", 1440)
            height = render_profile.get("height", 1000)
            if any(
                isinstance(value, bool)
                or not isinstance(value, int)
                or not 320 <= value <= 5000
                for value in (width, height)
            ):
                raise ValueError("render_profile dimensions are invalid")
            c = ValidateArtifact(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
                render_profile={"width": width, "height": height},
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
        elif action == "restore_revision":
            c = RestoreProjectRevision(
                command_id=cid,
                project_id=project_id,
                expected_project_revision=rev,
                source_revision=self._positive(body, "source_revision"),
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
            or set(p) - {"format", "profile", "simulate_hard_error"}
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


def _preview_bridge(token: str, owner_id: str, revision: int) -> str:
    values = json.dumps(
        {"token": token, "owner_id": owner_id, "revision": revision},
        separators=(",", ":"),
    ).replace("<", "\\u003c")
    return f"""<script>(function(){{
const binding={values};
document.addEventListener('click',function(event){{
  const target=event.target.closest('[data-oey-object]');
  if(!target)return;
  event.preventDefault();
  parent.postMessage({{type:'oey-object-selected',token:binding.token,
    owner_id:binding.owner_id,revision:binding.revision,
    object_ref:target.getAttribute('data-oey-object')}},'*');
}});
}})();</script>"""


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
                status = {
                    ErrorCategory.CAPABILITY_UNAVAILABLE: 503,
                    ErrorCategory.POLICY_BLOCKED: 403,
                }.get(error.category, 404 if _not_found(error) else 409)
                self._json(
                    status,
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

        def _raw(
            self,
            status: int,
            payload: bytes,
            media_type: str,
            *,
            disposition: str | None = None,
        ) -> None:
            self.send_response(status)
            self.send_header("Content-Type", media_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; connect-src 'none'; frame-ancestors 'self'; "
                "object-src 'none'; base-uri 'none'; img-src 'self' data:; "
                "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
            )
            if disposition:
                self.send_header("Content-Disposition", disposition)
            self.end_headers()
            self.wfile.write(payload)

        def _require_write(self) -> None:
            if not service.production:
                return
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin", "")
            host_name = urlsplit("//" + host).hostname
            parsed_origin = urlsplit(origin)
            if (
                host_name not in {"127.0.0.1", "::1", "localhost"}
                or parsed_origin.scheme != "http"
                or parsed_origin.hostname != host_name
                or parsed_origin.netloc != host
            ):
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED, "Request origin is not allowed"
                )
            if self.headers.get("X-OEY-CSRF") != service.csrf_token:
                raise ContractError(
                    ErrorCategory.POLICY_BLOCKED, "CSRF token is invalid"
                )

        def _read_body(self) -> bytes:
            size = int(self.headers.get("Content-Length", "-1"))
            if size < 0 or size > _MAX_BODY:
                raise ValueError("Request body is missing or too large")
            return self.rfile.read(size)

        def _body(self) -> dict[str, Any]:
            body = json.loads(self._read_body().decode("utf-8"))
            if not isinstance(body, dict):
                raise ValueError("JSON request body must be an object")
            return body

        def _multipart_image(self) -> tuple[dict[str, str], str, str, bytes]:
            content_type = self.headers.get("Content-Type", "")
            if not content_type.casefold().startswith("multipart/form-data;"):
                raise ValueError("Image upload must use multipart/form-data")
            envelope = (
                f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
                + self._read_body()
            )
            message = BytesParser(policy=policy.default).parsebytes(envelope)
            if not message.is_multipart():
                raise ValueError("Multipart image body is invalid")
            fields: dict[str, str] = {}
            upload: tuple[str, str, bytes] | None = None
            for part in message.iter_parts():
                name = part.get_param("name", header="content-disposition")
                filename = part.get_filename()
                payload = part.get_payload(decode=True)
                if not isinstance(name, str) or not isinstance(payload, bytes):
                    raise ValueError("Multipart image part is invalid")
                if filename is not None:
                    if upload is not None or name != "image":
                        raise ValueError("Exactly one image part is required")
                    upload = (
                        filename,
                        part.get_content_type(),
                        payload,
                    )
                else:
                    fields[name] = payload.decode("utf-8")
            if upload is None:
                raise ValueError("Image part is required")
            return fields, upload[0], upload[1], upload[2]

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
                    self._json(200, service.health())
                elif path == "/api/session":
                    self._json(200, service.session())
                elif path == "/api/settings/provider":
                    self._json(200, service.provider_settings())
                elif path == "/api/projects":
                    self._json(200, service.projects())
                elif path.startswith("/api/previews/"):
                    parts = path.split("/", 4)
                    if len(parts) != 5 or not parts[3] or not parts[4]:
                        raise ValueError("Invalid preview path")
                    token = parse_qs(parsed.query).get("token", [None])[0]
                    payload, media_type = service.preview(parts[3], parts[4], token)
                    self._raw(200, payload, media_type)
                elif path.startswith("/api/deliveries/") and path.endswith("/download"):
                    parts = path.split("/")
                    if len(parts) != 5 or not parts[3]:
                        raise ValueError("Invalid delivery path")
                    payload, filename = service.download(parts[3])
                    self._raw(
                        200,
                        payload,
                        "application/zip",
                        disposition=f'attachment; filename="{filename}"',
                    )
                elif path.startswith("/api/runs/"):
                    parts = path.split("/")
                    if len(parts) != 4 or not parts[3]:
                        raise ValueError("Invalid run path")
                    self._json(200, service.run(parts[3]))
                elif path.startswith("/api/projects/") and path.endswith("/messages"):
                    parts = path.split("/")
                    if len(parts) != 5 or not parts[3]:
                        raise ValueError("Invalid project path")
                    self._json(200, service.messages(parts[3]))
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
                self._require_write()
                path = urlparse(self.path).path
                is_image = path.startswith("/api/projects/") and path.endswith(
                    "/sources/images"
                )
                body = {} if is_image else self._body()
                if path == "/api/projects":
                    self._json(201, service.create_project(body))
                elif path.startswith("/api/projects/") and path.endswith("/repository"):
                    parts = path.split("/")
                    if len(parts) != 5 or not parts[3]:
                        raise ValueError("Invalid project path")
                    self._json(201, service.attach_repository(parts[3], body))
                elif path.startswith("/api/projects/") and path.endswith("/messages"):
                    parts = path.split("/")
                    if len(parts) != 5 or not parts[3]:
                        raise ValueError("Invalid project path")
                    self._json(202, service.send_message(parts[3], body))
                elif is_image:
                    parts = path.split("/")
                    if len(parts) != 6 or not parts[3]:
                        raise ValueError("Invalid project path")
                    fields, filename, media_type, decoded = self._multipart_image()
                    try:
                        expected_revision = int(fields.get("expected_revision", ""))
                    except ValueError as exc:
                        raise ValueError(
                            "expected_revision must be a positive integer"
                        ) from exc
                    self._json(
                        201,
                        service.upload_image(
                            parts[3],
                            command_id=fields.get("command_id", ""),
                            expected_revision=expected_revision,
                            filename=filename,
                            media_type=media_type,
                            payload=decoded,
                        ),
                    )
                elif path.startswith("/api/runs/"):
                    parts = path.split("/")
                    if len(parts) != 5 or not parts[3] or not parts[4]:
                        raise ValueError("Invalid run action")
                    self._json(200, service.run_action(parts[3], parts[4]))
                elif path.startswith("/api/previews/") and path.endswith("/token"):
                    parts = path.split("/")
                    if len(parts) != 5 or not parts[3]:
                        raise ValueError("Invalid preview token path")
                    self._json(200, service.rotate_preview_token(parts[3], body))
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

        def do_PUT(self) -> None:
            try:
                self._require_write()
                body = self._body()
                if urlparse(self.path).path != "/api/settings/provider":
                    self._json(
                        404,
                        {"category": "NOT_FOUND", "message": "Resource was not found"},
                    )
                    return
                self._json(200, service.configure_provider(body))
            except Exception as e:
                self._error(e)

        def do_DELETE(self) -> None:
            try:
                self._require_write()
                if urlparse(self.path).path != "/api/settings/provider":
                    self._json(
                        404,
                        {"category": "NOT_FOUND", "message": "Resource was not found"},
                    )
                    return
                self._json(200, service.delete_provider())
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
    parser = ArgumentParser(description="Run the local OEYdesign Web workbench")
    parser.add_argument("--database", default="oeydesign.sqlite")
    parser.add_argument("--data-root", default="data/product-shell")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--static-dir", type=Path, default=_default_static_dir())
    parser.add_argument("--dependency-image", type=Path, default=None)
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Use deterministic Phase 4 adapters instead of the real Web MVP",
    )
    args = parser.parse_args(argv)

    if args.demo:
        from .composition import SQLiteApplication

        app_context: Any = SQLiteApplication(args.database, data_root=args.data_root)
    else:
        from .web_mvp import ProductApplication

        app_context = ProductApplication(
            args.database,
            data_root=args.data_root,
            dependency_image=args.dependency_image,
        )
    with app_context as app:
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
