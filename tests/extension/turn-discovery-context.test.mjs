import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getCurrentTools} from '@earendil-works/pi-ai';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'turn-discovery-context-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:[
    "export {installContextPolicy} from './extensions/table/context-runtime.ts';",
    "export {COC_TOOLS} from './extensions/kernel/tools.ts';",
    "export {offeredTools} from './extensions/kernel/lean-apply.ts';",
].join('\n'),resolveDir:root},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',
    format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));

test('normal context hooks declare the selected schema and hold a first unshown instruction before mutation',async t=>{
    const envNames=['COC_TURN_DISCOVERY','EXT_JEV_APIKEY'],old=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));
    process.env.COC_TURN_DISCOVERY='selective';process.env.EXT_JEV_APIKEY='test-only';
    const previousFetch=globalThis.fetch;
    t.after(()=>{globalThis.fetch=previousFetch;for(const name of envNames){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}});
    globalThis.fetch=async(_url,init)=>{
        const body=JSON.parse(init.body),cards=body.state.cards;
        return new Response(JSON.stringify({model:body.model,
            answers:Object.fromEntries(Object.keys(body.questions).map((key,i)=>[key,{type:'noul',
                noul:cards[i].name==='time'||cards[i].name==='pacing: Time'?.99:.01}])),
            usage:{input_tokens:30,output_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
    };
    const hooks=new Map(),bus=new Map(),rows=[],calls=[];
    const pi={on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>bus.set(name,handler),
        emit:(name,value)=>bus.get(name)?.(value)},sendMessage(){},
        getAllTools:()=>api.COC_TOOLS,getActiveTools:()=>api.COC_TOOLS.map(t=>t.name).filter(n=>n!=='resolve')};
    api.installContextPolicy(pi,e=>rows.push(e));
    const binding={version:1,campaign:'table',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64)};
    const cap={turn:{number:0,player_text:'Wait until nine.'},recent:[],module:{title:'Fixture'},style:{},
        where:{scene:'library',clock:{at:'1920-10-13T03:00'}},present:[],
        mods:{instructions:[{mod:'pacing',version:'2.0.0',form:'indexed',index_contract_version:2,instruction:'Core rules.',
            sections:[{key:'pacing@2.0.0#0',heading:'Time',gates_open:true,topics:[],gates:[],triggers:['before_apply:time'],
                applicability:{what:'Actual passage of time.',not_for:'Unattempted actions.',examples:[]},dependencies:['time']},
                {key:'pacing@2.0.0#1',heading:'Money',gates_open:true,topics:[],gates:[],triggers:['before_apply:cash'],
                    applicability:{what:'An actual payment.',not_for:'A quote.',examples:[]},dependencies:['cash']}]}]}};
    await hooks.get('session_start')();
    bus.get('coc:kernel-bridge')({campaign:'table',call:async(method,args)=>{
        calls.push(method);
        if(method==='table.capsule')return{...cap,_context:binding};
        if(method==='table.untold')return{};
        if(method==='mods.sections')return{sections:args.keys.map(key=>({key,text:'Immutable '+key}))};
        return{cards:[],_snapshot:'fixture'};
    }});
    bus.get('coc:loop-engine')({engine:'hybrid-v1',prescreen:'run'});
    bus.get('coc:capsule')({capsule:cap,context:binding,epoch:'input-1'});
    const declared=api.offeredTools(api.COC_TOOLS,{}).filter(t=>t.name!=='resolve')
        .map(({name,description,parameters})=>({name,description,parameters}));
    const messages=[{role:'system',content:'Keeper core.',toolsAdded:declared,timestamp:0},
        {role:'user',content:[{type:'text',text:'Wait until nine.'}],timestamp:1},
        {role:'custom',customType:'coc-capsule',content:JSON.stringify(cap),
            details:{context:binding,epoch:'input-1'},timestamp:2}];
    const original=JSON.stringify(messages);
    const ctx={model:{contextWindow:500000},getContextUsage:()=>({percent:1}),
        sessionManager:{getBranch:()=>[],buildSessionProjection:()=>({messages})}};
    const outgoing=await hooks.get('context')({messages:messages.filter(m=>m.role!=='system')},ctx);
    const withSystem=hooks.get('context_with_system')({messages:[messages[0],...outgoing.messages]},ctx);
    const tools=getCurrentTools(withSystem.messages);
    const apply=tools.find(t=>t.name==='apply');
    assert.deepEqual(apply.parameters.properties.effects.items.anyOf.map(v=>v.properties.kind.enum?.[0]??v.properties.kind.const),['time']);
    const sectionMessages=outgoing.messages.filter(m=>m.customType==='coc-mod-sections');
    assert.equal(sectionMessages.length,1);
    assert.equal(JSON.parse(sectionMessages[0].content).sections[0].section,'Time');
    hooks.get('before_provider_request')({payload:{input:outgoing.messages,tools}});
    assert.ok(rows.some(r=>r.lane==='mod-discovery'&&r.event==='delivered'&&r.delivered));
    const hold=await hooks.get('tool_call')({toolName:'apply',toolCallId:'fixture-call',
        input:{effects:[{kind:'cash',amount:20,currency:'USD',to:'here'}]}});
    assert.equal(hold.block,true);
    assert.match(hold.reason,/No world change was committed/);
    assert.ok(!calls.includes('table.apply'));
    assert.equal(JSON.stringify(messages),original);
    await hooks.get('session_shutdown')();
});
