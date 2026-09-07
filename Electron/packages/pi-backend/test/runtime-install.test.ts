import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_TREE_DIRECTORIES, installRuntimeTree, syncTree, treeSignature } from "../src/runtime-install.js";
import { KERNEL_MOUNTS, resolveKernelPaths } from "../src/spawn-assembly.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
const packsSource = new URL("../../../packs", import.meta.url).pathname;
const temp = () => mkdtemp(join(tmpdir(), "runtime-install-"));

describe("syncTree", () => {
  it("copies a tree, skips node_modules, and no-ops until the source changes", async () => {
    const root = await temp();
    try {
      const source = join(root, "src"); const dest = join(root, "dest");
      await mkdir(join(source, "node_modules"), { recursive: true });
      await writeFile(join(source, "index.ts"), "export const a = 1\n");
      await writeFile(join(source, "node_modules", "huge.js"), "x".repeat(1000));

      expect(syncTree(source, dest).installed).toEqual([dest]);
      expect(await readdir(dest)).not.toContain("node_modules");
      expect(syncTree(source, dest).unchanged).toEqual([dest]);

      await writeFile(join(source, "index.ts"), "export const a = 2\n");
      await utimes(join(source, "index.ts"), new Date(), new Date(Date.now() + 5000));
      expect(syncTree(source, dest).installed).toEqual([dest]);
      expect(await readFile(join(dest, "index.ts"), "utf8")).toBe("export const a = 2\n");
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("skips cargo target directories so rust build artifacts never install", async () => {
    const root = await temp();
    try {
      const source = join(root, "src"); const dest = join(root, "dest");
      await mkdir(join(source, "sidecar-rust", "target"), { recursive: true });
      await writeFile(join(source, "index.ts"), "export const a = 1\n");
      await writeFile(join(source, "sidecar-rust", "Cargo.toml"), "[package]\nname = \"x\"\n");
      await writeFile(join(source, "sidecar-rust", "target", "huge.rlib"), "x".repeat(1000));

      expect(syncTree(source, dest).installed).toEqual([dest]);
      expect(existsSync(join(dest, "sidecar-rust", "Cargo.toml"))).toBe(true);
      expect(existsSync(join(dest, "sidecar-rust", "target"))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("leaves the previous tree in place when the source is missing", async () => {
    const root = await temp();
    try {
      const dest = join(root, "dest"); await mkdir(dest);
      await writeFile(join(dest, "keep.ts"), "old\n");
      const report = syncTree(join(root, "gone"), dest);
      expect(report.failures.length).toBe(1);
      expect(await readFile(join(dest, "keep.ts"), "utf8")).toBe("old\n");
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });
});

describe("treeSignature", () => {
  it("ignores dev-only directories so an npm install never forces a reinstall", async () => {
    const root = await temp();
    try {
      await writeFile(join(root, "a.ts"), "a\n");
      const before = treeSignature(root);
      await mkdir(join(root, "node_modules"));
      await writeFile(join(root, "node_modules", "b.js"), "b\n");
      expect(treeSignature(root)).toBe(before);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });
});

describe("installRuntimeTree", () => {
  it("installs the kernel runtime and nothing else", async () => {
    const root = await temp();
    try {
      const report = installRuntimeTree({ sourceRoot: runtimeSource }, root);
      expect(report.failures).toEqual([]);
      const entries = (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
      expect(entries).toEqual([...RUNTIME_TREE_DIRECTORIES].sort());

      // Every kernel mount `kernel-mounts.ts` declares resolves in the installed tree.
      const kernel = resolveKernelPaths(root);
      for (const mount of KERNEL_MOUNTS) {
        expect(kernel[mount.id], `kernel mount ${mount.id}`).toBe(join(root, ...mount.file));
      }

      // The base is a bare pi: no packages ship, and none of the subtrees that used
      // to belong to one is installed. A product gets a capability by placing the
      // package in `{project}/.pi/agent/extensions/<id>/`, not from this tree.
      for (const gone of ["extensions", "pi-philosophy", "pi-goal", "built-in-skills", "anydoc"]) {
        expect(existsSync(join(root, gone)), `${gone} must not ship`).toBe(false);
      }
      expect((await readdir(join(root, "pi-ext", "packages")))).toEqual(["context-fold"]);
      expect(await readFile(join(root, "pi-ext", "packages", "context-fold", "VENDORED.md"), "utf8"))
        .toContain("4881382bc6a5acaaf8e346a5f36a4c62cf0d3ae3");

      // Host-owned data trees stay: the Electron main process reads each by path.
      expect(existsSync(join(root, "auth", "pi-auth-helper.mjs"))).toBe(true);
      expect(existsSync(join(root, "browser-dom", "controller.js"))).toBe(true);
      expect(existsSync(join(root, "model-capabilities", "models-dev-reasoning-options.json"))).toBe(true);
      expect(await readFile(join(root, "kernel", "pipiui-update-center.ts"), "utf8")).toContain('pi.on("input"');
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("installs no package even when the workspace has packs beside the runtime", async () => {
    const root = await temp();
    try {
      // `Electron/packs/` is repo source, not a runtime input: the installer has no
      // extension list to consult and no second pass that could pick one up.
      expect(existsSync(join(packsSource, "skill-loader-extension", "pipiui-extension.json"))).toBe(true);
      installRuntimeTree({ sourceRoot: runtimeSource }, root);
      expect(RUNTIME_TREE_DIRECTORIES).not.toContain("extensions");
      expect(existsSync(join(root, "packs"))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("removes a tree an earlier build installed and this one no longer ships", async () => {
    const root = await temp();
    try {
      const runtimeRoot = join(root, "runtime");
      // A previous generation's runtime: extensions and their payload trees.
      for (const stale of ["extensions/workbench-panels", "pi-philosophy", "pi-goal", "anydoc", "built-in-skills"]) {
        await mkdir(join(runtimeRoot, stale), { recursive: true });
        await writeFile(join(runtimeRoot, stale, "leftover.txt"), "from the build before\n");
      }
      // Something the user put there themselves must survive.
      await mkdir(join(runtimeRoot, "my-notes"), { recursive: true });
      await writeFile(join(runtimeRoot, "my-notes", "keep.txt"), "mine\n");

      const report = installRuntimeTree({ sourceRoot: runtimeSource }, runtimeRoot);
      expect(report.failures).toEqual([]);

      const remaining = (await readdir(runtimeRoot)).sort();
      expect(remaining).not.toContain("extensions");
      expect(remaining).not.toContain("pi-philosophy");
      expect(remaining).not.toContain("pi-goal");
      expect(remaining).not.toContain("anydoc");
      expect(remaining).not.toContain("built-in-skills");
      expect(remaining).toContain("my-notes");
      expect(report.removed.some(path => path.endsWith("built-in-skills"))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("names each unresolved asset rather than installing a partial tree in silence", async () => {
    const root = await temp();
    try {
      const report = installRuntimeTree({}, root);
      expect(report.failures).toEqual(["runtime source root: no source path resolved"]);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });

  it("reports a missing source directory instead of shipping a half tree", async () => {
    const root = await temp();
    try {
      const source = join(root, "source");
      await mkdir(join(source, "kernel"), { recursive: true });
      const report = installRuntimeTree({ sourceRoot: source }, join(root, "dest"));
      expect(report.failures.length).toBe(RUNTIME_TREE_DIRECTORIES.length - 1);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }) }
  });
});
