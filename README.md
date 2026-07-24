# OEYdesign

Phase 1 is a dependency-free Python reference harness for the adopted project
contract.  It deliberately uses deterministic in-memory ports instead of a
model, renderer, database, workflow framework, or vendor message schema.

Run the contract tests with `python -m pytest`.

The public entry point is `oeydesign.ControlPlane`; its commands follow the
workflow documented in `docs/spec/contract-skeleton.md`.
