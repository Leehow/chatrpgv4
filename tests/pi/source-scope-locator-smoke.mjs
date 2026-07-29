#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const extension = await import(pathToFileURL(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
)).href);
const temp = await mkdtemp(path.join(os.tmpdir(), "coc-pi-locator-"));
const workspace = path.join(temp, "workspace");
await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));

function task() {
  return {
    schema_version: 1,
    contract_id: "coc.pi-source-scope-locator-task.v1",
    bootstrap_instruction: "closed",
    instruction_ref: path.join(root, "plugins/coc-keeper/agents/coc-source-scope-locator.md"),
    contract_ref: path.join(root, "plugins/coc-keeper/references/source-scope-locator-v1.json"),
    contract_revision: `sha256:${"a".repeat(64)}`,
    adapter_mode: "pi_external_pdf_skill_lifecycle",
    model_policy: "inherit_parent",
    workspace_root: workspace,
    campaign_id: "camp",
    asset_root_id: "asset",
    job_id: "job-locator",
    job_kind: "deepen_location",
    kind: "location",
    target_id: "archive",
    target_label: "Archive",
    reason: "exact arrival",
    source: {
      path: path.join(temp, "module.pdf"),
      source_id: "pdf:asset",
      file_sha256: "b".repeat(64),
    },
    source_bundle_path: path.join(
      workspace, ".tmp", "coc-source-scope", "camp", "job-locator", "contract",
    ),
    cached_pdf_indices: [],
    max_selected_pages: 3,
    source_bundle_manifest_contract: {
      schema_version: 1,
      producer: "codex-pdf-skill",
      source_required: ["source_id", "path", "file_sha256", "page_count"],
      page_required: [
        "pdf_index", "markdown_path", "text_sha256", "review_state",
        "parse_confidence", "grep_anchors",
      ],
      review_state: "manual_accepted",
      parse_confidence: "number_from_0_through_1",
      text_sha256: "sha256_of_exact_markdown_file_bytes",
      assets: [],
    },
    resolve_operation: {
      operation: "progressive.resolve_source_scope",
      invoke_via: "coc_invoke",
      prefilled_arguments: {
        job_id: "job-locator",
        kind: "location",
        target_id: "archive",
      },
      missing_arguments: [
        "pdf_indices",
        "source_bundle_path_if_any_selected_page_is_uncached",
      ],
      authority: "source_scope_only",
      hard_gate: false,
    },
    result_delivery: "natural_completion_notification_only",
  };
}

function envelope(locatorTask = task()) {
  return {
    ok: true,
    tool: "progressive.status",
    data: {
      source_scope_takeover: {
        next_host_action: {
          action: "invoke_coc_dispatch_source_scope_locator",
          task: locatorTask,
        },
      },
    },
  };
}

async function producer(name, body) {
  const file = path.join(temp, name);
  await writeFile(file, `#!/usr/bin/env node\n${body}\n`, "utf8");
  await chmod(file, 0o755);
  return file;
}

const handshake = JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-source-scope-locator-producer-capabilities.v1",
  capability: "bounded_pdf_visual_locator",
  producer: "fake-reviewed-pdf-skill",
  max_selected_pages: 3,
  writes_canonical_bundle: true,
  visual_review: true,
  repository_pdf_parser: false,
  ocr: false,
});
const located = JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-source-scope-locator-producer-result.v1",
  job_id: "job-locator",
  status: "located",
  kind: "location",
  target_id: "archive",
  pdf_indices: [2],
  source_bundle_path: task().source_bundle_path,
  failure_class: null,
});
const marker = path.join(temp, "runs.txt");
const good = await producer("good.mjs", `
import fs from "node:fs";
if (process.argv[2] === "--capabilities") process.stdout.write(${JSON.stringify(handshake)});
else {
  fs.appendFileSync(${JSON.stringify(marker)}, "run\\n");
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  JSON.parse(input);
  process.stdout.write(${JSON.stringify(located)});
}`);

const direct = await extension.runPiSourceScopeProducer(task(), { command: good });
assert.deepEqual(direct.pdf_indices, [2]);

