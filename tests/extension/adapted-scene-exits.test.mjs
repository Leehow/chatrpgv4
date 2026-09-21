/**
 * A place the campaign minted is a place the party can leave, and the offer never has nothing to say
 * about the way out (contract §49).
 *
 * Campaign `game-1c0faba5` on 2026-09-16: turn 4 accepted `add_scene "Roxbury Sanitarium"` and moved
 * into it. `add_scene` mints a node and no relation, so the new scene had no outgoing edge; the
 * Keeper wrote a `route` for each venue and wrote it *inbound* both times
 * (`commission-briefing -> Roxbury Sanitarium`, `Roxbury Sanitarium -> South End Parish Charity
 * Office`), which is the direction that gets the party in, not the one that gets them out. From
 * turn 5 to turn 25 -- nineteen turns -- `where.exits` was empty, the Director's offer carried no
 * route, and the module's seven authored routes were off the table. That is why the guarantee is a
 * mint and not a required change: the Keeper already supplied a route and the party was still stuck.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const evidence = join(root, '.coc/playtests/adapted-scene-exits');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts'; export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {normalizeChanges,adaptedGraph} from './kernel-ts/adaptation/graph.ts'; export {directorOffer} from './kernel-ts/read/offer.ts';`, resolveDir: root, sourcefile: 'test-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = []; after(async () => {for (const close of closers) await close();});
const raw = JSON.parse(await readFile(join(root, 'content/starters/the-haunting/module-graph.json'), 'utf8'));
const graph = new api.ModuleGraph('the-haunting', raw, 'test', {});

async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'adapted-exits', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    await call('table.narrate', {call_id: 't0-c1', text: 'The investigator hears the commission.'});
    await call('table.player_input', {text: 'I want somewhere quiet to think this through.'});
    const world = () => readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8').then(JSON.parse);
    return {home, runtime, call, world};
}

/** The whole preparation flow with the model's two results written by hand: a contract fixture, not play. */
async function accept(t, name, changes, callId) {
    const anchors = [...new Set(changes.flatMap(change => change.sources))];
    const p = await t.call('adaptation.prepare', {name, purpose: 'new_destination', request: 'The investigator named a place of their own.', anchors});
    await writeFile(join(p.task.cwd, 'result.json'), JSON.stringify({explanation: 'Contract fixture only.', changes}));
    const draft = await t.call('adaptation.draft', {name, key: p.task.key, attempt: p.task.attempt});
    await writeFile(join(draft.task.cwd, 'result.json'), JSON.stringify({verdict: 'supported', summary: 'Contract fixture verdict, not model acceptance.', issues: [],
        checked: changes.map((_, index) => ({index, verdict: 'supported', reason: 'Known contract fixture.'}))}));
    await t.call('adaptation.review', {name, key: p.task.key, attempt: p.task.attempt});
    return t.call('table.apply', {call_id: callId, effects: [{kind: 'adaptation', name}]});
}

const START = graph.handle(graph.startScene());
/** An authored scene that is not where the party stands, so leaving by the minted edge is not a retrace. */
const ANCHOR = 'previous-tenants';
/** Anchors and `based_on` are kind-qualified: a bare handle can name more than one kind of entity. */
const ANCHOR_REF = `scene: ${ANCHOR}`;

test('a campaign-minted scene leads back to the source scene it was anchored on, and the party walks out by that edge', async () => {
    const t = await table();
    assert.notEqual(ANCHOR, START, 'the anchor must not be the scene the party is standing in');
    await accept(t, 'Harbor guesthouse', [{kind: 'add_scene', name: 'Harbor guesthouse',
        description: 'A guesthouse near the wharf where the same case can be talked over.',
        based_on: ANCHOR_REF, sources: [ANCHOR_REF], reason: 'The investigator chose a quiet room by the water.'}], 't1-c1');

    // In: the Keeper says how they got there, exactly as a real table does for a place off the map.
    await t.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'move', to: 'Harbor guesthouse', via: 'a short walk down to the water', travel_minutes: 0}]});
    const world = await t.world();
    assert.equal(world.active_scene, 'Harbor guesthouse');
    assert.deepEqual(world.scene_trail, [START], 'the anchor is not on the trail, so retracing cannot be the way out');

    const capsule = await t.call('table.capsule');
    const exits = capsule.where.exits.map(exit => exit.to);
    assert.ok(exits.includes(ANCHOR), `the minted scene leads back to its anchor; exits were ${JSON.stringify(exits)}`);
    const offer = capsule.director.offer.filter(entry => entry.kind === 'route');
    assert.ok(offer.length, 'the Director offers a way out of a campaign-minted scene');

    // Out, by the minted edge alone: the anchor is not on the trail and no `via` is given, so this
    // call is exactly the one the stuck table could not make.
    await t.call('table.narrate', {call_id: 't1-c3', text: 'The room is quiet enough to think.'});
    await t.call('table.player_input', {text: 'I head for the old tenants.'});
    await t.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'move', to: ANCHOR}]});
    const after = await t.world();
    assert.equal(after.active_scene, ANCHOR);

    // And the module's own routes are on the table again one move later.
    const back = await t.call('table.capsule');
    assert.ok(back.where.exits.length >= 5, 'the authored scene brings its own routes back');
});

