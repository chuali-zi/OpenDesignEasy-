# OEYdesign

OEYdesign currently provides the Phase 1 contract harness, the Phase 2
recoverable application foundation, and the Phase 3 traceable Context & Evidence
baseline. It keeps deterministic design, artifact, quality, and delivery adapters
while persisting Projects, commands, workflows, source metadata, evidence lineage,
Context Packages, audits, and side-effect claims in SQLite.

Run the contract tests with `python -m pytest`.

Use `oeydesign.ControlPlane` for the in-memory contract harness, or
`oeydesign.SQLiteApplication("oeydesign.sqlite", data_root="./data")` as the
durable composition root. File databases require an explicit application data
root and cannot resolve outside it. The composition root exposes `evidence` for
CSV/PNG ingestion and confirmation, plus `context_assembler` for producing the
versioned Context Package consumed by the existing project flow. The contracts
are documented in `docs/spec/contract-skeleton.md`,
`docs/spec/runtime-recovery.md`, and `docs/spec/context-evidence-baseline.md`.
