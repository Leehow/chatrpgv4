#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import "./_lib/preload-embedded-pi.mjs";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const root = path.resolve(process.argv[2] || process.cwd());
const guidanceMod = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/recovery-guidance.ts")).href
);
const main = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);
const {
  PiStateClaimCompiler,
  canonicalDigest,
  draftParagraphs,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/state-claim-compiler.ts")
);

const {
  applyAcknowledgedResumeRecoveryGuidance,
  applyPendingFinalizationRecoveryGuidance,
  applyOpenTurnRecoveryGuidance,
  buildDraftShapeRecoveryCard,
  canonicalDraftParagraphs,
  draftShapePayloadDigest,
  hasReviewEvidenceEntry,
  isDraftShapePlacementFailure,
  isDraftShapeRecoveryCard,
  isDraftShapeRecoveryReplayUnchanged,
  isFrozenFinalizePayload,
  isPendingFinalizationResume,
  isOpenTurnRecoveryResume,
  pendingFinalizationInlineCardsComplete,
  placementFailureRollIds,
  selectRecoverableDraftShapeCard,
  validateLiveOutputContext,
  DRAFT_SHAPE_RECOVERY_COMPLETE_AUDIT,
  DRAFT_SHAPE_RECOVERY_CARD_AUDIT,
  DRAFT_SHAPE_RECOVERY_CARD_CONTRACT,
  DRAFT_SHAPE_RECOVERY_SEAL_AUDIT,
  NARRATION_REVIEW_EVIDENCE_AUDIT,
  OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT,
  OPEN_TURN_RECOVERY_GUIDANCE_AUDIT,
  OPEN_TURN_RECOVERY_CLOSURE_SEQUENCE,
  OPEN_TURN_RECOVERY_FORBIDDEN_UNTIL_CLOSED,
  PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
  PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT,
  HOST_BOUND_FINALIZE_ARGUMENTS,
} = guidanceMod;

// This harness drives the root KP extension surface directly. A worker-shell
// PI_SUBAGENT_CHILD=1 would silence applyKpActiveTools/setActiveTools and
// make the active-tool quarantine unobservable.
delete process.env.PI_SUBAGENT_CHILD;

function resumeEnvelope(mode, extra = {}) {
  return {
    ok: true,
    tool: "session.resume",
    data: {
      schema_version: 1,
      campaign_id: extra.campaign_id ?? "recovery-guide-campaign",
      mode,
      next_operations: extra.next_operations ?? [],
      current_turn: extra.current_turn ?? { rows: [{ tool: "rules.roll", ok: true }] },
    },
  };
}

assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("open_turn_recovery", {
    next_operations: ["continue_current_turn_from_receipts"],
  })),
  true,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("open_turn_recovery")),
  true,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("awaiting_player", {
    next_operations: ["interpret_current_player_message"],
  })),
  false,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("table_opening", {
    next_operations: ["evidence.table_opening"],
  })),
  false,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("pending_finalization", {
    next_operations: ["turn.finalize"],
  })),
  false,
);
assert.equal(
  isOpenTurnRecoveryResume(resumeEnvelope("table_opening", {
    next_operations: ["continue_current_turn_from_receipts"],
  })),
  false,
);
assert.equal(
  isOpenTurnRecoveryResume({
    ok: false,
    tool: "session.resume",
    data: { mode: "open_turn_recovery" },
  }),
  false,
);

const attached = applyOpenTurnRecoveryGuidance(resumeEnvelope("open_turn_recovery", {
  next_operations: ["continue_current_turn_from_receipts"],
}));
assert.equal(attached.attached, true);
const guidance = attached.envelope.data.host_recovery_guidance;
assert.equal(guidance.contract_id, OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT);
assert.equal(guidance.schema_version, 1);
assert.equal(guidance.audience, "keeper_only");
assert.equal(guidance.mode, "open_turn_recovery");
assert.equal(guidance.current_acl_supersedes_prior_denials, true);
assert.deepEqual(
  guidance.closure_sequence.map((row) => row.operation),
  OPEN_TURN_RECOVERY_CLOSURE_SEQUENCE.map((row) => row.operation),
);
assert.deepEqual(
  guidance.forbidden_until_closed,
  [...OPEN_TURN_RECOVERY_FORBIDDEN_UNTIL_CLOSED],
);
assert.equal(guidance.after_closure, "adjudicate_unsettled_player_action");
assert.ok(guidance.keep.includes("kp_semantic_judgment"));
assert.ok(guidance.keep.includes("rule4"));
assert.ok(guidance.do_not.includes("fixed_narrative_template"));
assert.equal(
  Object.keys(attached.envelope.data)[0],
  "host_recovery_guidance",
);
assert.equal(applyOpenTurnRecoveryGuidance(resumeEnvelope("table_opening")).attached, false);
assert.equal(applyOpenTurnRecoveryGuidance(resumeEnvelope("awaiting_player")).attached, false);
assert.equal(
  applyOpenTurnRecoveryGuidance(resumeEnvelope("pending_finalization")).attached,
  false,
);
const pendingDirectEnvelope = resumeEnvelope("pending_finalization", {
  next_operations: ["turn.finalize"],
});
pendingDirectEnvelope.data.semantic_capsule = {
  recent_summaries: ["large unrelated recovery projection".repeat(200)],
};
pendingDirectEnvelope.data.pending_output_context = {
  journal_decision_id: "journal:pending",
  required_obligation_ids: ["obligation-1"],
  mechanics_bundle: { large: "mechanics".repeat(200) },
};
assert.equal(isPendingFinalizationResume(pendingDirectEnvelope), true);
assert.equal(
  isPendingFinalizationResume(resumeEnvelope("pending_finalization", {
    next_operations: ["state.exceptional_effect", "turn.finalize"],
  })),
  false,
  "host must not skip a canonical exceptional-effect blocker",
);
const pendingDirect = applyPendingFinalizationRecoveryGuidance(
  pendingDirectEnvelope,
  { root, campaign: "recovery-guide-campaign" },
);
assert.equal(pendingDirect.attached, true);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.contract_id,
  PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
);
assert.deepEqual(
  pendingDirect.envelope.data.host_recovery_guidance.next_call,
  {
    tool: "coc_turn_output_context",
    arguments: { root, campaign: "recovery-guide-campaign" },
  },
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.exact_card_path,
  "coc_turn_output_context.data.agency_review_operation",
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.tool,
  "coc_narration_review",
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.armed,
  false,
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.revision,
  null,
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.instruction.includes(
    "revision-1",
  ),
  false,
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.review_recovery.instruction.includes(
    "host-provided revision",
  ),
  true,
);
const pendingRevisionTwo = applyPendingFinalizationRecoveryGuidance(
  pendingDirectEnvelope,
  { root, campaign: "recovery-guide-campaign" },
  { reviewRecoveryArmed: true, revision: 2 },
);
assert.equal(
  pendingRevisionTwo.envelope.data.host_recovery_guidance.review_recovery.revision,
  2,
);
assert.equal(
  pendingRevisionTwo.envelope.data.host_recovery_guidance.review_recovery.armed,
  true,
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.then.exact_card_path,
  "coc_turn_output_context.data.finalize_operation",
);
assert.equal(
  pendingDirect.envelope.data.host_recovery_guidance.then.instruction.includes(
    "do not construct, infer, or reuse turn.finalize arguments",
  ),
  true,
);
assert.deepEqual(
  Object.keys(pendingDirect.envelope.data).sort(),
  [
    "campaign_id",
    "host_recovery_guidance",
    "mode",
    "next_operations",
    "pending_output_context",
    "schema_version",
  ],
);
assert.equal(pendingDirect.envelope.data.semantic_capsule, undefined);
assert.deepEqual(
  pendingDirect.envelope.data.pending_output_context,
  {
    status: "read_via_exact_typed_call",
    next_call: {
      tool: "coc_turn_output_context",
      arguments: { root, campaign: "recovery-guide-campaign" },
    },
  },
);
// No canonical cards supplied → no card fields fabricated, fallback intact.
assert.equal(pendingDirect.envelope.data.host_recovery_guidance.card_projection, undefined);
assert.equal(pendingDirect.envelope.data.host_recovery_guidance.review_recovery.card, undefined);
assert.equal(pendingDirect.envelope.data.host_recovery_guidance.then.card, undefined);
assert.deepEqual(pendingDirect.audit.operation_cards, {
  agency_review_operation: false,
  finalize_operation: false,
});

// ---- exact canonical operation cards survive projection verbatim ----
// Fixtures mirror the kernel producer (coc_operation_turn_output.py
// _tool_turn_output_context) and the wire projection (coc_mcp_wire.py),
// including optional extras (span_repairs, argument_contract) that must be
// carried through byte/structure-identical without whitelist loss.
const reviewCardFixture = () => ({
  operation: "narration.review",
  invoke_via: "coc_narration_review",
  prefilled_arguments: {
    turn_id: "turn-v1-7b5c8d72",
    source_digest: "sha256:a10b9171f3c2",
    revision: 1,
  },
  missing_arguments: [
    "decision_id", "draft_text", "findings", "state_authority_review",
  ],
  discovery_required: false,
  authority: "semantic_agency_and_player_state_review",
  hard_gate_scope: "agency_and_player_state_authority_only",
  host_state_claim_compiler_required: true,
  span_repairs: [{ span: "cupboard-reveal", repaired_revision: 1 }],
});
const finalizeCardFixture = () => ({
  operation: "turn.finalize",
  invoke_via: "coc_turn_finalize",
  prefilled_arguments: {
    decision_id: "bc1419c9:player-epoch-7:revision-2:finalize",
    revision: 2,
    coverage: [],
  },
  missing_arguments: [
    "draft", "coverage", "narration_review_id", "agency_claims",
  ],
  discovery_required: false,
  authority: "settled_output_completeness",
  hard_gate: true,
  argument_contract: {
    required_arguments: [
      "draft", "coverage", "decision_id", "revision",
      "narration_review_id", "agency_claims",
    ],
    allowed_arguments: [
      "draft", "coverage", "decision_id", "revision",
      "narration_review_id", "agency_claims", "advisory_uptake",
    ],
    forbidden_aliases: ["draft_text", "journal_decision_id"],
  },
});

const cardsEnvelope = resumeEnvelope("pending_finalization", {
  next_operations: ["turn.finalize"],
});
cardsEnvelope.data.pending_output_context = {
  journal_decision_id: "bc1419c9:player-epoch-7:revision-2",
  agency_review_operation: reviewCardFixture(),
  finalize_operation: finalizeCardFixture(),
};
const cardsGuided = applyPendingFinalizationRecoveryGuidance(
  cardsEnvelope,
  { root, campaign: "recovery-guide-campaign" },
  { reviewRecoveryArmed: true, revision: 1 },
);
assert.equal(cardsGuided.attached, true);
// 1. exact narration-review card: typed tool + prefilled + missing args survive
//    byte/structure-identical.
assert.deepEqual(
  cardsGuided.envelope.data.host_recovery_guidance.review_recovery.card,
  reviewCardFixture(),
);
assert.equal(
  JSON.stringify(cardsGuided.envelope.data.host_recovery_guidance.review_recovery.card),
  JSON.stringify(reviewCardFixture()),
);
assert.equal(
  cardsGuided.envelope.data.host_recovery_guidance.review_recovery.card.invoke_via,
  "coc_narration_review",
);
// 2. exact finalize card survives projection identically.
assert.deepEqual(
  cardsGuided.envelope.data.host_recovery_guidance.then.card,
  finalizeCardFixture(),
);
assert.equal(
  JSON.stringify(cardsGuided.envelope.data.host_recovery_guidance.then.card),
  JSON.stringify(finalizeCardFixture()),
);
assert.equal(
  cardsGuided.envelope.data.host_recovery_guidance.then.card.invoke_via,
  "coc_turn_finalize",
);
// 3. Existing next_call/summary behavior remains; exact cards are additive.
assert.deepEqual(
  cardsGuided.envelope.data.host_recovery_guidance.next_call,
  {
    tool: "coc_turn_output_context",
    arguments: { root, campaign: "recovery-guide-campaign" },
  },
);
assert.equal(
  cardsGuided.envelope.data.host_recovery_guidance.review_recovery.exact_card_path,
  "coc_turn_output_context.data.agency_review_operation",
);
assert.equal(
  cardsGuided.envelope.data.host_recovery_guidance.review_recovery.armed,
  true,
);
assert.equal(
  cardsGuided.envelope.data.host_recovery_guidance.review_recovery.revision,
  1,
);
assert.deepEqual(
  cardsGuided.envelope.data.host_recovery_guidance.card_projection,
  {
    source: "session.resume.pending_output_context",
    authoritative_copy: "coc_turn_output_context",
    instruction: cardsGuided.envelope.data.host_recovery_guidance.card_projection.instruction,
  },
);
assert.equal(
  cardsGuided.envelope.data.host_recovery_guidance.card_projection
    .instruction.includes("fresh cards are authoritative"),
  true,
);
assert.deepEqual(cardsGuided.audit.operation_cards, {
  agency_review_operation: true,
  finalize_operation: true,
});
// The projection must not alias the canonical card: later mutation of the
// source envelope cannot alter the already-projected guidance.
cardsEnvelope.data.pending_output_context.agency_review_operation
  .prefilled_arguments.revision = 99;
cardsEnvelope.data.pending_output_context.finalize_operation
  .prefilled_arguments.decision_id = "mutated:finalize";
assert.equal(
  cardsGuided.envelope.data.host_recovery_guidance.review_recovery.card
    .prefilled_arguments.revision,
  1,
);
assert.equal(
  cardsGuided.envelope.data.host_recovery_guidance.then.card
    .prefilled_arguments.decision_id,
  "bc1419c9:player-epoch-7:revision-2:finalize",
);

// 4. Missing/malformed optional cards never fabricate data (fail closed).
const malformedEnvelope = resumeEnvelope("pending_finalization", {
  next_operations: ["turn.finalize"],
});
malformedEnvelope.data.pending_output_context = {
  agency_review_operation: { operation: "narration.review" },
  finalize_operation: "turn.finalize",
};
const malformedGuided = applyPendingFinalizationRecoveryGuidance(
  malformedEnvelope,
  { root, campaign: "recovery-guide-campaign" },
);
assert.equal(malformedGuided.attached, true);
assert.equal(malformedGuided.envelope.data.host_recovery_guidance.card_projection, undefined);
assert.equal(malformedGuided.envelope.data.host_recovery_guidance.review_recovery.card, undefined);
assert.equal(malformedGuided.envelope.data.host_recovery_guidance.then.card, undefined);
assert.deepEqual(malformedGuided.audit.operation_cards, {
  agency_review_operation: false,
  finalize_operation: false,
});

const badMissingArgsEnvelope = resumeEnvelope("pending_finalization", {
  next_operations: ["turn.finalize"],
});
badMissingArgsEnvelope.data.pending_output_context = {
  agency_review_operation: {
    operation: "narration.review",
    invoke_via: "coc_narration_review",
    prefilled_arguments: { turn_id: "turn-v1-7b5c8d72" },
    missing_arguments: ["decision_id", 7],
  },
};
const badMissingArgs = applyPendingFinalizationRecoveryGuidance(
  badMissingArgsEnvelope,
  { root, campaign: "recovery-guide-campaign" },
);
assert.equal(badMissingArgs.envelope.data.host_recovery_guidance.review_recovery.card, undefined);
assert.equal(badMissingArgs.envelope.data.host_recovery_guidance.card_projection, undefined);

// Partial validity: a valid review card plus a malformed finalize card
// projects only the valid card and still labels the fresh call authoritative.
const partialEnvelope = resumeEnvelope("pending_finalization", {
  next_operations: ["turn.finalize"],
});
partialEnvelope.data.pending_output_context = {
  agency_review_operation: reviewCardFixture(),
  finalize_operation: { operation: "turn.finalize", invoke_via: "coc_invoke" },
};
const partialGuided = applyPendingFinalizationRecoveryGuidance(
  partialEnvelope,
  { root, campaign: "recovery-guide-campaign" },
);
assert.deepEqual(
  partialGuided.envelope.data.host_recovery_guidance.review_recovery.card,
  reviewCardFixture(),
);
assert.equal(partialGuided.envelope.data.host_recovery_guidance.then.card, undefined);
assert.deepEqual(partialGuided.audit.operation_cards, {
  agency_review_operation: true,
  finalize_operation: false,
});

// 6. Card identity validation: each canonical slot accepts only its exact
// operation + invoke_via pairing (review: narration.review via
// coc_narration_review; finalize: turn.finalize via coc_turn_finalize or
// coc_invoke). A structurally valid card with a wrong or swapped identity
// is a corrupt instruction, not an exact card: the slot stays absent while
// the ordinary host_recovery_guidance (next_call, tools, instructions,
// fallback behavior) remains fully intact.
const identityFailCases = [
  {
    label: "wrong review operation",
    pending: {
      agency_review_operation: {
        ...reviewCardFixture(),
        operation: "turn.finalize",
      },
      finalize_operation: finalizeCardFixture(),
    },
    expectReview: false,
    expectFinalize: true,
  },
  {
    label: "wrong review invoke_via",
    pending: {
      agency_review_operation: {
        ...reviewCardFixture(),
        invoke_via: "coc_invoke",
      },
      finalize_operation: finalizeCardFixture(),
    },
    expectReview: false,
    expectFinalize: true,
  },
  {
    label: "wrong finalize operation",
    pending: {
      agency_review_operation: reviewCardFixture(),
      finalize_operation: {
        ...finalizeCardFixture(),
        operation: "state.journal",
      },
    },
    expectReview: true,
    expectFinalize: false,
  },
  {
    label: "wrong finalize invoke_via",
    pending: {
      agency_review_operation: reviewCardFixture(),
      finalize_operation: {
        ...finalizeCardFixture(),
        invoke_via: "coc_narration_review",
      },
    },
    expectReview: true,
    expectFinalize: false,
  },
  {
    label: "swapped review/finalize cards",
    pending: {
      agency_review_operation: finalizeCardFixture(),
      finalize_operation: reviewCardFixture(),
    },
    expectReview: false,
    expectFinalize: false,
  },
];
for (const failCase of identityFailCases) {
  const envelope = resumeEnvelope("pending_finalization", {
    next_operations: ["turn.finalize"],
  });
  envelope.data.pending_output_context = failCase.pending;
  const guided = applyPendingFinalizationRecoveryGuidance(
    envelope,
    { root, campaign: "recovery-guide-campaign" },
  );
  // Ordinary guidance stays attached in every fail-closed case.
  assert.equal(guided.attached, true, failCase.label);
  assert.equal(
    guided.envelope.data.host_recovery_guidance.contract_id,
    PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT,
    failCase.label,
  );
  assert.deepEqual(
    guided.envelope.data.host_recovery_guidance.next_call,
    {
      tool: "coc_turn_output_context",
      arguments: { root, campaign: "recovery-guide-campaign" },
    },
    failCase.label,
  );
  assert.equal(
    guided.envelope.data.host_recovery_guidance.review_recovery.tool,
    "coc_narration_review",
    failCase.label,
  );
  assert.equal(
    guided.envelope.data.host_recovery_guidance.review_recovery.exact_card_path,
    "coc_turn_output_context.data.agency_review_operation",
    failCase.label,
  );
  assert.equal(
    typeof guided.envelope.data.host_recovery_guidance.review_recovery.instruction,
    "string",
    failCase.label,
  );
  assert.equal(
    guided.envelope.data.host_recovery_guidance.then.tool,
    "coc_turn_finalize",
    failCase.label,
  );
  assert.equal(
    typeof guided.envelope.data.host_recovery_guidance.then.instruction,
    "string",
    failCase.label,
  );
  // Only cards whose identity matches their slot are projected; a wrong,
  // swapped, or otherwise mis-identified card slot stays absent.
  assert.equal(
    guided.envelope.data.host_recovery_guidance.review_recovery.card !== undefined,
    failCase.expectReview,
    failCase.label,
  );
  assert.equal(
    guided.envelope.data.host_recovery_guidance.then.card !== undefined,
    failCase.expectFinalize,
    failCase.label,
  );
  assert.equal(
    guided.envelope.data.host_recovery_guidance.card_projection !== undefined,
    failCase.expectReview || failCase.expectFinalize,
    failCase.label,
  );
  assert.deepEqual(
    guided.audit.operation_cards,
    {
      agency_review_operation: failCase.expectReview,
      finalize_operation: failCase.expectFinalize,
    },
    failCase.label,
  );
}
// The no-agency-review finalize variant is canonical too: turn.finalize via
// coc_invoke projects exactly like the coc_turn_finalize variant.
const invokeFinalizeEnvelope = resumeEnvelope("pending_finalization", {
  next_operations: ["turn.finalize"],
});
invokeFinalizeEnvelope.data.pending_output_context = {
  finalize_operation: {
    ...finalizeCardFixture(),
    invoke_via: "coc_invoke",
    missing_arguments: ["draft"],
  },
};
const invokeFinalizeGuided = applyPendingFinalizationRecoveryGuidance(
  invokeFinalizeEnvelope,
  { root, campaign: "recovery-guide-campaign" },
);
assert.equal(invokeFinalizeGuided.attached, true);
assert.equal(
  invokeFinalizeGuided.envelope.data.host_recovery_guidance.then.card
    .invoke_via,
  "coc_invoke",
);
assert.deepEqual(
  invokeFinalizeGuided.audit.operation_cards,
  { agency_review_operation: false, finalize_operation: true },
);
// A card-less pending_output_context (the recovery-index resume shape) keeps
// the exact current fallback guidance.
const indexShapedEnvelope = resumeEnvelope("pending_finalization", {
  next_operations: ["turn.finalize"],
});
indexShapedEnvelope.data.pending_output_context = {
  schema_version: 1,
  turn_id: "turn-v1-7b5c8d72",
  journal_decision_id: "bc1419c9:player-epoch-7:revision-2",
  full_projection_operation: {
    operation: "turn.output_context",
    invoke_via: "coc_invoke",
    prefilled_arguments: {},
    missing_arguments: [],
    authority: "advisory",
    hard_gate: false,
  },
};
const indexShaped = applyPendingFinalizationRecoveryGuidance(
  indexShapedEnvelope,
  { root, campaign: "recovery-guide-campaign" },
);
assert.equal(indexShaped.envelope.data.host_recovery_guidance.card_projection, undefined);
assert.equal(indexShaped.envelope.data.host_recovery_guidance.review_recovery.card, undefined);
assert.equal(indexShaped.envelope.data.host_recovery_guidance.then.card, undefined);
// Absent pending_output_context entirely: same fail-closed fallback.
const noContextEnvelope = resumeEnvelope("pending_finalization", {
  next_operations: ["turn.finalize"],
});
const noContextGuided = applyPendingFinalizationRecoveryGuidance(
  noContextEnvelope,
  { root, campaign: "recovery-guide-campaign" },
);
assert.equal(noContextGuided.attached, true);
assert.equal(noContextGuided.envelope.data.host_recovery_guidance.card_projection, undefined);
assert.equal(noContextGuided.envelope.data.host_recovery_guidance.then.card, undefined);

