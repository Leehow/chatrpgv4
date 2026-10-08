/** #108 host-only original-source candidates for the optional Keeper prescreen. */
import {createHash} from 'node:crypto';
import {layeredBundles,layeredSourceCatalog,nativeSourceCatalog,sourceLayerOf,type LayeredPageText,type NativeTextBundle,
  type NativeSourceCatalog,type NativeSourceUnit,type SourceCatalogLayer} from './native-source-catalog.ts';
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
  /** Absent on a native-text candidate (§196.7): its body is its content, and nothing reads a clipped copy. */
  summary?:string;
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
  /** §196.7: the content root whose seeds the transcript store reads first (the host runtime's `contentRoot`). */
  contentRoot?:string;
  sourceInfo(source:{pdf:string;cache:string},signal?:AbortSignal):Promise<{file_sha256:string;page_count:number}>;
  sourceSearch?(source:{pdf:string;query:string;first_page?:number;last_page?:number;limit?:number;cursor?:string},signal?:AbortSignal):Promise<Row>;
  sourceText(source:{pdf:string;pages:number[];expected_file_sha256:string},signal?:AbortSignal):Promise<NativeTextBundle>;
  /** §191.7: pages in the layer asked for; absent, every page is native. §196: `paragraphs` asks transcript rows for their paragraphs. */
  sourcePageText?(source:{pdf:string;pages:number[];expected_file_sha256:string;layer?:'preferred'|'native';paragraphs?:boolean},signal?:AbortSignal):Promise<LayeredPageText>;
  /** §191.6: pages a consultation wanted now and read natively, for the front of the transcript queue (never awaited). */
  wantTranscripts?(request:{pdf:string;file_sha256:string;pages:number[]}):void;
}
/**
 * §195.1: one candidate's read set, by digest. A checked answer is its accepted record (the reading store's cache key and
 * draft digest); a native excerpt or a qualified consultation is the pages it quotes, each in the layer it was read in with
 * that page's text revision.
 */
export interface PrescreenSourceUse {
  key:string;
  answer?:{key:string;revision:string;focus:string;question:string};
  pages?:Array<{page:number;layer:SourceCatalogLayer;version:string;revision:string}>;
}
export interface PrescreenSourceCheckpoint {
  version:2;
  campaign:string;
  module_id:string;
  /** The materials the preparation read; a check that finds them moved while every use held reports `revalidated`. */
  revision:string;
  answers_revision:string;
  generation:number;
  pdf:string;
  file_sha256:string;
  page_count:number;
  /** §195.1: what the check re-reads -- the candidates the prescreen supplied, never the whole materials revision. */
  used:PrescreenSourceUse[];
  readSet:ReadSet;
}
export type PrescreenSourceCheck={status:'current';readSet:ReadSet;revalidated?:true}
  |{status:'stale'|'unavailable';reason:string;changed?:string[]};
export interface PrescreenSourceResult {
  candidates:PrescreenSourceCandidate[];
  coverage:{
    checked_answers:{inspected:number;emitted:number;omitted:number;invalid:number};
    native:{searched_ranges:number[][];unsearched_ranges:number[][];materialized_pages:number[];unmaterialized_pages:number[];
      empty_pages:number[];error_pages:number[];candidate_omitted:number;
      /** Provider-stage omissions only. Final delivery omissions belong to the consumer after selection. */
      material_omitted:number;search_error?:string;extraction_error?:string;next?:{cursor:string};
      /** §191.7: the pages read in the transcript layer, with text or empty (every other page read is native). */
      transcript_pages:number[];
      /** §196: the pages whose units are paragraphs with a section, and the pages read only because a paragraph runs on to them. */
      paragraph_pages:number[];continuation_pages:number[];
      /** §196 (PU-03): the pages chosen from the entities the turn's locate judged relevant, and the literal searches run. */
      located_pages:number[];search_queries?:number;
      /**
       * §196.7 (PU-05): the passages the locate judged relevant (given), the pages read for them, and how many were offered:
       * each a candidate ahead of the page rotation (a broken paragraph whole when it fits).
       */
      located_passages?:number;passage_pages?:number[];passages_offered?:number;
      /** §191.7: the literal search's matches by layer, and those found only in a transcript's image text. */
      search_layers?:{transcript:number;native:number;image_text:number}};
  };
  readSet:ReadSet;
  /** Host-only serializable freshness binding over every candidate the preparation emitted. */
  checkpoint:PrescreenSourceCheckpoint;
  /** §195.1: the binding over the named candidates only (what the prescreen supplied); undefined for a key it never issued. */
  checkpointFor(keys:readonly string[]):PrescreenSourceCheckpoint|undefined;
  /** Additional raw evidence only; never extends an earlier consultation qualification. */
  readNativePages?:(pages:readonly number[],signal:AbortSignal)=>Promise<PrescreenSourceCandidate[]>;
  /** §195.1: re-reads the named candidates' read sets (all issued candidates when `keys` is absent). */
  check(signal?:AbortSignal,validationDeadlineAt?:number,keys?:readonly string[]):Promise<PrescreenSourceCheck>;
  /**
   * §195.1: the current materials for candidates whose read set changed, chosen once by the same identity -- a checked
   * answer by its focus and question, an excerpt or consultation by its pages (raw native text; a qualification does not
   * carry over to changed text). An answer no longer accepted has none.
   */
  reselect(keys:readonly string[],signal:AbortSignal,deadlineAt:number):Promise<Array<{key:string;candidates:PrescreenSourceCandidate[]}>>;
  nativeQualificationActions(selectedKeys:readonly string[]):number|undefined;
  /** §196.7: host-only, the candidate each located passage was offered as, in the order given (a passage not offered is absent). */
  passages:Array<{handle:string;key:string}>;
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
  /**
   * §196 (PU-03): the entities the turn's semantic locate judged relevant, most relevant first: each one's display name and
   * its graph source references. Their pages are read first, and the first names are searched literally beside the query.
   */
  located?:Array<{label:string;refs:unknown[]}>;
  /**
   * §196.7 (PU-05): the book passages the turn's locate judged relevant, most relevant first, each a paragraph unit by its
   * page and UTF-16 range in the transcript's exact layer. Their pages are read first and each becomes a candidate before
   * the page rotation.
   */
  passages?:Array<{handle:string;page:number;start:number;end:number}>;
}
/** §196 (PU-03): how many located names are searched literally beside the request itself. */
const LOCATED_SEARCHES=3;

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
/** §196.2: a unit's heading path as the label shows it. */
const sectionText=(section:readonly string[]|undefined)=>section?.length?` \u203a ${section.join(' \u203a ')}`:'';
/**
 * One native-text candidate over consecutive units: a unit, or (§196.3) a paragraph broken by a page break, both halves in
 * reading order with a reference on each page. Its label names the page(s) and the section (§196.2); a half whose other half
 * is not in it says on which page the paragraph goes on (`continues`) or began (`continued_from`).
 */
