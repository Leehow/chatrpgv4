#!/usr/bin/env node
// The onboarding tools are a projection of the canonical contract archive.
// This loads the extension against a recording ExtensionAPI and inspects what
// it actually registered -- reading the archive instead would assert only that
// the archive is well-formed, which is true no matter what the surface ships.
// The first live run shipped an empty schema, so the model called
// setup.quick_start six times with `{}` and got the same missing_param back.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repo = path.resolve(process.argv[2] || process.cwd());
process.env.PI_COC_CAMPAIGN_ID = "surface-probe";

const dir = path.join(repo, "plugins/coc-keeper/pi/extensions/onboarding");
const { default: onboarding } = await import(pathToFileURL(path.join(dir, "index.ts")).href);
const { STEPS } = await import(pathToFileURL(path.join(dir, "steps.ts")).href);

const registered = new Map();
onboarding({
  registerTool: (tool) => registered.set(tool.name, tool),
  on: () => {},
  sendMessage: () => {},
  setActiveTools: () => {},
  appendEntry: () => {},
}, { createClient: () => ({ callTool: async () => ({ ok: true }) }) });

assert.ok(registered.size >= 8, `expected the setup surface, got ${registered.size} tools`);

for (const [name, tool] of registered) {
  const properties = Object.keys(tool.parameters?.properties ?? {});
  // `coc_capabilities` genuinely takes nothing; every other tool stands for a
  // canonical operation whose parameters the model has no other way to learn.
  if (name === "coc_capabilities") {
    assert.deepEqual(properties, [], "coc_capabilities takes no parameters");
    continue;
  }
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
const external = new Set(["subagent", "subagent_status", "subagent_result", "await_subagent"]);
for (const step of STEPS) {
  for (const tool of step.tools) {
    assert.ok(
      registered.has(tool) || external.has(tool),
      `step ${step.id} names ${tool}, which nothing registers`,
    );
  }
}

console.log(JSON.stringify({ ok: true, module: "onboarding-tool-surface" }));
