// Player-latency and lifecycle contract for finalize-after asynchronous
// semantic memory extraction (Pi gateway hook).
//
// Pins:
// 1. turn.finalize's canonical result (exact rendered_text) returns to the
//    player BEFORE the background extraction completes; the extraction
//    worker is scheduled fire-and-forget from `data.memory_extraction`.
// 2. Duplicate finalize / duplicate hook schedules ONE worker (live dedupe).
// 3. Terminal child failure and malformed agent results record a recoverable
//    pending failure — they never block, never write hard state, and never
//    alter the player envelope.
// 4. Re-arm on session start schedules durable pending backlog rows exactly
//    once, without KP polling and without touching non-pending rows.
// 5. Privacy: the extractor task packet is semantic-only (no machine
//    digests), the worker never calls state/rules operations, and no audit
//    entry ever carries the rendered table text.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
process.env.COC_PI_SESSION_ROLE = "play";
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const {
  MemoryExtractionDispatcher,
  defaultRunMemoryHostBridge,
  memoryHostBridgeCommand,
  resolveRequiredUvExecutable,
} = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/memory-extraction-dispatch.ts",
));

const campaignId = "hoyk-pi-grok-fix7-20260727";
const timelineId = "tl-main";
const jobId = `extract-${campaignId}-tl-main-turn-1`;
const episodeId = `episode-${campaignId}-tl-main-turn-1`;
const backlogId = `backlog-${campaignId}-t1-extract`;

