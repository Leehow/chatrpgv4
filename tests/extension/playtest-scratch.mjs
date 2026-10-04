/** Contract-test scratch stays inside the repository for external module resolution, apart from real play evidence. */
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../..");
export const SCRATCH_ROOT = join(REPO, ".tmp", "test-scratch");
export const RUN_OWNER = ".run-owner.json";
export const OWNER = ".scratch-owner.json";
export const KEPT_NOTE = "kept.json";
const RUN_ENV = "COC_TEST_SCRATCH_RUN";
let currentRun;
let managed = false;
let settled = false;
const owned = [];

function identity(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`scratch path is not a real directory: ${path}`);
  return { dev: stat.dev, ino: stat.ino };
}

function directory(path) {
  try { mkdirSync(path); } catch (error) { if (error.code !== "EEXIST") throw error; }
  return identity(path);
}

function record(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error(`invalid scratch record: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameIdentity(path, expected) {
  const actual = identity(path);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw new Error(`scratch directory identity changed: ${path}`);
}

export function startRun() {
  directory(join(REPO, ".tmp"));
  directory(SCRATCH_ROOT);
  const path = mkdtempSync(join(SCRATCH_ROOT, "run-"));
  const owner = { kind: "node-contract-test-run", id: randomUUID(), pid: process.pid, created_at: new Date().toISOString(), ...identity(path) };
  writeFileSync(join(path, RUN_OWNER), JSON.stringify(owner), { flag: "wx" });
  return path;
}

function runOwner(path) {
  if (dirname(path) !== SCRATCH_ROOT || !/^run-[A-Za-z0-9]+$/.test(basename(path)) || realpathSync(SCRATCH_ROOT) !== SCRATCH_ROOT) throw new Error("scratch run is outside the dedicated test root");
  const owner = record(join(path, RUN_OWNER));
  if (owner.kind !== "node-contract-test-run" || typeof owner.id !== "string") throw new Error("scratch run has no valid owner");
  sameIdentity(path, owner);
  return owner;
}

function run() {
  if (!currentRun) {
    managed = Boolean(process.env[RUN_ENV]);
    currentRun = managed ? resolve(process.env[RUN_ENV]) : startRun();
    runOwner(currentRun);
    process.once("exit", (code) => settle(code));
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
      process.once(signal, () => { settle(code, signal); process.exit(code); });
    }
  }
  return currentRun;
}

export function playtestScratch(name, prefix = "suite-", { retain = false } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(name) || name.split("/").some((part) => !part || part === "." || part === "..") || !/^[A-Za-z0-9_-]+$/.test(prefix)) throw new Error("invalid test scratch name or prefix");
  const parent = run();
  const directory = mkdtempSync(join(parent, `${name.replaceAll("/", "-")}-${prefix}`));
  const owner = { kind: "node-contract-test-scratch", id: randomUUID(), run_id: runOwner(parent).id, pid: process.pid, retain: Boolean(retain), suite: name, created_at: new Date().toISOString(), ...identity(directory) };
  writeFileSync(join(directory, OWNER), JSON.stringify(owner), { flag: "wx" });
  owned.push({ directory, owner });
  return directory;
}

function verify({ directory, owner }) {
  const parent = runOwner(dirname(directory));
  sameIdentity(directory, owner);
  const actual = record(join(directory, OWNER));
  if (actual.id !== owner.id || actual.run_id !== parent.id) throw new Error(`scratch ownership changed: ${directory}`);
}

function keep(item, status, code, signal) {
  verify(item);
  const path = join(item.directory, KEPT_NOTE);
  if (!existsSync(path)) writeFileSync(path, JSON.stringify({ status, exit_code: code, ...(signal ? { signal } : {}), owner_id: item.owner.id }), { flag: "wx" });
  process.stderr.write(`test scratch kept (${status}): ${item.directory}\n`);
}

function writable(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return;
  chmodSync(path, stat.mode | 0o700);
  for (const entry of readdirSync(path)) writable(join(path, entry));
}

function remove(item) {
  verify(item);
  // Restore owned directory permissions first: a failed partial rm could otherwise remove its owner record.
  writable(item.directory);
  verify(item);
  rmSync(item.directory, { recursive: true, force: false, maxRetries: 3, retryDelay: 25 });
}

function settle(code, signal) {
  if (settled) return;
  settled = true;
  const status = code || process.exitCode || 0;
  for (const item of owned) {
    try {
      if (signal) keep(item, "interrupted", status, signal);
      else if (status !== 0) keep(item, "failed", status);
      else if (item.owner.retain) keep(item, "retained", 0);
      else remove(item);
    } catch (error) {
      process.stderr.write(`test scratch cleanup refused: ${error.message}\n`);
      process.exitCode = status || 1;
      try { keep(item, "cleanup_failed", process.exitCode); } catch {}
    }
  }
  if (!managed && currentRun) {
    try { finishRun(currentRun); } catch (error) { process.stderr.write(`test scratch run retained: ${error.message}\n`); }
  }
}

/** Inspect only a known run's immediate allocations. Other runs and .coc/playtests are outside this boundary. */
export function inspectRun(path) {
  const run = runOwner(path);
  const kept = [], leaked = [];
  for (const name of readdirSync(path).filter((name) => name !== RUN_OWNER)) {
    const allocation = join(path, name);
    try {
      const owner = record(join(allocation, OWNER));
      sameIdentity(allocation, owner);
      if (owner.kind !== "node-contract-test-scratch" || owner.run_id !== run.id) throw new Error("unknown allocation");
      const note = record(join(allocation, KEPT_NOTE));
      if (note.owner_id !== owner.id || !["failed", "interrupted", "retained"].includes(note.status)) throw new Error("unfinished allocation");
      kept.push(allocation);
    } catch { leaked.push(allocation); }
  }
  return { kept, leaked };
}

export function finishRun(path) {
  const owner = runOwner(path);
  const result = inspectRun(path);
  if (result.kept.length || result.leaked.length) return result;
  sameIdentity(path, owner);
  unlinkSync(join(path, RUN_OWNER));
  rmdirSync(path);
  return result;
}

/** Earlier interrupted runs are reported for inspection, never removed automatically. */
export function abandonedRuns() {
  if (!existsSync(SCRATCH_ROOT)) return [];
  const result = [];
  for (const name of readdirSync(SCRATCH_ROOT)) {
    const path = join(SCRATCH_ROOT, name);
    try {
      const owner = runOwner(path);
      try { process.kill(owner.pid, 0); continue; } catch (error) { if (error.code !== "ESRCH") continue; }
      if (inspectRun(path).leaked.length) result.push(path);
    } catch {}
  }
  return result;
}
