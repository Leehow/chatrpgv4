/**
 * §215 (issue #112, live table 9e7g turns 30-31): the §209.6 readiness hold is for the Keeper's own decisions. A policy
 * clerk's declared move to a chosen, visited exit was blocked by the Mod-section readiness hold ("narration-craft:
 * Establishing a place", `before_apply:move`) before the Keeper's first request of the turn had been sent, every turn, and
 * the clerk can never "re-decide with the expanded request". Here the context hook is driven exactly as the kernel
 * extension's canonical gateway drives it: the gateway port names the call's host origin.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'clerk-write-readiness-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {installContextPolicy} from './extensions/table/context-runtime.ts';",resolveDir:root},
    outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));

function install(){
    const hooks=new Map(),bus=new Map(),rows=[];
    const on=(name,handler)=>{const list=bus.get(name)??[];list.push(handler);bus.set(name,list);};
    const pi={on:(name,handler)=>hooks.set(name,handler),events:{on,emit:(name,value)=>{for(const handler of bus.get(name)??[])handler(value);}},
        sendMessage(){},getAllTools:()=>[],getActiveTools:()=>[]};
    api.installContextPolicy(pi,row=>rows.push(row));
    // The captured package: narration-craft's "Establishing a place" is situational with `before_apply:move` (§203).
    const capsule={turn:{number:30,player_text:'I pay, take the streetcar back to last night\'s street and circle the house.'},recent:[],
        where:{scene:'rooming-house',clock:{at:'1920-10-13T11:32'}},present:[],
        mods:{instructions:[{mod:'narration-craft',version:'2.6.0',form:'indexed',index_contract_version:2,instruction:'Core.',
            sections:[{key:'narration-craft@2.6.0#6',heading:'Establishing a place',gates_open:true,topics:[],gates:[],triggers:['state:establish','before_apply:move'],
                applicability:{what:'Arriving somewhere.',not_for:'Staying put.',examples:[]}}]}]}};
    const binding={version:1,campaign:'game',worldline:'main',loop:0,turn:30,source_revision:'a'.repeat(64)};
    pi.events.emit('coc:capsule',{capsule,context:binding,epoch:'input-30'});
    return {hooks,rows,emit:pi.events.emit};
}
const move={effects:[{kind:'move',to:'neighborhood-gossip'}]};

test('§215 a policy clerk write is not held for package detail the Keeper has not been sent yet; the Keeper\'s own call still is',async()=>{
    const {hooks,rows,emit}=install();
    const origins=new Map([['clerk:run-30:s4/op1',{origin:'policy',run:'run-30',step:'run-30:s4',clerk:'declared_bookkeeping'}]]);
    emit('coc:operation-dispatcher',Object.freeze({dispatch:async()=>{throw Error('unused');},hostOrigin:id=>origins.get(id)}));
    // The clerk runs before the turn's first Keeper request, as in the evidence: nothing has been delivered yet.
    const clerk=await hooks.get('tool_call')({toolName:'apply',toolCallId:'clerk:run-30:s4/op1',input:move});
    assert.equal(clerk,undefined,'the declared move reaches admission and the kernel');
    const deferred=rows.find(row=>row.lane==='mod-discovery'&&row.event==='readiness_deferred');
    assert.deepEqual(deferred?.keys,['narration-craft@2.6.0#6'],'the section the write made due is recorded as owed to the Keeper\'s next request');
    assert.equal(deferred.origin,'policy');
    assert.equal(rows.some(row=>row.event==='readiness_expansion'),false);
    // The same call from the Keeper is held exactly as §209.6 says: it re-decides with the detail in view.
    const keeper=await hooks.get('tool_call')({toolName:'apply',toolCallId:'call-keeper-1|fc_1',input:move});
    assert.equal(keeper?.block,true);assert.match(keeper.reason,/Required package detail was absent/);
    assert.ok(rows.some(row=>row.lane==='mod-discovery'&&row.event==='readiness_expansion'));
});

test('§215 without a gateway port every call keeps the hold (fails closed)',async()=>{
    const {hooks}=install();
    const held=await hooks.get('tool_call')({toolName:'apply',toolCallId:'clerk:run-30:s4/op1',input:move});
    assert.equal(held?.block,true);
});
