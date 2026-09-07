import { afterEach, describe, expect, it } from "vitest";
import { existsSync, realpathSync, statSync, symlinkSync, chmodSync, linkSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CONTRIBUTIONS_ENV, AGENT_CONTRIBUTIONS_ENV_MAX_BYTES, AGENT_CONTRIBUTIONS_FILE_ENV, AGENT_CONTRIBUTIONS_HOST_MAX_BYTES, AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV, assemblePiSpawn, buildVersionedAgentContributionSnapshot, contributionSidecarName, contributionSidecarTempPattern, extensionSettingsEnvName, GOAL_AUTO_RESUME_ENV, isElectronNodeShim, KERNEL_MOUNTS, mergedSpawnEnvironment, MOUNTED_EXTENSIONS_ENV, projectExtensionMounts, removeContributionSnapshotSidecar, resolveContributionSnapshotFile, resolveKernelPaths, resolveRuntimeLayout, sanitizeEnvironment, serializeAgentContributions, SPAWN_CONTRACT_ENV, userExtensionMounts, workerAgentContributionsSnapshot, withToolPath } from "../src/spawn-assembly.js";
import { applySessionMountsToMainEnv, applySessionMountsToWorkerEnv } from "../src/secret-vault.js";
import gitCapability from "../../../packs/git-capability/agent/index.ts";

const RUNTIME_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime");
const PACKS_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packs");

/** Only `-e` values, in mount order — the observable the spec's spawn seam is about. */
function mounts(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === "-e") out.push(args[index + 1]!);
  return out;
}

function contract(env: Record<string, string>): {
  version: number;
  corePrompt?: string;
  promptObserver?: string;
  layerDirs: string[];
  mounts: { id: string; kind: string; path: string; worker: boolean; tools?: string[] }[];
} {
  return JSON.parse(env[SPAWN_CONTRACT_ENV]!);
}

/**
 * The whole loader, stated once.
 *
 * `assemblePiSpawn` mounts three things and nothing else: the kernel table, the
 * registry's manifest packages, and the project's own pi extensions. These
 * cases assert the produced argv and env for a given set of those inputs — not
 * the filenames a previous resolver happened to look for — so the assertions
 * survive any renaming inside the runtime tree.
 */
describe("the spawn loader mounts exactly kernel, manifest packages, and project extensions", () => {
  const kernel = {
    "core-prompt": "/runtime/pi-core-prompt/SYSTEM_BASE.md",
    "secret-vault": "/runtime/kernel/pipiui-secret-vault.ts",
    "context-fold": "/runtime/pi-ext/packages/context-fold/index.ts",
    "update-center": "/runtime/kernel/pipiui-update-center.ts",
    "runtime-info": "/runtime/kernel/pipiui-runtime-info.ts",
    "prompt-observer": "/runtime/kernel/pipiui-prompt-observer.ts",
  } as const;

  it("mounts the kernel in load order and brackets the manifest packages with it", () => {
    const { args } = assemblePiSpawn({
      cwd: "/tmp/project",
      kernel,
      registeredExtensions: [
        { id: "alpha-extension", enabled: true, extensionPath: "/pkg/alpha/agent/index.js" },
        { id: "beta-extension", enabled: true, extensionPath: "/pkg/beta/agent/index.js" },
      ],
    });
    expect(mounts(args)).toEqual([
      kernel["secret-vault"],
      kernel["context-fold"],
      "/pkg/alpha/agent/index.js",
      "/pkg/beta/agent/index.js",
      kernel["update-center"],
      kernel["runtime-info"],
    ]);
  });

  it("keeps runtime-info last so its read-only observer sees the final rewritten payload", () => {
    const { args } = assemblePiSpawn({
      cwd: "/tmp/project",
      kernel,
      registeredExtensions: [{ id: "late-extension", enabled: true, extensionPath: "/pkg/late/agent/index.js" }],
    });
    const order = mounts(args);
    expect(order[order.length - 1]).toBe(kernel["runtime-info"]);
    expect(order.indexOf(kernel["update-center"])).toBeLessThan(order.indexOf(kernel["runtime-info"]));
  });

  it("mounts the kernel with or without a host bridge — it is not a capability", () => {
    const bare = assemblePiSpawn({ cwd: "/tmp/project", kernel });
    const bridged = assemblePiSpawn({ cwd: "/tmp/project", kernel, bridgePort: 1234, sessionCapability: "cap" });
    expect(mounts(bare.args)).toEqual(mounts(bridged.args));
  });

  it("pushes the locked base prompt first and never mounts the prompt observer in the main session", () => {
    const { args, env } = assemblePiSpawn({ cwd: "/tmp/project", kernel });
    expect(args.slice(0, 2)).toEqual(["--append-system-prompt", kernel["core-prompt"]]);
    expect(mounts(args)).not.toContain(kernel["prompt-observer"]);
    // Workers assemble their own argv, so the observer travels to them as a path.
    expect(env.PIPIUI_PROMPT_OBSERVER_EXT).toBe(kernel["prompt-observer"]);
  });

  it("mounts nothing at all for a deliberately bare helper spawn", () => {
    expect(assemblePiSpawn({ cwd: "/tmp/project" }).args).toEqual([]);
    expect(assemblePiSpawn({ cwd: "/tmp/project", kernel: {} }).args).toEqual([]);
  });

  it("omits an unresolved kernel surface instead of guessing a path", () => {
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", kernel: { "context-fold": "/runtime/fold.ts" } });
    expect(mounts(args)).toEqual(["/runtime/fold.ts"]);
  });

  it("mounts a disabled or entry-less manifest package never, whatever else is enabled", () => {
    const { args } = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [
        { id: "off-extension", enabled: false, extensionPath: "/pkg/off/agent/index.js" },
        { id: "declarative-extension", enabled: true },
        { id: "on-extension", enabled: true, extensionPath: "/pkg/on/agent/index.js" },
      ],
    });
    expect(mounts(args)).toEqual(["/pkg/on/agent/index.js"]);
  });

  it("every kernel row states why it is not an extension", () => {
    for (const entry of KERNEL_MOUNTS) {
      expect(entry.because.length, `${entry.id} justifies its kernel membership`).toBeGreaterThan(40);
    }
  });

  it("resolves the kernel surfaces the shipped runtime tree actually installs", () => {
    const resolved = resolveKernelPaths(RUNTIME_SOURCE);
    expect(resolved["core-prompt"]).toBe(join(RUNTIME_SOURCE, "pi-core-prompt", "SYSTEM_BASE.md"));
    expect(resolved["secret-vault"]).toBe(join(RUNTIME_SOURCE, "kernel", "pipiui-secret-vault.ts"));
    expect(resolved["update-center"]).toBe(join(RUNTIME_SOURCE, "kernel", "pipiui-update-center.ts"));
    expect(resolved["runtime-info"]).toBe(join(RUNTIME_SOURCE, "kernel", "pipiui-runtime-info.ts"));
    expect(resolved["prompt-observer"]).toBe(join(RUNTIME_SOURCE, "kernel", "pipiui-prompt-observer.ts"));
    expect(resolved["context-fold"]).toBe(join(RUNTIME_SOURCE, "pi-ext", "packages", "context-fold", "index.ts"));
  });

  it("resolves nothing at all for a root the app never installed into", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipiui-empty-runtime-"));
    try {
      expect(Object.values(resolveKernelPaths(root)).filter(Boolean)).toEqual([]);
      expect(Object.values(resolveRuntimeLayout(root)).filter(Boolean)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ships no extension tree at all — every package is a directory under packs/", () => {
    expect(existsSync(join(RUNTIME_SOURCE, "extensions"))).toBe(false);
    const entries = readdirSync(PACKS_SOURCE, { withFileTypes: true });
    const loose = entries.filter((entry) => !entry.isDirectory() && entry.name !== "package.json");
    expect(loose.map((entry) => entry.name)).toEqual([]);
    for (const entry of entries.filter((item) => item.isDirectory())) {
      expect(
        existsSync(join(PACKS_SOURCE, entry.name, "pipiui-extension.json")),
        `${entry.name} carries a manifest`,
      ).toBe(true);
    }
  });
});

