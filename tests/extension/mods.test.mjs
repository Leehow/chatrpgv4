import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import modsExtension from '../../extensions/mods/index.ts';
import {registerModsPanel} from '../../pipicoc/mods.ts';
import {readerCommand} from '../../extensions/module/reader.ts';

function piSurface() {
  const hooks = new Map();
  return {events:new EventEmitter(), hooks, on(name,fn){hooks.set(name,fn);}};
}

test('the shared Agent adapter uses tools and disables recursive extensions', () => {
  const command = readerCommand('provider/model','/task/prompt.md','low');
  assert.ok(command.includes('--no-extensions'));
  assert.equal(command[command.indexOf('--tools')+1],'read,write,edit,bash');
});

test('accepted definitions are attached by the host and an audit refusal reaches the Keeper', async () => {
  const pi = piSurface();
  let bridge;
  pi.events.on('coc:mods-bridge', value=>{bridge=value;});
  modsExtension(pi);
  let role;
  const calls=[];
  pi.events.emit('coc:kernel-bridge',{call:async(method,params)=>{
    calls.push({method,params});
    if(method==='mods.job'){role=params.role;return{enabled:true,accepted:true,job:'owned-job'};}
    if(role==='create') return{definition:{name:'Launcher'},provenance:{mod:'enhanced-items'}};
    return{missing:[{name:'Unregistered gun',category:'weapon',reason:'It is fired in the draft'}]};
  }});
  const payload={campaign:'c1',effects:[{kind:'define',name:'Launcher',category:'weapon',description:'A fictional launcher'}]};
  await bridge.prepare('apply',payload);
  assert.equal(payload.effects[0]._definition.name,'Launcher');
  await assert.rejects(()=>bridge.prepare('narrate',{campaign:'c1',text:'The gun fires.'}), error=>error.details?.reason==='mod_narrative_repair');
  // Every write verb first asks what deferred registration is ready; nothing is here, so nothing lands.
  assert.deepEqual(calls.map(c=>c.method),['mods.queued','mods.job','mods.accept','mods.queued','mods.job','mods.accept']);
});

test('the panel adapter binds mutations to its own campaign and ignores supplied campaign ids', async () => {
  const symbol=Symbol.for('pipiui.ext-invoke.registry');
  const prior=globalThis[symbol];
  const handlers=new Map();
  globalThis[symbol]={version:1,register(_id,method,handler){handlers.set(method,handler);return()=>{};}};
  try {
    const pi=piSurface();const calls=[];
    registerModsPanel(pi);
    pi.events.emit('coc:kernel-bridge',{campaign:'selected',call:async(method,params)=>{calls.push({method,params});return{};}});
    await handlers.get('mods.configure')({campaign:'another',id:'natural-npc',enabled:false});
    assert.equal(calls[0].params.campaign,'selected');
    await handlers.get('mods.document.apply')({campaign:'another',actor:'Investigator',name:'Notebook',version:'host-version',action:'reset'});
    assert.equal(calls[1].params.campaign,'selected');
    assert.equal(calls[1].method,'mods.document.apply');
    await handlers.get('mods.order')({order:['enhanced-items','natural-npc']});
    assert.equal(calls[2].params.campaign,'selected');
    pi.events.emit('coc:kernel-bridge',{campaign:'selected',call:async()=>{throw Object.assign(new Error('Paper changed'),{code:'revision_conflict'});}});
    assert.deepEqual(await handlers.get('mods.document.apply')({name:'Notebook',action:'save',text:'draft'}),
      {ok:false,error:{code:'revision_conflict',message:'Paper changed'}});
    pi.events.emit('coc:kernel-bridge',{call:async()=>({})});
    await assert.rejects(()=>handlers.get('mods.configure')({id:'natural-npc',enabled:true}),/Select a campaign/);
  } finally {globalThis[symbol]=prior;}
});

