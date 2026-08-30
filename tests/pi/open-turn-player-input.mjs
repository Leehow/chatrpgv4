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

function fixture(campaignId = "open-turn-player-input-fixture") {
  const workspace = mkdtempSync(path.join(tmpdir(), "pi-coc-open-input-"));
  mkdirSync(path.join(workspace, ".coc", "campaigns", campaignId), {
    recursive: true,
  });
  const currentTurn = {
    schema_version: 1,
    meaningful_row_count: 1,
    source_digest: "sha256:verified-current-turn",
    rows: [{ call_index: 3, tool: "actions.list", ok: true }],
  };
  return { workspace, campaignId, currentTurn };
}

test("accepted player input survives a host restart as one semantic card", () => {
  const { workspace, campaignId, currentTurn } = fixture();
  assert.equal(mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "natural-player-session",
    playerTurnEpoch: 4,
    text: playerText,
  }), "recorded");
  assert.equal(mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "natural-player-session",
    playerTurnEpoch: 4,
    text: playerText,
  }), "idempotent");
  assert.equal(mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "recovery-control-session",
    playerTurnEpoch: 1,
    text: "恢复战役，不要重发玩家输入。",
  }), "conflict");

  const recovered = mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
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
  const { workspace, campaignId, currentTurn } = fixture("open-turn-fail-closed");
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn,
  }), { ok: false, code: "missing" });

  mod.recordOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    sessionId: "natural-player-session",
    playerTurnEpoch: 2,
    text: playerText,
  });
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn: { ...currentTurn, source_digest: null },
  }), { ok: false, code: "not_open_pre_journal_turn" });
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: workspace,
    campaignId,
    currentTurn: {
      ...currentTurn,
      rows: [...currentTurn.rows, { tool: "state.journal", ok: true }],
    },
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
    });
  }
  mod.clearOpenTurnPlayerInput(first.workspace, first.campaignId);
  assert.deepEqual(mod.loadOpenTurnPlayerInput({
    root: first.workspace,
    campaignId: first.campaignId,
    currentTurn: first.currentTurn,
  }), { ok: false, code: "missing" });
  assert.equal(mod.loadOpenTurnPlayerInput({
    root: second.workspace,
    campaignId: second.campaignId,
    currentTurn: second.currentTurn,
  }).ok, true);
});
