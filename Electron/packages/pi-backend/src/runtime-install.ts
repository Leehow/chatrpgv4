import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Install the kernel runtime tree this host mounts from.
 *
 * The base ships the kernel and nothing else. Capability extensions are
 * packages developed under `Electron/packs/` and distributed by being placed in
 * `{project}/.pi/agent/extensions/<id>/`; none of them is copied here, so this
 * installer has no extension list, no bundle manifest and no second pass.
 *
 * Its directories are still stage-swapped independently so managed npm packages
 * living beside them survive refreshes and a failed copy preserves the
 * previously installed runtime.
 */
/** Dev-only build artifacts. The shipped tree carries none of them (`pi-ext` is ~1.5 MB). */
const SKIP_ENTRIES = new Set(["node_modules", ".git", ".DS_Store", "out", "dist", "release", "target"]);
/**
 * The whole shipped runtime, in install order.
 *
 * `pi-core-prompt` and `kernel` are the surfaces `kernel-mounts.ts` resolves;
 * `pi-ext` carries the vendored compaction package that is also a kernel mount.
 * `auth`, `browser-dom` and `model-capabilities` are host-owned data the
 * Electron main process reads by path — they are not agent-visible mounts and
 * not extensions.
 */
export const RUNTIME_TREE_DIRECTORIES = Object.freeze([
  "pi-core-prompt",
  "kernel",
  "pi-ext",
  "auth",
  "browser-dom",
  "model-capabilities",
] as const);
/**
 * Trees earlier builds installed and this one does not. Named rather than inferred: an
 * unknown directory in the runtime root is somebody's, not ours to delete.
 */
const RETIRED_RUNTIME_TREES: ReadonlySet<string> = new Set([
  "extensions",
  "pi-philosophy",
  "pi-goal",
  "anydoc",
  "built-in-skills",
]);
const SIGNATURE_FILE = ".pipiui-install.json";
let stagingSeq = 0;

export type InstallReport = { installed: string[]; unchanged: string[]; removed: string[]; failures: string[] };

const emptyReport = (): InstallReport => ({ installed: [], unchanged: [], removed: [], failures: [] });

/**
 * Content signature of a source tree: relative path + size + mtime.
 * Cheap enough to run on every launch and precise enough that an untouched tree is never
 * recopied, so a no-op refresh never churns a live session's mounted tree.
 */
export function treeSignature(root: string): string {
  const skip = SKIP_ENTRIES;
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skip.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      const stat = statSync(path);
      parts.push(`${relative(root, path)}#${stat.size}#${Math.round(stat.mtimeMs)}`);
    }
  };
  walk(root);
  return parts.join(";");
}

const storedSignature = (dest: string): string | undefined => {
  try { return JSON.parse(readFileSync(join(dest, SIGNATURE_FILE), "utf8")).signature } catch { return undefined }
};

/** Only generated copies are writable; links never grant access to their source targets. */
function makeGeneratedTreeWritable(path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink()) return;
  chmodSync(path, (stat.mode & 0o777) | 0o600 | (stat.isDirectory() ? 0o100 : 0));
  if (stat.isDirectory())
    for (const entry of readdirSync(path)) makeGeneratedTreeWritable(join(path, entry));
}

function removeGeneratedTree(path: string): void {
  makeGeneratedTreeWritable(path);
  rmSync(path, { recursive: true, force: true });
}

function cleanupGeneratedTree(path: string, report: InstallReport): void {
  try { removeGeneratedTree(path) }
  catch (error) { report.failures.push(`${path}: cleanup failed: ${error instanceof Error ? error.message : String(error)}`) }
}

/**
 * Signature-gated stage-and-swap copy.
 *
 * Copy away from the live path, then retain the previous tree until the prepared copy has
 * been renamed into place. Live sessions never see a half-copied `pi-ext`, and a failed
 * preparation leaves the previous tree exactly as it was.
 */