test('a Mods answer carries the session language words, and its refusals carry codes', async () => {
  const symbol=Symbol.for('pipiui.ext-invoke.registry');
  const prior=globalThis[symbol];
  const handlers=new Map();
  globalThis[symbol]={version:1,register(_id,method,handler){handlers.set(method,handler);return()=>{};}};
  try {
    const contentRoot=await mkdtemp(join(tmpdir(),'coc-mods-words-'));
    // `zz` is this fixture's authored tag and its default; `en` ships a seed beside it, so both
    // answer projected and neither reaches a lane (contract §23).
    await writeFile(join(contentRoot,'languages.json'),JSON.stringify({source:'zz',default:'zz',suggested:['zz','en']}));
    for(const tag of ['zz','en']) {
      await mkdir(join(contentRoot,'ui',tag),{recursive:true});
      await writeFile(join(contentRoot,'ui',tag,'mods.json'),JSON.stringify({install:`${tag} install`}));
    }
    const pi=piSurface();
    registerModsPanel(pi);
    // No runtime yet: the panel is told the game runtime is not ready, by code.
    const cold=await handlers.get('mods.list')({}).then(()=>undefined,error=>error);
    assert.equal(cold.code,'runtime_unavailable');
    pi.events.emit('coc:kernel-bridge',{campaign:'selected',runtime:{contentRoot},call:async()=>({mods:[]})});
    const listed=await handlers.get('mods.list')({});
    assert.deepEqual(listed.mods,[]);
    assert.equal(listed.ui.tag,'zz');
    assert.equal(listed.ui.words.mods.install,'zz install');
    pi.events.emit('coc:table-open',{campaign:'selected',open:{campaign:{play_language:'en'}}});
    assert.equal((await handlers.get('mods.list')({})).ui.words.mods.install,'en install');
    assert.throws(()=>handlers.get('mods.install')(['not','an','object']),{code:'invalid_params'});
    pi.events.emit('coc:kernel-bridge',{runtime:{contentRoot},call:async()=>({})});
    const unbound=await handlers.get('mods.configure')({id:'natural-npc',enabled:true}).then(()=>undefined,error=>error);
    assert.equal(unbound.code,'campaign_unbound');
  } finally {globalThis[symbol]=prior;}
});

test('one apply materializes its definitions together and keeps the batch order', async () => {
  const pi = piSurface();
  let bridge;
  pi.events.on('coc:mods-bridge', value=>{bridge=value;});
  modsExtension(pi);
  const cwd = await mkdtemp(join(tmpdir(), 'coc-mods-'));
  let running = 0, peak = 0;
  const accepted = [];
  pi.events.emit('coc:kernel-bridge',{
    call:async(method,params)=>{
      // The host asks what deferred registration is ready before it writes anything.
      if(method==='mods.queued') return {effects:[],unfinished:[]};
      if(method==='mods.job') return {enabled:true, accepted:false, job:`job-${params.input.name}`, cwd, system_prompt:join(cwd,'prompt.md'), role:'create'};
      accepted.push(params.job);
      return {definition:{name:params.job.replace('job-','')}, provenance:{mod:'enhanced-items', job:params.job}};
    },
    runtime:{
      async runTask() {
        running += 1; peak = Math.max(peak, running);
        await new Promise(resolve=>setTimeout(resolve, 20));
        running -= 1;
        return {ok:true, code:0, timedOut:false, ms:20, stderr:'', command:[]};
      },
      async check() { return {ok:true}; },
    },
  });
  const payload = {campaign:'c1', effects:[
    {kind:'define', name:'A', category:'item'},
    {kind:'clue', clue:'A note'},
    {kind:'define', name:'B', category:'item'},
    {kind:'define', name:'C', category:'item'},
  ]};
  await bridge.prepare('apply', payload);
  assert.ok(peak > 1, `definitions ran one at a time (peak ${peak})`);
  assert.deepEqual(payload.effects.map(effect=>effect._definition?.name ?? null), ['A', null, 'B', 'C']);
  assert.deepEqual([...accepted].sort(), ['job-A','job-B','job-C']);
});

