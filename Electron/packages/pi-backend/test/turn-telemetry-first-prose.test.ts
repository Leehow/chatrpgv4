import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isServiceNoticeRow, proseArrival } from "../src/first-prose.js";
import { createPiHostBackend } from "../src/index.js";
import { turnTelemetryPath, type TurnTelemetryRecord } from "../src/turn-telemetry.js";

/**
 * Contract §135.11.5 (SL-94): the turn record says when the player first sees the turn's prose.
 *
 * The mark is taken at the backend's stream seam, so these tests drive the host's own reader
 * (`rpcEvent`) with the shapes Pi and the extension produce, and read the record the host wrote.
 * The classifier is also pinned on its own, shape by shape.
 */

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(10);
  }
  throw new Error("condition was not met before timeout");
}

const card = (id: string, data: Record<string, unknown>) =>
  ({ type: "custom", id, customType: "coc-mechanics", timestamp: new Date().toISOString(), data: { play_language: "en", ...data } });
const roll = (marker?: string) =>
  ({ kind: "roll", receipt: `roll:${marker ?? "x"}`, visibility: "public", skill: "Spot Hidden", roll: 12, target: 50, ...(marker ? { marker } : {}) });

describe("the stream-event classifier (§135.11.5)", () => {
  const presentation = (entry: Record<string, unknown>) => ({ type: "presentation", sessionId: "s", entry });
  const mechanics = (details: Record<string, unknown>) =>
    presentation({ id: "c", role: "assistant", content: "", presentation: { renderer: "coc-mechanics", details } });

  it("counts a mechanics card by the prose fields its renderer draws, never a card with rows only", () => {
    const row = card("c", {});
    expect(proseArrival(mechanics({ mechanics: [roll("r1")], marked_text: "The lamp gutters. {{r1}}" }), row))
      .toEqual({ kind: "prose", via: "mechanics" });
    expect(proseArrival(mechanics({ mechanics: [], rendered_text: "The lamp gutters." }), row))
      .toEqual({ kind: "prose", via: "mechanics" });
    expect(proseArrival(mechanics({ mechanics: [roll()] }), row)).toBeUndefined();
    expect(proseArrival(mechanics({ mechanics: [roll()], marked_text: " \n " }), row)).toBeUndefined();
    // A redraw in place passes no row: it is never new prose.
    expect(proseArrival(mechanics({ mechanics: [roll("r1")], marked_text: "The lamp gutters. {{r1}}" }))).toBeUndefined();
    // Other cards are not the turn's prose.
    for (const renderer of ["coc-choice", "coc-character-draft"]) {
      expect(proseArrival(presentation({ id: "c", role: "assistant", content: "", presentation: { renderer, details: { marked_text: "x" } } }), row))
        .toBeUndefined();
    }
  });

  it("tells host prose from a service notice by the details' keys, never by the words", () => {
    const placed = (content = "The door gives.") => presentation({ id: "d", role: "assistant", content, placedByHost: true });
    const fallback = { type: "custom_message", customType: "coc-delivery", details: { coc_delivery: true, turn: 18 } };
    expect(isServiceNoticeRow(fallback)).toBe(false);
    expect(proseArrival(placed(), fallback)).toEqual({ kind: "prose", via: "host" });
    // Every notice the extension places today names its subject with a flag of its own.
    for (const flag of [
      "provider_outage", "commit_unavailable", "delivery_cut_short", "refused_effect", "preparation_wait",
      "resend_held", "turn_unfinished", "standing_conditions", "input_refused", "empty_input", "review_unavailable",
    ]) {
      const notice = { ...fallback, details: { ...fallback.details, [flag]: true } };
      expect(isServiceNoticeRow(notice), flag).toBe(true);
      expect(proseArrival(placed(), notice), flag).toBeUndefined();
    }
    // A notice added later is left out without being registered anywhere.
    expect(proseArrival(placed(), { ...fallback, details: { ...fallback.details, some_future_notice: true } })).toBeUndefined();
    // The setup opening is the prologue, not a notice.
    expect(proseArrival(placed(), { type: "custom_message", customType: "coc-setup-opening", details: { kind: "setup-opening" } }))
      .toEqual({ kind: "prose", via: "host" });
    expect(proseArrival(placed(" "), fallback)).toBeUndefined();
    expect(proseArrival(presentation({ id: "u", role: "user", content: "hello" }), { type: "custom_message" })).toBeUndefined();
  });

  it("reads a text delta as a candidate and a replacement as prose only when it carries text", () => {
    expect(proseArrival({ type: "text", sessionId: "s", delta: "The" })).toEqual({ kind: "text" });
    expect(proseArrival({ type: "text", sessionId: "s", delta: "\n" })).toBeUndefined();
    expect(proseArrival({ type: "text", sessionId: "s", delta: "The door.", replace: true })).toEqual({ kind: "text_replace", prose: true });
    expect(proseArrival({ type: "text", sessionId: "s", delta: "", replace: true })).toEqual({ kind: "text_replace", prose: false });
    expect(proseArrival({ type: "thinking", sessionId: "s", delta: "private" })).toBeUndefined();
    expect(proseArrival({ type: "tool_call", sessionId: "s", delta: "{\"text\":\"The door.\"}" })).toBeUndefined();
  });
});