test('the minted way back survives a second campaign scene anchored on the first one two hops from the module', async () => {
    const t = await table();
    await accept(t, 'Harbor guesthouse', [{kind: 'add_scene', name: 'Harbor guesthouse',
        description: 'A guesthouse near the wharf where the same case can be talked over.',
        based_on: ANCHOR_REF, sources: [ANCHOR_REF], reason: 'The investigator chose a quiet room by the water.'}], 't1-c1');
    await t.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'move', to: 'Harbor guesthouse', via: 'a short walk down to the water', travel_minutes: 0}]});
    await t.call('table.narrate', {call_id: 't1-c3', text: 'The room is quiet enough to think.'});
    await t.call('table.player_input', {text: 'I ask after the charity office two streets over.'});
    await accept(t, 'Parish charity office', [{kind: 'add_scene', name: 'Parish charity office',
        description: 'A parish office that keeps its own register of the same families.',
        based_on: ANCHOR_REF, sources: [ANCHOR_REF], reason: 'The investigator went looking for the parish register.'}], 't2-c1');
    await t.call('table.apply', {call_id: 't2-c2', effects: [{kind: 'move', to: 'Parish charity office', via: 'two streets over', travel_minutes: 0}]});
    const capsule = await t.call('table.capsule');
    assert.ok(capsule.where.exits.map(exit => exit.to).includes(ANCHOR), 'every minted scene carries its own way back');
    assert.ok(capsule.director.offer.some(entry => entry.kind === 'route'), 'the second minted scene is offered a way out too');
});

test('an exit the source material has not read yet is named in the offer instead of vanishing from it', () => {
    const where = {exits: [{to: 'dunwich-1287', display_name: 'Dunwich, 1287', material: 'missing'}], back: []};
    const rows = api.directorOffer('CUT', {present: [], where, pressures: [], previous: null});
    const route = rows.find(entry => entry.kind === 'route');
    assert.ok(route, 'the only exit out of the scene is offered even while its pages are unread');
    assert.equal(route.where, 'dunwich-1287');
    assert.equal(route.blocked, 'material');
    assert.match(route.line, /apply move/, 'the row names the operation that reads the pages and takes the way out');
    // Ready exits are still the ordinary answer: nothing about a normal scene changes.
    const ordinary = api.directorOffer('CUT', {present: [], where: {exits: [
        {to: 'dunwich-1287', material: 'ready'}, {to: 'unread-annex', material: 'missing'}], back: []}, pressures: [], previous: null});
    assert.deepEqual(ordinary.filter(entry => entry.kind === 'route').map(entry => entry.where), ['dunwich-1287']);
});

test('a locked sole exit stays blocked and says what condition opens it', () => {
    const where = {exits: [{to: 'basement-rites', unlock_when: {condition: 'clue_discovered: cellar-key', met: false}}], back: []};
    const rows = api.directorOffer('CUT', {present: [], where, pressures: [], previous: null});
    const route = rows.find(entry => entry.kind === 'route');
    assert.ok(route, 'a locked sole exit is still named');
    assert.equal(route.blocked, 'locked');
    assert.match(route.line, /cellar-key/, 'the row carries the condition that opens it');
});

test('a scene with no exit at all offers the way the party came in', () => {
    const where = {exits: [], back: [{to: 'commission-briefing', display_name: 'the commission'}]};
    const rows = api.directorOffer('CUT', {present: [], where, pressures: [], previous: null});
    const route = rows.find(entry => entry.kind === 'route');
    assert.ok(route, 'the retrace `apply move` already accepts is offered when nothing else leaves');
    assert.equal(route.where, 'commission-briefing');
    assert.equal(route.from, 'where.back');
});
