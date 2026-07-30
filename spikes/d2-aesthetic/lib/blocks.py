"""Shared <<<FILE: ...>>> block parser, same format as spikes/e4-mock/generate/generate.py.

Kept as a small standalone module (not imported cross-spike) so this spike's
directory stays self-contained per the task's "only write spikes/d2-aesthetic/" rule.
"""
from __future__ import annotations

import re

FILE_RE = re.compile(r"<<<FILE:\s*(.+?)\s*>>>\r?\n(.*?)<<<END>>>", re.DOTALL)


def parse_files(text: str) -> dict[str, str]:
    files: dict[str, str] = {}
    for m in FILE_RE.finditer(text):
        path = m.group(1).strip().replace("\\", "/").lstrip("/")
        if not path or ".." in path.split("/"):
            continue
        files[path] = m.group(2)
    return files


def write_files(root, files: dict[str, str]) -> list[str]:
    import os
    written = []
    for relpath, content in files.items():
        fullpath = os.path.join(root, relpath)
        os.makedirs(os.path.dirname(fullpath) or root, exist_ok=True)
        with open(fullpath, "w", encoding="utf-8") as f:
            f.write(content)
        written.append(relpath)
    return written