function nativeCandidate(units:readonly NativeSourceUnit[],query:string,_snapshot:PrescreenSourceSnapshot):PrescreenSourceCandidate {
  const [first]=units,last=units.at(-1)!,pages=[...new Set(units.map(unit=>unit.page))],body=units.map(unit=>unit.text).join('\n');
  const label=(pages.length>1?`Original PDF pages ${pages[0]}-${pages.at(-1)}`:first.pdfLabel?`Original PDF page ${first.page} (${first.pdfLabel})`
    :`Original PDF page ${first.page}`)+sectionText(first.section);
  // §196.7: one reference per page (each unit is one page's), and only what a consumer reads: Jev the label and body, the
  // Keeper the body, coverage, read and the provenance `publicMaterial` makes from `data`, the host the references. The body
  // is not repeated as a summary; the coverage's codes say what the dropped limitation sentence said on every candidate.
  const refs=units.map(unit=>unit.ref);
  return {key:digest(units.length===1?['native',first.ref.resource,first.ref.revision,first.ref.selector]:['native',refs.map(ref=>[ref.resource,ref.revision,ref.selector])]),
    kind:'source',label,authority:'native_text',body,refs,coverage:{status:'partial',supported:false,derived:false,
      omitted:['visual_verification','consultation_coverage']},
    data:{page:first.page,...(pages.length>1?{pages}:{}),...(typeof first.pdfLabel==='string'?{pdf_label:first.pdfLabel}:{}),
      ...(first.section?{section:[...first.section]}:{}),
      ...(last.continues?{continues:last.continues.page}:{}),...(first.continuedFrom?{continued_from:first.continuedFrom.page}:{})},
    read:read('Authored source consultation',query)};
}
/** §196.3: the linked halves a unit belongs to, in reading order (the unit alone when it has none in the catalog). */
function chainOf(unit:NativeSourceUnit,byAlias:ReadonlyMap<string,NativeSourceUnit>):NativeSourceUnit[] {
  let head=unit;const seen=new Set([unit.alias]);
  while(head.continuedFrom?.alias&&byAlias.has(head.continuedFrom.alias)&&!seen.has(head.continuedFrom.alias)){head=byAlias.get(head.continuedFrom.alias)!;seen.add(head.alias);}
  const chain=[head];
  for(let at=head;at.continues?.alias&&byAlias.has(at.continues.alias)&&!chain.some(member=>member.alias===at.continues!.alias);){at=byAlias.get(at.continues.alias)!;chain.push(at);}
  return chain;
}
/**
 * §196.3: candidates over a catalog's units. A unit whose paragraph runs across a page break is offered whole -- one
 * candidate over both halves -- when that candidate fits `materialBytes` (the consumer's allowance for a selected body);
 * otherwise each half is offered on its own, saying where the paragraph goes on. A half already offered whole is skipped.
 */
function unitOffers(catalog:NativeSourceCatalog,query:string,snapshot:PrescreenSourceSnapshot,materialBytes:number){
  const byAlias=new Map(catalog.units.map(unit=>[unit.alias,unit])),offered=new Set<string>();
  return (unit:NativeSourceUnit):{candidate:PrescreenSourceCandidate;members:NativeSourceUnit[]}|undefined=>{
    if(offered.has(unit.alias))return undefined;
    const chain=chainOf(unit,byAlias),whole=chain.length>1?nativeCandidate(chain,query,snapshot):undefined;
    const members=whole&&Buffer.byteLength(JSON.stringify(whole),'utf8')<=materialBytes?chain:[unit];
    for(const member of members)offered.add(member.alias);
    return {candidate:members===chain&&whole?whole:nativeCandidate([unit],query,snapshot),members};
  };
}
function fit(candidates:PrescreenSourceCandidate[],candidate:PrescreenSourceCandidate,budget:PrescreenSourceBudget,usage:{candidate:number}):'ok'|'candidate' {
  const candidateBytes=Buffer.byteLength(JSON.stringify(candidate),'utf8');
  if(usage.candidate+candidateBytes>budget.candidateBytes)return'candidate';
  usage.candidate+=candidateBytes;candidates.push(candidate);return'ok';
}
function decisionChoice(result:DecisionResult,key:string):string|undefined {
  const answer=result.answers[key];return result.status==='complete'&&answer?.status==='answered'&&answer.type==='choice'?answer.choice:undefined;
}

