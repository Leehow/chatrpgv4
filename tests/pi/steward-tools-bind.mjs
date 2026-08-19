#!/usr/bin/env node
// Focused seam test for the steward subagent tool-binding fix (round-5
// acceptance BLOCKED_NO_FS). Root cause: the coc-keeper package extension's
// session_start unconditionally ran pi.setActiveTools(kpActiveTools), which in
// a pi-subagents child process wiped the agent's own --tools allowlist
// (bash/read/grep/find) and left the steward without host FS tools.
//
// After typed operation tools: setup/play hide generic wrappers and expose
// operation-specific names; unset role stays on the legacy generic surface.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const extension = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const domain = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts")).href
);

const ROLE_ENV = "COC_PI_SESSION_ROLE";
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

const priorChildEnv = process.env.PI_SUBAGENT_CHILD;
const priorRole = process.env[ROLE_ENV];
delete process.env.PI_SUBAGENT_CHILD;

const assertNoGenericWrappers = (names, label) => {
  for (const wrapper of domain.DOMAIN_TOOL_NAMES) {
    assert.ok(!names.includes(wrapper), `${label} must hide generic ${wrapper}`);
  }
};

try {
  delete process.env[ROLE_ENV];
  await fire();
  assert.equal(activeTools.length, 1, "unset KP session must call setActiveTools exactly once");
  const unsetActive = activeTools[0];
  assert.deepEqual(unsetActive, [
    "read", "subagent", "subagent_wait",
    "coc_setup", "coc_context", "coc_turn", "coc_rules", "coc_state",
    "coc_chargen_delegate",
  ]);
  assert.ok(!unsetActive.includes("coc_rules_roll"), "unset legacy must not activate typed names");
  assert.ok(!unsetActive.includes("coc_discover"));
  assert.ok(!unsetActive.includes("coc_invoke"));

  process.env[ROLE_ENV] = "setup";
  await fire();
  const setupActive = activeTools.at(-1);
  assertNoGenericWrappers(setupActive, "setup");
  assert.ok(setupActive.includes("coc_setup_inspect"));
  assert.ok(setupActive.includes("coc_session_resume"));
  assert.ok(setupActive.includes("coc_rules_roll_dice"));
  assert.ok(setupActive.includes("coc_chargen_delegate"));
  assert.ok(!setupActive.includes("coc_rules_roll"));
  assert.ok(!setupActive.includes("coc_npc_reaction"));
  assert.ok(!setupActive.includes("coc_turn_finalize"));

  process.env[ROLE_ENV] = "play";
  await fire();
  const playActive = activeTools.at(-1);
  assertNoGenericWrappers(playActive, "play");
  assert.ok(playActive.includes("coc_session_resume"));
  assert.ok(playActive.includes("coc_setup_inspect"));
  assert.ok(playActive.includes("coc_rules_roll_dice"));
  assert.ok(!playActive.includes("coc_setup_complete"));
  assert.ok(!playActive.includes("coc_chargen_delegate"));
  assert.ok(!playActive.includes("coc_npc_reaction"));

  process.env.PI_SUBAGENT_CHILD = "1";
  const beforeChild = activeTools.length;
  await fire();
  assert.equal(
    activeTools.length,
    beforeChild,
    "subagent child must not trigger setActiveTools (would wipe its allowlist)",
  );
} finally {
  if (priorChildEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
  else process.env.PI_SUBAGENT_CHILD = priorChildEnv;
  if (priorRole === undefined) delete process.env[ROLE_ENV];
  else process.env[ROLE_ENV] = priorRole;
}

for (const name of ["coc_capabilities", "coc_discover", "coc_invoke", "coc_rules", "coc_rules_roll"]) {
  assert.ok(tools.has(name), `coc extension must still register ${name}`);
}

process.stdout.write(JSON.stringify({
  ok: true,
  kpActiveTools: activeTools[0],
  setupActiveTools: activeTools[1],
  playActiveTools: activeTools[2],
  childSessionSetActiveToolsCalls: 0,
}));
