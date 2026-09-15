import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, waitForIdle} from './harness.mjs';

const root = resolve(import.meta.dirname, '../..');
const evidence = join(root, '.coc/playtests/bounded-recall-contracts');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents: [
    `export {createKernelContext} from './kernel-ts/context.ts';`,
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';`,
    `export {createKernelRuntime} from './kernel-ts/registry.ts';`,
    `export {RecallPages} from './extensions/kernel/recall-pages.ts';`,
    `export {KernelError} from './extensions/kernel/client.ts';`,
].join('\n'), resolveDir: root, sourcefile: 'bounded-recall-api.ts'}, outfile: join(directory, 'api.mjs'),
    bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href), closers = [];
after(async () => {for (const close of closers) await close();});
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
async function fixture() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'bounded-recall',
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const base = join(home, '.coc/campaigns/c1');
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open'); await call('table.narrate', {call_id: 't0-c1', text: 'The witness waits.'});
    const write = async (path, value) => {
        await mkdir(join(base, path, '..'), {recursive: true});
        await writeFile(join(base, path), typeof value === 'string' ? value : JSON.stringify(value));
    };
    const pager = new api.RecallPages();
    const recall = async params => {
        const result = await call('table.recall', pager.prepare(params));
        assert.ok(bytes(result) <= 12288, `whole wire response is ${bytes(result)} bytes`);
        return pager.accept(result);
    };
    return {base, call, write, recall, pager};
}
async function setTranscript(t, text) {
    await t.write('transcript.jsonl', JSON.stringify({turn: 0, role: 'keeper', text}) + '\n');
    const record = JSON.parse(await readFile(join(t.base, 'turns/0000.json'), 'utf8'));
    await t.write('turns/0000.json', {...record, rendered_text: text});
}

test('short-range browse never embeds full utterances; Unicode pages reconstruct the retained original', async () => {
    const t = await fixture(), original = ('A\u{1f9ed}e\u0301\u6f22\n"\\').repeat(3000);
    await setTranscript(t, original);
    const saved = await readFile(join(t.base, 'transcript.jsonl'), 'utf8');
    const cards = await t.recall({what: 'transcript', turns: [0, 0]});
    assert.equal(cards.entries, undefined); assert.equal(cards.cards.length, 1);
    assert.equal(cards.cards[0].chars, Array.from(original).length);
    let request = cards.cards[0].read, reconstructed = '', offset = 0, pages = 0;
    while (request) {
        const result = await t.recall(request); pages++;
        assert.equal(result._snapshot, undefined);
        assert.equal(result.verified, true);
        assert.equal(result.verification_scope, 'record_integrity_only');
        assert.equal(result.range.offset, offset);
        assert.equal(result.range.end, offset + Array.from(result.text).length);
        assert.ok(Array.from(result.text).length <= 4096);
        reconstructed += result.text; offset = result.range.end; request = result.next;
    }
    assert.ok(pages > 2); assert.equal(reconstructed, original);
    assert.equal(await readFile(join(t.base, 'transcript.jsonl'), 'utf8'), saved);
});

test('source mutation or worldline switch refuses issued continuations and never exposes a token', async () => {
    const t = await fixture(); await setTranscript(t, 'old '.repeat(3000));
    const first = await t.recall({what: 'transcript', read: {turn: 0, role: 'keeper'}});
    assert.ok(first.next); assert.ok(!JSON.stringify(first).includes('_snapshot'));
    await setTranscript(t, 'new '.repeat(3100));
    let refresh;
    await assert.rejects(t.recall(first.next), error => {
        refresh = error.details?.refresh;
        assert.deepEqual(refresh, {what: 'transcript', read: {turn: 0, role: 'keeper'}});
        return error.details?.reason === 'recall_page_stale';
    });
    const refreshed = await t.recall(refresh);
    const meta = JSON.parse(await readFile(join(t.base, 'campaign.json'), 'utf8'));
    await t.write('campaign.json', {...meta, active_worldline: 'other', worldlines: {...meta.worldlines, other: {loop: 1}}});
    await assert.rejects(t.recall(refreshed.next), error => error.details?.reason === 'recall_page_stale');
    assert.throws(() => new api.RecallPages().prepare(first.next), error => error.details?.reason === 'recall_page_stale');
});

