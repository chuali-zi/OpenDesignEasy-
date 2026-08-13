"""Doodle-style dialogs: new project, sources, and Kimi provider settings."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtWidgets import (
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QVBoxLayout,
    QWidget,
)

from .theme import COLORS, DoodleButton, font_body, font_display, font_label

if TYPE_CHECKING:
    from collections.abc import Callable

    from .backend import Backend


def _hint(text: str) -> QLabel:
    label = QLabel(text)
    label.setFont(font_label(9))
    label.setStyleSheet(f"color: {COLORS['ink_soft']};")
    label.setWordWrap(True)
    return label


class _ProviderTask(QThread):
    succeeded = Signal(object)
    failed = Signal(str)

    def __init__(self, operation: Callable[[], object], parent: QWidget) -> None:
        super().__init__(parent)
        self._operation = operation

    def run(self) -> None:
        try:
            self.succeeded.emit(self._operation())
        except Exception as exc:  # noqa: BLE001
            self.failed.emit(str(exc))


class NewProjectDialog(QDialog):
    """Ask for a project name. Use ``get_name()`` for a one-liner."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("New Project / 001")
        self.setMinimumWidth(380)
        layout = QVBoxLayout(self)
        layout.setSpacing(10)

        title = QLabel("Start with the outcome.")
        title.setFont(font_display(16))
        layout.addWidget(title)
        layout.addWidget(_hint("PROJECT NAME"))

        self.name_edit = QLineEdit("Untitled Web project")
        self.name_edit.setFont(font_body(11))
        self.name_edit.setMaxLength(200)
        layout.addWidget(self.name_edit)

        row = QHBoxLayout()
        row.addStretch(1)
        cancel = DoodleButton("Cancel")
        create = DoodleButton("Create", kind="primary")
        cancel.clicked.connect(self.reject)
        create.clicked.connect(self._accept)
        row.addWidget(cancel)
        row.addWidget(create)
        layout.addLayout(row)

    def _accept(self) -> None:
        if self.name_edit.text().strip():
            self.accept()
        else:
            self.name_edit.setFocus()

    @staticmethod
    def get_name(parent: QWidget | None = None) -> str | None:
        dialog = NewProjectDialog(parent)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            return dialog.name_edit.text().strip() or None
        return None


