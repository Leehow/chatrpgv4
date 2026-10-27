// 1026n: a long reply with five people in it packed past the Jev request limit, and no look was kept on ten turns.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideLooks} from '../../runtime/jev/kept-looks.ts';

const sentence = i => `第${i}句：一个穿深色呢大衣的胖男人站在祭坛前，宽大的羽帽压着额头。`;
const targets = Array.from({length: 5}, (_, i) => ({kind: 'person', id: `p${i}`, name: `人物${i}`, want: ['look', 'pronoun']}));
// A port that refuses a batch over 20 questions as the adapter's packing does, and otherwise keeps the first unit for p0.
function port(seen) {
  return {async decide(batch) {
    seen.push(batch.questions.length);
    if (batch.questions.length > 20) return {status: 'unavailable', failure: {code: 'packing_limit', retryable: false}, answers: {}};
    const answers = Object.fromEntries(batch.questions.map(q => [q.key, {status: 'answered', type: 'choice', confidence: .95,
      choice: q.key === 'unit-1' ? 'target-1' : 'none'}]));
    return {status: 'complete', answers};
  }};
}

test('a reply too long for one batch is asked in halves and the looks it shows are kept', async () => {
  const seen = [], prose = Array.from({length: 40}, (_, i) => sentence(i)).join('');
  const result = await decideLooks({campaign: 'c', turn: 1, prose, targets}, port(seen), new AbortController().signal);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(seen[0] > 20 && seen.slice(1).some(count => count <= 20), JSON.stringify(seen));
  const p0 = result.items.find(item => item.id === 'p0');
  assert.ok(p0 && p0.excerpts.length >= 1, JSON.stringify(result.items));
});

test('a reply that fits is asked once', async () => {
  const seen = [], prose = Array.from({length: 3}, (_, i) => sentence(i)).join('');
  const result = await decideLooks({campaign: 'c', turn: 1, prose, targets: targets.slice(0, 2)}, port(seen), new AbortController().signal);
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
});
