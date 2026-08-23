#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  applyPendingFinalizationRecoveryGuidance,
  applyOpenTurnRecoveryGuidance,
  isPendingFinalizationResume,
  isOpenTurnRecoveryResume,
  OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT,
  OPEN_TURN_RECOVERY_GUIDANCE_AUDIT,
  OPEN_TURN_RECOVERY_CLOSURE_SEQUENCE,
  OPEN_TURN_RECOVERY_FORBIDDEN_UNTIL_CLOSED,
  PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
  PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT,
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
const pendingDirectEnvelope = resumeEnvelope("pending_finalization", {
  next_operations: ["turn.finalize"],
});
pendingDirectEnvelope.data.semantic_capsule = {
  recent_summaries: ["large unrelated recovery projection".repeat(200)],
};
pendingDirectEnvelope.data.pending_output_context = {
  journal_decision_id: "journal:pending",
  required_obligation_ids: ["obligation-1"],
  mechanics_bundle: { large: "mechanics".repeat(200) },
};
assert.equal(isPendingFinalizationResume(pendingDirectEnvelope), true);
assert.equal(
  isPendingFinalizationResume(resumeEnvelope("pending_finalization", {
    next_operations: ["state.exceptional_effect", "turn.finalize"],
  })),
  false,
  "host must not skip a canonical exceptional-effect blocker",
);
const pendingDirect = applyPendingFinalizationRecoveryGuidance(
  pendingDirectEnvelope,
  { root, campaign: "recovery-guide-campaign" },
);
assert.equal(pendingDirect.attached, true);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.contract_id,
  PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
);
assert.deepEqual(
  pendingDirect.envelope.data.host_recovery_guidance.next_call,
  {
    tool: "coc_turn_output_context",
    arguments: { root, campaign: "recovery-guide-campaign" },
  },
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.exact_card_path,
  "coc_turn_output_context.data.agency_review_operation",
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.tool,
  "coc_narration_review",
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.armed,
  false,
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.revision,
  null,
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.instruction.includes(
    "revision-1",
  ),
  false,
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.instruction.includes(
    "host-provided revision",
  ),
  true,
);
const pendingRevisionTwo = applyPendingFinalizationRecoveryGuidance(
  pendingDirectEnvelope,
  { root, campaign: "recovery-guide-campaign" },
  { reviewRecoveryArmed: true, revision: 2 },
);
assert.equal(
  pendingRevisionTwo.envelope.data.host_recovery_guidance.review_recovery.revision,
  2,
);
assert.equal(
  pendingRevisionTwo.envelope.data.host_recovery_guidance.review_recovery.armed,
  true,
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.then.exact_card_path,
  "coc_turn_output_context.data.finalize_operation",
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.then.instruction.includes(
    "do not construct, infer, or reuse turn.finalize arguments",
  ),
  true,
);
assert.deepEqual(
  Object.keys(pendingDirect.envelope.data).sort(),
  [
    "campaign_id",
    "host_recovery_guidance",
    "mode",
    "next_operations",
    "pending_output_context",
    "schema_version",
  ],
);
assert.equal(pendingDirect.envelope.data.semantic_capsule, undefined);
assert.deepEqual(
  pendingDirect.envelope.data.pending_output_context,
  {
    status: "read_via_exact_typed_call",
    next_call: {
      tool: "coc_turn_output_context",
      arguments: { root, campaign: "recovery-guide-campaign" },
    },
  },
);

const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-recovery-guide-"));

