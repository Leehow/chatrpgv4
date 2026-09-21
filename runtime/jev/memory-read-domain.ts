/** Adaptive read-only memory evidence policy. Kernel owners retain snapshot and original authority. */
import {createHash} from 'node:crypto';
import {isPlainRecord, type DecisionBatch, type Json} from './contracts.ts';
import type {TaskDomain, TaskStep, TaskView} from './task-runtime.ts';
import {JEV_MODEL} from './question-packing.ts';

export const MEMORY_READ_CAPABILITY = 'recall';
export const MEMORY_READ_POLICY_VERSION = '5';
const FAMILY = 'memory-read', VERSION = MEMORY_READ_POLICY_VERSION, MAX_BATCH_BYTES = 30_000, MAX_SELECTED = 20, MAX_REFRESHES = 2;
const MAX_CONTEXT_BYTES = 6_000, MAX_COMPARISON_BYTES = 9_000, MAX_ORIGINAL_BYTES = 12_000;
type Relevance = 'direct'|'context'|'irrelevant'|'uncertain';
type NeedPriority = 'essential'|'useful'|'background'|'irrelevant'|'unknown';
interface Snapshot {snapshot:string; raw_all:boolean; total:number; indexed:number; raw:number; coverage:{raw_gap_turns:number[];raw_unavailable_lines:string[]}; context:Json}
interface Row {alias:string;origin:string;kind:Json;subject:Json;text:string;turn:number;line:string;loop:Json;status:Json;state:Json;authority:string;attribution:Json;derived:boolean;links:Json[]}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const op=(name:string,key:string,args:Record<string,Json>={}):TaskStep=>({kind:'operation',key,operation:name,args,capability:MEMORY_READ_CAPABILITY,basis:[]});
const done=(status:'complete'|'partial'|'unresolved'|'failed',needs:string[]=[]):TaskStep=>({kind:'finish',status,remainingNeeds:needs});
const observation=(view:TaskView,key:string)=>view.observations.find(row=>row.key===key)?.packet;
const choice=(view:TaskView,key:string,q:string):string|undefined=>{const a=view.decisions.find(row=>row.key===key)?.result.answers[q];return a?.status==='answered'&&a.type==='choice'?a.choice:undefined;};
const dense=(v:unknown):v is unknown[]=>Array.isArray(v)&&Object.keys(v).length===v.length;
function snapshot(value:unknown):Snapshot|undefined{
  if(!isPlainRecord(value)||typeof value.snapshot!=='string'||!value.snapshot||typeof value.raw_all!=='boolean'
    ||![value.total,value.indexed,value.raw].every(v=>Number.isSafeInteger(v)&&Number(v)>=0)||!isPlainRecord(value.coverage)
    ||!dense(value.coverage.raw_gap_turns)||!dense(value.coverage.raw_unavailable_lines)||!isPlainRecord(value.context))return;
  return {snapshot:value.snapshot,raw_all:value.raw_all,total:Number(value.total),indexed:Number(value.indexed),raw:Number(value.raw),
    coverage:{raw_gap_turns:value.coverage.raw_gap_turns.map(Number),raw_unavailable_lines:value.coverage.raw_unavailable_lines.map(String)},context:value.context as Json};
}
const semantic=(value:unknown):Json=>{
  if(Array.isArray(value))return value.map(semantic);
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(!isPlainRecord(value))return null;
  const hidden=new Set(['snapshot','commit','refs','ref','id','job_id','hash','digest','source_revision','index_revision','world_revision']);
  return Object.fromEntries(Object.entries(value).filter(([k])=>!hidden.has(k)).map(([k,v])=>[k,semantic(v)]));
};
function pageRows(view:TaskView,s:Snapshot):{rows:Row[];next:number|null;valid:boolean}{
  const issued=view.observations.filter(o=>o.proposal.operation==='memory.page'&&o.proposal.args.snapshot===s.snapshot);
  if(issued.some(o=>o.packet.status!=='succeeded'))return{rows:[],next:null,valid:false};
  const pages=issued.filter(o=>o.packet.status==='succeeded')
    .sort((a,b)=>Number(a.proposal.args.offset)-Number(b.proposal.args.offset));
  const rows:Row[]=[];let expected=0,next:number|null=s.total?0:null;
  for(const item of pages){const v=item.packet.result;if(!isPlainRecord(v)||v.snapshot!==s.snapshot||v.offset!==expected||!dense(v.rows)
      ||!(v.next_offset===null||Number.isSafeInteger(v.next_offset)))return {rows,next,valid:false};
    for(const raw of v.rows){if(!isPlainRecord(raw)||typeof raw.alias!=='string'||typeof raw.text!=='string'||typeof raw.origin!=='string'
        ||!Number.isSafeInteger(raw.turn)||typeof raw.line!=='string'||typeof raw.authority!=='string'||typeof raw.derived!=='boolean'||!dense(raw.links))return {rows,next,valid:false};
      rows.push({alias:raw.alias,origin:raw.origin,kind:semantic(raw.kind),subject:semantic(raw.subject),text:raw.text,turn:Number(raw.turn),
        line:raw.line,loop:semantic(raw.loop),status:semantic(raw.status),state:semantic(raw.state),authority:raw.authority,
        attribution:semantic(raw.attribution),derived:raw.derived,links:raw.links.map(semantic)});}
    expected+=v.rows.length;next=v.next_offset as number|null;if(next!==null&&next!==expected)return {rows,next,valid:false};
  }
  return {rows,next,valid:rows.length===new Set(rows.map(r=>r.alias)).size};
}
function relevanceRow(row:Row):Json{const links=row.links.slice(0,16);return{alias:row.alias,origin:row.origin,kind:row.kind,subject:row.subject,text:row.text,turn:row.turn,line:row.line,loop:row.loop,status:row.status,state:row.state,authority:row.authority,attribution:row.attribution,derived:row.derived,links,links_omitted_count:row.links.length-links.length};}
function queryNeeds(view:TaskView):string[]{const source=view.plan.evidenceRequired.length?view.plan.evidenceRequired:view.plan.subgoals.length?view.plan.subgoals:[view.plan.goal];return[...new Set(source)];}
const coverageQuestion=(r:Row,needIndex:number):DecisionBatch['questions'][number]=>({key:`coverage:${needIndex}:${r.alias}`,target:r.alias,type:'choice',
  instructions:'Classify and prioritize this issued occurrence only for the stated subquestion. Essential directly supplies its concrete answer; useful materially interprets or qualifies that answer; background is relevant but repeated or general; irrelevant does not bear on this subquestion; unknown remains unresolved. Use the full issued text. Do not rank by recency, memory kind, or keywords. Conversation evidence is not module truth or consent.',
  criteria:{essential:'Directly supplies a concrete answer to this exact subquestion.',useful:'Materially interprets or qualifies its answer.',background:'Relevant but repeated or general background.',irrelevant:'Does not bear on this subquestion.',unknown:'Its relevance or priority for this subquestion remains unresolved.'}});
