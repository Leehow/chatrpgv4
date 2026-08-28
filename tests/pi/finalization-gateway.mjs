// Real Pi gateway/transcript regression for the canonical
// turn.finalize string digest used by the live FIX7 receipt.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const root = path.resolve(process.argv[2] || process.cwd());
process.env.COC_PI_SESSION_ROLE = "play";
const dependencyRoot = path.resolve(process.env.PI_TEST_REPO_ROOT || root);
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const { runAgentLoop } = await import(
  embeddedPiFile(dependencyRoot, "pi-agent-core", "dist/index.js")
);
const { createAssistantMessageEventStream } = await import(
  embeddedPiFile(dependencyRoot, "pi-ai", "dist/index.js")
);

const renderedText = `你接过那份蜡封卷轴，先在指间细细掂量。火漆完好，压痕清晰，盖的是伯尼菲斯大人惯用的印章；卷轴外签写着德里克斯地长老西尔·灰须之名，并无错讹。文书本身是正式的道歉，并承诺来年春天在原处重栽一棵新橡树——与大人方才口述的使命一致。

【明骰】初印象·伯尼菲斯大人｜外貌 50 / 信用评级 25；采用外貌 50｜掷骰：95；基础值：50；门槛：普通（≤50）；达到：失败；未通过

你向伯尼菲斯大人简要复述：立刻携此文书前往德里克斯地，面见西尔·灰须，为砍伐圣橡一事修好关系。大人听你复述时只匆匆点头，目光已飘向更衣室方向，语气简短确认后便挥手让你上路，再不多添一句叮嘱。

你行礼领命，披上冬斗篷，将卷轴妥帖收好，踏出谢尔伯恩城堡。雪路在晴冷的天光下延伸，积雪约有两英尺深，一步一陷；约两小时后，你抵达德里克斯地外缘。村舍轮廓在白茫茫的原野尽头隐约可见，寒风贴着斗篷掠过。

文书仍在身侧。下一步，是进村寻访长老，还是先在村外观察一番？`;
const renderedSha256 =
  "sha256:09f98a4af3dd62654cff7d27c7adc1fac2224955463f8457eba953b44767a806";
