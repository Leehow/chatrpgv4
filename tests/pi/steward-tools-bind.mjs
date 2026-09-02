#!/usr/bin/env node
// Focused seam test for the steward subagent tool-binding fix (round-5
// acceptance BLOCKED_NO_FS). Root cause: the coc-keeper package extension's
// session_start unconditionally ran pi.setActiveTools(kpActiveTools), which in
// a pi-subagents child process wiped the agent's own --tools allowlist
// (bash/read/grep/find) and left the steward without host FS tools.
//
// Post-cutover surface: the working set is stage-gated, not role-static.
// session_start binds the closed awaiting_player set (no tools: the Keeper
// has no turn to act on yet, and the generic wrappers / coc_invoke never
// reach the model). The first real player message opens the acting stage
// and binds the launcher role's typed surface; an unset role is the setup
// default. A pi-subagents child never has its allowlist touched.
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
const priorChildEnv = process.env.PI_SUBAGENT_CHILD;
const priorRole = process.env[ROLE_ENV];

// The launcher role is read once when the extension instance is created, so
// every role probe boots its own instance against its own fake host.
function bootInstance(role) {
  if (role === undefined) delete process.env[ROLE_ENV];
  else process.env[ROLE_ENV] = role;
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
  const emit = async (name, event) => {
    for (const handler of handlers.get(name) || []) {
      await handler(event, ctx);
    }
  };
  return { activeTools, tools, emit };
}

const playerMessage = () => ({
  type: "message_start",
  message: {
    role: "user",
    content: [{ type: "text", text: "我推开门走进去。" }],
    timestamp: Date.now(),
  },
});

const assertNeverOnModelSurface = (names, label) => {
  for (const wrapper of domain.DOMAIN_TOOL_NAMES) {
    assert.ok(!names.includes(wrapper), `${label} must hide generic ${wrapper}`);
  }
  // rules.roll is host-private after the RuleGraph cutover: its typed name
  // must not exist on any role surface. coc_invoke is the host boundary.
  for (const hidden of ["coc_invoke", "coc_rules_roll"]) {
    assert.ok(!names.includes(hidden), `${label} must hide ${hidden}`);
  }
};

const startup = {};
const acting = {};
let childSessionSetActiveToolsCalls = null;
let registered = null;
try {
  delete process.env.PI_SUBAGENT_CHILD;
  for (const role of [undefined, "setup", "play"]) {
    const label = role ?? "unset";
    const instance = bootInstance(role);
    registered = instance.tools;
    await instance.emit("session_start", { reason: "probe" });
    assert.equal(
      instance.activeTools.length,
      1,
      `${label} KP session_start must call setActiveTools exactly once`,
    );
    assert.deepEqual(
      instance.activeTools[0],
      [],
      `${label} awaiting_player stage is closed: no tools before the first player message`,
    );
    await instance.emit("message_start", playerMessage());
    assert.equal(
      instance.activeTools.length,
      2,
      `${label} first player message must bind the acting working set exactly once`,
    );
    startup[label] = instance.activeTools[0];
    acting[label] = instance.activeTools[1];
    assertNeverOnModelSurface(acting[label], label);
    assert.ok(acting[label].includes("read"), `${label} KP surface keeps the restricted canonical skill-doc read active`);
    assert.ok(acting[label].includes("subagent"), `${label} keeps subagent`);
    assert.ok(acting[label].includes("subagent_wait"), `${label} keeps subagent_wait`);
    assert.ok(acting[label].includes("coc_source_assets"), `${label} keeps coc_source_assets`);
  }

  // Unset role is the setup default: the same acting surface.
  assert.deepEqual(acting.unset, acting.setup);
  for (const name of [
    "coc_setup_quick_start", "coc_setup_inspect", "coc_session_resume",
    "coc_rules_roll_dice", "coc_chargen_delegate",
  ]) {
    assert.ok(acting.setup.includes(name), `setup acting surface must expose ${name}`);
  }
  for (const name of ["coc_npc_reaction", "coc_turn_finalize", "coc_rules_settle"]) {
    assert.ok(!acting.setup.includes(name), `setup acting surface must not expose ${name}`);
  }

  // Play with no campaign bound is resume-first: nothing to adjudicate yet.
  assert.ok(acting.play.includes("coc_session_resume"));
  for (const name of [
    "coc_setup_complete", "coc_setup_quick_start", "coc_chargen_delegate",
    "coc_npc_reaction", "coc_turn_finalize",
  ]) {
    assert.ok(!acting.play.includes(name), `play acting surface must not expose ${name}`);
  }

  process.env.PI_SUBAGENT_CHILD = "1";
  const child = bootInstance(undefined);
  await child.emit("session_start", { reason: "probe" });
  assert.equal(
    child.activeTools.length,
    0,
    "subagent child must not trigger setActiveTools (would wipe its allowlist)",
  );
  childSessionSetActiveToolsCalls = child.activeTools.length;
} finally {
  if (priorChildEnv === undefined) delete process.env.PI_SUBAGENT_CHILD;
  else process.env.PI_SUBAGENT_CHILD = priorChildEnv;
  if (priorRole === undefined) delete process.env[ROLE_ENV];
  else process.env[ROLE_ENV] = priorRole;
}

for (const name of [
  "coc_capabilities", "coc_discover", "coc_invoke", "coc_rules",
  "coc_rules_settle", "coc_rules_context", "coc_rules_roll_dice",
]) {
  assert.ok(registered.has(name), `coc extension must still register ${name}`);
}
assert.ok(
  !registered.has("coc_rules_roll"),
  "the retired rules.roll typed tool must not be registered",
);

process.stdout.write(JSON.stringify({
  ok: true,
  startupActiveTools: startup.unset,
  kpActiveTools: acting.unset,
  setupActiveTools: acting.setup,
  playActiveTools: acting.play,
  childSessionSetActiveToolsCalls,
}));
