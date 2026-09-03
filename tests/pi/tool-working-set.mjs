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
const roleToolsModule = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/session-role-tools.ts")).href
);
const typedModule = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
);

const catalog = typedModule.defaultTypedToolCatalog();

function toolSchema(name) {
  return {
    type: "object",
    properties: { tool_marker: { type: "string", const: name } },
    additionalProperties: false,
  };
}

function resolvedHostTools(role, additional = []) {
  const names = new Set([
    "coc_discover",
    "subagent",
    "subagent_wait",
    ...roleToolsModule.extraToolsForSessionRole(role),
    ...additional,
  ]);
  return [...names].sort().map((name) => ({ name, parameters: toolSchema(name) }));
}

function snapshot(overrides = {}) {
  const role = overrides.role ?? "play";
  return {
    role,
    phase: "live_turn",
    stage: "acting",
    playerTurnEpoch: 7,
    canonicalProgressRevision: 1,
    roleManifestToolNames: roleToolsModule.extraToolsForSessionRole(role),
    hostTools: resolvedHostTools(role),
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

function schemaBytes(schema) {
  return Buffer.byteLength(JSON.stringify(schema), "utf8");
}

function expectedSchemaBytes(projected, source) {
  const hostByName = new Map(source.hostTools.map((tool) => [tool.name, tool]));
  let total = 0;
  for (const name of projected.activeToolNames) {
    const host = hostByName.get(name);
    if (host) {
      total += schemaBytes(host.parameters);
      continue;
    }
    const typed = catalog.byName.get(name);
    assert.ok(typed, `missing schema for ${name}`);
    total += schemaBytes(typed.parameters);
  }
  return total;
}

test("role-manifest host tools participate in visibility, budgets, and schema bytes", () => {
  for (const role of ["play", "setup"]) {
    const source = snapshot({
      role,
      phase: role === "setup" ? "opening" : "live_turn",
      hostTools: resolvedHostTools(role),
    });
    const projected = workingSet.projectToolWorkingSet(source);
    assertPolicyVisible(projected, source);
    for (const name of roleToolsModule.extraToolsForSessionRole(role)) {
      assert.ok(projected.activeToolNames.includes(name), `${role}:${name}`);
    }
    assert.ok(projected.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);
    assert.equal(projected.schemaBytes, expectedSchemaBytes(projected, source));
    assert.equal(
      projected.schemaBytes,
      projected.hostSchemaBytes + projected.operationSchemaBytes,
    );
  }

  const overBudgetHostTools = resolvedHostTools("play", Array.from(
    { length: workingSet.WORKING_SET_TOOL_BUDGET },
    (_, index) => `host_extra_${index + 1}`,
  ));
  const overflow = workingSet.projectToolWorkingSet(snapshot({
    hostTools: overBudgetHostTools,
  }));
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error.code, "working_set_budget_exceeded");
  assert.deepEqual(overflow.activeToolNames, []);

  const pendingOverflow = workingSet.projectToolWorkingSet(snapshot({
    phase: "pending_finalization",
    affordances: {
      operations: Object.entries(policyModule.OPERATION_POLICY)
        .filter(([operation, policy]) => (
          policy.kp_surface !== "none"
          && policy.phases.includes("pending_finalization")
          && policyModule.sessionRolesForPolicy(operation, policy).includes("play")
          && catalog.byOperation.has(operation)
        ))
        .map(([operation]) => ({ operation, source: "host" })),
    },
  }));
  assert.equal(pendingOverflow.ok, false);
  assert.equal(pendingOverflow.error.details.budget, workingSet.CLOSURE_TOOL_BUDGET);
});

test("cold setup exposes quick-start and retains setup.complete only as an exact affordance", () => {
  const cold = snapshot({
    role: "setup",
    phase: "cold_start",
    hostTools: resolvedHostTools("setup"),
  });
  const coldProjected = workingSet.projectToolWorkingSet(cold);
  assertPolicyVisible(coldProjected, cold);
  assert.ok(coldProjected.activeOperationNames.includes("setup.quick_start"));
  assert.ok(!coldProjected.activeOperationNames.includes("setup.complete"));
  assert.ok(coldProjected.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);

  const opening = snapshot({
    role: "setup",
    phase: "opening",
    hostTools: resolvedHostTools("setup"),
    affordances: {
      operations: [{ operation: "setup.complete", source: "host" }],
    },
  });
  const armed = workingSet.projectToolWorkingSet(opening);
  assertPolicyVisible(armed, opening);
  assert.ok(armed.activeOperationNames.includes("setup.complete"));

  const play = workingSet.projectToolWorkingSet(snapshot({
    role: "play",
    phase: "opening",
    hostTools: resolvedHostTools("play"),
    affordances: opening.affordances,
  }));
  assert.equal(play.ok, true, play.error?.message);
  assert.ok(!play.activeOperationNames.includes("setup.complete"));
});

test("cash and item grants stay long-tail but load with exact play schemas", () => {
  const source = snapshot();
  const baseline = workingSet.projectToolWorkingSet(source);
  assert.equal(baseline.ok, true);
  assert.ok(!baseline.activeOperationNames.includes("state.cash_grant"));
  assert.ok(!baseline.activeOperationNames.includes("state.item_grant"));
  for (const operation of ["state.cash_grant", "state.item_grant"]) {
    const loaded = workingSet.loadToolNamespace(source, {
      kind: "exact_operation",
      operation,
    });
    assert.equal(loaded.ok, true, loaded.message);
    assert.ok(loaded.workingSet.activeOperationNames.includes(operation));
  }
});

test("P0 progress stages share one monotonic capability table", () => {
  const cases = [
    ["awaiting_player", []],
    ["journaled", ["scene.context", "session.resume", "turn.output_context"]],
    ["output_context_ready", ["narration.review", "scene.context", "turn.finalize"]],
    ["review_ready", [
      "narration.review",
      "turn.finalize",
      "turn.output_context",
    ]],
    ["finalized", []],
    ["delivered", []],
  ];
  for (const [stage, expectedOperations] of cases) {
    const source = snapshot({
      phase: stage === "awaiting_player" ? "live_turn" : "pending_finalization",
      stage,
      canonicalProgressRevision: 2,
    });
    const projected = workingSet.projectToolWorkingSet(source);
    assertPolicyVisible(projected, source);
    assert.deepEqual(projected.activeOperationNames, expectedOperations, stage);
    assert.ok(projected.activeToolNames.length <= workingSet.CLOSURE_TOOL_BUDGET, stage);
    if (["awaiting_player", "finalized", "delivered"].includes(stage)) {
      assert.deepEqual(projected.activeToolNames, [], stage);
    }
  }

  const obsoleteParallelStage = workingSet.projectToolWorkingSet(snapshot({
    stage: "output_context",
  }));
  assert.equal(obsoleteParallelStage.ok, false);
  assert.equal(obsoleteParallelStage.error.code, "invalid_snapshot");
});

test("output_context_ready exposes both review and finalize plus exact context refresh", () => {
  const source = snapshot({
    phase: "pending_finalization",
    stage: "output_context_ready",
    canonicalProgressRevision: 3,
  });
  const projected = workingSet.projectToolWorkingSet(source);
  assertPolicyVisible(projected, source);
  for (const operation of ["scene.context", "narration.review", "turn.finalize"]) {
    assert.ok(projected.activeOperationNames.includes(operation), operation);
  }
});

test("live host bindings narrow closure tools without changing the stage table", () => {
  const reviewOnly = snapshot({
    phase: "pending_finalization",
    stage: "output_context_ready",
    canonicalProgressRevision: 4,
    boundOperations: ["narration.review"],
  });
  const reviewProjected = workingSet.projectToolWorkingSet(reviewOnly);
  assertPolicyVisible(reviewProjected, reviewOnly);
  assert.ok(reviewProjected.activeOperationNames.includes("narration.review"));
  assert.ok(!reviewProjected.activeOperationNames.includes("turn.finalize"));

  const finalizeOnly = snapshot({
    phase: "pending_finalization",
    stage: "review_ready",
    canonicalProgressRevision: 5,
    boundOperations: ["turn.finalize"],
  });
  const finalizeProjected = workingSet.projectToolWorkingSet(finalizeOnly);
  assertPolicyVisible(finalizeProjected, finalizeOnly);
  assert.ok(finalizeProjected.activeOperationNames.includes("turn.finalize"));
  assert.ok(!finalizeProjected.activeOperationNames.includes("narration.review"));

  const staleReviewLoad = workingSet.loadToolNamespace(finalizeOnly, {
    kind: "exact_operation",
    operation: "narration.review",
  });
  assert.equal(staleReviewLoad.ok, false);
  assert.equal(staleReviewLoad.code, "stage_forbidden");
});

test("exact long-tail and bounded namespace loads remain provider-neutral", () => {
  const source = snapshot();
  const exact = workingSet.loadToolNamespace(source, {
    kind: "exact_operation",
    operation: "state.purchase",
  });
  assert.equal(exact.ok, true, exact.message);
  assert.ok(exact.workingSet.activeOperationNames.includes("state.purchase"));
  assert.ok(exact.workingSet.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);

  const subsystem = workingSet.loadToolNamespace(source, {
    kind: "namespace",
    namespace: "subsystem",
  });
  assert.equal(subsystem.ok, true, subsystem.message);
  assert.ok(subsystem.grant.operations.length <= workingSet.NAMESPACE_OPERATION_BUDGET);
  assertPolicyVisible(subsystem.workingSet, source);

  const oversized = workingSet.loadToolNamespace(source, {
    kind: "namespace",
    namespace: "state",
  });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.code, "namespace_too_large");
  assert.ok(
    oversized.details.sample_exact_operation_candidates.length
      <= workingSet.NAMESPACE_OPERATION_BUDGET,
  );
});

