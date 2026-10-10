import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'capability-discovery-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export * from './runtime/jev/capability-discovery.ts';\nexport {TaskLease} from './runtime/jev/task-context.ts';\nexport {createDecisionAdapter} from './runtime/jev/decision-adapter.ts';",
    resolveDir:root,sourcefile:'capability-discovery-test.ts'},outfile:join(temp,'api.mjs'),bundle:true,
    packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const api=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));
const card=(name,extra={})=>({name,version:'v1',applicability:'A supported '+name+' operation.',exclusions:'Unchosen actions.',...extra});
const input=(cards,extra={})=>({binding:{campaign:'table',worldline:'main',loop:0,turn:1,epoch:'input-1',source:'published-1'},
    request:'Wait until the doors open.',situation:{scene:'library',people:['watchman']},cards,mandatory:[],
    thresholds:{candidate:.25,selected:.5,direct:.9},...extra});
function lease(t){
    const value=new api.TaskLease({owner:'capability-discovery',goal:'Select request details',
        scope:{owner:'capability-discovery',campaign:'table',worldline:'main',loop:0,audience:'keeper'},
        capabilities:['decision'],readSet:[],budget:{deadlineAt:Date.now()+30000,remainingActions:20,
            remainingInputTokens:200000,remainingOutputTokens:10000,remainingCostUsd:1}});
    t.after(()=>value.close());return value;
}
const answered=(batch,scores)=>({batchId:batch.id,model:batch.model,status:'complete',
    answers:Object.fromEntries(batch.questions.map((q,i)=>[q.key,{status:'answered',type:'noul',
        noul:scores[batch.state.cards[i].name]??.05}]))});

test('multiple independent capabilities survive detail verification with mandatory dependencies',async t=>{
    const calls=[],reads=[];
    const values=input([card('time'),card('scene',{dependencies:['lookup'],examples:['Readers enter after the staff open the doors.']}),card('lookup'),card('cash')],{mandatory:['lookup']});
    const result=await api.discoverCapabilities(values,{decide:async batch=>{
        calls.push(batch);return answered(batch,batch.state.stage==='index'?{time:.99,scene:.6,cash:.01}:{scene:.8});
    }},lease(t),{readDetail:async c=>{reads.push(c.name);return{version:c.version,detail:'The day service opens after actual time passes.'};}});
    assert.equal(result.status,'selected');
    assert.deepEqual(result.names,['time','scene','lookup']);
    assert.deepEqual(reads,['scene']);
    assert.equal(calls.length,2);
    assert.ok(calls[0].state.cards.every(c=>!Object.hasOwn(c,'detail')));
    assert.deepEqual(calls[0].state.cards.find(c=>c.name==='scene').examples,['Readers enter after the staff open the doors.']);
    assert.deepEqual(calls[1].state.cards[0].examples,['Readers enter after the staff open the doors.']);
    assert.equal(calls[1].state.cards[0].detail,'The day service opens after actual time passes.');
    assert.deepEqual(result.reasons.lookup,['mandatory','dependency:scene']);
});

test('no-match does not force a winner or read unrelated detail',async t=>{
    let reads=0;
    const result=await api.discoverCapabilities(input([card('cash'),card('combat')]),{
        decide:async batch=>answered(batch,{})},lease(t),{readDetail:async()=>{reads++;throw Error('Unexpected read');}});
    assert.equal(result.status,'selected');assert.deepEqual(result.names,[]);assert.equal(reads,0);
});

test('a replaced input rejects a late answer before using its selection',async t=>{
    let current=true;
    const result=await api.discoverCapabilities(input([card('time')]),{decide:async batch=>{
        current=false;return answered(batch,{time:.99});
    }},lease(t),{current:()=>current});
    assert.equal(result.status,'unavailable');assert.equal(result.reason,'stale_discovery');
});

test('partial answers and changed detail versions do not masquerade as complete selection',async t=>{
    const incomplete=await api.discoverCapabilities(input([card('time')]),{decide:async batch=>({
        ...answered(batch,{time:.8}),status:'partial',answers:{}})},lease(t));
    assert.equal(incomplete.status,'unavailable');assert.equal(incomplete.reason,'incomplete_discovery');
    const stale=await api.discoverCapabilities(input([card('time')]),{decide:async batch=>answered(batch,{time:.6})},
        lease(t),{readDetail:async()=>({version:'v2',detail:'Changed rule.'})});
    assert.equal(stale.status,'unavailable');assert.equal(stale.reason,'stale_discovery_detail');
});

test('invalid dependencies fail before decision traffic and deterministic items bypass optional scoring',async t=>{
    const port={decide:async()=>{throw Error('Unexpected decision');}};
    await assert.rejects(api.discoverCapabilities(input([card('time',{dependencies:['missing']})]),port,lease(t)),/Unknown discovery dependency/);
    await assert.rejects(api.discoverCapabilities(input([card('time',{dependencies:['time']})]),port,lease(t)),/dependency cycle/);
    const result=await api.discoverCapabilities(input([card('time')],{mandatory:['time']}),port,lease(t));
    assert.equal(result.status,'selected');assert.deepEqual(result.names,['time']);assert.equal(result.decisions,0);
});

test('both stages cross the real adapter with the exact caller lease binding and one bulk detail read',async t=>{
    let requests=0,reads=0;
    const port=api.createDecisionAdapter({apiKey:'test-only',fetcher:async(_url,init)=>{
        requests++;const body=JSON.parse(init.body);
        return new Response(JSON.stringify({model:body.model,
            answers:Object.fromEntries(Object.keys(body.questions).map(key=>[key,{type:'noul',noul:requests===1?.6:.8}])),
            usage:{input_tokens:20,output_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
    }});
    const result=await api.discoverCapabilities(input([card('time'),card('scene')]),port,lease(t),{
        readDetails:async cards=>{reads++;return Object.fromEntries(cards.map(c=>[c.name,{version:c.version,detail:'A supported transition.'}]));},
    });
    assert.equal(result.status,'selected');
    assert.deepEqual(result.names,['time','scene']);
    assert.equal(requests,2);assert.equal(reads,1);
});