const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-recovery-guide-"));

function harness(responseForCall, startupCampaignId, workspaceCwd = root, branch = [], extraOverrides = {}) {
  const registered = new Map();
  const handlers = new Map();
  const sent = [];
  const audits = [];
  const activeTools = [];
  const clientCalls = [];
  const fakePi = {
    registerTool: (tool) => registered.set(tool.name, tool),
    registerCommand: () => {},
    registerShortcut: () => {},
    on: (name, handler) => {
      const values = handlers.get(name) || [];
      values.push(handler);
      handlers.set(name, values);
    },
    appendEntry: (name, value) => {
      audits.push({ name, value });
    },
    sendMessage: (message, options) => {
      sent.push({ message, options });
    },
    setActiveTools: (tools) => {
      activeTools.push([...tools]);
    },
    getThinkingLevel: () => "off",
  };
  main.default(fakePi, {
    ...extraOverrides,
    coordinatorEnabled: async () => false,
    createClient: () => {
      const callTool = async (name, params) => {
        clientCalls.push({ name, params });
        if (name === "coc_capabilities") return { ok: true, host: "pi" };
        return responseForCall(name, params);
      };
      return {
        callTool,
        callToolWithTransportMeta: async (name, params) => ({
          value: await callTool(name, params),
          transport: null,
        }),
        close: async () => {},
      };
    },
    startupCampaignId: () => startupCampaignId,
    welcomeAgentDir,
    launchCoordinator: () => ({
      child: {},
      activation: Promise.resolve({ type: "agent_start" }),
      completion: Promise.resolve([]),
      terminate: async () => {},
    }),
  });
  const ctx = {
    cwd: workspaceCwd,
    mode: "rpc",
    model: { provider: "offline", id: "offline" },
    sessionManager: {
      getSessionId: () => "recovery-kp-guidance",
      getEntries: () => [],
      getBranch: () => branch,
    },
    hasUI: false,
    ui: {
      setHeader: () => {},
      setStatus: () => {},
      setFooter: () => {},
      setWidget: () => {},
      notify: () => {},
    },
  };
  return {
    registered,
    sent,
    audits,
    activeTools,
    clientCalls,
    ctx,
    async start() {
      await handlers.get("session_start").at(-1)({ reason: "startup" }, ctx);
      for (const handler of handlers.get("agent_start") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
    async restart() {
      await handlers.get("session_start").at(-1)({ reason: "startup" }, ctx);
    },
    async emit(name, message) {
      let current = message;
      for (const handler of handlers.get(name) || []) {
        const updated = await handler({ message: current }, ctx);
        if (updated?.message) current = updated.message;
      }
      return current;
    },
    async shutdown() {
      for (const handler of handlers.get("agent_end") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
  };
}

async function invoke(h, id, params, toolName = "coc_invoke") {
  const tool = h.registered.get(toolName);
  if (!tool) throw new Error(`missing tool ${toolName}`);
  return JSON.parse((await tool.execute(
    id,
    params,
    undefined,
    undefined,
    h.ctx,
  )).content[0].text);
}

async function invokeWithSignal(h, id, params, signal, toolName = "coc_invoke") {
  const tool = h.registered.get(toolName);
  if (!tool) throw new Error(`missing tool ${toolName}`);
  return JSON.parse((await tool.execute(
    id,
    params,
    signal,
    undefined,
    h.ctx,
  )).content[0].text);
}

function resumeParams(campaignId) {
  return {
    operation: "session.resume",
    root,
    campaign: campaignId,
    arguments: {},
  };
}

const recoveryCampaign = "startup-open-turn-recovery";
const recovery = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation !== "session.resume") {
    throw new Error(`unexpected ${params.operation}`);
  }
  return resumeEnvelope("open_turn_recovery", {
    campaign_id: recoveryCampaign,
    next_operations: ["continue_current_turn_from_receipts"],
  });
}, recoveryCampaign);
await recovery.start();
const sentBeforeResume = recovery.sent.length;
const recovered = await invoke(
  recovery,
  "recovery-resume",
  resumeParams(recoveryCampaign),
  "coc_setup",
);
assert.equal(recovered.ok, true);
assert.equal(recovered.data.mode, "open_turn_recovery");
assert.deepEqual(
  recovered.data.next_operations,
  ["continue_current_turn_from_receipts"],
);
assert.equal(
  recovered.data.host_recovery_guidance?.contract_id,
  OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT,
);
assert.deepEqual(
  recovered.data.host_recovery_guidance.closure_sequence.map((row) => row.operation),
  ["turn.output_context", "state.journal", "turn.finalize"],
);
assert.ok(
  recovered.data.host_recovery_guidance.forbidden_until_closed.includes("state.move_scene"),
);
assert.ok(
  recovery.audits.some((entry) => (
    entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT
    && entry.value?.contract_id === OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT
    && entry.value?.mode === "open_turn_recovery"
  )),
);
assert.equal(
  recovery.sent.slice(sentBeforeResume).some((entry) => (
    entry.message?.customType === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT
    || entry.message?.customType === "coc-open-turn-recovery-guidance"
  )),
  false,
  "guidance must stay on the tool result; no mid-pair custom message",
);
assert.ok(
  recovery.activeTools.length > 0
    && recovery.activeTools.at(-1).length > 0,
  "open_turn_recovery must not quarantine the active tool surface",
);
const recoveryProse = await recovery.emit("message_end", {
  role: "assistant",
  content: [{ type: "text", text: "你重新执起守夜人的提灯，等待玩家的下一步。" }],
  stopReason: "stop",
});
assert.equal(
  recoveryProse.content.some((part) => part.type === "text"),
  true,
  "open_turn_recovery plain final stays visible (no quarantine)",
);
assert.equal(
  recovery.sent.some((entry) => (
    entry.options?.triggerTurn === true
    || entry.options?.deliverAs === "followUp"
    || entry.message?.customType === "coc-mechanical-output-gate"
    || entry.message?.customType === "coc-settled-output-gate"
    || entry.message?.customType === "coc-opening-setup-route"
  )),
  false,
  "open_turn_recovery visible final must not arm a gate follow-up",
);
await recovery.shutdown();

// Exact cards survive the full extension path (coc_setup invoke → gateway →
// applyPendingFinalizationRecoveryGuidance), stay keeper-only, and never
// reach the player-visible sendMessage channel. This block runs before the
// pre-existing table_opening/quarantine sections so the projection contract
// is proven on every run.
const cardsCampaign = "startup-pending-finalization-cards";
const cardsHost = harness((name, params) => {
  if (name !== "coc_invoke" || params.operation !== "session.resume") {
    throw new Error(`unexpected ${name}:${params.operation}`);
  }
  const envelope = resumeEnvelope("pending_finalization", {
    campaign_id: cardsCampaign,
    next_operations: ["turn.finalize"],
  });
  envelope.data.pending_output_context = {
    agency_review_operation: reviewCardFixture(),
    finalize_operation: finalizeCardFixture(),
  };
  return envelope;
}, cardsCampaign);
await cardsHost.start();
const cardsResumedTool = await cardsHost.registered.get("coc_setup").execute(
  "cards-resume",
  resumeParams(cardsCampaign),
  undefined,
  undefined,
  cardsHost.ctx,
);
const cardsResumed = JSON.parse(cardsResumedTool.content[0].text);
assert.equal(cardsResumed.ok, true);
assert.equal(
  cardsResumed.data.host_recovery_guidance.audience,
  "keeper_only",
  "exact recovery cards stay keeper-only guidance",
);
// Model-visible cards are identity-sanitized at the gateway boundary; the
// exact canonical cards remain authoritative in host-only details.
assert.deepEqual(
  cardsResumed.data.host_recovery_guidance.review_recovery.card,
  {
    ...reviewCardFixture(),
    prefilled_arguments: { revision: 1 },
  },
);
assert.deepEqual(
  cardsResumed.data.host_recovery_guidance.then.card,
  finalizeCardFixture(),
);
assert.equal(
  JSON.stringify(
    cardsResumedTool.details.data.host_recovery_guidance.review_recovery.card,
  ),
  JSON.stringify(reviewCardFixture()),
  "host-only details must retain the exact canonical review card",
);
assert.equal(
  cardsResumed.data.host_recovery_guidance.card_projection.authoritative_copy,
  "coc_turn_output_context",
);
assert.ok(
  cardsHost.audits.some((entry) => (
    entry.name === PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT
    && entry.value?.operation_cards?.agency_review_operation === true
    && entry.value?.operation_cards?.finalize_operation === true
  )),
);
// 5. Player-visible boundary: the keeper-only recovery payload (guidance,
// cards, card fields) must never enter the player-visible channel.
assert.ok(
  cardsHost.sent.every((entry) => {
    const serialized = JSON.stringify(entry);
    return !serialized.includes("host_recovery_guidance")
      && !serialized.includes("agency_review_operation")
      && !serialized.includes("finalize_operation");
  }),
  "keeper-only recovery operation cards must not leak into player-visible sends",
);
// A complete inline snapshot chain suppresses host hydration entirely:
// the model already holds exact cards, so no output-context fetch happens.
assert.equal(
  cardsHost.clientCalls.filter((call) => (
    call.name === "coc_invoke"
    && call.params?.operation === "turn.output_context"
  )).length,
  0,
  "valid inline cards must not trigger a host output-context fetch",
);
await cardsHost.shutdown();

// ---- host-owned live output-context hydration (real pointer-only resume) ----
// Real-replay shape: the canonical session.resume for a pending-finalization
// turn carries no inline operation cards. The host performs one bounded
// read-only turn.output_context typed invocation, ingests the validated
// receipt through the existing compiler/binding/progress observers at the
// output_context_ready stage (before the resume's review_ready inference),
// and inlines the exact live cards as keeper-only guidance whose next model
// action is the live review card. Fixtures mirror the kernel producer
// (coc_operation_turn_output.py) and the wire projection (coc_mcp_wire.py),
// including the mode-specific finalize invoke_via surface.
const liveTurnId = "turn-live-hydrate-1";
const liveSourceDigest = "sha256:live-source-hydrate-1";
const liveDraftText = "诺特仍坐在桌后等你的答复，烛火映着未寄出的信。";
const liveReviewCard = (revision = 2, extra = null) => {
  const card = {
    operation: "narration.review",
    invoke_via: "coc_narration_review",
    prefilled_arguments: {
      turn_id: liveTurnId,
      source_digest: liveSourceDigest,
      revision,
    },
    missing_arguments: [
      "decision_id", "draft_text", "findings", "state_authority_review",
    ],
    discovery_required: false,
    authority: "semantic_agency_and_player_state_review",
  };
  if (extra) Object.assign(card, extra);
  return card;
};
const liveFinalizeCard = (invokeVia = "coc_turn_finalize", revision = 2) => ({
  operation: "turn.finalize",
  invoke_via: invokeVia,
  prefilled_arguments: {
    decision_id: `${liveTurnId}:player-epoch-7:revision-${revision}:finalize`,
    revision,
    coverage: [],
  },
  missing_arguments: ["draft", "narration_review_id", "agency_claims"],
  discovery_required: false,
  authority: "settled_output_completeness",
  hard_gate: true,
});
// Canonical keeper-only frozen narration draft receipt, exactly the closed
// producer schema for `turn.output_context.data.frozen_narration_draft`:
// every digest is computed (never fabricated), revisions are 1 or 2 only.
const liveFrozenDraft = (options = {}) => {
  const revision = options.revision ?? 2;
  const draftText = options.draft_text ?? liveDraftText;
  const producerKind = options.producer_kind ?? "narration_review_submission";
  const campaignId = options.campaign_id ?? "recovery-guide-campaign";
  const turnId = options.turn_id ?? liveTurnId;
  const sourceDigest = options.source_digest ?? liveSourceDigest;
  const provenance = producerKind === "toolbox_audit_recovery"
    ? {
        kind: "verified_toolbox_audit_recovery",
        source_path: "logs/toolbox-calls.jsonl",
        source_row_count: 2,
        primary_row_digest: `sha256:${"1f".repeat(32)}`,
        corroboration_digest: `sha256:${"2e".repeat(32)}`,
      }
    : { kind: "direct_review_submission" };
  const reviewDecisionId = (
    `pi-narration-review:live-hydrate:player-epoch-7:revision-${revision}`
  );
  // Producer-specific materialization identity: a direct submission
  // materializes under the review's own decision id; an audit recovery
  // materializes under its own distinct recovery decision id.
  const materializationDecisionId = producerKind === "toolbox_audit_recovery"
    ? `pi-pending-draft-materialize:live-hydrate:revision-${revision}`
    : reviewDecisionId;
  const receipt = {
    schema_version: 1,
    kind: "pending_narration_draft",
    secrecy: "keeper_only",
    campaign_id: campaignId,
    receipt_id: `pending-narration-draft:${reviewDecisionId}:revision-${revision}`,
    review_decision_id: reviewDecisionId,
    review_id: `narration-review-v1:${revision}3f1f618b6c3d8fc5ad75f41040c313e`,
    turn_id: turnId,
    source_digest: sourceDigest,
    revision,
    draft_sha256: canonicalDigest(draftText),
    draft_text: draftText,
    draft_utf8_bytes: Buffer.byteLength(draftText, "utf8"),
    review_digest: `sha256:${("a" + revision).repeat(32)}`,
    request_digest: `sha256:${("b" + revision).repeat(32)}`,
    producer_kind: producerKind,
    source_operation: "narration.review",
    materialization_decision_id: materializationDecisionId,
    provenance,
  };
  receipt.receipt_digest = canonicalDigest(receipt);
  return receipt;
};
// One-defect receipt mutation: start from the valid fixture, apply the
// mutation, then recompute the integrity digest so the only remaining
// defect is the mutated field itself (never a stale digest).
const receiptWith = (mutate) => {
  const receipt = liveFrozenDraft();
  mutate(receipt);
  delete receipt.receipt_digest;
  receipt.receipt_digest = canonicalDigest(receipt);
  return receipt;
};
// Canonical bounded span-repair evidence exactly as the producer emits it:
// closed field set, canonical constants, non-empty bounded strings, and
// excerpts that occur exactly in the frozen baseline draft.
const canonicalSpanRepairs = () => ({
  schema_version: 1,
  contract_id: "coc.span-repairs.v1",
  mode: "excerpt_only",
  spans: [
    {
      exact_excerpt: "烛火映着未寄出的信",
      claim_kind: "item",
      reason: "未落账的信件取得。",
      repair: "rephrase_or_remove",
    },
  ],
  instruction: (
    "Only change the listed excerpts. Leave every other sentence "
    + "byte-stable. Do not regenerate the scene."
  ),
});
// Revision-2 repair chain whose review card carries span-repair evidence:
// a function mutates a canonical copy; any other value replaces it whole.
const spanRepairsEnvelope = (mutate) => liveEnvelope((d) => {
  const spanRepairs = typeof mutate === "function"
    ? (() => {
        const repairs = canonicalSpanRepairs();
        mutate(repairs);
        return repairs;
      })()
    : mutate;
  d.agency_review_operation = liveReviewCard(2, { span_repairs: spanRepairs });
  d.finalize_operation = liveFinalizeCard("coc_turn_finalize", 2);
}, liveFrozenDraft({ revision: 1 }));
const liveEnvelope = (mutateData = () => {}, frozenDraft) => {
  const envelope = {
    ok: true,
    tool: "turn.output_context",
    data: {
      turn_id: liveTurnId,
      source_digest: liveSourceDigest,
      settlement_snapshot_id: "turn-settlement-v1:live-hydrate-1",
      mechanics_bundle_sha256: "sha256:live-mechanics-hydrate-1",
      manifest_revision: 41,
      contract_projection: {
        agency_review_required: true,
        agency_authority: { pc_subject_refs: ["pc:live-hydrate-investigator"] },
      },
      frozen_narration_draft: liveFrozenDraft(),
      agency_review_operation: liveReviewCard(),
      finalize_operation: liveFinalizeCard(),
    },
  };
  mutateData(envelope.data);
  if (frozenDraft === null) {
    delete envelope.data.frozen_narration_draft;
  } else if (frozenDraft !== undefined) {
    envelope.data.frozen_narration_draft = frozenDraft;
  } else {
    // Keep the frozen receipt identity in exact lockstep with the (possibly
    // mutated) receipt/review chain; only deliberate frozenDraft corruption
    // bypasses this.
    const reviewCard = envelope.data.agency_review_operation;
    const reviewRevision = reviewCard
      && Number.isInteger(reviewCard.prefilled_arguments?.revision)
      ? reviewCard.prefilled_arguments.revision
      : null;
    const current = envelope.data.frozen_narration_draft;
    envelope.data.frozen_narration_draft = liveFrozenDraft({
      revision: reviewRevision ?? current.revision,
      draft_text: current.draft_text,
      producer_kind: current.producer_kind,
      turn_id: envelope.data.turn_id,
      source_digest: envelope.data.source_digest,
    });
  }
  return envelope;
};
const pointerOnlyPendingEnvelope = (campaignId) => {
  const envelope = resumeEnvelope("pending_finalization", {
    campaign_id: campaignId,
    next_operations: ["turn.finalize"],
  });
  envelope.data.current_turn = { rows: [{ tool: "rules.roll", ok: true }] };
  return envelope;
};
// Kernel recovery-index resume shape (coc_mcp_wire.py pending index):
// semantic pending identity, no inline cards.
const pendingIndexEnvelope = (
  campaignId,
  turnId = liveTurnId,
  sourceDigest = liveSourceDigest,
) => {
  const envelope = pointerOnlyPendingEnvelope(campaignId);
  envelope.data.pending_output_context = {
    schema_version: 1,
    turn_id: turnId,
    source_digest: sourceDigest,
    full_projection_operation: {
      operation: "turn.output_context",
      invoke_via: "coc_invoke",
      prefilled_arguments: {},
      missing_arguments: [],
      authority: "advisory",
      hard_gate: false,
    },
  };
  return envelope;
};
const outputContextFetchCount = (h) => h.clientCalls.filter((call) => (
  call.name === "coc_invoke"
  && call.params?.operation === "turn.output_context"
)).length;
const assertNoPlayerLeak = (h, label) => {
  assert.ok(
    h.sent.every((entry) => {
      const serialized = JSON.stringify(entry);
      return !serialized.includes("host_recovery_guidance")
        && !serialized.includes("agency_review_operation")
        && !serialized.includes("finalize_operation")
        && !serialized.includes("frozen_narration_draft")
        && !serialized.includes(liveTurnId)
        && !serialized.includes(liveDraftText);
    }),
    `${label}: no card content in player-visible sends`,
  );
};
const assertCardFreePointerGuidance = (h, campaignId, resumed, label) => {
  const guidance = resumed.data.host_recovery_guidance;
  assert.deepEqual(
    guidance.next_call,
    {
      tool: "coc_turn_output_context",
      arguments: { root, campaign: campaignId },
    },
    `${label}: card-free pointer guidance retained`,
  );
  assert.equal(guidance.review_recovery.card, undefined, label);
  assert.equal(guidance.then.card, undefined, label);
  assert.equal(guidance.card_projection, undefined, label);
  assert.equal(guidance.output_context_status, undefined, label);
  assert.deepEqual(resumed.data.pending_output_context, {
    status: "read_via_exact_typed_call",
    next_call: {
      tool: "coc_turn_output_context",
      arguments: { root, campaign: campaignId },
    },
  }, label);
  assertNoPlayerLeak(h, label);
};

// Strict pure validation: producer-shaped receipts, table-driven fail-close.
for (const [label, envelope, resumeData, expectNull] of [
  ["complete review-required receipt", liveEnvelope(), pendingIndexEnvelope("recovery-guide-campaign").data, false],
  ["direct-finalize receipt via coc_invoke", liveEnvelope((data) => {
    data.contract_projection = { agency_review_required: false };
    delete data.agency_review_operation;
    data.finalize_operation = liveFinalizeCard("coc_invoke");
  }), null, false],
  ["correlated pending identity and revision", liveEnvelope(), {
    pending_output_context: { turn_id: liveTurnId, source_digest: liveSourceDigest, revision: 2 },
  }, false],
  ["not ok", { ok: false, tool: "turn.output_context" }, null, true],
  ["wrong tool", { ok: true, tool: "state.journal" }, null, true],
  ["missing data", { ok: true, tool: "turn.output_context" }, null, true],
  ["missing settlement snapshot", liveEnvelope((d) => { delete d.settlement_snapshot_id; }), null, true],
  ["missing mechanics bundle", liveEnvelope((d) => { delete d.mechanics_bundle_sha256; }), null, true],
  ["implicit agency mode", liveEnvelope((d) => { delete d.contract_projection.agency_review_required; }), null, true],
  ["review required but card absent", liveEnvelope((d) => { delete d.agency_review_operation; }), null, true],
  ["direct finalize with stray review card", liveEnvelope((d) => {
    d.contract_projection = { agency_review_required: false };
    d.finalize_operation = liveFinalizeCard("coc_invoke");
  }), null, true],
  ["review card missing turn identity", liveEnvelope((d) => {
    d.agency_review_operation.prefilled_arguments.turn_id = undefined;
  }), null, true],
  ["review card missing source identity", liveEnvelope((d) => {
    delete d.agency_review_operation.prefilled_arguments.source_digest;
  }), null, true],
  ["review card wrong turn identity", liveEnvelope((d) => {
    d.agency_review_operation.prefilled_arguments.turn_id = "turn-forged-live-9";
  }), null, true],
  ["review-required finalize via coc_invoke", liveEnvelope((d) => {
    d.finalize_operation = liveFinalizeCard("coc_invoke");
  }), null, true],
  ["direct finalize via coc_turn_finalize", liveEnvelope((d) => {
    d.contract_projection = { agency_review_required: false };
    delete d.agency_review_operation;
  }), null, true],
  ["finalize card without revision", liveEnvelope((d) => {
    delete d.finalize_operation.prefilled_arguments.revision;
  }), null, true],
  ["revision mismatch across chain", liveEnvelope((d) => {
    d.agency_review_operation.prefilled_arguments.revision = 1;
  }), null, true],
  ["swapped cards", liveEnvelope((d) => {
    const review = d.agency_review_operation;
    d.agency_review_operation = d.finalize_operation;
    d.finalize_operation = review;
  }), null, true],
  ["finalize wrong operation", liveEnvelope((d) => {
    d.finalize_operation = { ...d.finalize_operation, operation: "state.journal" };
  }), null, true],
  ["agency subject refs missing", liveEnvelope((d) => {
    d.contract_projection = { agency_review_required: true };
  }), null, true],
  ["agency subject refs empty", liveEnvelope((d) => {
    d.contract_projection.agency_authority.pc_subject_refs = [];
  }), null, true],
  ["resume pending turn mismatch", liveEnvelope(), {
    pending_output_context: { turn_id: "turn-resume-other-9" },
  }, true],
  ["resume pending source mismatch", liveEnvelope(), {
    pending_output_context: { source_digest: "sha256:resume-other-9" },
  }, true],
  ["resume pending revision mismatch", liveEnvelope(), {
    pending_output_context: { turn_id: liveTurnId, revision: 9 },
  }, true],
  // Frozen narration draft: any present-but-stale, divergent, or malformed
  // receipt fails the whole live chain closed. (Absence is rejected only in
  // recovery hydration mode — asserted separately below.) Every semantic
  // field negative is digest-isolated: the fixture recomputes
  // receipt_digest around the mutation so the only defect is the field.
  ["frozen draft absent stays valid without require flag", liveEnvelope(() => {}, null), null, false],
  ["frozen draft not an object", liveEnvelope(() => {}, "sha256:a3"), null, true],
  ["frozen draft wrong schema_version", liveEnvelope(() => {}, receiptWith((r) => {
    r.schema_version = 2;
  })), null, true],
  ["frozen draft wrong secrecy", liveEnvelope(() => {}, receiptWith((r) => {
    r.secrecy = "player_visible";
  })), null, true],
  ["frozen draft missing campaign", liveEnvelope(() => {}, receiptWith((r) => {
    r.campaign_id = "";
  })), null, true],
  ["frozen draft non-string campaign", liveEnvelope(() => {}, receiptWith((r) => {
    r.campaign_id = 12345;
  })), null, true],
  ["frozen draft campaign mismatch vs resume campaign", liveEnvelope(() => {}, liveFrozenDraft({ campaign_id: "other-campaign" })), pendingIndexEnvelope("recovery-guide-campaign").data, true],
  ["frozen draft missing review decision", liveEnvelope(() => {}, receiptWith((r) => {
    r.review_decision_id = "";
  })), null, true],
  ["frozen draft non-string review decision", liveEnvelope(() => {}, receiptWith((r) => {
    r.review_decision_id = ["pi-narration-review"];
  })), null, true],
  ["frozen draft missing review id", liveEnvelope(() => {}, receiptWith((r) => {
    r.review_id = undefined;
  })), null, true],
  ["frozen draft non-string review id", liveEnvelope(() => {}, receiptWith((r) => {
    r.review_id = { id: "narration-review-v1" };
  })), null, true],
  ["frozen draft wrong turn binding", liveEnvelope(() => {}, receiptWith((r) => {
    r.turn_id = "turn-forged-live-9";
  })), null, true],
  ["frozen draft non-string turn binding", liveEnvelope(() => {}, receiptWith((r) => {
    r.turn_id = 41;
  })), null, true],
  ["frozen draft wrong source binding", liveEnvelope(() => {}, receiptWith((r) => {
    r.source_digest = "sha256:forged-other-9";
  })), null, true],
  ["frozen draft wrong revision binding", liveEnvelope(() => {}, liveFrozenDraft({ revision: 1 })), null, true],
  ["frozen draft revision above card revision rejected", liveEnvelope((d) => {
    d.agency_review_operation = liveReviewCard(1);
    d.finalize_operation = liveFinalizeCard("coc_turn_finalize", 1);
  }, liveFrozenDraft({ revision: 2 })), null, true],
  ["frozen draft malformed digest", liveEnvelope(() => {}, receiptWith((r) => {
    r.draft_sha256 = "a3f997c0cce0efce18ee8d94e2c2bc0d";
  })), null, true],
  ["frozen draft wrong-format digest", liveEnvelope(() => {}, receiptWith((r) => {
    r.draft_sha256 = `sha256:${"ff".repeat(32)}`;
  })), null, true],
  ["frozen draft empty text", liveEnvelope(() => {}, receiptWith((r) => {
    r.draft_text = "   ";
  })), null, true],
  ["frozen draft NUL rejected with recomputed digests", liveEnvelope(() => {}, receiptWith((r) => {
    r.draft_text = "前半\u0000后半。";
    r.draft_sha256 = canonicalDigest(r.draft_text);
    r.draft_utf8_bytes = Buffer.byteLength(r.draft_text, "utf8");
  })), null, true],
  ["frozen draft missing producer kind", liveEnvelope(() => {}, receiptWith((r) => {
    r.producer_kind = "";
  })), null, true],
  ["frozen draft missing materialization decision", liveEnvelope(() => {}, receiptWith((r) => {
    r.materialization_decision_id = undefined;
  })), null, true],
  ["frozen draft non-string materialization decision", liveEnvelope(() => {}, receiptWith((r) => {
    r.materialization_decision_id = true;
  })), null, true],
  ["frozen draft submission with divergent materialization decision", liveEnvelope(() => {}, receiptWith((r) => {
    r.materialization_decision_id = "pi-pending-draft-materialize:forged";
  })), null, true],
  ["frozen draft recovery with review-owned materialization decision", liveEnvelope(() => {}, receiptWith((r) => {
    r.producer_kind = "toolbox_audit_recovery";
    r.provenance = {
      kind: "verified_toolbox_audit_recovery",
      source_path: "logs/toolbox-calls.jsonl",
      source_row_count: 2,
      primary_row_digest: `sha256:${"1f".repeat(32)}`,
      corroboration_digest: `sha256:${"2e".repeat(32)}`,
    };
  })), null, true],
  // Digest negatives isolate the digest: every other field stays valid.
  ["frozen draft missing receipt digest", liveEnvelope(() => {}, {
    ...liveFrozenDraft(),
    receipt_digest: "",
  }), null, true],
  // Strict closed-schema negatives: each mandatory producer field is
  // required, extra fields reject, and the integrity digest is recomputed.
  ["frozen draft missing kind", liveEnvelope(() => {}, receiptWith((r) => {
    r.kind = undefined;
  })), null, true],
  ["frozen draft missing receipt_id", liveEnvelope(() => {}, receiptWith((r) => {
    r.receipt_id = undefined;
  })), null, true],
  ["frozen draft receipt_id not derived from identity", liveEnvelope(() => {}, receiptWith((r) => {
    r.receipt_id = "pending-narration-draft:other:revision-2";
  })), null, true],
  ["frozen draft missing source_operation", liveEnvelope(() => {}, receiptWith((r) => {
    r.source_operation = undefined;
  })), null, true],
  ["frozen draft wrong source_operation", liveEnvelope(() => {}, receiptWith((r) => {
    r.source_operation = "turn.finalize";
  })), null, true],
  ["frozen draft missing draft_utf8_bytes", liveEnvelope(() => {}, receiptWith((r) => {
    r.draft_utf8_bytes = undefined;
  })), null, true],
  ["frozen draft wrong draft_utf8_bytes", liveEnvelope(() => {}, receiptWith((r) => {
    r.draft_utf8_bytes = 3;
  })), null, true],
  ["frozen draft missing review_digest", liveEnvelope(() => {}, receiptWith((r) => {
    r.review_digest = undefined;
  })), null, true],
  ["frozen draft wrong-format review digest", liveEnvelope(() => {}, receiptWith((r) => {
    r.review_digest = "sha256:short";
  })), null, true],
  ["frozen draft missing request_digest", liveEnvelope(() => {}, receiptWith((r) => {
    r.request_digest = undefined;
  })), null, true],
  ["frozen draft missing provenance", liveEnvelope(() => {}, receiptWith((r) => {
    r.provenance = undefined;
  })), null, true],
  ["frozen draft provenance extra field", liveEnvelope(() => {}, receiptWith((r) => {
    r.provenance = { kind: "direct_review_submission", extra: 1 };
  })), null, true],
  ["frozen draft provenance kind mismatch", liveEnvelope(() => {}, receiptWith((r) => {
    r.provenance = { kind: "verified_toolbox_audit_recovery" };
  })), null, true],
  ["frozen draft unknown producer kind", liveEnvelope(() => {}, receiptWith((r) => {
    r.producer_kind = "transcript_reconstruction";
  })), null, true],
  ["frozen draft recovery provenance on submission kind", liveEnvelope(() => {}, receiptWith((r) => {
    r.provenance = {
      kind: "verified_toolbox_audit_recovery",
      source_path: "logs/toolbox-calls.jsonl",
      source_row_count: 2,
      primary_row_digest: `sha256:${"1f".repeat(32)}`,
      corroboration_digest: `sha256:${"2e".repeat(32)}`,
    };
  })), null, true],
  ["frozen draft recovery provenance over row cap", liveEnvelope(() => {}, receiptWith((r) => {
    r.producer_kind = "toolbox_audit_recovery";
    r.provenance = {
      kind: "verified_toolbox_audit_recovery",
      source_path: "logs/toolbox-calls.jsonl",
      source_row_count: 9,
      primary_row_digest: `sha256:${"1f".repeat(32)}`,
      corroboration_digest: `sha256:${"2e".repeat(32)}`,
    };
  })), null, true],
  ["frozen draft extra unknown field", liveEnvelope(() => {}, receiptWith((r) => {
    r.surprise_field = "not in the closed schema";
  })), null, true],
  // Digest negatives isolate the digest: every other field stays valid.
  ["frozen draft receipt_digest not recomputed", liveEnvelope(() => {}, {
    ...liveFrozenDraft(),
    receipt_digest: `sha256:${"c0".repeat(32)}`,
  }), null, true],
  ["frozen draft digest not over exact text", liveEnvelope(() => {}, receiptWith((r) => {
    r.draft_text = `${r.draft_text}多了一句。`;
  })), null, true],
  ["frozen draft oversize 8193 bytes", liveEnvelope(() => {}, (() => {
    const oversize = "霜".repeat(8193);
    const receipt = liveFrozenDraft({ draft_text: oversize });
    return receipt;
  })()), null, true],
  // Positive strict cases: the materializer-produced recovery provenance
  // validates, and a rejected revision-1 baseline behind a revision-2 card
  // validates ONLY with canonical bounded span-repair evidence on the
  // review card.
  ["frozen draft recovered provenance valid", liveEnvelope(() => {}, {
    ...liveFrozenDraft({ producer_kind: "toolbox_audit_recovery" }),
  }), null, false],
  ["frozen draft one revision behind without span repairs", liveEnvelope((d) => {
    d.agency_review_operation = liveReviewCard(2);
    d.finalize_operation = liveFinalizeCard("coc_turn_finalize", 2);
  }, liveFrozenDraft({ revision: 1 })), null, true],
  ["frozen draft one revision behind with span repairs", liveEnvelope((d) => {
    d.agency_review_operation = liveReviewCard(2, {
      span_repairs: canonicalSpanRepairs(),
    });
    d.finalize_operation = liveFinalizeCard("coc_turn_finalize", 2);
  }, liveFrozenDraft({ revision: 1 })), null, false],
  // Span-repair evidence itself is closed and bounded: non-object, wrong
  // constants, missing/unknown fields, wrong types, empty/oversize
  // strings, duplicates, over-cap counts, and baseline-divergent excerpts
  // all fail the whole chain closed.
  ["span repairs not an object", spanRepairsEnvelope("nope"), null, true],
  ["span repairs missing container field", spanRepairsEnvelope((s) => {
    delete s.instruction;
  }), null, true],
  ["span repairs unknown container field", spanRepairsEnvelope((s) => {
    s.extra = true;
  }), null, true],
  ["span repairs wrong contract id", spanRepairsEnvelope((s) => {
    s.contract_id = "coc.span-repairs.v2";
  }), null, true],
  ["span repairs wrong mode", spanRepairsEnvelope((s) => {
    s.mode = "full_rewrite";
  }), null, true],
  ["span repairs empty span list", spanRepairsEnvelope((s) => {
    s.spans = [];
  }), null, true],
  ["span repairs over span count cap", spanRepairsEnvelope((s) => {
    s.spans = Array.from({ length: 17 }, (_, index) => ({
      exact_excerpt: `烛火${index}`, claim_kind: "item",
      reason: "理由", repair: "rephrase_or_remove",
    }));
  }), null, true],
  ["span entry missing reason", spanRepairsEnvelope((s) => {
    delete s.spans[0].reason;
  }), null, true],
  ["span entry unknown field", spanRepairsEnvelope((s) => {
    s.spans[0].replacement = "新句子";
  }), null, true],
  ["span entry wrong repair action", spanRepairsEnvelope((s) => {
    s.spans[0].repair = "rewrite_all";
  }), null, true],
  ["span entry non-string excerpt", spanRepairsEnvelope((s) => {
    s.spans[0].exact_excerpt = 123;
  }), null, true],
  ["span entry empty excerpt", spanRepairsEnvelope((s) => {
    s.spans[0].exact_excerpt = "   ";
  }), null, true],
  ["span entry oversize excerpt", spanRepairsEnvelope((s) => {
    s.spans[0].exact_excerpt = "钥".repeat(2049);
  }), null, true],
  ["span entry oversize reason", spanRepairsEnvelope((s) => {
    s.spans[0].reason = "理".repeat(1025);
  }), null, true],
  ["span entries duplicated on excerpt and kind", spanRepairsEnvelope((s) => {
    s.spans = [canonicalSpanRepairs().spans[0], canonicalSpanRepairs().spans[0]];
  }), null, true],
  ["span excerpt diverges from frozen baseline", spanRepairsEnvelope((s) => {
    s.spans[0].exact_excerpt = "不在此草稿中的句子";
  }), null, true],
  // Exact replay is not occurrence-bound: a revision-2 receipt behind a
  // revision-2 card keeps structurally valid repairs whose excerpts were
  // already repaired away in the newer baseline text.
  ["exact replay keeps valid repairs without occurrence", liveEnvelope((d) => {
    const repairs = canonicalSpanRepairs();
    repairs.spans[0].exact_excerpt = "不再出现于新草稿的旧句";
    d.agency_review_operation = liveReviewCard(2, { span_repairs: repairs });
    d.finalize_operation = liveFinalizeCard("coc_turn_finalize", 2);
  }, liveFrozenDraft({ revision: 2 })), null, false],
  ["direct finalize without frozen draft stays valid", liveEnvelope((data) => {
    data.contract_projection = { agency_review_required: false };
    delete data.agency_review_operation;
    data.finalize_operation = liveFinalizeCard("coc_invoke");
  }, null), null, false],
]) {
  const validated = validateLiveOutputContext(envelope, resumeData);
  assert.equal(validated === null, expectNull, label);
  if (!expectNull) {
    assert.deepEqual(
      validated.reviewCard,
      envelope.data.agency_review_operation ?? null,
      label,
    );
    assert.deepEqual(validated.finalizeCard, envelope.data.finalize_operation, label);
    assert.deepEqual(
      validated.frozenDraft,
      envelope.data.frozen_narration_draft ?? null,
      label,
    );
  }
}
// Validated cards are exact deep copies: later mutation of the source
// envelope cannot alter a validation result already returned.
{
  const mutationSource = liveEnvelope();
  const mutationValidated = validateLiveOutputContext(mutationSource, null);
  mutationSource.data.agency_review_operation.prefilled_arguments.revision = 99;
  mutationSource.data.finalize_operation.prefilled_arguments.decision_id = "mutated:finalize";
  mutationSource.data.frozen_narration_draft.draft_text = "被改写的草稿。";
  assert.equal(mutationValidated.reviewCard.prefilled_arguments.revision, 2);
  assert.equal(
    mutationValidated.finalizeCard.prefilled_arguments.decision_id,
    `${liveTurnId}:player-epoch-7:revision-2:finalize`,
  );
  assert.equal(mutationValidated.frozenDraft.draft_text, liveDraftText);
}

// Recovery hydration mode: a review-required live chain is usable only with
// the exact frozen draft; without it the whole chain fails closed. A direct
// finalize chain never requires one. Validating an explicit canonical call
// (no option) keeps ordinary live-turn behavior unchanged.
{
  const requireOptions = { requireFrozenDraft: true };
  assert.equal(
    validateLiveOutputContext(liveEnvelope(), null, requireOptions) !== null,
    true,
    "review-required live chain with the frozen draft validates",
  );
  assert.equal(
    validateLiveOutputContext(
      liveEnvelope(),
      pendingIndexEnvelope("recovery-guide-campaign").data,
      requireOptions,
    ) !== null,
    true,
    "receipt campaign equal to the resume campaign validates",
  );
  assert.equal(
    validateLiveOutputContext(
      liveEnvelope(),
      pendingIndexEnvelope("other-campaign").data,
      requireOptions,
    ),
    null,
    "receipt campaign mismatching the resume campaign fails closed",
  );
  assert.equal(
    validateLiveOutputContext(
      liveEnvelope(() => {}, liveFrozenDraft({ campaign_id: "forged-campaign" })),
      pendingIndexEnvelope("recovery-guide-campaign").data,
      requireOptions,
    ),
    null,
    "forged receipt campaign against the current resume campaign fails closed",
  );
  assert.equal(
    validateLiveOutputContext(liveEnvelope(() => {}, null), null, requireOptions),
    null,
    "review-required live chain without the frozen draft fails closed",
  );
  const directEnvelope = liveEnvelope((data) => {
    data.contract_projection = { agency_review_required: false };
    delete data.agency_review_operation;
    data.finalize_operation = liveFinalizeCard("coc_invoke");
  }, null);
  assert.equal(
    validateLiveOutputContext(directEnvelope, null, requireOptions) !== null,
    true,
    "direct finalize never requires a frozen draft",
  );
  assert.equal(
    validateLiveOutputContext(liveEnvelope(() => {}, null), null) !== null,
    true,
    "explicit canonical call keeps ordinary live-turn validation",
  );
}

// Inline-completeness trigger: only a complete applicable inline chain
// suppresses the host fetch.
{
  const complete = resumeEnvelope("pending_finalization", {
    next_operations: ["turn.finalize"],
  });
  complete.data.pending_output_context = {
    agency_review_operation: reviewCardFixture(),
    finalize_operation: finalizeCardFixture(),
  };
  assert.equal(pendingFinalizationInlineCardsComplete(complete), true);
  const directComplete = resumeEnvelope("pending_finalization", {
    next_operations: ["turn.finalize"],
  });
  directComplete.data.pending_output_context = {
    finalize_operation: { ...finalizeCardFixture(), invoke_via: "coc_invoke" },
  };
  assert.equal(pendingFinalizationInlineCardsComplete(directComplete), true);
  assert.equal(
    pendingFinalizationInlineCardsComplete(pointerOnlyPendingEnvelope("x")),
    false,
  );
  assert.equal(
    pendingFinalizationInlineCardsComplete(pendingIndexEnvelope("x")),
    false,
  );
  const partial = resumeEnvelope("pending_finalization", {
    next_operations: ["turn.finalize"],
  });
  partial.data.pending_output_context = {
    agency_review_operation: reviewCardFixture(),
    finalize_operation: { operation: "turn.finalize", invoke_via: "coc_invoke" },
  };
  assert.equal(pendingFinalizationInlineCardsComplete(partial), false);
}

// Pure projection: live cards are authoritative over a conflicting snapshot
// chain; an attempted-and-failed hydration suppresses every snapshot card.
{
  const conflictEnvelope = resumeEnvelope("pending_finalization", {
    next_operations: ["turn.finalize"],
  });
  conflictEnvelope.data.pending_output_context = {
    agency_review_operation: reviewCardFixture(),
    finalize_operation: finalizeCardFixture(),
  };
  const liveCards = validateLiveOutputContext(liveEnvelope(), conflictEnvelope.data);
  assert.ok(liveCards !== null);
  const liveGuided = applyPendingFinalizationRecoveryGuidance(
    conflictEnvelope,
    { root, campaign: "recovery-guide-campaign" },
    { liveHydration: { status: "success", cards: liveCards } },
  );
  assert.equal(
    liveGuided.envelope.data.host_recovery_guidance.output_context_status,
    "host_refreshed_live",
  );
  assert.deepEqual(
    liveGuided.envelope.data.host_recovery_guidance.next_call,
    { tool: "coc_narration_review" },
  );
  assert.deepEqual(
    liveGuided.envelope.data.host_recovery_guidance.review_recovery.card,
    liveReviewCard(),
  );
  assert.deepEqual(
    liveGuided.envelope.data.host_recovery_guidance.then.card,
    liveFinalizeCard(),
  );
  assert.deepEqual(
    liveGuided.envelope.data.pending_output_context,
    { status: "host_refreshed_live" },
  );
  assert.equal(liveGuided.audit.card_source, "host_refreshed_turn_output_context");
  // Canonical cards unchanged as authority: exact structural copies of the
  // producer cards, never merged with draft or projection fields.
  const liveGuidance = liveGuided.envelope.data.host_recovery_guidance;
  assert.equal(
    JSON.stringify(liveGuidance.review_recovery.card),
    JSON.stringify(liveReviewCard()),
  );
  assert.equal(
    JSON.stringify(liveGuidance.then.card),
    JSON.stringify(liveFinalizeCard()),
  );
  // Keeper-only review input carries the exact frozen draft exactly once
  // as the immutable baseline, with its relation to the actionable cards.
  const liveFrozen = liveFrozenDraft();
  assert.deepEqual(liveGuidance.review_recovery.review_input, {
    visibility: "keeper_only",
    source: "turn.output_context.data.frozen_narration_draft",
    mode: "exact_replay",
    baseline_draft_text: liveDraftText,
    baseline_draft_sha256: liveFrozen.draft_sha256,
    instruction: liveGuidance.review_recovery.review_input.instruction,
  });
  assert.equal(
    JSON.stringify(liveGuidance).split(liveDraftText).length - 1,
    1,
    "the frozen draft must appear exactly once in the guidance",
  );
  // Separate model-call projection derived from the actual typed schemas:
  // model-owned only, host-bound listed, exact card invoke_via surfaces.
  assert.deepEqual(liveGuidance.model_calls.review, {
    operation: "narration.review",
    invoke_via: "coc_narration_review",
    contract_source: "mcp_operation_contracts.inputSchema",
    invocation_shape: "typed_flat",
    model_owned_required_arguments: ["draft_text", "state_authority_review"],
    model_owned_optional_arguments: ["findings", "investigator"],
    host_bound_auto_attached_arguments: [
      "campaign", "decision_id", "revision", "root", "source_digest",
      "state_claim_compilation", "turn_id",
    ],
    instruction: liveGuidance.model_calls.review.instruction,
  });
  assert.deepEqual(liveGuidance.model_calls.finalize, {
    operation: "turn.finalize",
    invoke_via: "coc_turn_finalize",
    contract_source: "mcp_operation_contracts.inputSchema",
    invocation_shape: "typed_flat",
    model_owned_required_arguments: ["coverage", "draft"],
    model_owned_optional_arguments: [
      "advisory_uptake", "agency_claims", "mechanics_placements", "validate_only",
    ],
    host_bound_auto_attached_arguments: [
      "campaign", "decision_id", "narration_review_id", "repair_finalization_id",
      "revision", "root",
    ],
    instruction: liveGuidance.model_calls.finalize.instruction,
  });
  // The model is never asked to echo host-bound identity or compiler fields.
  for (const hostBound of [
    "decision_id", "narration_review_id", "turn_id", "source_digest",
    "revision", "state_claim_compilation",
  ]) {
    assert.equal(
      liveGuidance.model_calls.review.model_owned_required_arguments
        .includes(hostBound),
      false,
      hostBound,
    );
    assert.equal(
      liveGuidance.model_calls.finalize.model_owned_required_arguments
        .includes(hostBound),
      false,
      hostBound,
    );
  }
  assert.deepEqual(liveGuided.audit.model_call_projection, {
    review: true,
    finalize: true,
  });
  assert.equal(liveGuided.audit.frozen_draft_review_input, true);
  assert.equal(liveGuidance.card_projection.source, "host_refreshed_live_context");
  assert.equal(liveGuidance.card_projection.authoritative_copy, undefined);
  assert.equal(liveGuidance.review_recovery.exact_card_path, undefined);
  assert.equal(liveGuidance.then.exact_card_path, undefined);
  assert.equal(
    JSON.stringify(liveGuidance).includes("coc_turn_output_context"),
    false,
    "successful live guidance must be card-driven and pointer-free",
  );
  const directEnvelope = liveEnvelope((directData) => {
    directData.contract_projection = { agency_review_required: false };
    delete directData.agency_review_operation;
    directData.finalize_operation = liveFinalizeCard("coc_invoke");
  });
  const directCards = validateLiveOutputContext(directEnvelope, null);
  assert.ok(directCards !== null);
  const directGuided = applyPendingFinalizationRecoveryGuidance(
    conflictEnvelope,
    { root, campaign: "recovery-guide-campaign" },
    { liveHydration: { status: "success", cards: directCards } },
  );
  assert.deepEqual(
    directGuided.envelope.data.host_recovery_guidance.next_call,
    { tool: "coc_invoke" },
  );
  assert.equal(
    directGuided.envelope.data.host_recovery_guidance.then.tool,
    "coc_invoke",
  );
  assert.equal(
    JSON.stringify(directGuided.envelope.data.host_recovery_guidance)
      .includes("coc_turn_output_context"),
    false,
    "direct-finalize live guidance has no stale output-context pointer",
  );
  // Direct finalize supports the coc_invoke card invoke_via surface, and no
  // review projection or draft review input exists on this path.
  const directGuidance = directGuided.envelope.data.host_recovery_guidance;
  assert.equal(directGuidance.model_calls.finalize.invoke_via, "coc_invoke");
  assert.equal(directGuidance.model_calls.review, undefined);
  assert.equal(directGuidance.review_recovery.review_input, undefined);
  assert.equal(
    JSON.stringify(directGuidance).includes(liveDraftText),
    false,
    "direct-finalize guidance carries no frozen draft",
  );
  assert.deepEqual(directGuided.audit.model_call_projection, {
    review: false,
    finalize: true,
  });
  assert.equal(directGuided.audit.frozen_draft_review_input, false);
  // A live review chain whose producer receipt is missing the exact frozen
  // draft is unusable: fail closed to card-free pointer guidance, no review
  // card, and an honest unusable audit source.
  const draftlessCards = validateLiveOutputContext(
    liveEnvelope(() => {}, null),
    null,
  );
  assert.ok(draftlessCards !== null);
  assert.equal(draftlessCards.frozenDraft, null);
  const draftlessGuided = applyPendingFinalizationRecoveryGuidance(
    conflictEnvelope,
    { root, campaign: "recovery-guide-campaign" },
    { liveHydration: { status: "success", cards: draftlessCards } },
  );
  assert.equal(
    draftlessGuided.envelope.data.host_recovery_guidance.output_context_status,
    undefined,
    "live chain without the frozen draft must not claim host_refreshed_live",
  );
  assert.equal(
    draftlessGuided.envelope.data.host_recovery_guidance.review_recovery.card,
    undefined,
  );
  assert.equal(
    draftlessGuided.envelope.data.host_recovery_guidance.model_calls,
    undefined,
  );
  assert.equal(
    draftlessGuided.audit.card_source,
    "host_refreshed_live_unusable_card_free",
  );
  const unavailableGuided = applyPendingFinalizationRecoveryGuidance(
    conflictEnvelope,
    { root, campaign: "recovery-guide-campaign" },
    { liveHydration: { status: "unavailable" } },
  );
  assert.deepEqual(
    unavailableGuided.envelope.data.host_recovery_guidance.next_call,
    {
      tool: "coc_turn_output_context",
      arguments: { root, campaign: "recovery-guide-campaign" },
    },
    "failed hydration must project no snapshot card at all",
  );
  assert.equal(
    unavailableGuided.envelope.data.host_recovery_guidance.review_recovery.card,
    undefined,
  );
  assert.equal(
    unavailableGuided.envelope.data.host_recovery_guidance.then.card,
    undefined,
  );
  assert.equal(
    unavailableGuided.envelope.data.host_recovery_guidance.card_projection,
    undefined,
  );
  assert.equal(
    unavailableGuided.audit.card_source,
    "host_refresh_unavailable_card_free",
  );
}

// Full extension path: pointer-only resume → exactly one host-owned fetch →
// live cards with the review card as the next model action, progress
// advancing output_context_ready BEFORE the resume's review_ready inference,
// and a subsequent typed narration.review free of the compiler-context
// precondition failure.
const stubCompilerInfer = async (input) => ({
  result: {
    schema_version: 1,
    contract_id: "coc.pi-state-claim-compiler-result.v1",
    disposition: "no_claims_detected",
    reason: "每一段草稿都已复核。",
    claims: [],
    paragraph_coverage: draftParagraphs(input.draft_text).map((text, paragraph_index) => ({
      paragraph_index,
      paragraph_sha256: canonicalDigest(text),
      claim_indices: [],
    })),
  },
  responseModel: { provider: "offline", id: "offline", api: "openai-responses" },
});
const liveCampaign = "recovery-guide-campaign";
process.env.COC_PI_SESSION_ROLE = "play";
const liveHost = harness((name, params) => {
  if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
  if (params.operation === "session.resume") return pointerOnlyPendingEnvelope(liveCampaign);
  if (params.operation === "turn.output_context") return liveEnvelope();
  if (params.operation === "narration.review") {
    return {
      ok: true,
      tool: "narration.review",
      data: {
        accepted: true,
        review_id: "review-live-1",
        revision: 2,
        state_claim_compilation: params.arguments.state_claim_compilation,
      },
    };
  }
  throw new Error(`unexpected ${params.operation}`);
}, liveCampaign, root, [], {
  createStateClaimCompiler: () => new PiStateClaimCompiler(stubCompilerInfer),
});
await liveHost.start();
delete process.env.COC_PI_SESSION_ROLE;
const liveResumed = await invoke(
  liveHost,
  "live-hydrate-resume",
  resumeParams(liveCampaign),
  "coc_setup",
);
assert.equal(liveResumed.ok, true);
const liveFetches = liveHost.clientCalls.filter((call) => (
  call.name === "coc_invoke"
  && call.params?.operation === "turn.output_context"
));
assert.equal(liveFetches.length, 1, "exactly one host output-context fetch");
assert.deepEqual(liveFetches[0].params, {
  operation: "turn.output_context",
  root,
  campaign: liveCampaign,
  arguments: {},
});
// Hydration is context observation only: the host never invokes review,
// finalize, rules, or state operations on the KP's behalf.
assert.equal(
  liveHost.clientCalls.filter((call) => (
    call.name === "coc_invoke"
    && (
      call.params?.operation === "narration.review"
      || call.params?.operation === "turn.finalize"
      || String(call.params?.operation || "").startsWith("rules.")
      || String(call.params?.operation || "").startsWith("state.")
    )
  )).length,
  0,
  "hydration must never invoke review, finalize, rules, or state operations",
);
const liveGuidance = liveResumed.data.host_recovery_guidance;
assert.equal(liveGuidance.output_context_status, "host_refreshed_live");
assert.deepEqual(liveGuidance.next_call, { tool: "coc_narration_review" });
assert.equal(liveGuidance.next_call.card, undefined, "first card is not duplicated");
assert.deepEqual(liveGuidance.review_recovery.card, {
  ...liveReviewCard(),
  // Gateway boundary sanitizes opaque identity from model content; the host
  // injects the exact turn/source binding at invoke time.
  prefilled_arguments: { revision: 2 },
});
assert.deepEqual(liveGuidance.then.card, liveFinalizeCard());
assert.equal(liveGuidance.review_recovery.revision, 2);
assert.equal(liveGuidance.card_projection.source, "host_refreshed_live_context");
// The exact frozen draft rides once, keeper-only, inside the review input.
assert.deepEqual(liveGuidance.review_recovery.review_input, {
  visibility: "keeper_only",
  source: "turn.output_context.data.frozen_narration_draft",
  mode: "exact_replay",
  baseline_draft_text: liveDraftText,
  instruction: liveGuidance.review_recovery.review_input.instruction,
});
assert.equal(
  JSON.stringify(liveGuidance).split(liveDraftText).length - 1,
  1,
  "full-path guidance must carry the frozen draft exactly once",
);
assert.equal(liveGuidance.model_calls.review.invoke_via, "coc_narration_review");
assert.equal(liveGuidance.model_calls.finalize.invoke_via, "coc_turn_finalize");
assert.equal(
  liveGuidance.model_calls.review.model_owned_required_arguments.includes(
    "draft_text",
  ),
  true,
  "the review model call must use the actual typed parameter name draft_text",
);
assert.equal(liveGuidance.card_projection.authoritative_copy, undefined);
assert.equal(liveGuidance.review_recovery.exact_card_path, undefined);
assert.equal(liveGuidance.then.exact_card_path, undefined);
assert.equal(liveGuidance.then.tool, liveFinalizeCard().invoke_via);
assert.equal(
  JSON.stringify(liveGuidance).includes("coc_turn_output_context"),
  false,
  "full-path successful guidance must contain no output-context pointer",
);
assert.equal(
  liveGuidance.card_projection.instruction.includes("already ingested"),
  true,
);
assert.deepEqual(
  liveResumed.data.pending_output_context,
  { status: "host_refreshed_live" },
);
// Guidance carries only the exact cards plus minimal authority metadata.
const liveGuidanceJson = JSON.stringify(liveGuidance);
assert.equal(liveGuidanceJson.includes("settlement_snapshot_id"), false);
assert.equal(liveGuidanceJson.includes("mechanics_bundle_sha256"), false);
assert.equal(liveGuidanceJson.includes("pc_subject_refs"), false);
assert.equal(liveGuidanceJson.includes("manifest_revision"), false);
// The live receipt is ingested at its true stage first: an advanced
// output_context_ready entry must precede the resume's review_ready entry,
// with no regressive rejection of the output-context observation.
{
  const progressEntries = liveHost.audits.filter((entry) => (
    entry.name === "coc-canonical-turn-progress"
  ));
  const advancedStages = progressEntries
    .filter((entry) => entry.value?.status === "advanced")
    .map((entry) => entry.value.stage);
  assert.ok(advancedStages.includes("output_context_ready"), "live receipt advances progress");
  assert.ok(advancedStages.includes("review_ready"), "resume inference advances progress");
  assert.ok(
    advancedStages.indexOf("output_context_ready") < advancedStages.indexOf("review_ready"),
    "output_context_ready must be reached before review_ready",
  );
  assert.ok(
    !progressEntries.some((entry) => (
      entry.value?.status === "rejected" && entry.value?.stage === "output_context_ready"
    )),
    "output-context observation must never be regressive",
  );
  // Hydration is context observation only: every progress entry stays inside
  // the same player turn epoch — hydration never opens a new player epoch.
  assert.ok(progressEntries.length > 0);
  assert.ok(
    progressEntries.every((entry) => entry.value?.player_turn_epoch === 0),
    "hydration must never create a new player epoch",
  );
}
assert.ok(
  liveHost.audits.some((entry) => (
    entry.name === "coc-typed-tool-binding"
    && entry.value?.operation === "narration.review"
    && entry.value?.status === "armed"
  )),
  "live hydration must arm the retained narration-review binding",
);
assert.ok(
  liveHost.audits.some((entry) => (
    entry.name === "coc-pending-finalization-live-context"
    && entry.value?.status === "refreshed"
    && entry.value?.campaign_id === liveCampaign
    && entry.value?.turn_id === liveTurnId
  )),
);
assertNoPlayerLeak(liveHost, "live hydration");
// The precondition the whole feature exists to remove: a real typed
// narration.review over the hydrated context must compile and be accepted,
// with host-bound identities on the canonical call.
const liveReview = await invoke(
  liveHost,
  "live-hydrate-review",
  {
    draft_text: "诺特仍坐在桌后等你的答复，烛火映着未寄出的信。",
    findings: [],
    state_authority_review: {
      disposition: "no_player_state_change_claimed",
      reason: "没有调查员状态变化。",
      claims: [],
    },
  },
  "coc_narration_review",
);
assert.equal(liveReview.ok, true, JSON.stringify(liveReview));
assert.equal(liveReview.error, undefined, "no state_claim_compiler_context_missing");
const liveReviewCalls = liveHost.clientCalls.filter((call) => (
  call.name === "coc_invoke" && call.params?.operation === "narration.review"
));
assert.equal(liveReviewCalls.length, 1);
assert.equal(liveReviewCalls[0].params.arguments.turn_id, liveTurnId);
assert.equal(liveReviewCalls[0].params.arguments.source_digest, liveSourceDigest);
assert.equal(liveReviewCalls[0].params.arguments.revision, 2);
assert.equal(
  liveReviewCalls[0].params.arguments.state_claim_compilation?.contract_id,
  "coc.pi-state-claim-compilation-receipt.v1",
);
assertNoPlayerLeak(liveHost, "live hydration review");
// Repeated resume of the same pending identity coalesces: no refetch, the
// same live guidance.
const liveResumedAgain = await invoke(
  liveHost,
  "live-hydrate-resume-2",
  resumeParams(liveCampaign),
  "coc_setup",
);
assert.equal(outputContextFetchCount(liveHost), 1, "repeated pending identity must not refetch");
assert.equal(
  liveResumedAgain.data.host_recovery_guidance.output_context_status,
  "host_refreshed_live",
);
assert.deepEqual(
  liveResumedAgain.data.host_recovery_guidance.review_recovery.card,
  {
    ...liveReviewCard(),
    prefilled_arguments: { revision: 2 },
  },
);
await liveHost.shutdown();

// Concurrent resume handling of the same pending identity shares one fetch.
{
  // The harness campaign must equal the receipt campaign so the live
  // hydration campaign binding holds.
  const concurrentCampaign = "recovery-guide-campaign";
  const concurrentHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") {
      return pointerOnlyPendingEnvelope(concurrentCampaign);
    }
    if (params.operation === "turn.output_context") {
      return (async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return liveEnvelope();
      })();
    }
    throw new Error(`unexpected ${params.operation}`);
  }, concurrentCampaign);
  await concurrentHost.start();
  const [first, second] = await Promise.all([
    invoke(concurrentHost, "concurrent-resume-1", resumeParams(concurrentCampaign), "coc_setup"),
    invoke(concurrentHost, "concurrent-resume-2", resumeParams(concurrentCampaign), "coc_setup"),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(
    outputContextFetchCount(concurrentHost),
    1,
    "concurrent same-identity resumes share one in-flight fetch",
  );
  assert.equal(first.data.host_recovery_guidance.output_context_status, "host_refreshed_live");
  assert.equal(second.data.host_recovery_guidance.output_context_status, "host_refreshed_live");
  assertNoPlayerLeak(concurrentHost, "concurrent hydration");
  await concurrentHost.shutdown();
}

// Session reset clears the latch: a new generation refetches once.
{
  const resetCampaign = "recovery-guide-campaign";
  const resetHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") return pointerOnlyPendingEnvelope(resetCampaign);
    if (params.operation === "turn.output_context") return liveEnvelope();
    throw new Error(`unexpected ${params.operation}`);
  }, resetCampaign);
  await resetHost.start();
  const beforeReset = await invoke(resetHost, "reset-resume-1", resumeParams(resetCampaign), "coc_setup");
  assert.equal(beforeReset.data.host_recovery_guidance.output_context_status, "host_refreshed_live");
  assert.equal(outputContextFetchCount(resetHost), 1);
  await resetHost.restart();
  const afterReset = await invoke(resetHost, "reset-resume-2", resumeParams(resetCampaign), "coc_setup");
  assert.equal(outputContextFetchCount(resetHost), 2, "session reset permits one fresh fetch");
  assert.equal(afterReset.data.host_recovery_guidance.output_context_status, "host_refreshed_live");
  await resetHost.shutdown();
}

