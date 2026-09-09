import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { compareUnicode, freezeJson, parsePythonJson, type ReadonlyJson } from "./json.js";

/** These read-only primitives never import transaction or publication writers. */
export async function readJson(path: string): Promise<ReadonlyJson> {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(path));
  return freezeJson(parsePythonJson(text));
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
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(path));
  return Object.freeze(text.split(/\r\n|\r|\n/).map(strippedLine).filter(Boolean).map(line => freezeJson(parsePythonJson(line))));
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
