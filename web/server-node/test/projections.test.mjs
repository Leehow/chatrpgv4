import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  discoveredCluesDisplay,
  enrichTranscriptFromEvents,
  formatPlayerTime,
  sceneDisplayLabel,
  tableTranscriptMessages,
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
