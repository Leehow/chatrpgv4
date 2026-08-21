import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { tableTranscriptMessages } from "../projections.mjs";
import { buildTurnSseData } from "../turn-settle.mjs";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coc-roll-firearms-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function writeCampaign(ws, campaignId, { transcript, finalizations, combat } = {}) {
  const root = path.join(ws, ".coc/campaigns", campaignId);
  const logsDir = path.join(root, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  if (transcript) {
    const lines = Array.isArray(transcript) ? transcript : [transcript];
    fs.writeFileSync(
      path.join(logsDir, "table-transcript.jsonl"),
      `${lines.map((row) => JSON.stringify(row)).join("\n")}\n`,
    );
  }
  if (finalizations) {
    const lines = Array.isArray(finalizations) ? finalizations : [finalizations];
    fs.writeFileSync(
      path.join(logsDir, "turn-finalizations.jsonl"),
      `${lines.map((row) => JSON.stringify(row)).join("\n")}\n`,
    );
  }
  if (combat) writeJson(path.join(root, "save/combat.json"), combat);
}

function groupOf(ws) {
  return tableTranscriptMessages(ws, "c1")[0].content_blocks.find((block) => block.type === "roll_group");
}

test("firearm shots populate combat.shots and damage chains", () => {
  const ws = makeWorkspace();
  const text = "连发射击";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-shots" },
    finalizations: {
      finalization_id: "fin-shots",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["s1", "d1", "s2", "d2"], text }],
      bundle: {
        public_check: [
          { roll_id: "s1", visibility: "public", roll: 20, target: 60, passed: true },
          { roll_id: "d1", visibility: "consequence_public", rolled_total: 4, dice: { expression: "1D6", raw: [4] } },
          { roll_id: "s2", visibility: "public", roll: 55, target: 60, passed: true },
          { roll_id: "d2", visibility: "consequence_public", rolled_total: 3, dice: { expression: "1D6", raw: [3] } },
        ],
      },
    },
    combat: {
      rounds: [{ turns: [{
        turn_id: "t1-1",
        action: "fire",
        roll_id: "s1",
        defense_kind: "none",
        opposed_outcome: "unopposed",
        outcome: "multi_shot_resolved",
        shots: [
          { shot: 1, roll_id: "s1", damage_roll_id: "d1", outcome: "hit" },
          { shot: 2, roll_id: "s2", damage_roll_id: "d2", outcome: "hit" },
        ],
      }] }],
      damage_chain: [
        { damage_roll_id: "d1", die: "1D6", raw_damage: 4, hp_before: 12, hp_delta: -4, hp_after: 8 },
        { damage_roll_id: "d2", die: "1D6", raw_damage: 3, hp_before: 8, hp_delta: -3, hp_after: 5 },
      ],
    },
  });
  const group = groupOf(ws);
  assert.equal(group.layout, "combat");
  assert.equal(group.combat.shots.length, 2);
  assert.equal(group.combat.shots[0].attack_roll_id, "s1");
  assert.equal(group.combat.shots[1].damage.hp_after, 5);
  const live = buildTurnSseData({ state: {}, usage: null, workspace: ws, campaignId: "c1" }).message;
  assert.deepEqual(live.content_blocks, tableTranscriptMessages(ws, "c1")[0].content_blocks);
});

test("firearm volleys populate combat.volleys and multi-hit damage", () => {
  const ws = makeWorkspace();
  const text = "全自动";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-volleys" },
    finalizations: {
      finalization_id: "fin-volleys",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["v1", "vd1", "vd2"], text }],
      bundle: {
        public_check: [
          { roll_id: "v1", visibility: "public", roll: 18, target: 70, passed: true },
          { roll_id: "vd1", visibility: "consequence_public", rolled_total: 5, dice: { expression: "1D8", raw: [5] } },
          { roll_id: "vd2", visibility: "consequence_public", rolled_total: 7, dice: { expression: "1D8", raw: [7] } },
        ],
      },
    },
    combat: {
      rounds: [{ turns: [{
        turn_id: "t1-1",
        action: "full_auto",
        roll_id: "v1",
        defense_kind: "none",
        opposed_outcome: "unopposed",
        outcome: "full_auto_resolved",
        volleys: [{ volley: 1, roll_id: "v1", damage_roll_ids: ["vd1", "vd2"], outcome: "hit", hits: 2 }],
      }] }],
      damage_chain: [
        { damage_roll_id: "vd1", die: "1D8", raw_damage: 5, hp_before: 14, hp_delta: -5, hp_after: 9 },
        { damage_roll_id: "vd2", die: "1D8", raw_damage: 7, hp_before: 9, hp_delta: -7, hp_after: 2 },
      ],
    },
  });
  const group = groupOf(ws);
  assert.equal(group.layout, "combat");
  assert.equal(group.combat.volleys.length, 1);
  assert.deepEqual(group.combat.volleys[0].damage_roll_ids, ["vd1", "vd2"]);
  assert.equal(group.combat.volleys[0].damages.length, 2);
  assert.equal(group.combat.volleys[0].damages[1].hp_after, 2);
});

