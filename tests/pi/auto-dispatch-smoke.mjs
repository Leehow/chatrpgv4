// Smoke: the Pi main-session gateway auto-drives coordinator dispatch.
// findAutoDispatchTask extracts only the canonical coc_invoke projection path,
// and autoDispatchCoordinator submits it through the shared manager path
// without ever throwing back into the KP's tool result.
import "./_lib/preload-embedded-pi.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

delete process.env.PI_SUBAGENT_CHILD;
delete process.env.COC_PI_SESSION_ROLE;
const root = path.resolve(process.argv[2] || process.cwd());
const extensionWelcomeAgentDir = mkdtempSync(
  path.join(tmpdir(), "pi-coc-extension-welcome-"),
);
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const coordinator = await import(path.join(root, "plugins/coc-keeper/pi/extensions/coordinator.ts"));
const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));
const { findAutoDispatchTask, autoDispatchCoordinator } = main.__test;
const playOpeningGate = () => {
  const Gate = main.OpeningTerminalContinuationGate;
  const gate = new Gate();
  gate.setEffectiveTypedRole("play");
  return gate;
};
const instruction = path.join(root, "plugins/coc-keeper/agents/coc-source-coordinator.md");
const leafInstruction = path.join(root, "plugins/coc-keeper/agents/coc-source-pack-worker.md");
const sectionBindingFixture = JSON.parse(readFileSync(
  path.join(
    root,
    "tests/pi/fixtures/cold-harvest-classify-sections-empty-entity.json",
  ),
  "utf8",
));
const sectionClassificationFixture = JSON.parse(readFileSync(
  path.join(
    root,
    "tests/pi/fixtures/section-classification-discrimination.json",
  ),
  "utf8",
));
const problems = [];
const safeCharacterSetupPrompt = (
  "建卡尚未完成。请按 coc-character 流程立即推进，不要再次向玩家索要职业、特征或技能确认："
  + "若本轮尚未取得当前战役的 setup.investigator_contract，则先调用它以获得 payload_schema；"
  + "若已取得当前 contract，则直接使用其 payload_schema、玩家已选择的预设与守秘 L0 资料调用 "
  + "setup.invoke（kind: investigator.create）创建调查员。不得猜测字段或预设数值；创建后继续按保留路由链接调查员。"
);

function check(label, condition) {
  if (!condition) problems.push(label);
}

function replacementIs(decision, expected) {
  return (
    decision !== null
    && typeof decision === "object"
    && decision.replacementText === expected
  );
}

function coordinatorTask(packetId = "coord-auto-1", {
  campaignId = "auto-dispatch-fixture",
  assetRootId = "asset-auto",
  executorId = "pi:fixture",
} = {}) {
  return {
    schema_version: 1, contract_id: "coc.pi-source-coordinator-task.v1",
    instruction_ref: instruction, model_policy: "inherit_parent",
    packet: {
      schema_version: 1, contract_id: "coc.source-coordinator.v1", packet_id: packetId,
      workspace_root: root, campaign_id: campaignId, asset_root_id: assetRootId, max_leaves: 2,
      claim_operation: { operation: "progressive.claim_host_work", prefilled_arguments: { executor_id: executorId, limit: 2, result_delivery: "task_return_to_parent", max_dispatch_attempts: 2 } },
      fulfill_operation: { operation: "progressive.fulfill_host_work" },
      failure_policy: {
        same_task_retry: true,
        automatic_retry: {
          retryable_failure_classes: ["fulfill_rejected"],
          require_status: "failed",
          require_positive_claimed: true,
          require_zero_fulfilled: true,
          max_attempts: 2,
        },
      },
    },
  };
}

function sectionFixtureLeafTask(
  packetId = "section-repair-packet",
  jobId = "section-repair-job",
  entityCatalog = [],
) {
  return {
    schema_version: 1,
    contract_id: "coc.pi-source-pack-task.v1",
    instruction_ref: leafInstruction,
    model_policy: "inherit_parent",
    packet: {
      schema_version: 1,
      contract_id: "coc.source-pack-worker.v1",
      packet_id: packetId,
      work_group_id: `${packetId}-group`,
      requests: [{
        job_id: jobId,
        kind: "classify_sections",
        classification_request: {
          contract_id: "coc.section-index.v1",
          entity_catalog: entityCatalog,
        },
      }],
    },
  };
}

function sectionFixtureWorkerResult(task, pack) {
  return {
    schema_version: 1,
    contract_id: "coc.source-pack-worker.v1",
    packet_id: task.packet.packet_id,
    work_group_id: task.packet.work_group_id,
    status: "usable",
    results: [{
      job_id: task.packet.requests[0].job_id,
      pack,
      related_packs: [],
    }],
  };
}

function sectionFixtureSuccess(result) {
  return { kind: "success", result };
}

function sectionFixtureLeaseResponse(args, jobId) {
  if (args.operation === "progressive.release_host_work_leases") {
    return { data: { released_job_ids: [jobId], skipped_job_ids: [] } };
  }
  if (args.operation === "progressive.renew_host_work_leases") {
    return { data: { renewed_job_ids: [jobId], skipped_job_ids: [] } };
  }
  return null;
}

async function runSectionClassificationLifecycle(label, leaf, results) {
  const spawns = [];
  const fulfills = [];
  const repairDiagnostics = [];
  const receipt = await runtime.runCoordinatorLifecycle(
    coordinatorTask(`coord-${label}`),
    {
      call: async (_name, args) => {
        if (args.operation === "progressive.claim_host_work") {
          return { data: {
            dispatch_tasks: [leaf],
            lease_bindings: [{
              lease_id: leaf.packet.packet_id,
              job_ids: [leaf.packet.requests[0].job_id],
            }],
          } };
        }
        if (args.operation === "progressive.fulfill_host_work") {
          fulfills.push(args.arguments.worker_result);
          return { data: { accepted: true } };
        }
        const lease = sectionFixtureLeaseResponse(
          args,
          leaf.packet.requests[0].job_id,
        );
        if (lease) return lease;
        throw new Error(`unexpected ${label} operation ${args.operation}`);
      },
      onSourcePackRepairDiagnostic: (diagnostic) => {
        repairDiagnostics.push(diagnostic);
      },
      spawnLeaf: async (task) => {
        spawns.push(task);
        return sectionFixtureSuccess(results[spawns.length - 1]);
      },
    },
  );
  return { receipt, spawns, fulfills, repairDiagnostics };
}

function takeover(task) {
  return {
    schema_version: 1, kind: "ready_background_source_work",
    dispatch_mode: "coordinator_fanout", host_adapter: "pi",
    next_host_action: {
      schema_version: 1, action: "invoke_coc_dispatch_source_work",
      task, parent_waits: false,
    },
  };
}

function directTakeoverResult(task) {
  return {
    ok: true, tool: "progressive.prepare_session",
    data: { background_takeover: takeover(task) },
  };
}

function openingBootstrapResult(task) {
  return {
    ok: true, tool: "progressive.opening_bootstrap",
    data: {
      status: "queued",
      asset_root_id: task.packet.asset_root_id,
      source_file_sha256: "a".repeat(64),
      start_location: {
        location_id: "opening",
        title: "Opening",
      },
      opening_pdf_indices: [0],
      source_work: {
        status: "queued",
        background_takeover: takeover(task),
      },
    },
  };
}

function openingBootstrapWithoutTakeover(task, status = "queued") {
  const value = openingBootstrapResult(task);
  value.data.status = status;
  value.data.source_work = {
    status,
    job_id: `job-${task.packet.packet_id}`,
    work_level: "current_dependency",
  };
  return value;
}

function openingSetupGate(nextOperation = {
  operation: "progressive.prepare_opening",
  invoke_via: "coc_invoke",
  prefilled_arguments: {},
  missing_arguments: [],
  hard_gate: true,
  authority: "canonical_setup",
}, campaignId = "auto-dispatch-fixture") {
  return {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_selection",
    campaign_id: campaignId,
    asset_root_id: "asset-fixture",
    next_operation: nextOperation,
    instruction: "invoke the exact retained opening setup card",
  };
}

function boundOpeningSetupResult(campaignId = "auto-dispatch-fixture") {
  const gate = openingSetupGate(undefined, campaignId);
  return {
    ok: true,
    tool: "setup.invoke",
    data: {
      status: "PASS",
      opening_gate: gate,
      next_operation: gate.next_operation,
    },
  };
}

function preparedOpeningSetupResult() {
  return {
    ok: true,
    tool: "progressive.prepare_opening",
    data: {
      status: "blocked",
      next_operation: {
        operation: "progressive.opening_bootstrap",
        invoke_via: "coc_invoke",
        prefilled_arguments: {},
        missing_arguments: ["start_location", "opening_pdf_indices"],
        hard_gate: true,
        authority: "canonical_setup",
      },
    },
  };
}

function staleCharacterSetupResult(kind) {
  const gate = openingSetupGate();
  return {
    ok: true,
    tool: "setup.invoke",
    data: {
      status: "PASS",
      result: { kind },
      opening_gate: gate,
      next_operation: gate.next_operation,
    },
  };
}

function canonicalLinkSetupResult(
  campaignId,
  investigatorIds,
  overrides = {},
) {
  return {
    ok: true,
    tool: "setup.invoke",
    data: {
      schema_version: 1,
      status: "PASS",
      kind: "campaign.link_investigator",
      result: {
        campaign_id: campaignId,
        investigator_ids: investigatorIds,
      },
      ...overrides,
    },
  };
}

// The Quick-Fire create must quote the canonical Luck receipt: its `roll_id`
// is the semantic form the roll returned, never machine-attached identity
// material (a `toolbox-` namespace is refused as opaque_identity_grammar,
// because the model never authors one). `luck` accepts a live rules.roll_dice
// result so a fixture that actually rolls binds to that exact receipt.
function guidedQuickFireCreateParams(campaignId, investigatorId, luck = null) {
  const luckDecisionId = luck?.decision_id ?? `luck-${investigatorId}`;
  const luckRollId = luck?.roll_id ?? "roll:3d6";
  const luckTotal = Number.isInteger(luck?.total) ? luck.total : 12;
  return {
    operation: "setup.invoke",
    campaign: campaignId,
    arguments: {
      kind: "investigator.create",
      payload: {
        campaign_id: campaignId,
        investigator_id: investigatorId,
        sheet: { id: investigatorId, name: `Investigator ${investigatorId}` },
        creation: {
          input_mode: "guided_quick_fire",
          method: "quick_fire_array",
          characteristic_assignment_order: [
            "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR",
          ],
          luck_roll_total: luckTotal,
          luck_roll_receipt: {
            campaign_id: campaignId,
            decision_id: luckDecisionId,
            roll_id: luckRollId,
          },
        },
      },
    },
  };
}

function canonicalGuidedCreateResult(investigatorId, overrides = {}) {
  return {
    ok: true,
    tool: "setup.invoke",
    data: {
      schema_version: 1,
      status: "PASS",
      kind: "investigator.create",
      result: { investigator_id: investigatorId },
      ...overrides,
    },
  };
}

function observeCanonicalGuidedCreate(
  gate,
  campaignId,
  investigatorId,
  invocationId,
  result = canonicalGuidedCreateResult(investigatorId),
) {
  const params = guidedQuickFireCreateParams(campaignId, investigatorId);
  const admissionError = gate.openingSetupToolError(
    "coc_invoke",
    params,
    invocationId,
  );
  if (admissionError !== null) {
    throw new Error(`guided create was not admitted: ${admissionError}`);
  }
  return gate.observeOpeningSetupInvocation(
    "setup.invoke",
    params,
    result,
    invocationId,
  );
}

function observeOwnedOpeningInvocation(gate, invocationId, params, value) {
  const admissionError = gate.openingSetupToolError(
    "coc_invoke",
    params,
    invocationId,
  );
  if (admissionError !== null) {
    throw new Error(`opening invocation was not admitted: ${admissionError}`);
  }
  gate.observeOpeningSetupInvocation(
    String(params.operation),
    params,
    value,
    invocationId,
  );
}

function bindOpeningRoute(gate, campaignId, invocationId) {
  const params = {
    operation: "setup.invoke",
    campaign: campaignId,
    arguments: {
      kind: "scenario.bind_pdf",
      payload: {
        campaign_id: campaignId,
        scenario_id: `scenario-${campaignId}`,
        title: `Scenario ${campaignId}`,
        source_bundle_path: `/fixture/${campaignId}/source-bundle`,
      },
    },
  };
  observeOwnedOpeningInvocation(
    gate,
    invocationId,
    params,
    boundOpeningSetupResult(campaignId),
  );
}

function bindReviewedCharacterRoute(
  gate,
  campaignId,
  invocationPrefix,
  bindBriefing = null,
) {
  const params = {
    operation: "setup.invoke",
    campaign: campaignId,
    arguments: {
      kind: "scenario.bind_pdf",
      payload: {
        campaign_id: campaignId,
        scenario_id: `scenario-${campaignId}`,
        title: `Scenario ${campaignId}`,
        source_bundle_path: `/fixture/${campaignId}/source-bundle`,
      },
    },
  };
  const invocationId = `${invocationPrefix}-bind`;
  const admissionError = gate.openingSetupToolError(
    "coc_invoke",
    params,
    invocationId,
  );
  if (admissionError !== null) {
    throw new Error(`reviewed-source bind was not admitted: ${admissionError}`);
  }
  gate.observeOpeningSetupInvocation(
    "setup.invoke",
    params,
    {
      ok: true,
      tool: "setup.invoke",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "scenario.bind_pdf",
        result: { campaign_id: campaignId },
        opening_gate: {
          schema_version: 1,
          status: "blocked",
          hard_gate: true,
          activation_allowed: false,
          phase: "opening_source_review_required",
          campaign_id: campaignId,
          scenario_id: `scenario-${campaignId}`,
          source_provenance: "selection_hint_only_not_provenance",
          required_source_owner: "coc-opening-source-coordinator",
          character_setup_complete: false,
          next_operation: null,
          instruction: "review the bound source before character setup",
        },
      },
    },
    invocationId,
    bindBriefing,
  );
  const sourceRefs = [{ source_id: `pdf:${campaignId}`, pdf_index: 0 }];
  const source = (value) => ({ status: "source", value, source_refs: sourceRefs });
  const route = gate.observeOpeningSourceReviewTransport({
    schema_version: 1,
    contract_id: "coc.pi-opening-source-review-transport-result.v1",
    status: "reviewed",
    campaign_id: campaignId,
    scenario_id: `scenario-${campaignId}`,
    opening_review_generation: 1,
    failure_class: null,
    facts: {
      schema_version: 1,
      contract_id: "coc.opening-fast-facts.v1",
      era: source("1920s"),
      place: source("Fixture place"),
      investigator_hook: source("Fixture hook"),
      investigator_constraints: source("Fixture constraints"),
      player_safe_summary: source("Fixture player-safe summary"),
      content_flags: source(["mystery"]),
    },
  });
  if (route?.phase !== "opening_character_setup_required") {
    throw new Error("reviewed source did not retain the character setup route");
  }
  return route;
}

function prepareOpeningRoute(gate, campaignId, invocationId) {
  const params = {
    operation: "progressive.prepare_opening",
    campaign: campaignId,
    arguments: {},
  };
  observeOwnedOpeningInvocation(
    gate,
    invocationId,
    params,
    preparedOpeningSetupResult(),
  );
}

function bootstrapOpeningParams(campaignId) {
  return {
    operation: "progressive.opening_bootstrap",
    campaign: campaignId,
    arguments: {
      start_location: { location_id: "location:opening", title: "Opening" },
      opening_pdf_indices: [0],
    },
  };
}

function beginBackgroundOpeningRoute(
  gate,
  campaignId,
  prefix,
  bindBriefing = null,
) {
  if (bindBriefing === null) {
    bindOpeningRoute(gate, campaignId, `${prefix}-bind`);
  } else {
    const bindParams = {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: {
        kind: "scenario.bind_pdf",
        payload: {
          campaign_id: campaignId,
          scenario_id: `scenario-${campaignId}`,
          title: `Scenario ${campaignId}`,
          source_bundle_path: `/fixture/${campaignId}/source-bundle`,
        },
      },
    };
    const bindInvocationId = `${prefix}-bind`;
    const bindError = gate.openingSetupToolError(
      "coc_invoke",
      bindParams,
      bindInvocationId,
    );
    if (bindError !== null) {
      throw new Error(`opening bind was not admitted: ${bindError}`);
    }
    gate.observeOpeningSetupInvocation(
      "setup.invoke",
      bindParams,
      boundOpeningSetupResult(campaignId),
      bindInvocationId,
      bindBriefing,
    );
  }
  prepareOpeningRoute(gate, campaignId, `${prefix}-prepare`);
  const params = bootstrapOpeningParams(campaignId);
  const task = coordinatorTask(`${prefix}-task`, { campaignId });
  const invocationId = `${prefix}-bootstrap`;
  const admissionError = gate.openingSetupToolError(
    "coc_invoke",
    params,
    invocationId,
  );
  if (admissionError !== null) {
    throw new Error(`opening bootstrap was not admitted: ${admissionError}`);
  }
  const observed = gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    params,
    openingBootstrapResult(task),
    invocationId,
  );
  if (
    !observed.dispatchAllowed
    || !gate.beginOpeningBackground(
      invocationId,
      params,
      task.packet.packet_id,
      {
        operation: "progressive.project_opening",
        campaign: campaignId,
        arguments: {
          asset_root_id: task.packet.asset_root_id,
          source_file_sha256: "a".repeat(64),
          start_location_id: "opening",
          opening_pdf_indices: [0],
        },
      },
    )
    || gate.markOpeningBackgroundSubmitted(
      invocationId,
      params,
      task.packet.packet_id,
    ).status !== "submitted"
  ) {
    throw new Error("opening background phase did not start");
  }
  return { params, task, invocationId };
}

function beginBackgroundAfterCharacterRoute(gate, campaignId, prefix) {
  prepareOpeningRoute(gate, campaignId, `${prefix}-prepare`);
  const params = bootstrapOpeningParams(campaignId);
  const task = coordinatorTask(`${prefix}-task`, { campaignId });
  const invocationId = `${prefix}-bootstrap`;
  const admissionError = gate.openingSetupToolError(
    "coc_invoke",
    params,
    invocationId,
  );
  if (admissionError !== null) {
    throw new Error(`opening bootstrap was not admitted: ${admissionError}`);
  }
  const observed = gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    params,
    openingBootstrapResult(task),
    invocationId,
  );
  if (
    !observed.dispatchAllowed
    || !gate.beginOpeningBackground(
      invocationId,
      params,
      task.packet.packet_id,
      {
        operation: "progressive.project_opening",
        campaign: campaignId,
        arguments: {
          asset_root_id: task.packet.asset_root_id,
          source_file_sha256: "a".repeat(64),
          start_location_id: "opening",
          opening_pdf_indices: [0],
        },
      },
    )
    || gate.markOpeningBackgroundSubmitted(
      invocationId,
      params,
      task.packet.packet_id,
    ).status !== "submitted"
  ) {
    throw new Error("opening background phase did not start after character link");
  }
  return { params, task, invocationId };
}

function deferredValue() {
  let resolveValue;
  const promise = new Promise((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}

async function armOpeningBootstrapRoute(
  harness,
  campaignId = "auto-dispatch-fixture",
) {
  await harness.registered.get("coc_invoke").execute(
    `arm-source-bind-${campaignId}`,
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: {
        kind: "scenario.bind_pdf",
        payload: {
          campaign_id: campaignId,
          scenario_id: "fixture-scenario",
          title: "Fixture Scenario",
          source_bundle_path: "/fixture/source-bundle",
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  await harness.registered.get("coc_invoke").execute(
    `arm-opening-prepare-${campaignId}`,
    {
      operation: "progressive.prepare_opening",
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
}

function sceneContextResult(task) {
  return {
    ok: true, tool: "scene.context",
    data: {
      scene: { scene_id: "scene-auto" },
      progressive: {
        status: "active",
        background_takeover: takeover(task),
      },
    },
  };
}

function sessionResumeResult(task) {
  return {
    ok: true, tool: "session.resume",
    data: {
      mode: "resumed",
      scene_context: {
        scene: { scene_id: "scene-resumed" },
        progressive: {
          status: "active",
          background_takeover: takeover(task),
        },
      },
    },
  };
}

function sectionSemanticWork(task, jobId = `job-${task.packet.packet_id}`) {
  return {
    job_id: jobId,
    kind: "classify_sections",
    target_id: "section-index",
    requested_pdf_indices: [0],
    dispatch_state: "ready",
    dispatch_attempts: 0,
  };
}

function sourceBoundMissingSceneContext(
  task,
  { campaignId = task.packet.campaign_id, sceneId = "source-gap" } = {},
) {
  return {
    ok: true,
    tool: "scene.context",
    data: {
      campaign_id: campaignId,
      active_scene_id: sceneId,
      scene: {
        scene_id: sceneId,
        parse_state: "named_only",
        evidence_gap: true,
        source_context_mentions: [{ kind: "location", ref_id: "source-location" }],
      },
      progressive: {
        asset_root_id: task.packet.asset_root_id,
        ready_background_requests: [sectionSemanticWork(task)],
        background_takeover: takeover(task),
      },
    },
  };
}

function sourceBoundMissingSessionResume(task) {
  const context = sourceBoundMissingSceneContext(task);
  return {
    ok: true,
    tool: "session.resume",
    data: {
      campaign_id: task.packet.campaign_id,
      mode: "awaiting_player",
      scene_context: context.data,
    },
  };
}

function sourceBoundReadySceneContext(
  campaignId,
  sceneId = "source-ready",
) {
  return {
    ok: true,
    tool: "scene.context",
    data: {
      campaign_id: campaignId,
      active_scene_id: sceneId,
      scene: {
        scene_id: sceneId,
        parse_state: "body_parsed",
        evidence_gap: false,
      },
      source_material: {
        keeper_only: true,
        authority: "source_authored_context",
      },
      progressive: { asset_root_id: "asset-ready" },
    },
  };
}

function sourceBoundMoveResult(
  campaignId,
  sceneId = "source-gap",
) {
  return {
    ok: true,
    tool: "state.move_scene",
    data: {
      campaign_id: campaignId,
      to_scene_id: sceneId,
      scene: {
        parse_state: "named_only",
        evidence_gap: true,
        source_context_mentions: [{ kind: "location", ref_id: "source-location" }],
      },
      progressive: { asset_root_id: "asset-scene-priority" },
      next_operation: {
        operation: "scene.context",
        invoke_via: "coc_invoke",
        prefilled_arguments: {},
        missing_arguments: [],
        hard_gate: false,
      },
    },
  };
}

function sectionSemanticStatusResult(task, { fulfilled = false } = {}) {
  return {
    ok: true,
    tool: "progressive.status",
    data: {
      campaign_id: task.packet.campaign_id,
      progressive: true,
      asset_root_id: task.packet.asset_root_id,
      host_work: { requests: fulfilled ? [] : [sectionSemanticWork(task)] },
      ...(fulfilled ? {} : { background_takeover: takeover(task) }),
    },
  };
}

function coordinatorReceipt(packetId) {
  return {
    schema_version: 1,
    contract_id: "coc.source-coordinator-result.v1",
    packet_id: packetId,
    status: "idle",
    claim_calls: 1,
    claimed_packet_count: 0,
    leaf_task_count: 0,
    fulfilled_result_count: 0,
    failure_class: null,
    design_issue_threshold: 3,
  };
}

function coordinatorEvents(packetId) {
  const receipt = coordinatorReceipt(packetId);
  return coordinatorEventsForReceipt(receipt);
}

function fulfilledCoordinatorEvents(packetId) {
  return coordinatorEventsForReceipt({
    ...coordinatorReceipt(packetId),
    status: "fulfilled",
    claimed_packet_count: 1,
    leaf_task_count: 1,
    fulfilled_result_count: 1,
  });
}

function coordinatorEventsForReceipt(receipt, privateRepairDiagnostics = undefined) {
  const packetId = receipt.packet_id;
  const toolCallId = `call-${packetId}`;
  const wireReceipt = privateRepairDiagnostics === undefined
    ? receipt
    : {
      ...receipt,
      pi_private_repair_diagnostics: privateRepairDiagnostics,
    };
  return [
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{
          type: "toolCall", id: toolCallId,
          name: "coc_run_source_coordinator", arguments: {},
        }],
      },
    },
    {
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "coc_run_source_coordinator",
        content: [{ type: "text", text: JSON.stringify(wireReceipt) }],
        details: wireReceipt,
        isError: false,
      },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: JSON.stringify(wireReceipt) }],
      },
    },
  ];
}

function failedCoordinatorEvents(
  packetId,
  failureClass = "fulfill_rejected",
  diagnostics = undefined,
) {
  const receipt = {
    ...coordinatorReceipt(packetId),
    status: "failed",
    claimed_packet_count: 1,
    leaf_task_count: 1,
    failure_class: failureClass,
    ...(diagnostics ? { diagnostics } : {}),
  };
  const toolCallId = `call-${packetId}`;
  return [
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{
          type: "toolCall", id: toolCallId,
          name: "coc_run_source_coordinator", arguments: {},
        }],
      },
    },
    {
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "coc_run_source_coordinator",
        content: [{ type: "text", text: JSON.stringify(receipt) }],
        details: receipt,
        isError: false,
      },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: JSON.stringify(receipt) }],
      },
    },
  ];
}
const failedFulfillEvents = (packetId) => failedCoordinatorEvents(packetId);

function harness({ enabled = true, manager = null, failSubmit = false } = {}) {
  const audit = [];
  const submits = [];
  const fakeManager = manager || {
    state: () => undefined,
    activeCount: () => 0,
    submit: async (task, launch) => {
      if (failSubmit) throw new Error("one Pi source coordinator is already active");
      submits.push({ task, launch });
      return { status: "submitted", dispatch_key: task.packet.packet_id, role: "coordinator" };
    },
  };
  const deps = {
    enabled: async () => enabled,
    isCurrent: () => true,
    activeManager: () => fakeManager,
    manager: () => fakeManager,
    launchContext: () => ({ cwd: root, provider: "offline", modelId: "offline", thinking: "off" }),
    audit: (entry) => audit.push(entry),
  };
  return { deps, audit, submits };
}

function realManagerHarness({ deferActivationKeys = [] } = {}) {
  const deferredActivation = new Set(deferActivationKeys);
  const launches = [];
  const controls = new Map();
  const controlsByKey = new Map();
  const lifecycle = [];
  const notifications = [];
  const manager = new coordinator.CoordinatorDispatchManager(
    (task) => {
      const key = task.packet.packet_id;
      launches.push(key);
      let resolveActivation, rejectActivation, resolveCompletion, rejectCompletion;
      const activation = deferredActivation.has(key)
        ? new Promise((resolve, reject) => {
          resolveActivation = resolve;
          rejectActivation = reject;
        })
        : Promise.resolve({ type: "agent_start" });
      const control = {
        completion: new Promise((resolve, reject) => {
          resolveCompletion = resolve;
          rejectCompletion = reject;
        }),
        activate: () => resolveActivation?.({ type: "agent_start" }),
        rejectActivation: () => rejectActivation?.(new Error("raw activation failure")),
        resolve: (events = coordinatorEvents(key)) => resolveCompletion(events),
        reject: () => rejectCompletion(new Error("raw completion failure")),
        terminated: false,
      };
      controls.set(key, control);
      const priorControls = controlsByKey.get(key) || [];
      priorControls.push(control);
      controlsByKey.set(key, priorControls);
      return {
        child: {},
        activation,
        completion: control.completion,
        terminate: async () => { control.terminated = true; },
      };
    },
    (receipt) => {
      notifications.push(receipt.packet_id);
      return { status: "delivered" };
    },
    (observation) => lifecycle.push(observation),
  );
  return {
    ...harness({ manager }),
    manager,
    launches,
    controls,
    controlsByKey,
    lifecycle,
    notifications,
  };
}

// A host-control message is a JSON document whose `instruction` embeds the
// exact registered tool call as an escaped JSON string, so a raw substring
// search for `"campaign":"..."` misses it by one level of escaping. Read the
// instruction after parsing, and fall back to the raw text for the messages
// that are not documents.
function messageDeclares(content, fragment) {
  const text = String(content ?? "");
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.instruction === "string") {
      return parsed.instruction.includes(fragment) || text.includes(fragment);
    }
  } catch { /* not a document; fall through to the raw text */ }
  return text.includes(fragment);
}

async function nextTurn() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mainExtensionHarness(responseForCall, options = {}) {
  const registered = new Map();
  const handlers = new Map();
  const appended = [];
  const sent = [];
  const sendAttempts = [];
  const calls = [];
  const launches = [];
  const controls = new Map();
  const sendFailuresByType = new Map(
    Object.entries(options.sendFailuresByType ?? {}),
  );
  const activationFailuresByKey = new Map(
    Object.entries(options.activationFailuresByKey ?? {}),
  );
  const fakePi = {
    registerTool: (tool) => registered.set(tool.name, tool),
    registerCommand: () => {},
    registerShortcut: () => {},
    on: (name, handler) => {
      const values = handlers.get(name) || [];
      values.push(handler);
      handlers.set(name, values);
    },
    appendEntry: (name, value) => appended.push({ name, value }),
    sendMessage: (message, sendOptions) => {
      const customType = String(message?.customType ?? "");
      sendAttempts.push({ customType, message, options: sendOptions });
      const remaining = Number(sendFailuresByType.get(customType) ?? 0);
      if (remaining > 0) {
        sendFailuresByType.set(customType, remaining - 1);
        throw new Error(`injected send failure: ${customType}`);
      }
      sent.push({ message, options: sendOptions });
    },
    setActiveTools: () => {},
    getThinkingLevel: () => "off",
  };
  const fakeClient = {
    callTool: async (name, params) => {
      if (
        name === "coc_capabilities"
        && options.recordCapabilities !== true
      ) {
        return { ok: true, host: "pi" };
      }
      calls.push({ name, params });
      // The host re-arms asynchronous memory extraction once after a startup
      // resume. It is host bookkeeping, not part of any case under test, so
      // answer it centrally unless a case wants to see it.
      if (
        params?.operation === "memory.extraction_status"
        && options.recordMemoryStatus !== true
      ) {
        return {
          ok: true,
          tool: "memory.extraction_status",
          data: { schema_version: 1, pending: [], status: "idle" },
        };
      }
      return responseForCall(name, params);
    },
    callToolWithTransportMeta: async (name, params) => ({
      value: await fakeClient.callTool(name, params),
      transport: null,
    }),
    close: async () => {},
  };
  const previousSessionRole = process.env.COC_PI_SESSION_ROLE;
  if (options.sessionRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
  else process.env.COC_PI_SESSION_ROLE = options.sessionRole;
  try {
    main.default(fakePi, {
      coordinatorEnabled: options.coordinatorEnabled ?? (async () => true),
      createClient: () => fakeClient,
      startupCampaignId: () => options.startupCampaignId ?? null,
      welcomeAgentDir: extensionWelcomeAgentDir,
      launchCoordinator: (task) => {
      const key = task.packet.packet_id;
      launches.push(key);
      const activationFailures = Number(
        activationFailuresByKey.get(key) ?? 0,
      );
      if (activationFailures > 0) {
        activationFailuresByKey.set(key, activationFailures - 1);
        return {
          child: {},
          activation: Promise.reject(
            new Error(`injected activation failure: ${key}`),
          ),
          completion: new Promise(() => {}),
          terminate: async () => {},
        };
      }
      if (options.immediateCoordinatorEvents !== undefined) {
        const events = typeof options.immediateCoordinatorEvents === "function"
          ? options.immediateCoordinatorEvents(task)
          : options.immediateCoordinatorEvents;
        return {
          child: {},
          activation: Promise.resolve({ type: "agent_start" }),
          completion: Promise.resolve(events),
          terminate: async () => {},
        };
      }
      let resolveCompletion;
      let rejectCompletion;
      const completion = new Promise((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });
      const control = {
        resolve: (events) => resolveCompletion(events),
        reject: () => rejectCompletion(new Error("raw child failure")),
        terminated: false,
      };
      controls.set(key, control);
      return {
        child: {},
        activation: Promise.resolve({ type: "agent_start" }),
        completion,
        terminate: async () => { control.terminated = true; },
      };
      },
    });
  } finally {
    if (previousSessionRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousSessionRole;
  }
  const ctx = {
    cwd: root,
    mode: options.mode ?? "rpc",
    model: { provider: "offline", id: "offline" },
    sessionManager: {
      getSessionId: () => options.sessionId ?? "blocking-opening-extension",
      getEntries: () => options.entries ?? [],
    },
    hasUI: options.hasUI ?? false,
    ui: {
      setHeader: () => {},
      setStatus: () => {},
      setFooter: () => {},
      setWidget: () => {},
      notify: () => {},
    },
  };
  return {
    registered,
    handlers,
    appended,
    sent,
    sendAttempts,
    calls,
    launches,
    controls,
    ctx,
    async start() {
      await handlers.get("session_start").at(-1)(
        { reason: "startup" },
        ctx,
      );
      for (const handler of handlers.get("agent_start") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
    async startAll(reason = "startup") {
      const event = { reason };
      for (const handler of handlers.get("session_start") || []) {
        await handler(event, ctx);
      }
      for (const handler of handlers.get("agent_start") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
    async emit(name, message) {
      let current = message;
      for (const handler of handlers.get(name) || []) {
        const updated = await handler({ message: current }, ctx);
        if (updated?.message) current = updated.message;
      }
      return current;
    },
    async shutdown() {
      for (const handler of handlers.get("agent_end") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
      await handlers.get("session_shutdown").at(-1)(
        { reason: "quit" },
        ctx,
      );
    },
  };
}

async function exerciseFailureDrain(mode) {
  const prefix = `coord-drain-${mode}`;
  const taskA = coordinatorTask(`${prefix}-a`);
  const taskB = coordinatorTask(`${prefix}-b`, {
    campaignId: `campaign-${mode}-b`,
    assetRootId: `asset-${mode}-b`,
    executorId: `executor-${mode}-b`,
  });
  const queue = realManagerHarness({
    deferActivationKeys: mode === "activation" ? [taskA.packet.packet_id] : [],
  });
  let firstDispatch;
  if (mode === "activation") {
    firstDispatch = autoDispatchCoordinator(queue.deps, "coc_invoke", directTakeoverResult(taskA));
    await nextTurn();
  } else {
    await autoDispatchCoordinator(queue.deps, "coc_invoke", directTakeoverResult(taskA));
  }
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sceneContextResult(taskB));
  check(`${mode}: B retained while A owned`, queue.manager.pendingCount() === 1);

  if (mode === "activation") {
    queue.controls.get(taskA.packet.packet_id).rejectActivation();
    await firstDispatch;
  } else if (mode === "process") {
    queue.controls.get(taskA.packet.packet_id).reject();
  } else {
    queue.controls.get(taskA.packet.packet_id).resolve([]);
  }
  await nextTurn();
  check(`${mode}: B launches once after A failure`, queue.launches.join(",") === `${taskA.packet.packet_id},${taskB.packet.packet_id}`);

  // A late completion after failed activation has no registered completion
  // consumer and must not launch B again.
  if (mode === "activation") queue.controls.get(taskA.packet.packet_id).resolve();
  queue.controls.get(taskB.packet.packet_id).resolve();
  await nextTurn();
  await nextTurn();
  const byKey = new Map(queue.lifecycle.map((entry) => [entry.dispatch_key, entry]));
  const expectedFailure = {
    activation: ["activation", "coordinator_activation_failed"],
    process: ["process", "coordinator_process_failed"],
    framing: ["framing", "coordinator_result_invalid"],
  }[mode];
  check(`${mode}: one bounded lifecycle per key`, queue.lifecycle.length === 2
    && byKey.size === 2
    && byKey.get(taskA.packet.packet_id)?.status === "terminal_failure"
    && byKey.get(taskA.packet.packet_id)?.failure_stage === expectedFailure[0]
    && byKey.get(taskA.packet.packet_id)?.failure_class === expectedFailure[1]
    && !Object.hasOwn(byKey.get(taskA.packet.packet_id), "error")
    && byKey.get(taskB.packet.packet_id)?.status === "completed");
  check(`${mode}: notification cannot duplicate drain`, queue.notifications.join(",") === taskB.packet.packet_id
    && queue.launches.length === 2
    && queue.manager.pendingCount() === 0);
}

// Extractor: all named canonical producer projections resolve, without recursion.
{
  const directTask = coordinatorTask("coord-direct");
  const openingTask = coordinatorTask("coord-opening");
  const sceneTask = coordinatorTask("coord-scene");
  const resumeTask = coordinatorTask("coord-resume");
  check("extractor finds direct progressive task", JSON.stringify(findAutoDispatchTask(directTakeoverResult(directTask))) === JSON.stringify(directTask));
  check("extractor finds opening_bootstrap source_work task", JSON.stringify(findAutoDispatchTask(openingBootstrapResult(openingTask))) === JSON.stringify(openingTask));
  check("extractor finds scene.context progressive task", JSON.stringify(findAutoDispatchTask(sceneContextResult(sceneTask))) === JSON.stringify(sceneTask));
  check("extractor finds session.resume scene_context task", JSON.stringify(findAutoDispatchTask(sessionResumeResult(resumeTask))) === JSON.stringify(resumeTask));
  check("extractor ignores plain results", findAutoDispatchTask({ ok: true, data: { status: "PASS" } }) === null);
  check("extractor ignores failed envelopes", findAutoDispatchTask({ ...directTakeoverResult(directTask), ok: false }) === null);
  check("extractor ignores top-level action", findAutoDispatchTask({ next_host_action: { action: "invoke_coc_dispatch_source_work", task: directTask } }) === null);
  check("extractor ignores arbitrary nesting", findAutoDispatchTask({ ok: true, data: { wrapper: sceneContextResult(sceneTask).data } }) === null);
  check("extractor ignores arrays", findAutoDispatchTask({ ok: true, data: [{ background_takeover: takeover(directTask) }] }) === null);
  check("extractor rejects ambiguous named paths", findAutoDispatchTask({
    ok: true,
    data: {
      background_takeover: takeover(directTask),
      progressive: { background_takeover: takeover(sceneTask) },
    },
  }) === null);
  check("extractor rejects duplicate opening sibling paths", findAutoDispatchTask({
    ...openingBootstrapResult(openingTask),
    data: {
      ...openingBootstrapResult(openingTask).data,
      background_takeover: takeover(openingTask),
    },
  }) === null);
  check("extractor rejects foreign tool source_work path", findAutoDispatchTask({
    ...openingBootstrapResult(openingTask),
    tool: "progressive.prepare_session",
  }) === null);
  check("extractor rejects recursively nested opening path", findAutoDispatchTask({
    ok: true,
    tool: "progressive.opening_bootstrap",
    data: { source_work: { wrapper: openingBootstrapResult(openingTask).data.source_work } },
  }) === null);
  check("extractor ignores foreign actions", findAutoDispatchTask({
    ok: true,
    data: { background_takeover: { next_host_action: { action: "spawn_background_task", task: directTask } } },
  }) === null);
  check("extractor ignores foreign contracts", findAutoDispatchTask({
    ok: true,
    data: { background_takeover: { next_host_action: { action: "invoke_coc_dispatch_source_work", task: { contract_id: "coc.other.v1" } } } },
  }) === null);
  check("extractor ignores strings", findAutoDispatchTask({
    ok: true,
    data: { background_takeover: '{"next_host_action":{"action":"invoke_coc_dispatch_source_work"}}' },
  }) === null);
}

// Canonical queued opening_bootstrap + nested takeover must be accepted for
// dispatch. Observed live deadlock: wire identity-only stripped the takeover
// and the observer projected opening_bootstrap_result_invalid / terminal
// blocker while the job sat ready forever. Pi must not re-judge canonical
// status labels (queued + capability_status routing tag).
{
  const campaignId = "opening-bootstrap-queued-accept";
  const gate = playOpeningGate();
  bindOpeningRoute(gate, campaignId, "queued-accept-bind");
  prepareOpeningRoute(gate, campaignId, "queued-accept-prepare");
  const task = coordinatorTask("coord-queued-accept", { campaignId });
  const params = bootstrapOpeningParams(campaignId);
  const invocationId = "queued-accept-bootstrap";
  const admissionError = gate.openingSetupToolError(
    "coc_invoke",
    params,
    invocationId,
  );
  check("queued bootstrap admitted on retained route", admissionError === null);
  const envelope = openingBootstrapResult(task);
  // Real Pi takeover carries this routing label; it is not a runtime failure.
  envelope.data.source_work.background_takeover.capability_status = (
    "unavailable_pending_real_lifecycle_probe"
  );
  check(
    "extractor finds queued bootstrap task with capability_status label",
    JSON.stringify(findAutoDispatchTask(envelope)) === JSON.stringify(task),
  );
  const observed = gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    params,
    envelope,
    invocationId,
  );
  check(
    "observer accepts canonical queued bootstrap for dispatch",
    observed.accepted === true
      && observed.dispatchAllowed === true
      && observed.reason === "opening_bootstrap_dispatch_accepted",
  );
  check(
    "observer does not reject live queued bootstrap as invalid",
    observed.reason !== "opening_bootstrap_result_invalid",
  );
}

// Delayed duplicate bootstrap responses can complete after the first response
// has already armed table evidence. Every current receipt must retain that
// same evidence route without reopening character setup or adding a blocker.
{
  const campaignId = "post-ready-bootstrap-noop";
  const gate = playOpeningGate();
  bindOpeningRoute(gate, campaignId, "post-ready-bind");
  prepareOpeningRoute(gate, campaignId, "post-ready-prepare");
  const params = bootstrapOpeningParams(campaignId);
  check("first concurrent bootstrap is admitted",
    gate.openingSetupToolError("coc_invoke", params, "post-ready-first") === null);
  check("delayed duplicate bootstrap is admitted on the same revision",
    gate.openingSetupToolError("coc_invoke", params, "post-ready-delayed") === null);
  check("transport-delayed duplicate bootstrap is admitted on the same revision",
    gate.openingSetupToolError("coc_invoke", params, "post-ready-transport") === null);
  const current = gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    params,
    openingBootstrapWithoutTakeover(coordinatorTask("post-ready-current", {
      campaignId,
    }), "current"),
    "post-ready-first",
  );
  check("first bootstrap reaches current ready state",
    current.accepted === true && current.reason === "opening_bootstrap_current");
  const delayed = gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    params,
    openingBootstrapWithoutTakeover(coordinatorTask("post-ready-delayed", {
      campaignId,
    }), "current"),
    "post-ready-delayed",
  );
  const transported = gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    params,
    openingBootstrapWithoutTakeover(coordinatorTask("post-ready-transport", {
      campaignId,
    }), "current"),
    "post-ready-transport",
  );
  check("delayed current bootstrap retains exact table evidence route",
    delayed.accepted === true
    && delayed.reason === "opening_bootstrap_current"
    && transported.accepted === true
    && transported.reason === "opening_bootstrap_current"
    && gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: campaignId,
      arguments: {},
    }, "post-ready-scene")?.includes('"operation":"evidence.table_opening"')
    && gate.takeDeliveredOpeningSetupTerminalBlocker() === null);
}

