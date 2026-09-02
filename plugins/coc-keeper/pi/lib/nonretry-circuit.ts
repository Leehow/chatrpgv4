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

type RetainedFailure = {
  campaignId: string;
  code: string;
  errorClass: string;
  operation: string;
  playerTurnEpoch: number;
  canonicalProgressToken: string;
  /**
   * Operations whose success is this failure's own documented remedy.
   *
   * The fingerprint is computed from model-owned arguments and canonical
   * progress, so a failure whose remedy is a HOST-STATE refresh can never be
   * retried: performing the remedy changes neither. Seen live on 2026-09-02 --
   * `rules.settle` returned `rule_decision_stale` ("call rules.context for
   * this family, then settle a decision_ref it returns"), the Keeper called
   * `rules.context` for that exact family, re-settled, and was answered
   * `nonretryable_repeat_blocked`. The social difficulty adjudicator stayed
   * unreachable for the rest of the turn and the Keeper fell back to plain
   * core checks.
   */
  clearedBy: ReadonlySet<string>;
};

/**
 * Operations named by a failure as the way to fix it on the host side.
 *
 * Read from the canonical envelope, not from a table here: `details
 * .refresh_operation` is what the producer itself names, and a host-bound
 * `allowed_next_actions` entry is the same statement in the projected form.
 * A model-owned next action is excluded on purpose -- correcting arguments
 * already changes the fingerprint, so it needs no clearing rule.
 */
function remedyOperations(error: JsonRecord | null): ReadonlySet<string> {
  const found = new Set<string>();
  const details = error?.details && typeof error.details === "object"
    ? error.details as JsonRecord
    : null;
  const refresh = details?.refresh_operation;
  if (typeof refresh === "string" && refresh.trim()) found.add(refresh.trim());
  const actions = Array.isArray(error?.allowed_next_actions)
    ? error.allowed_next_actions
    : [];
  for (const raw of actions) {
    if (!raw || typeof raw !== "object") continue;
    const action = raw as JsonRecord;
    if (action.host_bound !== true) continue;
    const operation = action.operation;
    if (typeof operation === "string" && operation.trim()) {
      found.add(operation.trim());
    }
  }
  return found;
}

type HostBindingRefreshAuthorizationRecord = {
  campaignId: string;
  operation: "turn.output_context";
  turnId: string;
  sourceDigest: string;
  outputRevision: number;
  playerTurnEpoch: number;
  sessionGeneration: number;
  fromProgressToken: string;
  toProgressToken: string;
};

export type HostBindingRefreshAuthorization = Readonly<{
  kind: "host_binding_refresh";
  operation: "turn.output_context";
  turnId: string;
  sourceDigest: string;
  outputRevision: number;
  playerTurnEpoch: number;
  sessionGeneration: number;
}>;

export type HostHydrationCircuitSnapshot = Readonly<{
  campaignId: string;
  latestProgress: CanonicalTurnProgress | null;
  failures: ReadonlyArray<readonly [string, RetainedFailure]>;
}>;

export class NonRetryableFailureCircuit {
  #failures = new Map<string, RetainedFailure>();
  #latestProgress = new Map<string, CanonicalTurnProgress>();
  #hostBindingRefreshAuthorizations = new WeakMap<
    HostBindingRefreshAuthorization,
    HostBindingRefreshAuthorizationRecord
  >();

  reset(): void {
    this.#failures.clear();
    this.#latestProgress.clear();
    this.#hostBindingRefreshAuthorizations = new WeakMap();
  }

