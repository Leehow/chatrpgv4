import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  DefaultResourceLoader,
  getAgentDir,
} from "../../runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const packageRoot = path.resolve(process.argv[2]);
const campaignRoot = path.resolve(process.argv[3]);
const required = [
  ".python-version", "pyproject.toml", "uv.lock",
  "plugins/coc-keeper/pi/extensions/index.ts",
  "plugins/coc-keeper/mcp/launch",
  "plugins/coc-keeper/skills/coc-main/SKILL.md",
  "plugins/coc-keeper/rulesets/coc7/skills/coc-rules-engine/SKILL.md",
  "runtime/adapters/compiler/adapter.py",
  "runtime/adapters/compiler/run_scenario_compile.mjs",
];
for (const relative of required) if (!fs.existsSync(path.join(packageRoot, relative))) throw new Error(`packed resource missing: ${relative}`);
const loader = new DefaultResourceLoader({
  cwd: campaignRoot, agentDir: getAgentDir(), additionalExtensionPaths: [packageRoot],
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
});
await loader.reload();
if (loader.getExtensions().errors.length) throw new Error(JSON.stringify(loader.getExtensions().errors));
const tools = [...loader.getExtensions().extensions[0].tools.keys()].sort();
const skills = loader.getSkills().skills.map((skill) => skill.name).sort();
const extension = loader.getExtensions().extensions[0];
const ctx = { cwd: campaignRoot, sessionManager: { getSessionId() { return "packed-package-smoke"; } }, model: undefined };
const gatewayResult = await extension.tools.get("coc_capabilities").definition.execute("packed-smoke", {}, undefined, undefined, ctx);
const gateway = JSON.parse(gatewayResult.content[0].text);
for (const handler of extension.handlers.get("session_shutdown") || []) await handler({ reason: "quit" }, ctx);
process.stdout.write(JSON.stringify({ tools, skills, runtimeRoot: path.join(packageRoot, "runtime"), gateway: { ok: gateway.ok, host: gateway.data.host } }));
