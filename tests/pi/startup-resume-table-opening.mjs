// Focused: session.resume mode table_opening must clear the startup gate.
import "./_lib/preload-embedded-pi.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

delete process.env.PI_SUBAGENT_CHILD;
const root = path.resolve(process.argv[2] || process.cwd());
const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-resume-opening-"));
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));

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
  root,
  campaign: campaignId,
  arguments: {},
});
const opening = await invoke(h, "opening", {
  operation: "evidence.table_opening",
  root,
  campaign: campaignId,
  arguments: { decision_id: "opening-1" },
});
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
  if (params.operation === "rules.roll") {
    return { ok: true, tool: "rules.roll", data: { total: 50 } };
  }
  if (params.operation === "state.journal") {
    return { ok: true, tool: "state.journal", data: { entries: [] } };
  }
  if (params.operation === "turn.finalize") {
    return {
      ok: true,
      tool: "turn.finalize",
      data: { rendered_text: "结算", rendered_sha256: "sha256:fin" },
    };
  }
  throw new Error(`unexpected ${params.operation}`);
}, playedCampaign, playedRoot);
try {
  await played.start();
  const pendingTools = played.activeTools.at(-1) || [];
  if (!pendingTools.includes("coc_session_resume")) {
    throw new Error(`pending schema missing recovery coc_session_resume: ${pendingTools}`);
  }
  if (!pendingTools.includes("coc_rules_roll") || !pendingTools.includes("coc_turn_finalize")) {
    throw new Error(`pending schema missing projected table tools: ${pendingTools}`);
  }
  let pendingRulesEscaped = false;
  try {
    await invoke(played, "pending-rules", {
      operation: "rules.roll",
      root: playedRoot,
      campaign: playedCampaign,
      arguments: { skill: "Spot Hidden" },
    });
    pendingRulesEscaped = true;
  } catch {
    // startupResumeToolError must still hard-reject non-resume
  }
  if (pendingRulesEscaped) {
    throw new Error("rules.roll escaped before session.resume");
  }
  const playedResume = await invoke(played, "played-resume", {
    operation: "session.resume",
    root: playedRoot,
    campaign: playedCampaign,
    arguments: {},
  });
  if (playedResume.ok !== true || playedResume.data.mode !== "table_opening") {
    throw new Error(`played resume rejected: ${JSON.stringify(playedResume)}`);
  }
  const sameRequestRoll = await invoke(played, "same-request-roll", {
    operation: "rules.roll",
    root: playedRoot,
    campaign: playedCampaign,
    arguments: { skill: "Spot Hidden" },
  });
  const sameRequestJournal = await invoke(played, "same-request-journal", {
    operation: "state.journal",
    root: playedRoot,
    campaign: playedCampaign,
    arguments: {},
  });
  const sameRequestFinalize = await invoke(played, "same-request-finalize", {
    operation: "turn.finalize",
    root: playedRoot,
    campaign: playedCampaign,
    arguments: { decision_id: "fin-1" },
  });
  if (sameRequestRoll.ok !== true || sameRequestRoll.tool !== "rules.roll") {
    throw new Error(`same-request rules.roll blocked: ${JSON.stringify(sameRequestRoll)}`);
  }
  if (sameRequestJournal.ok !== true || sameRequestJournal.tool !== "state.journal") {
    throw new Error(`same-request journal blocked: ${JSON.stringify(sameRequestJournal)}`);
  }
  if (sameRequestFinalize.ok !== true || sameRequestFinalize.tool !== "turn.finalize") {
    throw new Error(`same-request finalize blocked: ${JSON.stringify(sameRequestFinalize)}`);
  }
  const afterResumeTools = played.activeTools.at(-1) || [];
  if (!afterResumeTools.includes("coc_rules_roll") || afterResumeTools.includes("coc_setup")) {
    throw new Error(`live turn collapsed to recovery-only: ${afterResumeTools}`);
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
      },
    };
  }
  if (params.operation === "turn.output_context") {
    return { ok: true, tool: "turn.output_context", data: { obligations: [] } };
  }
  if (params.operation === "state.journal") {
    return { ok: true, tool: "state.journal", data: { entries: [] } };
  }
  if (params.operation === "turn.finalize") {
    return {
      ok: true,
      tool: "turn.finalize",
      data: { rendered_text: "闭合", rendered_sha256: "sha256:recovery-fin" },
    };
  }
  if (
    params.operation === "rules.roll"
    || params.operation === "state.move_scene"
    || params.operation === "state.item_grant"
  ) {
    return { ok: true, tool: params.operation, data: { leaked: true } };
  }
  throw new Error(`unexpected ${params.operation}`);
}, recoveryCampaign);
await recovery.start();
const pendingClosure = [
  ["pending-output", "turn.output_context"],
  ["pending-journal", "state.journal"],
  ["pending-finalize", "turn.finalize"],
  ["pending-roll", "rules.roll"],
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
  root,
  campaign: recoveryCampaign,
  arguments: {},
});
if (recovered.ok !== true || recovered.data.mode !== "open_turn_recovery") {
  throw new Error(`legal recovery resume rejected: ${JSON.stringify(recovered)}`);
}
const afterResumeOutput = await invoke(recovery, "recovery-output", {
  operation: "turn.output_context",
  root,
  campaign: recoveryCampaign,
  arguments: {},
});
const afterResumeJournal = await invoke(recovery, "recovery-journal", {
  operation: "state.journal",
  root,
  campaign: recoveryCampaign,
  arguments: {},
});
if (afterResumeOutput.ok !== true || afterResumeOutput.tool !== "turn.output_context") {
  throw new Error(`output_context blocked after recovery resume: ${JSON.stringify(afterResumeOutput)}`);
}
if (afterResumeJournal.ok !== true || afterResumeJournal.tool !== "state.journal") {
  throw new Error(`journal blocked after recovery resume: ${JSON.stringify(afterResumeJournal)}`);
}
for (const [id, operation] of [
  ["recovery-roll", "rules.roll"],
  ["recovery-move", "state.move_scene"],
  ["recovery-grant", "state.item_grant"],
]) {
  await expectRejected(recovery, id, {
    operation,
    root,
    campaign: recoveryCampaign,
    arguments: {},
  }, `recovery ${operation}`);
}
const afterResumeFinalize = await invoke(recovery, "recovery-finalize", {
  operation: "turn.finalize",
  root,
  campaign: recoveryCampaign,
  arguments: { decision_id: "recovery-fin-1" },
});
if (afterResumeFinalize.ok !== true || afterResumeFinalize.tool !== "turn.finalize") {
  throw new Error(`finalize blocked after recovery resume: ${JSON.stringify(afterResumeFinalize)}`);
}
await recovery.shutdown();

console.log("startup-resume-table-opening ok");
