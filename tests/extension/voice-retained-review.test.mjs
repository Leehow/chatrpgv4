/** Exact retained artifacts, not model/gameplay acceptance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeVoice} from '../../extensions/npc-voice/writer.ts';
import {reviewVoiceCard} from '../../runtime/jev/voice-card-review.ts';

test('an unchanged voice draft and uncertain review survive restart without generating or judging again',async t=>{
 const home=await mkdtemp(join(tmpdir(),'coc-retained-voice-'));t.after(()=>rm(home,{recursive:true,force:true}));
 let generations=0,judgments=0;
 const runtime={home,runTask:async({request})=>{generations++;await writeFile(join(request.cwd,'draft.json'),JSON.stringify({voice:{mask:'Plain phrasing',exchanges:['Hello → Hello']}}));return {ok:true,command:['pi','--model','fixture/model']};}};
 const input={runtime,jobId:'voice:c:npc@source',model:'fixture/model',systemPrompt:'Existing card contract',input:'Exact source',signal:new AbortController().signal,shape:x=>x?.voice?x:undefined};
 const a=await writeVoice(input),b=await writeVoice({...input,runtime:{...runtime}});
 assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(generations,1);assert.equal(a.cwd,b.cwd);
 const port={async decide(batch){judgments++;return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='unsupported_facts'?.5:.01}]))};}};
 const packet={campaign:'c',jobId:input.jobId,source:{play_language:'en',npc:{voice:'Plain'}},candidate:a.value,cacheHome:home};
 const first=await reviewVoiceCard(packet,port,input.signal),second=await reviewVoiceCard({...packet},port,input.signal);
 assert.equal(first.reason,'uncertain');assert.equal(second.reason,'uncertain');assert.equal(judgments,1);
 assert.ok(second.blockers.some(b=>b.question==='unsupported_facts'&&b.probability===.5));
 await reviewVoiceCard({...packet,candidate:{voice:{mask:'Changed'}}},port,input.signal);assert.equal(judgments,2);
 await writeVoice({...input,input:'Changed source'});assert.equal(generations,2);
});
