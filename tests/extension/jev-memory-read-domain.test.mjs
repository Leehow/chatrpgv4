import { strict as assert } from "node:assert";
import { test } from "node:test";
import { bindDecisionAnswers } from "../../runtime/jev/contracts.ts";
import { createMemoryReadDomain, MEMORY_READ_CAPABILITY, MEMORY_READ_POLICY_VERSION } from "../../runtime/jev/memory-read-domain.ts";
import { TaskRuntime } from "../../runtime/jev/task-runtime.ts";

class Store { records = new Map(); async load(id) { return structuredClone(this.records.get(id)); } async save(r) { this.records.set(r.checkpoint.context.id, structuredClone(r)); } }
const scope={owner:"memory-read:campaign",campaign:"campaign",worldline:"main",loop:0,audience:"keeper"};
const readSet=[{kind:"memory_index",resource:"campaign",revision:"memory-r1"}];
const rawRef={version:1,scope,resource:"query",revision:"query-r1",sourceType:"draft",selector:{kind:"field",path:["query"]}};
const plan={goal:"What did Knott promise, and is it still current?",subgoals:[],constraints:[],evidenceRequired:[],completion:["Return supported current evidence."],capabilities:[MEMORY_READ_CAPABILITY],replanWhen:[],returnWhen:[]};
const row=(alias,text,attribution={kind:"speech",speaker:{name:"Knott",kind:"npc"}})=>({alias,origin:"memory",memory:true,kind:"promise",subject:"Steven Knott",text,turn:3,line:"main",loop:0,status:"candidate",state:"accurate",authority:"conversation_report",attribution,derived:false,links:[]});
const snap=(id,total,indexed=total,raw=0,rawAll=false)=>({snapshot:id,scope,query:plan.goal,filters:{},raw_all:rawAll,total,indexed,raw,source_revision:"source-r1",index_revision:"index-r1",world_revision:"world-r1",coverage:{raw_gap_turns:[],raw_unavailable_lines:[]},context:{scene:"office",worldline:"main",loop:0,clock:null,current_receipts:[{kind:"cash",name:"advance",delta:0}]}});
const packet=(p,result,refs=[])=>({operationId:p.id,status:"succeeded",result,refs,receipts:[],readSet:p.readSet,coverage:{used:[],omitted:[],unknown:[]}});
function answer(batch,select){const raw=Object.fromEntries(batch.questions.map(q=>[q.key,{status:"answered",type:"choice",choice:select(q,batch)}]));return bindDecisionAnswers(batch,raw,{inputTokens:1,outputTokens:1,costUsd:0});}
function assertJson(value,path="state") { assert.notEqual(value,undefined,`${path} is undefined`); if(Array.isArray(value))value.forEach((item,index)=>assertJson(item,`${path}[${index}]`));else if(value&&typeof value==="object")for(const [key,item] of Object.entries(value))assertJson(item,`${path}.${key}`); }

async function fixture({snapshots,rowsBySnapshot,original,finish,select,taskPlan=plan,maxSteps=256}){
 const store=new Store(),calls=[],batches=[];let snapIndex=0;
 const operations={async validate(){return readSet;},async dispatch(proposal){calls.push(structuredClone(proposal));
  if(proposal.operation==="memory.snapshot")return packet(proposal,structuredClone(snapshots[Math.min(snapIndex++,snapshots.length-1)]));
  if(proposal.operation==="memory.page"){const rows=rowsBySnapshot[proposal.args.snapshot]??[],offset=proposal.args.offset;const page=rows.slice(offset,offset+20);return packet(proposal,{snapshot:proposal.args.snapshot,offset,total:rows.length,rows:page,next_offset:offset+page.length<rows.length?offset+page.length:null});}
  if(proposal.operation==="memory.original")return packet(proposal,await original(proposal));
  if(proposal.operation==="memory.finish"){const result=await finish(proposal,calls.filter(x=>x.operation==="memory.finish").length);return packet(proposal,result,result.refs??[]);}
  throw new Error(`unexpected ${proposal.operation}`);}};
 const decision={async decide(batch){batches.push(structuredClone(batch));return answer(batch,select);}};
 const runtime=new TaskRuntime({decision,store,operations,domains:[createMemoryReadDomain()],maxSteps});
 const id=await runtime.begin({domain:"memory-read",intent:{id:"intent",rawInput:rawRef,goal:taskPlan.goal,limits:[],scope,turn:5,inputRevision:rawRef.revision},lease:{owner:"memory-read",goal:taskPlan.goal,scope,capabilities:[MEMORY_READ_CAPABILITY],budget:{deadlineAt:Date.now()+30000,remainingInputTokens:100000,remainingOutputTokens:100000,remainingCostUsd:10,remainingActions:200},readSet}});
 const result=await runtime.submit(id,taskPlan);return{runtime,id,result,calls,batches,record:runtime.snapshot(id)};
}

