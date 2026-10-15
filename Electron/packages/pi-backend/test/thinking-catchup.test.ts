import { afterEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

// kimi k3 and similar routes can persist a full reasoning block while streaming
// few or no thinking_delta events. message_end must diff the final thinking
// against what actually streamed and repair the missing suffix live — the same
// repair text already had.
describe.each(["base", "setup", "play"])("PiHostBackend thinking catch-up on message_end (mode: %s)", (mode) => {
  let root = "";
  afterEach(async () => {
    if (root) await (await import("node:fs/promises")).rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });
  const backendFor = async (label: string) => {
    root = await mkdtemp(join(tmpdir(), label));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(dir, "session.jsonl"), [
      JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
      ...(mode !== "base" ? [JSON.stringify({ type: "custom", id: "binding", parentId: null, customType: "coc-session", data: { campaign: "c1", home: root, play_language: "en", mode } })] : []),
    ].join("\n") + "\n");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      piPath: "node",
      spawn: (_bin, _args, options) =>
        spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], { ...options, env: { ...options.env, PATH: process.env.PATH ?? "" } }) as any,
    });
    await backend.handle("addProject", [cwd]);
    return backend;
  };
  const streamEvents = async (backend: any, message: string) => {
    const events: any[] = [];
    const off = backend.subscribe((e: any) => events.push(e));
    await backend.handle("sendPrompt", ["session-1", message]);
    await new Promise((r) => setTimeout(r, 20));
    off();
    return events.filter((e) => e.channel === "stream").map((e) => e.event);
  };

  it("repairs silent thinking: no thinking_delta streamed, yet message_end persists the block", async () => {
    const backend = await backendFor("pipi-pi-think-silent-");
    const events = await streamEvents(backend, "__silent_think__");
    await backend.close();
    const thinking = events.filter((e) => e.type === "thinking").map((e) => e.delta);
    expect(thinking).toEqual(["hidden reasoning"]);
    // The streamed text path is untouched by the thinking repair.
    expect(events.filter((e) => e.type === "text").map((e) => e.delta)).toEqual(mode === "play" ? [] : ["hello"]);
  });

  it("repairs a dropped thinking tail against the final block", async () => {
    const backend = await backendFor("pipi-pi-think-partial-");
    const events = await streamEvents(backend, "__partial_think__");
    await backend.close();
    const thinking = events.filter((e) => e.type === "thinking").map((e) => e.delta);
    expect(thinking).toEqual(["think", " more"]);
  });

  it("does not re-emit thinking that streamed intact", async () => {
    const backend = await backendFor("pipi-pi-think-healthy-");
    const events = await streamEvents(backend, "__healthy_think__");
    await backend.close();
    const thinking = events.filter((e) => e.type === "thinking").map((e) => e.delta);
    expect(thinking).toEqual(["all good"]);
  });

  it("restores original Thinking and its ordered activity without treating it as public prose", async () => {
    const backend = await backendFor("pipi-pi-think-history-");
    try {
      await appendFile(join(root, "sessions", "project", "session.jsonl"), JSON.stringify({
        type: "message", id: "thought", parentId: mode === "base" ? null : "binding",
        timestamp: "2026-08-10T00:00:01.000Z", message: { role: "assistant", content: [
          { type: "thinking", thinking: "The hidden culprit is downstairs. Keep this original thought inspectable." },
          { type: "text", text: "Unpublished private record" },
        ] },
      }) + "\n");
      const history = await backend.handle("getSessionHistory", ["session-1"]) as any[];
      const thought = history.find(entry => entry.id === "thought");
      expect(thought.thinking).toBe("The hidden culprit is downstairs. Keep this original thought inspectable.");
      expect(thought.activities).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "thinking", content: thought.thinking, contentIndex: 0 }),
      ]));
      expect(thought.content).toBe(mode === "play" ? "" : "Unpublished private record");
      if (mode === "play") expect(thought.activities.some((activity: any) => activity.type === "text")).toBe(false);
    } finally { await backend.close(); }
  });
});
