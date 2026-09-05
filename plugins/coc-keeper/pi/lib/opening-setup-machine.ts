/**
 * opening-setup-machine — retired, kept as an inert shim.
 *
 * The setup session role no longer exists: onboarding is `pi-coc-setup`, its
 * own process with its own extension, and the play launcher refuses a campaign
 * that is not ready rather than becoming a setup host. `sessionRoleFromEnv`
 * rejects `COC_PI_SESSION_ROLE=setup` outright, so none of the 15 opening
 * phases this module drove can be entered.
 *
 * What stood here was 4742 lines and 93 methods, of which the host referenced
 * 32 and 61 had no consumer at all. This shim answers the 32 the host still
 * calls with "nothing is happening", so those call sites can be removed with
 * play verified at each step rather than in one 47-site edit. It exists to be
 * deleted; do not add behaviour to it.
 */

type JsonObject = any;
type OpeningSetupRoute = any;
type OpeningSetupState = any;

export const NO_SELECTOR_SETUP_COMPLETE_DECISION_ID_PATTERN = (
  "^setup-complete:[A-Za-z0-9][A-Za-z0-9._:-]*:"
  + "[A-Za-z0-9][A-Za-z0-9._:-]*:handoff-1$"
);

export function noSelectorSetupCompleteDecisionId(
  campaignId: string,
  investigatorId: string,
): string {
  return `setup-complete:${campaignId}:${investigatorId}:handoff-1`;
}

/**
 * The state surface stays installed and permanently empty.
 *
 * The host's own gate class -- not this module -- reads
 * `this.openingSetupStates.size` while deciding visible output, so removing
 * the properties outright made a live play turn throw on an undefined map.
 * Empty containers keep every one of those reads answering "nothing is
 * happening" until the host's remaining uses are removed too.
 */
export type OpeningSetupMachineStateSurface = {
  effectiveTypedRoleValue: "setup" | "play" | null;
  readonly openingSetupStates: Map<string, OpeningSetupState>;
  readonly retainedAdoptSourceFacts: Map<string, JsonObject>;
  readonly openingSetupAttempts: Map<string, JsonObject>;
  openingSetupGenerationSequence: number;
  readonly openingSetupLatestIssuedGeneration: Map<string, number>;
  readonly openingSetupRetiredGeneration: Map<string, number>;
  readonly setupHandoffDecisionPlayerEpoch: Map<string, JsonObject>;
  openingSetupAgentTurn: number;
  openingSetupTurnCampaignId: string | null;
  openingSetupTurnCampaignAmbiguous: boolean;
  openingSetupVisibleOutputAuthorization: JsonObject | null;
  pendingChargenPlayerSummary: { campaignId: string; text: string } | null;
  readonly openingSetupContinuationQueued: Set<string>;
  readonly openingSetupTerminalBlockers: Map<string, JsonObject>;
  deliveredOpeningSetupTerminalBlocker: JsonObject | null;
  openingSetupAudits: JsonObject[];
};

const openingSetupState = new WeakMap<object, OpeningSetupMachineStateSurface>();

function stateFor(host: object): OpeningSetupMachineStateSurface {
  let state = openingSetupState.get(host);
  if (state === undefined) {
    state = {
      effectiveTypedRoleValue: null,
      openingSetupStates: new Map(),
      retainedAdoptSourceFacts: new Map(),
      openingSetupAttempts: new Map(),
      openingSetupGenerationSequence: 0,
      openingSetupLatestIssuedGeneration: new Map(),
      openingSetupRetiredGeneration: new Map(),
      setupHandoffDecisionPlayerEpoch: new Map(),
      openingSetupAgentTurn: 0,
      openingSetupTurnCampaignId: null,
      openingSetupTurnCampaignAmbiguous: false,
      openingSetupVisibleOutputAuthorization: null,
      pendingChargenPlayerSummary: null,
      openingSetupContinuationQueued: new Set(),
      openingSetupTerminalBlockers: new Map(),
      deliveredOpeningSetupTerminalBlocker: null,
      openingSetupAudits: [],
    };
    openingSetupState.set(host, state);
  }
  return state;
}

export function installOpeningSetupMachineState(prototype: object): void {
  const readonlyKeys = [
    "openingSetupStates",
    "retainedAdoptSourceFacts",
    "openingSetupAttempts",
    "openingSetupLatestIssuedGeneration",
    "openingSetupRetiredGeneration",
    "setupHandoffDecisionPlayerEpoch",
    "openingSetupContinuationQueued",
    "openingSetupTerminalBlockers",
  ] as const;
  const mutableKeys = [
    "effectiveTypedRoleValue",
    "openingSetupGenerationSequence",
    "openingSetupAgentTurn",
    "openingSetupTurnCampaignId",
    "openingSetupTurnCampaignAmbiguous",
    "openingSetupVisibleOutputAuthorization",
    "pendingChargenPlayerSummary",
    "deliveredOpeningSetupTerminalBlocker",
    "openingSetupAudits",
  ] as const;
  const descriptors: PropertyDescriptorMap = {};
  for (const key of readonlyKeys) {
    descriptors[key] = { get(this: object) { return stateFor(this)[key]; } };
  }
  for (const key of mutableKeys) {
    descriptors[key] = {
      get(this: object) { return stateFor(this)[key]; },
      set(this: object, value: never) { stateFor(this)[key] = value; },
    };
  }
  Object.defineProperties(prototype, descriptors);
}

