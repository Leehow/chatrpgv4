/**
 * turn-output-gate
 *
 * Extracted from the Pi-Coc host facade.  The facade injects the stable host
 * environment once, then installs this cohesive method set on its unchanged
 * public prototype.  Ordinary edits therefore stay in this owned module
 * without reopening the shared extension facade.
 */

type FrozenReviewRecoveryIdentity = any;
type JsonObject = any;
type MechanicalMarker = any;
type VisibleAssistantDisposition = any;

export const MAX_SETTLED_OUTPUT_HIDDEN_RECOVERIES = 2;

export type TurnProgressStage =
  | "awaiting_player"
  | "acting"
  | "journaled"
  | "output_context_ready"
  | "review_ready"
  | "finalized"
  | "delivered"
  | "faulted";

/**
 * The host builds this token only from accepted canonical results. Deliberately
 * absent are decision/receipt ids, source/draft digests, streamed activity and
 * model text: changing any of those must not manufacture progress.
 */
export type CanonicalTurnProgress = {
  playerTurnEpoch: number;
  stage: TurnProgressStage;
  campaignRevision: string | null;
  journalRevision: string | null;
  reviewRevision: number | null;
  finalizedRenderedSha256: string | null;
  closedObligationCount: number;
};

export type SettledOutputRecoveryDecision =
  | {
      status: "claimed";
      scheduleFollowUp: true;
      envelope: JsonObject;
      fault: null;
    }
  | {
      status: "exhausted";
      scheduleFollowUp: false;
      envelope: null;
      fault: JsonObject;
    };

const TURN_PROGRESS_STAGES: ReadonlySet<TurnProgressStage> = new Set([
  "awaiting_player",
  "acting",
  "journaled",
  "output_context_ready",
  "review_ready",
  "finalized",
  "delivered",
  "faulted",
]);

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value;
}

