#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
process.env.COC_PI_SCENE_SUPPLY = "1";
delete process.env.PI_COC_CAMPAIGN_ID;
process.env.COC_PI_SESSION_ROLE = "play";

const extension = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const handlers = new Map();
const tools = new Map();
const hidden = [];
const appended = [];
const calls = [];
const managerStates = new Map();
let submissions = 0;
let coordinatorCapability = true;
let releaseLateSupply;
let markLateSupplyRequested;
const lateSupplyRequested = new Promise((resolve) => {
  markLateSupplyRequested = resolve;
});
const lateSupplyResponse = new Promise((resolve) => {
  releaseLateSupply = resolve;
});

function coordinatorTask(packetId) {
  return {
    schema_version: 1,
    contract_id: "coc.pi-source-coordinator-task.v1",
    instruction_ref: path.join(
      root,
      "plugins/coc-keeper/agents/coc-source-coordinator.md",
    ),
    model_policy: "inherit_parent",
    packet: {
      schema_version: 1,
      contract_id: "coc.source-coordinator.v1",
      packet_id: packetId,
      workspace_root: root,
      campaign_id: "supply-camp",
      asset_root_id: "asset-supply",
      max_leaves: 1,
      claim_operation: {
        operation: "progressive.claim_host_work",
        prefilled_arguments: {
          executor_id: "scene-supply-probe",
          limit: 1,
          result_delivery: "task_return_to_parent",
          max_dispatch_attempts: 2,
        },
      },
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
    next_host_action: {
      action: "invoke_coc_dispatch_source_work",
      task,
    },
  };
}

const supplies = new Map([
  ["sealed", {
    schema_version: 1,
    scene_id: "sealed",
    enforced: true,
    status: "pending",
    ready: false,
    fallback_available: false,
    source_cache_path: "pages",
  }],
  ["tower", {
    schema_version: 1,
    scene_id: "tower",
    enforced: true,
    status: "pending",
    ready: false,
    fallback_available: false,
    source_cache_path: "pages",
    background_takeover: takeover(coordinatorTask("scene-tower-1")),
  }],
  ["offline", {
    schema_version: 1,
    scene_id: "offline",
    enforced: true,
    status: "pending",
    ready: false,
    fallback_available: false,
    source_cache_path: "pages",
    background_takeover: takeover(coordinatorTask("scene-offline-1")),
  }],
  ["late", {
    schema_version: 1,
    scene_id: "late",
    enforced: true,
    status: "blocked",
    ready: false,
    fallback_available: false,
    source_cache_path: "pages",
  }],
]);

async function canonical(name, params) {
  calls.push({ name, params });
  if (params.operation === "session.resume") {
    return {
      ok: true,
      tool: "session.resume",
      data: { campaign_id: "supply-camp", mode: "awaiting_player" },
    };
  }
  if (params.operation === "steward.scene_supply") {
    if (
      params.arguments?.scene_id === "late"
      && params.arguments?.allow_minimal_fallback !== true
    ) {
      markLateSupplyRequested();
      return lateSupplyResponse;
    }
    const current = supplies.get(params.arguments?.scene_id);
    assert.ok(current, `missing supply fixture ${params.arguments?.scene_id}`);
    return { ok: true, tool: "steward.scene_supply", data: structuredClone(current) };
  }
  if (params.operation === "state.move_scene") {
    return {
      ok: true,
      tool: "state.move_scene",
      data: { to_scene_id: params.arguments?.scene_id, scene: {}, next_operation: {} },
    };
  }
  return { ok: true, tool: String(params.operation || name), data: {} };
}

const fakeManager = {
  state: (key) => managerStates.get(key),
  async submit(task) {
    submissions += 1;
    const key = task.packet.packet_id;
    const submitted = { status: "submitted", dispatch_key: key };
    managerStates.set(key, submitted);
    return submitted;
  },
  async shutdown() {},
};
const fakePi = {
  registerTool: (tool) => tools.set(tool.name, tool),
  registerCommand() {},
  registerShortcut() {},
  on: (name, handler) => handlers.set(name, [...(handlers.get(name) || []), handler]),
  appendEntry(type, value) { appended.push({ type, value }); },
  sendMessage: (message) => hidden.push(message),
  setActiveTools() {},
  getThinkingLevel: () => "off",
};
extension.default(fakePi, {
  coordinatorEnabled: async () => coordinatorCapability,
  createManager: () => fakeManager,
  welcomeAgentDir: path.join(root, ".pi", "scene-supply-probe"),
  createClient: () => ({
    callTool: canonical,
    async callToolWithTransportMeta(name, params) {
      return { value: await canonical(name, params), transport: null };
    },
    async close() {},
  }),
});
const ctx = {
  cwd: root,
  mode: "rpc",
  model: { provider: "probe", id: "probe" },
  sessionManager: { getSessionId: () => "scene-supply-probe", getEntries: () => [] },
  hasUI: false,
};
for (const handler of handlers.get("session_start") || []) {
  await handler({ reason: "probe" }, ctx);
}
const invoke = tools.get("coc_invoke");
await invoke.execute("resume", {
  operation: "session.resume",
  root,
  campaign: "supply-camp",
  arguments: {},
}, undefined, undefined, ctx);

let moveAttempt = 0;
function move(sceneId) {
  moveAttempt += 1;
  return invoke.execute(`move-${sceneId}-${moveAttempt}`, {
    operation: "state.move_scene",
    root,
    campaign: "supply-camp",
    arguments: { scene_id: sceneId, decision_id: `move-${sceneId}-${moveAttempt}` },
  }, undefined, undefined, ctx);
}

function poll(sceneId) {
  return invoke.execute(`poll-${sceneId}`, {
    operation: "steward.scene_supply",
    root,
    campaign: "supply-camp",
    arguments: { scene_id: sceneId },
  }, undefined, undefined, ctx);
}

// No exact task means no real host dispatch can exist, so the very first move
// is a stable block. Repetition and a direct readiness query cannot restart a
// meaningless move-attempt counter or return to pending.
const sealedFirst = await move("sealed");
const sealedSecond = await move("sealed");
const sealedPoll = await poll("sealed");
assert.equal(sealedFirst.details.error.code, "scene_supply_blocked");
assert.equal(sealedSecond.details.error.code, "scene_supply_blocked");
assert.equal(sealedPoll.details.data.status, "blocked");
assert.equal(sealedPoll.details.data.host_gate_status, "blocked");
assert.equal(calls.filter((call) => call.params.operation === "state.move_scene").length, 0);

// An exact task without a usable host capability is equally terminal; the KP
// is not asked to execute the task and no fake pending state is emitted.
coordinatorCapability = false;
const offline = await move("offline");
coordinatorCapability = true;
assert.equal(offline.details.error.code, "scene_supply_blocked");
assert.equal(submissions, 0);

// A repository-produced exact task is submitted privately once. Repeated move
// attempts and readiness polling observe the same live dispatch, not a counter.
const towerFirst = await move("tower");
const towerSecond = await move("tower");
const towerPollActive = await poll("tower");
assert.equal(towerFirst.details.error.code, "scene_supply_pending");
assert.equal(towerSecond.details.error.code, "scene_supply_pending");
assert.equal(towerPollActive.details.data.host_gate_status, "pending_with_live_dispatch");
assert.equal(submissions, 1);
assert.equal("background_takeover" in towerPollActive.details.data, false);

// The exact observed failure sequence needed no third move: once the host
// lifecycle becomes terminal, a readiness poll reaches a stable block.
managerStates.set("scene-tower-1", {
  status: "terminal_failure",
  dispatch_key: "scene-tower-1",
  failure_class: "coordinator_process_failed",
});
const towerPollTerminal = await poll("tower");
assert.equal(towerPollTerminal.details.data.status, "blocked");
assert.equal(towerPollTerminal.details.data.host_gate_status, "blocked");
assert.equal(submissions, 1);

// Canonical readiness always wins and permits the move without another task.
supplies.set("tower", {
  schema_version: 1,
  scene_id: "tower",
  enforced: true,
  status: "ready",
  ready: true,
  cache_hit: true,
  bundle: {
    current: { id: "tower", name: "钟楼", source_refs: ["pages/2.md"] },
    neighbors: [],
  },
});
const moved = await move("tower");
assert.equal(moved.details.ok, true);
assert.equal(moved.details.data.scene_supply.cache_hit, true);
assert.equal(calls.filter((call) => call.params.operation === "state.move_scene").length, 1);

// A readiness result owned by the old session must become inert if it settles
// after shutdown/restart: no dispatch cache write, hidden message, audit, or
// blocked scene result may leak into the new session.
const movedBeforeLate = calls.filter((call) => (
  call.params.operation === "state.move_scene"
)).length;
const lateMove = move("late");
await lateSupplyRequested;
for (const handler of handlers.get("session_shutdown") || []) {
  await handler({ type: "session_shutdown", reason: "late-preflight-probe" }, ctx);
}
for (const handler of handlers.get("session_start") || []) {
  await handler({ type: "session_start", reason: "late-preflight-probe" }, ctx);
}
const hiddenAfterRestart = hidden.length;
const appendedAfterRestart = appended.length;
releaseLateSupply({
  ok: true,
  tool: "steward.scene_supply",
  data: structuredClone(supplies.get("late")),
});
const lateResult = await lateMove;
assert.equal(lateResult.isError, true);
assert.equal(lateResult.details.error.code, "session_closed");
assert.equal(hidden.length, hiddenAfterRestart);
assert.equal(appended.length, appendedAfterRestart);
assert.equal(calls.filter((call) => (
  call.params.operation === "state.move_scene"
)).length, movedBeforeLate);

const hiddenText = JSON.stringify(hidden);
for (const forbidden of [
  "coc_dispatch_source_work",
  "场景载入中",
  "素材此刻仍未载入",
  "处理层的缺口",
  "无法自行把加载任务派发出去",
  "dispatch steward-scene",
  "resume or dispatch steward-scene",
  "resume steward-scene",
  "steward.scene_bundle_put",
]) {
  assert.equal(hiddenText.includes(forbidden), false, forbidden);
}
assert.ok(hidden.some((message) => message.customType === "coc-scene-supply-blocked"));
assert.ok(hidden.some((message) => message.customType === "coc-scene-supply-wait"));
const prefetchMessage = hidden.find((message) => (
  message.customType === "coc-scene-supply-prefetch"
));
assert.ok(prefetchMessage);
const prefetchContent = JSON.parse(prefetchMessage.content);
assert.ok(prefetchContent.instruction.includes("Continue normal play"));
assert.ok(prefetchContent.instruction.includes("host-owned"));
assert.ok(prefetchContent.instruction.includes("no Keeper action"));
process.stdout.write(JSON.stringify({ ok: true, submissions }));
