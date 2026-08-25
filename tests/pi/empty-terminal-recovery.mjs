import "./_lib/preload-embedded-pi.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));

const digest = (text) => (
  `sha256:${createHash("sha256").update(
    JSON.stringify(text),
    "utf8",
  ).digest("hex")}`
);

const EMPTY_TERMINAL_RECOVERY_DELIVERY_FAILED_ENTRY = (
  "coc-empty-terminal-recovery-delivery-failed"
);
const FAULT_MESSAGE_NO_PLAYER_OUTPUT = (
  "回合处理失败：本回合外部玩家输入已受理，但助手终态仍未产生任何玩家可见输出。"
  + "不要重发玩家输入，也不要重放或重跑本回合已执行的规则与状态操作；"
  + "本回合可能已有 canonical 写入。保留现有证据与收据，经 session.resume 核对"
  + "既有收据后，仅补齐缺失的 finalization 与玩家输出。"
);
const FAULT_MESSAGE_RECOVERY_DELIVERY_FAILED = (
  "回合处理失败：空终态恢复指令投递失败，本回合外部玩家输入仍未回答。"
  + "不要重发玩家输入，也不要重放或重跑本回合已执行的规则与状态操作；"
  + "本回合可能已有 canonical 写入。保留现有证据与收据，经 session.resume 核对"
  + "既有收据后，仅补齐缺失的 finalization 与玩家输出。"
);

// Mirrors the production wiring in registerCocExtension: the visible-final
// callback marks the epoch answered on delivery, and the empty-terminal
// callback owns the bounded same-epoch recovery / fail-closed fault,
// including the scheduled-send boolean check and the recovery-delivery
// failure fault.
function buildHarness({ failRecoverySend = false } = {}) {
  const handlers = new Map();
  const sent = [];
  const appended = [];
  const pi = {
    on(type, handler) {
      const registered = handlers.get(type) || [];
      registered.push(handler);
      handlers.set(type, registered);
    },
    sendMessage: (message, options) => {
      if (
        failRecoverySend
        && message.customType === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
      ) {
        throw new Error("session closing: recovery follow-up not sent");
      }
      sent.push([message, options]);
      return true;
    },
    appendEntry: (...args) => {
      appended.push(args);
    },
  };
  const gate = new main.OpeningTerminalContinuationGate();
  const deliverFault = (fault) => {
    pi.sendMessage({
      customType: main.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
      content: JSON.stringify(fault),
      display: false,
      details: fault,
    }, { triggerTurn: false });
  };
  const armAndDeliverFault = (code, message) => {
    const armed = gate.armTurnProcessingFault({
      schema_version: 1,
      contract_id: "coc.pi-turn-processing-fault.v1",
      kind: "turn_processing_fault",
      status: "terminal",
      stage: "player_output_delivery",
      code,
      message,
      retryable: false,
      will_retry: false,
      recovery_attempted: 1,
      failure_class: code,
    });
    if (armed.first) {
      pi.appendEntry(main.TURN_PROCESSING_FAULT_CUSTOM_TYPE, armed.fault);
      const deliverable = gate.takeTurnProcessingFaultForDelivery();
      if (deliverable !== null) deliverFault(deliverable);
    }
  };
  main.registerPlayerTranscriptGate(
    pi,
    (visibleText) => {
      const decision = gate.acceptVisibleAssistantFinal(visibleText, false);
      if (
        decision === true
        || (
          decision
          && typeof decision === "object"
          && typeof decision.replacementText === "string"
        )
      ) {
        gate.markEpochPlayerOutputDelivered();
      }
      return decision;
    },
    (message) => gate.observeMessageStart(message),
    () => gate.hasPendingFinalizedOutput(),
    () => {
      const recovery = gate.takeEmptyTerminalRecovery();
      if (recovery !== null) {
        const scheduled = main.deliverEmptyTerminalRecovery(
          pi,
          recovery,
          main.buildEmptyTerminalRecoveryInstruction(false),
        );
        if (scheduled) return;
        armAndDeliverFault(
          "empty_terminal_recovery_delivery_failed",
          FAULT_MESSAGE_RECOVERY_DELIVERY_FAILED,
        );
        return;
      }
      if (!gate.hasAnswerPendingExternalPlayerInput()) return;
      armAndDeliverFault(
        "empty_terminal_no_player_output",
        FAULT_MESSAGE_NO_PLAYER_OUTPUT,
      );
    },
  );
  const emit = async (type, message) => {
    let result;
    for (const handler of handlers.get(type) || []) {
      result = await handler({ type, message }, {});
    }
    return result;
  };
  return { gate, emit, sent, appended };
}

