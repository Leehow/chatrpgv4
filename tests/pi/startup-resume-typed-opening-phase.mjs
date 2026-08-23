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

// Pi persists provider thinking in the linear transcript even when the model's
// selected thinking level is off. The extension projection must remove only
// recovery-superseded thinking from the model context, never mutate the
// persisted message objects, and preserve reasoning produced after recovery.
const thinkingProjection = main.createStartupRecoveryThinkingProjection();
const persistedMessages = [
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "old provider reasoning" },
      { type: "text", text: "old visible text" },
    ],
  },
  { role: "user", content: [{ type: "text", text: "continue" }] },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "resume call reasoning" },
      { type: "toolCall", id: "resume-call", name: "coc_setup", arguments: {} },
    ],
  },
  {
    role: "toolResult",
    toolCallId: "resume-call",
    toolName: "coc_setup",
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: "thinking-projection-campaign",
          mode: "pending_finalization",
          next_operations: ["turn.finalize"],
        },
      }),
    }],
  },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "current post-recovery reasoning" },
      { type: "text", text: "current work" },
    ],
  },
];
const persistedSnapshot = structuredClone(persistedMessages);
const recoveryProjected = thinkingProjection.apply(persistedMessages, false);
assertNoThinking(recoveryProjected[0], "old pre-recovery thinking survived");
assertNoThinking(recoveryProjected[2], "resume-call thinking survived recovery receipt");
if (!recoveryProjected[4].content.some((part) => part.type === "thinking")) {
  throw new Error("post-recovery thinking was stripped as historical");
}
if (JSON.stringify(persistedMessages) !== JSON.stringify(persistedSnapshot)) {
  throw new Error("thinking projection mutated persisted transcript evidence");
}
const invalidReceiptProjection = main.createStartupRecoveryThinkingProjection();
const invalidReceiptMessages = [
  {
    role: "assistant",
    content: [{ type: "thinking", thinking: "must remain without exact receipt" }],
  },
  {
    role: "toolResult",
    content: [{
      type: "text",
      text: JSON.stringify({ ok: true, tool: "session.resume", data: { mode: "pending_finalization" } }),
    }],
  },
];
if (!invalidReceiptProjection.apply(invalidReceiptMessages, false)[0].content.some(
  (part) => part.type === "thinking",
)) {
  throw new Error("malformed resume-like payload advanced thinking boundary");
}
const startupOnly = [{
  role: "assistant",
  content: [{ type: "thinking", thinking: "prior session tail" }],
}];
assertNoThinking(
  thinkingProjection.apply(startupOnly, true)[0],
  "startup gate sent prior-session thinking to the first recovery call",
);

function assertNoThinking(message, label) {
  if (message.content.some((part) => part.type === "thinking")) {
    throw new Error(label);
  }
}

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

// A missing campaign selected explicitly into a setup-role host is the one
// startup-resume failure that establishes a fresh setup boundary. The host
// must allow only exact canonical creation for that selected id; it must not
// make the KP relaunch or permit a guessed/default campaign id.
function throwUnknownCampaign() {
  const envelope = {
    ok: false,
    tool: "session.resume",
    error: {
      code: "unknown_campaign",
      message: "campaign does not exist",
    },
  };
  throw new runtime.CanonicalToolError(
    "coc_invoke",
    "unknown_campaign",
    "campaign does not exist",
    null,
    envelope,
  );
}

