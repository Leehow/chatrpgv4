import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The kernel: the runtime surfaces this host mounts that are *not* extensions.
 *
 * The test for membership is one question — "is this still true in a session
 * where every extension is disabled?" A capability the user could reasonably
 * turn off is a manifest package and belongs in `extensions/`; what is left
 * here is machinery the session cannot be assembled without.
 *
 * Everything is data. An entry names itself, says where its file lives under
 * the installed runtime tree, and declares its contribution to the child
 * process (`-e` mount, an `--append-system-prompt` argument, an environment
 * key, or nothing but a path published through the spawn contract). The
 * assembler walks this table in order and knows nothing else; adding or
 * removing a kernel surface is a row, not a branch.
 */

/** Stable kernel ids. Also the `kernel:<id>` mount ids in the spawn contract. */
export const KERNEL_MOUNT_IDS = [
  "core-prompt",
  "secret-vault",
  "context-fold",
  "update-center",
  "runtime-info",
  "prompt-observer",
  "ext-invoke",
] as const;
export type KernelMountId = (typeof KERNEL_MOUNT_IDS)[number];

/** Resolved absolute paths for the kernel surfaces present in one runtime tree. */
export type KernelPaths = Partial<Record<KernelMountId, string>>;

/**
 * How one kernel surface reaches the child.
 *
 * - `prompt`: pushed as `--append-system-prompt` before anything else.
 * - `mount`: pushed as `-e`, in `order` (lowest first).
 * - `env`: only published; the main session never loads it.
 */
export type KernelContribution =
  | { kind: "prompt"; env: string }
  | { kind: "mount"; order: number; env?: string }
  | { kind: "env"; env: string };

export type KernelMount = {
  id: KernelMountId;
  /** Runtime-tree-relative path segments. Absent from a tree ⇒ the row contributes nothing. */
  file: readonly string[];
  contribution: KernelContribution;
  /** Why this is kernel and not an extension. Enforced by review, not by code. */
  because: string;
  /** Whether a worker may remount it by default. */
  worker: boolean;
};

/**
 * Mount order is load-bearing: pi chains `before_agent_start` hooks in mount
 * order, so the secret vault has to be resident before anything can ask for a
 * credential, and `runtime-info` has to be last or its read-only request
 * observer records a payload that later rewriters still change.
 */
export const KERNEL_MOUNTS: readonly KernelMount[] = Object.freeze([
  {
    id: "core-prompt",
    file: ["pi-core-prompt", "SYSTEM_BASE.md"],
    contribution: { kind: "prompt", env: "PIPIUI_CORE_PROMPT" },
    because:
      "The locked base system prompt carries the identity and the invariants that must still hold when every extension is disabled, so no package can own it.",
    worker: false,
  },
  {
    id: "secret-vault",
    file: ["kernel", "pipiui-secret-vault.ts"],
    contribution: { kind: "mount", order: 0 },
    because:
      "Credentials are mounted into the child before any provider call; without it an authenticated session cannot start, extensions or not.",
    worker: false,
  },
  {
    id: "context-fold",
    file: ["pi-ext", "packages", "context-fold", "index.ts"],
    contribution: { kind: "mount", order: 10 },
    because:
      "Compaction keeps any long conversation inside the model's window. A session with no extensions still overflows.",
    worker: false,
  },
  {
    id: "update-center",
    file: ["kernel", "pipiui-update-center.ts"],
    contribution: { kind: "mount", order: 80 },
    because:
      "The host's own update policy transforms user input before the model sees it; it is a property of the application, not a capability the agent has.",
    worker: false,
  },
  {
    id: "runtime-info",
    file: ["kernel", "pipiui-runtime-info.ts"],
    contribution: { kind: "mount", order: 90 },
    because:
      "Host diagnostics and prompt provenance: it observes what every other mount did, which is only meaningful if it is always present and always last.",
    worker: false,
  },
  {
    id: "ext-invoke",
    file: ["kernel", "pipiui-ext-invoke.ts"],
    contribution: { kind: "mount", order: 5, env: "PIPIUI_EXT_INVOKE_EXT" },
    because:
      "The agent end of the host's invokeExtension channel. It loads before every package because a package publishes its handler when it loads, and a panel may ask before any package has run a tool.",
    worker: false,
  },
  {
    id: "prompt-observer",
    file: ["kernel", "pipiui-prompt-observer.ts"],
    contribution: { kind: "env", env: "PIPIUI_PROMPT_OBSERVER_EXT" },
    because:
      "The worker-side half of runtime-info's prompt observability. It registers no tool, so a worker can carry it where runtime-info cannot; the main session only publishes its path.",
    worker: true,
  },
]);

const BY_ID = new Map(KERNEL_MOUNTS.map((entry) => [entry.id, entry] as const));

export function kernelMount(id: KernelMountId): KernelMount {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`unknown kernel mount ${id}`);
  return entry;
}

/**
 * Resolve every kernel surface present in one installed runtime tree.
 *
 * A missing file is always `undefined`, never a guess: `-e /does/not/exist`
 * takes the whole session down, and an isolated helper spawn deliberately
 * passes an empty tree to stay tool-free.
 */
export function resolveKernelPaths(runtimeRoot: string): KernelPaths {
  const paths: KernelPaths = {};
  const compiledTree = KERNEL_MOUNTS.some(entry => entry.file.at(-1)?.endsWith('.ts') && existsSync(join(runtimeRoot, ...entry.file).replace(/\.ts$/, '.mjs')));
  for (const entry of KERNEL_MOUNTS) {
    const path = join(runtimeRoot, ...entry.file);
    const selected = compiledTree ? path.replace(/\.ts$/, ".mjs") : path;
    if (existsSync(selected)) paths[entry.id] = selected;
  }
  return paths;
}

/** Kernel mounts that push `-e`, already in load order. */
export function kernelMountOrder(): KernelMount[] {
  return KERNEL_MOUNTS
    .filter((entry): entry is KernelMount & { contribution: { kind: "mount"; order: number; env?: string } } =>
      entry.contribution.kind === "mount")
    .sort((a, b) => a.contribution.order - b.contribution.order);
}
