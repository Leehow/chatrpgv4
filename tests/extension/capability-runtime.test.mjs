import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'capability-runtime-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:[
    "export * from './extensions/table/capability-runtime.ts';",
    "export {COC_TOOLS} from './extensions/kernel/tools.ts';",
    "export {offeredTools} from './extensions/kernel/lean-apply.ts';",
].join('\n'),resolveDir:root},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',
    format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));
const tools=api.offeredTools(api.COC_TOOLS,{});
const binding={campaign:'table',worldline:'main',loop:0,turn:1,source_revision:'source-1'};
const capsule={turn:{player_text:'Wait until nine.'},where:{scene:'library',clock:{at:'1920-10-13T03:00'}},present:[]};
const port={decide:async(batch,lease)=>{
    assert.deepEqual(batch.scope,lease.context.scope);assert.deepEqual(batch.readSet,lease.context.readSet);
    return{batchId:batch.id,model:batch.model,status:'complete',
        answers:Object.fromEntries(batch.questions.map((q,i)=>[q.key,{status:'answered',type:'noul',
            noul:batch.state.cards[i].name==='time'?.99:.01}]))};
}};
test('the runtime keeps discovery reachable and expands the whole missing batch without committing',async()=>{
    const events=[];
    const runtime=api.createCapabilityRuntime({tools:()=>tools,decision:()=>port,mode:()=> 'selective',record:e=>events.push(e)});
    runtime.observe(capsule,binding,new AbortController().signal);await runtime.wait();
    const view=runtime.project(tools.filter(t=>t.name!=='resolve'));
    assert.ok(view);
    assert.deepEqual(view.find(t=>t.name==='lookup').parameters.properties.kind.enum,['capability']);
    const effects=[{kind:'time',minutes:360},{kind:'cash',amount:20,currency:'USD',to:'here'}];
    const hold=runtime.readiness('apply',{effects});
    assert.equal(hold.block,true);assert.match(hold.reason,/no world change was committed/i);
    const expanded=runtime.project(tools.filter(t=>t.name!=='resolve'));
    assert.ok(expanded.find(t=>t.name==='apply').parameters.properties.effects.items.anyOf.some(s=>s.properties.kind.enum?.[0]==='cash'));
    assert.equal(runtime.readiness('apply',{effects}),undefined);
    assert.ok(events.some(e=>e.event==='expansion'&&e.no_commit));
    runtime.clear();
});
test('named detail discovery is read-only and preserves canonical constraints',async()=>{
    const runtime=api.createCapabilityRuntime({tools:()=>tools,decision:()=>port,mode:()=> 'selective',record:()=>{}});
    runtime.observe(capsule,binding,new AbortController().signal);await runtime.wait();
    const result=await runtime.lookup({name:'npc-activity'});
    assert.equal(result.read_only,true);assert.equal(result.no_commit,true);
    assert.ok(result.capabilities[0].detail.includes('wakefulness'));
    await assert.rejects(runtime.lookup({name:'unknown-capability'}),/Unknown capability name/);
    runtime.clear();
    await assert.rejects(runtime.lookup({name:'time'}),/no current input/);
});
test('no decision service keeps the full current view instead of guessing a narrow one',async()=>{
    const runtime=api.createCapabilityRuntime({tools:()=>tools,decision:()=>undefined,mode:()=> 'selective',record:()=>{}});
    runtime.observe(capsule,binding,new AbortController().signal);await runtime.wait();
    assert.equal(runtime.project(tools),undefined);
    assert.equal(runtime.readiness('apply',{effects:[{kind:'time',minutes:360}]}),undefined);
    runtime.clear();
});
test('a dependency already shown in the projected schema is ready, and relevant current facts invalidate selection',async()=>{
    let calls=0;
    const runtime=api.createCapabilityRuntime({tools:()=>tools,decision:()=>({decide:async(batch,lease)=>{
        calls++;assert.equal(batch.state.situation.keeper_task,'adjudicate');
        return port.decide(batch,lease);
    }}),mode:()=> 'selective',record:()=>{}});
    const signal=new AbortController().signal,task={purpose:'adjudicate'};
    runtime.observe(capsule,binding,signal,task);await runtime.wait();
    runtime.project(tools,['cash']);
    assert.equal(runtime.readiness('apply',{effects:[{kind:'cash',amount:20,currency:'USD',to:'here'}]}),undefined);
    const initial=calls;
    runtime.observe(capsule,binding,signal,task);await runtime.wait();assert.equal(calls,initial);
    runtime.observe({...capsule,known:{clues_here:[{name:'Letter',delivery:'read'}]}},binding,signal,task);
    await runtime.wait();assert.ok(calls>initial);
    runtime.clear();
});
test('a repeated call before expansion projection never slips through to mutation',async()=>{
    const runtime=api.createCapabilityRuntime({tools:()=>tools,decision:()=>port,mode:()=> 'selective',record:()=>{}});
    runtime.observe(capsule,binding,new AbortController().signal);await runtime.wait();runtime.project(tools);
    const args={effects:[{kind:'cash',amount:20,currency:'USD',to:'here'}]};
    assert.equal(runtime.readiness('apply',args).block,true);
    assert.equal(runtime.readiness('apply',args).block,true);
    assert.equal(runtime.readiness('apply',args).block,true);
    assert.equal(runtime.project(tools),undefined);
    assert.equal(runtime.readiness('apply',args),undefined);
    runtime.clear();
});
test('host-issued operation fields seed fragments before inference without a semantic re-vote',async()=>{
    const events=[];
    const runtime=api.createCapabilityRuntime({tools:()=>tools,decision:()=>port,mode:()=> 'selective',record:e=>events.push(e)});
    const signal=new AbortController().signal;
    runtime.observe(capsule,binding,signal,{purpose:'bind',operations:[{verb:'apply',family:'npc',
        bound:{name:'watchman'},needs:[{name:'activity'}]}]});await runtime.wait();
    const view=runtime.project(tools);assert.ok(view,JSON.stringify(events));
    const npc=view.find(t=>t.name==='apply').parameters.properties.effects.items.anyOf
        .find(s=>s.properties.kind.enum?.[0]==='npc');
    assert.ok(npc.properties.activity);
    assert.equal(runtime.readiness('apply',{effects:[{kind:'npc',name:'watchman',activity:{wakefulness:'awake'},why:'Observed.'}]}),undefined);
    runtime.clear();
});
test('a failed purpose lookup widens the bound view once without spending again or committing',async()=>{
    let attempts=0;
    const runtime=api.createCapabilityRuntime({tools:()=>tools,decision:()=>({decide:async(batch,lease)=>{
        attempts++;if(batch.state.request==='Find missing source consultation.')throw Error('decision_transport_unavailable');
        return port.decide(batch,lease);
    }}),mode:()=> 'selective',record:()=>{}});
    runtime.observe(capsule,binding,new AbortController().signal);await runtime.wait();runtime.project(tools);
    const result=await runtime.lookup({query:'Find missing source consultation.'});
    assert.equal(result.status,'full_fallback');assert.equal(result.no_commit,true);assert.equal(result.read_only,true);
    const count=attempts;assert.deepEqual(await runtime.lookup({query:'Find missing source consultation.'}),result);
    assert.equal(attempts,count);
    assert.equal(runtime.readiness('apply',{effects:[{kind:'cash',amount:20,currency:'USD',to:'here'}]}).block,true);
    assert.equal(runtime.project(tools),undefined);
    assert.equal(runtime.readiness('apply',{effects:[{kind:'cash',amount:20,currency:'USD',to:'here'}]}),undefined);
    runtime.clear();
});
test('in-flight purpose lookups share a decision and a stale failure cannot widen a successor',async()=>{
    let fail,started,queries=0;
    const began=new Promise(resolve=>{started=resolve;});
    const runtime=api.createCapabilityRuntime({tools:()=>tools,decision:()=>({decide:async(batch,lease)=>{
        if(batch.state.request==='Find an object transfer.'){
            queries++;started();return await new Promise((_resolve,reject)=>{fail=reject;});
        }
        return port.decide(batch,lease);
    }}),mode:()=> 'selective',record:()=>{}});
    const signal=new AbortController().signal;
    runtime.observe(capsule,binding,signal);await runtime.wait();runtime.project(tools);
    const first=runtime.lookup({query:'Find an object transfer.'}),second=runtime.lookup({query:'Find an object transfer.'});
    const ended=Promise.allSettled([first,second]);await began;assert.equal(queries,1);
    runtime.observe({...capsule,turn:{player_text:'Look at the door.'}},{...binding,turn:2},signal);await runtime.wait();
    fail(Error('old_provider_failure'));const outcomes=await ended;
    assert.ok(outcomes.every(result=>result.status==='rejected'&&/replaced/.test(result.reason.message)));
    assert.ok(runtime.project(tools),'the successor still has its own selected view');
    runtime.clear();
});
test('a late initial selection cannot narrow an epoch already widened after lookup failure',async()=>{
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    const runtime=api.createCapabilityRuntime({tools:()=>tools,decision:()=>({decide:async(batch,lease)=>{
        if(batch.state.request==='Find source consultation.')throw Error('selection_unavailable');
        await gate;return port.decide(batch,lease);
    }}),mode:()=> 'selective',record:()=>{}});
    runtime.observe(capsule,binding,new AbortController().signal);
    assert.equal((await runtime.lookup({query:'Find source consultation.'})).status,'full_fallback');
    release();await runtime.wait();
    assert.equal(runtime.project(tools),undefined);
    runtime.clear();
});