/**
 * Prompt layers are additive.
 *
 * The only producer used to *assign* a single directory, so a second
 * layer-owning package was silently clobbered even though the consumer has
 * always parsed a delimiter-joined list.
 */
describe("prompt layer directories", () => {
  it("appends every enabled package's declared layers, in mount order", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [
        { id: "a-extension", enabled: true, extensionPath: "/pkg/a/agent/index.js", layerDir: "/pkg/a/agent/layers" },
        { id: "b-extension", enabled: true, extensionPath: "/pkg/b/agent/index.js", layerDir: "/pkg/b/agent/layers" },
      ],
    });
    expect(env.PIPI_PHILOSOPHY_LAYER_DIRS).toBe(["/pkg/a/agent/layers", "/pkg/b/agent/layers"].join(delimiter));
  });

  it("contributes nothing for a disabled or unmounted layer owner", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [
        { id: "a-extension", enabled: false, extensionPath: "/pkg/a/agent/index.js", layerDir: "/pkg/a/agent/layers" },
      ],
    });
    expect(env.PIPI_PHILOSOPHY_LAYER_DIRS).toBeUndefined();
  });
});

describe("product persona replacement (agent.systemPrompt)", () => {
  it("replaces Pi's default frame with the first enabled declarer's persona file", () => {
    const root = mkdtempSync(join(tmpdir(), "pipi-persona-"));
    try {
      const persona = join(root, "persona.md");
      writeFileSync(persona, "You are a research writing assistant.\n");
      writeFileSync(join(root, "other.md"), "You are something else.\n");
      const { args } = assemblePiSpawn({
        cwd: "/tmp/project",
        registeredExtensions: [
          { id: "paper-workbench", enabled: true, systemPrompt: persona },
          { id: "rival-workbench", enabled: true, systemPrompt: join(root, "other.md") },
        ],
      });
      const index = args.indexOf("--system-prompt");
      expect(index).toBeGreaterThan(-1);
      expect(args[index + 1]).toContain("research writing assistant");
      // Single-assignment: the second declarer never reaches argv.
      expect(args.filter(arg => arg === "--system-prompt")).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps Pi's default frame when no enabled package declares a persona", () => {
    const { args } = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [{ id: "a-extension", enabled: true, extensionPath: "/pkg/a/agent/index.js" }],
    });
    expect(args).not.toContain("--system-prompt");
  });

  it("ignores a persona file that vanished instead of passing an empty frame", () => {
    const { args } = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [{ id: "paper-workbench", enabled: true, systemPrompt: "/nonexistent/persona.md" }],
    });
    expect(args).not.toContain("--system-prompt");
  });
});

