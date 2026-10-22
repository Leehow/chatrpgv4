import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getCurrentTools} from '@earendil-works/pi-ai';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'single-keeper-fixed-tools-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:[
    "export {installContextPolicy} from './extensions/table/context-runtime.ts';",
    "export {COC_TOOLS} from './extensions/kernel/tools.ts';",
    "export {offeredTools} from './extensions/kernel/lean-apply.ts';",
].join('\n'),resolveDir:root},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',
    format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));

async function table(t,flag){
    const names=['PI_COC_FIXED_TOOLS','COC_TURN_DISCOVERY','EXT_JEV_APIKEY'],old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
    t.after(()=>{for(const name of names){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}});
    for(const name of names)delete process.env[name];
    if(flag)process.env.PI_COC_FIXED_TOOLS='1';
    const hooks=new Map(),bus=new Map(),rows=[];
    const pi={on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>bus.set(name,handler),
        emit:(name,value)=>bus.get(name)?.(value)},sendMessage(){},
        getAllTools:()=>api.COC_TOOLS,getActiveTools:()=>api.COC_TOOLS.map(tool=>tool.name)};
    let lookup;
    api.installContextPolicy(pi,row=>rows.push(row));
    const listen=bus.get('coc:capability-discovery');
    bus.set('coc:capability-discovery',value=>{lookup=value?.lookup;listen?.(value);});
    const binding={version:1,campaign:'table',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64)};
    const cap={turn:{number:0,player_text:'I pay for the coffee.'},recent:[],module:{title:'Fixture'},style:{},
        where:{scene:'diner',clock:{at:'1920-10-13T09:00'}},present:[],mods:{instructions:[]}};
    await hooks.get('session_start')();
    bus.get('coc:kernel-bridge')({campaign:'table',call:async method=>{
        if(method==='table.capsule')return{...cap,_context:binding};
        if(method==='table.untold')return{};
        return{cards:[],_snapshot:'fixture'};
    }});
    bus.get('coc:loop-engine')({engine:'hybrid-v1',prescreen:'run',singleKeeper:true});
    bus.get('coc:capsule')({capsule:cap,context:binding,epoch:'input-1'});
    const declared=api.offeredTools(api.COC_TOOLS,{}).map(({name,description,parameters})=>({name,description,parameters}));
    const messages=[{role:'system',content:'Keeper core.',toolsAdded:declared,timestamp:0},
        {role:'user',content:[{type:'text',text:'I pay for the coffee.'}],timestamp:1},
        {role:'custom',customType:'coc-capsule',content:JSON.stringify(cap),details:{context:binding,epoch:'input-1'},timestamp:2}];
    const ctx={model:{contextWindow:500000},getContextUsage:()=>({percent:1}),
        sessionManager:{getBranch:()=>[],buildSessionProjection:()=>({messages})}};
    const request=async()=>{
        const outgoing=await hooks.get('context')({messages:messages.filter(m=>m.role!=='system')},ctx);
        const withSystem=hooks.get('context_with_system')({messages:[messages[0],...outgoing.messages]},ctx);
        return getCurrentTools(withSystem?.messages??[messages[0],...outgoing.messages]);
    };
    return{hooks,rows,request,lookup:()=>lookup};
}

test('PI_COC_FIXED_TOOLS gives the single Keeper the fixed list and discloses apply detail in the conversation',async t=>{
    // Without the flag the single Keeper keeps the canonical apply declaration.
    const control=await (await table(t,false)).request();
    assert.ok(control.find(tool=>tool.name==='apply').parameters.properties.effects.items.anyOf.length>10);
    const {hooks,rows,request,lookup}=await table(t,true);
    const first=await request(),second=await request();
    // §228.1: the same bytes on every request; only apply's effects become the kind envelope.
    assert.equal(JSON.stringify(first),JSON.stringify(second));
    assert.deepEqual(first.map(tool=>tool.name),control.map(tool=>tool.name));
    for(const tool of first.filter(tool=>tool.name!=='apply'))
        assert.equal(JSON.stringify(tool),JSON.stringify(control.find(entry=>entry.name===tool.name)));
    const apply=first.find(tool=>tool.name==='apply');
    assert.equal(apply.parameters.properties.effects.items.anyOf,undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(apply))*3<Buffer.byteLength(JSON.stringify(control.find(tool=>tool.name==='apply'))));
    // No Jev selection is asked for on this path.
    assert.ok(!rows.some(row=>row.lane==='capability-discovery'&&['selected','fallback'].includes(row.event)));
    // §228.3: a write's undelivered detail rides on its own result, once for the input.
    const input={effects:[{kind:'cash',amount:-0.1,currency:'USD',why:'coffee'}]};
    assert.equal(await hooks.get('tool_call')({toolName:'apply',toolCallId:'pay',input}),undefined);
    const attached=await hooks.get('tool_result')({toolName:'apply',toolCallId:'pay',input,isError:true,details:{},
        content:[{type:'text',text:'refused'}]});
    const disclosed=JSON.parse(attached.content.at(-1).text);
    assert.equal(disclosed.kind,'disclosed_detail');
    assert.deepEqual(disclosed.capability_detail.map(card=>card.name),['cash']);
    await hooks.get('tool_call')({toolName:'apply',toolCallId:'pay-again',input});
    assert.equal(await hooks.get('tool_result')({toolName:'apply',toolCallId:'pay-again',input,isError:false,details:{},
        content:[{type:'text',text:'ok'}]}),undefined,'detail is attached once per input');
    // §228.4: a named lookup reads detail.
    const read=await lookup()({kind:'capability',name:'time'});
    assert.deepEqual(read.capabilities.map(card=>card.name),['time']);
    assert.ok(read.capabilities[0].detail);
    // A query that is exactly a kind reads its detail without a decision owner (none exists on this path).
    const byKind=await lookup()({kind:'capability',query:'object'});
    assert.ok(byKind.capabilities.length>1&&byKind.capabilities.every(card=>card.detail));
    assert.equal((await lookup()({kind:'capability',query:'how do I pay'})).status,'index_fallback');
});
