// §124.12 (owner, 2026-10-02): the fast model writes each new scene's historical search in English.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkHistoryQuery, describeHistoryQuery, createHistoryQueryLane, HISTORY_QUERY_MAX, HISTORY_OBJECTIVE_MAX} from '../../runtime/jev/history-query.ts';

test('the lane\'s answer is two nonempty strings within the search\'s bounds, trimmed; anything else is no answer', () => {
  assert.deepEqual(checkHistoryQuery({query: ' 1975 West Texas general store ', objective: ' How such a store looked then. '}),
    {query: '1975 West Texas general store', objective: 'How such a store looked then.'});
  for (const bad of [null, [], 'text', {query: 'q'}, {objective: 'o'}, {query: '', objective: 'o'}, {query: 'q', objective: 3}])
    assert.equal(checkHistoryQuery(bad), undefined, JSON.stringify(bad));
  // 2026-10-02: an over-long answer is cut to the search's bounds, not refused (the App's first fuller objective was refused whole).
  const long = checkHistoryQuery({query: 'q'.repeat(HISTORY_QUERY_MAX + 50), objective: 'o'.repeat(HISTORY_OBJECTIVE_MAX + 50)});
  assert.deepEqual([long.query.length, long.objective.length], [HISTORY_QUERY_MAX, HISTORY_OBJECTIVE_MAX]);
  assert.equal(describeHistoryQuery({query: 'q', objective: 7}), 'query: 1 chars, objective: number');
  assert.equal(describeHistoryQuery([1]), 'not an object (array)');
});

test('without a session the lane answers no_session at once and never throws', async () => {
  const pi = {events: {emit() {}, on() {}}, on() {}, appendEntry() {}};
  const lane = createHistoryQueryLane(pi, {ctx: () => undefined, campaign: () => undefined});
  const result = await lane.write({era: '1975', place: 'general store'}, new AbortController().signal);
  assert.deepEqual({ok: result.ok, reason: result.reason}, {ok: false, reason: 'no_session'});
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await lane.write({era: '1975', place: 'general store'}, aborted.signal)).reason, 'cancelled');
});
