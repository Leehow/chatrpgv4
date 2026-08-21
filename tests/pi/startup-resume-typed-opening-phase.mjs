// Typed coc_session_resume + additive opening_phase must not terminalize
// the startup gate. The host identifies session.resume by operation, not
// by CanonicalToolError.toolName, and treats opening_setup_incomplete as
// an opening-lifecycle fact when opening_phase is still setup.
import "./_lib/preload-embedded-pi.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

delete process.env.PI_SUBAGENT_CHILD;
process.env.COC_PI_SESSION_ROLE = "setup";
const root = path.resolve(process.argv[2] || process.cwd());
const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-typed-opening-"));
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const runtime = await import(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts"));

function harness(responseForCall, startupCampaignId) {
  const registered = new Map();
  const handlers = new Map();
  const sent = [];
  const activeToolSnapshots = [];
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
    setActiveTools: (tools) => activeToolSnapshots.push([...tools]),
    getThinkingLevel: () => "off",
  };
  main.default(fakePi, {
    coordinatorEnabled: async () => false,
    createClient: () => ({
      callToolWithTransportMeta: async (name, params) => ({
        value: name === "coc_capabilities"
          ? { ok: true, host: "pi" }
          : await responseForCall(name, params),
        transport: null,
      }),
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
      getSessionId: () => "typed-opening-phase",
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
    activeToolSnapshots,
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

async function invokeTyped(h, toolName, id, params) {
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

function throwResumeGate(details) {
  const envelope = {
    ok: false,
    tool: "session.resume",
    error: {
      code: "opening_setup_incomplete",
      message: "session.resume is unavailable until the source-bound opening projection is current",
      details,
    },
    hints: ["follow error.details.next_operation"],
  };
  throw new runtime.CanonicalToolError(
    "coc_invoke",
    "opening_setup_incomplete",
    "canonical session.resume opening setup gate",
    details,
    envelope,
  );
}

const refs = [{ source_id: "pdf:typed-opening", pdf_index: 0 }];
const source = (value) => ({ status: "source", value, source_refs: refs });
const unresolved = { status: "unresolved", inspected_source_refs: refs };
const facts = {
  schema_version: 1,
  contract_id: "coc.opening-fast-facts.v1",
  era: source("1920s"),
  place: source("Boston"),
  investigator_hook: unresolved,
  investigator_constraints: unresolved,
  player_safe_summary: unresolved,
  content_flags: source(["haunting"]),
};

const campaignId = "typed-opening-phase-campaign";
const factsGate = {
  schema_version: 1,
  status: "blocked",
  hard_gate: true,
  activation_allowed: false,
  phase: "opening_source_facts_adoption_required",
  opening_phase: "module_preparation",
  campaign_id: campaignId,
  scenario_id: "typed-opening-scenario",
  opening_review_generation: 2,
  next_operation: {
    operation: "setup.adopt_source_facts",
    invoke_via: "coc_invoke",
    campaign: campaignId,
    arguments: { campaign_id: campaignId, facts },
  },
  instruction: "invoke this exact sealed setup.adopt_source_facts card",
};

let pending = true;
const h = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation === "session.resume") {
    throwResumeGate(factsGate);
  }
  if (params.operation === "setup.adopt_source_facts") {
    pending = false;
    return {
      ok: true,
      tool: "setup.adopt_source_facts",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "campaign.adopt_source_facts",
        result: {
          campaign_id: campaignId,
          facts,
          unresolved_blocking_facts: [],
          character_creation_unblocked: true,
        },
      },
    };
  }
  throw new Error(`unexpected ${params.operation}`);
}, campaignId);

await h.start();
if (!h.registered.has("coc_session_resume")) {
  throw new Error("coc_session_resume is not registered");
}
const resumed = await invokeTyped(h, "coc_session_resume", "typed-resume", {
  root,
  campaign: campaignId,
});
const terminalBlocker = h.sent.some((entry) => (
  entry.message?.customType === "coc-startup-resume-blocker"
  && entry.message?.details?.failure_class === "startup_resume_result_invalid"
));
if (resumed.ok !== false || resumed.error?.code === "startup_resume_result_invalid") {
  throw new Error(`typed resume terminalized: ${JSON.stringify(resumed)}`);
}
if (resumed.error?.code !== "opening_setup_incomplete") {
  throw new Error(`expected opening_setup_incomplete, got ${JSON.stringify(resumed)}`);
}
if (terminalBlocker) {
  throw new Error("typed resume published startup_resume_result_invalid blocker");
}

const adopted = await invokeTyped(h, "coc_setup_adopt_source_facts", "typed-adopt", {
  root,
  campaign: campaignId,
  campaign_id: campaignId,
  facts,
});
if (adopted.ok !== true || pending) {
  throw new Error(`adopt blocked after typed opening resume: ${JSON.stringify(adopted)}`);
}
await h.shutdown();

const omitCampaign = "typed-opening-omit-facts-campaign";
const omitGate = {
  ...factsGate,
  campaign_id: omitCampaign,
  next_operation: {
    ...factsGate.next_operation,
    campaign: omitCampaign,
    arguments: { campaign_id: omitCampaign, facts },
  },
};
let omitSawFacts = false;
const omit = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation === "session.resume") {
    throwResumeGate(omitGate);
  }
  if (params.operation === "setup.adopt_source_facts") {
    omitSawFacts = JSON.stringify(params.arguments?.facts) === JSON.stringify(facts);
    return {
      ok: true,
      tool: "setup.adopt_source_facts",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "campaign.adopt_source_facts",
        result: {
          campaign_id: omitCampaign,
          facts,
          unresolved_blocking_facts: [],
          character_creation_unblocked: true,
        },
      },
    };
  }
  throw new Error(`unexpected ${params.operation}`);
}, omitCampaign);
await omit.start();
const omitResume = await invokeTyped(omit, "coc_session_resume", "omit-resume", {
  root,
  campaign: omitCampaign,
});
if (omitResume.error?.code !== "opening_setup_incomplete") {
  throw new Error(`omit resume terminalized: ${JSON.stringify(omitResume)}`);
}
const adoptedOmitted = await invokeTyped(omit, "coc_setup_adopt_source_facts", "omit-adopt", {
  root,
  campaign: omitCampaign,
  campaign_id: omitCampaign,
});
if (adoptedOmitted.ok !== true || !omitSawFacts) {
  throw new Error(
    `campaign_id-only adopt did not bind retained facts: ${JSON.stringify(adoptedOmitted)}`,
  );
}
await omit.shutdown();

