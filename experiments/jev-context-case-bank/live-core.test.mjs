// Mechanical doubles only. This file never sends provider requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareRequest, gradeResponse, schedule, summarize, pairedSummary, validateLiveResponse} from './live-core.mjs';
const datasets = ['builtin','pdf'].map(n => JSON.parse(fs.readFileSync(new URL(`./${n}.json`, import.meta.url))));
const pdf = datasets[1];
function bodyFor(prepared, choices = {}) {
  return {answers: Object.fromEntries(Object.entries(prepared.request.questions).map(([key,q]) =>
    [key, {choice: choices[key] ?? Object.keys(q.criteria)[0]}]))};
}

test('formal schedule is 56 joint and 22 independent requests, not 78 independent cases', () => {
  const tasks = schedule(datasets, 2);
  assert.equal(tasks.length, 78);
  assert.equal(tasks.filter(t => t.policy === 'joint-subsets').length, 56);
  assert.equal(tasks.filter(t => t.policy === 'independent').length, 22);
  assert.equal(new Set(tasks.map(t => `${t.dataset_id}/${t.case_id}/${t.arm_id}`)).size, 28);
});
test('joint menu enumerates all 64 subsets without reading the oracle', () => {
  const p = prepareRequest(pdf, 'beetle-joint-supplement', 'empty', 'joint-subsets');
  assert.equal(Object.keys(p.request.questions.selection.criteria).length, 64);
  const copy = structuredClone(pdf);
  for (const c of copy.cases) for (const a of c.arms) a.expected = {secret: 'GOLD_CANARY'};
  assert.deepEqual(prepareRequest(copy, 'beetle-joint-supplement', 'empty', 'joint-subsets'), p);
  assert.equal(JSON.stringify(p.request).includes('GOLD_CANARY'), false);
});
test('valid subset choices decode by candidate identity; wrong selection cannot pass coverage alone', () => {
  const p = prepareRequest(pdf, 'beetle-joint-supplement', 'empty', 'joint-subsets');
  const wanted = p.binding.selection_options.find(o => o.materials.join('|') === 'beetle-place|beetle-fire');
  const good = gradeResponse(pdf, 'beetle-joint-supplement', 'empty', 'joint-subsets', p, bodyFor(p, {content: 'missing', selection: wanted.id}));
  assert.equal(good.all_correct, true);
  const bad = gradeResponse(pdf, 'beetle-joint-supplement', 'empty', 'joint-subsets', p, bodyFor(p, {content: 'missing', selection: 'set_1'}));
  assert.equal(bad.common_fields_correct, true); assert.equal(bad.selection_exact, false); assert.equal(bad.declared_evidence_units_covered, false);
});
test('independent over-selection and mechanical source normalization remain separate metrics', () => {
  const joint = prepareRequest(pdf, 'beetle-joint-supplement', 'empty', 'joint-subsets');
  const wanted = joint.binding.selection_options.find(o => o.materials.join('|') === 'beetle-place|beetle-fire');
  const j = gradeResponse(pdf, 'beetle-joint-supplement', 'empty', 'joint-subsets', joint, bodyFor(joint, {content:'missing',selection:wanted.id}));
  const p = prepareRequest(pdf, 'beetle-joint-supplement', 'empty', 'independent');
  const choices = {content:'missing'};
  for (const [key,id] of Object.entries(p.binding.candidate_questions)) choices[key] = ['rat-fire','beetle-place-paraphrase'].includes(id) ? 'unrelated' : 'adds_needed';
  const g = gradeResponse(pdf, 'beetle-joint-supplement', 'empty', 'independent', p, bodyFor(p, choices));
  assert.equal(g.selection_exact, false); assert.equal(g.declared_evidence_units_covered, true);
  assert.ok(g.mechanical_exact_removal_bytes > 0);
  assert.equal(g.mechanically_added_text_bytes, j.mechanically_added_text_bytes, 'host exact normalization rescues literal overlap, not the model');
  const paraphraseKey = Object.keys(p.binding.candidate_questions).find(k => p.binding.candidate_questions[k] === 'beetle-place-paraphrase');
  choices[paraphraseKey] = 'adds_needed';
  const semanticDuplicate = gradeResponse(pdf, 'beetle-joint-supplement', 'empty', 'independent', p, bodyFor(p, choices));
  assert.ok(semanticDuplicate.mechanically_added_text_bytes > g.mechanically_added_text_bytes, 'host must not use faithful labels to deduplicate semantic content');
});
test('uncertain is a valid conservative decision, while malformed choices are unavailable', () => {
  const p = prepareRequest(pdf, 'beetle-purpose-routing', 'where', 'independent');
  const choices = {content:'missing', ...Object.fromEntries(Object.keys(p.binding.candidate_questions).map(k => [k,'uncertain']))};
  const g = gradeResponse(pdf, 'beetle-purpose-routing', 'where', 'independent', p, bodyFor(p, choices));
  assert.equal(g.available, true); assert.equal(g.selection_uncertain_material_ids.length, 3); assert.equal(g.all_correct, false);
  const bad = bodyFor(p); bad.answers.content.choice = 'not-a-choice';
  assert.equal(validateLiveResponse(p.request,bad), 'invalid_choice');
  assert.equal(gradeResponse(pdf, 'beetle-purpose-routing', 'where', 'independent', p, bad).available, false);
});
test('paired reporting excludes unrelated joint tasks and separates unavailable pairs', () => {
  const base = {dataset_id:'test',case_id:'paired',arm_id:'one',repeat:1,ok:true,ms:10,
    usage:{input_tokens:100,output_tokens:10},grade:{has_selection:true,all_correct:true,fields:{content:true},
      selection_exact:true,declared_evidence_units_covered:true,selection_uncertain_material_ids:[],
      mechanically_added_text_bytes:20,raw_selected_unit_bytes:20}};
  const rows = [{...base,policy:'joint-subsets'},{...base,policy:'independent'},
    {...base,case_id:'unpaired',policy:'joint-subsets',ms:5000,usage:{input_tokens:9000,output_tokens:100}}];
  const inventory = [...rows,{...base,arm_id:'unavailable',policy:'joint-subsets'},
    {...base,arm_id:'unavailable',policy:'independent'}];
  const p = pairedSummary(rows,inventory);
  assert.equal(p.planned_pairs,2); assert.equal(p.valid_pairs,1); assert.equal(p.unavailable_pairs.length,1);
  assert.equal(p.policies['joint-subsets'].reported_input_tokens,100);
  assert.equal(p.policies['joint-subsets'].latency_p95_ms,10);
  assert.equal(p.policies.independent.requests,1);
});
test('unavailable calls and missing usage are never scored as correct zero-cost successes', () => {
  const s = summarize([{policy:'joint-subsets',ok:false,usage:null,ms:30_000,grade:null}])['joint-subsets'];
  assert.equal(s.available,0); assert.equal(s.unavailable,1); assert.equal(s.all_correct,0);
  assert.equal(s.usage_complete,false); assert.equal(s.estimated_input_cost_usd,null);
});
