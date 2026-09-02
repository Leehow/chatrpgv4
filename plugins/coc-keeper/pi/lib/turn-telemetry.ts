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
import { classifyToolCall } from "./domain-tools.ts";
import { createContextProbe, type ContextProbe } from "./context-probe.ts";
import {
  createRequestPrefixProbe,
  type RequestPrefixProbe,
} from "./request-prefix-probe.ts";
import type { ContextFoldStats } from "./context-fold.ts";
import type { McpTransportMeta } from "./runtime.ts";

export const TURN_TELEMETRY_SCHEMA_VERSION = 6;

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
  /** Composition of the context actually sent on this call (post-fold). */
  context_probe: ContextProbe | null;
  /**
   * Composition of the provider request body itself — system prompt,
   * advertised tools, transcript, residual. `context_probe` measures only the
   * message array; this measures everything the provider bills for. Null when
   * the host emitted no `before_provider_request` payload or the probe is off.
   */
  request_prefix: RequestPrefixProbe | null;
  /** Standing epoch-fold state at this call; null when folding is not wired. */
  context_fold: ContextFoldStats | null;
};

export type ToolCallStep = {
  kind: "tool";
  turn_index: number | null;
  tool_call_id: string | null;
  tool_name: string;
  wrapper_tool: string;
  transport_tool: string | null;
  canonical_operation: string | null;
  label: string;
  duration_ms: number;
  args_bytes: number | null;
  result_bytes: number | null;
  is_error: boolean;
  /** Internal MCP scheduler receipt; never copied into tool content. */
  transport: McpTransportMeta | null;
  start: TelemetryMark;
  end: TelemetryMark;
};

/** Per-turn roll-up of the context probe; details stay on the model steps. */
export type TurnContextProbeSummary = {
  calls: number;
  /** Composition at the last model call of the turn (post-fold). */
  chars: number;
  est_tokens: number;
  saving_chars: number;
  saving_percent: number | null;
  est_saving_tokens: number;
  /** Prefix behaviour across this turn's calls — the cache baseline. */
  append_only_calls: number;
  rewritten_calls: number;
  reset_calls: number;
  probe_ms: number;
};

/**
 * Per-turn roll-up of the request-prefix probe.
 *
 * `tools_changed_calls` is the number that matters: a prefix-cache miss and a
 * moved `tools` field are the same event seen from two sides, and this puts
 * both on one turn record next to `tokens.input` / `tokens.cache_read`.
 */
export type TurnRequestPrefixSummary = {
  calls: number;
  tools_changed_calls: number;
  instructions_changed_calls: number;
  /** Composition of the last call of the turn. */
  payload_bytes: number;
  instructions_bytes: number;
  tools_count: number;
  tools_bytes: number;
  input_messages: number;
  input_bytes: number;
  other_bytes: number;
  probe_ms: number;
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
  /** Roll-up of the per-call context probe for this turn. */
  context_probe: TurnContextProbeSummary | null;
  /** Standing epoch-fold state after this turn; null when folding is off. */
  context_fold: ContextFoldStats | null;
  /** Roll-up of the per-call provider request body probe for this turn. */
  request_prefix: TurnRequestPrefixSummary | null;
  /** Last known effective thinking level; null when the host never reported one. */
  thinking_level: string | null;
  tokens: TelemetryUsage | null;
  steps: Array<ModelCallStep | ToolCallStep>;
};

export type SessionTelemetryRecord = {
  record: "session";
  schema_version: number;
  host: "pi-coc";
  session: string | null;
  mode: string | null;
  /** Last known effective thinking level; null until the host reports one. */
  thinking_level: string | null;
  started_at: string;
  agent_dir: string;
};

export function telemetryLogPath(agentDir: string): string {
  return join(agentDir, "telemetry", "turns.jsonl");
}

