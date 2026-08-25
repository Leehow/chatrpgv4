import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  campaignListExtras,
  campaignStatusOf,
  characterSetupPendingFromOpeningPhase,
  investigatorIdFromParty,
  combatInitiativeDisplay,
  modelsPayload,
  resolveModelsDefault,
  resolveThinkingMeta,
  supportedThinkingLevels,
  discoveredCluesDisplay,
  enrichTranscriptFromEvents,
  formatPlayerTime,
  sceneDisplayLabel,
  resolvePlaySceneId,
  tableTranscriptMessages,
  localizeTerms,
  listSourceBundles,
  findBundleByPdfSha256,
  resolvedLocalizedTerms,
  tensionDisplayLabel,
  zhDigits,
  zhHourPhrase,
  zhSmallNumber,
  attachPortraitToDisplayCharacter,
  playerFacingPortraitProjection,
  portraitImageUrl,
  resolveInvestigatorPortraitFile,
} from "../projections.mjs";

test("listSourceBundles reports the PDF page count rather than rendered-page count", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "coc-source-bundle-"));
  const bundleDir = path.join(ws, ".coc", "source-bundles", "bundle-1");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify({
    source: {
      path: "/tmp/模组.pdf",
      page_count: 20,
      file_sha256: "a".repeat(64),
    },
    pages: Array.from({ length: 19 }, (_, pdf_index) => ({ pdf_index })),
  }));
  try {
    const [bundle] = listSourceBundles(ws);
    assert.equal(bundle.page_count, 20);
    assert.equal(bundle.title, "模组.pdf");
    assert.equal(bundle.source_id, null);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

function writeShaBundle(workspace, bundleId, { sha, sourceId, title }) {
  const dir = path.join(workspace, ".coc", "source-bundles", bundleId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    title,
    source: {
      path: `/tmp/${bundleId}.pdf`,
      page_count: 8,
      file_sha256: sha,
      source_id: sourceId,
    },
    pages: [{ pdf_index: 0 }],
  }));
  return dir;
}