/**
 * The third mount source (spec D3 / D13): the project's own plain pi
 * extensions. Electron starts pi with `--no-extensions`, so if this resolver
 * did not exist a file a user dropped into their repository would silently
 * never load.
 */
describe("project-local pi extensions", () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("mounts a `.pi/extensions/<pkg>` directory declaring pi.extensions, after kernel and manifest packages", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-project-ext-"));
    const pkg = join(root, ".pi", "extensions", "hydra-tools");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "index.ts"), "export default () => {}\n");
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "hydra-tools", pi: { extensions: ["./index.ts"] } }));
    const { args } = assemblePiSpawn({
      cwd: root,
      projectRoot: root,
      kernel: { "runtime-info": "/runtime/kernel/pipiui-runtime-info.ts" },
      registeredExtensions: [{ id: "some-extension", enabled: true, extensionPath: "/pkg/some/agent/index.js" }],
    });
    expect(mounts(args)).toEqual([
      "/pkg/some/agent/index.js",
      join(pkg, "index.ts"),
      "/runtime/kernel/pipiui-runtime-info.ts",
    ]);
  });

  it("mounts a bare index.ts directory and a loose file, and keeps the historical user-extensions root", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-project-ext-"));
    const bare = join(root, ".pi", "extensions", "bare-tools");
    await mkdir(bare, { recursive: true });
    await writeFile(join(bare, "index.ts"), "export default () => {}\n");
    await writeFile(join(root, ".pi", "extensions", "loose.ts"), "export default () => {}\n");
    const agentDir = join(root, ".pi", "agent");
    await mkdir(join(agentDir, "user-extensions"), { recursive: true });
    await writeFile(join(agentDir, "user-extensions", "legacy.ts"), "export default () => {}\n");
    const { args } = assemblePiSpawn({ cwd: root, projectRoot: root, agentDir });
    expect(mounts(args)).toEqual([
      join(agentDir, "user-extensions", "legacy.ts"),
      join(bare, "index.ts"),
      join(root, ".pi", "extensions", "loose.ts"),
    ]);
    expect(userExtensionMounts(agentDir)).toEqual([join(agentDir, "user-extensions", "legacy.ts")]);
  });

  it("mounts one file once even when both roots reach the same inode", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-project-ext-"));
    const agentDir = join(root, ".pi", "agent");
    await mkdir(join(agentDir, "user-extensions"), { recursive: true });
    await mkdir(join(root, ".pi", "extensions"), { recursive: true });
    await writeFile(join(agentDir, "user-extensions", "shared.ts"), "export default () => {}\n");
    symlinkSync(join(agentDir, "user-extensions", "shared.ts"), join(root, ".pi", "extensions", "shared.ts"));
    expect(projectExtensionMounts({ agentDir, projectRoot: root }))
      .toEqual([join(agentDir, "user-extensions", "shared.ts")]);
  });

  it("mounts every entry a package declares, not only the first", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-project-ext-"));
    const pkg = join(root, ".pi", "extensions", "multi-tools");
    await mkdir(pkg, { recursive: true });
    for (const name of ["core.ts", "workflows.ts", "plan.ts"]) {
      await writeFile(join(pkg, name), "export default () => {}\n");
    }
    await writeFile(join(pkg, "package.json"), JSON.stringify({
      name: "multi-tools",
      pi: { extensions: ["./core.ts", "./workflows.ts", "./plan.ts", "./absent.ts"] },
    }));
    expect(projectExtensionMounts({ projectRoot: root })).toEqual([
      join(pkg, "core.ts"),
      join(pkg, "plan.ts"),
      join(pkg, "workflows.ts"),
    ]);
  });

  it("follows a declared entry elsewhere in the project but refuses one that climbs out", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-project-ext-"));
    const outside = await mkdtemp(join(tmpdir(), "pipiui-outside-"));
    try {
      await writeFile(join(outside, "stranger.ts"), "export default () => {}\n");
      const sibling = join(root, ".pi", "agent", "extensions", "hydra-core", "agent");
      await mkdir(sibling, { recursive: true });
      await writeFile(join(sibling, "index.ts"), "export default () => {}\n");
      const shim = join(root, ".pi", "extensions", "shim");
      await mkdir(shim, { recursive: true });
      await writeFile(join(shim, "package.json"), JSON.stringify({
        name: "shim",
        pi: { extensions: ["../../agent/extensions/hydra-core/agent/index.ts", join(outside, "stranger.ts")] },
      }));
      expect(projectExtensionMounts({ projectRoot: root })).toEqual([join(sibling, "index.ts")]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not mount a manifest package a second time through a project shim", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-project-ext-"));
    const agentHalf = join(root, ".pi", "agent", "extensions", "hydra-core", "agent");
    await mkdir(agentHalf, { recursive: true });
    await writeFile(join(agentHalf, "index.ts"), "export default () => {}\n");
    const shim = join(root, ".pi", "extensions", "hydra-tools");
    await mkdir(shim, { recursive: true });
    await writeFile(join(shim, "package.json"), JSON.stringify({
      name: "hydra-tools",
      pi: { extensions: ["../../agent/extensions/hydra-core/agent/index.ts"] },
    }));
    const { args } = assemblePiSpawn({
      cwd: root,
      projectRoot: root,
      registeredExtensions: [{ id: "hydra-core", enabled: true, extensionPath: join(agentHalf, "index.ts") }],
    });
    expect(mounts(args)).toEqual([join(agentHalf, "index.ts")]);
  });

  it("skips dotfiles, node_modules, and a directory with no resolvable entry", async () => {
    root = await mkdtemp(join(tmpdir(), "pipiui-project-ext-"));
    const extensions = join(root, ".pi", "extensions");
    await mkdir(join(extensions, "node_modules"), { recursive: true });
    await mkdir(join(extensions, ".hidden"), { recursive: true });
    await mkdir(join(extensions, "no-entry"), { recursive: true });
    await writeFile(join(extensions, "no-entry", "README.md"), "#\n");
    await writeFile(join(extensions, ".hidden.ts"), "export default () => {}\n");
    expect(projectExtensionMounts({ projectRoot: root })).toEqual([]);
  });
});