// Matching takeover triggers exactly one submit with the exact task.
{
  const task = coordinatorTask();
  const { deps, audit, submits } = harness();
  await autoDispatchCoordinator(deps, "coc_invoke", directTakeoverResult(task));
  check("one submit", submits.length === 1);
  check("submit carries exact task", JSON.stringify(submits[0]?.task) === JSON.stringify(task));
  check("submit carries launch context", submits[0]?.launch?.cwd === root && submits[0]?.launch?.provider === "offline");
  check("submitted audit recorded", audit.length === 1 && audit[0].status === "submitted" && audit[0].dispatch_key === task.packet.packet_id);
}

// The exact production opening envelope submits once, and a duplicate
// auto-dispatch wakeup for the same packet remains idempotent.
{
  const task = coordinatorTask("coord-opening-production");
  const submits = [];
  const audit = [];
  const states = new Map();
  const manager = {
    state: (key) => states.get(key),
    activeCount: () => 0,
    submit: async (exactTask, launch) => {
      submits.push({ task: exactTask, launch });
      states.set(exactTask.packet.packet_id, { status: "submitted" });
      return { status: "submitted", dispatch_key: exactTask.packet.packet_id, role: "coordinator" };
    },
  };
  const deps = {
    enabled: async () => true,
    isCurrent: () => true,
    activeManager: () => manager,
    manager: () => manager,
    launchContext: () => ({ cwd: root, provider: "offline", modelId: "offline", thinking: "off" }),
    audit: (entry) => audit.push(entry),
  };
  await autoDispatchCoordinator(deps, "coc_invoke", openingBootstrapResult(task));
  await autoDispatchCoordinator(deps, "coc_invoke", openingBootstrapResult(task));
  check("production opening envelope submits exact task once", submits.length === 1
    && submits[0].task === task
    && submits[0].launch.cwd === root);
  check("production opening duplicate stays silent", audit.length === 1
    && audit[0].status === "submitted"
    && audit[0].dispatch_key === task.packet.packet_id);
}

// The manager exposes a durable-terminal wait that does not resolve at child
// activation/submission or before the terminal notification callback settles.
{
  const task = coordinatorTask("coord-opening-terminal-wait");
  const queue = realManagerHarness();
  let settled = false;
  const waiting = autoDispatchCoordinator(
    queue.deps,
    "coc_invoke",
    openingBootstrapResult(task),
    { waitForTerminal: true },
  ).then((terminal) => {
    settled = true;
    return terminal;
  });
  await nextTurn();
  check("blocking opening wait remains pending after submission",
    settled === false
    && queue.manager.state(task.packet.packet_id)?.status === "submitted");
  queue.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  const terminal = await waiting;
  check("blocking opening wait resolves at durable fulfilled terminal",
    terminal?.status === "completed"
    && terminal.terminal_receipt?.status === "fulfilled"
    && terminal.notification?.status === "delivered"
    && queue.lifecycle.filter((entry) => (
      entry.dispatch_key === task.packet.packet_id
      && entry.status === "completed"
    )).length === 1
    && queue.notifications.filter((key) => (
      key === task.packet.packet_id
    )).length === 1);
}

// A source_work envelope contaminated by any sibling takeover is not a
// dispatch source, even when one of those paths is otherwise valid.
{
  const task = coordinatorTask("coord-opening-contaminated");
  const { deps, audit, submits } = harness();
  const contaminated = openingBootstrapResult(task);
  contaminated.data.progressive = {
    background_takeover: {
      next_host_action: {
        action: "spawn_background_task",
        task,
      },
    },
  };
  await autoDispatchCoordinator(deps, "coc_invoke", contaminated);
  check("sibling-contaminated production envelope cannot dispatch",
    submits.length === 0 && audit.length === 0);
}

// Non-matching results do nothing.
{
  const { deps, audit, submits } = harness();
  await autoDispatchCoordinator(deps, "coc_invoke", { ok: true, data: { status: "PASS" } });
  await autoDispatchCoordinator(deps, "coc_invoke", { next_host_action: { action: "spawn_background_task", task: coordinatorTask() } });
  check("non-matching stays silent", submits.length === 0 && audit.length === 0);
}

// Static discovery is never a dispatch source, even with a malicious exact shape.
{
  const task = coordinatorTask("coord-discover");
  const { deps, audit, submits } = harness();
  await autoDispatchCoordinator(deps, "coc_discover", directTakeoverResult(task));
  check("discover cannot dispatch", submits.length === 0 && audit.length === 0);
}

// Capability disabled skips silently.
{
  const { deps, audit, submits } = harness({ enabled: false });
  await autoDispatchCoordinator(deps, "coc_invoke", directTakeoverResult(coordinatorTask()));
  check("disabled capability skips", submits.length === 0 && audit.length === 0);
}

// Same-key takeover is idempotent.
{
  const task = coordinatorTask();
  const deduped = harness({
    manager: { state: (key) => (key === task.packet.packet_id ? { status: "submitted" } : undefined), activeCount: () => 0, submit: async () => { throw new Error("must not submit"); } },
  });
  await autoDispatchCoordinator(deduped.deps, "coc_invoke", directTakeoverResult(task));
  check("deduped packet skips", deduped.audit.length === 0);
}

// Claim projection invalidity is a terminal system diagnostic, not model
// variance. It remains outside the automatic retry whitelist.
{
  const queue = realManagerHarness();
  const task = coordinatorTask("coord-projection-invalid");
  const diagnostic = {
    schema_version: 1,
    contract_id: "coc.source-validation-diagnostic.v1",
    phase: "claim_projection",
    code: "claim_wire_projection_failed",
    validation_path: "claim.wire.claim_dispatch_projection_failed",
    lease_id: "source-lease-projection-invalid",
    job_ids: ["job-projection-invalid"],
  };
  await autoDispatchCoordinator(
    queue.deps,
    "coc_invoke",
    directTakeoverResult(task),
  );
  queue.controlsByKey.get(task.packet.packet_id)[0].resolve(
    failedCoordinatorEvents(
      task.packet.packet_id,
      "leaf_result_invalid",
      [diagnostic],
    ),
  );
  await nextTurn();
  await nextTurn();
  const terminal = queue.manager.state(task.packet.packet_id);
  check("claim projection invalidity does not retry or fake an interim wake",
    queue.launches.length === 1
    && terminal?.status === "completed"
    && terminal?.terminal_receipt?.failure_class === "leaf_result_invalid"
    && JSON.stringify(terminal?.terminal_receipt?.diagnostics) === JSON.stringify([
      diagnostic,
    ])
    && queue.lifecycle.filter((entry) => entry.status === "retrying").length === 0
    && queue.notifications.join(",") === task.packet.packet_id);
}

// One exact fulfill rejection is retried by the manager under the packet's
// bounded policy. The retry keeps one dispatch identity and emits no terminal
// notification until the second attempt completes.
{
  const queue = realManagerHarness();
  const task = coordinatorTask("coord-fulfill-retry");
  await autoDispatchCoordinator(
    queue.deps,
    "coc_invoke",
    directTakeoverResult(task),
  );
  queue.controlsByKey.get(task.packet.packet_id)[0].resolve(
    failedFulfillEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  check("fulfill rejection launches one exact automatic retry",
    queue.launches.join(",") === [
      task.packet.packet_id,
      task.packet.packet_id,
    ].join(",")
    && queue.manager.state(task.packet.packet_id)?.status === "submitted"
    && queue.notifications.length === 0);
  await autoDispatchCoordinator(
    queue.deps,
    "coc_invoke",
    directTakeoverResult(task),
  );
  check("same packet wakeup cannot duplicate active retry",
    queue.launches.length === 2);
  queue.controlsByKey.get(task.packet.packet_id)[1].resolve();
  await nextTurn();
  await nextTurn();
  const retryObservation = queue.lifecycle.find((entry) => (
    entry.status === "retrying"
    && entry.dispatch_key === task.packet.packet_id
  ));
  check("retry lifecycle is bounded and final notification is exact",
    retryObservation?.completed_attempt === 1
    && retryObservation?.next_attempt === 2
    && retryObservation?.failure_class === "fulfill_rejected"
    && queue.lifecycle.filter((entry) => (
      entry.status === "completed"
      && entry.dispatch_key === task.packet.packet_id
    )).length === 1
    && queue.notifications.join(",") === task.packet.packet_id);
}

// A second exact rejection exhausts the packet budget and becomes one
// truthful terminal receipt. Later duplicate wakeups remain deduped.
{
  const queue = realManagerHarness();
  const task = coordinatorTask("coord-fulfill-exhausted");
  await autoDispatchCoordinator(
    queue.deps,
    "coc_invoke",
    directTakeoverResult(task),
  );
  queue.controlsByKey.get(task.packet.packet_id)[0].resolve(
    failedFulfillEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  queue.controlsByKey.get(task.packet.packet_id)[1].resolve(
    failedFulfillEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  await autoDispatchCoordinator(
    queue.deps,
    "coc_invoke",
    directTakeoverResult(task),
  );
  const terminal = queue.manager.state(task.packet.packet_id);
  check("retry exhaustion terminalizes once without a third launch",
    queue.launches.length === 2
    && terminal?.status === "completed"
    && terminal?.terminal_receipt?.status === "failed"
    && terminal?.terminal_receipt?.failure_class === "fulfill_rejected"
    && queue.lifecycle.filter((entry) => (
      entry.status === "completed"
      && entry.dispatch_key === task.packet.packet_id
    )).length === 1
    && queue.notifications.join(",") === task.packet.packet_id);
}

// Pi-side section-binding repair is bounded inside the same leased leaf task:
// it detects the real fixture before canonical fulfillment, asks one repair
// worker without changing task identity, and never cold-retries the same pack.
{
  const fixturePreflights = sectionBindingFixture.attempts.map((attempt) => (
    runtime.preflightSectionEntityBindings({ sections: attempt.sections })
  ));
  check("section fixture detects all empty entity bindings with exact first paths",
    fixturePreflights.every((preflight, index) => (
      preflight.invalid_bindings.length
        === sectionBindingFixture.attempts[index].expected.empty_entity_count
      && preflight.invalid_bindings[0]?.path
        === sectionBindingFixture.attempts[index].expected.first_error.path
      && preflight.invalid_bindings[0]?.section_id
        === sectionBindingFixture.attempts[index].expected.first_error.section_id
      && preflight.invalid_bindings.every((finding) => (
        typeof finding.path === "string"
        && typeof finding.section_id === "string"
        && typeof finding.entity_kind === "string"
        && typeof finding.payload === "string"
      ))
    )));
  const safeSectionPack = {
    sections: [
      {
        section_id: "fixture-global",
        payload: "narrative",
        binding: { kind: "global", entity_kind: null, entity_ids: [] },
      },
      {
        section_id: "fixture-existing-entity",
        payload: "setting_lore",
        binding: {
          kind: "entity",
          entity_kind: "location",
          entity_ids: ["fixture-existing-location"],
        },
      },
    ],
  };
  check("global and non-empty entity bindings do not trigger repair preflight",
    runtime.preflightSectionEntityBindings(safeSectionPack).invalid_bindings.length
      === 0);

  const invalidLeaf = sectionFixtureLeafTask(
    "section-repair-preflight-packet",
    "section-repair-preflight-job",
  );
  const invalidResult = sectionFixtureWorkerResult(
    invalidLeaf,
    { sections: sectionBindingFixture.attempts[0].sections },
  );
  const repairedResult = sectionFixtureWorkerResult(invalidLeaf, safeSectionPack);
  const preflightSpawns = [];
  const preflightFulfills = [];
  const preflightRepairDiagnostics = [];
  const preflightReceipt = await runtime.runCoordinatorLifecycle(
    coordinatorTask("coord-section-repair-preflight"),
    {
      call: async (_name, args) => {
        if (args.operation === "progressive.claim_host_work") {
          return { data: {
            dispatch_tasks: [invalidLeaf],
            lease_bindings: [{
              lease_id: invalidLeaf.packet.packet_id,
              job_ids: [invalidLeaf.packet.requests[0].job_id],
            }],
          } };
        }
        if (args.operation === "progressive.fulfill_host_work") {
          preflightFulfills.push(args.arguments.worker_result);
          return { data: { accepted: true } };
        }
        const lease = sectionFixtureLeaseResponse(
          args,
          invalidLeaf.packet.requests[0].job_id,
        );
        if (lease) return lease;
        throw new Error(`unexpected section preflight operation ${args.operation}`);
      },
      onSourcePackRepairDiagnostic: (diagnostic) => {
        preflightRepairDiagnostics.push(diagnostic);
      },
      spawnLeaf: async (task) => {
        preflightSpawns.push(task);
        return sectionFixtureSuccess(
          preflightSpawns.length === 1 ? invalidResult : repairedResult,
        );
      },
    },
  );
  const preflightRepairTask = preflightSpawns[1];
  const preflightRepairContext = preflightRepairTask?.repair_context;
  const preflightRepairPrompt = preflightRepairTask
    ? runtime.leafEvidenceMessage(
      await runtime.buildLeafEvidenceContext(preflightRepairTask),
    ).content[0].text
    : "";
  check("invalid section result is repaired before one canonical fulfill",
    preflightReceipt.status === "fulfilled"
    && preflightReceipt.fulfilled_result_count === 1
    && preflightFulfills.length === 1
    && preflightFulfills[0] === repairedResult.results[0]
    && preflightSpawns.length === 2
    && JSON.stringify(preflightRepairTask?.packet) === JSON.stringify(invalidLeaf.packet)
    && preflightRepairContext?.invalid_bindings?.length === 27
    && preflightRepairContext?.invalid_bindings?.[0]?.path === "sections[6].binding"
    && preflightRepairContext?.prior_packs?.[0]?.empty_entity_binding_count === 27
    && preflightRepairDiagnostics.length === 1
    && preflightRepairDiagnostics[0]?.failure_class
      === "section_binding_empty_entity_ids"
    && preflightRepairDiagnostics[0]?.invalid_binding_count === 27
    && preflightRepairDiagnostics[0]?.field_paths?.[0] === "sections[6].binding"
    && preflightRepairDiagnostics[0]?.retry_terminal === false
    && preflightRepairPrompt.includes("bounded repair attempt")
    && preflightRepairPrompt.includes("omit the candidate as unresolved"));

  const repeatedLeaf = sectionFixtureLeafTask(
    "section-repair-repeat-packet",
    "section-repair-repeat-job",
  );
  const repeatedResult = sectionFixtureWorkerResult(
    repeatedLeaf,
    { sections: sectionBindingFixture.attempts[1].sections },
  );
  const repeatedSpawns = [];
  const repeatedFulfills = [];
  const repeatedRepairDiagnostics = [];
  const repeatedReceipt = await runtime.runCoordinatorLifecycle(
    coordinatorTask("coord-section-repair-repeat"),
    {
      call: async (_name, args) => {
        if (args.operation === "progressive.claim_host_work") {
          return { data: {
            dispatch_tasks: [repeatedLeaf],
            lease_bindings: [{
              lease_id: repeatedLeaf.packet.packet_id,
              job_ids: [repeatedLeaf.packet.requests[0].job_id],
            }],
          } };
        }
        if (args.operation === "progressive.fulfill_host_work") {
          repeatedFulfills.push(args.arguments.worker_result);
          return { data: { accepted: true } };
        }
        const lease = sectionFixtureLeaseResponse(
          args,
          repeatedLeaf.packet.requests[0].job_id,
        );
        if (lease) return lease;
        throw new Error(`unexpected repeated-section operation ${args.operation}`);
      },
      onSourcePackRepairDiagnostic: (diagnostic) => {
        repeatedRepairDiagnostics.push(diagnostic);
      },
      spawnLeaf: async (task) => {
        repeatedSpawns.push(task);
        return sectionFixtureSuccess(repeatedResult);
      },
    },
  );
  check("same invalid section pack terminalizes without canonical or cold retry",
    repeatedReceipt.status === "failed"
    && repeatedReceipt.failure_class === "leaf_result_invalid"
    && repeatedReceipt.fulfilled_result_count === 0
    && repeatedSpawns.length === 2
    && repeatedFulfills.length === 0
    && repeatedRepairDiagnostics.length === 2
    && repeatedRepairDiagnostics.at(-1)?.failure_class === "leaf_result_invalid"
    && repeatedRepairDiagnostics.at(-1)?.invalid_binding_count === 5
    && repeatedRepairDiagnostics.at(-1)?.field_paths?.[0] === "sections[6].binding"
    && repeatedRepairDiagnostics.at(-1)?.retry_terminal === true
    && repeatedRepairDiagnostics.at(-1)?.retry_exhausted === true);

  const canonicalLeaf = sectionFixtureLeafTask(
    "section-repair-canonical-packet",
    "section-repair-canonical-job",
    sectionClassificationFixture.entity_catalog,
  );
  const canonicalInitial = sectionFixtureWorkerResult(canonicalLeaf, safeSectionPack);
  const canonicalRepaired = sectionFixtureWorkerResult(
    canonicalLeaf,
    sectionClassificationFixture.mixed_pack,
  );
  const canonicalSpawns = [];
  const canonicalFulfills = [];
  const canonicalMessage = "sections[0].binding entity requires at least one entity id";
  const canonicalReceipt = await runtime.runCoordinatorLifecycle(
    coordinatorTask("coord-section-repair-canonical"),
    {
      call: async (_name, args) => {
        if (args.operation === "progressive.claim_host_work") {
          return { data: {
            dispatch_tasks: [canonicalLeaf],
            lease_bindings: [{
              lease_id: canonicalLeaf.packet.packet_id,
              job_ids: [canonicalLeaf.packet.requests[0].job_id],
            }],
          } };
        }
        if (args.operation === "progressive.fulfill_host_work") {
          canonicalFulfills.push(args.arguments.worker_result);
          if (canonicalFulfills.length === 1) {
            const details = { path: "sections[0].binding" };
            const envelope = {
              ok: false,
              tool: "progressive.fulfill_host_work",
              error: {
                code: "invalid_source_worker_pack",
                message: canonicalMessage,
                details,
              },
            };
            throw new runtime.CanonicalToolError(
              "coc_invoke",
              "invalid_source_worker_pack",
              `canonical coc_invoke failed: ${canonicalMessage}`,
              details,
              envelope,
            );
          }
          return { data: { accepted: true } };
        }
        const lease = sectionFixtureLeaseResponse(
          args,
          canonicalLeaf.packet.requests[0].job_id,
        );
        if (lease) return lease;
        throw new Error(`unexpected canonical-section operation ${args.operation}`);
      },
      spawnLeaf: async (task) => {
        canonicalSpawns.push(task);
        return sectionFixtureSuccess(
          canonicalSpawns.length === 1 ? canonicalInitial : canonicalRepaired,
        );
      },
    },
  );
  const canonicalRepairContext = canonicalSpawns[1]?.repair_context;
  check("canonical rejection details enter the bounded repair prompt",
    canonicalReceipt.status === "fulfilled"
    && canonicalReceipt.failure_class === null
    && canonicalFulfills.length === 2
    && canonicalSpawns.length === 2
    && canonicalRepairContext?.trigger?.kind === "canonical_fulfill_rejected"
    && canonicalRepairContext?.trigger?.failure_class === "invalid_source_worker_pack"
    && canonicalRepairContext?.trigger?.message === canonicalMessage
    && canonicalRepairContext?.trigger?.path === "sections[0].binding"
    && canonicalRepairContext?.prior_packs?.[0]?.empty_entity_binding_count === 0);
}

// A non-empty canonical catalog makes an all-global classification a bounded
// repair condition, not a fulfillable section index. The repaired mixed result
// preserves the same task/lease and is fulfilled exactly once.
{
  const leaf = sectionFixtureLeafTask(
    "section-discrimination-repair-packet",
    "section-discrimination-repair-job",
    sectionClassificationFixture.entity_catalog,
  );
  const allGlobal = sectionFixtureWorkerResult(
    leaf,
    sectionClassificationFixture.all_global_pack,
  );
  const mixed = sectionFixtureWorkerResult(
    leaf,
    sectionClassificationFixture.mixed_pack,
  );
  const initialPreflight = runtime.preflightSectionEntityBindings(
    allGlobal.results[0].pack,
    leaf.packet.requests[0].classification_request,
  );
  const run = await runSectionClassificationLifecycle(
    "section-discrimination-repair",
    leaf,
    [allGlobal, mixed],
  );
  check("non-empty catalog rejects all-global once then fulfills repaired mixed pack",
    initialPreflight.entity_catalog_count === sectionClassificationFixture.entity_catalog.length
    && initialPreflight.non_discriminating === true
    && initialPreflight.invalid_bindings.length === 0
    && run.receipt.status === "fulfilled"
    && run.spawns.length === 2
    && JSON.stringify(run.spawns[1]?.packet) === JSON.stringify(leaf.packet)
    && run.fulfills.length === 1
    && run.fulfills[0] === mixed.results[0]
    && run.repairDiagnostics.length === 1
    && run.repairDiagnostics[0]?.failure_class
      === "section_classification_non_discriminating"
    && run.repairDiagnostics[0]?.retry_terminal === false);
}

// A mixed global/entity result is already discriminating and therefore gets
// one normal canonical fulfill without consuming the repair budget.
{
  const leaf = sectionFixtureLeafTask(
    "section-discrimination-mixed-packet",
    "section-discrimination-mixed-job",
    sectionClassificationFixture.entity_catalog,
  );
  const mixed = sectionFixtureWorkerResult(
    leaf,
    sectionClassificationFixture.mixed_pack,
  );
  const run = await runSectionClassificationLifecycle(
    "section-discrimination-mixed",
    leaf,
    [mixed],
  );
  check("mixed valid classification fulfills exactly once without repair",
    runtime.preflightSectionEntityBindings(
      mixed.results[0].pack,
      leaf.packet.requests[0].classification_request,
    ).non_discriminating === false
    && run.receipt.status === "fulfilled"
    && run.spawns.length === 1
    && run.fulfills.length === 1
    && run.repairDiagnostics.length === 0);
}

// No catalog means no source-established identity is available. Global-only
// output must defer without inventing an ID or calling canonical fulfillment.
{
  const leaf = sectionFixtureLeafTask(
    "section-discrimination-empty-catalog-packet",
    "section-discrimination-empty-catalog-job",
  );
  const allGlobal = sectionFixtureWorkerResult(
    leaf,
    sectionClassificationFixture.all_global_pack,
  );
  const run = await runSectionClassificationLifecycle(
    "section-discrimination-empty-catalog",
    leaf,
    [allGlobal],
  );
  check("empty catalog all-global classification terminalizes without fulfill or repair",
    runtime.preflightSectionEntityBindings(
      allGlobal.results[0].pack,
      leaf.packet.requests[0].classification_request,
    ).catalog_empty_global === true
    && run.receipt.status === "failed"
    && run.receipt.failure_class === "leaf_result_invalid"
    && run.spawns.length === 1
    && run.fulfills.length === 0
    && run.repairDiagnostics.length === 1
    && run.repairDiagnostics[0]?.failure_class
      === "section_classification_entity_catalog_empty"
    && run.repairDiagnostics[0]?.retry_terminal === true);
}

// A second non-discriminating result closes the same lease with a private
// terminal diagnostic and never calls canonical fulfillment.
{
  const leaf = sectionFixtureLeafTask(
    "section-discrimination-terminal-packet",
    "section-discrimination-terminal-job",
    sectionClassificationFixture.entity_catalog,
  );
  const allGlobal = sectionFixtureWorkerResult(
    leaf,
    sectionClassificationFixture.all_global_pack,
  );
  const run = await runSectionClassificationLifecycle(
    "section-discrimination-terminal",
    leaf,
    [allGlobal, allGlobal],
  );
  check("repeated all-global classification terminalizes without fulfillment",
    run.receipt.status === "failed"
    && run.receipt.failure_class === "leaf_result_invalid"
    && run.spawns.length === 2
    && run.fulfills.length === 0
    && run.repairDiagnostics.length === 2
    && run.repairDiagnostics.at(-1)?.failure_class
      === "section_classification_non_discriminating"
    && run.repairDiagnostics.at(-1)?.retry_terminal === true
    && run.repairDiagnostics.at(-1)?.retry_exhausted === true);
}

// Pi semantic readiness is three independent canonical observations. A full
// page parse says nothing by itself about section semantics or a current scene.
{
  const readiness = new coordinator.PiSemanticReadinessSession();
  const campaignId = "semantic-readiness-fixture";
  const allPages = Array.from({ length: 48 }, (_value, index) => index);
  const parsedButSemanticFailed = readiness.observeCanonical(
    "progressive.status",
    campaignId,
    {
      ok: true,
      tool: "progressive.status",
      data: {
        campaign_id: campaignId,
        full_parse: {
          status: "complete",
          page_count: 48,
          parsed_pdf_indices: allPages,
        },
        host_work: {
          requests: [{
            kind: "classify_sections",
            status: "failed",
            retry_exhausted: true,
          }],
        },
      },
    },
  );
  check("48/48 page parse stays independent when semantic compile failed",
    parsedButSemanticFailed?.page_parse.status === "ready"
    && parsedButSemanticFailed.page_parse.evidence_gap === false
    && parsedButSemanticFailed.semantic_compile.status === "failed"
    && parsedButSemanticFailed.current_scene_projection.status === "unknown");

  const semanticCurrentSceneMissing = readiness.observeCanonical(
    "scene.context",
    campaignId,
    {
      ok: true,
      tool: "scene.context",
      data: {
        campaign_id: campaignId,
        host_work: {
          requests: [{
            kind: "classify_sections",
            status: "fulfilled",
            dispatch_state: "fulfilled",
          }],
        },
      },
    },
  );
  check("semantic current does not fabricate a missing current-scene projection",
    semanticCurrentSceneMissing?.page_parse.status === "ready"
    && semanticCurrentSceneMissing.semantic_compile.status === "ready"
    && semanticCurrentSceneMissing.current_scene_projection.status === "missing"
    && semanticCurrentSceneMissing.current_scene_projection.evidence_gap === true
    && semanticCurrentSceneMissing.current_scene_projection.source_backed === false);

  const nullSceneProjection = readiness.observeCanonical(
    "scene.context",
    campaignId,
    {
      ok: true,
      tool: "scene.context",
      data: {
        campaign_id: campaignId,
        active_scene_id: "source-gap-null-scene",
        scene: null,
        source_material: {
          keeper_only: true,
          authority: "source_authored_context",
        },
      },
    },
  );
  check("null scene remains an evidence gap rather than a source-backed scene",
    nullSceneProjection?.current_scene_projection.status === "missing"
    && nullSceneProjection.current_scene_projection.provenance === "unknown"
    && nullSceneProjection.current_scene_projection.source_backed === false);

  const allReady = readiness.observeCanonical(
    "scene.context",
    campaignId,
    {
      ok: true,
      tool: "scene.context",
      data: {
        campaign_id: campaignId,
        scene: {
          scene_id: "source-scene",
          origin: "source",
          evidence_gap: false,
        },
        source_material: {
          keeper_only: true,
          authority: "source_authored_context",
        },
      },
    },
  );
  check("all three readiness layers become ready only from their own evidence",
    allReady?.page_parse.status === "ready"
    && allReady.semantic_compile.status === "ready"
    && allReady.current_scene_projection.status === "ready"
    && allReady.current_scene_projection.source_backed === true
    && allReady.current_scene_projection.provenance === "source_backed");

  const improvised = readiness.observeCanonical(
    "scene.context",
    campaignId,
    {
      ok: true,
      tool: "scene.context",
      data: {
        campaign_id: campaignId,
        scene: {
          scene_id: "campaign-local-scene",
          origin: "campaign_local",
          evidence_gap: false,
        },
        source_material: {
          keeper_only: true,
          authority: "campaign_local",
          provenance: { kind: "improvised" },
        },
      },
    },
  );
  check("campaign-local improvised projection is never labeled source-backed",
    improvised?.current_scene_projection.status === "ready"
    && improvised.current_scene_projection.provenance === "improvised"
    && improvised.current_scene_projection.source_backed === false);

  const resumed = readiness.observeCanonical(
    "session.resume",
    campaignId,
    {
      ok: true,
      tool: "session.resume",
      data: {
        campaign_id: campaignId,
        scene_context: {
          host_work: {
            requests: [{
              kind: "classify_sections",
              status: "failed",
              retry_exhausted: true,
            }],
          },
        },
      },
    },
  );
  check("session resume rebuilds readiness from canonical data instead of stale memory",
    resumed?.page_parse.status === "unknown"
    && resumed.semantic_compile.status === "failed"
    && resumed.current_scene_projection.status === "missing"
    && resumed.current_scene_projection.provenance === "unknown");
}

// A scene evidence gap is advisory-only: Pi retains it internally without
// creating a hard gate, blocking the call, or starting any source dispatch.
{
  const campaignId = "semantic-readiness-no-gate";
  const harness = mainExtensionHarness((name, params) => {
    if (name === "coc_invoke" && params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaignId,
          mode: "awaiting_player",
        },
      };
    }
    if (name === "coc_invoke" && params.operation === "scene.context") {
      return {
        ok: true,
        tool: "scene.context",
        data: {
          campaign_id: campaignId,
          host_work: {
            requests: [{
              kind: "classify_sections",
              status: "fulfilled",
              dispatch_state: "fulfilled",
            }],
          },
        },
      };
    }
    throw new Error(`unexpected semantic-readiness operation ${name}`);
  }, { startupCampaignId: campaignId });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "semantic-readiness-startup-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const scene = JSON.parse((await harness.registered.get("coc_invoke").execute(
    "semantic-readiness-scene-missing",
    {
      operation: "scene.context",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const readinessAudit = [...harness.appended].reverse().find((entry) => (
    entry.name === "coc-semantic-readiness"
    && entry.value?.campaign_id === campaignId
  ));
  check("scene/source-material gap is recorded without a hard gate or dispatch",
    scene.ok === true
    && harness.calls.map((call) => call.params.operation).join(",")
      === "session.resume,memory.extraction_status,scene.context"
    && harness.launches.length === 0
    && readinessAudit?.value?.semantic_compile?.status === "ready"
    && readinessAudit?.value?.current_scene_projection?.status === "missing"
    && readinessAudit.value.current_scene_projection.evidence_gap === true
    && harness.sent.every((entry) => entry.message?.display !== true));
  await harness.shutdown();
}

// The private coordinator sidecar is stripped before its canonical receipt is
// retained, while a session-local hidden context gives the KP exact repair
// paths/counts. No player-visible tool output contains those internals.
{
  const campaignId = "semantic-repair-diagnostic";
  const task = coordinatorTask("coord-semantic-repair-diagnostic", {
    campaignId,
  });
  const privateDiagnostic = {
    schema_version: 1,
    contract_id: "coc.pi-source-pack-repair-diagnostic.v1",
    campaign_id: campaignId,
    job_id: "section-repair-job",
    failure_class: "leaf_result_invalid",
    field_paths: ["sections[6].binding", "sections[7].binding"],
    invalid_binding_count: 27,
    repair_attempt: 1,
    retry_terminal: true,
    retry_exhausted: true,
  };
  const harness = mainExtensionHarness((name) => {
    throw new Error(`unexpected repair diagnostic canonical call ${name}`);
  });
  await harness.start();
  const submitted = JSON.parse((await harness.registered.get(
    "coc_dispatch_source_work",
  ).execute(
    "semantic-repair-diagnostic-dispatch",
    { task },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  harness.controls.get(task.packet.packet_id).resolve(coordinatorEventsForReceipt(
    {
      ...coordinatorReceipt(task.packet.packet_id),
      status: "failed",
      claimed_packet_count: 1,
      leaf_task_count: 1,
      failure_class: "leaf_result_invalid",
    },
    [privateDiagnostic],
  ));
  await nextTurn();
  await nextTurn();
  const repairAudit = harness.appended.find((entry) => (
    entry.name === "coc-semantic-readiness-repair"
  ));
  const privateContext = harness.sent.find((entry) => (
    entry.message?.customType === "coc-semantic-readiness-private"
  ));
  check("repair diagnostics retain terminal paths only in hidden Pi context",
    submitted.status === "submitted"
    && repairAudit?.value?.diagnostics?.[0]?.failure_class
      === "leaf_result_invalid"
    && repairAudit.value.diagnostics[0].invalid_binding_count === 27
    && repairAudit.value.diagnostics[0].retry_terminal === true
    && repairAudit.value.diagnostics[0].retry_exhausted === true
    && privateContext?.message?.display === false
    && privateContext?.options?.triggerTurn === false
    && privateContext.message.details?.repair_diagnostics?.[0]?.field_paths?.[0]
      === "sections[6].binding"
    && !JSON.stringify(submitted).includes("sections[6].binding")
    && !JSON.stringify(submitted).includes("leaf_result_invalid")
    && harness.sent.every((entry) => entry.message?.display !== true));
  await harness.shutdown();
}

// The coordinator seam owns one complete semantic-supply lifecycle. The
// main extension is deliberately absent here: start -> repair evidence ->
// priority fulfillment -> readiness refresh -> resume all live in one object.
{
  const campaignId = "semantic-supply-seam";
  const task = coordinatorTask("coord-semantic-supply-seam", { campaignId });
  const supply = new coordinator.PiSemanticSupplyCoordinator();
  const audits = [];
  const hidden = [];
  const launches = [];
  let resolveCompletion;
  let statusCalls = 0;
  supply.start({
    isCurrent: () => true,
    coordinatorEnabled: async () => true,
    launchContext: () => ({
      cwd: root,
      provider: "offline",
      modelId: "offline",
      thinking: "off",
    }),
    launchCoordinator: (exactTask) => {
      launches.push(exactTask.packet.packet_id);
      const completion = new Promise((resolve) => { resolveCompletion = resolve; });
      return {
        child: {},
        activation: Promise.resolve({ type: "agent_start" }),
        completion,
        terminate: async () => {},
      };
    },
    callCanonical: async (params) => {
      if (params.operation === "progressive.status") {
        const value = sectionSemanticStatusResult(task, { fulfilled: statusCalls > 0 });
        statusCalls += 1;
        return value;
      }
      if (params.operation === "progressive.on_enter_scene") {
        return { ok: true, tool: "progressive.on_enter_scene", data: {
          scene_id: "source-gap", materialization: { progressive: true }, projection: {},
        } };
      }
      if (params.operation === "scene.context") {
        return sourceBoundReadySceneContext(campaignId, "source-gap");
      }
      if (params.operation === "secrets.briefing") {
        return { ok: true, tool: "secrets.briefing", data: { source_sections: [{ section_id: "synthetic-section", body: "keeper body", secret: true }] } };
      }
      throw new Error(`unexpected seam canonical operation ${params.operation}`);
    },
    appendAudit: (name, value) => audits.push({ name, value }),
    sendHidden: (context, options) => hidden.push({ context, options }),
    projectTerminal: () => ({ status: "delivered" }),
  });
  const moveParams = {
    operation: "state.move_scene",
    root,
    campaign: campaignId,
    // `decision_id` is host-owned for state.move_scene (49aab6ae): the model
    // surface refuses one, and the host attaches the destination-named key.
    arguments: { scene_id: "source-gap" },
  };
  const moveHandled = supply.observeCanonical(
    "state.move_scene",
    moveParams,
    sourceBoundMoveResult(campaignId),
  );
  await nextTurn();
  await nextTurn();
  const repairDiagnostic = {
    schema_version: 1,
    contract_id: "coc.pi-source-pack-repair-diagnostic.v1",
    campaign_id: campaignId,
    job_id: "seam-section-job",
    failure_class: "section_binding_empty_entity_ids",
    field_paths: ["sections[6].binding"],
    invalid_binding_count: 27,
    repair_attempt: 1,
    retry_terminal: false,
    retry_exhausted: false,
  };
  resolveCompletion(coordinatorEventsForReceipt(
    {
      ...coordinatorReceipt(task.packet.packet_id),
      status: "fulfilled",
      claimed_packet_count: 1,
      leaf_task_count: 1,
      fulfilled_result_count: 1,
    },
    [repairDiagnostic],
  ));
  await nextTurn();
  await nextTurn();
  await nextTurn();
  const readySnapshot = supply.readinessSnapshot(campaignId);
  const resumeHandled = supply.observeCanonical(
    "session.resume",
    { operation: "session.resume", root, campaign: campaignId, arguments: {} },
    sourceBoundMissingSessionResume(task),
  );
  const resumedSnapshot = supply.readinessSnapshot(campaignId);
  check("coordinator seam is the single owner from repair through priority and resume",
    moveHandled === false
    && launches.join(",") === task.packet.packet_id
    && audits.some((entry) => entry.name === "coc-semantic-readiness-repair"
      && entry.value?.diagnostics?.[0]?.invalid_binding_count === 27)
    && readySnapshot?.current_scene_projection?.status === "ready"
    && hidden.some((entry) => (
      entry.context?.reason === "scene_priority_ready"
      && entry.context?.scene_priority?.source_cards?.length === 2
      && entry.context?.scene_priority?.source_cards?.[1]?.operation === "secrets.briefing"
      && entry.options?.triggerTurn === true
    ))
    && resumeHandled === true
    && resumedSnapshot?.current_scene_id === "source-gap"
    && resumedSnapshot.current_scene_projection.status === "missing"
    && launches.length === 1);
  await supply.shutdown();
}

// Direct canonical materialization retries one transient host failure inside
// the existing bounded scene-priority lifecycle, then terminalizes once when
// the same failure persists. No packet queue or cold observation loop is made.
{
  const candidateEnvelope = (campaignId) => ({
    ok: true, tool: "scene.context", data: {
      campaign_id: campaignId, active_scene_id: "synthetic-scene",
      scene: { scene_id: "synthetic-scene", evidence_gap: true, parse_state: "named_only" },
      progressive: { asset_root_id: "synthetic-root" },
    },
  });
  const statusEnvelope = (campaignId) => ({
    ok: true, tool: "progressive.status", data: {
      campaign_id: campaignId, progressive: { asset_root_id: "synthetic-root" },
    },
  });
  const runRetryCase = async (campaignId, failures) => {
    const supply = new coordinator.PiSemanticSupplyCoordinator();
    const hidden = [];
    let materializeCalls = 0;
    supply.start({
      isCurrent: () => true,
      coordinatorEnabled: async () => true,
      launchContext: () => ({ cwd: root, provider: "offline", modelId: "offline", thinking: "off" }),
      launchCoordinator: () => { throw new Error("no coordinator task expected"); },
      callCanonical: async (params) => {
        if (params.operation === "progressive.status") return statusEnvelope(campaignId);
        if (params.operation === "progressive.on_enter_scene") {
          materializeCalls += 1;
          if (materializeCalls <= failures) throw new Error("transient canonical transport");
          return { ok: true, tool: "progressive.on_enter_scene", data: {
            scene_id: "synthetic-scene", materialization: { progressive: true }, projection: {},
          } };
        }
        if (params.operation === "scene.context") return sourceBoundReadySceneContext(campaignId, "synthetic-scene");
        if (params.operation === "secrets.briefing") return { ok: true, tool: "secrets.briefing", data: { source_sections: [] } };
        throw new Error(`unexpected retry operation ${params.operation}`);
      },
      appendAudit: () => {},
      sendHidden: (context, options) => hidden.push({ context, options }),
      projectTerminal: () => ({ status: "delivered" }),
    });
    supply.observeCanonical("scene.context", {
      operation: "scene.context", root, campaign: campaignId, arguments: {},
    }, candidateEnvelope(campaignId));
    for (let index = 0; index < 8; index += 1) await nextTurn();
    return { supply, hidden, materializeCalls };
  };
  const recovered = await runRetryCase("materialize-transient", 1);
  const exhausted = await runRetryCase("materialize-exhausted", 2);
  check("transient scene materialization retries once then supplies hidden cards",
    recovered.materializeCalls === 2
    && recovered.hidden.some((entry) => entry.context?.reason === "scene_priority_ready"
      && entry.options?.triggerTurn === true));
  check("persistent scene materialization failure terminalizes once at the bounded attempt cap",
    exhausted.materializeCalls === 2
    && exhausted.hidden.filter((entry) => entry.context?.reason === "scene_priority_terminal").length === 1
    && exhausted.hidden.every((entry) => entry.context?.scene_priority?.hard_gate === false)
    && exhausted.hidden.some((entry) => entry.context?.reason === "scene_priority_terminal"
      && entry.options?.triggerTurn === true));
  await recovered.supply.shutdown();
  await exhausted.supply.shutdown();
}

// Scene-priority is host-only: a normal source-bound move returns unchanged,
// privately checks existing progressive.status, and starts only its existing
// classify_sections coordinator task at scene priority.
{
  const campaignId = "scene-priority-move";
  const task = coordinatorTask("coord-scene-priority-move", { campaignId });
  let statusCalls = 0;
  const harness = mainExtensionHarness((name, params) => {
    if (params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaignId,
          mode: "awaiting_player",
        },
      };
    }
    if (name !== "coc_invoke") throw new Error(`unexpected move priority tool ${name}`);
    if (params.operation === "state.move_scene") {
      return sourceBoundMoveResult(campaignId);
    }
    if (params.operation === "progressive.status") {
      const value = sectionSemanticStatusResult(task, {
        fulfilled: statusCalls > 0,
      });
      statusCalls += 1;
      return value;
    }
    throw new Error(`unexpected move priority operation ${params.operation}`);
  }, { startupCampaignId: campaignId });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "scene-priority-move-startup-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const moved = JSON.parse((await harness.registered.get("coc_invoke").execute(
    "scene-priority-move",
    {
      operation: "state.move_scene",
      root,
      campaign: campaignId,
      // Host-owned key: the model surface carries only the destination.
      arguments: { scene_id: "source-gap" },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  await nextTurn();
  await nextTurn();
  const waiting = harness.sent.find((entry) => (
    entry.message?.customType === "coc-semantic-readiness-private"
    && entry.message?.details?.reason === "scene_priority_waiting"
  ));
  check("move_scene missing source target starts only the existing priority section task",
    moved.ok === true
    && moved.data.next_operation.hard_gate === false
    && !JSON.stringify(moved).includes('"hard_gate":true')
    && harness.calls.map((call) => call.params.operation).join(",")
      === "session.resume,memory.extraction_status,state.move_scene,progressive.status"
    && harness.launches.join(",") === task.packet.packet_id
    && waiting?.message?.display === false
    && waiting?.message?.details?.scene_priority?.source_specific_facts
      === "unestablished_or_campaign_local_only"
    && waiting?.message?.details?.scene_priority?.exact_source_dependency?.status
      === "unresolved"
    && waiting?.message?.details?.scene_priority?.exact_source_dependency?.keeper_action
      === "do_not_assert_or_improvise_source_specific_facts"
    && waiting.message.details.scene_priority.hard_gate === false);
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  await harness.shutdown();
}

// scene.context can carry the same source-bound mention directly. Concurrent
// duplicate observations use one coordinator lifecycle; after canonical
// fulfillment Pi refreshes status and privately gives the KP the exact
// non-gating scene.context re-read card.
{
  const campaignId = "scene-priority-context";
  const task = coordinatorTask("coord-scene-priority-context", { campaignId });
  let sceneReads = 0;
  const harness = mainExtensionHarness((name, params) => {
    if (params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaignId,
          mode: "awaiting_player",
        },
      };
    }
    if (name !== "coc_invoke") throw new Error(`unexpected context priority tool ${name}`);
    if (params.operation === "scene.context") {
      sceneReads += 1;
      return sceneReads > 2
        ? sourceBoundReadySceneContext(campaignId, "source-gap")
        : sourceBoundMissingSceneContext(task);
    }
    if (params.operation === "progressive.status") {
      return sectionSemanticStatusResult(task, { fulfilled: true });
    }
    if (params.operation === "progressive.on_enter_scene") {
      return { ok: true, tool: "progressive.on_enter_scene", data: {
        scene_id: "source-gap", materialization: { progressive: true }, projection: {},
      } };
    }
    if (params.operation === "secrets.briefing") {
      return { ok: true, tool: "secrets.briefing", data: { source_sections: [{ section_id: "synthetic-section", body: "keeper body", secret: true }] } };
    }
  }, { startupCampaignId: campaignId });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "scene-priority-context-startup-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const invoke = (id) => harness.registered.get("coc_invoke").execute(
    id,
    { operation: "scene.context", root, campaign: campaignId, arguments: {} },
    undefined,
    undefined,
    harness.ctx,
  );
  const first = JSON.parse((await invoke("scene-priority-context-first")).content[0].text);
  await invoke("scene-priority-context-duplicate");
  await nextTurn();
  await nextTurn();
  check("scene.context missing source material dispatches once and keeps player result canonical",
    first.ok === true
    && first.tool === "scene.context"
    && harness.launches.join(",") === task.packet.packet_id
    && !JSON.stringify(first).includes("source_unavailable")
    && !JSON.stringify(first).includes('"hard_gate":true'));
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  await nextTurn();
  const refreshed = [...harness.appended].reverse().find((entry) => (
    entry.name === "coc-semantic-readiness"
    && entry.value?.campaign_id === campaignId
    && entry.value?.current_scene_projection?.status === "ready"
  ));
  const ready = harness.sent.find((entry) => (
    entry.message?.customType === "coc-semantic-readiness-private"
    && entry.message?.details?.reason === "scene_priority_ready"
  ));
  check("fulfilled priority task refreshes readiness and sends hidden exact scene re-read",
    refreshed?.value?.current_scene_projection?.status === "ready"
    && ready?.message?.display === false
    && ready?.options?.triggerTurn === true
    && ready?.message?.details?.scene_priority?.source_cards?.length === 2
    && ready.message.details.scene_priority.source_cards[0].operation === "scene.context"
    && ready.message.details.scene_priority.source_cards[1].operation === "secrets.briefing");
  await harness.shutdown();
}

// A resumed Pi session rebuilds the same priority candidate from canonical
// scene/status projections; it does not need stale in-memory dispatch state.
{
  const campaignId = "scene-priority-resume";
  const task = coordinatorTask("coord-scene-priority-resume", { campaignId });
  const harness = mainExtensionHarness((name, params) => {
    if (name === "coc_invoke" && params.operation === "session.resume") {
      return sourceBoundMissingSessionResume(task);
    }
    if (name === "coc_invoke" && params.operation === "progressive.status") {
      return sectionSemanticStatusResult(task, { fulfilled: true });
    }
    throw new Error(`unexpected priority resume operation ${params.operation}`);
  });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "scene-priority-resume",
    { operation: "session.resume", root, campaign: campaignId, arguments: {} },
    undefined,
    undefined,
    harness.ctx,
  );
  await nextTurn();
  await nextTurn();
  check("session resume restores canonical priority dispatch without a second queue",
    harness.launches.join(",") === task.packet.packet_id);
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  await harness.shutdown();
}

