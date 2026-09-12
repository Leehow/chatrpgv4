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
 * than saying which campaign it could not draw. There is no set to check against at all now
 * (contract §23, 2026-09-09): a tag is settled by shape where it is used, never where a file is
 * read, and the campaign's own files stay keyed by whatever tag the kernel wrote them under.
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
/**
 * The product's own captions for one play language.
 *
 * `projected` says whether they are actually written in `tag`: false is the authored words standing
 * in while the projection lane runs, and it is what tells a panel that the language it asked for is
 * on its way (contract §23, 2026-09-09). `source` says which of the three orders answered.
 */
export type CocUiWords={tag:string; words:Record<string,Record<string,string>>;
  projected:boolean; source:'seed'|'cache'|'default'};
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
function uiWordsKey(repo:string, entrypoint:string, contentRoot:string, home:string, tag:unknown):string {
  return JSON.stringify([repo,entrypoint,contentRoot,home,typeof tag==='string'?tag:null]);
}
/**
 * The captions for one play language, for the `ui` block every answer a renderer draws from
 * carries (contract §23).
 *
 * Loaded through the emitted runtime entry the way `laneWords` loads the presenter, because this
 * package compiles with `rootDir: src` and cannot import the repository's own modules. The answer
 * resolves a shipped seed, then the home's cached projection, then the authored words with
 * `projected: false` — which is a complete answer the panel draws at once, and the host's cue to
 * start one background projection for the tag.
 *
 * Kept per content root, home and tag for the life of the process, so the sheet's own read does not
 * open the same files on every commit. `cocForgetUiWords` drops one entry when the lane has written
 * a cache the held answer predates. A build that has no words is not a failed answer: the answer
 * carries no `ui` at all, and a renderer with none draws its identifiers — a visible gap, never
 * another language's words.
 */
