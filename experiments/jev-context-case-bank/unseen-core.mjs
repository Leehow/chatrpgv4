// Prospectively fixed host rules, reused unchanged from the preceding experiment.
import {prepareStages,gradePolicy} from './isolated-core.mjs';
import {sourceAbsenceFloor} from './isolated-analysis.mjs';
import {validateLiveResponse,summarize} from './live-core.mjs';
export const UNSEEN_POLICIES = ['raw','host-stop','single-host-boundaries'];
export function readResponseText(response,onHttpFailure) {
  if (!response.ok) onHttpFailure();
  return response.text();
}
export async function dispatchAfterIntent({isStopped,writeIntent,cancelled,send}) {
  if (isStopped()) return null;
  await writeIntent();
  if (isStopped()) {await cancelled();return null;}
  // No await between this final stop check and starting send().
  return send();
}
export function prepareUnseen(data,caseId,armId) {
  const stages = prepareStages(data,caseId,armId);
  if (!stages.mixed.request.questions.source_support) throw new Error('Source-support question required');
  return stages;
}
export function scoreUnseen(data,caseId,armId,stages,body) {
  const issue = validateLiveResponse(stages.mixed.request,body);
  if (issue) return Object.fromEntries(UNSEEN_POLICIES.map(p => [p,{available:false,protocol_error:issue}]));
  const floor = sourceAbsenceFloor(stages.mixed,body);
  return {
    raw:gradePolicy(data,caseId,armId,'mixed',stages,body),
    'host-stop':gradePolicy(data,caseId,armId,'mixed-host-stop',stages,body),
    'single-host-boundaries':{...gradePolicy(data,caseId,armId,'mixed-host-stop',stages,floor.body),
      source_floor_applies:floor.applies,source_floor_changed:floor.changed,
      source_support_origin:floor.applies ? 'host_absence_floor' : 'model'},
  };
}
export function unseenSchedule(datasets,repeats=2) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error('Invalid repeats');
  const arms = datasets.flatMap(d => d.cases.flatMap(c => c.arms.map(a => ({dataset_id:d.id,case_id:c.id,arm_id:a.id}))));
  const tasks = [];
  for (let repeat=1;repeat<=repeats;repeat++) for (const a of repeat%2 ? arms : [...arms].reverse()) tasks.push({...a,repeat});
  if (tasks.length > 48) throw new Error('Prospective API budget exceeded');
  if (new Set(tasks.map(t => JSON.stringify(t))).size !== tasks.length) throw new Error('Duplicate validation task');
  return tasks;
}
export function unseenSummary(records,plannedRequests) {
  const raw = records.filter(r => r.policy === 'raw'), policies = summarize(records);
  const key = r => JSON.stringify([r.dataset_id,r.case_id,r.arm_id,r.repeat]);
  const rawByKey = new Map(raw.map(r => [key(r),r]));
  for (const [policy,summary] of Object.entries(policies)) {
    const valid = records.filter(r => r.policy === policy && r.ok);
    Object.assign(summary,{policy_decisions:summary.requests,
      false_ready:valid.filter(r => r.grade.false_ready).length,
      false_missing:valid.filter(r => r.grade.false_missing).length,
      host_stops:valid.filter(r => r.grade.selection_origin === 'host_empty_on_content_complete').length,
      source_floor_changes:valid.filter(r => r.grade.source_floor_changed).length,
      lost_coverage_vs_raw:valid.filter(r => rawByKey.get(key(r))?.grade?.declared_evidence_units_covered
        && !r.grade.declared_evidence_units_covered).length,
      lost_exact_selection_vs_raw:valid.filter(r => rawByKey.get(key(r))?.grade?.selection_exact
        && !r.grade.selection_exact).length});
  }
  return {planned_api_requests:plannedRequests,completed_api_attempts:raw.length,
    valid_api_responses:raw.filter(r => r.ok).length,policies,
    cost_note:'All three policies share the same single actual response. Policy costs are alternatives; sum actual costs only once from raw.',
    limits:'New project-unissued questions in fixed pools, not an unseen-document or model-training claim. Arms/repeats are dependent; no full-book discovery, generated-answer quality or live game.'};
}
