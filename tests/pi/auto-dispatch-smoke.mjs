// Smoke: the Pi main-session gateway auto-drives coordinator dispatch.
// findAutoDispatchTask extracts only the canonical coc_invoke projection path,
// and autoDispatchCoordinator submits it through the shared manager path
// without ever throwing back into the KP's tool result.
import "./_lib/preload-embedded-pi.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const extensionWelcomeAgentDir = mkdtempSync(
  path.join(tmpdir(), "pi-coc-extension-welcome-"),
);
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));
const { findAutoDispatchTask, autoDispatchCoordinator } = main.__test;
const instruction = path.join(root, "plugins/coc-keeper/agents/coc-source-coordinator.md");
const problems = [];
const safeCharacterSetupPrompt = (
  "请继续确认调查员的职业、特征与技能；调查员正式加入战役后再开始场景。"
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

function currentDependencyFixture(packetId, {
  campaignId = "auto-dispatch-fixture",
  jobId = `job-${packetId}`,
  decisionId = "current-arrival-details",
  targetId = "later-location",
  operationalClass = "runnable",
} = {}) {
  const dependencyRef = {
    operation: "turn.finalize",
    subject: { kind: "location", id: targetId },
    decision_id: decisionId,
  };
  const assetRootId = "asset-auto";
  const dependencyId = `source-dependency-${createHash("sha256").update(
    JSON.stringify({
      asset_root_id: assetRootId,
      campaign_id: campaignId,
      dependency_ref: {
        decision_id: decisionId,
        operation: "turn.finalize",
        subject: { id: targetId, kind: "location" },
      },
    }),
  ).digest("hex").slice(0, 20)}`;
  const binding = {
    campaign_id: campaignId,
    dependency_id: dependencyId,
    job_id: jobId,
    dependency_ref: dependencyRef,
  };
  const task = coordinatorTask(packetId, {
    campaignId,
    assetRootId,
    executorId: `source-current-dependency:${dependencyId}`,
  });
  task.packet.max_leaves = 1;
  task.packet.claim_operation.prefilled_arguments.limit = 1;
  task.packet.claim_operation.prefilled_arguments.current_dependency_claim = (
    binding
  );
  const wait = {
    schema_version: 1,
    contract_id: "coc.source-current-dependency-wait.v1",
    ...binding,
    work_group_id: jobId,
    operational_class: operationalClass,
    dispatch_attempts: 0,
  };
  const dispatch = {
    ...wait,
    next_host_action: {
      schema_version: 1,
      action: "invoke_coc_dispatch_source_work",
      task,
      parent_waits: false,
      parent_result_polls: 0,
      parent_output_retrieval: false,
    },
  };
  return { task, wait, dispatch };
}

function currentDependencyResult(fixtures, ordinaryTask = null) {
  const values = Array.isArray(fixtures) ? fixtures : [fixtures];
  const campaignId = values[0]?.wait.campaign_id
    ?? ordinaryTask?.packet?.campaign_id
    ?? "auto-dispatch-fixture";
  const data = {
    host_work: {
      campaign_id: campaignId,
      current_dependency_snapshot_complete: true,
      ...(values.length === 1 ? {
        current_dependency_snapshot_scope: {
          schema_version: 1,
          contract_id: "coc.source-current-dependency-snapshot-scope.v1",
          kind: "exact_dependency_ref",
          campaign_id: campaignId,
          dependency_ref: values[0].wait.dependency_ref,
        },
      } : {}),
      current_dependency_waits: values.map((value) => value.wait),
      current_dependency_dispatches: values
        .filter((value) => value.wait.operational_class === "runnable")
        .map((value) => value.dispatch),
    },
  };
  if (ordinaryTask !== null) data.background_takeover = takeover(ordinaryTask);
  return {
    ok: true,
    tool: "progressive.request_deepen",
    data,
  };
}

function blockedCurrentDependencyWireResult(fixture) {
  const raw = currentDependencyResult(fixture);
  raw.data = {
    ...raw.data,
    asset_root_id: "asset-auto",
    kind: "location",
    target_id: fixture.wait.dependency_ref.subject.id,
    current_dependency: true,
    dependency_ref: fixture.wait.dependency_ref,
  };
  raw.data.host_work.current_dependency_dispatches[0]
    .next_host_action.task.packet.oversized_exact_control = "x".repeat(20_000);
  const script = [
    "import importlib.util, json, sys",
    "spec = importlib.util.spec_from_file_location('wire', sys.argv[1])",
    "wire = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(wire)",
    "value = json.load(sys.stdin)",
    "print(json.dumps(wire.project_envelope(",
    "  'progressive.request_deepen', value,",
    "  contract_digest='a' * 64, argument_schemas={},",
    ")))",
  ].join("\n");
  const projected = spawnSync(
    "uv",
    [
      "run",
      "--frozen",
      "python",
      "-c",
      script,
      path.join(
        root,
        "plugins/coc-keeper/scripts/coc_mcp_wire.py",
      ),
    ],
    {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(raw),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  if (projected.status !== 0) {
    throw new Error(`blocked wire projection failed: ${projected.stderr}`);
  }
  return JSON.parse(projected.stdout);
}

function invokeCurrentDependency(
  harness,
  invocationId,
  campaignId = "auto-dispatch-fixture",
) {
  return harness.registered.get("coc_invoke").execute(
    invocationId,
    {
      operation: "progressive.request_deepen",
      campaign: campaignId,
      arguments: {
        kind: "location",
        target_id: "later-location",
        current_dependency: {
          operation: "turn.finalize",
          decision_id: "current-arrival-details",
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
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
      start_location: { location_id: "opening", title: "Opening" },
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

function coordinatorEventsForReceipt(receipt) {
  const packetId = receipt.packet_id;
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
  const manager = new runtime.CoordinatorDispatchManager(
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
      return responseForCall(name, params);
    },
    close: async () => {},
  };
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
  for (const campaign of [undefined, 7]) {
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
  check("hostile setup shapes are rejected before MCP without consuming route",
    fakeTopLevelRejected
    && malformedRouteCampaignsRejected === 2
    && harness.calls.length === callsAfterBind
    && retainedAfterMalformed?.message.includes(
      '"operation":"progressive.prepare_opening"',
    ));
  let discoverError;
  let ocrError;
  let sceneError;
  let nonCreationDiceError;
  try {
    await harness.registered.get("coc_discover").execute(
      "discover-during-opening-gate",
      {},
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { discoverError = error; }
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
          decision_id: "not-creation-dice",
          reason: "ordinary random event",
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { nonCreationDiceError = error; }
  check("pre-bootstrap host gate blocks discover OCR and play detours",
    discoverError instanceof Error
    && ocrError instanceof Error
    && sceneError instanceof Error
    && nonCreationDiceError instanceof Error
    && discoverError.message.includes('"operation":"progressive.prepare_opening"')
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
    "invoke-prepare-retained-route",
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
        start_location: { location_id: "opening", title: "Opening" },
        opening_pdf_indices: [0],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );

  const callsBeforeLuckNearMiss = harness.calls.length;
  let luckNearMiss;
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-quick-fire-luck-near-miss",
      {
        operation: "rules.roll_dice",
        campaign: "auto-dispatch-fixture",
        arguments: {
          expression: "3D6",
          decision_id: "quick-fire-luck-during-opening",
          reason: "Quick Fire Luck 3D6 total",
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { luckNearMiss = error; }
  check("Quick-Fire Luck near miss returns exact retained recipe before MCP",
    luckNearMiss instanceof Error
    && luckNearMiss.message.includes(
      '"decision_id":"quick-fire-luck-during-opening"',
    )
    && luckNearMiss.message.includes(
      '"reason":"Quick-Fire investigator Luck"',
    )
    && luckNearMiss.message.includes(
      '"purpose":"investigator_creation_luck"',
    )
    && harness.calls.length === callsBeforeLuckNearMiss);

  await harness.registered.get("coc_invoke").execute(
    "invoke-quick-fire-luck-during-opening",
    {
      operation: "rules.roll_dice",
      campaign: "auto-dispatch-fixture",
      arguments: {
        expression: "3D6",
        decision_id: "quick-fire-luck-during-opening",
        purpose: "investigator_creation_luck",
        reason: "Quick-Fire investigator Luck",
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const luckPrompt = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "幸运骰结果为 12，幸运值为 60。" }],
  });
  check("exact Quick-Fire Luck recipe has setup output provenance",
    luckPrompt.content.some((part) => (
      part.type === "text" && part.text === "幸运骰结果为 12，幸运值为 60。"
    )));

  await harness.registered.get("coc_invoke").execute(
    "invoke-character-contract-during-opening",
    {
      operation: "setup.investigator_contract",
      campaign: "auto-dispatch-fixture",
      arguments: { campaign_id: "auto-dispatch-fixture" },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const characterPrompt = await harness.emit("message_end", {
    role: "assistant",
    content: [{
      type: "text",
      text: "请选择调查员的特征值生成方式。",
    }],
  });
  check("structured character setup provenance permits its player prompt",
    characterPrompt.content.some((part) => (
      part.type === "text"
      && part.text === "请选择调查员的特征值生成方式，并继续确认职业与技能。"
    )));

  const canonicalSetupCalls = [
    {
      kind: "investigator.create",
      payload: {
        campaign_id: "auto-dispatch-fixture",
        investigator_id: "route-investigator",
        sheet: { id: "route-investigator", name: "Route Investigator" },
        creation: {
          input_mode: "guided_quick_fire",
          method: "quick_fire_array",
          characteristic_assignment_order: [
            "DEX", "INT", "POW", "EDU",
            "CON", "SIZ", "APP", "STR",
          ],
          luck_roll_total: 12,
          luck_roll_receipt: {
            campaign_id: "auto-dispatch-fixture",
            decision_id: "quick-fire-luck-during-opening",
            roll_id: "toolbox-auto-dispatch-fixture-000001",
          },
        },
      },
    },
    {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: "auto-dispatch-fixture",
        investigator_ids: ["route-investigator"],
      },
    },
  ];
  for (const setup of canonicalSetupCalls) {
    await harness.registered.get("coc_invoke").execute(
      `invoke-real-${setup.kind}`,
      {
        operation: "setup.invoke",
        campaign: "auto-dispatch-fixture",
        arguments: setup,
      },
      undefined,
      undefined,
      harness.ctx,
    );
    const setupPrompt = await harness.emit("message_end", {
      role: "assistant",
      content: [{
        type: "text",
        text: `setup-visible:${setup.kind}`,
      }],
    });
    check(`real ${setup.kind} reaches MCP and owns setup output`,
      setupPrompt.content.some((part) => (
        part.type === "text"
        && part.text === (
          setup.kind === "campaign.link_investigator"
            ? "调查员已正式加入战役。"
            : "调查员资料已创建；请确认后加入战役。"
        )
      )));
  }
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
  const openingResult = await harness.registered.get("coc_invoke").execute(
    "invoke-source-table-opening",
    {
      operation: "evidence.table_opening",
      campaign: "auto-dispatch-fixture",
      arguments: {
        text: "[in_game]\n来源约束下的准确开场。\n[/in_game]",
        run_id: "source-opening-run",
        presented_roll_ids: [],
        decision_id: "source-opening-evidence",
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const exactOpening = JSON.parse(openingResult.content[0].text).data.text;
  const replacedOpening = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "圣诞季刚过约两周。" }],
  });
  check("source opening rejects ordinary finalization and delivers table evidence exactly",
    wrongOpeningFinalizationRejected
    && replacedOpening.content.some((part) => (
      part.type === "text" && part.text === exactOpening
    ))
    && exactOpening.includes("圣诞季约两周后")
    && !exactOpening.includes("圣诞季刚过"));
  await harness.registered.get("coc_invoke").execute(
    "invoke-post-opening-render",
    {
      operation: "setup.invoke",
      campaign: "auto-dispatch-fixture",
      arguments: {
        kind: "investigator.render_card",
        payload: {
          campaign_id: "auto-dispatch-fixture",
          investigator_id: "route-investigator",
          language: "zh-Hans",
          html_mode: "never",
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const afterCurrent = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "来源开场已物化。" }],
  });
  check("post-opening tool-free chatter stays suppressed after exact evidence",
    afterCurrent.content.every((part) => part.type !== "text"));
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
        start_location: { location_id: "opening", title: "Opening" },
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
  const linkPending = harness.registered.get("coc_invoke").execute(
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
    undefined,
    undefined,
    harness.ctx,
  );
  linked.resolve(canonicalLinkSetupResult(
    "auto-dispatch-fixture",
    ["monotonic-investigator"],
  ));
  await linkPending;
  check("current source remains gated until exact link receipt",
    linkBeforeBootstrapRejected
    && current.ok === true
    && current.data.status === "current");
  await harness.shutdown();
}

// A safe campaign-bound probe may discover an already persisted opening
// selection. Pi must hydrate that canonical route instead of discarding the
// result and suggesting an impossible source rebind/OCR detour.
{
  const gate = new main.OpeningTerminalContinuationGate();
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

  const wrongToolGate = new main.OpeningTerminalContinuationGate();
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
    && tableOpen?.message?.content.includes(
      `"campaign":"${campaignId}"`,
    )
    && !tableOpen?.message?.content.includes(
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
    await harness.registered.get("coc_discover").execute(
      "startup-discover",
      {},
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    discoverRejected = String(error).includes("session.resume");
  }
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
    && forcedResume?.message?.content.includes(
      `"campaign":"${campaignId}"`,
    )
    && forcedResume?.message?.content.includes(
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
  }, { startupCampaignId: campaignId });
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
      === "session.resume,scene.context");
  await harness.shutdown();
}

// Terminal startup failures never become hidden retry loops. The host emits
// one fixed blocker, keeps every campaign/source route closed, and never
// exposes backend/provider text or triggers another model turn.
for (const terminalCase of [
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
  }, { startupCampaignId: campaignId });
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
    await harness.registered.get("coc_discover").execute(
      "startup-blocker-retry-discover",
      {},
      undefined,
      undefined,
      harness.ctx,
    );
  } catch {
    blockedAfterFailedSend = true;
  }
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
    "Follow coc-main now: call setup.inspect (and session.resume if a campaign is already in play),",
    "greet in zh-Hans, and offer continue / built-in starter quick_start / create investigator.",
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
  const gate = new main.OpeningTerminalContinuationGate();
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
  check("current opening stays character-gated only for its campaign",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "campaign-a",
      arguments: {},
    }, "campaign-local-after-current-a")?.includes(
      '"phase":"opening_current_character_setup_required"',
    )
    && gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "campaign-b",
      arguments: {},
    }, "campaign-local-after-current-b")?.includes(
      '"operation":"progressive.prepare_opening"',
    ));
}

// A bootstrap that is already current satisfies only the source predicate.
// The gate remains active until one exact canonical link receipt is shown.
{
  const gate = new main.OpeningTerminalContinuationGate();
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
  check("immediate current keeps live tools gated before link",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "current-before-link",
      arguments: {},
    }, "current-before-link-scene")?.includes(
      '"phase":"opening_current_character_setup_required"',
    )
    && replacementIs(
      gate.acceptVisibleAssistantFinal(
        "公元1135年的冬夜，你已经站在舍伯恩修道院门前。",
      ),
      safeCharacterSetupPrompt,
    ));
  gate.markAgentStart();
  const linkParams = {
    operation: "setup.invoke",
    campaign: "current-before-link",
    arguments: {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: "current-before-link",
        investigator_ids: ["current-before-link-investigator"],
      },
    },
  };
  const linked = observeOwnedOpeningInvocation(
    gate,
    "current-before-link-link",
    linkParams,
    canonicalLinkSetupResult(
      "current-before-link",
      ["current-before-link-investigator"],
    ),
  );
  check("exact link receipt is visible before retained table-opening evidence",
    linked === undefined
    && replacementIs(
      gate.acceptVisibleAssistantFinal("模型自拟的链接说明。"),
      "调查员已正式加入战役。",
    )
    && gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "current-before-link",
      arguments: {},
    }, "current-before-link-still-gated")?.includes(
      '"operation":"evidence.table_opening"',
    ));
}

