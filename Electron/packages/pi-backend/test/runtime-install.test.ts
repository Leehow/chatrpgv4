import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_TREE_DIRECTORIES, installRuntimeTree, syncTree, treeSignature } from "../src/runtime-install.js";
import { KERNEL_MOUNTS, resolveKernelPaths } from "../src/spawn-assembly.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
const packsSource = new URL("../../../packs", import.meta.url).pathname;
const temp = () => mkdtemp(join(tmpdir(), "runtime-install-"));
const removeReadonlyFixture = async (root: string): Promise<void> => {
  const writable = async (path: string): Promise<void> => {
    await chmod(path, 0o700);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await writable(join(path, entry.name));
      else if (entry.isFile()) await chmod(join(path, entry.name), 0o600);
    }
  };
  await writable(root);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
};

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

  it("installs readonly resources and refreshes a readonly previous tree without changing the source or execute bits", async () => {
    const root = await temp();
    try {
      const source = join(root, "source"), nested = join(source, "nested"), dest = join(root, "kernel");
      const helper = join(nested, "helper"), data = join(source, "data.json"), account = join(root, "auth.json");
      await mkdir(nested, { recursive: true });
      await writeFile(helper, "#!/bin/sh\nexit 0\n");
      await writeFile(data, '{"version":1}\n');
      await writeFile(account, "unrelated account sentinel\n", { mode: 0o600 });
      await chmod(helper, 0o555); await chmod(data, 0o444);
      await chmod(nested, 0o555); await chmod(source, 0o555);
      const sourceBefore = { signature: treeSignature(source), helper: await stat(helper), data: await stat(data) };
      const accountBefore = await stat(account);

      expect(syncTree(source, dest)).toMatchObject({ installed: [dest], failures: [] });
      expect((await stat(join(dest, "nested", "helper"))).mode & 0o777).toBe(0o755);
      expect((await stat(join(dest, "data.json"))).mode & 0o777).toBe(0o644);
      expect((await stat(dest)).mode & 0o200).toBe(0o200);
      expect(treeSignature(source)).toBe(sourceBefore.signature);
      expect((await stat(helper)).mode).toBe(sourceBefore.helper.mode);
      expect((await stat(data)).mtimeMs).toBe(sourceBefore.data.mtimeMs);
      expect(syncTree(source, dest).unchanged).toEqual([dest]);

      // An older copier could have left every generated destination readonly.
      for (const path of [join(dest, "nested", "helper"), join(dest, "nested"), dest]) await chmod(path, 0o555);
      for (const path of [join(dest, "data.json"), join(dest, ".pipiui-install.json")]) await chmod(path, 0o444);
      await chmod(data, 0o644); await writeFile(data, '{"version":22}\n'); await chmod(data, 0o444);
      const refreshedSource = treeSignature(source);
      expect(syncTree(source, dest)).toMatchObject({ installed: [dest], failures: [] });
      expect(await readFile(join(dest, "data.json"), "utf8")).toBe('{"version":22}\n');
      expect((await stat(join(dest, "nested", "helper"))).mode & 0o111).toBe(0o111);
      expect(treeSignature(source)).toBe(refreshedSource);
      expect((await stat(source)).mode & 0o777).toBe(0o555);
      expect((await stat(nested)).mode & 0o777).toBe(0o555);
      expect((await stat(data)).mode & 0o777).toBe(0o444);
      expect(await readFile(account, "utf8")).toBe("unrelated account sentinel\n");
      expect((await stat(account)).mode).toBe(accountBefore.mode);
      expect((await stat(account)).mtimeMs).toBe(accountBefore.mtimeMs);
      expect((await readdir(root)).filter(name => name.includes(".staging-") || name.includes(".previous-"))).toEqual([]);
    } finally { await removeReadonlyFixture(root) }
  });

  it.skipIf(process.getuid?.() === 0)("reports the copy error after a partial readonly copy and preserves the previous destination", async () => {
    const root = await temp();
    try {
      const source = join(root, "source"), ready = join(source, "ready"), dest = join(root, "kernel");
      await mkdir(ready, { recursive: true }); await mkdir(dest);
      await writeFile(join(ready, "leaf.js"), "partial staged content\n");
      await writeFile(join(source, "z-blocked.js"), "unreadable source\n");
      await writeFile(join(dest, "old.js"), "previous runtime\n");
      await chmod(join(ready, "leaf.js"), 0o444); await chmod(ready, 0o555);
      await chmod(join(source, "z-blocked.js"), 0o000); await chmod(source, 0o555);
      await chmod(join(dest, "old.js"), 0o444); await chmod(dest, 0o555);
      const oldFile = await stat(join(dest, "old.js")), oldDirectory = await stat(dest);

      const report = syncTree(source, dest);
      expect(report.installed).toEqual([]);
      expect(report.failures).toHaveLength(1);
      expect(report.failures[0]).toMatch(/EACCES|EPERM/);
      expect(report.failures[0]).not.toContain("ENOTEMPTY");
      expect(await readFile(join(dest, "old.js"), "utf8")).toBe("previous runtime\n");
      expect((await stat(join(dest, "old.js"))).mode).toBe(oldFile.mode);
      expect((await stat(join(dest, "old.js"))).mtimeMs).toBe(oldFile.mtimeMs);
      expect((await stat(dest)).mode).toBe(oldDirectory.mode);
      expect((await stat(dest)).mtimeMs).toBe(oldDirectory.mtimeMs);
      expect((await stat(join(source, "z-blocked.js"))).mode & 0o777).toBe(0o000);
      expect((await stat(ready)).mode & 0o777).toBe(0o555);
      expect((await readdir(root)).filter(name => name.includes(".staging-") || name.includes(".previous-"))).toEqual([]);
    } finally { await removeReadonlyFixture(root) }
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
