import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { tableTranscriptMessages } from "../projections.mjs";
import { buildTurnSseData } from "../turn-settle.mjs";

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coc-roll-layout-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function writeCampaign(ws, campaignId, { transcript, finalizations, combat, ledger, exceptional } = {}) {
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
  if (ledger) writeJson(path.join(root, "save/toolbox-ledger.json"), ledger);
  if (exceptional) writeJson(path.join(root, "save/exceptional-effects.json"), exceptional);
}

function keeperBlocks(ws, campaignId = "c1") {
  const messages = tableTranscriptMessages(ws, campaignId);
  return messages.filter((row) => row.role === "keeper");
}

function rollGroup(blocks, index = 0) {
  const groups = (blocks || []).filter((block) => block.type === "roll_group");
  return groups[index];
}

test("ordinary skill check uses layout check", () => {
  const ws = makeWorkspace();
  const text = "【明骰】侦查｜掷骰：47；基础值：65；达到：成功；通过";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-check" },
    finalizations: {
      finalization_id: "fin-check",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["roll-1"], text }],
      bundle: {
        public_check: [{
          roll_id: "roll-1", visibility: "public", display_skill: "侦查",
          roll: 47, target: 65, difficulty: "regular", achieved_level: "regular", passed: true,
        }],
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "check");
  assert.equal(group.sanity, undefined);
  assert.equal(group.combat, undefined);
  assert.equal(group.rolls[0].roll, 47);
});

test("SAN constant fail without loss die still projects before/after/loss", () => {
  const ws = makeWorkspace();
  const text = "【明骰】理智｜掷骰：65；基础值：60；达到：失败；未通过";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 9, finalization_id: "fin-san-const" },
    finalizations: {
      finalization_id: "fin-san-const",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["san-blast"], text }],
      bundle: {
        public_check: [{
          roll_id: "san-blast", visibility: "consequence_public", kind: "sanity_check",
          display_skill: "理智", roll: 65, target: 60, outcome: "failure", passed: false,
          san_before: 60, san_after: 59, san_delta: -1, san_loss: 1, san_loss_expression: "1",
        }],
      },
    },
    ledger: {
      schema_version: 2,
      entries: {
        '["rules.sanity_check","san-blast-carnage-0009"]': {
          entry_schema_version: 2,
          tool: "rules.sanity_check",
          decision_id: "san-blast-carnage-0009",
          ts: "2026-08-20T06:27:01Z",
          data: {
            check_roll_id: "san-blast",
            san_before: 60,
            san_after: 59,
            san_loss: 1,
            loss_detail: { expression: "1", resolution: "constant", raw_total: 1, rolls: [] },
          },
        },
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "sanity");
  assert.equal(group.sanity.san_before, 60);
  assert.equal(group.sanity.san_after, 59);
  assert.equal(group.sanity.san_loss, 1);
  assert.equal(group.sanity.san_loss_expression, "1");
  assert.equal(group.rolls[0].san_before, 60);
  assert.equal(group.rolls[0].san_loss_expression, "1");
});

test("SAN fail stamps ledger receipt onto thin public_check (60→59 loss 1)", () => {
  const ws = makeWorkspace();
  const text = "【明骰】理智（骰值）：骰面 65 → 总值 65";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 9, finalization_id: "fin-san-thin" },
    finalizations: {
      finalization_id: "fin-san-thin",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["san-blast"], text }],
      bundle: {
        public_check: [{
          roll_id: "san-blast", visibility: "consequence_public", kind: "sanity_check",
          display_skill: "理智", roll: 65, target: 60, outcome: "failure",
        }],
      },
    },
    ledger: {
      schema_version: 2,
      entries: {
        '["rules.sanity_check","san-blast-carnage-0009"]': {
          entry_schema_version: 2,
          tool: "rules.sanity_check",
          decision_id: "san-blast-carnage-0009",
          ts: "2026-08-20T06:27:01Z",
          data: {
            check_roll_id: "san-blast",
            san_before: 60,
            san_after: 59,
            san_loss: 1,
            check: { san_before: 60, san_after: 59, san_loss: 1, roll: 65, target: 60, outcome: "failure" },
            loss_detail: { expression: "1", resolution: "constant", raw_total: 1, rolls: [] },
          },
        },
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "sanity");
  assert.equal(group.sanity.san_before, 60);
  assert.equal(group.sanity.san_after, 59);
  assert.equal(group.sanity.san_loss, 1);
  assert.equal(group.sanity.san_loss_expression, "1");
  assert.equal(group.sanity.check.san_after, 59);
  assert.equal(group.rolls[0].san_loss, 1);
});

