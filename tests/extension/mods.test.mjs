import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
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
