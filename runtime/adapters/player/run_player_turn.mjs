#!/usr/bin/env node
/**
 * Constrained Pi Coding Agent bridge for one COC investigator (player) turn.
 *
 * stdin:  player-safe JSON request
 *   {public_state, narration, character_card, transcript_tail, pending_choice}
 * stdout: { ok: true, player_text, intent_class?, player_notes? }
 *      or { ok: false, error: "..." }
 *
 * V1 is stateless per process; match continuity lives in coc_live_match.py.
 *
 * Prose degradation (vs KP pi_missing_tool_use):
 *   A player prose answer IS usable as player_text. If the model replies in
 *   free text without calling coc_player_action, wrap that prose as
 *   player_text and set player_notes to a player_missing_tool_use marker
 *   rather than failing the turn.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import path from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  DefaultResourceLoader,
  SessionManager,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// typebox is nested under pi-coding-agent; resolve via that package.
const require = createRequire(
  path.join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json"),
);
const { Type } = require("typebox");

/** Keep in sync with runtime/adapters/player/adapter.py CANONICAL_INTENT_CLASSES. */
const INTENT_CLASSES = [
  "investigate",
  "social",
  "move",
  "combat",
  "flee",
  "meta",
  "stuck",
  "idle",
  "ambiguous",
  "montage",
  "cast",
];

const PROSE_DEGRADE_NOTE =
  "player_missing_tool_use: model returned prose without coc_player_action";

const SYSTEM_PROMPT =
  "You are a Call of Cthulhu INVESTIGATOR player at a virtual table. " +
  "Stay in character. Act only on what the narration and public state show. " +
  "Take exactly one concrete action or line of dialogue per turn. " +
  "Never ask for keeper secrets, director plans, or hidden clue graphs. " +
  "Never do rules math, dice rolls, or skill arithmetic yourself. " +
  "Prefer calling the coc_player_action tool once with your in-character " +
  "player_text (in the campaign play_language). Optional intent_class and " +
  "player_notes (out-of-character reasoning) may be included. When a player " +
  "pending choice is present, copy its exact identity into pending_choice_response.";

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      const text = chunks.join("").trim();
      if (!text) {
        reject(new Error("empty stdin"));
        return;
      }
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

function summarizeCharacterCard(card) {
  if (!card || typeof card !== "object") {
    return "(no character card)";
  }
  const lines = [];
  const name = card.name || card.id || card.investigator_id;
  if (name) lines.push(`Name/id: ${name}`);
  if (card.occupation) lines.push(`Occupation: ${card.occupation}`);
  if (card.age != null) lines.push(`Age: ${card.age}`);
  const attrs = [];
  for (const key of ["current_hp", "hp", "current_san", "san", "current_mp", "mp"]) {
    if (card[key] != null) attrs.push(`${key}=${card[key]}`);
  }
  if (attrs.length) lines.push(`Status: ${attrs.join(", ")}`);
  const skills = card.skills;
  if (skills && typeof skills === "object") {
    const entries = Object.entries(skills)
      .slice(0, 12)
      .map(([k, v]) => `${k}:${v}`);
    if (entries.length) lines.push(`Skills (sample): ${entries.join(", ")}`);
  }
  return lines.length ? lines.join("\n") : JSON.stringify(card).slice(0, 800);
}

