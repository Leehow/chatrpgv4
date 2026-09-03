#!/usr/bin/env node
// The onboarding tools are a projection of the canonical contract archive.
// This loads the extension against a recording ExtensionAPI and inspects what
// it actually registered -- reading the archive instead would assert only that
// the archive is well-formed, which is true no matter what the surface ships.
// The first live run shipped an empty schema, so the model called
// setup.quick_start six times with `{}` and got the same missing_param back.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repo = path.resolve(process.argv[2] || process.cwd());
process.env.PI_COC_CAMPAIGN_ID = "surface-probe";

const dir = path.join(repo, "plugins/coc-keeper/pi/extensions/onboarding");
const { default: onboarding } = await import(pathToFileURL(path.join(dir, "index.ts")).href);
const { STEPS } = await import(pathToFileURL(path.join(dir, "steps.ts")).href);

const registered = new Map();
const sent = [];
// A workspace where the campaign does not exist yet.
const workspace = mkdtempSync(path.join(tmpdir(), "coc-surface-"));
const ctx = { cwd: workspace, mode: "rpc", sessionManager: { getSessionId: () => "s" } };
onboarding({
  registerTool: (tool) => registered.set(tool.name, tool),
  on: () => {},
  sendMessage: () => {},
  setActiveTools: () => {},
  appendEntry: () => {},
}, {
  createClient: () => ({
    callTool: async (name, params) => {
      sent.push({ name, params });
      return { ok: true, tool: String(params?.operation ?? name), data: {} };
    },
  }),
});

assert.ok(registered.size >= 6, `expected the setup surface, got ${registered.size} tools`);
// The retired source-review path must not come back through the surface.
for (const gone of ["coc_setup_adopt_source_facts", "coc_capabilities"]) {
  assert.ok(!registered.has(gone), `${gone} belongs to the retired opening review`);
}

for (const [name, tool] of registered) {
  const properties = Object.keys(tool.parameters?.properties ?? {});
  assert.ok(
    properties.length > 0,
    `${name} registers an empty schema; the model would have to guess its parameters`,
  );
  for (const required of tool.parameters?.required ?? []) {
    assert.ok(
      required === "campaign" || properties.includes(required),
      `${name} requires ${required} but does not offer it`,
    );
  }
  // The transport selector is the one field the projection drops: onboarding
  // never sends it, so advertising it would be a parameter that does nothing.
  assert.ok(!properties.includes("campaign"), `${name} must not offer the transport selector`);
}

// Concrete anchors, so a projection that quietly loses fields is caught.
assert.ok(
  Object.keys(registered.get("coc_setup_quick_start").parameters.properties)
    .includes("scenario_id"),
  "quick_start must offer scenario_id -- its absence is what broke the first live run",
);
for (const field of ["campaign_id", "investigator_id", "name", "occupation_name"]) {
  assert.ok(
    Object.keys(registered.get("coc_setup_chargen_run").parameters.properties).includes(field),
    `chargen_run must offer ${field}`,
  );
}

// Every tool the table names is registered here, or comes from a named plugin.
const external = new Set();
for (const step of STEPS) {
  for (const tool of step.tools) {
    assert.ok(
      registered.has(tool) || external.has(tool),
      `step ${step.id} names ${tool}, which nothing registers`,
    );
  }
}

// The transport selector is never sent. Before the campaign exists it names a
// directory that is not there; around a campaign-serial operation that already
// holds the session lock it deadlocks -- setup.chargen_run timed out twice
// under exactly that. Receipts are journaled from the campaign_id the call
// carries, in coc_toolbox._named_campaign_dir, not from this selector.
const invoke = (tool) => registered.get(tool).execute("t", {}, undefined, undefined, ctx);

mkdirSync(path.join(workspace, ".coc", "campaigns", "surface-probe"), { recursive: true });
writeFileSync(
  path.join(workspace, ".coc", "campaigns", "surface-probe", "campaign.json"),
  JSON.stringify({ campaign_id: "surface-probe" }),
);

for (const tool of registered.keys()) {
  if (tool === "onboarding_choose_source") continue;
  await invoke(tool);
  assert.equal(
    sent.at(-1).params.campaign,
    undefined,
    `${tool} must not carry the transport selector, even once the campaign exists`,
  );
}

console.log(JSON.stringify({ ok: true, module: "onboarding-tool-surface" }));
