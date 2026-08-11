#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const { autoDispatchPiPendingStewardDomains } = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);
const workspace = await mkdtemp(path.join(os.tmpdir(), "coc-steward-refill-"));
const campaign = "refill-camp";
const save = path.join(workspace, ".coc", "campaigns", campaign, "save");
await mkdir(save, { recursive: true });

const document = (statuses) => ({
  schema_version: 2,
  campaign_id: campaign,
  updated_at: "2026-08-11T00:00:00+00:00",
  deliveries: {},
  notebook: {},
  domains: Object.fromEntries(
    ["init", "npc", "scene", "clue", "rule"].map((domain) => [
      domain,
      { status: statuses[domain] ?? "pending", retained: domain },
    ]),
  ),
  failed_chunks: [],
});
const writeState = (statuses) => writeFile(
  path.join(save, "steward-state.json"), JSON.stringify(document(statuses)), "utf8",
);
const release = {
  ok: true,
  tool: "progressive.project_opening",
  data: { status: "current" },
};
const params = { operation: "progressive.project_opening", campaign };

// Gate release fans out every background pending domain, but never init.
await writeState({ scene: "ready" });
const sent = [];
const states = new Map();
const audits = [];
let result = await autoDispatchPiPendingStewardDomains({
  isCurrent: () => true,
  workspaceRoot: workspace,
  states,
  send: (task) => sent.push(task),
  recordFailure: async () => assert.fail("no dispatch should fail"),
  audit: (entry) => audits.push(entry),
}, params, release);
assert.deepEqual(result.domains, ["clue", "npc", "rule"]);
assert.deepEqual(
  sent.map((task) => task.domain).sort(),
  ["clue", "npc", "rule"],
);
assert.equal(sent.some((task) => task.domain === "init"), false);
assert.equal(sent.some((task) => task.domain === "scene"), false);
assert.equal(sent.find((task) => task.domain === "clue").agent_id, "steward-rule");
assert.equal(audits.filter((entry) => entry.status === "submitted").length, 3);

// A duplicate opening-current receipt must not dispatch already-owned domains.
result = await autoDispatchPiPendingStewardDomains({
  isCurrent: () => true,
  workspaceRoot: workspace,
  states,
  send: (task) => sent.push(task),
  recordFailure: async () => assert.fail("no dispatch should fail"),
  audit: () => {},
}, params, release);
assert.deepEqual(result.domains, []);
assert.equal(sent.length, 3);

// A manual domain completion that wins before this host refill is observed is
// excluded from the fanout rather than being re-sent.
await writeState({ npc: "ready", scene: "ready", rule: "ready" });
const manualSent = [];
await autoDispatchPiPendingStewardDomains({
  isCurrent: () => true,
  workspaceRoot: workspace,
  states: new Map(),
  send: (task) => manualSent.push(task),
  recordFailure: async () => assert.fail("no dispatch should fail"),
  audit: () => {},
}, params, release);
assert.deepEqual(manualSent.map((task) => task.domain), ["clue"]);

// One failed dispatch records that domain's failed chunk and does not prevent
// other pending domains from being queued.
await writeState({});
const failureSent = [];
const failures = [];
await autoDispatchPiPendingStewardDomains({
  isCurrent: () => true,
  workspaceRoot: workspace,
  states: new Map(),
  send: (task) => {
    if (task.domain === "scene") throw new Error("synthetic send failure");
    failureSent.push(task);
  },
  recordFailure: async (campaignId, domain, content, dispatchKey) => {
    failures.push({ campaignId, domain, content, dispatchKey });
  },
  audit: () => {},
}, params, release);
assert.deepEqual(failureSent.map((task) => task.domain).sort(), ["clue", "npc", "rule"]);
assert.deepEqual(failures, [{
  campaignId: campaign,
  domain: "scene",
  content: { retained: "scene" },
  dispatchKey: `steward-refill:${campaign}:scene`,
}]);

process.stdout.write(JSON.stringify({ ok: true, dispatched: sent.length, failures: failures.length }));