// A source-backed current projection has no readiness gap, so it never creates
// a scene-priority query or dispatch.
{
  const campaignId = "scene-priority-already-ready";
  const harness = mainExtensionHarness((name, params) => {
    if (params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaignId,
          mode: "awaiting_player",
        },
      };
    }
    if (name === "coc_invoke" && params.operation === "scene.context") {
      return sourceBoundReadySceneContext(campaignId);
    }
    throw new Error(`unexpected ready scene operation ${params.operation}`);
  }, { startupCampaignId: campaignId });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "scene-priority-ready-startup-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  await harness.registered.get("coc_invoke").execute(
    "scene-priority-ready",
    { operation: "scene.context", root, campaign: campaignId, arguments: {} },
    undefined,
    undefined,
    harness.ctx,
  );
  await nextTurn();
  check("already-ready source scene dispatches zero priority work",
    harness.launches.length === 0
    && harness.calls.map((call) => call.params.operation).join(",")
      === "session.resume,memory.extraction_status,scene.context");
  await harness.shutdown();
}

// A terminal invalid section pack keeps its previous bounded repair diagnostic
// private and never starts a new loop for the same source-bound scene.
{
  const campaignId = "scene-priority-terminal";
  const task = coordinatorTask("coord-scene-priority-terminal", { campaignId });
  const diagnostic = {
    schema_version: 1,
    contract_id: "coc.pi-source-pack-repair-diagnostic.v1",
    campaign_id: campaignId,
    job_id: "scene-priority-section-job",
    failure_class: "leaf_result_invalid",
    field_paths: ["sections[6].binding"],
    invalid_binding_count: 27,
    repair_attempt: 1,
    retry_terminal: true,
    retry_exhausted: true,
  };
  const harness = mainExtensionHarness((name, params) => {
    if (params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaignId,
          mode: "awaiting_player",
        },
      };
    }
    if (name === "coc_invoke" && params.operation === "scene.context") {
      return sourceBoundMissingSceneContext(task);
    }
    throw new Error(`unexpected terminal scene operation ${params.operation}`);
  }, { startupCampaignId: campaignId });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "scene-priority-terminal-startup-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const invoke = (id) => harness.registered.get("coc_invoke").execute(
    id,
    { operation: "scene.context", root, campaign: campaignId, arguments: {} },
    undefined,
    undefined,
    harness.ctx,
  );
  await invoke("scene-priority-terminal-first");
  await nextTurn();
  harness.controls.get(task.packet.packet_id).resolve(coordinatorEventsForReceipt(
    {
      ...coordinatorReceipt(task.packet.packet_id),
      status: "failed",
      claimed_packet_count: 1,
      leaf_task_count: 1,
      failure_class: "leaf_result_invalid",
    },
    [diagnostic],
  ));
  await nextTurn();
  await nextTurn();
  await invoke("scene-priority-terminal-duplicate");
  await nextTurn();
  const terminal = harness.sent.find((entry) => (
    entry.message?.customType === "coc-semantic-readiness-private"
    && entry.message?.details?.reason === "scene_priority_terminal"
  ));
  const repairReadiness = [...harness.appended].reverse().find((entry) => (
    entry.name === "coc-semantic-readiness"
    && entry.value?.campaign_id === campaignId
  ));
  check("terminal priority failure keeps repair evidence hidden and does not loop",
    harness.launches.length === 1
    && repairReadiness?.value?.semantic_compile?.status === "failed"
    && terminal?.message?.display === false
    && terminal?.message?.details?.scene_priority?.hard_gate === false
    && terminal?.options?.triggerTurn === true
    && terminal?.message?.details?.audience === "keeper_only");
  await harness.shutdown();
}

// The same existing manager remains the only queue: an ordinary other-campaign
// background packet may wait, but a current source-bound scene packet drains
// first when the active child settles.
{
  const active = coordinatorTask("coord-scene-priority-active", {
    campaignId: "scene-priority-active",
  });
  const other = coordinatorTask("coord-scene-priority-other", {
    campaignId: "scene-priority-other",
  });
  const current = coordinatorTask("coord-scene-priority-current", {
    campaignId: "scene-priority-current",
  });
  const harness = mainExtensionHarness((name, params) => {
    if (params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: active.packet.campaign_id,
          mode: "awaiting_player",
        },
      };
    }
    if (name !== "coc_invoke" || params.operation !== "scene.context") {
      throw new Error(`unexpected priority queue operation ${params.operation}`);
    }
    if (params.campaign === active.packet.campaign_id) return sceneContextResult(active);
    if (params.campaign === other.packet.campaign_id) return sceneContextResult(other);
    if (params.campaign === current.packet.campaign_id) {
      return sourceBoundMissingSceneContext(current);
    }
    throw new Error(`unexpected priority queue campaign ${params.campaign}`);
  }, { startupCampaignId: active.packet.campaign_id });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "scene-priority-queue-startup-resume",
    {
      operation: "session.resume",
      root,
      campaign: active.packet.campaign_id,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const invoke = (id, campaign) => harness.registered.get("coc_invoke").execute(
    id,
    { operation: "scene.context", root, campaign, arguments: {} },
    undefined,
    undefined,
    harness.ctx,
  );
  await invoke("scene-priority-active", active.packet.campaign_id);
  await nextTurn();
  await invoke("scene-priority-other", other.packet.campaign_id);
  await invoke("scene-priority-current", current.packet.campaign_id);
  await nextTurn();
  check("current scene priority is pending behind only the active child",
    harness.launches.join(",") === active.packet.packet_id
    && harness.controls.has(active.packet.packet_id));
  harness.controls.get(active.packet.packet_id).resolve(
    coordinatorEvents(active.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  check("other campaign background does not preempt current scene priority",
    harness.launches.join(",")
      === `${active.packet.packet_id},${current.packet.packet_id}`
    && !harness.controls.has(other.packet.packet_id));
  harness.controls.get(current.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(current.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  if (harness.controls.has(other.packet.packet_id)) {
    harness.controls.get(other.packet.packet_id).resolve(
      coordinatorEvents(other.packet.packet_id),
    );
  }
  await harness.shutdown();
}

// A distinct packet is retained while A is active, then launched exactly once.
{
  const queue = realManagerHarness();
  const taskA = coordinatorTask("coord-queue-a");
  const taskB = coordinatorTask("coord-queue-b");
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sceneContextResult(taskA));
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sessionResumeResult(taskB));
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sessionResumeResult(taskB));
  check("A active and B bounded pending", queue.manager.activeCount() === 1
    && queue.manager.pendingCount() === 1
    && queue.launches.join(",") === "coord-queue-a");
  check("B duplicate is silent", queue.audit.length === 2
    && queue.audit[0].status === "submitted"
    && queue.audit[1].status === "pending");
  queue.controls.get("coord-queue-a").resolve();
  await nextTurn();
  check("B launches once after A terminal", queue.launches.join(",") === "coord-queue-a,coord-queue-b"
    && queue.manager.pendingCount() === 0);
  queue.controls.get("coord-queue-b").resolve();
  await nextTurn();
  check("A and B complete once", queue.lifecycle.filter((entry) => entry.status === "completed").length === 2);
}

// One pending slot per canonical queue identity coalesces to its latest wakeup.
{
  const queue = realManagerHarness();
  const taskA = coordinatorTask("coord-coalesce-a");
  const taskB = coordinatorTask("coord-coalesce-b");
  const taskC = coordinatorTask("coord-coalesce-c");
  await autoDispatchCoordinator(queue.deps, "coc_invoke", directTakeoverResult(taskA));
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sceneContextResult(taskB));
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sessionResumeResult(taskC));
  check("same-queue pending slot remains one", queue.manager.pendingCount() === 1);
  check("older pending wakeup is visibly superseded", queue.manager.state("coord-coalesce-b")?.failure_class === "coordinator_superseded"
    && queue.manager.state("coord-coalesce-b")?.superseded_by === "coord-coalesce-c"
    && queue.lifecycle.some((entry) => entry.dispatch_key === "coord-coalesce-b"
      && entry.failure_class === "coordinator_superseded"
      && entry.superseded_by === "coord-coalesce-c"));
  queue.controls.get("coord-coalesce-a").resolve();
  await nextTurn();
  check("only latest pending wakeup launches", queue.launches.join(",") === "coord-coalesce-a,coord-coalesce-c");
  queue.controls.get("coord-coalesce-c").resolve();
  await nextTurn();
}

// Different canonical queue identities are retained independently and drain FIFO.
{
  const queue = realManagerHarness();
  const taskA = coordinatorTask("coord-cross-a");
  const taskB = coordinatorTask("coord-cross-b", {
    campaignId: "campaign-b", assetRootId: "asset-b", executorId: "executor-b",
  });
  const taskC = coordinatorTask("coord-cross-c", {
    campaignId: "campaign-c", assetRootId: "asset-c", executorId: "executor-c",
  });
  await autoDispatchCoordinator(queue.deps, "coc_invoke", directTakeoverResult(taskA));
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sceneContextResult(taskB));
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sessionResumeResult(taskC));
  check("cross-queue wakeups both retained", queue.manager.pendingCount() === 2
    && queue.manager.state(taskB.packet.packet_id)?.status === "pending"
    && queue.manager.state(taskC.packet.packet_id)?.status === "pending");
  queue.controls.get(taskA.packet.packet_id).resolve();
  await nextTurn();
  check("cross-queue B launches first", queue.launches.join(",") === "coord-cross-a,coord-cross-b");
  queue.controls.get(taskB.packet.packet_id).resolve();
  await nextTurn();
  check("cross-queue C launches second", queue.launches.join(",") === "coord-cross-a,coord-cross-b,coord-cross-c");
  queue.controls.get(taskC.packet.packet_id).resolve();
  await nextTurn();
  check("cross-queue keys each complete once", queue.lifecycle.filter((entry) => entry.status === "completed").length === 3
    && new Set(queue.launches).size === 3);
}

// The pending-per-queue map is explicitly capped; an exact canonical
// re-emission after one slot drains is accepted and eventually launches FIFO.
{
  const queue = realManagerHarness();
  const active = coordinatorTask("coord-cap-active");
  const queued = [];
  await autoDispatchCoordinator(queue.deps, "coc_invoke", directTakeoverResult(active));
  for (let index = 0; index < runtime.MAX_PENDING_COORDINATOR_QUEUES; index += 1) {
    const task = coordinatorTask(`coord-cap-${index}`, {
      campaignId: `campaign-cap-${index}`,
      assetRootId: `asset-cap-${index}`,
      executorId: `executor-cap-${index}`,
    });
    queued.push(task);
    await autoDispatchCoordinator(queue.deps, "coc_invoke", sceneContextResult(task));
  }
  const overflow = coordinatorTask("coord-cap-overflow", {
    campaignId: "campaign-cap-overflow",
    assetRootId: "asset-cap-overflow",
    executorId: "executor-cap-overflow",
  });
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sessionResumeResult(overflow));
  const overflowAudit = queue.audit.at(-1);
  check("pending queue cap enforced", queue.manager.pendingCount() === runtime.MAX_PENDING_COORDINATOR_QUEUES);
  check("overflow remains retryable and visible", overflowAudit?.status === "pending_overflow"
    && overflowAudit?.reemit_required === true
    && overflowAudit?.retry_after_active_terminal === true
    && queue.manager.state(overflow.packet.packet_id) === undefined);
  queue.controls.get(active.packet.packet_id).resolve();
  await nextTurn();
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sessionResumeResult(overflow));
  const reemitAudit = queue.audit.at(-1);
  check("exact overflow re-emission is retained after capacity drains",
    reemitAudit?.status === "pending"
    && queue.manager.state(overflow.packet.packet_id)?.status === "pending");
  for (const task of queued) {
    check(`FIFO launches ${task.packet.packet_id}`,
      queue.launches.at(-1) === task.packet.packet_id);
    queue.controls.get(task.packet.packet_id).resolve();
    await nextTurn();
  }
  check("re-emitted overflow launches once at FIFO tail",
    queue.launches.join(",") === [
      active.packet.packet_id,
      ...queued.map((task) => task.packet.packet_id),
      overflow.packet.packet_id,
    ].join(",")
    && queue.launches.filter((key) => key === overflow.packet.packet_id).length === 1);
  queue.controls.get(overflow.packet.packet_id).resolve();
  await nextTurn();
  check("re-emitted overflow completes exactly once",
    queue.lifecycle.filter((entry) => (
      entry.dispatch_key === overflow.packet.packet_id
      && entry.status === "completed"
    )).length === 1);
}