const freshCampaign = "typed-opening-fresh-campaign";
let freshCreated = false;
let freshResumeCalls = 0;
const fresh = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation === "session.resume") {
    freshResumeCalls += 1;
    throwUnknownCampaign();
  }
  if (params.operation === "setup.quick_start") {
    // Real MCP/toolbox shape: lifting the not-yet-created campaign_id into
    // the outer campaign selector makes Ctx try to rehydrate a campaign that
    // cannot exist yet. Fresh creation must retain campaign_id only in the
    // canonical operation arguments.
    if (params.campaign !== undefined) {
      const envelope = {
        ok: false,
        tool: "setup.quick_start",
        error: {
          code: "unknown_campaign",
          message: `no campaign at ${params.root}/.coc/campaigns/${params.campaign}`,
        },
        warnings: [
          "This MCP process has not loaded the requested campaign recovery bundle in its current context; session.resume is recommended.",
        ],
        context_rehydration: {
          code: "context_rehydration_recommended",
          reason: "mcp_process_start",
          campaign_id: params.campaign,
          next_operation: "session.resume",
          authority: "advisory",
          hard_gate: false,
        },
      };
      throw new runtime.CanonicalToolError(
        "coc_invoke",
        "unknown_campaign",
        envelope.error.message,
        null,
        envelope,
      );
    }
    if (
      params.root !== root
      || params.arguments?.campaign_id !== freshCampaign
    ) {
      throw new Error(`quick_start identity drift: ${JSON.stringify(params)}`);
    }
    freshCreated = true;
    return {
      ok: true,
      tool: "setup.quick_start",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "campaign.quick_start",
        result: {
          campaign_id: freshCampaign,
          investigator_id: "thomas-hayes",
          needs_investigator: false,
          scenario_id: "the-haunting",
          pregen_id: "thomas-hayes",
          character_path: `${root}/.coc/investigators/thomas-hayes/character.json`,
          campaign_dir: `${root}/.coc/campaigns/${freshCampaign}`,
        },
        state_refs: [
          `.coc/campaigns/${freshCampaign}`,
          ".coc/investigators/thomas-hayes/character.json",
        ],
      },
    };
  }
  if (params.operation === "setup.inspect") {
    return { ok: true, tool: "setup.inspect", data: { schema_version: 1 } };
  }
  throw new Error(`unexpected ${params.operation}`);
}, freshCampaign);
await fresh.start();
const freshResume = await invokeTyped(fresh, "coc_session_resume", "fresh-resume", {
  root,
  campaign: freshCampaign,
});
if (freshResume.error?.code !== "unknown_campaign") {
  throw new Error(`fresh resume did not preserve unknown_campaign: ${JSON.stringify(freshResume)}`);
}
if (fresh.sent.some((entry) => (
  entry.message?.customType === "coc-startup-resume-blocker"
))) {
  throw new Error("fresh setup resume published a terminal startup blocker");
}
if (!fresh.activeToolSnapshots.at(-1)?.includes("coc_setup_quick_start")) {
  throw new Error("fresh setup boundary did not expose canonical quick_start");
}
let wrongFreshAccepted = false;
try {
  await invokeTyped(fresh, "coc_setup_quick_start", "fresh-wrong-id", {
    root,
    scenario_id: "the-haunting",
    pregen_id: "starter",
    campaign_id: `${freshCampaign}-wrong`,
  });
  wrongFreshAccepted = true;
} catch (error) {
  if (!String(error).includes("selected campaign")) throw error;
}
if (wrongFreshAccepted) throw new Error("fresh setup accepted a guessed campaign id");
const quickStarted = await invokeTyped(fresh, "coc_setup_quick_start", "fresh-exact-id", {
  root,
  scenario_id: "the-haunting",
  pregen_id: "thomas-hayes",
  campaign_id: freshCampaign,
});
if (quickStarted.ok !== true || !freshCreated) {
  throw new Error(`exact fresh quick_start was blocked: ${JSON.stringify(quickStarted)}`);
}
let afterFreshOpeningGate = false;
try {
  await invokeTyped(fresh, "coc_setup_inspect", "fresh-inspect", {
    root,
    campaign: freshCampaign,
  });
} catch (error) {
  const message = String(error);
  afterFreshOpeningGate = message.includes("Pi opening setup hard gate is active");
  if (message.includes("fresh setup is bound")) throw error;
}
if (!afterFreshOpeningGate) {
  throw new Error("quick_start did not replace startup ACL with character-setup gate");
}
if (freshResumeCalls !== 1) {
  throw new Error(`fresh quick_start triggered a second session.resume: ${freshResumeCalls}`);
}
await fresh.shutdown();

