#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const mod = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts")).href
);

const rulesSchema = mod.domainToolSchema("coc_rules");
assert.equal(rulesSchema.properties.operation.type, "string");
assert.ok(rulesSchema.properties.operation.enum.includes("rules.roll"));
assert.ok(!rulesSchema.properties.operation.enum.includes("turn.finalize"));
assert.ok(!rulesSchema.properties.operation.enum.includes("progressive.claim_host_work"));

const contextOps = mod.domainToolSchema("coc_context").properties.operation.enum;
for (const banned of [
  "steward.domain_put",
  "steward.scene_bundle_put",
  "steward.deliver",
  "steward.mark_consumed",
  "steward.notebook_put",
  "steward.notebook_pay",
]) {
  assert.ok(!contextOps.includes(banned), banned);
  const denied = mod.evaluateExecuteAcl({
    toolName: "coc_invoke",
    operation: banned,
    phase: "live_turn",
  });
  assert.equal(denied.ok, false, banned);
  assert.equal(denied.code, "host_private_operation", banned);
}

const denyPrivate = mod.evaluateExecuteAcl({
  toolName: "coc_invoke",
  operation: "progressive.claim_host_work",
  phase: "live_turn",
});
assert.equal(denyPrivate.ok, false);
assert.equal(denyPrivate.code, "private_lifecycle_operation");

const denyAudit = mod.evaluateExecuteAcl({
  toolName: "coc_invoke",
  operation: "development.settle",
  phase: "ending",
});
assert.equal(denyAudit.ok, false);

const translate = mod.evaluateExecuteAcl({
  toolName: "coc_invoke",
  operation: "rules.roll",
  phase: "live_turn",
});
assert.equal(translate.ok, true);
assert.equal(translate.wrapper, "coc_rules");
assert.equal(translate.transport_tool, "coc_invoke");
assert.equal(translate.canonical_operation, "rules.roll");

assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_rules",
  operation: "rules.roll",
  phase: "opening",
}).ok, false);

assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_turn",
  operation: "turn.finalize",
  phase: "pending_finalization",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_context",
  operation: "scene.context",
  phase: "pending_finalization",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_state",
  operation: "state.exceptional_effect",
  phase: "pending_finalization",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_state",
  operation: "state.end_session",
  phase: "pending_finalization",
}).ok, false);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_turn",
  operation: "state.journal",
  phase: "pending_finalization",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_turn",
  operation: "turn.finalize",
  phase: "ending",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_state",
  operation: "state.move_scene",
  phase: "pending_finalization",
}).ok, false);
assert.ok(mod.activeToolsForPhase("ending").includes(
  mod.domainToolForOperation("state.journal"),
));
assert.ok(mod.activeToolsForPhase("ending", "play").includes("coc_turn_finalize"));
assert.ok(mod.activeToolsForPhase("ending", "play").includes("coc_turn_output_context"));
assert.ok(!mod.activeToolsForPhase("ending").includes("coc_state_end_session"));

for (const [operation, policy] of Object.entries(mod.OPERATION_POLICY)) {
  for (const phase of ["opening", "live_turn", "pending_finalization", "recovery", "ending", "cold_start"]) {
    const decision = mod.evaluateExecuteAcl({
      toolName: "coc_invoke",
      operation,
      phase,
    });
    const policyWouldAllow = (
      policy.audience !== "source_worker"
      && policy.audience !== "audit"
      && !mod.SOURCE_WORKER_LIFECYCLE_OPERATIONS.has(operation)
      && policy.phases.includes(phase)
      && (
        policy.kp_surface !== "none"
        || mod.HOST_INVOKE_COMPAT_OPERATIONS.has(operation)
      )
    );
    assert.equal(decision.ok, policyWouldAllow, `${operation} @ ${phase}`);
  }
}

const classified = mod.classifyToolCall("coc_rules", { operation: "rules.roll" });
assert.equal(classified.wrapper_tool, "coc_rules");
assert.equal(classified.transport_tool, "coc_invoke");
assert.equal(classified.canonical_operation, "rules.roll");

const liveActive = mod.activeToolsForPhase("live_turn");
assert.ok(!liveActive.includes("coc_invoke"));
assert.ok(!liveActive.includes("coc_discover"));
assert.ok(liveActive.includes("coc_rules"));
assert.ok(!liveActive.includes("coc_setup"));

