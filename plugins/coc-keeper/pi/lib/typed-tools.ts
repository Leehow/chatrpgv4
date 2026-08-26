/**
 * Operation-specific Pi tools generated from the MCP archive contract.
 * One tool name == one canonical operation. Execute wraps into the existing
 * gateway; ACL, decision_id, and finalization stay on that path.
 */
import {
  DOMAIN_TOOL_NAMES,
  OPERATION_POLICY,
  OPERATIONS_BY_SURFACE,
  sessionRolesForPolicy,
  type KpSurface,
  type PlayPhase,
  type SessionRole,
} from "./operation-policy.ts";
import {
  OperationContractError,
  loadOperationContracts,
  type JsonSchema,
  type OperationContractCatalog,
} from "./operation-contracts.ts";
import {
  isPiSchemaFailure,
  projectBoundTypedToolParameters,
  projectPiTypedToolParameters,
  projectPiToolFailure,
  type CurrentTypedToolHostContext,
  type TypedToolBindingCard,
} from "./tool-contract-projection.ts";

export {
  ToolContractProjectionError,
  bindRetainedTypedToolArguments,
  isPiSchemaFailure,
  projectBoundTypedToolParameters,
  projectPiTypedToolParameters,
  projectPiToolFailure,
  type AdvanceTimeBindingCard,
  type CombatResolveBindingCard,
  type CombatTargetCandidate,
  type CurrentTypedToolHostContext,
  type NarrationReviewBindingCard,
  type PiAllowedNextAction,
  type PiFailureClass,
  type PiFailureRecovery,
  type SceneMoveBindingCard,
  type SceneRouteCandidate,
  type StateJournalBindingCard,
  type TurnFinalizeBindingCard,
  type TypedToolBindingCard,
} from "./tool-contract-projection.ts";

const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const OPERATION_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/** Host/meta tools that generated names must never collide with. */
export const RESERVED_HOST_TOOL_NAMES = new Set<string>([
  ...DOMAIN_TOOL_NAMES,
  "coc_invoke",
  "coc_discover",
  "coc_capabilities",
  "coc_dispatch_source_work",
  "coc_map_supply",
  "coc_source_assets",
  "coc_progressive_ocr",
  "coc_chargen_delegate",
  "read",
  "subagent",
  "subagent_wait",
]);

export type TypedOperationTool = {
  name: string;
  operation: string;
  label: string;
  description: string;
  parameters: JsonSchema;
};

export type TypedToolCatalog = {
  contracts: OperationContractCatalog;
  byName: ReadonlyMap<string, TypedOperationTool>;
  byOperation: ReadonlyMap<string, TypedOperationTool>;
};

function fail(code: string, message: string): never {
  throw new OperationContractError(code, message);
}

/** Deterministic name: `rules.roll` → `coc_rules_roll`. Illegal / reserved fail closed. */
export function typedToolNameForOperation(operation: string): string {
  if (!OPERATION_RE.test(operation)) {
    fail("illegal_tool_name", `cannot derive tool name from operation ${operation}`);
  }
  const name = `coc_${operation.replace(/\./g, "_")}`;
  if (!TOOL_NAME_RE.test(name)) {
    fail("illegal_tool_name", `derived tool name ${name} is not a legal Pi tool id`);
  }
  if (RESERVED_HOST_TOOL_NAMES.has(name)) {
    fail("tool_name_collision", `derived tool name ${name} collides with a reserved host tool`);
  }
  return name;
}

export function buildTypedToolCatalog(
  contracts: OperationContractCatalog = loadOperationContracts(),
): TypedToolCatalog {
  const byName = new Map<string, TypedOperationTool>();
  const byOperation = new Map<string, TypedOperationTool>();
  for (const [operation, contract] of contracts.operations) {
    const policy = OPERATION_POLICY[operation];
    if (!policy || policy.kp_surface === "none") continue;
    const name = typedToolNameForOperation(operation);
    if (byName.has(name)) {
      fail(
        "tool_name_collision",
        `derived tool name ${name} maps to both ${byName.get(name)?.operation} and ${operation}`,
      );
    }
    const tool: TypedOperationTool = {
      name,
      operation,
      label: `COC ${operation}`,
      description: contract.description,
      parameters: presentedTypedToolParameters(operation, contract.inputSchema),
    };
    byName.set(name, tool);
    byOperation.set(operation, tool);
  }
  return { contracts, byName, byOperation };
}

let cached: TypedToolCatalog | null = null;

export function defaultTypedToolCatalog(): TypedToolCatalog {
  cached ??= buildTypedToolCatalog();
  return cached;
}

export function isTypedOperationTool(name: string, catalog = defaultTypedToolCatalog()): boolean {
  return catalog.byName.has(name);
}

export function operationForTypedTool(
  name: string,
  catalog = defaultTypedToolCatalog(),
): string | null {
  return catalog.byName.get(name)?.operation ?? null;
}

export function typedToolForOperation(
  operation: string,
  catalog = defaultTypedToolCatalog(),
): TypedOperationTool | null {
  return catalog.byOperation.get(operation) ?? null;
}

