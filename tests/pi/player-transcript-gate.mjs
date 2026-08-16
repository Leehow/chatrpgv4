import "./_lib/preload-embedded-pi.mjs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const { runAgentLoop } = await import(
  embeddedPiFile(root, "pi-agent-core", "dist/index.js")
);
const { createAssistantMessageEventStream } = await import(
  embeddedPiFile(root, "pi-ai", "dist/index.js")
);
const handlers = new Map();
const openingContinuationGate = new main.OpeningTerminalContinuationGate();
const digest = (text) => (
  `sha256:${createHash("sha256").update(
    JSON.stringify(text),
    "utf8",
  ).digest("hex")}`
);
const rawTextDigest = (text) => (
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`
);
main.registerPlayerTranscriptGate({
  on(type, handler) {
    const registered = handlers.get(type) || [];
    registered.push(handler);
    handlers.set(type, registered);
  },
}, (visibleText) => (
  openingContinuationGate.acceptVisibleAssistantFinal(visibleText)
), (message) => openingContinuationGate.observeMessageStart(message));

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

function text(message) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
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
  }, (visibleText) => gate.acceptVisibleAssistantFinal(visibleText),
  (message) => gate.observeMessageStart(message));
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

async function realFinalizationLoopProbe() {
  const realHandlers = new Map();
  const gate = new main.OpeningTerminalContinuationGate();
  main.registerPlayerTranscriptGate({
    on(type, handler) {
      const registered = realHandlers.get(type) || [];
      registered.push(handler);
      realHandlers.set(type, registered);
    },
  }, (visibleText) => gate.acceptVisibleAssistantFinal(visibleText),
  (message) => gate.observeMessageStart(message));

  const exactText = "精确 finalizer 输出。";
  const initialUser = {
    role: "user",
    content: [{ type: "text", text: "执行精确输出探针。" }],
    timestamp: 200,
  };
  let armed = false;
  const usage = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: 0,
  };
  const base = {
    role: "assistant", api: "openai-responses", provider: "probe",
    model: "probe", usage, stopReason: "stop", timestamp: 201,
  };
  const responses = [
    {
      ...base,
      content: [{ type: "text", text: "任意但不匹配的前置文本。" }],
    },
    {
      ...base,
      content: [
        { type: "text", text: "工具过渡。" },
        {
          type: "toolCall", id: "finalizer-probe-call",
          name: "probe_tool", arguments: {},
        },
      ],
      stopReason: "toolUse",
      timestamp: 202,
    },
    {
      ...base,
      content: [{ type: "text", text: exactText }],
      timestamp: 203,
    },
    {
      ...base,
      content: [{ type: "text", text: "后台完成后的多余提示。" }],
      timestamp: 204,
    },
  ];
  let responseIndex = 0;
  let ordinaryFollowUpSent = false;
  let nonblockingFollowUpSent = false;
  let producedContinuationDetails = null;
  const finals = [];
  const eventTrace = [];
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
    [initialUser],
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
          armed = gate.markFinalizedOutputReady(exactText, digest(exactText));
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
        if (!ordinaryFollowUpSent && responseIndex === 1) {
          ordinaryFollowUpSent = true;
          return [{
            role: "custom",
            customType: "probe-before-exact",
            content: "continue",
            display: false,
            timestamp: 205,
          }];
        }
        if (!nonblockingFollowUpSent && responseIndex === 3) {
          nonblockingFollowUpSent = true;
          const details = gate.coordinatorContinuationContext(
            "coord-real-finalizer-probe",
            "fulfilled",
          );
          producedContinuationDetails = details;
          return [{
            role: "custom",
            customType: "coc-source-coordinator-terminal-continuation",
            content: JSON.stringify(details),
            details,
            display: false,
            timestamp: 206,
          }];
        }
        return [];
      },
    },
    async (event) => {
      eventTrace.push(`${event.type}:${event.message?.role ?? "none"}:${
        event.message?.customType ?? ""
      }`);
      let transformed;
      for (const handler of realHandlers.get(event.type) || []) {
        transformed = await handler(event, {});
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        finals.push(transformed?.message ?? event.message);
      }
    },
    undefined,
    streamFn,
  );
  return {
    armed,
    arbitraryVisible: types(finals[0]).includes("text"),
    toolBearingTypes: types(finals[1]),
    exactVisible: types(finals[2]).includes("text"),
    redundantSuppressed: types(finals[3]).length === 0,
    structuredCustomStartObserved: eventTrace.includes(
      "message_start:custom:coc-source-coordinator-terminal-continuation",
    ),
    producerContext: {
      continuationClass: producedContinuationDetails?.continuation_class,
      dispatchClass: producedContinuationDetails?.dispatch_class,
      playerTurnEpoch: producedContinuationDetails?.player_turn_epoch,
      digestMatches:
        producedContinuationDetails?.finalized_rendered_sha256
          === digest(exactText),
      dispatchKey: producedContinuationDetails?.dispatch_key,
    },
  };
}

async function realEarlyFinalizationLoopProbe() {
  const realHandlers = new Map();
  const gate = new main.OpeningTerminalContinuationGate();
  main.registerPlayerTranscriptGate({
    on(type, handler) {
      const registered = realHandlers.get(type) || [];
      registered.push(handler);
      realHandlers.set(type, registered);
    },
  }, (visibleText) => gate.acceptVisibleAssistantFinal(visibleText),
  (message) => gate.observeMessageStart(message));

  const exactText = "抢先终态之后的精确 finalizer 输出。";
  const initialUser = {
    role: "user",
    content: [{ type: "text", text: "执行抢先终态竞态探针。" }],
    timestamp: 210,
  };
  const usage = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: 0,
  };
  const base = {
    role: "assistant", api: "openai-responses", provider: "probe",
    model: "probe", usage, stopReason: "stop", timestamp: 211,
  };
  const responses = [
    {
      ...base,
      content: [{ type: "text", text: exactText }],
    },
    {
      ...base,
      content: [{ type: "text", text: "抢先终态引发的多余提示。" }],
      timestamp: 212,
    },
  ];
  let responseIndex = 0;
  let armed = false;
  let earlyContinuationDetails = null;
  let earlyPublicationReport = null;
  let continuationQueued = false;
  const earlyPublished = [];
  const earlyAppended = [];
  const finals = [];
  const eventTrace = [];
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
    [initialUser],
    {
      systemPrompt: "probe",
      messages: [],
      tools: [],
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
        if (
          !continuationQueued
          && responseIndex === 1
          && earlyContinuationDetails
        ) {
          continuationQueued = true;
          return [{
            role: "custom",
            customType: "coc-source-coordinator-terminal-continuation",
            content: JSON.stringify(earlyContinuationDetails),
            details: earlyContinuationDetails,
            display: false,
            timestamp: 213,
          }];
        }
        return [];
      },
    },
    async (event) => {
      eventTrace.push(`${event.type}:${event.message?.role ?? "none"}:${
        event.message?.customType ?? ""
      }`);
      let transformed;
      for (const handler of realHandlers.get(event.type) || []) {
        transformed = await handler(event, {});
      }
      if (
        !armed
        && event.type === "message_start"
        && event.message?.role === "user"
      ) {
        armed = gate.markFinalizedOutputReady(exactText, digest(exactText));
        // Capture the exact context that an already-queued/older host followUp
        // would carry. The current producer below must durable-append only.
        earlyContinuationDetails = gate.coordinatorContinuationContext(
          "coord-real-early-finalizer-probe",
          "fulfilled",
        );
        earlyPublicationReport = await main.publishCoordinatorTerminal(
          {
            appendEntry: (...args) => earlyAppended.push(args),
            sendMessage: (...args) => earlyPublished.push(args),
          },
          {
            schema_version: 1,
            contract_id: "coc.source-coordinator-result.v1",
            packet_id: "coord-real-early-finalizer-probe",
            status: "fulfilled",
            failure_class: null,
          },
          new Set(),
          () => true,
          (dispatchKey, terminalStatus) => (
            gate.coordinatorContinuationContext(dispatchKey, terminalStatus)
          ),
        );
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        finals.push(transformed?.message ?? event.message);
      }
    },
    undefined,
    streamFn,
  );
  return {
    piVersion: "0.81.1",
    armed,
    earlyContextBeforeExactDelivery: {
      appended: earlyAppended.length,
      sent: earlyPublished.length,
      continuationClass: earlyContinuationDetails?.continuation_class,
      dispatchClass: earlyContinuationDetails?.dispatch_class,
      playerTurnEpoch: earlyContinuationDetails?.player_turn_epoch,
      digestMatches:
        earlyContinuationDetails?.finalized_rendered_sha256
          === digest(exactText),
      dispatchKey: earlyContinuationDetails?.dispatch_key,
      report: earlyPublicationReport,
    },
    exactVisible: types(finals[0]).includes("text"),
    redundantSuppressed: types(finals[1]).length === 0,
    queuedCustomObserved: eventTrace.includes(
      "message_start:custom:coc-source-coordinator-terminal-continuation",
    ),
  };
}

async function adversarialFinalizationInterleaveProbe() {
  const probeHandlers = new Map();
  const gate = new main.OpeningTerminalContinuationGate();
  main.registerPlayerTranscriptGate({
    on(type, handler) {
      const registered = probeHandlers.get(type) || [];
      registered.push(handler);
      probeHandlers.set(type, registered);
    },
  }, (visibleText) => gate.acceptVisibleAssistantFinal(visibleText),
  (message) => gate.observeMessageStart(message));
  const probeEmit = async (type, message) => {
    let transformed;
    for (const handler of probeHandlers.get(type) || []) {
      transformed = await handler({ type, message }, {});
    }
    return transformed;
  };

  const exactText = "哈希绑定的第二回合终态叙事。";
  await probeEmit("message_start", {
    role: "user",
    content: [{ type: "text", text: "我按使命出发。" }],
  });
  const armed = gate.markFinalizedOutputReady(exactText, digest(exactText));
  const durableEntries = [];
  const sent = [];
  let decideWakeCalls = 0;
  durableEntries.push([
    "coc-source-coordinator-lifecycle",
    { status: "completed", dispatch_key: "coord-interleaved-finalizer" },
  ]);
  const terminalReport = await main.publishCoordinatorTerminal({
    appendEntry: (...args) => durableEntries.push(args),
    sendMessage: (...args) => sent.push(args),
  }, {
    schema_version: 1,
    contract_id: "coc.source-coordinator-result.v1",
    packet_id: "coord-interleaved-finalizer",
    status: "fulfilled",
    failure_class: null,
  }, new Set(), () => {
    decideWakeCalls += 1;
    return true;
  }, (dispatchKey, terminalStatus) => (
    gate.coordinatorContinuationContext(dispatchKey, terminalStatus)
  ));
  const wrong = {
    role: "assistant",
    content: [{
      type: "text",
      text: "已记下绑定；请继续行动。",
      textSignature: "provider-signature-for-wrong-text",
    }],
  };
  const wrongResult = await probeEmit("message_end", wrong);
  const replaced = wrongResult?.message ?? wrong;
  const duplicateExact = {
    role: "assistant",
    content: [{ type: "text", text: exactText }],
  };
  const duplicateResult = await probeEmit("message_end", duplicateExact);

  const exactGate = new main.OpeningTerminalContinuationGate();
  exactGate.markExternalUserInput();
  exactGate.markFinalizedOutputReady(exactText, digest(exactText));
  const exactDecision = exactGate.acceptVisibleAssistantFinal(exactText);

  const staleGate = new main.OpeningTerminalContinuationGate();
  staleGate.markExternalUserInput();
  staleGate.markFinalizedOutputReady("旧终态。", digest("旧终态。"));
  staleGate.markExternalUserInput();
  const staleDecision = staleGate.acceptVisibleAssistantFinal("新回合普通叙事。");

  const openingGate = new main.OpeningTerminalContinuationGate();
  openingGate.markExternalUserInput();
  openingGate.trackOpeningDispatch("coord-opening-finalizer");
  openingGate.markOpeningProjected();
  openingGate.markFinalizedOutputReady(exactText, digest(exactText));
  const openingDecision = openingGate.acceptVisibleAssistantFinal(exactText);

  return {
    armed,
    durableOrder: durableEntries.map(([kind]) => kind),
    terminalReport,
    sent: sent.length,
    decideWakeCalls,
    replacement: {
      exact: text(replaced) === exactText,
      wrongSuppressed: !text(replaced).includes("已记下绑定"),
      textParts: replaced.content.filter((part) => part.type === "text").length,
      staleSignatureRemoved:
        !Object.hasOwn(replaced.content.find((part) => part.type === "text"), "textSignature"),
    },
    duplicateExactSuppressed: types(
      duplicateResult?.message ?? duplicateExact,
    ).length === 0,
    exactAssistantAllowedOnce: exactDecision === true,
    stalePreviousEpochAllowed: staleDecision === true,
    openingExactAllowed: openingDecision === true,
    openingWakeConsumed:
      openingGate.decideWake("coord-opening-finalizer") === false,
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

const firstPlayerTurn = {
  role: "user",
  content: [{ type: "text", text: "我检查门后的动静。" }],
};
await emit("message_start", firstPlayerTurn);
const finalizedText = "门后的脚步声骤然停住。";
const finalizedSha256 = digest(finalizedText);
const mismatchedDigestRejected = (
  openingContinuationGate.markFinalizedOutputReady(
    finalizedText,
    `sha256:${"0".repeat(64)}`,
  ) === false
);
const rawUtf8DigestRejected = (
  openingContinuationGate.markFinalizedOutputReady(
    finalizedText,
    rawTextDigest(finalizedText),
  ) === false
);
const finalizedArmed = openingContinuationGate.markFinalizedOutputReady(
  finalizedText,
  finalizedSha256,
);
const earlyMismatchGate = new main.OpeningTerminalContinuationGate();
earlyMismatchGate.markExternalUserInput();
const earlyMismatchArmed = earlyMismatchGate.markFinalizedOutputReady(
  "只允许这条精确输出。",
  digest("只允许这条精确输出。"),
);
const earlyMismatchContext = earlyMismatchGate.coordinatorContinuationContext(
  "coord-early-mismatch",
  "fulfilled",
);
const earlyMismatchOutputVisible = earlyMismatchGate.acceptVisibleAssistantFinal(
  "实际收到的是不匹配输出。",
);
earlyMismatchGate.observeMessageStart({
  role: "custom",
  customType: "coc-source-coordinator-terminal-continuation",
  details: earlyMismatchContext,
});
const earlyMismatchFollowUpVisible =
  earlyMismatchGate.acceptVisibleAssistantFinal("不匹配后续保持可见。");
const arbitraryBeforeExact = await emit("message_end", {
  role: "assistant",
  content: [{ type: "text", text: "这是一条不匹配 finalizer 的说明。" }],
});
const toolBearingAfterFinalize = await emit("message_end", {
  role: "assistant",
  content: [
    { type: "text", text: "工具过渡。" },
    {
      type: "toolCall", id: "finalize-interpose",
      name: "probe", arguments: {},
    },
  ],
});
const finalizedNarration = {
  role: "assistant",
  content: [{ type: "text", text: finalizedText }],
};
const finalizedNarrationResult = await emit("message_end", finalizedNarration);
const mismatchAfterExact = await emit("message_end", {
  role: "assistant",
  content: [{ type: "text", text: "另一条合法但不匹配的助手输出。" }],
});
const finalizedWakeSent = [];
const finalizedWakeAppended = [];
const finalizedWakeReceipt = {
  schema_version: 1,
  contract_id: "coc.source-coordinator-result.v1",
  packet_id: "coord-after-finalized-output",
  status: "fulfilled",
  failure_class: null,
};
const finalizedWakeReport = await main.publishCoordinatorTerminal({
  appendEntry: (...args) => finalizedWakeAppended.push(args),
  sendMessage: (...args) => finalizedWakeSent.push(args),
}, finalizedWakeReceipt, new Set(), () => true,
(dispatchKey, terminalStatus) => (
  openingContinuationGate.coordinatorContinuationContext(
    dispatchKey,
    terminalStatus,
  )
));
const failedBackgroundSent = [];
const failedBackgroundAppended = [];
let failedBackgroundDecideWakeCalls = 0;
const failedBackgroundReport = await main.publishCoordinatorTerminal({
  appendEntry: (...args) => failedBackgroundAppended.push(args),
  sendMessage: (...args) => failedBackgroundSent.push(args),
}, {
  ...finalizedWakeReceipt,
  packet_id: "coord-failed-nonblocking",
  status: "failed",
  failure_class: "leaf_dispatch_failed",
}, new Set(), () => {
  failedBackgroundDecideWakeCalls += 1;
  return true;
}, (dispatchKey, terminalStatus) => (
  openingContinuationGate.coordinatorContinuationContext(
    dispatchKey,
    terminalStatus,
  )
));
openingContinuationGate.trackOpeningDispatch("coord-blocking-after-finalized");
openingContinuationGate.markTerminalBlocker();
const blockingContinuationDetails = (
  openingContinuationGate.coordinatorContinuationContext(
    "coord-blocking-after-finalized",
    "failed",
  )
);
await emit("message_start", {
  role: "custom",
  customType: "coc-source-coordinator-terminal-continuation",
  content: "blocking lifecycle notice",
  display: false,
  details: blockingContinuationDetails,
});
const blockingAfterFinalized = await emit("message_end", {
  role: "assistant",
  content: [{ type: "text", text: "开场来源处理失败，需要玩家确认。" }],
});

const staleContinuationContext = (
  openingContinuationGate.coordinatorContinuationContext(
    "coord-stale-after-user",
    "fulfilled",
  )
);
const user = {
  role: "user",
  content: [{ type: "text", text: "我走近窗边。" }],
};
await emit("message_start", user);
await emit("message_start", {
  role: "custom",
  customType: "coc-source-coordinator-terminal-continuation",
  content: "stale lifecycle notice",
  display: false,
  details: staleContinuationContext,
});
const staleEpochNarration = await emit("message_end", {
  role: "assistant",
  content: [{ type: "text", text: "窗边的冷气贴上你的指节。" }],
});

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
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
(dispatchKey, terminalStatus) => (
  openingContinuationGate.coordinatorContinuationContext(
    dispatchKey,
    terminalStatus,
  )
));
const duplicateTerminalReport = await main.publishCoordinatorTerminal({
  appendEntry: (...args) => terminalAppended.push(args),
  sendMessage: (...args) => terminalSent.push(args),
}, terminalReceipt, continuedDispatches,
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
(dispatchKey, terminalStatus) => (
  openingContinuationGate.coordinatorContinuationContext(
    dispatchKey,
    terminalStatus,
  )
));
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
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
(dispatchKey, terminalStatus) => (
  openingContinuationGate.coordinatorContinuationContext(
    dispatchKey,
    terminalStatus,
  )
));
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
  status: "failed",
  failure_class: "fulfill_rejected",
};
openingContinuationGate.trackOpeningDispatch(unfinishedReceipt.packet_id);
openingContinuationGate.markAgentStart();
openingContinuationGate.markTerminalBlocker();
const unfinishedPromise = main.publishCoordinatorTerminal({
  appendEntry: (...args) => unfinishedAppended.push(args),
  sendMessage: (...args) => unfinishedSent.push(args),
}, unfinishedReceipt, continuedDispatches,
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
(dispatchKey, terminalStatus) => (
  openingContinuationGate.coordinatorContinuationContext(
    dispatchKey,
    terminalStatus,
  )
));
await Promise.resolve();
const unfinishedDeferredBeforeEnd = unfinishedSent.length === 0
  && unfinishedAppended.length === 1;
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
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
(dispatchKey, terminalStatus) => (
  openingContinuationGate.coordinatorContinuationContext(
    dispatchKey,
    terminalStatus,
  )
));
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
(dispatchKey) => openingContinuationGate.decideWake(dispatchKey),
(dispatchKey, terminalStatus) => (
  openingContinuationGate.coordinatorContinuationContext(
    dispatchKey,
    terminalStatus,
  )
));
const staleReport = await stalePromise;
const realLoop = await realRunAgentLoopProbe();
const realFinalizationLoop = await realFinalizationLoopProbe();
const realEarlyFinalizationLoop = await realEarlyFinalizationLoopProbe();
const adversarialFinalizationInterleave =
  await adversarialFinalizationInterleaveProbe();

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
  mismatchedDigestRejected,
  rawUtf8DigestRejected,
  finalizedArmed,
  earlyMismatch: {
    armed: earlyMismatchArmed,
    continuationClass: earlyMismatchContext.continuation_class,
    digestMatches:
      earlyMismatchContext.finalized_rendered_sha256
        === digest("只允许这条精确输出。"),
    mismatchReplacedExact:
      earlyMismatchOutputVisible?.replacementText
        === "只允许这条精确输出。",
    followUpSuppressed: earlyMismatchFollowUpVisible === false,
  },
  arbitraryBeforeExactReplacedExact:
    text(arbitraryBeforeExact.message) === finalizedText,
  toolBearingAfterFinalizeTypes: types(toolBearingAfterFinalize.message),
  finalizedNarrationSuppressed:
    types(finalizedNarrationResult.message).length === 0,
  mismatchAfterExactSuppressed:
    types(mismatchAfterExact.message).length === 0,
  finalizedWake: {
    appended: finalizedWakeAppended.length,
    sent: finalizedWakeSent.length,
    noModelOpportunity: finalizedWakeSent.length === 0,
    report: finalizedWakeReport,
  },
  failedBackgroundWake: {
    appended: failedBackgroundAppended.length,
    sent: failedBackgroundSent.length,
    decideWakeCalls: failedBackgroundDecideWakeCalls,
    noModelOpportunity: failedBackgroundSent.length === 0,
    report: failedBackgroundReport,
  },
  blockingAfterFinalizedReturned: blockingAfterFinalized === undefined,
  userText: user.content[0].text,
  staleEpochNarrationReturned: staleEpochNarration === undefined,
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
    unfinishedContinuationClass:
      unfinishedSent[0][0].details.continuation_class,
    unfinishedDispatchClass:
      unfinishedSent[0][0].details.dispatch_class,
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
  realFinalizationLoop,
  realEarlyFinalizationLoop,
  adversarialFinalizationInterleave,
}));