/**
 * The spawn contract: one env key replacing the family of `PIPIUI_*_EXT` paths
 * a worker used to reassemble its own argv from.
 */
describe("spawn contract published to the child", () => {
  it("describes every mount with its origin, remountability, and declared tools", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      kernel: { "secret-vault": "/runtime/kernel/vault.ts", "prompt-observer": "/runtime/kernel/observer.ts", "core-prompt": "/runtime/base.md" },
      registeredExtensions: [
        { id: "plan-extension", enabled: true, extensionPath: "/pkg/plan/agent/index.ts", tools: ["plan_publish"] },
        { id: "memory-extension", enabled: true, extensionPath: "/pkg/memory/agent/index.ts", tools: ["memory_query"] },
      ],
    });
    const document = contract(env);
    expect(document.version).toBe(1);
    expect(document.corePrompt).toBe("/runtime/base.md");
    expect(document.promptObserver).toBe("/runtime/kernel/observer.ts");
    expect(document.mounts).toEqual([
      { id: "kernel:secret-vault", kind: "kernel", path: "/runtime/kernel/vault.ts", worker: false },
      { id: "plan-extension", kind: "extension", path: "/pkg/plan/agent/index.ts", worker: true, tools: ["plan_publish"] },
      // The memory half only reaches a worker through the broker's issued, role-scoped identity.
      { id: "memory-extension", kind: "extension", path: "/pkg/memory/agent/index.ts", worker: false, tools: ["memory_query"] },
    ]);
  });

  it("marks project-local extensions remountable and names them by their own file", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipiui-contract-"));
    try {
      const pkg = join(root, ".pi", "extensions", "hydra-tools");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "index.ts"), "export default () => {}\n");
      const { env } = assemblePiSpawn({ cwd: root, projectRoot: root });
      expect(contract(env).mounts).toEqual([
        { id: "project:hydra-tools/index.ts", kind: "project", path: join(pkg, "index.ts"), worker: true },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is stripped from inherited environments so a stale contract can never resurrect a mount", () => {
    expect(sanitizeEnvironment({ [SPAWN_CONTRACT_ENV]: "{}", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });
});

/**
 * Host-owned runtime layout: facts about the installed tree, published as
 * environment. Not mounts, and not gated on any extension being enabled.
 */
describe("runtime layout environment", () => {
  it("publishes only the managed Hermes root — catalogs belong to packages", () => {
    const runtime = { hermesMemory: "/runtime/managed/node_modules/pi-hermes-memory" };
    const { env } = assemblePiSpawn({ cwd: "/tmp/project", runtime });
    expect(env.PIPIUI_HERMES_PACKAGE_ROOT).toBe("/runtime/managed/node_modules/pi-hermes-memory");
    expect(env.PIPIUI_HERMES_NODE_MODULES_ROOT).toBe("/runtime/managed/node_modules");
    // A bare base has no AGENT.md catalog and no skill root: neither is a fact
    // about the installed tree any more, so nothing publishes one.
    expect(env.PIPIUI_AGENTS_DIR).toBeUndefined();
    expect(env.PIPIUI_SKILL_ROOTS).toBeUndefined();
  });

  it("publishes the AGENT.md catalog and skill roots the enabled packages declare", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [
        { id: "built-in-skills", enabled: true, skillRoots: ["/packs/built-in-skills/skills"] },
        { id: "agent-orchestration", enabled: true, agentsDir: "/packs/agent-orchestration/agents" },
      ],
    });
    expect(env.PIPIUI_AGENTS_DIR).toBe("/packs/agent-orchestration/agents");
    expect(env.PIPIUI_SKILL_ROOTS).toBe("/packs/built-in-skills/skills");
  });

  it("ignores a disabled package's catalog and skill root", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [
        { id: "built-in-skills", enabled: false, skillRoots: ["/packs/built-in-skills/skills"] },
        { id: "agent-orchestration", enabled: false, agentsDir: "/packs/agent-orchestration/agents" },
      ],
    });
    expect(env.PIPIUI_AGENTS_DIR).toBeUndefined();
    expect(env.PIPIUI_SKILL_ROOTS).toBeUndefined();
  });

  it("resolves the layout the shipped runtime tree actually installs", () => {
    const layout = resolveRuntimeLayout(RUNTIME_SOURCE);
    // Nothing but the managed npm root can come from the tree now, and a dev
    // checkout has not installed one.
    expect(Object.keys(layout)).toEqual([]);
  });

  it("names pi as the single worktree finalizer regardless of what is mounted", () => {
    expect(assemblePiSpawn({ cwd: "/tmp/project" }).env.PIPIUI_WORKTREE_FINALIZER).toBe("pi");
    expect(mergedSpawnEnvironment({ PIPIUI_WORKTREE_FINALIZER: "evil" }, {}, {}).PIPIUI_WORKTREE_FINALIZER).toBeUndefined();
  });
});