test("scans the wide pool, reads canonical continuation, assesses actual evidence, and finishes with no opaque model state",async()=>{
 const rows=[row("entry:0","Knott promised daily pay."),row("entry:1","Unrelated weather.",{kind:"player"})];let originalCalls=0,finishArgs;
 const contextRef={...rawRef,resource:"canonical-turn:hidden:keeper",revision:"original-r1",selector:{kind:"utf16",start:0,end:20}};
 const app=await fixture({snapshots:[snap("snap-private",2)],rowsBySnapshot:{"snap-private":rows},
  async original(p){originalCalls++;const mid={role:"keeper",text:"The promise is discussed.",range:{offset:20,end:43},total_chars:70,truncated:true,speakers:[],ref:contextRef,previous:{alias:p.args.alias,offset:0,role:"keeper"},next:{alias:p.args.alias,offset:43,role:"keeper"}};
   if(p.args.offset===undefined)return{alias:p.args.alias,verified:true,entry:rows[0],authority:"conversation_report",verification_scope:"canonical_original_integrity_only",original:{line:"main",loop:0,turn:3,commit:"opaque"},context:[mid],refs:[contextRef]};
   const first={role:"keeper",text:"Payment follows completed work.",range:{offset:0,end:20},total_chars:70,truncated:true,speakers:[],ref:contextRef,next:{alias:p.args.alias,offset:20,role:"keeper"}};
   if(p.args.offset===0)return{alias:p.args.alias,verified:true,entry:rows[0],authority:"conversation_report",original:{line:"main",loop:0,turn:3,commit:"opaque"},context:[first,mid],refs:[contextRef]};
   const later={role:"keeper",text:"No payment has landed.",range:{offset:43,end:70},total_chars:70,truncated:true,speakers:[],ref:contextRef,previous:{alias:p.args.alias,offset:20,role:"keeper"}};
   return{alias:p.args.alias,verified:true,entry:rows[0],authority:"conversation_report",original:{line:"main",loop:0,turn:3,commit:"opaque"},context:[first,mid,later],refs:[contextRef]};},
  async finish(p){finishArgs=structuredClone(p.args);return{what:"memory",query:plan.goal,status:"ready",hits:[{alias:"entry:0",context:[{text:"Payment follows completed work."},{text:"No payment has landed."}]}],authority:"conversation_report",coverage:{used:["entry:0"],omitted:[],unknown:[]},refs:[rawRef]};},
  select(q){if(q.key.startsWith("coverage:"))return q.target==="entry:0"?"essential":"irrelevant";if(q.key.startsWith("support:"))return"supported";if(q.key.startsWith("applicability:"))return"current";return"none";}});
 assert.equal(app.result.status,"complete",JSON.stringify(app.result));assert.equal(app.record.phase,"terminal");assert.deepEqual(app.result.refs,[rawRef]);assert.equal(originalCalls,3);
 assert.deepEqual(app.calls.filter(c=>c.operation==="memory.original").map(c=>c.args.offset),[undefined,0,43]);
 assert.deepEqual(finishArgs.selected,["entry:0"]);assert.deepEqual(finishArgs.considered,["entry:0","entry:1"]);assert.deepEqual(finishArgs.unknown,[]);
 assert.deepEqual(finishArgs.assessments,[{alias:"entry:0",relevance:"direct",support:"supported",applicability:"current",contradiction:"none"}]);
 const assessment=app.batches.find(b=>b.questions.some(q=>q.key.startsWith("support:"))).state;
 assert.ok(JSON.stringify(assessment).includes("Payment follows completed work."));assert.ok(JSON.stringify(assessment).includes("No payment has landed."));
 assert.equal(assessment.evidence[0].original.context.length,3,"accumulated original windows are deduplicated");
 const modelState=JSON.stringify(app.batches.map(b=>b.state));for(const forbidden of ["snap-private","opaque","source-r1","index-r1","world-r1",'"refs"','"ref"',"canonical-turn:hidden"] )assert.equal(modelState.includes(forbidden),false);
});