// A successful source bind arms the Pi host boundary before bootstrap. The
// model cannot detour through discovery/OCR or publish tool-free invented
// opening prose; only a structured character-setup result may authorize a
// setup prompt. The retained card advances exactly and clears only after a
// canonical current opening result.
{
  const bootstrapCard = {
    operation: "progressive.opening_bootstrap",
    invoke_via: "coc_invoke",
    prefilled_arguments: {},
    missing_arguments: ["start_location", "opening_pdf_indices"],
    hard_gate: true,
    authority: "canonical_setup",
  };
  const task = coordinatorTask("coord-main-prebootstrap-route");
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) {
      const gate = openingSetupGate();
      return {
        ok: true,
        tool: "setup.invoke",
        data: {
          status: "PASS",
          opening_gate: gate,
          next_operation: gate.next_operation,
        },
      };
    }
    if (
      params.operation === "setup.invoke"
      && [
        "actor.create",
        "investigator.create",
        "campaign.link_investigator",
        "investigator.render_card",
      ].includes(params.arguments?.kind)
    ) {
      const kind = params.arguments.kind;
      const payload = params.arguments.payload;
      return {
        ok: true,
        tool: "setup.invoke",
        data: {
          schema_version: 1,
          status: "PASS",
          kind,
          result: kind === "campaign.link_investigator"
            ? {
              campaign_id: payload.campaign_id,
              investigator_ids: payload.investigator_ids,
            }
            : kind === "investigator.create"
              ? { investigator_id: payload.investigator_id }
              : kind === "actor.create"
                ? {
                  campaign_id: payload.campaign_id,
                  actor_id: payload.actor_id,
                  ruleset_id: "fixture",
                }
              : {
                campaign_id: payload.campaign_id,
                investigator_id: payload.investigator_id,
                markdown_path: ".coc/fixture/card.md",
              },
        },
      };
    }
    if (params.operation === "setup.investigator_contract") {
      return {
        ok: true,
        tool: "setup.investigator_contract",
        data: {
          schema_version: 1,
          status: "PASS",
          kind: "investigator.contract",
          result: {
            ruleset_id: "coc7",
            payload_schema: { type: "object" },
          },
        },
      };
    }
    if (params.operation === "rules.roll_dice") {
      return {
        ok: true,
        tool: "rules.roll_dice",
        data: {
          expression: "3D6",
          rolls: [3, 4, 5],
          total: 12,
          roll_id: "toolbox-auto-dispatch-fixture-000001",
        },
      };
    }
    if (params.operation === "evidence.table_opening") {
      const text = [
        "[in_game]",
        "【开场时间】圣诞季约两周后",
        "",
        "来源约束下的准确开场。",
        "[/in_game]",
      ].join("\n");
      return {
        ok: true,
        tool: "evidence.table_opening",
        data: {
          turn: 0,
          text,
          text_sha256: `sha256:${createHash("sha256").update(
            JSON.stringify(text),
          ).digest("hex")}`,
          authoritative_time_anchor: {
            schema_version: 1,
            display: "圣诞季约两周后",
            rendered_line: "【开场时间】圣诞季约两周后",
          },
        },
      };
    }
    if (params.operation === "progressive.prepare_opening") {
      return {
        ok: true,
        tool: "progressive.prepare_opening",
        data: { status: "blocked", next_operation: bootstrapCard },
      };
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapWithoutTakeover(task, "current");
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "invoke-bind-opening-route",
    {
      operation: "setup.invoke",
      campaign: "auto-dispatch-fixture",
      arguments: {
        kind: "scenario.bind_pdf",
        payload: {
          campaign_id: "auto-dispatch-fixture",
          scenario_id: "fixture-scenario",
          title: "Fixture Scenario",
          source_bundle_path: "/fixture/source-bundle",
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const callsAfterBind = harness.calls.length;
  let fakeTopLevelRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "fake-top-level-investigator-create",
      {
        operation: "investigator.create",
        campaign: "auto-dispatch-fixture",
        arguments: {
          investigator_id: "fake-top-level",
          sheet: { id: "fake-top-level", name: "Fake Top Level" },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { fakeTopLevelRejected = true; }
  let malformedRouteCampaignsRejected = 0;
  for (const campaign of ["foreign-campaign"]) {
    const params = {
      operation: "progressive.prepare_opening",
      arguments: {},
    };
    if (campaign !== undefined) params.campaign = campaign;
    try {
      await harness.registered.get("coc_invoke").execute(
        `malformed-route-campaign-${String(campaign)}`,
        params,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch { malformedRouteCampaignsRejected += 1; }
  }
  let retainedAfterMalformed;
  try {
    await harness.registered.get("coc_invoke").execute(
      "scene-after-malformed-route-campaign",
      {
        operation: "scene.context",
        campaign: "auto-dispatch-fixture",
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { retainedAfterMalformed = error; }
  check("foreign setup shapes are rejected before MCP without consuming route",
    fakeTopLevelRejected
    && malformedRouteCampaignsRejected === 1
    && harness.calls.length === callsAfterBind
    && retainedAfterMalformed?.message.includes(
      '"operation":"progressive.prepare_opening"',
    ));
  let discoverRejected = false;
  let ocrError;
  let sceneError;
  let nonCreationDiceError;
  try {
    const discovered = JSON.parse((await harness.registered.get("coc_discover").execute(
      "discover-during-opening-gate",
      { operation: "scene.context" },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    discoverRejected = discovered.ok === false;
  } catch { discoverRejected = true; }
  try {
    await harness.registered.get("coc_progressive_ocr").execute(
      "ocr-during-opening-gate",
      { operation: "status" },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { ocrError = error; }
  try {
    await harness.registered.get("coc_invoke").execute(
      "scene-during-opening-gate",
      {
        operation: "scene.context",
        campaign: "auto-dispatch-fixture",
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { sceneError = error; }
  try {
    await harness.registered.get("coc_invoke").execute(
      "non-creation-dice-during-opening-gate",
      {
        operation: "rules.roll_dice",
        campaign: "auto-dispatch-fixture",
        arguments: {
          expression: "3D6",
          decision_id: "roll-not-creation-dice",
          reason: "ordinary random event",
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { nonCreationDiceError = error; }
  check("pre-bootstrap host gate blocks discover OCR and play detours",
    discoverRejected
    && ocrError instanceof Error
    && sceneError instanceof Error
    && nonCreationDiceError instanceof Error
    && ocrError.message.includes('"operation":"progressive.prepare_opening"')
    && sceneError.message.includes('"operation":"progressive.prepare_opening"')
    && nonCreationDiceError.message.includes(
      '"operation":"progressive.prepare_opening"',
    )
    && harness.calls.length === callsAfterBind);

  const invented = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "你站在一条并不存在于来源中的街道上。" }],
  });
  const forcedRoute = harness.sent.at(-1);
  check("unproven pre-bootstrap final is suppressed and exact route is forced",
    invented.content.every((part) => part.type !== "text")
    && forcedRoute?.message?.customType === "coc-opening-setup-route"
    && forcedRoute?.message?.details?.next_operation?.operation
      === "progressive.prepare_opening"
    && forcedRoute?.options?.triggerTurn === true
    && forcedRoute?.options?.deliverAs === "followUp");

  const callsBeforeEarlyCharacter = harness.calls.length;
  let earlyCharacterError;
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-character-before-background",
      {
        operation: "setup.investigator_contract",
        campaign: "auto-dispatch-fixture",
        arguments: { campaign_id: "auto-dispatch-fixture" },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { earlyCharacterError = error; }
  check("selection phase rejects character setup before exact source route",
    earlyCharacterError instanceof Error
    && harness.calls.length === callsBeforeEarlyCharacter
    && earlyCharacterError.message.includes(
      '"operation":"progressive.prepare_opening"',
    ));

  await harness.registered.get("coc_invoke").execute(
    "invoke-prepare-retained-route-with-bound-campaign",
    {
      operation: "progressive.prepare_opening",
      campaign: "auto-dispatch-fixture",
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const callsBeforeBootstrapCharacter = harness.calls.length;
  let bootstrapCharacterError;
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-character-before-bootstrap",
      {
        operation: "setup.investigator_contract",
        campaign: "auto-dispatch-fixture",
        arguments: { campaign_id: "auto-dispatch-fixture" },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { bootstrapCharacterError = error; }
  check("bootstrap phase rejects character setup before background attempt",
    bootstrapCharacterError instanceof Error
    && harness.calls.length === callsBeforeBootstrapCharacter
    && bootstrapCharacterError.message.includes(
      '"operation":"progressive.opening_bootstrap"',
    ));
  await harness.registered.get("coc_invoke").execute(
    "invoke-current-opening",
    {
      operation: "progressive.opening_bootstrap",
      campaign: "auto-dispatch-fixture",
      arguments: {
        start_location: { location_id: "location:opening", title: "Opening" },
        opening_pdf_indices: [0],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const callsBeforePostCurrentDetours = harness.calls.length;
  const postCurrentDetours = [
    {
      id: "post-current-luck-detour",
      params: {
        operation: "rules.roll_dice",
        campaign: "auto-dispatch-fixture",
        arguments: {
          expression: "3D6",
          decision_id: "roll-post-current-luck-detour",
          purpose: "investigator_creation_luck",
          reason: "Quick-Fire investigator Luck",
        },
      },
    },
    {
      id: "post-current-contract-detour",
      params: {
        operation: "setup.investigator_contract",
        campaign: "auto-dispatch-fixture",
        arguments: { campaign_id: "auto-dispatch-fixture" },
      },
    },
    {
      id: "post-current-create-detour",
      params: guidedQuickFireCreateParams(
        "auto-dispatch-fixture",
        "route-investigator",
      ),
    },
    {
      id: "post-current-link-detour",
      params: {
        operation: "setup.invoke",
        campaign: "auto-dispatch-fixture",
        arguments: {
          kind: "campaign.link_investigator",
          payload: {
            campaign_id: "auto-dispatch-fixture",
            investigator_ids: ["route-investigator"],
          },
        },
      },
    },
  ];
  const postCurrentDetourErrors = [];
  for (const detour of postCurrentDetours) {
    try {
      await harness.registered.get("coc_invoke").execute(
        detour.id,
        detour.params,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch (error) {
      postCurrentDetourErrors.push(error);
    }
  }
  check("no-selector setup retains exact handoff before all setup and play detours",
    postCurrentDetourErrors.length === postCurrentDetours.length
    && postCurrentDetourErrors.every((error) => error instanceof Error)
    && harness.calls.length === callsBeforePostCurrentDetours);
  let wrongOpeningFinalizationRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-wrong-opening-finalizer",
      {
        operation: "turn.finalize",
        campaign: "auto-dispatch-fixture",
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { wrongOpeningFinalizationRejected = true; }
  let openingBeforeHandoffRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-source-table-opening-before-handoff",
      {
        operation: "evidence.table_opening",
        campaign: "auto-dispatch-fixture",
        arguments: {
          text: "[in_game]\n来源约束下的准确开场。\n[/in_game]",
          presented_roll_ids: [],
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    openingBeforeHandoffRejected = error instanceof Error
      && error.message.includes('"operation":"setup.complete"');
  }
  const afterCurrent = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "来源开场已物化。" }],
  });
  check("setup-only source harness stops at handoff without exposing play opening",
    wrongOpeningFinalizationRejected
    && openingBeforeHandoffRejected
    && afterCurrent.content.every((part) => part.type !== "text")
    && harness.sent.at(-1)?.message?.details?.next_operation?.operation
      === "setup.complete");
  await harness.shutdown();
}

// Initial prepare/bootstrap phases are route-exclusive even under concurrent
// model calls. Character setup begins only after the background-attempt
// boundary, including the already-current source case.
{
  const task = coordinatorTask("coord-monotonic-opening-race");
  const prepared = deferredValue();
  const linked = deferredValue();
  const bootstrapped = deferredValue();
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) {
      return boundOpeningSetupResult();
    }
    if (params.operation === "progressive.prepare_opening") {
      return prepared.promise;
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "campaign.link_investigator"
    ) {
      return linked.promise;
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "investigator.create"
    ) {
      return canonicalGuidedCreateResult("monotonic-investigator");
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return bootstrapped.promise;
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "monotonic-bind",
    {
      operation: "setup.invoke",
      campaign: "auto-dispatch-fixture",
      arguments: {
        kind: "scenario.bind_pdf",
        payload: {
          campaign_id: "auto-dispatch-fixture",
          scenario_id: "fixture-scenario",
          title: "Fixture Scenario",
          source_bundle_path: "/fixture/source-bundle",
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );

  const preparePending = harness.registered.get("coc_invoke").execute(
    "monotonic-prepare",
    {
      operation: "progressive.prepare_opening",
      campaign: "auto-dispatch-fixture",
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  let createBeforePrepareRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "monotonic-create",
      {
        operation: "setup.invoke",
        campaign: "auto-dispatch-fixture",
        arguments: {
          kind: "investigator.create",
          payload: {
            investigator_id: "monotonic-investigator",
            sheet: {
              id: "monotonic-investigator",
              name: "Monotonic Investigator",
            },
            creation: { method: "quick_fire_array" },
          },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { createBeforePrepareRejected = true; }
  prepared.resolve(preparedOpeningSetupResult());
  await preparePending;
  check("concurrent investigator create cannot bypass prepare",
    createBeforePrepareRejected);

  const bootstrapPending = harness.registered.get("coc_invoke").execute(
    "monotonic-bootstrap",
    {
      operation: "progressive.opening_bootstrap",
      campaign: "auto-dispatch-fixture",
      arguments: {
        start_location: { location_id: "location:opening", title: "Opening" },
        opening_pdf_indices: [0],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  let linkBeforeBootstrapRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "monotonic-link-before-bootstrap",
      {
        operation: "setup.invoke",
        campaign: "auto-dispatch-fixture",
        arguments: {
          kind: "campaign.link_investigator",
          payload: {
            campaign_id: "auto-dispatch-fixture",
            investigator_ids: ["monotonic-investigator"],
          },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { linkBeforeBootstrapRejected = true; }

  bootstrapped.resolve(openingBootstrapWithoutTakeover(task, "current"));
  const current = JSON.parse((await bootstrapPending).content[0].text);
  const callsBeforePostCurrentDetours = harness.calls.length;
  const postCurrentErrors = [];
  for (const [id, params] of [
    [
      "monotonic-create-after-current",
      guidedQuickFireCreateParams(
        "auto-dispatch-fixture",
        "monotonic-investigator",
      ),
    ],
    [
      "monotonic-link-after-current",
      {
        operation: "setup.invoke",
        campaign: "auto-dispatch-fixture",
        arguments: {
          kind: "campaign.link_investigator",
          payload: {
            campaign_id: "auto-dispatch-fixture",
            investigator_ids: ["monotonic-investigator"],
          },
        },
      },
    ],
  ]) {
    try {
      await harness.registered.get("coc_invoke").execute(
        id,
        params,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch (error) {
      postCurrentErrors.push(error);
    }
  }
  check("current source advances monotonically to exact setup handoff",
    linkBeforeBootstrapRejected
    && current.ok === true
    && current.data.status === "current"
    && postCurrentErrors.length === 2
    && postCurrentErrors.every((error) => (
      error instanceof Error
      && error.message.includes('"operation":"setup.complete"')
    ))
    && harness.calls.length === callsBeforePostCurrentDetours);
  await harness.shutdown();
}

// A safe campaign-bound probe may discover an already persisted opening
// selection. Pi must hydrate that canonical route instead of discarding the
// result and suggesting an impossible source rebind/OCR detour.
{
  const gate = playOpeningGate();
  const campaignId = "prebound-opening-selection";
  const resumeParams = {
    operation: "session.resume",
    campaign: campaignId,
    arguments: {},
  };
  check("prebound resume probe is admitted before Pi owns a route",
    gate.openingSetupToolError(
      "coc_invoke",
      resumeParams,
      "prebound-resume",
    ) === null);
  const retainedGate = openingSetupGate(undefined, campaignId);
  const hydrated = gate.observeOpeningSetupInvocation(
    "session.resume",
    resumeParams,
    {
      ok: false,
      tool: "session.resume",
      error: {
        code: "opening_setup_incomplete",
        message: "opening setup remains incomplete",
        details: retainedGate,
      },
    },
    "prebound-resume",
  );
  const prepareParams = {
    operation: "progressive.prepare_opening",
    campaign: campaignId,
    arguments: {},
  };
  check("prebound opening selection hydrates and retains exact prepare route",
    hydrated.accepted === true
    && hydrated.reason === "prebound_opening_selection"
    && gate.openingSetupToolError(
      "coc_invoke",
      prepareParams,
      "prebound-prepare",
    ) === null
    && gate.openingSetupToolError(
      "coc_progressive_ocr",
      {},
      "prebound-ocr-detour",
    )?.includes("progressive.prepare_opening"));

  const wrongToolGate = playOpeningGate();
  const wrongToolInvocation = "prebound-wrong-envelope-tool";
  check("wrong-tool prebound probe is initially admitted",
    wrongToolGate.openingSetupToolError(
      "coc_invoke",
      resumeParams,
      wrongToolInvocation,
    ) === null);
  const wrongToolDisposition = wrongToolGate.observeOpeningSetupInvocation(
    "session.resume",
    resumeParams,
    {
      ok: false,
      tool: "scene.context",
      error: {
        code: "opening_setup_incomplete",
        details: retainedGate,
      },
    },
    wrongToolInvocation,
  );
  check("observer defense rejects wrong returned tool identity",
    wrongToolDisposition.reason === "non_route_result"
    && wrongToolGate.requiredOpeningSetupContinuation() === null);
}

// Only the canonical producer's explicit current-source character discriminator
// may hydrate guided setup. The overloaded detail-free error is not evidence
// of this phase and remains fail-closed.
{
  const campaignId = "discriminated-opening-character-setup";
  const resumeParams = {
    operation: "session.resume",
    campaign: campaignId,
    arguments: {},
  };
  const characterSetupDetails = {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_character_setup_required",
    campaign_id: campaignId,
    character_setup_policy: "guided_quick_fire",
    next_operation: null,
    instruction: "safe canonical character setup",
  };
  const gate = playOpeningGate();
  check("discriminated character-setup error probe is admitted",
    gate.openingSetupToolError(
      "coc_invoke",
      resumeParams,
      "discriminated-opening-resume",
    ) === null);
  const hydrated = gate.observeOpeningSetupInvocation(
    "session.resume",
    resumeParams,
    {
      ok: false,
      tool: "session.resume",
      error: {
        code: "opening_setup_incomplete",
        details: characterSetupDetails,
      },
    },
    "discriminated-opening-resume",
  );
  const projectedText = JSON.stringify(hydrated.modelProjection);
  const projectedGate = hydrated.modelProjection?.data?.opening_gate;
  check("canonical character discriminator hydrates safe guided-only setup",
    hydrated.accepted === true
    && hydrated.reason
      === "prebound_opening_character_setup"
    && projectedGate?.phase === "opening_character_setup_required"
    && projectedGate?.character_setup_policy
      === "guided_quick_fire_no_source"
    && projectedGate?.allowed_actions?.some((action) => (
      action.kind === "investigator.create"
      && action.required_creation_input_mode === "guided_quick_fire"
    ))
    && !projectedGate?.allowed_actions?.some((action) => (
      action.kind === "campaign.render_briefing"
    ))
    && !projectedText.includes("import_complete_sheet")
    && !projectedText.includes("scene_context")
    && !projectedText.includes("current_turn")
    && !projectedText.includes("location")
    && !projectedText.includes("task"));

  const adaptiveDetails = {
    ...characterSetupDetails,
    campaign_id: "discriminated-medieval-character-setup",
    character_setup_policy: "kp_guided_era_adaptive",
    character_setup_input_mode: "kp_guided_era_adaptive",
  };
  const adaptiveResumeParams = {
    ...resumeParams,
    campaign: adaptiveDetails.campaign_id,
  };
  const adaptiveGate = playOpeningGate();
  const adaptiveAdmission = adaptiveGate.openingSetupToolError(
    "coc_invoke",
    adaptiveResumeParams,
    "discriminated-medieval-opening-resume",
  );
  const adaptiveHydrated = adaptiveGate.observeOpeningSetupInvocation(
    "session.resume",
    adaptiveResumeParams,
    {
      ok: false,
      tool: "session.resume",
      error: {
        code: "opening_setup_incomplete",
        details: adaptiveDetails,
      },
    },
    "discriminated-medieval-opening-resume",
  );
  const adaptiveProjectedGate = adaptiveHydrated.modelProjection?.data?.opening_gate;
  check("medieval character discriminator forwards only the adaptive route",
    adaptiveAdmission === null
    && adaptiveHydrated.accepted === true
    && adaptiveHydrated.reason === "prebound_opening_character_setup"
    && adaptiveProjectedGate?.character_setup_policy
      === "kp_guided_era_adaptive_no_source"
    && adaptiveProjectedGate?.character_setup_input_mode
      === "kp_guided_era_adaptive"
    && adaptiveProjectedGate?.allowed_actions?.some((action) => (
      action.kind === "investigator.create"
      && action.required_creation_input_mode === "kp_guided_era_adaptive"
    ))
    && adaptiveProjectedGate?.allowed_actions?.some((action) => (
      action.operation === "state.cash_semantic"
      && action.provenance?.kp_guided === true
      && action.provenance?.cash_semantic === true
    ))
    && !adaptiveProjectedGate?.allowed_actions?.some((action) => (
      action.kind === "campaign.render_briefing"
    )));

  const inspected = [{ source_id: "pdf:minimal", pdf_index: 0 }];
  const unresolvedAnswer = {
    status: "unresolved", inspected_source_refs: inspected,
  };
  const transportedFacts = {
    schema_version: 1,
    contract_id: "coc.opening-fast-facts.v1",
    era: unresolvedAnswer,
    place: unresolvedAnswer,
    investigator_hook: unresolvedAnswer,
    investigator_constraints: unresolvedAnswer,
    player_safe_summary: unresolvedAnswer,
    content_flags: unresolvedAnswer,
  };
  const transported = main.openingSourceReviewTerminalFollowUp({
    status: "reviewed",
    campaign_id: campaignId,
    failure_class: null,
    facts: transportedFacts,
  }, {});
  const producerFactsCard = transported.next_operation;
  check("hidden producer card sequences facts adoption before contract",
    producerFactsCard.operation === "setup.adopt_source_facts"
    && producerFactsCard.invoke_via === "coc_setup_adopt_source_facts"
    && Object.keys(producerFactsCard.arguments).join(",") === "campaign_id"
    && producerFactsCard.arguments.campaign_id === campaignId
    && !JSON.stringify(producerFactsCard).includes("pdf:minimal"));
  const unresolvedFactsParams = {
    operation: "setup.adopt_source_facts",
    campaign: campaignId,
    arguments: { campaign_id: campaignId, facts: transportedFacts },
  };
  check("character overlap admits dedicated unresolved facts receipt",
    gate.openingSetupToolError(
      "coc_invoke",
      unresolvedFactsParams,
      "minimal-opening-unresolved-facts",
    ) === null);
  const unresolvedFactsObserved = gate.observeOpeningSetupInvocation(
    "setup.adopt_source_facts",
    unresolvedFactsParams,
    {
      ok: true,
      tool: "setup.adopt_source_facts",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "campaign.adopt_source_facts",
        result: {
          campaign_id: campaignId,
          facts: unresolvedFactsParams.arguments.facts,
          unresolved_blocking_facts: ["era", "place"],
          character_creation_unblocked: false,
        },
      },
    },
    "minimal-opening-unresolved-facts",
  );
  check("unresolved facts receipt names blockers and does not invite contract",
    unresolvedFactsObserved.accepted === true
    && replacementIs(
      gate.acceptVisibleAssistantFinal("现在读取调查员契约。"),
      (
        "来源事实已记录，但 年代（era）、地点（place） 仍未解决；"
        + "继续检查当前已绑定来源，暂不要调用调查员构建契约。"
      ),
    ));

  const contractParams = {
    operation: "setup.investigator_contract",
    campaign: campaignId,
    arguments: { campaign_id: campaignId },
  };
  check("minimal-error gate admits only its current contract query",
    gate.openingSetupToolError(
      "coc_invoke",
      contractParams,
      "minimal-opening-contract",
    ) === null);
  const projectedContract = gate.projectGuidedCharacterContract(
    "setup.investigator_contract",
    contractParams,
    {
      ok: true,
      tool: "setup.investigator_contract",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "investigator.contract",
        result: {
          ruleset_id: "coc7",
          guided_quick_fire_campaign_era: {
            status: "standard_quick_fire_available",
            supported: true,
            required_sheet_era: "1920s",
            supported_eras: ["1920s"],
            failure_code: null,
          },
          payload_schema: {
            oneOf: [
              {
                title: "Guided",
                properties: {
                  creation: { $ref: "#/$defs/quick_fire_creation" },
                },
              },
              {
                title: "Import",
                properties: {
                  creation: { $ref: "#/$defs/complete_sheet_creation" },
                },
              },
            ],
            $defs: {
              quick_fire_creation: {
                type: "object",
                properties: { input_mode: { const: "guided_quick_fire" } },
              },
              complete_sheet: { type: "object" },
              complete_sheet_creation: { type: "object" },
            },
          },
        },
      },
    },
  );
  check("minimal-error contract projection removes complete-sheet import",
    projectedContract.data.result.payload_schema.oneOf.length === 1
    && projectedContract.data.result.applicable_input_mode
      === "guided_quick_fire"
    && !JSON.stringify(projectedContract).includes("import_complete_sheet")
    && projectedContract.data.result.payload_schema.$defs.complete_sheet
      === undefined
    && projectedContract.data.result.payload_schema.$defs
      .complete_sheet_creation === undefined);
  const adaptiveEraContract = main.projectPiGuidedCharacterContract(
    {
      ok: true,
      tool: "setup.investigator_contract",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "investigator.contract",
        result: {
          campaign_binding: {
            campaign_id: campaignId,
            era: "medieval",
          },
          guided_quick_fire_campaign_era: {
            status: "kp_guided_era_adaptive_available",
            supported: false,
            required_sheet_era: "medieval",
            supported_eras: ["1920s"],
            failure_code: null,
            fallback: {
              status: "available",
              available: true,
              route: "kp_guided_era_adaptive",
              input_mode: "kp_guided_era_adaptive",
            },
          },
          payload_schema: {
            oneOf: [
              {
                title: "KP-guided era-adaptive creation",
                properties: {
                  creation: {
                    $ref: "#/$defs/kp_guided_era_adaptive_creation",
                  },
                },
              },
              {
                title: "Import",
                properties: {
                  creation: { $ref: "#/$defs/complete_sheet_creation" },
                },
              },
            ],
            $defs: {
              quick_fire_sheet: { type: "object" },
              quick_fire_creation: {
                type: "object",
                properties: { input_mode: { const: "guided_quick_fire" } },
              },
              kp_guided_era_adaptive_creation: {
                type: "object",
                properties: {
                  input_mode: { const: "kp_guided_era_adaptive" },
                },
              },
              complete_sheet: { type: "object" },
              complete_sheet_creation: { type: "object" },
            },
          },
        },
      },
    },
    campaignId,
  );
  check("Pi contract projection exposes the authoritative era-adaptive route",
    adaptiveEraContract.ok === true
    && adaptiveEraContract.data.result.applicable_input_mode
      === "kp_guided_era_adaptive"
    && adaptiveEraContract.data.result.character_creation_route.route
      === "kp_guided_era_adaptive"
    && adaptiveEraContract.data.result.character_creation_route.input_mode
      === "kp_guided_era_adaptive"
    && adaptiveEraContract.data.result.payload_schema.oneOf.length === 1
    && adaptiveEraContract.data.result.payload_schema.oneOf[0].properties
      .creation.$ref === "#/$defs/kp_guided_era_adaptive_creation"
    && !JSON.stringify(adaptiveEraContract).includes("import_complete_sheet")
    && adaptiveEraContract.data.result.payload_schema.$defs.complete_sheet
      === undefined
    && adaptiveEraContract.data.result.payload_schema.$defs
      .complete_sheet_creation === undefined
    && adaptiveEraContract.data.result.payload_schema.$defs.quick_fire_sheet
      === undefined
    && adaptiveEraContract.data.result.payload_schema.$defs.quick_fire_creation
      === undefined);
  const contractObserved = gate.observeOpeningSetupInvocation(
    "setup.investigator_contract",
    contractParams,
    projectedContract,
    "minimal-opening-contract",
  );
  check("minimal-error projected contract remains a canonical owned receipt",
    contractObserved.accepted === true
    && gate.acceptVisibleAssistantFinal("模型自拟的沉浸式创建方式说明。") === true);

  const blockedDetours = [
    {
      name: "coc_invoke",
      id: "minimal-opening-scene",
      params: {
        operation: "scene.context",
        campaign: campaignId,
        arguments: {},
      },
    },
    {
      name: "coc_invoke",
      id: "minimal-opening-source",
      params: {
        operation: "progressive.project_opening",
        campaign: campaignId,
        arguments: {},
      },
    },
    {
      name: "coc_invoke",
      id: "minimal-opening-briefing",
      params: {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: {
          kind: "campaign.render_briefing",
          payload: { campaign_id: campaignId },
        },
      },
    },
    {
      name: "coc_invoke",
      id: "minimal-opening-import",
      params: {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: {
          kind: "investigator.create",
          payload: {
            campaign_id: campaignId,
            investigator_id: "minimal-import",
            sheet: { id: "minimal-import", name: "Import" },
            creation: { input_mode: "import_complete_sheet" },
          },
        },
      },
    },
    {
      name: "coc_discover",
      id: "minimal-opening-discover",
      params: { operation: "scene.context" },
    },
  ];
  check("minimal-error gate blocks source import discover and scene detours",
    blockedDetours.every(({ name, id, params }) => (
      gate.openingSetupToolError(name, params, id) !== null
    )));

  const investigatorId = "minimal-guided-investigator";
  const createParams = guidedQuickFireCreateParams(
    campaignId,
    investigatorId,
  );
  check("minimal-error gate admits the exact guided create",
    gate.openingSetupToolError(
      "coc_invoke",
      createParams,
      "minimal-opening-create",
    ) === null);
  const created = gate.observeOpeningSetupInvocation(
    "setup.invoke",
    createParams,
    canonicalGuidedCreateResult(investigatorId),
    "minimal-opening-create",
  );
  const createdVisible = gate.acceptVisibleAssistantFinal(
    "模型自拟的创建成功说明。",
  );
  const linkParams = {
    operation: "setup.invoke",
    campaign: campaignId,
    arguments: {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: campaignId,
        investigator_ids: [investigatorId],
      },
    },
  };
  check("minimal-error gate admits only the current guided investigator link",
    created.accepted === true
    && gate.openingSetupToolError(
      "coc_invoke",
      linkParams,
      "minimal-opening-link",
    ) === null);
  const linked = gate.observeOpeningSetupInvocation(
    "setup.invoke",
    linkParams,
    canonicalLinkSetupResult(campaignId, [investigatorId]),
    "minimal-opening-link",
  );
  const linkedVisible = gate.acceptVisibleAssistantFinal(
    "模型自拟的链接成功说明。",
  );
  const released = gate.requiredOpeningSetupContinuation();
  check("minimal-error gate releases the opening exactly once after link",
    replacementIs(
      createdVisible,
      "调查员资料已创建；请确认后加入战役。",
    )
    && linked.accepted === true
    && replacementIs(linkedVisible, "调查员已正式加入战役。")
    && released?.next_operation?.operation === "evidence.table_opening"
    && gate.requiredOpeningSetupContinuation() === null);

  const adjacentFailures = [
    {
      ok: false,
      tool: "session.resume",
      error: { code: "opening_setup_incomplete" },
    },
    {
      ok: false,
      tool: "session.resume",
      error: {
        code: "opening_setup_incomplete",
        message: "adjacent richer error is not the exact minimal contract",
      },
    },
    {
      ok: false,
      tool: "session.resume",
      error: { code: "opening_setup_incomplete", details: null },
    },
    {
      ok: false,
      tool: "session.resume",
      error: { code: "campaign_not_found" },
    },
    {
      ok: false,
      tool: "scene.context",
      error: { code: "opening_setup_incomplete" },
    },
  ];
  for (const [index, envelope] of adjacentFailures.entries()) {
    const adjacentGate = playOpeningGate();
    const invocationId = `minimal-opening-adjacent-${index}`;
    check(`adjacent minimal-error variant ${index} probe is admitted`,
      adjacentGate.openingSetupToolError(
        "coc_invoke",
        resumeParams,
        invocationId,
      ) === null);
    const disposition = adjacentGate.observeOpeningSetupInvocation(
      "session.resume",
      resumeParams,
      envelope,
      invocationId,
    );
    check(`adjacent minimal-error variant ${index} is not hijacked`,
      disposition.reason === "non_route_result"
      && disposition.modelProjection === undefined
      && adjacentGate.requiredOpeningSetupContinuation() === null);
  }
  const mismatchedCampaignGate = playOpeningGate();
  check("minimal-error campaign mismatch probe is admitted under its owner",
    mismatchedCampaignGate.openingSetupToolError(
      "coc_invoke",
      resumeParams,
      "minimal-opening-campaign-mismatch",
    ) === null);
  const mismatchedCampaign = (
    mismatchedCampaignGate.observeOpeningSetupInvocation(
      "session.resume",
      { ...resumeParams, campaign: "other-campaign" },
      {
        ok: false,
        tool: "session.resume",
        error: { code: "opening_setup_incomplete" },
      },
      "minimal-opening-campaign-mismatch",
    )
  );
  check("exact minimal error cannot cross its invocation campaign",
    mismatchedCampaign.reason === "invocation_or_campaign_mismatch"
    && mismatchedCampaign.modelProjection === undefined
    && mismatchedCampaignGate.requiredOpeningSetupContinuation() === null);
}

// An explicitly selected Pi session/campaign continuation is host-gated before
// the welcome turn. The KP itself must execute the normal session.resume tool
// so the recovery result enters its context; setup discovery and tool-free
// menus cannot race ahead of that first campaign operation.
{
  const campaignId = "startup-prebound-opening";
  const baseRetainedGate = openingSetupGate(undefined, campaignId);
  const retainedGate = {
    ...baseRetainedGate,
    asset_root_id: "asset-fixture",
    instruction: "TOP_SECRET_GATE_INSTRUCTION",
    TOP_SECRET_GATE_KEY: "TOP_SECRET_GATE_VALUE",
    next_operation: {
      ...baseRetainedGate.next_operation,
      TOP_SECRET_CARD_KEY: "TOP_SECRET_CARD_VALUE",
    },
  };
  check("Pi session and explicit campaign selectors remain distinct",
    main.__test.explicitPiStartupCampaignId({
      PI_COC_SESSION_ID: "unrelated-pi-transcript",
      PI_COC_CAMPAIGN_ID: campaignId,
    }) === campaignId
    && main.__test.explicitPiStartupCampaignId({
      PI_COC_SESSION_ID: campaignId,
    }) === null);
  let invalidSelectorsRejected = true;
  for (const invalidSelector of [
    "",
    "   ",
    "--new",
    "../outside",
    "dir/campaign",
    "a".repeat(129),
  ]) {
    try {
      main.__test.explicitPiStartupCampaignId({
        PI_COC_CAMPAIGN_ID: invalidSelector,
      });
      invalidSelectorsRejected = false;
    } catch {
      // Invalid explicit selectors must not degrade to null/fresh setup.
    }
  }
  check("direct startup selector enforces canonical safe campaign grammar",
    invalidSelectorsRejected
    && main.__test.explicitPiStartupCampaignId({
      PI_COC_CAMPAIGN_ID: "A.valid_name:part-9",
    }) === "A.valid_name:part-9");
  const harness = mainExtensionHarness((name, params) => {
    if (name === "coc_capabilities") {
      return { ok: true, host: "pi" };
    }
    if (
      name === "coc_invoke"
      && params.operation === "session.resume"
    ) {
      const envelope = {
        ok: false,
        tool: "session.resume",
        error: {
          code: "opening_setup_incomplete",
          message: (
            "session.resume is unavailable until the source-bound "
            + "opening projection is current"
          ),
          details: retainedGate,
        },
      };
      throw new runtime.CanonicalToolError(
        "coc_invoke",
        "opening_setup_incomplete",
        (
          "canonical coc_invoke failed: opening_setup_incomplete: "
          + "session.resume is unavailable until the source-bound "
          + "opening projection is current"
        ),
        retainedGate,
        envelope,
      );
    }
    if (
      name === "coc_invoke"
      && params.operation === "progressive.prepare_opening"
    ) {
      return preparedOpeningSetupResult();
    }
    throw new Error(`unexpected startup call ${name}:${params.operation}`);
  }, {
    startupCampaignId: campaignId,
    sessionId: "different-pi-transcript",
    mode: "tui",
    hasUI: true,
    recordCapabilities: true,
  });
  await harness.startAll();

  const tableOpen = harness.sent.find((entry) => (
    entry.message?.customType === "coc-pi-table-open"
  ));
  check("composed startup arms gate before welcome trigger",
    harness.calls.length === 1
    && harness.calls[0].name === "coc_capabilities"
    && tableOpen?.options?.triggerTurn === true
    && messageDeclares(tableOpen?.message?.content, `"campaign":"${campaignId}"`)
    && !messageDeclares(
      tableOpen?.message?.content,
      '"campaign":"different-pi-transcript"',
    ));

  const callsBeforeRejectedSetup = harness.calls.length;
  let setupInspectRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "startup-setup-inspect",
      {
        operation: "setup.inspect",
        root,
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    setupInspectRejected = String(error).includes("session.resume");
  }
  let discoverRejected = false;
  try {
    const discovered = JSON.parse((await harness.registered.get("coc_discover").execute(
      "startup-discover",
      { operation: "scene.context" },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    discoverRejected = discovered.ok === false;
  } catch { discoverRejected = true; }
  let ocrRejected = false;
  try {
    await harness.registered.get("coc_progressive_ocr").execute(
      "startup-ocr",
      { operation: "status" },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    ocrRejected = String(error).includes("session.resume");
  }
  let takeoverRejected = false;
  try {
    await harness.registered.get("coc_dispatch_source_work").execute(
      "startup-takeover",
      { task: coordinatorTask("startup-takeover") },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    takeoverRejected = String(error).includes("session.resume");
  }
  check("startup gate rejects setup/discovery/OCR/takeover before backend",
    setupInspectRejected
    && discoverRejected
    && ocrRejected
    && takeoverRejected
    && harness.calls.length === callsBeforeRejectedSetup);

  const hiddenMenu = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "请选择继续、开卡或导入剧本。" }],
  });
  const forcedResume = harness.sent.findLast((entry) => (
    entry.message?.customType === "coc-startup-resume-required"
  ));
  check("startup gate suppresses tool-free menu and queues exact resume",
    hiddenMenu.content.every((part) => part.type !== "text")
    && forcedResume?.options?.triggerTurn === true
    && messageDeclares(forcedResume?.message?.content, `"campaign":"${campaignId}"`)
    && messageDeclares(
      forcedResume?.message?.content,
      "Before any menu, setup.inspect",
    ));

  const resumed = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("explicit startup identity makes resume the first backend campaign call",
    resumed.ok === false
    && resumed.error.code === "opening_setup_incomplete"
    && resumed.error.details.phase === "opening_selection"
    && resumed.error.message === undefined
    && resumed.error.details.asset_root_id === undefined
    && Object.keys(resumed.error.details).sort().join(",") === [
      "activation_allowed",
      "campaign_id",
      "hard_gate",
      "instruction",
      "next_operation",
      "phase",
      "schema_version",
      "status",
    ].sort().join(",")
    && Object.keys(
      resumed.error.details.next_operation,
    ).sort().join(",") === [
      "authority",
      "hard_gate",
      "invoke_via",
      "missing_arguments",
      "operation",
      "prefilled_arguments",
    ].sort().join(",")
    && harness.calls.filter((call) => call.name === "coc_invoke")[0]
      ?.params.operation === "session.resume");

  const prepared = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-prepare",
    {
      operation: "progressive.prepare_opening",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("startup prebound opening selection hydrates exact prepare route",
    prepared.ok === true
    && prepared.data.next_operation.operation
      === "progressive.opening_bootstrap"
    // No memory.extraction_status: the re-arm fires only after a resume that
    // succeeded and projected, and this scenario's resume fails closed with
    // `opening_setup_incomplete`. The expectation predated that guard.
    && harness.calls.filter((call) => (
      call.name === "coc_invoke"
    )).map((call) => call.params.operation).join(",")
      === "session.resume,progressive.prepare_opening"
    && !harness.calls.some((call) => (
      call.params.operation === "setup.inspect"
      || call.params.operation === "scenario.bind_pdf"
      || call.name === "coc_progressive_ocr"
    ))
    && !JSON.stringify(resumed).includes(
      "source-bound opening projection is current",
    )
    && !JSON.stringify(resumed).includes("TOP_SECRET")
    && !harness.sent.some((entry) => (
      entry.message?.customType === "coc-startup-resume-blocker"
    )));
  await harness.shutdown();
}

// A successful normal resume clears only the startup gate and leaves the
// returned recovery bundle in the KP's ordinary tool result/context.
{
  const campaignId = "startup-current-campaign";
  const harness = mainExtensionHarness((name, params) => {
    if (name !== "coc_invoke") {
      throw new Error(`unexpected successful startup tool ${name}`);
    }
    if (params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaignId,
          mode: "awaiting_player",
        },
      };
    }
    if (params.operation === "scene.context") {
      return {
        ok: true,
        tool: "scene.context",
        data: { campaign_id: campaignId, scene: { scene_id: "current" } },
      };
    }
    throw new Error(`unexpected successful startup call ${params.operation}`);
  }, { startupCampaignId: campaignId, sessionRole: "play" });
  await harness.start();
  const resumed = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-success-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const scene = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-success-scene",
    {
      operation: "scene.context",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("successful startup resume clears gate for normal continuation",
    resumed.ok === true
    && resumed.data.mode === "awaiting_player"
    && scene.ok === true
    && harness.calls.map((call) => call.params.operation).join(",")
      === "session.resume,memory.extraction_status,scene.context");
  await harness.shutdown();
}

// Web setup→play respawn and launcher re-exec both call session.resume on
// ready_for_table; mode table_opening must clear the startup gate so
// evidence.table_opening is not terminalized as startup_resume_result_invalid.
{
  const campaignId = "startup-table-opening-campaign";
  const harness = mainExtensionHarness((name, params) => {
    if (name !== "coc_invoke") {
      throw new Error(`unexpected table_opening startup tool ${name}`);
    }
    if (params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaignId,
          mode: "table_opening",
          next_operations: ["evidence.table_opening"],
        },
      };
    }
    if (params.operation === "evidence.table_opening") {
      return {
        ok: true,
        tool: "evidence.table_opening",
        data: { schema_version: 1, campaign_id: campaignId, text: "开场" },
      };
    }
    throw new Error(`unexpected table_opening startup call ${params.operation}`);
  }, { startupCampaignId: campaignId });
  await harness.start();
  const resumed = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-table-opening-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const opening = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-table-opening-evidence",
    {
      operation: "evidence.table_opening",
      root,
      campaign: campaignId,
      // Model-owned arguments only: decision_id and run_id are host-attached
      // for this operation, and text is required. The fixture predated both
      // and failed closed on shape before it could reach the resume gate this
      // check exists to exercise.
      arguments: {
        text: "[in_game]\n恢复后的准确开场。\n[/in_game]",
        presented_roll_ids: [],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("ready_for_table startup resume accepts table_opening and unblocks opening",
    resumed.ok === true
    && resumed.data.mode === "table_opening"
    && opening.ok === true
    && opening.tool === "evidence.table_opening"
    && !harness.sent.some((entry) => (
      entry.message?.customType === "coc-startup-resume-blocker"
    )));
  await harness.shutdown();
}

// The canonical current-source/empty-party discriminator rehydrates the same
// guided setup gate used by a fresh Pi opening. Its backend message and
// instruction never enter KP context.
{
  const campaignId = "startup-current-empty-party";
  const investigatorId = "resume-guided-investigator";
  const openingText = [
    "[in_game]",
    "【开场时间】来源约束下的清晨",
    "",
    "链接调查员后唯一释放的权威开场。",
    "[/in_game]",
  ].join("\n");
  const contractResult = {
    ok: true,
    tool: "setup.investigator_contract",
    data: {
      schema_version: 1,
      status: "PASS",
      kind: "investigator.contract",
      result: {
        ruleset_id: "coc7",
        guided_quick_fire_campaign_era: {
          status: "standard_quick_fire_available",
          supported: true,
          required_sheet_era: "1920s",
          supported_eras: ["1920s"],
          failure_code: null,
        },
        payload_schema: {
          title: "Full investigator contract",
          oneOf: [
            {
              title: "Deterministic Quick Fire input",
              properties: {
                creation: { $ref: "#/$defs/quick_fire_creation" },
              },
            },
            {
              title: "Explicit complete-sheet import",
              properties: {
                creation: { $ref: "#/$defs/complete_sheet_creation" },
              },
            },
          ],
          $defs: {
            quick_fire_creation: {
              properties: {
                input_mode: { const: "guided_quick_fire" },
              },
            },
            quick_fire_sheet: { type: "object" },
            complete_sheet_creation: {
              properties: {
                input_mode: { const: "import_complete_sheet" },
              },
            },
            complete_sheet: { type: "object" },
          },
        },
      },
    },
  };
  const characterSetupDetails = {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_character_setup_required",
    campaign_id: campaignId,
    character_setup_policy: "guided_quick_fire",
    next_operation: null,
    instruction: "TOP_SECRET_CHARACTER_SETUP_INSTRUCTION",
  };
  const characterSetupEnvelope = {
    ok: false,
    tool: "session.resume",
    error: {
      code: "opening_setup_incomplete",
      message: "TOP_SECRET_CHARACTER_SETUP_MESSAGE",
      details: characterSetupDetails,
    },
  };
  const harness = mainExtensionHarness((name, params) => {
    if (name !== "coc_invoke") {
      throw new Error(`unexpected resume-empty-party tool ${name}`);
    }
    if (params.operation === "session.resume") {
      throw new runtime.CanonicalToolError(
        "coc_invoke",
        "opening_setup_incomplete",
        "canonical coc_invoke failed: opening_setup_incomplete",
        characterSetupDetails,
        characterSetupEnvelope,
      );
    }
    if (params.operation === "setup.investigator_contract") {
      return contractResult;
    }
    if (params.operation === "rules.roll_dice") {
      return {
        ok: true,
        tool: "rules.roll_dice",
        data: {
          expression: "3D6",
          rolls: [3, 4, 4],
          total: 11,
          roll_id: "toolbox-startup-current-empty-party-000001",
        },
      };
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "investigator.create"
    ) {
      return canonicalGuidedCreateResult(investigatorId);
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "campaign.link_investigator"
    ) {
      return canonicalLinkSetupResult(campaignId, [investigatorId]);
    }
    if (params.operation === "evidence.table_opening") {
      return {
        ok: true,
        tool: "evidence.table_opening",
        data: {
          turn: 0,
          text: openingText,
          text_sha256: `sha256:${createHash("sha256").update(
            JSON.stringify(openingText),
          ).digest("hex")}`,
          authoritative_time_anchor: {
            schema_version: 1,
            display: "来源约束下的清晨",
            rendered_line: "【开场时间】来源约束下的清晨",
          },
        },
      };
    }
    throw new Error(
      `unexpected resume-empty-party call ${name}:${params.operation}`,
    );
  }, { startupCampaignId: campaignId });
  await harness.start();

  const resumed = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "resume-empty-party-first",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const resumedText = JSON.stringify(resumed);
  const allowedActions = resumed.data.opening_gate.allowed_actions;
  check("empty-party recovery rehydrates a tight guided setup projection",
    harness.calls[0]?.params.operation === "session.resume"
    && resumed.ok === true
    && resumed.data.mode === "opening_character_setup_required"
    && resumed.data.opening_gate.phase
      === "opening_character_setup_required"
    && resumed.data.opening_gate.next_operation === null
    && Array.isArray(allowedActions)
    && allowedActions.some((action) => (
      action.kind === "investigator.create"
      && action.required_creation_input_mode === "guided_quick_fire"
    ))
    && !allowedActions.some((action) => (
      action.kind === "campaign.render_briefing"
    ))
    && !resumedText.includes("import_complete_sheet")
    && !resumedText.includes("scene_context")
    && !resumedText.includes("current_turn")
    && !resumedText.includes("TOP_SECRET"));

  const callsBeforeBlockedDetours = harness.calls.length;
  let discoverBlocked = false;
  try {
    const discovered = JSON.parse((await harness.registered.get("coc_discover").execute(
      "resume-empty-party-discover",
      { operation: "scene.context" },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    discoverBlocked = discovered.ok === false;
  } catch { discoverBlocked = true; }
  let sceneBlocked = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "resume-empty-party-scene",
      {
        operation: "scene.context",
        campaign: campaignId,
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { sceneBlocked = true; }
  let importBlocked = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "resume-empty-party-import",
      {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: {
          kind: "investigator.create",
          payload: {
            investigator_id: "import-escape",
            sheet: {
              id: "import-escape",
              name: "Import Escape",
              characteristics: {},
              derived: {},
              skills: {},
            },
            creation: { input_mode: "import_complete_sheet" },
          },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { importBlocked = true; }
  let briefingBlocked = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "resume-empty-party-briefing",
      {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: {
          kind: "campaign.render_briefing",
          payload: { campaign_id: campaignId },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { briefingBlocked = true; }
  check(
    "rehydrated setup blocks discover scene briefing and complete-sheet escape",
    discoverBlocked
    && sceneBlocked
    && importBlocked
    && briefingBlocked
    && harness.calls.length === callsBeforeBlockedDetours);

  const contract = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "resume-empty-party-contract",
    {
      operation: "setup.investigator_contract",
      campaign: campaignId,
      arguments: { campaign_id: campaignId },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("Pi overlap contract exposes only applicable guided branch",
    contract.ok === true
    && contract.data.result.applicable_input_mode === "guided_quick_fire"
    && contract.data.result.payload_schema.oneOf.length === 1
    && contract.data.result.payload_schema.oneOf[0].properties.creation.$ref
      === "#/$defs/quick_fire_creation"
    && contract.data.result.payload_schema.$defs.complete_sheet === undefined
    && contract.data.result.payload_schema.$defs.complete_sheet_creation
      === undefined
    && !JSON.stringify(contract).includes("import_complete_sheet"));

  const luck = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "resume-empty-party-luck",
    {
      operation: "rules.roll_dice",
      campaign: campaignId,
      arguments: {
        expression: "3D6",
        decision_id: "roll-resume-empty-party-luck",
        purpose: "investigator_creation_luck",
        reason: "Quick-Fire investigator Luck",
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const callsBeforeFabricatedLuck = harness.calls.length;
  let fabricatedLuckRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "resume-empty-party-fabricated-luck",
      {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: {
          kind: "investigator.create",
          payload: {
            campaign_id: campaignId,
            investigator_id: "resume-fabricated-luck",
            sheet: { id: "resume-fabricated-luck", name: "Fabricated" },
            creation: {
              input_mode: "guided_quick_fire",
              method: "quick_fire_array",
              characteristic_assignment_order: [
                "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR",
              ],
              luck_roll_total: luck.data.total,
            },
          },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { fabricatedLuckRejected = true; }
  const created = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "resume-empty-party-create",
    guidedQuickFireCreateParams(campaignId, investigatorId, {
      ...luck.data,
      decision_id: "roll-resume-empty-party-luck",
    }),
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const linked = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "resume-empty-party-link",
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: {
        kind: "campaign.link_investigator",
        payload: {
          campaign_id: campaignId,
          investigator_ids: [investigatorId],
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const linkVisible = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "模型自拟链接说明。" }],
  });
  check("guided luck create and exact link arm the typed opening",
    luck.ok === true
    && fabricatedLuckRejected
    && harness.calls.length === callsBeforeFabricatedLuck + 2
    && created.data.status === "PASS"
    && linked.data.status === "PASS"
    && linkVisible.content.some((part) => (
      part.type === "text" && part.text === "调查员已正式加入战役。"
    ))
    && !harness.calls.some((call) => (
      call.params.operation === "progressive.project_opening"
    )));

  const opening = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "resume-empty-party-opening",
    {
      operation: "evidence.table_opening",
      campaign: campaignId,
      arguments: {
        text: openingText,
        presented_roll_ids: [],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const visibleOpening = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "模型自行泄露的第二份开场。" }],
  });
  check("current source opening releases exactly once after exact link",
    opening.ok === true
    && opening.data.text === openingText
    && visibleOpening.content.filter((part) => (
      part.type === "text" && part.text === openingText
    )).length === 1
    && harness.calls.filter((call) => (
      call.params.operation === "evidence.table_opening"
    )).length === 1);
  await harness.shutdown();
}

// The startup adapter must preserve the canonical producer's explicit
// character-setup discriminator, hydrate the guided gate, and clear only the
// startup resume blocker. A following allowed setup call proves the startup
// classifier did not terminalize the campaign.
{
  const campaignId = "startup-discriminated-character-setup";
  const characterDetails = {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_character_setup_required",
    campaign_id: campaignId,
    character_setup_policy: "guided_quick_fire",
    next_operation: null,
    instruction: "TOP_SECRET_BACKEND_CHARACTER_INSTRUCTION",
  };
  const canonicalEnvelope = {
    ok: false,
    tool: "session.resume",
    error: {
      code: "opening_setup_incomplete",
      message: "TOP_SECRET_BACKEND_CHARACTER_MESSAGE",
      details: characterDetails,
    },
  };
  const harness = mainExtensionHarness((name, params) => {
    if (
      name === "coc_invoke"
      && params.operation === "session.resume"
    ) {
      throw new runtime.CanonicalToolError(
        "coc_invoke",
        "opening_setup_incomplete",
        "canonical coc_invoke failed: opening_setup_incomplete",
        characterDetails,
        canonicalEnvelope,
      );
    }
    if (
      name === "coc_invoke"
      && params.operation === "setup.investigator_contract"
    ) {
      return {
        ok: true,
        tool: "setup.investigator_contract",
        data: {
          schema_version: 1,
          status: "PASS",
          kind: "investigator.contract",
          result: {
            ruleset_id: "coc7",
            payload_schema: { type: "object" },
          },
        },
      };
    }
    throw new Error(
      `unexpected discriminated startup call ${name}:${params.operation}`,
    );
  }, { startupCampaignId: campaignId });
  await harness.start();
  const resumed = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-discriminated-opening-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const contract = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-discriminated-opening-contract",
    {
      operation: "setup.investigator_contract",
      root,
      campaign: campaignId,
      arguments: { campaign_id: campaignId },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("typed character discriminator hydrates instead of terminalizing",
    resumed.ok === true
    && resumed.data.mode === "opening_character_setup_required"
    && resumed.data.opening_gate.phase
      === "opening_character_setup_required"
    && contract.ok === true
    && harness.calls.map((call) => call.params.operation).join(",")
      === "session.resume,memory.extraction_status,setup.investigator_contract"
    && !harness.sent.some((entry) => (
      entry.message?.customType === "coc-startup-resume-blocker"
    ))
    && !JSON.stringify(resumed).includes("scene_context")
    && !JSON.stringify(resumed).includes("current_turn")
    && !JSON.stringify(resumed).includes("TOP_SECRET"));
  await harness.shutdown();
}

// Rich canonical materialization details must survive the startup bridge as a
// sanitized wait gate. They must never collapse into guided character setup.
{
  const campaignId = "startup-source-materialization-wait";
  const materializationDetails = {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_source_materialization",
    asset_root_id: "TOP_SECRET_MATERIALIZATION_ASSET",
    source_lifecycle_status: "pending",
  };
  const canonicalEnvelope = {
    ok: false,
    tool: "session.resume",
    error: {
      code: "opening_setup_incomplete",
      message: "TOP_SECRET_MATERIALIZATION_MESSAGE",
      details: materializationDetails,
    },
  };
  const harness = mainExtensionHarness((name, params) => {
    if (
      name !== "coc_invoke"
      || params.operation !== "session.resume"
    ) {
      throw new Error(
        `unexpected materialization escape ${name}:${params.operation}`,
      );
    }
    throw new runtime.CanonicalToolError(
      "coc_invoke",
      "opening_setup_incomplete",
      "canonical coc_invoke failed: opening_setup_incomplete",
      materializationDetails,
      canonicalEnvelope,
    );
  }, { startupCampaignId: campaignId });
  await harness.start();
  const resumed = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-materialization-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  let setupWaitBlocked = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "startup-materialization-contract",
      {
        operation: "setup.investigator_contract",
        root,
        campaign: campaignId,
        arguments: { campaign_id: campaignId },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    setupWaitBlocked = String(error).includes(
      "opening_source_materialization",
    );
  }
  check("source materialization remains a sanitized wait-only startup gate",
    resumed.ok === false
    && resumed.error.code === "opening_setup_incomplete"
    && resumed.error.details.phase === "opening_source_materialization"
    && resumed.error.details.source_lifecycle_status === "pending"
    && resumed.error.details.asset_root_id === undefined
    && !JSON.stringify(resumed).includes("TOP_SECRET")
    && setupWaitBlocked
    && harness.calls.length === 1
    && !harness.sent.some((entry) => (
      entry.message?.customType === "coc-startup-resume-blocker"
    )));
  await harness.shutdown();
}

// A canonical invalid source contract remains fatal. The bridge may retain its
// safe phase/code discriminator, but must remove backend paths and messages and
// must never turn the failure into guided setup.
{
  const campaignId = "startup-source-contract-invalid";
  const invalidDetails = {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_source_contract_invalid",
    asset_root_id: "TOP_SECRET_INVALID_ASSET",
    source_contract_error: {
      code: "binding_invalid",
      message: "TOP_SECRET_INVALID_SOURCE_MESSAGE",
    },
  };
  const canonicalEnvelope = {
    ok: false,
    tool: "session.resume",
    error: {
      code: "opening_setup_incomplete",
      message: "TOP_SECRET_INVALID_ENVELOPE_MESSAGE",
      details: invalidDetails,
    },
  };
  const harness = mainExtensionHarness((name, params) => {
    if (
      name !== "coc_invoke"
      || params.operation !== "session.resume"
    ) {
      throw new Error(
        `unexpected invalid-source escape ${name}:${params.operation}`,
      );
    }
    throw new runtime.CanonicalToolError(
      "coc_invoke",
      "opening_setup_incomplete",
      "canonical coc_invoke failed: opening_setup_incomplete",
      invalidDetails,
      canonicalEnvelope,
    );
  }, { startupCampaignId: campaignId });
  await harness.start();
  const resumed = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "startup-invalid-source-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const blocker = harness.sent.find((entry) => (
    entry.message?.customType === "coc-startup-resume-blocker"
  ));
  check("invalid source contract remains sanitized and terminal",
    resumed.ok === false
    && resumed.error.code === "opening_setup_incomplete"
    && resumed.error.details.phase === "opening_source_contract_invalid"
    && resumed.error.details.source_contract_error.code === "binding_invalid"
    && resumed.error.details.source_contract_error.message === undefined
    && resumed.error.details.asset_root_id === undefined
    && blocker?.message?.details?.failure_class
      === "opening_source_contract_invalid"
    && !JSON.stringify(resumed).includes("TOP_SECRET")
    && !JSON.stringify(blocker).includes("TOP_SECRET")
    && !JSON.stringify(resumed).includes(
      "opening_character_setup_required",
    ));
  await harness.shutdown();
}

// Terminal startup failures never become hidden retry loops. The host emits
// one fixed blocker, keeps every campaign/source route closed, and never
// exposes backend/provider text or triggers another model turn.
for (const terminalCase of [
  {
    label: "exact live detail-free opening error",
    expectedFailure: "opening_setup_incomplete",
    throwCanonical: true,
    response: {
      ok: false,
      tool: "session.resume",
      error: { code: "opening_setup_incomplete" },
    },
  },
  {
    label: "character phase without canonical discriminator",
    expectedFailure: "opening_setup_incomplete",
    throwCanonical: true,
    response: {
      ok: false,
      tool: "session.resume",
      error: {
        code: "opening_setup_incomplete",
        message: "TOP_SECRET_AMBIGUOUS_CHARACTER_PHASE",
        details: {
          schema_version: 1,
          status: "blocked",
          hard_gate: true,
          activation_allowed: false,
          phase: "opening_character_setup_required",
          campaign_id: "startup-terminal-campaign",
        },
      },
    },
  },
  {
    label: "unknown campaign",
    expectedFailure: "unknown_campaign",
    throwCanonical: true,
    response: {
      ok: false,
      tool: "session.resume",
      error: {
        code: "unknown_campaign",
        message: "TOP_SECRET_UNKNOWN_CAMPAIGN_DETAIL",
        details: {
          internal_path: "/TOP_SECRET_UNKNOWN_PATH",
          diagnostic: "TOP_SECRET_UNKNOWN_DIAGNOSTIC",
        },
      },
    },
  },
  {
    label: "canonical context conflict",
    expectedFailure: "context_epoch_conflict",
    throwCanonical: true,
    response: {
      ok: false,
      tool: "session.resume",
      error: {
        code: "context_epoch_conflict",
        message: "TOP_SECRET_CONTEXT_CONFLICT_DETAIL",
        details: {
          provider: "TOP_SECRET_CONTEXT_PROVIDER",
          nested: { raw: "TOP_SECRET_CONTEXT_NESTED" },
        },
      },
    },
  },
  {
    label: "typed wrong envelope tool",
    expectedFailure: "startup_resume_result_invalid",
    throwCanonical: true,
    response: {
      ok: false,
      tool: "scene.context",
      error: {
        code: "opening_setup_incomplete",
        message: "TOP_SECRET_WRONG_TOOL_DETAIL",
        details: openingSetupGate(
          undefined,
          "startup-terminal-campaign",
        ),
      },
    },
  },
  {
    label: "typed missing envelope tool",
    expectedFailure: "startup_resume_result_invalid",
    throwCanonical: true,
    response: {
      ok: false,
      error: {
        code: "opening_setup_incomplete",
        message: "TOP_SECRET_MISSING_TOOL_DETAIL",
        details: openingSetupGate(
          undefined,
          "startup-terminal-campaign",
        ),
      },
    },
  },
  {
    label: "typed and envelope code mismatch",
    expectedFailure: "startup_resume_result_invalid",
    throwCanonical: true,
    typedCode: "context_epoch_conflict",
    response: {
      ok: false,
      tool: "session.resume",
      error: {
        code: "unknown_campaign",
        message: "TOP_SECRET_CODE_MISMATCH_DETAIL",
      },
    },
  },
  {
    label: "typed and envelope details mismatch",
    expectedFailure: "startup_resume_result_invalid",
    throwCanonical: true,
    typedDetails: openingSetupGate(
      undefined,
      "startup-terminal-campaign",
    ),
    response: {
      ok: false,
      tool: "session.resume",
      error: {
        code: "opening_setup_incomplete",
        message: "TOP_SECRET_DETAILS_MISMATCH_DETAIL",
        details: openingSetupGate(
          undefined,
          "startup-terminal-campaign",
        ),
      },
    },
  },
  {
    label: "wrong tool envelope",
    expectedFailure: "startup_resume_result_invalid",
    response: {
      ok: true,
      tool: "scene.context",
      data: {
        schema_version: 1,
        campaign_id: "startup-terminal-campaign",
        mode: "awaiting_player",
      },
    },
  },
  {
    label: "malformed resume envelope",
    expectedFailure: "startup_resume_result_invalid",
    response: {
      ok: true,
      tool: "session.resume",
      data: {
        campaign_id: "startup-terminal-campaign",
        mode: "awaiting_player",
      },
    },
  },
  {
    label: "campaign mismatch",
    expectedFailure: "startup_resume_campaign_mismatch",
    response: {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: "wrong-campaign",
        mode: "awaiting_player",
      },
    },
  },
  {
    label: "transport failure",
    expectedFailure: "startup_resume_transport_failed",
    transportFailure: true,
  },
]) {
  const campaignId = "startup-terminal-campaign";
  const harness = mainExtensionHarness((name, params) => {
    if (name !== "coc_invoke" || params.operation !== "session.resume") {
      throw new Error(`unexpected terminal startup escape ${name}`);
    }
    if (terminalCase.transportFailure) {
      throw new Error("TOP_SECRET_TRANSPORT_DETAIL");
    }
    if (terminalCase.throwCanonical) {
      const typedCode = (
        terminalCase.typedCode
        ?? terminalCase.response.error.code
      );
      const typedDetails = Object.hasOwn(
        terminalCase,
        "typedDetails",
      )
        ? terminalCase.typedDetails
        : terminalCase.response.error.details ?? null;
      throw new runtime.CanonicalToolError(
        "coc_invoke",
        typedCode,
        (
          "canonical coc_invoke failed: "
          + `${typedCode}: `
          + terminalCase.response.error.message
        ),
        typedDetails,
        terminalCase.response,
      );
    }
    return terminalCase.response;
  }, { startupCampaignId: campaignId, sessionRole: "play" });
  await harness.start();
  let resumeToolOutput = null;
  try {
    resumeToolOutput = JSON.parse((await harness.registered.get(
      "coc_invoke",
    ).execute(
      `terminal-resume-${terminalCase.label}`,
      {
        operation: "session.resume",
        root,
        campaign: campaignId,
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
  } catch {
    // Transport failure is surfaced to the tool caller after the host blocker
    // has already terminalized the startup gate.
  }

  const backendCallsAfterFailure = harness.calls.length;
  for (const [invocationId, params] of [
    [
      `terminal-scene-${terminalCase.label}`,
      {
        operation: "scene.context",
        root,
        campaign: campaignId,
        arguments: {},
      },
    ],
    [
      `terminal-retry-${terminalCase.label}`,
      {
        operation: "session.resume",
        root,
        campaign: campaignId,
        arguments: {},
      },
    ],
    [
      `terminal-prepare-${terminalCase.label}`,
      {
        operation: "progressive.prepare_opening",
        root,
        campaign: campaignId,
        arguments: {},
      },
    ],
  ]) {
    try {
      await harness.registered.get("coc_invoke").execute(
        invocationId,
        params,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch {
      // Both are expected to remain host-blocked without backend entry.
    }
  }
  const hiddenAfterFailure = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "TOP_SECRET_MODEL_RETRY_MENU" }],
  });
  const secondHiddenAfterFailure = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "再次尝试继续。" }],
  });
  const blockers = harness.sent.filter((entry) => (
    entry.message?.customType === "coc-startup-resume-blocker"
  ));
  check(`${terminalCase.label}: one fixed blocker and no retry escape`,
    backendCallsAfterFailure === 1
    && harness.calls.length === backendCallsAfterFailure
    && blockers.length === 1
    && blockers[0].options?.triggerTurn === false
    && blockers[0].message?.details?.failure_class
      === terminalCase.expectedFailure
    && blockers[0].message?.content.includes(
      "pi-coc --campaign <正确的 campaign_id>",
    )
    && !JSON.stringify(blockers[0]).includes("TOP_SECRET")
    && !JSON.stringify(harness.sent).includes("TOP_SECRET")
    && !JSON.stringify(harness.appended).includes("TOP_SECRET")
    && (
      terminalCase.throwCanonical !== true
      || (
        resumeToolOutput?.error?.code === terminalCase.expectedFailure
        && resumeToolOutput?.error?.message === undefined
        && resumeToolOutput?.error?.details === undefined
        && !JSON.stringify(resumeToolOutput).includes("TOP_SECRET")
      )
    )
    && hiddenAfterFailure.content.every((part) => part.type !== "text")
    && secondHiddenAfterFailure.content.every(
      (part) => part.type !== "text",
    )
    && harness.sent.filter((entry) => (
      entry.options?.triggerTurn === true
    )).length === 0);
  await harness.shutdown();
}

// Publication ownership transfers only after sendMessage succeeds. One failed
// blocker send is retried once at the next external transcript boundary, then
// deduplicated without another model turn or backend escape.
{
  const campaignId = "startup-blocker-retry";
  const harness = mainExtensionHarness(() => ({
    ok: false,
    tool: "session.resume",
    error: {
      code: "unknown_campaign",
      message: "TOP_SECRET_BLOCKER_RETRY_DETAIL",
    },
  }), {
    startupCampaignId: campaignId,
    sessionRole: "play",
    sendFailuresByType: { "coc-startup-resume-blocker": 1 },
  });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "startup-blocker-retry-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  let blockedAfterFailedSend = false;
  try {
    const discovered = JSON.parse((await harness.registered.get("coc_discover").execute(
      "startup-blocker-retry-discover",
      { operation: "scene.context" },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    blockedAfterFailedSend = discovered.ok === false;
  } catch { blockedAfterFailedSend = true; }
  const firstBoundary = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "TOP_SECRET_RETRY_BOUNDARY" }],
  });
  const secondBoundary = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "重复边界" }],
  });
  const blockerAttempts = harness.sendAttempts.filter((entry) => (
    entry.customType === "coc-startup-resume-blocker"
  ));
  const blockers = harness.sent.filter((entry) => (
    entry.message?.customType === "coc-startup-resume-blocker"
  ));
  check("failed blocker send retries once and publishes exactly once",
    blockedAfterFailedSend
    && harness.calls.length === 1
    && blockerAttempts.length === 2
    && blockers.length === 1
    && blockers[0].options?.triggerTurn === false
    && !JSON.stringify(blockers[0]).includes("TOP_SECRET")
    && firstBoundary.content.every((part) => part.type !== "text")
    && secondBoundary.content.every((part) => part.type !== "text")
    && harness.sendAttempts.every((entry) => (
      entry.options?.triggerTurn !== true
    )));
  await harness.shutdown();
}

// A permanently failing blocker channel makes at most the initial attempt plus
// one external-boundary retry. It never unlocks the startup gate or spins.
{
  const campaignId = "startup-blocker-permanent-failure";
  const harness = mainExtensionHarness(() => ({
    ok: false,
    tool: "session.resume",
    error: {
      code: "unknown_campaign",
      message: "TOP_SECRET_PERMANENT_SEND_DETAIL",
    },
  }), {
    startupCampaignId: campaignId,
    sessionRole: "play",
    sendFailuresByType: { "coc-startup-resume-blocker": 99 },
  });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "startup-blocker-permanent-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const suppressed = [];
  for (const text of ["边界一", "边界二", "边界三"]) {
    suppressed.push(await harness.emit("message_end", {
      role: "assistant",
      content: [{ type: "text", text }],
    }));
  }
  let stillBlocked = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "startup-blocker-permanent-scene",
      {
        operation: "scene.context",
        root,
        campaign: campaignId,
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch {
    stillBlocked = true;
  }
  const blockerAttempts = harness.sendAttempts.filter((entry) => (
    entry.customType === "coc-startup-resume-blocker"
  ));
  check("permanent blocker send failure stays bounded and fail-closed",
    stillBlocked
    && harness.calls.length === 1
    && blockerAttempts.length === 2
    && harness.sent.filter((entry) => (
      entry.message?.customType === "coc-startup-resume-blocker"
    )).length === 0
    && suppressed.every((message) => (
      message.content.every((part) => part.type !== "text")
    ))
    && harness.sendAttempts.every((entry) => (
      entry.options?.triggerTurn !== true
    )));
  await harness.shutdown();
}

// Pending exact-resume follow-up ownership also commits only after a
// successful send, allowing one later transcript boundary to recover.
{
  const campaignId = "startup-hidden-followup-retry";
  const hiddenResumeType = "coc-startup-resume-required";
  const harness = mainExtensionHarness(() => {
    throw new Error("backend must not be reached by hidden follow-up test");
  }, {
    startupCampaignId: campaignId,
    sendFailuresByType: { [hiddenResumeType]: 1 },
    mode: "tui",
    hasUI: true,
  });
  await harness.start();
  for (const text of ["第一次无工具响应", "第二次无工具响应", "第三次无工具响应"]) {
    await harness.emit("message_end", {
      role: "assistant",
      content: [{ type: "text", text }],
    });
  }
  const hiddenAttempts = harness.sendAttempts.filter((entry) => (
    entry.customType === hiddenResumeType
  ));
  const hiddenDelivered = harness.sent.filter((entry) => (
    entry.message?.customType === hiddenResumeType
  ));
  check("failed hidden resume follow-up retains delivery ownership",
    harness.calls.length === 0
    && hiddenAttempts.length === 2
    && hiddenDelivered.length === 1
    && hiddenDelivered[0].options?.triggerTurn === true);
  await harness.shutdown();
}

// With no explicit PI_COC_CAMPAIGN_ID/startup identity, the original empty
// workspace onboarding remains open: setup.inspect is the first normal call.
{
  const oldTableOpen = [
    "pi-coc table open: COC mode is already active on this dedicated desktop.",
    "Do not ask the player to activate COC.",
    "Follow coc-main now: call coc_setup with setup.inspect and read its",
    "result.campaigns (campaign_id + title) so you can list existing campaigns;",
    "never guess or invent a campaign_id, and never call session.resume until",
    "the player picked a listed campaign or stated an exact id.",
    "Do NOT call coc_discover or the hidden coc_invoke gateway: the live KP",
    "surface is the domain tools (coc_setup / coc_context / coc_rules / ",
    "coc_state / …). Use coc_setup for setup.inspect, setup.quick_start,",
    "setup.invoke, setup.investigator_contract, and session.resume. Call",
    "setup.inspect exactly once via coc_setup, present its result, then wait",
    "greet in zh-Hans, and offer continue (from the listed campaigns) /",
    "built-in starter quick_start / create investigator.",
    "Begin the onboarding or continuation immediately.",
  ].join(" ");
  const harness = mainExtensionHarness((name, params) => {
    if (name === "coc_capabilities") {
      return { ok: true, host: "pi" };
    }
    if (name === "coc_invoke" && params.operation === "setup.inspect") {
      return {
        ok: true,
        tool: "setup.inspect",
        data: { result: { campaigns: [] } },
      };
    }
    throw new Error(`unexpected empty-workspace call ${name}`);
  }, {
    mode: "tui",
    hasUI: true,
    recordCapabilities: true,
  });
  await harness.startAll();
  const tableOpen = harness.sent.find((entry) => (
    entry.message?.customType === "coc-pi-table-open"
  ));
  check("absent selector preserves composed welcome bytes",
    harness.calls.length === 1
    && harness.calls[0].name === "coc_capabilities"
    && tableOpen?.message?.content === oldTableOpen);
  const inspected = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "empty-workspace-inspect",
    {
      operation: "setup.inspect",
      root,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("absent startup identity preserves empty-workspace setup.inspect",
    inspected.ok === true
    && harness.calls.length === 2
    && harness.calls[1].params.operation === "setup.inspect"
    && main.__test.explicitPiStartupCampaignId({}) === null);
  await harness.shutdown();
}

// Route progress and clearing are campaign-local even when two source binds
// complete in the same Pi session.
{
  const gate = playOpeningGate();
  bindOpeningRoute(gate, "campaign-a", "campaign-local-bind-a");
  prepareOpeningRoute(gate, "campaign-a", "campaign-local-prepare-a");
  bindOpeningRoute(gate, "campaign-b", "campaign-local-bind-b");
  const routeA = gate.openingSetupToolError("coc_invoke", {
    operation: "scene.context",
    campaign: "campaign-a",
    arguments: {},
  }, "campaign-local-probe-a");
  const routeB = gate.openingSetupToolError("coc_invoke", {
    operation: "scene.context",
    campaign: "campaign-b",
    arguments: {},
  }, "campaign-local-probe-b");
  check("campaign-local routes retain independent monotonic phases",
    routeA?.includes('"operation":"progressive.opening_bootstrap"')
    && routeB?.includes('"operation":"progressive.prepare_opening"'));

  observeOwnedOpeningInvocation(
    gate,
    "campaign-local-current-a",
    bootstrapOpeningParams("campaign-a"),
    openingBootstrapWithoutTakeover(
      coordinatorTask("coord-campaign-a-current"),
      "current",
    ),
  );
  check("current opening advances only its campaign to table evidence",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "campaign-a",
      arguments: {},
    }, "campaign-local-after-current-a")?.includes(
      '"operation":"evidence.table_opening"',
    )
    && gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "campaign-b",
      arguments: {},
    }, "campaign-local-after-current-b")?.includes(
      '"operation":"progressive.prepare_opening"',
    ));
}

// A selection-phase bootstrap that is already current has authoritative
// character-link provenance. It advances directly to exact table evidence and
// rejects attempts to reopen character setup.
{
  const gate = playOpeningGate();
  bindOpeningRoute(gate, "current-before-link", "current-before-link-bind");
  prepareOpeningRoute(
    gate,
    "current-before-link",
    "current-before-link-prepare",
  );
  observeOwnedOpeningInvocation(
    gate,
    "current-before-link-bootstrap",
    bootstrapOpeningParams("current-before-link"),
    openingBootstrapWithoutTakeover(
      coordinatorTask("current-before-link-task", {
        campaignId: "current-before-link",
      }),
      "current",
    ),
  );
  const currentSceneError = gate.openingSetupToolError("coc_invoke", {
    operation: "scene.context",
    campaign: "current-before-link",
    arguments: {},
  }, "current-before-link-scene");
  const currentCreateError = gate.openingSetupToolError(
    "coc_invoke",
    guidedQuickFireCreateParams(
      "current-before-link",
      "current-before-link-investigator",
    ),
    "current-before-link-create-detour",
  );
  const currentLinkError = gate.openingSetupToolError("coc_invoke", {
    operation: "setup.invoke",
    campaign: "current-before-link",
    arguments: {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: "current-before-link",
        investigator_ids: ["current-before-link-investigator"],
      },
    },
  }, "current-before-link-link-detour");
  check("immediate current retains table evidence and rejects character detours",
    [currentSceneError, currentCreateError, currentLinkError].every((error) => (
      error?.includes('"operation":"evidence.table_opening"')
    ))
    && gate.openingSetupToolError("coc_invoke", {
      operation: "evidence.table_opening",
      campaign: "current-before-link",
      arguments: {
        text: "[in_game]\n来源约束下的准确开场。\n[/in_game]",
        presented_roll_ids: [],
      },
    }, "current-before-link-evidence") === null);
}

// Completion-bearing links are causally bound to a successful guided create
// receipt in this exact gate generation. Failed/mismatched creates, wrong
// linked IDs, and receipts retired with an older generation never qualify.
{
  const gate = playOpeningGate();
  const campaignId = "guided-create-causality";
  bindReviewedCharacterRoute(gate, campaignId, "causal-generation-1");
  const failedCreate = observeCanonicalGuidedCreate(
    gate,
    campaignId,
    "failed-create-investigator",
    "causal-failed-create",
    {
      ok: false,
      tool: "setup.invoke",
      error: { code: "setup_failed" },
    },
  );
  const mismatchedIdCreate = observeCanonicalGuidedCreate(
    gate,
    campaignId,
    "mismatched-id-investigator",
    "causal-mismatched-id-create",
    canonicalGuidedCreateResult("different-result-investigator"),
  );
  const mismatchedCampaignCreate = observeCanonicalGuidedCreate(
    gate,
    campaignId,
    "mismatched-campaign-investigator",
    "causal-mismatched-campaign-create",
    canonicalGuidedCreateResult(
      "mismatched-campaign-investigator",
      {
        result: {
          campaign_id: "wrong-campaign",
          investigator_id: "mismatched-campaign-investigator",
        },
      },
    ),
  );
  const unqualifiedLink = (investigatorId, invocationId) => (
    gate.openingSetupToolError(
      "coc_invoke",
      {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: {
          kind: "campaign.link_investigator",
          payload: {
            campaign_id: campaignId,
            investigator_ids: [investigatorId],
          },
        },
      },
      invocationId,
    )
  );
  check("failed and mismatched create receipts cannot qualify a link",
    failedCreate.accepted === false
    && mismatchedIdCreate.accepted === false
    && mismatchedCampaignCreate.accepted === false
    && unqualifiedLink(
      "failed-create-investigator",
      "causal-failed-link",
    ) !== null
    && unqualifiedLink(
      "mismatched-id-investigator",
      "causal-mismatched-id-link",
    ) !== null
    && unqualifiedLink(
      "mismatched-campaign-investigator",
      "causal-mismatched-campaign-link",
    ) !== null);

  const currentCreated = observeCanonicalGuidedCreate(
    gate,
    campaignId,
    "current-created-investigator",
    "causal-current-create",
  );
  check("successful create qualifies only its exact investigator id",
    currentCreated.accepted === true
    && unqualifiedLink(
      "wrong-linked-investigator",
      "causal-wrong-id-link",
    ) !== null);

  gate.clearOpeningSetupRoute(campaignId);
  bindReviewedCharacterRoute(gate, campaignId, "causal-generation-2");
  const oldGenerationLink = unqualifiedLink(
    "current-created-investigator",
    "causal-old-generation-link",
  );
  check("retired generation create receipt cannot unlock new opening route",
    oldGenerationLink?.includes(
      '"requires_current_opening_receipt":'
      + '"investigator.create:guided_quick_fire"',
    )
    && gate.openingSetupToolError(
      "coc_invoke",
      {
        operation: "scene.context",
        campaign: campaignId,
        arguments: {},
      },
      "causal-new-generation-scene",
    )?.includes('"phase":"opening_character_setup_required"'));
}

// Character creation is completed from reviewed source before opening work is
// submitted. Once the exact link releases selection, the background lifecycle
// is append-only and cannot be used to reopen character setup.
{
  const gate = playOpeningGate();
  const campaignId = "submitting-character-overlap";
  bindReviewedCharacterRoute(gate, campaignId, "submitting-overlap-source");

  const contractParams = {
    operation: "setup.investigator_contract",
    campaign: campaignId,
    arguments: { campaign_id: campaignId },
  };
  const briefingParams = {
    operation: "setup.invoke",
    campaign: campaignId,
    arguments: {
      kind: "campaign.render_briefing",
      payload: { campaign_id: campaignId, language: "zh-Hans" },
    },
  };
  const luckParams = {
    operation: "rules.roll_dice",
    campaign: campaignId,
    arguments: {
      expression: "3D6",
      decision_id: "roll-submitting-overlap-luck",
      purpose: "investigator_creation_luck",
    },
  };
  const cashParams = {
    operation: "rules.cash_assets",
    campaign: campaignId,
    arguments: { credit_rating: 40, period: "1920s" },
  };
  const createParams = {
    operation: "setup.invoke",
    campaign: campaignId,
    arguments: {
      kind: "investigator.create",
      payload: {
        campaign_id: campaignId,
        investigator_id: "submitting-overlap-investigator",
        sheet: {
          id: "submitting-overlap-investigator",
          name: "Overlap Investigator",
        },
        creation: {
          input_mode: "guided_quick_fire",
          method: "quick_fire_array",
          characteristic_assignment_order: [
            "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR",
          ],
          luck_roll_total: 12,
          luck_roll_receipt: {
            campaign_id: campaignId,
            decision_id: "roll-submitting-overlap-luck",
            roll_id: "toolbox-submitting-overlap-000001",
          },
        },
      },
    },
  };
  for (const [id, params] of [
    ["submitting-overlap-contract", contractParams],
    ["submitting-overlap-briefing", briefingParams],
    ["submitting-overlap-luck-call", luckParams],
    ["submitting-overlap-cash", cashParams],
    ["submitting-overlap-create", createParams],
  ]) {
    check(`submitting phase admits exact canonical character action ${id}`,
      gate.openingSetupToolError("coc_invoke", params, id) === null);
  }
  const submittingCreateObserved = gate.observeOpeningSetupInvocation(
    "setup.invoke",
    createParams,
    canonicalGuidedCreateResult("submitting-overlap-investigator"),
    "submitting-overlap-create",
  );
  check("submitting create receipt establishes current link eligibility",
    submittingCreateObserved.accepted === true);

  const rejectedOperations = [
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: {
        kind: "actor.create",
        payload: {
          campaign_id: campaignId,
          actor_id: "not-an-investigator",
          sheet: {},
        },
      },
    },
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: {
        kind: "investigator.create",
        payload: {
          campaign_id: campaignId,
          investigator_id: "imported-investigator",
          sheet: { id: "imported-investigator", name: "Imported" },
          creation: { input_mode: "import_complete_sheet" },
        },
      },
    },
    {
      operation: "investigator.create",
      campaign: campaignId,
      arguments: {},
    },
    {
      operation: "rules.roll",
      campaign: campaignId,
      arguments: {},
    },
    {
      operation: "scene.context",
      campaign: campaignId,
      arguments: {},
    },
  ];
  const rejectedMessages = rejectedOperations.map((params, index) => (
    gate.openingSetupToolError(
      "coc_invoke",
      params,
      `submitting-overlap-rejected-${index}`,
    )
  ));
  check("submitting phase rejects actor import standalone and live near misses",
    rejectedMessages.every((message) => typeof message === "string")
    && rejectedMessages.every((message) => (
      message.includes('"allowed_actions"')
      && message.includes('"kind":"investigator.create"')
      && message.includes('"kind":"campaign.link_investigator"')
      && message.includes('"purpose":"investigator_creation_luck"')
      && !message.includes('"kind":"actor.create"')
      && !message.includes("import_complete_sheet")
    )));

  // A refused create must name the fields that failed. Echoing only the route
  // is unfixable at the table: it is what stalled the vfy2 opening for three
  // player turns across roughly twenty live payloads.
  let createNearMissIndex = 0;
  const createNearMiss = (creation) => gate.openingSetupToolError(
    "coc_invoke",
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: {
        kind: "investigator.create",
        payload: {
          campaign_id: campaignId,
          investigator_id: "submitting-overlap-near-miss",
          sheet: { id: "submitting-overlap-near-miss", name: "Near Miss" },
          creation,
        },
      },
    },
    `submitting-overlap-near-miss-${createNearMissIndex++}`,
  );
  const missingReceipt = createNearMiss({
    input_mode: "guided_quick_fire",
    method: "quick_fire_array",
    characteristic_assignment_order: [
      "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR",
    ],
    luck_roll_total: 12,
  });
  check("create refusal names the missing luck receipt and its rules.roll_dice source",
    typeof missingReceipt === "string"
    && missingReceipt.includes("creation.luck_roll_receipt")
    && missingReceipt.includes("rules.roll_dice")
    && missingReceipt.includes('"allowed_actions"'));

  const wrongShape = createNearMiss({
    input_mode: "guided_quick_fire",
    method: "quick_fire",
    characteristic_assignment_order: ["DEX", "INT", "POW"],
    luck_roll_total: 12,
    luck_roll_receipt: {
      campaign_id: campaignId,
      decision_id: "roll-submitting-overlap-luck",
      roll_id: "toolbox-submitting-overlap-000001",
      total: 12,
    },
  });
  check("create refusal names every failing field at once without echoing values",
    typeof wrongShape === "string"
    && wrongShape.includes("creation.method")
    && wrongShape.includes("creation.characteristic_assignment_order")
    && wrongShape.includes("creation.luck_roll_receipt")
    && !wrongShape.includes('"quick_fire"'));

  const linkParams = {
    operation: "setup.invoke",
    campaign: campaignId,
    arguments: {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: campaignId,
        investigator_ids: ["submitting-overlap-investigator"],
      },
    },
  };
  observeOwnedOpeningInvocation(
    gate,
    "submitting-overlap-link",
    linkParams,
    canonicalLinkSetupResult(
      campaignId,
      ["submitting-overlap-investigator"],
    ),
  );
  const linkedVisible = gate.acceptVisibleAssistantFinal(
    "模型自拟的链接完成说明。",
  );
  check("reviewed character link releases canonical opening selection",
    replacementIs(linkedVisible, "调查员已正式加入战役。")
    && gate.requiredOpeningSetupContinuation()?.next_operation?.operation
      === "progressive.prepare_opening");

  prepareOpeningRoute(gate, campaignId, "submitting-overlap-prepare");
  const bootstrapParams = bootstrapOpeningParams(campaignId);
  const bootstrapId = "submitting-overlap-bootstrap";
  const task = coordinatorTask("submitting-overlap-task", { campaignId });
  check("submitting overlap bootstrap is admitted",
    gate.openingSetupToolError(
      "coc_invoke",
      bootstrapParams,
      bootstrapId,
    ) === null);
  const observedBootstrap = gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    bootstrapParams,
    openingBootstrapResult(task),
    bootstrapId,
  );
  check("submitting overlap background starts before coordinator submit",
    observedBootstrap.dispatchAllowed
    && gate.beginOpeningBackground(
      bootstrapId,
      bootstrapParams,
      task.packet.packet_id,
      {
        operation: "progressive.project_opening",
        campaign: campaignId,
        arguments: {
          asset_root_id: task.packet.asset_root_id,
          source_file_sha256: "a".repeat(64),
          start_location_id: "opening",
          opening_pdf_indices: [0],
        },
      },
    ));
  const submittingDetours = [contractParams, briefingParams, luckParams,
    cashParams, createParams].map((params, index) => (
    gate.openingSetupToolError(
      "coc_invoke",
      params,
      `submitting-overlap-current-detour-${index}`,
    )
  ));
  check("submitting phase cannot reopen completed character setup",
    submittingDetours.every((message) => typeof message === "string")
    && gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: campaignId,
      arguments: {},
    }, "submitting-overlap-route-probe")?.includes(
      '"phase":"opening_source_materialization"',
    ));

  check("coordinator submission advances overlap without changing its route",
    gate.markOpeningBackgroundSubmitted(
      bootstrapId,
      bootstrapParams,
      task.packet.packet_id,
    ).status === "submitted");
  gate.observeOpeningCoordinatorTerminal({
    packet_id: task.packet.packet_id,
    status: "fulfilled",
  });
  const stillBlocked = gate.openingSetupToolError(
    "coc_invoke",
    {
      operation: "scene.context",
      campaign: campaignId,
      arguments: {},
    },
    "submitting-overlap-scene-after-link",
  );
  const repeatedContractBlocked = gate.openingSetupToolError(
    "coc_invoke",
    contractParams,
    "submitting-overlap-contract-after-link",
  );
  const postLinkCardParams = {
    operation: "setup.invoke",
    campaign: campaignId,
    arguments: {
      kind: "investigator.render_card",
      payload: {
        campaign_id: campaignId,
        investigator_id: "submitting-overlap-investigator",
      },
    },
  };
  const postLinkCardAllowed = gate.openingSetupToolError(
    "coc_invoke",
    postLinkCardParams,
    "submitting-overlap-card-after-link",
  );
  const releasedProjection = gate.requiredOpeningSetupContinuation();
  check("exact link releases only the retained current-source projector",
    replacementIs(linkedVisible, "调查员已正式加入战役。")
    && stillBlocked?.includes('"operation":"progressive.project_opening"')
    && repeatedContractBlocked?.includes(
      '"operation":"progressive.project_opening"',
    )
    && postLinkCardAllowed === null
    && releasedProjection?.next_operation?.operation
      === "progressive.project_opening");
}

{
  const gate = playOpeningGate();
  bindReviewedCharacterRoute(
    gate,
    "terminal-before-link",
    "terminal-before-link-source",
  );
  gate.markAgentStart();
  const projectionParams = {
    operation: "progressive.project_opening",
    campaign: "terminal-before-link",
    arguments: {
      asset_root_id: "asset-auto",
      source_file_sha256: "a".repeat(64),
      start_location_id: "opening",
      opening_pdf_indices: [0],
    },
  };
  const prematureOpening = (
    "公元1135年的冬夜，你抵达舍伯恩；石墙外积雪齐踝，"
    + "远处修道院的钟声正报出午夜。"
  );
  check("reviewed source blocks projection while allowing KP character conversation",
    gate.openingSetupToolError(
      "coc_invoke",
      projectionParams,
      "terminal-before-link-project",
    )?.includes("campaign.link_investigator")
    && gate.acceptVisibleAssistantFinal(prematureOpening) === true);
  const incompleteCreateError = gate.openingSetupToolError(
    "coc_invoke",
    {
      operation: "setup.invoke",
      campaign: "terminal-before-link",
      arguments: {
        kind: "investigator.create",
        payload: {
          campaign_id: "terminal-before-link",
          investigator_id: "terminal-before-link-investigator",
          sheet: { name: "Incomplete" },
          creation: {
            characteristic_assignment_order: ["DEX"],
            luck_roll_total: 9,
          },
        },
      },
    },
    "terminal-before-link-incomplete-create",
  );
  check("reviewed character setup keeps projection private before exact link",
    incompleteCreateError?.includes("campaign.link_investigator")
    && !incompleteCreateError.includes("progressive.project_opening")
    && gate.requiredOpeningSetupContinuation() === null
    && gate.acceptVisibleAssistantFinal(prematureOpening) === true);
  const briefingParams = {
    operation: "setup.invoke",
    campaign: "terminal-before-link",
    arguments: {
      kind: "campaign.render_briefing",
      payload: {
        campaign_id: "terminal-before-link",
        language: "zh-Hans",
      },
    },
  };
  check("canonical player-safe briefing remains admitted after source review",
    gate.openingSetupToolError(
      "coc_invoke",
      briefingParams,
      "terminal-before-link-briefing",
    ) === null);
  const briefed = gate.observeOpeningSetupInvocation(
    "setup.invoke",
    briefingParams,
    {
      ok: true,
      tool: "setup.invoke",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "campaign.render_briefing",
        result: {
          campaign_id: "terminal-before-link",
          briefing_path: (
            ".coc/campaigns/terminal-before-link/assets/character-creation/"
            + "briefing.md"
          ),
          language: "zh-Hans",
          public_setup_sha256: "b".repeat(64),
        },
      },
    },
    "terminal-before-link-briefing",
  );
  check("fabricated briefing envelope grants no visible provenance",
    briefed.accepted === false
    && gate.requiredOpeningSetupContinuation() === null
    && gate.acceptVisibleAssistantFinal(prematureOpening) === true);
  const createParams = {
    operation: "setup.invoke",
    campaign: "terminal-before-link",
    arguments: {
      kind: "investigator.create",
      payload: {
        campaign_id: "terminal-before-link",
        investigator_id: "terminal-before-link-investigator",
        sheet: {
          id: "terminal-before-link-investigator",
          name: "Exact Character",
        },
        creation: {
          input_mode: "guided_quick_fire",
          method: "quick_fire_array",
          characteristic_assignment_order: [
            "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR",
          ],
          luck_roll_total: 12,
          luck_roll_receipt: {
            campaign_id: "terminal-before-link",
            decision_id: "roll-terminal-before-link-luck",
            roll_id: "toolbox-terminal-before-link-000001",
          },
        },
      },
    },
  };
  check("Pi live opening rejects model-selected complete-sheet import",
    gate.openingSetupToolError(
      "coc_invoke",
      {
        operation: "setup.invoke",
        campaign: "terminal-before-link",
        arguments: {
          kind: "investigator.create",
          payload: {
            investigator_id: "model-selected-import",
            sheet: { id: "model-selected-import", name: "Placeholder" },
            creation: { input_mode: "import_complete_sheet" },
          },
        },
      },
      "terminal-before-link-import",
    ) !== null);
  check("character setup admits the typed read-only cash/assets query",
    gate.openingSetupToolError(
      "coc_invoke",
      {
        operation: "rules.cash_assets",
        campaign: "terminal-before-link",
        arguments: { credit_rating: 20 },
      },
      "terminal-before-link-cash-assets",
    ) === null);
  check("canonical create remains admitted after source review",
    gate.openingSetupToolError(
      "coc_invoke",
      createParams,
      "terminal-before-link-create",
    ) === null);
  const created = gate.observeOpeningSetupInvocation(
    "setup.invoke",
    createParams,
    {
      ok: true,
      tool: "setup.invoke",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "investigator.create",
        result: {
          investigator_id: "terminal-before-link-investigator",
        },
      },
    },
    "terminal-before-link-create",
  );
  check("create success does not release opening before exact link",
    created.accepted === true
    && gate.requiredOpeningSetupContinuation() === null
    && replacementIs(
      gate.acceptVisibleAssistantFinal(prematureOpening),
      "调查员资料已创建；请确认后加入战役。",
    ));

  const linkParams = {
    operation: "setup.invoke",
    campaign: "terminal-before-link",
    arguments: {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: "terminal-before-link",
        investigator_ids: ["terminal-before-link-investigator"],
      },
    },
  };
  const malformedReceipts = [
    canonicalLinkSetupResult(
      "wrong-campaign",
      ["terminal-before-link-investigator"],
    ),
    canonicalLinkSetupResult("terminal-before-link", []),
    canonicalLinkSetupResult(
      "terminal-before-link",
      ["terminal-before-link-investigator"],
      { kind: "investigator.create" },
    ),
    canonicalLinkSetupResult(
      "terminal-before-link",
      ["terminal-before-link-investigator"],
      { schema_version: 2 },
    ),
  ];
  for (const [index, receipt] of malformedReceipts.entries()) {
    const invocationId = `terminal-before-link-malformed-${index}`;
    check(`malformed link receipt ${index} is admitted only as an attempt`,
      gate.openingSetupToolError(
        "coc_invoke",
        linkParams,
        invocationId,
      ) === null);
    const observed = gate.observeOpeningSetupInvocation(
      "setup.invoke",
      linkParams,
      receipt,
      invocationId,
    );
    check(`malformed link receipt ${index} cannot complete setup`,
      observed.accepted === false
      && gate.openingSetupToolError(
        "coc_invoke",
        projectionParams,
        `terminal-before-link-project-${index}`,
      )?.includes("campaign.link_investigator"));
  }
  gate.markAgentStart();
  observeOwnedOpeningInvocation(
    gate,
    "terminal-before-link-exact",
    linkParams,
    canonicalLinkSetupResult(
      "terminal-before-link",
      ["terminal-before-link-investigator"],
    ),
  );
  check("exact link prose remains visible before projection route",
    replacementIs(
      gate.acceptVisibleAssistantFinal("调查员链接回执已确认。"),
      "调查员已正式加入战役。",
    ));
  const { task } = beginBackgroundAfterCharacterRoute(
    gate,
    "terminal-before-link",
    "terminal-before-link-background",
  );
  gate.observeOpeningCoordinatorTerminal({
    packet_id: task.packet.packet_id,
    status: "fulfilled",
  });
  const route = gate.requiredOpeningSetupContinuation();
  check("linked character plus fulfilled terminal releases exact projection",
    route?.next_operation?.operation === "progressive.project_opening");
}

// A current projection must not expose its scene activation before the exact
// table-opening receipt. The receipt then returns that same canonical card so
// the model can activate once without probing scene.context first.
{
  const gate = playOpeningGate();
  const campaignId = "opening-activation-receipt-order";
  const { task } = beginBackgroundOpeningRoute(
    gate,
    campaignId,
    "opening-activation-order",
  );
  gate.observeOpeningCoordinatorTerminal({
    packet_id: task.packet.packet_id,
    status: "fulfilled",
  });

  const projectParams = {
    operation: "progressive.project_opening",
    campaign: campaignId,
    arguments: {
      asset_root_id: task.packet.asset_root_id,
      source_file_sha256: "a".repeat(64),
      start_location_id: "opening",
      opening_pdf_indices: [0],
    },
  };
  const activationCard = {
    operation: "state.move_scene",
    invoke_via: "coc_invoke",
    prefilled_arguments: {
      scene_id: "opening",
      defer_initial_progressive_on_enter: true,
    },
    missing_arguments: ["decision_id"],
    authority: "advisory",
    hard_gate: false,
  };
  check("current opening projection is admitted after source fulfillment",
    gate.openingSetupToolError(
      "coc_invoke",
      projectParams,
      "opening-activation-project",
    ) === null);
  const projected = gate.observeOpeningSetupInvocation(
    "progressive.project_opening",
    projectParams,
    {
      ok: true,
      tool: "progressive.project_opening",
      data: {
        status: "current",
        activation_operation: activationCard,
      },
    },
    "opening-activation-project",
  );
  check("projection hides activation until table-opening evidence",
    projected.accepted === true
    && projected.modelProjection?.data?.activation_operation === undefined
    && projected.modelProjection?.data?.activation_allowed === false
    && projected.modelProjection?.data?.next_operation?.operation
      === "evidence.table_opening"
    && projected.modelProjection?.data?.opening_gate?.phase
      === "opening_table_evidence_required");

  const openingText = "[in_game]\n来源约束下的准确开场。\n[/in_game]";
  const evidenceParams = {
    operation: "evidence.table_opening",
    campaign: campaignId,
    arguments: {
      text: openingText,
      presented_roll_ids: [],
    },
  };
  check("exact table-opening card is admitted before activation",
    gate.openingSetupToolError(
      "coc_invoke",
      evidenceParams,
      "opening-activation-evidence",
    ) === null);
  const evidenced = gate.observeOpeningSetupInvocation(
    "evidence.table_opening",
    evidenceParams,
    {
      ok: true,
      tool: "evidence.table_opening",
      data: {
        turn: 0,
        text: openingText,
        text_sha256: `sha256:${createHash("sha256").update(
          JSON.stringify(openingText),
        ).digest("hex")}`,
        authoritative_time_anchor: {
          schema_version: 1,
          display: "冬日清晨",
          rendered_line: "【开场时间】冬日清晨",
        },
      },
    },
    "opening-activation-evidence",
  );
  check("table-opening receipt returns the exact retained activation card",
    evidenced.accepted === true
    && JSON.stringify(evidenced.modelProjection?.data?.activation_operation)
      === JSON.stringify(activationCard)
    && JSON.stringify(evidenced.modelProjection?.data?.next_operation)
      === JSON.stringify(activationCard)
    && gate.openingSetupToolError("coc_invoke", {
      operation: "state.move_scene",
      campaign: campaignId,
      arguments: {
        ...activationCard.prefilled_arguments,
        decision_id: "opening-activation-move",
      },
    }, "opening-activation-move") === null);
}

// If no agent turn owns the fulfilled terminal after canonical selection, the terminal wake
// claims the same release token and carries the exact route itself. A failed
// projection restores the original bootstrap retry card.
{
  const gate = playOpeningGate();
  const { task } = beginBackgroundOpeningRoute(
    gate,
    "terminal-release-owner",
    "terminal-release-owner",
  );
  gate.markAgentStart();
  gate.markAgentEnd();
  gate.observeOpeningCoordinatorTerminal({
    packet_id: task.packet.packet_id,
    status: "fulfilled",
  });
  const context = gate.coordinatorContinuationContext(
    task.packet.packet_id,
    "fulfilled",
  );
  check("terminal owner carries route and suppresses route followup",
    context.opening_setup_route?.next_operation?.operation
      === "progressive.project_opening"
    && gate.decideWake(task.packet.packet_id) === true
    && gate.requiredOpeningSetupContinuation() === null);
  const projectParams = {
    operation: "progressive.project_opening",
    campaign: "terminal-release-owner",
    arguments: {
      asset_root_id: task.packet.asset_root_id,
      source_file_sha256: "a".repeat(64),
      start_location_id: "opening",
      opening_pdf_indices: [0],
    },
  };
  const projectFailure = {
    ok: false,
    error: { code: "opening_projection_not_current" },
  };
  observeOwnedOpeningInvocation(
    gate,
    "terminal-release-owner-project",
    projectParams,
    projectFailure,
  );
  check("failed projection restores exact bootstrap retry",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "terminal-release-owner",
      arguments: {},
    }, "terminal-release-owner-scene")?.includes(
      '"operation":"progressive.opening_bootstrap"',
    ));
}

// A launch/submission failure after the exact bootstrap attempt uses the same
// retry phase and suppresses prose until the exact bootstrap retry.
{
  const gate = playOpeningGate();
  const { params, task, invocationId } = beginBackgroundOpeningRoute(
    gate,
    "submit-failure-character",
    "submit-failure-character",
  );
  gate.markOpeningSetupRouteAttemptFailure(
    invocationId,
    params,
    {
      ok: false,
      error: { code: "opening_source_background_start_failed" },
    },
    task.packet.packet_id,
  );
  const blocker = gate.acceptVisibleAssistantFinal("提交失败后虚构开场。");
  check("submit failure exposes bounded blocker",
    typeof blocker === "object"
    && blocker.replacementText.includes("开场资料解析失败"));
  check("submit retry phase suppresses prose before exact retry",
    gate.acceptVisibleAssistantFinal(
      "继续讨论调查员的信念与重要之人。",
    ) === false);
}

// A late setup receipt from campaign A is owned by its original agent turn.
// It cannot switch transcript ownership or authorize arbitrary campaign B
// prose while B's exact bootstrap remains outstanding.
{
  const gate = playOpeningGate();
  bindReviewedCharacterRoute(gate, "campaign-a", "cross-output-a");
  bindOpeningRoute(gate, "campaign-b", "cross-output-bind-b");
  gate.markAgentStart();
  const lateAParams = {
    operation: "setup.invoke",
    campaign: "campaign-a",
    arguments: {
      kind: "investigator.create",
      payload: {
        campaign_id: "campaign-a",
        investigator_id: "inv-a",
        sheet: { id: "inv-a", name: "A" },
        creation: {
          input_mode: "guided_quick_fire",
          method: "quick_fire_array",
          characteristic_assignment_order: [
            "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR",
          ],
          luck_roll_total: 12,
          luck_roll_receipt: {
            campaign_id: "campaign-a",
            decision_id: "roll-campaign-a-luck",
            roll_id: "toolbox-campaign-a-000001",
          },
        },
      },
    },
  };
  check("campaign A setup attempt is admitted in its original agent turn",
    gate.openingSetupToolError(
      "coc_invoke",
      lateAParams,
      "cross-output-late-a",
    ) === null);
  gate.markAgentStart();
  prepareOpeningRoute(gate, "campaign-b", "cross-output-prepare-b");
  gate.observeOpeningSetupInvocation(
    "setup.invoke",
    lateAParams,
    {
      ...staleCharacterSetupResult("investigator.create"),
      data: {
        ...staleCharacterSetupResult("investigator.create").data,
        opening_gate: openingSetupGate(undefined, "campaign-a"),
      },
    },
    "cross-output-late-a",
  );
  check("late campaign A result cannot authorize campaign B prose",
    gate.acceptVisibleAssistantFinal("B 的虚构开场") === false);
  const forcedB = gate.requiredOpeningSetupContinuation();
  check("current turn retains campaign B bootstrap ownership",
    forcedB?.campaign_id === "campaign-b"
    && forcedB.next_operation?.operation === "progressive.opening_bootstrap");
}

// A bind admitted before another route generation cannot re-arm the campaign
// after that newer generation reaches current and clears.
{
  const gate = playOpeningGate();
  const oldBindParams = {
    operation: "setup.invoke",
    campaign: "bind-generation",
    arguments: {
      kind: "scenario.bind_pdf",
      payload: {
        campaign_id: "bind-generation",
        scenario_id: "old-scenario",
        title: "Old Scenario",
        source_bundle_path: "/fixture/old/source-bundle",
      },
    },
  };
  check("old bind attempt is admitted before generation ownership settles",
    gate.openingSetupToolError(
      "coc_invoke",
      oldBindParams,
      "bind-generation-old",
    ) === null);
  bindOpeningRoute(gate, "bind-generation", "bind-generation-new");
  prepareOpeningRoute(gate, "bind-generation", "bind-generation-prepare");
  observeOwnedOpeningInvocation(
    gate,
    "bind-generation-current",
    bootstrapOpeningParams("bind-generation"),
    openingBootstrapWithoutTakeover(
      coordinatorTask("bind-generation-current", {
        campaignId: "bind-generation",
      }),
      "current",
    ),
  );
  gate.observeOpeningSetupInvocation(
    "setup.invoke",
    oldBindParams,
    boundOpeningSetupResult("bind-generation"),
    "bind-generation-old",
  );
  check("retired-generation bind cannot bypass current table-evidence boundary",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "bind-generation",
      arguments: {},
    }, "bind-generation-probe")?.includes(
      '"phase":"opening_table_evidence_required"',
    )
    && gate.takeOpeningSetupAudits().some((entry) => (
      entry.reason === "late_bind_outside_current_route_generation"
      && entry.invocation_id === "bind-generation-old"
    )));
}

// Same-campaign source intent is ordered when calls start, not when responses
// arrive. If the old bind resolves first it is ignored and the transcript
// remains fail-closed until the newest issued bind resolves.
{
  const gate = playOpeningGate();
  gate.markAgentStart();
  const bindParams = (source) => ({
    operation: "setup.invoke",
    campaign: "bind-order",
    arguments: {
      kind: "scenario.bind_pdf",
      payload: {
        campaign_id: "bind-order",
        scenario_id: `scenario-${source}`,
        title: `Scenario ${source}`,
        source_bundle_path: `/fixture/${source}/source-bundle`,
      },
    },
  });
  const oldParams = bindParams("old");
  const newParams = bindParams("new");
  check("both ordered bind generations are admitted at call initiation",
    gate.openingSetupToolError(
      "coc_invoke",
      oldParams,
      "bind-order-old",
    ) === null
    && gate.openingSetupToolError(
      "coc_invoke",
      newParams,
      "bind-order-new",
    ) === null);
  const oldGate = openingSetupGate(undefined, "bind-order");
  oldGate.instruction = "OLD";
  gate.observeOpeningSetupInvocation(
    "setup.invoke",
    oldParams,
    {
      ok: true,
      data: { status: "PASS", opening_gate: oldGate },
    },
    "bind-order-old",
  );
  const pendingDiscover = gate.openingSetupToolError("coc_discover", {});
  check("old-first response cannot publish or arm while newest bind is pending",
    gate.acceptVisibleAssistantFinal("OLD source prose") === false
    && pendingDiscover?.includes("opening setup hard gate is active"));
  const newGate = openingSetupGate(undefined, "bind-order");
  newGate.instruction = "NEW";
  gate.observeOpeningSetupInvocation(
    "setup.invoke",
    newParams,
    {
      ok: true,
      data: { status: "PASS", opening_gate: newGate },
    },
    "bind-order-new",
  );
  check("newest issued bind owns the retained source route",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "bind-order",
      arguments: {},
    }, "bind-order-probe")?.includes('"instruction":"NEW"')
    && gate.takeOpeningSetupAudits().some((entry) => (
      entry.reason === "late_bind_outside_current_route_generation"
      && entry.invocation_id === "bind-order-old"
    )));
}

// Returned campaign identity is checked against both the admitted invocation
// and the current route revision before current or failure may change state.
{
  const gate = playOpeningGate();
  bindOpeningRoute(gate, "identity-a", "identity-bind-a");
  prepareOpeningRoute(gate, "identity-a", "identity-prepare-a");
  bindOpeningRoute(gate, "identity-b", "identity-bind-b");
  prepareOpeningRoute(gate, "identity-b", "identity-prepare-b");
  gate.markAgentStart();
  const paramsB = bootstrapOpeningParams("identity-b");
  check("campaign B bootstrap attempt is admitted",
    gate.openingSetupToolError(
      "coc_invoke",
      paramsB,
      "identity-bootstrap-b",
    ) === null);
  gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    paramsB,
    {
      ...openingBootstrapWithoutTakeover(
        coordinatorTask("identity-wrong-current"),
        "current",
      ),
      data: {
        ...openingBootstrapWithoutTakeover(
          coordinatorTask("identity-wrong-current"),
          "current",
        ).data,
        campaign_id: "identity-a",
      },
    },
    "identity-bootstrap-b",
  );
  check("mismatched current releases B's exact continuation latch",
    gate.acceptVisibleAssistantFinal("wrong current prose") === false
    && gate.requiredOpeningSetupContinuation()?.campaign_id === "identity-b");
  check("campaign A current envelope cannot clear campaign B",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "identity-a",
      arguments: {},
    }, "identity-probe-a")?.includes(
      '"operation":"progressive.opening_bootstrap"',
    )
    && gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "identity-b",
      arguments: {},
    }, "identity-probe-b")?.includes(
      '"operation":"progressive.opening_bootstrap"',
    ));
  const audits = gate.takeOpeningSetupAudits();
  check("campaign mismatch is retained as hidden audit evidence",
    audits.some((entry) => (
      entry.reason === "invocation_or_campaign_mismatch"
      && entry.invocation_id === "identity-bootstrap-b"
    )));

  gate.markAgentStart();
  const mismatchFailureParams = bootstrapOpeningParams("identity-b");
  check("second campaign B bootstrap attempt is admitted",
    gate.openingSetupToolError(
      "coc_invoke",
      mismatchFailureParams,
      "identity-failure-b",
    ) === null);
  gate.markOpeningSetupRouteAttemptFailure(
    "identity-failure-b",
    mismatchFailureParams,
    {
      ok: false,
      error: {
        code: "opening_identity_missing",
        details: {
          ...openingSetupGate(null, "identity-a"),
          phase: "opening_source_contract_invalid",
          next_operation: null,
        },
      },
    },
  );
  check("campaign A failure cannot publish a blocker against campaign B",
    gate.acceptVisibleAssistantFinal("错误归属的失败提示") === false
    && gate.takeDeliveredOpeningSetupTerminalBlocker() === null
    && gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "identity-b",
      arguments: {},
    }, "identity-after-failure-b")?.includes(
      '"operation":"progressive.opening_bootstrap"',
    )
    && gate.takeOpeningSetupAudits().some((entry) => (
      entry.reason === "failed_attempt_identity_mismatch"
      && entry.invocation_id === "identity-failure-b"
    )));

  const packetMismatchParams = bootstrapOpeningParams("identity-b");
  check("packet identity probe is admitted against campaign B",
    gate.openingSetupToolError(
      "coc_invoke",
      packetMismatchParams,
      "identity-packet-b",
    ) === null);
  gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    packetMismatchParams,
    openingBootstrapResult(coordinatorTask("identity-packet-a", {
      campaignId: "identity-a",
    })),
    "identity-packet-b",
  );
  check("campaign A coordinator packet cannot arm campaign B dispatch",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "identity-b",
      arguments: {},
    }, "identity-after-packet-b")?.includes(
      '"operation":"progressive.opening_bootstrap"',
    )
    && gate.takeOpeningSetupAudits().some((entry) => (
      entry.reason === "invocation_or_campaign_mismatch"
      && entry.invocation_id === "identity-packet-b"
    )));
}

// Only the exact prepare result can advance selection to bootstrap. A
// structurally bootstrap-shaped gate from unrelated setup is ignored.
{
  const gate = playOpeningGate();
  bindOpeningRoute(gate, "transition", "transition-bind");
  const unrelatedParams = {
    operation: "setup.invoke",
    campaign: "transition",
    arguments: {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: "transition",
        investigator_ids: ["inv-transition"],
      },
    },
  };
  const unrelatedError = gate.openingSetupToolError(
    "coc_invoke",
    unrelatedParams,
    "transition-unrelated",
  );
  const beforePrepare = gate.openingSetupToolError("coc_invoke", {
    operation: "scene.context",
    campaign: "transition",
    arguments: {},
  }, "transition-before-prepare");
  check("unrelated setup result cannot promote the opening route",
    unrelatedError?.includes('"operation":"progressive.prepare_opening"')
    && beforePrepare?.includes('"operation":"progressive.prepare_opening"'));
  prepareOpeningRoute(gate, "transition", "transition-prepare");
  const afterPrepare = gate.openingSetupToolError("coc_invoke", {
    operation: "scene.context",
    campaign: "transition",
    arguments: {},
  }, "transition-after-prepare");
  check("matching prepare alone installs the exact bootstrap card",
    afterPrepare?.includes('"operation":"progressive.opening_bootstrap"')
    && !afterPrepare.includes('"tag":"wrong"'));
}

// A prepare result may prefill either bootstrap argument only when the value
// satisfies the canonical Python contract. Wrong types/ranges/order remain at
// selection and are audited instead of poisoning the retained route.
{
  const bootstrapCard = (prefilled_arguments, missing_arguments = []) => ({
    operation: "progressive.opening_bootstrap",
    invoke_via: "coc_invoke",
    prefilled_arguments,
    missing_arguments,
    hard_gate: true,
    authority: "canonical_setup",
  });
  const invalidCards = [
    bootstrapCard({
      start_location: "not-object",
      opening_pdf_indices: "not-array",
    }),
    bootstrapCard({
      start_location: {
        location_id: "opening",
        title: "Opening",
        extra: true,
      },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: { location_id: "bad id", title: "Opening" },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: { location_id: " opening", title: "Opening" },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: { location_id: "opening ", title: "Opening" },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: {
        location_id: "a".repeat(129),
        title: "Opening",
      },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: { location_id: "开场", title: "Opening" },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: { location_id: 7, title: "Opening" },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: { location_id: "opening", title: " " },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: { location_id: "opening", title: " Opening" },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: { location_id: "opening", title: "Opening " },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: {
        location_id: "opening",
        title: "O".repeat(241),
      },
      opening_pdf_indices: [0],
    }),
    bootstrapCard({
      start_location: {
        location_id: "opening",
        title: "😀".repeat(241),
      },
      opening_pdf_indices: [0],
    }),
    bootstrapCard(
      { start_location: { location_id: "location:opening", title: "Opening" } },
      ["opening_pdf_indices", "opening_pdf_indices"],
    ),
    bootstrapCard({
      start_location: { location_id: "location:opening", title: "Opening" },
      opening_pdf_indices: [],
    }),
    bootstrapCard({
      start_location: { location_id: "location:opening", title: "Opening" },
      opening_pdf_indices: [0, 1, 2, 3],
    }),
    bootstrapCard({
      start_location: { location_id: "location:opening", title: "Opening" },
      opening_pdf_indices: [-1],
    }),
    bootstrapCard({
      start_location: { location_id: "location:opening", title: "Opening" },
      opening_pdf_indices: [0.5],
    }),
    bootstrapCard({
      start_location: { location_id: "location:opening", title: "Opening" },
      opening_pdf_indices: [0, 0],
    }),
    bootstrapCard({
      start_location: { location_id: "location:opening", title: "Opening" },
      opening_pdf_indices: [0, 2],
    }),
  ];
  for (const [index, card] of invalidCards.entries()) {
    const campaignId = `typed-card-invalid-${index}`;
  const gate = playOpeningGate();
    bindOpeningRoute(gate, campaignId, `${campaignId}-bind`);
    const params = {
      operation: "progressive.prepare_opening",
      campaign: campaignId,
      arguments: {},
    };
    check(`typed card ${index} prepare attempt admitted`,
      gate.openingSetupToolError(
        "coc_invoke",
        params,
        `${campaignId}-prepare`,
      ) === null);
    gate.observeOpeningSetupInvocation(
      "progressive.prepare_opening",
      params,
      {
        ok: true,
        data: { status: "blocked", next_operation: card },
      },
      `${campaignId}-prepare`,
    );
    check(`typed card ${index} cannot poison retained bootstrap route`,
      gate.openingSetupToolError("coc_invoke", {
        operation: "scene.context",
        campaign: campaignId,
        arguments: {},
      }, `${campaignId}-probe`)?.includes(
        '"operation":"progressive.prepare_opening"',
      )
      && gate.takeOpeningSetupAudits().some((entry) => (
        entry.reason === "opening_prepare_result_invalid"
      )));
  }

  const validGate = playOpeningGate();
  bindOpeningRoute(validGate, "typed-card-valid", "typed-card-valid-bind");
  const validParams = {
    operation: "progressive.prepare_opening",
    campaign: "typed-card-valid",
    arguments: {},
  };
  observeOwnedOpeningInvocation(
    validGate,
    "typed-card-valid-prepare",
    validParams,
    {
      ok: true,
      data: {
        status: "blocked",
        next_operation: bootstrapCard({
          start_location: {
            location_id: "opening.valid-1",
            title: "有效开场😀",
          },
          opening_pdf_indices: [4, 5, 6],
        }),
      },
    },
  );
  check("canonical prefilled bootstrap values remain admissible",
    validGate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "typed-card-valid",
      arguments: {},
    }, "typed-card-valid-probe")?.includes(
      '"operation":"progressive.opening_bootstrap"',
    ));
}

// The coordinator packet id is part of the admitted bootstrap attempt. A late
// terminal from another dispatch cannot fail, complete, or clear this route.
{
  const gate = playOpeningGate();
  bindOpeningRoute(gate, "dispatch", "dispatch-bind");
  prepareOpeningRoute(gate, "dispatch", "dispatch-prepare");
  gate.markAgentStart();
  const params = bootstrapOpeningParams("dispatch");
  const task = coordinatorTask("dispatch-owned", {
    campaignId: "dispatch",
  });
  check("dispatch-bound bootstrap is admitted",
    gate.openingSetupToolError(
      "coc_invoke",
      params,
      "dispatch-bootstrap",
    ) === null);
  gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    params,
    openingBootstrapResult(task),
    "dispatch-bootstrap",
  );
  gate.markOpeningSetupRouteAttemptFailure(
    "dispatch-bootstrap",
    params,
    {
      ok: false,
      error: { code: "opening_source_terminal_failure" },
    },
    "dispatch-wrong",
  );
  check("wrong dispatch cannot complete or clear the bootstrap route",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "dispatch",
      arguments: {},
    }, "dispatch-probe")?.includes(
      '"operation":"progressive.opening_bootstrap"',
    ));
  check("wrong dispatch releases the latch for an exact retry",
    gate.acceptVisibleAssistantFinal("wrong dispatch prose") === false
    && gate.requiredOpeningSetupContinuation()?.next_operation?.operation
      === "progressive.opening_bootstrap");
  check("replacement dispatch attempt is admitted",
    gate.openingSetupToolError(
      "coc_invoke",
      params,
      "dispatch-bootstrap-retry",
    ) === null);
  gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    params,
    openingBootstrapResult(task),
    "dispatch-bootstrap-retry",
  );
  gate.markOpeningSetupRouteAttemptFailure(
    "dispatch-bootstrap-retry",
    params,
    {
      ok: false,
      error: { code: "opening_source_terminal_failure" },
    },
    task.packet.packet_id,
  );
  const terminalDecision = gate.acceptVisibleAssistantFinal("model failure");
  check("matching dispatch alone may publish the retained zh-Hans blocker",
    typeof terminalDecision === "object"
    && terminalDecision.replacementText
      === "开场资料解析失败，游戏尚未开始。系统保留了当前进度；"
        + "你可以重试原来的开场步骤，在资料就绪前不会自行编写剧情。"
    && gate.takeDeliveredOpeningSetupTerminalBlocker()?.dispatch_key
      === task.packet.packet_id);
}

