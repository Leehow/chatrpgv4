// An interrupted turn must leave a campaign resumable.
//
// Found by playing: a daemon restart mid-turn put `graph-play1` into
// `open_turn_recovery`. The canonical layer named the next step; the transport
// collapse dropped `open_turn_anchor` and `current_turn`, which is what the
// host arms the recovery tools from, so the Keeper was told to "continue the
// current turn from receipts" with no card that could. It refused twice —
// correctly — and the campaign could not be resumed at all.
//
// Carrying the fields through the collapse then made it worse: undeclared at
// the identity boundary, the WHOLE envelope failed closed and `data` came back
// empty with `ok: true`. Three layers have to agree, and this pins all three.
import assert from "node:assert";
import { readFileSync } from "node:fs";

const projection = readFileSync(
  new URL("../../plugins/coc-keeper/pi/lib/tool-contract-projection.ts", import.meta.url),
  "utf8",
);
const wire = readFileSync(
  new URL("../../plugins/coc-keeper/scripts/coc_mcp_wire.py", import.meta.url),
  "utf8",
);

// Layer 1 — the collapse carries the anchor and the turn's counts.
const resumeCarve = wire.slice(
  wire.indexOf('if operation == "session.resume":'),
  wire.indexOf('if operation in {', wire.indexOf('if operation == "session.resume":')),
);
// Assert the assignment, not a mention: a comment naming the field survives
// deleting the line that carries it, which is how the first cut of this test
// passed against a collapse that dropped the anchor again.
assert.match(resumeCarve, /projected\["open_turn_anchor"\]\s*=/,
  "the collapse drops the anchor the host arms recovery from");
assert.match(resumeCarve, /projected\["current_turn"\]\s*=/,
  "the collapse drops the turn the host recovers");
// The rows travel, and only as much of them as the host's recovery predicate
// reads. `validPreJournalWindow` answers from the rows -- at least one, none a
// settled `state.journal` -- so dropping them entirely made it false and
// cleared the one accepted-input binding recovery can use; the host's own
// comment records a live table deadlocking that way. This assertion was
// written before that was known and said the opposite.
assert.match(resumeCarve, /slim\["rows"\]\s*=/,
  "the collapse drops the rows recovery answers from");
assert.match(resumeCarve, /_pick\(row, \("tool", "ok"\)\)/,
  "the rows must travel as the two fields the predicate reads, not whole");
for (const payload of ["arguments", "data_ref", "semantic_reason"]) {
  assert.ok(!resumeCarve.includes(`"${payload}"`),
    `the collapse exists to shed payload and kept ${payload}`);
}

// Layer 2 — session.resume declares them, or the boundary fails the envelope.
const table = projection.slice(
  projection.indexOf('["session.resume", declaredIdentityTable('),
  projection.indexOf('["scene.map", declaredIdentityTable('),
);
for (const field of ["timeline_id", "prior_finalized_source_digest", "anchor_digest"]) {
  assert.ok(table.includes(`"${field}"`),
    `session.resume does not declare ${field}; the whole resume envelope fails closed`);
}

// Layer 3 — declarations narrow the boundary, they never invent a name.
const universe = projection.slice(
  projection.indexOf("const CLASSIFIED_INTEGRITY_FIELDS"),
  projection.indexOf("]);", projection.indexOf("const CLASSIFIED_INTEGRITY_FIELDS")),
);
for (const field of ["prior_finalized_source_digest", "anchor_digest"]) {
  assert.ok(universe.includes(`"${field}"`),
    `${field} is declared integrity but outside the classified universe`);
}

console.log(JSON.stringify({ ok: true, module: "open-turn-anchor-survives-the-boundary" }));
