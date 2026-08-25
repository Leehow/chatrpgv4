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

// This harness drives the root KP extension surface directly. A worker-shell
// PI_SUBAGENT_CHILD=1 would silence applyKpActiveTools/setActiveTools and
// make the active-tool quarantine unobservable.
delete process.env.PI_SUBAGENT_CHILD;

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

function harness(responseForCall, startupCampaignId, workspaceCwd = root, branch = []) {
  const registered = new Map();
  const handlers = new Map();
  const sent = [];
  const audits = [];
  const activeTools = [];
  const clientCalls = [];
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
    setActiveTools: (tools) => {
      activeTools.push([...tools]);
    },
    getThinkingLevel: () => "off",
  };
  main.default(fakePi, {
    coordinatorEnabled: async () => false,
    createClient: () => {
      const callTool = async (name, params) => {
        clientCalls.push({ name, params });
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
      getBranch: () => branch,
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
    activeTools,
    clientCalls,
    ctx,
    async start() {
      await handlers.get("session_start").at(-1)({ reason: "startup" }, ctx);
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
assert.ok(
  recovery.activeTools.length > 0
    && recovery.activeTools.at(-1).length > 0,
  "open_turn_recovery must not quarantine the active tool surface",
);
const recoveryProse = await recovery.emit("message_end", {
  role: "assistant",
  content: [{ type: "text", text: "你重新执起守夜人的提灯，等待玩家的下一步。" }],
  stopReason: "stop",
});
assert.equal(
  recoveryProse.content.some((part) => part.type === "text"),
  true,
  "open_turn_recovery plain final stays visible (no quarantine)",
);
assert.equal(
  recovery.sent.some((entry) => (
    entry.options?.triggerTurn === true
    || entry.options?.deliverAs === "followUp"
    || entry.message?.customType === "coc-mechanical-output-gate"
    || entry.message?.customType === "coc-settled-output-gate"
    || entry.message?.customType === "coc-opening-setup-route"
  )),
  false,
  "open_turn_recovery visible final must not arm a gate follow-up",
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
  if (label === "table_opening") {
    assert.ok(
      h.activeTools.length > 0 && h.activeTools.at(-1).length > 0,
      "table_opening must not quarantine the active tool surface",
    );
    const openingProse = await h.emit("message_end", {
      role: "assistant",
      content: [{ type: "text", text: "你翻开手边的守则，准备宣布开场。" }],
      stopReason: "stop",
    });
    assert.equal(
      openingProse.content.some((part) => part.type === "text"),
      false,
      "table_opening plain final is adjudicated by the normal gate, not the quarantine",
    );
    assert.ok(
      h.sent.some((entry) => (
        entry.options?.triggerTurn === true
        && entry.options?.deliverAs === "followUp"
        && (
          entry.message?.customType === "coc-settled-output-gate"
          || entry.message?.customType === "coc-mechanical-output-gate"
          || entry.message?.customType === "coc-opening-setup-route"
        )
      )),
      "table_opening suppression flows through the normal output gate follow-up",
    );
  } else {
    assert.deepEqual(
      h.activeTools.at(-1),
      [],
      "awaiting_player must quarantine the same auto-open turn",
    );
  }
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
assert.ok(
  pending.activeTools.length > 0 && pending.activeTools.at(-1).length > 0,
  "pending_finalization must not quarantine the active tool surface",
);
await pending.shutdown();

// Silent settled startup resume modes (already_acknowledged / awaiting_player)
// acknowledge table state; they are not a new player turn. The remainder of
// the same auto-open agent turn must be quarantined: empty active tools until
// that turn's agent_end, tool-free finals (both non-empty mechanical-looking
// and thinking-only/empty) hidden BEFORE
// OpeningTerminalContinuationGate.acceptVisibleAssistantFinal (so no
// state.journal / second resume / rules-state call can be issued, no settled
// or mechanical output gate arms, no follow-up/prompt is sent — including the
// concurrent coc-empty-terminal-recovery path over the historical player
// epoch — and no prose or history replays), then the normal tool surface
// returns after agent_end for the next genuine external player turn.
const QUARANTINE_MECHANICAL_FINAL = "【明骰】D100=45，你听见远处教堂的钟声。";
for (const mode of ["already_acknowledged", "awaiting_player"]) {
  const campaignId = `startup-silent-${mode}`;
  const h = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected ${mode} quarantine operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: campaignId });
  }, campaignId);
  await h.start();
  assert.ok(
    h.activeTools.length > 0,
    `${mode}: startup pending gate arms a tool surface`,
  );
  // A silent settled resume replays a session whose transcript already
  // holds the historical player turn; the replayed message_start marks the
  // external player epoch before the auto-open resume settles silently.
  await h.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: "我推开了教堂的大门，里面一片漆黑。" }],
  });
  const toolsBeforeResume = h.activeTools.length;
  const resumed = await invoke(
    h,
    `silent-${mode}-resume`,
    resumeParams(campaignId),
    "coc_setup",
  );
  assert.equal(resumed.ok, true, mode);
  assert.equal(resumed.data.mode, mode, mode);
  assert.equal(resumed.data.host_recovery_guidance, undefined, mode);
  assert.ok(
    h.activeTools.length > toolsBeforeResume,
    `${mode}: silent resume reapplies the tool surface`,
  );
  assert.ok(
    h.activeTools
      .slice(toolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `${mode}: every tool application after the silent resume is empty`,
  );
  const sentAtQuarantine = h.sent.length;
  const clientCallsAtQuarantine = h.clientCalls.length;
  const hiddenFinal = await h.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    hiddenFinal.content.some((part) => part.type === "text"),
    false,
    `${mode}: mechanical-looking tool-free final is hidden while quarantined`,
  );
  assert.equal(
    h.sent.slice(sentAtQuarantine).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
      || entry.message?.customType === "coc-mechanical-output-gate"
      || entry.message?.customType === "coc-settled-output-gate"
      || entry.message?.customType === "coc-settled-output-preflight"
      || entry.message?.customType === "coc-opening-setup-route"
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `${mode}: quarantine sends no recovery custom, follow-up, or prompt`,
  );
  assert.equal(
    h.clientCalls.slice(clientCallsAtQuarantine).some((call) => (
      call.name !== "coc_capabilities"
      && (
        call.params?.operation === "session.resume"
        || (
          typeof call.params?.operation === "string"
          && (call.params.operation.startsWith("state.")
            || call.params.operation.startsWith("rules.")
            || call.params.operation.startsWith("turn."))
        )
      )
    )),
    false,
    `${mode}: quarantine issues no second resume, state.journal, or rules-state call`,
  );
  assert.equal(
    h.audits.some((entry) => (
      entry.name === "coc-mechanical-output-gate"
      || entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT
      || entry.name === PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT
    )),
    false,
    `${mode}: quarantine arms no mechanical/settled/recovery gate`,
  );
  assert.deepEqual(
    h.activeTools.at(-1),
    [],
    `${mode}: tools stay empty through the quarantined turn`,
  );
  // Thinking-only/empty tool-free final while the quarantine is still
  // armed: it must be routed to the empty-terminal callback, hidden, and
  // must NOT let the concurrent empty-terminal recovery path send its
  // coc-empty-terminal-recovery follow-up and re-awaken the historical
  // player epoch the quarantine just closed.
  const thinkingOnlyFinal = await h.emit("message_end", {
    role: "assistant",
    content: [{ type: "thinking", text: "盘点既有收据，不产出玩家正文。" }],
    stopReason: "stop",
  });
  assert.equal(
    thinkingOnlyFinal.content.some((part) => part.type === "text"),
    false,
    `${mode}: thinking-only tool-free final is hidden while quarantined`,
  );
  assert.equal(
    h.sent.slice(sentAtQuarantine).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
      || entry.message?.customType === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
      || entry.message?.customType === "coc-mechanical-output-gate"
      || entry.message?.customType === "coc-settled-output-gate"
      || entry.message?.customType === "coc-settled-output-preflight"
      || entry.message?.customType === "coc-opening-setup-route"
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `${mode}: thinking-only final sends no recovery follow-up, custom, or prompt`,
  );
  assert.equal(
    h.audits.some((entry) => (
      entry.name === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
      || entry.name === "coc-empty-terminal-recovery-delivery-failed"
      || entry.name === main.TURN_PROCESSING_FAULT_CUSTOM_TYPE
      || entry.name === "coc-mechanical-output-gate"
      || entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT
      || entry.name === PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT
    )),
    false,
    `${mode}: thinking-only final arms no recovery marker or fault audit`,
  );
  assert.equal(
    h.clientCalls.slice(clientCallsAtQuarantine).some((call) => (
      call.name !== "coc_capabilities"
      && (
        call.params?.operation === "session.resume"
        || (
          typeof call.params?.operation === "string"
          && (call.params.operation.startsWith("state.")
            || call.params.operation.startsWith("rules.")
            || call.params.operation.startsWith("turn."))
        )
      )
    )),
    false,
    `${mode}: thinking-only final triggers no second resume or rules-state call`,
  );
  assert.deepEqual(
    h.activeTools.at(-1),
    [],
    `${mode}: tools stay empty after the thinking-only final`,
  );
  await h.shutdown();
  assert.ok(
    h.activeTools.at(-1).length > 0,
    `${mode}: normal tool surface returns after agent_end`,
  );
  // The next genuine external player turn (a real role=user message, not a
  // replay) must find the normal tool surface available and settle through
  // the normal epoch machinery.
  await h.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: "我举灯走进正厅，检查讲坛后的暗门。" }],
  });
  assert.ok(
    h.activeTools.at(-1).length > 0,
    `${mode}: the next genuine external player turn keeps normal tools available`,
  );
  const sentAfterRelease = h.sent.length;
  const interceptedFinal = await h.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    interceptedFinal.content.some((part) => part.type === "text"),
    false,
    `${mode}: control - the normal mechanical gate still intercepts after release`,
  );
  assert.ok(
    h.sent.slice(sentAfterRelease).some((entry) => (
      entry.options?.triggerTurn === true
      && entry.options?.deliverAs === "followUp"
      && (
        entry.message?.customType === "coc-mechanical-output-gate"
        || entry.message?.customType === "coc-settled-output-gate"
      )
    )),
    `${mode}: control - interception after release delivers the gate follow-up`,
  );
  assert.equal(
    h.sent.slice(sentAfterRelease).some((entry) => (
      entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
    )),
    false,
    `${mode}: no startup blocker or table-open prompt at any boundary`,
  );
}