export function listTypedOperationTools(catalog = defaultTypedToolCatalog()): TypedOperationTool[] {
  return [...catalog.byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Model-visible overlay: `setup.adopt_source_facts` still archives
 * campaign_id+facts, but the typed tool must accept campaign_id alone so the
 * host can bind the retained exact review card. Live KPs do not copy that
 * nested payload; rewriting facts stays forbidden.
 */
function presentedTypedToolParameters(
  operation: string,
  inputSchema: JsonSchema,
): JsonSchema {
  const presented = projectPiTypedToolParameters(operation, inputSchema);
  if (operation === "narration.review") {
    const cloned = structuredClone(presented);
    cloned.required = (cloned.required ?? []).filter(
      (key) => key !== "state_claim_compilation",
    );
    if (isPlainObject(cloned.properties)) {
      delete cloned.properties.state_claim_compilation;
    }
    return cloned;
  }
  if (operation === "progressive.prepare_opening") {
    const cloned = structuredClone(presented);
    cloned.required = (cloned.required ?? []).filter((key) => key !== "campaign");
    const campaign = cloned.properties?.campaign;
    if (isPlainObject(campaign)) {
      campaign.description = (
        "Optional in the setup host: omit it to consume the current retained "
        + "opening-selection campaign."
      );
    }
    return cloned;
  }
  if (operation !== "setup.adopt_source_facts") return presented;
  const cloned = structuredClone(presented);
  cloned.required = ["campaign_id"];
  const properties = cloned.properties;
  if (isPlainObject(properties) && isPlainObject(properties.facts)) {
    const extra = (
      "Omit to consume the retained exact opening-source-review card "
      + "for this campaign_id; do not rewrite facts."
    );
    const current = properties.facts.description;
    properties.facts = {
      ...properties.facts,
      description: typeof current === "string" && current
        ? `${current} ${extra}`
        : extra,
    };
  }
  return cloned;
}

/** Bind retained transport facts when the KP omitted them. Never overwrite. */
export function applyRetainedAdoptSourceFacts(
  wrappedParams: Record<string, unknown>,
  retainedFacts: unknown,
): Record<string, unknown> {
  if (wrappedParams.operation !== "setup.adopt_source_facts") return wrappedParams;
  if (!isPlainObject(retainedFacts)) return wrappedParams;
  const args = isPlainObject(wrappedParams.arguments)
    ? wrappedParams.arguments
    : null;
  if (args === null || isPlainObject(args.facts)) return wrappedParams;
  return {
    ...wrappedParams,
    arguments: { ...args, facts: structuredClone(retainedFacts) },
  };
}

/**
 * Model args are the archive inputSchema. Gateway still speaks
 * `{ operation, root, campaign, arguments }` — no second guess of fields.
 */
export function wrapTypedToolInvokeParams(
  toolName: string,
  params: Record<string, unknown>,
  catalog = defaultTypedToolCatalog(),
): Record<string, unknown> {
  const tool = catalog.byName.get(toolName);
  if (!tool) return params;
  const root = params.root;
  // Typed model schemas expose the canonical operation arguments, not the
  // transport envelope. Campaign-bound operations already carry their exact
  // campaign_id there, so lift that same value into the gateway envelope when
  // Pi did not add a top-level campaign. Keep campaign_id in the arguments bag
  // as the canonical operation still requires it.
  const campaign = params.campaign ?? (
    typeof params.campaign_id === "string" && params.campaign_id.trim()
      ? params.campaign_id
      : undefined
  );
  const argumentsBag: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "root" || key === "campaign") continue;
    argumentsBag[key] = value;
  }
  return {
    operation: tool.operation,
    ...(root !== undefined ? { root } : {}),
    ...(campaign !== undefined ? { campaign } : {}),
    arguments: argumentsBag,
  };
}

export function typedToolsForSurfacePhase(
  surface: Exclude<KpSurface, "none">,
  phase: PlayPhase,
  role: SessionRole,
  catalog = defaultTypedToolCatalog(),
): string[] {
  const names: string[] = [];
  for (const operation of OPERATIONS_BY_SURFACE[surface]) {
    const policy = OPERATION_POLICY[operation];
    if (!policy || !policy.phases.includes(phase)) continue;
    if (!sessionRolesForPolicy(operation, policy).includes(role)) continue;
    const tool = catalog.byOperation.get(operation);
    if (tool) names.push(tool.name);
  }
  return names;
}

export type ExpectedSchemaBindingContext = {
  binding: TypedToolBindingCard;
  current_host_context: CurrentTypedToolHostContext;
};

/** Attach archive inputSchema beside canonical error details. Never overwrite details. */
export function attachExpectedSchema(
  visible: Record<string, unknown> | null,
  operation: string | null | undefined,
  catalog = defaultTypedToolCatalog(),
  bindingContext?: ExpectedSchemaBindingContext,
): Record<string, unknown> | null {
  const projected = projectPiToolFailure(visible, operation);
  if (!projected || !operation) return projected;
  const error = projected.error;
  if (!isPlainObject(error)) return visible;
  const code = typeof error.code === "string" ? error.code : "";
  if (!isPiSchemaFailure(operation, code)) return projected;
  const contract = catalog.contracts.operations.get(operation);
  if (!contract) return projected;
  const presented = presentedTypedToolParameters(operation, contract.inputSchema);
  const expectedSchema = bindingContext === undefined
    ? structuredClone(presented)
    : projectBoundTypedToolParameters(
      operation,
      presented,
      bindingContext.binding,
      bindingContext.current_host_context,
    );
  return {
    ...projected,
    error: {
      ...error,
      expected_schema: expectedSchema,
    },
  };
}
