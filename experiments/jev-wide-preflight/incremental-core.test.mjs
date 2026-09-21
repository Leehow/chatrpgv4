import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioFor, activeSpans, contextState, gateRequest, deltaRequest, packDelta, materializeDelta, coveredRequirements, runIncremental, validateChoices} from './incremental-core.mjs';

const corpus = {sha256: 'current-revision', pages: [
  {page: 1, text: 'Title. Fact A is the first fact. Fact B is the second fact. End of source.'},
  {page: 2, text: 'A second source page with an unrelated description and no requested fact.'},
  {page: 3, text: 'Fact C is a required third-page condition. Additional original text.'},
]};
const query = {id: 'fixture', query: 'Give facts A and B.', context: 'Static query.', topicSummary: 'This section discusses facts.', consistentNote: 'Fact A is the first fact.', conflictingNote: 'Fact A is not the first fact.', requirements: [
  {id: 'a', description: 'GOLD_LABEL_A', anyOfPages: [1], evidence: [{page: 1, quote: 'Fact A is the first fact.'}]},
  {id: 'b', description: 'GOLD_LABEL_B', anyOfPages: [1], evidence: [{page: 1, quote: 'Fact B is the second fact.'}]},
]};
const answers = (request, choose) => ({ok: true, body: {answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, {choice: choose(key)}]))}});

test('conditions change actual visible context without exposing expected labels or the condition id', () => {
  const full = scenarioFor(query, corpus, 'full');
  const state = contextState(query, full, corpus);
  assert.equal(state.existing_material[0].text, corpus.pages[0].text);
  assert.equal(state.context_notes[0].provenance, 'unverified_context_claim');
  const request = JSON.stringify(gateRequest(query, full, corpus));
  for (const hidden of ['GOLD_LABEL', 'requirements', 'initiallyComplete', 'mustReview', '"condition"']) assert.equal(request.includes(hidden), false);
  const summary = contextState(query, scenarioFor(query, corpus, 'summary'), corpus);
  assert.equal(summary.existing_material.length, 0);
  assert.equal(summary.context_notes[0].text, query.topicSummary);
});

test('host excludes stale revisions, while partial single-page context contains only exact first-requirement spans', () => {
  assert.equal(activeSpans(scenarioFor(query, corpus, 'stale'), corpus).length, 0);
  const partial = scenarioFor(query, corpus, 'partial');
  assert.deepEqual(coveredRequirements(query, activeSpans(partial, corpus), corpus).map(row => row.covered), [true, false]);
  assert.equal(contextState(query, scenarioFor(query, corpus, 'stale'), corpus).unavailable_source_records, 1);
});

test('multi-page partial contexts withhold the fixed middle required page', () => {
  const multi = {...query, requirements: [...query.requirements, {id: 'c', anyOfPages: [3], evidence: [{page: 3, quote: 'Fact C is a required third-page condition.'}]}]};
  assert.deepEqual(scenarioFor(multi, corpus, 'partial').supplied.map(row => row.page), [1]);
});

test('exact subtraction restores missing text without reinjecting already supplied source ranges', () => {
  const partial = scenarioFor(query, corpus, 'partial');
  const added = materializeDelta([1, 1], partial, corpus);
  for (const value of added) assert.equal(value.text, corpus.pages[0].text.slice(value.start, value.end));
  assert.equal(added.some(value => value.text.includes('Fact A is the first fact.')), false);
  const combined = [...activeSpans(partial, corpus), ...added].sort((a, b) => a.start - b.start);
  assert.equal(combined.map(value => value.text).join(''), corpus.pages[0].text);
  assert.equal(coveredRequirements(query, combined, corpus).every(row => row.covered), true);
  assert.deepEqual(materializeDelta([1], scenarioFor(query, corpus, 'full'), corpus), []);
});

