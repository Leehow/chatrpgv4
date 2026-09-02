#!/usr/bin/env node
// A DebugExperiment lane owns its resume prompt: the host must not also send
// the startup instruction, or the two compete and the Keeper spends the lane
// budget on the host's chain before the probe can seed anything.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const welcome = await import(pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/welcome.ts"),
).href);

assert.equal(welcome.debugLaneEnabled({}), false);
assert.equal(welcome.debugLaneEnabled({ PI_COC_DEBUG_LANE: "0" }), false);
assert.equal(welcome.debugLaneEnabled({ PI_COC_DEBUG_LANE: "1" }), true);

const sent = [];
const pi = {
  registerCommand: () => {},
  registerShortcut: () => {},
  on: () => {},
  sendMessage: (message, options) => { sent.push({ message, options }); },
};
const ctx = {
  cwd: root,
  mode: "rpc",
  hasUI: false,
  sessionManager: { getEntries: () => [], getSessionId: () => "debug-lane-probe" },
};
const client = { callTool: async () => ({ ok: true, host: "pi" }) };

const startups = () => sent.filter((entry) => (
  entry.message?.customType === welcome.STARTUP_RESUME_CUSTOM_TYPE
  || entry.message?.customType === welcome.TABLE_OPEN_CUSTOM_TYPE
));

const previous = process.env.PI_COC_DEBUG_LANE;
try {
  process.env.PI_COC_DEBUG_LANE = "1";
  const register = welcome.registerCocWelcome(pi, () => client);
  if (typeof register === "function") await register({ reason: "resume" }, ctx);
  assert.deepEqual(
    startups().map((entry) => entry.message.customType),
    [],
    "a debug lane must receive no startup instruction from the host",
  );
} finally {
  if (previous === undefined) delete process.env.PI_COC_DEBUG_LANE;
  else process.env.PI_COC_DEBUG_LANE = previous;
}

process.stdout.write(JSON.stringify({ ok: true, startupMessages: startups().length }));
