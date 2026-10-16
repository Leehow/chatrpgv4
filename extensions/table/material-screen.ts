/** Request-local optional material selection; canonical tools and stored records are never changed. */
import {createHash,randomUUID} from 'node:crypto';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {packDecisionBatch,JEV_VISUAL_MODEL} from '../../runtime/jev/question-packing.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import type {DecisionBatch,DecisionResult} from '../../runtime/jev/contracts.ts';
import {readJevApiKey} from '../jev/agent/config.js';
type Row=Record<string,any>;
type Candidate={key:string;text:string;family:'mod'|'npc';actor?:string};
const object=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const array=(v:unknown):Row[]=>Array.isArray(v)?v:[];
const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const size=(v:unknown)=>Buffer.byteLength(JSON.stringify(v),'utf8');
const terminal=new Set(['done','failed','abandoned']);
const fulfilled=new Set(['fulfilled','cancelled','superseded']);
const FAMILY='material-screen';
const THRESHOLD=.25;
const ALLOWANCE_MS=4000;

export function instructionScreenRanges(instruction:Row,metadata:Row):Row[]|undefined{
  if(instruction.form!=='full'||typeof instruction.instruction!=='string')return;
  const info=object(metadata.material_screen),ranges=array(info.ranges),text=instruction.instruction;
  if(!ranges.length||info.digest!==hash(text))return;
  let end=0;
  for(const range of ranges){
    if(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start!==end||range.end<=end
      ||range.end>text.length||!['resident','situational'].includes(range.kind))return;
    end=range.end;
  }
  return end===text.length?ranges:undefined;
}

/** Enumerate only authored optional sections and terminal history; all other fields remain resident. */
export function materialPlan(messages:readonly Row[],capsule:Row,binding:Row):Row{
  const metadata=new Map(array(object(capsule.mods).instructions).map(row=>[`${row.mod}@${row.version}`,row]));
  const values=messages.map(message=>{
    if(message.role!=='custom'||!['coc-context-brief','coc-capsule','coc-capsule-update','coc-clerk'].includes(message.customType)
      ||typeof message.content!=='string')return;
    try{return JSON.parse(message.content);}catch{return;}
  });
  const candidates:Candidate[]=[],contexts:Row[]=[];
  const add=(value:Omit<Candidate,'key'>)=>{const candidate={...value,key:hash(value)};if(!candidates.some(c=>c.key===candidate.key))candidates.push(candidate);return candidate.key;};
  const instructionLists=(value:Row):Row[][]=>[value.instructions,object(value.mods).instructions,object(object(value.sections).mods).instructions].filter(Array.isArray);
  for(const [mi,value]of values.entries()){
    if(!value)continue;
    for(const list of instructionLists(value))for(const row of list){
      const ranges=instructionScreenRanges(row,metadata.get(`${row.mod}@${row.version}`)??row);
      if(ranges)for(const range of ranges)if(range.kind==='situational')add({family:'mod',text:JSON.stringify({mod:row.mod,
        version:row.version,heading:range.heading,instruction:row.instruction.slice(range.start,range.end)})});
    }
    for(const person of array(value.people)){
      contexts.push({name:person.name,availability:person.availability,cognition:person.cognition,relationships:person.relationships,
        recent_speech:person.recent_speech,mood:object(person.ledger).mood,
        active_intentions:array(object(person.ledger).intents).filter(row=>!terminal.has(row.status))});
      for(const row of array(object(person.ledger).intents))if(terminal.has(row.status))add({family:'npc',actor:person.name,text:JSON.stringify({kind:'terminal_intention',record:row})});
      for(const row of array(person.commitments))if(fulfilled.has(object(row.fulfillment).status))add({family:'npc',actor:person.name,text:JSON.stringify({kind:'fulfilled_commitment',record:row})});
    }
  }
  const user=[...messages].reverse().find(m=>m.role==='user');
  const input=typeof user?.content==='string'?user.content:array(user?.content).filter(p=>p.type==='text').map(p=>p.text).join('\n');
  const state=JSON.parse(JSON.stringify({request:input,scope:binding,where:capsule.where,turn:capsule.turn,
    people:contexts,obligations:capsule.obligations,known:capsule.known,recent:capsule.recent,
    authority:'Keeper-only evidence. Reports, actual actor knowledge, plans and settled facts remain distinct.'}));
  const basis=hash({state,candidates});
  const project=(omitted:Set<string>,compact=true)=>messages.map((message,mi)=>{
    const value=values[mi];if(!value)return message;
    const result=structuredClone(value),omissions:Row[]=[];
    for(const list of instructionLists(result))for(const row of list){
      const ranges=instructionScreenRanges(row,metadata.get(`${row.mod}@${row.version}`)??row);
      delete row.material_screen;
      if(!ranges)continue;
      row.instruction=ranges.filter(range=>{
        const key=hash({family:'mod',text:JSON.stringify({mod:row.mod,version:row.version,heading:range.heading,
          instruction:row.instruction.slice(range.start,range.end)})});
        if(range.kind==='situational'&&omitted.has(key)){omissions.push({mod:row.mod,heading:range.heading});return false;}return true;
      }).map(range=>row.instruction.slice(range.start,range.end)).join('');
    }
    for(const person of array(result.people)){
      const ledger=object(person.ledger),counts:Row={};
      for(const name of compact?['said','promises']:[]){
        const refs=array(ledger[name]);
        if(refs.length&&refs.every(row=>typeof row.memory_id==='string'&&Object.keys(row).every(k=>['memory_id','turn'].includes(k)))){
          counts[name+'_index']=refs.length;delete ledger[name];
        }
      }
      if(Array.isArray(ledger.intents))ledger.intents=ledger.intents.filter((row:Row)=>{
        const key=hash({family:'npc',actor:person.name,text:JSON.stringify({kind:'terminal_intention',record:row})});
        if(terminal.has(row.status)&&omitted.has(key)){counts.terminal_intentions=(counts.terminal_intentions??0)+1;return false;}return true;
      });
      if(Array.isArray(person.commitments))person.commitments=person.commitments.filter((row:Row)=>{
        const key=hash({family:'npc',actor:person.name,text:JSON.stringify({kind:'fulfilled_commitment',record:row})});
        if(fulfilled.has(object(row.fulfillment).status)&&omitted.has(key)){counts.fulfilled_commitments=(counts.fulfilled_commitments??0)+1;return false;}return true;
      });
      if(Object.keys(counts).length)person.material_coverage={...counts,read:'Use ordinary recall about this person for omitted history. Omission does not mean ignorance or absence.'};
    }
    if(omissions.length)result.material_coverage={omitted_mod_sections:omissions,read:'Full active package instructions remain available through lookup; omitted sections are not disabled rules.'};
    return {...message,content:JSON.stringify(result)};
  });
  return{state,basis,candidates,project};
}

