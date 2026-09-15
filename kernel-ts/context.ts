import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createAdvisoryLocks, type AdvisoryLocks } from "./locks.js";
import { PythonRandom } from "./random.js";
import { createGitRuntime, type GitRuntime } from "./git.js";
import { isDirectory, pathExists, snapshots, type SnapshotReader } from "./snapshots.js";

export interface KernelContext {
  readonly workspace: string;
  readonly content: string;
  readonly stateRoot: string;
  /** Only source storage is scoped; campaign state and runtime capabilities keep their owner. */
  readonly moduleRoot?: string;
  readonly campaignsRoot: string;
  readonly snapshots: SnapshotReader;
  readonly git: GitRuntime;
  readonly locks: AdvisoryLocks;
  readonly rng: PythonRandom;
  readonly seedLocked: boolean;
  /** Deadline for the per-campaign RPC lock. Below the RPC transport's own timeout on purpose, so
   *  a contended campaign is reported as a contended campaign and not as a dead transport. */
  readonly campaignLockTimeoutMs: number;
}
/** Long enough for any single campaign transaction, short enough to beat the 30s RPC timeout. */
const CAMPAIGN_LOCK_TIMEOUT_MS = 25_000;

async function resolvedPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(await resolvedPath(parent), basename(absolute));
  }
}

/** Frozen owner-local wiring; disk remains authoritative and the RNG is a capability. */
export async function createKernelContext(options: {
  readonly workspace: string; readonly content: string; readonly seed?: string;
  readonly locks?: AdvisoryLocks;
  readonly env?: NodeJS.ProcessEnv;
  readonly campaignLockTimeoutMs?: number;
}): Promise<KernelContext> {
  for (const [name, path] of [["workspace", options.workspace], ["content", options.content]]) {
    if (typeof path !== "string" || !path || path.includes("\0")) throw new TypeError(`--${name} must be a non-empty path`);
  }
  const content = await resolvedPath(options.content);
  if (!await isDirectory(join(content, "rulesets", "coc7"))) throw new Error(`--content ${content} has no rulesets/coc7`);
  const workspace = await resolvedPath(options.workspace);
  if (await pathExists(workspace) && !await isDirectory(workspace)) throw new Error(`--workspace ${workspace} is not a directory`);
  const stateRoot = join(workspace, ".coc");
  const rng = new PythonRandom(options.seed || undefined);
  Object.freeze(rng);
  return Object.freeze({
    workspace, content, stateRoot, campaignsRoot: join(stateRoot, "campaigns"),
    snapshots, git: createGitRuntime(workspace, options.env), locks: options.locks ?? createAdvisoryLocks(),
    rng, seedLocked: Boolean(options.seed),
    campaignLockTimeoutMs: options.campaignLockTimeoutMs
      ?? (Number((options.env ?? process.env).PI_COC_CAMPAIGN_LOCK_TIMEOUT_MS) || CAMPAIGN_LOCK_TIMEOUT_MS),
  });
}
