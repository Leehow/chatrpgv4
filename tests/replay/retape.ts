/**
 * Replay evaluation (R1): replay the recorded live runs of an earlier batch through the real kernel again, without
 * new live runs -- for re-checking layer 2 after a change to the tape matcher or the kernel.
 *
 *   node tests/replay/retape.ts --rows <rows.jsonl> --arm gk --out <report dir> [--only <case,...>]
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Row } from './checkpoint.ts';
import { compareRuns } from './compare.ts';
import { RUNS_ROOT, replayRun } from './run.ts';

function args(argv: string[]) { const a: Row = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i]; return a; }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2)), out = resolve(a.out), only = a.only ? new Set(String(a.only).split(',')) : null;
  mkdirSync(out, { recursive: true });
  for (const line of readFileSync(resolve(a.rows), 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line), live = row[a.arm];
    if (!live?.run_id || only && !only.has(row.case)) continue;
    const source = JSON.parse(readFileSync(join(RUNS_ROOT, live.run_id, 'result.json'), 'utf8'));
    const result: Row = { case: row.case, live: live.run_id };
    try {
      const t = await replayRun({ checkpoint: source.checkpoint.dir, arm: a.arm, model: source.arm.model, thinking: source.arm.thinking ?? undefined, rep: source.rep, tape: join(RUNS_ROOT, live.run_id, 'capture') });
      const c = compareRuns(join(RUNS_ROOT, live.run_id), join(RUNS_ROOT, t.run_id));
      Object.assign(result, { tape: t.run_id, divergences: t.capture?.divergences, plugins: t.daemon?.plugins, leftovers: t.leftovers?.length, rolls_equal: c.rolls_equal, receipts_equal: c.receipts_equal, rendered_equal: c.rendered_equal, state_equal: c.state_equal, state_files_differing: c.state_files_differing });
    } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
    appendFileSync(join(out, 'retape.jsonl'), JSON.stringify(result) + '\n');
    console.log(JSON.stringify({ case: result.case, divergences: result.divergences, state_equal: result.state_equal, error: result.error }));
  }
}
