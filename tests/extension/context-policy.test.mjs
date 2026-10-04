import {playtestScratch} from './playtest-scratch.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {convertToLlm} from './pi.mjs';
import {openTable, waitFor, waitForIdle} from './harness.mjs';
import {hostNoticeMessage} from '../../extensions/kernel/host-notices.ts';

const root = resolve(import.meta.dirname, '../..');
const directory = playtestScratch('bounded-context-contracts');
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
        ? {type: 'custom_message', id: `entry-${i}`, parentId: i ? `entry-${i - 1}` : null, timestamp: new Date(i).toISOString(),
            customType: message.customType, content: message.content, details: message.details}
        : {type: 'message', id: `entry-${i}`, parentId: i ? `entry-${i - 1}` : null, timestamp: new Date(i).toISOString(), message});
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

test('a launcher notice placed before the turn is closed noise on a healthy request, and never the fold\'s (§135.27.1.3)', () => {
    // As the kernel extension places it at session start: after turn 1 was committed, before the player's next input.
    const placed = hostNoticeMessage({notice: 'models_json_unparsable', path: '/agent/models.json', error: 'host-notice-marker'}, undefined, 1);
    const notice = {role: 'custom', customType: placed.customType, content: placed.content, details: placed.details};
    const messages = [...group(1), notice, ...group(2)];
    const history = api.historyView(binding(2), []);
    const result = api.projectedMessages({messages, binding: binding(2), history});
    assert.ok(!JSON.stringify(result.messages).includes('host-notice-marker'), 'the notice is not in the request');
    assert.ok(JSON.stringify(result.messages).includes('Player 2'), 'the search reaches the request');
    assert.equal(result.unknownBytes, 0, 'it is classified, not retained as unknown material');
    const plan = api.foldPlan(entries(messages), binding(2), history);
    assert.ok(plan, 'it does not veto the cut');
    assert.equal(plan.details.coc_fold.unclassified ?? 0, 0);
    assert.ok(!plan.summary.includes('host-notice-marker'), 'nor is its text carried into the fold');
});

test('the setup guide\'s step orders never ride a play request: they are not the Keeper\'s', () => {
    // A fresh Blood Road table (2026-10-02, turn 9): the setup step note -- "missing: occupation ... ask for what missing
    // lists, and nothing else" -- was retained as unclassified material in every play request, and the Keeper answered
    // the player by asking for an occupation.
    const step = {role: 'custom', customType: 'coc-setup-step', content: JSON.stringify({kind: 'setup_step', missing: ['occupation'],
        instruction: 'ask for what missing lists, and nothing else'}), details: {}};
    const prologue = {role: 'custom', customType: 'coc-setup-opening', content: 'West Texas, 1975. Who are you?', details: {kind: 'setup-opening'}};
    const messages = [prologue, {role: 'user', content: [{type: 'text', text: 'Daniel, a car salesman.'}]}, step, ...group(1), ...group(2)];
    const result = api.projectedMessages({messages, binding: binding(2), history: api.historyView(binding(2), [])});
    assert.ok(!JSON.stringify(result.messages).includes('missing lists'), 'the setup step note is gone');
    assert.ok(JSON.stringify(result.messages).includes('Who are you?'), 'the prologue the player was shown still rides, unclassified as before');
});

