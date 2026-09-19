import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";
import { extensionSettingsEnvName } from "../src/spawn-assembly.js";
import { listSecretMeta } from "../src/secret-vault.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const fakePi = new URL("./fake-pi-invoke.mjs", import.meta.url).pathname;

type ExtResult = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

async function writeManifest(dir: string, body: unknown) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "pipiui-extension.json"), `${JSON.stringify(body, null, 2)}\n`);
}

function invokeAgentManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoke-agent",
    name: "Invoke Agent",
    version: "1.0.0",
    agent: { extension: "agent/index.js", skills: ["agent/skills"] },
    app: {
      settings: {
        scope: "app",
        schema: {
          type: "object",
          properties: {
            "ext.invoke-agent.flag": { type: "boolean" },
            "ext.invoke-agent.token": { type: "string", format: "secret" },
          },
        },
      },
    },
    capabilities: ["invoke.agent", "settings.read", "settings.write"],
    settingsVersion: 1,
    ...overrides,
  };
}

async function seedSession(cwd: string, sessionsRoot: string) {
  const dir = join(sessionsRoot, "project");
  await mkdir(dir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(dir, "session.jsonl"),
    `${JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd })}\n`,
  );
}

function backendFor(dirs: {
  agent: string;
  sessions: string;
  runtime: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  capture?: { args?: string[]; env?: NodeJS.ProcessEnv; spawnCount?: number };
}) {
  return createPiHostBackend({
    agentDir: dirs.agent,
    sessionsRoot: dirs.sessions,
    runtimeRoot: dirs.runtime,
    piPath: "node",
    extensionInvokeTimeoutMs: dirs.timeoutMs,
    spawn: (_bin, args, options) => {
      const argv = args as string[];
      if (dirs.capture && argv.includes("--mode") && argv.includes("rpc") && !argv.includes("--no-session")) {
        dirs.capture.args = argv;
        dirs.capture.env = options.env;
        dirs.capture.spawnCount = (dirs.capture.spawnCount ?? 0) + 1;
      }
      return spawn(process.execPath, [fakePi], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin", ...dirs.env },
      }) as any;
    },
  });
}

