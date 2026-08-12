"""Main window and entry point for the OEYdesign doodle desktop client."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from PySide6.QtCore import Qt, QTimer
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
        self._project_id: str | None = None
        self._state: ProjectState | None = None
        self._guard_failed = False

        self.setWindowTitle("OEY*design* — Production Room")
        self.resize(1280, 800)

        central = QWidget()
        root = QVBoxLayout(central)
        root.setContentsMargins(12, 10, 12, 12)
        root.setSpacing(10)
        root.addWidget(self._build_topbar())

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setChildrenCollapsible(False)
        self.brief = BriefPanel()
        self.stage = StagePanel()
        self.inspector = InspectorPanel()
        # minimum widths keep chips/buttons in the side columns unclipped;
        # the middle canvas is the flexible one.
        self.brief.setMinimumWidth(280)
        self.stage.setMinimumWidth(400)
        self.inspector.setMinimumWidth(300)
        splitter.addWidget(self.brief)
        splitter.addWidget(self.stage)
        splitter.addWidget(self.inspector)
        splitter.setStretchFactor(0, 24)
        splitter.setStretchFactor(1, 50)
        splitter.setStretchFactor(2, 26)
        splitter.setSizes([300, 640, 340])
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
        except BackendError as exc:
            if exc.current_revision is not None and self._project_id:
                self._load_project(self._project_id)
            self._notice(f"{exc.category}\n\n{exc}")
            self._guard_failed = True
        except Exception as exc:  # noqa: BLE001
            self._notice(str(exc))
            self._guard_failed = True
        return None

    def _active_run(self) -> Any:
        if self._state is None:
            return None
        for run in self._state.runs:
            if run.status.lower() in _ACTIVE_RUN_STATUSES:
                return run
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
        target = prefer_id or self._project_id
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
        self._render(state)

    def _render(self, state: ProjectState | None) -> None:
        self._state = state
        self.brief.set_messages(state.messages if state else [])
        self.brief.set_run(self._active_run())
        self.stage.set_state(state)
        self.inspector.set_state(state)
        if state is not None:
            delay = 1500 if self._active_run() else 4500
            self._poll_timer.start(delay)

    def _poll(self) -> None:
        if self._project_id:
            self._load_project(self._project_id)

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
        ProviderDialog(self._backend, self).exec()
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
            self.brief.clear_selection()
            self._load_project(self._project_id)

    def _run_command(self, command: str) -> None:
        if not self._project_id:
            return
        self._guard(
            self._backend.run_command,
            self._project_id,
            command,
            candidate_id=self.stage.current_candidate_id(),
        )
        if not self._guard_failed:
            self._load_project(self._project_id)

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
        dialog = SourcesDialog(self)
        if dialog.exec() != SourcesDialog.DialogCode.Accepted:
            return
        if dialog.repo_path:
            self._guard(
                self._backend.attach_repository, self._project_id, dialog.repo_path
            )
        elif dialog.image_paths:
            self._guard(
                self._backend.upload_images, self._project_id, dialog.image_paths
            )
        else:
            return
        if not self._guard_failed:
            self._load_project(self._project_id)

    def _restore(self, revision: int) -> None:
        if self._project_id:
            self._guard(
                self._backend.run_command,
                self._project_id,
                "restore_revision",
                source_revision=revision,
            )
            if not self._guard_failed:
                self._load_project(self._project_id)

    def _download(self, delivery_id: str) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Save immutable OEYdesign delivery",
            f"{delivery_id}.zip",
            "ZIP archives (*.zip)",
        )
        if not path:
            return
        saved = self._guard(self._backend.download_delivery, delivery_id, path)
        if saved is not None:
            self._notice(f"Delivery saved to:\n{saved}")


def _arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the OEYdesign desktop client")
    parser.add_argument("--data-root", type=Path, default=Path("data/desktop"))
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
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
