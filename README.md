# OEYdesign

OEYdesign currently provides the Phase 1 contract harness, Phase 2 recoverable
application foundation, Phase 3 traceable Context & Evidence baseline, and the
Phase 4 Project-driven product shell. It keeps deterministic design, artifact,
quality, and delivery adapters while persisting Projects, commands, workflows,
source metadata, evidence lineage, Context Packages, audits, and side effects in
SQLite.

Phase 5 specifications and ADR-0002 through ADR-0005 are frozen. Phase 6 has
started at the scaffold stage: adapter injection and readiness gates are present,
while real repository, agent, renderer, framework, and provider integrations remain
explicit follow-up work. See `docs/phase6/README.md`.

Run the contract tests with `python -m pytest`.

Use `oeydesign.ControlPlane` for the in-memory contract harness, or
`oeydesign.SQLiteApplication("oeydesign.sqlite", data_root="./data")` as the
durable composition root. File databases require an explicit application data
root and cannot resolve outside it. The composition root exposes `evidence` for
CSV/PNG ingestion and confirmation, plus `context_assembler` for producing the
versioned Context Package consumed by the existing project flow. The contracts
are documented in `docs/spec/contract-skeleton.md`,
`docs/spec/runtime-recovery.md`, and `docs/spec/context-evidence-baseline.md`.

Run the local Phase 4 proof desk from the repository root:

```powershell
$env:PYTHONPATH = "src"
python -m oeydesign.product_shell --data-root data/product-shell --database oeydesign.sqlite --port 8765
```

Then open `http://127.0.0.1:8765`. The shell uses only Project projections and
revision-checked commands; it requires no Agent or provider configuration. Its
interaction contract is documented in `docs/spec/product-shell-stub-flow.md`.
