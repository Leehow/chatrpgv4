import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import {
  BUILTIN_EXTENSION_PACKAGES,
  PROJECT_EXTENSION_ENABLED_FILE,
  assertLegalTransition,
  canTransition,
  createExtensionRegistry,
  parseProjectExtensionEnabled,
  readAppExtensionEnabled,
  writeAppExtensionEnabled,
  type ExtensionLifecycleState,
} from "../src/extension-registry.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

const packsSource = new URL("../../../packs", import.meta.url).pathname;

/**
 * Put a real package in the App profile.
 *
 * The base registers no builtin, so these enable-persistence round-trips need a
 * package that actually exists somewhere: `Electron/packs/built-in-skills` copied
 * into `{agentDir}/extensions/` is exactly what a user installing one does.
 */
async function installAppPack(agent: string, id: string): Promise<void> {
  const extensions = join(agent, "extensions");
  await mkdir(extensions, { recursive: true });
  await cp(join(packsSource, id), join(extensions, id), { recursive: true });
}

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const LEGAL: Array<[ExtensionLifecycleState, ExtensionLifecycleState]> = [
  ["discovered", "loaded"],
  ["discovered", "error"],
  ["loaded", "enabled"],
  ["loaded", "disabled"],
  ["loaded", "error"],
  ["enabled", "disabled"],
  ["enabled", "error"],
  ["disabled", "enabled"],
  ["disabled", "unloaded"],
  ["disabled", "error"],
  ["error", "unloaded"],
];

const ILLEGAL: Array<[ExtensionLifecycleState, ExtensionLifecycleState]> = [
  ["enabled", "unloaded"],
  ["discovered", "enabled"],
  ["discovered", "disabled"],
  ["discovered", "unloaded"],
  ["loaded", "unloaded"],
  ["loaded", "discovered"],
  ["unloaded", "loaded"],
  ["unloaded", "enabled"],
  ["error", "enabled"],
  ["error", "loaded"],
  ["error", "disabled"],
  ["enabled", "discovered"],
  ["disabled", "discovered"],
];

describe("extension lifecycle state machine", () => {
  it("allows the D9 edges and rejects the rest", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
      expect(() => assertLegalTransition(from, to)).not.toThrow();
    }
    for (const [from, to] of ILLEGAL) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
      expect(() => assertLegalTransition(from, to)).toThrow(/illegal extension transition/);
    }
  });

  it("registers no builtin at all: a bare base has nothing the user cannot remove", () => {
    expect(BUILTIN_EXTENSION_PACKAGES).toEqual([]);
    expect(createExtensionRegistry().list()).toEqual([]);
  });

  it("still ingests an injected builtin as uninstallable and refuses unload", () => {
    // The builtin lifecycle is a host capability, not a shipped list: a product
    // edition that does bundle a package gets exactly this behaviour.
    const registry = createExtensionRegistry([{
      id: "host-builtin",
      name: "Host Builtin",
      version: "1.0.0",
      category: "foundation",
      origin: "builtin",
      defaultEnabled: false,
      uninstallable: false,
    }]);
    const item = registry.list()[0]!;
    expect(item.origin).toBe("builtin");
    expect(item.state).toBe("disabled");
    expect(item.uninstallable).toBe(false);
    expect(item.category).toBeDefined();
    expect(() => registry.unload("host-builtin")).toThrow(/illegal extension transition: loaded → unloaded/);
    expect(registry.enable("host-builtin").state).toBe("enabled");
    expect(registry.disable("host-builtin").state).toBe("disabled");
    expect(() => registry.unload("host-builtin")).toThrow(/cannot be unloaded/);
    expect(registry.get("host-builtin")?.state).toBe("disabled");
  });

  it("unloads a builtin from error so a later ingest can rediscover it", () => {
    const registry = createExtensionRegistry([]);
    registry.ingest({
      id: "office-extension",
      name: "PipiUI Office",
      version: "0.1.0",
      origin: "builtin",
    });
    registry.enterError("office-extension", "agent.extension does not exist: agent/dist/index.js");
    expect(registry.get("office-extension")?.state).toBe("error");
    expect(() => registry.unload("office-extension")).not.toThrow();
    expect(registry.get("office-extension")).toBeUndefined();
    const again = registry.ingest({
      id: "office-extension",
      name: "PipiUI Office",
      version: "0.1.0",
      origin: "builtin",
    });
    expect(again.state).toBe("enabled");
    expect(again.error).toBeUndefined();
  });

  it("enters error on invalid descriptors without enabling", () => {
    const registry = createExtensionRegistry([]);
    const bad = registry.ingest({
      id: "Not Valid",
      name: "Bad",
      version: "1.0.0",
      origin: "app",
    });
    expect(bad.state).toBe("error");
    expect(bad.error).toMatch(/invalid extension id/);
    expect(() => registry.enable("Not Valid")).toThrow(/error; not retrying|illegal extension transition/);
  });

  it("enters error on migration failure and does not commit", () => {
    const registry = createExtensionRegistry([]);
    registry.ingest({ id: "quota", name: "Quota", version: "1.0.0", origin: "app", defaultEnabled: true });
    let committed = false;
    const record = registry.applyMigration(
      "quota",
      () => {
        throw new Error("migration failed");
      },
      () => {
        committed = true;
      },
    );
    expect(record.state).toBe("error");
    expect(record.error).toBe("migration failed");
    expect(committed).toBe(false);
    expect(() =>
      registry.applyMigration("quota", () => undefined, () => {
        committed = true;
      }),
    ).toThrow(/not retrying/);
    expect(committed).toBe(false);
  });

  it("leaves no registry residual after disable+unload", () => {
    const registry = createExtensionRegistry([]);
    registry.ingest({ id: "quota", name: "Quota", version: "1.0.0", origin: "app" });
    expect(registry.get("quota")?.state).toBe("loaded");
    let residual = true;
    registry.register("quota", () => {
      residual = false;
    });
    expect(() => registry.unload("quota")).toThrow(/illegal extension transition/);
    expect(registry.get("quota")).toBeTruthy();
    registry.enable("quota");
    expect(() => registry.unload("quota")).toThrow(/enabled → unloaded/);
    registry.disable("quota");
    expect(residual).toBe(false);
    registry.unload("quota");
    expect(registry.get("quota")).toBeUndefined();
    expect(registry.list().find((item) => item.id === "quota")).toBeUndefined();
    expect(registry.hasResiduals("quota")).toBe(false);
  });
});

