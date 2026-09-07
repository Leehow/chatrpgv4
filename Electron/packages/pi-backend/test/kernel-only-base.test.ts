/**
 * The base is a bare pi.
 *
 * These are the acceptance tests for that claim, and they are deliberately
 * end-to-end over the real trees this repository ships and develops:
 *
 * - a fresh project on a fresh profile lists zero extensions and still spawns;
 * - a package copied into `{project}/.pi/agent/extensions/<id>/` — copied from
 *   `Electron/packs/`, so the package really is the unit — is discovered,
 *   enabled, and mounted;
 * - the runtime install produces a tree with no extensions and the kernel
 *   present;
 * - nothing under `Electron/packs/` is reachable from `packages/pi-backend/src`
 *   at runtime.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
import { installRuntimeTree } from "../src/runtime-install.js";
import { KERNEL_MOUNTS, resolveKernelPaths, assemblePiSpawn } from "../src/spawn-assembly.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
const packsSource = new URL("../../../packs", import.meta.url).pathname;
const backendSrc = new URL("../src", import.meta.url).pathname;

type Listed = { id: string; state: string; source?: string; origin?: string };

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function freshHost(): Promise<{
  backend: ReturnType<typeof createPiHostBackend>;
  project: string;
  projectId: string;
  runtimeRoot: string;
}> {
  root = await mkdtemp(join(tmpdir(), "pipi-kernel-only-"));
  const project = join(root, "workspace");
  await mkdir(project, { recursive: true });
  const runtimeRoot = join(root, "runtime");
  const backend = createPiHostBackend({
    agentDir: join(root, "agent"),
    sessionsRoot: join(root, "sessions"),
    runtimeRoot,
    runtimeAssets: { sourceRoot: runtimeSource },
    profileMode: "isolated",
  });
  const added = await backend.handle("addProject" as never, [project]) as { id: string };
  return { backend, project, projectId: added.id, runtimeRoot };
}

/** Distribution, in full: copy the package directory into the project. */
async function installPack(project: string, id: string): Promise<string> {
  const dest = join(projectPiAgentDir(project), "extensions", id);
  await mkdir(join(projectPiAgentDir(project), "extensions"), { recursive: true });
  await cp(join(packsSource, id), dest, { recursive: true });
  return dest;
}

describe("a bare base", () => {
  it("lists zero extensions for a fresh project on a fresh profile", async () => {
    const { backend, projectId } = await freshHost();
    const listed = await backend.handle("listExtensions" as never, [projectId]) as Listed[];
    expect(listed).toEqual([]);
  });

  it("still spawns pi, with every kernel mount in argv and no extension mount at all", async () => {
    const { runtimeRoot } = await freshHost();
    installRuntimeTree({ sourceRoot: runtimeSource }, runtimeRoot);
    const kernel = resolveKernelPaths(runtimeRoot);
    const { args, env } = assemblePiSpawn({ cwd: join(root, "workspace"), runtimeRoot, kernel, registeredExtensions: [] });

    const mounted = args.filter((_, index) => args[index - 1] === "-e");
    const kernelMountPaths = KERNEL_MOUNTS
      .filter(mount => mount.contribution.kind === "mount")
      .map(mount => join(runtimeRoot, ...mount.file));
    expect(kernelMountPaths.length).toBeGreaterThan(0);
    for (const path of kernelMountPaths) {
      expect(existsSync(path), `${path} installed`).toBe(true);
      expect(mounted, `${path} mounted`).toContain(path);
    }
    // Nothing but the kernel: every `-e` is a file inside the installed runtime.
    for (const path of mounted) expect(relative(runtimeRoot, path).startsWith("..")).toBe(false);
    expect(env.PIPIUI_MOUNTED_EXTENSIONS).toBeUndefined();
    // The locked base prompt and the worker-side observer still travel.
    expect(env.PIPIUI_CORE_PROMPT).toBe(join(runtimeRoot, "pi-core-prompt", "SYSTEM_BASE.md"));
    expect(env.PIPIUI_PROMPT_OBSERVER_EXT).toBe(join(runtimeRoot, "kernel", "pipiui-prompt-observer.ts"));
  });
});

