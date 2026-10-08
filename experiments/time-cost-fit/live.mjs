/** §202: bounded live question probe. --dry never reads credentials or contacts a provider. */
import {readFile, mkdir, writeFile, appendFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {runBandShadow, shadowBindings, shadowState, timeQuestion, BAND_SHADOW_FAMILY, BAND_SHADOW_VERSION} from '../../runtime/jev/band-shadow-domain.ts';
import {packDecisionBatch, JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import {createDecisionAdapter, JEV_INPUT_USD_PER_MILLION} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {readJevApiKey} from '../../extensions/jev/agent/config.js';

const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
if (!args.includes('--dry') && !args.includes('--live')) throw Error('choose --dry or an explicitly approved --live');
for (const key of ['--campaign', '--out']) if (!args.includes(key)) throw Error(`${key} is required`);
const root = resolve(import.meta.dirname, '../..'), campaign = resolve(value('--campaign')), out = resolve(value('--out'));
const table = JSON.parse(await readFile(join(root, 'content/rulesets/coc7/rules-json/time-costs.json'), 'utf8'));
const rows = Object.entries(table.categories).map(([handle, row]) => ({handle, min: row.min, max: row.max, default: row.default, covers: row.covers}));
const expected = {1: ['library_research'], 3: ['speak_briefly'], 4: ['speak_briefly'], 5: ['speak_briefly'],
  6: ['library_research'], 7: ['library_research'], 8: ['record_lookup', 'library_research'], 9: ['record_lookup'], 10: ['record_lookup'],
  13: ['single_room_search'], 14: ['brief_activity', 'quick_observation', 'single_room_search'],
  15: ['brief_activity', 'quick_observation', 'single_room_search'], 16: ['brief_activity', 'quick_observation', 'single_room_search'], 17: ['quick_observation']};
const cases = [];
for (let turn = 1; turn <= 18; turn++) {
  const record = JSON.parse(await readFile(join(campaign, 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
  if (typeof record.player_text !== 'string' || !record.player_text.trim()) throw Error(`turn ${turn} has no declaration`);
  cases.push({id: `turn-${turn}`, declaration: record.player_text, accepted: expected[turn] ?? null});
}
cases.push({id: 'whole-house', declaration: 'I search the whole house room by room.', accepted: ['careful_house_search']},
  {id: 'microfilm-afternoon', declaration: 'I spend the afternoon researching the old reports in the library microfilm.', accepted: ['library_research']},
  {id: 'brief-drink-rest', declaration: 'I rest a few minutes over a drink.', accepted: ['investigation_recovery']});
const inputs = cases.map((item, index) => ({kind: 'time', campaign: 'time-cost-fit-probe', turn: index + 1,
  callId: item.id, index: 0, declaration: item.declaration, settled: [], rows}));
const estimates = inputs.map(input => {
  const bindings = shadowBindings(input);
  return packDecisionBatch({id: input.callId, model: JEV_MODEL, family: BAND_SHADOW_FAMILY, familyVersion: BAND_SHADOW_VERSION,
    ...bindings, state: shadowState(input), questions: [timeQuestion(rows)]}).estimate;
});
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const manifest = {version: 1, cases, cases_sha256: digest(cases), table_sha256: digest(table), model: JEV_MODEL,
  familyVersion: BAND_SHADOW_VERSION, calls: cases.length, maxRetries: 0, timeoutMs: 30000, maxCostUsd: 0.10,
  estimatedInputUpperBound: estimates.reduce((sum, item) => sum + item.totalUpperBound, 0),
  pricing: {inputUsdPerMillion: JEV_INPUT_USD_PER_MILLION, source: 'https://docs.typesafe.ai/models'},
  scope: 'Declaration-only question accuracy, not a Keeper run, full three-view clerk policy, arithmetic or gameplay acceptance. No campaign/world write.',
  bars: 'All predeclared accepted sets must match; turns without a set are reported without post-hoc scoring. Short acts must not choose an hour-scale row. Unavailable requests fail; no retries or discarded cases.',
  settledContext: 'Empty: the declared-time clerk asks before Keeper actions. The probe does not use Keeper why, chosen band or numeric receipt.'};
await mkdir(out, {recursive: true});
const manifestPath = join(out, 'preregister.json');
if (args.includes('--dry')) {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({calls: manifest.calls, estimatedInputUpperBound: manifest.estimatedInputUpperBound,
    estimatedCostUpperBoundUsd: manifest.estimatedInputUpperBound * JEV_INPUT_USD_PER_MILLION / 1e6, preregister: manifestPath}));
  process.exit(0);
}
const frozen = JSON.parse(await readFile(manifestPath, 'utf8'));
if (frozen.cases_sha256 !== manifest.cases_sha256 || frozen.table_sha256 !== manifest.table_sha256) throw Error('the approved probe inputs changed');
const key = readJevApiKey(); if (!key) throw Error('Jev credential unavailable; no request sent');
const outputPath = join(out, 'live-results.jsonl');
await writeFile(outputPath, '', {flag: 'wx'});
const decision = createDecisionAdapter({apiKey: key, maxConcurrency: 1,
  retryPolicies: {[BAND_SHADOW_FAMILY]: {maxRetries: 0, backoffInitialMs: 0, backoffMaxMs: 0, attemptTimeoutMs: manifest.timeoutMs}}});
let charged = 0, mismatches = 0;
for (const [index, input] of inputs.entries()) {
  const bindings = shadowBindings(input), allowance = manifest.maxCostUsd - charged;
  const lease = new TaskLease({owner: BAND_SHADOW_FAMILY, goal: 'verify the approved time question', ...bindings,
    capabilities: ['decision'], budget: {deadlineAt: Date.now() + manifest.timeoutMs, remainingInputTokens: 64000,
      remainingOutputTokens: 64000, remainingCostUsd: allowance, remainingActions: 1}});
  let result;
  try {result = await runBandShadow(input, decision, lease); charged += allowance - lease.context.budget.remainingCostUsd;}
  finally {lease.close();}
  const item = cases[index], matched = item.accepted === null ? null : result.status === 'answered' && item.accepted.includes(result.band);
  if (matched === false || result.status !== 'answered') mismatches++;
  await appendFile(outputPath, JSON.stringify({id: item.id, matched, result, chargedUsd: charged}) + '\n');
  console.log(JSON.stringify({id: item.id, status: result.status, band: result.band ?? null, matched}));
  if (charged >= manifest.maxCostUsd) break;
}
console.log(JSON.stringify({mismatches, chargedUsd: charged, results: outputPath}));
if (mismatches) process.exitCode = 1;
