// Haunting graph v2 (2026-10-08, docs/specs/haunting-graph-v2.md): what the book says a newcomer sees of each place and
// person reaches the Keeper by the kernel's own paths -- the capsule's `first_sight` (§168.5), `where.places`, the clue
// gates and the exits -- on a real campaign of the shipped starter.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';

const root = resolve(import.meta.dirname, '../..');
const directory = playtestScratch('haunting-graph-v2');
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts';`,
    resolveDir: root, sourcefile: 'test-api.ts'}, outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = []; after(async () => {for (const close of closers) await close();});
const graph = JSON.parse(await readFile(join(root, 'content/starters/the-haunting/module-graph.json'), 'utf8'));
const node = id => graph.nodes.find(entry => entry.node_id === id);

async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'haunting-v2', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    let turn = 0;
    const opening = await call('table.narrate', {call_id: 't0-c1', text: 'The landlord waits for an answer.'});
    void opening;
    /** One played turn: the player speaks, the Keeper moves the party (or not) and narrates; returns the next capsule. */
    const play = async (to) => {
        turn += 1;
        const input = await call('table.player_input', {text: 'We go on.'});
        if (to) await call('table.apply', {call_id: `t${turn}-c1`, effects: [{kind: 'move', to}]});
        await call('table.narrate', {call_id: `t${turn}-c2`, text: 'They go on.'});
        return input;
    };
    const capsule = async () => (await play(null)).capsule;
    return {call, play, capsule};
}

test('the opening shows the landlord as the book describes him, before his name does any work', async () => {
    const t = await table();
    const first = (await t.play(null)).capsule;
    const knott = (first.first_sight?.people ?? []).find(person => person.name === 'Steven Knott');
    assert.ok(knott, JSON.stringify(first.first_sight));
    assert.equal(knott.described, node('npc-steven-knott').properties.biography);
});

test("the Globe's first sight carries the book's offices and both of its people", async () => {
    const t = await table();
    await t.play('newspaper-morgue');
    const capsule = await t.capsule();
    assert.equal(capsule.where.scene, 'newspaper-morgue');
    assert.equal(capsule.first_sight.place.described, node('scene-newspaper-morgue').properties.description);
    assert.deepEqual(capsule.first_sight.people.map(person => [person.name, person.described]).sort(),
        [['Arty Wilmot', node('npc-arty-wilmot').properties.biography], ['Ruth Blake', node('npc-ruth-blake').properties.biography]]);
    // The morgue the book shows only once Arty yields rides the scene's notes, not the arrival.
    assert.ok(capsule.where.keeper_notes.some(note => note.startsWith('The morgue, once Arty yields')));
    assert.ok(!capsule.first_sight.place.described.includes('boiler'));
});

test("each floor's rooms are the where section's places, and the house keeps every road", async () => {
    const t = await table();
    for (const scene of ['central-library', 'newspaper-morgue', 'neighborhood-gossip', 'corbitt-house-ground'])
        await t.play(scene);
    const ground = await t.capsule();
    assert.equal(ground.where.scene, 'corbitt-house-ground');
    const roads = graph.relations.filter(relation => relation.relation_kind === 'route-to' && relation.from_node_id === 'scene-corbitt-house-ground');
    assert.equal(ground.where.exits.length, roads.length);
    assert.deepEqual(ground.where.places.map(place => place.name), ['Storage room', 'Second storage room', 'Mud room', 'Living room', 'Dining room', 'Kitchen']);
    await t.play('basement-rites');
    const basement = await t.capsule();
    assert.deepEqual(basement.where.places.map(place => place.name), ['Basement storage room', 'Coal bin', 'Crawl space behind the boards', "Corbitt's hiding place"]);
    assert.equal(basement.where.places[0].line, node('location-basement-storage').summary);
});

// §13.1.1 (decision G): over budget, the compact where gives up the trail, then the places, before any exit.
test('on the long walk the trail is cut before a single exit', async () => {
    const walk = ['chapel-of-contemplation-ruins', 'higher-courts-central-police', 'hall-of-records', 'central-library', 'newspaper-morgue',
        'neighborhood-gossip', 'previous-tenants', 'corbitt-house-ground'];
    const t = await table();
    const seen = new Map();
    for (const scene of walk) {
        await t.play(scene);
        seen.set(scene, await t.capsule());
    }
    for (const scene of ['chapel-of-contemplation-ruins', 'corbitt-house-ground']) {
        const where = seen.get(scene).where;
        const roads = graph.relations.filter(relation => relation.relation_kind === 'route-to' && relation.from_node_id === `scene-${scene}`);
        assert.equal(where.exits.length, roads.length, `${scene}: ${where.exits.map(exit => exit.to)}`);
    }
    const house = seen.get('corbitt-house-ground');
    assert.ok(house.truncated.includes('where'), 'the walk is long enough to put the house over budget');
    assert.ok(house.where.back.length >= 1 && house.where.back.length < walk.length, JSON.stringify(house.where.back));
    assert.equal(house.where.back[0].to, 'previous-tenants');
});

test('the checks the book names reach the clue gates', async () => {
    const t = await table();
    await t.play('central-library');
    const library = await t.capsule();
    const gates = library.where.affordances.flatMap(entry => (entry.clues ?? []).map(clue => clue.gate));
    assert.ok(gates.length === 4 && gates.every(gate => gate.startsWith('skill_check: Library Use (one half-day per roll')), JSON.stringify(gates));
    await t.play('corbitt-house-ground');
    await t.play('basement-rites');
    const basement = await t.capsule();
    const knife = basement.where.affordances.flatMap(entry => entry.clues ?? []).find(clue => clue.clue === 'rusted-basement-dagger');
    assert.ok(knife?.gate.startsWith('skill_check: Spot Hidden (obscure'), JSON.stringify(knife));
});

test('the Chapel is a road from each place the book makes it known', async () => {
    for (const route of [['neighborhood-gossip'], ['hall-of-records'], ['hall-of-records', 'higher-courts-central-police']]) {
        const t = await table(), from = route.at(-1);
        for (const scene of route) await t.play(scene);
        const here = await t.capsule();
        const road = here.where.exits.find(exit => exit.to === 'chapel-of-contemplation-ruins');
        assert.deepEqual(road?.unlock_when, {condition: 'clue_discovered: chapel-ruins-location', met: false}, `${from}: ${JSON.stringify(here.where.exits)}`);
        await t.play('chapel-of-contemplation-ruins');
        assert.equal((await t.capsule()).where.scene, 'chapel-of-contemplation-ruins');
    }
});

test("every place v2 added cites a page whose text carries its anchor", async () => {
    const transcripts = join(root, 'content/source-transcripts/31e36f72d0ac9a3654b61a09b1f071d3d82f25d78641e5069bfe343e44c5c7db');
    const pages = new Map();
    for (const name of (await readdir(transcripts)).filter(name => name.startsWith('page-'))) {
        const page = JSON.parse(await readFile(join(transcripts, name), 'utf8'));
        pages.set(Number(page.pdf_label) + 11, page.text);
    }
    const places = graph.nodes.filter(entry => entry.node_kind === 'location' && entry.node_id !== 'location-corbitt-house');
    assert.equal(places.length, 17);
    for (const place of places)
        for (const ref of place.source_refs)
            assert.ok(pages.get(ref.pdf_index)?.includes(ref.grep_anchor), `${place.node_id}: ${JSON.stringify(ref)}`);
});
