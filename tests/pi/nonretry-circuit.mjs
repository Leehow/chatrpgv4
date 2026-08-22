#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const { NonRetryableFailureCircuit } = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/nonretry-circuit.ts")).href
);

const circuit = new NonRetryableFailureCircuit();
const call = {
  campaignId: "campaign-1",
  operation: "turn.finalize",
  phase: "live_turn",
  operationArgs: { coverage: [] },
};
assert.equal(circuit.preflight(call), null);
circuit.observe({
  ...call,
  envelope: {
    ok: false,
    error: { code: "no_unfinalized_journal" },
    retryable: false,
    will_retry: false,
  },
});
assert.equal(circuit.preflight(call)?.error?.code, "nonretryable_repeat_blocked");
assert.equal(circuit.preflight({
  ...call,
  operationArgs: { coverage: [], draft: "corrected" },
}), null);
assert.equal(circuit.preflight({ ...call, phase: "pending_finalization" }), null);
circuit.observe({ ...call, envelope: { ok: true, data: {} } });
assert.equal(circuit.preflight(call)?.error?.code, "nonretryable_repeat_blocked");
circuit.reset();
assert.equal(circuit.preflight(call), null);

process.stdout.write(JSON.stringify({ ok: true }));
