import { afterEach, describe, expect, it } from "vitest";
import { existsSync, realpathSync } from "node:fs";
import { cp, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPiHostBackend } from "../src/index.js";
import { createExtensionLoader } from "../src/extension-loader.js";
import { validateExtensionManifest } from "../src/extension-manifest.js";
import { createExtensionRegistry, readAppExtensionEnabled, writeAppExtensionEnabled } from "../src/extension-registry.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "extensions");
const packsSource = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packs",
);

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function tempRoot(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix));
  return root;
}

async function copyFixture(name: string, destDir: string, id = name): Promise<string> {
  const source = join(fixtures, name, name === "valid" ? "quota" : "pkg");
  const dest = join(destDir, id);
  await mkdir(dirname(dest), { recursive: true });
  await cp(source, dest, { recursive: true });
  return dest;
}

async function writeManifest(dir: string, body: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "pipiui-extension.json"), `${JSON.stringify(body, null, 2)}\n`);
}

type Listed = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  state: string;
  source?: string;
  origin?: string;
  error?: string;
  capabilities?: string[];
  ui?: { panels?: Array<{ slot: string }> };
  contributions?: { settings?: { scope?: string; schema?: { properties?: Record<string, unknown> } } };
};

async function backendFor(dirs: { runtime?: string; agent?: string }) {
  const agent = dirs.agent ?? join(root, "agent");
  await mkdir(agent, { recursive: true });
  return createPiHostBackend({
    agentDir: agent,
    sessionsRoot: join(root, "sessions"),
    runtimeRoot: dirs.runtime ?? join(root, "runtime"),
    profileMode: "isolated",
  });
}

