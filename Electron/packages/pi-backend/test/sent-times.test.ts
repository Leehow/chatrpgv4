import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
import { PendingSends, readSentTimes, recordSentTime, sentTimesPath } from "../src/sent-times.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-sent-times-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  const sessionPath = join(directory, "s1.jsonl");
  await writeFile(sessionPath, JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-10-01T00:00:00.000Z", cwd }) + "\n");
  const backend = createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname, ..._args], options) as any,
  });
  return { backend, sessionPath };
}

describe("PendingSends (contract §164)", () => {
  it("gives an echo the oldest send whose text it contains, once", () => {
    const sends = new PendingSends();
    sends.begin("s", "推开门", 100);
    sends.begin("s", "推开门", 200);
    expect(sends.take("s", "[document]\n\n推开门")).toBe(100);
    expect(sends.take("s", "推开门")).toBe(200);
    expect(sends.take("s", "推开门")).toBeUndefined();
  });

  it("matches nothing for a message the host never dispatched", () => {
    const sends = new PendingSends();
    sends.begin("s", "推开门", 100);
    expect(sends.take("s", "[subagent-done] agentId=a1")).toBeUndefined();
    expect(sends.take("other", "推开门")).toBeUndefined();
    expect(sends.take("s", "推开门")).toBe(100);
  });

  it("forgets a dropped send and an empty one", () => {
    const sends = new PendingSends();
    expect(sends.begin("s", "  ", 100)).toBeUndefined();
    sends.drop("s", sends.begin("s", "推开门", 100));
    expect(sends.take("s", "推开门")).toBeUndefined();
  });
});

describe("the side file (contract §164)", () => {
  it("reads back what was recorded and skips a torn line", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-sent-times-"));
    const session = join(root, "s.jsonl");
    await recordSentTime(session, 1_790_000_000_500, 1_790_000_000_000);
    await writeFile(sentTimesPath(session), (await readFile(sentTimesPath(session), "utf8")) + '{"m":17', "utf8");
    expect([...await readSentTimes(session)]).toEqual([[1_790_000_000_500, 1_790_000_000_000]]);
    expect((await readSentTimes(join(root, "missing.jsonl"))).size).toBe(0);
  });
});

describe("the host's start on a player message (contract §164)", () => {
  it("streams it on the echo and reads it back from history, before Pi's own stamp", async () => {
    const { backend, sessionPath } = await fixture();
    const echoes: any[] = [];
    const off = backend.subscribe(event => { if (event.channel === "stream" && event.event.type === "user_message") echoes.push(event.event); });
    const before = Date.now();
    await backend.handle("sendPrompt", ["s1", "__echo_user_late__ 推开门"]);
    await eventually(() => echoes.length > 0);
    await eventually(() => existsSync(sentTimesPath(sessionPath)));
    off();
    const sentAt = echoes[0].sentAt;
    expect(sentAt).toBeGreaterThanOrEqual(before);
    const history = await backend.handle("getSessionHistory", ["s1"]) as any[];
    const user = history.find(entry => entry.role === "user");
    expect(user.sentAt).toBe(sentAt);
    // Pi stamped the message 300 ms after the host took it; the wait starts at the host.
    expect(user.timestamp - sentAt).toBeGreaterThanOrEqual(250);
    await backend.close();
  });

  it("gives no start to a user message the host never dispatched", async () => {
    const { backend } = await fixture();
    const echoes: any[] = [];
    const off = backend.subscribe(event => { if (event.channel === "stream" && event.event.type === "user_message") echoes.push(event.event); });
    await backend.handle("sendPrompt", ["s1", "__user_followup__"]);
    await eventually(() => echoes.length > 0);
    off();
    expect(echoes[0].content).toContain("[subagent-done]");
    expect(echoes[0].sentAt).toBeUndefined();
    await backend.close();
  });

  it("removes the side file with the session", async () => {
    const { backend, sessionPath } = await fixture();
    await backend.handle("sendPrompt", ["s1", "__echo_user__ 推开门"]);
    await eventually(() => existsSync(sentTimesPath(sessionPath)));
    await backend.handle("deleteSession", ["s1"]);
    expect(existsSync(sentTimesPath(sessionPath))).toBe(false);
    await backend.close();
  });
});
