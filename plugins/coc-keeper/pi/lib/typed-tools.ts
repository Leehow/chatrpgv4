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
      description: `${operation} Canonical operation; the result envelope is authoritative.`,
      parameters: contract.inputSchema,
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
  const campaign = params.campaign;
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

const SCHEMA_ATTACH_CODES = new Set([
  "missing_param",
  "invalid_param",
  "missing_parameters",
  "invalid_arguments",
  "invalid_param_type",
]);

/** Attach archive inputSchema beside canonical error details. Never overwrite details. */
export function attachExpectedSchema(
  visible: Record<string, unknown> | null,
  operation: string | null | undefined,
  catalog = defaultTypedToolCatalog(),
): Record<string, unknown> | null {
  if (!visible || !operation) return visible;
  const error = visible.error;
  if (!isPlainObject(error)) return visible;
  const code = typeof error.code === "string" ? error.code : "";
  if (!SCHEMA_ATTACH_CODES.has(code)) return visible;
  const contract = catalog.contracts.operations.get(operation);
  if (!contract) return visible;
  return {
    ...visible,
    error: {
      ...error,
      expected_schema: structuredClone(contract.inputSchema),
    },
  };
}
