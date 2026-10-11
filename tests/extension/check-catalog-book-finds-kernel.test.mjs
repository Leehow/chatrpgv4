/**
 * Contract §219.1-§219.2 on the kernel's own RPC entry (in process, the real runtime over the shipped haunting): the check
 * catalog (`table.resolve.options`) carries what the book finds here by a check of a named skill on the investigator's
 * profile of that skill, and the word this table calls a person on the options aimed at them.
 *
 * 4d7 live table (issue #112): turns 80-84 at the Hall of Records, the executor clue is the book's Library Use (regular)
 * find; check selection never rolled it, because nothing in its catalog said so. Turn 96 at the courts: the social option
 * named Kim Debrun by his untold book name while every public line called him by the table's word, and Jev chose the
 * other person in the room.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {readFileSync} from 'node:fs';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';

const root = resolve(import.meta.dirname, '../..');
const directory = playtestScratch('check-catalog-book-finds');
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents: "export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';"
        + " export {createKernelRuntime} from './kernel-ts/registry.ts';", resolveDir: root, sourcefile: 'book-finds-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = [];
after(async () => { for (const close of closers) await close(); });

async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'book-finds', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context);
    closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans'});
    await call('table.open');
    let calls = 0;
    const id = turn => `t${turn}-c${++calls}`;
    const world = () => JSON.parse(readFileSync(join(home, '.coc/campaigns/c1/world.json'), 'utf8'));
    const options = async () => (await call('table.resolve.options')).selection;
    return {call, id, world, options};
}
const investigator = async game => (await game.call('table.view')).party?.[0]?.name ?? (await game.options()).situation.patients[0].name;
const ordinary = (selection, actor, skill) => selection.options.find(option => option.action.decision === 'core-check:ordinary-check'
    && option.action.actor === actor && option.action.skill === skill && option.action.rule === undefined);

test('§219.1: at the library the investigator\'s Library Use profile carries the book\'s find; other skills do not; a roll passed this turn ends it', async () => {
    const game = await table();
    await game.call('table.player_input', {text: '我去中央图书馆查一八三五年的记录。'});
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'central-library'}]});
    const actor = await investigator(game);
    const before = await game.options();
    const library = ordinary(before, actor, 'Library Use');
    assert.ok(library, 'the investigator has a Library Use profile here');
    const finds = library.facts?.book_finds ?? [];
    assert.ok(finds.length >= 1, JSON.stringify(library));
    assert.ok(finds.every(find => find.skill === 'Library Use' && typeof find.find === 'string' && find.find.length > 0));
    assert.ok(finds.some(find => find.difficulty === 'regular'));
    for (const option of before.options.filter(option => option.action.decision === 'core-check:ordinary-check' && option.action.skill !== 'Library Use'
        && option.facts?.book_finds))
        assert.ok(option.facts.book_finds.every(find => find.skill === option.action.skill), 'a find rides only its own skill');
    // The Keeper's own landing before the roll is refused, and the fix keeps the attempt open for the roll (4d7 t80-t84:
    // the Keeper narrated the attempt as having come to nothing, four turns running, and no roll was ever made).
    let refused;
    try { await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'house-built-1835'}]}); } catch (error) { refused = error; }
    assert.equal(refused?.details?.reason, 'check_first');
    assert.match(refused.fix, /narrate the attempt as still under way, without what the clue states and without settling that it fails: whether the attempt finds it is that roll's to decide/);
    // One roll a turn until one passes; once it passed this turn the find is no longer an open book check.
    for (let turn = 1; turn < 40; turn++) {
        if (turn > 1) await game.call('table.player_input', {text: '我继续查。'});
        const result = await game.call('table.resolve', {call_id: game.id(turn), action: {intent: 'investigate', skill: 'Library Use', goal: '查一八三五年的建造记录'}});
        if (result.outcome?.passed === true) {
            const after = ordinary(await game.options(), actor, 'Library Use');
            assert.ok(!(after?.facts?.book_finds ?? []).some(find => finds.some(open => open.find === find.find)),
                'a find whose check passed this turn is not offered again as one');
            return;
        }
        await game.call('table.narrate', {call_id: game.id(turn), text: '你合上卷宗。'});
    }
    assert.fail('no Library Use roll passed in forty turns');
});

test('§219.2: a person present whom the table calls by a word carries it on the options aimed at them and in the situation', async () => {
    const game = await table();
    await game.call('table.player_input', {text: '我去市政厅档案处。'});
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'clue', clue: 'knott-research-leads', how: 'Knott named the places'}, {kind: 'move', to: 'hall-of-records'}]});
    const selection = await game.options();
    const person = selection.situation.people.find(entry => entry.name !== undefined);
    assert.ok(person, `someone is present at the Hall of Records: ${JSON.stringify(selection.situation.people)}`);
    const word = '戴袖套的文书';
    await game.call('table.apply', {call_id: game.id(1), effects: [{kind: 'person', who: person.name, name: word, why: 'what the table calls him'}]});
    const named = await game.options();
    assert.deepEqual(named.situation.people.find(entry => entry.name === person.name)?.called, word);
    const aimed = named.options.filter(option => option.action.target === person.name);
    assert.ok(aimed.some(option => option.action.decision === 'social:adjudicate-difficulty'), 'a social option is aimed at that person');
    for (const option of aimed.filter(option => ['social:adjudicate-difficulty', 'psychology:observe-concealed', 'core-check:opposed-check'].includes(option.action.decision)))
        assert.equal(option.facts?.target_called, word, option.label);
    assert.ok(aimed.every(option => option.action.target === person.name), 'the bound target stays the rules\' name');
});
