from __future__ import annotations

import json
from pathlib import Path

import pytest

from oeydesign.agent_engine import (
    AgentBudget,
    AgentLoop,
    AgentSessionManager,
    WorkspaceManager,
    WorkspaceScope,
)
from oeydesign.capabilities import ProviderResponse
from oeydesign.composition import SQLiteApplication
from oeydesign.domain import ContractError, CreateProject


def test_workspace_mount_is_persistent_and_repo_scope_is_read_only(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    database = data_root / "app.sqlite"
    user_repo = tmp_path / "user-repo"
    user_repo.mkdir()
    (user_repo / "src").mkdir()
    (user_repo / "src" / "main.py").write_text("print('repo')\n", encoding="utf-8")
    original_payload = (user_repo / "src" / "main.py").read_bytes()

    with SQLiteApplication(database, data_root=data_root) as app:
        app.control.execute(
            CreateProject(
                command_id="agent:create",
                project_id="agent-project",
                name="Agent fixture",
            )
        )
        source = app.repository_ingestion.ingest_repository(
            "agent-project", app.repository_ingestion.authorize(user_repo)
        ).source
        workspace = app.agent_engine.open_workspace(
            "agent-project", "candidate-1", repository=source
        )
        assert workspace.list_files(WorkspaceScope.REPO) == ("src/main.py",)
        assert (
            workspace.read_file(WorkspaceScope.REPO, "src/main.py")
            == original_payload
        )
        workspace.write_file(WorkspaceScope.WORK, "index.html", b"<main />")
        assert workspace.read_file(WorkspaceScope.WORK, "index.html") == b"<main />"
        with pytest.raises(ContractError) as repo_write:
            workspace.write_file(WorkspaceScope.REPO, "src/main.py", b"changed")
        assert repo_write.value.category.value == "POLICY_BLOCKED"
        with pytest.raises(ContractError):
            workspace.read_file(WorkspaceScope.WORK, "../repo/src/main.py")

    with SQLiteApplication(database, data_root=data_root) as reopened:
        workspace = reopened.agent_engine.open_workspace(
            "agent-project", "candidate-1"
        )
        assert workspace.read_file(WorkspaceScope.WORK, "index.html") == b"<main />"
        assert (
            workspace.read_file(WorkspaceScope.REPO, "src/main.py")
            == original_payload
        )


def test_session_turn_history_and_budget_survive_restart_without_content(
    tmp_path: Path,
) -> None:
    manager = AgentSessionManager()
    workspace_manager = WorkspaceManager(tmp_path / "data")
    workspace = workspace_manager.open("project", "workspace")
    session = manager.start(
        workspace,
        session_id="session-1",
        stage="design",
        budget=AgentBudget(max_steps=2, max_total_tokens=10),
    )
    updated = manager.record_turn(
        workspace,
        session.id,
        tool="write_file",
        outcome="ok",
        path="work/secret.txt",
        prompt_tokens=3,
        completion_tokens=2,
    )
    assert updated.budget.total_tokens == 5

    reopened_manager = AgentSessionManager()
    resumed = reopened_manager.resume(workspace, session.id)
    assert resumed.budget.steps == 1
    resumed = reopened_manager.record_turn(
        workspace,
        session.id,
        tool="render",
        outcome="ok",
        path="out/index.html",
        prompt_tokens=2,
        completion_tokens=2,
        render=True,
    )
    assert resumed.budget.steps == 2
    with pytest.raises(ContractError) as exhausted:
        reopened_manager.record_turn(
            workspace,
            session.id,
            tool="write_file",
            outcome="ok",
            prompt_tokens=1,
        )
    assert exhausted.value.category.value == "CAPABILITY_UNAVAILABLE"
    assert reopened_manager.load(workspace, session.id).status == "BUDGET_EXHAUSTED"

    session_documents = list((workspace.agent_root).glob("session-*.json"))
    assert len(session_documents) == 1
    document = json.loads(session_documents[0].read_text(encoding="utf-8"))
    assert "secret.txt" not in repr(document)
    assert document["turns"][0]["path_hash"] != "work/secret.txt"


class _FakeClient:
    def __init__(self, *responses: str) -> None:
        self.responses = list(responses)
        self.messages: list[list[dict[str, object]]] = []

    def chat(
        self,
        messages: list[dict[str, object]],
        *,
        model: str,
        max_tokens: int,
        temperature: float,
        stream: bool,
    ) -> ProviderResponse:
        del model, max_tokens, temperature, stream
        self.messages.append(messages)
        return ProviderResponse(
            self.responses.pop(0),
            {"prompt_tokens": 2, "completion_tokens": 1},
            0.01,
            "stop",
        )


class _FakeRenderer:
    def render(self, root: Path, entry: str) -> object:
        assert root.is_dir()
        assert entry == "index.html"
        return type("Render", (), {"id": "render-1", "healthy": True})()


def test_agent_loop_uses_tools_and_requires_a_healthy_render(tmp_path: Path) -> None:
    workspace = WorkspaceManager(tmp_path / "data").open("project", "candidate")
    sessions = AgentSessionManager()
    sessions.start(
        workspace,
        session_id="session-1",
        stage="compose",
        budget=AgentBudget(max_steps=4, max_total_tokens=100),
    )
    client = _FakeClient(
        '{"actions":[{"tool":"write_file","scope":"out","path":"index.html",'
        '"content":"<main>ok</main>"}],"done":false}',
        '{"actions":[{"tool":"render","scope":"out","entry":"index.html"}],'
        '"done":false}',
        '{"actions":[],"done":true}',
    )
    result = AgentLoop(
        client,
        renderer=_FakeRenderer(),
        session_manager=sessions,
    ).run(
        workspace,
        "session-1",
        goal="make a page",
        model="fixture",
    )
    assert result.completed is True
    assert result.last_render_healthy is True
    assert workspace.read_file(WorkspaceScope.OUT, "index.html") == b"<main>ok</main>"
    assert len(result.session.turns) == 3
    assert len(client.messages) == 3
