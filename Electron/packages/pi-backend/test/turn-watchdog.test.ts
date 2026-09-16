import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, rm, stat, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend, TURN_WATCHDOG_TIMEOUT_MS } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

async function fixture(options: {
  stopEscalationDelays?: { termDescendantsMs: number; killDescendantsMs: number; killPiMs: number };
  env?: NodeJS.ProcessEnv;
} = {}) {
  root = await mkdtemp(join(tmpdir(), "pipi-watchdog-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  const sessionPath = join(directory, "s1.jsonl");
  await writeFile(sessionPath, [
    JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-17T00:00:00.000Z", cwd }),
    JSON.stringify({ type: "custom", customType: "coc-session", data: { campaign: "campaign-1", home: root, play_language: "zh-Hans", mode: "play" } }),
  ].join("\n") + "\n");
  const spawnEnvs: Array<NodeJS.ProcessEnv> = [];
  const backend = createPiHostBackend({
    ...options,
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, _args, spawnOptions) => {
      spawnEnvs.push(spawnOptions.env ?? {});
      return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], spawnOptions) as any;
    },
  });
  return { backend, sessionPath, spawnEnvs };
}

describe("turn watchdog (fix 3)", () => {
  it("triggers settle+drain when tail is assistant stop and turn silent >120s", async () => {
    const { backend, sessionPath } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));
    expect(statuses).toEqual(["started"]);

    // Enqueue a message that should be drained after watchdog settles
    const queued = await backend.handle("enqueueMessage", ["s1", "from-watchdog"]) as any;
    expect(queued.outcome).toBe("queued");

    // Make JSONL tail look terminal (assistant stop) so watchdog considers it eligible
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-stop", parentId: null,
      message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    // Force idle time >120s by backdating live's last activity
    const live = (backend as any).live.get("s1");
    expect(live).toBeTruthy();
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    // Trigger watchdog sweep directly
    await (backend as any).checkTurnWatchdogs();

    await eventually(() => statuses.includes("settled"));
    // After watchdog settle, queue should be drained (FIFO auto-drain, no age check)
    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).length === 0));
    expect(statuses.filter(s => s === "started").length).toBeGreaterThanOrEqual(2); // watchdog drain started next turn

    off();
    await backend.close();
  });

  it("aborts rather than counterfeit-settling when only a previous run has a terminal message", async () => {
    const { backend, sessionPath } = await fixture();
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "previous-stop", parentId: null,
      message: { role: "assistant", content: [{ type: "thinking", thinking: "previous run" }], stopReason: "stop", timestamp: Date.now() - 10_000 },
      timestamp: new Date(Date.now() - 10_000).toISOString(),
    }) + "\n");
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));
    const queued = await backend.handle("enqueueMessage", ["s1", "after-silent-provider"]) as any;
    expect(queued.outcome).toBe("queued");
    const live = (backend as any).live.get("s1");
    expect(live.turnStartedAt).toEqual(expect.any(Number));
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    await (backend as any).checkTurnWatchdogs();
    await eventually(() => statuses.includes("stopped"));
    // Automatic recovery is not a manual Stop: the real abort lifecycle may
    // release and drain the player's queued input, but the old terminal row is
    // never mislabeled as this run's successful settlement.
    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).length === 0));
    await eventually(() => statuses.filter(status => status === "started").length >= 2);

    off();
    await backend.close();
  });

  it("abandons a stale watchdog decision when provider activity resumes during tail I/O", async () => {
    const { backend } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));
    const live = (backend as any).live.get("s1");
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    let release!: (state: "other") => void;
    const tail = new Promise<"other">(resolve => { release = resolve; });
    const original = (backend as any).sessionTailTurnState.bind(backend);
    (backend as any).sessionTailTurnState = () => tail;
    const sweep = (backend as any).checkTurnWatchdogs();
    await new Promise(resolve => setTimeout(resolve, 10));
    (backend as any).touchTurnActivity(live);
    release("other");
    await sweep;
    (backend as any).sessionTailTurnState = original;

    expect(statuses).toEqual(["started"]);
    expect(live.hostAbortedTurn).toBe(false);
    expect((backend as any).queue.isBusy("s1")).toBe(true);

    off();
    await backend.close();
  });

  it("does not let message_end(error) release an armed watchdog turn before agent_settled", async () => {
    const { backend } = await fixture();
    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await new Promise(resolve => setTimeout(resolve, 50));
    const live = (backend as any).live.get("s1");
    live.watchdogRecoveryArmed = true;

    (backend as any).rpcEvent(live, {
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "abort transport ended" },
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(live.terminalEpoch).not.toBe(live.turnEpoch);
    expect((backend as any).queue.isBusy("s1")).toBe(true);

    live.watchdogRecoveryArmed = false;
    await backend.close();
  });

  it("carries a durable recovery handoff when abort escalation must replace Pi", async () => {
    const { backend, sessionPath, spawnEnvs } = await fixture({
      stopEscalationDelays: { termDescendantsMs: 10, killDescendantsMs: 10, killPiMs: 10 },
    });
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold_stuck__"]);
    await eventually(() => statuses.includes("started"));
    const queued = await backend.handle("enqueueMessage", ["s1", "after-forced-recovery"]) as any;
    expect(queued.outcome).toBe("queued");
    const live = (backend as any).live.get("s1");
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    await (backend as any).checkTurnWatchdogs();
    await eventually(() => spawnEnvs.length >= 2, 4_000);
    expect(spawnEnvs[1]?.PI_COC_WATCHDOG_RECOVERY).toBe("1");
    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).length === 0), 4_000);
    await eventually(() => statuses.filter(status => status === "started").length >= 2, 4_000);
    await expect(access(`${sessionPath}.coc-watchdog-recovery.json`)).resolves.toBeUndefined();

    off();
    await backend.close();
  });

  it("starts recovery after forced abort even when the player queued nothing else", async () => {
    const { backend, sessionPath, spawnEnvs } = await fixture({
      stopEscalationDelays: { termDescendantsMs: 10, killDescendantsMs: 10, killPiMs: 10 },
    });
    await backend.handle("sendPrompt", ["s1", "__hold_stuck__"]);
    // The fake acknowledges the prompt before its final same-chunk activity
    // events have all reached the backend. Backdate only after they drain.
    await new Promise(resolve => setTimeout(resolve, 50));
    const live = (backend as any).live.get("s1");
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    const firstPid = live.process.pid;
    await (backend as any).checkTurnWatchdogs();
    await eventually(() => spawnEnvs.length >= 2, 4_000);
    expect(spawnEnvs[1]?.PI_COC_WATCHDOG_RECOVERY).toBe("1");
    await expect(access(`${sessionPath}.coc-watchdog-recovery.json`)).resolves.toBeUndefined();

    let replacement: any;
    await eventually(() => {
      replacement = (backend as any).live.get("s1");
      return replacement?.process?.pid && replacement.process.pid !== firstPid;
    }, 4_000);
    replacement.process.kill();
    await eventually(() => spawnEnvs.length >= 3, 4_000);
    expect(spawnEnvs[2]?.PI_COC_WATCHDOG_RECOVERY).toBe("1");

    await backend.close();
  });

  it("retries when a replacement exits during refreshState initialization", async () => {
    const { backend, sessionPath, spawnEnvs } = await fixture({
      env: { FAKE_EXIT_DURING_WATCHDOG_RECOVERY: "1" },
      stopEscalationDelays: { termDescendantsMs: 10, killDescendantsMs: 10, killPiMs: 10 },
    });
    await backend.handle("sendPrompt", ["s1", "__hold_stuck__"]);
    await new Promise(resolve => setTimeout(resolve, 50));
    const live = (backend as any).live.get("s1");
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    await (backend as any).checkTurnWatchdogs();
    await eventually(() => spawnEnvs.length >= 3, 6_000);
    expect(spawnEnvs[1]?.PI_COC_WATCHDOG_RECOVERY).toBe("1");
    expect(spawnEnvs[2]?.PI_COC_WATCHDOG_RECOVERY).toBe("1");
    await expect(access(`${sessionPath}.coc-watchdog-recovery.json`)).resolves.toBeUndefined();

    await backend.close();
  }, 10_000);

  it("retries when a replacement exits during startup presentation catch-up", async () => {
    const { backend, spawnEnvs } = await fixture({
      stopEscalationDelays: { termDescendantsMs: 10, killDescendantsMs: 10, killPiMs: 10 },
    });
    await backend.handle("sendPrompt", ["s1", "__hold_stuck__"]);
    await new Promise(resolve => setTimeout(resolve, 50));
    const first = (backend as any).live.get("s1");
    const firstPid = first.process.pid;
    first.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    const replay = (backend as any).projectHostDeliveries.bind(backend);
    let interrupted = false;
    (backend as any).projectHostDeliveries = async (live: any, offset: number | undefined) => {
      if (!interrupted && live.process.pid !== firstPid) {
        interrupted = true;
        live.process.kill();
        await live.exit;
        return false;
      }
      return replay(live, offset);
    };

    await (backend as any).checkTurnWatchdogs();
    await eventually(() => spawnEnvs.length >= 3, 6_000);
    expect(interrupted).toBe(true);
    expect(spawnEnvs[2]?.PI_COC_WATCHDOG_RECOVERY).toBe("1");

    await backend.close();
  }, 10_000);

  it("does not trigger when tail is tool_use (long tool call in progress)", async () => {
    const { backend, sessionPath } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));

    // Two tools started; one result has already become the last message while
    // the other is still running. The JSONL tail alone no longer shows the
    // outstanding tool, so the current-epoch live pairing must protect it.
    await appendFile(sessionPath, [
      JSON.stringify({
        type: "message", id: "tail-tool", parentId: null,
        message: { role: "assistant", content: [
          { type: "tool_use", id: "tool-a", name: "bash", input: {} },
          { type: "tool_use", id: "tool-b", name: "bash", input: {} },
        ], stopReason: "toolUse", timestamp: Date.now() },
        timestamp: new Date().toISOString(),
      }),
      JSON.stringify({
        type: "message", id: "tool-a-result", parentId: "tail-tool",
        message: { role: "toolResult", toolCallId: "tool-a", content: [{ type: "text", text: "done" }], timestamp: Date.now() },
        timestamp: new Date().toISOString(),
      }),
    ].join("\n") + "\n");

    const live = (backend as any).live.get("s1");
    live.toolNames.set("tool-b", "bash");
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);

    await (backend as any).checkTurnWatchdogs();
    // Give it a tick
    await new Promise(r => setTimeout(r, 100));
    expect(statuses).toEqual(["started"]); // still not settled
    expect((backend as any).queue.isBusy("s1")).toBe(true);

    off();
    await backend.close();
  });

  it("releases a parked FIFO when Pi exits after the settle epoch has been overtaken", async () => {
    const { backend } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    await backend.handle("sendPrompt", ["s1", "__hold__"]);
    await eventually(() => statuses.includes("started"));
    const queued = await backend.handle("enqueueMessage", ["s1", "after-writer-exit"]) as any;
    expect(queued.outcome).toBe("queued");

    const live = (backend as any).live.get("s1");
    expect(live?.process?.pid).toEqual(expect.any(Number));
    // Mint a newer queue epoch without a real new turn. The close handler used
    // to pass the dead writer's epoch into notifyIdle, which then ignored the
    // idle and left turnActive set forever.
    (backend as any).queue.markBusy("s1");
    expect((backend as any).queue.isBusy("s1")).toBe(true);
    live.process.kill();

    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).every((item: any) => item.id !== queued.message.id)), 4_000);

    off();
    await backend.close();
  });

  it("drains a busy queue with no live writer when the JSONL tail is already terminal", async () => {
    const { backend, sessionPath } = await fixture();
    await backend.handle("getSessionHistory", ["s1"]);
    await backend.handle("listQueue", ["s1"]);
    (backend as any).queue.markBusy("s1");
    const queued = await backend.handle("enqueueMessage", ["s1", "orphan-busy"]) as any;
    expect(queued.outcome).toBe("queued");
    expect((backend as any).queue.isBusy("s1")).toBe(true);
    expect((backend as any).live.has("s1")).toBe(false);

    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-stop", parentId: null,
      message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    await (backend as any).checkTurnWatchdogs();
    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).length === 0));

    await backend.close();
  });

  it("releases a leaked queue gate when live is already terminal (settle's queue-side release was lost)", async () => {
    const { backend, sessionPath } = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(e => { if (e.channel === "stream" && e.event.type === "status") statuses.push(e.event.status); });

    // A normal completed turn: live projected terminal (epoch is fenced off),
    // so projectTurnTerminal can never run again for it.
    await backend.handle("sendPrompt", ["s1", "hello"]);
    await eventually(() => statuses.includes("settled"));

    // Durable terminal tail so the watchdog's tail gate passes.
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "tail-stop", parentId: null,
      message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");

    // The settle's queue-side release was lost: the FIFO still holds turnActive
    // even though live says no turn is open. Every later prompt parks forever.
    (backend as any).queue.markBusy("s1");
    const enqueued = await backend.handle("enqueueMessage", ["s1", "typed-behind-leak"]) as any;
    expect(enqueued.outcome).toBe("queued");

    const live = (backend as any).live.get("s1");
    expect(live).toBeTruthy();
    live.lastTurnActivityAt = Date.now() - (TURN_WATCHDOG_TIMEOUT_MS + 5_000);
    await (backend as any).checkTurnWatchdogs();

    // The leaked gate is released and the parked prompt drains as a new turn.
    await eventually(async () => ((await backend.handle("listQueue", ["s1"]) as any[]).length === 0));
    await eventually(() => statuses.filter(s => s === "started").length >= 2);

    off();
    await backend.close();
  });

  it("retains the earliest recovery offset across process replacement", async () => {
    const { backend, sessionPath } = await fixture();
    const presentations: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "presentation") presentations.push(event.event.entry);
    });
    await backend.handle("sendPrompt", ["s1", "hello"]);
    const live = (backend as any).live.get("s1");
    const offset = (await stat(sessionPath)).size;
    (backend as any).cocWatchdogPresentationOffsets.set(sessionPath, offset);
    const raw = {
      type: "custom_message", customType: "coc-delivery", display: true,
      id: "previous-replacement-delivery", parentId: null, timestamp: new Date().toISOString(),
      content: "The first replacement wrote this before it exited.",
      details: { coc_delivery: true, turn: 5, turn_unfinished: true },
    };
    await appendFile(sessionPath, `${JSON.stringify(raw)}\n`);
    live.process.kill();
    await live.exit;

    await backend.handle("sendPrompt", ["s1", "after-replacement"]);
    expect(presentations.filter(entry => entry.id === raw.id)).toHaveLength(1);
    expect((backend as any).cocWatchdogPresentationOffsets.has(sessionPath)).toBe(false);

    off();
    await backend.close();
  });

  it("replays a coc-delivery written before the startup event stream exactly once", async () => {
    const { backend, sessionPath } = await fixture();
    const presentations: any[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "presentation") presentations.push(event.event.entry);
    });
    await backend.handle("sendPrompt", ["s1", "hello"]);
    const live = (backend as any).live.get("s1");
    const offset = (await stat(sessionPath)).size;
    const raw = {
      type: "custom_message", customType: "coc-delivery", display: true,
      id: "startup-delivery", parentId: null, timestamp: new Date().toISOString(),
      content: "This turn ended without a delivered result.",
      details: { coc_delivery: true, turn: 5, turn_unfinished: true },
    };
    await appendFile(sessionPath, `${JSON.stringify(raw)}\n`);

    await (backend as any).projectHostDeliveries(live, offset);
    expect(presentations.filter(entry => entry.id === raw.id)).toHaveLength(1);
    // ...and the live arrival of that same row does not draw it a second time. This second half
    // used to be handed an `entry_appended` carrying a `custom_message`, which Pi has never
    // emitted (§55): it proved nothing, because no path could deliver the event it described.
    // A delivery arrives as a `message_end` carrying `role: "custom"` and no id, so this is the
    // arrival the dedupe actually has to survive. Wind the live read back over the row first:
    // otherwise the scan simply starts past it and the id set is never the thing being tested.
    live.presentationReadTo = offset;
    (backend as any).rpcEvent(live, { type: "message_end", message: {
      role: "custom", customType: raw.customType, content: raw.content,
      display: true, details: raw.details, timestamp: Date.now(),
    } });
    // Wait on the scan actually having run, not on a bare timeout: without this the "still one"
    // below would pass just as well if the live projection had never been reached at all.
    await eventually(() => (live.presentationReadTo ?? 0) > offset);
    expect(presentations.filter(entry => entry.id === raw.id)).toHaveLength(1);

    off();
    await backend.close();
  });

  it("isSessionTailTerminal distinguishes stop vs tool_use", async () => {
    const { backend, sessionPath } = await fixture();
    // Write stop tail
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "a1", parentId: null,
      message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");
    expect(await (backend as any).isSessionTailTerminal(sessionPath)).toBe(true);

    // Overwrite with tool_use tail (append, tool_use is now last)
    await appendFile(sessionPath, JSON.stringify({
      type: "message", id: "a2", parentId: null,
      message: { role: "assistant", content: [{ type: "tool_use", name: "bash" }], stopReason: "toolUse", timestamp: Date.now() },
      timestamp: new Date().toISOString(),
    }) + "\n");
    expect(await (backend as any).isSessionTailTerminal(sessionPath)).toBe(false);

    await backend.close();
  });
});