export function materialBatches(plan:Row,scope:Row):DecisionBatch[]{
  const out:DecisionBatch[]=[];let questions:DecisionBatch['questions']=[];
  const build=(qs:DecisionBatch['questions'],long=false):DecisionBatch=>({id:randomUUID(),model:JEV_VISUAL_MODEL,
    family:FAMILY,familyVersion:'1',scope,readSet:[{kind:'draft',resource:'current-material-context',revision:plan.basis}],
    state:plan.state,questions:qs,...(long?{longContext:true}:{})});
  const fit=(qs:DecisionBatch['questions'])=>{try{const b=build(qs);packDecisionBatch(b);return b;}catch{
    const b=build(qs,true);packDecisionBatch(b);return b;}};
  for(const candidate of plan.candidates as Candidate[]){
    const prefix=`Actor: ${candidate.actor??'active Mod instructions'}. Candidate data: ${candidate.text}`;
    const next:DecisionBatch['questions']=[{key:'need:'+candidate.key,target:candidate.key,type:'noul',instructions:
      'Could this exact current turn need this candidate for the chosen action, its actual consequences, prerequisites or coherent response? '
      +'Include relevant history and instructions even when the player does not name a host operation. Mere name overlap is insufficient. '+prefix},
      {key:'qualifier:'+candidate.key,target:candidate.key,type:'noul',instructions:
      'Could omitting this candidate remove a specifically relevant restriction, contrary evidence, correction, obligation or distinction between a past plan and an actual outcome? '
      +'Do not grant knowledge to another actor; do not invent a future outcome. '+prefix}];
    try{fit([...questions,...next]);questions.push(...next);}catch{
      if(questions.length)out.push(fit(questions));questions=[];
      try{fit(next);questions=next;}catch{/* Oversized candidates remain unanswered and retained. */}
    }
  }
  if(questions.length)out.push(fit(questions));return out;
}

export function materialOmissions(plan:Row,answers:Row):Set<string>{
  return new Set((plan.candidates as Candidate[]).filter(candidate=>['need:','qualifier:'].every(prefix=>{
    const answer=answers[prefix+candidate.key];return answer?.status==='answered'&&answer.type==='noul'
      &&typeof answer.noul==='number'&&answer.noul<THRESHOLD;
  })).map(candidate=>candidate.key));
}

