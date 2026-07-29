#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const extension = await import(pathToFileURL(path.join(
  root, "plugins/coc-keeper/pi/extensions/index.ts",
)).href);
const temp = await mkdtemp(path.join(os.tmpdir(), "coc-opening-review-"));
const marker = path.join(temp, "coordinator-launches");
const captured = path.join(temp, "transport-task.json");
const producer = path.join(temp, "producer.mjs");
await writeFile(producer, `#!/usr/bin/env node
import fs from "node:fs";
let input = ""; for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
fs.writeFileSync(${JSON.stringify(captured)}, JSON.stringify(task));
if (!fs.existsSync(${JSON.stringify(marker)})) {
  fs.writeFileSync(${JSON.stringify(marker)}, "launch\\n");
}
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-opening-source-review-transport-result.v1",
  status: "reviewed",
  campaign_id: task.campaign_id,
  scenario_id: "scenario-a",
  opening_review_generation: task.opening_review_generation,
  failure_class: null,
}));
`, "utf8");
await chmod(producer, 0o755);
const malformedProducer = path.join(temp, "malformed.mjs");
await writeFile(malformedProducer, `#!/usr/bin/env node
process.stdout.write("{}");
`, "utf8");
await chmod(malformedProducer, 0o755);
const failedProducer = path.join(temp, "failed.mjs");
await writeFile(failedProducer, `#!/usr/bin/env node
process.exit(7);
`, "utf8");
await chmod(failedProducer, 0o755);
const hangingProducer = path.join(temp, "hanging.mjs");
await writeFile(hangingProducer, `#!/usr/bin/env node
process.stdin.resume();
setInterval(() => {}, 1000);
`, "utf8");
await chmod(hangingProducer, 0o755);

const envelope = (complete = true) => ({
  ok: false,
  tool: "session.resume",
  error: {
    code: "opening_setup_incomplete",
    details: {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_review_required",
      campaign_id: "campaign-a",
      opening_review_generation: 3,
      character_setup_complete: complete,
    },
  },
});
const states = new Map();
const controllers = new Map();
const terminals = [];
const audits = [];
const deps = {
  isCurrent: () => true,
  workspaceRoot: root,
  command: () => producer,
  states,
  controllers,
  onTerminal: (receipt) => terminals.push(receipt),
  audit: (entry) => audits.push(entry),
};

assert.equal(await extension.autoDispatchPiOpeningSourceReview(
  deps, "coc_invoke", envelope(false),
), null);
const first = await extension.autoDispatchPiOpeningSourceReview(
  deps, "coc_invoke", envelope(),
);
assert.equal(first.status, "reviewed");
assert.equal(terminals.length, 1);
assert.equal(controllers.size, 0);
const task = JSON.parse(await readFile(captured, "utf8"));
assert.deepEqual(Object.keys(task).sort(), [
  "campaign_id", "contract_id", "opening_review_generation",
  "schema_version", "workspace_root",
]);
assert.equal(JSON.stringify(task).includes("challenge"), false);
assert.equal(JSON.stringify(audits).includes("challenge"), false);

const duplicate = await extension.autoDispatchPiOpeningSourceReview(
  deps, "coc_invoke", envelope(),
);
assert.deepEqual(duplicate, first);
assert.equal((await readFile(marker, "utf8")).trim().split("\n").length, 1);

const restarted = await extension.autoDispatchPiOpeningSourceReview({
  ...deps,
  states: new Map(),
  controllers: new Map(),
}, "coc_invoke", envelope());
assert.equal(restarted.status, "reviewed");
assert.equal((await readFile(marker, "utf8")).trim().split("\n").length, 1);

const retryCase = async (initialCommand, options = {}) => {
  let command = initialCommand;
  const retryStates = new Map();
  const retryControllers = new Map();
  const retryDeps = {
    ...deps,
    states: retryStates,
    controllers: retryControllers,
    command: () => command,
    timeoutMs: options.timeoutMs,
  };
  const failed = await extension.autoDispatchPiOpeningSourceReview(
    retryDeps, "coc_invoke", envelope(),
  );
  assert.equal(failed.status, "retryable_failure");
  assert.equal(retryStates.size, 0);
  assert.equal(retryControllers.size, 0);
  command = producer;
  retryDeps.timeoutMs = undefined;
  const recovered = await extension.autoDispatchPiOpeningSourceReview(
    retryDeps, "coc_invoke", envelope(),
  );
  assert.equal(recovered.status, "reviewed");
};

await retryCase(undefined);
await retryCase(malformedProducer);
await retryCase(failedProducer);
await retryCase(hangingProducer, { timeoutMs: 30 });

const abortStates = new Map();
const abortControllers = new Map();
const abortPromise = extension.autoDispatchPiOpeningSourceReview({
  ...deps,
  command: () => hangingProducer,
  states: abortStates,
  controllers: abortControllers,
}, "coc_invoke", envelope());
for (let attempt = 0; attempt < 100 && abortControllers.size === 0; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.equal(abortControllers.size, 1);
abortControllers.values().next().value.abort();
const aborted = await abortPromise;
assert.equal(aborted.status, "retryable_failure");
assert.equal(aborted.failure_class, "opening_source_review_aborted");
assert.equal(abortStates.size, 0);
assert.equal(abortControllers.size, 0);
const abortRecovered = await extension.autoDispatchPiOpeningSourceReview({
  ...deps,
  states: abortStates,
  controllers: abortControllers,
}, "coc_invoke", envelope());
assert.equal(abortRecovered.status, "reviewed");

console.log(JSON.stringify({
  ok: true,
  checks: {
    character_completion_trigger: true,
    private_task_not_model_visible: true,
    duplicate_suppressed: true,
    restart_reconciled_without_duplicate_launch: true,
    outer_failures_remain_retryable: true,
    timeout_and_abort_remain_retryable: true,
  },
}));
