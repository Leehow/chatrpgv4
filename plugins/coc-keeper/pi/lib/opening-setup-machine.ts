/**
 * opening-setup-machine
 *
 * Extracted from the Pi-Coc host facade.  The facade injects the stable host
 * environment once, then installs this cohesive method set on its unchanged
 * public prototype.  Ordinary edits therefore stay in this owned module
 * without reopening the shared extension facade.
 */

type CanonicalSetupVisibleOutput = any;
type ChargenClerkBrief = any;
type GuidedCharacterCreationInputMode = any;
type JsonObject = any;
type OpeningBackgroundSubmissionDisposition = any;
type OpeningGuidedCreateReceipt = any;
type OpeningSetupAttempt = any;
type OpeningSetupObservationDisposition = any;
type OpeningSetupRoute = any;
type OpeningSetupState = any;

export const NO_SELECTOR_SETUP_COMPLETE_DECISION_ID_PATTERN = (
  "^setup-complete:[A-Za-z0-9][A-Za-z0-9._:-]*:"
  + "[A-Za-z0-9][A-Za-z0-9._:-]*:handoff-1$"
);
const NO_SELECTOR_SETUP_COMPLETE_DECISION_ID_RE = new RegExp(
  NO_SELECTOR_SETUP_COMPLETE_DECISION_ID_PATTERN,
);

export function noSelectorSetupCompleteDecisionId(
  campaignId: string,
  investigatorId: string,
): string {
  return `setup-complete:${campaignId}:${investigatorId}:handoff-1`;
}

