/**
 * Provider-neutral projection of the Pi-Coc model-visible tool working set.
 *
 * This module owns visibility only. Canonical operation policy and the
 * execute-time ACL remain authoritative, and callers retain load grants.
 */
import {
  KP_SURFACES,
  OPERATION_POLICY,
  PLAY_PHASES,
  sessionRolesForPolicy,
  type KpSurface,
  type PlayPhase,
  type SessionRole,
} from "./operation-policy.ts";
import {
  defaultTypedToolCatalog,
  typedToolForOperation,
  type TypedToolCatalog,
} from "./typed-tools.ts";

export const TURN_STAGES = [
  "acting",
  "journaled",
  "output_context",
  "review",
  "finalized",
  "faulted",
] as const;
export type TurnStage = typeof TURN_STAGES[number];

export type WorkingSetNamespace = Exclude<KpSurface, "none">;

export const WORKING_SET_TOOL_BUDGET = 20;
export const CLOSURE_TOOL_BUDGET = 10;
export const NAMESPACE_OPERATION_BUDGET = 10;
export const WORKING_SET_DISCOVERY_TOOL = "coc_discover";
export const WORKING_SET_HOST_TOOLS = [
  "subagent",
  "subagent_wait",
  "coc_source_assets",
  WORKING_SET_DISCOVERY_TOOL,
] as const;

export type CanonicalAffordanceSource =
  | "scene"
  | "combat"
  | "chase"
  | "sanity"
  | "npc"
  | "turn"
  | "recovery"
  | "host";

export type CanonicalAffordanceHint = {
  operation: string;
  source: CanonicalAffordanceSource;
};

export type CanonicalAffordanceProjection = {
  operations?: readonly CanonicalAffordanceHint[];
};

type LoadScope = {
  role: SessionRole;
  phase: PlayPhase;
  stage: TurnStage;
  playerTurnEpoch: number;
  canonicalProgressRevision: string;
};

export type LoadedNamespace = LoadScope & {
  kind: "namespace";
  namespace: WorkingSetNamespace;
  operations: readonly string[];
};

export type LoadedExactOperation = LoadScope & {
  kind: "exact_operation";
  operation: string;
};

export type RecoveryRoute = {
  code: string;
  operations: readonly string[];
};

export type ToolWorkingSetSnapshot = LoadScope & {
  affordances?: CanonicalAffordanceProjection;
  loadedNamespaces?: readonly LoadedNamespace[];
  loadedOperations?: readonly LoadedExactOperation[];
  recoveryRoute?: RecoveryRoute;
};

export type WorkingSetReasonCode =
  | "host_baseline"
  | "stage_baseline"
  | "canonical_affordance"
  | "loaded_namespace"
  | "loaded_exact_operation"
  | "recovery_route"
  | "expired_load"
  | "policy_filtered"
  | "stage_filtered";

export type WorkingSetReason = {
  code: WorkingSetReasonCode;
  operation?: string;
  source?: string;
};

export type WorkingSetFailureCode =
  | "invalid_snapshot"
  | "working_set_budget_exceeded";

export type WorkingSetFailure = {
  code: WorkingSetFailureCode;
  message: string;
  details: Record<string, unknown>;
};

export type ToolWorkingSet = {
  ok: boolean;
  revision: string;
  activeToolNames: readonly string[];
  activeOperationNames: readonly string[];
  /** Bytes for canonical typed-operation schemas; host adapters add static host-tool schemas. */
  schemaBytes: number;
  reasons: readonly WorkingSetReason[];
  error?: WorkingSetFailure;
};

export type NamespaceLoadRequest =
  | { kind: "exact_operation"; operation: string }
  | { kind: "namespace"; namespace: WorkingSetNamespace };

export type WorkingSetLoadFailureCode =
  | "invalid_snapshot"
  | "unknown_operation"
  | "unknown_namespace"
  | "policy_forbidden"
  | "role_forbidden"
  | "phase_forbidden"
  | "stage_forbidden"
  | "namespace_unavailable"
  | "namespace_too_large"
  | "working_set_budget_exceeded";

