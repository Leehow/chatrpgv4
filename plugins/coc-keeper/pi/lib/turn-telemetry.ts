/**
 * pi-coc fine-grained turn telemetry log (machine-first, zh-Hans display).
 *
 * Primary artifact: `<agentDir>/telemetry/turns.jsonl` — one JSON line per
 * session and per settled turn, granular enough for offline (AI) analysis of
 * where wall time goes. Every step carries dual clocks: `at` (epoch ms) for
 * absolute timeline reconstruction and `offset_ms` (monotonic, relative to
 * turn start) so gaps between steps are derivable.
 *
 * Model calls record the full phase chain from the Pi event bus:
 *
 *   before_provider_request -> after_provider_response -> message_start ->
 *   first delta -> (thinking stream) -> first non-thinking -> (generation) ->
 *   last delta -> message_end
 *
 * yielding network_ms (request->response headers), ttft_ms (->first delta),
 * thinking_ms, gen_ms, stream_ms, and call_ms (request->message_end). Tool
 * calls record toolCallId, args/result sizes, and duration (extension
 * execute -> result, MCP child + toolbox runtime included; their internals
 * are not visible at this layer). Turn records end with provider context
 * usage when the host exposes it. A one-line zh-Hans summary and `/timing`
 * panel remain as thin human surfaces over the same log.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const TURN_TELEMETRY_SCHEMA_VERSION = 2;

export type TelemetryUsage = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  total_tokens: number;
  cost_usd: number;
};

export type TelemetryMark = {
  /** Epoch ms at the boundary. */
  at: number;
  /** Monotonic offset from turn start (ms, sub-ms precision). */
  offset_ms: number;
};

/** Raw phase boundaries of one provider call; null when the event never fired. */
export type ModelCallPhases = {
  request: TelemetryMark | null;
  response: TelemetryMark | null;
  stream_start: TelemetryMark | null;
  first_delta: TelemetryMark | null;
  first_nonthinking: TelemetryMark | null;
  last_delta: TelemetryMark | null;
  stream_end: TelemetryMark | null;
  http_status: number | null;
};

export type ModelCallStep = {
  kind: "model";
  index: number;
  turn_index: number | null;
  model: string;
  phases: ModelCallPhases;
  /** request->message_end; falls back to stream span without provider events. */
  call_ms: number;
  network_ms: number | null;
  ttft_ms: number | null;
  /** thinking stream span; null when the provider sent no thinking parts. */
  thinking_ms: number | null;
  gen_ms: number | null;
  stream_ms: number;
  updates: number;
  thinking_chars: number;
  text_chars: number;
  tool_calls: number;
  usage: TelemetryUsage | null;
  stop_reason: string | null;
};

export type ToolCallStep = {
  kind: "tool";
  turn_index: number | null;
  tool_call_id: string | null;
  tool_name: string;
  label: string;
  duration_ms: number;
  args_bytes: number | null;
  result_bytes: number | null;
  is_error: boolean;
  start: TelemetryMark;
  end: TelemetryMark;
};

export type TurnTelemetryRecord = {
  record: "turn";
  schema_version: number;
  host: "pi-coc";
  session: string | null;
  mode: string | null;
  seq: number;
  started_at: string;
  prompt_excerpt: string | null;
  incomplete: boolean;
  wall_ms: number;
  model_ms: number;
  tool_ms: number;
  other_ms: number;
  model_calls: number;
  tool_calls: number;
  context_usage: { tokens: number; context_window: number; percent: number | null } | null;
  tokens: TelemetryUsage | null;
  steps: Array<ModelCallStep | ToolCallStep>;
};

export type SessionTelemetryRecord = {
  record: "session";
  schema_version: number;
  host: "pi-coc";
  session: string | null;
  mode: string | null;
  started_at: string;
  agent_dir: string;
};

export function telemetryLogPath(agentDir: string): string {
  return join(agentDir, "telemetry", "turns.jsonl");
}

/** "coc_invoke" + args.operation -> "coc_invoke.rules.roll" style label. */
export function toolCallLabel(toolName: string, args: unknown): string {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    if (typeof record.operation === "string" && record.operation) {
      return `${toolName}.${record.operation}`;
    }
    const task = record.task;
    if (task && typeof task === "object" && !Array.isArray(task)) {
      const kind = (task as Record<string, unknown>).kind;
      if (typeof kind === "string" && kind) return `${toolName}.${kind}`;
    }
  }
  return toolName;
}

