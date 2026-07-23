import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const packageRoot = path.resolve(process.argv[2]);
const role = process.argv[3];
if (!new Set(["coordinator", "leaf"]).has(role)) throw new Error("invalid private role");
const roleTools = role === "coordinator" ? ["coc_run_source_coordinator"] : [];
const privateExtension = path.join(packageRoot, "plugins/coc-keeper/pi/extensions", `${role}.ts`);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), `pi-private-loader-${role}-`));
const agentDir = path.join(temp, "agent");
const cwd = path.join(temp, "workspace");
await fs.mkdir(path.join(cwd, ".pi", "skills", "workspace-extra"), { recursive: true });
await fs.mkdir(agentDir, { recursive: true });
await fs.writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [packageRoot] }));
await fs.writeFile(path.join(cwd, "AGENTS.md"), "WORKSPACE_CONTEXT_MUST_NOT_LOAD\n");
await fs.writeFile(path.join(cwd, ".pi", "skills", "workspace-extra", "SKILL.md"), [
  "---", "name: workspace-extra", "description: must not load", "---", "# Extra", "",
].join("\n"));

try {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    additionalExtensionPaths: [privateExtension],
    additionalSkillPaths: [
      path.join(packageRoot, "plugins/coc-keeper/skills"),
      path.join(packageRoot, "plugins/coc-keeper/rulesets/coc7/skills"),
    ],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const extensions = loader.getExtensions();
  if (extensions.errors.length) throw new Error(JSON.stringify(extensions.errors));
  const offlineModel = {
    id: "offline", name: "Offline", provider: "offline",
    api: "openai-completions", baseUrl: "http://127.0.0.1", reasoning: false,
    input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000, maxTokens: 100,
  };
  const { session } = await createAgentSession({
    cwd, agentDir, model: offlineModel, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: role === "leaf" ? true : "builtin", tools: roleTools,
  });
  const active = session.getActiveToolNames().sort();
  const registered = [...extensions.extensions.flatMap((extension) => [...extension.tools.keys()])].sort();
  const skills = loader.getSkills().skills.map((skill) => skill.name).sort();
  const contextFiles = loader.getAgentsFiles().agentsFiles.map((entry) => entry.path);
  session.dispose();
  process.stdout.write(JSON.stringify({
    role, extensionCount: extensions.extensions.length, active, registered, skills, contextFiles,
    publicToolsAbsent: !registered.some((name) => [
      "coc_capabilities", "coc_discover", "coc_invoke", "coc_dispatch_source_work", "coc_progressive_ocr",
    ].includes(name)),
    builtinsAbsent: !active.some((name) => ["bash", "edit", "read", "write"].includes(name)),
    workspaceSkillAbsent: !skills.includes("workspace-extra"),
  }));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