export type ToolWorkingSetLoadResult =
  | {
    ok: true;
    grant: LoadedNamespace | LoadedExactOperation;
    workingSet: ToolWorkingSet;
  }
  | {
    ok: false;
    code: WorkingSetLoadFailureCode;
    message: string;
    details: Record<string, unknown>;
  };

const PLAY_ACTING_BASELINE = [
  "scene.context",
  "actions.list",
  "rules.roll",
  "rules.check",
  "npc.query",
  "state.journal",
] as const;

const SETUP_BASELINE = [
  "setup.inspect",
  "setup.phase",
  "session.resume",
  "progressive.prepare_opening",
  "progressive.opening_bootstrap",
  "evidence.table_opening",
  "rules.roll_dice",
  "rules.cash_assets",
  "state.cash_semantic",
] as const;

const BASELINE_BY_STAGE: Record<TurnStage, readonly string[]> = {
  acting: PLAY_ACTING_BASELINE,
  journaled: ["scene.context", "turn.output_context"],
  output_context: ["narration.review"],
  review: ["narration.review", "turn.finalize"],
  finalized: [],
  faulted: ["session.resume"],
};

const ALLOWED_BY_CLOSURE_STAGE: Record<Exclude<TurnStage, "acting">, ReadonlySet<string>> = {
  journaled: new Set(["scene.context", "turn.output_context"]),
  output_context: new Set(["narration.review"]),
  review: new Set(["narration.review", "turn.finalize"]),
  finalized: new Set(),
  faulted: new Set(["session.resume"]),
};

function validRole(value: unknown): value is SessionRole {
  return value === "setup" || value === "play";
}

function validPhase(value: unknown): value is PlayPhase {
  return (PLAY_PHASES as readonly unknown[]).includes(value);
}

function validStage(value: unknown): value is TurnStage {
  return (TURN_STAGES as readonly unknown[]).includes(value);
}

function validNamespace(value: unknown): value is WorkingSetNamespace {
  return value !== "none" && (KP_SURFACES as readonly unknown[]).includes(value);
}

function contextKey(scope: LoadScope): string {
  return [
    scope.role,
    scope.phase,
    scope.stage,
    `epoch-${scope.playerTurnEpoch}`,
    `progress-${scope.canonicalProgressRevision}`,
  ].join(":");
}

function loadMatchesSnapshot(load: LoadScope, snapshot: ToolWorkingSetSnapshot): boolean {
  return contextKey(load) === contextKey(snapshot);
}

function policyAllows(operation: string, snapshot: ToolWorkingSetSnapshot): boolean {
  const policy = OPERATION_POLICY[operation];
  if (!policy || policy.kp_surface === "none") return false;
  if (!policy.phases.includes(snapshot.phase)) return false;
  if (!sessionRolesForPolicy(operation, policy).includes(snapshot.role)) return false;
  return true;
}

function stageAllows(operation: string, snapshot: ToolWorkingSetSnapshot): boolean {
  if (snapshot.stage === "finalized") return false;
  if (snapshot.stage === "faulted") {
    return snapshot.phase === "recovery" && operation === "session.resume";
  }
  if (snapshot.recoveryRoute?.operations.includes(operation)) return true;
  const effectiveStage = snapshot.phase === "pending_finalization" && snapshot.stage === "acting"
    ? "journaled"
    : snapshot.stage;
  if (effectiveStage === "acting") return true;
  return ALLOWED_BY_CLOSURE_STAGE[effectiveStage].has(operation);
}

function typedOperationExists(operation: string, catalog: TypedToolCatalog): boolean {
  return typedToolForOperation(operation, catalog) !== null;
}

