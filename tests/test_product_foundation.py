from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from oeydesign.credentials import MemoryCredentialStore
from oeydesign.domain import ContractError
from oeydesign.persistence import SQLiteStore
from oeydesign.product import (
    AgentJobRunner,
    AgentJobStatus,
    ArtifactFileSetStore,
    ProductMessage,
    ProductMessageRole,
    ProductStore,
    ProviderSettings,
)


def _open(tmp_path: Path) -> tuple[SQLiteStore, ProductStore]:
    store = SQLiteStore(tmp_path / "product.sqlite", data_root=tmp_path)
    return store, ProductStore(store)


def test_memory_credential_store_never_uses_files(tmp_path: Path) -> None:
    credentials = MemoryCredentialStore()
    credentials.write("OEYdesign/provider/kimi/default", "secret-value")
    assert credentials.configured("OEYdesign/provider/kimi/default")
    assert credentials.read("OEYdesign/provider/kimi/default") == "secret-value"
    assert not any(path.is_file() for path in tmp_path.rglob("*"))
    credentials.delete("OEYdesign/provider/kimi/default")
    assert credentials.read("OEYdesign/provider/kimi/default") is None


def test_product_schema_is_additive_and_messages_are_idempotent(
    tmp_path: Path,
) -> None:
    store, product = _open(tmp_path)
    try:
        message = ProductMessage(
            "message-1",
            "project-1",
            ProductMessageRole.USER,
            "Create a project page",
            "client-1",
            None,
        )
        assert product.add_message(message) == message
        repeated = product.add_message(
            ProductMessage(
                "message-other",
                "project-1",
                ProductMessageRole.USER,
                "This duplicate body is ignored",
                "client-1",
                None,
            )
        )
        assert repeated == message
        assert product.list_messages("project-1") == (message,)

        product.save_provider_settings(
            ProviderSettings("kimi", "https://api.moonshot.cn/v1", "k3", True)
        )
        assert product.provider_settings().credential_configured is True
        table_names = {
            row[0]
            for row in store.connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert {
            "product_messages",
            "agent_jobs",
            "artifact_file_sets",
            "provider_settings",
        }.issubset(table_names)
    finally:
        store.close()


def test_single_fifo_worker_and_job_idempotency(tmp_path: Path) -> None:
    store, product = _open(tmp_path)
    runner = AgentJobRunner(product)
    order: list[str] = []
    release = threading.Event()

    def handler(job, control):
        control.checkpoint("working")
        order.append(job.project_id)
        if job.project_id == "project-1":
            release.wait(2)
        return {"ok": True}

    runner.register("fixture", handler)
    try:
        first = runner.submit(
            project_id="project-1",
            kind="fixture",
            idempotency_key="job-1",
            input={},
        )
        repeated = runner.submit(
            project_id="project-1",
            kind="fixture",
            idempotency_key="job-1",
            input={"ignored": True},
        )
        assert repeated.id == first.id
        second = runner.submit(
            project_id="project-2",
            kind="fixture",
            idempotency_key="job-2",
            input={},
        )
        deadline = time.monotonic() + 2
        while product.get_job(first.id).status is AgentJobStatus.QUEUED:
            assert time.monotonic() < deadline
            time.sleep(0.01)
        assert product.get_job(second.id).status is AgentJobStatus.QUEUED
        release.set()
        deadline = time.monotonic() + 3
        while product.get_job(second.id).status is not AgentJobStatus.COMPLETED:
            assert time.monotonic() < deadline
            time.sleep(0.01)
        assert order == ["project-1", "project-2"]
    finally:
        release.set()
        runner.close()
        store.close()


def test_running_jobs_pause_on_restart_and_can_resume(tmp_path: Path) -> None:
    store, product = _open(tmp_path)
    job = product.create_job(
        project_id="project",
        kind="fixture",
        idempotency_key="restart",
        input={},
    )
    product.update_job(
        type(job)(
            job.id,
            job.project_id,
            job.kind,
            job.idempotency_key,
            AgentJobStatus.RUNNING,
            "work",
            job.input,
            job.created_at,
            job.updated_at,
            job.sequence,
        )
    )
    store.close()

    reopened_store, reopened = _open(tmp_path)
    try:
        assert reopened.get_job(job.id).status is AgentJobStatus.PAUSED
    finally:
        reopened_store.close()


def test_file_sets_are_immutable_bounded_and_content_addressed(tmp_path: Path) -> None:
    store, product = _open(tmp_path)
    files = ArtifactFileSetStore(tmp_path, product)
    try:
        saved = files.save(
            project_id="project",
            owner_kind="candidate",
            owner_id="candidate-1",
            owner_revision=1,
            source={"src/main.jsx": "export default 1"},
            dist={"index.html": "<main>ok</main>"},
            metadata={"session_id": "session-1"},
        )
        repeated = files.save(
            project_id="project",
            owner_kind="candidate",
            owner_id="candidate-1",
            owner_revision=1,
            source={"src/main.jsx": "export default 1"},
            dist={"index.html": "<main>ok</main>"},
            metadata={"session_id": "session-1"},
        )
        assert repeated == saved
        assert files.read(saved, "dist", "index.html") == b"<main>ok</main>"
        with pytest.raises(ContractError):
            files.read(saved, "dist", "../index.html")
        with pytest.raises(ContractError):
            files.save(
                project_id="project",
                owner_kind="artifact",
                owner_id="artifact-1",
                owner_revision=1,
                source={".env": "SECRET=value"},
                dist={"index.html": "ok"},
            )
    finally:
        store.close()
