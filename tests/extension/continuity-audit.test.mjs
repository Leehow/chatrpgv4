import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {continuityArtifactErrors, AUDIT_LIMITS} from '../../kernel-ts/mods/audit-result.ts';
import {AuditBudget, reviewUnavailable} from '../../extensions/mods/audit-budget.ts';
import auditSubmit from '../../extensions/mods/audit-submit.ts';
import modsExtension from '../../extensions/mods/index.ts';
import {EventEmitter} from 'node:events';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, assistantTexts, waitForIdle} from './harness.mjs';

const root = resolve(import.meta.dirname, '../..'), base = join(root, '.coc/playtests/continuity-audit-contracts');
await mkdir(base, {recursive: true});
const directory = await mkdtemp(join(base, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
const pass = () => ({missing: [], findings: [], continuity_review: {verdict: 'pass', summary: 'Compatible campaign detail.', conflicts: []}});
const conflict = () => ({missing: [], findings: [], continuity_review: {verdict: 'revise', summary: 'The prior statement was withdrawn.', conflicts: [
    {claim: 'His childhood was described.', reason: 'The retained correction withdrew this account.', evidence: [{file: 'memory.json', quote: 'The childhood account was withdrawn.'}]}]}});

test('artifact validation collects exact locations and accepts compact passing reports', () => {
    assert.deepEqual(continuityArtifactErrors(pass(), 'A plausible new ledger cutoff.', {}), []);
    const bad = conflict(); bad.continuity_review.conflicts.push({...bad.continuity_review.conflicts[0], evidence: [{file: 'request.json', quote: 'wrong file'}]});
    const errors = continuityArtifactErrors(bad, 'His childhood was described.', {'memory.json': ['A different retained statement.']});
    assert.deepEqual(errors.map(e => e.path), ['/continuity_review/conflicts/0/evidence/0/quote', '/continuity_review/conflicts/1/evidence/0/file']);
    assert.equal(errors[0].file, 'memory.json');
    assert.deepEqual(continuityArtifactErrors(conflict(), 'His childhood was described.', {'memory.json': ['The childhood account was withdrawn.']}), []);
    const falsePass = conflict(); falsePass.continuity_review.verdict = 'pass';
    assert.ok(continuityArtifactErrors(falsePass, 'His childhood was described.', {'memory.json': ['The childhood account was withdrawn.']}).some(e => e.path.endsWith('/verdict')));
});

test('budget spans revisions, prevents concurrent owners and retains linked explicit retries', async () => {
    const scope = await mkdtemp(join(directory, 'budget-')), limits = {...AUDIT_LIMITS, time_ms: 50000, max_requests: 3, per_review: 2};
    const a = new AuditBudget(scope, 'input-a', limits);
    assert.throws(() => new AuditBudget(scope, 'input-a', limits), /paused/);
    assert.equal(a.start().max_requests, 2); a.finish(1, 1); a.verdict('draft-a', 'revise'); a.close();
    const b = new AuditBudget(scope, undefined, limits);
    assert.equal(b.start().max_artifact_repairs, 0); b.finish(2, 0);
    assert.throws(() => b.verdict('draft-b', 'revise'), /paused/); b.close();
    assert.throws(() => new AuditBudget(scope, 'input-a', limits), /paused/);
    const next = new AuditBudget(scope, 'input-b', limits); next.close();
    const state = JSON.parse(await readFile(join(scope, 'review-budget.json'), 'utf8'));
    assert.equal(state.requests, 0); assert.equal(state.previous.length, 1); assert.equal(state.previous[0].requests, 3);
});

test('interrupted reservations are never silently refunded after restart', async () => {
    const scope = await mkdtemp(join(directory, 'interrupted-'));
    const a = new AuditBudget(scope); a.start(); a.close();
    assert.throws(() => new AuditBudget(scope), /paused/);
    const saved = JSON.parse(await readFile(join(scope, 'review-budget.json'), 'utf8'));
    assert.equal(saved.requests, 6); assert.equal(saved.ms, 30000); assert.ok(saved.active);
    const explicit = new AuditBudget(scope, 'player-retry'); explicit.close();
    const next = JSON.parse(await readFile(join(scope, 'review-budget.json'), 'utf8'));
    assert.equal(next.previous[0].requests, 6); assert.equal(next.requests, 0);
});

test('a private session cannot exceed its reservation even with shared allowance left', async () => {
    const scope = await mkdtemp(join(directory, 'over-reservation-'));
    const budget = new AuditBudget(scope); budget.start();
    try { assert.throws(() => budget.finish(7, 0), /paused/); } finally { budget.close(); }
    assert.throws(() => new AuditBudget(scope), /paused/);
});

test('checked submission repairs all errors in place and terminates only after valid submission', async () => {
    const cwd = await mkdtemp(join(directory, 'submit-'));
    await writeFile(join(cwd, 'request.json'), JSON.stringify({input: {text: 'His childhood was described.'}, continuity_review: {files: ['memory.json']}}));
    await writeFile(join(cwd, 'memory.json'), JSON.stringify(['The childhood account was withdrawn.']));
    await writeFile(join(cwd, 'control.json'), JSON.stringify({max_requests: 2, max_artifact_repairs: 1, status_file: 'status.json'}));
    const hooks = {}, reminders = [], priorCwd = process.cwd(), priorControl = process.env.PI_COC_AUDIT_CONTROL; let tool;
    try {
        process.chdir(cwd); process.env.PI_COC_AUDIT_CONTROL = join(cwd, 'control.json');
        auditSubmit({on(name, fn) {hooks[name] = fn;}, registerTool(def) {tool = def;}, sendMessage(message) {reminders.push(message);}});
    } finally { process.chdir(priorCwd); if (priorControl === undefined) delete process.env.PI_COC_AUDIT_CONTROL; else process.env.PI_COC_AUDIT_CONTROL = priorControl; }
    hooks.before_provider_request();
    hooks.agent_end(); hooks.agent_end();
    assert.equal(reminders.length, 1);
    assert.match(reminders[0].content, /submit_audit/);
    const bad = conflict(); bad.continuity_review.conflicts[0].evidence[0].quote = 'Not an exact quote.';
    const rejected = await tool.execute('one', {result: bad});
    assert.equal(rejected.isError, true); assert.equal(rejected.terminate, undefined); assert.equal(rejected.details.errors[0].path, '/continuity_review/conflicts/0/evidence/0/quote');
    hooks.before_provider_request();
    const accepted = await tool.execute('two', {result: conflict()});
    assert.equal(accepted.terminate, true); assert.equal(accepted.details.kind, 'audit_submission');
    assert.equal(JSON.parse(await readFile(join(cwd, 'result.json'), 'utf8')).continuity_review.verdict, 'revise');
    let aborted = false;
    assert.throws(() => hooks.before_provider_request({}, {abort() {aborted = true;}}), /model-call limit/);
    assert.equal(aborted, true);
});

await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts'; export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts'; export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root, sourcefile: 'continuity-audit-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href), closers = [];
after(async () => {for (const close of closers) await close();});
test('new jobs expose focused context with full fallback, bind accepted reports, and preserve old versions', async () => {
    const home = await mkdtemp(join(directory, 'kernel-'));
    const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'continuity-review', locks: api.nativeAdvisoryLocks(),
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context); closers.push(() => runtime.close());
    const call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.open');
    await call('table.narrate', {call_id: 't0-c1', text: 'Knott introduces the commission. ' + 'Full retained earlier delivery. '.repeat(120)});
    await call('table.player_input', {text: 'Leave the book with the witness; do not take it.'});
    await call('table.narrate', {call_id: 't1-c1', text: 'The witness keeps the book.'});
    await call('table.player_input', {text: 'Clarify the ownership history.'});
    const job = await call('mods.job', {role: 'audit', input: {text: 'The old register ends before the inheritance.'}});
    assert.equal(job.continuity_review, true); assert.equal(job.source_review, undefined);
    const focused = JSON.parse(await readFile(join(job.cwd, 'context.json'), 'utf8'));
    assert.equal(focused.clock.minutes, 0);
    assert.equal(typeof focused.clock.at, 'string');
    assert.ok(focused.recent_history[0].truncated); assert.ok((await readFile(join(job.cwd, 'history.json'), 'utf8')).length > 3000);
    assert.equal(focused.recent_history[1].player_text, 'Leave the book with the witness; do not take it.');
    assert.ok(focused.coverage.full_evidence_files.includes('history.json'));
    await writeFile(join(job.cwd, 'result.json'), JSON.stringify(pass()));
    assert.equal((await call('mods.accept', {job: job.job})).continuity_review.verdict, 'pass');
    assert.equal((await call('mods.accept', {job: job.job})).continuity_review.verdict, 'pass');
    const changed = await call('mods.job', {role: 'audit', input: {text: 'Another compatible sentence.'}});
    assert.notEqual(changed.job, job.job); assert.equal(changed.review_scope, job.review_scope);
    await call('table.apply', {call_id: 't2-c1', effects: [{kind: 'time', minutes: 1, why: 'A chosen wait'}]});
    await assert.rejects(call('mods.accept', {job: job.job}), e => e.details?.reason === 'mod_audit_stale');
});

for (const revoked of [false, true]) test(`a ${revoked ? 'revoked' : 'missing'} submission never becomes an accepted report`, async () => {
    const cwd = await mkdtemp(join(directory, 'host-')); let bridge;
    const pi = {events: new EventEmitter(), on() {}};
    pi.events.on('coc:mods-bridge', value => bridge = value); modsExtension(pi);
    pi.events.emit('coc:kernel-bridge', {call: async method => method === 'mods.job' ? {enabled: true, continuity_review: true,
        cwd, job: 'draft', review_scope: join(cwd, 'budget'), limits: AUDIT_LIMITS, focus: {}, system_prompt: join(cwd, 'prompt.md')} : {},
        runtime: {async runTask(task) {
            if (revoked) {
                const control = JSON.parse(await readFile(join(cwd, task.request.audit.control), 'utf8'));
                await writeFile(join(cwd, control.status_file), JSON.stringify({requests: 1, artifact_repairs: 0, submitted: true, unavailable: 'The budget was exhausted before submission'}));
                task.request.onEvent({type: 'tool_execution_end', toolName: 'submit_audit', result: {details: {kind: 'audit_submission'}}});
            }
            return {ok: true, ms: 1};
        }}});
    await assert.rejects(bridge.prepare('narrate', {campaign: 'c1', text: 'A draft.'}), e => e.details?.reason === 'continuity_review_unavailable');
});

for (const implicit of [false, true]) test(`unavailable ${implicit ? 'implicit' : 'explicit'} delivery stops instead of steering another audit`, async t => {
    const responses = implicit ? [fauxAssistantMessage([fauxToolCall('look', {focus: 'scene'})], {stopReason: 'toolUse'}), fauxAssistantMessage('Unapproved draft.')]
        : [fauxAssistantMessage([fauxToolCall('narrate', {text: 'Unapproved draft.'})], {stopReason: 'toolUse'})];
    const session = await openTable({retainAt: directory, responses: [...responses, fauxAssistantMessage('Should never be consumed.')]});
    t.after(() => session.dispose()); let audits = 0;
    session.emit('coc:mods-bridge', {async after() {}, async prepare(method) {
        if (method === 'narrate') {audits++; throw reviewUnavailable('Fixture budget exhausted');}
    }});
    await session.session.prompt('Continue.'); await waitForIdle(session.session);
    assert.equal(audits, 1); assert.equal(session.kernelRequests().filter(r => r.method === 'table.narrate').length, 0);
    assert.ok(assistantTexts(session.session).every(text => !text.includes('Unapproved') && !text.includes('Should never')));
});