  /** Narrow rollback state for the private host hydration observation only. */
  captureHostHydrationState(campaignId: string): HostHydrationCircuitSnapshot {
    const latest = this.#latestProgress.get(campaignId);
    return {
      campaignId,
      latestProgress: latest === undefined ? null : { ...latest },
      failures: [...this.#failures.entries()]
        .filter(([, failure]) => failure.campaignId === campaignId)
        .map(([fingerprint, failure]) => [fingerprint, { ...failure }] as const),
    };
  }

  restoreHostHydrationState(snapshot: HostHydrationCircuitSnapshot): void {
    for (const [fingerprint, failure] of this.#failures) {
      if (failure.campaignId === snapshot.campaignId) {
        this.#failures.delete(fingerprint);
      }
    }
    for (const [fingerprint, failure] of snapshot.failures) {
      this.#failures.set(fingerprint, { ...failure });
    }
    if (snapshot.latestProgress === null) {
      this.#latestProgress.delete(snapshot.campaignId);
    } else {
      this.#latestProgress.set(snapshot.campaignId, { ...snapshot.latestProgress });
    }
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
      // A retained failure whose own remedy names this operation is now
      // stale: the host state it complained about has just been refreshed.
      // Without this, following the remedy could not unblock the retry.
      for (const [fingerprint, failure] of this.#failures) {
        if (
          failure.campaignId === args.campaignId
          && failure.clearedBy.has(args.operation)
        ) {
          this.#failures.delete(fingerprint);
        }
      }
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
      clearedBy: remedyOperations(error),
    });
  }

  authorizeHostBindingRefresh(args: {
    kind: string;
    operation: string;
    recoverableBy: string;
    recoveryEligible: boolean;
    campaignId: string;
    turnId: string;
    sourceDigest: string;
    outputRevision: number;
    playerTurnEpoch: number;
    sessionGeneration: number;
    fromProgress: CanonicalTurnProgress;
    toProgress: CanonicalTurnProgress;
  }): HostBindingRefreshAuthorization | null {
    const from = normalizeCanonicalTurnProgress(args.fromProgress);
    const to = normalizeCanonicalTurnProgress(args.toProgress);
    const current = this.#latestProgress.get(args.campaignId) ?? null;
    if (
      args.kind !== "host_binding_refresh"
      || args.operation !== "turn.output_context"
      || args.recoverableBy !== "host_binding_refresh"
      || args.recoveryEligible !== true
      || !args.campaignId
      || !args.turnId
      || !args.sourceDigest
      || !Number.isInteger(args.outputRevision)
      || args.outputRevision < 1
      || !Number.isInteger(args.sessionGeneration)
      || args.sessionGeneration < 0
      || from.stage !== "faulted"
      || to.stage !== "output_context_ready"
      || to.journalRevision !== args.turnId
      || from.playerTurnEpoch !== args.playerTurnEpoch
      || to.playerTurnEpoch !== args.playerTurnEpoch
      || to.canonicalProgressRevision !== from.canonicalProgressRevision + 1
      || (from.journalRevision !== null && from.journalRevision !== args.turnId)
      || current === null
      || compareCanonicalTurnProgress(current, from).order !== "equal"
      || compareCanonicalTurnProgress(from, to).order !== "regressive"
    ) return null;
    const authorization: HostBindingRefreshAuthorization = Object.freeze({
      kind: "host_binding_refresh",
      operation: "turn.output_context",
      turnId: args.turnId,
      sourceDigest: args.sourceDigest,
      outputRevision: args.outputRevision,
      playerTurnEpoch: args.playerTurnEpoch,
      sessionGeneration: args.sessionGeneration,
    });
    this.#hostBindingRefreshAuthorizations.set(authorization, {
      campaignId: args.campaignId,
      operation: "turn.output_context",
      turnId: args.turnId,
      sourceDigest: args.sourceDigest,
      outputRevision: args.outputRevision,
      playerTurnEpoch: args.playerTurnEpoch,
      sessionGeneration: args.sessionGeneration,
      fromProgressToken: canonicalTurnProgressToken(from),
      toProgressToken: canonicalTurnProgressToken(to),
    });
    return authorization;
  }

  advanceAuthorizedHostBindingRefresh(args: {
    campaignId: string;
    authorization: HostBindingRefreshAuthorization;
    operation: string;
    turnId: string;
    sourceDigest: string;
    outputRevision: number;
    playerTurnEpoch: number;
    sessionGeneration: number;
    canonicalProgress: CanonicalTurnProgress;
  }): boolean {
    const record = this.#hostBindingRefreshAuthorizations.get(args.authorization);
    if (record === undefined) return false;
    // Single-use even on a divergent attempt.
    this.#hostBindingRefreshAuthorizations.delete(args.authorization);
    const candidate = normalizeCanonicalTurnProgress(args.canonicalProgress);
    const current = this.#latestProgress.get(args.campaignId) ?? null;
    if (
      record.campaignId !== args.campaignId
      || record.operation !== args.operation
      || record.turnId !== args.turnId
      || record.sourceDigest !== args.sourceDigest
      || record.outputRevision !== args.outputRevision
      || record.playerTurnEpoch !== args.playerTurnEpoch
      || record.sessionGeneration !== args.sessionGeneration
      || candidate.playerTurnEpoch !== args.playerTurnEpoch
      || candidate.journalRevision !== args.turnId
      || canonicalTurnProgressToken(candidate) !== record.toProgressToken
      || current === null
      || canonicalTurnProgressToken(current) !== record.fromProgressToken
    ) return false;
    this.#latestProgress.set(args.campaignId, candidate);
    // Do not call #advanceResolved: an authorized host-binding refresh does
    // not erase failure fingerprints or consume/reset recovery budget.
    return true;
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