describe("installing a package is copying its directory", () => {
  it("discovers, enables and mounts a pack copied into the project extensions home", async () => {
    const { backend, project, projectId } = await freshHost();
    const installed = await installPack(project, "skill-loader-extension");

    const listed = await backend.handle("listExtensions" as never, [projectId]) as Listed[];
    const loader = listed.find(item => item.id === "skill-loader-extension");
    expect(loader).toMatchObject({ id: "skill-loader-extension", state: "enabled", source: "project" });

    // Mounted: the loader resolved the package's own declared agent half, inside
    // the copied directory, and the spawn assembler turns that into `-e`.
    expect(existsSync(join(installed, "agent", "index.ts"))).toBe(true);
    const { args } = assemblePiSpawn({
      cwd: project,
      registeredExtensions: [{
        id: "skill-loader-extension",
        enabled: true,
        extensionPath: join(installed, "agent", "index.ts"),
      }],
    });
    expect(args).toContain(join(installed, "agent", "index.ts"));
  });

  it("carries a moved package's whole implementation inside its own directory", async () => {
    // The point of the move: nothing a package needs sits outside it, so the
    // copy above is a complete install. Spot-check the packages whose
    // implementations used to live in sibling runtime subtrees.
    const owned: Record<string, string> = {
      "agent-orchestration": "subagent/index.ts",
      "work-method": "pi-philosophy/philosophy.ts",
      "goal-extension": "pi-goal/src/index.ts",
      "memory-extension": "memory-broker/src/extension.ts",
      "web-access-extension": "arxiv-fetch/extensions/arxiv-fetch.ts",
      "document-workbench": "anydoc/package.json",
      "pdf-extension": "vendor/pdf-inspector/package.json",
      "built-in-skills": "skills/pipiui-research/SKILL.md",
    };
    for (const [id, rel] of Object.entries(owned)) {
      expect(existsSync(join(packsSource, id, rel)), `${id}/${rel}`).toBe(true);
    }
  });

  it("declares every cross-package dependency it relies on", () => {
    // A package may import a sibling only when its manifest says so; that is what
    // makes `dependencies.required` the enable closure rather than a hope.
    const importPattern = /["'](\.\.\/\.\.\/[a-z][a-z0-9-]*)\//g;
    for (const entry of readdirSync(packsSource, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(packsSource, entry.name, "pipiui-extension.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        dependencies?: { required?: Array<{ id?: string }> };
      };
      const declared = new Set((manifest.dependencies?.required ?? []).map(item => item.id));
      const agentDir = join(packsSource, entry.name, "agent");
      if (!existsSync(agentDir)) continue;
      for (const file of readdirSync(agentDir)) {
        const full = join(agentDir, file);
        if (!statSync(full).isFile() || !/\.(m?[jt]s|tsx)$/.test(file)) continue;
        for (const match of readFileSync(full, "utf8").matchAll(importPattern)) {
          const sibling = match[1].slice("../../".length);
          if (sibling === entry.name) continue;
          expect(declared, `${entry.name}/agent/${file} imports ${sibling}`).toContain(sibling);
        }
      }
    }
  });
});

describe("the shipped runtime", () => {
  it("installs the kernel and carries no extension content", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-kernel-tree-"));
    const runtimeRoot = join(root, "runtime");
    const report = installRuntimeTree({ sourceRoot: runtimeSource }, runtimeRoot);
    expect(report.failures).toEqual([]);
    expect(existsSync(join(runtimeRoot, "extensions"))).toBe(false);
    const kernel = resolveKernelPaths(runtimeRoot);
    for (const mount of KERNEL_MOUNTS) expect(kernel[mount.id], mount.id).toBeTruthy();
  });

  it("is never reached into from packs, and never reaches into packs", () => {
    // `packages/pi-backend/src` is the packaged host. A path into `packs/` there
    // would be a runtime dependency on something the app does not ship.
    for (const file of readdirSync(backendSrc)) {
      if (!/\.(m?[jt]s)$/.test(file)) continue;
      // Prose may name a package; a resolvable specifier may not.
      const body = readFileSync(join(backendSrc, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      const offenders = [...body.matchAll(/["'`][^"'`\n]*packs\/[a-z][a-z0-9-]*[^"'`\n]*["'`]/g)];
      expect(offenders.map(match => `${file}: ${match[0]}`)).toEqual([]);
    }
  });
});