function summarizePublicState(ps) {
  if (!ps || typeof ps !== "object") {
    return "(no public state)";
  }
  const lines = [
    `campaign_id: ${ps.campaign_id ?? "?"}`,
    `play_language: ${ps.play_language ?? "zh-Hans"}`,
    `active_scene_id: ${ps.active_scene_id ?? "?"}`,
    `turn_number: ${ps.turn_number ?? "?"}`,
    `tension_level: ${ps.tension_level ?? "?"}`,
  ];
  const clues = Array.isArray(ps.discovered_clue_ids)
    ? ps.discovered_clue_ids
    : [];
  lines.push(
    `discovered_clue_ids: ${clues.length ? clues.join(", ") : "(none)"}`,
  );
  const invs = Array.isArray(ps.investigators) ? ps.investigators : [];
  if (invs.length) {
    for (const inv of invs) {
      if (!inv || typeof inv !== "object") continue;
      const cond = Array.isArray(inv.conditions)
        ? inv.conditions.join("|")
        : "";
      lines.push(
        `investigator ${inv.id}: HP=${inv.current_hp ?? "?"} SAN=${inv.current_san ?? "?"} MP=${inv.current_mp ?? "?"}${cond ? ` conditions=${cond}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

function formatTranscript(tail) {
  if (!Array.isArray(tail) || tail.length === 0) {
    return "(empty)";
  }
  return tail
    .map((row) => {
      if (!row || typeof row !== "object") return String(row);
      const role = row.role || "?";
      const text = row.text || "";
      return `[${role}] ${text}`;
    })
    .join("\n");
}

function formatPendingChoice(pending) {
  if (pending == null) {
    return null;
  }
  if (typeof pending === "string") {
    return pending;
  }
  if (typeof pending === "object") {
    const prompt =
      pending.prompt ||
      pending.question ||
      pending.text ||
      pending.label ||
      null;
    const options = pending.options || pending.choices || pending.routes;
    const parts = [];
    if (prompt) parts.push(String(prompt));
    if (Array.isArray(options) && options.length) {
      parts.push(
        "Options:\n" +
          options
            .map((opt, i) => {
              if (typeof opt === "string") return `  ${i + 1}. ${opt}`;
              if (opt && typeof opt === "object") {
                const label =
                  opt.label || opt.text || opt.id || JSON.stringify(opt);
                return `  ${i + 1}. ${label}`;
              }
              return `  ${i + 1}. ${String(opt)}`;
            })
            .join("\n"),
      );
    } else {
      parts.push(JSON.stringify(pending));
    }
    return parts.join("\n");
  }
  return String(pending);
}

function buildPromptText(request) {
  const playLanguage =
    (request.public_state && request.public_state.play_language) || "zh-Hans";
  const pendingText = formatPendingChoice(
    request.pending_choice !== undefined
      ? request.pending_choice
      : request.public_state && request.public_state.pending_choice,
  );

  const sections = [
    `Play language for player_text: ${playLanguage}`,
    "",
    "## Narration (verbatim)",
    String(request.narration ?? ""),
    "",
    "## Public state",
    summarizePublicState(request.public_state),
    "",
    "## Your character card (summary)",
    summarizeCharacterCard(request.character_card),
    "",
    "## Recent transcript",
    formatTranscript(request.transcript_tail),
  ];

  if (pendingText) {
    sections.push(
      "",
      "## Pending choice — answer this explicitly in your action",
      pendingText,
    );
  }

  sections.push(
    "",
    "Call coc_player_action exactly once with one concrete in-character action.",
  );
  return sections.join("\n");
}

function extractAssistantProse(messages) {
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

function withRuntimeProvenance(result, modelIdentity, responseMode) {
  const enriched = { ...result, response_mode: responseMode };
  if (modelIdentity) enriched.model_identity = modelIdentity;
  return enriched;
}

function normalizeIntentClass(value) {
  if (typeof value !== "string") return undefined;
  return INTENT_CLASSES.includes(value) ? value : undefined;
}

function buildPlayerActionTool(holder) {
  const intentUnion = Type.Union(
    INTENT_CLASSES.map((v) => Type.Literal(v)),
    {
      description:
        "Optional canonical intent class (structured semantic evidence).",
    },
  );

  return defineTool({
    name: "coc_player_action",
    label: "COC Player Action",
    description:
      "Submit this turn's investigator action. Call exactly once with " +
      "in-character player_text in the campaign play_language.",
    promptSnippet: "Submit the investigator's one concrete action for this turn",
    promptGuidelines: [
      "Always call coc_player_action exactly once.",
      "player_text must be in-character action or dialogue only.",
      "Do not invent dice rolls, skill values, or rule math.",
      "Do not ask for keeper secrets.",
      "After coc_player_action returns, stop.",
    ],
    parameters: Type.Object({
      player_text: Type.Optional(Type.String({
        description:
          "In-character action or dialogue; optional only when answering the canonical pending choice.",
      })),
      intent_class: Type.Optional(intentUnion),
      player_notes: Type.Optional(
        Type.String({
          description:
            "Optional out-of-character reasoning for the battle report only.",
        }),
      ),
      pending_choice_response: Type.Optional(
        Type.Object({
          choice_id: Type.String(),
          responder: Type.Literal("player"),
          revision: Type.Integer({ minimum: 0 }),
          action: Type.String(),
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const capture = holder.capture;
      const pendingChoice = holder.pendingChoice;
      capture.usedTool = true;
      const playerText =
        typeof params.player_text === "string" ? params.player_text.trim() : "";
      const hasPlayerChoice = pendingChoice && pendingChoice.responder === "player";
      if (!playerText && !hasPlayerChoice) {
        capture.error = "coc_player_action missing non-empty player_text";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: capture.error }),
            },
          ],
          details: { error: capture.error },
          terminate: true,
        };
      }
      const result = { ok: true, player_text: playerText };
      const intent = normalizeIntentClass(params.intent_class);
      if (intent) result.intent_class = intent;
      if (
        typeof params.player_notes === "string" &&
        params.player_notes.trim()
      ) {
        result.player_notes = params.player_notes.trim();
      }
      if (pendingChoice && pendingChoice.responder === "player") {
        const response = params.pending_choice_response;
        const allowedActions = Array.isArray(pendingChoice.options)
          ? pendingChoice.options
              .filter((option) => option && typeof option === "object")
              .map((option) => option.action)
              .filter((action) => typeof action === "string")
          : [];
        if (
          !response ||
          response.choice_id !== pendingChoice.choice_id ||
          response.responder !== "player" ||
          response.revision !== pendingChoice.revision ||
          !allowedActions.includes(response.action)
        ) {
          capture.error =
            "pending_choice_response does not match the canonical player choice";
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: capture.error }) }],
            details: { error: capture.error },
            terminate: true,
          };
        }
        result.pending_choice_response = { ...response };
      } else if (params.pending_choice_response !== undefined) {
        capture.error = "pending_choice_response supplied without a player choice";
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: capture.error }) }],
          details: { error: capture.error },
          terminate: true,
        };
      }
      capture.result = result;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, received: true }),
          },
        ],
        details: result,
        terminate: true,
      };
    },
  });
}

