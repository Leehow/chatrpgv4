import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {continuityArtifactErrors, normalizeContinuityArtifact, AUDIT_LIMITS} from '../../kernel-ts/mods/audit-result.ts';
import {AuditBudget, reviewUnavailable} from '../../extensions/mods/audit-budget.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import auditSubmit from '../../extensions/mods/audit-submit.ts';
import {auditEvidenceView} from '../../extensions/mods/audit-evidence.ts';
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

test('focused evidence lookup finds objects and sheet weapons without exposing an id-only interface', () => {
    const files = {'world.json': {objects: {definitions: {definition1: {name: 'Crowbar', category: 'item'}},
        instances: {instance1: {name: 'Old crowbar', owner: {kind: 'scene', name: 'Cellar'}, definition: 'definition1', state: {condition: 'intact'}}}}},
        'current.json': {party: [{name: 'Investigator', weapons: [{name: 'Folding knife', skill: 'Fighting (Brawl)', damage: '1D4'}]}]},
        'history.json': [{turn: 1, player_text: 'Keep the book here.', rendered_text: 'The book stays.', world: {private: 'not repeated'}}]};
    const object = auditEvidenceView('objects', files, ['crowbar']);
    assert.equal(object.entries[0].name, 'Old crowbar'); assert.equal(object.entries[0].owner.name, 'Cellar');
    assert.equal(auditEvidenceView('objects', files, ['Folding knife']).entries[0].kind, 'sheet_weapon');
    const missing = auditEvidenceView('objects', files, ['Unknown tool']);
    assert.equal(missing.matching_count, 0); assert.ok(missing.known_names.includes('Old crowbar'));
    const history = auditEvidenceView('history', files, [], [1]);
    assert.equal(history.entries[0].player_text, 'Keep the book here.'); assert.equal(history.entries[0].world, undefined);
});

