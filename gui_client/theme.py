"""Kids doodle / crayon hand-drawn theme for the OEYdesign desktop client.

Provides crayon colors, handwriting fonts, and the core doodle widgets
(DoodlePanel / DoodleButton / DoodleChip) plus a global application style.
"""

from __future__ import annotations

import random

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import (
    QColor,
    QFont,
    QFontDatabase,
    QPainter,
    QPainterPath,
    QPalette,
    QPen,
)
from PySide6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

# ---------------------------------------------------------------------------
# Crayon palette
# ---------------------------------------------------------------------------

COLORS: dict[str, str] = {
    "paper": "#FFF6E5",
    "paper_alt": "#FFEFD0",
    "ink": "#33312E",
    "ink_soft": "#8A8577",
    "red": "#FF6B6B",
    "blue": "#4D96FF",
    "yellow": "#FFD93D",
    "green": "#6BCB77",
    "pink": "#FF9CEE",
    "purple": "#B983FF",
    "orange": "#FF9F45",
}

# Handwriting font preference order (all ship with Windows).
_HANDWRITING_FAMILIES = ["Segoe Print", "Ink Free", "Comic Sans MS"]

_cached_family: str | None = None


def _handwriting_family() -> str:
    """Pick the first available handwriting font, with fallbacks."""
    global _cached_family
    if _cached_family is None:
        _cached_family = "Comic Sans MS"
        try:
            families = set(QFontDatabase.families())
        except Exception:  # noqa: BLE001 - headless probing fallback
            families = set()
        for name in _HANDWRITING_FAMILIES:
            if not families or name in families:
                _cached_family = name
                break
    return _cached_family


def font_display(size: int) -> QFont:
    """Big display/title font: handwriting, bold."""
    font = QFont(_handwriting_family(), size)
    font.setBold(True)
    return font


def font_body(size: int) -> QFont:
    """Body text font: handwriting, regular weight."""
    return QFont(_handwriting_family(), size)


def font_label(size: int) -> QFont:
    """Small label font: bold with wide letter spacing."""
    font = QFont(_handwriting_family(), size)
    font.setBold(True)
    font.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, 2.0)
    return font


# ---------------------------------------------------------------------------
# Wobbly hand-drawn border helper
# ---------------------------------------------------------------------------

_WOBBLE_AMPLITUDE = 2.0  # px jitter per segment endpoint
_SEGMENTS_PER_SIDE = 6


def _wobbly_rect_path(rect: QRectF, radius: float, seed: int) -> QPainterPath:
    """Build a slightly wobbly rounded-rect path.

    Each edge is split into segments whose endpoints get a small random
    offset. The seed is fixed per widget so repaints are stable (no flicker).
    """
    rng = random.Random(seed)
    x0, y0 = rect.left(), rect.top()
    x1, y1 = rect.right(), rect.bottom()
    corners = [
        (QPointF(x0, y0), QPointF(x1, y0)),  # top
        (QPointF(x1, y0), QPointF(x1, y1)),  # right
        (QPointF(x1, y1), QPointF(x0, y1)),  # bottom
        (QPointF(x0, y1), QPointF(x0, y0)),  # left
    ]

    def jitter(p: QPointF) -> QPointF:
        return QPointF(
            p.x() + rng.uniform(-_WOBBLE_AMPLITUDE, _WOBBLE_AMPLITUDE),
            p.y() + rng.uniform(-_WOBBLE_AMPLITUDE, _WOBBLE_AMPLITUDE),
        )

    pts: list[QPointF] = []
    for start, end in corners:
        for i in range(_SEGMENTS_PER_SIDE):
            t = i / _SEGMENTS_PER_SIDE
            base = QPointF(
                start.x() + (end.x() - start.x()) * t,
                start.y() + (end.y() - start.y()) * t,
            )
            pts.append(jitter(base))

    # Quadratic smoothing through jittered points gives a hand-drawn feel.
    path = QPainterPath()
    path.moveTo(pts[0])
    count = len(pts)
    for i in range(1, count + 1):
        prev = pts[i - 1]
        cur = pts[i % count]
        mid = QPointF((prev.x() + cur.x()) / 2.0, (prev.y() + cur.y()) / 2.0)
        path.quadTo(prev, mid)
    path.closeSubpath()

    # Clip to the rounded rect so corners stay pleasingly round.
    clip = QPainterPath()
    clip.addRoundedRect(rect, radius, radius)
    return path.intersected(clip)


def _stable_seed(widget: QWidget) -> int:
    """Per-widget stable seed derived from its object address."""
    return id(widget) & 0x7FFFFFFF


