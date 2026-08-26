import { createHash } from "node:crypto";
import {
  canonicalTurnProgressToken,
  compareCanonicalTurnProgress,
  normalizeCanonicalTurnProgress,
  type CanonicalTurnProgress,
} from "./turn-output-gate.ts";

type JsonRecord = Record<string, unknown>;

const HOST_OWNED_ARGUMENT_KEYS = new Set([
  "campaign",
  "campaign_id",
  "content_digest",
  "decision_id",
  "idempotency_key",
  "player_text",
  "player_turn_epoch",
  "receipt_id",
  "rendered_sha256",
  "review_id",
  "revision",
  "root",
  "run_id",
  "session_id",
  "source_digest",
  "turn_id",
  "workspace",
]);

const HOST_OWNED_ARGUMENT_PRESENT = "<host-owned-present>";

function isHostOwnedArgumentKey(key: string): boolean {
  return HOST_OWNED_ARGUMENT_KEYS.has(key)
    || key.endsWith("_digest")
    || key.endsWith("_sha256")
    || key.endsWith("_receipt_id");
}

/**
 * Retain semantic choices and host-owned field presence while removing the
 * opaque identity churn that the host owns. Whitespace-only draft edits also
 * normalize to the same value.
 */
export function normalizeModelOwnedArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeModelOwnedArguments);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [
          key,
          isHostOwnedArgumentKey(key)
            ? HOST_OWNED_ARGUMENT_PRESENT
            : normalizeModelOwnedArguments(item),
        ]),
    );
  }
  if (typeof value === "string") return value.trim().replace(/\s+/gu, " ");
  return value;
}

export type NonRetryableFailureScope = {
  playerTurnEpoch: number;
  canonicalProgress: CanonicalTurnProgress;
};

type OptionalFailureScope = Partial<NonRetryableFailureScope>;

type ResolvedFailureScope = {
  playerTurnEpoch: number;
  canonicalProgressToken: string;
};

function resolveScope(scope: OptionalFailureScope): ResolvedFailureScope {
  const hasEpoch = scope.playerTurnEpoch !== undefined;
  const hasProgress = scope.canonicalProgress !== undefined;
  if (hasEpoch !== hasProgress) {
    throw new TypeError(
      "playerTurnEpoch and canonicalProgress must be supplied together",
    );
  }
  if (!hasEpoch || !hasProgress) {
    // Compatibility for the not-yet-wired extension facade. New callers must
    // provide the explicit scope above; the integrator will remove this lane.
    return { playerTurnEpoch: 0, canonicalProgressToken: "legacy" };
  }
  if (
    !Number.isInteger(scope.playerTurnEpoch)
    || (scope.playerTurnEpoch as number) < 0
    || scope.canonicalProgress!.playerTurnEpoch !== scope.playerTurnEpoch
  ) {
    throw new RangeError(
      "canonical progress must belong to the supplied player turn epoch",
    );
  }
  return {
    playerTurnEpoch: scope.playerTurnEpoch as number,
    canonicalProgressToken: canonicalTurnProgressToken(
      scope.canonicalProgress!,
    ),
  };
}