/** A bound COC session unless `coc: false` (§135.11.6: the kept text's moment depends on the binding). */
async function fixture({ coc = true }: { coc?: boolean } = {}) {
  root = await mkdtemp(join(tmpdir(), "pipi-first-prose-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(cwd, { recursive: true }), mkdir(directory, { recursive: true })]);
  const sessionPath = join(directory, "s1.jsonl");
  await writeFile(sessionPath, [
    JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-09-26T00:00:00.000Z", cwd }),
    ...(coc
      ? [JSON.stringify({ type: "custom", customType: "coc-session", data: { campaign: "campaign-1", home: root, play_language: "en", mode: "play" } })]
      : []),
  ].join("\n") + "\n");
  const backend = createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    env: { PATH: process.env.PATH ?? "" },
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any,
    authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
  });
  const presentations: Array<{ id: string; at: number }> = [];
  let started = 0;
  backend.subscribe(frame => {
    if (frame.channel !== "stream") return;
    const event = frame.event as any;
    if (event.type === "presentation") presentations.push({ id: event.entry.id, at: Date.now() });
    if (event.type === "status" && event.status === "started") started += 1;
  });
  const rpc = (event: unknown) => (backend as any).rpcEvent((backend as any).live.get("s1"), event);
  /** One UI turn whose events the test sends itself. */
  const open = async (turnId: string) => {
    const before = started;
    const submittedAt = Date.now() - 2;
    await backend.handle("sendPrompt", ["s1", "__prose_turn__", undefined, { turnId, submittedAt, promptBytes: 14 }]);
    await eventually(() => started > before);
  };
  const close = async (turnId: string): Promise<TurnTelemetryRecord> => {
    rpc({ type: "agent_settled" });
    let found: TurnTelemetryRecord | undefined;
    await eventually(async () => {
      found = (await telemetryRows(agentDir)).find(row => row.turnId === turnId);
      return found !== undefined;
    });
    await eventually(() => (backend as any).queue.isBusy("s1") === false);
    return found!;
  };
  /** Pi's own order for `pi.sendMessage` (§55): the row is appended first, then announced with no id. */
  const deliver = async (id: string, details: Record<string, unknown>, content = "The door gives under your shoulder.") => {
    await appendFile(sessionPath, JSON.stringify({
      type: "custom_message", customType: "coc-delivery", content, display: true, details,
      id, parentId: null, timestamp: new Date().toISOString(),
    }) + "\n");
    const message = { role: "custom", customType: "coc-delivery", content, display: true, details, timestamp: Date.now() };
    rpc({ type: "message_start", message });
    rpc({ type: "message_end", message });
  };
  return { backend, presentations, rpc, open, close, deliver };
}