export function syncTree(source: string, dest: string, report: InstallReport = emptyReport()): InstallReport {
  if (!existsSync(source)) { report.failures.push(`${dest}: source missing at ${source}`); return report }
  // Unique per call, not just per process: two sessions can spawn at once, and both refresh the
  // tree before assembling their paths.
  const staging = `${dest}.staging-${process.pid}-${(stagingSeq += 1)}`;
  const previous = `${dest}.previous-${process.pid}-${stagingSeq}`;
  let movedPrevious = false, installed = false;
  try {
    const signature = treeSignature(source);
    if (existsSync(dest) && storedSignature(dest) === signature) { report.unchanged.push(dest); return report }
    removeGeneratedTree(staging);
    const skip = SKIP_ENTRIES;
    cpSync(source, staging, { recursive: true, filter: path => {
      const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
      return !skip.has(name) && !name.endsWith(".tsbuildinfo");
    } });
    makeGeneratedTreeWritable(staging);
    writeFileSync(join(staging, SIGNATURE_FILE), JSON.stringify({ signature, installedAt: new Date().toISOString() }), "utf8");
    if (existsSync(previous)) throw new Error(`previous runtime already retained at ${previous}`);
    if (existsSync(dest)) { renameSync(dest, previous); movedPrevious = true }
    renameSync(staging, dest);
    installed = true;
    report.installed.push(dest);
  } catch (error) {
    report.failures.push(`${dest}: ${error instanceof Error ? error.message : String(error)}`);
    if (movedPrevious && !installed) {
      try { renameSync(previous, dest) }
      catch (restoreError) {
        report.failures.push(`${dest}: restore failed; previous runtime retained at ${previous}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
    }
    cleanupGeneratedTree(staging, report);
  }
  if (installed && movedPrevious) cleanupGeneratedTree(previous, report);
  return report;
}

export type RuntimeAssets = {
  /** Canonical source layout: the kernel runtime plus the host-owned data trees. */
  sourceRoot?: string;
};

/**
 * One call that brings a runtime root up to the shipped sources.
 *
 * Every missing asset is a reported failure, never a silent skip: the whole reason this gap
 * survived so long is that the old installers returned `undefined` when their source was absent,
 * so an Electron session ran with a half-built runtime and said nothing about it.
 */
export function installRuntimeTree(assets: RuntimeAssets, runtimeRoot: string): InstallReport {
  const report = emptyReport();
  mkdirSync(runtimeRoot, { recursive: true });
  if (!assets.sourceRoot) {
    report.failures.push("runtime source root: no source path resolved");
    return report;
  }
  for (const name of RUNTIME_TREE_DIRECTORIES)
    syncTree(join(assets.sourceRoot, name), join(runtimeRoot, name), report);
  pruneUnshippedTrees(runtimeRoot, report);
  return report;
}

/**
 * Remove top-level trees this build no longer ships.
 *
 * `syncTree` only ever writes, so an install that ships fewer directories than the one
 * before it leaves the old ones behind for good. That is not merely wasted disk: the
 * leftovers are a whole previous generation of extensions sitting in the runtime root,
 * indistinguishable from shipped content to anyone reading the tree, and they reappear in
 * every diagnostic. A subtractive upgrade has to actually subtract.
 *
 * Only the top level is pruned, and only entries this build knows it does not ship —
 * anything unrecognised is left alone rather than deleted, so a directory someone put
 * there on purpose survives.
 */
function pruneUnshippedTrees(runtimeRoot: string, report: InstallReport): void {
  const shipped = new Set<string>(RUNTIME_TREE_DIRECTORIES);
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(runtimeRoot, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!RETIRED_RUNTIME_TREES.has(entry.name) || shipped.has(entry.name)) continue;
    const path = join(runtimeRoot, entry.name);
    try {
      removeGeneratedTree(path);
      report.removed.push(path);
    } catch (error) {
      report.failures.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
