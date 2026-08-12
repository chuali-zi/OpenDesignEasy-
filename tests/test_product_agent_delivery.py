# ruff: noqa: E501
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import pytest

from oeydesign.capabilities import ProviderResponse
from oeydesign.credentials import MemoryCredentialStore
from oeydesign.domain import ContractError, ErrorCategory
from oeydesign.product import AgentJobStatus
from oeydesign.product_shell import ProductShellService
from oeydesign.web_mvp import ProductApplication


class _ProductFixtureProvider:
    """Structured fake that still exercises workspaces, build, Chrome, and ZIP."""

    def __init__(self) -> None:
        self.calls = 0

    def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        max_tokens: int,
        temperature: float,
        stream: bool,
    ) -> ProviderResponse:
        del model, max_tokens, temperature, stream
        self.calls += 1
        system = str(messages[0].get("content", ""))
        if "multimodal design intake editor" in system:
            content = json.dumps(
                {
                    "status": "READY",
                    "question": None,
                    "goal": "Introduce the repository as a credible product",
                    "audience": "Technical evaluators",
                    "medium": "web",
                    "content_priorities": ["promise", "proof", "workflow"],
                    "style_intent": ["editorial", "confident"],
                    "constraints": ["no external resources"],
                    "confirmed_facts": ["The product creates reviewable Web work"],
                    "material_uncertainties": [],
                    "image_analyses": [],
                }
            )
        elif "territories as an array of exactly two" in system:
            content = json.dumps(
                {
                    "territories": [
                        {
                            "name": "Field Notes",
                            "visual_thesis": "Warm editorial narrative with evidence",
                            "information_hierarchy": "Promise, proof, method, action",
                            "layout_strategy": "Asymmetric long-form composition",
                            "typography_strategy": "Large serif display and quiet sans",
                            "palette_roles": {
                                "ground": "warm ivory",
                                "ink": "charcoal",
                                "accent": "persimmon",
                            },
                            "interaction_emphasis": "Measured sectional reveal",
                            "repository_facts": ["reviewable Web artifacts"],
                        },
                        {
                            "name": "Signal Grid",
                            "visual_thesis": "Technical proof in a high-contrast field",
                            "information_hierarchy": "Metrics, capability, process, action",
                            "layout_strategy": "Dense modular grid with hard rules",
                            "typography_strategy": "Compressed sans and monospace labels",
                            "palette_roles": {
                                "ground": "near black",
                                "ink": "bone",
                                "accent": "acid green",
                            },
                            "interaction_emphasis": "Immediate object-level inspection",
                            "repository_facts": ["immutable delivery"],
                        },
                    ]
                }
            )
        elif "production visual quality gate" in system:
            content = json.dumps(
                {
                    "verdict": "PASS",
                    "scores": {
                        "hierarchy": 5,
                        "composition": 4,
                        "typography": 4,
                        "color": 5,
                        "goal_fit": 5,
                        "originality": 4,
                    },
                    "findings": [],
                    "repair_instructions": [],
                }
            )
        elif _has_render_image(messages):
            content = '{"actions":[],"done":true}'
        elif any(
            "Trusted tool result for run_build" in str(message.get("content", ""))
            and '"ok":true' in str(message.get("content", ""))
            for message in messages
        ):
            content = json.dumps(
                {
                    "actions": [
                        {"tool": "render", "scope": "out", "entry": "index.html"}
                    ],
                    "done": False,
                }
            )
        else:
            goal = json.loads(str(messages[1]["content"]))["goal"]
            dark = "Signal Grid" in goal
            revision = "Modify the existing artifact" in goal
            app_source = _app_source(dark=dark, revision=revision)
            content = json.dumps(
                {
                    "actions": [
                        {
                            "tool": "write_file",
                            "scope": "work",
                            "path": "src/App.jsx",
                            "content": app_source,
                        },
                        {"tool": "run_build"},
                    ],
                    "done": False,
                }
            )
        return ProviderResponse(
            content,
            {"prompt_tokens": 120, "completion_tokens": 80},
            0.01,
            "stop",
        )