// Terminal fulfillment before link is append-only. Projection remains
// retained, malformed ok:true link receipts cannot complete setup, and the
// exact current link exposes one projection route.
{
  const gate = new main.OpeningTerminalContinuationGate();
  const campaignId = "submitting-character-overlap";
  bindOpeningRoute(gate, campaignId, "submitting-overlap-bind");
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
      decision_id: "submitting-overlap-luck",
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
            decision_id: "submitting-overlap-luck",
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
  const gate = new main.OpeningTerminalContinuationGate();
  const { task } = beginBackgroundOpeningRoute(
    gate,
    "terminal-before-link",
    "terminal-before-link",
  );
  gate.markAgentStart();
  gate.observeOpeningCoordinatorTerminal({
    packet_id: task.packet.packet_id,
    status: "fulfilled",
  });
  const projectionParams = {
    operation: "progressive.project_opening",
    campaign: "terminal-before-link",
    arguments: {
      asset_root_id: task.packet.asset_root_id,
      source_file_sha256: "a".repeat(64),
      start_location_id: "opening",
      opening_pdf_indices: [0],
    },
  };
  const prematureOpening = (
    "公元1135年的冬夜，你抵达舍伯恩；石墙外积雪齐踝，"
    + "远处修道院的钟声正报出午夜。"
  );
  check("terminal before link suppresses arbitrary era time place prose",
    gate.decideWake(task.packet.packet_id) === false
    && gate.openingSetupToolError(
      "coc_invoke",
      projectionParams,
      "terminal-before-link-project",
    )?.includes("campaign.link_investigator")
    && replacementIs(
      gate.acceptVisibleAssistantFinal(prematureOpening),
      safeCharacterSetupPrompt,
    ));
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
  check("fulfilled terminal keeps projection private during character setup",
    incompleteCreateError?.includes("campaign.link_investigator")
    && !incompleteCreateError.includes("progressive.project_opening")
    && gate.requiredOpeningSetupContinuation() === null
    && replacementIs(
      gate.acceptVisibleAssistantFinal(prematureOpening),
      safeCharacterSetupPrompt,
    ));
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
  check("canonical player-safe briefing remains admitted after terminal",
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
    && replacementIs(
      gate.acceptVisibleAssistantFinal(prematureOpening),
      safeCharacterSetupPrompt,
    ));
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
            decision_id: "terminal-before-link-luck",
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
  check("canonical create remains admitted after fulfilled terminal",
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
  const route = gate.requiredOpeningSetupContinuation();
  check("terminal-before-link releases one exact projection route after link",
    route?.next_operation?.operation === "progressive.project_opening");
}

// If no agent turn owns the fulfilled terminal after link, the terminal wake
// claims the same release token and carries the exact route itself. A failed
// projection restores the original bootstrap retry card.
{
  const gate = new main.OpeningTerminalContinuationGate();
  const { task } = beginBackgroundOpeningRoute(
    gate,
    "terminal-release-owner",
    "terminal-release-owner",
  );
  const linkParams = {
    operation: "setup.invoke",
    campaign: "terminal-release-owner",
    arguments: {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: "terminal-release-owner",
        investigator_ids: ["terminal-release-owner-investigator"],
      },
    },
  };
  gate.markAgentStart();
  observeOwnedOpeningInvocation(
    gate,
    "terminal-release-owner-link",
    linkParams,
    canonicalLinkSetupResult(
      "terminal-release-owner",
      ["terminal-release-owner-investigator"],
    ),
  );
  check("terminal-owner link receipt remains visible",
    replacementIs(
      gate.acceptVisibleAssistantFinal("调查员链接完成。"),
      "调查员已正式加入战役。",
    ));
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
// retry phase and preserves the fixed player-safe character-setup prompt.
{
  const gate = new main.OpeningTerminalContinuationGate();
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
  check("submit retry phase preserves safe character prompt",
    replacementIs(
      gate.acceptVisibleAssistantFinal("继续讨论调查员的信念与重要之人。"),
      safeCharacterSetupPrompt,
    ));
}

// A late setup receipt from campaign A is owned by its original agent turn.
// It cannot switch transcript ownership or authorize arbitrary campaign B
// prose while B's exact bootstrap remains outstanding.
{
  const gate = new main.OpeningTerminalContinuationGate();
  beginBackgroundOpeningRoute(gate, "campaign-a", "cross-output-a");
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
            decision_id: "campaign-a-luck",
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
  const gate = new main.OpeningTerminalContinuationGate();
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
  check("retired-generation bind cannot bypass current character boundary",
    gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "bind-generation",
      arguments: {},
    }, "bind-generation-probe")?.includes(
      '"phase":"opening_current_character_setup_required"',
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
  const gate = new main.OpeningTerminalContinuationGate();
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
  const gate = new main.OpeningTerminalContinuationGate();
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
  const gate = new main.OpeningTerminalContinuationGate();
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
      { start_location: { location_id: "opening", title: "Opening" } },
      ["opening_pdf_indices", "opening_pdf_indices"],
    ),
    bootstrapCard({
      start_location: { location_id: "opening", title: "Opening" },
      opening_pdf_indices: [],
    }),
    bootstrapCard({
      start_location: { location_id: "opening", title: "Opening" },
      opening_pdf_indices: [0, 1, 2, 3],
    }),
    bootstrapCard({
      start_location: { location_id: "opening", title: "Opening" },
      opening_pdf_indices: [-1],
    }),
    bootstrapCard({
      start_location: { location_id: "opening", title: "Opening" },
      opening_pdf_indices: [0.5],
    }),
    bootstrapCard({
      start_location: { location_id: "opening", title: "Opening" },
      opening_pdf_indices: [0, 0],
    }),
    bootstrapCard({
      start_location: { location_id: "opening", title: "Opening" },
      opening_pdf_indices: [0, 2],
    }),
  ];
  for (const [index, card] of invalidCards.entries()) {
    const campaignId = `typed-card-invalid-${index}`;
    const gate = new main.OpeningTerminalContinuationGate();
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

  const validGate = new main.OpeningTerminalContinuationGate();
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
  const gate = new main.OpeningTerminalContinuationGate();
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
  const gate = new main.OpeningTerminalContinuationGate();
  beginBackgroundOpeningRoute(gate, "attempt-cleanup", "attempt-cleanup");
  const characterParams = {
    operation: "setup.invoke",
    campaign: "attempt-cleanup",
    arguments: {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: "attempt-cleanup",
        investigator_ids: ["cleanup-investigator"],
      },
    },
  };
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
    staleCharacterSetupResult("campaign.link_investigator"),
    "attempt-cleanup-reuse",
  );

  const admittedIds = [];
  for (
    let index = 0;
    index < main.__test.MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN - 1;
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
  const gate = new main.OpeningTerminalContinuationGate();
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
  const campaignBoundKinds = [
    ["actor.create", { actor_id: "actor", sheet: {} }],
    ["campaign.link_investigator", { investigator_ids: ["investigator"] }],
    [
      "scenario.bind_pdf",
      {
        scenario_id: "scenario",
        title: "Scenario",
        source_bundle_path: "/fixture/source-bundle",
      },
    ],
    ["campaign.render_briefing", {}],
    [
      "investigator.render_card",
      { investigator_id: "investigator" },
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
      && bound.data.next_operation.operation
        === "progressive.prepare_opening"
      && !Object.hasOwn(bound.data.next_operation, "schema_version"));

    const prepared = JSON.parse((await harness.registered.get(
      "coc_invoke",
    ).execute(
      "r13-real-prepare",
      {
        operation: "progressive.prepare_opening",
        campaign: campaignId,
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    const realBootstrapCard = prepared.data?.next_operation;
    check("real toolbox prepare returns canonical schema-less bootstrap card",
      prepared.ok === true
      && realBootstrapCard?.operation === "progressive.opening_bootstrap"
      && realBootstrapCard.invoke_via === "coc_invoke"
      && realBootstrapCard.hard_gate === true
      && realBootstrapCard.authority === "canonical_setup"
      && !Object.hasOwn(realBootstrapCard, "schema_version"));
    const realBootstrapArguments = {
      ...realBootstrapCard.prefilled_arguments,
    };
    for (const field of realBootstrapCard.missing_arguments) {
      if (field === "start_location") {
        realBootstrapArguments.start_location = {
          location_id: "r12-opening",
          title: "R12 Module",
        };
      } else if (field === "opening_pdf_indices") {
        realBootstrapArguments.opening_pdf_indices = [0];
      }
    }
    const callsBeforeRealBootstrap = harness.calls.length;
    let realBootstrapAdmissionError = null;
    try {
      await harness.registered.get("coc_invoke").execute(
        "r13-real-bootstrap",
        {
          operation: "progressive.opening_bootstrap",
          campaign: campaignId,
          arguments: realBootstrapArguments,
        },
        undefined,
        undefined,
        harness.ctx,
      );
    } catch (error) {
      realBootstrapAdmissionError = error;
    }
    check("Pi owns real schema-less prepare route and admits exact bootstrap card",
      realBootstrapAdmissionError === null
      && harness.calls.length === callsBeforeRealBootstrap + 1
      && harness.calls.at(-1).params.operation
        === "progressive.opening_bootstrap"
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
    const linked = JSON.parse((await harness.registered.get(
      "coc_invoke",
    ).execute(
      "r12-real-link-corrected",
      {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: linkArgs,
      },
      undefined,
      undefined,
      harness.ctx,
    )).content[0].text);
    check("real toolbox link waits for background attempt and then succeeds",
      missingLinkRejected
      && harness.calls.length === callsBeforeMissingLink + 1
      && linked.ok === true
      && linked.data.schema_version === 1
      && linked.data.status === "PASS"
      && linked.data.kind === "campaign.link_investigator"
      && linked.data.result.campaign_id === campaignId
      && JSON.stringify(linked.data.result.investigator_ids)
        === JSON.stringify([investigatorId]));
    await harness.shutdown();
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

// Reproduce the live Grok call shape at the real Pi gateway: payload-only
// bind/link followed by stateless prepare/bootstrap. Every malformed call is
// rejected before canonical mutation. The corrected exact route can then
// advance, including retained prefilled bootstrap provenance.
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
            location_id: "opening",
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
          location_id: "opening",
          title: "Opening",
        },
        opening_pdf_indices: [3, 4],
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const correctedLink = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "live-grok-corrected-link",
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: linkArgs,
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  check("corrected live Grok setup advances only the exact retained route",
    wrongBootstrapRejected
    && beforeWrongBootstrap === 2
    && harness.calls.length === 4
    && harness.calls.map((call) => call.params.operation).join(",") === [
      "setup.invoke",
      "progressive.prepare_opening",
      "progressive.opening_bootstrap",
      "setup.invoke",
    ].join(",")
    && correctedBootstrap.ok === true
    && correctedBootstrap.data.status === "current"
    && correctedLink.data.kind === "campaign.link_investigator"
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
    if (params.operation === "progressive.request_deepen") {
      return directTakeoverResult(activeTask);
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
  });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "gateway-pending-active-call",
    {
      operation: "progressive.request_deepen",
      campaign: campaignId,
      arguments: {
        kind: "location",
        target_id: "later-location",
        title: "Later location",
      },
    },
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

// A fulfilled background terminal may race immediately ahead of Quick-Fire
// creation. Exact chargen mechanics remain available, fabricated Luck is
// rejected, and projection still waits for the exact canonical link receipt.
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

  const luck = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "fulfilled-chargen-luck",
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
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  const callsBeforeFabricated = harness.calls.length;
  let fabricatedLuckRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "fulfilled-chargen-fabricated-create",
      {
        operation: "setup.invoke",
        campaign: campaignId,
        arguments: {
          kind: "investigator.create",
          payload: {
            campaign_id: campaignId,
            investigator_id: "fabricated-luck",
            sheet: {
              id: "fabricated-luck",
              name: "Fabricated Luck",
            },
            creation: {
              input_mode: "guided_quick_fire",
              method: "quick_fire_array",
              characteristic_assignment_order: [
                "DEX", "INT", "POW", "EDU",
                "CON", "SIZ", "APP", "STR",
              ],
              luck_roll_total: 11,
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
    "fulfilled-chargen-create",
    {
      operation: "setup.invoke",
      campaign: campaignId,
      arguments: {
        kind: "investigator.create",
        payload: {
          campaign_id: campaignId,
          investigator_id: investigatorId,
          sheet: {
            id: investigatorId,
            name: "Fulfilled Chargen Investigator",
          },
          creation: {
            input_mode: "guided_quick_fire",
            method: "quick_fire_array",
            characteristic_assignment_order: [
              "DEX", "INT", "POW", "EDU",
              "CON", "SIZ", "APP", "STR",
            ],
            luck_roll_total: luck.data.total,
            luck_roll_receipt: {
              campaign_id: campaignId,
              decision_id: luckDecisionId,
              roll_id: luck.data.roll_id,
            },
          },
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  )).content[0].text);
  await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "调查员创建完成。" }],
  });
  const callsBeforeOpeningLeak = harness.calls.length;
  let openingLeakRejected = false;
  try {
    await harness.registered.get("coc_invoke").execute(
      "fulfilled-chargen-scene-before-link",
      {
        operation: "scene.context",
        campaign: campaignId,
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch { openingLeakRejected = true; }
  const linked = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "fulfilled-chargen-link",
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
  const projected = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
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
  )).content[0].text);
  check("fulfilled-before-chargen keeps exact Luck create link projection order",
    queued.data.status === "queued"
    && luck.data.total === 9
    && fabricatedLuckRejected
    && harness.calls.length >= callsBeforeFabricated + 3
    && created.data.status === "PASS"
    && openingLeakRejected
    && harness.calls.length >= callsBeforeOpeningLeak + 2
    && linked.data.status === "PASS"
    && projected.data.status === "current"
    && harness.calls.filter((call) => (
      call.params.operation === "progressive.project_opening"
    )).length === 1);
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
    if (
      params.operation === "setup.invoke"
      && params.arguments?.kind === "campaign.link_investigator"
    ) {
      return canonicalLinkSetupResult(
        "auto-dispatch-fixture",
        ["terminal-send-investigator"],
      );
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
  await harness.registered.get("coc_invoke").execute(
    "terminal-send-link",
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
    undefined,
    undefined,
    harness.ctx,
  );
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
    retry.content.some((part) => (
      part.type === "text"
      && part.text === "调查员已正式加入战役。"
    ))
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
        start_location: { location_id: "opening", title: "Opening" },
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
  check("terminal retry phase preserves safe multi-round character setup",
    retryCharacterRound.content.some((part) => (
      part.type === "text"
      && part.text === safeCharacterSetupPrompt
    )));

  const retried = JSON.parse((await harness.registered.get("coc_invoke").execute(
    "retry-armed-opening-after-failure",
    {
      operation: "progressive.opening_bootstrap",
      campaign: "auto-dispatch-fixture",
      arguments: {
        start_location: { location_id: "opening", title: "Opening" },
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
        start_location: { location_id: "opening", title: "Opening" },
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
  check("foreground abort preserves submitted background character phase",
    submitted.ok === true
    && submitted.data.status === "queued"
    && characterPrompt.content.some((part) => (
      part.type === "text"
      && part.text === safeCharacterSetupPrompt
    ))
    && harness.controls.get(task.packet.packet_id).terminated === false);

  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  check("background terminal before character completion remains append-only",
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
  const gate = new main.OpeningTerminalContinuationGate();
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
  beginBackgroundOpeningRoute(
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

// Opening source work starts before character creation and stays nonblocking.
// The exact link receipt closes character setup; live play then waits for one
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

  const briefing = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
    "phase-briefing",
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
  )).content[0].text);
  check("briefing fallback remains available during background parsing",
    briefing.ok === true
    && briefing.data.result.briefing_path.endsWith("scenario-briefing.md"));

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
    check(`background parsing emits safe character round ${index + 1}`,
      visible.content.some((part) => (
        part.type === "text" && part.text === safeCharacterSetupPrompt
      )));
  }

  await harness.registered.get("coc_invoke").execute(
    "phase-link",
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
    undefined,
    undefined,
    harness.ctx,
  );
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  const linkVisible = await harness.emit("message_end", {
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
  check("link receipt is visible then live play remains blocked",
    linkVisible.content.some((part) => (
      part.type === "text" && part.text === "调查员已正式加入战役。"
    ))
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
  const projected = JSON.parse((await harness.registered.get(
    "coc_invoke",
  ).execute(
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
  )).content[0].text);
  const openingVisible = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "来源投影完成后的唯一开场。" }],
  });
  const tableOpeningRoute = harness.sent.findLast((entry) => (
    entry.message?.customType === "coc-opening-setup-route"
    && entry.message?.details?.next_operation?.operation
      === "evidence.table_opening"
  ));
  check("exact current projection retains table-opening evidence without duplicate wake",
    projected.ok === true
    && projected.data.status === "current"
    && harness.calls.filter((call) => (
      call.params.operation === "progressive.project_opening"
    )).length === 1
    && openingVisible.content.every((part) => part.type !== "text")
    && tableOpeningRoute?.options?.triggerTurn === true
    && harness.sent.filter((entry) => (
      entry.message?.customType
        === "coc-source-coordinator-terminal-continuation"
    )).length === 0);
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

// Queued/coalesced opening output without a takeover is a canonical contract
// violation. Reject it without manufacturing false source-terminal evidence.
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
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-opening-no-takeover",
      {
        operation: "progressive.opening_bootstrap",
        campaign: "auto-dispatch-fixture",
        arguments: {
          start_location: { location_id: "opening", title: "Opening" },
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
  check("queued opening without takeover is rejected as corruption",
    rejection instanceof Error
    && rejection.message.includes("without an exact coordinator task")
    && audit?.value?.status === "contract_violation"
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
        start_location: { location_id: "opening", title: "Opening" },
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
          start_location: { location_id: "opening", title: "Opening" },
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

// A real oversized wire projection records a durable exact blocker. It emits
// one fixed operational notice, then remains fail-closed until the same
// structured request returns a normal exact wait/dispatch.
{
  const current = currentDependencyFixture("coord-current-wire-blocked");
  const blockedWire = blockedCurrentDependencyWireResult(current);
  let exactRequests = 0;
  const harness = mainExtensionHarness((_name, params) => {
    if (
      params.campaign === "auto-dispatch-fixture"
      && params.operation === "progressive.request_deepen"
    ) {
      exactRequests += 1;
      return exactRequests === 1
        ? blockedWire
        : currentDependencyResult(current);
    }
    if (params.campaign === "campaign-b") {
      return { ok: true, tool: params.operation, data: {} };
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await invokeCurrentDependency(
    harness,
    "invoke-current-wire-blocked",
  );
  const first = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "不可释放的旧来源预览。" }],
  });
  const second = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "同一轮第二次仍不可释放。" }],
  });
  await harness.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: "请继续。" }],
  });
  const laterEpoch = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "下一轮仍不可释放。" }],
  });
  let wrongRecovery = null;
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-current-wire-wrong-recovery",
      {
        operation: "scene.context",
        campaign: "auto-dispatch-fixture",
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    wrongRecovery = error;
  }
  await harness.registered.get("coc_invoke").execute(
    "invoke-current-wire-other-campaign",
    {
      operation: "scene.context",
      campaign: "campaign-b",
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const otherCampaign = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "B 战役不受 A 的来源阻塞污染。" }],
  });
  await invokeCurrentDependency(
    harness,
    "invoke-current-wire-recovered",
  );
  const waiting = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "恢复提交后仍需等待精确终态。" }],
  });
  check("oversized exact wire blocker stays fail-closed until exact recovery",
    first.content.some((part) => (
      part.type === "text"
      && part.text === (
        "当前来源依赖的精确任务超过安全传输上限，无法安全提交。"
        + "本回合已停止；请重试同一来源请求。"
      )
    ))
    && second.content.every((part) => part.type !== "text")
    && laterEpoch.content.every((part) => part.type !== "text")
    && wrongRecovery instanceof Error
    && wrongRecovery.message.includes("safe transport budget")
    && otherCampaign.content.some((part) => part.type === "text")
    && harness.launches.join(",") === current.task.packet.packet_id
    && waiting.content.every((part) => part.type !== "text"));
  await harness.shutdown();
}

