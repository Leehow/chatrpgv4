#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const mod = await import(
  pathToFileURL(path.join(
    root,
    "plugins/coc-keeper/pi/lib/open-turn-player-input.ts",
  )).href
);

const playerText = "我停下来检查右手的伤口，撕下一条干净布料，按住伤口并仔细包扎止血。";

test("Python and Pi compute the same canonical open-turn anchor digest", () => {
  const pythonAnchor = {
    schema_version: 1,
    kind: "coc_open_turn_anchor",
    timeline_id: "timeline-main",
    prior_finalized_turn: 1,
    prior_finalized_source_digest: `sha256:${"b".repeat(64)}`,
    next_turn_ordinal: 2,
    anchor_digest: "sha256:c003dea222b6ccccdfa6fcafc878328e3ab593b946c69c2da55afcdbc4d67f2b",
  };
  assert.equal(mod.validOpenTurnAnchor(pythonAnchor), true);
  assert.deepEqual(mod.createOpenTurnAnchor({
    timelineId: "timeline-main",
    priorFinalizedTurn: 1,
    priorFinalizedSourceDigest: `sha256:${"b".repeat(64)}`,
  }), pythonAnchor);
});

function fixture(campaignId = "open-turn-player-input-fixture") {
  const workspace = mkdtempSync(path.join(tmpdir(), "pi-coc-open-input-"));
  mkdirSync(path.join(workspace, ".coc", "campaigns", campaignId), {
    recursive: true,
  });
  const currentTurn = {
    schema_version: 1,
    meaningful_row_count: 1,
    source_digest: `sha256:${"a".repeat(64)}`,
    rows: [{ call_index: 3, tool: "actions.list", ok: true }],
  };
  const anchor = mod.createOpenTurnAnchor({
    timelineId: "timeline-main",
    priorFinalizedTurn: 1,
    priorFinalizedSourceDigest: `sha256:${"b".repeat(64)}`,
  });
  return { workspace, campaignId, currentTurn, anchor };
}

test("accepted player input survives a host restart as one semantic card", () => {
  const { workspace, campaignId, currentTurn, anchor } = fixture();
  assert.equal(mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "natural-player-session",
    playerTurnEpoch: 4,
    text: playerText,
    anchor,
  }), "recorded");
  assert.equal(mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "natural-player-session",
    playerTurnEpoch: 4,
    text: playerText,
    anchor,
  }), "idempotent");
  assert.equal(mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "recovery-control-session",
    playerTurnEpoch: 1,
    text: "恢复战役，不要重发玩家输入。",
    anchor,
  }), "conflict");

  const recovered = mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
    anchor,
  });
  assert.equal(recovered.ok, true);
  assert.deepEqual(recovered.card, {
    schema_version: 1,
    kind: "accepted_player_input",
    audience: "keeper_only",
    text: playerText,
    speaker: "player",
    intent_source: "external_player_message",
  });
  assert.equal(JSON.stringify(recovered.card).includes("session"), false);
  assert.equal(JSON.stringify(recovered.card).includes("sha256"), false);
});

test("missing, stale, journaled, or tampered recovery input fails closed", () => {
  const { workspace, campaignId, currentTurn, anchor } = fixture("open-turn-fail-closed");
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
    anchor,
  }), { ok: false, code: "missing" });

  mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "natural-player-session",
    playerTurnEpoch: 2,
    text: playerText,
    anchor,
  });
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn: { ...currentTurn, source_digest: null },
    anchor,
  }), { ok: false, code: "not_open_pre_journal_turn" });
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn: {
      ...currentTurn,
      rows: [...currentTurn.rows, { tool: "state.journal", ok: true }],
    },
    anchor,
  }), { ok: false, code: "not_open_pre_journal_turn" });

  const file = path.join(
    workspace,
    ".coc",
    "runtime",
    "open-turn-player-inputs",
    `${campaignId}.json`,
  );
  const tampered = JSON.parse(readFileSync(file, "utf8"));
  tampered.text = "被篡改的玩家输入";
  writeFileSync(file, `${JSON.stringify(tampered)}\n`, "utf8");
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
    anchor,
  }), { ok: false, code: "corrupt_or_tampered" });
});