describe("secret-bearing registry extension mount", () => {
  const ocrExtensionPath = "/runtime/extensions/ocr-extension/agent/dist/index.js";

  it("delivers vault-backed secrets only for uniquely-mounted enabled extensions", () => {
    const secretEnv = { EXT_OCR_EXTENSION_TOKEN: "ast-secret" };
    const { env, args } = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [
        { id: "other-ext", enabled: true, extensionPath: "/runtime/extensions/other.js" },
        { id: "ocr-extension", enabled: true, extensionPath: ocrExtensionPath, secretEnv },
      ],
    });
    expect(mounts(args)).toEqual(["/runtime/extensions/other.js", ocrExtensionPath]);
    expect(env.EXT_OCR_EXTENSION_TOKEN).toBe("ast-secret");
    const disabledEnv = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [{ id: "ocr-extension", enabled: false, extensionPath: ocrExtensionPath, secretEnv }],
    }).env;
    expect(disabledEnv.EXT_OCR_EXTENSION_TOKEN).toBeUndefined();
    // Same inode mounted twice: ownership is ambiguous, so neither the mount nor its secrets ship.
    const conflicted = assemblePiSpawn({
      cwd: "/tmp/project",
      registeredExtensions: [
        { id: "a-copy", enabled: true, extensionPath: ocrExtensionPath, secretEnv },
        { id: "b-copy", enabled: true, extensionPath: ocrExtensionPath, secretEnv },
      ],
    });
    expect(conflicted.args).not.toContain(ocrExtensionPath);
    expect(conflicted.env.EXT_OCR_EXTENSION_TOKEN).toBeUndefined();
  });
});

describe("git capability package", () => {
  it("keeps the Git provider's public tool and snapshot contract", () => {
    const tools: { name: string }[] = [];
    gitCapability({
      registerTool: (tool: { name: string }) => tools.push(tool),
      registerCommand: () => {},
      on: () => {},
    } as never);
    expect(tools.map((tool) => tool.name)).toContain("git");
  });
});