function coverageBatch(view:TaskView,need:string,needIndex:number,rows:Row[]):Omit<DecisionBatch,'id'|'scope'|'readSet'>{return{model:JEV_MODEL,family:FAMILY,familyVersion:VERSION,
  state:{query:view.plan.goal,need,need_index:needIndex,candidates:rows.map(relevanceRow)},questions:rows.map(row=>coverageQuestion(row,needIndex))};}
const fullBytes=(view:TaskView,b:Omit<DecisionBatch,'id'|'scope'|'readSet'>)=>Buffer.byteLength(JSON.stringify({...b,id:'00000000-0000-4000-8000-000000000000',scope:view.context.scope,readSet:view.context.readSet}),'utf8');
function groups<T>(view:TaskView,items:T[],make:(items:T[])=>Omit<DecisionBatch,'id'|'scope'|'readSet'>):T[][]|undefined{
  const out:T[][]=[];let group:T[]=[];for(const item of items){const next=[...group,item];if(group.length&&fullBytes(view,make(next))>MAX_BATCH_BYTES){out.push(group);group=[item];}else group=next;if(fullBytes(view,make(group))>MAX_BATCH_BYTES)return;}
  if(group.length)out.push(group);return out;
}
function coverage(view:TaskView,rows:Row[],snapshotKey:string,needs:string[]):Map<number,Map<string,NeedPriority>>{const issued=new Set(rows.map(row=>row.alias)),out=new Map(needs.map((_,index)=>[index,new Map<string,NeedPriority>()]));for(const row of view.decisions.filter(d=>d.key.startsWith(`memory-coverage:${snapshotKey}:`)))
  for(const q of row.batch.questions){const match=/^coverage:(\d+):/.exec(q.key),needIndex=match?Number(match[1]):-1;if(!out.has(needIndex)||!issued.has(q.target))continue;const v=row.result.answers[q.key];out.get(needIndex)!.set(q.target,v?.status==='answered'&&v.type==='choice'&&['essential','useful','background','irrelevant','unknown'].includes(v.choice)?v.choice as NeedPriority:'unknown');}
  return out;}
