/**
 * Load canonical MCP archive inputSchema into Pi tool/TypeBox-consumable JSON Schema.
 * Does not register tools or change the model-visible surface.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPERATION_POLICY,
  sessionRolesForPolicy,
  type PlayPhase,
  type SessionRole,
  type KpSurface,
} from "./operation-policy.ts";

export const DEFAULT_ARCHIVE_KIND = "mcp_operation_contracts";

export class OperationContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OperationContractError";
    this.code = code;
  }
}

export type JsonSchema = Record<string, unknown>;

/** One archive operation, with inputSchema cloned for Type.Unsafe / registerTool.parameters. */
export type OperationContract = {
  operation: string;
  canonical_operation: string;
  inputSchema: JsonSchema;
};

export type OperationContractCatalog = {
  archivePath: string;
  kind: string;
  schema_version: number;
  operations: ReadonlyMap<string, OperationContract>;
};

export type ContractQuery = {
  domain?: KpSurface;
  role?: SessionRole;
  phase?: PlayPhase;
};

export function defaultArchivePath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../../references/mcp-operation-contracts.json",
  );
}

function fail(code: string, message: string): never {
  throw new OperationContractError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Deep-clone JSON Schema; preserve required/enum/const/nested object/array/additionalProperties. */
export function toToolSchema(inputSchema: unknown, label: string): JsonSchema {
  if (!isPlainObject(inputSchema)) {
    fail("malformed_input_schema", `${label} inputSchema must be a JSON object`);
  }
  let cloned: unknown;
  try {
    cloned = structuredClone(inputSchema);
  } catch {
    fail("malformed_input_schema", `${label} inputSchema is not structured-cloneable`);
  }
  if (!isPlainObject(cloned)) {
    fail("malformed_input_schema", `${label} inputSchema clone is not an object`);
  }
  return cloned;
}

function parseArchive(raw: string, archivePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("malformed_archive", `archive is not valid JSON: ${archivePath}`);
  }
  if (!isPlainObject(parsed)) {
    fail("malformed_archive", `archive root must be an object: ${archivePath}`);
  }
  if (parsed.kind !== DEFAULT_ARCHIVE_KIND) {
    fail("malformed_archive", `unexpected archive kind ${JSON.stringify(parsed.kind)}`);
  }
  if (parsed.schema_version !== 1) {
    fail("malformed_archive", `unsupported schema_version ${JSON.stringify(parsed.schema_version)}`);
  }
  if (!isPlainObject(parsed.operations)) {
    fail("malformed_archive", "archive.operations must be an object");
  }
  return parsed;
}

export function loadOperationContracts(archivePath: string = defaultArchivePath()): OperationContractCatalog {
  let raw: string;
  try {
    raw = readFileSync(archivePath, "utf8");
  } catch {
    fail("missing_archive", `operation contract archive not found: ${archivePath}`);
  }
  const parsed = parseArchive(raw, archivePath);
  const source = parsed.operations as Record<string, unknown>;
  const operations = new Map<string, OperationContract>();
  for (const [name, row] of Object.entries(source)) {
    if (!name.trim()) {
      fail("malformed_contract", "operation name must be a non-empty string");
    }
    if (operations.has(name)) {
      fail("duplicate_operation", `duplicate operation name ${name}`);
    }
    if (!isPlainObject(row)) {
      fail("malformed_contract", `operation ${name} must be an object`);
    }
    const canonical = row.canonical_operation;
    if (typeof canonical === "string" && canonical !== name) {
      fail("malformed_contract", `operation ${name} canonical_operation is ${canonical}`);
    }
    const inputSchema = toToolSchema(row.inputSchema, name);
    operations.set(name, {
      operation: name,
      canonical_operation: typeof canonical === "string" ? canonical : name,
      inputSchema,
    });
  }
  if (operations.size === 0) {
    fail("malformed_archive", "archive contains no operations");
  }
  const declaredCount = parsed.operation_count;
  if (typeof declaredCount === "number" && declaredCount !== operations.size) {
    fail(
      "malformed_archive",
      `operation_count ${declaredCount} does not match loaded ${operations.size}`,
    );
  }
  return {
    archivePath,
    kind: String(parsed.kind),
    schema_version: 1,
    operations,
  };
}

export function getOperationContract(
  catalog: OperationContractCatalog,
  operation: string,
): OperationContract {
  const found = catalog.operations.get(operation);
  if (!found) {
    fail("unknown_operation", `unknown operation ${operation}`);
  }
  return found;
}

export function listOperationNames(catalog: OperationContractCatalog): string[] {
  return [...catalog.operations.keys()].sort();
}

/** Pure filter using existing OPERATION_POLICY. Missing policy never matches. */
export function filterOperationNames(
  catalog: OperationContractCatalog,
  query: ContractQuery = {},
): string[] {
  const names: string[] = [];
  for (const name of catalog.operations.keys()) {
    const policy = OPERATION_POLICY[name];
    if (!policy) continue;
    if (query.domain !== undefined && policy.kp_surface !== query.domain) continue;
    if (query.phase !== undefined && !policy.phases.includes(query.phase)) continue;
    if (query.role !== undefined && !sessionRolesForPolicy(name, policy).includes(query.role)) {
      continue;
    }
    names.push(name);
  }
  return names.sort();
}

export function operationInputSchema(
  catalog: OperationContractCatalog,
  operation: string,
): JsonSchema {
  return getOperationContract(catalog, operation).inputSchema;
}
