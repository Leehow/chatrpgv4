// Contract §168.5 (docs/specs/first-sight.md 2.4): the fast model names what a delivery left out of a first sight.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {anchorFirstSight, checkFirstSightAnswer, createFirstSightLane, FIRST_SIGHT_MODEL_ENV, FIRST_SIGHT_TIMEOUT_MS}
  from '../../runtime/jev/first-sight.ts';
import {cocHome} from '../../extensions/lanes/host.ts';

const STATION = '标志陈旧仍可辨埃索；脏窗外OPEN纸板；两台旧加油机仍可用；棚下阴凉坐着三名晒成深色的中年男子；左侧生锈可乐机嗡鸣，香烟贩卖机手写“故障”。';
const LARS = '中年、高瘦、被晒得黝黑，一头灰白头发表明他至少有四十多岁。穿白色系扣衬衫和意外很干净的工装服。';
const ITEMS = [{id: 'book-4-esso-station', kind: 'place', described: STATION}, {id: 'book-4-lars-williams', kind: 'person', described: LARS},
  {id: 'book-4-nate-patterson', kind: 'person', described: '中等身高，发际线后退，啤酒肚，一口烂牙。'}];

test('the answer gives every visible detail its own verdict; the ones not shown are what is missing; anything else is no answer', () => {
  assert.deepEqual(checkFirstSightAnswer({items: [
    {id: ' a ', details: [{excerpt: 'x', visible: true, shown: false}, {excerpt: 'y', visible: true, shown: true}, {excerpt: ' ', visible: true, shown: false}]},
    {id: 'b', details: [{excerpt: 'z', visible: true, shown: true}]}, {id: 'c', details: []}]}),
    [{id: 'a', missing: ['x']}, {id: 'b', missing: []}, {id: 'c', missing: []}]);
  // Blood Road, fifth table: a son, a church and a dead wife came back as unshown; what cannot be seen on arrival is never owed.
  assert.deepEqual(checkFirstSightAnswer({items: [{id: 'lars', details: [{excerpt: '高瘦', visible: true, shown: true},
    {excerpt: '有个儿子叫兰德尔', visible: false, shown: false}, {excerpt: '穿白色系扣衬衫', visible: true, shown: false}]}]}),
    [{id: 'lars', missing: ['穿白色系扣衬衫']}]);
  for (const bad of [null, [], 'text', {}, {items: {}}, {items: [{id: 'a'}]}, {items: [{id: '', details: []}]}, {items: [{id: 'a', missing: []}]},
    {items: [{id: 'a', details: [{excerpt: 'x'}]}]}, {items: [{id: 'a', details: [{excerpt: 'x', shown: false}]}]}, {items: [{id: 'a', details: [{excerpt: 3, shown: true}]}]}, {items: [{id: 'a', details: ['x']}]}, {items: ['a']}])
    assert.equal(checkFirstSightAnswer(bad), undefined, JSON.stringify(bad));
});

test('excerpts are kept as the book\'s own span; an item whose every excerpt is found nowhere is not recorded at all', () => {
  const anchored = anchorFirstSight(ITEMS, [
    // §139: the model retyped the curly quotes as ASCII ones; the book's own characters are kept.
    {id: 'book-4-esso-station', missing: ['香烟贩卖机手写"故障"', '两台旧加油机仍可用', '一口烂牙']},
    {id: 'book-4-lars-williams', missing: []},
    // Every excerpt unanchored: the check could not say what is missing, so the item stays owed exactly as before.
    {id: 'book-4-nate-patterson', missing: ['他穿着一件格子衬衫']},
    {id: 'someone-else', missing: []},
    {id: 'book-4-lars-williams', missing: ['高瘦']},
  ]);
  assert.deepEqual(anchored.items, [
    {id: 'book-4-esso-station', kind: 'place', missing: ['香烟贩卖机手写“故障”', '两台旧加油机仍可用']},
    {id: 'book-4-lars-williams', kind: 'person', missing: []},
  ], 'an excerpt of another item is not this item\'s; an unknown id and a second answer for one item are ignored');
  assert.deepEqual(anchored.unanchored, ['book-4-nate-patterson']);
  assert.deepEqual(anchorFirstSight(ITEMS, [{id: 'book-4-lars-williams', missing: ['高瘦']}]).items,
    [{id: 'book-4-lars-williams', kind: 'person', missing: ['高瘦']}], 'an item the answer leaves out is not recorded');
});