async function telemetryRows(agentDir: string): Promise<TurnTelemetryRecord[]> {
  try {
    return (await readFile(turnTelemetryPath(agentDir), "utf8"))
      .split("\n").filter(Boolean).map(line => JSON.parse(line) as TurnTelemetryRecord);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

const phase = (record: TurnTelemetryRecord, name: string) => record.phases.find(item => item.name === name)?.at;
/** The window around one injected event: the mark must fall inside it. */
async function within(action: () => unknown | Promise<unknown>): Promise<{ before: number; after: number }> {
  const before = Date.now();
  await action();
  return { before, after: Date.now() };
}

describe("PiHostBackend first-prose seam (§135.11.5)", () => {
  it("marks a narrate delivered through a tool at its presentation, via mechanics, with ttftMs unchanged", async () => {
    const { backend, presentations, rpc, open, close } = await fixture();
    try {
      await open("narrate-turn");
      rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 } });
      await sleep(25);
      const narrate = await within(() => rpc({ type: "entry_appended", entry: card("card-narrate", {
        turn: 3, mechanics: [roll("r1")], marked_text: "The lamp gutters as you lean in. {{r1}}",
      }) }));
      expect(presentations.map(item => item.id)).toContain("card-narrate");
      await sleep(25);
      // Later prose never moves it.
      rpc({ type: "entry_appended", entry: card("card-later", { turn: 3, mechanics: [roll("r2")], marked_text: "Later. {{r2}}" }) });
      const record = await close("narrate-turn");

      expect(record.firstProseVia).toBe("mechanics");
      const at = phase(record, "first_prose")!;
      expect(at).toBeGreaterThanOrEqual(narrate.before);
      expect(at).toBeLessThanOrEqual(narrate.after);
      expect(record.durations?.firstProseMs).toBe(at - phase(record, "host_received")!);
      expect(record.durations?.ttftMs).toBe(phase(record, "first_stream")! - phase(record, "pi_dispatch")!);
      expect(record.performance?.ttftMs).toBe(record.durations?.ttftMs);
      expect(record.durations!.ttftMs!).toBeLessThan(record.durations!.firstProseMs!);
    } finally {
      await backend.close();
    }
  });

  it("does not count a mechanics card with no prose, nor a card the host never forwards; the narrate after them does", async () => {
    const { backend, presentations, rpc, open, close } = await fixture();
    try {
      await open("cards-turn");
      // A roll card from a non-delivery tool reaches the screen and carries no prose.
      rpc({ type: "entry_appended", entry: card("card-roll", { turn: 4, mechanics: [roll()] }) });
      expect(presentations.map(item => item.id)).toContain("card-roll");
      await sleep(25);
      // Every row keeper-only and no say span: `mechanicsEntry` projects nothing, so nothing is forwarded,
      // whatever the raw entry carries.
      rpc({ type: "entry_appended", entry: card("card-hidden", {
        turn: 4, mechanics: [{ ...roll("r9"), visibility: "keeper" }], marked_text: "Unseen. {{r9}}",
      }) });
      expect(presentations.map(item => item.id)).not.toContain("card-hidden");
      await sleep(25);
      const narrate = await within(() => rpc({ type: "entry_appended", entry: card("card-narrate", {
        turn: 4, mechanics: [roll("r1")], marked_text: "The cellar smells of wet stone. {{r1}}",
      }) }));
      const record = await close("cards-turn");

      expect(record.firstProseVia).toBe("mechanics");
      expect(phase(record, "first_prose")).toBeGreaterThanOrEqual(narrate.before);
      expect(phase(record, "first_prose")).toBeLessThanOrEqual(narrate.after);
    } finally {
      await backend.close();
    }
  });

  it("counts the host's own placed prose as host, and never a service notice", async () => {
    const { backend, presentations, open, close, deliver } = await fixture();
    try {
      await open("notice-only");
      await deliver("notice-1", { coc_delivery: true, turn: 6, turn_unfinished: true }, "This turn ended without a result.");
      await eventually(() => presentations.some(item => item.id === "notice-1"));
      const notice = await close("notice-only");
      expect(notice.durations).not.toHaveProperty("firstProseMs");
      expect(notice).not.toHaveProperty("firstProseVia");

      await open("placed-turn");
      await deliver("notice-2", { coc_delivery: true, turn: 7, review_unavailable: true, streak: 1, service: true }, "The review is unavailable.");
      await eventually(() => presentations.some(item => item.id === "notice-2"));
      await sleep(25);
      const before = Date.now();
      // The §8 fallback is placed from `agent_end`, right before the settle that flushes the record:
      // the settle is sent at once, while the delivery is still being projected from the transcript.
      await deliver("placed-1", { coc_delivery: true, turn: 7 });
      const record = await close("placed-turn");
      const done = Date.now();

      expect(presentations.some(item => item.id === "placed-1")).toBe(true);
      expect(record.firstProseVia).toBe("host");
      expect(phase(record, "first_prose")).toBeGreaterThanOrEqual(before);
      expect(phase(record, "first_prose")).toBeLessThanOrEqual(done);
    } finally {
      await backend.close();
    }
  });

  it("counts assistant text a session without a COC binding keeps at message_end from its first delta", async () => {
    // Unbound, the text is prose on screen from its first delta. A bound session folds it until its
    // message ends (§135.11.6); that case is the next one. This test ran on a bound session before.
    const { backend, rpc, open, close } = await fixture({ coc: false });
    try {
      await open("kept-turn");
      const first = await within(() => rpc({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "The rain has not " } }));
      await sleep(30);
      rpc({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "stopped since noon." } });
      await sleep(30);
      const ended = Date.now();
      rpc({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "The rain has not stopped since noon." }], stopReason: "stop" } });
      const record = await close("kept-turn");

      expect(record.firstProseVia).toBe("text");
      expect(phase(record, "first_prose")).toBeGreaterThanOrEqual(first.before);
      expect(phase(record, "first_prose")).toBeLessThanOrEqual(first.after);
      expect(phase(record, "first_prose")).toBeLessThan(ended);
    } finally {
      await backend.close();
    }
  });

  it("counts a bound COC session's kept text at its message_end, when it leaves the folded card (§135.11.6)", async () => {
    const { backend, rpc, open, close } = await fixture();
    try {
      await open("folded-turn");
      const first = await within(() => rpc({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "The rain has not " } }));
      await sleep(30);
      rpc({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "stopped since noon." } });
      await sleep(30);
      // Unchanged at message_end, so the host sends nothing more: the settle itself is the moment.
      const ended = await within(() => rpc({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "The rain has not stopped since noon." }], stopReason: "stop" } }));
      const record = await close("folded-turn");

      expect(record.firstProseVia).toBe("text");
      expect(phase(record, "first_prose")).toBeGreaterThan(first.after);
      expect(phase(record, "first_prose")).toBeGreaterThanOrEqual(ended.before);
      expect(phase(record, "first_prose")).toBeLessThanOrEqual(ended.after);
      expect(record.durations?.firstProseMs).toBe(phase(record, "first_prose")! - phase(record, "host_received")!);
    } finally {
      await backend.close();
    }
  });

  it("counts text replaced by prose at the replacement, and text replaced by nothing never", async () => {
    const { backend, rpc, open, close } = await fixture();
    try {
      // The Keeper's words beside a tool call are streamed, then stripped at message_end.
      await open("dropped-turn");
      rpc({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Let me check the clues first." } });
      rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1 } });
      await sleep(20);
      rpc({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "resolve", arguments: {} }], stopReason: "toolUse" } });
      const dropped = await close("dropped-turn");
      expect(dropped.durations).not.toHaveProperty("firstProseMs");
      expect(dropped).not.toHaveProperty("firstProseVia");
      expect(dropped.phases.map(item => item.name)).not.toContain("first_prose");

      // A draft streamed live and replaced by the rendered delivery counts at the replacement.
      await open("replaced-turn");
      const draft = await within(() => rpc({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "{{say:Knott}}Not here.{{/say}} He turns away." } }));
      await sleep(30);
      const replaced = await within(() => rpc({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "\"Not here.\" He turns away." }], stopReason: "stop" } }));
      const record = await close("replaced-turn");
      expect(record.firstProseVia).toBe("text");
      expect(phase(record, "first_prose")).toBeGreaterThan(draft.after);
      expect(phase(record, "first_prose")).toBeGreaterThanOrEqual(replaced.before);
      expect(phase(record, "first_prose")).toBeLessThanOrEqual(replaced.after);
    } finally {
      await backend.close();
    }
  });

  it("does not count an earlier turn's card redrawn in place during this turn", async () => {
    const { backend, presentations, rpc, open, close } = await fixture();
    try {
      await open("card-turn");
      rpc({ type: "entry_appended", entry: card("card-1", { turn: 1, mechanics: [roll("r1")], marked_text: "The ledger is open. {{r1}}" }) });
      const first = await close("card-turn");
      expect(first.firstProseVia).toBe("mechanics");

      await open("patch-turn");
      const drawn = presentations.length;
      rpc({ type: "entry_appended", entry: {
        type: "custom", id: "patch-1", customType: "coc-card-patch", timestamp: new Date().toISOString(),
        data: { campaign: "campaign-1", source: "test-lane", card: { id: "card-1" }, patch: { review: { verdict: "pass" } } },
      } });
      // The patch redraws the card where it sits: the same prose, already on screen since turn 1.
      expect(presentations.slice(drawn).map(item => item.id)).toEqual(["card-1"]);
      const record = await close("patch-turn");
      expect(record.durations).not.toHaveProperty("firstProseMs");
      expect(record).not.toHaveProperty("firstProseVia");
    } finally {
      await backend.close();
    }
  });
});