const stateOps = mod.domainToolSchema("coc_state").properties.operation.enum;
for (const operation of [
  "state.item_grant",
  "state.cash_grant",
  "state.cash_query",
  "state.cash_spend",
  "state.deliver_handout",
  "state.replay_handout",
]) {
  assert.ok(stateOps.includes(operation), `${operation} on coc_state enum`);
  assert.equal(mod.domainToolForOperation(operation), "coc_state", operation);
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_state",
    operation,
    phase: "live_turn",
  }).ok, true, `${operation} @ live_turn`);
}
const openingRequired = [
  "setup.adopt_source_facts",
  "setup.investigator_contract",
  "setup.invoke",
  "rules.roll_dice",
  "rules.cash_assets",
  "state.cash_semantic",
];
for (const phase of ["opening", "cold_start"]) {
  const active = mod.activeToolsForPhase(phase);
  assert.ok(active.includes("coc_rules"), phase);
  assert.ok(active.includes("coc_state"), phase);
  for (const operation of openingRequired) {
    const wrapper = mod.domainToolForOperation(operation);
    assert.ok(wrapper, operation);
    assert.ok(active.includes(wrapper), `${operation} visible via ${wrapper} @ ${phase}`);
    const allowed = mod.evaluateExecuteAcl({
      toolName: wrapper,
      operation,
      phase,
    });
    assert.equal(allowed.ok, true, `${operation} @ ${phase}`);
  }
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_rules",
    operation: "rules.roll",
    phase,
  }).ok, false);
  assert.equal(mod.evaluateExecuteAcl({
    toolName: "coc_state",
    operation: "state.move_scene",
    phase,
  }).ok, false);
  for (const banned of [
    "steward.domain_put",
    "progressive.claim_host_work",
    "development.settle",
  ]) {
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_invoke",
      operation: banned,
      phase,
    }).ok, false, `${banned} @ ${phase}`);
  }
}

assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_turn",
  operation: "turn.finalize",
  phase: "pending_finalization",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_state",
  operation: "state.exceptional_effect",
  phase: "pending_finalization",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_setup",
  operation: "session.resume",
  phase: "recovery",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_state",
  operation: "state.end_session",
  phase: "ending",
}).ok, false);

assert.ok(mod.activeToolsForPhase("cold_start").includes("coc_setup"));
assert.ok(mod.activeToolsForPhase("opening").includes("coc_setup"));
assert.ok(mod.activeToolsForPhase("recovery").includes("coc_setup"));
assert.ok(!mod.activeToolsForPhase("live_turn").includes("coc_setup"));

for (const phase of ["cold_start", "opening"]) {
  for (const operation of [
    "setup.inspect",
    "session.resume",
    "setup.investigator_contract",
    "setup.quick_start",
  ]) {
    const allowed = mod.evaluateExecuteAcl({
      toolName: "coc_setup",
      operation,
      phase,
    });
    assert.equal(allowed.ok, true, `${operation} via coc_setup @ ${phase}`);
    const mismatch = mod.evaluateExecuteAcl({
      toolName: "coc_context",
      operation,
      phase,
    });
    assert.equal(mismatch.ok, false, `${operation} via coc_context @ ${phase}`);
    assert.equal(mismatch.code, "domain_mismatch", `${operation} mismatch @ ${phase}`);
  }
}

assert.equal(
  mod.inferPhaseFromEnvelope("setup.quick_start", { ok: true, data: {} }, "cold_start"),
  "opening",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "setup.invoke",
    { ok: true, data: { kind: "campaign.create" } },
    "cold_start",
  ),
  "opening",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "setup.invoke",
    { ok: true, data: { kind: "campaign.link_investigator" } },
    "cold_start",
  ),
  "opening",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "setup.invoke",
    { ok: true, data: { kind: "scenario.bind_pdf" } },
    "cold_start",
  ),
  "opening",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "evidence.table_opening",
    { ok: true, data: {} },
    "opening",
  ),
  "live_turn",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "setup.quick_start",
    { ok: true, data: {} },
    "pending_finalization",
  ),
  "pending_finalization",
);

assert.equal(mod.inferPhaseFromEnvelope("session.resume",
  { ok: true, data: { mode: "awaiting_player", investigators: [] } }, "opening"), "opening");
