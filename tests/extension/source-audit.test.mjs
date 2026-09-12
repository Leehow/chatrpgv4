import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, writeFile, chmod} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import {build} from 'esbuild';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, assistantTexts, waitForIdle} from './harness.mjs';
import modsExtension from '../../extensions/mods/index.ts';
import {KernelError} from '../../extensions/kernel/client.ts';

const root = resolve(import.meta.dirname, '../..'), evidence = join(root, '.coc/playtests/source-audit-contracts');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root, sourcefile: 'source-audit-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href), closers = [];
after(async () => {for (const close of closers) await close();});
async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'audit', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('mods.install', {path: join(root, 'tests/fixtures/mods/narration-audit-v112')});
    await call('mods.configure', {id: 'narration-audit', version: '1.1.2', enabled: true});
    await call('table.open');
    await call('table.narrate', {call_id: 't0-c1', text: 'The original commission was heard. ' + 'Retained complete history. '.repeat(150)});
    await call('table.player_input', {text: 'Please clarify what is known; I decline the book.'});
    const audit = text => call('mods.job', {role: 'audit', input: {text}});
    const result = (job, value) => writeFile(join(job.cwd, 'result.json'), JSON.stringify(value));
    return {home, call, audit, result};
}
const emptyReview = {missing: [], findings: [], source_review: {verdict: 'supported', summary: 'The fixture contains only a pause, no material source claim.', claims: []}};

test('source audit exposes complete immutable source/history and requires grounded quotes; state changes invalidate replay', async () => {
    const t = await table(), job = await t.audit('Steven Knott pauses.');
    assert.equal(job.source_review, true);
    const request = JSON.parse(await readFile(join(job.cwd, 'request.json'), 'utf8'));
    assert.ok(request.source_review.files.includes('original.json'));
    assert.ok(request.source_review.files.includes('current.json'));
    assert.equal(request.source_review.current_input, 'Please clarify what is known; I decline the book.');
    const history = JSON.parse(await readFile(join(job.cwd, 'history.json'), 'utf8'));
    assert.ok(history[0].rendered_text.length > 3000);
    assert.ok(!Object.hasOwn(history[0], 'capsule'));
    const original = JSON.parse(await readFile(join(job.cwd, 'original.json'), 'utf8'));
    assert.ok(original.graph.nodes.some(node => node.name === 'Steven Knott'));
    await t.result(job, {missing: [], findings: []});
    await assert.rejects(t.call('mods.accept', {job: job.job}), /Source audit requires/);
    const reviewed = {missing: [], findings: [], source_review: {verdict: 'supported', summary: 'A known source person is present.', claims: [
        {quote: 'Steven Knott', verdict: 'supported', reason: 'The source identifies this person.', evidence: [{file: 'original.json', quote: 'Invented source quotation'}]}
    ]}};
    await t.result(job, reviewed);
    await assert.rejects(t.call('mods.accept', {job: job.job}), /excerpt is absent/);
    reviewed.source_review.claims[0].evidence[0].quote = 'Steven Knott';
    await t.result(job, reviewed);
    assert.deepEqual(await t.call('mods.accept', {job: job.job}), reviewed);
    assert.deepEqual(await t.call('mods.accept', {job: job.job}), reviewed);
    const currentJob = await t.audit('The investigator declines the book.');
    await t.result(currentJob, {missing: [], findings: [], source_review: {verdict: 'supported', summary: 'The current declaration is preserved.', claims: [
        {quote: 'The investigator declines the book.', verdict: 'supported', reason: 'The current player input explicitly declines it.', evidence: [{file: 'current.json', quote: 'I decline the book.'}]}
    ]}});
    assert.equal((await t.call('mods.accept', {job: currentJob.job})).source_review.verdict, 'supported');
    const changedText = await t.audit('Steven Knott waits.');
    assert.notEqual(changedText.job, job.job);
    const changedRequest = JSON.parse(await readFile(join(changedText.cwd, 'request.json'), 'utf8'));
    changedRequest.input.text = 'A forged candidate.';
    await writeFile(join(changedText.cwd, 'request.json'), JSON.stringify(changedRequest));
    await t.result(changedText, emptyReview);
    await assert.rejects(t.call('mods.accept', {job: changedText.job}), e => e.details?.reason === 'mod_audit_evidence');
    await t.call('table.apply', {call_id: 't1-c1', effects: [{kind: 'time', minutes: 1}]});
    await assert.rejects(t.call('mods.accept', {job: job.job}), error => error.details?.reason === 'mod_audit_stale');
    assert.notEqual((await t.audit('Steven Knott pauses.')).job, job.job);
});

