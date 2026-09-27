#!/usr/bin/env node
// SL-97 phase 2a's own "next step" (results/sl97b/README.md): relabel the 720 cases phase 2a replayed with today's
// product admission lane -- exact `admissionSystemPrompt`/`admissionRequest` (extensions/kernel/admission.ts), the
// owner's current lane model -- two runs each, no Jev call. Adapts sl30-line-level.mjs's worker-pool shape and
// sl39-lane-alternatives.mjs's grok-build provider registration; unlike either, this measures ONLY the lane (no
// typed family call at all -- phase 2a's "no new Jev call" instruction).
//
// Per case, per run: one call on the whole batch (`measure: "lane_batch"`), plus -- only when the batch has more
// than one proposal line, since a 1-line batch's own call already is that line's call -- one call per line alone
// (`measure: "lane_line"`), the same per-line technique SL-30 used to get "a per-line label the batch verdict
// cannot give". Cap is deliberately larger than the product's 13 s admission cap (DEFAULT_ADMISSION_TIMEOUT_MS):
// the product genuinely refuses at 13 s, but a round cut there tells us nothing about the true verdict a longer
// wait would have found, which is exactly what this measurement compares against the old bank label and the
// other run. Every row still carries `over_13s` so "share over the product's cap" is computed after the fact.
//
// Output is sanitized by construction (no `grounds`/`missing`/`detail`, which can quote player words): id, sample,
// campaign, turn, verb, kinds, run, measure, index/kind (for lane_line), the old bank label, and the new verdict/
// ms/reason/timed_out/over_13s only -- the same fields SL-39's committed addendum kept ("ids, turns, verbs, verdict
// labels, ms only -- no player or module text").
//
//   node experiments/admission-jev-bank/sl97c-relabel.mjs --bank <bank.jsonl> --main-ids <ids.txt> --holdout-ids <ids.txt>
//     --out <out.jsonl> --auth <auth.json> [--model grok-build/grok-4.5] [--thinking low] [--runs 2] [--cap 60000]
//     [--concurrency 6] [--limit N]
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const argv = process.argv.slice(2), arg = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const argAll = name => argv.flatMap((value, index) => value === name ? [argv[index + 1]] : []);
const bankPaths = argAll('--bank'), mainIdsPath = arg('--main-ids'), holdoutIdsPath = arg('--holdout-ids');
const outPath = arg('--out'), authPath = arg('--auth');
const model = arg('--model', 'grok-build/grok-4.5'), thinking = arg('--thinking', 'low');
const runs = Number(arg('--runs', '2')), cap = Number(arg('--cap', '60000')), concurrency = Number(arg('--concurrency', '6'));
const limit = arg('--limit') ? Number(arg('--limit')) : undefined;
const PRODUCT_CAP_MS = 13_000;
if (!bankPaths.length || !mainIdsPath || !holdoutIdsPath || !outPath || !authPath) {
  throw new Error('--bank (repeatable), --main-ids, --holdout-ids, --out and --auth are required');
}

const {ModelRuntime, ModelRegistry} = await import(`${ROOT}/build/node_modules/@earendil-works/pi-coding-agent/dist/index.js`);
const {reviewAdmission} = await import(`${ROOT}/extensions/kernel/admission.ts`);

process.env.PI_COC_ADMISSION_MODEL = model;
process.env.PI_COC_ADMISSION_MODEL_THINKING = thinking; // SL-91 rank: a lane-specific override outranks the table/setting.

const runtime = await ModelRuntime.create({authPath, modelsPath: null, modelsStorePath: join(dirname(authPath), 'models-store.json'), refreshOnCreate: false});
// grok-build is not a pi-ai built-in provider; production only sees it because the grok-build-oauth extension
// registers it at session start (see sl39-lane-alternatives.mjs's identical comment). Register the same way here.
if (model.startsWith('grok-build/')) {
  const {createAuthProvider, GROK_BUILD_PROVIDER_ID} = await import(`${ROOT}/extensions/grok-build-oauth/agent/provider.js`);
  runtime.registerProvider(GROK_BUILD_PROVIDER_ID, await createAuthProvider({authPath}));
}
const registry = new ModelRegistry(runtime);