const renderedText = `你接过那份蜡封卷轴，先在指间细细掂量。火漆完好，压痕清晰，盖的是伯尼菲斯大人惯用的印章；卷轴外签写着德里克斯地长老西尔·灰须之名，并无错讹。文书本身是正式的道歉，并承诺来年春天在原处重栽一棵新橡树——与大人方才口述的使命一致。

【明骰】初印象·伯尼菲斯大人｜外貌 50 / 信用评级 25；采用外貌 50｜掷骰：95；基础值：50；门槛：普通（≤50）；达到：失败；未通过

你向伯尼菲斯大人简要复述：立刻携此文书前往德里克斯地，面见西尔·灰须，为砍伐圣橡一事修好关系。大人听你复述时只匆匆点头，目光已飘向更衣室方向，语气简短确认后便挥手让你上路，再不多添一句叮嘱。

你行礼领命，披上冬斗篷，将卷轴妥帖收好，踏出谢尔伯恩城堡。雪路在晴冷的天光下延伸，积雪约有两英尺深，一步一陷；约两小时后，你抵达德里克斯地外缘。村舍轮廓在白茫茫的原野尽头隐约可见，寒风贴着斗篷掠过。

文书仍在侧。下一步，是进村寻访长老，还是先在村外观察一番？`;
const sha256 = (value) => (
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`
);
// The gateway arms finalized output against the canonical JSON value digest
// of the rendered text (canonicalJsonValueSha256), not the raw UTF-8 bytes.
const renderedSha256 = sha256(JSON.stringify(renderedText));

const baseFinalizeEnvelope = {
  ok: true,
  tool: "turn.finalize",
  wire: {
    schema_version: 1,
    profile: "keeper_hot_v1",
    canonical_operation: "turn.finalize",
    max_inline_bytes: 16384,
    full_result_bytes: 7388,
    full_result_sha256:
      "sha256:ad1a1febb836f4d3467e2b5e821223d246296d14546060f915ece8285c8ed790",
    contract_archive_sha256:
      "sha256:b39e4c6a39564969c739ffd5a05aef038dcf1523a4c9343a1b60efdeff683ac0",
    payload_projected: true,
    measured_inline_bytes: 2975,
  },
  data: {
    schema_version: 1,
    finalization_id:
      "turn-effect-v1:2ebe52936fe14d90f53436d3c0e28c313931fd09",
    decision_id: "journal-turn1-depart-drixdale-v1:finalize",
    journal_decision_id: "journal-turn1-depart-drixdale-v1",
    source_digest:
      "sha256:cca4fce29269854117e0882de53cbd570323a8f71ef32e6d16745c2bbd7d4805",
    rendered_text_sha256: renderedSha256,
    rendered_text: renderedText,
    integrity_digest:
      "sha256:6e1ec1f3d21ecdcc1f977abe09e9847f135d020e2925d40973d18b8d5b2c5c14",
  },
  warnings: [],
  hints: [],
};

const memoryExtractionEvidence = {
  job_id: jobId,
  episode_id: episodeId,
  timeline_id: timelineId,
  turn_number: 1,
  backlog_id: backlogId,
};

const finalizeEnvelope = () => structuredClone({
  ...baseFinalizeEnvelope,
  data: {
    ...structuredClone(baseFinalizeEnvelope.data),
    memory_extraction: { ...memoryExtractionEvidence },
  },
});

const finalizeArguments = {
  revision: 1,
  narration_review_id: "narration-review-v1:probe",
  agency_claims: [{
    claim_id: "claim-probe",
    subject_ref: "pc:probe",
    claim_type: "voluntary_action",
    exact_excerpt: "你接过那份蜡封卷轴",
    source_ref: "player_input:probe",
    override_id: null,
  }],
};

const sessionResumeEnvelope = {
  ok: true,
  tool: "session.resume",
  data: {
    schema_version: 1,
    campaign_id: campaignId,
    mode: "awaiting_player",
    next_operations: [],
  },
};
const journalEnvelope = {
  ok: true,
  tool: "state.journal",
  data: { turn_id: "turn-async-memory-1" },
};
const extractionStatusEnvelope = (entries) => ({
  ok: true,
  tool: "memory.extraction_status",
  data: {
    schema_version: 1,
    campaign_id: campaignId,
    count: entries.length,
    pending_count: entries.filter((row) => row.status === "pending").length,
    entries,
  },
});

const extractorPacket = {
  job_id: jobId,
  episode_id: episodeId,
  campaign_id: campaignId,
  timeline_id: timelineId,
  turn_number: 1,
  subjects_present: [],
  entities: [],
  result_contract: {
    fields: [
      "assertion_id", "kind", "scope", "campaign_id", "timeline_id",
      "subject_id", "knowers", "privacy", "state", "statement",
      "entities", "occurred_turn", "valid_from_turn",
    ],
    required_fields: [
      "assertion_id", "kind", "subject_id", "privacy", "state",
      "statement", "valid_from_turn",
    ],
    forbidden_fields: ["source_commit", "superseded_by", "contradicts"],
    id_prefix: "mem-hoyk-pi-grok-fix7-20260727-t1-c",
    id_rule: "id_prefix + ordinal; ordinal >= 1; unique within result",
    allowed_kinds: ["belief", "knowledge", "world_event"],
    allowed_states: ["accurate", "uncertain"],
    allowed_privacy: ["player_safe", "keeper_only"],
    max_candidates: 32,
  },
};

const extractorResult = {
  job_id: jobId,
  candidates: [{
    assertion_id: "mem-hoyk-pi-grok-fix7-20260727-t1-c1",
    kind: "belief",
    scope: "campaign",
    campaign_id: campaignId,
    timeline_id: timelineId,
    subject_id: "subject-party-probe",
    knowers: ["subject-party-probe"],
    privacy: "player_safe",
    state: "accurate",
    statement: "调查员认为卷轴上的道歉与栽橡树的承诺属实。",
    entities: [],
    occurred_turn: 1,
    valid_from_turn: 1,
  }],
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.resolve = (value) => {
    resolve(value);
    return promise;
  };
  promise.reject = (error) => {
    reject(error);
    return promise;
  };
  return promise;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

// The gateway tool result wraps the canonical envelope as one JSON text part.
const unwrapEnvelope = (toolResult) => {
  const content = toolResult?.content;
  const text = Array.isArray(content) && content[0]?.type === "text"
    ? content[0].text
    : null;
  assert.ok(text, "gateway returned a text tool result");
  return JSON.parse(text);
};

const fakeChildRun = ({ completion, activation }) => {
  void completion.catch(() => {});
  return {
    activation: activation ?? Promise.resolve({ type: "agent_start" }),
    completion,
    child: { killed: false },
    terminate: async () => {},
  };
};

const childRunFromResult = (resultValue) => fakeChildRun({
  completion: Promise.resolve([{
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify(resultValue) }],
    },
  }]),
});

const extractorEvents = (job) => [{
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: JSON.stringify({ job_id: job, candidates: [] }) }],
  },
}];

const sleep = (milliseconds) => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, milliseconds);
});

async function waitFor(predicate, label, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(20);
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function extractionRefs(turn) {
  return {
    campaign_id: campaignId,
    job_id: `extract-${campaignId}-${timelineId}-turn-${turn}`,
    episode_id: `episode-${campaignId}-${timelineId}-turn-${turn}`,
    timeline_id: timelineId,
    turn_number: turn,
    backlog_id: `backlog-${campaignId}-t${turn}-extract`,
  };
}

function packetFor(refs) {
  return {
    job_id: refs.job_id,
    episode_id: refs.episode_id,
    campaign_id: refs.campaign_id,
    timeline_id: refs.timeline_id,
    turn_number: refs.turn_number,
    subjects_present: [],
    entities: [],
    result_contract: {
      ...structuredClone(extractorPacket.result_contract),
      id_prefix: `mem-${refs.campaign_id}-t${refs.turn_number}-c`,
    },
  };
}

function queueHarness() {
  const audits = [];
  const bridgeCalls = [];
  const launches = [];
  const completions = [];
  const refsByBacklog = new Map();
  const dispatcher = new MemoryExtractionDispatcher();
  dispatcher.start({
    isCurrent: () => true,
    workspaceRoot: () => root,
    launchContext: () => ({
      cwd: root,
      provider: "probe",
      modelId: "probe",
      thinking: "off",
    }),
    launchExtractor: (task) => {
      const completion = deferred();
      launches.push(task.packet.job_id);
      completions.push(completion);
      return fakeChildRun({ completion });
    },
    runHostBridge: async (request) => {
      bridgeCalls.push(structuredClone(request));
      if (request.command === "prepare") {
        const refs = refsByBacklog.get(request.backlog_id);
        assert.ok(refs, `prepare has known backlog ${request.backlog_id}`);
        return {
          status: "ready",
          backlog_id: refs.backlog_id,
          job_id: refs.job_id,
          packet: packetFor(refs),
          read: { rendered_text: renderedText },
        };
      }
      if (request.command === "apply") {
        return {
          status: "applied",
          job_id: request.result.job_id,
          backlog_id: request.backlog_id,
          backlog_status: "recovered",
          applied: request.result.candidates.length,
        };
      }
      if (request.command === "record_failure") {
        return {
          status: "failure_recorded",
          backlog_id: request.backlog_id,
          backlog_status: "pending",
        };
      }
      throw new Error(`unexpected bridge command ${request.command}`);
    },
    appendAudit: (entry) => audits.push(entry),
  });
  return {
    dispatcher,
    audits,
    bridgeCalls,
    launches,
    completions,
    register(refs) {
      refsByBacklog.set(refs.backlog_id, refs);
    },
  };
}

function makeHarness({
  startupCampaignId = null,
  statusEntries = [],
} = {}) {
  const audits = [];
  const clientCalls = [];
  const bridgeCalls = [];
  const extractorTasks = [];
  let prepareGate = null;
  let bridgeResponder = null;
  let extractorCompletion = null;

  const tools = new Map();
  const handlers = new Map();
  const fakePi = {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const registered = handlers.get(type) || [];
      registered.push(handler);
      handlers.set(type, registered);
    },
    appendEntry(name, value) {
      audits.push({ name, value });
    },
    sendMessage() {},
    setActiveTools() {},
    getThinkingLevel: () => "off",
  };
  const callTool = async (name, params) => {
    clientCalls.push({ name, params });
    const operation = String(params.operation || "");
    if (operation === "session.resume") return structuredClone(sessionResumeEnvelope);
    if (operation === "state.journal") return structuredClone(journalEnvelope);
    if (operation === "turn.finalize") return finalizeEnvelope();
    if (operation === "memory.extraction_status") {
      return extractionStatusEnvelope(
        typeof statusEntries === "function" ? statusEntries() : statusEntries,
      );
    }
    return { ok: true, tool: operation, data: { schema_version: 1 } };
  };
  main.default(fakePi, {
    coordinatorEnabled: () => false,
    startupCampaignId: () => startupCampaignId,
    createClient: () => ({
      callTool,
      callToolWithTransportMeta: async (name, params) => ({
        value: await callTool(name, params),
        transport: null,
      }),
      async close() {},
    }),
    launchMemoryExtractor: (task) => {
      extractorTasks.push(task);
      if (extractorCompletion !== null) return extractorCompletion();
      return childRunFromResult(extractorResult);
    },
    runMemoryHostBridge: async (request) => {
      bridgeCalls.push(structuredClone(request));
      if (bridgeResponder !== null) return bridgeResponder(request);
      if (request.command === "apply") {
        return {
          status: "applied",
          job_id: request.result.job_id,
          backlog_id: request.backlog_id,
          backlog_status: "recovered",
          applied: request.result.candidates.length,
        };
      }
      if (request.command === "record_failure") {
        return {
          status: "failure_recorded",
          backlog_id: request.backlog_id,
          backlog_status: "pending",
          error_kind: request.error_kind,
        };
      }
      // prepare: hold the promise open so tests control completion timing.
      prepareGate = deferred();
      return prepareGate;
    },
  });
  const ctx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "probe", id: "probe" },
    sessionManager: {
      getSessionId: () => "async-memory-extraction-probe",
      getEntries: () => [],
    },
    hasUI: false,
  };
  const invoke = (id, params) => tools.get("coc_invoke").execute(
    id,
    params,
    undefined,
    undefined,
    ctx,
  );
  return {
    audits,
    clientCalls,
    bridgeCalls,
    extractorTasks,
    invoke,
    ctx,
    handlers,
    setBridgeResponder: (responder) => {
      bridgeResponder = responder;
    },
    setExtractorCompletion: (factory) => {
      extractorCompletion = factory;
    },
    takePrepareGate: () => {
      const gate = prepareGate;
      assert.ok(gate, "expected a held prepare gate");
      prepareGate = null;
      return gate;
    },
  };
}

async function startSessionToFinalize(h) {
  for (const handler of h.handlers.get("session_start") || []) {
    await handler({ type: "session_start", reason: "probe" }, h.ctx);
  }
  await h.invoke("resume-live-fixture", {
    operation: "session.resume",
    campaign: campaignId,
    arguments: {},
  });
  for (const handler of h.handlers.get("message_start") || []) {
    await handler({
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text: "异步记忆钩子探针。" }],
        timestamp: 300,
      },
    }, h.ctx);
  }
  await h.invoke("journal-live-fixture", {
    operation: "state.journal",
    campaign: campaignId,
    arguments: {},
  });
}

const finalizeCall = (id) => ({
  operation: "turn.finalize",
  campaign: campaignId,
  arguments: structuredClone(finalizeArguments),
});

// ---------------------------------------------------------------------------
// 1. Latency contract: rendered_text returns while extraction is held open;
//    completion then applies validated candidates without touching the
//    player envelope or any state/rules surface.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  await startSessionToFinalize(h);
  // Resume-triggered re-arm ran against an empty pending backlog: no traffic.
  assert.equal(h.bridgeCalls.length, 0);

  const finalizePromise = h.invoke("finalize-live-fixture", finalizeCall("f1"));
  // The dispatcher reached the durable prepare step asynchronously.
  await flush();
  assert.equal(h.bridgeCalls.length, 1, "prepare scheduled exactly once");
  assert.equal(h.bridgeCalls[0].command, "prepare");
  const heldPrepare = h.takePrepareGate();

  // The player envelope returns while extraction is still held open.
  const finalizeResult = unwrapEnvelope(await finalizePromise);
  const envelopeText = JSON.stringify(finalizeResult);
  assert.ok(envelopeText.includes("你接过那份蜡封卷轴"), "rendered_text delivered");
  assert.equal(
    finalizeResult.data.memory_extraction.job_id,
    jobId,
    "finalize evidence intact",
  );
  assert.equal(h.extractorTasks.length, 0, "extractor not launched yet");
  assert.equal(
    h.clientCalls.filter(
      (call) => call.params.operation === "memory.extraction_status",
    ).length,
    1,
    "exactly one re-arm probe (the successful session.resume boundary)",
  );

  // Release completion: prepare → extractor child → deterministic apply.
  heldPrepare.resolve({
    status: "ready",
    backlog_id: backlogId,
    job_id: jobId,
    packet: structuredClone(extractorPacket),
    read: { rendered_text: renderedText },
  });
  await flush();
  await flush();
  assert.equal(h.extractorTasks.length, 1, "extractor launched after prepare");
  const task = h.extractorTasks[0];
  assert.equal(task.contract_id, "coc.memory-extractor.v1");
  const packetText = JSON.stringify(task.packet);
  assert.ok(!packetText.includes("sha256:"), "packet carries no machine digest values");
  assert.ok(!packetText.includes("finalization_id"), "packet carries no receipt values");
  // Contract metadata may name forbidden fields (e.g. source_commit), but
  // the full model-visible task has no digest/provenance value or digest key.
  assert.deepEqual(Object.keys(task.read), ["rendered_text"]);
  const modelTaskText = JSON.stringify(task);
  assert.ok(!modelTaskText.includes("rendered_text_sha256"));
  assert.ok(!modelTaskText.includes("sha256:"));
  assert.equal(task.read.rendered_text, renderedText);

  await flush();
  await flush();
  const applyCall = h.bridgeCalls.find((call) => call.command === "apply");
  assert.ok(applyCall, "apply called after extractor completion");
  assert.equal(applyCall.campaign_id, campaignId);
  assert.equal(applyCall.backlog_id, backlogId);
  assert.equal(applyCall.result.job_id, jobId);
  assert.equal(applyCall.result.candidates.length, 1);
  assert.ok(
    !JSON.stringify(applyCall).includes("source_commit"),
    "host owns provenance; producer result carries none",
  );
  assert.ok(
    h.audits.some(({ name, value }) => (
      name === "coc-memory-extraction-async" && value.status === "applied"
    )),
    "completion audited",
  );
  // No audit entry ever carries the rendered table text.
  for (const { name, value } of h.audits) {
    assert.ok(
      !JSON.stringify(value).includes("你接过那份蜡封卷轴"),
      `audit ${name} never carries the rendered table text`,
    );
  }
  // The worker never drove state/rules writes through the client.
  for (const call of h.clientCalls) {
    const operation = String(call.params.operation || "");
    assert.ok(
      !operation.startsWith("state.") || operation === "state.journal",
      `background hook drove unexpected canonical operation ${operation}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Duplicate finalize / duplicate hook while live: one worker, deduped.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  for (const handler of h.handlers.get("session_start") || []) {
    await handler({ type: "session_start", reason: "probe" }, h.ctx);
  }
  const dispatcher = new MemoryExtractionDispatcher();
  dispatcher.start({
    isCurrent: () => true,
    workspaceRoot: () => root,
    launchContext: () => null,
    launchExtractor: () => {
      throw new Error("no extractor expected in dedupe probe");
    },
    runHostBridge: async (request, signal) => {
      h.bridgeCalls.push(request);
      return new Promise((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new Error("bridge aborted")),
          { once: true },
        );
      });
    },
    appendAudit: (entry) => h.audits.push({ name: "coc-memory-extraction-async", value: entry }),
  });
  const first = main.__test.autoDispatchPiMemoryExtraction(
    dispatcher,
    { operation: "turn.finalize", campaign: campaignId },
    finalizeEnvelope(),
    () => true,
  );
  await flush();
  assert.equal(
    h.bridgeCalls.filter((call) => call.command === "prepare").length,
    1,
    "first hook schedules one worker",
  );
  const second = main.__test.autoDispatchPiMemoryExtraction(
    dispatcher,
    { operation: "turn.finalize", campaign: campaignId },
    finalizeEnvelope(),
    () => true,
  );
  await second;
  await flush();
  assert.equal(
    h.bridgeCalls.filter((call) => call.command === "prepare").length,
    1,
    "duplicate finalize schedules no second worker",
  );
  assert.ok(
    h.audits.some(({ value }) => value.status === "deduped"),
    "live dedupe audited",
  );
  await dispatcher.shutdown();
  await first;
}

