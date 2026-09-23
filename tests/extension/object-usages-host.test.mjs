import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import modsExtension from '../../extensions/mods/index.ts';
import {COC_TOOLS, COC_TOOL_NAMES} from '../../extensions/kernel/tools.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {waitFor} from './wait.mjs';

const usage = (name = 'Swing') => ({kind: 'usage', object: 'Held chair', name, description: 'Swing the held chair at the attacker'});
const packet = name => ({usage: {name, description: 'A swing', basis: 'Intact wooden frame', mode: 'melee',
  parameters: {skill: 'Fighting (Brawl)', damage: '1D6', uses_per_round: 1, impale: false, adds_damage_bonus: true},
  player_view: {description: 'A swing', fields: ['damage']}},
  physical_basis: {definition_digest: 'immutable-definition', condition: 'intact'},
  provenance: {mod: 'enhanced-items', digest: 'package-digest', job: `job-${name}`}});
const latch = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return {promise, release}; };

async function harness(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'object-usages-host-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const pi = {events: new EventEmitter(), on() {}}, operations = [], tasks = [], checks = [], jobs = [], jobByKey = new Map();
  let bridge;
  pi.events.on('coc:mods-bridge', value => { bridge = value; });
  modsExtension(pi);
  pi.events.emit('coc:kernel-bridge', {runtime: {
    async runTask(task, signal) {
      operations.push('run'); tasks.push(task);
      return options.run ? options.run(task, signal) : {ok: true};
    },
    async check(request, signal) {
      operations.push(request.kind); checks.push(request);
      return options.check ? options.check(request, signal) : {ok: true};
    },
  }, async call(method, params) {
    operations.push(method);
    if (method === 'mods.queued') return {effects: [], unfinished: []};
    if(method==='mods.identity.plan')return options.identityEligible?{eligible:true,accepted:false,input:{name:params.define.name,category:'item',description:params.define.description},
      job:`job-${params.define.name}`,mod:'enhanced-items',digest:'package-digest'}:{eligible:false,reason:'fixture_ineligible'};
    if (method === 'mods.job') {
      if(params.role==='audit'&&options.auditEnabled===false)return{enabled:false};
      const ordinal = jobs.length, key = params.preview ? `job-${params.input.name}-${ordinal}` : `job-${params.input.name}`;
      jobs.push(params); jobByKey.set(key, params);
      const cwd = join(home, params.input.name);
      await mkdir(cwd, {recursive: true});
      return {enabled: options.enabled !== false, accepted: options.cached === true, cwd,
        system_prompt: join(cwd, 'prompt.md'), job: key, mod: 'enhanced-items', digest: 'package-digest'};
    }
    if (method === 'mods.accept') {
      if (options.accept) return options.accept(params);
      const job = jobByKey.get(params.job);
      return job.role === 'usage' ? packet(job.input.name)
        : {definition: {...job.input}, provenance: {mod: 'enhanced-items', digest: 'package-digest', job: params.job}};
    }
    throw new Error(`Unexpected method ${method}`);
  }});
  return {bridge, home, operations, tasks, checks, jobs};
}

test('plain investigator item identity and delivery do not await the optional definition creator',async t=>{
  const started=latch(),finish=latch(),h=await harness(t,{identityEligible:true,auditEnabled:false,
    async run(){started.release();await finish.promise;return{ok:true};}}),define={kind:'define',name:'House key definition',description:'An ordinary house key.'},
    object={kind:'object',name:'House key',definition:'House key definition',to:'Thomas Hayes',from:'Steven Knott',handover:'given',why:'Knott hands it over.'},
    payload={campaign:'test-campaign',effects:[{kind:'clue',clue:'keys'},define,object,{kind:'move',to:'archive'}]};
  await h.bridge.prepare('apply',payload);await started.promise;
  assert.equal(define._identity_defer,true);assert.equal(object._identity_defer,true);assert.equal(typeof define._queued,'string');
  let delivered=false;await h.bridge.prepare('narrate',{campaign:'test-campaign',text:'The investigator pockets the key and leaves.'}).then(()=>{delivered=true;});
  assert.equal(delivered,true,'narration preparation must not join the held optional creator');
  assert(h.operations.includes('mods.identity.plan'));assert.equal(h.operations.filter(value=>value==='run').length,1);
  finish.release();await waitFor(()=>h.operations.includes('mods.accept'),{label:'optional definition acceptance'});
  assert(h.operations.includes('mods.accept'));
});

