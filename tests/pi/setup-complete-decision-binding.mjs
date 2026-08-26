import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const root = path.resolve(process.argv[2] || process.cwd());
const dependencyRoot = path.resolve(process.env.PI_TEST_REPO_ROOT || root);
const extension = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const { validateToolCall } = await import(embeddedPiFile(
  dependencyRoot,
  "pi-ai",
  "dist/utils/validation.js",
));

const campaign = "setup-complete-decision-binding";
const previousRole = process.env.COC_PI_SESSION_ROLE;
const previousCampaign = process.env.PI_COC_CAMPAIGN_ID;
const originalExit = process.exit;
process.env.COC_PI_SESSION_ROLE = "setup";
process.env.PI_COC_CAMPAIGN_ID = campaign;

const tools = new Map();
const handlers = new Map();
const appended = [];
const sent = [];
const clientCalls = [];
const exitCodes = [];

const setupIncomplete = {
  ok: false,
  tool: "session.resume",
  error: {
    code: "opening_setup_incomplete",
    details: {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_character_setup_required",
      campaign_id: campaign,
      character_setup_policy: "guided_quick_fire",
      next_operation: null,
      instruction: "complete character creation",
    },
  },
};

const handoffEnvelope = (decisionId) => ({
  ok: true,
  tool: "setup.complete",
  data: {
    schema_version: 1,
    status: "PASS",
    kind: "campaign.complete",
    result: {
      campaign_id: campaign,
      ready_for_table: true,
      next: "table_opening",
      handoff: {
        schema_version: 1,
        campaign_id: campaign,
        decision_id: decisionId,
        investigator_ids: ["inv-decision-binding"],
        completed_at: "2026-08-23T00:00:00Z",
        opening_projection_ref: null,
        lane_interrupted_at_handoff: false,
      },
    },
  },
});

const canonicalCall = async (name, params) => {
  clientCalls.push({ name, params: structuredClone(params) });
  if (name === "setup.chargen_run") {
    return {
      ok: true,
      tool: "setup.chargen_run",
      data: {
        result: {
          ok: true,
          investigator_id: params.investigator_id,
          characteristics: {},
          derived: {},
          skill_top: [],
        },
      },
    };
  }
  if (params.operation === "session.resume") return setupIncomplete;
  if (params.operation === "setup.complete") {
    return handoffEnvelope(params.arguments.decision_id);
  }
  return { ok: true, tool: params.operation ?? name, data: {} };
};

const pi = {
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  registerShortcut() {},
  on(type, handler) {
    const list = handlers.get(type) ?? [];
    list.push(handler);
    handlers.set(type, list);
  },
  appendEntry(type, value) { appended.push({ type, value }); },
  sendMessage(message, options) { sent.push({ message, options }); },
  setActiveTools() {},
  getThinkingLevel: () => "off",
};

extension.default(pi, {
  coordinatorEnabled: () => false,
  startupCampaignId: () => null,
  createClient: () => ({
    callTool: canonicalCall,
    async callToolWithTransportMeta(name, params) {
      return { value: await canonicalCall(name, params), transport: null };
    },
    async close() {},
  }),
});

const ctx = {
  cwd: root,
  mode: "rpc",
  model: { provider: "xai", id: "grok-4.5" },
  sessionManager: {
    getSessionId: () => "setup-complete-decision-binding",
    getEntries: () => [],
  },
  hasUI: false,
};

const emit = async (type, event) => {
  for (const handler of handlers.get(type) ?? []) await handler(event, ctx);
};

try {
  process.exit = (code) => { exitCodes.push(code); };
  await emit("session_start", { type: "session_start" });
  await tools.get("coc_invoke").execute(
    "resume",
    { operation: "session.resume", campaign, arguments: {} },
    undefined,
    undefined,
    ctx,
  );
  await tools.get("coc_chargen_delegate").execute(
    "chargen",
    {
      name: "林晚舟",
      occupation_name: "记者",
      age: 31,
      assignment_priority: "INT EDU APP DEX POW CON SIZ STR",
    },
    undefined,
    undefined,
    ctx,
  );

  const typed = tools.get("coc_setup_complete");
  assert.ok(typed, "setup role must register the typed setup.complete tool");
  assert.equal(
    typeof typed.prepareArguments,
    "function",
    "the typed surface must bind the retained stable decision before Pi schema validation",
  );

  const missingDecisionCall = {
    name: "coc_setup_complete",
    arguments: { campaign_id: campaign, campaign, root },
  };
  assert.throws(
    () => validateToolCall([typed], missingDecisionCall),
    /decision_id/,
    "the public archive schema must remain strict",
  );

  const sameTurnPrepared = typed.prepareArguments(missingDecisionCall.arguments);
  const sameTurnDecision = sameTurnPrepared.decision_id;
  assert.match(sameTurnDecision, /^pi-setup-handoff-[a-f0-9]{32}$/);
  const sameTurnValidated = validateToolCall([typed], {
    ...missingDecisionCall,
    arguments: sameTurnPrepared,
  });
  await assert.rejects(
    typed.execute(
      "same-turn",
      sameTurnValidated,
      undefined,
      undefined,
      ctx,
    ),
    /requires a new external player message/,
    "binding the transport field must not turn the chargen result into table consent",
  );
  assert.equal(
    clientCalls.filter((call) => call.params.operation === "setup.complete").length,
    0,
    "the same-turn retry must stop before the canonical provider turn",
  );

  await emit("message_start", {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "确认打开游戏桌。" }],
      timestamp: 1,
    },
  });
  const confirmedPrepared = typed.prepareArguments(missingDecisionCall.arguments);
  assert.equal(
    confirmedPrepared.decision_id,
    sameTurnDecision,
    "unchanged provider retries must receive the same retained decision id",
  );
  const confirmedValidated = validateToolCall([typed], {
    ...missingDecisionCall,
    arguments: confirmedPrepared,
  });
  await typed.execute(
    "confirmed",
    confirmedValidated,
    undefined,
    undefined,
    ctx,
  );
  await new Promise((resolve) => setImmediate(resolve));

  const handoffMessages = sent.filter(
    ({ message }) => message.customType === "coc_setup_handoff",
  );
  const handoffEntries = appended.filter(
    ({ type }) => type === "coc_setup_handoff",
  );
  assert.equal(handoffMessages.length, 1);
  assert.equal(handoffEntries.length, 1);
  assert.equal(handoffEntries[0].value.receipt.decision_id, sameTurnDecision);
  assert.deepEqual(exitCodes, [42]);

  const afterSuccessPrepared = typed.prepareArguments(
    missingDecisionCall.arguments,
  );
  assert.equal(afterSuccessPrepared.decision_id, undefined);
  assert.throws(
    () => validateToolCall([typed], {
      ...missingDecisionCall,
      arguments: afterSuccessPrepared,
    }),
    /decision_id/,
    "a consumed route must not bind or deliver the handoff twice",
  );
  assert.equal(handoffMessages.length, 1);
  assert.equal(handoffEntries.length, 1);
} finally {
  process.exit = originalExit;
  if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
  else process.env.COC_PI_SESSION_ROLE = previousRole;
  if (previousCampaign === undefined) delete process.env.PI_COC_CAMPAIGN_ID;
  else process.env.PI_COC_CAMPAIGN_ID = previousCampaign;
}
