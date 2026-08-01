#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
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
    model_policy: "pinned_xai_grok_4_5_thinking_low",
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
      title: "Module",
      file_sha256: "b".repeat(64),
    },
    source_bundle_path: path.join(
      workspace, ".tmp", "coc-source-scope", "camp", "job-locator", "contract",
    ),
    cached_pdf_indices: [],
    max_selected_pages: 3,
    pdf_index_caliber: "printed_page_number_1_based",
    source_bundle_manifest_contract: {
      schema_version: 1,
      producer: "codex-pdf-skill",
      source_required: [
        "source_id", "title", "path", "file_sha256", "page_count",
      ],
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

function taskAt(name) {
  return {
    ...task(),
    source_bundle_path: path.join(
      workspace, ".tmp", "coc-source-scope", "camp", name, "contract",
    ),
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
import crypto from "node:crypto";
import fs from "node:fs";
if (process.argv[2] === "--capabilities") process.stdout.write(${JSON.stringify(handshake)});
else {
  fs.appendFileSync(${JSON.stringify(marker)}, "run\\n");
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  const task = JSON.parse(input);
  fs.mkdirSync(task.source_bundle_path, {recursive:true});
  const page = "# Appendix 2\\n\\nAccepted extra source page.\\n";
  fs.writeFileSync(task.source_bundle_path + "/page-0002.md", page);
  fs.writeFileSync(task.source_bundle_path + "/manifest.json", JSON.stringify({
    schema_version: 1,
    producer: "codex-pdf-skill",
    source: {
      source_id: task.source.source_id,
      title: task.source.title,
      path: task.source.path,
      file_sha256: task.source.file_sha256,
      page_count: 3,
    },
    pages: [{
      pdf_index: 2,
      markdown_path: "page-0002.md",
      text_sha256: crypto.createHash("sha256").update(page).digest("hex"),
      review_state: "manual_accepted",
      parse_confidence: 0.99,
      grep_anchors: ["Accepted extra source page."],
    }],
    assets: [],
  }));
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    contract_id: "coc.pi-source-scope-locator-producer-result.v1",
    job_id: task.job_id,
    status: "located",
    kind: task.kind,
    target_id: task.target_id,
    pdf_indices: [2],
    source_bundle_path: task.source_bundle_path,
    failure_class: null,
  }));
}`);

const directTask = {
  ...task(),
  source_bundle_path: path.join(
    workspace, ".tmp", "coc-source-scope", "camp", "direct", "contract",
  ),
};
const direct = await extension.runPiSourceScopeProducer(
  directTask,
  { command: good },
);
assert.deepEqual(direct.pdf_indices, [2]);
await rm(directTask.source_bundle_path, { recursive: true });

async function invalidTitleProducer(name, titleField) {
  return await producer(name, `