// Every terminal attempt path releases its invocation identity, including
// non-route transport failure. Concurrent attempts are capped and become
// admissible again after terminal cleanup.
{
  const gate = playOpeningGate();
  bindReviewedCharacterRoute(gate, "attempt-cleanup", "attempt-cleanup");
  const characterParams = guidedQuickFireCreateParams(
    "attempt-cleanup",
    "cleanup-investigator",
  );
  check("character attempt is admitted before transport failure",
    gate.openingSetupToolError(
      "coc_invoke",
      characterParams,
      "attempt-cleanup-reuse",
    ) === null);
  gate.markOpeningSetupRouteAttemptFailure(
    "attempt-cleanup-reuse",
    characterParams,
    {
      ok: false,
      error: { code: "canonical_route_call_failed" },
    },
  );
  check("failed non-route attempt identity can be reused",
    gate.openingSetupToolError(
      "coc_invoke",
      characterParams,
      "attempt-cleanup-reuse",
    ) === null);
  gate.observeOpeningSetupInvocation(
    "setup.invoke",
    characterParams,
    staleCharacterSetupResult("investigator.create"),
    "attempt-cleanup-reuse",
  );

  const admittedIds = [];
  for (
    let index = 0;
    index < main.__test.MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN;
    index += 1
  ) {
    const invocationId = `attempt-cap-${index}`;
    check(`attempt cap slot ${index} is admitted`,
      gate.openingSetupToolError(
        "coc_invoke",
        characterParams,
        invocationId,
      ) === null);
    admittedIds.push(invocationId);
  }
  check("attempt cap rejects one excess concurrent invocation",
    gate.openingSetupToolError(
      "coc_invoke",
      characterParams,
      "attempt-cap-overflow",
    )?.includes("too many concurrent"));
  for (const invocationId of admittedIds) {
    gate.markOpeningSetupRouteAttemptFailure(
      invocationId,
      characterParams,
      {
        ok: false,
        error: { code: "canonical_route_call_failed" },
      },
    );
  }
  check("terminal cleanup reopens bounded attempt capacity",
    gate.openingSetupToolError(
      "coc_invoke",
      characterParams,
      "attempt-cap-overflow",
    ) === null);
  gate.markOpeningSetupRouteAttemptFailure(
    "attempt-cap-overflow",
    characterParams,
    {
      ok: false,
      error: { code: "canonical_route_call_failed" },
    },
  );
}