test("SAN success stamps zero loss from ledger receipt", () => {
  const ws = makeWorkspace();
  const text = "【明骰】理智｜掷骰：12；基础值：50；达到：成功；通过";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-san-zero" },
    finalizations: {
      finalization_id: "fin-san-zero",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["san-pass"], text }],
      bundle: {
        public_check: [{
          roll_id: "san-pass", visibility: "consequence_public", kind: "sanity_check",
          display_skill: "理智", roll: 12, target: 50, passed: true, outcome: "success",
        }],
      },
    },
    ledger: {
      schema_version: 2,
      entries: {
        '["rules.sanity_check","san-pass-dec"]': {
          entry_schema_version: 2,
          tool: "rules.sanity_check",
          decision_id: "san-pass-dec",
          ts: "2026-08-20T06:00:00Z",
          data: {
            check_roll_id: "san-pass",
            san_before: 50,
            san_after: 50,
            san_loss: 0,
            loss_detail: { expression: "0", resolution: "constant", raw_total: 0, rolls: [] },
          },
        },
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "sanity");
  assert.equal(group.sanity.san_before, 50);
  assert.equal(group.sanity.san_after, 50);
  assert.equal(group.sanity.san_loss, 0);
  assert.equal(group.sanity.san_loss_expression, "0");
  assert.equal(group.rolls[0].san_loss_expression, "0");
});

test("SAN success and failure with loss use layout sanity", () => {
  const ws = makeWorkspace();
  const passText = "【明骰】理智｜掷骰：12；基础值：50；达到：成功；通过";
  const failText = [
    "【明骰】理智｜掷骰：70；基础值：30；达到：失败；未通过",
    "【明骰】理智损失（1D6）：骰面 4 → 总值 4",
  ].join("\n");
  writeCampaign(ws, "c1", {
    transcript: [
      { role: "keeper", text: passText, turn: 1, finalization_id: "fin-san-pass" },
      { role: "keeper", text: failText, turn: 2, finalization_id: "fin-san-fail" },
    ],
    finalizations: [
      {
        finalization_id: "fin-san-pass",
        rendered_text: passText,
        segments: [{ segment_type: "public_check", source_ids: ["san-pass"], text: passText }],
        bundle: {
          public_check: [{
            roll_id: "san-pass", visibility: "consequence_public", kind: "sanity_check",
            display_skill: "理智", roll: 12, target: 50, passed: true,
            san_before: 50, san_after: 50, san_delta: 0, san_loss: 0, source: "墓穴壁画",
          }],
        },
      },
      {
        finalization_id: "fin-san-fail",
        rendered_text: failText,
        segments: [{ segment_type: "public_check", source_ids: ["san-fail", "san-loss"], text: failText }],
        bundle: {
          public_check: [
            {
              roll_id: "san-fail", visibility: "consequence_public", kind: "sanity_check",
              display_skill: "理智", roll: 70, target: 30, passed: false,
              san_before: 30, san_after: 26, san_delta: -4, source: "墓穴壁画",
            },
            {
              roll_id: "san-loss", visibility: "consequence_public", kind: "san_loss",
              roll: 4, die_expression: "1D6", rolls: [4], san_before: 30, san_after: 26,
            },
          ],
        },
      },
    ],
    ledger: {
      schema_version: 2,
      entries: {
        '["rules.sanity_check","san-fail-dec"]': {
          entry_schema_version: 2,
          tool: "rules.sanity_check",
          decision_id: "san-fail-dec",
          ts: "2026-01-01T00:00:00Z",
          data: {
            check_roll_id: "san-fail",
            loss_roll_id: "san-loss",
            san_before: 30,
            san_after: 26,
            san_loss: 4,
          },
        },
      },
    },
  });
  const keepers = keeperBlocks(ws);
  const passed = rollGroup(keepers[0].content_blocks);
  assert.equal(passed.layout, "sanity");
  assert.equal(passed.sanity.check_roll_id, "san-pass");
  assert.equal(passed.sanity.san_loss, 0);
  assert.equal(passed.sanity.source, "墓穴壁画");
  const failed = rollGroup(keepers[1].content_blocks);
  assert.equal(failed.layout, "sanity");
  assert.equal(failed.sanity.loss_roll_id, "san-loss");
  assert.equal(failed.sanity.san_before, 30);
  assert.equal(failed.sanity.san_after, 26);
  assert.equal(failed.sanity.loss.die_expression, "1D6");
});