describe("extension manifest D2 validation", () => {
  it("accepts a legal package shape", async () => {
    const raw = JSON.parse(await readFile(join(fixtures, "valid", "quota", "pipiui-extension.json"), "utf8"));
    const result = validateExtensionManifest(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("quota");
    expect(result.manifest.description).toBe("用量监控示例包");
    expect(result.manifest.ui?.panels?.[0]?.slot).toBe("toolPanel");
  });

  it("rejects a description longer than 200 characters", () => {
    const result = validateExtensionManifest({
      id: "quota",
      name: "Quota Monitor",
      version: "1.0.0",
      description: "长".repeat(201),
      capabilities: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toMatch(/description must be at most 200 characters/);
  });

  it("rejects missing id, illegal id, non-namespaced settings, and unknown slot", async () => {
    const missing = JSON.parse(await readFile(join(fixtures, "missing-id", "pkg", "pipiui-extension.json"), "utf8"));
    const missingResult = validateExtensionManifest(missing);
    expect(missingResult.ok).toBe(false);
    if (missingResult.ok) return;
    expect(missingResult.errors.join("; ")).toMatch(/missing required field id/i);

    const illegal = JSON.parse(await readFile(join(fixtures, "illegal-id", "pkg", "pipiui-extension.json"), "utf8"));
    const illegalResult = validateExtensionManifest(illegal);
    expect(illegalResult.ok).toBe(false);
    if (illegalResult.ok) return;
    expect(illegalResult.errors.join("; ")).toMatch(/invalid extension id/i);

    const badKey = JSON.parse(await readFile(join(fixtures, "bad-settings-key", "pkg", "pipiui-extension.json"), "utf8"));
    const badKeyResult = validateExtensionManifest(badKey);
    expect(badKeyResult.ok).toBe(false);
    if (badKeyResult.ok) return;
    expect(badKeyResult.errors.join("; ")).toMatch(/must be namespaced ext\.quota-bad-key\./);

    const slot = JSON.parse(await readFile(join(fixtures, "unknown-slot", "pkg", "pipiui-extension.json"), "utf8"));
    const slotResult = validateExtensionManifest(slot);
    expect(slotResult.ok).toBe(false);
    if (slotResult.ok) return;
    expect(slotResult.errors.join("; ")).toMatch(/unknown panel slot 'sidebar'/);
  });
});

describe("extension loader via listExtensions", () => {
  it("discovers an active content-addressed shared-store package as an app extension", async () => {
    await tempRoot("pipi-ext-shared-store-");
    const storeRoot = join(root, "agent", "extension-store");
    const contentHash = "a".repeat(64);
    const objectDir = join(storeRoot, "objects", contentHash);
    await writeManifest(objectDir, {
      id: "campaign-kit",
      name: "Campaign Kit",
      version: "1.0.0",
      capabilities: [],
    });
    await mkdir(join(storeRoot, "extensions", "campaign-kit"), { recursive: true });
    await writeFile(join(storeRoot, "extensions", "campaign-kit", "active.json"), JSON.stringify({
      contentHash,
      version: "1.0.0",
      sha256: contentHash,
      updatedAt: "2026-08-31T00:00:00.000Z",
    }));

    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot: join(root, "agent", "extensions"),
      sharedStoreRoot: storeRoot,
    });
    loader.scan();

    expect(loader.list().find(item => item.id === "campaign-kit")).toMatchObject({
      source: "app",
      version: "1.0.0",
      directory: realpathSync(objectDir),
    });
  });

  it("loads a legal package and surfaces manifest summary", async () => {
    await tempRoot("pipi-ext-valid-");
    const appExtensions = join(root, "agent", "extensions");
    await copyFixture("valid", appExtensions, "quota");
    const agentEntry = join(appExtensions, "quota", "agent", "dist", "index.js");
    await mkdir(dirname(agentEntry), { recursive: true });
    await writeFile(agentEntry, "export default function () {}\n");
    const backend = await backendFor({});
    const listed = (await backend.handle("listExtensions" as never, [])) as Listed[];
    const quota = listed.find((item) => item.id === "quota");
    // App-profile install: available, and waiting for the user to say yes.
    expect(quota).toMatchObject({
      id: "quota",
      name: "Quota Monitor",
      version: "1.0.0",
      description: "用量监控示例包",
      state: "disabled",
      source: "app",
    });
    expect(quota?.capabilities).toEqual(expect.arrayContaining(["settings.read", "bridge.emit"]));
    expect(quota?.ui?.panels?.[0]?.slot).toBe("toolPanel");
    // Settings schema rides the descriptor so renderer schema forms get fields.
    expect(Object.keys(quota?.contributions?.settings?.schema?.properties ?? {})).toEqual([
      "ext.quota.threshold",
    ]);
    expect(quota?.contributions?.settings?.scope).toBe("app");
    await backend.close();
  });

  it("reads only manifest-declared controlled UI entry source", async () => {
    await tempRoot("pipi-ext-ui-source-");
    const extensionRoot = join(root, "agent", "extensions", "git-capability");
    await writeManifest(extensionRoot, {
      id: "git-capability",
      name: "PipiUI Git",
      version: "1.0.0",
      capabilities: [],
      app: { ui: { headerActions: [{ id: "git.branch", entry: "app/dist/branch-menu.js" }] } },
    });
    await mkdir(join(extensionRoot, "app", "dist"), { recursive: true });
    await writeFile(join(extensionRoot, "app", "dist", "branch-menu.js"), "export const createHeaderAction = () => () => null\n");
    await writeFile(join(extensionRoot, "app", "dist", "undeclared.js"), "export const secret = true\n");

    const backend = await backendFor({});
    await backend.handle("setExtensionEnabled" as never, ["git-capability", true, "app", undefined]);
    await expect(backend.handle("getExtensionUiEntrySource" as never, ["git-capability", "app/dist/branch-menu.js"]))
      .resolves.toContain("createHeaderAction");
    await expect(backend.handle("getExtensionUiEntrySource" as never, ["git-capability", "app/dist/undeclared.js"]))
      .rejects.toThrow(/no declared UI entry/);
    await expect(backend.handle("getExtensionUiEntrySource" as never, ["git-capability", "../secret.js"]))
      .rejects.toThrow(/no declared UI entry/);

    await writeManifest(extensionRoot, {
      id: "git-capability",
      name: "PipiUI Git",
      version: "1.0.0",
      capabilities: [],
    });
    await expect(backend.handle("getExtensionUiEntrySource" as never, ["git-capability", "app/dist/branch-menu.js"]))
      .rejects.toThrow(/no declared UI entry/);
    await backend.close();
  });

  it("keeps a project UI source bound to the project that requested it", async () => {
    await tempRoot("pipi-ext-ui-project-race-");
    const runtime = join(root, "runtime");
    const projectA = join(root, "project-a");
    const projectB = join(root, "project-b");
    const extensionId = "project-ui";
    const entry = "app/dist/header.js";
    for (const [project, marker] of [[projectA, "PROJECT_A"], [projectB, "PROJECT_B"]] as const) {
      await mkdir(project, { recursive: true });
      const extensionRoot = join(projectPiAgentDir(project), "extensions", extensionId);
      await writeManifest(extensionRoot, {
        id: extensionId,
        name: `Project UI ${marker}`,
        version: "1.0.0",
        capabilities: [],
        app: { ui: { headerActions: [{ id: "project.header", entry }] } },
      });
      await mkdir(join(extensionRoot, "app", "dist"), { recursive: true });
      await writeFile(join(extensionRoot, entry), `export const marker = '${marker}'\n`);
    }

    const backend = await backendFor({ runtime });
    const addedA = (await backend.handle("addProject", [projectA])) as { id: string };
    const addedB = (await backend.handle("addProject", [projectB])) as { id: string };
    await backend.handle("setExtensionEnabled" as never, [extensionId, true, "project", addedA.id]);
    await backend.handle("setExtensionEnabled" as never, [extensionId, true, "project", addedB.id]);
    const projectARoot = realpathSync(projectA);
    const projectBRoot = realpathSync(projectB);
    const internals = backend as unknown as {
      migrateLoadedExtensions(projectRoot?: string): Promise<void>;
      extensionEnableOverlay(projectId: unknown): Promise<Record<string, boolean>>;
    };
    const migrate = internals.migrateLoadedExtensions.bind(backend);
    internals.extensionEnableOverlay = async () => ({ [extensionId]: true });
    const migrationOrder: string[] = [];
    const gate = () => {
      let markEntered!: () => void;
      let release!: () => void;
      return {
        entered: new Promise<void>((resolve) => { markEntered = resolve; }),
        released: new Promise<void>((resolve) => { release = resolve; }),
        markEntered: () => markEntered(),
        release: () => release(),
        seen: false,
      };
    };
    const gateA = gate();
    const gateB = gate();
    const gates = new Map([[projectARoot, gateA], [projectBRoot, gateB]]);
    internals.migrateLoadedExtensions = async (projectRoot?: string) => {
      const canonical = projectRoot ? realpathSync(projectRoot) : "";
      const currentGate = gates.get(canonical);
      if (currentGate) {
        if (!currentGate.seen) {
          currentGate.seen = true;
          migrationOrder.push(canonical);
          currentGate.markEntered();
        }
        await currentGate.released;
      }
      await migrate(projectRoot);
    };

    const sourceARequest = backend.handle("getExtensionUiEntrySource" as never, [extensionId, entry, addedA.id]);
    await gateA.entered;
    const sourceBRequest = backend.handle("getExtensionUiEntrySource" as never, [extensionId, entry, addedB.id]);
    await Promise.race([
      gateB.entered,
      new Promise<void>((resolve) => setTimeout(resolve, 50)),
    ]);
    const enteredBeforeRelease = [...migrationOrder];
    gateA.release();
    gateB.release();
    const [sourceA, sourceB] = await Promise.all([sourceARequest, sourceBRequest]);

    expect(enteredBeforeRelease).toEqual([projectARoot]);
    expect(migrationOrder).toEqual([projectARoot, projectBRoot]);
    expect(sourceA).toContain("PROJECT_A");
    expect(sourceA).not.toContain("PROJECT_B");
    expect(sourceB).toContain("PROJECT_B");
    expect(sourceB).not.toContain("PROJECT_A");
    await backend.close();
  });

  it("puts invalid packages in error with a readable reason", async () => {
    await tempRoot("pipi-ext-invalid-");
    const extensions = join(root, "agent", "extensions");
    await copyFixture("missing-id", extensions, "missing-id");
    await copyFixture("illegal-id", extensions, "illegal-id");
    await copyFixture("bad-settings-key", extensions, "quota-bad-key");
    await copyFixture("unknown-slot", extensions, "quota-unknown-slot");
    const backend = await backendFor({});
    const listed = (await backend.handle("listExtensions" as never, [])) as Listed[];

    const missing = listed.find((item) => item.id === "missing-id" || item.error?.includes("missing required field id"));
    expect(missing?.state).toBe("error");
    expect(missing?.error).toMatch(/missing required field id/i);

    const illegal = listed.find((item) => item.error?.match(/invalid extension id/i) || item.id === "Quota");
    expect(illegal?.state).toBe("error");
    expect(illegal?.error).toMatch(/invalid extension id/i);

    const badKey = listed.find((item) => item.id === "quota-bad-key");
    expect(badKey?.state).toBe("error");
    expect(badKey?.error).toMatch(/must be namespaced ext\.quota-bad-key\./);

    const slot = listed.find((item) => item.id === "quota-unknown-slot");
    expect(slot?.state).toBe("error");
    expect(slot?.error).toMatch(/unknown panel slot 'sidebar'/);
    await backend.close();
  });

  it("selects project over app over builtin without rewriting builtin files", async () => {
    await tempRoot("pipi-ext-priority-");
    const runtime = join(root, "runtime");
    const agent = join(root, "agent");
    const project = join(root, "repo");
    await writeManifest(join(runtime, "extensions", "quota"), {
      id: "quota",
      name: "Builtin Quota",
      version: "1.0.0",
      capabilities: [],
    });
    const builtinText = await readFile(join(runtime, "extensions", "quota", "pipiui-extension.json"), "utf8");
    await writeManifest(join(agent, "extensions", "quota"), {
      id: "quota",
      name: "App Quota",
      version: "2.0.0",
      capabilities: ["settings.read"],
    });
    await writeManifest(join(projectPiAgentDir(project), "extensions", "quota"), {
      id: "quota",
      name: "Project Quota",
      version: "3.0.0",
      capabilities: ["bridge.emit"],
    });
    await mkdir(project, { recursive: true });

    const backend = await backendFor({ runtime, agent });
    const appView = (await backend.handle("listExtensions" as never, [])) as Listed[];
    expect(appView.find((item) => item.id === "quota")).toMatchObject({
      name: "App Quota",
      version: "2.0.0",
      source: "app",
    });

    const added = (await backend.handle("addProject", [project])) as { id: string };
    const projectView = (await backend.handle("listExtensions" as never, [added.id])) as Listed[];
    expect(projectView.find((item) => item.id === "quota")).toMatchObject({
      name: "Project Quota",
      version: "3.0.0",
      source: "project",
      capabilities: ["bridge.emit"],
    });

    expect(await readFile(join(runtime, "extensions", "quota", "pipiui-extension.json"), "utf8")).toBe(builtinText);

    const after = (await backend.handle("listExtensions" as never, [])) as Listed[];
    expect(after.find((item) => item.id === "quota")).toMatchObject({
      name: "App Quota",
      version: "2.0.0",
      source: "app",
    });
    await backend.close();
  });

  it("does not scan another project's extensions home", async () => {
    await tempRoot("pipi-ext-isolate-");
    const runtime = join(root, "runtime");
    await mkdir(join(runtime, "extensions"), { recursive: true });
    const projectA = join(root, "proj-a");
    const projectB = join(root, "proj-b");
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    await writeManifest(join(projectPiAgentDir(projectA), "extensions", "alpha"), {
      id: "alpha",
      name: "Alpha",
      version: "1.0.0",
      capabilities: [],
    });
    await writeManifest(join(projectPiAgentDir(projectB), "extensions", "beta"), {
      id: "beta",
      name: "Beta",
      version: "1.0.0",
      capabilities: [],
    });
    await symlink(join(projectPiAgentDir(projectB), "extensions", "beta"), join(projectPiAgentDir(projectA), "extensions", "beta"));

    const backend = await backendFor({ runtime });
    const addedA = (await backend.handle("addProject", [projectA])) as { id: string };
    const addedB = (await backend.handle("addProject", [projectB])) as { id: string };

    const listA = (await backend.handle("listExtensions" as never, [addedA.id])) as Listed[];
    expect(listA.find((item) => item.id === "alpha")).toMatchObject({ source: "project", name: "Alpha" });
    expect(listA.find((item) => item.id === "beta")).toBeUndefined();

    const listB = (await backend.handle("listExtensions" as never, [addedB.id])) as Listed[];
    expect(listB.find((item) => item.id === "beta")).toMatchObject({ source: "project", name: "Beta" });
    expect(listB.find((item) => item.id === "alpha")).toBeUndefined();
    await backend.close();
  });
});

describe("bundled update discovery (read-only seam)", () => {
  it("listBundledUpdateExtensions exposes only App-profile components and never rescans or disturbs the loaded project", async () => {
    await tempRoot("pipi-ext-update-scope-");
    const runtime = join(root, "runtime");
    const agent = join(root, "agent");
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });
    await writeManifest(join(agent, "extensions", "bundle-a"), {
      id: "bundle-a",
      name: "Bundle A",
      version: "1.0.0",
      capabilities: [],
      updateComponents: [
        { id: "lib-a", name: "Lib A", version: "1.0.0", source: { type: "npm", packageName: "lib-a" } },
      ],
    });
    await writeManifest(join(agent, "extensions", "bundle-b"), {
      id: "bundle-b",
      name: "Bundle B",
      version: "2.0.0",
      capabilities: [],
      updateComponents: [
        { id: "lib-b", name: "Lib B", version: "0.9.0", source: { type: "githubReleases", owner: "acme", repo: "lib-b" } },
      ],
    });
    await writeManifest(join(projectPiAgentDir(project), "extensions", "proj-x"), {
      id: "proj-x",
      name: "Proj X",
      version: "0.1.0",
      capabilities: [],
      updateComponents: [
        { id: "lib-x", name: "Lib X", version: "3.0.0", source: { type: "npm", packageName: "lib-x" } },
      ],
    });

    const backend = await backendFor({ runtime, agent });
    const added = (await backend.handle("addProject", [project])) as { id: string };
    await backend.handle("setExtensionEnabled" as never, ["proj-x", true, "project", added.id]);
    await backend.handle("setExtensionEnabled" as never, ["bundle-b", true, "app", undefined]);

    const snapshot = await backend.listBundledUpdateExtensions();
    // Enabled project-origin extensions with updateComponents never leak into the snapshot.
    expect(snapshot.map((item) => item.id)).toEqual(expect.arrayContaining(["bundle-a", "bundle-b"]));
    expect(snapshot.some((item) => item.id === "proj-x")).toBe(false);
    expect(snapshot.find((item) => item.id === "bundle-a")).toMatchObject({
      origin: "app",
      state: "disabled",
      updateComponents: [{ id: "lib-a", version: "1.0.0", source: { type: "npm", packageName: "lib-a" } }],
    });
    expect(snapshot.find((item) => item.id === "bundle-b")).toMatchObject({
      origin: "app",
      state: "enabled",
      updateComponents: [{ id: "lib-b", version: "0.9.0", source: { type: "githubReleases", owner: "acme", repo: "lib-b" } }],
    });

    // App-scope disablement flips the snapshot state; the catalog filter drops non-enabled items.
    await backend.handle("setExtensionEnabled" as never, ["bundle-b", false, "app", undefined]);
    const afterDisable = await backend.listBundledUpdateExtensions();
    expect(afterDisable.find((item) => item.id === "bundle-b")?.state).not.toBe("enabled");

    // Snapshot semantics: disk drift since the last scan is not picked up by a refresh read.
    await writeManifest(join(agent, "extensions", "bundle-a"), {
      id: "bundle-a",
      name: "Bundle A",
      version: "9.9.9",
      capabilities: [],
      updateComponents: [
        { id: "lib-a", name: "Lib A", version: "9.9.9", source: { type: "npm", packageName: "lib-a" } },
      ],
    });
    expect((await backend.listBundledUpdateExtensions()).find((item) => item.id === "bundle-a")).toMatchObject({
      version: "1.0.0",
    });

    // The refresh read never disturbed the loaded project: its extension survives intact.
    const projectView = (await backend.handle("listExtensions" as never, [added.id])) as Listed[];
    expect(projectView.find((item) => item.id === "proj-x")).toMatchObject({
      origin: "project",
      state: "enabled",
      updateComponents: [{ id: "lib-x", version: "3.0.0", source: { type: "npm", packageName: "lib-x" } }],
    });
    await backend.close();
  });

  it("loader list() never mutates: project extensions, loaded root and enablement survive a refresh-style read", async () => {
    await tempRoot("pipi-ext-list-readonly-");
    const builtinRoot = join(root, "runtime", "extensions");
    const appRoot = join(root, "agent", "extensions");
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });
    await writeManifest(join(builtinRoot, "bundle-a"), {
      id: "bundle-a",
      name: "Bundle A",
      version: "1.0.0",
      capabilities: [],
      updateComponents: [
        { id: "lib-a", name: "Lib A", version: "1.0.0", source: { type: "npm", packageName: "lib-a" } },
      ],
    });
    await writeManifest(join(projectPiAgentDir(project), "extensions", "proj-x"), {
      id: "proj-x",
      name: "Proj X",
      version: "0.1.0",
      capabilities: [],
    });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({ registry, builtinRoot, appRoot });
    loader.scan(project);
    registry.enable("proj-x");
    const loadedRoot = loader.loadedProject();

    // The update-refresh seam reads the loader with the enablement overlay, no rescan.
    const listed = loader.list({ "proj-x": true });
    expect(listed.find((item) => item.id === "proj-x")).toMatchObject({ origin: "project", state: "enabled" });
    expect(listed.find((item) => item.id === "bundle-a")?.updateComponents?.[0]).toMatchObject({
      id: "lib-a",
      version: "1.0.0",
    });
    expect(loader.loadedProject()).toBe(loadedRoot);
    expect(registry.get("proj-x")?.state).toBe("enabled");
  });
});

