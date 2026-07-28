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
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));
const { findAutoDispatchTask, autoDispatchCoordinator } = main.__test;
const instruction = path.join(root, "plugins/coc-keeper/agents/coc-source-coordinator.md");
const problems = [];

function check(label, condition) {
  if (!condition) problems.push(label);
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

function beginBackgroundOpeningRoute(gate, campaignId, prefix) {
  bindOpeningRoute(gate, campaignId, `${prefix}-bind`);
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
  const calls = [];
  const launches = [];
  const controls = new Map();
  const sendFailuresByType = new Map(
    Object.entries(options.sendFailuresByType ?? {}),
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
      calls.push({ name, params });
      return responseForCall(name, params);
    },
    close: async () => {},
  };
  main.default(fakePi, {
    coordinatorEnabled: options.coordinatorEnabled ?? (async () => true),
    createClient: () => fakeClient,
    launchCoordinator: (task) => {
      const key = task.packet.packet_id;
      launches.push(key);
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
    mode: "rpc",
    model: { provider: "offline", id: "offline" },
    sessionManager: {
      getSessionId: () => "blocking-opening-extension",
      getEntries: () => [],
    },
    hasUI: false,
  };
  return {
    registered,
    handlers,
    appended,
    sent,
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
            : { kind },
        },
      };
    }
    if (params.operation === "setup.investigator_contract") {
      return {
        ok: true,
        tool: "setup.investigator_contract",
        data: { status: "PASS", result: { payload_schema: {} } },
      };
    }
    if (params.operation === "rules.roll_dice") {
      return {
        ok: true,
        tool: "rules.roll_dice",
        data: { expression: "3D6", rolls: [3, 4, 5], total: 12 },
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

  await harness.registered.get("coc_invoke").execute(
    "invoke-quick-fire-luck-during-opening",
    {
      operation: "rules.roll_dice",
      campaign: "auto-dispatch-fixture",
      arguments: {
        expression: "3D6",
        decision_id: "quick-fire-luck-during-opening",
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
      && part.text === "请选择调查员的特征值生成方式。"
    )));

  const canonicalSetupCalls = [
    {
      kind: "investigator.create",
      payload: {
        investigator_id: "route-investigator",
        sheet: { id: "route-investigator", name: "Route Investigator" },
        creation: { method: "quick_fire_array" },
      },
    },
    {
      kind: "campaign.link_investigator",
      payload: {
        campaign_id: "auto-dispatch-fixture",
        investigator_ids: ["route-investigator"],
      },
    },
    {
      kind: "investigator.render_card",
      payload: {
        campaign_id: "auto-dispatch-fixture",
        investigator_id: "route-investigator",
        language: "zh-Hans",
        html_mode: "never",
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
        && part.text === `setup-visible:${setup.kind}`
      )));
  }
  const afterCurrent = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "来源开场已物化。" }],
  });
  check("current opening releases only after exact canonical link receipt",
    afterCurrent.content.some((part) => (
      part.type === "text" && part.text === "来源开场已物化。"
    )));
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
    && gate.acceptVisibleAssistantFinal("继续完善调查员。") === true);
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
  check("exact link receipt is visible before immediate-current release",
    linked === undefined
    && gate.acceptVisibleAssistantFinal("调查员已正式加入。") === true
    && gate.openingSetupToolError("coc_invoke", {
      operation: "scene.context",
      campaign: "current-before-link",
      arguments: {},
    }, "current-before-link-released") === null);
}

// Terminal fulfillment before link is append-only. Projection remains
// retained, malformed ok:true link receipts cannot complete setup, and the
// exact current link exposes one projection route.
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
  check("terminal before link cannot wake or execute retained projection",
    gate.decideWake(task.packet.packet_id) === false
    && gate.openingSetupToolError(
      "coc_invoke",
      projectionParams,
      "terminal-before-link-project",
    )?.includes("campaign.link_investigator")
    && gate.acceptVisibleAssistantFinal("继续自然完成背景与技能。") === true);

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
    gate.acceptVisibleAssistantFinal("调查员链接回执已确认。") === true);
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
    gate.acceptVisibleAssistantFinal("调查员链接完成。") === true);
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
// retry phase and does not revoke natural character-creation dialogue.
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
  check("submit retry phase preserves natural character dialogue",
    gate.acceptVisibleAssistantFinal("继续讨论调查员的信念与重要之人。")
      === true);
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
        investigator_id: "inv-a",
        sheet: { id: "inv-a", name: "A" },
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
      && part.text === "终态发送失败后的精确投影重试。"
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
  check("terminal retry phase preserves natural multi-round character setup",
    retryCharacterRound.content.some((part) => (
      part.type === "text"
      && part.text === "后台重试待定，我们继续完善调查员背景。"
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
      && part.text === "后台解析中，我们继续创建调查员。"
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
    check(`background parsing permits natural character round ${index + 1}`,
      visible.content.some((part) => (
        part.type === "text" && part.text === `自然开卡对话 ${index + 1}`
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
      part.type === "text" && part.text === "调查员已创建并加入本次游戏。"
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
  check("exact current projection releases one opening without duplicate wake",
    projected.ok === true
    && projected.data.status === "current"
    && harness.calls.filter((call) => (
      call.params.operation === "progressive.project_opening"
    )).length === 1
    && openingVisible.content.some((part) => (
      part.type === "text" && part.text === "来源投影完成后的唯一开场。"
    ))
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

// Noncritical source deepening remains fire-and-forget and does not inherit
// the opening hard wait.
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

if (problems.length) {
  console.error(`auto-dispatch smoke FAILED: ${problems.join("; ")}`);
  process.exit(1);
}
console.log("auto-dispatch smoke OK");