test("attack vs dodge or fight back uses combat layout and both outcomes", () => {
  const ws = makeWorkspace();
  const text = "近战结算";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-melee" },
    finalizations: {
      finalization_id: "fin-melee",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["atk", "fb"], text }],
      bundle: {
        public_check: [
          { roll_id: "atk", visibility: "public", roll: 20, target: 60, achieved_level: "hard", passed: true },
          { roll_id: "fb", visibility: "public", roll: 55, target: 40, achieved_level: "failure", passed: false },
        ],
      },
    },
    combat: {
      rounds: [{ turns: [{
        turn_id: "t1-1",
        action: "attack",
        roll_id: "atk",
        opposed_roll_id: "fb",
        defense_kind: "fight_back",
        opposed_outcome: "attacker_higher",
        outcome: "hit",
      }] }],
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "combat");
  assert.equal(group.combat.defense_kind, "fight_back");
  assert.equal(group.combat.opposed_outcome, "attacker_higher");
  assert.equal(group.combat.attack.roll, 20);
  assert.equal(group.combat.defense.roll, 55);
});

test("damage chain plus HP delta uses combat or damage namespace", () => {
  const ws = makeWorkspace();
  const text = "伤害结算";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-dmg" },
    finalizations: {
      finalization_id: "fin-dmg",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["dmg"], text }],
      bundle: {
        public_check: [{
          roll_id: "dmg", visibility: "consequence_public", rolled_total: 6,
          dice: { expression: "1D6", raw: [6], total: 6 },
        }],
      },
    },
    combat: {
      damage_chain: [{
        damage_roll_id: "dmg", die: "1D6", raw_damage: 6, armor_absorbed: 1,
        hp_before: 11, hp_delta: -5, hp_after: 6, armor_before: 1, armor_after: 0,
      }],
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "damage");
  assert.equal(group.damage.raw_damage, 6);
  assert.equal(group.damage.armor_absorbed, 1);
  assert.equal(group.damage.hp_after, 6);
  assert.equal(group.damage.roll.die, "1D6");
});

test("non-combat opposed pairs only from ledger roll ids", () => {
  const ws = makeWorkspace();
  const text = "对抗结算";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-opp" },
    finalizations: {
      finalization_id: "fin-opp",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["mine", "theirs"], text }],
      bundle: {
        public_check: [
          { roll_id: "mine", visibility: "public", kind: "opposed_check", roll: 30, target: 60, passed: true },
          { roll_id: "theirs", visibility: "public", kind: "opposed_check", roll: 80, target: 50, passed: false },
        ],
      },
    },
    ledger: {
      schema_version: 2,
      entries: {
        '["rules.opposed","opp-1"]': {
          entry_schema_version: 2,
          tool: "rules.opposed",
          decision_id: "opp-1",
          ts: "2026-01-01T00:00:00Z",
          data: {
            investigator_roll_id: "mine",
            opponent_roll_id: "theirs",
            winner: "investigator",
          },
        },
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "opposed");
  assert.equal(group.opposed.left.roll_id, "mine");
  assert.equal(group.opposed.right.roll_id, "theirs");
  assert.equal(group.opposed.winner, "investigator");
});

