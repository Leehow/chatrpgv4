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
const sourceRef = [{ source_id: "pdf:transport", pdf_index: 0 }];
const sourceAnswer = (value) => ({
  status: "source", value, source_refs: sourceRef,
});
const unresolvedAnswer = {
  status: "unresolved", inspected_source_refs: sourceRef,
};
const facts = {
  schema_version: 1,
  contract_id: "coc.opening-fast-facts.v1",
  era: sourceAnswer("1920s"),
  place: sourceAnswer("Boston"),
  investigator_hook: unresolvedAnswer,
  investigator_constraints: unresolvedAnswer,
  player_safe_summary: unresolvedAnswer,
  content_flags: sourceAnswer(["haunting"]),
};
await writeFile(producer, `#!/usr/bin/env node
import fs from "node:fs";
let input = ""; for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
fs.writeFileSync(${JSON.stringify(captured)}, JSON.stringify(task));
fs.appendFileSync(${JSON.stringify(marker)}, "launch\\n");
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-opening-source-review-transport-result.v1",
  status: "reviewed",
  campaign_id: task.campaign_id,
  scenario_id: task.scenario_id,
  opening_review_generation: task.opening_review_generation + 1,
  failure_class: null,
  facts: ${JSON.stringify(facts)},
}));
`, "utf8");
await chmod(producer, 0o755);
const malformedProducer = path.join(temp, "malformed.mjs");
await writeFile(malformedProducer, `#!/usr/bin/env node
process.stdout.write("{}");
`, "utf8");
await chmod(malformedProducer, 0o755);
const rawLeakProducer = path.join(temp, "raw-leak.mjs");
const leakedFacts = structuredClone(facts);
leakedFacts.player_safe_summary = {
  ...leakedFacts.player_safe_summary,
  raw_excerpt: "RAW_SOURCE_TEXT must never cross the transport",
};
await writeFile(rawLeakProducer, `#!/usr/bin/env node
let input = ""; for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-opening-source-review-transport-result.v1",
  status: "reviewed",
  campaign_id: task.campaign_id,
  scenario_id: task.scenario_id,
  opening_review_generation: task.opening_review_generation + 1,
  failure_class: null,
  facts: ${JSON.stringify(leakedFacts)},
}));
`, "utf8");
await chmod(rawLeakProducer, 0o755);
const failedProducer = path.join(temp, "failed.mjs");
await writeFile(failedProducer, `#!/usr/bin/env node
process.exit(7);
`, "utf8");
await chmod(failedProducer, 0o755);
const terminalFailureMarker = path.join(temp, "terminal-failure-launches");
const terminalFailureProducer = path.join(temp, "terminal-failure.mjs");
await writeFile(terminalFailureProducer, `#!/usr/bin/env node
import fs from "node:fs";
let input = ""; for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
fs.appendFileSync(${JSON.stringify(terminalFailureMarker)}, "launch\\n");
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-opening-source-review-transport-result.v1",
  status: "failed",
  campaign_id: task.campaign_id,
  scenario_id: task.scenario_id,
  opening_review_generation: task.opening_review_generation,
  failure_class: "pdf_scope_failed",
  facts: null,
}));
`, "utf8");
await chmod(terminalFailureProducer, 0o755);
const staleProducer = path.join(temp, "stale.mjs");
await writeFile(staleProducer, `#!/usr/bin/env node
let input = ""; for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-opening-source-review-transport-result.v1",
  status: "reviewed",
  campaign_id: task.campaign_id,
  scenario_id: task.scenario_id,
  opening_review_generation: task.opening_review_generation - 1,
  failure_class: null,
  facts: ${JSON.stringify(facts)},
}));
`, "utf8");
await chmod(staleProducer, 0o755);
const foreignProducer = path.join(temp, "foreign.mjs");
await writeFile(foreignProducer, `#!/usr/bin/env node
let input = ""; for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-opening-source-review-transport-result.v1",
  status: "reviewed",
  campaign_id: task.campaign_id,
  scenario_id: "foreign-scenario",
  opening_review_generation: task.opening_review_generation + 1,
  failure_class: null,
  facts: ${JSON.stringify(facts)},
}));
`, "utf8");
await chmod(foreignProducer, 0o755);
const futureProducer = path.join(temp, "future.mjs");
await writeFile(futureProducer, `#!/usr/bin/env node
let input = ""; for await (const chunk of process.stdin) input += chunk;
const task = JSON.parse(input);
process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-opening-source-review-transport-result.v1",
  status: "reviewed",
  campaign_id: task.campaign_id,
  scenario_id: task.scenario_id,
  opening_review_generation: task.opening_review_generation + 2,
  failure_class: null,
  facts: ${JSON.stringify(facts)},
}));
`, "utf8");
await chmod(futureProducer, 0o755);
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
      scenario_id: "scenario-a",
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
  workspaceRoot: temp,
  command: () => producer,
  states,
  controllers,
  onTerminal: (receipt) => terminals.push(receipt),
  audit: (entry) => audits.push(entry),
};

