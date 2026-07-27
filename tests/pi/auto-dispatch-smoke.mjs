// Smoke: the Pi main-session gateway auto-drives coordinator dispatch.
// findAutoDispatchTask extracts only the canonical coc_invoke projection path,
// and autoDispatchCoordinator submits it through the shared manager path
// without ever throwing back into the KP's tool result.
import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const { findAutoDispatchTask, autoDispatchCoordinator } = main.__test;
const instruction = path.join(root, "plugins/coc-keeper/agents/coc-source-coordinator.md");
const problems = [];

function check(label, condition) {
  if (!condition) problems.push(label);
}

function coordinatorTask(packetId = "coord-auto-1") {
  return {
    schema_version: 1, contract_id: "coc.pi-source-coordinator-task.v1",
    instruction_ref: instruction, model_policy: "inherit_parent",
    packet: {
      schema_version: 1, contract_id: "coc.source-coordinator.v1", packet_id: packetId,
      workspace_root: root, campaign_id: "auto-dispatch-fixture", max_leaves: 2,
      claim_operation: { operation: "progressive.claim_host_work", prefilled_arguments: { executor_id: "pi:fixture", limit: 2, result_delivery: "task_return_to_parent" } },
      fulfill_operation: { operation: "progressive.fulfill_host_work" },
    },
  };
}

function takeoverResult(task) {
  return {
    ok: true, tool: "progressive.prepare_session",
    data: {
      background_takeover: {
        schema_version: 1, kind: "ready_background_source_work",
        dispatch_mode: "coordinator_fanout", host_adapter: "pi",
        next_host_action: {
          schema_version: 1, action: "invoke_coc_dispatch_source_work",
          task, parent_waits: false,
        },
      },
    },
  };
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
    activeManager: () => fakeManager,
    manager: () => fakeManager,
    launchContext: () => ({ cwd: root, provider: "offline", modelId: "offline", thinking: "off" }),
    audit: (entry) => audit.push(entry),
  };
  return { deps, audit, submits };
}

// Extractor: only data.background_takeover.next_host_action resolves.
{
  const task = coordinatorTask();
  check("extractor finds exact task", JSON.stringify(findAutoDispatchTask(takeoverResult(task))) === JSON.stringify(task));
  check("extractor ignores plain results", findAutoDispatchTask({ ok: true, data: { status: "PASS" } }) === null);
  check("extractor ignores failed envelopes", findAutoDispatchTask({ ...takeoverResult(task), ok: false }) === null);
  check("extractor ignores top-level action", findAutoDispatchTask({ next_host_action: { action: "invoke_coc_dispatch_source_work", task } }) === null);
  check("extractor ignores arbitrary nesting", findAutoDispatchTask({ data: { wrapper: takeoverResult(task).data } }) === null);
  check("extractor ignores arrays", findAutoDispatchTask({ data: [{ background_takeover: takeoverResult(task).data.background_takeover }] }) === null);
  check("extractor ignores foreign actions", findAutoDispatchTask({
    data: { background_takeover: { next_host_action: { action: "spawn_background_task", task } } },
  }) === null);
  check("extractor ignores foreign contracts", findAutoDispatchTask({
    data: { background_takeover: { next_host_action: { action: "invoke_coc_dispatch_source_work", task: { contract_id: "coc.other.v1" } } } },
  }) === null);
  check("extractor ignores strings", findAutoDispatchTask({
    data: { background_takeover: '{"next_host_action":{"action":"invoke_coc_dispatch_source_work"}}' },
  }) === null);
}

// Matching takeover triggers exactly one submit with the exact task.
{
  const task = coordinatorTask();
  const { deps, audit, submits } = harness();
  await autoDispatchCoordinator(deps, "coc_invoke", takeoverResult(task));
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
  await autoDispatchCoordinator(deps, "coc_discover", takeoverResult(task));
  check("discover cannot dispatch", submits.length === 0 && audit.length === 0);
}

// Capability disabled skips silently.
{
  const { deps, audit, submits } = harness({ enabled: false });
  await autoDispatchCoordinator(deps, "coc_invoke", takeoverResult(coordinatorTask()));
  check("disabled capability skips", submits.length === 0 && audit.length === 0);
}

// Already-submitted packet_id and busy manager both skip without a new submit.
{
  const task = coordinatorTask();
  const deduped = harness({
    manager: { state: (key) => (key === task.packet.packet_id ? { status: "submitted" } : undefined), activeCount: () => 0, submit: async () => { throw new Error("must not submit"); } },
  });
  await autoDispatchCoordinator(deduped.deps, "coc_invoke", takeoverResult(task));
  check("deduped packet skips", deduped.audit.length === 0);
  const busy = harness({
    manager: { state: () => undefined, activeCount: () => 1, submit: async () => { throw new Error("must not submit"); } },
  });
  await autoDispatchCoordinator(busy.deps, "coc_invoke", takeoverResult(coordinatorTask("coord-other")));
  check("active coordinator skips", busy.audit.length === 0);
}

// Submit failure is swallowed and recorded, never thrown.
{
  const task = coordinatorTask();
  const { deps, audit } = harness({ failSubmit: true });
  await autoDispatchCoordinator(deps, "coc_invoke", takeoverResult(task));
  check("submit failure swallowed", audit.length === 1 && audit[0].status === "submit_failed" && audit[0].dispatch_key === task.packet.packet_id);
  check("submit failure is bounded", !Object.hasOwn(audit[0], "error"));
}

// Validation failure is recorded without a submit.
{
  const bad = coordinatorTask("coord-invalid");
  bad.instruction_ref = path.join(root, "plugins/coc-keeper/agents/coc-source-pack-worker.md");
  const { deps, audit, submits } = harness();
  await autoDispatchCoordinator(deps, "coc_invoke", takeoverResult(bad));
  check("invalid task recorded", submits.length === 0 && audit.length === 1 && audit[0].status === "validation_failed");
  check("validation audit is bounded", !Object.hasOwn(audit[0], "error"));
}

// Workspace drift and missing model context never reach submit.
{
  const drifted = coordinatorTask("coord-drift");
  drifted.packet.workspace_root = path.join(root, "elsewhere");
  const { deps, audit, submits } = harness();
  await autoDispatchCoordinator(deps, "coc_invoke", takeoverResult(drifted));
  check("workspace drift recorded", submits.length === 0 && audit.length === 1 && audit[0].status === "workspace_drift");
  const noModel = harness();
  noModel.deps.launchContext = () => null;
  await autoDispatchCoordinator(noModel.deps, "coc_invoke", takeoverResult(coordinatorTask("coord-nomodel")));
  check("missing model is bounded diagnostic", noModel.submits.length === 0
    && noModel.audit.length === 1
    && noModel.audit[0].status === "launch_context_unavailable"
    && !Object.hasOwn(noModel.audit[0], "error"));
}

// Capability read failures are bounded and never include provider text.
{
  const { deps, audit, submits } = harness();
  deps.enabled = async () => { throw new Error("raw provider secret"); };
  await autoDispatchCoordinator(deps, "coc_invoke", takeoverResult(coordinatorTask("coord-capability-error")));
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