describe("extension loader agent spawn mounts", () => {
  it("reports agent.extension for overlay-enabled packages and not as enabled when disabled", async () => {
    await tempRoot("pipi-ext-spawn-");
    const appRoot = join(root, "agent", "extensions");
    await copyFixture("valid", appRoot, "quota");
    const agentEntry = join(appRoot, "quota", "agent", "dist", "index.js");
    await mkdir(dirname(agentEntry), { recursive: true });
    await writeFile(agentEntry, "export default function () {}\n");
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const disabled = loader.spawnPackages().find((pkg) => pkg.id === "quota");
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.extensionPath).toMatch(/quota\/agent\/dist\/index\.js$/);
    const enabled = loader.spawnPackages({ quota: true }).find((pkg) => pkg.id === "quota");
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.extensionPath).toBe(disabled?.extensionPath);
  });

  /**
   * Two enabled packages may not both claim a tool name. pi lets the second
   * registration win silently, so the user would get one package's schema under
   * another package's name with nothing said anywhere; both claimants lose their
   * agent half instead, with the conflict named.
   */
  it("refuses to mount two enabled packages that declare the same tool", async () => {
    await tempRoot("pipi-ext-tool-conflict-");
    const appRoot = join(root, "agent", "extensions");
    for (const id of ["alpha-tools", "beta-tools"]) {
      const dir = join(appRoot, id);
      await mkdir(join(dir, "agent"), { recursive: true });
      await writeFile(join(dir, "agent", "index.js"), "export default function () {}\n");
      await writeManifest(dir, {
        id,
        name: id,
        version: "1.0.0",
        capabilities: [],
        agent: { extension: "agent/index.js", tools: ["shared_tool", `${id.replace("-", "_")}_own`] },
      });
    }
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({ registry, builtinRoot: join(root, "runtime", "extensions"), appRoot });
    loader.scan();
    const overlay = { "alpha-tools": true, "beta-tools": true };
    const spawned = loader.spawnPackages(overlay);
    for (const id of ["alpha-tools", "beta-tools"]) {
      const pkg = spawned.find((item) => item.id === id);
      expect(pkg?.extensionPath, `${id} agent half is withheld`).toBeUndefined();
      const message = pkg?.contributionDiagnostics?.map((item) => item.message).join(" ") ?? "";
      expect(message).toContain("shared_tool");
      expect(message).toContain(id === "alpha-tools" ? "beta-tools" : "alpha-tools");
      expect(pkg?.contributionDiagnostics?.some((item) => item.code === "agent-tool-claim-conflict")).toBe(true);
    }
  });

  it("mounts both packages once only one of them claims the contested name", async () => {
    await tempRoot("pipi-ext-tool-ok-");
    const appRoot = join(root, "agent", "extensions");
    for (const [id, tool] of [["alpha-tools", "alpha_tool"], ["beta-tools", "beta_tool"]] as const) {
      const dir = join(appRoot, id);
      await mkdir(join(dir, "agent"), { recursive: true });
      await writeFile(join(dir, "agent", "index.js"), "export default function () {}\n");
      await writeManifest(dir, {
        id, name: id, version: "1.0.0", capabilities: [],
        agent: { extension: "agent/index.js", tools: [tool] },
      });
    }
    const loader = createExtensionLoader({
      registry: createExtensionRegistry([]),
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const spawned = loader.spawnPackages({ "alpha-tools": true, "beta-tools": true });
    expect(spawned.filter((item) => item.extensionPath).map((item) => item.id).sort()).toEqual(["alpha-tools", "beta-tools"]);
    expect(loader.toolOwner("alpha_tool")).toBe("alpha-tools");
    expect(loader.toolOwnership()).toMatchObject({ "alpha-tools": ["alpha_tool"], "beta-tools": ["beta_tool"] });
  });

  it("resolves a declared agent.layers directory inside the package and exposes it for the spawn", async () => {
    await tempRoot("pipi-ext-layers-");
    const appRoot = join(root, "agent", "extensions");
    const dir = join(appRoot, "layered-tools");
    await mkdir(join(dir, "agent", "layers"), { recursive: true });
    await writeFile(join(dir, "agent", "index.js"), "export default function () {}\n");
    await writeFile(join(dir, "agent", "layers", "10-rule.md"), "# rule\n");
    await writeManifest(dir, {
      id: "layered-tools", name: "Layered", version: "1.0.0", capabilities: [],
      agent: { extension: "agent/index.js", layers: "agent/layers" },
    });
    const loader = createExtensionLoader({
      registry: createExtensionRegistry([]),
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const pkg = loader.spawnPackages({ "layered-tools": true }).find((item) => item.id === "layered-tools");
    expect(pkg?.layerDir).toBe(realpathSync(join(dir, "agent", "layers")));
  });

  it("does not mount a declared agent.extension whose file is missing", async () => {
    await tempRoot("pipi-ext-missing-agent-");
    const appRoot = join(root, "agent", "extensions");
    await copyFixture("valid", appRoot, "quota");
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    const rec = loader.scan().find((item) => item.id === "quota");
    expect(rec?.state).toBe("error");
    expect(rec?.error).toMatch(/agent\.extension/i);
    const spawned = loader.spawnPackages({ quota: true }).find((pkg) => pkg.id === "quota");
    expect(spawned?.enabled).toBe(false);
    expect(spawned?.extensionPath).toBeUndefined();
  });
});

describe("extension loader scan confinement", () => {
  it("ignores packages whose realpath leaves the project agent home", async () => {
    await tempRoot("pipi-ext-jail-");
    const registry = createExtensionRegistry([]);
    const projectA = join(root, "a");
    const projectB = join(root, "b");
    await writeManifest(join(projectPiAgentDir(projectB), "extensions", "escaped"), {
      id: "escaped",
      name: "Escaped",
      version: "1.0.0",
      capabilities: [],
    });
    await mkdir(join(projectPiAgentDir(projectA), "extensions"), { recursive: true });
    await symlink(
      join(projectPiAgentDir(projectB), "extensions", "escaped"),
      join(projectPiAgentDir(projectA), "extensions", "escaped"),
    );
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot: join(root, "agent", "extensions"),
    });
    loader.scan(projectA);
    expect(registry.get("escaped")).toBeUndefined();
  });
});