const emptyFinal = (stopReason = "stop") => ({
  role: "assistant",
  stopReason,
  content: [{ type: "thinking", thinking: "provider-successful reasoning only" }],
});
const textParts = (message) => (message?.content ?? [])
  .filter((part) => part.type === "text")
  .map((part) => part.text)
  .join("");
const userTurn = (body) => ({
  role: "user",
  content: [{ type: "text", text: body }],
});
const recoverySends = (h) => h.sent.filter(([message]) => (
  message.customType === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
));
const faultSends = (h) => h.sent.filter(([message]) => (
  message.customType === main.TURN_PROCESSING_FAULT_CUSTOM_TYPE
));
const appendedKinds = (h, kind) => h.appended.filter(([entryKind]) => (
  entryKind === kind
));

// 1. Startup/setup-only empty terminals (no external player epoch pending)
//    recover nothing and arm no fault.
{
  const h = buildHarness();
  const dropped = await h.emit("message_end", emptyFinal());
  var noEpoch = {
    thinkingStripped: textParts(dropped?.message).length === 0,
    sends: h.sent.length,
    appends: h.appended.length,
  };
}

// 2. error/aborted terminals never recover; a genuine provider-successful
//    empty stop in the same epoch recovers exactly once.
{
  const h = buildHarness();
  const playerText = "我借浪头够那根艇索。";
  await h.emit("message_start", userTurn(playerText));
  await h.emit("message_end", emptyFinal("error"));
  await h.emit("message_end", emptyFinal("aborted"));
  const afterFailures = recoverySends(h).length;
  await h.emit("message_end", emptyFinal("stop"));
  var errorAborted = {
    noRecoveryOnErrorAborted: afterFailures === 0,
    recoveryOnStop: recoverySends(h).length === 1,
  };
}

// 3. First empty stop schedules exactly one hidden follow-up; the player
//    input is never duplicated; the second empty stop fails closed through
//    the structured turn-processing fault; a third does not loop.
{
  const h = buildHarness();
  const playerText = "我检查门后的动静。";
  await h.emit("message_start", userTurn(playerText));
  const first = await h.emit("message_end", emptyFinal());
  const firstSend = recoverySends(h)[0];
  const second = await h.emit("message_end", emptyFinal());
  const third = await h.emit("message_end", emptyFinal());
  var firstEpoch = {
    firstTerminalThinkingStripped: textParts(first?.message).length === 0,
    recoverySends: recoverySends(h).length,
    recoveryOptions: firstSend?.[1],
    recoveryHidden: firstSend?.[0].display === false,
    recoveryDetails: {
      kind: firstSend?.[0].details.kind,
      playerTurnEpoch: firstSend?.[0].details.player_turn_epoch,
    },
    recoveryAppended: appendedKinds(
      h,
      main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE,
    ).length,
    playerInputNotDuplicated: (
      h.sent.filter(([message]) => message.role === "user").length === 0
      && !JSON.stringify(h.sent).includes(playerText)
      && !JSON.stringify(h.appended).includes(playerText)
    ),
    secondTerminalNoNewRecovery: recoverySends(h).length === 1,
    faultSends: faultSends(h).length,
    faultOptions: faultSends(h)[0]?.[1],
    faultFailureClass: faultSends(h)[0]?.[0].details.failure_class,
    faultAppended: appendedKinds(
      h,
      main.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
    ).length,
    thirdTerminalNoLoop: (
      recoverySends(h).length === 1 && faultSends(h).length === 1
      && textParts(third?.message).length === 0
      && textParts(second?.message).length === 0
    ),
  };
}

// 4. A new external player epoch can recover once again.
{
  const h = buildHarness();
  await h.emit("message_start", userTurn("第一句玩家输入。"));
  await h.emit("message_end", emptyFinal());
  await h.emit("message_start", userTurn("第二句玩家输入。"));
  await h.emit("message_end", emptyFinal());
  const sends = recoverySends(h);
  var newEpoch = {
    recoverySends: sends.length,
    epochs: sends.map(([message]) => message.details.player_turn_epoch),
  };
}

// 5. Once the epoch delivered player-visible output, later same-epoch empty
//    terminals are background wakes: no recovery, no fault.
{
  const h = buildHarness();
  await h.emit("message_start", userTurn("我看向窗边。"));
  await h.emit("message_end", {
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text: "窗外的雨停了。" }],
  });
  await h.emit("message_end", emptyFinal());
  var answeredEpoch = {
    sends: h.sent.length,
    appends: h.appended.length,
  };
}

