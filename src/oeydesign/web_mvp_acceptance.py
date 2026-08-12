"""Explicit paid-provider acceptance runner for the Windows Web MVP."""

from __future__ import annotations

import hashlib
import json
import subprocess
import time
from argparse import ArgumentParser
from pathlib import Path
from typing import Any

from .credentials import KIMI_CREDENTIAL_TARGET
from .domain import ContractError, ErrorCategory, canonical_json
from .product import AgentJobStatus, ProviderSettings
from .product_shell import ProductShellService
from .web_mvp import ProductApplication

_SCENARIOS = {"repository", "references", "clarification"}


def run_live_acceptance(
    *,
    database: str | Path,
    data_root: str | Path,
    dependency_image: str | Path,
    repository: str | Path,
    base_url: str,
    model: str,
    scenario: str,
    reference_images: tuple[Path, ...] = (),
    timeout_seconds: float = 900,
) -> dict[str, Any]:
    if scenario not in _SCENARIOS:
        raise ValueError("Unsupported Web MVP acceptance scenario")
    if scenario == "references" and len(reference_images) != 3:
        raise ValueError("The references scenario requires exactly three images")
    started = time.monotonic()
    root = Path(data_root).resolve()
    repository_root = Path(repository).resolve(strict=True)
    repository_before = _directory_hash(repository_root)
    with ProductApplication(
        database,
        data_root=root,
        dependency_image=dependency_image,
    ) as app:
        if not app.credential_store.configured(KIMI_CREDENTIAL_TARGET):
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Configure the Kimi credential in Windows Credential Manager first",
            )
        app.product_store.save_provider_settings(
            ProviderSettings("kimi", base_url.rstrip("/"), model, True)
        )
        client, selected_model = app.provider.require()
        probe = client.chat(
            [{"role": "user", "content": "Return exactly READY."}],
            model=selected_model,
            max_tokens=16,
            temperature=0,
            stream=False,
        )
        if "READY" not in probe.content.upper():
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Kimi live acceptance probe failed",
            )
        app.require_product_ready()
        service = ProductShellService(app)
        project = service.create_project(
            {
                "command_id": f"acceptance:{scenario}:project",
                "name": f"Web MVP acceptance: {scenario}",
            }
        )
        service.attach_repository(
            project["id"],
            {
                "command_id": f"acceptance:{scenario}:repository",
                "expected_revision": project["revision"],
                "path": str(repository_root),
            },
        )
        for index, image in enumerate(reference_images):
            service.upload_image(
                project["id"],
                command_id=f"acceptance:{scenario}:image:{index}",
                expected_revision=project["revision"],
                filename=image.name,
                media_type=_image_media_type(image),
                payload=image.read_bytes(),
            )
        prompts = {
            "repository": (
                "Create a polished Web introduction page for this repository. "
                "Prioritize an honest product story and concrete technical proof "
                "for technical evaluators."
            ),
            "references": (
                "Create a product introduction page for technical buyers. Analyze "
                "the three references for transferable visual language, but do not "
                "copy or export any reference image."
            ),
            "clarification": (
                "Create the product Web page, but do not infer the primary audience."
            ),
        }
        queued = service.send_message(
            project["id"],
            {
                "client_message_id": f"acceptance:{scenario}:brief",
                "expected_revision": project["revision"],
                "text": prompts[scenario],
            },
        )
        job = _wait_job(
            app, queued["run"]["id"], started, timeout_seconds, allow_pause=True
        )
        clarification_count = 0
        if job.status is AgentJobStatus.PAUSED:
            clarification_count = 1
            project = service.project(project["id"])
            resumed = service.send_message(
                project["id"],
                {
                    "client_message_id": f"acceptance:{scenario}:answer",
                    "expected_revision": project["revision"],
                    "text": (
                        "The primary audience is technical product leaders who "
                        "evaluate design-production tooling."
                    ),
                },
            )
            job = _wait_job(
                app, resumed["run"]["id"], started, timeout_seconds
            )
        if job.status is not AgentJobStatus.COMPLETED:
            raise RuntimeError(job.error_message or "Web MVP Agent job failed")
        project = service.project(project["id"])
        if len(project["candidates"]) != 2:
            raise RuntimeError("Live acceptance did not create two candidates")
        if scenario == "references":
            candidate = project["candidates"][0]
            feedback = service.send_message(
                project["id"],
                {
                    "client_message_id": "acceptance:references:overall-feedback",
                    "expected_revision": project["revision"],
                    "text": (
                        "Strengthen the visual hierarchy and make the proof clearer."
                    ),
                    "target_id": candidate["id"],
                    "target_revision": candidate["revision"],
                },
            )
            _require_completed(
                _wait_job(app, feedback["run"]["id"], started, timeout_seconds)
            )
            project = service.project(project["id"])
        candidate = project["candidates"][0]
        project = _command(
            service,
            project,
            "approve_direction",
            candidate_id=candidate["id"],
            candidate_revision=candidate["revision"],
            impact="Acceptance direction selected",
        )
        project = _command(
            service,
            project,
            "produce_artifact",
            medium="web",
            fidelity_mode="production",
        )
        if scenario == "clarification":
            artifact = project["focus"]
            local = service.send_message(
                project["id"],
                {
                    "client_message_id": "acceptance:clarification:object-feedback",
                    "expected_revision": project["revision"],
                    "text": "Make this hero promise more concrete and direct.",
                    "target_id": artifact["id"],
                    "target_revision": artifact["revision"],
                    "object_ref": "hero:title",
                },
            )
            _require_completed(
                _wait_job(app, local["run"]["id"], started, timeout_seconds)
            )
            project = service.project(project["id"])
        else:
            project = _command(
                service,
                project,
                "validate_artifact",
                render_profile={"width": 1440, "height": 1000},
            )
        artifact = project["focus"]
        project = _command(
            service,
            project,
            "approve_export",
            artifact_id=artifact["id"],
            artifact_revision=artifact["revision"],
            impact="Acceptance export approved",
        )
        project = _command(
            service,
            project,
            "deliver",
            delivery_profile={"format": "zip", "profile": "production"},
        )
        elapsed = time.monotonic() - started
        repository_after = _directory_hash(repository_root)
        if repository_before != repository_after:
            raise RuntimeError("Original repository changed during acceptance")
        secret = app.credential_store.read(KIMI_CREDENTIAL_TARGET)
        scan_roots = [root]
        if app.composer is not None:
            scan_roots.append(app.composer.workspaces.base)
        secret_hits = _secret_hits(
            secret.encode() if secret else b"", *scan_roots
        )
        delivery = project["deliveries"][0]
        result = {
            "version": 1,
            "scenario": scenario,
            "passed": bool(
                project["state"] == "DELIVERED"
                and delivery["manifest"]["pixel_diff_ratio"] <= 0.002
                and secret_hits == 0
                and elapsed <= timeout_seconds
                and len({item["concept"] for item in project["candidates"]}) == 2
                and (scenario != "clarification" or clarification_count == 1)
            ),
            "commit": _git_commit(),
            "project_id": project["id"],
            "state": project["state"],
            "candidate_count": len(project["candidates"]),
            "candidate_concepts": [
                item["concept"] for item in project["candidates"]
            ],
            "clarification_count": clarification_count,
            "artifact_revision": artifact["revision"],
            "quality_verdict": project["quality"]["verdict"],
            "delivery_id": delivery["id"],
            "pixel_diff_ratio": delivery["manifest"]["pixel_diff_ratio"],
            "repository_tree_unchanged": True,
            "secret_hits": secret_hits,
            "elapsed_seconds": elapsed,
            "capabilities": service.health()["capabilities"],
        }
        if not result["passed"]:
            raise RuntimeError("Web MVP live acceptance failed its final assertions")
        return result


