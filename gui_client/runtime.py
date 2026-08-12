"""In-process loopback runtime for the OEYdesign desktop client."""

from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any

from .backend import HttpBackend


class DesktopRuntime:
    """Own the product application and its private ephemeral HTTP endpoint."""

    def __init__(
        self,
        *,
        data_root: str | Path,
        database: str | Path | None = None,
        dependency_image: str | Path | None = None,
    ) -> None:
        source_root = Path(__file__).resolve().parents[1] / "src"
        if str(source_root) not in sys.path:
            sys.path.insert(0, str(source_root))

        from oeydesign.product_shell import make_server
        from oeydesign.web_mvp import ProductApplication

        root = Path(data_root).resolve()
        root.mkdir(parents=True, exist_ok=True)
        database_path = (
            Path(database).resolve()
            if database is not None
            else root / "oeydesign.sqlite"
        )
        self._app: Any = ProductApplication(
            database_path,
            data_root=root,
            dependency_image=(
                Path(dependency_image).resolve()
                if dependency_image is not None
                else None
            ),
        )
        self._server = make_server(self._app, host="127.0.0.1", port=0)
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="oeydesign-desktop-loopback",
            daemon=True,
        )
        self._thread.start()
        self.backend = HttpBackend(
            f"http://127.0.0.1:{self._server.server_port}"
        )
        self._closed = False

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)
        self._app.close()

    def __enter__(self) -> DesktopRuntime:
        return self

    def __exit__(self, *args: object) -> None:
        del args
        self.close()