test("unknown and malformed load requests fail closed at runtime", () => {
  const source = snapshot();
  for (const request of [
    null,
    [],
    { kind: "bogus", namespace: "subsystem" },
    { kind: "exact_operation" },
    { kind: "exact_operation", operation: "state.purchase", extra: true },
    { kind: "namespace" },
    { kind: "namespace", namespace: "subsystem", extra: true },
  ]) {
    const result = workingSet.loadToolNamespace(source, request);
    assert.equal(result.ok, false, JSON.stringify(request));
    assert.ok(
      result.code === "invalid_request" || result.code === "unknown_namespace",
      `${JSON.stringify(request)} => ${result.code}`,
    );
  }
});

test("role, phase, policy, and stage constraints fail closed", () => {
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

  const privateDenied = workingSet.loadToolNamespace(snapshot({ phase: "ending" }), {
    kind: "exact_operation",
    operation: "development.settle",
  });
  assert.equal(privateDenied.ok, false);
  assert.equal(privateDenied.code, "policy_forbidden");

  const stageDenied = workingSet.loadToolNamespace(snapshot({
    phase: "pending_finalization",
    stage: "journaled",
    canonicalProgressRevision: 2,
  }), {
    kind: "exact_operation",
    operation: "state.exceptional_effect",
  });
  assert.equal(stageDenied.ok, false);
  assert.equal(stageDenied.code, "stage_forbidden");
});

