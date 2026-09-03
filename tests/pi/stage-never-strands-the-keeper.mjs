#!/usr/bin/env node
// A stage whose closed set leaves the Keeper no legal operation is a dead
// turn: nothing can abandon or repair one, so the campaign stops delivering.
// `output_context_ready` reached exactly that state on 2026-09-02 in campaign
// amaranthine-loop -- the output context failed closed, so `turn.finalize` was
// never bound; the binding filter then removed finalize and narration.review,
// and the producer was excluded because it was supposed to have already run.
// Twenty discovery calls, no legal operation, no turn delivered.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const workingSet = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/tool-working-set.ts")).href
);
const roleToolsModule = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/session-role-tools.ts")).href
);

const toolSchema = (name) => ({
  type: "object",
  properties: { tool_marker: { type: "string", const: name } },
  additionalProperties: false,
});
const resolvedHostTools = (role) => [...new Set([
  "coc_discover",
  "subagent",
  "await_subagent",
  ...roleToolsModule.extraToolsForSessionRole(role),
])].sort().map((name) => ({ name, parameters: toolSchema(name) }));

const snapshot = (overrides) => ({
  role: "play",
  phase: "pending_finalization",
  stage: "output_context_ready",
  playerTurnEpoch: 7,
  canonicalProgressRevision: 1,
  roleManifestToolNames: roleToolsModule.extraToolsForSessionRole("play"),
  hostTools: resolvedHostTools("play"),
  affordances: { operations: [] },
  loadedNamespaces: [],
  loadedOperations: [],
  ...overrides,
});

// The exact live shape: the stage says the output context is ready, but no
// finalize was ever bound because producing it failed.
const stranded = workingSet.projectToolWorkingSet(snapshot({
  boundOperations: [],
}));
assert.equal(stranded.ok, true, stranded.error?.message);
assert.ok(
  stranded.activeOperationNames.length > 0,
  "output_context_ready with no bound finalize left the Keeper nothing to call",
);
assert.ok(
  stranded.activeOperationNames.includes("turn.output_context"),
  "the operation that mints the missing binding must stay reachable: "
  + JSON.stringify(stranded.activeOperationNames),
);

// Review-then-finalize is the ordinary flow: finalize alone being unbound is
// normal while review can still advance the turn, and the producer that has
// already run must not come back.
const reviewFirst = workingSet.projectToolWorkingSet(snapshot({
  boundOperations: ["narration.review"],
}));
assert.equal(reviewFirst.ok, true, reviewFirst.error?.message);
assert.ok(reviewFirst.activeOperationNames.includes("narration.review"));
assert.ok(
  !reviewFirst.activeOperationNames.includes("turn.output_context"),
  "a stage that can still advance must not re-offer its producer",
);

const normal = workingSet.projectToolWorkingSet(snapshot({
  boundOperations: ["turn.finalize"],
}));
assert.equal(normal.ok, true, normal.error?.message);
assert.ok(normal.activeOperationNames.includes("turn.finalize"));
assert.ok(
  !normal.activeOperationNames.includes("turn.output_context"),
  "a satisfied stage must not re-offer its producer",
);

console.log(JSON.stringify({ ok: true, module: "stage-never-strands-the-keeper" }));
