import assert from 'node:assert/strict';
import test from 'node:test';
import {bytes, requestFor, packQuery, mapConcurrent, validateResponse, rankResults, materialPacket, evaluatePacket} from './core.mjs';

const query = {id: 'probe', query: 'Which stated facts answer the question?', context: 'Read only.', requirements: [{id: 'first', anyOfPages: [2]}, {id: 'second', anyOfPages: [3, 4]}], expectedStatus: 'supported', answerNotes: ['GOLD_DO_NOT_SEND'], unresolvedRequirements: []};
const corpus = {sha256: 'source', pages: [1, 2, 3, 4].map(page => ({page, text: `Source page ${page}. ` + 'Exact source. '.repeat(100)}))};

test('provider payload contains only the query, public experiment context and actual source text', () => {
  const request = requestFor(query, corpus.pages);
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes('GOLD_DO_NOT_SEND'), false);
  assert.equal(serialized.includes('requirements'), false);
  assert.equal(serialized.includes('expectedStatus'), false);
  assert.equal(Object.keys(request.questions).length, corpus.pages.length * 2);
  assert.ok(request.questions.direct_2.instructions.includes('pages[1].text'));
});

test('packing bounds preserve every substantive page exactly once and keep sparse gaps explicit', () => {
  const input = {...corpus, pages: [...corpus.pages, {page: 5, text: 'Map'}]};
  const limit = bytes(requestFor(query, corpus.pages.slice(0, 2)));
  const packed = packQuery(query, input, limit);
  assert.deepEqual(packed.groups.flat().map(page => page.page), [1, 2, 3, 4]);
  assert.deepEqual(packed.sparsePages, [5]);
  assert.ok(packed.groups.every(group => bytes(requestFor(query, group)) <= limit));
  assert.throws(() => packQuery(query, input, 100), /exceeds/);
});

test('bounded HTTP fan-out preserves result order', async () => {
  let active = 0, maximum = 0;
  const output = await mapConcurrent([4, 3, 2, 1], 2, async value => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, value));
    active--; return value * 2;
  });
  assert.deepEqual(output, [8, 6, 4, 2]);
  assert.equal(maximum, 2);
  await assert.rejects(mapConcurrent([], 17, async () => {}), /Concurrency/);
});

test('missing or malformed judgments stay unknown instead of becoming irrelevant', () => {
  const ranking = rankResults([corpus.pages], [{ok: true, body: {answers: {
    direct_1: {noul: 0.2}, context_1: {noul: 0.9},
    direct_2: {noul: 0.8}, context_2: {noul: 0.3},
    direct_3: {noul: 1.1}, context_3: {noul: 0.7},
  }}}]);
  assert.deepEqual(ranking.ranked.map(row => row.page), [2, 1]);
  assert.deepEqual(ranking.unknownPages, [3, 4]);
});

test('materialization copies exact original text and evaluates all independently frozen requirements', () => {
  const ranking = {ranked: [{page: 2, direct: 0.8, context: 0.6}, {page: 4, direct: 0.7, context: 0.5}], unknownPages: [1]};
  const one = materialPacket(query, corpus, ranking, [3], 1);
  assert.equal(one.materials[0].text, corpus.pages[1].text);
  assert.equal(one.materials[0].source_ref.end, corpus.pages[1].text.length);
  assert.equal(JSON.stringify(one).includes('GOLD_DO_NOT_SEND'), false);
  assert.equal(evaluatePacket(query, one).all_required_supplied, false);
  const both = materialPacket(query, corpus, ranking, [], 2);
  assert.equal(evaluatePacket(query, both).all_required_supplied, true);
  assert.equal(both.coverage.complete_answer_not_asserted, true);
  assert.equal(evaluatePacket({...query, requirements: [], expectedStatus: 'unsupported'}, both).all_required_supplied, null);
});

test('provider schema drift is an explicit protocol failure rather than a negative judgment', () => {
  const request = requestFor(query, corpus.pages.slice(0, 1));
  assert.equal(validateResponse(request, {results: {direct_1: 0.9}}), 'missing_answers_object');
  assert.equal(validateResponse(request, {answers: {direct_1: {noul: 0.9}}}), 'answer_key_mismatch');
  assert.equal(validateResponse(request, {answers: {direct_1: {noul: '0.9'}, context_1: {noul: 0.5}}}), 'invalid_noul_answer');
  assert.equal(validateResponse(request, {answers: {direct_1: {noul: 0.9}, context_1: {noul: 0.5}}}), null);
});

test('visual-only support is identified separately from a native retrieval miss', () => {
  const ranking = {ranked: [{page: 2, direct: 0.8, context: 0.4}], unknownPages: []};
  const packet = materialPacket(query, corpus, ranking, [3, 4], 5);
  const result = evaluatePacket({...query, visualGapPages: [3, 4]}, packet);
  assert.equal(result.all_required_supplied, false);
  assert.equal(result.native_all_required_supplied, true);
  assert.deepEqual(result.structurally_unavailable_requirements, ['second']);
  assert.deepEqual(result.expected_visual_gap_pages, [3, 4]);
});

test('packet byte budget does not silently truncate source material', () => {
  const ranking = {ranked: corpus.pages.map(page => ({page: page.page, direct: 0.5, context: 0.4})), unknownPages: []};
  const packet = materialPacket(query, corpus, ranking, [], 4, 4000);
  assert.ok(bytes(packet) <= 4000);
  assert.ok(packet.coverage.omitted_for_packet_budget.length > 0);
  assert.equal(packet.materials.length + packet.coverage.omitted_for_packet_budget.length, 4);
  for (const material of packet.materials) assert.equal(material.text, corpus.pages.find(page => page.page === material.physical_page).text);
});