/** Display label. Canonical identity is `classifyToolCall().canonical_operation`. */
export function toolCallLabel(toolName: string, args: unknown): string {
  return classifyToolCall(toolName, args).label;
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

/** Request-body sizes are exact bytes, never token estimates. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${Math.max(0, Math.round(bytes))}B`;
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
  if (record.context_fold && record.context_fold.folded_results > 0) {
    parts.push(
      `已折叠 ${record.context_fold.folded_results} 条工具结果`
        + `（省 ${formatTokens(record.context_fold.folded_chars - record.context_fold.stub_chars)}字`
        + `，${record.context_fold.epochs} 个世代）`,
    );
  }
  const pendingPercent = record.context_probe?.saving_percent ?? 0;
  if (record.context_probe && pendingPercent >= 20) {
    parts.push(
      `待折叠 ${pendingPercent.toFixed(0)}%`
        + `（≈${formatTokens(record.context_probe.est_saving_tokens)} tokens）`,
    );
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
  if (record.thinking_level !== null) {
    lines.push(`思考档位：${record.thinking_level}`);
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
  if (record.request_prefix) {
    const prefix = record.request_prefix;
    // Operator-facing only. This is the half of the request `context_probe`
    // never looked at, and the line that would have made the fixed prefix
    // visible before it cost a session.
    lines.push(
      `请求体：${formatBytes(prefix.payload_bytes)}`
        + `（系统提示 ${formatBytes(prefix.instructions_bytes)}`
        + ` · 工具 ${prefix.tools_count} 个/${formatBytes(prefix.tools_bytes)}`
        + ` · 转录 ${prefix.input_messages} 条/${formatBytes(prefix.input_bytes)}`
        + ` · 其余 ${formatBytes(prefix.other_bytes)}）`,
    );
    lines.push(
      `请求前缀变动：工具集 ${prefix.tools_changed_calls}/${prefix.calls} 次调用改变`
        + ` · 系统提示 ${prefix.instructions_changed_calls}/${prefix.calls} 次`,
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
  if (record.context_fold) {
    const fold = record.context_fold;
    lines.push(
      fold.enabled
        ? `折叠：已折 ${fold.folded_results} 条工具结果 / ${fold.epochs} 个世代`
          + ` · 省 ${formatTokens(fold.folded_chars - fold.stub_chars)}字`
          + ` · 待折 ${formatTokens(fold.pending_chars)}字`
          + `（阈值 ${formatTokens(fold.threshold_tokens)} tokens）`
        : "折叠：已关闭（PI_COC_CONTEXT_FOLD=off）",
    );
  }
  if (record.context_probe) {
    const probe = record.context_probe;
    const percent = probe.saving_percent === null ? "—" : `${probe.saving_percent.toFixed(0)}%`;
    lines.push(
      `折叠预演：还可省 ${formatTokens(probe.saving_chars)}字`
        + `≈${formatTokens(probe.est_saving_tokens)} tokens（${percent}）`
        + ` · 前缀 ${probe.append_only_calls}/${probe.calls} 次纯追加`
        + (probe.rewritten_calls + probe.reset_calls > 0
          ? ` · 改写 ${probe.rewritten_calls} · 重置 ${probe.reset_calls}`
          : "")
        + ` · 探针 ${formatDuration(probe.probe_ms)}`,
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

/** Roll up per-call probes into the turn record. Last call wins on size. */
function summarizeContextProbe(
  steps: Array<ModelCallStep | ToolCallStep>,
): TurnContextProbeSummary | null {
  const probes = steps
    .filter((step): step is ModelCallStep => step.kind === "model" && step.context_probe !== null)
    .map((step) => step.context_probe as ContextProbe);
  if (!probes.length) return null;
  const last = probes[probes.length - 1];
  return {
    calls: probes.length,
    chars: last.chars,
    est_tokens: last.est_tokens,
    saving_chars: last.fold.saving_chars,
    saving_percent: last.fold.saving_percent,
    est_saving_tokens: last.fold.est_saving_tokens,
    append_only_calls: probes.filter((probe) => probe.prefix.status === "append_only").length,
    rewritten_calls: probes.filter((probe) => probe.prefix.status === "rewritten").length,
    reset_calls: probes.filter((probe) => probe.prefix.status === "reset").length,
    probe_ms: probes.reduce((sum, probe) => sum + probe.observe_ms, 0),
  };
}

/** Roll up per-call request-prefix probes. Last call wins on composition. */
function summarizeRequestPrefix(
  steps: Array<ModelCallStep | ToolCallStep>,
): TurnRequestPrefixSummary | null {
  const probes = steps
    .filter((step): step is ModelCallStep => (
      step.kind === "model" && step.request_prefix !== null
    ))
    .map((step) => step.request_prefix as RequestPrefixProbe);
  if (!probes.length) return null;
  const last = probes[probes.length - 1];
  return {
    calls: probes.length,
    tools_changed_calls: probes.filter((probe) => probe.tools_status === "changed").length,
    instructions_changed_calls: probes
      .filter((probe) => probe.instructions_status === "changed").length,
    payload_bytes: last.payload_bytes,
    instructions_bytes: last.instructions_bytes,
    tools_count: last.tools_count,
    tools_bytes: last.tools_bytes,
    input_messages: last.input_messages,
    input_bytes: last.input_bytes,
    other_bytes: last.other_bytes,
    probe_ms: probes.reduce((sum, probe) => sum + probe.observe_ms, 0),
  };
}

type OpenModelCall = {
  phases: ModelCallPhases;
  sawThinking: boolean;
  thinkingChars: number;
  textChars: number;
  toolCalls: number;
  updates: number;
  model: string;
  context: ContextProbe | null;
  fold: ContextFoldStats | null;
  requestPrefix: RequestPrefixProbe | null;
};

type PendingProvider = {
  request: TelemetryMark;
  response: TelemetryMark | null;
  status: number | null;
  /** Measured off the request body this call is about to send. */
  prefix: RequestPrefixProbe | null;
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
    wrapperTool: string;
    transportTool: string | null;
    canonicalOperation: string | null;
    argsBytes: number | null;
    transport: McpTransportMeta | null;
  }>;
  modelCalls: number;
  turnIndex: number | null;
};