function roundRobin(rows:Row[],classified:Map<number,Map<string,NeedPriority>>,needCount:number):{ranked:Row[];relevance:Map<string,Relevance>;unknown:Set<string>}{
  const rank:Record<Exclude<NeedPriority,'irrelevant'>,number>={essential:0,useful:1,unknown:2,background:3},indexes=new Map(rows.map((row,index)=>[row.alias,index]));
  const buckets=Array.from({length:needCount},(_,needIndex)=>rows.filter(row=>classified.get(needIndex)!.get(row.alias)!=='irrelevant').sort((a,b)=>rank[classified.get(needIndex)!.get(a.alias) as Exclude<NeedPriority,'irrelevant'>]-rank[classified.get(needIndex)!.get(b.alias) as Exclude<NeedPriority,'irrelevant'>]||indexes.get(a.alias)!-indexes.get(b.alias)!));
  const ranked:Row[]=[],seen=new Set<string>(),positions=buckets.map(()=>0);let advanced=true;while(advanced){advanced=false;for(let index=0;index<buckets.length;index++){while(positions[index]<buckets[index].length&&seen.has(buckets[index][positions[index]].alias))positions[index]++;const row=buckets[index][positions[index]++];if(!row)continue;seen.add(row.alias);ranked.push(row);advanced=true;}}
  const relevance=new Map<string,Relevance>(),unknown=new Set<string>();for(const row of ranked){const values=Array.from({length:needCount},(_,index)=>classified.get(index)!.get(row.alias)!);if(values.includes('essential'))relevance.set(row.alias,'direct');else if(values.some(value=>value==='useful'||value==='background'))relevance.set(row.alias,'context');else relevance.set(row.alias,'uncertain');if(values.includes('unknown'))unknown.add(row.alias);}
  return{ranked,relevance,unknown};
}
function originals(view:TaskView,s:Snapshot):Map<string,Record<string,unknown>[]>{const out=new Map<string,Record<string,unknown>[]>();for(const row of view.observations.filter(o=>o.proposal.operation==='memory.original'&&o.proposal.args.snapshot===s.snapshot)){
  const alias=String(row.proposal.args.alias);if(!out.has(alias))out.set(alias,[]);out.get(alias)!.push(row.packet.status==='succeeded'&&isPlainRecord(row.packet.result)?row.packet.result:{alias,verified:false,reason:'original_read_unavailable'});}return out;}
function readRanges(reads:Record<string,unknown>[]):Set<string>{const out=new Set<string>();for(const read of reads)for(const piece of dense(read.context)?read.context:[])
  if(isPlainRecord(piece)&&typeof piece.role==='string'&&isPlainRecord(piece.range)&&Number.isSafeInteger(piece.range.offset))out.add(`${piece.role}:${piece.range.offset}`);return out;}