export async function runPlayerTurn(request, serverState = null) {
  const required = [
    "public_state",
    "narration",
    "character_card",
    "transcript_tail",
    "pending_choice",
  ];
  for (const key of required) {
    if (!(key in request)) {
      throw new Error(`request missing ${key}`);
    }
  }

  const pendingChoice =
    request.pending_choice !== undefined
      ? request.pending_choice
      : request.public_state && request.public_state.pending_choice;
  if (pendingChoice && pendingChoice.responder === "keeper") {
    throw new Error("Keeper pending choices must not be sent to the player brain");
  }
  const capture = {
    usedTool: false,
    result: null,
    error: null,
    assistantProse: "",
  };
  const holder = serverState || { capture, pendingChoice };
  holder.capture = capture;
  holder.pendingChoice = pendingChoice;
  const tool = serverState?.tool || buildPlayerActionTool(holder);
  const cwd = __dirname;
  const agentDir = getAgentDir();

  let session = serverState?.session;
  let ownsSession = false;
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => SYSTEM_PROMPT,
    extensionsOverride: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
  });
  if (!session) {
    await loader.reload();
    const created = await createAgentSession({
      cwd, agentDir, tools: ["coc_player_action"], customTools: [tool],
      resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd),
    });
    session = created.session;
    ownsSession = true;
    if (serverState) {
      serverState.session = session;
      serverState.tool = tool;
    }
  }

  let modelIdentity;

  try {
    session.subscribe((event) => {
      if (event && event.type === "message_end" && event.message) {
        const msg = event.message;
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const texts = msg.content
            .filter((c) => c && c.type === "text" && typeof c.text === "string")
            .map((c) => c.text.trim())
            .filter(Boolean);
          if (texts.length) {
            capture.assistantProse = texts.join("\n").trim();
          }
        }
      }
    });

    await session.prompt(buildPromptText(request));

    if (!capture.assistantProse) {
      capture.assistantProse = extractAssistantProse(session.messages);
    }
    modelIdentity = selectedModelIdentity(session);
  } finally {
    if (ownsSession && !serverState) session.dispose();
  }

  if (capture.usedTool) {
    if (capture.result && capture.result.ok) {
      return withRuntimeProvenance(capture.result, modelIdentity, "tool");
    }
    return {
      ok: false,
      error: capture.error || "coc_player_action invoked but produced no result",
    };
  }

  if (pendingChoice && pendingChoice.responder === "player") {
    return {
      ok: false,
      error: "player pending choice requires typed pending_choice_response",
    };
  }

  // Prose degradation: usable player_text, marked in player_notes.
  const prose = (capture.assistantProse || "").trim();
  if (prose) {
    return withRuntimeProvenance({
      ok: true,
      player_text: prose,
      player_notes: PROSE_DEGRADE_NOTE,
    }, modelIdentity, "prose_fallback");
  }

  return {
    ok: false,
    error: "model returned neither coc_player_action nor usable prose",
  };
}

async function main() {
  try {
    const request = await readStdinJson();
    const result = await runPlayerTurn(request);
    writeResult(result);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    writeResult({ ok: false, error: message });
    process.exit(1);
  }
}

async function serveJsonl() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const serverState = {};
  for await (const line of lines) {
    let envelope;
    try {
      envelope = JSON.parse(line);
      if (!envelope || typeof envelope !== "object" || typeof envelope.request_id !== "string") {
        throw new Error("server request requires request_id");
      }
      const result = await runPlayerTurn(envelope.payload, serverState);
      writeResult({ request_id: envelope.request_id, ...result });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      writeResult({ request_id: envelope && envelope.request_id, ok: false, error: message });
    }
  }
  if (serverState.session) serverState.session.dispose();
}

if (process.argv.includes("--server")) {
  serveJsonl().catch((err) => {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
} else {
  main();
}
