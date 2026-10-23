/**
 * §258: a bound PDF's opening found from its text layer alone, so a table can open on the opening's pages while the
 * graph is read in the background. Two text-only reader calls (no page images, no review): one finds the opening's pages
 * and the setup pages from the bookmarks and each page's first lines; one writes the public setup guide from those pages'
 * text. The host builds the same source-reference packet and receipt `module.reference.publish` installs, under the
 * `page-text-v1` check policy.
 */
import{createHash,randomUUID}from'node:crypto';
import{mkdir,readFile,writeFile}from'node:fs/promises';
import{join,dirname}from'node:path';
import type{HostRuntime}from'../../runtime/host.ts';
import type{TaskProviderBudget}from'../../runtime/jev/provider-budget.ts';
import{PAGE_TEXT_POLICY,REFERENCE_FIELDS,SOURCE_REFERENCE_PROTOCOL,validateReferencePacket,type ReferenceExcerpt,type SourceReferencePacket}from'../../kernel-ts/modules/reference-contract.ts';
import{PUBLIC_GUIDANCE_FIELDS,validatePublicGuidance,type PublicGuidance}from'../../kernel-ts/modules/public-guidance.ts';
import{SourceReferenceFailure,type ReferenceResult}from'./source-reference.ts';
type Row=Record<string,any>;
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** The pages one opening may span, the setup pages one guide may read, and the openings one book may offer. */
const OPENING_PAGES=4,SETUP_PAGES=6,OPENINGS=4;
/** A page's text kept for a reader call and as one excerpt (the packet's own bound). */
const PAGE_CHARS=12000;
/** The table of contents a locate call reads: bookmarks plus each page's first lines. */
const HEAD_LINES=3,HEAD_CHARS=80,TOC_BYTES=24000;
const FIELD_CHARS=950;

const LOCATE_INSTRUCTION=`You find where play begins in a tabletop roleplaying scenario book, from its table of contents.
task.json holds the book's bookmarks (title and page) and the first lines of every page. Decide:
- openings: the scene or scenes where the investigators' play begins (a prologue, an arrival, a briefing), each with its name as the book prints it and the pages that hold it: the page where it starts and the pages that describe that place, its people and what the players are read aloud there (at most ${OPENING_PAGES} pages, in reading order). A book with alternative starts lists each; most books have one.
- setup_pages: the pages a group needs before play to make investigators: the premise, era and setting, how the investigators are involved, advice or requirements for their creation (at most ${SETUP_PAGES} pages).
Use only page numbers that appear in task.json. Write answer.json with the write tool, exactly:
{"openings":[{"name":"...","pages":[16,17,20]}],"setup_pages":[5,6,7]}
Then stop.`;

const GUIDE_INSTRUCTION=`You prepare the public setup guide of a tabletop roleplaying scenario, before the players make their investigators.
task.json holds the original text of the book's setup pages and of the opening's pages, page by page, in the book's language, and play_language.
Write in play_language. Write only what the players may know before play: the era, where the investigators start, the premise as it is presented to them, and advice for making investigators (skills, occupations, requirements the book states). Never reveal Keeper-only information: no secret, culprit, monster, twist, hidden motive or what the investigators will discover. When the book marks a part as Keeper information, leave it out.
Write answer.json with the write tool, exactly:
{"era":{"text":"...","pages":[7]},"starting_place":{"text":"...","pages":[16]},"public_premise":{"text":"...","pages":[6]},"creation_advice":{"text":"...","pages":[7]},"era_text":"..."}
Each text is at most ${FIELD_CHARS} characters; leave one empty ("" with pages []) when the book does not say it. pages are the task.json pages the text rests on. era_text is the era copied exactly, character for character, from one setup or opening page (for example a year or a decade), or "" when none is printed.
Then stop.`;

export type PageOpenInput={runtime:HostRuntime;source:{pdf:string;file_sha256:string;page_count:number};moduleId:string;language:string;
 focus?:string;providerBudget?:TaskProviderBudget;model:{id:string;thinking?:string};signal?:AbortSignal;record?:(row:Row)=>void};

