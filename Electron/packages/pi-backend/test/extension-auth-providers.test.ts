import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contributedAuthProviderModules,
  contributedProviderModulePath,
  loadContributedAuthProvider,
  registerContributedAuthProviders,
} from "../src/extension-auth-providers.js";

describe("generic extension auth provider registration", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function writeFakeProvider(id = "acme-chat") {
    root = await mkdtemp(join(tmpdir(), "ext-auth-reg-"));
    const dir = join(root, id);
    await mkdir(join(dir, "agent", "dist"), { recursive: true });
    await writeFile(
      join(dir, "agent", "dist", "provider.js"),
      `export const AUTH_PROVIDER_ID = ${JSON.stringify(id)};
export function createAuthProvider() {
  return { name: "Acme", api: "openai-completions", baseUrl: "https://api.example.com/v1", models: [{ id: "acme-fast", name: "Fast" }] };
}
`,
    );
    return dir;
  }

  it("resolves the conventional provider module and loads createAuthProvider", async () => {
    const dir = await writeFakeProvider();
    expect(contributedProviderModulePath(dir)).toBe(join(dir, "agent", "dist", "provider.js"));
    const loaded = await loadContributedAuthProvider(dir);
    expect(loaded).toEqual({
      id: "acme-chat",
      config: {
        name: "Acme",
        api: "openai-completions",
        baseUrl: "https://api.example.com/v1",
        models: [{ id: "acme-fast", name: "Fast" }],
      },
    });
  });

  it("registers a contributed provider once and skips packages without a factory", async () => {
    const dir = await writeFakeProvider();
    const empty = join(root, "empty");
    await mkdir(empty, { recursive: true });
    const registered: string[] = [];
    const known = new Set<string>();
    const runtime = {
      registerProvider: (id: string) => {
        registered.push(id);
        known.add(id);
      },
      getProvider: (id: string) => (known.has(id) ? { id } : undefined),
    };
    await registerContributedAuthProviders({
      runtime,
      claims: [
        {
          extensionId: "acme",
          enabled: true,
          contribution: { provider: { id: "acme-chat", name: "Acme", models: [] } },
        },
        {
          extensionId: "empty",
          enabled: true,
          contribution: { provider: { id: "empty", name: "Empty", models: [] } },
        },
      ],
      directoryOf: (id) => (id === "acme" ? dir : id === "empty" ? empty : undefined),
    });
    expect(registered).toEqual(["acme-chat"]);
    await registerContributedAuthProviders({
      runtime,
      claims: [
        {
          extensionId: "acme",
          enabled: false,
          contribution: { provider: { id: "acme-chat", name: "Acme", models: [] } },
        },
      ],
      directoryOf: () => dir,
    });
    expect(registered).toEqual(["acme-chat"]);
  });

  it("computes the provider module list the external helper cannot discover", async () => {
    const dir = await writeFakeProvider();
    const empty = join(root, "empty");
    await mkdir(empty, { recursive: true });
    const list = contributedAuthProviderModules({
      claims: [
        {
          extensionId: "acme",
          enabled: true,
          contribution: { provider: { id: "acme-chat", name: "Acme", models: [] } },
        },
        {
          // Same provider id via a second package: deduped.
          extensionId: "acme-mirror",
          enabled: true,
          contribution: { provider: { id: "acme-chat", name: "Acme", models: [] } },
        },
        {
          // No provider module on disk: skipped.
          extensionId: "empty",
          enabled: true,
          contribution: { provider: { id: "empty", name: "Empty", models: [] } },
        },
        {
          // Directory unresolvable: skipped.
          extensionId: "gone",
          enabled: true,
          contribution: { provider: { id: "gone-chat", name: "Gone", models: [] } },
        },
      ],
      directoryOf: (id) => (id === "acme" || id === "acme-mirror" ? dir : id === "empty" ? empty : undefined),
    });
    expect(list).toEqual([{ id: "acme-chat", module: join(dir, "agent", "dist", "provider.js") }]);
  });

  it("does not write models.json while registering", async () => {
    const dir = await writeFakeProvider();
    const modelsPath = join(root, "models.json");
    await writeFile(modelsPath, "{\"providers\":{}}\n");
    await registerContributedAuthProviders({
      runtime: { registerProvider: () => undefined },
      claims: [
        {
          extensionId: "acme",
          enabled: true,
          contribution: { provider: { id: "acme-chat", name: "Acme", models: [] } },
        },
      ],
      directoryOf: () => dir,
    });
    expect(await readFile(modelsPath, "utf8")).toBe("{\"providers\":{}}\n");
  });

  it("ignores legacy factory aliases and only loads createAuthProvider", async () => {
    root = await mkdtemp(join(tmpdir(), "ext-auth-legacy-"));
    const dir = join(root, "legacy-alias");
    await mkdir(join(dir, "agent", "dist"), { recursive: true });
    await writeFile(
      join(dir, "agent", "dist", "provider.js"),
      `export const LEGACY_PROVIDER_ID = "legacy";
export function createLegacyProvider() {
  return { name: "Legacy", api: "openai-completions", models: [] };
}
`,
    );
    expect(await loadContributedAuthProvider(dir)).toBeUndefined();
  });

});