// An identity-less pending resume never wildcard-reuses an identified
// attempt; a genuinely changed identity gets one new fetch.
{
  const identityCampaign = "recovery-guide-campaign";
  let resumeCount = 0;
  const identityHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") {
      resumeCount += 1;
      return resumeCount === 1
        ? pendingIndexEnvelope(identityCampaign)
        : pointerOnlyPendingEnvelope(identityCampaign);
    }
    if (params.operation === "turn.output_context") return liveEnvelope();
    throw new Error(`unexpected ${params.operation}`);
  }, identityCampaign);
  await identityHost.start();
  const identified = await invoke(identityHost, "identity-resume-1", resumeParams(identityCampaign), "coc_setup");
  assert.equal(identified.data.host_recovery_guidance.output_context_status, "host_refreshed_live");
  const identityLess = await invoke(identityHost, "identity-resume-2", resumeParams(identityCampaign), "coc_setup");
  assert.equal(
    outputContextFetchCount(identityHost),
    2,
    "identity-less pending must not reuse an identified attempt",
  );
  assert.equal(
    identityLess.data.host_recovery_guidance.output_context_status,
    "host_refreshed_live",
  );
  await identityHost.shutdown();
}
{
  const turnTwoId = "turn-live-hydrate-2";
  const turnTwoSource = "sha256:live-source-hydrate-2";
  const turnTwoEnvelope = () => liveEnvelope((data) => {
    data.turn_id = turnTwoId;
    data.source_digest = turnTwoSource;
    data.settlement_snapshot_id = "turn-settlement-v1:live-hydrate-2";
    data.mechanics_bundle_sha256 = "sha256:live-mechanics-hydrate-2";
    data.agency_review_operation = {
      ...liveReviewCard(2),
      prefilled_arguments: { turn_id: turnTwoId, source_digest: turnTwoSource, revision: 2 },
    };
    data.finalize_operation = {
      ...liveFinalizeCard("coc_turn_finalize", 2),
      prefilled_arguments: {
        decision_id: `${turnTwoId}:player-epoch-8:revision-2:finalize`,
        revision: 2,
        coverage: [],
      },
    };
  });
  let resumeCount = 0;
  const changedCampaign = "recovery-guide-campaign";
  const changedHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") {
      resumeCount += 1;
      return resumeCount === 1
        ? pendingIndexEnvelope(changedCampaign)
        : pendingIndexEnvelope(changedCampaign, turnTwoId, turnTwoSource);
    }
    if (params.operation === "turn.output_context") {
      return resumeCount === 1 ? liveEnvelope() : turnTwoEnvelope();
    }
    throw new Error(`unexpected ${params.operation}`);
  }, changedCampaign);
  await changedHost.start();
  const firstChanged = await invoke(changedHost, "changed-resume-1", resumeParams(changedCampaign), "coc_setup");
  // Identity values are host-only at the gateway boundary; the model-visible
  // card carries the semantic revision ordinal, and the changed-identity
  // refetch below proves the host retained the exact turn binding.
  assert.equal(
    firstChanged.data.host_recovery_guidance.review_recovery.card.prefilled_arguments.revision,
    2,
  );
  const secondChanged = await invoke(changedHost, "changed-resume-2", resumeParams(changedCampaign), "coc_setup");
  assert.equal(outputContextFetchCount(changedHost), 2, "changed identity refetches once");
  assert.equal(
    secondChanged.data.host_recovery_guidance.review_recovery.card.prefilled_arguments.revision,
    2,
  );
  assert.equal(secondChanged.data.host_recovery_guidance.review_recovery.revision, 2);
  await changedHost.shutdown();
}

