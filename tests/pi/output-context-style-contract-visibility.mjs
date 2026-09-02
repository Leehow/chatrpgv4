#!/usr/bin/env node
// Slice T5: the text layer's craft vocabulary was computed every turn and
// dropped at the projection boundary, so the narrator never saw the avoid/
// prefer axes, the beat frame, the repetition policy, or the required rules
// — only a bare narration_budget number survived. This probe pins the
// style_contract onto the model-visible view of turn.output_context.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
).href);

const styleContract = {
  language: "zh-Hans",
  register: "natural_tabletop_narration",
  avoid: ["log_style_summary", "ai_summary_voice"],
  prefer: ["concrete_sensory_detail", "observable_behavior"],
  repetition_policy: { established_fact_mode: "compress" },
  style_guard: {
    required_rules: ["npc_direct_speech", "scene_sensory_anchor"],
    required_rule_text: {
      npc_direct_speech: "render at least one utterance as direct quoted speech",
      scene_sensory_anchor: "place at least one concrete sensory detail",
    },
    instruction: "show observable behavior before interpretation",
  },
  render_contract: { frame_type: "crisis_scene_render" },
  beat_frame: { play_register: "undeclared", types: { procedural: "carry" } },
  output_language: { play_language: "zh-Hans" },
  secret_host_field: "must-not-survive-projection",
};

const envelope = {
  ok: true,
  data: {
    schema_version: 1,
    turn_number: 3,
    obligations: [],
    required_obligation_ids: [],
    style_contract: styleContract,
    contract_projection: {
      narration_budget: {
        mode: "routine_resolution",
        max_chars: 600,
        max_paragraphs: 3,
      },
    },
  },
};

const projected = projection.projectModelVisibleCanonicalResult(
  "turn.output_context",
  envelope,
);
const view = projected.data.style_contract;
assert.ok(view, "style_contract must reach the model-visible view");
assert.deepEqual(view.avoid, styleContract.avoid);
assert.deepEqual(view.prefer, styleContract.prefer);
assert.equal(view.beat_frame.play_register, "undeclared");
assert.equal(
  view.style_guard.required_rule_text.npc_direct_speech,
  "render at least one utterance as direct quoted speech",
);
assert.equal(view.repetition_policy.established_fact_mode, "compress");
assert.equal(view.render_contract.frame_type, "crisis_scene_render");
assert.ok(
  !("secret_host_field" in view),
  "the style contract view is a closed field selection",
);
// The budget numbers stay visible next to the craft vocabulary.
assert.equal(
  projected.data.contract_projection.narration_budget.max_chars,
  600,
);
console.log(JSON.stringify({ ok: true }));