test("bonus and penalty tens_values stay on the check roll", () => {
  const ws = makeWorkspace();
  const text = "奖励骰检定";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-bonus" },
    finalizations: {
      finalization_id: "fin-bonus",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["bonus"], text }],
      bundle: {
        public_check: [{
          roll_id: "bonus", visibility: "public", roll: 24, target: 60,
          bonus: 1, tens_values: [8, 2], units: 4, unmodified_roll: 84, passed: true,
        }],
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "check");
  assert.deepEqual(group.rolls[0].tens_values, [8, 2]);
  assert.equal(group.rolls[0].units, 4);
  assert.equal(group.rolls[0].bonus, 1);
});

test("penalty tens_values stay on the generic check roll", () => {
  const ws = makeWorkspace();
  const text = "惩罚骰检定";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-penalty" },
    finalizations: {
      finalization_id: "fin-penalty",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["penalty"], text }],
      bundle: {
        public_check: [{
          roll_id: "penalty", visibility: "public", roll: 84, target: 60,
          penalty: 1, tens_values: [2, 8], units: 4, unmodified_roll: 24, passed: false,
        }],
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "check");
  assert.equal(group.sanity, undefined);
  assert.equal(group.combat, undefined);
  assert.deepEqual(group.rolls[0].tens_values, [2, 8]);
  assert.equal(group.rolls[0].units, 4);
  assert.equal(group.rolls[0].penalty, 1);
  assert.equal(group.rolls[0].unmodified_roll, 24);
  assert.equal(group.rolls[0].bonus, undefined);
});

test("penalty tens_values stay on the combat layout DTO", () => {
  const ws = makeWorkspace();
  const text = "惩罚骰近战";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-penalty-combat" },
    finalizations: {
      finalization_id: "fin-penalty-combat",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["atk-pen", "fb-pen"], text }],
      bundle: {
        public_check: [
          {
            roll_id: "atk-pen", visibility: "public", roll: 84, target: 60,
            penalty: 1, tens_values: [2, 8], units: 4, unmodified_roll: 24, passed: false,
          },
          { roll_id: "fb-pen", visibility: "public", roll: 30, target: 50, passed: true },
        ],
      },
    },
    combat: {
      rounds: [{ turns: [{
        turn_id: "t1-pen",
        action: "attack",
        roll_id: "atk-pen",
        opposed_roll_id: "fb-pen",
        defense_kind: "fight_back",
        opposed_outcome: "defender_higher",
        outcome: "miss",
        attack_modifiers: { penalty: 1, cover: false },
      }] }],
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "combat");
  assert.equal(group.sanity, undefined);
  assert.equal(group.combat.attack.roll_id, "atk-pen");
  assert.deepEqual(group.rolls[0].tens_values, [2, 8]);
  assert.equal(group.rolls[0].units, 4);
  assert.equal(group.rolls[0].penalty, 1);
  assert.equal(group.rolls[0].unmodified_roll, 24);
  assert.deepEqual(group.combat.attack_modifiers, { penalty: 1, cover: false });
});

