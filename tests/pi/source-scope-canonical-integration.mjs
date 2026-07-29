#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const run = promisify(execFile);
const root = path.resolve(process.argv[2]);
const fixture = JSON.parse(await readFile(process.argv[3], "utf8"));
const extension = await import(pathToFileURL(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
)).href);
let resolved = null;
let canonicalCalls = 0;
let canonicalError = "";
const canonicalCall = async (name, args) => {
    assert.equal(name, "coc_invoke");
    canonicalCalls += 1;
    let stdout;
    try {
      ({ stdout } = await run(fixture.uv, [
        "run", "--frozen", "python", fixture.toolbox,
        args.operation,
        "--root", args.root,
        "--campaign", args.campaign,
        "--json", JSON.stringify(args.arguments),
      ], {
        cwd: root,
        env: {
          ...process.env,
          COC_HOST: "codex",
          COC_DISABLE_QUEUE_WORKER: "1",
        },
        maxBuffer: 1024 * 1024,
      }));
    } catch (error) {
      canonicalError = `canonical call failed: ${
        error.stdout || ""
      } ${error.stderr || ""}`;
      throw new Error(canonicalError);
    }
    return JSON.parse(stdout);
};
let currentChecks = 0;
const interrupted = await extension.autoDispatchPiSourceScopeLocator({
  isCurrent: () => {
    currentChecks += 1;
    return currentChecks < 3;
  },
  command: () => fixture.producer,
  states: new Map(),
  controllers: new Map(),
  audit: () => {},
  call: async () => {
    throw new Error("first session must close before canonical resolution");
  },
  onResolved: async () => {},
}, "coc_invoke", fixture.envelope);
assert.equal(
  interrupted.failure_class,
  "session_closed_before_scope_registration",
);
assert.equal(canonicalCalls, 0);
const producerRunsBeforeRecovery = (
  await readFile(fixture.producer_marker, "utf8")
).split("\n").filter(Boolean).length;

const lifecycle = await extension.autoDispatchPiSourceScopeLocator({
  isCurrent: () => true,
  command: () => fixture.producer,
  states: new Map(),
  controllers: new Map(),
  audit: () => {},
  call: canonicalCall,
  onResolved: async (value) => { resolved = value; },
}, "coc_invoke", fixture.envelope);

assert.equal(
  lifecycle.status,
  "scope_registered",
  JSON.stringify(lifecycle),
);
assert.equal(canonicalCalls, 1);
assert.equal(resolved.ok, true);
assert.equal(
  resolved.data.resolved_job_id,
  fixture.expected_job_id,
);
assert.notEqual(
  resolved.data.replacement_job_id,
  fixture.expected_job_id,
);
assert.equal(resolved.data.lifecycle.awaiting_scope_count, 0);
assert.equal(resolved.data.lifecycle.runnable_count, 1);
assert.equal(
  (await readFile(fixture.producer_marker, "utf8"))
    .split("\n").filter(Boolean).length,
  producerRunsBeforeRecovery,
);

let terminal = null;
const repeated = await extension.autoDispatchPiSourceScopeLocator({
  isCurrent: () => true,
  command: () => fixture.producer,
  states: new Map(),
  controllers: new Map(),
  audit: () => {},
  call: canonicalCall,
  onResolved: async (value) => { terminal = value; },
}, "coc_invoke", fixture.envelope);
assert.equal(
  repeated.status,
  "scope_registered",
  `${JSON.stringify(repeated)} ${canonicalError}`,
);
assert.equal(canonicalCalls, 2);
assert.equal(terminal.ok, true);
assert.equal(terminal.data.idempotent_terminal, true);
assert.equal(
  terminal.data.replacement_job_id,
  resolved.data.replacement_job_id,
);
assert.equal(
  (await readFile(fixture.producer_marker, "utf8"))
    .split("\n").filter(Boolean).length,
  producerRunsBeforeRecovery,
);
process.stdout.write(JSON.stringify({
  ok: true,
  lifecycle,
  idempotent_terminal: terminal.data.idempotent_terminal,
  resolved_job_id: resolved.data.resolved_job_id,
  replacement_job_id: resolved.data.replacement_job_id,
}) + "\n");
