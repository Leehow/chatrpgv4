/**
 * Replay evaluation (R1): a paired batch over selected cases.
 *
 *   node tests/replay/batch.ts --cases <cases.json> --out <report dir> --arms 'gk=grok-build/grok-4.6:low,mm=minimax-cn/MiniMax-M3.1-Flash-Preview:medium'
 *                              [--tape-arm gk] [--only <campaign-tNNNN,...>]
 *
 * For every case, in order: restore the checkpoint twice and compare (layer 1); run each arm live once from the
 * same C0 with the same kernel seed; replay the tape arm's capture through the real kernel and compare it with its
 * live run (layer 2); pair the arms (the evaluation itself). Runs one at a time. Every case gets a row, failures
 * included: a refused or failed run stays in the report with its reason. Rows carry verdict fields only.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Row } from './checkpoint.ts';
import { compareRuns } from './compare.ts';
import { restoreCheck } from './restore-check.ts';
import { RUNS_ROOT, replayRun } from './run.ts';

function args(argv: string[]) { const a: Row = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i]; return a; }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function runBatch(options: { cases: string; out: string; arms: string; tapeArm?: string; only?: string }) {
  const cases = JSON.parse(readFileSync(resolve(options.cases), 'utf8')).cases as Row[], out = resolve(options.out);
  const arms = options.arms.split(',').map(spec => { const [name, rest] = spec.split('='); const [model, thinking] = rest.split(':'); return { name, model, thinking }; });
  const tapeArm = options.tapeArm ?? arms[0].name, only = options.only ? new Set(options.only.split(',')) : null;
  mkdirSync(out, { recursive: true });
  const rows: Row[] = [], log = join(out, 'rows.jsonl');
  for (const c of cases) {
    const id = c.checkpoint.split('/').pop();
    if (only && !only.has(id)) continue;
    const row: Row = { case: id, book: c.book, class: c.class, source: { run: c.run, model: c.model, wall_seconds: c.wall_seconds, settle: c.settle }, started_at: new Date().toISOString() };
    try { const r = restoreCheck(c.checkpoint); row.restore = { ok: r.ok, files_equal: r.files_equal, reads_equal: r.reads_equal, isolation: r.isolation, checkpoint_unchanged: r.checkpoint_unchanged }; }
    catch (error) { row.restore = { ok: false, error: errorText(error) }; }
    const live: Row = {};
    for (const arm of arms) {
      try { const r = await replayRun({ checkpoint: c.checkpoint, arm: arm.name, model: arm.model, thinking: arm.thinking, rep: 1 }); live[arm.name] = r; row[arm.name] = summary(r); }
      catch (error) { row[arm.name] = { error: errorText(error) }; if (/plugins missing|did not start/.test(errorText(error))) { row.aborted = true; } }
      if (row.aborted) break;
    }
    if (!row.aborted && live[tapeArm]) {
      try {
        const source = live[tapeArm], t = await replayRun({ checkpoint: c.checkpoint, arm: tapeArm, model: source.arm.model, thinking: source.arm.thinking ?? undefined, rep: 1, tape: join(RUNS_ROOT, source.run_id, 'capture') });
        row.tape = { ...summary(t), vs_live: pick(compareRuns(join(RUNS_ROOT, source.run_id), join(RUNS_ROOT, t.run_id))) };
      } catch (error) { row.tape = { error: errorText(error) }; }
    }
    const [a, b] = arms.map(arm => live[arm.name]);
    if (a && b) row.paired = pick(compareRuns(join(RUNS_ROOT, a.run_id), join(RUNS_ROOT, b.run_id)));
    row.ended_at = new Date().toISOString();
    rows.push(row); appendFileSync(log, JSON.stringify(row) + '\n');
    if (row.aborted) break;
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify({ arms, tape_arm: tapeArm, cases: rows.length, rows }, null, 2) + '\n');
  return rows;
}
function summary(r: Row) {
  return { run_id: r.run_id, settle: r.driver_turn?.settle_class ?? null, wall_seconds: r.driver_turn?.wall_seconds ?? null, tools: r.driver_turn?.tools ?? [], closed_by: r.outcome?.closed_by ?? null, rolls: r.outcome?.rolls?.length ?? 0, prose_chars: r.outcome?.rendered_chars ?? 0, long_thinking_steps: r.driver_turn?.long_thinking_steps ?? null, requests: r.capture?.requests ?? null, uncovered: r.capture?.uncovered ?? null, divergences: r.capture?.divergences ?? null, plugins: r.daemon?.plugins ?? [], leftovers: r.leftovers?.length ?? null };
}
function pick(c: Row) {
  return { same_start: c.same_start, same_seed: c.same_seed, closed_by: c.closed_by, rolls_equal: c.rolls_equal, first_roll_difference: c.first_roll_difference, receipts_equal: c.receipts_equal, mechanics_equal: c.mechanics_equal, rendered_equal: c.rendered_equal, state_equal: c.state_equal, state_files_differing: c.state_files_differing, first_tape_divergence: c.first_tape_divergence?.b ? { url: c.first_tape_divergence.b.url, nearest: c.first_tape_divergence.b.nearest } : null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  const rows = await runBatch({ cases: a.cases, out: a.out, arms: a.arms, tapeArm: a['tape-arm'], only: a.only });
  console.log(JSON.stringify({ cases: rows.length, restore_ok: rows.filter(r => r.restore?.ok).length, tape_state_equal: rows.filter(r => r.tape?.vs_live?.state_equal).length, aborted: rows.some(r => r.aborted) }));
}