test("unique san_loss without ledger source link falls back to check", () => {
  const ws = makeWorkspace();
  const text = [
    "【明骰】理智｜掷骰：70",
    "【明骰】理智损失（1D6）：骰面 4 → 总值 4",
  ].join("\n");
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-san-guess" },
    finalizations: {
      finalization_id: "fin-san-guess",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["san-fail", "san-loss"], text }],
      bundle: {
        public_check: [
          { roll_id: "san-fail", visibility: "consequence_public", kind: "sanity_check", roll: 70, target: 30, passed: false },
          { roll_id: "san-loss", visibility: "consequence_public", kind: "san_loss", roll: 4, die_expression: "1D6" },
        ],
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "check");
  assert.equal(group.sanity, undefined);
});

test("two sanity checks in one group without unique link fall back to check", () => {
  const ws = makeWorkspace();
  const text = "两份理智";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-ambig" },
    finalizations: {
      finalization_id: "fin-ambig",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["san-a", "san-b"], text }],
      bundle: {
        public_check: [
          { roll_id: "san-a", visibility: "consequence_public", kind: "sanity_check", roll: 10, target: 50, passed: true },
          { roll_id: "san-b", visibility: "consequence_public", kind: "sanity_check", roll: 90, target: 40, passed: false },
        ],
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "check");
  assert.equal(group.sanity, undefined);
});

test("opposed kinds without ledger ids fall back to check", () => {
  const ws = makeWorkspace();
  const text = "未绑定对抗";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-no-ledger" },
    finalizations: {
      finalization_id: "fin-no-ledger",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["a", "b"], text }],
      bundle: {
        public_check: [
          { roll_id: "a", visibility: "public", kind: "opposed_check", roll: 20, target: 50, passed: true },
          { roll_id: "b", visibility: "public", kind: "opposed_check", roll: 70, target: 45, passed: false },
        ],
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.equal(group.layout, "check");
  assert.equal(group.opposed, undefined);
});

test("no public check stays prose", () => {
  const ws = makeWorkspace();
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text: "走廊空无一人", turn: 1, finalization_id: "fin-plain" },
    finalizations: {
      finalization_id: "fin-plain",
      rendered_text: "走廊空无一人",
      segments: [{ segment_type: "fiction", source_ids: [], text: "走廊空无一人" }],
    },
  });
  const blocks = keeperBlocks(ws)[0].content_blocks;
  assert.deepEqual(blocks, [{ type: "prose", text: "走廊空无一人" }]);
});

test("linked state_delta and exceptional_effect attach to the group", () => {
  const ws = makeWorkspace();
  const prose = "壁画让你一阵发冷。";
  const receipt = "【明骰】理智｜掷骰：70";
  const delta = "【变化】SAN：30 → 26（-4）";
  const extra = "【特殊影响】短暂耳鸣";
  const rendered = [prose, receipt, delta, extra].join("\n\n");
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text: rendered, turn: 1, finalization_id: "fin-fx" },
    finalizations: {
      finalization_id: "fin-fx",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: prose },
        { segment_type: "public_check", source_ids: ["san-1"], text: receipt },
        { segment_type: "state_delta", source_ids: ["fx-san"], text: delta },
        { segment_type: "exceptional_effect", source_ids: ["evt-1"], text: extra },
      ],
      bundle: {
        public_check: [{
          roll_id: "san-1", visibility: "consequence_public", kind: "sanity_check",
          roll: 70, target: 30, passed: false, san_before: 30, san_after: 26,
        }],
        state_delta: [{
          effect_id: "fx-san",
          effect_kind: "scalar",
          resource: "SAN",
          before: 30,
          after: 26,
          delta: -4,
          source_decision_id: "san-dec-1",
        }],
        exceptional_effect: [{
          event_id: "evt-1",
          effect_id: "ex-1",
          effect_kind: "condition",
          direction: "cost",
          player_visible_impact: "短暂耳鸣",
          consumed_by_roll_id: "san-1",
        }],
      },
    },
    ledger: {
      schema_version: 2,
      entries: {
        '["rules.sanity_check","san-dec-1"]': {
          entry_schema_version: 2,
          tool: "rules.sanity_check",
          decision_id: "san-dec-1",
          ts: "2026-01-01T00:00:00Z",
          data: { check_roll_id: "san-1", san_before: 30, san_after: 26, san_loss: 4 },
        },
      },
    },
  });
  const blocks = keeperBlocks(ws)[0].content_blocks;
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "prose");
  assert.equal(blocks[1].layout, "sanity");
  assert.equal(blocks[1].effects.length, 2);
  assert.equal(blocks[1].effects[0].resource, "SAN");
  assert.equal(blocks[1].effects[1].player_visible_impact, "短暂耳鸣");
  assert.equal(blocks.some((block) => block.type === "prose" && block.text.includes("【变化】")), false);
});

