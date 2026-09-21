// Offline analysis only. The source-absence floor was NOT a preregistered policy.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {sha,summarize,validateLiveResponse} from './live-core.mjs';
import {prepareStages,gradePolicy} from './isolated-core.mjs';

export function sourceAbsenceFloor(prepared, body) {
  if (validateLiveResponse(prepared.request,body)) throw new Error('Valid raw response required');
  const corrected = structuredClone(body);
  const applies = Boolean(prepared.request.questions.source_support)
    && prepared.request.state.existing_material.every(m => m.provenance !== 'source_excerpt');
  const changed = applies && body.answers.source_support.choice !== 'incomplete';
  if (applies) corrected.answers.source_support.choice = 'incomplete';
  return {body:corrected,applies,changed,reason:applies ? 'No original source excerpt is present in existing_material.' : null};
}
export function analyzeRun(directory) {
  const read = file => JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
  const manifest = read('manifest.json'), datasets = read('evaluation-only-datasets.json'), records = read('records.json');
  const rows = [], failures = [];
  let replayed = 0;
  for (const [file,hash] of Object.entries(manifest.code_hashes)) assert.equal(sha(fs.readFileSync(path.join(directory,`executed-${file}`))),hash);
  for (const r of records) {
    assert.equal(r.ok,true,'This analysis requires the completed all-valid run');
    const data = datasets.find(d => d.id === r.dataset_id), stages = prepareStages(data,r.case_id,r.arm_id);
    const firstStage = r.policy === 'isolated' ? 'gate' : 'mixed';
    for (const stage of r.policy === 'isolated' ? ['gate','selection'] : ['mixed']) {
      const packet = manifest.packets.find(p => p.id === `${r.number}-${stage}`);
      assert.equal(sha(JSON.stringify(stages[stage].request)),packet.hash);
      assert.equal(sha(JSON.stringify(read(`request-${packet.id}.json`))),packet.hash);
    }
    const firstBody = read(`response-${r.number}-${firstStage}.json`).body;
    const secondBody = r.policy === 'isolated' && r.selection_required ? read(`response-${r.number}-selection.json`).body : null;
    assert.deepEqual(gradePolicy(data,r.case_id,r.arm_id,r.policy,stages,firstBody,secondBody),r.grade);
    replayed++;
    if (!r.grade.all_correct) failures.push({policy:r.policy,case_id:r.case_id,arm_id:r.arm_id,repeat:r.repeat,
      fields_wrong:Object.entries(r.grade.fields).filter(([,ok]) => !ok).map(([k]) => k),
      selected:r.grade.selected_material_ids,selection_exact:r.grade.selection_exact,
      added_bytes:r.grade.mechanically_added_text_bytes});
    if (r.policy !== 'mixed') continue;
    const floor = sourceAbsenceFloor(stages.mixed,firstBody);
    rows.push({...r,policy:'posthoc-source-floor',derived_from_mixed:true,source_floor_applies:floor.applies,
      source_floor_changed:floor.changed,source_floor_reason:floor.reason,
      grade:gradePolicy(data,r.case_id,r.arm_id,'mixed-host-stop',stages,floor.body)});
  }
  const result = {replayed_policy_records:replayed,request_hashes_and_grades_unchanged:true,
    formal_summary:read('summary.json'),execution:read('execution.json'),failures,
    posthoc:{preregistered:false,new_provider_calls:0,raw_responses_and_scores_unchanged:true,
      rule:'Apply mixed host-stop, and reject source_support=complete only when trusted existing_material has zero source_excerpt entries. Presence of any excerpt never proves full semantic support.',
      limits:'Evaluated on the same development set after seeing errors, not a fresh blind win. Reported costs reuse actual mixed requests, not a new paid run. No claim about unseen questions or full-book retrieval.',
      applicable:rows.filter(r => r.source_floor_applies).length,changed:rows.filter(r => r.source_floor_changed).length,
      policies:summarize(rows),records:rows}};
  const out = path.join(directory,'analysis.json');
  if (fs.existsSync(out)) assert.deepEqual(read('analysis.json'),result,'Existing analysis differs; retain it instead of overwriting');
  else fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node isolated-analysis.mjs <run-directory>');
  const r = analyzeRun(path.resolve(process.argv[2]));
  console.log(JSON.stringify({replayed:r.replayed_policy_records,execution:r.execution,failures:r.failures,
    posthoc:{...r.posthoc,records:undefined}},null,2));
}
