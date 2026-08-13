"""Production composition and intake workflow for the local Windows Web MVP."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import threading
import time
import warnings
import weakref
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

from .agent_design import (
    AgentComposer,
    AgentDesignIntelligence,
    FileSetArtifactProduction,
    KimiVisualQualityReview,
    ModelAwareWebQualityPort,
)
from .capabilities import (
    CapabilityClient,
    KimiTrustedAdapter,
    stream_callback_options,
)
from .context import LocalSourceStore
from .credentials import (
    KIMI_CREDENTIAL_TARGET,
    CredentialStorePort,
    default_credential_store,
)
from .domain import (
    ContextPackage,
    ContractError,
    CreateProject,
    DesignBrief,
    ErrorCategory,
    EvidenceLayer,
    EvidenceRecord,
    FeedbackKind,
    GenerateCandidates,
    PrepareProject,
    ProjectState,
    RightsStatus,
    SourceAsset,
    SourceKind,
    SourceLocator,
    SubmitFeedback,
    ValidateArtifact,
    stable_id,
)
from .instance_lock import DatabaseInstanceLock
from .phase6 import (
    Phase6Application,
    Phase6Bindings,
    assess_phase6_readiness,
)
from .product import (
    AgentJob,
    AgentJobRunner,
    ArtifactFileSetStore,
    JobControl,
    ProductMessage,
    ProductMessageRole,
    ProductReadiness,
    ProductStore,
    ProviderSettings,
)


@dataclass(frozen=True, slots=True)
class ImageAnalysis:
    source_id: str
    content: str
    composition: str
    color: str
    typography: str
    transferable_features: tuple[str, ...]
    forbidden_copy: tuple[str, ...]
    confidence: float


@dataclass(frozen=True, slots=True)
class IntakeDecision:
    status: str
    question: str | None
    goal: str
    audience: str
    medium: str
    content_priorities: tuple[str, ...]
    style_intent: tuple[str, ...]
    constraints: tuple[str, ...]
    confirmed_facts: tuple[str, ...]
    material_uncertainties: tuple[str, ...]
    image_analyses: tuple[ImageAnalysis, ...]


class ProviderResolver:
    """Resolve Kimi without exposing credentials to product state."""

    def __init__(
        self,
        product_store: ProductStore,
        credentials: CredentialStorePort,
    ) -> None:
        self.product_store = product_store
        self.credentials = credentials

    def settings(self) -> ProviderSettings:
        stored = self.product_store.provider_settings()
        configured = self.credentials.configured(KIMI_CREDENTIAL_TARGET)
        if stored.credential_configured != configured:
            stored = ProviderSettings(
                stored.provider, stored.base_url, stored.model, configured
            )
            self.product_store.save_provider_settings(stored)
        return stored

    def configure(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str | None,
        probe: bool = True,
    ) -> ProviderSettings:
        if not model.strip() or len(model) > 200:
            raise ValueError("Provider model is invalid")
        supplied_secret = api_key.strip() if isinstance(api_key, str) else ""
        secret = supplied_secret or self.credentials.read(KIMI_CREDENTIAL_TARGET)
        if not secret:
            raise ValueError("A Kimi API key is required")
        adapter = KimiTrustedAdapter(
            api_key=secret,
            base_url=base_url,
            timeout_seconds=60,
        )
        if probe:
            response = adapter.chat(
                [
                    {
                        "role": "user",
                        "content": (
                            "Return exactly the word READY to confirm this model is "
                            "available."
                        ),
                    }
                ],
                model=model.strip(),
                # Reasoning models may consume a small prefix before emitting
                # READY; an ultra-small cap can create a false-negative probe.
                max_tokens=1_024,
                temperature=0,
                stream=False,
                reasoning_effort="low",
            )
            if "READY" not in response.content.upper():
                raise ContractError(
                    ErrorCategory.CAPABILITY_UNAVAILABLE,
                    "Provider probe did not confirm readiness",
                )
        if supplied_secret:
            self.credentials.write(KIMI_CREDENTIAL_TARGET, supplied_secret)
        settings = ProviderSettings("kimi", base_url.rstrip("/"), model.strip(), True)
        self.product_store.save_provider_settings(settings)
        return settings

    def delete(self) -> ProviderSettings:
        self.credentials.delete(KIMI_CREDENTIAL_TARGET)
        cleared = ProviderSettings("kimi", "", "", False)
        self.product_store.save_provider_settings(cleared)
        return cleared

    def require(self) -> tuple[CapabilityClient, str]:
        settings = self.settings()
        secret = self.credentials.read(KIMI_CREDENTIAL_TARGET)
        if (
            not settings.credential_configured
            or not settings.base_url
            or not settings.model
            or not secret
        ):
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Kimi provider is not configured",
            )
        return (
            KimiTrustedAdapter(
                api_key=secret,
                base_url=settings.base_url,
                timeout_seconds=900,
            ),
            settings.model,
        )


class ProductImageService:
    max_images = 12
    max_image_bytes = 10_000_000
    max_project_bytes = 50_000_000
    max_pixels = 80_000_000

    def __init__(self, app: Phase6Application, data_root: str | Path) -> None:
        self.app = app
        self.store = LocalSourceStore(data_root, max_bytes=self.max_image_bytes)

    def ingest(
        self,
        *,
        project_id: str,
        filename: str,
        media_type: str,
        payload: bytes,
    ) -> SourceAsset:
        self.app.repository.get(project_id)
        if (
            not filename
            or len(filename) > 255
            or Path(filename).name != filename
            or "\\" in filename
            or "\x00" in filename
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED, "Reference image filename is invalid"
            )
        if media_type not in {"image/png", "image/jpeg"}:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Web MVP accepts only PNG and JPEG reference images",
            )
        extension = Path(filename).suffix.casefold()
        expected_extensions = (
            {".png"} if media_type == "image/png" else {".jpg", ".jpeg"}
        )
        if extension not in expected_extensions:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Reference image extension and media type do not match",
            )
        width, height, detected = _decode_image(payload)
        if detected != media_type:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Reference image bytes and media type do not match",
            )
        if width * height > self.max_pixels:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Reference image dimensions exceed the limit",
            )
        current = tuple(
            source
            for source in self.app.evidence_repository.list_sources(project_id)
            if source.kind is SourceKind.IMAGE
        )
        if len(current) >= self.max_images:
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Project reference image count exceeds the limit",
            )
        digest = hashlib.sha256(payload).hexdigest()
        if any(source.sha256_digest == digest for source in current):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Duplicate reference images are not accepted",
            )
        if (
            sum(source.byte_size for source in current) + len(payload)
            > self.max_project_bytes
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Project reference images exceed the total byte limit",
            )
        source = self.store.ingest(
            project_id=project_id,
            original_name=filename,
            media_type=media_type,
            payload=payload,
            rights=RightsStatus.ANALYSIS_ONLY,
        )
        self.app.evidence_repository.add_source(source)
        locator = SourceLocator(source.id, source.revision, {"region": "whole-image"})
        observation = EvidenceRecord(
            stable_id("evidence", source.id, width, height),
            project_id,
            1,
            EvidenceLayer.NATIVE_OBSERVATION,
            "image.dimensions",
            {"width": width, "height": height, "format": detected},
            locator,
            1.0,
            (),
            source.rights,
            "pillow-image-decode/1",
        )
        self.app.evidence_repository.add_evidence((observation,))
        return source

    def read(self, source: SourceAsset) -> bytes:
        return self.store.read(source)


class KimiIntake:
    capability_version = "kimi-multimodal-intake/1"

    def __init__(
        self,
        *,
        provider: ProviderResolver,
        image_service: ProductImageService,
        app: Phase6Application,
        product_store: ProductStore,
    ) -> None:
        self.provider = provider
        self.images = image_service
        self.app = app
        self.product_store = product_store
        self.last_usage: Mapping[str, int] = MappingProxyType({})
        self.activity_reporter: Any | None = None

    def decide(self, project_id: str) -> IntakeDecision:
        client, model = self.provider.require()
        messages = self.product_store.list_messages(project_id)
        if not any(message.role is ProductMessageRole.USER for message in messages):
            raise ContractError(ErrorCategory.NEEDS_INPUT, "A user request is required")
        sources = self.app.evidence_repository.list_sources(project_id)
        repository_summary: list[Mapping[str, Any]] = []
        image_parts: list[Mapping[str, Any]] = []
        for source in sources:
            if source.kind is SourceKind.CODE_REPOSITORY:
                summaries = self.app.repository_ingestion.list_files(source)
                repository_summary = []
                for item in summaries[:300]:
                    record: dict[str, Any] = {
                        "path": item.path,
                        "byte_size": item.byte_size,
                        "line_count": item.line_count,
                    }
                    if _repository_intake_file(item.path, item.byte_size):
                        payload = self.app.repository_ingestion.read_file(
                            source,
                            SourceLocator(
                                source.id,
                                source.revision,
                                {
                                    "path": item.path,
                                    "line_start": 1,
                                    "line_end": item.line_count,
                                },
                            ),
                        )
                        record["content"] = payload[:24_000].decode(
                            "utf-8", "replace"
                        )
                    repository_summary.append(record)
            elif source.kind is SourceKind.IMAGE:
                encoded = base64.b64encode(self.images.read(source)).decode("ascii")
                image_parts.append(
                    {
                        "type": "text",
                        "text": f"Reference source_id={source.id}",
                    }
                )
                image_parts.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{source.media_type};base64,{encoded}"
                        },
                    }
                )
        conversation = [
            {"role": message.role.value, "text": message.text} for message in messages
        ]
        content: list[Mapping[str, Any]] = [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "conversation": conversation,
                        "repository_files": repository_summary,
                        "required_medium": "web",
                    },
                    ensure_ascii=False,
                ),
            }
        ]
        content.extend(image_parts)
        progress = _stream_progress(
            self.activity_reporter,
            "Kimi is streaming the intake analysis",
        )
        response = client.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "Act as a multimodal design intake editor. Return only JSON. "
                        "Use status READY when the goal and audience can be reasonably "
                        "inferred. Use NEEDS_INPUT only for one uncertainty that would "
                        "materially change facts, audience, rights, or structure, and "
                        "ask exactly one question. Visual ambiguity is not a reason to "
                        "ask. Include goal, audience, medium='web', "
                        "content_priorities, style_intent, constraints, "
                        "confirmed_facts, material_uncertainties, and image_analyses. "
                        "Each image analysis must use its source_id and include "
                        "content, composition, color, typography, "
                        "transferable_features, forbidden_copy, confidence."
                    ),
                },
                {"role": "user", "content": content},
            ],
            model=model,
            max_tokens=10_000,
            temperature=0.3,
            stream=True,
            **stream_callback_options(client, progress),
        )
        self.last_usage = MappingProxyType(dict(response.usage))
        return parse_intake_decision(response.content)


class ProductApplication(Phase6Application):
    """Default Web MVP object graph; demo fallbacks never satisfy product ready."""

    def __init__(
        self,
        database: str | Path,
        *,
        data_root: str | Path,
        dependency_image: str | Path | None = None,
        credentials: CredentialStorePort | None = None,
        acquire_instance_lock: bool = True,
    ) -> None:
        self._instance_lock = (
            DatabaseInstanceLock(database) if acquire_instance_lock else None
        )
        self._instance_lock_finalizer = (
            weakref.finalize(self, self._instance_lock.release)
            if self._instance_lock is not None
            else None
        )
        configured_dependency = dependency_image or os.environ.get(
            "OEYDESIGN_FRAMEWORK_DEPENDENCIES"
        )
        phase6_dependency = configured_dependency or (
            Path(data_root) / ".dependency-image-unavailable"
        )
        try:
            super().__init__(
                database, data_root=data_root, dependency_image=phase6_dependency
            )
        except Exception:
            if self._instance_lock_finalizer is not None:
                self._instance_lock_finalizer()
            raise
        self.data_root = Path(data_root).resolve()
        self.product_store = ProductStore(self.store)
        self.credential_store = credentials or default_credential_store()
        self.provider = ProviderResolver(self.product_store, self.credential_store)
        self.file_sets = ArtifactFileSetStore(self.data_root, self.product_store)
        selected_image = self.framework_builder.dependency_image
        dependency_root = (
            Path(selected_image).resolve()
            if selected_image and Path(selected_image).is_dir()
            else None
        )
        if dependency_root is not None:
            visual = KimiVisualQualityReview(self.provider)
            composer = AgentComposer(
                data_root=self.data_root,
                dependency_image=dependency_root,
                provider=self.provider,
                builder=self.framework_builder,
                renderer=self.renderer,
                file_sets=self.file_sets,
                visual_quality=visual,
                repository_reader=self.repository_ingestion,
                sandbox_launcher=self.sandbox_launcher,
                workspace_root=(
                    self.sandbox_launcher.workspace_base(self.data_root)
                    if self.sandbox_launcher.available
                    and hasattr(self.sandbox_launcher, "workspace_base")
                    else None
                ),
            )
            design = AgentDesignIntelligence(
                provider=self.provider,
                composer=composer,
                evidence_repository=self.evidence_repository,
            )
            artifact = FileSetArtifactProduction(
                data_root=self.data_root,
                product_store=self.product_store,
                file_sets=self.file_sets,
                composer=composer,
                renderer=self.renderer,
                evidence_repository=self.evidence_repository,
            )
        else:
            composer = None
            design = self.control.design
            artifact = self.control.artifact
        quality = ModelAwareWebQualityPort(self.product_store)
        self.control.design = design
        self.control.artifact = artifact
        self.control.quality = quality
        self.quality_checks = quality
        self.bindings = Phase6Bindings(
            design=design,
            artifact=artifact,
            quality=quality,
            delivery=self.delivery_validation,
            repository_ingestion=self.repository_ingestion,
            agent=self.agent_engine,
            renderer=self.renderer,
            builder=self.framework_builder,
        )
        self.readiness = assess_phase6_readiness(self.profile, self.bindings)
        self.control.capability_versions = dict(self.bindings.capability_versions())
        self.composer = composer
        self.images = ProductImageService(self, self.data_root)
        self.intake = KimiIntake(
            provider=self.provider,
            image_service=self.images,
            app=self,
            product_store=self.product_store,
        )
        self.jobs = AgentJobRunner(self.product_store)
        self.jobs.register("intake-design", self._run_intake_design)
        self.jobs.register("revision", self._run_revision)
        self._close_lock = threading.Lock()
        self._close_started = False
        self._base_closed = False
        self._deferred_closer: threading.Thread | None = None

    @property
    def product_readiness(self) -> ProductReadiness:
        blockers: list[str] = []
        settings = self.provider.settings()
        readiness = assess_phase6_readiness(self.profile, self.bindings)
        self.readiness = readiness
        self.control.capability_versions = dict(self.bindings.capability_versions())
        if os.name != "nt" or not self.sandbox_launcher.available:
            blockers.append("Windows AppContainer is required")
        if not self.framework_builder.ready_for_p6:
            blockers.append("Frozen framework dependency image is unavailable")
        elif not _dependency_manifests_ready(self.framework_builder.dependency_image):
            blockers.append("Frozen dependency manifests are unavailable or invalid")
        if not self.renderer.ready_for_p6:
            blockers.append("System Chrome or Playwright is unavailable")
        if (
            not settings.credential_configured
            or not settings.base_url
            or not settings.model
        ):
            blockers.append("Kimi provider is not configured and probed")
        if readiness.missing:
            blockers.append(
                "Production capability slots missing: "
                + ", ".join(readiness.missing)
            )
        design_version = readiness.version_for("design.intelligence")
        if design_version != "agent-design-compose/1":
            blockers.append("Agent-backed Design Intelligence is unavailable")
        return ProductReadiness(
            not blockers,
            tuple(blockers),
            MappingProxyType(dict(readiness.versions)),
            settings,
        )

    def require_product_ready(self) -> None:
        readiness = self.product_readiness
        if not readiness.ready:
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Web MVP is not ready: " + "; ".join(readiness.blockers),
            )

    def create_empty_project(
        self, *, command_id: str, name: str, project_id: str | None = None
    ):
        return self.control.execute(
            CreateProject(
                command_id=command_id,
                project_id=project_id,
                name=name,
            )
        )

    def submit_message(
        self,
        *,
        project_id: str,
        client_message_id: str,
        expected_revision: int,
        text: str,
        target_id: str | None = None,
        target_revision: int | None = None,
        object_ref: str | None = None,
    ) -> AgentJob:
        idempotency_key = f"message:{project_id}:{client_message_id}"
        existing_job = self.product_store.message_job(project_id, client_message_id)
        if existing_job is None:
            existing_job = next(
                (
                    item
                    for item in self.product_store.list_jobs(project_id)
                    if item.idempotency_key == idempotency_key
                ),
                None,
            )
        if existing_job is not None:
            existing_message = next(
                (
                    item
                    for item in self.product_store.list_messages(project_id)
                    if item.client_message_id == client_message_id
                ),
                None,
            )
            if existing_message is None or (
                existing_message.text != text.strip()
                or existing_message.target_id != target_id
                or existing_message.target_revision != target_revision
                or existing_message.object_ref != object_ref
            ):
                raise ContractError(
                    ErrorCategory.DETERMINISTIC_FAILURE,
                    "client_message_id was reused with different feedback",
                )
            return existing_job
        self.require_product_ready()
        project = self.repository.get(project_id)
        if project.revision != expected_revision:
            raise ContractError(
                ErrorCategory.STALE_REVISION,
                "Project revision changed",
                current_revision=project.revision,
            )
        if not text.strip() or len(text) > 8_000:
            raise ValueError("Message text is invalid")
        if bool(target_id) != (target_revision is not None):
            raise ValueError("target_id and target_revision must be provided together")
        if object_ref and not target_id:
            raise ValueError("object_ref requires an explicit revision target")
        if target_id and target_revision is not None:
            target_kind = "candidate"
            current_revision = None
            if project.current_artifact is not None and (
                project.current_artifact.id == target_id
            ):
                target_kind = "artifact"
                current_revision = project.current_artifact.revision
            elif target_id in project.candidates:
                current_revision = project.candidates[target_id].revision
            if current_revision is None or current_revision != target_revision:
                raise ContractError(
                    ErrorCategory.STALE_REVISION,
                    "Feedback target revision changed",
                    current_revision=current_revision or project.revision,
                )
            if object_ref:
                file_set = self.product_store.file_set_for(
                    target_kind, target_id, target_revision
                )
                render = {} if file_set is None else file_set.metadata.get("render", {})
                metrics = (
                    render.get("dom_metrics", {})
                    if isinstance(render, Mapping)
                    else {}
                )
                anchors = (
                    metrics.get("object_anchors", ())
                    if isinstance(metrics, Mapping)
                    else ()
                )
                if object_ref not in anchors:
                    raise ContractError(
                        ErrorCategory.STALE_REVISION,
                        "Selected preview object is unavailable on this revision",
                        current_revision=current_revision,
                    )
        resume_job = None
        if project.state is ProjectState.NEEDS_INPUT:
            intake_jobs = tuple(
                item
                for item in self.product_store.list_jobs(project_id)
                if item.kind == "intake-design"
                and item.status.value in {"PAUSED", "QUEUED", "RUNNING"}
            )
            if intake_jobs:
                resume_job = intake_jobs[-1]
        message = ProductMessage(
            stable_id("message", project_id, client_message_id),
            project_id,
            ProductMessageRole.USER,
            text.strip(),
            client_message_id,
            None if resume_job is None else resume_job.id,
            target_id,
            target_revision,
            object_ref,
        )
        if resume_job is not None:
            self.product_store.add_message_for_existing_job(message, resume_job.id)
            if resume_job.status.value == "PAUSED":
                return self.jobs.resume(resume_job.id)
            return resume_job
        kind = (
            "intake-design"
            if project.state in {ProjectState.NEW, ProjectState.NEEDS_INPUT}
            else "revision"
        )
        _saved, job = self.product_store.add_message_and_create_job(
            message,
            kind=kind,
            idempotency_key=idempotency_key,
            input={"message_id": message.id},
        )
        self.product_store.append_activity(
            project_id=job.project_id, job_id=job.id, type="job", stage="queued",
            summary="Agent job queued", details={"kind": job.kind},
        )
        self.jobs.wake()
        return job

    def _run_intake_design(
        self, job: AgentJob, control: JobControl
    ) -> Mapping[str, Any]:
        control.checkpoint("intake")
        control.activity("model", "Analyzing the request")
        self.intake.activity_reporter = control.activity
        try:
            decision = self.intake.decide(job.project_id)
        finally:
            self.intake.activity_reporter = None
        control.add_usage(
            steps=1,
            total_tokens=sum(int(value) for value in self.intake.last_usage.values()),
            renders=0,
        )
        self._save_image_analyses(job.project_id, decision)
        project = self.repository.get(job.project_id)
        context_revision = (
            1
            if project.context_package is None
            else project.context_package.revision + 1
        )
        source_refs = tuple(
            source.id
            for source in self.evidence_repository.list_sources(job.project_id)
        )
        context = ContextPackage(
            stable_id("context", job.project_id, project.revision, decision),
            job.project_id,
            context_revision,
            decision.confirmed_facts,
            source_refs,
            decision.material_uncertainties,
            metadata={
                "content_priorities": decision.content_priorities,
                "style_intent": decision.style_intent,
                "constraints": decision.constraints,
                "intake_capability": self.intake.capability_version,
            },
        )
        brief = (
            DesignBrief(decision.goal, decision.audience, "web")
            if decision.status == "READY"
            else None
        )
        if decision.status == "NEEDS_INPUT":
            context = ContextPackage(
                context.id,
                context.project_id,
                context.revision,
                context.confirmed_facts,
                context.source_refs,
                decision.material_uncertainties or ("clarification-required",),
                metadata=context.metadata,
            )
        self.evidence_repository.save_context(context)
        self.control.execute(
            PrepareProject(
                command_id=f"{job.id}:prepare:{context_revision}",
                project_id=job.project_id,
                expected_project_revision=project.revision,
                context_package=context,
                brief=brief,
            )
        )
        if decision.status == "NEEDS_INPUT":
            question = decision.question or "What material requirement is missing?"
            self.product_store.add_message(
                ProductMessage(
                    stable_id("message", job.id, "question"),
                    job.project_id,
                    ProductMessageRole.ASSISTANT,
                    question,
                    None,
                    job.id,
                )
            )
            control.wait_for_input()
        control.checkpoint("generate-candidates")
        prepared = self.repository.get(job.project_id)
        if self.composer is not None:
            self.composer.boundary_check = control.checkpoint
            self.composer.activity_reporter = control.activity
        try:
            try:
                result = self.control.execute(
                    GenerateCandidates(
                        command_id=f"{job.id}:generate",
                        project_id=job.project_id,
                        expected_project_revision=prepared.revision,
                        candidate_count=2,
                    )
                )
            except ContractError as exc:
                if exc.category is not ErrorCategory.NEEDS_INPUT:
                    raise
                return self._request_direction(
                    job,
                    "The visual gate could not resolve this direction within two "
                    "repairs. What should the next attempt emphasize or avoid?",
                )
        finally:
            if self.composer is not None:
                self.composer.boundary_check = None
                self.composer.activity_reporter = None
        budgets = tuple(
            file_set.metadata.get("budget", {})
            for candidate in result.value
            if (
                file_set := self.product_store.file_set_for(
                    "candidate", candidate.id, candidate.revision
                )
            )
            is not None
        )
        control.add_usage(
            steps=sum(int(value.get("steps", 0)) for value in budgets),
            total_tokens=sum(int(value.get("total_tokens", 0)) for value in budgets),
            renders=sum(int(value.get("renders", 0)) for value in budgets),
        )
        self.product_store.add_message(
            ProductMessage(
                stable_id("message", job.id, "complete"),
                job.project_id,
                ProductMessageRole.ASSISTANT,
                "I created two distinct, rendered design directions for review.",
                None,
                job.id,
            )
        )
        return {
            "needs_input": False,
            "candidate_ids": [candidate.id for candidate in result.value],
        }

    def _run_revision(
        self, job: AgentJob, control: JobControl
    ) -> Mapping[str, Any]:
        control.checkpoint("revision")
        control.activity("model", "Understanding the requested revision")
        message_id = str(job.input.get("message_id", ""))
        message = next(
            (
                item
                for item in self.product_store.list_messages(job.project_id)
                if item.id == message_id
            ),
            None,
        )
        if message is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE, "Revision message is missing"
            )
        follow_ups = tuple(
            item.text
            for item in self.product_store.list_messages(job.project_id)
            if item.role is ProductMessageRole.USER
            and item.run_id == job.id
            and item.id != message.id
        )
        feedback_text = "\n\n".join((message.text, *follow_ups))
        project = self.repository.get(job.project_id)
        if message.target_id and message.target_revision:
            target_id = message.target_id
            target_revision = message.target_revision
        elif project.current_artifact is not None:
            target_id = project.current_artifact.id
            target_revision = project.current_artifact.revision
        else:
            candidate = next(iter(project.candidates.values()), None)
            if candidate is None:
                raise ContractError(
                    ErrorCategory.INVALID_TRANSITION,
                    "No candidate or artifact is available for revision",
                )
            target_id = candidate.id
            target_revision = candidate.revision
        kind = (
            FeedbackKind.ARTIFACT_LOCAL
            if project.current_artifact is not None
            else FeedbackKind.DIRECTION
        )
        if self.composer is not None:
            self.composer.boundary_check = control.checkpoint
            self.composer.activity_reporter = control.activity
        try:
            try:
                result = self.control.execute(
                    SubmitFeedback(
                        command_id=f"{job.id}:feedback",
                        project_id=job.project_id,
                        expected_project_revision=project.revision,
                        kind=kind,
                        target_id=target_id,
                        target_revision=target_revision,
                        text=feedback_text,
                        object_ref=message.object_ref,
                    )
                )
            except ContractError as exc:
                if exc.category is not ErrorCategory.NEEDS_INPUT:
                    raise
                return self._request_direction(
                    job,
                    "The revised design still does not pass the visual gate. What "
                    "specific direction should the next revision emphasize?",
                )
        finally:
            if self.composer is not None:
                self.composer.boundary_check = None
                self.composer.activity_reporter = None
        owner_kind = "artifact" if kind is FeedbackKind.ARTIFACT_LOCAL else "candidate"
        file_set = self.product_store.file_set_for(
            owner_kind, result.value.id, result.value.revision
        )
        if file_set is not None:
            budget = file_set.metadata.get("budget", {})
            control.add_usage(
                steps=int(budget.get("steps", 0)),
                total_tokens=int(budget.get("total_tokens", 0)),
                renders=int(budget.get("renders", 0)),
            )
        project = self.repository.get(job.project_id)
        quality_id = None
        if kind is FeedbackKind.ARTIFACT_LOCAL:
            control.checkpoint("validate-revision")
            decision = self.control.execute(
                ValidateArtifact(
                    command_id=f"{job.id}:validate",
                    project_id=job.project_id,
                    expected_project_revision=project.revision,
                    render_profile={"width": 1440, "height": 1000},
                )
            ).value
            quality_id = decision.id
        self.product_store.add_message(
            ProductMessage(
                stable_id("message", job.id, "revision-complete"),
                job.project_id,
                ProductMessageRole.ASSISTANT,
                "The requested revision was rebuilt, rendered, and reviewed.",
                None,
                job.id,
                result.value.id,
                result.value.revision,
                message.object_ref,
            )
        )
        return {
            "target_id": result.value.id,
            "target_revision": result.value.revision,
            "quality_id": quality_id,
        }

    def _request_direction(
        self, job: AgentJob, question: str
    ) -> Mapping[str, Any]:
        project = self.repository.get(job.project_id)
        context = project.context_package
        self.control.execute(
            SubmitFeedback(
                command_id=f"{job.id}:visual-needs-input:{project.revision}",
                project_id=job.project_id,
                expected_project_revision=project.revision,
                kind=FeedbackKind.FACT_OR_POLICY,
                target_id=context.id if context else project.id,
                target_revision=context.revision if context else project.revision,
                text="Model visual gate requires additional user direction.",
            )
        )
        self.product_store.add_message(
            ProductMessage(
                stable_id("message", job.id, "visual-needs-input", project.revision),
                job.project_id,
                ProductMessageRole.ASSISTANT,
                question,
                None,
                job.id,
            )
        )
        return {"needs_input": True, "question": question}

    def _save_image_analyses(self, project_id: str, decision: IntakeDecision) -> None:
        sources = {
            source.id: source
            for source in self.evidence_repository.list_sources(project_id)
        }
        records: list[EvidenceRecord] = []
        for analysis in decision.image_analyses:
            source = sources.get(analysis.source_id)
            if source is None or source.kind is not SourceKind.IMAGE:
                continue
            locator = SourceLocator(
                source.id, source.revision, {"region": "whole-image"}
            )
            records.append(
                EvidenceRecord(
                    stable_id("evidence", source.id, "intake", analysis),
                    project_id,
                    1,
                    EvidenceLayer.MACHINE_INTERPRETATION,
                    "image.design-analysis",
                    {
                        "content": analysis.content,
                        "composition": analysis.composition,
                        "color": analysis.color,
                        "typography": analysis.typography,
                        "transferable_features": analysis.transferable_features,
                        "forbidden_copy": analysis.forbidden_copy,
                    },
                    locator,
                    analysis.confidence,
                    (),
                    source.rights,
                    self.intake.capability_version,
                )
            )
        if records:
            self.evidence_repository.add_evidence(tuple(records))

    def close(self) -> bool:
        """Stop work without ever closing SQLite under an active worker.

        A provider request is not force-killed mid-flight.  When it outlives the
        short cooperative shutdown window, a daemon closer retains the application
        and its SQLite connection until the worker reaches the next checkpoint.
        """

        with self._close_lock:
            if self._close_started:
                return self._base_closed
            self._close_started = True
        stopped = not hasattr(self, "jobs") or self.jobs.close()
        if stopped:
            self._close_base()
            return True
        closer = threading.Thread(
            target=self._wait_and_close_base,
            name="oeydesign-deferred-close",
            daemon=True,
        )
        with self._close_lock:
            self._deferred_closer = closer
        closer.start()
        return False

    def wait_closed(self, timeout: float | None = None) -> bool:
        """Wait for a deferred cooperative close, primarily for runtime owners."""

        with self._close_lock:
            closer = self._deferred_closer
            closed = self._base_closed
        if closed:
            return True
        if closer is None:
            return False
        closer.join(timeout=timeout)
        with self._close_lock:
            return self._base_closed

    def _wait_and_close_base(self) -> None:
        self.jobs.wait()
        self._close_base()

    def _close_base(self) -> None:
        with self._close_lock:
            if self._base_closed:
                return
            self._base_closed = True
        try:
            super().close()
        finally:
            if self._instance_lock_finalizer is not None:
                self._instance_lock_finalizer()


def parse_intake_decision(content: str) -> IntakeDecision:
    candidate = content.strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            candidate = "\n".join(lines[1:-1]).strip()
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise ContractError(ErrorCategory.RETRYABLE, "Intake JSON is invalid") from exc
    if not isinstance(value, Mapping):
        raise ContractError(ErrorCategory.RETRYABLE, "Intake result must be an object")
    status = str(value.get("status", "")).upper()
    if status not in {"READY", "NEEDS_INPUT"}:
        raise ContractError(ErrorCategory.RETRYABLE, "Intake status is invalid")
    question = value.get("question")
    if status == "NEEDS_INPUT" and (
        not isinstance(question, str) or not question.strip()
    ):
        raise ContractError(
            ErrorCategory.RETRYABLE, "Intake must ask one clarification question"
        )
    analyses_raw = value.get("image_analyses", [])
    if not isinstance(analyses_raw, list):
        raise ContractError(ErrorCategory.RETRYABLE, "Image analyses are invalid")
    analyses = tuple(_image_analysis(item) for item in analyses_raw)
    return IntakeDecision(
        status,
        question.strip() if isinstance(question, str) else None,
        str(value.get("goal", "")).strip(),
        str(value.get("audience", "")).strip(),
        "web",
        _text_tuple(value.get("content_priorities", [])),
        _text_tuple(value.get("style_intent", [])),
        _text_tuple(value.get("constraints", [])),
        _text_tuple(value.get("confirmed_facts", [])),
        _text_tuple(value.get("material_uncertainties", [])),
        analyses,
    )


def _image_analysis(value: Any) -> ImageAnalysis:
    if not isinstance(value, Mapping):
        raise ContractError(ErrorCategory.RETRYABLE, "Image analysis is invalid")
    try:
        confidence = float(value.get("confidence", 0))
    except (TypeError, ValueError) as exc:
        raise ContractError(
            ErrorCategory.RETRYABLE, "Image confidence is invalid"
        ) from exc
    if not 0 <= confidence <= 1:
        raise ContractError(ErrorCategory.RETRYABLE, "Image confidence is invalid")
    return ImageAnalysis(
        str(value.get("source_id", "")),
        str(value.get("content", "")),
        str(value.get("composition", "")),
        str(value.get("color", "")),
        str(value.get("typography", "")),
        _text_tuple(value.get("transferable_features", [])),
        _text_tuple(value.get("forbidden_copy", [])),
        confidence,
    )


def _text_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        raise ContractError(ErrorCategory.RETRYABLE, "Intake list is invalid")
    return tuple(
        str(item).strip()
        for item in value[:100]
        if isinstance(item, str) and item.strip()
    )


def _decode_image(payload: bytes) -> tuple[int, int, str]:
    if not payload or len(payload) > ProductImageService.max_image_bytes:
        raise ContractError(ErrorCategory.POLICY_BLOCKED, "Image payload is invalid")
    try:
        from PIL import Image, UnidentifiedImageError
        from PIL.Image import DecompressionBombError, DecompressionBombWarning
    except ImportError as exc:
        raise ContractError(
            ErrorCategory.CAPABILITY_UNAVAILABLE,
            "Pillow is required for reference images",
        ) from exc
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as image:
                width, height = image.size
                format_name = image.format
                if width * height > ProductImageService.max_pixels:
                    raise DecompressionBombError("image dimensions exceed limit")
                image.verify()
            with Image.open(io.BytesIO(payload)) as image:
                image.load()
    except (
        UnidentifiedImageError,
        DecompressionBombError,
        DecompressionBombWarning,
        OSError,
    ) as exc:
        raise ContractError(
            ErrorCategory.POLICY_BLOCKED, "Reference image cannot be safely decoded"
        ) from exc
    media = {"PNG": "image/png", "JPEG": "image/jpeg"}.get(str(format_name))
    if media is None or width < 1 or height < 1:
        raise ContractError(ErrorCategory.POLICY_BLOCKED, "Image format is unsupported")
    return width, height, media


def _dependency_manifests_ready(dependency_image: Path | None) -> bool:
    if dependency_image is None:
        return False
    root = Path(dependency_image).resolve()
    package = root.parent / "package.json"
    lock = root.parent / "package-lock.json"
    executable = root / "@esbuild" / "win32-x64" / "esbuild.exe"
    if not package.is_file() or not lock.is_file() or not executable.is_file():
        return False
    try:
        package_json = json.loads(package.read_text(encoding="utf-8"))
        lock_json = json.loads(lock.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    dependencies = package_json.get("dependencies", {})
    required = {
        "react": "19.1.1",
        "react-dom": "19.1.1",
        "@mui/material": "7.3.1",
        "@emotion/styled": "11.14.1",
        "esbuild": "0.25.12",
    }
    if not isinstance(dependencies, Mapping) or not isinstance(lock_json, Mapping):
        return False
    lock_packages = lock_json.get("packages", {})
    if not isinstance(lock_packages, Mapping):
        return False
    for name, version in required.items():
        installed_manifest = root / Path(name) / "package.json"
        try:
            installed = json.loads(installed_manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False
        locked = lock_packages.get(f"node_modules/{name}", {})
        if (
            dependencies.get(name) != version
            or not isinstance(locked, Mapping)
            or locked.get("version") != version
            or not isinstance(installed, Mapping)
            or installed.get("version") != version
        ):
            return False
    return bool(hashlib.sha256(lock.read_bytes()).hexdigest())


def _stream_progress(reporter: Any | None, summary: str):
    """Emit throttled provider progress while discarding all model text."""

    chunks = 0
    byte_count = 0
    last_report = 0.0

    def report(chunk: str) -> None:
        nonlocal chunks, byte_count, last_report
        chunks += 1
        byte_count += len(chunk.encode("utf-8"))
        now = time.monotonic()
        if reporter is None or (chunks != 1 and now - last_report < 0.4):
            return
        last_report = now
        reporter(
            "stream",
            summary,
            details={
                "chunks": chunks,
                "bytes_received": byte_count,
                "status": "receiving",
            },
        )

    return report


def _repository_intake_file(path: str, byte_size: int) -> bool:
    name = Path(path).name.casefold()
    return bool(
        byte_size <= 100_000
        and (
            name.startswith("readme")
            or name
            in {
                "package.json",
                "pyproject.toml",
                "cargo.toml",
                "go.mod",
                "composer.json",
            }
        )
    )
