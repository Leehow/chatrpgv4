#!/usr/bin/env node
/**
 * A family's `rules.context` carries more than cards: `canonical_context.
 * snapshot` is the live subsystem state the Keeper narrates from. For sanity
 * that is the bout itself — rounds remaining, the madness table result, each
 * involuntary action and the rule behind it.
 *
 * Its identity fields were undeclared, so the WHOLE envelope collapsed to
 * `semantic_identity_unavailable` — and only ever when a bout was underway,
 * which is exactly when there was something to narrate. Measured 2026-09-02:
 * three lanes of three, every sanity context of the run. Handed no cards and
 * no reason, the Keeper settled decision refs from memory and rewrote
 * arguments for a bout it could not see.
 *
 * The fixture is a verbatim envelope from the gate9-depth-10 campaign with a
 * bout active.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { projectModelVisibleCanonicalResult } = await import(path.join(
  root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
));
const { createSemanticIdentityRegistry } = await import(path.join(
  root, "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts",
));

const envelope = JSON.parse(fs.readFileSync(
  path.join(root, "tests/fixtures/rules-context-recorded/sanity-active-bout.json"),
  "utf8",
));
const snapshot = envelope.data.canonical_context.snapshot;
assert.equal(snapshot.bout_active, true, "the fixture must carry a live bout");

const view = createSemanticIdentityRegistry().projectAll({
  sessionEpoch: 1, campaign: "gate9-depth-10", playerTurnEpoch: 1,
});
const diagnostics = { unmapped: [] };
const visible = projectModelVisibleCanonicalResult(
  "rules.context", envelope, view, diagnostics,
);

assert.deepEqual(
  diagnostics.unmapped.map((entry) => entry.path ?? entry.field),
  [],
  "no identity field may be undeclared: one is enough to collapse the result",
);
assert.equal(visible.ok, true);
assert.ok(visible.data.cards.length > 0, "the cards must reach the Keeper");

// What the Keeper narrates from survives.
const seen = visible.data.canonical_context.snapshot;
assert.equal(seen.bout_active, true);
assert.equal(seen.bout_rounds_remaining, snapshot.bout_rounds_remaining);
assert.equal(
  seen.involuntary_actions[0].rule_ref,
  snapshot.involuntary_actions[0].rule_ref,
  "the rule behind an involuntary action is citable, not host-owned",
);

// Host-owned bout identity does not: the bout continues through
// next_decisions, never by echoing an id (fb98f0ac settled this for the
// settled view; the context view follows it).
const rendered = JSON.stringify(visible);
for (const hidden of [snapshot.active_bout_id, snapshot.events[0].event_id]) {
  assert.ok(hidden, "the fixture must actually carry this id");
  assert.equal(
    Object.hasOwn(seen, "active_bout_id"), false,
    "host-owned bout identity must not reach the model view",
  );
}
assert.ok(!rendered.includes(snapshot.active_bout_id));

console.log("rules.context canonical snapshot: ok");
