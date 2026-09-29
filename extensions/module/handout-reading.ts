/**
 * Reading a pictured handout in the player's language (contract §155).
 *
 * A handout cropped from a PDF page reaches the player as pixels, and the graph keeps no text for it
 * (§152.3). One streamed vision completion makes it readable: a Pi child with no tools is shown the
 * picture (an `@file` attachment, so no `read` tool is needed) and writes the reading version in the
 * play language, in order, and the host relays what it has written so far while it writes. The player
 * watches the text arrive instead of waiting for a whole document.
 *
 * This is a zero-tool single completion, which the project reserves for work that is short and on the
 * critical path (Agents.md, the section on text work needing a tool-enabled Pi agent); the owner authorized this lane on
 * 2026-09-29 (contract §155.9). A tool-enabled reader writes its answer in one file write and cannot
 * stream; that is the whole reason for the exception.
 *
 * Nothing here decides what language a picture is in. The model answers `keep` (the picture is
 * already in the play language) or `translate` on the first line, and the host reads that word.
 */
import {createHash,randomUUID} from 'node:crypto';
import {appendFile,mkdir,readFile,readdir,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PLAY_LANGUAGE_TAG} from '../../runtime/ui-words.ts';
import {coded} from '../ui/errors.ts';
import {reasoned,readerFailureReason} from './reader.ts';
import type {ReaderOutcome,ReaderRequest} from './reader.ts';