test("same-stage canonical progress does not expire a tool visibility grant", () => {
  const source = snapshot();
  const loaded = workingSet.loadToolNamespace(source, {
    kind: "exact_operation",
    operation: "state.purchase",
  });
  assert.equal(loaded.ok, true);

  const progressed = workingSet.projectToolWorkingSet({
    ...source,
    canonicalProgressRevision: source.canonicalProgressRevision + 1,
    loadedOperations: [loaded.grant],
  });
  assert.equal(progressed.ok, true);
  assert.ok(progressed.activeOperationNames.includes("state.purchase"));
  assert.ok(!progressed.reasons.some((reason) => reason.code === "expired_load"));
});

test("grants expire on role, phase, player epoch, or stage changes", () => {
  const source = snapshot();
  const loaded = workingSet.loadToolNamespace(source, {
    kind: "exact_operation",
    operation: "state.purchase",
  });
  assert.equal(loaded.ok, true);

  const changes = [
    {
      role: "setup",
      roleManifestToolNames: roleToolsModule.extraToolsForSessionRole("setup"),
      hostTools: resolvedHostTools("setup"),
    },
    { phase: "opening" },
    { playerTurnEpoch: source.playerTurnEpoch + 1 },
    { stage: "journaled", phase: "pending_finalization" },
  ];
  for (const changed of changes) {
    const projected = workingSet.projectToolWorkingSet({
      ...source,
      ...changed,
      canonicalProgressRevision: source.canonicalProgressRevision + 1,
      loadedOperations: [loaded.grant],
    });
    assert.equal(projected.ok, true, projected.error?.message);
    assert.ok(!projected.activeOperationNames.includes("state.purchase"));
    assert.ok(projected.reasons.some((reason) => reason.code === "expired_load"));
  }
});

