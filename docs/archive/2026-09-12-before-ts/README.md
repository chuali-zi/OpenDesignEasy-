# OEYdesign

## OEYdesign Studio (primary)

OEYdesign Studio is the product surface: a Claude-Design-style interactive design agent with persistent chat on the left and a live canvas on the right. It produces shippable Web pages, decks (PPT), and documents, can generate images with Seedream, reviews the result from screenshots, and exports zip / html / pdf / pptx / docx / md. It does not use the Phase 6 governed pipeline.

### Quick start

```powershell
.\start-studio.ps1
```

Then open `http://127.0.0.1:8880` (preview origin `http://127.0.0.1:8881`). Put `API_KEY`, `BASE_URL`, `MODEL` (LLM) and `ARK_API_KEY`, `ARK_BASE_URL`, `ARK_MODEL_ID` (images) in the repo-root `.env`, or set them in the Settings drawer.

### Capabilities

- Web / Deck / Doc artifacts in a per-project workspace
- Seedream image generation and Playwright visual review
- Interruptible runs, versions, quality reports
- Exports: zip, html, pdf, pptx, docx, md

Full user and developer guide: [`docs/studio/README.md`](docs/studio/README.md). Shared API contract: [`docs/studio/contract.md`](docs/studio/contract.md).

## Legacy governed pipeline (Phase 6 workbench)

The earlier Phase 6 `product_shell` workbench (port 8765) remains available. It is the governed pipeline Studio does **not** depend on: repository ingestion, eight-slot readiness, AppContainer, and deterministic adapters.

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
