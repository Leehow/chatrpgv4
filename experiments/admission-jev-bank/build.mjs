#!/usr/bin/env node
// Build the offline admission case bank from retained evidence (contract §32.10). Read-only over
// every root; writes only --out. Usage:
//   node experiments/admission-jev-bank/build.mjs --out <dir> [--home <.coc dir>]... [--sessions <dir>]...
// A --home is a `.coc` directory holding `campaigns/` and optionally `playtests/`.
import {existsSync, mkdirSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {isReviewRow, playtestTurns, readJson, readJsonl, sessionTurns, turnCases} from './bank-core.mjs';

function args(argv) {
  const out = {homes: [], sessions: []};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index], value = argv[index + 1];
    if (flag === '--out') { out.out = value; index++; }
    else if (flag === '--home') { out.homes.push(value); index++; }
    else if (flag === '--sessions') { out.sessions.push(value); index++; }
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!out.out || !out.homes.length) throw new Error('--out and at least one --home are required');
  return out;
}
const dirs = path => existsSync(path) ? readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()) : [];
function jsonlFiles(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, {recursive: true}).map(name => join(path, String(name))).filter(name => name.endsWith('.jsonl') && statSync(name).isFile());
}

const options = args(process.argv.slice(2));
const campaigns = new Map(); // id -> {dir, home, rows}
const byRun = new Map();
for (const home of options.homes) for (const id of dirs(join(home, 'campaigns'))) {
  const dir = join(home, 'campaigns', id);
  const rows = readJsonl(join(dir, 'telemetry.jsonl')).filter(isReviewRow);
  if (!rows.length || campaigns.has(id)) continue;
  campaigns.set(id, {dir, home, rows});
  for (const row of rows) if (row.run_id) byRun.set(row.run_id, id);
}
const consumed = new Set();
const identity = (campaign, row) => JSON.stringify([campaign, row.turn, row.verb, row.key, row.ms, row.verdict ?? row.reason]);
const cases = [];
function take(source, campaign, turn) {
  const pool = campaigns.get(campaign)?.rows ?? [];
  return pool.filter(row => row.turn === turn.turn && !consumed.has(identity(campaign, row)));
}
function emit(source, campaign, turn, rows) {
  const entry = campaigns.get(campaign);
  const built = turnCases({source, campaign, dir: entry.dir, turn: turn.turn, tools: turn.tools, rows, playerText: turn.playerText});
  for (const value of built) cases.push(value);
  // Every row this turn offered is consumed once, paired or not, so no second source reuses it.
  for (const row of rows) consumed.add(identity(campaign, row));
}

// Sessions first: adjacency pairing is exact.
for (const root of options.sessions) for (const file of jsonlFiles(root)) {
  for (const turn of sessionTurns(file)) {
    const run = turn.rows.find(row => row.run_id)?.run_id;
    const campaign = run ? byRun.get(run) : undefined;
    if (!campaign) continue;
    const rows = turn.rows.map(row => campaigns.get(campaign).rows.find(candidate => identity(campaign, candidate) === identity(campaign, row)) ?? row)
      .filter(row => !consumed.has(identity(campaign, row)));
    if (!rows.length) continue;
    // Point each attached row at the campaign's own copy so consumption is shared.
    for (const tool of turn.tools) if (tool.row) tool.row = rows.find(row => identity(campaign, row) === identity(campaign, tool.row));
    emit({kind: 'session', file}, campaign, turn, rows);
  }
}
for (const home of options.homes) for (const run of dirs(join(home, 'playtests'))) {
  const runDir = join(home, 'playtests', run);
  const final = readJson(join(runDir, 'final.json')) ?? {};
  const campaign = campaigns.has(run) ? run : [final.campaign, final.campaign_id].find(id => campaigns.has(id));
  if (!campaign) continue;
  for (const turn of playtestTurns(runDir)) {
    const rows = take('driver', campaign, turn);
    if (rows.length) emit({kind: 'driver', run}, campaign, turn, rows);
  }
}

const count = (values, key) => values.reduce((total, value) => { const k = key(value); total[k] = (total[k] ?? 0) + 1; return total; }, {});
const totalRows = [...campaigns.values()].reduce((sum, entry) => sum + entry.rows.length, 0);
const stats = {
  built_at: new Date().toISOString(),
  homes: options.homes.map(home => resolve(home)), sessions: options.sessions.map(root => resolve(root)),
  review_rows: totalRows, campaigns_with_reviews: campaigns.size, cases: cases.length,
  unpaired_rows: totalRows - cases.length,
  by_lane_verdict: count(cases, value => value.lane.verdict ?? `unavailable:${value.lane.reason}`),
  by_lane_model: count(cases, value => value.lane.model ?? 'unknown'),
  by_source: count(cases, value => value.source.kind === 'session' ? 'session'
    : value.source.run.startsWith('pb-') ? 'driver:persona-bench' : 'driver:table'),
  by_pairing: count(cases, value => value.pairing),
  key_match: count(cases, value => String(value.key_match)),
  lines_from: count(cases, value => value.lines_from),
  notes: count(cases.flatMap(value => value.notes.map(note => ({note}))), value => value.note),
};
mkdirSync(options.out, {recursive: true});
writeFileSync(join(options.out, 'bank.jsonl'), cases.map(value => JSON.stringify(value)).join('\n') + '\n');
writeFileSync(join(options.out, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');
process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
