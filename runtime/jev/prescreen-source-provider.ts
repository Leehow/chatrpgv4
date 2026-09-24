/** #108 host-only original-source candidates for the optional Keeper prescreen. */
import {createHash} from 'node:crypto';
import {nativeSourceCatalog,type NativeTextBundle,type NativeSourceCatalog} from './native-source-catalog.ts';
import {issueSourceRef} from './source-ref.ts';
import {nativeConsultationCoverageBatch,nativeConsultationInitialBatches,nativeSourceParts,
  validateNativeConsultationSelection,type NativeSourcePart,type SourceBinding} from './native-source-domain.ts';
import {materializeNativeConsultation} from './source-owner-operations.ts';
import {isPlainRecord,type DecisionBatch,type DecisionResult,type Json,type ReadSet,type ScopeBinding,type SourceRef} from './contracts.ts';

type Row=Record<string,any>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value:unknown):string=>typeof value==='string'?value:'';
const clip=(value:string,limit=512)=>Array.from(value).slice(0,limit).join('');
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=(value:unknown,fallback:number,max:number)=>Number.isSafeInteger(value)&&Number(value)>0?Math.min(Number(value),max):fallback;

export interface PrescreenSourceCandidate {
  key:string;
  kind:string;
  label:string;
  summary:string;
  authority:'reviewed_source'|'native_text'|'native_consultation';
  coverage:Record<string,Json>;
  body?:string;
  data?:Record<string,Json>;
  read?:Record<string,Json>;
  /** Host-only exact bindings. The Keeper projection must strip these. */
  refs?:SourceRef[];
}
export interface PrescreenSourceBudget {
  deadlineAt:number;
  candidateBytes:number;
  /** Reserved for the consumer's selected bodies; discovery must not aggregate it across unselected candidates. */
  materialBytes:number;
  maxNativePages?:number;
}
export interface PrescreenSourceSnapshot {
  version:1;
  module_id:string;
  generation:number;
  revision:string;
  pdf:string;
  file_sha256:string;
  page_count:number;
  answers_revision:string;
  checked_answers:Row[];
  checked_answers_omitted:number;
  checked_answers_invalid:number;
  next:number|null;
  /** §14.16.4: a starter's bound document is a window of a book its authored graph cites in the book's coordinates. */
  window?:{source_id:string;file_sha256:string;pages:[number,number]};
}
export interface PrescreenSourceRuntime {
  home:string;
  sourceInfo(source:{pdf:string;cache:string},signal?:AbortSignal):Promise<{file_sha256:string;page_count:number}>;
  sourceSearch?(source:{pdf:string;query:string;first_page?:number;last_page?:number;limit?:number;cursor?:string},signal?:AbortSignal):Promise<Row>;
  sourceText(source:{pdf:string;pages:number[];expected_file_sha256:string},signal?:AbortSignal):Promise<NativeTextBundle>;
}
export interface PrescreenSourceCheckpoint {
  version:1;
  campaign:string;
  module_id:string;
  revision:string;
  answers_revision:string;
  pdf:string;
  file_sha256:string;
  page_count:number;
  extraction?:{version:string;page:number};
  readSet:ReadSet;
}
export interface PrescreenSourceResult {
  candidates:PrescreenSourceCandidate[];
  coverage:{
    checked_answers:{inspected:number;emitted:number;omitted:number;invalid:number};
    native:{searched_ranges:number[][];unsearched_ranges:number[][];materialized_pages:number[];unmaterialized_pages:number[];
      empty_pages:number[];error_pages:number[];candidate_omitted:number;
      /** Provider-stage omissions only. Final delivery omissions belong to the consumer after selection. */
      material_omitted:number;search_error?:string;extraction_error?:string;next?:{cursor:string}};
  };
  readSet:ReadSet;
  /** Host-only serializable freshness binding for prepared-packet reuse. */
  checkpoint:PrescreenSourceCheckpoint;
  /** Additional raw evidence only; never extends an earlier consultation qualification. */
  readNativePages?:(pages:readonly number[],signal:AbortSignal)=>Promise<PrescreenSourceCandidate[]>;
  check(signal?:AbortSignal,validationDeadlineAt?:number):Promise<{status:'current';readSet:ReadSet}|{status:'stale'|'unavailable';reason:string}>;
  nativeQualificationActions(selectedKeys:readonly string[]):number|undefined;
  qualifyNative(selectedKeys:readonly string[],decide:(request:{key:string;batch:Omit<DecisionBatch,'id'|'scope'|'readSet'>},signal:AbortSignal)=>Promise<DecisionResult>,
    signal?:AbortSignal):Promise<PrescreenNativeQualification>;
}
export type PrescreenNativeQualification={status:'qualified';candidate:PrescreenSourceCandidate;selectedKeys:string[];calls:number}
  |{status:'partial'|'unavailable';reason:string;selectedKeys:string[];calls:number;gap:{reason:string;coverage:Record<string,Json>;read?:Record<string,Json>}};
