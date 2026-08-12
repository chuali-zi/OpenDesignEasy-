"""03 / PROJECT FILE panel — readiness, sources, quality, runs, history."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QColor, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from ..theme import (
    COLORS,
    DoodleButton,
    DoodleChip,
    DoodlePanel,
    font_body,
    font_label,
)

if TYPE_CHECKING:
    from ..backend import ProjectState

_PRIVACY_TEXT = (
    "LOCAL TRUST BOUNDARY — Keys stay in Windows Credential Manager. "
    "Repositories remain read-only. Reference images are analysis-only. "
    "供应商 payload 不写入项目记录。"
)


def _g(obj: object, name: str, default: object = None) -> object:
    return getattr(obj, name, default)


def _clear(layout: QVBoxLayout) -> None:
    while layout.count():
        item = layout.takeAt(0)
        widget = item.widget()
        if widget is not None:
            widget.deleteLater()
        elif item.layout() is not None:
            _clear_layout(item.layout())


def _clear_layout(layout) -> None:
    while layout.count():
        item = layout.takeAt(0)
        if item.widget() is not None:
            item.widget().deleteLater()
        elif item.layout() is not None:
            _clear_layout(item.layout())


class StarRating(QWidget):
    """Five crayon stars; filled ones show the score (0-100 -> 0-5)."""

    def __init__(self, score: int = 0, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._filled = max(0, min(5, round(score / 20)))

    def sizeHint(self) -> QSize:  # noqa: N802 - Qt override
        return QSize(5 * 26, 26)

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt override
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        for i in range(5):
            cx, cy = 13 + i * 26, 13
            path = QPainterPath()
            inner = 9.0 * 0.45
            for k in range(10):
                angle = -math.pi / 2 + k * math.pi / 5
                r = 9.0 if k % 2 == 0 else inner
                x, y = cx + r * math.cos(angle), cy + r * math.sin(angle)
                if k == 0:
                    path.moveTo(x, y)
                else:
                    path.lineTo(x, y)
            path.closeSubpath()
            painter.setPen(QPen(QColor(COLORS["ink"]), 2))
            filled = i < self._filled
            painter.setBrush(
                QColor(COLORS["yellow"]) if filled else Qt.BrushStyle.NoBrush
            )
            painter.drawPath(path)
        painter.end()


class InspectorPanel(DoodlePanel):
    """Right column: evidence, quality and release truth."""

    add_source_requested = Signal()
    restore_requested = Signal(int)
    download_requested = Signal(str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__("03 / PROJECT FILE", parent)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        body = QWidget()
        self._body_layout = QVBoxLayout(body)
        self._body_layout.setContentsMargins(2, 2, 2, 2)
        self._body_layout.setSpacing(10)

        self._readiness_box = self._section("Readiness")
        self._sources_box = self._section("Sources", add_button=True)
        self._quality_box = self._section("Quality")
        self._runs_box = self._section("Runs")
        self._history_box = self._section("History")
        self._release_box = self._section("Release")

        privacy = QLabel(_PRIVACY_TEXT)
        privacy.setFont(font_label(8))
        privacy.setStyleSheet(f"color: {COLORS['ink_soft']};")
        privacy.setWordWrap(True)
        self._body_layout.addWidget(privacy)
        self._body_layout.addStretch(1)

        scroll.setWidget(body)
        self.content_layout().addWidget(scroll, stretch=1)

    # ------------------------------------------------------------------ API
    def set_state(self, state: ProjectState | None) -> None:
        for box in (
            self._readiness_box,
            self._sources_box,
            self._quality_box,
            self._runs_box,
            self._history_box,
            self._release_box,
        ):
            _clear(box)
        if state is None:
            self._readiness_box.addWidget(self._note("No project selected."))
            return
        self._fill_readiness(state)
        self._fill_sources(state)
        self._fill_quality(state)
        self._fill_runs(state)
        self._fill_history(state)
        self._fill_release(state)

    # -------------------------------------------------------------- sections
    def _section(self, title: str, add_button: bool = False) -> QVBoxLayout:
        frame = QFrame()
        layout = QVBoxLayout(frame)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(4)
        header = QHBoxLayout()
        label = QLabel(title)
        label.setFont(font_label(10))
        header.addWidget(label)
        header.addStretch(1)
        if add_button:
            btn = DoodleButton("＋ Add")
            btn.setMinimumHeight(26)
            btn.clicked.connect(self.add_source_requested.emit)
            header.addWidget(btn)
        layout.addLayout(header)
        content = QVBoxLayout()
        content.setSpacing(4)
        layout.addLayout(content)
        self._body_layout.addWidget(frame)
        return content

    def _note(self, text: str) -> QLabel:
        label = QLabel(text)
        label.setFont(font_body(9))
        label.setStyleSheet(f"color: {COLORS['ink_soft']};")
        label.setWordWrap(True)
        return label

    def _fill_readiness(self, state: ProjectState) -> None:
        readiness = str(_g(state, "readiness", "draft")).lower()
        if readiness == "ready":
            chip = DoodleChip("READY", color="green")
        elif readiness == "blocked":
            chip = DoodleChip("BLOCKED", color="red")
        else:
            chip = DoodleChip(readiness.upper() or "DRAFT", color="orange")
        self._readiness_box.addWidget(chip)
        blockers = list(_g(state, "blockers", []) or [])
        if blockers:
            for blocker in blockers:
                self._readiness_box.addWidget(self._note(f"· {blocker}"))
        else:
            self._readiness_box.addWidget(
                self._note("All production capabilities are available.")
            )

    def _fill_sources(self, state: ProjectState) -> None:
        sources = list(_g(state, "sources", []) or [])
        if not sources:
            self._sources_box.addWidget(self._note("No sources attached."))
            return
        for source in sources:
            row = QHBoxLayout()
            kind = str(_g(source, "kind", "note")).upper()
            row.addWidget(DoodleChip(kind, color="purple"))
            name = QLabel(str(_g(source, "label", "")))
            name.setFont(font_body(9))
            name.setWordWrap(True)
            row.addWidget(name, stretch=1)
            holder = QWidget()
            holder.setLayout(row)
            row.setContentsMargins(0, 0, 0, 0)
            self._sources_box.addWidget(holder)

    def _fill_quality(self, state: ProjectState) -> None:
        quality = _g(state, "quality")
        if quality is None:
            self._quality_box.addWidget(DoodleChip("UNASSESSED", color="ink_soft"))
            self._quality_box.addWidget(self._note("Not assessed yet."))
            return
        verdict = str(_g(quality, "verdict", "pending")).lower()
        if verdict == "pass":
            chip = DoodleChip("PASS", color="green")
        elif verdict in {"fail", "block"}:
            chip = DoodleChip("BLOCK", color="red")
        else:
            chip = DoodleChip("UNASSESSED", color="ink_soft")
        self._quality_box.addWidget(chip)
        score = int(_g(quality, "visual_score", 0) or 0)
        visual_verdict = str(_g(quality, "visual_verdict", "pending")).lower()
        if visual_verdict == "pass":
            self._quality_box.addWidget(DoodleChip("VISUAL PASS", color="green"))
        elif visual_verdict in {"repair", "block", "fail"}:
            self._quality_box.addWidget(
                DoodleChip(f"VISUAL {visual_verdict.upper()}", color="red")
            )
        stars_row = QHBoxLayout()
        stars_row.addWidget(StarRating(score))
        score_label = QLabel(f"{score}/100")
        score_label.setFont(font_body(9))
        stars_row.addWidget(score_label)
        stars_row.addStretch(1)
        self._quality_box.addLayout(stars_row)
        for error in list(_g(quality, "hard_errors", []) or []):
            self._quality_box.addWidget(self._note(f"✗ {error}"))

    def _fill_runs(self, state: ProjectState) -> None:
        runs = list(_g(state, "runs", []) or [])
        if not runs:
            self._runs_box.addWidget(self._note("No runs yet."))
            return
        for run in reversed(runs[-6:]):
            text = (
                f"{_g(run, 'id', '')} · "
                f"{str(_g(run, 'status', '')).upper()} · "
                f"{_g(run, 'elapsed', '')}"
            )
            self._runs_box.addWidget(self._note(text))

    def _fill_history(self, state: ProjectState) -> None:
        history = list(_g(state, "history", []) or [])
        if not history:
            self._history_box.addWidget(self._note("No revision history."))
            return
        for item in reversed(history[-6:]):
            revision = int(_g(item, "revision", 0) or 0)
            label = str(_g(item, "label", ""))
            current = bool(_g(item, "current", False))
            row = QHBoxLayout()
            text = QLabel(f"r{revision} · {label}")
            text.setFont(font_body(9))
            row.addWidget(text, stretch=1)
            if not current:
                btn = DoodleButton("RESTORE")
                btn.setMinimumHeight(24)
                btn.clicked.connect(
                    lambda _=False, r=revision: self.restore_requested.emit(r)
                )
                row.addWidget(btn)
            holder = QWidget()
            holder.setLayout(row)
            row.setContentsMargins(0, 0, 0, 0)
            self._history_box.addWidget(holder)

    def _fill_release(self, state: ProjectState) -> None:
        deliveries = list(_g(state, "deliveries", []) or [])
        if not deliveries:
            self._release_box.addWidget(self._note("No immutable delivery."))
            return
        for delivery in deliveries:
            row = QHBoxLayout()
            label = QLabel(str(_g(delivery, "label", "")))
            label.setFont(font_body(9))
            label.setWordWrap(True)
            row.addWidget(label, stretch=1)
            btn = DoodleButton("Download ZIP", kind="accent")
            btn.setMinimumHeight(24)
            delivery_id = str(_g(delivery, "id", ""))
            btn.clicked.connect(
                lambda _=False, d=delivery_id: self.download_requested.emit(d)
            )
            row.addWidget(btn)
            holder = QWidget()
            holder.setLayout(row)
            row.setContentsMargins(0, 0, 0, 0)
            self._release_box.addWidget(holder)
