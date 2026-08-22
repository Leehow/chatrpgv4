/**
 * Closed Pi-Coc domain wrappers over the one canonical gateway.
 * ACL is execute-time policy, never setActiveTools.
 */
import { statSync } from "node:fs";
import path from "node:path";
import {
  DOMAIN_TOOL_NAMES,
  HOST_INVOKE_COMPAT_OPERATIONS,
  OPERATION_POLICY,
  OPERATIONS_BY_SURFACE,
  SESSION_ROLES,
  sessionRolesForPolicy,
  SOURCE_WORKER_LIFECYCLE_OPERATIONS,
  type DomainToolName,
  type KpSurface,
  type PlayPhase,
  type SessionRole,
} from "./operation-policy.ts";
import { extraToolsForSessionRole } from "./session-role-tools.ts";
import {
  isTypedOperationTool,
  operationForTypedTool,
  typedToolsForSurfacePhase,
} from "./typed-tools.ts";

export {
  DOMAIN_TOOL_NAMES,
  OPERATION_POLICY,
  OPERATIONS_BY_SURFACE,
  HOST_INVOKE_COMPAT_OPERATIONS,
  SOURCE_WORKER_LIFECYCLE_OPERATIONS,
};
export type { DomainToolName, PlayPhase, SessionRole };
export { SESSION_ROLES, sessionRolesForPolicy };

const SESSION_ROLE_ENV = "COC_PI_SESSION_ROLE";

/** Canonical caller: evaluateExecuteAcl / activeToolsForPhase. Consumer: Pi dual-session host. */
export function sessionRoleFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SessionRole | null {
  const raw = env[SESSION_ROLE_ENV];
  if (raw == null || raw === "") return null;
  if ((SESSION_ROLES as readonly string[]).includes(raw)) {
    return raw as SessionRole;
  }
  console.warn(
    `[coc] ${SESSION_ROLE_ENV}=${JSON.stringify(raw)} is not setup|play; role ACL disabled (legacy)`,
  );
  return null;
}

function operationAllowedForSessionRole(
  operation: string,
  policy: { audience: string; kp_surface: KpSurface },
  role: SessionRole,
): boolean {
  return sessionRolesForPolicy(operation, policy as typeof OPERATION_POLICY[string]).includes(role);
}

export const HIDDEN_COMPAT_INVOKE = "coc_invoke";
export const TRANSPORT_TOOL = "coc_invoke";

const SURFACE_BY_TOOL: Record<DomainToolName, Exclude<KpSurface, "none">> = {
  coc_context: "context",
  coc_rules: "rules",
  coc_state: "state",
  coc_npc: "npc",
  coc_turn: "turn",
  coc_setup: "setup",
  coc_advice: "advice",
  coc_subsystem: "subsystem",
};

const TOOL_BY_SURFACE = Object.fromEntries(
  Object.entries(SURFACE_BY_TOOL).map(([tool, surface]) => [surface, tool]),
) as Record<Exclude<KpSurface, "none">, DomainToolName>;

export function surfaceForDomainTool(name: string): Exclude<KpSurface, "none"> | null {
  return name in SURFACE_BY_TOOL ? SURFACE_BY_TOOL[name as DomainToolName] : null;
}

export function domainToolForOperation(operation: string): DomainToolName | null {
  const policy = OPERATION_POLICY[operation];
  if (!policy || policy.kp_surface === "none") return null;
  return TOOL_BY_SURFACE[policy.kp_surface];
}

export function isDomainToolName(name: string): name is DomainToolName {
  return (DOMAIN_TOOL_NAMES as readonly string[]).includes(name);
}

export function isCanonicalInvokeSurface(name: string): boolean {
  return name === HIDDEN_COMPAT_INVOKE || isDomainToolName(name) || isTypedOperationTool(name);
}

export function operationsForSurface(surface: Exclude<KpSurface, "none">): readonly string[] {
  return OPERATIONS_BY_SURFACE[surface];
}

