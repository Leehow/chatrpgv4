/**
 * Replay evaluation (R1), consistency layer 1: one checkpoint restored twice, before any model call.
 *
 *   node tests/replay/restore-check.ts <checkpoint dir>
 *
 * Both copies must hold the same files, and the kernel's own read methods must answer the same on both (paths of the
 * two copies aside). A canary written into the first copy must not be seen by the second copy or the checkpoint.
 * Prints verdict fields only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { shareTestTree } from '../../scripts/test-workspace.mjs';
import { REPO_ROOT, treeDigest, verifyCheckpoint, type Row } from './checkpoint.ts';
import { normalize } from './compare.ts';

const KERNEL = join(REPO_ROOT, 'build', 'kernel', 'rpc.mjs');
/** The kernel's read methods, in one process per copy: none of them opens a turn or writes game state. */
export function kernelReads(workspace: string, campaign: string) {
  const calls = [
    { id: 'list', method: 'campaign.list', params: {} },
    { id: 'status', method: 'table.status', params: { campaign } },
    { id: 'capsule', method: 'table.capsule', params: { campaign, rehydrate: true } },
  ];
  const result = spawnSync(process.execPath, [KERNEL, '--workspace', workspace, '--content', join(REPO_ROOT, 'content')], { input: calls.map(c => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 ** 2, env: { ...process.env, COC_KERNEL_SEED: 'restore-check' } });
  const answers: Row = {};
  for (const line of (result.stdout ?? '').split('\n')) { try { const r = JSON.parse(line); if (r.id) answers[r.id] = r; } catch { } }
  return answers;
}
const scrub = (value: any, workspace: string) => JSON.parse(JSON.stringify(value).split(workspace).join('<workspace>'));

export function restoreCheck(checkpoint: string) {
  checkpoint = resolve(checkpoint);
  const verdict = verifyCheckpoint(checkpoint);
  const manifest = JSON.parse(readFileSync(join(checkpoint, 'manifest.json'), 'utf8')), campaign = manifest.source.campaign;
  const root = join(REPO_ROOT, '.coc', 'eval', 'restore-checks', manifest.id + '-' + Date.now());
  mkdirSync(root, { recursive: true });
  const copies = ['a', 'b'].map(name => { const ws = join(root, name); shareTestTree(join(checkpoint, 'home', '.coc'), join(ws, '.coc')); if (existsSync(join(checkpoint, 'home', 'source-skeletons'))) shareTestTree(join(checkpoint, 'home', 'source-skeletons'), join(ws, 'source-skeletons')); return ws; });
  const trees = copies.map(ws => treeDigest(ws));
  const reads = copies.map(ws => kernelReads(ws, campaign));
  // Lock and ownership markers are coordination between processes, not state.
  const afterReads = copies.map(ws => treeDigest(ws, path => /\.lock$|\.source-reading-owner$/.test(path)));
  const answers = reads.map((r, i) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, createHash('sha256').update(JSON.stringify(normalize(scrub(v, copies[i])))).digest('hex')])));
  const ok = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]: [string, any]) => [k, v?.ok === true]));
  // Isolation canary: a file in copy A, looked for in copy B and in the checkpoint.
  const canary = join('.coc', 'campaigns', campaign, 'replay-canary-' + randomUUID() + '.json');
  writeFileSync(join(copies[0], canary), '{"canary":true}\n');
  const isolation = { seen_in_b: existsSync(join(copies[1], canary)), seen_in_checkpoint: existsSync(join(checkpoint, 'home', canary)) };
  rmSync(join(copies[0], canary));
  const report = {
    checkpoint: manifest.id, grade: manifest.grade, verify_ok: verdict.ok,
    files_equal: trees[0].tree_sha256 === trees[1].tree_sha256 && trees[0].tree_sha256 === manifest.tree_sha256,
    reads_ok: reads.map(ok), reads_equal: JSON.stringify(answers[0]) === JSON.stringify(answers[1]),
    reads_differing: Object.keys(answers[0]).filter(k => answers[0][k] !== answers[1][k]),
    reads_wrote: afterReads.map((t, i) => Object.keys(t.files).filter(f => t.files[f] !== trees[i].files[f])),
    isolation, checkpoint_unchanged: treeDigest(join(checkpoint, 'home')).tree_sha256 === manifest.tree_sha256,
  };
  rmSync(root, { recursive: true, force: true });
  return { ...report, ok: report.verify_ok && report.files_equal && report.reads_equal && report.reads_ok.every(r => Object.values(r).every(Boolean)) && !isolation.seen_in_b && !isolation.seen_in_checkpoint && report.checkpoint_unchanged };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = restoreCheck(process.argv[2]);
  console.log(JSON.stringify(r, null, 2)); process.exitCode = r.ok ? 0 : 1;
}
