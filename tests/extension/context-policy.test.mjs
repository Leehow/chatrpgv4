import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {convertToLlm} from '@earendil-works/pi-coding-agent';
import {openTable, waitForIdle} from './harness.mjs';

const root = resolve(import.meta.dirname, '../..'), evidence = join(root, '.coc/playtests/bounded-context-contracts');
await mkdir(evidence, {recursive: true});
const directory = await mkdtemp(join(evidence, 'suite-'));
await writeFile(join(directory, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
await build({stdin: {contents: `export * from './extensions/table/context-policy.ts'; export {installContextPolicy} from './extensions/table/context-runtime.ts';`, resolveDir: root, sourcefile: 'context-policy-api.ts'},
    outfile: join(directory, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(directory, 'api.mjs')).href);
const binding = turn => ({version: 1, campaign: 'test-campaign', worldline: 'main', loop: 0, turn, source_revision: 'a'.repeat(64),
    memory_coverage: {committed: turn, completed: turn, gaps: 0, recent: [], older: {gaps: 0}}});
const quote = (turn, role, text) => ({turn, role, text, total_chars: Array.from(text).length, verified: true,
    read: {what: 'transcript', read: {turn, role, offset: 0, limit: 4096}}});
function group(turn, text = `Player ${turn}`, line = 'main') {
    const context = {...binding(turn), worldline: line};
    return [
        {role: 'user', content: [{type: 'text', text}], timestamp: turn * 10},
        {role: 'custom', customType: 'coc-capsule', content: JSON.stringify({turn: {number: turn}}), details: {turn, context}, timestamp: turn * 10 + 1},
        {role: 'assistant', content: [{type: 'toolCall', id: `call-${turn}`, name: 'look', arguments: {}}], timestamp: turn * 10 + 2},
        {role: 'toolResult', toolCallId: `call-${turn}`, toolName: 'look', content: [{type: 'text', text: `Machine result ${turn}`}], timestamp: turn * 10 + 3},
    ];
}
function entries(messages) {
    return messages.map((message, i) => message.role === 'custom'
        ? {type: 'custom_message', id: `entry-${i}`, customType: message.customType, content: message.content, details: message.details}
        : {type: 'message', id: `entry-${i}`, message});
}
function payloads(context, kind) {
    return context.messages.flatMap(message => (Array.isArray(message.content) ? message.content : []).flatMap(block => {
        if (block.type !== 'text') return [];
        try {const data = JSON.parse(block.text); return data?.kind === kind ? [data] : [];} catch {return [];}
    }));
}

test('closed history is bounded independently of campaign length and keeps the newest two dialogue pairs', () => {
    const quotes = Array.from({length: 400}, (_, turn) => [quote(turn, 'player', `Words ${turn}`), quote(turn, 'keeper', `Answer ${turn}`)]).flat();
    const before = structuredClone(quotes), view = api.historyView(binding(400), quotes);
    assert.ok(api.sizeOf(view) <= api.HISTORY_BYTES);
    assert.deepEqual(view.quotes.map(row => row.turn), [398, 398, 399, 399]);
    assert.deepEqual(quotes, before);
    assert.equal(view.authority, 'record_integrity_only');
    assert.equal(view.earlier_than, 398);
});

test('an oversized Unicode pair keeps both sides as explicitly ranged original prefixes', () => {
    const player = '\u{1f9ed}\u6f22e\u0301'.repeat(20000), keeper = '"\\\n'.repeat(30000);
    const originals = [quote(4, 'player', player), quote(4, 'keeper', keeper)];
    const view = api.historyView(binding(5), originals);
    assert.ok(api.sizeOf(view) <= api.HISTORY_BYTES);
    assert.deepEqual(view.quotes.map(row => row.role), ['player', 'keeper']);
    for (const row of view.quotes) {
        const original = originals.find(value => value.role === row.role);
        assert.equal(row.text, Array.from(original.text).slice(0, row.range.end).join(''));
        assert.equal(row.range.end, Array.from(row.text).length);
        assert.equal(row.truncated, row.range.end < row.total_chars);
        assert.deepEqual(row.read, original.read);
    }
});

test('history metadata has its own bound and does not invent semantic coverage', () => {
    const state = binding(100);
    state.memory_coverage = {status: 'unavailable', completed: null, gaps: null,
        recent: Array.from({length: 200}, (_, from) => ({from, to: from, note: 'x'.repeat(100)}))};
    const meta = api.metadata(state);
    assert.ok(api.sizeOf(meta) <= api.HISTORY_METADATA_BYTES);
    assert.equal(meta.memory_coverage.status, 'unavailable');
    assert.equal(meta.memory_coverage.gaps, null);
    assert.equal(state.memory_coverage.recent.length, 200, 'projection must not mutate its source');
    const hostile = api.metadata({...binding(100), worldline: 'W'.repeat(6000), memory_coverage: {status: 'x'.repeat(6000), gaps: {untrusted: 'x'.repeat(6000)}}});
    assert.ok(api.sizeOf(hostile) <= api.HISTORY_METADATA_BYTES);
    assert.equal(hostile.worldline_omitted, true);
    assert.equal(hostile.memory_coverage.gaps, null);
});

test('old machine messages leave the request while every current tool message and raw entry survives', () => {
    const messages = Array.from({length: 201}, (_, turn) => group(turn)).flat(), before = structuredClone(messages);
    const current = group(200), history = api.historyView(binding(200), [quote(199, 'keeper', 'An earlier answer.')]);
    const result = api.projectedMessages({messages, binding: binding(200), history});
    assert.equal(result.start, 800);
    assert.deepEqual(result.messages.slice(-4), current);
    assert.equal(result.messages.filter(message => message.role === 'toolResult').length, 1);
    assert.ok(api.pairedTools(result.messages));
    assert.deepEqual(messages, before);
});

test('a pending ask protects its previous whole exchange until this input is answered', () => {
    const messages = [...group(1), ...group(2), ...group(3)];
    const result = api.projectedMessages({messages, binding: binding(3), history: api.historyView(binding(3), []), answering: ['dodge', 'fight_back']});
    assert.equal(result.start, 4);
    assert.deepEqual(result.messages.slice(-8), messages.slice(4));
    assert.ok(api.pairedTools(result.messages));
});

test('worldline reset expires old deliveries and turn notes even when old turn numbers are higher', () => {
    const current = {...binding(1), worldline: 'side'}, messages = [...group(80),
        {role: 'custom', customType: 'coc-delivery', content: 'Old wrong-line delivery', details: {coc_delivery: true, turn: 80}},
        {role: 'custom', customType: 'coc-host', content: 'Old wrong-line obligation', details: {coc_host: true, scope: 'turn', campaign: 'test-campaign', turn: 80}},
        ...group(1, 'New direction', 'side')];
    const result = api.projectedMessages({messages, binding: current, history: api.historyView(current, [])});
    assert.ok(!JSON.stringify(result.messages).includes('Old wrong-line'));
    assert.equal(result.unknownBytes, 0);
    assert.deepEqual(result.messages.slice(-4), messages.slice(-4));
});

test('unknown context is retained and blocks a destructive fold instead of being guessed away', () => {
    const unknown = {role: 'custom', customType: 'external-instruction', content: 'Unknown scope', details: {}}, messages = [unknown, ...group(1), ...group(2)];
    const history = api.historyView(binding(2), []);
    const result = api.projectedMessages({messages, binding: binding(2), history});
    assert.deepEqual(result.messages[0], unknown);
    assert.equal(result.degraded, 'unclassified_messages_retained');
    assert.equal(api.foldPlan(entries(messages), binding(2), history), undefined);
});

test('missing bindings or a cut that would orphan a result leave the original request intact', () => {
    assert.equal(api.bindingOf({...binding(2), source_revision: null}), undefined);
    const messages = [...group(1), {role: 'user', content: [{type: 'text', text: 'Next'}]},
        {role: 'custom', customType: 'coc-capsule', content: '{}', details: {context: binding(2)}},
        {role: 'toolResult', toolCallId: 'call-1', content: [{type: 'text', text: 'Late result'}]}];
    const result = api.projectedMessages({messages, binding: binding(2), history: api.historyView(binding(2), [])});
    assert.equal(result.degraded, 'tool_pair_unavailable');
    assert.deepEqual(result.messages, messages);
    assert.equal(api.foldPlan(entries(messages), binding(2), {}), undefined);
    const absent = api.projectedMessages({messages, binding: binding(99), history: {}});
    assert.equal(absent.degraded, 'current_boundary_unavailable');
    assert.deepEqual(absent.messages, messages);
});

test('an arbitrarily large current input is protected, not relabeled as compressible history', () => {
    const original = 'Current declaration '.repeat(100000), messages = [...group(1), ...group(2, original)];
    const result = api.projectedMessages({messages, binding: binding(2), history: api.historyView(binding(2), [])});
    assert.equal(result.messages.findLast(message => message.role === 'user').content[0].text, original);
    assert.ok(result.protectedBytes > api.HISTORY_BYTES);
    assert.ok(api.sizeOf(api.historyView(binding(2), [])) <= api.HISTORY_BYTES);
});

test('v2 folding keeps safe user boundaries without copying v1 line archives', () => {
    const raw = entries([...group(1), ...group(2), ...group(3)]);
    raw.splice(4, 0, {type: 'compaction', id: 'old-fold', firstKeptEntryId: 'entry-0', summary: 'Old summary', details: {coc_fold: {version: 1, lines: [{who: 'keeper', text: 'old'.repeat(100000)}]}}});
    const before = structuredClone(raw), view = api.historyView(binding(3), [quote(2, 'keeper', 'Known evidence.')]);
    const plan = api.foldPlan(raw, binding(3), view);
    assert.equal(plan.firstKeptEntryId, 'entry-8');
    assert.equal(plan.details.coc_fold.version, 2);
    assert.equal(plan.details.coc_fold.lines, undefined);
    assert.ok(api.sizeOf(plan.details) < 4096);
    assert.deepEqual(raw, before);
    const nextInput = api.foldPlan(raw, binding(4), api.historyView(binding(4), []));
    assert.equal(nextInput.firstKeptEntryId, 'entry-8', 'pre-input fold keeps the last complete group, not a tool result');
});

function runtimeFixture(turn = 0, branch = [], records = []) {
    const hooks = new Map(), bus = new Map(), rows = [], state = {revision: 'a'.repeat(64), available: true, calls: 0, compacts: 0};
    const cap = () => ({turn: {number: turn, player_text: 'Input'}, recent: [], module: {title: 'Book'}, style: {floor: ['World response']},
        mods: {instructions: [{form: 'full', text: `rule-${state.revision[0]}`}]}});
    const meta = () => ({...binding(turn), source_revision: state.available ? state.revision : null, unavailable: !state.available});
    const pi = {on: (name, handler) => hooks.set(name, handler), events: {on: (name, handler) => bus.set(name, handler)}, sendMessage() {}};
    api.installContextPolicy(pi, row => rows.push(row));
    bus.get('coc:kernel-bridge')({campaign: 'test-campaign', call: async (method, params) => {
        state.calls++;
        if (method === 'table.capsule') return {...cap(), _context: meta()};
        if (params.read) {
            const record = records.find(row => row.turn === params.read.turn && row.role === params.read.role);
            const points = Array.from(record.text), offset = params.read.offset ?? 0, limit = Math.min(params.read.limit ?? 4096, 4096), end = Math.min(points.length, offset + limit);
            return {text: points.slice(offset, end).join(''), range: {offset, end}, total_chars: points.length, verified: true, _snapshot: 'fixture-snapshot',
                ...(end < points.length ? {next: {what: 'transcript', read: {...params.read, offset: end, limit}}} : {})};
        }
        return {cards: records.filter(row => row.turn >= params.turns[0] && row.turn <= params.turns[1]).map(row => ({turn: row.turn, role: row.role, chars: Array.from(row.text).length,
            read: {what: 'transcript', read: {turn: row.turn, role: row.role, offset: 0, limit: 4096}}})), _snapshot: 'fixture-snapshot'};
    }});
    bus.get('coc:capsule')({capsule: cap(), context: meta(), epoch: 'fixture-input'});
    const messages = group(turn); messages[1].details.epoch = 'fixture-input';
    const ctx = {model: {contextWindow: 1000000}, getContextUsage: () => ({percent: 1, contextWindow: 1000000}),
        sessionManager: {getBranch: () => branch}, compact: options => {state.compacts++; options.onComplete();}};
    return {hooks, bus, rows, state, messages, ctx};
}

test('known source-changing tools invalidate the cached full briefing without changing archived messages', async () => {
    const t = runtimeFixture();
    const initial = await t.hooks.get('context')({messages: t.messages}, t.ctx), count = t.state.calls;
    await t.hooks.get('context')({messages: t.messages}, t.ctx);
    assert.equal(t.state.calls, count, 'stable tool rounds reuse the prepared prefix');
    assert.equal(JSON.parse(initial.messages.find(message => message.customType === api.BRIEF_TYPE).content).instructions[0].text, 'rule-a');
    t.state.revision = 'b'.repeat(64);
    await t.hooks.get('tool_call')({toolName: 'lookup', toolCallId: 'source-read', input: {kind: 'source'}});
    await t.hooks.get('tool_result')({toolName: 'lookup', toolCallId: 'source-read'});
    const changed = await t.hooks.get('context')({messages: t.messages}, t.ctx);
    assert.equal(JSON.parse(changed.messages.find(message => message.customType === api.BRIEF_TYPE).content).instructions[0].text, 'rule-b');
    assert.equal(t.messages[1].details.context.source_revision, 'a'.repeat(64));
});

test('raw retained pressure requests persistence even when projected usage is low, once per unchanged epoch', async () => {
    const raw = [...group(0), ...group(1)]; raw[3].content[0].text = 'Old machine output '.repeat(20000);
    const t = runtimeFixture(2, entries(raw));
    await t.hooks.get('before_agent_start')({}, t.ctx);
    await t.hooks.get('before_agent_start')({}, t.ctx);
    assert.equal(t.state.compacts, 1);
    assert.ok(t.rows.some(row => row.event === 'pressure' && row.raw_pressure === true && row.token_pressure === false));
});

test('unavailable binding cancels compaction rather than falling back to a model summary', async () => {
    const t = runtimeFixture(); t.state.available = false;
    t.bus.get('coc:capsule')({capsule: {}, context: {...binding(0), source_revision: null}, epoch: 'unavailable'});
    const before = structuredClone(t.messages);
    const projected = await t.hooks.get('context')({messages: t.messages}, t.ctx);
    assert.equal(projected.messages[0].customType, api.DIAGNOSTIC_TYPE);
    assert.ok(api.sizeOf(projected.messages[0]) < 1024);
    assert.deepEqual(projected.messages.slice(1), before);
    assert.deepEqual(t.messages, before);
    const folded = await t.hooks.get('session_before_compact')({branchEntries: entries(t.messages), reason: 'overflow', preparation: {tokensBefore: 100}});
    assert.deepEqual(folded, {cancel: true});
    assert.ok(t.rows.some(row => row.reason === 'no_safe_cut' && row.capacity === 'protected_context'));
});

test('canonical loader finishes the older pair when it fits and shares space between verbose speakers', async () => {
    const records = [quote(0, 'player', 'p'.repeat(1000)), quote(0, 'keeper', 'k'.repeat(10000)),
        quote(1, 'player', 'new player'), quote(1, 'keeper', 'new keeper')];
    const older = runtimeFixture(2, [], records);
    const result = await older.hooks.get('context')({messages: older.messages}, older.ctx);
    const view = JSON.parse(result.messages.find(message => message.customType === api.HISTORY_TYPE).content);
    assert.equal(view.quotes.find(row => row.turn === 0 && row.role === 'keeper').text.length, 10000);
    assert.ok(view.quotes.every(row => !row.truncated));
    const verbose = runtimeFixture(2, [], [quote(1, 'player', 'p'.repeat(40000)), quote(1, 'keeper', 'k'.repeat(40000))]);
    const projected = await verbose.hooks.get('context')({messages: verbose.messages}, verbose.ctx);
    const pair = JSON.parse(projected.messages.find(message => message.customType === api.HISTORY_TYPE).content).quotes;
    assert.equal(pair.length, 2);
    assert.ok(pair.every(row => row.range.end > 12000 && row.truncated));
    assert.ok(Math.abs(pair[0].range.end - pair[1].range.end) <= 2048);
});

test('full craft context supplements rather than duplicates current style fields', () => {
    const full = {module: {title: 'Book'}, style: {language: 'en', axes: ['shared', 'extra'], floor: ['world responds'], directives: [{id: 'a', line: 'A'}, {id: 'b', line: 'B'}]}};
    const current = {style: {language: 'en', axes: ['shared'], floor: ['world responds'], directives: [{id: 'a', line: 'A'}]}};
    const before = structuredClone(full), result = api.briefForTurn(full, current);
    assert.deepEqual(result.style, {axes: ['extra'], directives: [{id: 'b', line: 'B'}]});
    assert.deepEqual(full, before);
    assert.equal(api.briefForTurn(full, {style: full.style}).style, undefined);
});

function keeperTurn(text) {
    return [fauxAssistantMessage([fauxToolCall('look', {})], {stopReason: 'toolUse'}),
        fauxAssistantMessage([fauxToolCall('narrate', {text})], {stopReason: 'toolUse'}), fauxAssistantMessage('Discarded post-delivery tail.')];
}

test('actual Pi outbound context has bounded canonical history and a stable brief while raw evidence remains', async t => {
    const requests = [];
    const table = await openTable({realKernel: true, campaign: 'bounded-context-request', retainAt: directory,
        env: {PI_COC_COMPACT_AT: '100'}, settings: {compaction: {enabled: false}},
        responses: [...keeperTurn('Opening original.'), ...[1, 2, 3, 4].flatMap(turn => keeperTurn(`Canonical answer ${turn}.`))]});
    t.after(() => table.dispose()); await waitForIdle(table.session, {timeoutMs: 60000});
    // Observe the final real transform result, not raw session.messages or an unused compatibility stream field.
    const runner = table.session._extensionRunner, transform = runner.emitContext.bind(runner);
    runner.emitContext = async messages => {
        const before = structuredClone(table.rawEntries());
        const result = await transform(messages);
        assert.deepEqual(table.rawEntries().slice(0, before.length), before, 'projection may append telemetry, never rewrite existing entries');
        requests.push({context: {messages: convertToLlm(result)}, branch: structuredClone(table.rawEntries())});
        return result;
    };
    for (let turn = 1; turn <= 4; turn++) {await table.session.prompt(`Player declaration ${turn}.`); await waitForIdle(table.session, {timeoutMs: 60000});}
    const last = requests.filter(request => payloads(request.context, 'historical_quotations').some(history => history.before_turn === 4));
    assert.ok(last.length >= 2, JSON.stringify({requests: requests.length,
        payloads: requests.map(request => payloads(request.context, 'historical_quotations').map(history => history.before_turn)),
        context: table.telemetry().filter(row => row.lane === 'context').map(({event, reason, turn, detail}) => ({event, reason, turn, detail})),
        errors: table.extensionErrors}));
    const first = last[0], history = payloads(first.context, 'historical_quotations')[0];
    assert.deepEqual(history.quotes.map(row => row.turn), [2, 2, 3, 3]);
    const record3 = JSON.parse(await readFile(join(table.workspace, '.coc/campaigns/bounded-context-request/turns/0003.json'), 'utf8'));
    assert.ok(history.quotes.some(row => row.role === 'keeper' && row.text === record3.rendered_text));
    assert.ok(api.sizeOf(history) <= api.HISTORY_BYTES);
    assert.equal(first.context.messages.filter(message => message.role === 'toolResult').length, 0);
    assert.ok(first.branch.some(entry => entry.type === 'message' && entry.message.role === 'user' && entry.message.content.some(block => block.text === 'Player declaration 4.')),
        'current user is persisted before its provider request');
    assert.ok(first.branch.some(entry => entry.type === 'custom_message' && entry.customType === 'coc-capsule' && entry.details.context.turn === 4),
        'current capsule is persisted before transformContext');
    const brief = JSON.stringify(payloads(first.context, 'context_brief'));
    for (const request of last) {
        assert.equal(JSON.stringify(payloads(request.context, 'context_brief')), brief);
        assert.equal(JSON.stringify(payloads(request.context, 'historical_quotations')[0]), JSON.stringify(history));
        assert.ok(api.pairedTools(request.context.messages));
        assert.ok(!JSON.stringify(request.context).includes('"_snapshot"'));
        assert.ok(!JSON.stringify(request.context).includes('"source_revision"'));
    }
    const record1 = JSON.parse(await readFile(join(table.workspace, '.coc/campaigns/bounded-context-request/turns/0001.json'), 'utf8'));
    assert.ok(table.rawEntries().some(entry => entry.type === 'custom_message' && entry.customType === 'coc-delivery' && entry.content === record1.rendered_text
        || entry.type === 'message' && entry.message.role === 'assistant' && entry.message.content.some(block => block.text === record1.rendered_text)));
    assert.ok(table.rawEntries().filter(entry => entry.type === 'message' && entry.message.role === 'toolResult').length > 4, 'the original tool evidence survives persisted folds');
    assert.equal(table.telemetry().filter(row => row.lane === 'context' && row.event === 'prepared' && row.turn === 4).length, 1);
    assert.deepEqual(table.extensionErrors, []);
});

test('context reconstruction uses readonly recall and leaves the newly opened turn untouched', async t => {
    const table = await openTable({realKernel: true, campaign: 'context-readonly-rpc', retainAt: directory,
        responses: keeperTurn('An opening to recall.'), env: {PI_COC_COMPACT_AT: '100'}});
    t.after(() => table.dispose()); await waitForIdle(table.session, {timeoutMs: 60000});
    const bridge = table.runtimeBridges().findLast(value => typeof value.call === 'function');
    const opened = await bridge.call('table.player_input', {campaign: 'context-readonly-rpc', text: 'A pending input.'});
    const path = join(table.workspace, '.coc/campaigns/context-readonly-rpc/turn.json'), before = await readFile(path, 'utf8');
    const rawRecall = await bridge.call('table.recall', {campaign: 'context-readonly-rpc', what: 'transcript', turns: [0, 0], _context_read: true});
    assert.match(rawRecall._snapshot, /^[a-f0-9]{64}$/, 'host bridge registers references without stripping its raw snapshot');
    assert.equal(await readFile(path, 'utf8'), before);
    assert.equal(opened.state, 'open');
    const epoch = 'test-rehydration-epoch';
    table.emit('coc:capsule', {campaign: 'context-readonly-rpc', capsule: opened.capsule,
        context: {...opened._context, source_revision: null, unavailable: true}, epoch});
    const incoming = [
        {role: 'user', content: [{type: 'text', text: 'A pending input.'}], timestamp: 1},
        {...api.customMessage('coc-capsule', opened.capsule), details: {turn: opened.turn, epoch,
            context: {...opened._context, source_revision: null, unavailable: true}}},
    ];
    const projected = await table.session._extensionRunner.emitContext(incoming);
    assert.ok(projected.some(message => message.customType === 'coc-history'), 'fresh rehydration can repair an unavailable binding on the same host epoch');
    assert.ok(api.bindingOf(projected.find(message => message.customType === 'coc-capsule').details.context));
    assert.equal(await readFile(path, 'utf8'), before);
});