function harness(responseForCall, startupCampaignId, workspaceCwd = root) {
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
    createClient: () => {
      const callTool = async (name, params) => {
        if (name === "coc_capabilities") return { ok: true, host: "pi" };
        return responseForCall(name, params);
      };
      return {
        callTool,
        callToolWithTransportMeta: async (name, params) => ({
          value: await callTool(name, params),
          transport: null,
        }),
        close: async () => {},
      };
    },
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
    cwd: workspaceCwd,
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

const prefixWorkspace = mkdtempSync(path.join(tmpdir(), "pi-coc-ready-prefix-"));
const prefixCampaign = "ready-setup-prefix-host";
mkdirSync(path.join(prefixWorkspace, ".coc", "campaigns", prefixCampaign, "save"), {
  recursive: true,
});
writeFileSync(
  path.join(prefixWorkspace, ".coc", "campaigns", prefixCampaign, "campaign.json"),
  `${JSON.stringify({
    schema_version: 1,
    campaign_id: prefixCampaign,
    status: "ready_for_table",
    setup_handoff: {
      decision_id: "handoff-ready-setup-prefix-host",
      completed_at: "2026-08-22T12:33:04.162349Z",
    },
  })}\n`,
);
writeFileSync(
  path.join(prefixWorkspace, ".coc", "campaigns", prefixCampaign, "save", "world-state.json"),
  `${JSON.stringify({ status: "setup", active_subsystem: "setup" })}\n`,
);
const prefixHost = harness((name, params) => {
  if (params.operation !== "session.resume") {
    throw new Error(`unexpected ${params.operation}`);
  }
  return resumeEnvelope("open_turn_recovery", {
    campaign_id: prefixCampaign,
    next_operations: ["continue_current_turn_from_receipts"],
    current_turn: {
      meaningful_row_count: 3,
      rows: [
        { tool: "rules.roll_dice", ok: true },
        { tool: "progressive.opening_bootstrap", ok: true },
        { tool: "setup.complete", ok: true },
      ],
    },
  });
}, prefixCampaign, prefixWorkspace);
await prefixHost.start();
const prefixResumed = await invoke(prefixHost, "prefix-resume", {
  operation: "session.resume",
  root: prefixWorkspace,
  campaign: prefixCampaign,
  arguments: {},
}, "coc_setup");
assert.equal(prefixResumed.ok, true);
assert.equal(prefixResumed.data.mode, "table_opening");
assert.deepEqual(prefixResumed.data.next_operations, ["evidence.table_opening"]);
assert.equal(prefixResumed.data.host_recovery_guidance, undefined);
assert.equal(
  prefixHost.audits.some((entry) => entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT),
  false,
);
await prefixHost.shutdown();

const pendingCampaign = "startup-pending-finalization";
const pending = harness((name, params) => {
  if (name !== "coc_invoke" || params.operation !== "session.resume") {
    throw new Error(`unexpected ${name}:${params.operation}`);
  }
  const envelope = resumeEnvelope("pending_finalization", {
    campaign_id: pendingCampaign,
    next_operations: ["turn.finalize"],
  });
  envelope.data.current_turn = { rows: [{ large: "receipt".repeat(400) }] };
  envelope.data.pending_output_context = {
    journal_decision_id: "journal:pending",
    required_obligation_ids: ["obligation-1"],
    mechanics_bundle: { large: "mechanics".repeat(400) },
  };
  return envelope;
}, pendingCampaign);
await pending.start();
const pendingResumed = await invoke(
  pending,
  "pending-finalization-resume",
  resumeParams(pendingCampaign),
  "coc_setup",
);
assert.equal(pendingResumed.ok, true);
assert.equal(pendingResumed.data.mode, "pending_finalization");
assert.equal(pendingResumed.data.current_turn, undefined);
assert.equal(
  pendingResumed.data.pending_output_context.status,
  "read_via_exact_typed_call",
);
assert.deepEqual(
  pendingResumed.data.host_recovery_guidance.next_call,
  {
    tool: "coc_turn_output_context",
    arguments: { root, campaign: pendingCampaign },
  },
);
assert.equal(
  pendingResumed.data.host_recovery_guidance.then.tool,
  "coc_turn_finalize",
);
assert.equal(
  pendingResumed.data.host_recovery_guidance.review_recovery.tool,
  "coc_narration_review",
);
assert.equal(
  pendingResumed.data.host_recovery_guidance.review_recovery.armed,
  false,
);
assert.ok(
  pending.audits.some((entry) => (
    entry.name === PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT
    && entry.value?.contract_id
      === PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT
    && entry.value?.campaign_id === pendingCampaign
  )),
);
await pending.shutdown();

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
