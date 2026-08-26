#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const workingSet = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/tool-working-set.ts")).href
);
const policyModule = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/operation-policy.ts")).href
);

function snapshot(overrides = {}) {
  return {
    role: "play",
    phase: "live_turn",
    stage: "acting",
    playerTurnEpoch: 7,
    canonicalProgressRevision: "turn-7-acting-1",
    affordances: { operations: [] },
    loadedNamespaces: [],
    loadedOperations: [],
    ...overrides,
  };
}

function assertPolicyVisible(projected, source) {
  assert.equal(projected.ok, true, projected.error?.message);
  for (const operation of projected.activeOperationNames) {
    const policy = policyModule.OPERATION_POLICY[operation];
    assert.ok(policy, operation);
    assert.notEqual(policy.kp_surface, "none", operation);
    assert.ok(policy.phases.includes(source.phase), `${operation} @ ${source.phase}`);
    assert.ok(
      policyModule.sessionRolesForPolicy(operation, policy).includes(source.role),
      `${operation} @ ${source.role}`,
    );
  }
}

test("ordinary and closure working sets respect 20/10 tool budgets", () => {
  const actingSnapshot = snapshot({
    affordances: {
      operations: [
        { operation: "combat.context", source: "combat" },
        { operation: "combat.resolve", source: "combat" },
        { operation: "state.move_scene", source: "scene" },
        { operation: "state.deliver_handout", source: "scene" },
        { operation: "rules.sanity_check", source: "sanity" },
      ],
    },
  });
  const acting = workingSet.projectToolWorkingSet(actingSnapshot);
  assertPolicyVisible(acting, actingSnapshot);
  assert.ok(acting.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);
  for (const hostTool of workingSet.WORKING_SET_HOST_TOOLS) {
    assert.ok(acting.activeToolNames.includes(hostTool), hostTool);
  }

  const closureSnapshot = snapshot({
    phase: "pending_finalization",
    stage: "journaled",
    canonicalProgressRevision: "turn-7-journaled-1",
    affordances: {
      operations: [
        { operation: "state.move_scene", source: "scene" },
        { operation: "rules.roll", source: "turn" },
        { operation: "state.exceptional_effect", source: "turn" },
      ],
    },
  });
  const closure = workingSet.projectToolWorkingSet(closureSnapshot);
  assertPolicyVisible(closure, closureSnapshot);
  assert.ok(closure.activeToolNames.length <= workingSet.CLOSURE_TOOL_BUDGET);
  assert.ok(!closure.activeOperationNames.includes("rules.roll"));
  assert.ok(!closure.activeOperationNames.includes("state.move_scene"));
  assert.ok(closure.activeOperationNames.includes("turn.output_context"));
  assert.ok(!closure.activeOperationNames.includes("turn.finalize"));

  const phaseOnlyClosure = workingSet.projectToolWorkingSet(snapshot({
    phase: "pending_finalization",
    canonicalProgressRevision: "turn-7-pending-1",
  }));
  assertPolicyVisible(phaseOnlyClosure, {
    ...snapshot(),
    phase: "pending_finalization",
  });
  assert.ok(phaseOnlyClosure.activeOperationNames.includes("turn.output_context"));
  assert.ok(!phaseOnlyClosure.activeOperationNames.includes("turn.finalize"));
  assert.ok(phaseOnlyClosure.activeToolNames.length <= workingSet.CLOSURE_TOOL_BUDGET);
});

test("stage projection shrinks after acting and closes after finalization", () => {
  const journaledSnapshot = snapshot({
    stage: "journaled",
    canonicalProgressRevision: "turn-7-journaled-1",
  });
  const journaled = workingSet.projectToolWorkingSet(journaledSnapshot);
  assertPolicyVisible(journaled, journaledSnapshot);
  assert.ok(journaled.activeOperationNames.includes("turn.output_context"));
  assert.ok(!journaled.activeOperationNames.includes("rules.roll"));

  const outputContextSnapshot = snapshot({
    phase: "pending_finalization",
    stage: "output_context",
    canonicalProgressRevision: "turn-7-output-context-1",
  });
  const outputContext = workingSet.projectToolWorkingSet(outputContextSnapshot);
  assertPolicyVisible(outputContext, outputContextSnapshot);
  assert.deepEqual(outputContext.activeOperationNames, ["narration.review"]);

  const reviewSnapshot = snapshot({
    phase: "pending_finalization",
    stage: "review",
    canonicalProgressRevision: "turn-7-review-1",
  });
  const review = workingSet.projectToolWorkingSet(reviewSnapshot);
  assertPolicyVisible(review, reviewSnapshot);
  assert.deepEqual(review.activeOperationNames, ["narration.review", "turn.finalize"]);

  const finalizedSnapshot = snapshot({
    stage: "finalized",
    canonicalProgressRevision: "turn-7-finalized-1",
  });
  const finalized = workingSet.projectToolWorkingSet(finalizedSnapshot);
  assertPolicyVisible(finalized, finalizedSnapshot);
  assert.deepEqual(finalized.activeOperationNames, []);
  assert.deepEqual(finalized.activeToolNames, []);
});

test("exact long-tail operation loads in one provider-neutral step", () => {
  const source = snapshot();
  const loaded = workingSet.loadToolNamespace(source, {
    kind: "exact_operation",
    operation: "state.purchase",
  });
  assert.equal(loaded.ok, true, loaded.message);
  assert.equal(loaded.grant.kind, "exact_operation");
  assert.equal(loaded.grant.operation, "state.purchase");
  assert.ok(loaded.workingSet.activeOperationNames.includes("state.purchase"));
  assert.ok(loaded.workingSet.activeToolNames.includes("coc_state_purchase"));
  assert.ok(loaded.workingSet.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);
});