def _wait_job(
    app: ProductApplication,
    job_id: str,
    started: float,
    timeout: float,
    *,
    allow_pause: bool = False,
):
    while time.monotonic() - started < timeout:
        job = app.product_store.get_job(job_id)
        terminal = {
            AgentJobStatus.COMPLETED,
            AgentJobStatus.FAILED,
            AgentJobStatus.CANCELED,
        }
        if allow_pause:
            terminal.add(AgentJobStatus.PAUSED)
        if job.status in terminal:
            return job
        time.sleep(0.25)
    raise TimeoutError("Web MVP live acceptance exceeded its time budget")


def _require_completed(job: Any) -> None:
    if job.status is not AgentJobStatus.COMPLETED:
        raise RuntimeError(job.error_message or "Acceptance revision job failed")


def _command(
    service: ProductShellService,
    project: dict[str, Any],
    action: str,
    **values: Any,
) -> dict[str, Any]:
    return service.command(
        project["id"],
        {
            "command_id": f"acceptance:{action}:{project['revision']}",
            "expected_revision": project["revision"],
            "action": action,
            **values,
        },
    )


def _directory_hash(root: Path) -> str:
    entries: list[tuple[str, str]] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            entries.append((path.relative_to(root).as_posix(), "SYMLINK"))
        elif path.is_file():
            entries.append(
                (
                    path.relative_to(root).as_posix(),
                    hashlib.sha256(path.read_bytes()).hexdigest(),
                )
            )
    return hashlib.sha256(canonical_json(entries).encode()).hexdigest()


def _secret_hits(secret: bytes, *roots: Path) -> int:
    if not secret:
        return 0
    hits = 0
    for root in roots:
        for path in root.rglob("*"):
            if (
                path.is_file()
                and not path.is_symlink()
                and path.stat().st_size <= 50_000_000
                and secret in path.read_bytes()
            ):
                hits += 1
    return hits


def _image_media_type(path: Path) -> str:
    value = path.suffix.casefold()
    if value == ".png":
        return "image/png"
    if value in {".jpg", ".jpeg"}:
        return "image/jpeg"
    raise ValueError("Live acceptance references must be PNG or JPEG")


def _git_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True, timeout=5
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def main(argv: list[str] | None = None) -> int:
    parser = ArgumentParser(description="Run explicit paid Web MVP acceptance")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--database", default="oeydesign-live.sqlite")
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--dependency-image", type=Path, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--scenario", choices=sorted(_SCENARIOS), required=True)
    parser.add_argument("--reference-image", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if not args.live:
        parser.error("--live is required because this command invokes a paid model")
    result = run_live_acceptance(
        database=args.database,
        data_root=args.data_root,
        dependency_image=args.dependency_image,
        repository=args.repository,
        base_url=args.base_url,
        model=args.model,
        scenario=args.scenario,
        reference_images=tuple(args.reference_image),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