/**
 * §191.7: the bound pages as a consultation catalog. A runtime that reads page transcripts gives one catalog per layer
 * (transcribed pages in their exact layer, every other page native), merged in the pages' order; otherwise native only.
 */
async function readCatalog(source:PrescreenSourceRuntime,scope:ScopeBinding,snapshot:{pdf:string;file_sha256:string;page_count:number},
  pages:number[],signal:AbortSignal):Promise<NativeSourceCatalog> {
  return (await readParagraphCatalog(source,scope,snapshot,pages,signal,false)).catalog;
}
/**
 * §196: the bound pages as a consultation catalog whose transcript pages are read in paragraphs. With `expand`, a paragraph
 * that runs on to a page not asked for (or comes from one) has that page read too, so both halves are in the catalog
 * (`continuation`); without it (a re-read of named pages) only the pages asked for are read.
 */
async function readParagraphCatalog(source:PrescreenSourceRuntime,scope:ScopeBinding,snapshot:{pdf:string;file_sha256:string;page_count:number},
  pages:number[],signal:AbortSignal,expand=true):Promise<{catalog:NativeSourceCatalog;continuation:number[]}> {
  if(!source.sourcePageText)return{catalog:nativeSourceCatalog(scope,await source.sourceText({pdf:snapshot.pdf,pages,expected_file_sha256:snapshot.file_sha256},signal),snapshot.file_sha256),continuation:[]};
  const ask=(values:number[])=>source.sourcePageText!({pdf:snapshot.pdf,pages:values,expected_file_sha256:snapshot.file_sha256,layer:'preferred',paragraphs:true},signal);
  const first=await ask(pages),catalog=layeredSourceCatalog(scope,layeredBundles(first,snapshot.file_sha256,snapshot.page_count),snapshot.file_sha256,pages);
  const continuation=[...new Set(catalog.units.flatMap(unit=>[unit.continues&&!unit.continues.alias?unit.continues.page:0,
    unit.continuedFrom&&!unit.continuedFrom.alias?unit.continuedFrom.page:0]))].filter(page=>page>=1&&page<=snapshot.page_count&&!pages.includes(page)).slice(0,32);
  if(!expand||!continuation.length)return{catalog,continuation:[]};
  const more=await ask(continuation);
  if(more.file_sha256!==first.file_sha256)throw new Error('source_material_stale');
  const joined:LayeredPageText={...first,...(more.page_count!==undefined?{page_count:more.page_count}:{}),
    ...(more.native_extraction_version!==undefined?{native_extraction_version:more.native_extraction_version}:{}),
    pages:[...first.pages,...more.pages],errors:[...first.errors,...more.errors]};
  const order=[...pages,...continuation];
  return{catalog:layeredSourceCatalog(scope,layeredBundles(joined,snapshot.file_sha256,snapshot.page_count),snapshot.file_sha256,order),continuation};
}
/** §196: the pages whose units are paragraphs with a section. */
const paragraphPages=(catalog:NativeSourceCatalog)=>[...new Set(catalog.units.filter(unit=>unit.section).map(unit=>unit.page))].sort((a,b)=>a-b);
/** Each page of a catalog with the layer it was read in. */
function pageLayers(catalog:NativeSourceCatalog):Map<number,SourceCatalogLayer> {
  return new Map(catalog.snapshots.map(snapshot=>[Number(snapshot.resource.split(':')[3]),sourceLayerOf(snapshot.resource)]));
}
/** §191.6: tell the transcript queue which pages a consultation wanted and read natively; never a failure of the read. */
function wantTranscripts(source:PrescreenSourceRuntime,snapshot:{pdf:string;file_sha256:string},pages:number[]):void {
  if(!source.wantTranscripts||!pages.length)return;
  try{source.wantTranscripts({pdf:snapshot.pdf,file_sha256:snapshot.file_sha256,pages:[...new Set(pages)]});}catch{/* the queue is never the read's failure */}
}