test("unlinked state_delta stays readable prose", () => {
  const ws = makeWorkspace();
  const rendered = ["你等了一会儿。", "【变化】时间：上午"].join("\n\n");
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text: rendered, turn: 1, finalization_id: "fin-time" },
    finalizations: {
      finalization_id: "fin-time",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: "你等了一会儿。" },
        { segment_type: "state_delta", source_ids: ["fx-time"], text: "【变化】时间：上午" },
      ],
      bundle: {
        public_check: [],
        state_delta: [{
          effect_id: "fx-time",
          effect_kind: "time",
          source_decision_id: "time-1",
        }],
      },
    },
  });
  const blocks = keeperBlocks(ws)[0].content_blocks;
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "prose");
  assert.match(blocks[0].text, /【变化】时间：上午/);
});

test("cross-segment combat pairs at the defense group and drops the consumed attack card", () => {
  const ws = makeWorkspace();
  const attackText = "【明骰】斗殴｜掷骰：20";
  const prose = "对方举臂格挡。";
  const defenseText = "【明骰】闪避｜掷骰：40";
  const rendered = [attackText, prose, defenseText].join("\n\n");
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text: rendered, turn: 1, finalization_id: "fin-split" },
    finalizations: {
      finalization_id: "fin-split",
      rendered_text: rendered,
      segments: [
        { segment_type: "public_check", source_ids: ["atk"], text: attackText },
        { segment_type: "fiction", source_ids: [], text: prose },
        { segment_type: "public_check", source_ids: ["dodge"], text: defenseText },
      ],
      bundle: {
        public_check: [
          { roll_id: "atk", visibility: "public", roll: 20, target: 55, passed: true },
          { roll_id: "dodge", visibility: "public", roll: 40, target: 50, passed: true },
        ],
      },
    },
    combat: {
      rounds: [{ turns: [{
        turn_id: "t1-1",
        action: "attack",
        roll_id: "atk",
        opposed_roll_id: "dodge",
        defense_kind: "dodge",
        opposed_outcome: "tie_defender_wins",
        outcome: "miss",
      }] }],
    },
  });
  const blocks = keeperBlocks(ws)[0].content_blocks;
  assert.deepEqual(blocks.map((block) => block.type), ["prose", "roll_group"]);
  assert.equal(blocks[1].layout, "combat");
  assert.equal(blocks[1].combat.attack.roll_id, "atk");
  assert.equal(blocks[1].combat.defense.roll_id, "dodge");
  assert.equal(blocks.some((block) => block.type === "roll_group" && block.layout === "check"), false);
});

test("live settle and reload projections are identical", () => {
  const ws = makeWorkspace();
  const prose = "你仔细查看门锁。";
  const receipt = "【明骰】侦查｜掷骰：47；基础值：65；达到：成功；通过";
  const rendered = [prose, receipt].join("\n\n");
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text: rendered, turn: 2, finalization_id: "fin-iso", entry_id: "k2" },
    finalizations: {
      finalization_id: "fin-iso",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: prose },
        { segment_type: "public_check", source_ids: ["roll-1"], text: receipt },
      ],
      bundle: {
        public_check: [{
          roll_id: "roll-1", visibility: "public", display_skill: "侦查",
          roll: 47, target: 65, passed: true,
        }],
      },
    },
  });
  const reloaded = keeperBlocks(ws)[0];
  const live = buildTurnSseData({
    state: {},
    usage: null,
    workspace: ws,
    campaignId: "c1",
  }).message;
  assert.deepEqual(live.content_blocks, reloaded.content_blocks);
  assert.equal(live.finalization_id, reloaded.finalization_id);
});

