/**
 * An authored handout reaches the player, and a card says which of three things is true (§59).
 *
 * The defect this pins came off a real table (`game-1c0faba5`, 2026-09-16). One boolean,
 * `mechanics.available`, was carrying two different questions:
 *
 *  - `apply handout` wrote it to mean "there are bytes to open", and the card drew it as
 *    "delivered / not delivered". Handout 5 of The Haunting is authored `player-safe`, was won on
 *    a hard Library Use, landed its clue, and had its contents read out in the Keeper's prose --
 *    and the card above that prose said the handout had not been delivered.
 *  - the kernel's `map` rows never wrote it at all. A live delivery was answered downstream by the
 *    host's rendered attachment, but the row the campaign *records* carried no answer -- so the
 *    history card and the live card were two different objects and only one had been wired, and any
 *    live path where that attachment does not merge reads as an answered "no".
 *
 * So the two ends are pinned here together. Both cases travel the real path: the campaign is the
 * shipped starter, whose graph carries the same two handout nodes the table was handed -- one with
 * `authored_text`, one registered with a name and a summary and no document at all.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {MAP_DOCUMENT_NONE, MAP_DOCUMENT_READY} from '../../extensions/kernel/map-view.ts';

const root = resolve(import.meta.dirname, '../..');
const evidence = join(root, '.coc/playtests/handout-document-state');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents:
    `export {createKernelContext} from './kernel-ts/context.ts';` +
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';` +
    `export {createKernelRuntime} from './kernel-ts/registry.ts';` +
    `export {mechanics,DOCUMENT_READY,DOCUMENT_NONE,DOCUMENT_UNRESOLVED} from './kernel-ts/read/mechanics.ts';`,
    resolveDir: root, sourcefile: 'handout-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = []; after(async () => {for (const close of closers) await close();});

/** The two nodes the shipped starter carries, named here exactly as the module registered them. */
const WITH_DOCUMENT = 'Handout 2: Unpublished Boston Globe Story (1918)',
    WITHOUT_DOCUMENT = 'Handout 5: Corbitt\'s Obituary and Burial Lawsuit';

async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'handout',
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    await call('table.narrate', {call_id: 't0-c1', text: 'The investigator hears the commission.'});
    await call('table.player_input', {text: 'I take the papers I was promised.'});
    const turns = join(home, '.coc/campaigns/c1/turns');
    /** The receipts as the campaign recorded them, read back off disk the way the evidence is. */
    const recorded = async () => {
        const files = (await readdir(turns)).filter(name => name.endsWith('.json')).sort();
        const rows = [];
        for (const name of files) rows.push(...(JSON.parse(await readFile(join(turns, name), 'utf8')).receipts ?? []));
        return rows;
    };
    return {home, call, recorded};
}

const projected = (receipts, kind) => api.mechanics(receipts).filter(row => row.kind === kind);

test('an authored player-safe handout the module registered with no document is delivered, and the card says so rather than denying the delivery', async () => {
    const t = await table();
    const shown = await t.call('table.apply', {call_id: 't1-c1', effects: [
        {kind: 'handout', name: WITH_DOCUMENT, why: 'The clipping is handed over.'},
        {kind: 'handout', name: WITHOUT_DOCUMENT, why: 'The obituary is handed over.'},
    ]});

    // The kernel already knew, and already said so to the Keeper. This half was never broken: the
    // real table's Keeper read this note and did exactly what it asks -- narrated the contents.
    assert.match(shown.note, /nothing to look at/);
    assert.match(shown.note, /obituary-and-burial-lawsuit/);

    await t.call('table.narrate', {call_id: 't1-c2', text: 'You read both pages through.'});
    const rows = projected(await t.recorded(), 'handout');
    assert.equal(rows.length, 2, 'both deliveries project a card');
    const [withDocument, withoutDocument] = rows;

    assert.equal(withDocument.document, api.DOCUMENT_READY);
    assert.match(await readFile(withDocument.path, 'utf8'), /BOSTON GLOBE/, '`ready` names a page that is really there');

    // The defect. `none` is a statement about the page, not about the delivery -- which is the
    // whole reason it is not the same value the map card was getting by writing nothing at all.
    assert.equal(withoutDocument.document, api.DOCUMENT_NONE);
    assert.notEqual(withoutDocument.document, api.DOCUMENT_UNRESOLVED,
        'the kernel settles a handout itself; only a producer that cannot answer leaves it open');
    assert.equal(withoutDocument.available, undefined, 'the boolean that carried two questions is gone');
    assert.equal(withoutDocument.text, undefined);

    // Authorization is the module author's and was never in doubt. It is asserted because the
    // reading that would "fix" this by refusing the delivery would have to contradict it.
    const receipt = (await t.recorded()).find(row => row.kind === 'handout' && row.name === WITHOUT_DOCUMENT);
    assert.equal(receipt.visibility, 'player-safe');
    assert.equal(receipt.attachment.available, false, 'the receipt keeps the bytes fact it always carried');
});

test('a map card carries the question too, and says the host still owes the answer', async () => {
    const t = await table();
    // The same map the real table was shown. Whether its pixels render is the host's to answer, so
    // what the kernel projects -- and what the turn record therefore keeps -- is the third state,
    // rather than the nothing that used to read as an answered `none`.
    await t.call('table.apply', {call_id: 't1-c1', effects: [
        {kind: 'map', name: 'player-corbitt-house-map', regions: ['upper-landing'],
            region_labels: {'upper-landing': 'Upper landing and stairs'}, level_labels: {'Upper Story': 'Upper story'},
            label: 'Corbitt House, upper landing',
            why: 'The investigator maps the landing.'},
    ]});
    await t.call('table.narrate', {call_id: 't1-c2', text: 'You sketch the landing.'});
    const [map] = projected(await t.recorded(), 'map');
    assert.ok(map, 'the map delivery projects a card');
    assert.equal(map.document, api.DOCUMENT_UNRESOLVED);
    assert.notEqual(map.document, api.DOCUMENT_NONE, 'an unanswered question is not an answered no');

    // And the row that hands the player nothing to open says nothing about the question at all:
    // no consumer reads `kind` to decide whether it applies.
    for (const row of api.mechanics(await t.recorded()).filter(row => !['handout', 'map'].includes(row.kind)))
        assert.equal(row.document, undefined, `${row.kind} opens into nothing and makes no claim`);
});

test('the two legs share one vocabulary across the subprocess boundary', () => {
    // `extensions/` and `kernel-ts/` are built separately and cannot import each other, so the
    // words are declared twice -- the way §39.2's `source` / `play_language` pair is. A silent
    // drift between the two halves is exactly the shape of the defect above, so it is pinned.
    assert.equal(MAP_DOCUMENT_READY, api.DOCUMENT_READY);
    assert.equal(MAP_DOCUMENT_NONE, api.DOCUMENT_NONE);
    assert.equal(new Set([api.DOCUMENT_READY, api.DOCUMENT_NONE, api.DOCUMENT_UNRESOLVED]).size, 3,
        'three states, three values: two of them collapsing is the bug this file exists for');
});
