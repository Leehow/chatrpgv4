import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { tableTranscriptMessages } from "../projections.mjs";
import { buildTurnSseData, latestKeeperProjection } from "../turn-settle.mjs";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coc-turn-settle-"));
}

function writeCampaignLogs(ws, campaignId, files) {
  const logsDir = path.join(ws, ".coc/campaigns", campaignId, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(logsDir, name), body);
  }
}

const proseBefore = "你仔细查看门锁。";
const receipt = "【明骰】侦查｜掷骰：47；基础值：65；达到：成功；通过";
const rendered = [proseBefore, receipt].join("\n\n");

function writeRolledTurn(ws, campaignId, extra = {}) {
  writeCampaignLogs(ws, campaignId, {
    "table-transcript.jsonl": [
      JSON.stringify({
        role: "player",
        text: "我开门",
        turn: 1,
        entry_id: "table-transcript-v1:old",
      }),
      JSON.stringify({
        role: "keeper",
        text: "门后漆黑一片",
        turn: 1,
        finalization_id: "fin-1",
        entry_id: "table-transcript-v1:old-k",
      }),
      JSON.stringify({
        role: "player",
        text: "我检查门锁",
        turn: 2,
        entry_id: "table-transcript-v1:p2",
      }),
      JSON.stringify({
        role: "keeper",
        text: rendered,
        turn: 2,
        finalization_id: "fin-2",
        entry_id: "table-transcript-v1:k2",
        ...extra,
      }),
      "",
    ].join("\n"),
    "turn-finalizations.jsonl": [
      JSON.stringify({
        finalization_id: "fin-1",
        rendered_text: "门后漆黑一片",
        segments: [{ segment_type: "fiction", source_ids: [], text: "门后漆黑一片" }],
      }),
      JSON.stringify({
        finalization_id: "fin-2",
        rendered_text: rendered,
        segments: [
          { segment_type: "fiction", source_ids: [], text: proseBefore },
          { segment_type: "public_check", source_ids: ["roll-1"], text: receipt },
        ],
        bundle: {
          public_check: [
            {
              roll_id: "roll-1",
              visibility: "public",
              display_skill: "侦查",
              roll: 47,
              target: 65,
              difficulty: "regular",
              achieved_level: "regular",
              passed: true,
            },
          ],
        },
      }),
      "",
    ].join("\n"),
  });
}

test("RPC settle payload carries latest keeper content_blocks and stable ids", () => {
  const ws = makeWorkspace();
  writeRolledTurn(ws, "c1");
  const state = { campaign_id: "c1" };
  const usage = { input_tokens: 3, output_tokens: 5 };
  const payload = buildTurnSseData({
    state,
    usage,
    workspace: ws,
    campaignId: "c1",
  });

  assert.deepEqual(payload.events, []);
  assert.equal(payload.state, state);
  assert.equal(payload.usage, usage);
  assert.equal(payload.message.role, "keeper");
  assert.equal(payload.message.text, rendered);
  assert.equal(payload.message.finalization_id, "fin-2");
  assert.equal(payload.message.entry_id, "table-transcript-v1:k2");
  assert.equal(payload.message.turn, 2);
  assert.deepEqual(payload.message.content_blocks, [
    { type: "prose", text: proseBefore },
    {
      type: "roll_group",
      text: receipt,
      source_ids: ["roll-1"],
      layout: "check",
      rolls: [{
        roll_id: "roll-1",
        roll: 47,
        display_skill: "侦查",
        difficulty: "regular",
        achieved_level: "regular",
        target: 65,
        passed: true,
      }],
    },
  ]);
  assert.equal(latestKeeperProjection(ws, "c1").finalization_id, "fin-2");
  const keepers = tableTranscriptMessages(ws, "c1").filter((row) => row.role === "keeper");
  assert.equal(keepers[0].finalization_id, "fin-1");
  assert.equal(keepers[1].finalization_id, "fin-2");
});

test("RPC settle omits message when there is no table-transcript projection", () => {
  const ws = makeWorkspace();
  fs.mkdirSync(path.join(ws, ".coc/campaigns/c1"), { recursive: true });
  const payload = buildTurnSseData({
    state: { ok: true },
    usage: null,
    workspace: ws,
    campaignId: "c1",
  });
  assert.deepEqual(payload, { events: [], state: { ok: true }, usage: null });
  assert.equal("message" in payload, false);
  assert.equal(latestKeeperProjection(ws, "c1"), null);
});

