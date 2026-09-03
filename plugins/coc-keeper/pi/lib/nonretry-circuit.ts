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

/**
 * The idempotency keys a call carries.
 *
 * They are host-owned identity for every other failure -- reissuing the same
 * refused call under a fresh key must not evade the block. They are the
 * opposite for a failure whose whole complaint IS that the key is already
 * bound: there a fresh key is not churn, it is the only thing that makes the
 * call a different call. See `identityScopedFailure`.
 */
const IDEMPOTENCY_KEY_ARGUMENT_KEYS: ReadonlySet<string> = new Set([
  "decision_id",
  "idempotency_key",
]);

/**
 * Failure classes whose subject is the idempotency key itself.
 *
 * Read from the canonical envelope's own `class`, not from a code table here:
 * `idempotency_conflict` is the projection's statement that the supplied key
 * is already bound to different immutable arguments. Its only model-side
 * remedy is a fresh key, and normalizing the key away made that remedy
 * invisible -- measured 2026-09-02 (debug-gate9-depth-10-r61): `rules.settle`
 * refused `combat-attack-corbitt-38-empty-v1` with `idempotency_conflict`, the
 * Keeper reissued the identical semantics under
 * `combat-attack-corbitt-38-empty-v2`, and was answered
 * `nonretryable_repeat_blocked`. Eight of those followed and the player's turn
 * was never delivered.
 */
export function identityScopedFailure(errorClass: string): boolean {
  return errorClass === "idempotency_conflict";
}

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
 *
 * `retainedKeys` names argument keys that stay literal despite being
 * host-owned, for a failure whose own subject is that key.
 */
export function normalizeModelOwnedArguments(
  value: unknown,
  retainedKeys: ReadonlySet<string> = new Set<string>(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeModelOwnedArguments(item, retainedKeys));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [
          key,
          isHostOwnedArgumentKey(key) && !retainedKeys.has(key)
            ? HOST_OWNED_ARGUMENT_PRESENT
            : normalizeModelOwnedArguments(item, retainedKeys),
        ]),
    );
  }
  if (typeof value === "string") return value.trim().replace(/\s+/gu, " ");
  return value;
}

/** Host-owned argument keys this call actually carried, for the refusal. */
function hostOwnedKeysPresent(
  value: unknown,
  retainedKeys: ReadonlySet<string>,
): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as JsonRecord)
    .filter((key) => isHostOwnedArgumentKey(key) && !retainedKeys.has(key))
    .sort();
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
  const errorClass = args.errorClass ?? args.errorCode;
  const body = JSON.stringify({
    campaignId: args.campaignId,
    operation: args.operation,
    phase: args.phase,
    operationArgs: normalizeModelOwnedArguments(
      args.operationArgs,
      identityScopedFailure(errorClass)
        ? IDEMPOTENCY_KEY_ARGUMENT_KEYS
        : undefined,
    ),
    errorCode: args.errorCode,
    errorClass,
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
      const identityScoped = identityScopedFailure(failure.errorClass);
      const normalizedAway = hostOwnedKeysPresent(
        args.operationArgs,
        identityScoped ? IDEMPOTENCY_KEY_ARGUMENT_KEYS : new Set<string>(),
      );
      const remedies = [...failure.clearedBy].sort();
      // Name what would actually differ. The old sentence -- "change
      // model-owned semantic arguments or advance canonical state instead of
      // changing host-owned identity fields" -- told the Keeper what NOT to do
      // and left it guessing which of its arguments the host had normalized
      // away, so a correct recovery and a pointless one looked identical from
      // the outside. Measured 2026-09-02 (debug-gate9-depth-10-r61): fifteen
      // of these across two lanes, neither turn ever delivered.
      const unblockedBy: string[] = [];
      if (identityScoped) {
        unblockedBy.push(
          "supply an unused decision_id (this one is already bound, and the "
          + "one you just sent has been refused under these same arguments)",
        );
      }
      for (const remedy of remedies) {
        unblockedBy.push(`succeed ${remedy}, then repeat this call`);
      }
      unblockedBy.push(
        normalizedAway.length
          ? "change a model-owned semantic argument (anything other than "
            + `${normalizedAway.join(", ")})`
          : "change a model-owned semantic argument",
      );
      unblockedBy.push("advance canonical state, which rescopes this block");
      return {
        ok: false,
        tool: args.operation,
        error: {
          code: "nonretryable_repeat_blocked",
          message: (
            `identical non-retryable ${failure.operation} failure `
            + `(${failure.code}) was already returned for this canonical `
            + "state; it will repeat until something below differs. "
            + unblockedBy.map((line, index) => `(${index + 1}) ${line}`).join("; ")
            + (
              normalizedAway.length
                ? `. These arguments are host-owned and are ignored by the `
                  + `comparison, so changing them cannot unblock it: `
                  + `${normalizedAway.join(", ")}`
                : ""
            )
          ),
          details: {
            original_code: failure.code,
            original_class: failure.errorClass,
            player_turn_epoch: scope.playerTurnEpoch,
            canonical_progress_token: scope.canonicalProgressToken,
            unblocked_by: unblockedBy,
            ignored_argument_keys: normalizedAway,
            remedy_operations: remedies,
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