/** The page, layer and extraction version a native-text ref names (`pdf:<sha>:page:<n>:<layer>:<version>`). */
function pageOfRef(ref:SourceRef):{page:number;layer:SourceCatalogLayer;version:string;revision:string}|undefined {
  const parts=ref.resource.split(':'),page=Number(parts[3]);
  if(parts[0]!=='pdf'||parts[2]!=='page'||!Number.isSafeInteger(page)||page<1||!['native','transcript'].includes(parts[4])||!parts.slice(5).join(':'))return undefined;
  return {page,layer:parts[4] as SourceCatalogLayer,version:parts.slice(5).join(':'),revision:ref.revision};
}
function pagesOfRefs(refs:readonly SourceRef[]):PrescreenSourceUse['pages'] {
  const out=new Map<string,NonNullable<PrescreenSourceUse['pages']>[number]>();
  for(const ref of refs){const page=pageOfRef(ref);if(page)out.set(`${page.page}:${page.layer}`,page);}
  return [...out.values()].sort((a,b)=>a.page-b.page||a.layer.localeCompare(b.layer));
}
function validUse(value:unknown,pageCount:number):value is PrescreenSourceUse {
  if(!isPlainRecord(value)||typeof value.key!=='string'||!value.key)return false;
  const answer=value.answer,pages=value.pages;
  if(answer!==undefined&&(!isPlainRecord(answer)||typeof answer.key!=='string'||!answer.key||!sha(answer.revision)
    ||typeof answer.focus!=='string'||typeof answer.question!=='string'))return false;
  if(pages!==undefined&&(!Array.isArray(pages)||pages.some(row=>!isPlainRecord(row)||!Number.isSafeInteger(row.page)||Number(row.page)<1
    ||Number(row.page)>pageCount||!['native','transcript'].includes(String(row.layer))||typeof row.version!=='string'||!row.version||!sha(row.revision))))return false;
  return answer!==undefined||pages!==undefined;
}
/** Every accepted answer the materials list now, paged until each wanted key is found or the list ends. */
async function currentAnswers(call:(method:string,params:Row)=>Promise<Row>,campaign:string,moduleId:string,wanted:Set<string>|undefined,signal:AbortSignal):Promise<{snapshot:PrescreenSourceSnapshot;answers:Row[]}> {
  const answers:Row[]=[];let cursor:number|null=0,first:PrescreenSourceSnapshot|undefined;
  for(let pages=0;cursor!==null&&pages<64;pages++){
    signal.throwIfAborted();
    const page=checkedSnapshot(await call('module.source.materials.snapshot',{campaign,module_id:moduleId,answer_limit:64,answer_cursor:cursor}),campaign,moduleId);
    if(first&&(page.revision!==first.revision||page.answers_revision!==first.answers_revision))throw new Error('source_material_changed');
    first??=page;answers.push(...page.checked_answers);cursor=page.next;
    if(wanted&&[...wanted].every(key=>answers.some(row=>row.key===key)))break;
  }
  return {snapshot:first!,answers};
}

/**
 * §195.1: a prescreen is checked against what it used. The answers it supplied must still be accepted with the same
 * draft digest, and the pages it quoted must read back, in the layer they were read in, with the same text revision;
 * whatever else a library publish added does not concern it. A check that finds the materials moved while every use held
 * says `revalidated`. Reasons: `source_material_changed` (the bound PDF itself), `source_extraction_changed` (a quoted
 * page), `source_answer_changed` (a supplied answer), each with the candidate keys that changed.
 */