test("duplicate combat roll claims fall back to check", () => {
  const ws = makeWorkspace();
  const text = "重复认领";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-dup" },
    finalizations: {
      finalization_id: "fin-dup",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["shared"], text }],
      bundle: {
        public_check: [{ roll_id: "shared", visibility: "public", roll: 33, target: 50, passed: true }],
      },
    },
    combat: {
      rounds: [{ turns: [
        {
          turn_id: "t1-1", action: "attack", roll_id: "shared",
          defense_kind: "none", opposed_outcome: "unopposed", outcome: "hit",
        },
        {
          turn_id: "t1-2", action: "attack", roll_id: "shared",
          defense_kind: "none", opposed_outcome: "unopposed", outcome: "hit",
        },
      ] }],
    },
  });
  const group = groupOf(ws);
  assert.equal(group.layout, "check");
  assert.equal(group.combat, undefined);
});

test("split shots without a unique owner fall back to check", () => {
  const ws = makeWorkspace();
  const first = "第一枪";
  const second = "第二枪";
  const rendered = [first, second].join("\n\n");
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text: rendered, turn: 1, finalization_id: "fin-split-shots" },
    finalizations: {
      finalization_id: "fin-split-shots",
      rendered_text: rendered,
      segments: [
        { segment_type: "public_check", source_ids: ["s1"], text: first },
        { segment_type: "public_check", source_ids: ["s2"], text: second },
      ],
      bundle: {
        public_check: [
          { roll_id: "s1", visibility: "public", roll: 20, target: 60, passed: true },
          { roll_id: "s2", visibility: "public", roll: 40, target: 60, passed: true },
        ],
      },
    },
    combat: {
      rounds: [{ turns: [{
        turn_id: "t1-1",
        action: "fire",
        defense_kind: "none",
        opposed_outcome: "unopposed",
        outcome: "multi_shot_resolved",
        shots: [
          { shot: 1, roll_id: "s1", outcome: "hit" },
          { shot: 2, roll_id: "s2", outcome: "hit" },
        ],
      }] }],
    },
  });
  const groups = tableTranscriptMessages(ws, "c1")[0].content_blocks.filter((block) => block.type === "roll_group");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].layout, "check");
  assert.equal(groups[1].layout, "check");
});

test("live_id is echoed only when the settle projection is a new identity", () => {
  const ws = makeWorkspace();
  const oldText = "旧回合";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text: oldText, turn: 1, finalization_id: "fin-old", entry_id: "k1" },
    finalizations: {
      finalization_id: "fin-old",
      rendered_text: oldText,
      segments: [{ segment_type: "fiction", source_ids: [], text: oldText }],
    },
  });
  const stalePayload = buildTurnSseData({
    state: {},
    usage: null,
    workspace: ws,
    campaignId: "c1",
    liveId: "live-new",
    previousIdentity: "fin:fin-old",
  });
  assert.equal("message" in stalePayload, false);

  const prose = "新正文";
  const receipt = "【明骰】侦查｜掷骰：11";
  const rendered = [prose, receipt].join("\n\n");
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text: rendered, turn: 2, finalization_id: "fin-new", entry_id: "k2" },
    finalizations: {
      finalization_id: "fin-new",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: prose },
        { segment_type: "public_check", source_ids: ["n1"], text: receipt },
      ],
      bundle: { public_check: [{ roll_id: "n1", visibility: "public", roll: 11, target: 50, passed: true }] },
    },
  });
  const fresh = buildTurnSseData({
    state: {},
    usage: null,
    workspace: ws,
    campaignId: "c1",
    liveId: "live-new",
    previousIdentity: "fin:fin-old",
  }).message;
  assert.equal(fresh.live_id, "live-new");
  assert.equal(fresh.finalization_id, "fin-new");
});
