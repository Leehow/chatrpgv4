/**
 * Context probe — observation only, never rewrites the model context.
 *
 * pi keeps one linear transcript: every tool result stays in history forever
 * and is resent on every model call. Measured on real pi-coc play sessions,
 * toolResult content is 65–88% of transcript bytes while the KP prose that
 * actually carries pacing is 1–2%. The obvious fix (drop closed-turn tool
 * traffic) collides with automatic provider prefix caching — measured cache
 * hit rate on this host is ~96%, and any rewrite inside the prefix invalidates
 * every token after the rewrite point.
 *
 * So before changing anything we measure. This module answers two questions
 * per model call, and writes the answers into turn telemetry:
 *
 *   1. How much would an epoch fold save? Closed-turn tool arguments, tool
 *      results, and thinking blocks are the eviction candidates; each folded
 *      tool round trip is charged {@link STUB_CHARS} for the stub that would
 *      replace it.
 *   2. Is the prefix actually stable today? Each call is fingerprinted per
 *      message and compared with the previous call, so `append_only` vs
 *      `rewritten` is observed rather than assumed. This is the baseline any
 *      future folding has to be judged against.
 *
 * Sizes are model-visible characters (exact): host-side `details` and protocol
 * scaffolding are excluded, so the numbers track what the provider is actually
 * billed for. `est_tokens` is pi's own
 * conservative chars/4 heuristic, kept only so probe numbers are comparable
 * with pi's compaction threshold; it underestimates Chinese prose.
 */

/** Assumed size of the stub that would replace one folded tool round trip. */
export const STUB_CHARS = 160;

/** pi's compaction heuristic (`estimateTokens`), reused for comparability. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export type ContextClassChars = {
  /** Player input. */
  user: number;
  /** KP prose — the narration the table actually reads. */
  assistant_text: number;
  assistant_thinking: number;
  /** Serialized tool arguments inside assistant messages. */
  tool_call: number;
  /** Tool result payloads. */
  tool_result: number;
  /** Custom/host messages and anything unclassified. */
  other: number;
};

export type ContextFoldProjection = {
  /** Index of the user message that opens the current turn; null if none. */
  turn_boundary_index: number | null;
  /** Player turns fully behind the boundary (fold candidates). */
  closed_turns: number;
  /** Folded tool round trips behind the boundary. */
  folded_tool_results: number;
  /** Closed-turn tool argument + tool result chars. */
  tool_chars: number;
  /** Closed-turn thinking chars. */
  thinking_chars: number;
  evictable_chars: number;
  stub_chars: number;
  projected_chars: number;
  saving_chars: number;
  saving_percent: number | null;
  est_saving_tokens: number;
};

export type ContextPrefixStatus = "first" | "append_only" | "rewritten" | "reset";

export type ContextPrefixObservation = {
  status: ContextPrefixStatus;
  /** Leading messages byte-identical to the previous observed call. */
  stable_messages: number;
  stable_chars: number;
  /** First index that differs from the previous call; null when none does. */
  diverged_at: number | null;
  appended_messages: number;
  previous_messages: number;
};

export type ContextProbe = {
  messages: number;
  chars: number;
  est_tokens: number;
  by_class: ContextClassChars;
  fold: ContextFoldProjection;
  prefix: ContextPrefixObservation;
  /** Probe cost itself, so an observation hook can never hide its own price. */
  observe_ms: number;
};

type MessageScan = {
  role: string;
  /** Model-visible chars in this message (host-side `details` excluded). */
  chars: number;
  /** Fingerprint of the model-visible projection — what a prefix cache sees. */
  fingerprint: string;
  text_chars: number;
  thinking_chars: number;
  tool_call_chars: number;
  tool_result_chars: number;
  other_chars: number;
  is_tool_result: boolean;
};

