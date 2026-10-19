import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Check} from 'typebox/value';
import {getCurrentSystemMessage,getCurrentTools} from '@earendil-works/pi-ai';

const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(join(tmpdir(),'capability-catalogue-'));
await build({stdin:{contents:[
    "export {COC_TOOLS} from './extensions/kernel/tools.ts';",
    "export {offeredTools} from './extensions/kernel/lean-apply.ts';",
    "export * from './extensions/table/capability-catalogue.ts';",
].join('\n'),resolveDir:root,sourcefile:'capability-catalogue-test.ts'},
    outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
// The compiled fixture resolves external packages against the real repository.
const {symlink}=await import('node:fs/promises');
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));
const tools=api.offeredTools(api.COC_TOOLS,{});
const apply=tools.find(t=>t.name==='apply');
const variant=(tool,kind)=>tool.parameters.properties.effects.items.anyOf.find(v=>(v.properties.kind.const??v.properties.kind.enum?.[0])===kind);

test('parameter variants share one discovery identity without losing any canonical branch',()=>{
 const cards=api.capabilityCatalogue(tools);
 assert.equal(new Set(cards.map(card=>card.name)).size,cards.length,'discovery names must be unique');
 const moves=apply.parameters.properties.effects.items.anyOf.filter(v=>(v.properties.kind.const??v.properties.kind.enum?.[0])==='move');
 assert.ok(moves.length>1,'exercise the actual registered move variants');
 const detail=api.capabilityDetail(tools,['move']);assert.equal(detail.length,1);
 assert.deepEqual(detail[0].fields,{anyOf:moves});
 const changed=structuredClone(tools);variant(changed.find(t=>t.name==='apply'),'move').description='Changed bound variant';
 assert.notEqual(api.capabilityDetail(changed,['move'])[0].version,detail[0].version);
});

test('§228.1 the fixed view keeps every kind and its rule text; the canonical definition still validates',()=>{
    const before=JSON.stringify(tools);
    const view=api.fixedCapabilityTools(tools);
    assert.equal(api.fixedCapabilityTools(tools),view,'one view object per registered tool list');
    assert.equal(JSON.stringify(api.fixedCapabilityTools(tools)),JSON.stringify(view));
    assert.equal(JSON.stringify(tools),before,'the registered definitions are not touched');
    assert.deepEqual(view.map(t=>t.name),tools.map(t=>t.name));
    for(const tool of view)if(tool.name!=='apply')assert.equal(tool,tools.find(t=>t.name===tool.name));
    const projected=view.find(t=>t.name==='apply');
    const kinds=[...new Set(apply.parameters.properties.effects.items.anyOf.map(v=>v.properties.kind.const??v.properties.kind.enum[0]))];
    assert.deepEqual(projected.parameters.properties.effects.items.properties.kind.enum,kinds);
    assert.match(projected.description,/never send time for the same journey/);
    assert.match(projected.description,/npc-activity \(/);
    assert.ok(Buffer.byteLength(JSON.stringify(projected))<Buffer.byteLength(JSON.stringify(apply))*.3);
    const bad={effects:[{kind:'time',until:{days:-1,time:'09:00'}}]};
    assert.equal(Check(projected.parameters,bad),true,'the envelope is open');
    assert.equal(Check(apply.parameters,bad),false,'the registered definition still refuses it');
    const detail=api.capabilityDetail(tools,['time','npc-activity']);
    assert.deepEqual(detail.map(card=>card.name),['time','npc-activity']);
    assert.deepEqual(detail[0].fields,variant(apply,'time'));
    assert.ok(detail[1].fields.properties.activity&&!detail[1].fields.properties.defense);
});

test('readiness finds every missing purpose in the whole batch before any dispatcher action',()=>{
    const effects=[{kind:'time',minutes:360},{kind:'npc',name:'watchman',to:'away'},
        {kind:'npc',name:'watchman',activity:{summary:'Resting.',basis:'observed',wakefulness:'resting'}}];
    assert.deepEqual(api.missingEffectCapabilities(effects,tools,new Set(['time'])),['npc-presence','npc-activity']);
    assert.deepEqual(api.missingEffectCapabilities(effects,tools,new Set(['time','npc-presence','npc-activity'])),[]);
    assert.throws(()=>api.missingEffectCapabilities([{kind:'npc',name:'watchman',made_up:true}],tools,new Set()),/Unknown canonical effect field/);
});

test('new canonical fields require an explicit capability owner rather than disappearing',()=>{
    const copy=structuredClone(tools);
    variant(copy.find(t=>t.name==='apply'),'npc').properties.new_behavior={type:'string'};
    assert.throws(()=>api.capabilityCatalogue(copy),/fields need capability owners/);
    const cards=api.capabilityCatalogue(tools);
    assert.ok(cards.every(card=>card.version.length===64&&card.applicability.length<240));
});

test('public system projection replaces the declarations with the fixed view without rewriting their evidence',()=>{
    const declared=tools.filter(t=>t.name!=='resolve').map(({name,description,parameters})=>({name,description,parameters}));
    const messages=[{role:'system',content:'Canonical Keeper rules.',toolsAdded:declared,timestamp:1},
        {role:'user',content:[{type:'text',text:'Wait until nine.'}],timestamp:2}];
    const evidence=JSON.stringify(messages);
    const {toolsAdded,toolsRemoved,...system}=getCurrentSystemMessage(messages);
    const request=[{...system,toolsAdded:api.fixedCapabilityTools(getCurrentTools(messages))},...messages.filter(m=>m.role!=='system')];
    assert.equal(JSON.stringify(messages),evidence);
    assert.deepEqual(getCurrentTools(request).map(t=>t.name),declared.map(t=>t.name));
    assert.equal(getCurrentTools(request).find(t=>t.name==='apply').parameters.properties.effects.items.anyOf,undefined);
});