function requireNullableNonEmptyString(
  value: string | null,
  field: string,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be null or a non-empty string`);
  }
  return value;
}

export function normalizeCanonicalTurnProgress(
  progress: CanonicalTurnProgress,
): CanonicalTurnProgress {
  if (!TURN_PROGRESS_STAGES.has(progress.stage)) {
    throw new TypeError(`unsupported canonical turn stage: ${progress.stage}`);
  }
  return {
    playerTurnEpoch: requireNonNegativeInteger(
      progress.playerTurnEpoch,
      "playerTurnEpoch",
    ),
    stage: progress.stage,
    campaignRevision: requireNullableNonEmptyString(
      progress.campaignRevision,
      "campaignRevision",
    ),
    journalRevision: requireNullableNonEmptyString(
      progress.journalRevision,
      "journalRevision",
    ),
    reviewRevision: progress.reviewRevision === null
      ? null
      : requireNonNegativeInteger(progress.reviewRevision, "reviewRevision"),
    finalizedRenderedSha256: requireNullableNonEmptyString(
      progress.finalizedRenderedSha256,
      "finalizedRenderedSha256",
    ),
    closedObligationCount: requireNonNegativeInteger(
      progress.closedObligationCount,
      "closedObligationCount",
    ),
  };
}

export function canonicalTurnProgressToken(
  progress: CanonicalTurnProgress,
): string {
  const normalized = normalizeCanonicalTurnProgress(progress);
  // Presence of an accepted receipt is progress; changing its opaque identity
  // or digest is not. Stage/revision ordinals and closed obligations are the
  // only liveness-bearing values.
  return JSON.stringify([
    normalized.playerTurnEpoch,
    normalized.stage,
    normalized.campaignRevision !== null,
    normalized.journalRevision !== null,
    normalized.reviewRevision,
    normalized.finalizedRenderedSha256 !== null,
    normalized.closedObligationCount,
  ]);
}

function projectedCanonicalProgress(
  progress: CanonicalTurnProgress,
): JsonObject {
  const normalized = normalizeCanonicalTurnProgress(progress);
  return {
    player_turn_epoch: normalized.playerTurnEpoch,
    stage: normalized.stage,
    campaign_revision_present: normalized.campaignRevision !== null,
    journal_revision_present: normalized.journalRevision !== null,
    review_revision: normalized.reviewRevision,
    finalized_output_present: normalized.finalizedRenderedSha256 !== null,
    closed_obligation_count: normalized.closedObligationCount,
  };
}

export type TurnOutputGateStateSurface = {
  queuedVisibleDispositions: any[];
  playerTurnEpoch: number;
  currentExternalPlayerText: string | null;
  finalizedOutput: any | null;
  readonly epochMechanicalReceipts: Map<
    number,
    { dice: number; resource: number }
  >;
  pendingMechanicalOutputGateEnvelope: JsonObject | null;
  turnProcessingFault: any | null;
  preInferenceFinalizationSteerEpoch: number;
  emptyTerminalRecoveryEpoch: number;
  settledOutputRecoveryEpoch: number;
  settledOutputRecoveryAttempts: number;
  settledOutputRecoveryProgressToken: string | null;
  epochPlayerOutputDelivered: number;
  nonblockingContinuation: any | null;
};

const turnOutputState = new WeakMap<object, TurnOutputGateStateSurface>();

function stateFor(host: object): TurnOutputGateStateSurface {
  let state = turnOutputState.get(host);
  if (state === undefined) {
    state = {
      queuedVisibleDispositions: [],
      playerTurnEpoch: 0,
      currentExternalPlayerText: null,
      finalizedOutput: null,
      epochMechanicalReceipts: new Map(),
      pendingMechanicalOutputGateEnvelope: null,
      turnProcessingFault: null,
      preInferenceFinalizationSteerEpoch: 0,
      emptyTerminalRecoveryEpoch: 0,
      settledOutputRecoveryEpoch: 0,
      settledOutputRecoveryAttempts: 0,
      settledOutputRecoveryProgressToken: null,
      epochPlayerOutputDelivered: 0,
      nonblockingContinuation: null,
    };
    turnOutputState.set(host, state);
  }
  return state;
}

export function installTurnOutputGateState(prototype: object): void {
  const mutable = [
    "queuedVisibleDispositions",
    "playerTurnEpoch",
    "currentExternalPlayerText",
    "finalizedOutput",
    "pendingMechanicalOutputGateEnvelope",
    "turnProcessingFault",
    "preInferenceFinalizationSteerEpoch",
    "emptyTerminalRecoveryEpoch",
    "settledOutputRecoveryEpoch",
    "settledOutputRecoveryAttempts",
    "settledOutputRecoveryProgressToken",
    "epochPlayerOutputDelivered",
    "nonblockingContinuation",
  ] as const;
  const descriptors: PropertyDescriptorMap = {
    epochMechanicalReceipts: {
      get(this: object) { return stateFor(this).epochMechanicalReceipts; },
    },
  };
  for (const key of mutable) {
    descriptors[key] = {
      get(this: object) { return stateFor(this)[key]; },
      set(this: object, value: TurnOutputGateStateSurface[typeof key]) {
        stateFor(this)[key] = value as never;
      },
    };
  }
  Object.defineProperties(prototype, descriptors);
}

export function createTurnOutputGateMethods(
  environment: Record<string, any>,
) {
  const {
    REVIEW_RECOVERY_FAILURE_CLASSES,
    buildSettledOutputGateEnvelope,
    buildSettledOutputPreflightEnvelope,
    canonicalJsonValueSha256,
    detectMechanicalMarkers,
    frozenReviewIdentitiesMatch,
    frozenReviewIdentityFromFault,
    mechanicalMarkerClassesUncovered,
    objectOrNull,
  } = environment;
  return {

  queueVisibleAssistantDisposition(this: any,
    disposition: VisibleAssistantDisposition,
    dispatchKey?: string,
  ): void {
    const queued = { disposition, dispatchKey };
    if (disposition === "operational_wait") {
      this.queuedVisibleDispositions.push(queued);
    } else {
      this.queuedVisibleDispositions.unshift(queued);
    }
  },


  markAgentStart(this: any): void {
    this.agentActive = true;
    this.openingSetupAgentTurn += 1;
    this.openingSetupTurnCampaignId = null;
    this.openingSetupTurnCampaignAmbiguous = false;
    this.openingSetupVisibleOutputAuthorization = null;
  },


  markOpeningProjected(this: any, dispatchKey?: string): void {
    for (const [key, state] of this.states) {
      if (
        state === "awaiting"
        && (dispatchKey === undefined || key === dispatchKey)
      ) {
        this.states.set(key, "projected");
      }
    }
    this.queueVisibleAssistantDisposition("projected_opening", dispatchKey);
  },


  markIndependentVisibleOutput(this: any): void {
    if ([...this.states.values()].some((state) => state === "awaiting")) {
      this.queueVisibleAssistantDisposition("independent");
    }
  },


  markTerminalBlocker(this: any, dispatchKey?: string): void {
    // A structured blocking terminal is always player-visible. It may arrive
    // after an unrelated nonblocking wake was queued, so revoke that narrow
    // suppression token instead of globally hiding later assistant output.
    this.nonblockingContinuation = null;
    if ([...this.states].some(([key, state]) => (
      state === "awaiting"
      && (dispatchKey === undefined || key === dispatchKey)
    ))) {
      if (!this.queuedVisibleDispositions.some((queued) => (
        queued.disposition === "terminal_blocker"
        && (
          dispatchKey === undefined
          || queued.dispatchKey === dispatchKey
        )
      ))) {
        this.queueVisibleAssistantDisposition(
          "terminal_blocker",
          dispatchKey,
        );
      }
    }
  },


  markFinalizedOutputReady(this: any,
    renderedText: string,
    renderedSha256: string,
  ): boolean {
    if (
      !renderedText
      || renderedSha256 !== canonicalJsonValueSha256(renderedText)
    ) {
      return false;
    }
    this.finalizedOutput = {
      epoch: this.playerTurnEpoch,
      renderedText,
      renderedSha256,
      delivered: false,
    };
    return true;
  },


  hasPendingFinalizedOutput(this: any): boolean {
    return (
      this.finalizedOutput?.delivered === false
      && this.finalizedOutput.epoch === this.playerTurnEpoch
    );
  },


  armTurnProcessingFault(this: any, base: JsonObject): { fault: JsonObject; first: boolean } {
    if (
      this.turnProcessingFault !== null
      && this.turnProcessingFault.epoch === this.playerTurnEpoch
    ) {
      return { fault: this.turnProcessingFault.fault, first: false };
    }
    // A fault retained from an older epoch is superseded, not deduplicated:
    // it must not block the new epoch's own fault. The superseded fault's
    // pending turn stays preserved campaign-side; the narration.review
    // latch keeps failing closed under the new retained fault.
    const fault: JsonObject = {
      ...base,
      player_turn_epoch: this.playerTurnEpoch,
    };
    this.turnProcessingFault = {
      epoch: this.playerTurnEpoch,
      fault,
      deliveryTaken: false,
      identity: frozenReviewIdentityFromFault(fault, this.playerTurnEpoch),
      recoveryArmed: false,
      recoveryConsumed: false,
    };
    this.pendingMechanicalOutputGateEnvelope = null;
    return { fault, first: true };
  },


  currentTurnProcessingFault(this: any): JsonObject | null {
    return this.turnProcessingFault?.fault ?? null;
  },


  clearTurnProcessingFault(this: any): void {
    this.turnProcessingFault = null;
  },


  frozenReviewRecoveryIdentity(this: any): FrozenReviewRecoveryIdentity | null {
    return this.turnProcessingFault?.identity ?? null;
  },


  armFrozenReviewRecovery(this: any, request: {
    campaign_id: string;
    run_id: string;
    session_id: string;
    turn_id: string;
    revision: number;
    source_digest: string;
  }): boolean {
    const retained = this.turnProcessingFault;
    const identity = retained?.identity ?? null;
    if (
      retained === null
      || identity === null
      || !REVIEW_RECOVERY_FAILURE_CLASSES.has(identity.failure_class)
      || retained.recoveryConsumed
      || identity.player_turn_epoch !== this.playerTurnEpoch
      || !frozenReviewIdentitiesMatch(identity, {
        ...request,
        player_turn_epoch: this.playerTurnEpoch,
      })
    ) return false;
    retained.recoveryArmed = true;
    return true;
  },


  matchFrozenReviewRecovery(this: any, request: {
    campaign_id: string;
    run_id: string;
    session_id: string;
    turn_id: string;
    revision: number;
    source_digest: string;
  }): "allow" | "reject" {
    const retained = this.turnProcessingFault;
    if (retained === null) return "allow";
    const identity = retained.identity;
    if (
      identity === null
      || !retained.recoveryArmed
      || retained.recoveryConsumed
      || !frozenReviewIdentitiesMatch(identity, {
        ...request,
        player_turn_epoch: this.playerTurnEpoch,
      })
    ) return "reject";
    return "allow";
  },


  consumeFrozenReviewRecovery(this: any): boolean {
    const retained = this.turnProcessingFault;
    if (retained === null) return true;
    if (!retained.recoveryArmed || retained.recoveryConsumed) return false;
    retained.recoveryConsumed = true;
    return true;
  },


  restoreFrozenReviewRecovery(this: any): void {
    const retained = this.turnProcessingFault;
    if (retained?.recoveryConsumed === true) {
      retained.recoveryConsumed = false;
    }
  },


  takeTurnProcessingFaultForDelivery(this: any): JsonObject | null {
    const retained = this.turnProcessingFault;
    if (
      retained === null
      || retained.epoch !== this.playerTurnEpoch
      || retained.deliveryTaken
    ) return null;
    retained.deliveryTaken = true;
    return retained.fault;
  },


  releaseTurnProcessingFaultDelivery(this: any, fault: JsonObject): void {
    if (
      this.turnProcessingFault?.epoch === this.playerTurnEpoch
      && this.turnProcessingFault.fault === fault
    ) {
      this.turnProcessingFault.deliveryTaken = false;
    }
  },


  markExternalUserInput(this: any, playerText: string | null = null): void {
    this.playerTurnEpoch += 1;
    this.currentExternalPlayerText = playerText;
    this.finalizedOutput = null;
    this.nonblockingContinuation = null;
    this.currentDependencySuppression = null;
    this.currentVisibleCampaignId = null;
    this.pendingMechanicalOutputGateEnvelope = null;
    this.settledOutputRecoveryEpoch = this.playerTurnEpoch;
    this.settledOutputRecoveryAttempts = 0;
    this.settledOutputRecoveryProgressToken = null;
  },


  bindHandoutReplayRequest(this: any, params: JsonObject): JsonObject {
    if (params.operation !== "state.replay_handout") return params;
    const args = objectOrNull(params.arguments);
    const assertion = objectOrNull(args?.request_assertion);
    const assetId = typeof args?.handout_id === "string"
      ? args.handout_id.trim()
      : "";
    const playerText = typeof assertion?.player_text === "string"
      ? assertion.player_text
      : null;
    if (
      this.playerTurnEpoch < 1
      || this.currentExternalPlayerText === null
      || playerText !== this.currentExternalPlayerText
    ) {
      throw new Error(
        "state.replay_handout request_assertion.player_text must equal the "
        + "exact current external player message",
      );
    }
    if (!assetId) {
      throw new Error("state.replay_handout handout_id must be non-empty");
    }
    return {
      ...params,
      arguments: {
        ...args,
        request_assertion: {
          ...assertion,
          player_turn_epoch: this.playerTurnEpoch,
        },
      },
    };
  },


  observeCanonicalReceipt(this: any,
    operation: string,
    envelope: JsonObject | null,
  ): void {
    if (envelope?.ok !== true) return;
    const data = objectOrNull(envelope.data);
    if (data === null) return;
    let entry = this.epochMechanicalReceipts.get(this.playerTurnEpoch);
    if (entry === undefined) {
      entry = { dice: 0, resource: 0 };
      this.epochMechanicalReceipts.set(this.playerTurnEpoch, entry);
      if (this.epochMechanicalReceipts.size > 8) {
        const oldest = [...this.epochMechanicalReceipts.keys()].sort(
          (a, b) => a - b,
        )[0];
        this.epochMechanicalReceipts.delete(oldest);
      }
    }
    if (typeof data.roll_id === "string" && data.roll_id.length > 0) {
      entry.dice += 1;
    } else if (operation.startsWith("state.")) {
      entry.resource += 1;
    } else if (
      (operation === "turn.finalize"
        || operation === "evidence.table_opening")
      && typeof data.rendered_text === "string"
      && data.rendered_text.length > 0
    ) {
      // The finalizer/settled-output receipt already fails closed when a
      // qualifying roll lacks binding, so its presence covers both marker
      // classes for the epoch even when the host digest gate declined to
      // arm the exact-replace (e.g. a raw-UTF8 digest variant).
      entry.dice += 1;
      entry.resource += 1;
    }
  },


  mechanicalMarkersUncovered(this: any, visibleText: string): MechanicalMarker[] {
    const markers = detectMechanicalMarkers(visibleText);
    if (markers.length === 0) return [];
    const receipts = this.epochMechanicalReceipts.get(this.playerTurnEpoch)
      ?? { dice: 0, resource: 0 };
    return mechanicalMarkerClassesUncovered(
      markers,
      receipts.dice > 0,
      receipts.resource > 0,
    );
  },


  takeMechanicalOutputGateEnvelope(this: any): JsonObject | null {
    const envelope = this.pendingMechanicalOutputGateEnvelope;
    this.pendingMechanicalOutputGateEnvelope = null;
    return envelope;
  },


  hasAnswerPendingExternalPlayerInput(this: any): boolean {
    return (
      this.playerTurnEpoch > 0
      && this.currentExternalPlayerText !== null
      && this.epochPlayerOutputDelivered !== this.playerTurnEpoch
    );
  },


  markEpochPlayerOutputDelivered(this: any): void {
    this.epochPlayerOutputDelivered = this.playerTurnEpoch;
  },


  takeEmptyTerminalRecovery(this: any): JsonObject | null {
    const pendingText = this.currentExternalPlayerText;
    if (
      this.playerTurnEpoch <= 0
      || pendingText === null
      || this.epochPlayerOutputDelivered === this.playerTurnEpoch
      || this.emptyTerminalRecoveryEpoch === this.playerTurnEpoch
    ) {
      return null;
    }
    this.emptyTerminalRecoveryEpoch = this.playerTurnEpoch;
    return {
      schema_version: 1,
      kind: "empty_terminal_recovery",
      status: "scheduled",
      player_turn_epoch: this.playerTurnEpoch,
      action: "answer_pending_player_input",
      pending_player_input_sha256: canonicalJsonValueSha256(pendingText),
    };
  },


  takePreInferenceFinalizationSteer(this: any,
    requireFinalization: boolean,
  ): JsonObject | null {
    if (
      !requireFinalization
      || this.playerTurnEpoch <= 0
      || this.preInferenceFinalizationSteerEpoch === this.playerTurnEpoch
    ) {
      return null;
    }
    return buildSettledOutputPreflightEnvelope(this.playerTurnEpoch);
  },


  claimSettledOutputRecovery(this: any,
    progress: CanonicalTurnProgress,
  ): SettledOutputRecoveryDecision {
    const normalized = normalizeCanonicalTurnProgress(progress);
    if (
      this.playerTurnEpoch <= 0
      || normalized.playerTurnEpoch !== this.playerTurnEpoch
    ) {
      throw new RangeError(
        "canonical progress must belong to the current external player epoch",
      );
    }
    if (this.settledOutputRecoveryEpoch !== this.playerTurnEpoch) {
      this.settledOutputRecoveryEpoch = this.playerTurnEpoch;
      this.settledOutputRecoveryAttempts = 0;
      this.settledOutputRecoveryProgressToken = null;
    }

    const progressToken = canonicalTurnProgressToken(normalized);
    this.settledOutputRecoveryProgressToken = progressToken;
    if (
      this.settledOutputRecoveryAttempts
      >= MAX_SETTLED_OUTPUT_HIDDEN_RECOVERIES
    ) {
      return {
        status: "exhausted",
        scheduleFollowUp: false,
        envelope: null,
        fault: {
          schema_version: 1,
          contract_id: "coc.pi-turn-processing-fault.v1",
          kind: "turn_processing_fault",
          status: "terminal",
          stage: "finalization_repair",
          code: "settled_output_recovery_exhausted",
          message: (
            "settled-output recovery exhausted without an admissible "
            + "finalization receipt; the pending turn and receipts are preserved"
          ),
          retryable: false,
          will_retry: false,
          recovery_attempted: this.settledOutputRecoveryAttempts,
          recovery_budget: MAX_SETTLED_OUTPUT_HIDDEN_RECOVERIES,
          failure_class: "settled_output_recovery_exhausted",
          canonical_progress: projectedCanonicalProgress(normalized),
        },
      };
    }

    this.settledOutputRecoveryAttempts += 1;
    const attempt = this.settledOutputRecoveryAttempts;
    return {
      status: "claimed",
      scheduleFollowUp: true,
      envelope: buildSettledOutputGateEnvelope(
        this.playerTurnEpoch,
        {
          attempt,
          maxAttempts: MAX_SETTLED_OUTPUT_HIDDEN_RECOVERIES,
          canonicalProgress: projectedCanonicalProgress(normalized),
        },
      ),
      fault: null,
    };
  },


  markPreInferenceFinalizationSteerDelivered(this: any, envelope: JsonObject): boolean {
    if (
      envelope.kind !== "settled_output_preflight"
      || envelope.player_turn_epoch !== this.playerTurnEpoch
      || this.playerTurnEpoch <= 0
      || this.preInferenceFinalizationSteerEpoch === this.playerTurnEpoch
    ) {
      return false;
    }
    this.preInferenceFinalizationSteerEpoch = this.playerTurnEpoch;
    return true;
  },


  coordinatorContinuationContext(this: any,
    dispatchKey: string,
    terminalStatus: string,
  ): JsonObject {
    const dependencyId = this.currentDependencyByDispatch.get(dispatchKey);
    const dependencyWait = dependencyId
      ? this.currentDependencyWaits.get(dependencyId)
      : undefined;
    const exactCurrentDependency = (
      dependencyId !== undefined
      && dependencyWait?.dispatchKey === dispatchKey
      && terminalStatus === "fulfilled"
    );
    const recordedClass = this.dispatchClasses.get(dispatchKey);
    const dispatchClass = (
      recordedClass === "blocking_micro" && !exactCurrentDependency
        ? "nonblocking_background"
        : recordedClass ?? "nonblocking_background"
    );
    const openingState = [...this.openingSetupStates.values()].find(
      (candidate) => candidate.dispatchIdentity === dispatchKey,
    );
    const finalized = this.finalizedOutput;
    // Terminal publication may race ahead of the exact assistant message_end.
    // Carry the armed provenance into Pi's queued followUp now; the consumer
    // below still refuses to arm suppression until that exact output has
    // actually been delivered in the same user epoch.
    if (
      dispatchClass === "nonblocking_background"
      && terminalStatus === "fulfilled"
      && finalized !== null
      && finalized.epoch === this.playerTurnEpoch
    ) {
      return {
        continuation_class: "nonblocking_background_after_finalized_output",
        dispatch_class: dispatchClass,
        player_turn_epoch: finalized.epoch,
        finalized_rendered_sha256: finalized.renderedSha256,
        dispatch_key: dispatchKey,
      };
    }
    return {
      continuation_class: dispatchClass,
      dispatch_class: dispatchClass,
      player_turn_epoch: this.playerTurnEpoch,
      dispatch_key: dispatchKey,
      ...(
        dispatchClass === "blocking_micro"
        && dependencyId !== undefined
        && dependencyWait !== undefined
          ? {
            dependency_id: dependencyId,
            dependency_campaign_id: dependencyWait.campaignId,
            dependency_job_id: dependencyWait.jobId,
            dependency_ref: dependencyWait.dependencyRef,
          }
          : {}
      ),
      ...(
        dispatchClass === "blocking_opening"
        && openingState?.route.next_operation !== null
        && openingState?.route.next_operation !== undefined
          ? { opening_setup_route: openingState.route }
          : {}
      ),
    };
  },
  };
}

export type TurnOutputGateMethods = ReturnType<
  typeof createTurnOutputGateMethods
>;