// 6. Tool-bearing terminals route through the tool branch, not recovery.
{
  const h = buildHarness();
  await h.emit("message_start", userTurn("我去查看工具。"));
  const toolFinal = await h.emit("message_end", {
    role: "assistant",
    stopReason: "toolUse",
    content: [
      { type: "text", text: "工具过渡。" },
      { type: "toolCall", id: "call-empty-recovery-probe", name: "coc_invoke", arguments: {} },
    ],
  });
  var toolBearing = {
    sends: h.sent.length,
    toolCallPreserved: (toolFinal?.message?.content ?? []).some(
      (part) => part.type === "toolCall",
    ),
  };
}

// 7. Normal visible output behavior is unchanged: pass-through final keeps
//    its exact text and sends nothing.
{
  const h = buildHarness();
  await h.emit("message_start", userTurn("正常叙述回合。"));
  const narration = {
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text: "雨水沿着窗玻璃缓缓滑落。" }],
  };
  const result = await h.emit("message_end", narration);
  var visibleNormal = {
    passThroughUntransformed: result === undefined,
    textPreserved: textParts(narration) === "雨水沿着窗玻璃缓缓滑落。",
    sends: h.sent.length,
  };
}

// 8. Recovery send failure: no scheduled in-flight marker, a distinct
//    delivery-failed audit marker, and an immediate non-retrying fault —
//    no waiting for another settle.
{
  const h = buildHarness({ failRecoverySend: true });
  const playerText = "恢复投递会失败的回合。";
  await h.emit("message_start", userTurn(playerText));
  const dropped = await h.emit("message_end", emptyFinal());
  var sendFailure = {
    thinkingStripped: textParts(dropped?.message).length === 0,
    recoverySends: recoverySends(h).length,
    scheduledMarkers: appendedKinds(
      h,
      main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE,
    ).length,
    deliveryFailedMarkers: appendedKinds(
      h,
      EMPTY_TERMINAL_RECOVERY_DELIVERY_FAILED_ENTRY,
    ).length,
    faultSends: faultSends(h).length,
    faultFailureClass: faultSends(h)[0]?.[0].details.failure_class,
    faultOptions: faultSends(h)[0]?.[1],
    playerInputNotDuplicated: (
      h.sent.filter(([message]) => message.role === "user").length === 0
      && !JSON.stringify(h.sent).includes(playerText)
      && !JSON.stringify(h.appended).includes(playerText)
    ),
  };
}

// 9. A turn-processing fault retained from an older epoch neither suppresses
//    the new epoch's visible output nor blocks the new epoch's own fault;
//    same-epoch suppression is unchanged and the retained fault object
//    stays available to the narration.review latch.
{
  const h = buildHarness();
  await h.emit("message_start", userTurn("第一回合。"));
  await h.emit("message_end", emptyFinal());
  await h.emit("message_end", emptyFinal());
  const epoch1FaultCount = faultSends(h).length;
  const sameEpochSuppressed = (
    h.gate.acceptVisibleAssistantFinal("同回合的正常叙述。") === false
  );
  await h.emit("message_start", userTurn("第二回合。"));
  const staleFaultRetained = h.gate.currentTurnProcessingFault() !== null;
  const narrationResult = await h.emit("message_end", {
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text: "新回合的正常叙述。" }],
  });
  await h.emit("message_start", userTurn("第三回合。"));
  await h.emit("message_end", emptyFinal());
  await h.emit("message_end", emptyFinal());
  const newFault = faultSends(h).at(-1)?.[0].details;
  var staleFault = {
    epoch1FaultCount,
    sameEpochSuppressed,
    staleFaultRetained,
    narrationPassed: narrationResult === undefined,
    newFaultCount: faultSends(h).length,
    newFaultEpoch: newFault?.player_turn_epoch,
    newFaultFailureClass: newFault?.failure_class,
  };
}

// 10. Fault and recovery wording never tells anyone to resend the input;
//     the hidden recovery itself must reconcile existing receipts/state and
//     only complete demonstrably missing work — it must not instruct the KP
//     to rerun mechanics that may already be committed for this epoch.
{
  const h = buildHarness();
  await h.emit("message_start", userTurn("审阅措辞的回合。"));
  await h.emit("message_end", emptyFinal());
  const recoveryContent = recoverySends(h)[0]?.[0].content ?? "";
  await h.emit("message_end", emptyFinal());
  const faultMessage = faultSends(h)[0]?.[0].details.message ?? "";
  const finalizationContent = main.buildEmptyTerminalRecoveryInstruction(true);
  var noResend = {
    recoverySaysNoResend: recoveryContent.includes("不要重发"),
    recoverySaysNoRerun: recoveryContent.includes("不得重跑"),
    recoveryInspectsExistingState: (
      recoveryContent.includes("先盘点")
      && recoveryContent.includes("权威收据")
      && recoveryContent.includes("已落账状态")
    ),
    recoveryOnlyMissingWork: (
      recoveryContent.includes("只补做确实缺失的部分")
      && finalizationContent.includes("只补做确实缺失的部分")
    ),
    recoveryAllowsCompletedMechanics: (
      recoveryContent.includes("可能已部分或全部完成")
    ),
    recoveryNotClaimingWhollyUnsettled: (
      !recoveryContent.includes("尚未结算")
      && !finalizationContent.includes("尚未结算")
    ),
    finalizationBranchKeepsContract: (
      finalizationContent.includes("turn.finalize")
      && finalizationContent.includes("rendered_text")
    ),
    faultSaysNoResend: faultMessage.includes("不要重发"),
    faultSaysNoRerun: faultMessage.includes("不要重放或重跑"),
    faultPointsToResume: faultMessage.includes("session.resume"),
    noResendGuidance: (
      !faultMessage.includes("重新发送")
      && !recoveryContent.includes("重新发送")
    ),
  };
}

