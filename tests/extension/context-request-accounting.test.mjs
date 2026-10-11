// Contract §219.3-§219.4 (issue #112, the 4d7 live table): every request the context hook hands the provider has its
// `context/request` row, and a verified input whose optional allowance runs out while a request is being projected keeps
// that request's required reads under the foreground owner instead of failing the projection.
//
// 4d7 evidence: 116 Keeper provider requests, 115 `context/request` rows; the missing one is turn 95's first request,
// whose final identity check answered `discovery_snapshot_changed` and returned its bounded tail without a row. Turn 88's
// second request was prepared 0.6 s before the 12 s allowance expired, its package detail read started 0.1 s after, and
// the whole projection failed `context_projection_failed` (`discovery_snapshot_deadline`): the Keeper's next inference
// went out with no capsule, though the run's foreground owner had 76 s left.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getCurrentTools} from '@earendil-works/pi-ai';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'context-request-accounting-'));
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
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** The installed hooks over a fixture kernel, under a hybrid run's read owner, with a 2 s optional allowance. */
async function table(t){
    const envNames=['COC_TURN_DISCOVERY','EXT_JEV_APIKEY','PI_COC_JEV_PRESELECT','PI_COC_JEV_PRESELECT_ALLOWANCE_MS'],old=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));
    process.env.COC_TURN_DISCOVERY='selective';process.env.EXT_JEV_APIKEY='test-only';
    process.env.PI_COC_JEV_PRESELECT='0';process.env.PI_COC_JEV_PRESELECT_ALLOWANCE_MS='2000';
    const previousFetch=globalThis.fetch;
    t.after(()=>{globalThis.fetch=previousFetch;for(const name of envNames){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}});
    globalThis.fetch=async(_url,init)=>{
        const body=JSON.parse(init.body),cards=body.state.cards;
        return new Response(JSON.stringify({model:body.model,
            answers:Object.fromEntries(Object.keys(body.questions).map((key,i)=>[key,{type:'noul',noul:cards[i].name==='time'||cards[i].name==='pacing: Time'?.99:.01}])),
            usage:{input_tokens:30,output_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
    };
    const hooks=new Map(),bus=new Map(),rows=[];
    const pi={on:(name,handler)=>hooks.set(name,handler),events:{on:(name,handler)=>bus.set(name,handler),emit:(name,value)=>bus.get(name)?.(value)},sendMessage(){},
        getAllTools:()=>api.COC_TOOLS,getActiveTools:()=>api.COC_TOOLS.map(t=>t.name).filter(n=>n!=='resolve')};
    api.installContextPolicy(pi,e=>rows.push(e));
    const state={binding:{version:1,campaign:'table',worldline:'main',loop:0,turn:0,source_revision:'a'.repeat(64),task_world_revision:'w1'},
        capsuleDelay:0,capsuleReads:0,afterRead:undefined};
    const cap={turn:{number:0,player_text:'Wait until nine.'},recent:[],module:{title:'Fixture'},style:{},
        where:{scene:'library',clock:{at:'1920-10-13T03:00'}},present:[],
        mods:{instructions:[{mod:'pacing',version:'2.0.0',form:'indexed',index_contract_version:2,instruction:'Core rules.',
            sections:[{key:'pacing@2.0.0#0',heading:'Time',gates_open:true,topics:[],gates:[],triggers:['before_apply:time'],
                applicability:{what:'Actual passage of time.',not_for:'Unattempted actions.',examples:[]},dependencies:['time']}]}]}};
    await hooks.get('session_start')();
    bus.get('coc:kernel-bridge')({campaign:'table',call:async(method,args)=>{
        if(method==='table.capsule'){
            state.capsuleReads++;
            if(state.capsuleDelay)await sleep(state.capsuleDelay);
            const answer={...cap,_context:{...state.binding}};
            state.afterRead?.();
            return answer;
        }
        if(method==='table.untold')return{};
        if(method==='mods.sections')return{sections:args.keys.map(key=>({key,text:'Immutable '+key}))};
        return{cards:[],_snapshot:'fixture'};
    }});
    bus.get('coc:loop-engine')({engine:'hybrid-v1',prescreen:'run'});
    bus.get('coc:capsule')({capsule:cap,context:state.binding,epoch:'input-1'});
    const lifetime=new AbortController(),foregroundDeadline=Date.now()+20000;
    bus.get('coc:discovery-read-owner')(()=>({signal:lifetime.signal,deadlineAt:foregroundDeadline}));
    const declared=api.offeredTools(api.COC_TOOLS,{}).filter(t=>t.name!=='resolve').map(({name,description,parameters})=>({name,description,parameters}));
    const messages=[{role:'system',content:'Keeper core.',toolsAdded:declared,timestamp:0},
        {role:'user',content:[{type:'text',text:'Wait until nine.'}],timestamp:1},
        {role:'custom',customType:'coc-capsule',content:JSON.stringify(cap),details:{context:state.binding,epoch:'input-1'},timestamp:2},
        {role:'custom',customType:api.CLERK_TYPE,content:JSON.stringify({kind:'single_loop_step',purpose:'adjudicate',reason:'check_unresolved'}),
            details:{coc_host:true,turn:0},timestamp:3}];
    const ctx={model:{contextWindow:500000},getContextUsage:()=>({percent:1}),sessionManager:{getBranch:()=>[],buildSessionProjection:()=>({messages})}};
    let requests=0;
    /** One provider request as Pi makes it: the context hook, the system projection, then the request itself. */
    const request=async()=>{
        requests++;
        const outgoing=await hooks.get('context')({messages:messages.filter(m=>m.role!=='system')},ctx);
        const withSystem=hooks.get('context_with_system')({messages:[messages[0],...outgoing.messages]},ctx);
        hooks.get('before_provider_request')({payload:{input:outgoing.messages,tools:getCurrentTools(withSystem?.messages??[messages[0],...outgoing.messages])}});
        return outgoing;
    };
    /** A committed write between two inferences of the turn: the next request rehydrates. */
    const write=async id=>{
        assert.equal(await hooks.get('tool_call')({toolName:'apply',toolCallId:id,input:{effects:[{kind:'time',minutes:5}]}}),undefined,'the write is not held');
        await hooks.get('tool_result')({toolName:'apply',toolCallId:id,input:{effects:[{kind:'time',minutes:5}]},isError:false,details:{}});
    };
    const requestRows=()=>rows.filter(row=>row.lane==='context'&&row.event==='request');
    t.after(()=>hooks.get('session_shutdown')());
    return {state,rows,request,write,requestRows,requests:()=>requests};
}
const capsuleOf=outgoing=>outgoing.messages.find(message=>message.customType==='coc-capsule');

test('§219.3: a request whose final identity check finds the snapshot changed still has its context/request row, bounded and explicit', async t=>{
    const game=await table(t);
    const first=await game.request();
    assert.ok(capsuleOf(first),'the first request is a normal projection');
    assert.ok(game.rows.some(row=>row.event==='discovery_snapshot'&&row.status==='current'));
    await game.write('between');
    // 4d7 turn 95: the snapshot the projection was built on is not the one the identity check reads.
    let reads=0;game.state.afterRead=()=>{if(++reads===1)game.state.binding={...game.state.binding,task_world_revision:'w2'};};
    const second=await game.request();
    assert.ok(game.rows.some(row=>row.event==='discovery_snapshot'&&row.status==='unavailable'&&row.reason==='discovery_snapshot_changed'));
    assert.equal(capsuleOf(second),undefined,'the stale projection is discarded');
    assert.equal(second.messages[0].customType,'coc-context-status');
    const rows=game.requestRows();
    assert.equal(rows.length,game.requests(),'one context/request row for every request handed to the provider');
    const last=rows.at(-1);
    assert.equal(last.reason,'discovery_snapshot_changed');
    assert.ok(last.request_bytes<=last.ceiling_bytes);
});

test('§219.4: a verified input whose optional allowance runs out mid-projection keeps its reads under the foreground owner', async t=>{
    const game=await table(t);
    const began=Date.now();
    assert.ok(capsuleOf(await game.request()));
    assert.ok(game.rows.some(row=>row.event==='discovery_snapshot'&&row.status==='current'),'the input is verified');
    await game.write('between');
    // 4d7 turn 88: the request starts inside the 2 s allowance and its required reads finish after it.
    await sleep(Math.max(0,began+1600-Date.now()));
    game.state.capsuleDelay=700;
    const second=await game.request();
    assert.ok(Date.now()>began+2000,'the allowance expired during the projection');
    assert.ok(capsuleOf(second),'the projection carries the capsule, not a degraded tail');
    assert.ok(!game.rows.some(row=>row.event==='degraded'),JSON.stringify(game.rows.filter(row=>row.event==='degraded')));
    const verified=game.rows.filter(row=>row.event==='discovery_snapshot'&&row.status==='current');
    assert.equal(verified.at(-1).read_owner,'foreground_fallback');
    const rows=game.requestRows();
    assert.equal(rows.length,game.requests());
    assert.equal(rows.at(-1).reason,undefined);
});

test('§219.4: an unverified input keeps the shared preparation deadline', async t=>{
    const game=await table(t);
    // The first request's own reads outlast the allowance: no request of this input was ever verified.
    game.state.capsuleDelay=2300;
    const first=await game.request();
    assert.equal(capsuleOf(first),undefined);
    assert.ok(game.rows.some(row=>row.event==='degraded'&&row.reason==='discovery_snapshot_deadline'));
    assert.equal(game.requestRows().length,game.requests());
});
