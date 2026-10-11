/**
 * Contract §209.13: the request the context owner hands Pi is always bounded, also when the package
 * detail it must add does not fit.
 *
 * The live failure (934 GUI table, kernel turn 18, the closing input's last inference): the bounded
 * projection had filled its budget with the turn's own tool traffic, the full-view discovery packet
 * (57,386 B) no longer fit beside it, and `extensions/table/context-runtime.ts` threw
 * `mod_discovery_request_capacity`. Pi's `ExtensionRunner.emitContext` catches a `context` handler's
 * error and keeps the messages that handler was given, so the whole stored branch since the last fold
 * went out: 1,910,857 B projected, 1,731,240 B on the wire, 380,388 input tokens, and no
 * `context/request` row. These cases run the installed hooks through that real vendored runner.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = resolve(import.meta.dirname, '../..'), temp = await mkdtemp(join(tmpdir(), 'context-request-capacity-'));
await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
await build({stdin: {contents: [
    "export {installContextPolicy} from './extensions/table/context-runtime.ts';",
    "export {CLERK_TYPE, DIAGNOSTIC_TYPE, pairedTools} from './extensions/table/context-policy.ts';",
].join('\n'), resolveDir: root}, outfile: join(temp, 'api.mjs'), bundle: true, packages: 'external',
    format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temp, 'api.mjs')).href);
// The Pi the product runs: the vendored build, never the installed package (tests/extension/pi.mjs).
const pi = await import(pathToFileURL(join(root, 'build/node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href);
test.after(() => rm(temp, {recursive: true, force: true}));

const CEILING = 64 * 1024;
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
/** What the provider adapter is handed: Pi's own conversion, host-only details stripped. */
const providerBytes = messages => bytes(pi.convertToLlm(messages).map(({details: _private, ...visible}) => visible));
const filler = (label, size) => `${label} `.padEnd(size, 'x');

function table({capsuleBytes = 4096, sectionBytes = 8192, readSections} = {}) {
    const binding = {version: 1, campaign: 'table', worldline: 'main', loop: 0, turn: 6, source_revision: 'a'.repeat(64)};
    const section = (index, heading, trigger) => ({key: `pacing@2.0.0#${index}`, heading, gates_open: true, topics: [], gates: [],
        triggers: [trigger], applicability: {what: `Rules for ${heading}.`, not_for: 'Unrelated events.', examples: []}});
    const capsule = {turn: {number: 6, player_text: 'Leave the library as it closes.'}, recent: [], module: {title: 'Fixture'}, style: {},
        where: {scene: 'library', clock: {at: '1920-10-12T18:00'}, description: filler('scene', capsuleBytes)}, present: [],
        mods: {instructions: [{mod: 'pacing', version: '2.0.0', form: 'indexed', index_contract_version: 2, instruction: 'Core rules.',
            sections: [section(0, 'Time', 'before_apply:time'), section(1, 'Money', 'before_apply:cash')]}]}};
    const sectionText = key => filler(`Immutable ${key}`, sectionBytes);
    const hooks = new Map(), bus = new Map(), rows = [];
    const host = {on: (name, handler) => hooks.set(name, handler),
        events: {on: (name, handler) => bus.set(name, handler), emit: (name, value) => bus.get(name)?.(value)}, sendMessage() {}};
    api.installContextPolicy(host, row => rows.push(row));
    return {binding, capsule, hooks, bus, rows, sectionText, readSections: readSections ?? (async keys => ({sections: keys.map(key => ({key, text: sectionText(key)}))}))};
}