// Contract invalidity creates a new revision with one explicit prepare-based
// revalidation route. Older lower-revision selection/current receipts cannot
// downgrade or clear it; the exact repaired-source prepare can recover it.
{
  const gate = playOpeningGate();
  bindOpeningRoute(gate, "recovery", "recovery-bind");
  prepareOpeningRoute(gate, "recovery", "recovery-prepare-initial");
  const oldBootstrapParams = bootstrapOpeningParams("recovery");
  check("old bootstrap attempt is admitted before contract invalidation",
    gate.openingSetupToolError(
      "coc_invoke",
      oldBootstrapParams,
      "recovery-old-bootstrap",
    ) === null);
  const invalidationParams = bootstrapOpeningParams("recovery");
  check("source revalidation attempt is admitted at bootstrap revision",
    gate.openingSetupToolError(
      "coc_invoke",
      invalidationParams,
      "recovery-invalid",
    ) === null);
  gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    invalidationParams,
    {
      ok: false,
      error: {
        code: "opening_source_contract_invalid",
        details: {
          ...openingSetupGate(null, "recovery"),
          phase: "opening_source_contract_invalid",
          next_operation: null,
        },
      },
    },
    "recovery-invalid",
  );
  gate.observeOpeningSetupInvocation(
    "progressive.opening_bootstrap",
    oldBootstrapParams,
    openingBootstrapWithoutTakeover(
      coordinatorTask("recovery-stale-current"),
      "current",
    ),
    "recovery-old-bootstrap",
  );
  const invalidRoute = gate.openingSetupToolError("coc_invoke", {
    operation: "scene.context",
    campaign: "recovery",
    arguments: {},
  }, "recovery-invalid-probe");
  check("old current cannot clear newer contract-invalid revision",
    invalidRoute?.includes('"phase":"opening_source_contract_invalid"')
    && invalidRoute.includes('"operation":"progressive.prepare_opening"'));
  prepareOpeningRoute(gate, "recovery", "recovery-revalidate");
  const recoveredRoute = gate.openingSetupToolError("coc_invoke", {
    operation: "scene.context",
    campaign: "recovery",
    arguments: {},
  }, "recovery-revalidated-probe");
  check("exact repaired-source prepare recovers to bootstrap",
    recoveredRoute?.includes('"operation":"progressive.opening_bootstrap"')
    && !recoveredRoute.includes(
      '"phase":"opening_source_contract_invalid"',
    ));
  check("stale current and explicit recovery transitions are audited",
    gate.takeOpeningSetupAudits().some((entry) => (
      entry.reason === "superseded_attempt_revision"
      && entry.invocation_id === "recovery-old-bootstrap"
    )));
}

// Every setup.invoke kind whose canonical payload owns campaign state must
// bind that payload to the main-gateway campaign before the backend sees it.
// The live provider failure omitted this outer identity, so exercise both
// omission and mismatch for the complete canonical campaign-bound set.
{
  // Single-token ids are refused by the closed identity grammar before the
  // campaign binding is even reached, which is what this block is about:
  // actor_id takes the `actor:`/`npc:` namespace or a multi-token slug, and
  // scenario/investigator ids take a multi-token slug.
  const campaignBoundKinds = [
    ["actor.create", { actor_id: "actor:campaign-bound", sheet: {} }],
    [
      "campaign.link_investigator",
      { investigator_ids: ["investigator-campaign-bound"] },
    ],
    [
      "scenario.bind_pdf",
      {
        scenario_id: "scenario-campaign-bound",
        title: "Scenario",
        source_bundle_path: "/fixture/source-bundle",
      },
    ],
    ["campaign.render_briefing", {}],
    [
      "investigator.render_card",
      { investigator_id: "investigator-campaign-bound" },
    ],
  ];
  const harness = mainExtensionHarness(() => ({
    ok: true,
    tool: "setup.invoke",
    data: { status: "PASS" },
  }));
  await harness.start();
  for (const [index, [kind, rest]] of campaignBoundKinds.entries()) {
    const campaignId = `campaign-bound-${index}`;
    const args = {
      kind,
      payload: { campaign_id: campaignId, ...rest },
    };
    const before = harness.calls.length;
    let missingOuter = null;
    try {
      await harness.registered.get("coc_invoke").execute(
        `campaign-bound-missing-${index}`,
        { operation: "setup.invoke", arguments: args },
        undefined,
        undefined,
        harness.ctx,
      );
    } catch (error) {
      missingOuter = error;
    }
    let mismatchedOuter = null;
    try {
      await harness.registered.get("coc_invoke").execute(
        `campaign-bound-mismatch-${index}`,
        {
          operation: "setup.invoke",
          campaign: `${campaignId}-wrong`,
          arguments: args,
        },
        undefined,
        undefined,
        harness.ctx,
      );
    } catch (error) {
      mismatchedOuter = error;
    }
    check(`${kind} rejects missing and mismatched outer campaign pre-mutation`,
      missingOuter instanceof Error
      && mismatchedOuter instanceof Error
      && missingOuter.message.includes(
        `"campaign":"${campaignId}"`,
      )
      && mismatchedOuter.message.includes(
        `"campaign":"${campaignId}"`,
      )
      && harness.calls.length === before);
    await harness.registered.get("coc_invoke").execute(
      `campaign-bound-corrected-${index}`,
      {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: args,
      },
      undefined,
      undefined,
      harness.ctx,
    );
    check(`${kind} admits exact outer and payload campaign identity`,
      harness.calls.length === before + 1
      && harness.calls.at(-1).params.campaign === campaignId);
  }
  await harness.shutdown();
}

