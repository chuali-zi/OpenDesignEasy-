"""Model-backed Web design, visual review, and file-set artifact production."""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
import time
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from types import MappingProxyType
from typing import Any, Protocol

from .agent_engine import (
    AgentBudget,
    AgentLoop,
    AgentSessionManager,
    AgentWorkspace,
    WorkspaceManager,
    WorkspaceScope,
)
from .builder import NativeEsbuildBuilder
from .capabilities import CapabilityClient, stream_callback_options
from .domain import (
    Approval,
    ApprovedDirection,
    ArtifactRevision,
    Candidate,
    ConstraintProfile,
    ContextPackage,
    ContractError,
    DesignBrief,
    DesignStrategy,
    ErrorCategory,
    ExportCandidate,
    FeedbackRecord,
    Finding,
    FindingKind,
    GateVerdict,
    Lineage,
    QualityDecision,
    RenderBundle,
    WorkflowRun,
    canonical_json,
    stable_id,
)
from .framework_artifact import FrameworkArtifactContract
from .product import ArtifactFileSet, ArtifactFileSetStore, ProductStore
from .quality import WebQualityPort
from .renderer import RenderProfile, TrustedWebRenderer

THEME_TOKENS = MappingProxyType(
    {
        "background": "#F0EEE7",
        "foreground": "#171916",
        "accent": "#D65A32",
        "border": "#BDB8AB",
        "muted": "#6C6A63",
        "focus": "#FFF2C7",
    }
)


@dataclass(frozen=True, slots=True)
class DesignTerritory:
    name: str
    visual_thesis: str
    information_hierarchy: str
    layout_strategy: str
    typography_strategy: str
    palette_roles: Mapping[str, str]
    interaction_emphasis: str
    repository_facts: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DesignTerritoryPlan:
    territories: tuple[DesignTerritory, ...]


@dataclass(frozen=True, slots=True)
class VisualReview:
    verdict: GateVerdict
    scores: Mapping[str, int]
    findings: tuple[Mapping[str, Any], ...]
    repair_instructions: tuple[str, ...]

    @property
    def passes(self) -> bool:
        values = tuple(self.scores.values())
        critical = any(
            str(finding.get("severity", "")).casefold() == "critical"
            for finding in self.findings
        )
        return bool(
            self.verdict is GateVerdict.PASS
            and len(values) == 6
            and min(values) >= 3
            and sum(values) / len(values) >= 4
            and not critical
        )


class ProviderResolverPort(Protocol):
    def require(self) -> tuple[CapabilityClient, str]: ...


class VisualQualityReviewPort(Protocol):
    capability_version: str

    def review(
        self,
        screenshot: bytes,
        *,
        brief: DesignBrief,
        territory: DesignTerritory,
    ) -> VisualReview: ...


class KimiVisualQualityReview:
    capability_version = "kimi-visual-quality/1"

    def __init__(self, provider: ProviderResolverPort) -> None:
        self.provider = provider
        self.activity_reporter: Any | None = None

    def review(
        self,
        screenshot: bytes,
        *,
        brief: DesignBrief,
        territory: DesignTerritory,
    ) -> VisualReview:
        client, model = self.provider.require()
        encoded = base64.b64encode(screenshot).decode("ascii")
        progress = _stream_progress(
            self.activity_reporter, "Kimi is reviewing the rendered design"
        )
        response = client.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "You are the production visual quality gate. Return only "
                        "JSON with verdict PASS, REPAIR, or BLOCK; scores for exactly "
                        "hierarchy, composition, typography, color, goal_fit, and "
                        "originality as integers 1-5; findings as objects with "
                        "severity and message; and repair_instructions as strings. "
                        "PASS only when every score is at least 3, the average is at "
                        "least 4, and there is no critical finding."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": canonical_json(
                                {
                                    "goal": brief.goal,
                                    "audience": brief.audience,
                                    "territory": _territory_document(territory),
                                }
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": "data:image/png;base64," + encoded},
                        },
                    ],
                },
            ],
            model=model,
            max_tokens=4_000,
            temperature=0.2,
            stream=True,
            **stream_callback_options(client, progress),
        )
        return parse_visual_review(response.content)


