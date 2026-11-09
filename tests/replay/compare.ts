/**
 * Replay evaluation (R1): what a run ended with, in forms two runs can be compared by, and the comparison.
 *
 *   node tests/replay/compare.ts <run dir A> <run dir B>
 *
 * Normalisation removes only the fields listed in VOLATILE: wall-clock stamps and durations, which differ between any
 * two executions. Game time, entity identity, reference scope, document text and the order of actions are never
 * removed. Output names files, fields and digests only -- never prose.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Row } from './checkpoint.ts';

/** Wall-clock fields: when something happened on the host, never what happened in the game. */
export const VOLATILE = new Set(['at', 'opened_at', 'closed_at', 'created_at', 'updated_at', 'started_at', 'ended_at', 'recorded_at', 'written_at', 'accepted_at', 'completed_at', 'durations', 'timings', '_recv_at', 'ts', 'wall_ms', 'elapsed_ms']);
/**
 * Execution identity in the kernel's records: the sidecar commit hash (it covers the commit time), host run and attempt
 * ids, and digests computed over them (delivery packet and binding, call parameter digests, the world revision, whose
 * world.json is compared on its own; the memory step key, a digest over the sidecar commit). Masked in the turn records and
 * the event log.
 */
export const EXECUTION_IDENTITY = new Set(['commit', 'record_commit', 'attempt_id', 'delivery_id', 'packet', 'binding', 'params_sha256', 'world_revision', 'reference_step']);
const RUN_ID = /run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export function normalize(value: any, mask: Set<string> = new Set()): any {
  if (Array.isArray(value)) return value.map(v => normalize(v, mask));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => !VOLATILE.has(k) && !mask.has(k)).map(k => [k, normalize(value[k], mask)]));
  if (typeof value === 'string' && mask.size) return value.replace(RUN_ID, 'run-<id>');
  return value;
}
const readJson = (path: string) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const readJsonl = (path: string) => { try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return { unparsable: line.length }; } }); } catch { return null; } };

/** The authoritative campaign state after the turn, one normalised digest per record. */
export function stateDigest(workspace: string, campaign: string) {
  const dir = join(workspace, '.coc', 'campaigns', campaign), files: Row = {};
  const add = (name: string, value: any) => { if (value !== null && value !== undefined) files[name] = sha(JSON.stringify(normalize(value))); };
  for (const name of ['world.json', 'turn.json', 'npc-ledger.json', 'epithets.json', 'first-sight.json', 'npc-journal.json', 'campaign.json']) add(name, readJson(join(dir, name)));
  for (const name of existsSync(join(dir, 'party')) ? readdirSync(join(dir, 'party')).sort() : []) add('party/' + name, readJson(join(dir, 'party', name)));
  add('events.jsonl', (readJsonl(join(dir, 'events.jsonl')) ?? null)?.map((event: Row) => normalize(event, EXECUTION_IDENTITY)));
  add('transcript.jsonl', readJsonl(join(dir, 'transcript.jsonl')));
  for (const name of existsSync(join(dir, 'turns')) ? readdirSync(join(dir, 'turns')).sort() : []) { const record = readJson(join(dir, 'turns', name)); add('turns/' + name, record === null ? null : normalize(record, EXECUTION_IDENTITY)); }
  return { files, digest: sha(JSON.stringify(files)) };
}

/** Dice, receipts and how the turn closed, from the kernel's own record of turn N. */
export function outcomeOf(workspace: string, campaign: string, turn: number) {
  const dir = join(workspace, '.coc', 'campaigns', campaign), record = readJson(join(dir, 'turns', String(turn).padStart(4, '0') + '.json')), cursor = readJson(join(dir, 'turn.json'));
  if (!record) return { recorded: false, cursor: cursor ? { turn: cursor.turn, state: cursor.state } : null };
  const receipts: Row[] = Array.isArray(record.receipts) ? record.receipts : [];
  const rolls = receipts.flatMap(r => {
    const out: Row[] = [];
    if (['roll', 'dice'].includes(r.kind)) out.push({ id: r.id, kind: r.kind, family: r.family ?? null, skill: r.skill ?? null, roll: r.roll ?? null, target: r.target ?? null, level: r.level ?? null, passed: r.passed ?? null, total: r.total ?? null, faces: r.faces ?? null });
    if (r.band_roll) out.push({ id: r.id, kind: 'band', band: r.band ?? null, band_roll: normalize(r.band_roll) });
    return out;
  });
  return {
    recorded: true, closed_by: record.closed_by ?? 'narrate', cursor: cursor ? { turn: cursor.turn, state: cursor.state } : null,
    receipt_kinds: receipts.map(r => r.kind), receipts_sha256: sha(JSON.stringify(normalize(receipts))), rolls,
    mechanics_sha256: sha(JSON.stringify(normalize(record.mechanics ?? []))), rendered_sha256: typeof record.rendered_text === 'string' ? sha(record.rendered_text) : null,
    rendered_chars: typeof record.rendered_text === 'string' ? record.rendered_text.length : 0,
  };
}

