import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
import { turnTelemetryPath, type TurnTelemetryRecord } from "../src/turn-telemetry.js";

/**
 * Contract §233.11 supersedes §171's host argument previews: selected material remains private.
 *
 * Driven through the host's own reader (`rpcEvent`) with the event shapes Pi's RPC mode emits: a
 * `toolcall_start` that names the tool, raw JSON deltas, a `toolcall_end` with the parsed call, and
 * the kernel's accepted `coc-mechanics` card as the only story publication. Positive legacy grammar
 * streaming remains covered by live-prose.test.ts with an explicit test-only field mapping.
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

type Drawn = { id: string; replacesDraft?: string; draft: boolean; draftReplaced?: true; marked?: string; at: number };

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
      ...(details.draft_replaced === true ? { draftReplaced: true } : {}),
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
describe("PiHostBackend accepted delivery prose (§233.11)", () => {
  it("keeps streamed narrate materials private and publishes the accepted card once, counting first prose from publication", async () => {
    const { backend, drawn, open, close, call, card } = await fixture();
    try {
      await open("live-turn");
      await call("narrate", { text: prose });
      expect(drawn).toEqual([]);

      const publicationAt = Date.now();
      card("card-1", prose);
      expect(drawn).toHaveLength(1);
      const delivered = drawn.find(item => item.id === "card-1")!;
      expect(delivered).toMatchObject({ id: "card-1", draft: false, marked: prose });
      expect(delivered.replacesDraft).toBeUndefined();
      const record = await close("live-turn");
      expect(drawn).toHaveLength(1);
      expect(record.firstProseVia).toBe("mechanics");
      const phases = record.phases.filter(item => item.name === "first_prose");
      expect(phases).toHaveLength(1);
      expect(phases[0].at).toBeGreaterThanOrEqual(publicationAt);
      expect(phases[0].at).toBeLessThanOrEqual(delivered.at + 5);
      expect(record.phases.find(item => item.name === "first_stream")!.at).toBeLessThan(phases[0].at);
    } finally {
      await backend.close();
    }
  });

  it("never previews private narrate, apply, ask or output parameters, and follows no other tool", async () => {
    const { backend, drawn, open, close, call } = await fixture();
    try {
      await open("apply-turn");
      await call("look", { focus: "npc", name: "book-4-lars-williams" });
      expect(drawn).toEqual([]);
      await call("narrate", { text: prose });
      expect(drawn).toEqual([]);
      await call("apply", { effects: [{ kind: "person", who: "book-4-lars-williams", name: "棚下的加油站老板", why: "首次看见" }], narrate: prose });
      expect(drawn).toEqual([]);
      await call("ask", { text: prose, kind: "mechanics", options: ["accept", "push"] });
      expect(drawn).toEqual([]);
      await call("output", { text: prose });
      expect(drawn).toEqual([]);
      await call("output", { delivery: { version: 1, materials: [{ name: "candidate", text: prose, kind: "description", visibility: "player" }] } });
      expect(drawn).toEqual([]);
      const record = await close("apply-turn");
      expect(record).not.toHaveProperty("firstProseVia");
      expect(record.phases.some(item => item.name === "first_prose")).toBe(false);
    } finally {
      await backend.close();
    }
  });

  it("publishes no refused or resent candidate, including changed text, until an accepted card arrives", async () => {
    const { backend, drawn, rpc, open, close, call, card } = await fixture();
    try {
      await open("resend-turn");
      await call("output", { text: prose });
      rpc({ type: "tool_execution_end", toolCallId: "call-output", toolName: "output", isError: true,
        result: { content: [{ type: "text", text: "needs: publication refused" }], details: { coc_error: { code: "needs" } } } });
      expect(drawn).toEqual([]);
      // No accepted card exists: neither an identical retry nor a revised candidate is player prose.
      await call("output", { text: prose });
      expect(drawn).toEqual([]);
      const changed = "你熄了火，棚下没人抬头。";
      rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "c3", toolName: "output" } });
      rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify({ text: changed }).slice(0, 12) } });
      await sleep(80);
      expect(drawn).toEqual([]);
      rpc({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { type: "toolCall", id: "c3", name: "output", arguments: { text: changed } } } });
      expect(drawn).toEqual([]);
      card("card-2", changed);
      expect(drawn).toHaveLength(1);
      expect(drawn[0]).toMatchObject({ id: "card-2", draft: false, marked: changed });
      expect(drawn[0].replacesDraft).toBeUndefined();
      const record = await close("resend-turn");
      expect(drawn).toHaveLength(1);
      expect(record.firstProseVia).toBe("mechanics");
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

  it("keeps parameters private across setup-to-play handoff and draws the accepted delivery once in the same child", async () => {
    const { backend, drawn, rpc, open, close, call, card } = await fixture("setup");
    try {
      await open("handoff-turn");
      await call("narrate", { text: prose });
      expect(drawn).toEqual([]);
      rpc({ type: "entry_appended", entry: { type: "custom", customType: "coc-session", id: "rebind",
        data: { campaign: "campaign-1", home: root, play_language: "zh-Hans", mode: "play" } } });
      await call("narrate", { text: prose });
      expect(drawn).toEqual([]);
      await call("output", { text: prose });
      expect(drawn).toEqual([]);
      card("handoff-card", prose);
      expect(drawn).toHaveLength(1);
      expect(drawn[0]).toMatchObject({ id: "handoff-card", draft: false, marked: prose });
      expect(drawn[0].replacesDraft).toBeUndefined();
      const record = await close("handoff-turn");
      expect(drawn).toHaveLength(1);
      expect(record.firstProseVia).toBe("mechanics");
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