test("findBundleByPdfSha256 prefers the stable bundle when a hash-prefixed duplicate sorts first", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "coc-dup-sha-bundle-"));
  const sha = "c".repeat(64);
  const hashPrefixed = "aaaaaaaaaaaaaaaa-stable-module";
  try {
    writeShaBundle(ws, hashPrefixed, {
      sha,
      sourceId: `pdf:${hashPrefixed}`,
      title: "temp",
    });
    writeShaBundle(ws, "stable-module", {
      sha,
      sourceId: "pdf:stable-module",
      title: "stable",
    });
    const listed = listSourceBundles(ws).map((bundle) => bundle.bundle_id);
    assert.deepEqual(listed, [hashPrefixed, "stable-module"]);
    const matched = findBundleByPdfSha256(ws, sha);
    assert.equal(matched.bundle_id, "stable-module");
    assert.equal(matched.source_id, "pdf:stable-module");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("findBundleByPdfSha256 prefers the module-assets registered source_id over directory order", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "coc-dup-sha-registry-"));
  const sha = "d".repeat(64);
  const hashPrefixed = "bbbbbbbbbbbbbbbb-other-module";
  try {
    writeShaBundle(ws, hashPrefixed, {
      sha,
      sourceId: `pdf:${hashPrefixed}`,
      title: "temp",
    });
    writeShaBundle(ws, "other-module", {
      sha,
      sourceId: "pdf:other-module",
      title: "stable",
    });
    const assets = path.join(ws, ".coc", "module-assets", "other-module-20260101T000000");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(ws, ".coc", "module-assets", "registry.json"), JSON.stringify({
      by_file_sha256: { [sha]: "other-module-20260101T000000" },
    }));
    fs.writeFileSync(path.join(assets, "identity.json"), JSON.stringify({
      file_sha256: sha,
      source: { source_id: "pdf:other-module" },
    }));
    const matched = findBundleByPdfSha256(ws, sha);
    assert.equal(matched.bundle_id, "other-module");
    assert.equal(matched.source_id, "pdf:other-module");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("findBundleByPdfSha256 stays fail-closed when two first-window identities share a SHA", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "coc-dup-sha-ambiguous-"));
  const sha = "e".repeat(64);
  try {
    writeShaBundle(ws, "alpha-module", {
      sha,
      sourceId: "pdf:alpha-module",
      title: "alpha",
    });
    writeShaBundle(ws, "beta-module", {
      sha,
      sourceId: "pdf:beta-module",
      title: "beta",
    });
    assert.equal(findBundleByPdfSha256(ws, sha), null);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("findBundleByPdfSha256 prefers registry identity even when it is the hash-prefixed bundle", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "coc-dup-sha-registry-hash-"));
  const sha = "f".repeat(64);
  const hashPrefixed = "aaaaaaaaaaaaaaaa-stable-module";
  try {
    writeShaBundle(ws, hashPrefixed, {
      sha,
      sourceId: `pdf:${hashPrefixed}`,
      title: "temp",
    });
    writeShaBundle(ws, "stable-module", {
      sha,
      sourceId: "pdf:stable-module",
      title: "stable",
    });
    const assets = path.join(ws, ".coc", "module-assets", "root-hash-20260101T000000");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(ws, ".coc", "module-assets", "registry.json"), JSON.stringify({
      by_file_sha256: { [sha]: "root-hash-20260101T000000" },
    }));
    fs.writeFileSync(path.join(assets, "identity.json"), JSON.stringify({
      file_sha256: sha,
      source: { source_id: `pdf:${hashPrefixed}` },
    }));
    const matched = findBundleByPdfSha256(ws, sha);
    assert.equal(matched.bundle_id, hashPrefixed);
    assert.equal(matched.source_id, `pdf:${hashPrefixed}`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("findBundleByPdfSha256 ignores registry identity when identity.file_sha256 mismatches", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "coc-dup-sha-registry-mismatch-"));
  const sha = "1".repeat(64);
  const otherSha = "2".repeat(64);
  const hashPrefixed = "aaaaaaaaaaaaaaaa-stable-module";
  try {
    writeShaBundle(ws, hashPrefixed, {
      sha,
      sourceId: `pdf:${hashPrefixed}`,
      title: "temp",
    });
    writeShaBundle(ws, "stable-module", {
      sha,
      sourceId: "pdf:stable-module",
      title: "stable",
    });
    const assets = path.join(ws, ".coc", "module-assets", "stale-root-20260101T000000");
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(ws, ".coc", "module-assets", "registry.json"), JSON.stringify({
      by_file_sha256: { [sha]: "stale-root-20260101T000000" },
    }));
    fs.writeFileSync(path.join(assets, "identity.json"), JSON.stringify({
      file_sha256: otherSha,
      source: { source_id: `pdf:${hashPrefixed}` },
    }));
    const matched = findBundleByPdfSha256(ws, sha);
    assert.equal(matched.bundle_id, "stable-module");
    assert.equal(matched.source_id, "pdf:stable-module");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("findBundleByPdfSha256 may pick any first-window candidate that shares one source_id", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "coc-dup-sha-shared-id-"));
  const sha = "3".repeat(64);
  const hashPrefixed = "aaaaaaaaaaaaaaaa-other-id";
  try {
    writeShaBundle(ws, hashPrefixed, {
      sha,
      sourceId: "pdf:other-id",
      title: "temp",
    });
    writeShaBundle(ws, "mmm-copy", {
      sha,
      sourceId: "pdf:stable-module",
      title: "copy",
    });
    writeShaBundle(ws, "stable-module", {
      sha,
      sourceId: "pdf:stable-module",
      title: "stable",
    });
    const listed = listSourceBundles(ws).map((bundle) => bundle.bundle_id);
    assert.deepEqual(listed, [hashPrefixed, "mmm-copy", "stable-module"]);
    const matched = findBundleByPdfSha256(ws, sha);
    assert.equal(matched.source_id, "pdf:stable-module");
    assert.ok(["mmm-copy", "stable-module"].includes(matched.bundle_id));
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("character_setup_pending prefers opening_phase and survives a missing projection", () => {
  // Confirmed investigator: setup is done regardless of phase spelling.
  assert.equal(
    characterSetupPendingFromOpeningPhase({
      phase: "active",
      session_role: "play",
      character_setup_confirmed: true,
    }),
    false,
  );
  assert.equal(
    characterSetupPendingFromOpeningPhase({
      phase: "ready_for_table",
      session_role: "play",
      character_setup_confirmed: true,
    }),
    false,
  );
  // Placeholder-investigator drift case: investigator files exist on disk but
  // the phase authority says character creation is unconfirmed — still pending.
  assert.equal(
    characterSetupPendingFromOpeningPhase({
      phase: "character_creation",
      session_role: "setup",
      character_setup_confirmed: false,
    }),
    true,
  );
  // A live play projection with a resolved character remains playable even
  // when the optional opening-phase enrichment failed to load.
  assert.equal(
    characterSetupPendingFromOpeningPhase(null, {
      sessionRole: "play",
      hasCharacter: true,
    }),
    false,
  );
  // Missing projection otherwise fails closed: never render a placeholder.
  assert.equal(characterSetupPendingFromOpeningPhase(null), true);
  assert.equal(
    characterSetupPendingFromOpeningPhase(null, {
      sessionRole: "setup",
      hasCharacter: true,
    }),
    true,
  );
  assert.equal(characterSetupPendingFromOpeningPhase(undefined), true);
  assert.equal(characterSetupPendingFromOpeningPhase("active"), true);
});

test("null opening phase falls back to canonical play signals, not chargen", () => {
  // Reported live bug: campaign already ready_for_table / session_role=play
  // with a resolved display character, but the sidecar opening-phase
  // enrichment came back null — pending must not resurrect chargen UI.
  assert.equal(
    characterSetupPendingFromOpeningPhase(null, {
      sessionRole: "play",
      campaignStatus: "ready_for_table",
      hasCharacter: true,
    }),
    false,
  );
  // Server restart: the in-memory orchestrator role row is gone; the on-disk
  // canonical campaign status plus a real character still means playable.
  assert.equal(
    characterSetupPendingFromOpeningPhase(null, {
      sessionRole: null,
      campaignStatus: "ready_for_table",
      hasCharacter: true,
    }),
    false,
  );
  assert.equal(
    characterSetupPendingFromOpeningPhase(null, {
      sessionRole: null,
      campaignStatus: "active",
      hasCharacter: true,
    }),
    false,
  );
  // No canonical play signal: fail closed (true setup stays pending)…
  assert.equal(
    characterSetupPendingFromOpeningPhase(null, {
      sessionRole: "setup",
      campaignStatus: "character_creation",
      hasCharacter: true,
    }),
    true,
  );
  assert.equal(
    characterSetupPendingFromOpeningPhase(null, {
      sessionRole: null,
      campaignStatus: null,
      hasCharacter: true,
    }),
    true,
  );
  // …and play signals never rescue a missing character (no real sheet).
  assert.equal(
    characterSetupPendingFromOpeningPhase(null, {
      sessionRole: "play",
      campaignStatus: "ready_for_table",
      hasCharacter: false,
    }),
    true,
  );
});

test("campaignStatusOf reads the canonical campaign.json status", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "coc-campaign-status-"));
  try {
    const dir = path.join(ws, ".coc", "campaigns", "camp-1");
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(campaignStatusOf(ws, "camp-1"), null);
    fs.writeFileSync(
      path.join(dir, "campaign.json"),
      JSON.stringify({ status: "ready_for_table" }),
    );
    assert.equal(campaignStatusOf(ws, "camp-1"), "ready_for_table");
    fs.writeFileSync(path.join(dir, "campaign.json"), JSON.stringify({}));
    assert.equal(campaignStatusOf(ws, "camp-1"), null);
    fs.writeFileSync(path.join(dir, "campaign.json"), "{not json");
    assert.equal(campaignStatusOf(ws, "camp-1"), null);
    assert.equal(campaignStatusOf(ws, "missing-campaign"), null);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("investigatorIdFromParty prefers active party ids over leftover drafts", () => {
  assert.equal(
    investigatorIdFromParty({
      investigator_ids: ["inv-pending-d30eedee", "inv-x18759ce5-d30eedee"],
      active_investigator_ids: ["inv-x18759ce5-d30eedee"],
    }),
    "inv-x18759ce5-d30eedee",
  );
  assert.equal(
    investigatorIdFromParty({
      investigator_ids: ["inv-pending-d30eedee"],
      active_investigator_ids: [],
    }),
    "inv-pending-d30eedee",
  );
  assert.equal(investigatorIdFromParty(null), null);
  assert.equal(
    investigatorIdFromParty({
      active_investigator_ids: ["web-char-setup-draft"],
    }),
    null,
  );
});

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

test("resolvePlaySceneId prefers scene_history over stale world briefing", () => {
  const ws = makeWorkspace();
  writeJson(path.join(ws, ".coc/campaigns/c1/save/world-state.json"), {
    active_scene_id: "mission-briefing",
    visited_scene_ids: ["previous-tenants"],
    scene_history: [{ scene_id: "previous-tenants" }],
  });
  writeJson(path.join(ws, ".coc/campaigns/c1/save/active-scene.json"), {
    scene_id: "previous-tenants",
  });
  writeJson(path.join(ws, ".coc/campaigns/c1/campaign.json"), {
    active_scene_id: "mission-briefing",
  });
  assert.equal(resolvePlaySceneId(ws, "c1"), "previous-tenants");
});

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
  writeJson(path.join(ws, ".coc/campaigns/c1/scenario/story-graph.json"), {
    scenes: [{ scene_id: "s2", display_name: "Creating Investigators" }],
  });
  assert.equal(sceneDisplayLabel(ws, "c1", "s2", "zh-Hans"), null);
  assert.equal(sceneDisplayLabel(ws, "c1", "s2", "en"), "Creating Investigators");
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
  writeJson(path.join(campaignPath, "save/toolbox-ledger.json"), {
    schema_version: 2,
    entries: {
      '["rules.sanity_check","san-dec"]': {
        entry_schema_version: 2,
        tool: "rules.sanity_check",
        decision_id: "san-dec",
        ts: "2026-01-01T00:00:00Z",
        data: { check_roll_id: "san", loss_roll_id: "loss", san_before: 30, san_after: 26, san_loss: 4 },
      },
    },
  });
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
  assert.equal(keeper.content_blocks[0].layout, "sanity");
  assert.deepEqual(keeper.content_blocks[0].source_ids, ["san", "loss", "shot"]);
  assert.deepEqual(keeper.content_blocks[0].rolls.map((roll) => roll.roll_id), ["san", "loss", "shot"]);
  assert.deepEqual(keeper.content_blocks[0].rolls[0], {
    roll_id: "san", roll: 70, display_skill: "理智", kind: "sanity_check",
    outcome: "failure", target: 30, passed: false,
    san_before: 30, san_after: 26, san_delta: -4,
    san_loss: 4, san_loss_expression: "1D6", san_loss_resolution: undefined,
  });
  assert.equal(keeper.content_blocks[0].sanity.check_roll_id, "san");
  assert.equal(keeper.content_blocks[0].sanity.loss_roll_id, "loss");
  assert.equal(keeper.content_blocks[0].sanity.san_before, 30);
  assert.equal(keeper.content_blocks[0].sanity.san_after, 26);
  assert.equal(keeper.content_blocks[0].sanity.san_delta, -4);
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

  const group = tableTranscriptMessages(ws, "c1")[0].content_blocks[0];
  const rolls = group.rolls;
  assert.equal(group.layout, "combat");
  assert.equal(group.combat.defense_kind, "dodge");
  assert.equal(group.combat.attack.roll_id, "attack");
  assert.equal(group.combat.defense.roll_id, "dodge");
  assert.equal(group.combat.damage.damage_roll_id, "damage");
  assert.deepEqual(
    {
      roll: rolls[0].roll, tens_values: rolls[0].tens_values,
      units: rolls[0].units, unmodified_roll: rolls[0].unmodified_roll,
    },
    { roll: 24, tens_values: [8, 2], units: 4, unmodified_roll: 84 },
  );
  assert.deepEqual(group.combat.attack_modifiers, { point_blank: true, cover: false, bonus: 1 });
  assert.deepEqual(
    {
      raw_damage: group.combat.damage.raw_damage,
      armor_absorbed: group.combat.damage.armor_absorbed,
      hp_after: group.combat.damage.hp_after,
    },
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

test("tableTranscriptMessages strips a prose-only opening envelope", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    JSON.stringify({
      role: "keeper",
      text: "[in_game]\n纯叙事开场。\n你要做什么？[/in_game]",
      turn: 0,
      finalization_id: null,
      presented_roll_ids: [],
    }) + "\n",
  );

  const messages = tableTranscriptMessages(ws, "c1");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "纯叙事开场。\n你要做什么？");
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

function piAiCatalogDataDir() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../runtime/adapters/keeper/node_modules/@earendil-works/pi-ai/dist/providers/data",
  );
}

