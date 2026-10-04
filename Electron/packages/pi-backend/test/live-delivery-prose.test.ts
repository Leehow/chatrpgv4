import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
import { turnTelemetryPath, type TurnTelemetryRecord } from "../src/turn-telemetry.js";

/**
 * Contract §171: the Keeper's delivery is drawn as the story while its arguments stream.
 *
 * Driven through the host's own reader (`rpcEvent`) with the event shapes Pi's RPC mode emits: a
 * `toolcall_start` that names the tool, raw JSON deltas, a `toolcall_end` with the parsed call, and
 * the kernel's `coc-mechanics` card appended once the delivery lands.
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

type Drawn = { id: string; replacesDraft?: string; draft: boolean; marked?: string; at: number };

async function fixture(mode = "play") {
  root = await mkdtemp(join(tmpdir(), "pipi-live-prose-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(cwd, { recursive: true }), mkdir(directory, { recursive: true })]);
  await writeFile(join(directory, "s1.jsonl"), [
    JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-10-03T00:00:00.000Z", cwd }),
    JSON.stringify({ type: "custom", customType: "coc-session", data: { campaign: "campaign-1", home: root, play_language: "zh-Hans", mode } }),
  ].join("\n") + "\n");
  const backend = createPiHostBackend({
    agentDir, sessionsRoot, runtimeRoot: root, piPath: process.execPath, env: { PATH: process.env.PATH ?? "" },
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any,
    authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
  });
  const drawn: Drawn[] = [];
  let started = 0;
  backend.subscribe(frame => {
    if (frame.channel !== "stream") return;
    const event = frame.event as any;
    if (event.type === "status" && event.status === "started") started += 1;
    if (event.type !== "presentation") return;
    const details = event.entry.presentation?.details ?? {};
    drawn.push({ id: event.entry.id, ...(event.replacesDraft ? { replacesDraft: event.replacesDraft } : {}), draft: details.draft === true,
      ...(typeof details.marked_text === "string" ? { marked: details.marked_text } : {}), at: Date.now() });
  });
  const rpc = (event: unknown) => (backend as any).rpcEvent((backend as any).live.get("s1"), event);
  const open = async (turnId: string) => {
    const before = started;
    await backend.handle("sendPrompt", ["s1", "__prose_turn__", undefined, { turnId, submittedAt: Date.now() - 2, promptBytes: 14 }]);
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
  /** One call streamed the way Pi's RPC mode sends it. */
  const call = async (toolName: string, args: Record<string, unknown>, pieces = 4) => {
    const json = JSON.stringify(args);
    rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: `call-${toolName}`, toolName } });
    const size = Math.ceil(json.length / pieces);
    for (let at = 0; at < json.length; at += size) {
      rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: json.slice(at, at + size) } });
      await sleep(60);
    }
    rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { type: "toolCall", id: `call-${toolName}`, name: toolName, arguments: args } } });
    rpc({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: `call-${toolName}`, name: toolName, arguments: args }] } });
  };
  const card = (id: string, marked: string) => rpc({ type: "entry_appended", entry: {
    type: "custom", id, customType: "coc-mechanics", timestamp: new Date().toISOString(),
    data: { turn: 1, play_language: "zh-Hans", marked_text: marked, mechanics: [{ kind: "time", receipt: "time:t1", visibility: "public", minutes: 5 }] },
  } });
  return { backend, drawn, rpc, open, close, call, card };
}

