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
 * Contract §129: what the host has said about an object's details since a card named them pending,
 * by definition name. `definition: 'ready'` carries the player view the card opens into; `'none'`
 * says the preparation was dropped and the row should stop waiting. A later word wins.
 *
 * Kept as an input `mechanicsEntry` still accepts; since §132 it is read as one `coc-card-patch`.
 */
export type CocObjectDetails=ReadonlyMap<string,Record<string,unknown>>;
const isDetailsRecord=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** The `coc-object-details` entries a row carries, for one campaign; empty for every other row. */
export function objectDetailsOf(row:any, campaign?:string):[string,Record<string,unknown>][] {
  if(row?.type!=='custom'||row.customType!=='coc-object-details'||!Array.isArray(row.data?.objects))return [];
  if(campaign&&typeof row.data.campaign==='string'&&row.data.campaign!==campaign)return [];
  return row.data.objects.filter((item:any)=>isDetailsRecord(item)&&typeof item.name==='string'&&item.name
    &&(item.definition==='ready'&&isDetailsRecord(item.object)||item.definition==='none'))
    .map((item:any)=>[item.name,item.definition==='ready'?{definition:'ready',object:item.object}:{definition:'none'}]);
}
/** The definition names a card is still waiting on; a card that waits on nothing returns none. */
export function pendingObjectNames(row:any):string[] {
  if(row?.type!=='custom'||row.customType!=='coc-mechanics'||!Array.isArray(row.data?.mechanics))return [];
  return row.data.mechanics.filter((item:any)=>isDetailsRecord(item)&&item.kind==='item'&&item.definition==='pending'
    &&typeof item.definition_name==='string'&&item.definition_name).map((item:any)=>item.definition_name as string);
}
/**
 * Contract §132: which card a `coc-card-patch` is for. `id` is the `coc-mechanics` entry id; `turn` is
 * the card of that turn; neither is every card whose item rows the patch names.
 */
export type CocCardSelector={id?:string; turn?:number};
/** One patch over a delivery card's `details`, as it was appended, with the lane that wrote it. */
export type CocCardPatch={card:CocCardSelector; patch:Record<string,unknown>; source:string};
/**
 * RFC 7396 JSON merge patch: an object merges key by key, `null` deletes the key, and anything else --
 * an array included -- replaces the value whole. A patch never writes a `null` into the result.
 */
export function mergePatch(target:unknown, patch:unknown):unknown {
  if(!isDetailsRecord(patch))return patch;
  const out:Record<string,unknown>=isDetailsRecord(target)?{...target}:{};
  for(const [key,value] of Object.entries(patch)) {
    if(key==='__proto__')continue;
    if(value===null)delete out[key];
    else out[key]=mergePatch(out[key],value);
  }
  return out;
}
/** The §129 word read as the §132 patch it is: every name it carries, keyed under `definitions`. */
function detailsPatch(landed:Iterable<[string,Record<string,unknown>]>):Record<string,unknown> {
  // `object: null` so a fold that opened and is then dropped closes again, rather than keeping the view.
  return {definitions:Object.fromEntries([...landed].map(([name,value])=>
    [name,value.definition==='none'?{definition:'none',object:null}:value]))};
}
/**
 * The patch one transcript row carries for one campaign: a `coc-card-patch`, or a §129
 * `coc-object-details`, which is the same word under its older name. Anything else carries none.
 */
