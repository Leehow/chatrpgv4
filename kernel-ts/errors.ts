import type { JsonObject, JsonValue } from "./json.js";

export const ERROR_CODES = Object.freeze([
  "invalid_params", "unknown_method", "not_implemented", "campaign_not_found",
  "campaign_not_ready", "turn_state", "idempotency_conflict", "needs", "needs_choice",
  "unknown_entity", "not_reachable", "not_here", "not_owned", "revision_conflict",
  "commit_failed", "operation_in_progress", "internal",
] as const);
export type ErrorCode = typeof ERROR_CODES[number];

/** Recovery instruction carried with every refusal so the Keeper can distinguish a safe
 * replay from a request that must be repaired first. */
export const ERROR_NEXT = ["retry_same", "change_input", "narrate", "ask", "stop"] as const;
export type ErrorNext = typeof ERROR_NEXT[number];

const DEFAULT_ERROR_RECOVERY: Record<ErrorCode, { retryable: boolean; next: ErrorNext }> = {
  invalid_params: { retryable: false, next: "change_input" },
  unknown_method: { retryable: false, next: "stop" },
  not_implemented: { retryable: false, next: "stop" },
  campaign_not_found: { retryable: false, next: "stop" },
  campaign_not_ready: { retryable: false, next: "stop" },
  turn_state: { retryable: false, next: "change_input" },
  idempotency_conflict: { retryable: false, next: "change_input" },
  needs: { retryable: false, next: "change_input" },
  needs_choice: { retryable: false, next: "change_input" },
  unknown_entity: { retryable: false, next: "change_input" },
  not_reachable: { retryable: false, next: "change_input" },
  not_here: { retryable: false, next: "change_input" },
  not_owned: { retryable: false, next: "change_input" },
  revision_conflict: { retryable: false, next: "change_input" },
  commit_failed: { retryable: true, next: "retry_same" },
  operation_in_progress: { retryable: true, next: "retry_same" },
  internal: { retryable: false, next: "stop" },
};

export class RpcError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly next: ErrorNext;
  readonly fix?: string;
  readonly details?: JsonObject;
  readonly codeDetail?: string;

  constructor(code: ErrorCode, message: string, options: {
    fix?: string; details?: JsonObject; codeDetail?: string;
    retryable?: boolean; next?: ErrorNext;
  } = {}) {
    super(message);
    if (!ERROR_CODES.includes(code)) throw new TypeError(`unknown error code ${code}`);
    this.name = "RpcError";
    this.code = code;
    this.retryable = options.retryable ?? DEFAULT_ERROR_RECOVERY[code].retryable;
    this.next = options.next ?? DEFAULT_ERROR_RECOVERY[code].next;
    this.fix = options.fix;
    this.details = options.details;
    this.codeDetail = options.codeDetail;
  }

  toJson(): JsonObject {
    const result: JsonObject = {
      code: this.code, message: this.message, retryable: this.retryable, next: this.next,
    };
    if (this.codeDetail) result.code_detail = this.codeDetail;
    if (this.fix) result.fix = this.fix;
    if (this.details !== undefined) result.details = this.details;
    return result;
  }
}

export function pythonStringRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let result = quote;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (character === "\\" || character === quote) result += "\\" + character;
    else if (character === "\n") result += "\\n";
    else if (character === "\r") result += "\\r";
    else if (character === "\t") result += "\\t";
    else if (character !== " " && /[\p{C}\p{Z}]/u.test(character)) {
      result += point <= 0xff ? `\\x${point.toString(16).padStart(2, "0")}`
        : point <= 0xffff ? `\\u${point.toString(16).padStart(4, "0")}`
          : `\\U${point.toString(16).padStart(8, "0")}`;
    } else result += character;
  }
  return result + quote;
}

export function pythonTypeName(value: JsonValue): string {
  if (value === null) return "NoneType";
  if (Array.isArray(value)) return "list";
  if (typeof value === "string") return "str";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number" || typeof value === "bigint") return "int";
  return "float";
}

export function internalError(error: unknown): RpcError {
  const failure = error as NodeJS.ErrnoException;
  const filesystem: Record<string, readonly [string, number, string]> = {
    ENOENT: ["FileNotFoundError", 2, "No such file or directory"],
    ENOTDIR: ["NotADirectoryError", 20, "Not a directory"],
    EISDIR: ["IsADirectoryError", 21, "Is a directory"],
    EACCES: ["PermissionError", 13, "Permission denied"],
    EPERM: ["PermissionError", 1, "Operation not permitted"],
  };
  const mapped = failure?.code && filesystem[failure.code];
  if (mapped) {
    const [name, number, message] = mapped;
    return new RpcError("internal", `${name}: [Errno ${number}] ${message}${failure.path ? ": " + pythonStringRepr(failure.path) : ""}`);
  }
  return new RpcError("internal", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
}