export type OpeningSetupMachineStateSurface = {
  effectiveTypedRoleValue: "setup" | "play" | null;
  readonly openingSetupStates: Map<string, OpeningSetupState>;
  readonly retainedAdoptSourceFacts: Map<string, JsonObject>;
  readonly openingSetupAttempts: Map<string, OpeningSetupAttempt>;
  openingSetupGenerationSequence: number;
  readonly openingSetupLatestIssuedGeneration: Map<string, number>;
  readonly openingSetupRetiredGeneration: Map<string, number>;
  readonly setupHandoffDecisionPlayerEpoch: Map<
    string,
    { generation: string; playerTurnEpoch: number }
  >;
  openingSetupAgentTurn: number;
  openingSetupTurnCampaignId: string | null;
  openingSetupTurnCampaignAmbiguous: boolean;
  openingSetupVisibleOutputAuthorization: any | null;
  pendingChargenPlayerSummary: { campaignId: string; text: string } | null;
  readonly openingSetupContinuationQueued: Set<string>;
  readonly openingSetupTerminalBlockers: Map<string, any>;
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
  const readonly = [
    "openingSetupStates",
    "retainedAdoptSourceFacts",
    "openingSetupAttempts",
    "openingSetupLatestIssuedGeneration",
    "openingSetupRetiredGeneration",
    "setupHandoffDecisionPlayerEpoch",
    "openingSetupContinuationQueued",
    "openingSetupTerminalBlockers",
  ] as const;
  const mutable = [
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
  for (const key of readonly) {
    descriptors[key] = {
      get(this: object) { return stateFor(this)[key]; },
    };
  }
  for (const key of mutable) {
    descriptors[key] = {
      get(this: object) { return stateFor(this)[key]; },
      set(this: object, value: OpeningSetupMachineStateSurface[typeof key]) {
        stateFor(this)[key] = value as never;
      },
    };
  }
  Object.defineProperties(prototype, descriptors);
}

export function createOpeningSetupMachineMethods(
  environment: Record<string, any>,
) {
  const {
    EXISTING_CAMPAIGN_SETUP_KINDS,
    MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN,
    OPENING_SETUP_CHARACTER_KINDS,
    OPENING_START_LOCATION_ID,
    OWNED_OPENING_ROUTE_OPERATIONS,
    ZH_HANS_PLAYER_TERMS,
    applyRetainedAdoptSourceFacts,
    canonicalJsonValueSha256,
    exactKeysMatch,
    failedBlockingOpeningEnvelope,
    findAutoDispatchTask,
    handoffFromEnvelope,
    hasRequiredKeys,
    isAbsolute,
    isCanonicalCampaignId,
    isCanonicalInvokeSurface,
    join,
    normalizePiCocInvokeArguments,
    objectOrNull,
    openingHandoffOperationForSessionRole,
    projectPiGuidedCharacterContract,
    resolve,
    result,
    sessionRoleFromEnv,
    typedToolNameForOperation,
    validOpeningTransportFacts,
    zhHansChargenRoleplaySummary,
    zhHansChargenSkillLabel,
  } = environment;
  return {

  setEffectiveTypedRole(this: any, role: "setup" | "play"): void {
    if (role !== "setup" && role !== "play") {
      throw new Error("effective typed role must be setup or play");
    }
    this.effectiveTypedRoleValue = role;
  },


  effectiveTypedRole(this: any): "setup" | "play" {
    return this.effectiveTypedRoleValue
      ?? sessionRoleFromEnv()
      ?? "setup";
  },

  hasActiveOpeningSetup(this: any): boolean {
    return this.openingSetupStates.size > 0 || this.pendingBindExists();
  },


  hasActiveOpeningSetupFor(this: any, campaignId: string): boolean {
    const id = campaignId.trim();
    if (!id) return this.hasActiveOpeningSetup();
    return this.openingSetupStates.has(id) || this.pendingBindExistsForCampaign(id);
  },


  // setup.chargen_run commits create + link atomically. Its successful result
  // is therefore a canonical completion receipt even though the delegate
  // reaches MCP without passing through observeOpeningSetupInvocation.
  observeChargenDelegateCompletion(this: any,
    campaignId: string,
    value: unknown,
    brief?: ChargenClerkBrief,
  ): boolean {
    const result = objectOrNull(value);
    if (
      result?.ok !== true
      || typeof result.investigator_id !== "string"
      || !result.investigator_id.trim()
    ) return false;

    let state = this.openingSetupStates.get(campaignId);
    if (state === undefined) {
      // The aggregate chargen receipt proves character persistence only. It
      // cannot prove whether a missing volatile opening route was a non-source
      // starter or a source-bound campaign, so never synthesize a handoff path.
      return false;
    }

    state.characterSetupComplete = true;
    const characteristics = objectOrNull(result.characteristics) ?? {};
    const derived = objectOrNull(result.derived) ?? {};
    const skillTop = Array.isArray(result.skill_top)
      ? result.skill_top
        .map((entry) => objectOrNull(entry))
        .filter((entry): entry is JsonObject => entry !== null)
        .filter((entry) => typeof entry.name === "string" && Number.isInteger(entry.value))
        .slice(0, 8)
        .map((entry) => `${zhHansChargenSkillLabel(entry.name as string)} ${entry.value}`)
      : [];
    const characteristicText = ["STR", "DEX", "CON", "POW", "APP", "EDU", "SIZ", "INT"]
      .filter((key) => Number.isInteger(characteristics[key]))
      .map((key) => `${ZH_HANS_PLAYER_TERMS[key] ?? key} ${characteristics[key]}`)
      .join("；");
    const derivedText = [
      ["生命值", derived.hp],
      ["魔法值", derived.mp],
      [ZH_HANS_PLAYER_TERMS.SAN ?? "理智", derived.san],
      [ZH_HANS_PLAYER_TERMS.LUCK ?? "幸运", derived.luck],
    ]
      .filter((entry) => Number.isInteger(entry[1]))
      .map((entry) => `${entry[0]} ${entry[1]}`)
      .join("；");
    if (brief !== undefined) {
      const roleplaySummary = zhHansChargenRoleplaySummary(brief);
      this.pendingChargenPlayerSummary = {
        campaignId,
        text: [
          `角色卡已生成：${brief.name}（${brief.age ?? "年龄未指定"}岁，${brief.occupation_label ?? brief.occupation_or_concept}）。`,
          characteristicText ? `特征：${characteristicText}。` : "",
          derivedText ? `派生数值：${derivedText}。` : "",
          skillTop.length ? `主要技能：${skillTop.join("；")}。` : "",
          ...roleplaySummary,
          "你想调整角色卡，还是确认打开游戏桌？",
        ].filter(Boolean).join("\n\n"),
      };
    }
    if (state.phase === "reviewed") {
      this.armOpeningSelectionRoute(state);
    } else if (state.phase === "ready") {
      if (this.effectiveTypedRole() === "setup") {
        this.armSetupHandoffDecisionRoute(
          state,
          result.investigator_id.trim(),
        );
      } else {
        this.armOpeningEvidenceRoute(state);
      }
    } else if (
      state.phase === "projection"
      && state.backgroundTerminalReceipt?.status === "fulfilled"
    ) {
      this.armOpeningProjectionRoute(state);
    }
    this.recordOpeningSetupAudit({
      status: "transitioned",
      transition: "chargen_delegate_character_setup_complete",
      campaign_id: campaignId,
      investigator_id: result.investigator_id,
      generation: state.generation,
      revision: state.revision,
    });
    return true;
  },


  setupHandoffDecisionId(this: any,
    campaignId: string,
    investigatorId: string,
  ): string {
    const digest = canonicalJsonValueSha256({
      contract_id: "coc.pi-setup-handoff-decision.v1",
      campaign_id: campaignId,
      investigator_id: investigatorId,
    }).slice("sha256:".length, "sha256:".length + 32);
    return `pi-setup-handoff-${digest}`;
  },


  setupHandoffDecisionRoute(this: any,
    campaignId: string,
    investigatorId: string,
  ): OpeningSetupRoute {
    const noSelectorSession = sessionRoleFromEnv() === null;
    const decisionId = noSelectorSession
      ? noSelectorSetupCompleteDecisionId(campaignId, investigatorId)
      : this.setupHandoffDecisionId(campaignId, investigatorId);
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_setup_handoff_decision",
      campaign_id: campaignId,
      next_operation: {
        schema_version: 1,
        operation: "setup.complete",
        invoke_via: "coc_invoke",
        prefilled_arguments: {
          campaign_id: campaignId,
          decision_id: decisionId,
        },
        missing_arguments: [],
        hard_gate: true,
        authority: "canonical_setup",
        reason: (
          "The confirmed investigator is ready; handoff still requires the "
          + "player's separate semantic confirmation."
        ),
      },
      instruction: (
        "on the next player message, judge semantically whether they confirm "
        + "opening the table or request a setup revision"
      ),
    };
  },


  armSetupHandoffDecisionRoute(this: any,
    state: OpeningSetupState,
    investigatorId: string,
  ): void {
    const campaignId = state.route.campaign_id;
    state.phase = "handoff_decision";
    state.route = this.setupHandoffDecisionRoute(
      campaignId,
      investigatorId,
    );
    state.revision += 1;
    state.continuationReleaseOwner = null;
    this.setupHandoffDecisionPlayerEpoch.set(campaignId, {
      generation: state.generation,
      playerTurnEpoch: this.playerTurnEpoch,
    });
    this.openingSetupContinuationQueued.delete(campaignId);
  },


  openingSetupStateForTranscript(this: any): OpeningSetupState | null {
    if (this.openingSetupTurnCampaignAmbiguous) return null;
    if (this.openingSetupTurnCampaignId !== null) {
      return this.openingSetupStates.get(this.openingSetupTurnCampaignId)
        ?? null;
    }
    if (this.openingSetupStates.size !== 1) return null;
    return this.openingSetupStates.values().next().value ?? null;
  },


  recordOpeningSetupAudit(this: any, entry: JsonObject): void {
    this.openingSetupAudits.push({
      schema_version: 1,
      ...entry,
    });
  },


  takeOpeningSetupAudits(this: any): JsonObject[] {
    const audits = this.openingSetupAudits;
    this.openingSetupAudits = [];
    return audits;
  },


  openingSetupAuthorizationMatches(this: any,
    state: OpeningSetupState,
  ): boolean {
    const authorization = this.openingSetupVisibleOutputAuthorization;
    return (
      authorization !== null
      && !this.openingSetupTurnCampaignAmbiguous
      && this.openingSetupTurnCampaignId === authorization.campaignId
      && authorization.campaignId === state.route.campaign_id
      && authorization.generation === state.generation
      && authorization.revision === state.revision
      && authorization.agentTurn === this.openingSetupAgentTurn
    );
  },


  authorizeOpeningSetupVisibleOutput(this: any,
    state: OpeningSetupState,
    attempt: OpeningSetupAttempt,
    replacementText: string,
    source: string,
  ): void {
    if (
      !replacementText
      || attempt.agentTurn !== this.openingSetupAgentTurn
      || this.openingSetupTurnCampaignAmbiguous
      || this.openingSetupTurnCampaignId !== attempt.campaignId
    ) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "late_ambiguous_or_empty_setup_output",
        campaign_id: attempt.campaignId,
        invocation_id: attempt.invocationId,
        source,
      });
      return;
    }
    this.openingSetupVisibleOutputAuthorization = {
      campaignId: attempt.campaignId,
      generation: state.generation,
      revision: state.revision,
      agentTurn: attempt.agentTurn,
      invocationId: attempt.invocationId,
      replacementText,
      replacementTextSha256: canonicalJsonValueSha256(replacementText),
      source,
    };
  },


  authorizeOpeningSetupConversationalOutput(this: any,
    state: OpeningSetupState,
    attempt: OpeningSetupAttempt,
    source: string,
  ): void {
    if (
      attempt.agentTurn !== this.openingSetupAgentTurn
      || this.openingSetupTurnCampaignAmbiguous
      || this.openingSetupTurnCampaignId !== attempt.campaignId
    ) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "late_or_ambiguous_conversational_setup_output",
        campaign_id: attempt.campaignId,
        invocation_id: attempt.invocationId,
        source,
      });
      return;
    }
    this.openingSetupVisibleOutputAuthorization = {
      campaignId: attempt.campaignId,
      generation: state.generation,
      revision: state.revision,
      agentTurn: attempt.agentTurn,
      invocationId: attempt.invocationId,
      replacementText: null,
      replacementTextSha256: null,
      source,
    };
  },


  pendingBindExists(this: any): boolean {
    return [...this.openingSetupAttempts.values()].some(
      (attempt) => attempt.attemptClass === "bind",
    );
  },


  pendingBindExistsForCampaign(this: any, campaignId: string): boolean {
    return [...this.openingSetupAttempts.values()].some((attempt) => (
      attempt.attemptClass === "bind"
      && attempt.campaignId === campaignId
    ));
  },


  pruneOpeningSetupCampaign(this: any, campaignId: string): void {
    if (this.openingSetupStates.has(campaignId)) return;
    if ([...this.openingSetupAttempts.values()].some(
      (attempt) => attempt.campaignId === campaignId,
    )) {
      return;
    }
    this.openingSetupLatestIssuedGeneration.delete(campaignId);
    this.openingSetupRetiredGeneration.delete(campaignId);
    this.openingSetupContinuationQueued.delete(campaignId);
    this.openingSetupTerminalBlockers.delete(campaignId);
  },


  finalizeOpeningSetupAttempt(this: any,
    invocationId: string,
    releaseContinuation = true,
  ): OpeningSetupAttempt | null {
    const attempt = this.openingSetupAttempts.get(invocationId) ?? null;
    if (attempt === null) return null;
    this.openingSetupAttempts.delete(invocationId);
    if (releaseContinuation && attempt.attemptClass === "route") {
      this.openingSetupContinuationQueued.delete(attempt.campaignId);
    }
    this.pruneOpeningSetupCampaign(attempt.campaignId);
    return attempt;
  },


  supersedeOpeningSetupRevisionAttempts(this: any,
    state: OpeningSetupState,
    exceptInvocationId: string,
  ): void {
    for (const attempt of [...this.openingSetupAttempts.values()]) {
      if (
        attempt.invocationId !== exceptInvocationId
        && attempt.campaignId === state.route.campaign_id
        && attempt.generation === state.generation
        && attempt.revision === state.revision
      ) {
        this.finalizeOpeningSetupAttempt(attempt.invocationId);
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "superseded_attempt_revision",
          campaign_id: attempt.campaignId,
          invocation_id: attempt.invocationId,
          generation: attempt.generation,
          revision: attempt.revision,
        });
      }
    }
  },


  quickFireLuckInvocation(this: any, params: JsonObject): boolean {
    const args = objectOrNull(params.arguments);
    return (
      args !== null
      && Object.keys(args).every((key) => (
        ["expression", "decision_id", "purpose", "reason"].includes(key)
      ))
      && ["expression", "decision_id", "purpose"].every((key) => (
        Object.keys(args).includes(key)
      ))
      && args.expression === "3D6"
      && args.purpose === "investigator_creation_luck"
      && (
        args.reason === undefined
        || args.reason === null
        || typeof args.reason === "string"
      )
      && typeof args.decision_id === "string"
      && args.decision_id.trim().length > 0
    );
  },


  adaptiveCharacteristicRollInvocation(this: any, params: JsonObject): boolean {
    const args = objectOrNull(params.arguments);
    return (
      args !== null
      && Object.keys(args).every((key) => (
        ["expression", "decision_id", "reason"].includes(key)
      ))
      && ["expression", "decision_id"].every((key) => (
        Object.keys(args).includes(key)
      ))
      && (args.expression === "3D6" || args.expression === "2D6+6")
      && (args.reason === undefined || args.reason === null || typeof args.reason === "string")
      && typeof args.decision_id === "string"
      && args.decision_id.trim().length > 0
    );
  },


  adaptiveCashSemanticMode(this: any, state: OpeningSetupState): boolean {
    return (
      state.characterSetupInputMode === "kp_guided_era_adaptive"
      || state.route.character_setup_input_mode === "kp_guided_era_adaptive"
      || state.route.character_setup_policy === "kp_guided_era_adaptive_no_source"
    );
  },


  characterSetupAllowedActions(this: any,
    campaignId: string,
    includeSourceBriefing = true,
    inputMode: GuidedCharacterCreationInputMode | null = null,
  ): JsonObject[] {
    const actions: JsonObject[] = [
      {
        operation: "setup.adopt_source_facts",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        arguments_contract: "use the fully typed discovered operation schema",
        lifecycle_effect: "source facts only; not investigator completion",
      },
      {
        operation: "setup.investigator_contract",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        arguments: { campaign_id: campaignId },
      },
      {
        operation: "rules.roll_dice",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        exact_recipe: {
          expression: "3D6",
          purpose: "investigator_creation_luck",
          required: ["decision_id"],
          optional: ["reason"],
        },
      },
      {
        operation: "rules.cash_assets",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        required: ["credit_rating"],
        optional: ["period"],
        period_policy: (
          "omit to use the canonical campaign era; any explicit period must "
          + "equal setup.investigator_contract.result.campaign_binding.era"
        ),
      },
      {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "investigator.create",
        contract_source: "setup.investigator_contract.result.payload_schema",
        required_creation_input_mode: (inputMode ?? "guided_quick_fire"),
      },
      {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "campaign.link_investigator",
        required_payload_fields: ["campaign_id", "investigator_ids"],
        requires_current_opening_receipt: (
          `investigator.create:${inputMode ?? "guided_quick_fire"}`
        ),
      },
      {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "investigator.render_card",
        required_payload_fields: ["campaign_id", "investigator_id"],
        optional_payload_fields: ["language", "html_mode"],
      },
    ];
    if (inputMode === "kp_guided_era_adaptive") {
      actions.splice(3, 0, {
        operation: "rules.roll_dice",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        exact_recipe: {
          expression: ["3D6", "2D6+6"],
          purpose: "omit for characteristic receipts; use the typed Luck action separately",
          required: ["decision_id"],
          optional: ["reason"],
        },
      }, {
        operation: "state.cash_semantic",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        required: ["record_id", "basis", "reason", "decision_id"],
        optional: ["investigator_id", "cash_description", "assets"],
        provenance: { kp_guided: true, cash_semantic: true },
        when: "rules.cash_assets reports no authoritative campaign-era table",
      });
    }
    if (includeSourceBriefing) {
      actions.splice(1, 0, {
        operation: "setup.invoke",
        invoke_via: "coc_invoke",
        campaign: campaignId,
        kind: "campaign.render_briefing",
        payload: { campaign_id: campaignId },
      });
    }
    return actions;
  },


  // Single source of truth for investigator.create admission. The gate returns
  // these same tokens verbatim on rejection, so a refused KP is told which
  // field failed instead of being handed the route again. Field names and
  // schema-declared literals only — never payload values or source text.
  investigatorCreatePayloadFailures(this: any,
    payload: JsonObject,
    route: OpeningSetupRoute,
    inputMode: GuidedCharacterCreationInputMode | null,
  ): string[] {
    const failures: string[] = [];
    const required = ["campaign_id", "investigator_id", "sheet", "creation"];
    for (const key of Object.keys(payload)) {
      if (!required.includes(key)) {
        failures.push(`payload.${key} is not an accepted field`);
      }
    }
    for (const key of required) {
      if (!Object.keys(payload).includes(key)) {
        failures.push(`payload.${key} is required`);
      }
    }
    if (payload.campaign_id !== route.campaign_id) {
      failures.push("payload.campaign_id must equal the current campaign id");
    }
    if (typeof payload.investigator_id !== "string") {
      failures.push("payload.investigator_id must be a string");
    }
    const creation = objectOrNull(payload.creation);
    const sheet = objectOrNull(payload.sheet);
    if (creation === null) failures.push("payload.creation must be an object");
    if (sheet === null) failures.push("payload.sheet must be an object");

    const luckReceipt = objectOrNull(creation?.luck_roll_receipt);
    if (luckReceipt === null) {
      failures.push(
        "creation.luck_roll_receipt must be an object with exactly "
        + "campaign_id, decision_id, and roll_id, quoting the roll_id returned "
        + "by the canonical rules.roll_dice Quick-Fire Luck receipt",
      );
    } else {
      if (!exactKeysMatch(luckReceipt, ["campaign_id", "decision_id", "roll_id"])) {
        failures.push(
          "creation.luck_roll_receipt must carry exactly campaign_id, "
          + "decision_id, and roll_id",
        );
      }
      if (luckReceipt.campaign_id !== route.campaign_id) {
        failures.push(
          "creation.luck_roll_receipt.campaign_id must equal the current "
          + "campaign id",
        );
      }
      if (
        typeof luckReceipt.decision_id !== "string"
        || luckReceipt.decision_id.trim().length === 0
      ) {
        failures.push(
          "creation.luck_roll_receipt.decision_id must be the non-empty "
          + "decision_id sent with the Quick-Fire Luck rules.roll_dice call",
        );
      }
      if (
        typeof luckReceipt.roll_id !== "string"
        || luckReceipt.roll_id.trim().length === 0
      ) {
        failures.push(
          "creation.luck_roll_receipt.roll_id must be the non-empty roll_id "
          + "field returned in that rules.roll_dice result",
        );
      }
    }
    if (!Number.isInteger(creation?.luck_roll_total)) {
      failures.push(
        "creation.luck_roll_total must be the integer total of that same roll",
      );
    }

    if (inputMode === "kp_guided_era_adaptive") {
      if (creation?.input_mode !== "kp_guided_era_adaptive") {
        failures.push('creation.input_mode must be "kp_guided_era_adaptive"');
      }
      if (creation?.era_adaptive !== true) {
        failures.push("creation.era_adaptive must be true");
      }
      if (creation?.kp_guided !== true) {
        failures.push("creation.kp_guided must be true");
      }
      if (typeof creation?.era !== "string") {
        failures.push("creation.era must be a string");
      }
      if (typeof creation?.method !== "string") {
        failures.push("creation.method must be a string");
      }
      if (sheet?.era_adaptive !== true) {
        failures.push("sheet.era_adaptive must be true");
      }
      if (sheet?.kp_guided !== true) {
        failures.push("sheet.kp_guided must be true");
      }
      if (sheet?.era !== creation?.era) {
        failures.push("sheet.era must equal creation.era");
      }
      if (objectOrNull(sheet?.occupation) === null) {
        failures.push("sheet.occupation must be an object");
      }
      if (objectOrNull(sheet?.skill_provenance) === null) {
        failures.push("sheet.skill_provenance must be an object");
      }
      return failures;
    }

    if (creation?.input_mode !== "guided_quick_fire") {
      failures.push('creation.input_mode must be "guided_quick_fire"');
    }
    if (creation?.method !== "quick_fire_array") {
      failures.push('creation.method must be "quick_fire_array"');
    }
    if (
      !Array.isArray(creation?.characteristic_assignment_order)
      || creation.characteristic_assignment_order.length !== 8
    ) {
      failures.push(
        "creation.characteristic_assignment_order must be an array of exactly "
        + "8 characteristic names",
      );
    }
    return failures;
  },


  // Rejection text for a create attempt the gate refused. Returns null when the
  // attempt is not an investigator.create the caller should explain, so the
  // caller falls back to the retained route.
  openingInvestigatorCreateRejection(this: any,
    params: JsonObject,
    state: OpeningSetupState,
  ): string | null {
    if (state.characterSetupComplete) return null;
    if (!this.characterSetupAllowed(state)) return null;
    if (String(params.operation ?? "") !== "setup.invoke") return null;
    const args = objectOrNull(params.arguments);
    if (args === null || args.kind !== "investigator.create") return null;
    const route = state.route;
    const inputMode = state.characterSetupInputMode;
    const failures: string[] = [];
    if (params.campaign !== route.campaign_id) {
      failures.push("campaign must equal the current opening campaign id");
    }
    for (const key of Object.keys(args)) {
      if (key !== "kind" && key !== "payload") {
        failures.push(`arguments.${key} is not an accepted field`);
      }
    }
    const payload = objectOrNull(args.payload);
    if (payload === null) {
      failures.push("arguments.payload must be an object");
    } else {
      failures.push(
        ...this.investigatorCreatePayloadFailures(payload, route, inputMode),
      );
    }
    if (failures.length === 0) return null;
    // Failing fields first, retained route after: the KP needs the reason to
    // converge, and every gate rejection must still leave it holding the route.
    return (
      "setup.invoke investigator.create was refused because its payload does "
      + `not satisfy the ${inputMode ?? "guided_quick_fire"} branch the `
      + "contract selected for this campaign. Correct exactly these fields and "
      + `retry the same call: ${failures.join("; ")}. The complete accepted `
      + "shape is setup.investigator_contract.result.payload_schema, which the "
      + "current projection already returns whole for this branch; there is no "
      + "fuller schema to request. Retained route: "
      + JSON.stringify(route)
    );
  },


  canonicalSetupInvokeForOpening(this: any,
    params: JsonObject,
    route: OpeningSetupRoute,
    inputMode: GuidedCharacterCreationInputMode | null = null,
  ): boolean {
    const args = objectOrNull(params.arguments);
    if (
      params.operation !== "setup.invoke"
      || params.campaign !== route.campaign_id
      || args === null
      || !exactKeysMatch(args, ["kind", "payload"])
      || typeof args.kind !== "string"
      || !OPENING_SETUP_CHARACTER_KINDS.has(args.kind)
    ) {
      return false;
    }
    const payload = objectOrNull(args.payload);
    if (payload === null) return false;
    if (args.kind === "investigator.create") {
      return this.investigatorCreatePayloadFailures(
        payload, route, inputMode,
      ).length === 0;
    }
    if (args.kind === "campaign.link_investigator") {
      const investigatorIds = payload.investigator_ids;
      return exactKeysMatch(
        payload,
        ["campaign_id", "investigator_ids"],
      )
        && payload.campaign_id === route.campaign_id
        && Array.isArray(investigatorIds)
        && investigatorIds.length > 0
        && investigatorIds.every((value) => (
          typeof value === "string" && value.trim().length > 0
        ))
        && new Set(investigatorIds).size === investigatorIds.length;
    }
    if (args.kind === "campaign.render_briefing") {
      const keys = Object.keys(payload);
      return (
        keys.every((key) => ["campaign_id", "language"].includes(key))
        && keys.includes("campaign_id")
        && payload.campaign_id === route.campaign_id
        && (
          payload.language === undefined
          || typeof payload.language === "string"
        )
      );
    }
    const keys = Object.keys(payload);
    return (
      keys.every((key) => (
        ["campaign_id", "investigator_id", "language", "html_mode"].includes(
          key,
        )
      ))
      && ["campaign_id", "investigator_id"].every((key) => keys.includes(key))
      && payload.campaign_id === route.campaign_id
      && typeof payload.investigator_id === "string"
    );
  },


  linkMatchesCurrentGuidedCreates(this: any,
    params: JsonObject,
    state: OpeningSetupState,
  ): boolean {
    const args = objectOrNull(params.arguments);
    const payload = objectOrNull(args?.payload);
    const investigatorIds = payload?.investigator_ids;
    return (
      args?.kind === "campaign.link_investigator"
      && payload?.campaign_id === state.route.campaign_id
      && Array.isArray(investigatorIds)
      && investigatorIds.length > 0
      && investigatorIds.every((value) => {
        if (typeof value !== "string") return false;
        const receipt = state.guidedCreateReceipts.get(value);
        return (
          receipt !== undefined
          && receipt.campaignId === state.route.campaign_id
          && receipt.investigatorId === value
          && receipt.generation === state.generation
          && receipt.revision === state.revision
          && receipt.invocationId.length > 0
          && receipt.receiptSha256.startsWith("sha256:")
        );
      })
    );
  },


  characterSetupAllowed(this: any, state: OpeningSetupState): boolean {
    return (
      state.route.startup_resume_policy !== "source_materialization_wait_only"
      && [
        "submitting",
        "materializing",
        "source_review",
        "reviewed",
        "retry",
        "projection",
        "ready",
      ].includes(state.phase)
    );
  },


  characterConversationAllowed(this: any, state: OpeningSetupState): boolean {
    // Character mechanics may overlap private source work, but the player's
    // guided conversation must wait until source facts establish the era.
    // Otherwise a generic model example can become the first visible setup
    // prompt before the authored period is known.
    return ["reviewed", "projection", "ready"].includes(state.phase);
  },


  openingSetupCharacterInvocation(this: any,
    params: JsonObject,
    state: OpeningSetupState,
  ): boolean {
    if (!this.characterSetupAllowed(state)) return false;
    const route = state.route;
    const operation = String(params.operation ?? "");
    if (params.campaign !== route.campaign_id) return false;
    if (state.characterSetupComplete) {
      const args = objectOrNull(params.arguments);
      return (
        operation === "setup.invoke"
        && args?.kind === "investigator.render_card"
        && this.canonicalSetupInvokeForOpening(
          params, route, state.characterSetupInputMode,
        )
      );
    }
    const setupArgs = objectOrNull(params.arguments);
    if (
      [
        "guided_quick_fire_no_source",
        "kp_guided_era_adaptive_no_source",
      ].includes(state.route.character_setup_policy ?? "")
      && operation === "setup.invoke"
      && setupArgs?.kind === "campaign.render_briefing"
    ) {
      return false;
    }
    if (
      operation === "setup.invoke"
      && setupArgs?.kind === "campaign.link_investigator"
    ) {
      return (
        this.canonicalSetupInvokeForOpening(
          params, route, state.characterSetupInputMode,
        )
        && this.linkMatchesCurrentGuidedCreates(params, state)
      );
    }
    if (operation === "setup.investigator_contract") {
      const args = objectOrNull(params.arguments);
      return args !== null
        && exactKeysMatch(args, ["campaign_id"])
        && args.campaign_id === route.campaign_id;
    }
    if (operation === "setup.adopt_source_facts") {
      const args = objectOrNull(params.arguments);
      return (
        args !== null
        && exactKeysMatch(args, ["campaign_id", "facts"])
        && args.campaign_id === route.campaign_id
        && objectOrNull(args.facts) !== null
      );
    }
    if (operation === "rules.cash_assets") {
      const args = objectOrNull(params.arguments);
      return (
        args !== null
        && Object.keys(args).every((key) => (
          ["credit_rating", "period"].includes(key)
        ))
        && Object.keys(args).includes("credit_rating")
        && Number.isInteger(args.credit_rating)
        && (
          args.period === undefined
          || typeof args.period === "string"
        )
      );
    }
    if (operation === "state.cash_semantic") {
      // Last era-adaptive consumer: admit whenever the adaptive route owns
      // character setup. Do not hard-gate on toolbox-owned shapes.
      return this.adaptiveCashSemanticMode(state);
    }
    return this.canonicalSetupInvokeForOpening(
      params, route, state.characterSetupInputMode,
    ) || (
      operation === "rules.roll_dice"
      && (
        this.quickFireLuckInvocation(params)
        || (
          state.characterSetupInputMode === "kp_guided_era_adaptive"
          && this.adaptiveCharacteristicRollInvocation(params)
        )
      )
    );
  },


  exactCanonicalLinkReceipt(this: any,
    params: JsonObject,
    envelope: JsonObject | null,
  ): boolean {
    const args = objectOrNull(params.arguments);
    const payload = objectOrNull(args?.payload);
    const data = objectOrNull(envelope?.data);
    const result = objectOrNull(data?.result);
    const requestedIds = payload?.investigator_ids;
    const linkedIds = result?.investigator_ids;
    return (
      envelope?.ok === true
      && params.operation === "setup.invoke"
      && args?.kind === "campaign.link_investigator"
      && data?.schema_version === 1
      && data.status === "PASS"
      && data.kind === "campaign.link_investigator"
      && result !== null
      && exactKeysMatch(result, ["campaign_id", "investigator_ids"])
      && result.campaign_id === params.campaign
      && result.campaign_id === payload?.campaign_id
      && Array.isArray(requestedIds)
      && Array.isArray(linkedIds)
      && linkedIds.length === requestedIds.length
      && linkedIds.every((value, index) => value === requestedIds[index])
    );
  },


  exactCanonicalCharacterSetupReceipt(this: any,
    operation: string,
    params: JsonObject,
    envelope: JsonObject | null,
    canonicalVisibleOutput: CanonicalSetupVisibleOutput | null,
  ): boolean {
    if (envelope?.ok !== true || envelope.tool !== operation) return false;
    const data = objectOrNull(envelope.data);
    const args = objectOrNull(params.arguments);
    if (data === null || args === null) return false;
    if (operation === "setup.investigator_contract") {
      const result = objectOrNull(data.result);
      return (
        data.schema_version === 1
        && data.status === "PASS"
        && data.kind === "investigator.contract"
        && result !== null
        && typeof result.ruleset_id === "string"
        && objectOrNull(result.payload_schema) !== null
      );
    }
    if (operation === "setup.adopt_source_facts") {
      const result = objectOrNull(data.result);
      const facts = objectOrNull(result?.facts);
      const unresolved = result?.unresolved_blocking_facts;
      const unblocked = result?.character_creation_unblocked;
      const moduleInitReady = result?.module_init_ready;
      const expectedBlocking = ["era", "place"].filter((name) => (
        objectOrNull(facts?.[name])?.status !== "source"
      ));
      return (
        data.schema_version === 1
        && data.status === "PASS"
        && data.kind === "campaign.adopt_source_facts"
        && result !== null
        && result.campaign_id === params.campaign
        && facts !== null
        && typeof unblocked === "boolean"
        && Array.isArray(unresolved)
        && unresolved.length === new Set(unresolved).size
        && unresolved.every((name) => (
          name === "era" || name === "place"
        ))
        && unresolved.length === expectedBlocking.length
        && unresolved.every((name, index) => name === expectedBlocking[index])
        && (
          moduleInitReady === undefined
            ? unblocked === (unresolved.length === 0)
            : typeof moduleInitReady === "boolean"
              && unblocked === (
                unresolved.length === 0 && moduleInitReady
              )
        )
      );
    }
    if (operation === "rules.roll_dice") {
      const rolls = data.rolls;
      return (
        args.expression === "3D6"
        && data.expression === args.expression
        && Array.isArray(rolls)
        && rolls.length === 3
        && rolls.every((roll) => (
          Number.isInteger(roll) && Number(roll) >= 1 && Number(roll) <= 6
        ))
        && Number.isInteger(data.total)
        && data.total === rolls.reduce(
          (sum, roll) => sum + Number(roll),
          0,
        )
        && typeof data.roll_id === "string"
        && data.roll_id.trim().length > 0
      );
    }
    if (operation !== "setup.invoke") return false;
    const kind = args.kind;
    const payload = objectOrNull(args.payload);
    const result = objectOrNull(data.result);
    if (
      typeof kind !== "string"
      || payload === null
      || data.schema_version !== 1
      || data.status !== "PASS"
      || data.kind !== kind
      || result === null
    ) {
      return false;
    }
    if (kind === "campaign.link_investigator") {
      return this.exactCanonicalLinkReceipt(params, envelope);
    }
    if (kind === "campaign.render_briefing") {
      return (
        canonicalVisibleOutput !== null
        && canonicalVisibleOutput.campaignId === params.campaign
        && canonicalVisibleOutput.sourceKind === kind
        && result.campaign_id === params.campaign
        && canonicalVisibleOutput.textSha256
          === canonicalJsonValueSha256(canonicalVisibleOutput.text)
      );
    }
    if (kind === "investigator.create") {
      return (
        typeof payload.investigator_id === "string"
        && result.investigator_id === payload.investigator_id
        && exactKeysMatch(result, ["investigator_id"])
      );
    }
    if (kind === "investigator.render_card") {
      return (
        result.campaign_id === params.campaign
        && result.investigator_id === payload.investigator_id
        && typeof result.markdown_path === "string"
      );
    }
    return false;
  },


  canonicalCharacterSetupVisibleText(this: any,
    operation: string,
    params: JsonObject,
    envelope: JsonObject | null,
    canonicalVisibleOutput: CanonicalSetupVisibleOutput | null,
  ): string | null {
    if (
      !this.exactCanonicalCharacterSetupReceipt(
        operation,
        params,
        envelope,
        canonicalVisibleOutput,
      )
    ) {
      return null;
    }
    if (canonicalVisibleOutput !== null) {
      return canonicalVisibleOutput.text;
    }
    if (operation === "setup.investigator_contract") {
      return "请选择调查员的特征值生成方式，并继续确认职业与技能。";
    }
    if (operation === "setup.adopt_source_facts") {
      const result = objectOrNull(objectOrNull(envelope?.data)?.result);
      if (result?.character_creation_unblocked === true) {
        // Adoption is a private setup transition, not a player-facing table
        // beat. Authorize an exact empty replacement so the continuation can
        // call investigator_contract and only its guided question becomes
        // visible.
        return "";
      }
      if (result?.module_init_ready === false) {
        return "来源事实已记录，但建卡最小包 L0 尚未就绪；不要猜测预设卡、年代修正、开场钩子或手册。";
      }
      const unresolved = Array.isArray(result?.unresolved_blocking_facts)
        ? result.unresolved_blocking_facts
        : [];
      const labels = unresolved.map((name) => (
        name === "era" ? "年代（era）" : "地点（place）"
      ));
      return (
        `来源事实已记录，但 ${labels.join("、")} 仍未解决；`
        + "继续检查当前已绑定来源，暂不要调用调查员构建契约。"
      );
    }
    if (operation === "rules.roll_dice") {
      const data = objectOrNull(envelope?.data);
      const total = Number(data?.total);
      return `幸运骰结果为 ${total}，幸运值为 ${total * 5}。`;
    }
    const args = objectOrNull(params.arguments);
    if (args?.kind === "campaign.link_investigator") {
      return "调查员已正式加入战役。";
    }
    if (args?.kind === "investigator.create") {
      return "调查员资料已创建；请确认后加入战役。";
    }
    if (args?.kind === "investigator.render_card") {
      return "调查员角色卡已生成。";
    }
    return null;
  },


  exactOpeningSetupRouteInvocation(this: any,
    route: OpeningSetupRoute,
    params: JsonObject,
  ): boolean {
    const card = route.next_operation;
    if (
      card === null
      || card.operation !== params.operation
      || params.campaign !== route.campaign_id
    ) {
      return false;
    }
    const args = objectOrNull(params.arguments);
    const prefilled = objectOrNull(card.prefilled_arguments);
    const missing = Array.isArray(card.missing_arguments)
      ? card.missing_arguments
      : null;
    if (
      args === null
      || prefilled === null
      || missing === null
      || missing.some((key) => typeof key !== "string" || !key)
    ) {
      return false;
    }
    const expectedKeys = [
      ...Object.keys(prefilled),
      ...(missing as string[]),
    ];
    if (!exactKeysMatch(args, expectedKeys)) return false;
    return Object.entries(prefilled).every(([key, value]) => (
      canonicalJsonValueSha256(args[key])
      === canonicalJsonValueSha256(value)
    ));
  },


  openingEvidenceCard(this: any): JsonObject {
    return {
      schema_version: 1,
      operation: "evidence.table_opening",
      invoke_via: "coc_invoke",
      prefilled_arguments: {},
      missing_arguments: [
        "text",
        "run_id",
        "presented_roll_ids",
        "decision_id",
      ],
      hard_gate: true,
      authority: "canonical_setup",
      reason: (
        "Record and return the exact source-backed pre-turn opening, including "
        + "the canonical current opening-time anchor."
      ),
    };
  },


  exactOpeningActivationCard(this: any, value: unknown): JsonObject | null {
    const card = objectOrNull(value);
    const prefilled = objectOrNull(card?.prefilled_arguments);
    const missing = card?.missing_arguments;
    return (
      card !== null
      && card.operation === "state.move_scene"
      && card.invoke_via === "coc_invoke"
      && prefilled !== null
      && typeof prefilled.scene_id === "string"
      && prefilled.scene_id.length > 0
      && prefilled.defer_initial_progressive_on_enter === true
      && Array.isArray(missing)
      && missing.length === 1
      && missing[0] === "decision_id"
      && card.authority === "advisory"
      && card.hard_gate === false
    )
      ? structuredClone(card)
      : null;
  },


  projectOpeningEvidenceRoute(this: any,
    envelope: JsonObject,
    route: OpeningSetupRoute,
  ): JsonObject {
    const projected = structuredClone(envelope);
    const projectedData = objectOrNull(projected.data);
    if (projectedData !== null) {
      delete projectedData.activation_operation;
      projectedData.activation_allowed = false;
      projectedData.next_operation = structuredClone(route.next_operation);
      projectedData.opening_gate = structuredClone(route);
    }
    return projected;
  },


  projectOpeningActivation(this: any,
    envelope: JsonObject,
    activationCard: JsonObject | null,
  ): JsonObject {
    if (activationCard === null) return envelope;
    const projected = structuredClone(envelope);
    const projectedData = objectOrNull(projected.data);
    if (projectedData !== null) {
      projectedData.activation_operation = structuredClone(activationCard);
      projectedData.next_operation = structuredClone(activationCard);
    }
    return projected;
  },


  armOpeningEvidenceRoute(this: any, state: OpeningSetupState): void {
    if (
      openingHandoffOperationForSessionRole(this.effectiveTypedRole())
      === "setup.complete"
    ) {
      this.armSetupCompleteRoute(state);
      return;
    }
    state.phase = "opening_evidence";
    state.route = {
      ...state.route,
      phase: "opening_table_evidence_required",
      next_operation: this.openingEvidenceCard(),
      allowed_actions: undefined,
      instruction: (
        "draft the source-backed opening without restating or reversing the "
        + "authoritative scene.context.time anchor; invoke this exact retained "
        + "evidence.table_opening card, then deliver only its returned data.text"
      ),
    };
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  },


  armOpeningSelectionRoute(this: any, state: OpeningSetupState): void {
    state.phase = "selection";
    state.route = {
      ...state.route,
      phase: "opening_selection",
      next_operation: {
        schema_version: 1,
        operation: "progressive.prepare_opening",
        invoke_via: "coc_invoke",
        prefilled_arguments: {},
        missing_arguments: [],
        hard_gate: true,
        authority: "canonical_setup",
        reason: (
          "Select the shortest sufficient reviewed source opening before play."
        ),
      },
      allowed_actions: undefined,
      instruction: (
        "the reviewed source is ready; invoke this exact retained "
        + "progressive.prepare_opening card before projection or narration"
      ),
    };
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  },


  armSetupCompleteRoute(this: any, state: OpeningSetupState): void {
    state.phase = "ready";
    state.route = {
      ...state.route,
      phase: "opening_setup_complete_required",
      next_operation: {
        schema_version: 1,
        operation: "setup.complete",
        invoke_via: "coc_invoke",
        prefilled_arguments: {
          campaign_id: state.route.campaign_id,
        },
        missing_arguments: ["decision_id"],
        hard_gate: true,
        authority: "canonical_setup",
        reason: (
          "The source-backed opening projection and investigator are current; "
          + "hand the campaign to the play-role Keeper now."
        ),
      },
      allowed_actions: undefined,
      instruction: (
        "invoke this exact retained setup.complete card now; do not call any "
        + "rules, cash, skill, scene, or other exploratory tool first"
      ),
    };
    state.revision += 1;
    state.activationCard = null;
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  },


  retainReviewedSourceUntilCharacterLink(this: any,
    state: OpeningSetupState,
  ): void {
    state.phase = "reviewed";
    state.route = {
      ...state.route,
      phase: "opening_character_setup_required",
      next_operation: null,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
        true,
        state.characterSetupInputMode,
      ),
      instruction: (
        "opening source review is complete; finish the exact canonical "
        + "investigator link, then continue with opening preparation"
      ),
    };
    state.continuationReleaseOwner = null;
  },


  retainOpeningProjectionUntilCharacterLink(this: any,
    state: OpeningSetupState,
  ): void {
    state.phase = "projection";
    state.route = {
      ...state.route,
      phase: "opening_character_setup_required",
      next_operation: null,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
        true,
        state.characterSetupInputMode,
      ),
      instruction: (
        "opening source work is fulfilled, but its projection card remains "
        + "private until the old setup order completes: render the public "
        + "briefing, create the investigator, then record the exact canonical "
        + "campaign.link_investigator receipt"
      ),
    };
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  },


  recoveredCurrentCharacterSetupRoute(this: any,
    campaignId: string,
    inputMode: GuidedCharacterCreationInputMode = "guided_quick_fire",
  ): OpeningSetupRoute {
    if (inputMode === "kp_guided_era_adaptive") {
      return {
        schema_version: 1,
        status: "blocked",
        hard_gate: true,
        activation_allowed: false,
        phase: "opening_character_setup_required",
        campaign_id: campaignId,
        next_operation: null,
        allowed_actions: this.characterSetupAllowedActions(
          campaignId, false, inputMode,
        ),
        character_setup_policy: "kp_guided_era_adaptive_no_source",
        character_setup_input_mode: inputMode,
        instruction: (
          "the source-bound opening is current but no investigator is linked; "
          + "complete only the retained KP-guided era-adaptive create and exact "
          + "campaign.link_investigator sequence before opening play"
        ),
      };
    }
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_character_setup_required",
      campaign_id: campaignId,
      next_operation: null,
      allowed_actions: this.characterSetupAllowedActions(campaignId, false),
      character_setup_policy: "guided_quick_fire_no_source",
      instruction: (
        "the source-bound opening is current but no investigator is linked; "
        + "complete only the retained guided Quick-Fire create and exact "
        + "campaign.link_investigator sequence before opening play"
      ),
    };
  },


  safeRecoveredCharacterSetupProjection(this: any,
    campaignId: string,
    route: OpeningSetupRoute,
  ): JsonObject {
    return {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaignId,
        mode: "opening_character_setup_required",
        opening_gate: route,
      },
      warnings: [],
      hints: [
        "follow only opening_gate.allowed_actions until the exact current "
        + "guided create and campaign.link_investigator receipts succeed",
      ],
    };
  },


  recoveredSourceMaterializationRoute(this: any,
    campaignId: string,
    rearm: JsonObject | null = null,
    instruction = "",
  ): OpeningSetupRoute {
    if (rearm !== null) {
      // The lifecycle is not waiting, it is asking for an exact recovery call:
      // carry that card and do NOT set source_materialization_wait_only, which
      // would keep blocking the very operation that recovers the campaign.
      return {
        schema_version: 1,
        status: "blocked",
        hard_gate: true,
        activation_allowed: false,
        phase: "opening_source_materialization",
        campaign_id: campaignId,
        next_operation: structuredClone(rearm),
        instruction: (
          instruction.trim().length > 0
            ? instruction
            : "invoke this exact retained opening recovery card before any "
              + "other setup or play operation"
        ),
      };
    }
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_materialization",
      campaign_id: campaignId,
      next_operation: null,
      startup_resume_policy: "source_materialization_wait_only",
      instruction: (
        "the retained opening source lifecycle is still pending; wait for its "
        + "canonical host terminal event before any setup or play operation"
      ),
    };
  },


  projectGuidedCharacterContract(this: any,
    operation: string,
    params: JsonObject,
    value: unknown,
  ): unknown {
    if (operation !== "setup.investigator_contract") return value;
    const campaignId = typeof params.campaign === "string"
      ? params.campaign
      : "";
    const state = this.openingSetupStates.get(campaignId);
    if (
      state === undefined
      || state.characterSetupComplete
      || !this.characterSetupAllowed(state)
    ) {
      return value;
    }
    const projected = projectPiGuidedCharacterContract(value, campaignId);
    const contract = objectOrNull(objectOrNull(
      objectOrNull(projected)?.data,
    )?.result);
    const inputMode = contract?.applicable_input_mode;
    if (
      inputMode === "guided_quick_fire"
      || inputMode === "kp_guided_era_adaptive"
    ) {
      state.characterSetupInputMode = inputMode;
      state.route = {
        ...state.route,
        allowed_actions: this.characterSetupAllowedActions(
          state.route.campaign_id,
          true,
          inputMode,
        ),
      };
    }
    return projected;
  },


  armOpeningProjectionRoute(this: any, state: OpeningSetupState): void {
    if (state.projectionCard === null) return;
    state.phase = "projection";
    state.route = {
      ...state.route,
      phase: "opening_projection_required",
      next_operation: state.projectionCard,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
      ).filter((action) => action.kind === "investigator.render_card"),
      instruction: (
        "character creation and the exact canonical investigator link are "
        + "current; invoke this exact retained projection card before live play"
      ),
    };
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  },


  exactTableOpeningReceipt(this: any,
    envelope: JsonObject | null,
  ): boolean {
    const data = objectOrNull(envelope?.data);
    return (
      envelope?.ok === true
      && envelope.tool === "evidence.table_opening"
      && data !== null
      && data.turn === 0
      && typeof data.text === "string"
      && data.text.length > 0
      && typeof data.text_sha256 === "string"
      && data.text_sha256 === canonicalJsonValueSha256(data.text)
      && objectOrNull(data.authoritative_time_anchor) !== null
    );
  },


  routeFromGate(this: any, gate: JsonObject): OpeningSetupRoute | null {
    if (
      gate.hard_gate !== true
      || gate.activation_allowed !== false
      || typeof gate.phase !== "string"
      || typeof gate.campaign_id !== "string"
      || !gate.campaign_id
    ) {
      return null;
    }
    const nextOperation = gate.next_operation === null
      ? null
      : objectOrNull(gate.next_operation);
    if (gate.next_operation !== null && nextOperation === null) return null;
    const inputMode = (
      gate.character_setup_input_mode === "kp_guided_era_adaptive"
      || gate.character_setup_input_mode === "guided_quick_fire"
    )
      ? gate.character_setup_input_mode
      : gate.character_setup_policy === "kp_guided_era_adaptive"
        ? "kp_guided_era_adaptive"
        : null;
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: gate.phase,
      campaign_id: gate.campaign_id,
      next_operation: nextOperation,
      ...(inputMode === "kp_guided_era_adaptive"
        ? {
            character_setup_policy: "kp_guided_era_adaptive_no_source" as const,
            character_setup_input_mode: inputMode,
          }
        : {}),
      instruction: typeof gate.instruction === "string"
        ? gate.instruction
        : "invoke the exact retained canonical setup route",
    };
  },


  exactCanonicalProjectionRefreshCard(this: any,
    card: JsonObject | null,
  ): boolean {
    if (
      card === null
      || card.operation !== "progressive.project_opening"
      || card.invoke_via !== "coc_invoke"
      || card.hard_gate !== true
      || card.authority !== "canonical_setup"
      || !Array.isArray(card.missing_arguments)
      || card.missing_arguments.length !== 0
    ) return false;
    const prefilled = objectOrNull(card.prefilled_arguments);
    if (prefilled === null) return false;
    const pages = prefilled.opening_pdf_indices;
    if (!exactKeysMatch(
      prefilled,
      pages === undefined
        ? ["asset_root_id", "source_file_sha256", "start_location_id"]
        : [
          "asset_root_id", "source_file_sha256", "start_location_id",
          "opening_pdf_indices",
        ],
    )) return false;
    return (
      typeof prefilled.asset_root_id === "string"
      && prefilled.asset_root_id.trim().length > 0
      && typeof prefilled.source_file_sha256 === "string"
      && prefilled.source_file_sha256.trim().length === 64
      && typeof prefilled.start_location_id === "string"
      && prefilled.start_location_id.trim().length > 0
      && (
        pages === undefined
        || (
          Array.isArray(pages)
          && pages.length > 0
          && pages.every((page) => (
            Number.isInteger(page) && Number(page) >= 0
          ))
          && new Set(pages).size === pages.length
        )
      )
    );
  },


  reconcileCanonicalOpeningRefresh(this: any,
    params: JsonObject,
    value: unknown,
    invocationId: string,
  ): boolean {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    const envelope = objectOrNull(value);
    const error = objectOrNull(envelope?.error);
    const gate = objectOrNull(error?.details);
    const route = gate === null ? null : this.routeFromGate(gate);
    const card = route?.next_operation ?? null;
    if (
      attempt === undefined
      || state === undefined
      || !this.attemptMatchesState(attempt, state)
      || attempt.attemptClass !== "route"
      || attempt.operation !== "evidence.table_opening"
      || state.phase !== "opening_evidence"
      || state.characterSetupComplete !== true
      || state.route.next_operation?.operation !== "evidence.table_opening"
      || params.operation !== attempt.operation
      || this.setupInvocationCampaignId(params) !== attempt.campaignId
      || envelope?.ok !== false
      || envelope.tool !== attempt.operation
      || error?.code !== "opening_setup_incomplete"
      || gate === null
      || gate.campaign_id !== attempt.campaignId
      || gate.source_lifecycle_status !== "complete"
      || route === null
      || route.phase !== "opening_source_materialization"
      || route.campaign_id !== attempt.campaignId
      || card === null
      || !this.exactCanonicalProjectionRefreshCard(card)
    ) return false;

    this.supersedeOpeningSetupRevisionAttempts(state, invocationId);
    this.finalizeOpeningSetupAttempt(invocationId);
    state.route = route;
    state.revision += 1;
    state.phase = "projection";
    state.projectionCard = structuredClone(card);
    state.activationCard = null;
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(attempt.campaignId);
    this.openingSetupVisibleOutputAuthorization = null;
    this.recordOpeningSetupAudit({
      status: "transitioned",
      transition: "canonical_opening_projection_refresh",
      campaign_id: attempt.campaignId,
      generation: state.generation,
      from_revision: attempt.revision,
      to_revision: state.revision,
      from_phase: "opening_evidence",
      to_phase: route.phase,
      invocation_id: invocationId,
    });
    return true;
  },


  exactPrepareCard(this: any, card: JsonObject | null): boolean {
    return (
      card !== null
      && card.operation === "progressive.prepare_opening"
      && card.invoke_via === "coc_invoke"
      && card.hard_gate === true
      && card.authority === "canonical_setup"
      && objectOrNull(card.prefilled_arguments) !== null
      && exactKeysMatch(
        objectOrNull(card.prefilled_arguments)!,
        [],
      )
      && Array.isArray(card.missing_arguments)
      && card.missing_arguments.length === 0
    );
  },


  validOpeningStartLocation(this: any, value: unknown): boolean {
    const location = objectOrNull(value);
    if (
      location === null
      || !exactKeysMatch(location, ["location_id", "title"])
      || typeof location.location_id !== "string"
      || typeof location.title !== "string"
    ) {
      return false;
    }
    const locationId = location.location_id;
    const title = location.title;
    const titleLength = Array.from(title).length;
    return (
      locationId === locationId.trim()
      && title === title.trim()
      && OPENING_START_LOCATION_ID.test(locationId)
      && titleLength >= 1
      && titleLength <= 240
    );
  },


  validOpeningPdfIndices(this: any, value: unknown): boolean {
    if (
      !Array.isArray(value)
      || value.length < 1
      || value.length > 3
      || value.some((row) => !Number.isInteger(row) || row < 0)
      || new Set(value).size !== value.length
    ) {
      return false;
    }
    return value.every((row, index) => (
      index === 0 || row === value[index - 1] + 1
    ));
  },


  exactBootstrapCard(this: any, card: JsonObject | null): boolean {
    if (
      card === null
      || card.operation !== "progressive.opening_bootstrap"
      || card.invoke_via !== "coc_invoke"
      || card.hard_gate !== true
      || card.authority !== "canonical_setup"
    ) {
      return false;
    }
    const prefilled = objectOrNull(card.prefilled_arguments);
    const missing = Array.isArray(card.missing_arguments)
      ? card.missing_arguments
      : null;
    if (
      prefilled === null
      || missing === null
      || missing.some((key) => (
        typeof key !== "string"
        || !["start_location", "opening_pdf_indices"].includes(key)
      ))
    ) {
      return false;
    }
    const combined = [...Object.keys(prefilled), ...(missing as string[])];
    if (
      combined.length === 2
      && new Set(combined).size === 2
      && combined.includes("start_location")
      && combined.includes("opening_pdf_indices")
    ) {
      return (
        (
          !Object.hasOwn(prefilled, "start_location")
          || this.validOpeningStartLocation(prefilled.start_location)
        )
        && (
          !Object.hasOwn(prefilled, "opening_pdf_indices")
          || this.validOpeningPdfIndices(prefilled.opening_pdf_indices)
        )
      );
    }
    return false;
  },


  recoveryRoute(this: any, campaignId: string): OpeningSetupRoute {
    return {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_contract_invalid",
      campaign_id: campaignId,
      next_operation: {
        schema_version: 1,
        operation: "progressive.prepare_opening",
        invoke_via: "coc_invoke",
        prefilled_arguments: {},
        missing_arguments: [],
        hard_gate: true,
        authority: "canonical_setup",
        reason: (
          "Revalidate the repaired source contract before selecting the "
          + "source-authored opening."
        ),
      },
      instruction: (
        "repair the persisted source contract, then invoke the exact retained "
        + "progressive.prepare_opening recovery card"
      ),
    };
  },


  scenarioBindInvocation(this: any, params: JsonObject): boolean {
    const args = objectOrNull(params.arguments);
    return (
      params.operation === "setup.invoke"
      && args?.kind === "scenario.bind_pdf"
      && objectOrNull(args.payload) !== null
    );
  },


  existingCampaignSetupError(this: any, params: JsonObject): string | null {
    if (params.operation !== "setup.invoke") return null;
    const args = objectOrNull(params.arguments);
    const payload = objectOrNull(args?.payload);
    const kind = typeof args?.kind === "string" ? args.kind : "";
    if (!EXISTING_CAMPAIGN_SETUP_KINDS.has(kind)) return null;
    const outerCampaign = typeof params.campaign === "string"
      ? params.campaign
      : "";
    const payloadCampaign = typeof payload?.campaign_id === "string"
      ? payload.campaign_id
      : "";
    if (
      outerCampaign.trim().length > 0
      && payloadCampaign.trim().length > 0
      && outerCampaign === payloadCampaign
    ) {
      return null;
    }
    const retained = payloadCampaign
      ? {
        operation: "setup.invoke",
        campaign: payloadCampaign,
        arguments: args,
      }
      : null;
    return (
      `${kind || "campaign-bound setup.invoke"} requires a non-empty top-level `
      + "campaign exactly equal to arguments.payload.campaign_id before "
      + "canonical execution; retry only this corrected call: "
      + JSON.stringify(retained)
    );
  },


  setupInvocationCampaignId(this: any, params: JsonObject): string | null {
    if (typeof params.campaign === "string" && params.campaign.length > 0) {
      return params.campaign;
    }
    const args = objectOrNull(params.arguments);
    if (params.operation === "setup.quick_start") {
      return (
        typeof args?.campaign_id === "string"
        && args.campaign_id.length > 0
      )
        ? args.campaign_id
        : null;
    }
    if (params.operation !== "setup.invoke") return null;
    if (args?.kind !== "campaign.create") return null;
    const payload = objectOrNull(args.payload);
    return (
      typeof payload?.campaign_id === "string"
      && payload.campaign_id.length > 0
    )
      ? payload.campaign_id
      : null;
  },


  noteOpeningSetupTurnCampaign(this: any, campaignId: string): void {
    if (this.openingSetupTurnCampaignId === null) {
      this.openingSetupTurnCampaignId = campaignId;
      return;
    }
    if (this.openingSetupTurnCampaignId !== campaignId) {
      this.openingSetupTurnCampaignAmbiguous = true;
    }
  },


  registerOpeningSetupAttempt(this: any,
    invocationId: string,
    params: JsonObject,
    attemptClass: OpeningSetupAttempt["attemptClass"],
    state: OpeningSetupState | null,
  ): void {
    const campaignId = this.setupInvocationCampaignId(params);
    if (campaignId === null) {
      throw new Error("opening setup attempt campaign identity is unavailable");
    }
    const generationSequence = state?.generationSequence
      ?? ++this.openingSetupGenerationSequence;
    const generation = state?.generation
      ?? `${campaignId}:${generationSequence}`;
    if (state === null && attemptClass === "bind") {
      this.openingSetupLatestIssuedGeneration.set(
        campaignId,
        generationSequence,
      );
    }
    this.noteOpeningSetupTurnCampaign(campaignId);
    this.openingSetupAttempts.set(invocationId, {
      invocationId,
      campaignId,
      generation,
      generationSequence,
      revision: state?.revision ?? null,
      operation: String(params.operation),
      attemptClass,
      agentTurn: this.openingSetupAgentTurn,
      dispatchIdentity: null,
    });
  },


  resultCampaignMismatch(this: any,
    attempt: OpeningSetupAttempt,
    envelope: JsonObject | null,
    returnedGate: JsonObject | null,
  ): boolean {
    const data = objectOrNull(envelope?.data);
    const task = findAutoDispatchTask(envelope);
    const packet = task === null ? null : objectOrNull(task.packet);
    const explicit = [
      returnedGate?.campaign_id,
      data?.campaign_id,
      packet?.campaign_id,
    ].filter((value) => typeof value === "string");
    return explicit.some((value) => value !== attempt.campaignId);
  },


  attemptMatchesState(this: any,
    attempt: OpeningSetupAttempt,
    state: OpeningSetupState | undefined,
  ): state is OpeningSetupState {
    return (
      state !== undefined
      && attempt.generation === state.generation
      && attempt.revision === state.revision
    );
  },


  unboundAttemptIsFresh(this: any, attempt: OpeningSetupAttempt): boolean {
    const newerThanRetired = (
      attempt.generationSequence !== null
      && attempt.generationSequence > (
        this.openingSetupRetiredGeneration.get(attempt.campaignId) ?? 0
      )
    );
    if (!newerThanRetired) return false;
    if (attempt.attemptClass !== "bind") return true;
    return attempt.generationSequence === (
      this.openingSetupLatestIssuedGeneration.get(attempt.campaignId)
      ?? -1
    );
  },


  initializeOpeningSetupState(this: any,
    campaignId: string,
    route: OpeningSetupRoute,
    phase: OpeningSetupState["phase"],
    attempt: OpeningSetupAttempt,
  ): OpeningSetupState {
    if (
      attempt.generation === null
      || attempt.generationSequence === null
    ) {
      throw new Error("opening setup generation identity is unavailable");
    }
    const state: OpeningSetupState = {
      route,
      generation: attempt.generation,
      generationSequence: attempt.generationSequence,
      revision: 1,
      phase,
      dispatchIdentity: null,
      characterSetupComplete: false,
      characterSetupInputMode: (
        route.character_setup_input_mode ?? null
      ),
      guidedCreateReceipts: new Map<string, OpeningGuidedCreateReceipt>(),
      projectionCard: null,
      activationCard: null,
      bootstrapRetryCard: null,
      continuationReleaseOwner: null,
      backgroundTerminalReceipt: null,
      bindBriefing: null,
    };
    this.openingSetupStates.set(campaignId, state);
    this.openingSetupContinuationQueued.delete(campaignId);
    return state;
  },


  transitionContractInvalid(this: any,
    state: OpeningSetupState,
    attempt: OpeningSetupAttempt,
  ): OpeningSetupState {
    const next = {
      ...state,
      route: this.recoveryRoute(state.route.campaign_id),
      revision: state.revision + 1,
      phase: "contract_invalid" as const,
      dispatchIdentity: null,
      continuationReleaseOwner: null,
      backgroundTerminalReceipt: null,
      characterSetupInputMode: null,
      guidedCreateReceipts: new Map<string, OpeningGuidedCreateReceipt>(),
    };
    this.openingSetupStates.set(state.route.campaign_id, next);
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
    this.recordOpeningSetupAudit({
      status: "transitioned",
      transition: "source_contract_invalid",
      campaign_id: state.route.campaign_id,
      generation: state.generation,
      from_revision: attempt.revision,
      to_revision: next.revision,
      invocation_id: attempt.invocationId,
    });
    return next;
  },


  openingSetupToolError(this: any,
    name: string,
    params: JsonObject,
    invocationId = `direct:${this.openingSetupAttempts.size + 1}`,
  ): string | null {
    if (name === "coc_discover" || name === "coc_progressive_ocr") {
      const state = this.openingSetupStateForTranscript();
      if (
        state === null
        && this.openingSetupStates.size === 0
        && !this.pendingBindExists()
      ) {
        return null;
      }
      const route = state?.route ?? null;
      return (
        `${name} is unavailable while the Pi opening setup hard gate is active; `
        + `follow this exact retained route: ${JSON.stringify(route)}`
      );
    }
    if (!isCanonicalInvokeSurface(name)) return null;
    const setupOwnershipError = this.existingCampaignSetupError(params);
    if (setupOwnershipError !== null) return setupOwnershipError;
    const operation = String(params.operation ?? "");
    const campaignId = this.setupInvocationCampaignId(params);
    if (campaignId === null) {
      if (OWNED_OPENING_ROUTE_OPERATIONS.has(operation)) {
        return (
          `${operation} requires a top-level campaign and an owned exact Pi `
          + "opening route before canonical execution"
        );
      }
      if (this.openingSetupStates.size === 0) return null;
      return "campaign-bound Pi opening setup requires the exact campaign id";
    }
    if (this.openingSetupAttempts.has(invocationId)) {
      this.recordOpeningSetupAudit({
        status: "rejected",
        reason: "duplicate_invocation_identity",
        campaign_id: campaignId,
        invocation_id: invocationId,
      });
      return "Pi opening setup invocation identity was already admitted";
    }
    const campaignAttemptCount = [...this.openingSetupAttempts.values()]
      .filter((attempt) => attempt.campaignId === campaignId).length;
    if (campaignAttemptCount >= MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN) {
      this.recordOpeningSetupAudit({
        status: "rejected",
        reason: "campaign_attempt_limit",
        campaign_id: campaignId,
        attempt_limit: MAX_OPENING_SETUP_ATTEMPTS_PER_CAMPAIGN,
      });
      return "Pi opening setup has too many concurrent campaign attempts";
    }
    const state = this.openingSetupStates.get(campaignId) ?? null;
    if (state === null) {
      if (OWNED_OPENING_ROUTE_OPERATIONS.has(operation)) {
        return (
          `${operation} has no owned Pi opening route for campaign `
          + `${campaignId}; invoke the corrected campaign-bound `
          + "scenario.bind_pdf call first and follow its exact retained "
          + "progressive.prepare_opening card"
        );
      }
      if (
        this.pendingBindExistsForCampaign(campaignId)
        && !this.scenarioBindInvocation(params)
      ) {
        return (
          "Pi opening setup is waiting for the newest admitted scenario bind "
          + `for campaign ${campaignId}`
        );
      }
      this.registerOpeningSetupAttempt(
        invocationId,
        params,
        this.scenarioBindInvocation(params) ? "bind" : "probe",
        null,
      );
      return null;
    }
    this.noteOpeningSetupTurnCampaign(campaignId);
    const argumentsObject = objectOrNull(params.arguments);
    if (
      state.phase === "handoff_complete_waiting_resume"
      && operation === "session.resume"
      && argumentsObject !== null
      && Object.keys(argumentsObject).length === 0
    ) {
      this.registerOpeningSetupAttempt(invocationId, params, "probe", state);
      return null;
    }
    if (this.exactOpeningSetupRouteInvocation(state.route, params)) {
      if (
        state.phase === "handoff_decision"
        && operation === "setup.complete"
      ) {
        const decisionEpoch = this.setupHandoffDecisionPlayerEpoch.get(
          campaignId,
        );
        if (
          decisionEpoch === undefined
          || decisionEpoch.generation !== state.generation
          || this.playerTurnEpoch <= decisionEpoch.playerTurnEpoch
        ) {
          this.recordOpeningSetupAudit({
            status: "rejected",
            reason: "setup_handoff_requires_new_external_player_turn",
            campaign_id: campaignId,
            generation: state.generation,
            decision_player_turn_epoch: decisionEpoch?.playerTurnEpoch,
            current_player_turn_epoch: this.playerTurnEpoch,
          });
          return (
            "setup.complete requires a new external player message after the "
            + "handoff decision was armed"
          );
        }
      }
      if (
        state.phase === "projection"
        && !state.characterSetupComplete
      ) {
        return (
          "progressive.project_opening remains retained until the exact "
          + "canonical campaign.link_investigator receipt is current"
        );
      }
      this.registerOpeningSetupAttempt(invocationId, params, "route", state);
      this.openingSetupContinuationQueued.add(campaignId);
      return null;
    }
    if (this.openingSetupCharacterInvocation(params, state)) {
      this.registerOpeningSetupAttempt(
        invocationId,
        params,
        "character",
        state,
      );
      return null;
    }
    if (
      operation === "rules.roll_dice"
      && this.characterSetupAllowed(state)
    ) {
      if (state.characterSetupInputMode === "kp_guided_era_adaptive") {
        return (
          "rules.roll_dice for the active era-adaptive contract must use "
          + "3D6 or 2D6+6 with decision_id and optional reason (no purpose), "
          + "or the typed 3D6 investigator_creation_luck recipe for Luck"
        );
      }
      const args = objectOrNull(params.arguments);
      const decisionId = (
        typeof args?.decision_id === "string"
        && args.decision_id.trim().length > 0
      )
        ? args.decision_id
        : `quick-fire-luck-${campaignId}`;
      return (
        "rules.roll_dice is restricted to the exact Quick-Fire Luck creation "
        + "recipe while character creation overlaps opening parsing; retry "
        + "this retained call without changing its arguments: "
        + JSON.stringify({
          operation: "rules.roll_dice",
          campaign: campaignId,
          arguments: {
            expression: "3D6",
            decision_id: decisionId,
            purpose: "investigator_creation_luck",
            reason: "Quick-Fire investigator Luck",
          },
        })
      );
    }
    if (state.route.next_operation?.operation === params.operation) {
      this.openingSetupContinuationQueued.delete(campaignId);
    }
    const createRejection = this.openingInvestigatorCreateRejection(
      params, state,
    );
    if (createRejection !== null) return createRejection;
    return (
      `${String(params.operation || "coc_invoke")} is unavailable while the `
      + "Pi opening setup hard gate is active; follow this exact retained "
      + `route: ${JSON.stringify(state.route)}`
    );
  },


  observeOpeningSetupInvocation(this: any,
    operation: string,
    params: JsonObject,
    value: unknown,
    invocationId = "",
    canonicalVisibleOutput: CanonicalSetupVisibleOutput | null = null,
  ): OpeningSetupObservationDisposition {
    const attempt = this.openingSetupAttempts.get(invocationId);
    if (attempt === undefined) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "unowned_result",
        operation,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "unowned_result",
      };
    }
    const envelope = objectOrNull(value);
    const data = objectOrNull(envelope?.data);
    const error = objectOrNull(envelope?.error);
    const details = objectOrNull(error?.details);
    const returnedGate = objectOrNull(data?.opening_gate)
      ?? (details?.hard_gate === true ? details : null);
    if (
      attempt.operation !== operation
      || this.setupInvocationCampaignId(params) !== attempt.campaignId
      || this.resultCampaignMismatch(attempt, envelope, returnedGate)
    ) {
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "invocation_or_campaign_mismatch",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "invocation_or_campaign_mismatch",
      };
    }

    if (attempt.attemptClass === "bind") {
      if (
        this.openingSetupStates.has(attempt.campaignId)
        || !this.unboundAttemptIsFresh(attempt)
      ) {
        this.finalizeOpeningSetupAttempt(invocationId);
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "late_bind_outside_current_route_generation",
          campaign_id: attempt.campaignId,
          invocation_id: invocationId,
        });
        return {
          accepted: false,
          dispatchAllowed: false,
          reason: "late_bind_outside_current_route_generation",
        };
      }
      const route = returnedGate === null
        ? null
        : this.routeFromGate(returnedGate);
      if (
        envelope?.ok === true
        && route !== null
        && (
          (
            route.phase === "opening_selection"
            && this.exactPrepareCard(route.next_operation)
          )
          || (
            route.phase === "opening_source_review_required"
            && route.next_operation === null
          )
        )
      ) {
        const sourceReviewRequired = (
          route.phase === "opening_source_review_required"
        );
        if (sourceReviewRequired) {
          route.allowed_actions = this.characterSetupAllowedActions(
            attempt.campaignId,
          );
        }
        const initialized = this.initializeOpeningSetupState(
          attempt.campaignId,
          route,
          sourceReviewRequired ? "source_review" : "selection",
          attempt,
        );
        // opening_selection is derived only after the linked investigator is
        // confirmed; retain that persisted lifecycle fact in the Pi gate.
        if (!sourceReviewRequired) initialized.characterSetupComplete = true;
        if (
          canonicalVisibleOutput?.campaignId === attempt.campaignId
          && canonicalVisibleOutput.sourceKind === "scenario.bind_pdf"
          && canonicalVisibleOutput.textSha256
            === canonicalJsonValueSha256(canonicalVisibleOutput.text)
        ) {
          initialized.bindBriefing = { ...canonicalVisibleOutput };
          this.authorizeOpeningSetupConversationalOutput(
            initialized,
            attempt,
            (
              `scenario.bind_pdf:${canonicalVisibleOutput.publicSetupSha256}`
            ),
          );
        }
        this.finalizeOpeningSetupAttempt(invocationId);
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: sourceReviewRequired
            ? "bind_opening_source_review_required"
            : "bind_opening_selection",
        };
      } else if (
        returnedGate?.phase === "opening_source_contract_invalid"
      ) {
        const invalid = this.initializeOpeningSetupState(
          attempt.campaignId,
          this.recoveryRoute(attempt.campaignId),
          "contract_invalid",
          attempt,
        );
        this.markOpeningSetupTerminalBlocker(
          envelope ?? failedBlockingOpeningEnvelope(
            {
              status: "terminal_failure",
              failure_class: "source_contract_invalid",
            },
            "opening_source_contract_invalid",
          ),
          undefined,
          attempt.campaignId,
          invalid,
        );
        this.finalizeOpeningSetupAttempt(invocationId);
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "bind_source_contract_invalid",
        };
      }
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "bind_result_invalid",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "bind_result_invalid",
      };
    }

    let state = this.openingSetupStates.get(attempt.campaignId);
    const preboundRoute = returnedGate === null
      ? null
      : this.routeFromGate(returnedGate);
    const exactProjectedResumeError = (
      envelope !== null
      && envelope.ok === false
      && (
        envelope.tool === "session.resume"
        || envelope.tool === "coc_session_resume"
        || envelope.tool === "coc_invoke"
      )
      && error !== null
      && error.code === "opening_setup_incomplete"
      && details !== null
      && details.hard_gate === true
      && details === returnedGate
    );
    if (
      state?.phase === "handoff_complete_waiting_resume"
      && attempt.attemptClass === "probe"
      && operation === "session.resume"
    ) {
      this.finalizeOpeningSetupAttempt(invocationId);
      const nextOperations = Array.isArray(data?.next_operations)
        ? data.next_operations
        : [];
      if (
        envelope?.ok === true
        && envelope.tool === "session.resume"
        && data?.schema_version === 1
        && data.campaign_id === attempt.campaignId
        && data.mode === "table_opening"
        && nextOperations.length === 1
        && nextOperations[0] === "evidence.table_opening"
      ) {
        this.armOpeningEvidenceRoute(state);
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "role_null_handoff_resumed",
        };
      }
      this.openingSetupContinuationQueued.delete(attempt.campaignId);
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "role_null_handoff_resume_invalid",
      };
    }
    const canonicalPreboundProbe = (
      attempt.attemptClass === "probe"
      && this.unboundAttemptIsFresh(attempt)
      && preboundRoute !== null
      && preboundRoute.phase === "opening_selection"
      && this.exactPrepareCard(preboundRoute.next_operation)
      && (
        (
          operation === "session.resume"
          && envelope?.ok === false
          && envelope.tool === "session.resume"
          && error?.code === "opening_setup_incomplete"
          && details === returnedGate
        )
        || (
          operation === "setup.investigator_contract"
          && envelope?.ok === true
          && objectOrNull(data?.opening_gate) === returnedGate
        )
      )
    );
    const canonicalCharacterSetupInputMode = (
      returnedGate?.character_setup_policy === "kp_guided_era_adaptive"
      && returnedGate?.character_setup_input_mode === "kp_guided_era_adaptive"
    )
      ? "kp_guided_era_adaptive"
      : returnedGate?.character_setup_policy === "guided_quick_fire"
        ? "guided_quick_fire"
        : null;
    const canonicalCharacterSetupProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && (
        (
          canonicalCharacterSetupInputMode === "guided_quick_fire"
          && hasRequiredKeys(returnedGate, [
            "schema_version", "status", "hard_gate", "activation_allowed",
            "phase", "campaign_id", "character_setup_policy", "next_operation",
            "instruction",
          ])
        ) || (
          canonicalCharacterSetupInputMode === "kp_guided_era_adaptive"
          && hasRequiredKeys(returnedGate, [
            "schema_version", "status", "hard_gate", "activation_allowed",
            "phase", "campaign_id", "character_setup_policy",
            "character_setup_input_mode", "next_operation", "instruction",
          ])
        )
      )
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_character_setup_required"
      && returnedGate.campaign_id === attempt.campaignId
      && returnedGate.next_operation === null
    );
    const freshCharacterCreation = objectOrNull(data?.character_creation);
    const freshBriefingPath = typeof freshCharacterCreation?.briefing_path === "string"
      ? freshCharacterCreation.briefing_path
      : "";
    const canonicalFreshStarterCharacterSetupProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && envelope?.ok === true
      && envelope.tool === "session.resume"
      && data?.schema_version === 1
      && data.campaign_id === attempt.campaignId
      && data.mode === "awaiting_player"
      && freshCharacterCreation !== null
      && hasRequiredKeys(freshCharacterCreation, [
        "status", "campaign_id", "era", "play_language", "title",
        "briefing_path", "language",
      ])
      && freshCharacterCreation.status === "incomplete"
      && freshCharacterCreation.campaign_id === attempt.campaignId
      && typeof freshCharacterCreation.era === "string"
      && Boolean(freshCharacterCreation.era.trim())
      && typeof freshCharacterCreation.play_language === "string"
      && Boolean(freshCharacterCreation.play_language.trim())
      && freshCharacterCreation.language === freshCharacterCreation.play_language
      && typeof freshCharacterCreation.title === "string"
      && Boolean(freshCharacterCreation.title.trim())
      && freshBriefingPath.startsWith(
        `.coc/campaigns/${attempt.campaignId}/assets/character-creation/`,
      )
      && !freshBriefingPath.includes("/../")
      && !freshBriefingPath.endsWith("/..")
    );
    const quickStartArguments = objectOrNull(params.arguments);
    const quickStartResult = objectOrNull(data?.result);
    const quickStartStateRefs = data?.state_refs;
    const quickStartResultKeys = new Set([
      "campaign_id", "investigator_id", "needs_investigator",
      "scenario_id", "pregen_id", "character_path", "campaign_dir",
    ]);
    const quickStartWarnings = quickStartResult?.warnings;
    const quickStartRoot = (
      typeof params.root === "string"
      && isAbsolute(params.root)
      && params.root === resolve(params.root)
    ) ? params.root : null;
    const quickStartInvestigatorId = typeof quickStartResult?.investigator_id === "string"
      ? quickStartResult.investigator_id
      : "";
    const quickStartCampaignDir = typeof quickStartResult?.campaign_dir === "string"
      ? quickStartResult.campaign_dir
      : "";
    const quickStartCharacterPath = typeof quickStartResult?.character_path === "string"
      ? quickStartResult.character_path
      : "";
    const exactQuickStartCampaignDir = (
      quickStartRoot !== null
      && isAbsolute(quickStartCampaignDir)
      && quickStartCampaignDir === resolve(quickStartCampaignDir)
      && quickStartCampaignDir === resolve(
        quickStartRoot,
        ".coc",
        "campaigns",
        attempt.campaignId,
      )
    );
    const quickStartInvestigatorLess = (
      quickStartResult?.needs_investigator === true
      && (
        quickStartArguments?.pregen_id === undefined
        || quickStartArguments.pregen_id === null
      )
      && quickStartResult.investigator_id === null
      && quickStartResult.pregen_id === null
      && quickStartResult.character_path === null
      && Array.isArray(quickStartStateRefs)
      && quickStartStateRefs.length === 1
      && quickStartStateRefs[0]
        === `.coc/campaigns/${attempt.campaignId}`
    );
    const quickStartLinkedPregen = (
      quickStartResult?.needs_investigator === false
      && Boolean(quickStartInvestigatorId.trim())
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(quickStartInvestigatorId)
      && typeof quickStartResult?.pregen_id === "string"
      && OPENING_START_LOCATION_ID.test(quickStartResult.pregen_id)
      && quickStartArguments?.pregen_id === quickStartResult.pregen_id
      && quickStartRoot !== null
      && isAbsolute(quickStartCharacterPath)
      && quickStartCharacterPath === resolve(quickStartCharacterPath)
      && quickStartCharacterPath === resolve(
        quickStartRoot,
        ".coc",
        "investigators",
        quickStartInvestigatorId,
        "character.json",
      )
      && Array.isArray(quickStartStateRefs)
      && quickStartStateRefs.length === 2
      && quickStartStateRefs[0]
        === `.coc/campaigns/${attempt.campaignId}`
      && quickStartStateRefs[1]
        === `.coc/investigators/${quickStartInvestigatorId}/character.json`
    );
    const canonicalFreshQuickStartProbe = (
      attempt.attemptClass === "probe"
      && operation === "setup.quick_start"
      && attempt.agentTurn === this.openingSetupAgentTurn
      && this.unboundAttemptIsFresh(attempt)
      && envelope?.ok === true
      && envelope.tool === "setup.quick_start"
      && data?.schema_version === 1
      && data.status === "PASS"
      && data.kind === "campaign.quick_start"
      && quickStartArguments !== null
      && typeof quickStartArguments.scenario_id === "string"
      && Boolean(quickStartArguments.scenario_id.trim())
      && quickStartArguments.campaign_id === attempt.campaignId
      && quickStartResult !== null
      && [...quickStartResultKeys].every((key) => key in quickStartResult)
      && Object.keys(quickStartResult).every((key) => (
        quickStartResultKeys.has(key) || key === "warnings"
      ))
      && (
        quickStartWarnings === undefined
        || (
          Array.isArray(quickStartWarnings)
          && quickStartWarnings.every((warning) => (
            typeof warning === "string" && Boolean(warning.trim())
          ))
        )
      )
      && quickStartResult.campaign_id === attempt.campaignId
      && quickStartResult.scenario_id === quickStartArguments.scenario_id
      && isCanonicalCampaignId(attempt.campaignId)
      && exactQuickStartCampaignDir
      && (quickStartInvestigatorLess || quickStartLinkedPregen)
    );
    const canonicalMaterializationProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && hasRequiredKeys(
        returnedGate,
        returnedGate.source_lifecycle_status === "resolver_lost"
          ? [
            "schema_version",
            "status",
            "hard_gate",
            "activation_allowed",
            "phase",
            "campaign_id",
            "source_lifecycle_status",
            "retained_start_location_id",
            "next_operation",
            "instruction",
          ]
          : [
            "schema_version",
            "status",
            "hard_gate",
            "activation_allowed",
            "phase",
            "campaign_id",
            "source_lifecycle_status",
            "next_operation",
            "instruction",
          ],
      )
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_source_materialization"
      && returnedGate.campaign_id === attempt.campaignId
      && (
        // A live lifecycle waits; any other state carries a recovery card.
        returnedGate.source_lifecycle_status === "pending"
          ? returnedGate.next_operation === null
          : [
            "progressive.opening_bootstrap",
            "progressive.project_opening",
          ].includes(
            String(objectOrNull(returnedGate.next_operation)?.operation ?? ""),
          )
      )
    );
    const canonicalSourceReviewProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_source_review_required"
      && returnedGate.campaign_id === attempt.campaignId
      && returnedGate.source_provenance
        === "selection_hint_only_not_provenance"
      && returnedGate.required_source_owner
        === "coc-opening-source-coordinator"
      && typeof returnedGate.character_setup_complete === "boolean"
      && returnedGate.next_operation === null
    );
    const recoveredFactsCard = objectOrNull(returnedGate?.next_operation);
    const recoveredFactsArguments = objectOrNull(
      recoveredFactsCard?.arguments,
    );
    const canonicalSourceFactsProbe = (
      attempt.attemptClass === "probe"
      && operation === "session.resume"
      && this.unboundAttemptIsFresh(attempt)
      && exactProjectedResumeError
      && returnedGate !== null
      && returnedGate.schema_version === 1
      && returnedGate.status === "blocked"
      && returnedGate.hard_gate === true
      && returnedGate.activation_allowed === false
      && returnedGate.phase === "opening_source_facts_adoption_required"
      && returnedGate.campaign_id === attempt.campaignId
      && recoveredFactsCard !== null
      && recoveredFactsCard.operation === "setup.adopt_source_facts"
      && recoveredFactsCard.invoke_via === "coc_invoke"
      && recoveredFactsCard.campaign === attempt.campaignId
      && recoveredFactsArguments !== null
      && exactKeysMatch(recoveredFactsArguments, ["campaign_id", "facts"])
      && recoveredFactsArguments.campaign_id === attempt.campaignId
      && validOpeningTransportFacts(recoveredFactsArguments.facts)
    );
    if (state === undefined && canonicalSourceFactsProbe) {
      const route = this.routeFromGate(returnedGate!);
      if (route === null) {
        this.finalizeOpeningSetupAttempt(invocationId);
        return {
          accepted: false,
          dispatchAllowed: false,
          reason: "opening_source_facts_gate_invalid",
        };
      }
      route.allowed_actions = [structuredClone(recoveredFactsCard!)];
      this.rememberReviewedAdoptFacts({
        status: "reviewed",
        campaign_id: attempt.campaignId,
        facts: recoveredFactsArguments.facts,
      });
      this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "reviewed",
        attempt,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_source_facts_adoption_required",
      };
    }
    if (state === undefined && canonicalSourceReviewProbe) {
      const route = this.routeFromGate(returnedGate!);
      if (route === null) {
        this.finalizeOpeningSetupAttempt(invocationId);
        return {
          accepted: false,
          dispatchAllowed: false,
          reason: "opening_source_review_gate_invalid",
        };
      }
      route.allowed_actions = this.characterSetupAllowedActions(
        attempt.campaignId,
      );
      const initialized = this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "source_review",
        attempt,
      );
      initialized.characterSetupComplete = (
        returnedGate!.character_setup_complete === true
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: "canonical_source_review_gate_rehydrated",
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_source_review_required",
      };
    }
    if (state === undefined && canonicalFreshQuickStartProbe) {
      const route = this.recoveredCurrentCharacterSetupRoute(
        attempt.campaignId,
      );
      const initialized = this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "ready",
        attempt,
      );
      if (quickStartLinkedPregen) {
        initialized.characterSetupComplete = true;
        this.armSetupHandoffDecisionRoute(
          initialized,
          quickStartInvestigatorId,
        );
      }
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: quickStartLinkedPregen
          ? "canonical_fresh_quick_start_pregen_handoff_hydrated"
          : "canonical_fresh_quick_start_character_setup_hydrated",
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: quickStartLinkedPregen
          ? "fresh_quick_start_pregen_handoff_decision"
          : "fresh_quick_start_character_setup",
        ...(quickStartLinkedPregen
          ? {}
          : {
              modelProjection: this.safeRecoveredCharacterSetupProjection(
                attempt.campaignId,
                route,
              ),
            }),
      };
    }
    if (
      state === undefined
      && attempt.attemptClass === "probe"
      && operation === "setup.quick_start"
    ) {
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "fresh_quick_start_result_invalid",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "fresh_quick_start_result_invalid",
      };
    }
    if (state === undefined && canonicalFreshStarterCharacterSetupProbe) {
      const route = this.recoveredCurrentCharacterSetupRoute(
        attempt.campaignId,
      );
      this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "ready",
        attempt,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: "canonical_fresh_starter_character_setup_rehydrated",
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "fresh_starter_character_setup",
        modelProjection: this.safeRecoveredCharacterSetupProjection(
          attempt.campaignId,
          route,
        ),
      };
    }
    if (state === undefined && canonicalCharacterSetupProbe) {
      const route = this.recoveredCurrentCharacterSetupRoute(
        attempt.campaignId,
        canonicalCharacterSetupInputMode ?? "guided_quick_fire",
      );
      this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "ready",
        attempt,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: (
          `canonical_character_setup_${canonicalCharacterSetupInputMode}_gate_rehydrated`
        ),
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_character_setup",
        modelProjection: this.safeRecoveredCharacterSetupProjection(
          attempt.campaignId,
          route,
        ),
      };
    }
    if (state === undefined && canonicalMaterializationProbe) {
      const route = this.recoveredSourceMaterializationRoute(
        attempt.campaignId,
        returnedGate?.source_lifecycle_status === "pending"
          ? null
          : objectOrNull(returnedGate?.next_operation),
        String(returnedGate?.instruction ?? ""),
      );
      this.initializeOpeningSetupState(
        attempt.campaignId,
        route,
        "materializing",
        attempt,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: "canonical_source_materialization_wait_rehydrated",
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_source_materialization",
      };
    }
    if (state === undefined && canonicalPreboundProbe) {
      const initialized = this.initializeOpeningSetupState(
        attempt.campaignId,
        preboundRoute,
        "selection",
        attempt,
      );
      // The canonical opening_selection phase is authoritative evidence that
      // chargen has already created and linked the investigator.
      initialized.characterSetupComplete = true;
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: "prebound_opening_selection_hydrated",
        campaign_id: attempt.campaignId,
        generation: attempt.generation,
        invocation_id: invocationId,
      });
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "prebound_opening_selection",
      };
    }
    if (
      state === undefined
      && this.unboundAttemptIsFresh(attempt)
      && returnedGate?.phase === "opening_source_contract_invalid"
    ) {
      state = this.initializeOpeningSetupState(
        attempt.campaignId,
        this.recoveryRoute(attempt.campaignId),
        "contract_invalid",
        attempt,
      );
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          { status: "terminal_failure", failure_class: "source_contract_invalid" },
          "opening_source_contract_invalid",
        ),
        undefined,
        attempt.campaignId,
        state,
      );
      this.finalizeOpeningSetupAttempt(invocationId);
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "source_contract_invalid",
      };
    }
    if (state === undefined && attempt.attemptClass === "probe") {
      this.finalizeOpeningSetupAttempt(invocationId);
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "non_route_result",
      };
    }
    if (!this.attemptMatchesState(attempt, state)) {
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "stale_generation_or_revision",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
        attempt_generation: attempt.generation,
        attempt_revision: attempt.revision,
        current_generation: state?.generation,
        current_revision: state?.revision,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "stale_generation_or_revision",
      };
    }

    if (returnedGate?.phase === "opening_source_contract_invalid") {
      this.supersedeOpeningSetupRevisionAttempts(state, invocationId);
      this.finalizeOpeningSetupAttempt(invocationId);
      const invalid = this.transitionContractInvalid(state, attempt);
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          { status: "terminal_failure", failure_class: "source_contract_invalid" },
          "opening_source_contract_invalid",
        ),
        undefined,
        attempt.campaignId,
        invalid,
      );
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "source_contract_invalid",
      };
    }

    if (attempt.attemptClass === "character") {
      this.finalizeOpeningSetupAttempt(invocationId);
      const setupArgs = objectOrNull(params.arguments);
      const linkAttempt = (
        operation === "setup.invoke"
        && setupArgs?.kind === "campaign.link_investigator"
      );
      const createAttempt = (
        operation === "setup.invoke"
        && setupArgs?.kind === "investigator.create"
      );
      let canonicalVisibleText = this.canonicalCharacterSetupVisibleText(
        operation,
        params,
        envelope,
        canonicalVisibleOutput,
      );
      const retainedBindBriefing = (
        setupArgs?.kind === "campaign.render_briefing"
        && canonicalVisibleText !== null
        && state.bindBriefing !== null
        && state.bindBriefing.campaignId === attempt.campaignId
        && state.bindBriefing.textSha256
          === canonicalJsonValueSha256(state.bindBriefing.text)
      )
        ? state.bindBriefing
        : null;
      if (retainedBindBriefing !== null) {
        canonicalVisibleText = retainedBindBriefing.text;
        this.recordOpeningSetupAudit({
          status: "retained",
          reason: "bind_briefing_owns_setup_generation",
          campaign_id: attempt.campaignId,
          generation: state.generation,
          invocation_id: invocationId,
          ignored_public_setup_sha256:
            canonicalVisibleOutput?.publicSetupSha256,
          retained_public_setup_sha256:
            retainedBindBriefing.publicSetupSha256,
        });
      }
      const acceptedCharacterResult = canonicalVisibleText !== null;
      if (createAttempt && acceptedCharacterResult) {
        const payload = objectOrNull(setupArgs?.payload);
        const creation = objectOrNull(payload?.creation);
        const investigatorId = typeof payload?.investigator_id === "string"
          ? payload.investigator_id
          : "";
        const expectedInputMode = (
          state.characterSetupInputMode ?? "guided_quick_fire"
        );
        if (
          investigatorId
          && payload?.campaign_id === attempt.campaignId
          && creation?.input_mode === expectedInputMode
        ) {
          state.guidedCreateReceipts.set(investigatorId, {
            campaignId: attempt.campaignId,
            investigatorId,
            generation: state.generation,
            revision: state.revision,
            invocationId: attempt.invocationId,
            receiptSha256: canonicalJsonValueSha256({
              tool: envelope?.tool,
              data: envelope?.data,
            }),
          });
          this.recordOpeningSetupAudit({
            status: "retained",
            reason: `${expectedInputMode}_create_current`,
            campaign_id: attempt.campaignId,
            investigator_id: investigatorId,
            generation: state.generation,
            revision: state.revision,
            invocation_id: attempt.invocationId,
          });
        }
      }
      if (
        linkAttempt
        && acceptedCharacterResult
        && this.linkMatchesCurrentGuidedCreates(params, state)
      ) {
        state.characterSetupComplete = true;
        if (state.phase === "reviewed") {
          this.armOpeningSelectionRoute(state);
        } else if (state.phase === "ready") {
          this.armOpeningEvidenceRoute(state);
        } else if (
          state.phase === "projection"
          && state.backgroundTerminalReceipt?.status === "fulfilled"
        ) {
          this.armOpeningProjectionRoute(state);
        }
        this.recordOpeningSetupAudit({
          status: "transitioned",
          transition: "character_setup_complete",
          campaign_id: attempt.campaignId,
          generation: state.generation,
          revision: state.revision,
          invocation_id: invocationId,
        });
      }
      if (acceptedCharacterResult) {
        const source = (
          canonicalVisibleOutput === null
            ? `${operation}:${String(setupArgs?.kind ?? operation)}`
            : retainedBindBriefing !== null
              ? (
                `${retainedBindBriefing.sourceKind}:`
                + retainedBindBriefing.publicSetupSha256
              )
            : (
              `${canonicalVisibleOutput.sourceKind}:`
              + canonicalVisibleOutput.publicSetupSha256
            )
        );
        if (
          operation === "setup.investigator_contract"
          || (
            setupArgs?.kind === "campaign.render_briefing"
            && (
            canonicalVisibleOutput !== null
            || retainedBindBriefing !== null
            )
          )
        ) {
          this.authorizeOpeningSetupConversationalOutput(
            state,
            attempt,
            source,
          );
        } else {
          this.authorizeOpeningSetupVisibleOutput(
            state,
            attempt,
            canonicalVisibleText,
            source,
          );
        }
      }
      return {
        accepted: acceptedCharacterResult,
        dispatchAllowed: false,
        reason: acceptedCharacterResult
          ? "character_setup_result"
          : "character_setup_failed",
      };
    }

    if (attempt.attemptClass !== "route") {
      this.finalizeOpeningSetupAttempt(invocationId);
      return {
        accepted: true,
        dispatchAllowed: false,
        reason: "non_route_result",
      };
    }
    if (operation === "evidence.table_opening") {
      this.finalizeOpeningSetupAttempt(invocationId);
      if (this.exactTableOpeningReceipt(envelope)) {
        let modelProjection: JsonObject;
        if (this.effectiveTypedRole() === "setup") {
          this.armSetupCompleteRoute(state);
          modelProjection = this.projectOpeningEvidenceRoute(
            envelope!,
            state.route,
          );
        } else {
          modelProjection = this.projectOpeningActivation(
            envelope!,
            state.activationCard,
          );
          this.clearOpeningSetupRoute(
            attempt.campaignId,
            state.generation,
          );
        }
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "opening_table_evidence_current",
          modelProjection,
        };
      }
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "opening_table_evidence_invalid",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "opening_table_evidence_invalid",
      };
    }
    if (operation === "setup.complete") {
      this.finalizeOpeningSetupAttempt(invocationId);
      if (attempt.agentTurn !== this.openingSetupAgentTurn) {
        const hasCurrentAttempt = [...this.openingSetupAttempts.values()].some(
          (candidate) => (
            candidate.campaignId === attempt.campaignId
            && candidate.agentTurn === this.openingSetupAgentTurn
          ),
        );
        if (!hasCurrentAttempt) {
          this.openingSetupContinuationQueued.delete(attempt.campaignId);
        }
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "opening_setup_handoff_late_agent_turn",
          campaign_id: attempt.campaignId,
          invocation_id: invocationId,
          attempt_agent_turn: attempt.agentTurn,
          current_agent_turn: this.openingSetupAgentTurn,
        });
        return {
          accepted: false,
          dispatchAllowed: false,
          reason: "opening_setup_handoff_late_agent_turn",
        };
      }
      const argumentsObject = objectOrNull(params.arguments);
      const decisionId = typeof argumentsObject?.decision_id === "string"
        ? argumentsObject.decision_id
        : "";
      const handoff = handoffFromEnvelope(envelope, {
        campaignId: attempt.campaignId,
        decisionId,
      });
      if (handoff !== null) {
        if (sessionRoleFromEnv() === null) {
          this.setEffectiveTypedRole("play");
          state.phase = "handoff_complete_waiting_resume";
          state.route = {
            ...state.route,
            phase: "opening_play_resume_required",
            next_operation: null,
            allowed_actions: undefined,
            instruction: (
              "the canonical setup handoff is complete; invoke the host-bound "
              + "session.resume before any play or opening operation"
            ),
          };
          state.revision += 1;
          state.continuationReleaseOwner = null;
          this.openingSetupContinuationQueued.delete(attempt.campaignId);
        } else {
          this.clearOpeningSetupRoute(
            attempt.campaignId,
            state.generation,
          );
        }
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "opening_setup_handoff_complete",
        };
      }
      this.openingSetupContinuationQueued.delete(attempt.campaignId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "opening_setup_handoff_invalid",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "opening_setup_handoff_invalid",
      };
    }
    if (operation === "progressive.prepare_opening") {
      const nextCard = objectOrNull(data?.next_operation);
      if (envelope?.ok === true && this.exactBootstrapCard(nextCard)) {
        this.supersedeOpeningSetupRevisionAttempts(state, invocationId);
        this.finalizeOpeningSetupAttempt(invocationId);
        const next: OpeningSetupState = {
          ...state,
          route: {
            ...state.route,
            phase: "opening_bootstrap_required",
            next_operation: nextCard,
            instruction: (
              "invoke this exact retained canonical opening bootstrap card; "
              + "do not rediscover, run main-KP OCR, or narrate first"
            ),
          },
          revision: state.revision + 1,
          phase: "bootstrap",
          dispatchIdentity: null,
          projectionCard: null,
          activationCard: null,
          bootstrapRetryCard: null,
          continuationReleaseOwner: null,
          backgroundTerminalReceipt: null,
        };
        this.openingSetupStates.set(attempt.campaignId, next);
        this.openingSetupVisibleOutputAuthorization = null;
        this.recordOpeningSetupAudit({
          status: "transitioned",
          transition: state.phase === "contract_invalid"
            ? "source_contract_revalidated"
            : "opening_selection_accepted",
          campaign_id: attempt.campaignId,
          generation: state.generation,
          from_revision: state.revision,
          to_revision: next.revision,
          invocation_id: invocationId,
        });
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "opening_prepare_accepted",
        };
      }
      this.finalizeOpeningSetupAttempt(invocationId);
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "opening_prepare_result_invalid",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          { status: "terminal_failure", failure_class: "prepare_result_invalid" },
          "opening_prepare_failed",
        ),
        undefined,
        attempt.campaignId,
        state,
      );
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "opening_prepare_result_invalid",
      };
    }

    if (operation === "progressive.opening_bootstrap") {
      // Canonical already decided the bootstrap outcome. Pi must not re-judge
      // status labels (queued/coalesced/capability_status routing tags): when
      // the envelope carries an exact coordinator task, dispatch it; when it
      // is still queued without a task, keep waiting — never terminal-fail a
      // live materialization as opening_source_failure.
      const task = findAutoDispatchTask(value);
      const packet = task ? objectOrNull(task.packet) : null;
      const dispatchIdentity = typeof packet?.packet_id === "string"
        ? packet.packet_id.trim()
        : "";
      if (dispatchIdentity) {
        attempt.dispatchIdentity = dispatchIdentity;
        state.dispatchIdentity = dispatchIdentity;
        return {
          accepted: true,
          dispatchAllowed: true,
          reason: "opening_bootstrap_dispatch_accepted",
        };
      }
      if (
        envelope?.ok === true
        && (data?.status === "complete" || data?.status === "current")
      ) {
        this.finalizeOpeningSetupAttempt(invocationId);
        if (state.characterSetupComplete) {
          this.armOpeningEvidenceRoute(state);
        } else {
          state.phase = "ready";
          state.route = {
            ...state.route,
            phase: "opening_current_character_setup_required",
            next_operation: null,
            allowed_actions: this.characterSetupAllowedActions(
              state.route.campaign_id,
            ),
            instruction: (
              "opening source projection is current; complete the exact "
              + "canonical investigator link before any live play"
            ),
          };
          state.continuationReleaseOwner = null;
        }
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: state.characterSetupComplete
            ? "opening_bootstrap_current"
            : "opening_bootstrap_current_waiting_for_character",
        };
      }
      if (this.postReadyBootstrapNoopFailure(attempt, state, error)) {
        this.finalizeOpeningSetupAttempt(invocationId);
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "post_ready_bootstrap_failure_ignored",
          campaign_id: attempt.campaignId,
          invocation_id: invocationId,
          error_code: error?.code,
        });
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "post_ready_bootstrap_noop",
        };
      }
      const sourceWork = objectOrNull(data?.source_work);
      const bootstrapStatus = String(
        sourceWork?.status ?? data?.status ?? "",
      );
      if (
        envelope?.ok === true
        && (bootstrapStatus === "queued" || bootstrapStatus === "coalesced")
      ) {
        // Live pending materialization. Do not mark a terminal blocker: the
        // host-work job is on disk and a later recoverability path (or a fixed
        // wire projection that restores the takeover) can still claim it.
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: "opening_bootstrap_queued_awaiting_dispatch",
        };
      }
      this.finalizeOpeningSetupAttempt(invocationId);
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          { status: "terminal_failure", failure_class: "bootstrap_result_invalid" },
        ),
        undefined,
        attempt.campaignId,
        state,
      );
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "opening_bootstrap_result_invalid",
      };
    }
    if (operation === "progressive.project_opening") {
      this.finalizeOpeningSetupAttempt(invocationId);
      if (
        envelope?.ok === true
        && (data?.status === "complete" || data?.status === "current")
      ) {
        state.activationCard = this.exactOpeningActivationCard(
          data.activation_operation,
        );
        if (state.characterSetupComplete) {
          this.armOpeningEvidenceRoute(state);
        } else {
          state.phase = "ready";
          state.route = {
            ...state.route,
            phase: "opening_current_character_setup_required",
            next_operation: null,
            instruction: (
              "opening source projection is current; complete the exact "
              + "canonical investigator link before any live play"
            ),
          };
          state.continuationReleaseOwner = null;
        }
        return {
          accepted: true,
          dispatchAllowed: false,
          reason: state.characterSetupComplete
            ? "opening_projection_current"
            : "opening_projection_current_waiting_for_character",
          ...(
            state.characterSetupComplete
              ? {
                  modelProjection: this.projectOpeningEvidenceRoute(
                    envelope,
                    state.route,
                  ),
                }
              : {}
          ),
        };
      }
      if (state.bootstrapRetryCard !== null) {
        this.restoreBackgroundRetryRoute(state);
      }
      this.markOpeningSetupTerminalBlocker(
        envelope ?? failedBlockingOpeningEnvelope(
          {
            status: "terminal_failure",
            failure_class: "opening_projection_not_current",
          },
          "opening_projection_not_current",
        ),
        state.dispatchIdentity ?? undefined,
        attempt.campaignId,
        state,
      );
      return {
        accepted: false,
        dispatchAllowed: false,
        reason: "opening_projection_not_current",
      };
    }
    this.finalizeOpeningSetupAttempt(invocationId);
    return {
      accepted: false,
      dispatchAllowed: false,
      reason: "route_operation_unhandled",
    };
  },


  claimOpeningContinuationRelease(this: any,
    state: OpeningSetupState,
    owner: "route" | "terminal",
  ): boolean {
    if (state.continuationReleaseOwner !== null) return false;
    state.continuationReleaseOwner = owner;
    return true;
  },


  releaseOpeningSetupContinuation(this: any,
    route: OpeningSetupRoute,
    owner: "route" | "terminal",
  ): void {
    const state = this.openingSetupStates.get(route.campaign_id);
    if (
      state === undefined
      || state.route !== route
      || state.continuationReleaseOwner !== owner
    ) {
      return;
    }
    state.continuationReleaseOwner = null;
    if (owner === "route") {
      this.openingSetupContinuationQueued.delete(route.campaign_id);
    }
  },


  releaseOpeningTerminalContinuation(this: any, dispatchKey: string): void {
    const state = [...this.openingSetupStates.values()].find(
      (candidate) => candidate.dispatchIdentity === dispatchKey,
    );
    if (state !== undefined) {
      this.releaseOpeningSetupContinuation(state.route, "terminal");
    }
  },


  requiredOpeningSetupContinuation(this: any): OpeningSetupRoute | null {
    const state = this.openingSetupStateForTranscript();
    if (
      state === null
      || state.route.next_operation === null
      || state.phase === "handoff_decision"
      || (
        (state.phase === "projection" || state.phase === "selection")
        && !state.characterSetupComplete
      )
      || this.openingSetupContinuationQueued.has(state.route.campaign_id)
      || this.openingSetupAuthorizationMatches(state)
      || !this.claimOpeningContinuationRelease(state, "route")
    ) {
      return null;
    }
    this.openingSetupContinuationQueued.add(state.route.campaign_id);
    return state.route;
  },


  openingTableDecisionContext(this: any): JsonObject | null {
    const state = this.openingSetupStateForTranscript();
    if (
      state !== null
      && state.characterSetupComplete
      && state.phase === "handoff_decision"
      && state.route.next_operation?.operation === "setup.complete"
    ) {
      return {
        schema_version: 1,
        campaign_id: state.route.campaign_id,
        phase: state.route.phase,
        player_decision_required: true,
        instruction: (
          "Judge the player's latest message semantically. If they confirm "
          + "opening the table, the first and only tool call is the exact "
          + "model-visible typed tool named typed_tool using the exact "
          + "next_operation card below. Supply every missing model-owned "
          + "argument. If they request a revision, do not invoke "
          + "setup.complete; remain in setup and handle only that revision."
        ),
        typed_tool: typedToolNameForOperation("setup.complete"),
        next_operation: structuredClone(state.route.next_operation),
      };
    }
    if (
      state === null
      || !state.characterSetupComplete
      || state.phase !== "selection"
      || state.route.next_operation?.operation !== "progressive.prepare_opening"
    ) return null;
    return {
      schema_version: 1,
      campaign_id: state.route.campaign_id,
      phase: state.route.phase,
      player_decision_required: true,
      instruction: (
        "Judge the player's latest message semantically. If they confirm opening "
        + "the table, invoke the exact retained next_operation now with the "
        + "model-visible typed tool named typed_tool. If they ask "
        + "to revise the investigator, do not invoke it; handle the revision in setup."
      ),
      typed_tool: typedToolNameForOperation("progressive.prepare_opening"),
      next_operation: structuredClone(state.route.next_operation),
    };
  },


  clearOpeningSetupRoute(this: any,
    campaignId?: string | null,
    generation?: string,
  ): void {
    if (campaignId) {
      const state = this.openingSetupStates.get(campaignId);
      if (state === undefined || (generation && state.generation !== generation)) {
        this.recordOpeningSetupAudit({
          status: "ignored",
          reason: "clear_generation_mismatch",
          campaign_id: campaignId,
          generation,
        });
        return;
      }
      this.openingSetupRetiredGeneration.set(
        campaignId,
        this.openingSetupLatestIssuedGeneration.get(campaignId)
          ?? state.generationSequence,
      );
      for (const attempt of [...this.openingSetupAttempts.values()]) {
        if (attempt.campaignId === campaignId) {
          this.finalizeOpeningSetupAttempt(attempt.invocationId);
        }
      }
      this.openingSetupStates.delete(campaignId);
      this.setupHandoffDecisionPlayerEpoch.delete(campaignId);
      this.openingSetupContinuationQueued.delete(campaignId);
      this.openingSetupTerminalBlockers.delete(campaignId);
      if (
        this.openingSetupVisibleOutputAuthorization?.campaignId === campaignId
      ) {
        this.openingSetupVisibleOutputAuthorization = null;
      }
      this.pruneOpeningSetupCampaign(campaignId);
      return;
    }
    this.openingSetupStates.clear();
    this.setupHandoffDecisionPlayerEpoch.clear();
    this.openingSetupAttempts.clear();
    this.openingSetupLatestIssuedGeneration.clear();
    this.openingSetupRetiredGeneration.clear();
    this.openingSetupContinuationQueued.clear();
    this.openingSetupTerminalBlockers.clear();
    this.openingSetupVisibleOutputAuthorization = null;
    this.openingSetupTurnCampaignId = null;
    this.openingSetupTurnCampaignAmbiguous = false;
    this.deliveredOpeningSetupTerminalBlocker = null;
  },


  markOpeningSetupTerminalBlocker(this: any,
    envelope: JsonObject,
    dispatchKey?: string,
    campaignId?: string | null,
    expectedState?: OpeningSetupState,
  ): void {
    const state = campaignId
      ? this.openingSetupStates.get(campaignId)
      : this.openingSetupStateForTranscript();
    if (
      state === undefined
      || state === null
      || (
        expectedState !== undefined
        && (
          state.generation !== expectedState.generation
          || state.revision !== expectedState.revision
        )
      )
      || (
        dispatchKey
        && state.dispatchIdentity
        && state.dispatchIdentity !== dispatchKey
      )
    ) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "terminal_state_or_dispatch_mismatch",
        campaign_id: campaignId,
        dispatch_key: dispatchKey,
      });
      return;
    }
    const error = objectOrNull(envelope.error);
    const data = objectOrNull(envelope.data);
    const terminal = objectOrNull(data?.coordinator_terminal);
    const failureClass = typeof terminal?.failure_class === "string"
      ? terminal.failure_class
      : typeof error?.code === "string" ? error.code : "opening_source_failure";
    const blocker = {
      schema_version: 1,
      status: "blocked",
      hard_gate: true,
      activation_allowed: false,
      phase: "opening_source_terminal_blocker",
      campaign_id: state.route.campaign_id,
      generation: state.generation,
      revision: state.revision,
      failure_class: failureClass,
      error_code: typeof error?.code === "string"
        ? error.code
        : "opening_source_terminal_failure",
      ...(dispatchKey ? { dispatch_key: dispatchKey } : {}),
      next_operation: state.route.next_operation,
      instruction: (
        "开场来源处理未完成，游戏尚未开始。保留当前来源证据，并仅按 "
        + "next_operation 的精确卡片重试或恢复；不要虚构开场。"
      ),
    };
    const cancelled = (
      blocker.error_code === "opening_source_wait_cancelled"
      || blocker.error_code === "opening_projection_cancelled"
      || blocker.failure_class === "coordinator_wait_cancelled"
    );
    this.openingSetupTerminalBlockers.set(state.route.campaign_id, {
      visibleText: cancelled
        ? (
          "开场资料解析已取消，游戏尚未开始。系统保留了当前进度；"
          + "你可以稍后重试原来的开场步骤，在资料就绪前不会自行编写剧情。"
        )
        : (
          "开场资料解析失败，游戏尚未开始。系统保留了当前进度；"
          + "你可以重试原来的开场步骤，在资料就绪前不会自行编写剧情。"
        ),
      details: blocker,
    });
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
    state.continuationReleaseOwner = null;
    this.openingSetupVisibleOutputAuthorization = null;
    if (!this.queuedVisibleDispositions.some((queued) => (
      queued.disposition === "terminal_blocker"
      && (dispatchKey === undefined || queued.dispatchKey === dispatchKey)
    ))) {
      this.queueVisibleAssistantDisposition("terminal_blocker", dispatchKey);
    }
  },


  postReadyBootstrapNoopFailure(this: any,
    attempt: OpeningSetupAttempt,
    state: OpeningSetupState,
    error: JsonObject | null,
  ): boolean {
    return (
      attempt.operation === "progressive.opening_bootstrap"
      && state.phase === "ready"
      && (
        error?.code === "invalid_param"
        || error?.code === "opening_bootstrap_non_pristine"
      )
    );
  },


  markOpeningSetupRouteAttemptFailure(this: any,
    invocationId: string,
    params: JsonObject,
    envelope: JsonObject,
    dispatchKey?: string,
  ): void {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    const failureEnvelope = objectOrNull(envelope);
    const failureData = objectOrNull(failureEnvelope?.data);
    const failureError = objectOrNull(failureEnvelope?.error);
    const failureDetails = objectOrNull(failureError?.details);
    const returnedGate = objectOrNull(failureData?.opening_gate)
      ?? (failureDetails?.hard_gate === true ? failureDetails : null);
    const identityMatches = (
      attempt !== undefined
      && attempt.attemptClass === "route"
      && this.attemptMatchesState(attempt, state)
      && attempt.operation === params.operation
      && params.campaign === attempt.campaignId
      && !this.resultCampaignMismatch(
        attempt,
        failureEnvelope,
        returnedGate,
      )
      && (
        dispatchKey !== undefined
        ? attempt.dispatchIdentity === dispatchKey
        : true
      )
    );
    if (attempt !== undefined) {
      this.finalizeOpeningSetupAttempt(invocationId);
    }
    if (!identityMatches || attempt === undefined || state === undefined) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "failed_attempt_identity_mismatch",
        invocation_id: invocationId,
        dispatch_key: dispatchKey,
      });
      return;
    }
    if (this.postReadyBootstrapNoopFailure(attempt, state, failureError)) {
      this.recordOpeningSetupAudit({
        status: "ignored",
        reason: "post_ready_bootstrap_failure_ignored",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
        dispatch_key: dispatchKey,
        error_code: failureError?.code,
      });
      return;
    }
    if (
      sessionRoleFromEnv() === null
      && attempt.operation === "setup.complete"
      && state.phase === "handoff_decision"
      && state.route.next_operation?.operation === "setup.complete"
    ) {
      state.continuationReleaseOwner = null;
      this.openingSetupContinuationQueued.delete(attempt.campaignId);
      this.recordOpeningSetupAudit({
        status: "retained",
        reason: "setup_handoff_transport_retry_retained",
        campaign_id: attempt.campaignId,
        invocation_id: invocationId,
      });
      return;
    }
    if (["submitting", "materializing", "projection"].includes(state.phase)) {
      this.restoreBackgroundRetryRoute(state);
    }
    this.markOpeningSetupTerminalBlocker(
      envelope,
      dispatchKey,
      attempt.campaignId,
      state,
    );
  },


  openingSetupDispatchOwned(this: any,
    invocationId: string,
    params: JsonObject,
    dispatchKey: string,
  ): boolean {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    return (
      attempt !== undefined
      && attempt.attemptClass === "route"
      && attempt.operation === "progressive.opening_bootstrap"
      && params.operation === attempt.operation
      && params.campaign === attempt.campaignId
      && this.attemptMatchesState(attempt, state)
      && attempt.dispatchIdentity === dispatchKey
      && state.dispatchIdentity === dispatchKey
    );
  },


  releaseOpeningSetupDispatchOwnership(this: any,
    invocationId: string,
    dispatchKey: string,
  ): void {
    const attempt = this.finalizeOpeningSetupAttempt(invocationId);
    this.recordOpeningSetupAudit({
      status: "ignored",
      reason: "opening_dispatch_ownership_lost",
      invocation_id: invocationId,
      campaign_id: attempt?.campaignId,
      generation: attempt?.generation,
      revision: attempt?.revision,
      dispatch_key: dispatchKey,
    });
  },


  beginOpeningBackground(this: any,
    invocationId: string,
    params: JsonObject,
    dispatchKey: string,
    projectionParams: JsonObject,
  ): boolean {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    const projectionArguments = objectOrNull(projectionParams.arguments);
    if (
      attempt === undefined
      || state === undefined
      || attempt.attemptClass !== "route"
      || attempt.operation !== "progressive.opening_bootstrap"
      || !this.attemptMatchesState(attempt, state)
      || attempt.dispatchIdentity !== dispatchKey
      || state.dispatchIdentity !== dispatchKey
      || projectionParams.operation !== "progressive.project_opening"
      || projectionParams.campaign !== attempt.campaignId
      || projectionArguments === null
    ) {
      return false;
    }
    state.phase = "submitting";
    state.continuationReleaseOwner = null;
    state.backgroundTerminalReceipt = null;
    state.activationCard = null;
    state.bootstrapRetryCard = state.route.next_operation;
    state.projectionCard = {
      operation: "progressive.project_opening",
      invoke_via: "coc_invoke",
      prefilled_arguments: projectionArguments,
      missing_arguments: [],
      hard_gate: true,
      authority: "canonical_setup",
    };
    state.route = {
      ...state.route,
      phase: "opening_source_materialization",
      next_operation: null,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
      ),
      instruction: (
        "opening source materialization is running in the background; "
        + "continue normal character creation, but do not enter live play"
      ),
    };
    this.trackOpeningDispatch(dispatchKey);
    this.recordOpeningSetupAudit({
      status: "transitioned",
      transition: "opening_background_started",
      campaign_id: attempt.campaignId,
      generation: state.generation,
      revision: state.revision,
      invocation_id: invocationId,
      dispatch_key: dispatchKey,
    });
    return true;
  },


  markOpeningBackgroundSubmitted(this: any,
    invocationId: string,
    params: JsonObject,
    dispatchKey: string,
  ): OpeningBackgroundSubmissionDisposition {
    const attempt = this.openingSetupAttempts.get(invocationId);
    const state = typeof params.campaign === "string"
      ? this.openingSetupStates.get(params.campaign)
      : undefined;
    if (
      attempt === undefined
      || state === undefined
      || attempt.attemptClass !== "route"
      || !this.attemptMatchesState(attempt, state)
      || attempt.dispatchIdentity !== dispatchKey
    ) {
      return { status: "stale" };
    }
    const terminalReceipt = state.backgroundTerminalReceipt;
    if (
      terminalReceipt !== null
      && terminalReceipt.packet_id === dispatchKey
      && ["projection", "retry"].includes(state.phase)
    ) {
      this.finalizeOpeningSetupAttempt(invocationId);
      return { status: "terminal", receipt: terminalReceipt };
    }
    if (
      state.dispatchIdentity !== dispatchKey
      || state.phase !== "submitting"
    ) {
      return { status: "stale" };
    }
    state.phase = "materializing";
    this.recordOpeningSetupAudit({
      status: "transitioned",
      transition: "opening_background_submitted",
      campaign_id: attempt.campaignId,
      generation: state.generation,
      revision: state.revision,
      invocation_id: invocationId,
      dispatch_key: dispatchKey,
    });
    return { status: "submitted" };
  },


  observeOpeningCoordinatorTerminal(this: any, receipt: JsonObject): void {
    const dispatchKey = typeof receipt.packet_id === "string"
      ? receipt.packet_id.trim()
      : "";
    if (!dispatchKey) return;
    const state = [...this.openingSetupStates.values()].find(
      (candidate) => candidate.dispatchIdentity === dispatchKey,
    );
    if (
      state === undefined
      || !["submitting", "materializing"].includes(state.phase)
    ) return;
    const attempt = [...this.openingSetupAttempts.values()].find(
      (candidate) => candidate.dispatchIdentity === dispatchKey,
    );
    state.backgroundTerminalReceipt = receipt;
    if (attempt !== undefined && state.phase !== "submitting") {
      this.finalizeOpeningSetupAttempt(attempt.invocationId);
    }
    if (
      receipt.status === "fulfilled"
      && state.projectionCard !== null
    ) {
      if (state.characterSetupComplete) {
        this.armOpeningProjectionRoute(state);
      } else {
        this.retainOpeningProjectionUntilCharacterLink(state);
      }
      this.recordOpeningSetupAudit({
        status: "transitioned",
        transition: "opening_background_fulfilled",
        campaign_id: state.route.campaign_id,
        generation: state.generation,
        revision: state.revision,
        dispatch_key: dispatchKey,
      });
      return;
    }
    this.restoreBackgroundRetryRoute(state);
    this.markOpeningSetupTerminalBlocker(
      failedBlockingOpeningEnvelope(
        receipt,
        "opening_source_terminal_failure",
      ),
      dispatchKey,
      state.route.campaign_id,
      state,
    );
  },


  rememberReviewedAdoptFacts(this: any, receipt: JsonObject): void {
    if (receipt.status !== "reviewed") return;
    const campaignId = String(receipt.campaign_id ?? "");
    if (!campaignId || !validOpeningTransportFacts(receipt.facts)) return;
    this.retainedAdoptSourceFacts.set(
      campaignId,
      structuredClone(receipt.facts),
    );
  },


  bindRetainedAdoptSourceFacts(this: any, params: JsonObject): JsonObject {
    const args = objectOrNull(params.arguments);
    const campaignId = this.setupInvocationCampaignId(params)
      ?? (
        typeof args?.campaign_id === "string" && args.campaign_id
          ? args.campaign_id
          : null
      );
    const retained = campaignId
      ? this.retainedAdoptSourceFacts.get(campaignId)
      : undefined;
    // The review transport already sealed the only source-facts payload this
    // transition may consume.  Some model/provider combinations still
    // stringify the generic gateway's nested arguments and can emit malformed
    // JSON for this large card.  Once the retained card and campaign identity
    // agree, discard that untrusted transport spelling and rebuild the small
    // canonical arguments object.  This is intentionally limited to the
    // retained adopt transition; arbitrary malformed invoke arguments remain
    // rejected by normalizePiCocInvokeArguments.
    if (
      params.operation === "setup.adopt_source_facts"
      && campaignId
      && retained !== undefined
      && typeof params.arguments === "string"
    ) {
      return {
        ...params,
        campaign: campaignId,
        arguments: {
          campaign_id: campaignId,
          facts: structuredClone(retained),
        },
      };
    }
    return applyRetainedAdoptSourceFacts(params, retained) as JsonObject;
  },


  bindRetainedOpeningRoute(this: any, params: JsonObject): JsonObject {
    if (typeof params.operation !== "string" || typeof params.campaign === "string") {
      return params;
    }
    const state = this.openingSetupStateForTranscript();
    if (
      state === null
      || !state.characterSetupComplete
      || state.route.next_operation?.operation !== params.operation
    ) return params;
    return {
      ...params,
      campaign: state.route.campaign_id,
    };
  },


  prepareSetupCompleteArguments(this: any, value: unknown): unknown {
    const args = objectOrNull(value);
    if (
      args === null
      || args.decision_id !== undefined
      || typeof args.campaign_id !== "string"
      || !args.campaign_id.trim()
      || (
        args.campaign !== undefined
        && args.campaign !== args.campaign_id
      )
    ) return value;
    const campaignId = args.campaign_id.trim();
    const state = this.openingSetupStates.get(campaignId);
    const card = state?.route.next_operation;
    const prefilled = objectOrNull(card?.prefilled_arguments);
    const missing = Array.isArray(card?.missing_arguments)
      ? card.missing_arguments
      : null;
    if (
      state === undefined
      || !state.characterSetupComplete
      || state.phase !== "handoff_decision"
      || state.route.campaign_id !== campaignId
      || card?.operation !== "setup.complete"
      || missing === null
      || missing.length !== 0
      || prefilled?.campaign_id !== campaignId
      || typeof prefilled.decision_id !== "string"
      || !prefilled.decision_id
    ) return value;
    return {
      ...args,
      decision_id: prefilled.decision_id,
    };
  },


  bindNoSelectorSetupCompleteInvocation(
    this: any,
    value: unknown,
    workspaceRoot: string,
  ): unknown {
    const params = objectOrNull(value);
    if (params === null || params.operation !== "setup.complete") return value;
    const args = objectOrNull(params.arguments);
    if (
      args === null
      || !exactKeysMatch(args, ["campaign_id", "decision_id"])
      || typeof args.campaign_id !== "string"
      || !args.campaign_id.trim()
      || typeof args.decision_id !== "string"
      || !args.decision_id.trim()
      || !NO_SELECTOR_SETUP_COMPLETE_DECISION_ID_RE.test(
        args.decision_id.trim(),
      )
      || params.root !== undefined
    ) {
      throw new Error(
        "invalid_model_argument: setup.complete requires model-owned campaign_id and decision_id; root/campaign are host-owned",
      );
    }
    const state = this.openingSetupStateForTranscript();
    const card = state?.route.next_operation;
    const prefilled = objectOrNull(card?.prefilled_arguments);
    const missing = Array.isArray(card?.missing_arguments)
      ? card.missing_arguments
      : null;
    if (
      state === null
      || !state.characterSetupComplete
      || state.phase !== "handoff_decision"
      || card?.operation !== "setup.complete"
      || missing === null
      || missing.length !== 0
      || prefilled?.campaign_id !== state.route.campaign_id
      || typeof prefilled.decision_id !== "string"
      || !prefilled.decision_id
      || args.campaign_id.trim() !== state.route.campaign_id
      || args.decision_id.trim() !== prefilled.decision_id
      || params.campaign !== state.route.campaign_id
    ) return value;
    return {
      operation: "setup.complete",
      root: resolve(workspaceRoot),
      campaign: state.route.campaign_id,
      arguments: {
        campaign_id: state.route.campaign_id,
        decision_id: prefilled.decision_id,
      },
    };
  },


  observeOpeningSourceReviewTransport(this: any,
    receipt: JsonObject,
  ): OpeningSetupRoute | null {
    this.rememberReviewedAdoptFacts(receipt);
    const campaignId = String(receipt.campaign_id ?? "");
    const state = this.openingSetupStates.get(campaignId);
    if (state === undefined || state.phase !== "source_review") return null;
    if (receipt.status === "reviewed") {
      if (state.characterSetupComplete) {
        this.armOpeningSelectionRoute(state);
      } else {
        this.retainReviewedSourceUntilCharacterLink(state);
      }
      return structuredClone(state.route);
    }
    this.markOpeningSetupTerminalBlocker(
      failedBlockingOpeningEnvelope(
        receipt, "opening_source_review_terminal_failure",
      ),
      undefined, campaignId, state,
    );
    return null;
  },


  restoreBackgroundRetryRoute(this: any, state: OpeningSetupState): void {
    state.phase = "retry";
    state.route = {
      ...state.route,
      phase: "opening_bootstrap_required",
      next_operation: state.bootstrapRetryCard,
      allowed_actions: this.characterSetupAllowedActions(
        state.route.campaign_id,
      ),
      instruction: (
        "opening background failed; preserve evidence and retry only this "
        + "exact retained bootstrap card"
      ),
    };
    state.dispatchIdentity = null;
    state.projectionCard = null;
    state.activationCard = null;
    state.continuationReleaseOwner = null;
    this.openingSetupContinuationQueued.delete(state.route.campaign_id);
  },


  takeDeliveredOpeningSetupTerminalBlocker(this: any): JsonObject | null {
    const details = this.deliveredOpeningSetupTerminalBlocker;
    this.deliveredOpeningSetupTerminalBlocker = null;
    return details;
  },


  trackOpeningDispatch(this: any, dispatchKey: string): void {
    if (dispatchKey) {
      this.states.set(dispatchKey, "awaiting");
      // The key comes from the structured opening_bootstrap takeover packet,
      // so later terminal continuations can distinguish this blocking opening
      // from an unrelated background coordinator completion.
      this.dispatchClasses.set(dispatchKey, "blocking_opening");
    }
  },
  };
}

export type OpeningSetupMachineMethods = ReturnType<
  typeof createOpeningSetupMachineMethods
>;
