import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  campaignListExtras,
  combatInitiativeDisplay,
  modelsPayload,
  resolveThinkingMeta,
  supportedThinkingLevels,
  discoveredCluesDisplay,
  enrichTranscriptFromEvents,
  formatPlayerTime,
  sceneDisplayLabel,
  tableTranscriptMessages,
  localizeTerms,
  resolvedLocalizedTerms,
  tensionDisplayLabel,
  zhDigits,
  zhHourPhrase,
  zhSmallNumber,
} from "../projections.mjs";

test("zhDigits spells years digit-by-digit", () => {
  assert.equal(zhDigits(1920), "一九二〇");
  assert.equal(zhDigits(2026), "二〇二六");
});

test("zhSmallNumber uses common number words", () => {
  assert.equal(zhSmallNumber(1), "一");
  assert.equal(zhSmallNumber(9), "九");
  assert.equal(zhSmallNumber(10), "十");
  assert.equal(zhSmallNumber(12), "十二");
  assert.equal(zhSmallNumber(20), "二十");
  assert.equal(zhSmallNumber(31), "三十一");
});

test("zhHourPhrase picks phase and clock", () => {
  assert.deepEqual(zhHourPhrase(10, 0), ["上午", "十时整"]);
  assert.deepEqual(zhHourPhrase(15, 30), ["下午", "三时三十分"]);
  assert.deepEqual(zhHourPhrase(19, 5), ["傍晚", "七时五分"]);
  assert.deepEqual(zhHourPhrase(0, 0), ["夜间", "十二时整"]);
});

test("formatPlayerTime renders zh two-line display", () => {
  const payload = formatPlayerTime(
    { local_datetime: "1920-10-12T10:00:00", elapsed_minutes: 0, location_id: "loc" },
    { playLanguage: "zh-Hans", safePlace: null },
  );
  assert.equal(payload.display, "一九二〇年十月十二日");
  assert.equal(payload.display_sub, "上午 · 十时整");
  assert.equal(payload.phase, "morning");
  assert.equal(payload.phase_label, "上午");
});

test("formatPlayerTime falls back to raw display without local datetime", () => {
  const payload = formatPlayerTime(
    { display: "1920-10-12T10:00" },
    { playLanguage: "zh-Hans" },
  );
  assert.equal(payload.display, "1920-10-12 · 10:00");
  assert.equal(payload.display_sub, null);
});

test("formatPlayerTime keeps machine display for non-zh", () => {
  const payload = formatPlayerTime(
    { local_datetime: "1920-10-12T10:00:00" },
    { playLanguage: "en" },
  );
  assert.equal(payload.display, "—");
  assert.equal(payload.display_sub, null);
});

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coc-web-node-test-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

test("sceneDisplayLabel prefers localized names", () => {
  const ws = makeWorkspace();
  writeJson(path.join(ws, ".coc/campaigns/c1/scenario/story-graph.json"), {
    scenes: [
      {
        scene_id: "s1",
        display_name: "Foyer",
        destination_identity: {
          canonical_name: "The Foyer",
          localized_names: { "zh-Hans": "门厅" },
        },
      },
    ],
  });
  assert.equal(sceneDisplayLabel(ws, "c1", "s1", "zh-Hans"), "门厅");
  assert.equal(sceneDisplayLabel(ws, "c1", "missing", "zh-Hans"), null);
});

test("tensionDisplayLabel maps closed enums", () => {
  assert.equal(tensionDisplayLabel("high", "zh-Hans"), "紧绷");
  assert.equal(tensionDisplayLabel("climax", "zh-Hans"), "高潮");
  assert.equal(tensionDisplayLabel("weird", "zh-Hans"), "weird");
  assert.equal(tensionDisplayLabel(null, "zh-Hans"), null);
});

