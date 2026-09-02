#!/usr/bin/env node
// A settle whose canonical operation SUCCEEDED but whose model projection did
// not fit the transport budget must leave the Keeper a way forward. Observed
// live (2026-09-02, seeded combat lane): the envelope came back
// recoverable_by "none" with no allowed next action and an empty replay card,
// the Keeper retried identically, the repeat guard blocked it, and the turn
// dead-ended with canonical state already advanced.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
).href);

const failure = projection.projectPiToolFailure(
  {
    ok: false,
    tool: "rules.settle",
    error: {
      code: "mcp_wire_budget_exceeded",
      message:
        "The canonical operation succeeded, but its safe coding-host "
        + "projection could not fit the transport budget.",
    },
    data: { replay_operation: { operation: "rules.settle" } },
  },
  "rules.settle",
);
const error = failure.error;

assert.equal(error.code, "mcp_wire_budget_exceeded");
assert.notEqual(
  error.recoverable_by,
  "none",
  "a succeeded-but-unprojectable settlement must not be unrecoverable",
);
assert.ok(
  Array.isArray(error.allowed_next_actions) && error.allowed_next_actions.length > 0,
  "the Keeper must be given at least one allowed next action",
);
const [next] = error.allowed_next_actions;
assert.equal(next.operation, "turn.output_context");
assert.equal(next.host_bound, true);
assert.match(next.reason, /already recorded/);
assert.ok(
  !error.allowed_next_actions.some((action) => action.operation === "rules.settle"),
  "settling again would duplicate a settlement the host already recorded",
);

process.stdout.write(JSON.stringify({
  ok: true,
  recoverable_by: error.recoverable_by,
  next: error.allowed_next_actions.map((action) => action.operation),
}));
