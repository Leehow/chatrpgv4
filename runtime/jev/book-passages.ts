/**
 * Contract §196.7 (PU-05): the passages of a module book that the semantic locate judges.
 *
 * One passage per paragraph unit of the book's page transcripts (§196.1-196.3), cut exactly as the consultation catalog cuts
 * them: the source runtime's `sourcePageText {paragraphs:true}` read into the same transcript-layer catalog, so a located
 * passage is the catalog unit with the same page and UTF-16 range when the provider reads that page. A page without a
 * readable, aligned transcript has no passage; its native slices (single printed lines on a transcript layer, §196.5) are
 * never judged.
 *
 * The owner is this module, in the process that prepares the Keeper's support (the host side that already reads
 * `sourcePageText {paragraphs:true}` for the prescreen). Passages are built once per transcript store revision
 * (`transcriptListing`: the record files' names, sizes and times, no record read) and kept in this process; a turn whose
 * store has not moved reads no page. Their identity is `key`: the file digest and the record digests (each transcript
 * page's text revision and Markdown digest), the inputs the units are cut from.
 */
import {createHash} from 'node:crypto';
import {layeredBundles,nativeSourceCatalog,type LayeredPageText} from './native-source-catalog.ts';
import {transcriptListing} from '../../extensions/module/transcript-store.ts';
import type {PrescreenSourceRuntime} from './prescreen-source-provider.ts';
import type {ScopeBinding} from './contracts.ts';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** `sourcePageText` reads at most this many pages per call (§191.7). */
const PAGE_TEXT_PAGES=32;
/** Passages are cut, never issued: the catalog's references are validated and dropped, so no scope is bound. */
const BUILD_SCOPE:ScopeBinding={owner:'book-passages',audience:'keeper'};
const CACHE_LIMIT=4;
/** A rebuild no preparation waits for is bounded by its own allowance, never by the turn that started it. */
const BACKGROUND_BUILD_MS=60_000;

export interface BookPassage {
  /** Host identity: `passage:<page>:<start>-<end>`, the unit's page and UTF-16 range in the transcript's exact layer. */
  handle:string;
  page:number;
  start:number;
  end:number;
  /** §196.2: the heading path above it (carried across a page top). */
  section:string[];
  /** The unit's own text, at most `PARAGRAPH_UNIT_CAP` UTF-16 (§196.6). */
  text:string;
}
export interface BookPassages {
  fileSha256:string;
  /** The file digest and every transcript page's text revision and Markdown digest. */
  key:string;
  /** The store listing these passages were built from. */
  revision:string;
  /** The transcript pages the passages come from. */
  pages:number[];
  passages:BookPassage[];
}
export type BookPassagesRead=BookPassages&{
  /** `built` waited for a build; `cached` is the store's current listing; `stale` an earlier listing, rebuilt in the background. */
  status:'built'|'cached'|'stale';ms:number;
  /** Pages read for this answer: every recorded page on a build waited for, none otherwise. */
  read_pages:number};

export const passageHandle=(page:number,start:number,end:number)=>`passage:${page}:${start}-${end}`;
/** §196.7: a passage card's section as Jev and the label show it. */
export const passageSection=(section:readonly string[])=>section.join(' › ');

const cache=new Map<string,{revision:string;value:BookPassages}>(),building=new Map<string,Promise<BookPassages>>();
const remember=(key:string,value:{revision:string;value:BookPassages})=>{cache.delete(key);cache.set(key,value);
  while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value!);};

