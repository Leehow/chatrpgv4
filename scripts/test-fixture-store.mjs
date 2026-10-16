/** One reusable workspace per fixture; legacy archives are expanded once per digest. */
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, statfsSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { shareTestTree, DEFAULT_LIMITS } from './test-workspace.mjs';
import {removeOwned} from './test-storage.mjs';

const CACHE = resolve(import.meta.dirname, '../.tmp/test-fixture-seeds');
export const FIXTURE_REFERENCE = 'workspace.json';
export function archiveDigest(path) {
  const hash = createHash('sha256'), fd = openSync(path, 'r'), buffer = Buffer.allocUnsafe(256 * 1024);
  try { let count; while ((count = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest('hex');
}

export function publishTestFixture(source, directory) {
  directory = resolve(directory); mkdirSync(directory, { recursive: true });
  if (existsSync(join(directory, FIXTURE_REFERENCE))) throw Error('Preserve the existing fixture reference: ' + directory);
  const result = shareTestTree(source, join(directory, 'workspace'),{readOnly:true});
  const reference = { version: 1, kind: 'shared-test-fixture', workspace: 'workspace', tree_sha256: result.tree_sha256, files: result.files, bytes: result.bytes, created_at: new Date().toISOString() };
  writeFileSync(join(directory, FIXTURE_REFERENCE), JSON.stringify(reference, null, 2) + '\n', { flag: 'wx' });
  return reference;
}

export function legacyFixtureSeed(archive, { cacheRoot = CACHE } = {}) {
  archive = resolve(archive); cacheRoot = resolve(cacheRoot);
  const digest = archiveDigest(archive), destination = join(cacheRoot, digest), ready = join(destination, 'seed.json');
  const read = () => {
    if (!existsSync(ready)) return null;
    const record = JSON.parse(readFileSync(ready, 'utf8'));
    if (record.archive_sha256 !== digest || record.kind !== 'legacy-test-fixture-seed') throw Error('Invalid fixture cache record');
    return join(destination, 'workspace');
  };
  const present = read(); if (present) return present;
  const space = statSync(archive);
  if (space.size > DEFAULT_LIMITS.seedBytes) throw Error('Legacy fixture archive exceeds the seed budget');
  // BSD tar and GNU tar both expose the numeric size in their verbose listing.
  const listing = spawnSync('tar', ['-tvzf', archive, '--numeric-owner'], { encoding: 'utf8', maxBuffer: 32 * 1024 ** 2 });
  if (listing.status !== 0) throw Error('Cannot inspect legacy fixture archive: ' + listing.stderr);
  let expanded = 0, files = 0;
  for (const line of listing.stdout.split('\n').filter(Boolean)) {
    const match = line.match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s/) ?? line.match(/^\S+\s+\S+\/\S+\s+(\d+)\s/);
    if (!match) throw Error('Unrecognized archive listing; expansion refused');
    expanded += Number(match[1]); files++;
  }
  if (expanded > DEFAULT_LIMITS.seedBytes || files > DEFAULT_LIMITS.files) throw Error('Expanded fixture exceeds its file/byte budget');
  mkdirSync(cacheRoot, { recursive: true });
  const free = statfsSync(cacheRoot);
  if (free.bavail * free.bsize - expanded < DEFAULT_LIMITS.minFreeBytes) throw Error('Legacy seed expansion would breach the free-space reserve');
  const lock = destination + '.lock'; let owned = false;
  const deadline = Date.now() + 30000;
  while (!owned) {
    const present = read(); if (present) return present;
    try { mkdirSync(lock); owned = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (Date.now() > deadline) throw Error('Fixture seed publication is busy; existing evidence preserved'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
  }
  const stage = mkdtempSync(join(cacheRoot, 'partial-' + digest.slice(0, 12) + '-'));
  try {
    const workspace = join(stage, 'workspace'),extracted=join(stage,'extracted'); mkdirSync(extracted);
    const extraction = spawnSync('tar', ['-xzf', archive, '-C', extracted], { encoding: 'utf8' });
    if (extraction.status !== 0) throw Error('Fixture extraction failed: ' + extraction.stderr);
    if (archiveDigest(archive) !== digest) throw Error('Fixture archive changed during extraction');
    shareTestTree(extracted,workspace,{readOnly:true});
    removeOwned(extracted);
    writeFileSync(join(stage, 'seed.json'), JSON.stringify({ kind: 'legacy-test-fixture-seed', archive_sha256: digest, archive, expanded_bytes: expanded, entries: files }) + '\n');
    renameSync(stage, destination);
    return join(destination, 'workspace');
  } finally { rmSync(lock, { recursive: true }); }
}

export function materializeTestFixture({ workspace, archive }, destination, options) {
  const seed = workspace ? resolve(workspace) : legacyFixtureSeed(archive, options);
  return shareTestTree(seed, destination);
}
