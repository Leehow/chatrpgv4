/** Actual Pi/COC tool pipeline with deterministic provider replies; not live-play acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {openTable,waitFor} from './harness.mjs';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';
import {RpcClient} from '../integration/support.ts';
import {parallelReadBatch} from '../../extensions/kernel/canonical-operation-dispatcher.ts';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const call=(id,name,args)=>fauxToolCall(name,args,{id});
const reads=[call('read-slow','look',{focus:'investigator'}),call('read-fast','look',{focus:'npc',name:'Steven Knott'})];

async function fixture(t,calls=reads){
  const requests=[],events=[],intervals=[];
  const engine=createHybridEngine({env:process.env,decision:null});
  const table=await openTable({legacyDeliveryFixtures:false,realKernel:true,runDriver:engine.runDriver,
    env:{PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_MEMORY_BACKFILL:'0'},
    extraExtensions:[{name:'parallel-driver',factory:engine.extension}],
    async prepareWorkspace(workspace){const seed=new RpcClient(workspace);try{
      await seed.ok('table.open',{campaign:'test-camp'});
      await seed.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'You wait with Steven Knott in the office.'});
    }finally{await seed.close();}},responses:[
      fauxAssistantMessage(calls),context=>{requests.push(structuredClone(context.messages));return fauxAssistantMessage('{{public}}The clerk waits.');}]});
  t.after(()=>table.dispose());
  table.session.subscribe(event=>events.push(event));
  for(const tool of table.session.agent.state.tools){
    const execute=tool.execute;
    tool.execute=async(id,args,...rest)=>{
      const row={id,name:tool.name,start:performance.now()};intervals.push(row);
      try {await pause(id==='read-slow'?120:10);return await execute(id,args,...rest);}
      finally {row.end=performance.now();}
    };
  }
  return {table,requests,events,intervals};
}

test('independent native reads overlap and complete promptly while the next request retains source-order pairs',{timeout:15000},async t=>{
  const {table,requests,events,intervals}=await fixture(t);
  await table.session.prompt('I inspect my papers and recall the clerk.');
  const [slow,fast]=reads.map(call=>intervals.find(row=>row.id===call.id));
  assert(slow&&fast,'both calls crossed the actual tool execute path');
  assert(fast.start<slow.end,'independent read execution must overlap');
  assert.deepEqual(events.filter(row=>row.type==='tool_execution_end'&&reads.some(c=>c.id===row.toolCallId)).map(row=>row.toolCallId),['read-fast','read-slow']);
  const results=requests[0].filter(row=>row.role==='toolResult'&&reads.some(c=>c.id===row.toolCallId));
  assert.deepEqual(results.map(row=>row.toolCallId),['read-slow','read-fast']);
  assert(results.every(row=>row.isError===false),JSON.stringify(results));
  assert.deepEqual(table.extensionErrors,[]);
});

test('a mixed native batch retains sequential execution and the dependent request sees its real results',{timeout:15000},async t=>{
  const calls=[reads[0],call('write','apply',{effects:[{kind:'time',minutes:5}]}),reads[1]];
  const {table,requests,intervals}=await fixture(t,calls);
  await table.session.prompt('I check my papers, wait five minutes and then inspect the clerk.');
  const selected=calls.map(call=>intervals.find(row=>row.id===call.id));
  assert(selected.every(Boolean));
  assert(selected[1].start>=selected[0].end&&selected[2].start>=selected[1].end);
  assert.deepEqual(requests[0].filter(row=>row.role==='toolResult'&&calls.some(c=>c.id===row.toolCallId)).map(row=>row.toolCallId),calls.map(c=>c.id));
  assert.deepEqual(table.extensionErrors,[]);
});

test('parallel eligibility follows closed operation branches across scenarios, not entity words',()=>{
  const baseline={operation:'look',params:{focus:'time'}};
  for(const params of [{focus:'npc',name:'Any existing person'},{focus:'investigator'},{focus:'session'}])
    assert.equal(parallelReadBatch([baseline,{operation:'look',params}]),true);
  for(const kind of ['module','rule','catalog','secret','continuity'])
    assert.equal(parallelReadBatch([baseline,{operation:'lookup',params:{kind,query:'An independent question'}}]),true);
  for(const what of ['memory','transcript','history'])
    assert.equal(parallelReadBatch([baseline,{operation:'recall',params:{what}}]),true);
  for(const params of [{focus:'scene'},{focus:'object',name:'A notebook'},{focus:'map'},{focus:'knowledge'},
    {focus:'npc',name:'Any existing person',using_skill:'read papers'}])
    assert.equal(parallelReadBatch([baseline,{operation:'look',params}]),false);
  for(const params of [{kind:'source'},{kind:'support'},{kind:'adaptation'},{kind:'capability'},
    {kind:'module',query:'A destination',expected_kind:'scene'}])
    assert.equal(parallelReadBatch([baseline,{operation:'lookup',params}]),false);
  for(const params of [{what:'memory',query:'semantic question'},{what:'transcript',read:{turn:1}},
    {what:'history',page:{offset:20}},{what:'history',detail:{section:'events'}}])
    assert.equal(parallelReadBatch([baseline,{operation:'recall',params}]),false);
  for(const operation of ['apply','resolve','ask','output','narrate','unknown'])
    assert.equal(parallelReadBatch([baseline,{operation,params:{}}]),false);
});

test('native validation and an after-hook failure keep successful siblings and exact ordered pairs',{timeout:15000},async t=>{
  const invalid=call('invalid','look',{focus:'npc',name:{}});
  const calls=[reads[0],invalid,reads[1]];
  const {table,requests,events,intervals}=await fixture(t,calls);
  const original=table.session.agent.afterToolCall;
  let active=0,maxActive=0;
  table.session.agent.afterToolCall=async(...args)=>{
    active++;maxActive=Math.max(maxActive,active);
    try {await pause(150);if(args[0].toolCall.id==='read-fast')throw new Error('FIXTURE_AFTER_HOOK_FAILURE');return await original?.(...args);}
    finally {active--;}
  };
  await table.session.prompt('I compare the papers and the clerk.');
  assert.equal(maxActive,1,'shared finalization must not overlap');
  assert.equal(intervals.some(row=>row.id==='invalid'),false,'native validation blocks execution');
  const results=requests[0].filter(row=>row.role==='toolResult'&&calls.some(c=>c.id===row.toolCallId));
  assert.deepEqual(results.map(row=>[row.toolCallId,row.isError]),[['read-slow',false],['invalid',true],['read-fast',true]]);
  assert.equal(results.filter(row=>JSON.stringify(row.content).includes('FIXTURE_AFTER_HOOK_FAILURE')).length,1);
  for(const c of calls)assert.equal(events.filter(row=>row.type==='tool_execution_end'&&row.toolCallId===c.id).length,1);
});

test('cancellation pairs each parallel call once and ignores late progress and results',{timeout:15000},async t=>{
  const {table,requests,events,intervals}=await fixture(t);
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  const tool=table.session.agent.state.tools.find(tool=>tool.name==='look'),execute=tool.execute;
  tool.execute=async(id,args,signal,onUpdate,...rest)=>{
    const result=await execute(id,args,signal,onUpdate,...rest);
    await held;
    onUpdate?.({content:[{type:'text',text:'LATE_CANCELLED_PROGRESS'}],details:{}});
    return result;
  };
  const prompt=table.session.prompt('I compare my papers with the clerk.');
  await waitFor(()=>intervals.filter(row=>reads.some(c=>c.id===row.id)&&row.end).length===2);
  await table.session.abort();await prompt;
  const paired=table.session.messages.filter(row=>row.role==='toolResult'&&reads.some(c=>c.id===row.toolCallId));
  assert.deepEqual(paired.map(row=>[row.toolCallId,row.isError]),[['read-slow',true],['read-fast',true]]);
  const count=events.length;
  release();await pause(30);
  assert.equal(events.length,count,'late work must produce no UI or persisted events');
  assert.equal(requests.length,0,'cancelled batch buys no next inference');
  for(const c of reads)assert.equal(events.filter(row=>row.type==='tool_execution_end'&&row.toolCallId===c.id).length,1);
});

test('cancellation during ordered preflight executes nothing and still answers the unprepared calls',{timeout:15000},async t=>{
  const calls=[...reads,call('not-prepared','look',{focus:'time'})];
  const {table,requests,events,intervals}=await fixture(t,calls);
  const before=table.session.agent.beforeToolCall;
  table.session.agent.beforeToolCall=async(...args)=>{
    const result=await before?.(...args);
    if(args[0].toolCall.id==='read-fast')table.session.agent.abort();
    return result;
  };
  await table.session.prompt('I compare the available records.');
  assert.equal(intervals.length,0,'all preflight precedes read execution');
  const results=table.session.messages.filter(row=>row.role==='toolResult'&&calls.some(c=>c.id===row.toolCallId));
  assert.deepEqual(results.map(row=>[row.toolCallId,row.isError]),calls.map(c=>[c.id,true]));
  for(const c of calls){
    assert.equal(events.filter(row=>row.type==='tool_execution_start'&&row.toolCallId===c.id).length,1);
    assert.equal(events.filter(row=>row.type==='tool_execution_end'&&row.toolCallId===c.id).length,1);
  }
  assert.equal(requests.length,0);
});

test('cancellation preserves the sibling that already completed successfully',{timeout:15000},async t=>{
  const {table,requests,events}=await fixture(t);
  const prompt=table.session.prompt('I compare the available records.');
  await waitFor(()=>events.some(row=>row.type==='tool_execution_end'&&row.toolCallId==='read-fast'));
  await table.session.abort();await prompt;
  const results=table.session.messages.filter(row=>row.role==='toolResult'&&reads.some(c=>c.id===row.toolCallId));
  assert.deepEqual(results.map(row=>[row.toolCallId,row.isError]),[['read-slow',true],['read-fast',false]]);
  assert.equal(requests.length,0);
  const count=events.length;await pause(150);
  assert.deepEqual(events.slice(count).map(row=>({type:row.type,customType:row.message?.customType})),[]);
});