const first = await extension.autoDispatchPiOpeningSourceReview(
  deps, "coc_invoke", envelope(false),
);
assert.equal(first.status, "reviewed");
assert.equal(first.receipt.opening_review_generation, 4);
assert.deepEqual(first.receipt.facts, facts);
assert.equal(terminals.length, 1);
assert.equal(controllers.size, 0);
const task = JSON.parse(await readFile(captured, "utf8"));
assert.deepEqual(Object.keys(task).sort(), [
  "campaign_id", "contract_id", "opening_review_generation",
  "scenario_id", "schema_version", "transport_timeout_seconds",
  "workspace_root",
]);
// The producer sizes its own work from the deadline this transport enforces.
assert.equal(Number.isInteger(task.transport_timeout_seconds), true);
assert.equal(task.transport_timeout_seconds > 0, true);
assert.equal(JSON.stringify(task).includes("challenge"), false);
assert.equal(JSON.stringify(audits).includes("challenge"), false);
assert.equal(JSON.stringify(audits).includes("RAW_SOURCE_TEXT"), false);
const hiddenFollowUp = extension.openingSourceReviewTerminalFollowUp(
  first.receipt,
  { phase: "opening_character_setup_required" },
);
assert.deepEqual(hiddenFollowUp, {
  schema_version: 1,
  status: "reviewed",
  campaign_id: "campaign-a",
  next_operation: {
    operation: "setup.adopt_source_facts",
    invoke_via: "coc_invoke",
    campaign: "campaign-a",
    arguments: {
      campaign_id: "campaign-a",
      facts,
    },
  },
});
assert.equal(JSON.stringify(hiddenFollowUp).includes("RAW_SOURCE_TEXT"), false);

// Extension in-memory opening-setup state can be absent or misaligned when a
// review terminal lands (daemon restart, phase already advanced, or gate
// rehydration via a resume probe): observeOpeningSourceReviewTransport then
// returns null. The reviewed receipt itself is authoritative and
// self-contained, so the KP must still receive the exact sealed adopt card;
// a terminal_failure with a null failure_class would wrongly claim the
// review failed and trap the KP.
const misalignedFollowUp = extension.openingSourceReviewTerminalFollowUp(
  first.receipt,
  null,
);
assert.deepEqual(misalignedFollowUp, hiddenFollowUp);
assert.equal(misalignedFollowUp.status, "reviewed");
assert.equal(
  misalignedFollowUp.next_operation.operation,
  "setup.adopt_source_facts",
);
const misalignedFailedFollowUp = extension.openingSourceReviewTerminalFollowUp(
  {
    status: "failed",
    campaign_id: "campaign-a",
    failure_class: "pdf_scope_failed",
  },
  null,
);
assert.equal(misalignedFailedFollowUp.status, "terminal_failure");
assert.equal(misalignedFailedFollowUp.failure_class, "pdf_scope_failed");

const duplicate = await extension.autoDispatchPiOpeningSourceReview(
  deps, "coc_invoke", envelope(),
);
assert.deepEqual(duplicate, first);
assert.equal((await readFile(marker, "utf8")).trim().split("\n").length, 1);

const postFulfillmentEnvelope = {
  ok: true,
  tool: "setup.invoke",
  data: {
    opening_gate: {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_selection",
      campaign_id: "campaign-a",
      next_operation: {
        operation: "progressive.prepare_opening",
        invoke_via: "coc_invoke",
        prefilled_arguments: {},
        missing_arguments: [],
        hard_gate: true,
        authority: "canonical_setup",
      },
    },
  },
};
const restarted = await extension.autoDispatchPiOpeningSourceReview({
  ...deps,
  states: new Map(),
  controllers: new Map(),
}, "coc_invoke", postFulfillmentEnvelope);
assert.equal(restarted, null);
assert.equal((await readFile(marker, "utf8")).trim().split("\n").length, 1);