/** FNV-1a over the visible projection; collision risk is irrelevant here. */
function fingerprint(projection: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < projection.length; index += 1) {
    hash ^= projection.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${projection.length.toString(36)}:${hash.toString(36)}`;
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type Bucket = "text" | "thinking" | "tool_call" | "tool_result" | "other";

/**
 * Project one message down to what the provider actually receives.
 *
 * A pi `ToolResultMessage` also carries `details` — host-side payload for the
 * TUI and this package's own renderers, dropped before provider serialization.
 * On a real play session `details` is ~48% of tool-result message bytes, so
 * measuring the raw message would overstate the context by nearly half.
 * Protocol scaffolding (role keys, call ids) is excluded too, which keeps
 * `by_class` summing exactly to `chars`.
 */
function scanMessage(message: unknown): MessageScan {
  const role = (message as { role?: unknown } | null)?.role;
  const scan: MessageScan = {
    role: typeof role === "string" ? role : "unknown",
    chars: 0,
    fingerprint: "",
    text_chars: 0,
    thinking_chars: 0,
    tool_call_chars: 0,
    tool_result_chars: 0,
    other_chars: 0,
    is_tool_result: role === "toolResult",
  };
  const pieces: string[] = [scan.role];
  const push = (piece: string, bucket: Bucket) => {
    if (!piece) return;
    pieces.push(piece);
    if (bucket === "text") scan.text_chars += piece.length;
    else if (bucket === "thinking") scan.thinking_chars += piece.length;
    else if (bucket === "tool_call") scan.tool_call_chars += piece.length;
    else if (bucket === "tool_result") scan.tool_result_chars += piece.length;
    else scan.other_chars += piece.length;
  };

  const content = (message as { content?: unknown } | null)?.content;
  if (scan.is_tool_result) {
    push(textOf((message as { toolName?: unknown }).toolName), "tool_result");
    if (typeof content === "string") {
      push(content, "tool_result");
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const type = (part as { type?: unknown } | null)?.type;
        push(
          type === "text" ? textOf((part as { text?: unknown }).text) : serialize(part),
          "tool_result",
        );
      }
    } else if (content !== undefined) {
      push(serialize(content), "tool_result");
    }
  } else if (typeof content === "string") {
    push(content, "text");
  } else if (Array.isArray(content)) {
    for (const part of content) {
      const type = (part as { type?: unknown } | null)?.type;
      if (type === "text") {
        push(textOf((part as { text?: unknown }).text), "text");
      } else if (type === "thinking") {
        push(textOf((part as { thinking?: unknown }).thinking), "thinking");
      } else if (type === "toolCall") {
        const call = part as { name?: unknown; arguments?: unknown };
        push(textOf(call.name) + serialize(call.arguments), "tool_call");
      } else {
        push(serialize(part), "other");
      }
    }
  } else if (content !== undefined) {
    push(serialize(content), "other");
  }

  scan.chars = scan.text_chars + scan.thinking_chars + scan.tool_call_chars
    + scan.tool_result_chars + scan.other_chars;
  scan.fingerprint = fingerprint(pieces.join("\u0000"));
  return scan;
}

function classify(scans: readonly MessageScan[]): ContextClassChars {
  const totals: ContextClassChars = {
    user: 0,
    assistant_text: 0,
    assistant_thinking: 0,
    tool_call: 0,
    tool_result: 0,
    other: 0,
  };
  for (const scan of scans) {
    totals.assistant_thinking += scan.thinking_chars;
    totals.tool_call += scan.tool_call_chars;
    totals.tool_result += scan.tool_result_chars;
    totals.other += scan.other_chars;
    if (scan.role === "user") {
      totals.user += scan.text_chars;
    } else if (scan.role === "assistant") {
      totals.assistant_text += scan.text_chars;
    } else {
      totals.other += scan.text_chars;
    }
  }
  return totals;
}

/**
 * Project one epoch fold at the current turn boundary.
 *
 * The fold keeps every user message and every line of KP prose, and replaces
 * closed-turn tool arguments, tool results, and thinking with stubs. Nothing
 * inside the current turn is touched: those results are the live inputs of the
 * remaining model calls of this turn.
 */
function projectFold(scans: readonly MessageScan[], totalChars: number): ContextFoldProjection {
  let boundary: number | null = null;
  for (let index = scans.length - 1; index >= 0; index -= 1) {
    if (scans[index].role === "user") {
      boundary = index;
      break;
    }
  }
  const limit = boundary ?? 0;
  let closedTurns = 0;
  let foldedToolResults = 0;
  let toolChars = 0;
  let thinkingChars = 0;
  for (let index = 0; index < limit; index += 1) {
    const scan = scans[index];
    if (scan.role === "user") closedTurns += 1;
    if (scan.is_tool_result) foldedToolResults += 1;
    toolChars += scan.tool_call_chars + scan.tool_result_chars;
    thinkingChars += scan.thinking_chars;
  }
  const evictable = toolChars + thinkingChars;
  const stub = foldedToolResults * STUB_CHARS;
  const saving = Math.max(0, evictable - stub);
  return {
    turn_boundary_index: boundary,
    closed_turns: closedTurns,
    folded_tool_results: foldedToolResults,
    tool_chars: toolChars,
    thinking_chars: thinkingChars,
    evictable_chars: evictable,
    stub_chars: stub,
    projected_chars: Math.max(0, totalChars - saving),
    saving_chars: saving,
    saving_percent: totalChars > 0 ? (saving / totalChars) * 100 : null,
    est_saving_tokens: estimateTokens(saving),
  };
}

function comparePrefix(
  scans: readonly MessageScan[],
  previous: readonly MessageScan[] | null,
): ContextPrefixObservation {
  if (previous === null) {
    return {
      status: "first",
      stable_messages: 0,
      stable_chars: 0,
      diverged_at: null,
      appended_messages: scans.length,
      previous_messages: 0,
    };
  }
  const shared = Math.min(scans.length, previous.length);
  let stableMessages = 0;
  let stableChars = 0;
  while (
    stableMessages < shared
    && scans[stableMessages].fingerprint === previous[stableMessages].fingerprint
  ) {
    stableChars += scans[stableMessages].chars;
    stableMessages += 1;
  }
  const diverged = stableMessages < shared ? stableMessages : null;
  const appended = Math.max(0, scans.length - stableMessages);
  let status: ContextPrefixStatus;
  if (stableMessages === previous.length && scans.length >= previous.length) {
    status = "append_only";
  } else if (stableMessages === 0) {
    status = "reset";
  } else {
    status = "rewritten";
  }
  return {
    status,
    stable_messages: stableMessages,
    stable_chars: stableChars,
    diverged_at: diverged,
    appended_messages: appended,
    previous_messages: previous.length,
  };
}

export type ContextProbeObserver = {
  /** Measure one model call's context. Never mutates or returns messages. */
  observe(messages: readonly unknown[]): ContextProbe;
};

export function createContextProbe(
  options: { now?: () => number } = {},
): ContextProbeObserver {
  const now = options.now ?? performance.now.bind(performance);
  let previous: MessageScan[] | null = null;
  return {
    observe(messages: readonly unknown[]): ContextProbe {
      const startedAt = now();
      const scans = messages.map(scanMessage);
      const chars = scans.reduce((sum, scan) => sum + scan.chars, 0);
      const prefix = comparePrefix(scans, previous);
      previous = scans;
      return {
        messages: scans.length,
        chars,
        est_tokens: estimateTokens(chars),
        by_class: classify(scans),
        fold: projectFold(scans, chars),
        prefix,
        observe_ms: Math.max(0, now() - startedAt),
      };
    },
  };
}
