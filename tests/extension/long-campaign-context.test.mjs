/**
 * The request ceiling of a long campaign (contract §19.2).
 *
 * These cases exist because a real 106-turn table reached 417k/500k on a build that already
 * carried the bounded-context policy. Two things had gone wrong and both are measured here:
 * the persisted fold had stopped cutting (20 consecutive `no_safe_cut`, branch at 2 MB), and
 * every failure path of the request projection handed that whole branch to the provider.
 *
 * Everything is measured, never asserted against a constant: each case compares what the table
 * actually stored with what the policy actually emitted.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, waitFor, waitForIdle} from './harness.mjs';

const root = resolve(import.meta.dirname, '../..'), evidence = join(root, '.coc/playtests/long-campaign-context');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents: `export * from './extensions/table/context-policy.ts';`, resolveDir: root, sourcefile: 'context-policy-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);

/** One Keeper turn on the real path: a tool call, a delivery, then a discarded tail. */
const keeperTurn = text => [fauxAssistantMessage([fauxToolCall('look', {})], {stopReason: 'toolUse'}),
    fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'}), fauxAssistantMessage('Discarded post-delivery tail.')];
/** A turn that keeps working before it delivers, so its own tool traffic is what grows. */
const busyTurn = (text, steps) => [...Array.from({length: steps}, () => fauxAssistantMessage([fauxToolCall('look', {})], {stopReason: 'toolUse'})),
    fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'}), fauxAssistantMessage('Discarded post-delivery tail.')];
/** Long enough that a handful of turns puts the stored branch well past a small ceiling. */
const long = turn => `第 ${turn} 回合的叙述。` + '这是一段足够长的守秘人正文，用来把会话分支推过预算。'.repeat(120);
/** The messages the branch holds right now, exactly as the fold and the projection see them. */
const branchMessages = table => table.rawEntries().map(entry => api.entryMessage(entry)).filter(Boolean);
const outbound = table => {
    const runner = table.session._extensionRunner, transform = runner.emitContext.bind(runner), requests = [];
    runner.emitContext = async messages => {
        const result = await transform(messages);
        requests.push({messages: result, bytes: api.sizeOf(result), branchBytes: api.sizeOf(branchMessages(table))});
        return result;
    };
    return requests;
};

test('campaign length never reaches the provider: the branch outgrows the ceiling while every request stays under it', async t => {
    const ceiling = 160 * 1024, turns = 6;
    const table = await openTable({realKernel: true, campaign: 'long-campaign-ceiling', retainAt: directory,
        env: {PI_COC_COMPACT_AT: '100', PI_COC_REQUEST_BYTES: String(ceiling)}, settings: {compaction: {enabled: false}},
        responses: [...keeperTurn(long(0)), ...Array.from({length: turns}, (_, turn) => keeperTurn(long(turn + 1))).flat()]});
    t.after(() => table.dispose());
    await waitForIdle(table.session, {timeoutMs: 60000});
    const requests = outbound(table);
    for (let turn = 1; turn <= turns; turn++) {
        await table.session.prompt(`玩家第 ${turn} 次行动。`);
        await waitForIdle(table.session, {timeoutMs: 60000});
    }
    assert.ok(requests.length >= turns, `every turn made a request: ${requests.length}`);
    // Measured, not assumed: the stored branch really did grow past the ceiling.
    const stored = api.sizeOf(branchMessages(table));
    assert.ok(stored > ceiling, `the branch outgrew the ceiling: ${stored} > ${ceiling}`);
    const largest = Math.max(...requests.map(request => request.bytes));
    assert.ok(largest <= ceiling, `the largest request stayed under the ceiling: ${largest} <= ${ceiling}`);
    // M1 freezes a measured request-size distribution as a broad comparison interval: the existing
    // bounded path carries a real brief/history payload, while no percentile may cross its ceiling.
    const rows = table.telemetry().filter(row => row.lane === 'context' && row.event === 'request');
    assert.ok(rows.length >= turns, `request telemetry covers the run: ${rows.length}`);
    const sizes = rows.map(row => row.request_bytes).sort((a, b) => a - b);
    const percentile = fraction => sizes[Math.min(sizes.length - 1, Math.floor((sizes.length - 1) * fraction))];
    assert.ok(percentile(0.5) >= 8 * 1024, `baseline p50 remains a non-empty bounded request: ${percentile(0.5)}`);
    assert.ok(percentile(0.95) <= ceiling, `baseline p95 stays under the configured ceiling: ${percentile(0.95)} <= ${ceiling}`);
    assert.ok(rows.every(row => row.ceiling_bytes === ceiling), 'telemetry preserves the configured request ceiling');
    // The ceiling is a ceiling, not a coincidence of a short branch: growth stopped reaching it.
    const grew = requests.at(-1).branchBytes - requests[0].branchBytes;
    assert.ok(grew > 0, 'the branch kept growing across the run');
    assert.ok(requests.at(-1).bytes - requests[0].bytes < grew, 'request size did not track branch growth');
    for (const request of requests) assert.ok(api.pairedTools(request.messages), 'every emitted request keeps its tool pairs');
    assert.deepEqual(table.extensionErrors, []);

    // The older material is reachable through recall, not lost with the messages that were cut.
    const request = requests.at(-1), text = JSON.stringify(request.messages);
    assert.ok(!text.includes(long(1)), 'turn 1 prose is no longer carried in the request');
    const bridge = table.runtimeBridges().findLast(value => typeof value.call === 'function');
    const listed = await bridge.call('table.recall', {campaign: 'long-campaign-ceiling', what: 'transcript', turns: [1, 1]});
    const card = listed.cards.find(row => row.role === 'keeper');
    assert.ok(card?.read, 'the cut turn still has a paging reference');
    let recalled = '';
    for (let page = {...card.read}; page;) {
        const result = await bridge.call('table.recall', {campaign: 'long-campaign-ceiling', ...page});
        recalled += result.text;
        page = result.next ? {...result.next} : undefined;
    }
    const record = JSON.parse(await readFile(join(table.workspace, '.coc/campaigns/long-campaign-ceiling/turns/0001.json'), 'utf8'));
    assert.equal(recalled, record.rendered_text, 'paging returns the original turn 1 text verbatim');
});

test('a turn the policy cannot prepare is bounded, not answered with the whole stored branch', async t => {
    const ceiling = 96 * 1024;
    const table = await openTable({realKernel: true, campaign: 'long-campaign-degraded', retainAt: directory,
        env: {PI_COC_COMPACT_AT: '100', PI_COC_REQUEST_BYTES: String(ceiling)}, settings: {compaction: {enabled: false}},
        responses: [...keeperTurn(long(0)), ...Array.from({length: 4}, (_, turn) => keeperTurn(long(turn + 1))).flat()]});
    t.after(() => table.dispose());
    await waitForIdle(table.session, {timeoutMs: 60000});
    for (let turn = 1; turn <= 4; turn++) {
        await table.session.prompt(`玩家第 ${turn} 次行动。`);
        await waitForIdle(table.session, {timeoutMs: 60000});
    }
    const messages = branchMessages(table), stored = api.sizeOf(messages);
    assert.ok(stored > ceiling, `the branch is larger than the ceiling before the degraded turn: ${stored} > ${ceiling}`);
    // The live failure: the kernel bridge is gone, so no capsule and no history can be prepared.
    // This is the exact shape that sent 415,127 tokens on 2026-09-16T00:14:35Z.
    table.emit('coc:kernel-bridge', {campaign: 'long-campaign-degraded'});
    const projected = await table.session._extensionRunner.emitContext(messages);
    assert.ok(api.sizeOf(projected) <= ceiling, `a degraded request is still under the ceiling: ${api.sizeOf(projected)} <= ${ceiling}`);
    assert.ok(api.sizeOf(projected) < stored, 'the degraded request is smaller than the branch it came from');
    assert.equal(projected[0].customType, api.DIAGNOSTIC_TYPE, 'the Keeper is told the context was reduced');
    assert.ok(api.pairedTools(projected), 'the bounded fallback keeps its tool pairs');
    // `record` appends its JSONL line without awaiting, so wait for the row rather than race it.
    await waitFor(() => table.telemetry().some(entry => entry.lane === 'context' && entry.reason === 'kernel_bridge_unavailable'),
        {label: 'the degraded request row'});
    const row = table.telemetry().findLast(entry => entry.lane === 'context' && entry.event === 'request');
    assert.equal(row.reason, 'kernel_bridge_unavailable');
    assert.equal(row.ceiling_bytes, ceiling);
    assert.ok(row.dropped_tail > 0, 'the telemetry names how much the ceiling dropped');
    assert.ok(row.request_bytes <= ceiling);
});

test('a turn with more tool traffic than the ceiling allows keeps the newest evidence and drops the oldest', async t => {
    // Well above the incompressible floor (the book briefing, the bounded history and this turn's
    // own input) so the squeeze can only land on the tool traffic the turn keeps accumulating.
    const ceiling = 160 * 1024;
    const table = await openTable({realKernel: true, campaign: 'long-campaign-squeeze', retainAt: directory,
        env: {PI_COC_COMPACT_AT: '100', PI_COC_REQUEST_BYTES: String(ceiling)}, settings: {compaction: {enabled: false}},
        responses: [...keeperTurn(long(0)), ...Array.from({length: 3}, (_, turn) => busyTurn(long(turn + 1), 14)).flat()]});
    t.after(() => table.dispose());
    await waitForIdle(table.session, {timeoutMs: 60000});
    const requests = outbound(table);
    for (let turn = 1; turn <= 3; turn++) {
        await table.session.prompt(`玩家第 ${turn} 次行动。`);
        await waitForIdle(table.session, {timeoutMs: 60000});
    }
    await waitFor(() => table.telemetry().some(entry => entry.lane === 'context' && entry.dropped_tail > 0),
        {label: 'a squeezed request row'});
    const rows = table.telemetry().filter(entry => entry.lane === 'context' && entry.event === 'request');
    assert.ok(rows.every(row => row.ceiling_bytes === ceiling), 'the configured ceiling is the one in force');
    const squeezed = rows.filter(row => row.dropped_tail > 0);
    assert.ok(squeezed.length, 'the ceiling actually bound on this run');
    assert.ok(squeezed.every(row => row.reason === 'request_ceiling_reached'));
    const worst = Math.max(...rows.map(row => row.request_bytes));
    assert.ok(worst <= ceiling, `no request crossed the ceiling: ${worst} <= ${ceiling}`);
    for (const request of requests) assert.ok(api.pairedTools(request.messages));
    assert.deepEqual(table.extensionErrors, []);
});

test('a ceiling below the incompressible floor is reported, and never costs the player their own words', async t => {
    // The floor is the book briefing plus the bounded history plus this turn's own input; all three
    // are bounded on their own and none of them grows with campaign length. When a configured
    // ceiling sits below that floor the policy must say so rather than quietly emit the whole turn.
    const ceiling = 8 * 1024;
    const table = await openTable({realKernel: true, campaign: 'long-campaign-runaway', retainAt: directory,
        env: {PI_COC_COMPACT_AT: '100', PI_COC_REQUEST_BYTES: String(ceiling)}, settings: {compaction: {enabled: false}},
        responses: [...keeperTurn(long(0)), ...keeperTurn(long(1))]});
    t.after(() => table.dispose());
    await waitForIdle(table.session, {timeoutMs: 60000});
    const requests = outbound(table);
    const declaration = '玩家说了一段很长的话。'.repeat(400);
    await table.session.prompt(declaration);
    await waitForIdle(table.session, {timeoutMs: 60000});
    assert.ok(requests.length, 'the turn made at least one request');
    for (const request of requests) {
        const user = request.messages.findLast(message => message.role === 'user');
        assert.ok(JSON.stringify(user).includes(declaration), 'the player declaration is never truncated by the ceiling');
        assert.ok(api.pairedTools(request.messages));
    }
    await waitFor(() => table.telemetry().some(entry => entry.lane === 'context' && entry.capacity === 'request_ceiling_exceeded'),
        {label: 'the reported overflow row'});
    const rows = table.telemetry().filter(entry => entry.lane === 'context' && entry.event === 'request');
    assert.ok(rows.every(row => row.ceiling_bytes === ceiling), 'the configured ceiling is the one in force');
    assert.ok(rows.some(row => row.capacity === 'request_ceiling_exceeded'),
        'an unavoidable overflow is reported, not hidden');
    assert.deepEqual(table.extensionErrors, []);
});

test('an unclassified entry at the head of a real branch no longer vetoes every future fold', async t => {
    const table = await openTable({realKernel: true, campaign: 'long-campaign-fold', retainAt: directory,
        env: {PI_COC_COMPACT_AT: '100'}, settings: {compaction: {enabled: false}},
        responses: [...keeperTurn(long(0)), ...Array.from({length: 3}, (_, turn) => keeperTurn(long(turn + 1))).flat()]});
    t.after(() => table.dispose());
    await waitForIdle(table.session, {timeoutMs: 60000});
    for (let turn = 1; turn <= 3; turn++) {
        await table.session.prompt(`玩家第 ${turn} 次行动。`);
        await waitForIdle(table.session, {timeoutMs: 60000});
    }
    const entries = table.rawEntries().filter(entry => api.entryMessage(entry));
    const messages = entries.map(entry => api.entryMessage(entry));
    let binding;
    for (let index = messages.length - 1; index >= 0 && !binding; index--) {
        const message = messages[index];
        if (message.role === 'custom' && message.customType === 'coc-capsule') binding = api.bindingOf((message.details ?? {}).context);
    }
    assert.ok(binding, 'a real capsule binding was persisted');
    const history = api.historyView(binding, []);
    assert.ok(api.foldPlan(entries, binding, history), 'a real branch can be folded');
    // `extensions/onboarding` opens every campaign with exactly this entry, and no release of the
    // policy has ever classified it. While it vetoed the cut, no fold could ever run again.
    const opening = {type: 'custom_message', id: 'setup-opening-entry', customType: 'coc-setup-opening',
        content: '秋日的波士顿，一间租务办公室里纸张堆得老高。', details: {kind: 'setup-opening'}};
    const plan = api.foldPlan([opening, ...entries], binding, history);
    assert.ok(plan, 'an unclassified opening does not veto the cut');
    assert.ok(plan.folded > 1, 'the fold still cuts the older turns');
    assert.equal(plan.details.coc_fold.unclassified, 1);
    const carried = JSON.parse(plan.summary).retained_unclassified;
    assert.equal(carried.entries.at(-1).text, opening.content, 'the unclassified entry rides in the summary rather than vanishing');
    assert.ok(api.sizeOf(carried) <= api.UNCLASSIFIED_BYTES, 'what it carries is itself bounded');
});
