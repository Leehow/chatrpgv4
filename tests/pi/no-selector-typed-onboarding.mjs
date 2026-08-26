import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const dependencyRoot = path.resolve(process.env.PI_TEST_REPO_ROOT || repoRoot);
const extension = await import(path.join(
  repoRoot,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const { validateToolCall } = await import(embeddedPiFile(
  dependencyRoot,
  "pi-ai",
  "dist/utils/validation.js",
));

const previousRole = process.env.COC_PI_SESSION_ROLE;
const previousCampaign = process.env.PI_COC_CAMPAIGN_ID;
const originalExit = process.exit;
delete process.env.COC_PI_SESSION_ROLE;
delete process.env.PI_COC_CAMPAIGN_ID;

const workspace = mkdtempSync(path.join(tmpdir(), "pi-coc-no-selector-typed-"));
const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-no-selector-agent-"));
const campaign = "no-selector-haunting";
const investigator = "thomas-hayes";
const tools = new Map();
const handlers = new Map();
const activeSnapshots = [];
const clientCalls = [];
const sent = [];
const appended = [];
const exitCodes = [];

const canonicalJsonSha256 = (value) => (
  `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`
);

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
        investigator_ids: [investigator],
        completed_at: "2026-08-26T00:00:00Z",
        opening_projection_ref: null,
        lane_interrupted_at_handoff: false,
      },
    },
  },
});

const canonicalCall = async (name, params) => {
  assert.equal(name, "coc_invoke");
  clientCalls.push(structuredClone(params));
  if (params.operation === "setup.quick_start") {
    assert.equal(params.root, path.resolve(workspace));
    assert.equal(params.campaign, undefined);
    assert.deepEqual(params.arguments, {
      campaign_id: campaign,
      scenario_id: "the-haunting",
      pregen_id: investigator,
      title: "The Haunting",
    });
    return {
      ok: true,
      tool: "setup.quick_start",
      data: {
        schema_version: 1,
        status: "PASS",
        kind: "campaign.quick_start",
        result: {
          campaign_id: campaign,
          investigator_id: investigator,
          needs_investigator: false,
          scenario_id: "the-haunting",
          pregen_id: investigator,
          character_path: path.join(
            workspace,
            ".coc",
            "investigators",
            investigator,
            "character.json",
          ),
          campaign_dir: path.join(workspace, ".coc", "campaigns", campaign),
        },
        state_refs: [
          `.coc/campaigns/${campaign}`,
          `.coc/investigators/${investigator}/character.json`,
        ],
      },
    };
  }
  if (params.operation === "setup.complete") {
    assert.equal(params.root, path.resolve(workspace));
    assert.equal(params.campaign, campaign);
    assert.equal(params.arguments.campaign_id, campaign);
    assert.match(params.arguments.decision_id, /^pi-setup-handoff-[a-f0-9]{32}$/);
    return handoffEnvelope(params.arguments.decision_id);
  }
  if (params.operation === "session.resume") {
    assert.equal(params.root, path.resolve(workspace));
    assert.equal(params.campaign, campaign);
    assert.deepEqual(params.arguments, {});
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaign,
        mode: "table_opening",
        next_operations: ["evidence.table_opening"],
      },
    };
  }
  if (params.operation === "evidence.table_opening") {
    const text = params.arguments.text;
    return {
      ok: true,
      tool: "evidence.table_opening",
      data: {
        schema_version: 1,
        turn: 0,
        text,
        text_sha256: canonicalJsonSha256(text),
        authoritative_time_anchor: { day: 1, period: "morning" },
      },
    };
  }
  if (params.operation === "state.cash_grant" || params.operation === "state.item_grant") {
    return { ok: true, tool: params.operation, data: { changed: true } };
  }
  throw new Error(`unexpected canonical call ${params.operation}`);
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
  setActiveTools(names) { activeSnapshots.push([...names]); },
  getThinkingLevel: () => "off",
};

