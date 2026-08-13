"""01 / BRIEF panel — conversation, run strip and message composer."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtGui import QKeyEvent
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPlainTextEdit,
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
    from collections.abc import Sequence

    from ..backend import ActivityEvent, Message, RunInfo


def _g(obj: object, name: str, default: object = None) -> object:
    """Tiny defensive getattr so backend field tweaks do not break the GUI."""
    return getattr(obj, name, default)


class _ComposerEdit(QPlainTextEdit):
    """Multiline input that emits ``submitted`` on Ctrl+Enter."""

    submitted = Signal()

    def keyPressEvent(self, event: QKeyEvent) -> None:
        is_enter = event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter)
        if is_enter and event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            self.submitted.emit()
            return
        super().keyPressEvent(event)


class BriefPanel(DoodlePanel):
    """Left column: chat bubbles, active-run strip and the composer."""

    message_sent = Signal(str)
    object_message_sent = Signal(str, str)  # text, object_ref
    run_action_requested = Signal(str, str)  # "pause" | "resume" | "cancel", run_id

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__("01 / BRIEF", parent)
        self._object_ref: str | None = None
        self._run_id: str | None = None
        self._message_signature: tuple[tuple[str, str, str, str], ...] = ()
        self._activity_run_id = ""
        self._activity_sequences: set[int] = set()
        self._activity_tail_kind = ""
        self._activity_tail_widget: QLabel | None = None

        hint = QLabel("Describe the outcome. The project remembers the rest.")
        hint.setFont(font_label(9))
        hint.setStyleSheet(f"color: {COLORS['ink_soft']};")
        hint.setWordWrap(True)
        self.content_layout().addWidget(hint)

        # --- message list -------------------------------------------------
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setFrameShape(QFrame.Shape.NoFrame)
        self._messages_host = QWidget()
        self._messages_layout = QVBoxLayout(self._messages_host)
        self._messages_layout.setContentsMargins(2, 2, 2, 2)
        self._messages_layout.setSpacing(8)
        self._messages_layout.addStretch(1)
        self._scroll.setWidget(self._messages_host)
        self.content_layout().addWidget(self._scroll, stretch=1)

        # This deliberately shows safe operational summaries, never private
        # reasoning.  Entries append in place so a polling update cannot make
        # the chat/preview stutter or reset the user's scroll position.
        self._activity_box = QFrame()
        self._activity_box.setStyleSheet(
            f"QFrame {{ background: {COLORS['paper_alt']};"
            f" border: 2px dashed {COLORS['blue']}; border-radius: 10px; }}"
        )
        activity_col = QVBoxLayout(self._activity_box)
        activity_col.setContentsMargins(8, 6, 8, 6)
        activity_col.setSpacing(5)
        activity_heading = QLabel("AGENT ACTIVITY · SAFE PROCESS SUMMARY")
        activity_heading.setFont(font_label(8))
        activity_heading.setStyleSheet(f"color: {COLORS['ink_soft']}; border: none;")
        activity_col.addWidget(activity_heading)
        self._activity_scroll = QScrollArea()
        self._activity_scroll.setWidgetResizable(True)
        self._activity_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self._activity_scroll.setStyleSheet(
            f"QScrollArea, QScrollArea > QWidget > QWidget {{ "
            f"background: {COLORS['paper_alt']}; border: none; }}"
        )
        self._activity_scroll.setFixedHeight(118)
        self._activity_host = QWidget()
        self._activity_host.setStyleSheet(f"background: {COLORS['paper_alt']};")
        self._activity_layout = QVBoxLayout(self._activity_host)
        self._activity_layout.setContentsMargins(0, 0, 2, 0)
        self._activity_layout.setSpacing(4)
        self._activity_layout.addStretch(1)
        self._activity_scroll.setWidget(self._activity_host)
        activity_col.addWidget(self._activity_scroll)
        self._activity_box.hide()
        self.content_layout().addWidget(self._activity_box)

        # --- active run strip ---------------------------------------------
        self._run_strip = QFrame()
        self._run_strip.setStyleSheet(
            f"QFrame {{ background: {COLORS['paper_alt']};"
            f" border: 2px dashed {COLORS['ink']}; border-radius: 10px; }}"
        )
        strip_col = QVBoxLayout(self._run_strip)
        strip_col.setContentsMargins(8, 4, 8, 6)
        strip_col.setSpacing(4)
        top_row = QHBoxLayout()
        self._run_label = QLabel("RUNNING")
        self._run_label.setFont(font_label(9))
        self._run_elapsed = QLabel("0.0s")
        self._run_elapsed.setFont(font_body(9))
        top_row.addWidget(self._run_label, stretch=1)
        top_row.addWidget(self._run_elapsed)
        strip_col.addLayout(top_row)
        btn_row = QHBoxLayout()
        btn_row.addStretch(1)
        self._pause_btn = DoodleButton("Pause")
        self._resume_btn = DoodleButton("Resume")
        self._cancel_btn = DoodleButton("Cancel", kind="danger")
        for btn, action in (
            (self._pause_btn, "pause"),
            (self._resume_btn, "resume"),
            (self._cancel_btn, "cancel"),
        ):
            btn.setMinimumHeight(26)
            btn.setFont(font_body(9))
            btn.clicked.connect(lambda _=False, a=action: self._emit_run_action(a))
            btn_row.addWidget(btn)
        strip_col.addLayout(btn_row)
        self._run_strip.hide()
        self.content_layout().addWidget(self._run_strip)

        # --- selection chip -------------------------------------------------
        self._selection_chip = DoodleChip("TARGET", color=COLORS["pink"], closable=True)
        self._selection_chip.closed.connect(self.clear_selection)
        self._selection_chip.hide()
        self.content_layout().addWidget(self._selection_chip)

        # --- composer -------------------------------------------------------
        self._input = _ComposerEdit()
        self._input.setPlaceholderText(
            "Describe the page, audience, story, or the change you want…"
        )
        self._input.setFont(font_body(11))
        self._input.setFixedHeight(72)
        self._input.submitted.connect(self._send)
        self.content_layout().addWidget(self._input)

        send_row = QHBoxLayout()
        tip = QLabel("CTRL+ENTER")
        tip.setFont(font_label(8))
        tip.setStyleSheet(f"color: {COLORS['ink_soft']};")
        self._send_btn = DoodleButton("Send to Agent ↗", kind="accent")
        self._send_btn.clicked.connect(self._send)
        send_row.addWidget(tip, stretch=1)
        send_row.addWidget(self._send_btn)
        self.content_layout().addLayout(send_row)

    # ------------------------------------------------------------------ API
    def set_messages(self, messages: Sequence[Message]) -> None:
        items = list(messages or [])
        signature = tuple(
            (
                str(_g(message, "id", "")),
                str(_g(message, "role", "")),
                str(_g(message, "text", "")),
                str(_g(message, "timestamp", "")),
            )
            for message in items
        )
        if signature == self._message_signature:
            return
        bar = self._scroll.verticalScrollBar()
        was_at_bottom = bar.maximum() == 0 or bar.value() >= bar.maximum() - 4
        self._message_signature = signature
        while self._messages_layout.count() > 1:  # keep the trailing stretch
            item = self._messages_layout.takeAt(0)
            if item.widget() is not None:
                item.widget().deleteLater()
        if not items:
            empty = QLabel(
                "NO BRIEF YET\n\nCreate a project, attach a repository or "
                "visual references, then describe what you want to make."
            )
            empty.setFont(font_body(10))
            empty.setStyleSheet(f"color: {COLORS['ink_soft']};")
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty.setWordWrap(True)
            self._messages_layout.insertWidget(0, empty)
        else:
            for index, message in enumerate(items):
                self._messages_layout.insertWidget(index, self._bubble(message))
        if was_at_bottom:
            QTimer.singleShot(0, lambda: bar.setValue(bar.maximum()))

    def set_run(self, run: RunInfo | None) -> None:
        if run is None:
            self._run_strip.hide()
            self._activity_box.hide()
            self._run_id = None
            self._activity_run_id = ""
            self._activity_sequences.clear()
            return
        self._run_id = str(_g(run, "id", "") or "")
        status = str(_g(run, "status", "running")).upper()
        stage = str(_g(run, "stage", "") or "").replace("-", " ").upper()
        self._run_label.setText(f"{status} · {stage}" if stage else status)
        self._run_label.setToolTip(self._run_id)
        self._run_elapsed.setText(str(_g(run, "elapsed", "") or ""))
        can_pause = _g(run, "can_pause", None)
        can_resume = _g(run, "can_resume", None)
        can_cancel = _g(run, "can_cancel", None)
        self._pause_btn.setVisible(
            status == "RUNNING" if can_pause is None else bool(can_pause)
        )
        self._resume_btn.setVisible(
            status == "PAUSED" if can_resume is None else bool(can_resume)
        )
        self._cancel_btn.setVisible(
            status in {"RUNNING", "PAUSED", "QUEUED"}
            if can_cancel is None
            else bool(can_cancel)
        )
        self._run_strip.show()
        self.set_activity(run, list(_g(run, "activity", []) or []))

    def set_activity(self, run: RunInfo, events: Sequence[ActivityEvent]) -> None:
        """Append unseen worker events and keep a following viewer at bottom."""
        run_id = str(_g(run, "id", "") or "")
        if run_id != self._activity_run_id:
            self._activity_run_id = run_id
            self._activity_sequences.clear()
            self._activity_tail_kind = ""
            self._activity_tail_widget = None
            while self._activity_layout.count() > 1:
                item = self._activity_layout.takeAt(0)
                if item.widget() is not None:
                    item.widget().deleteLater()
        unseen = [
            event
            for event in events
            if int(_g(event, "sequence", 0) or 0) not in self._activity_sequences
        ]
        if not unseen:
            self._activity_box.setVisible(bool(self._activity_sequences))
            return
        bar = self._activity_scroll.verticalScrollBar()
        follows_tail = bar.maximum() == 0 or bar.value() >= bar.maximum() - 6
        for event in sorted(unseen, key=lambda item: int(_g(item, "sequence", 0) or 0)):
            sequence = int(_g(event, "sequence", 0) or 0)
            self._activity_sequences.add(sequence)
            kind = str(_g(event, "kind", "status") or "status").casefold()
            if (
                kind == "stream"
                and self._activity_tail_kind == "stream"
                and self._activity_tail_widget is not None
            ):
                self._set_activity_row(self._activity_tail_widget, event)
                continue
            row = self._activity_row(event)
            self._activity_layout.insertWidget(self._activity_layout.count() - 1, row)
            self._activity_tail_kind = kind
            self._activity_tail_widget = row
        self._activity_box.show()
        if follows_tail:
            QTimer.singleShot(0, lambda: bar.setValue(bar.maximum()))

    def select_object(self, object_ref: str) -> None:
        """Show the target chip (parity with the web preview click selection)."""
        self._object_ref = object_ref
        self._selection_chip.set_text(f"TARGET / {object_ref}")
        self._selection_chip.show()
        self._input.setFocus()

    def clear_selection(self) -> None:
        self._object_ref = None
        self._selection_chip.hide()

    def clear_composer(self) -> None:
        """Clear the submitted draft only after the backend accepted it."""

        self._input.clear()

    # -------------------------------------------------------------- internals
    def _send(self) -> None:
        text = self._input.toPlainText().strip()
        if not text:
            return
        if self._object_ref:
            self.object_message_sent.emit(text, self._object_ref)
        else:
            self.message_sent.emit(text)

    def _emit_run_action(self, action: str) -> None:
        if self._run_id:
            self.run_action_requested.emit(action, self._run_id)

    def _bubble(self, message: Message) -> QWidget:
        role = str(_g(message, "role", "USER")).upper()
        is_user = role != "ASSISTANT"
        text = str(_g(message, "text", ""))
        raw_stamp = str(_g(message, "timestamp", "") or "")
        stamp = (
            raw_stamp.split("T", 1)[1][:5]
            if "T" in raw_stamp and len(raw_stamp.split("T", 1)[1]) >= 5
            else raw_stamp[:5]
        )

        wrapper = QWidget()
        row = QHBoxLayout(wrapper)
        row.setContentsMargins(0, 0, 0, 0)

        bubble = QFrame()
        bg = COLORS["yellow"] if is_user else COLORS["blue"]
        bubble.setStyleSheet(
            f"QFrame {{ background-color: {bg};"
            f" border: 2px solid {COLORS['ink']}; border-radius: 14px; }}"
        )
        bubble_layout = QVBoxLayout(bubble)
        bubble_layout.setContentsMargins(10, 6, 10, 8)
        bubble_layout.setSpacing(2)

        who = "YOU" if is_user else "OEY AGENT"
        header = QLabel(f"{who}   {stamp}")
        header.setFont(font_label(8))
        header.setStyleSheet(f"color: {COLORS['ink_soft']}; border: none;")
        bubble_layout.addWidget(header)

        body = QLabel(text)
        body.setFont(font_body(10))
        body.setWordWrap(True)
        body.setStyleSheet("border: none;")
        bubble_layout.addWidget(body)

        if is_user:
            row.addStretch(1)
            row.addWidget(bubble, stretch=4)
        else:
            row.addWidget(bubble, stretch=4)
            row.addStretch(1)
        return wrapper

    def _activity_row(self, event: ActivityEvent) -> QLabel:
        label = QLabel()
        label.setFont(font_body(9))
        label.setWordWrap(True)
        label.setStyleSheet(
            f"QLabel {{ background: {COLORS['paper']}; border: 1px solid "
            f"{COLORS['ink_soft']}; border-radius: 7px; padding: 4px 6px; }}"
        )
        self._set_activity_row(label, event)
        return label

    @staticmethod
    def _set_activity_row(label: QLabel, event: ActivityEvent) -> None:
        phase = str(_g(event, "phase", "Working") or "Working").upper()
        kind = str(_g(event, "kind", "status") or "status").upper()
        summary = str(_g(event, "summary", "Working…") or "Working…")
        detail = str(_g(event, "detail", "") or "")
        detail_line = f"\n{detail}" if detail else ""
        label.setText(f"{phase} · {kind}\n{summary}{detail_line}")
        label.setToolTip(detail)
