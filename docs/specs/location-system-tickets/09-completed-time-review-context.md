# EL-09: completed time is receipt-backed review state

Original79 committed five minutes, then held its selected approach/view twice.
The review had a fresh03:02 clock and a string containing a minutes5 outcome.
Original80, with the immediate view alone, succeeded. This does not prove why
Jev held79, but it exposes avoidable indirection: completed duration is embedded
in host prose rather than a named numeric fact. No time calculation belongs to
Jev and no new semantic permission follows from elapsed time.

For native current-input review after a successful call, read the existing
read-only table.status receipts projection with expected_turn. Derive
completed_time={elapsed_minutes,charges:[{minutes,clock_before,clock_after}]} from
canonical time receipts. Validate safe integer clock deltas and deduplicate IDs
before summing in code. Missing, conflicting or incomplete time evidence stays
unknown; no invented zero or start time. Do not expose receipt identifiers or
Keeper rationale in this view. No new storage or kernel method.

Writer: existing kernel time receipts own the actual deltas and before/after
clocks. Reader: the native admission path projects the current turn's receipts,
including after restart; older declaration recovery does not inherit this input's
time. Actor: existing Jev selection/restriction questions can read completed_time
as a fact without parsing a JSON string or adding durations. Family25 fingerprints
this additional view. All thresholds, atomicity, refusal reuse and other questions
remain. Elapsed time grants no move, observation, goods, payment or consent.

Keep legacy settlement evidence unchanged. Component tests cover real native
apply-time followed by place review, exact numeric state, deduplication, malformed
receipts and unchanged non-authorization gates. Finish with natural wait/view
in the original App; component pass alone is not a semantic or120s claim.

TypeSafe's state guidance prefers named related records; its current model notes
warn against date/number arithmetic and indirection. Temporal's event history is
an independent precedent for completed timers coming from retained events during
recovery. We reuse our existing receipts, without adding Temporal or a workflow
engine. These precedents support representation and arithmetic ownership only;
neither guarantees a Jev decision or authorizes a follow-up action.
https://docs.typesafe.ai/concepts/state
https://docs.typesafe.ai/model-jaggedness/jev-1.13
https://docs.temporal.io/encyclopedia/event-history