/** The stored branch: five closed turns, then the current turn's long run of tool traffic. */
function branch({binding, capsule}, {workingPairs = 14} = {}) {
    const messages = [{role: 'system', content: 'Keeper core.', timestamp: 0}];
    for (let turn = 1; turn < binding.turn; turn++) {
        const old = {...binding, turn};
        messages.push({role: 'user', content: [{type: 'text', text: `Earlier input ${turn}.`}], timestamp: turn * 10},
            {role: 'custom', customType: 'coc-capsule', content: JSON.stringify({...capsule, turn: {number: turn}}), details: {context: old, epoch: `input-${turn}`}, timestamp: turn * 10 + 1},
            {role: 'assistant', content: [{type: 'text', text: filler(`Delivered reply ${turn}`, 24 * 1024)}], stopReason: 'stop', timestamp: turn * 10 + 2});
    }
    messages.push({role: 'user', content: [{type: 'text', text: capsule.turn.player_text}], timestamp: 100},
        {role: 'custom', customType: 'coc-capsule', content: JSON.stringify(capsule), details: {context: binding, epoch: 'input-6'}, timestamp: 101},
        {role: 'custom', customType: api.CLERK_TYPE, content: JSON.stringify({kind: 'single_loop_step', purpose: 'compose', reason: 'arrival'}),
            details: {coc_host: true, turn: binding.turn}, timestamp: 102});
    for (let step = 0; step < workingPairs; step++) {
        const id = `call-${step}`;
        messages.push({role: 'assistant', content: [{type: 'toolCall', id, name: 'look', arguments: {focus: 'scene'}}], stopReason: 'toolUse', timestamp: 110 + step * 2},
            {role: 'toolResult', toolCallId: id, toolName: 'look', content: [{type: 'text', text: filler(`Scene read ${step}`, 5 * 1024)}], isError: false, timestamp: 111 + step * 2});
    }
    return messages;
}

/** One context round on the real vendored runner, the way `transformContext` calls it before every inference. */
async function infer(fixture, messages, errors) {
    const sessionManager = {getBranch: () => [], buildSessionProjection: () => ({messages})};
    const runner = new pi.ExtensionRunner([{path: 'table-context', handlers: new Map([
        ['context', [fixture.hooks.get('context')]],
        ['context_with_system', [fixture.hooks.get('context_with_system')]],
        ['before_provider_request', [fixture.hooks.get('before_provider_request')]],
    ])}], pi.createExtensionRuntime(), root, sessionManager, {});
    runner.bindCore({}, {getModel: () => ({contextWindow: 500000}), abort() {}});
    runner.onError(error => errors.push(error));
    const projected = await runner.emitContext(messages);
    await runner.emitBeforeProviderRequest({messages: pi.convertToLlm(projected)});
    return projected;
}

function open(fixture) {
    fixture.bus.get('coc:kernel-bridge')({campaign: 'table', call: async (method, args) => {
        if (method === 'table.capsule') return {...structuredClone(fixture.capsule), _context: fixture.binding};
        if (method === 'table.untold') return {};
        if (method === 'mods.sections') return fixture.readSections(args.keys);
        return {cards: [], _snapshot: 'fixture'};
    }});
    fixture.bus.get('coc:loop-engine')({engine: 'hybrid-v1', prescreen: 'run'});
    fixture.bus.get('coc:capsule')({capsule: fixture.capsule, context: fixture.binding, epoch: 'input-6'});
}

function withCeiling(t) {
    const names = ['PI_COC_REQUEST_BYTES', 'COC_TURN_DISCOVERY', 'EXT_JEV_APIKEY'], old = Object.fromEntries(names.map(name => [name, process.env[name]]));
    process.env.PI_COC_REQUEST_BYTES = String(CEILING);
    // The production default: discovery is `full`, so the packet carries every section of the package.
    delete process.env.COC_TURN_DISCOVERY; delete process.env.EXT_JEV_APIKEY;
    t.after(() => {for (const name of names) if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];});
}

