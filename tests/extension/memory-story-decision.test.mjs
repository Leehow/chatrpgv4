import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decideMemoryStory} from '../../runtime/jev/memory-story-decision.ts';
const packet={player_text:'The water caused it. I will investigate.',keeper_text:'The test linked the water to the illness.',story_context:{threads:[{thread:'illness',supporting:[{statement:'The water test was positive.'}],contradicting:[]}]}};
const run=(overrides={},input=packet)=>{let calls=0,batch;return {get calls(){return calls;},get batch(){return batch;},async result(){return decideMemoryStory(input,'camp',{async decide(value){calls++;batch=value;return {status:'complete',answers:Object.fromEntries(value.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='aligned-0-0'||q.key.startsWith('bridge-')?.99:.01,...overrides}]))};}},new AbortController().signal);}};};
test('one independent batch binds exact frame and delivery spans without authoring',async()=>{
 const h=run(),result=await h.result();assert.equal(h.calls,1);assert.equal(result.status,'complete');
 assert.deepEqual(result.story,{status:'aligned',thread:'illness',frame:'The water caused it.',bridge_delivered:true,delivery_quote:packet.keeper_text});
 assert.ok(h.batch.questions.some(q=>q.type==='noul'));assert.ok(h.batch.questions.every(q=>q.type==='noul'));
});
test('uncertainty and unavailable transport never invent unclear or false assessments',async()=>{
 for(const noul of [.5,NaN,1.1])assert.equal((await run({noul}).result()).status,'pending');
 assert.equal((await decideMemoryStory(packet,'camp',{decide:async()=>{throw Error('offline');}},new AbortController().signal)).status,'pending');
 assert.equal((await run({noul:.5}).result()).reason,'uncertain');
});
test('unsupported alignment and overlong source remain pending, empty context calls no judge',async()=>{
 const unsupported=run({}, {...packet,story_context:{threads:[{thread:'illness'}],truncated:false}});assert.equal((await unsupported.result()).story.status,'unclear');assert.equal(unsupported.calls,0);
 const h=run({}, {...packet,player_text:'x'.repeat(501)});assert.equal((await h.result()).reason,'oversized');assert.equal(h.calls,0);
 const empty=run({}, {...packet,story_context:undefined});assert.deepEqual(await empty.result(),{status:'complete',questions:0});assert.equal(empty.calls,0);
});

test('threads with no acquired evidence have no eligible causal assessment',async()=>{
 const h=run({}, {...packet,story_context:{threads:[{thread:'illness',supporting:[],contradicting:[]}],truncated:false}}),result=await h.result();
 assert.equal(h.calls,0);assert.equal(result.status,'complete');assert.equal(result.story.status,'unclear');assert.equal(result.basis,'no_acquired_evidence');
});

test('empty evidence in a truncated or unqualified projection cannot become unclear',async()=>{
 for(const truncated of [true,undefined]){const h=run({}, {...packet,story_context:{threads:[{thread:'illness',supporting:[],contradicting:[]}],...(truncated===undefined?{}:{truncated})}}),result=await h.result();assert.equal(result.status,'pending');assert.equal(result.reason,'incomplete_evidence');assert.equal(h.calls,0);}
});
