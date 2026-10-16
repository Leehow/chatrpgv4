import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Type } from 'typebox';
import { fauxProvider } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from './pi.mjs';
import { stream } from '../../node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js';
import { convertToLlm } from '../../build/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';
import activeCache from '../../extensions/anthropic-cache/index.js';
import { enabledInHost, observeBrief, placeBreakpoints, policyFor, mergeReportedUsage, usageObservation, cacheStatistics, prefixSnapshot } from '../../extensions/anthropic-cache/shared/policy.js';
import { agentExtensionManifests, runtimeEntrypoints, sessionExtensionPaths, desktopSessionExtensionPaths,
  readerProviderExtensionPaths } from '../../runtime/deployment.mjs';

const root = resolve(import.meta.dirname, '../..');
const catalog = JSON.parse(readFileSync(new URL('../../node_modules/@earendil-works/pi-ai/dist/providers/data/minimax-cn.json', import.meta.url)));
const model = catalog['anthropic-messages']['chat:MiniMax-M2.7'];
const control = { type: 'ephemeral' };
const text = value => ({ type: 'text', text: value });
const brief = 'A stable private module brief. '.repeat(200);
const briefContext = () => ({ role: 'custom', customType: 'coc-context-brief', content: brief, timestamp: 0 });
function payload(capsule = 'turn one') {
  return { model: model.id, max_tokens: 128, stream: true,
    tools: [{ name: 'look', input_schema: { type: 'object', properties: {} }, cache_control: control }],
    system: [{ ...text('Stable Keeper instructions'), cache_control: control }],
    messages: [{ role: 'user', content: [text(brief), text(capsule), { ...text('Player input'), cache_control: control }] }] };
}
function positions(body) {
  const found = [];
  const walk = (value, path = '') => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'cache_control')) found.push({ path, control: value.cache_control });
    for (const [key, child] of Object.entries(value)) if (key !== 'cache_control') walk(child, `${path}/${key}`);
  };
  walk(body); return found;
}
function withoutControls(value) {
  if (Array.isArray(value)) return value.map(withoutControls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'cache_control').map(([key, child]) => [key, withoutControls(child)]));
}
function fixture() {
  const handlers = {}, rows = [];
  activeCache({ on(name, handler) { handlers[name] = handler; }, appendEntry(type, data) { rows.push({ type, data }); } });
  return { handlers, rows };
}
function responseFrames(id) {
  return [
    { type: 'message_start', message: { id: 'offline', type: 'message', role: 'assistant', model: id, content: [],
      usage: { input_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 40, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
}
function offlineClient(id, capture) {
  return { beta: { messages: { create(body) {
    capture(body);
    return { asResponse: async () => new Response(responseFrames(id).map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }) };
  } } } };
}

test('a desktop-disabled extension cannot be revived by shared mounts, while source CLI stays enabled', () => {
  assert.equal(enabledInHost({}), true);
  for (const env of [{ PIPIUI_SPAWN_CONTRACT: '{}' }, { PIPIUI_HOST_PROTOCOL: '1', PIPIUI_MOUNTED_EXTENSIONS: 'kernel,jev' },
    { PIPIUI_SPAWN_CONTRACT: '{}', PIPIUI_MOUNTED_EXTENSIONS: '' }]) {
    assert.equal(enabledInHost(env), false);
    const hooks = [];
    activeCache({ on(name) { hooks.push(name); } }, env);
    assert.deepEqual(hooks, []);
  }
  assert.equal(enabledInHost({ PIPIUI_SPAWN_CONTRACT: '{}', PIPIUI_MOUNTED_EXTENSIONS: 'kernel, anthropic-cache' }), true);
});

test('stable brief gets a fourth boundary while dynamic capsule and all other bytes remain exact', () => {
  const input = payload(), original = structuredClone(input);
  const result = placeBreakpoints(input, model, observeBrief([briefContext()]));
  assert.deepEqual(input, original, 'the original provider body is not mutated');
  assert.deepEqual(withoutControls(result.payload), withoutControls(original));
  assert.equal(result.observation.brief, 'marked');
  assert.deepEqual(positions(result.payload).map(point => point.path), ['/tools/0', '/system/0', '/messages/0/content/0', '/messages/0/content/2']);
  const next = placeBreakpoints(payload('turn two; changed world state'), model, observeBrief([briefContext()]));
  assert.deepEqual(next.payload.messages[0].content[0], result.payload.messages[0].content[0]);
  assert.equal(next.payload.messages[0].content[1].text, 'turn two; changed world state');
  assert.deepEqual(placeBreakpoints(result.payload, model, observeBrief([briefContext()])), result, 'placement is idempotent');
});

test('the brief remains an explicit boundary beyond the twenty-block lookback window', () => {
  const body = payload();
  body.messages[0].content = [text(brief), ...Array.from({ length: 35 }, (_, i) => text(`Dynamic context ${i}`))];
  body.messages[0].content.at(-1).cache_control = control;
  const result = placeBreakpoints(body, model, observeBrief([briefContext()]));
  assert.deepEqual(result.payload.messages[0].content[0].cache_control, control);
  assert.equal(positions(result.payload).length, 4);
  assert.equal(result.payload.messages[0].content.length, 36);
});

test('only explicit MiniMax provider identities on the Anthropic protocol are eligible', () => {
  for (const provider of ['minimax-cn', 'minimax']) assert.ok(policyFor({ ...model, provider }));
  for (const provider of ['anthropic', 'openrouter', 'flapcode', 'toString', '__proto__']) {
    const body = payload();
    assert.equal(placeBreakpoints(body, { ...model, provider }).payload, body);
  }
  for (const api of ['openai-completions', 'openai-responses', undefined]) assert.equal(policyFor({ ...model, api }), undefined);
  assert.equal(policyFor(undefined), undefined);
  const body = payload();
  assert.equal(placeBreakpoints(body, { ...model, id: 'different-model' }).payload, body);
});

test('cache-off and explicit request-level policies are preserved without enabling writes', () => {
  const off = withoutControls(payload());
  assert.equal(placeBreakpoints(off, model).payload, off);
  assert.equal(placeBreakpoints(off, model).observation.reason, 'cache_disabled');
  const explicit = { ...payload(), cache_control: { type: 'ephemeral', ttl: '1h' } };
  assert.equal(placeBreakpoints(explicit, model).payload, explicit);
  assert.equal(placeBreakpoints(explicit, model).observation.reason, 'request_level_policy');
});

test('MiniMax removes unsupported long TTLs and bounds preexisting markers without changing tool pairs or thinking', () => {
  const body = payload();
  body.messages.push({ role: 'assistant', content: [{ type: 'thinking', thinking: 'private', signature: 'signed' },
    { type: 'tool_use', id: 'call_1', name: 'look', input: { name: 'scene' }, cache_control: { type: 'ephemeral', ttl: '1h' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'Original answer', cache_control: control }] });
  body.messages[0].content.forEach(block => { block.cache_control = { type: 'ephemeral', ttl: '1h' }; });
  const result = placeBreakpoints(body, model, { text: brief, status: 'available' });
  assert.deepEqual(withoutControls(result.payload), withoutControls(body));
  assert.equal(positions(result.payload).length, 4);
  assert.ok(positions(result.payload).every(point => JSON.stringify(point.control) === JSON.stringify(control)));
  assert.deepEqual(result.payload.messages[1].content[0], body.messages[1].content[0]);
  assert.deepEqual(result.payload.messages.at(-1).content[0].cache_control, control);
});

test('missing, altered, duplicate and untyped brief text never receives a guessed boundary', () => {
  const f = fixture();
  f.handlers.context_with_system({ messages: [{ role: 'user', content: brief }] });
  assert.equal(f.handlers.before_provider_request({ payload: payload() }, { model }).messages[0].content[0].cache_control, undefined);
  assert.equal(observeBrief([briefContext(), briefContext()]).status, 'ambiguous_context');
  const changed = placeBreakpoints(payload(), model, { status: 'available', text: brief + 'changed' });
  assert.equal(changed.observation.brief, 'not_serialized');
  assert.equal(positions(changed.payload).length, 3);
  const duplicate = payload(); duplicate.messages[0].content.splice(1, 0, text(brief));
  const result = placeBreakpoints(duplicate, model, { status: 'available', text: brief });
  assert.equal(result.observation.brief, 'ambiguous_payload');
  assert.equal(positions(result.payload).length, 3);
});

test('overlapping tail/brief slots deduplicate and tool cache opt-out is respected', () => {
  const body = payload(); body.messages[0].content = [text(brief)];
  const result = placeBreakpoints(body, { ...model, compat: { supportsCacheControlOnTools: false } }, { status: 'available', text: brief });
  assert.equal(positions(result.payload).length, 2);
  assert.equal(result.payload.tools[0].cache_control, undefined);
  assert.deepEqual(result.payload.messages[0].content[0].cache_control, control);
});

test('partial stream usage preserves reported counters and never turns missing values into zero', () => {
  let usage = mergeReportedUsage({}, { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens: 0 } } });
  usage = mergeReportedUsage(usage, { type: 'message_delta', usage: { output_tokens: 20 } });
  assert.deepEqual(usageObservation(usage), { usage_status: 'reported', input: 10, read: 100, write: 30, output: 20, total_input: 140, cache_read_ratio: 100 / 140 });
  assert.deepEqual(usageObservation({}), { usage_status: 'unreported' });
  assert.deepEqual(usageObservation(mergeReportedUsage({}, { type: 'message_delta', usage: { input_tokens: -1, cache_read_input_tokens: '100', cache_creation_input_tokens: null, output_tokens: 3 } })), { usage_status: 'partial', output: 3 });
  assert.equal(usageObservation({ input: 0, read: 0, write: 0 }).cache_read_ratio, null);
});

test('a completed conversation boundary survives growth beyond the twenty-block lookup window', () => {
  const f = fixture();
  f.handlers.context_with_system({messages:[briefContext()]});
  const initial=f.handlers.before_provider_request({payload:payload()},{model});
  f.handlers.message_end({message:{role:'assistant',provider:model.provider,model:model.id,stopReason:'stop'}});
  f.handlers.turn_start();
  f.handlers.context_with_system({messages:[briefContext()]});
  const grown=structuredClone(initial);
  grown.messages.push({role:'assistant',content:[text('An ordinary reply.')]},
    {role:'user',content:Array.from({length:35},(_,i)=>text(`New block ${i}`))});
  const next=f.handlers.before_provider_request({payload:grown},{model});
  assert.deepEqual(next.messages[0].content[2].cache_control,control,'retain the actual previously written tail');
  assert.deepEqual(next.messages[0].content[0].cache_control,control,'retain the stable brief');
  assert.equal(positions(next).length,4);
  assert.deepEqual(withoutControls(next),withoutControls(grown));
  assert.ok(f.rows.at(-1).data.breakpoints.some(p=>p.purpose==='previous-prefix'));
});

test('changed tools prevent reuse and diagnostics identify the invalidated prefix without text', () => {
  const f=fixture();
  f.handlers.before_provider_request({payload:payload()},{model});
  f.handlers.message_end({message:{role:'assistant',provider:model.provider,model:model.id,stopReason:'stop'}});
  const next=payload();next.tools[0].description='A changed tool schema';
  next.messages.push({role:'user',content:Array.from({length:35},()=>text('New context'))});
  const result=f.handlers.before_provider_request({payload:next},{model});
  assert.equal(result.messages[0].content[2].cache_control,undefined);
  assert.equal(f.rows.at(-1).data.prefix_reuse.first_changed,'tools/0');
  assert.equal(f.rows.at(-1).data.prefix_reuse.matching_blocks,0);
  assert.doesNotMatch(JSON.stringify(f.rows),/changed tool schema|New context/);
});

test('host cache statistics expose reported writes and missing coverage without a fabricated hit rate', () => {
  const entry=data=>({type:'custom',customType:'coc-telemetry',data:{lane:'anthropic-cache',phase:'usage',provider:model.provider,model:model.id,...data}});
  const complete=entry({request:1,input:10,read:80,write:10});
  const partial=entry({request:2,input:20,read:160});
  const result=cacheStatistics([complete,partial,entry({provider:'other',write:999})]);
  assert.deepEqual(result.write,{tokens:10,reported_requests:1,unreported_requests:1});
  assert.deepEqual(result.read,{tokens:240,reported_requests:2,unreported_requests:0});
  assert.equal(result.recent[1].write,null);
  assert.equal(result.cache_read_ratio,null);
  assert.equal(cacheStatistics([complete]).cache_read_ratio,0.8);
  assert.equal(cacheStatistics([partial]).write.tokens,null);
  assert.equal(cacheStatistics([]).write.tokens,null);
});

test('expired, changed-model and failed request boundaries never authorize a retained prefix', () => {
  const first=placeBreakpoints(payload(),model,{text:brief});
  const snapshot=prefixSnapshot(first.payload,model,Date.now()-300001);
  const grown=structuredClone(first.payload);
  grown.messages.push({role:'user',content:Array.from({length:35},()=>text('New context'))});
  assert.equal(placeBreakpoints(grown,model,{text:brief},snapshot).observation.prefix_reuse.status,'expired');
  assert.equal(placeBreakpoints(grown,model,{text:brief},{...snapshot,model:'other/model'}).observation.prefix_reuse.status,'model_changed');
  const f=fixture();f.handlers.before_provider_request({payload:payload()},{model});
  f.handlers.message_end({message:{role:'assistant',provider:model.provider,model:model.id,stopReason:'error'}});
  f.handlers.before_provider_request({payload:grown},{model});
  assert.equal(f.rows.at(-1).data.prefix_reuse,undefined);
});

test('session diagnostics are private, request-bound and do not alter assistant usage or errors', () => {
  const f = fixture();
  f.handlers.context_with_system({ messages: [briefContext()] });
  f.handlers.before_provider_request({ payload: payload() }, { model });
  const report = (provider, usage) => f.handlers.provider_stream_event({ provider, model: model.id, api: model.api, data: { type: 'message_start', message: { usage } } });
  report('another-provider', { input_tokens: 1000 });
  report(model.provider, { input_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 15 });
  const message = { role: 'assistant', provider: model.provider, model: model.id, stopReason: 'stop', usage: { cost: { total: 123 } }, content: [text('private reply')] };
  assert.equal(f.handlers.message_end({ message }), undefined);
  assert.deepEqual(message.usage, { cost: { total: 123 } });
  assert.equal(f.rows.length, 2);
  assert.ok(f.rows.every(row => row.type === 'coc-telemetry' && row.data.lane === 'anthropic-cache'));
  assert.equal(f.rows[1].data.cache_read_ratio, 0.8);
  assert.equal(f.rows[1].data.request, f.rows[0].data.request);
  assert.doesNotMatch(JSON.stringify(f.rows), /stable private|private reply|Original answer|signature|api_key/);
  f.handlers.turn_start();
  f.handlers.before_provider_request({ payload: payload() }, { model });
  f.handlers.message_end({ message: { ...message, stopReason: 'error', errorMessage: 'SECRET' } });
  assert.equal(f.rows.at(-1).data.usage_status, 'unreported');
  assert.equal(f.rows.at(-1).data.stop_reason, 'error');
  assert.equal(f.rows.at(-2).data.brief, 'absent');
  assert.doesNotMatch(JSON.stringify(f.rows), /SECRET/);
  f.handlers.before_provider_request({ payload: payload() }, { model: { ...model, provider: 'anthropic' } });
  assert.equal(f.rows.length, 4);
});

test('physical stream completions retain write usage across a multi-request search continuation', () => {
  const f=fixture();
  const raw=data=>f.handlers.provider_stream_event({provider:model.provider,model:model.id,api:model.api,data});
  for(const [read,write,stop] of [[0,100,'pause_turn'],[100,20,'end_turn']]){
    f.handlers.before_provider_request({payload:payload()},{model});
    raw({type:'message_delta',delta:{stop_reason:stop},usage:{input_tokens:10,output_tokens:3,cache_read_input_tokens:read,cache_creation_input_tokens:write}});
    raw({type:'message_stop'});
  }
  f.handlers.message_end({message:{role:'assistant',provider:model.provider,model:model.id,stopReason:'stop'}});
  const usages=f.rows.filter(row=>row.data.phase==='usage');
  assert.equal(usages.length,2);
  assert.deepEqual(usages.map(row=>row.data.write),[100,20]);
  assert.equal(cacheStatistics(f.rows.map(row=>({type:'custom',customType:row.type,data:row.data}))).write.tokens,120);
});

test('manifest, source package, CLI, desktop and profile routes include the extension; reader lanes do not', () => {
  const declaration = agentExtensionManifests(root).find(entry => entry.name === 'anthropic-cache');
  assert.equal(declaration.built, 'build/extensions/anthropic-cache/index.mjs');
  const manifest = JSON.parse(readFileSync(new URL('../../extensions/anthropic-cache/pipiui-extension.json', import.meta.url)));
  assert.equal(manifest.defaultEnabled, true);
  assert.deepEqual(manifest.capabilities, []);
  assert.ok(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).pi.extensions.includes('./extensions/anthropic-cache'));
  for (const layout of ['source', 'compiled']) {
    const entries = runtimeEntrypoints(root, layout), path = resolve(root, declaration.built);
    assert.ok(sessionExtensionPaths(entries).includes(path));
    assert.ok(desktopSessionExtensionPaths(entries).includes(path));
    assert.ok(!readerProviderExtensionPaths(entries).includes(path));
    assert.ok(entries.extensions.indexOf(path) > entries.extensions.indexOf(resolve(root, 'build/extensions/table/index.mjs')));
  }
});

for (const id of ['MiniMax-M2.7', 'MiniMax-M3.1-Flash-Preview']) test(`actual Pi conversion and ${id} serializer deliver four cache boundaries without HTTP`, async () => {
  const selected = { ...model, id }, f = fixture();
  const messages = [{ role: 'system', content: 'Stable instructions', timestamp: 0,
    toolsAdded: [{ name: 'look', description: 'Read a scene', parameters: { type: 'object', properties: {} } }] },
  briefContext(), { role: 'custom', customType: 'coc-capsule', content: 'Changing current state', timestamp: 0 },
  { role: 'user', content: [text('Player choice')], timestamp: 0 }];
  f.handlers.context_with_system({ messages });
  let wire, creates = 0;
  const client = offlineClient(id, body => { wire = body; creates++; });
  const result = await stream(selected, { messages: convertToLlm(messages) }, { apiKey: 'offline-placeholder', client, cacheRetention: 'long', maxTokens: 16,
    onPayload: body => f.handlers.before_provider_request({ payload: body }, { model: selected }),
    onProviderStreamEvent: data => f.handlers.provider_stream_event({ provider: selected.provider, model: id, api: selected.api, data }) }).result();
  assert.equal(creates, 1);
  assert.notEqual(result.stopReason, 'error', result.errorMessage);
  assert.equal(result.content[0].text, 'OK');
  assert.equal(wire.model, id);
  assert.equal(positions(wire).length, 4);
  assert.ok(positions(wire).every(point => point.control.ttl === undefined));
  const briefBlock = wire.messages.flatMap(message => message.content).find(block => block.text === brief);
  assert.deepEqual(briefBlock.cache_control, control);
  assert.equal(f.rows[0].data.brief, 'marked');
  f.handlers.message_end({ message: result });
  assert.equal(f.rows.at(-1).data.cache_read_ratio, 100 / 160);
  assert.equal(f.rows.at(-1).data.usage_status, 'reported');
  assert.equal(result.usage.cacheRead, 100);
});

for (const [origin, extensionPath] of [
  ['source', resolve(root, 'extensions/anthropic-cache/index.js')],
  ['emitted', resolve(root, 'build/extensions/anthropic-cache/index.mjs')],
]) test(`a real product Pi session loads the extension, applies the native request hook and journals raw usage privately (${origin})`, async t => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'anthropic-cache-session-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const wires = [], incoming = [];
  const provider = fauxProvider({ provider: model.provider, api: model.api, models: [{ id: model.id }] });
  Object.assign(provider.models[0], model);
  const client = offlineClient(model.id, body => wires.push(body));
  provider.provider.streamSimple = (selected, context, options) => {
    incoming.push(context);
    return stream(selected, context, { ...options, client, maxTokens: 16 });
  };
  const runtime = await ModelRuntime.create({ authPath: resolve(workspace, 'auth.json'), modelsPath: null,
    modelsStorePath: resolve(workspace, 'models-store.json'), refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerNativeProvider(provider.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' });
  const loader = new DefaultResourceLoader({ cwd: workspace, agentDir: resolve(workspace, 'agent'), settingsManager: settings,
    additionalExtensionPaths: [extensionPath],
    extensionFactories: [{ name: 'typed-table-context', factory(pi) {
      pi.on('context', event => ({ messages: [briefContext(), ...event.messages] }));
      pi.registerTool({ name: 'look', label: 'Look', description: 'Read a scene', parameters: Type.Object({}),
        execute: async () => { throw Error('No tool should execute in this transport test'); } });
    } }] });
  await loader.reload();
  const journal = SessionManager.inMemory();
  const { session } = await createAgentSession({ cwd: workspace, agentDir: resolve(workspace, 'agent'),
    model: provider.getModel(), modelRuntime: runtime, noTools: 'builtin', resourceLoader: loader,
    sessionManager: journal, settingsManager: settings });
  t.after(() => session.dispose());
  await session.bindExtensions({ mode: 'print' });
  await session.prompt('Offline transport check');
  assert.equal(wires.length, 1);
  assert.equal(positions(wires[0]).length, 4);
  const rows = journal.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'coc-telemetry')
    .map(entry => entry.data).filter(row => row.lane === 'anthropic-cache');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].brief, 'marked');
  assert.equal(rows[1].cache_read_ratio, 100 / 160);
  assert.equal(rows[1].usage_status, 'reported');
  assert.doesNotMatch(JSON.stringify(incoming), /"lane":"anthropic-cache"/);
});