test("bounded namespace loads at most ten operations and oversized domains fail closed", () => {
  const source = snapshot();
  const subsystem = workingSet.loadToolNamespace(source, {
    kind: "namespace",
    namespace: "subsystem",
  });
  assert.equal(subsystem.ok, true, subsystem.message);
  assert.equal(subsystem.grant.kind, "namespace");
  assert.ok(subsystem.grant.operations.length > 0);
  assert.ok(subsystem.grant.operations.length <= workingSet.NAMESPACE_OPERATION_BUDGET);
  for (const operation of subsystem.grant.operations) {
    assert.ok(subsystem.workingSet.activeOperationNames.includes(operation), operation);
  }

  const state = workingSet.loadToolNamespace(source, {
    kind: "namespace",
    namespace: "state",
  });
  assert.equal(state.ok, false);
  assert.equal(state.code, "namespace_too_large");
  assert.ok(state.details.eligible_operation_count > workingSet.NAMESPACE_OPERATION_BUDGET);
  assert.ok(
    state.details.sample_exact_operation_candidates.length
      <= workingSet.NAMESPACE_OPERATION_BUDGET,
  );
  assert.equal(state.details.request_exact_operation, true);
});

test("budget overflow fails closed instead of silently trimming canonical hints", () => {
  const manyLiveOperations = Object.entries(policyModule.OPERATION_POLICY)
    .filter(([operation, policy]) => (
      policy.kp_surface !== "none"
      && policy.phases.includes("live_turn")
      && policyModule.sessionRolesForPolicy(operation, policy).includes("play")
    ))
    .map(([operation]) => ({ operation, source: "host" }));
  const overflow = workingSet.projectToolWorkingSet(snapshot({
    affordances: { operations: manyLiveOperations },
  }));
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error.code, "working_set_budget_exceeded");
  assert.deepEqual(overflow.activeToolNames, []);
  assert.ok(overflow.error.details.projected_tool_count > workingSet.WORKING_SET_TOOL_BUDGET);
});

test("role, phase, and policy constraints fail closed", () => {
  const roleDenied = workingSet.loadToolNamespace(snapshot(), {
    kind: "exact_operation",
    operation: "setup.complete",
  });
  assert.equal(roleDenied.ok, false);
  assert.equal(roleDenied.code, "role_forbidden");

  const phaseDenied = workingSet.loadToolNamespace(snapshot({ phase: "opening" }), {
    kind: "exact_operation",
    operation: "state.purchase",
  });
  assert.equal(phaseDenied.ok, false);
  assert.equal(phaseDenied.code, "phase_forbidden");

  const stageDenied = workingSet.loadToolNamespace(snapshot({
    stage: "journaled",
    canonicalProgressRevision: "turn-7-journaled-1",
  }), {
    kind: "exact_operation",
    operation: "state.purchase",
  });
  assert.equal(stageDenied.ok, false);
  assert.equal(stageDenied.code, "stage_forbidden");

  const routedMutation = workingSet.projectToolWorkingSet(snapshot({
    phase: "pending_finalization",
    stage: "journaled",
    canonicalProgressRevision: "turn-7-journaled-repair-1",
    recoveryRoute: {
      code: "exceptional_effect_missing",
      operations: ["state.exceptional_effect"],
    },
  }));
  assert.equal(routedMutation.ok, true);
  assert.ok(routedMutation.activeOperationNames.includes("state.exceptional_effect"));

  const privateDenied = workingSet.loadToolNamespace(snapshot({ phase: "ending" }), {
    kind: "exact_operation",
    operation: "development.settle",
  });
  assert.equal(privateDenied.ok, false);
  assert.equal(privateDenied.code, "policy_forbidden");
});

test("revision is deterministic across affordance ordering", () => {
  const left = workingSet.projectToolWorkingSet(snapshot({
    affordances: { operations: [
      { operation: "combat.context", source: "combat" },
      { operation: "state.move_scene", source: "scene" },
    ] },
  }));
  const right = workingSet.projectToolWorkingSet(snapshot({
    affordances: { operations: [
      { operation: "state.move_scene", source: "scene" },
      { operation: "combat.context", source: "combat" },
    ] },
  }));
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.equal(left.revision, right.revision);
  assert.deepEqual(left.activeOperationNames, right.activeOperationNames);
});

test("load grants expire on epoch, stage, or canonical progress change", () => {
  const source = snapshot();
  const loaded = workingSet.loadToolNamespace(source, {
    kind: "exact_operation",
    operation: "state.purchase",
  });
  assert.equal(loaded.ok, true);

  const retained = workingSet.projectToolWorkingSet({
    ...source,
    loadedOperations: [loaded.grant],
  });
  assert.ok(retained.activeOperationNames.includes("state.purchase"));

  for (const changed of [
    { playerTurnEpoch: source.playerTurnEpoch + 1 },
    { stage: "journaled", canonicalProgressRevision: "turn-7-journaled-1" },
    { canonicalProgressRevision: "turn-7-acting-2" },
  ]) {
    const projected = workingSet.projectToolWorkingSet({
      ...source,
      ...changed,
      loadedOperations: [loaded.grant],
    });
    assert.equal(projected.ok, true);
    assert.ok(!projected.activeOperationNames.includes("state.purchase"));
    assert.ok(projected.reasons.some((reason) => reason.code === "expired_load"));
  }
});
