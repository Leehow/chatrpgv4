import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { StreamEvent } from "@pipi/host-api";
import { createPiHostBackend } from "../src/index.js";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("condition was not met before timeout");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pipi-coc-run-terminal-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(directory, { recursive: true }), mkdir(cwd, { recursive: true })]);
  const sessionPath = join(directory, "s1.jsonl");
  await writeFile(sessionPath, [
    { type: "session", version: 3, id: "s1", timestamp: "2026-10-14T00:00:00.000Z", cwd },
    { type: "custom", id: "binding", parentId: null, customType: "coc-session", data: { campaign: "c", home: root, play_language: "en", mode: "play" } },
  ].map(row => JSON.stringify(row)).join("\n") + "\n");
  const backend = createPiHostBackend({
    agentDir, sessionsRoot, runtimeRoot: root, piPath: process.execPath,
    env: { PATH: process.env.PATH ?? "", PIPIUI_TEST_SESSION_PATH: sessionPath },
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi-terminal-projection.mjs", import.meta.url).pathname], options) as any,
    authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
  });
  const events: StreamEvent[] = [];
  const off = backend.subscribe(event => {
    if (event.channel === "stream") events.push(event.event);
  });
  // This is the same RPC reader seam used by final-delivery.test.ts. The real
  // child owns get_state; neither reconciliation nor queue behavior is mocked.
  const rpc = (event: unknown) => (backend as any).rpcEvent((backend as any).live.get("s1"), event);
  const statuses = () => events.filter((event): event is Extract<StreamEvent, { type: "status" }> => event.type === "status").map(event => event.status);
  const queue = () => backend.handle("listQueue", ["s1"]) as Promise<Array<{ id: string; state: string }>>;
  const start = async (isStreaming: boolean) => {
    // Match prompt dispatch: restore FIFO before the agent_start boundary.
    expect(await queue()).toHaveLength(0);
    if (isStreaming) {
      await backend.handle("sendPrompt", ["s1", "tool-use-still-streaming"]);
      await eventually(() => statuses().includes("started"));
    } else {
      // Between two inferences Pi can report idle while the same game run is
      // open. Establish that run through its normal agent_start RPC event.
      await (backend as any).ensure("s1");
      rpc({ type: "agent_start" });
    }
    const state = await (backend as any).command("s1", { type: "get_state" });
    expect(state).toMatchObject({ isStreaming, pendingMessageCount: 0 });
    expect(statuses()).toEqual(["started"]);
  };
  const dispose = async () => {
    off();
    await backend.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  };
  return { backend, events, rpc, statuses, queue, start, dispose, sessionPath };
}

for (const isStreaming of [true, false]) {
  it(`keeps a rejected private stop inside the COC run when Pi streaming is ${isStreaming}`, async () => {
    const table = await fixture();
    try {
      await table.start(isStreaming);
      const message = {
        role: "assistant", stopReason: "stop", timestamp: Date.now(), responseId: "rejected-private-record",
        content: [{ type: "text", text: JSON.stringify({ version: 1, record: { effects: [{ kind: "scene", name: "Library", activity: { wakefulness: "awake" } }] }, text: "PRIVATE_REJECTED_PROSE" }) }],
      };
      await appendFile(table.sessionPath, JSON.stringify({ type: "message", id: "rejected", parentId: "binding", timestamp: new Date().toISOString(), message }) + "\n");
      expect(await readFile(table.sessionPath, "utf8")).toContain("PRIVATE_REJECTED_PROSE");
      table.rpc({ type: "message_end", message });
      const queued = await table.backend.handle("enqueueMessage", ["s1", "tool-use-still-streaming"]) as { outcome: string; message: { id: string } };
      expect(queued.outcome).toBe("queued");

      // The old durable-final fallback waits 100ms. It must not settle or
      // dispatch the player's next input during this same-run continuation.
      await delay(250);
      expect(table.statuses()).toEqual(["started"]);
      expect(await table.queue()).toEqual([expect.objectContaining({ id: queued.message.id, state: "queued" })]);

      table.rpc({ type: "message_start", message: { role: "assistant", content: [] } });
      const base = { version: 1, campaign: "c", turn: 1, worldline: "main", loop: 0, run: "same-run", input_revision: "input", delivery_id: "public", attempt_id: "accepted" };
      for (const [index, frame] of [
        { event: "start", status: "streaming" },
        { event: "delta", delta: "The librarian " },
        { event: "delta", delta: "answers your question." },
        { event: "end", status: "completed" },
      ].entries()) {
        const row = { type: "custom", customType: "coc-final-delivery", id: `public-${index}`, data: { ...base, ...frame, sequence: index + 1, timestamp: Date.now() } };
        table.rpc({ type: "entry_appended", entry: row });
        const delivered = table.events.filter(event => event.type === "final_delivery");
        expect(delivered).toHaveLength(index + 1);
        expect(table.statuses()).toEqual(["started"]);
      }
      expect(JSON.stringify(table.events)).not.toContain("PRIVATE_REJECTED_PROSE");
      expect(table.events.filter((event): event is Extract<StreamEvent, { type: "final_delivery" }> => event.type === "final_delivery").map(event => event.frame.delta ?? "").join("")).toBe("The librarian answers your question.");
      expect(await table.queue()).toEqual([expect.objectContaining({ id: queued.message.id, state: "queued" })]);

      table.rpc({ type: "agent_settled" });
      table.rpc({ type: "agent_settled" });
      expect(table.statuses()).toEqual(["started", "settled"]);
      await eventually(async () => (await table.queue()).length === 0);
      await eventually(() => table.statuses().filter(status => status === "started").length === 2);
      expect(table.statuses().filter(status => status === "settled")).toHaveLength(1);
    } finally { await table.dispose(); }
  });
}

for (const terminal of ["provider error", "explicit stop"] as const) {
  it(`still releases a private-play run on ${terminal}`, async () => {
    const table = await fixture();
    try {
      await table.start(true);
      if (terminal === "provider error") {
        table.rpc({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Provider unavailable" } });
        expect(table.events).toContainEqual(expect.objectContaining({ type: "error", content: "Provider unavailable" }));
      } else {
        table.rpc({ type: "agent_stopped" });
      }
      expect(table.statuses()).toEqual(["started", "stopped"]);
      await table.backend.handle("enqueueMessage", ["s1", "tool-use-still-streaming"]);
      // Terminal projection precedes asynchronous FIFO idle. Either initial
      // enqueue result is valid; the next prompt must actually drain.
      await eventually(() => table.statuses().filter(status => status === "started").length === 2);
      expect(await table.queue()).toHaveLength(0);
      expect(table.statuses().filter(status => status === "stopped")).toHaveLength(1);
    } finally { await table.dispose(); }
  });
}
