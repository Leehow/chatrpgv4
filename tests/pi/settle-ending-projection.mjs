#!/usr/bin/env node
/**
 * Closes the gap that `settle-ending-projection-gap.mjs` pinned (and which
 * that test's own instructions said to replace with this one): the first
 * recorded `decision:coc7:development:settle-ending` settlement is vendored
 * in the recorded corpus, and rules.settle now projects development
 * settle-ending envelopes through a closed model view.
 *
 * The evidence: the r71 Gate 9 sweep (`debug-gate9-depth-10-r71`, lane
 * `x-settle-end`) settled settle-ending canonically — receipt generated,
 * state written — and the Pi boundary still handed the Keeper
 * `semantic_identity_unavailable`, because the generic sanitizer rejected
 * the envelope's generated ending handle, replay anchors, capsule/plan
 * digests and development-inputs ledger. The verbatim canonical envelope
 * from that run is `development-settle-ending-a324eb20.json` (provenance in
 * `index.json`); this test asserts it now survives projection with the
 * Keeper's continuation material intact and no machine internals leaking.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { projectModelVisibleCanonicalResult } = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
));
const { createSemanticIdentityRegistry } = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts",
));

const SETTLE_ENDING = "decision:coc7:development:settle-ending";

// (1) The decision is still live, not dead code.
const contracts = fs.readFileSync(
  path.join(root, "plugins/coc-keeper/references/mcp-operation-contracts.json"),
  "utf8",
);
assert.ok(
  contracts.includes(SETTLE_ENDING),
  "settle-ending must still be a declared operation; if it was retired, delete this test",
);

// (2) A real settlement is vendored. Same registry simulation as
//     rules-settle-recorded-projection.mjs: production registers every roll
//     a settlement carries before projecting it.
const dir = path.join(root, "tests/fixtures/rules-settle-recorded");
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
const recorded = index.payloads.filter((row) => row.decision_ref === SETTLE_ENDING);
assert.ok(
  recorded.length > 0,
  "the recorded settle-ending corpus must not be empty",
);

function semanticViewFor(data) {
  const registry = createSemanticIdentityRegistry();
  const scope = { sessionEpoch: 1, campaign: "recorded", playerTurnEpoch: 1 };
  const result = data?.settlement?.result ?? {};
  const rows = [];
  const walk = (value) => {
    if (Array.isArray(value)) { for (const v of value) walk(v); return; }
    if (!value || typeof value !== "object") return;
    rows.push(value);
    for (const v of Object.values(value)) walk(v);
  };
  walk(result);
  for (const row of rows) {
    const register = (canonicalId, facts) => {
      if (typeof canonicalId !== "string" || !canonicalId.trim()) return;
      registry.register({
        domain: "roll",
        canonicalId,
        facts,
        scope,
        lifetime: "player_turn",
      });
    };
    register(row.roll_id, [row.skill ?? row.characteristic, row.goal ?? result.source, data.family]);
    for (const [field, role] of [["check_roll_id", "check"], ["loss_roll_id", "loss"]]) {
      register(row[field], [result.source ?? row.goal, result.check?.skill ?? row.skill, role]);
    }
    for (const [index_, rollId] of (row.session_roll_ids ?? []).entries()) {
      register(rollId, [result.source, data.family, "session-roll", index_ + 1]);
    }
  }
  return registry.projectAll(scope);
}

for (const row of recorded) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, row.file), "utf8"));
  assert.equal(data.decision_ref, SETTLE_ENDING, row.file);
  const diagnostics = { unmapped: [] };
  const visible = projectModelVisibleCanonicalResult(
    "rules.settle",
    { ok: true, tool: "rules.settle", data, warnings: [], hints: [] },
    semanticViewFor(data),
    diagnostics,
  );

  // (3) The envelope survives, and identity does not collapse. Any unmapped
  //     identity is exactly what the gateway turns into
  //     semantic_identity_unavailable — the failure this test exists to
  //     keep closed.
  assert.equal(visible.ok, true, `${row.file}: envelope must stay ok`);
  assert.deepEqual(
    diagnostics.unmapped,
    [],
    `${row.file}: no identity may be left unmapped`,
  );

  const settlement = visible.data?.settlement;
  assert.ok(settlement, `${row.file}: the settlement must survive projection`);
  const receipt = settlement.result?.receipt;
  assert.ok(receipt, `${row.file}: the development.settle receipt must survive`);

  // (4) What the Keeper needs to continue: settlement status, the ending's
  //     story facts, the public dice, and the continuation surface.
  assert.equal(visible.data.status, "settled");
  assert.ok(Array.isArray(visible.data.next_decisions));
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.kind, "development.settle");

  const ending = receipt.result?.ending_evidence;
  assert.ok(ending, `${row.file}: which ending settled must stay visible`);
  assert.equal(ending.kind, "retreat");
  assert.equal(typeof ending.summary, "string");
  assert.ok(ending.summary.length > 0);
  assert.equal(ending.scene_id, "corbitt-house-ground");
  assert.equal(ending.scenario_id, "the-haunting");

  const checks = receipt.result?.improvement_checks;
  assert.ok(Array.isArray(checks) && checks.length > 0);
  assert.equal(checks[0].skill, "Listen");
  assert.equal(checks[0].check_roll, 90);
  assert.equal(checks[0].gain, 3);
  assert.equal(checks[0].value_after, 48);

  const mechanics = receipt.player_facing_mechanics;
  assert.ok(mechanics, "the rendered public rolls must stay visible");
  assert.equal(mechanics.complete, true);
  assert.ok(
    Array.isArray(mechanics.rendered_lines) && mechanics.rendered_lines.length >= 3,
    "all settled public rolls stay rendered",
  );

  const inventory = receipt.result?.inventory_settlement;
  assert.ok(Array.isArray(inventory?.added_gear), "the ending's gear movement stays visible");

  // (5) The projection is bounded: no digest, capsule, ledger, replay anchor
  //     or generated handle reaches the model view.
  const rendered = JSON.stringify(visible);
  const forbidden = [
    "toolbox-", "integrity_digest", "record_digest",
    "capsule_sha256", "plan_sha256", "settlement_plan_sha256", "input_sha256",
    "source_digest", "development_inputs", "rng_identity",
    "mechanical_baseline", "settlement_boundary", "event_ref", "boundary_id",
    "operation_id", "event_token", "input_tokens", "state_refs",
    "replayed_from", "ending_id",
    // The exact generated handles of the recorded run.
    "ending-2c5faac0429c515f5f8d",
    "op-development-settle-a0a098a90eb3-f4599269149f",
  ];
  for (const token of forbidden) {
    assert.equal(
      rendered.includes(token),
      false,
      `${row.file}: ${token} must not reach the model view`,
    );
  }
  assert.equal(
    /[0-9a-f]{64}/.test(rendered),
    false,
    `${row.file}: no 64-hex digest may reach the model view`,
  );
}

console.log(
  `settle-ending projection: ${recorded.length} recorded settlement(s) `
  + "project with no unmapped identity and no ledger internals",
);
