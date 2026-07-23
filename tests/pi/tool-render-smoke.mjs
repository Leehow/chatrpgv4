/**
 * Smoke: COC tools register compact Pi renderers and summarize large invoke JSON.
 */
import path from "node:path";
import process from "node:process";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import {
  summarizeCall,
  summarizeResult,
} from "../../plugins/coc-keeper/pi/lib/tool-summary.ts";

const repoRoot = path.resolve(process.argv[2] || process.cwd());

const invokeArgs = { operation: "setup.inspect", campaign: "demo" };
const invokeDetails = {
  ok: true,
  tool: "setup.inspect",
  data: {
    status: "PASS",
    kind: "onboarding.inspect",
    result: {
      workspace_ready: true,
      campaigns: [{ campaign_id: "a" }, { campaign_id: "b" }, { campaign_id: "c" }],
    },
  },
};

const callSummary = summarizeCall("coc_invoke", invokeArgs);
const resultSummary = summarizeResult("coc_invoke", invokeDetails, invokeArgs);
if (!callSummary.includes("setup.inspect") || !callSummary.includes("demo")) {
  throw new Error(`bad call summary: ${callSummary}`);
}
if (!resultSummary.includes("ok") || !resultSummary.includes("3 campaigns") || !resultSummary.includes("PASS")) {
  throw new Error(`bad result summary: ${resultSummary}`);
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
if (extensions.errors.length) throw new Error(JSON.stringify(extensions.errors));
const tools = extensions.extensions[0].tools;
const required = ["coc_capabilities", "coc_discover", "coc_invoke", "coc_dispatch_source_work", "coc_progressive_ocr"];
const toolDef = (name) => {
  const entry = tools.get(name);
  if (!entry) throw new Error(`missing tool ${name}`);
  return entry.definition ?? entry;
};
const rendererStatus = {};
for (const name of required) {
  const def = toolDef(name);
  rendererStatus[name] = {
    hasRenderCall: typeof def.renderCall === "function",
    hasRenderResult: typeof def.renderResult === "function",
  };
  if (!rendererStatus[name].hasRenderCall || !rendererStatus[name].hasRenderResult) {
    throw new Error(`tool ${name} missing compact renderers: ${JSON.stringify(rendererStatus[name])}`);
  }
}

const theme = {
  fg: (_k, s) => s,
  bold: (s) => s,
};
const collapsed = toolDef("coc_invoke").renderResult(
  { content: [{ type: "text", text: JSON.stringify(invokeDetails) }], details: invokeDetails },
  { expanded: false, isPartial: false },
  theme,
  { args: invokeArgs },
);
const collapsedLines = typeof collapsed?.render === "function" ? collapsed.render(120) : [];
const collapsedText = collapsedLines.join("\n");
if (collapsedText.includes("full_result_sha256") || collapsedText.includes("contract_archive_sha256")) {
  throw new Error("collapsed view leaked large wire fields");
}
if (!collapsedText.includes("3 campaigns")) {
  throw new Error(`collapsed display missing summary: ${collapsedText}`);
}

const expanded = toolDef("coc_invoke").renderResult(
  {
    content: [{ type: "text", text: JSON.stringify(invokeDetails) }],
    details: { ...invokeDetails, wire: { full_result_sha256: "sha256:deadbeef" } },
  },
  { expanded: true, isPartial: false },
  theme,
  { args: invokeArgs },
);
const expandedText = (typeof expanded?.render === "function" ? expanded.render(120) : []).join("\n");
if (!expandedText.includes("full_result_sha256")) {
  throw new Error(`expanded view missing full JSON: ${expandedText.slice(0, 200)}`);
}

const offlineModel = {
  id: "offline", name: "Offline", provider: "offline",
  api: "openai-completions", baseUrl: "http://127.0.0.1", reasoning: false,
  input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000, maxTokens: 100,
};
const { session } = await createAgentSession({
  cwd: repoRoot, agentDir: getAgentDir(), model: offlineModel,
  resourceLoader: loader, sessionManager: SessionManager.inMemory(repoRoot),
  noTools: "builtin",
});
session.dispose();

process.stdout.write(JSON.stringify({
  callSummary,
  resultSummary,
  rendererStatus,
  collapsedPreview: collapsedText.slice(0, 200),
  expandedHasWire: expandedText.includes("full_result_sha256"),
}));