// Startup-only trailing-unmatched-player refinement: the silent settled
// quarantine must be armed from the persistent session branch read once at
// initializeSession. A branch whose last player-visible role is an unmatched
// real role=user message (a fresh setup answer whose provider finished
// without a final, then a watchdog respawn) must NOT be quarantined — the
// auto-open agent finishes that existing player epoch with the normal
// tool/output surface and no resend. A fully settled branch (later visible
// assistant output) keeps the quarantine. Structured roles only; hidden
// custom entries and non-message entries never clear the pending user.
const PLAYER_SETUP_ANSWER = "他叫托马斯·里德，是1890年代波士顿的一名记者。";
let branchEntrySeq = 0;
function branchEntry(role, content, extra = {}) {
  branchEntrySeq += 1;
  return {
    type: "message",
    id: `branch-entry-${branchEntrySeq}`,
    parentId: `branch-entry-${branchEntrySeq - 1}`,
    timestamp: "2026-08-24T17:38:00.000Z",
    message: { role, content },
    ...extra,
  };
}
const settledAssistantBranch = () => [
  branchEntry("user", [{ type: "text", text: PLAYER_SETUP_ANSWER }]),
  branchEntry(
    "assistant",
    [{ type: "text", text: "已记录：托马斯·里德，记者。建卡继续。" }],
    { stopReason: "stop" },
  ),
];
const trailingUserBranch = () => [
  branchEntry(
    "assistant",
    [{ type: "text", text: "请告诉我调查员的姓名、职业与年代。" }],
    { stopReason: "stop" },
  ),
  branchEntry("user", [{ type: "text", text: PLAYER_SETUP_ANSWER }]),
];
const pendingAfterToolOnlyBranch = () => [
  ...trailingUserBranch(),
  branchEntry(
    "assistant",
    [
      { type: "thinking", text: "整理姓名与职业，继续建卡。" },
      {
        type: "toolCall",
        id: "call-branch-1",
        name: "coc_setup",
        arguments: { operation: "setup.investigator_contract" },
      },
    ],
    { stopReason: "toolUse" },
  ),
  branchEntry("toolResult", [
    { type: "text", text: "{\"ok\":true,\"tool\":\"setup.investigator_contract\"}" },
  ], { toolCallId: "call-branch-1", toolName: "coc_setup" }),
  branchEntry("assistant", [], { stopReason: "stop" }),
  {
    type: "custom_message",
    customType: "coc-pi-loading",
    content: "正在打开建卡引导……请稍候。",
    display: true,
  },
  {
    type: "custom",
    customType: "coc-tool-telemetry",
    data: { canonical_operation: "progressive.opening_bootstrap" },
  },
];
const clearedByLaterVisibleAssistantBranch = () => [
  ...pendingAfterToolOnlyBranch().slice(0, -2),
  branchEntry(
    "assistant",
    [{ type: "text", text: "已记录：托马斯·里德，记者。请掷运气。" }],
    { stopReason: "stop" },
  ),
];
// String-content role=user turn (plain-text player input): content shape is
// never a prerequisite, so it arms the pending external player fact exactly
// like the array form — parity with the welcome.ts auto-open helper.
const stringContentUserBranch = () => [
  branchEntry(
    "assistant",
    [{ type: "text", text: "请告诉我调查员的姓名、职业与年代。" }],
    { stopReason: "stop" },
  ),
  branchEntry("user", PLAYER_SETUP_ANSWER),
];
const stringClearedByVisibleAssistantBranch = () => [
  ...stringContentUserBranch(),
  branchEntry(
    "assistant",
    [{ type: "text", text: "已记录：托马斯·里德，记者。请掷运气。" }],
    { stopReason: "stop" },
  ),
];
// Image/attachment-only player turn: role=user with structured content but
// no text part at all. It must still arm the pending external player fact.
const attachmentOnlyUserBranch = () => [
  branchEntry(
    "assistant",
    [{ type: "text", text: "把调查员的肖像照片发给我，我替你存档。" }],
    { stopReason: "stop" },
  ),
  branchEntry("user", [
    { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" },
  ]),
];
const attachmentClearedByVisibleAssistantBranch = () => [
  ...attachmentOnlyUserBranch(),
  branchEntry(
    "assistant",
    [{ type: "text", text: "肖像已收到并绑定到调查员卡，建卡继续。" }],
    { stopReason: "stop" },
  ),
];
const PLAIN_OPENING_PROSE = "你放下建卡表格，烛火在桌面摇曳，等待下一句叮嘱。";

for (const mode of ["already_acknowledged", "awaiting_player"]) {
  // Settled branch (last visible output is assistant): quarantine still arms.
  const settledCampaignId = `startup-silent-settled-${mode}`;
  const settled = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected settled ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: settledCampaignId });
  }, settledCampaignId, root, settledAssistantBranch());
  await settled.start();
  const settledToolsBeforeResume = settled.activeTools.length;
  const settledResumed = await invoke(
    settled,
    `silent-settled-${mode}-resume`,
    resumeParams(settledCampaignId),
    "coc_setup",
  );
  assert.equal(settledResumed.ok, true, `settled ${mode}`);
  assert.ok(
    settled.activeTools.length > settledToolsBeforeResume,
    `settled ${mode}: silent resume reapplies the tool surface`,
  );
  assert.ok(
    settled.activeTools
      .slice(settledToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `settled ${mode}: settled assistant history still quarantines`,
  );
  const settledHiddenFinal = await settled.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    settledHiddenFinal.content.some((part) => part.type === "text"),
    false,
    `settled ${mode}: quarantined final stays hidden`,
  );
  await settled.shutdown();

  // Trailing real unmatched role=user: no quarantine, no prompt, no resend.
  const trailingCampaignId = `startup-silent-trailing-${mode}`;
  const trailing = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected trailing ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: trailingCampaignId });
  }, trailingCampaignId, root, trailingUserBranch());
  await trailing.start();
  const trailingToolsBeforeResume = trailing.activeTools.length;
  const trailingSentBeforeResume = trailing.sent.length;
  const trailingResumed = await invoke(
    trailing,
    `silent-trailing-${mode}-resume`,
    resumeParams(trailingCampaignId),
    "coc_setup",
  );
  assert.equal(trailingResumed.ok, true, `trailing ${mode}`);
  assert.equal(trailingResumed.data.mode, mode, `trailing ${mode}`);
  assert.ok(
    trailing.activeTools.length > trailingToolsBeforeResume,
    `trailing ${mode}: silent resume reapplies the tool surface`,
  );
  assert.ok(
    trailing.activeTools
      .slice(trailingToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length > 0),
    `trailing ${mode}: unmatched player user keeps the normal tool surface`,
  );
  const trailingFinal = await trailing.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: PLAIN_OPENING_PROSE }],
    stopReason: "stop",
  });
  const trailingFinalVisible = trailingFinal.content.some(
    (part) => part.type === "text",
  );
  const trailingNormalGateFollowUp = trailing.sent
    .slice(trailingSentBeforeResume)
    .some((entry) => (
      entry.options?.triggerTurn === true
      && entry.options?.deliverAs === "followUp"
      && (
        entry.message?.customType === "coc-mechanical-output-gate"
        || entry.message?.customType === "coc-settled-output-gate"
        || entry.message?.customType === "coc-opening-setup-route"
      )
    ));
  assert.ok(
    trailingFinalVisible || trailingNormalGateFollowUp,
    `trailing ${mode}: final flows through the normal output surface, not silent quarantine`,
  );
  assert.equal(
    trailing.sent.slice(trailingSentBeforeResume).some((entry) => (
      entry.message?.display === true
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `trailing ${mode}: no player-visible prompt, blocker, or resend request`,
  );
  await trailing.shutdown();

  // String-content role=user (plain-text input): same unmatched external
  // player treatment — no quarantine, normal tool surface, no resend — and
  // a later visible assistant settles it so the silent quarantine returns.
  const stringCampaignId = `startup-silent-string-${mode}`;
  const stringContent = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected string ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: stringCampaignId });
  }, stringCampaignId, root, stringContentUserBranch());
  await stringContent.start();
  const stringToolsBeforeResume = stringContent.activeTools.length;
  const stringSentBeforeResume = stringContent.sent.length;
  const stringResumed = await invoke(
    stringContent,
    `silent-string-${mode}-resume`,
    resumeParams(stringCampaignId),
    "coc_setup",
  );
  assert.equal(stringResumed.ok, true, `string ${mode}`);
  assert.equal(stringResumed.data.mode, mode, `string ${mode}`);
  assert.ok(
    stringContent.activeTools.length > stringToolsBeforeResume,
    `string ${mode}: silent resume reapplies the tool surface`,
  );
  assert.ok(
    stringContent.activeTools
      .slice(stringToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length > 0),
    `string ${mode}: string-content player user keeps the normal tool surface`,
  );
  const stringFinal = await stringContent.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: PLAIN_OPENING_PROSE }],
    stopReason: "stop",
  });
  const stringFinalVisible = stringFinal.content.some(
    (part) => part.type === "text",
  );
  const stringNormalGateFollowUp = stringContent.sent
    .slice(stringSentBeforeResume)
    .some((entry) => (
      entry.options?.triggerTurn === true
      && entry.options?.deliverAs === "followUp"
      && (
        entry.message?.customType === "coc-mechanical-output-gate"
        || entry.message?.customType === "coc-settled-output-gate"
        || entry.message?.customType === "coc-opening-setup-route"
      )
    ));
  assert.ok(
    stringFinalVisible || stringNormalGateFollowUp,
    `string ${mode}: final flows through the normal output surface, not silent quarantine`,
  );
  assert.equal(
    stringContent.sent.slice(stringSentBeforeResume).some((entry) => (
      entry.message?.display === true
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `string ${mode}: no player-visible prompt, blocker, or resend request`,
  );
  await stringContent.shutdown();

  // A later assistant entry with non-empty visible text settles that
  // string-content player turn, and the silent quarantine returns.
  const stringClearedCampaignId = `startup-silent-string-cleared-${mode}`;
  const stringCleared = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected string-cleared ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: stringClearedCampaignId });
  }, stringClearedCampaignId, root, stringClearedByVisibleAssistantBranch());
  await stringCleared.start();
  const stringClearedToolsBeforeResume = stringCleared.activeTools.length;
  const stringClearedSentBeforeResume = stringCleared.sent.length;
  const stringClearedResumed = await invoke(
    stringCleared,
    `silent-string-cleared-${mode}-resume`,
    resumeParams(stringClearedCampaignId),
    "coc_setup",
  );
  assert.equal(stringClearedResumed.ok, true, `string-cleared ${mode}`);
  assert.ok(
    stringCleared.activeTools
      .slice(stringClearedToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `string-cleared ${mode}: later visible assistant restores the silent quarantine`,
  );
  const stringClearedHiddenFinal = await stringCleared.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    stringClearedHiddenFinal.content.some((part) => part.type === "text"),
    false,
    `string-cleared ${mode}: quarantined final stays hidden`,
  );
  assert.equal(
    stringCleared.sent.slice(stringClearedSentBeforeResume).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
    )),
    false,
    `string-cleared ${mode}: quarantine sends no follow-up or prompt`,
  );
  await stringCleared.shutdown();

  // Thinking-only/tool-only assistant entries after the user never clear the
  // pending external player turn, so no quarantine arms for them either.
  const pendingCampaignId = `startup-silent-pending-${mode}`;
  const pendingBranch = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected pending ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: pendingCampaignId });
  }, pendingCampaignId, root, pendingAfterToolOnlyBranch());
  await pendingBranch.start();
  const pendingToolsBeforeResume = pendingBranch.activeTools.length;
  const pendingSentBeforeResume = pendingBranch.sent.length;
  const pendingResumed = await invoke(
    pendingBranch,
    `silent-pending-${mode}-resume`,
    resumeParams(pendingCampaignId),
    "coc_setup",
  );
  assert.equal(pendingResumed.ok, true, `pending ${mode}`);
  assert.ok(
    pendingBranch.activeTools
      .slice(pendingToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length > 0),
    `pending ${mode}: thinking/tool-only assistant after user stays pending (no quarantine)`,
  );
  assert.equal(
    pendingBranch.sent.slice(pendingSentBeforeResume).some((entry) => (
      entry.message?.display === true
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `pending ${mode}: no player-visible prompt or resend request`,
  );
  await pendingBranch.shutdown();

  // A later assistant entry with non-empty visible text clears the pending
  // user, and the silent quarantine returns for that settled branch.
  const clearedCampaignId = `startup-silent-cleared-${mode}`;
  const cleared = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected cleared ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: clearedCampaignId });
  }, clearedCampaignId, root, clearedByLaterVisibleAssistantBranch());
  await cleared.start();
  const clearedToolsBeforeResume = cleared.activeTools.length;
  const clearedSentBeforeResume = cleared.sent.length;
  const clearedResumed = await invoke(
    cleared,
    `silent-cleared-${mode}-resume`,
    resumeParams(clearedCampaignId),
    "coc_setup",
  );
  assert.equal(clearedResumed.ok, true, `cleared ${mode}`);
  assert.ok(
    cleared.activeTools
      .slice(clearedToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `cleared ${mode}: later visible assistant restores the silent quarantine`,
  );
  const clearedHiddenFinal = await cleared.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    clearedHiddenFinal.content.some((part) => part.type === "text"),
    false,
    `cleared ${mode}: quarantined final stays hidden`,
  );
  assert.equal(
    cleared.sent.slice(clearedSentBeforeResume).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
    )),
    false,
    `cleared ${mode}: quarantine sends no follow-up or prompt`,
  );
  await cleared.shutdown();

  // An image/attachment-only role=user turn (structured content, zero text)
  // still arms the pending external player turn: exact silent resume modes
  // must NOT quarantine it, and the normal tool/output surface stays up.
  const attachmentCampaignId = `startup-silent-attachment-${mode}`;
  const attachment = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected attachment ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: attachmentCampaignId });
  }, attachmentCampaignId, root, attachmentOnlyUserBranch());
  await attachment.start();
  const attachmentToolsBeforeResume = attachment.activeTools.length;
  const attachmentSentBeforeResume = attachment.sent.length;
  const attachmentResumed = await invoke(
    attachment,
    `silent-attachment-${mode}-resume`,
    resumeParams(attachmentCampaignId),
    "coc_setup",
  );
  assert.equal(attachmentResumed.ok, true, `attachment ${mode}`);
  assert.equal(attachmentResumed.data.mode, mode, `attachment ${mode}`);
  assert.ok(
    attachment.activeTools.length > attachmentToolsBeforeResume,
    `attachment ${mode}: silent resume reapplies the tool surface`,
  );
  assert.ok(
    attachment.activeTools
      .slice(attachmentToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length > 0),
    `attachment ${mode}: attachment-only player user keeps the normal tool surface`,
  );
  const attachmentFinal = await attachment.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: PLAIN_OPENING_PROSE }],
    stopReason: "stop",
  });
  const attachmentFinalVisible = attachmentFinal.content.some(
    (part) => part.type === "text",
  );
  const attachmentNormalGateFollowUp = attachment.sent
    .slice(attachmentSentBeforeResume)
    .some((entry) => (
      entry.options?.triggerTurn === true
      && entry.options?.deliverAs === "followUp"
      && (
        entry.message?.customType === "coc-mechanical-output-gate"
        || entry.message?.customType === "coc-settled-output-gate"
        || entry.message?.customType === "coc-opening-setup-route"
      )
    ));
  assert.ok(
    attachmentFinalVisible || attachmentNormalGateFollowUp,
    `attachment ${mode}: final flows through the normal output surface, not silent quarantine`,
  );
  assert.equal(
    attachment.sent.slice(attachmentSentBeforeResume).some((entry) => (
      entry.message?.display === true
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `attachment ${mode}: no player-visible prompt, blocker, or resend request`,
  );
  await attachment.shutdown();

  // Once a later assistant entry with non-empty visible text settles that
  // attachment-only player turn, the silent quarantine returns.
  const attachmentClearedCampaignId = `startup-silent-attachment-cleared-${mode}`;
  const attachmentCleared = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected attachment-cleared ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: attachmentClearedCampaignId });
  }, attachmentClearedCampaignId, root, attachmentClearedByVisibleAssistantBranch());
  await attachmentCleared.start();
  const attachmentClearedToolsBeforeResume = attachmentCleared.activeTools.length;
  const attachmentClearedSentBeforeResume = attachmentCleared.sent.length;
  const attachmentClearedResumed = await invoke(
    attachmentCleared,
    `silent-attachment-cleared-${mode}-resume`,
    resumeParams(attachmentClearedCampaignId),
    "coc_setup",
  );
  assert.equal(attachmentClearedResumed.ok, true, `attachment-cleared ${mode}`);
  assert.ok(
    attachmentCleared.activeTools
      .slice(attachmentClearedToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `attachment-cleared ${mode}: later visible assistant restores the silent quarantine`,
  );
  const attachmentClearedHiddenFinal = await attachmentCleared.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    attachmentClearedHiddenFinal.content.some((part) => part.type === "text"),
    false,
    `attachment-cleared ${mode}: quarantined final stays hidden`,
  );
  assert.equal(
    attachmentCleared.sent.slice(attachmentClearedSentBeforeResume).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
    )),
    false,
    `attachment-cleared ${mode}: quarantine sends no follow-up or prompt`,
  );
  await attachmentCleared.shutdown();
}

