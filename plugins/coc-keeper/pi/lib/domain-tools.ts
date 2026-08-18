/**
 * Closed Pi-Coc domain wrappers over the one canonical gateway.
 * ACL is execute-time policy, never setActiveTools.
 */
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
  return name === HIDDEN_COMPAT_INVOKE || isDomainToolName(name);
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
  | { ok: false; code: string; message: string };

function roleForbidden(operation: string, policy: typeof OPERATION_POLICY[string]): AclDecision | null {
  const role = sessionRoleFromEnv();
  if (!role) return null;
  if (operationAllowedForSessionRole(operation, policy, role)) return null;
  return {
    ok: false,
    code: "role_forbidden",
    message: `operation ${operation} is not allowed in session role ${role}`,
  };
}

export function evaluateExecuteAcl(args: {
  toolName: string;
  operation: string;
  phase: PlayPhase;
}): AclDecision {
  const operation = args.operation.trim();
  const policy = OPERATION_POLICY[operation];
  if (!policy) {
    return {
      ok: false,
      code: "unknown_operation",
      message: `unknown canonical operation: ${operation}`,
    };
  }
  if (
    policy.audience === "source_worker"
    || policy.audience === "audit"
    || SOURCE_WORKER_LIFECYCLE_OPERATIONS.has(operation)
  ) {
    return {
      ok: false,
      code: "private_lifecycle_operation",
      message: "canonical operation is reserved for the private source coordinator lifecycle",
    };
  }
  if (policy.kp_surface === "none") {
    const compat = (
      args.toolName === HIDDEN_COMPAT_INVOKE
      && HOST_INVOKE_COMPAT_OPERATIONS.has(operation)
    );
    if (!compat) {
      return {
        ok: false,
        code: "host_private_operation",
        message: `operation ${operation} is not on the live KP domain surface`,
      };
    }
    if (!policy.phases.includes(args.phase)) {
      return {
        ok: false,
        code: "phase_forbidden",
        message: `operation ${operation} is not allowed in phase ${args.phase}`,
      };
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
  if (args.toolName !== HIDDEN_COMPAT_INVOKE && args.toolName !== expectedTool) {
    return {
      ok: false,
      code: "domain_mismatch",
      message: `operation ${operation} belongs to ${expectedTool}, not ${args.toolName}`,
    };
  }
  if (!policy.phases.includes(args.phase)) {
    return {
      ok: false,
      code: "phase_forbidden",
      message: `operation ${operation} is not allowed in phase ${args.phase}`,
    };
  }
  const roleDenied = roleForbidden(operation, policy);
  if (roleDenied) return roleDenied;
  return {
    ok: true,
    wrapper: args.toolName === HIDDEN_COMPAT_INVOKE ? expectedTool : args.toolName,
    transport_tool: TRANSPORT_TOOL,
    operation,
    canonical_operation: operation,
  };
}

export function activeToolsForPhase(phase: PlayPhase, role?: SessionRole | null): string[] {
  const core = ["read", "subagent", "subagent_wait"] as const;
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
  if (!sessionRole) return tools;
  return tools.filter((name) => {
    if (!(DOMAIN_TOOL_NAMES as readonly string[]).includes(name)) return true;
    const surface = SURFACE_BY_TOOL[name as DomainToolName];
    return OPERATIONS_BY_SURFACE[surface].some((operation) => {
      const policy = OPERATION_POLICY[operation];
      return (
        policy
        && policy.phases.includes(phase)
        && operationAllowedForSessionRole(operation, policy, sessionRole)
      );
    });
  });
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

export function playPhaseFromResumeData(data: Record<string, unknown> | null): PlayPhase | null {
  if (!data) return null;
  const mode = typeof data.mode === "string" ? data.mode : "";
  if (mode === "pending_finalization" || data.pending_output_context) {
    return "pending_finalization";
  }
  if (mode === "open_turn_recovery") return "recovery";
  if (resumeSignalsIncompleteOpening(data, mode)) return "opening";
  if (mode === "already_acknowledged" || mode === "awaiting_player") return "live_turn";
  return null;
}

export function inferPhaseFromEnvelope(
  operation: string,
  value: unknown,
  previous: PlayPhase,
): PlayPhase {
  const envelope = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const data = envelope && envelope.data && typeof envelope.data === "object"
    ? envelope.data as Record<string, unknown>
    : null;
  if (operation === "session.resume") {
    const fromResume = playPhaseFromResumeData(data);
    if (fromResume !== null) return fromResume;
    // Bare ok never proves live play; coc_setup keeps guiding chargen.
    if (envelope?.ok === true && (previous === "opening" || previous === "cold_start")) {
      return "opening";
    }
  }
  if (operation === "turn.finalize" && envelope?.ok === true) return "live_turn";
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
  if (isCanonicalInvokeSurface(toolName) && operation) {
    const mapped = domainToolForOperation(operation);
    return {
      wrapper_tool: toolName === HIDDEN_COMPAT_INVOKE ? (mapped ?? toolName) : toolName,
      transport_tool: TRANSPORT_TOOL,
      canonical_operation: operation,
      label: `${toolName}.${operation}`,
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
  coc_subsystem: "Enter or advance combat, chase, sanity, or mechanics.ensure.",
};
