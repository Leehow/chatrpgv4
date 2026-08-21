/**
 * Epoch context fold — collapse closed-turn tool results, keep the prefix cache.
 *
 * A tool result is the live input of the model calls that follow it *inside its
 * own turn*: the KP narrates the roll, the scene projection, the NPC state it
 * just read. Once `turn.finalize` closes that turn, the payload is dead weight —
 * the next turn's authority comes from `state.*` / scene projections /
 * `session.resume`, never from rereading old JSON in the transcript. Measured on
 * real sessions, closed-turn tool results are 85–91% of the model-visible
 * context while KP prose is under 2%.
 *
 * The constraint that shapes the design is prefix caching. This host runs at
 * ~96% cache-read hit rate on automatic prefix caching with no pinnable
 * breakpoints, so any rewrite inside the prefix invalidates every token after
 * it. A sliding window would rewrite the prefix on *every* turn and pay that
 * invalidation every time. So this is an **epoch fold** instead:
 *
 * - Folding happens only on the first model call of a turn, never mid-turn.
 * - It happens only when the unfolded closed-turn pile crosses a threshold, so
 *   most turns are pure appends and keep hitting cache.
 * - A folded result's stub is computed once and frozen in {@link stubs}, keyed
 *   by `toolCallId`. The same result therefore renders to the same bytes on
 *   every later call — the folded prefix is stable, not regenerated.
 * - Folding is monotonic: a stub is never restored, so the prefix never moves
 *   backwards.
 *
 * The stub itself is structural, never a summary: tool identity, canonical
 * operation, ok/error, the canonical `full_result_sha256` handle, and the
 * folded byte count. Nothing is inferred from the prose — a semantic digest
 * would be both a fabrication risk and non-deterministic, which would break the
 * byte-stability the cache depends on.
 */
import { estimateTokens } from "./context-probe.ts";

/** Fold when this many est_tokens of closed-turn tool results have piled up. */
export const DEFAULT_FOLD_THRESHOLD_TOKENS = 20000;

/**
 * Never fold a result smaller than this. A stub costs ~200 chars, so folding a
 * short receipt spends more context than it reclaims — and short receipts are
 * exactly the ones a KP can still read at a glance.
 */
export const MIN_FOLD_CHARS = 400;

export type ContextFoldSettings = {
  enabled: boolean;
  thresholdTokens: number;
};

export type ContextFoldStats = {
  enabled: boolean;
  threshold_tokens: number;
  /** Number of folds performed so far in this host context. */
  epochs: number;
  /** Tool results currently folded. */
  folded_results: number;
  /** Original model-visible chars replaced by stubs. */
  folded_chars: number;
  /** Chars the stubs cost instead. */
  stub_chars: number;
  /** Closed-turn tool result chars not folded yet (the next epoch's pile). */
  pending_chars: number;
  /** Results folded by the call that just ran; 0 on every other call. */
  folded_this_call: number;
};

const FOLD_NOTE = "此工具结果已折叠以控制上下文；需要细节请重新调用对应查询工具"
  + "（state.* / scene / npc / clues），或 session.resume 重建当前工作集。";

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Model-visible size of a tool result: content text only, never `details`. */
function resultChars(message: unknown): number {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const part of content) {
    const type = (part as { type?: unknown } | null)?.type;
    if (type === "text") {
      chars += textOf((part as { text?: unknown }).text).length;
    } else {
      try {
        chars += (JSON.stringify(part) ?? "").length;
      } catch {
        // Unserializable parts are not counted; they are also never folded.
      }
    }
  }
  return chars;
}

/** Pull the canonical envelope fields back out of a tool result payload. */
function readEnvelope(message: unknown): {
  ok: boolean | null;
  operation: string | null;
  digest: string | null;
} {
  const content = (message as { content?: unknown } | null)?.content;
  const first = Array.isArray(content) ? content[0] : null;
  const text = typeof content === "string" ? content : textOf((first as { text?: unknown })?.text);
  if (!text.startsWith("{")) return { ok: null, operation: null, digest: null };
  try {
    const parsed = JSON.parse(text) as {
      ok?: unknown;
      wire?: { canonical_operation?: unknown; full_result_sha256?: unknown };
    };
    return {
      ok: typeof parsed.ok === "boolean" ? parsed.ok : null,
      operation: textOf(parsed.wire?.canonical_operation) || null,
      digest: textOf(parsed.wire?.full_result_sha256) || null,
    };
  } catch {
    return { ok: null, operation: null, digest: null };
  }
}