assert.equal(mod.playPhaseFromResumeData({ mode: "awaiting_player", investigators: [] }), "opening");
assert.equal(mod.playPhaseFromResumeData({ mode: "awaiting_player", character_creation: {} }), "opening");
assert.equal(mod.playPhaseFromResumeData({ mode: "awaiting_player", opening_gate: { phase: "opening_setup" } }), "opening");
assert.equal(mod.playPhaseFromResumeData({ mode: "awaiting_player", investigators: [{ id: "inv-1" }] }), "live_turn");
assert.equal(mod.playPhaseFromResumeData({ mode: "ending", ending_output: { ending_id: "ending-1" } }), "ending");
assert.equal(
  mod.inferPhaseFromEnvelope(
    "session.resume",
    { ok: true, data: { mode: "ending", ending_output: { ending_id: "ending-1" } } },
    "live_turn",
  ),
  "ending",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "state.end_session",
    { ok: true, data: { session_ending: true } },
    "pending_finalization",
  ),
  "ending",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "state.journal",
    { ok: true, data: { turn_id: "turn-1" } },
    "live_turn",
  ),
  "pending_finalization",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "state.journal",
    { ok: true, data: { turn_id: "ending-turn" } },
    "ending",
  ),
  "pending_finalization",
);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_turn",
  operation: "turn.output_context",
  phase: "live_turn",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_turn",
  operation: "turn.finalize",
  phase: "live_turn",
}).ok, true);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "turn.finalize",
    { ok: true, data: { rendered_text: "结局。" } },
    "ending",
  ),
  "ending",
);
assert.equal(mod.inferPhaseFromEnvelope("session.resume", { ok: true }, "opening"), "opening");
assert.equal(mod.inferPhaseFromEnvelope("session.resume", { ok: true }, "cold_start"), "opening");
assert.equal(mod.inferPhaseFromEnvelope("session.resume", { ok: true }, "live_turn"), "live_turn");
assert.ok(mod.activeToolsForPhase("opening").includes("coc_setup"));

const freshOpening = {
  mode: "table_opening",
  next_operations: ["evidence.table_opening"],
  campaign_id: "fresh-ready-for-table",
};
assert.equal(mod.playPhaseFromResumeData(freshOpening), "opening");
assert.equal(
  mod.inferPhaseFromEnvelope(
    "session.resume",
    { ok: true, data: freshOpening },
    "opening",
  ),
  "opening",
);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_context",
  operation: "evidence.table_opening",
  phase: "opening",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_rules",
  operation: "rules.social_adjudicate",
  phase: "opening",
}).ok, false);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_npc",
  operation: "npc.reaction",
  phase: "opening",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_state",
  operation: "state.record_npc_engagement",
  phase: "opening",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_rules",
  operation: "rules.roll",
  phase: "opening",
}).ok, false);
assert.ok(mod.domainToolSchema("coc_rules").properties.operation.enum.includes(
  "rules.social_adjudicate",
));
assert.ok(mod.domainToolSchema("coc_rules").properties.operation.enum.includes(
  "rules.roll",
));
assert.ok(!mod.activeToolsForPhase("opening").includes("coc_invoke"));

const playedResume = {
  mode: "table_opening",
  next_operations: ["evidence.table_opening"],
  campaign_id: "played-ready-for-table",
  checkpoint: { turn_number: 2, source: { finalization_id: "turn-effect-v1:played" } },
  scene_context: { turn_number: 2 },
};
assert.equal(mod.playPhaseFromResumeData(playedResume), "live_turn");
const playedPhase = mod.inferPhaseFromEnvelope(
  "session.resume",
  { ok: true, data: playedResume },
  "opening",
);
assert.equal(playedPhase, "live_turn");
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_rules",
  operation: "rules.social_adjudicate",
  phase: playedPhase,
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_rules",
  operation: "rules.roll",
  phase: playedPhase,
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_invoke",
  operation: "rules.social_adjudicate",
  phase: playedPhase,
}).wrapper, "coc_rules");
assert.ok(!mod.activeToolsForPhase(playedPhase).includes("coc_invoke"));

// Exact 15:19 ready_for_table handoff vs 15:59 mid-play resume from
// the-haunting-qs-msyt48g3. Setup/chargen current_turn rows and empty
// pending/delivery shells must not promote a fresh table_opening.
const hauntingFreshResume = {
  mode: "table_opening",
  campaign_id: "the-haunting-qs-msyt48g3",
  next_operations: ["evidence.table_opening"],
  checkpoint: null,
  pending_output_context: null,
  pending_turn: null,
  delivery: { status: "none", finalization_id: null, rendered_sha256: null },
  semantic_capsule: { updated_from_turn: null },
  scene_context: { turn_number: 0 },
  current_turn: {
    rows: [
      { tool: "rules.roll_dice", ok: true },
      { tool: "setup.complete", ok: true },
    ],
  },
};
assert.equal(mod.playPhaseFromResumeData(hauntingFreshResume), "opening");
assert.equal(
  mod.inferPhaseFromEnvelope(
    "session.resume",
    { ok: true, data: hauntingFreshResume },
    "opening",
  ),
  "opening",
);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_rules",
  operation: "rules.social_adjudicate",
  phase: "opening",
}).ok, false);