// 11. Startup-resume sessions never route empty terminals through the
//     recovery callback: the startup gate owns its own reprompt flow.
//     Full-extension harness (same pattern as startup-resume probes).
async function fullStartupHarness() {
  const welcomeAgentDir = mkdtempSync(path.join(tmpdir(), "pi-coc-empty-recovery-"));
  const handlers = new Map();
  const sent = [];
  const appended = [];
  const fakePi = {
    registerTool: () => {},
    registerCommand: () => {},
    registerShortcut: () => {},
    on: (name, handler) => {
      const values = handlers.get(name) || [];
      values.push(handler);
      handlers.set(name, values);
    },
    appendEntry: (...args) => {
      appended.push(args);
    },
    sendMessage: (message, options) => {
      sent.push([message, options]);
    },
    setActiveTools: () => {},
    getThinkingLevel: () => "off",
  };
  main.default(fakePi, {
    coordinatorEnabled: async () => false,
    createClient: () => ({
      callTool: async (name) => {
        if (name === "coc_capabilities") return { ok: true, host: "pi" };
        throw new Error(`unexpected ${name}`);
      },
      callToolWithTransportMeta: async (name) => ({
        value: await Promise.reject(new Error(`unexpected ${name}`)),
        transport: null,
      }),
      close: async () => {},
    }),
    startupCampaignId: () => "startup-empty-recovery-campaign",
    welcomeAgentDir,
    launchCoordinator: () => ({
      child: {},
      activation: Promise.resolve({ type: "agent_start" }),
      completion: Promise.resolve([]),
      terminate: async () => {},
    }),
  });
  const ctx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "offline", id: "offline" },
    sessionManager: {
      getSessionId: () => "startup-empty-recovery",
      getEntries: () => [],
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
  const emit = async (type, message) => {
    let result;
    for (const handler of handlers.get(type) || []) {
      result = await handler({ type, message }, {});
    }
    return result;
  };
  return {
    sent,
    appended,
    emit,
    async start() {
      await handlers.get("session_start").at(-1)({ reason: "startup" }, ctx);
      for (const handler of handlers.get("agent_start") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
    async shutdown() {
      for (const handler of handlers.get("agent_end") || []) {
        await handler({ reason: "tool-test" }, ctx);
      }
    },
  };
}
{
  const h = await fullStartupHarness();
  await h.start();
  await h.emit("message_start", userTurn("我借浪头看船影。"));
  await h.emit("message_end", emptyFinal());
  var startupResume = {
    recoverySends: h.sent.filter(([message]) => (
      message.customType === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
    )).length,
    recoveryAppends: h.appended.filter(([kind]) => (
      kind === main.EMPTY_TERMINAL_RECOVERY_CUSTOM_TYPE
    )).length,
    faultSends: h.sent.filter(([message]) => (
      message.customType === main.TURN_PROCESSING_FAULT_CUSTOM_TYPE
    )).length,
  };
  await h.shutdown();
}

// 12. A finalized-output replacement marks the epoch answered: a later
//     same-epoch empty terminal neither recovers nor arms a fault.
{
  const h = buildHarness();
  await h.emit("message_start", userTurn("我完成精确输出回合。"));
  const exact = "finalizer 交付的精确输出。";
  const armed = h.gate.markFinalizedOutputReady(exact, digest(exact));
  const wrong = await h.emit("message_end", {
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text: "不匹配的先行正文。" }],
  });
  await h.emit("message_end", emptyFinal());
  var finalizedReplacement = {
    armed,
    replacedWithExact: textParts(wrong?.message) === exact,
    sends: h.sent.length,
    appends: h.appended.length,
  };
}

process.stdout.write(JSON.stringify({
  noEpoch,
  errorAborted,
  firstEpoch,
  newEpoch,
  answeredEpoch,
  toolBearing,
  visibleNormal,
  sendFailure,
  staleFault,
  noResend,
  startupResume,
  finalizedReplacement,
}));
