import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import { loadRuntimeAgents } from "../src/load-runtime-agents.js";

const here = dirname(fileURLToPath(import.meta.url));
const sourceAgentsTs = resolve(here, "../../../packs/agent-orchestration/subagent/agents.ts");
const sourceAgentsJs = resolve(here, "../../../packs/agent-orchestration/subagent/agents.js");
const sourceAgentsDts = resolve(here, "../../../packs/agent-orchestration/subagent/agents.d.ts");
const loaderSource = resolve(here, "../src/load-runtime-agents.ts");
const bundleScript = resolve(here, "../scripts/bundle-runtime-agents.mjs");
const srcBundle = resolve(here, "../src/runtime-agents.bundle.mjs");
const tsconfig = resolve(here, "../tsconfig.json");
const tscBin = resolve(here, "../../../node_modules/typescript/bin/tsc");
const workspaceAgentsDir = resolve(here, "../../../packs/agent-orchestration/agents");

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const SAMPLE_AGENT = `---
schema: 1
name: explore
description: Packaged-like explore agent used to exercise the bundled parser.
mode: read-only
capabilities:
  filesystem: read-only
  shell: false
  web: false
  mcp: false
  desktop: none
  delegation: false
worktree: none
deliverable: report
tools: read, grep, find, ls
---

You are an explore subagent.
`;

