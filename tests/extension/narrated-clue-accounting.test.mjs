/**
 * Narrated evidence and the clue ledger (contract §51).
 *
 * Three real tables, six instances: prose delivered a name, a date, a routing instruction or a whole
 * new place to go, and the player's clue panel never heard of it. Two causes, and this suite holds
 * both ends of the fix.
 *
 * The one that cannot be blamed on a Keeper: `apply clue` takes an authored clue discoverable at the
 * active scene, and nothing anywhere could bring a clue into existence -- so on campaign
 * `game-1c0faba5` an adapted Roxbury Sanitarium had `clues_here: []` for eight turns and every
 * possible recording was `not_here`. `add_clue` is the missing producer.
 *
 * The one that can: on campaign `game-ef8e60aa` turn 11 Dooley pointed at the burned chapel, the
 * verifier lane said so by name, and the notice lived in exactly one capsule and then was gone.
 * A named reveal now stays in front of the Keeper until the books agree, and clears itself.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const evidence = join(root, '.coc/playtests/narrated-clue-accounting');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({
    stdin: {
        contents: "export {createKernelContext} from './kernel-ts/context.ts';"
            + " export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';"
            + " export {createKernelRuntime} from './kernel-ts/registry.ts';"
            + " export {ModuleGraph} from './kernel-ts/read/module-graph.ts';",
        resolveDir: root, sourcefile: 'clue-accounting-api.ts'
    },
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'
});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => {for (const close of closers) await close();});
const raw = JSON.parse(await readFile(join(root, 'content/starters/the-haunting/module-graph.json'), 'utf8'));
const graph = new api.ModuleGraph('the-haunting', raw, 'test', {});
const START = graph.startScene();

async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({
        workspace: home, content: join(root, 'content'), seed: 'clue-accounting', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}
    });
    const runtime = api.createKernelRuntime(context);
    closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    const world = () => readFile(join(home, '.coc/campaigns/c1/world.json'), 'utf8').then(JSON.parse);
    const record = turn => readFile(join(home, '.coc/campaigns/c1/turns', `${String(turn).padStart(4, '0')}.json`), 'utf8').then(JSON.parse);
    return {home, call, world, record};
}

/** The retained creator/reviewer work, written by the suite instead of a model: this is a contract fixture, not acceptance. */
async function accept(t, name, changes, purpose) {
    const prepared = await t.call('adaptation.prepare', {name, purpose, request: 'A contract fixture for clue accounting.', anchors: [START.name]});
    await writeFile(join(prepared.task.cwd, 'result.json'), JSON.stringify({explanation: 'Contract fixture only.', changes}));
    const draft = await t.call('adaptation.draft', {name, key: prepared.task.key, attempt: prepared.task.attempt});
    assert.equal(JSON.parse(await readFile(join(draft.task.cwd, 'candidate.json'), 'utf8')).deterministic.purpose_validated, true);
    await writeFile(join(draft.task.cwd, 'result.json'), JSON.stringify({
        verdict: 'supported', summary: 'Contract fixture verdict, not model acceptance.', issues: [],
        checked: changes.map((_, index) => ({index, verdict: 'supported', reason: 'Known contract fixture.'}))
    }));
    await t.call('adaptation.review', {name, key: prepared.task.key, attempt: prepared.task.attempt});
    return prepared.task.key;
}

test('a place the book never wrote can hold a finding: add_clue arrives with the destination and apply clue records it (§51.1, §51.2)', async () => {
    const t = await table();
    const prose = 'Knott slides the ring of keys across the desk without being asked.';
    await t.call('table.narrate', {call_id: 't0-c1', text: prose});
    await t.call('table.warn', {turn: 0, lane: 'verifier', findings: [{kind: 'reveal', quote: prose, why: 'Handed over unearned.', clue: 'knott-keys'}]});
    // SL-25: not the Roxbury Sanitarium any more -- the starter now names that place (`previous-tenants`), and the kernel
    // rightly refuses to adapt a second scene for it. The parish charity is a place the book never wrote.
    await t.call('table.player_input', {text: 'I take the address and go out to the parish charity office.'});
    assert.deepEqual((await t.call('table.capsule')).unrecorded.map(row => row.clue), ['knott-keys']);
    await accept(t, 'Charity', [
        {kind: 'add_scene', name: 'South End parish charity', description: 'The charity office that kept the tenants on its relief rolls.',
            based_on: graph.handle(START), sources: [graph.handle(START)], reason: 'The player chose to go and ask after the family.'},
        {kind: 'route', from: graph.handle(START), to: 'South End parish charity', sources: [START.name], reason: 'Ordinary travel across the city.'},
        {kind: 'add_clue', name: 'Admission register entry', description: 'The register gives the admission date and who signed the committal.',
            scene: 'South End parish charity', sources: [START.name], reason: 'What the relief desk can be made to show.'}
    ], 'new_destination');
    await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: 'Charity'}]});
    await t.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'move', to: 'South End parish charity'}]});

    const capsule = await t.call('table.capsule');
    const here = capsule.known.clues_here.map(entry => entry.name);
    assert.ok(here.includes('Admission register entry'), `the adapted place holds its finding: ${JSON.stringify(here)}`);
    // The gap does not follow the party out of the room it was opened in: what cannot be found here
    // cannot be recorded here, and a row that stayed would be a nag with no call behind it.
    assert.deepEqual(capsule.unrecorded, []);

    const applied = await t.call('table.apply', {call_id: 't1-c3', effects: [{kind: 'clue', clue: 'Admission register entry', how: 'The ward clerk turned the page.'}]});
    assert.ok(applied.receipts.some(id => String(id).startsWith('clue:')), JSON.stringify(applied.receipts));
    assert.ok((await t.world()).discovered_clues.includes('Admission register entry'));
});

