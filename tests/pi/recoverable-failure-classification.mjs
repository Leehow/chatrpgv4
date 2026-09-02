#!/usr/bin/env node
/**
 * A failure whose envelope carries the correction must not be classed terminal.
 *
 * `failureDisposition` falls through to
 * `invariant_terminal` / `recoverable_by: "none"` / no next action for any code
 * it does not recognise. `rule_decision_stale` already carries a comment saying
 * what that cost: "the Keeper was told the turn was over while the way out was
 * in hand". `unknown_semantic_input` was in the same position -- its envelope
 * names the offending key and lists every declared slot, so the fix is always
 * to resend the same call without that key.
 *
 * Seen live on 2026-09-02 settling a social difficulty adjudication with a
 * stray `source_ref`: the Keeper recovered in one step from an envelope that
 * told it recovery was impossible.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const { projectPiToolFailure } = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts")).href
);

const project = (code, details = {}) => projectPiToolFailure({
  ok: false,
  tool: "rules.settle",
  error: { code, message: `probe: ${code}`, details },
}, "rules.settle");

const stray = project("unknown_semantic_input", {
  failure: {
    code: "unknown_semantic_input",
    message: "semantic input 'source_ref' is not a declared slot",
    declared_slots: ["approach", "goal", "target_ref"],
  },
});
assert.equal(stray.error.recoverable_by, "model_next_action");
assert.notEqual(stray.error.class, "invariant_terminal");
assert.ok(
  stray.error.allowed_next_actions.some((a) => a.operation === "rules.settle"),
  "the way out is to resend the same operation without the undeclared key",
);

// The precedent this follows, held alongside it so neither regresses alone.
const stale = project("rule_decision_stale", { family: "social" });
assert.equal(stale.error.recoverable_by, "model_next_action");
assert.notEqual(stale.error.class, "invariant_terminal");

// Nothing was loosened: an unrecognised code still fails closed as terminal.
const unknown = project("some_code_with_no_declared_recovery");
assert.equal(unknown.error.class, "invariant_terminal");
assert.equal(unknown.error.recoverable_by, "none");
assert.deepEqual(unknown.error.allowed_next_actions, []);

console.log("recoverable-failure-classification ok");