test('usage preparation waits, repairs through object-usage check, and injects the complete accepted packet', async t => {
  const started = latch(), finish = latch();
  let attempt = 0;
  const h = await harness(t, {async run() { started.release(); await finish.promise; return {ok: true}; },
    async check() { return ++attempt === 1 ? {ok: false, error: 'invalid profile', fix: 'Supply adds_damage_bonus'} : {ok: true}; }});
  const effect = usage(), payload = {campaign: 'test-campaign', effects: [effect]};
  let completed = false;
  const preparing = h.bridge.prepare('apply', payload).then(() => { completed = true; });
  await started.promise;
  assert.equal(completed, false);
  assert.equal(effect._queued, undefined);
  assert.equal(effect._usage, undefined);
  finish.release();
  await preparing;
  assert.deepEqual(h.jobs, [{campaign: 'test-campaign', role: 'usage', input: {
    object: 'Held chair', name: 'Swing', description: effect.description}}]);
  assert.deepEqual(h.operations, ['mods.queued', 'mods.job', 'run', 'object-usage', 'run', 'object-usage', 'mods.accept']);
  assert.equal(h.tasks[0].kind, 'mod');
  assert.equal(h.tasks[0].request.tools, 'read,write,edit,bash');
  assert.match(h.tasks[0].request.brief, /request.json.*result.json/);
  assert.match(h.tasks[1].request.brief, /Supply adds_damage_bonus/);
  assert.equal(h.checks[0].draft, join(h.home, 'Swing', 'result.json'));
  assert.deepEqual(effect._usage, packet('Swing'));
  assert.deepEqual(effect._provenance, packet('Swing').provenance);
  assert.equal(effect._definition, undefined);
  assert.equal(JSON.parse(await readFile(join(h.home, 'Swing', 'run-1.json'), 'utf8')).ok, true);
});

test('define and object effects before usage are accepted first and sent as private preview', async t => {
  const h = await harness(t);
  const define = {kind: 'define', name: 'Scene chair', description: 'A loose chair in the room'};
  const object = {kind: 'object', name: 'Scene chair', definition: 'Scene chair', adopt: 'loose chair', to: 'Investigator'};
  const attack = {...usage(), object: 'Scene chair'};
  await h.bridge.prepare('apply', {campaign: 'test-campaign', effects: [define, object, attack]});
  assert.deepEqual(h.operations, ['mods.queued', 'mods.job', 'run', 'mod-definition', 'mods.accept', 'mods.job', 'run', 'object-usage', 'mods.accept']);
  assert.equal(h.jobs[0].role, 'create');
  assert.equal(h.jobs[0].input.category, 'item');
  assert.equal(h.jobs[1].role, 'usage');
  assert.deepEqual(h.jobs[1].input, {object: 'Scene chair', name: 'Swing', description: attack.description});
  assert.deepEqual(h.jobs[1].preview, [define, object]);
  assert.ok(define._definition);
  assert.equal(define._queued, undefined);
  assert.deepEqual(attack._usage, packet('Swing'));
});

test('an accepted usage job is read without a creator, checker or preview when nothing is staged', async t => {
  const h = await harness(t, {cached: true});
  const effect = usage();
  await h.bridge.prepare('apply', {campaign: 'test-campaign', effects: [effect]});
  assert.deepEqual(h.operations, ['mods.queued', 'mods.job', 'mods.accept']);
  assert.deepEqual(effect._usage, packet('Swing'));
  assert.equal('preview' in h.jobs[0], false);
  assert.equal(h.tasks.length, 0);
  assert.equal(h.checks.length, 0);
});