test("settlement clear removes only the exact campaign cache", () => {
  const first = fixture("open-turn-clear-a");
  const second = fixture("open-turn-clear-b");
  for (const row of [first, second]) {
    mod.recordOpenTurnPlayerInput({
      root: row.workspace,
      campaignId: row.campaignId,
      sessionId: "natural-player-session",
      playerTurnEpoch: 1,
      text: playerText,
      anchor: row.anchor,
    });
  }
  mod.clearOpenTurnPlayerInput(first.workspace, first.campaignId, first.anchor);
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: first.workspace,
    campaignId: first.campaignId,
    currentTurn: first.currentTurn,
    anchor: first.anchor,
  }), { ok: false, code: "missing" });
  assert.equal(mod.loadOpenTurnPlayerInput({
    root: second.workspace,
    campaignId: second.campaignId,
    currentTurn: second.currentTurn,
    anchor: second.anchor,
  }).ok, true);
});

test("legacy campaign-only cache schema is rejected without migration", () => {
  const { workspace, campaignId, currentTurn, anchor } = fixture(
    "open-turn-legacy-cache",
  );
  const file = path.join(
    workspace,
    ".coc",
    "runtime",
    "open-turn-player-inputs",
    `${campaignId}.json`,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({
    schema_version: 1,
    kind: "coc_open_turn_player_input",
    campaign_id: campaignId,
    text: playerText,
    text_sha256: `sha256:${"0".repeat(64)}`,
    speaker: "player",
    intent_source: "external_player_message",
    source_session_id: "legacy-session",
    source_player_turn_epoch: 1,
  })}\n`, "utf8");
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
    anchor,
  }), { ok: false, code: "corrupt_or_tampered" });
});

test("timeline, turn, and prior-source anchors cannot cross-bind one campaign", () => {
  const { workspace, campaignId, currentTurn, anchor } = fixture(
    "open-turn-worldline-anchor",
  );
  assert.equal(mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "timeline-main-session",
    playerTurnEpoch: 3,
    text: playerText,
    anchor,
  }), "recorded");
  const mismatches = [
    mod.createOpenTurnAnchor({
      timelineId: "timeline-counterfactual",
      priorFinalizedTurn: 1,
      priorFinalizedSourceDigest: `sha256:${"b".repeat(64)}`,
    }),
    mod.createOpenTurnAnchor({
      timelineId: "timeline-main",
      priorFinalizedTurn: 2,
      priorFinalizedSourceDigest: `sha256:${"c".repeat(64)}`,
    }),
    mod.createOpenTurnAnchor({
      timelineId: "timeline-main",
      priorFinalizedTurn: 1,
      priorFinalizedSourceDigest: `sha256:${"d".repeat(64)}`,
    }),
  ];
  for (const candidate of mismatches) {
    assert.deepEqual(mod.loadOpenTurnPlayerInput({
      root: workspace,
      campaignId,
      currentTurn,
      anchor: candidate,
    }), { ok: false, code: "anchor_mismatch" });
  }
  assert.equal(mod.clearOpenTurnPlayerInput(
    workspace,
    campaignId,
    mismatches[0],
  ), "anchor_mismatch");
  assert.equal(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
    anchor,
  }).ok, true);

  const nextTurnAnchor = mismatches[1];
  const nextTurnText = "下一轮，我重新检查已经包扎的伤口。";
  assert.equal(mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "timeline-main-next-turn",
    playerTurnEpoch: 4,
    text: nextTurnText,
    anchor: nextTurnAnchor,
  }), "replaced_stale");
  assert.equal(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
    anchor: nextTurnAnchor,
  }).card.text, nextTurnText);
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
    anchor,
  }), { ok: false, code: "anchor_mismatch" });

  const fakeDigestAnchor = {
    ...nextTurnAnchor,
    anchor_digest: "sha256:not-a-canonical-digest",
  };
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
    anchor: fakeDigestAnchor,
  }), { ok: false, code: "invalid_anchor" });
});
