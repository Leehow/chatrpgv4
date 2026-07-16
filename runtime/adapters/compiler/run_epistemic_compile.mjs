#!/usr/bin/env node
/** Minimum-privilege semantic compiler for epistemic scenario sidecars. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AuthStorage, createAgentSession, createExtensionRuntime, DefaultResourceLoader,
  ModelRegistry, SessionManager, defineTool, getAgentDir,
} from "@earendil-works/pi-coding-agent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(
  path.join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json"),
);
const { Type } = require("typebox");

const SYSTEM_PROMPT =
  "You are the Keeper-only epistemic compiler for a Call of Cthulhu runtime. " +
  "The request is a minimum-privilege structured projection: it contains IDs, enums, " +
  "player-safe summaries, and source locators, never raw source text or Keeper agenda prose. " +
  "Infer belief questions and evidence relationships from the structured scenario as a whole. " +
  "Never classify by fixed keyword hits, invent module truth, or copy prose. " +
  "Return the exact provenance-bound result through coc_submit_epistemic_result once.";

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

function validateResult(result, requestSha) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("compile_result must be an object");
  }
  const expected = [
    "schema_version", "evaluator_id", "evaluation_provenance",
    "epistemic_graph", "reveal_contracts", "compile_confidence", "reasons",
  ].sort();
  if (JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(expected)) {
    throw new Error(`compile_result keys must exactly equal ${expected.join(", ")}`);
  }
  if (result.schema_version !== 1 || result.evaluator_id !== "codex-epistemic-compiler-v1") {
    throw new Error("compile_result identity is invalid");
  }
  const provenance = result.evaluation_provenance;
  if (!provenance || provenance.kind !== "llm" || provenance.request_sha256 !== requestSha ||
      provenance.reviewed_artifact !== "epistemic-compile-request.json") {
    throw new Error("compile_result provenance does not bind the request");
  }
  for (const key of ["epistemic_graph", "reveal_contracts", "compile_confidence", "reasons"]) {
    if (!result[key] || typeof result[key] !== "object" || Array.isArray(result[key])) {
      throw new Error(`${key} must be an object`);
    }
  }
  return result;
}

async function run(envelope) {
  if (!envelope || typeof envelope !== "object" || !envelope.compile_request ||
      typeof envelope.request_sha256 !== "string") {
    throw new Error("invalid epistemic compiler envelope");
  }
  const holder = { result: null, error: null };
  const tool = defineTool({
    name: "coc_submit_epistemic_result",
    label: "Submit COC Epistemic Sidecars",
    description: "Submit the exact provenance-bound epistemic compile result.",
    promptGuidelines: ["Call exactly once.", "After the tool returns, stop."],
    parameters: Type.Object({
      compile_result_json: Type.String({ description: "Stringified compile result object." }),
    }),
    async execute(_id, params) {
      try {
        holder.result = validateResult(JSON.parse(params.compile_result_json), envelope.request_sha256);
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
    cwd: __dirname, agentDir, tools: ["coc_submit_epistemic_result"], customTools: [tool],
    model, modelRegistry: registry, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(__dirname),
  });
  const prompt = [
    "Compile the supplied structured scenario into epistemic sidecars.",
    `Use this exact evaluation_provenance: ${JSON.stringify({ kind: "llm", request_sha256: envelope.request_sha256, reviewed_artifact: "epistemic-compile-request.json" })}`,
    "Critical questions and every reframe contract require a reasons entry. Confidence nodes must cover every critical question and reveal contract.",
    JSON.stringify(envelope.compile_request, null, 2),
  ].join("\n\n");
  try { await created.session.prompt(prompt); }
  finally { created.session.dispose(); }
  if (holder.error) throw new Error(holder.error);
  if (!holder.result) throw new Error("model did not submit epistemic sidecars through the tool");
  return { ok: true, compile_result: holder.result, model_identity: { provider: model.provider, id: model.id } };
}

try {
  process.stdout.write(`${JSON.stringify(await run(await readStdinJson()))}\n`);
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}