test("RPC settle keeps a no-check keeper as prose without roll cards", () => {
  const ws = makeWorkspace();
  writeCampaignLogs(ws, "c1", {
    "table-transcript.jsonl": JSON.stringify({
      role: "keeper",
      text: "门后漆黑一片",
      turn: 1,
      finalization_id: "fin-plain",
    }) + "\n",
    "turn-finalizations.jsonl": JSON.stringify({
      finalization_id: "fin-plain",
      rendered_text: "门后漆黑一片",
      segments: [{ segment_type: "fiction", source_ids: [], text: "门后漆黑一片" }],
    }) + "\n",
  });
  const payload = buildTurnSseData({
    state: {},
    usage: null,
    workspace: ws,
    campaignId: "c1",
  });
  assert.equal(payload.message.text, "门后漆黑一片");
  assert.equal(payload.message.finalization_id, "fin-plain");
  assert.deepEqual(payload.message.content_blocks, [
    { type: "prose", text: "门后漆黑一片" },
  ]);
  assert.equal(
    payload.message.content_blocks.some((block) => block.type === "roll" || block.type === "roll_group"),
    false,
  );
});

test("RPC settle omits message when latest keeper identity did not change", () => {
  const ws = makeWorkspace();
  writeRolledTurn(ws, "c1");
  const payload = buildTurnSseData({
    state: {},
    usage: null,
    workspace: ws,
    campaignId: "c1",
    liveId: "live-stale",
    previousIdentity: "fin:fin-2",
  });
  assert.equal("message" in payload, false);
});

test("RPC settle omits message for an old latest keeper stamped with this live_id", () => {
  const ws = makeWorkspace();
  writeCampaignLogs(ws, "c1", {
    "table-transcript.jsonl": JSON.stringify({
      role: "keeper",
      text: "旧正文",
      turn: 1,
      finalization_id: "fin-old",
      entry_id: "k-old",
    }) + "\n",
    "turn-finalizations.jsonl": JSON.stringify({
      finalization_id: "fin-old",
      rendered_text: "旧正文",
      segments: [{ segment_type: "fiction", source_ids: [], text: "旧正文" }],
    }) + "\n",
  });
  const payload = buildTurnSseData({
    state: {},
    usage: null,
    workspace: ws,
    campaignId: "c1",
    liveId: "live-now",
    previousIdentity: "fin:fin-old",
  });
  assert.equal("message" in payload, false);
});

test("RPC settle omits message when the keeper row has no stable identity", () => {
  const ws = makeWorkspace();
  writeCampaignLogs(ws, "c1", {
    "table-transcript.jsonl": JSON.stringify({
      role: "keeper",
      text: "无身份正文",
    }) + "\n",
  });
  const payload = buildTurnSseData({
    state: {},
    usage: null,
    workspace: ws,
    campaignId: "c1",
    liveId: "live-now",
    previousIdentity: null,
  });
  assert.equal("message" in payload, false);
});

test("same rendered text on a new turn is a new identity and may carry live_id", () => {
  const ws = makeWorkspace();
  writeCampaignLogs(ws, "c1", {
    "table-transcript.jsonl": [
      JSON.stringify({
        role: "keeper",
        text: "门后漆黑一片",
        turn: 1,
        finalization_id: "fin-1",
        entry_id: "k1",
      }),
      JSON.stringify({
        role: "keeper",
        text: "门后漆黑一片",
        turn: 2,
        finalization_id: "fin-2",
        entry_id: "k2",
      }),
      "",
    ].join("\n"),
    "turn-finalizations.jsonl": [
      JSON.stringify({
        finalization_id: "fin-1",
        rendered_text: "门后漆黑一片",
        segments: [{ segment_type: "fiction", source_ids: [], text: "门后漆黑一片" }],
      }),
      JSON.stringify({
        finalization_id: "fin-2",
        rendered_text: "门后漆黑一片",
        segments: [{ segment_type: "fiction", source_ids: [], text: "门后漆黑一片" }],
      }),
      "",
    ].join("\n"),
  });
  const payload = buildTurnSseData({
    state: {},
    usage: null,
    workspace: ws,
    campaignId: "c1",
    liveId: "live-2",
    previousIdentity: "fin:fin-1",
  });
  assert.equal(payload.message.finalization_id, "fin-2");
  assert.equal(payload.message.turn, 2);
  assert.equal(payload.message.live_id, "live-2");
  assert.equal(payload.message.text, "门后漆黑一片");
});