describe("runtime agents source loader", () => {
  it("never names a packs/ path: the host loader has no runtime dependency on a package", async () => {
    const source = await readFile(loaderSource, "utf8");
    // `packs/` is repo source that never ships. The catalog core reaches the host
    // only through the build-time bundle, so no path into a package may appear in
    // a module the packaged app loads.
    expect(source).not.toContain("packs/agent-orchestration");
    expect(source).not.toMatch(/subagent\/agents\.(ts|js)/);
    expect(source).toContain("runtime-agents.bundle.mjs");
  });

  it("bundles agents.ts, and only agents.ts, as the source of truth", async () => {
    const script = await readFile(bundleScript, "utf8");
    // The one place that names the source, and it runs at build time.
    expect(script).toContain("packs/agent-orchestration/subagent/agents.ts");
    expect(script).not.toContain("packs/agent-orchestration/subagent/agents.js");
    expect(existsSync(sourceAgentsTs)).toBe(true);
    expect(existsSync(sourceAgentsJs)).toBe(false);
    expect(existsSync(sourceAgentsDts)).toBe(false);
  });

  it("loads discovery exports from the bundled runtime core", async () => {
    const runtime = await loadRuntimeAgents();
    expect(typeof runtime.discoverAgentsFromRoots).toBe("function");
    expect(typeof runtime.discoverBundledAgentsFromDirectory).toBe("function");
    expect(typeof runtime.applyExtensionAgentContributions).toBe("function");
    expect(typeof runtime.isCanonicalPrivilegedBundledRole).toBe("function");
    expect(runtime.isCanonicalPrivilegedBundledRole("secretary", "bundled")).toBe(true);
    expect(runtime.isCanonicalPrivilegedBundledRole("explore", "project")).toBe(false);
    const bundled = runtime.discoverBundledAgentsFromDirectory(workspaceAgentsDir);
    expect(bundled.agents.map((agent) => agent.name)).toEqual(expect.arrayContaining(["explore", "secretary"]));
  });

  it("tsc emit includes the loader and the dependency-closure bundle", async () => {
    execFileSync(process.execPath, [bundleScript], { cwd: resolve(here, ".."), stdio: "pipe" });
    root = resolve(here, "../.tmp-loader-emit");
    await rm(root, { recursive: true, force: true });
    execFileSync(process.execPath, [
      tscBin,
      "-p",
      tsconfig,
      "--outDir",
      root,
      "--rootDir",
      resolve(here, "../src"),
      "--composite",
      "false",
      "--declaration",
      "true",
      "--noEmit",
      "false",
    ], { cwd: resolve(here, ".."), stdio: "pipe" });
    const emittedJs = join(root, "load-runtime-agents.js");
    const emittedDts = join(root, "load-runtime-agents.d.ts");
    expect(existsSync(emittedJs)).toBe(true);
    expect(existsSync(emittedDts)).toBe(true);
    const emitted = await readFile(emittedJs, "utf8");
    expect(emitted).toContain("runtime-agents.bundle.mjs");
    expect(emitted).not.toContain("packs/agent-orchestration");
    expect(emitted).not.toMatch(/subagent\/agents\.(ts|js)/);
    await copyFile(srcBundle, join(root, "runtime-agents.bundle.mjs"));
    const distMod = await import(emittedJs) as {
      loadRuntimeAgents: () => Promise<{
        isCanonicalPrivilegedBundledRole: (name: string, origin: string) => boolean;
      }>;
    };
    const runtime = await distMod.loadRuntimeAgents();
    expect(runtime.isCanonicalPrivilegedBundledRole("secretary", "bundled")).toBe(true);
  });

  it("loads parse/discover/apply from a temp packaged-like tree with no Electron/node_modules ancestor", async () => {
    execFileSync(process.execPath, [bundleScript], { cwd: resolve(here, ".."), stdio: "pipe" });
    expect(existsSync(srcBundle)).toBe(true);
    const bundledSource = await readFile(srcBundle, "utf8");
    expect(bundledSource).not.toMatch(/from\s+["']@earendil-works\/pi-coding-agent["']/);
    expect(bundledSource).toMatch(/yamlString|parseFrontmatter|explore/);

    root = await mkdtemp(join(tmpdir(), "pipi-packaged-agents-core-"));
    expect(root.includes(`${sep}Electron${sep}`)).toBe(false);
    const dest = join(root, "runtime-agents.bundle.mjs");
    await copyFile(srcBundle, dest);
    const agentsDir = join(root, "agents", "explore");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "AGENT.md"), SAMPLE_AGENT);
    const extRoot = join(root, "ext");
    await mkdir(extRoot, { recursive: true });
    const probe = join(root, "probe.mjs");
    await writeFile(probe, `
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
if (here.includes("/Electron/") || here.includes("/node_modules/")) {
  throw new Error("packaged-like tree must not sit under Electron or node_modules");
}
const mod = await import(pathToFileURL(join(here, "runtime-agents.bundle.mjs")).href);
if (typeof mod.discoverBundledAgentsFromDirectory !== "function") throw new Error("missing discover");
if (typeof mod.applyExtensionAgentContributions !== "function") throw new Error("missing apply");
if (typeof mod.discoverAgentsFromRoots !== "function") throw new Error("missing discoverFromRoots");
if (!mod.isCanonicalPrivilegedBundledRole("secretary", "bundled")) throw new Error("canonical");
const discovered = mod.discoverBundledAgentsFromDirectory(join(here, "agents"));
if (!discovered.agents.some((agent) => agent.name === "explore")) {
  throw new Error("parse/discover failed: " + JSON.stringify(discovered.diagnostics));
}
const explore = discovered.agents.find((agent) => agent.name === "explore");
if (explore.capabilities.filesystem !== "read-only") throw new Error("capabilities not parsed");
const merged = mod.applyExtensionAgentContributions(discovered, {
  extensions: [{
    id: "ext-packaged-core",
    origin: "project",
    root: join(here, "ext"),
    agents: [],
    patches: [{ target: "explore", addTools: ["read"] }],
    providedTools: [],
  }],
  diagnostics: [],
});
const applied = merged.appliedPatches ?? [];
if (!applied.some((patch) => patch.extensionId === "ext-packaged-core" && patch.operations.includes("addTools"))) {
  throw new Error("apply failed: " + JSON.stringify(merged.diagnostics));
}
console.log(JSON.stringify({
  names: discovered.agents.map((agent) => agent.name),
  applied: applied.map((patch) => patch.operations),
}));
`);
    const env = { ...process.env, NODE_PATH: "" };
    delete env.NODE_PATH;
    const output = execFileSync(process.execPath, [probe], {
      cwd: root,
      env: { ...env, NODE_PATH: "" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as {
      names: string[];
      applied: string[][];
    };
    expect(parsed.names).toContain("explore");
    expect(parsed.applied.some((ops) => ops.includes("addTools"))).toBe(true);
  });
});
