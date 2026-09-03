#!/usr/bin/env node
// The subagent tools belong to the live KP surface only: they are bound with
// the Keeper's acting working set once a real player message opens the turn,
// never at session_start (the awaiting_player stage is closed) and never as
// part of a generic-wrapper surface.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
delete process.env.PI_SUBAGENT_CHILD;
delete process.env.COC_PI_SESSION_ROLE;
const extension = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const domain = await import(path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts"));
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
  setActiveTools: (names) => activeTools.push([...names]),
  getThinkingLevel: () => "off",
};
extension.default(fakePi, {
  coordinatorEnabled: () => false,
  welcomeAgentDir: path.join(root, ".pi", "steward-routing-probe"),
  createClient: () => ({
    async callTool() { return { ok: true, host: "pi" }; },
    async close() {},
  }),
});

const ctx = {
  cwd: root,
  mode: "rpc",
  model: { provider: "probe", id: "probe" },
  sessionManager: { getSessionId: () => "steward-routing-probe", getEntries: () => [] },
  hasUI: false,
};
for (const handler of handlers.get("session_start") || []) {
  await handler({ reason: "probe" }, ctx);
}
const startupActiveTools = activeTools.at(-1);
assert.deepEqual(
  startupActiveTools,
  [],
  "awaiting_player is a closed stage: no tools bind before the first player message",
);
for (const handler of handlers.get("message_start") || []) {
  await handler({
    type: "message_start",
    message: {
      role: "user",
      content: [{ type: "text", text: "我推开门走进去。" }],
      timestamp: Date.now(),
    },
  }, ctx);
}
const liveActiveTools = activeTools.at(-1);
assert.ok(liveActiveTools.length > 0, "the first player message binds the live KP surface");
for (const name of ["subagent", "await_subagent", "read", "coc_source_assets"]) {
  assert.ok(liveActiveTools.includes(name), `live KP surface keeps ${name} active`);
}
for (const wrapper of domain.DOMAIN_TOOL_NAMES) {
  assert.ok(!liveActiveTools.includes(wrapper), `live KP surface hides generic ${wrapper}`);
}
assert.ok(!liveActiveTools.includes("coc_invoke"), "coc_invoke is the host boundary, never a model tool");
assert.match(
  await (await import("node:fs/promises")).readFile(
    path.join(root, "plugins/coc-keeper/pi/prompts/host-system.md"), "utf8",
  ),
  /hidden\s+`subagent-notify` follow-up/,
);
process.stdout.write(JSON.stringify({
  ok: true,
  startupActiveTools,
  activeTools: liveActiveTools,
}));
