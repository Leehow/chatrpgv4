#!/usr/bin/env node
/**
 * `social_candidate_stale` is corrected in place, and its answer must survive.
 *
 * Live 2026-09-02: the Keeper opened a negotiation with `npc-joseph-fynche` —
 * a real authored NPC it had been narrating — who is not in the active scene.
 * The refusal was classed invariant_terminal with no next action, and its
 * details (`target_ref`, `active_scene_id`) are both undeclared identity for
 * `rules.settle`, so the projection emptied them: the Keeper got `{}`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const m = await load("plugins/coc-keeper/pi/lib/tool-contract-projection.ts");
const registry = await load("plugins/coc-keeper/pi/lib/semantic-identity-registry.ts");

const projected = m.projectPiToolFailure({
  ok: false,
  tool: "rules.settle",
  error: {
    code: "social_candidate_stale",
    message: "the semantic social target is not present in the active scene; present targets: npc-william-levett",
    details: { present_npc_ids: ["npc-william-levett"] },
  },
}, "rules.settle");
assert.equal(projected.error.recoverable_by, "model_next_action");
assert.notEqual(projected.error.class, "invariant_terminal");
assert.ok(projected.error.allowed_next_actions.some((a) => a.operation === "rules.settle"));

// The field carrying the answer must survive the identity projection; the two
// it replaced did not, which is why the Keeper saw an empty details object.
const diagnostics = { unmapped: [] };
const out = m.stripOpaqueModelIdentity(
  {
    target_ref: "social-target:npc-joseph-fynche",
    active_scene_id: "scene-church-climax",
    present_npc_ids: ["npc-william-levett", "npc-sarah-browne"],
  },
  null,
  registry.emptySemanticProjectionView(),
  diagnostics,
  "rules.settle",
);
assert.deepEqual(out.present_npc_ids, ["npc-william-levett", "npc-sarah-browne"]);

console.log("social-target-recoverable ok");