class SourcesDialog(QDialog):
    """Attach a read-only repository OR upload reference images.

    After ``exec()`` returns Accepted, inspect ``repo_path`` (str) or
    ``image_paths`` (list[str]) — exactly one is non-empty.
    """

    def __init__(
        self,
        parent: QWidget | None = None,
        *,
        repository_attached: bool = False,
    ) -> None:
        super().__init__(parent)
        self.setWindowTitle("Project Sources")
        self.setMinimumWidth(420)
        self.repo_path: str | None = None
        self.image_paths: list[str] = []

        layout = QVBoxLayout(self)
        layout.setSpacing(10)
        title = QLabel("Give the Agent something real.")
        title.setFont(font_display(16))
        layout.addWidget(title)

        # --- repository -------------------------------------------------
        layout.addWidget(_hint("LOCAL REPOSITORY PATH"))
        repo_row = QHBoxLayout()
        self.repo_edit = QLineEdit()
        self.repo_edit.setPlaceholderText(r"D:\projects\your-repository")
        self.repo_edit.setFont(font_body(11))
        self._browse_btn = DoodleButton("Browse...")
        self._browse_btn.clicked.connect(self._browse_repo)
        repo_row.addWidget(self.repo_edit, stretch=1)
        repo_row.addWidget(self._browse_btn)
        layout.addLayout(repo_row)

        self._attach_btn = DoodleButton(
            "Repository Already Attached"
            if repository_attached
            else "Attach Read-Only Repository",
            kind="primary",
        )
        self._attach_btn.clicked.connect(self._attach_repo)
        layout.addWidget(self._attach_btn)
        if repository_attached:
            self.repo_edit.setPlaceholderText(
                "This project already has its one read-only repository"
            )
            self.repo_edit.setEnabled(False)
            self._browse_btn.setEnabled(False)
            self._attach_btn.setEnabled(False)

        or_label = QLabel("— or —")
        or_label.setFont(font_display(13))
        or_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(or_label)

        # --- reference images ---------------------------------------------
        layout.addWidget(_hint("REFERENCE IMAGES (PNG / JPEG, analysis only)"))
        image_row = QHBoxLayout()
        choose = DoodleButton("Choose Images...")
        choose.clicked.connect(self._choose_images)
        self._count_label = QLabel("no images selected")
        self._count_label.setFont(font_body(9))
        self._count_label.setStyleSheet(f"color: {COLORS['ink_soft']};")
        image_row.addWidget(choose)
        image_row.addWidget(self._count_label, stretch=1)
        layout.addLayout(image_row)

        upload = DoodleButton("Upload", kind="accent")
        upload.clicked.connect(self._upload)
        layout.addWidget(upload)

        cancel = DoodleButton("Cancel")
        cancel.clicked.connect(self.reject)
        layout.addWidget(cancel, alignment=Qt.AlignmentFlag.AlignRight)

    def _browse_repo(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Choose a repository")
        if path:
            self.repo_edit.setText(path)

    def _attach_repo(self) -> None:
        path = self.repo_edit.text().strip()
        if not path:
            self.repo_edit.setFocus()
            return
        self.repo_path = path
        self.image_paths = []
        self.accept()

    def _choose_images(self) -> None:
        paths, _ = QFileDialog.getOpenFileNames(
            self,
            "Choose reference images",
            "",
            "Images (*.png *.jpg *.jpeg)",
        )
        if paths:
            self.image_paths = list(paths)
            self._count_label.setText(f"{len(paths)} image(s) selected")

    def _upload(self) -> None:
        if self.image_paths:
            self.repo_path = None
            self.accept()
        else:
            self._count_label.setText("pick some images first!")


class ProviderDialog(QDialog):
    """Kimi provider settings; talks to the backend directly."""

    def __init__(self, backend: Backend, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._backend = backend
        self.setWindowTitle("Trusted Provider")
        self.setMinimumWidth(420)

        layout = QVBoxLayout(self)
        layout.setSpacing(10)
        title = QLabel("Kimi configuration")
        title.setFont(font_display(16))
        layout.addWidget(title)
        layout.addWidget(
            _hint(
                "The API key goes to Windows Credential Manager, "
                "never into project records. Kimi Code membership keys and "
                "Kimi Platform API keys are not interchangeable."
            )
        )

        layout.addWidget(_hint("BASE URL"))
        self.base_url_edit = QLineEdit()
        self.base_url_edit.setPlaceholderText("Kimi OpenAI-compatible base URL")
        self.base_url_edit.setFont(font_body(11))
        layout.addWidget(self.base_url_edit)

        layout.addWidget(_hint("MODEL"))
        self.model_edit = QLineEdit()
        self.model_edit.setPlaceholderText("k3")
        self.model_edit.setFont(font_body(11))
        layout.addWidget(self.model_edit)

        layout.addWidget(_hint("API KEY"))
        self.key_edit = QLineEdit()
        self.key_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.key_edit.setPlaceholderText("Stored in Windows Credential Manager")
        self.key_edit.setFont(font_body(11))
        layout.addWidget(self.key_edit)

        self._result = QLabel("")
        self._result.setFont(font_body(9))
        self._result.setWordWrap(True)
        layout.addWidget(self._result)

        row = QHBoxLayout()
        self._save_btn = DoodleButton("Save & Probe", kind="accent")
        self._save_btn.setMinimumWidth(150)
        self._delete_btn = DoodleButton("Delete Credential", kind="danger")
        self._cancel_btn = DoodleButton("Cancel")
        self._save_btn.clicked.connect(self._save)
        self._delete_btn.clicked.connect(self._delete)
        self._cancel_btn.clicked.connect(self.reject)
        row.addWidget(self._save_btn)
        row.addWidget(self._delete_btn)
        row.addStretch(1)
        row.addWidget(self._cancel_btn)
        layout.addLayout(row)

        self._task: _ProviderTask | None = None
        self._load()

    def _load(self) -> None:
        try:
            data = self._backend.get_provider()
        except Exception as exc:  # noqa: BLE001
            self._show(str(exc), ok=False)
            return
        # Give a first-time Code user the official compatible endpoint, while
        # respecting every setting returned by an existing configuration.
        self.base_url_edit.setText(
            str(data.get("base_url") or "https://api.kimi.com/coding/v1")
        )
        self.model_edit.setText(str(data.get("model") or "k3"))
        configured = bool(data.get("credential_configured"))
        if configured:
            self._show("credential configured ✔", ok=True)
            self.key_edit.setPlaceholderText(
                "Leave blank to keep the credential already stored in Windows"
            )
        else:
            self._show("credential not configured", ok=False)
            self.key_edit.setPlaceholderText("Required for the first Save & Probe")

    def _save(self) -> None:
        base_url = self.base_url_edit.text().strip()
        model = self.model_edit.text().strip()
        api_key = self.key_edit.text()
        self._start(
            lambda: self._backend.save_provider(base_url, model, api_key),
            "saved & probed ✔",
            deleting=False,
        )

    def _delete(self) -> None:
        self._start(
            self._backend.delete_provider,
            "credential deleted",
            deleting=True,
        )

    def _start(
        self,
        operation: Callable[[], object],
        success_text: str,
        *,
        deleting: bool,
    ) -> None:
        if self._task is not None and self._task.isRunning():
            return
        self._set_busy(True)
        self._show(
            "deleting…"
            if deleting
            else "probing Kimi without blocking the window… "
            "Your typed endpoint, model, and key stay in place if the probe fails.",
            ok=True,
        )
        task = _ProviderTask(operation, self)
        self._task = task
        task.succeeded.connect(
            lambda _result: self._complete(success_text, deleting=deleting)
        )
        task.failed.connect(lambda message: self._show(message, ok=False))
        task.finished.connect(lambda: self._set_busy(False))
        task.finished.connect(task.deleteLater)
        task.start()

    def _complete(self, text: str, *, deleting: bool) -> None:
        self.key_edit.clear()
        if deleting:
            self.base_url_edit.clear()
            self.model_edit.clear()
            self.key_edit.setPlaceholderText("Required for the first Save & Probe")
        else:
            self.key_edit.setPlaceholderText(
                "Leave blank to keep the credential already stored in Windows"
            )
        self._show(text, ok=True)

    def _set_busy(self, busy: bool) -> None:
        for widget in (
            self.base_url_edit,
            self.model_edit,
            self.key_edit,
            self._save_btn,
            self._delete_btn,
            self._cancel_btn,
        ):
            widget.setEnabled(not busy)
        if not busy:
            self._task = None

    def wait_for_task(self, timeout_ms: int = 65_000) -> bool:
        """Let the application shutdown retain this dialog until probe completes."""

        return self._task is None or self._task.wait(timeout_ms)

    def reject(self) -> None:
        if self._task is None or not self._task.isRunning():
            super().reject()

    def closeEvent(self, event) -> None:  # noqa: N802 - Qt override
        if self._task is not None and self._task.isRunning():
            event.ignore()
            self._show("Wait for the provider request to finish safely.", ok=False)
            return
        super().closeEvent(event)

    def _show(self, text: str, ok: bool) -> None:
        color = COLORS["green"] if ok else COLORS["red"]
        self._result.setStyleSheet(f"color: {color};")
        self._result.setText(text)
