#!/usr/bin/env node
// Smoke: two concurrent coc_invoke raw-PDF-bind retries for the same bind
// path must share one in-flight locator producer run instead of launching
// two children against the same provider account. Regression for the
// Cold Harvest acceptance observation where a duplicate concurrent locator
// child (12:13:49, started while the first was still rendering) timed out
// at the old 240s budget while its sibling succeeded.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import {
  chmod, mkdtemp, readFile, writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const extension = await import(pathToFileURL(path.join(
  root, "plugins/coc-keeper/pi/extensions/index.ts",
)).href);
const { autoDispatchPiRawPdfBindBundle } = extension.__test;
const temp = await mkdtemp(path.join(os.tmpdir(), "pi-raw-pdf-dedup-"));
const marker = path.join(temp, "launches");
const pdf = path.join(temp, "module.pdf");
await writeFile(pdf, "%PDF fixture for the raw-pdf-bind dedup smoke");
const producer = path.join(temp, "producer.mjs");
await writeFile(producer, `#!/usr/bin/env node
import fs from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--capabilities") {
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    contract_id: "coc.pi-source-scope-locator-producer-capabilities.v1",
    capability: "bounded_pdf_visual_locator",
    producer: "pi-grok-pdf-skill",
    max_selected_pages: 3,
    writes_canonical_bundle: true,
    visual_review: true,
    repository_pdf_parser: false,
    ocr: false,
    cache_reference: false,
  }));
  process.exit(0);
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
fs.appendFileSync(${JSON.stringify(marker)}, "run\\n");
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-source-scope-locator-producer-result.v1",
  job_id: task.job_id,
  status: "located",
  kind: task.kind,
  target_id: task.target_id,
  pdf_indices: [1],
  source_bundle_path: task.source_bundle_path,
  failure_class: null,
}));
`, "utf8");
await chmod(producer, 0o755);
const rawPdfBindError = (
  "host source bundle must be a directory (not a file) containing manifest.json"
);
const params = {
  operation: "setup.invoke",
  campaign: "dedup-camp",
  arguments: {
    kind: "scenario.bind_pdf",
    payload: { source_bundle_path: pdf, campaign_id: "dedup-camp" },
  },
};
const value = {
  ok: false, tool: "setup.invoke", error: { message: rawPdfBindError },
};
const deps = {
  isCurrent: () => true,
  workspaceRoot: temp,
  command: () => producer,
  states: new Map(),
  controllers: new Map(),
  inflight: new Map(),
  inflightCampaigns: new Map(),
  waitNotifiedCampaigns: new Set(),
  onTerminal: () => {},
  audit: () => {},
  timeoutMs: 30_000,
};
const [first, second] = await Promise.all([
  autoDispatchPiRawPdfBindBundle(deps, "coc_invoke", value, params),
  autoDispatchPiRawPdfBindBundle(deps, "coc_invoke", value, params),
]);
assert.equal(first.status, "located");
assert.equal(second.status, "located");
assert.equal(first, second, "concurrent retries must share one in-flight run");
assert.equal(
  (await readFile(marker, "utf8")).split("\n").filter((line) => line === "run").length,
  1,
  "exactly one locator --run child must have been spawned",
);
// A retry after completion is served from the finished states cache.
const third = await autoDispatchPiRawPdfBindBundle(deps, "coc_invoke", value, params);
assert.equal(third.status, "located");
assert.equal(third, first);
assert.equal(
  (await readFile(marker, "utf8")).split("\n").filter((line) => line === "run").length,
  1,
  "completed retries must not respawn the producer",
);
// A valid raw PDF job can still be producing when the KP guesses another
// path. That guessed path must produce a waiting hint, not a false terminal
// failure; only the original producer is allowed to decide its outcome.
const pendingMarker = path.join(temp, "pending-launches");
const pendingProducer = path.join(temp, "pending-producer.mjs");
await writeFile(pendingProducer, `#!/usr/bin/env node
import fs from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--capabilities") {
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    contract_id: "coc.pi-source-scope-locator-producer-capabilities.v1",
    capability: "bounded_pdf_visual_locator",
    producer: "pi-grok-pdf-skill",
    max_selected_pages: 3,
    writes_canonical_bundle: true,
    visual_review: true,
    repository_pdf_parser: false,
    ocr: false,
    cache_reference: false,
  }));
  process.exit(0);
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
fs.writeFileSync(${JSON.stringify(pendingMarker)}, "run\\n");
await new Promise((resolve) => setTimeout(resolve, 250));
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-source-scope-locator-producer-result.v1",
  job_id: task.job_id,
  status: "located",
  kind: task.kind,
  target_id: task.target_id,
  pdf_indices: [1],
  source_bundle_path: task.source_bundle_path,
  failure_class: null,
}));
`, "utf8");
await chmod(pendingProducer, 0o755);
const pendingTerminals = [];
const pendingDeps = {
  ...deps,
  command: () => pendingProducer,
  states: new Map(),
  controllers: new Map(),
  inflight: new Map(),
  inflightCampaigns: new Map(),
  waitNotifiedCampaigns: new Set(),
  onTerminal: (entry) => pendingTerminals.push(entry),
};
const pendingParams = {
  ...params,
  campaign: "pending-camp",
  arguments: {
    ...params.arguments,
    payload: { source_bundle_path: pdf, campaign_id: "pending-camp" },
  },
};
const pendingRun = autoDispatchPiRawPdfBindBundle(
  pendingDeps, "coc_invoke", value, pendingParams,
);
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    if ((await readFile(pendingMarker, "utf8")).includes("run")) break;
  } catch { /* producer has not reached --run yet */ }
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (attempt === 49) throw new Error("pending producer did not start");
}
const guessed = await autoDispatchPiRawPdfBindBundle(
  pendingDeps,
  "coc_invoke",
  value,
  {
    ...pendingParams,
    arguments: {
      ...pendingParams.arguments,
      payload: {
        source_bundle_path: path.join(temp, "guessed-not-a-bundle.pdf"),
        campaign_id: "pending-camp",
      },
    },
  },
);
assert.equal(guessed.status, "waiting");
assert.deepEqual(
  pendingTerminals.map((entry) => entry.status),
  ["waiting"],
  "an active first-bundle producer must suppress false failure terminals",
);
const pendingResult = await pendingRun;
assert.equal(pendingResult.status, "located");
assert.deepEqual(
  pendingTerminals.map((entry) => entry.status),
  ["waiting", "located"],
);