function fixture(t, reply) {
  const values = {[FIRST_SIGHT_MODEL_ENV]: 'fast/small', [`${FIRST_SIGHT_MODEL_ENV}_THINKING`]: undefined, PI_COC_LANE_THINKING: undefined};
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  t.after(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const requests = [], entries = [];
  const ctx = {cwd: undefined, model: {provider: 'table', id: 'keeper'}, thinkingLevel: 'off', modelRegistry: {
    find: (provider, id) => ({provider, id, api: 'openai-completions', reasoning: true}),
    complete: async (model, context, options) => { requests.push({model, context, options}); return reply(); },
  }};
  const pi = {events: {emit() {}, on() {}}, on() {}, appendEntry: (type, data) => entries.push({type, data})};
  return {ctx, pi, requests, entries};
}

test('one zero-tool round on the fast model: the delivered prose and the items go in, anchored answers come out, one row is written', async t => {
  const home = await mkdtemp(join(tmpdir(), 'first-sight-lane-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const answer = {items: [{id: 'book-4-esso-station', details: [{excerpt: '两台旧加油机仍可用', visible: true, shown: false}, {excerpt: '标志陈旧仍可辨埃索', visible: true, shown: true}]},
    {id: 'book-4-lars-williams', details: [{excerpt: '高瘦', visible: true, shown: true}]},
    {id: 'book-4-nate-patterson', details: [{excerpt: '一顶牛仔帽', visible: true, shown: false}]}]};
  const f = fixture(t, () => ({stopReason: 'stop', content: [{type: 'text', text: JSON.stringify(answer)}]}));
  f.ctx.cwd = home;
  const lane = createFirstSightLane(f.pi, {ctx: () => f.ctx, campaign: () => 'c1'});
  const prose = '棚下坐着一个高瘦的男人，穿着干净的工装服。';
  const result = await lane.check({turn: 3, prose, items: ITEMS}, new AbortController().signal);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.items, [{id: 'book-4-esso-station', kind: 'place', missing: ['两台旧加油机仍可用']},
    {id: 'book-4-lars-williams', kind: 'person', missing: []}]);
  assert.deepEqual(result.unanchored, ['book-4-nate-patterson']);
  assert.equal(f.requests.length, 1);
  const {model, context, options} = f.requests[0];
  assert.deepEqual([model.provider, model.id], ['fast', 'small'], 'the lane\'s own variable names its model');
  assert.equal(context.tools, undefined, 'a zero-tool completion');
  assert.deepEqual(JSON.parse(context.messages[0].content[0].text), {prose, items: ITEMS});
  assert.match(context.systemPrompt, /exactly as described writes it/);
  assert.match(context.systemPrompt, /"visible": true\|false, "shown": true\|false/, 'every detail gets its own two verdicts');
  for (const key of ['temperature', 'top_p']) assert.equal(Object.hasOwn(options, key), false, `${key} is never sent`);
  const all = (await readFile(join(cocHome(home), '.coc/campaigns/c1/telemetry.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const start = all.find(row => row.lane === 'lane-call' && row.subsession === 'first-sight' && row.phase === 'start');
  // Reasoning off by the lane's own choice: the after-delivery floor's `low` ran the fast model out of output with no JSON.
  assert.deepEqual([start.lane_thinking, start.thinking_source], ['off', 'caller']);
  const rows = all.filter(row => row.lane === 'first-sight');
  assert.equal(rows.length, 1);
  assert.deepEqual({...rows[0], ms: 0}, {lane: 'first-sight', ok: true, turn: 3, ms: 0, model: 'fast/small', items: 3, shown: 1, missing: 1, unanchored: 1});
});

test('a failed round records nothing to the kernel and says why, and the lane never throws', async t => {
  const f = fixture(t, () => { throw new Error('provider down'); });
  const lane = createFirstSightLane(f.pi, {ctx: () => f.ctx, campaign: () => 'c1'});
  const failed = await lane.check({turn: 1, prose: 'x', items: ITEMS}, new AbortController().signal);
  assert.deepEqual([failed.ok, failed.reason], [false, 'model_error']);
  const bad = createFirstSightLane(fixture(t, () => ({stopReason: 'stop', content: [{type: 'text', text: '{"items": "all shown"}'}]})).pi,
    {ctx: () => fixture(t, () => ({stopReason: 'stop', content: [{type: 'text', text: '{"items": "all shown"}'}]})).ctx, campaign: () => 'c1'});
  const refused = await bad.check({turn: 1, prose: 'x', items: ITEMS}, new AbortController().signal);
  assert.deepEqual([refused.ok, refused.reason], [false, 'bad_output']);
  assert.match(refused.detail, /items: string/);
  const none = createFirstSightLane(f.pi, {ctx: () => undefined, campaign: () => undefined});
  assert.equal((await none.check({turn: 1, prose: 'x', items: ITEMS}, new AbortController().signal)).reason, 'no_session');
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await lane.check({turn: 1, prose: 'x', items: ITEMS}, aborted.signal)).reason, 'cancelled');
  // A hang watchdog, not a limit on a working check: 20 s cut a fast model still writing on the Blood Road opening.
  assert.ok(FIRST_SIGHT_TIMEOUT_MS >= 120000, 'nothing working is cut short');
});
