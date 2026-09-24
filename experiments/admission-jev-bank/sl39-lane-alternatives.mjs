// SL-39 addendum: replay the admission lane's own reviewer -- not the Jev typed family -- against
// several ALTERNATIVE models, live, so the owner can pick one after long gate #4 hit the 13 s cap
// four times and one `review_timeout` in 20 turns. Reuses SL-39's own approach (`reviewAdmission`
// called directly, `PI_COC_ADMISSION_MODEL` forced per candidate) and SL-30's harness shape
// (sl30-line-level.mjs): a small worker pool, one call per worker at a time, jobs interleaved by
// run so a provider's slow minute does not land on one case's every run.
//
//   node experiments/admission-jev-bank/sl39-lane-alternatives.mjs --bank <bank.jsonl> --auth <auth.json>
//     --model <provider/id> --out <out.jsonl> [--runs 3] [--cap 60000] [--concurrency 5] [--ids a,b]
//
// `--cap` is deliberately larger than the product's 13 s admission cap (DEFAULT_ADMISSION_TIMEOUT_MS,
// extensions/kernel/admission.ts): the product genuinely aborts a round at 13 s, but a round aborted
// at 13 s tells us nothing about how much slower a candidate is beyond it, which is exactly the
// number this measurement exists to produce. Every row still carries `over_13s` so "share of calls
// over the product's cap" is computed after the fact from the true latency, the same choice SL-39's
// own replay made ("cap 60 s ... so the tail is not truncated by the cap this measurement is trying
// to check"). The lane's reasoning effort is left at its own default (`laneThinkingLevel`, low
// unless PI_COC_LANE_THINKING overrides it) so every candidate runs at the same effort the product
// lane would use for it.
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
const ROOT = join(import.meta.dirname, '../..');
const argv = process.argv.slice(2), arg = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const bankPath = arg('--bank'), authPath = arg('--auth'), model = arg('--model'), outPath = arg('--out');
const runs = Number(arg('--runs', '3')), cap = Number(arg('--cap', '60000')), concurrency = Number(arg('--concurrency', '5'));
const PRODUCT_CAP_MS = 13_000;
const ids = arg('--ids') ? new Set(arg('--ids').split(',')) : undefined;
if (!bankPath || !authPath || !model || !outPath) throw new Error('--bank, --auth, --model and --out are required');

process.env.PI_COC_ADMISSION_MODEL = model;
const {ModelRuntime, ModelRegistry} = await import(`${ROOT}/build/node_modules/@earendil-works/pi-coding-agent/dist/index.js`);
const {reviewAdmission} = await import(`${ROOT}/extensions/kernel/admission.ts`);

const runtime = await ModelRuntime.create({authPath, modelsPath: null, modelsStorePath: join(dirname(authPath), 'models-store.json'), refreshOnCreate: false});
// `grok-build` is not a pi-ai built-in and carries no models-store entry: production only sees it
// because the `grok-build-oauth` extension calls `pi.registerProvider` at session start. An offline
// script never boots that extension, so `ctx.modelRegistry.find('grok-build', ...)` would otherwise
// fail with `model_unavailable` -- register the same provider config here, the extension's own
// factory (`createAuthProvider`, which awaits the live catalog so `grok-4.7-build-fast` is present),
// so the resolution path this measurement exercises matches what the table actually runs on.
if (model.startsWith('grok-build/')) {
  const {createAuthProvider, GROK_BUILD_PROVIDER_ID} = await import(`${ROOT}/extensions/grok-build-oauth/agent/provider.js`);
  runtime.registerProvider(GROK_BUILD_PROVIDER_ID, await createAuthProvider({authPath}));
}
const registry = new ModelRegistry(runtime);

const cases = readFileSync(bankPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  .filter(value => (!ids || ids.has(value.id)) && (value.verb === 'apply' || value.verb === 'resolve'));

async function lane(value, tag) {
  const input = value.input;
  const ctx = {cwd: ROOT, model: undefined, modelRegistry: registry, sessionManager: {getSessionId: () => `sl39-alt-${value.id}-${tag}`}};
  const proposal = {tool: value.verb, key: `${value.id}:${tag}`, lines: input.proposal, kinds: value.kinds};
  const context = {turn: input.turn, playerText: input.playerText, ...(input.interruptedPlayerText ? {interruptedPlayerText: input.interruptedPlayerText} : {}),
    investigators: input.investigators, ...(input.scene ? {scene: input.scene} : {}), present: input.present ?? [], delivered: input.delivered ?? [],
    landed: input.landed ?? [], refused: input.refused ?? []};
  const began = Date.now();
  try {
    const outcome = await reviewAdmission({ctx, proposal, context, record: () => {}, timeoutMs: cap});
    const ms = Date.now() - began;
    return outcome.ok === true
      ? {ok: true, verdict: outcome.verdict.verdict, ms, over_13s: ms > PRODUCT_CAP_MS, model_label: outcome.model}
      : {ok: false, reason: outcome.reason ?? 'late', detail: outcome.detail ?? null, ms, over_13s: ms > PRODUCT_CAP_MS, model_label: outcome.model ?? null};
  } catch (error) {
    return {ok: false, reason: 'harness_error', detail: String(error), ms: Date.now() - began, over_13s: null, model_label: null};
  }
}

const jobs = [];
for (let run = 1; run <= runs; run++) for (const value of cases) jobs.push({value, run});
writeFileSync(outPath, '');
let next = 0, done = 0;
await Promise.all(Array.from({length: Math.max(1, concurrency)}, async () => {
  for (;;) {
    const job = jobs[next++];
    if (!job) return;
    const {value, run} = job;
    const row = {id: value.id, campaign: value.campaign, turn: value.turn, verb: value.verb, kinds: value.kinds,
      candidate_model: model, run, cap_ms: cap, product_cap_ms: PRODUCT_CAP_MS, recorded: value.lane,
      lane: await lane(value, `r${run}`)};
    appendFileSync(outPath, JSON.stringify(row) + '\n');
    done++;
    const answer = row.lane.ok ? `${row.lane.verdict} ${row.lane.ms}ms` : `${row.lane.reason} ${row.lane.ms}ms`;
    process.stderr.write(`[${model}] ${done}/${jobs.length} ${value.id} r${run} -> ${answer}\n`);
  }
}));
process.stderr.write(`[${model}] done\n`);