describe("project-origin default enablement", () => {
  it("discovers a project extension enabled by default, with no overlay record", async () => {
    await tempRoot("pipi-ext-project-default-");
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });
    await writeManifest(join(projectPiAgentDir(project), "extensions", "my-tool"), {
      id: "my-tool",
      name: "My Tool",
      version: "0.1.0",
      capabilities: [],
    });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot: join(root, "agent", "extensions"),
    });
    loader.scan(project);
    expect(registry.get("my-tool")).toMatchObject({ origin: "project", defaultEnabled: true, state: "enabled" });
    expect(loader.spawnPackages().find((pkg) => pkg.id === "my-tool")?.enabled).toBe(true);
  });

  it("keeps an explicit disable winning over the project default across rescans", async () => {
    await tempRoot("pipi-ext-project-disable-");
    const project = join(root, "repo");
    await mkdir(project, { recursive: true });
    await writeManifest(join(projectPiAgentDir(project), "extensions", "my-tool"), {
      id: "my-tool",
      name: "My Tool",
      version: "0.1.0",
      capabilities: [],
    });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot: join(root, "agent", "extensions"),
    });
    const settings: Record<string, unknown> = {};
    writeAppExtensionEnabled(settings, "my-tool", false);
    const overlay = readAppExtensionEnabled(settings);

    loader.scan(project);
    expect(loader.spawnPackages(overlay).find((pkg) => pkg.id === "my-tool")?.enabled).toBe(false);

    // A rescan must not resurrect the extension behind an explicit disable record…
    loader.scan(project);
    expect(loader.spawnPackages(overlay).find((pkg) => pkg.id === "my-tool")?.enabled).toBe(false);
    // …while the same scan without the record falls back to the project default.
    expect(loader.spawnPackages().find((pkg) => pkg.id === "my-tool")?.enabled).toBe(true);
  });
});