/** One text-only reader call: `task` is written as task.json, the child writes answer.json; the parsed answer, or a failure. */
async function ask(input:PageOpenInput,cwd:string,step:string,instruction:string,task:Row):Promise<Row>{
 const dir=join(cwd,step);await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'task.json'),JSON.stringify(task)+'\n');
 const run=await input.runtime.runTask({kind:'reader',request:{cwd:dir,systemPrompt:instruction,brief:'Read task.json, then write answer.json as instructed.',
  model:input.model.id,thinking:input.model.thinking,providerBudget:input.providerBudget,tools:'read,write',maxRequests:4,timeoutMs:180000,eventLog:join(dir,'events.jsonl')}},input.signal);
 await writeFile(join(dir,'run-result.json'),JSON.stringify(run)+'\n');
 input.record?.({lane:'page-open',event:step,module_id:input.moduleId,ok:run.ok,ms:run.ms,usage:run.usage});
 let answer:unknown;
 try{answer=JSON.parse(await readFile(join(dir,'answer.json'),'utf8'));}
 catch{if(input.signal?.aborted)input.signal.throwIfAborted();throw new SourceReferenceFailure(`page_open_${step}_missing`,!run.refusal);}
 if(!answer||typeof answer!=='object'||Array.isArray(answer))throw new SourceReferenceFailure(`page_open_${step}_shape`,true);
 return answer as Row;
}

/** Bookmarks flattened to `{name, page}` in book order, two levels deep. */
function bookmarks(rows:unknown,depth=0):Array<{name:string;page:number}>{
 if(!Array.isArray(rows)||depth>1)return [];
 return rows.flatMap((row:Row)=>[...(typeof row?.name==='string'&&Number.isSafeInteger(row.page)?[{name:row.name.trim().slice(0,HEAD_CHARS),page:row.page}]:[]),...bookmarks(row?.children,depth+1)]);
}
const pageList=(value:unknown,count:number,max:number):number[]=>
 Array.isArray(value)?[...new Set(value.filter((page):page is number=>Number.isSafeInteger(page)&&page>=1&&page<=count))].slice(0,max):[];

/**
 * §258.2: find the opening and write the guide. The result's files are the ones `module.reference.publish` reads:
 * task.json, source-reference.json, reference-guidance.txt and source-reference-complete.json in `workDir`.
 */
