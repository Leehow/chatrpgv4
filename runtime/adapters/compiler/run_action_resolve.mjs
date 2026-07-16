#!/usr/bin/env node
/** Private Keeper planning plus capability-bound semantic adjudication. */
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
  "You are the private Keeper for a Call of Cthulhu table, not a menu classifier. " +
  "Understand the player's actual goal and fictional method, decide the next dramatic beat, " +
  "decide whether uncertainty and stakes justify a roll, and choose how an available NPC " +
  "responds. Return both a capability binding and keeper_proposal. " +
  "Judge meaning semantically; never use keyword-hit logic. " +
  "The player did not see this structured request and must never receive its IDs. " +
  "keeper_context is private compiled module/state context. Use it to reason like a Keeper, " +
  "but never quote private rationale or Keeper-only facts to the player. " +
  "Only supplied capability IDs can authorize durable facts, clues, transitions, or state. " +
  "Every supplied affordance has already passed the deterministic runtime's internal " +
  "execution gates and carries preconditions_satisfied=true. Treat that as authoritative: " +
  "bind player meaning only, and never infer or re-adjudicate omitted prerequisites. " +
  "Match an affordance when the structured action atoms presently perform the whole action, " +
  "or a concrete direct step, progress action, or implementation means that causally advances " +
  "that affordance's public goal. The player need not paraphrase the complete cue. " +
  "Do not match mere mention, acknowledgement, hypothetical planning, unrelated preparation, " +
  "or an action that does not actually begin or continue the route. Do not replay an " +
  "affordance because the player merely acknowledges, summarizes, or handles the result of " +
  "an action that has already happened. " +
  "A destination may be selected ONLY when the player clearly attempts immediate travel there; " +
  "merely asking about, naming, " +
  "researching, or considering a place must return a null destination. Immediate travel may " +
  "be selected in the same action as accepting " +
  "a public affordance that unlocks it. Do not invent canonical facts, NPC identities, or " +
  "destinations. A reasonable action that matches no authored affordance is NOT no_match: " +
  "use keeper_proposal.resolution_mode=improvised, keep durable capability IDs empty, set " +
  "no_match=false, and give it a grounded CHARACTER/DEEPEN/PRESSURE/etc. beat. Use no_match=true " +
  "only when the action is genuinely ambiguous, impossible to understand safely, or needs a " +
  "clarifying question; then resolution_mode must be clarify. " +
  "post_arrival_affordances are a separate, explicitly phased candidate set. Select only " +
  "rows whose exact destination_scene_id is the immediate travel destination and whose goals " +
  "the player presently advances after arrival. If natural phrasing touches more than one " +
  "such row, order matched_affordance_ids from the most immediate executable goal to later " +
  "goals; the runtime will compile and execute exactly one goal this turn. Never " +
  "select a post-arrival ID for travel alone, future planning, or without its destination. " +
  "The runtime will seal that one action and execute it only after movement commits. " +
  "Normalize targets and action atoms to candidate structured tags where semantically sound. " +
  "Python rule_advice is advice to the Keeper, not an exam answer. For each relevant item, " +
  "record its advice_id in accepted_advice_ids or overridden_advice_ids. You have final " +
  "discretion over whether to roll, which legal skill/characteristic fits, difficulty, and " +
  "bonus/penalty dice. Explain overrides. If rule_ruling.decision=roll, emit exactly one matching " +
  "normalized atom with requires_roll=true, the same skill, difficulty and bonus_penalty_dice. " +
  "If decision=no_roll or defer, emit no roll atom. Never choose or predict the numeric die result. " +
  "Fields described as hard_invariants are not advice and cannot be overridden. " +
  "Use scene_action exactly by keeper_proposal_contract.scene_action_semantics. In particular, " +
  "RECOVER means recovering a missed investigative lead or Idea-Roll valve, never ordinary rest; " +
  "use DEEPEN/quiet for a pause that changes no durable state. REVEAL and CUT require their " +
  "corresponding supplied clue/route or destination authority. " +
  "If one push_candidate is supplied, classify a Push only when the player both requests " +
  "another attempt at that exact failed action and describes a materially changed method. " +
  "For a Push, return the opaque candidate_id and a concise changed_method_summary in " +
  "push_request; set matched_affordance_ids to [], emit no action atom, set destination to null and " +
  "no_match to false, and do not roll yet. A non-null push_request is mutually exclusive " +
  "with every normalized_action_atom; never repeat the ordinary roll atom alongside it. " +
  "The deterministic runtime will announce the supplied consequence and wait for typed " +
  "confirmation. An alternate route/action is not a Push. Never select a stale, ambiguous, " +
  "ineligible, or combat result. If no push_candidate is supplied, push_request MUST be " +
  "exactly null; never invent a push candidate. For a Push offer, rule_ruling is defer because " +
  "the deterministic runtime must obtain confirmation before rolling. " +
  "Choose NPC facts only from keeper_context.npc_fact_capabilities where known_by_npc and " +
  "revealable are true. An NPC tactic alone never authorizes a fact. " +
  "Call coc_submit_action_resolution exactly once.";

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(chunks.join("").trim())); }
      catch (error) { reject(new Error(`invalid stdin JSON: ${error.message}`)); }
    });
    process.stdin.on("error", reject);
  });
}