// One exact current dependency suppresses only source-dependent output and
// resumes from its own fulfilled terminal.
{
  const current = currentDependencyFixture("coord-current-dependent-deepen");
  const { task } = current;
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.request_deepen") {
      return currentDependencyResult(current);
    }
    if (params.operation === "scene.context") {
      return {
        ok: true,
        tool: "scene.context",
        data: {
          active_scene_id: "later-location",
          scene: {
            scene_id: "later-location",
            parse_state: "deep",
            evidence_gap: false,
          },
        },
      };
    }
    if (params.operation === "turn.finalize") {
      return { ok: true, tool: "turn.finalize", data: {} };
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "invoke-current-dependent-deepen",
    {
      operation: "progressive.request_deepen",
      campaign: "auto-dispatch-fixture",
      arguments: {
        kind: "location",
        target_id: "later-location",
        title: "Later location",
        current_dependency: {
          operation: "turn.finalize",
          decision_id: "current-arrival-details",
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const premature = await harness.emit("message_end", {
    role: "assistant",
    content: [{
      type: "text",
      text: "旅程恰好两小时，天气晴冷，积雪两英尺。",
    }],
  });
  check("blocking_micro suppresses only its premature source-dependent reply",
    premature.content.every((part) => part.type !== "text")
    && harness.launches.join(",") === task.packet.packet_id);
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  for (const handler of harness.handlers.get("agent_end") || []) {
    await handler({ reason: "blocking-micro-await" }, harness.ctx);
  }
  await nextTurn();
  await nextTurn();
  const terminal = harness.sent.find((entry) => (
    entry.message?.customType
      === "coc-source-coordinator-terminal-continuation"
  ));
  check("blocking_micro resumes once from terminal without polling",
    terminal?.message?.details?.continuation_class === "blocking_micro"
    && terminal.message.details.dispatch_class === "blocking_micro"
    && terminal.options?.triggerTurn === true
    && harness.calls.filter((call) => (
      call.params.operation === "progressive.status"
    )).length === 0);
  await harness.emit("message_start", {
    role: "custom",
    customType: "coc-source-coordinator-terminal-continuation",
    details: terminal.message.details,
  });
  const stalePreview = await harness.emit("message_end", {
    role: "assistant",
    content: [{
      type: "text",
      text: "旧预览不能在终态通知后直接变成玩家可见事实。",
    }],
  });
  let prematureConsumer = null;
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-current-premature-consumer",
      {
        operation: "turn.finalize",
        campaign: "auto-dispatch-fixture",
        arguments: {},
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) {
    prematureConsumer = error;
  }
  await harness.registered.get("coc_invoke").execute(
    "invoke-current-canonical-consumer",
    {
      operation: "scene.context",
      campaign: "auto-dispatch-fixture",
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  await harness.registered.get("coc_invoke").execute(
    "invoke-current-exact-finalizer",
    {
      operation: "turn.finalize",
      campaign: "auto-dispatch-fixture",
      arguments: {
        decision_id: "current-arrival-details",
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const canonicalRelease = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "来自当前深层场景投影的事实。" }],
  });
  check("terminal delivery waits for exact canonical consumption",
    stalePreview.content.every((part) => part.type !== "text")
    && prematureConsumer instanceof Error
    && prematureConsumer.message.includes("canonical projection")
    && canonicalRelease.content.some((part) => part.type === "text"));
  await harness.shutdown();
}

// Pre-call admission and post-success consumption share one exact structured
// matcher. Every supported settlement identity remains fail-closed across a
// wrong identity/subject, another campaign, and a failed consumer response.
for (const identityField of [
  "decision_id", "settlement_id", "source_scope_signature",
]) {
  const current = currentDependencyFixture(
    `coord-current-exact-${identityField}`,
    { decisionId: `exact-${identityField}` },
  );
  const dependencyRef = {
    operation: "turn.finalize",
    subject: { kind: "location", id: "later-location" },
    [identityField]: `exact-${identityField}`,
  };
  current.wait.dependency_ref = dependencyRef;
  const gate = new main.OpeningTerminalContinuationGate();
  gate.observeCurrentDependencySnapshot(
    "auto-dispatch-fixture",
    [current.wait],
  );
  gate.prepareCurrentDependencyDispatch(
    current.wait.dependency_id,
    current.wait.job_id,
    current.task.packet.packet_id,
  );
  gate.observeCurrentDependencyTerminalReceipt(
    current.task.packet.packet_id,
    { status: "fulfilled" },
  );
  gate.markCurrentDependencyTerminalDelivered(
    current.task.packet.packet_id,
  );
  gate.observeCurrentDependencyConsumerResult(
    "scene.context",
    {
      campaign: "auto-dispatch-fixture",
      arguments: {},
    },
    {
      ok: true,
      data: {
        active_scene_id: "later-location",
        scene: { parse_state: "deep", evidence_gap: false },
      },
    },
  );
  const exactArgs = { [identityField]: `exact-${identityField}` };
  const wrongArgs = { [identityField]: `stale-${identityField}` };
  const wrongIdentity = gate.currentDependencyToolError({
    operation: "turn.finalize",
    campaign: "auto-dispatch-fixture",
    arguments: wrongArgs,
  });
  const wrongTarget = gate.currentDependencyToolError({
    operation: "turn.finalize",
    campaign: "auto-dispatch-fixture",
    arguments: {
      ...exactArgs,
      kind: "location",
      target_id: "wrong-location",
    },
  });
  gate.observeCurrentDependencyConsumerResult(
    "turn.finalize",
    { campaign: "campaign-b", arguments: exactArgs },
    { ok: true, data: {} },
  );
  gate.observeCurrentDependencyConsumerResult(
    "turn.finalize",
    {
      campaign: "auto-dispatch-fixture",
      arguments: exactArgs,
    },
    { ok: false, error: { code: "fixture_failure" } },
  );
  const retainedAfterWrongResults = gate.currentDependencyToolError({
    operation: "rules.roll_dice",
    campaign: "auto-dispatch-fixture",
    arguments: {},
  });
  const exactAdmitted = gate.currentDependencyToolError({
    operation: "turn.finalize",
    campaign: "auto-dispatch-fixture",
    arguments: exactArgs,
  });
  gate.observeCurrentDependencyConsumerResult(
    "turn.finalize",
    {
      campaign: "auto-dispatch-fixture",
      arguments: exactArgs,
    },
    { ok: true, data: {} },
  );
  const released = gate.currentDependencyToolError({
    operation: "rules.roll_dice",
    campaign: "auto-dispatch-fixture",
    arguments: {},
  });
  check(`exact ${identityField} matcher owns admission and consumption`,
    wrongIdentity?.includes("exact canonical projection") === true
    && wrongTarget?.includes("exact canonical projection") === true
    && retainedAfterWrongResults?.includes(
      "exact canonical projection",
    ) === true
    && exactAdmitted === null
    && released === null);
}

// Awaiting-scope/cache dependencies are durable output waits even before an
// exact dispatch exists. Session teardown clears only the in-memory gate.
for (const operationalClass of ["awaiting_scope", "awaiting_cache"]) {
  const current = currentDependencyFixture(
    `coord-current-${operationalClass}`,
    { operationalClass },
  );
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.request_deepen") {
      return currentDependencyResult(current);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    `invoke-current-${operationalClass}`,
    {
      operation: "progressive.request_deepen",
      campaign: "auto-dispatch-fixture",
      arguments: {
        kind: "location",
        target_id: "later-location",
        title: "Later location",
        current_dependency: {
          operation: "turn.finalize",
          decision_id: "current-arrival-details",
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const premature = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "不能提前释放的来源事实。" }],
  });
  check(`${operationalClass} suppresses output before exact dispatch`,
    premature.content.every((part) => part.type !== "text")
    && harness.launches.length === 0);
  await harness.shutdown();
}

// Several exact waits retain their own terminal identities. Unrelated and
// failed terminals cannot release them, and source jobs in one exact
// settlement ask for only one wake after that settlement's last fulfillment.
{
  const first = currentDependencyFixture(
    "coord-current-multi-first",
    { decisionId: "current-multi", targetId: "later-location-a" },
  );
  const second = currentDependencyFixture(
    "coord-current-multi-second",
    { decisionId: "current-multi", targetId: "later-location-b" },
  );
  const gate = new main.OpeningTerminalContinuationGate();
  gate.observeCurrentDependencySnapshot(
    "auto-dispatch-fixture",
    [first.wait, second.wait],
  );
  gate.observeCurrentVisibleInvocation(
    "current-multi-invocation",
    "auto-dispatch-fixture",
  );
  gate.armCurrentDependencySuppression(
    "current-multi-invocation",
    "auto-dispatch-fixture",
  );
  check("multiple current dependency dispatches bind independently",
    gate.prepareCurrentDependencyDispatch(
      first.wait.dependency_id,
      first.wait.job_id,
      first.task.packet.packet_id,
    )
    && gate.prepareCurrentDependencyDispatch(
      second.wait.dependency_id,
      second.wait.job_id,
      second.task.packet.packet_id,
    ));
  const staleContext = gate.coordinatorContinuationContext(
    "coord-unrelated-background",
    "fulfilled",
  );
  const failedContext = gate.coordinatorContinuationContext(
    first.task.packet.packet_id,
    "failed",
  );
  check("unrelated and failed terminals stay nonblocking append-only",
    staleContext.dispatch_class === "nonblocking_background"
    && failedContext.dispatch_class === "nonblocking_background"
    && gate.acceptVisibleAssistantFinal("仍不能释放依赖事实。") === false);
  const firstContext = gate.coordinatorContinuationContext(
    first.task.packet.packet_id,
    "fulfilled",
  );
  check("first exact terminal consumes only its same-settlement dependency",
    firstContext.dependency_id === first.wait.dependency_id
    && gate.decideWake(first.task.packet.packet_id) === false);
  gate.armCurrentDependencySuppression(
    "current-multi-second-invocation",
    "auto-dispatch-fixture",
  );
  check("remaining exact dependent invocation is suppressed",
    gate.acceptVisibleAssistantFinal("另一个依赖仍未完成。") === false);
  const secondContext = gate.coordinatorContinuationContext(
    second.task.packet.packet_id,
    "fulfilled",
  );
  check("last exact terminal retains delivery ownership until commit",
    secondContext.dependency_id === second.wait.dependency_id
    && gate.decideWake(second.task.packet.packet_id) === true);
  gate.commitCurrentDependencyDelivery(second.task.packet.packet_id);
  gate.reset();
  check("session reset drops only ephemeral dependency waits",
    gate.acceptVisibleAssistantFinal("新会话不继承旧等待。") === true);
}

// Distinct settlement identities in one campaign are independent even when
// they consume the same canonical operation.
{
  const first = currentDependencyFixture(
    "coord-current-settlement-a",
    { decisionId: "settlement-a" },
  );
  const second = currentDependencyFixture(
    "coord-current-settlement-b",
    { decisionId: "settlement-b" },
  );
  const gate = new main.OpeningTerminalContinuationGate();
  gate.observeCurrentDependencySnapshot(
    "auto-dispatch-fixture",
    [first.wait, second.wait],
  );
  gate.prepareCurrentDependencyDispatch(
    first.wait.dependency_id,
    first.wait.job_id,
    first.task.packet.packet_id,
  );
  gate.prepareCurrentDependencyDispatch(
    second.wait.dependency_id,
    second.wait.job_id,
    second.task.packet.packet_id,
  );
  check("same-operation distinct settlements wake independently",
    gate.decideWake(first.task.packet.packet_id) === true);
  gate.commitCurrentDependencyDelivery(first.task.packet.packet_id);
  check("second settlement retains its own terminal authority",
    gate.decideWake(second.task.packet.packet_id) === true);
  gate.commitCurrentDependencyDelivery(second.task.packet.packet_id);
}

// Campaign identity is part of the exact settlement group. Two campaigns
// sharing one module and one locally stable dependency_ref wake independently.
{
  const first = currentDependencyFixture(
    "coord-current-campaign-a",
    { campaignId: "campaign-a", decisionId: "shared-decision" },
  );
  const second = currentDependencyFixture(
    "coord-current-campaign-b",
    { campaignId: "campaign-b", decisionId: "shared-decision" },
  );
  const gate = new main.OpeningTerminalContinuationGate();
  gate.observeCurrentDependencySnapshot("campaign-a", [first.wait]);
  gate.observeCurrentDependencySnapshot("campaign-b", [second.wait]);
  const bound = (
    gate.prepareCurrentDependencyDispatch(
      first.wait.dependency_id,
      first.wait.job_id,
      first.task.packet.packet_id,
    )
    && gate.prepareCurrentDependencyDispatch(
      second.wait.dependency_id,
      second.wait.job_id,
      second.task.packet.packet_id,
    )
  );
  const firstContext = gate.coordinatorContinuationContext(
    first.task.packet.packet_id,
    "fulfilled",
  );
  check("same module and dependency_ref remain campaign-distinct",
    first.wait.dependency_id !== second.wait.dependency_id
    && bound
    && firstContext.dependency_campaign_id === "campaign-a"
    && gate.decideWake(first.task.packet.packet_id) === true);
  gate.commitCurrentDependencyDelivery(first.task.packet.packet_id);
  const secondContext = gate.coordinatorContinuationContext(
    second.task.packet.packet_id,
    "fulfilled",
  );
  check("cross-campaign terminals consume only their exact wait",
    secondContext.dependency_campaign_id === "campaign-b"
    && gate.decideWake(second.task.packet.packet_id) === true);
  gate.commitCurrentDependencyDelivery(second.task.packet.packet_id);
}

// A complete empty projection is authoritative for only its campaign and
// prunes a closed/out-of-band fulfilled wait and its stale dispatch identity.
{
  const current = currentDependencyFixture("coord-current-closed-snapshot");
  const gate = new main.OpeningTerminalContinuationGate();
  gate.observeCurrentDependencySnapshot(
    "auto-dispatch-fixture",
    [current.wait],
  );
  gate.prepareCurrentDependencyDispatch(
    current.wait.dependency_id,
    current.wait.job_id,
    current.task.packet.packet_id,
  );
  gate.observeCurrentDependencySnapshot("auto-dispatch-fixture", []);
  const stale = gate.coordinatorContinuationContext(
    current.task.packet.packet_id,
    "fulfilled",
  );
  check("authoritative empty snapshot prunes only closed current waits",
    stale.dispatch_class === "nonblocking_background"
    && gate.acceptVisibleAssistantFinal("已关闭依赖不再形成全局门。") === true);
}

// Ordinary ready work starts separately and never gains the exact dependency
// selector or terminal authority.
{
  const current = currentDependencyFixture("coord-current-mixed-ready");
  const ordinaryTask = coordinatorTask("coord-ordinary-mixed-ready");
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.request_deepen") {
      return currentDependencyResult(current, ordinaryTask);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  await harness.registered.get("coc_invoke").execute(
    "invoke-current-mixed-ready",
    {
      operation: "progressive.request_deepen",
      campaign: "auto-dispatch-fixture",
      arguments: {
        kind: "location",
        target_id: "later-location",
        title: "Later location",
        current_dependency: {
          operation: "turn.finalize",
          decision_id: "current-arrival-details",
        },
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  await nextTurn();
  await nextTurn();
  const submitted = harness.appended.filter((entry) => (
    entry.name === "coc-source-coordinator-auto-dispatch"
    && ["submitted", "pending"].includes(entry.value?.status)
  ));
  check("mixed ready exact current task submits",
    submitted.some((entry) => (
      entry.value?.dispatch_key === current.task.packet.packet_id
    )));
  check("mixed ready ordinary task retains an independent queued submission",
    submitted.some((entry) => (
      entry.value?.dispatch_key === ordinaryTask.packet.packet_id
    )));
  check("mixed ready exact task retains its private selector",
    current.task.packet.claim_operation.prefilled_arguments
      .current_dependency_claim?.job_id === current.wait.job_id);
  check("mixed ready ordinary task has no private selector",
    !Object.hasOwn(
      ordinaryTask.packet.claim_operation.prefilled_arguments,
      "current_dependency_claim",
    ));
  await harness.shutdown();
}

// Capability and activation/submit failure roll back only provisional dispatch
// ownership. The durable wait remains retryable from the next exact projection.
{
  const current = currentDependencyFixture("coord-current-capability-retry");
  let enabled = false;
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.request_deepen") {
      return currentDependencyResult(current);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  }, { coordinatorEnabled: async () => enabled });
  await harness.start();
  const invoke = () => invokeCurrentDependency(
    harness,
    "invoke-current-capability-retry",
  );
  await invoke();
  const withheld = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "能力不可用时也不能泄漏依赖事实。" }],
  });
  check("capability unavailable retains wait without phantom dispatch",
    harness.launches.length === 0
    && withheld.content.every((part) => part.type !== "text")
    && harness.appended.some((entry) => (
      entry.name === "coc-source-coordinator-auto-dispatch"
      && entry.value?.status === "capability_unavailable"
    )));
  enabled = true;
  await invoke();
  check("next exact projection retries after capability recovery",
    harness.launches.join(",") === current.task.packet.packet_id);
  await harness.shutdown();
}

