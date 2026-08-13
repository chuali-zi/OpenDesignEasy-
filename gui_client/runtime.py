"""In-process loopback runtime for the OEYdesign desktop client."""

from __future__ import annotations

import secrets
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

        from oeydesign.instance_lock import DatabaseInstanceLock
        from oeydesign.product_shell import (
            ProductShellService,
            make_preview_server,
            make_server,
        )
        from oeydesign.web_mvp import ProductApplication

        root = Path(data_root).resolve()
        root.mkdir(parents=True, exist_ok=True)
        database_path = (
            Path(database).resolve()
            if database is not None
            else root / "oeydesign.sqlite"
        )
        self._instance_lock = DatabaseInstanceLock(database_path)
        try:
            self._app: Any = ProductApplication(
                database_path,
                data_root=root,
                dependency_image=(
                    Path(dependency_image).resolve()
                    if dependency_image is not None
                    else None
                ),
                acquire_instance_lock=False,
            )
        except Exception:
            self._instance_lock.release()
            raise
        self._capability_token = secrets.token_urlsafe(32)
        self._service = ProductShellService(
            self._app,
            inline_previews=False,
            access_token=self._capability_token,
        )
        self._server = make_server(
            self._app,
            host="127.0.0.1",
            port=0,
            service=self._service,
        )
        self._preview_server = make_preview_server(
            self._service, host="127.0.0.1", port=0
        )
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="oeydesign-desktop-loopback",
            daemon=True,
        )
        self._preview_thread = threading.Thread(
            target=self._preview_server.serve_forever,
            name="oeydesign-desktop-preview",
            daemon=True,
        )
        self._thread.start()
        self._preview_thread.start()
        self.backend = HttpBackend(
            f"http://127.0.0.1:{self._server.server_port}",
            preview_base_url=(
                f"http://127.0.0.1:{self._preview_server.server_port}"
            ),
            capability_token=self._capability_token,
        )
        self._closed = False

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._server.shutdown()
        self._server.server_close()
        self._preview_server.shutdown()
        self._preview_server.server_close()
        self._thread.join(timeout=5)
        self._preview_thread.join(timeout=5)
        closed = self._app.close()
        if closed is False and hasattr(self._app, "wait_closed"):
            threading.Thread(
                target=self._release_after_close,
                name="oeydesign-runtime-lock-release",
                daemon=True,
            ).start()
        else:
            self._instance_lock.release()

    def _release_after_close(self) -> None:
        self._app.wait_closed()
        self._instance_lock.release()

    def __enter__(self) -> DesktopRuntime:
        return self

    def __exit__(self, *args: object) -> None:
        del args
        self.close()
