#!/usr/bin/env node
/**
 * Every keeper-facing required argument the model cannot author must have a
 * named host supplier.
 *
 * `timeline.fork_confirm` required `request_decision_id`, which is stripped
 * from the model-owned schema and rejected by raw validation as host
 * identity — and no host lane attached it. The operation was structurally
 * uncallable and nothing reported that: the KP got `missing_param` naming a
 * field absent from its own `expected_schema`. `state.assets_liquidate` had
 * the same hole with `linked_time_decision_id`.
 *
 * This test checks accounting, not content: it does not decide which fields
 * belong to the host. It requires that every such field is *claimed* by one
 * of the three suppliers below, so a newly added one fails here instead of
 * failing silently at a live table.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { projectModelOwnedSchema, HOST_OWNED_FIELDS } = await load(
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
);
const { presentedTypedToolParameters } = await load(
  "plugins/coc-keeper/pi/lib/typed-tools.ts",
);
const { OPERATION_POLICY } = await load(
  "plugins/coc-keeper/pi/lib/operation-policy.generated.ts",
);
const { HOST_PROVENANCE_PLEDGES, pledgeConsumersOf, pledgedValue } = await load(
  "plugins/coc-keeper/pi/lib/host-provenance-pledges.ts",
);

const operations = JSON.parse(readFileSync(
  path.join(root, "plugins/coc-keeper/references/mcp-operation-contracts.json"),
  "utf8",
)).operations;

/**
 * Supplier 3 of 3: fields the gateway attaches for every call because they
 * are routing/idempotency identity rather than semantic arguments. Listed
 * here by name so the claim is visible; the other two suppliers are the
 * `HOST_OWNED_FIELDS` binding table and the pledge table under test.
 */
const GATEWAY_ATTACHED_FIELDS = new Set([
  "campaign",   // top-level invoke routing, never an argument the model writes
  "decision_id", // host-minted idempotency key (hostSceneWriteDecisionId)
  "root",
]);

const unclaimed = [];
for (const [operation, contract] of Object.entries(operations)) {
  if (OPERATION_POLICY[operation]?.audience !== "keeper") continue;
  const raw = contract.inputSchema;
  if (!Array.isArray(raw?.required)) continue;
  let modelOwned;
  try {
    modelOwned = projectModelOwnedSchema(
      operation,
      presentedTypedToolParameters(operation, raw),
    );
  } catch {
    continue; // schema overlays that refuse projection are covered elsewhere
  }
  const authorable = modelOwned.properties ?? {};
  const hostOwned = new Set(HOST_OWNED_FIELDS[operation] ?? []);
  const pledge = HOST_PROVENANCE_PLEDGES[operation];
  for (const field of raw.required) {
    if (Object.hasOwn(authorable, field)) continue;
    if (GATEWAY_ATTACHED_FIELDS.has(field)) continue;
    if (hostOwned.has(field)) continue;
    if (pledge?.field === field) continue;
    unclaimed.push(`${operation} -> ${field}`);
  }
}
assert.deepEqual(
  unclaimed,
  [],
  "keeper-facing required fields with no host supplier (the model cannot "
  + "author them and nothing attaches them, so the operation is uncallable):\n"
  + unclaimed.join("\n"),
);

// Each pledge names a real producer, and the pledged field is one the
// consumer actually requires — a pledge for a field nobody demands would
// pass the census above while attaching nothing that matters.
for (const [consumer, pledge] of Object.entries(HOST_PROVENANCE_PLEDGES)) {
  assert.ok(operations[pledge.producer], `${consumer}: unknown producer ${pledge.producer}`);
  assert.ok(
    operations[consumer].inputSchema.required.includes(pledge.field),
    `${consumer} does not require pledged field ${pledge.field}`,
  );
  assert.ok(
    pledgeConsumersOf(pledge.producer).includes(consumer),
    `${pledge.producer} does not report ${consumer} as a pledge consumer`,
  );
}

// The two live pledges, exercised end to end on their real value shapes.
assert.equal(
  pledgedValue(HOST_PROVENANCE_PLEDGES["timeline.fork_confirm"], {
    data: { decision_id: "confirm-fork-v1", timeline_id: "tl-alt" },
    arguments: {},
  }),
  "confirm-fork-v1",
);
const liquidate = HOST_PROVENANCE_PLEDGES["state.assets_liquidate"];
assert.equal(
  pledgedValue(liquidate, {
    data: { delta_minutes: 10 },
    arguments: { decision_id: "time-v3" },
  }),
  "time-v3",
);
assert.equal(
  pledgedValue(liquidate, {
    data: { delta_minutes: 0 },
    arguments: { decision_id: "time-v3" },
  }),
  null,
  "a zero-delta advance is not the settled window the contract names",
);

console.log("host-provenance-pledge-accounting ok");
