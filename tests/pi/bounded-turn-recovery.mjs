#!/usr/bin/env node
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

const acting = progress(1, "acting");
const first = gate.claimSettledOutputRecovery(acting);
assert.equal(first.status, "claimed");
assert.equal(first.scheduleFollowUp, true);
assert.equal(first.envelope.recovery_attempt, 1);
assert.equal(first.envelope.recovery_budget, 2);
assert.equal(first.envelope.canonical_progress.stage, "acting");

const second = gate.claimSettledOutputRecovery(acting);
assert.equal(second.status, "claimed");
assert.equal(second.envelope.recovery_attempt, 2);

const third = gate.claimSettledOutputRecovery(acting);
assert.equal(third.status, "exhausted");
assert.equal(third.scheduleFollowUp, false);
assert.equal(third.envelope, null);
assert.equal(third.fault.kind, "turn_processing_fault");
assert.equal(third.fault.stage, "finalization_repair");
assert.equal(third.fault.code, "settled_output_recovery_exhausted");
assert.equal(third.fault.recovery_attempted, 2);
assert.equal(third.fault.recovery_budget, 2);
assert.equal(third.fault.canonical_progress.stage, "acting");

const progressed = progress(1, "journaled", {
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

gate.markExternalUserInput("我检查棺材后的墙。");
assert.equal(gate.playerTurnEpoch, 2);
const nextEpoch = gate.claimSettledOutputRecovery(progress(2, "acting"));
assert.equal(nextEpoch.status, "claimed");
assert.equal(nextEpoch.envelope.recovery_attempt, 1);
assert.equal(gate.takeEmptyTerminalRecovery()?.player_turn_epoch, 2);
assert.equal(gate.takeEmptyTerminalRecovery(), null);

assert.throws(
  () => gate.claimSettledOutputRecovery(progress(1, "acting")),
  /current external player epoch/,
);
assert.throws(
  () => turnOutput.canonicalTurnProgressToken(progress(2, "imaginary-stage")),
  /unsupported canonical turn stage/,
);

process.stdout.write(JSON.stringify({ ok: true }));
