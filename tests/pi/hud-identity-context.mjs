import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { hudRefreshErrorMessage, registerCocHud } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/hud.ts")
);
const { CanonicalToolError } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts")
);

const setupOnboarding = new CanonicalToolError(
  "coc_invoke",
  "opening_setup_incomplete",
  "MUST_NOT_SHOW_RETAINED_ROUTE",
  {
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_source_materialization",
    source_lifecycle_status: "pending",
  },
);
if (hudRefreshErrorMessage(setupOnboarding) !== null) {
  throw new Error("ordinary setup route was exposed as a HUD failure");
}
const terminalSetup = new CanonicalToolError(
  "coc_invoke",
  "opening_setup_incomplete",
  "terminal details",
  {
    hard_gate: true,
    activation_allowed: false,
    phase: "opening_source_materialization",
    source_lifecycle_status: "refused_terminal",
  },
);
if (!hudRefreshErrorMessage(terminalSetup)?.includes("refused_terminal")) {
  throw new Error("terminal setup failure was hidden as onboarding");
}
const invalidCampaign = new CanonicalToolError(
  "coc_invoke",
  "setup_failed",
  "unknown campaign",
);
if (!hudRefreshErrorMessage(invalidCampaign)?.includes("setup_failed")) {
  throw new Error("invalid campaign failure was hidden");
}
if (!hudRefreshErrorMessage(new Error("MCP child exited"))?.includes(
  "MCP child exited",
)) {
  throw new Error("generic transport failure was hidden");
}

const handlers = new Map();
const commands = new Map();
const pi = {
  registerCommand(name, command) {
    commands.set(name, command);
  },
  registerShortcut() {},
  on(type, handler) {
    const rows = handlers.get(type) || [];
    rows.push(handler);
    handlers.set(type, rows);
  },
};
const scenes = {
  "campaign-a": {
    campaign_id: "campaign-a",
    party: ["inv-a", "inv-b"],
    party_investigators: [
      { investigator_id: "inv-a", name: "A" },
      { investigator_id: "inv-b", name: "B" },
    ],
    keeper_only: { secret: "MUST_NOT_LEAK" },
  },
  "campaign-b": {
    campaign_id: "campaign-b",
    party: ["inv-c"],
    party_investigators: [{ investigator_id: "inv-c", name: "C" }],
  },
  "campaign-empty": {
    campaign_id: "campaign-empty",
    party: [],
    party_investigators: [],
  },
};
const client = {
  async callTool(_name, args) {
    if (args.operation === "scene.context") {
      return { data: scenes[args.campaign] };
    }
    if (args.operation === "state.inventory_list") {
      return { data: { items: [], weapons: [] } };
    }
    throw new Error(`unexpected operation ${args.operation}`);
  },
};
registerCocHud(pi, () => client);

const ctx = {
  hasUI: true,
  ui: {
    setFooter() {},
    setWidget() {},
    notify() {},
    select: async () => undefined,
    custom: async () => null,
  },
};
const contextHandler = handlers.get("context")[0];
const hudCommand = commands.get("hud");
if (!contextHandler || !hudCommand?.handler) {
  throw new Error("HUD identity context registration missing");
}

const unbound = await contextHandler({ messages: [] }, ctx);
if (unbound !== undefined) throw new Error("unbound HUD emitted identity");

await hudCommand.handler("bind campaign-a", ctx);
const first = await contextHandler({ messages: [] }, ctx);
const firstMessage = first?.messages?.[0];
if (!firstMessage) throw new Error("bound HUD omitted identity");
if (firstMessage.role !== "custom" || firstMessage.display !== false) {
  throw new Error("identity context is player-visible or wrong role");
}
if (
  firstMessage.details?.contract_id !== "coc.pi-active-table-identity.v1"
) throw new Error("identity details contract drift");
const firstText = firstMessage.content?.[0]?.text || "";
const firstBinding = JSON.parse(firstText.slice(firstText.indexOf("\n") + 1));
if (
  firstBinding.campaign_id !== "campaign-a"
  || JSON.stringify(firstBinding.investigator_ids)
    !== JSON.stringify(["inv-a", "inv-b"])
) throw new Error(`multi-party identity drift: ${JSON.stringify(firstBinding)}`);
if (
  Object.hasOwn(firstBinding, "investigator_id")
  || Object.hasOwn(firstBinding, "selected_investigator_id")
) throw new Error("multi-party binding selected one investigator");
const serializedFirst = JSON.stringify(firstMessage);
for (const forbidden of [
  "MUST_NOT_LEAK", "keeper_only", "source_page", "tool_output", "transcript",
]) {
  if (serializedFirst.includes(forbidden)) {
    throw new Error(`identity context leaked ${forbidden}`);
  }
}