test("latest settle does not paint a previous turn's cards", () => {
  const ws = makeWorkspace();
  const oldText = "门后漆黑一片";
  const newText = "【明骰】侦查｜掷骰：47";
  writeCampaign(ws, "c1", {
    transcript: [
      { role: "player", text: "开门", turn: 1, entry_id: "p1" },
      { role: "keeper", text: oldText, turn: 1, finalization_id: "fin-old", entry_id: "k1" },
      { role: "player", text: "检查", turn: 2, entry_id: "p2" },
      { role: "keeper", text: newText, turn: 2, finalization_id: "fin-new", entry_id: "k2" },
    ],
    finalizations: [
      {
        finalization_id: "fin-old",
        rendered_text: oldText,
        segments: [{ segment_type: "fiction", source_ids: [], text: oldText }],
      },
      {
        finalization_id: "fin-new",
        rendered_text: newText,
        segments: [{ segment_type: "public_check", source_ids: ["roll-new"], text: newText }],
        bundle: {
          public_check: [{ roll_id: "roll-new", visibility: "public", roll: 47, target: 65, passed: true }],
        },
      },
    ],
  });
  const keepers = keeperBlocks(ws);
  assert.equal(keepers[0].finalization_id, "fin-old");
  assert.equal(
    keepers[0].content_blocks.some((block) => block.type === "roll_group"),
    false,
  );
  assert.equal(keepers[1].finalization_id, "fin-new");
  assert.equal(keepers[1].content_blocks[0].layout, "check");
  const live = buildTurnSseData({
    state: {},
    usage: null,
    workspace: ws,
    campaignId: "c1",
  }).message;
  assert.equal(live.finalization_id, "fin-new");
  assert.deepEqual(live.content_blocks, keepers[1].content_blocks);
});

test("ambiguous combat claims keep public checks as layout check", () => {
  const ws = makeWorkspace();
  const text = "两场近战共用同一组明骰";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-ambig-combat" },
    finalizations: {
      finalization_id: "fin-ambig-combat",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["atk-a", "atk-b"], text }],
      bundle: {
        public_check: [
          { roll_id: "atk-a", visibility: "public", roll: 21, target: 50, passed: true },
          { roll_id: "atk-b", visibility: "public", roll: 44, target: 55, passed: true },
        ],
      },
    },
    combat: {
      rounds: [{ turns: [
        {
          turn_id: "t1",
          action: "attack",
          roll_id: "atk-a",
          defense_kind: "none",
          opposed_outcome: "unopposed",
          outcome: "hit",
        },
        {
          turn_id: "t2",
          action: "attack",
          roll_id: "atk-b",
          defense_kind: "none",
          opposed_outcome: "unopposed",
          outcome: "hit",
        },
      ] }],
    },
  });
  const blocks = keeperBlocks(ws)[0].content_blocks;
  const group = rollGroup(blocks);
  assert.ok(group, "public check must not be dropped");
  assert.equal(group.layout, "check");
  assert.equal(group.combat, undefined);
  assert.equal(group.rolls.length, 2);
  assert.equal(group.text, text);
});