test('a definition that fails is reported in batch order while its siblings still land', async () => {
  const pi = piSurface();
  let bridge;
  pi.events.on('coc:mods-bridge', value=>{bridge=value;});
  modsExtension(pi);
  const cwd = await mkdtemp(join(tmpdir(), 'coc-mods-'));
  const attempted = [];
  pi.events.emit('coc:kernel-bridge',{
    call:async(method,params)=>{
      // The host asks what deferred registration is ready before it writes anything.
      if(method==='mods.queued') return {effects:[],unfinished:[]};
      if(method==='mods.job') return {enabled:true, accepted:false, job:`job-${params.input.name}`, cwd:join(cwd, params.input.name), system_prompt:join(cwd,'prompt.md'), role:'create'};
      return {definition:{name:params.job.replace('job-','')}, provenance:{mod:'enhanced-items', job:params.job}};
    },
    runtime:{
      async runTask(task) {
        const name = task.request.cwd.split('/').pop();
        attempted.push(name);
        await mkdir(task.request.cwd, {recursive:true});
        if (name === 'B') return {ok:false, code:null, timedOut:true, ms:5, stderr:'', command:[]};
        return {ok:true, code:0, timedOut:false, ms:5, stderr:'', command:[]};
      },
      async check() { return {ok:true}; },
    },
  });
  const payload = {campaign:'c1', effects:[
    {kind:'define', name:'A', category:'item'},
    {kind:'define', name:'B', category:'item'},
    {kind:'define', name:'C', category:'item'},
  ]};
  await assert.rejects(()=>bridge.prepare('apply', payload), error=>error.details?.reason==='mod_agent_failed' && error.details?.timed_out===true);
  // Sibling definitions were not cancelled by the failure: their jobs are accepted and retained.
  assert.deepEqual([...attempted].sort(), ['A','B','C']);
  assert.equal(payload.effects[0]._definition, undefined);
  assert.equal(JSON.parse(await readFile(join(cwd,'A','run-1.json'),'utf8')).ok, true);
});

test('two identical defines in one batch share the single job the kernel keys them to', async () => {
  const pi = piSurface();
  let bridge;
  pi.events.on('coc:mods-bridge', value=>{bridge=value;});
  modsExtension(pi);
  const cwd = await mkdtemp(join(tmpdir(), 'coc-mods-'));
  let runs = 0;
  pi.events.emit('coc:kernel-bridge',{
    call:async(method,params)=>{
      // The host asks what deferred registration is ready before it writes anything.
      if(method==='mods.queued') return {effects:[],unfinished:[]};
      if(method==='mods.job') return {enabled:true, accepted:false, job:`job-${params.input.name}`, cwd, system_prompt:join(cwd,'prompt.md'), role:'create'};
      return {definition:{name:params.job.replace('job-','')}, provenance:{mod:'enhanced-items', job:params.job}};
    },
    runtime:{
      async runTask() { runs += 1; return {ok:true, code:0, timedOut:false, ms:1, stderr:'', command:[]}; },
      async check() { return {ok:true}; },
    },
  });
  const payload = {campaign:'c1', effects:[
    {kind:'define', name:'火柴', category:'item', description:'一盒火柴'},
    {kind:'define', name:'火柴', category:'item', description:'一盒火柴'},
  ]};
  await bridge.prepare('apply', payload);
  assert.equal(runs, 1, 'one job directory must not be written by two concurrent agents');
  assert.deepEqual(payload.effects.map(effect=>effect._definition.name), ['火柴','火柴']);
});

test('the default pool clears one opening in a single wave, and the override still bounds it', async (t) => {
  const previous = process.env.PI_COC_MOD_CONCURRENCY;
  t.after(() => { if (previous === undefined) delete process.env.PI_COC_MOD_CONCURRENCY; else process.env.PI_COC_MOD_CONCURRENCY = previous; });
  const cwd = await mkdtemp(join(tmpdir(), 'coc-mods-'));
  // An opening registers the whole starting inventory at once; the runs on record carried five,
  // seven and eight rows. A width below that pays the slowest child again in a short second wave.
  const opening = ['折叠相机','皮面记事本','铅笔','相机胶卷','报社介绍信','行李箱','外套'];
  const peakOf = async () => {
    const pi = piSurface();
    let bridge;
    pi.events.on('coc:mods-bridge', value=>{bridge=value;});
    modsExtension(pi);
    let running = 0, peak = 0;
    pi.events.emit('coc:kernel-bridge',{
      call:async(method,params)=>{
        // The host asks what deferred registration is ready before it writes anything.
        if(method==='mods.queued') return {effects:[],unfinished:[]};
        if(method==='mods.job') return {enabled:true, accepted:false, job:`job-${params.input.name}`, cwd, system_prompt:join(cwd,'prompt.md'), role:'create'};
        return {definition:{name:params.job.replace('job-','')}, provenance:{mod:'enhanced-items', job:params.job}};
      },
      runtime:{
        async runTask() {
          running += 1; peak = Math.max(peak, running);
          await new Promise(resolve=>setTimeout(resolve, 20));
          running -= 1;
          return {ok:true, code:0, timedOut:false, ms:20, stderr:'', command:[]};
        },
        async check() { return {ok:true}; },
      },
    });
    await bridge.prepare('apply', {campaign:'c1', effects:opening.map(name=>({kind:'define', name, category:'item'}))});
    return peak;
  };
  delete process.env.PI_COC_MOD_CONCURRENCY;
  assert.equal(await peakOf(), opening.length, 'the default pool split one opening into more than one wave');
  process.env.PI_COC_MOD_CONCURRENCY = '2';
  assert.equal(await peakOf(), 2, 'the configured width no longer bounds the fan-out');
});