// The existing-campaign preflight must not rewrite the canonical pre-campaign
// create route. Exercise the main gateway against the real toolbox in a fresh
// workspace, then prove bind/link gain strict outer identity only after create.
{
  const workspace = mkdtempSync(path.join(tmpdir(), "chatrpgv4-r12-"));
  const campaignId = "r12-real-toolbox";
  const investigatorId = "r12-real-investigator";
  const callRealToolbox = (_name, params) => {
    const argv = [
      "run",
      "--frozen",
      "python",
      "plugins/coc-keeper/scripts/coc_toolbox.py",
      params.operation,
      "--root",
      workspace,
    ];
    if (typeof params.campaign === "string") {
      argv.push("--campaign", params.campaign);
    }
    argv.push("--json", JSON.stringify(params.arguments));
    const completed = spawnSync("uv", argv, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        COC_HOST: "pi",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    });
    if (!completed.stdout.trim()) {
      throw new Error(
        `real toolbox probe produced no JSON: ${completed.stderr.trim()}`,
      );
    }
    return JSON.parse(completed.stdout);
  };
  const harness = mainExtensionHarness(callRealToolbox, {
    coordinatorEnabled: async () => false,
  });
  try {
    await harness.start();
    const created = JSON.parse((await harness.registered.get(
      "coc_invoke",
    ).execute(
      "r12-real-create",
      {
        operation: "setup.invoke",
        arguments: {
          kind: "campaign.create",
          payload: {
            campaign_id: campaignId,
            title: "R12 Real Toolbox",
          },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    check("payload-only campaign.create reaches real toolbox without unknown campaign",
      created.ok === true
      && created.data.status === "PASS"
      && existsSync(path.join(
        workspace,
        ".coc",
        "campaigns",
        campaignId,
        "campaign.json",
      ))
      && !harness.appended.some((entry) => (
        entry.name === "coc-opening-setup-route-audit"
        && entry.value.invocation_id === "r12-real-create"
        && entry.value.reason === "unowned_result"
      )));

    const forcedCampaignId = "r12-forced-nonexistent";
    const forcedOuter = JSON.parse((await harness.registered.get(
      "coc_invoke",
    ).execute(
      "r12-real-forced-outer",
      {
        operation: "setup.invoke",
        campaign: forcedCampaignId,
        arguments: {
          kind: "campaign.create",
          payload: {
            campaign_id: forcedCampaignId,
            title: "Must remain pre-campaign",
          },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    check("forcing outer campaign on create retains canonical unknown_campaign",
      forcedOuter.ok === false
      && forcedOuter.error.code === "unknown_campaign"
      && !existsSync(path.join(
        workspace,
        ".coc",
        "campaigns",
        forcedCampaignId,
      )));

    const investigatorSheet = {
      schema_version: 1,
      id: investigatorId,
      name: "R12 Investigator",
      characteristics: {
        STR: 50,
        CON: 50,
        SIZ: 50,
        DEX: 50,
        APP: 50,
        INT: 50,
        POW: 50,
        EDU: 50,
      },
      derived: {
        HP: 10,
        SAN: 50,
        MP: 10,
        Luck: 60,
        DB: "none",
        Build: 0,
        MOV: 8,
      },
      skills: { "Credit Rating": 20 },
      player_facing_sheet_zh: {
        display_name: "R12 调查员",
        era: "1920s",
        nationality: "中国",
        occupation: "记者",
        characteristics: {
          力量: { key: "STR", value: 50 },
          教育: { key: "EDU", value: 50 },
        },
        derived: { 生命值: 10, 理智: 50 },
        skills: [],
        backstory_summary: "一名追查异常事件的记者。",
      },
    };
    const investigator = JSON.parse((await harness.registered.get(
      "coc_invoke",
    ).execute(
      "r12-real-investigator",
      {
        operation: "setup.invoke",
        arguments: {
          kind: "investigator.create",
          payload: {
            investigator_id: investigatorId,
            sheet: investigatorSheet,
            creation: { input_mode: "import_complete_sheet" },
          },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    check("real toolbox probe creates reusable investigator",
      investigator.ok === true);

    const pdfPath = path.join(workspace, "r12-source.pdf");
    const bundlePath = path.join(workspace, "r12-source-bundle");
    const pdf = Buffer.from("%PDF host-owned R12 setup fixture");
    const markdown = Buffer.from(
      "# R12 Module\n\nAccepted host source page.\n",
    );
    writeFileSync(pdfPath, pdf);
    mkdirSync(bundlePath);
    writeFileSync(path.join(bundlePath, "page-0000.md"), markdown);
    writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
      schema_version: 1,
      producer: "codex-pdf-skill",
      source: {
        source_id: "pdf:r12-module",
        title: "R12 Module",
        path: pdfPath,
        file_sha256: createHash("sha256").update(pdf).digest("hex"),
        page_count: 1,
      },
      pages: [{
        pdf_index: 0,
        markdown_path: "page-0000.md",
        text_sha256: createHash("sha256").update(markdown).digest("hex"),
        review_state: "manual_accepted",
        parse_confidence: 0.99,
        grep_anchors: ["Accepted host source page."],
      }],
    }));
    const bindArgs = {
      kind: "scenario.bind_pdf",
      payload: {
        campaign_id: campaignId,
        scenario_id: "r12-module",
        title: "R12 Module",
        source_bundle_path: bundlePath,
        compile_now: false,
      },
    };
    const callsBeforeMissingBind = harness.calls.length;
    let missingBindRejected = false;
    try {
      await harness.registered.get("coc_invoke").execute(
        "r12-real-bind-missing",
        { operation: "setup.invoke", arguments: bindArgs },
        undefined,
        undefined,
        harness.ctx,
      );
    } catch {
      missingBindRejected = true;
    }
    const bound = JSON.parse((await harness.registered.get(
      "coc_invoke",
    ).execute(
      "r12-real-bind-corrected",
      {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: bindArgs,
      },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    check("real toolbox bind rejects missing outer before mutation then succeeds",
      missingBindRejected
      && harness.calls.length === callsBeforeMissingBind + 1
      && bound.ok === true
      && bound.data.status === "PASS"
      && bound.data.opening_gate.phase
        === "opening_source_review_required"
      && bound.data.opening_gate.next_operation === null);

    const sourceRef = [{ source_id: "pdf:r12-module", pdf_index: 0 }];
    const unresolved = {
      status: "unresolved",
      inspected_source_refs: sourceRef,
    };
    const adopted = JSON.parse((await harness.registered.get(
      "coc_invoke",
    ).execute(
      "r12-real-adopt-source-facts",
      {
        operation: "setup.adopt_source_facts",
        campaign: campaignId,
        arguments: {
          campaign_id: campaignId,
          facts: {
            schema_version: 1,
            contract_id: "coc.opening-fast-facts.v1",
            era: {
              status: "source",
              value: "1920s",
              source_refs: sourceRef,
            },
            place: {
              status: "source",
              value: "Boston",
              source_refs: sourceRef,
            },
            investigator_hook: unresolved,
            investigator_constraints: unresolved,
            player_safe_summary: unresolved,
            content_flags: unresolved,
          },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    // Since the module-init gate landed, fact admission and character-creation
    // unblocking are decoupled: era+place are admitted (no blocking facts)
    // even when module_init L0 is not yet ready, and unblocked then stays
    // false until it is.
    check("source-review overlap admits dedicated facts; unblock waits for module init",
      adopted.ok === true
      && adopted.data.kind === "campaign.adopt_source_facts"
      && adopted.data.result.unresolved_blocking_facts.length === 0
      && adopted.data.result.module_init_ready === false
      && adopted.data.result.character_creation_unblocked === false);

    const callsBeforeBlockedPrepare = harness.calls.length;
    let blockedPrepareRejected = false;
    try {
      await harness.registered.get("coc_invoke").execute(
        "r13-real-prepare-before-review",
        {
          operation: "progressive.prepare_opening",
          campaign: campaignId,
          arguments: {},
        },
        undefined,
        undefined,
        harness.ctx,
      );
    } catch {
      blockedPrepareRejected = true;
    }
    check("real hint bind blocks prepare before private coordinator review",
      blockedPrepareRejected
      && harness.calls.length === callsBeforeBlockedPrepare
      && harness.launches.length === 0);

    const linkArgs = {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: campaignId,
        investigator_ids: [investigatorId],
      },
    };
    const callsBeforeMissingLink = harness.calls.length;
    let missingLinkRejected = false;
    try {
      await harness.registered.get("coc_invoke").execute(
        "r12-real-link-missing",
        { operation: "setup.invoke", arguments: linkArgs },
        undefined,
        undefined,
        harness.ctx,
      );
    } catch {
      missingLinkRejected = true;
    }
    let importedLinkRejected = false;
    try {
      await harness.registered.get("coc_invoke").execute(
        "r12-real-link-imported",
        {
          operation: "setup.invoke",
          campaign: campaignId,
          arguments: linkArgs,
        },
        undefined,
        undefined,
        harness.ctx,
      );
    } catch {
      importedLinkRejected = true;
    }
    check("real imported reusable investigator cannot complete Pi opening",
      missingLinkRejected
      && importedLinkRejected
      && harness.calls.length === callsBeforeMissingLink);
    await harness.shutdown();
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

// Reproduce the live Grok call shape at the real Pi gateway: payload-only
// bind/link plus stateless prepare/bootstrap attempts. Every malformed call is
// rejected before canonical mutation. The corrected exact route can then
// advance to table evidence, including retained prefilled bootstrap provenance.
{
  const campaignId = "live-grok-ownership-shape";
  const task = coordinatorTask("live-grok-ownership-shape-task", {
    campaignId,
  });
  const retainedBootstrapCard = {
    operation: "progressive.opening_bootstrap",
    invoke_via: "coc_invoke",
    prefilled_arguments: { opening_pdf_indices: [3, 4] },
    missing_arguments: ["start_location"],
    hard_gate: true,
    authority: "canonical_setup",
  };
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) {
      return boundOpeningSetupResult(campaignId);
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "campaign.link_investigator"
    ) {
      return canonicalLinkSetupResult(
        campaignId,
        params.arguments.payload.investigator_ids,
      );
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "investigator.create"
    ) {
      return canonicalGuidedCreateResult("live-grok-investigator");
    }
    if (params.operation === "progressive.prepare_opening") {
      return {
        ok: true,
        tool: "progressive.prepare_opening",
        data: {
          status: "blocked",
          next_operation: retainedBootstrapCard,
        },
      };
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapWithoutTakeover(task, "current");
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  const bindArgs = {
    kind: "scenario.bind_pdf",
    payload: {
      campaign_id: campaignId,
      scenario_id: "live-grok-scenario",
      title: "Live Grok scenario",
      source_bundle_path: "/fixture/live-grok/source-bundle",
    },
  };
  const linkArgs = {
    kind: "campaign.link_investigator",
    payload: {
      campaign_id: campaignId,
      investigator_ids: ["live-grok-investigator"],
    },
  };
  const statelessCalls = [
    {
      operation: "setup.invoke",
      arguments: bindArgs,
    },
    {
      operation: "progressive.prepare_opening",
      campaign: campaignId,
      arguments: {},
    },
    {
      operation: "setup.invoke",
      arguments: linkArgs,
    },
    {
      operation: "progressive.opening_bootstrap",
      campaign: campaignId,
      arguments: {
        start_location: {
          location_id: "opening",
          title: "Opening",
        },
        opening_pdf_indices: [3, 4],
      },
    },
  ];
  let rejectedStateless = 0;
  for (const [index, params] of statelessCalls.entries()) {
    try {
      await harness.registered.get("coc_invoke").execute(
        `live-grok-stateless-${index}`,
        params,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch {
      rejectedStateless += 1;
    }
  }
  check("live Grok malformed setup shape is wholly pre-execution",
    rejectedStateless === statelessCalls.length
    && harness.calls.length === 0
    && harness.launches.length === 0
    && !harness.appended.some((entry) => (
      entry.name === "coc-opening-setup-route-audit"
    )));

  await harness.registered.get("coc_invoke").execute(
    "live-grok-corrected-bind",
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: bindArgs,
    },
    undefined,
    undefined,
    harness.ctx,
  );
  await harness.registered.get("coc_invoke").execute(
    "live-grok-corrected-prepare",
    {
      operation: "progressive.prepare_opening",
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const beforeWrongBootstrap = harness.calls.length;
  let wrongBootstrapRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "live-grok-wrong-bootstrap",
      {
        operation: "progressive.opening_bootstrap",
        campaign: campaignId,
        arguments: {
          start_location: {
            location_id: "location:opening",
            title: "Opening",
          },
          opening_pdf_indices: [3],
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch {
    wrongBootstrapRejected = true;
  }
  const correctedBootstrap = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "live-grok-corrected-bootstrap",
    {
      operation: "progressive.opening_bootstrap",
      campaign: campaignId,
      arguments: {
        start_location: {
          location_id: "location:opening",
          title: "Opening",
        },
        opening_pdf_indices: [3, 4],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  let correctedHandoffRetained = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "live-grok-post-current-scene-detour",
      { operation: "scene.context", campaign: campaignId, arguments: {} },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    correctedHandoffRetained = String(error?.message ?? error).includes(
      '"operation":"setup.complete"',
    );
  }
  check("corrected live Grok setup advances only the exact retained route",
    wrongBootstrapRejected
    && beforeWrongBootstrap === 2
    && harness.calls.length === 3
    && harness.calls.map((call) => call.params.operation).join(",") === [
      "setup.invoke",
      "progressive.prepare_opening",
      "progressive.opening_bootstrap",
    ].join(",")
    && correctedBootstrap.ok === true
    && correctedBootstrap.data.status === "current"
    && correctedHandoffRetained
    && harness.launches.length === 0);
  await harness.shutdown();
}

// A bootstrap packet rejected by the observer cannot bypass that decision in
// the gateway. It launches no coordinator and releases the exact retry latch.
{
  const campaignId = "gateway-packet-b";
  const wrongTask = coordinatorTask("gateway-packet-a", {
    campaignId: "gateway-packet-a",
  });
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) {
      return boundOpeningSetupResult(campaignId);
    }
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(wrongTask);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness, campaignId);
  const rejected = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "gateway-wrong-packet",
    bootstrapOpeningParams(campaignId),
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const hiddenFinal = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "wrong campaign packet prose" }],
  });
  const retry = harness.sent.findLast((entry) => (
    entry.message?.customType === "coc-opening-setup-route"
  ));
  check("observer rejection prevents wrong-campaign coordinator launch",
    rejected.ok === false
    && rejected.error.code === "opening_bootstrap_result_rejected"
    && harness.launches.length === 0
    && !hiddenFinal.content.some((part) => part.type === "text")
    && harness.appended.some((entry) => (
      entry.name === "coc-opening-setup-route-audit"
      && entry.value.reason === "invocation_or_campaign_mismatch"
      && entry.value.invocation_id === "gateway-wrong-packet"
    )));
  check("wrong-campaign packet releases the exact bootstrap retry latch",
    retry?.message?.details?.campaign_id === campaignId
    && retry.message.details.next_operation?.operation
      === "progressive.opening_bootstrap"
    && retry.options?.triggerTurn === true);
  await harness.shutdown();
}

// An admitted bootstrap whose MCP returns CanonicalToolError(ok:false)
// stays owned through observe. The gateway must not finalize the attempt
// before observation, and must not rewrite the canonical L0 code into
// opening_bootstrap_result_rejected / unowned_result. A later foreign
// packet still fail-closes.
{
  const campaignId = "gateway-owned-l0-fail";
  const ownedId = "owned-canonical-bootstrap-fail";
  const foreignId = "foreign-never-registered-bootstrap";
  const wrongTask = coordinatorTask("gateway-owned-l0-foreign", {
    campaignId: "gateway-owned-l0-foreign",
  });
  let bootstrapCalls = 0;
  const l0Envelope = {
    ok: false,
    tool: "progressive.opening_bootstrap",
    error: {
      code: "opening_l0_direct_write_invalid",
      message: "opening L0 direct write invalid",
      details: { reason: "module_init_hook_locale" },
    },
  };
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) {
      return boundOpeningSetupResult(campaignId);
    }
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      bootstrapCalls += 1;
      if (bootstrapCalls === 1) {
        throw new runtime.CanonicalToolError(
          "coc_invoke",
          "opening_l0_direct_write_invalid",
          (
            "canonical coc_invoke failed: opening_l0_direct_write_invalid: "
            + "opening L0 direct write invalid"
          ),
          l0Envelope.error.details,
          l0Envelope,
        );
      }
      return openingBootstrapResult(wrongTask);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness, campaignId);
  const owned = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    ownedId,
    bootstrapOpeningParams(campaignId),
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const ownedBlocker = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "owned l0 failure prose" }],
  });
  const hiddenBlocker = harness.appended.find((entry) => (
    entry.name === "coc-opening-setup-terminal-blocker"
  ))?.value;
  check("admitted CanonicalToolError bootstrap stays owned with L0 code",
    owned.ok === false
    && owned.error.code === "opening_l0_direct_write_invalid"
    && owned.error.code !== "opening_bootstrap_result_rejected"
    && owned.error.code !== "opening_setup_route_call_failed"
    && harness.launches.length === 0
    && !harness.appended.some((entry) => (
      entry.name === "coc-opening-setup-route-audit"
      && entry.value.invocation_id === ownedId
      && entry.value.reason === "unowned_result"
    ))
    && hiddenBlocker?.error_code === "opening_l0_direct_write_invalid"
    && hiddenBlocker?.failure_class !== "opening_bootstrap_result_rejected"
    && ownedBlocker.content.some((part) => (
      part.type === "text"
      && part.text.includes("开场资料解析失败")
    )));
  const foreign = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    foreignId,
    {
      operation: "progressive.opening_bootstrap",
      campaign: campaignId,
      arguments: {
        start_location: { location_id: "opening-foreign", title: "Foreign" },
        opening_pdf_indices: [1],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("foreign bootstrap packet still fail-closes after owned L0 failure",
    foreign.ok === false
    && foreign.error.code === "opening_bootstrap_result_rejected"
    && harness.launches.length === 0
    && harness.appended.some((entry) => (
      entry.name === "coc-opening-setup-route-audit"
      && entry.value.reason === "invocation_or_campaign_mismatch"
      && entry.value.invocation_id === foreignId
    ))
    && !harness.appended.some((entry) => (
      entry.name === "coc-opening-setup-route-audit"
      && entry.value.invocation_id === ownedId
      && entry.value.reason === "unowned_result"
    )));
  await harness.shutdown();
}

// Dispatch ownership is revalidated after the asynchronous capability check.
// A concurrent contract-invalid result can supersede the admitted bootstrap
// while enabled() is pending; the old packet must never reach launch.
{
  const campaignId = "gateway-enabled-race";
  const task = coordinatorTask("gateway-enabled-race-task", { campaignId });
  const enabled = deferredValue();
  const invalidation = deferredValue();
  let enabledChecks = 0;
  let bootstrapCalls = 0;
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) {
      return boundOpeningSetupResult(campaignId);
    }
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      bootstrapCalls += 1;
      return bootstrapCalls === 1
        ? invalidation.promise
        : openingBootstrapResult(task);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  }, {
    coordinatorEnabled: async () => {
      enabledChecks += 1;
      return enabled.promise;
    },
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness, campaignId);
  const invalidationParams = bootstrapOpeningParams(campaignId);
  const invalidationPending = harness.registered.get("coc_invoke").execute(
    "gateway-enabled-race-invalid",
    invalidationParams,
    undefined,
    undefined,
    harness.ctx,
  );
  const bootstrapPending = harness.registered.get("coc_invoke").execute(
    "gateway-enabled-race-bootstrap",
    bootstrapOpeningParams(campaignId),
    undefined,
    undefined,
    harness.ctx,
  );
  await nextTurn();
  check("capability race reaches deferred enabled ownership window",
    enabledChecks === 1 && harness.launches.length === 0);
  invalidation.resolve({
    ok: false,
    error: {
      code: "opening_source_contract_invalid",
      details: {
        ...openingSetupGate(null, campaignId),
        phase: "opening_source_contract_invalid",
        next_operation: null,
      },
    },
  });
  await invalidationPending;
  enabled.resolve(true);
  const rejected = JSON.parse((await bootstrapPending).content[0].text);
  const visibleBlocker = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "stale bootstrap prose" }],
  });
  const retrySuppressed = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "second stale bootstrap prose" }],
  });
  const retry = harness.sent.findLast((entry) => (
    entry.message?.customType === "coc-opening-setup-route"
  ));
  check("post-enabled ownership loss launches zero coordinators",
    rejected.ok === false
    && rejected.data.coordinator_terminal.failure_class
      === "opening_dispatch_ownership_lost"
    && harness.launches.length === 0
    && harness.appended.some((entry) => (
      entry.name === "coc-opening-setup-route-audit"
      && entry.value.reason === "opening_dispatch_ownership_lost"
      && entry.value.invocation_id === "gateway-enabled-race-bootstrap"
    )));
  check("ownership race retains blocker and exact current recovery route",
    visibleBlocker.content.some((part) => (
      part.type === "text"
      && part.text.includes("开场资料解析失败")
    ))
    && !retrySuppressed.content.some((part) => part.type === "text")
    && retry?.message?.details?.campaign_id === campaignId
    && retry.message.details.phase === "opening_source_contract_invalid"
    && retry.message.details.next_operation?.operation
      === "progressive.prepare_opening");
  await harness.shutdown();
}

// If another coordinator is active, submit only queues the opening packet.
// The same exact owner guard travels with that pending item and is checked at
// its later real launch, including after revision invalidation.
{
  const campaignId = "gateway-pending-race";
  const activeTask = coordinatorTask("gateway-pending-active", { campaignId });
  const openingTask = coordinatorTask("gateway-pending-opening", {
    campaignId,
  });
  const invalidation = deferredValue();
  let bootstrapCalls = 0;
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "session.resume") {
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaignId,
          mode: "awaiting_player",
        },
      };
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) {
      return boundOpeningSetupResult(campaignId);
    }
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      bootstrapCalls += 1;
      return bootstrapCalls === 1
        ? invalidation.promise
        : openingBootstrapResult(openingTask);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  }, { startupCampaignId: campaignId, sessionRole: "setup" });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "gateway-pending-startup-resume",
    {
      operation: "session.resume",
      root,
      campaign: campaignId,
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  await harness.registered.get("coc_dispatch_source_work").execute(
    "gateway-pending-active-dispatch",
    { task: activeTask },
    undefined,
    undefined,
    harness.ctx,
  );
  await nextTurn();
  check("pending ownership race starts one unrelated active coordinator",
    harness.launches.join(",") === activeTask.packet.packet_id);
  await armOpeningBootstrapRoute(harness, campaignId);
  const invalidationParams = bootstrapOpeningParams(campaignId);
  const invalidationPending = harness.registered.get("coc_invoke").execute(
    "gateway-pending-invalid",
    invalidationParams,
    undefined,
    undefined,
    harness.ctx,
  );
  const bootstrapPending = harness.registered.get("coc_invoke").execute(
    "gateway-pending-bootstrap",
    bootstrapOpeningParams(campaignId),
    undefined,
    undefined,
    harness.ctx,
  );
  await nextTurn();
  check("opening packet is pending without an early prompt launch",
    harness.launches.join(",") === activeTask.packet.packet_id);
  invalidation.resolve({
    ok: false,
    error: {
      code: "opening_source_contract_invalid",
      details: {
        ...openingSetupGate(null, campaignId),
        phase: "opening_source_contract_invalid",
        next_operation: null,
      },
    },
  });
  await invalidationPending;
  harness.controls.get(activeTask.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(activeTask.packet.packet_id),
  );
  const blocked = JSON.parse((await bootstrapPending).content[0].text);
  await nextTurn();
  await nextTurn();
  check("pending packet revalidates at real launch and remains zero-launch",
    harness.launches.join(",") === activeTask.packet.packet_id
    && blocked.ok === true
    && blocked.data.status === "queued"
    && harness.appended.some((entry) => (
      entry.name === "coc-opening-setup-route-audit"
      && entry.value.reason === "opening_dispatch_ownership_lost"
      && entry.value.invocation_id === "gateway-pending-bootstrap"
    )));
  await harness.shutdown();
}

// A fulfilled background terminal may race immediately after an authoritative
// opening selection. Character detours remain rejected and projection follows
// the exact retained route. The recovered-character block above owns the
// Quick-Fire Luck/create/link coverage for campaigns that actually need it.
{
  const task = coordinatorTask("fulfilled-before-chargen-luck");
  const campaignId = "auto-dispatch-fixture";
  const investigatorId = "fulfilled-chargen-investigator";
  const luckDecisionId = "fulfilled-before-chargen-luck-roll";
  const luckRollId = "toolbox-auto-dispatch-fixture-000009";
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult(campaignId);
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    if (params.operation === "rules.roll_dice") {
      return {
        ok: true,
        tool: "rules.roll_dice",
        data: {
          expression: "3D6",
          rolls: [2, 3, 4],
          total: 9,
          roll_id: luckRollId,
        },
      };
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "investigator.create"
    ) {
      return {
        ok: true,
        tool: "setup.invoke",
        data: {
          schema_version: 1,
          status: "PASS",
          kind: "investigator.create",
          result: { investigator_id: investigatorId },
        },
      };
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "campaign.link_investigator"
    ) {
      return canonicalLinkSetupResult(campaignId, [investigatorId]);
    }
    if (params.operation === "progressive.project_opening") {
      return {
        ok: true,
        tool: "progressive.project_opening",
        data: { status: "current" },
      };
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness, campaignId);
  const queued = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "fulfilled-chargen-bootstrap",
    bootstrapOpeningParams(campaignId),
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();

  const callsBeforeCharacterDetours = harness.calls.length;
  let rejectedCharacterDetours = 0;
  for (const [index, params] of [
    {
      operation: "rules.roll_dice",
      campaign: campaignId,
      arguments: {
        expression: "3D6",
        decision_id: luckDecisionId,
        purpose: "investigator_creation_luck",
        reason: "Quick-Fire investigator Luck",
      },
    },
    guidedQuickFireCreateParams(campaignId, investigatorId),
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: {
        kind: "campaign.link_investigator",
        payload: {
          campaign_id: campaignId,
          investigator_ids: [investigatorId],
        },
      },
    },
    { operation: "scene.context", campaign: campaignId, arguments: {} },
  ].entries()) {
    try {
      await harness.registered.get("coc_invoke").execute(
        `fulfilled-current-detour-${index}`,
        params,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch { rejectedCharacterDetours += 1; }
  }
  let hostOnlyProjectionRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "fulfilled-chargen-project",
      {
        operation: "progressive.project_opening",
        campaign: campaignId,
        arguments: {
          asset_root_id: task.packet.asset_root_id,
          source_file_sha256: "a".repeat(64),
          start_location_id: "opening",
          opening_pdf_indices: [0],
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    hostOnlyProjectionRejected = error instanceof Error
      && error.message.includes("not allowed in session role setup");
  }
  check("typed setup rejects character detours and host-only projection",
    queued.data.status === "queued"
    && rejectedCharacterDetours === 4
    && hostOnlyProjectionRejected
    && harness.calls.length === callsBeforeCharacterDetours
    && harness.calls.filter((call) => (
      call.params.operation === "progressive.project_opening"
    )).length === 0);
  await harness.shutdown();
}

// A failed hidden route delivery must release both the route latch and owner
// so the identical retained route can be delivered exactly once on retry.
{
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult();
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    throw new Error(`unexpected operation ${params.operation}`);
  }, {
    sendFailuresByType: { "coc-opening-setup-route": 1 },
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  const first = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "第一次路由发送失败。" }],
  });
  const second = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "第二次重试同一路由。" }],
  });
  check("route send failure releases exact retained route for one retry",
    first.content.every((part) => part.type !== "text")
    && second.content.every((part) => part.type !== "text")
    && harness.sent.filter((entry) => (
      entry.message?.customType === "coc-opening-setup-route"
    )).length === 1);
  await harness.shutdown();
}

// Failure after an actually armed bind -> prepare -> bootstrap route is
// player-visible through host provenance, retains one valid exact retry, and
// does not leave the continuation latch consumed.
{
  const task = coordinatorTask("terminal-before-submit-gateway");
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult();
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  }, {
    immediateCoordinatorEvents: failedCoordinatorEvents(
      task.packet.packet_id,
      "leaf_dispatch_failed",
    ),
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  const terminal = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "terminal-before-submit-bootstrap",
    bootstrapOpeningParams("auto-dispatch-fixture"),
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("real gateway terminal-before-submit never reports queued success",
    terminal.ok === false
    && terminal.error.code === "opening_source_terminal_failure"
    && terminal.data.source_dependency_terminal === true
    && terminal.data.coordinator_terminal.packet_id === task.packet.packet_id
    && terminal.data.coordinator_terminal.status === "failed"
    && harness.appended.filter((entry) => (
      entry.name === "coc-source-coordinator-terminal"
    )).length === 1);
  await harness.shutdown();
}

// A failed terminal continuation delivery releases the terminal owner. The
// fulfilled projection route then remains available for one natural retry.
{
  const task = coordinatorTask("terminal-send-retry");
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult();
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  }, {
    sendFailuresByType: {
      "coc-source-coordinator-terminal-continuation": 1,
    },
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  await harness.registered.get("coc_invoke").execute(
    "terminal-send-bootstrap",
    bootstrapOpeningParams("auto-dispatch-fixture"),
    undefined,
    undefined,
    harness.ctx,
  );
  const callsBeforeTerminalDetours = harness.calls.length;
  let terminalDetoursRejected = 0;
  for (const [index, params] of [
    guidedQuickFireCreateParams(
      "auto-dispatch-fixture",
      "terminal-send-investigator",
    ),
    {
      operation: "setup.invoke",
      campaign: "auto-dispatch-fixture",
      arguments: {
        kind: "campaign.link_investigator",
        payload: {
          campaign_id: "auto-dispatch-fixture",
          investigator_ids: ["terminal-send-investigator"],
        },
      },
    },
  ].entries()) {
    try {
      await harness.registered.get("coc_invoke").execute(
        `terminal-send-character-detour-${index}`,
        params,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch { terminalDetoursRejected += 1; }
  }
  for (const handler of harness.handlers.get("agent_end") || []) {
    await handler({ reason: "terminal-send-idle" }, harness.ctx);
  }
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  const retry = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "终态发送失败后的精确投影重试。" }],
  });
  check("terminal send failure retains one exact projection route retry",
    terminalDetoursRejected === 2
    && harness.calls.length === callsBeforeTerminalDetours
    && retry.content.every((part) => part.type !== "text")
    && harness.sent.filter((entry) => (
      entry.message?.customType
        === "coc-source-coordinator-terminal-continuation"
    )).length === 0
    && harness.sent.filter((entry) => (
      entry.message?.customType === "coc-opening-setup-route"
      && entry.message?.details?.next_operation?.operation
        === "progressive.project_opening"
    )).length === 1);
  await harness.shutdown();
}

// Failure after an actually armed bind -> prepare -> bootstrap route is
// player-visible through host provenance, retains one valid exact retry, and
// does not leave the continuation latch consumed.
{
  const task = coordinatorTask("coord-armed-opening-failure");
  let bootstrapCalls = 0;
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) {
      return boundOpeningSetupResult();
    }
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      bootstrapCalls += 1;
      return bootstrapCalls === 1
        ? openingBootstrapResult(task)
        : openingBootstrapWithoutTakeover(task, "current");
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  const submitted = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "invoke-armed-opening-failure",
    {
      operation: "progressive.opening_bootstrap",
      campaign: "auto-dispatch-fixture",
      arguments: {
        start_location: { location_id: "location:opening", title: "Opening" },
        opening_pdf_indices: [0],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  harness.controls.get(task.packet.packet_id).resolve(
    failedCoordinatorEvents(task.packet.packet_id, "leaf_dispatch_failed"),
  );
  await nextTurn();
  await nextTurn();
  const visibleBlocker = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "我将忽略失败并虚构开场。" }],
  });
  const blockerText = visibleBlocker.content.find(
    (part) => part.type === "text",
  )?.text;
  const hiddenBlocker = harness.appended.find((entry) => (
    entry.name === "coc-opening-setup-terminal-blocker"
  ))?.value;
  check("armed terminal failure publishes exact Chinese prose only",
    submitted.ok === true
    && submitted.data.status === "queued"
    && blockerText === (
      "开场资料解析失败，游戏尚未开始。系统保留了当前进度；"
      + "你可以重试原来的开场步骤，在资料就绪前不会自行编写剧情。"
    )
    && !/[{}]/.test(blockerText)
    && !blockerText.includes("schema_version")
    && !blockerText.includes("failure_class")
    && !blockerText.includes("next_operation")
    && !blockerText.includes("progressive.opening_bootstrap")
    && !blockerText.includes("忽略失败"));
  check("armed terminal failure keeps retry details hidden and inspectable",
    hiddenBlocker.status === "blocked"
    && hiddenBlocker.hard_gate === true
    && hiddenBlocker.activation_allowed === false
    && hiddenBlocker.error_code === "opening_source_terminal_failure"
    && hiddenBlocker.next_operation.operation
      === "progressive.opening_bootstrap");

  const retryCharacterRound = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "后台重试待定，我们继续完善调查员背景。" }],
  });
  check("terminal retry phase suppresses prose until exact bootstrap retry",
    retryCharacterRound.content.every((part) => part.type !== "text"));

  const retried = JSON.parse((await harness.registered.get("coc_invoke").execute(
    "retry-armed-opening-after-failure",
    {
      operation: "progressive.opening_bootstrap",
      campaign: "auto-dispatch-fixture",
      arguments: {
        start_location: { location_id: "location:opening", title: "Opening" },
        opening_pdf_indices: [0],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("armed failure retry is admitted and releases only on current",
    bootstrapCalls === 2
    && retried.ok === true
    && retried.data.status === "current");
  await harness.shutdown();
}

// Once the background launch is durably submitted, aborting the foreground
// tool call does not cancel or duplicate that owned source job.
{
  const task = coordinatorTask("coord-armed-opening-abort");
  let bootstrapCalls = 0;
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) {
      return boundOpeningSetupResult();
    }
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      bootstrapCalls += 1;
      return bootstrapCalls === 1
        ? openingBootstrapResult(task)
        : openingBootstrapWithoutTakeover(task, "current");
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  const controller = new AbortController();
  const pending = harness.registered.get("coc_invoke").execute(
    "invoke-armed-opening-abort",
    {
      operation: "progressive.opening_bootstrap",
      campaign: "auto-dispatch-fixture",
      arguments: {
        start_location: { location_id: "location:opening", title: "Opening" },
        opening_pdf_indices: [0],
      },
    },
    controller.signal,
    undefined,
    harness.ctx,
  );
  await nextTurn();
  controller.abort();
  const submitted = JSON.parse((await pending).content[0].text);
  const characterPrompt = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "后台解析中，我们继续创建调查员。" }],
  });
  check("foreground abort preserves submitted background opening phase",
    submitted.ok === true
    && submitted.data.status === "queued"
    && characterPrompt.content.every((part) => part.type !== "text")
    && harness.controls.get(task.packet.packet_id).terminated === false);

  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  check("background terminal after character selection remains append-only",
    harness.appended.filter((entry) => (
      entry.name === "coc-source-coordinator-terminal"
    )).length === 1
    && harness.sent.length === 0);

  let duplicateBootstrapRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "retry-armed-opening-after-abort",
      bootstrapOpeningParams("auto-dispatch-fixture"),
      undefined,
      undefined,
      harness.ctx,
    );
  } catch {
    duplicateBootstrapRejected = true;
  }
  check("fulfilled background forbids duplicate bootstrap",
    duplicateBootstrapRejected && bootstrapCalls === 1);
  await harness.shutdown();
}

// The bind receipt owns the setup generation's player-safe source context.
// A later sparse progressive rerender may stay a valid canonical receipt, but
// the gate must permit the KP's one conversational summary instead of dumping
// either Markdown document into player-visible output.
{
  const campaignId = "bind-briefing-first";
  const gate = playOpeningGate();
  gate.markAgentStart();
  const bindText = "绑定回执中的玩家安全开卡序章。";
  const bindBriefing = {
    campaignId,
    sourceKind: "scenario.bind_pdf",
    publicSetupSha256: "a".repeat(64),
    text: bindText,
    textSha256: "",
  };
  // canonicalJsonValueSha256 is intentionally private; reproduce the exact
  // JSON-value hash used by the gate for this closed test value.
  bindBriefing.textSha256 = (
    `sha256:${createHash("sha256").update(
      JSON.stringify(bindText),
      "utf8",
    ).digest("hex")}`
  );
  bindReviewedCharacterRoute(
    gate,
    campaignId,
    "bind-briefing-first",
    bindBriefing,
  );
  const renderParams = {
    operation: "setup.invoke",
    campaign: campaignId,
    arguments: {
      kind: "campaign.render_briefing",
      payload: { campaign_id: campaignId, language: "zh-Hans" },
    },
  };
  const renderInvocationId = "bind-briefing-first-rerender";
  check("same-generation canonical rerender remains mechanically admitted",
    gate.openingSetupToolError(
      "coc_invoke",
      renderParams,
      renderInvocationId,
    ) === null);
  const sparseText = "稀疏 progressive module 的 unknown 通用序章。";
  const sparseBriefing = {
    campaignId,
    sourceKind: "campaign.render_briefing",
    publicSetupSha256: "b".repeat(64),
    text: sparseText,
    textSha256: (
      `sha256:${createHash("sha256").update(
        JSON.stringify(sparseText),
        "utf8",
      ).digest("hex")}`
    ),
  };
  const observed = gate.observeOpeningSetupInvocation(
    "setup.invoke",
    renderParams,
    {
      ok: true,
      tool: "setup.invoke",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "campaign.render_briefing",
        result: {
          campaign_id: campaignId,
          briefing_path: (
            `.coc/campaigns/${campaignId}/assets/character-creation/`
            + "progressive-module-briefing.md"
          ),
          public_setup_sha256: "b".repeat(64),
        },
      },
    },
    renderInvocationId,
    sparseBriefing,
  );
  const conversationalSummary = "这是一场围绕旧档案展开的调查。你想扮演什么职业？";
  const visible = gate.acceptVisibleAssistantFinal(conversationalSummary);
  check("briefing receipt permits one conversational KP summary without dump",
    observed.accepted === true
    && visible === true
    && conversationalSummary !== bindText
    && conversationalSummary !== sparseText
    && gate.takeOpeningSetupAudits().some((entry) => (
      entry.reason === "bind_briefing_owns_setup_generation"
      && entry.retained_public_setup_sha256 === "a".repeat(64)
      && entry.ignored_public_setup_sha256 === "b".repeat(64)
    )));
}

// The main KP gateway never owns private source-work leases. All four
// lifecycle methods remain available only to the isolated coordinator.
{
  const harness = mainExtensionHarness(() => {
    throw new Error("private lifecycle reached main MCP client");
  });
  await harness.start();
  const callsBeforePrivate = harness.calls.length;
  const rejected = [];
  for (const operation of [
    "progressive.claim_host_work",
    "progressive.fulfill_host_work",
    "progressive.renew_host_work_leases",
    "progressive.release_host_work_leases",
  ]) {
    try {
      await harness.registered.get("coc_invoke").execute(
        `invoke-private-${operation}`,
        {
          operation,
          campaign: "auto-dispatch-fixture",
          arguments: {},
        },
        undefined,
        undefined,
        harness.ctx,
      );
    } catch (error) {
      rejected.push(error);
    }
  }
  check("main KP rejects every private source lease lifecycle operation",
    rejected.length === 4
    && rejected.every((error) => (
      error instanceof Error
      && error.message.includes("private source coordinator lifecycle")
    ))
    && harness.calls.length === callsBeforePrivate);
  await harness.shutdown();
}

// Opening source work starts after authoritative character selection and stays
// nonblocking. Character detours cannot reopen setup; live play waits for one
// terminal projection and releases one opening.
{
  const task = coordinatorTask("coord-main-opening-success");
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult();
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "campaign.render_briefing"
    ) {
      return {
        ok: true,
        tool: "setup.invoke",
        data: {
          status: "PASS",
          result: { briefing_path: ".coc/fixture/scenario-briefing.md" },
        },
      };
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "campaign.link_investigator"
    ) {
      return canonicalLinkSetupResult(
        "auto-dispatch-fixture",
        ["phase-inv"],
      );
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "investigator.create"
    ) {
      return canonicalGuidedCreateResult("phase-inv");
    }
    if (params.operation === "progressive.project_opening") {
      return {
        ok: true,
        tool: "progressive.project_opening",
        data: { status: "current" },
      };
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  const bootstrap = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "phase-bootstrap",
    bootstrapOpeningParams("auto-dispatch-fixture"),
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("bootstrap starts one nonblocking background opening job",
    bootstrap.ok === true
    && bootstrap.data.status === "queued"
    && bootstrap.data.source_dependency_terminal === false
    && harness.launches.join(",") === task.packet.packet_id);

  const callsBeforeBriefingDetour = harness.calls.length;
  let briefingDetourRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "phase-briefing-detour",
      {
        operation: "setup.invoke",
        campaign: "auto-dispatch-fixture",
        arguments: {
          kind: "campaign.render_briefing",
          payload: {
            campaign_id: "auto-dispatch-fixture",
            language: "zh-Hans",
          },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { briefingDetourRejected = true; }
  check("background parsing cannot reopen the completed character briefing",
    briefingDetourRejected
    && harness.calls.length === callsBeforeBriefingDetour);

  for (let index = 0; index < 3; index += 1) {
    for (const handler of harness.handlers.get("agent_end") || []) {
      await handler({ reason: `phase-${index}` }, harness.ctx);
    }
    for (const handler of harness.handlers.get("agent_start") || []) {
      await handler({ reason: `phase-${index}` }, harness.ctx);
    }
    const visible = await harness.emit("message_end", {
      role: "assistant",
      content: [{ type: "text", text: `自然开卡对话 ${index + 1}` }],
    });
    check(`background parsing suppresses premature play round ${index + 1}`,
      visible.content.every((part) => part.type !== "text"));
  }

  const callsBeforeCharacterDetours = harness.calls.length;
  let phaseCharacterDetoursRejected = 0;
  for (const [index, params] of [
    guidedQuickFireCreateParams("auto-dispatch-fixture", "phase-inv"),
    {
      operation: "setup.invoke",
      campaign: "auto-dispatch-fixture",
      arguments: {
        kind: "campaign.link_investigator",
        payload: {
          campaign_id: "auto-dispatch-fixture",
          investigator_ids: ["phase-inv"],
        },
      },
    },
  ].entries()) {
    try {
      await harness.registered.get("coc_invoke").execute(
        `phase-character-detour-${index}`,
        params,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch { phaseCharacterDetoursRejected += 1; }
  }
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  const terminalVisible = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "调查员已创建并加入本次游戏。" }],
  });
  const callsBeforeScene = harness.calls.length;
  let sceneBlocked = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "phase-scene",
      {
        operation: "scene.context",
        campaign: "auto-dispatch-fixture",
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch {
    sceneBlocked = true;
  }
  const openingHidden = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "投影前的虚构开场。" }],
  });
  check("fulfilled source keeps live play blocked until projection",
    phaseCharacterDetoursRejected === 2
    && harness.calls.length === callsBeforeCharacterDetours
    && terminalVisible.content.every((part) => part.type !== "text")
    && sceneBlocked
    && harness.calls.length === callsBeforeScene
    && openingHidden.content.every((part) => part.type !== "text"));

  for (const handler of harness.handlers.get("agent_end") || []) {
    await handler({ reason: "phase-terminal" }, harness.ctx);
  }
  await nextTurn();
  await nextTurn();
  const projectionTriggers = harness.sent.filter((entry) => (
    entry.options?.triggerTurn === true
    && [
      "coc-opening-setup-route",
      "coc-source-coordinator-terminal-continuation",
    ].includes(entry.message?.customType)
  ));
  check("terminal-after-link race releases one route or wake, never both",
    projectionTriggers.length === 1
    && projectionTriggers[0].message.customType === "coc-opening-setup-route"
    && harness.sent.filter((entry) => (
      entry.message?.customType
        === "coc-source-coordinator-terminal-continuation"
    )).length === 0);

  for (const handler of harness.handlers.get("agent_start") || []) {
    await handler({ reason: "phase-project" }, harness.ctx);
  }
  const callsBeforeHostProjection = harness.calls.length;
  let hostProjectionRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "phase-project",
      {
        operation: "progressive.project_opening",
        campaign: "auto-dispatch-fixture",
        arguments: {
          asset_root_id: task.packet.asset_root_id,
          source_file_sha256: "a".repeat(64),
          start_location_id: "opening",
          opening_pdf_indices: [0],
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    hostProjectionRejected = error instanceof Error
      && error.message.includes("not allowed in session role setup");
  }
  const openingVisible = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "来源投影完成后的唯一开场。" }],
  });
  const projectionRoute = harness.sent.findLast((entry) => (
    entry.message?.customType === "coc-opening-setup-route"
    && entry.message?.details?.next_operation?.operation
      === "progressive.project_opening"
  ));
  check("typed setup keeps host-only projection outside the model surface",
    hostProjectionRejected
    && harness.calls.length === callsBeforeHostProjection
    && harness.calls.filter((call) => (
      call.params.operation === "progressive.project_opening"
    )).length === 0
    && openingVisible.content.every((part) => part.type !== "text")
    && projectionRoute?.options?.triggerTurn === true
    && harness.sent.filter((entry) => (
      entry.message?.customType
        === "coc-source-coordinator-terminal-continuation"
    )).length === 0);
  await harness.shutdown();
}

