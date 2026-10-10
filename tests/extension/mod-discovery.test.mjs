import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'mod-discovery-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export * from './extensions/table/mod-discovery.ts';",resolveDir:root},
    outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const {createModDiscovery}=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));
const binding={campaign:'table',worldline:'main',loop:0,turn:1,source_revision:'source-1'};
const calls=()=>({apply:new Set(),resolve:new Set()});
const section=(key,heading)=>({key,heading,gates_open:true,topics:[],gates:[],triggers:[],
    category:'Test',applicability:{what:'Rules for '+heading,not_for:'Unrelated events.',examples:[]}});
const capsule=()=>({turn:{player_text:'Wait until the library opens.'},where:{scene:'library',clock:{at:'1920-10-13T03:00'}},
    present:[],mods:{instructions:[{mod:'test',version:'2.0.0',form:'indexed',index_contract_version:2,
        sections:[section('test@2.0.0#0','Time'),section('test@2.0.0#1','Money')]}]}});
const read=(log)=>async(method,args)=>{
    assert.equal(method,'mods.sections');log.push(args.keys);
    return{sections:args.keys.map(key=>({key,text:'Full immutable instructions '+key}))};
};
test('selective delivery reads only selected detail, with scoped adapter bindings',async()=>{
    const reads=[],events=[];
    const controller=createModDiscovery({read:read(reads),record:e=>events.push(e),mode:()=> 'selective',
        decision:()=>({decide:async(batch,lease)=>{
            assert.deepEqual(batch.scope,lease.context.scope);assert.deepEqual(batch.readSet,lease.context.readSet);
            return{batchId:batch.id,model:batch.model,status:'complete',
                answers:Object.fromEntries(batch.questions.map((q,i)=>[q.key,{status:'answered',type:'noul',
                    noul:batch.state.cards[i].name.endsWith('Time')?.99:.01}]))};
        }})});
    const message=await controller.message(capsule(),binding,new AbortController().signal,calls());
    assert.equal(message.details.mod_sections.status,'selected');
    assert.deepEqual(reads,[['test@2.0.0#0']]);
    assert.equal(JSON.parse(message.content).sections.length,1);
    assert.ok(events.some(e=>e.event==='selection'));
    controller.clear();
});
test('unavailable selection supplies the complete locked view with an explicit fallback',async()=>{
    const reads=[];
    const controller=createModDiscovery({read:read(reads),record:()=>{},mode:()=> 'selective',decision:()=>undefined});
    const message=await controller.message(capsule(),binding,new AbortController().signal,calls());
    assert.equal(message.details.mod_sections.status,'full');
    assert.equal(JSON.parse(message.content).sections.length,2);
    assert.deepEqual(reads,[['test@2.0.0#0','test@2.0.0#1']]);
    controller.clear();
});
test('an oversized complete view reports capacity rather than delivering a truncated selection',async()=>{
    const controller=createModDiscovery({read:read([]),record:()=>{},mode:()=> 'full',decision:()=>undefined,maxBytes:10});
    await assert.rejects(controller.message(capsule(),binding,new AbortController().signal,calls()),/mod_discovery_capacity/);
    controller.clear();
});