describe("session mount snapshots", () => {
  it("replaces a session snapshot on each spawn registration instead of unioning", () => {
    const registry = createExtensionRegistry([]);
    // First spawn mounts two extensions.
    registry.mountSession("sess-1", ["a", "b"]);
    expect(registry.isMounted("sess-1", "a")).toBe(true);
    expect(registry.isMounted("sess-1", "b")).toBe(true);
    // Same-ID respawn under changed enablement replaces the whole set.
    registry.mountSession("sess-1", ["b", "c"]);
    expect(registry.isMounted("sess-1", "a")).toBe(false);
    expect(registry.isMounted("sess-1", "b")).toBe(true);
    expect(registry.isMounted("sess-1", "c")).toBe(true);
  });

  it("clears the snapshot when the new spawn mounts nothing", () => {
    const registry = createExtensionRegistry([]);
    registry.mountSession("sess-1", ["pdf-extension"]);
    expect(registry.isMounted("sess-1", "pdf-extension")).toBe(true);
    // Dead child respawns with pdf disabled: no residual mount may survive.
    registry.mountSession("sess-1", []);
    expect(registry.isMounted("sess-1", "pdf-extension")).toBe(false);
    // Explicit cleanup stays per-session.
    registry.mountSession("sess-2", ["other"]);
    registry.unmountSession("sess-1");
    expect(registry.isMounted("sess-1", "other")).toBe(false);
    expect(registry.isMounted("sess-2", "other")).toBe(true);
  });
});