def _has_render_image(messages: list[dict[str, Any]]) -> bool:
    return any(
        isinstance(message.get("content"), list)
        and any(
            isinstance(part, dict) and part.get("type") == "image_url"
            for part in message["content"]
        )
        for message in messages
    )


def _app_source(*, dark: bool, revision: bool) -> str:
    background = "#10120f" if dark else "#f1ede2"
    foreground = "#f4f0e5" if dark else "#161814"
    accent = "#d9ff43" if dark else "#e45b35"
    title = "Sharper proof, same promise." if revision else (
        "A system for visible design decisions." if dark else "Design work, made accountable."
    )
    return f'''import React from "react";
import {{ Box, Button, CssBaseline, Typography }} from "@mui/material";

export default function App() {{
  return <Box sx={{{{minHeight:"100vh",bgcolor:"{background}",color:"{foreground}",fontFamily:"Arial, sans-serif"}}}}>
    <CssBaseline />
    <Box component="header" data-oey-section="navigation" sx={{{{display:"flex",justifyContent:"space-between",p:3,borderBottom:"1px solid {accent}"}}}}>
      <Typography data-oey-object="nav:brand" fontWeight={{900}}>OEY / DESIGN</Typography>
      <Typography data-oey-object="nav:status" variant="caption">BUILD · REVIEW · DELIVER</Typography>
    </Box>
    <Box component="main" data-oey-section="hero" sx={{{{display:"grid",gridTemplateColumns:"1.4fr .6fr",gap:6,p:9,alignItems:"end"}}}}>
      <Box>
        <Typography data-oey-object="hero:kicker" sx={{{{color:"{accent}",letterSpacing:".18em",fontSize:12,fontWeight:900}}}}>REAL WEB PRODUCTION</Typography>
        <Typography data-oey-object="hero:title" component="h1" sx={{{{fontFamily:"Georgia, serif",fontSize:104,lineHeight:.86,letterSpacing:"-.055em",maxWidth:920,my:4}}}}>{title}</Typography>
        <Typography data-oey-object="hero:summary" sx={{{{fontSize:20,maxWidth:640,opacity:.74}}}}>Two directions, trusted Chrome evidence, revision history, and an immutable source-plus-dist release.</Typography>
      </Box>
      <Box data-oey-object="proof:panel" sx={{{{border:"1px solid {accent}",p:4}}}}>
        <Typography variant="overline">CURRENT PROOF</Typography>
        <Typography sx={{{{fontSize:42,fontFamily:"Georgia, serif",my:2}}}}>3 gates</Typography>
        <Typography>Technical checks. Visual review. Human approval.</Typography>
        <Button data-oey-object="cta:primary" variant="contained" sx={{{{mt:4,bgcolor:"{accent}",color:"#111"}}}}>Inspect the work</Button>
      </Box>
    </Box>
  </Box>;
}}
'''


def _wait(app: ProductApplication, job_id: str, timeout: float = 600) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = app.product_store.get_job(job_id)
        if job.status in {
            AgentJobStatus.COMPLETED,
            AgentJobStatus.FAILED,
            AgentJobStatus.CANCELED,
        }:
            return job
        time.sleep(0.1)
    raise AssertionError("Agent job did not finish")


def _command(
    service: ProductShellService,
    project: dict[str, Any],
    action: str,
    **extra: Any,
) -> dict[str, Any]:
    return service.command(
        project["id"],
        {
            "command_id": f"{action}:{project['revision']}",
            "expected_revision": project["revision"],
            "action": action,
            **extra,
        },
    )


def _assert_secret_absent(secret: bytes, *roots: Path) -> None:
    for root in roots:
        for path in root.rglob("*"):
            if (
                path.is_file()
                and not path.is_symlink()
                and path.stat().st_size <= 5_000_000
            ):
                assert secret not in path.read_bytes(), path


