import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
));

function project(operation, data) {
  const diagnostics = { unmapped: [] };
  const visible = projection.projectModelVisibleCanonicalResult(
    operation,
    { ok: true, tool: operation, data },
    null,
    diagnostics,
  );
  assert.deepEqual(
    diagnostics.unmapped,
    [],
    `${operation}: ${JSON.stringify(diagnostics.unmapped)}`,
  );
  return visible.data;
}

const briefing = project("secrets.briefing", {
  schema_version: 1,
  scene_id: "commission-briefing",
  undiscovered_clues: [{
    clue_id: "clue:knott-commission",
    keeper_summary: "Knott wants the house investigated.",
  }],
});
assert.equal(
  briefing.undiscovered_clues[0].clue_id,
  "clue:knott-commission",
);

const actions = project("actions.list", {
  schema_version: 1,
  scene_id: "commission-briefing",
  affordances: [{
    id: "affordance:question-steven-knott",
    label: "Question Steven Knott",
  }],
});
assert.equal(
  actions.affordances[0].id,
  "affordance:question-steven-knott",
);

const setup = project("setup.inspect", {
  schema_version: 1,
  campaign_id: "graph-opening-projection",
  active_scenario_id: "the-haunting",
  starters: [{
    scenario_id: "the-haunting",
    pregens: [{ pregen_id: "thomas-hayes", name: "Thomas Hayes" }],
  }],
  projection_sha256: `sha256:${"b".repeat(64)}`,
});
assert.equal(setup.campaign_id, "graph-opening-projection");
assert.equal(setup.active_scenario_id, "the-haunting");
assert.equal(setup.starters[0].scenario_id, "the-haunting");
assert.equal(setup.starters[0].pregens[0].pregen_id, "thomas-hayes");
assert.equal(setup.projection_sha256, undefined);

for (const decisionId of [
  "record-knott-commission-clue",
  "grant-corbitt-house-keys",
  "grant-knott-commission-advance",
  "accept-commission-record",
  "ask-macario-summary-record",
  "confirm-commission-terms-record",
  "t2-record-clue-knott-keys",
  "t2-item-grant-corbitt-keys",
  "t2-cash-grant-knott-advance-20",
]) {
  assert.equal(
    projection.validateRawModelIdentityPayload({ decision_id: decisionId }).ok,
    true,
    decisionId,
  );
}

const handout = project("state.deliver_handout", {
  asset_id: "the-haunting-handout-1-knott-commission",
  delivered: true,
  newly_delivered: ["the-haunting-handout-1-knott-commission"],
  already_delivered: [],
  delivered_total: 1,
  card: {
    asset_id: "the-haunting-handout-1-knott-commission",
    kind: "document",
    content_origin: "source_verbatim",
    title: "Handout 1: Mr. Knott's Commission",
    text: "Exact registered source card body.",
    image_ref: null,
    source_refs: ["pdf_index-461"],
    player_visible: true,
    delivered: true,
  },
  presentation: {
    presentation_id: "the-haunting-handout-1-knott-commission:presentation:1",
    asset_id: "the-haunting-handout-1-knott-commission",
    revision: 1,
  },
});
assert.equal(handout.asset_id, "the-haunting-handout-1-knott-commission");
assert.equal(handout.card.text, "Exact registered source card body.");
assert.equal(handout.presentation, undefined);

const recovered = project("session.resume", {
  schema_version: 1,
  campaign_id: "graph-opening-projection",
  mode: "open_turn_recovery",
  delivery: {
    run_segment_id: "run-graph-opening-projection",
    exact_text_ref: "logs/finalized-deliveries.jsonl#latest",
  },
  checkpoint: {
    content_sha256: `sha256:${"d".repeat(64)}`,
    source: {
      run_segment_id: "run-graph-opening-projection",
      contract_projection_sha256: `sha256:${"e".repeat(64)}`,
    },
  },
  current_turn: {
    rows: [{
      tool: "state.record_clue",
      ok: true,
      receipt_summary: { clue_id: "clue-knott-keys" },
    }],
  },
});
assert.equal(recovered.delivery.run_segment_id, "run-graph-opening-projection");
assert.equal(recovered.delivery.exact_text_ref, undefined);
assert.equal(recovered.checkpoint.content_sha256, undefined);
assert.equal(recovered.current_turn.rows[0].receipt_summary.clue_id, "clue-knott-keys");