// A stale in-memory table-opening route must yield to the newest canonical
// freshness gate. The refresh runs without a Pi restart, then re-arms exactly
// one table-opening receipt; its current-dependency snapshot also executes the
// retired-helper regression path.
{
  const campaignId = "opening-refresh-without-restart";
  const investigatorId = "opening-refresh-investigator";
  const task = coordinatorTask("opening-refresh-current", { campaignId });
  const refreshCard = {
    operation: "progressive.project_opening",
    invoke_via: "coc_invoke",
    prefilled_arguments: {
      asset_root_id: task.packet.asset_root_id,
      source_file_sha256: "a".repeat(64),
      start_location_id: "opening",
    },
    missing_arguments: [],
    hard_gate: true,
    authority: "canonical_setup",
    reason: "refresh the stale opening projection",
  };
  const freshnessGate = {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_source_materialization",
    campaign_id: campaignId,
    asset_root_id: task.packet.asset_root_id,
    source_lifecycle_status: "complete",
    next_operation: refreshCard,
    instruction: "invoke the exact canonical opening projection refresh card",
  };
  const freshnessEnvelope = {
    ok: false,
    tool: "evidence.table_opening",
    error: {
      code: "opening_setup_incomplete",
      message: "opening projection is no longer fresh",
      details: freshnessGate,
    },
  };
  const openingText = [
    "[in_game]",
    "重投影后的唯一权威开场。",
    "[/in_game]",
  ].join("\n");
  let evidenceCalls = 0;
  const harness = mainExtensionHarness((name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult(campaignId);
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "investigator.create"
    ) return canonicalGuidedCreateResult(investigatorId);
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "campaign.link_investigator"
    ) return canonicalLinkSetupResult(campaignId, [investigatorId]);
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapWithoutTakeover(task, "current");
    }
    if (params.operation === "progressive.project_opening") {
      return {
        ok: true,
        tool: "progressive.project_opening",
        data: {
          status: "current",
          progressive: {
            campaign_id: campaignId,
            current_dependency_snapshot_complete: true,
            current_dependency_waits: [],
            current_dependency_dispatches: [],
          },
        },
      };
    }
    if (params.operation === "evidence.table_opening") {
      evidenceCalls += 1;
      if (evidenceCalls === 1) {
        throw new runtime.CanonicalToolError(
          "coc_invoke",
          "opening_setup_incomplete",
          "canonical coc_invoke failed: opening_setup_incomplete",
          freshnessGate,
          freshnessEnvelope,
        );
      }
      return {
        ok: true,
        tool: "evidence.table_opening",
        data: {
          turn: 0,
          text: openingText,
          text_sha256: `sha256:${createHash("sha256").update(
            JSON.stringify(openingText),
          ).digest("hex")}`,
          authoritative_time_anchor: {
            schema_version: 1,
            display: "重投影后的清晨",
            rendered_line: "【开场时间】重投影后的清晨",
          },
        },
      };
    }
    throw new Error(`unexpected refresh operation ${name}:${params.operation}`);
  }, { coordinatorEnabled: async () => false });
  await harness.start();
  await armOpeningBootstrapRoute(harness, campaignId);
  const bootstrapped = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "opening-refresh-bootstrap",
    bootstrapOpeningParams(campaignId),
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const callsBeforeRefreshDetours = harness.calls.length;
  let refreshCharacterDetoursRejected = 0;
  for (const [index, params] of [
    guidedQuickFireCreateParams(campaignId, investigatorId),
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: {
        kind: "campaign.link_investigator",
        payload: {
          campaign_id: campaignId,
          investigator_ids: [investigatorId],
        },
      },
    },
  ].entries()) {
    try {
      await harness.registered.get("coc_invoke").execute(
        `opening-refresh-character-detour-${index}`,
        params,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch { refreshCharacterDetoursRejected += 1; }
  }
  const openingParams = {
    operation: "evidence.table_opening",
    campaign: campaignId,
    arguments: {
      text: openingText,
      presented_roll_ids: [],
    },
  };
  let setupHandoffRetained = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "opening-refresh-stale-evidence",
      openingParams,
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    setupHandoffRetained = String(error?.message ?? error).includes(
      '"operation":"setup.complete"',
    );
  }
  const callsBeforeBlockedScene = harness.calls.length;
  let livePlayStillBlocked = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "opening-refresh-live-play-detour",
      { operation: "scene.context", campaign: campaignId, arguments: {} },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    livePlayStillBlocked = String(error?.message ?? error).includes(
      '"operation":"setup.complete"',
    );
  }
  let hostRefreshRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "opening-refresh-project",
      {
        operation: "progressive.project_opening",
        campaign: campaignId,
        arguments: refreshCard.prefilled_arguments,
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    hostRefreshRejected = error instanceof Error
      && (
        error.message.includes('"operation":"setup.complete"')
        || error.message.includes("not allowed in session role setup")
      );
  }
  check("typed setup retains its handoff before stale opening refresh",
    bootstrapped.ok === true
    && bootstrapped.data.status === "current"
    && refreshCharacterDetoursRejected === 2
    && callsBeforeRefreshDetours === 3
    && setupHandoffRetained
    && livePlayStillBlocked
    && hostRefreshRejected
    && harness.calls.length === callsBeforeBlockedScene
    && harness.calls.filter((call) => (
      call.params.operation === "progressive.project_opening"
    )).length === 0
    && harness.calls.filter((call) => (
      call.params.operation === "evidence.table_opening"
    )).length === 0
    && harness.launches.length === 0);
  await harness.shutdown();
}

// Terminal source failure releases no projection call or invented opening.
{
  const task = coordinatorTask("coord-main-opening-failure");
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult();
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  const submitted = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "invoke-opening-failure",
    bootstrapOpeningParams("auto-dispatch-fixture"),
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  harness.controls.get(task.packet.packet_id).resolve(
    failedCoordinatorEvents(
      task.packet.packet_id,
      "leaf_dispatch_failed",
    ),
  );
  await nextTurn();
  await nextTurn();
  const blocker = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "失败后虚构开场。" }],
  });
  check("failed opening fails closed without projection",
    submitted.ok === true
    && submitted.data.status === "queued"
    && harness.calls.length === 3
    && blocker.content.some((part) => (
      part.type === "text"
      && part.text.includes("开场资料解析失败")
    )));
  check("failed opening has one durable terminal and no duplicate wake",
    harness.appended.filter((entry) => (
      entry.name === "coc-source-coordinator-terminal"
    )).length === 1
    && harness.sent.length === 0);
  await nextTurn();
  await harness.shutdown();
}

// Queued/coalesced opening output without a takeover is a transport gap, not a
// terminal opening_source_failure. Surface the canonical receipt, audit the
// missing task as deferred, and let the materialization gate recover later.
{
  const task = coordinatorTask("coord-main-opening-no-takeover");
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult();
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapWithoutTakeover(task, "queued");
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  let rejection;
  let toolResult;
  try {
    toolResult = await harness.registered.get("coc_invoke").execute(
      "invoke-opening-no-takeover",
      {
        operation: "progressive.opening_bootstrap",
        campaign: "auto-dispatch-fixture",
        arguments: {
          start_location: { location_id: "location:opening", title: "Opening" },
          opening_pdf_indices: [0],
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    rejection = error;
  }
  const audit = harness.appended.find((entry) => (
    entry.name === "coc-source-coordinator-auto-dispatch"
    && entry.value?.failure_class === "opening_coordinator_task_missing"
  ));
  const returned = toolResult?.details ?? null;
  check("queued opening without takeover stays non-terminal",
    rejection === undefined
    && returned?.ok === true
    && returned?.data?.status === "queued"
    && returned?.data?.source_work?.status === "queued"
    && audit?.value?.status === "deferred"
    && audit.value.source_status === "queued"
    && !Object.hasOwn(audit.value, "source_dependency_terminal")
    && harness.launches.length === 0
    && harness.calls.length === 3
    && harness.sent.length === 0);
  await harness.shutdown();
}

// A genuinely current opening needs no takeover and remains a legitimate
// terminal/current response.
{
  const task = coordinatorTask("coord-main-opening-current");
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult();
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapWithoutTakeover(task, "current");
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  const toolResult = await harness.registered.get("coc_invoke").execute(
    "invoke-opening-current",
    {
      operation: "progressive.opening_bootstrap",
      campaign: "auto-dispatch-fixture",
      arguments: {
        start_location: { location_id: "location:opening", title: "Opening" },
        opening_pdf_indices: [0],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const envelope = JSON.parse(toolResult.content[0].text);
  check("current opening without takeover remains legitimate",
    envelope.ok === true
    && envelope.data.status === "current"
    && envelope.data.source_work.status === "current"
    && harness.launches.length === 0
    && harness.calls.length === 3
    && harness.sent.length === 0);
  await harness.shutdown();
}

// A malformed blocking takeover is canonical corruption. Reject it without
// manufacturing false source-terminal evidence.
{
  const task = coordinatorTask("coord-main-opening-invalid");
  delete task.packet.packet_id;
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "scenario.bind_pdf"
    ) return boundOpeningSetupResult();
    if (params.operation === "progressive.prepare_opening") {
      return preparedOpeningSetupResult();
    }
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await armOpeningBootstrapRoute(harness);
  let rejection;
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-opening-invalid",
      {
        operation: "progressive.opening_bootstrap",
        campaign: "auto-dispatch-fixture",
        arguments: {
          start_location: { location_id: "location:opening", title: "Opening" },
          opening_pdf_indices: [0],
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    rejection = error;
  }
  const audit = harness.appended.find((entry) => (
    entry.name === "coc-source-coordinator-auto-dispatch"
    && entry.value?.failure_class === "coordinator_task_invalid"
  ));
  check("invalid opening takeover is rejected before provider continuation",
    rejection instanceof Error
    && rejection.message.includes("malformed coordinator task")
    && audit?.value?.status === "contract_violation"
    && !Object.hasOwn(audit.value, "source_dependency_terminal")
    && harness.launches.length === 0
    && harness.calls.length === 3
    && harness.sent.length === 0);
  await harness.shutdown();
}


// Reviewed facts survive true extension/session re-instantiation. Each
// harness owns a distinct extension closure; only canonical pending/consumed
// campaign state is shared between contexts.
{
  const campaignId = "facts-restart-campaign";
  const scenarioId = "facts-restart-scenario";
  const refs = [{ source_id: "pdf:facts-restart", pdf_index: 0 }];
  const source = (value) => ({ status: "source", value, source_refs: refs });
  const unresolved = { status: "unresolved", inspected_source_refs: refs };
  const facts = {
    schema_version: 1,
    contract_id: "coc.opening-fast-facts.v1",
    era: source("1920s"),
    place: source("Boston"),
    investigator_hook: unresolved,
    investigator_constraints: unresolved,
    player_safe_summary: unresolved,
    content_flags: source(["haunting"]),
  };
  const reviewGate = {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_source_review_required",
    campaign_id: campaignId,
    scenario_id: scenarioId,
    source_provenance: "selection_hint_only_not_provenance",
    required_source_owner: "coc-opening-source-coordinator",
    opening_review_generation: 7,
    character_setup_complete: false,
    next_operation: null,
    instruction: "review current source",
  };
  const temp = mkdtempSync(path.join(tmpdir(), "pi-facts-restart-"));
  const producer = path.join(temp, "producer.mjs");
  writeFileSync(producer, `#!/usr/bin/env node
let input = ""; for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-opening-source-review-transport-result.v1",
  status: "reviewed",
  campaign_id: task.campaign_id,
  scenario_id: task.scenario_id,
  opening_review_generation: task.opening_review_generation + 1,
  failure_class: null,
  facts: ${JSON.stringify(facts)},
}));
`);
  chmodSync(producer, 0o755);
  const previousCommand = process.env.COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND;
  process.env.COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND = producer;
  let pending = false;

  const contextA = mainExtensionHarness((name, params) => {
    if (name === "coc_invoke" && params.operation === "session.resume") {
      return {
        ok: false,
        tool: "session.resume",
        error: { code: "opening_setup_incomplete", details: reviewGate },
      };
    }
    throw new Error(`unexpected context A call ${name}:${params.operation}`);
  }, { sessionId: "facts-context-a", coordinatorEnabled: async () => false });
  await contextA.startAll();
  await contextA.registered.get("coc_invoke").execute(
    "facts-a-resume",
    { operation: "session.resume", campaign: campaignId, arguments: {} },
    undefined, undefined, contextA.ctx,
  );
  for (let index = 0; index < 20; index += 1) {
    if (contextA.sent.some((entry) => (
      entry.message?.customType === "coc-opening-source-review-terminal"
    ))) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const originalCards = contextA.sent.filter((entry) => (
    entry.message?.customType === "coc-opening-source-review-terminal"
    && entry.message?.details?.status === "reviewed"
  ));
  check("context A completes review and sends original exact facts card once",
    originalCards.length === 1
    && originalCards[0].message.details.next_operation.invoke_via
      === "coc_setup_adopt_source_facts"
    && JSON.stringify(
      originalCards[0].message.details.next_operation.arguments,
    ) === JSON.stringify({ campaign_id: campaignId })
    && !JSON.stringify(originalCards[0]).includes("Fixture summary"));
  pending = originalCards.length === 1;
  await contextA.shutdown();

  const factsGate = (packet = facts) => ({
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_source_facts_adoption_required",
    campaign_id: campaignId,
    scenario_id: scenarioId,
    opening_review_generation: 8,
    next_operation: {
      operation: "setup.adopt_source_facts",
      invoke_via: "coc_invoke",
      campaign: campaignId,
      arguments: { campaign_id: campaignId, facts: packet },
    },
    instruction: "adopt exact sealed facts before opening selection",
  });
  const throwResumeGate = (details) => {
    const envelope = {
      ok: false,
      tool: "session.resume",
      error: { code: "opening_setup_incomplete", details },
    };
    throw new runtime.CanonicalToolError(
      "coc_invoke", "opening_setup_incomplete",
      "canonical session.resume opening setup gate",
      details, envelope,
    );
  };
  const contextB = mainExtensionHarness((name, params) => {
    if (name === "coc_invoke" && params.operation === "session.resume") {
      return pending
        ? throwResumeGate(factsGate())
        : { ok: true, tool: "session.resume", data: {
          schema_version: 1, campaign_id: campaignId, mode: "awaiting_player",
        } };
    }
    if (name === "coc_invoke" && params.operation === "setup.adopt_source_facts") {
      pending = false;
      return {
        ok: true,
        tool: "setup.adopt_source_facts",
        data: {
          schema_version: 1,
          status: "PASS",
          kind: "campaign.adopt_source_facts",
          result: {
            campaign_id: campaignId,
            facts,
            unresolved_blocking_facts: [],
            character_creation_unblocked: true,
          },
        },
      };
    }
    throw new Error(`unexpected context B call ${name}:${params.operation}`);
  }, {
    startupCampaignId: campaignId,
    sessionId: "facts-context-b",
    coordinatorEnabled: async () => false,
  });
  await contextB.startAll();
  const resumeBResult = await contextB.registered.get("coc_invoke").execute(
    "facts-b-resume",
    { operation: "session.resume", root, campaign: campaignId, arguments: {} },
    undefined, undefined, contextB.ctx,
  );
  const resumeBEnvelope = JSON.parse(resumeBResult.content[0].text);
  const resumeBText = JSON.stringify(resumeBEnvelope);
  check("fresh context B receives one exact recovered facts card only in resume",
    JSON.stringify(resumeBEnvelope.error?.details?.next_operation)
      === JSON.stringify(factsGate().next_operation)
    && resumeBText.split("setup.adopt_source_facts").length - 1 === 1
    && contextB.sent.every((entry) => (
      entry.message?.customType !== "coc-opening-source-review-terminal"
    )));
  check("fresh context B does not call prepare before facts adoption",
    contextB.calls.every((call) => (
      call.params.operation !== "progressive.prepare_opening"
    )));
  await contextB.registered.get("coc_invoke").execute(
    "facts-b-adopt", factsGate().next_operation,
    undefined, undefined, contextB.ctx,
  );
  check("public exact adoption consumes pending canonical state", !pending);
  await contextB.shutdown();

  const contextC = mainExtensionHarness((name, params) => {
    if (name === "coc_invoke" && params.operation === "session.resume") {
      return throwResumeGate(openingSetupGate(undefined, campaignId));
    }
    throw new Error(`unexpected context C call ${name}:${params.operation}`);
  }, {
    startupCampaignId: campaignId,
    sessionId: "facts-context-c",
    coordinatorEnabled: async () => false,
  });
  await contextC.startAll();
  await contextC.registered.get("coc_invoke").execute(
    "facts-c-resume",
    { operation: "session.resume", root, campaign: campaignId, arguments: {} },
    undefined, undefined, contextC.ctx,
  );
  check("fresh context C after adoption gets no facts replay",
    contextC.sent.every((entry) => (
      entry.message?.customType !== "coc-opening-source-review-terminal"
    ))
    && contextC.calls.every((call) => (
      call.params.operation !== "progressive.prepare_opening"
    )));
  await contextC.shutdown();

  const tampered = structuredClone(facts);
  tampered.player_safe_summary = {
    ...tampered.player_safe_summary,
    raw_excerpt: "SECRET_RAW_PAGE_TEXT",
  };
  const contextD = mainExtensionHarness((name, params) => {
    if (name === "coc_invoke" && params.operation === "session.resume") {
      return throwResumeGate(factsGate(tampered));
    }
    throw new Error(`unexpected context D call ${name}:${params.operation}`);
  }, {
    startupCampaignId: campaignId,
    sessionId: "facts-context-d",
    coordinatorEnabled: async () => false,
  });
  await contextD.startAll();
  await contextD.registered.get("coc_invoke").execute(
    "facts-d-resume",
    { operation: "session.resume", root, campaign: campaignId, arguments: {} },
    undefined, undefined, contextD.ctx,
  );
  check("tampered fresh-session record never replays or leaks raw source",
    contextD.sent.every((entry) => (
      entry.message?.customType !== "coc-opening-source-review-terminal"
    ))
    && !JSON.stringify(contextD.sent).includes("SECRET_RAW_PAGE_TEXT"));
  await contextD.shutdown();

  // Direct (no startup gate env) resume recovery: after a daemon crash/
  // restart the KP calls session.resume by itself; the canonical
  // opening_setup_incomplete error must rebuild the extension in-memory route
  // state from the persisted gate, not throw and leave the campaign dead.
  {
    const directId = "direct-recovery-campaign";
    const directFactsGate = (packet = facts) => ({
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_facts_adoption_required",
      campaign_id: directId,
      scenario_id: scenarioId,
      opening_review_generation: 8,
      next_operation: {
        operation: "setup.adopt_source_facts",
        invoke_via: "coc_invoke",
        campaign: directId,
        arguments: { campaign_id: directId, facts: packet },
      },
      instruction: "adopt exact sealed facts before opening selection",
    });
    const directContext = mainExtensionHarness((name, params) => {
      if (name === "coc_invoke" && params.operation === "session.resume") {
        // The real MCP client passes one details object to both the error and
        // its envelope; the recovery projection requires that identity.
        const directGate = directFactsGate();
        throw new runtime.CanonicalToolError(
          "coc_invoke", "opening_setup_incomplete",
          "canonical session.resume opening setup gate",
          directGate,
          {
            ok: false,
            tool: "session.resume",
            error: {
              code: "opening_setup_incomplete",
              details: directGate,
            },
          },
        );
      }
      if (name === "coc_invoke" && params.operation === "setup.adopt_source_facts") {
        const args = (
          params.arguments
          && typeof params.arguments === "object"
          && !Array.isArray(params.arguments)
        ) ? params.arguments : {};
        return {
          ok: true,
          tool: "setup.adopt_source_facts",
          data: {
            schema_version: 1,
            status: "PASS",
            kind: "campaign.adopt_source_facts",
            result: {
              campaign_id: directId,
              facts: args.facts ?? facts,
              unresolved_blocking_facts: [],
              character_creation_unblocked: true,
            },
          },
        };
      }
      throw new Error(`unexpected direct call ${name}:${params.operation}`);
    }, {
      // No startupCampaignId: the startup resume gate is NOT armed; recovery
      // must still rebuild the route from the canonical error alone.
      sessionId: "direct-recovery-context",
      coordinatorEnabled: async () => false,
    });
    await directContext.startAll();
    const directResumeResult = await directContext.registered.get("coc_invoke").execute(
      "direct-resume",
      { operation: "session.resume", root, campaign: directId, arguments: {} },
      undefined, undefined, directContext.ctx,
    );
    const directEnvelope = JSON.parse(directResumeResult.content[0].text);
    check("direct resume error is returned as the canonical gate envelope",
      directEnvelope.ok === false
      && directEnvelope.tool === "session.resume"
      && directEnvelope.error?.code === "opening_setup_incomplete"
      && JSON.stringify(directEnvelope.error?.details?.next_operation)
        === JSON.stringify(directFactsGate().next_operation));
    let directOcrBlocked = false;
    try {
      await directContext.registered.get("coc_progressive_ocr").execute(
        "direct-ocr-detour",
        { operation: "status" },
        undefined, undefined, directContext.ctx,
      );
    } catch (error) {
      directOcrBlocked = String(error?.message ?? error).includes(
        "hard gate is active",
      );
    }
    check("direct resume arms the extension route state (OCR detour blocked)",
      directOcrBlocked);
    const adoptResult = await directContext.registered.get("coc_invoke").execute(
      "direct-adopt",
      {
        operation: "setup.adopt_source_facts",
        root,
        campaign: directId,
        arguments: directFactsGate().next_operation.arguments,
      },
      undefined, undefined, directContext.ctx,
    );
    const adoptEnvelope = JSON.parse(adoptResult.content[0].text);
    check("recovered adopt card executes through the rebuilt route",
      adoptEnvelope.ok === true
      && adoptEnvelope.data?.result?.character_creation_unblocked === true);
    check("direct recovery never replays the review terminal",
      directContext.sent.every((entry) => (
        entry.message?.customType !== "coc-opening-source-review-terminal"
      )));
    await directContext.shutdown();
  }

  // Non-resume hard-gate errors take the normal gateway exception path. They
  // have no canonical next_operation by design, but must still start the
  // private opening review exactly once; otherwise a real RPC KP can keep
  // retrying setup.adopt_source_facts forever while the pending review has no
  // host owner.
  {
    const errorCampaignId = "hard-gate-error-campaign";
    const errorGate = {
      ...reviewGate,
      campaign_id: errorCampaignId,
      character_setup_complete: true,
      // This is the persisted task's Codex-named contract label. The Pi
      // trigger must rely on the structured gate, not reject that label.
      coordinator_contract_id: "coc.codex-opening-source-task.v1",
    };
    const errorEnvelope = {
      ok: false,
      tool: "setup.adopt_source_facts",
      error: { code: "opening_setup_incomplete", details: errorGate },
    };
    const hardGateContext = mainExtensionHarness((name, params) => {
      if (
        name === "coc_invoke"
        && params.operation === "setup.adopt_source_facts"
      ) {
        throw new runtime.CanonicalToolError(
          "coc_invoke", "opening_setup_incomplete",
          "canonical opening source review gate",
          errorGate, errorEnvelope,
        );
      }
      throw new Error(`unexpected hard-gate call ${name}:${params.operation}`);
    }, {
      sessionId: "opening-review-hard-gate-error",
      coordinatorEnabled: async () => false,
    });
    await hardGateContext.startAll();
    for (const [index, invocationId] of ["hard-gate-error-a", "hard-gate-error-b"].entries()) {
      const executed = await hardGateContext.registered.get("coc_invoke").execute(
        invocationId,
        {
          operation: "setup.adopt_source_facts",
          root,
          campaign: errorCampaignId,
          arguments: { campaign_id: errorCampaignId, facts },
        },
        undefined, undefined, hardGateContext.ctx,
      );
      const envelope = JSON.parse(executed.content[0].text);
      check(
        `${invocationId} preserves the canonical hard gate`,
        envelope.ok === false
          && envelope.tool === "setup.adopt_source_facts"
          && envelope.error?.code === (
            index === 0
              ? "opening_setup_incomplete"
              : "nonretryable_repeat_blocked"
          ),
      );
    }
    for (let index = 0; index < 20; index += 1) {
      if (hardGateContext.sent.some((entry) => (
        entry.message?.customType === "coc-opening-source-review-terminal"
      ))) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const reviewTerminals = hardGateContext.sent.filter((entry) => (
      entry.message?.customType === "coc-opening-source-review-terminal"
    ));
    check("non-resume hard-gate auto-dispatches one review and releases exact adopt card",
      reviewTerminals.length === 1
      && reviewTerminals[0].message?.details?.status === "reviewed"
      && reviewTerminals[0].message?.details?.next_operation?.operation
        === "setup.adopt_source_facts"
      && reviewTerminals[0].message?.details?.next_operation?.invoke_via
        === "coc_setup_adopt_source_facts"
      && JSON.stringify(
        reviewTerminals[0].message?.details?.next_operation?.arguments,
      ) === JSON.stringify({ campaign_id: errorCampaignId })
      && !JSON.stringify(reviewTerminals[0]).includes("Fixture summary"));
    const reviewAudits = hardGateContext.appended.filter((entry) => (
      entry.name === "coc-opening-source-review-lifecycle"
      && entry.value?.dispatch_key
        === `opening-source-review:${errorCampaignId}:7`
    ));
    check("non-resume hard-gate review dispatch is deduplicated",
      reviewAudits.filter((entry) => entry.value?.status === "submitted").length === 1
      && reviewAudits.filter((entry) => entry.value?.status === "reviewed").length === 1);
    await hardGateContext.shutdown();
  }

  if (previousCommand === undefined) {
    delete process.env.COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND;
  } else {
    process.env.COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND = previousCommand;
  }
  rmSync(temp, { recursive: true, force: true });
}

// Actual extension lifecycle: a capability read that resolves after shutdown
// cannot recreate the manager or launch a child in the stale generation.
{
  const registered = new Map();
  const handlers = new Map();
  const appended = [];
  const activeTools = [];
  const clientCalls = [];
  let closeCalls = 0;
  let managerCreations = 0;
  let launches = 0;
  let resolveEnabled;
  const delayedEnabled = new Promise((resolve) => { resolveEnabled = resolve; });
  const fakePi = {
    registerTool: (tool) => registered.set(tool.name, tool),
    registerCommand: () => {},
    registerShortcut: () => {},
    on: (name, handler) => {
      const values = handlers.get(name) || [];
      values.push(handler);
      handlers.set(name, values);
    },
    appendEntry: (name, value) => appended.push({ name, value }),
    sendMessage: () => {},
    setActiveTools: (tools) => activeTools.push([...tools]),
    getThinkingLevel: () => "off",
  };
  const fakeClient = {
    callTool: async (name, params) => {
      clientCalls.push({ name, params });
      if (params?.operation === "session.resume") {
        return {
          ok: true,
          tool: "session.resume",
          data: {
            schema_version: 1,
            campaign_id: "fixture",
            mode: "awaiting_player",
          },
        };
      }
      return directTakeoverResult(coordinatorTask("coord-extension-race"));
    },
    callToolWithTransportMeta: async (name, params) => ({
      value: await fakeClient.callTool(name, params),
      transport: null,
    }),
    close: async () => { closeCalls += 1; },
  };
  const fakeManager = {
    state: () => undefined,
    submit: async () => {
      launches += 1;
      return { status: "submitted", dispatch_key: "coord-extension-race", role: "coordinator" };
    },
    shutdown: async () => {},
  };
  main.default(fakePi, {
    startupCampaignId: () => "fixture",
    coordinatorEnabled: () => delayedEnabled,
    createClient: () => fakeClient,
    createManager: () => {
      managerCreations += 1;
      return fakeManager;
    },
  });
  const ctx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "offline", id: "offline" },
    sessionManager: {
      getSessionId: () => "extension-race",
      getEntries: () => [],
    },
    hasUI: false,
  };
  const mainSessionStart = handlers.get("session_start").at(-1);
  const shutdown = handlers.get("session_shutdown").at(-1);
  await mainSessionStart({ reason: "startup" }, ctx);
  check("KP active tools hide manual source dispatch",
    activeTools.at(-1)?.includes("coc_dispatch_source_work") === false);
  await registered.get("coc_setup").execute(
    "extension-race-startup-resume",
    { operation: "session.resume", root, campaign: "fixture", arguments: {} },
    undefined,
    undefined,
    ctx,
  );
  await registered.get("coc_invoke").execute(
    "invoke-race",
    { operation: "scene.context", campaign: "fixture", arguments: {} },
    undefined,
    undefined,
    ctx,
  );
  const staleManualDispatch = registered.get("coc_dispatch_source_work").execute(
    "dispatch-race",
    { task: coordinatorTask("coord-extension-manual-race") },
    undefined,
    undefined,
    ctx,
  );
  await shutdown({ reason: "quit" }, ctx);
  resolveEnabled(true);
  const staleManualResult = JSON.parse((await staleManualDispatch).content[0].text);
  await nextTurn();
  await nextTurn();
  check("delayed capability cannot recreate manager after shutdown",
    managerCreations === 0 && launches === 0);
  check("delayed manual dispatch returns bounded session_closed receipt",
    staleManualResult.status === "session_closed"
    && staleManualResult.failure_class === "session_closed");
  check("stale generation has no child lifecycle notification",
    appended.filter((entry) => entry.name === "coc-source-coordinator-lifecycle").length === 0);
  check("stale generation records bounded session_closed audit",
    appended.some((entry) => (
      entry.name === "coc-source-coordinator-auto-dispatch"
      && entry.value.status === "session_closed"
      && entry.value.failure_class === "session_closed"
    )));
  check("shutdown closes the exact owned client once", closeCalls === 1);

  // A real new session receives a fresh generation and can create one manager.
  await mainSessionStart({ reason: "new" }, ctx);
  await registered.get("coc_setup").execute(
    "extension-new-session-startup-resume",
    { operation: "session.resume", root, campaign: "fixture", arguments: {} },
    undefined,
    undefined,
    ctx,
  );
  await registered.get("coc_invoke").execute(
    "invoke-new-session",
    { operation: "scene.context", campaign: "fixture", arguments: {} },
    undefined,
    undefined,
    ctx,
  );
  await nextTurn();
  check("fresh session generation can dispatch", managerCreations === 1 && launches === 1);

  const callsBeforePrivate = clientCalls.length;
  let privateRejected = false;
  try {
    await registered.get("coc_invoke").execute(
      "invoke-private",
      {
        operation: "progressive.release_host_work_leases",
        campaign: "fixture",
        arguments: {
          asset_root_id: "asset-fixture",
          executor_id: "pi:test",
          lease_ids: ["lease-private"],
          reason: "forbidden-main-kp-call",
        },
      },
      undefined,
      undefined,
      ctx,
    );
  } catch { privateRejected = true; }
  check("main KP cannot invoke private lease lifecycle operations",
    privateRejected && clientCalls.length === callsBeforePrivate);
  await shutdown({ reason: "quit" }, ctx);
  check("main extension activated expected tool surface",
    activeTools.length >= 4
    && !activeTools.at(-1).includes("coc_setup"));
}

await exerciseFailureDrain("activation");
await exerciseFailureDrain("process");
await exerciseFailureDrain("framing");

// Shutdown terminalizes active and pending ownership; late completion cannot drain.
{
  const queue = realManagerHarness();
  const taskA = coordinatorTask("coord-shutdown-a");
  const taskB = coordinatorTask("coord-shutdown-b");
  await autoDispatchCoordinator(queue.deps, "coc_invoke", directTakeoverResult(taskA));
  await autoDispatchCoordinator(queue.deps, "coc_invoke", sceneContextResult(taskB));
  await queue.manager.shutdown();
  check("shutdown clears bounded ownership", queue.manager.activeCount() === 0
    && queue.manager.pendingCount() === 0
    && queue.controls.get("coord-shutdown-a").terminated);
  queue.controls.get("coord-shutdown-a").resolve();
  await nextTurn();
  check("shutdown forbids late pending launch", queue.launches.join(",") === "coord-shutdown-a");
  check("shutdown lifecycle stays exactly once per owned key", queue.lifecycle.length === 2
    && new Set(queue.lifecycle.map((entry) => entry.dispatch_key)).size === 2
    && queue.lifecycle.every((entry) => entry.failure_class === "coordinator_shutdown"));
}

// Submit failure is swallowed and recorded, never thrown. The observability
// audit (submit_failed_detail) precedes the bounded failure entry.
{
  const task = coordinatorTask();
  const { deps, audit } = harness({ failSubmit: true });
  await autoDispatchCoordinator(deps, "coc_invoke", directTakeoverResult(task));
  const bounded = audit.filter((entry) => entry.status === "submit_failed");
  const detail = audit.filter((entry) => entry.status === "submit_failed_detail");
  check("submit failure swallowed", bounded.length === 1 && bounded[0].dispatch_key === task.packet.packet_id);
  check("submit failure detail recorded", detail.length === 1 && detail[0].dispatch_key === task.packet.packet_id && typeof detail[0].detail === "string");
  check("submit failure is bounded", !Object.hasOwn(bounded[0], "error"));
}

// Validation failure is recorded without a submit.
{
  const bad = coordinatorTask("coord-invalid");
  bad.instruction_ref = path.join(root, "plugins/coc-keeper/agents/coc-source-pack-worker.md");
  const { deps, audit, submits } = harness();
  await autoDispatchCoordinator(deps, "coc_invoke", directTakeoverResult(bad));
  check("invalid task recorded", submits.length === 0 && audit.length === 1 && audit[0].status === "validation_failed");
  check("validation audit is bounded", !Object.hasOwn(audit[0], "error"));
}

// Workspace drift and missing model context never reach submit.
{
  const drifted = coordinatorTask("coord-drift");
  drifted.packet.workspace_root = path.join(root, "elsewhere");
  const { deps, audit, submits } = harness();
  await autoDispatchCoordinator(deps, "coc_invoke", directTakeoverResult(drifted));
  check("workspace drift recorded", submits.length === 0 && audit.length === 1 && audit[0].status === "workspace_drift");
  const noModel = harness();
  noModel.deps.launchContext = () => null;
  await autoDispatchCoordinator(noModel.deps, "coc_invoke", directTakeoverResult(coordinatorTask("coord-nomodel")));
  check("missing model is bounded diagnostic", noModel.submits.length === 0
    && noModel.audit.length === 1
    && noModel.audit[0].status === "launch_context_unavailable"
    && !Object.hasOwn(noModel.audit[0], "error"));
}

// Capability read failures are bounded and never include provider text.
{
  const { deps, audit, submits } = harness();
  deps.enabled = async () => { throw new Error("raw provider secret"); };
  await autoDispatchCoordinator(deps, "coc_invoke", directTakeoverResult(coordinatorTask("coord-capability-error")));
  check("capability error blocks dispatch", submits.length === 0);
  check("capability error is bounded", audit.length === 1
    && audit[0].status === "capability_check_failed"
    && !JSON.stringify(audit[0]).includes("raw provider secret"));
}

{
  // A null submission means the manager already owns the dispatch key, not
  // that the coordinator capability is off. The live vfy2 opening reported
  // coordinator_capability_unavailable on every retry while
  // piCoordinatorEnabled() was true, hiding the real leaf_result_invalid /
  // claim_wire_projection_failed terminal underneath.
  const { coordinatorDispatchNullReason } = main.__test;
  const unknownKey = coordinatorDispatchNullReason(undefined, "coord-key-1");
  check("an unknown dispatch key is still a capability question",
    unknownKey.failure_class === "coordinator_capability_unavailable"
    && unknownKey.dispatch_key === "coord-key-1");

  const inFlight = coordinatorDispatchNullReason(
    { status: "running" },
    "coord-key-2",
  );
  check("an owned in-flight key is not reported as capability unavailable",
    inFlight.failure_class === "coordinator_dispatch_already_active"
    && inFlight.coordinator_status === "running");

  // Exactly the terminal receipt the live vfy2 run produced.
  const terminal = coordinatorDispatchNullReason(
    {
      status: "completed",
      terminal_receipt: {
        packet_id: "coord-key-3",
        status: "failed",
        failure_class: "leaf_result_invalid",
        diagnostics: [
          { phase: "claim_projection", code: "claim_wire_projection_failed" },
          { phase: "claim_projection", code: "claim_wire_projection_failed" },
        ],
      },
    },
    "coord-key-3",
  );
  check("a terminal dispatch reports its real failure class and diagnostics",
    terminal.failure_class === "leaf_result_invalid"
    && terminal.coordinator_status === "failed"
    && Array.isArray(terminal.diagnostic_codes)
    && terminal.diagnostic_codes.length === 1
    && terminal.diagnostic_codes[0] === "claim_wire_projection_failed"
    && terminal.failure_class !== "coordinator_capability_unavailable");
}

rmSync(extensionWelcomeAgentDir, { recursive: true, force: true });
if (problems.length) {
  console.error(`auto-dispatch smoke FAILED: ${problems.join("; ")}`);
  process.exit(1);
}
console.log("auto-dispatch smoke OK");
