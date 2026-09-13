import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';
import {openTable, waitFor} from './harness.mjs';
const root = resolve(import.meta.dirname, '../..'), evidence = join(root, '.coc/playtests/memory-correction-contracts');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root, sourcefile: 'memory-correction-api.ts'}, outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href), closers = [];
after(async () => {for (const close of closers) await close();});
const wrong = {kind: 'knowledge', subject: 'Thomas Hayes', entities: ['Steven Knott'], statement: 'The house belongs to Thomas Hayes.'};
const correction = {kind: 'keeper_correction', subject: 'keeper', entities: ['Steven Knott'], statement: 'The previous ownership claim has no support and is withdrawn.'};
const ref = {subject: wrong.subject, statement: wrong.statement};
async function table() {
    const home = await mkdtemp(join(directory, 'campaign-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'correction', locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    const base = join(home, '.coc/campaigns/c1');
    const candidates = () => readFile(join(base, 'memory/candidates.jsonl'), 'utf8').then(text => text.trim().split('\n').filter(Boolean).map(JSON.parse));
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open'); await call('table.narrate', {call_id: 't0-c1', text: wrong.statement});
    let n = 0;
    const turn = async text => {n++; await call('table.player_input', {text: 'Clarify the earlier account.'}); await call('table.narrate', {call_id: `t${n}-c1`, text}); return n;};
    const submit = async (turn, values) => {const job = await call('memory.job', {turn}); return call('memory.submit', {job_id: job.job_id, candidates: values});};
    return {home, base, call, turn, submit, candidates};
}

test('a correction retires old knowledge atomically, survives replay, and accompanies explicitly recalled history', async () => {
    const t = await table(); await t.submit(0, []);
    await t.turn(wrong.statement);
    await t.submit(1, [wrong, {kind: 'player_preference', subject: 'player', statement: 'Keep speculation separate.'}]);
    await t.turn(correction.statement);
    const packet = await t.call('memory.job', {turn: 2});
    assert.ok(packet.correction_targets.some(target => target.statement === wrong.statement));
    const target = packet.correction_targets.find(target => target.statement === wrong.statement);
    const ref = {subject: target.subject, statement: target.statement};
    const before = await readFile(join(t.base, 'memory/candidates.jsonl'), 'utf8');
    await assert.rejects(t.call('memory.submit', {job_id: packet.job_id, candidates: [{...correction, corrects: [ref]}, {...correction, corrects: [{subject: 'keeper', statement: 'Unknown target'}]}]}), /not supplied/);
    assert.equal(await readFile(join(t.base, 'memory/candidates.jsonl'), 'utf8'), before);
    const params = {job_id: packet.job_id, candidates: [{...correction, entities: [], corrects: [ref]}]};
    const accepted = await t.call('memory.submit', params);
    assert.ok(accepted.superseded.includes('mem:t1-1'));
    assert.equal((await t.call('memory.submit', params)).replayed, true);
    const current = await t.call('table.recall', {what: 'memory', about: ['Steven Knott']});
    assert.equal(current.hits[0].kind, 'keeper_correction', 'correction inherits its target entity relevance');
    assert.ok(!current.hits.some(hit => hit.statement === wrong.statement));
    const past = await t.call('table.recall', {what: 'memory', about: ['Steven Knott'], include_superseded: true});
    assert.equal(past.hits.find(hit => hit.statement === wrong.statement).superseding.statement, correction.statement);
    const capsule = await t.call('table.capsule');
    assert.equal(capsule.memory[0].kind, 'keeper_correction');
    assert.equal(capsule.memory[0].status, 'candidate');
    assert.equal(capsule.memory[0].authority, 'conversation_report');
    const continuity = await t.call('table.lookup', {kind: 'continuity', anchors: ['npc: steven-knott']});
    assert.equal(continuity.hypotheses[0].turn, 1, 'real storage uses valid_from_turn, not turn');
    assert.equal(continuity.corrections[0].statement, correction.statement);
    const transcript = await t.call('table.recall', {what: 'transcript', read: {turn: 1, role: 'keeper'}});
    assert.equal(transcript.text, wrong.statement);
    assert.equal(transcript.verification_scope, 'record_integrity_only');
});

test('late extraction of an identical old report cannot resurrect a withdrawn assertion', async () => {
    const t = await table(); await t.turn(wrong.statement); await t.submit(1, [wrong]);
    await t.turn(correction.statement);
    const packet = await t.call('memory.job', {turn: 2}), target = packet.correction_targets.find(target => target.statement === wrong.statement);
    await t.submit(2, [{...correction, corrects: [{subject: target.subject, statement: target.statement}]}]);
    await t.submit(0, [wrong]);
    const rows = await t.candidates();
    assert.ok(rows.filter(row => row.statement === wrong.statement).every(row => row.status === 'superseded'));
    assert.equal(rows.find(row => row.id === 'mem:t0-1').valid_until_turn, 2);
});

test('legacy corrections get bounded reconciliation jobs; raw text and completed extraction jobs are preserved', async () => {
    const t = await table(); await t.submit(0, []); await t.turn(wrong.statement); await t.submit(1, [wrong]);
    await t.turn(correction.statement); await t.submit(2, [correction]);
    const oldJobPath = join(t.base, 'memory/jobs/extract:c1:t2.json'), oldJob = await readFile(oldJobPath, 'utf8');
    const original = (await t.candidates()).find(row => row.kind === 'keeper_correction');
    const packet = await t.call('memory.job');
    assert.equal(packet.task, 'reconcile_correction');
    assert.ok(packet.job_id.startsWith('reconcile:c1:t2-1:'));
    assert.equal(packet.correction.statement, correction.statement);
    const target = packet.correction_targets.find(target => target.statement === wrong.statement);
    const ref = {subject: target.subject, statement: target.statement};
    await t.call('memory.fail', {job_id: packet.job_id, reason: 'lane_error', detail: 'Contract failure fixture.'});
    assert.equal((await t.call('memory.job')).job_id, null, 'failed repair does not spin in the background');
    assert.equal((await t.call('memory.job', {job_id: packet.job_id})).job_id, packet.job_id);
    const params = {job_id: packet.job_id, candidates: [{...packet.correction, corrects: [ref]}]};
    await t.call('memory.submit', params);
    assert.equal((await t.call('memory.submit', params)).replayed, true);
    assert.equal(await readFile(oldJobPath, 'utf8'), oldJob);
    const repaired = (await t.candidates()).find(row => row.id === original.id);
    assert.equal(repaired.statement, original.statement); assert.deepEqual(repaired.source, original.source);
    assert.equal(repaired.correction_links_checked, true);
    assert.equal((await t.call('memory.job')).job_id, null);
});

test('the existing extraction lane transmits semantic correction targets without dropping them', async t => {
    const packet = {job_id: 'reconcile:test-camp:t2-1:0123456789ab', task: 'reconcile_correction', turn: 2,
        correction, correction_targets: [{...ref, kind: 'knowledge'}], budget: {max_candidates: 1}, instruction: 'Link the unchanged correction.'};
    const submits = [];
    const table = await openTable({retainAt: directory, env: {PI_COC_MEMORY_BACKFILL: '0'}, laneResponses: {memory: [fauxAssistantMessage(JSON.stringify({candidates: [{...correction, corrects: [ref]}]}))]}});
    t.after(() => table.dispose());
    table.emit('coc:kernel-bridge', {campaign: 'test-camp', call: async (method, params) => {
        if (method === 'memory.job') return packet;
        if (method === 'memory.submit') {submits.push(params); return {candidates: 0};}
        return {};
    }});
    table.emit('coc:turn-committed', {campaign: 'test-camp', turn: 2});
    await waitFor(() => submits.length === 1, {label: 'correction reaches kernel'});
    assert.deepEqual(submits[0].candidates[0].corrects, [ref]);
});

test('a reconciliation from another worldline cannot change the active line and has a distinct job identity', async () => {
    const t = await table(); await t.submit(0, []); await t.turn(wrong.statement); await t.submit(1, [wrong]);
    await t.turn(correction.statement); await t.submit(2, [correction]);
    const main = await t.call('memory.job');
    await t.call('table.player_input', {text: 'Consider an alternative.'});
    await t.call('table.apply', {call_id: 't3-c1', effects: [{kind: 'fork', name: 'side', mode: 'if'}]});
    await t.call('table.narrate', {call_id: 't3-c2', text: 'The alternative remains open.'});
    await t.submit(3, []);
    const before = await readFile(join(t.base, 'memory/candidates.jsonl'), 'utf8');
    await assert.rejects(t.call('memory.submit', {job_id: main.job_id, candidates: [{...main.correction, corrects: []}]}), /another worldline/);
    assert.equal(await readFile(join(t.base, 'memory/candidates.jsonl'), 'utf8'), before);
    const side = await t.call('memory.job');
    assert.equal(side.task, 'reconcile_correction'); assert.notEqual(side.job_id, main.job_id);
});