export function installMaterialScreen(pi:ExtensionAPI,record:(row:Row)=>void):void{
  let capsule:Row={},binding:Row={},single=false,control=new AbortController(),epoch='',remainingMs=0;
  let env={...process.env},adapter:ReturnType<typeof createDecisionAdapter>|undefined;
  const answers=new Map<string,Row>();
  const reset=()=>{control.abort();control=new AbortController();answers.clear();epoch='';remainingMs=0;};
  pi.events.on('coc:loop-engine',value=>{single=object(value).singleKeeper===true;});
  pi.events.on('coc:capsule',value=>{const data=object(value);capsule=object(data.capsule);binding=object(data.context);});
  pi.on('session_start',()=>{reset();env={...process.env};adapter=undefined;capsule={};binding={};});
  pi.on('session_shutdown',()=>{reset();capsule={};binding={};});
  pi.on('input',()=>{reset();});
  pi.on('context',async event=>{
    if(!single||!binding.campaign)return;
    const stamp=hash([capsule,binding]);
    const plan=materialPlan(event.messages as Row[],capsule,binding),full=size(event.messages),structural=plan.project(new Set());
    const enabled=env.PI_COC_MATERIAL_SCREEN!=='0'&&!!readJevApiKey(env);
    if(!enabled)return{messages:plan.project(new Set(),false)};
    const lifetime=control,identity=hash([binding.campaign,binding.worldline,binding.loop,binding.turn,plan.state.request]);
    if(identity!==epoch){epoch=identity;answers.clear();remainingMs=ALLOWANCE_MS;}
    const began=Date.now(),basis=plan.basis;
    let cached=answers.get(basis),usage={inputTokens:0,outputTokens:0,costUsd:0},calls=0,failures=0;
    if(!cached&&remainingMs>0){
      const decisionBegan=Date.now(),deadline=decisionBegan+remainingMs;
      const collected:Row={};
      adapter??=createDecisionAdapter({env,maxConcurrency:2,retryPolicies:{[FAMILY]:{maxRetries:0,backoffInitialMs:0,
        backoffMaxMs:0,attemptTimeoutMs:ALLOWANCE_MS}},trace:e=>{if(e.kind==='failure')record({lane:FAMILY,event:'provider_failure',code:e.code});}});
      const scope={owner:FAMILY,campaign:String(binding.campaign),worldline:String(binding.worldline??'main'),loop:Number(binding.loop??0),audience:'keeper' as const};
      const batches=materialBatches(plan,scope);
      await Promise.all(batches.map(async batch=>{
        if(Date.now()>=deadline||lifetime.signal.aborted)return;
        const lease=new TaskLease({owner:FAMILY,goal:'Select optional request material',scope,readSet:batch.readSet,
          capabilities:['decision'],signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))]),
          budget:{deadlineAt:deadline,remainingActions:1,remainingInputTokens:300000,remainingOutputTokens:200000,remainingCostUsd:.02}});
        try{calls++;const result:DecisionResult=await adapter!.decide(batch,lease);
          if(result.status!=='complete')failures++;
          Object.assign(collected,result.answers);
          usage.inputTokens+=result.usage?.inputTokens??0;usage.outputTokens+=result.usage?.outputTokens??0;usage.costUsd+=result.usage?.costUsd??0;
        }catch{failures++;}finally{lease.close();}
      }));
      cached=collected;
      if(lifetime===control&&!lifetime.signal.aborted&&epoch===identity){
        remainingMs=Math.max(0,remainingMs-(Date.now()-decisionBegan));answers.set(basis,collected);
      }
    }
    if(lifetime!==control||lifetime.signal.aborted||epoch!==identity)return;
    if(stamp!==hash([capsule,binding])){
      record({lane:FAMILY,event:'fallback',reason:'context_changed',turn:binding.turn});
      return{messages:plan.project(new Set(),false)};
    }
    const omitted=materialOmissions(plan,cached??{}),outgoing=plan.project(omitted);
    record({lane:FAMILY,event:'projection',campaign:binding.campaign,turn:binding.turn,model:JEV_VISUAL_MODEL,
      candidates:plan.candidates.length,omitted:omitted.size,unknown:plan.candidates.filter((c:Candidate)=>
        !cached?.['need:'+c.key]||!cached?.['qualifier:'+c.key]).length,
      before_bytes:full,structural_bytes:size(structural),after_bytes:size(outgoing),ms:Date.now()-began,calls,failures,usage,remaining_ms:remainingMs,
      fallback:!cached?'allowance_exhausted':failures?'partial_provider_failure':undefined,digest:hash(outgoing)});
    return{messages:outgoing};
  });
}
