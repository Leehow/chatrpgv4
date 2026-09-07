import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend, installRuntimeTree } from "../src/index.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

const repoSources = new URL("../../../resources/runtime/", import.meta.url).pathname;
const packsSource = new URL("../../../packs/", import.meta.url).pathname;

/**
 * The regression this whole path exists to prevent: a host that installs its runtime tree only
 * at startup hands a running app a frozen copy, so an edit under the kernel shows up in a
 * rebuild and never in the live session. Both spawns here come from one backend instance — no
 * relaunch — and the second must see the edit.
 *
 * Extension packages are the other half of the same question, and they answer it
 * differently: a package is mounted where it was installed, never copied into the
 * runtime tree, so an edit inside it is live with no refresh at all.
 */
describe("runtime tree refresh across spawns", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = "" });

  it("picks up a kernel edit on the next session without restarting the host", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-refresh-"));
    const cwd = join(root, "project");
    const sessionsRoot = join(root, "sessions");
    const sessionDir = join(sessionsRoot, "project");
    const runtimeRoot = join(root, "runtime");
    const sources = join(root, "runtime-source");
    await Promise.all([mkdir(cwd, { recursive: true }), mkdir(sessionDir, { recursive: true })]);
    await cp(repoSources, sources, { recursive: true, filter: path => !path.includes("node_modules") });
    // The one package this session mounts, installed the only way a package is
    // installed: its directory placed in the project's extensions home.
    const installedPack = join(projectPiAgentDir(cwd), "extensions", "work-method");
    await cp(join(packsSource, "work-method"), installedPack, { recursive: true });
    await writeFile(join(sessionDir, "session.jsonl"), `${JSON.stringify({
      type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd,
    })}\n`);

    const assets = { sourceRoot: sources };
    // What the host does at launch. Everything after this is the live-app question.
    expect(installRuntimeTree(assets, runtimeRoot).failures).toEqual([]);

    let sessionArgs: string[] = [];
    let spawnCount = 0;
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"), sessionsRoot, runtimeRoot, piPath: "node", runtimeAssets: assets,
      spawn: (_bin, _args, options) => {
        // Title helpers also spawn; they must not overwrite the session contract.
        spawnCount += 1;
        if (_args.includes("--session")) {
          sessionArgs = _args;
        }
        return spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any;
      },
    });

    await backend.handle("addProject", [cwd]);
    await backend.handle("sendPrompt", ["session-1", "first"]);
    // Several mounts arrive with -e and their order is the spawn's business, not
    // this test's: select by path so adding another mount cannot break it.
    const extensions = sessionArgs.flatMap((arg, index) => (arg === "-e" ? [sessionArgs[index + 1]] : []));
    // The kernel comes from the installed runtime tree…
    expect(extensions.find((p) => p === join(runtimeRoot, "kernel", "pipiui-update-center.ts"))).toBeDefined();
    // …and the package is mounted in place, out of the project's own home.
    expect(extensions.find((p) => p.endsWith(join(".pi", "agent", "extensions", "work-method", "agent", "index.ts")))).toBeDefined();

    const kernelFile = join(runtimeRoot, "kernel", "pipiui-update-center.ts");
    expect(await readFile(kernelFile, "utf8")).not.toContain("REFRESH-PROBE");

    // Edit the source the way a developer would while the app stays up.
    const sourceKernel = join(sources, "kernel", "pipiui-update-center.ts");
    await writeFile(sourceKernel, `${await readFile(sourceKernel, "utf8")}\n// REFRESH-PROBE\n`);
    // And edit the installed package, which no installer copies anywhere.
    const packEntry = join(installedPack, "agent", "index.ts");
    await writeFile(packEntry, `${await readFile(packEntry, "utf8")}\n// REFRESH-PROBE\n`);

    // Same live backend instance on purpose: the contract is that a spawn (not a
    // relaunch) re-reads the runtime tree. A second, never-spawned session gives
    // a guaranteed brand-new spawn; killing the first session's pi mid-turn
    // would strand that turn's busy state and prove nothing about refresh.
    const sessionTwoDir = join(sessionsRoot, "project2");
    await mkdir(sessionTwoDir, { recursive: true });
    await writeFile(join(sessionTwoDir, "session.jsonl"), `${JSON.stringify({
      type: "session", version: 3, id: "session-2", timestamp: "2026-08-10T00:00:00.000Z", cwd,
    })}\n`);
    const spawnCountBefore = spawnCount;
    await backend.handle("sendPrompt", ["session-2", "second"]);
    expect(spawnCount).toBeGreaterThan(spawnCountBefore);
    expect(await readFile(kernelFile, "utf8")).toContain("REFRESH-PROBE");
    expect(await readFile(packEntry, "utf8")).toContain("REFRESH-PROBE");
    // The installer never touched the package: it has no extension tree to sync.
    expect(await readFile(join(installedPack, "agent", "index.ts"), "utf8")).toContain("REFRESH-PROBE");
  }, 30_000);
});