export function createOpeningSetupMachineMethods(
  _environment: Record<string, any>,
) {
  return {
    setEffectiveTypedRole(_role: "setup" | "play"): void {},
    // `this: any` on the three methods the ownership manifest names is the
    // seam itself: they are installed onto the host prototype and invoked
    // with the host as `this`. A constant-returning shim does not read it,
    // but dropping the parameter erased the declared binding and the
    // architecture check could no longer tell an owned method from a plain
    // helper.
    hasActiveOpeningSetup(this: any): boolean { return false; },
    hasActiveOpeningSetupFor(_campaignId: string): boolean { return false; },
    retainedOpeningRouteFor(_campaignId: string): unknown | null { return null; },
    observeChargenDelegateCompletion(
      _campaignId: string, _value: unknown, _brief?: unknown,
    ): boolean { return false; },
    openingSetupStateForTranscript(): OpeningSetupState | null { return null; },
    takeOpeningSetupAudits(): JsonObject[] { return []; },
    openingSetupAuthorizationMatches(_state: OpeningSetupState): boolean { return false; },
    pendingBindExists(): boolean { return false; },
    characterSetupAllowed(_state: OpeningSetupState): boolean { return false; },
    characterConversationAllowed(_state: OpeningSetupState): boolean { return false; },
    /** Pass the envelope through untouched: there is no guided contract to project. */
    projectGuidedCharacterContract(
      _operation: string, _params: JsonObject, value: unknown,
    ): unknown { return value; },
    reconcileCanonicalOpeningRefresh(
      _params: JsonObject, _value: unknown, _invocationId: string,
    ): boolean { return false; },
    /** No opening gate can block a tool call. */
    openingSetupToolError(
      _name: string, _params: JsonObject, _invocationId?: string,
    ): string | null { return null; },
    observeOpeningSetupInvocation(this: any,
      _operation: string,
      _params: JsonObject,
      _value: unknown,
      _invocationId?: string,
      _canonicalVisibleOutput?: unknown,
    ): { accepted: boolean; dispatchAllowed: boolean; reason: string; modelProjection?: unknown } {
      return { accepted: false, dispatchAllowed: false, reason: "opening_setup_retired" };
    },
    claimOpeningContinuationRelease(
      _state: OpeningSetupState, _owner: "route" | "terminal",
    ): boolean { return false; },
    releaseOpeningSetupContinuation(
      _route: OpeningSetupRoute, _owner: "route" | "terminal",
    ): void {},
    releaseOpeningTerminalContinuation(_dispatchKey: string): void {},
    requiredOpeningSetupContinuation(): OpeningSetupRoute | null { return null; },
    openingTableDecisionContext(): JsonObject | null { return null; },
    clearOpeningSetupRoute(_campaignId?: string | null, _generation?: string): void {},
    markOpeningSetupRouteAttemptFailure(
      _invocationId: string,
      _params: JsonObject,
      _envelope: JsonObject,
      _dispatchKey?: string,
    ): void {},
    openingSetupDispatchOwned(
      _invocationId: string, _params: JsonObject, _dispatchKey: string,
    ): boolean { return false; },
    releaseOpeningSetupDispatchOwnership(
      _invocationId: string, _dispatchKey: string,
    ): void {},
    beginOpeningBackground(
      _invocationId: string,
      _params: JsonObject,
      _dispatchKey: string,
      _projectionParams: JsonObject,
    ): boolean { return false; },
    markOpeningBackgroundSubmitted(
      _invocationId: string, _params: JsonObject, _dispatchKey: string,
    ): { submitted: boolean; reason: string } {
      return { submitted: false, reason: "opening_setup_retired" };
    },
    observeOpeningCoordinatorTerminal(_receipt: JsonObject): void {},
    /** Params pass through: there are no retained facts to bind. */
    bindRetainedAdoptSourceFacts(params: JsonObject): JsonObject { return params; },
    bindRetainedOpeningRoute(params: JsonObject): JsonObject { return params; },
    prepareSetupCompleteArguments(value: unknown): unknown { return value; },
    observeOpeningSourceReviewTransport(_receipt: JsonObject): OpeningSetupRoute | null {
      return null;
    },
    takeDeliveredOpeningSetupTerminalBlocker(): JsonObject | null { return null; },
    /**
     * Real, not inert: this only writes the continuation gate's own dispatch
     * maps, which the live `decideWake` / `onTerminal` path still reads. It
     * lived in the opening module by accident of history -- a background
     * dispatch is a background dispatch whether or not an opening is involved.
     */
    trackOpeningDispatch(this: any, dispatchKey: string): void {
      if (!dispatchKey) return;
      this.states.set(dispatchKey, "awaiting");
      this.dispatchClasses.set(dispatchKey, "blocking_opening");
    },
    adoptNoSelectorQuickStartResultOwnership(
      params: JsonObject, _value: unknown, _invocationId: string,
    ): JsonObject { return params; },
  };
}

export type OpeningSetupMachineMethods = ReturnType<
  typeof createOpeningSetupMachineMethods
>;