class AgentComposer:
    """Own candidate workspaces and enforce build/render/review completion."""

    def __init__(
        self,
        *,
        data_root: str | Path,
        dependency_image: str | Path,
        provider: ProviderResolverPort,
        builder: NativeEsbuildBuilder,
        renderer: TrustedWebRenderer,
        file_sets: ArtifactFileSetStore,
        visual_quality: VisualQualityReviewPort,
        repository_reader: Any,
        sandbox_launcher: Any,
        workspace_root: str | Path | None,
    ) -> None:
        self.data_root = Path(data_root).resolve()
        self.dependency_image = Path(dependency_image).resolve()
        self.provider = provider
        self.builder = builder
        self.renderer = renderer
        self.file_sets = file_sets
        self.visual_quality = visual_quality
        self.repository_reader = repository_reader
        self.sandbox = sandbox_launcher
        self.workspaces = WorkspaceManager(
            self.data_root,
            repository_reader=repository_reader,
            workspace_root=workspace_root,
        )
        self.sessions = AgentSessionManager()
        self.contract = FrameworkArtifactContract()
        self.boundary_check: Any | None = None
        self.activity_reporter: Any | None = None

    @property
    def ready(self) -> bool:
        return bool(self.builder.ready_for_p6 and self.dependency_image.is_dir())

    def create(
        self,
        *,
        project_id: str,
        owner_kind: str,
        owner_id: str,
        owner_revision: int,
        goal: str,
        brief: DesignBrief,
        territory: DesignTerritory,
        context: ContextPackage,
        repository: Any | None,
        base_file_set: ArtifactFileSet | None = None,
        object_ref: str | None = None,
    ) -> tuple[ArtifactFileSet, VisualReview, Mapping[str, Any]]:
        existing = self.file_sets.repository.file_set_for(
            owner_kind, owner_id, owner_revision
        )
        if existing is not None:
            review = _visual_review_from_mapping(existing.metadata.get("visual_review"))
            return existing, review, existing.metadata
        client, model = self.provider.require()
        workspace_id = f"{owner_kind}-{owner_id}-r{owner_revision}"
        workspace = self.workspaces.open(
            project_id, workspace_id, repository=repository
        )
        self._seed(workspace, base_file_set)
        session_id = stable_id("agent-session", project_id, workspace_id)
        try:
            session = self.sessions.load(workspace, session_id)
            if session.status not in {"RUNNING", "PAUSED", "RETRY_WAIT"}:
                session_id += "-retry"
                raise FileNotFoundError
        except (ContractError, FileNotFoundError):
            self.sessions.start(
                workspace,
                session_id=session_id,
                stage="compose",
                budget=AgentBudget(
                    max_steps=20,
                    max_total_tokens=85_000,
                    max_seconds=300,
                    max_renders=1,
                ),
                capability_version="agent-design-session/1",
            )

        def build_action(active: AgentWorkspace):
            if self.activity_reporter:
                self.activity_reporter(
                    "tool",
                    "Building the web application",
                    details={"tool": "run_build"},
                )
            files = _workspace_source_files(active)
            plan = self.contract.prepare(
                files,
                lockfile=files["package-lock.json"],
                theme_tokens=THEME_TOKENS,
            )
            return self.builder.build(plan, active)

        context_summary = {
            "confirmed_facts": list(context.confirmed_facts)[:40],
            "material_uncertainties": list(context.material_uncertainties),
            "source_refs": list(context.source_refs),
            "territory": _territory_document(territory),
            "object_ref": object_ref,
            "constraints": (
                "Keep every data-oey-object identity stable. Do not use network "
                "resources, base64 assets, inline fake data, or analysis-only images."
            ),
        }
        loop = AgentLoop(
            client,
            renderer=self.renderer,
            session_manager=self.sessions,
            sandbox_launcher=self.sandbox,
            build_action=build_action,
            allowed_tools=frozenset(
                {
                    "list_files",
                    "read_file",
                    "read_repo",
                    "write_file",
                    "delete_file",
                    "run_build",
                    "render",
                    "complete",
                }
            ),
            boundary_check=self.boundary_check,
            activity_reporter=self.activity_reporter,
        )
        if self.activity_reporter:
            self.activity_reporter("agent", "Composing a design direction")
        result = loop.run(
            workspace,
            session_id,
            goal=goal,
            model=model,
            context=context_summary,
            max_tokens=32_000,
            temperature=0.9,
        )
        total_steps = result.session.budget.steps
        total_tokens = result.session.budget.total_tokens
        total_renders = result.session.budget.renders
        total_elapsed = result.session.budget.elapsed_seconds
        if not result.completed or result.last_render_healthy is not True:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Agent did not complete a healthy rendered candidate",
            )
        render = loop.last_render_result
        if render is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Agent completed without trusted render evidence",
            )
        _require_healthy_render(render)
        if self.activity_reporter:
            self.activity_reporter(
                "render", "Rendered design direction",
                details={"healthy": True, "render": "trusted"},
            )
        screenshot = Path(str(render.screenshot_path)).read_bytes()
        review = self._review(screenshot, brief=brief, territory=territory)
        if self.activity_reporter:
            self.activity_reporter(
                "quality", "Reviewed visual quality",
                details={"verdict": review.verdict.value},
            )
        repair_round = 0
        while not review.passes and review.verdict is GateVerdict.REPAIR:
            repair_round += 1
            if repair_round > 2:
                break
            repair_id = stable_id(
                "repair-session", session_id, repair_round, review.repair_instructions
            )
            self.sessions.start(
                workspace,
                session_id=repair_id,
                stage="visual-repair",
                budget=AgentBudget(
                    max_steps=5,
                    max_total_tokens=20_000,
                    max_seconds=75,
                    max_renders=1,
                ),
                capability_version="agent-visual-repair/1",
            )
            repair_loop = AgentLoop(
                client,
                renderer=self.renderer,
                session_manager=self.sessions,
                sandbox_launcher=self.sandbox,
                build_action=build_action,
                allowed_tools=frozenset(
                    {
                        "read_file",
                        "write_file",
                        "run_build",
                        "render",
                        "complete",
                    }
                ),
                boundary_check=self.boundary_check,
                activity_reporter=self.activity_reporter,
            )
            repair = repair_loop.run(
                workspace,
                repair_id,
                goal=(
                    "Repair the existing design without replacing its territory or "
                    "stable data-oey identities. Apply these review instructions: "
                    + " | ".join(review.repair_instructions)
                ),
                model=model,
                context=context_summary,
                max_tokens=24_000,
                temperature=0.5,
            )
            total_steps += repair.session.budget.steps
            total_tokens += repair.session.budget.total_tokens
            total_renders += repair.session.budget.renders
            total_elapsed += repair.session.budget.elapsed_seconds
            if not repair.completed:
                break
            render = repair_loop.last_render_result
            if render is None:
                break
            _require_healthy_render(render)
            if self.activity_reporter:
                self.activity_reporter(
                    "render", "Rendered visual repair",
                    details={
                        "healthy": True,
                        "render": "trusted",
                        "repair_round": repair_round,
                    },
                )
            screenshot = Path(str(render.screenshot_path)).read_bytes()
            review = self._review(screenshot, brief=brief, territory=territory)
            if self.activity_reporter:
                self.activity_reporter(
                    "quality", "Reviewed visual repair",
                    details={
                        "verdict": review.verdict.value,
                        "repair_round": repair_round,
                    },
                )
        if not review.passes:
            raise ContractError(
                ErrorCategory.NEEDS_INPUT,
                "Visual review requires user direction after two repair rounds",
            )
        source = _workspace_source_bytes(workspace)
        dist = _workspace_dist_bytes(workspace)
        metrics = dict(render.dom_metrics)
        metadata = {
            "session_id": session_id,
            "territory": _territory_document(territory),
            "visual_review": _visual_review_document(review),
            "render": {
                "healthy": render.healthy,
                "screenshot_path": render.screenshot_path,
                "screenshot_sha256": render.screenshot_sha256,
                "chrome_version": render.chrome_version,
                "dom_metrics": metrics,
                "console_errors": list(render.console_errors),
                "page_errors": list(render.page_errors),
                "failed_requests": list(render.failed_requests),
            },
            "budget": {
                "steps": total_steps,
                "total_tokens": total_tokens,
                "renders": total_renders,
                "elapsed_seconds": total_elapsed,
            },
        }
        file_set = self.file_sets.save(
            project_id=project_id,
            owner_kind=owner_kind,
            owner_id=owner_id,
            owner_revision=owner_revision,
            source=source,
            dist=dist,
            metadata=metadata,
        )
        return file_set, review, metadata

    def _review(
        self,
        screenshot: bytes,
        *,
        brief: DesignBrief,
        territory: DesignTerritory,
    ) -> VisualReview:
        if hasattr(self.visual_quality, "activity_reporter"):
            self.visual_quality.activity_reporter = self.activity_reporter
        return self.visual_quality.review(
            screenshot, brief=brief, territory=territory
        )

    def _seed(
        self, workspace: AgentWorkspace, base_file_set: ArtifactFileSet | None
    ) -> None:
        if base_file_set is not None:
            for name in base_file_set.source_files:
                workspace.write_file(
                    WorkspaceScope.WORK,
                    name,
                    self.file_sets.read(base_file_set, "source", name),
                )
            return
        parent = self.dependency_image.parent
        package_path = parent / "package.json"
        lock_path = parent / "package-lock.json"
        if not package_path.is_file() or not lock_path.is_file():
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Frozen dependency image requires sibling package manifests",
            )
        files = {
            "package.json": package_path.read_bytes(),
            "package-lock.json": lock_path.read_bytes(),
            "index.html": _INDEX_HTML.encode(),
            "src/main.jsx": _MAIN_JSX.encode(),
            "src/App.jsx": _APP_JSX.encode(),
        }
        for name, payload in files.items():
            workspace.write_file(WorkspaceScope.WORK, name, payload)


