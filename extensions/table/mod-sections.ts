/** Contract §183.5: the sections of indexed packages a turn needs. Jev scores the product's topics once per input; the
 *  kernel's gates and the turn's own calls do the rest; the text rides at the end of the request. Idle on any table whose
 *  instructions all go whole. */
import {createHash} from 'node:crypto';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import {judgeTopics,topicBindings,type Topic,type TopicInput,type TopicJudgement} from '../../runtime/jev/mod-section-topics.ts';
import {placeOperation} from '../kernel/place-operation.ts';
type Row=Record<string,any>;
export const MOD_SECTIONS_MESSAGE='coc-mod-sections';
/** The message's content ceiling (UTF-8 bytes); what does not fit is named in `omitted`. */
export const MOD_SECTIONS_BYTES=16384;
/** How long the first request of an input waits for the topics, and how long Jev may take at all. */
export const MOD_TOPICS_FIRST_WAIT_MS=2500,MOD_TOPICS_ALLOWANCE_MS=6000;
/** The bar a topic clears to count as fired for `no_topic`; a section may set its own for itself. */
export const DEFAULT_TOPIC_THRESHOLD=.5;
const AUTHORITY='Sections of active package instructions that this turn needs, chosen by its topics and the table\'s state. '
 +'They belong with the package instructions in the brief and carry the same authority; they are not player input, story events or new obligations.';
const object=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const array=(v:unknown):any[]=>Array.isArray(v)?v:[];
const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const bytes=(v:string)=>Buffer.byteLength(v,'utf8');

export const indexedRows=(capsule:Row):Row[]=>array(object(capsule.mods).instructions).filter(row=>object(row).form==='indexed'&&object(row).index_contract_version!==2);
/** The calls a trigger can name, made so far this turn: effect kinds of every apply, decision families of every resolve. */
export type TurnCalls={apply:Set<string>;resolve:Set<string>;context?:Set<string>};
export const emptyCalls=():TurnCalls=>({apply:new Set(),resolve:new Set()});
/** A resolve's decision family: the settled one from its result, else the family prefix of the decision it named. */
export function resolveFamily(input:Row,details:Row={}):string|undefined {
 if(typeof details.family==='string'&&details.family)return details.family;
 const ref=[details.decision,object(input.action).decision].find(value=>typeof value==='string'&&value);
 return ref?String(ref).replace(/^decision:coc7:/,'').split(':')[0]||undefined:undefined;
}
export function applyEffectKinds(tool:string,input:Row):string[]{
 const canonical=placeOperation(tool,input);
 const effects=canonical.name==='apply'?array(canonical.params.effects):tool==='output'?array(input.commands).filter(effect=>object(effect).kind==='place'):[];
 return effects.flatMap(effect=>typeof object(effect).kind==='string'?[object(effect).kind]:[]);
}
export function noteCall(calls:TurnCalls,tool:string,input:Row,details?:Row):void {
 for(const kind of applyEffectKinds(tool,input))calls.apply.add(kind);
 if(tool==='resolve'){const family=resolveFamily(input,details);if(family)calls.resolve.add(family);}
}

export type Picked={key:string;mod:string;version:string;heading:string|null;why:string[]};
/** The selection rule of §183.5, over the capsule's indexed rows. `judgement` undefined or unavailable is the fallback:
 *  every section with a topic whose kernel gates hold loads, its host gates aside. In pull mode (§248.4, the single
 *  Keeper) there is no judgement and no fallback: a topic section loads only when it has a kernel gate and its gates hold;
 *  the Keeper reads the others itself. */
export function selectSections(capsule:Row,judgement:TopicJudgement|undefined,calls:TurnCalls,pull=false):Picked[] {
 const scores=judgement?.status==='scored'?judgement.scores:undefined;
 const host={no_topic:!!scores&&!Object.values(scores).some(score=>score>=DEFAULT_TOPIC_THRESHOLD)};
 const picked:Picked[]=[];
 for(const instruction of indexedRows(capsule))for(const section of array(instruction.sections)){
  const why:string[]=[],topics=array(section.topics).map(String),gates=array(section.gates).map(String);
  if(section.due===true)why.push('due');
  if(topics.length&&section.gates_open===true){
   if(pull){if(gates.some(gate=>!(gate in host)))why.push('gate');}
   else if(!scores)why.push('fallback');
   else if(gates.every(gate=>!(gate in host)||host[gate as keyof typeof host])){
    const bar=typeof section.topic_threshold==='number'?section.topic_threshold:DEFAULT_TOPIC_THRESHOLD;
    why.push(...(topics.includes('*')?['*']:topics.filter(topic=>(scores[topic]??0)>=bar)).map(topic=>`topic:${topic}`));
   }
  }
  for(const trigger of array(section.triggers).map(String)){
   const [kind,name]=trigger.split(':');
   if(kind==='before_apply'&&calls.apply.has(name)||kind==='before_resolve'&&calls.resolve.has(name))why.push(`call:${trigger}`);
   if(kind==='before_apply'&&calls.context?.has(name))why.push(`context:${trigger}`);
  }
  if(why.length)picked.push({key:String(section.key),mod:String(instruction.mod),version:String(instruction.version),heading:section.heading??null,why});
 }
 return picked;
}

