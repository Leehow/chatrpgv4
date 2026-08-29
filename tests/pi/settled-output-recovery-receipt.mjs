#!/usr/bin/env node
// Settled-output / empty-terminal recovery must reach a real finalization
// receipt: one hidden follow-up, then turn.finalize without a model-supplied
// campaign (host re-attaches canonicalProgressCampaignId), then no second
// recovery loop.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
process.env.COC_PI_SESSION_ROLE = "play";
const main = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);

const campaign = "settled-output-recovery-receipt";
const renderedText = "档案员抬眼打量他，没有立刻让开停尸房入口。";
const renderedSha256 = `sha256:${createHash("sha256").update(
  JSON.stringify(renderedText),
  "utf8",
).digest("hex")}`;

const emptyFinal = () => ({
  role: "assistant",
  stopReason: "stop",
  content: [{ type: "thinking", thinking: "provider-successful reasoning only" }],
});

const handlers = new Map();
const tools = new Map();
const sent = [];
const appended = [];
const clientCalls = [];
const pi = {
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  registerShortcut() {},
  on(type, handler) {
    const list = handlers.get(type) ?? [];
    list.push(handler);
    handlers.set(type, list);
  },
  appendEntry(...args) { appended.push(args); },
  sendMessage(message, options) {
    sent.push([message, options]);
    return true;
  },
  setActiveTools() {},
  getThinkingLevel: () => "off",
};

const callTool = async (_name, params) => {
  clientCalls.push(params);
  if (params.operation === "session.resume") {
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaign,
        mode: "awaiting_player",
        evidence: { table_opening_id: "table-opening:recovery-receipt" },
        next_operations: [],
      },
    };
  }
  if (params.operation === "turn.finalize") {
    return {
      ok: true,
      tool: "turn.finalize",
      data: {
        schema_version: 1,
        status: "finalized",
        accepted_revision: 1,
        rendered_text: renderedText,
        rendered_text_sha256: renderedSha256,
        finalization_id: "turn-finalization:morgue-recovery-receipt",
      },
    };
  }
  if (params.operation === "coc_capabilities" || _name === "coc_capabilities") {
    return { ok: true, host: "pi" };
  }
  return { ok: true, tool: params.operation || _name, data: {} };
};

main.default(pi, {
  coordinatorEnabled: async () => false,
  startupCampaignId: () => null,
  createClient: () => ({
    callTool,
    callToolWithTransportMeta: async (name, params) => ({
      value: await callTool(name, params),
      transport: null,
    }),
    async close() {},
  }),
});

const ctx = {
  cwd: root,
  mode: "rpc",
  model: { provider: "xai", id: "grok-4.5", api: "openai-responses" },
  sessionManager: {
    getSessionId: () => "settled-output-recovery-receipt",
    getEntries: () => [],
  },
  hasUI: false,
};

const emit = async (type, message) => {
  let result;
  for (const handler of handlers.get(type) || []) {
    result = await handler({ type, message }, ctx);
  }
  return result;
};

for (const handler of handlers.get("session_start") ?? []) {
  await handler({ type: "session_start" }, ctx);
}

const invoke = async (id, operation, arguments_, extra = {}) => {
  const tool = tools.get("coc_invoke");
  assert.ok(tool, "coc_invoke must be registered");
  return tool.execute(
    id,
    { operation, arguments: arguments_, ...extra },
    undefined,
    undefined,
    ctx,
  );
};

await invoke("resume", "session.resume", {}, { campaign });

for (const handler of handlers.get("message_start") ?? []) {
  await handler({
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "我走进停尸房，向值守说明来意。" }],
      timestamp: 1,
    },
  }, ctx);
}

await emit("message_end", emptyFinal());
const recoverySends = sent.filter(([message]) => (
  message.customType === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
));
assert.equal(recoverySends.length, 1, "empty terminal must schedule one recovery follow-up");
assert.equal(recoverySends[0][1]?.triggerTurn, true);
assert.equal(recoverySends[0][1]?.deliverAs, "followUp");
assert.match(
  JSON.stringify(recoverySends[0][0]),
  /turn\.finalize/,
  "recovery instruction must tell the KP to finalize",
);

const customSends = (type) => sent.filter(([message]) => message.customType === type);
const progressStages = () => appended
  .filter(([kind]) => kind === "coc-canonical-turn-progress")
  .map(([, value]) => value.stage);
const faultSends = () => customSends(main.TURN_PROCESSING_FAULT_CUSTOM_TYPE);
const settledGateSends = () => sent.filter(([message]) => (
  message.customType === "coc-settled-output-gate"
  || message.customType === "coc-settled-output-recovery"
));

const typedFinalize = tools.get("coc_turn_finalize");
assert.ok(typedFinalize, "coc_turn_finalize must be registered for play recovery");
const finalizeResult = await typedFinalize.execute(
  "finalize-recovery",
  {
    draft: renderedText,
    coverage: [],
    agency_claims: [],
  },
  undefined,
  undefined,
  ctx,
);
const visible = JSON.parse(finalizeResult.content[0].text);
assert.equal(visible.ok, true, JSON.stringify(visible));
assert.equal(visible.data.status, "finalized");
assert.equal(visible.data.rendered_text, renderedText);
assert.equal(
  finalizeResult.details.data.finalization_id,
  "turn-finalization:morgue-recovery-receipt",
);
assert.equal(
  finalizeResult.details.data.rendered_text_sha256,
  renderedSha256,
);

const finalizeTransport = clientCalls.filter((call) => call.operation === "turn.finalize");
assert.equal(finalizeTransport.length, 1);
assert.equal(
  finalizeTransport[0].campaign,
  campaign,
  "host must re-attach campaign when the recovery finalize omits it",
);
assert.equal(
  Object.hasOwn(finalizeTransport[0].arguments || {}, "campaign"),
  false,
  "campaign stays envelope-owned, not a model argument",
);

assert.equal(
  progressStages().at(-1),
  "finalized",
  `host must observe the receipt: ${JSON.stringify(progressStages())}`,
);
assert.equal(faultSends().length, 0, JSON.stringify(faultSends()));
assert.equal(
  settledGateSends().length,
  0,
  "receipt observation must not schedule settled-output recovery",
);

await emit("message_end", {
  role: "assistant",
  stopReason: "stop",
  content: [{ type: "text", text: renderedText }],
});
assert.equal(
  progressStages().at(-1),
  "delivered",
  `receipt delivery must advance host progress: ${JSON.stringify(progressStages())}`,
);
assert.equal(
  customSends(main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE).length,
  1,
  "delivering the receipt must not launch another empty-terminal follow-up",
);
assert.equal(faultSends().length, 0);
assert.equal(settledGateSends().length, 0);

await emit("message_end", emptyFinal());
assert.equal(
  customSends(main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE).length,
  1,
  "a receipt-delivered epoch must not schedule another hidden recovery follow-up",
);
assert.equal(
  faultSends().length,
  0,
  "a receipt-delivered epoch must not arm a turn-processing fault",
);
assert.equal(settledGateSends().length, 0);

process.stdout.write(`${JSON.stringify({
  ok: true,
  recoverySends: recoverySends.length,
  transportCampaign: finalizeTransport[0].campaign,
  finalizationId: finalizeResult.details.data.finalization_id,
  status: visible.data.status,
  hostStageAfterFinalize: "finalized",
  hostStageAfterDelivery: progressStages().at(-1),
  secondEmptyDidNotRelaunch: true,
  secondEmptyDidNotFault: true,
})}\n`);