// ---------------------------------------------------------------------------
// 3. Terminal child failure → recoverable pending, next turn unblocked.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  await startSessionToFinalize(h);
  h.setExtractorCompletion(() => fakeChildRun({
    completion: Promise.reject(new Error("provider outage injected")),
  }));
  const finalizePromise = h.invoke("finalize-live-fixture", finalizeCall("f3"));
  await flush();
  h.takePrepareGate().resolve({
    status: "ready",
    backlog_id: backlogId,
    job_id: jobId,
    packet: structuredClone(extractorPacket),
    read: { rendered_text: renderedText },
  });
  const finalizeResult = unwrapEnvelope(await finalizePromise);
  assert.ok(finalizeResult.ok === true, "player envelope unaffected by failure");
  await flush();
  await flush();
  const failureCall = h.bridgeCalls.find((call) => call.command === "record_failure");
  assert.ok(failureCall, "terminal failure recorded");
  assert.equal(failureCall.error_kind, "producer_unavailable");
  assert.equal(failureCall.backlog_id, backlogId);
  assert.ok(
    h.audits.some(({ value }) => value.status === "failed"),
    "failure audited (hidden host status)",
  );
  assert.equal(
    h.bridgeCalls.filter((call) => call.command === "apply").length,
    0,
    "no apply after terminal child failure",
  );
}

