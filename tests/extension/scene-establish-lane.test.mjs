/**
 * Contract §203 (docs/specs/scene-establishment.md): the establishing review's closed answer and its anchoring, the host
 * guard's decisions over stub reads, the engine's step note after a mid-run move, and first sight's undescribed verdict.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkEstablishAnswer, judgeEstablish, ESTABLISH_REVIEW_CONTRACT} from '../../runtime/jev/establish-review.ts';
import {checkEstablish, establishFix, establishItemOf, ESTABLISH_MIN_MS} from '../../extensions/kernel/establish.ts';
import {establishStep} from '../../runtime/jev/establish-step.ts';
import {anchorFirstSight, checkFirstSightAnswer, FIRST_SIGHT_INSTRUCTION} from '../../runtime/jev/first-sight.ts';

const OWES = [{key: 'space', line: 'the space'}, {key: 'people', line: 'the people'}, {key: 'senses', line: 'two senses'}, {key: 'hook', line: 'a hook'}];
const PROSE = '编辑部狭长，橡木写字台挤在铸铁柱之间。七八个记者伏案疾书。油墨和雪茄的味道里夹着电报机的嘀嗒声。门卫站起来打量你。';
const VIEW = {establish: {place: {id: 'newsroom', name: '编辑部'}, why: ['arrival'], owes: OWES}, review: {mod: 'narration-audit', version: '1.3.0', instruction: 'Judge.'},
  present: ['门卫'], era: '1920s'};

test('the answer: one closed verdict per row asked, keys known, nothing else', () => {
  const rows = [{key: 'space', verdict: 'shown', quote: '编辑部狭长'}, {key: 'people', verdict: 'not_applicable'}, {key: 'senses', verdict: 'missing'}, {key: 'hook', verdict: 'shown', quote: '门卫站起来打量你'}];
  assert.deepEqual(checkEstablishAnswer({items: rows}, OWES), rows);
  for (const bad of [null, [], {}, {items: {}}, {items: rows.slice(1)}, {items: [...rows, rows[0]]},
    {items: rows.map(row => row.key === 'space' ? {...row, verdict: 'mostly'} : row)},
    {items: rows.map(row => row.key === 'space' ? {...row, key: 'weather'} : row)}, {items: rows.map(row => row.key === 'hook' ? {...row, quote: 3} : row)}])
    assert.equal(checkEstablishAnswer(bad, OWES), undefined, JSON.stringify(bad));
  assert.match(ESTABLISH_REVIEW_CONTRACT, /"shown"\|"missing"\|"not_applicable"/);
});

test('a shown row stands on its quote: an unlocated quote is missing (unanchored); not applicable is neither; any missing row is thin', () => {
  assert.deepEqual(judgeEstablish(PROSE, [{key: 'space', verdict: 'shown', quote: '编辑部狭长'}, {key: 'people', verdict: 'not_applicable'},
    {key: 'senses', verdict: 'shown', quote: '油墨和雪茄的味道'}, {key: 'hook', verdict: 'shown', quote: '门卫站起来打量你'}]),
  {thin: false, missing: [], shown: ['space', 'senses', 'hook'], unanchored: []});
  assert.deepEqual(judgeEstablish(PROSE, [{key: 'space', verdict: 'shown', quote: '墙上挂着一幅油画'}, {key: 'people', verdict: 'shown'},
    {key: 'senses', verdict: 'missing'}, {key: 'hook', verdict: 'shown', quote: '门卫站起来打量你'}]),
  {thin: true, missing: ['space', 'people', 'senses'], shown: ['hook'], unanchored: ['space', 'people']});
  // §139: a quote retyped with ASCII quotation marks is still the prose's own words.
  assert.deepEqual(judgeEstablish('他说“走吧”，转身离开。', [{key: 'hook', verdict: 'shown', quote: '他说"走吧"'}]).shown, ['hook']);
});

function guard({view = VIEW, verdict, fail, now = 0, deadlineAt} = {}) {
  const rows = [], asked = [];
  const lane = {review: async (input, options) => {
    asked.push({input, options});
    if (fail) return {ok: false, reason: fail, detail: 'x', ms: 1};
    return {ok: true, ...judgeEstablish(input.prose, verdict), rows: verdict, ms: 7, model: 'fast/x'};
  }};
  return {rows, asked, run: (draft = PROSE, extra = {}) => checkEstablish({campaign: 'c1', turn: 3, draft, path: 'explicit', look: false, signal: new AbortController().signal,
    ...(deadlineAt !== undefined ? {deadlineAt} : {}), ...extra}, {view: async params => { rows.push({viewed: params}); return typeof view === 'function' ? view(params) : view; }, lane, record: row => rows.push(row), now: () => now})};
}

test('the guard: nothing owed, no review, a contested review and a near deadline deliver without asking anyone', async () => {
  const none = guard({view: {establish: null, review: VIEW.review}});
  assert.deepEqual(await none.run(), {status: 'skipped', reason: 'not_owed'});
  assert.equal(none.asked.length, 0);
  const unworded = guard({view: {...VIEW, review: null}});
  assert.equal((await unworded.run()).reason, 'no_review');
  const contested = guard({view: {...VIEW, review: null, contributors: [{mod: 'a'}, {mod: 'b'}]}});
  await contested.run();
  assert.equal(contested.rows.find(row => row.event === 'skipped').reason, 'review_contested');
  const late = guard({deadlineAt: ESTABLISH_MIN_MS - 1});
  assert.deepEqual(await late.run(), {status: 'skipped', reason: 'budget', note: {status: 'skipped'}});
  assert.equal(late.asked.length, 0, 'the turn has no time for it');
  const broken = guard({view: () => { throw new Error('kernel down'); }});
  assert.equal((await broken.run()).reason, 'view_unavailable');
  const silent = guard();
  assert.deepEqual(await silent.run('  '), {status: 'skipped', reason: 'no_prose'}, 'a choice with no prose of its own is not judged');
  assert.equal(silent.rows.length, 0, 'not even the view is read');
});

test('the guard: a failed review delivers; a rich draft passes; a thin one carries the fix with the package\'s own lines', async () => {
  const failed = guard({fail: 'timeout'});
  assert.deepEqual(await failed.run(), {status: 'unavailable', reason: 'timeout', note: {status: 'unavailable'}});
  const all = OWES.map(owe => ({key: owe.key, verdict: 'shown', quote: {space: '编辑部狭长', people: '七八个记者伏案疾书', senses: '油墨和雪茄的味道', hook: '门卫站起来打量你'}[owe.key]}));
  const rich = guard({verdict: all, deadlineAt: 60_000});
  assert.deepEqual(await rich.run(), {status: 'pass', note: {status: 'pass'}});
  assert.equal(rich.asked[0].options.timeoutMs, 20_000, 'a watchdog, narrowed by nothing here');
  assert.deepEqual([rich.asked[0].input.present, rich.asked[0].input.era, rich.asked[0].options.instruction], [['门卫'], '1920s', 'Judge.']);
  const tight = guard({verdict: all, deadlineAt: 9_000});
  await tight.run();
  assert.equal(tight.asked[0].options.timeoutMs, 5_000, 'the turn\'s deadline less the reserve');
  const thin = guard({verdict: [{key: 'space', verdict: 'missing'}, {key: 'people', verdict: 'shown', quote: '七八个记者伏案疾书'},
    {key: 'senses', verdict: 'missing'}, {key: 'hook', verdict: 'shown', quote: '门卫站起来打量你'}]});
  const outcome = await thin.run(PROSE, {look: true});
  assert.equal(outcome.status, 'thin');
  assert.deepEqual(outcome.missing, ['space', 'senses']);
  assert.deepEqual(outcome.note, {status: 'thin', look: true, missing: ['space', 'senses']});
  assert.match(outcome.fix, /does not yet establish: space: the space; senses: two senses\./);
  assert.match(outcome.fix, /keep the player's act, every settled result and every line already spoken/);
  assert.deepEqual(thin.rows.filter(row => row.lane).map(row => row.event), ['due', 'judged']);
  assert.deepEqual(thin.rows[0].viewed, {look: true}, 'the look is asked of the view');
});

test('the fix says why the place is owed', () => {
  const item = establishItemOf(VIEW);
  assert.match(establishFix(item, ['hook']), /just come into it/);
  assert.match(establishFix({...item, why: ['look']}, ['hook']), /looking it over/);
  assert.match(establishFix({...item, why: ['opening']}, ['hook']), /opens the table/);
  assert.equal(establishItemOf({establish: {place: {id: 'x'}, owes: []}}), undefined, 'an item with nothing owed is none');
});

test('the step note: a run that moved after its capsule asks once per scene and carries the item', async () => {
  const rows = [], calls = [];
  const deps = {campaign: 'c1', stepId: 's2', record: row => rows.push(row), call: async method => { calls.push(method); return {establish: VIEW.establish, head: 'mods.establish means'}; }};
  assert.equal(await establishStep({runId: 'r', turn: 2, scene: 'office', firstScene: 'office'}, deps), undefined, 'no move, no note');
  const run = {runId: 'r', turn: 2, scene: 'newsroom', firstScene: 'office'};
  const note = await establishStep(run, deps);
  assert.deepEqual(note, {head: 'mods.establish means', ...VIEW.establish});
  assert.equal(await establishStep(run, deps), undefined, 'once per scene per run');
  assert.deepEqual(calls, ['table.establish.view']);
  assert.deepEqual(rows, [{lane: 'run', event: 'establish', run: 'r', step: 's2', scene: 'newsroom', why: ['arrival']}]);
  const nothing = await establishStep({runId: 'r', turn: 2, scene: 'hall', firstScene: 'office'}, {...deps, call: async () => ({establish: null})});
  assert.equal(nothing, undefined);
  const failed = await establishStep({runId: 'r', turn: 2, scene: 'hall', firstScene: 'office'}, {...deps, call: async () => { throw new Error('down'); }});
  assert.equal(failed, undefined);
  assert.equal(rows.at(-1).event, 'read_failed');
});

test('first sight: an undescribed person takes one verdict; shown lands as shown, unshown records nothing', () => {
  assert.match(FIRST_SIGHT_INSTRUCTION, /undescribed/);
  const items = [{id: 'arty', kind: 'person', described: '', undescribed: true}, {id: 'ruth', kind: 'person', described: '', undescribed: true},
    {id: 'knott', kind: 'person', described: '高瘦，戴金丝眼镜。'}];
  const answers = checkFirstSightAnswer({items: [{id: 'arty', shown: true}, {id: 'ruth', shown: false}, {id: 'knott', details: [{excerpt: '戴金丝眼镜', visible: true, shown: false}]}]});
  assert.deepEqual(answers, [{id: 'arty', missing: [], shown: true}, {id: 'ruth', missing: [], shown: false}, {id: 'knott', missing: ['戴金丝眼镜']}]);
  const anchored = anchorFirstSight(items, answers);
  assert.deepEqual(anchored.items, [{id: 'arty', kind: 'person', missing: []}, {id: 'knott', kind: 'person', missing: ['戴金丝眼镜']}]);
  assert.deepEqual(anchored.undescribed, {shown: 1, unshown: 1});
  // A described item answered with the single verdict was never checked detail by detail: nothing is recorded for it.
  assert.deepEqual(anchorFirstSight(items, [{id: 'knott', missing: [], shown: true}]).items, []);
});

test('history selection (§203.7): a scene lookup asks a texture question per candidate that orders what is kept and drops nothing', async () => {
  const {selectionBatch, selectHistoryMaterials, TEXTURE_QUESTION} = await import('../../runtime/historical-reference.ts');
  const material = (title, url) => ({title, url, excerpts: [`${title} excerpt`], published_at: null, retrieved_at: '2026-10-08T00:00:00Z'});
  const rows = [material('A conference report', 'https://example.org/report'), material('A reporter remembers the 1920s city room', 'https://example.org/memoir'),
    material('A catalogue page', 'https://example.org/catalogue')];
  const input = {query: 'What was it like inside a Boston newspaper office in the 1920s?', binding: 'b', scope: {owner: 't', audience: 'keeper'}, context: {}};
  const batch = selectionBatch(input, rows);
  assert.deepEqual(batch.questions.filter(q => q.key.startsWith('texture_')).map(q => [q.key, q.instructions]),
    [['texture_1', TEXTURE_QUESTION], ['texture_2', TEXTURE_QUESTION], ['texture_3', TEXTURE_QUESTION]]);
  assert.equal(batch.familyVersion, '5');
  assert.ok(!selectionBatch(input, rows, {strategy: 'estimate_from_anchors'}).questions.some(q => q.key.startsWith('texture_')), 'a price lookup does not ask it');
  const answer = (texture) => ({status: 'complete', answers: Object.fromEntries(batch.questions.map(q => {
    const index = Number(q.key.split('_').at(-1)) - 1;
    if (q.key.startsWith('texture_')) return [q.key, texture[index] === null ? {status: 'unanswered'} : {status: 'answered', type: 'noul', noul: texture[index]}];
    if (q.key.startsWith('period_')) return [q.key, {status: 'answered', type: 'noul', noul: index === 2 ? 0.1 : 0.6}];
    return [q.key, {status: 'answered', type: 'choice', choice: 'analogous'}];
  }))});
  const kept = selectHistoryMaterials(rows, answer([0.2, 0.9, 0.95]));
  assert.deepEqual(kept.materials.map(row => row.title), ['A reporter remembers the 1920s city room', 'A conference report'],
    'the one with the room in it first; the catalogue page fails the period question whatever its texture');
  assert.deepEqual(kept.textures, {'https://example.org/report': 0.2, 'https://example.org/memoir': 0.9, 'https://example.org/catalogue': 0.95});
  const unanswered = selectHistoryMaterials(rows, answer([null, null, null]));
  assert.equal(unanswered.materials.length, 2, 'an unanswered texture question drops nothing');
});