test('integrity checks the complete original before slicing, never its truth', async () => {
    const t = await fixture(); await setTranscript(t, 'An unverified story. '.repeat(500));
    const record = JSON.parse(await readFile(join(t.base, 'turns/0000.json'), 'utf8'));
    await t.write('turns/0000.json', {...record, rendered_text: 'Different retained record.'});
    const result = await t.recall({what: 'transcript', read: {turn: 0, role: 'keeper', limit: 7}});
    assert.equal(result.text, 'An unve'); assert.equal(result.verified, false);
    assert.equal(result.verification_scope, 'record_integrity_only');
});

test('history pages preserve all rows; oversized events return bounded original JSON detail pages', async () => {
    const t = await fixture();
    const events = Array.from({length: 61}, (_, turn) => ({type: 'player-declared', turn, data: {text: turn === 23 ? '\u{1f9ed}'.repeat(9000) : `Declaration ${turn}`}}));
    await t.write('events.jsonl', events.map(JSON.stringify).join('\n') + '\n');
    let request = {what: 'history', turns: [0, 60], types: ['player-declared']}, seen = [], placeholder;
    while (request) {
        const result = await t.recall(request); assert.ok(result.events.length <= 20);
        seen.push(...result.events); placeholder ??= result.events.find(row => row.representation === 'detail_reference');
        request = result.next;
    }
    assert.equal(seen.length, 61); assert.ok(placeholder);
    assert.equal(placeholder.type, 'player-declared'); assert.equal(placeholder.turn, 23);
    let json = ''; request = placeholder.read;
    while (request) {const result = await t.recall(request); json += result.text; request = result.next;}
    assert.deepEqual(JSON.parse(json), events[23]);
});

test('large diffs page their changes rather than flooding context', async () => {
    const t = await fixture();
    const old = JSON.parse(await readFile(join(t.base, 'turns/0000.json'), 'utf8'));
    await t.write('turns/0001.json', {...old, turn: 1, receipts: Array.from({length: 95}, (_, i) => ({kind: 'clue', clue: `evidence-${i}`}))});
    let request = {what: 'history', diff: [0, 1]}, changes = [];
    while (request) {const result = await t.recall(request); changes.push(...result.diff); request = result.next;}
    assert.equal(changes.filter(change => change.kind === 'clue').length, 95);
});

test('worldline metadata stays available across history sections and large trees use bound references', async () => {
    const t = await fixture();
    const timeline = await t.recall({what: 'history', lines: true});
    const events = await t.recall({what: 'history', lines: true, types: ['player-declared']});
    assert.equal(timeline.lines.active, 'main'); assert.deepEqual(events.lines, timeline.lines);
    const meta = JSON.parse(await readFile(join(t.base, 'campaign.json'), 'utf8'));
    await t.write('campaign.json', {...meta, worldlines: {...meta.worldlines,
        ...Object.fromEntries(Array.from({length: 100}, (_, i) => [`retained-line-${i}`, {loop: i, kind: 'if', status: 'active'}]))}});
    const first = await t.recall({what: 'history', lines: true, types: ['player-declared']});
    assert.equal(first.lines.truncated, true);
    const tree = await t.recall(first.lines.read);
    let entry = tree.timeline[0];
    if (entry.read) {
        let request = entry.read, json = '';
        while (request) {const result = await t.recall(request); json += result.text; request = result.next;}
        entry = JSON.parse(json);
    }
    assert.equal(entry.lines.filter(line => line.name.startsWith('retained-line-')).length, 100);
});

