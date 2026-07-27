import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"));
const handlers = new Map();
main.registerPlayerTranscriptGate({
  on(type, handler) {
    const registered = handlers.get(type) || [];
    registered.push(handler);
    handlers.set(type, registered);
  },
});

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
}));
