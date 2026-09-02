# 00 — System constitution

**KRN-001 — Event authority.** No committed domain event means no authoritative world-state change.

**KRN-002 — Proposal boundary.** Director output is a typed proposal that must be validated, resolved, and committed.

**KRN-003 — Public narration boundary.** Narrator receives a public `NarrativeFrame`, not unrestricted Keeper context.

**KRN-004 — Deterministic replay.** Fixed pack/rule hashes and event sequence must reproduce the same state hash.

**EVT-001 — Append-only history.** Committed events and commits are immutable.

**EVT-002 — Branch concurrency.** Every write names the expected branch revision; mismatch fails.

**EVT-003 — No generic world merge.** Branches support fork, checkout, comparison, and explicit carry policies, not automatic merge.

**TIM-001 — Three time axes.** Distinguish causal sequence, fictional occurrence time, and knowledge-acquisition time.

**TIM-002 — Explicit rewind.** Fictional time moves backward only through committed `TemporalReset` with an epoch increment and carry policy.

**RUL-001 — Typed execution.** Graph relations describe rules; deterministic mechanics execute through registered typed executors.

**RUL-002 — Auditable randomness.** Every draw uses an injected source and creates an `RngReceipt`; retries do not redraw.

**RUL-003 — Explicit overlays.** Core, optional, era, module, campaign, house, and session rules interact through named override relations.

**GRF-001 — Query-time secrecy.** Keeper-only facts are removed during query and context compilation, not hidden only by prompt.

**SEC-001 — Least capability.** Live model lanes have no coding tools, arbitrary filesystem, arbitrary network, or unrestricted database access.

**NAR-001 — Player ownership.** The system does not decide a player character's unexpressed thoughts, beliefs, emotions, or next action.
