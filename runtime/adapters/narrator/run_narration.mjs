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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  "必须声明 final_text 使用到的 asserted_fact_refs；semantic_audit 必须对每个" +
  " asserted_fact_ref × must_not_reveal.id 组合恰好给出一条" +
  " same_fact/different_fact/uncertain 与非空 reason，不能遗漏、重复或增加组合。" +
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
  function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return value;
    const safe = {};
    for (const [key, item] of Object.entries(value)) {
      if (["rationale", "keeper_secrets", "director_rationale"].includes(key)) continue;
      safe[key] = sanitize(item);
    }
    return safe;
  }
  const safe = sanitize(envelope);
  try {
    return JSON.stringify(safe, null, 2);
  } catch {
    return String(envelope);
  }
}

function jsonPointerToken(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

export function buildAllowedAssertionMap(envelope) {
  const result = {};
  const omitted = new Set([
    "must_not_reveal",
    "rationale",
    "keeper_secrets",
    "director_rationale",
  ]);

  function visit(value, pathParts) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    if (value && typeof value === "object") {
      for (const key of Object.keys(value).sort()) {
        if (!omitted.has(key)) visit(value[key], [...pathParts, key]);
      }
      return;
    }
    if (!["string", "number", "boolean"].includes(typeof value) && value !== null) {
      return;
    }
    const pointer = `/${pathParts.map(jsonPointerToken).join("/")}`;
    result[`envelope:${pointer}`] = { path: pointer, value };
  }

  if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
    visit(envelope, []);
  }
  return result;
}

function forbiddenRefsFromEnvelope(envelope) {
  const rows = envelope && Array.isArray(envelope.must_not_reveal)
    ? envelope.must_not_reveal : [];
  const refs = [];
  for (const row of rows) {
    const ref = row && typeof row === "object" && typeof row.id === "string"
      ? row.id.trim() : "";
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  return refs.sort();
}

export function validateNarrationSubmission(params, allowedAssertionMap, forbiddenRefs) {
  if (!params || typeof params !== "object") {
    throw new Error("narration submission must be an object");
  }
  const finalText = typeof params.final_text === "string"
    ? params.final_text.trim() : "";
  if (!finalText) throw new Error("narration submission requires final_text");
  if (!Array.isArray(params.asserted_fact_refs)) {
    throw new Error("asserted_fact_refs must be an array");
  }
  const asserted = [];
  for (const raw of params.asserted_fact_refs) {
    if (typeof raw !== "string" || !raw.trim() || raw !== raw.trim()) {
      throw new Error("asserted_fact_refs must contain exact non-empty strings");
    }
    if (!Object.hasOwn(allowedAssertionMap, raw)) {
      throw new Error(`asserted_fact_refs contains an unknown allowed assertion ref: ${raw}`);
    }
    if (asserted.includes(raw)) {
      throw new Error("asserted_fact_refs contains a duplicate allowed assertion ref");
    }
    asserted.push(raw);
  }
  if (!Array.isArray(params.semantic_audit)) {
    throw new Error("semantic audit must be an array");
  }
  const forbidden = Array.isArray(forbiddenRefs) ? [...forbiddenRefs] : [];
  const expected = new Set(
    asserted.flatMap((assertedRef) => forbidden.map(
      (forbiddenRef) => JSON.stringify([assertedRef, forbiddenRef]),
    )),
  );
  const observed = new Set();
  const semanticAudit = [];
  for (const raw of params.semantic_audit) {
    if (
      !raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).sort().join(",") !==
        "asserted_ref,decision,forbidden_ref,reason"
    ) {
      throw new Error("semantic audit record shape is invalid");
    }
    const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
    const pair = JSON.stringify([raw.asserted_ref, raw.forbidden_ref]);
    if (!expected.has(pair)) throw new Error("semantic audit contains an extra pair");
    if (observed.has(pair)) throw new Error("semantic audit contains a duplicate pair");
    if (raw.decision !== "different_fact" || !reason) {
      throw new Error("semantic audit decision is unsafe or lacks a reason");
    }
    observed.add(pair);
    semanticAudit.push({
      asserted_ref: raw.asserted_ref,
      forbidden_ref: raw.forbidden_ref,
      decision: raw.decision,
      reason,
    });
  }
  if (observed.size !== expected.size) {
    throw new Error("semantic audit is missing an asserted × forbidden pair");
  }
  return {
    ok: true,
    final_text: finalText,
    secret_audit_complete: true,
    asserted_fact_refs: asserted,
    semantic_audit: semanticAudit,
  };
}