test("modelsPayload resolves thinkingLevels with catalog fallback", (t) => {
  if (!fs.existsSync(path.join(piAiCatalogDataDir(), "deepseek.json"))) {
    t.skip("keeper pi-ai catalog not vendored in this worktree");
    return;
  }
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

test("modelsPayload includes bundled models missing from an older provider save", (t) => {
  if (!fs.existsSync(path.join(piAiCatalogDataDir(), "qwen-token-plan-cn.json"))) {
    t.skip("keeper pi-ai catalog not vendored in this worktree");
    return;
  }
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-qwen-models-"));
  process.env.PI_AGENT_DIR = agentDir;
  try {
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "qwen-token-plan-cn": {
            name: "Qwen Token Plan CN",
            models: [{ id: "qwen3.8-max", name: "qwen3.8-max" }],
          },
        },
      }),
    );
    const payload = modelsPayload();
    const flash = payload.providers["qwen-token-plan-cn"].models.find(
      (entry) => entry.id === "deepseek-v4-flash",
    );
    assert.equal(flash.label, "DeepSeek V4 Flash");
    assert.deepEqual(flash.thinkingLevels, ["off", "high", "max"]);
  } finally {
    delete process.env.PI_AGENT_DIR;
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("modelsPayload resolves the second xai model with exact Grok 4.6 levels", (t) => {
  if (!fs.existsSync(path.join(piAiCatalogDataDir(), "xai.json"))) {
    t.skip("keeper pi-ai catalog not vendored in this worktree");
    return;
  }
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

test("modelsPayload overlays JellyToken DeepSeek V4 Flash thinking levels", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-jt-models-"));
  process.env.PI_AGENT_DIR = agentDir;
  try {
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          jellytoken: {
            name: "JellyToken",
            baseUrl: "https://aiservice.jellytoken.com/v1",
            models: [
              { id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
              { id: "glm-5.2", name: "GLM 5.2" },
            ],
          },
        },
      }),
    );
    const payload = modelsPayload();
    const byId = Object.fromEntries(
      payload.providers.jellytoken.models.map((m) => [m.id, m.thinkingLevels]),
    );
    assert.deepEqual(byId["deepseek-v4-flash"], [
      "off", "low", "medium", "high", "xhigh", "max",
    ]);
    assert.deepEqual(byId["glm-5.2"], [
      "off", "low", "medium", "high", "xhigh", "max",
    ]);
  } finally {
    delete process.env.PI_AGENT_DIR;
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("supportedThinkingLevels matches pi-ai's own resolver on catalog models", async (t) => {
  const catalogModels = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../runtime/adapters/keeper/node_modules/@earendil-works/pi-ai/dist/models.js",
  );
  // Isolated git worktrees do not carry runtime/adapters/keeper/node_modules.
  if (!fs.existsSync(catalogModels)) {
    t.skip("keeper pi-ai catalog not vendored in this worktree");
    return;
  }
  const { getSupportedThinkingLevels } = await import(catalogModels);
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

test("campaignListExtras prefers events.jsonl mtime over campaign.json mtime", () => {
  const ws = makeWorkspace();
  const dir = path.join(ws, ".coc/campaigns/c1");
  const campaignJson = path.join(dir, "campaign.json");
  writeJson(campaignJson, { title: "The Haunting" });
  const logsDir = path.join(dir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const events = path.join(logsDir, "events.jsonl");
  fs.writeFileSync(events, "{}\n");
  const oldTime = new Date("2026-01-01T00:00:00Z");
  const newTime = new Date("2026-06-15T12:34:56Z");
  fs.utimesSync(campaignJson, oldTime, oldTime);
  fs.utimesSync(events, newTime, newTime);
  // Backdate the dir itself so the dir fallback cannot win over events.jsonl.
  fs.utimesSync(dir, oldTime, oldTime);
  const extras = campaignListExtras(ws, "c1");
  assert.equal(extras.last_active_at, newTime.toISOString());
});


test("tableTranscriptMessages projects one cash card from structured state_delta", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const prose = "诺特把预付金塞进他手里。";
  const receipt = "【变化】现金：获得 20 美元";
  const rendered = `${prose}\n\n${receipt}`;
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    JSON.stringify({ role: "keeper", text: rendered, turn: 1, finalization_id: "fin-cash" }) + "\n",
  );
  fs.writeFileSync(
    path.join(logsDir, "turn-finalizations.jsonl"),
    JSON.stringify({
      finalization_id: "fin-cash",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: prose },
        { segment_type: "state_delta", source_ids: ["cash-1", "cash-1-dup"], text: receipt },
      ],
      bundle: {
        state_delta: [
          {
            effect_id: "cash-1",
            effect_kind: "cash",
            amount: 20,
            currency: "美元",
            direction: "gain",
            after: 35,
            source_decision_id: "dec-cash-1",
          },
          {
            effect_id: "cash-1-dup",
            effect_kind: "cash",
            amount: 20,
            currency: "美元",
            direction: "gain",
            after: 35,
            source_decision_id: "dec-cash-1",
          },
        ],
      },
    }) + "\n",
  );

  const keeper = tableTranscriptMessages(ws, "c1")[0];
  const cashBlocks = keeper.content_blocks.filter((block) => block.type === "asset_changes");
  assert.equal(cashBlocks.length, 1);
  assert.deepEqual(cashBlocks[0].cash_changes, [{
    effect_id: "cash-1",
    amount: 20,
    currency: "美元",
    direction: "gain",
    after: 35,
    source_decision_id: "dec-cash-1",
  }]);
  assert.equal(cashBlocks[0].count, 1);
  assert.equal(keeper.content_blocks.some((block) => block.type === "prose" && block.text.includes("20 美元")), false);
});

