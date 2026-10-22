/**
 * Contract §255, the host side: the look questions of the first-sight lane (legacy shape and anchoring, the native typed
 * path through the lane port) and what the sole author is handed of a kept look.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {anchorLooks, checkLooksAnswer} from '../../runtime/jev/kept-looks.ts';
import {createFirstSightLane} from '../../runtime/jev/first-sight.ts';
import {decisionScene, DECISION_AUTHOR_INSTRUCTION} from '../../runtime/isolated-expression.ts';

const PROSE = '柜台后坐着个五十来岁的妇人，灰白头发在脑后挽成髻。她抬眼看了看你。靠窗的条凳缺了一条腿，用砖头垫着。';
const TARGETS = [{kind: 'place', id: 'teahouse', name: '茶馆', want: ['look']},
  {kind: 'person', id: 'liu', name: '老板娘', want: ['look', 'pronoun']}, {kind: 'person', id: 'wang', name: '扛包的', want: ['pronoun']}];

test('the legacy answer is a closed shape, and only delivered spans the job wanted are kept', () => {
  assert.equal(checkLooksAnswer({targets: [{id: 'liu', pronoun: 'female'}]}), undefined, 'a pronoun outside the list refuses the answer');
  assert.equal(checkLooksAnswer({items: []}), undefined);
  assert.equal(checkLooksAnswer({targets: [{id: 'liu', excerpts: ['灰白头发。']}]}), undefined, 'every excerpt carries its verdict');
  const look = text => ({text, shows: 'look'});
  const answers = checkLooksAnswer({targets: [
    {id: 'teahouse', excerpts: [look('靠窗的条凳缺了一条腿，用砖头垫着。'), look('墙上挂着一幅山水画。')]},
    // What she did in the scene is no look, whatever the model copied.
    {id: 'liu', excerpts: [look('柜台后坐着个五十来岁的妇人，灰白头发在脑后挽成髻。'), {text: '她抬眼看了看你。', shows: 'action'}], pronoun: 'she'},
    {id: 'wang', excerpts: [look('他光着膀子。')]},
    {id: 'nobody', excerpts: [look('她抬眼看了看你。')]},
  ]});
  assert.deepEqual(anchorLooks(TARGETS, answers, [PROSE]), [
    {kind: 'place', id: 'teahouse', excerpts: ['靠窗的条凳缺了一条腿，用砖头垫着。']},
    {kind: 'person', id: 'liu', excerpts: ['柜台后坐着个五十来岁的妇人，灰白头发在脑后挽成髻。'], pronoun: 'she'},
  ], 'the made-up wall, the unwanted look, and the unasked target are dropped');
});

test('the native path asks typed choices over the reply\'s own sentences and never calls a writing model', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'kept-looks-native-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const before = globalThis.fetch, key = process.env.EXT_JEV_APIKEY;
  process.env.EXT_JEV_APIKEY = 'fixture-key';
  t.after(() => { globalThis.fetch = before; if (key === undefined) delete process.env.EXT_JEV_APIKEY; else process.env.EXT_JEV_APIKEY = key; });
  const asked = [];
  // Unit 1 shows the proprietress, unit 2 nothing, unit 3 the place; she is she, the porter gets no pronoun.
  const pick = {'unit-1': 'target-2', 'unit-2': 'none', 'unit-3': 'target-1', 'pronoun-target-2': 'she', 'pronoun-target-3': 'none'};
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    asked.push(body);
    return new Response(JSON.stringify({model: body.model, answers: Object.fromEntries(Object.entries(body.questions).map(([name, q]) => {
      const keys = Object.keys(q.criteria), choice = pick[name] ?? 'none';
      const p = Object.fromEntries(keys.map(k => [k, k === choice ? .99 : .01 / (keys.length - 1)]));
      return [name, {type: 'choice', choice, confidence: (keys.length * .99 - 1) / (keys.length - 1), probabilities: p}];
    })), usage: {input_tokens: 100, output_tokens: 1}}), {status: 200});
  };
  let modelCalls = 0;
  const rows = [], ctx = {cwd, modelRegistry: {complete: async () => { modelCalls++; throw Error('unexpected author'); }}};
  const lane = createFirstSightLane({events: new EventEmitter(), appendEntry: (_kind, row) => rows.push(row)},
    {ctx: () => ctx, campaign: () => 'camp', sourceReferences: () => true});
  const result = await lane.looks({turn: 1, prose: PROSE, targets: TARGETS}, new AbortController().signal);
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, [
    {kind: 'person', id: 'liu', excerpts: ['柜台后坐着个五十来岁的妇人，灰白头发在脑后挽成髻。'], pronoun: 'she'},
    {kind: 'place', id: 'teahouse', excerpts: ['靠窗的条凳缺了一条腿，用砖头垫着。']},
  ]);
  assert.equal(modelCalls, 0);
  assert.equal(asked.length, 1);
  const row = rows.map(entry => entry?.data ?? entry).findLast(entry => entry?.event === 'looks') ?? rows.at(-1);
  assert.ok(JSON.stringify(row).includes('"looks"'), 'the check writes its telemetry row');
  globalThis.fetch = async () => { throw Error('offline'); };
  assert.equal((await lane.looks({turn: 2, prose: PROSE, targets: TARGETS}, new AbortController().signal)).ok, false, 'a failure records nothing');
});

test('the sole author is handed each present person\'s kept look and pronoun, and the place\'s, and told to keep them', () => {
  const capsule = {where: {scene: 'teahouse', display_name: '茶馆'}, public_scene: {description: '一间茶馆。'},
    present: [{id: 'liu', ref: 'npc_1', display_name: '老板娘', name_known: false}, {id: 'wang', ref: 'npc_2', display_name: '王铁柱', name_known: true}],
    kept_looks: {place: {id: 'teahouse', look: '靠窗的条凳缺了一条腿。'}, people: [{id: 'liu', look: '灰白头发在脑后挽成髻。', pronoun: 'she'}]}};
  const scene = decisionScene(capsule);
  assert.equal(scene.kept_look, '靠窗的条凳缺了一条腿。');
  assert.deepEqual(scene.presence.people, [{ref: 'npc_1', display_name: '老板娘', name_known: false, look: '灰白头发在脑后挽成髻。', pronoun: 'she'},
    {ref: 'npc_2', display_name: '王铁柱', name_known: true}]);
  const bare = decisionScene({...capsule, kept_looks: undefined});
  assert.equal(bare.kept_look, undefined);
  assert.deepEqual(bare.presence.people.map(person => Object.keys(person)), [['ref', 'display_name', 'name_known'], ['ref', 'display_name', 'name_known']]);
  assert.match(DECISION_AUTHOR_INSTRUCTION, /kept_look are what earlier deliveries showed/);
});
