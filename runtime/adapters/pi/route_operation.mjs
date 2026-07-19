#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  "You are a semantic router for a Call of Cthulhu runtime. " +
  "Classify meaning, never by keyword matching. Route ordinary investigation, social, " +
  "combat, chase, sanity, and narration actions to ordinary_turn. Select operation only " +
  "for an explicit spell cast/learn, tome-study phase, environmental hazard settlement, " +
  "suffocation transition, poison settlement, or end-of-session development settlement. " +
  "Never invent hidden facts. Use only the player-visible public_state. " +
  "Call coc_route_player_action exactly once. If uncertain, choose ordinary_turn.";

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(chunks.join("").trim())); }
      catch (error) { reject(error); }
    });
    process.stdin.on("error", reject);
  });
}

function modelIdentity(session) {
  const model = session && session.model;
  return model && model.provider && model.id
    ? { provider: model.provider, id: model.id }
    : undefined;
}

function operationSchema() {
  const simple = (kind, payload) => Type.Object({
    schema_version: Type.Literal(1), kind: Type.Literal(kind), payload,
  });
  return Type.Union([
    simple("magic.cast", Type.Object({
      spell: Type.String(), pushed: Type.Boolean(), interrupted: Type.Boolean(), is_npc: Type.Boolean(),
    })),
    simple("magic.learn", Type.Object({ spell: Type.String(), source: Type.Union([
      Type.Literal("tome"), Type.Literal("person"), Type.Literal("entity"),
    ]) })),
    simple("tome.read", Type.Object({
      tome: Type.String(), phase: Type.Union([
        Type.Literal("skim"), Type.Literal("initial"), Type.Literal("full"), Type.Literal("research"),
      ]),
      language_skill: Type.Integer(), read_language_ok: Type.Boolean(),
      plot_critical: Type.Boolean(), choose_disbelief: Type.Boolean(), alone: Type.Boolean(),
    })),
    simple("hazard.apply", Type.Object({
      severity: Type.Union([Type.Literal("minor"), Type.Literal("moderate"), Type.Literal("severe"), Type.Literal("deadly"), Type.Literal("terminal"), Type.Literal("splat")]),
      source: Type.String(), ignore_major_wound: Type.Boolean(),
    })),
    simple("hazard.suffocation.start", Type.Object({
      kind: Type.Union([Type.Literal("drowning"), Type.Literal("asphyxiation"), Type.Literal("vacuum")]),
      severity: Type.Union([Type.Literal("minor"), Type.Literal("moderate"), Type.Literal("severe")]),
      exertion: Type.Boolean(),
    })),
    simple("hazard.suffocation.tick", Type.Object({})),
    simple("hazard.suffocation.end", Type.Object({ reason: Type.String() })),
    simple("hazard.poison", Type.Object({
      poison_id: Type.String(), doses: Type.Integer({ minimum: 1 }), allow_critical_shake_off: Type.Boolean(),
    })),
    simple("development.settle", Type.Object({})),
  ]);
}

async function run(request) {
  if (!request || typeof request.player_text !== "string" || !request.player_text.trim()) {
    throw new Error("request requires player_text");
  }
  if (!request.public_state || typeof request.public_state !== "object") {
    throw new Error("request requires public_state");
  }
  const capture = { result: null };
  const tool = defineTool({
    name: "coc_route_player_action",
    label: "Route COC Player Action",
    description: "Submit the semantic route for exactly one player action.",
    parameters: Type.Object({
      route: Type.Union([Type.Literal("ordinary_turn"), Type.Literal("operation")]),
      reason: Type.String(),
      operation: Type.Union([Type.Null(), operationSchema()]),
    }),
    async execute(_id, params) {
      if ((params.route === "ordinary_turn") !== (params.operation === null)) {
        throw new Error("ordinary_turn requires null operation; operation route requires operation");
      }
      capture.result = {
        schema_version: 1,
        route: params.route,
        reason: params.reason,
        operation: params.operation,
      };
      return { content: [{ type: "text", text: "route received" }], details: capture.result, terminate: true };
    },
  });
  const cwd = __dirname;
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({
    cwd, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true,
    noThemes: true, noContextFiles: true, systemPromptOverride: () => SYSTEM_PROMPT,
    extensionsOverride: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  });
  await loader.reload();
  const auth = AuthStorage.create(path.join(agentDir, "auth.json"));
  const registry = ModelRegistry.create(auth, path.join(agentDir, "models.json"));
  const provider = process.env.COC_OPERATION_ROUTER_MODEL_PROVIDER || "coding-relay";
  const id = process.env.COC_OPERATION_ROUTER_MODEL_ID || "gpt-5.6-luna";
  let model = registry.find(provider, id);
  if (!model && (provider === "coding-relay" || provider === "cursor-relay")) {
    const template = registry.getAll().find((item) => item.provider === provider && registry.hasConfiguredAuth(item));
    if (template) model = { ...template, id, name: id };
  }
  if (!model || !registry.hasConfiguredAuth(model)) throw new Error(`requested model unavailable: ${provider}/${id}`);
  const created = await createAgentSession({
    cwd, agentDir, tools: ["coc_route_player_action"], customTools: [tool],
    model, modelRegistry: registry, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd),
  });
  try {
    await created.session.prompt([
      "Player action:", request.player_text,
      "", "Player-visible public state:", JSON.stringify(request.public_state, null, 2),
      "", "Call coc_route_player_action exactly once.",
    ].join("\n"));
    if (!capture.result) throw new Error("model did not submit a semantic route");
    return { ok: true, semantic_route: capture.result, model_identity: modelIdentity(created.session) };
  } finally {
    created.session.dispose();
  }
}

try {
  const result = await run(await readStdinJson());
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) }) + "\n");
  process.exitCode = 1;
}
