// Focused: session.resume mode table_opening must clear the startup gate.
import "./_lib/preload-embedded-pi.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

delete process.env.PI_SUBAGENT_CHILD;
const root = path.resolve(process.argv[2] || process.cwd());
const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-resume-opening-"));
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const openTurnInput = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/open-turn-player-input.ts"),
);
const exactTextSha256 = (text) => (
  `sha256:${createHash("sha256").update(JSON.stringify(text), "utf8").digest("hex")}`
);

// RuleGraph cutover: the Keeper rolls through rules.settle (rules.roll is a
// host-private adapter). A settled core-check carries its canonical roll under
// settlement.result.bound_check, which is what the gateway projects and
// registers. Shape mirrors tests/fixtures/rules-settle-recorded.
const ORDINARY_CHECK = "decision:coc7:core-check:ordinary-check";
const settleArguments = (decisionId, skill, goal) => ({
  decision_ref: ORDINARY_CHECK,
  decision_id: decisionId,
  semantic_inputs: {
    skill,
    difficulty: "regular",
    difficulty_basis: "keeper_judgment",
    goal,
    stakes: { on_success: `${goal}: done`, on_failure: `${goal}: not done` },
    bonus: 0,
    penalty: 0,
  },
});
const settledCheckEnvelope = (rollId, skill, goal) => ({
  ok: true,
  tool: "rules.settle",
  data: {
    decision_ref: ORDINARY_CHECK,
    family: "core-check",
    status: "settled",
    rule_refs: ["rule:coc7:core-check:canonical-target-binding"],
    investigator_id: "current-investigator",
    event: null,
    player_state_receipt: null,
    current_hp: null,
    conditions: null,
    settlement: {
      existing_result_envelope: true,
      result: {
        bound_check: {
          base_target: 50,
          target: 50,
          required_level: "regular",
          difficulty: "regular",
          required_target: 50,
          effective_target: 50,
          achieved_level: "success",
          passed: true,
          success: true,
          surplus_levels: 0,
          outcome: "success",
          bonus: 0,
          penalty: 0,
          roll: 32,
          unmodified_roll: 32,
          tens_values: [],
          units: null,
          investigator_id: "current-investigator",
          skill,
          target_source: "explicit",
          pushed: false,
          goal,
          stakes: { on_success: `${goal}: done`, on_failure: `${goal}: not done` },
          difficulty_basis: "keeper_judgment",
          roll_id: rollId,
        },
        outcome: "success",
        pushed: false,
        next_continuations: [],
      },
    },
    next_decisions: [],
    authority: "canonical-resolver-state-receipts",
  },
});
// The retired legacy roll must fail closed as host-private on every path,
// independent of the startup gate or the phase ACL.
async function expectHostPrivate(h, id, operation, campaign, workspaceRoot) {
  let message = null;
  try {
    await invoke(h, id, { operation, root: workspaceRoot, campaign, arguments: {} });
  } catch (error) {
    message = String(error?.message ?? error);
  }
  if (message === null || !message.includes("not on the live KP domain surface")) {
    throw new Error(`${operation} must be host-private, got: ${message}`);
  }
}

