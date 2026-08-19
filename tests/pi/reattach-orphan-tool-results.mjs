/**
 * Reload/reattach conversion must stay provider-valid.
 *
 * Canonical sources (pi-coc loads the keeper-bundled copies):
 *   convertToLlm     @earendil-works/pi-coding-agent dist/core/messages.js
 *   transformMessages @earendil-works/pi-ai dist/api/transform-messages.js
 *   convertMessages  openai-completions provider mapper
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
const { convertMessages } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-ai", "dist/api/openai-completions.js")).href
);

const model = {
  id: "deepseek-chat",
  name: "DeepSeek",
  provider: "deepseek",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8000,
  maxTokens: 256,
};

const compat = {
  supportsDeveloperRole: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  requiresReasoningContentOnAssistantMessages: false,
  requiresToolResultName: false,
  deferredToolsMode: undefined,
};

function assistantWithCall(id, name = "coc_setup", stopReason = "toolUse") {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: { operation: "session.resume" } }],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-chat",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: 1,
  };
}

function toolResult(id, name = "coc_setup", text = `{"ok":true,"tool":"${name}"}`) {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 2,
  };
}

function customMessage({ customType, content, display }) {
  return {
    role: "custom",
    customType,
    content,
    display,
    timestamp: 3,
  };
}

function userMessage(text) {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: 4,
  };
}

function isSynthetic(msg) {
  return msg.role === "toolResult"
    && msg.isError === true
    && msg.content.some((block) => block.type === "text" && block.text === "No result provided");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertProviderValid(providerMessages, label) {
  const open = new Map();
  const seenResults = new Set();
  for (const msg of providerMessages) {
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      open.clear();
      for (const call of msg.tool_calls) {
        open.set(call.id, call);
      }
      continue;
    }
    if (msg.role === "tool") {
      assert(open.has(msg.tool_call_id), `${label}: role=tool ${msg.tool_call_id} has no retained assistant tool_calls`);
      assert(!seenResults.has(msg.tool_call_id), `${label}: duplicate role=tool for ${msg.tool_call_id}`);
      seenResults.add(msg.tool_call_id);
      continue;
    }
    if (msg.role === "user" || (msg.role === "assistant" && !msg.tool_calls)) {
      open.clear();
      seenResults.clear();
    }
  }
}

function convertPipeline(agentMessages) {
  const llm = convertToLlm(agentMessages);
  const transformed = transformMessages(llm, model);
  const provider = convertMessages(model, { messages: llm, systemPrompt: "" }, compat);
  assertProviderValid(provider, "provider");
  return { llm, transformed, provider };
}

function rolesOf(messages) {
  return messages.map((msg) => {
    if (msg.role === "toolResult") {
      return isSynthetic(msg) ? `synthetic:${msg.toolCallId}` : `toolResult:${msg.toolCallId}`;
    }
    if (msg.role === "assistant") {
      const ids = (msg.content || [])
        .filter((block) => block.type === "toolCall")
        .map((block) => block.id);
      return ids.length ? `assistant:${ids.join(",")}` : "assistant";
    }
    if (msg.role === "user") {
      const text = typeof msg.content === "string"
        ? msg.content
        : (msg.content || []).map((block) => block.text || "").join("");
      return `user:${text.slice(0, 48)}`;
    }
    return msg.role;
  });
}

function assertNoSyntheticAndReal(transformed, label) {
  const synthetics = new Set();
  const reals = new Set();
  for (const msg of transformed) {
    if (msg.role !== "toolResult") continue;
    if (isSynthetic(msg)) synthetics.add(msg.toolCallId);
    else reals.add(msg.toolCallId);
  }
  for (const id of synthetics) {
    assert(!reals.has(id), `${label}: synthetic placeholder coexisted with real toolResult for ${id}`);
  }
}

function assertTransformedPairing(transformed, label) {
  const pending = new Set();
  for (const msg of transformed) {
    if (msg.role === "assistant") {
      pending.clear();
      for (const block of msg.content || []) {
        if (block.type === "toolCall") pending.add(block.id);
      }
      continue;
    }
    if (msg.role === "toolResult") {
      assert(pending.has(msg.toolCallId), `${label}: unmatched toolResult ${msg.toolCallId}`);
      continue;
    }
    if (msg.role === "user") {
      pending.clear();
    }
  }
  assertNoSyntheticAndReal(transformed, label);
}

// 1) Real failure form: toolCall → private custom → toolResult
{
  const callId = "call_00_private_mid_pair";
  const { llm, transformed, provider } = convertPipeline([
    assistantWithCall(callId),
    customMessage({
      customType: "coc-semantic-readiness-private",
      content: "{\"audience\":\"keeper_only\",\"reason\":\"canonical_resume\"}",
      display: false,
    }),
    toolResult(callId, "coc_setup", "{\"ok\":true,\"tool\":\"session.resume\"}"),
  ]);
  const llmRoles = rolesOf(llm);
  assert(
    llmRoles[0] === `assistant:${callId}`
      && llmRoles[1] === `toolResult:${callId}`
      && llmRoles[2].startsWith("user:"),
    `private custom must not split the tool pair: ${JSON.stringify(llmRoles)}`,
  );
  assert(
    !llm.some((msg, index) => (
      msg.role === "user"
      && llm[index + 1]
      && llm[index + 1].role === "toolResult"
      && llm[index + 1].toolCallId === callId
    )),
    "private custom must not masquerade as a player user turn before its toolResult",
  );
  assertTransformedPairing(transformed, "private-mid-pair");
  assert(
    transformed.some((msg) => msg.role === "toolResult" && msg.toolCallId === callId && !isSynthetic(msg)),
    "real toolResult must be kept when the private custom is deferred",
  );
  assert(
    !transformed.some(isSynthetic),
    "complete pair after deferred custom must not synthesize a placeholder",
  );
  assert(
    provider.filter((msg) => msg.role === "tool").length === 1
      && provider.some((msg) => msg.role === "tool" && msg.tool_call_id === callId),
    "provider must emit exactly one role=tool for the retained pair",
  );
}

// 2) Handoff / startup custom outside a live pair stay in LLM context
{
  const first = "call_startup_complete";
  const second = "call_after_handoff";
  const { llm, transformed } = convertPipeline([
    customMessage({
      customType: "coc-startup-resume",
      content: "startup resume context",
      display: false,
    }),
    assistantWithCall(first),
    toolResult(first),
    customMessage({
      customType: "coc_setup_handoff",
      content: "{\"type\":\"coc_setup_handoff\",\"campaign_id\":\"fixture\"}",
      display: false,
    }),
    assistantWithCall(second),
    toolResult(second),
  ]);
  const texts = llm
    .filter((msg) => msg.role === "user")
    .map((msg) => (msg.content || []).map((block) => block.text || "").join(""));
  assert(texts.some((text) => text.includes("startup resume context")), "startup custom must remain in LLM context");
  assert(texts.some((text) => text.includes("coc_setup_handoff")), "handoff custom must remain in LLM context");
  assertTransformedPairing(transformed, "handoff-startup");
  assert(!transformed.some(isSynthetic), "handoff/startup between complete pairs must not synthesize");
}

// 2b) Mid-pair handoff custom is deferred, not used as a player interrupt
{
  const callId = "call_handoff_mid_pair";
  const { llm, transformed } = convertPipeline([
    assistantWithCall(callId),
    customMessage({
      customType: "coc_setup_handoff",
      content: "{\"type\":\"coc_setup_handoff\"}",
      display: false,
    }),
    toolResult(callId, "coc_setup", "{\"ok\":true,\"tool\":\"setup.complete\"}"),
  ]);
  assert(rolesOf(llm)[1] === `toolResult:${callId}`, "handoff custom must not split setup.complete pair");
  assertTransformedPairing(transformed, "handoff-mid-pair");
  assert(!transformed.some(isSynthetic), "deferred handoff must keep the real setup.complete result");
}

// 2c) Visible custom is still converted to user when it is not mid-pair
{
  const { llm } = convertPipeline([
    customMessage({
      customType: "coc-pi-welcome",
      content: "visible welcome",
      display: true,
    }),
    userMessage("你好"),
  ]);
  assert(
    llm[0].role === "user" && llm[0].content[0].text === "visible welcome",
    "visible custom must still become a user turn outside a tool pair",
  );
}

// 3) error/aborted assistant + later real toolResult
{
  const callId = "call_aborted";
  const { llm, transformed, provider } = convertPipeline([
    assistantWithCall(callId, "coc_setup", "aborted"),
    toolResult(callId),
    userMessage("continue"),
  ]);
  assert(llm.some((msg) => msg.role === "assistant" && msg.stopReason === "aborted"), "convertToLlm keeps aborted assistant");
  assert(
    !transformed.some((msg) => msg.role === "assistant" && msg.stopReason === "aborted"),
    "transformMessages must skip aborted assistant",
  );
  assert(
    !transformed.some((msg) => msg.role === "toolResult" && msg.toolCallId === callId),
    "unmatched real toolResult after aborted assistant must be discarded",
  );
  assert(!transformed.some(isSynthetic), "skipped aborted assistant must not leave a placeholder+real pair");
  assert(!provider.some((msg) => msg.role === "tool"), "provider must not emit role=tool for a skipped aborted call");
}

{
  const callId = "call_error";
  const { transformed, provider } = convertPipeline([
    assistantWithCall(callId, "coc_setup", "error"),
    toolResult(callId),
  ]);
  assert(
    !transformed.some((msg) => msg.role === "toolResult" && msg.toolCallId === callId),
    "unmatched real toolResult after error assistant must be discarded",
  );
  assert(!provider.some((msg) => msg.role === "tool"), "provider must not emit role=tool for a skipped error call");
}

// 3b) Genuine player interrupt still synthesizes, then discards the late real result
{
  const callId = "call_player_interrupt";
  const { transformed } = convertPipeline([
    assistantWithCall(callId),
    userMessage("wait, look at the door"),
    toolResult(callId, "coc_setup", "{\"ok\":true,\"late\":true}"),
  ]);
  const results = transformed.filter((msg) => msg.role === "toolResult" && msg.toolCallId === callId);
  assert(results.length === 1, "player interrupt must keep exactly one result");
  assert(isSynthetic(results[0]), "player interrupt should synthesize a placeholder");
  assert(
    !results.some((msg) => !isSynthetic(msg)),
    "late real toolResult must not coexist with the synthetic placeholder",
  );
  assertTransformedPairing(transformed, "player-interrupt");
}

// 4) Ordinary complete tool pair
{
  const callId = "call_normal";
  const { transformed, provider } = convertPipeline([
    userMessage("resume the table"),
    assistantWithCall(callId),
    toolResult(callId),
    userMessage("look around"),
  ]);
  assertTransformedPairing(transformed, "normal-pair");
  assert(!transformed.some(isSynthetic), "complete pair must not synthesize");
  assert(
    provider.filter((msg) => msg.role === "tool" && msg.tool_call_id === callId).length === 1,
    "normal pair must produce one provider role=tool",
  );
}

// 5) Mixed reattach transcript: private mid-pair + handoff + normal pair is provider-valid
{
  const a = "call_resume";
  const b = "call_complete";
  const c = "call_play";
  const { transformed, provider } = convertPipeline([
    assistantWithCall(a),
    customMessage({
      customType: "coc-semantic-readiness-private",
      content: "private readiness",
      display: false,
    }),
    toolResult(a),
    assistantWithCall(b),
    customMessage({
      customType: "coc_setup_handoff",
      content: "handoff",
      display: false,
    }),
    toolResult(b),
    userMessage("open the table"),
    assistantWithCall(c),
    toolResult(c),
  ]);
  assertTransformedPairing(transformed, "reattach-mixed");
  assert(!transformed.some(isSynthetic), "reattach mixed transcript must keep real results");
  assert(provider.filter((msg) => msg.role === "tool").length === 3, "mixed reattach must keep all three tool pairs");
}

process.stdout.write(JSON.stringify({
  ok: true,
  convertToLlm: "pi-coding-agent/dist/core/messages.js",
  transformMessages: "pi-ai/dist/api/transform-messages.js",
}) + "\n");
