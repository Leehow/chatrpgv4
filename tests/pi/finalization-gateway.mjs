// Real Pi gateway/transcript regression for the canonical
// turn.finalize string digest used by the live FIX7 receipt.
import "./_lib/preload-embedded-pi.mjs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const { runAgentLoop } = await import(
  embeddedPiFile(root, "pi-agent-core", "dist/index.js")
);
const { createAssistantMessageEventStream } = await import(
  embeddedPiFile(root, "pi-ai", "dist/index.js")
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
    rendered_sha256: renderedSha256,
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
    arguments: {},
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
    rendered_sha256: rawDigest,
  },
};
await tools.get("coc_invoke").execute(
  "finalize-raw-digest-fixture",
  {
    operation: "turn.finalize",
    campaign: "hoyk-pi-grok-fix7-20260727",
    arguments: {},
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
process.stdout.write(JSON.stringify({
  piVersion: "0.81.1",
  gatewayCalls: clientCalls,
  gatewayEnvelope: {
    ok: returnedEnvelope.ok,
    tool: returnedEnvelope.tool,
    canonicalOperation: returnedEnvelope.wire?.canonical_operation,
    renderedTextExact: returnedEnvelope.data?.rendered_text === renderedText,
    renderedDigestExact:
      returnedEnvelope.data?.rendered_sha256 === renderedSha256,
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
    exactVisible: rawExactResult === undefined,
    followUpVisible: rawFollowUpResult === undefined,
  },
}));
