from __future__ import annotations

from pathlib import Path

import pytest

from oeydesign.domain import (
    ArtifactRevision,
    CommandRecord,
    CommandResult,
    ContractError,
    DesignBrief,
    DomainEvent,
    ErrorCategory,
    Lineage,
    Project,
    ProjectState,
    constraint_profile,
    utc_now,
)
from oeydesign.persistence import (
    SQLiteAuditLog,
    SQLiteCommandLedger,
    SQLiteEventStore,
    SQLiteProjectRepository,
    SQLiteSideEffectLedger,
    SQLiteStore,
)


def project() -> Project:
    value = Project(
        id="project-1", name="Persistent", constraints=constraint_profile(), revision=1
    )
    value.brief = DesignBrief("goal", "audience", "web")
    value.current_artifact = ArtifactRevision(
        "artifact-1",
        1,
        None,
        Lineage("project-1", "run-1", "test"),
        "direction-1",
        "web",
        "balanced",
        "<main/>",
        {"source": "local"},
    )
    value.events.append(
        DomainEvent(
            "event-1", 1, value.id, 1, "ProjectCreated", utc_now(), {"state": "NEW"}
        )
    )
    return value


def test_project_command_and_events_survive_reopen(tmp_path: Path) -> None:
    path = tmp_path / "state.sqlite"
    store = SQLiteStore(path, data_root=tmp_path)
    repo = SQLiteProjectRepository(store)
    ledger = SQLiteCommandLedger(store)
    original = project()
    repo.add(original)
    ledger.record(
        "command-1",
        CommandRecord(
            "fingerprint",
            CommandResult(
                original.id,
                1,
                ProjectState.NEW,
                ("event-1",),
                original.current_artifact,
            ),
        ),
    )
    store.close()
    store = SQLiteStore(path, data_root=tmp_path)
    recovered = SQLiteProjectRepository(store).get(original.id)
    assert recovered.current_artifact == original.current_artifact
    assert SQLiteCommandLedger(store).get("command-1") is not None
    assert SQLiteEventStore(store).after_sequence(original.id) == tuple(original.events)
    assert SQLiteProjectRepository(store).list_revisions(original.id) == (1,)
    store.close()


def test_stale_save_and_event_cursor(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "state.sqlite", data_root=tmp_path)
    repo = SQLiteProjectRepository(store)
    first = project()
    repo.add(first)
    stale = repo.get(first.id)
    current = repo.get(first.id)
    current.revision = 2
    current.events.append(
        DomainEvent("event-2", 2, current.id, 2, "Changed", utc_now())
    )
    repo.save(current, expected_revision=1)
    with pytest.raises(ContractError) as caught:
        repo.save(stale, expected_revision=1)
    assert caught.value.category is ErrorCategory.STALE_REVISION
    assert [
        event.id for event in SQLiteEventStore(store).after_sequence(first.id, 1)
    ] == ["event-2"]
    assert repo.get_revision(first.id, 1).revision == 1
    assert repo.list_revisions(first.id) == (1, 2)
    store.close()


def test_audit_allowlist_and_side_effect_idempotency(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "state.sqlite", data_root=tmp_path)
    audit = SQLiteAuditLog(store)
    effects = SQLiteSideEffectLedger(store)
    audit.record(
        project_id="project-1",
        action="deliver",
        metadata={"attempt": 1, "prompt": "secret", "token": "secret"},
    )
    assert audit.query(project_id="project-1")[0]["metadata"] == {"attempt": 1}
    assert (
        effects.claim(
            "effect-1", project_id="project-1", action="deliver", target_revision=1
        )["claimed"]
        is True
    )
    assert effects.complete("effect-1", {"reference": "local://delivery"}) == {
        "reference": "local://delivery"
    }
    assert effects.claim(
        "effect-1", project_id="project-1", action="deliver", target_revision=1
    ) == {
        "status": "COMPLETED",
        "result": {"reference": "local://delivery"},
    }
    assert effects.get("effect-1") == {
        "status": "COMPLETED",
        "result": {"reference": "local://delivery"},
        "project_id": "project-1",
        "action": "deliver",
        "revision": 1,
        "error": None,
    }
    with pytest.raises(ContractError) as collision:
        effects.claim(
            "effect-1",
            project_id="another-project",
            action="deliver",
            target_revision=1,
        )
    assert collision.value.category is ErrorCategory.DETERMINISTIC_FAILURE
    store.close()


def test_expired_claim_requires_reconciliation_and_paths_are_confined(
    tmp_path: Path,
) -> None:
    store = SQLiteStore("effects.sqlite", data_root=tmp_path)
    effects = SQLiteSideEffectLedger(store)
    first = effects.claim(
        "effect-expired",
        project_id="project-1",
        action="deliver",
        target_revision=2,
        lease_seconds=0,
    )
    assert first == {
        "status": "CLAIMED",
        "claimed": True,
        "recovery_required": False,
    }
    recovered = effects.claim(
        "effect-expired",
        project_id="project-1",
        action="deliver",
        target_revision=2,
    )
    assert recovered["claimed"] is True
    assert recovered["recovery_required"] is True
    effects.fail("effect-expired", "SafeFailure")
    assert effects.get("effect-expired")["error"] == "SafeFailure"
    store.close()

    with pytest.raises(ContractError) as outside:
        SQLiteStore(tmp_path.parent / "outside.sqlite", data_root=tmp_path)
    assert outside.value.category is ErrorCategory.POLICY_BLOCKED
