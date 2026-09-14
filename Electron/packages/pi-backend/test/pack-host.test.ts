import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiHostBackend } from "../src/index.js";
import { readProjectExtensionActivation } from "../src/extension-activation-store.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";
import { extensionUpdateStoreRoot, readExtensionSlot } from "../src/extension-update-engine.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
const packsSource = new URL("../../../packs", import.meta.url).pathname;
/** Legacy id a pre-v3 activation file could migrate an override onto; the base
 * no longer ships anything by this id (see extension-activation-store.ts), so
 * it must never resolve to an installed extension in these tests. */
const CODING_PACK = "coding-workbench";
/**
 * A form the base itself never ships (the base ships no form at all — see
 * `docs/extension-architecture-v1.md`). Tests that need *a* form to exercise
 * the pack mechanism install this as a project-scope extension, the same way
 * a real product's own runtime would carry its bundled form. Its required
 * closure mirrors the retired `coding-workbench` pack so the mount/layout
 * assertions below still exercise the real base capability extensions.
 */
const FIXTURE_FORM_ID = "demo-workbench";
const FIXTURE_FORM_REQUIRED = [
  "agent-orchestration",
  "work-method",
  "workbench-panels",
  "file-tools",
  "document-workbench",
  "git-capability",
  "goal-extension",
  "plan-extension",
  "skill-loader-extension",
  "terminal-extension",
];
/**
 * The capability packages this repository develops under `Electron/packs/`.
 *
 * None of them ships with the base: a project has one because somebody placed
 * the package directory in `{project}/.pi/agent/extensions/`, which is the
 * whole install story, and that placement is itself the decision to run it.
 */
const CAPABILITY_IDS = [
  "agent-orchestration",
  "work-method",
  "file-tools",
  "document-workbench",
  "git-capability",
  "goal-extension",
  "hosted-provider-tools",
  "mcp-extension",
  "memory-extension",
  "plan-extension",
  "skill-loader-extension",
  "terminal-extension",
  "web-access-extension",
  "webview-browser-extension",
];

/** Install packages the way a product does: copy the directory into the project. */
async function installPacks(project: string, ids: readonly string[]): Promise<void> {
  await copyPacks(join(projectPiAgentDir(project), "extensions"), ids);
}

/**
 * Install into the App profile instead of the project.
 *
 * Same packages, different answer to "did the user choose this?": a project
 * placement is a choice and runs, an App-profile copy is merely available and
 * waits for a toggle or a form's dependency closure to switch it on.
 */
async function installAppPacks(ids: readonly string[]): Promise<void> {
  await copyPacks(join(root, "agent", "extensions"), ids);
}

async function copyPacks(extensions: string, ids: readonly string[]): Promise<void> {
  await mkdir(extensions, { recursive: true });
  for (const id of ids) await cp(join(packsSource, id), join(extensions, id), { recursive: true });
}

type Listed = { id: string; state: string; origin?: string; source?: string; ui?: { layout?: Record<string, unknown> } };

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function backendFor(options: Record<string, unknown> = {}) {
  return createPiHostBackend({
    agentDir: join(root, "agent"),
    sessionsRoot: join(root, "sessions"),
    runtimeRoot: join(root, "runtime"),
    runtimeAssets: { sourceRoot: runtimeSource },
    profileMode: "isolated",
    ...options,
  });
}

/** Installs `FIXTURE_FORM_ID` as a project-scope extension, the way a real
 * product's own bundled form would show up: an ordinary extension declaring
 * `app.ui.layout` plus a `dependencies.required` closure of base capabilities. */
async function installFixtureForm(project: string, id: string = FIXTURE_FORM_ID): Promise<void> {
  const pkg = join(projectPiAgentDir(project), "extensions", id);
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, "pipiui-extension.json"), JSON.stringify({
    id,
    name: "Demo Workbench",
    version: "1.0.0",
    category: "workflow",
    capabilities: [],
    defaultEnabled: false,
    dependencies: { required: FIXTURE_FORM_REQUIRED.map(reqId => ({ id: reqId, version: "^1.0.0" })) },
    app: {
      ui: {
        layout: {
          primarySidebar: "coding.sessions",
          center: "pipi.conversation",
          auxiliarySidebar: "coding.subagents",
          activity: ["coding.sessions"],
        },
      },
    },
  }));
}

