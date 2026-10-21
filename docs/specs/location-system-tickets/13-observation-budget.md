# EL-13: preserve complete observation facts

Original91 submitted eight short sensory facts and failed the six-item cap, first
through a vague outer union error and then through output's precise error. The
initial GPT-6 Pro proposal retained per-item and combined-content budgets. The
owner explicitly rejected hard single-item limits because they can create bugs
and conceal defects; the implementation follows that correction.

Observation facts remain an array of nonblank strings with no per-item length,
fragment-count or total-byte ceiling. No host truncation, semantic compression,
merging, splitting into extra observations or automatic content loss is allowed.
Keep unrelated spatial schemas and ordinary admission/visibility/transaction
rules unchanged. No new timeout, lane or overall resource policy is introduced.

Writer: the selected observe command supplies the complete facts. Reader: the
existing receipt, storage, inspect and delivery projections retain those facts.
Actor: the Keeper uses the actual view under existing admission and coverage.
Existing raw request/receipt evidence supports byte/count diagnostics without a
new rejection condition or a separate production metrics subsystem.

Verify eight short facts and a larger view exceeding every discarded content
bound through canonical staging, receipt, publication, inspection and restart.
Check the native and compatibility entry schemas agree. Malformed facts and
blocked observations still refuse atomically. These are component regressions;
original-session live acceptance remains separate. Outer union diagnostics and
private-map capability routing remain separate work.
