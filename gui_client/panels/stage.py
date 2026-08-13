"""02 / LIVE PROOF panel — candidate tabs, doodle preview canvas, actions."""

from __future__ import annotations

import json
import math
import secrets
from typing import TYPE_CHECKING

from PySide6.QtCore import Qt, QUrl, Signal
from PySide6.QtGui import QColor, QPainter, QPainterPath, QPen
from PySide6.QtWebEngineCore import QWebEnginePage
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QStackedWidget,
    QTabBar,
    QVBoxLayout,
    QWidget,
)

from ..theme import (
    COLORS,
    DoodleButton,
    DoodlePanel,
    font_display,
    font_label,
)

if TYPE_CHECKING:
    from ..backend import PreviewTarget, ProjectState

# action string -> button caption (order matters, mirrors the web workbench)
_ACTIONS: list[tuple[str, str]] = [
    ("generate_candidates", "GENERATE DIRECTIONS"),
    ("approve_direction", "APPROVE DIRECTION"),
    ("produce_artifact", "PRODUCE ARTIFACT"),
    ("validate_artifact", "RUN QUALITY GATE"),
    ("approve_export", "APPROVE EXPORT"),
    ("deliver", "DELIVER ZIP"),
]


class _PreviewPage(QWebEnginePage):
    """Trusted preview page that reports inspected anchors to Qt only."""

    object_selected = Signal(str, int, str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._channel = secrets.token_urlsafe(18)
        self._trusted_origin: tuple[str, str, int] | None = None
        self._trusted_path_prefix = ""

    @property
    def channel(self) -> str:
        return self._channel

    def trust(self, preview_url: str) -> None:
        url = QUrl(preview_url)
        self._trusted_origin = (url.scheme(), url.host(), url.port())
        self._trusted_path_prefix = url.path().rsplit("/", 1)[0] + "/"

    def acceptNavigationRequest(  # noqa: N802 - Qt override
        self,
        url: QUrl,
        navigation_type: QWebEnginePage.NavigationType,
        is_main_frame: bool,
    ) -> bool:
        del navigation_type
        if not is_main_frame:
            return False
        if url.toString() == "about:blank":
            return True
        return bool(
            self._trusted_origin
            and (url.scheme(), url.host(), url.port()) == self._trusted_origin
            and url.path().startswith(self._trusted_path_prefix)
        )

    def createWindow(  # noqa: N802 - Qt override
        self, window_type: QWebEnginePage.WebWindowType
    ) -> QWebEnginePage | None:
        del window_type
        return None

    def javaScriptConsoleMessage(  # noqa: N802 - Qt override
        self,
        level: QWebEnginePage.JavaScriptConsoleMessageLevel,
        message: str,
        line_number: int,
        source_id: str,
    ) -> None:
        del level, line_number, source_id
        prefix = f"__OEY_GUI_OBJECT__{self._channel}:"
        if not message.startswith(prefix):
            return
        try:
            payload = json.loads(message[len(prefix) :])
        except json.JSONDecodeError:
            return
        object_ref = payload.get("object_ref")
        owner_id = payload.get("owner_id")
        revision = payload.get("revision")
        if (
            isinstance(object_ref, str)
            and object_ref
            and isinstance(owner_id, str)
            and owner_id
            and isinstance(revision, int)
        ):
            self.object_selected.emit(owner_id, revision, object_ref)


def _star_path(cx: float, cy: float, radius: float) -> QPainterPath:
    path = QPainterPath()
    inner = radius * 0.45
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        r = radius if i % 2 == 0 else inner
        x = cx + r * math.cos(angle)
        y = cy + r * math.sin(angle)
        if i == 0:
            path.moveTo(x, y)
        else:
            path.lineTo(x, y)
    path.closeSubpath()
    return path


class DoodleCanvas(QWidget):
    """Placeholder preview: crayon dashed frame + hand-drawn decorations."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(320)

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt override
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = self.rect().adjusted(28, 28, -28, -28)

        # crayon dashed frame
        pen = QPen(QColor(COLORS["ink_soft"]), 3, Qt.PenStyle.DashLine)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawRoundedRect(rect, 24, 24)

        # handwritten invitation
        painter.setFont(font_display(20))
        painter.setPen(QColor(COLORS["ink_soft"]))
        painter.drawText(
            rect, Qt.AlignmentFlag.AlignCenter, "draw something here!"
        )

        self._draw_sun(painter, rect.left() + 52, rect.top() + 52, 22)
        self._draw_star(painter, rect.right() - 56, rect.top() + 56, 18)
        self._draw_waves(painter, rect)
        painter.end()

    def _draw_sun(self, painter: QPainter, cx: float, cy: float, r: float) -> None:
        pen = QPen(QColor(COLORS["orange"]), 3)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)
        painter.setBrush(QColor(COLORS["yellow"]))
        painter.drawEllipse(int(cx - r), int(cy - r), int(2 * r), int(2 * r))
        painter.setBrush(Qt.BrushStyle.NoBrush)
        for i in range(8):
            angle = i * math.pi / 4
            x1 = cx + (r + 6) * math.cos(angle)
            y1 = cy + (r + 6) * math.sin(angle)
            x2 = cx + (r + 14) * math.cos(angle)
            y2 = cy + (r + 14) * math.sin(angle)
            painter.drawLine(int(x1), int(y1), int(x2), int(y2))

    def _draw_star(self, painter: QPainter, cx: float, cy: float, r: float) -> None:
        painter.setPen(QPen(QColor(COLORS["ink"]), 2))
        painter.setBrush(QColor(COLORS["pink"]))
        painter.drawPath(_star_path(cx, cy, r))

    def _draw_waves(self, painter: QPainter, rect) -> None:
        pen = QPen(QColor(COLORS["blue"]), 3)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        base_y = rect.bottom() - 36
        for row, width in enumerate((140.0, 100.0)):
            path = QPainterPath()
            start_x = rect.left() + 40 + row * 30
            y = base_y - row * 16
            path.moveTo(start_x, y)
            x = start_x
            up = True
            while x < start_x + width:
                path.quadTo(x + 10, y - 10 if up else y + 10, x + 20, y)
                x += 20
                up = not up
            painter.drawPath(path)


class StagePanel(DoodlePanel):
    """Middle column: project meta, candidate tabs, preview and actions."""

    command_requested = Signal(str)
    object_selected = Signal(str)
    target_changed = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__("02 / LIVE PROOF", parent)
        self._targets: list[PreviewTarget] = []
        self._last_focus: tuple[str, int] | None = None
        self._announced_target: tuple[str, int] | None = None

        self._meta = QLabel("NO PROJECT · r—")
        self._meta.setFont(font_label(9))
        self._meta.setStyleSheet(f"color: {COLORS['ink_soft']};")
        self.content_layout().addWidget(self._meta)

        self._tabs = QTabBar()
        self._tabs.setFont(font_label(9))
        self._tabs.setDrawBase(False)
        self._tabs.currentChanged.connect(self._show_current_preview)
        self.content_layout().addWidget(self._tabs)

        # A rounded preview well owns both the placeholder and WebEngine view.
        # The small inset prevents a square child surface from visually cutting
        # through the rounded shell when switching between targets.
        self._preview_well = QFrame()
        self._preview_well.setObjectName("previewWell")
        self._preview_well.setStyleSheet(
            f"QFrame#previewWell {{ background: {COLORS['paper_alt']}; "
            f"border: 2px solid {COLORS['ink']}; border-radius: 16px; }}"
        )
        preview_layout = QVBoxLayout(self._preview_well)
        preview_layout.setContentsMargins(4, 4, 4, 4)
        preview_layout.setSpacing(0)
        self._preview_stack = QStackedWidget()
        self._preview_stack.setStyleSheet(
            f"QStackedWidget {{ background: {COLORS['paper']}; "
            "border: none; border-radius: 12px; }}"
        )
        self._canvas = DoodleCanvas()
        self._preview_page = _PreviewPage(self)
        self._preview_page.object_selected.connect(self._accept_object_selection)
        self._preview = QWebEngineView()
        self._preview.setPage(self._preview_page)
        self._preview.setZoomFactor(0.75)
        self._preview.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        self._preview.loadFinished.connect(self._preview_loaded)
        self._preview_stack.addWidget(self._canvas)
        self._preview_stack.addWidget(self._preview)
        preview_layout.addWidget(self._preview_stack)
        self.content_layout().addWidget(self._preview_well, stretch=1)

        self._caption = QLabel("No rendered artifact — yet!")
        self._caption.setFont(font_label(9))
        self._caption.setStyleSheet(f"color: {COLORS['ink_soft']};")
        self.content_layout().addWidget(self._caption)

        button_row = QHBoxLayout()
        button_row.setSpacing(8)
        self._action_buttons: dict[str, DoodleButton] = {}
        for action, caption in _ACTIONS:
            button = DoodleButton(caption, kind="primary")
            button.setVisible(False)
            button.clicked.connect(
                lambda _=False, a=action: self.command_requested.emit(a)
            )
            self._action_buttons[action] = button
            button_row.addWidget(button)
        button_row.addStretch(1)
        self.content_layout().addLayout(button_row)

    # ------------------------------------------------------------------ API
    def set_state(self, state: ProjectState | None) -> None:
        if state is None:
            self._meta.setText("NO PROJECT · r—")
            self._set_targets(None)
            self._set_actions([])
            return
        readiness = str(getattr(state, "readiness", "") or "draft").upper()
        revision = getattr(state, "revision", "—")
        name = getattr(state, "name", "") or "Untitled"
        self._meta.setText(f"{name} · {readiness} · r{revision}")
        self._set_targets(state)
        self._set_actions(list(getattr(state, "actions", []) or []))

    def current_candidate_id(self) -> str | None:
        target = self.current_target()
        return target.id if target and target.kind == "candidate" else None

    def current_target(self) -> PreviewTarget | None:
        index = self._tabs.currentIndex()
        return self._targets[index] if 0 <= index < len(self._targets) else None

    # -------------------------------------------------------------- internals
    def _set_targets(self, state: ProjectState | None) -> None:
        from ..backend import PreviewTarget

        candidates = list(getattr(state, "candidates", []) or []) if state else []
        focus = getattr(state, "focus", None) if state else None
        targets = [
            PreviewTarget(
                kind="candidate",
                id=str(getattr(candidate, "id", "")),
                revision=int(getattr(candidate, "revision", 1)),
                title=str(getattr(candidate, "title", "Untitled direction")),
                preview_url=str(getattr(candidate, "preview_url", "")),
                visual_review=dict(getattr(candidate, "visual_review", {}) or {}),
            )
            for candidate in candidates
        ]
        if focus is not None and str(getattr(focus, "kind", "")) == "artifact":
            targets.append(focus)
        previous_target = self.current_target()
        previous_binding = (
            (previous_target.id, previous_target.revision)
            if previous_target is not None
            else None
        )
        self._targets = targets
        self._tabs.blockSignals(True)
        while self._tabs.count():
            self._tabs.removeTab(0)
        for index, target in enumerate(targets):
            if target.kind == "artifact":
                label = f"ARTIFACT · r{target.revision}"
            else:
                status = str(getattr(candidates[index], "status", "")).upper()
                marker = " ✓" if status == "APPROVED" else ""
                label = f"{index + 1:02d} · {target.title}{marker}"
            self._tabs.addTab(label)
        selected = -1
        if previous_binding is not None:
            selected = next(
                (
                    index
                    for index, target in enumerate(targets)
                    if (target.id, target.revision) == previous_binding
                ),
                -1,
            )
        focus_binding = (
            (str(getattr(focus, "id", "")), int(getattr(focus, "revision", 1)))
            if focus is not None
            else None
        )
        if focus_binding is not None and focus_binding != self._last_focus:
            selected = next(
                (
                    index
                    for index, target in enumerate(targets)
                    if (target.id, target.revision) == focus_binding
                ),
                selected,
            )
        self._last_focus = focus_binding
        if targets:
            self._tabs.setCurrentIndex(selected if selected >= 0 else 0)
        self._tabs.setVisible(bool(targets))
        self._tabs.blockSignals(False)
        self._show_current_preview()

    def _show_current_preview(self) -> None:
        target = self.current_target()
        if target is None or not target.preview_url:
            self._preview_stack.setCurrentWidget(self._canvas)
            self._caption.setText("No trusted render yet — keep talking to the Agent.")
            self._announce_target(target)
            return
        current = self._preview.url().toString()
        if current != target.preview_url:
            self._caption.setText(f"loading trusted preview · {target.title}")
            self._preview_page.trust(target.preview_url)
            self._preview.setUrl(QUrl(target.preview_url))
        else:
            self._caption.setText(
                f"trusted preview · {target.kind} r{target.revision} · click to inspect"
            )
        self._preview_stack.setCurrentWidget(self._preview)
        self._announce_target(target)

    def _announce_target(self, target: PreviewTarget | None) -> None:
        binding = (target.id, target.revision) if target else None
        if binding != self._announced_target:
            self._announced_target = binding
            self.target_changed.emit()

    def _preview_loaded(self, ok: bool) -> None:
        target = self.current_target()
        if not ok or target is None:
            self._caption.setText("Preview could not be loaded — refresh the project.")
            return
        if self._preview.url().toString() != target.preview_url:
            return
        channel = json.dumps(self._preview_page.channel)
        owner_id = json.dumps(target.id)
        revision = target.revision
        script = f"""
        (() => {{
          if (window.__oeyGuiInspectorInstalled) return;
          window.__oeyGuiInspectorInstalled = true;
          document.addEventListener('click', event => {{
            const node = event.target.closest('[data-oey-object]');
            if (!node) return;
            event.preventDefault();
            console.log('__OEY_GUI_OBJECT__' + {channel} + ':' + JSON.stringify({{
              owner_id: {owner_id},
              revision: {revision},
              object_ref: node.getAttribute('data-oey-object')
            }}));
          }}, true);
        }})();
        """
        self._preview.page().runJavaScript(script)
        self._caption.setText(
            f"trusted preview · {target.kind} r{target.revision} · click to inspect"
        )

    def _accept_object_selection(
        self, owner_id: str, revision: int, object_ref: str
    ) -> None:
        target = self.current_target()
        if (
            target is not None
            and target.id == owner_id
            and target.revision == revision
            and self._preview.url().toString() == target.preview_url
        ):
            self.object_selected.emit(object_ref)

    def _set_actions(self, actions: list[str]) -> None:
        available = set(actions)
        for action, button in self._action_buttons.items():
            button.setVisible(action in available)
