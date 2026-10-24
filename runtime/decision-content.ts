/** Host-owned references to exact prepared facts. A selection is never a transaction. */
import {createHash} from 'node:crypto';
import {Type,type Static,type TSchema} from 'typebox';
import {StringEnum} from '@earendil-works/pi-ai';
import {isNpcReference,NPC_REFERENCE_PATTERN} from './npc-references.ts';
type Row=Record<string,any>;
const ref=Type.String({minLength:1,maxLength:96});
const closed=<T extends Record<string,TSchema>>(fields:T)=>Type.Object(fields,{additionalProperties:false});
const when=closed({day_offset:Type.Integer({minimum:0,maximum:365}),hour:Type.Integer({minimum:0,maximum:23}),minute:Type.Integer({minimum:0,maximum:59})});
const category=closed({label:Type.String({minLength:1,maxLength:80})});
export const NewCommunicationFact=Type.Union([
 closed({predicate:Type.Literal('service_at'),provider:ref,items:Type.Array(Type.Union([ref,category]),{minItems:1,maxItems:8,uniqueItems:true}),when,fulfillment:StringEnum(['dine_in','takeaway'])}),
 closed({predicate:Type.Literal('planned_visit'),actor:ref,to:ref,when}),
 closed({predicate:Type.Literal('whereabouts'),actor:ref,to:ref,when:StringEnum(['now','earlier_today','habitual'])}),
 Type.Object({predicate:Type.Literal('directions'),to:ref,
  heading:Type.Optional(StringEnum(['north','northeast','east','southeast','south','southwest','west','northwest','left','right','straight'])),
  via:Type.Optional(Type.Array(ref,{minItems:1,maxItems:8})),retrace:Type.Optional(Type.Literal(true))},
  // §264.5: `to` alone says where the place is; a route rides only when the speaker gives one. Requiring a heading made the
  // Keeper invent compass bearings for "the sanitarium in Roxbury".
  {additionalProperties:false,description:'to alone says where the place is; add heading, via or retrace:true only when the speaker gives the way, never a guessed bearing'}),
 // §264.1: what the speaker knows about the topic. A topic nobody here has a reference for (the missing boy the investigator
 // asks after) is player_input, what they were just asked about; it names the subject, never says anything about it.
 closed({predicate:Type.Literal('knowledge_status'),topic:ref,
  status:StringEnum(['unknown','uncertain','withheld','nothing_more'],{description:"The speaker's own knowledge of the topic: unknown (knows nothing of it), uncertain (unsure), withheld (knows but will not say), nothing_more (has said all they know)"})}),
 closed({predicate:Type.Literal('input_requirements'),topic:ref,fields:Type.Array(StringEnum(['subject_name','person_name','location','time_range','record_type','purpose','quantity','budget','authorization','proof_of_identity'],{description:'What the speaker needs from the investigator before they will do it; authorization is written permission or a word from someone with standing (an employer, an official), proof_of_identity is papers showing who the investigator is'}),{minItems:1,maxItems:8,uniqueItems:true})})
]);
/** §258.4: how a selected item is said to a listener who was already told it; omitted, a told item is said as `refer`. */
export const TELLING=['new','refer','restate','clarify','update'] as const;
const strategy=Type.Optional(StringEnum([...TELLING]));
export const ExistingCommunicationFact=Type.Union([closed({fact_ref:ref,strategy}),closed({source_ref:ref,strategy}),closed({result_ref:StringEnum(['scene','outcomes','clock'])}),closed({exhibit_ref:ref,strategy})]);
export const CommunicationContent=Type.Union([ExistingCommunicationFact,closed({new:NewCommunicationFact,strategy})]);
const actor=Type.String({pattern:"^(npc_[1-9][0-9]*|new_[1-4])$",maxLength:32});
const to=Type.Array(ref,{minItems:1,maxItems:16,uniqueItems:true});
/** §260.2: what the person visibly does this moment, as direction for the author; never a settled change. */
/** §258.9-§258.10: `aside` is said so only `to` hear it; `phone` and `letter` reach `to` from wherever the speaker is. Omitted, everyone present hears. */
const channel=Type.Optional(StringEnum(['speech','aside','phone','letter']));
const beat=Type.Optional(Type.String({minLength:1,maxLength:120,pattern:'\\S',description:'What they visibly do now; behavior only, never words or a settled change'}));
/** §263.6: how the speaker outwardly says it this turn; the Keeper's decision from the person and the moment, never derived from a stance. */
export const DELIVERY=['casual','guarded','evasive','confident','hesitant','irritated','matter_of_fact'] as const;
const delivery=Type.Optional(StringEnum([...DELIVERY]));
export const Interaction=Type.Union([
 closed({actor,act:Type.Literal('silent'),to:Type.Optional(to),beat}),
 closed({actor,to,act:StringEnum(['greet','refuse','acknowledge']),content:Type.Optional(Type.Array(CommunicationContent,{minItems:1,maxItems:8})),channel,beat,delivery}),
 closed({actor,to,act:StringEnum(['answer','ask','offer','clarify','report','warn']),content:Type.Array(CommunicationContent,{minItems:1,maxItems:8}),channel,beat,delivery})
]);
export type InteractionDecision=Static<typeof Interaction>;
export type HydratedInteraction=InteractionDecision&{claims?:Row[]};
export interface DecisionBindings {entities:string[];people:string[];places:string[];facts:string[];sources:string[];narrationFacts?:string[];factActors?:Record<string,string>;
 /** §257.7: issued exhibit references, and the subsets a reveal and a person's speech may select. */
 exhibits?:string[];revealExhibits?:string[];speechExhibits?:string[]}