test('artifact validation collects exact locations and accepts compact passing reports', () => {
    assert.deepEqual(continuityArtifactErrors(pass(), 'A plausible new ledger cutoff.', {}), []);
    const bad = conflict(); bad.continuity_review.conflicts.push({...bad.continuity_review.conflicts[0], evidence: [{file: 'request.json', quote: 'wrong file'}]});
    const errors = continuityArtifactErrors(bad, 'His childhood was described.', {'memory.json': ['A different retained statement.']});
    assert.deepEqual(errors.map(e => e.path), ['/continuity_review/conflicts/0/evidence/0/quote', '/continuity_review/conflicts/1/evidence/0/file']);
    assert.equal(errors[0].file, 'memory.json');
    assert.deepEqual(continuityArtifactErrors(conflict(), 'His childhood was described.', {'memory.json': ['The childhood account was withdrawn.']}), []);
    const falsePass = conflict(); falsePass.continuity_review.verdict = 'pass';
    assert.ok(continuityArtifactErrors(falsePass, 'His childhood was described.', {'memory.json': ['The childhood account was withdrawn.']}).some(e => e.path.endsWith('/verdict')));
    const candidate = 'You arrive at the Athens guesthouse and stay there for two days.';
    const locationFiles = {'context.json': {location_authority: {requires_review: true, current_scene: 'commission-briefing', move_receipts: [],
        rule: 'Time does not move the party.'}}};
    const invalidLocation = {missing: [], findings: [], continuity_review: {verdict: 'pass', summary: 'Allowed.', conflicts: [],
        location_review: {verdict: 'pass', current_scene: 'commission-briefing', asserted_elsewhere: ['You arrive at the Athens guesthouse'], basis: 'current_scene'}}};
    assert.ok(continuityArtifactErrors(invalidLocation, candidate, locationFiles).some(e => e.path === '/continuity_review/location_review/verdict'));
    const revisedLocation = {missing: [], findings: [], continuity_review: {verdict: 'revise', summary: 'No move was settled.',
        conflicts: [{claim: 'You arrive at the Athens guesthouse', reason: 'No move receipt exists.', evidence: [{file: 'context.json', quote: 'Time does not move the party.'}]}],
        location_review: {verdict: 'revise', current_scene: 'commission-briefing', asserted_elsewhere: ['You arrive at the Athens guesthouse'], basis: 'none'}}};
    assert.deepEqual(continuityArtifactErrors(revisedLocation, candidate, locationFiles), []);
    const locusFiles = {'context.json': {scene_commitment: {requires_review: true, active: {handle: 'office', name: 'Office'}, moves: [],
        promotion_test: 'Promote only an ongoing gameplay locus.'}}};
    const unsupportedLocus = {missing: [], findings: [], continuity_review: {verdict: 'pass', summary: 'Allowed.', conflicts: [],
        locus_review: {verdict: 'pass', mode: 'new_locus', locus: 'Athens guesthouse', claim: 'You arrive at the Athens guesthouse', basis: 'none'}}};
    assert.ok(continuityArtifactErrors(unsupportedLocus, candidate, locusFiles).some(e => e.path === '/continuity_review/locus_review/verdict'));
    const revisedLocus = {missing: [], findings: [], continuity_review: {verdict: 'revise', summary: 'A new ongoing locus is unsupported.', conflicts: [],
        locus_review: {verdict: 'revise', mode: 'new_locus', locus: 'Athens guesthouse', claim: 'You arrive at the Athens guesthouse', basis: 'none'}}};
    assert.deepEqual(continuityArtifactErrors(revisedLocus, candidate, locusFiles), []);
    const contradictoryAggregate = structuredClone(revisedLocus); contradictoryAggregate.continuity_review.verdict = 'pass';
    assert.equal(normalizeContinuityArtifact(contradictoryAggregate).continuity_review.verdict, 'revise');
    const transition = {missing: [], findings: [], continuity_review: {verdict: 'pass', summary: 'Travel remains transitional.', conflicts: [],
        locus_review: {verdict: 'pass', mode: 'transition', locus: null, claim: null, basis: 'active_scene'}}};
    assert.deepEqual(continuityArtifactErrors(transition, candidate, locusFiles), []);
    const repairedOptional = structuredClone(transition); repairedOptional.continuity_review.reentry_review = null;
    assert.deepEqual(normalizeContinuityArtifact(repairedOptional, locusFiles), transition);

    const bridgeText = 'The marked report connects the repeated tragedies to Corbitt.';
    const causal = {causal_reentry: {mode: 'introduce_evidence', thread: {name: 'house-haunted', claim: 'Corbitt caused the tragedies.'}, known: [],
        bridge: {clue: 'old-report', relation: 'supports', source_handouts: ['old-report-handout']},
        authority: {current_scene: 'athens', clue_here: false}}, current_input: 'Show me what reached Athens.', receipts: []};
    assert.ok(continuityArtifactErrors(pass(), bridgeText, {'context.json': causal}).some(error => error.path === '/continuity_review/reentry_review'));
    const refused = {missing: [], findings: [{reason: 'The bridge is absent.', fix: 'Settle old-report and state its causal relation.'}],
        continuity_review: {verdict: 'revise', summary: 'The causal bridge is missing.', conflicts: [],
            reentry_review: {verdict: 'revise', basis: 'none', quote: null, clue: null, relation: null}}};
    assert.deepEqual(continuityArtifactErrors(refused, bridgeText, {'context.json': causal}), []);
    const receiptContext = {...causal, causal_reentry: {...causal.causal_reentry,
        authority: {current_scene: 'athens', clue_here: true}}, receipts: [{kind: 'clue', clue: 'old-report'}]};
    const realized = {missing: [], findings: [], continuity_review: {verdict: 'pass', summary: 'The bridge landed.', conflicts: [],
        reentry_review: {verdict: 'pass', basis: 'bridge_receipt', quote: bridgeText, clue: 'old-report', relation: 'supports'}}};
    assert.deepEqual(continuityArtifactErrors(realized, bridgeText, {'context.json': receiptContext}), []);
    assert.ok(continuityArtifactErrors(realized, bridgeText, {'context.json': {...causal,
        receipts: [{kind: 'handout', handout: 'old-report-handout'}]}}).some(error => error.path === '/continuity_review/reentry_review/basis'));
    const waiting = {missing: [], findings: [], continuity_review: {verdict: 'pass', summary: 'The retained work is pending.', conflicts: [],
        reentry_review: {verdict: 'defer', basis: 'preparation_wait', quote: 'Preparation is pending.', clue: null, relation: null}}};
    assert.deepEqual(continuityArtifactErrors(waiting, 'Preparation is pending.', {'context.json': {...causal, preparation_wait: {kind: 'adaptation', name: 'athens'}}}), []);
    const offered = {missing: [], findings: [], continuity_review: {verdict: 'pass',
        summary: 'The carrier is within reach and the choice remains open.', conflicts: [],
        reentry_review: {verdict: 'defer', basis: 'bridge_offer', quote: bridgeText, clue: 'old-report', relation: 'supports'}}};
    const offeredContext = {...causal, causal_reentry: {...causal.causal_reentry,
        authority: {current_scene: 'athens', clue_here: true}}};
    assert.deepEqual(continuityArtifactErrors(offered, bridgeText, {'context.json': offeredContext}), []);
    assert.ok(continuityArtifactErrors(offered, bridgeText, {'context.json': causal})
        .some(error => error.path === '/continuity_review/reentry_review/basis'));
    assert.ok(continuityArtifactErrors(offered, bridgeText, {'context.json': {...offeredContext,
        receipts: [{kind: 'handout', handout: 'old-report-handout'}]}})
        .some(error => error.path === '/continuity_review/reentry_review/basis'));
    const clarificationContext = {causal_reentry: {mode: 'clarify_known',
        thread: {name: 'house-haunted', claim: 'Corbitt caused the tragedies.'},
        known: [{name: 'old-report', relation: 'supports', summary: 'Repeated tragedies share one address.'}]},
        current_input: 'I turn to an unrelated catalogue.', receipts: []};
    const clarified = {missing: [], findings: [], continuity_review: {verdict: 'pass',
        summary: 'The acquired report was connected to the present stakes.', conflicts: [],
        reentry_review: {verdict: 'pass', basis: 'acquired_clarification', quote: bridgeText, clue: 'old-report', relation: 'supports'}}};
    assert.deepEqual(continuityArtifactErrors(clarified, bridgeText, {'context.json': clarificationContext}), []);
    const reversed = structuredClone(clarified); reversed.continuity_review.reentry_review.relation = 'contradicts';
    assert.ok(continuityArtifactErrors(reversed, bridgeText, {'context.json': clarificationContext})
        .some(error => error.path === '/continuity_review/reentry_review/relation'));
    assert.ok(continuityArtifactErrors(offered, bridgeText, {'context.json': clarificationContext})
        .some(error => error.path === '/continuity_review/reentry_review/basis'));
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
    const turnPath = join(home, '.coc/campaigns/c1/turn.json'), cursor = JSON.parse(await readFile(turnPath, 'utf8'));
    cursor.capsule.mods.thread.reentry = {assessed_turn: 1, status: 'misframed', frame: 'The records are unrelated.',
        thread: {name: 'house-haunted-by-corbitt', claim: 'The tragedies share Corbitt as their cause.', importance: 'critical'},
        known: [{name: 'globe-unpublished-story', relation: 'supports', summary: 'Prior tenants suffered linked tragedies.', turns: [1]}],
        bridge: {clue: 'globe-unpublished-story', relation: 'supports', fact: 'Prior tenants suffered linked tragedies.',
            source_handouts: ['globe-unpublished-1918'], knowledgeable_people: [], source_scenes: ['newspaper-morgue'],
            delivery: 'Settle the existing clue and state its causal relation.'},
        available: {here: [], handed: [], next: [], fallback: null}, action: 'Realize this bridge before ordinary pacing.'};
    await writeFile(turnPath, JSON.stringify(cursor));
    const job = await call('mods.job', {role: 'audit', input: {text: 'The old register ends before the inheritance.',
        preparation_wait: {kind: 'adaptation', name: 'athens-pension'}}});
    assert.equal(job.continuity_review, true); assert.equal(job.source_review, undefined);
    const focused = JSON.parse(await readFile(join(job.cwd, 'context.json'), 'utf8'));
    assert.equal(focused.clock.minutes, 0);
    assert.equal(typeof focused.clock.at, 'string');
    assert.equal(focused.scene.handle, 'commission-briefing');
    assert.equal(focused.scene_commitment.active.handle, 'commission-briefing');
    assert.deepEqual(focused.scene_commitment.moves, []);
    assert.match(focused.scene_commitment.promotion_test, /ongoing locus for subsequent player action or durable location-bound state/);
    assert.equal(focused.causal_reentry.bridge.clue, 'globe-unpublished-story');
    assert.equal(focused.causal_reentry.authority.clue_here, false);
    assert.deepEqual(focused.preparation_wait, {kind: 'adaptation', name: 'athens-pension'});
    assert.ok(focused.recent_history[0].truncated); assert.ok((await readFile(join(job.cwd, 'history.json'), 'utf8')).length > 3000);
    assert.equal(focused.recent_history[1].player_text, 'Leave the book with the witness; do not take it.');
    assert.ok(focused.coverage.full_evidence_files.includes('history.json'));
    await writeFile(join(job.cwd, 'result.json'), JSON.stringify({...pass(), continuity_review: {...pass().continuity_review,
        locus_review: {verdict: 'pass', mode: 'same_locus', locus: null, claim: null, basis: 'active_scene'},
        reentry_review: {verdict: 'defer', basis: 'preparation_wait', quote: 'The old register ends before the inheritance.', clue: null, relation: null}}}));
    assert.equal((await call('mods.accept', {job: job.job})).continuity_review.verdict, 'pass');
    assert.equal((await call('mods.accept', {job: job.job})).continuity_review.verdict, 'pass');
    const changed = await call('mods.job', {role: 'audit', input: {text: 'Another compatible sentence.'}});
    assert.notEqual(changed.job, job.job); assert.equal(changed.review_scope, job.review_scope);
    assert.equal((await call('mods.review.status')).paused, false);
    const paused = new AuditBudget(job.review_scope);
    try { assert.throws(() => paused.fail('Fixture review remains paused'), /paused/); } finally { paused.close(); }
    assert.equal((await call('mods.review.status')).paused, true);
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

/**
 * Contract §38: a paused review must not also end the campaign. Retained live evidence
 * `midgame-bridge-live-21` turn 3 stayed `acting` forever because the review approved nothing and the
 * kernel then refused every further player utterance.
 */
test('a turn left undelivered under a paused review is released on the next player input', async t => {
    const session = await openTable({retainAt: directory, responses: [
        fauxAssistantMessage([fauxToolCall('look', {focus: 'scene'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage([fauxToolCall('narrate', {text: 'Unapproved draft.'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage([fauxToolCall('look', {focus: 'scene'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage('Should never be consumed.')]});
    t.after(() => session.dispose());
    session.emit('coc:mods-bridge', {async after() {}, async prepare(method) {
        if (method === 'narrate') throw reviewUnavailable('Fixture budget exhausted');
    }});
    await session.session.prompt('I listen at the door.'); await waitForIdle(session.session);
    await session.session.prompt('I give up on the door.'); await waitForIdle(session.session);
    const inputs = session.kernelRequests().filter(request => request.method === 'table.player_input');
    assert.equal(inputs.length, 2);
    assert.equal(inputs[0].params.release, undefined);
    assert.equal(inputs[1].params.release, 'stranded');
});

test('an undelivered turn whose review still works is not released', async t => {
    const session = await openTable({retainAt: directory, responses: [
        fauxAssistantMessage([fauxToolCall('look', {focus: 'scene'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage([fauxToolCall('narrate', {text: 'A draft the kernel refuses.'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage([fauxToolCall('look', {focus: 'scene'})], {stopReason: 'toolUse'}),
        fauxAssistantMessage('Should never be consumed.')]});
    t.after(() => session.dispose());
    session.emit('coc:mods-bridge', {async after() {}, async prepare(method) {
        // Not a review pause: the Keeper may still repair and deliver, so the turn is not stranded.
        if (method === 'narrate') throw new KernelError({code: 'needs', message: 'The turn floor is not met',
            details: {reason: 'turn_floor'}});
    }});
    await session.session.prompt('I listen at the door.'); await waitForIdle(session.session);
    await session.session.prompt('I keep listening.'); await waitForIdle(session.session);
    const inputs = session.kernelRequests().filter(request => request.method === 'table.player_input');
    assert.equal(inputs.length, 2);
    assert.ok(inputs.every(input => input.params.release === undefined));
});
