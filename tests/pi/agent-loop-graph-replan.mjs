#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const core = await import(pathToFileURL(path.join(
  root,
  "runtime/adapters/keeper/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js",
)).href);
const ai = await import(pathToFileURL(path.join(
  root,
  "runtime/adapters/keeper/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js",
)).href);
const codingAgent = await import(pathToFileURL(path.join(
  root,
  "runtime/adapters/keeper/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js",
)).href);

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistant = (content, stopReason, timestamp) => ({
  role: "assistant",
  content,
  api: "openai-completions",
  provider: "fixture",
  model: "fixture-model",
  usage,
  stopReason,
  timestamp,
});

const firstAssistant = assistant([
  { type: "toolCall", id: "refresh-graph", name: "refresh_graph", arguments: {} },
  { type: "toolCall", id: "stale-scene", name: "stale_scene", arguments: {} },
  { type: "toolCall", id: "stale-rules", name: "stale_rules", arguments: {} },
], "toolUse", 1);
const secondAssistant = assistant([
  { type: "text", text: "continued from graph revision 2" },
], "stop", 2);

const executions = [];
const tool = (name) => ({
  name,
  label: name,
  description: name,
  parameters: { type: "object", properties: {}, additionalProperties: false },
  executionMode: "sequential",
  async execute() {
    executions.push(name);
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, tool: name }) }],
      details: { ok: true, tool: name },
    };
  },
});
const initialTools = [tool("refresh_graph"), tool("stale_scene"), tool("stale_rules")];
const refreshedTool = tool("fresh_context");

const providerContexts = [];
let providerCalls = 0;
const streamFn = (_model, context) => {
  providerContexts.push(context);
  const message = providerCalls++ === 0 ? firstAssistant : secondAssistant;
  const stream = ai.createAssistantMessageEventStream();
  stream.push({ type: "done", reason: message.stopReason, message });
  return stream;
};

const events = [];
const messages = await core.runAgentLoop(
  [{ role: "user", content: "refresh the graph", timestamp: 0 }],
  { systemPrompt: "graph revision 1", messages: [], tools: initialTools },
  {
    model: {
      provider: "fixture",
      id: "fixture-model",
      api: "openai-completions",
    },
    toolExecution: "sequential",
    convertToLlm: (rows) => rows,
    afterToolCall: async ({ toolCall }) => (
      toolCall.id === "refresh-graph" ? { replan: true } : undefined
    ),
    prepareNextTurn: async ({ toolResults, context }) => (
      toolResults.some((row) => row.toolCallId === "refresh-graph")
        ? {
            context: {
              ...context,
              systemPrompt: "graph revision 2",
              tools: [refreshedTool],
            },
          }
        : undefined
    ),
  },
  async (event) => { events.push(event); },
  undefined,
  streamFn,
);

const toolResults = messages.filter((message) => message.role === "toolResult");
assert.equal(providerCalls, 2, "replan must continue with another model turn");
assert.deepEqual(executions, ["refresh_graph"], "stale batch calls must not execute");
assert.deepEqual(
  toolResults.map((message) => message.toolCallId),
  ["refresh-graph", "stale-scene", "stale-rules"],
  "every assistant tool call must retain one paired result",
);
for (const skipped of toolResults.slice(1)) {
  assert.equal(skipped.isError, false);
  assert.equal(skipped.details?.status, "not_executed");
  assert.equal(skipped.details?.reason, "replan_requested");
  assert.match(skipped.content[0]?.text ?? "", /not executed/i);
}
for (const id of ["stale-scene", "stale-rules"]) {
  assert.equal(
    events.filter((event) => (
      event.type === "message_start"
      && event.message?.role === "toolResult"
      && event.message.toolCallId === id
    )).length,
    1,
    `${id} must emit one tool-result message_start`,
  );
  assert.equal(
    events.filter((event) => (
      event.type === "message_end"
      && event.message?.role === "toolResult"
      && event.message.toolCallId === id
    )).length,
    1,
    `${id} must emit one tool-result message_end`,
  );
  assert.equal(
    events.some((event) => event.type === "tool_execution_start" && event.toolCallId === id),
    false,
    `${id} must not claim execution started`,
  );
}
assert.equal(providerContexts[1].systemPrompt, "graph revision 2");
assert.deepEqual(providerContexts[1].tools.map((entry) => entry.name), ["fresh_context"]);
assert.deepEqual(
  providerContexts[1].messages
    .filter((message) => message.role === "toolResult")
    .map((message) => message.toolCallId),
  ["refresh-graph", "stale-scene", "stale-rules"],
);

const extensionRunner = new codingAgent.ExtensionRunner(
  [{
    path: "fixture-replan-extension",
    handlers: new Map([["tool_result", [async () => ({ replan: true })]]]),
  }],
  {},
  root,
  {},
  {},
);
const extensionReplan = await extensionRunner.emitToolResult({
  type: "tool_result",
  toolCallId: "fixture-result",
  toolName: "fixture_tool",
  input: {},
  content: [{ type: "text", text: "ok" }],
  details: { ok: true },
  isError: false,
});
assert.equal(extensionReplan?.replan, true);

process.stdout.write(JSON.stringify({
  ok: true,
  providerCalls,
  executions,
  pairedToolResults: toolResults.length,
  refreshedTools: providerContexts[1].tools.map((entry) => entry.name),
  extensionReplan: extensionReplan?.replan === true,
}));
