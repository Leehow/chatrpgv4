#!/usr/bin/env node
/**
 * Constrained Pi Coding Agent bridge for one COC KP narrator turn.
 *
 * stdin:  player-safe JSON request
 *   {narration_envelope, last_player_text, play_language, recent_narrations,
 *    public_transcript_tail?}
 * stdout: { ok: true, final_text, notes? }
 *      or { ok: false, error: "..." }
 *
 * V1 is stateless per process; the production caller owns session continuity.
 * Direct GLM Chat Completions uses provider-supported thinking-disabled JSON
 * mode; accepted prose is independently checked by coding-relay/gpt-5.6-sol.
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
  ModelRuntime,
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

export async function resolveRequestedModel({ agentDir, provider, modelId }) {
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });
  let model = modelRuntime.getModel(provider, modelId);
  if (!model && (provider === "coding-relay" || provider === "cursor-relay")) {
    const template = modelRuntime
      .getModels(provider)
      .find(
        (candidate) => modelRuntime.hasConfiguredAuth(candidate.provider),
      );
    if (template) {
      model = { ...template, id: modelId, name: modelId };
    }
  }
  if (!model || !modelRuntime.hasConfiguredAuth(model.provider)) {
    throw new Error(`requested model unavailable: ${provider}/${modelId}`);
  }
  return { model, modelRuntime };
}

const AUTHORIZED_RENDERING_EQUIVALENCE_POLICY =
  "Rendering-equivalence policy: when structured authority already settles transfer or " +
  "disclosure of exact content, a non-durable, non-actionable carrier or gesture used solely " +
  "to stage that same authorized transfer/content is not an additional plot_object_state claim, " +
  "provided it adds no independent contents, inspectability, route, availability, possession " +
  "continuity, or continuing object state. Likewise, when a completed action_outcome already " +
  "settles an agreement/action, brief dialogue or gesture that only acknowledges or enacts that " +
  "same settlement is not a new agreement claim, provided it adds no new terms, permission, " +
  "promise, answer, or relationship. A player-requested independent document/object remains " +
  "unsupported unless structured authority or prior Keeper-visible continuity establishes it.";

const SYSTEM_PROMPT =
  "你是跑团桌上的 KP 叙述者（Call of Cthulhu Keeper narrator）。" +
  "根据给定的 narration_envelope 与玩家上一句行动，写出玩家可见的场景叙述。" +
  "keeper_plan 是私有 KP 已裁定后的非事实性导演提示：优先遵循其中的 beat、npc_tactic 与 end_with，" +
  "让回应像真人 KP 在接住玩家意图，而不是重新列出可选路线。keeper_plan 本身不授权任何事实、" +
  "线索、许可、物品或状态变化；这些仍只能来自专门的 approved/action/state 字段。" +
  "用战役 play_language 写作（默认简体中文）。写 2–6 个短句。" +
  "用具体感官细节；先写可观察的行为与环境，再写必要的解读（show, don't tell）。" +
  "感官布景只能是不会改变状态的气氛细节；不得借布景新增可互动的文件、钥匙、证物或线索，" +
  "也不得暗示 envelope 未记录的物品交接、承诺、关系、地点变化或调查结论。" +
  "NPC 对白保持角色口吻。" +
  "绝不要把 choice_frame / 可行动线索列成菜单或编号清单；最多把 2–3 个 affordance " +
  "织进虚构感知或钩子（例如你留意到……；……也许也值得一看）。" +
  "choice_frame 中 cue_scope=action_only 的内容只授权你提示玩家可以采取或询问该行动；" +
  "必须把它改写成尚可尝试的未来/可能行动，绝不能照抄成已完成句；" +
  "它不授权你把取得同意、进入地点、找到对象、物品交接、NPC 回答、线索内容或路线完成" +
  "写成已经发生。规则检定成功本身只授权写‘检定通过’，不授权取得许可、线索、NPC 同意、" +
  "物品或路线完成；这些状态结果必须来自 completed action_outcomes、approved_reveals " +
  "或 state_grounding 明确提交的状态才可写成既成结果。" +
  "若本回合没有新的 approved fact，可写玩家尝试中不改变状态的可观察动作、NPC 的语气/姿态、" +
  "无害环境细节，以及结构化 npc_moves / pressure_moves 已授权的自然后果；不得新增许可、禁令、" +
  "物品持有变化、NPC 回答或线索内容。不要因此退化成空洞套话，应优先使用已授权的 NPC 与压力材料。" +
  "recent_narrations / public_transcript_tail 只可延续此前 KP 已对玩家公开的地点、" +
  "在场人物等连续性事实；其中玩家发言仍只算行动声明或尝试。" +
  "它不能授权本回合新的许可、回答、交接或状态变化。" +
  "state_grounding.present_npc_names 以及抵达场景后的可行动 NPC 只授权该人物此刻在场；" +
  "它们不授权任何先前 NPC 知道、认识、推荐、引用该人物，也不授权两人之间的职务、关系、" +
  "对白或消息传递。只有 envelope 中明确的结构化 relationship/knowledge ref、approved_reveal、" +
  "completed action_outcome 或 npc_move dialogue_seed 才能写这些关系与知识。" +
  "所有 *_id、scene_id、route_id、npc_id 和 location tag 都是机器字段，绝不能原样写进 final_text；" +
  "地点只使用 scene_anchor.display_name，若它是通用当前地点就保持通用表述。" +
  "玩家在请求、问题或行动声明中提到的特定物件/文件，只是玩家假设的行动目标；" +
  "除非结构化权威或先前 KP 公开叙述已确认，否则不得写它存在、在场、可用、被持有、" +
  "取出、移动、放置、打开、交付或可供检查。即使只是 NPC 的一个小动作也不能绕过这条规则。" +
  "但若结构化结果已经明确结算了某项内容的交付/公开，可以用不产生独立内容、可检查性、" +
  "新路线、持续持有或后续物件状态的临时载体/手势来表现同一件事；若结构化 action_outcome" +
  " 已结算协议或行动，也可用不增加新条件、许可、承诺、回答或关系的简短对白/动作来确认。" +
  "禁止记账式套话：「基于以上信息」「这表明」「这说明」「你确认了线索」" +
  "「现场同时露出这些可行动线索」以及类似日志/摘要腔。" +
  "不得发明 envelope 中没有的掷骰、规则结果或隐藏事实。" +
  "必须遵守 state_grounding：只有 scene_transition_committed=true 才能写调查员已抵达" +
  " active_scene_after_id；否则只能写行动尝试、受阻或仍在当前地点，不能凭玩家宣称就搬场，" +
  "也不能引入别处才可观察的物件、NPC 或事实。" +
  "不得揭示 must_not_reveal 中的任何 id/category 所指内容。" +
  "approved_reveals 中本回合批准的 player_safe_summary 与 must_include 是权威公开事实；" +
  "final_text 必须保持其中的数字、专名和事实关系，不得因为玩家提出了不同说法就覆盖它们，" +
  "除非 envelope 明确记录了改变该事实的结算结果。" +
  "action_outcomes 中 status=completed 且 success=true 的项目也是权威公开结果；" +
  "优先自然呈现 player_visible_outcome，不要把 player_visible_goal 行动标签逐条抄成日志；" +
  "即使缺少具体 outcome，也只能用自然的完成句，不能仍写成待选行动、受阻、无进展或没有发现。" +
  "必须声明 final_text 使用到的 asserted_fact_refs；semantic_audit 必须对每个" +
  " asserted_fact_ref × must_not_reveal.id 组合恰好给出一条" +
  " different_fact 与非空 reason，不能遗漏、重复或增加组合；未列入 asserted_fact_refs" +
  " 的 allowed ref 绝不能出现在 semantic_audit。" +
  "fidelity_audit 必须对每个 Required approved fact ref 恰好声明 entailed 与非空 reason；" +
  "若草稿与权威事实冲突，先改写 final_text，不能把冲突标成 entailed。" +
  "final_text 必须是可以直接念给玩家听的成稿；不得夹带草稿批注、内部约束说明、" +
  "对提示词或审核规则的讨论、自我纠错过程或先写错误再当场否定的元话语。" +
  "提交前逐句检查主语、谓语、宾语与指代完整，修复缺宾语、悬空介词、重复成分和断裂语序；" +
  "若 envelope 含 rules_requests / 已批准揭示，用虚构后果叙述检定结果，不要报骰面或技能名堆砌。" +
  "若 rules_owned_roll_rendering.narrator_must_not_render_numeric_rolls=true，" +
  "final_text 严禁输出任何骰面、目标值、奖惩骰数字或 roll source；" +
  "这些将由规则引擎在 final_text 之后结构化追加一次。" +
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

export function buildRequiredApprovedFactMap(envelope) {
  const allowed = buildAllowedAssertionMap(envelope);
  const required = {};
  const seenValues = new Set();
  const presentationOnlyValues = presentationOnlyCueValues(envelope);
  const approved = envelope && typeof envelope.approved_reveals === "object"
    ? envelope.approved_reveals : {};
  const clues = Array.isArray(approved.clues) ? approved.clues : [];
  clues.forEach((clue, index) => {
    if (!clue || typeof clue !== "object") return;
    const ref = `envelope:/approved_reveals/clues/${index}/player_safe_summary`;
    if (Object.hasOwn(allowed, ref) && typeof allowed[ref].value === "string" && allowed[ref].value.trim()) {
      const value = allowed[ref].value.trim();
      if (seenValues.has(value)) return;
      required[ref] = allowed[ref];
      seenValues.add(value);
    }
  });
  const must = Array.isArray(approved.must_include) ? approved.must_include : [];
  must.forEach((item, index) => {
    const suffix = typeof item === "string"
      ? ""
      : item && typeof item === "object"
        ? (["player_safe_summary", "summary", "text", "cue"].find(
            (key) => typeof item[key] === "string" && item[key].trim(),
          ) || "")
        : "";
    const ref = `envelope:/approved_reveals/must_include/${index}${suffix ? `/${suffix}` : ""}`;
    if (Object.hasOwn(allowed, ref) && typeof allowed[ref].value === "string" && allowed[ref].value.trim()) {
      const value = allowed[ref].value.trim();
      if (presentationOnlyValues.has(value)) return;
      if (seenValues.has(value)) return;
      required[ref] = allowed[ref];
      seenValues.add(value);
    }
  });
  const outcomes = envelope && Array.isArray(envelope.action_outcomes)
    ? envelope.action_outcomes : [];
  outcomes.forEach((outcome, index) => {
    if (!outcome || typeof outcome !== "object" || outcome.success !== true ||
        outcome.status !== "completed") return;
    const ref = `envelope:/action_outcomes/${index}/player_visible_outcome`;
    if (Object.hasOwn(allowed, ref) && typeof allowed[ref].value === "string" &&
        allowed[ref].value.trim()) {
      required[ref] = allowed[ref];
    }
  });
  const rules = envelope && Array.isArray(envelope.rule_results)
    ? envelope.rule_results : [];
  rules.forEach((result, index) => {
    if (!result || typeof result !== "object" || result.success === true) return;
    const field = typeof result.consequence_summary === "string" &&
      result.consequence_summary.trim() ? "consequence_summary" : "ordinary_failure_summary";
    const ref = `envelope:/rule_results/${index}/${field}`;
    if (Object.hasOwn(allowed, ref) && typeof allowed[ref].value === "string" &&
        allowed[ref].value.trim()) {
      required[ref] = allowed[ref];
    }
  });
  const pendingRef = "envelope:/pending_choice/prompt";
  if (Object.hasOwn(allowed, pendingRef) && typeof allowed[pendingRef].value === "string" &&
      allowed[pendingRef].value.trim()) {
    required[pendingRef] = allowed[pendingRef];
  }
  const limitationRef = "envelope:/typed_player_safe_limitation/message";
  if (Object.hasOwn(allowed, limitationRef) &&
      typeof allowed[limitationRef].value === "string" &&
      allowed[limitationRef].value.trim()) {
    required[limitationRef] = allowed[limitationRef];
  }
  return required;
}

export function presentationOnlyCueValues(envelope) {
  const values = new Set();
  const routes = envelope && Array.isArray(envelope?.choice_frame?.routes)
    ? envelope.choice_frame.routes : [];
  for (const route of routes) {
    if (!route || typeof route !== "object" || route.cue_scope !== "action_only") continue;
    const cue = typeof route.cue === "string" ? route.cue.trim() : "";
    if (cue) values.add(cue);
  }
  const storylets = envelope && Array.isArray(envelope.storylet_moves)
    ? envelope.storylet_moves : [];
  for (const move of storylets) {
    if (!move || typeof move !== "object") continue;
    const grounding = move.grounding_contract;
    if (!grounding || typeof grounding !== "object" ||
        grounding.allow_new_actionable_fact !== false) continue;
    const cue = typeof move.cue === "string" ? move.cue.trim() : "";
    if (cue) values.add(cue);
  }
  return values;
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

export function validateNarrationSubmission(
  params, allowedAssertionMap, forbiddenRefs, requiredApprovedFactMap = {},
) {
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
  const requiredRefs = Object.keys(requiredApprovedFactMap).sort();
  for (const requiredRef of requiredRefs) {
    if (!asserted.includes(requiredRef)) {
      throw new Error(`asserted_fact_refs is missing required approved fact: ${requiredRef}`);
    }
  }
  if (!Array.isArray(params.fidelity_audit)) {
    throw new Error("fidelity_audit must be an array");
  }
  const fidelitySeen = new Set();
  const fidelityAudit = [];
  for (const raw of params.fidelity_audit) {
    if (
      !raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).sort().join(",") !== "approved_ref,decision,reason"
    ) {
      throw new Error("fidelity audit record shape is invalid");
    }
    const approvedRef = typeof raw.approved_ref === "string" ? raw.approved_ref : "";
    const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
    if (!requiredRefs.includes(approvedRef)) {
      throw new Error("fidelity audit contains an extra approved fact ref");
    }
    if (fidelitySeen.has(approvedRef)) {
      throw new Error("fidelity audit contains a duplicate approved fact ref");
    }
    if (raw.decision !== "entailed" || !reason) {
      throw new Error("fidelity audit does not establish an approved fact");
    }
    fidelitySeen.add(approvedRef);
    fidelityAudit.push({ approved_ref: approvedRef, decision: "entailed", reason });
  }
  if (fidelitySeen.size !== requiredRefs.length) {
    throw new Error("fidelity audit is missing a required approved fact ref");
  }
  return {
    ok: true,
    final_text: finalText,
    secret_audit_complete: true,
    asserted_fact_refs: asserted,
    semantic_audit: semanticAudit,
    fact_fidelity_complete: true,
    fidelity_audit: fidelityAudit,
  };
}

function formatClueSummaries(envelope) {
  const reveals = envelope && envelope.approved_reveals;
  if (!reveals || typeof reveals !== "object") return "(none)";
  const presentationOnlyValues = presentationOnlyCueValues(envelope);
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
    if (text && !presentationOnlyValues.has(text)) {
      lines.push(`- must_include: ${text}`);
    }
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
      if (r.ordinary_failure_summary) {
        parts.push(`required ordinary failure: ${r.ordinary_failure_summary}`);
      }
      if (r.consequence_summary) {
        parts.push(`required settled consequence: ${r.consequence_summary}`);
      }
      if (r.success === true && r.settlement_scope === "check_only") {
        parts.push("CHECK SUCCESS ONLY: do not claim access, clue, agreement, transfer, or route completion");
      }
      if (r.success === true && r.state_change_committed === true) {
        parts.push("route state committed by apply receipt");
      }
      return parts.join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

function formatActionOutcomes(envelope) {
  const outcomes = envelope && Array.isArray(envelope.action_outcomes)
    ? envelope.action_outcomes : [];
  if (!outcomes.length) return "(none)";
  return outcomes
    .map((outcome, index) => {
      if (!outcome || typeof outcome !== "object" || outcome.success !== true ||
          outcome.status !== "completed") return "";
      const visible = String(outcome.player_visible_outcome || "").trim();
      return `[${index + 1}] COMPLETED SUCCESS` +
        `${visible ? ` | required visible outcome: ${visible}` :
          " | render as one natural completion sentence"}`;
    })
    .filter(Boolean)
    .join("\n") || "(none)";
}

function formatSceneAnchor(envelope) {
  const anchor = envelope && envelope.scene_anchor;
  if (!anchor || typeof anchor !== "object") return "(none)";
  const lines = [];
  if (anchor.display_name) lines.push(`Location: ${anchor.display_name}`);
  const sensory = Array.isArray(anchor.sensory_anchors)
    ? anchor.sensory_anchors.filter(Boolean)
    : [];
  if (sensory.length) lines.push(`Sensory anchors: ${sensory.join("; ")}`);
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
      const name = m.display_name || "a present NPC";
      const seed = String(m.dialogue_seed || m.emotional_tone || "").trim();
      const secretNote = m.has_secret ? " (has unspoken secret — do not reveal)" : "";
      return seed
        ? `- ${name}${secretNote}: ${seed}`
        : `- ${name}${secretNote}`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatPressureMoves(envelope) {
  const moves = envelope && Array.isArray(envelope.pressure_moves)
    ? envelope.pressure_moves : [];
  if (!moves.length) return "(none)";
  return moves
    .map((move, index) => {
      if (!move || typeof move !== "object") return "";
      const receipt = move.grounding_receipt;
      if (!receipt || typeof receipt !== "object" || receipt.status !== "authorized") {
        return "";
      }
      const symptom = String(
        move.visible_symptom || move.player_safe_summary || move.cue || "",
      ).trim();
      return symptom ? `[${index + 1}] AUTHORIZED PRESSURE: ${symptom}` : "";
    })
    .filter(Boolean)
    .join("\n") || "(none)";
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

export function buildNarrationGenerationContract(request) {
  const envelope = request?.narration_envelope || {};
  const requiredFacts = buildRequiredApprovedFactMap(envelope);
  const actionOnlyRoutes = Array.isArray(envelope?.choice_frame?.routes)
    ? envelope.choice_frame.routes
      .filter((route) => route && typeof route === "object" &&
        route.cue_scope === "action_only")
      .map((route) => ({
        route_id: route.route_id || route.id || null,
        cue_scope: "action_only",
        authorization: "future_action_affordance_only",
        may_narrate_as_completed: false,
      }))
    : [];
  const pressureMoves = Array.isArray(envelope.pressure_moves)
    ? envelope.pressure_moves.filter((move) =>
      move && typeof move === "object" &&
      move.grounding_receipt?.status === "authorized")
    : [];
  const npcMoves = Array.isArray(envelope.npc_moves) ? envelope.npc_moves : [];
  const hasNewApprovedFact = Object.keys(requiredFacts).length > 0;
  return {
    schema_version: 1,
    fact_authority: {
      completed_results: [
        "approved_reveals",
        "completed_successful_action_outcomes",
        "committed_state_grounding",
      ],
      settled_rule_results:
        "check_outcome_and_explicit_cost_only; state changes require committed action_outcomes or approved_reveals",
      player_action: "attempt_or_declared_intent_only_unless_settled_elsewhere",
      recent_player_visible_narrations:
        "prior_continuity_only_not_authority_for_new_current_turn_changes",
      public_transcript_tail:
        "keeper_rows_are_prior_continuity_only_and_player_rows_are_attempts_only",
    },
    choice_frame: {
      action_only_routes: actionOnlyRoutes,
      rule:
        "Present action_only cues only as future/possible actions; never as agreement, arrival, discovery, object transfer, NPC answer, or completed route.",
    },
    current_turn: {
      has_new_approved_fact: hasNewApprovedFact,
      required_approved_fact_count: Object.keys(requiredFacts).length,
      settled_rule_result_count: Array.isArray(envelope.rule_results)
        ? envelope.rule_results.length : 0,
      authorized_npc_move_count: npcMoves.length,
      authorized_pressure_move_count: pressureMoves.length,
      no_new_approved_fact_policy: {
        active: !hasNewApprovedFact,
        allow: [
          "non_state_changing_observable_attempts",
          "npc_tone_and_gesture_grounded_by_npc_moves",
          "harmless_scene_sensory_color",
          "authorized_pressure_moves",
        ],
        forbid: [
          "new_permission_or_prohibition",
          "new_possession_or_availability_change",
          "new_npc_answer",
          "new_clue_content",
          "uncommitted_location_or_route_completion",
        ],
        priority: "Use structured npc_moves and authorized pressure_moves before generic filler.",
      },
    },
  };
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

function formatPublicTranscript(tail) {
  if (!Array.isArray(tail) || tail.length === 0) return "(none)";
  return tail
    .slice(-8)
    .map((row) => {
      if (!row || typeof row !== "object") return "";
      const role = row.role === "keeper" ? "KP" : row.role === "player" ? "PLAYER" : "";
      const value = typeof row.text === "string" ? row.text.trim() : "";
      return role && value ? `[${role}] ${value}` : "";
    })
    .filter(Boolean)
    .join("\n") || "(none)";
}

export function buildPromptText(request) {
  const playLanguage = request.play_language || "zh-Hans";
  const envelope = request.narration_envelope || {};
  const allowedAssertionMap = buildAllowedAssertionMap(envelope);
  const sections = [
    `Play language for final_text: ${playLanguage}`,
    "",
    "## Last player action",
    String(request.last_player_text ?? "(none)"),
    "",
    "## Prior player-visible transcript (continuity only; PLAYER rows are attempts, not settled outcomes)",
    formatPublicTranscript(request.public_transcript_tail),
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
    "## Committed action_outcomes (authoritative; show completed success, never no-progress)",
    formatActionOutcomes(envelope),
    "",
    "## Typed pending player choice (show its consequence preview; do not resolve or roll)",
    envelope.pending_choice ? JSON.stringify(envelope.pending_choice, null, 2) : "(none)",
    "",
    "## Generation authority contract (normative; obey before prose)",
    JSON.stringify(buildNarrationGenerationContract(request), null, 2),
    "",
    "## Authorized pressure moves (prefer these over generic filler; add nothing beyond them)",
    formatPressureMoves(envelope),
    "",
    "## NPC dialogue seeds (voice/tone only; not permission, answer, or new fact authority)",
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
    "## Required approved fact refs (must be faithfully entailed by final_text)",
    JSON.stringify(buildRequiredApprovedFactMap(envelope), null, 2),
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

function parseJsonObject(text) {
  let value = String(text || "").trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();
  const parsed = JSON.parse(value);
  const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed.narration || parsed)
    : null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("narrator JSON response must be an object");
  }
  return candidate;
}

function usageFromPayload(payload) {
  if (!payload?.usage || typeof payload.usage !== "object") return null;
  return {
    input_tokens: payload.usage.prompt_tokens ?? payload.usage.input_tokens ?? null,
    output_tokens: payload.usage.completion_tokens ?? payload.usage.output_tokens ?? null,
  };
}

function addUsage(total, usage) {
  if (!usage) return total;
  for (const key of ["input_tokens", "output_tokens"]) {
    if (Number.isInteger(usage[key])) total[key] += usage[key];
  }
  return total;
}

const STRUCTURED_COMPLETION_MAX_TOKENS = 8192;
const STRUCTURED_SHAPE_MAX_ATTEMPTS = 3;
const NARRATOR_JSON_COMPLETION_MAX_TOKENS = 4096;
const DEFAULT_NARRATOR_DEADLINE_MS = 270000;
const DEFAULT_PROVIDER_CALL_TIMEOUT_MS = 120000;
const FACT_VERIFIER_BASE_URL = "http://127.0.0.1:18888/v1";
const FACT_VERIFIER_MODEL_ID = "gpt-5.6-sol";
const FACT_VERIFIER_COMPLETION_TOKENS = 8192;
const FACT_VERIFIER_CALL_TIMEOUT_MS = 90000;
const FACT_VERIFIER_MAX_SHAPE_ATTEMPTS = 2;
const FACT_VERIFIER_IDENTITY = Object.freeze({
  provider: "coding-relay",
  id: FACT_VERIFIER_MODEL_ID,
});

function boundedDuration(raw, fallback, maximum) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return fallback;
  return Math.min(parsed, maximum);
}

export function narratorDeadlineMs(env = process.env) {
  return boundedDuration(
    env.COC_NARRATOR_DEADLINE_MS,
    DEFAULT_NARRATOR_DEADLINE_MS,
    285000,
  );
}

export function providerCallTimeoutMs(env = process.env) {
  return boundedDuration(
    env.COC_NARRATOR_CALL_TIMEOUT_MS,
    DEFAULT_PROVIDER_CALL_TIMEOUT_MS,
    180000,
  );
}

export function createNarratorDeadline(timeoutMs = narratorDeadlineMs()) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(responseShapeError(
      "narrator_deadline_exceeded", "narrator end-to-end deadline exceeded",
    )),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
}

function responseShapeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryableResponseShape = true;
  return error;
}

async function fetchCompletion(
  model,
  headers,
  messages,
  signal,
  maxTokens = STRUCTURED_COMPLETION_MAX_TOKENS,
  {
    tokenField = "max_tokens",
    responseFormat = null,
    callTimeoutMs = providerCallTimeoutMs(),
    includeTemperature = true,
    thinking = null,
    reasoningEffort = null,
    doSample = null,
  } = {},
) {
  const callController = new AbortController();
  let callTimedOut = false;
  const onParentAbort = () => callController.abort(signal?.reason);
  if (signal?.aborted) onParentAbort();
  else signal?.addEventListener("abort", onParentAbort, {once: true});
  const callTimeout = setTimeout(() => {
    callTimedOut = true;
    callController.abort(responseShapeError(
      "provider_call_timeout", "narrator provider call deadline exceeded",
    ));
  }, callTimeoutMs);
  let response;
  let payload;
  try {
    const body = {
      model: model.id,
      messages,
      [tokenField]: maxTokens,
    };
    if (includeTemperature) body.temperature = 0;
    if (responseFormat) body.response_format = responseFormat;
    if (thinking) body.thinking = thinking;
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
    if (typeof doSample === "boolean") body.do_sample = doSample;
    response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: callController.signal,
    });
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted || callTimedOut) throw error;
      throw new Error(`narrator provider returned non-JSON HTTP ${response.status}`);
    }
  } catch (error) {
    if (signal?.aborted) {
      const deadlineError = responseShapeError(
        "narrator_deadline_exceeded", "narrator end-to-end deadline exceeded",
      );
      deadlineError.retryableResponseShape = false;
      throw deadlineError;
    }
    if (callTimedOut) {
      const timeoutError = responseShapeError(
        "provider_call_timeout", "narrator provider call deadline exceeded",
      );
      timeoutError.retryableResponseShape = false;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(callTimeout);
    signal?.removeEventListener("abort", onParentAbort);
  }
  if (!response.ok) {
    throw new Error(
      `narrator provider HTTP ${response.status}: ${payload?.error?.message || "request failed"}`,
    );
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw responseShapeError(
      "empty_content", "narrator provider returned no JSON content",
    );
  }
  return {
    content,
    usage: usageFromPayload(payload),
    finishReason: payload?.choices?.[0]?.finish_reason || null,
  };
}

export async function fetchStructuredJsonCompletion(
  model,
  headers,
  messages,
  signal,
  {
    maxTokens = STRUCTURED_COMPLETION_MAX_TOKENS,
    maxAttempts = STRUCTURED_SHAPE_MAX_ATTEMPTS,
    validate = (value) => value,
    tokenField = "max_tokens",
    responseFormat = null,
    callTimeoutMs = providerCallTimeoutMs(),
    includeTemperature = true,
    thinking = null,
    reasoningEffort = null,
    doSample = null,
  } = {},
) {
  const startedAt = Date.now();
  const usage = { input_tokens: 0, output_tokens: 0 };
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const completion = await fetchCompletion(
        model, headers, messages, signal, maxTokens, {
          tokenField, responseFormat, callTimeoutMs, includeTemperature,
          thinking, reasoningEffort, doSample,
        },
      );
      addUsage(usage, completion.usage);
      if (completion.finishReason === "length") {
        throw responseShapeError(
          "finish_reason_length",
          "narrator structured response ended because the completion budget was exhausted",
        );
      }
      let parsed;
      try {
        parsed = parseJsonObject(completion.content);
      } catch {
        throw responseShapeError(
          "invalid_json_shape", "narrator provider returned incomplete or invalid JSON",
        );
      }
      try {
        return {
          value: validate(parsed),
          usage,
          attempts: attempt,
          duration_ms: Math.max(0, Date.now() - startedAt),
        };
      } catch {
        throw responseShapeError(
          "invalid_structured_shape", "narrator provider returned an invalid structured response",
        );
      }
    } catch (error) {
      lastError = error;
      if (!error?.retryableResponseShape || attempt >= maxAttempts) throw error;
    }
  }
  throw lastError || new Error("narrator structured response retry exhausted");
}

export function validateIndependentFactVerification(raw, requiredFacts) {
  const facts = raw && typeof raw === "object" && Array.isArray(raw.facts)
    ? raw.facts : null;
  const unsupported = raw && typeof raw === "object" && Array.isArray(raw.unsupported_claims)
    ? raw.unsupported_claims : null;
  const presentation = raw && typeof raw === "object" &&
    Array.isArray(raw.presentation_violations) ? raw.presentation_violations : null;
  if (!facts || !unsupported || !presentation) {
    throw new Error(
      "independent fact verifier response requires facts, unsupported_claims, and presentation_violations",
    );
  }
  const requiredRefs = Object.keys(requiredFacts).sort();
  const seen = new Set();
  const records = [];
  const findings = [];
  for (const row of facts) {
    if (
      !row || typeof row !== "object" || Array.isArray(row) ||
      Object.keys(row).sort().join(",") !== "decision,reason,ref"
    ) {
      throw new Error("independent fact verifier record shape is invalid");
    }
    const ref = typeof row.ref === "string" ? row.ref : "";
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    if (!requiredRefs.includes(ref) || seen.has(ref) || !reason) {
      throw new Error("independent fact verifier coverage is invalid");
    }
    if (!["entailed", "contradicted", "omitted"].includes(row.decision)) {
      throw new Error("independent fact verifier decision is invalid");
    }
    seen.add(ref);
    records.push({ approved_ref: ref, decision: row.decision, reason });
    if (row.decision !== "entailed") findings.push(`${ref}:${row.decision}:${reason}`);
  }
  if (seen.size !== requiredRefs.length) {
    throw new Error("independent fact verifier is missing a required ref");
  }
  const unsupportedClaims = [];
  const materialCategories = new Set([
    "amount", "deadline", "identity", "relationship", "location_state",
    "plot_object_state", "clue_content", "agreement", "rule_outcome",
    "supernatural_fact",
  ]);
  for (const row of unsupported) {
    if (
      !row || typeof row !== "object" || Array.isArray(row) ||
      Object.keys(row).sort().join(",") !== "category,claim,reason"
    ) {
      throw new Error("independent unsupported-claim record shape is invalid");
    }
    const claim = typeof row.claim === "string" ? row.claim.trim() : "";
    const category = typeof row.category === "string" ? row.category.trim() : "";
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    if (!claim || !reason || !materialCategories.has(category)) {
      throw new Error("independent unsupported-claim record is incomplete");
    }
    unsupportedClaims.push({ claim, category, reason });
    findings.push(`unsupported_claim:${category}:${claim}:${reason}`);
  }
  const presentationViolations = [];
  const presentationCategories = new Set([
    "drafting_note", "constraint_talk", "self_correction", "meta_commentary",
    "instruction_echo", "analysis_leak",
  ]);
  for (const row of presentation) {
    if (
      !row || typeof row !== "object" || Array.isArray(row) ||
      Object.keys(row).sort().join(",") !== "category,excerpt,reason"
    ) {
      throw new Error("independent presentation-violation record shape is invalid");
    }
    const excerpt = typeof row.excerpt === "string" ? row.excerpt.trim() : "";
    const category = typeof row.category === "string" ? row.category.trim() : "";
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    if (!excerpt || !reason || !presentationCategories.has(category)) {
      throw new Error("independent presentation-violation record is incomplete");
    }
    presentationViolations.push({ excerpt, category, reason });
    findings.push(`presentation_violation:${category}:${excerpt}:${reason}`);
  }
  return {
    passed: findings.length === 0,
    records,
    unsupported_claims: unsupportedClaims,
    presentation_violations: presentationViolations,
    findings,
  };
}

export function factVerifierGrounding(request) {
  const envelope = request?.narration_envelope || {};
  const publicTranscript = Array.isArray(request?.public_transcript_tail)
    ? request.public_transcript_tail.slice(-8).flatMap((row) => {
      if (!row || typeof row !== "object" ||
          !["player", "keeper"].includes(row.role) || typeof row.text !== "string" ||
          !row.text.trim()) return [];
      return [{ role: row.role, text: row.text.trim() }];
    })
    : [];
  return {
    last_player_action: String(request?.last_player_text || ""),
    recent_player_visible_narrations: Array.isArray(request?.recent_narrations)
      ? request.recent_narrations.slice(-2).map((text) => String(text || ""))
      : [],
    public_transcript_tail: publicTranscript,
    public_context_scope: {
      recent_narrations:
        "May establish only facts already stated to the player, such as the existing location or who was already present.",
      keeper_transcript_rows:
        "May establish only previously player-visible continuity facts; they cannot settle a new current-turn change.",
      player_transcript_rows:
        "Establish only declared actions or attempts, never their success or resulting state change.",
      last_player_action:
        "Establishes an attempted or declared action, not a settled permission, answer, transfer, discovery, or route outcome.",
      current_turn_changes:
        "Require approved_reveals, settled rule_results, completed action_outcomes, npc_moves/pressure_moves, or committed state_grounding.",
      named_object_and_document_claims:
        "Existence, presence, availability, possession, production, movement, placement, opening, transfer, or inspectability of a specific object/document requires structured authority or prior Keeper-visible continuity. Player prose alone is never that authority.",
    },
    authority_partitions: {
      authoritative_current_turn: {
        approved_reveals: envelope.approved_reveals || {},
        rule_results: envelope.rule_results || [],
        action_outcomes: envelope.action_outcomes || [],
        npc_moves: envelope.npc_moves || [],
        pressure_moves: envelope.pressure_moves || [],
        state_grounding: envelope.state_grounding || {},
      },
      continuity_only: {
        recent_player_visible_narrations: Array.isArray(request?.recent_narrations)
          ? request.recent_narrations.slice(-2).map((text) => String(text || ""))
          : [],
        keeper_transcript_rows: publicTranscript.filter((row) => row.role === "keeper"),
      },
      unsettled_attempts_only: {
        last_player_action: String(request?.last_player_text || ""),
        player_transcript_rows: publicTranscript.filter((row) => row.role === "player"),
        authorizes: ["declared_or_attempted_action"],
        does_not_authorize: [
          "object_or_document_existence",
          "object_or_document_availability",
          "object_or_document_possession_or_transfer",
          "npc_answer_or_agreement",
          "location_or_discovery_change",
        ],
      },
      authorized_rendering_equivalence: {
        ephemeral_carrier:
          "May stage already-authorized exact content/transfer only when it adds no independent contents, inspectability, route, availability, possession continuity, or continuing object state.",
        settled_acknowledgement:
          "May acknowledge/enact an already-completed action or agreement only when it adds no terms, permission, promise, answer, or relationship.",
      },
    },
    approved_reveals: envelope.approved_reveals || {},
    rule_results: envelope.rule_results || [],
    scene_anchor: envelope.scene_anchor || {},
    state_grounding: envelope.state_grounding || {},
    choice_frame: envelope.choice_frame || {},
    npc_moves: envelope.npc_moves || [],
    improvisation_allowed: envelope.improvisation_allowed || [],
  };
}

export function buildFactVerifierMessages(requiredFacts, finalText, request) {
  const authoritative = Object.entries(requiredFacts).map(([ref, row]) => ({
    ref, fact: row.value,
  }));
  return [
    {
      role: "system",
      content:
        "You are an independent semantic verifier, not a writer. Compare every authoritative " +
        "fact with the candidate narration. Preserve numbers, names, negation, modality, and " +
        "relations. Also identify every material claim not supported by the grounding context. " +
        "Report unsupported claims only in these material categories: amount, deadline, identity, " +
        "relationship, location_state, plot_object_state, clue_content, agreement, rule_outcome, " +
        "supernatural_fact. A plot_object_state claim includes asserting that a specific, named, " +
        "countable, purpose-bearing, requested, or interactable object/document exists, is present " +
        "or available, is possessed, produced, moved, placed, opened, handed over, or made " +
        "inspectable. Such a claim is material even when phrased as a small gesture and even when " +
        "the object itself is not a clue. Generic non-interactable ambient clutter, furniture, " +
        "gestures, light, weather, odors, sounds, NPC tone, and other harmless sensory color are " +
        "not material. Do not report a " +
        "mundane action or its negation unless it changes state or conveys clue content. " +
        "A choice_frame route with cue_scope=action_only proves only that the action may be taken; " +
        "it does not ground agreement, arrival, discovery, clue answer, destination list, object " +
        "transfer, NPC answer, or completed outcome behind that route. Flag narration that turns " +
        "such a cue into an already disclosed or completed fact. Prior player-visible narrations " +
        "may establish only continuity facts they already stated (for example an existing location " +
        "or NPC presence); they do not authorize a new current-turn permission, prohibition, " +
        "answer, transfer, discovery, or state change. A player's action is an attempt unless the " +
        "current structured results settle its outcome. A player request or question may identify " +
        "a hypothetical object/document for the attempted action, but is never evidence that it " +
        "exists, is available, or is produced/moved by an NPC. " +
        AUTHORIZED_RENDERING_EQUIVALENCE_POLICY + " Never repair the narration and never trust " +
        "any self-audit it contains. " +
        "Also reject player-visible prose that exposes the writing process: drafting notes, " +
        "constraint or policy discussion, prompt/instruction echoes, analysis, or self-correction " +
        "where a draft assertion is stated and then retracted instead of silently rewritten. " +
        "Return only JSON.",
    },
    {
      role: "user",
      content: [
        `Authoritative facts:\n${JSON.stringify(authoritative, null, 2)}`,
        `Grounding context:\n${JSON.stringify(factVerifierGrounding(request), null, 2)}`,
        `Candidate narration:\n${finalText}`,
        "facts must contain exactly one row per Authoritative fact and must be [] when there are none.",
        "Return exactly: {\"facts\":[{\"ref\":\"exact ref\",\"decision\":" +
          "\"entailed|contradicted|omitted\",\"reason\":\"non-empty semantic reason\"}]," +
          "\"unsupported_claims\":[{\"claim\":\"material unsupported claim\"," +
          "\"category\":\"one allowed material category\"," +
          "\"reason\":\"why grounding does not support it\"}]," +
          "\"presentation_violations\":[{\"excerpt\":\"exact offending excerpt\"," +
          "\"category\":\"drafting_note|constraint_talk|self_correction|meta_commentary|" +
          "instruction_echo|analysis_leak\",\"reason\":\"why it is not player-facing prose\"}]}",
      ].join("\n\n"),
    },
  ];
}

export function factVerifierIdentity() {
  return { ...FACT_VERIFIER_IDENTITY };
}

function factVerifierTransport(env = process.env) {
  const apiKey = env.CODING_RELAY_API_KEY || env.OPENAI_API_KEY || "local-coding-relay";
  return {
    model: {
      provider: FACT_VERIFIER_IDENTITY.provider,
      id: FACT_VERIFIER_IDENTITY.id,
      baseUrl: FACT_VERIFIER_BASE_URL,
    },
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
  };
}

export async function verifyNarrationFactsWithSol(
  requiredFacts, finalText, signal, request,
) {
  if (!Object.keys(requiredFacts).length) {
    // Even turns without a required reveal still need hallucination checking.
    // Continue with an empty authoritative-fact list.
  }
  const transport = factVerifierTransport();
  const verification = await fetchStructuredJsonCompletion(
    transport.model,
    transport.headers,
    buildFactVerifierMessages(requiredFacts, finalText, request),
    signal,
    {
      maxTokens: FACT_VERIFIER_COMPLETION_TOKENS,
      maxAttempts: FACT_VERIFIER_MAX_SHAPE_ATTEMPTS,
      tokenField: "max_completion_tokens",
      responseFormat: {type: "json_object"},
      callTimeoutMs: FACT_VERIFIER_CALL_TIMEOUT_MS,
      includeTemperature: false,
      validate: (parsed) => validateIndependentFactVerification(parsed, requiredFacts),
    },
  );
  const identity = factVerifierIdentity();
  return {
    ...verification.value,
    usage: verification.usage,
    verifier_identity: identity,
    verifier_receipt: {
      schema_version: 1,
      model_identity: identity,
      transport: "chat/completions",
      response_mode: "json_object",
      grounding_contract: "structured_authority_partitions_v2",
      max_completion_tokens: FACT_VERIFIER_COMPLETION_TOKENS,
      timeout_ms: FACT_VERIFIER_CALL_TIMEOUT_MS,
      attempt_count: verification.attempts,
      duration_ms: verification.duration_ms,
      usage: verification.usage,
    },
  };
}

async function independentlyVerifyToolResult(request, result) {
  const requiredFacts = buildRequiredApprovedFactMap(request.narration_envelope);
  const deadline = createNarratorDeadline();
  try {
    const verified = await verifyNarrationFactsWithSol(
      requiredFacts, result.final_text, deadline.signal, request,
    );
    if (!verified.passed) {
      throw new Error(`independent fact verifier rejected tool narration: ${verified.findings.join("; ")}`);
    }
    return {
      ...result,
      fact_fidelity_complete: true,
      fidelity_audit: verified.records.map((row) => ({
        approved_ref: row.approved_ref, decision: "entailed", reason: row.reason,
      })),
      fact_fidelity_verifier: "independent_model_call",
      fact_fidelity_verifier_identity: verified.verifier_identity,
      fact_fidelity_verifier_receipt: verified.verifier_receipt,
    };
  } finally {
    deadline.cleanup();
  }
}

export function buildCompactNarratorCorrectionPrompt(
  request,
  responseShape,
  allowedAssertionMap,
  forbiddenRefs,
  requiredFacts,
  correction,
) {
  const grounding = factVerifierGrounding(request);
  const authorityBundle = {
    play_language: request?.play_language || "zh-Hans",
    allowed_assertion_refs: allowedAssertionMap,
    required_approved_facts: requiredFacts,
    forbidden_refs: forbiddenRefs,
    generation_contract: buildNarrationGenerationContract(request),
    public_context_scope: grounding.public_context_scope,
    authority_partitions: grounding.authority_partitions,
  };
  return [
    "THE PREVIOUS NARRATION SUBMISSION WAS REJECTED. RETURN ONLY A CORRECTED JSON OBJECT.",
    `Rejection class: ${correction.kind}`,
    `Rejection findings: ${JSON.stringify(correction.findings)}`,
    `Previous submission: ${JSON.stringify(correction.previous_submission)}`,
    `Closed authoritative correction bundle: ${JSON.stringify(authorityBundle)}`,
    `Exact JSON shape: ${JSON.stringify(responseShape)}`,
    AUTHORIZED_RENDERING_EQUIVALENCE_POLICY,
    "Preserve every required approved fact exactly. Remove every rejected unsupported claim " +
      "without replacing it with another ungrounded fact. asserted_fact_refs may use only exact " +
      "keys from allowed_assertion_refs; semantic_audit must exactly cover asserted refs × " +
      "forbidden_refs; fidelity_audit must exactly cover required_approved_facts with entailed.",
  ].join("\n\n");
}

export async function callDirectNarrator(request, provider, modelId, agentDir) {
  const { model, modelRuntime } = await resolveRequestedModel({
    agentDir, provider, modelId,
  });
  if (model.api !== "openai-completions") {
    return null;
  }
  const authResult = await modelRuntime.getAuth(model);
  if (!authResult) throw new Error(`No API key found for "${model.provider}"`);
  const requestModel = authResult.auth.baseUrl
    ? { ...model, baseUrl: authResult.auth.baseUrl }
    : model;
  if (typeof requestModel.baseUrl !== "string") return null;
  const deadline = createNarratorDeadline();
  const responseShape = {
    final_text: "2-6 short player-visible tabletop sentences in play_language",
    asserted_fact_refs: ["zero or more exact keys from Allowed assertion refs"],
    semantic_audit: [{
      asserted_ref: "exact asserted ref",
      forbidden_ref: "exact must_not_reveal id",
      decision: "different_fact",
      reason: "non-empty semantic reason",
    }],
    fidelity_audit: [{
      approved_ref: "exact Required approved fact ref",
      decision: "entailed",
      reason: "non-empty reason explaining how final_text preserves the authoritative fact",
    }],
    notes: "optional",
  };
  try {
    const headers = {
      "content-type": "application/json",
      ...Object.fromEntries(
        Object.entries(authResult.auth.headers || {}).filter((entry) => entry[1] !== null),
      ),
    };
    if (authResult.auth.apiKey &&
        !Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) {
      headers.authorization = `Bearer ${authResult.auth.apiKey}`;
    }
    const allowed = buildAllowedAssertionMap(request.narration_envelope);
    const forbidden = forbiddenRefsFromEnvelope(request.narration_envelope);
    const requiredFacts = buildRequiredApprovedFactMap(request.narration_envelope);
    const totalUsage = { input_tokens: 0, output_tokens: 0 };
    const phaseTimings = [];
    const narratorStartedAt = Date.now();
    const operatorReviewMode = request?.review_mode === "operator_long_play";
    let correction = null;
    let lastVerificationFindings = [];
    for (let attempt = 1; attempt <= (operatorReviewMode ? 1 : 3); attempt += 1) {
      const userContent = correction
        ? buildCompactNarratorCorrectionPrompt(
            request, responseShape, allowed, forbidden, requiredFacts, correction,
          )
        : [
            buildPromptText(request).replace(
              "Call coc_keeper_narration exactly once with 2–6 short sentences of tabletop prose.",
              "Return the narration submission as JSON.",
            ),
            `Exact JSON shape: ${JSON.stringify(responseShape)}`,
            "semantic_audit must contain exactly asserted_fact_refs × must_not_reveal.id; " +
              "use decision different_fact only, or omit the asserted ref if safety is uncertain. " +
              "Never audit an allowed ref unless it is also listed in asserted_fact_refs.",
          ].join("\n\n");
      const generation = await fetchStructuredJsonCompletion(requestModel, headers, [
          {
            role: "system",
            content: SYSTEM_PROMPT +
              " Do not call tools. Return only one JSON object, without markdown.",
          },
          { role: "user", content: userContent },
      ], deadline.signal, {
        maxTokens: NARRATOR_JSON_COMPLETION_MAX_TOKENS,
        maxAttempts: operatorReviewMode ? 1 : STRUCTURED_SHAPE_MAX_ATTEMPTS,
        responseFormat: {type: "json_object"},
        includeTemperature: false,
        thinking: {type: "disabled"},
        reasoningEffort: "none",
        doSample: false,
      });
      addUsage(totalUsage, generation.usage);
      phaseTimings.push({
        phase: "narrator_generation",
        outer_attempt: attempt,
        structured_attempt_count: generation.attempts,
        duration_ms: generation.duration_ms,
      });
      let candidate;
      let result;
      try {
        candidate = generation.value;
        result = validateNarrationSubmission(candidate, allowed, forbidden, requiredFacts);
      } catch (error) {
        if (operatorReviewMode || attempt >= 3) throw error;
        correction = {
          kind: "structured_contract",
          findings: [error && error.message ? error.message : String(error)],
          previous_submission: generation.value,
        };
        continue;
      }
      if (operatorReviewMode) {
        result.fact_fidelity_complete = false;
        if (typeof candidate.notes === "string" && candidate.notes.trim()) {
          result.notes = candidate.notes.trim();
        }
        return {
          ...withRuntimeProvenance(result, { provider: model.provider, id: model.id }, "json"),
          usage: totalUsage,
          operator_review_receipt: {
            schema_version: 1,
            protocol: "operator_codex_black_box_v2",
            status: "pending",
            independent_fact_verification: "NOT_RUN",
            generation_policy: "single_pass_raw_narration",
          },
          narrator_generation_receipt: {
            schema_version: 1,
            model_identity: {provider: model.provider, id: model.id},
            transport: "chat/completions",
            response_mode: "json_object",
            thinking: "disabled",
            reasoning_effort: "none",
            max_tokens: NARRATOR_JSON_COMPLETION_MAX_TOKENS,
            attempt_count: 1,
            correction_count: 0,
            duration_ms: Math.max(0, Date.now() - narratorStartedAt),
            phase_timings: phaseTimings,
          },
        };
      }
      const verified = await verifyNarrationFactsWithSol(
        requiredFacts, result.final_text, deadline.signal, request,
      );
      phaseTimings.push({
        phase: "fact_verification",
        outer_attempt: attempt,
        structured_attempt_count: verified.verifier_receipt.attempt_count,
        duration_ms: verified.verifier_receipt.duration_ms,
      });
      if (verified.passed) {
        result.fidelity_audit = verified.records.map((row) => ({
          approved_ref: row.approved_ref,
          decision: "entailed",
          reason: row.reason,
        }));
        result.fact_fidelity_complete = true;
        result.fact_fidelity_verifier = "independent_model_call";
        result.fact_fidelity_verifier_identity = verified.verifier_identity;
        result.fact_fidelity_verifier_receipt = verified.verifier_receipt;
        if (typeof candidate.notes === "string" && candidate.notes.trim()) {
          result.notes = candidate.notes.trim();
        }
        return {
          ...withRuntimeProvenance(result, { provider: model.provider, id: model.id }, "json"),
          usage: totalUsage,
          narrator_generation_receipt: {
            schema_version: 1,
            model_identity: {provider: model.provider, id: model.id},
            transport: "chat/completions",
            response_mode: "json_object",
            thinking: "disabled",
            reasoning_effort: "none",
            max_tokens: NARRATOR_JSON_COMPLETION_MAX_TOKENS,
            attempt_count: attempt,
            correction_count: attempt - 1,
            duration_ms: Math.max(0, Date.now() - narratorStartedAt),
            phase_timings: phaseTimings,
          },
        };
      }
      lastVerificationFindings = verified.findings;
      correction = {
        kind: "independent_fact_verifier",
        findings: verified.findings,
        previous_submission: candidate,
      };
    }
    const exhausted = responseShapeError(
      "semantic_verification_exhausted",
      "semantic_verification_exhausted: independent fact verifier rejected narrator " +
        "correction retry: " + lastVerificationFindings.join("; "),
    );
    exhausted.retryableResponseShape = false;
    throw exhausted;
  } finally {
    deadline.cleanup();
  }
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
      "Assert every Required approved fact ref and preserve it exactly in meaning.",
      "fidelity_audit must exactly cover Required approved fact refs with entailed.",
      "Treat cue_scope=action_only as a future affordance only, never a completed route result.",
      "Without a new approved fact, use grounded NPC/pressure behavior or harmless observation; do not invent permission, possession changes, answers, or clue content.",
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
      fidelity_audit: Type.Array(Type.Object({
        approved_ref: Type.String(),
        decision: Type.Literal("entailed"),
        reason: Type.String(),
      }), {description: "Exactly one entailed record for every Required approved fact ref."}),
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
          holder.contract.requiredApprovedFactMap,
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

  const provider = process.env.COC_NARRATOR_MODEL_PROVIDER || "coding-relay";
  const modelId = process.env.COC_NARRATOR_MODEL_ID || "gpt-5.6-luna";
  const agentDir = getAgentDir();
  if (process.env.COC_NARRATOR_TRANSPORT !== "pi-tool") {
    const direct = await callDirectNarrator(request, provider, modelId, agentDir);
    if (direct) return direct;
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
    requiredApprovedFactMap: buildRequiredApprovedFactMap(request.narration_envelope),
  };
  const tool = serverState?.tool || buildNarrationTool(holder);
  const cwd = __dirname;

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
    const { model, modelRuntime } = await resolveRequestedModel({
      agentDir,
      provider,
      modelId,
    });
    const created = await createAgentSession({
      cwd, agentDir, tools: ["coc_keeper_narration"], customTools: [tool],
      model, modelRuntime,
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
      const verifiedResult = await independentlyVerifyToolResult(
        request, capture.result,
      );
      return withRuntimeProvenance(verifiedResult, modelIdentity, "tool");
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
