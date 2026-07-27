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
      claim_operation: { operation: "progressive.claim_host_work", prefilled_arguments: { executor_id: executorId, limit: 2, result_delivery: "task_return_to_parent" } },
      fulfill_operation: { operation: "progressive.fulfill_host_work" },
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
  return { ...harness({ manager }), manager, launches, controls, lifecycle, notifications };
}

async function nextTurn() {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  const sceneTask = coordinatorTask("coord-scene");
  const resumeTask = coordinatorTask("coord-resume");
  check("extractor finds direct progressive task", JSON.stringify(findAutoDispatchTask(directTakeoverResult(directTask))) === JSON.stringify(directTask));
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
