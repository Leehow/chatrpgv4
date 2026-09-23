import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { compareUnicode, freezeJson, parsePythonJson, type ReadonlyJson } from "./json.js";

/**
 * Parsed files are kept per process, keyed by the file's identity stamp (contract §131).
 *
 * Every value a read returns is frozen, so the same object can be handed to every caller: nothing
 * downstream can tell a cached read from a fresh one except by its speed. A CPU profile of one
 * `table.workspace.read` on a starter table (2026-09-22) put 72% of a 600 ms request inside the
 * Python-compatible JSON parser and serializer, and most of that was the same bytes parsed again:
 * the 2.4 MB coc7 rule graph on every request, the 0.8 MB module graph on every load, and every
 * turn record of the campaign on every snapshot. The kernel's writers replace files atomically
 * (`writeJsonAtomic` renames a fresh inode into place) and append to logs, so size + mtime + inode
 * is the change signal; a file rewritten in place with the same size and a different content
 * still moves its mtime. The cache is bounded by decoded text size and evicts least recently used.
 */
type Stamp = { size: number; mtimeMs: number; ino: number };
type Parsed<T> = { stamp: Stamp; bytes: number; value: T };
const PARSED_CACHE_BYTES = 128 * 1024 * 1024, PARSED_CACHE_ENTRIES = 4096;
const parsedJson = new Map<string, Parsed<ReadonlyJson>>(), parsedJsonl = new Map<string, Parsed<readonly ReadonlyJson[]>>();
let parsedBytes = 0;
const sameStamp = (a: Stamp, b: Stamp): boolean => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
function remember<T>(cache: Map<string, Parsed<T>>, path: string, entry: Parsed<T>): void {
  const previous = cache.get(path);
  if (previous) { parsedBytes -= previous.bytes; cache.delete(path); }
  cache.set(path, entry); parsedBytes += entry.bytes;
  while ((parsedBytes > PARSED_CACHE_BYTES || parsedJson.size + parsedJsonl.size > PARSED_CACHE_ENTRIES) && (parsedJson.size || parsedJsonl.size)) {
    const victim = parsedJson.size ? parsedJson : parsedJsonl, key = victim.keys().next().value!;
    parsedBytes -= victim.get(key)!.bytes; victim.delete(key);
  }
}
function recall<T>(cache: Map<string, Parsed<T>>, path: string, stamp: Stamp): T | undefined {
  const hit = cache.get(path);
  if (!hit || !sameStamp(hit.stamp, stamp)) return undefined;
  cache.delete(path); cache.set(path, hit);
  return hit.value;
}
async function stamped(path: string): Promise<{ stamp: Stamp; text: () => Promise<string> }> {
  const info = await stat(path), stamp = { size: info.size, mtimeMs: info.mtimeMs, ino: info.ino };
  return { stamp, text: async () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(path)) };
}
/** Test seam and the one lever a long-lived process has: forget every parsed file. */
export function forgetParsedFiles(): void { parsedJson.clear(); parsedJsonl.clear(); parsedBytes = 0; }

/** These read-only primitives never import transaction or publication writers. */
export async function readJson(path: string): Promise<ReadonlyJson> {
  const { stamp, text } = await stamped(path);
  const cached = recall(parsedJson, path, stamp);
  if (cached !== undefined) return cached;
  const decoded = await text(), value = freezeJson(parsePythonJson(decoded));
  remember(parsedJson, path, { stamp, bytes: decoded.length, value });
  return value;
}

export function isBlankLine(line: string): boolean {
  return /^[\x09-\x0d\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/.test(line);
}

function strippedLine(line: string): string {
  return line.replace(/^[\x09-\x0d\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\x09-\x0d\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, "");
}

export async function pathExists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); }
  catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

export async function readJsonl(path: string): Promise<readonly ReadonlyJson[]> {
  if (!await pathExists(path)) return Object.freeze([]);
  const { stamp, text } = await stamped(path);
  const cached = recall(parsedJsonl, path, stamp);
  if (cached !== undefined) return cached;
  const decoded = await text();
  const value = Object.freeze(decoded.split(/\r\n|\r|\n/).map(strippedLine).filter(Boolean).map(line => freezeJson(parsePythonJson(line))));
  remember(parsedJsonl, path, { stamp, bytes: decoded.length, value });
  return value;
}

export async function sortedChildNames(root: string, predicate: (path: string) => Promise<boolean>): Promise<string[]> {
  if (!await pathExists(root)) return [];
  const names = await readdir(root);
  const selected: string[] = [];
  for (const name of names) if (await predicate(join(root, name))) selected.push(name);
  return selected.sort(compareUnicode);
}

export const snapshots = Object.freeze({ readJson, readJsonl, pathExists, isDirectory, isFile, sortedChildNames });
export type SnapshotReader = typeof snapshots;
