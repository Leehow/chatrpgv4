import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const campaign = "persisted-graph-starter-handoff";
const previousRole = process.env.COC_PI_SESSION_ROLE;
const previousCampaign = process.env.PI_COC_CAMPAIGN_ID;
const originalExit = process.exit;
process.env.COC_PI_SESSION_ROLE = "setup";
process.env.PI_COC_CAMPAIGN_ID = campaign;

const extension = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));
const tools = new Map();
const handlers = new Map();
const calls = [];
const exits = [];

const phaseEnvelope = {
  ok: true,
  tool: "setup.phase",
  data: {
    schema_version: 1,
    campaign_id: campaign,
    phase: "character_creation",
    detail: {
      campaign_exists: true,
      campaign_status: "setup",
      session_role: "setup",
      module_preparation: {
        satisfied: true,
        source_gated: false,
        sub_phase: null,
        blocking_reason: null,
      },
      character_setup: {
        confirmed: true,
        party_linked: true,
        policy: "guided_quick_fire",
        input_mode: "guided_quick_fire",
        resume_gate_required: false,
        blocking_reason: null,
      },
    },
    next_operation: {
      operation: "setup.complete",
      invoke_via: "coc_invoke",
      campaign,
    },
    blocking_reason: null,
  },
};

const canonicalCall = async (name, params) => {
  assert.equal(name, "coc_invoke");
  calls.push(structuredClone(params));
  if (params.operation === "session.resume") {
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaign,
        mode: "awaiting_player",
        next_operations: ["setup.phase"],
      },
    };
  }
  if (params.operation === "setup.phase") return structuredClone(phaseEnvelope);
  if (params.operation === "setup.complete") {
    assert.equal(params.root, root);
    assert.equal(params.campaign, campaign);
    assert.deepEqual(Object.keys(params.arguments).sort(), [
      "campaign_id",
      "decision_id",
    ]);
    assert.equal(params.arguments.campaign_id, campaign);
    assert.equal(
      params.arguments.decision_id,
      `setup-complete:${campaign}:handoff-1`,
    );
    return {
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
            decision_id: params.arguments.decision_id,
            investigator_ids: ["thomas-hayes"],
            completed_at: "2026-08-29T00:00:00Z",
            opening_projection_ref: null,
            lane_interrupted_at_handoff: false,
          },
        },
      },
    };
  }
  throw new Error(`unexpected canonical operation ${params.operation}`);
};

const pi = {
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  registerShortcut() {},
  on(type, handler) {
    const rows = handlers.get(type) ?? [];
    rows.push(handler);
    handlers.set(type, rows);
  },
  appendEntry() {},
  sendMessage() {},
  setActiveTools() {},
  getActiveTools: () => [],
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
  model: { provider: "offline", id: "offline" },
  sessionManager: {
    getSessionId: () => "persisted-graph-starter-handoff",
    getEntries: () => [],
  },
  hasUI: false,
};

const emit = async (type, event) => {
  for (const handler of handlers.get(type) ?? []) await handler(event, ctx);
};
const invoke = async (id, params) => JSON.parse((
  await tools.get("coc_invoke").execute(
    id,
    params,
    undefined,
    undefined,
    ctx,
  )
).content[0].text);

try {
  process.exit = (code) => { exits.push(code); };
  await emit("session_start", { type: "session_start" });
  const resumed = await invoke("resume-first", {
    operation: "session.resume",
    root,
    campaign,
    arguments: {},
  });
  assert.equal(resumed.ok, true);

  const phase = await invoke("persisted-phase", {
    operation: "setup.phase",
    root,
    campaign,
    arguments: { campaign_id: campaign },
  });
  assert.equal(phase.ok, true);

  await emit("message_start", {
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "确认打开游戏桌。" }],
      timestamp: 1,
    },
  });

  const complete = tools.get("coc_setup_complete");
  assert.ok(complete, "setup role must expose the typed handoff operation");
  assert.ok(
    !(complete.parameters.required ?? []).includes("decision_id"),
    "the model must not author the persisted starter handoff identity",
  );
  const prepared = complete.prepareArguments({ campaign_id: campaign });
  assert.equal(
    prepared.decision_id,
    `setup-complete:${campaign}:handoff-1`,
  );
  const completed = JSON.parse((await complete.execute(
    "complete-persisted-starter",
    prepared,
    undefined,
    undefined,
    ctx,
  )).content[0].text);
  assert.equal(completed.ok, true, JSON.stringify(completed));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, [42]);
  assert.equal(
    calls.filter((call) => call.operation === "setup.complete").length,
    1,
  );
} finally {
  process.exit = originalExit;
  if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
  else process.env.COC_PI_SESSION_ROLE = previousRole;
  if (previousCampaign === undefined) delete process.env.PI_COC_CAMPAIGN_ID;
  else process.env.PI_COC_CAMPAIGN_ID = previousCampaign;
}