type Row=Record<string,any>;
/** A campaign id, checked before it is joined onto a path. */
const CAMPAIGN_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DIGEST=/^[a-f0-9]{64}$/;
/** What the four raster signatures the host accepts are called on disk; the child is handed the file by this name. */
const EXTENSIONS:Readonly<Record<string,string>>=Object.freeze({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'});
/** The longest title and body a reading may have: the Mod document reading's own limits. */
const MAX_TITLE_CHARS=640;
const MAX_BODY_CHARS=64000;
/** How many known names one request may carry, and how many characters of them the brief may hold. */
const MAX_KNOWN_NAMES=150;
const MAX_KNOWN_NAME_CHARS=6000;
const MIN_NAME_LENGTH=2;
/** How often a partial reading is reported, at most: a burst of small deltas is one report. */
const PROGRESS_INTERVAL_MS=150;
const ROUND_TIMEOUT_MS=120000;

export type ReadingSoFar={title:string;text:string};
export type HandoutImage={path:string;media_type:string;sha256:string};
export type HandoutReadingOptions={
  home:string;contentRoot:string;campaign:string;play_language:string;image:HandoutImage;
  /** Whether the table's model takes image input; a cached reading needs none. */
  vision:boolean;model?:string;thinking?:string;
  signal?:AbortSignal;
  runner:(request:ReaderRequest)=>Promise<ReaderOutcome>;
  /** Called with the reading as far as it is written, at most every PROGRESS_INTERVAL_MS, and once at the end. */
  onProgress?:(partial:ReadingSoFar)=>void;
};
export type HandoutReading={title:string;text:string;keep:boolean;digest:string};
export type ParsedReading={mode:'keep'|'translate'|undefined;invalid:boolean;title:string;text:string};

/**
 * The reading as far as the model has written it.
 *
 * The first line is the model's verdict (`keep` or `translate`), the second is the title, and the
 * body follows after a blank line. Called on every growing prefix, so a line that is not finished yet
 * is never mistaken for a finished one: the mode is unknown until its line ends (or the reply does).
 */
export function parseReading(written:string,done:boolean):ParsedReading {
  const text=written.replace(/^\s+/,'');
  const end=text.indexOf('\n');
  if(end<0&&!done)return {mode:undefined,invalid:false,title:'',text:''};
  const first=(end<0?text:text.slice(0,end)).trim().toLowerCase();
  if(first!=='keep'&&first!=='translate')return {mode:undefined,invalid:true,title:'',text:''};
  if(first==='keep')return {mode:'keep',invalid:false,title:'',text:''};
  const rest=end<0?'':text.slice(end+1).replace(/^\s*\n/,'');
  const stop=rest.indexOf('\n');
  const title=(stop<0?rest:rest.slice(0,stop)).trim();
  const body=stop<0?'':rest.slice(stop+1).replace(/^\n+/,'');
  return {mode:'translate',invalid:false,title,text:done?body.trimEnd():body};
}

/** The finished reading, or the reason it cannot be one. */
export function validateReading(written:string):{keep:boolean;title:string;text:string} {
  const parsed=parseReading(written,true);
  const fail=(reason:string)=>coded('preparation_failed',`Invalid handout reading: ${reason}`);
  if(parsed.invalid||!parsed.mode)throw fail('the first line must be keep or translate');
  if(parsed.mode==='keep')return {keep:true,title:'',text:''};
  if(!parsed.title)throw fail('a translated reading needs a title line');
  if(Array.from(parsed.title).length>MAX_TITLE_CHARS)throw fail(`the title is longer than ${MAX_TITLE_CHARS} characters`);
  if(Array.from(parsed.text).length>MAX_BODY_CHARS)throw fail(`the body is longer than ${MAX_BODY_CHARS} characters`);
  return {keep:false,title:parsed.title,text:parsed.text};
}

/**
 * The names the table already calls things: the saved projections of this campaign for this tag
 * (`setup/presentations/<kind>-<tag>.json`, §23), as `source -> shown` pairs. They are the lanes' own
 * output, so a person or place the table met carries the name it was shown under. It is a lookup
 * of data the product already holds; the model decides which of them the picture refers to.
 */
export async function knownNames(home:string,campaign:string,tag:string):Promise<Record<string,string>> {
  if(!CAMPAIGN_NAME.test(campaign)||!PLAY_LANGUAGE_TAG.test(tag))return {};
  const folder=join(home,'.coc/campaigns',campaign,'setup/presentations'),found=new Map<string,string>();
  for(const file of (await readdir(folder).catch(()=>[] as string[])).sort()) {
    // `<revision>-<tag>.json` is a character draft's projection, not a vocabulary.
    if(!file.endsWith(`-${tag}.json`)||/^\d+-/.test(file))continue;
    let saved:any;
    try{saved=JSON.parse(await readFile(join(folder,file),'utf8'));}catch{continue;}
    if(saved?.play_language!==tag||!saved.texts||typeof saved.texts!=='object'||Array.isArray(saved.texts))continue;
    for(const [source,shown] of Object.entries(saved.texts as Row))
      if(typeof shown==='string'&&shown.trim()&&shown!==source&&Array.from(source).length>=MIN_NAME_LENGTH&&!found.has(source))found.set(source,shown);
  }
  const kept:Record<string,string>={};let chars=0;
  for(const [source,shown] of found) {
    if(Object.keys(kept).length>=MAX_KNOWN_NAMES||chars+source.length+shown.length>MAX_KNOWN_NAME_CHARS)break;
    kept[source]=shown;chars+=source.length+shown.length;
  }
  return kept;
}

const digestOf=(text:string)=>createHash('sha256').update(text).digest('hex').slice(0,12);
async function writeAtomic(path:string,value:unknown) {
  await mkdir(join(path,'..'),{recursive:true});
  const temporary=`${path}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify(value));await rename(temporary,path);
}
/** Cost evidence, one row per model round (§155.4): what ran, on what, for how long, at what price. */
async function record(home:string,row:Row):Promise<void> {
  try{
    await mkdir(join(home,'.coc/handout-readings'),{recursive:true});
    await appendFile(join(home,'.coc/handout-readings/telemetry.jsonl'),JSON.stringify({at:new Date().toISOString(),...row})+'\n');
  }catch{ /* Evidence is best-effort: a full disk must not turn a finished reading into a failure. */ }
}
/** The text one assistant message carries, whatever else it holds. */
function textOf(message:any):string {
  const content=Array.isArray(message?.content)?message.content:[];
  return content.filter((block:any)=>block?.type==='text'&&typeof block.text==='string').map((block:any)=>block.text).join('');
}

const inFlight=new Map<string,Promise<HandoutReading>>();
/**
 * The reading version of one delivered image in one play language (contract §155.3).
 *
 * The bytes are read here again and their digest must be the one the host verified, so a file
 * replaced between the host's gate and this worker's read is refused rather than read. The cache is
 * the image's own -- `<home>/.coc/handout-readings/<sha256>/readings/<tag>-<instruction>.json`, keyed
 * by digest, tag and the instruction file's bytes -- and a cached reading needs no image input.
 */
export async function readHandout(options:HandoutReadingOptions):Promise<HandoutReading> {
  const {image}=options;
  if(!PLAY_LANGUAGE_TAG.test(options.play_language)||!CAMPAIGN_NAME.test(options.campaign)||!DIGEST.test(image?.sha256??'')
    ||!EXTENSIONS[image.media_type]||typeof image.path!=='string')
    throw coded('invalid_params','Invalid handout reading request');
  const bytes=await readFile(image.path).catch(()=>{throw coded('handout_not_available','The handout image cannot be read');});
  if(createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw coded('handout_not_available','The handout image changed after it was checked');
  const prompt=join(options.contentRoot,'setup/handout-reading.md');
  const instructions=await readFile(prompt,'utf8');
  const cached=join(options.home,'.coc/handout-readings',image.sha256,'readings',`${options.play_language}-${digestOf(instructions)}.json`);
  try{
    const saved=JSON.parse(await readFile(cached,'utf8'));
    if(typeof saved?.keep==='boolean'&&typeof saved.title==='string'&&typeof saved.text==='string'){
      const reading={keep:saved.keep,title:saved.title,text:saved.text};
      options.onProgress?.({title:reading.title,text:reading.text});
      return {...reading,digest:image.sha256};
    }
  }catch{ /* A missing or invalid cache entry is read again from the same picture. */ }
  // A child that is handed a picture it cannot see writes plausible text from nothing.
  if(!options.vision)throw coded('model_without_images','The chosen model cannot read images');
  const pending=inFlight.get(cached);
  if(pending)return pending;
  const task=(async():Promise<HandoutReading>=>{
    const attempt=join(options.home,'.coc/handout-readings',image.sha256,'attempts',randomUUID());
    const name=`image.${EXTENSIONS[image.media_type]}`;
    await mkdir(attempt,{recursive:true});
    await writeFile(join(attempt,name),bytes);
    const names=await knownNames(options.home,options.campaign,options.play_language);
    const brief=[`Play language: ${options.play_language}`,
      ...(Object.keys(names).length?['','Names this table already uses (as the source writes them -> as the table calls them):',
        ...Object.entries(names).map(([source,shown])=>`- ${source} -> ${shown}`)]:[]),
      '','The picture is attached. Write the reading version now, in the format the instructions give.'].join('\n');
    let written='',finalText:string|undefined,lastReport=0,reported='';
    const report=(force:boolean)=>{
      const now=Date.now();
      if(!options.onProgress||!force&&now-lastReport<PROGRESS_INTERVAL_MS)return;
      const parsed=parseReading(written,false);
      if(parsed.mode!=='translate')return;
      const next=JSON.stringify([parsed.title,parsed.text]);
      // Never report less than was already reported: the reading only grows.
      if(next===reported)return;
      lastReport=now;reported=next;options.onProgress({title:parsed.title,text:parsed.text});
    };
    const began=Date.now();
    const outcome=await options.runner({cwd:attempt,systemPrompt:prompt,model:options.model,thinking:options.thinking,signal:options.signal,
      eventLog:join(attempt,'events.jsonl'),timeoutMs:ROUND_TIMEOUT_MS,tools:'',attachments:[name],brief,
      onEvent:event=>{
        if(event.type==='message_start'&&event.message?.role==='assistant'){written='';return;}
        if(event.type==='message_update'&&event.assistantMessageEvent?.type==='text_delta'&&typeof event.assistantMessageEvent.delta==='string'){
          written+=event.assistantMessageEvent.delta;report(false);
        }
        if(event.type==='message_end'&&event.message?.role==='assistant'){
          const text=textOf(event.message);if(text)finalText=text;
        }
      }});
    await writeFile(join(attempt,'run.json'),JSON.stringify(outcome));
    await record(options.home,{phase:'reading',sha256:image.sha256,campaign:options.campaign,play_language:options.play_language,
      model:options.model??null,thinking:options.thinking??null,ms:outcome.ms??Date.now()-began,ok:outcome.ok,timed_out:outcome.timedOut,
      input_tokens:outcome.usage?.inputTokens??null,output_tokens:outcome.usage?.outputTokens??null,
      cost_usd:outcome.usage?.costUsd??null,actions:outcome.usage?.actions??null});
    if(!outcome.ok||options.signal?.aborted)
      throw coded(options.signal?.aborted||outcome.timedOut?'presentation_timeout':'preparation_failed',
        reasoned('Handout reading could not be prepared',options.signal?.aborted?undefined:readerFailureReason(outcome)));
    const reading=validateReading(finalText??written);
    written=finalText??written;report(true);
    await writeAtomic(cached,{sha256:image.sha256,play_language:options.play_language,...reading});
    return {...reading,digest:image.sha256};
  })();
  inFlight.set(cached,task);
  try{return await task;}finally{inFlight.delete(cached);}
}