// Custom tables use the other canonical pre-campaign route: setup.invoke
// campaign.create. It deliberately has no outer campaign transport selector,
// because that selector would try to hydrate the not-yet-created campaign.
const freshCreateCampaign = "typed-opening-fresh-create-campaign";
let freshCampaignCreated = false;
const freshCreate = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation === "session.resume") throwUnknownCampaign();
  if (params.operation === "setup.invoke") {
    if (
      params.campaign !== undefined
      || params.root !== root
      || params.arguments?.kind !== "campaign.create"
      || params.arguments?.payload?.campaign_id !== freshCreateCampaign
    ) {
      throw new Error(`campaign.create identity drift: ${JSON.stringify(params)}`);
    }
    freshCampaignCreated = true;
    return {
      ok: true,
      tool: "setup.invoke",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "campaign.create",
        result: { campaign_id: freshCreateCampaign },
      },
    };
  }
  if (params.operation === "setup.inspect") {
    return { ok: true, tool: "setup.inspect", data: { schema_version: 1 } };
  }
  throw new Error(`unexpected ${params.operation}`);
}, freshCreateCampaign);
await freshCreate.start();
const createResume = await invokeTyped(freshCreate, "coc_session_resume", "fresh-create-resume", {
  root,
  campaign: freshCreateCampaign,
});
if (createResume.error?.code !== "unknown_campaign") {
  throw new Error(`fresh create resume did not preserve unknown_campaign: ${JSON.stringify(createResume)}`);
}
let wrongCampaignCreateAccepted = false;
try {
  await invokeTyped(freshCreate, "coc_setup", "fresh-create-wrong-id", {
    operation: "setup.invoke",
    root,
    arguments: {
      kind: "campaign.create",
      payload: { campaign_id: `${freshCreateCampaign}-wrong`, title: "Wrong" },
    },
  });
  wrongCampaignCreateAccepted = true;
} catch (error) {
  if (!String(error).includes("selected campaign")) throw error;
}
if (wrongCampaignCreateAccepted) {
  throw new Error("fresh setup accepted campaign.create for a guessed campaign id");
}
const created = await invokeTyped(freshCreate, "coc_setup", "fresh-create-exact", {
  operation: "setup.invoke",
  root,
  arguments: {
    kind: "campaign.create",
    payload: { campaign_id: freshCreateCampaign, title: "Fresh Custom Table" },
  },
});
if (created.ok !== true || !freshCampaignCreated) {
  throw new Error(`exact fresh campaign.create was blocked: ${JSON.stringify(created)}`);
}
const afterCreate = await invokeTyped(freshCreate, "coc_setup", "fresh-create-inspect", {
  operation: "setup.inspect",
  root,
  campaign: freshCreateCampaign,
  arguments: {},
});
if (afterCreate.ok !== true) {
  throw new Error(`startup gate remained armed after campaign.create: ${JSON.stringify(afterCreate)}`);
}
await freshCreate.shutdown();

// The same unknown_campaign result in a play-role host remains a terminal
// selection/load failure. It must never turn into campaign creation.
process.env.COC_PI_SESSION_ROLE = "play";
const missingPlayCampaign = "typed-opening-missing-play-campaign";
const missingPlay = harness((name, params) => {
  if (name === "coc_invoke" && params.operation === "session.resume") {
    throwUnknownCampaign();
  }
  throw new Error(`unexpected ${name}:${params.operation}`);
}, missingPlayCampaign);
await missingPlay.start();
const missingPlayResume = await invokeTyped(
  missingPlay,
  "coc_session_resume",
  "missing-play-resume",
  { root, campaign: missingPlayCampaign },
);
if (missingPlayResume.error?.code !== "unknown_campaign") {
  throw new Error(`play-role missing campaign changed error: ${JSON.stringify(missingPlayResume)}`);
}
if (!missingPlay.sent.some((entry) => (
  entry.message?.customType === "coc-startup-resume-blocker"
  && entry.message?.details?.failure_class === "unknown_campaign"
))) {
  throw new Error("play-role missing campaign did not terminal-block");
}
let playQuickStartAccepted = false;
try {
  await invokeTyped(missingPlay, "coc_setup_quick_start", "missing-play-quick-start", {
    root,
    scenario_id: "the-haunting",
    pregen_id: "starter",
    campaign_id: missingPlayCampaign,
  });
  playQuickStartAccepted = true;
} catch (error) {
  if (!String(error).includes("terminally blocked")) throw error;
}
if (playQuickStartAccepted) throw new Error("play-role missing campaign allowed quick_start");
await missingPlay.shutdown();
process.env.COC_PI_SESSION_ROLE = "setup";

console.log("startup-resume-typed-opening-phase ok");
