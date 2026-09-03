#!/usr/bin/env node
/**
 * `session.resume` normally carries no campaign selector: the session is
 * already bound to one campaign, so the model calls it with `{}`. The host
 * still has to arm the `evidence.table_opening` binding, because `run_id` and
 * `decision_id` are host-owned and the Keeper has no way to know them.
 *
 * It did not. The campaign id was read from the request alone, so on a fresh
 * session it was empty, the binding never armed, and the first played turn of
 * a freshly onboarded campaign died: the schema demanded `run_id` while the
 * retry circuit simultaneously refused to let the model supply one. The
 * sibling test `table-opening-host-binding.mjs` passes `campaign` explicitly
 * and so only ever exercised the shape that already worked.
 */
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const campaign = "resume-without-selector";
process.env.COC_PI_SESSION_ROLE = "play";
process.env.PI_COC_CAMPAIGN_ID = campaign;

const extension = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));

const tools = new Map();
const handlers = new Map();
const seen = [];

const canonicalCall = async (_name, params) => {
  seen.push(structuredClone(params));
  if (params.operation === "session.resume") {
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        // The envelope names its own campaign even when the request did not.
        campaign_id: campaign,
        mode: "table_opening",
        next_operations: ["evidence.table_opening"],
      },
    };
  }
  return { ok: true, tool: String(params.operation), data: { schema_version: 1 } };
};

const pi = {
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  registerShortcut() {},
  registerFlag() {},
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
    getSessionId: () => "resume-without-selector-session",
    getEntries: () => [],
  },
  hasUI: false,
};

const emit = async (type, event) => {
  for (const handler of handlers.get(type) ?? []) await handler(event, ctx);
};

await emit("session_start", { type: "session_start" });

// The shape the live session uses: session.resume with no campaign selector.
const resumed = JSON.parse((await tools.get("coc_invoke").execute(
  "resume-1",
  { operation: "session.resume", arguments: {} },
  undefined,
  undefined,
  ctx,
)).content[0].text);
assert.equal(resumed.ok, true, JSON.stringify(resumed));
assert.ok(
  seen.some((call) => call.operation === "session.resume"),
  "the resume must reach the canonical transport",
);

const opening = tools.get("coc_evidence_table_opening");
assert.ok(opening, "table_opening must be on the play surface after resume");

// The model supplies only what it owns: the opening text and the rolls it
// presented. Everything else is the host's to inject.
await opening.execute(
  "opening-1",
  { text: "门厅里只有钟摆的声音。", presented_roll_ids: [] },
  undefined,
  undefined,
  ctx,
);

const sent = seen.find((call) => call.operation === "evidence.table_opening");
assert.ok(sent, "the opening must reach the canonical transport");
assert.equal(
  sent.arguments.run_id,
  `run-${campaign}`,
  "the host must inject run_id; the Keeper has no way to know it, and the retry "
  + "circuit refuses to let the model invent one",
);
assert.equal(
  sent.arguments.decision_id,
  `table-opening:${campaign}:opening-1`,
  "the host must inject decision_id",
);
assert.equal(sent.campaign, campaign, "the host must name the campaign it resumed");

// The same fields must not be asked of the model.
const properties = opening.parameters?.properties ?? {};
for (const hostField of ["run_id", "decision_id", "root", "campaign"]) {
  assert.ok(!properties[hostField], `${hostField} is host-owned`);
}

console.log(JSON.stringify({ ok: true, module: "table-opening-binding-without-selector" }));