export function nonRetryableFailureFingerprint(args: {
  campaignId: string;
  operation: string;
  phase: string;
  operationArgs: unknown;
  errorCode: string;
  errorClass?: string;
  playerTurnEpoch?: number;
  canonicalProgress?: CanonicalTurnProgress;
}): string {
  const scope = resolveScope(args);
  const body = JSON.stringify({
    campaignId: args.campaignId,
    operation: args.operation,
    phase: args.phase,
    operationArgs: normalizeModelOwnedArguments(args.operationArgs),
    errorCode: args.errorCode,
    errorClass: args.errorClass ?? args.errorCode,
    playerTurnEpoch: scope.playerTurnEpoch,
    canonicalProgressToken: scope.canonicalProgressToken,
  });
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export class NonRetryableFailureCircuit {
  #failures = new Map<string, {
    campaignId: string;
    code: string;
    errorClass: string;
    operation: string;
    playerTurnEpoch: number;
    canonicalProgressToken: string;
  }>();
  #latestProgress = new Map<string, CanonicalTurnProgress>();

  reset(): void {
    this.#failures.clear();
    this.#latestProgress.clear();
  }

  preflight(args: {
    campaignId: string;
    operation: string;
    phase: string;
    operationArgs: unknown;
  } & OptionalFailureScope): JsonRecord | null {
    const scope = resolveScope(args);
    if (args.canonicalProgress !== undefined) {
      const progressDecision = this.#acceptProgress(
        args.campaignId,
        args.canonicalProgress,
      );
      if (!progressDecision.accepted) {
        return {
          ok: false,
          tool: args.operation,
          error: {
            code: "canonical_progress_rejected",
            class: "host_progress",
            message: "stale or regressive canonical progress was refused",
            details: {
              player_turn_epoch: scope.playerTurnEpoch,
              candidate_revision:
                args.canonicalProgress.canonicalProgressRevision,
              candidate_stage: args.canonicalProgress.stage,
              latest_revision:
                progressDecision.current?.canonicalProgressRevision ?? null,
              latest_stage: progressDecision.current?.stage ?? null,
              reason: progressDecision.reason,
            },
          },
          retryable: false,
          will_retry: false,
        };
      }
    }
    for (const [fingerprint, failure] of this.#failures) {
      const candidate = nonRetryableFailureFingerprint({
        ...args,
        errorCode: failure.code,
        errorClass: failure.errorClass,
      });
      if (candidate !== fingerprint) continue;
      return {
        ok: false,
        tool: args.operation,
        error: {
          code: "nonretryable_repeat_blocked",
          message: (
            `identical non-retryable ${failure.operation} failure was already returned; `
            + "change model-owned semantic arguments or advance canonical state "
            + "instead of changing host-owned identity fields"
          ),
          details: {
            original_code: failure.code,
            original_class: failure.errorClass,
            player_turn_epoch: scope.playerTurnEpoch,
            canonical_progress_token: scope.canonicalProgressToken,
          },
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
  } & OptionalFailureScope): void {
    const scope = resolveScope(args);
    if (args.canonicalProgress !== undefined) {
      const progressDecision = this.#acceptProgress(
        args.campaignId,
        args.canonicalProgress,
      );
      if (!progressDecision.accepted) return;
    }
    const envelope = args.envelope && typeof args.envelope === "object"
      ? args.envelope as JsonRecord
      : null;
    if (envelope?.ok === true) {
      this.#advanceResolved({
        campaignId: args.campaignId,
        playerTurnEpoch: scope.playerTurnEpoch,
        canonicalProgressToken: scope.canonicalProgressToken,
      });
      return;
    }
    if (envelope?.retryable === true || envelope?.will_retry === true) return;
    const error = envelope?.error && typeof envelope.error === "object"
      ? envelope.error as JsonRecord
      : null;
    const code = typeof error?.code === "string" ? error.code : "";
    if (!code || code === "nonretryable_repeat_blocked") return;
    const errorClass = typeof error?.class === "string" && error.class
      ? error.class
      : code;
    const fingerprint = nonRetryableFailureFingerprint({
      campaignId: args.campaignId,
      operation: args.operation,
      phase: args.phase,
      operationArgs: args.operationArgs,
      errorCode: code,
      errorClass,
      ...(args.canonicalProgress === undefined
        ? {}
        : {
            playerTurnEpoch: scope.playerTurnEpoch,
            canonicalProgress: args.canonicalProgress,
          }),
    });
    this.#advanceResolved({
      campaignId: args.campaignId,
      playerTurnEpoch: scope.playerTurnEpoch,
      canonicalProgressToken: scope.canonicalProgressToken,
    });
    this.#failures.set(fingerprint, {
      campaignId: args.campaignId,
      code,
      errorClass,
      operation: args.operation,
      playerTurnEpoch: scope.playerTurnEpoch,
      canonicalProgressToken: scope.canonicalProgressToken,
    });
  }

  advance(args: {
    campaignId: string;
    playerTurnEpoch: number;
    canonicalProgress: CanonicalTurnProgress;
  }): void {
    if (args.canonicalProgress.playerTurnEpoch !== args.playerTurnEpoch) {
      throw new RangeError(
        "canonical progress must belong to the supplied player turn epoch",
      );
    }
    this.#acceptProgress(args.campaignId, args.canonicalProgress);
  }

  #acceptProgress(
    campaignId: string,
    candidateValue: CanonicalTurnProgress,
  ): {
    accepted: boolean;
    current: CanonicalTurnProgress | null;
    reason: string;
  } {
    const candidate = normalizeCanonicalTurnProgress(candidateValue);
    const current = this.#latestProgress.get(campaignId) ?? null;
    if (current !== null) {
      const comparison = compareCanonicalTurnProgress(current, candidate);
      if (comparison.order === "stale" || comparison.order === "regressive") {
        return {
          accepted: false,
          current,
          reason: comparison.reason,
        };
      }
      if (comparison.order === "equal") {
        return { accepted: true, current, reason: comparison.reason };
      }
    }
    this.#latestProgress.set(campaignId, candidate);
    this.#advanceResolved({
      campaignId,
      playerTurnEpoch: candidate.playerTurnEpoch,
      canonicalProgressToken: canonicalTurnProgressToken(candidate),
    });
    return {
      accepted: true,
      current: candidate,
      reason: current === null ? "initial_canonical_progress" : "forward",
    };
  }

  #advanceResolved(args: {
    campaignId: string;
    playerTurnEpoch: number;
    canonicalProgressToken: string;
  }): void {
    for (const [fingerprint, failure] of this.#failures) {
      if (failure.campaignId !== args.campaignId) continue;
      if (
        failure.playerTurnEpoch !== args.playerTurnEpoch
        || failure.canonicalProgressToken !== args.canonicalProgressToken
      ) {
        this.#failures.delete(fingerprint);
      }
    }
  }
}