export function domainToolSchema(name: DomainToolName) {
  const operations = OPERATIONS_BY_SURFACE[SURFACE_BY_TOOL[name]];
  return {
    type: "object",
    properties: {
      operation: { type: "string", enum: [...operations] },
      root: { type: "string" },
      campaign: { type: "string" },
      arguments: {
        anyOf: [
          { type: "object", additionalProperties: true },
          { type: "string" },
        ],
      },
    },
    required: ["operation"],
    additionalProperties: false,
  } as const;
}

export type AclDecision =
  | {
    ok: true;
    wrapper: string;
    transport_tool: typeof TRANSPORT_TOOL;
    operation: string;
    canonical_operation: string;
  }
  | {
    ok: false;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    hints?: string[];
  };

const ACL_SUGGESTION_CAP = 12;

function aclDenied(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  hints?: string[],
): AclDecision {
  return { ok: false, code, message, details, hints };
}

function operationsLegalOnSurface(
  phase: PlayPhase,
  surface: Exclude<KpSurface, "none"> | "none",
): string[] {
  if (surface === "none") return [];
  const names: string[] = [];
  for (const [operation, policy] of Object.entries(OPERATION_POLICY)) {
    if (policy.kp_surface !== surface) continue;
    if (!policy.phases.includes(phase)) continue;
    if (
      policy.audience === "source_worker"
      || policy.audience === "audit"
      || SOURCE_WORKER_LIFECYCLE_OPERATIONS.has(operation)
    ) continue;
    names.push(operation);
  }
  names.sort();
  return names;
}

function phaseForbidden(
  operation: string,
  policy: typeof OPERATION_POLICY[string],
  phase: PlayPhase,
): AclDecision {
  const legal = operationsLegalOnSurface(phase, policy.kp_surface);
  const shown = legal.slice(0, ACL_SUGGESTION_CAP);
  return aclDenied(
    "phase_forbidden",
    `operation ${operation} is not allowed in phase ${phase}`,
    {
      operation,
      phase,
      allowed_phases: [...policy.phases],
      currently_legal_on_this_surface: shown,
    },
    [
      `this operation is legal in: ${policy.phases.join(", ")}`,
      shown.length > 0
        ? `currently legal on this surface: ${shown.join(", ")}`
        : "no operations on this surface are legal in the current phase",
    ],
  );
}

function roleForbidden(operation: string, policy: typeof OPERATION_POLICY[string]): AclDecision | null {
  const role = sessionRoleFromEnv();
  if (!role) return null;
  if (operationAllowedForSessionRole(operation, policy, role)) return null;
  const allowedRoles = sessionRolesForPolicy(operation, policy);
  return aclDenied(
    "role_forbidden",
    `operation ${operation} is not allowed in session role ${role}`,
    { operation, role, allowed_roles: [...allowedRoles] },
    [
      allowedRoles.length > 0
        ? `this operation belongs to session role ${allowedRoles.join(" / ")}`
        : "this operation is not on the setup or play KP surface",
    ],
  );
}

export function modelVisibleAclFailure(
  acl: Extract<AclDecision, { ok: false }>,
  toolName: string,
): Record<string, unknown> {
  return {
    ok: false,
    isError: true,
    tool: toolName,
    error: {
      code: acl.code,
      message: acl.message,
      retryable: false,
      ...(acl.details ? { details: acl.details } : {}),
    },
    hints: acl.hints ?? [],
  };
}

