"""Phase 5 spike E3+D7+Q8: deterministic, read-only repo-fact extractor.

Implements the NATIVE_OBSERVATION extraction described in
`docs/spec/context-evidence-baseline.md` SS4.1: file tree, Python module/class/
function signatures (via `ast`, never by executing the module), pyproject.toml
dependencies/config, and test file/function inventory.

This script NEVER imports or executes any file under the repo. It only reads
bytes/text and parses ASTs. It writes exclusively under spikes/e3-repo-facts/.

Every fact carries a locator: {file_path, line_start, line_end}, relative to
the repo root, per context-evidence-baseline.md SS5. A small number of
repo-level aggregate facts (e.g. "N test functions total") cannot honestly be
pinned to one line range; those get line_start=line_end=null and instead carry
`derived_from` (a list of fact ids). This gap in the locator model
(single-file-single-range vs. cross-file aggregate) is called out in
RESULT.md as a spec finding.
"""
from __future__ import annotations

import ast
import fnmatch
import json
import sys
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SPIKE_DIR = Path(__file__).resolve().parent
OUT_DIR = SPIKE_DIR / "outputs"

# --- exclusion rules (mirrors agent-engine-spec.md SS11 / context-evidence-baseline.md SS4.1) ---
EXCLUDE_DIR_NAMES = {
    ".git", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", "node_modules",
}
EXCLUDE_DIR_PATTERNS = ["pytest_tmp*"]
EXCLUDE_FILE_NAMES = {".env"}
EXCLUDE_FILE_PATTERNS = [
    "*.pem", "*.key", "*credential*", "*credentials*", "*secret*", "*secrets*", "id_rsa*",
]
# Self-exclusion: spikes/ is this spike's own scratch space. It is regenerated
# during the very run that reads it, so including it would make the "ground
# truth" a moving target across the 10 generation runs. Excluded and documented
# in RESULT.md rather than silently dropped.
EXCLUDE_TOP_LEVEL_DIRS = {"spikes"}


def is_excluded_dir_name(name: str) -> bool:
    if name in EXCLUDE_DIR_NAMES:
        return True
    return any(fnmatch.fnmatch(name, pat) for pat in EXCLUDE_DIR_PATTERNS)


def is_excluded_file(path: Path) -> bool:
    name = path.name
    if name in EXCLUDE_FILE_NAMES:
        return True
    return any(fnmatch.fnmatch(name.lower(), pat) for pat in EXCLUDE_FILE_PATTERNS)


def iter_included_files():
    for dirpath, dirnames, filenames in _walk(REPO_ROOT):
        for fname in sorted(filenames):
            fpath = dirpath / fname
            if is_excluded_file(fpath):
                continue
            yield fpath


def _walk(root: Path):
    # os.walk-equivalent with in-place dirnames pruning, rooted at repo root.
    import os

    for dirpath_s, dirnames, filenames in os.walk(root):
        dirpath = Path(dirpath_s)
        rel_parts = dirpath.relative_to(REPO_ROOT).parts
        if rel_parts and rel_parts[0] in EXCLUDE_TOP_LEVEL_DIRS:
            dirnames[:] = []
            continue
        dirnames[:] = [d for d in dirnames if not is_excluded_dir_name(d)]
        yield dirpath, dirnames, filenames


class FactBook:
    def __init__(self):
        self.facts = []
        self._n = 0

    def add(self, category, statement, file_path=None, line_start=None, line_end=None,
             derived_from=None, evidence=None):
        self._n += 1
        fid = f"F{self._n:04d}"
        self.facts.append({
            "id": fid,
            "category": category,
            "statement": statement,
            "locator": {
                "file_path": file_path,
                "line_start": line_start,
                "line_end": line_end,
            },
            "derived_from": derived_from or [],
            "evidence": evidence or {},
        })
        return fid


