/**
 * The handouts presentation lane asks for exactly the words the handout card shows.
 *
 * The renderer looks a handout's body up by the mechanics row's `text` (`term(row.text)`), and the
 * lane's answer is keyed by what the lane was asked. The kernel projects the body without the `# `
 * heading it wrote above it; the lane used to ask for the whole file, heading included. The
 * translation was made and saved -- keyed on a string no card carries -- so on a real zh-Hans table
 * (the-haunting, 2026-09-23) the Globe clipping folded open in English under a Chinese title.
 *
 * Travels the real path: the shipped starter, `apply handout` writing the file, the kernel's own
 * projection of the recorded receipt, and the lane's own input reader over that campaign.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {handoutInput, handoutTexts} from '../../extensions/module/character-presentation.ts';

const root = resolve(import.meta.dirname, '../..');
const evidence = join(root, '.coc/playtests/handout-words-follow-the-card');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents:
    `export {createKernelContext} from './kernel-ts/context.ts';` +
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';` +
    `export {createKernelRuntime} from './kernel-ts/registry.ts';` +
    `export {mechanics} from './kernel-ts/read/mechanics.ts';`,
    resolveDir: root, sourcefile: 'handout-words-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const closers = []; after(async () => {for (const close of closers) await close();});

const GLOBE = 'Handout 2: Unpublished Boston Globe Story (1918)';

test('the handouts lane asks for the body the card shows, not the file the kernel wrote', async () => {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'handout-words',
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    await call('table.narrate', {call_id: 't0-c1', text: 'The investigator hears the commission.'});
    await call('table.player_input', {text: 'I ask the archivist for the Sheafe Street clippings.'});
    await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: GLOBE, why: 'The clipping is handed over.'}]});
    await call('table.narrate', {call_id: 't1-c2', text: 'The copy lies open by your hand.'});

    const turns = join(home, '.coc/campaigns/c1/turns'), receipts = [];
    for (const name of (await readdir(turns)).filter(name => name.endsWith('.json')).sort())
        receipts.push(...(JSON.parse(await readFile(join(turns, name), 'utf8')).receipts ?? []));
    const paths = receipts.filter(r => r.kind === 'handout').map(r => r.attachment.path);
    const texts = new Map(await Promise.all(paths.map(async path => [path, await readFile(path, 'utf8')])));
    const [card] = api.mechanics(receipts, {}, texts).filter(row => row.kind === 'handout');
    assert.ok(card?.text, 'the Globe clipping projects a card with a body');
    const file = texts.get(card.path);
    assert.notEqual(card.text, file, 'the card shows less than the file: the heading is not part of the body');

    // What the renderer looks up (`term(row.label || row.name)`, `term(row.text)`) is what the lane asks.
    const asked = handoutTexts({handouts: await handoutInput(home, 'c1')});
    assert.ok(asked.includes(card.text), 'the lane asks for the exact body the card looks up');
    assert.ok(asked.includes(card.name), 'and for the name the row folds under');
    assert.ok(!asked.includes(file), 'and never for the raw file, which no card carries');

    // The clue list reopens the same document (2026-09-23): `table.view` carries it under the same
    // two strings, so the one saved projection answers the panel and the card alike.
    const view = await call('table.view');
    assert.deepEqual(view.handouts, [{handout: 'globe-unpublished-1918', name: card.name, text: card.text}]);
    for (const row of view.handouts) {
        assert.ok(asked.includes(row.text) && asked.includes(row.name), 'every panel string is one the lane asks for');
    }
});