async function listed(backend: ReturnType<typeof createPiHostBackend>, projectId: string): Promise<Map<string, Listed>> {
  const items = await backend.handle("listExtensions" as never, [projectId]) as Listed[];
  return new Map(items.map(item => [item.id, item]));
}

describe("product packs over an additive base", () => {
  it("keeps default-mode legacy Conversations writable without applying isolated form gates", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-default-compat-"));
    const project = join(root, "workspace");
    const sessions = join(root, "sessions", "workspace");
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, "legacy.jsonl"), `${JSON.stringify({
      type: "session",
      version: 3,
      id: "legacy-session",
      timestamp: "2026-08-10T00:00:00.000Z",
      cwd: project,
    })}\n`);
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      piPath: process.execPath,
      spawn: (_bin, _args, options) =>
        spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never,
    });

    await expect(backend.handle("sendPrompt", ["legacy-session", "hello"])).resolves.toMatchObject({ outcome: "direct" });
    await backend.close();
  });

  it("lists nothing at all until a package is placed in the project", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-base-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };

    // A bare base: not shipped-and-disabled, absent. Nothing to toggle.
    expect([...(await listed(backend, added.id)).keys()]).toEqual([]);
    expect((await listed(backend, added.id)).has(CODING_PACK)).toBe(false);
    await backend.close();
  });

  it("runs a placed package on discovery, and lets the user turn each one off", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-installed-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await installPacks(project, [...CAPABILITY_IDS, "built-in-skills", "workbench-panels"]);
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };

    // Placing the directory is the decision: the user chose this package by
    // putting it here, so it is on, not shipped-and-waiting.
    const installed = await listed(backend, added.id);
    for (const id of [...CAPABILITY_IDS, "built-in-skills"]) {
      expect(installed.get(id), `${id} after placement`).toMatchObject({ state: "enabled", origin: "project" });
    }

    for (const id of CAPABILITY_IDS) {
      await backend.handle("setExtensionEnabled" as never, [id, false, "project", added.id]);
    }
    const off = await listed(backend, added.id);
    for (const id of CAPABILITY_IDS) {
      expect(off.get(id)?.state, `${id} after an explicit project disable`).toBe("disabled");
    }
    await backend.close();
  });

  it("enables a form's closure and layout, then releases it on disable", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-coding-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await installAppPacks([...FIXTURE_FORM_REQUIRED, "memory-extension"]);
    await installFixtureForm(project);
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };
    // A capability the user turned off before the pack existed for them.
    await backend.handle("setExtensionEnabled" as never, ["memory-extension", false, "project", added.id]);

    await backend.handle("setExtensionEnabled" as never, [FIXTURE_FORM_ID, true, "project", added.id]);
    const coding = await listed(backend, added.id);
    expect(coding.get(FIXTURE_FORM_ID)?.state).toBe("enabled");
    expect(coding.get("workbench-panels")?.state).toBe("enabled");
    // The layout travels on the pack's own manifest — that is the whole form.
    expect(coding.get(FIXTURE_FORM_ID)?.ui?.layout).toMatchObject({ primarySidebar: "coding.sessions" });
    // An explicit disable survives a pack that requires the extension.
    expect(coding.get("memory-extension")?.state).toBe("disabled");

    await backend.handle("setExtensionEnabled" as never, [FIXTURE_FORM_ID, false, "project", added.id]);
    const released = await listed(backend, added.id);
    expect(released.get(FIXTURE_FORM_ID)?.state).toBe("disabled");
    expect(released.get("workbench-panels")?.state).toBe("disabled");
    // Bundled capabilities on only via the pack's dependency closure — no
    // default, no explicit toggle — go back off when the pack releases.
    expect(released.get("git-capability")?.state).toBe("disabled");
    expect(released.get("terminal-extension")?.state).toBe("disabled");
    await backend.close();
  });

  it("leaves an extension the project installed itself enabled without any pack naming it", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-project-ext-"));
    const project = join(root, "workspace");
    const pkg = join(projectPiAgentDir(project), "extensions", "hydra-core");
    await mkdir(join(pkg, "agent"), { recursive: true });
    await writeFile(join(pkg, "pipiui-extension.json"), JSON.stringify({
      id: "hydra-core",
      name: "Hydra Core",
      version: "3.1.0",
      category: "automation",
      capabilities: [],
      agent: { extension: "agent/index.ts" },
    }));
    await writeFile(join(pkg, "agent", "index.ts"), "export default () => {}\n");
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };

    // No curated list could ever name it: it was installed after every manifest
    // that ships with the host. Absence is not a decision about it.
    expect((await listed(backend, added.id)).get("hydra-core"))
      .toMatchObject({ origin: "project", state: "enabled" });

    // An explicit project toggle still governs it, and still wins.
    await backend.handle("setExtensionEnabled" as never, ["hydra-core", false, "project", added.id]);
    expect((await listed(backend, added.id)).get("hydra-core")?.state).toBe("disabled");
    await backend.close();
  });

  it("lets an App-scope disable survive the project context", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-app-scope-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await installPacks(project, ["web-access-extension"]);
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };

    await backend.handle("setExtensionEnabled" as never, ["web-access-extension", false, "app"]);
    expect((await listed(backend, added.id)).get("web-access-extension")?.state).toBe("disabled");

    // The project's own toggle is the more specific one and outranks it.
    await backend.handle("setExtensionEnabled" as never, ["web-access-extension", true, "project", added.id]);
    expect((await listed(backend, added.id)).get("web-access-extension")?.state).toBe("enabled");
    await backend.close();
  });

  it("refuses to enable a pack that conflicts with an enabled extension, naming both", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-conflict-"));
    const project = join(root, "workspace");
    await installPacks(project, ["git-capability"]);
    const pkg = join(projectPiAgentDir(project), "extensions", "rival-workbench");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "pipiui-extension.json"), JSON.stringify({
      id: "rival-workbench",
      name: "Rival Workbench",
      version: "1.0.0",
      capabilities: [],
      defaultEnabled: false,
      dependencies: { conflicts: ["git-capability"] },
      app: { ui: { layout: { primarySidebar: "pipi.sessions" } } },
    }));
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };
    await backend.handle("setExtensionEnabled" as never, ["git-capability", true, "project", added.id]);

    await expect(backend.handle("setExtensionEnabled" as never, ["rival-workbench", true, "project", added.id]))
      .rejects.toThrow(/rival-workbench conflicts with git-capability/);
    expect((await listed(backend, added.id)).get("rival-workbench")?.state).toBe("disabled");

    // Turn the conflicting capability off and the same enable goes through.
    await backend.handle("setExtensionEnabled" as never, ["git-capability", false, "project", added.id]);
    await backend.handle("setExtensionEnabled" as never, ["rival-workbench", true, "project", added.id]);
    expect((await listed(backend, added.id)).get("rival-workbench")?.state).toBe("enabled");
    await backend.close();
  });

  it("keeps a legacy Coding Profile migration as inert data now the base ships no coding-workbench form", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-migration-"));
    const project = join(root, "workspace");
    const agentDir = projectPiAgentDir(project);
    await mkdir(agentDir, { recursive: true });
    await installAppPacks(["web-access-extension", "workbench-panels"]);
    await writeFile(join(agentDir, "ext-enabled.json"), JSON.stringify({
      schemaVersion: 2,
      profile: "coding",
      overrides: { "web-access-extension": "disabled" },
    }));
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };

    // The migration in extension-activation-store.ts still fires and still
    // writes the "coding-workbench": "enabled" override — that data survives
    // untouched. But the base installs nothing by that id any more, so the
    // override addresses nothing: it neither appears in the extension list
    // nor cascades its old required closure on.
    expect(await readProjectExtensionActivation(agentDir)).toEqual({
      schemaVersion: 3,
      overrides: { "web-access-extension": "disabled", "coding-workbench": "enabled" },
    });
    const items = await listed(backend, added.id);
    expect(items.has(CODING_PACK)).toBe(false);
    expect(items.get("workbench-panels")?.state).toBe("disabled");
    expect(items.get("web-access-extension")?.state).toBe("disabled");
    await backend.close();
  });

  it("starts a base Conversation with nothing but the kernel mounted", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-base-spawn-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    const captured: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    const backend = backendFor({
      resourceMode: "explicit",
      piPath: process.execPath,
      spawn: (_bin: string, args: string[], options: Record<string, never>) => {
        captured.push({ args: [...args], env: { ...(options as { env: NodeJS.ProcessEnv }).env } });
        return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never;
      },
    });
    const added = await backend.handle("addProject", [project]) as { id: string };
    const session = await backend.handle("newSession", [added.id, "Base conversation"]) as { id: string };
    await backend.handle("sendPrompt", [session.id, "hello"]);

    expect(captured).toHaveLength(1);
    const contract = JSON.parse(captured[0]!.env.PIPIUI_SPAWN_CONTRACT!) as { mounts: { id: string; kind: string }[] };
    // Nothing is installed, so nothing but the kernel can mount.
    expect(contract.mounts.every(mount => mount.kind === "kernel")).toBe(true);
    expect(await backend.handle("getSession", [added.id, session.id])).toMatchObject({
      productProfile: { id: "base", fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
    });
    await backend.close();
  });

  it("leaves a Conversation read-only once the project switches to a different form", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-form-switch-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await installPacks(project, FIXTURE_FORM_REQUIRED);
    await installFixtureForm(project);
    const backend = backendFor({
      resourceMode: "explicit",
      piPath: process.execPath,
      spawn: (_bin: string, _args: string[], options: Record<string, never>) =>
        spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never,
    });
    const added = await backend.handle("addProject", [project]) as { id: string };
    const session = await backend.handle("newSession", [added.id, "Base conversation"]) as { id: string };
    await backend.handle("sendPrompt", [session.id, "hello"]);
    expect(await backend.handle("getSession", [added.id, session.id])).toMatchObject({
      productProfile: { id: "base" },
    });

    await backend.handle("setExtensionEnabled" as never, [FIXTURE_FORM_ID, true, "project", added.id]);
    await expect(backend.handle("sendPrompt", [session.id, "must stay read-only"]))
      .rejects.toThrow(/uses extension pack base.*current project uses demo-workbench/i);
    await backend.close();
  });

  it("stamps a new Conversation with defaultPack after another project's scan", async () => {
    // A project-less or other-project scan unloads project-origin forms. Creating a
    // Conversation must rescan the destination project, or it freezes `base` and the
    // composer locks as a pack mismatch.
    root = await mkdtemp(join(tmpdir(), "pipi-pack-stamp-"));
    const formProject = join(root, "form-project");
    const otherProject = join(root, "other-project");
    await mkdir(formProject, { recursive: true });
    await mkdir(otherProject, { recursive: true });
    await installAppPacks(FIXTURE_FORM_REQUIRED);
    await installFixtureForm(formProject);
    const backend = backendFor({ defaultPack: FIXTURE_FORM_ID });
    const form = await backend.handle("addProject", [formProject]) as { id: string };
    const other = await backend.handle("addProject", [otherProject]) as { id: string };
    expect((await listed(backend, form.id)).get(FIXTURE_FORM_ID)?.state).toBe("enabled");
    await listed(backend, other.id);
    const session = await backend.handle("newSession", [form.id, "Form conversation"]) as {
      id: string;
      productProfile?: { id: string };
    };
    expect(session.productProfile?.id).toBe(FIXTURE_FORM_ID);
    await backend.close();
  });

  it("keeps coc-keeper setup streams private before a campaign binding exists", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-coc-setup-private-"));
    const project = join(root, "workspace");
    const pkg = join(projectPiAgentDir(project), "extensions", "coc-keeper");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "pipiui-extension.json"), JSON.stringify({
      id: "coc-keeper",
      name: "COC Keeper",
      version: "1.0.0",
      category: "workflow",
      capabilities: [],
      defaultEnabled: false,
      dependencies: { required: [] },
      app: { ui: { layout: { center: "pipi.conversation" } } },
    }));
    const backend = backendFor({
      defaultPack: "coc-keeper",
      resourceMode: "explicit",
      piPath: process.execPath,
      spawn: (_bin: string, _args: string[], options: Record<string, never>) =>
        spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never,
    });
    const added = await backend.handle("addProject", [project]) as { id: string };
    const session = await backend.handle("newSession", [added.id, "COC setup"]) as {
      id: string;
      productProfile?: { id: string };
    };
    expect(session.productProfile?.id).toBe("coc-keeper");
    const events: any[] = [];
    const off = backend.subscribe(event => events.push(event));
    await backend.handle("sendPrompt", [session.id, "go"]);
    await new Promise(resolve => setTimeout(resolve, 30));
    const streamed = events.filter(event => event.channel === "stream").map(event => event.event);
    expect(streamed.some(event => event.type === "status" && event.status === "settled")).toBe(true);
    expect(streamed.filter(event => ["text", "thinking", "tool_call", "tool_result"].includes(event.type))).toEqual([]);
    off();
    await backend.close();
  });

  it("assembles a form from registry-owned runtime packages", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-coding-spawn-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await installAppPacks(FIXTURE_FORM_REQUIRED);
    await installFixtureForm(project);
    const captured: string[][] = [];
    const backend = backendFor({
      resourceMode: "explicit",
      piPath: process.execPath,
      spawn: (_bin: string, args: string[], options: Record<string, never>) => {
        captured.push([...args]);
        return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as never;
      },
    });
    const added = await backend.handle("addProject", [project]) as { id: string };
    await backend.handle("setExtensionEnabled" as never, [FIXTURE_FORM_ID, true, "project", added.id]);
    const session = await backend.handle("newSession", [added.id, "Coding conversation"]) as {
      id: string
      productProfile?: { id: string }
    };
    expect(session.productProfile?.id).toBe(FIXTURE_FORM_ID);
    await backend.handle("sendPrompt", [session.id, "hello"]);

    const args = captured[0]!.join("\n");
    for (const id of [
      "file-tools",
      "work-method",
      "agent-orchestration",
      "git-capability",
      "plan-extension",
      "goal-extension",
      "terminal-extension",
      "document-workbench",
      "skill-loader-extension",
    ]) expect(args).toContain(`/extensions/${id}/agent/index.ts`);
    expect(args).not.toMatch(/extensions\/pipiui-(?:coding-tools|git|reload|plan-runtime|electron-terminal|firecrawl-anydoc|open-documents)\.ts/);
    await backend.close();
  });

  it("carries a product's defaultPack into a fresh project, and lets the user turn it off", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-default-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await installAppPacks(FIXTURE_FORM_REQUIRED);
    await installFixtureForm(project);
    const backend = backendFor({ defaultPack: FIXTURE_FORM_ID });
    const added = await backend.handle("addProject", [project]) as { id: string };

    expect((await listed(backend, added.id)).get("workbench-panels")?.state).toBe("enabled");
    await backend.handle("setExtensionEnabled" as never, [FIXTURE_FORM_ID, false, "project", added.id]);
    expect((await listed(backend, added.id)).get("workbench-panels")?.state).toBe("disabled");
    await backend.close();
  });

  it("runs Pipi Paper's paper-workbench form over its declared dependency closure", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-paper-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    const paperRequired = ["skill-loader-extension", "built-in-skills", "web-access-extension", "document-workbench", "pdf-extension", "memory-extension", "paper-library", "agent-orchestration", "git-capability", "workbench-panels"];
    await installAppPacks(paperRequired);
    await installPacks(project, ["paper-workbench"]);
    const backend = backendFor({ defaultPack: "paper-workbench" });
    const added = await backend.handle("addProject", [project]) as { id: string };

    const installed = await listed(backend, added.id);
    const form = installed.get("paper-workbench");
    expect(form?.state).toBe("enabled");
    // The form names shell-owned containers only; the layout must reach the UI as-is.
    expect(form?.ui?.layout).toEqual({ primarySidebar: "pipi.sessions", center: "pipi.conversation", activity: ["pipi.sessions"] });
    for (const id of paperRequired) expect(installed.get(id)?.state, id).toBe("enabled");
    await backend.close();
  });

  it("installs a local Product Pack into the shared store and enables it", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-product-pack-"));
    const project = join(root, "campaign");
    const pack = join(root, "campaign-pack");
    await mkdir(project, { recursive: true });
    await mkdir(join(pack, "extensions", "campaign-kit"), { recursive: true });
    await mkdir(join(pack, "extensions", "campaign-workbench"), { recursive: true });
    await writeFile(join(pack, "pipiui-product-pack.json"), JSON.stringify({
      schemaVersion: 2,
      id: "campaign-workbench",
      name: "Campaign Starter",
      extensions: [
        { id: "campaign-kit", path: "extensions/campaign-kit" },
        { id: "campaign-workbench", path: "extensions/campaign-workbench" },
      ],
    }));
    await writeFile(join(pack, "extensions", "campaign-kit", "pipiui-extension.json"), JSON.stringify({
      id: "campaign-kit",
      name: "Campaign Kit",
      version: "1.0.0",
      hostApi: "^1.0.0",
      capabilities: [],
    }));
    await writeFile(join(pack, "extensions", "campaign-workbench", "pipiui-extension.json"), JSON.stringify({
      id: "campaign-workbench",
      name: "Campaign Workbench",
      version: "1.0.0",
      hostApi: "^1.0.0",
      capabilities: [],
      defaultEnabled: false,
      dependencies: { required: [{ id: "campaign-kit", version: "^1.0.0" }] },
      app: { ui: { layout: { primarySidebar: "campaign.navigator" } } },
    }));

    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };

    expect(await backend.handle("installLocalProductPack" as never, [added.id, pack]))
      .toMatchObject({ packId: "campaign-workbench" });
    const items = await listed(backend, added.id);
    expect(items.get("campaign-workbench")).toMatchObject({ source: "app", state: "enabled" });
    // The pack's own required closure came with it.
    expect(items.get("campaign-kit")?.state).toBe("enabled");
    expect(await readExtensionSlot(extensionUpdateStoreRoot(join(root, "agent")), "campaign-kit", "active"))
      .toMatchObject({ version: "1.0.0" });
    expect(existsSync(join(projectPiAgentDir(project), "product-packs", "campaign-workbench", "receipt.json"))).toBe(true);
    await backend.close();
  });

  it("rolls back Product Pack slots and project files when its pack cannot enable", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-product-pack-rollback-"));
    const project = join(root, "campaign");
    const pack = join(root, "campaign-pack");
    await mkdir(project, { recursive: true });
    await mkdir(join(pack, "extensions", "broken-workbench"), { recursive: true });
    await writeFile(join(pack, "pipiui-product-pack.json"), JSON.stringify({
      schemaVersion: 2,
      id: "broken-workbench",
      name: "Broken Campaign Starter",
      extensions: [{ id: "broken-workbench", path: "extensions/broken-workbench" }],
    }));
    await writeFile(join(pack, "extensions", "broken-workbench", "pipiui-extension.json"), JSON.stringify({
      id: "broken-workbench",
      name: "Broken Workbench",
      version: "1.0.0",
      hostApi: "^1.0.0",
      capabilities: [],
      defaultEnabled: false,
      dependencies: { required: [{ id: "missing-kit", version: "^1.0.0" }] },
      app: { ui: { layout: { primarySidebar: "pipi.sessions" } } },
    }));

    const agentDir = join(root, "agent");
    const backend = backendFor({ agentDir });
    const added = await backend.handle("addProject", [project]) as { id: string };

    await expect(backend.handle("installLocalProductPack" as never, [added.id, pack]))
      .rejects.toThrow(/broken-workbench requires missing-kit .*not installed/);
    expect((await listed(backend, added.id)).has("broken-workbench")).toBe(false);
    expect(await readExtensionSlot(extensionUpdateStoreRoot(agentDir), "broken-workbench", "active")).toBeUndefined();
    expect(existsSync(join(projectPiAgentDir(project), "product-packs", "broken-workbench", "receipt.json"))).toBe(false);
    await backend.close();
  });

  it("exports a project pack to ZIP and loads it into another project", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-zip-host-"));
    const sourceProject = join(root, "source-project");
    const targetProject = join(root, "target-project");
    const archive = join(root, "lab-tools.pipiui-pack.zip");
    await mkdir(targetProject, { recursive: true });
    const pkg = join(projectPiAgentDir(sourceProject), "extensions", "lab-workbench");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "pipiui-extension.json"), JSON.stringify({
      id: "lab-workbench",
      name: "Lab Workbench",
      version: "1.0.0",
      hostApi: "^1.0.0",
      capabilities: [],
      defaultEnabled: false,
      app: { ui: { layout: { primarySidebar: "pipi.sessions" } } },
    }));
    const backend = backendFor();
    const source = await backend.handle("addProject", [sourceProject]) as { id: string };
    const target = await backend.handle("addProject", [targetProject]) as { id: string };

    expect(await backend.handle("exportProductPackArchive" as never, [source.id, "lab-workbench", archive]))
      .toMatchObject({ archivePath: archive, packId: "lab-workbench", extensionCount: 1 });
    expect((await stat(archive)).size).toBeGreaterThan(0);
    expect(await backend.handle("installProductPackArchive" as never, [target.id, archive]))
      .toMatchObject({ packId: "lab-workbench" });
    expect((await listed(backend, target.id)).get("lab-workbench")?.state).toBe("enabled");
    await backend.close();
  });

  it("refuses to export an extension that is not a form", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-export-nonpack-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await installPacks(project, ["git-capability"]);
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };

    await expect(backend.handle("exportProductPackArchive" as never, [
      added.id,
      "git-capability",
      join(root, "git.pipiui-pack.zip"),
    ])).rejects.toThrow(/not a product pack/);
    await backend.close();
  });

  it("activates git-capability through agent-orchestration's dependency closure", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-git-closure-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await installAppPacks(["agent-orchestration", "git-capability"]);
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };

    // Enabling agent-orchestration pulls its required git-capability on too.
    await backend.handle("setExtensionEnabled" as never, ["agent-orchestration", true, "project", added.id]);
    expect((await listed(backend, added.id)).get("git-capability")?.state).toBe("enabled");

    // git-capability is off by explicit choice; agent-orchestration requires it
    // and stays on with the gap reported, because an explicit toggle is the
    // user's decision and never cascades into turning other things off.
    await backend.handle("setExtensionEnabled" as never, ["git-capability", false, "project", added.id]);
    const afterDisable = await listed(backend, added.id);
    expect(afterDisable.get("git-capability")?.state).toBe("disabled");
    expect(afterDisable.get("agent-orchestration")?.state).toBe("enabled");

    // Re-enabling it needs no pack, no plan, and no second mechanism.
    await backend.handle("setExtensionEnabled" as never, ["git-capability", true, "project", added.id]);
    expect((await listed(backend, added.id)).get("git-capability")?.state).toBe("enabled");
    await backend.close();
  });

  it("still lists extensions when the project home has no activation file at all", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pack-no-file-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await installPacks(project, ["skill-loader-extension"]);
    const backend = backendFor();
    const added = await backend.handle("addProject", [project]) as { id: string };

    expect(existsSync(join(projectPiAgentDir(project), "ext-enabled.json"))).toBe(false);
    expect((await listed(backend, added.id)).get("skill-loader-extension")?.state).toBe("enabled");
    // Reading enablement must not create the file; only an explicit toggle writes.
    expect(existsSync(join(projectPiAgentDir(project), "ext-enabled.json"))).toBe(false);
    await backend.handle("setExtensionEnabled" as never, ["skill-loader-extension", false, "project", added.id]);
    expect(JSON.parse(await readFile(join(projectPiAgentDir(project), "ext-enabled.json"), "utf8")))
      .toMatchObject({ schemaVersion: 3, overrides: { "skill-loader-extension": "disabled" } });
    await backend.close();
  });
});