const sha256 = (value) => (
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`
);
const canonicalDigest = sha256(JSON.stringify(renderedText));
const rawDigest = sha256(renderedText);
const finalizationArguments = {
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

const finalizeEnvelope = {
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

const tools = new Map();
const handlers = new Map();
const clientCalls = [];
let clientEnvelope = finalizeEnvelope;
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
  appendEntry() {},
  sendMessage() {},
  setActiveTools() {},
  getThinkingLevel: () => "off",
};
main.default(fakePi, {
  coordinatorEnabled: () => false,
  startupCampaignId: () => null,
  createClient: () => {
    const callTool = async (name, params) => {
      clientCalls.push({ name, params });
      return clientEnvelope;
    };
    return {
      callTool,
      callToolWithTransportMeta: async (name, params) => ({
        value: await callTool(name, params),
        transport: null,
      }),
      async close() {},
    };
  },
});
const ctx = {
  cwd: root,
  mode: "rpc",
  model: { provider: "probe", id: "probe" },
  sessionManager: {
    getSessionId: () => "finalization-gateway-probe",
    getEntries: () => [],
  },
  hasUI: false,
};

for (const handler of handlers.get("session_start") || []) {
  await handler({ type: "session_start", reason: "probe" }, ctx);
}
clientEnvelope = {
  ok: true,
  tool: "session.resume",
  data: {
    schema_version: 1,
    campaign_id: "hoyk-pi-grok-fix7-20260727",
    mode: "awaiting_player",
    next_operations: [],
  },
};
await tools.get("coc_invoke").execute(
  "resume-live-fixture",
  {
    operation: "session.resume",
    campaign: "hoyk-pi-grok-fix7-20260727",
    arguments: {},
  },
  undefined,
  undefined,
  ctx,
);

for (const handler of handlers.get("message_start") || []) {
  await handler({
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "执行真实终态网关探针。" }],
      timestamp: 300,
    },
  }, ctx);
}
clientEnvelope = {
  ok: true,
  tool: "state.journal",
  data: { turn_id: "turn-finalization-gateway-1" },
};
await tools.get("coc_invoke").execute(
  "journal-live-fixture",
  {
    operation: "state.journal",
    campaign: "hoyk-pi-grok-fix7-20260727",
    arguments: {},
  },
  undefined,
  undefined,
  ctx,
);
clientEnvelope = finalizeEnvelope;
const gatewayResult = await tools.get("coc_invoke").execute(
  "finalize-live-fixture",
  {
    operation: "turn.finalize",
    campaign: "hoyk-pi-grok-fix7-20260727",
    arguments: finalizationArguments,
  },
  undefined,
  undefined,
  ctx,
);

const queuedOlderHostDetails = {
  continuation_class: "nonblocking_background_after_finalized_output",
  dispatch_class: "nonblocking_background",
  player_turn_epoch: 1,
  finalized_rendered_sha256: renderedSha256,
  dispatch_key: "coord-live-finalizer-backstop",
};
const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
};
const base = {
  role: "assistant",
  api: "openai-responses",
  provider: "probe",
  model: "probe",
  usage,
  stopReason: "stop",
  timestamp: 301,
};
const responses = [
  { ...base, content: [{ type: "text", text: renderedText }] },
  {
    ...base,
    content: [{ type: "text", text: "不应出现的旧主机冗余提示。" }],
    timestamp: 302,
  },
];
let responseIndex = 0;
let queued = false;
const finals = [];
const eventTrace = [];
const streamFn = () => {
  const stream = createAssistantMessageEventStream();
  const finalMessage = responses[responseIndex++];
  queueMicrotask(() => {
    stream.push({ type: "start", partial: { ...finalMessage, content: [] } });
    stream.push({ type: "done", message: finalMessage });
  });
  return stream;
};
await runAgentLoop(
  [{
    role: "custom",
    customType: "gateway-finalization-probe",
    content: "continue",
    display: false,
    timestamp: 303,
  }],
  { systemPrompt: "probe", messages: [], tools: [] },
  {
    model: {
      id: "probe", name: "probe", provider: "probe",
      api: "openai-responses", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000, maxTokens: 100,
    },
    convertToLlm: (messages) => messages,
    getFollowUpMessages() {
      if (!queued && responseIndex === 1) {
        queued = true;
        return [{
          role: "custom",
          customType: "coc-source-coordinator-terminal-continuation",
          content: JSON.stringify(queuedOlderHostDetails),
          details: queuedOlderHostDetails,
          display: false,
          timestamp: 304,
        }];
      }
      return [];
    },
  },
  async (event) => {
    eventTrace.push(`${event.type}:${event.message?.role ?? "none"}:${
      event.message?.customType ?? ""
    }`);
    let transformed;
    for (const handler of handlers.get(event.type) || []) {
      transformed = await handler(event, ctx);
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      finals.push(transformed?.message ?? event.message);
    }
  },
  undefined,
  streamFn,
);

const emit = async (type, message) => {
  let transformed;
  for (const handler of handlers.get(type) || []) {
    transformed = await handler({ type, message }, ctx);
  }
  return transformed;
};
await emit("message_start", {
  role: "user",
  content: [{ type: "text", text: "执行原始 UTF-8 摘要拒绝探针。" }],
  timestamp: 305,
});
clientEnvelope = {
  ok: true,
  tool: "state.journal",
  data: { turn_id: "turn-finalization-gateway-2" },
};
await tools.get("coc_invoke").execute(
  "journal-raw-digest-fixture",
  {
    operation: "state.journal",
    campaign: "hoyk-pi-grok-fix7-20260727",
    arguments: {},
  },
  undefined,
  undefined,
  ctx,
);
clientEnvelope = {
  ...finalizeEnvelope,
  data: {
    ...finalizeEnvelope.data,
    rendered_text_sha256: rawDigest,
  },
};
const rawGatewayResult = await tools.get("coc_invoke").execute(
  "finalize-raw-digest-fixture",
  {
    operation: "turn.finalize",
    campaign: "hoyk-pi-grok-fix7-20260727",
    arguments: finalizationArguments,
  },
  undefined,
  undefined,
  ctx,
);
const rawExactResult = await emit("message_end", {
  ...base,
  content: [{ type: "text", text: renderedText }],
  timestamp: 306,
});
await emit("message_start", {
  role: "custom",
  customType: "coc-source-coordinator-terminal-continuation",
  content: "raw digest continuation",
  details: {
    ...queuedOlderHostDetails,
    player_turn_epoch: 2,
    finalized_rendered_sha256: rawDigest,
    dispatch_key: "coord-raw-digest-rejected",
  },
  display: false,
  timestamp: 307,
});
const rawFollowUpResult = await emit("message_end", {
  ...base,
  content: [{ type: "text", text: "原始摘要后续必须保持可见。" }],
  timestamp: 308,
});

const types = (message) => message.content.map((part) => part.type);
const returnedEnvelope = JSON.parse(gatewayResult.content[0].text);
const rawReturnedEnvelope = JSON.parse(rawGatewayResult.content[0].text);
assert.equal(returnedEnvelope.ok, true);
assert.equal(returnedEnvelope.tool, "turn.finalize");
assert.equal(returnedEnvelope.wire?.canonical_operation, "turn.finalize");
assert.equal(returnedEnvelope.data?.rendered_text, renderedText);
assert.equal(returnedEnvelope.data?.rendered_text_sha256, renderedSha256);
assert.equal(canonicalDigest, renderedSha256);
assert.notEqual(rawDigest, renderedSha256);
assert.equal(finals.length, 2);
assert.equal(
  finals[0].content.find((part) => part.type === "text")?.text,
  renderedText,
);
assert.deepEqual(types(finals[1]), []);
assert.ok(eventTrace.includes(
  "message_start:custom:coc-source-coordinator-terminal-continuation",
));
assert.equal(rawReturnedEnvelope.ok, false);
assert.equal(rawReturnedEnvelope.isError, true);
assert.equal(rawReturnedEnvelope.error?.code, "finalization_receipt_invalid");
assert.equal(rawExactResult === undefined, false);
assert.equal(rawFollowUpResult === undefined, false);
// ---------------------------------------------------------------------------
// Exact-delivery replay probes (attempt-05): a fresh play host process binds
// the machine-owned delivery identity from session.resume.delivery (restart),
// the typed semantic-only call streams every canonical chunk byte-for-byte as
// player-visible coc_delivery_replay events, the host acknowledges the
// replay, the same-epoch quarantine rejects state/rules/finalize calls and
// suppresses model prose, and ordinary context mode stays byte-unchanged.
// ---------------------------------------------------------------------------
const ATTEMPT05_CANONICAL_TEXT = (
  "林默仍站在门槛外，借窄缝把目光压低，一寸寸扫过近处地板与能看见的墙角。"
  + "昏黄灯下，那一片地砖干净，没有血迹，也没有蜷伏或倒卧的轮廓；角落里没有"
  + "拖曳的痕迹，也没有突然一闪而过的动静。\n\n"
  + "【明骰】侦查｜掷骰：23；基础值：51；门槛：普通（≤51）；达到：困难成功（超出 1 级）；通过\n\n"
  + "他压低嗓子，对着门缝轻唤一声：「考夫特？」回声在门后短促地散开，仍无人应。"
);
assert.equal([...ATTEMPT05_CANONICAL_TEXT].length, 179);
assert.equal(Buffer.byteLength(ATTEMPT05_CANONICAL_TEXT, "utf8"), 511);
const ATTEMPT05_CAMPAIGN = "attempt05-replay-campaign";
const ATTEMPT05_FINALIZATION_ID = "turn-effect-v1:attempt05-replay-probe";
const ATTEMPT05_SHA = sha256(JSON.stringify(ATTEMPT05_CANONICAL_TEXT));

// Python _utf8_chunk_end port: chunk ends never split a UTF-8 code point.
function utf8ChunkEnd(data, start, limit) {
  let end = Math.min(start + limit, data.length);
  if (end < data.length) {
    while (end > start && (data[end] & 0xC0) === 0x80) end -= 1;
    if (end === start) {
      end = start + 1;
      while (end < data.length && (data[end] & 0xC0) === 0x80) end += 1;
    }
  }
  return end;
}

function attempt05ReplayServer(chunkLimit) {
  const data = Buffer.from(ATTEMPT05_CANONICAL_TEXT, "utf8");
  const chunks = [];
  let position = 0;
  while (position < data.length) {
    const end = utf8ChunkEnd(data, position, chunkLimit);
    chunks.push([position, end]);
    position = end;
  }
  const acks = [];
  const chunkRequests = [];
  // The mock models the canonical latest delivery as already
  // confirmed/displayed (attempt-05): replay must still serve it, and the
  // first replay request must establish identity from the canonical side.
  const firstIdentity = { finalization_id: "", rendered_sha256: "" };
  let firstRequestObserved = false;
  const chunkEnvelope = (index) => {
    const [start, end] = chunks[index];
    return {
      ok: true,
      tool: "session.delivery_text",
      data: {
        mode: "replay",
        finalization_id: ATTEMPT05_FINALIZATION_ID,
        rendered_sha256: ATTEMPT05_SHA,
        rendered_text_sha256: ATTEMPT05_SHA,
        text: data.subarray(start, end).toString("utf8"),
        text_offset: start,
        returned_bytes: end - start,
        total_bytes: data.length,
        chunk_ordinal: index,
        chunk_count: chunks.length,
        final: index === chunks.length - 1,
        next_offset: end < data.length ? end : null,
      },
    };
  };
  const serve = (params) => {
    if (params?.operation === "session.delivery_ack") {
      acks.push(params.arguments ?? {});
      return {
        ok: true,
        tool: "session.delivery_ack",
        data: {
          status: "confirmed",
          ack_kind: params.arguments?.ack_kind ?? null,
          idempotent_repeat: true,
        },
      };
    }
    if (params?.operation !== "session.delivery_text") {
      return { ok: false, error: { code: "probe_no_route" } };
    }
    const args = params.arguments ?? {};
    if (!firstRequestObserved) {
      // Fresh/no-arm contract: the first canonical replay request carries
      // ONLY the semantic mode — any identity/offset field is rejected.
      if (
        args.finalization_id !== undefined
        || args.rendered_sha256 !== undefined
        || args.text_offset !== undefined
      ) {
        return {
          ok: false,
          tool: "session.delivery_text",
          error: { code: "invalid_param" },
        };
      }
      if (args.mode !== "replay") {
        return { ok: false, tool: "session.delivery_text", error: { code: "invalid_param" } };
      }
      firstRequestObserved = true;
      firstIdentity.finalization_id = ATTEMPT05_FINALIZATION_ID;
      firstIdentity.rendered_sha256 = ATTEMPT05_SHA;
      return chunkEnvelope(0);
    }
    // Later chunks are machine-bound: they must carry exactly the identity
    // the canonical first response returned.
    if (args.finalization_id !== firstIdentity.finalization_id) {
      return { ok: false, tool: "session.delivery_text", error: { code: "delivery_conflict" } };
    }
    if (args.rendered_sha256 !== firstIdentity.rendered_sha256) {
      return { ok: false, tool: "session.delivery_text", error: { code: "delivery_conflict" } };
    }
    const index = chunks.findIndex(([start]) => start === args.text_offset);
    if (index === -1) {
      return { ok: false, tool: "session.delivery_text", error: { code: "invalid_param" } };
    }
    return chunkEnvelope(index);
  };
  const recordingServe = (params) => {
    const response = serve(params);
    if (params?.operation === "session.delivery_text" && response.ok === true) {
      chunkRequests.push(params.arguments ?? {});
    }
    return response;
  };
  return {
    serve: recordingServe,
    acks,
    firstIdentity,
    chunkCount: chunks.length,
    chunkRequests,
    latestStatus: "confirmed_displayed",
  };
}

async function bootReplayProbeHost() {
  const probeHandlers = new Map();
  const probeTools = new Map();
  const probeCalls = [];
  const probeSent = [];
  const probeEntries = [];
  let serveRpc = () => ({ ok: false, error: { code: "probe_no_route" } });
  const probePi = {
    registerTool: (tool) => probeTools.set(tool.name, tool),
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const registered = probeHandlers.get(type) || [];
      registered.push(handler);
      probeHandlers.set(type, registered);
    },
    appendEntry(type, details) {
      probeEntries.push({ type, details });
    },
    sendMessage(message, options) {
      probeSent.push({ message, options });
    },
    setActiveTools() {},
    getThinkingLevel: () => "off",
  };
  main.default(probePi, {
    coordinatorEnabled: () => false,
    startupCampaignId: () => null,
    createClient: () => ({
      callTool: async (name, params) => {
        probeCalls.push({ name, params });
        return serveRpc(params);
      },
      callToolWithTransportMeta: async (name, params) => ({
        value: await (async () => {
          probeCalls.push({ name, params });
          return serveRpc(params);
        })(),
        transport: null,
      }),
      async close() {},
    }),
  });
  const probeCtx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "probe", id: "probe" },
    sessionManager: {
      getSessionId: () => "delivery-replay-probe",
      getEntries: () => [],
    },
    hasUI: false,
  };
  for (const handler of probeHandlers.get("session_start") || []) {
    await handler({ type: "session_start", reason: "probe" }, probeCtx);
  }
  const emit = async (type, message) => {
    let transformed;
    for (const handler of probeHandlers.get(type) || []) {
      transformed = await handler({ type, message }, probeCtx);
    }
    return transformed;
  };
  const agentEnd = async () => {
    for (const handler of probeHandlers.get("agent_end") || []) {
      await handler({}, probeCtx);
    }
  };
  return {
    probeTools,
    probeCalls,
    probeSent,
    probeEntries,
    probeCtx,
    emit,
    agentEnd,
    setServe: (fn) => {
      serveRpc = fn;
    },
  };
}

const replayProbe = await bootReplayProbeHost();

// Fresh/no-arm phase advance ONLY: the resume envelope carries no delivery
// projection, so no identity reaches the lane before the first canonical
// replay response (attempt-05: latest output already confirmed/displayed).
const attempt05Resume = {
  ok: true,
  tool: "session.resume",
  data: {
    schema_version: 1,
    campaign_id: ATTEMPT05_CAMPAIGN,
    mode: "awaiting_player",
    next_operations: [],
  },
};
replayProbe.setServe(() => attempt05Resume);
await replayProbe.probeTools.get("coc_invoke").execute(
  "replay-resume-probe",
  { operation: "session.resume", campaign: ATTEMPT05_CAMPAIGN, arguments: {} },
  undefined,
  undefined,
  replayProbe.probeCtx,
);

// Ordinary context mode is untouched: explicit identity passes through the
// generic canonical path in exactly one call, no chunk loop, no stripping.
const contextCalls = [];
replayProbe.setServe((params) => {
  if (params?.operation === "session.delivery_text" && params.arguments?.mode === "context") {
    contextCalls.push(params);
    return {
      ok: true,
      tool: "session.delivery_text",
      data: {
        finalization_id: "ctx-fid",
        rendered_sha256: "ctx-sha",
        exact_text: "context text stays byte-identical",
      },
    };
  }
  return { ok: false, error: { code: "probe_no_route" } };
});
const contextGatewayResult = await replayProbe.probeTools.get("coc_invoke").execute(
  "replay-context-probe",
  {
    operation: "session.delivery_text",
    campaign: ATTEMPT05_CAMPAIGN,
    arguments: {
      mode: "context",
      finalization_id: "ctx-fid",
      rendered_sha256: "ctx-sha",
    },
  },
  undefined,
  undefined,
  replayProbe.probeCtx,
);
const contextEnvelope = JSON.parse(contextGatewayResult.content[0].text);
assert.equal(contextEnvelope.ok, true);
assert.equal(contextEnvelope.data?.exact_text, "context text stays byte-identical");
assert.equal(contextCalls.length, 1);
assert.deepEqual(contextCalls[0].arguments, {
  mode: "context",
  finalization_id: "ctx-fid",
  rendered_sha256: "ctx-sha",
});

// Multi-chunk exact replay through the typed semantic-only surface.
const server128 = attempt05ReplayServer(128);
replayProbe.setServe(server128.serve);
const replayGatewayResult = await replayProbe.probeTools.get(
  "coc_session_delivery_text",
).execute(
  "replay-typed-probe",
  { campaign: ATTEMPT05_CAMPAIGN, mode: "replay" },
  undefined,
  undefined,
  replayProbe.probeCtx,
);
const replayEnvelope = JSON.parse(replayGatewayResult.content[0].text);
const replayChunks = replayProbe.probeSent.filter((row) => (
  row.message?.customType === "coc_delivery_replay"
));
const replayJoined = replayChunks.map((row) => row.message.details.text).join("");
const replayDeliveryCalls = replayProbe.probeCalls.filter((row) => (
  row.params?.operation === "session.delivery_text"
  && row.params.arguments?.mode === "replay"
));
const replayReport = {
  plannedChunks: server128.chunkCount,
  emittedChunks: replayChunks.length,
  chars: [...replayJoined].length,
  bytes: Buffer.byteLength(replayJoined, "utf8"),
  exact: replayJoined === ATTEMPT05_CANONICAL_TEXT,
  whitespaceKept: replayJoined.includes("\n\n"),
  ordinals: replayChunks.map((row) => row.message.details.chunk_ordinal),
  finalFlags: replayChunks.map((row) => row.message.details.final === true),
  playerVisible: replayChunks.every((row) => row.message.display === true),
  schemaV1: replayChunks.every((row) => (
    row.message.details.schema_version === 1
    && row.message.details.kind === "coc_delivery_replay"
  )),
  identityBinding: {
    mockLatestStatus: server128.latestStatus,
    resumeCarriedDelivery: !("delivery" in attempt05Resume.data),
    firstRequestSemanticOnly: JSON.stringify(
      replayDeliveryCalls[0]?.params.arguments,
    ) === JSON.stringify({ mode: "replay" }),
    laterCallsBoundToFirstResponseIdentity: replayDeliveryCalls.slice(1).every((row) => (
      typeof row.params.arguments.text_offset === "number"
      && row.params.arguments.finalization_id
        === server128.firstIdentity.finalization_id
      && row.params.arguments.rendered_sha256
        === server128.firstIdentity.rendered_sha256
    )),
  },
  semanticResult: {
    ok: replayEnvelope.ok === true,
    mode: replayEnvelope.data?.mode,
    delivered: replayEnvelope.data?.delivered === true,
    chunkCount: replayEnvelope.data?.chunk_count,
    totalBytes: replayEnvelope.data?.total_bytes,
    opaqueFree: !/finalization_id|rendered_sha|text_offset|next_offset/.test(
      replayGatewayResult.content[0].text,
    ),
  },
  ack: {
    count: server128.acks.length,
    kind: server128.acks[0]?.ack_kind,
    finalizationId: server128.acks[0]?.finalization_id,
    renderedSha: server128.acks[0]?.rendered_sha256,
    semanticDecisionId: typeof server128.acks[0]?.decision_id === "string"
      && server128.acks[0].decision_id.startsWith("pi-session-delivery_ack:"),
  },
};
assert.equal(replayReport.plannedChunks > 1, true);
assert.equal(replayReport.emittedChunks, replayReport.plannedChunks);
assert.equal(replayReport.chars, 179);
assert.equal(replayReport.bytes, 511);
assert.equal(replayReport.exact, true);
assert.equal(replayReport.whitespaceKept, true);
assert.equal(replayReport.identityBinding.mockLatestStatus, "confirmed_displayed");
assert.equal(replayReport.identityBinding.resumeCarriedDelivery, true);
assert.equal(replayReport.identityBinding.firstRequestSemanticOnly, true);
assert.equal(replayReport.identityBinding.laterCallsBoundToFirstResponseIdentity, true);
assert.deepEqual(
  replayReport.ordinals,
  Array.from({ length: replayReport.emittedChunks }, (_, index) => index),
);
assert.deepEqual(replayReport.finalFlags, [
  ...Array.from({ length: replayReport.emittedChunks - 1 }, () => false),
  true,
]);
assert.equal(replayReport.playerVisible, true);
assert.equal(replayReport.schemaV1, true);
assert.equal(replayReport.identityBinding.firstRequestSemanticOnly, true);
assert.equal(replayReport.identityBinding.laterCallsBoundToFirstResponseIdentity, true);
assert.equal(replayReport.semanticResult.ok, true);
assert.equal(replayReport.semanticResult.mode, "replay");
assert.equal(replayReport.semanticResult.delivered, true);
assert.equal(replayReport.semanticResult.chunkCount, replayReport.emittedChunks);
assert.equal(replayReport.semanticResult.totalBytes, 511);
assert.equal(replayReport.semanticResult.opaqueFree, true);
assert.equal(replayReport.ack.count, 1);
assert.equal(replayReport.ack.kind, "replayed");
assert.equal(replayReport.ack.finalizationId, ATTEMPT05_FINALIZATION_ID);
assert.equal(replayReport.ack.renderedSha, ATTEMPT05_SHA);
assert.equal(replayReport.ack.semanticDecisionId, true);

// Same-epoch replay quarantine: state/rules/finalize calls are rejected
// host-side without reaching the canonical transport, and model prose is
// suppressed so the player receives only the exact replay stream.
const baseProbeAssistant = {
  role: "assistant",
  api: "openai-responses",
  provider: "probe",
  model: "probe",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  stopReason: "stop",
};
const quarantineRejections = {};
for (const operation of ["state.journal", "rules.roll", "turn.finalize", "narration.review"]) {
  const rejected = await replayProbe.probeTools.get("coc_invoke").execute(
    `replay-quarantine-${operation}`,
    { operation, campaign: ATTEMPT05_CAMPAIGN, arguments: {} },
    undefined,
    undefined,
    replayProbe.probeCtx,
  );
  const envelope = JSON.parse(rejected.content[0].text);
  quarantineRejections[operation] = envelope.error?.code ?? null;
}
assert.deepEqual(quarantineRejections, {
  "state.journal": "delivery_replay_owns_delivery",
  "rules.roll": "delivery_replay_owns_delivery",
  "turn.finalize": "delivery_replay_owns_delivery",
  "narration.review": "delivery_replay_owns_delivery",
});
assert.equal(
  replayProbe.probeCalls.some((row) => [
    "state.journal",
    "rules.roll",
    "turn.finalize",
    "narration.review",
  ].includes(row.params?.operation)),
  false,
);
const paraphraseSuppressed = await replayProbe.emit("message_end", {
  ...baseProbeAssistant,
  content: [{ type: "text", text: "这是模型附带的额外转述，必须被整段抑制。" }],
  timestamp: 401,
});
assert.equal(
  (paraphraseSuppressed?.message?.content ?? [])
    .some((part) => part.type === "text"),
  false,
);
const emptyFinalDuringQuarantine = await replayProbe.emit("message_end", {
  ...baseProbeAssistant,
  content: [],
  timestamp: 402,
});
assert.equal(
  (emptyFinalDuringQuarantine?.message?.content ?? [])
    .some((part) => part.type === "text"),
  false,
);
assert.equal(
  replayProbe.probeEntries.some((row) => String(row.type).includes("empty-terminal")),
  false,
);

// agent_end ends the quarantine: the next input gets the normal surface.
await replayProbe.agentEnd();
replayProbe.setServe((params) => params?.operation === "state.cash_query"
  ? { ok: true, tool: "state.cash_query", data: { probe: "post-quarantine" } }
  : { ok: false, error: { code: "probe_no_route" } });
const postQuarantineProbe = await replayProbe.probeTools.get("coc_invoke").execute(
  "post-quarantine-state",
  { operation: "state.cash_query", campaign: ATTEMPT05_CAMPAIGN, arguments: {} },
  undefined,
  undefined,
  replayProbe.probeCtx,
);
assert.equal(JSON.parse(postQuarantineProbe.content[0].text).ok, true);

// Canonical default chunking (511-byte text fits one bounded chunk) replays
// in a single final chunk with the same exact reassembly and ack contract.
const serverDefault = attempt05ReplayServer(4096);
replayProbe.setServe(serverDefault.serve);
await replayProbe.probeTools.get("coc_session_delivery_text").execute(
  "replay-single-chunk-probe",
  { campaign: ATTEMPT05_CAMPAIGN },
  undefined,
  undefined,
  replayProbe.probeCtx,
);
const singleChunks = replayProbe.probeSent.filter((row) => (
  row.message?.customType === "coc_delivery_replay"
)).slice(replayReport.emittedChunks);
const singleJoined = singleChunks.map((row) => row.message.details.text).join("");
assert.equal(singleChunks.length, 1);
assert.equal(singleChunks[0].message.details.final, true);
assert.equal(singleJoined === ATTEMPT05_CANONICAL_TEXT, true);
assert.equal(Buffer.byteLength(singleJoined, "utf8"), 511);
assert.equal(serverDefault.acks.length, 1);
assert.equal(serverDefault.acks[0].ack_kind, "replayed");
replayReport.singleChunk = {
  chunks: singleChunks.length,
  exact: singleJoined === ATTEMPT05_CANONICAL_TEXT,
  acked: serverDefault.acks[0].ack_kind,
};
// Fresh-process restart probe (attempt-05, honest): a brand-new Node
// process boots a brand-new extension instance with no arm/cache, its resume
// envelope carries no delivery projection, the canonical latest is already
// confirmed/displayed, and the mock rejects any identity field on the first
// replay request. All assertions run parent-side on the raw child report.
const freshRestartDir = mkdtempSync(path.join(tmpdir(), "pi-fresh-replay-"));
const childPath = path.join(freshRestartDir, "fresh-replay-child.mjs");
const childSource = `// generated by tests/pi/finalization-gateway.mjs
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
await import(${JSON.stringify(pathToFileURL(path.join(root, "tests/pi/_lib/preload-embedded-pi.mjs")).href)});
const main = await import(pathToFileURL(${JSON.stringify(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"))}).href);
const ROOT = process.argv[2];
const CANONICAL = ${JSON.stringify(ATTEMPT05_CANONICAL_TEXT)};
const sha256 = (value) => (
  "sha256:" + createHash("sha256").update(value, "utf8").digest("hex")
);
const SHA = sha256(JSON.stringify(CANONICAL));
const FID = "turn-effect-v1:attempt05-fresh-restart";
function utf8ChunkEnd(data, start, limit) {
  let end = Math.min(start + limit, data.length);
  if (end < data.length) {
    while (end > start && (data[end] & 0xC0) === 0x80) end -= 1;
    if (end === start) {
      end = start + 1;
      while (end < data.length && (data[end] & 0xC0) === 0x80) end += 1;
    }
  }
  return end;
}
const data = Buffer.from(CANONICAL, "utf8");
const chunks = [];
let position = 0;
while (position < data.length) {
  const end = utf8ChunkEnd(data, position, 128);
  chunks.push([position, end]);
  position = end;
}
// Canonical latest is already confirmed/displayed; first request must be
// semantic-only, later chunks require the identity the first response gave.
const state = { chunkCalls: [], acks: [], firstSeen: false };
const chunkEnvelope = (index) => ({
  ok: true,
  tool: "session.delivery_text",
  data: {
    mode: "replay",
    finalization_id: FID,
    rendered_sha256: SHA,
    rendered_text_sha256: SHA,
    text: data.subarray(...chunks[index]).toString("utf8"),
    text_offset: chunks[index][0],
    returned_bytes: chunks[index][1] - chunks[index][0],
    total_bytes: data.length,
    chunk_ordinal: index,
    chunk_count: chunks.length,
    final: index === chunks.length - 1,
    next_offset: chunks[index][1] < data.length ? chunks[index][1] : null,
  },
});
const serve = (params) => {
  if (params?.operation === "session.delivery_ack") {
    state.acks.push(params.arguments ?? {});
    return { ok: true, tool: "session.delivery_ack", data: { status: "confirmed", ack_kind: params.arguments?.ack_kind ?? null } };
  }
  if (params?.operation !== "session.delivery_text") {
    return { ok: false, error: { code: "probe_no_route" } };
  }
  const args = params.arguments ?? {};
  if (!state.firstSeen) {
    if (args.finalization_id !== undefined || args.rendered_sha256 !== undefined || args.text_offset !== undefined) {
      return { ok: false, tool: "session.delivery_text", error: { code: "invalid_param" } };
    }
    if (args.mode !== "replay") {
      return { ok: false, tool: "session.delivery_text", error: { code: "invalid_param" } };
    }
    state.firstSeen = true;
    state.chunkCalls.push(args);
    return chunkEnvelope(0);
  }
  if (args.finalization_id !== FID || args.rendered_sha256 !== SHA) {
    return { ok: false, tool: "session.delivery_text", error: { code: "delivery_conflict" } };
  }
  const index = chunks.findIndex(([start]) => start === args.text_offset);
  if (index === -1) return { ok: false, tool: "session.delivery_text", error: { code: "invalid_param" } };
  state.chunkCalls.push(args);
  return chunkEnvelope(index);
};
const calls = [];
const sent = [];
const handlers = new Map();
const tools = new Map();
const pi = {
  registerTool: (tool) => tools.set(tool.name, tool),
  registerCommand() {},
  registerShortcut() {},
  on(type, handler) {
    const registered = handlers.get(type) || [];
    registered.push(handler);
    handlers.set(type, registered);
  },
  appendEntry() {},
  sendMessage(message) { sent.push(message); },
  setActiveTools() {},
  getThinkingLevel: () => "off",
};
main.default(pi, {
  coordinatorEnabled: () => false,
  startupCampaignId: () => null,
  createClient: () => ({
    callTool: async (name, params) => {
      calls.push({ name, params });
      return serve(params);
    },
    callToolWithTransportMeta: async (name, params) => ({
      value: await (async () => {
        calls.push({ name, params });
        return serve(params);
      })(),
      transport: null,
    }),
    async close() {},
  }),
});
const ctx = {
  cwd: ROOT,
  mode: "rpc",
  model: { provider: "probe", id: "probe" },
  sessionManager: { getSessionId: () => "fresh-replay-probe", getEntries: () => [] },
  hasUI: false,
};
for (const handler of handlers.get("session_start") || []) {
  await handler({ type: "session_start", reason: "probe" }, ctx);
}
await tools.get("coc_invoke").execute(
  "resume",
  { operation: "session.resume", campaign: "attempt05-fresh-restart", arguments: {} },
  undefined,
  undefined,
  ctx,
);
const replayResult = await tools.get("coc_session_delivery_text").execute(
  "replay",
  { campaign: "attempt05-fresh-restart", mode: "replay" },
  undefined,
  undefined,
  ctx,
);
const journalAttempt = await tools.get("coc_invoke").execute(
  "quarantine",
  { operation: "state.journal", campaign: "attempt05-fresh-restart", arguments: {} },
  undefined,
  undefined,
  ctx,
);
let transformed;
for (const handler of handlers.get("message_end") || []) {
  transformed = await handler({
    type: "message_end",
    message: {
      role: "assistant",
      api: "openai-responses",
      provider: "probe",
      model: "probe",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: "stop",
      timestamp: 9,
      content: [{ type: "text", text: "这是模型附带的额外转述，必须被抑制。" }],
    },
  }, ctx);
}
for (const handler of handlers.get("agent_end") || []) await handler({}, ctx);
const events = sent.filter((message) => message?.customType === "coc_delivery_replay");
const joined = events.map((message) => message.details.text).join("");
const resumeCalls = calls.filter((row) => row.params?.operation === "session.resume");
process.stdout.write(JSON.stringify({
  freshProcess: true,
  resumeDataKeys: resumeCalls.map((row) => Object.keys(row.params.data ?? {})),
  resumeCount: resumeCalls.length,
  chunkCalls: state.chunkCalls,
  firstResponseIdentity: { finalization_id: FID, rendered_sha256: SHA },
  acks: state.acks,
  events: events.map((message) => ({
    display: message.display === true,
    details: {
      schema_version: message.details.schema_version,
      kind: message.details.kind,
      chunk_ordinal: message.details.chunk_ordinal,
      chunk_count: message.details.chunk_count,
      final: message.details.final,
      text: message.details.text,
    },
  })),
  joinedChars: [...joined].length,
  joinedBytes: Buffer.byteLength(joined, "utf8"),
  joinedExact: joined === CANONICAL,
  resultText: replayResult.content[0].text,
  journalErrorCode: JSON.parse(journalAttempt.content[0].text).error?.code ?? null,
  paraphraseHidden: !((transformed?.message?.content ?? [])).some((part) => part.type === "text"),
}));
`;
writeFileSync(childPath, childSource);
const freshRun = spawnSync(
  process.execPath,
  ["--experimental-strip-types", childPath, root],
  { encoding: "utf8", cwd: root },
);
assert.equal(freshRun.status, 0, freshRun.stderr?.slice(-2000));
const fresh = JSON.parse(freshRun.stdout);
const freshEventsText = fresh.events.map((event) => event.details.text).join("");
const freshReport = {
  freshProcess: fresh.freshProcess === true,
  resumeDeliveryFree: fresh.resumeCount === 1
    && fresh.resumeDataKeys.every((keys) => !keys.includes("delivery")),
  firstRequestSemanticOnly: JSON.stringify(fresh.chunkCalls[0])
    === JSON.stringify({ mode: "replay" }),
  chunkCalls: fresh.chunkCalls.length,
  laterCallsBound: fresh.chunkCalls.slice(1).every((args) => (
    typeof args.text_offset === "number"
    && args.finalization_id === fresh.firstResponseIdentity.finalization_id
    && args.rendered_sha256 === fresh.firstResponseIdentity.rendered_sha256
  )),
  chars: freshEventsText.length === 0 ? fresh.joinedChars : [...freshEventsText].length,
  bytes: Buffer.byteLength(freshEventsText, "utf8") || fresh.joinedBytes,
  exact: freshEventsText === "" ? fresh.joinedExact : freshEventsText === ATTEMPT05_CANONICAL_TEXT,
  ordinals: fresh.events.map((event) => event.details.chunk_ordinal),
  finals: fresh.events.map((event) => event.details.final),
  playerVisible: fresh.events.every((event) => event.display),
  schemaV1: fresh.events.every((event) => (
    event.details.schema_version === 1 && event.details.kind === "coc_delivery_replay"
  )),
  ack: {
    count: fresh.acks.length,
    kind: fresh.acks[0]?.ack_kind,
    identityBound: fresh.acks[0]?.finalization_id === fresh.firstResponseIdentity.finalization_id
      && fresh.acks[0]?.rendered_sha256 === fresh.firstResponseIdentity.rendered_sha256,
  },
  resultOpaqueFree: !/finalization_id|rendered_sha|text_offset|next_offset/.test(fresh.resultText),
  resultDelivered: JSON.parse(fresh.resultText).data?.delivered === true,
  journalRejected: fresh.journalErrorCode === "delivery_replay_owns_delivery",
  paraphraseHidden: fresh.paraphraseHidden === true,
};
assert.equal(freshReport.freshProcess, true);
assert.equal(freshReport.resumeDeliveryFree, true);
assert.equal(freshReport.firstRequestSemanticOnly, true);
assert.equal(freshReport.chunkCalls > 1, true);
assert.equal(freshReport.laterCallsBound, true);
assert.equal(freshReport.chars, 179);
assert.equal(freshReport.bytes, 511);
assert.equal(freshReport.exact, true);
assert.deepEqual(freshReport.ordinals, Array.from({ length: freshReport.chunkCalls }, (_, index) => index));
assert.equal(freshReport.finals.at(-1), true);
assert.equal(freshReport.playerVisible, true);
assert.equal(freshReport.schemaV1, true);
assert.equal(freshReport.ack.count, 1);
assert.equal(freshReport.ack.kind, "replayed");
assert.equal(freshReport.ack.identityBound, true);
assert.equal(freshReport.resultOpaqueFree, true);
assert.equal(freshReport.resultDelivered, true);
assert.equal(freshReport.journalRejected, true);
assert.equal(freshReport.paraphraseHidden, true);
replayReport.freshRestart = freshReport;
process.stderr.write(
  `deliveryReplayReport: ${JSON.stringify(replayReport)}\n`,
);

process.stdout.write(JSON.stringify({
  piVersion: "0.81.1",
  gatewayCalls: clientCalls,
  gatewayEnvelope: {
    ok: returnedEnvelope.ok,
    tool: returnedEnvelope.tool,
    canonicalOperation: returnedEnvelope.wire?.canonical_operation,
    renderedTextExact: returnedEnvelope.data?.rendered_text === renderedText,
    renderedDigestExact:
      returnedEnvelope.data?.rendered_text_sha256 === renderedSha256,
  },
  digest: {
    receipt: renderedSha256,
    canonical: canonicalDigest,
    rawUtf8: rawDigest,
    canonicalMatchesReceipt: canonicalDigest === renderedSha256,
    rawUtf8RejectedByContract: rawDigest !== renderedSha256,
  },
  exactVisible: types(finals[0]).includes("text"),
  redundantSuppressed: types(finals[1]).length === 0,
  queuedCustomObserved: eventTrace.includes(
    "message_start:custom:coc-source-coordinator-terminal-continuation",
  ),
  rawGatewayRejected: {
    code: rawReturnedEnvelope.error?.code,
    exactSuppressed: rawExactResult !== undefined,
    followUpSuppressed: rawFollowUpResult !== undefined,
  },
}));
