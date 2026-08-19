/**
 * Cross-provider developer-role normalization.
 *
 * Real failure: after set_model to a gateway that rejects `developer`
 * (JellyToken 400: messages[0].role), replayed history + system prompt
 * must stay legal without a new session. Capability comes from
 * getCompat(provider/url/model.compat), not model-id prose.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const root = path.resolve(process.argv[2] || process.cwd());

const { convertToLlm } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-coding-agent", "dist/core/messages.js")).href
);
const { transformMessages } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-ai", "dist/api/transform-messages.js")).href
);
const { convertMessages, getCompat } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-ai", "dist/api/openai-completions.js")).href
);

const LEGAL_ROLES = new Set(["system", "assistant", "user", "tool", "function"]);

function baseModel(overrides) {
  return {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "deepseek",
    api: "openai-completions",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8000,
    maxTokens: 256,
    baseUrl: "https://api.deepseek.com",
    ...overrides,
  };
}

const jellytokenModel = baseModel({
  provider: "jellytoken",
  baseUrl: "https://aiservice.jellytoken.com/v1",
});
const openaiModel = baseModel({
  id: "gpt-5.4",
  name: "GPT-5.4",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
});
const officialDeepSeek = baseModel({});

function assistantWithCall(id, extras = {}) {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "keep thinking", thinkingSignature: "reasoning_content" },
      { type: "toolCall", id, name: "coc_setup", arguments: { operation: "session.resume" } },
    ],
    api: "openai-completions",
    provider: extras.provider || "openai",
    model: extras.model || "gpt-5.4",
    usage: {
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 2,
  };
}

function toolResult(id, text = '{"ok":true,"tool":"coc_setup"}') {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "coc_setup",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 3,
  };
}

function developerMessage(text, timestamp = 1) {
  return {
    role: "developer",
    content: [{ type: "text", text }],
    timestamp,
  };
}

function userMessage(text) {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: 4,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertLegalRoles(messages, label) {
  for (const [index, msg] of messages.entries()) {
    assert(LEGAL_ROLES.has(msg.role), `${label}: illegal role ${msg.role} at ${index}`);
  }
}

function assertProviderPairing(messages, label) {
  const open = new Map();
  const seen = new Set();
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      open.clear();
      for (const call of msg.tool_calls) open.set(call.id, call);
      continue;
    }
    if (msg.role === "tool") {
      assert(open.has(msg.tool_call_id), `${label}: orphan tool ${msg.tool_call_id}`);
      assert(!seen.has(msg.tool_call_id), `${label}: duplicate tool ${msg.tool_call_id}`);
      seen.add(msg.tool_call_id);
    }
  }
}

function convert(model, messages, systemPrompt = "") {
  const compat = getCompat(model);
  // Replay path: session history is already LLM-shaped. convertToLlm is not
  // the wire converter and would drop role=developer.
  const transformed = transformMessages(messages, model);
  const provider = convertMessages(model, { messages, systemPrompt }, compat);
  return { compat, transformed, provider };
}

// Capability comes from provider/url, not the model id string.
assert(getCompat(jellytokenModel).supportsDeveloperRole === false, "jellytoken capability must reject developer");
assert(getCompat(openaiModel).supportsDeveloperRole === true, "official OpenAI capability must keep developer");
assert(getCompat(officialDeepSeek).supportsDeveloperRole === false, "official DeepSeek catalog capability is false");
assert(
  getCompat(baseModel({
    provider: "custom-proxy",
    baseUrl: "https://example.invalid/v1",
    id: "deepseek-v4-flash",
    compat: { supportsDeveloperRole: true },
  })).supportsDeveloperRole === true,
  "explicit model.compat must win over URL detection",
);

const callId = "call_resume_after_switch";
const history = [
  developerMessage("Keeper table law: dice are authoritative."),
  developerMessage("Second developer block must survive."),
  assistantWithCall(callId, { provider: "openai", model: "gpt-5.4" }),
  toolResult(callId, '{"ok":true,"tool":"session.resume","mode":"awaiting_player"}'),
  userMessage("要"),
];

{
  const { provider, compat } = convert(
    jellytokenModel,
    history,
    "Host system prompt stays first.",
  );
  assert(compat.supportsDeveloperRole === false, "jellytoken convert uses detected capability");
  assertLegalRoles(provider, "jellytoken");
  assert(provider[0].role === "system", "unsupported provider must start with system, not developer");
  const systemText = provider
    .filter((msg) => msg.role === "system")
    .map((msg) => msg.content)
    .join("\n\n");
  assert(systemText.includes("Host system prompt stays first."), "system prompt text must be kept");
  assert(systemText.includes("Keeper table law: dice are authoritative."), "first developer instruction must be kept");
  assert(systemText.includes("Second developer block must survive."), "later developer instruction must be kept");
  assert(
    systemText.indexOf("Host system prompt stays first.")
      < systemText.indexOf("Keeper table law: dice are authoritative."),
    "system prompt must precede converted developer instructions",
  );
  assert(
    systemText.indexOf("Keeper table law: dice are authoritative.")
      < systemText.indexOf("Second developer block must survive."),
    "multiple developer messages must keep order",
  );
  assert(!provider.some((msg) => msg.role === "developer"), "jellytoken must not emit developer");
  assertProviderPairing(provider, "jellytoken");
  assert(
    provider.some((msg) => msg.role === "tool" && msg.tool_call_id === callId),
    "tool history pairing must survive conversion",
  );
  const assistant = provider.find((msg) => msg.role === "assistant" && msg.tool_calls);
  assert(assistant, "assistant tool call must remain");
  const assistantBlob = JSON.stringify(assistant);
  assert(assistantBlob.includes("keep thinking"), "thinking text must survive cross-model replay");
}

{
  const { provider } = convert(openaiModel, history, "Host system prompt stays first.");
  assert(provider[0].role === "developer", "official OpenAI reasoning models keep developer");
  const developerTexts = provider
    .filter((msg) => msg.role === "developer")
    .map((msg) => msg.content);
  assert(developerTexts.some((text) => text.includes("Host system prompt stays first.")), "openai keeps system prompt as developer");
  assert(developerTexts.some((text) => text.includes("Keeper table law: dice are authoritative.")), "openai keeps first developer");
  assert(developerTexts.some((text) => text.includes("Second developer block must survive.")), "openai keeps later developer");
  assertProviderPairing(provider, "openai");
}

{
  const { provider } = convert(officialDeepSeek, history, "Host system prompt stays first.");
  assertLegalRoles(provider, "official-deepseek");
  assert(!provider.some((msg) => msg.role === "developer"), "official DeepSeek capability is false");
  assert(provider[0].role === "system", "official DeepSeek downgrades by capability");
  assertProviderPairing(provider, "official-deepseek");
}

process.stdout.write(JSON.stringify({
  ok: true,
  convertToLlm: "pi-coding-agent/dist/core/messages.js",
  convertMessages: "pi-ai/dist/api/openai-completions.js",
  jellytokenSupportsDeveloperRole: getCompat(jellytokenModel).supportsDeveloperRole,
  openaiSupportsDeveloperRole: getCompat(openaiModel).supportsDeveloperRole,
  deepseekSupportsDeveloperRole: getCompat(officialDeepSeek).supportsDeveloperRole,
}) + "\n");