function continuations(reads:Record<string,unknown>[]):Array<{alias:string;offset:number;role:string}>{const out:Array<{alias:string;offset:number;role:string}>=[];for(const read of reads)for(const piece of dense(read.context)?read.context:[]){if(!isPlainRecord(piece))continue;for(const field of ['previous','next']){const n=piece[field];if(isPlainRecord(n)&&typeof n.alias==='string'&&Number.isSafeInteger(n.offset)&&['player','keeper'].includes(String(n.role)))out.push({alias:n.alias,offset:Number(n.offset),role:String(n.role)});}}return out;}
function comparisonRow(row:Row):Json{const points=Array.from(row.text),text=points.slice(0,400).join(''),links=row.links.slice(0,16);return{alias:row.alias,origin:row.origin,kind:row.kind,subject:row.subject,text,text_truncated:points.length>400,turn:row.turn,line:row.line,loop:row.loop,status:row.status,state:row.state,authority:row.authority,attribution:row.attribution,derived:row.derived,links,links_omitted_count:row.links.length-links.length};}
function boundedContext(context:Json):{value:Json;complete:boolean}{const value=semantic(context),bytes=Buffer.byteLength(JSON.stringify(value),'utf8');return bytes<=MAX_CONTEXT_BYTES?{value,complete:true}:{value:{coverage:'omitted_for_bounded_decision',original_bytes:bytes},complete:false};}
function boundedComparison(rows:Row[]):{value:Json;complete:boolean}{const included:Json[]=[];let omitted=0,truncated=0;for(const row of rows){const candidate=comparisonRow(row),next={rows:[...included,candidate],omitted_count:0};if(Buffer.byteLength(JSON.stringify(next),'utf8')>MAX_COMPARISON_BYTES){omitted++;continue;}included.push(candidate);if(isPlainRecord(candidate)&&(candidate.text_truncated===true||Number(candidate.links_omitted_count)>0))truncated++;}const complete=omitted===0&&truncated===0;return{value:{rows:included,omitted_count:omitted,truncated_count:truncated,complete},complete};}
function compactOriginals(reads:Record<string,unknown>[]):{value:Json;complete:boolean}{
  const latest=reads.at(-1)??{},baseValue=semantic(Object.fromEntries(Object.entries(latest).filter(([key])=>key!=='context'))),
    base=(baseValue!==null&&!Array.isArray(baseValue)&&typeof baseValue==='object'?baseValue:{}) as Record<string,Json>,pieces:Json[]=[],seen=new Set<string>();let omitted=0,truncated=0,declaredOmitted=0;
  for(const read of reads)for(const raw of dense(read.context)?read.context:[]){const piece=semantic(raw),key=JSON.stringify(piece);if(seen.has(key))continue;seen.add(key);
    let candidate=piece;if(isPlainRecord(candidate)&&(candidate.omitted_context===true||Number.isSafeInteger(candidate.omitted_context_count)))declaredOmitted+=Number.isSafeInteger(candidate.omitted_context_count)?Number(candidate.omitted_context_count):1;
    if(isPlainRecord(candidate)&&typeof candidate.text==='string'&&Buffer.byteLength(JSON.stringify(candidate),'utf8')>MAX_ORIGINAL_BYTES/2){const points=Array.from(candidate.text);candidate={...candidate,text:points.slice(0,2_000).join(''),text_truncated:true};truncated++;}
    const next={...base,context:[...pieces,candidate],context_coverage:{included:pieces.length+1,omitted,truncated}};
    if(Buffer.byteLength(JSON.stringify(next),'utf8')>MAX_ORIGINAL_BYTES){omitted++;continue;}pieces.push(candidate);
  }
  const inheritedOmitted=Math.max(declaredOmitted,...reads.map(read=>Number.isSafeInteger(read.omitted_context_count)?Number(read.omitted_context_count):0));
  return{value:{...base,context:pieces,context_coverage:{included:pieces.length,omitted:omitted+inheritedOmitted,truncated,complete:omitted+inheritedOmitted===0&&truncated===0}},complete:omitted+inheritedOmitted===0&&truncated===0};
}
interface AssessmentItem {row:Row;rel:Relevance;needs:Json;evidence:Json;evidenceComplete:boolean}
interface AssessmentCoverage {contextComplete:boolean;comparisonComplete:boolean}
function assessmentBatch(view:TaskView,items:AssessmentItem[],context:Json,comparison:Row[]):Omit<DecisionBatch,'id'|'scope'|'readSet'>{const questions:DecisionBatch['questions']=[];
  for(const item of items){questions.push({key:`support:${item.row.alias}`,target:item.row.alias,type:'choice',instructions:'Judge support from the canonical original and supplied current context. Conversation evidence is not module truth.',criteria:{supported:'The original supports using this occurrence for the query.',unsupported:'The original does not support this use.',unknown:'Support remains unresolved.'}},
    {key:`applicability:${item.row.alias}`,target:item.row.alias,type:'choice',instructions:'Judge whether this evidence applies now, is historical, is superseded, or remains unknown.',criteria:{current:'Applicable to the current question and state.',historical:'Historically relevant but not current.',superseded:'Explicitly superseded.',unknown:'Current applicability is unresolved.'}},
    {key:`contradiction:${item.row.alias}`,target:item.row.alias,type:'choice',instructions:'Judge conflict against returned originals, the comparison index, and current receipts without inventing module truth. A truncated comparison statement that matters requires unknown.',criteria:{none:'No supported conflict is visible.',conflict:'Returned evidence or receipts conflict with it.',unknown:'Contradiction remains unresolved or required comparison text is truncated.'}});}
  const current=boundedContext(context),index=boundedComparison(comparison);return{model:JEV_MODEL,family:FAMILY,familyVersion:VERSION,state:{query:view.plan.goal,currentContext:current.value,
    comparisonIndex:index.value,coverage:{current_context_complete:current.complete,comparison_complete:index.complete},
    evidence:items.map(i=>({alias:i.row.alias,relevance:i.rel,needs:i.needs,candidate:comparisonRow(i.row),original:i.evidence,evidence_complete:i.evidenceComplete}))},questions};}