{
  const current = currentDependencyFixture("coord-current-submit-retry");
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.request_deepen") {
      return currentDependencyResult(current);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  }, {
    activationFailuresByKey: {
      [current.task.packet.packet_id]: 1,
    },
  });
  await harness.start();
  await invokeCurrentDependency(
    harness,
    "invoke-current-submit-fails",
  );
  await invokeCurrentDependency(
    harness,
    "invoke-current-submit-retries",
  );
  check("activation submit failure re-admits the same exact task",
    harness.launches.join(",") === [
      current.task.packet.packet_id,
      current.task.packet.packet_id,
    ].join(",")
    && harness.controls.has(current.task.packet.packet_id));
  await harness.shutdown();
}

// Hidden continuation delivery is the commit point for the last exact wait.
// A complete empty snapshot cannot erase delivery ownership while agent_end
// resolves the active terminal wake; a failed send retries the stored receipt
// at that safe boundary without manager resubmission or a second source launch.
{
  const current = currentDependencyFixture("coord-current-send-retry");
  let projectionCount = 0;
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.request_deepen") {
      projectionCount += 1;
      return projectionCount === 1
        ? currentDependencyResult(current)
        : currentDependencyResult([]);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  }, {
    sendFailuresByType: {
      "coc-source-coordinator-terminal-continuation": 1,
    },
  });
  await harness.start();
  await invokeCurrentDependency(
    harness,
    "invoke-current-send-fails",
  );
  harness.controls.get(current.task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(current.task.packet.packet_id),
  );
  await nextTurn();
  await invokeCurrentDependency(
    harness,
    "invoke-current-empty-while-delivery-pending",
  );
  for (const handler of harness.handlers.get("agent_end") || []) {
    await handler({ reason: "current-send-failure" }, harness.ctx);
  }
  await nextTurn();
  await nextTurn();
  const delivered = harness.sent.filter((entry) => (
    entry.message?.customType
      === "coc-source-coordinator-terminal-continuation"
  ));
  const terminalEntries = harness.appended.filter((entry) => (
    entry.name === "coc-source-coordinator-terminal"
    && entry.value?.packet_id === current.task.packet.packet_id
  ));
  const submissions = harness.appended.filter((entry) => (
    entry.name === "coc-source-coordinator-auto-dispatch"
    && entry.value?.dispatch_key === current.task.packet.packet_id
    && ["submitted", "pending"].includes(entry.value?.status)
  ));
  check("stored exact terminal retries once after empty reconciliation",
    delivered.length === 1
    && harness.launches.length === 1
    && submissions.length === 1
    && terminalEntries.length === 1
    && delivered[0].message.details.dependency_id
      === current.wait.dependency_id);
  await harness.shutdown();
}