test("discoveredCluesDisplay projects player-safe summaries only", () => {
  const ws = makeWorkspace();
  writeJson(path.join(ws, ".coc/campaigns/c1/scenario/clue-graph.json"), {
    clues: [
      {
        clue_id: "clue-a",
        visibility: "player-safe",
        localized_text: { "zh-Hans": { player_safe_summary: "一封烧焦的信" } },
      },
      {
        clue_id: "clue-secret",
        visibility: "keeper-only",
        player_safe_summary: "不应出现",
      },
    ],
  });
  const out = discoveredCluesDisplay(ws, "c1", ["clue-a", "clue-secret", "clue-a"], "zh-Hans");
  assert.deepEqual(out, [
    { clue_id: "clue-a", summary: "一封烧焦的信" },
    { clue_id: "clue-secret", summary: "clue-secret" },
  ]);
});

test("combatInitiativeDisplay projects canonical DEX order and ready-firearm bonus", () => {
  const ws = makeWorkspace();
  writeJson(path.join(ws, ".coc/campaigns/c1/save/combat.json"), {
    combat_id: "cbt-1",
    status: "active",
    outcome: null,
    current_round: 3,
    initiative_cursor: 0,
    current_initiative: [
      { actor_id: "enemy", dex: 40, dex_reason: "ready_firearm" },
      { actor_id: "hero", dex: 65, dex_reason: null },
    ],
    initiative_progress: [
      { actor_id: "hero", initiative: { actor_id: "hero", dex: 65, dex_reason: null }, status: "pending" },
      { actor_id: "enemy", initiative: { actor_id: "enemy", dex: 40, dex_reason: "ready_firearm" }, status: "pending" },
      { actor_id: "fallen", initiative: null, round_start_eligibility: { dex: 80 }, status: "excluded_at_round_start" },
    ],
  });
  writeJson(path.join(ws, ".coc/campaigns/c1/save/npc-first-impressions.json"), {
    receipts: [{ npc_id: "npc-enemy", npc_display_name: "持枪教徒" }],
  });
  writeJson(path.join(ws, ".coc/campaigns/c1/investigators/hero/character.json"), {
    name: "林若海",
  });
  const out = combatInitiativeDisplay(ws, "c1", {
    investigatorId: "hero",
    investigatorName: "林若海",
  });
  assert.equal(out.round, 3);
  assert.equal(out.combat_id, "cbt-1");
  assert.equal(out.status, "active");
  assert.equal(out.outcome, null);
  assert.deepEqual(out.rows.map((row) => [row.display_name, row.initiative_value, row.current]), [
    ["持枪教徒", 90, true],
    ["林若海", 65, false],
    ["敌方角色", 80, false],
  ]);
  assert.equal(out.rows[0].ready_firearm, true);
  assert.equal(out.rows[2].status, "excluded_at_round_start");
});

test("combatInitiativeDisplay surfaces concluded status and outcome (session file persists)", () => {
  const ws = makeWorkspace();
  writeJson(path.join(ws, ".coc/campaigns/c1/save/combat.json"), {
    combat_id: "cbt-2",
    status: "concluded",
    outcome: "investigators_win",
    current_round: 4,
    initiative_cursor: 1,
    current_initiative: [{ actor_id: "hero", dex: 65, dex_reason: null }],
    initiative_progress: [
      { actor_id: "hero", initiative: { actor_id: "hero", dex: 65, dex_reason: null }, status: "acted" },
    ],
  });
  const out = combatInitiativeDisplay(ws, "c1", { investigatorId: "hero", investigatorName: "林若海" });
  assert.equal(out.combat_id, "cbt-2");
  assert.equal(out.status, "concluded");
  assert.equal(out.outcome, "investigators_win");
  assert.equal(out.round, 4);
});