test("cash card preserves decimal localized reason and game time", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const prose = "他把一枚半克朗塞进衣袋。";
  const receipt = "【变化】现金：获得 1.50 英镑（伦敦线人酬金）";
  const rendered = `${prose}\n\n${receipt}`;
  const gameTime = {
    elapsed_minutes: 90,
    display: "1920年1月12日 上午",
    day_phase: "morning",
    player_time: {
      phase: "morning",
      appearance_mode: "normal",
      display_label: "上午",
    },
  };
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    JSON.stringify({ role: "keeper", text: rendered, turn: 1, finalization_id: "fin-cash-decimal" }) + "\n",
  );
  fs.writeFileSync(
    path.join(logsDir, "turn-finalizations.jsonl"),
    JSON.stringify({
      finalization_id: "fin-cash-decimal",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: prose },
        { segment_type: "state_delta", source_ids: ["cash-gbp-1"], text: receipt },
      ],
      bundle: {
        state_delta: [
          {
            effect_id: "cash-gbp-1",
            effect_kind: "cash",
            amount: "1.50",
            currency: "GBP",
            direction: "gain",
            balance_after: "1.50",
            localized_reason: "伦敦线人酬金",
            game_time: gameTime,
            player_time: gameTime.player_time,
            source_decision_id: "dec-cash-gbp",
          },
        ],
      },
    }) + "\n",
  );

  const keeper = tableTranscriptMessages(ws, "c1")[0];
  const cashBlocks = keeper.content_blocks.filter((block) => block.type === "asset_changes");
  assert.equal(cashBlocks.length, 1);
  assert.deepEqual(cashBlocks[0].cash_changes, [{
    effect_id: "cash-gbp-1",
    amount: "1.50",
    currency: "GBP",
    direction: "gain",
    after: "1.50",
    localized_reason: "伦敦线人酬金",
    game_time: gameTime,
    player_time: gameTime.player_time,
    source_decision_id: "dec-cash-gbp",
  }]);
  const dumped = JSON.stringify(cashBlocks[0]);
  assert.equal(dumped.includes("recorded_at"), false);
  assert.equal(dumped.includes("\"reason\""), false);
  assert.equal(dumped.includes("\"tool\""), false);
});