test('stale usage and changed job bindings return to the Keeper without creator repair', async t => {
  for (const payload of [
    {code: 'needs', message: 'The object physical state changed while its usage was prepared', details: {reason: 'usage_stale'}},
    {code: 'needs', message: 'The retained usage request changed', details: {reason: 'usage_request_changed'}},
    {code: 'invalid_params', message: 'Mod job belongs to another turn or worldline'},
    {code: 'invalid_params', message: 'Mod changed while the job was running'},
    {code: 'invalid_params', message: 'The effective Mod provider changed while the job was running'},
  ]) for (const cached of [false, true]) await t.test(`${payload.message}; cached=${cached}`, async t => {
    const failure = new KernelError(payload);
    const h = await harness(t, {cached, async accept() { throw failure; }}), effect = usage();
    await assert.rejects(h.bridge.prepare('apply', {campaign: 'test-campaign', effects: [effect]}), error => error === failure);
    assert.deepEqual(h.operations, cached ? ['mods.queued', 'mods.job', 'mods.accept']
      : ['mods.queued', 'mods.job', 'run', 'object-usage', 'mods.accept']);
    assert.equal(h.tasks.length, cached ? 0 : 1);
    assert.equal(effect._usage, undefined);
    assert.equal(effect._provenance, undefined);
    assert.equal(effect._queued, undefined);
  });
});

test('distinct usage jobs run concurrently while exact duplicate inputs and previews share one creator', async t => {
  const both = latch(), finish = latch();
  let running = 0;
  const h = await harness(t, {async run() { if (++running === 2) both.release(); await finish.promise; return {ok: true}; }});
  const effects = [usage(), usage('Throw'), usage()];
  const preparing = h.bridge.prepare('apply', {campaign: 'test-campaign', effects});
  await both.promise;
  assert.equal(h.tasks.length, 2);
  assert.ok(effects.every(effect => !effect._usage));
  finish.release();
  await preparing;
  assert.equal(h.jobs.length, 2);
  assert.deepEqual(effects[0]._usage, effects[2]._usage);
  assert.equal(effects[1]._usage.usage.name, 'Throw');
});

test('the same usage input with different staged previews is not deduplicated', async t => {
  const h = await harness(t);
  const firstState = {kind: 'object', name: 'Held chair', from: 'Room', to: 'Investigator', condition: 'damaged'};
  const secondState = {kind: 'object', name: 'Held chair', from: 'Investigator', to: 'Investigator', condition: 'broken'};
  const first = usage(), second = usage();
  await h.bridge.prepare('apply', {campaign: 'test-campaign', effects: [firstState, first, secondState, second]});
  assert.equal(h.jobs.length, 2);
  assert.equal(h.tasks.length, 2);
  assert.deepEqual(h.jobs[0].preview, [firstState]);
  assert.deepEqual(h.jobs[1].preview, [firstState, secondState]);
  assert.deepEqual(first._usage, packet('Swing'));
  assert.deepEqual(second._usage, packet('Swing'));
});

test('a usage batch with unrelated effects is refused before creators or apply side effects', async t => {
  const h = await harness(t), effect = usage();
  await assert.rejects(h.bridge.prepare('apply', {campaign: 'test-campaign', effects: [effect, {kind: 'time', minutes: 1}]}), /only contain define, object and usage/);
  assert.deepEqual(h.operations, ['mods.queued']);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.tasks.length, 0);
  assert.equal(h.checks.length, 0);
  assert.equal(effect._usage, undefined);
});

test('disabled, failed, rejected and cancelled preparation never inject success', async t => {
  for (const sample of [
    {name: 'disabled', options: {enabled: false}, error: /Enable a usage-generating Mod/, runs: 0},
    {name: 'agent failed', options: {run: async () => ({ok: false, code: 1})}, error: /did not finish/, runs: 1},
    {name: 'agent threw', options: {run: async () => { throw new Error('child failed'); }}, error: /child failed/, runs: 1},
    {name: 'checker refused twice', options: {check: async () => ({ok: false, error: 'bad usage'})}, error: /bad usage/, runs: 2},
    {name: 'accept refused twice', options: {accept: async () => { throw new Error('stale basis'); }}, error: /stale basis/, runs: 2},
  ]) await t.test(sample.name, async t => {
    const h = await harness(t, sample.options), effect = usage();
    await assert.rejects(h.bridge.prepare('apply', {campaign: 'test-campaign', effects: [effect]}), sample.error);
    assert.equal(h.tasks.length, sample.runs);
    assert.equal(h.operations.includes('table.apply'), false);
    assert.equal(effect._usage, undefined);
    assert.equal(effect._provenance, undefined);
    assert.equal(effect._queued, undefined);
  });
  for (const phase of ['before', 'run', 'check', 'cached accept']) await t.test(`abort ${phase}`, async t => {
    const controller = new AbortController(), abort = () => controller.abort(new Error('usage cancelled'));
    const h = await harness(t, {
      cached: phase === 'cached accept',
      async run() { if (phase === 'run') abort(); return {ok: true}; },
      async check() { if (phase === 'check') abort(); return {ok: true}; },
      async accept() { if (phase === 'cached accept') abort(); return packet('Swing'); },
    });
    if (phase === 'before') abort();
    const effect = usage();
    await assert.rejects(h.bridge.prepare('apply', {campaign: 'test-campaign', effects: [effect]}, controller.signal), /usage cancelled/);
    assert.equal(effect._usage, undefined);
    assert.equal(effect._provenance, undefined);
    assert.equal(effect._queued, undefined);
    assert.ok(h.tasks.length <= 1, 'cancellation must not launch a repair');
  });
});

