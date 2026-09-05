#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const { NonRetryableFailureCircuit, nonRetryableFailureFingerprint } = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/nonretry-circuit.ts")).href
);

const circuit = new NonRetryableFailureCircuit();
const call = {
  campaignId: "campaign-1",
  operation: "turn.finalize",
  phase: "live_turn",
  operationArgs: { coverage: [] },
};
assert.equal(circuit.preflight(call), null);
circuit.observe({
  ...call,
  envelope: {
    ok: false,
    error: { code: "no_unfinalized_journal" },
    retryable: false,
    will_retry: false,
  },
});
assert.equal(circuit.preflight(call)?.error?.code, "nonretryable_repeat_blocked");
assert.equal(circuit.preflight({
  ...call,
  operationArgs: { coverage: [], draft: "corrected" },
}), null);
assert.equal(circuit.preflight({ ...call, phase: "pending_finalization" }), null);
circuit.observe({ ...call, envelope: { ok: true, data: {} } });
assert.equal(circuit.preflight(call)?.error?.code, "nonretryable_repeat_blocked");
circuit.reset();
assert.equal(circuit.preflight(call), null);

const hostPresenceCircuit = new NonRetryableFailureCircuit();
const hostPresenceCall = {
  campaignId: "campaign-host-presence",
  operation: "turn.output_context",
  phase: "pending_finalization",
  operationArgs: {},
};
const nonretryableInvalidParam = {
  ok: false,
  error: { code: "invalid_param", class: "schema_validation" },
  retryable: false,
  will_retry: false,
};
hostPresenceCircuit.observe({
  ...hostPresenceCall,
  envelope: nonretryableInvalidParam,
});
assert.equal(
  hostPresenceCircuit.preflight({
    ...hostPresenceCall,
    operationArgs: {
      campaign_id: "campaign-host-presence",
      decision_id: "output-context:campaign-host-presence:turn-1",
    },
  }),
  null,
  "adding previously absent required host-owned fields is a legal correction",
);
hostPresenceCircuit.observe({
  ...hostPresenceCall,
  operationArgs: {
    campaign_id: "campaign-host-presence",
    decision_id: "output-context:campaign-host-presence:turn-1",
  },
  envelope: nonretryableInvalidParam,
});
assert.equal(
  hostPresenceCircuit.preflight({
    ...hostPresenceCall,
    operationArgs: {
      campaign_id: "different-host-value",
      decision_id: "output-context:campaign-host-presence:turn-2",
    },
  })?.error?.code,
  "nonretryable_repeat_blocked",
  "changing only present host-owned identities cannot evade the block",
);
assert.equal(
  hostPresenceCircuit.preflight({
    ...hostPresenceCall,
    operationArgs: {
      campaign_id: "different-host-value",
      decision_id: "output-context:campaign-host-presence:turn-2",
      requested_section: "visible_mechanics",
    },
  }),
  null,
  "changing a semantic argument remains a legal correction",
);

const fingerprintFor = (operationArgs) => nonRetryableFailureFingerprint({
  campaignId: "campaign-host-presence",
  operation: "state.journal",
  phase: "live_turn",
  operationArgs,
  errorCode: "invalid_param",
  errorClass: "schema_validation",
});
const nestedHostArguments = {
  entries: [
    {
      claim: "the cellar door is locked",
      metadata: {
        campaign_id: "campaign-a",
        decision_id: "journal:campaign-a:turn-1",
      },
    },
  ],
};
assert.equal(
  fingerprintFor(nestedHostArguments),
  fingerprintFor({
    entries: [
      {
        claim: "the cellar door is locked",
        metadata: {
          campaign_id: "campaign-b",
          decision_id: "journal:campaign-b:turn-9",
        },
      },
    ],
  }),
  "nested host-owned values normalize deterministically inside arrays",
);
assert.notEqual(
  fingerprintFor(nestedHostArguments),
  fingerprintFor({
    entries: [
      {
        claim: "the cellar door is locked",
        metadata: {},
      },
    ],
  }),
  "nested host-owned presence remains distinct from absence",
);
assert.notEqual(
  fingerprintFor(nestedHostArguments),
  fingerprintFor({
    entries: [
      {
        claim: "the attic window is open",
        metadata: {
          campaign_id: "campaign-a",
          decision_id: "journal:campaign-a:turn-1",
        },
      },
    ],
  }),
  "semantic changes inside nested arrays remain distinct",
);