test("SAN check plus loss without ledger stays generic check", () => {
  const ws = makeWorkspace();
  const text = [
    "【明骰】理智｜掷骰：88",
    "【明骰】理智损失（1D4）：骰面 3 → 总值 3",
  ].join("\n");
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-san-noleger" },
    finalizations: {
      finalization_id: "fin-san-noleger",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["san-x", "loss-x"], text }],
      bundle: {
        public_check: [
          {
            roll_id: "san-x", visibility: "consequence_public", kind: "sanity_check",
            roll: 88, target: 40, passed: false,
          },
          {
            roll_id: "loss-x", visibility: "consequence_public", kind: "san_loss",
            roll: 3, die_expression: "1D4",
          },
        ],
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.ok(group);
  assert.equal(group.layout, "check");
  assert.equal(group.sanity, undefined);
  assert.equal(group.rolls.length, 2);
  assert.equal(group.text, text);
});

test("missing roll receipt keeps player-visible public-check prose", () => {
  const ws = makeWorkspace();
  const text = "【明骰】聆听｜掷骰：未绑定回执";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-missing-receipt" },
    finalizations: {
      finalization_id: "fin-missing-receipt",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["ghost-roll"], text }],
      bundle: { public_check: [] },
    },
  });
  const blocks = keeperBlocks(ws)[0].content_blocks;
  assert.equal(blocks.some((block) => block.type === "roll_group"), false);
  assert.equal(blocks.some((block) => block.layout === "sanity" || block.combat || block.opposed), false);
  assert.deepEqual(blocks, [{ type: "prose", text }]);
});

test("unknown kind with dice uses generic check and never a specialized template", () => {
  const ws = makeWorkspace();
  const text = "【明骰】未知仪式";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-unknown-kind" },
    finalizations: {
      finalization_id: "fin-unknown-kind",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["odd-1"], text }],
      bundle: {
        public_check: [{
          roll_id: "odd-1", visibility: "public", kind: "unregistered_rite",
          roll: 17, target: 40, passed: true,
        }],
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.ok(group);
  assert.equal(group.layout, "check");
  assert.equal(group.sanity, undefined);
  assert.equal(group.combat, undefined);
  assert.equal(group.opposed, undefined);
  assert.equal(group.damage, undefined);
  assert.equal(group.rolls[0].roll, 17);
  assert.equal(group.rolls[0].kind, "unregistered_rite");
});

test("ambiguous opposed ledger claims keep public checks as layout check", () => {
  const ws = makeWorkspace();
  const text = "两组对抗同框";
  writeCampaign(ws, "c1", {
    transcript: { role: "keeper", text, turn: 1, finalization_id: "fin-ambig-opp" },
    finalizations: {
      finalization_id: "fin-ambig-opp",
      rendered_text: text,
      segments: [{ segment_type: "public_check", source_ids: ["l1", "r1", "l2", "r2"], text }],
      bundle: {
        public_check: [
          { roll_id: "l1", visibility: "public", kind: "opposed_check", roll: 10, target: 50, passed: true },
          { roll_id: "r1", visibility: "public", kind: "opposed_check", roll: 80, target: 40, passed: false },
          { roll_id: "l2", visibility: "public", kind: "opposed_check", roll: 22, target: 55, passed: true },
          { roll_id: "r2", visibility: "public", kind: "opposed_check", roll: 90, target: 45, passed: false },
        ],
      },
    },
    ledger: {
      schema_version: 2,
      entries: {
        '["rules.opposed","opp-a"]': {
          entry_schema_version: 2,
          tool: "rules.opposed",
          decision_id: "opp-a",
          ts: "2026-01-01T00:00:00Z",
          data: { investigator_roll_id: "l1", opponent_roll_id: "r1", winner: "investigator" },
        },
        '["rules.opposed","opp-b"]': {
          entry_schema_version: 2,
          tool: "rules.opposed",
          decision_id: "opp-b",
          ts: "2026-01-01T00:00:00Z",
          data: { investigator_roll_id: "l2", opponent_roll_id: "r2", winner: "investigator" },
        },
      },
    },
  });
  const group = rollGroup(keeperBlocks(ws)[0].content_blocks);
  assert.ok(group);
  assert.equal(group.layout, "check");
  assert.equal(group.opposed, undefined);
  assert.equal(group.rolls.length, 4);
});
