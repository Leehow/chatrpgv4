#!/usr/bin/env node
/** Keeper-only semantic compiler: extracted module pages -> seven-file scenario IR. */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { parseSingleJsonObject } from "./single_json_object.mjs";
import { buildPrompt } from "./scenario_compile_prompt.mjs";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(
  path.join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json"),
);
const { Type } = require("typebox");

const SYSTEM_PROMPT =
  "You are the Keeper-only semantic compiler for a Call of Cthulhu runtime. " +
  "Convert the supplied legally-local extracted module pages into concise structured IR. " +
  "The AI player and narrator never see these pages. Do not optimize for an evaluation answer. " +
  "Preserve module truth, mark source-derived prose with structured source_refs, and never invent " +
  "a core truth that is absent from the source. Return exactly the seven requested JSON documents. " +
  "Prefer short player-safe summaries and structured IDs/tags over copied prose. " +
  "Every scene affordance cue is visible before its linked clue is discovered: write it as an " +
  "action-only opportunity, never as the clue answer. Keep unrevealed destination names, amounts, " +
  "identities, object transfers, and findings in the linked clue player_safe_summary, not the cue. " +
  "Every critical conclusion needs independent clue routes and the opening scene must be playable. " +
  "Call coc_submit_scenario_ir exactly once; do not emit the bundle as ordinary prose.";

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(chunks.join(""))); }
      catch (error) { reject(new Error(`invalid stdin JSON: ${error.message}`)); }
    });
    process.stdin.on("error", reject);
  });
}

function resolveModel(agentDir, provider, modelId) {
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const registry = ModelRegistry.create(authStorage, path.join(agentDir, "models.json"));
  let model = registry.find(provider, modelId);
  if (!model && provider === "coding-relay") {
    const template = registry.getAll().find(
      (candidate) => candidate.provider === provider && registry.hasConfiguredAuth(candidate),
    );
    if (template) model = { ...template, id: modelId, name: modelId };
  }
  if (!model || !registry.hasConfiguredAuth(model)) {
    throw new Error(`requested model unavailable: ${provider}/${modelId}`);
  }
  return { model, registry };
}

function validateBundle(bundle, requiredFiles) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("scenario_bundle must be an object");
  }
  const actual = Object.keys(bundle).sort();
  const expected = [...requiredFiles].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`scenario_bundle keys must exactly equal ${expected.join(", ")}`);
  }
  for (const name of expected) {
    if (!bundle[name] || typeof bundle[name] !== "object" || Array.isArray(bundle[name])) {
      throw new Error(`${name} must be a JSON object`);
    }
  }
  return bundle;
}

export async function run(request) {
  const required = ["module_identity", "source", "pages", "required_files", "compile_contract"];
  for (const key of required) if (!(key in request)) throw new Error(`request missing ${key}`);
  const holder = { result: null, error: null };
  const tool = defineTool({
    name: "coc_submit_scenario_ir",
    label: "Submit COC Scenario IR",
    description: "Submit exactly the seven compiled scenario JSON documents.",
    promptGuidelines: [
      "Call exactly once.",
      "scenario_bundle_json must parse as one JSON object keyed by the seven filenames.",
      "After the tool returns, stop.",
    ],
    parameters: Type.Object({
      scenario_bundle_json: Type.String({ description: "Stringified seven-file JSON object." }),
    }),
    async execute(_id, params) {
      try {
        const parsed = parseSingleJsonObject(params.scenario_bundle_json);
        holder.result = validateBundle(parsed, request.required_files);
      } catch (error) {
        holder.error = error && error.message ? error.message : String(error);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(holder.error ? { ok: false, error: holder.error } : { ok: true }) }],
        details: holder.error ? { error: holder.error } : { ok: true },
        terminate: true,
      };
    },
  });
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({
    cwd: __dirname, agentDir, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPromptOverride: () => SYSTEM_PROMPT,
    extensionsOverride: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  });
  await loader.reload();
  const provider = process.env.COC_COMPILER_MODEL_PROVIDER || "coding-relay";
  const modelId = process.env.COC_COMPILER_MODEL_ID || "gpt-5.6";
  const { model, registry } = resolveModel(agentDir, provider, modelId);
  const created = await createAgentSession({
    cwd: __dirname, agentDir, tools: ["coc_submit_scenario_ir"], customTools: [tool],
    model, modelRegistry: registry, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(__dirname),
  });
  try { await created.session.prompt(buildPrompt(request)); }
  finally { created.session.dispose(); }
  if (holder.error) throw new Error(holder.error);
  if (!holder.result) throw new Error("model did not submit scenario IR through the tool");
  return {
    ok: true,
    scenario_bundle: holder.result,
    model_identity: { provider: model.provider, id: model.id },
  };
}

async function cliMain() {
  try {
    const result = await run(await readStdinJson());
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cliMain();
}