// A deferred old attempt that is superseded by a revision-qualified pending
// identity is discarded whole. Only the new identity may commit/fetch once.
{
  const raceCampaign = "recovery-guide-campaign";
  const revisionOneEnvelope = () => liveEnvelope((data) => {
    data.agency_review_operation = liveReviewCard(1);
    data.finalize_operation = liveFinalizeCard("coc_turn_finalize", 1);
  });
  const revisionTwoEnvelope = () => liveEnvelope((data) => {
    data.agency_review_operation = liveReviewCard(2);
    data.finalize_operation = liveFinalizeCard("coc_turn_finalize", 2);
  });
  let resumeCount = 0;
  let contextCount = 0;
  let releaseOld = () => {};
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const raceHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") {
      resumeCount += 1;
      const pending = pendingIndexEnvelope(raceCampaign);
      pending.data.pending_output_context.revision = resumeCount === 1 ? 1 : 2;
      return pending;
    }
    if (params.operation === "turn.output_context") {
      contextCount += 1;
      if (contextCount === 1) {
        return (async () => {
          await oldGate;
          return revisionOneEnvelope();
        })();
      }
      return revisionTwoEnvelope();
    }
    throw new Error(`unexpected ${params.operation}`);
  }, raceCampaign);
  await raceHost.start();
  const oldResume = invoke(
    raceHost,
    "identity-race-old",
    resumeParams(raceCampaign),
    "coc_setup",
  );
  await new Promise((resolve) => setImmediate(resolve));
  const newResume = await invoke(
    raceHost,
    "identity-race-new",
    resumeParams(raceCampaign),
    "coc_setup",
  );
  releaseOld();
  const staleResume = await oldResume;
  assert.equal(outputContextFetchCount(raceHost), 2);
  assert.equal(
    newResume.data.host_recovery_guidance.review_recovery.revision,
    2,
    "new revision-qualified identity commits its one live fetch",
  );
  assert.equal(
    staleResume.data.host_recovery_guidance,
    undefined,
    "superseded result receives no recovery guidance",
  );
  const refreshedTurns = raceHost.audits
    .filter((entry) => (
      entry.name === "coc-pending-finalization-live-context"
      && entry.value?.status === "refreshed"
    ))
    .map((entry) => entry.value.turn_id);
  assert.deepEqual(refreshedTurns, [liveTurnId]);
  await raceHost.shutdown();
}