/** A section's listed name (§248.2), as `kernel-ts/read/sections.ts` writes it in the index. */
export const sectionName=(mod:string,heading:string|null)=>`${mod}: ${heading??'Package core'}`;
export function createModSections(deps:{read:(method:string,params:Row)=>Promise<unknown>;decision:()=>DecisionPort|undefined;record:(row:Row)=>void;
 firstWaitMs?:number;allowanceMs?:number;
 /** §248.4: the table asks no topic judgement; the Keeper reads topic sections itself. */
 pull?:()=>boolean}) {
 let key='',judgement:TopicJudgement|undefined,work:Promise<void>|undefined,startedAt=0,lifetime:AbortController|undefined,waited=false,lastSelection='';
 const texts=new Map<string,string>();
 /** §248.4: the schema-1 sections the last observed capsule indexes, by name, so the Keeper can read one. */
 const known=new Map<string,Row>();
 const pulling=()=>deps.pull?.()===true;
 const know=(capsule:Row)=>{
  known.clear();
  // A reference section is its own consumer's (§242, §247.4); the Keeper reads situational sections only.
  for(const instruction of indexedRows(capsule))for(const section of array(instruction.sections))if(section.kind!=='reference')
   known.set(sectionName(String(instruction.mod),section.heading??null).toLowerCase(),{key:String(section.key),mod:String(instruction.mod),
    version:String(instruction.version),heading:section.heading??null});
 };
 async function load(keys:readonly string[],campaign:unknown):Promise<void> {
  const missing=keys.filter(key=>!texts.has(key));
  if(!missing.length)return;
  const read=object(await deps.read('mods.sections',{campaign,keys:missing}));
  for(const section of array(read.sections))if(typeof object(section).key==='string'&&typeof object(section).text==='string')texts.set(section.key,section.text);
 }
 const reset=()=>{lifetime?.abort();lifetime=undefined;key='';judgement=undefined;work=undefined;startedAt=0;waited=false;lastSelection='';};
 const inputOf=(capsule:Row,binding:Row):TopicInput|undefined=>{
  const topics=array(object(capsule.mods).topics).map(object).filter(topic=>typeof topic.id==='string')
   .map(topic=>({id:String(topic.id),what:String(topic.what??''),not_for:String(topic.not_for??''),examples:array(topic.examples).map(String)})) as Topic[];
  const request=String(object(capsule.turn).player_text??'');
  if(!topics.length||!request||typeof binding.campaign!=='string')return undefined;
  const where=object(capsule.where);
  return{campaign:binding.campaign,worldline:typeof binding.worldline==='string'?binding.worldline:'main',loop:Number.isSafeInteger(binding.loop)?binding.loop:0,
   turn:Number.isSafeInteger(binding.turn)?binding.turn:0,request,scene:where.display_name??where.name??where.scene??null,
   present:array(capsule.present).map(person=>typeof person==='string'?person:object(person).name).filter((name):name is string=>typeof name==='string'&&!!name),topics};
 };
 function observe(capsule:Row,binding:Row,signal:AbortSignal):void {
  know(capsule);
  if(signal.aborted||!indexedRows(capsule).length){reset();return;}
  if(pulling()){
   const next=fingerprint(['pull',binding.campaign,binding.worldline,binding.loop,binding.turn,object(capsule.turn).player_text??'']);
   if(next!==key){reset();key=next;deps.record({lane:'mod-sections',event:'pull_mode',turn:binding.turn});}
   return;
  }
  const input=inputOf(capsule,binding);
  if(!input){reset();return;}
  // Once per input: the declaration, its turn and the topic list; a capsule re-read mid-turn keeps the judgement.
  const next=fingerprint([input.campaign,input.worldline,input.loop,input.turn,input.request,input.topics.map(topic=>topic.id)]);
  if(next===key)return;
  reset();key=next;
  const port=deps.decision();
  if(!port){judgement={status:'unavailable',reason:'unconfigured'};deps.record({lane:'mod-sections',event:'fallback',turn:input.turn,reason:'unconfigured'});return;}
  const control=new AbortController();lifetime=control;startedAt=Date.now();
  const deadline=startedAt+(deps.allowanceMs??MOD_TOPICS_ALLOWANCE_MS),binds=topicBindings(input);
  const lease=new TaskLease({owner:binds.scope.owner,goal:'Judge which turn topics the player declaration involves',...binds,capabilities:['decision'],
   signal:AbortSignal.any([signal,control.signal,AbortSignal.timeout(deadline-startedAt)]),
   budget:{deadlineAt:deadline,remainingInputTokens:200000,remainingOutputTokens:60000,remainingCostUsd:.02,remainingActions:1}});
  work=judgeTopics(input,port,lease).then(result=>{
   if(key!==next)return;
   judgement=result;
   deps.record(result.status==='scored'?{lane:'mod-sections',event:'topics',turn:input.turn,scores:result.scores,ms:Date.now()-startedAt,usage:result.usage??null}
    :{lane:'mod-sections',event:'fallback',turn:input.turn,reason:result.reason,ms:Date.now()-startedAt});
  }).finally(()=>lease.close());
 }
 /** The first request of an input waits for the topics, up to the first-wait allowance from when they were asked. */
 async function waitForFirst(signal:AbortSignal):Promise<void> {
  if(waited||!work||judgement)return;
  waited=true;
  const remaining=Math.max(0,startedAt+(deps.firstWaitMs??MOD_TOPICS_FIRST_WAIT_MS)-Date.now());
  if(!remaining)return;
  await new Promise<void>(resolve=>{
   const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
   const timer=setTimeout(finish,remaining);signal.addEventListener('abort',finish,{once:true});void work!.then(finish,finish);
  });
 }
 /** The turn's `coc-mod-sections` message, or undefined when nothing is selected or the text cannot be read. */
 async function message(capsule:Row,binding:Row,calls:TurnCalls):Promise<Row|undefined> {
  if(!indexedRows(capsule).length)return undefined;
  const late=!judgement&&!pulling();
  const picked=selectSections(capsule,judgement,calls,pulling());
  if(late&&picked.some(entry=>entry.why.includes('fallback')))
   deps.record({lane:'mod-sections',event:'fallback',turn:binding.turn,reason:'late',ms:startedAt?Date.now()-startedAt:0});
  if(!picked.length)return undefined;
  try{await load(picked.map(entry=>entry.key),binding.campaign);}
  catch{deps.record({lane:'mod-sections',event:'fallback',turn:binding.turn,reason:'read_failed'});return undefined;}
  const sections:Row[]=[],omitted:Row[]=[];
  for(const entry of picked){
   const text=texts.get(entry.key);if(typeof text!=='string')continue;
   const row={package:entry.mod,section:entry.heading??'(opening text)',text};
   if(bytes(JSON.stringify({authority:AUTHORITY,sections:[...sections,row],omitted}))<=MOD_SECTIONS_BYTES)sections.push(row);
   else omitted.push({package:entry.mod,section:row.section});
  }
  const content=JSON.stringify({authority:AUTHORITY,sections,...(omitted.length?{omitted}:{})});
  const selection=fingerprint([binding.turn,picked,omitted]);
  if(selection!==lastSelection){lastSelection=selection;
   deps.record({lane:'mod-sections',event:'selected',turn:binding.turn,keys:picked.map(entry=>({key:entry.key,why:entry.why})),bytes:bytes(content),
    ...(omitted.length?{omitted:omitted.map(entry=>`${entry.package}: ${entry.section}`)}:{})});}
  if(!sections.length)return undefined;
  return{role:'custom',customType:MOD_SECTIONS_MESSAGE,display:false,content,timestamp:0,
   details:{coc_host:true,mod_sections:{turn:binding.turn,keys:picked.filter(entry=>texts.has(entry.key)).map(entry=>entry.key)}}};
 }
 function delivered(sent:Row,payload:unknown,contains:(value:unknown,content:string)=>boolean):void {
  let carried=false;try{carried=contains(payload,String(sent.content));}catch{/* unserializable payload is unconfirmed */}
  deps.record({lane:'mod-sections',event:'delivered',delivered:carried,bytes:bytes(String(sent.content)),...object(object(sent.details).mod_sections)});
 }
 /** §248.4: the Keeper's read of one listed schema-1 section by its index name; undefined when the index has no such name. */
 async function read(name:string,campaign:unknown,turn?:unknown):Promise<Row|undefined> {
  const entry=known.get(name.trim().replace(/^"(.*)"$/,'$1').toLowerCase());
  if(!entry)return undefined;
  await load([entry.key],campaign);
  const text=texts.get(entry.key);
  if(typeof text!=='string')throw Error('mod_section_unavailable');
  deps.record({lane:'mod-sections',event:'read',turn,key:entry.key});
  return{read_only:true,no_commit:true,package_sections:[{package:entry.mod,section:entry.heading??'(opening text)',version:entry.version,text}]};
 }
 const names=()=>[...known.values()].map(entry=>sectionName(entry.mod,entry.heading));
 return{observe,waitForFirst,message,delivered,read,names,reset,clear:()=>{reset();texts.clear();known.clear();}};
}