export async function runPageOpen(input:PageOpenInput):Promise<ReferenceResult>{
 const began=Date.now(),{source}=input,count=source.page_count;
 const cwd=join(dirname(source.pdf),'work','page-open-'+randomUUID());await mkdir(cwd,{recursive:true});
 const info=await input.runtime.sourceInfo({pdf:source.pdf,cache:join(dirname(source.pdf),'cache','pages')},input.signal);
 if(info.file_sha256!==source.file_sha256)throw Error('The bound original changed during the page opening');
 const all=Array.from({length:count},(_,index)=>index+1);
 const lines=await input.runtime.sourceLines({pdf:source.pdf,pages:all,expected_file_sha256:source.file_sha256},input.signal);
 const text=new Map(lines.pages.map(page=>[page.page,page.lines.join('\n')]));
 // The table of contents: as many pages' first lines as fit, in page order; bookmarks first.
 const marks=bookmarks(info.bookmarks);let bytes=Buffer.byteLength(JSON.stringify(marks));
 const heads:Array<{page:number;lines:string[]}>=[];
 for(const page of lines.pages){
  const head={page:page.page,lines:page.lines.map(line=>line.trim()).filter(Boolean).slice(0,HEAD_LINES).map(line=>line.slice(0,HEAD_CHARS))};
  bytes+=Buffer.byteLength(JSON.stringify(head));if(bytes>TOC_BYTES)break;heads.push(head);
 }
 if(!heads.some(head=>head.lines.length))throw new SourceReferenceFailure('page_open_no_text_layer',false,true);
 const located=await ask(input,cwd,'locate',LOCATE_INSTRUCTION,{page_count:count,bookmarks:marks,pages:heads,...(input.focus?{preferred_opening:input.focus}:{})});
 const openings=(Array.isArray(located.openings)?located.openings:[]).slice(0,OPENINGS).flatMap((row:Row)=>{
  const name=typeof row?.name==='string'?row.name.trim().slice(0,400):'',pages=pageList(row?.pages,count,OPENING_PAGES).filter(page=>text.get(page)?.trim());
  return name&&pages.length?[{name,pages}]:[];});
 if(!openings.length)throw new SourceReferenceFailure('page_open_no_opening',true);
 const setup=pageList(located.setup_pages,count,SETUP_PAGES).filter(page=>text.get(page)?.trim());
 // §258.2: each page read is one excerpt, whole up to the packet's bound.
 const read=[...new Set([...setup,...openings.flatMap(opening=>opening.pages)])].sort((a,b)=>a-b);
 const excerpts:ReferenceExcerpt[]=read.map((page,index)=>{const body=text.get(page)!.slice(0,PAGE_CHARS);return {id:`page-${index+1}`,page,start:0,end:body.length,text:body};});
 const spanOf=(page:number)=>excerpts.find(span=>span.page===page)!;
 const guided=await ask(input,cwd,'guide',GUIDE_INSTRUCTION,{play_language:input.language,pages:excerpts.map(span=>({page:span.page,text:span.text}))});
 const publicFields={} as PublicGuidance;
 for(const field of PUBLIC_GUIDANCE_FIELDS){
  const value=guided[field],body=typeof value?.text==='string'?Array.from(value.text.trim()).slice(0,FIELD_CHARS).join(''):'',refs=pageList(value?.pages,count,12).filter(page=>read.includes(page));
  publicFields[field]=body&&refs.length?{status:'value',text:body,source_refs:refs.map(page=>({page}))}:{status:'unavailable',text:'',source_refs:[]};
 }
 validatePublicGuidance(publicFields,count);
 const guide=PUBLIC_GUIDANCE_FIELDS.map(field=>publicFields[field].text).filter(Boolean).join('\n\n');
 if(!guide.trim())throw new SourceReferenceFailure('page_open_empty_guide',true);
 const eraText=typeof guided.era_text==='string'?guided.era_text.trim().slice(0,200):'',eraSpan=eraText?excerpts.find(span=>span.text.includes(eraText)):undefined;
 const opening=openings.map(row=>spanOf(row.pages[0]).id),setupIds=setup.map(page=>spanOf(page).id);
 const fields=Object.fromEntries(REFERENCE_FIELDS.map(key=>[key,key==='opening'?[...new Set(opening)]:key==='era'&&eraSpan?[eraSpan.id]:setupIds])) as SourceReferencePacket['fields'];
 const packet:SourceReferencePacket={protocol:SOURCE_REFERENCE_PROTOCOL,source_sha256:source.file_sha256,extraction_version:lines.extraction_version,
  purpose:'guidance',question:'Where play begins and what the players know before it',excerpts,fields,
  entries:openings.map((row,index)=>({id:`scene-source-entry-${index+1}`,name:row.name,page:row.pages[0],excerpt_id:spanOf(row.pages[0]).id,
   ...(eraSpan?{era_text:eraText,era_span:eraSpan.id}:{})})),partial:true,visual_coverage:'unassessed',unavailable_pages:[]};
 validateReferencePacket(packet,count,source.file_sha256);
 const task={protocol:'page-open-v1',module_id:input.moduleId,play_language:input.language,focus:input.focus??'',openings,setup_pages:setup};
 const taskBytes=JSON.stringify(task)+'\n',packetBytes=JSON.stringify(packet);
 await writeFile(join(cwd,'task.json'),taskBytes);await writeFile(join(cwd,'source-reference.json'),packetBytes);await writeFile(join(cwd,'reference-guidance.txt'),guide);
 const receipt={protocol:SOURCE_REFERENCE_PROTOCOL,kind:'guidance',source_sha256:source.file_sha256,task_sha256:digest(taskBytes),packet_sha256:digest(packetBytes),
  text_sha256:digest(guide),checks_policy:PAGE_TEXT_POLICY,public_fields:publicFields,
  // §258.3: every page of each opening, so the Keeper's handoff carries the whole opening and not only its first page.
  opening_pages:Object.fromEntries(openings.map((row,index)=>[`scene-source-entry-${index+1}`,row.pages]))};
 await writeFile(join(cwd,'source-reference-complete.json'),JSON.stringify(receipt));
 const ms=Date.now()-began;input.record?.({lane:'page-open',event:'complete',module_id:input.moduleId,ms,openings:openings.map(row=>({name:row.name,pages:row.pages})),setup_pages:setup});
 return {packet,text:guide,workDir:cwd,receipt,ms};
}
