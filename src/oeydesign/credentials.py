"""Credential storage boundary for trusted provider secrets."""

from __future__ import annotations

import ctypes
import os
from ctypes import wintypes
from typing import Protocol

from .domain import ContractError, ErrorCategory

KIMI_CREDENTIAL_TARGET = "OEYdesign/provider/kimi/default"


class CredentialStorePort(Protocol):
    def configured(self, target: str) -> bool: ...

    def read(self, target: str) -> str | None: ...

    def write(self, target: str, secret: str) -> None: ...

    def delete(self, target: str) -> None: ...


class MemoryCredentialStore:
    """Test adapter that deliberately has no filesystem persistence."""

    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    def configured(self, target: str) -> bool:
        return target in self._values

    def read(self, target: str) -> str | None:
        return self._values.get(target)

    def write(self, target: str, secret: str) -> None:
        _validate(target, secret)
        self._values[target] = secret

    def delete(self, target: str) -> None:
        self._values.pop(target, None)


class WindowsCredentialStore:
    """Store generic credentials with CredWriteW/CredReadW/CredDeleteW."""

    _TYPE_GENERIC = 1
    _PERSIST_LOCAL_MACHINE = 2
    _ERROR_NOT_FOUND = 1168

    class _CREDENTIALW(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    def __init__(self) -> None:
        if os.name != "nt":
            raise ContractError(
                ErrorCategory.CAPABILITY_UNAVAILABLE,
                "Windows Credential Manager is unavailable",
            )
        self._advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
        self._advapi32.CredWriteW.argtypes = [
            ctypes.POINTER(self._CREDENTIALW),
            wintypes.DWORD,
        ]
        self._advapi32.CredWriteW.restype = wintypes.BOOL
        self._advapi32.CredReadW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            ctypes.POINTER(ctypes.POINTER(self._CREDENTIALW)),
        ]
        self._advapi32.CredReadW.restype = wintypes.BOOL
        self._advapi32.CredDeleteW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
        ]
        self._advapi32.CredDeleteW.restype = wintypes.BOOL
        self._advapi32.CredFree.argtypes = [ctypes.c_void_p]
        self._advapi32.CredFree.restype = None

    def configured(self, target: str) -> bool:
        return self.read(target) is not None

    def read(self, target: str) -> str | None:
        _validate_target(target)
        pointer = ctypes.POINTER(self._CREDENTIALW)()
        if not self._advapi32.CredReadW(
            target, self._TYPE_GENERIC, 0, ctypes.byref(pointer)
        ):
            error = ctypes.get_last_error()
            if error == self._ERROR_NOT_FOUND:
                return None
            raise _credential_error("Credential read failed", error)
        try:
            credential = pointer.contents
            if not credential.CredentialBlob or credential.CredentialBlobSize == 0:
                return None
            payload = ctypes.string_at(
                credential.CredentialBlob, credential.CredentialBlobSize
            )
            return payload.decode("utf-16-le")
        except UnicodeDecodeError as exc:
            raise _credential_error("Stored credential is unreadable") from exc
        finally:
            self._advapi32.CredFree(pointer)

    def write(self, target: str, secret: str) -> None:
        _validate(target, secret)
        payload = secret.encode("utf-16-le")
        blob = (ctypes.c_ubyte * len(payload)).from_buffer_copy(payload)
        credential = self._CREDENTIALW()
        credential.Type = self._TYPE_GENERIC
        credential.TargetName = target
        credential.CredentialBlobSize = len(payload)
        credential.CredentialBlob = ctypes.cast(blob, ctypes.POINTER(ctypes.c_ubyte))
        credential.Persist = self._PERSIST_LOCAL_MACHINE
        credential.UserName = "OEYdesign"
        if not self._advapi32.CredWriteW(ctypes.byref(credential), 0):
            raise _credential_error("Credential write failed", ctypes.get_last_error())

    def delete(self, target: str) -> None:
        _validate_target(target)
        if not self._advapi32.CredDeleteW(target, self._TYPE_GENERIC, 0):
            error = ctypes.get_last_error()
            if error != self._ERROR_NOT_FOUND:
                raise _credential_error("Credential delete failed", error)


def default_credential_store() -> CredentialStorePort:
    if os.name == "nt":
        return WindowsCredentialStore()
    raise ContractError(
        ErrorCategory.CAPABILITY_UNAVAILABLE,
        "The Web MVP requires Windows Credential Manager",
    )


def _validate_target(target: str) -> None:
    if (
        not isinstance(target, str)
        or not target.strip()
        or len(target) > 256
        or "\x00" in target
    ):
        raise ValueError("Credential target is invalid")


def _validate(target: str, secret: str) -> None:
    _validate_target(target)
    if (
        not isinstance(secret, str)
        or not secret
        or len(secret.encode("utf-16-le")) > 5_120
        or "\x00" in secret
    ):
        raise ValueError("Credential secret is invalid")


def _credential_error(message: str, code: int | None = None) -> ContractError:
    return ContractError(
        ErrorCategory.CAPABILITY_UNAVAILABLE,
        message,
        details={} if code is None else {"winerror": code},
    )
