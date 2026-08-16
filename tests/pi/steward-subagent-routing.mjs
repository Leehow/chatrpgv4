#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const extension = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
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
assert.deepEqual(activeTools.at(-1), [
  "read", "coc_capabilities", "coc_discover", "coc_invoke", "coc_progressive_ocr",
  "coc_map_supply", "subagent", "subagent_wait",
]);
assert.match(
  await (await import("node:fs/promises")).readFile(
    path.join(root, "plugins/coc-keeper/pi/prompts/host-system.md"), "utf8",
  ),
  /hidden\s+`subagent-notify` follow-up/,
);
process.stdout.write(JSON.stringify({ ok: true, activeTools: activeTools.at(-1) }));
