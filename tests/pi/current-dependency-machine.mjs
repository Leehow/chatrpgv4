import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { OpeningTerminalContinuationGate } = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);
const { createCurrentDependencyMachineMethods } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/current-dependency-machine.ts")
);

const owned = createCurrentDependencyMachineMethods({});
assert.equal(typeof owned.observeCurrentDependencySnapshot, "function");
assert.equal(typeof owned.prepareCurrentDependencyDispatch, "function");
assert.equal(typeof owned.observeCurrentDependencyConsumerResult, "function");

const gate = new OpeningTerminalContinuationGate();
const dependencyRef = {
  operation: "state.effect_apply",
  decision_id: "current-dependency:harbor-ward:effect-1",
  subject: { kind: "location", id: "harbor-ward" },
};
gate.observeCurrentDependencySnapshot("machine-test", [{
  campaign_id: "machine-test",
  dependency_id: "current-dependency:harbor-ward:1",
  job_id: "deepen-location:harbor-ward:body-1",
  dependency_ref: dependencyRef,
}]);

const dispatchKey = "source-current:harbor-ward:1";
assert.equal(gate.prepareCurrentDependencyDispatch(
  "current-dependency:harbor-ward:1",
  "deepen-location:harbor-ward:body-1",
  dispatchKey,
), true);
assert.equal(
  gate.coordinatorContinuationContext(dispatchKey, "fulfilled")
    .continuation_class,
  "blocking_micro",
);
gate.observeCurrentDependencyTerminalReceipt(dispatchKey, {
  status: "fulfilled",
});
assert.equal(gate.decideWake(dispatchKey), true);
assert.equal(gate.currentDependencyDeliveryPending(
  "current-dependency:harbor-ward:1",
  "deepen-location:harbor-ward:body-1",
  dispatchKey,
), true);
gate.markCurrentDependencyTerminalDelivered(dispatchKey);
assert.match(
  gate.currentDependencyToolError({
    campaign: "machine-test",
    operation: "state.effect_clear",
    arguments: {},
  }),
  /blocked until the fulfilled current dependency/,
);
gate.commitCurrentDependencyDelivery(dispatchKey);
assert.equal(
  gate.coordinatorContinuationContext(dispatchKey, "fulfilled")
    .continuation_class,
  "nonblocking_background",
);

console.log(JSON.stringify({ ok: true, module: "current-dependency-machine" }));