const progress = (playerTurnEpoch, stage, overrides = {}) => ({
  playerTurnEpoch,
  canonicalProgressRevision: 0,
  stage,
  campaignRevision: null,
  journalRevision: null,
  reviewRevision: null,
  finalizedRenderedSha256: null,
  closedObligationCount: 0,
  ...overrides,
});
const scopedCircuit = new NonRetryableFailureCircuit();
const scopedCall = {
  campaignId: "campaign-1",
  operation: "turn.finalize",
  phase: "pending_finalization",
  playerTurnEpoch: 7,
  canonicalProgress: progress(7, "review_ready", {
    canonicalProgressRevision: 10,
    campaignRevision: "campaign-revision-a",
    journalRevision: "journal-revision-a",
    reviewRevision: 1,
  }),
  operationArgs: {
    draft: "门后传来  两声轻响。",
    decision_id: "host-decision-a",
    source_digest: "sha256:first",
    review_id: "opaque-review-a",
    target_npc_id: "walter-corbitt",
  },
};
assert.equal(
  nonRetryableFailureFingerprint({
    ...scopedCall,
    errorCode: "default_mechanics_placement_unavailable",
  }),
  nonRetryableFailureFingerprint({
    ...scopedCall,
    canonicalProgress: {
      ...scopedCall.canonicalProgress,
      campaignRevision: "different-opaque-campaign-revision",
      journalRevision: "different-opaque-journal-revision",
    },
    errorCode: "default_mechanics_placement_unavailable",
  }),
  "opaque progress identities and digest churn do not manufacture progress",
);
scopedCircuit.observe({
  ...scopedCall,
  envelope: {
    ok: false,
    error: { code: "default_mechanics_placement_unavailable" },
    retryable: false,
    will_retry: false,
  },
});
const identityAndWhitespaceChurn = {
  ...scopedCall,
  operationArgs: {
    ...scopedCall.operationArgs,
    draft: "  门后传来 两声轻响。\n",
    decision_id: "host-decision-b",
    source_digest: "sha256:second",
    review_id: "opaque-review-b",
  },
};
assert.equal(
  scopedCircuit.preflight(identityAndWhitespaceChurn)?.error?.code,
  "nonretryable_repeat_blocked",
  "host identity and whitespace churn must not evade the same-progress block",
);
assert.equal(
  scopedCircuit.preflight({
    ...identityAndWhitespaceChurn,
    operationArgs: {
      ...identityAndWhitespaceChurn.operationArgs,
      target_npc_id: "other-present-npc",
    },
  }),
  null,
  "a changed model-owned semantic choice remains a legitimate correction",
);

const progressedCall = {
  ...identityAndWhitespaceChurn,
  canonicalProgress: progress(7, "review_ready", {
    canonicalProgressRevision: 11,
    campaignRevision: "campaign-revision-b",
    journalRevision: "journal-revision-b",
    reviewRevision: 1,
  }),
};
scopedCircuit.observe({
  ...progressedCall,
  envelope: { ok: true, data: {} },
});
assert.equal(
  scopedCircuit.preflight(progressedCall),
  null,
  "same-stage accepted canonical revision advance invalidates stale blocks",
);

scopedCircuit.observe({
  ...progressedCall,
  envelope: {
    ok: false,
    error: {
      code: "default_mechanics_placement_unavailable",
      class: "finalization_repair",
    },
    retryable: false,
    will_retry: false,
  },
});
const regressedCall = {
  ...progressedCall,
  canonicalProgress: progress(7, "acting", {
    canonicalProgressRevision: 10,
    campaignRevision: "campaign-revision-a",
    closedObligationCount: 0,
  }),
};
assert.equal(
  scopedCircuit.preflight(regressedCall)?.error?.code,
  "canonical_progress_rejected",
  "a stale/regressive projection is refused",
);
assert.equal(
  scopedCircuit.preflight(progressedCall)?.error?.code,
  "nonretryable_repeat_blocked",
  "a stale/regressive projection cannot erase the current block",
);
const sameRevisionReceiptConflict = {
  ...progressedCall,
  canonicalProgress: {
    ...progressedCall.canonicalProgress,
    campaignRevision: "campaign-revision-conflict",
    journalRevision: "journal-revision-conflict",
  },
};
assert.equal(
  scopedCircuit.preflight(sameRevisionReceiptConflict)?.error?.code,
  "canonical_progress_rejected",
  "same revision cannot identify conflicting accepted receipts",
);
assert.equal(
  scopedCircuit.preflight(progressedCall)?.error?.code,
  "nonretryable_repeat_blocked",
  "same-revision receipt conflict cannot erase the retained block",
);

const finalizedCall = {
  ...progressedCall,
  canonicalProgress: progress(7, "finalized", {
    canonicalProgressRevision: 12,
    campaignRevision: "campaign-revision-c",
    journalRevision: "journal-revision-b",
    reviewRevision: 2,
    finalizedRenderedSha256: "sha256:finalized-receipt",
    closedObligationCount: 1,
  }),
};
scopedCircuit.observe({
  ...finalizedCall,
  envelope: { ok: true, data: {} },
});
assert.equal(scopedCircuit.preflight(finalizedCall), null);