test("tableTranscriptMessages emits no cash card without structured cash payload", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const prose = "他把钥匙塞进口袋。";
  const receipt = "【变化】物品：获得「钥匙」";
  const rendered = `${prose}\n\n${receipt}`;
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    JSON.stringify({ role: "keeper", text: rendered, turn: 1, finalization_id: "fin-item" }) + "\n",
  );
  fs.writeFileSync(
    path.join(logsDir, "turn-finalizations.jsonl"),
    JSON.stringify({
      finalization_id: "fin-item",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: prose },
        { segment_type: "state_delta", source_ids: ["item-1"], text: receipt },
      ],
      bundle: {
        state_delta: [{
          effect_id: "item-1",
          effect_kind: "item",
          item_id: "house-key",
          label: "钥匙",
          action: "acquired",
          source_decision_id: "dec-item-1",
        }],
      },
    }) + "\n",
  );

  const keeper = tableTranscriptMessages(ws, "c1")[0];
  assert.equal(keeper.content_blocks.some((block) => block.type === "cash"), false);
  const asset = keeper.content_blocks.filter((block) => block.type === "asset_changes");
  assert.equal(asset.length, 1);
  assert.equal(asset[0].item_changes[0].label, "钥匙");
  assert.equal(keeper.content_blocks.some((block) => block.type === "prose" && block.text.includes("【变化】")), false);
});