import crypto from "node:crypto";
import fs from "node:fs";
if (process.argv[2] === "--capabilities") process.stdout.write(${JSON.stringify(handshake)});
else {
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  const task = JSON.parse(input);
  fs.mkdirSync(task.source_bundle_path, {recursive:true});
  const page = "# Appendix 2\\n\\nAccepted extra source page.\\n";
  fs.writeFileSync(task.source_bundle_path + "/page-0002.md", page);
  fs.writeFileSync(task.source_bundle_path + "/manifest.json", JSON.stringify({
    schema_version: 1,
    producer: "codex-pdf-skill",
    source: {
      source_id: task.source.source_id,
      ${titleField}
      path: task.source.path,
      file_sha256: task.source.file_sha256,
      page_count: 3,
    },
    pages: [{
      pdf_index: 2,
      markdown_path: "page-0002.md",
      text_sha256: crypto.createHash("sha256").update(page).digest("hex"),
      review_state: "manual_accepted",
      parse_confidence: 0.99,
      grep_anchors: ["Accepted extra source page."],
    }],
    assets: [],
  }));
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    contract_id: "coc.pi-source-scope-locator-producer-result.v1",
    job_id: task.job_id,
    status: "located",
    kind: task.kind,
    target_id: task.target_id,
    pdf_indices: [2],
    source_bundle_path: task.source_bundle_path,
    failure_class: null,
  }));
}`);
}

for (const [name, titleField] of [
  ["missing-title", ""],
  ["mismatched-title", 'title: "Wrong Module",'],
]) {
  const titleTask = taskAt(name);
  const titleCalls = [];
  const titleProducer = await invalidTitleProducer(`${name}.mjs`, titleField);
  const titleResult = await extension.autoDispatchPiSourceScopeLocator({
    isCurrent: () => true,
    command: () => titleProducer,
    states: new Map(),
    controllers: new Map(),
    audit: () => {},
    call: async (...args) => { titleCalls.push(args); return {}; },
    onResolved: async () => {},
  }, "coc_invoke", envelope(titleTask));
  assert.equal(
    titleResult.failure_class,
    "source_scope_bundle_publication_failed",
  );
  assert.equal(titleCalls.length, 0);
  await assert.rejects(lstat(titleTask.source_bundle_path));
}

const states = new Map();
const calls = [];
let chained = 0;
const deps = {
  isCurrent: () => true,
  command: () => good,
  states,
  controllers: new Map(),
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
const stableManifestPath = path.join(
  task().source_bundle_path,
  "manifest.json",
);
const stableManifest = await readFile(stableManifestPath);
const beforeExisting = (
  await readFile(marker, "utf8")
).split("\n").filter(Boolean).length;
const existing = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: new Map(),
}, "coc_invoke", envelope());
assert.equal(existing.status, "scope_registered");
assert.deepEqual(
  await readFile(stableManifestPath),
  stableManifest,
);
assert.equal(
  (await readFile(marker, "utf8")).split("\n").filter(Boolean).length,
  beforeExisting,
);
assert.equal(calls.length, 2);

const invalidStableTask = taskAt("invalid-stable");
await mkdir(invalidStableTask.source_bundle_path, { recursive: true });
await writeFile(
  path.join(invalidStableTask.source_bundle_path, "do-not-overwrite"),
  "user evidence",
);
const invalidStableCalls = [];
const invalidStable = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: new Map(),
  call: async (...args) => { invalidStableCalls.push(args); return {}; },
}, "coc_invoke", envelope(invalidStableTask));
assert.equal(
  invalidStable.failure_class,
  "source_scope_stable_bundle_mismatch",
);
assert.equal(invalidStableCalls.length, 0);
assert.equal(
  await readFile(
    path.join(invalidStableTask.source_bundle_path, "do-not-overwrite"),
    "utf8",
  ),
  "user evidence",
);

const sessionTask = taskAt("session-recovery");
let currentChecks = 0;
const firstSessionCalls = [];
const firstSession = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  isCurrent: () => {
    currentChecks += 1;
    return currentChecks < 3;
  },
  states: new Map(),
  controllers: new Map(),
  call: async (...args) => { firstSessionCalls.push(args); return {}; },
}, "coc_invoke", envelope(sessionTask));
assert.equal(
  firstSession.failure_class,
  "session_closed_before_scope_registration",
);
assert.equal(firstSessionCalls.length, 0);
const beforeRecovery = (
  await readFile(marker, "utf8")
).split("\n").filter(Boolean).length;
const secondSessionCalls = [];
const secondSession = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: new Map(),
  onResolved: async () => {},
  call: async (name, args) => {
    secondSessionCalls.push({ name, args });
    return {
      ok: true,
      data: {
        resolved_job_id: sessionTask.job_id,
        replacement_job_id: "replacement-after-recovery",
      },
    };
  },
}, "coc_invoke", envelope(sessionTask));
assert.equal(secondSession.status, "scope_registered");
assert.equal(secondSessionCalls.length, 1);
assert.equal(
  (await readFile(marker, "utf8")).split("\n").filter(Boolean).length,
  beforeRecovery,
);

const staleLockTask = taskAt("stale-lock");
await mkdir(path.dirname(staleLockTask.source_bundle_path), {
  recursive: true,
});
await mkdir(`${staleLockTask.source_bundle_path}.publish.lock`);
await writeFile(
  path.join(
    `${staleLockTask.source_bundle_path}.publish.lock`,
    "owner.json",
  ),
  JSON.stringify({
    schema_version: 1,
    contract_id: "coc.pi-source-scope-publish-lock.v1",
    pid: 2147483647,
    owner_nonce: "00000000-0000-4000-8000-000000000000",
    created_at_ms: Date.now() - 60_000,
    task_digest: "c".repeat(64),
  }),
);
const staleLockResult = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: new Map(),
  onResolved: async () => {},
}, "coc_invoke", envelope(staleLockTask));
assert.equal(staleLockResult.status, "scope_registered");
await readFile(path.join(staleLockTask.source_bundle_path, "manifest.json"));

const activeLockTask = taskAt("active-lock");
await mkdir(path.dirname(activeLockTask.source_bundle_path), {
  recursive: true,
});
await mkdir(`${activeLockTask.source_bundle_path}.publish.lock`);
await writeFile(
  path.join(
    `${activeLockTask.source_bundle_path}.publish.lock`,
    "owner.json",
  ),
  JSON.stringify({
    schema_version: 1,
    contract_id: "coc.pi-source-scope-publish-lock.v1",
    pid: process.pid,
    owner_nonce: "00000000-0000-4000-8000-000000000001",
    created_at_ms: Date.now() - 60_000,
    task_digest: "d".repeat(64),
  }),
);
const activeLockResult = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: new Map(),
  call: async () => {
    throw new Error("active lock must block canonical mutation");
  },
}, "coc_invoke", envelope(activeLockTask));
assert.equal(
  activeLockResult.failure_class,
  "source_scope_bundle_publication_failed",
);
await assert.rejects(readFile(activeLockTask.source_bundle_path));

const staleEmptyLockTask = taskAt("stale-empty-lock");
const staleEmptyLockPath = `${staleEmptyLockTask.source_bundle_path}.publish.lock`;
const staleEmptyGuardPath = `${staleEmptyLockPath}.recovery.guard`;
await mkdir(path.dirname(staleEmptyLockTask.source_bundle_path), {
  recursive: true,
});
await mkdir(staleEmptyLockPath);
await mkdir(staleEmptyGuardPath);
const oldTimestamp = new Date(Date.now() - 60_000);
await utimes(staleEmptyLockPath, oldTimestamp, oldTimestamp);
await utimes(staleEmptyGuardPath, oldTimestamp, oldTimestamp);
const staleEmptyLockResult = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: new Map(),
  onResolved: async () => {},
}, "coc_invoke", envelope(staleEmptyLockTask));
assert.equal(staleEmptyLockResult.status, "scope_registered");
await readFile(path.join(staleEmptyLockTask.source_bundle_path, "manifest.json"));

const staleTruncatedLockTask = taskAt("stale-truncated-lock");
const staleTruncatedLockPath =
  `${staleTruncatedLockTask.source_bundle_path}.publish.lock`;
const staleDeadGuardPath =
  `${staleTruncatedLockPath}.recovery.guard`;
await mkdir(path.dirname(staleTruncatedLockTask.source_bundle_path), {
  recursive: true,
});
await mkdir(staleTruncatedLockPath);
await writeFile(path.join(staleTruncatedLockPath, "owner.json"), "{");
await utimes(staleTruncatedLockPath, oldTimestamp, oldTimestamp);
await mkdir(staleDeadGuardPath);
await mkdir(path.join(
  staleDeadGuardPath,
  [
    "owner-v1",
    "2147483647",
    String(Date.now() - 60_000),
    "00000000-0000-4000-8000-000000000002",
    "e".repeat(64),
  ].join("__"),
));
const staleTruncatedLockResult =
  await extension.autoDispatchPiSourceScopeLocator({
    ...deps,
    states: new Map(),
    controllers: new Map(),
    onResolved: async () => {},
  }, "coc_invoke", envelope(staleTruncatedLockTask));
assert.equal(staleTruncatedLockResult.status, "scope_registered");
await readFile(path.join(
  staleTruncatedLockTask.source_bundle_path,
  "manifest.json",
));

const activeEmptyLockTask = taskAt("active-empty-lock");
const activeEmptyLockPath =
  `${activeEmptyLockTask.source_bundle_path}.publish.lock`;
await mkdir(path.dirname(activeEmptyLockTask.source_bundle_path), {
  recursive: true,
});
await mkdir(activeEmptyLockPath);
const activeEmptyLockResult =
  await extension.autoDispatchPiSourceScopeLocator({
    ...deps,
    states: new Map(),
    controllers: new Map(),
    call: async () => {
      throw new Error("young empty lock must block canonical mutation");
    },
  }, "coc_invoke", envelope(activeEmptyLockTask));
assert.equal(
  activeEmptyLockResult.failure_class,
  "source_scope_bundle_publication_failed",
);
await assert.rejects(readFile(activeEmptyLockTask.source_bundle_path));

const concurrentLockTask = taskAt("concurrent-stale-lock");
const concurrentLockPath =
  `${concurrentLockTask.source_bundle_path}.publish.lock`;
await mkdir(path.dirname(concurrentLockTask.source_bundle_path), {
  recursive: true,
});
await mkdir(concurrentLockPath);
await writeFile(
  path.join(concurrentLockPath, "owner.json"),
  JSON.stringify({
    schema_version: 1,
    contract_id: "coc.pi-source-scope-publish-lock.v1",
    pid: 2147483647,
    owner_nonce: "00000000-0000-4000-8000-000000000003",
    created_at_ms: Date.now() - 60_000,
    task_digest: "f".repeat(64),
  }),
);
const concurrentCalls = [];
const concurrentRuns = await Promise.all([
  extension.autoDispatchPiSourceScopeLocator({
    ...deps,
    states: new Map(),
    controllers: new Map(),
    call: async (...args) => {
      concurrentCalls.push(args);
      return {
        ok: true,
        data: {
          replacement_job_id: "job-concurrent",
          lifecycle: {},
        },
      };
    },
    onResolved: async () => {},
  }, "coc_invoke", envelope(concurrentLockTask)),
  extension.autoDispatchPiSourceScopeLocator({
    ...deps,
    states: new Map(),
    controllers: new Map(),
    call: async (...args) => {
      concurrentCalls.push(args);
      return {
        ok: true,
        data: {
          replacement_job_id: "job-concurrent",
          lifecycle: {},
        },
      };
    },
    onResolved: async () => {},
  }, "coc_invoke", envelope(concurrentLockTask)),
]);
assert.equal(
  concurrentRuns.filter((result) => result.status === "scope_registered").length,
  1,
);
assert.equal(
  concurrentRuns.filter(
    (result) =>
      result.failure_class === "source_scope_bundle_publication_failed",
  ).length,
  1,
);
assert.equal(concurrentCalls.length, 1);
await readFile(path.join(concurrentLockTask.source_bundle_path, "manifest.json"));
await assert.rejects(lstat(
  `${concurrentLockPath}.recovery.guard`,
));

const unavailableCalls = [];
const unavailable = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  command: () => undefined,
  states: new Map(),
  controllers: new Map(),
  call: async (...args) => { unavailableCalls.push(args); return {}; },
}, "coc_invoke", envelope(taskAt("unavailable")));
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
  controllers: new Map(),
  command: () => badHandshake,
  call: async (...args) => { badHandshakeCalls.push(args); return {}; },
}, "coc_invoke", envelope(taskAt("bad-handshake")));
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
  controllers: new Map(),
  command: () => badReceipt,
  call: async (...args) => { badReceiptCalls.push(args); return {}; },
}, "coc_invoke", envelope(taskAt("bad-receipt")));
assert.equal(badReceiptCalls.length, 0);

// Deepen playtest schema-drift regression: the locator task is a closed
// machine contract with a 6-key resolve_operation. An 8-key card carrying
// wire decoration (contract_ref/discovery_required) must be rejected as
// source_scope_locator_task_invalid, never silently dispatched.
const decoratedTask = {
  ...task(),
  resolve_operation: {
    ...task().resolve_operation,
    contract_ref: "progressive.resolve_source_scope@abc123",
    discovery_required: false,
  },
};
const driftCalls = [];
const driftResult = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: new Map(),
  call: async (...args) => { driftCalls.push(args); return {}; },
}, "coc_invoke", envelope(decoratedTask));
assert.equal(
  driftResult.failure_class,
  "source_scope_locator_task_invalid",
  JSON.stringify(driftResult),
);
assert.equal(driftCalls.length, 0);

// Page-caliber regression: the module cache uses 1-based printed page
// numbers; a locator receipt containing pdf_index 0 is out-of-caliber and
// must be rejected before resolve. (An off-by-one window such as [4,5,6]
// vs cached [5,6,7] remains fail-closed at resolve via content drift.)
const zeroBasedProducer = await producer("zero-based.mjs", `
if (process.argv[2] === "--capabilities") process.stdout.write(${JSON.stringify(handshake)});
else process.stdout.write(JSON.stringify({
  schema_version: 1,
  contract_id: "coc.pi-source-scope-locator-producer-result.v1",
  job_id: "job-locator",
  status: "located",
  kind: "location",
  target_id: "archive",
  pdf_indices: [0, 1, 2],
  source_bundle_path: ${JSON.stringify(task().source_bundle_path)},
  failure_class: null,
}));
`);
await assert.rejects(
  extension.runPiSourceScopeProducer(task(), {
    command: zeroBasedProducer,
  }),
  /pdf_indices are invalid/,
);
const zeroBasedCalls = [];
await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: new Map(),
  command: () => zeroBasedProducer,
  call: async (...args) => { zeroBasedCalls.push(args); return {}; },
}, "coc_invoke", envelope(taskAt("zero-based")));
assert.equal(zeroBasedCalls.length, 0);

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
  controllers: new Map(),
  command: () => slow,
  call: async (...args) => { timeoutCalls.push(args); return {}; },
}, "coc_invoke", envelope(taskAt("timeout")), { timeoutMs: 25 });
assert.equal(timeoutCalls.length, 0);

const symlinkOutside = path.join(temp, "symlink-outside");
await mkdir(symlinkOutside);
const symlinkProducer = await producer("symlink.mjs", `
import fs from "node:fs";
if (process.argv[2] === "--capabilities") process.stdout.write(${JSON.stringify(handshake)});
else {
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  const task = JSON.parse(input);
  fs.symlinkSync(${JSON.stringify(symlinkOutside)}, task.source_bundle_path);
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    contract_id: "coc.pi-source-scope-locator-producer-result.v1",
    job_id: task.job_id,
    status: "located",
    kind: task.kind,
    target_id: task.target_id,
    pdf_indices: [2],
    source_bundle_path: task.source_bundle_path,
    failure_class: null,
  }));
}`);
const symlinkTask = taskAt("symlink");
const symlinkCalls = [];
const symlinkResult = await extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: new Map(),
  command: () => symlinkProducer,
  call: async (...args) => { symlinkCalls.push(args); return {}; },
}, "coc_invoke", envelope(symlinkTask));
assert.equal(
  symlinkResult.failure_class,
  "source_scope_bundle_publication_failed",
);
assert.equal(symlinkCalls.length, 0);
await assert.rejects(readFile(symlinkTask.source_bundle_path));

const abortStarted = path.join(temp, "abort-started");
const descendantMarker = path.join(temp, "descendant-survived");
const abortProducer = await producer("abort-tree.mjs", `
import fs from "node:fs";
import { spawn } from "node:child_process";
if (process.argv[2] === "--capabilities") process.stdout.write(${JSON.stringify(handshake)});
else {
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  JSON.parse(input);
  fs.writeFileSync(${JSON.stringify(abortStarted)}, "started");
  spawn(process.execPath, ["-e", ${JSON.stringify(
    `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(descendantMarker)}, "survived"), 700)`,
  )}]);
  setTimeout(() => {}, 5000);
}`);
const abortTask = taskAt("abort");
const abortControllers = new Map();
const abortCalls = [];
const abortRun = extension.autoDispatchPiSourceScopeLocator({
  ...deps,
  states: new Map(),
  controllers: abortControllers,
  command: () => abortProducer,
  call: async (...args) => { abortCalls.push(args); return {}; },
}, "coc_invoke", envelope(abortTask));
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    await readFile(abortStarted);
    break;
  } catch {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
await readFile(abortStarted);
for (const controller of abortControllers.values()) {
  controller.abort("session_shutdown");
}
const aborted = await abortRun;
assert.equal(aborted.failure_class, "source_scope_locator_aborted");
assert.equal(abortControllers.size, 0);
assert.equal(abortCalls.length, 0);
await new Promise((resolveWait) => setTimeout(resolveWait, 900));
await assert.rejects(readFile(descendantMarker));
await assert.rejects(readFile(abortTask.source_bundle_path));

process.stdout.write(JSON.stringify({
  ok: true,
  checks: {
    strict_preflight_and_receipt: true,
    source_title_contract_enforced: true,
    locate_resolve_replacement_chain: true,
    duplicate_suppressed: true,
    stable_bundle_not_overwritten: true,
    published_unregistered_recovered: true,
    stale_publish_lock_recovered: true,
    active_publish_lock_preserved: true,
    crashed_publish_lock_recovered: true,
    concurrent_publish_recovery_serialized: true,
    active_empty_publish_lock_preserved: true,
    symlink_staging_rejected: true,
    session_abort_kills_descendants: true,
    missing_command_no_mutation: true,
    invalid_handshake_no_mutation: true,
    invalid_receipt_no_mutation: true,
    timeout_no_mutation: true,
    decorated_resolve_operation_rejected: true,
    zero_based_caliber_rejected: true,
  },
}) + "\n");
