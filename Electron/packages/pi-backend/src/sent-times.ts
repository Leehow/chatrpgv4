import { promises as fs } from "node:fs";

/**
 * Contract §164: when the host began working on each player message, beside the session file.
 *
 * Pi stamps a user message when it accepts the prompt, after the host's own preparation, so a
 * wait read from Pi's stamp is short by that preparation and disagrees with the live row. The host
 * keeps its own start here, keyed by the Pi `message.timestamp` the session file already carries,
 * one JSON line per message: `{"m": <Pi message.timestamp>, "at": <host start>}`.
 */
export const SENT_TIMES_SUFFIX = ".sent.jsonl";

export function sentTimesPath(sessionPath: string): string {
  return sessionPath + SENT_TIMES_SUFFIX;
}

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export async function recordSentTime(sessionPath: string, messageTimestamp: number, at: number): Promise<void> {
  if (!isTime(messageTimestamp) || !isTime(at)) return;
  await fs.appendFile(sentTimesPath(sessionPath), JSON.stringify({ m: messageTimestamp, at }) + "\n", "utf8");
}

/** Pi message timestamp → host start. A missing or torn file reads as what it can. */
export async function readSentTimes(sessionPath: string): Promise<Map<number, number>> {
  const times = new Map<number, number>();
  let data: string;
  try {
    data = await fs.readFile(sentTimesPath(sessionPath), "utf8");
  } catch {
    return times;
  }
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (isTime(row?.m) && isTime(row?.at)) times.set(row.m, row.at);
    } catch {
      // A line torn by a crash mid-append names no message.
    }
  }
  return times;
}

export async function copySentTimes(fromSessionPath: string, toSessionPath: string): Promise<void> {
  await fs.copyFile(sentTimesPath(fromSessionPath), sentTimesPath(toSessionPath)).catch(() => undefined);
}

export async function removeSentTimes(sessionPath: string): Promise<void> {
  await fs.rm(sentTimesPath(sessionPath), { force: true }).catch(() => undefined);
}

type PendingSend = { text: string; at: number };

const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();

/**
 * The dispatches each session has begun and Pi has not yet echoed. Pi echoes a user message on
 * `message_end`; the oldest pending send whose text the echo contains is that message's (the
 * steer receipt's rule). Messages the host never dispatched match nothing.
 */
export class PendingSends {
  private readonly pending = new Map<string, PendingSend[]>();

  note(sessionId: string, text: string, at: number): PendingSend | undefined {
    if (!normalize(text)) return undefined;
    const send = { text, at };
    const list = this.pending.get(sessionId) ?? [];
    list.push(send);
    this.pending.set(sessionId, list);
    return send;
  }

  drop(sessionId: string, send: PendingSend | undefined): void {
    const list = this.pending.get(sessionId);
    if (!list || !send) return;
    const remaining = list.filter(item => item !== send);
    if (remaining.length) this.pending.set(sessionId, remaining);
    else this.pending.delete(sessionId);
  }

  take(sessionId: string, echoed: string): number | undefined {
    const list = this.pending.get(sessionId);
    const content = normalize(echoed);
    if (!list?.length || !content) return undefined;
    const match = list.find(item => content.includes(normalize(item.text)));
    if (!match) return undefined;
    this.drop(sessionId, match);
    return match.at;
  }

  clear(sessionId: string): void {
    this.pending.delete(sessionId);
  }
}
