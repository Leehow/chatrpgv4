import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const handlers = new Map();
const openingContinuationGate = new main.OpeningTerminalContinuationGate();
main.registerPlayerTranscriptGate({
  on(type, handler) {
    const registered = handlers.get(type) || [];
    registered.push(handler);
    handlers.set(type, registered);
  },
}, () => openingContinuationGate.markVisibleAssistantFinal());

async function emit(type, message) {
  let result;
  for (const handler of handlers.get(type) || []) {
    result = await handler({
      type,
      message,
      ...(type === "message_update"
        ? { assistantMessageEvent: { type: "text_delta", delta: "" } }
        : {}),
    }, {});
  }
  return result;
}

function types(message) {
  return message.content.map((part) => part.type);
}

const start = {
  role: "assistant",
  content: [{ type: "text", text: "先让我检查一下。" }],
};
await emit("message_start", start);

const pending = {
  role: "assistant",
  content: [{ type: "text", text: "先让我检查一下当前状态。" }],
};
await emit("message_update", pending);

const toolUpdate = {
  role: "assistant",
  content: [
    { type: "text", text: "先让我检查一下当前状态。" },
    { type: "toolCall", id: "call-1", name: "coc_invoke", arguments: {} },
  ],
};
await emit("message_update", toolUpdate);

const toolFinal = {
  role: "assistant",
  content: [
    { type: "text", text: "先让我检查一下当前状态。" },
    { type: "toolCall", id: "call-1", name: "coc_invoke", arguments: {} },
    { type: "text", text: "工具调用后的内部过渡文本。" },
  ],
};
const toolFinalResult = await emit("message_end", toolFinal);

const narrationFinal = {
  role: "assistant",
  content: [{ type: "text", text: "雨水沿着窗玻璃缓缓滑落。" }],
};
const narrationResult = await emit("message_end", narrationFinal);

const user = {
  role: "user",
  content: [{ type: "text", text: "我走近窗边。" }],
};
await emit("message_start", user);

const terminalSent = [];
const terminalAppended = [];
const continuedDispatches = new Set();
const privateSentinel = "PRIVATE_SOURCE_PAYLOAD_MUST_NOT_REACH_PLAYER";
const terminalReceipt = {
  schema_version: 1,
  contract_id: "coc.source-coordinator-result.v1",
  packet_id: "coord-player-boundary",
  status: "fulfilled",
  private_probe: privateSentinel,
  worker_result: { pack: {} },
};
openingContinuationGate.trackOpeningDispatch(terminalReceipt.packet_id);
const terminalReport = await main.publishCoordinatorTerminal({
  appendEntry: (...args) => terminalAppended.push(args),
  sendMessage: (...args) => terminalSent.push(args),
}, terminalReceipt, continuedDispatches,
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey));
const duplicateTerminalReport = await main.publishCoordinatorTerminal({
  appendEntry: (...args) => terminalAppended.push(args),
  sendMessage: (...args) => terminalSent.push(args),
}, terminalReceipt, continuedDispatches,
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey));
const hiddenNotice = terminalSent[0][0];

const consumedSent = [];
const consumedAppended = [];
const consumedReceipt = {
  ...terminalReceipt,
  packet_id: "coord-opening-consumed",
};
openingContinuationGate.trackOpeningDispatch(consumedReceipt.packet_id);
openingContinuationGate.markAgentStart();
const consumedPromise = main.publishCoordinatorTerminal({
  appendEntry: (...args) => consumedAppended.push(args),
  sendMessage: (...args) => consumedSent.push(args),
}, consumedReceipt, continuedDispatches,
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey));
await Promise.resolve();
const consumedDeferredWhileAwaiting = consumedSent.length === 0
  && consumedAppended.length === 1;
openingContinuationGate.markOpeningProjected();
await emit("message_end", {
  role: "assistant",
  content: [{ type: "text", text: "任意正常桌面叙事。" }],
});
openingContinuationGate.markAgentEnd();
const consumedReport = await consumedPromise;