// Suppression belongs to the current-dependent invocation's user epoch and
// campaign. Another campaign in the same agent turn and an unrelated same-name
// operation in a later epoch remain visible; only the explicit exact typed
// current_dependency declaration re-arms suppression.
{
  const current = currentDependencyFixture(
    "coord-current-output-owner",
    { campaignId: "campaign-a" },
  );
  const harness = mainExtensionHarness((_name, params) => {
    if (params.campaign === "campaign-a") {
      return currentDependencyResult(current);
    }
    return { ok: true, tool: params.operation, data: {} };
  }, { coordinatorEnabled: async () => false });
  await harness.start();
  await invokeCurrentDependency(
    harness,
    "invoke-current-owner-a",
    "campaign-a",
  );
  await harness.registered.get("coc_invoke").execute(
    "invoke-unrelated-campaign-b",
    {
      operation: "scene.context",
      campaign: "campaign-b",
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const otherCampaign = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "B 战役的独立可见输出。" }],
  });
  await harness.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: "规则外问题。" }],
  });
  await harness.registered.get("coc_invoke").execute(
    "invoke-unrelated-same-operation-new-epoch-a",
    {
      operation: "scene.context",
      campaign: "campaign-a",
      arguments: {},
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const laterUnrelated = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "后续独立场景说明。" }],
  });
  await harness.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: "现在这个行动确实依赖该来源。" }],
  });
  await invokeCurrentDependency(
    harness,
    "invoke-exact-current-new-epoch-a",
    "campaign-a",
  );
  const exactDependent = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "不能提前显示的精确依赖事实。" }],
  });
  check("only exact typed current dependency re-arms suppression",
    otherCampaign.content.some((part) => part.type === "text")
    && laterUnrelated.content.some((part) => part.type === "text")
    && exactDependent.content.every((part) => part.type !== "text"));
  await harness.shutdown();
}