export function evaluateExecuteAcl(args: {
  toolName: string;
  operation: string;
  phase: PlayPhase;
}): AclDecision {
  const typedOperation = operationForTypedTool(args.toolName);
  const operation = (args.operation.trim() || typedOperation || "");
  const policy = OPERATION_POLICY[operation];
  if (!policy) {
    return aclDenied(
      "unknown_operation",
      `unknown canonical operation: ${operation}`,
      { operation },
      ["use a typed operation tool whose name maps to an archive contract"],
    );
  }
  if (
    policy.audience === "source_worker"
    || policy.audience === "audit"
    || SOURCE_WORKER_LIFECYCLE_OPERATIONS.has(operation)
  ) {
    return aclDenied(
      "private_lifecycle_operation",
      "canonical operation is reserved for the private source coordinator lifecycle",
      { operation },
      ["do not call private source-coordinator operations from the live KP path"],
    );
  }
  if (policy.kp_surface === "none") {
    const compat = (
      args.toolName === HIDDEN_COMPAT_INVOKE
      && HOST_INVOKE_COMPAT_OPERATIONS.has(operation)
    );
    if (!compat) {
      return aclDenied(
        "host_private_operation",
        `operation ${operation} is not on the live KP domain surface`,
        { operation },
        ["use a typed operation tool on the live KP surface; do not call coc_invoke for host-private ops"],
      );
    }
    if (!policy.phases.includes(args.phase)) {
      return phaseForbidden(operation, policy, args.phase);
    }
    const compatRoleDenied = roleForbidden(operation, policy);
    if (compatRoleDenied) return compatRoleDenied;
    return {
      ok: true,
      wrapper: HIDDEN_COMPAT_INVOKE,
      transport_tool: TRANSPORT_TOOL,
      operation,
      canonical_operation: operation,
    };
  }
  const expectedTool = TOOL_BY_SURFACE[policy.kp_surface];
  if (typedOperation && typedOperation !== operation) {
    return aclDenied(
      "domain_mismatch",
      `operation ${operation} belongs to ${expectedTool}, not ${args.toolName}`,
      { operation, expected_tool: expectedTool, tool: args.toolName },
      [`call the typed tool for ${operation}, not ${args.toolName}`],
    );
  }
  if (
    args.toolName !== HIDDEN_COMPAT_INVOKE
    && args.toolName !== expectedTool
    && typedOperation !== operation
  ) {
    return aclDenied(
      "domain_mismatch",
      `operation ${operation} belongs to ${expectedTool}, not ${args.toolName}`,
      { operation, expected_tool: expectedTool, tool: args.toolName },
      [`call ${expectedTool} or the typed tool for ${operation}`],
    );
  }
  if (!policy.phases.includes(args.phase)) {
    return phaseForbidden(operation, policy, args.phase);
  }
  const roleDenied = roleForbidden(operation, policy);
  if (roleDenied) return roleDenied;
  return {
    ok: true,
    wrapper: (
      args.toolName === HIDDEN_COMPAT_INVOKE || typedOperation
        ? expectedTool
        : args.toolName
    ),
    transport_tool: TRANSPORT_TOOL,
    operation,
    canonical_operation: operation,
  };
}

export function activeToolsForPhase(phase: PlayPhase, role?: SessionRole | null): string[] {
  const core = ["subagent", "subagent_wait"] as const;
  let tools: string[];
  if (phase === "pending_finalization") {
    tools = [...core, "coc_turn", "coc_context", "coc_state", "coc_advice"];
  } else if (phase === "ending" || phase === "recovery") {
    tools = [...core, "coc_setup", "coc_context", "coc_turn", "coc_state"];
  } else if (phase === "opening" || phase === "cold_start") {
    tools = [...core, "coc_setup", "coc_context", "coc_turn", "coc_rules", "coc_state"];
  } else {
    tools = [
      ...core,
      "coc_context",
      "coc_rules",
      "coc_state",
      "coc_npc",
      "coc_turn",
      "coc_subsystem",
      "coc_advice",
    ];
  }
  const sessionRole = role === undefined ? sessionRoleFromEnv() : role;
  if (sessionRole) {
    const next: string[] = [];
    for (const name of tools) {
      if (!(DOMAIN_TOOL_NAMES as readonly string[]).includes(name)) {
        next.push(name);
        continue;
      }
      const surface = SURFACE_BY_TOOL[name as DomainToolName];
      for (const typed of typedToolsForSurfacePhase(surface, phase, sessionRole)) {
        if (!next.includes(typed)) next.push(typed);
      }
    }
    tools = next;
  }
  for (const extra of extraToolsForSessionRole(sessionRole)) {
    if (!tools.includes(extra)) tools.push(extra);
  }
  return tools;
}

