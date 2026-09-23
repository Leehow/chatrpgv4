import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {SessionManager} from './pi.mjs';
import {fauxAssistantMessage} from '@earendil-works/pi-ai';

const root = resolve(import.meta.dirname, '../..');
const cache = join(root, 'node_modules/.cache');
await mkdir(cache, {recursive: true});
const directory = await mkdtemp(join(cache, 'pi-context-edits-'));
after(() => rm(directory, {recursive: true, force: true}));
await build({entryPoints: [join(root, 'extensions/table/context-policy.ts')], outfile: join(directory, 'policy.mjs'),
    bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const {foldPlan, historyView, projectedMessages, UNCLASSIFIED_BYTES, sizeOf} = await import(pathToFileURL(join(directory, 'policy.mjs')).href);
const binding = turn => ({version: 1, campaign: 'context-edits', worldline: 'main', loop: 0, turn,
    source_revision: 'a'.repeat(64)});
const user = text => ({role: 'user', content: text, timestamp: 1});
function group(session, turn) {
    const first = session.appendMessage(user(`Player ${turn}`));
    session.appendCustomMessageEntry('coc-capsule', JSON.stringify({turn: {number: turn}}), false, {context: binding(turn)});
    return first;
}
function fixture() {
    const session = SessionManager.inMemory(root);
    group(session, 1);
    const notice = session.appendCustomMessageEntry('external-instruction', 'Original notice', false, {scope: 'external'});
    const current = group(session, 2);
    return {session, notice, current};
}
function planFor(session) {
    const branch = session.getBranch(), before = structuredClone(branch);
    const plan = foldPlan(branch, binding(2), historyView(binding(2), []));
    assert.deepEqual(branch, before, 'fold planning must not modify raw evidence');
    return plan;
}
function compact(session, plan) {
    assert.ok(plan);
    const before = structuredClone(session.getEntries());
    session.appendCompaction(plan.summary, plan.firstKeptEntryId, 100, plan.details, true);
    assert.deepEqual(session.getEntries().slice(0, before.length), before, 'compaction only appends');
    return session.buildSessionContext().messages;
}
function carriedText(plan) {
    return JSON.parse(plan.summary).retained_unclassified?.entries.map(entry => entry.text);
}

test('Pi omissions remove assistant/tool traffic and folded notices without rewriting evidence', () => {
    const {session, notice, current} = fixture();
    const assistant = session.appendMessage(fauxAssistantMessage([
        {type: 'text', text: 'Omitted attempt'}, {type: 'toolCall', id: 'omitted-call', name: 'look', arguments: {}},
    ], {stopReason: 'toolUse'}));
    const tool = session.appendMessage({role: 'toolResult', toolCallId: 'omitted-call', toolName: 'look',
        content: [{type: 'text', text: 'Omitted result'}], isError: false, timestamp: 2});
    const before = structuredClone(session.getEntries());
    for (const id of [notice, assistant, tool]) session.appendContextEdit(id, null);
    const plan = planFor(session);
    assert.equal(plan.firstKeptEntryId, current);
    assert.equal(plan.folded, session.getBranch().findIndex(entry => entry.id === current));
    assert.equal(carriedText(plan), undefined, 'omitted custom content must not ride the summary');
    const canonical = session.buildSessionContext().messages;
    const outbound = projectedMessages({messages: canonical, binding: binding(2), history: historyView(binding(2), [])});
    const folded = compact(session, plan);
    for (const text of ['Original notice', 'Omitted attempt', 'Omitted result']) {
        assert.equal(JSON.stringify(outbound.messages).includes(text), false);
        assert.equal(JSON.stringify(folded).includes(text), false);
    }
    assert.deepEqual(session.getEntries().slice(0, before.length), before);
});

test('replacement content, not raw custom content, is carried into a fold', () => {
    const {session, notice, current} = fixture();
    const original = structuredClone(session.getEntry(notice));
    session.appendContextEdit(notice, {content: 'Replacement notice'});
    const plan = planFor(session);
    assert.equal(plan.firstKeptEntryId, current);
    assert.deepEqual(carriedText(plan), ['Replacement notice']);
    const projected = session.buildSessionProjection().entries.find(entry => entry.sourceEntry.id === notice);
    assert.deepEqual(projected.sourceEntry, original);
    assert.equal(projected.messages[0].content, 'Replacement notice');
    assert.deepEqual(projected.messages[0].details, original.details);
    const folded = compact(session, plan);
    assert.equal(JSON.stringify(folded).includes('Original notice'), false);
    assert.equal(JSON.stringify(folded).includes('Replacement notice'), true);
});

test('latest edit wins across replacements, omission, and restoration', () => {
    const {session, notice} = fixture();
    session.appendContextEdit(notice, {content: 'First replacement'});
    assert.deepEqual(carriedText(planFor(session)), ['First replacement']);
    session.appendContextEdit(notice, null);
    assert.equal(carriedText(planFor(session)), undefined);
    session.appendContextEdit(notice, {content: [{type: 'text', text: 'Latest replacement'}]});
    const plan = planFor(session);
    assert.deepEqual(carriedText(plan), ['Latest replacement']);
    assert.equal(JSON.stringify(compact(session, plan)).includes('First replacement'), false);
    assert.equal(session.getEntry(notice).content, 'Original notice');
});

test('edits apply only on their branch and in branch order', () => {
    const {session, notice} = fixture();
    const originalLeaf = session.getLeafId();
    const editLeaf = session.appendContextEdit(notice, {content: 'Edited branch notice'});
    assert.deepEqual(carriedText(planFor(session)), ['Edited branch notice']);
    session.branch(originalLeaf);
    assert.deepEqual(carriedText(planFor(session)), ['Original notice']);
    session.appendContextEdit(notice, null);
    assert.equal(carriedText(planFor(session)), undefined);
    session.branch(editLeaf);
    assert.deepEqual(carriedText(planFor(session)), ['Edited branch notice']);
});

test('untouched messages keep their IDs, metadata, order, and fold boundary', () => {
    const {session, notice, current} = fixture();
    const assistant = session.appendMessage(fauxAssistantMessage('Untouched response'));
    const before = structuredClone(session.getEntries());
    const plan = planFor(session);
    assert.equal(plan.firstKeptEntryId, current);
    assert.deepEqual(carriedText(plan), ['Original notice']);
    const folded = compact(session, plan);
    assert.deepEqual(folded.at(-1), before.find(entry => entry.id === assistant).message);
    assert.deepEqual(session.getEntry(notice), before.find(entry => entry.id === notice));
    assert.deepEqual(session.buildSessionProjection().entries.filter(entry => entry.messages.some(message => message.role === 'user'))
        .map(entry => entry.sourceEntry.id), [current]);
});

test('fold pairing uses edited assistant content and never restores an omitted call', () => {
    for (const replacement of [null, {content: 'The call was replaced'}]) {
        const {session} = fixture();
        const assistant = session.appendMessage(fauxAssistantMessage([
            {type: 'toolCall', id: 'call', name: 'look', arguments: {}},
        ], {stopReason: 'toolUse'}));
        session.appendMessage({role: 'toolResult', toolCallId: 'call', toolName: 'look',
            content: [{type: 'text', text: 'Result'}], isError: false, timestamp: 2});
        session.appendContextEdit(assistant, replacement);
        assert.equal(planFor(session), undefined, 'an omitted/replaced call cannot authorize retaining its orphan result');
        if (replacement) assert.deepEqual(session.buildSessionContext().messages.find(message => message.role === 'assistant').content,
            [{type: 'text', text: replacement.content}], 'Pi normalizes assistant string replacements');
    }
});

test('successful later folds carry untouched and replaced notices without accumulating dialogue summaries', () => {
    for (const replacement of [undefined, 'Replacement notice']) {
        const {session, notice} = fixture();
        if (replacement) session.appendContextEdit(notice, {content: replacement});
        const firstHistory = {...historyView(binding(2), []), old_dialogue: 'Old dialogue must not accumulate'};
        const first = foldPlan(session.getBranch(), binding(2), firstHistory);
        compact(session, first);
        session.appendCustomMessageEntry('external-instruction', 'New notice', false);
        const current = group(session, 3);
        const before = structuredClone(session.getEntries());
        const next = foldPlan(session.getBranch(), binding(3), historyView(binding(3), []));
        assert.equal(next.firstKeptEntryId, current);
        assert.deepEqual(carriedText(next), [replacement ?? 'Original notice', 'New notice']);
        assert.equal(next.summary.includes('Old dialogue must not accumulate'), false);
        if (replacement) assert.equal(next.summary.includes('Original notice'), false);
        compact(session, next);
        assert.deepEqual(session.getEntries().slice(0, before.length), before);
    }
});

test('a merged carry remains bounded and stable on a no-progress fold', () => {
    const {session, notice} = fixture();
    session.appendContextEdit(notice, {content: 'Earlier notice '.repeat(700)});
    compact(session, planFor(session));
    session.appendCustomMessageEntry('external-instruction', 'Recent notice '.repeat(700), false);
    group(session, 3);
    const history = historyView(binding(3), []);
    const next = foldPlan(session.getBranch(), binding(3), history);
    const carried = JSON.parse(next.summary).retained_unclassified;
    assert.ok(sizeOf(carried) <= UNCLASSIFIED_BYTES);
    assert.equal(carried.truncated, true);
    assert.deepEqual(carried.entries.map(entry => entry.text), ['Recent notice '.repeat(700)]);
    compact(session, next);
    const before = structuredClone(session.getEntries());
    const repeated = foldPlan(session.getBranch(), binding(3), history);
    assert.equal(repeated.firstKeptEntryId, next.firstKeptEntryId);
    assert.equal(repeated.summary, next.summary, 'runtime can recognize the same plan key');
    assert.equal(repeated.folded, 0);
    assert.deepEqual(session.getEntries(), before);
});

test('only an unchanged prior fold can supply a zero-progress plan', () => {
    const {session} = fixture();
    const first = planFor(session);
    compact(session, first);
    const repeated = planFor(session);
    assert.equal(repeated.firstKeptEntryId, first.firstKeptEntryId);
    assert.equal(repeated.summary, first.summary);
    assert.equal(repeated.folded, 0);
    assert.equal(foldPlan(session.getBranch(), binding(2), {...historyView(binding(2), []), changed: true}), undefined);
    const fresh = SessionManager.inMemory(root);
    group(fresh, 2);
    assert.equal(planFor(fresh), undefined, 'no prior fold means no safe cut at zero');
});

test('Pi system checkpoints stay out of folded quotations and retain their tools', () => {
    const session = SessionManager.inMemory(root);
    const checkpoint = {role: 'system', content: 'Private system checkpoint',
        toolsAdded: [{name: 'look', description: 'Inspect the table', parameters: {type: 'object', properties: {}}}], timestamp: 1};
    const system = session.appendMessage(checkpoint);
    group(session, 1);
    const current = group(session, 2);
    const plan = planFor(session);
    assert.equal(plan.firstKeptEntryId, current);
    assert.equal(carriedText(plan), undefined, 'system prompts are not historical quotations');
    assert.equal(plan.details.coc_fold.unclassified, undefined);
    assert.equal(plan.summary.includes(checkpoint.content), false);
    const folded = compact(session, plan);
    assert.equal(folded[0].role, 'system');
    assert.equal(folded[0].content, checkpoint.content);
    assert.deepEqual(folded[0].toolsAdded, checkpoint.toolsAdded);
    assert.deepEqual(session.getEntry(system).message, checkpoint, 'raw checkpoint evidence remains unchanged');
    assert.equal(session.getLeafEntry().systemMessage.content, checkpoint.content, 'Pi owns the compaction checkpoint');
});

test('repeated folding does not resurrect raw notices outside the canonical retained range', () => {
    const {session, notice} = fixture();
    session.appendContextEdit(notice, null);
    compact(session, planFor(session));
    const next = group(session, 3);
    const branch = session.getBranch(), before = structuredClone(branch);
    const plan = foldPlan(branch, binding(3), historyView(binding(3), []));
    assert.equal(plan.firstKeptEntryId, next);
    assert.equal(carriedText(plan), undefined);
    assert.equal(JSON.stringify(compact(session, plan)).includes('Original notice'), false);
    assert.deepEqual(branch, before);
});
