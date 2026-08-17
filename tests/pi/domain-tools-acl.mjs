#!/usr/bin/env node
import assert from "node:assert/strict";
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
  operation: "state.move_scene",
  phase: "pending_finalization",
}).ok, false);

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
}).ok, true);

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

process.stdout.write(JSON.stringify({ ok: true }));
