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
  assert.deepEqual(calls.map(c=>c.method),['mods.job','mods.accept','mods.job','mods.accept']);
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
    await writeFile(join(contentRoot,'languages.json'),JSON.stringify({default:'zz',
      languages:{zz:{autonym:'Zz'},en:{autonym:'English'}}}));
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
