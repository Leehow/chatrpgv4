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

process.stdout.write(JSON.stringify({ ok: true }));
