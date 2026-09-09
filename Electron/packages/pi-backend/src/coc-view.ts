import { readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HistoryEntry } from '@pipi/host-api';

export type CocBinding = {campaign:string; home:string; play_language:string; mode?:string};
export type CocColdRuntimeOptions = {contentRoot?:string; nodeExecutable?:string; backend?:'python'|'typescript';
  kernelEntrypoint?:string; hostEntrypoint?:string};
type ColdRuntime = {openKernel(options:{timeoutMs:number}):{call(method:string,params:Record<string,unknown>):Promise<unknown>};
  close():Promise<void>};
function binding(value:any): CocBinding | undefined {
  return value && typeof value.campaign === 'string' && typeof value.home === 'string'
    && ['zh-Hans','en'].includes(value.play_language) ? value : undefined;
}
export async function readCocBinding(sessionPath:string): Promise<CocBinding | undefined> {
  let found:CocBinding|undefined;
  const lines=createInterface({input:createReadStream(sessionPath),crlfDelay:Infinity});
  for await(const line of lines) {
    try {const row=JSON.parse(line);if(row.type==='custom'&&row.customType==='coc-session')found=binding(row.data)??found;} catch {}
  }
  if(found)return found;
  try {return binding(JSON.parse(await readFile(sessionPath+'.coc.json','utf8')));} catch {return undefined;}
}
const DRAFT_PROJECTION=/^(\d+)-(.+)\.json$/;
/**
 * The saved text projection of every draft revision in this campaign, by revision.
 *
 * The pipeline already writes each card's player-facing text to disk, but the transcript row
 * carries only the sheet, so the renderer had to go and fetch the text every time it mounted and
 * showed its loading ellipsis until a model job answered — after a scroll, a session switch, the
 * setup-to-play handoff or a restart, on a card that had been complete for hours. Attaching it
 * here is the same rule the rest of this file follows: what the player already has reaches the
 * renderer with the row, and the fetch is left for the one card that genuinely has no text yet.
 */
export async function draftPresentations(binding?:CocBinding): Promise<Map<number,Record<string,unknown>>> {
  const found=new Map<number,Record<string,unknown>>();
  if(!binding)return found;
  const folder=join(binding.home,'.coc/campaigns',binding.campaign,'setup/presentations');
  let names:string[];
  try {names=await readdir(folder);} catch {return found; /* nothing has been projected yet */}
  for(const name of names) {
    const match=DRAFT_PROJECTION.exec(name);
    if(!match||match[2]!==binding.play_language)continue;
    try {
      const saved=JSON.parse(await readFile(join(folder,name),'utf8'));
      if(saved?.play_language===binding.play_language&&saved.texts&&typeof saved.texts==='object'&&!Array.isArray(saved.texts))
        found.set(Number(match[1]),saved);
    } catch { /* a half-written projection is simply not attached */ }
  }
  return found;
}
export function mechanicsEntry(row:any, language?:string, presentations?:ReadonlyMap<number,Record<string,unknown>>): HistoryEntry | undefined {
  if(row?.type==='custom'&&row.customType==='coc-character-draft'&&row.data?.sheet) {
    const saved=presentations?.get(Number(row.data.revision));
    return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
      presentation:{renderer:'coc-character-draft',details:saved?{...row.data,presentation:saved}:row.data}};
  }
  if(row?.type==='custom'&&row.customType==='coc-choice'&&row.data?.kind==='story')return {id:row.id,role:'assistant',content:row.data.prompt||'',timestamp:Date.parse(row.timestamp)||0};
  if(row?.type==='custom' && row.customType==='coc-choice' && Array.isArray(row.data?.options)) {
    return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
      presentation:{renderer:'coc-choice',details:row.data}};
  }
  if(row?.type!=='custom'||row.customType!=='coc-mechanics'||!Array.isArray(row.data?.mechanics))return;
  const mechanics=row.data.mechanics.filter((x:any)=>x&&typeof x==='object'&&x.visibility!=='keeper');
  if(!mechanics.length)return;
  // §16.6: the delivery with its markers still in it, when the Keeper placed any. It rides with the
  // rows because one component has to own both to draw a row where the sentence is.
  const marked=typeof row.data.marked_text==='string'&&row.data.marked_text?{marked_text:row.data.marked_text}:{};
  return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
    presentation:{renderer:'coc-mechanics',details:{turn:row.data.turn,mechanics,labels:row.data.labels,...marked,play_language:row.data.play_language??language??'en'}}};
}
export async function readColdSheet(repo:string, context:CocBinding, previewRevision?:number, env:NodeJS.ProcessEnv=process.env, runtimeOptions:CocColdRuntimeOptions={}):Promise<unknown> {
  return callColdKernel(repo, context.home, previewRevision===undefined?'table.view':'setup.previewed', {campaign:context.campaign,...(previewRevision===undefined?{}:{revision:previewRevision})}, env, runtimeOptions);
}
/** The words a sheet's objects carry, counted by the presenter itself: one definition, read from the built lane. */
export async function possessionWords(repo:string, view:unknown, entrypoint='build/extensions/module/character-presentation.mjs'):Promise<string[]> {
  const lane=await import(pathToFileURL(resolve(repo,entrypoint)).href);
  return lane.possessionTexts(view);
}
/** A campaign's saved possession vocabulary, and what of `wanted` it still lacks. */
export async function possessionProjection(context:CocBinding, wanted:string[]):Promise<{texts:Record<string,string>;missing:string[]}> {
  let texts:Record<string,string>={};
  try {
    const saved=JSON.parse(await readFile(join(context.home,'.coc/campaigns',context.campaign,'setup/presentations',`possessions-${context.play_language}.json`),'utf8'));
    if(saved?.play_language===context.play_language&&saved.texts&&typeof saved.texts==='object'&&!Array.isArray(saved.texts))texts=saved.texts;
  } catch { /* An unprojected campaign reads with its canonical words. */ }
  return {texts,missing:wanted.filter(text=>typeof texts[text]!=='string'||!texts[text].trim())};
}
/** Host management can work before a Keeper exists; this never opens a fictional turn. */
export async function callColdKernel(repo:string, home:string, method:string, params:Record<string,unknown>, env:NodeJS.ProcessEnv=process.env, runtimeOptions:CocColdRuntimeOptions={}):Promise<unknown> {
  const {hostEntrypoint, ...options}=runtimeOptions;
  const resourceRoot=resolve(repo), payload={...params};
  const host={...options,resourceRoot,env:{...env,PYTHONDONTWRITEBYTECODE:'1'}};
  const module=await import(pathToFileURL(resolve(resourceRoot,hostEntrypoint??'build/runtime/host.mjs')).href);
  const owner:ColdRuntime=module.createRuntime({owner:'check',home,
    ...(typeof payload.campaign==='string'?{campaign:payload.campaign}:{})},host);
  try {return await owner.openKernel({timeoutMs:15000}).call(method,payload);} finally {await owner.close();}
}
