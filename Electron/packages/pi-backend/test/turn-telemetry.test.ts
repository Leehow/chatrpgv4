import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createTurnTelemetry,
  sanitizeRendererTurnTelemetry,
  serializeTurnTelemetryRecord,
  TURN_TELEMETRY_MAX_RECORD_BYTES,
  turnTelemetryBackupPath,
  turnTelemetryPath,
  type TurnTelemetryRecord,
} from "../src/turn-telemetry.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function rows(text: string): TurnTelemetryRecord[] {
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as TurnTelemetryRecord);
}

async function readRows(path: string): Promise<TurnTelemetryRecord[]> {
  try {
    return rows(await readFile(path, "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function finishPerformanceTurn(
  telemetry: ReturnType<typeof createTurnTelemetry>,
  sessionId: string,
  clock: { value: number },
  outputTokens = 20,
): void {
  telemetry.beginDispatch(sessionId, undefined);
  telemetry.dispatchStarted(sessionId);
  clock.value += 1;
  telemetry.observeRpc(sessionId, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "token" },
  });
  clock.value += 1;
  telemetry.observeRpc(sessionId, {
    type: "message_end",
    message: { role: "assistant", usage: { input: 10, output: outputTokens } },
  });
  telemetry.terminal(sessionId, "settled");
  telemetry.flushTerminal(sessionId);
}

describe("turn telemetry", () => {
  it("traces direct and queued turns with one safe id each and ordered observable phases", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-"));
    let now = 10;
    let resources = 0;
    const telemetry = createTurnTelemetry({
      agentDir: root,
      now: () => now,
      resourceSample: () => ({ rssBytes: 1_000 + ++resources, childCount: 1 }),
    });

    const complete = (turnId: string, queued: boolean) => {
      const sample = telemetry.rendererSubmission("session-1", {
        turnId,
        submittedAt: 1,
        preflightStartedAt: 2,
        preflightEndedAt: 5,
        promptBytes: 17,
        attachmentCount: 1,
        attachmentBytes: 3,
        documentCount: 1,
        prompt: "very sensitive prompt body",
      });
      expect(sample?.turnId).toBe(turnId);
      if (queued) {
        now = 20;
        telemetry.markQueued(sample);
      }
      now = queued ? 30 : 20;
      telemetry.beginDispatch("session-1", sample);
      now += 2;
      telemetry.preparationComplete("session-1", 123);
      now += 2;
      telemetry.dispatchStarted("session-1");
      now += 1;
      telemetry.dispatchAccepted("session-1");
      now += 1;
      telemetry.observeRpc("session-1", { type: "agent_start" });
      now += 2;
      telemetry.observeRpc("session-1", {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning body" },
      });
      now += 3;
      telemetry.observeRpc("session-1", {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "first visible token" },
      });
      now += 1;
      telemetry.observeRpc("session-1", {
        type: "tool_execution_start",
        toolCallId: "tool-a",
        toolName: "read",
        args: { path: "/private/document/path" },
      });
      now += 1;
      telemetry.observeRpc("session-1", {
        type: "tool_execution_end",
        toolCallId: "tool-a",
        result: { content: "tool result secret body" },
        isError: false,
      });
      now += 4;
      telemetry.observeRpc("session-1", {
        type: "message_end",
        message: {
          role: "assistant",
          content: "final assistant body",
          usage: { input: 120, output: 20 },
        },
      });
      now += 1;
      telemetry.observeSessionStats("session-1", { contextTokens: 4_096, contextWindow: 32_768 });
      telemetry.terminal("session-1", "settled");
      telemetry.flushTerminal("session-1");
    };

    complete("direct-turn", false);
    complete("queued-turn", true);
    await telemetry.pending();

    const stored = await readRows(turnTelemetryPath(root));
    expect(stored.map((row) => row.turnId)).toEqual(["direct-turn", "queued-turn"]);
    for (const row of stored) {
      const times = row.phases.map((phase) => phase.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(row.phases.map((phase) => phase.name)).toEqual(expect.arrayContaining([
        "renderer_submit", "renderer_preflight_start", "renderer_preflight_end",
        "host_received", "host_preparation_start", "host_preparation_end",
        "pi_dispatch", "first_stream", "first_thinking", "first_text",
        "first_assistant", "tool_activity", "settled",
      ]));
      expect(row.metrics).toMatchObject({
        promptBytes: 17,
        attachmentCount: 1,
        attachmentBytes: 3,
        documentCount: 1,
        piRpcBytes: 123,
        assistantMessageCount: 1,
        toolResultCount: 1,
        inputTokens: 120,
        outputTokens: 20,
        contextTokens: 4_096,
        contextWindow: 32_768,
      });
      expect(row.durations?.rendererPreflightMs).toBe(3);
      expect(row.durations?.ttftMs).toBeGreaterThan(0);
      expect(row.performance?.tokensPerSecond).toBeGreaterThan(0);
      expect(row.resources?.start?.rssBytes).toEqual(expect.any(Number));
      expect(row.resources?.end?.childCount).toBe(1);
    }
    expect(stored[0]!.phases.some((phase) => phase.name === "host_queued")).toBe(false);
    expect(stored[1]!.phases.map((phase) => phase.name)).toContain("host_queued");
    expect(stored[1]!.durations?.hostQueueMs).toBeGreaterThan(0);
    expect(telemetry.sessionPerformance("session-1")).toMatchObject({
      ttftMs: expect.any(Number),
      tokensPerSecond: expect.any(Number),
      sampleCount: 2,
    });

    const raw = await readFile(turnTelemetryPath(root), "utf8");
    expect(raw).not.toMatch(/very sensitive prompt body|private reasoning body|tool result secret body|private\/document\/path/);
  });

  it("omits unavailable samples instead of filling zeros or inferred performance", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-missing-"));
    let now = 1;
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => now });
    telemetry.beginDispatch("no-evidence", undefined);
    now += 1;
    telemetry.preparationComplete("no-evidence", 10);
    now += 1;
    telemetry.dispatchStarted("no-evidence");
    now += 1;
    telemetry.terminal("no-evidence", "stopped");
    telemetry.flushTerminal("no-evidence");
    await telemetry.pending();

    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.outcome).toBe("stopped");
    expect(record!.durations).not.toHaveProperty("ttftMs");
    expect(record!.durations).not.toHaveProperty("generationMs");
    expect(record!.metrics).not.toHaveProperty("inputTokens");
    expect(record!.metrics).not.toHaveProperty("contextTokens");
    expect(record!.performance).toBeUndefined();
    expect(telemetry.sessionPerformance("no-evidence")).toBeUndefined();
  });

  it("projects a real TTFT-only sample without inventing a token rate", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-ttft-only-"));
    const clock = { value: 10 };
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => clock.value });
    finishPerformanceTurn(telemetry, "ttft-only", clock, 0);
    await telemetry.pending();

    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.performance).toMatchObject({ ttftMs: 1 });
    expect(record!.performance).not.toHaveProperty("tokensPerSecond");
    expect(telemetry.sessionPerformance("ttft-only")).toEqual({ ttftMs: 1, sampleCount: 1 });
  });

  it("evicts the oldest inactive session aggregate at the global cap", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-eviction-"));
    const clock = { value: 10 };
    const telemetry = createTurnTelemetry({
      agentDir: root,
      now: () => clock.value,
      maxPerformanceSessions: 2,
    });
    finishPerformanceTurn(telemetry, "old", clock);
    finishPerformanceTurn(telemetry, "middle", clock);
    finishPerformanceTurn(telemetry, "new", clock);

    expect(telemetry.sessionPerformance("old")).toBeUndefined();
    expect(telemetry.sessionPerformance("middle")).toMatchObject({ sampleCount: 1 });
    expect(telemetry.sessionPerformance("new")).toMatchObject({ sampleCount: 1 });
    await telemetry.pending();
  });

  it("protects a session with an in-flight turn from global eviction", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-active-"));
    const clock = { value: 10 };
    const telemetry = createTurnTelemetry({
      agentDir: root,
      now: () => clock.value,
      maxPerformanceSessions: 2,
    });
    finishPerformanceTurn(telemetry, "protected", clock);
    finishPerformanceTurn(telemetry, "evicted", clock);
    telemetry.beginDispatch("protected", undefined);
    finishPerformanceTurn(telemetry, "new", clock);
    finishPerformanceTurn(telemetry, "newest", clock);

    expect(telemetry.sessionPerformance("protected")).toMatchObject({ sampleCount: 1 });
    expect(telemetry.sessionPerformance("new")).toBeUndefined();
    expect(telemetry.sessionPerformance("newest")).toMatchObject({ sampleCount: 1 });
    telemetry.terminal("protected", "stopped");
    telemetry.flushTerminal("protected");
    await telemetry.pending();
  });

  it("bounds retained records by rotating the current telemetry file", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-retention-"));
    let now = 1;
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => now, maxBytes: 1 });
    for (const id of ["one", "two", "three"]) {
      telemetry.beginDispatch("retention", undefined);
      now += 1;
      telemetry.preparationComplete("retention", 1);
      now += 1;
      telemetry.dispatchStarted("retention");
      now += 1;
      telemetry.terminal("retention", "settled");
      telemetry.flushTerminal("retention");
      now += 1;
      await telemetry.pending();
    }
    const retained = [
      ...(await readRows(turnTelemetryPath(root))),
      ...(await readRows(turnTelemetryBackupPath(root))),
    ];
    expect(retained).toHaveLength(2);
  });

  it("fences an in-flight turn without fabricating TTFT/TPS and ignores late events", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-fence-"));
    let now = 10;
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => now });
    telemetry.beginDispatch("s1", undefined);
    now += 5;
    expect(telemetry.hasActive("s1")).toBe(true);
    telemetry.fenceSession("s1");
    await telemetry.pending();

    expect(telemetry.hasActive("s1")).toBe(false);
    expect(telemetry.sessionPerformance("s1")).toBeUndefined();
    expect(telemetry.retainedState()).toMatchObject({ active: 0, fenced: 1, performance: 0 });
    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.outcome).toBe("stopped");
    expect(record!.performance).toBeUndefined();
    expect(record!.durations).not.toHaveProperty("ttftMs");
    expect(record!.durations).not.toHaveProperty("tokensPerSecond");

    telemetry.beginDispatch("s1", undefined);
    telemetry.observeRpc("s1", {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "late" },
    });
    telemetry.terminal("s1", "settled");
    telemetry.flushTerminal("s1");
    await telemetry.pending();
    expect(telemetry.hasActive("s1")).toBe(false);
    expect(telemetry.sessionPerformance("s1")).toBeUndefined();
    expect(await readRows(turnTelemetryPath(root))).toHaveLength(1);

    telemetry.reclaimSession("s1");
    expect(telemetry.retainedState().fenced).toBe(0);
    telemetry.beginDispatch("s1", undefined);
    expect(telemetry.hasActive("s1")).toBe(true);
    telemetry.terminal("s1", "stopped");
    telemetry.flushTerminal("s1");
    await telemetry.pending();
  });

  it("rejects malformed renderer input rather than using it as a payload channel", () => {
    expect(sanitizeRendererTurnTelemetry({
      turnId: "../../not-a-turn",
      submittedAt: 1,
      prompt: "secret",
    })).toBeUndefined();
    expect(sanitizeRendererTurnTelemetry({
      turnId: "safe-turn",
      submittedAt: 10,
      preflightStartedAt: 9,
      preflightEndedAt: 11,
      headers: { authorization: "secret" },
    })).toEqual({ turnId: "safe-turn", submittedAt: 10 });
  });
});

