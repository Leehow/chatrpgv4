#!/usr/bin/env node
// Focused seam test for the steward subagent tool-binding fix (round-5
// acceptance BLOCKED_NO_FS). Root cause: the coc-keeper package extension's
// session_start unconditionally ran pi.setActiveTools(kpActiveTools), which in
// a pi-subagents child process wiped the agent's own --tools allowlist
// (bash/read/grep/find) and left the steward without host FS tools.
//
// The fix keeps the call for the KP root session (no PI_SUBAGENT_CHILD) and
// skips it inside a pi-subagents child (PI_SUBAGENT_CHILD=1), so the child
// keeps its own allowlist. This test asserts both halves of that seam with a
// fake pi host and no model calls.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const extension = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));

const expectedKpActiveTools = [
  "read", "coc_capabilities", "coc_discover", "coc_invoke", "coc_progressive_ocr",
  "coc_map_supply", "subagent", "subagent_wait",
];
const handlers = new Map();
const activeTools = [];
const tools = new Map();
const fakePi = {
  registerTool: (tool) => tools.set(tool.name, tool),
  registerCommand() {},
  registerShortcut() {},
  on: (name, handler) => handlers.set(name, [...(handlers.get(name) || []), handler]),
  appendEntry() {},
  sendMessage() {},
  setActiveTools: (names) => activeTools.push(names),
  getThinkingLevel: () => "off",
};
extension.default(fakePi, {
  coordinatorEnabled: () => false,
  welcomeAgentDir: path.join(root, ".pi", "steward-tools-bind-probe"),
  createClient: () => ({
    async callTool() { return { ok: true, host: "pi" }; },
    async close() {},
  }),
});

const ctx = {
  cwd: root,
  mode: "rpc",
  model: { provider: "probe", id: "probe" },
  sessionManager: { getSessionId: () => "steward-tools-bind-probe", getEntries: () => [] },
  hasUI: false,
};
const sessionStartHandlers = handlers.get("session_start") || [];
const fire = async () => {
  for (const handler of sessionStartHandlers) {
    await handler({ reason: "probe" }, ctx);
  }
};

// 1) KP root session: no PI_SUBAGENT_CHILD env → setActiveTools still applies
// the KP set (KP tool surface unchanged by this fix).
const priorChildEnv = process.env.PI_SUBAGENT_CHILD;
delete process.env.PI_SUBAGENT_CHILD;
await fire();
assert.equal(activeTools.length, 1, "KP session must call setActiveTools exactly once");
assert.deepEqual(activeTools[0], expectedKpActiveTools, "KP active tools must stay the canonical KP set");

// 2) pi-subagents child session: PI_SUBAGENT_CHILD=1 → the coc extension must
// NOT call setActiveTools, so the child keeps the agent's own --tools allowlist
// (bash/read/grep/find injected by pi-subagents per agent config).
process.env.PI_SUBAGENT_CHILD = "1";
await fire();
assert.equal(
  activeTools.length, 1,
  "subagent child must not trigger setActiveTools (would wipe its allowlist)",
);
if (priorChildEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
else process.env.PI_SUBAGENT_CHILD = priorChildEnv;

// The coc_* tools remain registered either way (registration is not affected);
// only the active-tool override must be skipped in a child.
for (const name of ["coc_capabilities", "coc_discover", "coc_invoke"]) {
  assert.ok(tools.has(name), `coc extension must still register ${name}`);
}

process.stdout.write(JSON.stringify({
  ok: true,
  kpActiveTools: activeTools[0],
  childSessionSetActiveToolsCalls: activeTools.length - 1,
}));
