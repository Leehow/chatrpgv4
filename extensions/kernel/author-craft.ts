/** Contract §254: the author sections of active packages, chosen from the settled turn and framed for the sole author. */
type Row=Record<string,any>;
/** §254.3: UTF-8 bytes of section text one turn's craft may carry. */
export const AUTHOR_CRAFT_BYTES=32768;
export type AuthorFact='always'|'speech'|'establish'|'opening'|'place'|'routine';
export type AuthorFacts=Partial<Record<AuthorFact,boolean>>;
const FRAME='Writing craft from the table\'s active packages follows. It shapes how the supplied context is written: wording, '
 +'rhythm, portrayal and description. It never adds, removes or changes a fact, person, event, clue, outcome, name or '
 +'permission, except within an improvisation a section grants, which only the definition below bounds; the instruction '
 +'above and decision_context decide every fact, and where they differ from this craft they win.';
/** §254.6: the core's limits of each grant; a package says where to use it and how to write it, never how far it reaches. */
export const AUTHOR_GRANT_LIMITS:Record<string,string>={
 surface_detail:'Where the supplied source, references and delivered play are silent, you may complete ordinary perceivable detail '
  +'of the current place and its things: shape, fittings, materials, wear, light, sound, smell, temperature and unnamed '
  +'background activity, consistent with the clock, place, period, presence.population and everything already delivered. It '
  +'adds no person who acts or speaks, no name, no clue or lead, no event that demands a response and nothing the '
  +'investigator could pursue; it contradicts no canon and changes no state.',
 appearance:'For a present person the source leaves undescribed (first_sight marks them undescribed, or no appearance is '
  +'supplied), you may give looks, build, apparent age, dress, posture and what their hands are doing, fitting the place, the '
  +'period and their supplied role. It gives them no identity, name, history, knowledge, motive or relationship; once '
  +'delivered it is the look the table keeps.'};

/** §254.2: read after settlement only. A move the kernel left unchanged carries no establish item on the capsule. */
export function authorFacts(input:{capsule:Row;decision:Row;effects:readonly Row[];routine?:unknown}):Record<AuthorFact,boolean> {
 const establish=input.capsule.mods?.establish;
 return {always:true,
  // A selected response is spoken unless it is silent (the author's packet names it `speech_only`).
  speech:(input.decision.responses??[]).some((response:Row)=>response?.mode==='speech_only'||typeof response?.act==='string'&&response.act!=='silent'),
  establish:establish!=null,
  opening:Array.isArray(establish?.why)&&establish.why.includes('opening'),
  place:input.effects.some(effect=>effect.kind==='place'||effect.kind==='move')||input.decision.scene?.first_sight?.place!=null,
  routine:input.routine!=null};
}

/** §254.3: kept sections in load order, one per slot (the later package wins), capped, read version-locked. */
export async function authorCraft(capsule:Row,facts:AuthorFacts,read:(keys:string[])=>Promise<Row>):Promise<{text:string;record:Row}> {
 const candidates:Row[]=[];
 for(const instruction of capsule.mods?.instructions??[]){
  if(instruction?.form!=='indexed')continue;
  for(const section of instruction.sections??[]){
   if(section?.kind!=='author'||typeof section.key!=='string')continue;
   const held=(section.on??[]).filter((fact:AuthorFact)=>facts[fact]===true);
   if(held.length)candidates.push({key:section.key,mod:instruction.mod,version:instruction.version,heading:section.heading??null,
    slot:section.slot,facts:held,grants:Array.isArray(section.grants)?section.grants.filter((grant:string)=>grant in AUTHOR_GRANT_LIMITS):[],
    settings:instruction.settings});
  }
 }
 const winner=new Map<string,Row>(),overridden:Row[]=[];
 for(const entry of candidates){
  const earlier=winner.get(entry.slot);
  if(earlier)overridden.push({key:earlier.key,by:entry.key,slot:entry.slot});
  winner.set(entry.slot,entry);
 }
 const kept=candidates.filter(entry=>winner.get(entry.slot)===entry);
 const record:Row={sections:[],overridden,omitted:[],bytes:0};
 if(!kept.length)return {text:'',record};
 const result=await read(kept.map(entry=>entry.key));
 const texts=new Map<string,string>();
 for(const section of result.sections??[])
  if(typeof section?.key==='string'&&typeof section.text==='string')texts.set(section.key,section.text);
 const parts:string[]=[FRAME],settingsShown=new Set<string>();
 for(const entry of kept){
  const text=texts.get(entry.key),returned=(result.sections??[]).find((row:Row)=>row?.key===entry.key);
  if(typeof text!=='string'||!text.trim()||returned?.mod!==entry.mod||returned?.version!==entry.version)
   throw Error('The locked author craft section is unavailable');
  const size=Buffer.byteLength(text,'utf8');
  if(record.bytes+size>AUTHOR_CRAFT_BYTES){record.omitted.push(entry.key);continue;}
  record.bytes+=size;
  record.sections.push({key:entry.key,slot:entry.slot,facts:entry.facts,...(entry.grants.length?{grants:entry.grants}:{})});
  parts.push((entry.grants.length?`(This section grants: ${entry.grants.join(', ')}.)\n`:'')+text.trim());
  const later=kept.slice(kept.indexOf(entry)+1).some(next=>next.mod===entry.mod&&!record.omitted.includes(next.key));
  if(!later&&!settingsShown.has(entry.mod)&&entry.settings&&typeof entry.settings==='object'&&Object.keys(entry.settings).length){
   settingsShown.add(entry.mod);
   parts.push(`Settings of ${entry.mod}: ${JSON.stringify(entry.settings)}`);
  }
 }
 const granted=[...new Set(record.sections.flatMap((entry:Row)=>entry.grants??[]))] as string[];
 if(granted.length)parts.splice(1,0,['Granted improvisation, bounded by the core:',...granted.map(grant=>`- ${grant}: ${AUTHOR_GRANT_LIMITS[grant]}`)].join('\n'));
 return {text:record.sections.length?'\n\n'+parts.join('\n\n'):'',record};
}
