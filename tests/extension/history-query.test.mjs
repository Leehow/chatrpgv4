// §124.12 (owner, 2026-10-02): the fast model writes each new scene's historical search in English.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkHistoryQuery, createHistoryQueryLane, HISTORY_QUERY_MAX, HISTORY_OBJECTIVE_MAX} from '../../runtime/jev/history-query.ts';

test('the lane\'s answer is two nonempty strings within the search\'s bounds, trimmed; anything else is no answer', () => {
  assert.deepEqual(checkHistoryQuery({query: ' 1975 West Texas general store ', objective: ' How such a store looked then. '}),
    {query: '1975 West Texas general store', objective: 'How such a store looked then.'});
  for (const bad of [null, [], 'text', {query: 'q'}, {objective: 'o'}, {query: '', objective: 'o'}, {query: 'q', objective: 3},
    {query: 'x'.repeat(HISTORY_QUERY_MAX + 1), objective: 'o'}, {query: 'q', objective: 'x'.repeat(HISTORY_OBJECTIVE_MAX + 1)}])
    assert.equal(checkHistoryQuery(bad), undefined, JSON.stringify(bad));
});

test('without a session the lane answers no_session at once and never throws', async () => {
  const pi = {events: {emit() {}, on() {}}, on() {}, appendEntry() {}};
  const lane = createHistoryQueryLane(pi, {ctx: () => undefined, campaign: () => undefined});
  const result = await lane.write({era: '1975', place: 'general store'}, new AbortController().signal);
  assert.deepEqual({ok: result.ok, reason: result.reason}, {ok: false, reason: 'no_session'});
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await lane.write({era: '1975', place: 'general store'}, aborted.signal)).reason, 'cancelled');
});