describe("bundled hello-pipiui dogfood package", () => {
  it("loads the hello-pipiui sample straight out of packs/", async () => {
    await tempRoot("pipi-ext-hello-");
    const manifestText = await readFile(join(packsSource, "hello-pipiui", "pipiui-extension.json"), "utf8");
    const raw = JSON.parse(manifestText);
    const validation = validateExtensionManifest(raw);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.manifest.id).toBe("hello-pipiui");
    expect(validation.manifest.description).toBe("示例扩展：演示双半包的最小功能");
    expect(validation.manifest.capabilities).toEqual([
      "settings.read",
      "settings.write",
      "bridge.emit",
      "invoke.agent",
      "stream.render",
    ]);
    expect(validation.manifest.ui?.panels ?? []).toEqual([]);

    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: packsSource,
      appRoot: join(root, "agent", "extensions"),
    });
    const records = loader.scan();
    const rec = records.find((item) => item.id === "hello-pipiui") ?? registry.get("hello-pipiui");
    // No package declares `defaultEnabled` any more: none of them ships, so
    // having the directory present is itself the decision to run it.
    expect(rec).toMatchObject({
      id: "hello-pipiui",
      origin: "builtin",
      state: "enabled",
    });
    expect(rec?.error).toBeUndefined();
    const overlay = { "hello-pipiui": true };
    const listed = loader.list(overlay).find((item) => item.id === "hello-pipiui");
    expect(listed?.source).toBe("builtin");
    expect(listed?.description).toBe("示例扩展：演示双半包的最小功能");
    expect(listed?.capabilities).toEqual(
      expect.arrayContaining(["bridge.emit", "invoke.agent", "stream.render"]),
    );
    expect(listed?.ui?.panels ?? []).toEqual([]);
    const spawned = loader.spawnPackages(overlay).find((pkg) => pkg.id === "hello-pipiui");
    expect(spawned?.enabled).toBe(true);
    expect(spawned?.extensionPath).toBeTruthy();
    expect(existsSync(spawned!.extensionPath!)).toBe(true);
  });
});

