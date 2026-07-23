/**
 * Live HUD probe: load the Pi package extension, bind a real campaign,
 * refresh via MCP coc_invoke, and capture the footer lines that would
 * replace the coding-agent chrome.
 *
 * Usage:
 *   node --experimental-strip-types tests/pi/hud-live-probe.mjs [repoRoot] [campaignId]
 */
import path from "node:path";
import process from "node:process";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const campaignId = process.argv[3] || "haunting-persist-kp-20260719";

const footerRenders = [];
const notifies = [];
let lastFooterFactory = null;

function makeUi() {
  return {
    setFooter(factory) {
      lastFooterFactory = factory ?? null;
      if (!factory) {
        footerRenders.push({ cleared: true });
        return;
      }
      const theme = {
        fg: (_k, s) => s,
        bold: (s) => s,
      };
      const component = factory({}, theme, {
        getGitBranch: () => null,
        getExtensionStatuses: () => [],
        onBranchChange: () => () => {},
      });
      const lines = component.render(100);
      footerRenders.push({ lines });
    },
    setWidget() {},
    notify(msg, level) {
      notifies.push({ msg, level });
    },
    select: async () => undefined,
    custom: async () => null,
    theme: { fg: (_k, s) => s, bold: (s) => s },
  };
}

const loader = new DefaultResourceLoader({
  cwd: repoRoot,
  agentDir: getAgentDir(),
  additionalExtensionPaths: [repoRoot],
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await loader.reload();
const extensions = loader.getExtensions();
if (extensions.errors.length) {
  throw new Error(`extension load failed: ${JSON.stringify(extensions.errors)}`);
}
const ext = extensions.extensions[0];
const commands = [...ext.commands.keys()];
if (!commands.includes("hud")) {
  throw new Error(`hud command missing; have ${commands.join(",")}`);
}

const offlineModel = {
  id: "offline",
  name: "Offline",
  provider: "offline",
  api: "openai-completions",
  baseUrl: "http://127.0.0.1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

const { session } = await createAgentSession({
  cwd: repoRoot,
  agentDir: getAgentDir(),
  model: offlineModel,
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(repoRoot),
  noTools: "builtin",
});

// Drive /hud bind + refresh through the registered command handler.
const hudCommand = ext.commands.get("hud");
if (!hudCommand?.handler) throw new Error("hud command has no handler");

const ctx = {
  cwd: repoRoot,
  hasUI: true,
  ui: makeUi(),
  sessionManager: session.sessionManager,
  model: offlineModel,
  signal: undefined,
};

// Unbound state: session_start may already have set a footer; bind now.
await hudCommand.handler(`bind ${campaignId}`, ctx);
await hudCommand.handler("refresh", ctx);

const last = [...footerRenders].reverse().find((row) => row.lines);
if (!last?.lines?.length) {
  session.dispose();
  throw new Error(`no footer lines captured: ${JSON.stringify(footerRenders)}`);
}

const joined = last.lines.join("\n");
const problems = [];
if (/↑|↓|token|grok-relay|CH\d|\/200k/i.test(joined)) {
  problems.push("coding chrome still present in footer");
}
if (!/COC/.test(joined)) problems.push("missing COC marker");
// After bind+refresh against a real campaign we expect game fields or an explicit error line.
const looksLikeGame =
  /HP|SAN|运|物品|线索|回合|未绑定|读取|error|Error|corrupt|PASS|investigator/i.test(joined);
if (!looksLikeGame) problems.push(`footer not game-like: ${joined}`);

// Detail panels (keyboard path)
await hudCommand.handler("sheet", ctx);
await hudCommand.handler("time", ctx);
await hudCommand.handler("inv", ctx);
await hudCommand.handler("clues", ctx);

// Off restores default
await hudCommand.handler("off", ctx);
const cleared = footerRenders.some((row) => row.cleared === true);
if (!cleared) problems.push("hud off did not clear custom footer");

session.dispose();

const out = {
  ok: problems.length === 0,
  campaignId,
  commands,
  footerLines: last.lines,
  notifies: notifies.slice(-6),
  problems,
  footerSampleCount: footerRenders.length,
};
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
// MCP child close can linger; hard-exit after result is written.
setTimeout(() => process.exit(problems.length ? 1 : 0), 200);