const states = new Map();
const calls = [];
let chained = 0;
const deps = {
  isCurrent: () => true,
  command: () => good,
  states,
  audit: () => {},
  call: async (name, args) => {
    calls.push({ name, args });
    return {
      ok: true,
      tool: "progressive.resolve_source_scope",
      data: {
        replacement_job_id: "replacement",
        background_takeover: {
          next_host_action: { action: "invoke_coc_dispatch_source_work" },
        },
      },
    };
  },
  onResolved: async (value) => {
    assert.equal(value.data.replacement_job_id, "replacement");
    chained += 1;
  },
};
const first = await extension.autoDispatchPiSourceScopeLocator(
  deps, "coc_invoke", envelope(),
);
assert.equal(first.status, "scope_registered");
assert.equal(calls.length, 1);
assert.equal(calls[0].args.operation, "progressive.resolve_source_scope");
assert.deepEqual(calls[0].args.arguments.pdf_indices, [2]);
assert.equal(chained, 1);
const beforeDuplicate = (await readFile(marker, "utf8")).split("\n").filter(Boolean).length;
const duplicate = await extension.autoDispatchPiSourceScopeLocator(
  deps, "coc_invoke", envelope(),
);
assert.deepEqual(duplicate, first);
assert.equal(
  (await readFile(marker, "utf8")).split("\n").filter(Boolean).length,
  beforeDuplicate,
);
assert.equal(calls.length, 1);

const unavailableCalls = [];
const unavailable = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  command: () => undefined,
  states: new Map(),
  call: async (...args) => { unavailableCalls.push(args); return {}; },
}, "coc_invoke", envelope());
assert.equal(unavailable.failure_class, "source_scope_locator_command_unavailable");
assert.equal(unavailableCalls.length, 0);

const badHandshake = await producer(
  "bad-handshake.mjs",
  `process.stdout.write(JSON.stringify({schema_version:1, contract_id:"wrong"}));`,
);
await assert.rejects(
  extension.runPiSourceScopeProducer(task(), { command: badHandshake }),
  /unsupported fields|capability mismatch/,
);
const badHandshakeCalls = [];
await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  command: () => badHandshake,
  call: async (...args) => { badHandshakeCalls.push(args); return {}; },
}, "coc_invoke", envelope());
assert.equal(badHandshakeCalls.length, 0);

const badReceipt = await producer("bad-receipt.mjs", `
if (process.argv[2] === "--capabilities") process.stdout.write(${JSON.stringify(handshake)});
else process.stdout.write(JSON.stringify({schema_version:1, contract_id:"wrong"}));
`);
await assert.rejects(
  extension.runPiSourceScopeProducer(task(), { command: badReceipt }),
  /unsupported fields|binding drift/,
);
const badReceiptCalls = [];
await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  command: () => badReceipt,
  call: async (...args) => { badReceiptCalls.push(args); return {}; },
}, "coc_invoke", envelope());
assert.equal(badReceiptCalls.length, 0);

const slow = await producer("slow.mjs", `
if (process.argv[2] === "--capabilities") process.stdout.write(${JSON.stringify(handshake)});
else setTimeout(() => process.stdout.write(${JSON.stringify(located)}), 500);
`);
await assert.rejects(
  extension.runPiSourceScopeProducer(task(), { command: slow, timeoutMs: 25 }),
  /timed out/,
);
const timeoutCalls = [];
await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  command: () => slow,
  call: async (...args) => { timeoutCalls.push(args); return {}; },
}, "coc_invoke", envelope(), { timeoutMs: 25 });
assert.equal(timeoutCalls.length, 0);

process.stdout.write(JSON.stringify({
  ok: true,
  checks: {
    strict_preflight_and_receipt: true,
    locate_resolve_replacement_chain: true,
    duplicate_suppressed: true,
    missing_command_no_mutation: true,
    invalid_handshake_no_mutation: true,
    invalid_receipt_no_mutation: true,
    timeout_no_mutation: true,
  },
}) + "\n");
