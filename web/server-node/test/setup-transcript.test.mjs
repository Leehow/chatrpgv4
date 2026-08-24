import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
const SERVER_SOURCE = fs.readFileSync(SERVER, "utf8");

let running = null;

async function getServer() {
  if (running) return running;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-setup-transcript-http-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(
    process.execPath,
    [SERVER, "--workspace", workspace, "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) break;
    } catch {
      /* not ready */
    }
    if (Date.now() > deadline || child.exitCode != null) {
      child.kill("SIGTERM");
      throw new Error("server.mjs did not become healthy for setup-transcript HTTP test");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  running = { base, child, workspace };
  return running;
}

after(() => {
  running?.child.kill("SIGTERM");
  if (running?.workspace) fs.rmSync(running.workspace, { recursive: true, force: true });
});

test("setup-transcript route is a separate host-session projection", () => {
  assert.match(SERVER_SOURCE, /parts\[3\] === "setup-transcript"/);
  assert.match(SERVER_SOURCE, /handleSetupTranscript/);
  assert.match(SERVER_SOURCE, /hostedSetupHistory/);
  const setupHandler = SERVER_SOURCE.slice(
    SERVER_SOURCE.indexOf("function setupTranscriptPayload"),
    SERVER_SOURCE.indexOf("async function handleSetupTranscript"),
  );
  assert.match(setupHandler, /hostedSetupHistory/);
  assert.doesNotMatch(setupHandler, /tableTranscriptMessages/);
  assert.doesNotMatch(setupHandler, /transcriptPayload/);
});

test("/transcript still prefers campaign table-transcript", () => {
  const fn = SERVER_SOURCE.slice(
    SERVER_SOURCE.indexOf("async function transcriptPayload"),
    SERVER_SOURCE.indexOf("function playerVisibleTurnError"),
  );
  assert.match(fn, /tableTranscriptMessages/);
  assert.match(fn, /hostedSessionMessages/);
  assert.doesNotMatch(fn, /hostedSetupHistory/);
  assert.doesNotMatch(fn, /setup-transcript/);
});

test("unknown session setup-transcript is 404 and does not write workspace", async () => {
  const { base, workspace } = await getServer();
  const before = fs.readdirSync(workspace);
  const response = await fetch(`${base}/api/sessions/missing-session/setup-transcript`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "unknown session" });
  assert.deepEqual(fs.readdirSync(workspace), before);
});

test("unknown session /transcript stays 404 with the same contract", async () => {
  const { base } = await getServer();
  const response = await fetch(`${base}/api/sessions/missing-session/transcript`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "unknown session" });
});
