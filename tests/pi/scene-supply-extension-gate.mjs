#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
process.env.COC_PI_SCENE_SUPPLY = "1";
const extension = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const handlers = new Map();
const tools = new Map();
const hidden = [];
const calls = [];
let supply = {
  schema_version: 1,
  scene_id: "tower",
  enforced: true,
  status: "pending",
  ready: false,
  fallback_available: true,
  source_cache_path: "pages",
};
const fakePi = {
  registerTool: (tool) => tools.set(tool.name, tool),
  registerCommand() {},
  registerShortcut() {},
  on: (name, handler) => handlers.set(name, [...(handlers.get(name) || []), handler]),
  appendEntry() {},
  sendMessage: (message) => hidden.push(message),
  setActiveTools() {},
  getThinkingLevel: () => "off",
};
extension.default(fakePi, {
  coordinatorEnabled: () => false,
  welcomeAgentDir: path.join(root, ".pi", "scene-supply-probe"),
  createClient: () => ({
    async callTool(name, params) {
      calls.push({ name, params });
      if (params.operation === "steward.scene_supply") {
        if (params.arguments?.allow_minimal_fallback === true) {
          return {
            ok: true,
            tool: "steward.scene_supply",
            data: {
              ...supply,
              status: "minimal_ready",
              ready: true,
              degraded: true,
              minimal_scene: { id: "tower", name: "钟楼", source_refs: ["pages/2.md"] },
            },
          };
        }
        return { ok: true, tool: "steward.scene_supply", data: supply };
      }
      if (params.operation === "state.move_scene") {
        return {
          ok: true,
          tool: "state.move_scene",
          data: { to_scene_id: "tower", scene: {}, next_operation: {} },
        };
      }
      return { ok: true, tool: String(params.operation || name), data: {} };
    },
    async close() {},
  }),
});
const ctx = {
  cwd: root,
  mode: "rpc",
  model: { provider: "probe", id: "probe" },
  sessionManager: { getSessionId: () => "scene-supply-probe", getEntries: () => [] },
  hasUI: false,
};
for (const handler of handlers.get("session_start") || []) {
  await handler({ reason: "probe" }, ctx);
}
const invoke = tools.get("coc_invoke");
const params = {
  operation: "state.move_scene", root, campaign: "supply-camp",
  arguments: { scene_id: "tower", decision_id: "move-tower" },
};
const blocked = await invoke.execute("move-1", params, undefined, undefined, ctx);
assert.equal(blocked.details.ok, false);
assert.equal(blocked.details.error.code, "scene_supply_pending");
assert.equal(calls.filter((call) => call.params.operation === "state.move_scene").length, 0);
assert.ok(hidden.some((message) => message.customType === "coc-scene-supply-wait"));

const degraded = await invoke.execute("move-2", params, undefined, undefined, ctx);
assert.equal(degraded.details.ok, true);
assert.equal(degraded.details.data.scene_supply.degraded, true);
assert.equal(calls.filter((call) => call.params.operation === "state.move_scene").length, 1);

supply = {
  schema_version: 1,
  scene_id: "tower",
  enforced: true,
  status: "ready",
  ready: true,
  cache_hit: true,
  bundle: { current: { id: "tower", name: "钟楼", source_refs: ["pages/2.md"] }, neighbors: [] },
};
const moved = await invoke.execute("move-3", params, undefined, undefined, ctx);
assert.equal(moved.details.ok, true);
assert.equal(moved.details.data.scene_supply.cache_hit, true);
assert.equal(calls.filter((call) => call.params.operation === "state.move_scene").length, 2);
assert.ok(hidden.some((message) => message.customType === "coc-scene-supply-prefetch"));
process.stdout.write(JSON.stringify({ ok: true }));