export function cardPatchOf(row:any, campaign?:string):CocCardPatch|undefined {
  if(row?.type!=='custom')return undefined;
  if(row.customType==='coc-object-details') {
    const landed=objectDetailsOf(row,campaign);
    return landed.length?{card:{},patch:detailsPatch(landed),source:'object-details'}:undefined;
  }
  const data=row.customType==='coc-card-patch'?row.data:undefined;
  if(!isDetailsRecord(data)||typeof data.campaign!=='string'||!data.campaign||campaign&&data.campaign!==campaign)return undefined;
  if(!isDetailsRecord(data.patch)||!Object.keys(data.patch).length)return undefined;
  const card=isDetailsRecord(data.card)?data.card:{};
  return {card:{...(typeof card.id==='string'&&card.id?{id:card.id}:{}),...(Number.isSafeInteger(card.turn)?{turn:card.turn}:{})},
    patch:data.patch,source:typeof data.source==='string'?data.source:''};
}
/** The names a patch addresses rows by: definition names, then object names. */
function patchNames(patch:Record<string,unknown>):{definitions:string[]; objects:string[]} {
  return {definitions:isDetailsRecord(patch.definitions)?Object.keys(patch.definitions):[],
    objects:isDetailsRecord(patch.objects)?Object.keys(patch.objects):[]};
}
type CardNames={definitions:Set<string>; objects:Set<string>};
/** What one card's item rows answer to: a pending row by `definition_name`, every item row by `name`. */
function cardNames(row:any):CardNames {
  const names:CardNames={definitions:new Set(),objects:new Set()};
  for(const item of Array.isArray(row?.data?.mechanics)?row.data.mechanics:[]) {
    if(!isDetailsRecord(item)||item.kind!=='item')continue;
    if(typeof item.definition_name==='string'&&item.definition_name)names.definitions.add(item.definition_name);
    if(typeof item.name==='string'&&item.name)names.objects.add(item.name);
  }
  return names;
}
type Noted={at:number; patch:CocCardPatch};
/**
 * Contract §132: every card a transcript drew and every patch said about one, read in file order.
 *
 * One reader for both roads to a card -- the live stream reader and the history page -- so the two
 * cannot come to disagree about which card a patch lands on:
 *
 *  - `id` names the card outright, whether or not it has been read yet;
 *  - `turn` is the latest card of that turn read before the patch, or, when the patch arrived first,
 *    the next card of that turn to be read;
 *  - neither is every card, before or after the patch, with an item row the patch names under
 *    `definitions` (by the row's `definition_name`) or `objects` (by its `name`).
 *
 * A card's patches apply in the order they were read, whichever selector named them.
 */
export class CocCardLedger {
  private read=0;
  private readonly cards=new Map<string,CardNames>();
  private readonly byTurn=new Map<number,string>();
  private readonly waiting=new Map<number,Noted[]>();
  private readonly bound=new Map<string,Noted[]>();
  private readonly named:Noted[]=[];
  private readonly campaign?:string;
  /** `campaign` is the binding's; a patch for another campaign is not read. */
  constructor(campaign?:string) {this.campaign=campaign;}
  /**
   * Read one transcript row. Returns the ids of the cards a patch changed, whether or not they have
   * been read; a card row and every other row return none.
   */
  note(row:any):string[] {
    if(row?.type==='custom'&&row.customType==='coc-mechanics'&&typeof row.id==='string'&&row.id) {
      this.cards.set(row.id,cardNames(row));
      const turn=row.data?.turn;
      if(Number.isSafeInteger(turn)) {
        this.byTurn.set(turn,row.id);
        const early=this.waiting.get(turn);
        if(early) {this.waiting.delete(turn);this.bind(row.id,...early);}
      }
      return [];
    }
    const patch=cardPatchOf(row,this.campaign);
    if(!patch)return [];
    const noted={at:++this.read,patch};
    if(patch.card.id) {this.bind(patch.card.id,noted);return [patch.card.id];}
    if(patch.card.turn!==undefined) {
      const id=this.byTurn.get(patch.card.turn);
      if(id) {this.bind(id,noted);return [id];}
      const early=this.waiting.get(patch.card.turn)??[];
      early.push(noted);this.waiting.set(patch.card.turn,early);
      return [];
    }
    const names=patchNames(patch.patch);
    if(!names.definitions.length&&!names.objects.length)return [];
    this.named.push(noted);
    return [...this.cards].filter(([,card])=>this.names(card,patch)).map(([id])=>id);
  }
  /** The patches one card is drawn with, in the order they were read. */
  patchesFor(id:unknown):CocCardPatch[] {
    if(typeof id!=='string')return [];
    const card=this.cards.get(id);
    const found=[...this.bound.get(id)??[],...card?this.named.filter(noted=>this.names(card,noted.patch)):[]];
    return found.sort((a,b)=>a.at-b.at).map(noted=>noted.patch);
  }
  private bind(id:string, ...noted:Noted[]):void {
    const list=this.bound.get(id)??[];
    list.push(...noted);this.bound.set(id,list);
  }
  private names(card:CardNames, patch:CocCardPatch):boolean {
    const names=patchNames(patch.patch);
    return names.definitions.some(name=>card.definitions.has(name))||names.objects.some(name=>card.objects.has(name));
  }
}
/**
 * One card's details with every patch said about it applied, in order (§132), and the per-row maps
 * folded onto the rows they name: `definitions[<definition name>]` onto the item row waiting on that
 * definition, `objects[<object name>]` onto every item row of that name, each as a merge patch. The two
 * maps are addressing, not content, and do not travel on. A patch is host-written and player-facing by
 * construction; the Keeper filter and §16.5's concealment still run again over whatever it left.
 */