// Noncritical source deepening remains fire-and-forget and does not inherit
// the current-dependent terminal wait.
{
  const task = coordinatorTask("coord-main-deepen-background");
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.request_deepen") {
      return directTakeoverResult(task);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  const toolResult = await harness.registered.get("coc_invoke").execute(
    "invoke-deepen-background",
    {
      operation: "progressive.request_deepen",
      campaign: "auto-dispatch-fixture",
      arguments: {
        kind: "location",
        target_id: "later-location",
        title: "Later location",
      },
    },
    undefined,
    undefined,
    harness.ctx,
  );
  const envelope = JSON.parse(toolResult.content[0].text);
  await nextTurn();
  check("noncritical deepening returns while coordinator is active",
    envelope.ok === true
    && harness.launches.join(",") === task.packet.packet_id
    && harness.controls.has(task.packet.packet_id)
    && harness.appended.filter((entry) => (
      entry.name === "coc-source-coordinator-terminal"
    )).length === 0);
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  check("noncritical deepening terminal stays append-only",
    harness.appended.filter((entry) => (
      entry.name === "coc-source-coordinator-terminal"
    )).length === 1
    && harness.sent.length === 0);
  await harness.shutdown();
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
      return directTakeoverResult(coordinatorTask("coord-extension-race"));
    },
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
  check("main extension activated expected tool surface", activeTools.length === 2);
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

// Submit failure is swallowed and recorded, never thrown.
{
  const task = coordinatorTask();
  const { deps, audit } = harness({ failSubmit: true });
  await autoDispatchCoordinator(deps, "coc_invoke", directTakeoverResult(task));
  check("submit failure swallowed", audit.length === 1 && audit[0].status === "submit_failed" && audit[0].dispatch_key === task.packet.packet_id);
  check("submit failure is bounded", !Object.hasOwn(audit[0], "error"));
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

rmSync(extensionWelcomeAgentDir, { recursive: true, force: true });
if (problems.length) {
  console.error(`auto-dispatch smoke FAILED: ${problems.join("; ")}`);
  process.exit(1);
}
console.log("auto-dispatch smoke OK");