/** What the run sent out and how much of it the capture saw. */
export function captureSummary(dir: string) {
  const rows = existsSync(dir) ? readdirSync(dir).filter(n => /^requests-\d+\.jsonl$/.test(n)).flatMap(n => readJsonl(join(dir, n)) ?? []) : [];
  const requests = rows.filter(r => r.kind === 'request' && !r.local), ends = new Map(rows.filter(r => r.kind === 'response_end').map(r => [r.id, r]));
  const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
  const byHost: Row = {}, transport: Row = {};
  for (const r of requests) byHost[host(r.url)] = (byHost[host(r.url)] ?? 0) + 1;
  for (const r of rows.filter(r => r.kind === 'transport')) transport[host(r.origin)] = (transport[host(r.origin)] ?? 0) + 1;
  // A tape answer never reaches the transport, so only network requests are expected there.
  const network: Row = {}; for (const r of requests.filter(r => r.source === 'network')) network[host(r.url)] = (network[host(r.url)] ?? 0) + 1;
  const uncovered = Object.entries(transport).reduce((n, [h, count]) => n + Math.max(0, (count as number) - (network[h] ?? 0)), 0);
  return {
    requests: requests.length, processes: new Set(rows.map(r => r.pid)).size, by_host: byHost, from_tape: requests.filter(r => r.source === 'tape').length,
    incomplete: requests.filter(r => !ends.get(r.id)?.complete && !ends.get(r.id)?.consumer_stopped).length, consumer_stopped: requests.filter(r => ends.get(r.id)?.consumer_stopped).length, unsupported_bodies: requests.filter(r => String(r.form).startsWith('unsupported')).length,
    transport_seen: Object.values(transport).reduce((a: number, b: any) => a + b, 0), uncovered,
    divergences: rows.filter(r => r.kind === 'divergence').length, first_divergence: rows.filter(r => r.kind === 'divergence').sort((a, b) => a.t.localeCompare(b.t))[0] ?? null,
  };
}

export function compareRuns(a: string, b: string) {
  const ra = readJson(join(resolve(a), 'result.json')), rb = readJson(join(resolve(b), 'result.json'));
  if (!ra || !rb) throw new Error('Both run directories need a result.json');
  const same = (x: any, y: any) => JSON.stringify(x) === JSON.stringify(y);
  const stateFiles = new Set([...Object.keys(ra.state_after?.files ?? {}), ...Object.keys(rb.state_after?.files ?? {})]);
  const differing = [...stateFiles].filter(f => ra.state_after?.files?.[f] !== rb.state_after?.files?.[f]).sort();
  const rollsA = ra.outcome?.rolls ?? [], rollsB = rb.outcome?.rolls ?? [];
  let firstRoll = -1; for (let i = 0; i < Math.max(rollsA.length, rollsB.length); i++) if (!same(rollsA[i], rollsB[i])) { firstRoll = i; break; }
  return {
    a: ra.run_id, b: rb.run_id,
    same_start: ra.checkpoint?.tree_sha256 === rb.checkpoint?.tree_sha256 && ra.restore?.tree_sha256 === rb.restore?.tree_sha256,
    same_seed: ra.kernel_seed === rb.kernel_seed,
    first_tape_divergence: { a: ra.capture?.first_divergence ?? null, b: rb.capture?.first_divergence ?? null },
    closed_by: [ra.outcome?.closed_by ?? null, rb.outcome?.closed_by ?? null],
    rolls_equal: same(rollsA, rollsB), first_roll_difference: firstRoll,
    receipts_equal: ra.outcome?.receipts_sha256 === rb.outcome?.receipts_sha256,
    receipt_kinds: [ra.outcome?.receipt_kinds ?? [], rb.outcome?.receipt_kinds ?? []],
    mechanics_equal: ra.outcome?.mechanics_sha256 === rb.outcome?.mechanics_sha256,
    rendered_equal: ra.outcome?.rendered_sha256 === rb.outcome?.rendered_sha256,
    state_equal: ra.state_after?.digest === rb.state_after?.digest, state_files_differing: differing,
    wall_seconds: [ra.driver_turn?.wall_seconds ?? null, rb.driver_turn?.wall_seconds ?? null],
    settle: [ra.driver_turn?.settle_class ?? null, rb.driver_turn?.settle_class ?? null],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) { console.error('usage: compare.ts RUN_DIR_A RUN_DIR_B'); process.exitCode = 2; }
  else console.log(JSON.stringify(compareRuns(a, b), null, 2));
}
