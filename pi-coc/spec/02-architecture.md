# 02 — Architecture

```text
Electron renderer -> preload capability bridge -> local runtime API
 -> Chronicle Kernel
    -> Context Compiler -> graph stores / projections
    -> Director lane
    -> Plan Validator
    -> Rule Engine + Time Engine
    -> Event Ledger transaction
    -> NarrativeFrame -> Narrator -> Verifier
```

- `contracts` owns stable cross-package types and canonical hashes.
- `event-ledger` owns commits, events, branch heads, idempotency, replay, and persistence ports.
- `rule-engine` owns effective rule sets, executors, and rule receipts.
- `graph-runtime` owns typed traversal and visibility filtering.
- `context-compiler` builds bounded typed capsules and never calls a model.
- `pi-host` is an anti-corruption layer; domain packages do not import Pi session types.
- `chronicle-kernel` orchestrates but does not own individual rule logic or prose.

PostgreSQL is the authoritative durable store. Neo4j, RDF, vectors, and caches are optional derived views.