test("widens once to raw history and preserves unverified originals as explicit partial unknown",async()=>{
 let finishArgs;const raw=row("entry:0","A raw unindexed statement.",{kind:"unknown"});raw.origin="raw";raw.kind=null;raw.status="unindexed";
 const app=await fixture({snapshots:[snap("indexed",0,0,0,false),snap("raw",1,0,1,true)],rowsBySnapshot:{indexed:[],raw:[raw]},
  async original(){return{alias:"entry:0",verified:false,reason:"canonical_original_unavailable",refs:[]};},
  async finish(p){finishArgs=structuredClone(p.args);return{what:"memory",query:plan.goal,status:"partial",hits:[],authority:"conversation_report",coverage:{used:[],omitted:[],unknown:["entry:0"]},refs:[]};},
  select(q){return q.key.startsWith("coverage:")?"unknown":"unknown";}});
 assert.equal(app.result.status,"partial");assert.deepEqual(app.calls.filter(c=>c.operation==="memory.snapshot").map(c=>c.args),[{}, {raw_all:true}]);
 assert.deepEqual(finishArgs.selected,[]);assert.deepEqual(finishArgs.considered,["entry:0"]);assert.deepEqual(finishArgs.unknown,["entry:0"]);
});

test("caps selected evidence at twenty, records overflow unknown, and refreshes within the same task",async()=>{
 const many=Array.from({length:21},(_,i)=>row(`entry:${i}`,`Promise ${i}.`)),refreshed=many.map((item,i)=>({...item,text:`Refreshed promise ${i}.`}));let finishCount=0;
 refreshed[20].text=`${"A".repeat(780)} exact tail answer`;
 const app=await fixture({snapshots:[snap("first",21),snap("second",21)],rowsBySnapshot:{first:many,second:refreshed},
  async original(p){return{alias:p.args.alias,verified:true,entry:many.find(r=>r.alias===p.args.alias),authority:"conversation_report",original:{line:"main",loop:0,turn:3,commit:"hidden"},context:[{role:"keeper",text:"Exact.",range:{offset:0,end:6},total_chars:6,truncated:false,speakers:[]}],refs:[]};},
  async finish(p){finishCount++;return finishCount===1?{status:"refresh",snapshot:p.args.snapshot}:{what:"memory",query:plan.goal,status:"partial",hits:[],authority:"conversation_report",coverage:{used:[],omitted:[],unknown:["entry:20"]},refs:[]};},
  select(q,batch){if(q.key.startsWith("coverage:")){const candidate=batch.state.candidates.find(item=>item.alias===q.target);return q.target==="entry:20"?"essential":candidate.text.startsWith("Refreshed")?"unknown":"background";}if(q.key.startsWith("support:"))return"supported";if(q.key.startsWith("applicability:"))return"current";return"none";}});
 assert.equal(app.result.status,"partial",JSON.stringify(app.result));assert.equal(app.calls.filter(c=>c.operation==="memory.snapshot").length,2);assert.equal(finishCount,2);
 const final=app.calls.filter(c=>c.operation==="memory.finish").at(-1).args;assert.equal(final.selected.length,20);assert.ok(final.selected.includes("entry:20"),"the later concrete answer outranks earlier background mentions");assert.ok(final.unknown.includes("entry:19"));assert.equal(new Set(final.considered).size,21);
 assert.equal(final.assessments.find(item=>item.alias==="entry:20").relevance,"direct");assert.equal(final.assessments.find(item=>item.alias==="entry:0").relevance,"uncertain","only current-snapshot coverage decisions are retained");
 const refreshedRelevance=app.batches.filter(batch=>batch.questions.some(q=>q.key.startsWith("coverage:"))).flatMap(batch=>batch.state.candidates).find(candidate=>candidate.alias==="entry:20"&&candidate.text.endsWith("exact tail answer"));
 assert.equal(refreshedRelevance.text,refreshed[20].text,"relevance receives the complete issued source text, including its tail");
 const secondOriginals=app.calls.filter(call=>call.operation==="memory.original"&&call.args.snapshot==="second").map(call=>call.args.alias);assert.ok(secondOriginals.includes("entry:20"));assert.equal(secondOriginals.includes("entry:19"),false);
});