const reviewCampaign = "typed-opening-review-campaign";
const reviewGate = {
  schema_version: 1,
  status: "blocked",
  hard_gate: true,
  activation_allowed: false,
  phase: "opening_source_review_required",
  opening_phase: "module_preparation",
  campaign_id: reviewCampaign,
  scenario_id: "typed-opening-review",
  source_provenance: "selection_hint_only_not_provenance",
  required_source_owner: "coc-opening-source-coordinator",
  opening_review_generation: 1,
  character_setup_complete: false,
  next_operation: null,
  instruction: "review current source",
};
const review = harness((name, params) => {
  if (params.operation === "session.resume") throwResumeGate(reviewGate);
  if (params.operation === "setup.investigator_contract") {
    return {
      ok: true,
      tool: "setup.investigator_contract",
      data: {
        schema_version: 1,
        campaign_id: reviewCampaign,
        character_creation: { briefing_path: "briefing.md" },
      },
    };
  }
  throw new Error(`unexpected ${params.operation}`);
}, reviewCampaign);
await review.start();
const reviewResume = await invokeTyped(review, "coc_session_resume", "review-resume", {
  root,
  campaign: reviewCampaign,
});
if (reviewResume.error?.code !== "opening_setup_incomplete") {
  throw new Error(`review resume terminalized: ${JSON.stringify(reviewResume)}`);
}
if (review.sent.some((entry) => (
  entry.message?.customType === "coc-startup-resume-blocker"
))) {
  throw new Error("review resume published a startup blocker");
}
const contract = await invokeTyped(review, "coc_setup_investigator_contract", "review-contract", {
  root,
  campaign: reviewCampaign,
  campaign_id: reviewCampaign,
});
if (contract.ok !== true) {
  throw new Error(`investigator_contract blocked after opening resume: ${JSON.stringify(contract)}`);
}
await review.shutdown();

// A persisted opening_selection phase is a canonical lifecycle state after
// chargen has linked the investigator. Startup must retain its exact prepare
// card instead of terminalizing the resume as an invalid mode.
const selectionCampaign = "typed-opening-selection-campaign";
const selectionGate = {
  schema_version: 1,
  status: "blocked",
  hard_gate: true,
  activation_allowed: false,
  phase: "opening_selection",
  opening_phase: "opening_selection",
  campaign_id: selectionCampaign,
  next_operation: {
    operation: "progressive.prepare_opening",
    invoke_via: "coc_invoke",
    prefilled_arguments: {},
    missing_arguments: [],
    hard_gate: true,
    authority: "canonical_setup",
  },
  instruction: "resume from persisted selection",
};
const selection = harness((name, params) => {
  if (name !== "coc_invoke" || params.operation !== "session.resume") {
    throw new Error(`unexpected ${name}:${params.operation}`);
  }
  throwResumeGate(selectionGate);
}, selectionCampaign);
await selection.start();
const selectionResume = await invokeTyped(
  selection,
  "coc_session_resume",
  "selection-resume",
  { root, campaign: selectionCampaign },
);
if (selectionResume.error?.code !== "opening_setup_incomplete") {
  throw new Error(`selection resume terminalized: ${JSON.stringify(selectionResume)}`);
}
if (selection.sent.some((entry) => (
  entry.message?.customType === "coc-startup-resume-blocker"
))) {
  throw new Error("opening_selection resume published a startup blocker");
}
if (!selection.activeToolSnapshots.at(-1)?.includes("coc_progressive_prepare_opening")) {
  throw new Error("opening_selection resume did not restore the setup opening tool surface");
}
await selection.shutdown();

console.log("startup-resume-typed-opening-phase ok");