test('one failed usage leaves the entire batch unprepared, including successful siblings', async t => {
  const h = await harness(t, {async run(task) { return {ok: !task.request.cwd.endsWith('Throw')}; }});
  const effects = [usage(), usage('Throw')];
  await assert.rejects(h.bridge.prepare('apply', {campaign: 'test-campaign', effects}), /did not finish/);
  assert.ok(h.operations.includes('mods.accept'), 'successful sibling was accepted for later reuse');
  assert.equal(h.operations.includes('table.apply'), false);
  assert.ok(effects.every(effect => !effect._usage && !effect._provenance));
});

test('definitions default to item and legacy weapon/spell creation stays on its existing check', async t => {
  const h = await harness(t);
  const effects = [
    {kind: 'define', name: 'New item', description: 'A new physical item'},
    {kind: 'define', name: 'Old weapon', category: 'weapon', description: 'A legacy weapon'},
    {kind: 'define', name: 'Old spell', category: 'spell', description: 'A legacy spell'},
  ];
  await h.bridge.prepare('apply', {campaign: 'test-campaign', effects});
  assert.deepEqual(h.jobs.map(job => job.input.category), ['item', 'weapon', 'spell']);
  assert.ok(h.jobs.every(job => job.role === 'create'));
  assert.ok(h.checks.every(check => check.kind === 'mod-definition'));
  assert.ok(effects.every(effect => effect._definition && !effect._usage));
});

test('pure define/adopt retains background deferral but adding a held usage forces waiting', async t => {
  for (const withUsage of [false, true]) await t.test(String(withUsage), async t => {
    const started = latch(), finish = latch();
    const h = await harness(t, {async run() { started.release(); await finish.promise; return {ok: true}; }});
    const define = {kind: 'define', name: 'Notebook', description: 'A notebook'};
    const effects = [define, {kind: 'object', name: 'Notebook', definition: 'Notebook', adopt: 'Old notebook', to: 'Investigator'},
      ...(withUsage ? [usage()] : [])];
    let completed = false;
    const preparing = h.bridge.prepare('apply', {campaign: 'test-campaign', effects}).then(() => { completed = true; });
    await started.promise;
    // Flush promise continuations without allowing the creator to complete.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, !withUsage);
    assert.equal(Boolean(define._queued), !withUsage);
    finish.release();
    await preparing;
    if (withUsage) {
      assert.deepEqual(effects[2]._usage, packet('Swing'));
      assert.equal(define._queued, undefined);
    } else {
      // Let the retained background job finish before deleting its disposable directory.
      while (!h.operations.includes('mods.accept')) await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.jobs[0].input.category, 'item');
    }
  });
});

test('the same seven tools expose usage selection, an object alias, staged usage and optional define category', () => {
  assert.deepEqual(COC_TOOL_NAMES, ['look', 'lookup', 'recall', 'resolve', 'apply', 'ask', 'narrate']);
  const effects = COC_TOOLS.find(tool => tool.name === 'apply').parameters.properties.effects.items.anyOf;
  const byKind = kind => effects.find(effect => effect.properties.kind.enum?.includes(kind));
  assert.deepEqual(byKind('usage').required, ['kind', 'object', 'name', 'description']);
  assert.equal(byKind('define').required.includes('category'), false);
  assert.equal(byKind('usage').properties._usage, undefined);
  assert.match(byKind('usage').properties.object.description, /same-batch staged physical instance/);
  const action = COC_TOOLS.find(tool => tool.name === 'resolve').parameters.properties.action;
  assert.equal(action.properties.usage.type, 'string');
  assert.match(action.properties.weapon.description, /same physical object/);
  assert.match(action.properties.object.description, /Unified held physical instance/);
});