function resolveModel(agentDir, provider, modelId) {
  const auth = AuthStorage.create(path.join(agentDir, "auth.json"));
  const registry = ModelRegistry.create(auth, path.join(agentDir, "models.json"));
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

function allowedIds(request, key, idKey) {
  const rows = Array.isArray(request[key]) ? request[key] : [];
  return new Set(rows.map((row) => row && row[idKey]).filter((value) => typeof value === "string"));
}

function parseJsonObject(text) {
  let value = String(text || "").trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();
  const parsed = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed.action_resolution || parsed)
    : null;
}

const KEEPER_PROPOSAL_FIELDS = new Set([
  "schema_version", "source", "resolution_mode", "scene_action",
  "player_goal", "fictional_method", "rule_ruling", "npc_ruling",
  "narration_plan", "rationale",
]);
const KEEPER_MODES = new Set(["authored", "improvised", "clarify", "subsystem"]);
const KEEPER_SCENE_ACTIONS = new Set([
  "REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT",
  "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF",
]);
const KEEPER_RULE_DECISIONS = new Set(["no_roll", "roll", "defer"]);
const KEEPER_OPERATION_KINDS = new Set(["skill_check", "characteristic_check"]);
const KEEPER_DIFFICULTIES = new Set(["regular", "hard", "extreme"]);
const KEEPER_NPC_TACTICS = new Set([
  "none", "answer", "deflect", "lie", "bargain", "pressure",
  "question", "reassure", "react",
]);
const KEEPER_NARRATIVE_BEATS = new Set([
  "advance", "deepen", "character", "pressure", "transition",
  "clarify", "aftermath", "quiet",
]);
const KEEPER_ENDINGS = new Set([
  "actionable_hook", "open_question", "consequence", "choice", "silence",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function validatedStringList(value, field) {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    throw new Error(`${field} must contain only non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

/** Validate executable references and canonical mechanics, never Keeper taste. */
function validateKeeperProposal(params, request, atoms) {
  const proposal = params.keeper_proposal;
  if (!exactKeys(proposal, KEEPER_PROPOSAL_FIELDS)) {
    throw new Error("keeper_proposal has unsupported or missing fields");
  }
  if (proposal.schema_version !== 1 || proposal.source !== "model") {
    throw new Error("keeper_proposal identity must be schema_version=1/source=model");
  }
  if (!KEEPER_MODES.has(proposal.resolution_mode) ||
      !KEEPER_SCENE_ACTIONS.has(proposal.scene_action)) {
    throw new Error("keeper_proposal mode or scene_action is invalid");
  }
  for (const field of ["player_goal", "fictional_method", "rationale"]) {
    if (!isNonEmptyString(proposal[field])) {
      throw new Error(`keeper_proposal.${field} is required`);
    }
  }
  const mode = proposal.resolution_mode;
  if (mode === "clarify" && params.no_match !== true) {
    throw new Error("clarify Keeper proposal requires no_match=true");
  }
  if (["authored", "improvised", "subsystem"].includes(mode) && params.no_match === true) {
    throw new Error("understood Keeper proposal must use no_match=false");
  }

  const ruling = proposal.rule_ruling;
  const rulingFields = new Set([
    "decision", "operation_kind", "skill", "difficulty",
    "bonus_penalty_dice", "accepted_advice_ids", "overridden_advice_ids",
    "reason",
  ]);
  if (!exactKeys(ruling, rulingFields) || !KEEPER_RULE_DECISIONS.has(ruling.decision) ||
      !isNonEmptyString(ruling.reason)) {
    throw new Error("keeper_proposal.rule_ruling is invalid");
  }
  if (!Number.isInteger(ruling.bonus_penalty_dice) ||
      ruling.bonus_penalty_dice < -2 || ruling.bonus_penalty_dice > 2) {
    throw new Error("keeper_proposal bonus_penalty_dice must be an integer -2..2");
  }
  const accepted = validatedStringList(
    ruling.accepted_advice_ids, "keeper_proposal.rule_ruling.accepted_advice_ids",
  );
  const overridden = validatedStringList(
    ruling.overridden_advice_ids, "keeper_proposal.rule_ruling.overridden_advice_ids",
  );
  if (accepted.some((id) => overridden.includes(id))) {
    throw new Error("Keeper advice cannot be both accepted and overridden");
  }
  const knownAdvice = new Set((Array.isArray(request.rule_advice) ? request.rule_advice : [])
    .map((row) => row && row.advice_id)
    .filter(isNonEmptyString));
  if ([...accepted, ...overridden].some((id) => !knownAdvice.has(id))) {
    throw new Error("keeper_proposal references unknown rule advice");
  }

  const rollAtoms = atoms.filter((atom) => atom && atom.requires_roll !== false);
  if (ruling.decision === "roll") {
    if (!KEEPER_OPERATION_KINDS.has(ruling.operation_kind) ||
        !isNonEmptyString(ruling.skill) || !KEEPER_DIFFICULTIES.has(ruling.difficulty)) {
      throw new Error("a Keeper roll requires a supported operation, skill, and difficulty");
    }
    const matches = rollAtoms.filter((atom) => atom.skill === ruling.skill);
    if (matches.length !== 1) {
      throw new Error("Keeper roll ruling requires exactly one matching roll atom");
    }
  } else if (rollAtoms.length) {
    throw new Error("Keeper no_roll/defer ruling conflicts with roll atoms");
  }

  const npc = proposal.npc_ruling;
  const npcFields = new Set(["npc_id", "tactic", "fact_id", "reason"]);
  if (!exactKeys(npc, npcFields) || !KEEPER_NPC_TACTICS.has(npc.tactic) ||
      !isNonEmptyString(npc.reason)) {
    throw new Error("keeper_proposal.npc_ruling is invalid");
  }
  const context = isRecord(request.keeper_context) ? request.keeper_context : {};
  const npcIds = new Set((Array.isArray(context.present_or_scene_npcs)
    ? context.present_or_scene_npcs : [])
    .map((row) => row && row.npc_id).filter(isNonEmptyString));
  if (npc.npc_id !== null && (!isNonEmptyString(npc.npc_id) || !npcIds.has(npc.npc_id))) {
    throw new Error("keeper_proposal selected an unavailable NPC");
  }
  if (npc.tactic === "none" && (npc.npc_id !== null || npc.fact_id !== null)) {
    throw new Error("npc tactic none must not select an NPC or fact");
  }
  if (npc.tactic !== "none" && npc.npc_id === null) {
    throw new Error("an NPC tactic requires an available npc_id");
  }
  if (npc.fact_id !== null) {
    const allowedFacts = new Set((Array.isArray(context.npc_fact_capabilities)
      ? context.npc_fact_capabilities : [])
      .filter((row) => row && row.known_by_npc === true && row.revealable === true)
      .map((row) => `${row.npc_id}\u0000${row.fact_id}`));
    if (!isNonEmptyString(npc.fact_id) ||
        !allowedFacts.has(`${npc.npc_id}\u0000${npc.fact_id}`)) {
      throw new Error("keeper_proposal selected an unauthorized NPC fact");
    }
  }

  const narration = proposal.narration_plan;
  const narrationFields = new Set([
    "beat", "tone", "sensory_focus", "end_with", "objective",
  ]);
  if (!exactKeys(narration, narrationFields) ||
      !KEEPER_NARRATIVE_BEATS.has(narration.beat) ||
      !KEEPER_ENDINGS.has(narration.end_with) ||
      !isNonEmptyString(narration.objective)) {
    throw new Error("keeper_proposal.narration_plan is invalid");
  }
  validatedStringList(narration.tone, "keeper_proposal.narration_plan.tone");
  validatedStringList(
    narration.sensory_focus, "keeper_proposal.narration_plan.sensory_focus",
  );
}

async function callCodingRelay(request, modelId, repairFeedback = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  const hasPushCandidate = Boolean(
    request.push_candidate && typeof request.push_candidate === "object",
  );
  const pushContract = hasPushCandidate
    ? "null, or {candidate_id, changed_method_summary} for the one supplied eligible failure"
    : "must be exactly null because no eligible push candidate was supplied";
  const schema = {
    matched_affordance_ids: ["one or more supplied affordance_id values, or []; MUST be [] for Push"],
    matched_destination_scene_id: "one supplied scene_id only for immediate travel, otherwise null",
    normalized_target_entities: ["canonical structured target tags"],
    normalized_action_atoms: [{
      id: "short-id", verb: "canonical action", target: "optional target",
      topic: "optional topic", requires_roll: false, skill: "optional skill",
      kind: "optional skill_check or characteristic_check",
      difficulty: "optional regular|hard|extreme", bonus_penalty_dice: 0,
      weapon_id: "optional supplied weapon candidate ID",
      reason: "optional reason", stakes: "optional stakes",
    }],
    push_request: pushContract,
    primary_intent: "investigate|social|move|combat|flee|meta|stuck|idle|ambiguous|montage|cast",
    confidence: 0.0,
    reason: "non-empty semantic reason",
    no_match: false,
    keeper_proposal: {
      schema_version: 1,
      source: "model",
      resolution_mode: "authored|improvised|clarify|subsystem",
      scene_action: "REVEAL|DEEPEN|PRESSURE|CHARACTER|CHOICE|CUT|MONTAGE|SUBSYSTEM|RECOVER|PAYOFF",
      player_goal: "what the player is actually trying to accomplish",
      fictional_method: "how they are doing it in the fiction",
      rule_ruling: {
        decision: "no_roll|roll|defer",
        operation_kind: "skill_check|characteristic_check|null",
        skill: "skill/characteristic|null",
        difficulty: "regular|hard|extreme|null",
        bonus_penalty_dice: 0,
        accepted_advice_ids: ["supplied advice_id"],
        overridden_advice_ids: ["supplied advice_id"],
        reason: "Keeper ruling and any override reason",
      },
      npc_ruling: {
        npc_id: "supplied present npc_id|null",
        tactic: "none|answer|deflect|lie|bargain|pressure|question|reassure|react",
        fact_id: "supplied known+revealable fact_id|null",
        reason: "why this NPC responds this way",
      },
      narration_plan: {
        beat: "advance|deepen|character|pressure|transition|clarify|aftermath|quiet",
        tone: ["short tone tag"], sensory_focus: ["short sensory focus"],
        end_with: "actionable_hook|open_question|consequence|choice|silence",
        objective: "private dramatic objective; never direct player-facing prose",
      },
      rationale: "private Keeper reasoning",
    },
  };
  try {
    const response = await fetch(
      process.env.COC_ACTION_RESOLVER_URL || "http://127.0.0.1:18888/v1/chat/completions",
      {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.CODING_RELAY_API_KEY || process.env.OPENAI_API_KEY || "local-relay"}`,
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + " Return only one JSON object; do not use markdown." },
          { role: "user", content: [
            "Plan and adjudicate this player action as the private Keeper.",
            `Push contract for this request: ${pushContract}.`,
            `Exact output shape: ${JSON.stringify(schema)}`,
            repairFeedback ? `Previous output was rejected. Repair exactly this contract error: ${repairFeedback}` : null,
            JSON.stringify(request, null, 2),
          ].filter(Boolean).join("\n\n") },
        ],
      }),
      signal: controller.signal,
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`coding relay HTTP ${response.status}: ${payload?.error?.message || "request failed"}`);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("coding relay returned no JSON content");
    }
    return {
      params: parseJsonObject(content),
      usage: payload.usage && typeof payload.usage === "object" ? {
        input_tokens: payload.usage.prompt_tokens ?? payload.usage.input_tokens ?? null,
        output_tokens: payload.usage.completion_tokens ?? payload.usage.output_tokens ?? null,
      } : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function run(request) {
  if (!request || typeof request !== "object" || typeof request.player_text !== "string" ||
      !request.player_text.trim() || !request.active_scene || typeof request.active_scene !== "object") {
    throw new Error("invalid action resolver request");
  }
  const affordanceIds = allowedIds(request, "public_affordances", "affordance_id");
  const postArrivalRows = Array.isArray(request.post_arrival_affordances)
    ? request.post_arrival_affordances : [];
  const postArrivalById = new Map(postArrivalRows
    .filter((row) => row && typeof row.affordance_id === "string")
    .map((row) => [row.affordance_id, row]));
  const allAffordanceIds = new Set([...affordanceIds, ...postArrivalById.keys()]);
  const destinationIds = allowedIds(request, "destination_candidates", "scene_id");
  const weaponIds = allowedIds(request, "weapon_candidates", "weapon_id");
  const pushCandidate = request.push_candidate && typeof request.push_candidate === "object"
    ? request.push_candidate : null;
  const capture = {
    result: null,
    assistantProse: "",
    pushRequestNormalization: null,
  };
  const intentUnion = Type.Union([
    "investigate", "social", "move", "combat", "flee", "meta", "stuck",
    "idle", "ambiguous", "montage", "cast",
  ].map((value) => Type.Literal(value)));
  const atom = Type.Object({
    id: Type.String(), verb: Type.String(),
    target: Type.Optional(Type.String()), topic: Type.Optional(Type.String()),
    requires_roll: Type.Boolean(), skill: Type.Optional(Type.String()),
    kind: Type.Optional(Type.String()), difficulty: Type.Optional(Type.String()),
    bonus_penalty_dice: Type.Optional(Type.Number()),
    weapon_id: Type.Optional(Type.String()),
    reason: Type.Optional(Type.String()), stakes: Type.Optional(Type.String()),
  });
  const keeperProposal = Type.Object({
    schema_version: Type.Literal(1),
    source: Type.Literal("model"),
    resolution_mode: Type.Union([
      "authored", "improvised", "clarify", "subsystem",
    ].map((value) => Type.Literal(value))),
    scene_action: Type.Union([
      "REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT",
      "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF",
    ].map((value) => Type.Literal(value))),
    player_goal: Type.String(),
    fictional_method: Type.String(),
    rule_ruling: Type.Object({
      decision: Type.Union(["no_roll", "roll", "defer"].map((value) => Type.Literal(value))),
      operation_kind: Type.Union([
        Type.Literal("skill_check"), Type.Literal("characteristic_check"), Type.Null(),
      ]),
      skill: Type.Union([Type.String(), Type.Null()]),
      difficulty: Type.Union([
        Type.Literal("regular"), Type.Literal("hard"), Type.Literal("extreme"), Type.Null(),
      ]),
      bonus_penalty_dice: Type.Number({ minimum: -2, maximum: 2 }),
      accepted_advice_ids: Type.Array(Type.String()),
      overridden_advice_ids: Type.Array(Type.String()),
      reason: Type.String(),
    }),
    npc_ruling: Type.Object({
      npc_id: Type.Union([Type.String(), Type.Null()]),
      tactic: Type.Union([
        "none", "answer", "deflect", "lie", "bargain", "pressure",
        "question", "reassure", "react",
      ].map((value) => Type.Literal(value))),
      fact_id: Type.Union([Type.String(), Type.Null()]),
      reason: Type.String(),
    }),
    narration_plan: Type.Object({
      beat: Type.Union([
        "advance", "deepen", "character", "pressure", "transition",
        "clarify", "aftermath", "quiet",
      ].map((value) => Type.Literal(value))),
      tone: Type.Array(Type.String(), { maxItems: 4 }),
      sensory_focus: Type.Array(Type.String(), { maxItems: 3 }),
      end_with: Type.Union([
        "actionable_hook", "open_question", "consequence", "choice", "silence",
      ].map((value) => Type.Literal(value))),
      objective: Type.String(),
    }),
    rationale: Type.String(),
  });
  const pushRequestType = pushCandidate
    ? Type.Union([
      Type.Null(),
      Type.Object({
        candidate_id: Type.String(),
        changed_method_summary: Type.String(),
      }),
    ])
    : Type.Null();
  function acceptResolution(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new Error("action resolution must be an object");
    }
    let unique = [...new Set(params.matched_affordance_ids || [])];
    let pushRequest = params.push_request ?? null;
    let atoms = Array.isArray(params.normalized_action_atoms) ? params.normalized_action_atoms : [];
    if (request.keeper_proposal_contract) {
      validateKeeperProposal(params, request, atoms);
    }
    if (pushCandidate && pushRequest !== null) {
      let rejectionReason = null;
      if (!pushRequest || typeof pushRequest !== "object" || Array.isArray(pushRequest)) {
        rejectionReason = "malformed_push_request";
      } else if (pushRequest.candidate_id !== pushCandidate.candidate_id) {
        rejectionReason = "candidate_id_mismatch";
      } else if (typeof pushRequest.changed_method_summary !== "string" || !pushRequest.changed_method_summary.trim()) {
        rejectionReason = "changed_method_missing";
      } else if (params.matched_destination_scene_id !== null) {
        rejectionReason = "destination_conflict";
      } else if (params.no_match === true) {
        rejectionReason = "no_match_conflict";
      } else if (unique.some((id) => postArrivalById.has(id))) {
        rejectionReason = "post_arrival_conflict";
      }
      if (rejectionReason) {
        capture.pushBindingRejection = {
          schema_version: 1,
          field: "push_request",
          action: "rejected_to_typed_limitation",
          reason: rejectionReason,
        };
        pushRequest = null;
        unique = [];
        atoms = [];
        params = {
          ...params,
          matched_affordance_ids: [],
          matched_destination_scene_id: null,
          normalized_action_atoms: [],
          push_request: null,
          no_match: true,
        };
      } else {
        // The opaque continuation capability is the sole Push authority.
        // A model may redundantly repeat the ordinary route ID, but it is
        // audit context only and is cleared before canonical settlement.
        if (unique.length) {
          unique = [];
          params = {...params, matched_affordance_ids: []};
        }
        if (atoms.length) {
          capture.pushActionNormalization = {
            schema_version: 1,
            field: "normalized_action_atoms",
            action: "suppressed_for_canonical_push",
            reason: "push_request_owns_exact_failed_action",
            suppressed_atom_count: atoms.length,
          };
          atoms = [];
          params = {...params, normalized_action_atoms: []};
        }
      }
    }
    if (unique.length !== (params.matched_affordance_ids || []).length || unique.some((id) => !allAffordanceIds.has(id))) {
      throw new Error("matched_affordance_ids contains an unknown or duplicate ID");
    }
    if (params.matched_destination_scene_id !== null && !destinationIds.has(params.matched_destination_scene_id)) {
      throw new Error("matched_destination_scene_id is not a candidate");
    }
    const selectedPostArrival = unique.filter((id) => postArrivalById.has(id));
    if (selectedPostArrival.some((id) =>
      params.matched_destination_scene_id === null ||
      postArrivalById.get(id).destination_scene_id !== params.matched_destination_scene_id
    )) {
      throw new Error("post-arrival affordance must bind exactly to its selected destination");
    }
    if (params.no_match && (unique.length || params.matched_destination_scene_id !== null)) {
      throw new Error("no_match cannot select candidates");
    }
    if (atoms.some((atom) => atom && atom.weapon_id !== undefined && !weaponIds.has(atom.weapon_id))) {
      throw new Error("normalized_action_atoms contains an unknown weapon_id");
    }
    if (!pushCandidate && pushRequest !== null) {
      // A model cannot authorize a Push when the canonical projection supplied
      // no eligible origin. Preserve an otherwise bounded ordinary resolution,
      // but record that the impossible field was explicitly discarded.
      capture.pushRequestNormalization = {
        schema_version: 1,
        field: "push_request",
        action: "normalized_to_null",
        reason: "no_push_candidate_supplied",
      };
      pushRequest = null;
    }
    if (pushRequest !== null && (
      typeof pushRequest !== "object" || Array.isArray(pushRequest) ||
      pushRequest.candidate_id !== pushCandidate.candidate_id ||
      typeof pushRequest.changed_method_summary !== "string" ||
      !pushRequest.changed_method_summary.trim() || atoms.length !== 0 ||
      unique.length !== 0 ||
      params.matched_destination_scene_id !== null || params.no_match === true
    )) {
      throw new Error("push_request does not bind the supplied eligible failure exactly");
    }
    capture.result = {
      schema_version: 1,
      evaluator_id: "coc-action-resolver-v1",
      ...params,
      matched_affordance_ids: unique,
      normalized_action_atoms: atoms,
      push_request: pushRequest,
    };
    return capture.result;
  }
  const provider = process.env.COC_ACTION_RESOLVER_MODEL_PROVIDER || "coding-relay";
  const modelId = process.env.COC_ACTION_RESOLVER_MODEL_ID || "gpt-5.6-luna";
  if (provider === "coding-relay") {
    let direct = await callCodingRelay(request, modelId);
    try {
      acceptResolution(direct.params);
    } catch (error) {
      if (!request.keeper_proposal_contract) throw error;
      direct = await callCodingRelay(request, modelId, error.message);
      acceptResolution(direct.params);
    }
    return {
      ok: true,
      action_resolution: capture.result,
      push_request_normalization: capture.pushRequestNormalization,
      push_action_normalization: capture.pushActionNormalization,
      push_binding_rejection: capture.pushBindingRejection,
      model_identity: { provider, id: modelId },
      response_mode: "json",
      usage: direct.usage,
    };
  }
  const tool = defineTool({
    name: "coc_submit_action_resolution",
    label: "Submit COC Action Resolution",
    description: "Submit the bounded semantic binding for this player action.",
    promptGuidelines: [
      "Call exactly once.",
      "Act as the private Keeper; keeper_proposal owns semantic, rule, NPC, and dramatic judgment.",
      "Treat rule_advice as overridable guidance and cite accepted/overridden advice IDs.",
      "Use only supplied candidate IDs.",
      "Post-arrival IDs must share the exact destination; order touched goals from immediate to later.",
      pushCandidate
        ? "Use push_request only for the supplied eligible failure; matched_affordance_ids must be empty for Push."
        : "No push candidate exists; push_request must be null.",
      "After the tool returns, stop.",
    ],
    parameters: Type.Object({
      matched_affordance_ids: Type.Array(Type.String(), { maxItems: 3 }),
      matched_destination_scene_id: Type.Union([Type.String(), Type.Null()]),
      normalized_target_entities: Type.Array(Type.String()),
      normalized_action_atoms: Type.Array(atom, { maxItems: 3 }),
      push_request: pushRequestType,
      primary_intent: intentUnion,
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      reason: Type.String(),
      no_match: Type.Boolean(),
      keeper_proposal: request.keeper_proposal_contract
        ? keeperProposal
        : Type.Optional(keeperProposal),
    }),
    async execute(_id, params) {
      acceptResolution(params);
      return { content: [{ type: "text", text: "action resolution received" }], details: capture.result, terminate: true };
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
  const { model, registry } = resolveModel(agentDir, provider, modelId);
  const created = await createAgentSession({
    cwd: __dirname, agentDir, tools: ["coc_submit_action_resolution"], customTools: [tool],
    model, modelRegistry: registry, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(__dirname),
  });
  let unsubscribe;
  try {
    unsubscribe = created.session.subscribe((event) => {
      const message = event && event.type === "message_end" ? event.message : null;
      if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return;
      const text = message.content
        .filter((item) => item && item.type === "text" && typeof item.text === "string")
        .map((item) => item.text.trim()).filter(Boolean).join("\n").trim();
      if (text) capture.assistantProse = text;
    });
    await created.session.prompt([
      "Plan and adjudicate this player action as the private Keeper.",
      JSON.stringify(request, null, 2),
      pushCandidate
        ? "A Push must bind the one supplied push_candidate exactly."
        : "No push_candidate exists. push_request must be exactly null.",
      "Call coc_submit_action_resolution exactly once. If tool calling is unavailable, " +
        "return only the JSON object matching the tool parameters, with no markdown fence.",
    ].join("\n\n"));
  } finally {
    if (unsubscribe) unsubscribe();
    created.session.dispose();
  }
  let responseMode = "tool";
  if (!capture.result && capture.assistantProse) {
    let prose = capture.assistantProse.trim();
    const fenced = prose.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) prose = fenced[1].trim();
    try {
      const parsed = JSON.parse(prose);
      acceptResolution(parsed.action_resolution || parsed);
      responseMode = "json_fallback";
    } catch (error) {
      throw new Error(`model returned invalid action-resolution JSON fallback: ${error.message}`);
    }
  }
  if (!capture.result) throw new Error("model did not submit an action resolution");
  return {
    ok: true,
    action_resolution: capture.result,
    push_request_normalization: capture.pushRequestNormalization,
    push_action_normalization: capture.pushActionNormalization,
    push_binding_rejection: capture.pushBindingRejection,
    model_identity: { provider: model.provider, id: model.id },
    response_mode: responseMode,
  };
}

try {
  process.stdout.write(`${JSON.stringify(await run(await readStdinJson()))}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
