import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));

const gate = new main.OpeningTerminalContinuationGate();
gate.observeMessageStart({
  role: "user",
  content: [{ type: "text", text: "我推门进去。" }],
});
const first = gate.takePreInferenceFinalizationSteer(true);
const pendingBeforeDelivery = gate.takePreInferenceFinalizationSteer(true);

const appended = [];
const sent = [];
let transientFailure = true;
const deliveryPi = {
  appendEntry: (...args) => appended.push(args),
  sendMessage: (...args) => {
    if (transientFailure) {
      transientFailure = false;
      throw new Error("transient send failure");
    }
    sent.push(args);
  },
};
const failedDelivery = main.deliverPendingPreInferenceFinalizationSteer(
  deliveryPi,
  gate,
  true,
);
const stillPendingAfterFailure = gate.takePreInferenceFinalizationSteer(true);
const delivered = main.deliverPendingPreInferenceFinalizationSteer(
  deliveryPi,
  gate,
  true,
);
const duplicateAfterSuccess = main.deliverPendingPreInferenceFinalizationSteer(
  deliveryPi,
  gate,
  true,
);

// Hidden continuations remain inside the same external-user epoch and must
// not arm a second copy of the pre-inference steer.
gate.observeMessageStart({
  role: "custom",
  customType: "coc-source-coordinator-terminal-continuation",
  details: { continuation_class: "nonblocking_background" },
});
const afterHidden = gate.takePreInferenceFinalizationSteer(true);

// A phase that does not own ordinary-turn finalization does not receive the
// steer even though a fresh external user epoch exists.
gate.observeMessageStart({
  role: "user",
  content: [{ type: "text", text: "继续建卡。" }],
});
const openingPhase = gate.takePreInferenceFinalizationSteer(false);

gate.observeMessageStart({
  role: "user",
  content: [{ type: "text", text: "我检查书桌。" }],
});
const nextEpoch = gate.takePreInferenceFinalizationSteer(true);

process.stdout.write(JSON.stringify({
  first: {
    kind: first?.kind,
    status: first?.status,
    epoch: first?.player_turn_epoch,
    action: first?.action,
    instructionHasClosure: typeof first?.instruction === "string"
      && first.instruction.includes("state.journal")
      && first.instruction.includes("turn.output_context")
      && first.instruction.includes("turn.finalize")
      && first.instruction.includes("player-visible"),
  },
  pendingStableBeforeDelivery:
    pendingBeforeDelivery?.player_turn_epoch === first?.player_turn_epoch,
  failedDelivery,
  retryRetainedSameEpoch:
    stillPendingAfterFailure?.player_turn_epoch === first?.player_turn_epoch,
  delivered,
  duplicateAfterSuccess,
  hiddenFollowupSuppressed: afterHidden === null,
  nonFinalizingPhaseSuppressed: openingPhase === null,
  nextEpoch: nextEpoch?.player_turn_epoch,
  delivery: {
    appended: appended.length,
    sent: sent.length,
    customType: sent[0]?.[0]?.customType,
    display: sent[0]?.[0]?.display,
    options: sent[0]?.[1],
  },
}));
