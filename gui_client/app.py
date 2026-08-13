"""Main window and entry point for the OEYdesign doodle desktop client."""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from PySide6.QtCore import QSettings, Qt, QThread, QTimer, Signal
from PySide6.QtGui import QCloseEvent
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from .backend import Backend, BackendError, HttpBackend, MockBackend, ProjectState
from .dialogs import NewProjectDialog, ProviderDialog, SourcesDialog
from .panels.brief import BriefPanel
from .panels.inspector import InspectorPanel
from .panels.stage import StagePanel
from .theme import (
    COLORS,
    DoodleButton,
    DoodleChip,
    apply_app_style,
    font_body,
    font_display,
)

_ACTIVE_RUN_STATUSES = {"queued", "running", "paused"}


class _BackendTask(QThread):
    succeeded = Signal(object)
    failed = Signal(object)

    def __init__(self, operation: Callable[[], object], parent: QWidget) -> None:
        super().__init__(parent)
        self._operation = operation

    def run(self) -> None:
        try:
            self.succeeded.emit(self._operation())
        except Exception as exc:  # noqa: BLE001
            self.failed.emit(exc)


class _CrayonStar(QLabel):
    """Tiny painted crayon star for the brand mark."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__("★", parent)
        self.setFont(font_display(18))
        self.setStyleSheet(f"color: {COLORS['orange']};")


class MainWindow(QMainWindow):
    """OEY*design* production room: brief / stage / inspector columns."""

    def __init__(self, backend: Backend, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._backend = backend
        self._settings = (
            QSettings("OEYdesign", "Desktop")
            if isinstance(backend, HttpBackend)
            else None
        )
        self._project_id: str | None = None
        self._state: ProjectState | None = None
        self._render_signature = ""
        self._guard_failed = False
        self._backend_task: _BackendTask | None = None
        self._poll_task: _BackendTask | None = None
        self._backend_success: Callable[[object], None] | None = None
        self._activity_cursor = 0
        self._closing = False
        self._provider_dialog: ProviderDialog | None = None

        self.setWindowTitle("OEY*design* — Production Room")
        self.resize(1440, 900)
        self.setMinimumSize(980, 640)

        central = QWidget()
        root = QVBoxLayout(central)
        root.setContentsMargins(12, 10, 12, 12)
        root.setSpacing(10)
        root.addWidget(self._build_topbar())

        splitter = QSplitter(Qt.Orientation.Horizontal)
        self._workspace_splitter = splitter
        splitter.setChildrenCollapsible(False)
        self.brief = BriefPanel()
        self.stage = StagePanel()
        self.inspector = InspectorPanel()
        # minimum widths keep chips/buttons in the side columns unclipped;
        # the middle canvas is the flexible one.
        self.brief.setMinimumWidth(300)
        self.stage.setMinimumWidth(520)
        self.inspector.setMinimumWidth(250)
        splitter.addWidget(self.brief)
        splitter.addWidget(self.stage)
        splitter.addWidget(self.inspector)
        splitter.setStretchFactor(0, 18)
        splitter.setStretchFactor(1, 64)
        splitter.setStretchFactor(2, 18)
        splitter.setSizes([320, 880, 280])
        root.addWidget(splitter, stretch=1)
        self.setCentralWidget(central)

        self._wire_signals()

        self._poll_timer = QTimer(self)
        self._poll_timer.setSingleShot(True)
        self._poll_timer.timeout.connect(self._poll)

        self._refresh_health()
        self._refresh_projects()

    # -------------------------------------------------------------- top bar
    def _build_topbar(self) -> QFrame:
        bar = QFrame()
        row = QHBoxLayout(bar)
        row.setContentsMargins(4, 0, 4, 0)
        row.setSpacing(10)

        row.addWidget(_CrayonStar())
        brand = QLabel("OEY*design*")
        brand.setFont(font_display(20))
        brand.setStyleSheet(f"color: {COLORS['ink']};")
        row.addWidget(brand)

        self._status_chip = DoodleChip("CHECKING", color="orange")
        row.addWidget(self._status_chip)

        row.addSpacing(16)
        picker_label = QLabel("ACTIVE PROJECT")
        picker_label.setFont(font_body(9))
        picker_label.setStyleSheet(f"color: {COLORS['ink_soft']};")
        row.addWidget(picker_label)
        self._project_combo = QComboBox()
        self._project_combo.setMinimumWidth(220)
        self._project_combo.setFont(font_body(10))
        self._project_combo.currentIndexChanged.connect(self._on_combo_changed)
        row.addWidget(self._project_combo)

        row.addStretch(1)
        new_btn = DoodleButton("＋ New Project", kind="primary")
        new_btn.clicked.connect(self._new_project)
        settings_btn = DoodleButton("Settings")
        settings_btn.clicked.connect(self._open_settings)
        row.addWidget(new_btn)
        row.addWidget(settings_btn)
        return bar

    # --------------------------------------------------------------- wiring
    def _wire_signals(self) -> None:
        self.brief.message_sent.connect(self._send_message)
        self.brief.object_message_sent.connect(self._send_object_message)
        self.brief.run_action_requested.connect(self._run_action)
        self.stage.command_requested.connect(self._run_command)
        self.stage.object_selected.connect(self.brief.select_object)
        self.stage.target_changed.connect(self.brief.clear_selection)
        self.inspector.add_source_requested.connect(self._add_source)
        self.inspector.restore_requested.connect(self._restore)
        self.inspector.download_requested.connect(self._download)

    # ------------------------------------------------------------- helpers
    def _notice(self, text: str) -> None:
        box = QMessageBox(self)
        box.setWindowTitle("OEY*design*")
        box.setIcon(QMessageBox.Icon.Information)
        box.setText(text)
        box.setFont(font_body(11))
        box.exec()

    def _guard(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        """Run a backend call; set ``_guard_failed`` if it did not complete.

        Void backends legitimately return ``None``, so callers must check
        the flag instead of the return value.
        """
        self._guard_failed = False
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            self._handle_backend_exception(exc)
            self._guard_failed = True
        return None

    def _handle_backend_exception(self, exc: Exception) -> None:
        if isinstance(exc, BackendError):
            if exc.current_revision is not None and self._project_id:
                self._load_project(self._project_id)
            self._notice(f"{exc.category}\n\n{exc}")
        else:
            self._notice(str(exc))

    def _start_backend_operation(
        self,
        label: str,
        operation: Callable[[], object],
        on_success: Callable[[object], None],
    ) -> None:
        if self._backend_task is not None:
            self._notice("Another local operation is still finishing.")
            return
        task = _BackendTask(operation, self)
        self._poll_timer.stop()
        self._backend_task = task
        self._backend_success = on_success
        self.centralWidget().setEnabled(False)
        self.statusBar().showMessage(label)
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        task.succeeded.connect(self._backend_operation_succeeded)
        task.failed.connect(self._backend_operation_failed)
        task.finished.connect(self._backend_operation_finished)
        task.finished.connect(task.deleteLater)
        task.start()

    def _backend_operation_succeeded(self, result: object) -> None:
        callback = self._backend_success
        if callback is None:
            return
        try:
            callback(result)
        except Exception as exc:  # noqa: BLE001
            self._handle_backend_exception(exc)

    def _backend_operation_failed(self, exc: object) -> None:
        if isinstance(exc, Exception):
            self._handle_backend_exception(exc)
        else:
            self._notice("The local operation could not complete.")
        if self._project_id:
            self._load_project(self._project_id)

    def _backend_operation_finished(self) -> None:
        self._backend_task = None
        self._backend_success = None
        self.centralWidget().setEnabled(True)
        self.statusBar().clearMessage()
        if QApplication.overrideCursor() is not None:
            QApplication.restoreOverrideCursor()
        if self._active_run() is not None:
            self._poll_timer.start(750)

    def _active_run(self) -> Any:
        if self._state is None:
            return None
        for run in reversed(self._state.runs):
            if run.status.lower() in _ACTIVE_RUN_STATUSES:
                return run
        return None

    def _display_run(self) -> Any:
        """Keep the last run visible after its terminal event arrives."""

        active = self._active_run()
        if active is not None:
            return active
        if self._state is not None and self._state.runs:
            return self._state.runs[-1]
        return None

    # -------------------------------------------------------------- refresh
    def _refresh_health(self) -> None:
        result = self._guard(self._backend.health)
        if result is None:
            self._set_status("OFFLINE", "red", ["Local product service is unavailable"])
            return
        status, blockers = result
        ok = str(status).lower() in {"ok", "ready"} and not blockers
        self._set_status(
            "READY" if ok else "NEEDS SETUP",
            "green" if ok else "orange",
            blockers,
        )

    def _set_status(self, text: str, color: str, blockers: list[str]) -> None:
        layout = self._status_chip.parentWidget().layout()
        index = layout.indexOf(self._status_chip)
        layout.removeWidget(self._status_chip)
        self._status_chip.deleteLater()
        chip = DoodleChip(text, color=color)
        chip.setToolTip("\n".join(blockers) if blockers else "all good!")
        self._status_chip = chip
        layout.insertWidget(index, chip)

    def _refresh_projects(self, prefer_id: str | None = None) -> None:
        projects = self._guard(self._backend.list_projects)
        if projects is None:
            return
        self._project_combo.blockSignals(True)
        self._project_combo.clear()
        for summary in projects:
            label = f"{summary.name} · r{summary.revision}"
            self._project_combo.addItem(label, summary.id)
        remembered = (
            str(self._settings.value("active_project_id", ""))
            if self._settings is not None
            else ""
        )
        target = prefer_id or self._project_id or remembered
        index = self._project_combo.findData(target) if target else -1
        if index < 0 and self._project_combo.count():
            index = 0
        self._project_combo.setCurrentIndex(index)
        self._project_combo.blockSignals(False)
        if index >= 0:
            self._load_project(self._project_combo.itemData(index))
        else:
            self._project_id = None
            self._render(None)

    def _load_project(self, project_id: str) -> None:
        state = self._guard(self._backend.get_project, project_id)
        if state is None:
            return
        self._project_id = project_id
        self._activity_cursor = 0
        if self._settings is not None:
            self._settings.setValue("active_project_id", project_id)
        self._render(state)
        # Replay the last run's durable activity once after project load even
        # when the job is already completed or paused after a restart.
        if self._display_run() is not None:
            self._poll_timer.start(0)

    def _render(self, state: ProjectState | None) -> None:
        signature = repr(
            None
            if state is None
            else (
                state.id,
                state.name,
                state.revision,
                state.candidates,
                state.sources,
                state.quality,
                state.history,
                state.deliveries,
                state.readiness,
                state.blockers,
                state.actions,
                state.focus,
                tuple((run.id, run.status) for run in state.runs),
            )
        )
        unchanged = signature == self._render_signature
        self._render_signature = signature
        self._state = state
        active_run = self._active_run()
        display_run = self._display_run()
        self.brief.set_messages(state.messages if state else [])
        if not unchanged:
            self.stage.set_state(state)
            self.inspector.set_state(state)
        self.brief.set_run(display_run)
        if state is not None and active_run is not None:
            self._poll_timer.start(750)
        else:
            self._poll_timer.stop()

    def _poll(self) -> None:
        """Poll project/activity in a worker; never perform network I/O on Qt."""
        if not self._project_id or self._poll_task is not None or self._backend_task:
            return
        project_id = self._project_id
        cursor = self._activity_cursor

        def operation() -> object:
            return (
                self._backend.get_project(project_id),
                self._backend.get_project_activity(project_id, after_sequence=cursor),
            )

        task = _BackendTask(operation, self)
        self._poll_task = task
        task.succeeded.connect(self._poll_succeeded)
        task.failed.connect(lambda _exc: None)  # next cycle may recover
        task.finished.connect(self._poll_finished)
        task.finished.connect(task.deleteLater)
        task.start()

    def _poll_succeeded(self, result: object) -> None:
        if not isinstance(result, tuple) or len(result) != 2:
            return
        state, events = result
        if not isinstance(state, ProjectState) or self._project_id != state.id:
            return
        self._render(state)
        display_run = self._display_run()
        if not isinstance(events, list):
            return
        if events:
            self._activity_cursor = max(
                self._activity_cursor,
                max(int(getattr(event, "sequence", 0) or 0) for event in events),
            )
        if display_run is None:
            return
        matching = [
            event
            for event in events
            if not getattr(event, "job_id", "")
            or getattr(event, "job_id", "") == display_run.id
        ]
        if matching:
            self.brief.set_activity(display_run, matching)

    def _poll_finished(self) -> None:
        self._poll_task = None
        if not self._closing and self._active_run() is not None:
            self._poll_timer.start(750)

    def _on_combo_changed(self, index: int) -> None:
        project_id = self._project_combo.itemData(index)
        if project_id and project_id != self._project_id:
            self._load_project(project_id)

    # -------------------------------------------------------------- actions
    def _new_project(self) -> None:
        name = NewProjectDialog.get_name(self)
        if not name:
            return
        summary = self._guard(self._backend.create_project, name)
        if summary is not None:
            self._refresh_projects(prefer_id=summary.id)

    def _open_settings(self) -> None:
        dialog = ProviderDialog(self._backend, self)
        self._provider_dialog = dialog
        dialog.exec()
        self._provider_dialog = None
        self._refresh_health()

    def _send_message(self, text: str) -> None:
        self._send(text, None)

    def _send_object_message(self, text: str, object_ref: str) -> None:
        self._send(text, object_ref)

    def _send(self, text: str, object_ref: str | None) -> None:
        if not self._project_id:
            self._notice("Create a project first.")
            return
        target = self.stage.current_target()
        self._guard(
            self._backend.send_message,
            self._project_id,
            text,
            object_ref,
            target.id if target else None,
            target.revision if target else None,
        )
        if not self._guard_failed:
            self.brief.clear_composer()
            self.brief.clear_selection()
            self._load_project(self._project_id)

    def _run_command(self, command: str) -> None:
        if not self._project_id:
            return
        project_id = self._project_id
        candidate_id = self.stage.current_candidate_id()
        self._start_backend_operation(
            f"Running {command.replace('_', ' ')}…",
            lambda: self._backend.run_command(
                project_id,
                command,
                candidate_id=candidate_id,
            ),
            lambda _result: self._load_project(project_id),
        )

    def _run_action(self, action: str, run_id: str) -> None:
        handlers = {
            "pause": self._backend.pause_run,
            "resume": self._backend.resume_run,
            "cancel": self._backend.cancel_run,
        }
        handler = handlers.get(action)
        if handler is None:
            return
        self._guard(handler, run_id)
        if self._project_id and not self._guard_failed:
            self._load_project(self._project_id)

    def _add_source(self) -> None:
        if not self._project_id:
            self._notice("Create a project first.")
            return
        repository_attached = bool(
            self._state
            and any(source.kind == "repository" for source in self._state.sources)
        )
        dialog = SourcesDialog(self, repository_attached=repository_attached)
        if dialog.exec() != SourcesDialog.DialogCode.Accepted:
            return
        if dialog.repo_path:
            project_id = self._project_id
            repository = dialog.repo_path

            def attach_operation() -> object:
                return self._backend.attach_repository(project_id, repository)

            operation = attach_operation
            label = "Reading the repository into a safe, read-only snapshot…"
        elif dialog.image_paths:
            project_id = self._project_id
            images = list(dialog.image_paths)

            def upload_operation() -> object:
                return self._backend.upload_images(project_id, images)

            operation = upload_operation
            label = "Validating and storing visual references…"
        else:
            return
        self._start_backend_operation(
            label,
            operation,
            lambda _result: self._load_project(project_id),
        )

    def _restore(self, revision: int) -> None:
        if self._project_id:
            project_id = self._project_id
            self._start_backend_operation(
                f"Restoring revision {revision}…",
                lambda: self._backend.run_command(
                    project_id,
                    "restore_revision",
                    source_revision=revision,
                ),
                lambda _result: self._load_project(project_id),
            )

    def _download(self, delivery_id: str) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Save immutable OEYdesign delivery",
            f"{delivery_id}.zip",
            "ZIP archives (*.zip)",
        )
        if not path:
            return
        self._start_backend_operation(
            "Downloading and verifying the immutable ZIP…",
            lambda: self._backend.download_delivery(delivery_id, path),
            lambda saved: self._notice(f"Delivery saved to:\n{saved}"),
        )

    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802 - Qt override
        self._closing = True
        self._poll_timer.stop()
        if self._poll_task is not None and not self._poll_task.wait(2_000):
            event.ignore()
            self.statusBar().showMessage(
                "The local status refresh is finishing before exit."
            )
            return
        if self._backend_task is not None:
            event.ignore()
            self.statusBar().showMessage(
                "A local operation is reaching a safe boundary before exit."
            )
            return
        if (
            self._provider_dialog is not None
            and not self._provider_dialog.wait_for_task()
        ):
            event.ignore()
            self.statusBar().showMessage(
                "The provider request is reaching a safe boundary before exit."
            )
            return
        super().closeEvent(event)


def _default_data_root() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    base = Path(local) if local else Path.home() / "AppData" / "Local"
    return base / "OEYdesign" / "data"


def _arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the OEYdesign desktop client")
    parser.add_argument("--data-root", type=Path, default=_default_data_root())
    parser.add_argument("--database", type=Path, default=None)
    parser.add_argument("--dependency-image", type=Path, default=None)
    parser.add_argument(
        "--server-url",
        default="",
        help="Connect to an already running loopback product service",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Use the in-memory shell instead of the real product runtime",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    arguments = _arguments(list(sys.argv[1:] if argv is None else argv))
    app = QApplication([sys.argv[0]])
    apply_app_style(app)
    runtime = None
    if arguments.demo:
        backend: Backend = MockBackend()
    elif arguments.server_url:
        backend = HttpBackend(arguments.server_url)
    else:
        from .runtime import DesktopRuntime

        runtime = DesktopRuntime(
            data_root=arguments.data_root,
            database=arguments.database,
            dependency_image=arguments.dependency_image,
        )
        backend = runtime.backend
        app.aboutToQuit.connect(runtime.close)
    window = MainWindow(backend)
    # The production room is a three-column workspace; start maximized so the
    # live preview receives the dominant share of a normal desktop display.
    window.showMaximized()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
