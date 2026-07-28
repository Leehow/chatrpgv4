// Smoke: the Pi main-session gateway auto-drives coordinator dispatch.
// findAutoDispatchTask extracts only the canonical coc_invoke projection path,
// and autoDispatchCoordinator submits it through the shared manager path
// without ever throwing back into the KP's tool result.
import "./_lib/preload-embedded-pi.mjs";
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
  schema_version: 1,
  operation: "progressive.prepare_opening",
  invoke_via: "coc_invoke",
  prefilled_arguments: {},
  missing_arguments: [],
  hard_gate: true,
  authority: "canonical_setup",
}) {
  return {
    schema_version: 1,
    status: "blocked",
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_selection",
    campaign_id: "auto-dispatch-fixture",
    asset_root_id: "asset-fixture",
    next_operation: nextOperation,
    instruction: "invoke the exact retained opening setup card",
  };
}

function boundOpeningSetupResult() {
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

function preparedOpeningSetupResult() {
  return {
    ok: true,
    tool: "progressive.prepare_opening",
    data: {
      status: "blocked",
      next_operation: {
        schema_version: 1,
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

async function armOpeningBootstrapRoute(harness) {
  await harness.registered.get("coc_invoke").execute(
    "arm-source-bind",
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
  await harness.registered.get("coc_invoke").execute(
    "arm-opening-prepare",
    {
      operation: "progressive.prepare_opening",
      campaign: "auto-dispatch-fixture",
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

function mainExtensionHarness(responseForCall) {
  const registered = new Map();
  const handlers = new Map();
  const appended = [];
  const sent = [];
  const calls = [];
  const launches = [];
  const controls = new Map();
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
    sendMessage: (message, options) => sent.push({ message, options }),
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
    coordinatorEnabled: async () => true,
    createClient: () => fakeClient,
    launchCoordinator: (task) => {
      const key = task.packet.packet_id;
      launches.push(key);
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
    schema_version: 1,
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
      return {
        ok: true,
        tool: "setup.invoke",
        data: {
          status: "PASS",
          result: { kind: params.arguments.kind },
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
  const callsBeforeFakeInner = harness.calls.length;
  let fakeInnerError;
  try {
    await harness.registered.get("coc_invoke").execute(
      "invoke-fake-top-level-investigator-create",
      {
        operation: "investigator.create",
        campaign: "auto-dispatch-fixture",
        arguments: {
          investigator_id: "fake-inner",
          sheet: { id: "fake-inner", name: "Fake Inner" },
        },
      },
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { fakeInnerError = error; }
  check("fake top-level setup kind is rejected before MCP",
    fakeInnerError instanceof Error
    && harness.calls.length === callsBeforeFakeInner);

  for (const [label, campaign] of [
    ["missing", undefined],
    ["non-string", 7],
  ]) {
    const callsBeforeInvalidRoute = harness.calls.length;
    let invalidRouteError;
    const invalidParams = {
      operation: "progressive.prepare_opening",
      arguments: {},
    };
    if (campaign !== undefined) invalidParams.campaign = campaign;
    try {
      await harness.registered.get("coc_invoke").execute(
        `invoke-${label}-campaign-route`,
        invalidParams,
        undefined,
        undefined,
        harness.ctx,
      );
    } catch (error) { invalidRouteError = error; }
    const forcedAfterInvalid = await harness.emit("message_end", {
      role: "assistant",
      content: [{ type: "text", text: `invalid-route-${label}` }],
    });
    check(`${label} campaign cannot consume retained route latch`,
      invalidRouteError instanceof Error
      && harness.calls.length === callsBeforeInvalidRoute
      && forcedAfterInvalid.content.every((part) => part.type !== "text")
      && harness.sent.at(-1)?.message?.details?.next_operation?.operation
        === "progressive.prepare_opening");
  }

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
  let rediscoverAfterPrepare;
  try {
    await harness.registered.get("coc_discover").execute(
      "rediscover-after-prepare",
      {},
      undefined,
      undefined,
      harness.ctx,
    );
  } catch (error) { rediscoverAfterPrepare = error; }
  check("prepare advances retained route to exact opening bootstrap",
    rediscoverAfterPrepare instanceof Error
    && rediscoverAfterPrepare.message.includes(
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
  const afterCurrent = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "来源开场已物化。" }],
  });
  check("canonical current opening releases pre-bootstrap transcript gate",
    afterCurrent.content.some((part) => (
      part.type === "text" && part.text === "来源开场已物化。"
    )));
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
  const pending = harness.registered.get("coc_invoke").execute(
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
  );
  await nextTurn();
  harness.controls.get(task.packet.packet_id).resolve(
    failedCoordinatorEvents(task.packet.packet_id, "leaf_dispatch_failed"),
  );
  const failed = JSON.parse((await pending).content[0].text);
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
    failed.ok === false
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

// Cancellation follows the same armed route contract: visible bounded
// blocker, no invented narration, no late child wake, and a usable retry after
// the cancelled child eventually terminalizes.
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
  const cancelled = JSON.parse((await pending).content[0].text);
  const visibleBlocker = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "取消后直接进入虚构场景。" }],
  });
  const blockerText = visibleBlocker.content.find(
    (part) => part.type === "text",
  )?.text;
  const hiddenBlocker = harness.appended.find((entry) => (
    entry.name === "coc-opening-setup-terminal-blocker"
  ))?.value;
  check("armed cancellation is exact Chinese prose without machine labels",
    cancelled.error.code === "opening_source_wait_cancelled"
    && blockerText === (
      "开场资料解析已取消，游戏尚未开始。系统保留了当前进度；"
      + "你可以稍后重试原来的开场步骤，在资料就绪前不会自行编写剧情。"
    )
    && !/[{}]/.test(blockerText)
    && !blockerText.includes("error_code")
    && !blockerText.includes("dispatch_key")
    && !blockerText.includes("next_operation")
    && !blockerText.includes("progressive.opening_bootstrap")
    && !blockerText.includes("虚构场景"));
  check("armed cancellation retains hidden exact retry details",
    hiddenBlocker.error_code === "opening_source_wait_cancelled"
    && hiddenBlocker.next_operation.operation
      === "progressive.opening_bootstrap");

  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  check("armed cancellation late terminal remains append-only",
    harness.appended.filter((entry) => (
      entry.name === "coc-source-coordinator-terminal"
    )).length === 1
    && harness.sent.length === 0);

  const retried = JSON.parse((await harness.registered.get("coc_invoke").execute(
    "retry-armed-opening-after-abort",
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
  check("armed cancellation retry remains live after late terminal",
    bootstrapCalls === 2
    && retried.ok === true
    && retried.data.status === "current");
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

// V4 host path: the original opening_bootstrap tool call is the only provider
// continuation. It remains unresolved until durable terminal publication and
// one canonical current-projection check both finish.
{
  const task = coordinatorTask("coord-main-opening-success");
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    if (params.operation === "progressive.project_opening") {
      return {
        ok: true,
        tool: "progressive.project_opening",
        data: {
          status: "current",
          asset_root_id: task.packet.asset_root_id,
          start_location_id: "opening",
        },
      };
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  let settled = false;
  const pendingResult = harness.registered.get("coc_invoke").execute(
    "invoke-opening-success",
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
  ).then((value) => {
    settled = true;
    return value;
  });
  await nextTurn();
  check("main opening does not return in-flight bootstrap to provider",
    settled === false
    && harness.calls.length === 1
    && harness.calls[0].params.operation === "progressive.opening_bootstrap"
    && harness.sent.length === 0);
  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  const toolResult = await pendingResult;
  const envelope = JSON.parse(toolResult.content[0].text);
  check("main opening returns only terminal current projection",
    envelope.ok === true
    && envelope.data.status === "current"
    && envelope.data.source_dependency_terminal === true
    && envelope.data.source_work.status === "fulfilled"
    && envelope.data.source_work.terminal === true
    && !Object.hasOwn(envelope.data.source_work, "background_takeover")
    && envelope.data.coordinator_terminal.terminal_receipt.status === "fulfilled"
    && envelope.data.coordinator_terminal.notification.hidden_continuation
      === "suppressed_consumed"
    && envelope.data.opening_projection.status === "current");
  check("main opening performs one canonical projection opportunity",
    harness.calls.length === 2
    && harness.calls[1].params.operation === "progressive.project_opening"
    && harness.calls[1].params.arguments.asset_root_id === task.packet.asset_root_id
    && harness.calls[1].params.arguments.source_file_sha256 === "a".repeat(64)
    && harness.calls[1].params.arguments.start_location_id === "opening"
    && JSON.stringify(harness.calls[1].params.arguments.opening_pdf_indices)
      === "[0]");
  check("waiting opening terminal creates no competing continuation wake",
    harness.sent.length === 0
    && harness.appended.filter((entry) => (
      entry.name === "coc-source-coordinator-terminal"
    )).length === 1
    && harness.appended.some((entry) => (
      entry.name === "coc-source-coordinator-auto-dispatch"
      && entry.value.status === "submitted"
    )));
  await nextTurn();
  await harness.shutdown();
}

// Terminal source failure releases no projection call or invented opening.
{
  const task = coordinatorTask("coord-main-opening-failure");
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  let settled = false;
  const pendingResult = harness.registered.get("coc_invoke").execute(
    "invoke-opening-failure",
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
  ).then((value) => {
    settled = true;
    return value;
  });
  await nextTurn();
  check("failed opening still waits for terminal source outcome",
    settled === false && harness.calls.length === 1 && harness.sent.length === 0);
  harness.controls.get(task.packet.packet_id).resolve(
    failedCoordinatorEvents(
      task.packet.packet_id,
      "leaf_dispatch_failed",
    ),
  );
  const toolResult = await pendingResult;
  const envelope = JSON.parse(toolResult.content[0].text);
  check("failed opening fails closed without projection",
    envelope.ok === false
    && envelope.error.code === "opening_source_terminal_failure"
    && envelope.data.status === "terminal_failure"
    && envelope.data.projection_ready === false
    && envelope.data.activation_allowed === false
    && envelope.data.coordinator_terminal.terminal_receipt.failure_class
      === "leaf_dispatch_failed"
    && envelope.data.coordinator_terminal.notification.hidden_continuation
      === "suppressed_consumed"
    && harness.calls.length === 1);
  check("failed opening has one durable terminal and no duplicate wake",
    harness.appended.filter((entry) => (
      entry.name === "coc-source-coordinator-terminal"
    )).length === 1
    && harness.sent.length === 0);
  await nextTurn();
  await harness.shutdown();
}

// Aborting the per-call wait consumes only that opening owner. The next real
// user epoch remains visible, and a late child terminal cannot wake the model.
{
  const task = coordinatorTask("coord-main-opening-abort");
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
  const controller = new AbortController();
  const pendingResult = harness.registered.get("coc_invoke").execute(
    "invoke-opening-abort",
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
  check("abort fixture reaches active synchronous wait",
    harness.controls.has(task.packet.packet_id)
    && harness.calls.length === 1
    && harness.sent.length === 0);
  controller.abort();
  const cancelled = JSON.parse((await pendingResult).content[0].text);
  check("aborted opening returns bounded not-playable cancellation",
    cancelled.ok === false
    && cancelled.error.code === "opening_source_wait_cancelled"
    && cancelled.data.projection_ready === false
    && cancelled.data.activation_allowed === false);

  await harness.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: "这是取消后的新回合。" }],
  });
  const nextAssistant = await harness.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: "新回合的有效叙事保持可见。" }],
  });
  check("aborted wait does not suppress next real user epoch",
    nextAssistant.content.some((part) => (
      part.type === "text"
      && part.text === "新回合的有效叙事保持可见。"
    )));

  harness.controls.get(task.packet.packet_id).resolve(
    fulfilledCoordinatorEvents(task.packet.packet_id),
  );
  await nextTurn();
  await nextTurn();
  check("late terminal after abort is append-only and never wakes provider",
    harness.appended.filter((entry) => (
      entry.name === "coc-source-coordinator-terminal"
    )).length === 1
    && harness.sent.length === 0
    && harness.calls.length === 1);
  await harness.shutdown();
}

// Queued/coalesced opening output without a takeover is a canonical contract
// violation. Reject it without manufacturing false source-terminal evidence.
{
  const task = coordinatorTask("coord-main-opening-no-takeover");
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapWithoutTakeover(task, "queued");
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
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
    && harness.calls.length === 1
    && harness.sent.length === 0);
  await harness.shutdown();
}

// A genuinely current opening needs no takeover and remains a legitimate
// terminal/current response.
{
  const task = coordinatorTask("coord-main-opening-current");
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapWithoutTakeover(task, "current");
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
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
    && harness.calls.length === 1
    && harness.sent.length === 0);
  await harness.shutdown();
}

// A malformed blocking takeover is canonical corruption. Reject it without
// manufacturing false source-terminal evidence.
{
  const task = coordinatorTask("coord-main-opening-invalid");
  delete task.packet.packet_id;
  const harness = mainExtensionHarness((_name, params) => {
    if (params.operation === "progressive.opening_bootstrap") {
      return openingBootstrapResult(task);
    }
    throw new Error(`unexpected operation ${params.operation}`);
  });
  await harness.start();
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
    && harness.calls.length === 1
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