// ---------------------------------------------------------------------------
// 3b. Malformed agent result → invalid_result, never persisted.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  await startSessionToFinalize(h);
  h.setExtractorCompletion(() => childRunFromResult({
    job_id: jobId,
    candidates: [{
      assertion_id: "mem-hoyk-pi-grok-fix7-20260727-t1-c1",
      kind: "belief",
      privacy: "player_safe",
      state: "accurate",
      statement: "缺少 subject_id 的伪造断言。",
      valid_from_turn: 1,
      source_commit: "f".repeat(40),
    }],
  }));
  const finalizePromise = h.invoke("finalize-live-fixture", finalizeCall("f3b"));
  await flush();
  h.takePrepareGate().resolve({
    status: "ready",
    backlog_id: backlogId,
    job_id: jobId,
    packet: structuredClone(extractorPacket),
    read: { rendered_text: renderedText },
  });
  const finalizeResult = unwrapEnvelope(await finalizePromise);
  assert.ok(finalizeResult.ok === true);
  await flush();
  await flush();
  const failureCall = h.bridgeCalls.find((call) => call.command === "record_failure");
  assert.ok(failureCall, "malformed result recorded");
  assert.equal(failureCall.error_kind, "invalid_result");
  assert.equal(
    h.bridgeCalls.filter((call) => call.command === "apply").length,
    0,
    "malformed result never reaches apply",
  );
}