export function cocUiWords(repo:string, contentRoot:string, home:string, tag:unknown, entrypoint='build/runtime/ui-words.mjs'):Promise<CocUiWords|undefined> {
  const key=uiWordsKey(repo,entrypoint,contentRoot,home,tag);
  let pending=UI_WORDS.get(key);
  if(!pending) {
    pending=(async()=>{
      const module=await import(pathToFileURL(resolve(repo,entrypoint)).href);
      const words=await module.resolveUiWords({contentRoot,home,tag}) as CocUiWords;
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
export function cocUiWordsLoaded(repo:string, contentRoot:string, home:string, tag:unknown, entrypoint='build/runtime/ui-words.mjs'):CocUiWords|undefined {
  const found=UI_WORDS_LOADED.get(uiWordsKey(repo,entrypoint,contentRoot,home,tag));
  if(!found)void cocUiWords(repo,contentRoot,home,tag,entrypoint);
  return found;
}
/** Drop what is held for one tag, because the projection lane has just written its cache. */
export function cocForgetUiWords(repo:string, contentRoot:string, home:string, tag:unknown, entrypoint='build/runtime/ui-words.mjs'):void {
  const key=uiWordsKey(repo,entrypoint,contentRoot,home,tag);
  UI_WORDS.delete(key); UI_WORDS_LOADED.delete(key);
}
/**
 * `tag` when it has the shape of a play language, else the tag the data calls the default.
 *
 * The one place a host settles a play language. The tag set is open (contract §23, 2026-09-09), so
 * nothing here asks whether the build knows this tag. `undefined` means the build could not be read
 * at all, which a caller reports rather than papering over: a host that invented a tag here would
 * put a campaign on disk in a language nobody chose.
 */
export async function cocPlayLanguage(repo:string, contentRoot:string, tag:unknown, entrypoint='build/runtime/ui-words.mjs'):Promise<string|undefined> {
  try {
    const module=await import(pathToFileURL(resolve(repo,entrypoint)).href);
    return await module.playLanguageTag(contentRoot,tag) as string;
  } catch {return undefined;}
}
/**
 * The lanes a campaign projects its own growing vocabulary into, in the order they merge.
 *
 * `handouts` is here but not in `SHEET_LANES`, the way `standing` is: a sheet read cannot top it
 * up because a handout is on no panel and in no view. Its trigger is the delivery that hands the
 * document over.
 */
export const PRESENTATION_LANES=['standing','possessions','clues','languages','handouts','rules'] as const;
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
const LANE_LABELS=new Map<string,Promise<Record<string,string>>>();
const LANE_LABELS_LOADED=new Map<string,Record<string,string>>();
function laneLabelsKey(context:CocBinding):string {
  return JSON.stringify([context.home,context.campaign,context.play_language]);
}
/**
 * The same words, for a caller that cannot wait: a live `entry_appended` is drawn inside a
 * synchronous stream reader.
 *
 * Without them the delivery card draws a clue in the language the book was read in while the
 * sheet beside it already draws the player's -- the card's own words are the Keeper's, so only
 * the projected ones are missing, and the row that opens is exactly the module's sentence. It
 * answers from what a previous read resolved and starts one otherwise, so the words reach every
 * later card; `reloadLaneLabels` replaces the held answer when a lane has just written a new cache.
 */
export function laneLabelsLoaded(context?:CocBinding):Record<string,string> {
  if(!context)return {};
  const key=laneLabelsKey(context);
  const found=LANE_LABELS_LOADED.get(key);
  if(found)return found;
  if(!LANE_LABELS.has(key))
    LANE_LABELS.set(key,laneLabels(context).then(texts=>{LANE_LABELS_LOADED.set(key,texts);return texts;},
      ()=>{LANE_LABELS.delete(key);return {};}));
  return {};
}
/**
 * Read one campaign's lanes again and hold the answer, because a lane has just written its cache.
 *
 * It returns the words rather than only dropping the stale ones so the caller that started the
 * lane can redraw the card in the same turn: dropping alone would leave the synchronous reader
 * answering `{}` again until a later background read landed, which is the card drawing the
 * module's own language one more time.
 */
export async function reloadLaneLabels(context?:CocBinding):Promise<Record<string,string>> {
  if(!context)return {};
  const key=laneLabelsKey(context);
  LANE_LABELS.delete(key);LANE_LABELS_LOADED.delete(key);
  const texts=await laneLabels(context);
  LANE_LABELS.set(key,Promise.resolve(texts));LANE_LABELS_LOADED.set(key,texts);
  return texts;
}
/**
 * The player-facing words one delivery puts on the table, under the lane that projects each:
 * what a clue is called and what it says, and the document a handout opens into.
 *
 * Keyed by lane because the two are collected from different places — a clue from the table's own
 * view, a handout from the files `apply handout` wrote — and starting a lane that cannot collect
 * the word asked for leaves it missing for good, so every later delivery starts it again.
 *
 * For that reason a handout asks for `name` and not `label`: `label` is the Keeper's own word, in
 * the play language already, and it is nowhere in the files the handout lane reads. `name` is the
 * graph's display name, which is exactly the `# ` heading the kernel writes above the body.
 */
export function deliveryWords(entry:any):Record<string,string[]> {
  const rows=Array.isArray(entry?.data?.mechanics)?entry.data.mechanics:[];
  const wanted:Record<string,Set<string>>={clues:new Set(),handouts:new Set()};
  const keys:Record<string,string[]>={clues:['label','summary'],handouts:['name','text']};
  for(const row of rows) {
    if(!row||typeof row!=='object'||row.visibility==='keeper')continue;
    const lane=row.kind==='clue'?'clues':row.kind==='handout'?'handouts':null;
    if(!lane)continue;
    for(const key of keys[lane])
      if(typeof row[key]==='string'&&row[key].trim())wanted[lane].add(row[key]);
  }
  return Object.fromEntries(Object.entries(wanted).filter(([,set])=>set.size).map(([lane,set])=>[lane,[...set].sort()]));
}
/**
 * §16.5's middle visibility tier, enforced where the rows leave the backend.
 *
 * A `concealed` roll is one the player declared and the rules keep the die for (CoC 7e Psychology:
 * seeing the failure is what tells them the read is unreliable, which is the whole point of the
 * secret roll). The row travels — the card names the check, so a player can tell their own attempt
 * from the Keeper simply talking — but every figure is dropped here rather than in the renderer,
 * because a number that reaches the client has already left the Keeper's hands whatever is drawn.
 */
const CONCEALED_FIGURES=['roll','target','threshold','difficulty','level','passed','pushed'];
function concealFigures(row:any):any {
  if(row.kind!=='roll'||row.visibility!=='concealed')return row;
  return Object.fromEntries(Object.entries(row).filter(([key])=>!CONCEALED_FIGURES.includes(key)));
}
const DRAFT_PROJECTION=/^(\d+)-(.+)\.json$/;
/**
 * The draft a transcript card must draw today (contract §23.4): the campaign's current revision,
 * read from the draft store, not the revision that appended the row. `undefined` means the store
 * could not be read — an old campaign or a half-written file — and the row's own snapshot stays
 * what the card draws. One campaign file plus one draft file per history page, never a kernel.
 */
export async function currentDraft(binding?:CocBinding):Promise<Record<string,unknown>|undefined> {
  if(!binding)return undefined;
  const folder=join(binding.home,'.coc/campaigns',binding.campaign);
  try {
    const meta=JSON.parse(await readFile(join(folder,'campaign.json'),'utf8'));
    const revision=Number(meta?.setup?.draft_revision);
    if(!Number.isSafeInteger(revision)||revision<1)return undefined;
    const draft=JSON.parse(await readFile(join(folder,'setup/drafts',`${revision}.json`),'utf8'));
    return draft&&typeof draft==='object'&&!Array.isArray(draft)?draft as Record<string,unknown>:undefined;
  } catch {return undefined;}
}
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
  words:CocHistoryWords={}, current?:Record<string,unknown>): HistoryEntry | undefined {
  const lanes=wordTable(words.lanes), chrome=words.ui?{ui:words.ui}:{};
  if(row?.type==='custom'&&row.customType==='coc-character-draft'&&row.data?.sheet) {
    // Contract §23.4: the card draws the campaign's current draft, not the revision that appended
    // the row; each field falls back to the row's own snapshot for a draft that predates it.
    const data={...row.data};
    if(current)for(const key of ['revision','sheet','profile','play_language','limits'] as const)
      if(current[key]!==undefined)data[key]=current[key];
    const saved=presentations?.get(Number(data.revision));
    const labels={...lanes,...wordTable(saved?.texts),...wordTable(row.data.labels)};
    return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
      presentation:{renderer:'coc-character-draft',details:{...data,labels,...(saved?{presentation:saved}:{}),...chrome}}};
  }
  if(row?.type==='custom'&&row.customType==='coc-choice'&&row.data?.kind==='story')return {id:row.id,role:'assistant',content:row.data.prompt||'',timestamp:Date.parse(row.timestamp)||0};
  if(row?.type==='custom' && row.customType==='coc-choice' && Array.isArray(row.data?.options)) {
    return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
      presentation:{renderer:'coc-choice',details:{...row.data,labels:{...lanes,...wordTable(row.data.labels)},...chrome}}};
  }
  if(row?.type!=='custom'||row.customType!=='coc-mechanics'||!Array.isArray(row.data?.mechanics))return;
  const mechanics=row.data.mechanics.filter((x:any)=>x&&typeof x==='object'&&x.visibility!=='keeper').map(concealFigures);
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
export const SHEET_LANES={possessions:'possessionTexts',clues:'clueTexts',languages:'languageTexts',rules:'rulesTexts',journal:'journalTexts'} as const;
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