function baselineOperations(snapshot: ToolWorkingSetSnapshot): readonly string[] {
  if (snapshot.role === "setup") return SETUP_BASELINE;
  if (snapshot.phase === "recovery") return [
    "session.resume",
    "state.journal",
    "turn.output_context",
    "turn.finalize",
  ];
  if (snapshot.phase === "pending_finalization" || snapshot.phase === "ending") {
    if (snapshot.phase === "pending_finalization" && snapshot.stage === "acting") {
      return BASELINE_BY_STAGE.journaled;
    }
    if (snapshot.phase === "ending" && snapshot.stage === "acting") {
      return ["state.journal"];
    }
    return BASELINE_BY_STAGE[snapshot.stage];
  }
  if (snapshot.phase === "opening" || snapshot.phase === "cold_start") {
    return ["session.resume", "scene.context", "actions.list", "evidence.table_opening"];
  }
  return BASELINE_BY_STAGE[snapshot.stage];
}

function workingSetBudget(snapshot: ToolWorkingSetSnapshot): number {
  return snapshot.phase === "pending_finalization"
    || snapshot.phase === "recovery"
    || snapshot.phase === "ending"
    || snapshot.stage !== "acting"
    ? CLOSURE_TOOL_BUDGET
    : WORKING_SET_TOOL_BUDGET;
}

function revisionFor(
  snapshot: ToolWorkingSetSnapshot,
  operations: readonly string[],
  suffix = "ready",
): string {
  const operationPart = operations.length > 0 ? operations.join(",") : "none";
  return `tool-working-set:v1:${contextKey(snapshot)}:${suffix}:operations-${operationPart}`;
}

function failureSet(
  snapshot: ToolWorkingSetSnapshot,
  operations: readonly string[],
  reasons: readonly WorkingSetReason[],
  error: WorkingSetFailure,
): ToolWorkingSet {
  return {
    ok: false,
    revision: revisionFor(snapshot, operations, error.code),
    activeToolNames: [],
    activeOperationNames: [],
    schemaBytes: 0,
    reasons,
    error,
  };
}

function invalidSnapshot(snapshot: ToolWorkingSetSnapshot): WorkingSetFailure | null {
  if (!validRole(snapshot.role) || !validPhase(snapshot.phase) || !validStage(snapshot.stage)) {
    return {
      code: "invalid_snapshot",
      message: "working-set snapshot role, phase, or stage is invalid",
      details: {
        role: snapshot.role,
        phase: snapshot.phase,
        stage: snapshot.stage,
      },
    };
  }
  if (!Number.isSafeInteger(snapshot.playerTurnEpoch) || snapshot.playerTurnEpoch < 0) {
    return {
      code: "invalid_snapshot",
      message: "playerTurnEpoch must be a non-negative safe integer",
      details: { playerTurnEpoch: snapshot.playerTurnEpoch },
    };
  }
  if (
    typeof snapshot.canonicalProgressRevision !== "string"
    || snapshot.canonicalProgressRevision.trim().length === 0
  ) {
    return {
      code: "invalid_snapshot",
      message: "canonicalProgressRevision must be a non-empty string",
      details: { canonicalProgressRevision: snapshot.canonicalProgressRevision },
    };
  }
  return null;
}

/**
 * Deterministically project model-visible operation tools from structured
 * canonical facts. It performs no player-prose classification.
 */