export interface PrescreenSourceInput {
  call(method:string,params:Row):Promise<Row>;
  campaign:string;
  moduleId:string;
  scope:ScopeBinding;
  query:string;
  capsule:Row;
  source:PrescreenSourceRuntime;
  signal:AbortSignal;
  budget:PrescreenSourceBudget;
  snapshot:PrescreenSourceSnapshot;
}

function checkedSnapshot(value:unknown,campaign:string,moduleId:string):PrescreenSourceSnapshot {
  if(!isPlainRecord(value)||value.version!==1||value.module_id!==moduleId||!campaign||!Number.isSafeInteger(value.generation)
    ||!sha(value.revision)||typeof value.pdf!=='string'||!value.pdf||!sha(value.file_sha256)||!Number.isSafeInteger(value.page_count)||Number(value.page_count)<1
    ||!sha(value.answers_revision)||!Array.isArray(value.checked_answers)||!Number.isSafeInteger(value.checked_answers_omitted)||Number(value.checked_answers_omitted)<0
    ||!Number.isSafeInteger(value.checked_answers_invalid)||Number(value.checked_answers_invalid)<0
    ||(value.next!==null&&(!Number.isSafeInteger(value.next)||Number(value.next)<0)))throw new Error('invalid_source_material_snapshot');
  return value as unknown as PrescreenSourceSnapshot;
}
function rangeSet(values:Set<number>,maximum:number):number[][] {
  const ranges:number[][]=[];let start:number|undefined,prior:number|undefined;
  for(let page=1;page<=maximum;page++)if(values.has(page)){if(start===undefined)start=page;prior=page;}
  else if(start!==undefined){ranges.push([start,prior!]);start=prior=undefined;}
  if(start!==undefined)ranges.push([start,prior!]);return ranges;
}
function complement(values:Set<number>,maximum:number):number[][] {
  const absent=new Set<number>();for(let page=1;page<=maximum;page++)if(!values.has(page))absent.add(page);return rangeSet(absent,maximum);
}
function spreadPages(count:number,limit:number):number[] {
  if(limit>=count)return Array.from({length:count},(_,i)=>i+1);
  if(limit<=1)return [1];
  return [...new Set(Array.from({length:limit},(_,i)=>Math.round(1+i*(count-1)/(limit-1))))];
}
function samplePages(values:number[],limit:number):number[] {
  const rows=[...new Set(values)].sort((a,b)=>a-b);
  if(limit>=rows.length)return rows;if(limit<=0)return[];if(limit===1)return[rows.at(-1)!];
  return [...new Set(Array.from({length:limit},(_,i)=>rows[Math.round(i*(rows.length-1)/(limit-1))]))];
}
function citedPages(value:unknown,moduleId:string,pageCount:number,window?:PrescreenSourceSnapshot['window'],out=new Set<number>()):Set<number> {
  if(Array.isArray(value)){for(const child of value)citedPages(child,moduleId,pageCount,window,out);return out;}
  if(!isPlainRecord(value))return out;
  if(Number.isSafeInteger(value.pdf_index)){
    // A reference in the bound document's own coordinates, or an authored one in the book's coordinates of its window.
    const page=value.source_id===`pdf:${moduleId}`?Number(value.pdf_index)+1
      :window&&value.source_id===window.source_id?Number(value.pdf_index)-window.pages[0]+1:0;
    if(page>=1&&page<=pageCount)out.add(page);
  }
  for(const child of Object.values(value))citedPages(child,moduleId,pageCount,window,out);return out;
}
function read(focus:string,question:string):Record<string,Json> {
  return {tool:'lookup',kind:'source',query:focus||question,question,source_mode:'answer'};
}
function answerCandidate(row:Row,snapshot:PrescreenSourceSnapshot,scope:ScopeBinding,query:string):PrescreenSourceCandidate|undefined {
  const evidence=isPlainRecord(row.evidence)?row.evidence:{};
  if(typeof row.key!=='string'||typeof row.focus!=='string'||typeof row.question!=='string'||typeof row.answer!=='string'||!row.answer
    ||typeof evidence.resource!=='string'||!sha(evidence.revision)||!sha(evidence.accepted_revision)||!isPlainRecord(evidence.record))return undefined;
  const record=evidence.record as Record<string,Json>;
  if(typeof record.answer!=='string'||record.answer!==row.answer)return undefined;
  const ref=issueSourceRef({scope:structuredClone(scope),resource:evidence.resource,revision:evidence.revision,sourceType:'record',record,
    allowedFields:[['answer']]},{kind:'field',path:['answer']});
  const supported=row.supported===true,status=supported?'complete':'partial',limitations=text(row.limitations);
  return {key:digest(['checked-answer',snapshot.answers_revision,row.key,evidence.revision]),kind:'source',
    label:`Checked source answer: ${row.focus}`,summary:clip(`${row.question}\n${row.answer}`),authority:'reviewed_source',body:row.answer,refs:[ref],
    coverage:{status,supported,derived:true,omitted:supported?[]:['supported_answer'],limitations:limitations?[limitations]:[]},
    data:{question:row.question,focus:row.focus,status:text(row.status),supported,prepared:false,
      source_refs:Array.isArray(row.source_refs)?row.source_refs as Json:[],limitations},read:read(row.focus,query)};
}
function nativeCandidate(unit:{alias:string;page:number;pdfLabel:string|null;text:string;ref:SourceRef},query:string,snapshot:PrescreenSourceSnapshot):PrescreenSourceCandidate {
  const label=unit.pdfLabel?`Original PDF page ${unit.page} (${unit.pdfLabel})`:`Original PDF page ${unit.page}`;
  return {key:digest(['native',unit.ref.resource,unit.ref.revision,unit.ref.selector]),kind:'source',label,summary:clip(unit.text),
    authority:'native_text',body:unit.text,refs:[unit.ref],coverage:{status:'partial',supported:false,derived:false,
      omitted:['visual_verification','consultation_coverage'],limitations:['Exact native text only; not visual proof, a supported consultation, or playable readiness.']},
    data:{page:unit.page,pdf_label:unit.pdfLabel,source_refs:[{source_id:`pdf:${snapshot.module_id}`,pdf_index:unit.page-1}],prepared:false,supported:false},
    read:read('Authored source consultation',query)};
}
function fit(candidates:PrescreenSourceCandidate[],candidate:PrescreenSourceCandidate,budget:PrescreenSourceBudget,usage:{candidate:number}):'ok'|'candidate' {
  const candidateBytes=Buffer.byteLength(JSON.stringify(candidate),'utf8');
  if(usage.candidate+candidateBytes>budget.candidateBytes)return'candidate';
  usage.candidate+=candidateBytes;candidates.push(candidate);return'ok';
}
function decisionChoice(result:DecisionResult,key:string):string|undefined {
  const answer=result.answers[key];return result.status==='complete'&&answer?.status==='answered'&&answer.type==='choice'?answer.choice:undefined;
}

