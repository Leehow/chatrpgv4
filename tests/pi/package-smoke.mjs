import path from "node:path";
import process from "node:process";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const packageRoot = repoRoot;
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
const skillNames = loader.getSkills().skills.map((skill) => skill.name).sort();
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
process.stdout.write(JSON.stringify({
  extensionCount: extensions.extensions.length,
  toolNames,
  skillNames,
  childStartedOnLoad: afterHandles > beforeHandles,
  activeToolNames,
}));
