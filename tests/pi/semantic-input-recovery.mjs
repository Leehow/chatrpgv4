#!/usr/bin/env node
// A settlement whose semantic_inputs name an undeclared slot, or omit a
// required one, is the model's own argument error — and the host already
// hands back the exact slot names. Observed live on 2026-09-02: the envelope
// carried `declared_slots: [affordance_id, candidate_ref, combat_revision,
// investigator_id]` for decision:coc7:combat:flee AND said
// `recoverable_by: "none"` with no allowed next action, so the Keeper never
// retried with corrected arguments; it went looking for other decisions to
// settle and the turn died with four failed settlements.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
).href);

const settleFailure = (code, failure) => projection.projectPiToolFailure(
  {
    ok: false,
    tool: "rules.settle",
    error: {
      code,
      message: "semantic input 'source_ref' is not a declared slot",
      details: {
        decision_ref: "decision:coc7:combat:flee",
        family: "combat",
        failure,
      },
    },
  },
  "rules.settle",
).error;

const unknown = settleFailure("unknown_semantic_input", {
  code: "unknown_semantic_input",
  declared_slots: [
    "affordance_id", "candidate_ref", "combat_revision", "investigator_id",
  ],
});
assert.notEqual(unknown.recoverable_by, "none");
assert.equal(unknown.recoverable_by, "model_next_action");
assert.equal(unknown.class, "schema_validation");
assert.equal(unknown.allowed_next_actions.length, 1);
assert.equal(unknown.allowed_next_actions[0].operation, "rules.settle");
assert.equal(unknown.allowed_next_actions[0].host_bound, false);
// the fix the host already computed must still be in hand
assert.deepEqual(
  unknown.details.failure.declared_slots,
  ["affordance_id", "candidate_ref", "combat_revision", "investigator_id"],
);

const missing = settleFailure("missing_semantic_input", {
  code: "missing_semantic_input",
  missing: ["candidate_ref"],
});
assert.equal(missing.recoverable_by, "model_next_action");
assert.deepEqual(missing.details.failure.missing, ["candidate_ref"]);

// A failure that is genuinely not the model's to fix keeps its own class.
const stale = projection.projectPiToolFailure(
  { ok: false, tool: "rules.settle", error: { code: "rule_decision_stale", message: "x" } },
  "rules.settle",
).error;
assert.notEqual(stale.class, "schema_validation");

process.stdout.write(JSON.stringify({
  ok: true,
  unknown: unknown.recoverable_by,
  missing: missing.recoverable_by,
}));
