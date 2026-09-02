#!/usr/bin/env node
/**
 * A field's grammar can belong to a path, not a name.
 *
 * `source_ref` under `supporting_action` names the player-known record a
 * leverage claim rests on, and the resolver dispatches on a closed set of
 * kinds. The name-keyed grammar demanded `player_input:current` or
 * `narration_contract:`, neither of which resolves as leverage -- so two host
 * layers demanded mutually exclusive forms of the same name.
 *
 * Live on 2026-09-02, in consecutive turns: the Keeper wrote
 * `player_input:current` (obeying the grammar) and the resolver refused it;
 * it then wrote `clue:clue-crown-slab-heraldry` -- correct, and the right
 * clue id, found on its own -- and the grammar refused that. Both times the
 * player's earned clue counted for nothing on the roll that followed. The
 * same failure is recorded for `candidate_ref`, which cost four settle round
 * trips in the first live combat.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const m = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts")).href
);
const check = (args) => m.validateRawModelIdentityPayload({ arguments: args });
const nested = (ref) => check({ semantic_inputs: { supporting_action: { level: 1, source_ref: ref } } });

// The leverage forms the resolver actually dispatches on.
for (const ref of [
  "clue:clue-crown-slab-heraldry",
  "npc_agenda:npc-william-levett",
  "npc_fact:npc-sarah-browne/fact-one",
  "npc_state:npc-william-levett",
  "event:event-arrest-of-sarah",
]) {
  assert.equal(nested(ref).ok, true, `${ref} must be accepted as leverage`);
}

// The narration handles do not resolve as leverage, and the refusal says so.
const refused = nested("player_input:current");
assert.equal(refused.ok, false);
assert.ok(
  refused.message.includes("clue:") && refused.message.includes("npc_agenda:"),
  "the refusal must name the forms that would work",
);

// The name-keyed grammar elsewhere is untouched in both directions.
assert.equal(check({ source_ref: "player_input:current" }).ok, true);
assert.equal(check({ source_ref: "clue:clue-crown-slab-heraldry" }).ok, false);

// The machine-namespace scan still runs on the nested path: a path-keyed
// grammar narrows which semantic form is legal and is never a way around it.
assert.equal(nested("pi-state-journal").ok, false);
// It runs exactly as it does for every other namespaced field, no more and no
// less -- the scan matches the START of the value, so a machine token AFTER a
// legal namespace passes here just as it does for `item_id`. That is the
// system's existing boundary, asserted so a change to it is deliberate.
assert.equal(nested("clue:pi-state-journal").ok, true);
assert.equal(check({ item_id: "item:pi-state-journal" }).ok, true);

// Both refusals a Keeper can act on are classed recoverable.
for (const code of ["opaque_identity_grammar", "leverage_source_invalid"]) {
  const projected = m.projectPiToolFailure(
    { ok: false, tool: "rules.settle", error: { code, message: "probe" } },
    "rules.settle",
  );
  assert.equal(projected.error.recoverable_by, "model_next_action", code);
  assert.notEqual(projected.error.class, "invariant_terminal", code);
}

console.log("nested-identity-grammar ok");