// A new external-player epoch supersedes an in-flight hydration even when
// the semantic pending pointer is unchanged. The old result cannot commit;
// the current epoch gets exactly one fresh attempt.
{
  const epochRaceCampaign = "recovery-guide-campaign";
  let contextCount = 0;
  let releaseOld = () => {};
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const epochRaceHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") {
      return pendingIndexEnvelope(epochRaceCampaign);
    }
    if (params.operation === "turn.output_context") {
      contextCount += 1;
      if (contextCount === 1) {
        return (async () => {
          await oldGate;
          return liveEnvelope();
        })();
      }
      return liveEnvelope();
    }
    throw new Error(`unexpected ${params.operation}`);
  }, epochRaceCampaign);
  await epochRaceHost.start();
  const oldResume = invoke(
    epochRaceHost,
    "epoch-race-old",
    resumeParams(epochRaceCampaign),
    "coc_setup",
  );
  await new Promise((resolve) => setImmediate(resolve));
  await epochRaceHost.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: "我重新确认现在要说的话。" }],
  });
  releaseOld();
  const staleResume = await oldResume;
  assert.equal(staleResume.data.host_recovery_guidance, undefined);
  assert.equal(
    epochRaceHost.audits.some((entry) => (
      entry.name === "coc-pending-finalization-live-context"
      && entry.value?.status === "refreshed"
    )),
    false,
    "old player epoch cannot record a refreshed hydration",
  );
  const currentResume = await invoke(
    epochRaceHost,
    "epoch-race-current",
    resumeParams(epochRaceCampaign),
    "coc_setup",
  );
  assert.equal(outputContextFetchCount(epochRaceHost), 2);
  assert.equal(
    currentResume.data.host_recovery_guidance.output_context_status,
    "host_refreshed_live",
  );
  await epochRaceHost.shutdown();
}

// Cancellation before transport: no fetch at all, card-free guidance.
{
  const abortCampaign = "recovery-guide-campaign";
  const abortHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") return pointerOnlyPendingEnvelope(abortCampaign);
    if (params.operation === "turn.output_context") return liveEnvelope();
    throw new Error(`unexpected ${params.operation}`);
  }, abortCampaign);
  await abortHost.start();
  const aborted = new AbortController();
  aborted.abort("cancelled");
  const abortedResumed = await invokeWithSignal(
    abortHost,
    "abort-resume",
    resumeParams(abortCampaign),
    aborted.signal,
    "coc_setup",
  );
  assert.equal(abortedResumed.ok, true);
  assert.equal(outputContextFetchCount(abortHost), 0, "pre-transport abort performs no fetch");
  assertCardFreePointerGuidance(abortHost, abortCampaign, abortedResumed, "pre-transport abort");
  // The aborted caller did not cache a failure: a normal retry fetches once.
  const retryResumed = await invoke(abortHost, "abort-retry", resumeParams(abortCampaign), "coc_setup");
  assert.equal(outputContextFetchCount(abortHost), 1);
  assert.equal(
    retryResumed.data.host_recovery_guidance.output_context_status,
    "host_refreshed_live",
  );
  await abortHost.shutdown();
}

// Cancellation after transport: the fetched receipt is discarded whole — no
// compiler/binding/progress observation ran — and the failure is not cached.
{
  const lateAbortCampaign = "recovery-guide-campaign";
  let releaseFetch = () => {};
  const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });
  const lateAbortHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") {
      return pointerOnlyPendingEnvelope(lateAbortCampaign);
    }
    if (params.operation === "turn.output_context") {
      return (async () => {
        await fetchGate;
        return liveEnvelope();
      })();
    }
    throw new Error(`unexpected ${params.operation}`);
  }, lateAbortCampaign);
  await lateAbortHost.start();
  const controller = new AbortController();
  const resumePromise = (async () => invokeWithSignal(
    lateAbortHost,
    "late-abort-resume",
    resumeParams(lateAbortCampaign),
    controller.signal,
    "coc_setup",
  ))();
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort("cancelled");
  releaseFetch();
  const lateAborted = await resumePromise;
  assert.equal(lateAborted.ok, true);
  assert.equal(outputContextFetchCount(lateAbortHost), 1);
  assertCardFreePointerGuidance(lateAbortHost, lateAbortCampaign, lateAborted, "post-transport abort");
  assert.equal(
    lateAbortHost.audits.some((entry) => (
      entry.name === "coc-typed-tool-binding"
      && entry.value?.operation === "narration.review"
      && entry.value?.status === "armed"
    )),
    false,
    "a cancelled hydration must leave no armed binding",
  );
  assert.equal(
    lateAbortHost.audits.some((entry) => (
      entry.name === "coc-canonical-turn-progress"
      && entry.value?.stage === "output_context_ready"
    )),
    false,
    "a cancelled hydration must not advance canonical progress",
  );
  // Caller-local cancellation is not a cached failure: a fresh resume for
  // the same identity fetches once and succeeds.
  const afterCancel = await invoke(
    lateAbortHost,
    "late-abort-retry",
    resumeParams(lateAbortCampaign),
    "coc_setup",
  );
  assert.equal(outputContextFetchCount(lateAbortHost), 2);
  assert.equal(
    afterCancel.data.host_recovery_guidance.output_context_status,
    "host_refreshed_live",
  );
  await lateAbortHost.shutdown();
}

// Failure matrix: every attempted-and-failed hydration is card-free (even
// with a partially valid snapshot chain), fetches exactly once, caches the
// failure against refetch storms, and never latches a fault.
const partialSnapshotPendingEnvelope = (campaignId) => {
  const envelope = pointerOnlyPendingEnvelope(campaignId);
  envelope.data.pending_output_context = {
    agency_review_operation: reviewCardFixture(),
    finalize_operation: { operation: "turn.finalize", invoke_via: "coc_invoke" },
  };
  return envelope;
};
for (const [label, liveResponse, resumeBuilder] of [
  ["transport rejection", () => {
    throw new Error("coc transport unavailable");
  }, pointerOnlyPendingEnvelope],
  ["canonical failure envelope", () => ({
    ok: false,
    tool: "turn.output_context",
    error: { code: "campaign_not_found", message: "missing" },
  }), pointerOnlyPendingEnvelope],
  ["malformed live chain", () => liveEnvelope((data) => {
    data.finalize_operation = { operation: "turn.finalize", invoke_via: "coc_invoke" };
  }), pointerOnlyPendingEnvelope],
  ["missing review identities", () => liveEnvelope((data) => {
    delete data.agency_review_operation.prefilled_arguments.turn_id;
    delete data.agency_review_operation.prefilled_arguments.source_digest;
  }), pointerOnlyPendingEnvelope],
  ["wrong mode-specific finalize surface", () => liveEnvelope((data) => {
    data.finalize_operation = liveFinalizeCard("coc_invoke");
  }), pointerOnlyPendingEnvelope],
  ["identity mismatch with pending turn", () => liveEnvelope((data) => {
    data.turn_id = "turn-forged-live-9";
    data.agency_review_operation = {
      ...liveReviewCard(),
      prefilled_arguments: {
        turn_id: "turn-forged-live-9",
        source_digest: liveSourceDigest,
        revision: 2,
      },
    };
  }), pendingIndexEnvelope],
  ["partial snapshot plus failed hydration", () => {
    throw new Error("coc transport unavailable");
  }, partialSnapshotPendingEnvelope],
]) {
  const failCampaign = `startup-pending-live-fail-${label.replace(/[^a-z]+/g, "-")}`;
  const failHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") return resumeBuilder(failCampaign);
    if (params.operation === "turn.output_context") return liveResponse();
    throw new Error(`unexpected ${params.operation}`);
  }, failCampaign);
  await failHost.start();
  const failResumed = await invoke(
    failHost,
    `fail-resume-${label}`,
    resumeParams(failCampaign),
    "coc_setup",
  );
  assert.equal(failResumed.ok, true, label);
  assertCardFreePointerGuidance(failHost, failCampaign, failResumed, label);
  assert.equal(outputContextFetchCount(failHost), 1, `${label}: exactly one attempt, no retry`);
  assert.ok(
    failHost.audits.some((entry) => (
      entry.name === "coc-pending-finalization-live-context"
      && entry.value?.status === "unavailable"
      && entry.value?.campaign_id === failCampaign
    )),
    label,
  );
  assert.equal(
    failHost.audits.some((entry) => entry.name === "coc-turn-processing-fault"),
    false,
    `${label}: private hydration failure never latches a fault`,
  );
  // The failed identity is cached: a repeated resume does not refetch.
  const failRepeated = await invoke(
    failHost,
    `fail-resume-repeat-${label}`,
    resumeParams(failCampaign),
    "coc_setup",
  );
  assert.equal(failRepeated.ok, true, label);
  assert.equal(outputContextFetchCount(failHost), 1, `${label}: repeated failure identity does not refetch`);
  assertCardFreePointerGuidance(failHost, failCampaign, failRepeated, label);
  await failHost.shutdown();
}

// Every private hydration observer checkpoint is transactional. Inject a
// failure after compiler fact creation, after retained binding creation, and
// after canonical progress/circuit observation; each must restore the exact
// pre-attempt compiler fact, leave no binding/progress audit, cache one
// card-free failure, and never reach the canonical review transport.
for (const failureStage of ["compiler", "binding", "progress"]) {
  const observerCampaign = `startup-pending-live-observer-${failureStage}`;
  const retained = new Map();
  const compiler = {
    retained,
    observeOutputContext(campaignId, envelope) {
      retained.set(campaignId, {
        turnId: envelope.data.turn_id,
        sourceDigest: envelope.data.source_digest,
        revision: envelope.data.agency_review_operation.prefilled_arguments.revision,
      });
    },
    compileReview() {
      throw new Error("compiler context should have rolled back");
    },
    releaseLatchedFailure() { return false; },
    beginExternalTurn() {},
    clear() { retained.clear(); },
  };
  const observerHost = harness((name, params) => {
    if (name !== "coc_invoke") throw new Error(`unexpected ${name}`);
    if (params.operation === "session.resume") {
      return pointerOnlyPendingEnvelope(observerCampaign);
    }
    if (params.operation === "turn.output_context") return liveEnvelope();
    if (params.operation === "narration.review") {
      throw new Error("rolled-back review binding reached transport");
    }
    throw new Error(`unexpected ${params.operation}`);
  }, observerCampaign, root, [], {
    createStateClaimCompiler: () => compiler,
    hostHydrationObserverCheckpoint: (stage) => {
      if (stage === failureStage) throw new Error(`injected after ${stage}`);
    },
  });
  await observerHost.start();
  const baselineFact = { turnId: "turn-before-hydration", revision: 2 };
  retained.set(observerCampaign, baselineFact);
  const observerResumed = await invoke(
    observerHost,
    `observer-${failureStage}-resume`,
    resumeParams(observerCampaign),
    "coc_setup",
  );
  assert.equal(observerResumed.ok, true);
  assertCardFreePointerGuidance(
    observerHost,
    observerCampaign,
    observerResumed,
    `observer ${failureStage} failure`,
  );
  assert.equal(outputContextFetchCount(observerHost), 1);
  assert.equal(
    retained.get(observerCampaign),
    baselineFact,
    `${failureStage}: compiler campaign fact restored by identity`,
  );
  assert.equal(
    observerHost.audits.some((entry) => (
      entry.name === "coc-typed-tool-binding"
      && entry.value?.operation === "narration.review"
      && entry.value?.status === "armed"
    )),
    false,
    `${failureStage}: no committed binding observation`,
  );
  assert.equal(
    observerHost.audits.some((entry) => (
      entry.name === "coc-canonical-turn-progress"
      && entry.value?.stage === "output_context_ready"
    )),
    false,
    `${failureStage}: no committed progress observation`,
  );
  const observerRepeated = await invoke(
    observerHost,
    `observer-${failureStage}-resume-2`,
    resumeParams(observerCampaign),
    "coc_setup",
  );
  assert.equal(
    outputContextFetchCount(observerHost),
    1,
    `${failureStage}: failed identity is cached`,
  );
  assertCardFreePointerGuidance(
    observerHost,
    observerCampaign,
    observerRepeated,
    `observer ${failureStage} repeat`,
  );
  const reviewAttempt = await invoke(
    observerHost,
    `observer-${failureStage}-review`,
    {
      draft_text: "这段文字不应越过已回滚的绑定。",
      findings: [],
      state_authority_review: {
        disposition: "no_player_state_change_claimed",
        reason: "无状态变化。",
        claims: [],
      },
    },
    "coc_narration_review",
  );
  assert.equal(reviewAttempt.ok, false, failureStage);
  assert.equal(
    observerHost.clientCalls.filter((call) => (
      call.name === "coc_invoke"
      && call.params?.operation === "narration.review"
    )).length,
    0,
    `${failureStage}: rolled-back binding cannot invoke review`,
  );
  await observerHost.shutdown();
}