/** The knowledge_status / input_requirements topic that means what the investigator just asked about. */
export const ASKED_TOPIC='player_input';
/** Prepared schemas and execution use the same issued reference vocabulary. */
export function bindCommunicationParameters(schema:TSchema,bindings:DecisionBindings,narration=false):TSchema {
 const result=structuredClone(schema) as Row;
 const selection=(values:string[],slots=false)=>Type.String({enum:[...new Set([...values,...(slots?['new_1','new_2','new_3','new_4']:[])])]});
 const owned=new Map<string,string[]>();
 for(const [ref,actor] of Object.entries(bindings.factActors??{}))owned.set(actor,[...owned.get(actor)??[],ref]);
 const visit=(value:unknown)=>{
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach(visit);return;}const row=value as Row,p=row.properties;
  if(p?.predicate){if(p.provider)p.provider=selection(bindings.entities,true);
   // A topic may also be what the investigator just asked about, which the book need not have (app, 2026-10-24: the Keeper
   // spent thousands of characters finding a way to say "never seen this boy" about a missing son the player invented).
   if(p.topic)p.topic=Type.String({enum:[...new Set([...bindings.entities,'new_1','new_2','new_3','new_4',ASKED_TOPIC])]});
   if(p.actor)p.actor=selection(bindings.people,true);
   if(p.to)p.to=selection(bindings.places);
   // §258.5: what a service serves is a thing, never a person.
   if(p.items)p.items.items=Type.Union([selection(bindings.entities.filter(entity=>!bindings.people.includes(entity))),category]);
   if(p.via)p.via.items=selection(bindings.places);
  }else if(p?.actor&&p?.act){p.actor=selection(bindings.people.filter(isNpcReference),true);if(p.to)p.to.items=selection(bindings.people,true);}
  if(p?.fact_ref)p.fact_ref=selection(narration?bindings.narrationFacts??bindings.facts:bindings.facts);
  if(p?.source_ref)p.source_ref=selection(bindings.sources);
  if(p?.exhibit_ref)p.exhibit_ref=selection(narration?bindings.revealExhibits??[]:bindings.speechExhibits??[]);
  for(const child of Object.values(row))visit(child);
  // §257.7: with no exhibit issued for a position, its branch is left out rather than offered as an empty choice.
  if(Array.isArray(row.anyOf))row.anyOf=row.anyOf.filter((variant:Row)=>!(variant?.properties?.exhibit_ref&&variant.properties.exhibit_ref.enum?.length===0));
  if(p?.actor&&p?.act&&owned.size)row.allOf=[...row.allOf??[],...[...owned].map(([actor,refs])=>({
   if:{required:['content'],properties:{content:{contains:{required:['fact_ref'],properties:{fact_ref:{enum:refs}}}}}},
   then:{properties:{actor:{const:actor}}}
  }))];
 };visit(result);return result as TSchema;
}
/** Bind only declared entity positions; exact quoted source values stay untouched. */
export function bindCreatedDecisionPerson(selected:{responses:HydratedInteraction[];materials:Row[]},slot:string,person:{ref:string;display_name:string}):void {
 const bindFact=(claim:Row)=>{
  if(claim.kind!=='proposed_claim')return claim;
  const value={...claim.value};
  for(const key of ['provider','actor','to','topic'])if(value[key]===slot)value[key]=person.ref;
  for(const key of ['items','via'])if(Array.isArray(value[key]))value[key]=value[key].map((ref:string)=>ref===slot?person.ref:ref);
  const entities=(claim.entities??[]).filter((row:Row)=>row.ref!==slot);
  if(JSON.stringify(value)!==JSON.stringify(claim.value))entities.push({ref:person.ref,display_name:person.display_name});
  return {...claim,value,entities};
 };
 selected.responses=selected.responses.map(row=>({...row,...(row.actor===slot?{actor:person.ref}:{}),...(row.to?{to:row.to.map(ref=>ref===slot?person.ref:ref)}:{}),...(row.claims?{claims:row.claims.map(bindFact)}:{})}));
 selected.materials=selected.materials.map(bindFact);
}
const rows=(x:unknown):Row[]=>Array.isArray(x)?x.filter(v=>v&&typeof v==='object'):[];
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const MATERIAL_FIELDS=['knowledge','knows','authored_knowledge','knowledge_reports','cognition','recent_speech','commitments','believes','authored_beliefs'] as const;
const DISPOSITION_OF:Record<string,string>={hostile:'hostile',guarded:'unfriendly',unfriendly:'unfriendly',neutral:'neutral',friendly:'friendly',ally:'ally'};
/**
 * §258.7: one attitude row per target, folded oldest to newest from the directed_relationship statements a person's read
 * carries (newest first); a later statement overrides only the fields it names, and `control: none` clears control.
 */
export function attitudeRows(relationships:unknown):Row[] {
 const statements:Row[]=[];
 for(const [order,relation] of rows(relationships).entries())for(const evidence of [relation,...rows(relation.evidence)]){
  let value:Row;try{value=JSON.parse(evidence.statement);}catch{continue;}
  if(value?.kind!=='directed_relationship'||typeof relation.toward!=='string')continue;
  statements.push({toward:relation.toward,value,turn:Number(evidence.turn??relation.turn),order});break;
 }
 statements.sort((a,b)=>(Number.isFinite(a.turn)&&Number.isFinite(b.turn)&&a.turn!==b.turn?a.turn-b.turn:b.order-a.order));
 const folded=new Map<string,Row>();
 for(const {toward,value,turn} of statements){
  const row=folded.get(toward)??{toward};
  const disposition=DISPOSITION_OF[value.disposition??value.affinity];
  if(disposition)row.disposition=disposition;
  for(const key of ['trust','fear','pressure'])if(Number.isInteger(value[key])&&value[key]>=0&&value[key]<=5)row[key]=value[key];
  if(DISPOSITION_OF[value.public])row.public=DISPOSITION_OF[value.public];
  if(Array.isArray(value.hidden))row.hidden=value.hidden.filter((item:unknown)=>item==='disposition'||item==='mood');
  if(typeof value.control==='string'){if(value.control==='none')delete row.control;else row.control=value.control;}
  if(Number.isFinite(turn))row.since_turn=turn;
  folded.set(toward,row);
 }
 return [...folded.values()].filter(row=>row.disposition||row.control).slice(-6);
}
/** Epistemic material has one selectable catalog, not a second implicit disclosure path. */
export function decisionCharacter(person:Row):Row {
 const result=Object.fromEntries(Object.entries(person).filter(([key])=>!(MATERIAL_FIELDS as readonly string[]).includes(key)&&!['observed_documents','tried','last_public_rendering'].includes(key)));
 // §258.7: the Keeper reads attitude parsed, one row per target.
 const attitude=attitudeRows(person.relationships);
 if(attitude.length)result.attitude=attitude;
 if(result.ledger&&typeof result.ledger==='object'){
  const {intents,...ledger}=result.ledger;result.ledger=ledger;
 }
 return result;
}
/** An exhibit selection the host refuses whole; the message is the repair the Keeper reads. */
export class ExhibitRefusal extends Error {reason:'unissued'|'carrier_absent'|'not_owner'|'testimony_revealed';ref:string;constructor(message:string,reason:'unissued'|'carrier_absent'|'not_owner'|'testimony_revealed',ref:string){super(message);this.reason=reason;this.ref=ref;}}
interface Fact {ref:string;actor?:string;kind:string;availability:'current'|'supplemental';value:unknown;revision:string;told?:Row;content:string}
/** §258.3: one selected item as the host records it: a stable content identity and how it is said. Host-only. */
export interface TellingUnit {content_id:string;kind:string;strategy:typeof TELLING[number];gist?:string;told_times?:number;heard_from?:string}
const counted=(counts:Row)=>TELLING.reduce((sum,key)=>sum+(Number(counts?.[key])||0),0);
const gistOf=(value:unknown):string|undefined=>{
 const row=value&&typeof value==='object'?value as Row:{};
 const text=typeof value==='string'?value:[row.statement,row.summary,row.text,row.writing,row.label].find(item=>typeof item==='string'&&item.trim());
 const chosen=typeof text==='string'?text:value&&typeof value==='object'?JSON.stringify(value):undefined;
 return chosen?[...chosen.trim()].slice(0,120).join(''):undefined;
};
const sorted=(value:unknown):unknown=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted((value as Row)[key])])):value;
/** §263.6: what the author is told about released book words. */
/** §263.5: the host's name key for matching table names to the pointer index's printed forms (spelling only). */
const bookKey=(value:unknown):string=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/[\s\u00b7\u30fb\u2027\u2022.]/g,''):'';
/** §263.6: a testimony's authority line, whatever the book's stance. */
export const TESTIMONY_AUTHORITY='What this speaker says, in their terms; render it as their speech and do not judge or correct it in narration.';
export const BOOK_WORDS_AUTHORITY='The book\'s own words for what the investigators perceive; render them faithfully in the play language, do not summarize or add to them.';
/** §261.3: the most characters of one opening passage; a passage ends at a line that closes a sentence once it is this long. */
const OPENING_PASSAGE_CHARS=900;
/**
 * §261.3: `capsule.opening_pages` (`[Original physical page N]` headed text) as passages named by page and order: whole lines,
 * a passage closed at the first sentence end past half the bound, or at the bound.
 */