const hauntingPlayedResume = {
  mode: "table_opening",
  campaign_id: "the-haunting-qs-msyt48g3",
  next_operations: ["evidence.table_opening"],
  checkpoint: {
    turn_number: 2,
    status: "awaiting_player",
    source: { finalization_id: "turn-effect-v1:c330d625fdfca0579f001cb0a6abbb9ce37bf6bf" },
  },
  scene_context: { turn_number: 2 },
  semantic_capsule: { updated_from_turn: 2 },
  delivery: {
    status: "unconfirmed",
    finalization_id: "turn-effect-v1:c330d625fdfca0579f001cb0a6abbb9ce37bf6bf",
    rendered_sha256: "sha256:ab54c72537925729e633735eca2a483ce81124786c277ae5b184de7fc2fbbcca",
  },
  pending_output_context: null,
  pending_turn: null,
};
assert.equal(mod.playPhaseFromResumeData(hauntingPlayedResume), "live_turn");
assert.equal(
  mod.inferPhaseFromEnvelope(
    "session.resume",
    { ok: true, data: hauntingPlayedResume },
    "opening",
  ),
  "live_turn",
);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_rules",
  operation: "rules.social_adjudicate",
  phase: "live_turn",
}).ok, true);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_rules",
  operation: "rules.roll",
  phase: "live_turn",
}).ok, true);

const openingReceiptResume = {
  mode: "table_opening",
  next_operations: ["evidence.table_opening"],
  current_turn: { rows: [{ tool: "evidence.table_opening", ok: true }] },
};
assert.equal(mod.playPhaseFromResumeData(openingReceiptResume), "live_turn");
assert.equal(
  mod.inferPhaseFromEnvelope(
    "session.resume",
    { ok: true, data: openingReceiptResume },
    "opening",
  ),
  "live_turn",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "session.resume",
    { ok: true, data: freshOpening },
    "live_turn",
  ),
  "live_turn",
);

const probeRoot = mkdtempSync(path.join(tmpdir(), "pi-coc-table-started-"));
const probeCampaign = "opened-no-turn-yet";
const transcriptDir = path.join(
  probeRoot, ".coc", "campaigns", probeCampaign, "logs",
);
mkdirSync(transcriptDir, { recursive: true });
assert.equal(
  mod.campaignHasStartedTableEvidence(probeRoot, probeCampaign),
  false,
);
writeFileSync(
  path.join(transcriptDir, "table-transcript.jsonl"),
  `${JSON.stringify({ role: "keeper", turn: 0 })}\n`,
);
assert.equal(
  mod.campaignHasStartedTableEvidence(probeRoot, probeCampaign),
  true,
);
assert.equal(
  mod.playPhaseFromResumeData(
    { mode: "table_opening", campaign_id: probeCampaign },
    { workspaceRoot: probeRoot },
  ),
  "live_turn",
);
assert.equal(
  mod.playPhaseFromResumeData(
    {
      mode: "table_opening",
      campaign_id: probeCampaign,
      next_operations: ["evidence.table_opening"],
      current_turn: { rows: [{ tool: "setup.complete", ok: true }] },
    },
    { workspaceRoot: probeRoot },
  ),
  "live_turn",
  "persisted turn-0 opening must beat a stale opening next-operation",
);
assert.equal(
  mod.playPhaseFromResumeData(
    { mode: "table_opening", campaign_id: "still-fresh" },
    { workspaceRoot: probeRoot },
  ),
  "opening",
);

const recoveryResume = {
  mode: "open_turn_recovery",
  next_operations: ["continue_current_turn_from_receipts"],
};
assert.equal(mod.playPhaseFromResumeData(recoveryResume), "recovery");
assert.equal(
  mod.inferPhaseFromEnvelope(
    "session.resume",
    { ok: true, data: recoveryResume },
    "opening",
  ),
  "recovery",
);