test('full ready contexts skip every discovery call', async () => {
  let calls = 0;
  const result = await runIncremental(query, scenarioFor(query, corpus, 'full'), corpus, async request => {
    calls++; return answers(request, key => key === 'coverage' ? 'sufficient' : 'clear');
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, 'ready_existing');
  assert.equal(result.full_zero_add, true);
  assert.equal(result.full_skipped_scan, true);
});

test('partial contexts add only selected missing ranges and recheck the actual combined context', async () => {
  const labels = [];
  const result = await runIncremental(query, scenarioFor(query, corpus, 'partial'), corpus, async (request, label) => {
    labels.push(label);
    if (label === 'initial') return answers(request, key => key === 'coverage' ? 'missing' : 'clear');
    if (label === 'final') {
      assert.equal(request.state.existing_material.length, 1);
      assert.equal(request.state.existing_material[0].text, corpus.pages[0].text);
      assert.deepEqual(request.state.existing_material[0].source_position, {start: 0, end: corpus.pages[0].text.length, unit: 'UTF-16; provenance only'});
      return answers(request, key => key === 'coverage' ? 'sufficient' : 'clear');
    }
    return answers(request, key => key === 'page_1' ? 'adds_needed' : 'unrelated');
  });
  assert.equal(result.outcome, 'ready_after_delta');
  assert.deepEqual(result.selected_pages, [1]);
  assert.equal(result.duplicate_source_bytes, 0);
  assert.equal(result.final_false_ready, false);
  assert.equal(labels.at(-1), 'final');
});

test('a provider calling missing material sufficient is counted as false-ready', async () => {
  const result = await runIncremental(query, scenarioFor(query, corpus, 'none'), corpus, async request => answers(request, key => key === 'coverage' ? 'sufficient' : 'clear'));
  assert.equal(result.initial_false_ready, true);
  assert.equal(result.final_false_ready, true);
});

test('host refusal does not hide raw model false-sufficiency or false-ready judgments', async () => {
  const failedDelta = await runIncremental(query, scenarioFor(query, corpus, 'none'), corpus, async (request, label) => {
    if (label.startsWith('delta-')) return {ok: false};
    return answers(request, key => key === 'consistency' ? 'clear' : label === 'initial' ? 'missing' : 'sufficient');
  });
  assert.equal(failedDelta.outcome, 'unresolved_provider_coverage');
  assert.equal(failedDelta.final_coverage_false_sufficient, true);
  assert.equal(failedDelta.final_gate_false_ready, true);
  assert.equal(failedDelta.final_false_ready, false);
  const maskedInitial = await runIncremental(query, scenarioFor(query, corpus, 'none'), corpus, async request => answers(request, key => key === 'coverage' ? 'sufficient' : 'uncertain'));
  assert.equal(maskedInitial.initial_coverage_false_sufficient, true);
  assert.equal(maskedInitial.initial_gate_false_ready, false);
  assert.equal(maskedInitial.initial_false_ready, false);
  assert.equal(maskedInitial.uncertainty_review, true);
});

test('conflict routes to review instead of stuffing more material; unavailable is not a zero-add success', async () => {
  const conflict = await runIncremental(query, scenarioFor(query, corpus, 'conflict'), corpus, async request => answers(request, key => key === 'coverage' ? 'sufficient' : 'conflict'));
  assert.equal(conflict.outcome, 'needs_review');
  assert.equal(conflict.scan_groups, 0);
  assert.equal(conflict.expected_review_observed, true);
  const failure = await runIncremental(query, scenarioFor(query, corpus, 'full'), corpus, async () => ({ok: false}));
  assert.equal(failure.full_zero_add, false);
  assert.equal(failure.full_skipped_scan, false);
});

test('choice answers are bound to issued keys and values; exact full pages are excluded mechanically', () => {
  const full = scenarioFor(query, corpus, 'full');
  const packed = packDelta(query, full, corpus);
  assert.deepEqual(packed.exactAlreadySupplied, [1]);
  assert.ok(!packed.groups.flat().some(page => page.page === 1));
  const request = deltaRequest(query, full, corpus, [corpus.pages[1]]);
  assert.equal(validateChoices(request, answers(request, () => 'redundant').body), null);
  assert.equal(validateChoices(request, answers(request, () => 'invented').body), 'invalid_choice');
  assert.equal(validateChoices(request, {}), 'missing_answers');
});
