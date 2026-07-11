#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, "run_narration.mjs");

// Importing the bridge must not require provider credentials or start a session.
await import("./run_narration.mjs");

// A malformed server envelope must still produce one bounded JSONL error frame,
// without reaching model/provider initialization.
const child = spawn(process.execPath, [runner, "--server"], {
  cwd: here,
  env: {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
child.stdin.end('{"request_id":7}\n');
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
assert.equal(exitCode, 0, stderr);
const lines = stdout.trim().split("\n");
assert.equal(lines.length, 1, stdout);
const frame = JSON.parse(lines[0]);
assert.equal(frame.request_id, 7);
assert.equal(frame.ok, false);
assert.match(frame.error, /request_id/);
