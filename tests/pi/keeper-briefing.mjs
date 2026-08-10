#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const { buildKeeperBriefing, KEEPER_BRIEFING_CUSTOM_TYPE } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/keeper-briefing.ts")
);

const document = {
  schema_version: 2,
  campaign_id: "brief-camp",
  domains: {
    init: { status: "ready", l0: { module_meta: {
      title_zh: "雾港来信", era: "1920年代", locale: "上海",
      tone_tags: ["都市恐怖", "调查"], warnings: ["自伤描写"],
      safety_notes: "涉及儿童失踪。",
    } } },
    npc: { status: "partial", index: [{
      id: "npc-lin", name: "林医生", summary: "谨慎的法医证人。",
      source_refs: ["pages/007.md#npc", "pages/008.md#npc"],
      stats: { HP: 99 }, secrets: "绝不可泄露的长秘密",
    }] },
    scene: { status: "ready", index: [{
      id: "scene-dock", name: "雾港码头", summary: "首个可调查地点。",
      source_refs: ["pages/003.md#scene"], keeper_notes: "正文不能进入常驻卡",
    }] },
    clue: { status: "pending" },
    rule: { status: "partial", warnings: ["自伤描写"] },
  },
};
const briefing = buildKeeperBriefing(document, "brief-camp", "session_start");
assert.ok(briefing);
assert.deepEqual(briefing.module.warnings, ["自伤描写", "涉及儿童失踪。"]);
assert.equal(briefing.readiness.npc, "partial");
assert.equal(briefing.readiness.clue, "pending");
assert.deepEqual(briefing.scene_index, [{
  id: "scene-dock", summary: "雾港码头：首个可调查地点。", source_refs: ["pages/003.md#scene"],
}]);
assert.deepEqual(briefing.npc_index, [{
  id: "npc-lin", summary: "林医生：谨慎的法医证人。", source_refs: ["pages/007.md#npc", "pages/008.md#npc"],
}]);
const encoded = JSON.stringify(briefing);
assert.equal(encoded.includes("绝不可泄露的长秘密"), false);
assert.equal(encoded.includes("正文不能进入常驻卡"), false);
assert.equal(encoded.includes('"HP"'), false);

const workspace = await mkdtemp(path.join(os.tmpdir(), "coc-briefing-"));
const save = path.join(workspace, ".coc", "campaigns", "brief-camp", "save");
await mkdir(save, { recursive: true });
await writeFile(path.join(save, "steward-state.json"), JSON.stringify({
  ...document,
  updated_at: "2026-08-10T00:00:00+00:00",
  deliveries: {}, notebook: {}, failed_chunks: [],
}), "utf8");

const extension = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const handlers = new Map();
const tools = new Map();
const hidden = [];
const fakePi = {
  registerTool: (tool) => tools.set(tool.name, tool),
  registerCommand() {}, registerShortcut() {},
  on: (name, handler) => handlers.set(name, [...(handlers.get(name) || []), handler]),
  appendEntry() {},
  sendMessage: (message, options) => hidden.push({ message, options }),
  setActiveTools() {}, getThinkingLevel: () => "off",
};
extension.default(fakePi, {
  startupCampaignId: () => "brief-camp",
  welcomeAgentDir: path.join(workspace, ".pi-agent"),
  coordinatorEnabled: () => false,
  createClient: () => ({
    async callTool(_name, params) {
      if (params.operation === "session.resume") {
        return {
          ok: true, tool: "session.resume",
          data: { schema_version: 1, campaign_id: "brief-camp", mode: "awaiting_player" },
        };
      }
      return { ok: true, tool: String(params.operation || "coc_invoke"), data: {} };
    },
    async close() {},
  }),
});
const ctx = {
  cwd: workspace, mode: "rpc", model: { provider: "probe", id: "probe" }, hasUI: false,
  sessionManager: { getSessionId: () => "briefing-probe", getEntries: () => [] },
};
for (const handler of handlers.get("session_start") || []) await handler({ reason: "probe" }, ctx);
const cards = () => hidden.filter(({ message }) => message.customType === KEEPER_BRIEFING_CUSTOM_TYPE);
assert.equal(cards().length, 1);
assert.equal(cards()[0].message.display, false);
assert.equal(cards()[0].options.triggerTurn, false);
assert.equal(cards()[0].message.details.reason, "session_start");

const invoke = tools.get("coc_invoke");
await invoke.execute("resume", {
  operation: "session.resume", root: workspace, campaign: "brief-camp", arguments: {},
}, undefined, undefined, ctx);
assert.equal(cards().at(-1).message.details.reason, "session_resume");

document.domains.npc.status = "ready";
await writeFile(path.join(save, "steward-state.json"), JSON.stringify({
  ...document,
  updated_at: "2026-08-10T00:01:00+00:00",
  deliveries: {}, notebook: {}, failed_chunks: [],
}), "utf8");
await invoke.execute("domain", {
  operation: "steward.domain_put", root: workspace, campaign: "brief-camp",
  arguments: { domain: "npc" },
}, undefined, undefined, ctx);
assert.equal(cards().at(-1).message.details.reason, "steward_refresh");
assert.equal(cards().at(-1).message.details.readiness.npc, "ready");
process.stdout.write(JSON.stringify({ ok: true, cards: cards().length }));