test('unknown context is retained in the request and carried verbatim into the fold, never a permanent veto', () => {
    const unknown = {role: 'custom', customType: 'external-instruction', content: 'Unknown scope', details: {}}, messages = [unknown, ...group(1), ...group(2)];
    const history = api.historyView(binding(2), []);
    const result = api.projectedMessages({messages, binding: binding(2), history});
    assert.deepEqual(result.messages[0], unknown);
    assert.equal(result.degraded, 'unclassified_messages_retained');
    // A message this policy cannot classify used to pin every future cut at index 0 forever, which
    // is what let one 106-turn session grow to a 2 MB branch (20 consecutive no_safe_cut folds).
    const plan = api.foldPlan(entries(messages), binding(2), history);
    assert.ok(plan, 'an unclassified head does not veto the cut');
    assert.equal(plan.details.coc_fold.unclassified, 1);
    const carried = JSON.parse(plan.summary).retained_unclassified;
    assert.deepEqual(carried.entries, [{customType: 'external-instruction', text: 'Unknown scope'}], 'its own text survives the fold');
    assert.ok(api.sizeOf(carried) <= api.UNCLASSIFIED_BYTES);
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
    raw.splice(4, 0, {type: 'compaction', id: 'old-fold', parentId: 'entry-3', timestamp: new Date(4).toISOString(),
        firstKeptEntryId: 'entry-0', summary: 'Old summary', details: {coc_fold: {version: 1, lines: [{who: 'keeper', text: 'old'.repeat(100000)}]}}});
    raw[5].parentId = 'old-fold';
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

test('the optional workspace rides after the current capsule and yields before any current material', () => {
    const history = api.historyView(binding(2), []);
    const workspace = api.customMessage('coc-workspace', {kind: 'coc_workspace', evidence: ['a'.repeat(200)]});
    const base = [...group(1), ...group(2)];
    const placed = api.projectedMessages({messages: base, binding: binding(2), history, workspace});
    const capsuleAt = placed.messages.findIndex(message => message.customType === 'coc-capsule');
    const workspaceAt = placed.messages.findIndex(message => message.customType === 'coc-workspace');
    const tailAt = placed.messages.findIndex(message => message.role === 'toolResult');
    assert.equal(workspaceAt, capsuleAt + 1, 'the workspace follows the current capsule');
    assert.ok(workspaceAt < tailAt, 'and precedes this turn\'s working traffic');
    assert.equal(placed.workspaceKept, true);
    // A working tail that no longer fits once the workspace joins: the workspace is omitted and
    // the tail is cut exactly as it would be without KIC — current material always wins.
    const heavy = [...base];
    heavy[7].content[0].text = 'Machine output '.repeat(3000);
    const squeezed = api.projectedMessages({messages: heavy, binding: binding(2), history, workspace, budget: 2600});
    assert.equal(squeezed.messages.filter(message => message.customType === 'coc-workspace').length, 0,
        'the workspace is omitted instead of displacing the turn\'s own traffic');
    assert.equal(squeezed.workspaceKept, undefined);
    // A degraded boundary never carries one either.
    const broken = api.projectedMessages({messages: [...group(1),
        {role: 'user', content: [{type: 'text', text: 'Next'}]},
        {role: 'custom', customType: 'coc-capsule', content: '{}', details: {context: binding(2)}},
        {role: 'toolResult', toolCallId: 'call-1', content: [{type: 'text', text: 'Late result'}]}], binding: binding(2), history, workspace});
    assert.equal(broken.degraded, 'tool_pair_unavailable');
    assert.equal(broken.messages.some(message => message.customType === 'coc-workspace'), false);
});

test('§184.2: stableFirst puts the stable sections first, then sections it does not name, then the volatile ones; nothing else changes', () => {
    const kernel = {head: 'h', turn: {number: 3, player_text: 'Input'}, where: {scene: 'office'}, historical_setting: {era: '1920s'},
        first_sight: {place: 'x'}, present: [{name: 'Arty'}], voices: [], known: {clues_here: []}, pressures: [{name: 'clock'}],
        obligations: [], director: {beat: 'b'}, situations: [], worldlines: {active: 'main'}, rulings: [], memory: [], style: {floor: ['f']},
        recent: [{turn: 2}], owed: [], warnings: [], unrecorded: [], untold: [], reading: {sections: []}, resume: {kind: 'r'},
        truncated: ['present'],
        // The kernel's own order of these two (read off a capsule), with one key neither list names in each.
        mods: {active: [], authority: 'a', expression_reference: {enabled: false}, pending_contacts: [], relationships: [], objects: [],
            providers: {}, vocabulary: {}, unregistered_equipment: [], thread: {next: [{scene: 's', locked: 'l'}]}, pacing: {}},
        known: {discovered_clues: [], clues_here: [{name: 'c'}], flags: [], investigator: {}, hunch: 'h'}};
    kernel.style.mods = 'not a section';
    const before = structuredClone(kernel), sent = api.stableFirst(kernel);
    assert.deepEqual(Object.keys(sent), ['head', 'historical_setting', 'worldlines', 'mods', 'reading', 'pressures', 'obligations', 'situations',
        'rulings', 'owed', 'unrecorded', 'untold', 'warnings', 'known', 'voices', 'style',
        'first_sight', 'resume', 'truncated',
        'where', 'present', 'director', 'memory', 'recent', 'turn']);
    // Inside mods and known, what play moves goes last; a key neither list names keeps its place between.
    assert.deepEqual(Object.keys(sent.mods), ['active', 'authority', 'providers', 'vocabulary', 'unregistered_equipment', 'relationships', 'pacing',
        'expression_reference', 'objects', 'pending_contacts', 'thread']);
    assert.deepEqual(Object.keys(sent.known), ['investigator', 'flags', 'hunch', 'clues_here', 'discovered_clues']);
    assert.deepEqual(sent, kernel, 'every key and value is kept');
    for (const key of Object.keys(kernel)) {
        if (key === 'mods' || key === 'known') for (const inner of Object.keys(kernel[key])) assert.equal(sent[key][inner], kernel[key][inner], `${key}.${inner} is the same value`);
        else assert.equal(sent[key], kernel[key], `${key} is the same value, not a copy`);
    }
    assert.deepEqual(Object.keys(sent.style), ['floor', 'mods'], 'nothing else nested is reordered');
    assert.deepEqual(kernel, before, 'the input is not mutated');
    assert.deepEqual(Object.keys(kernel), Object.keys(before), 'nor reordered');
    assert.deepEqual(Object.keys(kernel.mods), Object.keys(before.mods));
    // A mods or known that is not an object is passed through as it is.
    const odd = {known: ['clue'], mods: null};
    assert.equal(api.stableFirst(odd).known, odd.known);
    assert.equal(api.stableFirst(odd).mods, null);
    // A section the input lacks is absent, not null; an input of unnamed sections keeps its own order.
    assert.deepEqual(Object.keys(api.stableFirst({turn: {}, zeta: 1, alpha: 2, head: 'h'})), ['head', 'zeta', 'alpha', 'turn']);
    assert.deepEqual(api.stableFirst({}), {});
});

test('§184.2: capsuleFirst puts the turn\'s capsule right after the brief, then the history, then the player\'s words; without it the order is today\'s', () => {
    const history = api.historyView(binding(2), []), brief = {kind: 'context_brief', module: {title: 'Book'}};
    const host = {role: 'custom', customType: 'coc-host', content: 'Turn note', details: {}};
    const base = [...group(1), ...group(2)];
    base.splice(5, 0, host);
    const kinds = projection => projection.messages.map(message => message.customType ?? message.role);
    const legacy = api.projectedMessages({messages: base, binding: binding(2), history, brief});
    assert.deepEqual(kinds(legacy), ['coc-context-brief', 'coc-history', 'user', 'coc-host', 'coc-capsule', 'assistant', 'toolResult']);
    const hybrid = api.projectedMessages({messages: base, binding: binding(2), history, brief, capsuleFirst: true});
    assert.deepEqual(kinds(hybrid), ['coc-context-brief', 'coc-capsule', 'coc-history', 'user', 'coc-host', 'assistant', 'toolResult']);
    assert.equal(hybrid.messages[1], base[6], 'the capsule itself is moved, not rewritten');
    assert.equal(hybrid.protectedBytes, legacy.protectedBytes, 'the same material is protected');
    assert.ok(api.pairedTools(hybrid.messages));
    // The optional packets still ride after the opening and before the turn's traffic.
    const workspace = api.customMessage('coc-workspace', {kind: 'coc_workspace', evidence: ['a'.repeat(200)]});
    const prescreen = api.customMessage('coc-prescreen', {kind: 'prescreen'});
    const packed = api.projectedMessages({messages: base, binding: binding(2), history, brief, workspace, prescreen, capsuleFirst: true});
    assert.deepEqual(kinds(packed), ['coc-context-brief', 'coc-capsule', 'coc-history', 'user', 'coc-host', 'coc-workspace', 'coc-prescreen', 'assistant', 'toolResult']);
    // Unclassified material still leads; an answered ask's older exchange keeps its own order after the history.
    const unknown = {role: 'custom', customType: 'external-instruction', content: 'Unknown scope', details: {}};
    const retained = api.projectedMessages({messages: [unknown, ...base], binding: binding(2), history, brief, capsuleFirst: true});
    assert.deepEqual(kinds(retained).slice(0, 4), ['external-instruction', 'coc-context-brief', 'coc-capsule', 'coc-history']);
    const asked = api.projectedMessages({messages: [...group(1), ...group(2), ...group(3)], binding: binding(3), history, answering: ['dodge'], capsuleFirst: true});
    assert.deepEqual(kinds(asked), ['coc-capsule', 'coc-history', 'user', 'assistant', 'toolResult', 'user', 'coc-capsule', 'assistant', 'toolResult']);
    assert.equal(JSON.parse(asked.messages[0].content).turn.number, 2, 'the opening\'s capsule leads, as it ends the opening today');
});

test('a coc-workspace carrying workpad entries is the same transport-only closed noise', () => {
    const history = api.historyView(binding(2), []);
    // KIC-04: the message now also carries the Keeper's own workpad section; the policy classifies
    // by type, so a workpad-carrying copy behaves exactly like any other coc-workspace.
    const workspace = api.customMessage('coc-workspace', {kind: 'coc_workspace', evidence: ['a'.repeat(120)],
        workpad: {focus: 'the letter', entries: [{id: 'q1', kind: 'hypothesis', text: 'x'.repeat(120),
            status: 'tentative', evidence: ['npc:gardener'], turn: 1, validity: 'stale', needs_recheck: true}]}});
    const base = [...group(1), ...group(2)];
    const placed = api.projectedMessages({messages: base, binding: binding(2), history, workspace});
    assert.equal(placed.workspaceKept, true, 'it joins the request when there is room');
    const squeezed = api.projectedMessages({messages: [...base], binding: binding(2), history, workspace, budget: 900});
    assert.equal(squeezed.messages.filter(message => message.customType === 'coc-workspace').length, 0,
        'and is omitted whole when there is not, never partially injected');
    const stale = {role: 'custom', customType: 'coc-workspace', content: JSON.stringify({kind: 'coc_workspace', workpad: {entries: []}}), details: {}, timestamp: 5};
    const older = api.projectedMessages({messages: [stale, ...group(1), ...group(2)], binding: binding(2), history});
    assert.equal(older.messages.filter(message => message.customType === 'coc-workspace').length, 0,
        'an older copy is regenerated or omitted, never accumulated');
    const plan = api.foldPlan(entries([...group(1), ...group(2)]).map((entry, i) => i === 0
        ? {type: 'custom_message', id: entry.id, customType: 'coc-workspace', content: JSON.stringify({kind: 'coc_workspace', workpad: {entries: [{id: 'q1'}]}}), details: {}}
        : entry), binding(2), history);
    assert.ok(plan, 'a persisted workpad copy never vetoes the fold');
    assert.equal(plan.summary.includes('workpad'), false, 'and is dropped without riding the summary');
});

function runtimeFixture(turn = 0, branch = [], records = []) {
    const hooks = new Map(), bus = new Map(), rows = [], state = {revision: 'a'.repeat(64), available: true, calls: 0, methods: [], compacts: 0};
    const cap = () => ({turn: {number: turn, player_text: 'Input'}, recent: [], module: {title: 'Book'}, style: {floor: ['World response']},
        mods: {instructions: state.instructions ?? [{form: 'full', instruction: `rule-${state.revision[0]}`}]}});
    const meta = () => ({...binding(turn), source_revision: state.available ? state.revision : null, unavailable: !state.available});
    const pi = {on: (name, handler) => hooks.set(name, handler), events: {on: (name, handler) => bus.set(name, handler)}, sendMessage() {}};
    api.installContextPolicy(pi, row => rows.push(row));
    bus.get('coc:kernel-bridge')({campaign: 'test-campaign', call: async (method, params) => {
        state.calls++;
        state.methods.push(method);
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
    return {hooks, bus, rows, state, messages, ctx, cap};
}

test('§184.2 and §184.3 on the hook: the single-loop engine sends the capsule after the brief with its stable sections first; every request row is fingerprinted', async () => {
    const short = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
    for (const engine of ['legacy', 'hybrid-v1']) {
        const t = runtimeFixture(2);
        if (engine === 'hybrid-v1') t.bus.get('coc:loop-engine')({engine: 'hybrid-v1', prescreen: 'run'});
        const before = structuredClone(t.messages);
        const projected = await t.hooks.get('context')({messages: t.messages}, t.ctx);
        assert.deepEqual(t.messages, before, `${engine}: the session's own messages are not touched`);
        const kinds = projected.messages.map(message => message.customType ?? message.role);
        const capsule = JSON.parse(projected.messages.find(message => message.customType === 'coc-capsule').content);
        if (engine === 'legacy') {
            assert.deepEqual(kinds, [api.BRIEF_TYPE, api.HISTORY_TYPE, 'user', 'coc-capsule', 'assistant', 'toolResult'], 'legacy keeps today\'s order');
            assert.deepEqual(Object.keys(capsule), ['turn', 'recent', 'style', 'mods'], 'and the kernel\'s section order');
        } else {
            assert.deepEqual(kinds, [api.BRIEF_TYPE, 'coc-capsule', api.HISTORY_TYPE, 'user', 'assistant', 'toolResult']);
            assert.deepEqual(Object.keys(capsule), ['mods', 'style', 'recent', 'turn'], 'the stable sections first');
        }
        const row = t.rows.findLast(entry => entry.lane === 'context' && entry.event === 'request');
        assert.equal(row.at, new Date(row.at).toISOString(), `${engine}: at is an ISO time`);
        assert.match(row.system_digest, /^[a-f0-9]{12}$/);
        assert.equal(row.system_digest, short({system: '', tools: []}), 'the digest of what system_bytes measures');
        assert.deepEqual(row.segments.map(segment => segment.kind), kinds, 'one segment per outgoing message, in order');
        assert.deepEqual(row.segments.map(segment => segment.digest),
            projected.messages.map(message => short({role: message.role, customType: message.customType, content: message.content})));
        assert.deepEqual(row.segments.map(segment => segment.bytes), projected.messages.map(message => api.requestSize([message])));
        // Each segment is measured as a one-message list; the request is one list: the sums differ by the separators only.
        const total = row.segments.reduce((sum, segment) => sum + segment.bytes, 0) + row.system_bytes;
        assert.equal(total - row.request_bytes, row.segments.length - 1);
        assert.equal(row.segments_truncated, undefined);
    }
    // At most 64 segments are listed; the rest are counted.
    const t = runtimeFixture(2);
    t.bus.get('coc:loop-engine')({engine: 'hybrid-v1', prescreen: 'run'});
    const busy = [...t.messages, ...Array.from({length: 40}, (_, index) => [
        {role: 'assistant', content: [{type: 'toolCall', id: `busy-${index}`, name: 'look', arguments: {}}], timestamp: 100 + index},
        {role: 'toolResult', toolCallId: `busy-${index}`, toolName: 'look', content: [{type: 'text', text: `Busy ${index}`}], timestamp: 100 + index}]).flat()];
    const projected = await t.hooks.get('context')({messages: busy}, t.ctx);
    const row = t.rows.findLast(entry => entry.lane === 'context' && entry.event === 'request');
    assert.ok(projected.messages.length > 64);
    assert.equal(row.segments.length, 64);
    assert.equal(row.segments_truncated, projected.messages.length - 64);
});

test('known source-changing tools invalidate the cached full briefing without changing archived messages', async () => {
    const t = runtimeFixture();
    const initial = await t.hooks.get('context')({messages: t.messages}, t.ctx), count = t.state.calls;
    await t.hooks.get('context')({messages: t.messages}, t.ctx);
    assert.equal(t.state.calls, count, 'stable tool rounds reuse the prepared prefix');
    assert.equal(JSON.parse(initial.messages.find(message => message.customType === api.BRIEF_TYPE).content).instructions[0].instruction, 'rule-a');
    t.state.revision = 'b'.repeat(64);
    await t.hooks.get('tool_call')({toolName: 'lookup', toolCallId: 'source-read', input: {kind: 'source'}});
    await t.hooks.get('tool_result')({toolName: 'lookup', toolCallId: 'source-read'});
    const changed = await t.hooks.get('context')({messages: t.messages}, t.ctx);
    assert.equal(JSON.parse(changed.messages.find(message => message.customType === api.BRIEF_TYPE).content).instructions[0].instruction, 'rule-b');
    assert.equal(t.messages[1].details.context.source_revision, 'a'.repeat(64));
});

test('unchanged source binding reuses the prepared brief across input epochs', async () => {
    const t = runtimeFixture(0);
    const initial = await t.hooks.get('context')({messages: t.messages}, t.ctx);
    const first = t.rows.filter(row => row.event === 'prepared').at(-1);
    const calls = t.state.calls;
    const next = group(1);
    next[1].details.epoch = 'next-input';
    const nextCapsule = t.cap(1);
    t.bus.get('coc:capsule')({capsule: nextCapsule, context: {...binding(1), source_revision: t.state.revision}, epoch: 'next-input'});
    const projected = await t.hooks.get('context')({messages: next}, t.ctx);
    const second = t.rows.filter(row => row.event === 'prepared').at(-1);
    const brief = result => result.messages.find(message => message.customType === api.BRIEF_TYPE)?.content;
    assert.equal(brief(projected), brief(initial), 'unchanged source keeps the prepared brief across turns');
    assert.equal(first.read_calls, 0, 'the fixture starts with no prior turns to read');
    assert.equal(first.source_revision, second.source_revision);
    assert.equal(t.state.methods.filter(method => method === 'table.capsule').length,
        1, 'the prepared current brief is reused without a second capsule hydration');
    assert.ok(t.state.calls > calls, 'the next turn still reads its bounded history through the existing path');
});

test('effective Mod locks and settings refresh a retained briefing even without tool-result invalidation', async () => {
    const t = runtimeFixture();
    const entry = (version, density) => ({mod: 'narration-craft', version, settings: {density_guide: density}, form: 'full', instruction: `Craft ${version}`});
    const states = [[entry('1.3.1', 'off')], [entry('1.3.1', 'on')], [], [entry('1.4.0', 'on')]];
    for (const [index, instructions] of states.entries()) {
        t.state.instructions = instructions;
        t.bus.get('coc:capsule')({capsule: t.cap(), context: binding(0), epoch: `mod-activation-${index}`});
        const projected = await t.hooks.get('context')({messages: t.messages}, t.ctx);
        const brief = JSON.parse(projected.messages.find(message => message.customType === api.BRIEF_TYPE).content);
        assert.deepEqual(brief.instructions, instructions, 'source identity alone does not authorize stale package instructions');
    }
    assert.equal(t.state.methods.filter(method => method === 'table.capsule').length, states.length);
    const calls = t.state.methods.length;
    // The key reads package, version, settings and form (§183.3), never the row's text.
    t.bus.get('coc:capsule')({capsule: {...t.cap(), mods: {instructions: [{...states.at(-1)[0], instruction: 'Per-turn copy'}]}}, context: binding(0), epoch: 'ordinary-next-input'});
    const projected = await t.hooks.get('context')({messages: t.messages}, t.ctx);
    assert.deepEqual(JSON.parse(projected.messages.find(message => message.customType === api.BRIEF_TYPE).content).instructions, states.at(-1));
    // §103.5: a new input reads who is still untold; nothing else, so the briefing is the retained one.
    assert.deepEqual(t.state.methods.slice(calls), ['table.untold'], 'the same immutable package still reuses its full briefing');
});

test('raw retained bytes alone never compact while measured context usage is below eighty percent', async () => {
    const raw = [...group(0), ...group(1)]; raw[3].content[0].text = 'Old machine output '.repeat(20000);
    const t = runtimeFixture(2, entries(raw));
    await t.hooks.get('before_agent_start')({}, t.ctx);
    await t.hooks.get('before_agent_start')({}, t.ctx);
    assert.equal(t.state.compacts, 0);
    assert.ok(t.rows.some(row => row.event === 'raw-pressure-observed' && row.raw_pressure === true && row.token_pressure === false));
    t.state.revision = 'b'.repeat(64);
    t.bus.get('coc:capsule')({capsule: t.cap(), context: {...binding(2), source_revision: t.state.revision}, epoch: 'next-input'});
    await t.hooks.get('before_agent_start')({}, t.ctx);
    assert.equal(t.state.compacts, 0, 'a new snapshot cannot turn raw bytes into a compaction trigger');
});

test('the default boundary waits below eighty percent and compacts at eighty percent', async () => {
    const t = runtimeFixture(2, entries([...group(0), ...group(1)]));
    t.ctx.getContextUsage = () => ({percent: 79.9, contextWindow: 1000000});
    await t.hooks.get('before_agent_start')({}, t.ctx);
    assert.equal(t.state.compacts, 0);
    t.ctx.getContextUsage = () => ({percent: 80, contextWindow: 1000000});
    await t.hooks.get('before_agent_start')({}, t.ctx);
    assert.equal(t.state.compacts, 1);
    assert.ok(t.rows.some(row => row.event === 'pressure' && row.percent === 80 && row.token_pressure === true));
});

test('unavailable binding cancels compaction rather than falling back to a model summary', async () => {
    const t = runtimeFixture(); t.state.available = false;
    t.bus.get('coc:capsule')({capsule: {}, context: {...binding(0), source_revision: null}, epoch: 'unavailable'});
    const before = structuredClone(t.messages);
    const projected = await t.hooks.get('context')({messages: t.messages}, t.ctx);
    assert.equal(projected.messages[0].customType, api.DIAGNOSTIC_TYPE);
    assert.ok(api.sizeOf(projected.messages[0]) < 1024);
    // §184.3: the degraded request row is fingerprinted like any other.
    const degraded = t.rows.findLast(row => row.lane === 'context' && row.event === 'request');
    assert.equal(degraded.reason, 'context_binding_unavailable');
    assert.ok(!Number.isNaN(Date.parse(degraded.at)) && degraded.at === new Date(degraded.at).toISOString());
    assert.match(degraded.system_digest, /^[a-f0-9]{12}$/);
    assert.deepEqual(degraded.segments.map(segment => segment.kind), [api.DIAGNOSTIC_TYPE, 'user', 'coc-capsule', 'assistant', 'toolResult']);
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
    // §184.3: every request row carries its time and its fingerprints. This table runs the legacy engine, so a prepared
    // request leads with the brief and the history, as before §184.2.
    await waitFor(() => table.telemetry().filter(row => row.lane === 'context' && row.event === 'request' && row.turn === 4).length >= 2,
        {label: 'the turn 4 request rows'});
    const rows = table.telemetry().filter(row => row.lane === 'context' && row.event === 'request');
    for (const row of rows) {
        assert.equal(row.at, new Date(row.at).toISOString(), 'at is an ISO time');
        assert.match(row.system_digest, /^[a-f0-9]{12}$/);
        assert.ok(row.segments.length > 0 && row.segments.length <= 64);
        assert.ok(row.segments.every(segment => typeof segment.kind === 'string' && Number.isSafeInteger(segment.bytes) && /^[a-f0-9]{12}$/.test(segment.digest)));
        if (!row.reason) assert.deepEqual(row.segments.slice(0, 2).map(segment => segment.kind), [api.BRIEF_TYPE, api.HISTORY_TYPE]);
        if (row.segments_truncated) continue;
        const total = row.segments.reduce((sum, segment) => sum + segment.bytes, 0) + row.system_bytes;
        assert.equal(total - row.request_bytes, row.segments.length - 1, 'the segments and the system message make up the request');
    }
    assert.equal(new Set(rows.filter(row => row.turn === 4).map(row => row.system_digest)).size, 1, 'one system prompt within a turn');
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
