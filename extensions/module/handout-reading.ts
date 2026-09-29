/**
 * Reading a pictured handout in the player's language (contract §155).
 *
 * A handout cropped from a PDF page reaches the player as pixels, and the graph keeps no text for it
 * (§152.3). Two steps make it readable, and they are two steps because they need two things:
 *
 * 1. **Transcribe, once per image.** A tool-enabled Pi child on the table's model (the reader axis:
 *    it looks at a picture, so it needs image input) writes the printed text as it stands, in the
 *    source language, in reading order, with a role per block. It is keyed by the image's sha256, so
 *    it serves every campaign and every play language, and it is never written into the graph, a turn
 *    or a Keeper prompt.
 * 2. **Project it, as one document.** The composed title and body go through the same keep/translate
 *    protocol as a Mod document (`projectReading`), under their own instruction file, on the
 *    presentation lane's model. "A newspaper column translated a line at a time stops being a
 *    newspaper column."
 *
 * Nothing here decides what language a text is in. `keep` is the model's answer for the whole
 * document; the caller only compares the projected text with the source, byte for byte.
 */
import {createHash, randomUUID} from 'node:crypto';
import {appendFile, mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runtimeEntryUrl} from '../../runtime/deployment.mjs';
import {PLAY_LANGUAGE_TAG} from '../../runtime/ui-words.ts';
import {projectReading} from '../mods/document-presentation.ts';
import {coded} from '../ui/errors.ts';
import {reasoned,readerFailureReason} from './reader.ts';
import {runPresentationAttempt} from './presentation-attempt.ts';
import type {ReaderOutcome,ReaderRequest} from './reader.ts';

type Row=Record<string,any>;
/** The closed set of things a printed block can be. A vocabulary of the format, not of any language. */
export const TRANSCRIPTION_ROLES=['headline','deck','byline','dateline','body','caption','label','other'] as const;
const MAX_BLOCKS=200;
const MAX_BLOCK_CHARS=8000;
const MAX_TOTAL_CHARS=48000;
/** A campaign id, checked before it is joined onto a path. */
const CAMPAIGN_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DIGEST=/^[a-f0-9]{64}$/;
/** What the four raster signatures the host accepts are called on disk; the child opens the file by this name. */
const EXTENSIONS:Readonly<Record<string,string>>=Object.freeze({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'});
/** How many known names one request may carry, and the shortest source string that counts as a name. */
const MAX_KNOWN_NAMES=120;
const MIN_NAME_LENGTH=2;

export type TranscriptionBlock={role:typeof TRANSCRIPTION_ROLES[number];text:string};
export type Transcription={blocks:TranscriptionBlock[]};
export type HandoutImage={path:string;media_type:string;sha256:string};
type Step={model?:string;thinking?:string};
export type HandoutReadingOptions={
  home:string;contentRoot:string;campaign:string;play_language:string;image:HandoutImage;
  /** Whether the table's model takes image input; a cached transcription needs none. */
  vision:boolean;transcribeWith:Step;projectWith:Step;
  signal?:AbortSignal;owner?:object;
  runner:(request:ReaderRequest)=>Promise<ReaderOutcome>;
};
export type HandoutReading={title:string;text:string;keep:boolean;digest:string};

/** The shape the child's checker and the host both hold; one function, so they cannot disagree. */
export function validateTranscription(value:any):Transcription {
  const fail=(reason:string)=>coded('preparation_failed',`Invalid handout transcription: ${reason}`);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='blocks'))throw fail('write one object with only a "blocks" array');
  const blocks=value.blocks;
  if(!Array.isArray(blocks)||!blocks.length||blocks.length>MAX_BLOCKS)throw fail(`"blocks" must hold 1 to ${MAX_BLOCKS} blocks`);
  let total=0;
  blocks.forEach((block:any,index:number)=>{
    if(!block||typeof block!=='object'||Array.isArray(block)||Object.keys(block).some(key=>key!=='role'&&key!=='text'))throw fail(`block ${index} must be {"role","text"} only`);
    if(!(TRANSCRIPTION_ROLES as readonly string[]).includes(block.role))throw fail(`block ${index} role must be one of ${TRANSCRIPTION_ROLES.join(', ')}`);
    if(typeof block.text!=='string'||!block.text.trim())throw fail(`block ${index} text must be non-empty printed text`);
    if(Array.from(block.text).length>MAX_BLOCK_CHARS)throw fail(`block ${index} is longer than ${MAX_BLOCK_CHARS} characters; split it into paragraphs`);
    total+=block.text.length;
  });
  if(total>MAX_TOTAL_CHARS)throw fail(`the blocks hold more than ${MAX_TOTAL_CHARS} characters`);
  return {blocks:blocks.map((block:any)=>({role:block.role,text:block.text}))};
}

