# 07 — Rule graph and runtime

**RGR-001.** Validate unique node/edge IDs, non-dangling references, legal execution modes, provenance, entrypoints, and overlay relations.

**RGR-002.** Rule nodes are `deterministic`, `hybrid`, or `keeper_judgment`. Hybrid means typed adjudication slots, not free-form runtime prose.

**RGR-003.** Index rules by ID, domain, trigger, guards, inputs, emitted events, source refs, and test refs.

**RGR-004.** An enabled executable rule without a registered executor fails explicitly; it cannot fall back to an LLM.

**RGR-005.** Rule requests contain declared goal, actor, rule ID, typed inputs, difficulty where relevant, and adjudication reason.

**RGR-006.** Effective rule sets compile from explicit overlays; undeclared conflicts produce `RuleConflict`.

Required executor families: generic percentile/bonus/penalty/opposed/combined/push/Luck, SAN and insanity, combat and wounds, chase, advancement, economy, tomes, magic, and Keeper governance.