describe("extension enable persistence", () => {
  it("round-trips App-level enablement through pipiui-settings.json extensions slot", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-app-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    await installAppPack(agent, "built-in-skills");
    const first = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
    });
    const listed = (await first.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    // Bare base: bundled capabilities ship off, so this round-trip starts by turning one on.
    expect(listed.find((item) => item.id === "built-in-skills")?.state).toBe("disabled");
    await first.handle("setExtensionEnabled" as never, ["built-in-skills", true, "app"]);
    const disabled = (await first.handle("setExtensionEnabled" as never, ["built-in-skills", false, "app"])) as { state: string };
    expect(disabled.state).toBe("disabled");
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(readAppExtensionEnabled(settings)).toMatchObject({ "built-in-skills": false });
    expect(settings.extensions["built-in-skills"]).toMatchObject({ enabled: false });
    await first.close();

    const second = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
    });
    const again = (await second.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    expect(again.find((item) => item.id === "built-in-skills")?.state).toBe("disabled");
    await second.handle("setExtensionEnabled" as never, ["built-in-skills", true, "app"]);
    const restored = (await second.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    expect(restored.find((item) => item.id === "built-in-skills")?.state).toBe("enabled");
    await second.close();
  });

  it("lets a project overlay win without rewriting App enablement", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-project-"));
    const agent = join(root, "agent");
    const project = join(root, "repo");
    await mkdir(agent, { recursive: true });
    await mkdir(project, { recursive: true });
    await installAppPack(agent, "built-in-skills");
    const backend = createPiHostBackend({
      agentDir: agent,
      profileMode: "isolated",
    });
    const added = (await backend.handle("addProject", [project])) as { id: string };
    await backend.handle("setExtensionEnabled" as never, ["built-in-skills", true, "app"]);
    const projectDisabled = (await backend.handle("setExtensionEnabled" as never, [
      "built-in-skills",
      false,
      "project",
      added.id,
    ])) as { state: string };
    expect(projectDisabled.state).toBe("disabled");
    const appView = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    const projectView = (await backend.handle("listExtensions" as never, [added.id])) as Array<{
      id: string;
      state: string;
    }>;
    expect(appView.find((item) => item.id === "built-in-skills")?.state).toBe("enabled");
    expect(projectView.find((item) => item.id === "built-in-skills")?.state).toBe("disabled");
    const overlay = JSON.parse(await readFile(join(projectPiAgentDir(project), PROJECT_EXTENSION_ENABLED_FILE), "utf8"));
    expect(parseProjectExtensionEnabled(overlay)).toEqual({ "built-in-skills": false });
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(readAppExtensionEnabled(settings)["built-in-skills"]).toBe(true);
    const piSettingsPath = join(projectPiAgentDir(project), "settings.json");
    const piSettings = JSON.parse(await readFile(piSettingsPath, "utf8").catch(() => "{}"));
    expect(piSettings).not.toHaveProperty("extensions");
    expect(piSettings).not.toHaveProperty("built-in-skills");
    await backend.close();
  });

  it("does not seed App enablement into a new project view or home", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-noseed-"));
    const agent = join(root, "agent");
    const project = join(root, "fresh");
    await mkdir(agent, { recursive: true });
    await mkdir(project, { recursive: true });
    await installAppPack(agent, "built-in-skills");
    const settings: Record<string, unknown> = { keep: "me" };
    writeAppExtensionEnabled(settings, "built-in-skills", false);
    await writeFile(join(agent, "pipiui-settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
    const backend = createPiHostBackend({
      agentDir: agent,
      profileMode: "isolated",
    });
    const appView = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    expect(appView.find((item) => item.id === "built-in-skills")?.state).toBe("disabled");
    const added = (await backend.handle("addProject", [project])) as { id: string };
    const projectView = (await backend.handle("listExtensions" as never, [added.id])) as Array<{
      id: string;
      state: string;
    }>;
    // Effective/merged state (same as spawn): inherit App disable. Do not copy it into project home.
    expect(projectView.find((item) => item.id === "built-in-skills")?.state).toBe("disabled");
    await expect(readFile(join(projectPiAgentDir(project), PROJECT_EXTENSION_ENABLED_FILE), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(projectPiAgentDir(project), "trust.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await backend.close();
  });

  it("lets a project overlay re-enable after a pure App-level disable", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-merge-"));
    const agent = join(root, "agent");
    const project = join(root, "repo");
    await mkdir(agent, { recursive: true });
    await mkdir(project, { recursive: true });
    await installAppPack(agent, "built-in-skills");
    const backend = createPiHostBackend({
      agentDir: agent,
      profileMode: "isolated",
    });
    const added = (await backend.handle("addProject", [project])) as { id: string };
    await backend.handle("setExtensionEnabled" as never, ["built-in-skills", false, "app"]);
    const before = (await backend.handle("listExtensions" as never, [added.id])) as Array<{ id: string; state: string }>;
    expect(before.find((item) => item.id === "built-in-skills")?.state).toBe("disabled");
    await expect(readFile(join(projectPiAgentDir(project), PROJECT_EXTENSION_ENABLED_FILE), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const projectEnabled = (await backend.handle("setExtensionEnabled" as never, [
      "built-in-skills",
      true,
      "project",
      added.id,
    ])) as { state: string };
    expect(projectEnabled.state).toBe("enabled");
    const appView = (await backend.handle("listExtensions" as never, [])) as Array<{ id: string; state: string }>;
    const projectView = (await backend.handle("listExtensions" as never, [added.id])) as Array<{ id: string; state: string }>;
    expect(appView.find((item) => item.id === "built-in-skills")?.state).toBe("disabled");
    expect(projectView.find((item) => item.id === "built-in-skills")?.state).toBe("enabled");
    const overlay = JSON.parse(await readFile(join(projectPiAgentDir(project), PROJECT_EXTENSION_ENABLED_FILE), "utf8"));
    expect(parseProjectExtensionEnabled(overlay)).toEqual({ "built-in-skills": true });
    const settings = JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"));
    expect(readAppExtensionEnabled(settings)["built-in-skills"]).toBe(false);
    await backend.close();
  });
});