test("mixed cash and item effects render one asset changes card without prose duplication", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const prose = "诺特把预付金和钥匙一并递过来。";
  const receipt = [
    "【变化】现金：+20.00 USD（0.00 → 20.00）；预付调查费；时段：早上",
    "【变化】现金：+5.00 GBP（0.00 → 5.00）；伦敦线人酬金；时段：早上",
    "【变化】现金：-1.50 USD（20.00 → 18.50）；去波士顿街的车费；时段：早上",
    "【变化】物品：获得「钥匙」",
  ].join("\n");
  const rendered = `${prose}\n\n${receipt}`;
  const gameTime = {
    elapsed_minutes: 90,
    display: "1920年1月12日 上午",
    day_phase: "morning",
    player_time: {
      phase: "morning",
      appearance_mode: "normal",
      display_label: "上午",
    },
  };
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    JSON.stringify({ role: "keeper", text: rendered, turn: 1, finalization_id: "fin-assets" }) + "\n",
  );
  fs.writeFileSync(
    path.join(logsDir, "turn-finalizations.jsonl"),
    JSON.stringify({
      finalization_id: "fin-assets",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: prose },
        {
          segment_type: "asset_delta",
          source_ids: ["cash-usd-1", "cash-gbp-1", "cash-usd-2", "item-key"],
          text: receipt,
        },
      ],
      bundle: {
        state_delta: [
          {
            effect_id: "cash-usd-1",
            effect_kind: "cash",
            action: "grant",
            amount: "20.00",
            currency: "USD",
            balance_after: "20.00",
            localized_reason: "预付调查费",
            game_time: gameTime,
            source_decision_id: "dec-usd-1",
          },
          {
            effect_id: "cash-gbp-1",
            effect_kind: "cash",
            action: "grant",
            amount: "5.00",
            currency: "GBP",
            balance_after: "5.00",
            localized_reason: "伦敦线人酬金",
            game_time: gameTime,
            source_decision_id: "dec-gbp-1",
          },
          {
            effect_id: "cash-usd-2",
            effect_kind: "cash",
            action: "spend",
            amount: "1.50",
            currency: "USD",
            balance_after: "18.50",
            localized_reason: "去波士顿街的车费",
            game_time: gameTime,
            source_decision_id: "dec-usd-2",
          },
          {
            effect_id: "item-key",
            effect_kind: "item",
            action: "acquired",
            item_id: "house-key",
            label: "钥匙",
            quantity: 1,
            source_decision_id: "dec-item-1",
          },
        ],
      },
    }) + "\n",
  );

  const keeper = tableTranscriptMessages(ws, "c1")[0];
  const assetBlocks = keeper.content_blocks.filter((block) => block.type === "asset_changes");
  assert.equal(assetBlocks.length, 1);
  assert.equal(assetBlocks[0].count, 4);
  assert.equal(assetBlocks[0].cash_changes.length, 3);
  assert.equal(assetBlocks[0].item_changes.length, 1);
  assert.equal(assetBlocks[0].cash_changes[2].amount, "1.50");
  assert.equal(assetBlocks[0].cash_changes[0].localized_reason, "预付调查费");
  assert.equal(assetBlocks[0].cash_changes[0].game_time.display, "1920年1月12日 上午");
  assert.equal(assetBlocks[0].item_changes[0].label, "钥匙");
  const proseBlocks = keeper.content_blocks.filter((block) => block.type === "prose");
  const proseText = proseBlocks.map((block) => block.text).join("\n");
  assert.equal(proseText.includes("【变化】"), false);
  assert.equal(proseText.includes("现金变动"), false);
  assert.equal(proseText.includes("钥匙变动"), false);
});