test("explicit omitted original context remains a partial owner result",async()=>{
 const evidence=row("entry:0","A long conditional promise.");
 const app=await fixture({snapshots:[snap("omitted",1)],rowsBySnapshot:{omitted:[evidence]},
  async original(){return{alias:"entry:0",verified:true,entry:evidence,authority:"conversation_report",original:{line:"main",loop:0,turn:2,commit:"hidden"},context:[{role:"keeper",text:"Bounded context.",range:{offset:0,end:16},total_chars:5000,truncated:true,speakers:[],omitted_context:true,omitted_context_count:3}],refs:[]};},
  async finish(){return{what:"memory",query:plan.goal,status:"partial",hits:[{alias:"entry:0",context:[{text:"Bounded context."}],omitted_context:true,omitted_context_count:3}],authority:"conversation_report",coverage:{used:["entry:0"],omitted:[],unknown:[],omitted_context:3},refs:[]};},
  select(q){if(q.key.startsWith("coverage:"))return"essential";if(q.key.startsWith("support:"))return"supported";if(q.key.startsWith("applicability:"))return"current";return"unknown";}});
 assert.equal(app.result.status,"partial");const finished=app.record.observations.find(o=>o.proposal.operation==="memory.finish").packet.result;
 assert.equal(finished.hits[0].omitted_context,true);assert.equal(finished.hits[0].omitted_context_count,3);assert.equal(finished.coverage.omitted_context,3);
});

test("prioritizes every relevant occurrence before the owner byte-capped selection",async()=>{
 const rows=Array.from({length:4},(_,index)=>row(`entry:${index}`,index===3?"The exact requested condition.":`Repeated general mention ${index}.`));let finishArgs;
 const app=await fixture({snapshots:[snap("priority-small",4,4,0,true)],rowsBySnapshot:{"priority-small":rows},
  async original(p){return{alias:p.args.alias,verified:true,entry:rows.find(item=>item.alias===p.args.alias),authority:"conversation_report",original:{line:"main",loop:0,turn:3},context:[{role:"keeper",text:"Exact.",range:{offset:0,end:6},total_chars:6,truncated:false,speakers:[]}],refs:[]};},
  async finish(p){finishArgs=structuredClone(p.args);return{what:"memory",query:plan.goal,status:"ready",hits:[],authority:"conversation_report",coverage:{used:[],omitted:[],unknown:[]},refs:[]};},
  select(q){if(q.key.startsWith("coverage:"))return q.target==="entry:3"?"essential":"background";if(q.key.startsWith("support:"))return"supported";if(q.key.startsWith("applicability:"))return"current";return"none";}});
 assert.equal(app.result.status,"complete");assert.deepEqual(app.calls.filter(call=>call.operation==="memory.original").map(call=>call.args.alias),["entry:3","entry:0","entry:1","entry:2"]);
 assert.deepEqual(finishArgs.selected,["entry:3","entry:0","entry:1","entry:2"]);assert.equal(finishArgs.unknown.length,0);
});