describe("invokeExtension and spawn settings snapshot", () => {
  it("returns not_found, disabled, capability_denied, and no_session without a live session", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-invoke-err-"));
    const agent = join(root, "agent");
    const runtime = join(root, "runtime");
    await writeManifest(join(agent, "extensions", "invoke-agent"), invokeAgentManifest());
    await mkdir(join(agent, "extensions", "invoke-agent", "agent"), { recursive: true });
    await writeFile(join(agent, "extensions", "invoke-agent", "agent", "index.js"), "export default () => {};\n");
    await writeManifest(join(agent, "extensions", "quota"), {
      id: "quota",
      name: "Quota",
      version: "1.0.0",
      agent: { extension: "agent/index.js" },
      capabilities: ["bridge.emit"],
    });
    // The loader errors on a declared agent entry that is missing on disk;
    // quota only exercises the capability_denied path, so give it a real file.
    await mkdir(join(agent, "extensions", "quota", "agent"), { recursive: true });
    await writeFile(join(agent, "extensions", "quota", "agent", "index.js"), "export default () => {};\n");
    const backend = backendFor({ agent, sessions: join(root, "sessions"), runtime });
    await backend.handle("listExtensions" as never, []);

    const missing = (await backend.handle("invokeExtension" as never, ["no-such", "ping", {}])) as ExtResult;
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });

    const disabled = (await backend.handle("invokeExtension" as never, ["invoke-agent", "ping", {}])) as ExtResult;
    expect(disabled).toMatchObject({ ok: false, error: { code: "disabled" } });

    await backend.handle("setExtensionEnabled" as never, ["quota", true, "app"]);
    const denied = (await backend.handle("invokeExtension" as never, ["quota", "ping", {}])) as ExtResult;
    expect(denied).toMatchObject({ ok: false, error: { code: "capability_denied" } });

    await backend.handle("setExtensionEnabled" as never, ["invoke-agent", true, "app"]);
    const noSession = (await backend.handle("invokeExtension" as never, ["invoke-agent", "ping", { n: 1 }])) as ExtResult;
    expect(noSession).toMatchObject({ ok: false, error: { code: "no_session" } });
    await backend.close();
  });

  it("round-trips invokeExtension, injects settings snapshots on spawn, and times out", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-invoke-ok-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    const runtime = join(root, "runtime");
    const pkg = join(agent, "extensions", "invoke-agent");
    await writeManifest(pkg, invokeAgentManifest());
    await mkdir(join(pkg, "agent", "skills"), { recursive: true });
    await writeFile(join(pkg, "agent", "index.js"), "export default () => {};\n");
    await writeFile(join(pkg, "agent", "skills", "SKILL.md"), "# skill\n");
    await seedSession(cwd, sessions);
    const settingsLog = join(root, "settings.log");
    const invokeLog = join(root, "invoke.log");
    const capture: { args?: string[]; env?: NodeJS.ProcessEnv } = {};
    const backend = backendFor({
      agent,
      sessions,
      runtime,
      timeoutMs: 80,
      capture,
      env: { FAKE_PI_SETTINGS_LOG: settingsLog, FAKE_PI_INVOKE_LOG: invokeLog },
    });
    await backend.handle("listExtensions" as never, []);
    await backend.handle("setExtensionEnabled" as never, ["invoke-agent", true, "app"]);
    await backend.handle("updateExtensionSettings" as never, [
      "invoke-agent",
      { "ext.invoke-agent.flag": true },
    ]);
    await backend.handle("addProject", [cwd]);
    await backend.handle("sendPrompt", ["session-1", "go"]);
    const spawnedUntil = Date.now() + 3000;
    while (!capture.args && Date.now() < spawnedUntil) await new Promise((r) => setTimeout(r, 20));

    const agentIndex = capture.args?.findIndex((arg, i) => arg === "-e" && capture.args?.[i + 1]?.endsWith("invoke-agent/agent/index.js"));
    expect(agentIndex).toBeGreaterThanOrEqual(0);
    expect(capture.env?.[extensionSettingsEnvName("invoke-agent")]).toBe(
      JSON.stringify({ "ext.invoke-agent.flag": true }),
    );
    expect(capture.env?.PIPIUI_SKILL_ROOTS?.split(":").some((p) => p.endsWith("agent/skills"))).toBe(true);

    const happy = (await backend.handle("invokeExtension" as never, [
      "invoke-agent",
      "ping",
      { n: 7 },
      { sessionId: "session-1" },
    ])) as ExtResult;
    expect(happy).toEqual({
      ok: true,
      data: { echoed: { n: 7 }, extensionId: "invoke-agent", method: "ping" },
    });

    const failed = (await backend.handle("invokeExtension" as never, [
      "invoke-agent",
      "fail",
      {},
      { sessionId: "session-1" },
    ])) as ExtResult;
    expect(failed).toMatchObject({ ok: false, error: { code: "agent_error", message: "agent boom" } });

    // A method nothing registered is answered, not left to time out.
    const unknown = (await backend.handle("invokeExtension" as never, [
      "invoke-agent",
      "nope",
      {},
      { sessionId: "session-1" },
    ])) as ExtResult;
    expect(unknown).toMatchObject({ ok: false, error: { code: "not_found" } });

    const timed = (await backend.handle("invokeExtension" as never, [
      "invoke-agent",
      "hang",
      {},
      { sessionId: "session-1" },
    ])) as ExtResult;
    expect(timed).toMatchObject({ ok: false, error: { code: "timeout" } });

    await backend.handle("updateExtensionSettings" as never, [
      "invoke-agent",
      { "ext.invoke-agent.flag": false },
    ]);
    const deadline = Date.now() + 1000;
    let settingsText = "";
    while (Date.now() < deadline) {
      settingsText = await readFile(settingsLog, "utf8").catch(() => "");
      if (settingsText.includes("pipiui.settings_changed")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    // Non-secret settings still travel over the ext-invoke channel: pi has no stdin command for this.
    expect(settingsText).toContain("pipiui.settings_changed");
    expect(settingsText).toContain("invoke-agent");
    expect(settingsText).toContain("ext.invoke-agent.flag");

    // A secret-setting change is different: its value cannot ride that snapshot. The host marks the
    // mounted child for a graceful hot restart; the next send gets a fresh spawn environment.
    await backend.handle("updateExtensionSettings" as never, [
      "invoke-agent",
      { "ext.invoke-agent.token": "secret-token-value" },
    ]);
    expect(listSecretMeta(agent)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "ext.invoke-agent.token" })]));
    await backend.handle("sendPrompt", ["session-1", "after-secret-change"]);
    const restartedUntil = Date.now() + 1000;
    while ((capture.spawnCount ?? 0) < 2 && Date.now() < restartedUntil) await new Promise((r) => setTimeout(r, 20));
    expect(capture.spawnCount).toBeGreaterThanOrEqual(2);
    expect(capture.env?.EXT_INVOKE_AGENT_TOKEN).toBe("secret-token-value");

    await backend.close();
  });
});
