"""Doodle-style dialogs: new project, sources, and Kimi provider settings."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
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
    from .backend import Backend


def _hint(text: str) -> QLabel:
    label = QLabel(text)
    label.setFont(font_label(9))
    label.setStyleSheet(f"color: {COLORS['ink_soft']};")
    label.setWordWrap(True)
    return label


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

    def __init__(self, parent: QWidget | None = None) -> None:
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
        browse = DoodleButton("Browse...")
        browse.clicked.connect(self._browse_repo)
        repo_row.addWidget(self.repo_edit, stretch=1)
        repo_row.addWidget(browse)
        layout.addLayout(repo_row)

        attach = DoodleButton("Attach Read-Only Repository", kind="primary")
        attach.clicked.connect(self._attach_repo)
        layout.addWidget(attach)

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
            _hint("The API key goes to Windows Credential Manager, "
                  "never into project records.")
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
        save = DoodleButton("Save & Probe", kind="accent")
        save.setMinimumWidth(150)
        delete = DoodleButton("Delete Credential", kind="danger")
        cancel = DoodleButton("Cancel")
        save.clicked.connect(self._save)
        delete.clicked.connect(self._delete)
        cancel.clicked.connect(self.reject)
        row.addWidget(save)
        row.addWidget(delete)
        row.addStretch(1)
        row.addWidget(cancel)
        layout.addLayout(row)

        self._load()

    def _load(self) -> None:
        try:
            data = self._backend.get_provider()
        except Exception as exc:  # noqa: BLE001
            self._show(str(exc), ok=False)
            return
        self.base_url_edit.setText(str(data.get("base_url", "")))
        self.model_edit.setText(str(data.get("model", "")))
        if data:
            self._show("credential configured ✔", ok=True)

    def _save(self) -> None:
        try:
            self._backend.save_provider(
                self.base_url_edit.text().strip(),
                self.model_edit.text().strip(),
                self.key_edit.text(),
            )
        except Exception as exc:  # noqa: BLE001
            self._show(str(exc), ok=False)
            return
        self.key_edit.clear()
        self._show("saved & probed ✔", ok=True)

    def _delete(self) -> None:
        try:
            self._backend.delete_provider()
        except Exception as exc:  # noqa: BLE001
            self._show(str(exc), ok=False)
            return
        self.key_edit.clear()
        self._show("credential deleted", ok=True)

    def _show(self, text: str, ok: bool) -> None:
        color = COLORS["green"] if ok else COLORS["red"]
        self._result.setStyleSheet(f"color: {color};")
        self._result.setText(text)
