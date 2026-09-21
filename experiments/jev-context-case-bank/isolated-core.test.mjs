// Mechanical transport/decision doubles only; no provider requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareRequest} from './live-core.mjs';
import {prepareStages, needsSelection, gradePolicy, isolatedSchedule, isolatedSummary} from './isolated-core.mjs';
import {sourceAbsenceFloor} from './isolated-analysis.mjs';
const datasets = ['builtin','pdf'].map(n => JSON.parse(fs.readFileSync(new URL(`./${n}.json`,import.meta.url))));
const pdf = datasets[1];
const body = (p, values = {}) => ({answers:Object.fromEntries(Object.entries(p.request.questions).map(([key,q]) =>
  [key,{choice:values[key] ?? Object.keys(q.criteria)[0]}]))});

test('selection-only cohort is 11 arms twice with two actual policies, not all eight families', () => {
  const tasks = isolatedSchedule(datasets);
  assert.equal(tasks.length,44);
  assert.equal(new Set(tasks.map(t => `${t.case_id}/${t.arm_id}`)).size,11);
  assert.deepEqual([...new Set(tasks.map(t => t.dataset_id))],['pdf-context-contrasts']);
});
test('mixed control is unchanged; gate sees no candidate payload or selection menu; no gold routing', () => {
  const p = prepareStages(pdf,'beetle-joint-supplement','empty');
  assert.deepEqual(p.mixed,prepareRequest(pdf,'beetle-joint-supplement','empty','joint-subsets'));
  assert.equal(Object.hasOwn(p.gate.request.state,'candidates'),false);
  assert.equal(Object.hasOwn(p.gate.request.questions,'selection'),false);
  assert.deepEqual(p.gate.request.state.existing_material,p.mixed.request.state.existing_material);
  assert.deepEqual(p.gate.request.questions.content,p.mixed.request.questions.content);
  assert.deepEqual(p.selection.request.state,p.mixed.request.state);
  assert.deepEqual(Object.keys(p.selection.request.questions),['selection']);
  assert.equal(Object.keys(p.selection.request.questions.selection.criteria).length,64);
  const copy = structuredClone(pdf);
  for (const c of copy.cases) for (const a of c.arms) a.expected = {secret:'GOLD_CANARY'};
  assert.deepEqual(prepareStages(copy,'beetle-joint-supplement','empty'),p);
  copy.materials.find(m => m.id === 'beetle-place').text = 'CANDIDATE_CANARY';
  const changed = prepareStages(copy,'beetle-joint-supplement','empty');
  assert.equal(JSON.stringify(changed.gate.request).includes('CANDIDATE_CANARY'),false);
  assert.equal(JSON.stringify(changed.selection.request).includes('CANDIDATE_CANARY'),true);
});
test('content alone controls supplementation; source verification remains an independent score', () => {
  const p = prepareStages(pdf,'idol-context-fidelity','faithful');
  const b = body(p.gate,{content:'complete',source_support:'incomplete'});
  assert.equal(needsSelection(p.gate,b),false);
  const grade = gradePolicy(pdf,'idol-context-fidelity','faithful','isolated',p,b);
  assert.equal(grade.all_correct,true);
  assert.equal(grade.selection_origin,'host_empty_on_content_complete');
  assert.throws(() => gradePolicy(pdf,'idol-context-fidelity','faithful','isolated',p,b,body(p.selection)));
});
test('host stop is reported separately from the raw mixed model selection', () => {
  const p = prepareStages(pdf,'beetle-joint-supplement','both-present');
  const b = body(p.mixed,{content:'complete',selection:'set_9'});
  const raw = gradePolicy(pdf,'beetle-joint-supplement','both-present','mixed',p,b);
  const guarded = gradePolicy(pdf,'beetle-joint-supplement','both-present','mixed-host-stop',p,b);
  assert.equal(raw.selection_exact,false); assert.equal(guarded.selection_exact,true);
  assert.equal(raw.selection_origin,'mixed_model_choice');
  assert.equal(guarded.selection_origin,'host_empty_on_content_complete');
  assert.equal(b.answers.selection.choice,'set_9');
});
test('missing gates combine only genuine stage answers; false-ready is not a zero-byte success', () => {
  const p = prepareStages(pdf,'beetle-joint-supplement','empty');
  const missing = body(p.gate,{content:'missing'});
  assert.equal(needsSelection(p.gate,missing),true);
  const grade = gradePolicy(pdf,'beetle-joint-supplement','empty','isolated',p,missing,body(p.selection,{selection:'set_9'}));
  assert.equal(grade.all_correct,true);
  assert.equal(grade.selection_origin,'selection_only_model_choice');
  const falseReady = gradePolicy(pdf,'beetle-joint-supplement','empty','isolated',p,body(p.gate,{content:'complete'}));
  assert.equal(falseReady.false_ready,true); assert.equal(falseReady.all_correct,false);
  assert.equal(falseReady.selection_exact,false); assert.equal(falseReady.declared_evidence_units_covered,false);
  assert.equal(falseReady.mechanically_added_text_bytes,0);
});
test('post-hoc source floor uses only trusted absence and preserves the original model response', () => {
  const p = prepareStages(pdf,'idol-context-fidelity','faithful');
  const b = body(p.mixed,{content:'complete',source_support:'complete',selection:'set_0'});
  const before = structuredClone(b), floor = sourceAbsenceFloor(p.mixed,b);
  assert.equal(floor.applies,true); assert.equal(floor.changed,true);
  assert.equal(floor.body.answers.source_support.choice,'incomplete');
  assert.deepEqual(b,before);
  const grade = gradePolicy(pdf,'idol-context-fidelity','faithful','mixed-host-stop',p,floor.body);
  assert.equal(grade.all_correct,true);
  const copy = structuredClone(p.mixed);
  copy.request.state.existing_material[0].provenance = 'source_excerpt';
  assert.equal(sourceAbsenceFloor(copy,b).applies,false,'text and semantic gold do not drive the floor');
});
test('source presence never proves full support or repairs a semantic coverage error', () => {
  const p = prepareStages(pdf,'idol-context-fidelity','holder-only');
  const b = body(p.mixed,{content:'missing',source_support:'complete',selection:'set_0'});
  const floor = sourceAbsenceFloor(p.mixed,b);
  assert.equal(floor.applies,false); assert.equal(floor.changed,false);
  assert.equal(floor.body.answers.source_support.choice,'complete','wrong model answer remains wrong when any original excerpt exists');
  assert.equal(gradePolicy(pdf,'idol-context-fidelity','holder-only','mixed-host-stop',p,floor.body).fields.source_support,false);
});
test('invalid gate or selector is unavailable; never silently skipped', () => {
  const p = prepareStages(pdf,'beetle-joint-supplement','empty');
  assert.throws(() => needsSelection(p.gate,{}));
  assert.equal(gradePolicy(pdf,'beetle-joint-supplement','empty','isolated',p,{}).available,false);
  assert.equal(gradePolicy(pdf,'beetle-joint-supplement','empty','isolated',p,body(p.gate,{content:'missing'}),{}).available,false);
});
test('summary pairs the same arms, reports host contribution and does not hide missing policies', () => {
  const p = prepareStages(pdf,'beetle-joint-supplement','both-present');
  const b = body(p.mixed,{content:'complete',selection:'set_9'}), g = body(p.gate,{content:'complete'});
  const base = {dataset_id:pdf.id,case_id:'beetle-joint-supplement',arm_id:'both-present',repeat:1,ok:true,ms:10,
    usage:{input_tokens:100,output_tokens:10},provider_calls:1};
  const rows = ['mixed','mixed-host-stop','isolated'].map(policy => ({...base,policy,
    grade:gradePolicy(pdf,base.case_id,base.arm_id,policy,p,policy === 'isolated' ? g : b)}));
  const summary = isolatedSummary(rows,[base,{...base,repeat:2}]);
  assert.equal(summary.valid_pairs,1); assert.equal(summary.unavailable_pairs.length,1);
  assert.equal(summary.policies.mixed.selection_exact,0);
  assert.equal(summary.policies['mixed-host-stop'].selection_exact,1);
  assert.equal(summary.policies['mixed-host-stop'].derived_from_mixed,true);
  assert.equal(summary.policies.isolated.host_stops,1);
});
