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

test('a mixed temporal view retains canonical constraints and excludes unrelated state changes',()=>{
    const before=JSON.stringify(tools);
    const view=api.projectCapabilityTools(tools,new Set(['time','scene','npc-presence','npc-activity']));
    const projected=view.find(t=>t.name==='apply');
    const valid={effects:[
        {kind:'time',until:{days:0,time:'09:00'}},
        {kind:'scene',name:'here',activity:{summary:'The day staff have opened the doors.',basis:'established',service:'open'},why:'The staff arrived.'},
        {kind:'npc',name:'watchman',to:'away',why:'His round ended.'},
        {kind:'npc',name:'watchman',activity:{summary:'Awake after his round.',basis:'observed',wakefulness:'awake'}},
    ]};
    assert.equal(Check(projected.parameters,valid),true);
    assert.equal(Check(apply.parameters,valid),true);
    for(const bad of [
        {effects:[{kind:'time',until:{days:-1,time:'09:00'}}]},
        {effects:[{kind:'npc',name:'watchman',activity:{summary:'Resting.',basis:'invented',wakefulness:'awake'}}]},
        {effects:[{kind:'cash',currency:'USD',amount:20,to:'here'}]},
        {effects:[{kind:'npc',name:'watchman',defense:'dodge'}]},
    ]) assert.equal(Check(projected.parameters,bad),false);
    assert.equal(JSON.stringify(tools),before);
    assert.deepEqual(variant(projected,'time').properties.until,variant(apply,'time').properties.until);
    assert.ok(Buffer.byteLength(JSON.stringify(projected))<Buffer.byteLength(JSON.stringify(apply))*.3);
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
    assert.throws(()=>api.projectCapabilityTools(tools,new Set(['not-a-capability'])),/Unknown capability selection/);
    const cards=api.capabilityCatalogue(tools);
    assert.ok(cards.every(card=>card.version.length===64&&card.applicability.length<240));
});

test('public system projection replaces old declarations without rewriting their evidence',()=>{
    const declared=tools.filter(t=>t.name!=='resolve').map(({name,description,parameters})=>({name,description,parameters}));
    const messages=[{role:'system',content:'Canonical Keeper rules.',toolsAdded:declared,timestamp:1},
        {role:'user',content:[{type:'text',text:'Wait until nine.'}],timestamp:2}];
    const evidence=JSON.stringify(messages);
    const head=getCurrentSystemMessage(messages);
    const {toolsAdded,toolsRemoved,...system}=head;
    const selected=api.projectCapabilityTools(getCurrentTools(messages),new Set(['time','scene','npc-presence','npc-activity']));
    const request=[{...system,toolsAdded:selected},...messages.filter(m=>m.role!=='system')];
    assert.equal(JSON.stringify(messages),evidence);
    assert.deepEqual(getCurrentTools(request).map(t=>t.name),['look','lookup','recall','apply','ask','narrate']);
    const fields=variant(getCurrentTools(request).find(t=>t.name==='apply'),'npc').properties;
    assert.ok(fields.activity&&fields.to);
    assert.equal(fields.defense,undefined);
    assert.equal(fields.document,undefined);
});
