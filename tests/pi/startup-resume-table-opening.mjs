// Focused: session.resume mode table_opening must clear the startup gate.
import "./_lib/preload-embedded-pi.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-resume-opening-"));
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));

function harness(responseForCall, startupCampaignId) {
  const registered = new Map();
  const handlers = new Map();
  const sent = [];
  const calls = [];
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
    setActiveTools: () => {},
    getThinkingLevel: () => "off",
  };
  main.default(fakePi, {
    coordinatorEnabled: async () => false,
    createClient: () => ({
      callTool: async (name, params) => {
        if (name === "coc_capabilities") return { ok: true, host: "pi" };
        calls.push({ name, params });
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

console.log("startup-resume-table-opening ok");