export async function checkPrescreenSourceCheckpoint(input:{
  call(method:string,params:Row):Promise<Row>;
  source:PrescreenSourceRuntime;
  scope:ScopeBinding;
  signal:AbortSignal;
  deadlineAt:number;
  checkpoint:PrescreenSourceCheckpoint;
}):Promise<PrescreenSourceCheck> {
  try{
    input.signal.throwIfAborted();
    const checkpoint=structuredClone(input.checkpoint),remaining=input.deadlineAt-Date.now();
    if(!isPlainRecord(checkpoint)||checkpoint.version!==2||!checkpoint.campaign||!checkpoint.module_id||!sha(checkpoint.revision)||!sha(checkpoint.answers_revision)
      ||!Number.isSafeInteger(checkpoint.generation)||!checkpoint.pdf||!sha(checkpoint.file_sha256)||!Number.isSafeInteger(checkpoint.page_count)||checkpoint.page_count<1
      ||!Array.isArray(checkpoint.readSet)||!Array.isArray(checkpoint.used)||checkpoint.used.some(use=>!validUse(use,checkpoint.page_count)))
      return{status:'unavailable',reason:'invalid_source_checkpoint'};
    if(!Number.isFinite(remaining)||remaining<=0)return{status:'stale',reason:'source_material_deadline'};
    const signal=AbortSignal.any([input.signal,AbortSignal.timeout(Math.max(1,remaining))]);
    const answers=checkpoint.used.filter(use=>use.answer),pages=checkpoint.used.flatMap(use=>use.pages??[]);
    const bound=async():Promise<{moved:boolean;same:boolean;current?:Map<string,string>}>=>{
      if(answers.length){
        const read=await currentAnswers(input.call,checkpoint.campaign,checkpoint.module_id,new Set(answers.map(use=>use.answer!.key)),signal);
        return {moved:read.snapshot.revision!==checkpoint.revision||read.snapshot.answers_revision!==checkpoint.answers_revision,
          same:read.snapshot.file_sha256===checkpoint.file_sha256&&read.snapshot.page_count===checkpoint.page_count&&read.snapshot.pdf===checkpoint.pdf,
          current:new Map(read.answers.filter(row=>typeof row.key==='string'&&isPlainRecord(row.evidence)).map(row=>[row.key,String(row.evidence.revision)]))};
      }
      const snapshot=await input.call('module.source.snapshot',{campaign:checkpoint.campaign,module_id:checkpoint.module_id});
      return {moved:snapshot.generation!==checkpoint.generation,
        same:snapshot.file_sha256===checkpoint.file_sha256&&snapshot.page_count===checkpoint.page_count&&snapshot.pdf===checkpoint.pdf};
    };
    const [kernel,info]=await Promise.all([bound(),pages.length?input.source.sourceInfo({pdf:checkpoint.pdf,cache:input.source.home},signal):Promise.resolve(undefined)]);
    if(!kernel.same||info&&(info.file_sha256!==checkpoint.file_sha256||info.page_count!==checkpoint.page_count))
      return{status:'stale',reason:'source_material_changed',changed:checkpoint.used.map(use=>use.key)};
    // §191.7: each quoted page is re-read in the layer it was read in, so a page that gained a transcript since keeps its use.
    const revisions=new Map<string,string>();
    const nativePages=[...new Set(pages.filter(row=>row.layer==='native').map(row=>row.page))].sort((a,b)=>a-b);
    const transcriptPages=[...new Set(pages.filter(row=>row.layer==='transcript').map(row=>row.page))].sort((a,b)=>a-b);
    if(nativePages.length){
      const bundle=await input.source.sourceText({pdf:checkpoint.pdf,pages:nativePages,expected_file_sha256:checkpoint.file_sha256},signal);
      if(bundle.page_count!==checkpoint.page_count)return{status:'stale',reason:'source_material_changed',changed:checkpoint.used.map(use=>use.key)};
      for(const unit of nativeSourceCatalog(input.scope,bundle,checkpoint.file_sha256).snapshots)
        revisions.set(`${unit.resource.split(':')[3]}:native:${unit.resource.split(':').slice(5).join(':')}`,unit.revision);
    }
    if(transcriptPages.length){
      if(!input.source.sourcePageText)return{status:'unavailable',reason:'source_extraction_unavailable'};
      const read=await input.source.sourcePageText({pdf:checkpoint.pdf,pages:transcriptPages,expected_file_sha256:checkpoint.file_sha256,layer:'preferred'},signal);
      const bundles=layeredBundles(read,checkpoint.file_sha256,checkpoint.page_count);
      if(bundles.transcript)for(const unit of nativeSourceCatalog(input.scope,bundles.transcript,checkpoint.file_sha256,'transcript').snapshots)
        revisions.set(`${unit.resource.split(':')[3]}:transcript:${unit.resource.split(':').slice(5).join(':')}`,unit.revision);
    }
    const pageChanged=(use:PrescreenSourceUse)=>(use.pages??[]).some(row=>revisions.get(`${row.page}:${row.layer}:${row.version}`)!==row.revision);
    const answerChanged=(use:PrescreenSourceUse)=>!!use.answer&&kernel.current?.get(use.answer.key)!==use.answer.revision;
    const extraction=checkpoint.used.filter(pageChanged).map(use=>use.key),answer=checkpoint.used.filter(answerChanged).map(use=>use.key);
    if(extraction.length||answer.length)return{status:'stale',reason:extraction.length?'source_extraction_changed':'source_answer_changed',
      changed:[...new Set([...extraction,...answer])]};
    return{status:'current',readSet:checkpoint.readSet,...(kernel.moved?{revalidated:true as const}:{})};
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
  const searched=new Set<number>(),matches:number[]=[];let next:string|undefined,searchError:string|undefined,searchLayers:{transcript:number;native:number;image_text:number}|undefined;
  // §196 (PU-03): the request is searched as it was given, and beside it the names of the entities the locate judged most
  // relevant: a literal search finds a name the book prints; a player's whole sentence it never finds.
  const literalOf=(value:string)=>Array.from(value.trim()).slice(0,256).join('');
  const located=(input.located??[]).filter(row=>isPlainRecord(row)&&typeof row.label==='string'),
    queries=[...new Set([literalOf(input.query),...located.map(row=>literalOf(row.label))].filter(Boolean))].slice(0,1+LOCATED_SEARCHES);
  if(input.source.sourceSearch&&queries.length){
    const results=await Promise.allSettled(queries.map(query=>input.source.sourceSearch!({pdf:snapshot.pdf,query,first_page:1,last_page:snapshot.page_count,limit:20},signal)));
    if(signal.aborted)throw signal.reason;
    for(const [index,settled] of results.entries()){
      if(settled.status==='rejected'){searchError??=settled.reason instanceof Error?settled.reason.message.slice(0,160):'source_search_unavailable';continue;}
      const result=settled.value,scope=isPlainRecord(result.scope)?result.scope:{};
      if(Number.isSafeInteger(scope.searched_first_page)&&Number.isSafeInteger(scope.searched_last_page))
        for(let page=Number(scope.searched_first_page);page<=Number(scope.searched_last_page);page++)searched.add(page);
      searchLayers??={transcript:0,native:0,image_text:0};
      for(const row of Array.isArray(result.matches)?result.matches:[])if(Number.isSafeInteger(row.page)&&row.page>=1&&row.page<=snapshot.page_count){matches.push(row.page);
        if(row.layer==='transcript')searchLayers.transcript++;else searchLayers.native++;if(row.image_text===true)searchLayers.image_text++;}
      if(index===0&&queries[0]===literalOf(input.query)&&result.truncated===true&&typeof result.next_cursor==='string')next=result.next_cursor;
    }
  }
  const maxPages=positive(budget.maxNativePages,16,32),broad=spreadPages(snapshot.page_count,maxPages);
  // §196.7 (PU-05): the located passages' pages, most relevant first, lead; then (§196 PU-03) the located entities' own pages,
  // most relevant first, before the pages the capsule cites.
  const passages=(input.passages??[]).filter(row=>isPlainRecord(row)&&typeof row.handle==='string'&&Number.isSafeInteger(row.page)
    &&row.page>=1&&row.page<=snapshot.page_count&&Number.isSafeInteger(row.start)&&Number.isSafeInteger(row.end)&&row.end>row.start);
  const passagePages=[...new Set(passages.map(row=>row.page))],entityPages=[...citedPages(located.map(row=>row.refs),input.moduleId,snapshot.page_count,snapshot.window)];
  const locatedPages=[...new Set([...passagePages,...entityPages])];
  const authored=[...citedPages(capsule,input.moduleId,snapshot.page_count,snapshot.window)].filter(page=>!locatedPages.includes(page));
  const cited=[...locatedPages,...authored],reserved:number[]=[];
  const reserve=(values:number[],preferLast=false)=>{const ordered=preferLast?[...values].reverse():values;const page=ordered.find(value=>!cited.includes(value)&&!reserved.includes(value));if(page!==undefined)reserved.push(page);};
  if(maxPages>=2)reserve(matches);if(maxPages>=2)reserve(broad,true);
  while(reserved.length>=maxPages)reserved.shift();
  const room=maxPages-reserved.length,first=locatedPages.slice(0,room);
  const pages=[...first,...samplePages(authored,room-first.length),...reserved];
  for(const page of [...locatedPages,...matches,...broad,...authored])if(pages.length<maxPages&&!pages.includes(page))pages.push(page);
  let extractionVersion:string|undefined,emptyPages:number[]=[],errorPages:number[]=[],extractionError:string|undefined,
    nativeCatalog:NativeSourceCatalog|undefined,nativeOwnerParts:NativeSourcePart[]=[];
  const materialized=new Set<number>(),candidatePartAliases=new Map<string,string>(),transcribed=new Set<number>(),
    paragraphed=new Set<number>(),continued=new Set<number>(),passageOffers:Array<{handle:string;key:string}>=[];
  if(pages.length){
    try{
      const paragraphRead=await readParagraphCatalog(input.source,input.scope,snapshot,pages,signal),catalog=paragraphRead.catalog;nativeCatalog=catalog;nativeOwnerParts=nativeSourceParts(catalog);
      for(const page of paragraphRead.continuation)continued.add(page);for(const page of paragraphPages(catalog))paragraphed.add(page);
      const offered=[...pages,...paragraphRead.continuation],offer=unitOffers(catalog,input.query,snapshot,budget.materialBytes);
      const layerOf=pageLayers(catalog),read=[...catalog.coverage.textPages,...catalog.coverage.emptyPages];
      for(const [page,layer] of layerOf)if(layer==='transcript')transcribed.add(page);
      // A read with no page in it has no extraction to bind (§191.7 names each layer's version either way).
      const first=read.find(page=>layerOf.get(page)!=='transcript')??read[0];
      extractionVersion=first===undefined?undefined:catalog.layers?.[layerOf.get(first)??'native']??catalog.extractionVersion;
      emptyPages=[...catalog.coverage.emptyPages];errorPages=[...catalog.coverage.errorPages];
      for(const page of catalog.coverage.textPages)materialized.add(page);
      const byPage=new Map<number,typeof catalog.units>();
      for(const page of offered)byPage.set(page,catalog.units.filter(unit=>unit.page===page));
      const place=(unit:NativeSourceUnit):'ok'|'candidate'|undefined=>{
        const offering=offer(unit);if(!offering)return undefined;
        const {candidate,members}=offering,outcome=fit(candidates,candidate,budget,usage),head=members[0];
        if(outcome==='ok'){const range=head.ref.selector,part=nativeOwnerParts.find(value=>value.ref.resource===head.ref.resource&&range.kind==='utf16'
            &&value.ref.selector.kind==='utf16'&&value.ref.selector.start<=range.start&&value.ref.selector.end>=range.end);
          if(part)candidatePartAliases.set(candidate.key,part.alias);}
        if(outcome==='candidate')candidateOmitted++;
        return outcome;
      };
      // §196.7: each located passage is the transcript unit with its page and range; it is offered before any page rotation,
      // most relevant first, whole across a page break when it fits (§196.3).
      for(const passage of passages){
        const unit=byPage.get(passage.page)?.find(value=>value.section!==undefined&&value.ref.selector.kind==='utf16'
          &&value.ref.selector.start===passage.start&&value.ref.selector.end===passage.end);
        if(!unit)continue;
        const before=candidates.length;
        if(place(unit)==='ok'&&candidates.length>before)passageOffers.push({handle:passage.handle,key:candidates.at(-1)!.key});
      }
      for(let ordinal=0;;ordinal++){
        let found=false;
        for(const page of offered){const unit=byPage.get(page)?.[ordinal];if(!unit)continue;found=true;place(unit);}
        if(!found)break;
      }
    }catch(error){if(signal.aborted)throw error;extractionError=error instanceof Error?error.message.slice(0,160):'source_text_unavailable';}
  }
  const readSet:ReadSet=[
    {kind:'source',resource:`module-source:${input.campaign}:${input.moduleId}`,revision:snapshot.revision},
    {kind:'source',resource:`source-answers:${input.campaign}:${input.moduleId}`,revision:snapshot.answers_revision},
    {kind:'source',resource:`pdf:${snapshot.file_sha256}`,revision:snapshot.file_sha256},
    ...(extractionVersion?(Object.entries(nativeCatalog?.layers??{native:extractionVersion}) as Array<[SourceCatalogLayer,string]>)
      .map(([layer,version])=>({kind:'extraction' as const,resource:`pdf:${snapshot.file_sha256}:${layer}`,revision:version})):[]),
    {kind:'family',resource:'prescreen-source-materials',revision:'1'},
  ];
  // §195.1: every candidate this provider issues, by key, so a check can re-read exactly what the prescreen supplied.
  const issued=new Map<string,PrescreenSourceCandidate>();
  const issue=(values:readonly PrescreenSourceCandidate[])=>{for(const value of values)issued.set(value.key,value);};
  issue(candidates);
  const answerPrefix=`source-answer:${input.moduleId}:`;
  const useOf=(candidate:PrescreenSourceCandidate):PrescreenSourceUse|undefined=>{
    if(candidate.authority==='reviewed_source'){
      const ref=candidate.refs?.[0],data=candidate.data??{};
      if(!ref||!ref.resource.startsWith(answerPrefix))return undefined;
      return {key:candidate.key,answer:{key:ref.resource.slice(answerPrefix.length),revision:ref.revision,focus:text(data.focus),question:text(data.question)}};
    }
    const pages=pagesOfRefs(candidate.refs??[]);return pages?.length?{key:candidate.key,pages}:undefined;
  };
  const checkpointFor=(keys:readonly string[]):PrescreenSourceCheckpoint|undefined=>{
    const used:PrescreenSourceUse[]=[];
    for(const key of new Set(keys)){const candidate=issued.get(key),use=candidate&&useOf(candidate);if(!use)return undefined;used.push(use);}
    return {version:2,campaign:input.campaign,module_id:input.moduleId,revision:snapshot.revision,answers_revision:snapshot.answers_revision,
      generation:snapshot.generation,pdf:snapshot.pdf,file_sha256:snapshot.file_sha256,page_count:snapshot.page_count,used,readSet};
  };
  const checkpoint=checkpointFor([...issued.keys()])!;
  const check=async(checkSignal:AbortSignal=input.signal,validationDeadlineAt:number=deadlineAt,keys?:readonly string[]):Promise<PrescreenSourceCheck>=>{
    const bound=checkpointFor(keys??[...issued.keys()]);if(!bound)return{status:'unavailable',reason:'invalid_source_checkpoint'};
    return checkPrescreenSourceCheckpoint({call:input.call,source:input.source,scope:input.scope,signal:checkSignal,deadlineAt:validationDeadlineAt,checkpoint:bound});
  };
  const reselect=async(keys:readonly string[],caller:AbortSignal,reselectDeadlineAt:number):Promise<Array<{key:string;candidates:PrescreenSourceCandidate[]}>>=>{
    const remaining=reselectDeadlineAt-Date.now();if(!Number.isFinite(remaining)||remaining<=0)throw new Error('source_material_deadline');
    const active=AbortSignal.any([caller,AbortSignal.timeout(Math.max(1,remaining))]);
    const uses=[...new Set(keys)].map(key=>{const candidate=issued.get(key),use=candidate&&useOf(candidate);if(!use)throw new Error('invalid_source_checkpoint');return use;});
    const actual=await input.source.sourceInfo({pdf:snapshot.pdf,cache:input.source.home},active);
    if(actual.file_sha256!==snapshot.file_sha256||actual.page_count!==snapshot.page_count)throw new Error('source_material_changed');
    const asked=uses.filter(use=>use.answer),pages=[...new Set(uses.flatMap(use=>(use.pages??[]).map(row=>row.page)))].sort((a,b)=>a-b);
    const [answers,catalog]=await Promise.all([
      asked.length?currentAnswers(input.call,input.campaign,input.moduleId,undefined,active):Promise.resolve(undefined),
      pages.length?readCatalog(input.source,input.scope,snapshot,pages,active):Promise.resolve(undefined)]);
    active.throwIfAborted();
    const out:Array<{key:string;candidates:PrescreenSourceCandidate[]}>=[];
    for(const use of uses){
      const found:PrescreenSourceCandidate[]=[];
      if(use.answer&&answers){const row=answers.answers.find(value=>value.focus===use.answer!.focus&&value.question===use.answer!.question);
        const candidate=row&&answerCandidate(row,answers.snapshot,input.scope,input.query);if(candidate)found.push(candidate);}
      if(use.pages&&catalog){const wanted=new Set(use.pages.map(row=>row.page)),offer=unitOffers(catalog,input.query,snapshot,budget.materialBytes);
        for(const unit of catalog.units)if(wanted.has(unit.page)){const offered=offer(unit);if(offered)found.push(offered.candidate);}}
      issue(found);out.push({key:use.key,candidates:found});
    }
    return out;
  };
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
    wantTranscripts(input.source,snapshot,nativeOwnerParts.filter(part=>selectedAliases.includes(part.alias)&&sourceLayerOf(part.ref.resource)==='native').map(part=>part.page));
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
        sourceText:(pdf,pages,expected,signal)=>input.source.sourceText({pdf,pages,expected_file_sha256:expected},signal),
        ...(input.source.sourcePageText?{transcriptText:async(pdf:string,pages:number[],expected:string,signal:AbortSignal)=>{
          const bundles=layeredBundles(await input.source.sourcePageText!({pdf,pages,expected_file_sha256:expected,layer:'preferred'},signal),expected,snapshot.page_count);
          if(!bundles.transcript||bundles.native)throw new Error('source_binding_stale');
          return bundles.transcript;}}:{})},moduleId:input.moduleId,
        campaign:input.campaign,scope:input.scope,question:input.query,binding,catalog:nativeCatalog,
        approval:{question:input.query,verdict,classifications,coverage:nativeCatalog.coverage},signal:qualifiedSignal});
      const excerpts=materialized.sourceAnswer.excerpts as Row[],pages=[...new Set(excerpts.map(row=>Number(row.page)).filter(Number.isSafeInteger))],
        body=excerpts.map(row=>`[Original PDF page ${Number(row.page)}]\n${String(row.text??'')}`).join('\n\n'),proof=materialized.proof;
      const qualified:PrescreenSourceCandidate={key:digest(['native-consultation',input.query,keys,proof.refs]),kind:'source',
        label:`Supported native source consultation: ${clip(input.query,160)}`,summary:clip(body),authority:'native_consultation',body,refs:proof.refs,
        coverage:{status:'complete',supported:true,derived:false,used:proof.coverage.used,omitted:proof.coverage.omitted,unknown:proof.coverage.unknown,
          limitations:materialized.sourceAnswer.limitations as Json},data:{question:input.query,status:'answered',supported:true,prepared:false,
          ...(pages.length===1?{page:pages[0]}:{}),source_refs:materialized.sourceAnswer.source_refs as Json,excerpts:materialized.sourceAnswer.excerpts as Json}};
      issue([qualified]);return{status:'qualified',selectedKeys:keys,calls,candidate:qualified};
    }catch(error){return gap('unavailable',caller.aborted?'cancelled':error instanceof Error?error.message:'native_qualification_unavailable');}
  };
  const result:PrescreenSourceResult={candidates,readSet,checkpoint,checkpointFor,check,reselect,nativeQualificationActions,qualifyNative,passages:passageOffers,coverage:{checked_answers:{inspected:snapshot.checked_answers.length,emitted:candidates.filter(row=>row.authority==='reviewed_source').length,
    omitted:checkedOmitted,invalid:snapshot.checked_answers_invalid},native:{searched_ranges:rangeSet(searched,snapshot.page_count),unsearched_ranges:complement(searched,snapshot.page_count),
      materialized_pages:[...materialized].sort((a,b)=>a-b),unmaterialized_pages:Array.from({length:snapshot.page_count},(_,i)=>i+1).filter(page=>!materialized.has(page)),
      empty_pages:emptyPages,error_pages:errorPages,candidate_omitted:candidateOmitted,material_omitted:0,
      transcript_pages:[...transcribed].sort((a,b)=>a-b),paragraph_pages:[...paragraphed].sort((a,b)=>a-b),
      continuation_pages:[...continued].sort((a,b)=>a-b),located_pages:entityPages.filter(page=>pages.includes(page)),
      ...(input.passages?{located_passages:passages.length,passage_pages:passagePages.filter(page=>pages.includes(page)),passages_offered:passageOffers.length}:{}),
      ...(searchLayers?{search_layers:searchLayers,search_queries:queries.length}:{}),
      ...(searchError?{search_error:searchError}:{}),...(extractionError?{extraction_error:extractionError}:{}),...(next?{next:{cursor:next}}:{})}}};
  if(extractionVersion)result.readNativePages=async(requested,caller)=>{
    const pages=[...new Set(requested)];
    if(!pages.length||pages.length>2||pages.some(page=>!Number.isSafeInteger(page)||page<1||page>snapshot.page_count
        ||!result.coverage.native.unmaterialized_pages.includes(page)))throw new Error('invalid_native_continuation');
    const active=AbortSignal.any([signal,caller]);active.throwIfAborted();
    const catalog=await readCatalog(input.source,input.scope,snapshot,pages,active);
    active.throwIfAborted();
    // Each layer read here is the version the preparation read in it (a layer it did not read has nothing to compare).
    const prepared=nativeCatalog?.layers??{native:extractionVersion};
    if(catalog.pageCount!==snapshot.page_count||(Object.entries(catalog.layers??{}) as Array<[SourceCatalogLayer,string]>)
      .some(([layer,version])=>prepared[layer]!==undefined&&prepared[layer]!==version))throw new Error('source_extraction_changed');
    const layerOf=pageLayers(catalog);
    wantTranscripts(input.source,snapshot,pages.filter(page=>layerOf.get(page)!=='transcript'));
    const observed=[...catalog.coverage.textPages,...catalog.coverage.emptyPages,...catalog.coverage.errorPages];
    if(observed.length!==pages.length||observed.some(page=>!pages.includes(page)))throw new Error('invalid_native_continuation');
    const fetched:PrescreenSourceCandidate[]=[],used={candidate:0},allowance={...budget,candidateBytes:budget.materialBytes},
      offer=unitOffers(catalog,input.query,snapshot,budget.materialBytes);
    for(const unit of catalog.units){if(!pages.includes(unit.page))throw new Error('invalid_native_continuation');
      const offered=offer(unit);if(offered&&fit(fetched,offered.candidate,allowance,used)!=='ok')result.coverage.native.candidate_omitted++;}
    for(const page of paragraphPages(catalog))paragraphed.add(page);
    result.coverage.native.paragraph_pages=[...paragraphed].sort((a,b)=>a-b);
    for(const page of catalog.coverage.textPages)materialized.add(page);
    for(const [page,layer] of layerOf)if(layer==='transcript')transcribed.add(page);
    result.coverage.native.transcript_pages=[...transcribed].sort((a,b)=>a-b);
    result.coverage.native.materialized_pages=[...materialized].sort((a,b)=>a-b);
    result.coverage.native.unmaterialized_pages=result.coverage.native.unmaterialized_pages.filter(page=>!pages.includes(page));
    result.coverage.native.empty_pages=[...new Set([...result.coverage.native.empty_pages,...catalog.coverage.emptyPages])];
    result.coverage.native.error_pages=[...new Set([...result.coverage.native.error_pages,...catalog.coverage.errorPages])];
    candidates.push(...fetched);issue(fetched);return fetched;
  };
  return result;
}
