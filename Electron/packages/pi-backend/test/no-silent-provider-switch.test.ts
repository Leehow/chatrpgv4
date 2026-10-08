import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { createPiHostBackend } from "../src/index.js";

/**
 * Contract §206: the model changes only when the owner chooses.
 *
 * On 2026-10-08 every new PipiCOC table carried this in its JSONL:
 *
 *   model_change openai-codex/gpt-6-luna   (host, full UUID id: the onboarding's setModel)
 *   model_change flapcode/gpt-6-luna       (8-hex id, written by Pi itself at start)
 *   ... the extension's session_start: kernel.hello, setup.prologue, coc-setup-opening ...
 *   model_change openai-codex/gpt-6-luna   (8-hex id, the host's set_model after spawn, 0.33 s later)
 *
 * The middle row is Pi 1.0's `createAgentSession`: a session with no messages ignores its recorded
 * `model_change` and appends the agent home's `settings.json` default. The host never told Pi which
 * model to start on, so it wrote its own choice back afterwards. These tests run the real Pi CLI
 * (the vendored build when one is built, else the installed 1.0 package, whose model resolution is
 * the same unpatched code) behind the real host, so they fail on exactly that row.
 */

const repo = resolve(import.meta.dirname, "../../../..");
const piCli = [
  join(repo, "build/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
].find((path) => existsSync(path))!;

/** The arguments that decide the model, as the host assembled them; everything else is product mounting. */
const MODEL_FLAGS = new Set(["--mode", "--session", "--provider", "--model", "--thinking"]);
function modelArgs(args: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (MODEL_FLAGS.has(args[index]) && index + 1 < args.length) kept.push(args[index], args[++index]);
  }
  return kept;
}

