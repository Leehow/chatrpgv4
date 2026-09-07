import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assemblePiSpawn, SPAWN_CONTRACT_ENV, SPAWN_CONTRACT_VERSION } from "../src/spawn-assembly.js";
import {
  findSpawnMount,
  mountedExtensionIds,
  parseSpawnContract,
  readSpawnContract,
  SPAWN_CONTRACT_ENV as RUNTIME_SPAWN_CONTRACT_ENV,
  SPAWN_CONTRACT_VERSION as RUNTIME_SPAWN_CONTRACT_VERSION,
  workerSpawnMountArgs,
} from "../../../packs/agent-orchestration/spawn-contract.ts";

/**
 * The host and the worker assembler agree through one versioned JSON document
 * instead of ~15 untyped `PIPIUI_*_EXT` paths. The host build is rooted at
 * `src` and the runtime tree ships standalone, so neither half can import the
 * other; this file is the joint that keeps them honest — it writes the contract
 * with the real host writer and reads it back with the real runtime reader.
 */
describe("host → worker spawn contract round trip", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("agrees on the env key and the version on both sides", () => {
    expect(SPAWN_CONTRACT_ENV).toBe(RUNTIME_SPAWN_CONTRACT_ENV);
    expect(SPAWN_CONTRACT_VERSION).toBe(RUNTIME_SPAWN_CONTRACT_VERSION);
  });

  it("round-trips a real host spawn through the runtime reader", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-spawn-contract-"));
    const projectPkg = join(root, ".pi", "extensions", "hydra-tools");
    await mkdir(projectPkg, { recursive: true });
    await writeFile(join(projectPkg, "index.ts"), "export default () => {}\n");

    const { env } = assemblePiSpawn({
      cwd: root,
      projectRoot: root,
      kernel: {
        "core-prompt": "/runtime/pi-core-prompt/SYSTEM_BASE.md",
        "secret-vault": "/runtime/kernel/pipiui-secret-vault.ts",
        "prompt-observer": "/runtime/kernel/pipiui-prompt-observer.ts",
        "runtime-info": "/runtime/kernel/pipiui-runtime-info.ts",
      },
      registeredExtensions: [
        {
          id: "agent-orchestration",
          enabled: true,
          extensionPath: "/pkg/orchestration/agent/index.ts",
          tools: ["subagent"],
          layerDir: "/pkg/orchestration/agent/layers",
        },
        { id: "file-tools", enabled: true, extensionPath: "/pkg/coding/agent/index.ts", tools: ["reload_runtime"] },
        { id: "memory-extension", enabled: true, extensionPath: "/pkg/memory/agent/index.ts", tools: ["memory_query"] },
      ],
    });

    const contract = readSpawnContract(env);
    expect(contract).toBeDefined();
    expect(contract!.version).toBe(RUNTIME_SPAWN_CONTRACT_VERSION);
    expect(contract!.corePrompt).toBe("/runtime/pi-core-prompt/SYSTEM_BASE.md");
    expect(contract!.promptObserver).toBe("/runtime/kernel/pipiui-prompt-observer.ts");
    expect(contract!.layerDirs).toEqual(["/pkg/orchestration/agent/layers"]);
    expect(mountedExtensionIds(contract)).toEqual(["agent-orchestration", "file-tools", "memory-extension"]);
    expect(findSpawnMount(contract, "file-tools")!.tools).toEqual(["reload_runtime"]);
    expect(findSpawnMount(contract, "project:hydra-tools/index.ts")!.kind).toBe("project");
  });

  it("rebuilds the worker's `-e` list from what the host mounted, orchestration first", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-spawn-contract-"));
    const { env } = assemblePiSpawn({
      cwd: root,
      kernel: { "secret-vault": "/runtime/kernel/vault.ts", "runtime-info": "/runtime/kernel/info.ts" },
      registeredExtensions: [
        { id: "file-tools", enabled: true, extensionPath: "/pkg/coding/agent/index.ts" },
        { id: "agent-orchestration", enabled: true, extensionPath: "/pkg/orchestration/agent/index.ts" },
        { id: "memory-extension", enabled: true, extensionPath: "/pkg/memory/agent/index.ts" },
        { id: "skill-loader-extension", enabled: true, extensionPath: "/pkg/skills/agent/index.ts" },
      ],
    });
    const contract = readSpawnContract(env);
    // Kernel surfaces are host-only; memory and the skill loader reach a worker
    // through their own narrower gates, never a blanket remount.
    expect(workerSpawnMountArgs(contract, { first: ["agent-orchestration"] })).toEqual([
      "-e", "/pkg/orchestration/agent/index.ts",
      "-e", "/pkg/coding/agent/index.ts",
    ]);
  });

  it("refuses a document it cannot fully trust rather than mounting half of it", () => {
    expect(parseSpawnContract(undefined)).toBeUndefined();
    expect(parseSpawnContract("not json")).toBeUndefined();
    expect(parseSpawnContract(JSON.stringify({ version: 99, mounts: [] }))).toBeUndefined();
    expect(parseSpawnContract(JSON.stringify({ version: 1 }))).toBeUndefined();
    // A malformed entry is dropped; the rest of a valid document still loads.
    const partial = parseSpawnContract(JSON.stringify({
      version: 1,
      layerDirs: ["/layers", 7],
      mounts: [
        { id: "ok", kind: "extension", path: "/pkg/ok.js", worker: true },
        { id: "bad-kind", kind: "nonsense", path: "/pkg/bad.js", worker: true },
        { id: "no-path", kind: "extension", worker: true },
        { id: "ok", kind: "extension", path: "/pkg/duplicate.js", worker: true },
      ],
    }));
    expect(partial!.layerDirs).toEqual(["/layers"]);
    expect(partial!.mounts).toEqual([{ id: "ok", kind: "extension", path: "/pkg/ok.js", worker: true }]);
  });

  it("gives a worker with no contract nothing extra to mount", () => {
    expect(readSpawnContract({})).toBeUndefined();
    expect(workerSpawnMountArgs(undefined)).toEqual([]);
    expect(mountedExtensionIds(undefined)).toEqual([]);
  });
});
