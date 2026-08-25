import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { OpeningTerminalContinuationGate } = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);
const { createOpeningSetupMachineMethods } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/opening-setup-machine.ts")
);

const owned = createOpeningSetupMachineMethods({});
assert.equal(typeof owned.hasActiveOpeningSetup, "function");
assert.equal(typeof owned.observeOpeningSetupInvocation, "function");
assert.equal(typeof owned.trackOpeningDispatch, "function");

const gate = new OpeningTerminalContinuationGate();
assert.equal(gate.hasActiveOpeningSetup(), false);
gate.trackOpeningDispatch("opening-bootstrap:machine-test:1");
assert.equal(
  gate.coordinatorContinuationContext(
    "opening-bootstrap:machine-test:1",
    "fulfilled",
  ).continuation_class,
  "blocking_opening",
);
assert.equal(gate.decideWake("opening-bootstrap:machine-test:1"), true);
gate.reset();
assert.equal(gate.hasActiveOpeningSetup(), false);

console.log(JSON.stringify({ ok: true, module: "opening-setup-machine" }));