const temps: string[] = [];
const backends: Array<ReturnType<typeof createPiHostBackend>> = [];
afterEach(async () => {
  while (backends.length) await backends.pop()!.close().catch(() => undefined);
  while (temps.length) await rm(temps.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
});

type Row = { type: string; id?: string; provider?: string; modelId?: string; thinkingLevel?: string };
async function rows(path: string): Promise<Row[]> {
  return (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
}
const modelRows = (all: Row[]) => all.filter((row) => row.type === "model_change").map((row) => `${row.provider}/${row.modelId}`);

/**
 * The installed App's arrangement: the agent home's Pi default is flapcode/gpt-6-luna, the owner's
 * remembered pick is the same id on another provider. `relay` stands in for openai-codex, a built-in
 * provider this offline fixture cannot authenticate.
 */
async function table(options: { piArgs?: string[][] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pipi-no-silent-switch-"));
  temps.push(root);
  const agent = join(root, "agent");
  const project = join(root, "project");
  await mkdir(agent, { recursive: true });
  await mkdir(project, { recursive: true });
  const provider = (name: string) => ({
    baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", apiKey: "fixture",
    models: [{ id: "gpt-6-luna", name: `Luna (${name})`, reasoning: true }],
  });
  await writeFile(join(agent, "models.json"), JSON.stringify({ providers: { flapcode: provider("flapcode"), relay: provider("relay") } }));
  await writeFile(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "flapcode", defaultModel: "gpt-6-luna", defaultThinkingLevel: "low" }));
  const settingsPath = join(agent, "pipiui-settings.json");
  await writeFile(settingsPath, JSON.stringify({ manualModelSelection: { provider: "relay", modelId: "gpt-6-luna" }, manualThinkingLevel: "low" }));
  const backend = createPiHostBackend({
    agentDir: agent,
    sessionsRoot: join(root, "sessions"),
    runtimeRoot: join(root, "runtime"),
    piPath: process.execPath,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root },
    authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
    spawn: (_command: string, args: readonly string[], spawnOptions: any) => {
      const piArgs = modelArgs(args);
      options.piArgs?.push(piArgs);
      return spawn(process.execPath, [piCli, ...piArgs, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--offline"], {
        ...spawnOptions,
        env: { ...spawnOptions.env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1" },
      }) as never;
    },
  });
  backends.push(backend);
  await backend.handle("setProjectPaths", [[project]]);
  const [listed] = await backend.handle("listProjects", []) as Array<{ id: string }>;
  return { root, agent, project, settingsPath, backend, projectId: listed.id };
}

describe("§206: a spawned table runs the session's model and records no other", () => {
  it("a table the owner put on relay starts on relay: Pi writes no default of its own and the host corrects nothing", async () => {
    const piArgs: string[][] = [];
    const { backend, projectId, settingsPath } = await table({ piArgs });
    const session = await backend.handle("newSession", [projectId]) as { id: string };
    // The owner's pick, made before the table starts (what the onboarding left in today's files).
    await backend.handle("setModel", [session.id, "relay", "gpt-6-luna"]);
    const path = (await (backend as any).locate(session.id)).path as string;
    const settingsBefore = await readFile(settingsPath, "utf8");

    await (backend as any).ensure(session.id);

    // The flip was [relay, flapcode, relay]. Pi's own record of the session's model may restate
    // relay; nothing names any other provider.
    expect(modelRows(await rows(path))).toEqual(["relay/gpt-6-luna", "relay/gpt-6-luna"]);
    expect(piArgs.at(-1)).toEqual(expect.arrayContaining(["--provider", "relay", "--model", "gpt-6-luna"]));
    const state = await backend.handle("getModelState", [session.id]) as any;
    expect(state.model).toMatchObject({ provider: "relay", id: "gpt-6-luna" });
    // Starting a table is not a choice: the remembered pick is not rewritten.
    expect(await readFile(settingsPath, "utf8")).toBe(settingsBefore);
  }, 60_000);

  it("a brand-new table with no model of its own starts on the remembered pick, never on Pi's settings default", async () => {
    const { backend, projectId } = await table();
    const session = await backend.handle("newSession", [projectId]) as { id: string };
    const path = (await (backend as any).locate(session.id)).path as string;
    expect(modelRows(await rows(path))).toEqual([]);

    await (backend as any).ensure(session.id);

    // One row, Pi's record of the model it was told to start on; before §206 it was
    // [flapcode/gpt-6-luna (Pi's default), relay/gpt-6-luna (the host correcting it)].
    expect(modelRows(await rows(path))).toEqual(["relay/gpt-6-luna"]);
  }, 60_000);

  it("resuming a table that has played writes no model row at all", async () => {
    const { backend, projectId } = await table();
    const session = await backend.handle("newSession", [projectId]) as { id: string };
    await backend.handle("setModel", [session.id, "relay", "gpt-6-luna"]);
    const path = (await (backend as any).locate(session.id)).path as string;
    const before = await rows(path);
    const last = before.at(-1)!.id;
    // A played table: Pi restores the recorded model of a session with messages by itself.
    await writeFile(path, (await readFile(path, "utf8")) + [
      { type: "message", id: "u1", parentId: last, timestamp: new Date().toISOString(), message: { role: "user", content: "hello", timestamp: Date.now() } },
      { type: "message", id: "a1", parentId: "u1", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "hi" }], api: "openai-completions", provider: "relay", model: "gpt-6-luna", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() } },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n");

    await (backend as any).ensure(session.id);

    // The host's post-spawn check used to send set_model regardless, and Pi appends a row for every
    // set_model, even to the model it is already on.
    expect(modelRows(await rows(path))).toEqual(modelRows(before));
  }, 60_000);

  it("boundary: a model Pi cannot find exactly is never run in its place; the table refuses to start and says so", async () => {
    // Pi's `--model` resolution falls back to a substring match when the exact id is missing
    // (`resolveCliModel`), so a model the catalog no longer lists can start Pi on a sibling of the
    // same provider. The host's exact check then refuses the spawn. What this boundary still leaves
    // is Pi's own start row for that sibling in a session with no messages (§206.5).
    const piArgs: string[][] = [];
    const { backend, projectId, settingsPath } = await table({piArgs});
    const session = await backend.handle("newSession", [projectId]) as { id: string };
    await backend.handle("setModel", [session.id, "relay", "gpt-6"]);
    const path = (await (backend as any).locate(session.id)).path as string;
    const settingsBefore = await readFile(settingsPath, "utf8");

    await expect((backend as any).ensure(session.id)).rejects.toThrow();

    expect(modelRows(await rows(path)).filter((ref) => !ref.startsWith("relay/"))).toEqual([]);
    expect(modelRows(await rows(path))).toEqual(["relay/gpt-6"]);
    expect(piArgs).toEqual([]);
    expect((backend as any).live.has(session.id)).toBe(false);
    expect(await readFile(settingsPath, "utf8")).toBe(settingsBefore);
  }, 60_000);
});

