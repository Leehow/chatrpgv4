#!/usr/bin/env node
/**
 * A social adjudication that grants leverage must reach the Keeper.
 *
 * The leverage row carries two meaning-bearing ids: `source_ref` names the
 * player-known record the claim rests on (`clue:<clue_id>`,
 * `npc_agenda:<npc_id>`, …) and `leverage_id` is composed from it. Neither was
 * declared for `rules.settle`, and one undeclared identity field collapses the
 * WHOLE envelope to `semantic_identity_unavailable`.
 *
 * The shape of that is the cruel part: an adjudication that granted the player
 * NOTHING has `leverage: []` and projects fine, while the one that finally
 * counted their evidence collapses. So the failure only appeared once the card
 * fix started working.
 *
 * Live on 2026-09-02: a second, independent model wrote
 * `{level: 1, source_ref: "clue:clue-crown-slab-heraldry"}` correctly on its
 * first attempt, and every settle collapsed here.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const projection = await load("plugins/coc-keeper/pi/lib/tool-contract-projection.ts");
const registry = await load("plugins/coc-keeper/pi/lib/semantic-identity-registry.ts");

const adjudication = (leverage) => ({
  settlement: {
    result: {
      adjudication: {
        approach: "persuade",
        final_difficulty: leverage.length ? "hard" : "extreme",
        leverage,
        leverage_delta: leverage.length,
      },
    },
  },
});

const LEVERAGE = [{
  leverage_id: "support:clue:clue-crown-slab-heraldry",
  source_ref: "clue:clue-crown-slab-heraldry",
  independence_group: "clue:clue-crown-slab-heraldry",
  credibility: "verified",
  relevance: "direct",
  reason: "the crypt slab the players saw",
  type: "supporting_action",
}];

const project = (data) => {
  const diagnostics = { unmapped: [] };
  const out = projection.stripOpaqueModelIdentity(
    data, null, registry.emptySemanticProjectionView(), diagnostics, "rules.settle",
  );
  return { out, unmapped: diagnostics.unmapped.filter((u) => (u.path ?? "").includes("leverage")) };
};

// A granted leverage row survives, ids intact.
const granted = project(adjudication(LEVERAGE));
assert.deepEqual(granted.unmapped, [], "a granted leverage row must not collapse the envelope");
const row = granted.out.settlement.result.adjudication.leverage[0];
assert.equal(row.source_ref, "clue:clue-crown-slab-heraldry");
assert.equal(row.leverage_id, "support:clue:clue-crown-slab-heraldry");

// The empty case, which always worked, still works.
assert.deepEqual(project(adjudication([])).unmapped, []);

// Every leverage kind the resolver dispatches on projects the same way.
for (const ref of [
  "npc_agenda:npc-william-levett",
  "npc_fact:npc-sarah-browne/fact-one",
  "npc_state:npc-william-levett",
  "clue:clue-crown-slab-heraldry",
  "event:event-arrest-of-sarah",
]) {
  const one = project(adjudication([{ ...LEVERAGE[0], source_ref: ref, leverage_id: `support:${ref}` }]));
  assert.deepEqual(one.unmapped, [], `${ref} must project`);
}

console.log("social-leverage-projection ok");