function readUsage(message: unknown): TelemetryUsage | null {
  const usage = (message as { usage?: unknown } | undefined)?.usage;
  if (!usage || typeof usage !== "object") return null;
  const value = usage as Record<string, unknown>;
  const number = (key: string): number => (
    typeof value[key] === "number" && Number.isFinite(value[key])
      ? value[key] as number
      : 0
  );
  const cost = value.cost as Record<string, unknown> | undefined;
  return {
    input: number("input"),
    output: number("output"),
    cache_read: number("cacheRead"),
    cache_write: number("cacheWrite"),
    total_tokens: number("totalTokens"),
    cost_usd: (
      cost && typeof cost.total === "number" && Number.isFinite(cost.total)
        ? cost.total
        : 0
    ),
  };
}

function sumUsage(usages: TelemetryUsage[]): TelemetryUsage | null {
  if (!usages.length) return null;
  const total: TelemetryUsage = {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
    total_tokens: 0,
    cost_usd: 0,
  };
  for (const usage of usages) {
    total.input += usage.input;
    total.output += usage.output;
    total.cache_read += usage.cache_read;
    total.cache_write += usage.cache_write;
    total.total_tokens += usage.total_tokens;
    total.cost_usd += usage.cost_usd;
  }
  return total;
}

function promptExcerpt(prompt: unknown): string | null {
  if (typeof prompt !== "string" || !prompt.trim()) return null;
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  return collapsed.length <= 60 ? collapsed : `${collapsed.slice(0, 60)}…`;
}

function readContextUsage(ctx: ExtensionContext | undefined): TurnTelemetryRecord["context_usage"] {
  try {
    const usage = ctx?.getContextUsage?.();
    if (!usage || typeof usage !== "object") return null;
    if (typeof usage.tokens !== "number" || typeof usage.contextWindow !== "number") {
      return null;
    }
    return {
      tokens: usage.tokens,
      context_window: usage.contextWindow,
      percent: typeof usage.percent === "number" ? usage.percent : null,
    };
  } catch {
    return null;
  }
}

export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.max(0, Math.round(ms))}ms`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 10_000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toLocaleString("en-US");
}

/** One-line zh-Hans summary shown after each settled turn (and in /timing). */
export function formatTurnSummaryLine(record: TurnTelemetryRecord): string {
  const modelThinking = record.steps
    .filter((step) => step.kind === "model" && step.thinking_ms !== null)
    .reduce((sum, step) => sum + (step.thinking_ms ?? 0), 0);
  const parts = [
    `⏱ 回合 ${formatDuration(record.wall_ms)}`,
    `模型 ${formatDuration(record.model_ms)}，${record.model_calls} 次`
      + (modelThinking > 0 ? `（思考 ${formatDuration(modelThinking)}）` : ""),
    `工具 ${formatDuration(record.tool_ms)}，${record.tool_calls} 次`,
  ];
  const slowestTool = record.steps
    .filter((step): step is ToolCallStep => step.kind === "tool")
    .reduce<ToolCallStep | null>(
      (slowest, step) => (!slowest || step.duration_ms > slowest.duration_ms ? step : slowest),
      null,
    );
  if (slowestTool && slowestTool.duration_ms >= 1000) {
    parts.push(`最慢 ${slowestTool.label} ${formatDuration(slowestTool.duration_ms)}`);
  }
  if (record.other_ms >= 500) {
    parts.push(`其他 ${formatDuration(record.other_ms)}`);
  }
  if (record.tokens) {
    const cache = record.tokens.cache_read > 0
      ? `，缓存读 ${formatTokens(record.tokens.cache_read)}`
      : "";
    parts.push(
      `tokens 入 ${formatTokens(record.tokens.input)} 出 ${formatTokens(record.tokens.output)}${cache}`,
    );
    if (record.tokens.cost_usd > 0) {
      parts.push(`≈$${record.tokens.cost_usd.toFixed(2)}`);
    }
  } else {
    parts.push("tokens 未知（provider 未上报）");
  }
  return parts.join("｜");
}

/** Multi-line zh-Hans breakdown for the /timing detail panel. */
export function formatTimingPanel(
  record: TurnTelemetryRecord | null,
  sessionTotals: { turns: number; wall_ms: number; model_ms: number; tool_ms: number } | null,
): string[] {
  const lines: string[] = [];
  if (!record) {
    lines.push("本会话尚无已结算回合。先进行一次玩家回合。");
    return lines;
  }
  lines.push(
    `回合 #${record.seq} · ${formatDuration(record.wall_ms)}`
      + `（模型 ${formatDuration(record.model_ms)} · 工具 ${formatDuration(record.tool_ms)}`
      + ` · 其他 ${formatDuration(record.other_ms)}）`,
  );
  if (record.prompt_excerpt) {
    lines.push(`玩家输入：${record.prompt_excerpt}`);
  }
  for (const step of record.steps) {
    if (step.kind === "model") {
      const thinking = step.thinking_ms === null
        ? "无思考块"
        : `思考 ${formatDuration(step.thinking_ms)}/${formatTokens(step.thinking_chars)}字`;
      const network = step.network_ms === null
        ? ""
        : ` · 网络 ${formatDuration(step.network_ms)}`;
      lines.push(
        `  #${step.index} 模型 ${step.model} ${formatDuration(step.call_ms)}`
        + `（${thinking} · 正文 ${formatTokens(step.text_chars)}字 · 工具调用 ${step.tool_calls}${network}）`
        + (step.usage
          ? ` 入 ${formatTokens(step.usage.input)} 出 ${formatTokens(step.usage.output)}`
          : ""),
      );
    } else {
      lines.push(
        `  工具 ${step.label} ${formatDuration(step.duration_ms)}${step.is_error ? " ✗出错" : ""}`,
      );
    }
  }
  if (record.tokens) {
    lines.push(
      `tokens：入 ${formatTokens(record.tokens.input)} · 出 ${formatTokens(record.tokens.output)}`
        + ` · 缓存读 ${formatTokens(record.tokens.cache_read)}`
        + ` · 缓存写 ${formatTokens(record.tokens.cache_write)}`
        + (record.tokens.cost_usd > 0 ? ` · ≈$${record.tokens.cost_usd.toFixed(2)}` : ""),
    );
  }
  if (record.context_usage) {
    lines.push(
      `上下文：${formatTokens(record.context_usage.tokens)} / `
        + `${formatTokens(record.context_usage.context_window)}`
        + (record.context_usage.percent !== null
          ? `（${record.context_usage.percent.toFixed(0)}%）`
          : ""),
    );
  }
  if (sessionTotals && sessionTotals.turns > 0) {
    lines.push(
      `会话累计 ${sessionTotals.turns} 回合 · 墙钟 ${formatDuration(sessionTotals.wall_ms)}`
        + ` · 模型 ${formatDuration(sessionTotals.model_ms)} · 工具 ${formatDuration(sessionTotals.tool_ms)}`,
    );
  }
  return lines;
}