test('tampered evidence fails; disabled source auditor retains legacy audit output', async () => {
    const t = await table(), job = await t.audit('A pause.');
    await t.result(job, emptyReview);
    await chmod(join(job.cwd, 'original.json'), 0o600);
    await writeFile(join(job.cwd, 'original.json'), '{}');
    await assert.rejects(t.call('mods.accept', {job: job.job}), error => error.details?.reason === 'mod_audit_evidence');
    await t.call('table.narrate', {call_id: 't1-c1', text: 'A pause.'});
    await t.call('mods.configure', {id: 'narration-audit', enabled: false});
    await t.call('table.player_input', {text: 'I wait.'});
    const legacy = await t.audit('A pause.');
    assert.notEqual(legacy.source_review, true);
    await t.result(legacy, {missing: [], findings: []});
    assert.deepEqual(await t.call('mods.accept', {job: legacy.job}), {missing: [], findings: []});
});

test('unsupported and unclear source verdicts refuse both delivery verbs; source timeouts never fall through', async () => {
    for (const verdict of ['unsupported', 'unclear']) {
        const pi = {events: new EventEmitter(), on() {}}, result = {...emptyReview, source_review: {...emptyReview.source_review, verdict, summary: 'A material claim is not supported.'}};
        let bridge; pi.events.on('coc:mods-bridge', value => bridge = value); modsExtension(pi);
        pi.events.emit('coc:kernel-bridge', {call: async method => method === 'mods.job' ? {enabled: true, accepted: true, job: 'fixture'} : method === 'mods.accept' ? result : {effects: [], unfinished: []}});
        for (const verb of ['narrate', 'ask']) await assert.rejects(bridge.prepare(verb, {campaign: 'c1', text: 'Unsupported ownership.'}), e => e.details?.reason === 'mod_narrative_repair' && e.details.source_review.verdict === verdict);
    }
    const pi = {events: new EventEmitter(), on() {}}, cwd = await mkdtemp(join(directory, 'host-'));
    let bridge; pi.events.on('coc:mods-bridge', value => bridge = value); modsExtension(pi);
    pi.events.emit('coc:kernel-bridge', {call: async method => method === 'mods.job' ? {enabled: true, source_review: true, cwd, system_prompt: join(cwd, 'prompt.md'), job: 'fixture'} : {effects: [], unfinished: []},
        runtime: {async runTask(task) {assert.equal(task.request.tools, 'read,write,edit,bash'); return {ok: false, timedOut: true, ms: 180000};}}});
    await assert.rejects(bridge.prepare('narrate', {campaign: 'c1', text: 'Unreviewed text.'}), e => e.details?.source_review === true && e.details?.timed_out === true);
});

test('implicit prose cannot bypass a rejected explicit audit and only corrected text reaches the kernel', async t => {
    const bad = 'An invented family owns the house.', good = 'The ownership connection is not established.';
    const session = await openTable({retainAt: directory, responses: [
        fauxAssistantMessage([fauxToolCall('narrate', {text: bad})], {stopReason: 'toolUse'}),
        fauxAssistantMessage(bad),
        fauxAssistantMessage([fauxToolCall('narrate', {text: good})], {stopReason: 'toolUse'}),
        fauxAssistantMessage('Delivery wrapper.')
    ]});
    t.after(() => session.dispose());
    const audited = [];
    session.emit('coc:mods-bridge', {async after() {}, async prepare(method, payload) {
        if (method !== 'narrate') return;
        audited.push(payload.text);
        if (payload.text === bad) throw new KernelError({code: 'needs', message: 'Unsupported source claim', fix: 'Remove the invented ownership.', details: {reason: 'mod_narrative_repair'}});
    }});
    await session.session.prompt('Clarify only the known facts.'); await waitForIdle(session.session);
    assert.deepEqual(audited, [bad, bad, good]);
    const delivered = session.kernelRequests().filter(request => request.method === 'table.narrate');
    assert.ok(delivered.length); assert.ok(delivered.every(request => request.params.text === good));
    assert.ok(assistantTexts(session.session).some(text => text.includes(good)));
    assert.ok(assistantTexts(session.session).every(text => !text.includes(bad)));
});