test('candidate pages preserve authority and correction order, and invalidate on late extraction', async () => {
    const t = await fixture();
    const candidates = Array.from({length: 45}, (_, i) => ({id: `mem:${i}`, kind: i === 44 ? 'keeper_correction' : 'promise', subject: 'Steven Knott',
        statement: `Statement ${i}: ${'a'.repeat(300)}`, entities: ['Thomas Hayes'], status: 'candidate', state: 'uncertain', valid_from_turn: i}));
    await t.write('memory/candidates.jsonl', candidates.map(JSON.stringify).join('\n') + '\n');
    const first = await t.recall({what: 'memory', about: ['Steven Knott'], limit: 30});
    assert.equal(first.hits[0].kind, 'keeper_correction');
    assert.ok(first.hits.every(hit => hit.authority === 'conversation_report' && hit.status === 'candidate'));
    let request = first.next, hits = [...first.hits];
    while (request) {const result = await t.recall(request); hits.push(...result.hits); request = result.next;}
    assert.equal(hits.length, 45); assert.equal(new Set(hits.map(hit => hit.id)).size, 45);
    await t.write('memory/candidates.jsonl', [...candidates, {...candidates[0], id: 'late', valid_from_turn: 50}].map(JSON.stringify).join('\n') + '\n');
    await assert.rejects(t.recall(first.next), error => error.details?.reason === 'recall_page_stale');
    const promises = await t.recall({what: 'memory', kinds: ['promise']});
    assert.ok(promises.hits.every(hit => hit.kind === 'promise'));
});

test('invalid offsets and missing snapshot bindings fail with bounded diagnostics', async () => {
    const t = await fixture();
    await assert.rejects(t.call('table.recall', {what: 'transcript', read: {turn: 0, role: 'keeper', offset: -1}}), /offset/);
    await assert.rejects(t.call('table.recall', {what: 'transcript', read: {turn: 0, role: 'keeper', offset: 1}}), error => error.details?.reason === 'recall_page_stale');
    await assert.rejects(t.recall({what: 'history', page: {section: 'cards'}}), /History sections/);
    await assert.rejects(t.call('table.recall', {what: 'memory', about: ['x'.repeat(100000)]}), error => {
        assert.equal(error.details?.reason, 'recall_budget'); assert.ok(error.message.length < 200); return true;
    });
    const empty = await t.recall({what: 'transcript', turns: [500, 600]});
    assert.deepEqual(empty.cards, []); assert.equal(empty.next, undefined);
});

test('host diagnostics remain bounded and caller-supplied snapshots have no authority', () => {
    const pager = new api.RecallPages(), next = {what: 'transcript', read: {turn: 0, role: 'keeper', offset: 5, limit: 5}};
    pager.accept({_snapshot: 'owned-source', next});
    assert.equal(pager.prepare({...next, _snapshot: 'forged-source'})._snapshot, 'owned-source');
    const error = pager.diagnostic(new api.KernelError({code: 'invalid_params', message: 'Too many source names', details: {options: ['x'.repeat(30000)]}}));
    assert.equal(error.details.reason, 'recall_budget'); assert.equal(error.details.truncated, true);
    assert.ok(bytes({message: error.message, details: error.details, fix: error.fix}) < 1024);
});

test('real Pi tool execution binds and hides continuation snapshots end to end', async t => {
    const original = 'The witness remembers an earlier promise.';
    const table = await openTable({realKernel: true, campaign: 'bounded-recall-host', retainAt: directory, responses: [
        fauxAssistantMessage([fauxToolCall('narrate', {text: original})], {stopReason: 'toolUse'}),
        fauxAssistantMessage('Discarded opening tail.'),
        fauxAssistantMessage([fauxToolCall('recall', {what: 'transcript', read: {turn: 0, role: 'keeper', limit: 5}})], {stopReason: 'toolUse'}),
        fauxAssistantMessage([fauxToolCall('recall', {what: 'transcript', read: {turn: 0, role: 'keeper', offset: 5, limit: 5}})], {stopReason: 'toolUse'}),
        fauxAssistantMessage([fauxToolCall('narrate', {text: 'The witness repeats the earlier words.'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage('Discarded final tail.'),
    ]});
    t.after(() => table.dispose()); await waitForIdle(table.session, {timeoutMs: 60000});
    await table.session.prompt('What exactly did the witness say?');
    await waitForIdle(table.session, {timeoutMs: 60000});
    const results = table.session.messages.filter(message => message.role === 'toolResult' && message.toolName === 'recall');
    assert.equal(results.length, 2);
    const first = JSON.parse(results[0].content[0].text), second = JSON.parse(results[1].content[0].text);
    assert.equal(first.text, original.slice(0, 5)); assert.equal(second.text, original.slice(5, 10));
    assert.ok(results.every(result => !JSON.stringify(result).includes('_snapshot')));
    assert.ok(table.telemetry().filter(row => row.tool === 'recall').every(row => row.ok && row.response_bytes <= 12288));
    assert.deepEqual(table.extensionErrors, []);
});
