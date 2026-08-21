import test from "node:test";
import assert from "node:assert/strict";

import {
  presentMechanicEffects,
  presentRollGroup,
  presentRollGroupEffects,
  presentSanityCard,
} from "./mechanic-effects.ts";
import { selectRollGroupView } from "./roll-layout.ts";

const sanCheck = { roll_id: "san", roll: 70, kind: "sanity_check", passed: false };
const attack = { roll_id: "atk", roll: 20, passed: true };
const defense = { roll_id: "dodge", roll: 40, passed: true };

test("presenter renders structured effects without markdown chrome", () => {
  const lines = presentMechanicEffects([
    { category: "state_delta", effect_kind: "scalar", resource: "SAN", before: 30, after: 26, delta: -4 },
    { category: "state_delta", effect_kind: "condition", condition: "major_wound", action: "added" },
    { category: "exceptional_effect", player_visible_impact: "短暂耳鸣" },
    { category: "exceptional_effect", player_visible_impact: "短暂耳鸣" },
  ]);
  assert.deepEqual(lines, [
    "SAN 30 → 26（-4）",
    "状态：新增「major_wound」",
    "短暂耳鸣",
  ]);
  assert.equal(lines.some((line) => line.includes("【")), false);
});

test("SAN fail card uses check stamp when payload top-level omitted", () => {
  const check = {
    roll_id: "san-blast",
    roll: 65,
    kind: "sanity_check",
    passed: false,
    target: 60,
    san_before: 60,
    san_after: 59,
    san_loss: 1,
    san_loss_expression: "1",
  };
  const card = presentSanityCard({ check_roll_id: "san-blast", check });
  assert.equal(card.before, 60);
  assert.equal(card.after, 59);
  assert.equal(card.amount, 1);
  assert.equal(card.lossExpression, "1");
});

test("SAN fail card uses payload loss/before/after without a loss die", () => {
  const check = {
    roll_id: "san-blast",
    roll: 65,
    kind: "sanity_check",
    passed: false,
    target: 60,
  };
  const card = presentSanityCard({
    check_roll_id: "san-blast",
    check,
    san_before: 60,
    san_after: 59,
    san_loss: 1,
    san_loss_expression: "1",
  });
  assert.equal(card.before, 60);
  assert.equal(card.after, 59);
  assert.equal(card.amount, 1);
  assert.equal(card.lossExpression, "1");
});

test("SAN success card keeps zero loss and unchanged SAN", () => {
  const check = {
    roll_id: "san-pass",
    roll: 12,
    kind: "sanity_check",
    passed: true,
    target: 50,
    san_before: 50,
    san_after: 50,
    san_loss: 0,
    san_loss_expression: "0",
  };
  const card = presentSanityCard({
    check_roll_id: "san-pass",
    check,
    san_before: 50,
    san_after: 50,
    san_loss: 0,
    san_loss_expression: "0",
  });
  assert.equal(card.before, 50);
  assert.equal(card.after, 50);
  assert.equal(card.amount, 0);
  assert.equal(card.lossExpression, "0");
});

test("SAN specialized view still shows non-SAN effects when there is no remaining roll", () => {
  const view = selectRollGroupView({
    type: "roll_group",
    text: "理智",
    source_ids: ["san"],
    layout: "sanity",
    rolls: [sanCheck],
    sanity: {
      check_roll_id: "san",
      check: sanCheck,
      san_before: 30,
      san_after: 26,
    },
    effects: [
      { category: "state_delta", effect_kind: "scalar", resource: "SAN", before: 30, after: 26, delta: -4 },
      { category: "exceptional_effect", player_visible_impact: "耳鸣不止" },
    ],
  });
  const presented = presentRollGroup(view);
  assert.equal(presented.kind, "sanity");
  assert.deepEqual(presented.effectLines, ["耳鸣不止"]);
  assert.equal(view.remaining.length, 0);
});

test("combat opposed view presents leftover effects on the specialized card", () => {
  const view = selectRollGroupView({
    type: "roll_group",
    text: "近战",
    source_ids: ["atk", "dodge"],
    layout: "combat",
    rolls: [attack, defense],
    combat: {
      defense_kind: "dodge",
      opposed_outcome: "attacker_higher",
      attack,
      defense,
    },
    effects: [
      { category: "exceptional_effect", player_visible_impact: "对方失去平衡" },
    ],
  });
  assert.deepEqual(presentRollGroupEffects(view), ["对方失去平衡"]);
});

test("ordinary opposed view presents effects even without remaining rolls", () => {
  const view = selectRollGroupView({
    type: "roll_group",
    text: "对抗",
    source_ids: ["atk", "dodge"],
    layout: "opposed",
    rolls: [attack, defense],
    opposed: { left: attack, right: defense, winner: "investigator" },
    effects: [
      { category: "state_delta", effect_kind: "condition", condition: "shaken", action: "added" },
    ],
  });
  const presented = presentRollGroup(view);
  assert.equal(presented.hasSpecializedCard, true);
  assert.deepEqual(presented.effectLines, ["状态：新增「shaken」"]);
  assert.equal(view.remaining.length, 0);
});

test("combat presenter counts shots and volleys from the layout payload", () => {
  const shotA = { roll_id: "s1", roll: 20, passed: true };
  const shotB = { roll_id: "s2", roll: 44, passed: true };
  const view = selectRollGroupView({
    type: "roll_group",
    text: "连发",
    source_ids: ["s1", "s2"],
    layout: "combat",
    rolls: [shotA, shotB],
    combat: {
      shots: [
        { shot: 1, attack_roll_id: "s1", attack: shotA },
        { shot: 2, attack_roll_id: "s2", attack: shotB },
      ],
    },
  });
  const presented = presentRollGroup(view);
  assert.equal(presented.kind, "combat");
  assert.equal(presented.shotCount, 2);
  assert.equal(view.remaining.length, 0);
});
