import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawn } from "node:child_process";

import { createPiHostBackend } from "../src/index.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
const temps: string[] = [];

afterEach(async () => {
  while (temps.length) await rm(temps.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => undefined);
});

/**
 * §68: a live session answers with its own model, never with the host's
 * placeholder. `this.modelState` is seeded `provider: "unknown", name:
 * "Unknown", thinkingLevel: "off"`; returning it told the person their session
 * had no model and no thinking level, which is what the composer showed after a
 * provider error — 「Unknown / auto」, and the level they had chosen was gone.
 */
describe("a live session keeps its own model", () => {
  it("answers getModelState from the session, not from the host placeholder", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipiui-session-model-"));
    temps.push(root);
    const project = join(root, "workspace");
    const sessions = join(root, "sessions", "workspace");
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, "bound.jsonl"), [
      JSON.stringify({ type: "session", version: 3, id: "bound-session", timestamp: "2026-09-16T00:00:00.000Z", cwd: project }),
      JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-09-16T00:00:01.000Z", provider: "opencode-go", modelId: "deepseek-v4.1-flash" }),
      JSON.stringify({ type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: "2026-09-16T00:00:02.000Z", thinkingLevel: "low" }),
    ].join("\n") + "\n");

    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      runtimeAssets: { sourceRoot: runtimeSource },
      profileMode: "isolated",
      piPath: process.execPath,
      spawn: (_bin, _args, options) =>
        spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never,
    });
    try {
      // Make the session live: that is the branch that used to answer with the
      // host's placeholder instead of the session's own model.
      await backend.handle("sendPrompt", ["bound-session", "hello"]);
      const state = await backend.handle("getModelState", ["bound-session"]) as { model: { provider: string; id: string; name: string }; thinkingLevel: string };
      expect(state.model.provider).not.toBe("unknown");
      expect(state.model.id).not.toBe("unknown");
      expect(state.model.name).not.toBe("Unknown");
      expect(state.model.id).toBe("deepseek-v4.1-flash");
    } finally {
      await backend.close();
    }
  }, 30_000);
});
