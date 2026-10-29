/**
 * Prefetch (by provider, see `prefetchEnabled`): before the Keeper's first call the host asks the book the
 * same source answer the Keeper's own first lookup usually asks, so that call's round trip is saved (1029 analysis: the v4
 * Grok Keeper's first call was a look-up in 72 of 90 turns, about 10.8 s each). Bounded: at most `PREFETCH_FOCI` foci, a
 * wait of at most `PREFETCH_WAIT_MS` at the first model step, and the carried views' own page and byte caps.
 */
/**
 * On for the Keeper's provider: `PI_COC_KP_PREFETCH=1` turns it on for every provider and `0` off; left unset, it is on for
 * the providers in `PI_COC_KP_PREFETCH_PROVIDERS` (default grok-build). 1029p: Grok skipped the first look-up round trip with
 * it (first calls that were only look-ups 36 to 23 of 45, -6.4 s a turn); MiniMax read every following page instead and was
 * slower, so it is not on for MiniMax. Configuration by provider, not a judgment of the turn.
 */
export const PREFETCH_PROVIDERS_DEFAULT='grok-build';
export function prefetchEnabled(provider?:string):boolean {
  const flag=process.env.PI_COC_KP_PREFETCH;
  if(flag==='1')return true;
  if(flag==='0'||!provider)return false;
  return (process.env.PI_COC_KP_PREFETCH_PROVIDERS??PREFETCH_PROVIDERS_DEFAULT).split(',').map(value=>value.trim()).includes(provider);
}
/** The complete-slice mark rides wherever prefetch may run; it says nothing a whole answer does not already say. */
export const sliceMarkEnabled=():boolean=>process.env.PI_COC_KP_PREFETCH!=='0';
export const PREFETCH_FOCI=2;
export const PREFETCH_WAIT_MS=3000;

type Row=Record<string,any>;
const row=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const rows=(value:unknown):Row[]=>Array.isArray(value)?value.map(row):[];
const text=(value:unknown):string=>typeof value==='string'?value:'';
const normalized=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu,'');

/**
 * The foci to ask about: the current place, then the one issued name the player's words carry (a person, a way out, a paper
 * in reach), longest name first. Identity matching against the capsule's public labels only, as the run's people
 * preparation matches names; what the player means is still the Keeper's to judge.
 */
export function prefetchTargets(capsule:Row,input:string):Array<{focus:string;kind:'scene'|'person'|'place'|'document'}> {
  const scene=text(row(capsule.where).scene),words=normalized(input),targets:Array<{focus:string;kind:'scene'|'person'|'place'|'document'}>=[];
  if(scene)targets.push({focus:scene,kind:'scene'});
  if(!words)return targets;
  const named:Array<{focus:string;kind:'person'|'place'|'document';label:string}>=[];
  for(const person of [...rows(capsule.present),...rows(row(capsule.npc_references).people)])
    if(text(person.display_name))named.push({focus:person.display_name,kind:'person',label:person.display_name});
  for(const exit of rows(row(capsule.where).exits))for(const label of [text(exit.display_name),text(exit.to)].filter(Boolean))
    if(text(exit.to))named.push({focus:exit.to,kind:'place',label});
  for(const paper of rows(row(capsule.documents_in_reach).rows))if(text(paper.name))named.push({focus:paper.name,kind:'document',label:paper.name});
  const hit=named.filter(entry=>[...normalized(entry.label)].length>=2&&words.includes(normalized(entry.label))&&entry.focus!==scene)
    .sort((a,b)=>normalized(b.label).length-normalized(a.label).length);
  for(const entry of hit){
    if(targets.length>=PREFETCH_FOCI)break;
    if(!targets.some(target=>target.focus===entry.focus))targets.push({focus:entry.focus,kind:entry.kind});
  }
  return targets.slice(0,PREFETCH_FOCI);
}
