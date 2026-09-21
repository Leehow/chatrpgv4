// Frozen-pool policy experiment. No provider calls, world mutations, or oracle routing.
import {prepareRequest, gradeResponse, validateLiveResponse, summarize} from './live-core.mjs';

export const POLICIES = ['mixed', 'mixed-host-stop', 'isolated'];
export function prepareStages(data, caseId, armId) {
  const mixed = prepareRequest(data, caseId, armId, 'joint-subsets');
  if (!mixed.binding.selection_options || !mixed.request.questions.content?.criteria.complete
    || !mixed.request.questions.content.criteria.missing) throw new Error('Content/selection task required');
  const gate = structuredClone(mixed);
  delete gate.request.state.candidates;
  delete gate.request.questions.selection;
  gate.request.state.policy = gate.request.state.policy.replace('Candidates are available for selection but are not already supplied. ', '');
  gate.binding = {};
  const selection = structuredClone(mixed);
  selection.request.questions = {selection: selection.request.questions.selection};
  return {mixed, gate, selection};
}
export function needsSelection(gate, body) {
  const issue = validateLiveResponse(gate.request, body);
  if (issue) throw new Error(`Unavailable gate: ${issue}`);
  const choice = body.answers.content.choice;
  if (!['complete', 'missing'].includes(choice)) throw new Error('Unknown content decision');
  return choice === 'missing';
}
function emptyChoice(stages) {
  return stages.mixed.binding.selection_options.find(o => o.materials.length === 0).id;
}
export function gradePolicy(data, caseId, armId, policy, stages, firstBody, selectionBody = null) {
  if (!POLICIES.includes(policy)) throw new Error('Unknown policy');
  const first = policy === 'isolated' ? stages.gate : stages.mixed;
  const firstIssue = validateLiveResponse(first.request, firstBody);
  if (firstIssue) return {available:false, protocol_error:firstIssue};
  const combined = structuredClone(firstBody);
  let origin = 'mixed_model_choice';
  if (policy !== 'mixed') {
    if (firstBody.answers.content.choice === 'complete') {
      if (selectionBody) throw new Error('Complete gate must not run selection');
      combined.answers.selection = {choice:emptyChoice(stages)};
      origin = 'host_empty_on_content_complete';
    } else if (policy === 'isolated') {
      const issue = validateLiveResponse(stages.selection.request, selectionBody);
      if (issue) return {available:false, protocol_error:issue};
      combined.answers.selection = structuredClone(selectionBody.answers.selection);
      origin = 'selection_only_model_choice';
    }
  }
  const grade = gradeResponse(data, caseId, armId, 'joint-subsets', stages.mixed, combined);
  const expected = data.cases.find(c => c.id === caseId).arms.find(a => a.id === armId).expected.answers.content;
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  return {...grade, selection_origin:origin,
    false_ready: combined.answers.content.choice === 'complete' && !expectedValues.includes('complete'),
    false_missing: combined.answers.content.choice === 'missing' && !expectedValues.includes('missing')};
}
export function isolatedSchedule(datasets, repeats = 2) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error('Invalid repeats');
  const arms = datasets.flatMap(data => data.cases.filter(c => c.selection_options).flatMap(c => c.arms.map(a =>
    ({dataset_id:data.id, case_id:c.id, arm_id:a.id}))));
  const out = [];
  for (let repeat = 1; repeat <= repeats; repeat++) for (const arm of repeat % 2 ? arms : [...arms].reverse()) {
    for (const policy of repeat % 2 ? ['mixed','isolated'] : ['isolated','mixed']) out.push({...arm,policy,repeat});
  }
  return out;
}
export function isolatedSummary(records, inventory) {
  const key = r => JSON.stringify([r.dataset_id,r.case_id,r.arm_id,r.repeat]);
  const expected = [...new Set(inventory.map(key))], groups = new Map();
  for (const r of records) {
    if (!groups.has(key(r))) groups.set(key(r), {});
    const group = groups.get(key(r));
    if (group[r.policy]) throw new Error('Duplicate policy record');
    group[r.policy] = r;
  }
  const matched = [], unavailable = [];
  for (const id of expected) {
    const group = groups.get(id) ?? {};
    if (POLICIES.every(p => group[p]?.ok)) matched.push(...POLICIES.map(p => group[p]));
    else unavailable.push({key:JSON.parse(id), missing_or_unavailable:POLICIES.filter(p => !group[p]?.ok)});
  }
  const summary = summarize(matched);
  for (const policy of POLICIES) {
    const rows = matched.filter(r => r.policy === policy);
    if (!rows.length) continue;
    Object.assign(summary[policy], {
      policy_decisions:rows.length,
      provider_calls:rows.reduce((n,r) => n + r.provider_calls, 0),
      false_ready:rows.filter(r => r.grade.false_ready).length,
      false_missing:rows.filter(r => r.grade.false_missing).length,
      host_stops:rows.filter(r => r.grade.selection_origin === 'host_empty_on_content_complete').length,
      derived_from_mixed:policy === 'mixed-host-stop',
    });
  }
  return {planned_pairs:expected.length, valid_pairs:matched.length / 3, unavailable_pairs:unavailable, policies:summary,
    costs_note:'Mixed-host-stop reuses mixed calls: its costs are alternative policy costs, never additional actual API calls. Latency is the sum of observed sequential provider round trips, excluding evidence-file I/O.',
    limits:'Fixed-pool, source-unit containment only. No post-selection coverage recheck, downstream reader, full-book search or live game.'};
}
