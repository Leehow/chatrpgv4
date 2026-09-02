#!/usr/bin/env node
/**
 * Following a failure's own remedy must unblock the retry.
 *
 * The circuit fingerprints a non-retryable failure from model-owned arguments
 * and canonical progress. A failure whose documented remedy is a HOST-STATE
 * refresh changes neither, so performing the remedy could not clear the block.
 *
 * Live on 2026-09-02: `rules.settle` returned `rule_decision_stale` -- "call
 * rules.context for this family, then settle a decision_ref it returns" -- the
 * Keeper called `rules.context` for that exact family, re-settled with the
 * same (correct) arguments, and was answered `nonretryable_repeat_blocked`.
 * The social difficulty adjudicator stayed unreachable for the rest of the
 * turn and the Keeper fell back to plain core checks, so the scene's
 * difficulty came from somewhere other than the adjudicator that owns it.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const { NonRetryableFailureCircuit } = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/nonretry-circuit.ts")).href
);

const settle = {
  campaignId: "campaign-1",
  operation: "rules.settle",
  phase: "live_turn",
  operationArgs: { decision_ref: "decision:coc7:social:adjudicate-difficulty" },
};
const staleEnvelope = {
  ok: false,
  retryable: false,
  will_retry: false,
  error: {
    code: "rule_decision_stale",
    message: "no live machine-issued card grant covers this decision",
    details: { family: "social", refresh_operation: "rules.context" },
  },
};

// --- the live sequence -------------------------------------------------- //
const circuit = new NonRetryableFailureCircuit();
assert.equal(circuit.preflight(settle), null);
circuit.observe({ ...settle, envelope: staleEnvelope });
assert.notEqual(
  circuit.preflight(settle),
  null,
  "an unremedied repeat is still blocked",
);
circuit.observe({
  campaignId: "campaign-1",
  operation: "rules.context",
  phase: "live_turn",
  operationArgs: { family: "social" },
  envelope: { ok: true, data: { family: "social" } },
});
assert.equal(
  circuit.preflight(settle),
  null,
  "the remedy was performed; the retry must not be blocked",
);

// A host-bound next action states the same thing in projected form.
const projected = new NonRetryableFailureCircuit();
projected.observe({
  ...settle,
  envelope: {
    ok: false,
    retryable: false,
    error: {
      code: "rule_decision_stale",
      allowed_next_actions: [
        { operation: "rules.context", action: "refresh", host_bound: true },
      ],
    },
  },
});
assert.notEqual(projected.preflight(settle), null);
projected.observe({
  campaignId: "campaign-1",
  operation: "rules.context",
  phase: "live_turn",
  operationArgs: {},
  envelope: { ok: true },
});
assert.equal(projected.preflight(settle), null);

// --- nothing else was loosened ------------------------------------------ //
// An unrelated success does not clear a retained failure.
const unrelated = new NonRetryableFailureCircuit();
unrelated.observe({ ...settle, envelope: staleEnvelope });
unrelated.observe({
  campaignId: "campaign-1",
  operation: "scene.context",
  phase: "live_turn",
  operationArgs: {},
  envelope: { ok: true },
});
assert.notEqual(
  unrelated.preflight(settle),
  null,
  "only the operation the failure itself named may clear it",
);

// A different campaign's remedy does not clear this one.
const scoped = new NonRetryableFailureCircuit();
scoped.observe({ ...settle, envelope: staleEnvelope });
scoped.observe({
  campaignId: "campaign-2",
  operation: "rules.context",
  phase: "live_turn",
  operationArgs: {},
  envelope: { ok: true },
});
assert.notEqual(scoped.preflight(settle), null);

// A failure naming no host remedy is unaffected by any success.
const noRemedy = new NonRetryableFailureCircuit();
noRemedy.observe({
  ...settle,
  envelope: {
    ok: false,
    retryable: false,
    error: { code: "invariant_violated", details: {} },
  },
});
noRemedy.observe({
  campaignId: "campaign-1",
  operation: "rules.context",
  phase: "live_turn",
  operationArgs: {},
  envelope: { ok: true },
});
assert.notEqual(noRemedy.preflight(settle), null);

// A model-owned next action is NOT a clearing rule: correcting arguments
// already changes the fingerprint, so treating it as one would let an
// unchanged repeat through.
const modelOwned = new NonRetryableFailureCircuit();
modelOwned.observe({
  ...settle,
  envelope: {
    ok: false,
    retryable: false,
    error: {
      code: "unknown_semantic_input",
      allowed_next_actions: [
        { operation: "rules.settle", action: "correct_model_arguments", host_bound: false },
      ],
    },
  },
});
modelOwned.observe({ ...settle, envelope: { ok: true } });
// The success above is rules.settle itself succeeding, which legitimately
// resolves it; use a different operation to prove host_bound:false is ignored.
const modelOwned2 = new NonRetryableFailureCircuit();
modelOwned2.observe({
  ...settle,
  envelope: {
    ok: false,
    retryable: false,
    error: {
      code: "unknown_semantic_input",
      allowed_next_actions: [
        { operation: "rules.context", action: "correct_model_arguments", host_bound: false },
      ],
    },
  },
});
modelOwned2.observe({
  campaignId: "campaign-1",
  operation: "rules.context",
  phase: "live_turn",
  operationArgs: {},
  envelope: { ok: true },
});
assert.notEqual(
  modelOwned2.preflight(settle),
  null,
  "a model-owned next action must not clear the block",
);

console.log("nonretry-host-remedy ok");