async function writeContribPackage(
  dest: string,
  spec: {
    id: string;
    name?: string;
    capabilities?: string[];
    extension?: string;
    skills?: string[];
    agents?: Array<{ rel: string; body?: string }>;
    patches?: Array<{
      target: string;
      appendPrompt?: { rel: string; body?: string };
      replacePrompt?: { rel: string; body?: string };
      addTools?: string[];
      removeTools?: string[];
    }>;
  },
): Promise<string> {
  await mkdir(dest, { recursive: true });
  const agent: Record<string, unknown> = {};
  if (spec.extension) {
    agent.extension = spec.extension;
    const entry = join(dest, spec.extension);
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(entry, "export default function () {}\n");
  }
  if (spec.skills?.length) agent.skills = spec.skills;
  if (spec.agents?.length) {
    agent.agents = spec.agents.map((item) => item.rel);
    for (const item of spec.agents) {
      const path = join(dest, item.rel);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, item.body ?? "---\nschema: 1\n---\n# agent\n");
    }
  }
  if (spec.patches?.length) {
    agent.agentPatches = [];
    for (const patch of spec.patches) {
      const declared: Record<string, unknown> = { target: patch.target };
      if (patch.appendPrompt) {
        declared.appendPrompt = patch.appendPrompt.rel;
        const path = join(dest, patch.appendPrompt.rel);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, patch.appendPrompt.body ?? "append\n");
      }
      if (patch.replacePrompt) {
        declared.replacePrompt = patch.replacePrompt.rel;
        const path = join(dest, patch.replacePrompt.rel);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, patch.replacePrompt.body ?? "replace\n");
      }
      if (patch.addTools) declared.addTools = patch.addTools;
      if (patch.removeTools) declared.removeTools = patch.removeTools;
      (agent.agentPatches as Record<string, unknown>[]).push(declared);
    }
  }
  await writeManifest(dest, {
    id: spec.id,
    name: spec.name ?? spec.id,
    version: "1.0.0",
    capabilities: spec.capabilities ?? [],
    ...(Object.keys(agent).length ? { agent } : {}),
  });
  return dest;
}

