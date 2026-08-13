"""Fast, local interaction coverage for the PySide6 production-room shell.

These tests deliberately use the in-memory backend: the desktop UI should stay
testable without a product service, a browser preview, or a configured model.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Generator

import pytest
from PySide6.QtWidgets import QApplication

from gui_client.app import MainWindow
from gui_client.backend import (
    ActivityEvent,
    BackendError,
    Candidate,
    MockBackend,
    ProjectState,
    RunInfo,
)
from gui_client.dialogs import NewProjectDialog
from gui_client.panels.stage import StagePanel


@pytest.fixture(scope="module")
def qt_app() -> Generator[QApplication, None, None]:
    """Use the real Windows Qt application without depending on pytest-qt."""
    app = QApplication.instance() or QApplication([])
    yield app


@pytest.fixture
def window(qt_app: QApplication) -> Generator[MainWindow, None, None]:
    del qt_app
    view = MainWindow(MockBackend())
    # A message box is deliberately never allowed to make this suite modal.
    view._notice = lambda text: None  # type: ignore[method-assign]
    yield view
    view._poll_timer.stop()
    view.close()
    view.deleteLater()


def test_main_window_mock_backend_creates_switches_and_sends(
    window: MainWindow, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_project = window._project_id
    assert original_project == "proj-demo-0001"

    monkeypatch.setattr(
        NewProjectDialog,
        "get_name",
        staticmethod(lambda parent: "Fast local UI test"),
    )
    window._new_project()

    created_project = window._project_id
    assert created_project is not None
    assert created_project != original_project
    assert window._state is not None
    assert window._state.name == "Fast local UI test"
    assert window._project_combo.currentData() == created_project

    window._project_combo.setCurrentIndex(
        window._project_combo.findData(original_project)
    )
    assert window._project_id == original_project
    window.brief._input.setPlainText("A local desktop message")
    window.brief._send()

    assert window._state is not None
    assert any(
        message.text == "A local desktop message" for message in window._state.messages
    )


def test_stage_candidate_tabs_return_the_selected_target(qt_app: QApplication) -> None:
    del qt_app
    panel = StagePanel()
    state = ProjectState(
        id="project-tabs",
        name="Candidate switching",
        revision=4,
        candidates=[
            Candidate("candidate-a", "Field Notes", "proposed", revision=2),
            Candidate("candidate-b", "Signal Grid", "approved", revision=3),
        ],
    )
    panel.set_state(state)

    assert panel.current_candidate_id() == "candidate-a"
    assert panel.current_target() is not None
    assert panel.current_target().revision == 2
    selected: list[str] = []
    panel.object_selected.connect(selected.append)
    panel._accept_object_selection("candidate-b", 3, "stale:object")
    assert selected == []
    panel._accept_object_selection("candidate-a", 2, "hero:title")
    assert selected == ["hero:title"]

    panel._tabs.setCurrentIndex(1)
    assert panel.current_candidate_id() == "candidate-b"
    assert panel.current_target() is not None
    assert panel.current_target().id == "candidate-b"
    assert panel.current_target().revision == 3
    panel._accept_object_selection("candidate-a", 2, "hero:old")
    assert selected == ["hero:title"]
    panel.close()
    panel.deleteLater()


class _ControllableBackend(MockBackend):
    """Records precise GUI arguments and can fail the next message request."""

    def __init__(self) -> None:
        super().__init__()
        self.fail_messages = True
        self.calls: list[tuple[str, str, str | None, str | None, int | None]] = []

    def send_message(
        self,
        project_id: str,
        text: str,
        object_ref: str | None = None,
        target_id: str | None = None,
        target_revision: int | None = None,
    ) -> None:
        self.calls.append((project_id, text, object_ref, target_id, target_revision))
        if self.fail_messages:
            raise BackendError("TEST_FAILURE", "The controlled request failed")
        super().send_message(project_id, text, object_ref, target_id, target_revision)


def test_object_selection_survives_failed_send_and_clears_after_success(
    qt_app: QApplication,
) -> None:
    del qt_app
    backend = _ControllableBackend()
    window = MainWindow(backend)
    notices: list[str] = []
    window._notice = notices.append  # type: ignore[method-assign]
    try:
        window.brief.select_object("hero:title")
        window.brief._input.setPlainText("Make this direct")
        window.brief._send()

        assert notices == ["TEST_FAILURE\n\nThe controlled request failed"]
        assert window.brief._input.toPlainText() == "Make this direct"
        assert window.brief._object_ref == "hero:title"
        assert window.brief._selection_chip.isHidden() is False
        assert backend.calls[-1][2:] == ("hero:title", "cand-0001", 1)

        backend.fail_messages = False
        window.brief._send()

        assert window.brief._object_ref is None
        assert window.brief._input.toPlainText() == ""
        assert window.brief._selection_chip.isHidden() is True
        assert backend.calls[-1][2:] == ("hero:title", "cand-0001", 1)
    finally:
        window._poll_timer.stop()
        window.close()
        window.deleteLater()


class _BlockingCommandBackend(MockBackend):
    """A backend command that only completes when the test releases it."""

    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()
        self.command_calls = 0
        self.get_calls = 0

    def get_project(self, project_id: str) -> ProjectState:
        self.get_calls += 1
        return super().get_project(project_id)

    def run_command(
        self,
        project_id: str,
        command: str,
        *,
        candidate_id: str | None = None,
        source_revision: int | None = None,
    ) -> None:
        del candidate_id, source_revision
        self.command_calls += 1
        self.started.set()
        assert self.release.wait(timeout=2), "test did not release background task"
        super().run_command(project_id, command)


def test_command_runs_in_background_and_reloads_when_finished(
    qt_app: QApplication,
) -> None:
    backend = _BlockingCommandBackend()
    window = MainWindow(backend)
    window._notice = lambda text: None  # type: ignore[method-assign]
    try:
        initial_get_calls = backend.get_calls
        began = time.monotonic()
        window._run_command("generate_candidates")
        # The UI returns before the operation is released, proving it did not
        # execute the potentially long build/agent request on the Qt thread.
        assert time.monotonic() - began < 0.2
        assert backend.started.wait(timeout=0.5)
        assert window._backend_task is not None
        assert window.centralWidget().isEnabled() is False

        backend.release.set()
        deadline = time.monotonic() + 2
        while window._backend_task is not None and time.monotonic() < deadline:
            qt_app.processEvents()
            time.sleep(0.01)

        assert window._backend_task is None
        assert window.centralWidget().isEnabled() is True
        assert backend.command_calls == 1
        assert backend.get_calls > initial_get_calls
    finally:
        backend.release.set()
        if window._backend_task is not None:
            window._backend_task.wait(2_000)
        window._poll_timer.stop()
        window.close()
        window.deleteLater()


def test_workspace_prioritizes_canvas_and_activity_appends_without_reset(
    window: MainWindow, qt_app: QApplication
) -> None:
    window.resize(1920, 1080)
    window.show()
    qt_app.processEvents()
    sizes = window._workspace_splitter.sizes()
    assert sizes[1] > sizes[0]
    assert sizes[1] > sizes[2]
    assert window.stage.width() >= 800

    run = RunInfo(
        "run-activity",
        "running",
        "4s",
        activity=[ActivityEvent(1, "Build", "Created the page shell.", "build")],
    )
    window.brief.set_run(run)
    assert window.brief._activity_box.isHidden() is False
    assert window.brief._activity_layout.count() == 2  # row + trailing stretch
    window.brief.set_activity(
        run,
        [
            ActivityEvent(1, "Build", "Created the page shell.", "build"),
            ActivityEvent(2, "Render", "Rendered the desktop preview.", "render"),
        ],
    )
    assert window.brief._activity_layout.count() == 3

    window.brief.set_activity(
        run,
        [
            ActivityEvent(
                3, "Provider", "Kimi is streaming.", "stream", detail="chunks: 1"
            ),
            ActivityEvent(
                4, "Provider", "Kimi is streaming.", "stream", detail="chunks: 9"
            ),
        ],
    )
    # Consecutive transport pulses update one live row rather than causing
    # scroll churn, while both durable sequences are remembered.
    assert window.brief._activity_layout.count() == 4
    assert window.brief._activity_sequences.issuperset({3, 4})
    assert "chunks: 9" in window.brief._activity_tail_widget.text()


def test_completed_run_remains_visible_with_its_terminal_activity(
    window: MainWindow,
) -> None:
    assert window._state is not None
    run = RunInfo(
        "run-complete",
        "done",
        "12.0s",
        stage="completed",
        activity=[ActivityEvent(7, "Completed", "Agent job completed", "job")],
    )
    window._state.runs = [run]
    window._render(window._state)

    assert window.brief._run_strip.isHidden() is False
    assert "DONE" in window.brief._run_label.text()
    assert window.brief._activity_box.isHidden() is False
