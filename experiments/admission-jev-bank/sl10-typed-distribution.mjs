// SL-10 measurement (contract §32.11): run the §32.10 typed family at minimum confidence 0 on the bank's
// lane-labelled bookkeeping batches (an `apply` whose every §32.1 triggering kind is move, clue, handout or time)
// and keep, per line, the chosen verdict, its confidence and the whole verdict distribution. Thresholds are then
// applied offline by sl10-analyze.py, with no further calls. Needs the Jev credential in EXT_JEV_APIKEY.
//   node experiments/admission-jev-bank/sl10-typed-distribution.mjs <bank.jsonl> <out.jsonl> [concurrency]
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const ROOT = join(import.meta.dirname, '../..');
const TRIGGER = new Set(['move', 'clue', 'time', 'cash', 'item', 'handout', 'map', 'object', 'usage']);
const FAST = new Set(['move', 'clue', 'handout', 'time']);
const bookkeeping = value => {
  const triggering = (value.kinds ?? []).filter(kind => TRIGGER.has(kind));
  return value.verb === 'apply' && triggering.length > 0 && triggering.every(kind => FAST.has(kind)) && !!value.lane?.verdict;
};
const {createDecisionAdapter} = await import(`${ROOT}/runtime/jev/decision-adapter.ts`);
const {TaskLease} = await import(`${ROOT}/runtime/jev/task-context.ts`);
const {admissionJevBindings, runAdmissionJev} = await import(`${ROOT}/runtime/jev/admission-domain.ts`);
const [bankPath, outPath, conc = '8'] = process.argv.slice(2);
const cases = readFileSync(bankPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(bookkeeping);
const adapter = createDecisionAdapter({env: process.env, maxConcurrency: 16});
const rows = new Array(cases.length); let next = 0;
async function one(value) {
  const input = value.input, captured = [];
  const port = {async decide(batch, lease) { const result = await adapter.decide(batch, lease); captured.push(result); return result; }};
  const b = admissionJevBindings(input);
  const lease = new TaskLease({owner: 'action-admission', goal: 'SL-10 offline measurement', scope: b.scope, capabilities: ['decision'], readSet: b.readSet,
    budget: {deadlineAt: Date.now() + 20_000, remainingInputTokens: 200_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.02, remainingActions: 4}});
  try {
    const result = await runAdmissionJev(input, port, lease, {minConfidence: 0});
    const dist = {};
    for (const r of captured) for (const [key, answer] of Object.entries(r.answers ?? {})) if (key.startsWith('verdict_') && answer.status === 'answered') dist[key] = answer.probabilities ?? null;
    return {id: value.id, campaign: value.campaign, turn: value.turn, source: value.source.kind === 'session' ? 'session' : String(value.source.run ?? '').startsWith('pb-') ? 'persona-bench' : 'table',
      kinds: value.kinds, lane: value.lane.verdict, lane_ms: value.lane.ms, lane_model: value.lane.model, status: result.status, reason: result.reason ?? null,
      jev: result.verdict ?? null, confidence: result.confidence ?? null, lines: (result.lines ?? []).map((line, index) => ({verdict: line.verdict, confidence: line.confidence, probabilities: dist[`verdict_${index}`] ?? null})),
      jev_ms: result.elapsedMs, calls: result.calls};
  } finally { lease.close(); }
}
await Promise.all(Array.from({length: Number(conc)}, async () => { for (;;) { const i = next++; if (i >= cases.length) return; try { rows[i] = await one(cases[i]); } catch (e) { rows[i] = {id: cases[i].id, error: String(e)}; } if (i % 100 === 0) process.stderr.write(`${i}\n`); } }));
writeFileSync(outPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
process.stderr.write('done\n');