def rel(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def read_text_lines(path: Path):
    try:
        text = path.read_text(encoding="utf-8")
        return text.splitlines(), True
    except (UnicodeDecodeError, ValueError):
        return None, False


def fmt_args(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    parts = []
    a = fn.args
    defaults_offset = len(a.args) - len(a.defaults)
    for i, arg in enumerate(a.args):
        s = arg.arg
        if arg.annotation is not None:
            s += f": {ast.unparse(arg.annotation)}"
        if i >= defaults_offset:
            default = a.defaults[i - defaults_offset]
            s += f" = {ast.unparse(default)}"
        parts.append(s)
    if a.vararg:
        s = f"*{a.vararg.arg}"
        if a.vararg.annotation is not None:
            s += f": {ast.unparse(a.vararg.annotation)}"
        parts.append(s)
    elif a.kwonlyargs:
        parts.append("*")
    for i, arg in enumerate(a.kwonlyargs):
        s = arg.arg
        if arg.annotation is not None:
            s += f": {ast.unparse(arg.annotation)}"
        default = a.kw_defaults[i]
        if default is not None:
            s += f" = {ast.unparse(default)}"
        parts.append(s)
    if a.kwarg:
        s = f"**{a.kwarg.arg}"
        if a.kwarg.annotation is not None:
            s += f": {ast.unparse(a.kwarg.annotation)}"
        parts.append(s)
    ret = ""
    if fn.returns is not None:
        ret = f" -> {ast.unparse(fn.returns)}"
    prefix = "async def" if isinstance(fn, ast.AsyncFunctionDef) else "def"
    return f"{prefix} {fn.name}({', '.join(parts)}){ret}"


def extract_python_module(book: FactBook, path: Path):
    lines, ok = read_text_lines(path)
    if not ok:
        book.add("file_unparseable", f"File `{rel(path)}` could not be decoded as UTF-8 text.",
                  file_path=rel(path))
        return
    src = "\n".join(lines)
    try:
        tree = ast.parse(src, filename=str(path))
    except SyntaxError as exc:
        book.add("file_syntax_error",
                  f"File `{rel(path)}` failed to parse as Python: {exc}.",
                  file_path=rel(path), line_start=1, line_end=len(lines))
        return

    docstring = ast.get_docstring(tree)
    module_fact = book.add(
        "python_module",
        f"Module `{rel(path)}` has {len(lines)} lines."
        + (f' Module docstring: "{docstring.strip().splitlines()[0]}"' if docstring else " No module docstring."),
        file_path=rel(path), line_start=1, line_end=len(lines),
        evidence={"docstring": docstring, "line_count": len(lines)},
    )

    top_level_names = []
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            top_level_names.append(node.name)
            decorators = [ast.unparse(d) for d in node.decorator_list]
            bases = [ast.unparse(b) for b in node.bases]
            cls_doc = ast.get_docstring(node)
            methods = []
            fields = []
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    methods.append(item.name)
                    book.add(
                        "python_method",
                        f"Method `{fmt_args(item)}` is defined in class `{node.name}` "
                        f"in `{rel(path)}`.",
                        file_path=rel(path), line_start=item.lineno,
                        line_end=item.end_lineno or item.lineno,
                        evidence={"class": node.name, "name": item.name,
                                  "signature": fmt_args(item),
                                  "decorators": [ast.unparse(d) for d in item.decorator_list]},
                    )
                elif isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    ann = ast.unparse(item.annotation)
                    fields.append(f"{item.target.id}: {ann}")
            deco_str = f" decorated with {', '.join(decorators)}" if decorators else ""
            bases_str = f" inheriting from {', '.join(bases)}" if bases else ""
            fields_str = f" Fields: {', '.join(fields)}." if fields else ""
            book.add(
                "python_class",
                f"Class `{node.name}` is defined in `{rel(path)}`{bases_str}{deco_str}."
                f"{fields_str}"
                + (f' Has {len(methods)} method(s): {", ".join(methods)}.' if methods else " Has no methods."),
                file_path=rel(path), line_start=node.lineno,
                line_end=node.end_lineno or node.lineno,
                evidence={"name": node.name, "bases": bases, "decorators": decorators,
                          "fields": fields, "methods": methods, "docstring": cls_doc},
            )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            top_level_names.append(node.name)
            fn_doc = ast.get_docstring(node)
            book.add(
                "python_function",
                f"Top-level function `{fmt_args(node)}` is defined in `{rel(path)}`."
                + (f' Docstring: "{fn_doc.strip().splitlines()[0]}"' if fn_doc else ""),
                file_path=rel(path), line_start=node.lineno,
                line_end=node.end_lineno or node.lineno,
                evidence={"name": node.name, "signature": fmt_args(node), "docstring": fn_doc},
            )

    return module_fact, top_level_names


def extract_tests(book: FactBook, path: Path):
    lines, ok = read_text_lines(path)
    if not ok:
        return 0
    src = "\n".join(lines)
    try:
        tree = ast.parse(src, filename=str(path))
    except SyntaxError:
        return 0
    count = 0
    test_fact_ids = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
            count += 1
            fid = book.add(
                "test_function",
                f"Test function `{node.name}` is defined in `{rel(path)}`.",
                file_path=rel(path), line_start=node.lineno,
                line_end=node.end_lineno or node.lineno,
                evidence={"name": node.name},
            )
            test_fact_ids.append(fid)
    book.add(
        "test_file_count",
        f"File `{rel(path)}` contains {count} test function(s) ({len(lines)} lines total).",
        file_path=rel(path), line_start=1, line_end=len(lines),
        derived_from=test_fact_ids,
        evidence={"count": count},
    )
    return count


def extract_pyproject(book: FactBook, path: Path):
    lines, ok = read_text_lines(path)
    raw = path.read_bytes()
    data = tomllib.loads(raw.decode("utf-8"))

    def find_line(needle: str, start: int = 0) -> int:
        for i, line in enumerate(lines[start:], start=start + 1):
            if needle in line:
                return i
        return 1

    project = data.get("project", {})
    deps = project.get("dependencies", [])
    dep_line = find_line("dependencies")
    if deps:
        stmt = f"pyproject.toml declares {len(deps)} runtime dependency(ies): {', '.join(deps)}."
    else:
        stmt = "pyproject.toml declares 0 runtime dependencies (dependencies = [])."
    book.add("dependency", stmt, file_path=rel(path), line_start=dep_line, line_end=dep_line,
              evidence={"dependencies": deps})

    build_sys = data.get("build-system", {})
    build_reqs = build_sys.get("requires", [])
    if build_reqs:
        line_no = find_line("requires")
        book.add(
            "build_dependency",
            f"pyproject.toml [build-system] requires: {', '.join(build_reqs)}.",
            file_path=rel(path), line_start=line_no, line_end=line_no,
            evidence={"requires": build_reqs},
        )

    py_req = project.get("requires-python")
    if py_req:
        line_no = find_line("requires-python")
        book.add(
            "config",
            f"pyproject.toml requires-python = \"{py_req}\".",
            file_path=rel(path), line_start=line_no, line_end=line_no,
            evidence={"requires_python": py_req},
        )

    name = project.get("name")
    version = project.get("version")
    description = project.get("description")
    if name:
        line_no = find_line(f'name = "{name}"')
        book.add("config", f'pyproject.toml [project].name = "{name}".',
                  file_path=rel(path), line_start=line_no, line_end=line_no)
    if version:
        line_no = find_line(f'version = "{version}"')
        book.add("config", f'pyproject.toml [project].version = "{version}".',
                  file_path=rel(path), line_start=line_no, line_end=line_no)
    if description:
        line_no = find_line("description")
        book.add("config", f'pyproject.toml [project].description = "{description}".',
                  file_path=rel(path), line_start=line_no, line_end=line_no)

    pytest_cfg = data.get("tool", {}).get("pytest", {}).get("ini_options", {})
    if pytest_cfg:
        line_no = find_line("[tool.pytest.ini_options]")
        book.add(
            "config",
            f"pyproject.toml [tool.pytest.ini_options] = {json.dumps(pytest_cfg, ensure_ascii=False)}.",
            file_path=rel(path), line_start=line_no,
            line_end=line_no + len(pytest_cfg),
            evidence=pytest_cfg,
        )

    ruff_cfg = data.get("tool", {}).get("ruff", {})
    if ruff_cfg:
        line_no = find_line("[tool.ruff]")
        book.add(
            "config",
            f"pyproject.toml [tool.ruff] target-version={ruff_cfg.get('target-version')!r}, "
            f"line-length={ruff_cfg.get('line-length')!r}.",
            file_path=rel(path), line_start=line_no, line_end=line_no,
            evidence=ruff_cfg,
        )


def main():
    book = FactBook()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    all_files = list(iter_included_files())

    # 1. file tree facts (one per included file)
    dir_children: dict[str, list[str]] = {}
    for f in all_files:
        r = rel(f)
        lines, ok = read_text_lines(f)
        if ok:
            book.add("file_exists", f"File `{r}` exists ({len(lines)} lines).",
                      file_path=r, line_start=1, line_end=max(len(lines), 1))
        else:
            size = f.stat().st_size
            book.add("file_exists", f"File `{r}` exists (binary/non-UTF8, {size} bytes).",
                      file_path=r, line_start=None, line_end=None,
                      evidence={"size_bytes": size})
        parent = Path(r).parent.as_posix() if Path(r).parent != Path(".") else "."
        dir_children.setdefault(parent, []).append(Path(r).name)

    top_dirs = sorted({p.split("/")[0] for p in dir_children if p != "."})
    book.add(
        "directory_listing",
        f"Repository top level (after exclusions) contains directories: {', '.join(top_dirs)}; "
        f"and top-level files: {', '.join(sorted(dir_children.get('.', [])))}.",
        file_path=".", line_start=None, line_end=None,
        evidence={"top_dirs": top_dirs, "top_files": sorted(dir_children.get(".", []))},
    )

    # 2. python modules / classes / functions (ast-based, no execution)
    py_files = [f for f in all_files if f.suffix == ".py" and "tests" not in f.relative_to(REPO_ROOT).parts[:1]]
    src_py_files = [f for f in py_files if f.relative_to(REPO_ROOT).parts[0] == "src"]
    module_manifest = []
    for f in sorted(src_py_files):
        result = extract_python_module(book, f)
        if result:
            module_fact, names = result
            module_manifest.append({"path": rel(f), "fact_id": module_fact, "top_level_names": names})

    # non-src, non-test top-level .py files (e.g. lab30min/) - module facts only, lighter touch
    other_py_files = [
        f for f in all_files
        if f.suffix == ".py"
        and f.relative_to(REPO_ROOT).parts[0] not in ("src", "tests")
    ]
    for f in sorted(other_py_files):
        extract_python_module(book, f)

    # 3. tests
    test_files = [f for f in all_files if f.relative_to(REPO_ROOT).parts[0] == "tests" and f.suffix == ".py"]
    total_tests = 0
    per_file_counts = {}
    for f in sorted(test_files):
        c = extract_tests(book, f)
        total_tests += c
        per_file_counts[rel(f)] = c
    test_agg_id = book.add(
        "test_count_aggregate",
        f"Repository has {len(test_files)} test files under tests/ containing {total_tests} "
        f"test function(s) in total (statically counted via ast, tests not executed).",
        file_path="tests", line_start=None, line_end=None,
        derived_from=[fid for fid in [] ],
        evidence={"per_file": per_file_counts, "total": total_tests, "file_count": len(test_files)},
    )

    # 4. pyproject.toml
    pyproject_path = REPO_ROOT / "pyproject.toml"
    if pyproject_path.exists():
        extract_pyproject(book, pyproject_path)

    # write outputs
    (OUT_DIR / "facts.json").write_text(
        json.dumps({
            "repo_root": str(REPO_ROOT),
            "excluded_top_level_dirs": sorted(EXCLUDE_TOP_LEVEL_DIRS),
            "excluded_dir_names": sorted(EXCLUDE_DIR_NAMES),
            "excluded_dir_patterns": EXCLUDE_DIR_PATTERNS,
            "excluded_file_names": sorted(EXCLUDE_FILE_NAMES),
            "excluded_file_patterns": EXCLUDE_FILE_PATTERNS,
            "fact_count": len(book.facts),
            "module_manifest": module_manifest,
            "facts": book.facts,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    by_cat = {}
    for f in book.facts:
        by_cat[f["category"]] = by_cat.get(f["category"], 0) + 1
    print(f"Wrote {len(book.facts)} facts to {OUT_DIR / 'facts.json'}")
    for cat, n in sorted(by_cat.items()):
        print(f"  {cat}: {n}")


if __name__ == "__main__":
    sys.exit(main())
