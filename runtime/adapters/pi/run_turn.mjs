#!/usr/bin/env node
/**
 * Constrained Pi Coding Agent bridge for one COC live turn.
 *
 * stdin:  one JSON request object
 * stdout: { ok: true, events: [...] } | { ok: false, error: "..." }
 *
 * V1 is stateless per process; session continuity lives in .coc/ + Python.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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
const CALL_DEBUG = path.join(__dirname, "call_debug.py");

// typebox is nested under pi-coding-agent; resolve via that package.
const require = createRequire(
  path.join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json"),
);
const { Type } = require("typebox");

const SYSTEM_PROMPT =
  "You are the COC Keeper runtime brain. Prefer calling the provided " +
  "coc_live_turn tool. Return only structured results via the tool; " +
  "do not invent rule math.";

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

function missingToolUseEvent(message) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    type: "error",
    id: `evt_pi_missing_${Date.now().toString(16)}`,
    ts,
    visibility: "system",
    payload: {
      kind: "pi_missing_tool_use",
      message: message || "model returned prose without coc_live_turn",
    },
  };
}

function runCallDebug(request) {
  return new Promise((resolve, reject) => {
    const args = [
      CALL_DEBUG,
      "--workspace",
      String(request.workspace),
      "--campaign-id",
      String(request.campaign_id),
      "--investigator-id",
      String(request.investigator_id),
      "--character-path",
      String(request.character_path),
      "--player-text",
      String(request.player_text ?? ""),
    ];
    const child = spawn("python3", args, {
      cwd: __dirname,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const text = stdout.trim();
      if (!text) {
        reject(
          new Error(
            stderr.trim() || `call_debug.py exited ${code} with empty stdout`,
          ),
        );
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        reject(new Error(`call_debug.py stdout not JSON: ${text.slice(0, 200)}`));
        return;
      }
      if (!parsed.ok) {
        reject(new Error(parsed.error || "call_debug failed"));
        return;
      }
      if (!Array.isArray(parsed.events)) {
        reject(new Error("call_debug.py missing events array"));
        return;
      }
      resolve(parsed.events);
    });
  });
}

function buildCocLiveTurnTool(request, capture) {
  return defineTool({
    name: "coc_live_turn",
    label: "COC Live Turn",
    description:
      "Run one COC live turn through the Python debug path and return " +
      "structured Event objects. Call this once with the player's action text.",
    promptSnippet: "Execute the COC live turn and return structured events",
    promptGuidelines: [
      "Always call coc_live_turn exactly once for the player's action.",
      "Do not invent dice rolls, skill values, or rule math yourself.",
      "After coc_live_turn returns, stop; do not emit free-form keeper prose as the result.",
    ],
    parameters: Type.Object({
      player_text: Type.Optional(
        Type.String({
          description:
            "Player action text. Defaults to the turn request player_text when omitted.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const turnRequest = {
        ...request,
        player_text:
          typeof params.player_text === "string" && params.player_text.length > 0
            ? params.player_text
            : request.player_text,
      };
      const events = await runCallDebug(turnRequest);
      capture.events = events;
      capture.usedTool = true;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, event_count: events.length }),
          },
        ],
        details: { events },
        terminate: true,
      };
    },
  });
}

async function runTurn(request) {
  const required = [
    "workspace",
    "campaign_id",
    "investigator_id",
    "character_path",
    "player_text",
  ];
  for (const key of required) {
    if (request[key] === undefined || request[key] === null) {
      throw new Error(`request missing ${key}`);
    }
  }

  const capture = { usedTool: false, events: null };
  const cwd = String(request.workspace);
  const tool = buildCocLiveTurnTool(request, capture);

  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => SYSTEM_PROMPT,
    // Avoid pulling project extensions that might register write/edit tools.
    extensionsOverride: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    tools: ["coc_live_turn"],
    customTools: [tool],
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
  });

  try {
    // Silence interactive noise; we only care about the tool result.
    session.subscribe(() => {});

    const promptText =
      `Player action for campaign ${request.campaign_id} / investigator ` +
      `${request.investigator_id}:\n${request.player_text}\n\n` +
      `Call coc_live_turn now.`;

    await session.prompt(promptText);
  } finally {
    session.dispose();
  }

  if (capture.usedTool && Array.isArray(capture.events)) {
    return { ok: true, events: capture.events };
  }

  return {
    ok: true,
    events: [
      missingToolUseEvent("model returned prose without coc_live_turn"),
    ],
  };
}

async function main() {
  try {
    const request = await readStdinJson();
    const result = await runTurn(request);
    writeResult(result);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    writeResult({ ok: false, error: message });
    process.exit(1);
  }
}

main();