test('审计超时放行交付，审计死掉照旧拒绝（契约 26.1）', async () => {
  // A gate that cannot reach a verdict says nothing about the delivery. Refusing on a deadline sent
  // the keeper to rewrite words it had no finding against, and one real turn spent three deadlines
  // on words written in the first thirty seconds while the player saw none of them.
  async function bridgeFor(outcome) {
    const pi = piSurface();
    let bridge;
    pi.events.on('coc:mods-bridge', value => { bridge = value; });
    modsExtension(pi);
    const cwd = await mkdtemp(join(tmpdir(), 'coc-audit-'));
    pi.events.emit('coc:kernel-bridge', {
      call: async (method) => method === 'mods.job'
        ? {enabled: true, accepted: false, job: 'job-audit', cwd, system_prompt: join(cwd, 'prompt.md'), role: 'audit'}
        : {},
      runtime: {
        async runTask(task) { await mkdir(task.request.cwd, {recursive: true}); return outcome; },
        async check() { return {ok: true}; },
      },
    });
    return bridge;
  }

  // A deadline: the delivery goes through, and the turn is simply not audited.
  const timedOut = await bridgeFor({ok: false, code: null, timedOut: true, ms: 180000, stderr: '', command: []});
  await timedOut.prepare('narrate', {campaign: 'c1', text: '她把手套拧得更紧。'});

  // Anything else still refuses: a dead agent has not judged the delivery either, but it says
  // something about the run that a retry can act on.
  const died = await bridgeFor({ok: false, code: 1, timedOut: false, ms: 40, stderr: 'boom', command: []});
  await assert.rejects(() => died.prepare('narrate', {campaign: 'c1', text: '她把手套拧得更紧。'}),
    error => error.details?.reason === 'mod_agent_failed' && error.details?.timed_out !== true);
});

test('deferred registration is resumed with the id the table mints, and a failure never costs the turn', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'coc-mods-'));
  const ready = {effects:[{kind:'define', name:'Kit', category:'item', _definition:{name:'Kit'}, _provenance:{mod:'enhanced-items'}}], unfinished:[]};
  const table = (applyResult) => {
    const pi = piSurface();
    let bridge;
    pi.events.on('coc:mods-bridge', value=>{bridge=value;});
    modsExtension(pi);
    const calls=[];
    pi.events.emit('coc:kernel-bridge',{
      // The kernel extension owns the ordinal; inventing an id here is what failed every write verb.
      mintCallId: () => 't7-c4',
      call:async(method,params)=>{
        calls.push({method,params});
        if(method==='mods.queued') return params.discard ? {effects:[],unfinished:[],discarded:1} : ready;
        if(method==='table.apply') return applyResult();
        return {};
      },
      runtime:{async runTask(){return {ok:true, code:0, timedOut:false, ms:1, stderr:'', command:[]};}, async check(){return {ok:true};}},
    });
    return {bridge, calls, cwd};
  };

  const landed = table(() => ({receipts:[]}));
  await landed.bridge.prepare('resolve', {campaign:'c1'});
  const applied = landed.calls.find(c=>c.method==='table.apply');
  assert.equal(applied.params.call_id, 't7-c4', 'the resume has to use the id the table minted');
  assert.equal(applied.params.effects.length, 1);

  const refused = table(() => { throw new Error('the deferred batch did not land'); });
  // Bookkeeping must not cost the player their turn, and the markers must not outlive their usefulness.
  await refused.bridge.prepare('resolve', {campaign:'c1'});
  assert.ok(refused.calls.some(c=>c.method==='mods.queued' && c.params.discard === true),
    'a resume that cannot land has to drop its markers so the gear reads as unregistered again');

  // A turn the Keeper answers without writing anything never reaches prepare, so player_input carries it.
  const quiet = table(() => ({receipts:[]}));
  await quiet.bridge.after('player_input', {campaign:'c1'});
  assert.equal(quiet.calls.find(c=>c.method==='table.apply')?.params.call_id, 't7-c4');
  const other = table(() => ({receipts:[]}));
  await other.bridge.after('apply', {campaign:'c1'});
  assert.equal(other.calls.some(c=>c.method==='table.apply'), false, 'only the verb that opens the turn resumes afterwards');
});