class AgentDesignIntelligence:
    capability_version = "agent-design-compose/1"
    p6_slot = "design.intelligence"

    def __init__(
        self,
        *,
        provider: ProviderResolverPort,
        composer: AgentComposer,
        evidence_repository: Any,
    ) -> None:
        self.provider = provider
        self.composer = composer
        self.evidence_repository = evidence_repository
        self._plans: dict[str, DesignTerritoryPlan] = {}

    @property
    def ready_for_p6(self) -> bool:
        try:
            self.provider.require()
        except ContractError:
            return False
        return self.composer.ready

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
        count = max(2, min(candidate_count, 2))
        strategy = DesignStrategy(
            stable_id(
                "strategy", context.id, brief, constraints, self.capability_version
            ),
            Lineage(context.project_id, run.id, self.capability_version),
            context.id,
            brief,
            constraints,
            count,
        )
        client, model = self.provider.require()
        progress = _stream_progress(
            self.composer.activity_reporter,
            "Kimi is shaping two distinct design territories",
        )
        response = client.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "Return only JSON with territories as an array of exactly two "
                        "visually distinct complete Web design directions. Each needs "
                        "name, visual_thesis, information_hierarchy, layout_strategy, "
                        "typography_strategy, palette_roles, interaction_emphasis, "
                        "and repository_facts. Do not use generic dashboard cards or "
                        "purple gradients."
                    ),
                },
                {
                    "role": "user",
                    "content": canonical_json(
                        {
                            "goal": brief.goal,
                            "audience": brief.audience,
                            "medium": brief.medium,
                            "facts": context.confirmed_facts,
                            "style_intent": context.metadata.get("style_intent", ()),
                        }
                    ),
                },
            ],
            model=model,
            max_tokens=6_000,
            temperature=0.9,
            stream=True,
            **stream_callback_options(client, progress),
        )
        self._plans[strategy.id] = parse_territory_plan(response.content)
        return strategy

    def create_candidates(
        self,
        strategy: DesignStrategy,
        context: ContextPackage,
        run: WorkflowRun,
    ) -> tuple[Candidate, ...]:
        plan = self._plans.get(strategy.id)
        if plan is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Design territory plan is unavailable",
            )
        repository = _repository_source(context, self.evidence_repository)
        candidates: list[Candidate] = []
        for index, territory in enumerate(plan.territories):
            candidate_id = stable_id("candidate", strategy.id, index)
            file_set, _review, metadata = self.composer.create(
                project_id=context.project_id,
                owner_kind="candidate",
                owner_id=candidate_id,
                owner_revision=1,
                goal=(
                    "Create a complete polished responsive Web experience for this "
                    f"brief: {strategy.brief.goal}. Implement territory "
                    f"{territory.name}: {territory.visual_thesis}. Read repository "
                    "facts when useful. Rewrite src/App.jsx. Preserve the frozen "
                    "manifests and index.html. Use at least four meaningful unique "
                    "data-oey-object anchors and two data-oey-section anchors. Build, "
                    "render the out scope index.html, inspect the screenshot, and "
                    "finish only when it is visually resolved."
                ),
                brief=strategy.brief,
                territory=territory,
                context=context,
                repository=repository,
            )
            actual_territory = _territory_from_mapping(metadata["territory"])
            preview = self.composer.file_sets.read(
                file_set, "dist", "index.html"
            ).decode("utf-8")
            candidates.append(
                Candidate(
                    candidate_id,
                    1,
                    None,
                    Lineage(context.project_id, run.id, self.capability_version),
                    actual_territory.name,
                    actual_territory.visual_thesis,
                    preview,
                    "agent-design-compose",
                    strategy.constraints.template_role,
                    strategy.constraints,
                    context.source_refs,
                )
            )
        if len(candidates) != 2:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Agent design must produce exactly two candidates",
            )
        return tuple(candidates)

    def revise_candidate(
        self,
        candidate: Candidate,
        feedback: FeedbackRecord,
        context: ContextPackage,
        run: WorkflowRun,
    ) -> Candidate:
        current = self.composer.file_sets.repository.file_set_for(
            "candidate", candidate.id, candidate.revision
        )
        if current is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Candidate source file set is unavailable",
            )
        territory = _territory_from_mapping(current.metadata["territory"])
        revised = replace(
            candidate,
            revision=candidate.revision + 1,
            parent_revision=candidate.revision,
            lineage=Lineage(context.project_id, run.id, self.capability_version),
            concept=f"{candidate.concept}; revision: {feedback.text}",
        )
        file_set, _review, _metadata = self.composer.create(
            project_id=context.project_id,
            owner_kind="candidate",
            owner_id=candidate.id,
            owner_revision=revised.revision,
            goal=(
                "Revise the existing candidate in response to this user feedback: "
                + feedback.text
            ),
            brief=DesignBrief("Revise approved brief", "Existing audience", "web"),
            territory=territory,
            context=context,
            repository=_repository_source(context, self.evidence_repository),
            base_file_set=current,
            object_ref=feedback.object_ref,
        )
        preview = self.composer.file_sets.read(file_set, "dist", "index.html").decode(
            "utf-8"
        )
        return replace(revised, preview_html=preview)

    def commit_direction(
        self, candidate: Candidate, approval: Approval, run: WorkflowRun
    ) -> ApprovedDirection:
        if (
            not approval.active
            or approval.target_id != candidate.id
            or approval.target_revision != candidate.revision
        ):
            raise ContractError(
                ErrorCategory.POLICY_BLOCKED,
                "Direction approval does not match candidate revision",
            )
        return ApprovedDirection(
            stable_id("direction", candidate.id, candidate.revision, approval.id),
            Lineage(candidate.lineage.project_id, run.id, self.capability_version),
            candidate.id,
            candidate.revision,
            approval.id,
            candidate.preview_html,
        )