test("recovery routes respect closure and exact fault authorization", () => {
  const journaled = workingSet.projectToolWorkingSet(snapshot({
    phase: "pending_finalization",
    stage: "journaled",
    canonicalProgressRevision: 2,
    recoveryRoute: {
      authorization: "stage",
      code: "exceptional_effect_missing",
      operations: ["state.exceptional_effect"],
    },
  }));
  assert.equal(journaled.ok, true);
  assert.ok(!journaled.activeOperationNames.includes("state.exceptional_effect"));
  assert.ok(journaled.reasons.some((reason) => (
    reason.code === "stage_filtered" && reason.operation === "state.exceptional_effect"
  )));

  const faulted = workingSet.projectToolWorkingSet(snapshot({
    phase: "pending_finalization",
    stage: "faulted",
    canonicalProgressRevision: 4,
    recoveryRoute: {
      authorization: "fault",
      code: "finalize_retry_authorized",
      operation: "turn.finalize",
    },
  }));
  assert.equal(faulted.ok, true);
  assert.deepEqual(faulted.activeOperationNames, ["session.resume", "turn.finalize"]);
  assert.deepEqual(
    faulted.activeToolNames,
    ["coc_session_resume", "coc_turn_finalize"],
  );
});

test("missing canonical role tools or host schema definitions invalidate the snapshot", () => {
  const missingRead = workingSet.projectToolWorkingSet(snapshot({
    hostTools: resolvedHostTools("play").filter((tool) => tool.name !== "read"),
  }));
  assert.equal(missingRead.ok, false);
  assert.equal(missingRead.error.code, "invalid_snapshot");
  assert.ok(missingRead.error.details.missing_host_tools.includes("read"));

  const malformed = workingSet.projectToolWorkingSet(snapshot({
    hostTools: [{ name: "read", parameters: null }],
  }));
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, "invalid_snapshot");
});

test("revision is deterministic across affordance and host-definition ordering", () => {
  const hostTools = resolvedHostTools("play");
  const left = workingSet.projectToolWorkingSet(snapshot({
    hostTools,
    affordances: { operations: [
      { operation: "combat.context", source: "combat" },
      { operation: "state.move_scene", source: "scene" },
    ] },
  }));
  const right = workingSet.projectToolWorkingSet(snapshot({
    hostTools: [...hostTools].reverse(),
    affordances: { operations: [
      { operation: "state.move_scene", source: "scene" },
      { operation: "combat.context", source: "combat" },
    ] },
  }));
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.equal(left.revision, right.revision);
  assert.deepEqual(left.activeToolNames, right.activeToolNames);
});

