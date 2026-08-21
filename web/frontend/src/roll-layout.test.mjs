import test from "node:test";
import assert from "node:assert/strict";

import { selectRollGroupView } from "./roll-layout.ts";

const checkRoll = { roll_id: "roll-1", roll: 47, display_skill: "侦查", passed: true };
const sanCheck = { roll_id: "san", roll: 70, kind: "sanity_check", passed: false };
const sanLoss = { roll_id: "loss", roll: 4, die_expression: "1D6" };
const attack = { roll_id: "atk", roll: 20, passed: true };
const defense = { roll_id: "dodge", roll: 40, passed: true };
const damageRoll = { roll_id: "dmg", roll: 6, die: "1D6" };

test("frontend selects SAN template from layout, not kind", () => {
  const view = selectRollGroupView({
    type: "roll_group",
    text: "理智",
    source_ids: ["san", "loss"],
    layout: "sanity",
    rolls: [sanCheck, sanLoss, checkRoll],
    sanity: {
      check_roll_id: "san",
      loss_roll_id: "loss",
      check: sanCheck,
      loss: sanLoss,
      san_before: 30,
      san_after: 26,
    },
  });
  assert.equal(view.kind, "sanity");
  assert.deepEqual(view.remaining.map((roll) => roll.roll_id), ["roll-1"]);
});

test("frontend selects combat opposed template from layout payload", () => {
  const view = selectRollGroupView({
    type: "roll_group",
    text: "近战",
    source_ids: ["atk", "dodge", "dmg"],
    layout: "combat",
    rolls: [attack, defense, damageRoll],
    combat: {
      defense_kind: "dodge",
      opposed_outcome: "attacker_higher",
      attack,
      defense,
      damage: { damage_roll_id: "dmg", roll: damageRoll, raw_damage: 6, hp_after: 4 },
    },
  });
  assert.equal(view.kind, "combat");
  assert.equal(view.combat.attack.roll_id, "atk");
  assert.equal(view.remaining.length, 0);
});

test("frontend selects opposed template from layout, not combat_role", () => {
  const view = selectRollGroupView({
    type: "roll_group",
    text: "对抗",
    source_ids: ["atk", "dodge"],
    layout: "opposed",
    rolls: [attack, defense],
    opposed: { left: attack, right: defense, winner: "investigator" },
  });
  assert.equal(view.kind, "opposed");
});

test("frontend selects damage template from layout", () => {
  const view = selectRollGroupView({
    type: "roll_group",
    text: "伤害",
    source_ids: ["dmg"],
    layout: "damage",
    rolls: [damageRoll],
    damage: { damage_roll_id: "dmg", roll: damageRoll, raw_damage: 6, hp_before: 10, hp_after: 4 },
  });
  assert.equal(view.kind, "damage");
  assert.equal(view.damage.hp_after, 4);
});

test("unknown or incomplete layout falls back to generic check", () => {
  const missingSanity = selectRollGroupView({
    type: "roll_group",
    text: "残缺理智",
    source_ids: ["san"],
    layout: "sanity",
    rolls: [sanCheck],
  });
  assert.equal(missingSanity.kind, "check");

  const unknown = selectRollGroupView({
    type: "roll_group",
    text: "未知",
    source_ids: ["roll-1"],
    layout: "mystery",
    rolls: [checkRoll],
  });
  assert.equal(unknown.kind, "check");
  assert.equal(unknown.rolls[0].roll_id, "roll-1");
});

test("kind and combat_role alone do not select a specialized view", () => {
  const view = selectRollGroupView({
    type: "roll_group",
    text: "只有 kind",
    source_ids: ["san", "atk", "dodge"],
    layout: "check",
    rolls: [sanCheck, attack, defense],
  });
  assert.equal(view.kind, "check");
  assert.equal(view.rolls.length, 3);
});