@pytest.mark.skipif(os.name != "nt", reason="Real build/render path is Windows-only")
def test_fake_provider_runs_real_build_revision_quality_and_delivery(
    tmp_path: Path,
) -> None:
    dependency_image = (
        Path(__file__).parents[1]
        / "spikes"
        / "e8-e12-framework"
        / "node_modules"
    )
    if not dependency_image.is_dir():
        pytest.skip("Frozen dependency image is unavailable")
    credentials = MemoryCredentialStore()
    app = ProductApplication(
        tmp_path / "oeydesign.sqlite",
        data_root=tmp_path,
        dependency_image=dependency_image,
        credentials=credentials,
    )
    provider = _ProductFixtureProvider()
    app.provider.configure(
        base_url="https://example.test/v1",
        model="fixture-model",
        api_key="not-a-real-secret",
        probe=False,
    )
    app.provider.require = lambda: (provider, "fixture-model")  # type: ignore[method-assign]
    service = ProductShellService(app)
    try:
        project = service.create_project(
            {"command_id": "project:create", "name": "Repository introduction"}
        )
        queued = service.send_message(
            project["id"],
            {
                "client_message_id": "message:brief",
                "expected_revision": project["revision"],
                "text": "Create a credible introduction page for this product.",
            },
        )
        repeated = service.send_message(
            project["id"],
            {
                "client_message_id": "message:brief",
                "expected_revision": project["revision"],
                "text": "Create a credible introduction page for this product.",
            },
        )
        assert repeated["run"]["id"] == queued["run"]["id"]
        job = _wait(app, queued["run"]["id"])
        assert job.status is AgentJobStatus.COMPLETED, job.error_message
        assert job.steps > 0
        assert job.total_tokens > 0
        assert job.renders == 2
        project = service.project(project["id"])
        assert project["state"] == "AWAITING_DIRECTION_APPROVAL"
        assert len(project["candidates"]) == 2
        assert all(item["preview_url"] for item in project["candidates"])
        concepts = {item["concept"] for item in project["candidates"]}
        assert len(concepts) == 2

        selected = project["candidates"][0]
        project = _command(
            service,
            project,
            "approve_direction",
            candidate_id=selected["id"],
            candidate_revision=selected["revision"],
            impact="Use the editorial direction",
        )
        project = _command(
            service,
            project,
            "produce_artifact",
            medium="web",
            fidelity_mode="production",
        )
        artifact = project["focus"]
        with pytest.raises(ContractError) as stale:
            app.submit_message(
                project_id=project["id"],
                client_message_id="message:stale-object",
                expected_revision=project["revision"],
                text="Change the selected heading.",
                target_id=artifact["id"],
                target_revision=artifact["revision"] + 1,
                object_ref="hero:title",
            )
        assert stale.value.category is ErrorCategory.STALE_REVISION
        queued = service.send_message(
            project["id"],
            {
                "client_message_id": "message:local-revision",
                "expected_revision": project["revision"],
                "text": "Make the hero promise more direct.",
                "target_id": artifact["id"],
                "target_revision": artifact["revision"],
                "object_ref": "hero:title",
            },
        )
        revision_job = _wait(app, queued["run"]["id"])
        assert revision_job.status is AgentJobStatus.COMPLETED, (
            revision_job.error_message
        )
        project = service.project(project["id"])
        assert project["focus"]["revision"] == artifact["revision"] + 1
        assert project["state"] == "AWAITING_EXPORT_APPROVAL"
        assert project["quality"]["verdict"] == "PASS"

        project = _command(
            service,
            project,
            "approve_export",
            artifact_id=project["focus"]["id"],
            artifact_revision=project["focus"]["revision"],
            impact="Approve current revision",
        )
        project = _command(
            service,
            project,
            "deliver",
            delivery_profile={"format": "zip", "profile": "production"},
        )
        assert project["state"] == "DELIVERED"
        assert len(project["deliveries"]) == 1
        delivery = project["deliveries"][0]
        payload, filename = service.download(delivery["id"])
        assert filename.endswith(".zip")
        assert payload.startswith(b"PK")
        assert delivery["manifest"]["pixel_diff_ratio"] <= 0.002
        assert "archive_path" not in repr(project)
        workspace_root = app.composer.workspaces.base if app.composer else tmp_path
        _assert_secret_absent(b"not-a-real-secret", tmp_path, workspace_root)
    finally:
        app.close()