/** Safe visibility union. Execute ACL / startupResumeToolError stay authoritative. */
export function unionActiveToolsForPhases(
  phases: readonly PlayPhase[],
  role?: SessionRole | null,
): string[] {
  const seen = new Set<string>();
  const tools: string[] = [];
  for (const phase of phases) {
    for (const tool of activeToolsForPhase(phase, role)) {
      if (seen.has(tool)) continue;
      seen.add(tool);
      tools.push(tool);
    }
  }
  return tools;
}

/**
 * Startup pending schema: recovery tools plus the campaign/resume projection.
 * Never shrink an already-live table back to recovery-only.
 */
export function activeToolsForStartupResumePending(args: {
  workspaceRoot: string;
  campaignId: string;
  fallbackPhase: PlayPhase;
  role?: SessionRole | null;
}): string[] {
  const projected = projectPlayPhaseFromCampaignEvidence(
    args.workspaceRoot,
    args.campaignId,
    args.fallbackPhase,
  );
  return unionActiveToolsForPhases(["recovery", projected], args.role);
}

export function projectPlayPhaseFromCampaignEvidence(
  root: string,
  campaignId: string,
  fallbackPhase: PlayPhase = "opening",
): PlayPhase {
  if (campaignHasStartedTableEvidence(root, campaignId)) return "live_turn";
  if (
    fallbackPhase === "live_turn"
    || fallbackPhase === "pending_finalization"
    || fallbackPhase === "opening"
    || fallbackPhase === "cold_start"
  ) {
    return fallbackPhase === "cold_start" ? "opening" : fallbackPhase;
  }
  return "opening";
}

function resumeSignalsIncompleteOpening(
  data: Record<string, unknown>,
  mode: string,
): boolean {
  if (mode.startsWith("opening_") || mode.includes("character_setup")) return true;
  const gate = data.opening_gate && typeof data.opening_gate === "object"
    && !Array.isArray(data.opening_gate)
    ? data.opening_gate as Record<string, unknown>
    : null;
  const gatePhase = typeof gate?.phase === "string" ? gate.phase : "";
  if (gatePhase.startsWith("opening_") || gatePhase.includes("character_setup")) return true;
  if (Array.isArray(data.investigators) && data.investigators.length === 0) return true;
  if (Array.isArray(data.party) && data.party.length === 0) return true;
  if (data.character_creation && typeof data.character_creation === "object") return true;
  return false;
}

const SAFE_CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STARTED_TABLE_TURN_TOOLS = new Set([
  "evidence.table_opening",
  "turn.finalize",
  "turn.output_context",
  "state.journal",
  "rules.roll",
  "rules.social_adjudicate",
  "rules.check",
  "npc.reaction",
]);

