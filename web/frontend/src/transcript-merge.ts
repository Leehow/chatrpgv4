import type { ChatMessage, KeeperContentBlock, TranscriptMessage } from "./types";

function sameOptionalId(left?: string | number | null, right?: string | number | null): boolean | null {
  if (left == null || left === "" || right == null || right === "") return null;
  return String(left) === String(right);
}

function keeperIds(message: {
  finalizationId?: string;
  entryId?: string;
  liveId?: string;
  turn?: number | string;
}) {
  return {
    finalizationId: message.finalizationId,
    entryId: message.entryId,
    liveId: message.liveId,
    turn: message.turn,
  };
}

export function sameTranscriptMessage(left: ChatMessage, right: ChatMessage): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "keeper" && right.kind === "keeper") {
    return keeperIdentityMatch(keeperIds(left), {
      finalizationId: right.finalizationId,
      entryId: right.entryId,
      liveId: right.liveId,
      turn: right.turn,
    });
  }
  if (left.kind === "player" && right.kind === "player") {
    const sameEntry = sameOptionalId(left.entryId, right.entryId);
    if (sameEntry != null) return sameEntry;
    const sameTurn = sameOptionalId(left.turn, right.turn);
    return sameTurn === true;
  }
  return false;
}

export function keeperIdentityMatch(
  row: { finalizationId?: string; entryId?: string; liveId?: string; turn?: number | string },
  incoming: { finalizationId?: string; entryId?: string; liveId?: string; turn?: number | string },
): boolean {
  const sameFinalization = sameOptionalId(row.finalizationId, incoming.finalizationId);
  if (sameFinalization != null) return sameFinalization;
  const sameEntry = sameOptionalId(row.entryId, incoming.entryId);
  if (sameEntry != null) return sameEntry;
  const sameLive = sameOptionalId(row.liveId, incoming.liveId);
  if (sameLive != null) return sameLive;
  const sameTurn = sameOptionalId(row.turn, incoming.turn);
  return sameTurn === true;
}

export function overlayKeeperFromTranscript(
  prev: ChatMessage,
  incoming: ChatMessage,
): ChatMessage {
  if (prev.kind !== "keeper" || incoming.kind !== "keeper") return incoming;
  return {
    ...prev,
    text: incoming.text || prev.text,
    contentBlocks: incoming.contentBlocks ?? prev.contentBlocks,
    finalizationId: incoming.finalizationId ?? prev.finalizationId,
    entryId: incoming.entryId ?? prev.entryId,
    liveId: incoming.liveId ?? prev.liveId,
    turn: incoming.turn ?? prev.turn,
    at: incoming.at ?? prev.at,
    startedAt: incoming.startedAt ?? prev.startedAt,
    durationMs: incoming.durationMs ?? prev.durationMs,
  };
}

/** Skip host opening attach once any safe keeper text has been applied. */
export function shouldAttachHostOpening(
  hostOpening: boolean | undefined,
  applied: boolean,
  messages: Array<{ role?: string; text?: string }> | undefined,
): boolean {
  const hydrated = Boolean(
    applied
    && (messages || []).some((row) => row.role === "keeper" && String(row.text || "").trim()),
  );
  return Boolean(hostOpening && !hydrated);
}

export function mergeTranscriptMessages(
  prev: ChatMessage[],
  next: ChatMessage[],
  sameCampaign: boolean,
): { next: ChatMessage[]; applied: boolean } {
  if (!sameCampaign) return { next, applied: next.length > 0 };
  if (next.length === 0) return { next: prev, applied: false };

  const merged = [...prev];
  const matchedPositions: number[] = [];
  let cursor = 0;
  let matched = 0;
  for (; matched < next.length; matched += 1) {
    const position = merged.findIndex(
      (message, index) => index >= cursor && sameTranscriptMessage(message, next[matched]),
    );
    if (position < 0) break;
    matchedPositions.push(position);
    merged[position] = overlayKeeperFromTranscript(merged[position], next[matched]);
    cursor = position + 1;
  }

  if (matched === 0) {
    const onlyChrome = prev.every(
      (message) =>
        message.kind === "note"
        || (message.kind === "keeper" && (!message.text || message.streaming)),
    );
    if (onlyChrome) return { next, applied: true };
    return { next: prev, applied: false };
  }

  const lastMatched = matchedPositions[matchedPositions.length - 1];
  if (matched < next.length) {
    return {
      next: [...merged.slice(0, lastMatched + 1), ...next.slice(matched)],
      applied: true,
    };
  }
  const staleTail = merged.slice(lastMatched + 1);
  if (
    staleTail.length > 0 &&
    staleTail.every(
      (message) => message.kind === "note" || (message.kind === "keeper" && message.streaming),
    )
  ) {
    return { next: merged.slice(0, lastMatched + 1), applied: true };
  }
  return { next: merged, applied: true };
}

function incomingKeeperIds(message: TranscriptMessage) {
  return {
    finalizationId: message.finalization_id,
    entryId: message.entry_id,
    liveId: message.live_id,
    turn: message.turn,
  };
}

function incomingHasIdentity(message: TranscriptMessage): boolean {
  return Boolean(
    (typeof message.finalization_id === "string" && message.finalization_id)
    || (typeof message.entry_id === "string" && message.entry_id)
    || (typeof message.live_id === "string" && message.live_id)
    || (message.turn != null && message.turn !== ""),
  );
}

export function applySettledKeeperMessage(
  prev: ChatMessage[],
  message?: TranscriptMessage | null,
  expectedLiveId?: string | null,
): ChatMessage[] {
  if (!message || message.role !== "keeper") return prev;
  const blocks = Array.isArray(message.content_blocks)
    ? (message.content_blocks as KeeperContentBlock[])
    : undefined;
  const text = typeof message.text === "string" ? message.text : "";
  if (!text && !blocks?.length) return prev;
  if (!incomingHasIdentity(message)) return prev;
  if (
    typeof expectedLiveId === "string"
    && expectedLiveId
    && typeof message.live_id === "string"
    && message.live_id
    && message.live_id !== expectedLiveId
  ) {
    return prev;
  }

  const incoming = incomingKeeperIds(message);
  const matches: number[] = [];
  prev.forEach((row, index) => {
    if (row.kind !== "keeper") return;
    if (keeperIdentityMatch(keeperIds(row), incoming)) matches.push(index);
  });
  if (matches.length !== 1) return prev;

  const index = matches[0];
  const next = [...prev];
  const row = next[index];
  if (row.kind !== "keeper") return prev;
  next[index] = {
    ...row,
    ...(text ? { text } : {}),
    ...(blocks?.length ? { contentBlocks: blocks } : {}),
    ...(typeof message.finalization_id === "string" && message.finalization_id
      ? { finalizationId: message.finalization_id }
      : {}),
    ...(typeof message.entry_id === "string" && message.entry_id
      ? { entryId: message.entry_id }
      : {}),
    ...(typeof message.live_id === "string" && message.live_id
      ? { liveId: message.live_id }
      : {}),
    ...(message.turn != null ? { turn: message.turn } : {}),
  };
  const previous = next[index - 1];
  if (
    previous?.kind === "player"
    && previous.turn == null
    && message.turn != null
  ) {
    next[index - 1] = { ...previous, turn: message.turn };
  }
  return next;
}