export function createMemoryReadDomain():TaskDomain{return{id:'memory-read',version:VERSION,completion:'artifact',capabilities:[MEMORY_READ_CAPABILITY],next(view){
  if(view.observations.some(o=>o.proposal.operation==='memory.snapshot'&&o.packet.status!=='succeeded'))return done('partial',['The memory evidence snapshot is unavailable.']);
  const snaps=view.observations.filter(o=>o.proposal.operation==='memory.snapshot'&&o.packet.status==='succeeded').map(o=>snapshot(o.packet.result)).filter(Boolean) as Snapshot[];
  if(!snaps.length)return op('memory.snapshot','memory-snapshot:0',{});
  const s=snaps.at(-1)!;const skey=hash(s.snapshot);const paged=pageRows(view,s);if(!paged.valid)return done('partial',['The memory evidence page is invalid or unavailable.']);
  if(paged.next!==null)return op('memory.page',`memory-page:${skey}:${paged.next}`,{snapshot:s.snapshot,offset:paged.next});
  const needs=queryNeeds(view),classified=coverage(view,paged.rows,skey,needs),pendingBatches:Array<{key:string;batch:Omit<DecisionBatch,'id'|'scope'|'readSet'>}>=[];for(let needIndex=0;needIndex<needs.length;needIndex++){const pending=paged.rows.filter(row=>!classified.get(needIndex)!.has(row.alias));if(!pending.length)continue;const packed=groups(view,pending,rows=>coverageBatch(view,needs[needIndex],needIndex,rows));if(!packed)return done('partial',['Memory subquestion coverage input exceeds the bounded decision size.']);for(const rows of packed)pendingBatches.push({key:`memory-coverage:${skey}:${needIndex}:${hash(rows.map(row=>row.alias))}`,batch:coverageBatch(view,needs[needIndex],needIndex,rows)});}
  if(pendingBatches.length)return{kind:'decisions',batches:pendingBatches.slice(0,16)};
  // Round-robin across query subquestions before both the alias and owner byte caps.
  const rankedCoverage=roundRobin(paged.rows,classified,needs.length),ranked=rankedCoverage.ranked,rel=rankedCoverage.relevance;
  if(!s.raw_all&&!ranked.length&&snaps.length<=MAX_REFRESHES)return op('memory.snapshot',`memory-snapshot:${snaps.length}`,{raw_all:true});
  const readPool=ranked.slice(0,MAX_SELECTED),overflow=ranked.slice(MAX_SELECTED),reads=originals(view,s);for(const row of readPool){const list=reads.get(row.alias)??[];if(!list.length)return op('memory.original',`memory-original:${skey}:${row.alias}:0`,{snapshot:s.snapshot,alias:row.alias});const covered=readRanges(list),next=continuations(list).find(n=>!covered.has(`${n.role}:${n.offset}`)&&!view.observations.some(o=>o.key===`memory-original:${skey}:${row.alias}:${n.role}:${n.offset}`));if(next)return op('memory.original',`memory-original:${skey}:${row.alias}:${next.role}:${next.offset}`,{snapshot:s.snapshot,alias:row.alias,offset:next.offset,role:next.role});}
  const candidates=readPool.filter(r=>(reads.get(r.alias)??[]).some(v=>v.verified===true)),selected=candidates;
  const prepared=new Map(selected.map(row=>{const compact=compactOriginals(reads.get(row.alias)!);return[row.alias,{row,rel:rel.get(row.alias) as Relevance,needs:needs.flatMap((need,index)=>classified.get(index)!.get(row.alias)!=='irrelevant'?[{need,priority:classified.get(index)!.get(row.alias)!}]:[]),evidence:compact.value,evidenceComplete:compact.complete} satisfies AssessmentItem] as const;}));
  const sharedCoverage:AssessmentCoverage={contextComplete:boundedContext(s.context).complete,comparisonComplete:boundedComparison(selected).complete};
  const forcedUnknown=new Set([...prepared].filter(([,item])=>fullBytes(view,assessmentBatch(view,[item],s.context,selected))>MAX_BATCH_BYTES).map(([alias])=>alias));
  const assessed=new Set(view.decisions.filter(d=>d.key.startsWith(`memory-assess:${skey}:`)).flatMap(d=>d.batch.questions.map(q=>q.key.replace(/^(support|applicability|contradiction):/,''))));
  const pendingAssess=selected.filter(r=>!assessed.has(r.alias)&&!forcedUnknown.has(r.alias));if(pendingAssess.length){const items=pendingAssess.map(row=>prepared.get(row.alias)!);const packed=groups(view,items,x=>assessmentBatch(view,x,s.context,selected));if(!packed){for(const item of items)forcedUnknown.add(item.row.alias);}else return{kind:'decisions',batches:packed.slice(0,16).map(x=>({key:`memory-assess:${skey}:${hash(x.map(i=>i.row.alias))}`,batch:assessmentBatch(view,x,s.context,selected)}))};}
  const assessments=selected.map(row=>{const item=prepared.get(row.alias)!,forced=forcedUnknown.has(row.alias);const get=(kind:string,allowed:string[])=>{const v=choice(view,[...view.decisions].find(d=>d.key.startsWith(`memory-assess:${skey}:`)&&d.batch.questions.some(q=>q.key===`${kind}:${row.alias}`))?.key??'',`${kind}:${row.alias}`);return allowed.includes(v??'')?v:'unknown';};return{alias:row.alias,relevance:rel.get(row.alias),
    support:forced||!item.evidenceComplete?'unknown':get('support',['supported','unsupported','unknown']),
    applicability:forced||!item.evidenceComplete||!sharedCoverage.contextComplete?'unknown':get('applicability',['current','historical','superseded','unknown']),
    contradiction:forced||!item.evidenceComplete||!sharedCoverage.contextComplete||!sharedCoverage.comparisonComplete?'unknown':get('contradiction',['none','conflict','unknown'])};});
  const supportedNeeds=new Set<number>();for(const assessment of assessments)if(assessment.support==='supported')for(let needIndex=0;needIndex<needs.length;needIndex++)if(['essential','useful'].includes(classified.get(needIndex)!.get(assessment.alias)!))supportedNeeds.add(needIndex);
  if(!s.raw_all&&supportedNeeds.size<needs.length&&snaps.length<=MAX_REFRESHES)return op('memory.snapshot',`memory-snapshot:${snaps.length}`,{raw_all:true});
  const considered=paged.rows.map(row=>row.alias),unknown=[...new Set([...rankedCoverage.unknown,...readPool.filter(r=>!(reads.get(r.alias)??[]).some(v=>v.verified===true)).map(r=>r.alias),...overflow.map(r=>r.alias),...assessments.filter(a=>a.support==='unknown'||a.applicability==='unknown'||a.contradiction==='unknown').map(a=>a.alias)])];
  const finishKey=`memory-finish:${skey}`;const finished=observation(view,finishKey);if(!finished)return op('memory.finish',finishKey,{snapshot:s.snapshot,selected:selected.map(r=>r.alias),assessments:assessments as unknown as Json,considered,unknown});
  if(finished.status!=='succeeded'||!isPlainRecord(finished.result))return done('partial',['The memory evidence owner could not finish the query.']);
  if(finished.result.status==='refresh'){if(snaps.length<=MAX_REFRESHES)return op('memory.snapshot',`memory-snapshot:${snaps.length}`,{raw_all:s.raw_all});return done('partial',['Memory evidence changed after the bounded refresh allowance.']);}
  return done(finished.result.status==='ready'?'complete':'partial',finished.result.status==='ready'?[]:['Memory evidence coverage is partial.']);
}};}