const terminalFailureStates = new Map();
const terminalFailureControllers = new Map();
const terminalFailures = [];
const terminalFailure = await extension.autoDispatchPiOpeningSourceReview({
  ...deps,
  command: () => terminalFailureProducer,
  states: terminalFailureStates,
  controllers: terminalFailureControllers,
  onTerminal: (receipt) => terminalFailures.push(receipt),
}, "coc_invoke", envelope());
assert.equal(terminalFailure.status, "failed");
assert.equal(terminalFailure.receipt.opening_review_generation, 3);
assert.equal(terminalFailure.receipt.failure_class, "pdf_scope_failed");
assert.equal(terminalFailureStates.size, 1);
assert.equal(terminalFailureControllers.size, 0);
assert.equal(terminalFailures.length, 1);
const repeatedTerminalFailure = await extension.autoDispatchPiOpeningSourceReview({
  ...deps,
  command: () => terminalFailureProducer,
  states: terminalFailureStates,
  controllers: terminalFailureControllers,
  onTerminal: (receipt) => terminalFailures.push(receipt),
}, "coc_invoke", envelope());
assert.deepEqual(repeatedTerminalFailure, terminalFailure);
assert.equal(terminalFailures.length, 1);
assert.equal(
  (await readFile(terminalFailureMarker, "utf8")).trim().split("\n").length,
  1,
);

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
  const terminalCount = terminals.length;
  const failed = await extension.autoDispatchPiOpeningSourceReview(
    retryDeps, "coc_invoke", envelope(),
  );
  assert.equal(failed.status, "retryable_failure");
  assert.equal(retryStates.size, 0);
  assert.equal(retryControllers.size, 0);
  if (initialCommand !== undefined) {
    assert.equal(terminals.length, terminalCount + 1);
    const terminal = terminals.at(-1);
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.failure_class, failed.failure_class);
    const evidencePath = path.join(
      temp, ".coc", "campaigns", "campaign-a", "logs",
      "opening-source-review-evidence", "transport-terminal-g3.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    assert.equal(evidence.status, "producer_terminal_failure");
    assert.equal(evidence.failure_class, failed.failure_class);
    assert.equal(Number.isInteger(evidence.rendered_markdown_pages), true);
  } else {
    assert.equal(terminals.length, terminalCount);
  }
  command = producer;
  retryDeps.timeoutMs = undefined;
  const recovered = await extension.autoDispatchPiOpeningSourceReview(
    retryDeps, "coc_invoke", envelope(),
  );
  assert.equal(recovered.status, "reviewed");
};

await retryCase(undefined);
await retryCase(malformedProducer);
await retryCase(rawLeakProducer);
await retryCase(failedProducer);
await retryCase(staleProducer);
await retryCase(foreignProducer);
await retryCase(futureProducer);
await retryCase(hangingProducer, { timeoutMs: 30 });
assert.equal(JSON.stringify(audits).includes("RAW_SOURCE_TEXT"), false);

const abortStates = new Map();
const abortControllers = new Map();
const abortPromise = extension.autoDispatchPiOpeningSourceReview({
  ...deps,
  command: () => hangingProducer,
  states: abortStates,
  controllers: abortControllers,
}, "coc_invoke", envelope(false));
for (let attempt = 0; attempt < 100 && abortControllers.size === 0; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.equal(abortControllers.size, 1);
const waitingAfterCharacter = await extension.autoDispatchPiOpeningSourceReview({
  ...deps,
  command: () => hangingProducer,
  states: abortStates,
  controllers: abortControllers,
}, "coc_invoke", envelope(true));
assert.equal(waitingAfterCharacter.status, "submitted");
assert.equal(abortControllers.size, 1);
abortControllers.values().next().value.abort();
const aborted = await abortPromise;
assert.equal(aborted.status, "retryable_failure");
assert.equal(aborted.failure_class, "opening_source_review_aborted");
assert.equal(terminals.at(-1).status, "failed");
assert.equal(terminals.at(-1).failure_class, "opening_source_review_aborted");
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
    pre_character_background_trigger: true,
    post_character_wait_without_duplicate: true,
    private_task_not_model_visible: true,
    exact_next_generation_same_scenario_only: true,
    valid_failed_receipt_is_terminal: true,
    duplicate_suppressed: true,
    restart_reconciled_without_duplicate_launch: true,
    outer_failures_remain_retryable: true,
    producer_death_emits_terminal_audit_and_evidence: true,
    timeout_and_abort_remain_retryable: true,
    exact_hidden_facts_card: true,
    misaligned_state_still_delivers_reviewed_adopt_card: true,
    misaligned_state_keeps_real_failure_class: true,
    no_raw_source_leakage: true,
  },
}));