const SHADOW_HEALING = [
  "rules.first_aid",
  "rules.dying_check",
  "rules.medicine",
  "rules.weekly_recovery",
];

const GRAPH_HIDDEN_LEGACY = [
  "rules.roll", "rules.opposed", "rules.push", "rules.luck_spend",
  "rules.social_adjudicate", "rules.psychology_observe",
  "combat.context", "combat.resolve", "combat.end",
  "chase.context", "chase.execute", "rules.sanity_check", "sanity.context",
  "sanity.execute", "magic.cast", "magic.learn", "development.settle",
  "state.end_session",
];

test("normal play acting exposes the two graph rule operations and hides every legacy family", () => {
  const source = snapshot();
  const projected = workingSet.projectToolWorkingSet(source);
  assert.equal(projected.ok, true, projected.error?.message);
  assertPolicyVisible(projected, source);
  assert.deepEqual(
    projected.activeOperationNames.filter((operation) => (
      policyModule.OPERATION_POLICY[operation]?.kp_surface === "rules"
    )),
    ["rules.context", "rules.settle"],
  );
  for (const operation of [...SHADOW_HEALING, ...GRAPH_HIDDEN_LEGACY]) {
    assert.ok(!projected.activeOperationNames.includes(operation), operation);
  }
  assert.ok(projected.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);
  assert.equal(
    projected.schemaBytes,
    projected.hostSchemaBytes + projected.operationSchemaBytes,
  );
});

