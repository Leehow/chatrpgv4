/**
 * SL-52 stage 2: live Jev on the §135.30.9.2 re-ask at gate #6 t1 (see results/sl52-reask-wording/PREREGISTERED.md).
 * Builds the product's re-ask batch (`reaskBatch`, unmodified) over the office's rows from the starter graph, and one arm with
 * the ruling's framing swapped into the instructions/criteria. Records every answer. No product code is changed.
 *
 *   EXT_JEV_APIKEY=... node experiments/single-loop-routing/sl52-reask-probe.mjs [--runs 5]
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {reaskBatch} from '../../runtime/jev/route-compile.ts';
import {answerOf} from '../../runtime/jev/decision-gate.ts';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';

const argv = process.argv.slice(2), RUNS = Number(argv.includes('--runs') ? argv[argv.indexOf('--runs') + 1] : 5);
const REPO = resolve(import.meta.dirname, '../..'), OUT = join(import.meta.dirname, 'results/sl52-reask-wording');
const graph = JSON.parse(readFileSync(join(REPO, 'content/starters/the-haunting/module-graph.json'), 'utf8'));
const node = id => graph.nodes.find(value => value.node_id === id);
const office = node('scene-commission-briefing').properties.runtime_projection.record;
const cues = id => office.affordances.filter(aff => aff.clue_id === id).map(aff => aff.cue);
const clue = handle => ({key: `apply:clue:${handle}`, verb: 'apply', family: 'clue', clerk: 'declared_bookkeeping', bound: {kind: 'clue', clue: handle}, unbound: [],
  label: handle, source: 'table.apply.options', detail: {delivery_kind: node(`clue-${handle}`).properties.delivery_kind},
  basis: {row: {description: {cues: cues(`clue-${handle}`)}}}});
const handles = ['knott-commission', 'knott-macario-summary', 'knott-keys'];
const view = {runId: 'sl52-reask-probe', rawInput: '我接。先去《环球报》剪报室，翻科比特宅这些年的旧报道。',
  context: {scene: "Knott's Office", clock: null, present: ['史蒂文·诺特'], receipts: []}, materials: [], observations: [],
  candidates: handles.map(clue), rows: {ask: handles.map(handle => ({id: `clue:${handle}`, describe: {clue: node(`clue-${handle}`).summary}}))}};
const input = {settled: [{key: 'apply:clue:knott-research-leads', words: {settles: {clue: node('clue-knott-research-leads').summary}, opens: 'Boston Globe offices'}}],
  clues: handles.map(handle => `apply:clue:${handle}`), after: 'apply:clue:knott-research-leads'};
const scope = {owner: 'campaign:sl52-reask-probe', campaign: 'sl52-reask-probe', worldline: 'main', loop: 0, audience: 'keeper'};
const readSet = [{kind: 'model', resource: 'decision', revision: JEV_MODEL}, {kind: 'family', resource: 'single-loop-compile-reask', revision: '1'}];
const V1 = {instructions: 'Judge this one clue on its own. The host settles the listed step now, as the player declared it. Does settling that step, '
  + 'as declared, yield this clue as the book\'s cue for it states? The cue is how the book says this clue is obtained here. Other listed clues may '
  + 'follow too; judge only this one. Choose unclear when the input does not tell.',
  criteria: {yes: 'Settling the step as declared yields this clue, as its cue states.', no: 'It does not yield this clue.', unclear: 'The input does not tell.'}};
const arms = {V0: batch => batch, V1: batch => ({...batch, id: `${batch.id}-v1`, questions: batch.questions.map(question => ({...question, ...V1, criteria: {...V1.criteria}}))})};
const decision = createDecisionAdapter({env: process.env, maxConcurrency: 1});
const out = {generated_at: new Date().toISOString(), runs: RUNS, arms: {}};
for (const [arm, shape] of Object.entries(arms)) {
  out.arms[arm] = [];
  for (let i = 0; i < RUNS; i++) {
    const batch = shape(reaskBatch({...view, observations: [{n: i}]}, input, scope, readSet, []));
    const lease = new TaskLease({owner: 'single-loop-compile-reask', goal: view.rawInput, scope, capabilities: ['decision'], readSet,
      budget: {deadlineAt: Date.now() + 20_000, remainingInputTokens: 400_000, remainingOutputTokens: 40_000, remainingCostUsd: 2, remainingActions: 60}});
    let result; try { result = await decision.decide(batch, lease); } finally { lease.close(); }
    const row = Object.fromEntries(handles.map((handle, index) => [handle, answerOf(result, `reask_${index + 1}`)]));
    out.arms[arm].push({status: result.status, ...row});
    console.log(arm, i + 1, result.status, handles.map(handle => `${handle}:${row[handle].choice}@${row[handle].confidence}`).join(' '));
  }
}
writeFileSync(join(OUT, 'answers.json'), JSON.stringify(out, null, 1) + '\n');