/**
 * The one title and one body the projection is asked for: the first headline (else the first block)
 * is the title, and every other block follows in reading order, separated by a blank line.
 */
export function composeTranscription(transcription:Transcription):{title:string;text:string} {
  const blocks=transcription.blocks;
  const at=Math.max(0,blocks.findIndex(block=>block.role==='headline'));
  return {title:blocks[at].text.trim(),text:blocks.filter((_,index)=>index!==at).map(block=>block.text.trim()).join('\n\n')};
}

/**
 * The names the table already calls things: every saved projection of this campaign for this tag
 * whose source string occurs in the transcription. The saved files are the lanes' own output
 * (`setup/presentations/<kind>-<tag>.json`, §23), so a person or place the table met already carries
 * the name it was shown under. It is data lookup, not classification: a name is included because its
 * exact source string is in the text, and the model still decides what refers to what.
 */
export async function knownNames(home:string,campaign:string,tag:string,text:string):Promise<Record<string,string>> {
  if(!CAMPAIGN_NAME.test(campaign)||!PLAY_LANGUAGE_TAG.test(tag))return {};
  const folder=join(home,'.coc/campaigns',campaign,'setup/presentations'),found=new Map<string,string>();
  for(const file of (await readdir(folder).catch(()=>[] as string[])).sort()) {
    // `<revision>-<tag>.json` is a character draft's projection, not a vocabulary.
    if(!file.endsWith(`-${tag}.json`)||/^\d+-/.test(file))continue;
    let saved:any;
    try{saved=JSON.parse(await readFile(join(folder,file),'utf8'));}catch{continue;}
    if(saved?.play_language!==tag||!saved.texts||typeof saved.texts!=='object'||Array.isArray(saved.texts))continue;
    for(const [source,shown] of Object.entries(saved.texts as Row))
      if(typeof shown==='string'&&shown.trim()&&Array.from(source).length>=MIN_NAME_LENGTH&&text.includes(source)&&!found.has(source))found.set(source,shown);
  }
  return Object.fromEntries([...found].sort((a,b)=>b[0].length-a[0].length||a[0].localeCompare(b[0])).slice(0,MAX_KNOWN_NAMES));
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
/** Every model round of both steps passes here, so the telemetry row exists whatever the step does with the outcome. */
function measured(options:HandoutReadingOptions,phase:'transcription'|'projection',step:Step) {
  let round=0;
  return async (request:ReaderRequest):Promise<ReaderOutcome>=>{
    round+=1;
    const outcome=await options.runner(request);
    await record(options.home,{phase,sha256:options.image.sha256,campaign:options.campaign,play_language:options.play_language,
      model:step.model??null,thinking:step.thinking??null,round,ms:outcome.ms,ok:outcome.ok,timed_out:outcome.timedOut,
      input_tokens:outcome.usage?.inputTokens??null,output_tokens:outcome.usage?.outputTokens??null,
      cost_usd:outcome.usage?.costUsd??null,actions:outcome.usage?.actions??null});
    return outcome;
  };
}

const inFlight=new Map<string,Promise<Transcription>>();
/**
 * The printed text of one image, from the cache or from one reader run.
 *
 * The cache is the image's own: `<home>/.coc/handout-readings/<sha256>/transcription-<instruction>.json`.
 * A text-only table model reaches here only when the cache is empty, and is refused before a child
 * starts: a child that `read`s a picture it cannot see writes plausible text from nothing.
 */
export async function transcribeHandout(options:HandoutReadingOptions,bytes:Buffer):Promise<Transcription> {
  const {home,image}=options;
  const prompt=join(options.contentRoot,'setup/handout-transcription.md');
  const instructions=await readFile(prompt,'utf8');
  const folder=join(home,'.coc/handout-readings',image.sha256);
  const cached=join(folder,`transcription-${digestOf(instructions)}.json`);
  try{return validateTranscription({blocks:JSON.parse(await readFile(cached,'utf8')).blocks});}
  catch{ /* A missing or invalid cache entry is read again from the same picture. */ }
  if(!options.vision)throw coded('model_without_images','The chosen model cannot read images');
  const pending=inFlight.get(cached);
  if(pending)return pending;
  const task=(async()=>{
    const attempt=join(folder,'attempts',randomUUID());
    const name=`image.${EXTENSIONS[image.media_type]}`;
    let result:Transcription|undefined,failure:unknown;
    await mkdir(attempt,{recursive:true});
    await writeFile(join(attempt,name),bytes);
    await runPresentationAttempt({
      attempt,outputFile:'transcription.json',
      checkSource:`import {readFileSync} from "node:fs";
import {validateTranscription} from ${JSON.stringify(runtimeEntryUrl('handoutReading',import.meta.url))};
validateTranscription(JSON.parse(readFileSync("transcription.json","utf8")));
console.log("ok");
`,
      systemPrompt:prompt,model:options.transcribeWith.model,thinking:options.transcribeWith.thinking,signal:options.signal,
      runner:measured(options,'transcription',options.transcribeWith),
      prepareRound:async round=>`Open ${name} with the read tool so you actually see the picture, then write the text it prints to transcription.json as {"blocks":[{"role","text"}]}. Run node check.mjs and repair every error.`
        +(round>1?' Read findings.json and repair the retained result.':''),
      recordOutcome:async(outcome,round)=>{await writeFile(join(attempt,`run-${round}.json`),JSON.stringify(outcome));},
      failure:(outcome,aborted)=>coded(aborted?'presentation_timeout':'preparation_failed',
        reasoned('Handout transcription could not be prepared',aborted?undefined:readerFailureReason(outcome))),
      invalidOutput:error=>{failure=error;return {error:String(error)};},
      accept:value=>{
        try{result=validateTranscription(value);return {done:true};}
        catch(error){failure=error;return {done:false,findings:{error:String(error)}};}
      },
    });
    if(!result)throw failure??coded('preparation_failed','Handout transcription could not be validated');
    await writeAtomic(cached,{sha256:image.sha256,media_type:image.media_type,blocks:result.blocks});
    return result;
  })();
  inFlight.set(cached,task);
  try{return await task;}finally{inFlight.delete(cached);}
}

/**
 * The reading version of one delivered image in one play language (contract §155.3).
 *
 * The bytes are read here again and their digest must be the one the host verified, so a file
 * replaced between the host's gate and this worker's read is refused rather than transcribed.
 */
export async function readHandout(options:HandoutReadingOptions):Promise<HandoutReading> {
  const {image}=options;
  if(!PLAY_LANGUAGE_TAG.test(options.play_language)||!CAMPAIGN_NAME.test(options.campaign)||!DIGEST.test(image?.sha256??'')
    ||!EXTENSIONS[image.media_type]||typeof image.path!=='string')
    throw coded('invalid_params','Invalid handout reading request');
  const bytes=await readFile(image.path).catch(()=>{throw coded('handout_not_available','The handout image cannot be read');});
  if(createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw coded('handout_not_available','The handout image changed after it was checked');
  const source=composeTranscription(await transcribeHandout(options,bytes));
  const names=await knownNames(options.home,options.campaign,options.play_language,`${source.title}\n${source.text}`);
  const projected=await projectReading({home:options.home,...(options.owner?{owner:options.owner}:{}),model:options.projectWith.model,
    thinking:options.projectWith.thinking,signal:options.signal,runner:measured(options,'projection',options.projectWith)},
    {promptPath:join(options.contentRoot,'setup/handout-reading.md'),cacheRoot:`.coc/handout-readings/${image.sha256}/readings`,
      ...(Object.keys(names).length?{extra:{known_names:names}}:{})},
    source.title,source.text,options.play_language);
  return {title:projected.title,text:projected.text,keep:projected.title===source.title&&projected.text===source.text,digest:image.sha256};
}