// Non-silent startup resume modes never arm the quarantine, with or without a
// trailing unmatched external player turn.
for (const [mode, nextOperations] of [
  ["open_turn_recovery", ["continue_current_turn_from_receipts"]],
  ["pending_finalization", ["turn.finalize"]],
  ["table_opening", ["evidence.table_opening"]],
]) {
  const campaignId = `startup-trailing-${mode}`;
  const h = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected trailing-user ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, {
      campaign_id: campaignId,
      next_operations: nextOperations,
    });
  }, campaignId, root, trailingUserBranch());
  await h.start();
  const toolsBeforeResume = h.activeTools.length;
  const resumed = await invoke(h, `trailing-${mode}-resume`, resumeParams(campaignId), "coc_setup");
  assert.equal(resumed.ok, true, mode);
  assert.equal(resumed.data.mode, mode, mode);
  assert.ok(
    h.activeTools.length > toolsBeforeResume,
    `${mode}: resume reapplies the tool surface`,
  );
  assert.ok(
    h.activeTools
      .slice(toolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length > 0),
    `${mode}: trailing unmatched user never quarantines non-silent modes`,
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
  silentModesQuarantined: ["already_acknowledged", "awaiting_player"],
  quarantineToolsEmptyUntilAgentEnd: true,
  quarantineHidesMechanicalFinal: true,
  quarantineHidesThinkingOnlyFinal: true,
  quarantineNoEmptyTerminalRecovery: true,
  quarantineNoFollowUpOrDuplicateCall: true,
  quarantineToolsReturnAfterAgentEnd: true,
  nextPlayerTurnAfterQuarantineKeepsNormalTools: true,
  attachmentOnlyUserTurnArmsPending: true,
  attachmentOnlyUserClearedByVisibleAssistant: true,
  stringContentUserTurnArmsPending: true,
  stringContentUserClearedByVisibleAssistant: true,
  nonQuarantineModes: [
    "open_turn_recovery",
    "table_opening",
    "pending_finalization",
  ],
}) + "\n");
