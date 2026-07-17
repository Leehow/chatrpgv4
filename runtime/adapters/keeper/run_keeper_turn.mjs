#!/usr/bin/env node
/**
 * Full Pi coding-agent Keeper turn.
 *
 * Pi is an AI coding agent like Codex/Claude Code/Cursor. This thin host
 * shell spawns a pi-coding-agent session with the canonical COC keeper
 * skills loaded and read/bash/grep/ls tools enabled, so the keeper LLM reads
 * the same SKILL.md tree and calls the same coc_toolbox.py CLI as every
 * other host. No TypeBox tool contract, no narration envelope, no audit.
 *
 * stdin (one JSON object):
 *   {
 *     workspace,            // project root containing .coc/
 *     campaign_id,
 *     run_id?,              // current play/report segment identity
 *     investigator_id?,     // optional focus investigator
 *     player_input,         // raw player prose for this turn
 *     play_language,        // e.g. "zh-Hans"
 *     run_policy?,          // single_session | continue_until_scenario_terminal
 *     transcript_tail?,     // [{role, text}] recent public transcript
 *     skills_dir,           // plugins/coc-keeper/skills (absolute)
 *     toolbox_path          // plugins/coc-keeper/scripts/coc_toolbox.py (absolute)
 *   }
 * stdout: { ok: true, narration, model_identity?, usage? }
 *      or { ok: false, error }
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  path.join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json"),
);
const { loadSkillsFromDir } = require("./dist/core/skills.js");

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      const text = chunks.join("").trim();
      if (!text) return reject(new Error("empty stdin"));
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new Error(`invalid JSON on stdin: ${err.message}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

function writeResult(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export function resolveRequestedModel({ agentDir, provider, modelId }) {
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(
    authStorage,
    path.join(agentDir, "models.json"),
  );
  let model = modelRegistry.find(provider, modelId);
  if (!model && provider === "coding-relay") {
    const template = modelRegistry
      .getAll()
      .find(
        (candidate) =>
          candidate.provider === provider &&
          modelRegistry.hasConfiguredAuth(candidate),
      );
    if (template) {
      model = { ...template, id: modelId, name: modelId };
    }
  }
  if (!model || !modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`requested model unavailable: ${provider}/${modelId}`);
  }
  return { model, modelRegistry };
}

function keeperSystemPrompt(request) {
  const projectRoot = path.resolve(path.dirname(request.toolbox_path), "../../..");
  const pythonCommand = `uv run --project ${JSON.stringify(projectRoot)} --frozen python`;
  const continuationPolicy = request.run_policy === "continue_until_scenario_terminal"
    ? [
        "This is a continuous operator long-play run. Do not create an optional",
        "cliffhanger merely because a combat ended or a living investigator became",
        "temporarily unplayable. Continue established rescue/aftermath toward the",
        "scenario conclusion unless a real session boundary or hard rules blocker exists.",
        "A player's explicit decision to abandon the investigation is a real retreat",
        "boundary even when the scenario threat survives; record it as such instead of",
        "leaving the host waiting after closed prose.",
      ]
    : [];
  return [
    "You are the KEEPER (game master) of a Call of Cthulhu 7e tabletop session,",
    "running inside an AI coding agent with shell access to the project workspace.",
    "",
    "Canonical behavior contract: the coc-keeper-play skill (already loaded).",
    "Your toolbox is the CLI at:",
    `  ${pythonCommand} ${request.toolbox_path} <tool> --root . --campaign ${request.campaign_id} --json '<args>'`,
    ...(request.run_id
      ? [
          `The current play/report segment run_id is ${request.run_id}.`,
          "The host exports it to toolbox subprocesses; preserve it when a tool exposes run_id.",
        ]
      : []),
    `Run \`${pythonCommand} ${request.toolbox_path} list\` to see all tools;`,
    "`describe <tool>` shows parameters.",
    "",
    "Three hard rules (everything else is your judgment):",
    "1. Dice are real: never invent roll numbers or HP/SAN arithmetic; use rules.* tools and quote results faithfully.",
    "2. State writes go through state.* / rules.* tools, never hand edits.",
    "3. Module truth is read-only: fields marked secret are your reference; reveal through play, never as exposition.",
    "",
    "Turn shape: ground yourself, resolve risk, and decide the narration and consequences.",
    "Then synchronously finish every rules.* resource change and critical state.* write.",
    "After the narration decision is final, close out synchronously with state.journal",
    "(or state.end_session when appropriate), then emit the player-facing narration.",
    "Before writing the final message, make one semantic judgment: does play continue,",
    "or did the player/fiction establish an actual session boundary? If it is a boundary,",
    "state.journal is not a substitute: call state.end_session exactly once with the",
    "matching structured kind. A retreat may leave the scenario unresolved. Never write",
    "a definitive closing narration while leaving the structured ending receipt absent.",
    "state.end_session synchronously returns development PASS or PENDING; a PENDING result",
    "does not reopen or invalidate the ending and may be replayed with the same identity.",
    ...continuationPolicy,
    "Never defer dice, HP/SAN/Luck, clues, NPC state, time, scene, journal, ending,",
    "or development writes. Only append-only JSONL audit/mirror flushing may happen",
    "in the background; it must not change the already-settled game state.",
    `Narrate in ${request.play_language || "zh-Hans"}.`,
    "",
    "Your FINAL assistant message must be exactly the player-visible narration:",
    "immersive prose only — no tool logs, no JSON, no meta commentary, no",
    "numbered action menus. End with an open prompt for the player's next move,",
    "unless you recorded state.end_session; in that case, close the session and",
    "do not ask for another immediate action.",
  ].join("\n");
}

function buildPromptText(request) {
  const sections = [];
  const tail = Array.isArray(request.transcript_tail) ? request.transcript_tail : [];
  if (tail.length) {
    sections.push(
      "## Recent public transcript",
      tail
        .map((row) => `[${row && row.role ? row.role : "?"}] ${row && row.text ? row.text : ""}`)
        .join("\n"),
      "",
    );
  }
  sections.push(
    "## Player input (this turn)",
    String(request.player_input ?? ""),
    "",
    "Run the keeper turn now. Remember: final message = pure player-facing narration.",
  );
  return sections.join("\n");
}

function extractFinalProse(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    const texts = content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text.trim())
      .filter(Boolean);
    if (texts.length) return texts.join("\n").trim();
  }
  return "";
}

function selectedModelIdentity(session) {
  const model = session && session.model;
  if (
    !model ||
    typeof model.provider !== "string" ||
    !model.provider.trim() ||
    typeof model.id !== "string" ||
    !model.id.trim()
  ) {
    return undefined;
  }
  return { provider: model.provider.trim(), id: model.id.trim() };
}

export async function runKeeperTurn(request) {
  for (const key of ["workspace", "campaign_id", "player_input", "play_language", "skills_dir", "toolbox_path"]) {
    if (!(key in request)) throw new Error(`request missing ${key}`);
  }
  const cwd = path.resolve(String(request.workspace));
  const agentDir = getAgentDir();
  if (request.run_id !== undefined) {
    const runId = String(request.run_id).trim();
    if (!runId) throw new Error("run_id must be non-empty when supplied");
    process.env.COC_PLAYTEST_RUN_ID = runId;
  } else {
    delete process.env.COC_PLAYTEST_RUN_ID;
  }

  // Same experience as other coding hosts: load the canonical keeper skill
  // tree; keep project context files and unrelated extensions out.
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true, // replaced below with the explicit keeper tree
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => keeperSystemPrompt(request),
    skillsOverride: () => loadSkillsFromDir({
      dir: path.resolve(String(request.skills_dir)),
      source: "coc-keeper",
    }),
    extensionsOverride: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
  });
  await loader.reload();

  const provider = process.env.COC_KEEPER_MODEL_PROVIDER || "coding-relay";
  const modelId = process.env.COC_KEEPER_MODEL_ID || "gpt-5.6-sol";
  const { model, modelRegistry } = resolveRequestedModel({ agentDir, provider, modelId });

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    tools: ["read", "bash", "grep", "ls"],
    model,
    modelRegistry,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
  });

  let assistantError = null;
  let usageInput = null;
  let usageOutput = null;
  const unsubscribe = session.subscribe((event) => {
    if (event && event.type === "message_end" && event.message) {
      const msg = event.message;
      if (msg.role === "assistant") {
        if (
          msg.stopReason === "error" &&
          typeof msg.errorMessage === "string" &&
          msg.errorMessage.trim()
        ) {
          assistantError = msg.errorMessage.trim();
        }
        const usage = msg.usage;
        if (usage && typeof usage === "object") {
          if (Number.isInteger(usage.input)) usageInput = (usageInput || 0) + usage.input;
          if (Number.isInteger(usage.output)) usageOutput = (usageOutput || 0) + usage.output;
        }
      }
    }
  });

  try {
    await session.prompt(buildPromptText(request));
    const narration = extractFinalProse(session.messages);
    if (assistantError && !narration) {
      return { ok: false, error: assistantError };
    }
    if (!narration) {
      return { ok: false, error: "keeper agent produced no final narration" };
    }
    const result = { ok: true, narration };
    const identity = selectedModelIdentity(session);
    if (identity) result.model_identity = identity;
    if (usageInput !== null || usageOutput !== null) {
      result.usage = { input_tokens: usageInput, output_tokens: usageOutput };
    }
    return result;
  } finally {
    unsubscribe();
    session.dispose();
  }
}

async function main() {
  try {
    const request = await readStdinJson();
    const result = await runKeeperTurn(request);
    writeResult(result);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    writeResult({ ok: false, error: err && err.message ? err.message : String(err) });
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
