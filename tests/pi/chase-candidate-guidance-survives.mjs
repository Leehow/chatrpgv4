#!/usr/bin/env node
/**
 * The host's own guidance must survive the host's own identity rules.
 *
 * `chase_candidate_invalid` carried a `requires` block explaining what each
 * ref list must hold. It was a map keyed by the argument names -- and
 * `pursuer_refs`, `quarry_refs` and `location_refs` are identity-bearing
 * field names, so the projection held their VALUES to the ref grammar. Prose
 * is not a ref, so every value was dropped and the Keeper received
 * `"requires": {}` (observed model-side in r38).
 *
 * Keyed that way the block cannot be delivered at all. As a list of strings
 * it arrives intact.
 */
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { projectModelVisibleCanonicalResult } = await import(path.join(
  root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
));
const { createSemanticIdentityRegistry } = await import(path.join(
  root, "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts",
));

const view = createSemanticIdentityRegistry().projectAll({
  sessionEpoch: 1, campaign: "chase-guidance", playerTurnEpoch: 1,
});

const envelope = (requires) => ({
  ok: false,
  tool: "rules.settle",
  error: {
    code: "chase_candidate_invalid",
    message: "1 actor ref(s) are not in this scene",
    details: {
      scene_id: "corbitt-confrontation",
      rejected_actor_refs: ["investigator:current-investigator"],
      present_actor_refs: ["investigator:thomas-hayes"],
      connected_location_refs: ["scene:basement-rites"],
      requires,
    },
  },
  warnings: [],
  hints: [],
});

const project = (requires) => projectModelVisibleCanonicalResult(
  "rules.settle", envelope(requires), view, { unmapped: [] },
);

// The shape that was shipped, and what the Keeper actually got.
const keyed = project({
  pursuer_refs: "at least one, from present_actor_refs",
  location_refs: "at least two, from connected_location_refs",
});
assert.deepEqual(
  keyed.error.details.requires, {},
  "a map keyed by identity-bearing field names cannot carry prose; if this "
  + "ever stops being true, the workaround below is no longer needed",
);

// The shape that survives.
const listed = project([
  "pursuer_refs: at least one, chosen from present_actor_refs",
  "location_refs: at least two, chosen from connected_location_refs",
]);
assert.equal(listed.error.details.requires.length, 2, listed.error.details);
assert.ok(
  listed.error.details.requires[0].includes("present_actor_refs"),
  listed.error.details.requires,
);

// The refs themselves ride in details and must arrive whole -- naming them in
// the message does not work, because Pi rewrites canonical ids out of error
// prose.
assert.deepEqual(
  listed.error.details.rejected_actor_refs,
  ["investigator:current-investigator"],
);
assert.deepEqual(
  listed.error.details.present_actor_refs, ["investigator:thomas-hayes"],
);

console.log("chase candidate guidance: survives projection as a list");
