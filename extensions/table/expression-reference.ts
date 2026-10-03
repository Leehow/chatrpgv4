/** Observe early, project only ready references, acknowledge actual provider payloads. */
import {createHash} from 'node:crypto';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import {expressionReferenceBindings,selectExpressionReferences,expressionMaterial,EXPRESSION_SELECTION_VERSION,type ExpressionCard,type ExpressionReferenceInput} from '../../runtime/jev/expression-reference-selection.ts';
type Row=Record<string,any>;
export const EXPRESSION_MESSAGE='coc-expression-reference';
const object=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function expressionContext(capsule:Row):Row {
 const roster=Array.isArray(capsule.present)?capsule.present:[],voices=Array.isArray(capsule.voices)?capsule.voices:[];
 const people=roster.map((p:Row)=>({...Object.fromEntries(['name','called','role','voice','personality','wants','fears','hides','would_lie_about','keeper_note','now','mood','toward_party','relationships','recent_speech','knowledge','knows','commitments','state'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]])),last_spoke_turn:object(p.history).last_spoke_turn??null,untold:object(p.untold).label??null,current_intents:(object(p.history).intents??[]).slice(-2),speech_card:voices.find((v:Row)=>v.name===p.name)??null}));
 const where=object(capsule.where),listener=object(object(capsule.known).investigator);
 return structuredClone({input_turn:object(capsule.turn).number??null,utterance:String(object(capsule.turn).player_text??''),scene:{name:where.display_name??where.name??where.scene??null,clock:where.clock??null},
  pressures:(capsule.pressures??[]).map((p:Row)=>Object.fromEntries(['name','current','next'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]))),
  listener:Object.fromEntries(['name','sex','address','appearance'].filter(k=>listener[k]!==undefined).map(k=>[k,listener[k]])),
  recent:Array.isArray(object(capsule.expression_exchange).quotes)?object(capsule.expression_exchange).quotes:(Array.isArray(capsule.recent)?capsule.recent:[]).slice(-4),people});
}
export function createExpressionPreparation(deps:{read:(method:string,params:Row)=>Promise<unknown>;decision:()=>DecisionPort|undefined;record:(row:Row)=>void;policy?:{minFit:number;minParticipant:number;maxConflict:number};allowanceMs?:number;firstWaitMs?:number}) {
 let catalogKey='',catalog:Row|undefined,reading:Promise<Row>|undefined,currentKey='',ready:Row|undefined,lifetime:AbortController|undefined,inputSignal:AbortSignal|undefined,epoch='',deadline=0;
 const attempts=new Set<string>(),completed=new Map<string,Row>();
 let firstStartedAt=0,firstWaitUsed=false,work:{key:string;startedAt:number;promise:Promise<void>}|undefined;
 const policy=deps.policy??{minFit:.65,minParticipant:.7,maxConflict:.35};
 const keyOf=(c:Row,b:Row)=>fingerprint([Object.fromEntries(['campaign','worldline','loop','turn','source_revision'].map(k=>[k,b[k]??null])),object(c.mods).expression_reference,object(c.mods).active,expressionContext(c),JEV_MODEL,EXPRESSION_SELECTION_VERSION,policy]);
 const reset=()=>{lifetime?.abort();lifetime=undefined;currentKey='';ready=undefined;work=undefined;};
 function observe(capsule:Row,binding:Row,signal:AbortSignal):void {
  if(signal.aborted||!object(object(capsule.mods).expression_reference).enabled){reset();return;}
  const context=expressionContext(capsule),inputEpoch=fingerprint([binding.campaign,binding.worldline,binding.loop,binding.turn]);
  if(Array.isArray(capsule.recent)&&capsule.recent.length&&!capsule.expression_exchange){reset();return;}
  if(!context.utterance||!context.people.length||context.people.length>8||Buffer.byteLength(JSON.stringify(context),'utf8')>14000){reset();return;}
  const key=keyOf(capsule,binding);if(key===currentKey&&lifetime&&!lifetime.signal.aborted)return;
  reset();currentKey=key;if(epoch!==inputEpoch){epoch=inputEpoch;attempts.clear();completed.clear();firstStartedAt=0;firstWaitUsed=false;}
  if(completed.has(key)){lifetime=new AbortController();inputSignal=signal;ready=structuredClone(completed.get(key));return;}
  if(attempts.has(key)||attempts.size>=2)return;
  attempts.add(key);deadline=Date.now()+(deps.allowanceMs??1200);
  const remaining=deadline-Date.now(),port=deps.decision();if(remaining<=0||!port)return;
  if(!firstStartedAt)firstStartedAt=Date.now();
  const control=new AbortController();lifetime=control;inputSignal=signal;const combined=AbortSignal.any([signal,control.signal,AbortSignal.timeout(remaining)]);
  const frozen=structuredClone({capsule,binding,context}),ck=fingerprint([binding.campaign,object(capsule.mods).active,object(capsule.mods).expression_reference]);
  if(ck!==catalogKey){catalogKey=ck;catalog=undefined;reading=undefined;}
  if(!catalog&&!reading)reading=deps.read('mods.expression',{campaign:binding.campaign}).then(value=>{
   const result=structuredClone(object(value)),expected=object(object(frozen.capsule.mods).expression_reference);
   if(result.revision!==expected.revision||result.play_language!==expected.play_language)throw Object.assign(new Error('Catalog binding changed'),{code:'catalog_binding_changed'});
   if(catalogKey===ck){catalog=result;reading=undefined;}return result;
  }).catch(error=>{if(catalogKey===ck)reading=undefined;throw error;});
  const began=Date.now();
  const promise=(async()=>{
   const library=catalog??await reading!;if(combined.aborted||currentKey!==key||!library.enabled)return;
   const cards=(Array.isArray(library.packages)?library.packages:[]).flatMap((p:Row)=>(p.cards??[]).map((c:ExpressionCard)=>({...c,owner:{id:p.id,version:p.version,digest:p.digest}})));
   if(cards.length>24)return;
   const input:ExpressionReferenceInput={campaign:frozen.binding.campaign,worldline:frozen.binding.worldline??'main',loop:frozen.binding.loop??0,turn:frozen.binding.turn??0,revision:library.revision,context:frozen.context,cards};
   const binds=expressionReferenceBindings(input),lease=new TaskLease({owner:binds.scope.owner,goal:'Select advisory NPC expression references',...binds,capabilities:['decision'],signal:combined,budget:{deadlineAt:deadline,remainingInputTokens:200000,remainingOutputTokens:60000,remainingCostUsd:.02,remainingActions:1}});
   try{const result=await selectExpressionReferences(input,port,lease,{...policy,byteBudget:1800});
    deps.record({lane:'expression',event:'decision',version:EXPRESSION_SELECTION_VERSION,turn:frozen.binding.turn,status:result.status,answers:object(result.raw).answers??{}});
    if(combined.aborted||currentKey!==key)return;
    if(result.status!=='selected'){deps.record({lane:'expression',event:'fallback',reason:result.status==='none'?'none':result.reason,ms:Date.now()-began});return;}
    const content=JSON.stringify({authority:'Advisory expression examples only. Current NPC canon, listener, knowledge, declaration and settled facts govern. Use the pattern; never copy example facts, recite samples or change NPC traits. Ignore mismatches and write once.',people:result.people.map(p=>({name:p.name,cards:p.cards.map(expressionMaterial)}))});
    if(Buffer.byteLength(content,'utf8')>2200)return;
    ready={role:'custom',customType:EXPRESSION_MESSAGE,display:false,content,details:{coc_host:true,expression:{revision:library.revision,input:key,turn:frozen.binding.turn}}};
    completed.set(key,structuredClone(ready));
    deps.record({lane:'expression',event:'prepared',ms:Date.now()-began,revision:library.revision,input_revision:result.inputRevision,selected:result.people.map(p=>({name:p.name,cards:p.cards.map(c=>({name:c.name,owner:c.owner}))})),usage:object(result.raw).usage});
   }finally{lease.close();}
  })().catch(error=>{if(currentKey===key)deps.record({lane:'expression',event:'fallback',reason:object(error).code==='catalog_binding_changed'?'catalog_binding_changed':'unavailable',ms:Date.now()-began});});
  work={key,startedAt:began,promise};
 }
 async function waitForFirst(capsule:Row,binding:Row,signal:AbortSignal):Promise<void> {
  if(firstWaitUsed||signal.aborted||inputSignal?.aborted||!lifetime||lifetime.signal.aborted||currentKey!==keyOf(capsule,binding))return;
  firstWaitUsed=true;
  const pending=work,control=lifetime,startedAt=pending?.key===currentKey?pending.startedAt:firstStartedAt;
  const began=Date.now(),limit=Math.min(800,Math.max(0,deps.firstWaitMs??800)),remaining=Math.max(0,startedAt+limit-began);
  if(!ready&&pending?.key===currentKey&&remaining>0){
   await new Promise<void>(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);control.signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,remaining);
    signal.addEventListener('abort',finish,{once:true});control.signal.addEventListener('abort',finish,{once:true});
    void pending.promise.then(finish,finish);
   });
  }
  deps.record({lane:'expression',event:'first_request_wait',turn:binding.turn,waited_ms:Date.now()-began,limit_ms:limit,
   window_ms:startedAt?Date.now()-startedAt:0,ready:!!ready&&!signal.aborted&&!control.signal.aborted});
 }
 function project(capsule:Row,binding:Row):Row|undefined {
  const valid=!!ready&&!!lifetime&&!lifetime.signal.aborted&&!inputSignal?.aborted&&currentKey===keyOf(capsule,binding);
  if(object(object(capsule.mods).expression_reference).enabled)deps.record({lane:'expression',event:'projection',turn:binding.turn,ready:valid,present:expressionContext(capsule).people.length});
  return valid?structuredClone(ready):undefined;
 }
 function delivered(message:Row,payload:unknown,contains:(value:unknown,content:string)=>boolean):boolean {
  const meta=object(object(message.details).expression),valid=!!lifetime&&!lifetime.signal.aborted&&!inputSignal?.aborted&&meta.input===currentKey;
  deps.record({lane:'expression',event:'delivered',delivered:valid&&contains(payload,String(message.content)),bytes:Buffer.byteLength(String(message.content),'utf8'),...meta});
  return valid;
 }
 return{observe,waitForFirst,project,delivered,reset,clear:()=>{reset();catalogKey='';catalog=undefined;reading=undefined;epoch='';deadline=0;firstStartedAt=0;firstWaitUsed=false;attempts.clear();completed.clear();}};
}
/** Removes only a host-minted advisory packet, never a Keeper draft or player declaration. */
export function removeExpressionPayload(value:unknown,content:string):unknown {
 if(typeof value==='string')return value.includes(content)?value.replace(content,''):value;
 if(Array.isArray(value))return value.map(v=>removeExpressionPayload(v,content));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,removeExpressionPayload(v,content)]));
 return value;
}