test("item change card carries structured weapon params without 【变化】 prose", () => {
  const ws = makeWorkspace();
  const logsDir = path.join(ws, ".coc/campaigns/c1/logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const prose = "他把卡卡诺步枪背到肩上。";
  const receipt = "【变化】物品：获得「卡卡诺步枪」";
  const rendered = `${prose}\n\n${receipt}`;
  fs.writeFileSync(
    path.join(logsDir, "table-transcript.jsonl"),
    JSON.stringify({ role: "keeper", text: rendered, turn: 1, finalization_id: "fin-rifle" }) + "\n",
  );
  fs.writeFileSync(
    path.join(logsDir, "turn-finalizations.jsonl"),
    JSON.stringify({
      finalization_id: "fin-rifle",
      rendered_text: rendered,
      segments: [
        { segment_type: "fiction", source_ids: [], text: prose },
        { segment_type: "state_delta", source_ids: ["item-rifle"], text: receipt },
      ],
      bundle: {
        state_delta: [{
          effect_id: "item-rifle",
          effect_kind: "item",
          item_id: "mannlicher_carcano_rifle",
          label: "卡卡诺步枪",
          action: "acquired",
          source_decision_id: "dec-rifle",
          weapon: {
            weapon_id: "mannlicher_carcano_rifle",
            damage: "1D12+2",
            skill: "Firearms (Rifle)",
            range: 150,
            ammo: 6,
          },
        }],
      },
    }) + "\n",
  );

  const keeper = tableTranscriptMessages(ws, "c1")[0];
  const asset = keeper.content_blocks.filter((block) => block.type === "asset_changes");
  assert.equal(asset.length, 1);
  assert.equal(asset[0].item_changes[0].weapon.damage, "1D12+2");
  assert.equal(asset[0].item_changes[0].weapon.ammo, 6);
  assert.equal(keeper.content_blocks.some((block) => block.type === "prose" && block.text.includes("【变化】")), false);
});

const XAI_PROVIDERS = {
  xai: {
    models: [{ id: "grok-4.3" }, { id: "grok-4.6" }],
  },
};

test("resolveModelsDefault prefers a saved selection over catalog first entry", () => {
  assert.deepEqual(
    resolveModelsDefault(XAI_PROVIDERS, [
      { provider: "xai", model: "grok-4.6" },
      { provider: "coding-relay", model: "gpt-5.6-luna" },
    ]),
    { provider: "xai", model: "grok-4.6" },
  );
});

test("resolveModelsDefault skips empty or unknown saved models then uses first catalog entry", () => {
  assert.deepEqual(
    resolveModelsDefault(XAI_PROVIDERS, [
      { provider: "", model: "" },
      { provider: "xai", model: "missing" },
      { provider: "coding-relay", model: "gpt-5.6-luna" },
    ]),
    { provider: "xai", model: "grok-4.3" },
  );
});

test("modelsPayload default reads user-prefs over Pi settings.json", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "coc-models-prefs-"));
  const agentDir = path.join(userData, "pi-agent");
  fs.mkdirSync(agentDir);
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
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ defaultProvider: "xai", defaultModel: "grok-4.3" }),
  );
  fs.writeFileSync(
    path.join(userData, "coc-desktop-settings.json"),
    JSON.stringify({ provider: "xai", model: "grok-4.6" }),
  );
  const prevAgent = process.env.PI_AGENT_DIR;
  const prevData = process.env.COC_DESKTOP_USER_DATA;
  process.env.PI_AGENT_DIR = agentDir;
  process.env.COC_DESKTOP_USER_DATA = userData;
  try {
    assert.deepEqual(modelsPayload().default, { provider: "xai", model: "grok-4.6" });
  } finally {
    if (prevAgent === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = prevAgent;
    if (prevData === undefined) delete process.env.COC_DESKTOP_USER_DATA;
    else process.env.COC_DESKTOP_USER_DATA = prevData;
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("modelsPayload marks image from models.json input without touching settings merge fields", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "coc-models-image-"));
  const agentDir = path.join(userData, "pi-agent");
  fs.mkdirSync(agentDir);
  const settingsPath = path.join(userData, "coc-desktop-settings.json");
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      onboarded: true,
      hiddenProviderIds: ["zhipu"],
      extraProviderIds: ["google"],
    }) + "\n",
  );
  const settingsBefore = fs.readFileSync(settingsPath, "utf8");
  fs.writeFileSync(
    path.join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        xai: {
          name: "xAI",
          models: [
            { id: "grok-4.6", name: "Grok 4.6", input: ["text", "image"] },
            { id: "text-only", name: "Text", input: ["text"] },
          ],
        },
        mygateway: {
          name: "My Gateway",
          models: [{ id: "model-b", name: "B" }],
        },
      },
    }),
  );
  const prevAgent = process.env.PI_AGENT_DIR;
  const prevData = process.env.COC_DESKTOP_USER_DATA;
  process.env.PI_AGENT_DIR = agentDir;
  process.env.COC_DESKTOP_USER_DATA = userData;
  try {
    const payload = modelsPayload();
    const byId = Object.fromEntries(
      payload.providers.xai.models.map((m) => [m.id, m.image]),
    );
    assert.equal(byId["grok-4.6"], true);
    assert.equal(byId["text-only"], false);
    assert.equal(payload.providers.mygateway.models[0].image, false);
    assert.equal(fs.readFileSync(settingsPath, "utf8"), settingsBefore);
    const disk = JSON.parse(settingsBefore);
    assert.equal(disk.onboarded, true);
    assert.deepEqual(disk.hiddenProviderIds, ["zhipu"]);
    assert.deepEqual(disk.extraProviderIds, ["google"]);
  } finally {
    if (prevAgent === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = prevAgent;
    if (prevData === undefined) delete process.env.COC_DESKTOP_USER_DATA;
    else process.env.COC_DESKTOP_USER_DATA = prevData;
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("player-facing portrait projection omits prompt and provenance", () => {
  const projected = playerFacingPortraitProjection({
    portrait: {
      asset_path: ".coc/investigators/ada/portraits/ada.png",
      source: "player",
      status: "generated",
      generated_at: "2026-01-01T00:00:00Z",
      prompt: "secret prompt must not leak",
      provenance: { appearance: "hidden", mythos: "do not send" },
      tool: "xai",
      host: "pi-coc",
    },
  });
  assert.deepEqual(projected, {
    portrait_path: ".coc/investigators/ada/portraits/ada.png",
    portrait_source: "player",
    portrait_status: "generated",
    portrait_generated_at: "2026-01-01T00:00:00Z",
  });
  const dumped = JSON.stringify(projected);
  assert.equal(dumped.includes("prompt"), false);
  assert.equal(dumped.includes("provenance"), false);
  assert.equal(dumped.includes("secret"), false);
});

test("attachPortraitToDisplayCharacter adds a safe image URL and strips secrets", () => {
  const ws = makeWorkspace();
  writeJson(path.join(ws, ".coc/investigators/ada/character.json"), {
    id: "ada",
    name: "Ada",
    portrait: {
      asset_path: ".coc/investigators/ada/portraits/ada.png",
      source: "sheet_concept",
      status: "generated",
      generated_at: "2026-01-01T00:00:00Z",
      prompt: "KP-only prompt",
      provenance: { appearance: "secret look" },
    },
  });
  const display = attachPortraitToDisplayCharacter(
    { name: "Ada", portrait: { prompt: "leaked" } },
    { workspace: ws, investigatorId: "ada" },
  );
  assert.equal(display.portrait.portrait_path, ".coc/investigators/ada/portraits/ada.png");
  assert.equal(
    display.portrait.image_url,
    "/api/investigators/ada/portraits/ada.png",
  );
  assert.equal(display.portrait.prompt, undefined);
  assert.equal(display.portrait.provenance, undefined);
  assert.equal(JSON.stringify(display).includes("KP-only"), false);
  assert.equal(portraitImageUrl("ada", ".coc/investigators/ada/portraits/ada.png"), display.portrait.image_url);
});

test("resolveInvestigatorPortraitFile rejects traversal", () => {
  const ws = makeWorkspace();
  const ok = resolveInvestigatorPortraitFile(ws, "ada", "ada.png");
  assert.ok(ok.endsWith(`${path.sep}ada${path.sep}portraits${path.sep}ada.png`));
  assert.equal(resolveInvestigatorPortraitFile(ws, "ada", "../campaign.json"), null);
  assert.equal(resolveInvestigatorPortraitFile(ws, "ada", ".."), null);
  assert.equal(resolveInvestigatorPortraitFile(ws, "../ada", "ada.png"), null);
  assert.equal(resolveInvestigatorPortraitFile(ws, "ada", "ada.png.txt"), null);
  assert.equal(resolveInvestigatorPortraitFile(ws, "ada", ".hidden.png"), null);
});

test("modelsPayload default falls back to Pi settings when user-prefs model is empty", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "coc-models-pi-"));
  const agentDir = path.join(userData, "pi-agent");
  fs.mkdirSync(agentDir);
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
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ defaultProvider: "xai", defaultModel: "grok-4.6" }),
  );
  fs.writeFileSync(path.join(userData, "coc-desktop-settings.json"), "{}\n");
  const prevAgent = process.env.PI_AGENT_DIR;
  const prevData = process.env.COC_DESKTOP_USER_DATA;
  process.env.PI_AGENT_DIR = agentDir;
  process.env.COC_DESKTOP_USER_DATA = userData;
  try {
    assert.deepEqual(modelsPayload().default, { provider: "xai", model: "grok-4.6" });
  } finally {
    if (prevAgent === undefined) delete process.env.PI_AGENT_DIR;
    else process.env.PI_AGENT_DIR = prevAgent;
    if (prevData === undefined) delete process.env.COC_DESKTOP_USER_DATA;
    else process.env.COC_DESKTOP_USER_DATA = prevData;
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