test("round-robins exact per-subquestion coverage so one dominant topic cannot crowd out later answers",async()=>{
 const needs=["What was the commission amount?","What was the payment schedule?","What did the player prefer?","What condition did Knott attach to the actual promise?"];
 const taskPlan={...plan,goal:"Answer the commission, schedule, preference, and actual promise questions.",subgoals:needs,evidenceRequired:needs};
 const rows=[...Array.from({length:30},(_,index)=>row(`entry:${index}`,`Commission record ${index}.`)),row("entry:30","Payment is scheduled each day."),row("entry:31","The player prefers no forced combat."),row("entry:32","Knott promises payment only after completion.")];let finishArgs;
 const app=await fixture({taskPlan,snapshots:[snap("multi-need",rows.length,rows.length,0,true)],rowsBySnapshot:{"multi-need":rows},
  async original(p){return{alias:p.args.alias,verified:true,entry:rows.find(item=>item.alias===p.args.alias),authority:"conversation_report",original:{line:"main",loop:0,turn:10},context:[{role:"keeper",text:"Exact.",range:{offset:0,end:6},total_chars:6,truncated:false,speakers:[]}],refs:[]};},
  async finish(p){finishArgs=structuredClone(p.args);return{what:"memory",query:taskPlan.goal,status:"partial",hits:[],authority:"conversation_report",coverage:{used:p.args.selected,omitted:[],unknown:p.args.unknown},refs:[]};},
  select(q,batch){if(q.key.startsWith("coverage:")){if(batch.state.need===needs[0])return Number(q.target.slice(6))<30?"essential":"irrelevant";if(batch.state.need===needs[1])return q.target==="entry:30"?"essential":"irrelevant";if(batch.state.need===needs[2])return q.target==="entry:31"?"essential":"irrelevant";return q.target==="entry:32"?"essential":"irrelevant";}if(q.key.startsWith("support:"))return"supported";if(q.key.startsWith("applicability:"))return"current";return"none";}});
 assert.equal(app.result.status,"partial");assert.deepEqual(finishArgs.selected.slice(0,4),["entry:0","entry:30","entry:31","entry:32"]);
 assert.deepEqual(app.calls.filter(call=>call.operation==="memory.original").slice(0,4).map(call=>call.args.alias),["entry:0","entry:30","entry:31","entry:32"]);
 for(const alias of ["entry:30","entry:31","entry:32"])assert.equal(finishArgs.unknown.includes(alias),false);assert.ok(finishArgs.unknown.includes("entry:29"));
 const coverageBatches=app.batches.filter(batch=>batch.questions.some(question=>question.key.startsWith("coverage:")));assert.deepEqual(new Set(coverageBatches.map(batch=>batch.state.need)),new Set(needs));
 assert.ok(coverageBatches.flatMap(batch=>batch.state.candidates).some(candidate=>candidate.alias==="entry:32"&&candidate.text==="Knott promises payment only after completion."));
});

