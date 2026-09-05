/**
 * Provider-neutral projection of the Pi-Coc model-visible tool working set.
 *
 * Visibility is advisory and fail-closed. Canonical operation policy and the
 * execute-time ACL remain authoritative. The caller owns host tool definitions,
 * retained load grants, and candidate-binding revision validation.
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
import type { JsonSchema } from "./operation-contracts.ts";
import type { TurnProgressStage } from "./turn-output-gate.ts";
import {
  defaultTypedToolCatalog,
  typedToolForOperation,
  type TypedToolCatalog,
} from "./typed-tools.ts";

export type WorkingSetNamespace = Exclude<KpSurface, "none">;

export const WORKING_SET_TOOL_BUDGET = 20;
export const CLOSURE_TOOL_BUDGET = 10;
export const NAMESPACE_OPERATION_BUDGET = 10;

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

/** Resolved definitions for every non-canonical host tool the adapter advertises. */
export type ModelVisibleHostTool = {
  name: string;
  parameters: JsonSchema;
};

type LoadScope = {
  role: SessionRole;
  phase: PlayPhase;
  stage: TurnProgressStage;
  playerTurnEpoch: number;
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

/**
 * Stage recovery stays inside the stage capability table. Fault recovery may
 * authorize one exact operation in addition to session.resume.
 */
export type RecoveryRoute =
  | {
    authorization: "stage";
    code: string;
    operations: readonly string[];
  }
  | {
    authorization: "fault";
    code: string;
    operation: string;
  };

export type ToolWorkingSetSnapshot = LoadScope & {
  canonicalProgressRevision: number;
  /** Exact opt-in test profile. Omitted is the production/default surface. */
  acceptanceProfile?: "rules-director-single-draft";
  /** Resolved from extraToolsForSessionRole(role) by the host adapter. */
  roleManifestToolNames: readonly string[];
  hostTools: readonly ModelVisibleHostTool[];
  affordances?: CanonicalAffordanceProjection;
  loadedNamespaces?: readonly LoadedNamespace[];
  loadedOperations?: readonly LoadedExactOperation[];
  recoveryRoute?: RecoveryRoute;
  /**
   * Exact host-binding availability for closure operations whose model schema
   * is meaningful only after the host has armed canonical identity. Omitted
   * preserves the pure projector's legacy/default stage view; the live Pi
   * adapter always supplies it.
   */
  boundOperations?: readonly string[];
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
  schemaBytes: number;
  hostSchemaBytes: number;
  operationSchemaBytes: number;
  reasons: readonly WorkingSetReason[];
  error?: WorkingSetFailure;
};

export type NamespaceLoadRequest =
  | { kind: "exact_operation"; operation: string }
  | { kind: "namespace"; namespace: WorkingSetNamespace };

export type WorkingSetLoadFailureCode =
  | "invalid_snapshot"
  | "invalid_request"
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

type StageCapability = {
  operations: readonly string[];
  allowedOperations: ReadonlySet<string> | null;
  advertiseHostTools: boolean;
  budget: typeof WORKING_SET_TOOL_BUDGET | typeof CLOSURE_TOOL_BUDGET;
  allowFaultRoute: boolean;
};

function closedStage(
  operations: readonly string[],
  options: { advertiseHostTools?: boolean; allowFaultRoute?: boolean } = {},
): StageCapability {
  return {
    operations,
    allowedOperations: new Set(operations),
    advertiseHostTools: options.advertiseHostTools ?? true,
    budget: CLOSURE_TOOL_BUDGET,
    allowFaultRoute: options.allowFaultRoute ?? false,
  };
}

/** One authority for each progress stage's baseline, visibility, and budget. */
const STAGE_CAPABILITIES: Readonly<Record<TurnProgressStage, StageCapability>> = {
  awaiting_player: closedStage([], { advertiseHostTools: false }),
  acting: {
    operations: [],
    allowedOperations: null,
    advertiseHostTools: true,
    budget: WORKING_SET_TOOL_BUDGET,
    allowFaultRoute: false,
  },
  journaled: closedStage(["scene.context", "session.resume", "turn.output_context"]),
  output_context_ready: closedStage([
    "scene.context",
    "narration.review",
    "turn.finalize",
  ]),
  review_ready: closedStage([
    "narration.review",
    "turn.finalize",
    "turn.output_context",
  ]),
  finalized: closedStage([], { advertiseHostTools: false }),
  delivered: closedStage([], { advertiseHostTools: false }),
  faulted: closedStage(["session.resume"], {
    advertiseHostTools: false,
    allowFaultRoute: true,
  }),
};

const PLAY_ACTING_BASELINE = [
  "scene.context",
  "actions.list",
  "rules.context",
  "rules.settle",
  "npc.query",
  "state.journal",
  // The play prompt makes this mandatory -- a clue the player found is not
  // real until `state.record_clue` writes it -- so a Keeper that finds one
  // has no choice about calling it. Off the baseline it cost a `coc_discover`
  // round trip first: measured 2026-09-02 across six first turns, five of them
  // spent one on exactly this operation, at ~11.8s each, and a discover is
  // also one of the things that changes the active tool interface and forces
  // a replan.
  //
  // This is the one write on the baseline, and it is here because the rules
  // require it rather than because it is convenient. Everything else still
  // loads on demand: "no fixed pipeline, no quota" holds for the rest.
  "state.record_clue",
] as const;

const RULES_DIRECTOR_ACTING_BASELINE = [
  "scene.context",
  "actions.list",
  "state.journal",
] as const;

const OPEN_TURN_PRE_JOURNAL_FORBIDDEN = new Set([
  "turn.output_context",
  "narration.review",
  "turn.finalize",
]);

const SETUP_ACTING_BASELINE = [
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validRole(value: unknown): value is SessionRole {
  return value === "setup" || value === "play";
}

function validPhase(value: unknown): value is PlayPhase {
  return (PLAY_PHASES as readonly unknown[]).includes(value);
}

function validStage(value: unknown): value is TurnProgressStage {
  return typeof value === "string" && Object.hasOwn(STAGE_CAPABILITIES, value);
}

function validNamespace(value: unknown): value is WorkingSetNamespace {
  return value !== "none" && (KP_SURFACES as readonly unknown[]).includes(value);
}

function grantKey(scope: LoadScope): string {
  return [scope.role, scope.phase, scope.stage, `epoch-${scope.playerTurnEpoch}`].join(":");
}

function revisionContextKey(snapshot: ToolWorkingSetSnapshot): string {
  const profile = snapshot.acceptanceProfile === undefined
    ? ""
    : `:profile-${snapshot.acceptanceProfile}`;
  return `${grantKey(snapshot)}${profile}:progress-${snapshot.canonicalProgressRevision}`;
}

function loadMatchesSnapshot(load: LoadScope, snapshot: ToolWorkingSetSnapshot): boolean {
  return grantKey(load) === grantKey(snapshot);
}

function isVerifiedOpenTurnRecovery(snapshot: ToolWorkingSetSnapshot): boolean {
  return snapshot.role === "play"
    && snapshot.phase === "recovery"
    && snapshot.stage === "acting"
    && snapshot.recoveryRoute?.authorization === "stage"
    && snapshot.recoveryRoute.code === "open_turn_pre_journal";
}

function policyAllows(operation: string, snapshot: ToolWorkingSetSnapshot): boolean {
  const policy = OPERATION_POLICY[operation];
  if (!policy || policy.kp_surface === "none") return false;
  if (!policy.phases.includes(snapshot.phase)) {
    if (
      !isVerifiedOpenTurnRecovery(snapshot)
      || !policy.phases.includes("live_turn")
    ) return false;
  }
  if (!sessionRolesForPolicy(operation, policy).includes(snapshot.role)) return false;
  return true;
}

function faultRecoveryOperation(snapshot: ToolWorkingSetSnapshot): string | null {
  if (snapshot.stage !== "faulted" || snapshot.recoveryRoute?.authorization !== "fault") {
    return null;
  }
  const operation = snapshot.recoveryRoute.operation;
  return typeof operation === "string" && operation.trim().length > 0 ? operation : null;
}

function stageAllows(operation: string, snapshot: ToolWorkingSetSnapshot): boolean {
  if (
    isVerifiedOpenTurnRecovery(snapshot)
    && OPEN_TURN_PRE_JOURNAL_FORBIDDEN.has(operation)
  ) return false;
  if (
    snapshot.boundOperations !== undefined
    && (operation === "narration.review" || operation === "turn.finalize")
    && !snapshot.boundOperations.includes(operation)
  ) return false;
  const capability = STAGE_CAPABILITIES[snapshot.stage];
  if (capability.allowedOperations === null) return true;
  if (capability.allowedOperations.has(operation)) return true;
  // `output_context_ready` means the output context was produced and bound
  // finalize. If finalize is NOT bound, that stage's whole purpose is unmet
  // and its closed set leaves the Keeper nothing at all: finalize is filtered
  // out above, review with it, and the producer is excluded because it is
  // supposed to have already run. Seen live on 2026-09-02 -- an output context
  // that failed closed left campaign amaranthine-loop spinning twenty
  // discovery calls against a stage with no legal operation, and the turn was
  // never delivered. Keep the producer reachable exactly while its product is
  // missing.
  if (
    operation === "turn.output_context"
    && snapshot.stage === "output_context_ready"
    && snapshot.boundOperations !== undefined
    && !snapshot.boundOperations.includes("turn.finalize")
  ) return true;
  return capability.allowFaultRoute && faultRecoveryOperation(snapshot) === operation;
}

function typedOperationExists(operation: string, catalog: TypedToolCatalog): boolean {
  return typedToolForOperation(operation, catalog) !== null;
}

function actingBaseline(snapshot: ToolWorkingSetSnapshot): readonly string[] {
  if (snapshot.role === "setup") {
    return snapshot.phase === "cold_start"
      ? ["setup.quick_start", ...SETUP_ACTING_BASELINE]
      : SETUP_ACTING_BASELINE;
  }
  if (snapshot.phase === "recovery") {
    return isVerifiedOpenTurnRecovery(snapshot)
      ? (
          snapshot.acceptanceProfile === "rules-director-single-draft"
            ? RULES_DIRECTOR_ACTING_BASELINE
            : PLAY_ACTING_BASELINE
        )
      : ["session.resume"];
  }
  if (snapshot.phase === "ending") return ["state.journal"];
  if (snapshot.phase === "opening" || snapshot.phase === "cold_start") {
    return ["session.resume", "scene.context", "actions.list", "evidence.table_opening"];
  }
  return snapshot.acceptanceProfile === "rules-director-single-draft"
    ? RULES_DIRECTOR_ACTING_BASELINE
    : PLAY_ACTING_BASELINE;
}

function baselineOperations(snapshot: ToolWorkingSetSnapshot): readonly string[] {
  const baseline = snapshot.stage === "acting"
    ? actingBaseline(snapshot)
    : STAGE_CAPABILITIES[snapshot.stage].operations;
  if (snapshot.boundOperations === undefined) return baseline;
  const bound = new Set(snapshot.boundOperations);
  const filtered = baseline.filter((operation) => (
    (operation !== "narration.review" && operation !== "turn.finalize")
    || bound.has(operation)
  ));
  // `output_context_ready` is named for a product it may not have: when the
  // output context failed closed, nothing bound finalize, and this filter then
  // removes finalize and narration.review both. What remains -- scene.context
  // -- cannot advance the turn, and the stage's own producer is excluded
  // because it is supposed to have already run. That is a dead turn, and
  // nothing can abandon or repair one. Seen live on 2026-09-02 in campaign
  // amaranthine-loop: twenty discovery calls, nothing delivered. Keep the
  // producer available exactly while its product is missing.
  if (
    snapshot.stage === "output_context_ready"
    // Neither closure operation bound: review-then-finalize is the ordinary
    // flow and finalize alone being unbound is normal, so only the case where
    // NOTHING can advance the turn brings the producer back.
    && !bound.has("turn.finalize")
    && !bound.has("narration.review")
    && !filtered.includes("turn.output_context")
  ) {
    return [...filtered, "turn.output_context"];
  }
  return filtered;
}

function workingSetBudget(
  snapshot: ToolWorkingSetSnapshot,
  capability: StageCapability,
): typeof WORKING_SET_TOOL_BUDGET | typeof CLOSURE_TOOL_BUDGET {
  return snapshot.phase === "pending_finalization"
    || (snapshot.phase === "recovery" && !isVerifiedOpenTurnRecovery(snapshot))
    || snapshot.phase === "ending"
    ? CLOSURE_TOOL_BUDGET
    : capability.budget;
}

function schemaByteLength(schema: JsonSchema): number | null {
  try {
    const serialized = JSON.stringify(schema);
    return typeof serialized === "string" ? Buffer.byteLength(serialized, "utf8") : null;
  } catch {
    return null;
  }
}

function normalizedHostTools(
  snapshot: ToolWorkingSetSnapshot,
): { tools: ModelVisibleHostTool[]; bytes: number } | WorkingSetFailure {
  if (!Array.isArray(snapshot.hostTools)) {
    return {
      code: "invalid_snapshot",
      message: "hostTools must be an array of resolved host tool definitions",
      details: { hostTools: snapshot.hostTools },
    };
  }
  const byName = new Map<string, ModelVisibleHostTool>();
  let bytes = 0;
  for (const row of snapshot.hostTools) {
    if (!isPlainObject(row) || typeof row.name !== "string" || !row.name.trim()) {
      return {
        code: "invalid_snapshot",
        message: "each host tool must have a non-empty name",
        details: { host_tool: row },
      };
    }
    if (!isPlainObject(row.parameters)) {
      return {
        code: "invalid_snapshot",
        message: `host tool ${row.name} must have a JSON-object parameters schema`,
        details: { host_tool: row.name },
      };
    }
    if (byName.has(row.name)) {
      return {
        code: "invalid_snapshot",
        message: `duplicate host tool definition ${row.name}`,
        details: { host_tool: row.name },
      };
    }
    const schemaBytes = schemaByteLength(row.parameters);
    if (schemaBytes === null) {
      return {
        code: "invalid_snapshot",
        message: `host tool ${row.name} parameters are not JSON serializable`,
        details: { host_tool: row.name },
      };
    }
    byName.set(row.name, { name: row.name, parameters: row.parameters });
    bytes += schemaBytes;
  }
  if (
    !Array.isArray(snapshot.roleManifestToolNames)
    || snapshot.roleManifestToolNames.some((name) => typeof name !== "string" || !name.trim())
  ) {
    return {
      code: "invalid_snapshot",
      message: "roleManifestToolNames must be the resolved non-empty role tool names",
      details: { role: snapshot.role, roleManifestToolNames: snapshot.roleManifestToolNames },
    };
  }
  const required = [...new Set(snapshot.roleManifestToolNames)];
  const missing = required.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    return {
      code: "invalid_snapshot",
      message: `resolved host tools omit canonical ${snapshot.role} role tools`,
      details: { role: snapshot.role, missing_host_tools: missing },
    };
  }
  const tools = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { tools, bytes };
}

function invalidSnapshot(snapshot: ToolWorkingSetSnapshot): WorkingSetFailure | null {
  if (!validRole(snapshot.role) || !validPhase(snapshot.phase) || !validStage(snapshot.stage)) {
    return {
      code: "invalid_snapshot",
      message: "working-set snapshot role, phase, or stage is invalid",
      details: { role: snapshot.role, phase: snapshot.phase, stage: snapshot.stage },
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
    !Number.isSafeInteger(snapshot.canonicalProgressRevision)
    || snapshot.canonicalProgressRevision < 0
  ) {
    return {
      code: "invalid_snapshot",
      message: "canonicalProgressRevision must be a non-negative safe integer",
      details: { canonicalProgressRevision: snapshot.canonicalProgressRevision },
    };
  }
  if (
    snapshot.acceptanceProfile !== undefined
    && snapshot.acceptanceProfile !== "rules-director-single-draft"
  ) {
    return {
      code: "invalid_snapshot",
      message: "acceptanceProfile is not a supported exact test profile",
      details: { acceptanceProfile: snapshot.acceptanceProfile },
    };
  }
  if (
    snapshot.boundOperations !== undefined
    && (
      !Array.isArray(snapshot.boundOperations)
      || snapshot.boundOperations.some((operation) => (
        typeof operation !== "string" || !operation.trim()
      ))
    )
  ) {
    return {
      code: "invalid_snapshot",
      message: "boundOperations must contain non-empty operation names",
      details: { boundOperations: snapshot.boundOperations },
    };
  }
  if (snapshot.recoveryRoute !== undefined) {
    if (!isPlainObject(snapshot.recoveryRoute)) {
      return {
        code: "invalid_snapshot",
        message: "recoveryRoute must be a structured stage or fault route",
        details: { recoveryRoute: snapshot.recoveryRoute },
      };
    }
    if (snapshot.recoveryRoute.authorization === "fault") {
      if (
        snapshot.stage !== "faulted"
        || typeof snapshot.recoveryRoute.code !== "string"
        || !snapshot.recoveryRoute.code.trim()
        || typeof snapshot.recoveryRoute.operation !== "string"
        || !snapshot.recoveryRoute.operation.trim()
      ) {
        return {
          code: "invalid_snapshot",
          message: "fault recovery requires faulted stage, a code, and one exact operation",
          details: { recoveryRoute: snapshot.recoveryRoute, stage: snapshot.stage },
        };
      }
    } else if (snapshot.recoveryRoute.authorization === "stage") {
      if (
        typeof snapshot.recoveryRoute.code !== "string"
        || !snapshot.recoveryRoute.code.trim()
        || !Array.isArray(snapshot.recoveryRoute.operations)
        || snapshot.recoveryRoute.operations.some((operation) => (
          typeof operation !== "string" || !operation.trim()
        ))
      ) {
        return {
          code: "invalid_snapshot",
          message: "stage recovery requires a code and exact operation list",
          details: { recoveryRoute: snapshot.recoveryRoute },
        };
      }
    } else {
      return {
        code: "invalid_snapshot",
        message: "recoveryRoute authorization must be stage or fault",
        details: { recoveryRoute: snapshot.recoveryRoute },
      };
    }
  }
  return null;
}

function revisionFor(
  snapshot: ToolWorkingSetSnapshot,
  tools: readonly string[],
  suffix = "ready",
): string {
  const toolPart = tools.length > 0 ? tools.join(",") : "none";
  return `tool-working-set:v2:${revisionContextKey(snapshot)}:${suffix}:tools-${toolPart}`;
}

function failureSet(
  snapshot: ToolWorkingSetSnapshot,
  tools: readonly string[],
  reasons: readonly WorkingSetReason[],
  error: WorkingSetFailure,
): ToolWorkingSet {
  return {
    ok: false,
    revision: revisionFor(snapshot, tools, error.code),
    activeToolNames: [],
    activeOperationNames: [],
    schemaBytes: 0,
    hostSchemaBytes: 0,
    operationSchemaBytes: 0,
    reasons,
    error,
  };
}

/** Project model-visible tools from structured canonical facts only. */
export function projectToolWorkingSet(
  snapshot: ToolWorkingSetSnapshot,
  catalog: TypedToolCatalog = defaultTypedToolCatalog(),
): ToolWorkingSet {
  const invalid = invalidSnapshot(snapshot);
  if (invalid) return failureSet(snapshot, [], [], invalid);
  const hostResolution = normalizedHostTools(snapshot);
  if ("code" in hostResolution) return failureSet(snapshot, [], [], hostResolution);

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
  if (snapshot.recoveryRoute?.authorization === "stage") {
    for (const operation of snapshot.recoveryRoute.operations) {
      consider(operation, {
        code: "recovery_route",
        operation,
        source: snapshot.recoveryRoute.code,
      });
    }
  } else if (snapshot.recoveryRoute?.authorization === "fault") {
    consider(snapshot.recoveryRoute.operation, {
      code: "recovery_route",
      operation: snapshot.recoveryRoute.operation,
      source: snapshot.recoveryRoute.code,
    });
  }
  for (const load of snapshot.loadedNamespaces ?? []) {
    if (!loadMatchesSnapshot(load, snapshot)) {
      reasons.push({ code: "expired_load", source: load.namespace });
      continue;
    }
    for (const operation of load.operations) {
      const policy = OPERATION_POLICY[operation];
      if (!policy || policy.kp_surface !== load.namespace) {
        reasons.push({ code: "policy_filtered", operation, source: load.namespace });
        continue;
      }
      consider(operation, { code: "loaded_namespace", operation, source: load.namespace });
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
  const typedTools = operations.map((operation) => typedToolForOperation(operation, catalog)!);
  const capability = STAGE_CAPABILITIES[snapshot.stage];
  const hostTools = capability.advertiseHostTools ? hostResolution.tools : [];
  const hostNames = hostTools.map((tool) => tool.name);
  const typedNames = typedTools.map((tool) => tool.name);
  const collision = hostNames.find((name) => typedNames.includes(name));
  if (collision) {
    return failureSet(snapshot, [], reasons, {
      code: "invalid_snapshot",
      message: `host tool ${collision} collides with a typed operation tool`,
      details: { tool: collision },
    });
  }
  const tools = [...hostNames, ...typedNames];
  const budget = workingSetBudget(snapshot, capability);
  if (tools.length > budget) {
    return failureSet(snapshot, tools, reasons, {
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

  const hostSchemaBytes = capability.advertiseHostTools ? hostResolution.bytes : 0;
  const operationSchemaBytes = typedTools.reduce(
    (total, tool) => total + schemaByteLength(tool.parameters)!,
    0,
  );
  for (const tool of hostTools) reasons.push({ code: "host_baseline", source: tool.name });
  reasons.sort((a, b) => (
    `${a.code}:${a.operation ?? ""}:${a.source ?? ""}`
      .localeCompare(`${b.code}:${b.operation ?? ""}:${b.source ?? ""}`)
  ));
  return {
    ok: true,
    revision: revisionFor(snapshot, tools),
    activeToolNames: tools,
    activeOperationNames: operations,
    schemaBytes: hostSchemaBytes + operationSchemaBytes,
    hostSchemaBytes,
    operationSchemaBytes,
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
  };
}

function validateLoadRequest(request: unknown): NamespaceLoadRequest | ToolWorkingSetLoadResult {
  if (!isPlainObject(request)) {
    return loadFailure("invalid_request", "load request must be an object", { request });
  }
  if (request.kind === "exact_operation") {
    if (typeof request.operation !== "string" || !request.operation.trim()) {
      return loadFailure(
        "invalid_request",
        "exact_operation request requires a non-empty operation",
        { request },
      );
    }
    if (Object.keys(request).some((key) => key !== "kind" && key !== "operation")) {
      return loadFailure("invalid_request", "exact_operation request has unknown fields", { request });
    }
    return { kind: "exact_operation", operation: request.operation };
  }
  if (request.kind === "namespace") {
    if (!validNamespace(request.namespace)) {
      return loadFailure("unknown_namespace", `unknown KP namespace ${String(request.namespace)}`, {
        namespace: request.namespace,
      });
    }
    if (Object.keys(request).some((key) => key !== "kind" && key !== "namespace")) {
      return loadFailure("invalid_request", "namespace request has unknown fields", { request });
    }
    return { kind: "namespace", namespace: request.namespace };
  }
  return loadFailure("invalid_request", `unknown load request kind ${String(request.kind)}`, {
    request,
  });
}

/**
 * Operations whose names share meaning-bearing tokens with a miss.
 *
 * An exact `coc_discover` lookup that fails returns `unknown_operation` and
 * nothing else, so a Keeper one synonym away from the real name has no way
 * back. That is not hypothetical: on 2026-09-01 a Keeper needed to record a
 * POW drain, guessed `state.characteristic_adjust` (the operation is
 * `state.characteristic_delta`), got a bare miss, gave up, and recorded the
 * drain as HP damage it then had to undo. Earlier in the same session it
 * burned four guesses -- `state.characteristic_adjust`,
 * `state.adjust_characteristic`, `rules.characteristic_damage`,
 * `state.resource_adjust` -- and narrated a stat loss that never reached the
 * sheet. Listing the namespace is not a fallback either: the busy ones are
 * over the discovery budget.
 *
 * Structural only: shared name tokens, no synonym table and no guess about
 * what the Keeper meant. A name sharing a distinctive token ranks above one
 * sharing only the namespace, and only operations this session could actually
 * load are offered.
 */
export function nearestLoadableOperations(
  operation: string,
  snapshot: ToolWorkingSetSnapshot,
  catalog: TypedToolCatalog,
  limit = 3,
): string[] {
  const tokensOf = (value: string): string[] =>
    value.toLowerCase().split(/[._]+/).filter((token) => token.length > 0);
  const wanted = tokensOf(operation);
  if (wanted.length === 0) return [];
  const wantedNamespace = wanted[0];
  const scored: { name: string; score: number }[] = [];
  for (const [candidate, policy] of Object.entries(OPERATION_POLICY)) {
    if (!policy || policy.kp_surface === "none") continue;
    if (!sessionRolesForPolicy(candidate, policy).includes(snapshot.role)) continue;
    if (!typedOperationExists(candidate, catalog)) continue;
    const tokens = tokensOf(candidate);
    let score = 0;
    for (const token of new Set(wanted)) {
      if (!tokens.includes(token)) continue;
      // The namespace is shared by dozens of operations; a token past it is
      // what actually identifies one.
      score += token === wantedNamespace ? 1 : 4;
    }
    if (score > 0) scored.push({ name: candidate, score });
  }
  scored.sort((left, right) =>
    right.score - left.score || left.name.localeCompare(right.name));
  const best = scored[0]?.score ?? 0;
  // A namespace-only match is noise; offer it only when nothing shares more.
  const floor = best >= 4 ? 4 : 1;
  return scored
    .filter((row) => row.score >= floor)
    .slice(0, limit)
    .map((row) => row.name);
}


function exactLoadDenied(
  snapshot: ToolWorkingSetSnapshot,
  operation: string,
  catalog: TypedToolCatalog,
): ToolWorkingSetLoadResult | null {
  const policy = OPERATION_POLICY[operation];
  if (!policy) {
    const nearest = nearestLoadableOperations(operation, snapshot, catalog);
    return loadFailure(
      "unknown_operation",
      `unknown model-visible operation ${operation}`
        + (nearest.length
          ? `; the closest loadable operations are ${nearest.join(", ")}`
          : ""),
      { operation, ...(nearest.length ? { nearest_operations: nearest } : {}) },
    );
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
  if (!policyAllows(operation, snapshot)) {
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
 * Create one role/phase/epoch/stage-scoped load grant and project it now.
 * Candidate ids/digests are deliberately absent; the invocation binder owns
 * their independent canonical-revision validation.
 */
export function loadToolNamespace(
  snapshot: ToolWorkingSetSnapshot,
  requestValue: NamespaceLoadRequest | unknown,
  catalog: TypedToolCatalog = defaultTypedToolCatalog(),
): ToolWorkingSetLoadResult {
  const snapshotFailure = invalidSnapshot(snapshot);
  if (snapshotFailure) {
    return loadFailure("invalid_snapshot", snapshotFailure.message, snapshotFailure.details);
  }
  const current = projectToolWorkingSet(snapshot, catalog);
  if (!current.ok) {
    return loadFailure(
      current.error?.code === "invalid_snapshot"
        ? "invalid_snapshot"
        : "working_set_budget_exceeded",
      current.error?.message ?? "current working-set projection failed",
      current.error?.details ?? {},
    );
  }
  const request = validateLoadRequest(requestValue);
  if ("ok" in request) return request;

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
        workingSet.error?.code === "invalid_snapshot"
          ? "invalid_snapshot"
          : "working_set_budget_exceeded",
        workingSet.error?.message ?? "working-set projection failed",
        workingSet.error?.details ?? {},
      );
    }
    return { ok: true, grant, workingSet };
  }

  const operations = Object.entries(OPERATION_POLICY)
    .filter(([operation, policy]) => (
      policy.kp_surface === request.namespace
      && policy.discovery === "surface"
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
      workingSet.error?.code === "invalid_snapshot"
        ? "invalid_snapshot"
        : "working_set_budget_exceeded",
      workingSet.error?.message ?? "working-set projection failed",
      workingSet.error?.details ?? {},
    );
  }
  return { ok: true, grant, workingSet };
}

function healingCardBlock(projection: unknown): Record<string, unknown> | null {
  if (!isPlainObject(projection)) return null;
  const recovery = isPlainObject(projection.recovery) ? projection.recovery : null;
  const candidates: unknown[] = [
    projection.rule_decision_cards,
    recovery?.healing,
    projection.healing,
    projection,
  ];
  for (const block of candidates) {
    if (!isPlainObject(block) || !Array.isArray(block.cards)) continue;
    return block;
  }
  return null;
}

/**
 * Slice 1 scene.context / recovery.healing card projection → acting-set
 * affordance. Cards are never extra tools and never action gates; an empty
 * or missing block adds nothing. Budget accounting stays with the projector.
 */
export function affordancesFromHealingCardProjection(
  projection: unknown,
  source: CanonicalAffordanceSource = "scene",
): CanonicalAffordanceHint[] {
  const block = healingCardBlock(projection);
  const cards = block === null ? null : block.cards;
  if (!Array.isArray(cards) || cards.length === 0) return [];
  const policy = OPERATION_POLICY["rules.settle"];
  if (!policy || policy.kp_surface !== "rules" || policy.discovery !== "surface") {
    return [];
  }
  return [{ operation: "rules.settle", source }];
}

/**
 * A pending authored SAN trigger already carries the semantic inputs required
 * by the flat authoritative rule surface. Expose that surface directly; the
 * deeper subsystem command remains available for bout continuation.
 */
export function affordancesFromSanityTriggerProjection(
  projection: unknown,
  source: CanonicalAffordanceSource = "scene",
): CanonicalAffordanceHint[] {
  if (!isPlainObject(projection) || !Array.isArray(projection.pending_san_triggers)) {
    return [];
  }
  const pending = projection.pending_san_triggers.some((value) => {
    if (!isPlainObject(value)) return false;
    return value.status === "pending"
      && typeof value.trigger_id === "string"
      && value.trigger_id.trim().length > 0;
  });
  if (!pending) return [];
  const policy = OPERATION_POLICY["rules.sanity_check"];
  if (!policy || policy.kp_surface !== "rules" || policy.discovery !== "surface") {
    return [];
  }
  return [{ operation: "rules.sanity_check", source }];
}
