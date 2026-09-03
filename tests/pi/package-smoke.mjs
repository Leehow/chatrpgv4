import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const packageRoot = repoRoot;
const typed = await import(
  pathToFileURL(path.join(repoRoot, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
);
const domain = await import(
  pathToFileURL(path.join(repoRoot, "plugins/coc-keeper/pi/lib/domain-tools.ts")).href
);
const beforeHandles = process._getActiveHandles().length;
const loader = new DefaultResourceLoader({
  cwd: repoRoot,
  agentDir: getAgentDir(),
  additionalExtensionPaths: [packageRoot],
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await loader.reload();
const extensions = loader.getExtensions();
if (extensions.errors.length) throw new Error(JSON.stringify(extensions.errors));
const toolNames = [...extensions.extensions[0].tools.keys()].sort();
const skillsResult = loader.getSkills();
const skillNames = skillsResult.skills.map((skill) => skill.name).sort();
const afterHandles = process._getActiveHandles().length;
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
const activeToolNames = session.getActiveToolNames().sort();
session.dispose();
const typedToolNames = typed.listTypedOperationTools().map((row) => row.name).sort();
const genericToolNames = [...domain.DOMAIN_TOOL_NAMES].sort();
const hostToolNames = [
  // `coc_chargen_delegate` is gone with the setup role; `setup.chargen_run`
  // builds investigators and onboarding calls it directly.
  "coc_capabilities", "coc_discover",
  "coc_dispatch_source_work", "coc_invoke", "coc_map_supply", "coc_progressive_ocr",
  "coc_source_assets",
];
const expectedToolNames = [...new Set([
  ...hostToolNames,
  ...genericToolNames,
  ...typedToolNames,
])].sort();
process.stdout.write(JSON.stringify({
  extensionCount: extensions.extensions.length,
  toolNames,
  expectedToolNames,
  typedToolNames,
  genericToolNames,
  hostToolNames,
  skillNames,
  skillDiagnostics: skillsResult.diagnostics,
  childStartedOnLoad: afterHandles > beforeHandles,
  activeToolNames,
}));
