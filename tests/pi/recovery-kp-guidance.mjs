#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import "./_lib/preload-embedded-pi.mjs";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const root = path.resolve(process.argv[2] || process.cwd());
const guidanceMod = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/recovery-guidance.ts")).href
);
const main = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);

const {
  applyOpenTurnRecoveryGuidance,
  isOpenTurnRecoveryResume,
  OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT,
  OPEN_TURN_RECOVERY_GUIDANCE_AUDIT,
  OPEN_TURN_RECOVERY_CLOSURE_SEQUENCE,
  OPEN_TURN_RECOVERY_FORBIDDEN_UNTIL_CLOSED,
} = guidanceMod;

function resumeEnvelope(mode, extra = {}) {
  return {
    ok: true,
    tool: "session.resume",
    data: {
      schema_version: 1,
      campaign_id: extra.campaign_id ?? "recovery-guide-campaign",
      mode,
      next_operations: extra.next_operations ?? [],
      current_turn: extra.current_turn ?? { rows: [{ tool: "rules.roll", ok: true }] },
    },
  };
}

assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("open_turn_recovery", {
    next_operations: ["continue_current_turn_from_receipts"],
  })),
  true,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("open_turn_recovery")),
  true,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("awaiting_player", {
    next_operations: ["interpret_current_player_message"],
  })),
  false,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("table_opening", {
    next_operations: ["evidence.table_opening"],
  })),
  false,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("pending_finalization", {
    next_operations: ["turn.finalize"],
  })),
  false,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("table_opening", {
    next_operations: ["continue_current_turn_from_receipts"],
  })),
  false,
);
assert.equal(
  isOpenTurnRecoveryResume({
    ok: false,
    tool: "session.resume",
    data: { mode: "open_turn_recovery" },
  }),
  false,
);

const attached = applyOpenTurnRecoveryGuidance(resumeEnvelope("open_turn_recovery", {
  next_operations: ["continue_current_turn_from_receipts"],
}));
assert.equal(attached.attached, true);
const guidance = attached.envelope.data.host_recovery_guidance;
assert.equal(guidance.contract_id, OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT);
assert.equal(guidance.schema_version, 1);
assert.equal(guidance.audience, "keeper_only");
assert.equal(guidance.mode, "open_turn_recovery");
assert.equal(guidance.current_acl_supersedes_prior_denials, true);
assert.deepEqual(
  guidance.closure_sequence.map((row) => row.operation),
  OPEN_TURN_RECOVERY_CLOSURE_SEQUENCE.map((row) => row.operation),
);
assert.deepEqual(
  guidance.forbidden_until_closed,
  [...OPEN_TURN_RECOVERY_FORBIDDEN_UNTIL_CLOSED],
);
assert.equal(guidance.after_closure, "adjudicate_unsettled_player_action");
assert.ok(guidance.keep.includes("kp_semantic_judgment"));
assert.ok(guidance.keep.includes("rule4"));
assert.ok(guidance.do_not.includes("fixed_narrative_template"));
assert.equal(
  Object.keys(attached.envelope.data)[0],
  "host_recovery_guidance",
);
assert.equal(applyOpenTurnRecoveryGuidance(resumeEnvelope("table_opening")).attached, false);
assert.equal(applyOpenTurnRecoveryGuidance(resumeEnvelope("awaiting_player")).attached, false);
assert.equal(
  applyOpenTurnRecoveryGuidance(resumeEnvelope("pending_finalization")).attached,
  false,
);

const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-recovery-guide-"));

