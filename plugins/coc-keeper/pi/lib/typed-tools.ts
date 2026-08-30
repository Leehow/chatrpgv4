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
  projectModelOwnedSchema,
  projectPiTypedToolParameters,
  projectPiToolFailure,
  HOST_OWNED_FIELDS,
  type CurrentTypedToolHostContext,
  type TypedToolBindingCard,
} from "./tool-contract-projection.ts";

export {
  CURRENT_ADVICE_HANDLE,
  CURRENT_CANDIDATE_HANDLE,
  CURRENT_INVESTIGATOR_HANDLE,
  CURRENT_PC_SUBJECT_HANDLE,
  CURRENT_PLAYER_INPUT_SOURCE_HANDLE,
  deriveSemanticEntityFacts,
  emptySemanticEntityFacts,
  ToolContractProjectionError,
  bindRetainedTypedToolArguments,
  isPiSchemaFailure,
  projectBoundTypedToolParameters,
  projectModelCallArguments,
  HOST_OWNED_FIELDS,
  projectModelVisibleCanonicalResult,
  projectPiTypedToolParameters,
  projectPiToolFailure,
  restoreSemanticEntityHandles,
  stripOpaqueModelIdentity,
  validateRawModelIdentityPayload,
  RAW_IDENTITY_GRAMMAR_FIELDS,
  modelIdentityFieldClass,
  projectModelOwnedSchema,
  DECISION_ID_PREFIXES,
  DECISION_ID_ANY_PREFIX_SENTENCE,
  DECISION_ID_TN_SCOPE_SENTENCE,
  DECISION_ID_FINALIZE_SCOPE_SENTENCE,
  DECISION_ID_FIELD_DESCRIPTION,
  CLOSED_IDENTITY_GRAMMAR_TABLE_HEADING,
  CLOSED_IDENTITY_GRAMMAR_WRONG_FRAME,
  REVIEWED_AGENCY_CLAIM_TYPES,
  buildReviewedAgencyBinding,
  closedIdentityGrammarSpec,
  closedIdentityGrammarCatalog,
  MODEL_FACING_SUFFIX_DECISION_ID_FIELDS,
  type ModelCallArgumentProjection,
  type AdvanceTimeBindingCard,
  type CombatResolveBindingCard,
  type CombatTargetCandidate,
  type CurrentTypedToolHostContext,
  type NarrationReviewBindingCard,
  type ReviewedAgencyBinding,
  type ReviewedAgencyBindingSource,
  type ReviewedAgencyClaimType,
  type PiAllowedNextAction,
  type PiFailureClass,
  type PiFailureRecovery,
  type ProjectionIdentityDiagnostics,
  type UnmappedIdentityRef,
  type SceneMoveBindingCard,
  type SceneRouteCandidate,
  type SemanticEntityFacts,
  type SemanticHandleRestoreResult,
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
      // The REGISTERED model schema is the projected model-owned view: the
      // Pi presentation overlays minus host-owned and never-model-authored
      // fields (stripped at every nesting depth). This is the single source
      // of truth shared with generic operation-specific argument validation
      // and the schema identity inventory — never a synthetic substitute.
      parameters: projectModelOwnedSchema(
        operation,
        presentedTypedToolParameters(operation, contract.inputSchema),
      ),
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
 * Host routing identity on the generic envelope: never model-authored. The
 * registered branches strip these from the operation's model-owned argument
 * schema (properties and required) — the host binds them after validation.
 */
const GENERIC_HOST_BOUND_ARGUMENT_FIELDS: ReadonlySet<string> = new Set([
  "campaign",
  "root",
]);

/**
 * The REGISTERED generic coc_invoke input schema: one closed, operation-
 * discriminated envelope that structurally matches real calls. Each branch
 * pins its operation const at the envelope level and carries ONLY that
 * operation's projected model-owned arguments as `arguments` (the exact
 * schema object shape the typed surface registers, shared by reference).
 * Host routing identity — root, campaign, session/finalization/receipt/chunk
 * identities — is absent and host-bound after validation. This same object
 * is the tool-registration schema, the runtime validation source, and the
 * schema inventory source; there is no synthetic substitute.
 */
export function buildGenericInvokeInputSchema(
  catalog: TypedToolCatalog = defaultTypedToolCatalog(),
): JsonSchema {
  const branches: JsonSchema[] = [];
  for (const tool of [...catalog.byOperation.values()].sort((a, b) =>
    a.operation.localeCompare(b.operation)
  )) {
    // Shared with the typed catalog by derivation, never mutated: the
    // generic envelope binds campaign/root itself, so those transport
    // routing fields are host-owned on THIS surface.
    const branchArguments = structuredClone(tool.parameters);
    if (isPlainObject(branchArguments.properties)) {
      for (const field of GENERIC_HOST_BOUND_ARGUMENT_FIELDS) {
        delete branchArguments.properties[field];
      }
    }
    if (Array.isArray(branchArguments.required)) {
      branchArguments.required = branchArguments.required.filter(
        (field) => !GENERIC_HOST_BOUND_ARGUMENT_FIELDS.has(field),
      );
    }
    branches.push({
      type: "object",
      properties: {
        operation: { const: tool.operation },
        // Real calls deliver the model-owned arguments as a JSON object;
        // providers that double-encode may deliver the same object as a
        // JSON string, which the runtime gate decodes and validates
        // against the same operation schema before transport.
        arguments: {
          oneOf: [
            branchArguments,
            { type: "string", description: "JSON-encoded arguments object" },
          ],
        },
      },
      required: ["operation"],
      additionalProperties: false,
    });
  }
  return {
    type: "object",
    oneOf: branches,
    additionalProperties: false,
  };
}

/** Structural validation of model input against one projected op schema. */
function validateAgainstProjectedSchema(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: string[],
): void {
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const alternatives = (schema.oneOf ?? schema.anyOf) as JsonSchema[];
    let firstBranchErrors: string[] | null = null;
    for (const alternative of alternatives) {
      const branchErrors: string[] = [];
      validateAgainstProjectedSchema(value, alternative, path, branchErrors);
      if (branchErrors.length === 0) return;
      if (firstBranchErrors === null) firstBranchErrors = branchErrors;
    }
    errors.push(
      `${path || "value"} does not match any allowed schema branch: `
        + `${(firstBranchErrors ?? []).slice(0, 5).join("; ")}`,
    );
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path || "value"} must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path || "value"} must be one of the allowed values`);
    return;
  }
  const type = typeof schema.type === "string" ? schema.type : null;
  if (type === "string" && typeof value !== "string") {
    errors.push(`${path || "value"} must be a string`);
    return;
  }
  if (type === "integer" && (!Number.isInteger(value))) {
    errors.push(`${path || "value"} must be an integer`);
    return;
  }
  if (type === "number" && typeof value !== "number") {
    errors.push(`${path || "value"} must be a number`);
    return;
  }
  if (type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path || "value"} must be a boolean`);
    return;
  }
  if (type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path || "value"} must be an array`);
      return;
    }
    if (isPlainObject(schema.items)) {
      value.forEach((entry, index) =>
        validateAgainstProjectedSchema(entry, schema.items as JsonSchema, `${path}[${index}]`, errors)
      );
    }
    return;
  }
  if (type === "object" || isPlainObject(schema.properties)) {
    if (!isPlainObject(value)) {
      errors.push(`${path || "value"} must be an object`);
      return;
    }
    const props = isPlainObject(schema.properties)
      ? schema.properties as Record<string, JsonSchema>
      : {};
    // Required constraints bind: model-owned required fields must be
    // present. Host-owned identity reaches arguments only AFTER this gate,
    // by provenance — never as a tolerated extra.
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(props, key)) {
          errors.push(`${path}${key} is not part of the model-owned surface`);
        }
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = props[key];
      if (childSchema !== undefined) {
        validateAgainstProjectedSchema(
          child,
          childSchema,
          `${path}${key}.`,
          errors,
        );
      }
    }
  }
}

/**
 * Validate a generic coc_invoke invocation against the REGISTERED
 * operation-discriminated schema — the exact object used for tool
 * registration and the schema inventory. The envelope must match one
 * operation branch (closed: no undeclared operation, no extra envelope
 * field), and the model-owned arguments must satisfy that operation's full
 * projected schema: required fields, additionalProperties false, nested
 * object/array types, enum/const/oneOf. String-encoded arguments are decoded
 * and judged as the same object. Host-owned identity is injected only AFTER
 * this gate, by provenance — never tolerated by it.
 */
export function validateGenericInvokeAgainstRegisteredSchema(
  params: { operation?: unknown; arguments?: unknown },
  schema: JsonSchema = buildGenericInvokeInputSchema(),
): { ok: true; arguments: Record<string, unknown> } | { ok: false; errors: string[] } {
  const operation = typeof params.operation === "string"
    ? params.operation.trim()
    : "";
  if (!operation) {
    return {
      ok: false,
      errors: ["operation is required and must be a non-empty string"],
    };
  }
  const branches = Array.isArray(schema.oneOf) ? schema.oneOf as JsonSchema[] : [];
  const branch = branches.find((candidate) =>
    isPlainObject(candidate.properties)
    && isPlainObject(candidate.properties.operation)
    && candidate.properties.operation.const === operation
  );
  if (branch === undefined) {
    return {
      ok: false,
      errors: [
        `operation ${operation} has no registered model-owned surface; `
          + "the closed operation list is discoverable, never guessed",
      ],
    };
  }
  let decodedArguments: unknown = params.arguments ?? {};
  if (typeof decodedArguments === "string") {
    try {
      decodedArguments = JSON.parse(decodedArguments);
    } catch {
      return {
        ok: false,
        errors: ["arguments must encode a valid JSON object"],
      };
    }
  }
  if (!isPlainObject(decodedArguments)) {
    return {
      ok: false,
      errors: ["arguments must encode a plain object"],
    };
  }
  const errors: string[] = [];
  validateAgainstProjectedSchema(
    { operation, arguments: decodedArguments },
    branch,
    "",
    errors,
  );
  return errors.length === 0
    ? { ok: true, arguments: decodedArguments }
    : { ok: false, errors };
}

/** Validate one already-selected operation's raw model arguments against the
 * exact projected schema currently registered for that operation. */
export function validateProjectedModelArguments(
  argumentsValue: unknown,
  schema: JsonSchema,
): { ok: true; arguments: Record<string, unknown> } | { ok: false; errors: string[] } {
  if (!isPlainObject(argumentsValue)) {
    return { ok: false, errors: ["arguments must encode a plain object"] };
  }
  const errors: string[] = [];
  validateAgainstProjectedSchema(argumentsValue, schema, "", errors);
  return errors.length === 0
    ? { ok: true, arguments: argumentsValue }
    : { ok: false, errors };
}

/**
 * Model-visible overlay: `setup.adopt_source_facts` still archives
 * campaign_id+facts, but the typed tool must accept campaign_id alone so the
 * host can bind the retained exact review card. Live KPs do not copy that
 * nested payload; rewriting facts stays forbidden. This is the canonical
 * presentation every catalog tool and expected_schema projection must use.
 */
export function presentedTypedToolParameters(
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
  if (operation === "session.delivery_text") {
    // Exact delivery replay: the model surface is exactly the semantic
    // mode. The host owns the canonical delivery identity (finalization id,
    // rendered hash), the chunk transport (offset/limit), AND the
    // host-routing root/campaign — no other property, inherited or
    // identity-bearing, is ever exposed to the model.
    return {
      type: "object",
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: {
          type: "string",
          enum: ["replay"],
          default: "replay",
          description: (
            "Replay the latest canonical delivery as exact host-streamed "
            + "chunks; the host binds the machine-only delivery identity."
          ),
        },
      },
    } satisfies JsonSchema;
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
  const modelOwned = projectModelOwnedSchema(operation, presented);
  const expectedSchema = bindingContext === undefined
    ? structuredClone(modelOwned)
    : projectBoundTypedToolParameters(
      operation,
      modelOwned,
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