type OpenModelCall = {
  phases: ModelCallPhases;
  sawThinking: boolean;
  thinkingChars: number;
  textChars: number;
  toolCalls: number;
  updates: number;
  model: string;
};

type PendingProvider = {
  request: TelemetryMark;
  response: TelemetryMark | null;
  status: number | null;
};

type ActiveTurn = {
  /** Epoch ms at turn start (for started_at). */
  startAt: number;
  /** Monotonic clock value at turn start; offsets are measured from it. */
  startMono: number;
  promptExcerpt: string | null;
  steps: Array<ModelCallStep | ToolCallStep>;
  openCall: OpenModelCall | null;
  openTools: Map<string, {
    start: TelemetryMark;
    label: string;
    toolName: string;
    argsBytes: number | null;
  }>;
  modelCalls: number;
  turnIndex: number | null;
};

export type TurnTelemetry = {
  getLastTurn(): TurnTelemetryRecord | null;
  sessionTotals(): { turns: number; wall_ms: number; model_ms: number; tool_ms: number };
  isSummaryEnabled(): boolean;
  setSummaryEnabled(enabled: boolean): void;
};

export function registerTurnTelemetry(
  pi: ExtensionAPI,
  options: { agentDir: string; now?: () => number },
): TurnTelemetry {
  // Durations/offsets use the monotonic sub-ms clock; `at` uses wall time.
  const now = options.now ?? performance.now.bind(performance);
  const logPath = telemetryLogPath(options.agentDir);
  const records: TurnTelemetryRecord[] = [];
  let nextSeq = 1;
  let pendingPrompt: string | null = null;
  let active: ActiveTurn | null = null;
  let pendingProvider: PendingProvider | null = null;
  let sessionLabel: string | null = null;
  let sessionMode: string | null = null;
  let summaryEnabled = true;

  const mark = (startMono: number): TelemetryMark => ({
    at: Date.now(),
    offset_ms: now() - startMono,
  });

  // Serialize appends so session/turn lines never interleave mid-line.
  let writeQueue: Promise<void> = Promise.resolve();
  const appendLine = (line: Record<string, unknown>) => {
    writeQueue = writeQueue.then(async () => {
      try {
        await mkdir(join(options.agentDir, "telemetry"), { recursive: true });
        await appendFile(logPath, `${JSON.stringify(line)}\n`, "utf8");
      } catch {
        // Telemetry logging must never break play; in-memory records survive.
      }
    });
    return writeQueue;
  };

  const rememberSession = (ctx: ExtensionContext | undefined) => {
    if (!ctx) return;
    if (sessionLabel === null) {
      try {
        const name = (
          ctx.sessionManager as { getSessionName?: () => unknown } | undefined
        )?.getSessionName?.();
        if (typeof name === "string" && name) sessionLabel = name;
      } catch {
        // Session label is best-effort labeling only.
      }
    }
    const mode = (ctx as { mode?: unknown }).mode;
    if (sessionMode === null && typeof mode === "string" && mode) sessionMode = mode;
  };

  const finalizeTurn = async (
    ctx: ExtensionContext | undefined,
    incomplete: boolean,
  ): Promise<TurnTelemetryRecord | null> => {
    const turn = active;
    active = null;
    if (!turn) return null;
    const modelMs = turn.steps
      .filter((step) => step.kind === "model")
      .reduce((sum, step) => sum + step.call_ms, 0);
    // Parallel tool executions (one assistant message, several toolCalls) can
    // overlap; summing raw durations double-counts shared wall time. Merge
    // step intervals so the buckets reconcile with wall_ms.
    const toolIntervals = turn.steps
      .filter((step) => step.kind === "tool")
      .map((step) => [step.start.offset_ms, step.end.offset_ms] as const)
      .sort((a, b) => a[0] - b[0]);
    let toolMs = 0;
    let unionStart: number | null = null;
    let unionEnd = 0;
    for (const [start, end] of toolIntervals) {
      if (unionStart === null || start > unionEnd) {
        if (unionStart !== null) toolMs += unionEnd - unionStart;
        unionStart = start;
        unionEnd = end;
      } else if (end > unionEnd) {
        unionEnd = end;
      }
    }
    if (unionStart !== null) toolMs += unionEnd - unionStart;
    const endMark = mark(turn.startMono);
    const wallMs = Math.max(0, endMark.offset_ms);
    const record: TurnTelemetryRecord = {
      record: "turn",
      schema_version: TURN_TELEMETRY_SCHEMA_VERSION,
      host: "pi-coc",
      session: sessionLabel,
      mode: sessionMode,
      seq: nextSeq++,
      started_at: new Date(turn.startAt).toISOString(),
      prompt_excerpt: turn.promptExcerpt,
      incomplete,
      wall_ms: wallMs,
      model_ms: modelMs,
      tool_ms: toolMs,
      other_ms: Math.max(0, wallMs - modelMs - toolMs),
      model_calls: turn.steps.filter((step) => step.kind === "model").length,
      tool_calls: turn.steps.filter((step) => step.kind === "tool").length,
      context_usage: readContextUsage(ctx),
      tokens: sumUsage(
        turn.steps
          .filter((step): step is ModelCallStep => step.kind === "model" && step.usage !== null)
          .map((step) => step.usage as TelemetryUsage),
      ),
      steps: turn.steps,
    };
    records.push(record);
    await appendLine(record);
    if (summaryEnabled && ctx?.hasUI) {
      try {
        ctx.ui.notify(formatTurnSummaryLine(record), "info");
      } catch {
        // Display is best effort.
      }
    }
    return record;
  };

  pi.on("session_start", (_event: unknown, ctx: ExtensionContext | undefined) => {
    rememberSession(ctx);
    void appendLine({
      record: "session",
      schema_version: TURN_TELEMETRY_SCHEMA_VERSION,
      host: "pi-coc",
      session: sessionLabel,
      mode: sessionMode,
      started_at: new Date().toISOString(),
      agent_dir: options.agentDir,
    } satisfies SessionTelemetryRecord);
  });

  pi.on("before_agent_start", (event: unknown) => {
    pendingPrompt = promptExcerpt((event as { prompt?: unknown } | undefined)?.prompt);
  });

  pi.on("agent_start", (_event: unknown, ctx: ExtensionContext | undefined) => {
    rememberSession(ctx);
    if (active) void finalizeTurn(undefined, true);
    active = {
      startAt: Date.now(),
      startMono: now(),
      promptExcerpt: pendingPrompt,
      steps: [],
      openCall: null,
      openTools: new Map(),
      modelCalls: 0,
      turnIndex: null,
    };
    pendingPrompt = null;
    pendingProvider = null;
  });

  pi.on("turn_start", (event: unknown) => {
    if (!active) return;
    const index = (event as { turnIndex?: unknown } | undefined)?.turnIndex;
    active.turnIndex = typeof index === "number" ? index : null;
  });

  pi.on("before_provider_request", () => {
    if (!active) return;
    pendingProvider = {
      request: mark(active.startMono),
      response: null,
      status: null,
    };
  });

  pi.on("after_provider_response", (event: unknown) => {
    if (!active || !pendingProvider) return;
    pendingProvider.response = mark(active.startMono);
    const status = (event as { status?: unknown } | undefined)?.status;
    pendingProvider.status = typeof status === "number" ? status : null;
  });

  pi.on("message_start", (event: unknown) => {
    const turn = active;
    if (!turn) return;
    const message = (event as { message?: unknown } | undefined)?.message as
      | { role?: unknown; model?: unknown }
      | undefined;
    if (message?.role !== "assistant") return;
    const provider = pendingProvider;
    pendingProvider = null;
    turn.openCall = {
      phases: {
        request: provider?.request ?? null,
        response: provider?.response ?? null,
        stream_start: mark(turn.startMono),
        first_delta: null,
        first_nonthinking: null,
        last_delta: null,
        stream_end: null,
        http_status: provider?.status ?? null,
      },
      sawThinking: false,
      thinkingChars: 0,
      textChars: 0,
      toolCalls: 0,
      updates: 0,
      model: typeof message.model === "string" && message.model
        ? message.model
        : "unknown-model",
    };
  });

  pi.on("message_update", (event: unknown) => {
    const turn = active;
    const call = turn?.openCall;
    if (!turn || !call) return;
    const message = (event as { message?: unknown } | undefined)?.message as
      | { role?: unknown; content?: unknown }
      | undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) return;
    call.updates += 1;
    const deltaMark = mark(turn.startMono);
    if (call.phases.first_delta === null) call.phases.first_delta = deltaMark;
    call.phases.last_delta = deltaMark;
    let thinkingChars = 0;
    let textChars = 0;
    let toolCalls = 0;
    let sawThinking = false;
    let sawNonThinking = false;
    for (const part of message.content) {
      const type = (part as { type?: unknown } | null)?.type;
      if (type === "thinking") {
        sawThinking = true;
        thinkingChars += ((part as { thinking?: unknown }).thinking as string | undefined)
          ?.length ?? 0;
      } else if (type === "text") {
        sawNonThinking = true;
        textChars += ((part as { text?: unknown }).text as string | undefined)?.length ?? 0;
      } else if (type === "toolCall") {
        sawNonThinking = true;
        toolCalls += 1;
      }
    }
    call.sawThinking = call.sawThinking || sawThinking;
    call.thinkingChars = Math.max(call.thinkingChars, thinkingChars);
    call.textChars = Math.max(call.textChars, textChars);
    call.toolCalls = Math.max(call.toolCalls, toolCalls);
    if (sawNonThinking && call.phases.first_nonthinking === null) {
      call.phases.first_nonthinking = deltaMark;
    }
  });

  pi.on("message_end", (event: unknown) => {
    const turn = active;
    const call = turn?.openCall;
    if (!turn || !call) return;
    const message = (event as { message?: unknown } | undefined)?.message as
      | { role?: unknown; stopReason?: unknown }
      | undefined;
    if (message?.role !== "assistant") return;
    const streamEnd = mark(turn.startMono);
    call.phases.stream_end = streamEnd;
    turn.openCall = null;
    const span = (from: TelemetryMark | null, to: TelemetryMark | null): number | null => (
      from && to ? Math.max(0, to.offset_ms - from.offset_ms) : null
    );
    const streamMs = span(call.phases.stream_start, streamEnd) ?? 0;
    const requestStart = call.phases.request ?? call.phases.stream_start;
    const callMs = Math.max(streamMs, span(requestStart, streamEnd) ?? streamMs);
    turn.steps.push({
      kind: "model",
      index: ++turn.modelCalls,
      turn_index: turn.turnIndex,
      model: call.model,
      phases: call.phases,
      call_ms: callMs,
      network_ms: span(call.phases.request, call.phases.response),
      ttft_ms: span(call.phases.stream_start, call.phases.first_delta),
      thinking_ms: call.sawThinking
        ? span(
          call.phases.first_delta ?? call.phases.stream_start,
          call.phases.first_nonthinking ?? streamEnd,
        )
        : null,
      gen_ms: call.phases.first_nonthinking
        ? span(call.phases.first_nonthinking, streamEnd)
        : null,
      stream_ms: streamMs,
      updates: call.updates,
      thinking_chars: call.thinkingChars,
      text_chars: call.textChars,
      tool_calls: call.toolCalls,
      usage: readUsage(message),
      stop_reason: typeof message.stopReason === "string" ? message.stopReason : null,
    });
  });

  pi.on("tool_execution_start", (event: unknown) => {
    const turn = active;
    if (!turn) return;
    const typed = event as {
      toolCallId?: unknown;
      toolName?: unknown;
      args?: unknown;
    } | undefined;
    const id = typeof typed?.toolCallId === "string" ? typed.toolCallId : null;
    if (!id) return;
    const toolName = typeof typed?.toolName === "string" ? typed.toolName : "tool";
    turn.openTools.set(id, {
      start: mark(turn.startMono),
      label: toolCallLabel(toolName, typed?.args),
      toolName,
      argsBytes: byteLength(typed?.args),
    });
  });

  pi.on("tool_execution_end", (event: unknown) => {
    const turn = active;
    if (!turn) return;
    const typed = event as {
      toolCallId?: unknown;
      toolName?: unknown;
      result?: unknown;
      isError?: unknown;
    } | undefined;
    const id = typeof typed?.toolCallId === "string" ? typed.toolCallId : null;
    const entry = id !== null ? turn.openTools.get(id) : undefined;
    if (id === null) return;
    if (entry) turn.openTools.delete(id);
    const end = mark(turn.startMono);
    const toolName = entry?.toolName
      ?? (typeof typed?.toolName === "string" ? typed.toolName : "tool");
    turn.steps.push({
      kind: "tool",
      turn_index: turn.turnIndex,
      tool_call_id: id,
      tool_name: toolName,
      label: entry?.label ?? toolName,
      duration_ms: Math.max(0, end.offset_ms - (entry?.start.offset_ms ?? end.offset_ms)),
      args_bytes: entry?.argsBytes ?? null,
      result_bytes: byteLength(typed?.result),
      is_error: typed?.isError === true,
      start: entry?.start ?? end,
      end,
    });
  });

  pi.on("agent_end", async (_event: unknown, ctx: ExtensionContext | undefined) => {
    await finalizeTurn(ctx, false);
  });

  const sessionTotals = () => {
    let wallMs = 0;
    let modelMs = 0;
    let toolMs = 0;
    for (const record of records) {
      wallMs += record.wall_ms;
      modelMs += record.model_ms;
      toolMs += record.tool_ms;
    }
    return { turns: records.length, wall_ms: wallMs, model_ms: modelMs, tool_ms: toolMs };
  };

  pi.registerCommand("timing", {
    description: "COC 回合计时：每步耗时、思考时长、tokens 明细（off/on 切换摘要行）",
    handler: async (args: string, ctx: ExtensionContext) => {
      const cmd = (args || "").trim().toLowerCase();
      if (cmd === "off") {
        summaryEnabled = false;
        if (ctx.hasUI) ctx.ui.notify("已关闭回合耗时摘要行（JSONL 证据仍会记录）", "info");
        return;
      }
      if (cmd === "on") {
        summaryEnabled = true;
        if (ctx.hasUI) ctx.ui.notify("已开启回合耗时摘要行", "info");
        return;
      }
      const lines = formatTimingPanel(records.at(-1) ?? null, sessionTotals());
      if (ctx.hasUI) {
        await ctx.ui.custom<null>((_tui, theme, _kb, done) => {
          const component = {
            render(_width: number) {
              return [
                theme.fg("accent", theme.bold(" 回合计时 /timing ")),
                ...lines.map((line) => theme.fg("text", line)),
                "",
                theme.fg("muted", "Esc 关闭 · 日志：" + logPath),
              ];
            },
            invalidate() {},
            handleInput(data: string) {
              if (data === "\x1b" || data === "\x03") done(null);
            },
          };
          return component;
        });
      }
    },
  });

  return {
    getLastTurn: () => records.at(-1) ?? null,
    sessionTotals,
    isSummaryEnabled: () => summaryEnabled,
    setSummaryEnabled: (enabled: boolean) => {
      summaryEnabled = enabled;
    },
  };
}

function byteLength(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value)?.length ?? null;
  } catch {
    return null;
  }
}
