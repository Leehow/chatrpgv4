/** §193.2 memo envelopes retain exact local continuation without becoming independently held answers. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PendingAnswers, memoAnswer, HELD_SOURCE_RAW_BYTES, HELD_SOURCE_ENTRIES} from '../../extensions/kernel/source-answers.ts';
import {sourceAnswerPage, withSourceQuestion} from '../../runtime/jev/source-answer-pages.ts';
import {CARRIED_VIEW_BYTES, HELD_ANSWERS_BYTES} from '../../runtime/jev/carried-views.ts';

const size = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const checked = answer => ({status: 'answered', answer, authority: 'source-consultation', limitations: 'Only the retained source was inspected.',
  source_refs: [{source_id: 'pdf:fixture', pdf_index: 1}], supported: true, prepared: false});
const cache = (list, question, answer, scope, scene = 'office', campaign = 'c') =>
  list.cacheContinuation(campaign, scene, {focus: 'book', question, answer}, 2, scope);

function collectPages(read, originals) {
  const units = new Map(), ranges = new Map();
  let part = 0, total;
  for (;;) {
    const page = read(part).source_answer;
    assert.notEqual(page.status, 'unavailable');
    assert.ok(size(page) <= CARRIED_VIEW_BYTES);
    assert.equal(page.status, 'partial');
    assert.equal(page.delivery.complete, false);
    assert.equal(page.delivery.part, part);
    total ??= page.delivery.total_parts;
    assert.equal(page.delivery.total_parts, total);
    assert.equal(page.delivery.cache_unavailable, undefined);
    for (const unit of page.retained_parts) {
      assert.ok(!units.has(unit.unit), 'a source unit rides only one page');
      units.set(unit.unit, unit);
      const original = originals.get(unit.path), value = unit.range.field === 'text' ? unit.value.text : unit.value;
      assert.equal(unit.range.total, original.length);
      assert.equal(value, original.slice(unit.range.start, unit.range.end), 'retained characters are exact original ranges');
      const previous = ranges.get(unit.path) ?? [];
      previous.push(unit); ranges.set(unit.path, previous);
    }
    if (!page.read_next) {
      assert.equal(part + 1, total);
      assert.equal(units.size, page.delivery.total_units);
      break;
    }
    assert.deepEqual(page.read_next, {kind: 'source', source_mode: 'answer', query: 'book', question: 'combined', answer_part: part + 1});
    part = page.read_next.answer_part;
  }
  for (const [path, original] of originals) {
    let end = 0;
    const retained = (ranges.get(path) ?? []).sort((a, b) => a.range.start - b.range.start);
    for (const unit of retained) {assert.equal(unit.range.start, end); end = unit.range.end;}
    assert.equal(end, original.length, 'local continuation covers the entire original without gaps');
  }
  return [...units.values()];
}

test('a memo envelope neither replaces an original question nor consumes held presentation or audit space', () => {
  const rows = [], list = new PendingAnswers(row => rows.push(row));
  const memo = [5, 4, 3, 2, 1].map(n => ({focus: 'book', question: `q${n}`, source_answer: checked(`${n}:${'m'.repeat(n === 5 ? 6000 : 1200)}`)}));
  list.hold('c', 'office', [...memo].reverse().map(entry => ({focus: entry.focus, question: entry.question, answer: entry.source_answer})), 2, 'run2');
  const before = list.audit('c', {scene: 'office', turn: 2}).answers;
  const drops = rows.length;
  assert.equal(cache(list, 'combined', memoAnswer(memo)), true);
  assert.deepEqual(list.audit('c', {scene: 'office', turn: 2}).answers, before);
  assert.equal(rows.length, drops, 'caching the envelope evicts no held answer');
  const held = list.take('c', {scene: 'office', run: 'run3'}).held;
  assert.deepEqual(held.map(entry => entry.question), before.map(entry => entry.question).reverse());
  assert.ok(!held.some(entry => entry.question === 'combined'));
  assert.ok(held.reduce((sum, entry) => sum + size(sourceAnswerPage(entry.answer, {focus: entry.focus, question: entry.question, canContinue: true}).view), 0) <= HELD_ANSWERS_BYTES);
  assert.deepEqual(list.take('c', {scene: 'office', run: 'run3'}).held, []);
  // The lookup can ask an already memoised question; storing that envelope cannot replace its independently held answer.
  assert.equal(cache(list, 'q5', memoAnswer(memo)), true);
  assert.equal(list.audit('c', {scene: 'office', turn: 3}).answers.find(entry => entry.question === 'q5').answer.answer, memo[0].source_answer.answer);
  assert.equal(list.read('c', {scene: 'office', focus: 'book', question: 'q5', part: 0}).source_answer.source_status, 'memo');
});

test('all retained memo pages preserve source identities and exact Unicode ranges through the local reader', () => {
  const list = new PendingAnswers(() => {}), a = 'A🌲é'.repeat(1500), b = 'B excerpt 🌊 '.repeat(700);
  const memo = [
    {focus: 'book', question: 'original-a', source_answer: {...checked(a), question: 'source-authored-a'}},
    {focus: 'book', question: 'original-b', source_answer: {status: 'excerpts', authority: 'original-source-excerpts', limitations: 'The cited page only.',
      excerpts: [{page: 3, alias: 'page-3', text: b}], source_refs: [{source_id: 'pdf:fixture', pdf_index: 3}]}},
  ];
  const envelope = memoAnswer(memo), scope = {worldline: 'line-a', loop: 2};
  assert.equal(cache(list, 'combined', envelope, scope), true);
  const read = part => list.read('c', {scene: 'office', focus: 'book', question: 'combined', part, scope});
  const units = collectPages(read, new Map([['/answers/0/answer', a], ['/answers/1/excerpts/0', b]]));
  const aUnit = units.find(unit => unit.path === '/answers/0/answer');
  assert.equal(aUnit.context.question, 'original-a');
  assert.equal(aUnit.context.source_question, 'source-authored-a');
  assert.equal(aUnit.context.authority, 'source-consultation');
  assert.equal(aUnit.context.limitations, memo[0].source_answer.limitations);
  assert.deepEqual(aUnit.context.source_refs, memo[0].source_answer.source_refs);
  const bUnit = units.find(unit => unit.path === '/answers/1/excerpts/0');
  assert.equal(bUnit.value.page, 3); assert.equal(bUnit.value.alias, 'page-3');
  assert.equal(bUnit.context.question, 'original-b');
  assert.equal(bUnit.context.authority, 'original-source-excerpts');
  assert.equal(read(999).source_answer.cause, 'invalid_part');
  assert.equal(list.take('c', {scene: 'office', run: 'r3', scope}).held.length, 0);
});

test('continuation obeys campaign, scene and worldline/loop scope without restoring invalidated originals', () => {
  const list = new PendingAnswers(() => {}), scope = {worldline: 'line-a', loop: 1};
  const original = {focus: 'book', question: 'combined', part: 0, scope};
  assert.equal(cache(list, 'combined', memoAnswer([{question: 'original', source_answer: checked('x'.repeat(5000))}]), scope), true);
  assert.equal(list.read('other', {scene: 'office', ...original}).source_answer.cause, 'cache_unavailable');
  assert.equal(list.read('c', {scene: 'house', ...original}).source_answer.cause, 'scene_changed');
  assert.equal(list.read('c', {scene: 'office', ...original, scope: {...scope, loop: 2}}).source_answer.cause, 'scope_changed');
  assert.equal(list.read('c', {scene: 'office', ...original, scope: {...scope, worldline: 'line-b'}}).source_answer.cause, 'scope_changed');
  list.take('c', {scene: 'house', run: 'r3', scope});
  assert.equal(list.retains('c', {scene: 'office', focus: 'book', question: 'combined', scope}), false);
  assert.equal(list.read('c', {scene: 'office', ...original}).source_answer.cause, 'cache_unavailable');
  cache(list, 'combined', checked('new'), scope);
  list.take('c', {scene: 'office', run: 'r4', scope: {...scope, loop: 2}});
  assert.equal(list.read('c', {scene: 'office', ...original}).source_answer.cause, 'cache_unavailable');
});

test('continuation entries share the sixteen-entry raw cap and cannot evict independently held answers', () => {
  const list = new PendingAnswers(() => {});
  list.hold('c', 'office', [{focus: 'book', question: 'original', answer: checked('held original')}], 2, 'r2');
  const originals = new Map([['original', withSourceQuestion('original', checked('held original'))]]);
  for (let n = 0; n < HELD_SOURCE_ENTRIES + 2; n++) {
    const question = `continuation-${n}`, answer = checked(`raw-${n}`);
    originals.set(question, withSourceQuestion(question, answer)); cache(list, question, answer);
  }
  const retained = [...originals].filter(([question]) => list.retains('c', {scene: 'office', focus: 'book', question}));
  assert.equal(retained.length, HELD_SOURCE_ENTRIES);
  assert.ok(retained.some(([question]) => question === 'original'));
  assert.equal(list.take('c', {scene: 'office', run: 'r3'}).held[0].answer.answer, 'held original');
  assert.ok(retained.reduce((sum, [, answer]) => sum + size(answer), 0) <= HELD_SOURCE_RAW_BYTES);
});

test('the shared 64 KiB raw cap and unavailable metadata never produce a false memo continuation', () => {
  const list = new PendingAnswers(() => {}), held = checked('h'.repeat(3000));
  list.hold('c', 'office', [{focus: 'book', question: 'held', answer: held}], 2, 'r2');
  const originals = new Map([['held', withSourceQuestion('held', held)]]);
  for (const question of ['raw1', 'raw2', 'raw3']) {
    const answer = checked('r'.repeat(24000)); originals.set(question, withSourceQuestion(question, answer)); cache(list, question, answer);
  }
  const retained = [...originals].filter(([question]) => list.retains('c', {scene: 'office', focus: 'book', question}));
  assert.equal(retained.length, 3, 'one held original and only two 24-KiB raw originals fit');
  assert.ok(retained.reduce((sum, [, answer]) => sum + size(answer), 0) <= HELD_SOURCE_RAW_BYTES);
  assert.equal(list.read('c', {scene: 'office', focus: 'book', question: 'raw1', part: 0}).source_answer.cause, 'cache_unavailable');
  assert.equal(cache(list, 'oversize', checked('x'.repeat(HELD_SOURCE_RAW_BYTES))), false);
  assert.equal(cache(list, 'metadata', {...checked('body'), limitations: 'x'.repeat(5000)}), false);
  // A failed envelope with the same key must not borrow the independent answer's cacheability.
  const withinRaw = memoAnswer([{question: 'original', source_answer: held}, {question: 'second', source_answer: checked('s'.repeat(4000))}]);
  const unavailable = {...withinRaw, note: 'n'.repeat(HELD_SOURCE_RAW_BYTES)};
  const stored = cache(list, 'held', unavailable);
  assert.equal(stored, false);
  const page = sourceAnswerPage(withinRaw, {focus: 'book', question: 'held', canContinue: stored}).view;
  assert.equal(page.status, 'partial');
  assert.equal(page.delivery.cache_unavailable, true);
  assert.equal(page.read_next, undefined);
  assert.equal(list.take('c', {scene: 'office', run: 'r3'}).held[0].answer.answer, held.answer);
});