assert.throws(
  () => scopedCircuit.preflight({
    ...scopedCall,
    playerTurnEpoch: 8,
  }),
  /canonical progress must belong/,
);

scopedCircuit.reset();
assert.equal(
  scopedCircuit.preflight(regressedCall),
  null,
  "reset clears retained progress ordering and failure blocks",
);

// --- an idempotency conflict's only remedy IS the identity field ---------- //
//
// `idempotency_conflict` means the supplied decision_id is already bound to
// different immutable arguments. The one thing that makes the call different
// is a fresh decision_id -- which the fingerprint normalized away as
// host-owned churn, so the documented recovery was answered
// `nonretryable_repeat_blocked`. Measured 2026-09-02
// (debug-gate9-depth-10-r61, lane m2-reload): `rules.settle` refused
// `combat-attack-corbitt-38-empty-v1`, the Keeper reissued the identical
// semantics under `...-v2`, and was blocked. Eight blocks followed and the
// player's turn was never delivered.
const idempotencyCircuit = new NonRetryableFailureCircuit();
const settleCall = {
  campaignId: "campaign-idempotency",
  operation: "rules.settle",
  phase: "live_turn",
  operationArgs: {
    campaign: "campaign-idempotency",
    decision_id: "combat-attack-corbitt-38-empty-v1",
    decision_ref: "decision:coc7:combat:attack",
    semantic_inputs: {
      candidate_ref: "attack:npc-walter-corbitt",
      weapon_ref: "revolver_38",
    },
  },
};
const idempotencyEnvelope = {
  ok: false,
  retryable: false,
  will_retry: false,
  error: {
    code: "idempotency_conflict",
    class: "idempotency_conflict",
    message: "rules.settle decision_id is already bound to different immutable arguments",
    recoverable_by: "host_binding_refresh",
    allowed_next_actions: [],
    automatic_action: "refresh_retained_binding_or_fault",
  },
};
idempotencyCircuit.observe({ ...settleCall, envelope: idempotencyEnvelope });
const sameKeyAgain = idempotencyCircuit.preflight(settleCall);
assert.equal(
  sameKeyAgain?.error?.code,
  "nonretryable_repeat_blocked",
  "reissuing the SAME bound decision_id is still a pointless repeat",
);
assert.equal(
  idempotencyCircuit.preflight({
    ...settleCall,
    operationArgs: {
      ...settleCall.operationArgs,
      decision_id: "combat-attack-corbitt-38-empty-v2",
    },
  }),
  null,
  "a fresh decision_id -- and nothing else -- is already a different call",
);

// The refusal must say what would actually differ, not only what would not.
assert.match(
  String(sameKeyAgain?.error?.message ?? ""),
  /idempotency_conflict/u,
  "the refusal names the failure it is repeating",
);
assert.match(
  String(sameKeyAgain?.error?.message ?? ""),
  /decision_id/u,
  "the refusal names the argument that would unblock it",
);
assert.ok(
  Array.isArray(sameKeyAgain?.error?.details?.unblocked_by)
    && sameKeyAgain.error.details.unblocked_by.length > 0,
  "the refusal enumerates what would differ",
);
assert.ok(
  sameKeyAgain.error.details.unblocked_by.some(
    (line) => /unused decision_id/u.test(String(line)),
  ),
  "an identity-scoped block names a fresh idempotency key as the remedy",
);
assert.ok(
  !sameKeyAgain.error.details.ignored_argument_keys.includes("decision_id"),
  "decision_id is not ignored for a failure whose subject it is",
);

// Every other non-retryable failure keeps decision_id as host-owned churn.
const churnCircuit = new NonRetryableFailureCircuit();
const churnCall = {
  campaignId: "campaign-churn",
  operation: "rules.settle",
  phase: "live_turn",
  operationArgs: {
    decision_id: "combat-attack-v1",
    semantic_inputs: { weapon_ref: "revolver-38" },
  },
};
churnCircuit.observe({
  ...churnCall,
  envelope: {
    ok: false,
    retryable: false,
    will_retry: false,
    error: { code: "unknown_weapon", class: "invariant_terminal" },
  },
});
const churnBlocked = churnCircuit.preflight({
  ...churnCall,
  operationArgs: { ...churnCall.operationArgs, decision_id: "combat-attack-v2" },
});
assert.equal(
  churnBlocked?.error?.code,
  "nonretryable_repeat_blocked",
  "a new decision_id must not evade an unrelated non-retryable failure",
);
assert.ok(
  churnBlocked.error.details.ignored_argument_keys.includes("decision_id"),
  "the refusal names decision_id as an argument it ignored",
);
assert.match(
  String(churnBlocked.error.message),
  /semantic argument/u,
  "the refusal names the model-owned change that would unblock it",
);

process.stdout.write(JSON.stringify({ ok: true }));