export type TurnTelemetry = {
  getLastTurn(): TurnTelemetryRecord | null;
  sessionTotals(): { turns: number; wall_ms: number; model_ms: number; tool_ms: number };
  isSummaryEnabled(): boolean;
  setSummaryEnabled(enabled: boolean): void;
  /** Attach the MCP-only scheduling receipt to the matching host tool call. */
  recordTransportMeta(toolCallId: string, meta: McpTransportMeta | null): void;
};

export function registerTurnTelemetry(
  pi: ExtensionAPI,
  options: {
    agentDir: string;
    now?: () => number;
    /** Standing epoch-fold state, read once per model call when wired. */
    foldStats?: () => ContextFoldStats | null;
  },
): TurnTelemetry {
  // Durations/offsets use the monotonic sub-ms clock; `at` uses wall time.
  const now = options.now ?? performance.now.bind(performance);
  const logPath = telemetryLogPath(options.agentDir);
  const records: TurnTelemetryRecord[] = [];
  let nextSeq = 1;
  let pendingPrompt: string | null = null;
  let active: ActiveTurn | null = null;
  let pendingProvider: PendingProvider | null = null;
  const contextProbe = createContextProbe({ now });
  const requestPrefixProbe = createRequestPrefixProbe({ now });
  let pendingContext: ContextProbe | null = null;
  let pendingFold: ContextFoldStats | null = null;
  let sessionLabel: string | null = null;
  let sessionMode: string | null = null;
  let thinkingLevel: string | null = null;
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
      context_probe: summarizeContextProbe(turn.steps),
      context_fold: turn.steps
        .filter((step): step is ModelCallStep => step.kind === "model")
        .map((step) => step.context_fold)
        .filter((stats): stats is ContextFoldStats => stats !== null)
        .at(-1) ?? null,
      request_prefix: summarizeRequestPrefix(turn.steps),
      thinking_level: thinkingLevel,
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

  pi.on("thinking_level_select", (event: unknown) => {
    const level = (event as { level?: unknown } | undefined)?.level;
    if (typeof level === "string" && level) thinkingLevel = level;
  });

  pi.on("session_start", (_event: unknown, ctx: ExtensionContext | undefined) => {
    rememberSession(ctx);
    void appendLine({
      record: "session",
      schema_version: TURN_TELEMETRY_SCHEMA_VERSION,
      host: "pi-coc",
      session: sessionLabel,
      mode: sessionMode,
      thinking_level: thinkingLevel,
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

  // Observation only: never return messages, so the context stays untouched.
  pi.on("context", (event: unknown) => {
    const messages = (event as { messages?: unknown } | undefined)?.messages;
    if (!Array.isArray(messages)) return;
    try {
      // The fold handler is registered first, so this observes what is sent.
      pendingContext = contextProbe.observe(messages);
      pendingFold = options.foldStats?.() ?? null;
    } catch {
      // A probe failure must never cost a turn.
      pendingContext = null;
      pendingFold = null;
    }
  });

  // Observation only. `before_provider_request` handlers that RETURN a value
  // replace the provider payload; this one must never return anything. The
  // probe runs even without an active turn so its call-to-call `stable` /
  // `changed` verdicts stay true to the real request sequence.
  pi.on("before_provider_request", (event: unknown) => {
    const prefix = requestPrefixProbe.observe(
      (event as { payload?: unknown } | undefined)?.payload,
    );
    if (!active) return;
    pendingProvider = {
      request: mark(active.startMono),
      response: null,
      status: null,
      prefix,
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
      context: pendingContext,
      fold: pendingFold,
      requestPrefix: provider?.prefix ?? null,
    };
    pendingContext = null;
    pendingFold = null;
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
      context_probe: call.context,
      context_fold: call.fold,
      request_prefix: call.requestPrefix,
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
    const classified = classifyToolCall(toolName, typed?.args);
    turn.openTools.set(id, {
      start: mark(turn.startMono),
      label: classified.label,
      toolName,
      wrapperTool: classified.wrapper_tool,
      transportTool: classified.transport_tool,
      canonicalOperation: classified.canonical_operation,
      argsBytes: byteLength(typed?.args),
      transport: null,
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
      wrapper_tool: entry?.wrapperTool ?? toolName,
      transport_tool: entry?.transportTool ?? null,
      canonical_operation: entry?.canonicalOperation ?? null,
      label: entry?.label ?? toolName,
      duration_ms: Math.max(0, end.offset_ms - (entry?.start.offset_ms ?? end.offset_ms)),
      args_bytes: entry?.argsBytes ?? null,
      result_bytes: byteLength(typed?.result),
      is_error: typed?.isError === true,
      transport: entry?.transport ?? null,
      start: entry?.start ?? end,
      end,
    });
  });

  pi.on("agent_end", async (_event: unknown, ctx: ExtensionContext | undefined) => {
    await finalizeTurn(ctx, false);
  });

  const recordTransportMeta = (toolCallId: string, meta: McpTransportMeta | null) => {
    if (!meta || !active) return;
    const entry = active.openTools.get(toolCallId);
    if (entry) entry.transport = meta;
  };

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
    recordTransportMeta,
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