export function projectToolWorkingSet(
  snapshot: ToolWorkingSetSnapshot,
  catalog: TypedToolCatalog = defaultTypedToolCatalog(),
): ToolWorkingSet {
  const invalid = invalidSnapshot(snapshot);
  if (invalid) return failureSet(snapshot, [], [], invalid);

  const candidates = new Set<string>();
  const reasons: WorkingSetReason[] = [];
  const consider = (operation: string, reason: WorkingSetReason): void => {
    if (!policyAllows(operation, snapshot) || !typedOperationExists(operation, catalog)) {
      reasons.push({ code: "policy_filtered", operation, source: reason.code });
      return;
    }
    if (!stageAllows(operation, snapshot)) {
      reasons.push({ code: "stage_filtered", operation, source: reason.code });
      return;
    }
    candidates.add(operation);
    reasons.push(reason);
  };

  for (const operation of baselineOperations(snapshot)) {
    consider(operation, { code: "stage_baseline", operation });
  }
  for (const hint of snapshot.affordances?.operations ?? []) {
    consider(hint.operation, {
      code: "canonical_affordance",
      operation: hint.operation,
      source: hint.source,
    });
  }
  for (const operation of snapshot.recoveryRoute?.operations ?? []) {
    consider(operation, {
      code: "recovery_route",
      operation,
      source: snapshot.recoveryRoute?.code,
    });
  }
  for (const load of snapshot.loadedNamespaces ?? []) {
    if (!loadMatchesSnapshot(load, snapshot)) {
      reasons.push({ code: "expired_load", source: load.namespace });
      continue;
    }
    for (const operation of load.operations) {
      consider(operation, {
        code: "loaded_namespace",
        operation,
        source: load.namespace,
      });
    }
  }
  for (const load of snapshot.loadedOperations ?? []) {
    if (!loadMatchesSnapshot(load, snapshot)) {
      reasons.push({ code: "expired_load", operation: load.operation });
      continue;
    }
    consider(load.operation, { code: "loaded_exact_operation", operation: load.operation });
  }

  const operations = [...candidates].sort();
  const includeHostTools = snapshot.stage !== "finalized" && snapshot.stage !== "faulted";
  const tools = operations.map((operation) => typedToolForOperation(operation, catalog)!.name);
  if (includeHostTools) {
    tools.unshift(...WORKING_SET_HOST_TOOLS);
    for (const tool of WORKING_SET_HOST_TOOLS) {
      reasons.push({ code: "host_baseline", source: tool });
    }
  }
  const budget = workingSetBudget(snapshot);
  if (tools.length > budget) {
    return failureSet(snapshot, operations, reasons, {
      code: "working_set_budget_exceeded",
      message: `projected ${tools.length} tools exceeds the ${budget}-tool budget`,
      details: {
        projected_tool_count: tools.length,
        budget,
        operations,
        tools,
      },
    });
  }

  let schemaBytes = 0;
  for (const operation of operations) {
    const typed = typedToolForOperation(operation, catalog)!;
    schemaBytes += Buffer.byteLength(JSON.stringify(typed.parameters), "utf8");
  }
  reasons.sort((a, b) => (
    `${a.code}:${a.operation ?? ""}:${a.source ?? ""}`
      .localeCompare(`${b.code}:${b.operation ?? ""}:${b.source ?? ""}`)
  ));
  return {
    ok: true,
    revision: revisionFor(snapshot, operations),
    activeToolNames: tools,
    activeOperationNames: operations,
    schemaBytes,
    reasons,
  };
}

function loadFailure(
  code: WorkingSetLoadFailureCode,
  message: string,
  details: Record<string, unknown>,
): ToolWorkingSetLoadResult {
  return { ok: false, code, message, details };
}

function scopeFrom(snapshot: ToolWorkingSetSnapshot): LoadScope {
  return {
    role: snapshot.role,
    phase: snapshot.phase,
    stage: snapshot.stage,
    playerTurnEpoch: snapshot.playerTurnEpoch,
    canonicalProgressRevision: snapshot.canonicalProgressRevision,
  };
}

function exactLoadDenied(
  snapshot: ToolWorkingSetSnapshot,
  operation: string,
  catalog: TypedToolCatalog,
): ToolWorkingSetLoadResult | null {
  const policy = OPERATION_POLICY[operation];
  if (!policy) {
    return loadFailure("unknown_operation", `unknown model-visible operation ${operation}`, {
      operation,
    });
  }
  if (policy.kp_surface === "none" || sessionRolesForPolicy(operation, policy).length === 0) {
    return loadFailure("policy_forbidden", `operation ${operation} is not on a KP surface`, {
      operation,
    });
  }
  if (!typedOperationExists(operation, catalog)) {
    return loadFailure("policy_forbidden", `operation ${operation} has no model-visible typed contract`, {
      operation,
    });
  }
  if (!sessionRolesForPolicy(operation, policy).includes(snapshot.role)) {
    return loadFailure("role_forbidden", `operation ${operation} is not allowed for role ${snapshot.role}`, {
      operation,
      role: snapshot.role,
      allowed_roles: [...sessionRolesForPolicy(operation, policy)],
    });
  }
  if (!policy.phases.includes(snapshot.phase)) {
    return loadFailure("phase_forbidden", `operation ${operation} is not allowed in phase ${snapshot.phase}`, {
      operation,
      phase: snapshot.phase,
      allowed_phases: [...policy.phases],
    });
  }
  if (!stageAllows(operation, snapshot)) {
    return loadFailure("stage_forbidden", `operation ${operation} is not available in stage ${snapshot.stage}`, {
      operation,
      stage: snapshot.stage,
    });
  }
  return null;
}