test('a readable carrier has its reading prepared when it is acquired, and a plain object has none', async () => {
  const pi = piSurface();
  let bridge;
  pi.events.on('coc:mods-bridge', value=>{bridge=value;});
  modsExtension(pi);
  const calls=[];
  pi.events.emit('coc:kernel-bridge',{
    mintCallId: () => 't1-c1',
    call:async(method,params)=>{
      calls.push({method,params});
      if(method==='mods.queued') return {effects:[],unfinished:[]};
      // The lookup is the whole signal here; preparing the reading itself needs a runtime this mock lacks,
      // and its failure has to stay harmless, because a reading is a projection and never a turn's business.
      if(method==='mods.document.view') return {name:params.name, actor:params.actor};
      return {};
    },
    runtime:{home:'/nowhere', resourceRoot:'/nowhere',
      async runTask(){return {ok:false, code:1, timedOut:false, ms:1, stderr:'', command:[]};}, async check(){return {ok:true};}},
  });

  // The document rides on the definition, not the placement, which is the shape adoption actually uses.
  await bridge.after('apply', {campaign:'c1', effects:[
    {kind:'define', name:'Notebook', category:'item', _definition:{name:'Notebook', document:{text:'', presentation:'notebook'}}},
    {kind:'object', name:"Hayes's notebook", to:'Thomas Hayes', definition:'Notebook', adopt:'notebook'},
    {kind:'object', name:'Crowbar', to:'Thomas Hayes'},
  ]});
  const viewed = () => calls.filter(c=>c.method==='mods.document.view');
  for (let round=0; round<60 && !viewed().length; round++) await new Promise(resolve=>setTimeout(resolve,5));
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.deepEqual(viewed().map(c=>c.params.name), ["Hayes's notebook"]);
  assert.equal(viewed()[0].params.actor, 'Thomas Hayes');
});

test('a definition child gets no shell, and its brief sends it nowhere outside its own directory', async () => {
  const pi = piSurface();
  let bridge;
  pi.events.on('coc:mods-bridge', value=>{bridge=value;});
  modsExtension(pi);
  const cwd = await mkdtemp(join(tmpdir(), 'coc-mods-'));
  const requests=[];
  pi.events.emit('coc:kernel-bridge',{
    call:async(method,params)=>{
      if(method==='mods.queued') return {effects:[],unfinished:[]};
      if(method==='mods.job') return {enabled:true, accepted:false, job:'job-A', cwd, system_prompt:join(cwd,'prompt.md'), role:'create', mod:'enhanced-items', digest:'d'};
      return {definition:{name:'A'}, provenance:{mod:'enhanced-items'}};
    },
    runtime:{
      async runTask(task){ requests.push(task.request); return {ok:true, code:0, timedOut:false, ms:1, stderr:'', command:[]}; },
      async check(){ return {ok:true}; },
    },
  });
  await bridge.prepare('apply', {campaign:'c1', effects:[{kind:'define', name:'A', category:'item'}]});
  assert.equal(requests.length, 1);
  // Handed a shell, children spent most of their calls reading the packaged app and the build output.
  assert.equal(requests[0].tools, 'read,write,edit');
  assert.doesNotMatch(requests[0].brief, /coc-read-check|bash/);
  assert.match(requests[0].brief, /Nothing outside this directory/);
});

test('the reader command honours a narrowed allowlist and keeps the reading default otherwise', () => {
  const wide = readerCommand('provider/model','/task/prompt.md','low');
  assert.equal(wide[wide.indexOf('--tools')+1], 'read,write,edit,bash');
  const narrowed = readerCommand('provider/model','/task/prompt.md','low',false,false,undefined,'read,write,edit');
  assert.equal(narrowed[narrowed.indexOf('--tools')+1], 'read,write,edit');
});