extension.default(pi, {
  coordinatorEnabled: () => false,
  startupCampaignId: () => null,
  welcomeAgentDir,
  createClient: () => ({
    callTool: canonicalCall,
    async callToolWithTransportMeta(name, params) {
      return { value: await canonicalCall(name, params), transport: null };
    },
    async close() {},
  }),
});

const ctx = {
  cwd: workspace,
  mode: "rpc",
  model: { provider: "xai", id: "grok-4.5" },
  sessionManager: {
    getSessionId: () => "no-selector-typed-onboarding",
    getEntries: () => [],
    getBranch: () => [],
  },
  hasUI: false,
};

const emit = async (type, event) => {
  for (const handler of handlers.get(type) ?? []) await handler(event, ctx);
};

const invokeValidated = async (toolName, id, args) => {
  const tool = tools.get(toolName);
  assert.ok(tool, toolName);
  const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
  const validated = validateToolCall([tool], {
    name: toolName,
    arguments: prepared,
  });
  return JSON.parse((await tool.execute(
    id,
    validated,
    undefined,
    undefined,
    ctx,
  )).content[0].text);
};

const assertNoGenericWrappers = (names) => {
  for (const name of [
    "coc_invoke",
    "coc_setup",
    "coc_context",
    "coc_rules",
    "coc_state",
    "coc_npc",
    "coc_turn",
    "coc_advice",
    "coc_subsystem",
  ]) assert.ok(!names.includes(name), name);
};