export async function checkPrescreenSourceCheckpoint(input:{
  call(method:string,params:Row):Promise<Row>;
  source:PrescreenSourceRuntime;
  scope:ScopeBinding;
  signal:AbortSignal;
  deadlineAt:number;
  checkpoint:PrescreenSourceCheckpoint;
}):Promise<{status:'current';readSet:ReadSet}|{status:'stale'|'unavailable';reason:string}> {
  try{
    input.signal.throwIfAborted();
    const checkpoint=structuredClone(input.checkpoint),remaining=input.deadlineAt-Date.now();
    if(checkpoint.version!==1||!checkpoint.campaign||!checkpoint.module_id||!sha(checkpoint.revision)||!sha(checkpoint.answers_revision)
      ||!checkpoint.pdf||!sha(checkpoint.file_sha256)||!Number.isSafeInteger(checkpoint.page_count)||checkpoint.page_count<1
      ||!Array.isArray(checkpoint.readSet)||checkpoint.extraction!==undefined
        &&(typeof checkpoint.extraction.version!=='string'||!checkpoint.extraction.version||!Number.isSafeInteger(checkpoint.extraction.page)
          ||checkpoint.extraction.page<1||checkpoint.extraction.page>checkpoint.page_count))return{status:'unavailable',reason:'invalid_source_checkpoint'};
    if(!Number.isFinite(remaining)||remaining<=0)return{status:'stale',reason:'source_material_deadline'};
    const signal=AbortSignal.any([input.signal,AbortSignal.timeout(Math.max(1,remaining))]);
    const [current,info]=await Promise.all([
      input.call('module.source.materials.snapshot',{campaign:checkpoint.campaign,module_id:checkpoint.module_id,answer_limit:1,answer_cursor:0}),
      input.source.sourceInfo({pdf:checkpoint.pdf,cache:input.source.home},signal),
    ]),bound=checkedSnapshot(current,checkpoint.campaign,checkpoint.module_id);
    if(bound.revision!==checkpoint.revision||bound.answers_revision!==checkpoint.answers_revision
      ||info.file_sha256!==checkpoint.file_sha256||info.page_count!==checkpoint.page_count)return{status:'stale',reason:'source_material_changed'};
    if(checkpoint.extraction){
      const bundle=await input.source.sourceText({pdf:checkpoint.pdf,pages:[checkpoint.extraction.page],
        expected_file_sha256:checkpoint.file_sha256},signal);
      if(bundle.page_count!==checkpoint.page_count)return{status:'stale',reason:'source_material_changed'};
      const catalog=nativeSourceCatalog(input.scope,bundle,checkpoint.file_sha256);
      if(catalog.extractionVersion!==checkpoint.extraction.version)return{status:'stale',reason:'source_extraction_changed'};
      if(!catalog.coverage.textPages.includes(checkpoint.extraction.page)&&!catalog.coverage.emptyPages.includes(checkpoint.extraction.page))
        return{status:'unavailable',reason:'source_extraction_unavailable'};
    }
    return{status:'current',readSet:checkpoint.readSet};
  }catch(error){return{status:input.signal.aborted?'stale':'unavailable',reason:input.signal.aborted?'cancelled':error instanceof Error?error.message:'source_material_check_failed'};}
}