/** Optional host-local extras when the resume envelope aliases live play as table_opening. */
export type PhaseInferenceContext = {
  tableStarted?: boolean;
  workspaceRoot?: string;
  campaignId?: string;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveTurn(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonemptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Read-only host probe: a non-empty table transcript means opening already started. */
export function campaignHasStartedTableEvidence(
  root: string,
  campaignId: string,
): boolean {
  const id = campaignId.trim();
  if (!root || !SAFE_CAMPAIGN_ID.test(id)) return false;
  const transcript = path.join(
    root,
    ".coc",
    "campaigns",
    id,
    "logs",
    "table-transcript.jsonl",
  );
  try {
    const st = statSync(transcript);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function resumeSignalsStartedTable(data: Record<string, unknown>): boolean {
  const checkpoint = objectRecord(data.checkpoint);
  const scene = objectRecord(data.scene_context);
  const pendingOut = objectRecord(data.pending_output_context);
  const capsule = objectRecord(data.semantic_capsule);
  const delivery = objectRecord(data.delivery);
  const currentTurn = objectRecord(data.current_turn);
  const pendingTurn = objectRecord(data.pending_turn);
  const source = objectRecord(checkpoint?.source);
  if (
    positiveTurn(checkpoint?.turn_number)
    || positiveTurn(scene?.turn_number)
    || positiveTurn(pendingOut?.turn_number)
    || positiveTurn(capsule?.updated_from_turn)
  ) {
    return true;
  }
  if (nonemptyString(source?.finalization_id)) return true;
  if (nonemptyString(delivery?.finalization_id) || nonemptyString(delivery?.rendered_sha256)) {
    return true;
  }
  const windows = [currentTurn, pendingTurn, pendingOut];
  for (const window of windows) {
    const rows = Array.isArray(window?.rows) ? window.rows : [];
    for (const row of rows) {
      const rec = objectRecord(row);
      const tool = typeof rec?.tool === "string" ? rec.tool : "";
      if (STARTED_TABLE_TURN_TOOLS.has(tool)) return true;
    }
  }
  return false;
}

function hostLocalTableStarted(
  data: Record<string, unknown>,
  context?: PhaseInferenceContext,
): boolean {
  if (context?.tableStarted === true) return true;
  const root = typeof context?.workspaceRoot === "string" ? context.workspaceRoot : "";
  const campaignId = nonemptyString(context?.campaignId)
    ? String(context?.campaignId).trim()
    : typeof data.campaign_id === "string" ? data.campaign_id.trim() : "";
  if (!root || !campaignId) return false;
  return campaignHasStartedTableEvidence(root, campaignId);
}

export function playPhaseFromResumeData(
  data: Record<string, unknown> | null,
  context?: PhaseInferenceContext,
): PlayPhase | null {
  if (!data) return null;
  const mode = typeof data.mode === "string" ? data.mode : "";
  if (mode === "ending") return "ending";
  if (mode === "pending_finalization" || data.pending_output_context) {
    return "pending_finalization";
  }
  if (mode === "open_turn_recovery") return "recovery";
  // ready_for_table resumes keep mode=table_opening even after opening/play.
  // Do not map every table_opening to live_turn: a fresh handoff stays opening.
  if (mode === "table_opening") {
    // Canonical recovery evidence beats the coarse host-local transcript
    // probe. A real played turn/finalization is live even if an older bridge
    // still emits a stale opening next-operation.
    if (resumeSignalsStartedTable(data)) {
      return "live_turn";
    }
    // Setup can already have committed and delivered the turn-0 opening before
    // setup.complete.  That persisted transcript is stronger evidence than a
    // stale ready_for_table next-operation: exposing the opening tool again
    // makes it fail with opening_already_started and encourages duplicate prose.
    if (hostLocalTableStarted(data, context)) return "live_turn";
    return "opening";
  }
  if (resumeSignalsIncompleteOpening(data, mode)) return "opening";
  if (mode === "already_acknowledged" || mode === "awaiting_player") return "live_turn";
  return null;
}

function resumeEnvelopeData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)) {
    return rec.data as Record<string, unknown>;
  }
  return rec;
}

/**
 * Play-role auto-open is already satisfied: resume is live `awaiting_player`
 * and the table opening already exists. Do not trigger a new opening turn.
 */
export function resumeSatisfiesPlayAutoOpen(
  value: unknown,
  context?: PhaseInferenceContext,
): boolean {
  const data = resumeEnvelopeData(value);
  if (!data) return false;
  if (data.mode !== "awaiting_player") return false;
  const next = Array.isArray(data.next_operations) ? data.next_operations : [];
  if (next.includes("evidence.table_opening")) return false;
  const evidence = objectRecord(data.evidence);
  if (evidence && (evidence.table_opening || evidence.table_opening_id)) {
    return true;
  }
  if (resumeSignalsStartedTable(data) || hostLocalTableStarted(data, context)) {
    return true;
  }
  // Toolbox remaps unopened ready_for_table to mode=table_opening.
  return true;
}

export function inferPhaseFromEnvelope(
  operation: string,
  value: unknown,
  previous: PlayPhase,
  context?: PhaseInferenceContext,
): PlayPhase {
  const envelope = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const data = envelope && envelope.data && typeof envelope.data === "object"
    ? envelope.data as Record<string, unknown>
    : null;
  if (operation === "session.resume") {
    const fromResume = playPhaseFromResumeData(data, context);
    if (fromResume !== null) {
      // Same-session mid-play resume may still alias as table_opening.
      // Never demote an already-live table back to opening ACL.
      if (
        fromResume === "opening"
        && data?.mode === "table_opening"
        && (
          previous === "live_turn"
          || previous === "pending_finalization"
          || previous === "recovery"
        )
      ) {
        return previous;
      }
      return fromResume;
    }
    // Bare ok never proves live play; coc_setup keeps guiding chargen.
    if (envelope?.ok === true && (previous === "opening" || previous === "cold_start")) {
      return "opening";
    }
  }
  if (operation === "turn.finalize" && envelope?.ok === true) {
    return previous === "ending" ? "ending" : "live_turn";
  }
  if (operation === "state.end_session" && envelope?.ok === true) return "ending";
  if (operation === "evidence.table_opening" && envelope?.ok === true) {
    return "live_turn";
  }
  if (
    previous !== "pending_finalization"
    && previous !== "recovery"
    && previous !== "ending"
    && envelope?.ok === true
    && campaignBoundOpeningReceipt(operation, data)
  ) {
    return "opening";
  }
  return previous;
}

const OPENING_BIND_KINDS = new Set([
  "campaign.create",
  "campaign.quick_start",
  "campaign.link_investigator",
  "scenario.bind_pdf",
]);

function campaignBoundOpeningReceipt(
  operation: string,
  data: Record<string, unknown> | null,
): boolean {
  if (operation === "setup.quick_start") return true;
  const kind = typeof data?.kind === "string" ? data.kind : "";
  if (operation === "setup.invoke" && OPENING_BIND_KINDS.has(kind)) return true;
  if (operation === "scenario.bind_pdf") return true;
  return false;
}

export function inferPhaseFromError(error: { code?: string } | null): PlayPhase | null {
  if (error?.code === "turn_pending_finalization") return "pending_finalization";
  return null;
}

export function classifyToolCall(toolName: string, args: unknown): {
  wrapper_tool: string;
  transport_tool: string | null;
  canonical_operation: string | null;
  label: string;
} {
  const record = args && typeof args === "object" && !Array.isArray(args)
    ? args as Record<string, unknown>
    : null;
  const operation = typeof record?.operation === "string" && record.operation
    ? record.operation
    : null;
  const typedFromName = operationForTypedTool(toolName);
  const resolvedOperation = operation ?? typedFromName;
  if (isCanonicalInvokeSurface(toolName) && resolvedOperation) {
    const mapped = domainToolForOperation(resolvedOperation);
    return {
      wrapper_tool: toolName === HIDDEN_COMPAT_INVOKE || typedFromName
        ? (mapped ?? toolName)
        : toolName,
      transport_tool: TRANSPORT_TOOL,
      canonical_operation: resolvedOperation,
      label: `${toolName}.${resolvedOperation}`,
    };
  }
  if (operation) {
    return {
      wrapper_tool: toolName,
      transport_tool: null,
      canonical_operation: operation,
      label: `${toolName}.${operation}`,
    };
  }
  return {
    wrapper_tool: toolName,
    transport_tool: null,
    canonical_operation: null,
    label: toolName,
  };
}

export const DOMAIN_TOOL_LABELS: Record<DomainToolName, string> = {
  coc_context: "COC context",
  coc_rules: "COC rules",
  coc_state: "COC state",
  coc_npc: "COC npc",
  coc_turn: "COC turn",
  coc_setup: "COC setup",
  coc_advice: "COC advice (optional)",
  coc_subsystem: "COC subsystem",
};

export const DOMAIN_TOOL_DESCRIPTIONS: Record<DomainToolName, string> = {
  coc_context: "Query scene, clues, secrets, and steward deliveries. No steward writes.",
  coc_rules: "Execute one closed rules.* dice or arithmetic operation.",
  coc_state: "Apply one closed state.* campaign mutation or inventory query.",
  coc_npc: "Query an NPC or settle one first-impression reaction.",
  coc_turn: "Build output context, journal, or hash-bound turn.finalize.",
  coc_setup: "Campaign inspect/create, opening, resume, and source-facts setup.",
  coc_advice: "Optional advisory Director/narration/action suggestions. Never a gate.",
  coc_subsystem: "Enter or advance combat, chase, sanity, or mechanics.ensure. Player attacks and shots require combat.resolve; never substitute rules.roll.",
};