// A real producer failure remains terminal after no first-bundle job is active.
const failureProducer = path.join(temp, "failure-producer.mjs");
await writeFile(failureProducer, `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[0] === "--capabilities") {
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    contract_id: "coc.pi-source-scope-locator-producer-capabilities.v1",
    capability: "bounded_pdf_visual_locator",
    producer: "pi-grok-pdf-skill",
    max_selected_pages: 3,
    writes_canonical_bundle: true,
    visual_review: true,
    repository_pdf_parser: false,
    ocr: false,
    cache_reference: false,
  }));
  process.exit(0);
}
process.stderr.write("fixture producer failed");
process.exit(7);
`, "utf8");
await chmod(failureProducer, 0o755);
const failureTerminals = [];
const failure = await autoDispatchPiRawPdfBindBundle(
  {
    ...deps,
    command: () => failureProducer,
    states: new Map(),
    controllers: new Map(),
    inflight: new Map(),
    inflightCampaigns: new Map(),
    waitNotifiedCampaigns: new Set(),
    onTerminal: (entry) => failureTerminals.push(entry),
  },
  "coc_invoke",
  value,
  {
    ...params,
    campaign: "failure-camp",
    arguments: {
      ...params.arguments,
      payload: { source_bundle_path: pdf, campaign_id: "failure-camp" },
    },
  },
);
assert.equal(failure.status, "failed");
assert.equal(failure.failure_class, "raw_pdf_bind_bundle_failed");
assert.deepEqual(
  failureTerminals.map((entry) => entry.status),
  ["failed"],
  "a real producer failure must still send a terminal failure",
);

console.log("raw-pdf-bind dedup smoke OK");
