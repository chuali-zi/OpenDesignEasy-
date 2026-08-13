"""Operating-system lock for one live product runtime per SQLite database."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from typing import BinaryIO


class DatabaseInstanceLock:
    """Hold an OS lock until every worker and SQLite handle is closed."""

    def __init__(self, database_path: str | Path) -> None:
        database = Path(database_path).resolve()
        self.path = database.with_name(database.name + ".product.lock")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._handle: BinaryIO | None = None
        self._mutex_handle: int | None = None
        self._locked = False
        self._write_marker()
        try:
            if sys.platform == "win32":
                self._lock_windows(database)
            else:  # pragma: no cover - the product MVP is Windows-only
                self._lock_posix()
        except Exception:
            if self._handle is not None:
                self._handle.close()
            raise

    def _write_marker(self) -> None:
        with self.path.open("a+b") as marker:
            marker.seek(0, 2)
            if marker.tell() == 0:
                marker.write(b"OEYdesign product runtime lock\n")

    def _lock_windows(self, database: Path) -> None:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        create_mutex = kernel32.CreateMutexW
        create_mutex.argtypes = (wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR)
        create_mutex.restype = wintypes.HANDLE
        close_handle = kernel32.CloseHandle
        close_handle.argtypes = (wintypes.HANDLE,)
        close_handle.restype = wintypes.BOOL
        digest = hashlib.sha256(str(database).casefold().encode("utf-8")).hexdigest()
        handle = create_mutex(None, True, f"Local\\OEYdesign-product-{digest}")
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
            close_handle(handle)
            raise RuntimeError(
                "This OEYdesign database is already open in another product runtime"
            )
        self._mutex_handle = int(handle)
        self._locked = True

    def _lock_posix(self) -> None:
        import fcntl

        self._handle = self.path.open("a+b")
        try:
            fcntl.flock(self._handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError(
                "This OEYdesign database is already open in another product runtime"
            ) from exc
        self._locked = True

    def release(self) -> None:
        if not self._locked:
            return
        try:
            if sys.platform == "win32":
                import ctypes
                from ctypes import wintypes

                assert self._mutex_handle is not None
                kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
                release_mutex = kernel32.ReleaseMutex
                release_mutex.argtypes = (wintypes.HANDLE,)
                release_mutex.restype = wintypes.BOOL
                close_handle = kernel32.CloseHandle
                close_handle.argtypes = (wintypes.HANDLE,)
                close_handle.restype = wintypes.BOOL
                release_mutex(self._mutex_handle)
                close_handle(self._mutex_handle)
                self._mutex_handle = None
            else:  # pragma: no cover - the product MVP is Windows-only
                import fcntl

                assert self._handle is not None
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
        finally:
            self._locked = False
            if self._handle is not None:
                self._handle.close()
                self._handle = None

    def __enter__(self) -> DatabaseInstanceLock:
        return self

    def __exit__(self, *args: object) -> None:
        del args
        self.release()