def _paint_doodle_frame(
    painter: QPainter,
    widget: QWidget,
    fill: str,
    ink: str | None = None,
    radius: float = 14.0,
    pen_width: float = 2.2,
) -> None:
    """Fill + wobbly ink border for a doodle widget."""
    ink_color = ink or COLORS["ink"]
    rect = QRectF(widget.rect()).adjusted(
        pen_width, pen_width, -pen_width, -pen_width
    )
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)

    clip = QPainterPath()
    clip.addRoundedRect(rect, radius, radius)
    painter.fillPath(clip, QColor(fill))

    path = _wobbly_rect_path(rect, radius, _stable_seed(widget))
    pen = QPen(QColor(ink_color))
    pen.setWidthF(pen_width)
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
    painter.setPen(pen)
    painter.setBrush(Qt.BrushStyle.NoBrush)
    painter.drawPath(path)


# ---------------------------------------------------------------------------
# Widgets
# ---------------------------------------------------------------------------


class DoodlePanel(QFrame):
    """Paper panel with a wobbly hand-drawn ink border and optional title.

    The title (e.g. "01 / BRIEF") is shown in the top-left corner in the
    small label font. Callers put their content into ``content_layout()``,
    which already accounts for the title row and inner padding.
    """

    def __init__(self, title: str = "", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._title = title
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, False)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(16, 12, 16, 14)
        outer.setSpacing(8)

        if title:
            label = QLabel(title, self)
            label.setFont(font_label(10))
            label.setStyleSheet(f"color: {COLORS['ink_soft']};")
            outer.addWidget(label, alignment=Qt.AlignmentFlag.AlignLeft)

        self._content = QVBoxLayout()
        self._content.setContentsMargins(4, 2, 4, 2)
        self._content.setSpacing(8)
        outer.addLayout(self._content, stretch=1)

    def content_layout(self) -> QVBoxLayout:
        """Layout for callers to fill with the panel's content."""
        return self._content

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt override
        painter = QPainter(self)
        _paint_doodle_frame(painter, self, COLORS["paper"])
        painter.end()
        super().paintEvent(event)


_BUTTON_FILL: dict[str, str] = {
    "primary": COLORS["yellow"],
    "danger": COLORS["red"],
    "accent": COLORS["green"],
    "plain": COLORS["paper_alt"],
}


class DoodleButton(QPushButton):
    """Crayon-style button: paper fill, wobbly ink border.

    On hover it tilts slightly (±1 degree, stable per instance) and the
    fill switches to its crayon color. ``kind`` selects the crayon color:
    "primary" (yellow), "danger" (red), "accent" (green), "plain".
    """

    def __init__(
        self,
        text: str,
        kind: str = "plain",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(text, parent)
        self._kind = kind if kind in _BUTTON_FILL else "plain"
        self._tilt = 1.0 if (_stable_seed(self) % 2 == 0) else -1.0
        self.setFont(font_body(11))
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setMinimumHeight(34)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt override
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)

        if self.underMouse() and self.isEnabled():
            cx = self.width() / 2.0
            cy = self.height() / 2.0
            painter.translate(cx, cy)
            painter.rotate(self._tilt)
            painter.translate(-cx, -cy)
            fill = _BUTTON_FILL[self._kind]
        else:
            fill = (
                COLORS["paper_alt"]
                if self._kind == "plain"
                else _mix(fill=_BUTTON_FILL[self._kind], ratio=0.35)
            )

        ink = COLORS["ink"] if self.isEnabled() else COLORS["ink_soft"]
        _paint_doodle_frame(painter, self, fill, ink=ink, radius=12.0)

        painter.setPen(QColor(ink))
        painter.setFont(self.font())
        flags = int(Qt.AlignmentFlag.AlignCenter)
        painter.drawText(self.rect(), flags, self.text())
        painter.end()


def _mix(fill: str, ratio: float) -> QColor:
    """Blend a crayon color toward paper (ratio=1.0 keeps the crayon color)."""
    base = QColor(COLORS["paper"])
    crayon = QColor(fill)
    r = base.red() + (crayon.red() - base.red()) * ratio
    g = base.green() + (crayon.green() - base.green()) * ratio
    b = base.blue() + (crayon.blue() - base.blue()) * ratio
    return QColor(int(r), int(g), int(b))


