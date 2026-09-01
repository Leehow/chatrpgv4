#!/usr/bin/env node
/**
 * Push/Luck `pushed-roll` closed `rules.settle` projection.
 *
 * The canonical payload below is copied verbatim from the Gate 9 run that
 * failed this projection:
 *   pi-coc-gate9-ten-family-06f5baaa/a10-social-push/evidence/
 *     turn-p-1d0e467bcdb6.json
 * That turn committed its canonical pushed settlement exactly once and then
 * failed to build a model view on `bound_check.npc_id`,
 * `social_adjudication_ref` and `original_check.integrity_digest`, so the
 * Keeper never saw the pushed D100 it had already rolled.
 */
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

const settleData = {
    "decision_ref": "decision:coc7:push-luck:pushed-roll",
    "family": "push-luck",
    "status": "settled",
    "rule_refs": [
      "rule:coc7:push-luck:canonical-continuation-hydration"
    ],
    "investigator_id": "thomas-hayes",
    "event": null,
    "player_state_receipt": null,
    "current_hp": null,
    "conditions": null,
    "settlement": {
      "existing_result_envelope": true,
      "result": {
        "bound_check": {
          "base_target": 40,
          "target": 40,
          "required_level": "regular",
          "difficulty": "regular",
          "required_target": 40,
          "effective_target": 40,
          "achieved_level": "failure",
          "passed": false,
          "success": false,
          "surplus_levels": 0,
          "outcome": "failure",
          "bonus": 0,
          "penalty": 0,
          "roll": 42,
          "unmodified_roll": 42,
          "tens_values": [],
          "units": null,
          "investigator_id": "thomas-hayes",
          "skill": "Persuade",
          "target_source": "sheet",
          "pushed": true,
          "goal": "get Knott to accept deposit and written incident terms",
          "stakes": {
            "on_success": "the described social action achieves its declared goal: get Knott to accept deposit and written incident terms",
            "on_failure": "the described social action does not achieve its declared goal: get Knott to accept deposit and written incident terms"
          },
          "difficulty_basis": "opponent_skill",
          "npc_id": "npc-steven-knott",
          "social_goal_key": "c53fb45214298d29",
          "social_adjudication_ref": "c53fb45214298d29",
          "outcome_ceiling": {
            "goal_scope": "get Knott to accept deposit and written incident terms",
            "npc_knowledge_refs": [],
            "scene_truth_max_tier": null,
            "forbidden_fact_refs": [],
            "resolved_npc_knowledge_refs": [],
            "resolved_forbidden_fact_refs": []
          },
          "method_changed": "reframes terms as landlord liability risk if known incidents are withheld",
          "failure_consequence": {
            "summary": "Knott becomes thoroughly angry and may cancel the commission entirely"
          },
          "announced_consequence": {
            "summary": "Knott becomes thoroughly angry and may cancel the commission entirely"
          },
          "pushed_roll_protocol": {
            "failure_consequence_source": "keeper",
            "keeper_foreshadowed_failure": true,
            "player_confirmation_recorded": true
          },
          "original_check": {
            "tool": "rules.roll",
            "decision_id": "roll-social-adjudicate-knott-terms-v2",
            "roll_id": "toolbox-gate9-a10-social-push-06f5baaa-000002",
            "integrity_digest": "sha256:10c9a7d2895977c55c8672521f214fcb1ad262e84b5f08295cc667e320c9ab09"
          },
          "roll_id": "toolbox-gate9-a10-social-push-06f5baaa-000003"
        },
        "outcome": "failure",
        "pushed": true,
        "original_check_decision_id": "roll-social-adjudicate-knott-terms-v2",
        "failure_consequence": "Knott becomes thoroughly angry and may cancel the commission entirely",
        "method_changed": "reframes terms as landlord liability risk if known incidents are withheld",
        "player_confirmed_risk": true
      }
    },
    "next_decisions": [],
    "authority": "canonical-resolver-state-receipts",
    "request_digest": "sha256:2be39b420ea5d2d2c66094489e25eb2c0bf9ab08c3a05dd50c2a77b05cbeb156"
  };

const canonical = {
  ok: true,
  tool: "rules.settle",
  data: settleData,
  warnings: [],
  hints: [],
};

