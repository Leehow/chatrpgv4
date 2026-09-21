// Mechanical fixture checks. These tests do not execute or grade a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildInput, coverage, DIMENSIONS, evaluateAnswers, selectionAccepted, validateBindings, validateDataset} from './bank.mjs';

const root = resolve(import.meta.dirname, '../..');
const datasets = ['builtin', 'pdf'].map(name => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url))));
const [builtin, pdf] = datasets;
const get = (data, id) => data.cases.find(c => c.id === id);
const arm = (c, id) => c.arms.find(a => a.id === id);
const accepted = selectionAccepted;

test('both datasets have complete references, paired arms and valid Choice answers', () => {
  for (const data of datasets) validateDataset(data);
});
for (const data of datasets) test(`${data.id}: exact source bytes, selectors and unique quotations`, t => {
  const result = validateBindings(data, root, {allowMissing: true});
  if (result.unavailable.length) t.skip(`Source verification unavailable for: ${result.unavailable.join(', ')}`);
  else assert.equal(result.checked, data.sources.length);
});
test('eight dimensions name concrete cases with actual input arms', () => {
  const matrix = coverage(datasets);
  assert.deepEqual(Object.keys(matrix), DIMENSIONS);
  for (const [dimension, rows] of Object.entries(matrix)) {
    assert.ok(rows.length, `${dimension}: no case`);
    assert.ok(rows.every(row => row.arms.length >= 2), `${dimension}: no paired inputs`);
  }
  assert.ok(builtin.sources.some(s => s.kind === 'builtin-module' && s.path.startsWith('content/starters/the-haunting/')));
  assert.ok(builtin.sources.some(s => s.kind === 'live-record'));
  assert.ok(builtin.sources.some(s => s.kind === 'contract-fixture'));
});
test('same-creature purpose pair changes only the question, not the candidate pool', () => {
  const c = get(pdf, 'beetle-purpose-routing'), [a, b] = c.arms;
  assert.notEqual(a.input.player_text, b.input.player_text);
  const withoutQuestion = a => {const x = structuredClone(a.input); delete x.player_text; return x;};
  assert.deepEqual(withoutQuestion(a), withoutQuestion(b));
  assert.notDeepEqual(a.expected.acceptable_additions, b.expected.acceptable_additions);
});
test('distributed evidence includes different physical pages, not duplicate labels', () => {
  const c = get(pdf, 'beetle-joint-supplement');
  const bound = c.grounding.map(id => pdf.sources.find(s => s.id === id));
  assert.ok(new Set(bound.map(s => s.selector.page)).size >= 2);
});
test('joint oracle represents complementary, alternative and duplicate candidates separately', () => {
  const c = get(pdf, 'beetle-joint-supplement');
  const empty = arm(c, 'empty').expected;
  for (const set of [['beetle-place', 'beetle-fire'], ['beetle-place-copy', 'beetle-fire'], ['beetle-place-paraphrase', 'beetle-fire'], ['beetle-combined']]) assert.ok(accepted(empty, set));
  for (const set of [['beetle-place'], ['beetle-place', 'beetle-place-copy'], ['beetle-place', 'beetle-place-paraphrase'], ['beetle-place', 'beetle-place-paraphrase', 'beetle-fire'], ['beetle-place', 'beetle-place-copy', 'beetle-fire'], ['beetle-combined', 'rat-fire']]) assert.equal(accepted(empty, set), false);
  assert.ok(accepted(arm(c, 'place-present').expected, ['beetle-fire']));
  assert.equal(accepted(arm(c, 'place-present').expected, ['beetle-combined']), false);
  assert.ok(accepted(arm(c, 'both-present').expected, []));
});
test('selection is an issued Choice with neutral aliases and multiple accepted alternatives', () => {
  for (const c of pdf.cases.filter(c => c.selection_options)) for (const a of c.arms) {
    const request = buildInput(pdf, c.id, a.id);
    assert.deepEqual(Object.keys(request.questions.selection.criteria), c.selection_options.map(o => o.id));
    assert.equal(JSON.stringify(request.questions.selection).includes('beetle-place'), false);
    assert.equal(JSON.stringify(request.questions.selection).includes('idol-holder'), false);
    for (const option of c.selection_options) {
      const aliases = request.questions.selection.criteria[option.id].match(/material_\d+/g) ?? [];
      assert.deepEqual(aliases.map(alias => request.state.candidates.find(m => m.alias === alias)?.text),
        option.materials.map(id => pdf.materials.find(m => m.id === id).text));
    }
    for (const id of a.expected.answers.selection) {
      const answers = Object.fromEntries(Object.entries(a.expected.answers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
      answers.selection = id;
      const result = evaluateAnswers(pdf, c.id, a.id, answers);
      assert.equal(result.correct, true);
      assert.equal(result.selection_accepted, true);
    }
  }
  const c = get(pdf, 'beetle-purpose-routing'), a = arm(c, 'where');
  const wrong = c.selection_options.find(o => o.materials.length === 1 && o.materials[0] === 'beetle-fire');
  const result = evaluateAnswers(pdf, c.id, a.id, {content: 'missing', selection: wrong.id});
  assert.equal(result.fields.content, true);
  assert.equal(result.correct, false, 'coverage alone must not pass a wrong selection');
  assert.equal(result.selection_accepted, false);
});
test('fire immunity keeps its bound creature heading after anonymizing material ids', () => {
  const request = buildInput(pdf, 'beetle-purpose-routing', 'fire');
  const m = pdf.materials.find(m => m.id === 'beetle-fire');
  assert.equal(m.kind, 'source-combination');
  const heading = pdf.sources.find(s => s.id === 'beetle-heading');
  assert.ok(m.source_refs.includes(heading.id));
  assert.ok(request.state.candidates.some(c => c.text.startsWith(heading.quote)));
});
test('fidelity arms distinguish semantic content from original-source verification', () => {
  const c = get(pdf, 'idol-context-fidelity');
  const axes = a => ({content: a.expected.answers.content, source_support: a.expected.answers.source_support});
  assert.deepEqual(axes(arm(c, 'original-full')), {content: 'complete', source_support: 'complete'});
  assert.deepEqual(axes(arm(c, 'faithful')), {content: 'complete', source_support: 'incomplete'});
  for (const id of ['none', 'holder-only', 'lossy', 'cache-only']) assert.equal(arm(c, id).expected.answers.content, 'missing');
  assert.equal(pdf.sources.find(s => s.id === 'idol-holder').selector.page, pdf.sources.find(s => s.id === 'idol-attack').selector.page);
});
test('cache-only is a visibility control, not a fabricated stale-source revision', () => {
  const copy = structuredClone(pdf);
  copy.materials.find(m => m.id === 'idol-combined').text = 'CACHE_ONLY_CANARY';
  const request = buildInput(copy, 'idol-context-fidelity', 'cache-only');
  assert.deepEqual(request.state.existing_material, []);
  assert.equal(request.state.unavailable_cached_records, 1);
  assert.equal(JSON.stringify(request).includes('CACHE_ONLY_CANARY'), false);
  assert.ok(!Object.hasOwn(request.state, 'cache_only'));
});
test('real rope discrepancy becomes relevant only when the question changes', () => {
  const c = get(pdf, 'harpoon-conflict-scope'), [a, b] = c.arms;
  assert.deepEqual(a.input.existing_material, b.input.existing_material);
  assert.equal(a.expected.answers.consistency, 'clear');
  assert.equal(b.expected.answers.consistency, 'conflict');
  assert.equal(b.expected.answers.answer_status, 'unresolved');
});
test('unsupported extra effects are not mislabeled as mutually exclusive facts', () => {
  const c = get(pdf, 'idol-contradiction-versus-unsupported');
  assert.equal(arm(c, 'mutex').expected.answers.consistency, 'conflict');
  assert.equal(arm(c, 'extra').expected.answers.consistency, 'clear');
  assert.ok(c.arms.every(a => a.expected.answers.armor_support === 'not_established'));
});
test('memory and attribution cases contain genuinely differing expected decisions', () => {
  for (const dimension of ['memory-revision', 'attribution-direction', 'public-spatial-scope']) {
    const rows = builtin.cases.filter(c => c.dimensions.includes(dimension));
    assert.ok(rows.length);
    assert.ok(rows.some(c => new Set(c.arms.map(a => JSON.stringify(a.expected.answers))).size > 1), `${dimension}: no changing decision`);
  }
  assert.ok(builtin.cases.some(c => c.dimensions.includes('memory-revision') && c.arms.length >= 3));
});
test('evaluation annotations, semantic material labels and cache content cannot leak through projection', () => {
  const c = get(pdf, 'idol-context-fidelity');
  const before = buildInput(pdf, c.id, 'faithful');
  const copy = structuredClone(pdf), changedCase = get(copy, c.id), changedArm = arm(changedCase, 'faithful');
  changedArm.expected = {secret: 'GOLD_LABEL_CANARY'};
  changedArm.label = 'GOLD_LABEL_CANARY';
  changedArm.input.expected = 'GOLD_LABEL_CANARY';
  changedCase.grounding = ['GOLD_LABEL_CANARY'];
  changedCase.design_notes = ['GOLD_LABEL_CANARY'];
  changedCase.questions.content.extraGold = 'GOLD_LABEL_CANARY';
  const material = copy.materials.find(m => m.id === 'idol-faithful');
  material.kind = 'lossy-summary';
  material.source_refs = ['GOLD_LABEL_CANARY'];
  material.meta = {expected: 'GOLD_LABEL_CANARY'};
  assert.deepEqual(buildInput(copy, c.id, 'faithful'), before);
  assert.equal(JSON.stringify(before).includes('faithful-paraphrase'), false);
  assert.equal(JSON.stringify(before).includes('idol-holder'), false);
});
test('all materialized inputs exclude author-only fields', () => {
  for (const data of datasets) for (const c of data.cases) for (const a of c.arms) {
    const input = buildInput(data, c.id, a.id);
    assert.deepEqual(Object.keys(input), ['state', 'questions']);
    for (const key of ['expected', 'grounding', 'source_refs', 'dimensions', 'origin', 'label', 'intervention']) assert.ok(!Object.hasOwn(input.state, key));
    assert.ok(input.state.existing_material.every(m => /^material_\d+$/.test(m.alias)));
  }
});
test('fixture guards reject changed answers, references, quotations and source bytes', () => {
  const answer = structuredClone(pdf); answer.cases[0].arms[0].expected.answers.content = 'not_a_choice';
  assert.throws(() => validateDataset(answer), /invalid answer/);
  const reference = structuredClone(pdf); reference.cases[0].arms[0].input.candidates.push('missing-material');
  assert.throws(() => validateDataset(reference), /unknown reference/);
  const verbatim = structuredClone(pdf); verbatim.materials[0].text += 'not in the source';
  assert.throws(() => validateDataset(verbatim), /verbatim text differs/);
  const quote = structuredClone(pdf); quote.sources[0].quote = '__ABSENT_SOURCE_QUOTE__';
  const available = validateBindings(pdf, root, {allowMissing: true});
  if (!available.unavailable.length) {
    assert.throws(() => validateBindings(quote, root), /exact quote absent/);
    const changed = structuredClone(pdf); changed.sources[0].sha256 = '0'.repeat(64);
    assert.throws(() => validateBindings(changed, root), /source bytes changed/);
  }
});
