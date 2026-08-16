# OEYdesign

OEYdesign currently provides the Phase 1 contract harness, Phase 2 recoverable
application foundation, Phase 3 traceable Context & Evidence baseline, and the
Phase 4 Project-driven product shell. It keeps deterministic design, artifact,
quality, and delivery adapters while persisting Projects, commands, workflows,
source metadata, evidence lineage, Context Packages, audits, and side effects in
SQLite.

Phase 5 specifications and ADR-0002 through ADR-0005 are frozen. The first
Phase 6 Web vertical slice now binds all eight production capability slots and
has completed a real repository-to-delivery acceptance run. Extended failure
injection, product integration, and external user acceptance remain active work.
See `docs/phase6/README.md`.

Run the contract tests with `python -m pytest`.

Use `oeydesign.ControlPlane` for the in-memory contract harness, or
`oeydesign.SQLiteApplication("oeydesign.sqlite", data_root="./data")` as the
durable composition root. File databases require an explicit application data
root and cannot resolve outside it. The composition root exposes `evidence` for
CSV/PNG ingestion and confirmation, plus `context_assembler` for producing the
versioned Context Package consumed by the existing project flow. The contracts
are documented in `docs/spec/contract-skeleton.md`,
`docs/spec/runtime-recovery.md`, and `docs/spec/context-evidence-baseline.md`.

Run the real local Web MVP from the repository root. The helper reuses the
existing desktop-MVP data root, so Projects and non-secret provider settings
remain available after switching from the GUI to the browser:

```powershell
.\start-web.ps1
```

The equivalent explicit developer command is:

```powershell
$env:PYTHONPATH = "src"
python -m oeydesign.product_shell `
  --data-root data/desktop-mvp `
  --database oeydesign.sqlite `
  --dependency-image spikes/e8-e12-framework/node_modules `
  --port 8765
```

Then open `http://127.0.0.1:8765`. The default path is the real
`ProductApplication`: repository ingestion is read-only, generation is queued
in the background, and Kimi credentials remain in Windows Credential Manager.
Use **Settings** in the Web workbench to configure the Kimi Coding endpoint
(`https://api.kimi.com/coding/v1`) and model (`k3`). Deterministic adapters are
available only through an explicit `--demo` launch.