test("tableTranscriptMessages pairs turns with telemetry durations", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    [
      JSON.stringify({ role: "player", text: "我开门", turn: 1, ts: "2026-01-01T10:00:00Z" }),
      JSON.stringify({ role: "keeper", text: "门后漆黑一片", turn: 1, ts: "2026-01-01T10:01:00Z" }),
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(logsDir, "runtime-telemetry.jsonl"),
    JSON.stringify({ telemetry: { total_ms: 60000 } }) + "\n",
  );
  const out = tableTranscriptMessages(ws, "c1");
  assert.equal(out.length, 2);
  const keeper = out.find((m) => m.role === "keeper");
  assert.equal(keeper.duration_ms, 60000);
  assert.equal(keeper.at, Date.parse("2026-01-01T10:01:00Z"));
  assert.equal(keeper.started_at, Date.parse("2026-01-01T10:01:00Z") - 60000);
});

test("tableTranscriptMessages exposes authoritative finalization roll segments", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const proseBefore = "你仔细查看门锁。";
  const receipt = "【明骰】侦查｜掷骰：47；基础值：65；达到：成功；通过";
  const proseAfter = "锁孔里卡着一小片红线。";
  const rendered = [proseBefore, receipt, proseAfter].join("\n\n");
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    [
      JSON.stringify({ role: "player", text: "我检查门锁", turn: 1 }),
      JSON.stringify({
        role: "keeper",
        text: rendered,
        turn: 1,
        finalization_id: "fin-1",
      }),
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(logsDir, "turn-finalizations.jsonl"),
    JSON.stringify({
      finalization_id: "fin-1",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: proseBefore },
        { segment_type: "public_check", source_ids: ["roll-1"], text: receipt },
        { segment_type: "fiction", source_ids: [], text: proseAfter },
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
    }) + "\n",
  );

  const out = tableTranscriptMessages(ws, "c1");
  const keeper = out.find((message) => message.role === "keeper");
  assert.equal(keeper.text, rendered);
  assert.deepEqual(keeper.content_blocks, [
    { type: "prose", text: proseBefore },
    {
      type: "roll_group",
      text: receipt,
      source_ids: ["roll-1"],
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
    { type: "prose", text: proseAfter },
  ]);
});

test("tableTranscriptMessages keeps every public roll in a finalization group", () => {
  const ws = makeWorkspace();
  const campaignPath = path.join(ws, ".coc/campaigns/c1");
  const logsDir = path.join(campaignPath, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const receipt = [
    "【明骰】理智｜掷骰：70；基础值：30；达到：失败；未通过",
    "【明骰】理智损失（1D6）：骰面 4 → 总值 4",
    "【明骰】射击｜掷骰：34；基础值：65；达到：成功；通过",
  ].join("\n");
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    JSON.stringify({ role: "keeper", text: receipt, turn: 1, finalization_id: "fin-multi" }) + "\n",
  );
  fs.writeFileSync(
    path.join(logsDir, "turn-finalizations.jsonl"),
    JSON.stringify({
      finalization_id: "fin-multi",
      rendered_text: receipt,
      segments: [{ segment_type: "public_check", source_ids: ["san", "loss", "shot"], text: receipt }],
      bundle: {
        public_check: [
          { roll_id: "san", visibility: "consequence_public", kind: "sanity_check", display_skill: "理智", roll: 70, target: 30, outcome: "failure", passed: false, san_before: 30, san_after: 26, san_delta: -4 },
          { roll_id: "loss", visibility: "consequence_public", kind: "san_loss", roll: 4, die_expression: "1D6", rolls: [4], san_before: 30, san_after: 26 },
          { roll_id: "shot", visibility: "public", kind: "skill_check", display_skill: "射击", roll: 34, target: 65, outcome: "regular", passed: true },
        ],
      },
    }) + "\n",
  );

  const keeper = tableTranscriptMessages(ws, "c1")[0];
  assert.equal(keeper.content_blocks[0].type, "roll_group");
  assert.deepEqual(keeper.content_blocks[0].source_ids, ["san", "loss", "shot"]);
  assert.deepEqual(keeper.content_blocks[0].rolls.map((roll) => roll.roll_id), ["san", "loss", "shot"]);
  assert.deepEqual(keeper.content_blocks[0].rolls[0], {
    roll_id: "san", roll: 70, display_skill: "理智", kind: "sanity_check",
    outcome: "failure", target: 30, san_before: 30, san_after: 26, san_delta: -4,
    passed: false,
  });
});