const unfinishedSent = [];
const unfinishedAppended = [];
const unfinishedReceipt = {
  ...terminalReceipt,
  packet_id: "coord-opening-unfinished",
};
openingContinuationGate.trackOpeningDispatch(unfinishedReceipt.packet_id);
openingContinuationGate.markAgentStart();
const unfinishedPromise = main.publishCoordinatorTerminal({
  appendEntry: (...args) => unfinishedAppended.push(args),
  sendMessage: (...args) => unfinishedSent.push(args),
}, unfinishedReceipt, continuedDispatches,
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey));
await Promise.resolve();
const unfinishedDeferredBeforeEnd = unfinishedSent.length === 0
  && unfinishedAppended.length === 1;
openingContinuationGate.markAgentEnd();
const unfinishedReport = await unfinishedPromise;

const reusedDispatchKey = "coord-opening-session-reuse";
const staleSent = [];
const staleAppended = [];
const staleContinuedDispatches = new Set();
openingContinuationGate.trackOpeningDispatch(reusedDispatchKey);
openingContinuationGate.markAgentStart();
const stalePromise = main.publishCoordinatorTerminal({
  appendEntry: (...args) => staleAppended.push(args),
  sendMessage: (...args) => staleSent.push(args),
}, { ...terminalReceipt, packet_id: reusedDispatchKey }, staleContinuedDispatches,
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey));
await Promise.resolve();
openingContinuationGate.reset();
const currentSent = [];
const currentAppended = [];
const currentContinuedDispatches = new Set();
openingContinuationGate.trackOpeningDispatch(reusedDispatchKey);
const currentReport = await main.publishCoordinatorTerminal({
  appendEntry: (...args) => currentAppended.push(args),
  sendMessage: (...args) => currentSent.push(args),
}, { ...terminalReceipt, packet_id: reusedDispatchKey }, currentContinuedDispatches,
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey));
const staleReport = await stalePromise;

process.stdout.write(JSON.stringify({
  registered: [...handlers.keys()].sort(),
  startTypes: types(start),
  pendingTypes: types(pending),
  toolUpdateTypes: types(toolUpdate),
  toolFinalOriginalTypes: types(toolFinal),
  toolFinalReturnedTypes: types(toolFinalResult.message),
  toolFinalRole: toolFinalResult.message.role,
  narrationReturned: narrationResult === undefined,
  narrationText: narrationFinal.content[0].text,
  userText: user.content[0].text,
  terminal: {
    appended: terminalAppended.length,
    sent: terminalSent.length,
    display: hiddenNotice.display,
    options: terminalSent[0][1],
    content: JSON.parse(hiddenNotice.content),
    details: hiddenNotice.details,
    leaksPrivate: JSON.stringify(terminalSent).includes(privateSentinel)
      || JSON.stringify(terminalSent).includes("worker_result")
      || JSON.stringify(terminalSent).includes("pack"),
    report: terminalReport,
    duplicateReport: duplicateTerminalReport,
  },
  structuredWake: {
    awaitingSent: terminalSent.length,
    consumedSent: consumedSent.length,
    consumedAppended: consumedAppended.length,
    consumedDeferredWhileAwaiting,
    consumedReport,
    unfinishedSent: unfinishedSent.length,
    unfinishedAppended: unfinishedAppended.length,
    unfinishedDeferredBeforeEnd,
    unfinishedReport,
    sessionReuse: {
      staleSent: staleSent.length,
      staleAppended: staleAppended.length,
      staleReport,
      staleContinued: staleContinuedDispatches.has(reusedDispatchKey),
      currentSent: currentSent.length,
      currentAppended: currentAppended.length,
      currentReport,
      currentContinued: currentContinuedDispatches.has(reusedDispatchKey),
    },
  },
}));
