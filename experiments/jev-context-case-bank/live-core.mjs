// Frozen-pool experiments only; this module makes no provider or kernel calls.
import {createHash} from 'node:crypto';
import {buildInput, selectionAccepted} from './bank.mjs';
import {MODEL} from '../jev-wide-preflight/core.mjs';
import {validateChoices} from '../jev-wide-preflight/incremental-core.mjs';
export const sha = value => createHash('sha256').update(value).digest('hex');
const size = text => Buffer.byteLength(text, 'utf8');
export const POLICIES = ['joint-subsets', 'independent'];
function locate(data, caseId, armId) {
  const c = data.cases.find(c => c.id === caseId), a = c?.arms.find(a => a.id === armId);
  if (!a) throw new Error('Unknown case or arm');
  return {c, a};
}
export function prepareRequest(data, caseId, armId, policy) {
  if (!POLICIES.includes(policy)) throw new Error('Unknown policy');
  const {c, a} = locate(data, caseId, armId);
  const request = {model: MODEL, ...buildInput(data, caseId, armId)};
  const ids = [...new Set([...a.input.existing_material, ...a.input.candidates])];
  const aliases = new Map(ids.map((id, i) => [id, `material_${i + 1}`]));
  const binding = {selection_options: null, candidate_questions: {}};
  if (!c.selection_options) {
    if (policy !== 'joint-subsets') throw new Error('Independent policy requires candidates');
    return {request, binding};
  }
  if (policy === 'joint-subsets') {
    if (a.input.candidates.length > 6) throw new Error('Subset menu exceeds the frozen six-candidate bound');
    // Enumerate every subset mechanically. Expected answers are never consulted.
    const options = Array.from({length: 2 ** a.input.candidates.length}, (_, mask) => ({
      id: `set_${mask}`, materials: a.input.candidates.filter((_, i) => mask & (1 << i)),
    }));
    binding.selection_options = options;
    request.questions.selection.criteria = Object.fromEntries(options.map(o => [o.id, o.materials.length
      ? `Add only ${o.materials.map(id => aliases.get(id)).join(' + ')}.` : 'Add no candidate material.']));
  } else {
    delete request.questions.selection;
    for (const id of a.input.candidates) {
      const alias = aliases.get(id), key = `candidate_${alias}`;
      binding.candidate_questions[key] = id;
      request.questions[key] = {type: 'choice',
        instructions: `Compare ONLY candidate ${alias} with existing_material for the current request. Does it state at least one necessary answer fact still missing? A candidate can be useful without answering everything. Fully stated facts in context reports are not missing merely because original-source verification is separate. Judge each candidate independently; optional background or source-checking alone is not factual supplementation.`,
        criteria: {adds_needed: 'States a necessary requested fact still missing.', redundant: 'Its relevant facts are already stated in existing_material.',
          unrelated: 'States no necessary missing fact for this request.', uncertain: 'Cannot determine whether it supplies a missing fact.'}};
    }
  }
  return {request, binding};
}
export function validateLiveResponse(request, body) {
  return validateChoices(request, body);
}
function units(data, ids) {
  const sources = new Map(data.sources.map(s => [s.id, s]));
  const materials = new Map(data.materials.map(m => [m.id, m]));
  return ids.flatMap(id => {
    const m = materials.get(id);
    if (!m) throw new Error(`Unknown material ${id}`);
    if (['verbatim', 'source-combination'].includes(m.kind)) return m.source_refs.map(ref => {
      const s = sources.get(ref);
      return {key: `source:${sha(JSON.stringify([s.path, s.sha256, s.selector, s.quote]))}`, text: s.quote};
    });
    // All reports share this rule. No faithful/lossy/false semantic labels are used.
    return [{key: `report:${sha(m.text)}`, text: m.text}];
  });
}
export function addedMaterialMetrics(data, current, selected, allCandidates) {
  const existing = new Set(units(data, current).map(u => u.key));
  const raw = units(data, selected), added = new Map();
  for (const unit of raw) if (!existing.has(unit.key)) added.set(unit.key, unit);
  const all = new Map();
  for (const unit of units(data, allCandidates)) if (!existing.has(unit.key)) all.set(unit.key, unit);
  const rawBytes = raw.reduce((n, u) => n + size(u.text), 0);
  const addedBytes = [...added.values()].reduce((n, u) => n + size(u.text), 0);
  return {raw_selected_unit_bytes: rawBytes, mechanically_added_text_bytes: addedBytes,
    mechanical_exact_removal_bytes: rawBytes - addedBytes,
    all_candidates_added_text_bytes: [...all.values()].reduce((n, u) => n + size(u.text), 0)};
}
export function gradeResponse(data, caseId, armId, policy, prepared, body) {
  const issue = validateLiveResponse(prepared.request, body);
  if (issue) return {available: false, protocol_error: issue};
  const {c, a} = locate(data, caseId, armId);
  const answers = Object.fromEntries(Object.entries(body.answers).map(([key, value]) => [key, value.choice]));
  const fields = Object.fromEntries(Object.entries(a.expected.answers).filter(([key]) => key !== 'selection').map(([key, expected]) =>
    [key, (Array.isArray(expected) ? expected : [expected]).includes(answers[key])]));
  const hasSelection = Boolean(c.selection_options);
  let selected = [], uncertainty = [];
  if (hasSelection && policy === 'joint-subsets') selected = prepared.binding.selection_options.find(o => o.id === answers.selection).materials;
  if (hasSelection && policy === 'independent') {
    selected = Object.entries(prepared.binding.candidate_questions).filter(([key]) => answers[key] === 'adds_needed').map(([, id]) => id);
    uncertainty = Object.entries(prepared.binding.candidate_questions).filter(([key]) => answers[key] === 'uncertain').map(([, id]) => id);
  }
  const exact = hasSelection ? selectionAccepted(a.expected, selected) : null;
  const present = new Set(units(data, [...a.input.existing_material, ...selected]).map(u => u.key));
  // Evidence-unit containment only, not a generated-answer or semantic truth judge.
  const excerptCoverage = hasSelection ? a.expected.acceptable_additions.some(set =>
    units(data, set).every(u => present.has(u.key))) : null;
  return {available: true, answers, fields, common_fields_correct: Object.values(fields).every(Boolean),
    all_correct: Object.values(fields).every(Boolean) && (!hasSelection || exact),
    has_selection: hasSelection, selected_material_ids: hasSelection ? selected : null,
    selection_exact: exact, selection_uncertain_material_ids: uncertainty,
    declared_evidence_units_covered: excerptCoverage,
    ...(hasSelection ? addedMaterialMetrics(data, a.input.existing_material, selected, a.input.candidates) : {})};
}
export function schedule(datasets, repeats = 2) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error('Invalid repeats');
  const pairs = datasets.flatMap(data => data.cases.flatMap(c => c.arms.map(a => ({data, c, a}))));
  const output = [];
  for (let r = 1; r <= repeats; r++) for (const {data, c, a} of r % 2 ? pairs : [...pairs].reverse()) {
    const policies = c.selection_options ? (r % 2 ? POLICIES : [...POLICIES].reverse()) : ['joint-subsets'];
    for (const policy of policies) output.push({dataset_id: data.id, case_id: c.id, arm_id: a.id, policy, repeat: r, dimensions: c.dimensions});
  }
  return output;
}
function pctl(values, q) {return values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] : null;}
export function summarize(records) {
  const groups = {};
  for (const record of records) (groups[record.policy] ??= []).push(record);
  return Object.fromEntries(Object.entries(groups).map(([policy, rows]) => {
    const valid = rows.filter(r => r.ok), selection = valid.filter(r => r.grade.has_selection);
    const usageComplete = rows.every(r => Number.isSafeInteger(r.usage?.input_tokens) && r.usage.input_tokens >= 0);
    const input = rows.reduce((n, r) => n + (Number.isSafeInteger(r.usage?.input_tokens) ? r.usage.input_tokens : 0), 0);
    return [policy, {requests: rows.length, available: valid.length, unavailable: rows.length - valid.length,
      all_correct: valid.filter(r => r.grade.all_correct).length,
      fields_total: valid.reduce((n, r) => n + Object.keys(r.grade.fields).length, 0),
      fields_correct: valid.reduce((n, r) => n + Object.values(r.grade.fields).filter(Boolean).length, 0),
      selection_records: selection.length, selection_exact: selection.filter(r => r.grade.selection_exact).length,
      selection_evidence_covered: selection.filter(r => r.grade.declared_evidence_units_covered).length,
      uncertain_selections: selection.filter(r => r.grade.selection_uncertain_material_ids.length).length,
      selection_added_text_bytes: selection.reduce((n, r) => n + r.grade.mechanically_added_text_bytes, 0),
      selection_raw_unit_bytes: selection.reduce((n, r) => n + r.grade.raw_selected_unit_bytes, 0),
      latency_p50_ms: pctl(valid.map(r => r.ms), .5), latency_p95_ms: pctl(valid.map(r => r.ms), .95),
      selection_latency_p50_ms: pctl(selection.map(r => r.ms), .5),
      reported_input_tokens: input, usage_complete: usageComplete,
      reported_output_tokens: rows.every(r => Number.isSafeInteger(r.usage?.output_tokens) && r.usage.output_tokens >= 0)
        ? rows.reduce((n, r) => n + r.usage.output_tokens, 0) : null,
      estimated_input_cost_usd: usageComplete ? input * .042 / 1_000_000 : null}];
  }));
}

export function pairedSummary(records, inventory = records) {
  const key = r => JSON.stringify([r.dataset_id, r.case_id, r.arm_id, r.repeat]);
  const expected = new Set(inventory.filter(r => r.policy === 'independent').map(key));
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(key(r))) groups.set(key(r), {});
    const group = groups.get(key(r));
    if (group[r.policy]) throw new Error('Duplicate paired record');
    group[r.policy] = r;
  }
  const matched = [], unavailable = [];
  for (const id of expected) {
    const group = groups.get(id) ?? {};
    if (POLICIES.every(p => group[p]?.ok)) matched.push(...POLICIES.map(p => group[p]));
    else unavailable.push({key: JSON.parse(id), missing_or_unavailable: POLICIES.filter(p => !group[p]?.ok)});
  }
  return {planned_pairs: expected.size, valid_pairs: matched.length / 2, unavailable_pairs: unavailable,
    policies: summarize(matched), scope: 'Identical dataset/case/arm/repeat pairs only; not the unpaired all-family totals.'};
}
