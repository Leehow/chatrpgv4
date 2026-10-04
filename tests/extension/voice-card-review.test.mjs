import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reviewVoiceCard} from '../../runtime/jev/voice-card-review.ts';
const input = {campaign:'c',jobId:'opaque-generation',source:{play_language:'zh-Hans',npc:{voice:'Quiet and practical.'}},candidate:{voice:{mask:'Quiet practical phrasing',exchanges:['Hello → Hello','Where → Here','Certain → Not yet']}}};
const port = scores => ({async decide(batch) {return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:scores[q.key]??.01}])),issues:[],coverage:{required:[],answered:[],unknown:[]}};}});
test('source-bound voice review can approve clean cards, reject a fixed agenda, and defer ambiguity',async()=>{
 const signal=new AbortController().signal;
 assert.equal((await reviewVoiceCard(input,port({}),signal)).status,'accepted');
 const bad=await reviewVoiceCard(input,port({fixed_agenda:.99}),signal);
 assert.equal(bad.status,'rejected');assert.ok(bad.defects.includes('fixed_agenda'));
 assert.equal((await reviewVoiceCard(input,port({translation_description:.5}),signal)).status,'fallback');
});
test('cancelled voice review never supplies a publication verdict',async()=>{
 const control=new AbortController();control.abort();
 assert.equal((await reviewVoiceCard(input,port({}),control.signal)).status,'fallback');
});
