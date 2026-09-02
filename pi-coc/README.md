# pi-coc

`pi-coc` is a specification-first skeleton for a Call of Cthulhu 7e AI Keeper runtime built around Pi.

The repository separates LLM interpretation/prose from deterministic rules/state, authored module knowledge from mutable campaign state, world truth from actor knowledge, fictional time from causal order, and conversation history from the authoritative event ledger.

> No event, no state change. LLM output is a proposal until validated and committed.

Implemented skeleton boundaries:

- typed domain contracts;
- append-only event ledger with optimistic concurrency, idempotency, branches, and replay;
- fictional time, scheduled events, and explicit temporal reset;
- rule-graph validation, rule overlays, executor registry, and percentile-check executor;
- visibility-aware graph slicing and bounded context capsules;
- Director, Narrator, Verifier, and Pi anti-corruption ports;
- Chronicle Kernel turn transaction;
- PostgreSQL schema, Electron sandbox stub, tests, and numbered specs.

This is a skeleton, not a completed game. Start with `spec/14-delivery-plan.md`, especially `WP-030`.

The full offline package supplied with this branch contains the complete structured rule graph (465 nodes, 1,470 edges, 68 Oracle cases, 18 invariants). This public staging path contains a representative graph fixture so other agents can work without copying commercial source PDFs.