describe("§206: the onboarding never writes back the model it read before its worker ran", () => {
  for (const action of ["begin", "select", "converse"] as const) {
    it(`${action}: a model the owner picks while the worker runs is the one that stays, in the session and as the remembered pick`, async () => {
      const root = await mkdtemp(join(tmpdir(), "pipi-onboarding-model-"));
      temps.push(root);
      const profile = join(root, "profile");
      const pack = join(profile, "extensions/coc-keeper");
      await mkdir(pack, { recursive: true });
      await cp(join(repo, "pipiui-extension.json"), join(pack, "pipiui-extension.json"));
      await cp(join(repo, "pipicoc"), join(pack, "pipicoc"), { recursive: true });
      const provider = (name: string) => ({ apiKey: "fixture", models: [{ id: "gpt-6-luna", name: `Luna (${name})`, reasoning: true }] });
      await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { flapcode: provider("flapcode"), relay: provider("relay") } }));
      await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "flapcode", defaultModel: "gpt-6-luna", defaultThinkingLevel: "low" }));
      const settingsPath = join(profile, "pipiui-settings.json");
      await writeFile(settingsPath, JSON.stringify({ manualModelSelection: { provider: "relay", modelId: "gpt-6-luna" }, manualThinkingLevel: "low" }));
      let backend!: ReturnType<typeof createPiHostBackend>;
      let workerSawModel = "";
      // The worker runs for as long as reading a book takes; the owner changes the model meanwhile.
      const preparation = {
        invoke: async (_request: unknown, sid: string, model: { id: string }) => {
          workerSawModel = model.id;
          await backend.handle("setModel", [sid, "flapcode", "gpt-6-luna"]);
          return { name: "Cold Harvest" };
        },
        close: async () => {},
      };
      backend = createPiHostBackend({
        agentDir: profile, sessionsRoot: join(root, "sessions"), runtimeRoot: join(root, "runtime"), defaultPack: "coc-keeper",
        managedNodeModulesRoot: join(repo, "node_modules"), cocOnboardingRegistry: { get: () => preparation, close: async () => {} } as any,
        authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
        spawn: () => { throw new Error("No table is started by this onboarding step"); },
      });
      backends.push(backend);
      await backend.handle("addProject", [root]);
      const [project] = await backend.handle("listProjects", []) as Array<{ id: string }>;
      const session = await backend.handle("newSession", [project.id]) as { id: string };
      const path = (await (backend as any).locate(session.id)).path as string;

      const result = await backend.handle("invokeExtension", ["coc-keeper", "onboarding", { action, id: "import-fixture" }, { sessionId: session.id }]) as any;
      expect(result.ok).toBe(true);

      // The worker was handed the model the session was on when the step began...
      expect(workerSawModel).toBe("relay/gpt-6-luna");
      // ...and afterwards the owner's pick stands: the step wrote no model or thinking row after it.
      const all = await rows(path);
      const picked = all.findIndex((row) => row.type === "model_change" && row.provider === "flapcode");
      expect(picked).toBeGreaterThan(-1);
      expect(all.slice(picked + 1).filter((row) => row.type === "model_change" || row.type === "thinking_level_change")).toEqual([]);
      expect(await backend.handle("getModelState", [session.id])).toMatchObject({ model: { provider: "flapcode", id: "gpt-6-luna" } });
      expect(JSON.parse(await readFile(settingsPath, "utf8")).manualModelSelection).toEqual({ provider: "flapcode", modelId: "gpt-6-luna" });
    }, 30_000);
  }
});
