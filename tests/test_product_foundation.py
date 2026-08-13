from __future__ import annotations

import threading
import time
from dataclasses import replace
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


def test_message_and_job_reservation_is_atomic_when_project_is_busy(
    tmp_path: Path,
) -> None:
    store, product = _open(tmp_path)
    try:
        existing = product.create_job(
            project_id="project-1",
            kind="fixture",
            idempotency_key="existing-job",
            input={},
        )
        blocked_message = ProductMessage(
            "message-blocked",
            "project-1",
            ProductMessageRole.USER,
            "This must not be orphaned",
            "client-blocked",
            None,
        )
        with pytest.raises(ContractError):
            product.add_message_and_create_job(
                blocked_message,
                kind="fixture",
                idempotency_key="blocked-job",
                input={"message_id": blocked_message.id},
            )
        assert product.list_messages("project-1") == ()

        product.update_job(
            type(existing)(
                existing.id,
                existing.project_id,
                existing.kind,
                existing.idempotency_key,
                AgentJobStatus.COMPLETED,
                "completed",
                existing.input,
                existing.created_at,
                existing.updated_at,
                existing.sequence,
            )
        )
        saved, job = product.add_message_and_create_job(
            blocked_message,
            kind="fixture",
            idempotency_key="accepted-job",
            input={"message_id": blocked_message.id},
        )
        repeated_message, repeated_job = product.add_message_and_create_job(
            blocked_message,
            kind="fixture",
            idempotency_key="accepted-job",
            input={"message_id": blocked_message.id},
        )
        assert repeated_message == saved
        assert repeated_job == job
        assert saved.run_id == job.id
        assert product.list_messages("project-1") == (saved,)
    finally:
        store.close()


def test_clarification_message_reuses_its_existing_intake_job(
    tmp_path: Path,
) -> None:
    store, product = _open(tmp_path)
    try:
        job = product.create_job(
            project_id="project-1",
            kind="intake-design",
            idempotency_key="initial-brief",
            input={"message_id": "brief"},
        )
        product.update_job(
            type(job)(
                job.id,
                job.project_id,
                job.kind,
                job.idempotency_key,
                AgentJobStatus.PAUSED,
                "needs-input",
                job.input,
                job.created_at,
                job.updated_at,
                job.sequence,
            )
        )
        reply = ProductMessage(
            "clarification",
            "project-1",
            ProductMessageRole.USER,
            "Technical founders are the primary audience.",
            "clarification-client-id",
            None,
        )
        saved, associated = product.add_message_for_existing_job(reply, job.id)
        repeated, repeated_job = product.add_message_for_existing_job(reply, job.id)
        assert saved.run_id == job.id
        assert repeated == saved
        assert repeated_job == associated
        assert product.message_job("project-1", "clarification-client-id") == associated
        with pytest.raises(ContractError):
            product.add_message_for_existing_job(
                ProductMessage(
                    "clarification-other",
                    "project-1",
                    ProductMessageRole.USER,
                    "A conflicting audience.",
                    "clarification-client-id",
                    None,
                ),
                job.id,
            )
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


def test_queued_job_claim_is_atomic_across_two_sqlite_connections(
    tmp_path: Path,
) -> None:
    first_store, first = _open(tmp_path)
    second_store, second = _open(tmp_path)
    try:
        job = first.create_job(
            project_id="project",
            kind="fixture",
            idempotency_key="claim-race",
            input={},
        )
        barrier = threading.Barrier(2)
        claimed = []

        def claim(product: ProductStore) -> None:
            barrier.wait()
            result = product.claim_next_queued(supported_kinds=("fixture",))
            claimed.append(None if result is None else result.id)

        threads = [
            threading.Thread(target=claim, args=(first,)),
            threading.Thread(target=claim, args=(second,)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2)
            assert not thread.is_alive()
        assert claimed.count(job.id) == 1
        assert claimed.count(None) == 1
        assert first.get_job(job.id).status is AgentJobStatus.RUNNING
    finally:
        first_store.close()
        second_store.close()


def test_global_fifo_claim_allows_only_one_running_job_across_workers(
    tmp_path: Path,
) -> None:
    first_store, first = _open(tmp_path)
    second_store, second = _open(tmp_path)
    try:
        claimed = first.create_job(
            project_id="project-1",
            kind="fixture",
            idempotency_key="global-first",
            input={},
        )
        queued = first.create_job(
            project_id="project-2",
            kind="fixture",
            idempotency_key="global-second",
            input={},
        )
        assert first.claim_next_queued(supported_kinds=("fixture",)).id == claimed.id
        assert second.claim_next_queued(supported_kinds=("fixture",)) is None
        assert second.get_job(queued.id).status is AgentJobStatus.QUEUED
    finally:
        first_store.close()
        second_store.close()


def test_stale_worker_update_cannot_erase_a_concurrent_pause_request(
    tmp_path: Path,
) -> None:
    store, product = _open(tmp_path)
    try:
        job = product.create_job(
            project_id="project",
            kind="fixture",
            idempotency_key="control-race",
            input={},
        )
        running = product.claim_next_queued(supported_kinds=("fixture",))
        assert running is not None and running.id == job.id
        product.update_job(replace(running, pause_requested=True))
        merged = product.update_job(
            replace(running, stage="provider-returned", pause_requested=False)
        )
        assert merged.pause_requested is True
        assert merged.stage == "provider-returned"
    finally:
        store.close()


def test_close_requests_pause_and_waits_before_sqlite_can_close(tmp_path: Path) -> None:
    store, product = _open(tmp_path)
    runner = AgentJobRunner(product)
    entered = threading.Event()
    release = threading.Event()

    def handler(job, control):
        entered.set()
        # Simulate one in-flight provider request: it cannot observe the pause
        # until that request returns and reaches the next trusted boundary.
        release.wait(2)
        control.checkpoint("provider-boundary")
        return {"unexpected": "completion"}

    runner.register("fixture", handler)
    try:
        job = runner.submit(
            project_id="project",
            kind="fixture",
            idempotency_key="close-race",
            input={},
        )
        assert entered.wait(2)
        assert runner.close(timeout=0.01) is False
        assert runner.is_alive
        assert product.get_job(job.id).pause_requested is True

        # A caller that receives False must retain the connection until this
        # cooperative provider boundary completes.
        release.set()
        assert runner.wait(timeout=2) is True
        assert product.get_job(job.id).status is AgentJobStatus.PAUSED
    finally:
        release.set()
        runner.close(timeout=2)
        store.close()


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
