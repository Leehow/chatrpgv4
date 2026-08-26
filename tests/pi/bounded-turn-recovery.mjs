#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const turnOutput = await import(pathToFileURL(path.join(
  root,
  "plugins/coc-keeper/pi/lib/turn-output-gate.ts",
)).href);
const mechanicalOutput = await import(pathToFileURL(path.join(
  root,
  "plugins/coc-keeper/pi/lib/mechanical-output-gate.ts",
)).href);
const { OpeningTerminalContinuationGate } = await import(pathToFileURL(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
)).href);

class PureTurnGate {}
Object.assign(PureTurnGate.prototype, turnOutput.createTurnOutputGateMethods({
  buildSettledOutputGateEnvelope: mechanicalOutput.buildSettledOutputGateEnvelope,
  buildSettledOutputPreflightEnvelope:
    mechanicalOutput.buildSettledOutputPreflightEnvelope,
  canonicalJsonValueSha256: (value) => `test:${JSON.stringify(value)}`,
}));
turnOutput.installTurnOutputGateState(PureTurnGate.prototype);

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

const gate = new PureTurnGate();
gate.markExternalUserInput("我推开地下室的门。");
assert.equal(gate.playerTurnEpoch, 1);

const preflight = gate.takePreInferenceFinalizationSteer(true);
assert.equal(preflight?.kind, "settled_output_preflight");
assert.equal(gate.markPreInferenceFinalizationSteerDelivered(preflight), true);
assert.equal(gate.takePreInferenceFinalizationSteer(true), null);

assert.equal(gate.takeEmptyTerminalRecovery()?.kind, "empty_terminal_recovery");
assert.equal(gate.takeEmptyTerminalRecovery(), null);

const acting = progress(1, "acting", { canonicalProgressRevision: 1 });
const first = gate.claimSettledOutputRecovery(acting);
assert.equal(first.status, "claimed");
assert.equal(first.scheduleFollowUp, true);
assert.equal(first.envelope.recovery_attempt, 1);
assert.equal(first.envelope.recovery_budget, 2);
assert.equal(first.envelope.canonical_progress.stage, "acting");

const second = gate.claimSettledOutputRecovery(acting);
assert.equal(second.status, "claimed");
assert.equal(second.envelope.recovery_attempt, 2);

const third = gate.claimSettledOutputRecovery(
  acting,
  "narration_review_mismatch",
);
assert.equal(third.status, "exhausted");
assert.equal(third.scheduleFollowUp, false);
assert.equal(third.envelope, null);
assert.equal(third.fault.kind, "turn_processing_fault");
assert.equal(third.fault.stage, "finalization_repair");
assert.equal(third.fault.code, "settled_output_recovery_exhausted");
assert.equal(third.fault.recovery_attempted, 2);
assert.equal(third.fault.recovery_budget, 2);
assert.equal(third.fault.pending_turn_preserved, true);
assert.equal(third.fault.last_error_class, "narration_review_mismatch");
assert.equal(third.fault.canonical_progress.stage, "acting");

const progressed = progress(1, "journaled", {
  canonicalProgressRevision: 2,
  journalRevision: "journal-revision-1",
  closedObligationCount: 1,
});
const afterProgress = gate.claimSettledOutputRecovery(progressed);
assert.equal(
  afterProgress.status,
  "exhausted",
  "canonical progress enables the next stage but does not reset this recovery kind",
);
assert.equal(afterProgress.fault.canonical_progress.stage, "journaled");

// OpeningTerminalContinuationGate.reset() assigns playerTurnEpoch=0. The
// owned descriptor must clear every recovery field at that exact seam.
gate.playerTurnEpoch = 0;
assert.equal(gate.settledOutputRecoveryEpoch, 0);
assert.equal(gate.settledOutputRecoveryAttempts, 0);
assert.equal(gate.settledOutputCanonicalProgress, null);

gate.markExternalUserInput("我检查棺材后的墙。");
assert.equal(gate.playerTurnEpoch, 1);
const afterReset = gate.claimSettledOutputRecovery(progress(1, "acting", {
  canonicalProgressRevision: 1,
}));
assert.equal(afterReset.status, "claimed");
assert.equal(afterReset.envelope.recovery_attempt, 1);

gate.markExternalUserInput("我敲了敲北墙。");
assert.equal(gate.playerTurnEpoch, 2);
const nextEpoch = gate.claimSettledOutputRecovery(progress(2, "acting", {
  canonicalProgressRevision: 1,
}));
assert.equal(nextEpoch.status, "claimed");
assert.equal(nextEpoch.envelope.recovery_attempt, 1);
assert.equal(gate.takeEmptyTerminalRecovery()?.player_turn_epoch, 2);
assert.equal(gate.takeEmptyTerminalRecovery(), null);

assert.throws(
  () => gate.claimSettledOutputRecovery(progress(1, "acting")),
  /current external player epoch/,
);

const progressGate = new PureTurnGate();
progressGate.markExternalUserInput("我核对现有收据。");
const sameStageR1 = progress(1, "review_ready", {
  canonicalProgressRevision: 5,
  journalRevision: "journal-a",
  reviewRevision: 1,
});
const sameStageR2 = {
  ...sameStageR1,
  canonicalProgressRevision: 6,
  journalRevision: "journal-b",
};
assert.equal(
  progressGate.claimSettledOutputRecovery(sameStageR1).status,
  "claimed",
);
const acceptedSameStage = progressGate.claimSettledOutputRecovery(sameStageR2);
assert.equal(acceptedSameStage.status, "claimed");
assert.equal(
  acceptedSameStage.envelope.canonical_progress.canonical_progress_revision,
  6,
);
const rejectedRegression = progressGate.claimSettledOutputRecovery({
  ...sameStageR1,
  canonicalProgressRevision: 4,
  stage: "acting",
});
assert.equal(rejectedRegression.status, "progress_rejected");
assert.equal(rejectedRegression.scheduleFollowUp, false);
assert.equal(rejectedRegression.fault.pending_turn_preserved, true);
assert.equal(
  rejectedRegression.fault.progress_rejection_reason,
  "canonical_revision_regressed",
);
assert.throws(
  () => turnOutput.canonicalTurnProgressToken(progress(2, "imaginary-stage")),
  /unsupported canonical turn stage/,
);

const productionGate = new OpeningTerminalContinuationGate();
productionGate.markExternalUserInput("验证真实 reset seam。");
productionGate.settledOutputRecoveryEpoch = 1;
productionGate.settledOutputRecoveryAttempts = 2;
productionGate.settledOutputCanonicalProgress = progress(1, "acting", {
  canonicalProgressRevision: 1,
});
productionGate.reset();
assert.equal(productionGate.playerTurnEpoch, 0);
assert.equal(productionGate.settledOutputRecoveryEpoch, 0);
assert.equal(productionGate.settledOutputRecoveryAttempts, 0);
assert.equal(productionGate.settledOutputCanonicalProgress, null);

process.stdout.write(JSON.stringify({ ok: true }));
