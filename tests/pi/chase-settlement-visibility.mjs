#!/usr/bin/env node
// The first chase this system ever started was hidden from the Keeper.
//
// Measured 2026-09-02, lane chase-r22: `rules.settle` on
// decision:coc7:chase:start succeeded canonically — save/chase.json written,
// status active, Corbitt bound as pursuer with MOV 8 — and the model was told
// `semantic_identity_unavailable`, because a chase settlement carries
// `chase_id` and the rules.settle identity table declared no such field, so
// the whole envelope collapsed. The Keeper retried, went stale, and finalized
// a turn that had in fact begun a chase it could not see.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
).href);

// The exact shape the chase executor writes, from the recorded state.
const chaseSettlement = {
  schema_version: 1,
  decision_ref: "decision:coc7:chase:start",
  family: "chase",
  status: "settled",
  settlement: {
    existing_result_envelope: true,
    result: {
      chase_id: "chase:corbitt-confrontation:investigator-thomas-hayes-vs-npc-npc-walter-corbitt",
      status: "active",
      participants: [
        {
          actor_id: "npc-walter-corbitt",
          side: "pursuer",
          vehicle_key: null,
          vehicle_actor_id: null,
        },
        { actor_id: "thomas-hayes", side: "quarry" },
      ],
      location_chain: [
        { index: 0, label: "basement-rites" },
        { index: 1, label: "corbitt-confrontation" },
      ],
    },
  },
};

const identity = projection.declaredIdentityFieldsForOperation?.("rules.settle")
  ?? null;
if (identity !== null) {
  for (const field of ["chase_id", "vehicle_actor_id", "vehicle_key"]) {
    assert.ok(
      identity.semantic?.has?.(field) ?? identity.includes?.(field),
      `${field} must be declared for rules.settle`,
    );
  }
}

// The declaration is what keeps a settled chase visible: an undeclared
// identity field collapses the whole envelope rather than the field.
const source = await import("node:fs").then((fs) => fs.readFileSync(
  path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  "utf-8",
));
const settleTable = source.slice(
  source.indexOf('["rules.settle", declaredIdentityTable('),
  source.indexOf('["state.npc_update", declaredIdentityTable('),
);
for (const field of [
  "chase_id", "vehicle_actor_id", "vehicle_key",
  "barrier_id", "hazard_id", "action_id", "choice_id",
  "attacker_id", "defender_id", "combat_id",
]) {
  assert.ok(settleTable.includes(`"${field}"`), `${field} missing from rules.settle`);
}
assert.ok(
  settleTable.includes("chase:<scene>:<quarry>-vs-<pursuer>"),
  "the declaration must record why these are semantic",
);
assert.ok(
  settleTable.includes("combat_command_id"),
  "combat_command_id must be host-only on rules.settle",
);
assert.ok(
  settleTable.includes("target_id"),
  "target_id must be declared for rules.settle",
);
assert.ok(
  settleTable.includes("conversation_window_id"),
  "conversation_window_id must be declared for rules.settle",
);
void chaseSettlement;

process.stdout.write(JSON.stringify({ ok: true }));
