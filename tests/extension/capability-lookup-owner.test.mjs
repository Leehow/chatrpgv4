// Contract §209.14 (issue #112 live 9e7, turns 22 and 24): the Keeper's purpose lookup is a foreground read. It runs
// after the Keeper's own inference, which on a real table outlasts the 12 s optional preparation allowance, so it is owned
// by the current step's read owner, not by that expired allowance; the per-input selector budget is not renewed, and a
// missing owner is still an explicit no-commit full fallback.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'capability-lookup-owner-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:[
    "export {installContextPolicy} from './extensions/table/context-runtime.ts';",
    "export {COC_TOOLS} from './extensions/kernel/tools.ts';",
    "export {offeredTools} from './extensions/kernel/lean-apply.ts';",
    "export {CLERK_TYPE} from './extensions/table/context-policy.ts';",
].join('\n'),resolveDir:root},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',
    format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));

const QUERY='Record the fare the investigator pays the cab driver.';

/** One input on the installed context hooks: a selected first request, then the Keeper's model time past the allowance. */
async function table(t,{owner,waitMs=2100}){
    const envNames=['COC_TURN_DISCOVERY','EXT_JEV_APIKEY','PI_COC_JEV_PRESELECT','PI_COC_JEV_PRESELECT_ALLOWANCE_MS'],old=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));
    process.env.COC_TURN_DISCOVERY='selective';process.env.EXT_JEV_APIKEY='test-only';
    process.env.PI_COC_JEV_PRESELECT='0';process.env.PI_COC_JEV_PRESELECT_ALLOWANCE_MS='2000';
    const previousFetch=globalThis.fetch;
    t.after(()=>{globalThis.fetch=previousFetch;for(const name of envNames){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}});
    const seen={fetched:0,lookups:0,reserved:0,settled:0};
    globalThis.fetch=async(_url,init)=>{
        seen.fetched++;
        const body=JSON.parse(init.body),cards=body.state.cards,lookup=body.state.request===QUERY;
        if(lookup)seen.lookups++;
        return new Response(JSON.stringify({model:body.model,
            answers:Object.fromEntries(Object.keys(body.questions).map((key,i)=>[key,{type:'noul',
                noul:cards[i].name===(lookup?'cash':'time')?.99:.01}])),
            usage:{input_tokens:30,output_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
    };
    const hooks=new Map(),bus=new Map(),rows=[];let lookup;
    const pi={on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>bus.set(name,handler),
        emit:(name,value)=>{if(name==='coc:capability-discovery')lookup=value?.lookup;bus.get(name)?.(value);}},sendMessage(){},
        getAllTools:()=>api.COC_TOOLS,getActiveTools:()=>api.COC_TOOLS.map(t=>t.name).filter(n=>n!=='resolve')};
    api.installContextPolicy(pi,e=>rows.push(e));
    const binding={version:1,campaign:'table',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64)};
    const cap={turn:{number:0,player_text:'I hail a night cab and ride to the address.'},recent:[],module:{title:'Fixture'},style:{},
        where:{scene:'library-steps',clock:{at:'1920-10-13T23:32'}},present:[],mods:{}};
    await hooks.get('session_start')();
    bus.get('coc:kernel-bridge')({campaign:'table',call:async method=>{
        if(method==='table.capsule')return{...cap,_context:binding};
        if(method==='table.untold')return{};
        return{cards:[],_snapshot:'fixture'};
    }});
    bus.get('coc:loop-engine')({engine:'hybrid-v1',prescreen:'run'});
    bus.get('coc:capsule')({capsule:cap,context:binding,epoch:'input-1'});
    const lifetime=new AbortController(),foreground={deadlineAt:Date.now()+60000};
    if(owner==='hybrid')bus.get('coc:discovery-read-owner')(()=>({signal:lifetime.signal,deadlineAt:foreground.deadlineAt}));
    if(owner==='task')bus.get('coc:task-provider-budget')(()=>({signal:lifetime.signal,deadlineAt:foreground.deadlineAt,
        reserve:async bound=>{seen.reserved++;assert.equal(bound.model.provider,'typesafe');return{settle:()=>{seen.settled++;},release:()=>{}};}}));
    const declared=api.offeredTools(api.COC_TOOLS,{}).filter(t=>t.name!=='resolve')
        .map(({name,description,parameters})=>({name,description,parameters}));
    const messages=[{role:'system',content:'Keeper core.',toolsAdded:declared,timestamp:0},
        {role:'user',content:[{type:'text',text:cap.turn.player_text}],timestamp:1},
        {role:'custom',customType:'coc-capsule',content:JSON.stringify(cap),details:{context:binding,epoch:'input-1'},timestamp:2},
        {role:'custom',customType:api.CLERK_TYPE,content:JSON.stringify({kind:'single_loop_step',purpose:'adjudicate',reason:'check_unresolved'}),
            details:{coc_host:true,turn:0},timestamp:3}];
    const ctx={model:{contextWindow:500000},getContextUsage:()=>({percent:1}),
        sessionManager:{getBranch:()=>[],buildSessionProjection:()=>({messages})}};
    const outgoing=await hooks.get('context')({messages:messages.filter(m=>m.role!=='system')},ctx);
    hooks.get('context_with_system')({messages:[messages[0],...outgoing.messages]},ctx);
    hooks.get('before_provider_request')({payload:{input:outgoing.messages,tools:declared}});
    assert.ok(rows.some(r=>r.lane==='capability-discovery'&&r.event==='selected'),'the first request is selective');
    // The Keeper's first inference: live turn 22 took 12.3 s against a 12 s allowance; here 2.1 s against 2 s.
    await new Promise(resolve=>setTimeout(resolve,waitMs));
    return {hooks,bus,rows,seen,lookup,foreground,shutdown:()=>hooks.get('session_shutdown')()};
}

for(const owner of ['hybrid','task'])test(`a purpose lookup after the optional allowance expired is answered under the ${owner} foreground owner`,async t=>{
    const {hooks,rows,seen,lookup,shutdown}=await table(t,{owner});
    assert.equal(typeof lookup,'function');
    const result=await lookup({kind:'capability',query:QUERY});
    assert.notEqual(result.status,'full_fallback',JSON.stringify(result));
    assert.equal(result.read_only,true);assert.equal(result.no_commit,true);
    const cash=result.capabilities.find(c=>c.name==='cash');
    assert.ok(cash?.detail,'the cash detail card is returned, not only a name');
    assert.ok(seen.lookups>0,'the lookup asked its own decision');
    if(owner==='task'){assert.ok(seen.reserved>=seen.lookups,'the lookup reserves from the foreground provider owner');assert.equal(seen.settled,seen.reserved);}
    assert.equal(rows.some(r=>r.event==='lookup_fallback'),false);
    // The lookup authorizes nothing: an apply still meets §209.6's projection hold until the expanded schema is sent.
    const hold=await hooks.get('tool_call')({toolName:'apply',toolCallId:'after-lookup',input:{effects:[{kind:'cash',amount:'0.75',currency:'USD',to:'driver'}]}});
    assert.equal(hold?.block,true);assert.match(hold.reason,/no world change was committed/i);
    await shutdown();
});

test('a purpose lookup without a live foreground owner is an explicit no-commit full fallback',async t=>{
    const {hooks,rows,seen,lookup,foreground,shutdown}=await table(t,{owner:'hybrid'});
    foreground.deadlineAt=Date.now()-1;
    const result=await lookup({kind:'capability',query:QUERY});
    assert.equal(result.status,'full_fallback');assert.equal(result.read_only,true);assert.equal(result.no_commit,true);
    assert.equal(result.reason,'lookup_owner_unavailable');
    assert.equal(seen.lookups,0,'no decision is asked without an owner');
    assert.ok(rows.some(r=>r.event==='lookup_fallback'&&r.reason==='lookup_owner_unavailable'&&r.no_commit));
    const hold=await hooks.get('tool_call')({toolName:'apply',toolCallId:'held',input:{effects:[{kind:'cash',amount:'0.75',currency:'USD',to:'driver'}]}});
    assert.equal(hold?.block,true);
    await shutdown();
});

// Contract §217.1 (issue #112 live d6c, turn 54, session line 27231): a background reading published its source while the
// Keeper's inference was out. The publication cleared the capability epoch, so the first of the Keeper's two capability
// lookups answered `Capability discovery has no current input` and the batch rule sent the second back unrun. The player's
// input was still current: both lookups are read-only detail and must answer, and the write gate must stay where it was.
test('a source publication during the Keeper inference leaves both of its capability lookups answerable',async t=>{
    const {hooks,bus,rows,lookup,shutdown}=await table(t,{owner:'hybrid',waitMs:0});
    bus.get('coc:source-published')({campaign:'table',module_id:'fixture'});
    const purpose=await lookup({kind:'capability',query:QUERY});
    const named=await lookup({kind:'capability',name:'npc-activity'});
    assert.equal(purpose.read_only,true);assert.equal(purpose.no_commit,true);
    assert.notEqual(purpose.status,'full_fallback',JSON.stringify(purpose));
    assert.ok(purpose.capabilities.find(c=>c.name==='cash')?.detail,'the purpose lookup returns the cash detail card');
    assert.ok(named.capabilities.find(c=>c.name==='npc-activity')?.detail,'the named lookup returns its detail card');
    assert.equal(rows.some(r=>r.event==='lookup_fallback'),false);
    // The request the Keeper decided from was narrow: its write is still held before mutation.
    const hold=await hooks.get('tool_call')({toolName:'apply',toolCallId:'after-publication',input:{effects:[{kind:'cash',amount:'0.75',currency:'USD',to:'driver'}]}});
    assert.equal(hold?.block,true);assert.match(hold.reason,/no world change was committed/i);
    await shutdown();
});