function harness(responseForCall, startupCampaignId) {
  const registered = new Map();
  const handlers = new Map();
  const sent = [];
  const audits = [];
  const fakePi = {
    registerTool: (tool) => registered.set(tool.name, tool),
    registerCommand: () => {},
    registerShortcut: () => {},
    on: (name, handler) => {
      const values = handlers.get(name) || [];
      values.push(handler);
      handlers.set(name, values);
    },
    appendEntry: (name, value) => {
      audits.push({ name, value });
    },
    sendMessage: (message, options) => {
      sent.push({ message, options });
    },
    setActiveTools: () => {},
    getThinkingLevel: () => "off",
  };
  main.default(fakePi, {
    coordinatorEnabled: async () => false,
    createClient: () => ({
      callTool: async (name, params) => {
        if (name === "coc_capabilities") return { ok: true, host: "pi" };
        return responseForCall(name, params);
      },
      close: async () => {},
    }),
    startupCampaignId: () => startupCampaignId,
    welcomeAgentDir,
    launchCoordinator: () => ({
      child: {},
      activation: Promise.resolve({ type: "agent_start" }),
      completion: Promise.resolve([]),
      terminate: async () => {},
    }),
  });
  const ctx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "offline", id: "offline" },
    sessionManager: {
      getSessionId: () => "recovery-kp-guidance",
      getEntries: () => [],
    },
    hasUI: false,
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
    sent,
    audits,
    ctx,
    async start() {
      await handlers.get("session_start").at(-1)({ reason: "startup" }, ctx);
      for (const handler of handlers.get("agent_start") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
    async shutdown() {
      for (const handler of handlers.get("agent_end") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
  };
}

async function invoke(h, id, params, toolName = "coc_invoke") {
  const tool = h.registered.get(toolName);
  if (!tool) throw new Error(`missing tool ${toolName}`);
  return JSON.parse((await tool.execute(
    id,
    params,
    undefined,
    undefined,
    h.ctx,
  )).content[0].text);
}

function resumeParams(campaignId) {
  return {
    operation: "session.resume",
    root,
    campaign: campaignId,
    arguments: {},
  };
}

const recoveryCampaign = "startup-open-turn-recovery";
const recovery = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation !== "session.resume") {
    throw new Error(`unexpected ${params.operation}`);
  }
  return resumeEnvelope("open_turn_recovery", {
    campaign_id: recoveryCampaign,
    next_operations: ["continue_current_turn_from_receipts"],
  });
}, recoveryCampaign);
await recovery.start();
const sentBeforeResume = recovery.sent.length;
const recovered = await invoke(
  recovery,
  "recovery-resume",
  resumeParams(recoveryCampaign),
  "coc_setup",
);
assert.equal(recovered.ok, true);
assert.equal(recovered.data.mode, "open_turn_recovery");
assert.deepEqual(
  recovered.data.next_operations,
  ["continue_current_turn_from_receipts"],
);
assert.equal(
  recovered.data.host_recovery_guidance?.contract_id,
  OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT,
);
assert.deepEqual(
  recovered.data.host_recovery_guidance.closure_sequence.map((row) => row.operation),
  ["turn.output_context", "state.journal", "turn.finalize"],
);
assert.ok(
  recovered.data.host_recovery_guidance.forbidden_until_closed.includes("state.move_scene"),
);
assert.ok(
  recovery.audits.some((entry) => (
    entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT
    && entry.value?.contract_id === OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT
    && entry.value?.mode === "open_turn_recovery"
  )),
);
assert.equal(
  recovery.sent.slice(sentBeforeResume).some((entry) => (
    entry.message?.customType === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT
    || entry.message?.customType === "coc-open-turn-recovery-guidance"
  )),
  false,
  "guidance must stay on the tool result; no mid-pair custom message",
);
await recovery.shutdown();

for (const [label, mode, next] of [
  ["table_opening", "table_opening", ["evidence.table_opening"]],
  ["awaiting_player", "awaiting_player", ["interpret_current_player_message"]],
  ["pending_finalization", "pending_finalization", ["turn.finalize"]],
]) {
  const campaignId = `startup-${label}`;
  const h = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected ${params.operation}`);
    }
    return resumeEnvelope(mode, {
      campaign_id: campaignId,
      next_operations: next,
    });
  }, campaignId);
  await h.start();
  const resumed = await invoke(h, `${label}-resume`, resumeParams(campaignId), "coc_setup");
  assert.equal(resumed.ok, true, label);
  assert.equal(resumed.data.mode, mode, label);
  assert.equal(resumed.data.host_recovery_guidance, undefined, label);
  assert.equal(
    h.audits.some((entry) => entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT),
    false,
    label,
  );
  await h.shutdown();
}

const { convertToLlm } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-coding-agent", "dist/core/messages.js")).href
);
const { transformMessages } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-ai", "dist/api/transform-messages.js")).href
);
const { convertMessages } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-ai", "dist/api/openai-completions.js")).href
);

const model = {
  id: "deepseek-chat",
  name: "DeepSeek",
  provider: "deepseek",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8000,
  maxTokens: 256,
};
const compat = {
  supportsDeveloperRole: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  requiresReasoningContentOnAssistantMessages: false,
  requiresToolResultName: false,
  deferredToolsMode: undefined,
};
const callId = "call_open_turn_recovery";
const agentMessages = [
  {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: callId,
      name: "coc_setup",
      arguments: { operation: "session.resume" },
    }],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-chat",
    usage: {
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 1,
  },
  {
    role: "toolResult",
    toolCallId: callId,
    toolName: "coc_setup",
    content: [{ type: "text", text: JSON.stringify(recovered) }],
    isError: false,
    timestamp: 2,
  },
];
const llm = convertToLlm(agentMessages);
assert.equal(llm[0].role, "assistant");
assert.equal(llm[1].role, "toolResult");
assert.equal(llm[1].toolCallId, callId);
assert.equal(llm.some((msg) => msg.role === "user"), false);
const transformed = transformMessages(llm, model);
assert.equal(
  transformed.some((msg) => msg.role === "toolResult" && msg.toolCallId === callId),
  true,
);
assert.equal(
  transformed.some((msg) => (
    msg.role === "user"
    && transformed.indexOf(msg) < transformed.findIndex((row) => (
      row.role === "toolResult" && row.toolCallId === callId
    ))
  )),
  false,
);
const provider = convertMessages(model, { messages: llm, systemPrompt: "" }, compat);
assert.equal(provider.filter((msg) => msg.role === "tool").length, 1);
assert.equal(provider.some((msg) => msg.role === "tool" && msg.tool_call_id === callId), true);

process.stdout.write(JSON.stringify({
  ok: true,
  contract: OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT,
  attachedOnOpenTurnRecovery: true,
  skippedModes: ["table_opening", "awaiting_player", "pending_finalization"],
  noMidPairCustom: true,
  providerValid: true,
}) + "\n");