/** Deterministic stub text for one tool result. Computed once, then frozen. */
function stubText(message: unknown, chars: number): string {
  const envelope = readEnvelope(message);
  const isError = (message as { isError?: unknown } | null)?.isError === true;
  return JSON.stringify({
    folded: true,
    tool: textOf((message as { toolName?: unknown }).toolName) || null,
    canonical_operation: envelope.operation,
    ok: envelope.ok ?? !isError,
    full_result_sha256: envelope.digest,
    folded_chars: chars,
    note: FOLD_NOTE,
  });
}

export type ContextFoldResult = {
  messages: unknown[];
  stats: ContextFoldStats;
};

export type ContextFold = {
  /** Apply the standing fold, and open a new epoch when the pile is big enough. */
  apply(messages: readonly unknown[]): ContextFoldResult;
  stats(): ContextFoldStats;
};

export function readFoldSettings(
  env: Record<string, string | undefined> = process.env,
): ContextFoldSettings {
  const raw = (env.PI_COC_CONTEXT_FOLD ?? "").trim().toLowerCase();
  const tokens = Number((env.PI_COC_CONTEXT_FOLD_TOKENS ?? "").trim());
  return {
    enabled: raw !== "off" && raw !== "0" && raw !== "false",
    thresholdTokens: Number.isFinite(tokens) && tokens > 0
      ? tokens
      : DEFAULT_FOLD_THRESHOLD_TOKENS,
  };
}

export function createContextFold(
  settings: ContextFoldSettings = readFoldSettings(),
): ContextFold {
  /** toolCallId -> frozen stub content. Monotonic; entries are never removed. */
  const stubs = new Map<string, { type: "text"; text: string }[]>();
  let epochs = 0;
  let foldedChars = 0;
  let stubChars = 0;
  let pendingChars = 0;
  let foldedThisCall = 0;

  const snapshot = (): ContextFoldStats => ({
    enabled: settings.enabled,
    threshold_tokens: settings.thresholdTokens,
    epochs,
    folded_results: stubs.size,
    folded_chars: foldedChars,
    stub_chars: stubChars,
    pending_chars: pendingChars,
    folded_this_call: foldedThisCall,
  });

  const idOf = (message: unknown): string | null => {
    const id = (message as { toolCallId?: unknown } | null)?.toolCallId;
    return typeof id === "string" && id ? id : null;
  };

  const isToolResult = (message: unknown): boolean => (
    (message as { role?: unknown } | null)?.role === "toolResult"
  );

  return {
    stats: snapshot,
    apply(messages: readonly unknown[]): ContextFoldResult {
      foldedThisCall = 0;
      if (!settings.enabled || !Array.isArray(messages)) {
        pendingChars = 0;
        return { messages: messages as unknown[], stats: snapshot() };
      }

      // Everything before the last player message belongs to a closed turn.
      // The live turn's results are the current call's own inputs.
      let boundary = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if ((messages[index] as { role?: unknown } | null)?.role === "user") {
          boundary = index;
          break;
        }
      }

      // A fold may only open on the first model call of a turn, so a folded
      // prefix never changes underneath the calls of the turn using it.
      const atTurnBoundary = boundary === messages.length - 1;
      const closed: { index: number; id: string; chars: number }[] = [];
      let pile = 0;
      for (let index = 0; index < Math.max(0, boundary); index += 1) {
        const message = messages[index];
        if (!isToolResult(message)) continue;
        const id = idOf(message);
        if (id === null || stubs.has(id)) continue;
        const chars = resultChars(message);
        if (chars < MIN_FOLD_CHARS) continue;
        closed.push({ index, id, chars });
        pile += chars;
      }
      pendingChars = pile;

      if (atTurnBoundary && closed.length > 0 && estimateTokens(pile) > settings.thresholdTokens) {
        for (const entry of closed) {
          const text = stubText(messages[entry.index], entry.chars);
          stubs.set(entry.id, [{ type: "text", text }]);
          foldedChars += entry.chars;
          stubChars += text.length;
        }
        foldedThisCall = closed.length;
        epochs += 1;
        pendingChars = 0;
      }

      if (stubs.size === 0) {
        return { messages: messages as unknown[], stats: snapshot() };
      }
      const projected = messages.map((message) => {
        if (!isToolResult(message)) return message;
        const id = idOf(message);
        const stub = id === null ? undefined : stubs.get(id);
        if (!stub) return message;
        // `details` is host-side and never reaches the provider; it is kept so
        // the TUI and this package's renderers still show the original call.
        return { ...(message as Record<string, unknown>), content: stub };
      });
      return { messages: projected, stats: snapshot() };
    },
  };
}
