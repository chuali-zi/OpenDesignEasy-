"""Run the Windows P6 build/render/session closure and write reviewable evidence."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any

from .agent_engine import (
    AgentBudget,
    AgentSessionManager,
    WorkspaceManager,
    WorkspaceScope,
)
from .builder import FrameworkBuildResult, NativeEsbuildBuilder
from .capabilities import KimiTrustedAdapter
from .domain import canonical_json
from .framework_artifact import FrameworkArtifactContract
from .renderer import TrustedWebRenderer
from .sandbox import WindowsAppContainerLauncher

THEME_TOKENS = {
    "background": "#131519",
    "foreground": "#ECE9E2",
    "accent": "#D9A441",
    "border": "#32363E",
    "muted": "#9AA1AB",
    "focus": "#D9A441",
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    repository = Path(__file__).resolve().parents[2]
    parser.add_argument(
        "--source",
        type=Path,
        default=(
            repository
            / "spikes"
            / "e8-e12-framework"
            / "results"
            / "e12-candidate"
        ),
    )
    parser.add_argument(
        "--dependency-image",
        type=Path,
        default=repository / "spikes" / "e8-e12-framework" / "node_modules",
    )
    parser.add_argument(
        "--evidence-root",
        type=Path,
        default=repository / "spikes" / "phase6-closure" / "evidence",
    )
    parser.add_argument("--model", default="")
    args = parser.parse_args()
    result_path = run_acceptance(
        repository=repository,
        source=args.source.resolve(),
        dependency_image=args.dependency_image.resolve(),
        evidence_root=args.evidence_root.resolve(),
        requested_model=args.model,
    )
    print(result_path)


def run_acceptance(
    *,
    repository: Path,
    source: Path,
    dependency_image: Path,
    evidence_root: Path,
    requested_model: str = "",
) -> Path:
    if not source.is_dir() or not dependency_image.is_dir():
        raise RuntimeError("Phase 6 source or frozen dependency image is unavailable")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    evidence_dir = evidence_root / stamp
    evidence_dir.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    launcher = WindowsAppContainerLauncher()
    data_root = evidence_dir / "runtime"
    workspace_manager = WorkspaceManager(
        data_root,
        workspace_root=launcher.workspace_base(data_root),
    )
    workspace = workspace_manager.open("phase6-closure", f"candidate-{stamp}")
    _copy_source_into_workspace(source, workspace)
    builder = NativeEsbuildBuilder(
        launcher=launcher,
        dependency_image=dependency_image,
    )
    contract = FrameworkArtifactContract()

    def build_action(_workspace: Any) -> FrameworkBuildResult:
        files = _workspace_source_files(workspace)
        plan = contract.prepare(
            files,
            lockfile=files["package-lock.json"],
            theme_tokens=THEME_TOKENS,
        )
        return builder.build(plan, workspace)

    first = build_action(workspace)
    second = build_action(workspace)
    deterministic = (
        first.dist_tree_sha256 == second.dist_tree_sha256
        and first.output_files == second.output_files
    )
    if not deterministic:
        raise RuntimeError("Two clean AppContainer builds were not byte-identical")

    renderer = TrustedWebRenderer()
    render = renderer.render(workspace.out_root)
    if not render.healthy or not render.screenshot_path:
        raise RuntimeError("Trusted Chrome render was missing or unhealthy")
    initial_screenshot = evidence_dir / "chrome-initial.png"
    shutil.copy2(render.screenshot_path, initial_screenshot)

    provider, model = _provider(repository, requested_model)
    sessions = AgentSessionManager()
    session_id = f"phase6-{stamp}"
    sessions.start(
        workspace,
        session_id=session_id,
        stage="framework-closure",
        budget=AgentBudget(
            max_steps=20,
            max_total_tokens=250_000,
            max_seconds=900,
            max_renders=3,
        ),
        capability_version="agent-session-appcontainer-chrome/1",
    )
    from .agent_engine import AgentLoop

    session_result = AgentLoop(
        provider,
        renderer=renderer,
        session_manager=sessions,
        sandbox_launcher=launcher,
        build_action=build_action,
        allowed_tools=frozenset({"run_build", "render", "complete"}),
    ).run(
        workspace,
        session_id,
        goal=(
            "Validate the existing complete OEYdesign React candidate. Do not replace "
            "it. Call run_build, then render the out scope index.html. Inspect the "
            "exact "
            "Chrome screenshot returned to you. If it is complete, legible, and has no "
            "obvious layout defect, return an empty actions list with done=true on "
            "your "
            "next turn. Return only the required JSON action envelope."
        ),
        model=model,
        context={
            "required_scope": "out",
            "required_entry": "index.html",
            "network": "blocked",
            "builder": builder.capability_version,
            "renderer": renderer.capability_version,
        },
        max_tokens=16_000,
        temperature=1.0,
    )
    if not session_result.completed or session_result.session.status != "COMPLETED":
        raise RuntimeError("The Phase 6 agent session did not complete")
    final_render = renderer.render(workspace.out_root)
    if not final_render.healthy or not final_render.screenshot_path:
        raise RuntimeError("Final trusted Chrome render was missing or unhealthy")
    final_screenshot = evidence_dir / "chrome-final.png"
    shutil.copy2(final_render.screenshot_path, final_screenshot)

    evidence = {
        "version": 1,
        "passed": True,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "launcher": {
            "capability_version": launcher.capability_version,
            "available": launcher.available,
            "profile": launcher.profile_name,
            "profile_sid": launcher.last_profile_sid,
            "workspace_in_package": workspace.root.is_relative_to(
                launcher.package_root
            ),
            "zero_capabilities": True,
            "job_object_before_resume": True,
            "last_temporary_drive": launcher.last_drive,
        },
        "build": {
            "capability_version": builder.capability_version,
            "source_tree_sha256": second.source_tree_sha256,
            "lockfile_sha256": second.lockfile_sha256,
            "dependency_tree_sha256": second.dependency_tree_sha256,
            "first_dist_tree_sha256": first.dist_tree_sha256,
            "second_dist_tree_sha256": second.dist_tree_sha256,
            "byte_identical": deterministic,
            "output_files": dict(second.output_files),
        },
        "render": _render_evidence(final_render, final_screenshot),
        "session": {
            "id": session_result.session.id,
            "status": session_result.session.status,
            "completed": session_result.completed,
            "last_render_healthy": session_result.last_render_healthy,
            "model": model,
            "steps": session_result.session.budget.steps,
            "prompt_tokens": session_result.session.budget.prompt_tokens,
            "completion_tokens": session_result.session.budget.completion_tokens,
            "reasoning_tokens": session_result.session.budget.reasoning_tokens,
            "renders": session_result.session.budget.renders,
            "elapsed_seconds": session_result.session.budget.elapsed_seconds,
            "turns": [
                {
                    "sequence": turn.sequence,
                    "tool": turn.tool,
                    "outcome": turn.outcome,
                    "render": turn.render,
                }
                for turn in session_result.session.turns
            ],
        },
        "evidence_files": {
            "initial_screenshot": initial_screenshot.name,
            "final_screenshot": final_screenshot.name,
        },
    }
    result_path = evidence_dir / "phase6-closure.json"
    result_path.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (evidence_root / "latest.json").write_text(
        canonical_json(
            {
                "evidence": result_path.relative_to(evidence_root).as_posix(),
                "passed": True,
            }
        ),
        encoding="utf-8",
    )
    return result_path


def _copy_source_into_workspace(source: Path, workspace: Any) -> None:
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(source).as_posix()
        if relative == "index.html":
            payload = path.read_text(encoding="utf-8").replace(
                'src="/src/main.jsx"', 'src="./assets/app.js"'
            ).encode("utf-8")
        else:
            payload = path.read_bytes()
        workspace.write_file(WorkspaceScope.WORK, relative, payload)


def _workspace_source_files(workspace: Any) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for relative in workspace.list_files(WorkspaceScope.WORK):
        parts = relative.split("/")
        if parts[0] in {"node_modules", "dist"}:
            continue
        files[relative] = workspace.read_file(WorkspaceScope.WORK, relative)
    return files


def _provider(repository: Path, requested_model: str) -> tuple[KimiTrustedAdapter, str]:
    values = dict(os.environ)
    env_file = repository / ".env"
    if env_file.is_file():
        for raw in env_file.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    api_key = values.get("OEYDESIGN_KIMI_API_KEY") or values.get("API_KEY", "")
    base_url = values.get("OEYDESIGN_KIMI_BASE_URL") or values.get("BASE_URL", "")
    model = requested_model or values.get("OEYDESIGN_KIMI_MODEL") or values.get(
        "MODEL", ""
    )
    if not api_key or not base_url or not model:
        raise RuntimeError(
            "Kimi credentials/model are unavailable for the real session"
        )
    return KimiTrustedAdapter(api_key=api_key, base_url=base_url), model


def _render_evidence(render: Any, screenshot: Path) -> dict[str, Any]:
    import hashlib

    return {
        "capability_version": TrustedWebRenderer.capability_version,
        "healthy": render.healthy,
        "chrome_version": render.chrome_version,
        "entry": render.entry,
        "profile": _plain(render.profile),
        "screenshot": screenshot.name,
        "screenshot_sha256": hashlib.sha256(screenshot.read_bytes()).hexdigest(),
        "console_errors": list(render.console_errors),
        "page_errors": list(render.page_errors),
        "failed_requests": list(render.failed_requests),
        "dom_metrics": dict(render.dom_metrics),
        "elapsed_seconds": round(render.elapsed_seconds, 3),
    }


def _plain(value: Any) -> Any:
    if isinstance(value, dict) or hasattr(value, "items"):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [_plain(item) for item in value]
    return value


if __name__ == "__main__":
    main()
