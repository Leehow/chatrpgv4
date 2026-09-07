import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiHostBackend } from "../src/index.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
const packsSource = new URL("../../../packs", import.meta.url).pathname;

/** paper-workbench's own `dependencies.required` closure (its manifest). */
const PAPER_REQUIRED = [
  "skill-loader-extension",
  "built-in-skills",
  "web-access-extension",
  "document-workbench",
  "pdf-extension",
  "memory-extension",
  "paper-library",
];

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
    defaultPack: "paper-workbench",
    ...options,
  });
}

async function copyPacks(extensionsDir: string, ids: readonly string[]): Promise<void> {
  await mkdir(extensionsDir, { recursive: true });
  for (const id of ids) await cp(join(packsSource, id), join(extensionsDir, id), { recursive: true });
}

type Listed = { id: string; state: string };

/**
 * Cold-start semantics, distinct from the addProject path every other test
 * uses: construction scans WITHOUT a project, the project list comes from
 * persisted settings, and the first project-bound read is listExtensions.
 * `setProjectPaths` persists the list without scanning (addProject would
 * scan and mask the bug), matching an App restart over an existing project.
 */
async function coldStart(project: string): Promise<{ backend: ReturnType<typeof backendFor>; projectId: string }> {
  const backend = backendFor();
  await backend.handle("setProjectPaths" as never, [[project]]);
  const projects = await backend.handle("listProjects", []) as { id: string }[];
  expect(projects).toHaveLength(1);
  return { backend, projectId: projects[0].id };
}

describe("cold-start extension enablement", () => {
  it("honors the project ext-enabled.json override on the first listExtensions after boot", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-cold-enable-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    // Dependency closure in the App profile, the form project-local — the
    // live layout of an installed paper-workbench.
    await copyPacks(join(root, "agent", "extensions"), PAPER_REQUIRED);
    await copyPacks(join(projectPiAgentDir(project), "extensions"), ["paper-workbench"]);
    await writeFile(join(projectPiAgentDir(project), "ext-enabled.json"), JSON.stringify({
      schemaVersion: 3,
      overrides: { "paper-workbench": "enabled" },
    }));

    const { backend, projectId } = await coldStart(project);
    const items = await backend.handle("listExtensions", [projectId]) as Listed[];
    const form = items.find((item) => item.id === "paper-workbench");
    expect(form?.state).toBe("enabled");
    // The pack's required closure rides along.
    for (const dep of PAPER_REQUIRED) {
      expect(items.find((item) => item.id === dep)?.state, dep).toBe("enabled");
    }
    await backend.close();
  });

  it("honors defaultPack on the first listExtensions after boot even without an override file", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-cold-default-"));
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    await copyPacks(join(root, "agent", "extensions"), PAPER_REQUIRED);
    await copyPacks(join(projectPiAgentDir(project), "extensions"), ["paper-workbench"]);

    const { backend, projectId } = await coldStart(project);
    const items = await backend.handle("listExtensions", [projectId]) as Listed[];
    expect(items.find((item) => item.id === "paper-workbench")?.state).toBe("enabled");
    await backend.close();
  });
});
