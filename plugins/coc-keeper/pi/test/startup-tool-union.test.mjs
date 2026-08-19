#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const domainUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts"),
).href;

async function loadDomain() {
  return import(`${domainUrl}?t=${Date.now()}-${Math.random()}`);
}

test("pending non-resume stays phase_forbidden while schema unions projected tools", async () => {
  const mod = await loadDomain();
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_rules",
    operation: "rules.roll",
    phase: "recovery",
  }).code, "phase_forbidden");
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_turn",
    operation: "state.journal",
    phase: "recovery",
  }).ok, true);
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_turn",
    operation: "turn.finalize",
    phase: "recovery",
  }).ok, true);
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_setup",
    operation: "session.resume",
    phase: "recovery",
  }).ok, true);

  const probeRoot = mkdtempSync(path.join(tmpdir(), "pi-coc-startup-union-"));
  const playedId = "played-startup-union";
  mkdirSync(path.join(probeRoot, ".coc", "campaigns", playedId, "logs"), {
    recursive: true,
  });
  writeFileSync(
    path.join(probeRoot, ".coc", "campaigns", playedId, "logs", "table-transcript.jsonl"),
    `${JSON.stringify({ role: "keeper", turn: 2 })}\n`,
  );

  const fresh = mod.activeToolsForStartupResumePending({
    workspaceRoot: probeRoot,
    campaignId: "fresh-startup-union",
    fallbackPhase: "opening",
    role: "play",
  });
  const played = mod.activeToolsForStartupResumePending({
    workspaceRoot: probeRoot,
    campaignId: playedId,
    fallbackPhase: "opening",
    role: "play",
  });
  const recovery = mod.activeToolsForPhase("recovery", "play");
  assert.ok(fresh.includes("coc_session_resume"));
  assert.ok(fresh.includes("coc_rules_roll_dice"));
  assert.ok(!fresh.includes("coc_rules"));
  assert.ok(!fresh.includes("coc_npc_reaction"));
  assert.ok(!fresh.includes("coc_npc"));
  assert.ok(mod.domainToolSchema("coc_turn").properties.operation.enum.includes("state.journal"));
  assert.ok(mod.domainToolSchema("coc_turn").properties.operation.enum.includes("turn.finalize"));
  assert.ok(played.includes("coc_session_resume"));
  assert.ok(played.includes("coc_rules_roll"));
  assert.ok(played.includes("coc_turn_finalize"));
  assert.ok(played.includes("coc_npc_reaction"));
  assert.ok(!played.includes("coc_rules"));
  assert.ok(!recovery.includes("coc_rules"));
  assert.ok(!recovery.includes("coc_rules_roll"));
  assert.ok(!recovery.includes("coc_turn"));
  assert.notDeepEqual(played, recovery);
});

test("setup role is not expanded by the startup union", async () => {
  const mod = await loadDomain();
  const tools = mod.activeToolsForStartupResumePending({
    workspaceRoot: root,
    campaignId: "setup-no-expansion",
    fallbackPhase: "live_turn",
    role: "setup",
  });
  assert.ok(tools.includes("coc_session_resume"));
  assert.ok(tools.includes("coc_chargen_delegate"));
  assert.ok(!tools.includes("coc_setup"));
  assert.ok(!tools.includes("coc_npc"));
  assert.ok(!tools.includes("coc_npc_reaction"));
  assert.ok(!tools.includes("coc_subsystem"));
  assert.ok(!tools.includes("coc_advice"));
});

test("already live fallback does not collapse to recovery-only", async () => {
  const mod = await loadDomain();
  const tools = mod.activeToolsForStartupResumePending({
    workspaceRoot: root,
    campaignId: "no-transcript-but-live",
    fallbackPhase: "live_turn",
    role: "play",
  });
  const recovery = mod.activeToolsForPhase("recovery", "play");
  assert.ok(tools.includes("coc_rules_roll"));
  assert.ok(tools.includes("coc_session_resume"));
  assert.ok(!tools.includes("coc_rules"));
  assert.notDeepEqual(tools, recovery);
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_rules",
    operation: "rules.roll",
    phase: "live_turn",
  }).ok, true);
});