const readIds = path => new Set(readFileSync(path, 'utf8').split('\n').map(line => line.trim()).filter(Boolean));
const mainIds = readIds(mainIdsPath), holdoutIds = readIds(holdoutIdsPath);
const wantedIds = new Set([...mainIds, ...holdoutIds]);

const bank = new Map();
for (const path of bankPaths) for (const line of readFileSync(path, 'utf8').split('\n')) {
  if (!line) continue;
  const value = JSON.parse(line);
  if (wantedIds.has(value.id) && !bank.has(value.id)) bank.set(value.id, value);
}
const missing = [...wantedIds].filter(id => !bank.has(id));
if (missing.length) throw new Error(`${missing.length} case ids not found in the given banks, e.g. ${missing.slice(0, 5).join(', ')}`);

let cases = [...mainIds].map(id => ({...bank.get(id), sample: 'main'})).concat([...holdoutIds].map(id => ({...bank.get(id), sample: 'holdout'})));
if (limit) cases = cases.slice(0, limit);
process.stderr.write(`${cases.length} cases (${mainIds.size} main + ${holdoutIds.size} holdout), model=${model} thinking=${thinking} cap=${cap}ms runs=${runs} concurrency=${concurrency}\n`);

async function lane(value, lines, kinds, tag) {
  const input = value.input;
  const ctx = {cwd: ROOT, model: undefined, modelRegistry: registry, sessionManager: {getSessionId: () => `sl97c-relabel-${value.id}-${tag}`}};
  const proposal = {tool: value.verb, key: `${value.id}:${tag}`, lines, kinds};
  const context = {turn: input.turn, playerText: input.playerText, ...(input.interruptedPlayerText ? {interruptedPlayerText: input.interruptedPlayerText} : {}),
    investigators: input.investigators, ...(input.scene ? {scene: input.scene} : {}), present: input.present ?? [], delivered: input.delivered ?? [],
    landed: input.landed ?? [], refused: input.refused ?? []};
  const began = Date.now();
  try {
    const outcome = await reviewAdmission({ctx, proposal, context, record: () => {}, timeoutMs: cap});
    const ms = Date.now() - began;
    // Sanitized by construction: no grounds/missing/detail (may quote player words), verdict labels and ms only.
    return outcome.ok === true
      ? {ok: true, verdict: outcome.verdict.verdict, ms, over_13s: ms > PRODUCT_CAP_MS}
      : {ok: false, reason: outcome.reason ?? 'late', ms, over_13s: ms > PRODUCT_CAP_MS};
  } catch (error) {
    return {ok: false, reason: 'harness_error', ms: Date.now() - began, over_13s: null};
  }
}

const jobs = [];
for (let run = 1; run <= runs; run++) for (const value of cases) {
  jobs.push({kind: 'lane_batch', value, run});
  if (value.input.proposal.length > 1) value.input.proposal.forEach((_line, index) => jobs.push({kind: 'lane_line', value, run, index}));
}
process.stderr.write(`${jobs.length} lane calls queued\n`);

writeFileSync(outPath, '');
let next = 0, done = 0;
await Promise.all(Array.from({length: Math.max(1, concurrency)}, async () => {
  for (;;) {
    const job = jobs[next++];
    if (!job) return;
    const {value, run} = job;
    const base = {id: value.id, sample: value.sample, campaign: value.campaign, turn: value.turn, verb: value.verb, kinds: value.kinds,
      run, lane_model: model, lane_thinking: thinking, cap_ms: cap, recorded: value.lane?.verdict ?? null};
    const row = job.kind === 'lane_batch'
      ? {...base, measure: 'lane_batch', lane: await lane(value, value.input.proposal, value.kinds, `batch-${run}`)}
      : {...base, measure: 'lane_line', index: job.index, kind: value.kinds[job.index],
        lane: await lane(value, [value.input.proposal[job.index]], [value.kinds[job.index]], `line-${job.index}-${run}`)};
    appendFileSync(outPath, JSON.stringify(row) + '\n');
    done++;
    const answer = row.lane.ok ? `${row.lane.verdict} ${row.lane.ms}ms` : `${row.lane.reason} ${row.lane.ms}ms`;
    if (done % 20 === 0 || done === jobs.length) process.stderr.write(`${done}/${jobs.length} ${row.measure} ${value.id} r${run}${row.index !== undefined ? ` l${row.index}` : ''} -> ${answer}\n`);
  }
}));
process.stderr.write('done\n');