try {
  process.exit = (code) => { exitCodes.push(code); };
  await emit("session_start", { type: "session_start" });
  await emit("message_start", {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "玩《闹鬼》，用托马斯·海斯。" }],
    },
  });

  const coldStartTools = activeSnapshots.at(-1);
  assertNoGenericWrappers(coldStartTools);
  assert.ok(coldStartTools.includes("coc_discover"), JSON.stringify(coldStartTools));
  assert.ok(coldStartTools.includes("coc_setup_quick_start"), JSON.stringify(coldStartTools));
  const quickStart = tools.get("coc_setup_quick_start");
  assert.ok(!quickStart.parameters.properties.root);
  assert.ok(!quickStart.parameters.properties.campaign);

  const callsBeforeForge = clientCalls.length;
  const forged = await quickStart.execute(
    "forged-root",
    {
      root: "/tmp/forged",
      campaign_id: campaign,
      scenario_id: "the-haunting",
      pregen_id: investigator,
      title: "The Haunting",
    },
    undefined,
    undefined,
    ctx,
  );
  assert.match(forged.content[0].text, /forged_host_argument/);
  assert.equal(clientCalls.length, callsBeforeForge);

  await invokeValidated("coc_setup_quick_start", "quick-start", {
    campaign_id: campaign,
    scenario_id: "the-haunting",
    pregen_id: investigator,
    title: "The Haunting",
  });
  const complete = tools.get("coc_setup_complete");
  assert.deepEqual(complete.parameters.required ?? [], []);
  assert.deepEqual(Object.keys(complete.parameters.properties ?? {}), []);
  assert.ok(activeSnapshots.at(-1).includes("coc_setup_complete"));

  const completeCallsBeforeConfirmation = clientCalls.filter(
    (call) => call.operation === "setup.complete",
  ).length;
  await assert.rejects(
    invokeValidated("coc_setup_complete", "same-turn-complete", {}),
    /requires a new external player message/,
  );
  assert.equal(
    clientCalls.filter((call) => call.operation === "setup.complete").length,
    completeCallsBeforeConfirmation,
  );

  await emit("message_start", {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "确认打开游戏桌。" }],
    },
  });
  await invokeValidated("coc_setup_complete", "confirmed-complete", {});
  assert.deepEqual(exitCodes, []);
  assert.deepEqual(activeSnapshots.at(-1), ["coc_session_resume"]);
  assertNoGenericWrappers(activeSnapshots.at(-1));
  assert.deepEqual(tools.get("coc_session_resume").parameters.required ?? [], []);
  assert.deepEqual(Object.keys(tools.get("coc_session_resume").parameters.properties ?? {}), []);

  const callsBeforeStaleSetup = clientCalls.length;
  await assert.rejects(
    quickStart.execute(
      "stale-quick-start",
      {
        campaign_id: `${campaign}-stale`,
        scenario_id: "the-haunting",
        pregen_id: investigator,
      },
      undefined,
      undefined,
      ctx,
    ),
    /hard-gated|session.resume/,
  );
  assert.equal(clientCalls.length, callsBeforeStaleSetup);

  await invokeValidated("coc_session_resume", "resume", {});
  const opening = tools.get("coc_evidence_table_opening");
  assert.ok(activeSnapshots.at(-1).includes("coc_evidence_table_opening"));
  assert.ok(opening.parameters.properties.text);
  assert.ok(!opening.parameters.properties.narrative);
  assert.throws(
    () => validateToolCall([opening], {
      name: "coc_evidence_table_opening",
      arguments: {
        campaign,
        narrative: "wrong field",
        run_id: "run-1",
        presented_roll_ids: [],
        decision_id: "opening-1",
      },
    }),
    /text|narrative/,
  );

  await invokeValidated("coc_evidence_table_opening", "opening", {
    campaign,
    text: "雨夜里，波士顿的街灯在雾中泛着冷光。",
    run_id: "run-1",
    presented_roll_ids: [],
    decision_id: "opening-1",
  });

  const discover = tools.get("coc_discover");
  for (const operation of ["state.cash_grant", "state.item_grant"]) {
    const discovered = JSON.parse((await discover.execute(
      `discover-${operation}`,
      { operation },
      undefined,
      undefined,
      ctx,
    )).content[0].text);
    assert.equal(discovered.ok, true, JSON.stringify(discovered));
    assert.equal(discovered.data.operation_card.operation, operation);
    assert.equal(discovered.data.operation_card.parameters.additionalProperties, false);
  }
  const cash = tools.get("coc_state_cash_grant");
  const item = tools.get("coc_state_item_grant");
  for (const key of ["investigator", "source", "localized_reason"]) {
    assert.ok(cash.parameters.properties[key], key);
  }
  for (const key of ["investigator", "kind", "label"]) {
    assert.ok(item.parameters.properties[key], key);
  }
  await invokeValidated("coc_state_cash_grant", "cash", {
    campaign,
    amount: 10,
    currency: "USD",
    source: "commission",
    reason: "advance",
    localized_reason: "委托预付款",
    decision_id: "cash-1",
    investigator,
  });
  await invokeValidated("coc_state_item_grant", "item", {
    campaign,
    kind: "gear",
    label: "房门钥匙",
    decision_id: "item-1",
    investigator,
  });

  assertNoGenericWrappers(activeSnapshots.at(-1));
  assert.equal(
    clientCalls.filter((call) => call.operation === "setup.quick_start").length,
    1,
  );
  assert.equal(
    clientCalls.filter((call) => call.operation === "setup.complete").length,
    1,
  );
  const postHandoffCalls = clientCalls.slice(
    clientCalls.findIndex((call) => call.operation === "setup.complete") + 1,
  );
  assert.equal(postHandoffCalls[0].operation, "session.resume");
  assert.equal(
    appended.filter(({ type }) => type === "coc_setup_handoff").length,
    1,
  );
  assert.equal(
    appended.find(({ type }) => type === "coc_setup_handoff").value.consumer,
    "pi-coc/same-process",
  );
  assert.equal(
    sent.filter(({ message }) => message.customType === "coc_setup_handoff").length,
    0,
  );
} finally {
  process.exit = originalExit;
  if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
  else process.env.COC_PI_SESSION_ROLE = previousRole;
  if (previousCampaign === undefined) delete process.env.PI_COC_CAMPAIGN_ID;
  else process.env.PI_COC_CAMPAIGN_ID = previousCampaign;
}