for (const [label, mode, next] of [
  ["table_opening", "table_opening", ["evidence.table_opening"]],
  ["awaiting_player", "awaiting_player", ["interpret_current_player_message"]],
]) {
  const campaignId = `startup-${label}`;
  const h = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected ${params.operation}`);
    }
    return resumeEnvelope(mode, {
      campaign_id: campaignId,
      next_operations: next,
    });
  }, campaignId);
  await h.start();
  const resumed = await invoke(h, `${label}-resume`, resumeParams(campaignId), "coc_setup");
  assert.equal(resumed.ok, true, label);
  assert.equal(resumed.data.mode, mode, label);
  assert.equal(resumed.data.host_recovery_guidance, undefined, label);
  assert.equal(
    h.audits.some((entry) => entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT),
    false,
    label,
  );
  // Non-pending resume modes never trigger a host output-context fetch.
  assert.equal(
    h.clientCalls.filter((call) => (
      call.name === "coc_invoke"
      && call.params?.operation === "turn.output_context"
    )).length,
    0,
    `${label}: no host output-context fetch`,
  );
  if (label === "table_opening") {
    assert.ok(
      h.activeTools.length > 0 && h.activeTools.at(-1).length > 0,
      "table_opening must not quarantine the active tool surface",
    );
    // The normal output gate adjudicates an assistant final only against
    // the current external player epoch. Mark that epoch first (the same
    // message_start fixture the silent-resume blocks use below) so the
    // gate and canonical progress agree when the settled-output recovery
    // claim runs on the suppressed final.
    await h.emit("message_start", {
      role: "user",
      content: [{ type: "text", text: "我推开了教堂的大门，里面一片漆黑。" }],
    });
    const openingProse = await h.emit("message_end", {
      role: "assistant",
      content: [{ type: "text", text: "你翻开手边的守则，准备宣布开场。" }],
      stopReason: "stop",
    });
    assert.equal(
      openingProse.content.some((part) => part.type === "text"),
      false,
      "table_opening plain final is adjudicated by the normal gate, not the quarantine",
    );
    assert.ok(
      h.sent.some((entry) => (
        entry.options?.triggerTurn === true
        && entry.options?.deliverAs === "followUp"
        && (
          entry.message?.customType === "coc-settled-output-gate"
          || entry.message?.customType === "coc-mechanical-output-gate"
          || entry.message?.customType === "coc-opening-setup-route"
        )
      )),
      "table_opening suppression flows through the normal output gate follow-up",
    );
  } else {
    assert.deepEqual(
      h.activeTools.at(-1),
      [],
      "awaiting_player must quarantine the same auto-open turn",
    );
  }
  await h.shutdown();
}

const prefixWorkspace = mkdtempSync(path.join(tmpdir(), "pi-coc-ready-prefix-"));
const prefixCampaign = "ready-setup-prefix-host";
mkdirSync(path.join(prefixWorkspace, ".coc", "campaigns", prefixCampaign, "save"), {
  recursive: true,
});
writeFileSync(
  path.join(prefixWorkspace, ".coc", "campaigns", prefixCampaign, "campaign.json"),
  `${JSON.stringify({
    schema_version: 1,
    campaign_id: prefixCampaign,
    status: "ready_for_table",
    setup_handoff: {
      decision_id: "handoff-ready-setup-prefix-host",
      completed_at: "2026-08-22T12:33:04.162349Z",
    },
  })}\n`,
);
writeFileSync(
  path.join(prefixWorkspace, ".coc", "campaigns", prefixCampaign, "save", "world-state.json"),
  `${JSON.stringify({ status: "setup", active_subsystem: "setup" })}\n`,
);
const prefixHost = harness((name, params) => {
  if (params.operation !== "session.resume") {
    throw new Error(`unexpected ${params.operation}`);
  }
  return resumeEnvelope("open_turn_recovery", {
    campaign_id: prefixCampaign,
    next_operations: ["continue_current_turn_from_receipts"],
    current_turn: {
      meaningful_row_count: 3,
      rows: [
        { tool: "rules.roll_dice", ok: true },
        { tool: "progressive.opening_bootstrap", ok: true },
        { tool: "setup.complete", ok: true },
      ],
    },
  });
}, prefixCampaign, prefixWorkspace);
await prefixHost.start();
const prefixResumed = await invoke(prefixHost, "prefix-resume", {
  operation: "session.resume",
  root: prefixWorkspace,
  campaign: prefixCampaign,
  arguments: {},
}, "coc_setup");
assert.equal(prefixResumed.ok, true);
assert.equal(prefixResumed.data.mode, "table_opening");
assert.deepEqual(prefixResumed.data.next_operations, ["evidence.table_opening"]);
assert.equal(prefixResumed.data.host_recovery_guidance, undefined);
assert.equal(
  prefixHost.audits.some((entry) => entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT),
  false,
);
await prefixHost.shutdown();

const pendingCampaign = "startup-pending-finalization";
const pending = harness((name, params) => {
  if (name !== "coc_invoke" || params.operation !== "session.resume") {
    throw new Error(`unexpected ${name}:${params.operation}`);
  }
  const envelope = resumeEnvelope("pending_finalization", {
    campaign_id: pendingCampaign,
    next_operations: ["turn.finalize"],
  });
  envelope.data.current_turn = { rows: [{ large: "receipt".repeat(400) }] };
  envelope.data.pending_output_context = {
    journal_decision_id: "journal:pending",
    required_obligation_ids: ["obligation-1"],
    mechanics_bundle: { large: "mechanics".repeat(400) },
  };
  return envelope;
}, pendingCampaign);
await pending.start();
const pendingResumed = await invoke(
  pending,
  "pending-finalization-resume",
  resumeParams(pendingCampaign),
  "coc_setup",
);
assert.equal(pendingResumed.ok, true);
assert.equal(pendingResumed.data.mode, "pending_finalization");
assert.equal(pendingResumed.data.current_turn, undefined);
assert.equal(
  pendingResumed.data.pending_output_context.status,
  "read_via_exact_typed_call",
);
assert.deepEqual(
  pendingResumed.data.host_recovery_guidance.next_call,
  {
    tool: "coc_turn_output_context",
    arguments: { root, campaign: pendingCampaign },
  },
);
assert.equal(
  pendingResumed.data.host_recovery_guidance.then.tool,
  "coc_turn_finalize",
);
assert.equal(
  pendingResumed.data.host_recovery_guidance.review_recovery.tool,
  "coc_narration_review",
);
assert.equal(
  pendingResumed.data.host_recovery_guidance.review_recovery.armed,
  false,
);
assert.ok(
  pending.audits.some((entry) => (
    entry.name === PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT
    && entry.value?.contract_id
      === PENDING_FINALIZATION_RECOVERY_GUIDANCE_CONTRACT
    && entry.value?.campaign_id === pendingCampaign
  )),
);
assert.ok(
  pending.activeTools.length > 0 && pending.activeTools.at(-1).length > 0,
  "pending_finalization must not quarantine the active tool surface",
);
await pending.shutdown();

// Silent settled startup resume modes (already_acknowledged / awaiting_player)
// acknowledge table state; they are not a new player turn. The remainder of
// the same auto-open agent turn must be quarantined: empty active tools until
// that turn's agent_end, tool-free finals (both non-empty mechanical-looking
// and thinking-only/empty) hidden BEFORE
// OpeningTerminalContinuationGate.acceptVisibleAssistantFinal (so no
// state.journal / second resume / rules-state call can be issued, no settled
// or mechanical output gate arms, no follow-up/prompt is sent — including the
// concurrent coc-empty-terminal-recovery path over the historical player
// epoch — and no prose or history replays), then the normal tool surface
// returns after agent_end for the next genuine external player turn.
const QUARANTINE_MECHANICAL_FINAL = "【明骰】D100=45，你听见远处教堂的钟声。";
// An accepted settled startup resume flips the grant-less session to the
// play role, and a play working set with no loaded module grants honestly
// projects to tools-none. What an unmatched trailing player user keeps is
// the NORMAL audited projection path after the resume: the silent settled
// quarantine (settled/cleared blocks below) applies the empty surface
// directly with no working-set audit at all.
const keepsNormalProjectionSurface = (h, label) => {
  const projections = h.audits.filter(
    (entry) => entry.name === "coc-tool-working-set",
  );
  assert.ok(
    projections.length > 0
      && projections.every((entry) => entry.value?.status === "projected"),
    label,
  );
};
for (const mode of ["already_acknowledged", "awaiting_player"]) {
  const campaignId = `startup-silent-${mode}`;
  const h = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected ${mode} quarantine operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: campaignId });
  }, campaignId);
  await h.start();
  assert.ok(
    h.activeTools.length > 0,
    `${mode}: startup pending gate arms a tool surface`,
  );
  // A silent settled resume replays a session whose transcript already
  // holds the historical player turn; the replayed message_start marks the
  // external player epoch before the auto-open resume settles silently.
  await h.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: "我推开了教堂的大门，里面一片漆黑。" }],
  });
  const toolsBeforeResume = h.activeTools.length;
  const resumed = await invoke(
    h,
    `silent-${mode}-resume`,
    resumeParams(campaignId),
    "coc_setup",
  );
  assert.equal(resumed.ok, true, mode);
  assert.equal(resumed.data.mode, mode, mode);
  assert.equal(resumed.data.host_recovery_guidance, undefined, mode);
  assert.ok(
    h.activeTools.length > toolsBeforeResume,
    `${mode}: silent resume reapplies the tool surface`,
  );
  assert.ok(
    h.activeTools
      .slice(toolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `${mode}: every tool application after the silent resume is empty`,
  );
  const sentAtQuarantine = h.sent.length;
  const clientCallsAtQuarantine = h.clientCalls.length;
  const hiddenFinal = await h.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    hiddenFinal.content.some((part) => part.type === "text"),
    false,
    `${mode}: mechanical-looking tool-free final is hidden while quarantined`,
  );
  assert.equal(
    h.sent.slice(sentAtQuarantine).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
      || entry.message?.customType === "coc-mechanical-output-gate"
      || entry.message?.customType === "coc-settled-output-gate"
      || entry.message?.customType === "coc-settled-output-preflight"
      || entry.message?.customType === "coc-opening-setup-route"
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `${mode}: quarantine sends no recovery custom, follow-up, or prompt`,
  );
  assert.equal(
    h.clientCalls.slice(clientCallsAtQuarantine).some((call) => (
      call.name !== "coc_capabilities"
      && (
        call.params?.operation === "session.resume"
        || (
          typeof call.params?.operation === "string"
          && (call.params.operation.startsWith("state.")
            || call.params.operation.startsWith("rules.")
            || call.params.operation.startsWith("turn."))
        )
      )
    )),
    false,
    `${mode}: quarantine issues no second resume, state.journal, or rules-state call`,
  );
  assert.equal(
    h.audits.some((entry) => (
      entry.name === "coc-mechanical-output-gate"
      || entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT
      || entry.name === PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT
    )),
    false,
    `${mode}: quarantine arms no mechanical/settled/recovery gate`,
  );
  assert.deepEqual(
    h.activeTools.at(-1),
    [],
    `${mode}: tools stay empty through the quarantined turn`,
  );
  // Thinking-only/empty tool-free final while the quarantine is still
  // armed: it must be routed to the empty-terminal callback, hidden, and
  // must NOT let the concurrent empty-terminal recovery path send its
  // coc-empty-terminal-recovery follow-up and re-awaken the historical
  // player epoch the quarantine just closed.
  const thinkingOnlyFinal = await h.emit("message_end", {
    role: "assistant",
    content: [{ type: "thinking", text: "盘点既有收据，不产出玩家正文。" }],
    stopReason: "stop",
  });
  assert.equal(
    thinkingOnlyFinal.content.some((part) => part.type === "text"),
    false,
    `${mode}: thinking-only tool-free final is hidden while quarantined`,
  );
  assert.equal(
    h.sent.slice(sentAtQuarantine).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
      || entry.message?.customType === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
      || entry.message?.customType === "coc-mechanical-output-gate"
      || entry.message?.customType === "coc-settled-output-gate"
      || entry.message?.customType === "coc-settled-output-preflight"
      || entry.message?.customType === "coc-opening-setup-route"
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `${mode}: thinking-only final sends no recovery follow-up, custom, or prompt`,
  );
  assert.equal(
    h.audits.some((entry) => (
      entry.name === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
      || entry.name === "coc-empty-terminal-recovery-delivery-failed"
      || entry.name === main.TURN_PROCESSING_FAULT_CUSTOM_TYPE
      || entry.name === "coc-mechanical-output-gate"
      || entry.name === OPEN_TURN_RECOVERY_GUIDANCE_AUDIT
      || entry.name === PENDING_FINALIZATION_RECOVERY_GUIDANCE_AUDIT
    )),
    false,
    `${mode}: thinking-only final arms no recovery marker or fault audit`,
  );
  assert.equal(
    h.clientCalls.slice(clientCallsAtQuarantine).some((call) => (
      call.name !== "coc_capabilities"
      && (
        call.params?.operation === "session.resume"
        || (
          typeof call.params?.operation === "string"
          && (call.params.operation.startsWith("state.")
            || call.params.operation.startsWith("rules.")
            || call.params.operation.startsWith("turn."))
        )
      )
    )),
    false,
    `${mode}: thinking-only final triggers no second resume or rules-state call`,
  );
  assert.deepEqual(
    h.activeTools.at(-1),
    [],
    `${mode}: tools stay empty after the thinking-only final`,
  );
  await h.shutdown();
  assert.ok(
    h.activeTools.at(-1).length > 0,
    `${mode}: normal tool surface returns after agent_end`,
  );
  // The next genuine external player turn (a real role=user message, not a
  // replay) must find the normal tool surface available and settle through
  // the normal epoch machinery.
  await h.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: "我举灯走进正厅，检查讲坛后的暗门。" }],
  });
  assert.ok(
    h.activeTools.at(-1).length > 0,
    `${mode}: the next genuine external player turn keeps normal tools available`,
  );
  const sentAfterRelease = h.sent.length;
  const interceptedFinal = await h.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    interceptedFinal.content.some((part) => part.type === "text"),
    false,
    `${mode}: control - the normal mechanical gate still intercepts after release`,
  );
  assert.ok(
    h.sent.slice(sentAfterRelease).some((entry) => (
      entry.options?.triggerTurn === true
      && entry.options?.deliverAs === "followUp"
      && (
        entry.message?.customType === "coc-mechanical-output-gate"
        || entry.message?.customType === "coc-settled-output-gate"
      )
    )),
    `${mode}: control - interception after release delivers the gate follow-up`,
  );
  assert.equal(
    h.sent.slice(sentAfterRelease).some((entry) => (
      entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
    )),
    false,
    `${mode}: no startup blocker or table-open prompt at any boundary`,
  );
}

// Startup-only trailing-unmatched-player refinement: the silent settled
// quarantine must be armed from the persistent session branch read once at
// initializeSession. A branch whose last player-visible role is an unmatched
// real role=user message (a fresh setup answer whose provider finished
// without a final, then a watchdog respawn) must NOT be quarantined — the
// auto-open agent finishes that existing player epoch with the normal
// tool/output surface and no resend. A fully settled branch (later visible
// assistant output) keeps the quarantine. Structured roles only; hidden
// custom entries and non-message entries never clear the pending user.
const PLAYER_SETUP_ANSWER = "他叫托马斯·里德，是1890年代波士顿的一名记者。";
let branchEntrySeq = 0;
function branchEntry(role, content, extra = {}) {
  branchEntrySeq += 1;
  return {
    type: "message",
    id: `branch-entry-${branchEntrySeq}`,
    parentId: `branch-entry-${branchEntrySeq - 1}`,
    timestamp: "2026-08-24T17:38:00.000Z",
    message: { role, content },
    ...extra,
  };
}
const settledAssistantBranch = () => [
  branchEntry("user", [{ type: "text", text: PLAYER_SETUP_ANSWER }]),
  branchEntry(
    "assistant",
    [{ type: "text", text: "已记录：托马斯·里德，记者。建卡继续。" }],
    { stopReason: "stop" },
  ),
];
const trailingUserBranch = () => [
  branchEntry(
    "assistant",
    [{ type: "text", text: "请告诉我调查员的姓名、职业与年代。" }],
    { stopReason: "stop" },
  ),
  branchEntry("user", [{ type: "text", text: PLAYER_SETUP_ANSWER }]),
];
const pendingAfterToolOnlyBranch = () => [
  ...trailingUserBranch(),
  branchEntry(
    "assistant",
    [
      { type: "thinking", text: "整理姓名与职业，继续建卡。" },
      {
        type: "toolCall",
        id: "call-branch-1",
        name: "coc_setup",
        arguments: { operation: "setup.investigator_contract" },
      },
    ],
    { stopReason: "toolUse" },
  ),
  branchEntry("toolResult", [
    { type: "text", text: "{\"ok\":true,\"tool\":\"setup.investigator_contract\"}" },
  ], { toolCallId: "call-branch-1", toolName: "coc_setup" }),
  branchEntry("assistant", [], { stopReason: "stop" }),
  {
    type: "custom_message",
    customType: "coc-pi-loading",
    content: "正在打开建卡引导……请稍候。",
    display: true,
  },
  {
    type: "custom",
    customType: "coc-tool-telemetry",
    data: { canonical_operation: "progressive.opening_bootstrap" },
  },
];
const clearedByLaterVisibleAssistantBranch = () => [
  ...pendingAfterToolOnlyBranch().slice(0, -2),
  branchEntry(
    "assistant",
    [{ type: "text", text: "已记录：托马斯·里德，记者。请掷运气。" }],
    { stopReason: "stop" },
  ),
];
// String-content role=user turn (plain-text player input): content shape is
// never a prerequisite, so it arms the pending external player fact exactly
// like the array form — parity with the welcome.ts auto-open helper.
const stringContentUserBranch = () => [
  branchEntry(
    "assistant",
    [{ type: "text", text: "请告诉我调查员的姓名、职业与年代。" }],
    { stopReason: "stop" },
  ),
  branchEntry("user", PLAYER_SETUP_ANSWER),
];
const stringClearedByVisibleAssistantBranch = () => [
  ...stringContentUserBranch(),
  branchEntry(
    "assistant",
    [{ type: "text", text: "已记录：托马斯·里德，记者。请掷运气。" }],
    { stopReason: "stop" },
  ),
];
// Image/attachment-only player turn: role=user with structured content but
// no text part at all. It must still arm the pending external player fact.
const attachmentOnlyUserBranch = () => [
  branchEntry(
    "assistant",
    [{ type: "text", text: "把调查员的肖像照片发给我，我替你存档。" }],
    { stopReason: "stop" },
  ),
  branchEntry("user", [
    { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" },
  ]),
];
const attachmentClearedByVisibleAssistantBranch = () => [
  ...attachmentOnlyUserBranch(),
  branchEntry(
    "assistant",
    [{ type: "text", text: "肖像已收到并绑定到调查员卡，建卡继续。" }],
    { stopReason: "stop" },
  ),
];
const PLAIN_OPENING_PROSE = "你放下建卡表格，烛火在桌面摇曳，等待下一句叮嘱。";

for (const mode of ["already_acknowledged", "awaiting_player"]) {
  // Settled branch (last visible output is assistant): quarantine still arms.
  const settledCampaignId = `startup-silent-settled-${mode}`;
  const settled = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected settled ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: settledCampaignId });
  }, settledCampaignId, root, settledAssistantBranch());
  await settled.start();
  const settledToolsBeforeResume = settled.activeTools.length;
  const settledResumed = await invoke(
    settled,
    `silent-settled-${mode}-resume`,
    resumeParams(settledCampaignId),
    "coc_setup",
  );
  assert.equal(settledResumed.ok, true, `settled ${mode}`);
  assert.ok(
    settled.activeTools.length > settledToolsBeforeResume,
    `settled ${mode}: silent resume reapplies the tool surface`,
  );
  assert.ok(
    settled.activeTools
      .slice(settledToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `settled ${mode}: settled assistant history still quarantines`,
  );
  const settledHiddenFinal = await settled.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    settledHiddenFinal.content.some((part) => part.type === "text"),
    false,
    `settled ${mode}: quarantined final stays hidden`,
  );
  await settled.shutdown();

  // Trailing real unmatched role=user: no quarantine, no prompt, no resend.
  const trailingCampaignId = `startup-silent-trailing-${mode}`;
  const trailing = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected trailing ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: trailingCampaignId });
  }, trailingCampaignId, root, trailingUserBranch());
  await trailing.start();
  // The unmatched player turn predates the respawn: replay its user
  // message_start (same fixture the settled block above uses) so the gate
  // and canonical progress share the external player epoch before the
  // auto-open turn's final is adjudicated.
  await trailing.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: PLAYER_SETUP_ANSWER }],
  });
  const trailingToolsBeforeResume = trailing.activeTools.length;
  const trailingSentBeforeResume = trailing.sent.length;
  const trailingResumed = await invoke(
    trailing,
    `silent-trailing-${mode}-resume`,
    resumeParams(trailingCampaignId),
    "coc_setup",
  );
  assert.equal(trailingResumed.ok, true, `trailing ${mode}`);
  assert.equal(trailingResumed.data.mode, mode, `trailing ${mode}`);
  assert.ok(
    trailing.activeTools.length > trailingToolsBeforeResume,
    `trailing ${mode}: silent resume reapplies the tool surface`,
  );
  keepsNormalProjectionSurface(
    trailing,
    `trailing ${mode}: unmatched player user keeps the normal tool surface`,
  );
  const trailingFinal = await trailing.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: PLAIN_OPENING_PROSE }],
    stopReason: "stop",
  });
  const trailingFinalVisible = trailingFinal.content.some(
    (part) => part.type === "text",
  );
  const trailingNormalGateFollowUp = trailing.sent
    .slice(trailingSentBeforeResume)
    .some((entry) => (
      entry.options?.triggerTurn === true
      && entry.options?.deliverAs === "followUp"
      && (
        entry.message?.customType === "coc-mechanical-output-gate"
        || entry.message?.customType === "coc-settled-output-gate"
        || entry.message?.customType === "coc-opening-setup-route"
      )
    ));
  assert.ok(
    trailingFinalVisible || trailingNormalGateFollowUp,
    `trailing ${mode}: final flows through the normal output surface, not silent quarantine`,
  );
  assert.equal(
    trailing.sent.slice(trailingSentBeforeResume).some((entry) => (
      entry.message?.display === true
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `trailing ${mode}: no player-visible prompt, blocker, or resend request`,
  );
  await trailing.shutdown();

  // String-content role=user (plain-text input): same unmatched external
  // player treatment — no quarantine, normal tool surface, no resend — and
  // a later visible assistant settles it so the silent quarantine returns.
  const stringCampaignId = `startup-silent-string-${mode}`;
  const stringContent = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected string ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: stringCampaignId });
  }, stringCampaignId, root, stringContentUserBranch());
  await stringContent.start();
  // Replay the string-content player turn as a live user message_start so
  // the external player epoch is marked (the branch fixture already proves
  // the string content shape arms the pending fact).
  await stringContent.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: PLAYER_SETUP_ANSWER }],
  });
  const stringToolsBeforeResume = stringContent.activeTools.length;
  const stringSentBeforeResume = stringContent.sent.length;
  const stringResumed = await invoke(
    stringContent,
    `silent-string-${mode}-resume`,
    resumeParams(stringCampaignId),
    "coc_setup",
  );
  assert.equal(stringResumed.ok, true, `string ${mode}`);
  assert.equal(stringResumed.data.mode, mode, `string ${mode}`);
  assert.ok(
    stringContent.activeTools.length > stringToolsBeforeResume,
    `string ${mode}: silent resume reapplies the tool surface`,
  );
  keepsNormalProjectionSurface(
    stringContent,
    `string ${mode}: string-content player user keeps the normal tool surface`,
  );
  const stringFinal = await stringContent.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: PLAIN_OPENING_PROSE }],
    stopReason: "stop",
  });
  const stringFinalVisible = stringFinal.content.some(
    (part) => part.type === "text",
  );
  const stringNormalGateFollowUp = stringContent.sent
    .slice(stringSentBeforeResume)
    .some((entry) => (
      entry.options?.triggerTurn === true
      && entry.options?.deliverAs === "followUp"
      && (
        entry.message?.customType === "coc-mechanical-output-gate"
        || entry.message?.customType === "coc-settled-output-gate"
        || entry.message?.customType === "coc-opening-setup-route"
      )
    ));
  assert.ok(
    stringFinalVisible || stringNormalGateFollowUp,
    `string ${mode}: final flows through the normal output surface, not silent quarantine`,
  );
  assert.equal(
    stringContent.sent.slice(stringSentBeforeResume).some((entry) => (
      entry.message?.display === true
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `string ${mode}: no player-visible prompt, blocker, or resend request`,
  );
  await stringContent.shutdown();

  // A later assistant entry with non-empty visible text settles that
  // string-content player turn, and the silent quarantine returns.
  const stringClearedCampaignId = `startup-silent-string-cleared-${mode}`;
  const stringCleared = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected string-cleared ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: stringClearedCampaignId });
  }, stringClearedCampaignId, root, stringClearedByVisibleAssistantBranch());
  await stringCleared.start();
  const stringClearedToolsBeforeResume = stringCleared.activeTools.length;
  const stringClearedSentBeforeResume = stringCleared.sent.length;
  const stringClearedResumed = await invoke(
    stringCleared,
    `silent-string-cleared-${mode}-resume`,
    resumeParams(stringClearedCampaignId),
    "coc_setup",
  );
  assert.equal(stringClearedResumed.ok, true, `string-cleared ${mode}`);
  assert.ok(
    stringCleared.activeTools
      .slice(stringClearedToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `string-cleared ${mode}: later visible assistant restores the silent quarantine`,
  );
  const stringClearedHiddenFinal = await stringCleared.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    stringClearedHiddenFinal.content.some((part) => part.type === "text"),
    false,
    `string-cleared ${mode}: quarantined final stays hidden`,
  );
  assert.equal(
    stringCleared.sent.slice(stringClearedSentBeforeResume).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
    )),
    false,
    `string-cleared ${mode}: quarantine sends no follow-up or prompt`,
  );
  await stringCleared.shutdown();

  // Thinking-only/tool-only assistant entries after the user never clear the
  // pending external player turn, so no quarantine arms for them either.
  const pendingCampaignId = `startup-silent-pending-${mode}`;
  const pendingBranch = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected pending ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: pendingCampaignId });
  }, pendingCampaignId, root, pendingAfterToolOnlyBranch());
  await pendingBranch.start();
  const pendingToolsBeforeResume = pendingBranch.activeTools.length;
  const pendingSentBeforeResume = pendingBranch.sent.length;
  const pendingResumed = await invoke(
    pendingBranch,
    `silent-pending-${mode}-resume`,
    resumeParams(pendingCampaignId),
    "coc_setup",
  );
  assert.equal(pendingResumed.ok, true, `pending ${mode}`);
  keepsNormalProjectionSurface(
    pendingBranch,
    `pending ${mode}: thinking/tool-only assistant after user stays pending (no quarantine)`,
  );
  assert.equal(
    pendingBranch.sent.slice(pendingSentBeforeResume).some((entry) => (
      entry.message?.display === true
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `pending ${mode}: no player-visible prompt or resend request`,
  );
  await pendingBranch.shutdown();

  // A later assistant entry with non-empty visible text clears the pending
  // user, and the silent quarantine returns for that settled branch.
  const clearedCampaignId = `startup-silent-cleared-${mode}`;
  const cleared = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected cleared ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: clearedCampaignId });
  }, clearedCampaignId, root, clearedByLaterVisibleAssistantBranch());
  await cleared.start();
  const clearedToolsBeforeResume = cleared.activeTools.length;
  const clearedSentBeforeResume = cleared.sent.length;
  const clearedResumed = await invoke(
    cleared,
    `silent-cleared-${mode}-resume`,
    resumeParams(clearedCampaignId),
    "coc_setup",
  );
  assert.equal(clearedResumed.ok, true, `cleared ${mode}`);
  assert.ok(
    cleared.activeTools
      .slice(clearedToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `cleared ${mode}: later visible assistant restores the silent quarantine`,
  );
  const clearedHiddenFinal = await cleared.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    clearedHiddenFinal.content.some((part) => part.type === "text"),
    false,
    `cleared ${mode}: quarantined final stays hidden`,
  );
  assert.equal(
    cleared.sent.slice(clearedSentBeforeResume).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
    )),
    false,
    `cleared ${mode}: quarantine sends no follow-up or prompt`,
  );
  await cleared.shutdown();

  // An image/attachment-only role=user turn (structured content, zero text)
  // still arms the pending external player turn: exact silent resume modes
  // must NOT quarantine it, and the normal tool/output surface stays up.
  const attachmentCampaignId = `startup-silent-attachment-${mode}`;
  const attachment = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected attachment ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: attachmentCampaignId });
  }, attachmentCampaignId, root, attachmentOnlyUserBranch());
  await attachment.start();
  // The branch fixture proves the attachment-only turn arms the pending
  // fact; the fake runtime cannot replay an attachment-only event through
  // the live surface, so mark the replayed external player epoch with a
  // text-bearing user message_start before the final is adjudicated.
  await attachment.emit("message_start", {
    role: "user",
    content: [{ type: "text", text: PLAYER_SETUP_ANSWER }],
  });
  const attachmentToolsBeforeResume = attachment.activeTools.length;
  const attachmentSentBeforeResume = attachment.sent.length;
  const attachmentResumed = await invoke(
    attachment,
    `silent-attachment-${mode}-resume`,
    resumeParams(attachmentCampaignId),
    "coc_setup",
  );
  assert.equal(attachmentResumed.ok, true, `attachment ${mode}`);
  assert.equal(attachmentResumed.data.mode, mode, `attachment ${mode}`);
  assert.ok(
    attachment.activeTools.length > attachmentToolsBeforeResume,
    `attachment ${mode}: silent resume reapplies the tool surface`,
  );
  keepsNormalProjectionSurface(
    attachment,
    `attachment ${mode}: attachment-only player user keeps the normal tool surface`,
  );
  const attachmentFinal = await attachment.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: PLAIN_OPENING_PROSE }],
    stopReason: "stop",
  });
  const attachmentFinalVisible = attachmentFinal.content.some(
    (part) => part.type === "text",
  );
  const attachmentNormalGateFollowUp = attachment.sent
    .slice(attachmentSentBeforeResume)
    .some((entry) => (
      entry.options?.triggerTurn === true
      && entry.options?.deliverAs === "followUp"
      && (
        entry.message?.customType === "coc-mechanical-output-gate"
        || entry.message?.customType === "coc-settled-output-gate"
        || entry.message?.customType === "coc-opening-setup-route"
      )
    ));
  assert.ok(
    attachmentFinalVisible || attachmentNormalGateFollowUp,
    `attachment ${mode}: final flows through the normal output surface, not silent quarantine`,
  );
  assert.equal(
    attachment.sent.slice(attachmentSentBeforeResume).some((entry) => (
      entry.message?.display === true
      || entry.message?.customType === "coc-startup-resume-blocker"
      || entry.message?.customType === "coc-pi-table-open"
      || entry.message?.customType === "coc-startup-resume-required"
    )),
    false,
    `attachment ${mode}: no player-visible prompt, blocker, or resend request`,
  );
  await attachment.shutdown();

  // Once a later assistant entry with non-empty visible text settles that
  // attachment-only player turn, the silent quarantine returns.
  const attachmentClearedCampaignId = `startup-silent-attachment-cleared-${mode}`;
  const attachmentCleared = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected attachment-cleared ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, { campaign_id: attachmentClearedCampaignId });
  }, attachmentClearedCampaignId, root, attachmentClearedByVisibleAssistantBranch());
  await attachmentCleared.start();
  const attachmentClearedToolsBeforeResume = attachmentCleared.activeTools.length;
  const attachmentClearedSentBeforeResume = attachmentCleared.sent.length;
  const attachmentClearedResumed = await invoke(
    attachmentCleared,
    `silent-attachment-cleared-${mode}-resume`,
    resumeParams(attachmentClearedCampaignId),
    "coc_setup",
  );
  assert.equal(attachmentClearedResumed.ok, true, `attachment-cleared ${mode}`);
  assert.ok(
    attachmentCleared.activeTools
      .slice(attachmentClearedToolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length === 0),
    `attachment-cleared ${mode}: later visible assistant restores the silent quarantine`,
  );
  const attachmentClearedHiddenFinal = await attachmentCleared.emit("message_end", {
    role: "assistant",
    content: [{ type: "text", text: QUARANTINE_MECHANICAL_FINAL }],
    stopReason: "stop",
  });
  assert.equal(
    attachmentClearedHiddenFinal.content.some((part) => part.type === "text"),
    false,
    `attachment-cleared ${mode}: quarantined final stays hidden`,
  );
  assert.equal(
    attachmentCleared.sent.slice(attachmentClearedSentBeforeResume).some((entry) => (
      entry.options?.triggerTurn === true
      || entry.options?.deliverAs === "followUp"
    )),
    false,
    `attachment-cleared ${mode}: quarantine sends no follow-up or prompt`,
  );
  await attachmentCleared.shutdown();
}

// Non-silent startup resume modes never arm the quarantine, with or without a
// trailing unmatched external player turn.
for (const [mode, nextOperations] of [
  ["open_turn_recovery", ["continue_current_turn_from_receipts"]],
  ["pending_finalization", ["turn.finalize"]],
  ["table_opening", ["evidence.table_opening"]],
]) {
  const campaignId = `startup-trailing-${mode}`;
  const h = harness((name, params) => {
    if (params.operation !== "session.resume") {
      throw new Error(`unexpected trailing-user ${mode} operation ${params.operation}`);
    }
    return resumeEnvelope(mode, {
      campaign_id: campaignId,
      next_operations: nextOperations,
    });
  }, campaignId, root, trailingUserBranch());
  await h.start();
  const toolsBeforeResume = h.activeTools.length;
  const resumed = await invoke(h, `trailing-${mode}-resume`, resumeParams(campaignId), "coc_setup");
  assert.equal(resumed.ok, true, mode);
  assert.equal(resumed.data.mode, mode, mode);
  assert.ok(
    h.activeTools.length > toolsBeforeResume,
    `${mode}: resume reapplies the tool surface`,
  );
  assert.ok(
    h.activeTools
      .slice(toolsBeforeResume)
      .every((tools) => Array.isArray(tools) && tools.length > 0),
    `${mode}: trailing unmatched user never quarantines non-silent modes`,
  );
  await h.shutdown();
}

const { convertToLlm } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-coding-agent", "dist/core/messages.js")).href
);
const { transformMessages } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-ai", "dist/api/transform-messages.js")).href
);
const { convertMessages } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-ai", "dist/api/openai-completions.js")).href
);

const model = {
  id: "deepseek-chat",
  name: "DeepSeek",
  provider: "deepseek",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8000,
  maxTokens: 256,
};
const compat = {
  supportsDeveloperRole: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  requiresReasoningContentOnAssistantMessages: false,
  requiresToolResultName: false,
  deferredToolsMode: undefined,
};
const callId = "call_open_turn_recovery";
const agentMessages = [
  {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: callId,
      name: "coc_setup",
      arguments: { operation: "session.resume" },
    }],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-chat",
    usage: {
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 1,
  },
  {
    role: "toolResult",
    toolCallId: callId,
    toolName: "coc_setup",
    content: [{ type: "text", text: JSON.stringify(recovered) }],
    isError: false,
    timestamp: 2,
  },
];
const llm = convertToLlm(agentMessages);
assert.equal(llm[0].role, "assistant");
assert.equal(llm[1].role, "toolResult");
assert.equal(llm[1].toolCallId, callId);
assert.equal(llm.some((msg) => msg.role === "user"), false);
const transformed = transformMessages(llm, model);
assert.equal(
  transformed.some((msg) => msg.role === "toolResult" && msg.toolCallId === callId),
  true,
);
assert.equal(
  transformed.some((msg) => (
    msg.role === "user"
    && transformed.indexOf(msg) < transformed.findIndex((row) => (
      row.role === "toolResult" && row.toolCallId === callId
    ))
  )),
  false,
);
const provider = convertMessages(model, { messages: llm, systemPrompt: "" }, compat);
assert.equal(provider.filter((msg) => msg.role === "tool").length, 1);
assert.equal(provider.some((msg) => msg.role === "tool" && msg.tool_call_id === callId), true);

process.stdout.write(JSON.stringify({
  ok: true,
  contract: OPEN_TURN_RECOVERY_GUIDANCE_CONTRACT,
  attachedOnOpenTurnRecovery: true,
  skippedModes: ["table_opening", "awaiting_player", "pending_finalization"],
  noMidPairCustom: true,
  providerValid: true,
  silentModesQuarantined: ["already_acknowledged", "awaiting_player"],
  quarantineToolsEmptyUntilAgentEnd: true,
  quarantineHidesMechanicalFinal: true,
  quarantineHidesThinkingOnlyFinal: true,
  quarantineNoEmptyTerminalRecovery: true,
  quarantineNoFollowUpOrDuplicateCall: true,
  quarantineToolsReturnAfterAgentEnd: true,
  nextPlayerTurnAfterQuarantineKeepsNormalTools: true,
  attachmentOnlyUserTurnArmsPending: true,
  attachmentOnlyUserClearedByVisibleAssistant: true,
  stringContentUserTurnArmsPending: true,
  stringContentUserClearedByVisibleAssistant: true,
  exactOperationCardsProjected: [
    "agency_review_operation",
    "finalize_operation",
  ],
  malformedCardsFailClosed: true,
  cardIdentityFailClosed: true,
  canonicalInvokeViaFinalizeCard: true,
  cardsSurviveFullExtensionPath: true,
  keeperOnlyCardsNoPlayerLeak: true,
  completeInlineCardsSuppressHostFetch: true,
  pointerOnlyResumeHydratesLiveCards: true,
  hydrationSingleTypedFetchExactEnvelope: true,
  hydrationProgressOutputContextReadyBeforeReviewReady: true,
  hydrationOutputContextObservationNeverRegressive: true,
  hydrationTypedReviewFreeOfCompilerContextMissing: true,
  hydrationBindingArmedBeforeReview: true,
  hydratedLiveCardsAuthoritativeOverSnapshot: true,
  hydrationReviewCardIsNextActionNoDuplicateCopy: true,
  hydrationNoOutputContextPointerRemains: true,
  hydrationNeverInvokesReviewFinalizeRulesOrState: true,
  sequentialSameIdentityCoalesces: true,
  concurrentSameIdentitySharesOneInFlightFetch: true,
  repeatedFailedIdentityFetchesOnceTotal: true,
  changedPendingIdentityRefetchesOnce: true,
  identityLessPendingNeverReusesIdentifiedAttempt: true,
  sessionResetPermitsOneFreshFetch: true,
  preTransportAbortPerformsNoFetch: true,
  postTransportAbortDiscardsReceiptWholeAndRefetchesOnce: true,
  observerFailureLeavesNoPartialBindingOrProgress: true,
  hydrationFailureCardFreePointerGuidance: [
    "transport rejection",
    "canonical failure envelope",
    "malformed live chain",
    "missing review identities",
    "wrong mode-specific finalize surface",
    "identity mismatch",
    "partial snapshot plus failed hydration",
    "observer failure",
  ],
  strictLiveIdentityValidation: true,
  modeSpecificFinalizeSurfaceEnforced: true,
  liveValidatorFailClosed: true,
  nonPendingModesNoHostFetch: true,
  nonQuarantineModes: [
    "open_turn_recovery",
    "table_opening",
    "pending_finalization",
  ],
}) + "\n");


// ---------------------------------------------------------------------------
// Draft-shape recovery card (run-02 paragraph-zero placement chain):
// whitelist-derived frozen payload, machine-internal payload seal, exact
// per-identity tombstone fold.
// ---------------------------------------------------------------------------

// Canonical typed turn.finalize schema model-owned whitelist (derived in the
// host from typedTools properties minus host-injected binding fields).
const MODEL_OWNED_FINALIZE_FIELDS = [
  "draft",
  "coverage",
  "agency_claims",
  "mechanics_placements",
  "advisory_uptake",
  "validate_only",
];
const buildCard = (input) => buildDraftShapeRecoveryCard({
  ...input,
  modelOwnedFields: input.modelOwnedFields
    ?? MODEL_OWNED_FINALIZE_FIELDS,
});

const placementFailureEnvelope = (rollId, flavor) => ({
  ok: false,
  tool: "turn.finalize",
  error: {
    code: "default_mechanics_placement_unavailable",
    message: flavor === "missing"
      ? `public roll ${rollId} has no safe preceding paragraph; `
        + "split action/setup and result prose into separate paragraphs"
      : `public roll ${rollId} consequence is in paragraph zero; `
        + "add a separate action/setup paragraph before the result paragraph",
  },
});

// Python-finalizer-exact paragraph split (coc_turn_finalization._draft_paragraphs).
assert.deepEqual(
  canonicalDraftParagraphs("第一段。\n\n第二段。\n\n第三段。"),
  ["第一段。", "第二段。", "第三段。"],
);
assert.deepEqual(canonicalDraftParagraphs("单段。"), ["单段。"]);

assert.equal(isDraftShapePlacementFailure(
  placementFailureEnvelope("roll-1"),
), true);
assert.equal(isDraftShapePlacementFailure({
  ok: true,
  tool: "turn.finalize",
  data: {},
}), false);
assert.equal(isDraftShapePlacementFailure({
  ok: false,
  tool: "turn.finalize",
  error: { code: "narration_review_mismatch", message: "x" },
}), false);
assert.equal(isDraftShapePlacementFailure(null), false);

assert.deepEqual(placementFailureRollIds(
  "public roll roll-spot-hidden consequence is in paragraph zero; "
    + "add a separate action/setup paragraph before the result paragraph",
), ["roll-spot-hidden"]);
assert.deepEqual(placementFailureRollIds(
  "public roll roll-listen has no safe preceding paragraph; "
    + "split action/setup and result prose into separate paragraphs",
), ["roll-listen"]);
assert.deepEqual(placementFailureRollIds("无法解析的消息"), []);

// Exact run-02 shape: two public checks (one critical Spot Hidden, one failed
// Listen) plus an exceptional effect, all settled; the KP merged action and
// consequence into paragraph zero, so finalize cannot place the roll block.
const run02Draft = "你贴着墙根屏息，同时竖起耳朵听向门后的动静。";
const run02Coverage = [
  {
    obligation_id: "roll:roll-spot-hidden",
    realization: "observable_beat",
    player_input_handling: "consumed",
    action_realization: "你压低身形。",
    response: "",
    causal_explanation: "",
    persona_fit: "",
    exact_excerpt: "你贴着墙根屏息",
    exceptional_beat: null,
  },
  {
    obligation_id: "roll:roll-listen",
    realization: "observable_beat",
    player_input_handling: "consumed",
    action_realization: "你听见门后有轻微的刮擦声。",
    response: "",
    causal_explanation: "",
    persona_fit: "",
    exact_excerpt: "竖起耳朵听向门后的动静",
    exceptional_beat: null,
  },
];
const run02Facts = {
  turnId: "turn-run02-act02",
  sourceDigest: "sha256:source-run02-act02",
  revision: 2,
  narrationReviewId: "narration-review-v2:dfd1d66b",
};
const run02AdvisoryUptake = {
  schema_version: 1,
  rows: [{ candidate_ref: "storylet-candidate:corridor-whisper", taken: true }],
};
const run02MechanicsPlacements = [
  { after_paragraph: 0, segment_type: "public_check", source_ids: ["roll-spot-hidden"] },
];
const run02FailedCallArguments = {
  draft: run02Draft,
  coverage: run02Coverage,
  agency_claims: [],
  mechanics_placements: run02MechanicsPlacements,
  advisory_uptake: run02AdvisoryUptake,
  revision: 2,
  narration_review_id: run02Facts.narrationReviewId,
};
const run02Card = buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: run02FailedCallArguments,
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
});
assert.equal(isDraftShapeRecoveryCard(run02Card), true);
assert.equal(run02Card.contract_id, DRAFT_SHAPE_RECOVERY_CARD_CONTRACT);
assert.equal(run02Card.kind, "draft_shape_recovery");
assert.equal(run02Card.audience, "keeper_only");
assert.equal(run02Card.campaign_id, "run02-campaign");
assert.equal(run02Card.turn_id, run02Facts.turnId);
assert.equal(run02Card.source_digest, run02Facts.sourceDigest);
assert.equal(run02Card.revision, 2);
assert.equal(run02Card.narration_review_id, run02Facts.narrationReviewId);
assert.deepEqual(run02Card.diagnosis.offending_roll_ids, ["roll-spot-hidden"]);
assert.equal(run02Card.diagnosis.draft_paragraph_count, 1);
assert.equal(run02Card.diagnosis.verdict, "consequence_paragraph_zero");
assert.deepEqual(run02Card.diagnosis.coverage_rows, [{
  obligation_id: "roll:roll-spot-hidden",
  exact_excerpt: "你贴着墙根屏息",
  excerpt_paragraph_index: 0,
}]);
assert.equal(
  run02Card.finalize_replay.invoke_via,
  "coc_turn_finalize",
);
assert.equal(
  run02Card.finalize_replay.replay_arguments_from,
  "frozen_finalize_payload",
);
assert.deepEqual(run02Card.finalize_replay.host_bound_arguments, [
  "root",
  "campaign",
  "decision_id",
  "revision",
  "narration_review_id",
]);
assert.match(run02Card.instruction, /action\/setup paragraph/);
assert.match(run02Card.instruction, /paragraph zero/);
assert.equal(
  run02Card.forbidden.includes("reroll"),
  true,
);
assert.equal(run02Card.forbidden.includes("rerun_narration_review"), true);
assert.equal(run02Card.forbidden.includes("placeholder_prose"), true);

// The preserved review binding and the no-speculation boundary are explicit.
assert.equal(run02Card.preserved_bindings.narration_review.review_id, run02Facts.narrationReviewId);
assert.equal(run02Card.preserved_bindings.journal, "unchanged");

// The card preserves EVERY model-owned schema field present in the failed
// call — including advisory_uptake and mechanics_placements — verbatim.
assert.equal(isFrozenFinalizePayload(run02Card.frozen_finalize_payload), true);
assert.deepEqual(run02Card.frozen_finalize_payload, {
  draft: run02Draft,
  coverage: run02Coverage,
  agency_claims: [],
  mechanics_placements: run02MechanicsPlacements,
  advisory_uptake: run02AdvisoryUptake,
});
assert.notEqual(run02Card.frozen_finalize_payload.coverage, run02Coverage);
assert.notEqual(
  run02Card.frozen_finalize_payload.advisory_uptake,
  run02AdvisoryUptake,
);
// The payload digest binds integrity; it is recomputable from the payload.
assert.equal(
  run02Card.payload_sha256,
  draftShapePayloadDigest(run02Card.frozen_finalize_payload),
);

// Fail-closed: the host invents nothing when the frozen chain is incomplete.
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: null,
  finalizeArguments: run02FailedCallArguments,
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: { ...run02Facts, narrationReviewId: "" },
  finalizeArguments: run02FailedCallArguments,
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: null,
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: { draft: "  ", coverage: run02Coverage },
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: { draft: run02Draft },
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: {
    draft: run02Draft,
    coverage: run02Coverage,
    agency_claims: [],
  },
  failureEnvelope: {
    ok: false,
    tool: "turn.finalize",
    error: { code: "narration_review_mismatch", message: "public roll x" },
  },
}), null);
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: {
    draft: run02Draft,
    coverage: run02Coverage,
    agency_claims: [],
  },
  failureEnvelope: {
    ok: false,
    tool: "turn.finalize",
    error: { code: "default_mechanics_placement_unavailable", message: "???" },
  },
}), null);

// The frozen call must be the same frozen turn the host retained: a stale or
// mismatching revision/review identity freezes no card.
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: {
    ...run02FailedCallArguments,
    revision: 1,
  },
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: {
    ...run02FailedCallArguments,
    narration_review_id: "narration-review-v1:other",
  },
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
// Missing agency_claims freezes no card.
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: {
    ...run02FailedCallArguments,
    agency_claims: undefined,
  },
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
// An offending roll without a coverage row, or with an empty excerpt, cannot
// direct an exact paragraph repair: no card.
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: {
    ...run02FailedCallArguments,
    coverage: [run02Coverage[1]],
  },
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
assert.equal(buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: {
    ...run02FailedCallArguments,
    coverage: [{ ...run02Coverage[0], exact_excerpt: "" }, run02Coverage[1]],
  },
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
}), null);
// Without the canonical typed-schema whitelist the host refuses to hand-pick
// payload fields: no card.
assert.equal(buildDraftShapeRecoveryCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: run02FailedCallArguments,
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
  modelOwnedFields: null,
}), null);
assert.equal(buildDraftShapeRecoveryCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: run02FailedCallArguments,
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
  modelOwnedFields: ["draft", "coverage"],
}), null);

// Excerpt-missing diagnosis keeps its own verdict and per-row index -1.
const missingCard = buildCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: {
    draft: run02Draft,
    coverage: [
      ...run02Coverage,
      {
        obligation_id: "roll:roll-vanished",
        realization: "observable_beat",
        player_input_handling: "consumed",
        action_realization: "x",
        response: "",
        causal_explanation: "",
        persona_fit: "",
        exact_excerpt: "这句摘要不在草稿的任何段落里",
        exceptional_beat: null,
      },
    ],
    revision: 2,
    narration_review_id: run02Facts.narrationReviewId,
    agency_claims: [],
  },
  failureEnvelope: placementFailureEnvelope("roll-vanished", "missing"),
});
assert.equal(missingCard.diagnosis.verdict, "consequence_excerpt_missing");
assert.deepEqual(
  missingCard.diagnosis.coverage_rows,
  [{
    obligation_id: "roll:roll-vanished",
    exact_excerpt: "这句摘要不在草稿的任何段落里",
    excerpt_paragraph_index: -1,
  }],
);

// Authenticated recovery-card selection from session entries.
const cardEntry = (card, overrides = {}) => ({
  type: "custom",
  customType: DRAFT_SHAPE_RECOVERY_CARD_AUDIT,
  data: { ...card, ...overrides },
});
const sealEntry = (card, overrides = {}) => ({
  type: "custom",
  customType: DRAFT_SHAPE_RECOVERY_SEAL_AUDIT,
  data: {
    schema_version: 1,
    campaign_id: card.campaign_id,
    turn_id: card.turn_id,
    source_digest: card.source_digest,
    revision: card.revision,
    narration_review_id: card.narration_review_id,
    payload_sha256: card.payload_sha256,
    ...overrides,
  },
});
const evidenceFor = (card, overrides = {}) => ({
  type: "custom",
  customType: NARRATION_REVIEW_EVIDENCE_AUDIT,
  data: {
    schema_version: 1,
    campaign_id: card.campaign_id,
    turn_id: card.turn_id,
    source_digest: card.source_digest,
    revision: card.revision,
    review_id: card.narration_review_id,
    ...overrides,
  },
});
const completeEntry = (card, overrides = {}) => ({
  type: "custom",
  customType: DRAFT_SHAPE_RECOVERY_COMPLETE_AUDIT,
  data: {
    schema_version: 1,
    campaign_id: card.campaign_id,
    turn_id: card.turn_id,
    source_digest: card.source_digest,
    revision: card.revision,
    narration_review_id: card.narration_review_id,
    payload_sha256: card.payload_sha256,
    ...overrides,
  },
});
const validTurnRecords = (card) => [
  cardEntry(card),
  sealEntry(card),
  evidenceFor(card),
];

// Valid card + seal + matching accepted-review evidence → recovered.
assert.equal(
  selectRecoverableDraftShapeCard(validTurnRecords(missingCard), "run02-campaign").turn_id,
  "turn-run02-act02",
);
// Missing seal, or any seal that does not authenticate the exact payload,
// fails closed — card JSON alone is never trusted.
assert.equal(
  selectRecoverableDraftShapeCard([
    cardEntry(missingCard),
    evidenceFor(missingCard),
  ], "run02-campaign"),
  null,
);
assert.equal(selectRecoverableDraftShapeCard([
  cardEntry(missingCard),
  sealEntry(missingCard, { payload_sha256: "sha256:stale" }),
  evidenceFor(missingCard),
], "run02-campaign"), null);
// Structurally valid tampering of ANY preserved payload family fails closed
// before recovery: draft, coverage, claims, placements, advisory uptake.
const tamper = (family, value) => selectRecoverableDraftShapeCard([
  cardEntry({
    ...missingCard,
    frozen_finalize_payload: { ...missingCard.frozen_finalize_payload, [family]: value },
  }),
  sealEntry(missingCard),
  evidenceFor(missingCard),
], "run02-campaign");
assert.equal(tamper("draft", "篡改后的草稿。"), null);
assert.equal(tamper("coverage", [{ obligation_id: "roll:roll-x", exact_excerpt: "x" }]), null);
assert.equal(tamper("agency_claims", [{ claim_id: "c1" }]), null);
assert.equal(tamper("mechanics_placements", []), null);
assert.equal(tamper("advisory_uptake", { rows: [] }), null);
// A malformed seal attributable to the campaign is corruption evidence.
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  { type: "custom", customType: DRAFT_SHAPE_RECOVERY_SEAL_AUDIT, data: { campaign_id: "run02-campaign" } },
], "run02-campaign"), null);
// Missing or mismatching review evidence → never trusted.
assert.equal(
  selectRecoverableDraftShapeCard(
    [cardEntry(missingCard), sealEntry(missingCard)],
    "run02-campaign",
  ),
  null,
);
assert.equal(selectRecoverableDraftShapeCard([
  cardEntry(missingCard),
  sealEntry(missingCard),
  evidenceFor(missingCard, { review_id: "narration-review-v1:other" }),
], "run02-campaign"), null);
// Malformed card-typed entry for the campaign is tamper evidence → null.
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  { type: "custom", customType: DRAFT_SHAPE_RECOVERY_CARD_AUDIT, data: {} },
], "run02-campaign"), null);
// Partial card (missing frozen payload) is malformed → null.
assert.equal(selectRecoverableDraftShapeCard([
  cardEntry(missingCard, { frozen_finalize_payload: undefined }),
  sealEntry(missingCard),
  evidenceFor(missingCard),
], "run02-campaign"), null);
// Structurally broken payload fails closed.
assert.equal(selectRecoverableDraftShapeCard([
  cardEntry({ ...missingCard, frozen_finalize_payload: { draft: "x" } }),
  sealEntry(missingCard),
  evidenceFor(missingCard),
], "run02-campaign"), null);
// Two unresolved identities in one campaign are ambiguous → null.
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  ...validTurnRecords({ ...run02Card, turn_id: "turn-run02-act03" }),
], "run02-campaign"), null);
// Identical-identity refresh dedupes to the newest entry.
assert.equal(
  selectRecoverableDraftShapeCard([
    ...validTurnRecords(missingCard),
    cardEntry(missingCard),
  ], "run02-campaign").turn_id,
  "turn-run02-act02",
);
// Exact full-identity tombstone retires the identity.
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  completeEntry(missingCard),
], "run02-campaign"), null);
// A tombstone for a foreign campaign does not retire this card.
assert.equal(
  selectRecoverableDraftShapeCard([
    ...validTurnRecords(missingCard),
    completeEntry(missingCard, { campaign_id: "other-campaign" }),
  ], "run02-campaign").turn_id,
  "turn-run02-act02",
);
// Partial tombstones — missing revision, review id, or payload seal — retire
// nothing.
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  completeEntry(missingCard, { revision: undefined }),
], "run02-campaign").turn_id, "turn-run02-act02");
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  completeEntry(missingCard, { narration_review_id: undefined }),
], "run02-campaign").turn_id, "turn-run02-act02");
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  completeEntry(missingCard, { payload_sha256: undefined }),
], "run02-campaign").turn_id, "turn-run02-act02");
// A stale tombstone for a different turn does not retire the pending one.
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  completeEntry({
    ...missingCard,
    turn_id: "turn-old",
    source_digest: "sha256:old",
    payload_sha256: draftShapePayloadDigest({ old: true }),
  }),
], "run02-campaign").turn_id, "turn-run02-act02");
// Lifecycle fold: completed historical turn A, then a newer unrelated
// pending turn B in the same campaign — A's tombstone retires only A and B
// recovers.
const turnA = {
  ...missingCard,
  turn_id: "turn-run02-act01",
  source_digest: "sha256:source-run02-act01",
  revision: 1,
  narration_review_id: "narration-review-v1:aaa",
};
assert.equal(
  selectRecoverableDraftShapeCard([
    ...validTurnRecords(turnA),
    completeEntry(turnA),
    ...validTurnRecords(missingCard),
  ], "run02-campaign").turn_id,
  "turn-run02-act02",
);
// Empty entries and other campaigns return null.
assert.equal(selectRecoverableDraftShapeCard([], "run02-campaign"), null);
assert.equal(selectRecoverableDraftShapeCard("not-a-list", "run02-campaign"), null);

// Review-evidence pre-check helper used by the host before persisting a card.
assert.equal(hasReviewEvidenceEntry(validTurnRecords(missingCard), {
  campaign: "run02-campaign",
  turnId: missingCard.turn_id,
  sourceDigest: missingCard.source_digest,
  revision: missingCard.revision,
  narrationReviewId: missingCard.narration_review_id,
}), true);
assert.equal(hasReviewEvidenceEntry([], {
  campaign: "run02-campaign",
  turnId: missingCard.turn_id,
  sourceDigest: missingCard.source_digest,
  revision: missingCard.revision,
  narrationReviewId: missingCard.narration_review_id,
}), false);

// Acknowledged-resume attachment: canonical lifecycle fields preserved, the
// exact card inlined, audit bound; wrong mode/campaign/card fail closed.
const acknowledgedResume = {
  ok: true,
  tool: "session.resume",
  data: {
    schema_version: 1,
    campaign_id: "run02-campaign",
    mode: "already_acknowledged",
    reuse_existing_working_set: true,
    host_context: { acknowledged: { requires_resume: false } },
    next_operations: ["continue_from_existing_working_set"],
  },
};
const guidedResume = applyAcknowledgedResumeRecoveryGuidance(
  acknowledgedResume,
  run02Card,
  { root: "/tmp/run02-root", campaign: "run02-campaign" },
);
assert.equal(guidedResume.attached, true);
assert.equal(guidedResume.envelope.data.mode, "already_acknowledged");
assert.equal(guidedResume.envelope.data.schema_version, 1);
assert.equal(guidedResume.envelope.data.campaign_id, "run02-campaign");
assert.deepEqual(
  guidedResume.envelope.data.next_operations,
  ["continue_from_existing_working_set"],
);
assert.deepEqual(
  guidedResume.envelope.data.host_context,
  { acknowledged: { requires_resume: false } },
);
const attachedGuidance = guidedResume.envelope.data.host_recovery_guidance;
assert.equal(attachedGuidance.contract_id, DRAFT_SHAPE_RECOVERY_CARD_CONTRACT);
assert.equal(attachedGuidance.audience, "keeper_only");
assert.equal(attachedGuidance.mode, "pending_finalization_recovery");
// The model-visible guidance carries the semantic projection only.
assert.equal(attachedGuidance.recovery.next_call.tool, "coc_invoke");
assert.equal(attachedGuidance.recovery.draft, run02Card.frozen_finalize_payload.draft);
assert.deepEqual(
  attachedGuidance.recovery.consequence_excerpts,
  ["你贴着墙根屏息"],
);
assert.deepEqual(attachedGuidance.recovery.forbidden, [
  "reroll",
  "repeat_state_writes",
  "rerun_state_journal",
  "rerun_narration_review",
  "supplying_coverage_or_claims_or_identities",
  "echoing_hash_or_opaque_ids",
  "placeholder_prose",
  "accept_new_player_action_before_finalization",
]);
assert.match(attachedGuidance.instruction, /never\s/);
assert.match(attachedGuidance.instruction, /real finalize result/);
// Recursive no-opaque-surface scan over the entire model-visible envelope.
const modelVisibleEnvelope = JSON.stringify(guidedResume.envelope);
for (const forbidden of [
  "sha256:",
  "source_digest",
  "payload_sha256",
  "narration_review_id",
  "turn_id",
  "recovery_card",
  "frozen_finalize_payload",
  "narration-review-v2:dfd1d66b",
  "turn-run02-act02",
  "sha256:source-run02-act02",
]) {
  assert.equal(
    modelVisibleEnvelope.includes(forbidden),
    false,
    `acknowledged guidance leaks "${forbidden}"`,
  );
}
assert.equal(
  /[0-9a-f]{16,}/i.test(
    modelVisibleEnvelope.replace(/coc\.pi-[a-z-]+/g, ""),
  ),
  false,
  "acknowledged guidance leaks long random hex",
);
// The durable internal card retains and verifies everything host-side.
assert.equal(run02Card.payload_sha256, draftShapePayloadDigest(run02Card.frozen_finalize_payload));
assert.equal(run02Card.turn_id, "turn-run02-act02");
assert.equal(run02Card.narration_review_id, run02Facts.narrationReviewId);
assert.equal(guidedResume.audit.card_source, "session_entry");
assert.equal(guidedResume.audit.card_turn_id, run02Card.turn_id);
assert.equal(guidedResume.audit.mode, "already_acknowledged");

// Not attached: pending_finalization mode, campaign mismatch, bad card, non-resume.
assert.equal(applyAcknowledgedResumeRecoveryGuidance({
  ok: true,
  tool: "session.resume",
  data: { schema_version: 1, campaign_id: "run02-campaign", mode: "pending_finalization" },
}, run02Card, { root: "/tmp/r", campaign: "run02-campaign" }).attached, false);
assert.equal(applyAcknowledgedResumeRecoveryGuidance(
  acknowledgedResume,
  run02Card,
  { root: "/tmp/r", campaign: "other-campaign" },
).attached, false);
assert.equal(applyAcknowledgedResumeRecoveryGuidance(
  acknowledgedResume,
  { contract_id: DRAFT_SHAPE_RECOVERY_CARD_CONTRACT },
  { root: "/tmp/r", campaign: "run02-campaign" },
).attached, false);
assert.equal(applyAcknowledgedResumeRecoveryGuidance(
  { ok: false, tool: "session.resume", error: {} },
  run02Card,
  { root: "/tmp/r", campaign: "run02-campaign" },
).attached, false);
assert.equal(applyAcknowledgedResumeRecoveryGuidance(
  { ok: true, tool: "turn.finalize", data: { mode: "already_acknowledged" } },
  run02Card,
  { root: "/tmp/r", campaign: "run02-campaign" },
).attached, false);

// ---------------------------------------------------------------------------
// Host-side pre-transport replay authentication: every model-owned argument
// except the draft's paragraph shape must be deep-canonical-equal to the
// frozen payload before a recovered finalize reaches the transport.
// ---------------------------------------------------------------------------
const frozenReplayPayload = run02Card.frozen_finalize_payload;
// Draft-only paragraph-shape repair is the single editable surface.
assert.equal(isDraftShapeRecoveryReplayUnchanged(
  {
    ...frozenReplayPayload,
    draft: `${frozenReplayPayload.draft}\n\n你先贴着墙根压低身形，屏住呼吸。`,
  },
  frozenReplayPayload,
), true);
// Deep-equal with different key order inside a preserved family is canonical.
assert.equal(isDraftShapeRecoveryReplayUnchanged(
  {
    ...frozenReplayPayload,
    coverage: frozenReplayPayload.coverage.map((row) =>
      Object.fromEntries(Object.entries(row).reverse())),
  },
  frozenReplayPayload,
), true);
// Any mutation of a preserved family fails.
assert.equal(isDraftShapeRecoveryReplayUnchanged(
  {
    ...frozenReplayPayload,
    coverage: [{ ...frozenReplayPayload.coverage[0], exact_excerpt: "改动" }],
  },
  frozenReplayPayload,
), false);
assert.equal(isDraftShapeRecoveryReplayUnchanged(
  { ...frozenReplayPayload, agency_claims: [{ claim_id: "c1" }] },
  frozenReplayPayload,
), false);
assert.equal(isDraftShapeRecoveryReplayUnchanged(
  { ...frozenReplayPayload, mechanics_placements: [] },
  frozenReplayPayload,
), false);
assert.equal(isDraftShapeRecoveryReplayUnchanged(
  { ...frozenReplayPayload, advisory_uptake: { rows: [] } },
  frozenReplayPayload,
), false);
// A dropped model-owned field and an added one both reject the replay.
const {
  advisory_uptake: _droppedAdvisory,
  ...withoutAdvisory
} = frozenReplayPayload;
assert.equal(
  isDraftShapeRecoveryReplayUnchanged(withoutAdvisory, frozenReplayPayload),
  false,
);
assert.equal(isDraftShapeRecoveryReplayUnchanged(
  { ...frozenReplayPayload, validate_only: true },
  frozenReplayPayload,
), false);

// ---------------------------------------------------------------------------
// Real-schema whitelist derivation, canonical digest stability, and
// chronological per-identity folding.
// ---------------------------------------------------------------------------
const { listTypedOperationTools } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")
);
const realFinalizeProperties = Object.keys(
  listTypedOperationTools().find((tool) => tool.operation === "turn.finalize")
    ?.parameters.properties ?? {},
);
// The registered model-owned schema EXCLUDES host-owned repair identity and
// keeps the optional model-owned validation flag.
assert.equal(realFinalizeProperties.includes("repair_finalization_id"), false);
assert.equal(realFinalizeProperties.includes("validate_only"), true);
const realModelOwnedFields = realFinalizeProperties.filter(
  (field) => !HOST_BOUND_FINALIZE_ARGUMENTS.includes(field),
);
assert.deepEqual([...realModelOwnedFields].sort(), [
  "advisory_uptake",
  "agency_claims",
  "coverage",
  "draft",
  "mechanics_placements",
  "validate_only",
]);
// A card built through the real-schema whitelist preserves exactly the
// schema-derived families present in the failed call.
const realSchemaCard = buildDraftShapeRecoveryCard({
  root: "/tmp/run02-root",
  campaign: "run02-campaign",
  facts: run02Facts,
  finalizeArguments: {
    ...run02FailedCallArguments,
    validate_only: false,
  },
  failureEnvelope: placementFailureEnvelope("roll-spot-hidden"),
  modelOwnedFields: realModelOwnedFields,
});
assert.deepEqual(
  Object.keys(realSchemaCard.frozen_finalize_payload).sort(),
  [...realModelOwnedFields].sort(),
);
assert.equal(realSchemaCard.frozen_finalize_payload.validate_only, false);
assert.equal(
  "repair_finalization_id" in realSchemaCard.frozen_finalize_payload,
  false,
);

// Canonical digest: equivalent objects with reordered keys (top level and
// nested) hash identically; array order is preserved.
const reorderTarget = missingCard.frozen_finalize_payload;
const reordered = {
  ...reorderTarget,
  coverage: reorderTarget.coverage.map((row) =>
    Object.fromEntries(Object.entries(row).reverse())),
};
const reorderedCard = {
  ...missingCard,
  frozen_finalize_payload: reordered,
};
assert.equal(
  draftShapePayloadDigest(reordered),
  draftShapePayloadDigest(reorderTarget),
);
assert.equal(
  draftShapePayloadDigest(reorderedCard.frozen_finalize_payload),
  missingCard.payload_sha256,
);
// The reordered-but-equivalent payload still authenticates through the fold.
assert.equal(
  selectRecoverableDraftShapeCard([
    cardEntry(reorderedCard),
    sealEntry(missingCard),
    evidenceFor(missingCard),
  ], "run02-campaign").turn_id,
  "turn-run02-act02",
);
// Array order is preserved: a reordered array is a different payload.
assert.notEqual(
  draftShapePayloadDigest({
    ...reorderTarget,
    coverage: [...reorderTarget.coverage].reverse(),
  }),
  draftShapePayloadDigest(reorderTarget),
);
// validate_only tampering fails closed.
assert.equal(selectRecoverableDraftShapeCard([
  cardEntry({
    ...missingCard,
    frozen_finalize_payload: { ...reorderTarget, validate_only: true },
  }),
  sealEntry(missingCard),
  evidenceFor(missingCard),
], "run02-campaign"), null);

// Chronological fold: two sealed, evidenced cards for the SAME pending turn
// with different payloads are conflicting identities → fail closed.
const conflictingPayload = {
  ...missingCard.frozen_finalize_payload,
  draft: "重试后仍然合并段落的草稿。",
};
const conflictingCard = {
  ...missingCard,
  payload_sha256: draftShapePayloadDigest(conflictingPayload),
  frozen_finalize_payload: conflictingPayload,
  diagnosis: { ...missingCard.diagnosis },
};
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  ...validTurnRecords(conflictingCard),
], "run02-campaign"), null);
// Chronological reopen: a tombstone retires only cards before it; a later
// valid card for the same full identity is live again and recovers.
assert.equal(
  selectRecoverableDraftShapeCard([
    ...validTurnRecords(missingCard),
    completeEntry(missingCard),
    ...validTurnRecords(conflictingCard),
  ], "run02-campaign").turn_id,
  "turn-run02-act02",
);
// Without the reopen: exact tombstone alone still retires the identity.
assert.equal(selectRecoverableDraftShapeCard([
  ...validTurnRecords(missingCard),
  completeEntry(missingCard),
], "run02-campaign"), null);