test("widens indexed evidence when any requested subquestion lacks selected supported essential or useful evidence",async()=>{
 const needs=["What amount was offered?","What condition applied to payment?"],taskPlan={...plan,goal:"Answer both payment questions.",subgoals:needs,evidenceRequired:needs};
 const amount=row("entry:0","The offered amount was one hundred dollars."),condition=row("entry:1","Payment is due only after the work is complete.");let finishArgs;
 const app=await fixture({taskPlan,snapshots:[snap("indexed-one-need",1,1,0,false),snap("raw-both-needs",2,1,1,true)],rowsBySnapshot:{"indexed-one-need":[amount],"raw-both-needs":[amount,condition]},
  async original(p){const entry=p.args.alias==="entry:0"?amount:condition;return{alias:p.args.alias,verified:true,entry,authority:"conversation_report",original:{line:"main",loop:0,turn:10},context:[{role:"keeper",text:entry.text,range:{offset:0,end:entry.text.length},total_chars:entry.text.length,truncated:false,speakers:[]}],refs:[]};},
  async finish(p){finishArgs=structuredClone(p.args);return{what:"memory",query:taskPlan.goal,status:"ready",hits:[],authority:"conversation_report",coverage:{used:p.args.selected,omitted:[],unknown:p.args.unknown},refs:[]};},
  select(q,batch){if(q.key.startsWith("coverage:")){if(batch.state.need===needs[0])return q.target==="entry:0"?"essential":"irrelevant";return q.target==="entry:1"?"essential":"irrelevant";}if(q.key.startsWith("support:"))return"supported";if(q.key.startsWith("applicability:"))return"current";return"none";}});
 assert.equal(app.result.status,"complete");assert.deepEqual(app.calls.filter(call=>call.operation==="memory.snapshot").map(call=>call.args),[{}, {raw_all:true}]);
 assert.equal(app.calls.filter(call=>call.operation==="memory.finish").length,1,"the incomplete indexed snapshot is widened before finish");assert.deepEqual(finishArgs.selected,["entry:0","entry:1"]);assert.deepEqual(finishArgs.unknown,[]);
});

test("normalizes sparse raw rows and finishes oversized verified evidence as explicit unknown",async()=>{
 assert.equal(MEMORY_READ_POLICY_VERSION,"5");let finishArgs;
 const sparse={alias:"entry:0",origin:"raw",text:`${"x".repeat(780)} exact tail`,turn:9,line:"main",authority:"conversation_report",derived:false,links:[]};
 const oversizedContext=Array.from({length:24},(_,index)=>({role:"player",text:`${index}:${"e".repeat(2_000)}`,range:{offset:index*2_002,end:(index+1)*2_002},total_chars:48_048,truncated:false,speakers:[]}));
 const app=await fixture({snapshots:[snap("bounded",1,0,1,true)],rowsBySnapshot:{bounded:[sparse]},
  async original(){return{alias:"entry:0",verified:true,entry:sparse,authority:"conversation_report",original:{line:"main",turn:9},context:oversizedContext,refs:[]};},
  async finish(p){finishArgs=structuredClone(p.args);return{what:"memory",query:plan.goal,status:"partial",hits:[{alias:"entry:0",context:[{text:"Exact retained report."}]}],authority:"conversation_report",coverage:{used:["entry:0"],omitted:[],unknown:["entry:0"]},refs:[]};},
  select(q){return q.key.startsWith("coverage:")?"essential":"unknown";}});
 assert.equal(app.result.status,"partial",JSON.stringify(app.result));assert.deepEqual(finishArgs.selected,["entry:0"]);assert.deepEqual(finishArgs.unknown,["entry:0"]);
 assert.deepEqual(finishArgs.assessments,[{alias:"entry:0",relevance:"direct",support:"unknown",applicability:"unknown",contradiction:"unknown"}]);
 const assessment=app.batches.find(batch=>batch.questions.some(q=>q.key.startsWith("support:")));assert.ok(assessment,"bounded exact evidence remains assessable");assert.equal(assessment.state.evidence[0].original.context_coverage.complete,false);assert.ok(assessment.state.evidence[0].original.context_coverage.omitted>0);
 for(const batch of app.batches){assertJson(batch.state);assert.ok(Buffer.byteLength(JSON.stringify(batch),"utf8")<30_000);}
 const candidate=app.batches.find(batch=>batch.questions.some(q=>q.key.startsWith("coverage:"))).state.candidates[0];
 assert.equal(candidate.kind,null);assert.equal(candidate.subject,null);assert.equal(candidate.loop,null);assert.equal(candidate.state,null);assert.equal(candidate.attribution,null);
});
