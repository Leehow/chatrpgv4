// SL-39 addendum: aggregate the per-model raw replay (sl39-lane-alternatives.mjs output, which
// carries player/module text via `recorded.grounds` and is never committed) into two things that
// ARE committed: a sanitized per-case file (ids, turns, verb, verdict labels, ms only) and a summary
// table (p50/p90/max latency, share of calls over the product's 13 s cap, verdict agreement with the
// recorded verdict, and run-to-run self-agreement), one row per candidate model.
//   node experiments/admission-jev-bank/sl39-lane-alternatives-summarize.mjs --raw-dir <dir> --out <dir>
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const argv = process.argv.slice(2), arg = (name) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const rawDir = arg('--raw-dir'), outDir = arg('--out');
if (!rawDir || !outDir) throw new Error('--raw-dir and --out are required');

const PRODUCT_CAP_MS = 13_000;
const quantile = (values, q) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
const readJsonl = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

const files = readdirSync(rawDir).filter(name => name.endsWith('.jsonl'));
const sanitizedAll = [];
const summaries = [];
for (const file of files) {
  const rows = readJsonl(join(rawDir, file));
  if (!rows.length) continue;
  const model = rows[0].candidate_model;
  const sanitized = rows.map(row => ({
    id: row.id, campaign: row.campaign, turn: row.turn, verb: row.verb, run: row.run, candidate_model: model,
    recorded_verdict: row.recorded?.verdict ?? null, recorded_reason: row.recorded?.verdict ? null : (row.recorded?.reason ?? null),
    ok: row.lane.ok, verdict: row.lane.ok ? row.lane.verdict : null, reason: row.lane.ok ? null : row.lane.reason,
    ms: row.lane.ms, over_13s: row.lane.over_13s,
  }));
  sanitizedAll.push(...sanitized);

  const ok = sanitized.filter(r => r.ok);
  const failed = sanitized.filter(r => !r.ok);
  const failureReasons = {};
  for (const r of failed) failureReasons[r.reason ?? 'unknown'] = (failureReasons[r.reason ?? 'unknown'] ?? 0) + 1;
  const latencies = ok.map(r => r.ms);

  // Verdict agreement: only cases whose recorded outcome is a real verdict (a string), excluding
  // review_pending/review_timeout/model_error rows that recorded no verdict to agree with.
  const byCase = new Map();
  for (const r of sanitized) { if (!byCase.has(r.id)) byCase.set(r.id, []); byCase.get(r.id).push(r); }
  const labelledCases = [...byCase.entries()].filter(([, runsForCase]) => typeof runsForCase[0].recorded_verdict === 'string');

  let runLevelMatches = 0, runLevelTotal = 0;
  let allThreeMatchRecorded = 0, atLeastTwoMatchRecorded = 0, atLeastOneMatchesRecorded = 0;
  let allThreeAgreeWithEachOther = 0;
  for (const [, runsForCase] of labelledCases) {
    const recordedVerdict = runsForCase[0].recorded_verdict;
    const okRuns = runsForCase.filter(r => r.ok);
    runLevelTotal += okRuns.length;
    const matches = okRuns.filter(r => r.verdict === recordedVerdict).length;
    runLevelMatches += matches;
    if (okRuns.length === runsForCase.length && matches === runsForCase.length) allThreeMatchRecorded++;
    if (matches >= 2) atLeastTwoMatchRecorded++;
    if (matches >= 1) atLeastOneMatchesRecorded++;
    const verdictSet = new Set(okRuns.map(r => r.verdict));
    if (okRuns.length === runsForCase.length && verdictSet.size === 1) allThreeAgreeWithEachOther++;
  }

  summaries.push({
    model,
    calls: sanitized.length,
    ok: ok.length,
    failed: failed.length,
    failure_reasons: failureReasons,
    latency_ms: {p50: quantile(latencies, 0.5), p90: quantile(latencies, 0.9), p95: quantile(latencies, 0.95), max: latencies.length ? Math.max(...latencies) : null},
    over_13s_share: ok.length ? ok.filter(r => r.over_13s).length / ok.length : null,
    over_13s_count: ok.filter(r => r.over_13s).length,
    verdict_agreement: {
      labelled_cases: labelledCases.length,
      run_level_matches: runLevelMatches, run_level_total: runLevelTotal,
      run_level_agreement: runLevelTotal ? runLevelMatches / runLevelTotal : null,
      cases_all_3_match_recorded: allThreeMatchRecorded,
      cases_ge2_match_recorded: atLeastTwoMatchRecorded,
      cases_ge1_match_recorded: atLeastOneMatchesRecorded,
    },
    self_agreement: {
      cases_all_3_runs_agree_with_each_other: allThreeAgreeWithEachOther,
      of_cases: labelledCases.length,
    },
  });
}

writeFileSync(join(outDir, 'per-case.json'), JSON.stringify(sanitizedAll, null, 2) + '\n');
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summaries, null, 2) + '\n');
process.stdout.write(JSON.stringify(summaries, null, 2) + '\n');
