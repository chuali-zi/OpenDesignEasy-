# OEYdesign

OEYdesign currently provides the Phase 1 contract harness and the Phase 2
recoverable application foundation. It keeps deterministic design, artifact,
quality, and delivery adapters while persisting Projects, commands, workflow
checkpoints, event cursors, audits, and side-effect claims in SQLite.

Run the contract tests with `python -m pytest`.

Use `oeydesign.ControlPlane` for the in-memory contract harness, or
`oeydesign.SQLiteApplication("oeydesign.sqlite", data_root="./data")` as the
durable composition root. File databases require an explicit application data
root and cannot resolve outside it. The contracts are documented in
`docs/spec/contract-skeleton.md` and `docs/spec/runtime-recovery.md`.
