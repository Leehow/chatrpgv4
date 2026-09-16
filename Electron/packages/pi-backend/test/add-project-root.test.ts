import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiHostBackend } from "../src/index.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
const temps: string[] = [];

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pipiui-add-project-"));
  temps.push(root);
  return root;
}

function backendFor(root: string) {
  return createPiHostBackend({
    agentDir: join(root, "agent"),
    sessionsRoot: join(root, "sessions"),
    runtimeRoot: join(root, "runtime"),
    runtimeAssets: { sourceRoot: runtimeSource },
    profileMode: "isolated",
  });
}

afterEach(async () => {
  // The backend's isolated project home keeps writing for a moment after
  // close(); retry rather than fail an assertion-clean test on ENOTEMPTY.
  while (temps.length) {
    await rm(temps.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      .catch(() => undefined);
  }
});

/**
 * A project root that is not a directory produces a project that can never
 * work: nothing to scan for extensions and nowhere to keep the per-project
 * activation, so its form is `base` while sessions started in it keep the pack
 * snapshot they were stamped with (contract §43). The Electron shell cannot
 * make one — its picker only returns real folders — but the remote browser
 * shell asks for a typed path, so `addProject` is the only common choke point.
 */
describe("addProject refuses a root that is not a directory", () => {
  it("refuses a bare name and leaves the project list untouched", async () => {
    const root = await scratch();
    const backend = backendFor(root);
    try {
      await expect(backend.handle("addProject", ["测试"])).rejects.toThrow(/绝对路径/);
      await expect(backend.handle("listProjects", [])).resolves.toEqual([]);
    } finally {
      await backend.close();
    }
  });

  it("refuses a relative path", async () => {
    const root = await scratch();
    const backend = backendFor(root);
    try {
      await expect(backend.handle("addProject", ["./code/my-project"])).rejects.toThrow(/绝对路径/);
      await expect(backend.handle("listProjects", [])).resolves.toEqual([]);
    } finally {
      await backend.close();
    }
  });

  it("refuses an absolute path that does not exist", async () => {
    const root = await scratch();
    const backend = backendFor(root);
    try {
      await expect(backend.handle("addProject", [join(root, "no-such-folder")])).rejects.toThrow(/不存在/);
      await expect(backend.handle("listProjects", [])).resolves.toEqual([]);
    } finally {
      await backend.close();
    }
  });

  it("refuses an absolute path that is a file", async () => {
    const root = await scratch();
    const file = join(root, "module.pdf");
    await writeFile(file, "not a folder");
    const backend = backendFor(root);
    try {
      await expect(backend.handle("addProject", [file])).rejects.toThrow(/不是文件夹/);
      await expect(backend.handle("listProjects", [])).resolves.toEqual([]);
    } finally {
      await backend.close();
    }
  });

  it("still accepts a real directory", async () => {
    const root = await scratch();
    const project = await scratch();
    const backend = backendFor(root);
    try {
      await expect(backend.handle("addProject", [project])).resolves.toMatchObject({ path: project });
      await expect(backend.handle("listProjects", [])).resolves.toMatchObject([{ path: project }]);
    } finally {
      await backend.close();
    }
  });
});