function writeReadyTableCampaign(root, campaignId, extra = {}) {
  const dir = path.join(root, ".coc", "campaigns", campaignId);
  mkdirSync(path.join(dir, "save"), { recursive: true });
  mkdirSync(path.join(dir, "logs"), { recursive: true });
  writeFileSync(path.join(dir, "campaign.json"), `${JSON.stringify({
    schema_version: 1,
    campaign_id: campaignId,
    status: extra.status ?? "ready_for_table",
    setup_handoff: extra.setup_handoff ?? {
      decision_id: `handoff-${campaignId}`,
      completed_at: "2026-08-22T12:33:04.162349Z",
    },
  })}\n`);
  writeFileSync(path.join(dir, "save", "world-state.json"), `${JSON.stringify({
    status: extra.worldStatus ?? "setup",
    active_subsystem: "setup",
  })}\n`);
}

const prefixRoot = mkdtempSync(path.join(tmpdir(), "pi-coc-setup-prefix-"));
const prefixCampaign = "ready-setup-prefix";
writeReadyTableCampaign(prefixRoot, prefixCampaign);
const setupPrefixResume = {
  mode: "open_turn_recovery",
  campaign_id: prefixCampaign,
  next_operations: ["continue_current_turn_from_receipts"],
  current_turn: {
    meaningful_row_count: 5,
    rows: [
      { tool: "setup.adopt_source_facts", ok: true },
      { tool: "setup.invoke", ok: true },
      { tool: "rules.roll_dice", ok: true },
      { tool: "progressive.opening_bootstrap", ok: true },
      { tool: "setup.complete", ok: true },
    ],
  },
  checkpoint: null,
  pending_output_context: null,
  pending_turn: null,
  delivery: { status: "none", finalization_id: null, rendered_sha256: null },
  scene_context: { turn_number: 0 },
};
const prefixContext = { workspaceRoot: prefixRoot, campaignId: prefixCampaign };
assert.equal(
  mod.playPhaseFromResumeData(setupPrefixResume, prefixContext),
  "opening",
  "setup leftover mutations must not become recovery before table opening",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "session.resume",
    { ok: true, data: setupPrefixResume },
    "opening",
    prefixContext,
  ),
  "opening",
);
assert.equal(
  mod.inferPhaseFromEnvelope(
    "session.resume",
    { ok: true, data: setupPrefixResume },
    "live_turn",
    prefixContext,
  ),
  "opening",
  "world-state setup + ready_for_table still opens the table",
);
const remappedPrefix = mod.remapUnopenedReadyTableResume(
  { ok: true, tool: "session.resume", data: setupPrefixResume },
  prefixContext,
);
assert.equal(remappedPrefix.remapped, true);
assert.equal(remappedPrefix.envelope.data.mode, "table_opening");
assert.deepEqual(
  remappedPrefix.envelope.data.next_operations,
  ["evidence.table_opening"],
);
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_context",
  operation: "evidence.table_opening",
  phase: "opening",
}).ok, true);

const liveRecoveryCampaign = "live-unfinished-turn";
writeReadyTableCampaign(prefixRoot, liveRecoveryCampaign);
writeFileSync(
  path.join(prefixRoot, ".coc", "campaigns", liveRecoveryCampaign, "logs", "table-transcript.jsonl"),
  `${JSON.stringify({ role: "keeper", turn: 1 })}\n`,
);
const liveRecoveryResume = {
  mode: "open_turn_recovery",
  campaign_id: liveRecoveryCampaign,
  next_operations: ["continue_current_turn_from_receipts"],
  current_turn: { rows: [{ tool: "state.journal", ok: true }] },
};
const liveRecoveryContext = {
  workspaceRoot: prefixRoot,
  campaignId: liveRecoveryCampaign,
};
assert.equal(
  mod.playPhaseFromResumeData(liveRecoveryResume, liveRecoveryContext),
  "recovery",
);
assert.equal(
  mod.remapUnopenedReadyTableResume(
    { ok: true, tool: "session.resume", data: liveRecoveryResume },
    liveRecoveryContext,
  ).remapped,
  false,
);

