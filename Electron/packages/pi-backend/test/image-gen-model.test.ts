import { expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

/**
 * The app-level image-gen/model branch (no session): the extension's settings-section picker
 * reads and writes <agentDir>/image-model.json through it; the agent reads that file per call.
 */
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "image-gen-model-"));
  const agentDir = join(root, "profile");
  const pack = join(agentDir, "extensions", "image-gen");
  await mkdir(pack, { recursive: true });
  await writeFile(join(pack, "pipiui-extension.json"), JSON.stringify({
    id: "image-gen", name: "Image Generation", version: "0.1.0",
    capabilities: ["invoke.agent"], defaultEnabled: true,
  }));
  const backend = createPiHostBackend({
    agentDir,
    sessionsRoot: join(root, "sessions"),
    spawn: () => { throw new Error("the model branch must not start a session"); },
  } as never);
  const dispose = () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  return { root, agentDir, backend, dispose };
}

it("get answers the saved choice and the grok-build default", async () => {
  const { agentDir, backend, dispose } = await harness();
  try {
    await (await import("node:fs/promises")).mkdir(agentDir, { recursive: true });
    let result = await backend.handle("invokeExtension", ["image-gen", "model", { op: "get" }]) as any;
    expect(result).toEqual({ ok: true, data: { current: null, grokDefault: false, codexSignedIn: false, autoRoute: "none" } });
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "grok-build": { access: "x" } }));
    result = await backend.handle("invokeExtension", ["image-gen", "model", { op: "get" }]) as any;
    expect(result.data.grokDefault).toBe(true);
    await writeFile(join(agentDir, "image-model.json"), JSON.stringify({ model: "openai/gpt-image-1" }));
    result = await backend.handle("invokeExtension", ["image-gen", "model", {}]) as any;
    expect(result.data.current).toBe("openai/gpt-image-1");
  } finally {
    await dispose();
  }
});

it("set persists the choice next to the agent and clear removes it", async () => {
  const { agentDir, backend, dispose } = await harness();
  try {
    const set = await backend.handle("invokeExtension", ["image-gen", "model", { op: "set", model: "volcengine/seedream-4" }]) as any;
    expect(set.ok).toBe(true);
    expect(set.data.current).toBe("volcengine/seedream-4");
    const file = join(agentDir, "image-model.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ model: "volcengine/seedream-4" });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const clear = await backend.handle("invokeExtension", ["image-gen", "model", { op: "clear" }]) as any;
    expect(clear.data.current).toBeNull();
    await expect(stat(file)).rejects.toThrow();
  } finally {
    await dispose();
  }
});

it("refuses a malformed set without touching the file", async () => {
  const { agentDir, backend, dispose } = await harness();
  try {
    const refused = await backend.handle("invokeExtension", ["image-gen", "model", { op: "set", model: "  " }]) as any;
    expect(refused.ok).toBe(false);
    await expect(stat(join(agentDir, "image-model.json"))).rejects.toThrow();
    const unknown = await backend.handle("invokeExtension", ["image-gen", "model", { op: "wat" }]) as any;
    expect(unknown.ok).toBe(false);
  } finally {
    await dispose();
  }
});

/** A Pi-shaped openai-codex OAuth entry whose access token is a fake JWT with the given auth claim. */
function codexEntry(authClaim: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    type: "oauth",
    access: `${part({ alg: "RS256" })}.${part({ "https://api.openai.com/auth": authClaim })}.c2ln`,
    refresh: "refresh-token",
    expires: 4102444800000,
  };
}

it("get reports codexSignedIn and autoRoute (Codex on a paid plan, then grok-build, else none)", async () => {
  const { agentDir, backend, dispose } = await harness();
  const fixtures: Array<[string, Record<string, unknown> | undefined, { codexSignedIn: boolean; autoRoute: string; grokDefault: boolean }]> = [
    ["codex paid + grok", { "openai-codex": codexEntry({ chatgpt_account_id: "acct", chatgpt_plan_type: "plus" }), "grok-build": { access: "x" } }, { codexSignedIn: true, autoRoute: "codex", grokDefault: true }],
    ["codex free + grok", { "openai-codex": codexEntry({ chatgpt_account_id: "acct", chatgpt_plan_type: "free" }), "grok-build": { access: "x" } }, { codexSignedIn: true, autoRoute: "grok-build", grokDefault: true }],
    ["codex free alone", { "openai-codex": codexEntry({ chatgpt_account_id: "acct", chatgpt_plan_type: "free" }) }, { codexSignedIn: true, autoRoute: "none", grokDefault: false }],
    ["codex without an account claim", { "openai-codex": codexEntry({ chatgpt_plan_type: "pro" }) }, { codexSignedIn: true, autoRoute: "none", grokDefault: false }],
    ["codex entry without an access token", { "openai-codex": { type: "oauth", refresh: "r" } }, { codexSignedIn: false, autoRoute: "none", grokDefault: false }],
    ["grok only", { "grok-build": { access: "x" } }, { codexSignedIn: false, autoRoute: "grok-build", grokDefault: true }],
    ["none", undefined, { codexSignedIn: false, autoRoute: "none", grokDefault: false }],
  ];
  try {
    for (const [label, auth, expected] of fixtures) {
      if (auth) await writeFile(join(agentDir, "auth.json"), JSON.stringify(auth));
      else await rm(join(agentDir, "auth.json"), { force: true });
      const result = await backend.handle("invokeExtension", ["image-gen", "model", { op: "get" }]) as any;
      expect({ label, ...result.data }).toEqual({ label, current: null, ...expected });
    }
    // set and clear answer the same routing fields.
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "openai-codex": codexEntry({ chatgpt_account_id: "acct", chatgpt_plan_type: "pro" }) }));
    const set = await backend.handle("invokeExtension", ["image-gen", "model", { op: "set", model: "openai-codex/gpt-image-2" }]) as any;
    expect(set.data).toEqual({ current: "openai-codex/gpt-image-2", grokDefault: false, codexSignedIn: true, autoRoute: "codex" });
    const clear = await backend.handle("invokeExtension", ["image-gen", "model", { op: "clear" }]) as any;
    expect(clear.data).toEqual({ current: null, grokDefault: false, codexSignedIn: true, autoRoute: "codex" });
  } finally {
    await dispose();
  }
});