describe("explicit Pi resource mode", () => {
  it("disables ambient discovery while retaining explicit PipiUI mounts", () => {
    const { args } = assemblePiSpawn({
      cwd: "/tmp/project",
      resourceMode: "explicit",
      kernel: { "runtime-info": "/runtime/kernel/info.ts" },
    });
    expect(args.slice(0, 4)).toEqual(["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"]);
    expect(mounts(args)).toEqual(["/runtime/kernel/info.ts"]);
  });

  it("keeps generic callers on Pi's default discovery behavior", () => {
    expect(assemblePiSpawn({ cwd: "/tmp/project" }).args).not.toContain("--no-extensions");
  });
});
describe("mounted manifest extension marker and host internal env", () => {
  const updateCenter = "/runtime/update.ts";
  const runtimeInfo = "/runtime/info.ts";
  const packageAgent = "/pkg/image-provider/agent/dist/index.js";

  it("exports the mounted manifest extension ids so bare runtime extensions can yield tool ownership", () => {
    const { args, env } = assemblePiSpawn({
      cwd: "/tmp/project",
      kernel: { "update-center": updateCenter, "runtime-info": runtimeInfo },
      registeredExtensions: [{ id: "image-provider", enabled: true, extensionPath: packageAgent, settings: {} }],
    });
    expect(args).toContain(packageAgent);
    expect(env[MOUNTED_EXTENSIONS_ENV]).toBe("image-provider");
  });

  it("omits the marker when the extension is disabled or has no agent entry", () => {
    const disabled = assemblePiSpawn({
      cwd: "/tmp/project",
      kernel: { "update-center": updateCenter, "runtime-info": runtimeInfo },
      registeredExtensions: [{ id: "image-provider", enabled: false, extensionPath: packageAgent }],
    });
    expect(disabled.env[MOUNTED_EXTENSIONS_ENV]).toBeUndefined();
    const noPath = assemblePiSpawn({
      cwd: "/tmp/project",
      kernel: { "update-center": updateCenter, "runtime-info": runtimeInfo },
      registeredExtensions: [{ id: "image-provider", enabled: true }],
    });
    expect(noPath.env[MOUNTED_EXTENSIONS_ENV]).toBeUndefined();
  });

  it("merges host internal env last and strips inherited values", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      kernel: { "update-center": updateCenter, "runtime-info": runtimeInfo },
      internalEnv: { PIPIUI_EXT_INTERNAL_PROBE: "1" },
    });
    expect(env.PIPIUI_EXT_INTERNAL_PROBE).toBe("1");
    // A stale parent value never survives sanitization on its own.
    expect(sanitizeEnvironment({ PIPIUI_EXT_INTERNAL_PROBE: "1", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
    expect(sanitizeEnvironment({ [MOUNTED_EXTENSIONS_ENV]: "stale", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });

  it("lets a product cap nested dispatch only through internal env", () => {
    // PIPIUI_AGENT_* is stripped from parent/.env so a stale shell cannot raise the cap.
    expect(sanitizeEnvironment({ PIPIUI_AGENT_MAX_DEPTH: "2", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      kernel: { "update-center": updateCenter, "runtime-info": runtimeInfo },
      internalEnv: { PIPIUI_AGENT_MAX_DEPTH: "1" },
    });
    expect(env.PIPIUI_AGENT_MAX_DEPTH).toBe("1");
    expect(
      mergedSpawnEnvironment({ PIPIUI_AGENT_MAX_DEPTH: "2" }, { PIPIUI_AGENT_MAX_DEPTH: "2" }, {
        ...assemblePiSpawn({
          cwd: "/tmp/project",
          internalEnv: { PIPIUI_AGENT_MAX_DEPTH: "1" },
        }).env,
      }).PIPIUI_AGENT_MAX_DEPTH,
    ).toBe("1");
  });

  it("propagates goal auto-resume suppression only when requested and strips stale markers", () => {
    const blocked = assemblePiSpawn({
      sessionId: "s-archived",
      goalAutoResume: "blocked",
      cwd: "/tmp/project",
      kernel: { "update-center": updateCenter, "runtime-info": runtimeInfo },
    });
    expect(blocked.env[GOAL_AUTO_RESUME_ENV]).toBe("blocked");

    const running = assemblePiSpawn({
      sessionId: "s-live",
      cwd: "/tmp/project",
      kernel: { "update-center": updateCenter, "runtime-info": runtimeInfo },
    });
    expect(running.env[GOAL_AUTO_RESUME_ENV]).toBeUndefined();

    // A stale inherited marker must not leak into worker children.
    expect(sanitizeEnvironment({ [GOAL_AUTO_RESUME_ENV]: "blocked", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });
});
describe(".env injection into the pi spawn env (T17 parity)", () => {
  it("applies PipiUI context-fold product defaults at the lowest precedence", () => {
    const merged = mergedSpawnEnvironment({}, {}, {});
    expect(merged).toMatchObject({
      CONTEXTFOLD_BUDGET_CAP: "150000",
      CONTEXTFOLD_TAIL: "30000",
      CONTEXTFOLD_COMPACT: "native",
      CONTEXTFOLD_SPOOL_RETAIN_DAYS: "30",
      CONTEXTFOLD_TOOL_USE_TRIGGER: "40",
      CONTEXTFOLD_TOOL_USE_KEEP: "12",
      CONTEXTFOLD_TOOL_USE_MIN_SAVINGS: "10000",
    });
  });

  it("lets caller, project .env, and internal values override context-fold defaults in order", () => {
    const parent = mergedSpawnEnvironment({ CONTEXTFOLD_BUDGET_CAP: "140000" }, {}, {});
    expect(parent.CONTEXTFOLD_BUDGET_CAP).toBe("140000");

    const project = mergedSpawnEnvironment(
      { CONTEXTFOLD_TAIL: "25000" },
      { CONTEXTFOLD_TAIL: "22000", CONTEXTFOLD_COMPACT: "det" },
      {},
    );
    expect(project.CONTEXTFOLD_TAIL).toBe("22000");
    expect(project.CONTEXTFOLD_COMPACT).toBe("det");

    const triggerOverride = mergedSpawnEnvironment(
      { CONTEXTFOLD_TOOL_USE_TRIGGER: "44" },
      { CONTEXTFOLD_TOOL_USE_TRIGGER: "48", CONTEXTFOLD_TOOL_USE_KEEP: "10" },
      { CONTEXTFOLD_TOOL_USE_MIN_SAVINGS: "12000" },
    );
    expect(triggerOverride.CONTEXTFOLD_TOOL_USE_TRIGGER).toBe("48");
    expect(triggerOverride.CONTEXTFOLD_TOOL_USE_KEEP).toBe("10");
    expect(triggerOverride.CONTEXTFOLD_TOOL_USE_MIN_SAVINGS).toBe("12000");

    const internal = mergedSpawnEnvironment(
      {},
      { CONTEXTFOLD_SPOOL_RETAIN_DAYS: "10" },
      { CONTEXTFOLD_SPOOL_RETAIN_DAYS: "45" },
    );
    expect(internal.CONTEXTFOLD_SPOOL_RETAIN_DAYS).toBe("45");

    const disabled = mergedSpawnEnvironment({}, { CONTEXTFOLD: "0" }, {});
    expect(disabled.CONTEXTFOLD).toBe("0");
  });

  it("defaults new Pi processes to native long cache retention", () => {
    const merged = mergedSpawnEnvironment({}, {}, {});
    expect(merged.PI_CACHE_RETENTION).toBe("long");
  });

  it.each(["short", "none", "provider-specific"])(
    "preserves an explicit PI_CACHE_RETENTION=%s value",
    (retention) => {
      const merged = mergedSpawnEnvironment(
        { PI_CACHE_RETENTION: retention },
        {},
        {},
      );
      expect(merged.PI_CACHE_RETENTION).toBe(retention);
    },
  );

  it("lets the configured project .env override the cache-retention default", () => {
    const merged = mergedSpawnEnvironment(
      {},
      { PI_CACHE_RETENTION: "none" },
      {},
    );
    expect(merged.PI_CACHE_RETENTION).toBe("none");
  });

  it("injects .env keys under the internal contract", () => {
    const merged = mergedSpawnEnvironment(
      {},
      { OPENAI_API_KEY: "sk-test", TEST_KEY: "xxx" },
      {},
    );
    expect(merged.OPENAI_API_KEY).toBe("sk-test");
    expect(merged.TEST_KEY).toBe("xxx");
  });

  it("internal PIPIUI_* values win over stale .env values", () => {
    const merged = mergedSpawnEnvironment(
      {},
      { PIPIUI_BRIDGE_PORT: "9999", TEST_KEY: "xxx" },
      { PIPIUI_BRIDGE_PORT: "1234" },
    );
    expect(merged.PIPIUI_BRIDGE_PORT).toBe("1234");
    expect(merged.TEST_KEY).toBe("xxx");
  });

  it("internal Pi profile paths win over stale .env and parent values", () => {
    const merged = mergedSpawnEnvironment(
      { PI_CODING_AGENT_DIR: "/global-parent", PI_CODING_AGENT_SESSION_DIR: "/global-parent/sessions" },
      { PI_CODING_AGENT_DIR: "/global-dotenv", PI_CODING_AGENT_SESSION_DIR: "/global-dotenv/sessions" },
      { PI_CODING_AGENT_DIR: "/electron/pi-agent", PI_CODING_AGENT_SESSION_DIR: "/electron/pi-agent/sessions" },
    );
    expect(merged.PI_CODING_AGENT_DIR).toBe("/electron/pi-agent");
    expect(merged.PI_CODING_AGENT_SESSION_DIR).toBe("/electron/pi-agent/sessions");
  });

  it("strips managed PIPIUI_* keys from .env and parent layers", () => {
    const merged = mergedSpawnEnvironment(
      { PIPIUI_SESSION_KEY: "stale-parent", ANTHROPIC_API_KEY: "parent-key" },
      { PIPIUI_SESSION_KEY: "stale-dotenv", OPENAI_API_KEY: "dot-key" },
      { PIPIUI_SESSION_KEY: "session-1" },
    );
    expect(merged.PIPIUI_SESSION_KEY).toBe("session-1");
    expect(merged.OPENAI_API_KEY).toBe("dot-key");
    expect(merged.ANTHROPIC_API_KEY).toBe("parent-key");
  });

  it("empty .env keeps parent and internal values", () => {
    const merged = mergedSpawnEnvironment(
      { PATH: "/usr/bin" },
      {},
      { PIPIUI_SESSION_KEY: "abc" },
    );
    expect(merged).toMatchObject({ PATH: "/usr/bin", PIPIUI_SESSION_KEY: "abc" });
  });

  it("always marks the child as Electron-as-Node even under a Finder-like sparse env", () => {
    // Packaged Pi is the Electron Helper. A reconstructed spawn env that drops
    // ELECTRON_RUN_AS_NODE turns that Helper into a Chromium process that
    // busy-loops at ~80% CPU instead of running the script.
    const merged = mergedSpawnEnvironment(
      { HOME: "/tmp", PATH: "/usr/bin:/bin" },
      {},
      {},
    );
    expect(merged.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});

/**
 * The Swift app groups subagent with the bridge-dependent extensions because Swift always has a
 * bridge. The extension itself only uses the bridge for lifecycle reporting, so a bridge-less host
 * must still get real dispatch, worktrees and finalization — otherwise Electron has no workers at
 * all until an HTTP bridge exists.
 */describe("withToolPath and the Electron node shim", () => {
  const trees: string[] = [];
  afterEach(async () => {
    await Promise.all(trees.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function seedNodeTree(kind: "shim" | "real"): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), `pipiui-${kind}-node-`));
    trees.push(root);
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    const body = kind === "shim"
      ? "#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 /Helper \"$@\"\n"
      : "#!/bin/sh\nexit 0\n";
    await writeFile(join(bin, "node"), body, { mode: 0o755 });
    return bin;
  }

  function firstNodeDir(path: string): string | undefined {
    return path.split(delimiter).find((dir) => existsSync(join(dir, "node")));
  }

  it("does not let the Electron node shim win PATH when a real node exists", async () => {
    const shimDir = await seedNodeTree("shim");
    const realDir = await seedNodeTree("real");
    const env = withToolPath(
      { PATH: [shimDir, "/usr/bin", "/bin", realDir].join(delimiter) },
      join(shimDir, "node"),
    );
    expect(firstNodeDir(env.PATH ?? "")).toBe(realDir);
    expect(env.PATH?.split(delimiter)).not.toContain(shimDir);
  });

  it("still prepends a normal pi executable directory when no shim is involved", () => {
    const env = withToolPath({ PATH: "/usr/bin:/bin" }, "/opt/homebrew/bin/pi");
    expect(env.PATH?.split(delimiter)[0]).toBe("/opt/homebrew/bin");
  });

  // A rewritten executable changes size/mtime, so the size+mtime-guarded shim memoization
  // must re-read it instead of replaying the stale verdict.
  it("re-evaluates a shim file whose content changed (shimCache size+mtime invalidation)", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipiui-shim-flip-"));
    trees.push(root);
    const node = join(root, "node");
    await writeFile(node, "#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 /Helper \"$@\"\n", { mode: 0o755 });
    expect(isElectronNodeShim(node)).toBe(true);
    await writeFile(node, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await utimes(node, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
    expect(isElectronNodeShim(node)).toBe(false);
  });

  // withToolPath must stay uncached: a real Node installed after the first spawn has to
  // demote the shim directory on the very next call, not reuse the frozen first PATH.
  it("reflects a real node that appears after the first call (no frozen PATH decision)", async () => {
    const shimDir = await seedNodeTree("shim");
    const lateDir = await seedNodeTree("shim");
    const baseEnv = { PATH: [shimDir, lateDir].join(delimiter) };
    const pi = join(shimDir, "node");
    // Both seeded node binaries are shims, so the second directory never wins first.
    const before = withToolPath(baseEnv, pi);
    expect(firstNodeDir(before.PATH ?? "")).not.toBe(lateDir);
    // Flip the second directory into a real node; the size+mtime change must be noticed
    // on the next call and the directory promoted ahead of the well-known fallbacks.
    const lateNode = join(lateDir, "node");
    await writeFile(lateNode, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await utimes(lateNode, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
    const after = withToolPath(baseEnv, pi);
    expect(firstNodeDir(after.PATH ?? "")).toBe(lateDir);
    expect(after.PATH?.split(delimiter)).not.toContain(shimDir);
  });
});
describe("secret vault spawn contract", () => {
  const secretVault = "/runtime/kernel/pipiui-secret-vault.ts";

  it("mounts the vault extension and pins the explicit App-profile vault directory", () => {
    const { args, env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      vaultDir: "/electron/pi-agent",
      sessionId: "sess-1",
      kernel: { "secret-vault": secretVault },
    });
    expect(args).toEqual(["-e", secretVault]);
    expect(env.PI_CODING_AGENT_DIR).toBe("/project/.pi/agent");
    expect(env.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
    expect(env.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(env.PIPIUI_SESSION_ID).toBe("sess-1");
  });

  it("never derives the vault directory from a project agentDir", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      sessionId: "sess-1",
      kernel: { "secret-vault": secretVault },
    });
    expect(env.PI_CODING_AGENT_DIR).toBe("/project/.pi/agent");
    expect(env.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
  });

  it("never injects a DEK and strips inherited vault keys", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      vaultDir: "/electron/pi-agent",
      sessionId: "sess-1",
      kernel: { "secret-vault": secretVault },
    });
    expect(env.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(env.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
    expect(sanitizeEnvironment({ PIPIUI_SECRET_VAULT_DIR: "/stale", PIPIUI_VAULT_DEK: "leak", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });

  it("merges session mounts onto main env without a DEK", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      vaultDir: "/electron/pi-agent",
      sessionId: "sess-1",
      kernel: { "secret-vault": secretVault },
    });
    const main = applySessionMountsToMainEnv(
      mergedSpawnEnvironment(
        { PATH: "/usr/bin", OPENAI_API_KEY: "from-dotenv", TOKEN_B: "parent-b", PIPIUI_VAULT_DEK: "leak" },
        { OPENAI_API_KEY: "from-dotenv" },
        env,
      ),
      { TOKEN_A: "aaaaaaaaaaaa" },
    );
    expect(main.TOKEN_A).toBe("aaaaaaaaaaaa");
    expect(main.TOKEN_B).toBe("parent-b");
    expect(main.OPENAI_API_KEY).toBe("from-dotenv");
    expect(main.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(main.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
  });

  it("strips DEK from worker/subagent env while keeping session mounts", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      vaultDir: "/electron/pi-agent",
      sessionId: "sess-1",
      kernel: { "secret-vault": secretVault },
    });
    const child = applySessionMountsToWorkerEnv(
      mergedSpawnEnvironment(
        { PATH: "/usr/bin", OPENAI_API_KEY: "from-dotenv", TOKEN_B: "parent-b", PIPIUI_VAULT_DEK: "leak" },
        { OPENAI_API_KEY: "from-dotenv" },
        env,
      ),
      { TOKEN_A: "aaaaaaaaaaaa" },
    );
    expect(child.TOKEN_A).toBe("aaaaaaaaaaaa");
    expect(child.TOKEN_B).toBe("parent-b");
    expect(child.OPENAI_API_KEY).toBe("from-dotenv");
    expect(child.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(child.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
  });

  it("resolves the shipped extension from the source runtime tree", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime");
    expect(resolveKernelPaths(root)["secret-vault"]).toBe(join(root, "kernel", "pipiui-secret-vault.ts"));
  });
});
describe("session workspace project-root contract", () => {

  it("anchors PIPIUI_PROJECT_ROOT at the canonical root while cwd and MAIN_CWD follow the workspace", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project/.pi/worktrees/session-x",
      projectRoot: "/tmp/project",
      bridgePort: 4321,
    });
    expect(env.PIPIUI_MAIN_CWD).toBe("/tmp/project/.pi/worktrees/session-x");
    expect(env.PIPIUI_PROJECT_ROOT).toBe("/tmp/project");
    expect(env.PIPIUI_MEMORY_PROJECT_ROOT).toBe("/tmp/project");
  });

  it("defaults PIPIUI_PROJECT_ROOT to cwd for unbound sessions", () => {
    const { env } = assemblePiSpawn({ cwd: "/tmp/project" });
    expect(env.PIPIUI_PROJECT_ROOT).toBe("/tmp/project");
  });

  it("strips an inherited PIPIUI_PROJECT_ROOT so only the host-minted value survives", () => {
    const merged = mergedSpawnEnvironment({ PATH: "/usr/bin", PIPIUI_PROJECT_ROOT: "/evil" }, {}, {});
    expect(merged.PIPIUI_PROJECT_ROOT).toBeUndefined();
  });
});
