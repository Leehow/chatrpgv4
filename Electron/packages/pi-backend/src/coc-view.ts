import { readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HistoryEntry } from '@pipi/host-api';

export type CocBinding = {campaign:string; home:string; play_language:string; mode?:string};
export type CocColdRuntimeOptions = {contentRoot?:string; nodeExecutable?:string; backend?:'typescript';
  kernelEntrypoint?:string; hostEntrypoint?:string};
type ColdRuntime = {openKernel(options:{timeoutMs:number}):{call(method:string,params:Record<string,unknown>):Promise<unknown>};
  close():Promise<void>};
/**
 * A recorded binding, whatever play language it carries.
 *
 * The tag used to be checked against a pair written here, which made adding a language a code
 * change and made an unrecognised tag read as "no campaign at all" — the sheet went blank rather
 * than saying which campaign it could not draw. The closed set lives in `content/languages.json`
 * now and is applied where a tag is used, not where a file is read: `cocUiWords` resolves an
 * undeclared tag to the data default, and the campaign's own files stay keyed by whatever tag the
 * kernel wrote them under (contract §23).
 */
function binding(value:any): CocBinding | undefined {
  return value && typeof value.campaign === 'string' && typeof value.home === 'string'
    && typeof value.play_language === 'string' && !!value.play_language ? value : undefined;
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
/** The product's own captions for one play language: `{tag, words: {surface: {key: word}}}`. */
export type CocUiWords={tag:string; words:Record<string,Record<string,string>>};
/** What a card reads besides the kernel's answer: the chrome's words, and the campaign's own. */
export type CocHistoryWords={ui?:CocUiWords; lanes?:Record<string,string>};
/**
 * The content root a host reads its data from, resolved exactly as `runtime/host.ts` resolves it
 * for the kernel, so a packaged build and a source checkout read the same `languages.json`.
 */
export function cocContentRoot(repo:string, options:CocColdRuntimeOptions={}, env:NodeJS.ProcessEnv=process.env):string {
  return resolve(repo, options.contentRoot ?? env.PI_COC_CONTENT_ROOT ?? 'content');
}
const UI_WORDS=new Map<string,Promise<CocUiWords|undefined>>();
const UI_WORDS_LOADED=new Map<string,CocUiWords>();
function uiWordsKey(repo:string, entrypoint:string, contentRoot:string, tag:unknown):string {
  return JSON.stringify([repo,entrypoint,contentRoot,typeof tag==='string'?tag:null]);
}
/**
 * The words `content/ui/<tag>/*.json` holds for one play language, for the `ui` block every answer
 * a renderer draws from carries (contract §23).
 *
 * Loaded through the emitted runtime entry the way `laneWords` loads the presenter, because this
 * package compiles with `rootDir: src` and cannot import the repository's own modules. They are
 * data that ships with the build, so one read per content root and tag is kept for the life of the
 * process. A build that has none is not a failed answer: the answer carries no `ui` at all, and a
 * renderer with no words draws its identifiers — a visible gap, never another language's words.
 */
export function cocUiWords(repo:string, contentRoot:string, tag:unknown, entrypoint='build/runtime/ui-words.mjs'):Promise<CocUiWords|undefined> {
  const key=uiWordsKey(repo,entrypoint,contentRoot,tag);
  let pending=UI_WORDS.get(key);
  if(!pending) {
    pending=(async()=>{
      const module=await import(pathToFileURL(resolve(repo,entrypoint)).href);
      const words=await module.loadUiWords(contentRoot,tag) as CocUiWords;
      UI_WORDS_LOADED.set(key,words);
      return words;
    })().catch(()=>{UI_WORDS.delete(key);return undefined; /* retried on the next answer */});
    UI_WORDS.set(key,pending);
  }
  return pending;
}
/**
 * The same words, for a caller that cannot wait: a live `entry_appended` is projected inside a
 * synchronous stream reader. It answers from what a previous load already resolved and starts one
 * otherwise, so the first card of a session may draw before its words and every later one has them.
 */
export function cocUiWordsLoaded(repo:string, contentRoot:string, tag:unknown, entrypoint='build/runtime/ui-words.mjs'):CocUiWords|undefined {
  const found=UI_WORDS_LOADED.get(uiWordsKey(repo,entrypoint,contentRoot,tag));
  if(!found)void cocUiWords(repo,contentRoot,tag,entrypoint);
  return found;
}
/**
 * `tag` when `content/languages.json` declares it, else the tag that file calls the default.
 *
 * The one place a host settles a play language. `undefined` means the build could not be read at
 * all, which a caller reports rather than papering over: a host that invented a tag here would put
 * a campaign on disk in a language nobody chose.
 */
export async function cocPlayLanguage(repo:string, contentRoot:string, tag:unknown, entrypoint='build/runtime/ui-words.mjs'):Promise<string|undefined> {
  try {
    const module=await import(pathToFileURL(resolve(repo,entrypoint)).href);
    return await module.playLanguageTag(contentRoot,tag) as string;
  } catch {return undefined;}
}
/** The lanes a campaign projects its own growing vocabulary into, in the order they merge. */
export const PRESENTATION_LANES=['standing','possessions','clues'] as const;
/**
 * Every word this campaign has already projected for its play language, merged in lane order.
 *
 * The sheet merges these under the kernel glossary on every read. A mechanics card that did not
 * would name the same object two ways in the same window — the roll would say `blood-pool` while
 * the sidebar says what the book calls it. One directory read per history page, not per row.
 */
export async function laneLabels(context?:CocBinding):Promise<Record<string,string>> {
  const merged:Record<string,string>={};
  if(!context)return merged;
  for(const lane of PRESENTATION_LANES) {
    try {
      const saved=JSON.parse(await readFile(join(context.home,'.coc/campaigns',context.campaign,'setup/presentations',`${lane}-${context.play_language}.json`),'utf8'));
      if(saved?.play_language===context.play_language&&saved.texts&&typeof saved.texts==='object'&&!Array.isArray(saved.texts))
        Object.assign(merged,saved.texts);
    } catch { /* an unprojected lane contributes no words */ }
  }
  return merged;
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
function wordTable(value:unknown):Record<string,string> {
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,string>:{};
}
/**
 * One transcript row as the card that draws it (contract §23).
 *
 * `words.lanes` is what the campaign has projected and `row.data.labels` is the kernel's own
 * glossary, so the kernel wins every collision: a projection may name a clue the book's way, never
 * rename a skill the rules already name. `words.ui` is the product's chrome for the binding's
 * language; without it a renderer draws identifiers rather than guessing a language.
 */
export function mechanicsEntry(row:any, language?:string, presentations?:ReadonlyMap<number,Record<string,unknown>>,
  words:CocHistoryWords={}): HistoryEntry | undefined {
  const lanes=wordTable(words.lanes), chrome=words.ui?{ui:words.ui}:{};
  if(row?.type==='custom'&&row.customType==='coc-character-draft'&&row.data?.sheet) {
    const saved=presentations?.get(Number(row.data.revision));
    const labels={...lanes,...wordTable(saved?.texts),...wordTable(row.data.labels)};
    return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
      presentation:{renderer:'coc-character-draft',details:{...row.data,labels,...(saved?{presentation:saved}:{}),...chrome}}};
  }
  if(row?.type==='custom'&&row.customType==='coc-choice'&&row.data?.kind==='story')return {id:row.id,role:'assistant',content:row.data.prompt||'',timestamp:Date.parse(row.timestamp)||0};
  if(row?.type==='custom' && row.customType==='coc-choice' && Array.isArray(row.data?.options)) {
    return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
      presentation:{renderer:'coc-choice',details:{...row.data,labels:{...lanes,...wordTable(row.data.labels)},...chrome}}};
  }
  if(row?.type!=='custom'||row.customType!=='coc-mechanics'||!Array.isArray(row.data?.mechanics))return;
  const mechanics=row.data.mechanics.filter((x:any)=>x&&typeof x==='object'&&x.visibility!=='keeper');
  if(!mechanics.length)return;
  // §16.6: the delivery with its markers still in it, when the Keeper placed any. It rides with the
  // rows because one component has to own both to draw a row where the sentence is.
  const marked=typeof row.data.marked_text==='string'&&row.data.marked_text?{marked_text:row.data.marked_text}:{};
  const tag=row.data.play_language??language;
  return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
    presentation:{renderer:'coc-mechanics',details:{turn:row.data.turn,mechanics,labels:{...lanes,...wordTable(row.data.labels)},
      ...marked,...(tag?{play_language:tag}:{}),...chrome}}};
}
export async function readColdSheet(repo:string, context:CocBinding, previewRevision?:number, env:NodeJS.ProcessEnv=process.env, runtimeOptions:CocColdRuntimeOptions={}):Promise<unknown> {
  return callColdKernel(repo, context.home, previewRevision===undefined?'table.view':'setup.previewed', {campaign:context.campaign,...(previewRevision===undefined?{}:{revision:previewRevision})}, env, runtimeOptions);
}
/**
 * The growing lanes a sheet read tops up, each named after its presentation file and pointing at
 * the presenter's own collector for its words: what an acquired object carries, and what a
 * discovered clue is called and says. The collector is the one definition of a lane's words,
 * read from the built presenter, so the host never counts a sheet's words a second way.
 */
export const SHEET_LANES={possessions:'possessionTexts',clues:'clueTexts'} as const;
export type SheetLane=keyof typeof SHEET_LANES;
export async function laneWords(repo:string, lane:SheetLane, view:unknown, entrypoint='build/extensions/module/character-presentation.mjs'):Promise<string[]> {
  const presenter=await import(pathToFileURL(resolve(repo,entrypoint)).href);
  return presenter[SHEET_LANES[lane]](view);
}
/** A campaign's saved vocabulary for one lane, and what of `wanted` it still lacks. */
export async function laneProjection(context:CocBinding, lane:SheetLane, wanted:string[]):Promise<{texts:Record<string,string>;missing:string[]}> {
  let texts:Record<string,string>={};
  try {
    const saved=JSON.parse(await readFile(join(context.home,'.coc/campaigns',context.campaign,'setup/presentations',`${lane}-${context.play_language}.json`),'utf8'));
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