function harness(responseForCall, startupCampaignId, workspaceRoot = root) {
  const registered = new Map();
  const handlers = new Map();
  const sent = [];
  const calls = [];
  const activeTools = [];
  const fakePi = {
    registerTool: (tool) => registered.set(tool.name, tool),
    registerCommand: () => {},
    registerShortcut: () => {},
    on: (name, handler) => {
      const values = handlers.get(name) || [];
      values.push(handler);
      handlers.set(name, values);
    },
    appendEntry: () => {},
    sendMessage: (message, options) => {
      sent.push({ message, options });
    },
    setActiveTools: (tools) => {
      activeTools.push([...tools]);
    },
    getActiveTools: () => activeTools.at(-1) || [],
    getAllTools: () => [...registered.values()].map((tool) => ({
      name: tool.name,
      parameters: tool.parameters,
    })),
    getThinkingLevel: () => "off",
  };
  main.default(fakePi, {
    coordinatorEnabled: async () => false,
    createClient: () => {
      const callTool = async (name, params) => {
        if (name === "coc_capabilities") return { ok: true, host: "pi" };
        calls.push({ name, params });
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
    cwd: workspaceRoot,
    mode: "rpc",
    model: { provider: "offline", id: "offline" },
    sessionManager: {
      getSessionId: () => "resume-table-opening",
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
    calls,
    activeTools,
    ctx,
    async start() {
      for (const handler of handlers.get("session_start") || []) {
        await handler({ reason: "startup" }, ctx);
      }
      for (const handler of handlers.get("agent_start") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
    async emit(name, message) {
      for (const handler of handlers.get(name) || []) {
        await handler({ message }, ctx);
      }
    },
    async shutdown() {
      for (const handler of handlers.get("agent_end") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
  };
}

async function invoke(h, id, params) {
  return JSON.parse((await h.registered.get("coc_invoke").execute(
    id,
    params,
    undefined,
    undefined,
    h.ctx,
  )).content[0].text);
}

const campaignId = "startup-table-opening-campaign";
const h = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation === "session.resume") {
    if (params.root !== root || params.campaign !== campaignId) {
      throw new Error(`startup resume identity was not host-bound: ${JSON.stringify(params)}`);
    }
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaignId,
        mode: "table_opening",
        next_operations: ["evidence.table_opening"],
      },
    };
  }
  if (params.operation === "evidence.table_opening") {
    return {
      ok: true,
      tool: "evidence.table_opening",
      data: { schema_version: 1, campaign_id: campaignId, text: "开场" },
    };
  }
  throw new Error(`unexpected ${params.operation}`);
}, campaignId);
await h.start();
const resumed = await invoke(h, "resume", {
  operation: "session.resume",
  root: `${root}-model-copy-typo`,
  campaign: `${campaignId}-model-copy-typo`,
  arguments: {},
});
const opening = JSON.parse((await h.registered.get(
  "coc_evidence_table_opening",
).execute(
  "opening",
  { text: "开场", presented_roll_ids: [] },
  undefined,
  undefined,
  h.ctx,
)).content[0].text);
const blocked = h.sent.some((entry) => (
  entry.message?.customType === "coc-startup-resume-blocker"
));
if (resumed.ok !== true || resumed.data.mode !== "table_opening") {
  throw new Error(`legal resume rejected: ${JSON.stringify(resumed)}`);
}
if (opening.ok !== true || opening.tool !== "evidence.table_opening") {
  throw new Error(`table_opening blocked after legal resume: ${JSON.stringify(opening)}`);
}
if (blocked) throw new Error("legal table_opening resume published startup blocker");
await h.shutdown();

const bad = harness((name, params) => {
  if (params.operation === "session.resume") {
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaignId,
        mode: "not_a_real_mode",
      },
    };
  }
  throw new Error(`illegal path escaped: ${params.operation}`);
}, campaignId);
await bad.start();
await invoke(bad, "bad-resume", {
  operation: "session.resume",
  root,
  campaign: campaignId,
  arguments: {},
});
const illegalBlocked = bad.sent.some((entry) => (
  entry.message?.customType === "coc-startup-resume-blocker"
  && entry.message?.details?.failure_class === "startup_resume_result_invalid"
));
if (!illegalBlocked) {
  throw new Error("illegal resume did not terminalize startup_resume_result_invalid");
}
let escaped = false;
try {
  await invoke(bad, "blocked-opening", {
    operation: "evidence.table_opening",
    root,
    campaign: campaignId,
    arguments: { decision_id: "opening-1" },
  });
  escaped = true;
} catch {
  // host-blocked after terminal startup resume
}
if (escaped) throw new Error("evidence.table_opening escaped after illegal resume");
await bad.shutdown();

const playedCampaign = "startup-played-table-opening";
const playedRoot = mkdtempSync(path.join(tmpdir(), "pi-coc-played-startup-"));
mkdirSync(
  path.join(playedRoot, ".coc", "campaigns", playedCampaign, "logs"),
  { recursive: true },
);
writeFileSync(
  path.join(
    playedRoot, ".coc", "campaigns", playedCampaign, "logs", "table-transcript.jsonl",
  ),
  `${JSON.stringify({ role: "keeper", turn: 2 })}\n`,
);
const prevRole = process.env.COC_PI_SESSION_ROLE;
process.env.COC_PI_SESSION_ROLE = "play";
const played = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation === "session.resume") {
    if (params.root !== playedRoot || params.campaign !== playedCampaign) {
      throw new Error(`startup resume selectors were not host-bound: ${JSON.stringify(params)}`);
    }
    if (
      JSON.stringify(params.arguments)
      !== JSON.stringify({ host_session_id: "resume-table-opening" })
    ) {
      throw new Error(`startup resume carried model arguments: ${JSON.stringify(params)}`);
    }
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: playedCampaign,
        mode: "table_opening",
        next_operations: ["evidence.table_opening"],
        checkpoint: {
          turn_number: 2,
          source: { finalization_id: "turn-effect-v1:played-startup" },
        },
        delivery: {
          status: "unconfirmed",
          finalization_id: "turn-effect-v1:played-startup",
          rendered_sha256: "sha256:played",
        },
      },
    };
  }
  if (params.operation === "rules.settle") {
    return settledCheckEnvelope(
      "toolbox-startup-opening-000001",
      "Spot Hidden",
      "notice the detail",
    );
  }
  if (params.operation === "state.journal") {
    return { ok: true, tool: "state.journal", data: { entries: [] } };
  }
  if (params.operation === "turn.finalize") {
    const renderedText = "结算";
    return {
      ok: true,
      tool: "turn.finalize",
      data: {
        rendered_text: renderedText,
        rendered_text_sha256: exactTextSha256(renderedText),
      },
    };
  }
  throw new Error(`unexpected ${params.operation}`);
}, playedCampaign, playedRoot);
try {
  await played.start();
  const startupResumeTool = played.registered.get("coc_session_resume");
  if (
    startupResumeTool.parameters.type !== "object"
    || Object.keys(startupResumeTool.parameters.properties ?? {}).length !== 0
    || (startupResumeTool.parameters.required ?? []).length !== 0
    || startupResumeTool.parameters.additionalProperties !== false
  ) {
    throw new Error(
      `startup resume schema must be host-only: ${JSON.stringify(startupResumeTool.parameters)}`,
    );
  }
  const pendingTools = played.activeTools.at(-1) || [];
  if (!pendingTools.includes("coc_session_resume")) {
    throw new Error(`pending schema missing recovery coc_session_resume: ${pendingTools}`);
  }
  for (const projected of ["coc_rules_settle", "coc_rules_context", "coc_turn_finalize"]) {
    if (!pendingTools.includes(projected)) {
      throw new Error(`pending schema missing projected table tool ${projected}: ${pendingTools}`);
    }
  }
  if (pendingTools.includes("coc_rules_roll")) {
    throw new Error(`pending schema still projects the retired coc_rules_roll: ${pendingTools}`);
  }
  let pendingRulesEscaped = false;
  try {
    await invoke(played, "pending-rules", {
      operation: "rules.settle",
      root: playedRoot,
      campaign: playedCampaign,
      arguments: settleArguments(
        "roll-startup-opening-spot-hidden-1",
        "Spot Hidden",
        "notice the detail",
      ),
    });
    pendingRulesEscaped = true;
  } catch {
    // startupResumeToolError must still hard-reject non-resume
  }
  if (pendingRulesEscaped) {
    throw new Error("rules.settle escaped before session.resume");
  }
  const playedResume = JSON.parse((await startupResumeTool.execute(
    "played-resume",
    {
      root: `${playedRoot}-model-typo`,
      campaign: `${playedCampaign}-model-typo`,
      investigator: "current-investigator",
    },
    undefined,
    undefined,
    played.ctx,
  )).content[0].text);
  if (playedResume.ok !== true || playedResume.data.mode !== "table_opening") {
    throw new Error(`played resume rejected: ${JSON.stringify(playedResume)}`);
  }
  const afterResumeTools = played.activeTools.at(-1) || [];
  if (!afterResumeTools.includes("coc_rules_settle") || afterResumeTools.includes("coc_setup")) {
    throw new Error(`live turn collapsed to recovery-only: ${afterResumeTools}`);
  }
  // Only once the startup gate has cleared does the ACL speak: the retired
  // roll is host-private on the live table, not merely gated.
  await expectHostPrivate(played, "live-legacy-roll", "rules.roll", playedCampaign, playedRoot);
  const sameRequestRoll = await invoke(played, "same-request-roll", {
    operation: "rules.settle",
    root: playedRoot,
    campaign: playedCampaign,
    arguments: settleArguments(
      "roll-startup-opening-spot-hidden-1",
      "Spot Hidden",
      "notice the detail",
    ),
  });
  const sameRequestJournal = await invoke(played, "same-request-journal", {
    operation: "state.journal",
    root: playedRoot,
    campaign: playedCampaign,
    arguments: { summary: "The investigator notices the detail." },
  });
  const sameRequestFinalize = await invoke(played, "same-request-finalize", {
    operation: "turn.finalize",
    root: playedRoot,
    campaign: playedCampaign,
    arguments: { draft: "结算", coverage: [], agency_claims: [] },
  });
  if (sameRequestRoll.ok !== true || sameRequestRoll.tool !== "rules.settle") {
    throw new Error(`same-request rules.settle blocked: ${JSON.stringify(sameRequestRoll)}`);
  }
  const sameRequestHandle = sameRequestRoll.data?.settlement?.result?.bound_check?.roll_id;
  if (typeof sameRequestHandle !== "string" || !sameRequestHandle.startsWith("roll:")) {
    throw new Error(`settled roll must present a semantic handle: ${JSON.stringify(sameRequestRoll)}`);
  }
  if (sameRequestJournal.ok !== true || sameRequestJournal.tool !== "state.journal") {
    throw new Error(`same-request journal blocked: ${JSON.stringify(sameRequestJournal)}`);
  }
  if (sameRequestFinalize.ok !== true || sameRequestFinalize.tool !== "turn.finalize") {
    throw new Error(`same-request finalize blocked: ${JSON.stringify(sameRequestFinalize)}`);
  }
  await played.shutdown();
} finally {
  if (prevRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
  else process.env.COC_PI_SESSION_ROLE = prevRole;
}

async function expectRejected(h, id, params, label) {
  let passed = false;
  try {
    await invoke(h, id, params);
    passed = true;
  } catch {
    // startup gate or phase ACL must reject
  }
  if (passed) throw new Error(`${label} escaped`);
}

const recoveryCampaign = "startup-open-turn-recovery";
const recoveryWorkspace = mkdtempSync(path.join(tmpdir(), "pi-coc-startup-recovery-"));
mkdirSync(path.join(recoveryWorkspace, ".coc", "campaigns", recoveryCampaign), {
  recursive: true,
});
const recoveryAnchor = openTurnInput.createOpenTurnAnchor({
  timelineId: "timeline-main",
  priorFinalizedTurn: 1,
  priorFinalizedSourceDigest: `sha256:${"c".repeat(64)}`,
});
openTurnInput.recordOpenTurnPlayerInput({
  root: recoveryWorkspace,
  campaignId: recoveryCampaign,
  sessionId: "prior-natural-player-session",
  playerTurnEpoch: 2,
  text: "我仔细包扎右手伤口。",
  anchor: recoveryAnchor,
});
const recovery = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation === "session.resume") {
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: recoveryCampaign,
        mode: "open_turn_recovery",
        next_operations: ["continue_current_turn_from_receipts"],
        open_turn_anchor: recoveryAnchor,
        current_turn: {
          schema_version: 1,
          meaningful_row_count: 1,
          source_digest: `sha256:${"d".repeat(64)}`,
          rows: [{ call_index: 1, tool: "actions.list", ok: true }],
        },
      },
    };
  }
  if (params.operation === "scene.context") {
    return {
      ok: true,
      tool: "scene.context",
      data: { campaign_id: recoveryCampaign, active_scene_id: "office" },
    };
  }
  if (params.operation === "turn.output_context") {
    return {
      ok: true,
      tool: "turn.output_context",
      data: {
        turn_id: "turn-recovery-startup",
        source_digest: `sha256:${"a".repeat(64)}`,
        settlement_snapshot_id: "turn-settlement-v1:recovery-startup",
        mechanics_bundle_sha256: `sha256:${"b".repeat(64)}`,
        contract_projection: {
          agency_review_required: false,
          agency_authority: { pc_subject_refs: ["pc:recovery-startup"] },
        },
        finalize_operation: {
          operation: "turn.finalize",
          prefilled_arguments: { revision: 1 },
        },
      },
    };
  }
  if (params.operation === "state.journal") {
    return {
      ok: true,
      tool: "state.journal",
      data: { turn_id: "turn-recovery-startup", turn_number: 2, entries: [] },
    };
  }
  if (params.operation === "turn.finalize") {
    const renderedText = "闭合";
    return {
      ok: true,
      tool: "turn.finalize",
      data: {
        rendered_text: renderedText,
        rendered_text_sha256: exactTextSha256(renderedText),
        source_digest: `sha256:${"9".repeat(64)}`,
      },
    };
  }
  if (params.operation === "rules.settle") {
    return settledCheckEnvelope(
      "toolbox-startup-recovery-000001",
      "First Aid",
      "包扎右手伤口",
    );
  }
  if (
    params.operation === "state.move_scene"
    || params.operation === "state.item_grant"
  ) {
    return { ok: true, tool: params.operation, data: { leaked: true } };
  }
  throw new Error(`unexpected ${params.operation}`);
}, recoveryCampaign, recoveryWorkspace);
await recovery.start();
const pendingClosure = [
  ["pending-output", "turn.output_context"],
  ["pending-journal", "state.journal"],
  ["pending-finalize", "turn.finalize"],
  ["pending-settle", "rules.settle"],
  ["pending-context", "rules.context"],
  ["pending-move", "state.move_scene"],
];
for (const [id, operation] of pendingClosure) {
  await expectRejected(recovery, id, {
    operation,
    root,
    campaign: recoveryCampaign,
    arguments: {},
  }, `pending ${operation}`);
}
const recovered = await invoke(recovery, "recovery-resume", {
  operation: "session.resume",
  root: recoveryWorkspace,
  campaign: recoveryCampaign,
  arguments: {},
});
if (recovered.ok !== true || recovered.data.mode !== "open_turn_recovery") {
  throw new Error(`legal recovery resume rejected: ${JSON.stringify(recovered)}`);
}
const afterResumeScene = await invoke(recovery, "recovery-scene", {
  operation: "scene.context",
  root: recoveryWorkspace,
  campaign: recoveryCampaign,
  arguments: {},
});
await expectRejected(recovery, "recovery-output-before-journal", {
  operation: "turn.output_context",
  root: recoveryWorkspace,
  campaign: recoveryCampaign,
  arguments: {},
}, "recovery output before journal");
await expectHostPrivate(recovery, "recovery-legacy-roll", "rules.roll", recoveryCampaign, recoveryWorkspace);
const afterResumeRule = await invoke(recovery, "recovery-rule", {
  operation: "rules.settle",
  root: recoveryWorkspace,
  campaign: recoveryCampaign,
  arguments: settleArguments("roll-recovered-first-aid", "First Aid", "包扎右手伤口"),
});
if (afterResumeRule.ok !== true || afterResumeRule.tool !== "rules.settle") {
  throw new Error(`rules path blocked during recovered acting: ${JSON.stringify(afterResumeRule)}`);
}
const afterResumeJournal = await invoke(recovery, "recovery-journal", {
  operation: "state.journal",
  root: recoveryWorkspace,
  campaign: recoveryCampaign,
  arguments: { summary: "Continue the retained recovery turn." },
});
if (afterResumeScene.ok !== true || afterResumeScene.tool !== "scene.context") {
  throw new Error(`scene.context blocked after recovery resume: ${JSON.stringify(afterResumeScene)}`);
}
if (afterResumeJournal.ok !== true || afterResumeJournal.tool !== "state.journal") {
  throw new Error(`journal blocked after recovery resume: ${JSON.stringify(afterResumeJournal)}`);
}
for (const [id, operation] of [
  ["recovery-settle", "rules.settle"],
  ["recovery-move", "state.move_scene"],
  ["recovery-grant", "state.item_grant"],
]) {
  await expectRejected(recovery, id, {
    operation,
    root: recoveryWorkspace,
    campaign: recoveryCampaign,
    arguments: {},
  }, `recovery ${operation}`);
}
const afterResumeOutput = await invoke(recovery, "recovery-output", {
  operation: "turn.output_context",
  root: recoveryWorkspace,
  campaign: recoveryCampaign,
  arguments: {},
});
if (afterResumeOutput.ok !== true || afterResumeOutput.tool !== "turn.output_context") {
  throw new Error(`output_context blocked after recovery journal: ${JSON.stringify(afterResumeOutput)}`);
}
const afterResumeFinalize = await invoke(recovery, "recovery-finalize", {
  operation: "turn.finalize",
  root: recoveryWorkspace,
  campaign: recoveryCampaign,
  arguments: { draft: "闭合", coverage: [], agency_claims: [] },
});
if (afterResumeFinalize.ok !== true || afterResumeFinalize.tool !== "turn.finalize") {
  throw new Error(`finalize blocked after recovery resume: ${JSON.stringify(afterResumeFinalize)}`);
}
const nextTurnAnchor = openTurnInput.createOpenTurnAnchor({
  timelineId: "timeline-main",
  priorFinalizedTurn: 2,
  priorFinalizedSourceDigest: `sha256:${"9".repeat(64)}`,
});
await recovery.emit("message_start", {
  role: "user",
  content: [{ type: "text", text: "下一轮，我检查包扎是否稳固。" }],
});
const nextTurnCached = openTurnInput.loadOpenTurnPlayerInput({
  root: recoveryWorkspace,
  campaignId: recoveryCampaign,
  anchor: nextTurnAnchor,
  currentTurn: {
    meaningful_row_count: 1,
    source_digest: `sha256:${"8".repeat(64)}`,
    rows: [{ tool: "actions.list", ok: true }],
  },
});
if (nextTurnCached.ok !== true || nextTurnCached.card.text !== "下一轮，我检查包扎是否稳固。") {
  throw new Error(`next-turn anchor did not roll forward: ${JSON.stringify(nextTurnCached)}`);
}
await recovery.shutdown();

console.log("startup-resume-table-opening ok");