test("tableTranscriptMessages enriches combat rolls from canonical combat state", () => {
  const ws = makeWorkspace();
  const campaignPath = path.join(ws, ".coc/campaigns/c1");
  const logsDir = path.join(campaignPath, "logs");
  const saveDir = path.join(campaignPath, "save");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(saveDir, { recursive: true });
  const receipt = "公开战斗结算";
  fs.writeFileSync(path.join(logsDir, "table-transcript.jsonl"), JSON.stringify({
    role: "keeper", text: receipt, turn: 1, finalization_id: "fin-combat",
  }) + "\n");
  fs.writeFileSync(path.join(logsDir, "turn-finalizations.jsonl"), JSON.stringify({
    finalization_id: "fin-combat",
    rendered_text: receipt,
    segments: [{ segment_type: "public_check", source_ids: ["attack", "dodge", "damage"], text: receipt }],
    bundle: { public_check: [
      {
        roll_id: "attack", visibility: "public", roll: 24, target: 60,
        achieved_level: "hard", passed: true, bonus: 1,
        tens_values: [8, 2], units: 4, unmodified_roll: 84,
      },
      {
        roll_id: "dodge", visibility: "public", roll: 35, target: 50,
        achieved_level: "regular", passed: true,
      },
      {
        roll_id: "damage", visibility: "consequence_public", rolled_total: 6,
        dice: { expression: "1D6", raw: [6], total: 6 },
      },
    ] },
  }) + "\n");
  fs.writeFileSync(path.join(saveDir, "combat.json"), JSON.stringify({
    rounds: [{ turns: [{
      action: "attack", roll_id: "attack", opposed_roll_id: "dodge",
      defense_kind: "dodge", opposed_outcome: "attacker_higher", outcome: "hit",
      damage_roll_id: "damage",
      attack_modifiers: { point_blank: true, bonus: 1, cover: false },
    }] }],
    damage_chain: [{
      damage_roll_id: "damage", die: "1D6", raw_damage: 6, armor_absorbed: 2,
      hp_before: 10, hp_delta: -4, hp_after: 6, armor_before: 2, armor_after: 0,
    }],
  }));

  const rolls = tableTranscriptMessages(ws, "c1")[0].content_blocks[0].rolls;
  assert.deepEqual(rolls.map((roll) => roll.combat_role), ["attack", "defense", "damage"]);
  assert.equal(rolls[0].defense_kind, "dodge");
  assert.deepEqual(
    {
      roll: rolls[0].roll, tens_values: rolls[0].tens_values,
      units: rolls[0].units, unmodified_roll: rolls[0].unmodified_roll,
    },
    { roll: 24, tens_values: [8, 2], units: 4, unmodified_roll: 84 },
  );
  assert.deepEqual(rolls[0].attack_modifiers, { point_blank: true, cover: false, bonus: 1 });
  assert.deepEqual(
    { raw_damage: rolls[2].raw_damage, armor_absorbed: rolls[2].armor_absorbed, hp_after: rolls[2].hp_after },
    { raw_damage: 6, armor_absorbed: 2, hp_after: 6 },
  );
  assert.deepEqual(
    { roll: rolls[2].roll, die: rolls[2].die, die_rolls: rolls[2].die_rolls },
    { roll: 6, die: "1D6", die_rolls: [6] },
  );
});