/**
 * Create one turn-scoped load grant and project it immediately. The caller
 * retains the returned grant; it expires when epoch, stage, or progress moves.
 */
export function loadToolNamespace(
  snapshot: ToolWorkingSetSnapshot,
  request: NamespaceLoadRequest,
  catalog: TypedToolCatalog = defaultTypedToolCatalog(),
): ToolWorkingSetLoadResult {
  const snapshotFailure = invalidSnapshot(snapshot);
  if (snapshotFailure) {
    return loadFailure("invalid_snapshot", snapshotFailure.message, snapshotFailure.details);
  }
  if (request.kind === "exact_operation") {
    const denied = exactLoadDenied(snapshot, request.operation, catalog);
    if (denied) return denied;
    const grant: LoadedExactOperation = {
      kind: "exact_operation",
      ...scopeFrom(snapshot),
      operation: request.operation,
    };
    const workingSet = projectToolWorkingSet({
      ...snapshot,
      loadedOperations: [...(snapshot.loadedOperations ?? []), grant],
    }, catalog);
    if (!workingSet.ok) {
      return loadFailure(
        "working_set_budget_exceeded",
        workingSet.error?.message ?? "working-set projection failed",
        workingSet.error?.details ?? {},
      );
    }
    return { ok: true, grant, workingSet };
  }

  if (!validNamespace(request.namespace)) {
    return loadFailure("unknown_namespace", `unknown KP namespace ${String(request.namespace)}`, {
      namespace: request.namespace,
    });
  }
  const operations = Object.entries(OPERATION_POLICY)
    .filter(([operation, policy]) => (
      policy.kp_surface === request.namespace
      && policy.phases.includes(snapshot.phase)
      && sessionRolesForPolicy(operation, policy).includes(snapshot.role)
      && stageAllows(operation, snapshot)
      && typedOperationExists(operation, catalog)
    ))
    .map(([operation]) => operation)
    .sort();
  if (operations.length === 0) {
    return loadFailure(
      "namespace_unavailable",
      `namespace ${request.namespace} has no operations in the current role, phase, and stage`,
      {
        namespace: request.namespace,
        role: snapshot.role,
        phase: snapshot.phase,
        stage: snapshot.stage,
      },
    );
  }
  if (operations.length > NAMESPACE_OPERATION_BUDGET) {
    return loadFailure(
      "namespace_too_large",
      `namespace ${request.namespace} has ${operations.length} eligible operations; request an exact operation`,
      {
        namespace: request.namespace,
        eligible_operation_count: operations.length,
        max_operations: NAMESPACE_OPERATION_BUDGET,
        sample_exact_operation_candidates: operations.slice(0, NAMESPACE_OPERATION_BUDGET),
        request_exact_operation: true,
      },
    );
  }
  const grant: LoadedNamespace = {
    kind: "namespace",
    ...scopeFrom(snapshot),
    namespace: request.namespace,
    operations,
  };
  const workingSet = projectToolWorkingSet({
    ...snapshot,
    loadedNamespaces: [...(snapshot.loadedNamespaces ?? []), grant],
  }, catalog);
  if (!workingSet.ok) {
    return loadFailure(
      "working_set_budget_exceeded",
      workingSet.error?.message ?? "working-set projection failed",
      workingSet.error?.details ?? {},
    );
  }
  return { ok: true, grant, workingSet };
}