// ---------------------------------------------------------------------------
// 3c. Prepare skip (already recovered row) → no extractor launched.
// ---------------------------------------------------------------------------
{
  const h = makeHarness();
  await startSessionToFinalize(h);
  h.setBridgeResponder(() => ({
    status: "skipped",
    reason: "backlog_not_pending",
    backlog_id: backlogId,
    backlog_status: "recovered",
  }));
  const finalizeResult = unwrapEnvelope(await h.invoke("finalize-live-fixture", finalizeCall("f3c")));
  assert.ok(finalizeResult.ok === true);
  await flush();
  await flush();
  assert.equal(h.extractorTasks.length, 0, "recovered row launches no extractor");
  assert.ok(
    h.audits.some(({ value }) => value.status === "skipped"),
    "skip audited",
  );
}

// ---------------------------------------------------------------------------
// 4. Restart / session-start re-arm: pending rows scheduled exactly once,
//    non-pending rows never scheduled, no polling afterwards.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({
    startupCampaignId: campaignId,
    statusEntries: [
      {
        backlog_id: backlogId,
        timeline_id: timelineId,
        turn_number: 1,
        status: "pending",
      },
      {
        backlog_id: `backlog-${campaignId}-t2-extract`,
        timeline_id: timelineId,
        turn_number: 2,
        status: "recovered",
      },
    ],
  });
  for (const handler of h.handlers.get("session_start") || []) {
    await handler({ type: "session_start", reason: "probe" }, h.ctx);
  }
  await flush();
  await flush();
  const prepareCalls = h.bridgeCalls.filter((call) => call.command === "prepare");
  assert.equal(prepareCalls.length, 1, "exactly one pending row re-armed");
  assert.equal(prepareCalls[0].backlog_id, backlogId);
  assert.equal(prepareCalls[0].campaign_id, campaignId);
  const statusCalls = h.clientCalls.filter(
    (call) => call.params.operation === "memory.extraction_status",
  );
  assert.equal(statusCalls.length, 1, "one re-arm probe, no polling loop");
}