test('a place already standing does not need a second one to hold what was found there (§51.1)', async () => {
    const t = await table();
    await t.call('table.narrate', {call_id: 't0-c1', text: 'The investigator hears the commission.'});
    await t.call('table.player_input', {text: 'I ask him what the neighbours said at the time.'});
    await accept(t, 'What the neighbours said', [
        {kind: 'add_clue', name: 'Neighbour complaint book', description: 'The landlord kept the letters the neighbours sent about the house.',
            scene: graph.handle(START), sources: [START.name], reason: 'The player asked the landlord for what the neighbours put in writing.'}
    ], 'new_clue');
    await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'adaptation', name: 'What the neighbours said'}]});
    await t.call('table.apply', {call_id: 't1-c2', effects: [{kind: 'clue', clue: 'Neighbour complaint book', how: 'Knott dug the letters out of his file.'}]});
    assert.ok((await t.world()).discovered_clues.includes('Neighbour complaint book'));
});

test('new_clue permits nothing but the clue operations, and requires the clue (§51.1)', async () => {
    const t = await table();
    await t.call('table.narrate', {call_id: 't0-c1', text: 'The investigator hears the commission.'});
    await t.call('table.player_input', {text: 'I press him on the paperwork.'});
    await assert.rejects(
        () => accept(t, 'Refused foreign operation', [{kind: 'add_npc', name: 'A clerk', description: 'A witness.', agenda: 'Answer.', sources: [START.name], reason: 'Fixture.'}], 'new_clue'),
        error => {
            assert.deepEqual(error.details?.allowed, ['add_clue', 'clue_at', 'npc_knows']);
            return true;
        });
    await assert.rejects(
        () => accept(t, 'Refused empty purpose', [{kind: 'clue_at', clue: graph.handle(graph.nodes.get(graph.sceneClueIds(START)[0])), scene: graph.handle(START), sources: [START.name], reason: 'Fixture.'}], 'new_clue'),
        error => {
            assert.equal(error.details?.required, 'add_clue');
            return true;
        });
});

test('a reveal that names its clue lands on the record as a handle, not a sentence (§51.3)', async () => {
    const t = await table();
    const prose = 'Knott slides the ring of keys across the desk without being asked.';
    await t.call('table.narrate', {call_id: 't0-c1', text: prose});
    const named = graph.handle(graph.nodes.get(graph.sceneClueIds(START).find(id => graph.handle(graph.nodes.get(id)) === 'knott-keys')));
    const answer = await t.call('table.warn', {
        turn: 0, lane: 'verifier',
        findings: [
            {kind: 'reveal', quote: prose, why: 'The keys were handed over before the player earned them.', clue: named},
            {kind: 'reveal', quote: prose, why: 'A clue name this module does not have.', clue: 'no-such-clue'}
        ]
    });
    assert.equal(answer.accepted, 2);
    const warnings = (await t.record(0)).warnings;
    assert.deepEqual(warnings.map(value => value.clue ?? null), [named, null],
        'the handle rides only when it resolves; an unresolvable name drops the field and keeps the finding');
});

test('a named reveal the ledger never got outlives its own turn, and clears itself when the books agree (§51.4)', async () => {
    const t = await table();
    const prose = 'Knott slides the ring of keys across the desk without being asked.';
    await t.call('table.narrate', {call_id: 't0-c1', text: prose});
    await t.call('table.warn', {turn: 0, lane: 'verifier', findings: [{kind: 'reveal', quote: prose, why: 'Handed over unearned.', clue: 'knott-keys'}]});

    const first = await t.call('table.player_input', {text: 'I weigh the keys in my hand.'});
    const open = first.capsule.unrecorded;
    assert.deepEqual(open.map(row => [row.clue, row.turn, row.operation]), [['knott-keys', 0, 'apply clue']],
        'the gap is a row with the call that closes it, not a sentence in a warning log');
    assert.match(open[0].line, /apply clue knott-keys/);

    // One turn on, with no new finding: the warnings section has already moved past it.
    await t.call('table.narrate', {call_id: 't1-c1', text: 'He waits for an answer.'});
    const second = await t.call('table.player_input', {text: 'I ask what the neighbours said.'});
    assert.deepEqual(second.capsule.warnings, [], 'warnings only ever show the last committed turn');
    assert.deepEqual(second.capsule.unrecorded.map(row => row.clue), ['knott-keys'], 'the gap does not expire with the notice');

    await t.call('table.apply', {call_id: 't2-c1', effects: [{kind: 'clue', clue: 'knott-keys', how: 'He had already put them in my hand.'}]});
    await t.call('table.narrate', {call_id: 't2-c2', text: 'The keys go into a coat pocket.'});
    const third = await t.call('table.player_input', {text: 'I head for the house.'});
    assert.deepEqual(third.capsule.unrecorded, [], 'recording it is what retracts it; no writer has to');
});