for (const handler of handlers.get("tool_result") || []) {
  await handler({
    toolName: "coc_invoke",
    input: {
      operation: "clues.query",
      campaign: "remembered-wrong-campaign",
      arguments: {},
    },
    details: {
      ok: true,
      data: { campaign_id: "remembered-wrong-campaign" },
    },
  }, ctx);
  await handler({
    toolName: "coc_invoke",
    input: {
      operation: "session.resume",
      campaign: "campaign-b",
      arguments: {},
    },
    details: {
      ok: false,
      error: { code: "resume_failed" },
    },
  }, ctx);
}
const afterDrift = await contextHandler({ messages: [] }, ctx);
const afterDriftText = afterDrift?.messages?.[0]?.content?.[0]?.text || "";
if (
  !afterDriftText.includes('"campaign_id":"campaign-a"')
  || afterDriftText.includes("remembered-wrong-campaign")
) throw new Error("model-authored campaign drift replaced HUD binding");

for (const handler of handlers.get("tool_result") || []) {
  await handler({
    toolName: "coc_invoke",
    input: {
      operation: "session.resume",
      campaign: "campaign-b",
      arguments: {},
    },
    details: {
      ok: true,
      data: {
        campaign_id: "campaign-b",
        host_context: {
          acknowledged: { campaign_id: "campaign-b" },
        },
      },
    },
  }, ctx);
}
const refreshed = await contextHandler({ messages: [] }, ctx);
const refreshedText = refreshed?.messages?.[0]?.content?.[0]?.text || "";
const refreshedBinding = JSON.parse(
  refreshedText.slice(refreshedText.indexOf("\n") + 1),
);
if (
  refreshedBinding.campaign_id !== "campaign-b"
  || JSON.stringify(refreshedBinding.investigator_ids)
    !== JSON.stringify(["inv-c"])
  || refreshedText.includes("campaign-a")
  || refreshedText.includes("inv-a")
) throw new Error("identity did not atomically refresh after session.resume");

await hudCommand.handler("bind campaign-empty", ctx);
const empty = await contextHandler({ messages: [] }, ctx);
if (empty !== undefined) throw new Error("empty party identity did not fail closed");

// A slow pre-link refresh must not cause the canonical link-triggered refresh
// to be dropped. This is the R8 ordering: empty party read in flight, then the
// setup.invoke link receipt arrives before the first read returns.
const coalescedHandlers = new Map();
const coalescedCommands = new Map();
const coalescedPi = {
  registerCommand(name, command) {
    coalescedCommands.set(name, command);
  },
  registerShortcut() {},
  on(type, handler) {
    const rows = coalescedHandlers.get(type) || [];
    rows.push(handler);
    coalescedHandlers.set(type, rows);
  },
};
let releasePreLink;
const preLinkGate = new Promise((resolve) => {
  releasePreLink = resolve;
});
let sceneReads = 0;
const coalescedClient = {
  async callTool(_name, args) {
    if (args.operation === "scene.context") {
      sceneReads += 1;
      if (sceneReads === 1) {
        await preLinkGate;
        return {
          data: {
            campaign_id: "campaign-r8",
            party: [],
            party_investigators: [],
          },
        };
      }
      return {
        data: {
          campaign_id: "campaign-r8",
          party: ["aedric-hunter"],
          party_investigators: [{
            investigator_id: "aedric-hunter",
            name: "Aedric",
          }],
        },
      };
    }
    if (args.operation === "state.inventory_list") {
      return { data: { items: [], weapons: [] } };
    }
    throw new Error(`unexpected operation ${args.operation}`);
  },
};
const coalescedHud = registerCocHud(coalescedPi, () => coalescedClient);
const bindR8 = coalescedCommands.get("hud").handler(
  "bind campaign-r8",
  ctx,
);
await Promise.resolve();
for (const handler of coalescedHandlers.get("tool_result") || []) {
  await handler({
    toolName: "coc_invoke",
    input: {
      operation: "setup.invoke",
      campaign: "campaign-r8",
      arguments: {
        kind: "campaign.link_investigator",
        payload: {
          campaign_id: "campaign-r8",
          investigator_ids: ["aedric-hunter"],
        },
      },
    },
    details: {
      ok: true,
      data: {
        result: {
          campaign_id: "campaign-r8",
          investigator_ids: ["aedric-hunter"],
        },
      },
    },
  }, ctx);
}
releasePreLink();
await bindR8;
const linkedSnapshot = coalescedHud.getSnapshot();
if (
  sceneReads !== 2
  || linkedSnapshot?.investigators?.[0]?.id !== "aedric-hunter"
) {
  throw new Error(
    `link refresh was not coalesced: ${JSON.stringify({ sceneReads, linkedSnapshot })}`,
  );
}

process.stdout.write(JSON.stringify({
  ok: true,
  hidden: firstMessage.display === false,
  firstBinding,
  driftPreserved: true,
  authoritativeResume: true,
  refreshedBinding,
  emptyOmitted: empty === undefined,
  linkRefreshCoalesced: true,
  setupErrorClassified: true,
}));