export async function preparePrescreenSources(input:PrescreenSourceInput):Promise<PrescreenSourceResult> {
  input.signal.throwIfAborted();
  const budget=structuredClone(input.budget),capsule=structuredClone(input.capsule),snapshot=checkedSnapshot(structuredClone(input.snapshot),input.campaign,input.moduleId);
  if(!Number.isFinite(budget.deadlineAt)||!Number.isSafeInteger(budget.candidateBytes)||budget.candidateBytes<1
    ||!Number.isSafeInteger(budget.materialBytes)||budget.materialBytes<1)throw new Error('invalid_source_material_budget');
  const deadlineAt=budget.deadlineAt,remaining=deadlineAt-Date.now();
  if(!Number.isFinite(remaining)||remaining<=0)throw new Error('source_material_budget_expired');
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(Math.max(1,remaining))]);
  const actual=await input.source.sourceInfo({pdf:snapshot.pdf,cache:input.source.home},signal);
  if(actual.file_sha256!==snapshot.file_sha256||actual.page_count!==snapshot.page_count)throw new Error('source_material_stale');
  const candidates:PrescreenSourceCandidate[]=[],usage={candidate:0};let checkedOmitted=Number(snapshot.checked_answers_omitted),candidateOmitted=0;
  for(const row of snapshot.checked_answers){const candidate=answerCandidate(row,snapshot,input.scope,input.query);if(!candidate){checkedOmitted++;continue;}
    if(fit(candidates,candidate,budget,usage)!=='ok')checkedOmitted++;}
  const searched=new Set<number>(),matches:number[]=[];let next:string|undefined,searchError:string|undefined;
  const literal=Array.from(input.query.trim()).slice(0,256).join('');
  if(input.source.sourceSearch&&literal)try{
    const result=await input.source.sourceSearch({pdf:snapshot.pdf,query:literal,first_page:1,last_page:snapshot.page_count,limit:20},signal);
    const scope=isPlainRecord(result.scope)?result.scope:{};
    if(Number.isSafeInteger(scope.searched_first_page)&&Number.isSafeInteger(scope.searched_last_page))
      for(let page=Number(scope.searched_first_page);page<=Number(scope.searched_last_page);page++)searched.add(page);
    for(const row of Array.isArray(result.matches)?result.matches:[])if(Number.isSafeInteger(row.page)&&row.page>=1&&row.page<=snapshot.page_count)matches.push(row.page);
    if(result.truncated===true&&typeof result.next_cursor==='string')next=result.next_cursor;
  }catch(error){if(signal.aborted)throw error;searchError=error instanceof Error?error.message.slice(0,160):'source_search_unavailable';}
  const maxPages=positive(budget.maxNativePages,16,32),broad=spreadPages(snapshot.page_count,maxPages);
  const cited=[...citedPages(capsule,input.moduleId,snapshot.page_count,snapshot.window)],reserved:number[]=[];
  const reserve=(values:number[],preferLast=false)=>{const ordered=preferLast?[...values].reverse():values;const page=ordered.find(value=>!cited.includes(value)&&!reserved.includes(value));if(page!==undefined)reserved.push(page);};
  if(maxPages>=2)reserve(matches);if(maxPages>=2)reserve(broad,true);
  while(reserved.length>=maxPages)reserved.shift();
  const pages=[...samplePages(cited,maxPages-reserved.length),...reserved];
  for(const page of [...matches,...broad,...cited])if(pages.length<maxPages&&!pages.includes(page))pages.push(page);
  let extractionVersion:string|undefined,recheckPage:number|undefined,emptyPages:number[]=[],errorPages:number[]=[],extractionError:string|undefined,
    nativeCatalog:NativeSourceCatalog|undefined,nativeOwnerParts:NativeSourcePart[]=[];
  const materialized=new Set<number>(),candidatePartAliases=new Map<string,string>();
  if(pages.length){
    try{
      const bundle=await input.source.sourceText({pdf:snapshot.pdf,pages,expected_file_sha256:snapshot.file_sha256},signal);
      const catalog=nativeSourceCatalog(input.scope,bundle,snapshot.file_sha256);nativeCatalog=catalog;nativeOwnerParts=nativeSourceParts(catalog);
      recheckPage=catalog.coverage.textPages[0]??catalog.coverage.emptyPages[0];
      extractionVersion=recheckPage===undefined?undefined:catalog.extractionVersion;
      emptyPages=[...catalog.coverage.emptyPages];errorPages=[...catalog.coverage.errorPages];
      for(const page of catalog.coverage.textPages)materialized.add(page);
      const byPage=new Map<number,typeof catalog.units>();
      for(const page of pages)byPage.set(page,catalog.units.filter(unit=>unit.page===page));
      for(let ordinal=0;;ordinal++){
        let found=false;
        for(const page of pages){const unit=byPage.get(page)?.[ordinal];if(!unit)continue;found=true;
          const candidate=nativeCandidate(unit,input.query,snapshot),outcome=fit(candidates,candidate,budget,usage);
          if(outcome==='ok'){const range=unit.ref.selector,part=nativeOwnerParts.find(value=>value.ref.resource===unit.ref.resource&&range.kind==='utf16'
              &&value.ref.selector.kind==='utf16'&&value.ref.selector.start<=range.start&&value.ref.selector.end>=range.end);
            if(part)candidatePartAliases.set(candidate.key,part.alias);}
          if(outcome==='candidate')candidateOmitted++;}
        if(!found)break;
      }
    }catch(error){if(signal.aborted)throw error;extractionError=error instanceof Error?error.message.slice(0,160):'source_text_unavailable';}
  }
  const readSet:ReadSet=[
    {kind:'source',resource:`module-source:${input.campaign}:${input.moduleId}`,revision:snapshot.revision},
    {kind:'source',resource:`source-answers:${input.campaign}:${input.moduleId}`,revision:snapshot.answers_revision},
    {kind:'source',resource:`pdf:${snapshot.file_sha256}`,revision:snapshot.file_sha256},
    ...(extractionVersion?[{kind:'extraction' as const,resource:`pdf:${snapshot.file_sha256}:native`,revision:extractionVersion}]:[]),
    {kind:'family',resource:'prescreen-source-materials',revision:'1'},
  ];
  const checkpoint:PrescreenSourceCheckpoint={version:1,campaign:input.campaign,module_id:input.moduleId,revision:snapshot.revision,
    answers_revision:snapshot.answers_revision,pdf:snapshot.pdf,file_sha256:snapshot.file_sha256,page_count:snapshot.page_count,
    ...(extractionVersion!==undefined&&recheckPage!==undefined?{extraction:{version:extractionVersion,page:recheckPage}}:{}),readSet};
  const check=(checkSignal:AbortSignal=input.signal,validationDeadlineAt:number=deadlineAt)=>checkPrescreenSourceCheckpoint({call:input.call,source:input.source,scope:input.scope,
    signal:checkSignal,deadlineAt:validationDeadlineAt,checkpoint});
  const nativeQualificationActions=(selectedKeys:readonly string[]):number|undefined=>{
    const keys=[...new Set(selectedKeys)];if(!nativeCatalog||!nativeOwnerParts.length||!keys.length||keys.some(key=>!candidatePartAliases.has(key)))return undefined;
    return nativeConsultationInitialBatches(input.query,[input.query],[],nativeOwnerParts).length+1;
  };
  const qualifyNative=async(selectedKeys:readonly string[],decide:(request:{key:string;batch:Omit<DecisionBatch,'id'|'scope'|'readSet'>},signal:AbortSignal)=>Promise<DecisionResult>,
    caller:AbortSignal=input.signal):Promise<PrescreenNativeQualification>=>{
    const keys=[...new Set(selectedKeys)],selectedAliases=keys.map(key=>candidatePartAliases.get(key));let calls=0;
    const gap=(status:'partial'|'unavailable',reason:string):PrescreenNativeQualification=>({status,reason,selectedKeys:keys,calls,
      gap:{reason,coverage:{status:'partial',supported:false,derived:false,omitted:['consultation_coverage'],limitations:[reason]},read:read('Authored source consultation',input.query)}});
    if(!nativeCatalog||!nativeOwnerParts.length||selectedAliases.some(alias=>!alias))return gap('partial','native_selection_unavailable');
    const remaining=deadlineAt-Date.now();if(remaining<=0)return gap('unavailable','source_material_deadline');
    const qualifiedSignal=AbortSignal.any([caller,AbortSignal.timeout(Math.max(1,remaining))]),policy={question:input.query,requirements:[input.query] as Json[],constraints:[] as Json[],parts:nativeOwnerParts,coverage:nativeCatalog.coverage};
    try{
      const requests=nativeConsultationInitialBatches(input.query,[input.query],[],nativeOwnerParts);
      const results=await Promise.all(requests.map(async request=>{calls++;return[request.key,await decide(request,qualifiedSignal)] as const;}));
      const route=results.map(([,result])=>decisionChoice(result,'route')).find(Boolean),classifications:Record<string,string>={};
      for(const [,result] of results)for(const part of nativeOwnerParts){const choice=decisionChoice(result,part.alias);if(choice)classifications[part.alias]=choice;}
      let verdict=validateNativeConsultationSelection(policy,{route,classifications});
      if(verdict.status!=='qualified'&&['visual','preparation','uncertain','route_unavailable','no_evidence','selection_too_large'].includes(verdict.reason))
        return gap('partial',`native_${verdict.reason}`);
      const assessment=nativeConsultationCoverageBatch(policy,classifications);if(!assessment)return gap('partial','native_consultation_coverage');
      calls++;const assessed=await decide(assessment,qualifiedSignal);verdict=validateNativeConsultationSelection(policy,{route,classifications,coverage:decisionChoice(assessed,'coverage')});
      if(verdict.status!=='qualified')return gap('partial',`native_${verdict.reason}`);
      const binding:SourceBinding={module_id:input.moduleId,pdf:snapshot.pdf,file_sha256:snapshot.file_sha256,page_count:snapshot.page_count,revision:snapshot.revision};
      const materialized=await materializeNativeConsultation({port:{call:input.call,
        sourceInfo:(pdf,signal)=>input.source.sourceInfo({pdf,cache:input.source.home},signal),
        sourceText:(pdf,pages,expected,signal)=>input.source.sourceText({pdf,pages,expected_file_sha256:expected},signal)},moduleId:input.moduleId,
        campaign:input.campaign,scope:input.scope,question:input.query,binding,catalog:nativeCatalog,
        approval:{question:input.query,verdict,classifications,coverage:nativeCatalog.coverage},signal:qualifiedSignal});
      const excerpts=materialized.sourceAnswer.excerpts as Row[],pages=[...new Set(excerpts.map(row=>Number(row.page)).filter(Number.isSafeInteger))],
        body=excerpts.map(row=>`[Original PDF page ${Number(row.page)}]\n${String(row.text??'')}`).join('\n\n'),proof=materialized.proof;
      return{status:'qualified',selectedKeys:keys,calls,candidate:{key:digest(['native-consultation',input.query,keys,proof.refs]),kind:'source',
        label:`Supported native source consultation: ${clip(input.query,160)}`,summary:clip(body),authority:'native_consultation',body,refs:proof.refs,
        coverage:{status:'complete',supported:true,derived:false,used:proof.coverage.used,omitted:proof.coverage.omitted,unknown:proof.coverage.unknown,
          limitations:materialized.sourceAnswer.limitations as Json},data:{question:input.query,status:'answered',supported:true,prepared:false,
          ...(pages.length===1?{page:pages[0]}:{}),source_refs:materialized.sourceAnswer.source_refs as Json,excerpts:materialized.sourceAnswer.excerpts as Json}}};
    }catch(error){return gap('unavailable',caller.aborted?'cancelled':error instanceof Error?error.message:'native_qualification_unavailable');}
  };
  const result:PrescreenSourceResult={candidates,readSet,checkpoint,check,nativeQualificationActions,qualifyNative,coverage:{checked_answers:{inspected:snapshot.checked_answers.length,emitted:candidates.filter(row=>row.authority==='reviewed_source').length,
    omitted:checkedOmitted,invalid:snapshot.checked_answers_invalid},native:{searched_ranges:rangeSet(searched,snapshot.page_count),unsearched_ranges:complement(searched,snapshot.page_count),
      materialized_pages:[...materialized].sort((a,b)=>a-b),unmaterialized_pages:Array.from({length:snapshot.page_count},(_,i)=>i+1).filter(page=>!materialized.has(page)),
      empty_pages:emptyPages,error_pages:errorPages,candidate_omitted:candidateOmitted,material_omitted:0,
      ...(searchError?{search_error:searchError}:{}),...(extractionError?{extraction_error:extractionError}:{}),...(next?{next:{cursor:next}}:{})}}};
  if(extractionVersion)result.readNativePages=async(requested,caller)=>{
    const pages=[...new Set(requested)];
    if(!pages.length||pages.length>2||pages.some(page=>!Number.isSafeInteger(page)||page<1||page>snapshot.page_count
        ||!result.coverage.native.unmaterialized_pages.includes(page)))throw new Error('invalid_native_continuation');
    const active=AbortSignal.any([signal,caller]);active.throwIfAborted();
    const bundle=await input.source.sourceText({pdf:snapshot.pdf,pages,expected_file_sha256:snapshot.file_sha256},active);
    active.throwIfAborted();
    const catalog=nativeSourceCatalog(input.scope,bundle,snapshot.file_sha256);
    if(catalog.extractionVersion!==extractionVersion||catalog.pageCount!==snapshot.page_count)throw new Error('source_extraction_changed');
    const observed=[...catalog.coverage.textPages,...catalog.coverage.emptyPages,...catalog.coverage.errorPages];
    if(observed.length!==pages.length||observed.some(page=>!pages.includes(page)))throw new Error('invalid_native_continuation');
    const fetched:PrescreenSourceCandidate[]=[],used={candidate:0},allowance={...budget,candidateBytes:budget.materialBytes};
    for(const unit of catalog.units){if(!pages.includes(unit.page))throw new Error('invalid_native_continuation');
      if(fit(fetched,nativeCandidate(unit,input.query,snapshot),allowance,used)!=='ok')result.coverage.native.candidate_omitted++;}
    for(const page of catalog.coverage.textPages)materialized.add(page);
    result.coverage.native.materialized_pages=[...materialized].sort((a,b)=>a-b);
    result.coverage.native.unmaterialized_pages=result.coverage.native.unmaterialized_pages.filter(page=>!pages.includes(page));
    result.coverage.native.empty_pages=[...new Set([...result.coverage.native.empty_pages,...catalog.coverage.emptyPages])];
    result.coverage.native.error_pages=[...new Set([...result.coverage.native.error_pages,...catalog.coverage.errorPages])];
    candidates.push(...fetched);return fetched;
  };
  return result;
}