async function telemetryRows(agentDir: string): Promise<TurnTelemetryRecord[]> {
  try {
    return (await readFile(turnTelemetryPath(agentDir), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as TurnTelemetryRecord);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

const prose = "土路把皮卡颠进镇口。{{say:棚下的加油站老板}}“要加油就直说。”{{/say}}你熄了火。";
const shown = "土路把皮卡颠进镇口。“要加油就直说。”你熄了火。";

describe("PiHostBackend live delivery prose (§171)", () => {
  it("draws narrate's prose as it streams, then puts the delivered card in its place, counting first prose from the draft", async () => {
    const { backend, drawn, open, close, call, card } = await fixture();
    try {
      await open("live-turn");
      await call("narrate", { text: prose });
      const drafts = drawn.filter(item => item.draft);
      expect(drafts.length).toBeGreaterThan(1);
      expect(new Set(drafts.map(item => item.id)).size).toBe(1);
      // It grows, it never shows a brace, and once the call is complete it holds the whole prose.
      for (let i = 1; i < drafts.length; i += 1) expect(drafts[i].marked!.startsWith(drafts[i - 1].marked!)).toBe(true);
      for (const item of drafts) expect(item.marked).not.toMatch(/[{}]/);
      expect(drafts.at(-1)!.marked).toBe(shown);
      const firstDraw = drafts[0].at;

      card("card-1", prose);
      const delivered = drawn.find(item => item.id === "card-1")!;
      expect(delivered.replacesDraft).toBe(drafts[0].id);
      const record = await close("live-turn");
      expect(record.firstProseVia).toBe("draft");
      const at = record.phases.find(item => item.name === "first_prose")!.at;
      expect(at).toBeGreaterThanOrEqual(firstDraw - 5);
      expect(at).toBeLessThan(delivered.at);
    } finally {
      await backend.close();
    }
  });

  it("reads apply's narrate past its effects, and follows no other tool", async () => {
    const { backend, drawn, open, close, call } = await fixture();
    try {
      await open("apply-turn");
      await call("look", { focus: "npc", name: "book-4-lars-williams" });
      expect(drawn.filter(item => item.draft)).toEqual([]);
      await call("apply", { effects: [{ kind: "person", who: "book-4-lars-williams", name: "棚下的加油站老板", why: "首次看见" }], narrate: prose });
      expect(drawn.filter(item => item.draft).at(-1)?.marked).toBe(shown);
      await close("apply-turn");
    } finally {
      await backend.close();
    }
  });

  it("keeps the draft when a refused delivery is resent unchanged, and replaces it in place when it is not", async () => {
    const { backend, drawn, rpc, open, close, call, card } = await fixture();
    try {
      await open("resend-turn");
      await call("narrate", { text: prose });
      const id = drawn.find(item => item.draft)!.id;
      const before = drawn.length;
      // The kernel refused it (no card); the Keeper sends the same prose again: the screen does not change.
      await call("narrate", { text: prose });
      expect(drawn.length).toBe(before);
      // A different text changes nothing while it streams and takes the draft's place once complete.
      const changed = "你熄了火，棚下没人抬头。";
      rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "c3", toolName: "narrate" } });
      rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify({ text: changed }).slice(0, 12) } });
      await sleep(80);
      expect(drawn.length).toBe(before);
      rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { type: "toolCall", id: "c3", name: "narrate", arguments: { text: changed } } } });
      expect(drawn.at(-1)).toMatchObject({ id, draft: true, marked: changed });
      card("card-2", changed);
      expect(drawn.at(-1)).toMatchObject({ id: "card-2", replacesDraft: id });
      await close("resend-turn");
    } finally {
      await backend.close();
    }
  });

  it("does not take a card with no prose for the delivery", async () => {
    const { backend, drawn, rpc, open, close, call } = await fixture();
    try {
      await open("roll-card-turn");
      await call("narrate", { text: prose });
      rpc({ type: "entry_appended", entry: { type: "custom", id: "roll-card", customType: "coc-mechanics", timestamp: new Date().toISOString(),
        data: { turn: 1, play_language: "zh-Hans", mechanics: [{ kind: "roll", receipt: "roll:x", visibility: "public", skill: "Spot Hidden", roll: 12, target: 50 }] } } });
      expect(drawn.find(item => item.id === "roll-card")?.replacesDraft).toBeUndefined();
      await close("roll-card-turn");
    } finally {
      await backend.close();
    }
  });

  it("draws a new table's delivery once setup hands off to play in the same child", async () => {
    const { backend, drawn, rpc, open, close, call } = await fixture("setup");
    try {
      await open("handoff-turn");
      rpc({ type: "entry_appended", entry: { type: "custom", customType: "coc-session", id: "rebind",
        data: { campaign: "campaign-1", home: root, play_language: "zh-Hans", mode: "play" } } });
      await call("narrate", { text: prose });
      expect(drawn.filter(item => item.draft).at(-1)?.marked).toBe(shown);
      await close("handoff-turn");
    } finally {
      await backend.close();
    }
  });

  it("draws nothing in a setup session", async () => {
    const { backend, drawn, open, close, call } = await fixture("setup");
    try {
      await open("setup-turn");
      await call("narrate", { text: prose });
      expect(drawn.filter(item => item.draft)).toEqual([]);
      await close("setup-turn");
    } finally {
      await backend.close();
    }
  });
});