function formatClueSummaries(envelope) {
  const reveals = envelope && envelope.approved_reveals;
  if (!reveals || typeof reveals !== "object") return "(none)";
  const clues = Array.isArray(reveals.clues) ? reveals.clues : [];
  const lines = clues
    .map((c) => {
      if (!c || typeof c !== "object") return "";
      const id = c.clue_id || "";
      const summary = String(c.player_safe_summary || "").trim();
      if (!summary) return id ? `- ${id}` : "";
      return id ? `- ${id}: ${summary}` : `- ${summary}`;
    })
    .filter(Boolean);
  const must = Array.isArray(reveals.must_include) ? reveals.must_include : [];
  for (const item of must) {
    const text =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object"
          ? String(item.cue || item.text || item.summary || "").trim()
          : "";
    if (text) lines.push(`- must_include: ${text}`);
  }
  return lines.length ? lines.join("\n") : "(none)";
}

function formatRuleResults(envelope) {
  const results = envelope && Array.isArray(envelope.rule_results)
    ? envelope.rule_results
    : [];
  if (!results.length) return "(none — no settled rolls this turn)";
  return results
    .map((r, i) => {
      if (!r || typeof r !== "object") return "";
      const who = r.investigator_display_name || "investigator";
      const skill = r.skill || "check";
      const outcome = r.outcome || (r.success ? "success" : "failure");
      const parts = [`[${i + 1}] ${who} · ${skill} → ${outcome}`];
      if (r.player_visible_cost) {
        parts.push(`cost: ${r.player_visible_cost}`);
      }
      if (r.bonus_reveal) {
        parts.push(`bonus: ${r.bonus_reveal}`);
      }
      if (r.san_loss != null) {
        parts.push(`SAN loss: ${r.san_loss}`);
      }
      return parts.join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

function formatSceneAnchor(envelope) {
  const anchor = envelope && envelope.scene_anchor;
  if (!anchor || typeof anchor !== "object") return "(none)";
  const lines = [];
  if (anchor.display_name) lines.push(`Location: ${anchor.display_name}`);
  if (anchor.scene_id) lines.push(`scene_id: ${anchor.scene_id}`);
  const sensory = Array.isArray(anchor.sensory_anchors)
    ? anchor.sensory_anchors.filter(Boolean)
    : [];
  if (sensory.length) lines.push(`Sensory anchors: ${sensory.join("; ")}`);
  const tags = Array.isArray(anchor.location_tags)
    ? anchor.location_tags.filter(Boolean)
    : [];
  if (tags.length) lines.push(`Location tags: ${tags.join(", ")}`);
  return lines.length ? lines.join("\n") : "(none)";
}

function formatNpcSeeds(envelope) {
  const moves = envelope && Array.isArray(envelope.npc_moves)
    ? envelope.npc_moves
    : [];
  if (!moves.length) return "(none)";
  return moves
    .map((m) => {
      if (!m || typeof m !== "object") return "";
      const name = m.display_name || m.npc_id || "NPC";
      const seed = String(m.dialogue_seed || m.emotional_tone || "").trim();
      const secretNote = m.has_secret ? " (has unspoken secret — do not reveal)" : "";
      return seed
        ? `- ${name}${secretNote}: ${seed}`
        : `- ${name}${secretNote}`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatRedirection(envelope) {
  const redir = envelope && envelope.redirection;
  if (!redir || typeof redir !== "object") return "(none — on-track; no redirection)";
  const strategy = String(redir.strategy || "").trim();
  const grounding =
    redir.grounding && typeof redir.grounding === "object" ? redir.grounding : {};
  const lines = [`Selected strategy: ${strategy || "(unspecified)"}`];
  if (strategy === "in_world_consequences") {
    lines.push(
      "Instruction: ALLOW the attempted action to happen in fiction, then narrate",
      "believable world fallout. Do not flatly refuse. Never use hard_denial.",
    );
    if (grounding.boundary_id) lines.push(`Boundary id: ${grounding.boundary_id}`);
    if (grounding.category) lines.push(`Category: ${grounding.category}`);
    if (grounding.consequence_hint) {
      lines.push(`Consequence hint: ${grounding.consequence_hint}`);
    }
  } else if (strategy === "npc_influence") {
    const who = grounding.display_name || grounding.npc_id || "a present NPC";
    lines.push(
      `Instruction: Have ${who} caution, challenge, or appeal in character`,
      "to redirect the player without OOC refusal. Never use hard_denial.",
    );
    if (grounding.npc_id) lines.push(`npc_id: ${grounding.npc_id}`);
    if (grounding.display_name) lines.push(`display_name: ${grounding.display_name}`);
  } else if (strategy === "more_information") {
    lines.push(
      "Instruction: Reveal an environmental or knowledge cue that clarifies",
      "options and gently reorients play. Never flatly refuse the player.",
      "Never use hard_denial.",
    );
    if (grounding.scene_id) lines.push(`scene_id: ${grounding.scene_id}`);
    if (grounding.clue_id) lines.push(`clue_id: ${grounding.clue_id}`);
  } else {
    lines.push(
      "Instruction: Redirect in-fiction without hard_denial; never flatly refuse.",
    );
  }
  return lines.join("\n");
}

function formatRenderContract(envelope) {
  const mode = String(envelope?.render_mode || "investigation");
  const frame = envelope?.render_frame;
  const profile = envelope?.horror_profile;
  const rows = [`render_mode: ${mode}`];
  if (frame && typeof frame === "object") {
    rows.push(`render_frame: ${JSON.stringify(frame)}`);
  }
  if (profile && typeof profile === "object") {
    rows.push(`horror_profile: ${JSON.stringify(profile)}`);
  }
  return rows.join("\n");
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
  const envelope = request.narration_envelope || {};
  const allowedAssertionMap = buildAllowedAssertionMap(envelope);
  const sections = [
    `Play language for final_text: ${playLanguage}`,
    "",
    "## Last player action",
    String(request.last_player_text ?? "(none)"),
    "",
    "## Scene anchor (location + sensory)",
    formatSceneAnchor(envelope),
    "",
    "## Approved clue reveals (weave player_safe_summary into prose)",
    formatClueSummaries(envelope),
    "",
    "## Settled rule_results (narrate fictional consequences; no dice math)",
    formatRuleResults(envelope),
    "",
    "## NPC dialogue seeds (keep character voice; do not reveal secrets)",
    formatNpcSeeds(envelope),
    "",
    "## Narrative redirection (explicit strategy; never hard_denial)",
    formatRedirection(envelope),
    "",
    "## Render mode and bounded horror profile",
    formatRenderContract(envelope),
    "",
    "## Narration envelope (player-safe; do not invent beyond this)",
    summarizeEnvelope(envelope),
    "",
    "## Allowed assertion refs (closed set; use only exact keys below)",
    JSON.stringify(allowedAssertionMap, null, 2),
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

function buildNarrationTool(holder) {
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
      "Use only exact keys from the current Allowed assertion refs map.",
      "semantic_audit must exactly cover asserted refs × forbidden refs.",
      "Do not menu-dump choice cues.",
      "After coc_keeper_narration returns, stop.",
    ],
    parameters: Type.Object({
      final_text: Type.String({
        description:
          "Required player-visible KP narration in the campaign play_language.",
      }),
      asserted_fact_refs: Type.Array(Type.String(), {
        description: "Structured fact ids asserted by final_text; empty when none.",
      }),
      semantic_audit: Type.Array(Type.Object({
        asserted_ref: Type.String(),
        forbidden_ref: Type.String(),
        decision: Type.Union([
          Type.Literal("same_fact"), Type.Literal("different_fact"),
          Type.Literal("uncertain"),
        ]),
        reason: Type.String(),
      }), {description: "Exactly one semantic-router record for every asserted_fact_refs × must_not_reveal.id pair."}),
      notes: Type.Optional(
        Type.String({
          description: "Optional out-of-character notes for the battle report only.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const capture = holder.capture;
      capture.usedTool = true;
      let result;
      try {
        result = validateNarrationSubmission(
          params,
          holder.contract.allowedAssertionMap,
          holder.contract.forbiddenRefs,
        );
      } catch (error) {
        capture.error = error && error.message ? error.message : String(error);
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

export async function runNarration(request, serverState = null) {
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
  const holder = serverState || { capture };
  holder.capture = capture;
  holder.contract = {
    allowedAssertionMap: buildAllowedAssertionMap(request.narration_envelope),
    forbiddenRefs: forbiddenRefsFromEnvelope(request.narration_envelope),
  };
  const tool = serverState?.tool || buildNarrationTool(holder);
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
  let session = serverState?.session;
  let ownsSession = false;
  if (!session) {
    await loader.reload();
    const created = await createAgentSession({
      cwd, agentDir, tools: ["coc_keeper_narration"], customTools: [tool],
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
      error: capture.error || "coc_keeper_narration invoked but produced no result",
    };
  }

  const prose = (capture.assistantProse || "").trim();
  if (prose) {
    return withRuntimeProvenance({
      ok: true,
      final_text: prose,
      notes: PROSE_DEGRADE_NOTE,
    }, modelIdentity, "prose_fallback");
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
      const result = await runNarration(envelope.payload, serverState);
      writeResult({ request_id: envelope.request_id, ...result });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      writeResult({ request_id: envelope && envelope.request_id, ok: false, error: message });
    }
  }
  if (serverState.session) serverState.session.dispose();
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isEntrypoint) {
  if (process.argv.includes("--server")) {
    serveJsonl().catch((err) => {
      process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
  } else {
    main();
  }
}