const { createSemanticIdentityRegistry } = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts",
));
// Mirror what the host does before projecting: register the settlement's own
// rolls, so this test exercises the real path rather than an empty registry.
const registry = createSemanticIdentityRegistry();
const registryScope = { sessionEpoch: 1, campaign: "recorded", playerTurnEpoch: 1 };
registry.register({
  domain: "roll",
  canonicalId: settleData.settlement.result.bound_check.roll_id,
  facts: [
    settleData.settlement.result.bound_check.skill,
    settleData.settlement.result.bound_check.goal,
    settleData.family,
  ],
  scope: registryScope,
  lifetime: "player_turn",
});

const diagnostics = { unmapped: [] };
const visible = projectModelVisibleCanonicalResult(
  "rules.settle",
  canonical,
  registry.projectAll(registryScope),
  diagnostics,
);

assert.equal(visible.ok, true, JSON.stringify(visible));
assert.deepEqual(
  diagnostics.unmapped,
  [],
  "the pushed settlement must project with no unmapped identity",
);

const result = visible.data.settlement.result;
const boundCheck = result.bound_check;

// ── The Keeper's product survives: the pushed D100 and its consequence. ──
assert.equal(boundCheck.roll, 42, "the pushed D100 face is preserved");
assert.equal(boundCheck.unmodified_roll, 42);
assert.equal(boundCheck.target, 40);
assert.equal(boundCheck.outcome, "failure");
assert.equal(boundCheck.achieved_level, "failure");
assert.equal(boundCheck.passed, false);
assert.equal(boundCheck.pushed, true);
assert.equal(boundCheck.skill, "Persuade");
assert.equal(
  boundCheck.goal,
  "get Knott to accept deposit and written incident terms",
);
assert.equal(
  result.failure_consequence,
  "Knott becomes thoroughly angry and may cancel the commission entirely",
);
assert.equal(result.outcome, "failure");
assert.equal(result.pushed, true);
assert.equal(result.player_confirmed_risk, true);
// The model-facing join back to the original check is a decision id.
assert.equal(
  result.original_check_decision_id,
  "roll-social-adjudicate-knott-terms-v2",
);

// ── The three paths that failed in Gate 9 are hidden, not relayed. ──
assert.equal(
  Object.hasOwn(boundCheck, "original_check"),
  false,
  "the raw rules.roll receipt (toolbox roll_id + integrity_digest) is host-only",
);
assert.equal(
  Object.hasOwn(boundCheck, "social_adjudication_ref"),
  false,
  "the Social correlation digest is not relayed through the Push lane",
);
assert.equal(
  Object.hasOwn(boundCheck, "social_goal_key"),
  false,
  "the Social correlation digest is not relayed under its other name either",
);
assert.equal(
  Object.hasOwn(boundCheck, "npc_id"),
  false,
  "the host-internal social-target id stays host-side",
);
// The `rules.settle` identity table declares `roll_id` host-only, so a
// settled roll's id never reaches the model — the Keeper's referenceable
// handle comes from `turn.output_context.required_obligation_ids` instead.
// This assertion is made against a POPULATED registry on purpose: against an
// empty one it would pass for the wrong reason, since an unregistered roll
// drops regardless. That distinction is not academic — an unregistered roll
// is what left a fumbled turn unjournalable at a live table.
assert.equal(
  Object.hasOwn(boundCheck, "roll_id"),
  false,
  "a settled roll's canonical id stays host-side even once registered",
);
// Nothing anywhere in the model view may carry the receipt integrity digest.
const rendered = JSON.stringify(visible);
assert.equal(
  rendered.includes("integrity_digest"),
  false,
  "no integrity digest reaches the model view",
);
assert.equal(
  rendered.includes("toolbox-"),
  false,
  "no machine toolbox identity reaches the model view",
);
assert.equal(
  rendered.includes("c53fb45214298d29"),
  false,
  "the social goal-key digest value does not survive under any field name",
);

// ── Mechanics are never rerun: no re-roll instruction is handed back. ──
assert.deepEqual(
  visible.data.next_decisions,
  [],
  "a settled push offers no further decision",
);

console.log("push-luck pushed-roll projection: ok");
