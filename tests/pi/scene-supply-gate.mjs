#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const { decideSceneSupply } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/scene-supply.ts")
);

const pending = {
  enforced: true,
  ready: false,
  fallback_available: true,
  status: "pending",
};
const first = decideSceneSupply(pending, 0);
assert.equal(first.action, "wait");
assert.equal(first.playerWaitText, "场景载入中……");
assert.match(first.instruction, /does not judge or reorder play/);

const afterOneWait = decideSceneSupply(pending, 1);
assert.equal(afterOneWait.action, "retry_with_minimal");

const ready = decideSceneSupply({ enforced: true, ready: true, status: "ready" }, 0);
assert.equal(ready.action, "allow");
assert.equal(decideSceneSupply({ enforced: false, ready: true }, 99).action, "allow");

process.stdout.write(JSON.stringify({ ok: true }));
