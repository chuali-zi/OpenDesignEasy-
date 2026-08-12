"""Smoke test: launch the GUI briefly and dump a screenshot.

Usage: .venv\\Scripts\\python.exe gui_client\\_smoke.py [out.png]

NOTE: must run on the real Windows platform (not offscreen) so Qt can
find the system font directory and render handwriting fonts.
"""

import sys

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from gui_client.app import MainWindow
from gui_client.backend import MockBackend
from gui_client.theme import apply_app_style


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "pytest_tmp/gui-smoke.png"
    app = QApplication([])
    apply_app_style(app)
    win = MainWindow(MockBackend())
    win.resize(1280, 800)
    win.show()

    def shoot() -> None:
        win.grab().save(out)
        print("SCREENSHOT_OK", out)
        app.quit()

    QTimer.singleShot(800, shoot)
    app.exec()


if __name__ == "__main__":
    main()