function patchedDetails(details:Record<string,any>, patches:readonly CocCardPatch[]):Record<string,any> {
  if(!patches.length)return details;
  let merged:any=details;
  for(const patch of patches)merged=mergePatch(merged,patch.patch);
  const {definitions,objects,...rest}=merged as Record<string,any>;
  const byDefinition=isDetailsRecord(definitions)?definitions:{}, byName=isDetailsRecord(objects)?objects:{};
  const rows=Array.isArray(rest.mechanics)?rest.mechanics:[];
  rest.mechanics=rows.filter((row:any)=>isDetailsRecord(row)&&row.visibility!=='keeper').map((row:any)=>{
    let next=row;
    if(row.kind==='item') {
      const pending=typeof row.definition_name==='string'&&Object.hasOwn(byDefinition,row.definition_name)?byDefinition[row.definition_name]:undefined;
      if(isDetailsRecord(pending))next=mergePatch(next,pending);
      const named=typeof row.name==='string'&&Object.hasOwn(byName,row.name)?byName[row.name]:undefined;
      if(isDetailsRecord(named))next=mergePatch(next,named);
    }
    return concealFigures(next);
  });
  return rest;
}
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
/** The §40.1 say wrapper, by shape only: the name may be in any script, so the ASCII marker
 *  grammar of §16.6 does not see it. No `g` flag — `test` here must not carry a `lastIndex`. */
const SAY_TOKEN=/\{\{say:[^{}\n]{1,60}\}\}/;
export function mechanicsEntry(row:any, language?:string, presentations?:ReadonlyMap<number,Record<string,unknown>>,
  words:CocHistoryWords={}, current?:Record<string,unknown>, patches?:readonly CocCardPatch[]|CocObjectDetails): HistoryEntry | undefined {
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
  // §16.6: the delivery with its markers still in it, when the Keeper placed any. It rides with the
  // rows because one component has to own both to draw a row where the sentence is.
  const markedText=typeof row.data.marked_text==='string'?row.data.marked_text:'';
  const marked=markedText?{marked_text:markedText}:{};
  // §40.2: who spoke each span, in text order, so the card can colour it (§40.4). This projection
  // is the one road to both cards — the live delivery and the restored transcript come through
  // here — so a field left out here never reaches the player's screen at all.
  const speech=Array.isArray(row.data.speech)&&row.data.speech.length?{speech:row.data.speech}:{};
  // A turn can settle nothing and still be spoken. Before §40 a delivery with no visible row had
  // nothing for this card to draw and the plain copy stood in for it; now the marked text carries
  // the say tokens, and without the card the player reads the braces.
  if(!mechanics.length&&!SAY_TOKEN.test(markedText))return;
  const tag=row.data.play_language??language;
  // §132 (§129's object details among them): what asynchronous lanes said about this card after it was
  // drawn, so the live redraw and every re-read of the transcript draw the same card.
  const said=patches instanceof Map?(patches.size?[{card:{},patch:detailsPatch(patches),source:'object-details'}]:[]):(patches??[]) as readonly CocCardPatch[];
  return {id:row.id,role:'assistant',content:'',timestamp:Date.parse(row.timestamp)||0,
    presentation:{renderer:'coc-mechanics',details:patchedDetails({turn:row.data.turn,mechanics,labels:{...lanes,...wordTable(row.data.labels)},
      ...marked,...speech,...(tag?{play_language:tag}:{}),...chrome},said)}};
}
export async function readColdSheet(repo:string, context:CocBinding, previewRevision?:number, env:NodeJS.ProcessEnv=process.env, runtimeOptions:CocColdRuntimeOptions={}):Promise<unknown> {
  // A displayed draft is the host's own fact (contract §98): the card entry in the transcript is
  // the acknowledgement, and the kernel no longer keeps a `previewed_revision` to be told about.
  if(previewRevision!==undefined)return {previewed:true,revision:previewRevision,campaign:context.campaign};
  return callColdKernel(repo, context.home, 'table.view', {campaign:context.campaign}, env, runtimeOptions);
}
/**
 * The growing lanes a sheet read tops up, each named after its presentation file and pointing at
 * the presenter's own collector for its words: what an acquired object carries, and what a
 * discovered clue is called and says. The collector is the one definition of a lane's words,
 * read from the built presenter, so the host never counts a sheet's words a second way.
 */
export const SHEET_LANES={possessions:'possessionTexts',clues:'clueTexts',languages:'languageTexts',rules:'rulesTexts',journal:'journalTexts',identity:'identityTexts'} as const;
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