const openedCampaign = "already-opened-table";
writeReadyTableCampaign(prefixRoot, openedCampaign);
writeFileSync(
  path.join(prefixRoot, ".coc", "campaigns", openedCampaign, "logs", "table-transcript.jsonl"),
  `${JSON.stringify({ role: "keeper", turn: 0 })}\n`,
);
const openedResume = {
  mode: "table_opening",
  campaign_id: openedCampaign,
  next_operations: ["evidence.table_opening"],
  current_turn: { rows: [{ tool: "setup.complete", ok: true }] },
};
assert.equal(
  mod.playPhaseFromResumeData(openedResume, {
    workspaceRoot: prefixRoot,
    campaignId: openedCampaign,
  }),
  "live_turn",
  "existing opening receipt must not reopen the table",
);
assert.equal(
  mod.playPhaseFromResumeData({
    ...setupPrefixResume,
    evidence: { table_opening_id: "opening-1" },
  }, prefixContext),
  "recovery",
);
const liveOpeningDenied = mod.evaluateExecuteAcl({
  toolName: "coc_context",
  operation: "evidence.table_opening",
  phase: "live_turn",
});
assert.equal(liveOpeningDenied.ok, false);
assert.equal(liveOpeningDenied.code, "phase_forbidden");

// Recovery may close an already-open turn from receipts; no new mutations.
const recoveryClosure = [
  ["coc_turn", "turn.output_context"],
  ["coc_turn", "state.journal"],
  ["coc_turn", "turn.finalize"],
];
for (const [toolName, operation] of recoveryClosure) {
  const allowed = mod.evaluateExecuteAcl({
    toolName,
    operation,
    phase: "recovery",
  });
  assert.equal(allowed.ok, true, `${operation} @ recovery`);
}
for (const [operation, toolName] of [
  ["rules.roll", "coc_rules"],
  ["rules.social_adjudicate", "coc_rules"],
  ["state.move_scene", "coc_state"],
  ["state.promote_scene", "coc_state"],
  ["state.item_grant", "coc_state"],
  ["state.cash_semantic", "coc_state"],
  ["state.exceptional_effect", "coc_state"],
  ["evidence.table_opening", "coc_context"],
]) {
  const denied = mod.evaluateExecuteAcl({
    toolName,
    operation,
    phase: "recovery",
  });
  assert.equal(denied.ok, false, `${operation} @ recovery`);
  assert.equal(denied.code, "phase_forbidden", `${operation} @ recovery`);
}
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_setup",
  operation: "session.resume",
  phase: "recovery",
}).ok, true);

const recoveryOnly = mod.activeToolsForPhase("recovery");
assert.ok(recoveryOnly.includes("coc_turn"));
assert.ok(!recoveryOnly.includes("coc_rules"));
const freshStartupTools = mod.activeToolsForStartupResumePending({
  workspaceRoot: probeRoot,
  campaignId: "still-fresh",
  fallbackPhase: "opening",
});
assert.ok(freshStartupTools.includes("coc_setup"));
assert.ok(freshStartupTools.includes("coc_rules"));
assert.ok(freshStartupTools.includes("coc_turn"));
assert.ok(freshStartupTools.includes("coc_state"));
assert.ok(mod.domainToolSchema("coc_turn").properties.operation.enum.includes(
  "state.journal",
));
assert.ok(mod.domainToolSchema("coc_turn").properties.operation.enum.includes(
  "turn.finalize",
));

const playedStartupTools = mod.activeToolsForStartupResumePending({
  workspaceRoot: probeRoot,
  campaignId: probeCampaign,
  fallbackPhase: "opening",
});
assert.ok(playedStartupTools.includes("coc_setup"));
assert.ok(playedStartupTools.includes("coc_rules"));
assert.ok(playedStartupTools.includes("coc_npc"));
assert.ok(playedStartupTools.includes("coc_turn"));

const liveFallbackTools = mod.activeToolsForStartupResumePending({
  workspaceRoot: probeRoot,
  campaignId: "still-fresh",
  fallbackPhase: "live_turn",
});
assert.ok(liveFallbackTools.includes("coc_rules"));
assert.ok(liveFallbackTools.includes("coc_setup"));
assert.ok(!recoveryOnly.includes("coc_rules"));
assert.notDeepEqual(liveFallbackTools, recoveryOnly);

const setupStartupTools = mod.activeToolsForStartupResumePending({
  workspaceRoot: probeRoot,
  campaignId: probeCampaign,
  fallbackPhase: "live_turn",
  role: "setup",
});
assert.ok(setupStartupTools.includes("coc_chargen_delegate"));
assert.ok(!setupStartupTools.includes("coc_npc"));
assert.ok(!setupStartupTools.includes("coc_subsystem"));
assert.ok(!setupStartupTools.includes("coc_advice"));
assert.equal(mod.evaluateExecuteAcl({
  toolName: "coc_turn",
  operation: "turn.finalize",
  phase: "live_turn",
}).ok, true);

process.stdout.write(JSON.stringify({ ok: true }));
