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
const operationPolicyUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/operation-policy.ts"),
).href;

async function loadDomain() {
  return import(`${domainUrl}?t=${Date.now()}-${Math.random()}`);
}

test("phase activation keeps the restricted skill-doc read active and unrestricted builtins out", async () => {
  const mod = await loadDomain();
  const policy = await import(operationPolicyUrl);
  const roles = [null, ...policy.SESSION_ROLES];

  for (const role of roles) {
    for (const phase of policy.PLAY_PHASES) {
      const tools = mod.activeToolsForPhase(phase, role);
      const context = `role=${role ?? "legacy"} phase=${phase}`;
      assert.ok(tools.includes("read"), `${context} must keep the restricted canonical skill-doc read active`);
      assert.ok(!tools.includes("bash"), `${context} must keep unrestricted builtin bash out`);
      assert.ok(!tools.includes("edit"), `${context} must keep unrestricted builtin edit out`);
      assert.ok(!tools.includes("write"), `${context} must keep unrestricted builtin write out`);
      assert.ok(tools.includes("subagent"), `${context} must keep subagent available`);
      assert.ok(tools.includes("subagent_wait"), `${context} must keep subagent_wait available`);
    }
  }
});

// RuleGraph cutover: the Keeper rolls through rules.context / rules.settle.
// The legacy roll family is host-private and must never reach a role surface.
const RETIRED_TO_HOST = [
  ["coc_rules", "rules.roll"],
  ["coc_rules", "rules.push"],
  ["coc_rules", "rules.psychology_observe"],
];

test("retired legacy rules operations are host-private, not recovery-gated", async () => {
  const mod = await loadDomain();
  for (const phase of ["recovery", "live_turn"]) {
    for (const [toolName, operation] of RETIRED_TO_HOST) {
      const denied = mod.evaluateExecuteAcl({ toolName, operation, phase });
      assert.equal(denied.ok, false, `${phase} ${operation}`);
      assert.equal(denied.code, "host_private_operation", `${phase} ${operation}`);
    }
  }
});

test("pending non-resume requires recovery binding while schema unions projected tools", async () => {
  const mod = await loadDomain();
  for (const operation of ["rules.settle", "rules.context"]) {
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation,
      phase: "recovery",
    }).code, "recovery_authorization_required", operation);
  }
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_turn",
    operation: "state.journal",
    phase: "recovery",
  }).code, "recovery_authorization_required");
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_turn",
    operation: "turn.finalize",
    phase: "recovery",
  }).code, "recovery_authorization_required");
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
  assert.ok(played.includes("coc_rules_settle"));
  assert.ok(played.includes("coc_rules_context"));
  assert.ok(played.includes("coc_turn_finalize"));
  assert.ok(played.includes("coc_npc_reaction"));
  assert.ok(!played.includes("coc_rules"));
  assert.ok(!played.includes("coc_rules_roll"));
  assert.ok(!played.includes("coc_rules_psychology_observe"));
  assert.ok(!recovery.includes("coc_rules"));
  assert.ok(!recovery.includes("coc_rules_settle"));
  assert.ok(!recovery.includes("coc_rules_context"));
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
  assert.ok(tools.includes("coc_rules_settle"));
  assert.ok(tools.includes("coc_rules_context"));
  assert.ok(tools.includes("coc_session_resume"));
  assert.ok(!tools.includes("coc_rules"));
  assert.ok(!tools.includes("coc_rules_roll"));
  assert.notDeepEqual(tools, recovery);
  for (const operation of ["rules.settle", "rules.context"]) {
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation,
      phase: "live_turn",
    }).ok, true, operation);
  }
});