class DoodleChip(QFrame):
    """Small pill chip (status badge, selected-object tag, ...).

    Shows text plus an optional close button which emits ``closed``.
    ``color`` may be a key of ``COLORS`` or any CSS color string.
    """

    closed = Signal()

    def __init__(
        self,
        text: str,
        color: str = "",
        closable: bool = False,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._fill = COLORS.get(color, color) if color else COLORS["paper_alt"]

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 4, 8 if closable else 12, 4)
        layout.setSpacing(6)

        self._label = QLabel(text, self)
        self._label.setFont(font_label(9))
        self._label.setStyleSheet(f"color: {COLORS['ink']}; border: none;")
        layout.addWidget(self._label)

        if closable:
            close_btn = QToolButton(self)
            close_btn.setText("×")
            close_btn.setFont(font_label(10))
            close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            close_btn.setStyleSheet(
                "QToolButton { border: none; color: "
                + COLORS["ink_soft"]
                + "; } QToolButton:hover { color: "
                + COLORS["red"]
                + "; }"
            )
            close_btn.clicked.connect(self.closed.emit)
            layout.addWidget(close_btn)

        self.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)

    def set_text(self, text: str) -> None:
        self._label.setText(text)

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt override
        painter = QPainter(self)
        _paint_doodle_frame(
            painter, self, self._fill, radius=self.height() / 2.0, pen_width=1.8
        )
        painter.end()
        super().paintEvent(event)


# ---------------------------------------------------------------------------
# Global application style
# ---------------------------------------------------------------------------


def apply_app_style(app: QApplication) -> None:
    """Apply global font, palette, and QSS for input/tooltip widgets."""
    app.setFont(font_body(11))

    palette = app.palette()
    paper = QColor(COLORS["paper"])
    ink = QColor(COLORS["ink"])
    palette.setColor(QPalette.ColorRole.Window, paper)
    palette.setColor(QPalette.ColorRole.WindowText, ink)
    palette.setColor(QPalette.ColorRole.Base, paper)
    palette.setColor(QPalette.ColorRole.AlternateBase, QColor(COLORS["paper_alt"]))
    palette.setColor(QPalette.ColorRole.Text, ink)
    palette.setColor(QPalette.ColorRole.Button, QColor(COLORS["paper_alt"]))
    palette.setColor(QPalette.ColorRole.ButtonText, ink)
    palette.setColor(QPalette.ColorRole.ToolTipBase, QColor(COLORS["yellow"]))
    palette.setColor(QPalette.ColorRole.ToolTipText, ink)
    palette.setColor(QPalette.ColorRole.Highlight, QColor(COLORS["blue"]))
    palette.setColor(QPalette.ColorRole.HighlightedText, paper)
    app.setPalette(palette)

    app.setStyleSheet(
        f"""
        QWidget {{
            background: {COLORS['paper']};
            color: {COLORS['ink']};
        }}
        QLineEdit, QTextEdit, QPlainTextEdit, QComboBox, QSpinBox {{
            background: {COLORS['paper']};
            border: 2px solid {COLORS['ink']};
            border-radius: 10px;
            padding: 6px 10px;
            selection-background-color: {COLORS['blue']};
            selection-color: {COLORS['paper']};
        }}
        QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus,
        QComboBox:focus, QSpinBox:focus {{
            border: 2px solid {COLORS['blue']};
        }}
        QComboBox::drop-down {{
            border: none;
            width: 24px;
        }}
        QComboBox QAbstractItemView {{
            background: {COLORS['paper']};
            border: 2px solid {COLORS['ink']};
            border-radius: 8px;
            selection-background-color: {COLORS['yellow']};
            selection-color: {COLORS['ink']};
        }}
        QTabWidget::pane {{
            border: 2px solid {COLORS['ink']};
            border-radius: 12px;
            background: {COLORS['paper']};
            top: -2px;
        }}
        QTabBar::tab {{
            background: {COLORS['paper_alt']};
            border: 2px solid {COLORS['ink']};
            border-bottom: none;
            border-top-left-radius: 10px;
            border-top-right-radius: 10px;
            padding: 6px 16px;
            margin-right: 4px;
        }}
        QTabBar::tab:selected {{
            background: {COLORS['yellow']};
        }}
        QTabBar::tab:hover:!selected {{
            background: {COLORS['paper']};
        }}
        QScrollBar:vertical {{
            background: {COLORS['paper_alt']};
            width: 12px;
            border-radius: 6px;
        }}
        QScrollBar::handle:vertical {{
            background: {COLORS['ink_soft']};
            min-height: 24px;
            border-radius: 6px;
        }}
        QScrollBar::handle:vertical:hover {{
            background: {COLORS['ink']};
        }}
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
            height: 0px;
        }}
        QScrollBar:horizontal {{
            background: {COLORS['paper_alt']};
            height: 12px;
            border-radius: 6px;
        }}
        QScrollBar::handle:horizontal {{
            background: {COLORS['ink_soft']};
            min-width: 24px;
            border-radius: 6px;
        }}
        QScrollBar::handle:horizontal:hover {{
            background: {COLORS['ink']};
        }}
        QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
            width: 0px;
        }}
        QToolTip {{
            background: {COLORS['yellow']};
            color: {COLORS['ink']};
            border: 2px solid {COLORS['ink']};
            border-radius: 8px;
            padding: 6px 10px;
        }}
        """
    )