test('required package detail that no longer fits beside the turn traffic is reserved, not thrown at Pi', async t => {
    withCeiling(t);
    const fixture = table(), messages = branch(fixture), errors = [];
    open(fixture);
    const stored = providerBytes(messages);
    assert.ok(stored > 3 * CEILING, `the stored branch is far over the ceiling: ${stored}`);
    const projected = await infer(fixture, messages, errors);
    assert.deepEqual(errors, [], 'the context hook did not fail inside Pi');
    const sent = providerBytes(projected);
    assert.ok(sent <= CEILING, `the request Pi hands the provider stays under the ceiling: ${sent} <= ${CEILING}`);
    const packet = projected.find(message => message.customType === 'coc-mod-sections');
    assert.ok(packet, 'the required package detail is sent');
    assert.deepEqual(JSON.parse(packet.content).sections.map(section => section.text),
        ['pacing@2.0.0#0', 'pacing@2.0.0#1'].map(fixture.sectionText), 'every section is whole, none cut to fit');
    assert.ok(api.pairedTools(projected), 'the reduced request keeps its tool pairs');
    const request = fixture.rows.findLast(row => row.lane === 'context' && row.event === 'request');
    assert.ok(request, 'the request is recorded');
    assert.ok(request.request_bytes <= CEILING, `the recorded request fits: ${request.request_bytes}`);
    assert.equal(request.mod_discovery_reserved, true, 'the row says the packet displaced turn traffic');
    assert.ok(request.dropped_tail > 0, 'older tool traffic of this turn paid for the packet');
    assert.equal(request.capacity, undefined);
    assert.equal(fixture.rows.findLast(row => row.lane === 'mod-discovery' && row.event === 'delivered')?.delivered, true);
    assert.equal(await fixture.hooks.get('tool_call')({toolName: 'apply', toolCallId: 'time-1', input: {effects: [{kind: 'time', minutes: 30}]}}), undefined,
        'a write whose detail was delivered is not held');
});

test('a protected floor that cannot also hold the packet omits it explicitly; a write owes it instead of being held', async t => {
    withCeiling(t);
    // The current capsule alone takes most of the request: no cut of history or turn traffic can make room.
    const fixture = table({capsuleBytes: 50 * 1024}), messages = branch(fixture), errors = [];
    open(fixture);
    const projected = await infer(fixture, messages, errors);
    assert.deepEqual(errors, [], 'the context hook did not fail inside Pi');
    const sent = providerBytes(projected);
    assert.ok(sent <= CEILING, `the request stays under the ceiling: ${sent} <= ${CEILING}`);
    assert.equal(projected.some(message => message.customType === 'coc-mod-sections'), false, 'the packet is omitted, not truncated');
    const notice = projected.find(message => message.customType === api.DIAGNOSTIC_TYPE);
    assert.equal(JSON.parse(notice.content).reason, 'mod_discovery_request_capacity', 'the Keeper is told why');
    assert.ok(projected.some(message => message.customType === 'coc-capsule'), 'the current capsule is kept');
    const request = fixture.rows.findLast(row => row.lane === 'context' && row.event === 'request');
    assert.equal(request.capacity, 'mod_discovery_request_capacity', 'the capacity failure is explicit in the request row');
    assert.ok(request.mod_discovery_omitted_bytes > 0);
    assert.ok(fixture.rows.some(row => row.lane === 'mod-discovery' && row.event === 'omitted' && row.reason === 'mod_discovery_request_capacity'));
    const held = await fixture.hooks.get('tool_call')({toolName: 'apply', toolCallId: 'time-1', input: {effects: [{kind: 'time', minutes: 30}]}});
    // §228.3: the write is not held; the omitted section it needs is owed and rides on its result or the next request.
    assert.equal(held, undefined);
    assert.ok(fixture.rows.some(row => row.lane === 'turn-disclosure' && row.event === 'owed' && row.keys.length && row.no_hold));
});

test('any other failure while projecting returns a bounded degraded request, never the stored branch', async t => {
    withCeiling(t);
    const fixture = table({readSections: async () => {throw new Error('kernel transport closed');}}), messages = branch(fixture), errors = [];
    open(fixture);
    const projected = await infer(fixture, messages, errors);
    assert.deepEqual(errors, [], 'the context hook did not fail inside Pi');
    const sent = providerBytes(projected);
    assert.ok(sent <= CEILING, `the degraded request stays under the ceiling: ${sent} <= ${CEILING}`);
    const notice = projected.find(message => message.customType === api.DIAGNOSTIC_TYPE);
    assert.equal(JSON.parse(notice.content).reason, 'context_projection_failed');
    assert.ok(api.pairedTools(projected));
    const request = fixture.rows.findLast(row => row.lane === 'context' && row.event === 'request');
    assert.equal(request.reason, 'context_projection_failed');
    assert.match(request.error, /kernel transport closed/);
    assert.ok(request.request_bytes <= CEILING);
});
