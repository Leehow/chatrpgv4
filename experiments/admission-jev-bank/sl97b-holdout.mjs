#!/usr/bin/env node
// SL-97 phase 2a: a holdout bank disjoint from the cases the design was iterated on. Usage:
//   node experiments/admission-jev-bank/sl97b-holdout.mjs --bank <bank.jsonl> --exclude <replay.jsonl> [--exclude ...] --out <holdout.jsonl>
//     [--classes time,move,clue] [--refusals 50] [--admits 60] [--seed 2]
// Keeps lane-labelled cases (a live verdict, not review_pending), never a `cash` batch (lane-only by §32.10), in the
// given batch classes (closed effect kinds, `batchClass`), stratified per class into lane refusals and lane admits,
// each stratum shuffled with a seeded generator and cut at its quota. Reads only; writes only --out.
import {readFileSync, writeFileSync} from 'node:fs';
import {ADMIT, REFUSE, batchClass} from './sl97b-analyze.mjs';

export function holdout(cases, excluded, {classes, refusals, admits, seed}) {
  let state = seed >>> 0 || 1;
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const strata = new Map();
  for (const value of cases) {
    const verdict = value.lane.verdict;
    if (excluded.has(value.id) || !(ADMIT.has(verdict) || REFUSE.has(verdict)) || (value.kinds ?? []).includes('cash') || value.verb !== 'apply') continue;
    const cls = batchClass(value.input.proposal);
    if (!classes.includes(cls)) continue;
    const key = `${cls}:${REFUSE.has(verdict) ? 'refuse' : 'admit'}`;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(value);
  }
  return classes.flatMap(cls => ['refuse', 'admit'].flatMap(side => (strata.get(`${cls}:${side}`) ?? [])
    .map(value => [random(), value]).sort((a, b) => a[0] - b[0]).slice(0, side === 'refuse' ? refusals : admits).map(([, value]) => value)));
}

function main() {
  const argv = process.argv.slice(2), options = {exclude: [], classes: ['time', 'move', 'clue'], refusals: 50, admits: 60, seed: 2};
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === '--bank') options.bank = value; else if (flag === '--out') options.out = value; else if (flag === '--exclude') options.exclude.push(value);
    else if (flag === '--classes') options.classes = value.split(','); else if (flag === '--refusals') options.refusals = Number(value);
    else if (flag === '--admits') options.admits = Number(value); else if (flag === '--seed') options.seed = Number(value);
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!options.bank || !options.out || !options.exclude.length) throw new Error('--bank, --out and at least one --exclude are required');
  const read = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const excluded = new Set(options.exclude.flatMap(read).map(row => row.id));
  const picked = holdout(read(options.bank), excluded, options);
  writeFileSync(options.out, picked.map(value => JSON.stringify(value)).join('\n') + '\n');
  const counts = {};
  for (const value of picked) { const key = `${batchClass(value.input.proposal)}:${REFUSE.has(value.lane.verdict) ? 'refuse' : 'admit'}`; counts[key] = (counts[key] ?? 0) + 1; }
  process.stdout.write(`${JSON.stringify({cases: picked.length, excluded: excluded.size, counts}, null, 2)}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