export function openingPassages(value:unknown):Array<{name:string;text:string}> {
 const text=typeof (value as Row)?.text==='string'?(value as Row).text as string:'';
 const out:Array<{name:string;text:string}>=[];let page=0,part=0,lines:string[]=[];
 const close=()=>{const body=lines.join('\n').trim();if(body&&page)out.push({name:`Original page ${page}, passage ${++part}`,text:body});lines=[];};
 for(const line of text.split('\n')){
  const heading=/^\[Original physical page ([0-9]+)\]$/.exec(line.trim());
  if(heading){close();page=Number(heading[1]);part=0;continue;}
  lines.push(line);
  const size=lines.join('\n').length;
  if(size>=OPENING_PASSAGE_CHARS||size>=OPENING_PASSAGE_CHARS/2&&/[.!?\u3002\uff01\uff1f]["'\u201d\u2019)]?$/.test(line.trim()))close();
 }
 close();
 return out;
}
/** §258.3: a content identity, explicit per source kind so two kinds never collide. */
const contentId=(prefix:string,key:unknown)=>`${prefix}:${createHash('sha256').update(JSON.stringify(sorted(key))).digest('hex').slice(0,24)}`;
function factContentId(evidence:string,value:unknown,actor:string|undefined):string {
 const row=value&&typeof value==='object'?value as Row:{};
 const id=[row.memory_id,row.id].find(item=>typeof item==='string'&&item.trim());
 if(id)return contentId('m',id);
 if(typeof row.event_material==='string')return contentId('e',[row.event_ref,row.event_material]);
 if(evidence==='discovered_source_clue'&&typeof row.name==='string')return contentId('c',row.name);
 return contentId('h',{actor:actor??null,text:gistOf(value)??null});
}
/** Aliases survive unchanged material; current issuance and scoped contents do not. */
export class DecisionContent {
 private scope='';private ordinal=0;private aliases=new Map<string,string>();
 private facts=new Map<string,Fact>();private active=new Set<string>();private entities=new Set<string>();
 private people=new Set<string>();private listenerAliases=new Map<string,string|null>();
 private places=new Set<string>();
 private entityLabels=new Map<string,string>();
 private exhibitRows=new Map<string,Row>();private handleRefs=new Map<string,string>();private activeExhibits=new Set<string>();private exhibitOrdinal=0;private exhibitsOmitted=0;private exhibitsGiven=false;
  /** §257.17: testimony already said at this table, by exhibit id, per play line (campaign, worldline, loop); outlives the turn scope. */
  private said=new Map<string,Set<string>>();private line='';
 /** §263.5: released looks owed this turn, handed to the author without a selection. */
 private autoBook:string[]=[];private placesShown=new Set<string>();private pendingPlaces:string[]=[];private bookMeta=new Map<string,{kind:string;forms:string[]}>();
 private reads=new Map<string,Row>();private told=new Map<string,Map<string,Row>>();private heard=new Map<string,Row[]>();private sourceRevision:unknown;private bytes=0;private omitted=0;private previous=new Set<string>();
 assertCurrent(capsule:Row):void {if(this.sourceRevision!==undefined&&this.sourceRevision!==(capsule._context?.task_source_revision??capsule._context?.source_revision))throw Error('Prepared communication source revision changed');}
 forScope(scope:string,line?:string):void {if(line!==undefined)this.line=line;else if(scope!==this.scope)this.line=scope;if(scope!==this.scope){this.scope=scope;this.active.clear();this.entities.clear();this.people.clear();this.places.clear();this.listenerAliases.clear();this.entityLabels.clear();this.reads.clear();this.facts.clear();this.exhibitRows.clear();this.activeExhibits.clear();this.handleRefs.clear();}}
 observePerson(value:Row):void {if(isNpcReference(value.ref))this.reads.set(value.ref,structuredClone(value));}
 prepare(scope:string,capsule:Row,people:Row[],sources:Row[]=[],investigators:string[]=[],issuedPeople:string[]=[],prepared:Row[]=[],exhibits:Row[]=[],book?:Row[],plans:Row[]=[]):Row {
  this.forScope(scope);this.active.clear();this.activeExhibits.clear();this.exhibitsOmitted=0;this.exhibitsGiven=exhibits.length>0;this.entities.clear();this.people.clear();this.places.clear();this.listenerAliases.clear();this.entityLabels.clear();this.bytes=0;this.omitted=0;this.sourceRevision=capsule._context?.task_source_revision??capsule._context?.source_revision;
  for(const [i,name] of investigators.entries()){
   const ref=`investigator_${i+1}`;this.entities.add(ref);this.people.add(ref);this.listenerAlias(name,ref);this.entityLabels.set(ref,name);
   const known=capsule.known?.investigator;
   if(known?.name===name&&typeof known.id==='string')this.listenerAlias(known.id,ref);
  }
  for(const ref of issuedPeople)if(isNpcReference(ref)){this.entities.add(ref);this.people.add(ref);}
  const cast=[...rows(capsule.npc_references?.people),...rows(capsule.present),...people,...this.reads.values()];
  // §258.4: what each present person already told whom, from their read; it marks the rows issued to them.
  this.told.clear();this.heard.clear();
  for(const person of cast)if(isNpcReference(person.ref)&&Array.isArray(person.told)&&!this.told.has(person.ref))
   this.told.set(person.ref,new Map(rows(person.told).filter(item=>typeof item.content_id==='string').map(item=>[item.content_id,item])));
  const publicAliases=new Map<string,Set<string>>();
  const aliasKey=(value:string)=>value.normalize('NFKC').trim().toLowerCase();
  for(const person of cast)if(isNpcReference(person.ref))for(const key of ['ref','id','name','display_name'])if(typeof person[key]==='string'){
   const keyValue=aliasKey(person[key]),refs=publicAliases.get(keyValue)??new Set<string>();
   refs.add(person.ref);publicAliases.set(keyValue,refs);
  }
  const ownPublicSpeech=(value:Row,person:Row,field:string)=>{
   if(!value||value.authority!=='conversation_report'||value.attribution?.kind!=='speech'
    ||value.attribution.speaker?.kind!=='npc'||typeof value.statement!=='string'||!Number.isSafeInteger(value.turn))return false;
   const speaker=value.attribution.speaker.name;
   const refs=typeof speaker==='string'?publicAliases.get(aliasKey(speaker)):undefined;
   return field==='recent_speech'||refs?.size===1&&refs.has(person.ref);
  };
  for(const person of cast)if(isNpcReference(person.ref)){
   this.entities.add(person.ref);this.people.add(person.ref);if(typeof person.id==='string')this.handleRefs.set(person.id,person.ref);
   if(typeof person.display_name==='string'){this.listenerAlias(person.display_name,person.ref);this.entityLabels.set(person.ref,person.display_name);}
  }
  for(const key of ['scene'])if(typeof capsule.where?.[key]==='string'){this.entities.add(capsule.where[key]);this.places.add(capsule.where[key]);}
  if(typeof capsule.where?.display_name==='string')this.entityLabels.set(capsule.where.scene,capsule.where.display_name);
  const visit=(value:unknown)=>{if(!value||typeof value!=='object')return;
   if(Array.isArray(value)){value.forEach(visit);return;}const row=value as Row;
   for(const key of ['to','id','handle','name','ref'])if(typeof row[key]==='string'&&row[key].length<=96)this.entities.add(row[key]);
   const id=row.to??row.ref??row.id??row.handle??row.name;
   if(typeof id==='string'&&typeof row.display_name==='string')this.entityLabels.set(id,row.display_name);
  };
  const visitPlaces=(values:unknown)=>{visit(values);for(const row of rows(values)){const ref=row.to??row.ref??row.id??row.name;if(typeof ref==='string')this.places.add(ref);}};
  visitPlaces(capsule.where?.exits);visitPlaces(capsule.where?.back);visitPlaces(capsule.where?.places);visitPlaces(capsule.known_places);visitPlaces(capsule.exits);visit(capsule.nearby);visit(capsule.objects);visit(capsule.inventory);
  for(const candidate of prepared){visit(candidate.operation?.effects);visitPlaces(rows(candidate.operation?.effects).filter(effect=>effect.kind==='move'));}
  for(const section of Object.values(capsule.known??{}))visit(section);
  for(const document of rows(capsule.own?.documents))if(typeof document.text==='string'&&document.text.trim())
   this.issue('fact',document,undefined,'current_document','current');
  for(const person of cast){
   if(!isNpcReference(person.ref))continue;
   // §258.11: this person's open offers and accepted deals, or a deal owed to them, before their other words claim the same content.
   for(const deal of rows(person.deals))if(typeof deal.content_id==='string'&&typeof deal.by==='string'){
    const own=deal.by===person.ref,by=this.entityLabels.get(deal.by)??deal.by,parties=(Array.isArray(deal.with??deal.to)?(deal.with??deal.to) as unknown[]:[]).filter((ref):ref is string=>typeof ref==='string').map(ref=>this.entityLabels.get(ref)??ref);
    this.issue('fact',{statement:deal.gist??'(offer)',by,to:parties,status:deal.status,made_turn:deal.made_turn,content_id:deal.content_id,
     authority:deal.status==='open'
      ?`An offer ${own?'this person':by} made to ${parties.join(', ')}; still open, nothing is agreed until it is accepted. Play what happens to it; the host reads from the delivered reply whether it was accepted, declined or taken back and records it (§258.13). A {kind:"agreement",proposal:<this fact's ref>,status} command is optional.`
      :`A deal: ${own?'this person':by} owes it to ${parties.join(', ')} since it was accepted; it is ${own?'their own':by+'\'s'} obligation until kept or broken. Play it honestly: the host reads from the delivered reply whether it was carried out or broken and records it (§258.13). A {kind:"agreement",proposal:<this fact's ref>,status} command is optional.`},
     person.ref,deal.status==='open'?'proposal':'commitment');
   }
   for(const field of MATERIAL_FIELDS){
    const values=Array.isArray(person[field])?person[field]:[];
    for(const value of values){const content=typeof value==='string'?value:typeof value?.statement==='string'||field==='knows'&&typeof value?.summary==='string'?value:undefined;
     if(content===undefined)continue;
     const own=ownPublicSpeech(content,person,field);
     // The person's own earlier line is attributed by the name the player knows them by: the book name of someone not yet
     // named to the investigator reached the prose as "<book name> said so" (PipiCOC app, Blood Road 2026-10-23).
     const shown=own&&typeof person.display_name==='string'?{...content,attribution:{...content.attribution,speaker:{...content.attribution.speaker,name:person.display_name}}}:content;
     this.issue('fact',shown,person.ref,own?'public_speech_history':field);
    }
   }
   // §258.8: what others said in this person's hearing, as attributed hearsay that is never their own knowledge or promise.
   if(rows(person.heard).length&&!this.heard.has(person.ref))this.heard.set(person.ref,rows(person.heard));
   for(const item of rows(person.heard))if(typeof item.gist==='string'&&typeof item.content_id==='string'){
    const by=typeof item.said_by==='string'?this.entityLabels.get(item.said_by)??item.said_by:'someone';
    this.issue('fact',{said_by:by,statement:item.gist,turn:item.turn,content_id:item.content_id,
     authority:`What ${by} said in this person's hearing; attribute it to ${by}, it is not this person's own knowledge or promise.`},person.ref,'heard');
   }
   // §258.9: what the investigators said to this person or in their hearing: their claim, never verified truth.
   for(const item of rows(person.party_said))if(typeof item.gist==='string'&&typeof item.content_id==='string'){
    const by=typeof item.said_by==='string'?this.entityLabels.get(item.said_by)??item.said_by:'the investigator';
    this.issue('fact',{said_by:by,statement:item.gist,turn:item.turn,content_id:item.content_id,...(item.to_me?{to_me:true}:{}),
     authority:`What ${by} said or did ${item.to_me?'to this person':'in this person\'s hearing'}, as the player wrote it; this person knows it was said, and it is ${by}'s claim, not verified truth.`},person.ref,'party_said');
   }
   for(const document of rows(person.observed_documents))if(typeof document.writing==='string'&&document.writing.trim())
    this.issue('fact',document,person.ref,'observed_document');
   for(const intent of [...rows(person.ledger?.intents),...rows(person.tried)]){
    const statement=intent.intent??intent.text;
    if(typeof statement==='string'&&statement.trim())this.issue('fact',{statement,status:intent.status,
     since_turn:intent.since_turn,turn:intent.last_turn??intent.turn},person.ref,'npc_intention');
   }
  }
  for(const clue of rows(capsule.known?.clues_here))if(clue.discovered===true&&typeof clue.summary==='string')
   this.issue('fact',{name:clue.name,summary:clue.summary},undefined,'discovered_source_clue','current');
  for(const item of exhibits)this.issueExhibit(item);
  for(const material of rows(capsule.outcome?.public_materials))if(material.visibility==='player')this.issue('fact',material,undefined,'canonical_material','current');
  for(const source of sources)if(typeof source.text==='string'&&source.text.trim())this.issue('source',{name:source.name,text:source.text,authority:source.authority??'reference_only'},undefined,'reference_only');
  // §263.5: under pointer reading only released book words are selectable; the opening's pages stay Keeper context.
  this.autoBook=[];this.pendingPlaces=[];this.bookMeta.clear();
  if(book){
   // §263.5: a person owed first sight with no book words of their own gets their released look without a selection.
   const owed=new Set(rows(capsule.first_sight?.people).filter(item=>item.undescribed===true).map(item=>bookKey(item.name)).filter(Boolean));
   for(const person of rows(capsule.present))if(rows(capsule.first_sight?.people).some(item=>item.undescribed===true&&[person.id,person.ref,person.name].includes(item.id)))
    for(const key of [person.display_name,person.name])if(typeof key==='string')owed.add(bookKey(key));
   for(const passage of book){
    this.issue('source',{name:`Book p${passage.page}: ${passage.kind} of ${passage.entity}`,text:passage.text,authority:BOOK_WORDS_AUTHORITY},undefined,'book_words');
    const ref=this.aliases.get(digest({kind:'source',value:{name:`Book p${passage.page}: ${passage.kind} of ${passage.entity}`,text:passage.text,authority:BOOK_WORDS_AUTHORITY},actor:undefined,evidence:'book_words'}));
    const forms:string[]=Array.isArray(passage.forms)?passage.forms:[bookKey(passage.entity)];
    if(ref)this.bookMeta.set(ref,{kind:passage.kind,forms});
    if(ref&&this.active.has(ref)&&passage.kind==='appearance'&&forms.some(form=>owed.has(form)))this.autoBook.push(ref);
    // §263.5: the first turn a place's own released description is in scope at this table, it is handed over too.
    const place=String(capsule.where?.scene??capsule.where?.display_name??'');
    if(ref&&this.active.has(ref)&&passage.kind==='description'&&place&&!this.placesShown.has(`${place}\u0000${ref}`)&&forms.some(form=>bookKey(capsule.where?.display_name).includes(form)||form.includes(bookKey(capsule.where?.display_name))&&bookKey(capsule.where?.display_name).length>=3)){
     this.autoBook.push(ref);this.pendingPlaces.push(`${place}\u0000${ref}`);
    }
   }
  }
  // §261.3: the opening's own pages, in passages the Keeper can hand the author as the book's words for what is perceived here.
  else for(const passage of openingPassages(capsule.opening_pages))this.issue('source',{...passage,authority:'reference_only'},undefined,'reference_only');
  for(const entry of rows(capsule.public_scene?.entries))if(typeof entry.text==='string'&&entry.text.trim())
   this.issue('fact',{turn:entry.turn,text:entry.text,...(entry.truncated?{truncated:true}:{})},undefined,'public_scene_history');
  const reused=[...this.active].filter(ref=>this.previous.has(ref)).length;this.previous=new Set(this.active);
  return {coverage:{issued:this.active.size,reused_refs:reused,omitted:this.omitted,byte_limit:32768,...(this.exhibitsGiven?{exhibits:{issued:this.activeExhibits.size,omitted:this.exhibitsOmitted}}:{})},facts:[...this.active].map(key=>{const {revision,content:_content,...fact}=this.facts.get(key)!;return fact;}),entities:[...this.entities],
   ...([...this.active].some(key=>this.facts.get(key)?.told)?{telling:'A fact marked told was already said by its actor to the listeners named (times, last turn). Select it again only when it serves this exchange, with strategy: refer (brief back-reference, the default), restate (the player asked to hear it again), clarify (explain what was misunderstood) or update (only beside a new item). told earlier means it was said before the counts began.'}:{}),
   ...(this.activeExhibits.size?{exhibits:[...this.activeExhibits].map(ref=>this.exhibitRows.get(ref)!.catalog)}:{}),
   // §263.10: the book's standing Keeper truth for who and what is here; reading only, never selectable for the author.
   ...(plans.length?{book_truth:{authority:'Keeper-only: what the book has already decided about the people and place here (plans, conditions, secrets, and evidence rows quoting the book), with pages. A plan or condition about a person present is what that person does now unless play has already changed it: their answers and offers follow it (a stall stays a stall). Never hand these rows to the author or say them before the book lets them out.',rows:structuredClone(plans)}}:{}),
   authority:'Exact prepared content references only. Actor-scoped facts belong to that actor; a report, belief or plan is not world truth. A selection is not a transaction or proof of delivery.'};
 }
 private issue(kind:'fact'|'source',value:unknown,actor:string|undefined,evidence:string,availability:'current'|'supplemental'='supplemental'):void {
  const identity=digest({kind,value,actor,evidence});let ref=this.aliases.get(identity);
  if(ref&&this.active.has(ref))return;
  const cost=Buffer.byteLength(JSON.stringify(value))+320;
  if(this.active.size>=256||cost>16000||this.bytes+cost>32768){this.omitted++;return;}
  if(!ref){if(this.aliases.size>=2048)this.aliases.delete(this.aliases.keys().next().value!);ref=`${kind}_${++this.ordinal}`;this.aliases.set(identity,ref);}
  const content=this.contentOf(evidence,value,actor);
  // §258.3: one row per content for a person; a second wording of the same told answer is not a second item.
  if(actor&&[...this.active].some(key=>this.facts.get(key)?.actor===actor&&this.facts.get(key)?.content===content))return;
  this.bytes+=cost;
  const told=actor?this.toldMark(actor,content,evidence,value):undefined;
  this.facts.set(ref,{ref,...(actor?{actor}:{}),kind:evidence,availability,value:structuredClone(value),...(told?{told}:{}),revision:identity,content});this.active.add(ref);
 }
 /**
  * §258.3: a person's own earlier words are the content that turn's selection gave them: when exactly one told row of theirs
  * was delivered at the words' turn, the words carry that row's identity, so a reworded answer counts as the same item.
  */
 private contentOf(evidence:string,value:unknown,actor:string|undefined):string {
  const turn=(value as Row)?.turn;
  if(['heard','party_said','proposal','commitment'].includes(evidence)&&typeof (value as Row)?.content_id==='string')return (value as Row).content_id;
  if(actor&&['public_speech_history','recent_speech'].includes(evidence)&&Number.isSafeInteger(turn)){
   const rows=[...this.told.get(actor)?.values()??[]].filter(row=>Array.isArray(row.turns)&&row.turns.includes(turn));
   if(rows.length===1)return rows[0].content_id;
  }
  return factContentId(evidence,value,actor);
 }
 /** §258.4: the compact told mark a catalog row carries: per listener how often, and when last. */
 private toldMark(actor:string,content:string,evidence:string,value:unknown):Row|undefined {
  const row=this.told.get(actor)?.get(content);
  if(row){
   const to=Object.fromEntries(Object.entries(row.to??{}).flatMap(([listener,counts])=>{
    const times=counted(counts as Row),unverified=Number((counts as Row).unverified)||0;
    return times||unverified?[[listener,unverified&&!times?{unverified}:times]]:[];
   }));
   if(Object.keys(to).length)return {to,last_turn:row.last_turn};
  }
  // Their own earlier words and their own promises were said before any count: told, at the turn they carry.
  if(['commitments','public_speech_history','recent_speech'].includes(evidence)){
   const turn=(value as Row)?.valid_from_turn??(value as Row)?.turn;
   return {earlier:true,...(Number.isSafeInteger(turn)?{turn}:{})};
  }
  return undefined;
 }
 /**
  * §258.3: the host's record of one selected item. A told item is said as `refer` unless the Keeper chose how; it counts as
  * told only when every addressed listener was told it. `told_times` is the fewest times any addressed listener heard it.
  */
 private unit(content:Row,actor:string,to:string[]):TellingUnit|undefined {
  let id:string,kind:string,gist:string|undefined,marked:Row|undefined;
  if(content.result_ref)return undefined;
  if(content.new){
   id=contentId('n',{actor,value:content.new});kind=`new:${content.new.predicate}`;gist=gistOf(content.new);
   // §258.8: the same constructor someone else said in this person's hearing is hearsay, not their own new item.
   const heard=(this.heard.get(actor)??[]).find(row=>typeof row.said_by==='string'&&contentId('n',{actor:row.said_by,value:content.new})===row.content_id);
   if(heard)return {content_id:heard.content_id,kind:'heard',strategy:content.strategy??'new',...(gist?{gist}:{}),heard_from:heard.said_by};
  }
  else if(content.exhibit_ref){const issued=this.exhibitRows.get(content.exhibit_ref);if(!issued)return undefined;id=contentId('x',issued.exhibit_id);kind='exhibit';gist=gistOf(issued.label);}
  else{
   const fact=this.facts.get(content.fact_ref??content.source_ref);if(!fact)return undefined;
   id=content.source_ref?contentId('s',(fact.value as Row)?.name??fact.revision):fact.content;
   kind=fact.kind;gist=gistOf(fact.value);marked=fact.told;
  }
  const row=this.told.get(actor)?.get(id),listeners=to.length?to:[...this.people].filter(ref=>ref.startsWith('investigator_'));
  const times=row&&listeners.length?Math.min(...listeners.map(listener=>counted(row.to?.[listener]))):marked?.earlier?1:0;
  const strategy=content.strategy??(times>0?'refer':'new');
  return {content_id:id,kind,strategy,...(gist?{gist}:{}),...(times?{told_times:times}:{})};
 }
 /**
  * §257.7: one exhibit the table may reveal now. The Keeper's catalog entry never holds the surface; the host row keeps only
  * what settlement needs (the exhibit id and its label). Shares the catalog's byte budget and caps its own count.
  */
 private issueExhibit(item:Row):void {
  if(typeof item.exhibit_id!=='string'||typeof item.kind!=='string')return;
  const identity=digest({kind:'exhibit',id:item.exhibit_id});let ref=this.aliases.get(identity);
  if(ref&&this.activeExhibits.has(ref))return;
  // §257.17: a testimony exhibit is issued with the npc references of its owners; one nobody here can speak is not issued.
  const owners=item.kind==='testimony'?[...new Set((Array.isArray(item.owners)?item.owners:[]).flatMap((handle:unknown)=>typeof handle==='string'&&this.handleRefs.has(handle)?[this.handleRefs.get(handle)!]:[]))]:undefined;
  if(owners&&!owners.length)return;
  const state=item.clue?.state,check=item.clue?.check,needs=typeof check?.skill==='string'?`${check.skill}${check.difficulty?` (${check.difficulty})`:''}`:undefined;
  const catalog:Row={ref:'',kind:item.kind,channel:item.channel,carrier:item.carrier?.display_name,label:item.label,
   ...(owners?{owners}:{}),...(typeof item.stance==='string'?{stance:item.stance}:{}),
   ...(typeof state==='string'?{clue:state==='needs'&&needs?`needs ${needs}`:state}:{}),...(item.kind==='testimony'&&this.said.get(this.line)?.has(item.exhibit_id)?{said:true}:{})};
  const cost=Buffer.byteLength(JSON.stringify(catalog))+160;
  if(this.activeExhibits.size>=48||this.bytes+cost>32768){this.exhibitsOmitted++;return;}
  if(!ref){if(this.aliases.size>=2048)this.aliases.delete(this.aliases.keys().next().value!);ref=`exhibit_${++this.exhibitOrdinal}`;this.aliases.set(identity,ref);}
  catalog.ref=ref;this.bytes+=cost;
  this.exhibitRows.set(ref,{exhibit_id:item.exhibit_id,kind:item.kind,label:item.label,carrier:item.carrier?.display_name,...(owners?{owners}:{}),catalog});this.activeExhibits.add(ref);
 }
 /** §257.17: record the testimony a settled packet had its owners say, so a later catalog marks it `said`. */
 markSaid(selected:string[]):void {
  const ids=selected.flatMap(ref=>{const issued=this.exhibitRows.get(ref);return issued?.kind==='testimony'?[String(issued.exhibit_id)]:[];});
  if(!ids.length)return;
  let said=this.said.get(this.line);if(!said){said=new Set();this.said.set(this.line,said);}
  for(const id of ids)said.add(id);
 }
 /** Whether the issued exhibit is testimony, which is said in an interaction's content and never revealed. */
 exhibitIsTestimony(ref:string):boolean {return this.exhibitRows.get(ref)?.kind==='testimony';}
 /** The exhibit references this turn's catalog issued, for the decision-content telemetry. */
 exhibitIssue():{issued:string[];omitted:number} {return {issued:[...this.activeExhibits],omitted:this.exhibitsOmitted};}
 /**
  * §257.7/C3: settle the exhibits a packet reveals against the kernel's current scope. An exhibit whose carrier is no longer
  * here is refused whole with a repair naming it. Each undiscovered clue an exhibit teaches becomes the clue's ordinary
  * discovery effect (its own validation applies); a discovered clue gets none. The author receives the surface only.
  */
 settleExhibits(reveal:unknown[],current:Row[],interactions:{actor:string;content?:unknown[]}[]=[]):{effects:Row[];selected:string[];authors:Map<string,Row>;taughtBy:Map<string,string>} {
  const effects:Row[]=[],selected:string[]=[],authors=new Map<string,Row>(),taughtBy=new Map<string,string>();
  // §257.17: what a person says is settled with what the investigators read; the speaker must be an owner of the testimony.
  const asked=[...reveal.map(content=>({content,actor:undefined as string|undefined})),...interactions.flatMap(response=>(response.content??[]).map(content=>({content,actor:response.actor as string|undefined})))];
  for(const {content,actor} of asked){
   const ref=(content as Row)?.exhibit_ref;if(typeof ref!=='string')continue;
   const issued=this.exhibitRows.get(ref);
   if(!issued||!this.activeExhibits.has(ref))throw new ExhibitRefusal(`Exhibit ${ref} is not issued for this turn; select one from decision_materials.exhibits`,'unissued',ref);
   this.assertSpeaker(ref,issued,actor);
   const now=current.find(row=>row.exhibit_id===issued.exhibit_id);
   if(!now)throw new ExhibitRefusal(issued.kind==='testimony'
     ?`Exhibit ${ref} (${issued.label}) cannot be spoken: ${this.ownerNames(issued)} ${issued.owners.length>1?'are':'is'} not here now. Leave {exhibit_ref:"${ref}"} out of interactions, or speak it once an owner is in the scene.`
     :`Exhibit ${ref} (${issued.label}) cannot be revealed: its carrier, ${issued.carrier}, is not here now. Leave {exhibit_ref:"${ref}"} out of reveal, or reveal it once its carrier is in the scene.`,'carrier_absent',ref);
   if(!selected.includes(ref))selected.push(ref);
   for(const state of rows(now.clue_states))if(state.state!=='discovered'&&typeof state.clue==='string'&&!taughtBy.has(state.clue)){taughtBy.set(state.clue,ref);effects.push({kind:'clue',clue:state.clue,via_exhibit:String(issued.exhibit_id)});}
   const surface=now.surface??{};
   if(now.kind==='testimony'){
    // The speaker's claim: what is said, how it is held, never what it teaches or where the book keeps it.
    // §263.6: no stance reaches the author; how it is said is the Keeper's `delivery`, never the truth of what is said.
    authors.set(ref,{kind:'exhibit',exhibit:{kind:'testimony',channel:now.channel,surface:surface.text},authority:TESTIMONY_AUTHORITY});
    continue;
   }
   authors.set(ref,{kind:'exhibit',exhibit:{kind:now.kind,channel:now.channel,...(typeof now.carrier?.public_label==='string'?{carrier:now.carrier.public_label}:{}),surface:surface.text},
    authority:surface.verbatim===true?'Render faithfully in the play language; do not summarize.':'Perceivable book material; render it in the play language without adding what it does not show.'});
  }
  return {effects,selected,authors,taughtBy};
 }
 private ownerNames(issued:Row):string {return (issued.owners as string[]).map(owner=>this.entityLabels.has(owner)?`${owner} (${this.entityLabels.get(owner)})`:owner).join(', ');}
 /** Reveal takes no testimony; speech takes testimony only from its owners, and the refusal names them. */
 private assertSpeaker(ref:string,issued:Row,actor:string|undefined):void {
  if(issued.kind==='testimony'){
   if(actor===undefined)throw new ExhibitRefusal(`Exhibit ${ref} (${issued.label}) is testimony: a person says it, so it belongs in an interaction's content, not in reveal. Its owners: ${this.ownerNames(issued)}.`,'testimony_revealed',ref);
   if(!(issued.owners as string[]).includes(actor))throw new ExhibitRefusal(`Exhibit ${ref} (${issued.label}) can be said only by its owners: ${this.ownerNames(issued)}. ${actor} is not one of them; give the interaction to an owner or leave {exhibit_ref:"${ref}"} out.`,'not_owner',ref);
  }else if(actor!==undefined)throw new ExhibitRefusal(`Exhibit ${ref} (${issued.label}) is a ${issued.kind} the investigators read or perceive; a person does not speak it. Select it in reveal.`,'not_owner',ref);
 }
 /** Replace each speaker-claim placeholder with the author's claim for that exhibit. */
 authorClaims(responses:HydratedInteraction[],authors:Map<string,Row>):HydratedInteraction[] {
  return responses.map(response=>response.claims?{...response,claims:response.claims.map(claim=>claim.kind==='exhibit'&&typeof claim.ref==='string'
   ?{...authors.get(claim.ref)??(()=>{throw Error('An exhibit selection reached the author unsettled');})(),...(claim.telling?{telling:claim.telling}:{})}:claim)}:response);
 }
 /** Replace the selection placeholders with what the author may see, in the Keeper's order. */
 authorMaterials(materials:Row[],authors:Map<string,Row>):Row[] {
  return materials.map(material=>material.kind==='exhibit'?authors.get(material.ref)??(()=>{throw Error('An exhibit selection reached the author unsettled');})():material);
 }
 addEntities(values:readonly string[]):void {for(const value of values)this.entities.add(value);}
 bindings():DecisionBindings {return {entities:[...this.entities],people:[...this.people],places:[...this.places],facts:[...this.active].filter(ref=>ref.startsWith('fact_')&&!['current_document','public_scene_history'].includes(this.facts.get(ref)?.kind??'')),narrationFacts:[...this.active].filter(ref=>ref.startsWith('fact_')&&!this.facts.get(ref)?.actor),sources:[...this.active].filter(ref=>ref.startsWith('source_')),exhibits:[...this.activeExhibits],revealExhibits:[...this.activeExhibits].filter(ref=>['document','perception'].includes(this.exhibitRows.get(ref)?.kind)),speechExhibits:[...this.activeExhibits].filter(ref=>this.exhibitRows.get(ref)?.kind==='testimony'),factActors:Object.fromEntries([...this.active].flatMap(ref=>this.facts.get(ref)?.actor?[[ref,this.facts.get(ref)!.actor!]]:[]))};}
 private listenerAlias(value:string,ref:string):void {
  const key=value.normalize('NFKC').trim().toLowerCase(),prior=this.listenerAliases.get(key);
  this.listenerAliases.set(key,prior!==undefined&&prior!==ref?null:ref);
 }
 /**
  * §258.11: an agreement mark names an issued proposal or commitment fact; the host turns it into the deal's content and maker.
  * A proposal can be accepted, declined or withdrawn; a commitment kept, broken or withdrawn.
  */
 agreement(mark:{proposal:string;status:string;with?:string[]}):Row {
  const fact=this.facts.get(mark.proposal);
  if(!fact||!this.active.has(mark.proposal)||!['proposal','commitment'].includes(fact.kind)||!fact.actor)
  {const open=[...this.active].filter(ref=>['proposal','commitment'].includes(this.facts.get(ref)?.kind??''));
   // §264.12: say which marks exist; with none, an accepted deal nobody offered as a service needs no mark.
   throw Error(`agreement ${mark.proposal} is not an issued proposal or commitment fact; `+(open.length?`name one of: ${open.join(', ')}`
    :'none is issued this turn, so drop the agreement command: a deal accepted in conversation is recorded by its own effects (a flag, cash, an object), not by a mark'));}
  const allowed=fact.kind==='proposal'?['accepted','declined','withdrawn']:['kept','broken','withdrawn'];
  if(!allowed.includes(mark.status))throw Error(`agreement ${mark.proposal} is a ${fact.kind}: its status is one of ${allowed.join(', ')}`);
  return {content_id:fact.content,by:fact.actor,status:mark.status,...(mark.with?.length?{with:[...mark.with]}:{})};
 }
 resolve(content:unknown,actor?:string):Row {
  if(!content||typeof content!=='object'||Array.isArray(content))throw Error('Invalid communication content');
  const selected=content as Row;
  if(selected.result_ref)return {kind:'canonical_result',field:selected.result_ref,authority:'Use the actual post-settlement scene, clock or outcomes from the host; this reference does not assert success'};
  if(selected.new){
   const fact=selected.new;
   if(typeof fact.actor==='string'&&!this.people.has(fact.actor)&&!/^new_[1-4]$/.test(fact.actor))throw Error('A communication subject must select an issued person reference');
   if(typeof fact.to==='string'&&!this.places.has(fact.to))throw Error('A communication destination must select an issued place reference');
   for(const place of fact.via??[])if(!this.places.has(place))throw Error('A communication waypoint must select an issued place reference');
   for(const key of ['provider','actor','to','topic'])if(typeof fact[key]==='string'&&!this.entities.has(fact[key])&&!(key==='topic'&&fact[key]===ASKED_TOPIC))throw Error(`New communication content ${key} must select an issued entity reference`);
   for(const item of [...fact.items??[],...fact.via??[]])if(typeof item==='string'&&!this.entities.has(item))throw Error('New communication content uses an unissued item or waypoint reference');
   // §258.5: a service serves things; a person named as an item is an invented appointment.
   if(fact.predicate==='service_at'&&(fact.items??[]).some((item:unknown)=>typeof item==='string'&&(this.people.has(item)||/^new_[1-4]$/.test(item))))
    throw Error('service_at items are what is served, never a person; with nothing to offer, use greet or acknowledge, or answer with knowledge_status nothing_more');
   const refs=[fact.provider,fact.actor,fact.to,fact.topic,...fact.items??[],...fact.via??[]].filter((value):value is string=>typeof value==='string');
   return {kind:'proposed_claim',value:structuredClone(fact),entities:[...new Set(refs)].flatMap(ref=>this.entityLabels.has(ref)?[{ref,display_name:this.entityLabels.get(ref)}]
     :ref===ASKED_TOPIC?[{ref,display_name:'what the investigator just asked about (player_input)'}]:[]),authority:'Communication content only; not a receipt, truth, order or completed action'};
  }
  if(selected.exhibit_ref!==undefined){
   const issued=this.exhibitRows.get(selected.exhibit_ref);
   if(!issued||!this.activeExhibits.has(selected.exhibit_ref))throw Error('Unissued, retired or wrong-kind communication reference');
   this.assertSpeaker(selected.exhibit_ref,issued,actor);
   return {kind:'exhibit',ref:selected.exhibit_ref};
  }
  const key=selected.fact_ref??selected.source_ref,fact=this.facts.get(key);
  if(!fact||!this.active.has(key)||(selected.source_ref!==undefined)!==key.startsWith('source_'))throw Error('Unissued, retired or wrong-kind communication reference');
  if(fact.actor&&fact.actor!==actor)throw Error('This fact belongs to another actor perspective');
  if(actor&&fact.kind==='current_document')throw Error('Private carried writing is narration material; select this actor observed document for its speech');
  if(actor&&fact.kind==='public_scene_history')throw Error('Prior public scene text is narration context, not an actor knowledge grant');
  const {revision,...hydrated}=fact;return structuredClone(hydrated);
 }
 hydrate(interactions:InteractionDecision[],reveal:unknown[]=[],destinations:string[]=[]):{responses:HydratedInteraction[];materials:Row[];units:TellingUnit[][]} {
  // §263.5: a move this packet makes hands over the destination's released description the first time, like an arrival.
  for(const destination of destinations){
   const label=bookKey(this.entityLabels.get(destination)??destination);
   if([...label].length<2)continue;
   for(const [ref,meta] of this.bookMeta)if(['description','read_aloud'].includes(meta.kind)&&this.active.has(ref)&&!this.autoBook.includes(ref)
    &&!this.placesShown.has(`${destination}\u0000${ref}`)&&meta.forms.some(form=>form===label||[...form].length>=3&&label.includes(form)||[...label].length>=3&&form.includes(label))){
    this.autoBook.push(ref);this.pendingPlaces.push(`${destination}\u0000${ref}`);
   }
  }
  const units:TellingUnit[][]=[];
  const responses=interactions.map(response=>{
   const to=response.to?.map(listener=>{
    if(this.people.has(listener)||/^new_[1-4]$/.test(listener))return listener;
    const ref=this.listenerAliases.get(listener.normalize('NFKC').trim().toLowerCase());
    if(!ref)throw Error('Unissued or non-person communication audience');return ref;
   });
   if(to?.includes(response.actor))throw Error('A speaker cannot be its own addressee');
   const contents:Row[]='content'in response?(response.content??[]) as Row[]:[];
   const claims=contents.map(content=>this.resolve(content,response.actor));
   const told=contents.map(content=>this.unit(content,response.actor,to??[]));
   // §258.4: `update` says what changed, so it needs something new beside it.
   if(told.some(item=>item?.strategy==='update')&&!told.some(item=>item?.strategy==='new'))
    throw Error(`${response.actor}: strategy update needs a new item in the same response (the change itself); select it, or say the told item as refer`);
   units.push(told.filter((item):item is TellingUnit=>!!item));
   return {...response,...(to?{to}:{}),...('content'in response?{claims:claims.map((claim,index)=>{
    const item=told[index];
    const by=item?.heard_from?this.entityLabels.get(item.heard_from)??item.heard_from:undefined;
    const attributed=by?{...claim,heard_from:by,authority:`What ${by} said in this person's hearing; attribute it to ${by}, it is not this person's own knowledge or promise.`}:claim;
    return item&&item.strategy!=='new'?{...attributed,telling:{strategy:item.strategy,...(item.told_times?{times:item.told_times}:{})}}:attributed;
   })}:{})};
  });
  const selected=new Set(reveal.map(content=>(content as Row)?.source_ref).filter(Boolean));
  const auto=this.autoBook.filter(ref=>!selected.has(ref)&&this.active.has(ref)).map(ref=>this.resolve({source_ref:ref}));
  for(const key of this.pendingPlaces.splice(0))this.placesShown.add(key);
  return {responses,materials:[...reveal.map(content=>this.resolve(content)),...auto],units};
 }
}

/** One current characterization projection. It carries no knowledge or private dossier. */
export function decisionPerson(person:Row,cast:Row[]):Row {
 const refs=new Map<string,Row>();
 for(const row of cast)if((isNpcReference(row.ref)||typeof row.ref==='string'&&/^investigator_[1-9][0-9]*$/.test(row.ref))&&typeof row.display_name==='string')
  for(const key of ['ref','id','name','display_name'])if(typeof row[key]==='string')refs.set(row[key],row);
 const relationships=rows(person.source_relationships).flatMap(relation=>{
  const target=refs.get(relation.toward);return target?[{toward:target.ref,kind:relation.kind}]:[];
 });
 // §258.7: the author sees only what a person shows toward each target: never a number, a hidden disposition or a mark
 // that something is hidden, so a change to concealed state alone leaves the author input unchanged (§260).
 const conceals=new Set<string>();
 for(const row of attitudeRows(person.relationships)){
  const target=refs.get(row.toward);if(!target)continue;
  const hidden=Array.isArray(row.hidden)?row.hidden:[];
  for(const item of hidden)conceals.add(item);
  const shown=row.public??(hidden.includes('disposition')?'neutral':row.disposition);
  relationships.push({toward:target.ref,public:shown} as any);
 }
 const profile=person.personality?.profile?.profile??person.personality?.profile;
 const voice=Array.isArray(person.voice)?person.voice.filter((line:unknown)=>typeof line==='string'&&line.trim()).join('\n'):'';
 const speech=rows(person.recent_speech).filter(line=>line.authority==='conversation_report'&&line.attribution?.kind==='speech'&&line.attribution?.speaker?.kind==='npc'&&Number.isFinite(Number(line.turn))&&typeof line.statement==='string');
 const lastTurn=Math.max(...speech.map(line=>Number(line.turn)));
 const lastRows=speech.filter(line=>Number(line.turn)===lastTurn).slice(-6),lastSpeech=lastRows.map(line=>line.statement.slice(0,800));
 // §258.9: words said as an aside stay marked with who received them, wherever they are later shown.
 const lastAside=lastRows.some(line=>line.aside===true)?[...new Set(lastRows.flatMap(line=>Array.isArray(line.to)?line.to:[]))]:undefined;
 return {ref:person.ref,name:person.display_name,display_name:person.display_name,name_known:person.name_known===true,
  ...(typeof person.public_appearance==='string'&&person.public_appearance.trim()?{public_appearance:person.public_appearance}:{}),
  ...(person.last_public_rendering?{last_public_rendering:structuredClone(person.last_public_rendering)}:{}),
  ...(lastSpeech.length?{last_public_exchange:{turn:lastTurn,words:lastSpeech,...(lastAside?{aside:true,to:lastAside}:{})}}:{}),
  ...(voice?{speech_style:voice}:typeof profile?.expression==='string'?{speech_style:profile.expression}:{}),
  ...(typeof person.personality?.description==='string'?{personality:{description:person.personality.description,origin:person.personality.origin}}:{}),
  ...(person.variation?{variation:structuredClone(person.variation)}:{}),
  ...(person.activity?.current===true?{activity:Object.fromEntries(['current','summary','wakefulness','basis'].filter(key=>person.activity[key]!==undefined).map(key=>[key,person.activity[key]]))}:{}),
  ...(person.reunion?{reunion:Object.fromEntries(['status','required','elapsed_minutes'].filter(key=>person.reunion[key]!==undefined).map(key=>[key,person.reunion[key]]))}:{}),
  ...Object.fromEntries(['now','state','toward_party'].filter(key=>person[key]!==undefined&&!(key==='now'&&conceals.has('mood'))).map(key=>[key,person[key]])),
  ...(relationships.length?{relationships}:{}),
  authority:'Current public identity and characterization only; relationships are directed and are not additional selected disclosure content'};
}
