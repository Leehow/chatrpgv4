#!/usr/bin/env node
/**
 * Constrained Pi Coding Agent bridge for one COC KP narrator turn.
 *
 * stdin:  player-safe JSON request
 *   {narration_envelope, last_player_text, play_language, recent_narrations}
 * stdout: { ok: true, final_text, notes? }
 *      or { ok: false, error: "..." }
 *
 * V1 is stateless per process; match continuity lives in coc_live_match.py.
 *
 * Prose degradation:
 *   If the model replies in free text without calling coc_keeper_narration,
 *   wrap that prose as final_text and set notes to a narrator_missing_tool_use
 *   marker rather than failing the turn.
 */
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

const require = createRequire(
  path.join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json"),
);
const { Type } = require("typebox");

const PROSE_DEGRADE_NOTE =
  "narrator_missing_tool_use: model returned prose without coc_keeper_narration";

const SYSTEM_PROMPT =
  "你是跑团桌上的 KP 叙述者（Call of Cthulhu Keeper narrator）。" +
  "根据给定的 narration_envelope 与玩家上一句行动，写出玩家可见的场景叙述。" +
  "用战役 play_language 写作（默认简体中文）。写 2–6 个短句。" +
  "用具体感官细节；先写可观察的行为与环境，再写必要的解读（show, don't tell）。" +
  "NPC 对白保持角色口吻。" +
  "绝不要把 choice_frame / 可行动线索列成菜单或编号清单；最多把 2–3 个 affordance " +
  "织进虚构感知或钩子（例如你留意到……；……也许也值得一看）。" +
  "禁止记账式套话：「基于以上信息」「这表明」「这说明」「你确认了线索」" +
  "「现场同时露出这些可行动线索」以及类似日志/摘要腔。" +
  "不得发明 envelope 中没有的掷骰、规则结果或隐藏事实。" +
  "不得揭示 must_not_reveal 中的任何 id/category 所指内容。" +
  "若 envelope 含 rules_requests / 已批准揭示，用虚构后果叙述检定结果，不要报骰面或技能名堆砌。" +
  "优先调用 coc_keeper_narration 一次提交 final_text。";

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

function summarizeEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    return "(empty envelope)";
  }
  // Send structured JSON; rationale already stripped by the Python adapter.
  const safe = { ...envelope };
  delete safe.rationale;
  delete safe.keeper_secrets;
  delete safe.director_rationale;
  try {
    return JSON.stringify(safe, null, 2);
  } catch {
    return String(envelope);
  }
}

function formatRecent(recent) {
  if (!Array.isArray(recent) || recent.length === 0) {
    return "(none)";
  }
  return recent
    .slice(-2)
    .map((t, i) => `[${i + 1}] ${String(t || "").trim()}`)
    .filter((line) => line.length > 4)
    .join("\n");
}

function buildPromptText(request) {
  const playLanguage = request.play_language || "zh-Hans";
  const sections = [
    `Play language for final_text: ${playLanguage}`,
    "",
    "## Last player action",
    String(request.last_player_text ?? "(none)"),
    "",
    "## Narration envelope (player-safe; do not invent beyond this)",
    summarizeEnvelope(request.narration_envelope),
    "",
    "## Recent narrations (vary wording; do not repeat)",
    formatRecent(request.recent_narrations),
    "",
    "Call coc_keeper_narration exactly once with 2–6 short sentences of tabletop prose.",
  ];
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

function buildNarrationTool(capture) {
  return defineTool({
    name: "coc_keeper_narration",
    label: "COC Keeper Narration",
    description:
      "Submit this turn's player-visible KP narration. Call exactly once with " +
      "final_text in the campaign play_language.",
    promptSnippet: "Submit the KP's player-visible narration for this turn",
    promptGuidelines: [
      "Always call coc_keeper_narration exactly once.",
      "final_text must be in-fiction tabletop prose only.",
      "Do not invent dice rolls, skill values, or rule math.",
      "Do not reveal must_not_reveal contents.",
      "Do not menu-dump choice cues.",
      "After coc_keeper_narration returns, stop.",
    ],
    parameters: Type.Object({
      final_text: Type.String({
        description:
          "Required player-visible KP narration in the campaign play_language.",
      }),
      notes: Type.Optional(
        Type.String({
          description: "Optional out-of-character notes for the battle report only.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      capture.usedTool = true;
      const finalText =
        typeof params.final_text === "string" ? params.final_text.trim() : "";
      if (!finalText) {
        capture.error = "coc_keeper_narration missing non-empty final_text";
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
      const result = { ok: true, final_text: finalText };
      if (typeof params.notes === "string" && params.notes.trim()) {
        result.notes = params.notes.trim();
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

async function runNarration(request) {
  const required = [
    "narration_envelope",
    "last_player_text",
    "play_language",
    "recent_narrations",
  ];
  for (const key of required) {
    if (!(key in request)) {
      throw new Error(`request missing ${key}`);
    }
  }

  const capture = {
    usedTool: false,
    result: null,
    error: null,
    assistantProse: "",
  };
  const tool = buildNarrationTool(capture);
  const cwd = __dirname;
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
    tools: ["coc_keeper_narration"],
    customTools: [tool],
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
  });

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
  } finally {
    session.dispose();
  }

  if (capture.usedTool) {
    if (capture.result && capture.result.ok) {
      return capture.result;
    }
    return {
      ok: false,
      error: capture.error || "coc_keeper_narration invoked but produced no result",
    };
  }

  const prose = (capture.assistantProse || "").trim();
  if (prose) {
    return {
      ok: true,
      final_text: prose,
      notes: PROSE_DEGRADE_NOTE,
    };
  }

  return {
    ok: false,
    error: "model returned neither coc_keeper_narration nor usable prose",
  };
}

async function main() {
  try {
    const request = await readStdinJson();
    const result = await runNarration(request);
    writeResult(result);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    writeResult({ ok: false, error: message });
    process.exit(1);
  }
}

main();
