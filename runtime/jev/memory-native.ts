/** Native memory orchestration: typed annotations and existing kernel transactions, no author. */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {bindDecisionAnswers,type DecisionBatch} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import {decideReferencedMemoryStep} from './memory-write-domain.ts';
import {decideMemoryStory,type StoryPacket} from './memory-story-decision.ts';
interface Packet {protocol:string;job_id:string;turn:number;status:string;step:{key:string;total:number;remaining:number;segments:unknown[]};story_context?:StoryPacket['story_context'];story_complete:boolean;story_sources:Array<{role:string;alias:string;text:string}>}
export async function writeMemoryArtifact(path:string,text:string):Promise<void>{
 const temp=path+'.'+randomUUID()+'.tmp';
 try{await writeFile(temp,text,{flag:'wx',mode:0o600});await rename(temp,path);}finally{await rm(temp,{force:true});}
}
export async function runNativeMemory(initial:unknown,options:{campaign:string;cwd:string;signal:AbortSignal;port:DecisionPort;longContext?:boolean;call:(method:string,params:Record<string,unknown>)=>Promise<unknown>;record:(row:Record<string,unknown>)=>Promise<void>}):Promise<{status:string;remaining:number;candidates:number;steps:number;requests:number;deferred:Record<string,unknown>[]}> {
 let requests=0;const deferred:Record<string,unknown>[]=[];
 const outcome=(status:string,remaining:number,candidates:number,steps:number)=>({status,remaining,candidates,steps,requests,deferred});
 const {signal}=options,record=async(row:Record<string,unknown>)=>{if(row.event==='reference_source_deferred')deferred.push(row);await options.record(row);},root=join(options.cwd,'.coc','memory-decisions',options.campaign);
 type Saved={answers:Record<string,unknown>;tail:Promise<void>};
 const catalogs=new Map<string,Promise<Saved>>();
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const reusable=(answer:any)=>answer?.status==='answered'&&!(answer.type==='choice'&&answer.choice==='uncertain_attribution');
 const cached:DecisionPort={async decide(batch,lease){
  const state=batch.state as {sources?:Array<{alias:string;text:string;role:string}>;exchange?:Array<{alias:string;text:string;role:string}>;prior?:Array<{alias:string}>};
  if(batch.family==='native-memory'&&state.exchange&&(!state.sources||state.sources.every(source=>state.exchange?.some(row=>row.alias===source.alias&&row.text===source.text&&row.role===source.role)))){
   const {sources:_,prior:priors,...common}=state,identity=hash({model:batch.model,version:batch.familyVersion,scope:batch.scope,readSet:batch.readSet.filter(row=>row.kind!=='source'),state:common}),file=join(root,identity+'.json');
   let entry=catalogs.get(identity);
   if(!entry){entry=(async()=>{try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.identity===identity)return {answers:saved.answers??{},tail:Promise.resolve()};}catch{}return {answers:{},tail:Promise.resolve()};})();catalogs.set(identity,entry);}
   const saved=await entry,answers:Record<string,unknown>={},missing:DecisionBatch['questions']=[],keys=new Map<string,string>();
   for(const q of batch.questions){const {key:_,...semantic}=q,k=hash({semantic,prior:priors?.filter(row=>q.target.endsWith(' '+row.alias))??[]});keys.set(q.key,k);const answer=saved.answers[k];
    if(reusable(answer)&&bindDecisionAnswers({...batch,questions:[q]},{[q.key]:answer}).status==='complete')answers[q.key]=answer;else missing.push(q);
   }
   if(missing.length){requests++;const result=await options.port.decide({...batch,state:{...state,...(priors?{prior:priors.filter(row=>missing.some(q=>q.target.endsWith(' '+row.alias)))}:{})} as DecisionBatch['state'],questions:missing},lease);Object.assign(answers,result.answers);
    if(!signal.aborted){for(const q of missing){const answer=result.answers[q.key];if(reusable(answer)&&bindDecisionAnswers({...batch,questions:[q]},{[q.key]:answer}).status==='complete')saved.answers[keys.get(q.key)!]=answer;else delete saved.answers[keys.get(q.key)!];}
     saved.tail=saved.tail.catch(()=>{}).then(async()=>{await mkdir(root,{recursive:true});await writeMemoryArtifact(file,JSON.stringify({identity,answers:saved.answers}));});await saved.tail;
    }
   }
   await record({event:'decision_cache',hit:missing.length===0,hits:batch.questions.length-missing.length,misses:missing.length,questions:batch.questions.length,family:batch.family});
   return bindDecisionAnswers(batch,answers);
  }
  const identity=createHash('sha256').update(JSON.stringify(batch)).digest('hex'),file=join(root,identity+'.json');
  try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.identity===identity){const result=bindDecisionAnswers(batch,saved.answers);if(result.status==='complete'){await record({event:'decision_cache',hit:true,questions:batch.questions.length,family:batch.family});return result;}}}catch{/* Unavailable private cache is not memory authority. */}
  requests++;const result=await options.port.decide(batch,lease);
  if(result.status==='complete'&&!signal.aborted){await mkdir(root,{recursive:true});await writeMemoryArtifact(file,JSON.stringify({identity,answers:result.answers}));}
  await record({event:'decision_cache',hit:false,questions:batch.questions.length,family:batch.family});return result;
 }};
 let packet=initial as Packet,candidates=0,steps=0;const seen=new Set<string>();
 let storyWork:Promise<Awaited<ReturnType<typeof decideMemoryStory>>|undefined>|undefined;
 const limit=packet.step.total+1;
 while(!signal.aborted&&steps<limit){
  if(packet.status==='done')return outcome('complete',0,candidates,steps);
  if(seen.has(packet.step.key))return outcome('pending_review',packet.step.remaining,candidates,steps);seen.add(packet.step.key);
  const storyBegan=Date.now();
  storyWork??=packet.story_complete?Promise.resolve(undefined):decideMemoryStory({story_context:packet.story_context,
   player_text:packet.story_sources.filter(s=>s.role==='player').map(s=>s.text).join('\n'),keeper_text:packet.story_sources.filter(s=>s.role==='keeper').map(s=>s.text).join('\n')},options.campaign,cached,signal)
   .then(async result=>{await record({event:'story_decision',reviewer:'jev',status:result.status,ms:Date.now()-storyBegan,questions:result.questions,judgments:result.judgments,...(result.basis?{basis:result.basis}:{}),...(result.status==='pending'?{reason:result.reason}:{story_status:result.story?.status})});return result;});
  const projection=await decideReferencedMemoryStep(packet,cached,signal,record,{longContext:options.longContext}),story=await storyWork;
  let assessment:Record<string,unknown>|undefined;
  if(story?.status==='complete'&&story.story){
   const s=story.story,source=(role:string,text:string|null)=>text===null?null:packet.story_sources.find(v=>v.role===role&&v.text.includes(text))?.alias;
   const frame=source('player',s.frame),delivery=source('keeper',s.delivery_quote);
   if(frame!==undefined&&delivery!==undefined)assessment={status:s.status,thread:s.thread,frame_source:frame,bridge_delivered:s.bridge_delivered,delivery_source:delivery};
  }
  signal.throwIfAborted();
  if(!assessment&&(!projection.decisions.length||packet.status==='pending'&&projection.decisions.every(d=>(d as {outcome?:string}).outcome==='defer')))return outcome('pending_review',packet.step.remaining,candidates,steps);
  const began=Date.now();
  const result=await options.call('memory.submit',{campaign:options.campaign,job_id:packet.job_id,referenced:{...projection,...(assessment?{story:assessment}:{})}}) as {status:string;remaining:number;candidates?:number;next?:Packet};
  steps++;candidates+=result.candidates??0;
  await record({event:'reference_submission',ms:Date.now()-began,step:steps,status:result.status,remaining:result.remaining,retained:projection.decisions.filter(d=>(d as {outcome?:string}).outcome==='retain').length,skipped:projection.decisions.filter(d=>(d as {outcome?:string}).outcome==='skip').length,deferred:projection.decisions.filter(d=>(d as {outcome?:string}).outcome==='defer').length});
  if(result.status==='done')return outcome('complete',0,candidates,steps);
  if(result.status==='pending'||!result.next)return outcome('pending_review',result.remaining,candidates,steps);
  packet=result.next;
 }
 return outcome('pending_review',packet.step.remaining,candidates,steps);
}
