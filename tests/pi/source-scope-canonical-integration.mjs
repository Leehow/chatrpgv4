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
const lifecycle = await extension.autoDispatchPiSourceScopeLocator({
  isCurrent: () => true,
  command: () => fixture.producer,
  states: new Map(),
  controllers: new Map(),
  audit: () => {},
  call: async (name, args) => {
    assert.equal(name, "coc_invoke");
    canonicalCalls += 1;
    const { stdout } = await run(fixture.uv, [
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
    });
    return JSON.parse(stdout);
  },
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
process.stdout.write(JSON.stringify({
  ok: true,
  lifecycle,
  resolved_job_id: resolved.data.resolved_job_id,
  replacement_job_id: resolved.data.replacement_job_id,
}) + "\n");