/** The passages of `pages` (pages with a record), from one transcript-layer catalog over every page read. */
async function build(source:PrescreenSourceRuntime,snapshot:{pdf:string;file_sha256:string;page_count:number},pages:number[],revision:string,
  signal:AbortSignal):Promise<BookPassages> {
  const ask=source.sourcePageText!,chunks:number[][]=[];
  for(let at=0;at<pages.length;at+=PAGE_TEXT_PAGES)chunks.push(pages.slice(at,at+PAGE_TEXT_PAGES));
  const reads:LayeredPageText[]=await Promise.all(chunks.map(chunk=>ask({pdf:snapshot.pdf,pages:chunk,expected_file_sha256:snapshot.file_sha256,
    layer:'preferred',paragraphs:true},signal)));
  signal.throwIfAborted();
  if(reads.some(read=>read.file_sha256!==snapshot.file_sha256))throw new Error('source_material_stale');
  // Only transcript rows have paragraph units; a listed page whose record is not readable came back native and has none.
  const rows=reads.flatMap(read=>read.pages).filter(row=>row.layer==='transcript');
  const markdownOf=(row:object)=>{const value=(row as {markdown?:unknown}).markdown;return typeof value==='string'?value:null;};
  const key=digest(['book-passages',snapshot.file_sha256,rows.map(row=>[row.page,row.revision,digest(markdownOf(row))])]);
  if(!rows.length)return {fileSha256:snapshot.file_sha256,key,revision,pages:[],passages:[]};
  const bundles=layeredBundles({file_sha256:snapshot.file_sha256,pages:rows,errors:[]},snapshot.file_sha256,snapshot.page_count);
  const catalog=nativeSourceCatalog(BUILD_SCOPE,bundles.transcript!,snapshot.file_sha256,'transcript');
  const passages=catalog.units.filter(unit=>unit.section!==undefined&&unit.ref.selector.kind==='utf16').map(unit=>{
    const range=unit.ref.selector as {start:number;end:number};
    return {handle:passageHandle(unit.page,range.start,range.end),page:unit.page,start:range.start,end:range.end,section:[...unit.section!],text:unit.text};
  });
  return {fileSha256:snapshot.file_sha256,key,revision,pages:[...new Set(passages.map(row=>row.page))],passages};
}

/**
 * §196.7: the book's passages for this preparation. The store's listing decides: unchanged since the passages were built,
 * they are answered from this process; moved, every recorded page is read again (at most 32 per `sourcePageText` call) and
 * the passages are rebuilt, keeping the earlier object when the record digests did not change. Only the first build of a
 * book is waited for: while a later one runs (a page gained a transcript), the passages built before are answered (`stale`;
 * records are never rewritten, so each still names its unit), and the next preparation gets the new ones. A runtime without
 * `sourcePageText` has no passages. Concurrent preparations share one build.
 */
export async function bookPassages(input:{source:PrescreenSourceRuntime;roots:{home:string;contentRoot:string};
  snapshot:{pdf:string;file_sha256:string;page_count:number};signal:AbortSignal}):Promise<BookPassagesRead> {
  const began=Date.now(),{source,roots,snapshot,signal}=input;
  signal.throwIfAborted();
  const empty=(revision:string):BookPassagesRead=>({fileSha256:snapshot.file_sha256,key:digest(['book-passages',snapshot.file_sha256,[]]),revision,
    pages:[],passages:[],status:'built',ms:Date.now()-began,read_pages:0});
  const listing=await transcriptListing(roots,snapshot.file_sha256),slot=JSON.stringify([roots.home,roots.contentRoot,snapshot.file_sha256]);
  const pages=listing.pages.filter(page=>page<=snapshot.page_count);
  if(!source.sourcePageText||!pages.length)return empty(listing.revision);
  const held=cache.get(slot);
  if(held?.revision===listing.revision)return {...held.value,status:'cached',ms:Date.now()-began,read_pages:0};
  const job=`${slot}:${listing.revision}`;
  let work=building.get(job);
  if(!work){
    work=build(source,snapshot,pages,listing.revision,held?AbortSignal.timeout(BACKGROUND_BUILD_MS):signal);building.set(job,work);
    work.then(value=>{const prior=cache.get(slot)?.value;remember(slot,{revision:listing.revision,value:prior?.key===value.key?{...prior,revision:listing.revision}:value});},
      ()=>undefined).finally(()=>building.delete(job));
  }
  if(held)return {...held.value,status:'stale',ms:Date.now()-began,read_pages:0};
  const value=await work;
  return {...value,status:'built',ms:Date.now()-began,read_pages:pages.length};
}

/** Tests only: settles once every build in flight has. */
export const bookPassageBuilds=()=>Promise.allSettled([...building.values()]).then(()=>undefined);