test("tableTranscriptMessages exposes opening presented rolls without marker leakage", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const receipt = "【明骰】初印象·拉金｜掷骰：41；基础值：65；达到：成功；通过";
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    JSON.stringify({
      role: "keeper",
      text: `烛火晃了一下。\n\n[roll]\n${receipt}\n[/roll]\n[/in_game]`,
      turn: 0,
      finalization_id: null,
      presented_roll_ids: ["opening-roll-1"],
    }) + "\n",
  );
  fs.writeFileSync(
    path.join(logsDir, "rolls.jsonl"),
    JSON.stringify({
      roll_id: "opening-roll-1",
      visibility: "public",
      display_skill: "初印象",
      npc_display_name: "拉金",
      kind: "npc_first_impression",
      roll: 41,
      target: 65,
      app: 65,
      credit_rating: 30,
      governing_attribute: "app",
      governing_value: 65,
      difficulty: "regular",
      achieved_level: "regular",
      passed: true,
    }) + "\n",
  );

  const keeper = tableTranscriptMessages(ws, "c1")[0];
  assert.deepEqual(keeper.content_blocks, [
    { type: "prose", text: "烛火晃了一下。" },
    {
      type: "roll",
      text: receipt,
      source_ids: ["opening-roll-1"],
      roll: {
        roll_id: "opening-roll-1",
        roll: 41,
        display_skill: "初印象",
        npc_display_name: "拉金",
        kind: "npc_first_impression",
        difficulty: "regular",
        achieved_level: "regular",
        target: 65,
        app: 65,
        credit_rating: 30,
        governing_value: 65,
        governing_attribute: "app",
        passed: true,
      },
    },
  ]);
});

test("enrichTranscriptFromEvents backdates by telemetry totals", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, "events.jsonl"),
    JSON.stringify({ event_type: "turn", ts: "2026-01-01T10:01:00Z" }) + "\n",
  );
  fs.writeFileSync(
    path.join(logsDir, "runtime-telemetry.jsonl"),
    JSON.stringify({ telemetry: { total_ms: 30000 } }) + "\n",
  );
  const out = enrichTranscriptFromEvents(ws, "c1", [
    { role: "player", text: "hi" },
    { role: "keeper", text: "hello" },
  ]);
  const endMs = Date.parse("2026-01-01T10:01:00Z");
  assert.equal(out[0].started_at, endMs - 30000);
  assert.equal(out[1].duration_ms, 30000);
  assert.equal(out[1].at, endMs);
});

// ---------------------------------------------------------------------------
// Thinking levels (models payload)

test("supportedThinkingLevels mirrors the pi rule", () => {
  assert.deepEqual(supportedThinkingLevels({ reasoning: false }), ["off"]);
  assert.deepEqual(supportedThinkingLevels({ reasoning: true }), [
    "off", "minimal", "low", "medium", "high",
  ]);
  assert.deepEqual(
    supportedThinkingLevels({
      reasoning: true,
      thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
    }),
    ["off", "low", "high", "max"],
  );
});

