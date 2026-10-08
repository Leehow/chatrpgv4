/**
 * Contract §203 (docs/specs/scene-establishment.md), the kernel side over the real TS kernel in process and the shipped
 * packages: the establishing duty a turn owes (`mods.establish`), its ledger on the delivery record, the `establish` gate,
 * `table.establish.view`, the look result, the package declarations, and first sight carrying every person present.
 *
 * TR-F2 run 3 (The Haunting, 2026-10-08): the newsroom, the library, the records hall, the chapel and the house were each
 * arrived at in about 140 characters, and nobody there had a look. The Haunting is the fixture: its scenes have no words
 * §168.5 counts as a description and its people are keeper-only and name-only.
 */
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'scene-establish-kernel-'));
await symlink(join(ROOT, 'node_modules'), join(temporary, 'node_modules'), 'dir');
await build({stdin: {contents: [
  "export * from './kernel-ts/testing/api.ts';",
  "export {HEAD_ESTABLISH, parseEstablish, establishedScenes} from './kernel-ts/read/establish.ts';",
  "export {HEAD_FIRST_SIGHT} from './kernel-ts/read/assemble.ts';",
  "export {KERNEL_GATES} from './kernel-ts/read/sections.ts';",
].join('\n'), resolveDir: ROOT, sourcefile: 'scene-establish-kernel-entry.ts'}, outfile: join(temporary, 'api.mjs'),
bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
process.on('exit', () => spawnSync('rm', ['-rf', temporary]));

const OWES = ['space', 'people', 'things', 'senses', 'period', 'hook'];

async function kernel(t) {
  const home = await mkdtemp(join(temporary, 'home-'));
  const context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content'), seed: 'scene-establish',
    locks: api.createAdvisoryLocks(async () => {}), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  const runtime = api.createKernelRuntime(context);
  t.after(async () => { await runtime.close(); await context.git.close?.(); });
  return {home, call: (method, params = {}) => runtime.handlers[method](params)};
}
async function haunting(t, language = 'zh-Hans') {
  const game = await kernel(t), id = 'c1';
  const call = (method, params = {}) => game.call(method, {campaign: id, ...params});
  await call('campaign.create', {id, module: 'the-haunting', pregen: 'thomas-hayes', play_language: language});
  await call('table.open');
  let ordinal = 0;
  const record = async turn => JSON.parse(await readFile(join(game.home, '.coc/campaigns', id, 'turns', `${String(turn).padStart(4, '0')}.json`), 'utf8'));
  return {...game, call, next: turn => `t${turn}-c${++ordinal}`, record};
}

test('a new place owes an establishing reply once: the opening, an arrival, never a revisit; the look owes it again', async t => {
  const game = await haunting(t);
  const opening = await game.call('table.capsule');
  const item = opening.mods.establish;
  assert.deepEqual(item.place, {id: 'commission-briefing', name: item.place.name}, 'the place the party stands in');
  assert.deepEqual(item.why, ['opening']);
  assert.deepEqual(item.owes.map(owe => owe.key), OWES, 'the prose package says what establishing owes');
  assert.deepEqual(item.package, {mod: 'narration-craft', version: '2.5.0'});
  assert.ok(opening.head.endsWith(api.HEAD_ESTABLISH), 'the head says what the item is, only when it is there');

  await game.call('table.narrate', {call_id: game.next(0), text: '你推开诺特事务所的门。'});
  assert.deepEqual((await game.record(0)).establish, {scene: 'commission-briefing', why: ['opening']}, 'the delivery record keeps the place it established');

  const turn1 = (await game.call('table.player_input', {text: '我现在就去环球报社。'})).capsule;
  assert.equal(turn1.mods.establish, undefined, 'an established place owes nothing: this turn keeps its economy');
  assert.ok(!turn1.head.includes(api.HEAD_ESTABLISH.trim()));
  assert.equal((await game.call('table.establish.view')).establish, null);

  // The run moves inside the turn: the capsule it began with said nothing, the view says what the new place owes.
  await game.call('table.apply', {call_id: game.next(1), effects: [{kind: 'move', to: 'newspaper-morgue', travel_minutes: 30}]});
  const view = await game.call('table.establish.view');
  assert.deepEqual([view.establish.place.id, view.establish.why], ['newspaper-morgue', ['arrival']]);
  assert.ok(view.present.length >= 2, 'the people the book seats there, for the review');
  assert.equal(typeof view.era, 'string');
  assert.equal(view.review.mod, 'narration-audit', 'the review is worded by the one package that contributes it');
  assert.match(view.review.instruction, /Establishing review/);
  await game.call('table.narrate', {call_id: game.next(1), text: '报社编辑部里人声和打字机声混成一片。',
    establish_review: {status: 'pass', look: false, smuggled: 'no'}});
  assert.deepEqual((await game.record(1)).establish, {scene: 'newspaper-morgue', why: ['arrival'], review: {status: 'pass', look: false}},
    'the host verdict rides host-only and only its closed fields are kept');

  await game.call('table.player_input', {text: '我回诺特的事务所。'});
  assert.equal((await game.call('table.establish.view')).establish, null);
  await game.call('table.apply', {call_id: game.next(2), effects: [{kind: 'move', to: 'commission-briefing', travel_minutes: 30}]});
  assert.equal((await game.call('table.establish.view')).establish, null, 'a revisit owes nothing');

  // The Keeper looking the place over owes it again, with look in why.
  const look = await game.call('table.look', {focus: 'scene'});
  assert.deepEqual([look.establish.place.id, look.establish.why], ['commission-briefing', ['look']]);
  assert.equal(look.establish.head, api.HEAD_ESTABLISH.trim());
  assert.equal((await game.call('table.look', {focus: 'scene', _context_read: true})).establish, undefined, 'a context read is the host\'s own');
  assert.deepEqual((await game.call('table.establish.view', {look: true})).establish.why, ['look']);
  await game.call('table.narrate', {call_id: game.next(2), text: '你又站在诺特的写字台前。', establish_review: {status: 'pass', look: true}});
  assert.deepEqual((await game.record(2)).establish, {scene: 'commission-briefing', why: ['look'], review: {status: 'pass', look: true}});
});

test('a reference answer establishes nothing; the gate opens on an owed turn and an indexed narration-craft loads its section by it', async t => {
  const game = await haunting(t, 'en');
  const previous = process.env.COC_INSTRUCTION_BUDGET;
  process.env.COC_INSTRUCTION_BUDGET = '1';
  t.after(() => { if (previous === undefined) delete process.env.COC_INSTRUCTION_BUDGET; else process.env.COC_INSTRUCTION_BUDGET = previous; });
  assert.ok(api.KERNEL_GATES.includes('establish'));
  const section = capsule => capsule.mods.instructions.find(row => row.mod === 'narration-craft').sections.find(row => row.heading === 'Establishing a place');
  const owed = await game.call('table.capsule');
  assert.equal(owed.mods.instructions.find(row => row.mod === 'narration-craft').form, 'indexed');
  assert.deepEqual([section(owed).due, section(owed).triggers], [true, ['state:establish', 'before_apply:move']]);
  await game.call('table.narrate', {call_id: 't0-c1', text: 'You push open the door of Knott\'s office.'});
  await game.call('table.player_input', {text: 'I go to the Globe.'});
  assert.equal(section(await game.call('table.capsule')).due, false, 'established: the gate is shut');
  await game.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue', travel_minutes: 30}]});
  await game.call('table.narrate', {call_id: 't1-c2', text: 'How long the walk takes is up to the table.', _interaction_scope: 'reference'});
  assert.equal((await game.record(1)).establish, undefined, 'a reference answer is not a world turn');
  await game.call('table.player_input', {text: 'I look around the newsroom.'});
  const still = await game.call('table.capsule');
  assert.deepEqual([section(still).due, still.mods.establish.place.id], [true, 'newspaper-morgue'], 'still owed: nothing in the fiction established it');
  await game.call('table.narrate', {call_id: 't2-c1', text: 'The newsroom is long and loud.'});
  await game.call('table.player_input', {text: 'I sit down.'});
  assert.equal(section(await game.call('table.capsule')).due, false, 'established now');
});

test('a place the party already stood in when nothing was owed is not owed by standing; a stranded arrival is owed on the next turn', async t => {
  const game = await haunting(t);
  await game.call('table.narrate', {call_id: 't0-c1', text: '你推开诺特事务所的门。'});
  await game.call('table.player_input', {text: '我去环球报社。'});
  await game.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue', travel_minutes: 30}]});
  // The turn closes with nothing delivered (the run stopped, §38's release): the arrival is still owed on the next turn.
  await game.call('table.release', {release: 'stranded'});
  assert.equal((await game.record(1)).closed_by, 'stranded');
  await game.call('table.player_input', {text: '我四处看看。'});
  const next = await game.call('table.capsule');
  assert.deepEqual([next.mods.establish?.place.id, next.mods.establish?.why], ['newspaper-morgue', ['arrival']],
    'the arrival a stranded turn made is owed by the turn that next delivers');
  await game.call('table.narrate', {call_id: 't2-c1', text: '编辑部狭长，人声鼎沸。'});
  await game.call('table.player_input', {text: '我坐下。'});
  assert.equal((await game.call('table.capsule')).mods.establish, undefined);
  // A relabel of the place the party stands in is no arrival.
  await game.call('table.apply', {call_id: 't3-c1', effects: [{kind: 'move', to: 'newspaper-morgue', label: '编辑部'}]});
  assert.equal((await game.call('table.establish.view')).establish, null);
  await game.call('table.narrate', {call_id: 't3-c2', text: '你在写字台边坐下。'});

  // The prose package switched off while the party walks into the library, then on again: a table that adopts a provider
  // mid-play owes nothing for the place it already stands in, only for the next place it comes into.
  await game.call('mods.configure', {id: 'narration-craft', enabled: false});
  await game.call('table.player_input', {text: '我去中央图书馆。'});
  await game.call('table.apply', {call_id: 't4-c1', effects: [{kind: 'move', to: 'central-library', travel_minutes: 30}]});
  await game.call('table.narrate', {call_id: 't4-c2', text: '你到了图书馆。'});
  assert.equal((await game.record(4)).establish, undefined, 'nothing was owed with no provider');
  await game.call('mods.configure', {id: 'narration-craft', enabled: true});
  await game.call('table.player_input', {text: '我找缩微胶片。'});
  assert.equal((await game.call('table.capsule')).mods.establish, undefined, 'standing somewhere unestablished is no arrival');
});

test('first sight carries every person present: a keeper-only person the book gives no words is carried undescribed', async t => {
  const game = await haunting(t);
  await game.call('table.narrate', {call_id: 't0-c1', text: '你推开诺特事务所的门。'});
  await game.call('table.player_input', {text: '我现在就去环球报社。'});
  await game.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue', travel_minutes: 30}]});
  const view = await game.call('table.first_sight.view');
  const people = view.first_sight.people;
  const arty = people.find(person => person.id === 'arty-wilmot');
  assert.deepEqual(arty, {id: 'arty-wilmot', name: arty.name, undescribed: true}, 'the doorman is seen though the book gives him no look');
  assert.ok(people.some(person => person.id === 'ruth-blake' && person.undescribed === true));
  assert.match(view.head, /undescribed/);
  // A delivery that showed him lands as shown through the existing door: an empty missing.
  await game.call('table.narrate', {call_id: 't1-c2', text: '门边站着一个穿灰色马甲的瘦高男人。'});
  const landed = await game.call('table.first_sight', {turn: 1, items: [{id: 'arty-wilmot', kind: 'person', missing: []}]});
  assert.deepEqual(landed.shown, [{kind: 'person', id: 'arty-wilmot'}]);
  await game.call('table.player_input', {text: '我向他出示名片。'});
  const next = await game.call('table.first_sight.view');
  assert.ok(!(next.first_sight?.people ?? []).some(person => person.id === 'arty-wilmot'), 'shown leaves for good');
  assert.ok(next.first_sight.people.some(person => person.id === 'ruth-blake'), 'the one still unseen stays owed');
});

test('the declarations: establish needs its capability and a well-formed file; establish_review needs its capability and text', async t => {
  const game = await kernel(t);
  // keeper-pacing (no style of its own, so a copy is no second style provider) carrying narration-craft's establish.json.
  const variant = async (name, change) => {
    const path = join(game.home, `variant-${name}`);
    await cp(join(ROOT, 'mods/keeper-pacing'), path, {recursive: true});
    await cp(join(ROOT, 'mods/narration-craft/establish.json'), join(path, 'establish.json'));
    const shipped = JSON.parse(await readFile(join(path, 'mod.json'), 'utf8'));
    const manifest = {...shipped, id: `craft-${name}`, requires: [...shipped.requires, 'context.establish.v1'],
      package_files: [...shipped.package_files, 'establish.json'], contributes: {...shipped.contributes, establish: 'establish.json'}};
    const next = await change({manifest, path}) ?? {};
    await writeFile(join(path, 'mod.json'), JSON.stringify(next.manifest ?? manifest));
    return path;
  };
  const refusals = {
    'capability-missing': ({manifest}) => ({manifest: {...manifest, requires: manifest.requires.filter(cap => cap !== 'context.establish.v1')}}),
    'contribution-missing': ({manifest}) => ({manifest: {...manifest, contributes: {...manifest.contributes, establish: undefined}}}),
    'one-row': async ({path}) => { await writeFile(join(path, 'establish.json'), JSON.stringify({schema_version: 1, owes: [{key: 'space', line: 'x'}]})); },
    'duplicate-key': async ({path}) => { await writeFile(join(path, 'establish.json'), JSON.stringify({schema_version: 1, owes: [{key: 'space', line: 'x'}, {key: 'space', line: 'y'}]})); },
    'long-line': async ({path}) => { await writeFile(join(path, 'establish.json'), JSON.stringify({schema_version: 1, owes: [{key: 'space', line: 'x'.repeat(241)}, {key: 'hook', line: 'y'}]})); },
    'extra-field': async ({path}) => { await writeFile(join(path, 'establish.json'), JSON.stringify({schema_version: 1, owes: [{key: 'a', line: 'x'}, {key: 'b', line: 'y'}], weight: 2})); },
    'not-json': async ({path}) => { await writeFile(join(path, 'establish.json'), '{not json'); },
    'review-without-capability': async ({manifest, path}) => {
      await writeFile(join(path, 'review.md'), 'Judge it.');
      return {manifest: {...manifest, package_files: [...manifest.package_files, 'review.md'], contributes: {...manifest.contributes, establish_review: 'review.md'}}};
    },
    'review-empty': async ({manifest, path}) => {
      await writeFile(join(path, 'review.md'), '  \n');
      return {manifest: {...manifest, requires: [...manifest.requires, 'audit.establish.v1'], package_files: [...manifest.package_files, 'review.md'],
        contributes: {...manifest.contributes, establish_review: 'review.md'}}};
    },
  };
  for (const [name, change] of Object.entries(refusals)) {
    const path = await variant(name, change);
    await assert.rejects(game.call('mods.install', {path}), error => {
      assert.equal(error.code, 'invalid_params', name);
      assert.match(String(error.details?.field), /^contributes\.establish(_review)?$/, `${name}: ${error.message}`);
      return true;
    }, name);
  }
  assert.equal((await game.call('mods.install', {path: await variant('intact', () => undefined)})).id, 'craft-intact');
});

test('the shipped packages: whole within the instruction budget, their sizes measured', async t => {
  const game = await haunting(t);
  const rows = (await game.call('table.capsule')).mods.instructions;
  const total = rows.reduce((sum, row) => sum + Buffer.byteLength(row.instruction, 'utf8'), 0);
  t.diagnostic(`instructions ${rows.map(row => `${row.mod}@${row.version}:${row.form}:${Buffer.byteLength(row.instruction, 'utf8')}`).join(' ')} total ${total}`);
  assert.ok(rows.every(row => row.form === 'full'), 'every default-on package rides whole');
  assert.ok(total <= 65536);
});