describe("extension loader agent contributions snapshot", () => {
  it("keeps legacy agent.extension/skills when the manifest has no agents or patches", async () => {
    await tempRoot("pipi-ext-contrib-legacy-");
    const appRoot = join(root, "agent", "extensions");
    await writeContribPackage(join(appRoot, "quota"), {
      id: "quota",
      extension: "agent/dist/index.js",
      skills: ["skills/hello"],
    });
    await mkdir(join(appRoot, "quota", "skills", "hello"), { recursive: true });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const spawned = loader.spawnPackages({ quota: true }).find((pkg) => pkg.id === "quota");
    expect(spawned?.enabled).toBe(true);
    expect(spawned?.extensionPath).toMatch(/quota\/agent\/dist\/index\.js$/);
    expect(spawned?.skillRoots?.some((path) => path.endsWith("skills/hello"))).toBe(true);
    expect(spawned?.agentContribution).toBeUndefined();
  });

  it("resolves confined agent and patch paths from the validated manifest, not raw JSON", async () => {
    await tempRoot("pipi-ext-contrib-resolve-");
    const appRoot = join(root, "agent", "extensions");
    const dest = await writeContribPackage(join(appRoot, "reviewer-kit"), {
      id: "reviewer-kit",
      extension: "agent/dist/index.js",
      agents: [{ rel: "agents/reviewer-lite/AGENT.md" }],
      patches: [{
        target: "explore",
        appendPrompt: { rel: "prompts/explore-extra.md", body: "SECRET_PROMPT_BODY_SHOULD_NOT_LEAK\n" },
        addTools: ["code_search"],
        removeTools: ["bash"],
      }],
    });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const spawned = loader.spawnPackages({ "reviewer-kit": true }).find((pkg) => pkg.id === "reviewer-kit");
    const rootReal = realpathSync(dest);
    expect(spawned?.enabled).toBe(true);
    expect(spawned?.extensionPath).toBeTruthy();
    expect(spawned?.agentContribution).toEqual({
      id: "reviewer-kit",
      origin: "app",
      root: rootReal,
      agents: [realpathSync(join(dest, "agents/reviewer-lite/AGENT.md"))],
      patches: [{
        target: "explore",
        appendPrompt: realpathSync(join(dest, "prompts/explore-extra.md")),
        addTools: ["code_search"],
        removeTools: ["bash"],
      }],
    });
    expect(JSON.stringify(spawned?.agentContribution)).not.toContain("SECRET_PROMPT_BODY_SHOULD_NOT_LEAK");
  });

  it("drops contributions whose realpath escapes the extension root", async () => {
    await tempRoot("pipi-ext-contrib-escape-");
    const appRoot = join(root, "agent", "extensions");
    const dest = await writeContribPackage(join(appRoot, "escaped"), {
      id: "escaped",
      extension: "agent/dist/index.js",
      skills: ["skills/hello"],
      agents: [{ rel: "agents/ok/AGENT.md" }],
    });
    await mkdir(join(dest, "skills", "hello"), { recursive: true });
    const outside = join(root, "outside", "AGENT.md");
    await mkdir(dirname(outside), { recursive: true });
    await writeFile(outside, "---\nschema: 1\n---\n# outside SECRET_PROMPT_BODY_SHOULD_NOT_LEAK\n");
    await rm(join(dest, "agents/ok/AGENT.md"));
    await symlink(outside, join(dest, "agents/ok/AGENT.md"));
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    const rec = loader.scan().find((item) => item.id === "escaped");
    expect(rec?.state).not.toBe("error");
    const spawned = loader.spawnPackages({ escaped: true }).find((pkg) => pkg.id === "escaped");
    expect(spawned?.enabled).toBe(true);
    expect(spawned?.extensionPath).toBeTruthy();
    expect(spawned?.skillRoots?.some((path) => path.endsWith("skills/hello"))).toBe(true);
    expect(spawned?.agentContribution).toBeUndefined();
    expect(spawned?.contributionDiagnostics?.some((entry) => entry.code === "contribution-path-escape")).toBe(true);
    expect(JSON.stringify(spawned?.contributionDiagnostics)).not.toContain("SECRET_PROMPT_BODY_SHOULD_NOT_LEAK");
    expect(JSON.stringify(spawned?.contributionDiagnostics)).not.toContain(outside);
  });

  it("keeps valid contributions when one patch path is missing and reports the failure", async () => {
    await tempRoot("pipi-ext-contrib-partial-");
    const appRoot = join(root, "agent", "extensions");
    const dest = await writeContribPackage(join(appRoot, "partial"), {
      id: "partial",
      agents: [
        { rel: "agents/reviewer-lite/AGENT.md" },
        { rel: "agents/gone/AGENT.md" },
      ],
      patches: [{
        target: "explore",
        addTools: ["grep"],
      }, {
        target: "reviewer",
        appendPrompt: { rel: "prompts/missing.md" },
      }],
    });
    await rm(join(dest, "agents/gone/AGENT.md"));
    await rm(join(dest, "prompts/missing.md"));
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    const rec = loader.scan().find((item) => item.id === "partial");
    expect(rec?.state).not.toBe("error");
    const spawned = loader.spawnPackages({ partial: true }).find((pkg) => pkg.id === "partial");
    expect(spawned?.agentContribution?.agents).toEqual([
      expect.stringMatching(/agents\/reviewer-lite\/AGENT\.md$/),
    ]);
    expect(spawned?.agentContribution?.patches).toEqual([{ target: "explore", addTools: ["grep"] }]);
    expect(spawned?.contributionDiagnostics?.some((entry) => entry.code === "contribution-missing-file")).toBe(true);
    expect(JSON.stringify(spawned?.contributionDiagnostics)).not.toContain(dest);
  });

  it("drops oversized prompt files with a diagnostic and keeps the extension usable", async () => {
    await tempRoot("pipi-ext-contrib-oversize-");
    const appRoot = join(root, "agent", "extensions");
    const dest = await writeContribPackage(join(appRoot, "bulky"), {
      id: "bulky",
      extension: "agent/dist/index.js",
      patches: [{
        target: "explore",
        appendPrompt: { rel: "prompts/huge.md", body: `${"x".repeat(64 * 1024 + 1)}\n` },
      }],
    });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    const rec = loader.scan().find((item) => item.id === "bulky");
    expect(rec?.state).not.toBe("error");
    const spawned = loader.spawnPackages({ bulky: true }).find((pkg) => pkg.id === "bulky");
    expect(spawned?.enabled).toBe(true);
    expect(spawned?.extensionPath).toBeTruthy();
    expect(spawned?.agentContribution).toBeUndefined();
    expect(spawned?.contributionDiagnostics?.some((entry) => entry.code === "contribution-prompt-invalid")).toBe(true);
    expect(JSON.stringify(spawned?.contributionDiagnostics)).not.toContain("x".repeat(32));
    expect(JSON.stringify(spawned?.contributionDiagnostics)).not.toContain(dest);
  });

  it("does not contribute when overlay-disabled, even if paths resolve", async () => {
    await tempRoot("pipi-ext-contrib-disable-");
    const appRoot = join(root, "agent", "extensions");
    await writeContribPackage(join(appRoot, "quota"), {
      id: "quota",
      agents: [{ rel: "agents/reviewer-lite/AGENT.md" }],
    });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const disabled = loader.spawnPackages().find((pkg) => pkg.id === "quota");
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.agentContribution).toBeUndefined();
    const enabled = loader.spawnPackages({ quota: true }).find((pkg) => pkg.id === "quota");
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.agentContribution?.agents).toHaveLength(1);
  });

  it("uses the project instance overlay, not the shadowed app package", async () => {
    await tempRoot("pipi-ext-contrib-overlay-");
    const appRoot = join(root, "agent", "extensions");
    const project = join(root, "repo");
    await writeContribPackage(join(appRoot, "quota"), {
      id: "quota",
      agents: [{ rel: "agents/app-only/AGENT.md", body: "app\n" }],
    });
    const projectDir = await writeContribPackage(join(projectPiAgentDir(project), "extensions", "quota"), {
      id: "quota",
      agents: [{ rel: "agents/project-only/AGENT.md", body: "project\n" }],
    });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan(project);
    const spawned = loader.spawnPackages({ quota: true }).find((pkg) => pkg.id === "quota");
    expect(spawned?.agentContribution?.origin).toBe("project");
    expect(spawned?.agentContribution?.root).toBe(realpathSync(projectDir));
    expect(spawned?.agentContribution?.agents).toEqual([
      realpathSync(join(projectDir, "agents/project-only/AGENT.md")),
    ]);
  });

  it("preserves per-extension manifest order; registry list stays id-sorted until spawn serializes", async () => {
    await tempRoot("pipi-ext-contrib-sort-");
    const builtinRoot = join(root, "runtime", "extensions");
    const appRoot = join(root, "agent", "extensions");
    const project = join(root, "repo");
    await writeContribPackage(join(builtinRoot, "zeta"), {
      id: "zeta",
      agents: [
        { rel: "agents/first/AGENT.md" },
        { rel: "agents/second/AGENT.md" },
      ],
    });
    await writeContribPackage(join(appRoot, "alpha"), {
      id: "alpha",
      agents: [{ rel: "agents/alpha/AGENT.md" }],
    });
    await writeContribPackage(join(appRoot, "mu"), {
      id: "mu",
      agents: [{ rel: "agents/mu/AGENT.md" }],
    });
    await writeContribPackage(join(projectPiAgentDir(project), "extensions", "beta"), {
      id: "beta",
      agents: [{ rel: "agents/beta/AGENT.md" }],
    });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({ registry, builtinRoot, appRoot });
    loader.scan(project);
    const spawned = loader.spawnPackages({ alpha: true, mu: true, beta: true });
    const contribs = spawned.filter((pkg) => pkg.agentContribution).map((pkg) => pkg.agentContribution!);
    // Loader attaches in registry id order; spawn-assembly re-sorts by origin then id.
    expect(contribs.map((item) => [item.origin, item.id])).toEqual([
      ["app", "alpha"],
      ["project", "beta"],
      ["app", "mu"],
      ["builtin", "zeta"],
    ]);
    const zetaAgents = contribs.find((item) => item.id === "zeta")!.agents;
    expect(zetaAgents[0]).toMatch(/agents\/first\/AGENT\.md$/);
    expect(zetaAgents[1]).toMatch(/agents\/second\/AGENT\.md$/);
  });

  it("gives invalid and L2-refused extensions no contributions", async () => {
    await tempRoot("pipi-ext-contrib-refused-");
    const appRoot = join(root, "agent", "extensions");
    await writeManifest(join(appRoot, "broken"), {
      name: "Broken",
      version: "1.0.0",
      capabilities: [],
    });
    await writeContribPackage(join(appRoot, "evil"), {
      id: "evil",
      capabilities: ["host.main"],
      agents: [{ rel: "agents/evil/AGENT.md" }],
    });
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const brokenRec = registry.list().find((item) => item.state === "error");
    expect(brokenRec?.state).toBe("error");
    const brokenSpawn = loader.spawnPackages({ [brokenRec!.id]: true, evil: true }).find((pkg) => pkg.id === brokenRec!.id);
    expect(brokenSpawn?.enabled).toBe(false);
    expect(brokenSpawn?.agentContribution).toBeUndefined();
    const evil = loader.spawnPackages({ evil: true }).find((pkg) => pkg.id === "evil");
    expect(evil?.enabled).toBe(true);
    expect(evil?.agentContribution).toBeUndefined();
  });

  it("refuses a symlink agent.extension, keeps skills, and does not error the package", async () => {
    await tempRoot("pipi-ext-agent-symlink-");
    const appRoot = join(root, "agent", "extensions");
    const hostEntry = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../packs/agent-orchestration/subagent/index.ts",
    );
    await writeContribPackage(join(appRoot, "ext-a"), {
      id: "ext-a",
      extension: "agent/dist/index.js",
      skills: ["skills/a"],
    });
    await mkdir(join(appRoot, "ext-a", "skills", "a"), { recursive: true });
    await writeContribPackage(join(appRoot, "ext-b"), {
      id: "ext-b",
      extension: "agent/dist/index.js",
      skills: ["skills/b"],
    });
    await mkdir(join(appRoot, "ext-b", "skills", "b"), { recursive: true });
    await writeContribPackage(join(appRoot, "ext-host"), {
      id: "ext-host",
      extension: "agent/dist/index.js",
      skills: ["skills/host"],
    });
    await mkdir(join(appRoot, "ext-host", "skills", "host"), { recursive: true });
    await rm(join(appRoot, "ext-b", "agent/dist/index.js"));
    await symlink(join(appRoot, "ext-a", "agent/dist/index.js"), join(appRoot, "ext-b", "agent/dist/index.js"));
    await rm(join(appRoot, "ext-host", "agent/dist/index.js"));
    await symlink(hostEntry, join(appRoot, "ext-host", "agent/dist/index.js"));
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const spawned = loader.spawnPackages({ "ext-a": true, "ext-b": true, "ext-host": true });
    const a = spawned.find((pkg) => pkg.id === "ext-a");
    const b = spawned.find((pkg) => pkg.id === "ext-b");
    const host = spawned.find((pkg) => pkg.id === "ext-host");
    expect(a?.enabled).toBe(true);
    expect(a?.extensionPath).toBeTruthy();
    expect(b?.enabled).toBe(true);
    expect(b?.extensionPath).toBeUndefined();
    expect(b?.skillRoots?.some((path) => path.endsWith("skills/b"))).toBe(true);
    expect(b?.contributionDiagnostics?.some((entry) => entry.code === "agent-extension-symlink")).toBe(true);
    expect(JSON.stringify(b?.contributionDiagnostics)).not.toContain(join(appRoot, "ext-a"));
    expect(host?.enabled).toBe(true);
    expect(host?.extensionPath).toBeUndefined();
    expect(host?.skillRoots?.some((path) => path.endsWith("skills/host"))).toBe(true);
    expect(host?.contributionDiagnostics?.some((entry) => entry.code === "agent-extension-symlink")).toBe(true);
    expect(JSON.stringify(host?.contributionDiagnostics)).not.toContain("pi-ext/subagent");
  });

  it("invalidates every colliding canonical agent.extension identity and keeps skills", async () => {
    await tempRoot("pipi-ext-agent-alias-");
    const appRoot = join(root, "agent", "extensions");
    await writeContribPackage(join(appRoot, "ext-a"), {
      id: "ext-a",
      extension: "agent/dist/index.js",
      skills: ["skills/a"],
    });
    await mkdir(join(appRoot, "ext-a", "skills", "a"), { recursive: true });
    await writeContribPackage(join(appRoot, "ext-b"), {
      id: "ext-b",
      extension: "agent/dist/index.js",
      skills: ["skills/b"],
    });
    await mkdir(join(appRoot, "ext-b", "skills", "b"), { recursive: true });
    await rm(join(appRoot, "ext-b", "agent/dist/index.js"));
    await link(join(appRoot, "ext-a", "agent/dist/index.js"), join(appRoot, "ext-b", "agent/dist/index.js"));
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot,
    });
    loader.scan();
    const spawned = loader.spawnPackages({ "ext-a": true, "ext-b": true });
    const a = spawned.find((pkg) => pkg.id === "ext-a");
    const b = spawned.find((pkg) => pkg.id === "ext-b");
    expect(a?.enabled).toBe(true);
    expect(b?.enabled).toBe(true);
    expect(a?.extensionPath).toBeUndefined();
    expect(b?.extensionPath).toBeUndefined();
    expect(a?.skillRoots?.some((path) => path.endsWith("skills/a"))).toBe(true);
    expect(b?.skillRoots?.some((path) => path.endsWith("skills/b"))).toBe(true);
    expect(a?.contributionDiagnostics?.some((entry) => entry.code === "agent-extension-alias-conflict")).toBe(true);
    expect(b?.contributionDiagnostics?.some((entry) => entry.code === "agent-extension-alias-conflict")).toBe(true);
    expect(JSON.stringify(a?.contributionDiagnostics)).not.toMatch(/\/[^`]+\/agent\/dist/);
    expect(JSON.stringify(b?.contributionDiagnostics)).not.toContain(appRoot);
  });

  it("rediscovers a builtin after agent.extension appears on a later scan", async () => {
    await tempRoot("pipi-ext-builtin-recover-");
    const builtinRoot = join(root, "runtime", "extensions");
    const dest = await writeContribPackage(join(builtinRoot, "dist-backed-extension"), {
      id: "dist-backed-extension",
      extension: "agent/dist/index.js",
    });
    await rm(join(dest, "agent/dist/index.js"));
    const registry = createExtensionRegistry([]);
    const loader = createExtensionLoader({
      registry,
      builtinRoot,
      appRoot: join(root, "agent", "extensions"),
    });
    loader.scan();
    expect(registry.get("dist-backed-extension")?.state).toBe("error");
    expect(registry.get("dist-backed-extension")?.error).toMatch(/agent\.extension does not exist/);
    await writeFile(join(dest, "agent/dist/index.js"), "export default function () {}\n");
    loader.scan();
    expect(registry.get("dist-backed-extension")?.state).not.toBe("error");
    expect(registry.get("dist-backed-extension")?.error).toBeUndefined();
    const spawned = loader.spawnPackages({ "dist-backed-extension": true }).find((pkg) => pkg.id === "dist-backed-extension");
    expect(spawned?.extensionPath).toMatch(/dist-backed-extension\/agent\/dist\/index\.js$/);
  });
});
