import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { installRuntimeTree } from "../src/runtime-install.js";

const shippedRuntime = new URL("../../../resources/runtime/", import.meta.url).pathname;
const gitPack = new URL("../../../packs/git-capability/", import.meta.url).pathname;

describe("Git header runtime artifact", () => {
  it("declares the branch menu inside its own package, next to the build that produces it", async () => {
    const manifest = JSON.parse(await readFile(join(gitPack, "pipiui-extension.json"), "utf8")) as {
      app?: { ui?: { headerActions?: Array<{ entry?: string }> } };
    };
    const entry = manifest.app?.ui?.headerActions?.[0]?.entry;
    expect(entry).toBe("app/dist/branch-menu.js");
    // The entry is package-relative, so the compiled half travels with the package
    // directory: copying `packs/git-capability/` into a project's
    // `.pi/agent/extensions/` is all an install is.
    expect(entry!.startsWith("/")).toBe(false);
    expect(entry!.split("/")).not.toContain("..");
    expect(existsSync(join(gitPack, "app", "vite.config.ts"))).toBe(true);
  });

  it("never reaches the shipped runtime tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipiui-git-header-runtime-"));
    try {
      const report = installRuntimeTree({ sourceRoot: shippedRuntime }, root);
      expect(report.failures).toEqual([]);
      // The base ships no packages, so there is no `extensions/` tree to carry a
      // compiled `dist/` half through and no keepDist pass that could.
      expect(existsSync(join(root, "extensions"))).toBe(false);
      expect(existsSync(join(root, "extensions", "git-capability"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
