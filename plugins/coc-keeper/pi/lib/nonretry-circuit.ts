import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function nonRetryableFailureFingerprint(args: {
  campaignId: string;
  operation: string;
  phase: string;
  operationArgs: unknown;
  errorCode: string;
}): string {
  const body = JSON.stringify(canonical(args));
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export class NonRetryableFailureCircuit {
  #failures = new Map<string, { code: string; operation: string }>();

  reset(): void {
    this.#failures.clear();
  }

  preflight(args: {
    campaignId: string;
    operation: string;
    phase: string;
    operationArgs: unknown;
  }): JsonRecord | null {
    for (const [fingerprint, failure] of this.#failures) {
      const candidate = nonRetryableFailureFingerprint({
        ...args,
        errorCode: failure.code,
      });
      if (candidate !== fingerprint) continue;
      return {
        ok: false,
        tool: args.operation,
        error: {
          code: "nonretryable_repeat_blocked",
          message: (
            `identical non-retryable ${failure.operation} failure was already returned; `
            + "change arguments or advance canonical state instead of retrying"
          ),
          details: { original_code: failure.code },
        },
        retryable: false,
        will_retry: false,
      };
    }
    return null;
  }

  observe(args: {
    campaignId: string;
    operation: string;
    phase: string;
    operationArgs: unknown;
    envelope: unknown;
  }): void {
    const envelope = args.envelope && typeof args.envelope === "object"
      ? args.envelope as JsonRecord
      : null;
    if (envelope?.ok === true) return;
    if (envelope?.retryable === true || envelope?.will_retry === true) return;
    const error = envelope?.error && typeof envelope.error === "object"
      ? envelope.error as JsonRecord
      : null;
    const code = typeof error?.code === "string" ? error.code : "";
    if (!code || code === "nonretryable_repeat_blocked") return;
    const fingerprint = nonRetryableFailureFingerprint({
      campaignId: args.campaignId,
      operation: args.operation,
      phase: args.phase,
      operationArgs: args.operationArgs,
      errorCode: code,
    });
    this.#failures.set(fingerprint, { code, operation: args.operation });
  }
}
