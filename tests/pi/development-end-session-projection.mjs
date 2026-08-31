#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const {
  projectModelVisibleCanonicalResult,
} = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
));

const hex = "a".repeat(64);
const canonical = {
  ok: true,
  tool: "state.end_session",
  wire: { full_result_sha256: `sha256:${hex}` },
  data: {
    session_ending: true,
    scene_id: "commission-briefing",
    kind: "conclusion",
    investigator_ids: ["thomas-hayes"],
    ending_id: "ending-e61e3a6e57827a6cfc4f",
    development: {
      status: "PASS",
      ending_id: "ending-e61e3a6e57827a6cfc4f",
      settlements: [{
        investigator_id: "thomas-hayes",
        status: "PASS",
        attempts: 1,
        receipt: {
          schema_version: 1,
          status: "PASS",
          kind: "development.settle",
          operation_id: "op-development-settle-e3cb13a3d9ab-b3f0d35a06fb",
          result: {
            skills_checked: ["Spot Hidden"],
            improvement_checks: [{
              skill: "Spot Hidden",
              check_roll: 60,
              gain: 1,
              value_before: 55,
              planned_value_after: 56,
              current_value_before_apply: 55,
              applied_delta: 1,
              value_after: 56,
              improved: true,
              merge_policy: "additive_monotonic",
            }],
            skills_improved: [{
              skill: "Spot Hidden",
              gain: 1,
              value_before: 55,
              value_after: 56,
              improved: true,
            }],
            development_san_reward: {
              expression: "1D4",
              roll: 3,
              value_before: 55,
              applied_delta: 3,
              value_after: 58,
              rule_ref: "coc7.development.san-reward",
            },
            scenario_san_reward: {
              expression: "1D6",
              roll: 4,
              value_before: 58,
              applied_delta: 4,
              value_after: 62,
              rule_ref: "coc7.scenario.san-reward",
            },
            luck_recovery: {
              roll: 43,
              success: false,
              gained: 0,
              luck_before: 50,
              luck_after: 50,
              rule_ref: "core.optional.luck_recovery",
            },
            player_facing_mechanics: {
              schema_version: 1,
              investigator_id: "thomas-hayes",
              operation_id: "op-development-settle-e3cb13a3d9ab-b3f0d35a06fb",
              required_roll_ids: ["op-development-settle-e3cb13a3d9ab-b3f0d35a06fb:check:0"],
              rendered_lines: ["【明骰】侦查（1D100）：骰面 60 → 总值 60"],
              rendered_text: "【明骰】侦查（1D100）：骰面 60 → 总值 60",
              complete: true,
              missing_roll_ids: [],
            },
            ending_evidence: {
              ending_id: "ending-e61e3a6e57827a6cfc4f",
              event_id: "ending-event-adf18931ed58c260370e",
              event_ref: "logs/events.jsonl#ending-event-adf18931ed58c260370e",
              scenario_id: "the-haunting",
              scenario_san_reward_rule_ref: "coc7.scenario.san-reward",
              source_digest: { campaign: { exists: true, sha256: hex } },
              development_inputs: {
                "thomas-hayes": {
                  event_token: "development-event:opaque-token",
                  input_tokens: "opaque-input-token",
                  source_images: { character: { exists: true, sha256: hex } },
                  deterministic_plan: { plan_sha256: hex },
                  input_sha256: hex,
                },
              },
              capsule_sha256: hex,
            },
            settlement_plan_sha256: hex,
          },
          player_facing_mechanics: {
            schema_version: 1,
            rendered_text: "【明骰】侦查（1D100）：骰面 60 → 总值 60",
            complete: true,
          },
          state_refs: ["save/investigator-state/thomas-hayes.json"],
        },
      }],
    },
  },
  warnings: [],
  hints: ["development settlement completed synchronously"],
};

const diagnostics = { unmapped: [] };
const visible = projectModelVisibleCanonicalResult(
  "state.end_session",
  canonical,
  null,
  diagnostics,
);

assert.equal(visible.ok, true);
assert.deepEqual(diagnostics.unmapped, []);
assert.equal(visible.data.session_ending, true);
assert.equal(visible.data.kind, "conclusion");
assert.equal(visible.data.scene_id, "commission-briefing");
assert.equal(visible.data.development.status, "PASS");
const settlement = visible.data.development.settlements[0];
assert.equal(settlement.investigator_id, "current-investigator");
assert.equal(settlement.status, "PASS");
assert.equal(settlement.receipt.result.improvement_checks[0].value_before, 55);
assert.equal(settlement.receipt.result.improvement_checks[0].gain, 1);
assert.equal(settlement.receipt.result.improvement_checks[0].value_after, 56);
assert.equal(settlement.receipt.result.luck_recovery.luck_before, 50);
assert.equal(settlement.receipt.result.luck_recovery.luck_after, 50);
assert.equal(
  settlement.receipt.result.luck_recovery.rule_ref,
  "core.optional.luck_recovery",
);
assert.equal(
  settlement.receipt.result.scenario_san_reward_rule_ref,
  "coc7.scenario.san-reward",
);
assert.equal(settlement.receipt.result.scenario_san_reward.value_before, 58);
assert.equal(settlement.receipt.result.scenario_san_reward.value_after, 62);
assert.equal(
  settlement.receipt.result.player_facing_mechanics.complete,
  true,
);
assert.equal(
  settlement.receipt.result.player_facing_mechanics.missing_roll_count,
  0,
);
assert.match(
  settlement.receipt.result.player_facing_mechanics.rendered_text,
  /侦查/,
);

const serialized = JSON.stringify(visible);
for (const forbidden of [
  "ending_id", "operation_id", "event_id", "event_ref",
  "scenario_id", "state_refs", "source_digest", "source_images",
  "event_token", "input_tokens", "deterministic_plan", "plan_sha256",
  "input_sha256", "capsule_sha256", "settlement_plan_sha256",
  "required_roll_ids", "missing_roll_ids", hex,
]) {
  assert.ok(!serialized.includes(forbidden), `host-only field leaked: ${forbidden}`);
}

console.log(JSON.stringify({
  ok: visible.ok,
  kind: visible.data.kind,
  developmentStatus: visible.data.development.status,
  mechanicsComplete: settlement.receipt.result.player_facing_mechanics.complete,
  opaqueFieldsAbsent: true,
}));