test("modelsPayload resolves thinkingLevels with catalog fallback", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-models-"));
  process.env.PI_AGENT_DIR = agentDir;
  try {
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          // Old save: entry carries no thinking metadata; pi's built-in
          // deepseek catalog fills reasoning + thinkingLevelMap.
          deepseek: {
            name: "DeepSeek",
            models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
          },
          // Custom provider: no catalog file; only entry metadata counts.
          mygateway: {
            name: "My Gateway",
            models: [
              { id: "model-a", name: "A", reasoning: true },
              { id: "model-b", name: "B" },
            ],
          },
        },
      }),
    );
    const payload = modelsPayload();
    const byId = (provider) => Object.fromEntries(
      payload.providers[provider].models.map((m) => [m.id, m.thinkingLevels]),
    );
    assert.deepEqual(byId("deepseek")["deepseek-v4-flash"], ["off", "low", "high", "max"]);
    assert.deepEqual(byId("mygateway")["model-a"], ["off", "minimal", "low", "medium", "high"]);
    assert.deepEqual(byId("mygateway")["model-b"], ["off"]);
  } finally {
    delete process.env.PI_AGENT_DIR;
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("modelsPayload resolves the second xai model with exact Grok 4.6 levels", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-xai-models-"));
  process.env.PI_AGENT_DIR = agentDir;
  try {
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          xai: {
            name: "xAI",
            models: [
              { id: "grok-4.3", name: "Grok 4.3" },
              { id: "grok-4.6", name: "Grok 4.6" },
            ],
          },
        },
      }),
    );
    const payload = modelsPayload();
    const grok46 = payload.providers.xai.models.find((entry) => entry.id === "grok-4.6");
    assert.deepEqual(grok46.thinkingLevels, ["off", "minimal", "low", "medium", "high"]);
  } finally {
    delete process.env.PI_AGENT_DIR;
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("supportedThinkingLevels matches pi-ai's own resolver on catalog models", async () => {
  const { getSupportedThinkingLevels } = await import(
    "../../../runtime/adapters/keeper/node_modules/@earendil-works/pi-ai/dist/models.js"
  );
  const cases = [
    ["deepseek", "deepseek-v4-flash"],
    ["deepseek", "deepseek-v4-pro"],
    ["xai", "grok-4.6"],
    ["xai", "grok-4.5"],
    ["zai", "glm-5.2"],
  ];
  for (const [providerId, modelId] of cases) {
    const meta = resolveThinkingMeta(providerId, { id: modelId });
    const ours = supportedThinkingLevels(meta);
    const theirs = getSupportedThinkingLevels({
      reasoning: meta.reasoning,
      thinkingLevelMap: meta.thinkingLevelMap,
    });
    assert.deepEqual(ours, theirs, `${providerId}/${modelId}`);
  }
});

test("public roll display remaps frozen English NPC names", () => {
  const ws = makeWorkspace();
  writeJson(path.join(ws, ".coc/campaigns/c1/campaign.json"), {
    play_language: "zh-Hans",
    localized_terms: { "zh-Hans": {} },
  });
  const terms = resolvedLocalizedTerms(ws, "c1", "zh-Hans");
  assert.equal(localizeTerms("Steven Knott", terms), "史蒂文·诺特");
  assert.equal(localizeTerms("Knott nodded. Knotting stayed." , terms), "诺特 nodded. Knotting stayed.");
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const receipt = "【明骰】初印象·Steven Knott｜掷骰：41；基础值：65；达到：成功；通过";
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    JSON.stringify({
      role: "keeper",
      text: `门开了。\n\n[roll]\n${receipt}\n[/roll]`,
      turn: 0,
      finalization_id: null,
      presented_roll_ids: ["opening-en-1"],
    }) + "\n",
  );
  fs.writeFileSync(
    path.join(logsDir, "rolls.jsonl"),
    JSON.stringify({
      roll_id: "opening-en-1",
      visibility: "public",
      display_skill: "初印象",
      npc_display_name: "Steven Knott",
      kind: "npc_first_impression",
      roll: 41,
      target: 65,
    }) + "\n",
  );
  const keeper = tableTranscriptMessages(ws, "c1")[0];
  assert.equal(keeper.content_blocks[1].roll.npc_display_name, "史蒂文·诺特");
});

test("campaignListExtras reads first party investigator and mtime", () => {
  const ws = makeWorkspace();
  writeJson(path.join(ws, ".coc/campaigns/c1/campaign.json"), { title: "The Haunting" });
  writeJson(path.join(ws, ".coc/campaigns/c1/party.json"), { investigator_ids: ["ada"] });
  writeJson(path.join(ws, ".coc/investigators/ada/character.json"), { name: "艾达" });
  const extras = campaignListExtras(ws, "c1");
  assert.equal(extras.investigator_name, "艾达");
  assert.equal(typeof extras.last_active_at, "string");
  assert.match(extras.last_active_at, /T/);
});
