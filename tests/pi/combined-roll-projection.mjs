#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(pathToFileURL(path.join(
  root,
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
)).href);

test("combined rules.roll keeps its semantic rule refs on both projections", () => {
  const canonicalRollId = "toolbox-combined-rules-000001";
  const combined = {
    rule_ref: "core.combined_roll",
    roll_count: 1,
    comparison_mode: "any",
    targets: [{
      label: "Mechanical Repair",
      value: 20,
      required_target: 20,
      achieved_level: "failure",
      outcome: "failure",
      success: false,
    }, {
      label: "Electrical Repair",
      value: 90,
      required_target: 90,
      achieved_level: "regular",
      outcome: "regular",
      success: true,
    }],
    overall_success: true,
    development_tick_eligible: false,
    push_eligible: false,
    luck_spend_eligible: false,
  };
  const canonical = {
    ok: true,
    tool: "rules.roll",
    data: {
      kind: "combined_skill_check",
      investigator_id: "thomas-hayes",
      skill: "Combined: Mechanical Repair / Electrical Repair",
      roll: 49,
      success: true,
      roll_id: canonicalRollId,
      combined_roll: combined,
      player_projection: {
        roll: 49,
        success: true,
        roll_id: canonicalRollId,
        combined_roll: combined,
      },
    },
  };
  const semanticIds = {
    rolls: new Map([[canonicalRollId, "roll:combined-repair-check"]]),
    effects: new Map(),
    items: new Map(),
    weapons: new Map(),
    routes: new Map(),
    affordances: new Map(),
    lost: { items: new Map(), weapons: new Map() },
  };
  const diagnostics = { unmapped: [] };

  const visible = projection.projectModelVisibleCanonicalResult(
    "rules.roll",
    canonical,
    semanticIds,
    diagnostics,
  );

  assert.deepEqual(diagnostics.unmapped, []);
  assert.equal(visible.ok, true);
  assert.equal(visible.data.roll_id, "roll:combined-repair-check");
  assert.equal(visible.data.combined_roll.rule_ref, "core.combined_roll");
  assert.equal(
    visible.data.player_projection.combined_roll.rule_ref,
    "core.combined_roll",
  );
  assert.equal(
    visible.data.player_projection.roll_id,
    "roll:combined-repair-check",
  );
  assert.ok(!JSON.stringify(visible).includes(canonicalRollId));
});

test("combined rule_ref declaration still rejects opaque values", () => {
  const opaque = `core.${"a".repeat(32)}`;
  const diagnostics = { unmapped: [] };
  const visible = projection.projectModelVisibleCanonicalResult(
    "rules.roll",
    {
      ok: true,
      tool: "rules.roll",
      data: { combined_roll: { rule_ref: opaque } },
    },
    null,
    diagnostics,
  );

  assert.equal(visible.data.combined_roll.rule_ref, undefined);
  assert.ok(diagnostics.unmapped.some((row) => (
    row.field === "rule_ref" && row.domain === "unknown"
  )));
  assert.ok(!JSON.stringify(visible).includes(opaque));
});
