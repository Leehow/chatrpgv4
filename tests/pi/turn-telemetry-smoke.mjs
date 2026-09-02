#!/usr/bin/env node
/**
 * Deterministic smoke for lib/turn-telemetry.ts (schema v2): drive a fake Pi
 * event bus through a session header plus one full turn (provider request ->
 * response -> thinking stream -> generation -> tool call -> second model call)
 * and a second turn after /timing off, asserting phase offsets, step
 * timestamps, sizes, context usage, JSONL evidence, and display surfaces.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const mod = await import(pathToFileURL(resolve(root, "plugins/coc-keeper/pi/lib/turn-telemetry.ts")).href);

const agentDir = mkdtempSync(resolve(tmpdir(), "pi-coc-turn-telemetry-"));
const handlers = new Map();
const commands = new Map();
const notifies = [];
const fakePi = {
  on: (name, handler) => handlers.set(name, handler),
  registerCommand: (name, options) => commands.set(name, options),
};

let clockMs = 1_000_000;
const tick = (delta) => { clockMs += delta; return clockMs; };
const emit = (name, event, ctx) => handlers.get(name)?.(event, ctx);

const usage1 = {
  input: 80000, output: 5000, cacheRead: 1200000, cacheWrite: 0, totalTokens: 85000,
  cost: { input: 0.08, output: 0.04, cacheRead: 0, cacheWrite: 0, total: 0.12 },
};
const usage2 = {
  input: 90000, output: 3000, cacheRead: 1500000, cacheWrite: 0, totalTokens: 93000,
  cost: { input: 0.09, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.10 },
};
// Two closed player turns of tool traffic plus a live turn; call N appends
// one more assistant message, so the prefix must read as append-only.
const contextMessages = (call) => {
  const closed = [
    { role: "user", content: "我推门进去", timestamp: 1 },
    { role: "assistant", model: "grok-4.5", content: [
      { type: "thinking", thinking: "思".repeat(200) },
      { type: "text", text: "门后是走廊。" },
      { type: "toolCall", id: "c1", name: "coc_invoke", arguments: { operation: "state.journal" } },
    ], usage: {}, stopReason: "toolCalls", timestamp: 2 },
    { role: "toolResult", toolCallId: "c1", toolName: "coc_invoke",
      content: [{ type: "text", text: "x".repeat(9000) }], isError: false, timestamp: 3 },
  ];
  const live = [{ role: "user", content: "我走向窗户", timestamp: 4 }];
  const appended = Array.from({ length: call - 1 }, (_, index) => ({
    role: "assistant", model: "grok-4.5",
    content: [{ type: "text", text: `第 ${index + 1} 次调用的叙事` }],
    usage: {}, stopReason: "stop", timestamp: 5 + index,
  }));
  return [...closed, ...live, ...appended];
};

const toolArgs = {
  // rules.roll is host-private after the RuleGraph cutover and has no model
  // wrapper, so a telemetry label derived from it carries no wrapper tool.
  operation: "rules.settle",
  campaign: "smoke",
  arguments: { decision_ref: "decision:coc7:core-check:skill" },
};

// A provider request body shaped like the openai-responses adapter's `params`:
// `instructions` (system prompt) + `tools` (advertised working set) + `input`
// (transcript). Call 2 drops one tool, which is exactly the prefix move the
// request probe exists to catch — the message array stays append-only, so
// `context_probe` cannot see it.
const systemPrompt = "你是守秘人。".repeat(400);
const toolDefinition = (name, size) => ({
  type: "function",
  name,
  parameters: { type: "object", properties: { payload: { type: "string", description: "d".repeat(size) } } },
});
const advertisedTools = (call) => (call === 1
  ? [toolDefinition("coc_invoke", 400), toolDefinition("coc_discover", 200), toolDefinition("read", 100)]
  : [toolDefinition("coc_invoke", 400), toolDefinition("coc_discover", 200)]);
const providerPayload = (call) => ({
  model: "grok-4.5",
  instructions: systemPrompt,
  tools: advertisedTools(call),
  input: contextMessages(call),
  stream: true,
});
const payloadSnapshots = [];
const emitProviderRequest = (call) => {
  const payload = providerPayload(call);
  const before = JSON.stringify(payload);
  const returned = emit("before_provider_request", { type: "before_provider_request", payload });
  payloadSnapshots.push({ before, after: JSON.stringify(payload), returned });
};

const uiCtx = (hasUI) => ({
  hasUI,
  mode: "tui",
  ui: {
    notify: (message, level) => notifies.push({ message, level }),
    custom: async () => null,
  },
  sessionManager: { getSessionName: () => "telemetry-smoke" },
  getContextUsage: () => ({ tokens: 84000, contextWindow: 200000, percent: 42 }),
});

let panelLines = [];
const panelCtx = {
  hasUI: true,
  mode: "tui",
  ui: {
    notify: () => {},
    custom: async (factory) => {
      const theme = { fg: (_k, s) => s, bold: (s) => s };
      const component = await factory(null, theme, null, () => {});
      panelLines = component.render(100);
      return null;
    },
  },
  sessionManager: { getSessionName: () => "telemetry-smoke" },
};

const telemetry = mod.registerTurnTelemetry(fakePi, { agentDir, now: () => clockMs });
const logPath = mod.telemetryLogPath(agentDir);

emit("thinking_level_select", { level: "off", previousLevel: "low" });
emit("session_start", {}, uiCtx(true));

// --- Turn 1: provider phases + thinking + tool + second call ---
emit("before_agent_start", { prompt: "我推门进去看看门后有什么" }, uiCtx(true));
tick(50);
emit("agent_start", {}, uiCtx(true));
tick(30);
emit("turn_start", { turnIndex: 0 });
tick(20);
emit("context", { messages: contextMessages(1) });
emitProviderRequest(1);
tick(200);
emit("after_provider_response", { status: 200 });
tick(10);
emit("message_start", { message: { role: "assistant", model: "grok-4.5" } });
tick(40);
emit("message_update", { message: { role: "assistant", content: [
  { type: "thinking", thinking: "思考内容".repeat(10) },
] } });
tick(30000);
emit("message_update", { message: { role: "assistant", content: [
  { type: "thinking", thinking: "思考内容".repeat(10) },
  { type: "text", text: "门后是..." },
  { type: "toolCall" },
] } });
tick(15000);
emit("message_update", { message: { role: "assistant", content: [
  { type: "thinking", thinking: "思考内容".repeat(10) },
  { type: "text", text: "门后是...更长的叙事正文" },
  { type: "toolCall" },
] } });
tick(500);
emit("message_end", { message: {
  role: "assistant", model: "grok-4.5", stopReason: "toolCalls", usage: usage1,
} });
tick(100);
emit("tool_execution_start", {
  toolCallId: "t1", toolName: "coc_invoke", args: toolArgs,
});
telemetry.recordTransportMeta("t1", {
  request_id: 42,
  execution_class: "parallel_read",
  queue_ms: 3,
  execute_ms: 112400,
  parallel_read_width: 4,
  active_count: 2,
  fallback_reason: null,
});
tick(112400);
emit("tool_execution_end", {
  toolCallId: "t1", toolName: "coc_invoke", isError: false, result: { ok: true, rolls: [] },
});
tick(200);
emit("turn_start", { turnIndex: 1 });
tick(100);
emit("context", { messages: contextMessages(2) });
emitProviderRequest(2);
tick(150);
emit("after_provider_response", { status: 200 });
tick(10);
emit("message_start", { message: { role: "assistant", model: "grok-4.5" } });
tick(5000);
emit("message_update", { message: { role: "assistant", content: [
  { type: "text", text: "最终叙事" },
] } });
tick(32400);
emit("message_end", { message: {
  role: "assistant", model: "grok-4.5", stopReason: "stop", usage: usage2,
} });
tick(5000);
await emit("agent_end", {}, uiCtx(true));

const record = telemetry.getLastTurn();
const first = record?.steps.find((s) => s.kind === "model");
const tool = record?.steps.find((s) => s.kind === "tool");
const second = record?.steps.filter((s) => s.kind === "model")[1];
const rawLines = existsSync(logPath)
  ? readFileSync(logPath, "utf8").trim().split("\n")
  : [];
const sessionLine = rawLines.length > 0 ? JSON.parse(rawLines[0]) : null;
const jsonlTurn = rawLines.length > 1 ? JSON.parse(rawLines[1]) : null;
const summary = notifies.at(-1)?.message ?? "";

// --- /timing panel, then /timing off + a lean second turn ---
panelLines = [];
await commands.get("timing").handler("", panelCtx);
const panelTurn1 = [...panelLines];
await commands.get("timing").handler("off", panelCtx);
emit("before_agent_start", { prompt: "继续" }, uiCtx(true));
emit("agent_start", {}, uiCtx(true));
emit("message_start", { message: { role: "assistant", model: "grok-4.5" } });
tick(2500);
emit("message_end", { message: {
  role: "assistant", model: "grok-4.5", stopReason: "stop", usage: usage1,
} });
// Two overlapping (parallel) tool calls: per-step durations stay, the
// turn bucket must count the union, not the sum.
tick(100);
emit("tool_execution_start", { toolCallId: "p1", toolName: "coc_invoke", args: { operation: "rules.settle" } });
tick(200);
emit("tool_execution_start", { toolCallId: "p2", toolName: "coc_invoke", args: { operation: "state.write" } });
tick(2800);
emit("tool_execution_end", { toolCallId: "p1", toolName: "coc_invoke", isError: false, result: {} });
tick(400);
emit("tool_execution_end", { toolCallId: "p2", toolName: "coc_invoke", isError: false, result: {} });
tick(5000);
await emit("agent_end", {}, uiCtx(true));
const notifyCountAfterOff = notifies.length;
const rawLinesAfter = existsSync(logPath)
  ? readFileSync(logPath, "utf8").trim().split("\n")
  : [];
await commands.get("timing").handler("", panelCtx);
const totals = telemetry.sessionTotals();
const leanTurn = rawLinesAfter.length > 2 ? JSON.parse(rawLinesAfter[2]) : null;
const leanModel = leanTurn?.steps.find((s) => s.kind === "model");

try {
  process.stdout.write(JSON.stringify({
    ok: true,
    hasTimingCommand: commands.has("timing"),
    sessionLineFirst: sessionLine?.record === "session"
      && sessionLine.schema_version === 6 && sessionLine.mode === "tui"
      && sessionLine.thinking_level === "off",
    recordShape: record !== null && record.record === "turn"
      && record.schema_version === 6 && record.host === "pi-coc"
      && record.mode === "tui" && record.thinking_level === "off",
    sessionLabeled: record?.session === "telemetry-smoke",
    promptExcerpt: record?.prompt_excerpt === "我推门进去看看门后有什么",
    wallMs: record?.wall_ms === 201160,
    modelMs: record?.model_ms === 83310,
    toolMs: record?.tool_ms === 112400,
    otherMs: record?.other_ms === 5450,
    stepsOrder: JSON.stringify(record?.steps.map((s) => s.kind)) === JSON.stringify(["model", "tool", "model"]),
    // Phase chain of model call #1: request 50 -> response 250 -> stream 260
    // -> first delta 300 -> first non-thinking 30300 -> end 45800.
    phaseOffsets: first?.phases.request?.offset_ms === 50
      && first?.phases.response?.offset_ms === 250
      && first?.phases.stream_start?.offset_ms === 260
      && first?.phases.first_delta?.offset_ms === 300
      && first?.phases.first_nonthinking?.offset_ms === 30300
      && first?.phases.last_delta?.offset_ms === 45300
      && first?.phases.stream_end?.offset_ms === 45800
      && first?.phases.http_status === 200,
    phaseDurations: first?.call_ms === 45750
      && first?.network_ms === 200
      && first?.ttft_ms === 40
      && first?.thinking_ms === 30000
      && first?.gen_ms === 15500
      && first?.stream_ms === 45540,
    absoluteMarks: typeof first?.phases.request?.at === "number"
      && typeof tool?.start.at === "number",
    updatesCounted: first?.updates === 3,
    thinkingChars: first?.thinking_chars === 40,
    textChars: first?.text_chars === 13,
    toolCallCountInMessage: first?.tool_calls === 1,
    secondCallNoThinking: second?.thinking_ms === null && second?.gen_ms === 32400,
    turnIndexStamped: first?.turn_index === 0 && second?.turn_index === 1
      && tool?.turn_index === 0,
    toolStepDetail: tool?.label === "coc_invoke.rules.settle"
      && tool?.canonical_operation === "rules.settle"
      && tool?.wrapper_tool === "coc_rules"
      && tool?.transport_tool === "coc_invoke"
      && tool?.tool_call_id === "t1"
      && tool?.tool_name === "coc_invoke"
      && tool?.args_bytes === JSON.stringify(toolArgs).length
      && tool?.result_bytes === JSON.stringify({ ok: true, rolls: [] }).length
      && tool?.transport?.request_id === 42
      && tool?.transport?.active_count === 2
      && tool?.transport?.fallback_reason === null,
    contextUsage: record?.context_usage?.tokens === 84000
      && record?.context_usage?.context_window === 200000
      && record?.context_usage?.percent === 42,
    tokensSum: record?.tokens?.input === 170000
      && record?.tokens?.output === 8000
      && record?.tokens?.cache_read === 2700000
      && record?.tokens?.total_tokens === 178000,
    costUsd: Math.abs((record?.tokens?.cost_usd ?? 0) - 0.22) < 1e-9,
    jsonlWritten: jsonlTurn?.record === "turn" && jsonlTurn?.wall_ms === 201160
      && jsonlTurn?.seq === 1 && Array.isArray(jsonlTurn.steps),
    summaryHasBuckets: summary.includes("回合 201.2s")
      && summary.includes("模型 83.3s")
      && summary.includes("思考 30.0s")
      && summary.includes("工具 112.4s")
      && summary.includes("coc_invoke.rules.settle"),
    summaryHasTokens: summary.includes("入 170.0k") && summary.includes("出 8,000")
      && summary.includes("缓存读 2.7M") && summary.includes("≈$0.22"),
    notifyLevel: notifies.at(-1)?.level === "info",
    panelShowsTurn: panelTurn1.some((l) => l.includes("回合 #1")),
    panelShowsPhases: panelTurn1.some((l) => l.includes("网络 200ms"))
      && panelTurn1.some((l) => l.includes("思考 30.0s/40字")),
    panelShowsContext: panelTurn1.some((l) => l.includes("上下文：84.0k / 200.0k（42%）")),
    panelShowsLogPath: panelTurn1.some((l) => l.includes(logPath)),
    offStopsNotify: notifyCountAfterOff === 1,
    jsonlStillWrittenWhenOff: rawLinesAfter.length === 3,
    leanTurnFallsBackWithoutProviderEvents: leanModel?.phases.request === null
      && leanModel?.call_ms === leanModel?.stream_ms,
    parallelToolUnion: leanTurn?.tool_ms === 3400
      && leanTurn?.other_ms === 5100
      && leanTurn?.steps.filter((s) => s.kind === "tool")
        .every((s) => s.duration_ms === 3000 || s.duration_ms === 3200),
    // Context probe rides on the model steps; the turn rolls it up. Observation
    // only: the fold is projected, never applied.
    contextProbeOnSteps: first?.context_probe?.messages === 4
      && first?.context_probe?.by_class.tool_result === 9000 + "coc_invoke".length
      && first?.context_probe?.fold.closed_turns === 1
      && first?.context_probe?.fold.folded_tool_results === 1
      && first?.context_probe?.prefix.status === "first"
      && second?.context_probe?.messages === 5
      && second?.context_probe?.prefix.status === "append_only"
      && second?.context_probe?.prefix.appended_messages === 1,
    contextProbeRollup: record?.context_probe?.calls === 2
      && record?.context_probe?.append_only_calls === 1
      && record?.context_probe?.rewritten_calls === 0
      && record?.context_probe?.saving_chars > 9000
      && record?.context_probe?.est_saving_tokens > 2000,
    panelShowsFoldPreview: panelTurn1.some((l) => l.includes("折叠预演：还可省")
      && l.includes("纯追加")),
    summaryShowsPending: summary.includes("待折叠"),
    // No fold wired in this harness: fold state stays null end to end.
    foldStateAbsent: first?.context_fold === null && record?.context_fold === null,
    leanTurnHasNoProbe: leanModel?.context_probe === null
      && leanTurn?.context_probe === null,
    // The request-prefix probe reads the real provider body, so it sees the
    // sections `context_probe` structurally cannot: system prompt, advertised
    // tools, and the residual.
    requestPrefixOnSteps: first?.request_prefix?.shape === "openai-responses"
      // The system prompt is measured as the provider receives it: the raw
      // string, not its JSON encoding.
      && first?.request_prefix?.instructions_bytes
        === Buffer.byteLength(systemPrompt, "utf8")
      && first?.request_prefix?.tools_count === 3
      && first?.request_prefix?.tools_status === "first"
      && first?.request_prefix?.instructions_status === "first"
      && first?.request_prefix?.input_messages === 4
      && first?.request_prefix?.other_bytes > 0
      && second?.request_prefix?.tools_count === 2
      // The tool set moved between the two calls; the transcript did not.
      && second?.request_prefix?.tools_status === "changed"
      && second?.request_prefix?.instructions_status === "stable"
      && second?.context_probe?.prefix.status === "append_only",
    requestPrefixPerToolCost: JSON.stringify(first?.request_prefix?.tools.map((t) => t.name))
      === JSON.stringify(["coc_invoke", "coc_discover", "read"])
      && first?.request_prefix?.tools[0].bytes > first?.request_prefix?.tools[2].bytes,
    requestPrefixSectionsSumToPayload: first?.request_prefix !== null
      && first?.request_prefix.instructions_bytes
        + first?.request_prefix.tools_bytes
        + first?.request_prefix.input_bytes
        + first?.request_prefix.other_bytes === first?.request_prefix.payload_bytes,
    requestPrefixRollup: record?.request_prefix?.calls === 2
      && record?.request_prefix?.tools_changed_calls === 1
      && record?.request_prefix?.instructions_changed_calls === 0
      && record?.request_prefix?.tools_count === 2,
    // Observation only: the payload is not mutated and the handler returns
    // nothing, because a returned value REPLACES the provider request.
    requestPayloadUntouched: payloadSnapshots.length === 2
      && payloadSnapshots.every((snap) => snap.before === snap.after
        && snap.returned === undefined),
    // No prompt text, message content, or schema body reaches the log.
    requestPrefixCopiesNoContent: !JSON.stringify(first?.request_prefix ?? {})
      .includes("守秘人")
      && !JSON.stringify(first?.request_prefix ?? {}).includes("dddd"),
    panelShowsRequestPrefix: panelTurn1.some((l) => l.includes("请求体："))
      && panelTurn1.some((l) => l.includes("请求前缀变动：")),
    leanTurnHasNoRequestPrefix: leanModel?.request_prefix === null
      && leanTurn?.request_prefix === null,
    totalsAfterTwoTurns: totals.turns === 2 && totals.model_ms === 85810,
    summaryEnabledFlag: telemetry.isSummaryEnabled() === false,
  }, null, 2));
  process.stdout.write("\n");
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
