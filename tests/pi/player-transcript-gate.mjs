import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const { runAgentLoop } = await import(path.join(
  root,
  "runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/"
    + "node_modules/@earendil-works/pi-agent-core/dist/index.js",
));
const { createAssistantMessageEventStream } = await import(path.join(
  root,
  "runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/"
    + "node_modules/@earendil-works/pi-ai/dist/index.js",
));
const handlers = new Map();
const openingContinuationGate = new main.OpeningTerminalContinuationGate();
main.registerPlayerTranscriptGate({
  on(type, handler) {
    const registered = handlers.get(type) || [];
    registered.push(handler);
    handlers.set(type, registered);
  },
}, () => openingContinuationGate.acceptVisibleAssistantFinal());

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

async function realRunAgentLoopProbe() {
  const realHandlers = new Map();
  const gate = new main.OpeningTerminalContinuationGate();
  main.registerPlayerTranscriptGate({
    on(type, handler) {
      const registered = realHandlers.get(type) || [];
      registered.push(handler);
      realHandlers.set(type, registered);
    },
  }, () => gate.acceptVisibleAssistantFinal());
  gate.trackOpeningDispatch("real-loop-opening");
  gate.queueVisibleAssistantDisposition("operational_wait");
  gate.markIndependentVisibleOutput();

  const usage = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: 0,
  };
  const base = {
    role: "assistant", api: "openai-responses", provider: "probe",
    model: "probe", usage, stopReason: "stop", timestamp: 100,
  };
  const responses = [
    {
      ...base,
      content: [{ type: "text", text: "无关的角色准备说明。" }],
    },
    {
      ...base,
      content: [
        { type: "text", text: "工具过渡。" },
        { type: "toolCall", id: "probe-call", name: "probe_tool", arguments: {} },
      ],
      stopReason: "toolUse",
      timestamp: 101,
    },
    {
      ...base,
      content: [{ type: "text", text: "开篇仍在后台处理中。" }],
      timestamp: 102,
    },
  ];
  const finals = [];
  let responseIndex = 0;
  let followUpSent = false;
  let waitStart;
  let waitEnd;
  const streamFn = () => {
    const stream = createAssistantMessageEventStream();
    const finalMessage = responses[responseIndex++];
    queueMicrotask(() => {
      stream.push({ type: "start", partial: { ...finalMessage, content: [] } });
      stream.push({ type: "done", message: finalMessage });
    });
    return stream;
  };
  await runAgentLoop(
    [{
      role: "user",
      content: [{ type: "text", text: "开始。" }],
      timestamp: 1,
    }],
    {
      systemPrompt: "probe",
      messages: [],
      tools: [{
        name: "probe_tool",
        label: "probe",
        description: "probe",
        parameters: {
          type: "object", properties: {}, additionalProperties: false,
        },
        async execute() {
          return {
            content: [{ type: "text", text: "ok" }],
            details: { ok: true },
          };
        },
      }],
    },
    {
      model: {
        id: "probe", name: "probe", provider: "probe",
        api: "openai-responses", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000, maxTokens: 100,
      },
      convertToLlm: (messages) => messages,
      getFollowUpMessages() {
        if (!followUpSent && responseIndex === 1) {
          followUpSent = true;
          return [{
            role: "user",
            content: [{ type: "text", text: "继续。" }],
            timestamp: 2,
          }];
        }
        return [];
      },
    },
    async (event) => {
      if (event.type === "message_start" && event.message.role === "assistant") {
        if (event.message.timestamp === 102) waitStart = event.message;
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        if (event.message.timestamp === 102) waitEnd = event.message;
        let transformed;
        for (const handler of realHandlers.get("message_end") || []) {
          transformed = await handler(event, {});
        }
        finals.push(transformed?.message ?? event.message);
      }
    },
    undefined,
    streamFn,
  );
  return {
    piVersion: "0.81.1",
    sameContentObject: waitStart?.content === waitEnd?.content,
    startLength: waitStart?.content?.length,
    endLength: waitEnd?.content?.length,
    unrelatedFirstVisible: types(finals[0]).includes("text"),
    toolBearingTextHidden: JSON.stringify(types(finals[1])) === '["toolCall"]',
    operationalWaitSuppressed: types(finals[2]).length === 0,
  };
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

openingContinuationGate.trackOpeningDispatch("coord-wait-text");
openingContinuationGate.queueVisibleAssistantDisposition("operational_wait");
openingContinuationGate.markIndependentVisibleOutput();
const unrelatedWhileAwaiting = {
  role: "assistant",
  content: [{ type: "text", text: "你的调查员装备与背景已经整理完毕。" }],
};
const unrelatedWhileAwaitingResult = await emit(
  "message_end",
  unrelatedWhileAwaiting,
);
const waitFinal = {
  role: "assistant",
  content: [{ type: "text", text: "解析仍在进行，请稍候。" }],
};
const waitResult = await emit("message_end", waitFinal);
openingContinuationGate.markOpeningProjected();
const validOpening = {
  role: "assistant",
  content: [{ type: "text", text: "马车在白昼里停到城堡门前。" }],
};
const validOpeningResult = await emit("message_end", validOpening);

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
const consumedOpening = {
  role: "assistant",
  content: [{ type: "text", text: "任意正常桌面叙事。" }],
};
await emit("message_end", consumedOpening);
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
openingContinuationGate.markTerminalBlocker();
const terminalBlocker = {
  role: "assistant",
  content: [{ type: "text", text: "开场资料处理终止，需要重新确认来源边界。" }],
};
const terminalBlockerResult = await emit("message_end", terminalBlocker);
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
const realLoop = await realRunAgentLoopProbe();

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
  awaitingWaitReturnedTypes: types(waitResult.message),
  unrelatedWhileAwaitingReturned: unrelatedWhileAwaitingResult === undefined,
  validOpeningReturned: validOpeningResult === undefined,
  validOpeningText: validOpening.content[0].text,
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
    terminalBlockerWhileAwaitingReturned: terminalBlockerResult === undefined,
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
  realLoop,
}));