/**
 * Contract §135.11.5 (SL-94): `first_prose`, `durations.firstProseMs` and `firstProseVia` say when the
 * player first saw the turn's prose. The backend classifies what it streams (`first-prose.ts`); these
 * tests pin what the recorder does with each arrival.
 */
describe("turn telemetry: the first prose the player sees", () => {
  function openTurn(sessionId: string, clock: { value: number }, telemetry: ReturnType<typeof createTurnTelemetry>) {
    telemetry.beginDispatch(sessionId, undefined);
    telemetry.preparationComplete(sessionId, 10);
    clock.value += 1;
    telemetry.dispatchStarted(sessionId);
    clock.value += 1;
    telemetry.dispatchAccepted(sessionId);
    telemetry.observeRpc(sessionId, { type: "agent_start" });
    clock.value += 2;
    // The narrate call streams first: TTFT is this, never the prose.
    telemetry.observeRpc(sessionId, { type: "message_update", assistantMessageEvent: { type: "toolcall_start" } });
  }
  const phase = (record: TurnTelemetryRecord, name: string) => record.phases.find((item) => item.name === name)?.at;

  it("records the earliest prose with its road beside the durations, and a later arrival never moves it", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-prose-first-"));
    const clock = { value: 100 };
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => clock.value });
    openTurn("s", clock, telemetry);
    clock.value = 130;
    telemetry.observeProse("s", { kind: "prose", via: "mechanics" });
    clock.value = 150;
    telemetry.observeProse("s", { kind: "prose", via: "host" });
    clock.value = 160;
    telemetry.observeProse("s", { kind: "text_replace", prose: true });
    clock.value = 170;
    telemetry.observeProse("s", { kind: "text" });
    telemetry.settleText("s");
    clock.value = 180;
    telemetry.terminal("s", "settled");
    telemetry.flushTerminal("s");
    await telemetry.pending();

    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.firstProseVia).toBe("mechanics");
    expect(record!.durations?.firstProseMs).toBe(130 - 100);
    expect(phase(record!, "first_prose")).toBe(130);
    expect(record!.phases.filter((item) => item.name === "first_prose")).toHaveLength(1);
    // TTFT is the first provider stream event, as before: the tool call at 104, not the prose.
    expect(record!.durations?.ttftMs).toBe(phase(record!, "first_stream")! - phase(record!, "pi_dispatch")!);
    expect(record!.durations?.ttftMs).toBe(3);
    expect(record!.performance?.ttftMs).toBe(3);
  });

  it("counts a kept text from its first delta, even when its message ends after a card", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-prose-kept-"));
    const clock = { value: 100 };
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => clock.value });
    openTurn("s", clock, telemetry);
    clock.value = 120;
    telemetry.observeProse("s", { kind: "text" });
    clock.value = 125;
    // A later delta of the same message does not move its start.
    telemetry.observeProse("s", { kind: "text" });
    clock.value = 140;
    telemetry.observeProse("s", { kind: "prose", via: "mechanics" });
    clock.value = 160;
    telemetry.settleText("s");
    telemetry.terminal("s", "settled");
    telemetry.flushTerminal("s");
    await telemetry.pending();

    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.firstProseVia).toBe("text");
    expect(record!.durations?.firstProseMs).toBe(20);
    expect(phase(record!, "first_prose")).toBe(120);
  });

  it("counts a replaced text at its replacement, and a text replaced by nothing never", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-prose-replaced-"));
    const clock = { value: 100 };
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => clock.value });
    // Replaced by nothing: the Keeper's words beside a tool call leave with the message.
    openTurn("dropped", clock, telemetry);
    clock.value = 110;
    telemetry.observeProse("dropped", { kind: "text" });
    clock.value = 120;
    telemetry.observeProse("dropped", { kind: "text_replace", prose: false });
    telemetry.settleText("dropped");
    // Replaced by prose: counts at the replacement, not at the draft's first delta.
    clock.value = 130;
    telemetry.observeProse("dropped", { kind: "text" });
    clock.value = 145;
    telemetry.observeProse("dropped", { kind: "text_replace", prose: true });
    telemetry.settleText("dropped");
    clock.value = 150;
    telemetry.terminal("dropped", "settled");
    telemetry.flushTerminal("dropped");
    await telemetry.pending();

    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.firstProseVia).toBe("text");
    expect(phase(record!, "first_prose")).toBe(145);
    expect(record!.durations?.firstProseMs).toBe(45);
  });

  it("leaves all three fields out of a turn that put no prose on screen, never 0", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-prose-none-"));
    const clock = { value: 100 };
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => clock.value });
    openTurn("s", clock, telemetry);
    clock.value = 110;
    telemetry.observeProse("s", { kind: "text" });
    telemetry.observeProse("s", { kind: "text_replace", prose: false });
    telemetry.settleText("s");
    clock.value = 120;
    // A delta whose message never ended is not known to be kept.
    telemetry.observeProse("s", { kind: "text" });
    telemetry.observeProse("s", undefined);
    telemetry.terminal("s", "stopped");
    telemetry.flushTerminal("s");
    await telemetry.pending();

    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.durations).not.toHaveProperty("firstProseMs");
    expect(record).not.toHaveProperty("firstProseVia");
    expect(record!.phases.map((item) => item.name)).not.toContain("first_prose");
    expect(record!.durations?.turnMs).toBe(20);
  });

  it("holds a settled turn's record for a host delivery still being projected, then writes its prose", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-prose-hold-"));
    const clock = { value: 100 };
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => clock.value });
    openTurn("s", clock, telemetry);
    let land!: () => void;
    const projection = new Promise<void>((resolve) => { land = resolve; });
    telemetry.holdForProse("s", projection);
    clock.value = 140;
    // The settle behind the §8 fallback arrives before the projection reaches the renderer.
    telemetry.terminal("s", "settled");
    telemetry.flushTerminal("s");
    await telemetry.pending();
    expect(await readRows(turnTelemetryPath(root))).toEqual([]);
    expect(telemetry.hasActive("s")).toBe(true);

    clock.value = 150;
    telemetry.observeProse("s", { kind: "prose", via: "host" });
    land();
    await projection;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await telemetry.pending();
    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.firstProseVia).toBe("host");
    expect(record!.durations?.firstProseMs).toBe(50);
    // The prose landed after the settle, and the record says so rather than hiding it.
    expect(record!.durations?.turnMs).toBe(40);
    expect(telemetry.hasActive("s")).toBe(false);
  });

  it("bounds the hold, so a projection that never lands cannot keep the record back", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-prose-hold-bound-"));
    const clock = { value: 100 };
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => clock.value, proseHoldMs: 20 });
    openTurn("bounded", clock, telemetry);
    telemetry.holdForProse("bounded", new Promise(() => undefined));
    telemetry.terminal("bounded", "settled");
    telemetry.flushTerminal("bounded");
    await telemetry.pending();
    expect(await readRows(turnTelemetryPath(root))).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await telemetry.pending();
    const [record] = await readRows(turnTelemetryPath(root));
    expect(record!.outcome).toBe("settled");
    expect(record).not.toHaveProperty("firstProseVia");
    expect(telemetry.retainedState()).toMatchObject({ active: 0 });
  });

  it("gives a host placement projected after the next dispatch to the turn that placed it, never to the new one", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-prose-displaced-"));
    const clock = { value: 100 };
    const telemetry = createTurnTelemetry({ agentDir: root, now: () => clock.value });
    const placedBy = telemetry.rendererSubmission("s", { turnId: "placed-by", submittedAt: 99 });
    telemetry.beginDispatch("s", placedBy);
    telemetry.dispatchStarted("s");
    let land!: () => void;
    const projection = new Promise<void>((resolve) => { land = resolve; });
    clock.value = 120;
    telemetry.holdForProse("s", projection);
    telemetry.terminal("s", "settled");
    telemetry.flushTerminal("s");

    // A queued message is dispatched before the projection reaches the renderer.
    clock.value = 125;
    const next = telemetry.rendererSubmission("s", { turnId: "next-turn", submittedAt: 124 });
    telemetry.beginDispatch("s", next);
    expect(telemetry.hasActive("s")).toBe(true);
    expect(telemetry.retainedState()).toMatchObject({ active: 2 });
    clock.value = 130;
    telemetry.observeProse("s", { kind: "prose", via: "host" });
    land();
    await projection;
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.value = 170;
    telemetry.observeProse("s", { kind: "prose", via: "mechanics" });
    telemetry.terminal("s", "settled");
    telemetry.flushTerminal("s");
    await telemetry.pending();

    const rows = await readRows(turnTelemetryPath(root));
    expect(rows.map((row) => row.turnId)).toEqual(["placed-by", "next-turn"]);
    expect(rows[0]!.firstProseVia).toBe("host");
    expect(rows[0]!.durations?.firstProseMs).toBe(30);
    expect(rows[1]!.firstProseVia).toBe("mechanics");
    expect(rows[1]!.durations?.firstProseMs).toBe(45);
    expect(telemetry.retainedState()).toMatchObject({ active: 0 });
  });

  it("writes firstProseVia only as one of its three words, and keeps a maximal record inside 4 KB", async () => {
    const base = { v: 2 as const, turnId: "safe-turn", outcome: "settled" as const, phases: [], durations: { firstProseMs: 5 } };
    for (const via of ["mechanics", "host", "text"] as const) {
      expect(JSON.parse(serializeTurnTelemetryRecord({ ...base, firstProseVia: via })).firstProseVia).toBe(via);
    }
    const forged = JSON.parse(serializeTurnTelemetryRecord({ ...base, firstProseVia: "the prose itself" as any }));
    expect(forged).not.toHaveProperty("firstProseVia");
    // The renderer cannot supply either field.
    expect(sanitizeRendererTurnTelemetry({ turnId: "safe-turn", submittedAt: 1, firstProseMs: 1, firstProseVia: "host" }))
      .toEqual({ turnId: "safe-turn", submittedAt: 1 });

    root = await mkdtemp(join(tmpdir(), "pipi-turn-telemetry-prose-bound-"));
    const clock = { value: 1_000_000_000_000 };
    const telemetry = createTurnTelemetry({
      agentDir: root,
      now: () => clock.value,
      resourceSample: () => ({ rssBytes: Number.MAX_SAFE_INTEGER, childCount: Number.MAX_SAFE_INTEGER }),
    });
    const sample = telemetry.rendererSubmission("max", {
      turnId: "t".repeat(64), submittedAt: clock.value - 10, preflightStartedAt: clock.value - 9, preflightEndedAt: clock.value - 8,
      promptBytes: Number.MAX_SAFE_INTEGER, attachmentCount: Number.MAX_SAFE_INTEGER,
      attachmentBytes: Number.MAX_SAFE_INTEGER, documentCount: Number.MAX_SAFE_INTEGER,
    });
    clock.value += 1;
    telemetry.markQueued(sample);
    clock.value += 1;
    telemetry.beginDispatch("max", sample);
    telemetry.preparationComplete("max", Number.MAX_SAFE_INTEGER);
    telemetry.dispatchStarted("max");
    telemetry.dispatchAccepted("max");
    const events = [
      { type: "agent_start" },
      { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } },
      { type: "tool_execution_end" },
      { type: "message_end", message: { role: "assistant", usage: { input: Number.MAX_SAFE_INTEGER, output: Number.MAX_SAFE_INTEGER }, stopReason: "error" } },
    ];
    for (const event of events) {
      clock.value += 1_000_000;
      telemetry.observeRpc("max", event);
    }
    telemetry.observeSessionStats("max", { contextTokens: Number.MAX_SAFE_INTEGER, contextWindow: Number.MAX_SAFE_INTEGER });
    clock.value += 1_000_000;
    telemetry.observeProse("max", { kind: "prose", via: "mechanics" });
    clock.value += 1_000_000;
    telemetry.terminal("max", "settled");
    telemetry.flushTerminal("max");
    await telemetry.pending();
    const line = (await readFile(turnTelemetryPath(root), "utf8")).trim();
    const record = JSON.parse(line) as TurnTelemetryRecord;
    expect(record.firstProseVia).toBe("mechanics");
    expect(record.phases.map((item) => item.name)).toContain("first_prose");
    expect(record.phases.length).toBeGreaterThanOrEqual(17);
    expect(Buffer.byteLength(line + "\n", "utf8")).toBeLessThanOrEqual(TURN_TELEMETRY_MAX_RECORD_BYTES);
  });
});