// ---------------------------------------------------------------------------
// 5. Production bridge transport: exact absolute uv resolution, request JSON
//    written and closed on stdin, strict parse/exit failures, and real child
//    process-group teardown on both abort and timeout.
// ---------------------------------------------------------------------------
{
  const command = memoryHostBridgeCommand();
  assert.ok(path.isAbsolute(command.command), "default uv command is absolute");
  assert.equal(command.command, resolveRequiredUvExecutable());
  assert.deepEqual(command.args.slice(0, 5), [
    "run", "--project", root, "--frozen", "python",
  ]);
  assert.ok(
    command.args.at(-1).endsWith("plugins/coc-keeper/scripts/coc_memory_extraction_host_apply.py"),
    "default command targets the private bridge",
  );

  const successProgram = `
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (request.command !== "transport_probe" || request.marker !== "stdin-closed") process.exit(7);
  process.stdout.write(JSON.stringify({ status: "ready", echo: request.marker }));
});`;
  const successBridge = defaultRunMemoryHostBridge(
    () => ({ command: process.execPath, args: ["-e", successProgram] }),
    () => root,
    { timeoutMs: 2_000 },
  );
  const success = await successBridge({
    command: "transport_probe",
    marker: "stdin-closed",
  });
  assert.deepEqual(success, { status: "ready", echo: "stdin-closed" });

  const invalidJsonBridge = defaultRunMemoryHostBridge(
    () => ({
      command: process.execPath,
      args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('not-json'))"],
    }),
    () => root,
    { timeoutMs: 2_000 },
  );
  await assert.rejects(
    invalidJsonBridge({ command: "parse_probe" }),
    /invalid JSON/,
    "bridge parser fails closed",
  );
  const exitBridge = defaultRunMemoryHostBridge(
    () => ({
      command: process.execPath,
      args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(7))"],
    }),
    () => root,
    { timeoutMs: 2_000 },
  );
  await assert.rejects(
    exitBridge({ command: "exit_probe" }),
    /exited 7/,
    "bridge nonzero exit fails closed",
  );

  const treeProgram = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fs.writeFileSync(process.argv.at(-1), String(descendant.pid));
  setInterval(() => {}, 1000);
});`;
  const temp = mkdtempSync(path.join(tmpdir(), "coc-memory-bridge-"));
  try {
    const abortMarker = path.join(temp, "abort-descendant.pid");
    const abortController = new AbortController();
    const abortBridge = defaultRunMemoryHostBridge(
      () => ({ command: process.execPath, args: ["-e", treeProgram, abortMarker] }),
      () => root,
      { timeoutMs: 5_000 },
    );
    const aborted = abortBridge({ command: "tree_abort" }, abortController.signal);
    await waitFor(() => existsSync(abortMarker), "abort bridge descendant marker");
    const abortPid = Number(readFileSync(abortMarker, "utf8"));
    assert.ok(Number.isInteger(abortPid) && abortPid > 0);
    abortController.abort();
    await assert.rejects(aborted, /aborted/);
    await waitFor(() => !processAlive(abortPid), "aborted bridge descendant exit");

    const timeoutMarker = path.join(temp, "timeout-descendant.pid");
    const timeoutBridge = defaultRunMemoryHostBridge(
      () => ({ command: process.execPath, args: ["-e", treeProgram, timeoutMarker] }),
      () => root,
      { timeoutMs: 1_000 },
    );
    const timedOut = timeoutBridge({ command: "tree_timeout" });
    await waitFor(() => existsSync(timeoutMarker), "timeout bridge descendant marker");
    const timeoutPid = Number(readFileSync(timeoutMarker, "utf8"));
    assert.ok(Number.isInteger(timeoutPid) && timeoutPid > 0);
    await assert.rejects(timedOut, /timed out after 1000ms/);
    await waitFor(() => !processAlive(timeoutPid), "timed-out bridge descendant exit");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 6. Real dispatcher FIFO: one active + eight executable entries; duplicate
//    identities never launch twice; a terminal failure starts the next; the
//    staged durable tenth item refills only after a terminal slot opens.
// ---------------------------------------------------------------------------
{
  const q = queueHarness();
  const direct = Array.from({ length: 10 }, (_, index) => extractionRefs(index + 1));
  for (const refs of direct) q.register(refs);
  const settlements = direct.map((refs) => q.dispatcher.schedule(refs));
  const duplicate = q.dispatcher.schedule(direct[1]);
  await waitFor(() => q.launches.length === 1, "first FIFO launch");
  assert.equal(q.dispatcher.liveKeys().length, 9, "one active plus eight executable queued");
  assert.deepEqual(q.launches, [direct[0].job_id]);
  assert.ok(q.audits.some((entry) => entry.status === "deduped"), "queued duplicate deduped");

  // A failed active child still releases a slot and starts the next entry.
  q.completions[0].reject(new Error("injected extractor failure"));
  await waitFor(() => q.launches.length === 2, "next FIFO launch after failure");
  assert.equal(q.launches[1], direct[1].job_id);
  assert.ok(q.dispatcher.liveKeys().length <= 9, "execution bound holds after failure");
  for (let index = 1; index < direct.length; index += 1) {
    await waitFor(() => q.completions.length > index, `completion ${index + 1}`);
    q.completions[index].resolve(extractorEvents(direct[index].job_id));
    if (index < direct.length - 1) {
      await waitFor(() => q.launches.length >= index + 2, `FIFO launch ${index + 2}`);
      assert.ok(q.dispatcher.liveKeys().length <= 9, "execution queue never exceeds nine");
    }
  }
  await Promise.all([...settlements, duplicate]);
  assert.deepEqual(q.launches, direct.map((refs) => refs.job_id), "FIFO order preserved");
  assert.ok(
    q.bridgeCalls.some((call) => call.command === "record_failure"),
    "terminal child failure remains a pending host failure record",
  );
  await q.dispatcher.shutdown();
}

// ---------------------------------------------------------------------------
// 7. A >9 pending restart/session.resume snapshot drains event-driven after
//    completions. No additional status probe or polling loop is involved.
// ---------------------------------------------------------------------------
{
  const q = queueHarness();
  const refs = Array.from({ length: 12 }, (_, index) => extractionRefs(index + 1));
  for (const item of refs) q.register(item);
  q.dispatcher.rearm(campaignId, refs.map((item) => ({
    backlog_id: item.backlog_id,
    timeline_id: item.timeline_id,
    turn_number: item.turn_number,
    status: "pending",
  })));
  await waitFor(() => q.launches.length === 1, "first re-armed FIFO launch");
  assert.equal(q.dispatcher.liveKeys().length, 9, "re-arm initially fills bounded executor only");
  for (let index = 0; index < refs.length; index += 1) {
    await waitFor(() => q.completions.length > index, `re-arm completion ${index + 1}`);
    q.completions[index].resolve(extractorEvents(refs[index].job_id));
    if (index < refs.length - 1) {
      await waitFor(() => q.launches.length >= index + 2, `re-arm FIFO launch ${index + 2}`);
      assert.ok(q.dispatcher.liveKeys().length <= 9, "re-arm executor remains bounded");
    }
  }
  await flush();
  assert.deepEqual(q.launches, refs.map((item) => item.job_id));
  assert.equal(
    q.bridgeCalls.filter((call) => call.command === "prepare").length,
    12,
    "all durable pending rows drained without another re-arm/poll",
  );
  await q.dispatcher.shutdown();
}

console.log("async-memory-extraction: all latency/lifecycle/privacy pins hold");