test("rules-director single-draft profile keeps only focused acting operations", () => {
  const priorProfile = process.env.COC_PI_ACCEPTANCE_PROFILE;
  process.env.COC_PI_ACCEPTANCE_PROFILE = "rules-director-single-draft";
  assert.deepEqual(roleToolsModule.extraToolsForSessionRole("play"), []);
  const source = snapshot({
    acceptanceProfile: "rules-director-single-draft",
    roleManifestToolNames: [],
    hostTools: [],
    affordances: {
      operations: [{ operation: "rules.settle", source: "scene" }],
    },
  });
  const projected = workingSet.projectToolWorkingSet(source);
  assert.equal(projected.ok, true, projected.error?.message);
  assert.deepEqual(projected.activeOperationNames, [
    "actions.list",
    "rules.settle",
    "scene.context",
    "state.journal",
  ]);
  assert.deepEqual(projected.activeToolNames, [
    "coc_actions_list",
    "coc_rules_settle",
    "coc_scene_context",
    "coc_state_journal",
  ]);
  for (const forbidden of [
    "coc_discover", "read", "subagent", "subagent_wait",
    "coc_npc_query", "coc_rules_roll", "coc_source_assets",
  ]) {
    assert.ok(!projected.activeToolNames.includes(forbidden), forbidden);
  }
  const ordinary = workingSet.projectToolWorkingSet(snapshot({
    affordances: {
      operations: [{ operation: "rules.settle", source: "scene" }],
    },
  }));
  assert.equal(ordinary.ok, true, ordinary.error?.message);
  assert.ok(projected.schemaBytes < ordinary.schemaBytes);
  assert.notEqual(projected.revision, ordinary.revision);

  const invalid = workingSet.projectToolWorkingSet({
    ...source,
    acceptanceProfile: "unknown-profile",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid_snapshot");
  process.env.COC_PI_ACCEPTANCE_PROFILE = "unknown-profile";
  assert.deepEqual(
    roleToolsModule.extraToolsForSessionRole("play"),
    ["coc_source_assets", "read"],
  );
  if (priorProfile === undefined) delete process.env.COC_PI_ACCEPTANCE_PROFILE;
  else process.env.COC_PI_ACCEPTANCE_PROFILE = priorProfile;
});

test("rules.context and rules.settle stay on the normal acting baseline across load expiry", () => {
  const source = snapshot();
  const baseline = workingSet.projectToolWorkingSet(source);
  assert.ok(baseline.activeOperationNames.includes("rules.context"));
  assert.ok(baseline.activeOperationNames.includes("rules.settle"));

  const loaded = workingSet.loadToolNamespace(source, {
    kind: "exact_operation",
    operation: "rules.context",
  });
  assert.equal(loaded.ok, true, loaded.message);
  assert.ok(loaded.workingSet.activeOperationNames.includes("rules.context"));
  assert.ok(loaded.workingSet.activeOperationNames.includes("rules.settle"));
  assert.ok(loaded.workingSet.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);

  const namespaceLoad = workingSet.loadToolNamespace(source, {
    kind: "namespace",
    namespace: "context",
  });
  assert.equal(namespaceLoad.ok, false);
  assert.equal(namespaceLoad.code, "namespace_too_large");

  const expired = workingSet.projectToolWorkingSet({
    ...source,
    playerTurnEpoch: source.playerTurnEpoch + 1,
    loadedOperations: [loaded.grant],
  });
  assert.equal(expired.ok, true, expired.error?.message);
  assert.ok(expired.activeOperationNames.includes("rules.context"));
  assert.ok(expired.activeOperationNames.includes("rules.settle"));
  assert.ok(expired.reasons.some((reason) => (
    reason.code === "expired_load" && reason.operation === "rules.context"
  )));
});

test("verified pre-journal open-turn recovery restores the acting surface without closure writes", () => {
  const source = snapshot({
    phase: "recovery",
    stage: "acting",
    recoveryRoute: {
      authorization: "stage",
      code: "open_turn_pre_journal",
      operations: [],
    },
  });
  const projected = workingSet.projectToolWorkingSet(source);
  assert.equal(projected.ok, true, projected.error?.message);
  for (const operation of [
    "scene.context",
    "actions.list",
    "npc.query",
    "state.journal",
  ]) {
    assert.ok(projected.activeOperationNames.includes(operation), operation);
  }
  assert.ok(!projected.activeOperationNames.includes("rules.roll"));
  for (const operation of [
    "turn.output_context",
    "narration.review",
    "turn.finalize",
  ]) {
    assert.ok(!projected.activeOperationNames.includes(operation), operation);
  }
  assert.ok(projected.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);

  for (const operation of ["rules.context", "rules.settle"]) {
    const loaded = workingSet.loadToolNamespace(source, {
      kind: "exact_operation",
      operation,
    });
    assert.equal(loaded.ok, true, loaded.message ?? operation);
    assert.ok(loaded.workingSet.activeOperationNames.includes(operation));
    assert.ok(
      loaded.workingSet.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET,
    );
  }

  const hostPointer = workingSet.loadToolNamespace(source, {
    kind: "exact_operation",
    operation: "session.continuation_detail",
  });
  assert.equal(hostPointer.ok, false);
  assert.equal(hostPointer.code, "policy_forbidden");

  const unverified = workingSet.projectToolWorkingSet(snapshot({
    phase: "recovery",
    stage: "acting",
  }));
  assert.equal(unverified.ok, true, unverified.error?.message);
  assert.deepEqual(unverified.activeOperationNames, ["session.resume"]);
});

test("graph healing legacy ops are not model-loadable", () => {
  const source = snapshot();
  for (const operation of SHADOW_HEALING) {
    const loaded = workingSet.loadToolNamespace(source, {
      kind: "exact_operation",
      operation,
    });
    assert.equal(loaded.ok, false, operation);
    assert.equal(loaded.code, "policy_forbidden", operation);
  }
});

test("graph healing cards preserve the single baseline rules.settle operation", () => {
  const empty = workingSet.affordancesFromHealingCardProjection({
    rule_decision_cards: { cards: [], authority: { hard_gate: false } },
  });
  assert.deepEqual(empty, []);

  const hints = workingSet.affordancesFromHealingCardProjection({
    rule_decision_cards: {
      family: "healing",
      cards: [{ decision_ref: "decision:coc7:healing:first-aid-stabilization" }],
      authority: { hard_gate: false, role: "affordance" },
    },
    recovery: {
      healing: {
        cards: [{ decision_ref: "decision:coc7:healing:first-aid-stabilization" }],
        authority: { hard_gate: false },
      },
    },
  });
  assert.deepEqual(hints, [{ operation: "rules.settle", source: "scene" }]);

  const source = snapshot({
    affordances: { operations: hints },
  });
  const projected = workingSet.projectToolWorkingSet(source);
  assert.equal(projected.ok, true, projected.error?.message);
  assert.ok(projected.activeOperationNames.includes("rules.settle"));
  assert.ok(projected.activeOperationNames.includes("rules.context"));
  assert.ok(projected.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);
  const baseline = workingSet.projectToolWorkingSet(snapshot());
  assert.equal(projected.activeToolNames.length, baseline.activeToolNames.length);
});

test("pending authored SAN trigger stays pending without reopening legacy SAN", () => {
  assert.deepEqual(
    workingSet.affordancesFromSanityTriggerProjection({
      pending_san_triggers: [{
        trigger_id: "see-corbitt-body",
        status: "resolved",
      }],
    }),
    [],
  );
  const pendingProjection = {
    pending_san_triggers: [{
      trigger_id: "see-corbitt-body",
      source: "seeing Walter Corbitt's animated corpse",
      san_loss_success: 1,
      san_loss_fail_expr: "1D8",
      status: "pending",
    }],
  };
  const hints = workingSet.affordancesFromSanityTriggerProjection(pendingProjection);
  assert.deepEqual(hints, []);
  assert.equal(pendingProjection.pending_san_triggers[0].status, "pending");

  const source = snapshot({ affordances: { operations: hints } });
  const projected = workingSet.projectToolWorkingSet(source);
  assert.equal(projected.ok, true, projected.error?.message);
  assert.ok(!projected.activeOperationNames.includes("rules.sanity_check"));
  assert.ok(!projected.activeOperationNames.includes("sanity.execute"));
  const context = workingSet.loadToolNamespace(source, {
    kind: "exact_operation",
    operation: "rules.context",
  });
  assert.equal(context.ok, true, context.message);
  assert.ok(context.workingSet.activeOperationNames.includes("rules.context"));
  assert.ok(projected.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET);
});

test("the clue write the rules make mandatory is on the acting baseline", () => {
  // A clue the player found is not real until `state.record_clue` writes it,
  // so a Keeper that finds one has no choice about calling it. Off the
  // baseline it cost a `coc_discover` round trip first: measured 2026-09-02
  // across six first turns, five spent one on exactly this operation, ~11.8s
  // each, and a discover also changes the active tool interface and forces a
  // replan.
  const source = snapshot({ phase: "live_turn", stage: "acting" });
  const projected = workingSet.projectToolWorkingSet(source);
  assert.equal(projected.ok, true, projected.error?.message);
  assert.ok(
    projected.activeOperationNames.includes("state.record_clue"),
    projected.activeOperationNames,
  );

  // It is the only write there. The rest still loads on demand -- "no fixed
  // pipeline, no quota" -- and the budget keeps its headroom.
  for (const operation of [
    "state.move_scene",
    "state.npc_presence",
    "state.item_grant",
    "sanity.execute",
    "combat.resolve",
  ]) {
    assert.ok(
      !projected.activeOperationNames.includes(operation),
      `${operation} must still be loaded on demand`,
    );
  }
  assert.ok(
    projected.activeToolNames.length <= workingSet.WORKING_SET_TOOL_BUDGET,
    projected.activeToolNames.length,
  );
});