class FileSetArtifactProduction:
    capability_version = "artifact-agent-fileset/1"
    p6_slot = "artifact.production"
    ready_for_p6 = True

    def __init__(
        self,
        *,
        data_root: str | Path,
        product_store: ProductStore,
        file_sets: ArtifactFileSetStore,
        composer: AgentComposer,
        renderer: TrustedWebRenderer,
        evidence_repository: Any,
    ) -> None:
        self.data_root = Path(data_root).resolve()
        self.product_store = product_store
        self.file_sets = file_sets
        self.composer = composer
        self.renderer = renderer
        self.evidence_repository = evidence_repository
        self.export_root = self.data_root / "product-exports"
        self.export_root.mkdir(parents=True, exist_ok=True)

    def materialize(
        self,
        direction: ApprovedDirection,
        *,
        medium: str,
        fidelity_mode: str,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> ArtifactRevision:
        del constraints
        if medium != "web":
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE, "Web MVP supports only Web"
            )
        source = self.product_store.file_set_for(
            "candidate", direction.candidate_id, direction.candidate_revision
        )
        if source is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Approved candidate file set is unavailable",
            )
        artifact_id = stable_id("artifact", direction.id, medium)
        self.file_sets.save(
            project_id=direction.lineage.project_id,
            owner_kind="artifact",
            owner_id=artifact_id,
            owner_revision=1,
            source={
                name: self.file_sets.read(source, "source", name)
                for name in source.source_files
            },
            dist={
                name: self.file_sets.read(source, "dist", name)
                for name in source.dist_files
            },
            metadata=source.metadata,
        )
        files = {
            f"source/{name}": self.file_sets.read(source, "source", name).decode(
                "utf-8"
            )
            for name in source.source_files
        }
        files.update(
            {
                f"dist/{name}": self.file_sets.read(source, "dist", name).decode(
                    "utf-8"
                )
                for name in source.dist_files
                if not name.startswith(".agent/")
            }
        )
        return ArtifactRevision(
            artifact_id,
            1,
            None,
            Lineage(direction.lineage.project_id, run.id, self.capability_version),
            direction.id,
            medium,
            fidelity_mode,
            files["dist/index.html"],
            {},
            ("Reference images were analysis-only and are not in this artifact.",),
            files,
        )

    def apply_artifact_change(
        self,
        artifact: ArtifactRevision,
        feedback: FeedbackRecord,
        run: WorkflowRun,
    ) -> ArtifactRevision:
        current = self.product_store.file_set_for(
            "artifact", artifact.id, artifact.revision
        )
        if current is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Artifact source file set is unavailable",
            )
        territory = _territory_from_mapping(current.metadata["territory"])
        context = ContextPackage(
            stable_id("revision-context", artifact.id, artifact.revision),
            artifact.lineage.project_id,
            artifact.revision,
            (),
            (),
        )
        revised = artifact.revision + 1
        file_set, _review, _metadata = self.composer.create(
            project_id=artifact.lineage.project_id,
            owner_kind="artifact",
            owner_id=artifact.id,
            owner_revision=revised,
            goal=(
                "Modify the existing artifact according to this user feedback: "
                + feedback.text
            ),
            brief=DesignBrief("Revise current artifact", "Existing audience", "web"),
            territory=territory,
            context=context,
            repository=None,
            base_file_set=current,
            object_ref=feedback.object_ref,
        )
        files = {
            f"source/{name}": self.file_sets.read(file_set, "source", name).decode(
                "utf-8"
            )
            for name in file_set.source_files
        }
        files.update(
            {
                f"dist/{name}": self.file_sets.read(file_set, "dist", name).decode(
                    "utf-8"
                )
                for name in file_set.dist_files
                if not name.startswith(".agent/")
            }
        )
        return replace(
            artifact,
            revision=revised,
            parent_revision=artifact.revision,
            lineage=Lineage(
                artifact.lineage.project_id, run.id, self.capability_version
            ),
            content=files["dist/index.html"],
            files=files,
        )

    def render_artifact(
        self,
        artifact: ArtifactRevision,
        render_profile: Mapping[str, Any],
        run: WorkflowRun,
    ) -> RenderBundle:
        file_set = self.product_store.file_set_for(
            "artifact", artifact.id, artifact.revision
        )
        if file_set is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE, "Artifact file set unavailable"
            )
        root = self._materialize_dist(file_set, "render")
        profile = RenderProfile(
            viewport_width=int(render_profile.get("width", 1440)),
            viewport_height=int(render_profile.get("height", 1000)),
        )
        result = self.renderer.render(root, profile=profile)
        _require_healthy_render(result)
        evidence = _render_evidence(result)
        evidence["trusted_render"] = True
        evidence["visual_review"] = dict(file_set.metadata["visual_review"])
        return RenderBundle(
            stable_id("render", artifact.id, artifact.revision, evidence),
            1,
            Lineage(artifact.lineage.project_id, run.id, self.capability_version),
            artifact.id,
            artifact.revision,
            artifact.content,
            evidence,
        )

    def export_artifact(
        self,
        artifact: ArtifactRevision,
        delivery_profile: Mapping[str, Any],
        run: WorkflowRun,
    ) -> ExportCandidate:
        from .artifact import _safe_unpack, _zip_payload

        file_set = self.product_store.file_set_for(
            "artifact", artifact.id, artifact.revision
        )
        if file_set is None:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE, "Artifact file set unavailable"
            )
        files: dict[str, str] = {}
        for name in file_set.source_files:
            files[f"source/{name}"] = self.file_sets.read(
                file_set, "source", name
            ).decode("utf-8")
        for name in file_set.dist_files:
            if not name.startswith(".agent/"):
                files[f"dist/{name}"] = self.file_sets.read(
                    file_set, "dist", name
                ).decode("utf-8")
        manifest = {
            "version": 1,
            "project_id": artifact.lineage.project_id,
            "artifact_id": artifact.id,
            "artifact_revision": artifact.revision,
            "capability_versions": {
                "design.intelligence": "agent-design-compose/1",
                "artifact.production": self.capability_version,
                "framework.build": self.composer.builder.capability_version,
                "render.web": self.renderer.capability_version,
                "quality.governance": "quality-web-model-governance/1",
            },
            "source_tree_sha256": file_set.source_tree_sha256,
            "dist_tree_sha256": file_set.dist_tree_sha256,
            "files": {
                name: hashlib.sha256(content.encode()).hexdigest()
                for name, content in sorted(files.items())
            },
        }
        files["oeydesign-manifest.json"] = canonical_json(manifest)
        payload = _zip_payload(files)
        export_id = stable_id(
            "export", artifact.id, artifact.revision, delivery_profile
        )
        archive = self.export_root / f"{export_id}.zip"
        if archive.exists() and archive.read_bytes() != payload:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE, "Immutable export changed"
            )
        if not archive.exists():
            archive.write_bytes(payload)
        unpacked = self.export_root / "verified" / export_id
        if unpacked.exists():
            shutil.rmtree(unpacked)
        unpacked.mkdir(parents=True)
        member_hashes = _safe_unpack(archive, unpacked)
        artifact_render = self.renderer.render(
            self._materialize_dist(file_set, "export-source")
        )
        rerender = self.renderer.render(unpacked / "dist")
        _require_healthy_render(artifact_render)
        _require_healthy_render(rerender)
        diff = _pixel_diff_ratio(
            Path(str(artifact_render.screenshot_path)),
            Path(str(rerender.screenshot_path)),
        )
        if diff > 0.002:
            raise ContractError(
                ErrorCategory.DETERMINISTIC_FAILURE,
                "Unpacked export screenshot differs from the artifact",
            )
        export_manifest = {
            "format": "zip",
            "archive_path": str(archive),
            "archive_sha256": hashlib.sha256(payload).hexdigest(),
            "archive_crc_ok": True,
            "member_hashes": member_hashes,
            "source_tree_sha256": file_set.source_tree_sha256,
            "dist_tree_sha256": file_set.dist_tree_sha256,
            "delivery_profile": dict(delivery_profile),
            "rerender": {
                **_render_evidence(rerender),
                "trusted_render": True,
                "independent_unpack": True,
            },
            "pixel_diff_ratio": diff,
            "visual_review": dict(file_set.metadata["visual_review"]),
            "mock_declared": False,
        }
        return ExportCandidate(
            export_id,
            1,
            Lineage(artifact.lineage.project_id, run.id, self.capability_version),
            artifact.id,
            artifact.revision,
            files["dist/index.html"],
            export_manifest,
        )

    def _materialize_dist(self, file_set: ArtifactFileSet, purpose: str) -> Path:
        root = self.data_root / "product-artifacts" / purpose / file_set.id
        root.mkdir(parents=True, exist_ok=True)
        for name in file_set.dist_files:
            if name.startswith(".agent/"):
                continue
            target = root / Path(name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(self.file_sets.read(file_set, "dist", name))
        return root


class ModelAwareWebQualityPort(WebQualityPort):
    capability_version = "quality-web-model-governance/1"

    def __init__(self, product_store: ProductStore) -> None:
        super().__init__()
        self.product_store = product_store

    def assess_candidate(
        self,
        candidate: Candidate,
        brief: DesignBrief,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> QualityDecision:
        decision = super().assess_candidate(candidate, brief, constraints, run)
        file_set = self.product_store.file_set_for(
            "candidate", candidate.id, candidate.revision
        )
        return _with_visual_gate(decision, file_set)

    def assess_artifact(
        self,
        subject: RenderBundle | ExportCandidate,
        delivery_profile: Mapping[str, Any],
        context: ContextPackage,
        constraints: ConstraintProfile,
        run: WorkflowRun,
    ) -> QualityDecision:
        decision = super().assess_artifact(
            subject, delivery_profile, context, constraints, run
        )
        revision = subject.artifact_revision
        file_set = (
            self.product_store.file_set_for("artifact", subject.artifact_id, revision)
            if subject.artifact_id is not None
            else None
        )
        return _with_visual_gate(decision, file_set)


def parse_territory_plan(content: str) -> DesignTerritoryPlan:
    document = _json_document(content)
    raw = document.get("territories")
    if not isinstance(raw, list) or len(raw) != 2:
        raise ContractError(
            ErrorCategory.RETRYABLE, "Territory plan requires exactly two directions"
        )
    territories = tuple(_territory_from_mapping(value) for value in raw)
    if territories[0].name.casefold() == territories[1].name.casefold():
        raise ContractError(
            ErrorCategory.RETRYABLE, "Territory directions must be distinct"
        )
    return DesignTerritoryPlan(territories)


def parse_visual_review(content: str) -> VisualReview:
    document = _json_document(content)
    try:
        verdict = GateVerdict(str(document["verdict"]).upper())
    except (KeyError, ValueError) as exc:
        raise ContractError(
            ErrorCategory.RETRYABLE, "Visual verdict is invalid"
        ) from exc
    required = {
        "hierarchy",
        "composition",
        "typography",
        "color",
        "goal_fit",
        "originality",
    }
    raw_scores = document.get("scores")
    if not isinstance(raw_scores, Mapping) or set(raw_scores) != required:
        raise ContractError(ErrorCategory.RETRYABLE, "Visual scores are incomplete")
    scores = {
        str(name): int(value)
        for name, value in raw_scores.items()
        if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 5
    }
    if set(scores) != required:
        raise ContractError(ErrorCategory.RETRYABLE, "Visual scores are invalid")
    raw_findings = document.get("findings", [])
    instructions = document.get("repair_instructions", [])
    if not isinstance(raw_findings, list) or not isinstance(instructions, list):
        raise ContractError(ErrorCategory.RETRYABLE, "Visual findings are invalid")
    findings = tuple(
        MappingProxyType(dict(value))
        for value in raw_findings
        if isinstance(value, Mapping)
    )
    repair = tuple(
        str(value).strip()
        for value in instructions
        if isinstance(value, str) and value.strip()
    )
    review = VisualReview(verdict, MappingProxyType(scores), findings, repair)
    if verdict is GateVerdict.PASS and not review.passes:
        return replace(review, verdict=GateVerdict.REPAIR)
    return review


def _visual_review_from_mapping(value: Any) -> VisualReview:
    if not isinstance(value, Mapping):
        raise ContractError(
            ErrorCategory.DETERMINISTIC_FAILURE,
            "Saved visual review is unavailable",
        )
    try:
        verdict = GateVerdict(str(value["verdict"]))
    except (KeyError, ValueError) as exc:
        raise ContractError(
            ErrorCategory.DETERMINISTIC_FAILURE,
            "Saved visual review is invalid",
        ) from exc
    raw_scores = value.get("scores", {})
    raw_findings = value.get("findings", ())
    raw_repairs = value.get("repair_instructions", ())
    if (
        not isinstance(raw_scores, Mapping)
        or not isinstance(raw_findings, list | tuple)
        or not isinstance(raw_repairs, list | tuple)
    ):
        raise ContractError(
            ErrorCategory.DETERMINISTIC_FAILURE,
            "Saved visual review is invalid",
        )
    return VisualReview(
        verdict,
        MappingProxyType({str(key): int(item) for key, item in raw_scores.items()}),
        tuple(
            MappingProxyType(dict(item))
            for item in raw_findings
            if isinstance(item, Mapping)
        ),
        tuple(str(item) for item in raw_repairs),
    )


def _territory_from_mapping(value: Any) -> DesignTerritory:
    if not isinstance(value, Mapping):
        raise ContractError(ErrorCategory.RETRYABLE, "Territory is invalid")
    fields = (
        "name",
        "visual_thesis",
        "information_hierarchy",
        "layout_strategy",
        "typography_strategy",
        "interaction_emphasis",
    )
    texts = {name: str(value.get(name, "")).strip() for name in fields}
    if any(not text or len(text) > 2_000 for text in texts.values()):
        raise ContractError(ErrorCategory.RETRYABLE, "Territory text is incomplete")
    palette = value.get("palette_roles", {})
    facts = value.get("repository_facts", [])
    if not isinstance(palette, Mapping) or not isinstance(facts, list):
        raise ContractError(ErrorCategory.RETRYABLE, "Territory details are invalid")
    return DesignTerritory(
        texts["name"],
        texts["visual_thesis"],
        texts["information_hierarchy"],
        texts["layout_strategy"],
        texts["typography_strategy"],
        MappingProxyType({str(k): str(v) for k, v in palette.items()}),
        texts["interaction_emphasis"],
        tuple(str(fact) for fact in facts[:20]),
    )


def _territory_document(value: DesignTerritory) -> dict[str, Any]:
    return {
        "name": value.name,
        "visual_thesis": value.visual_thesis,
        "information_hierarchy": value.information_hierarchy,
        "layout_strategy": value.layout_strategy,
        "typography_strategy": value.typography_strategy,
        "palette_roles": dict(value.palette_roles),
        "interaction_emphasis": value.interaction_emphasis,
        "repository_facts": list(value.repository_facts),
    }


def _stream_progress(reporter: Any | None, summary: str):
    """Translate provider chunks into throttled, text-free progress pulses."""

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


def _visual_review_document(value: VisualReview) -> dict[str, Any]:
    return {
        "verdict": value.verdict.value,
        "passes": value.passes,
        "scores": dict(value.scores),
        "findings": [dict(finding) for finding in value.findings],
        "repair_instructions": list(value.repair_instructions),
    }


def _json_document(content: str) -> Mapping[str, Any]:
    candidate = content.strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            candidate = "\n".join(lines[1:-1]).strip()
    try:
        document = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise ContractError(
            ErrorCategory.RETRYABLE, "Provider JSON is invalid"
        ) from exc
    if not isinstance(document, Mapping):
        raise ContractError(ErrorCategory.RETRYABLE, "Provider JSON must be an object")
    return document


def _workspace_source_files(workspace: AgentWorkspace) -> dict[str, str]:
    files: dict[str, str] = {}
    for name in workspace.list_files(WorkspaceScope.WORK):
        if name.startswith(("node_modules/", "dist/", ".agent/")):
            continue
        files[name] = workspace.read_file(WorkspaceScope.WORK, name).decode("utf-8")
    return files


def _workspace_source_bytes(workspace: AgentWorkspace) -> dict[str, bytes]:
    return {
        name: workspace.read_file(WorkspaceScope.WORK, name)
        for name in workspace.list_files(WorkspaceScope.WORK)
        if not name.startswith(("node_modules/", "dist/", ".agent/"))
    }


def _workspace_dist_bytes(workspace: AgentWorkspace) -> dict[str, bytes]:
    return {
        name: workspace.read_file(WorkspaceScope.OUT, name)
        for name in workspace.list_files(WorkspaceScope.OUT)
        if not name.startswith(".agent/")
    }


def _repository_source(context: ContextPackage, repository: Any) -> Any | None:
    for source_id in context.source_refs:
        try:
            source = repository.get_source(source_id)
        except ContractError:
            continue
        if source.media_type == "application/x-oeydesign-repository":
            return source
    return None


def _render_evidence(result: Any) -> dict[str, Any]:
    return {
        "renderer": TrustedWebRenderer.capability_version,
        "chrome_version": result.chrome_version,
        "screenshot_path": result.screenshot_path,
        "screenshot_sha256": result.screenshot_sha256,
        "console_errors": list(result.console_errors),
        "page_errors": list(result.page_errors),
        "failed_requests": list(result.failed_requests),
        "dom_metrics": dict(result.dom_metrics),
        "healthy": result.healthy,
    }


def _require_healthy_render(result: Any) -> None:
    metrics = result.dom_metrics
    anchors = tuple(metrics.get("object_anchors", ()))
    sections = tuple(metrics.get("section_anchors", ()))
    if (
        not result.healthy
        or not result.screenshot_path
        or not anchors
        or len(anchors) != int(metrics.get("unique_object_anchors", 0))
        or len(sections) < 2
        or len(sections) != int(metrics.get("unique_section_anchors", 0))
        or int(metrics.get("scroll_width", 0)) > int(metrics.get("client_width", 0))
    ):
        raise ContractError(
            ErrorCategory.DETERMINISTIC_FAILURE,
            "Trusted render failed object, section, or viewport requirements",
        )


def _pixel_diff_ratio(first: Path, second: Path) -> float:
    try:
        from PIL import Image, ImageChops
    except ImportError as exc:
        raise ContractError(
            ErrorCategory.CAPABILITY_UNAVAILABLE, "Pillow is required for pixel diff"
        ) from exc
    with Image.open(first) as left, Image.open(second) as right:
        left_image = left.convert("RGBA")
        right_image = right.convert("RGBA")
        if left_image.size != right_image.size:
            return 1.0
        difference = ImageChops.difference(left_image, right_image)
        histogram = difference.histogram()
        changed = sum(count for index, count in enumerate(histogram) if index % 256)
        channels = left_image.width * left_image.height * 4
        return changed / channels if channels else 1.0


def _with_visual_gate(
    decision: QualityDecision, file_set: ArtifactFileSet | None
) -> QualityDecision:
    visual = None if file_set is None else file_set.metadata.get("visual_review")
    passes = isinstance(visual, Mapping) and visual.get("passes") is True
    if passes:
        return decision
    finding = Finding(
        FindingKind.HARD_ERROR,
        "VISUAL_REVIEW_NOT_PASSED",
        "Current revision has not passed model visual review.",
        "error",
        decision.target_id,
        True,
    )
    return replace(
        decision,
        hard_errors=decision.hard_errors + (finding,),
        verdict=GateVerdict.BLOCK,
    )


_INDEX_HTML = """<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport"
content="width=device-width,initial-scale=1"><title>OEYdesign artifact</title></head>
<body><div id="root"></div><script type="module" src="/src/main.jsx"></script>
</body></html>"""

_MAIN_JSX = """import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
createRoot(document.getElementById('root')).render(<App />)
"""

_APP_JSX = """import React from 'react'
import { Box, Button, Container, Typography } from '@mui/material'
export default function App(){return <Box component="main" data-oey-section="main"
sx={{minHeight:'100vh',bgcolor:'#F0EEE7',color:'#171916',py:10}}><Container>
<Typography data-oey-object="hero-title" variant="h1">Build the real story.</Typography>
<Typography data-oey-object="hero-summary" sx={{mt:3,maxWidth:680}}>Replace this
scaffold with a complete, intentional design.</Typography><Box data-oey-section="action"
sx={{mt:6}}><Button data-oey-object="primary-action" variant="contained">
Explore</Button>
<Box data-oey-object="detail-panel" sx={{mt:8,p:4,border:'1px solid #BDB8AB'}}>
Design details belong here.</Box></Box></Container></Box>}
"""
