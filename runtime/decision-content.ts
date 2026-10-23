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
  {additionalProperties:false,anyOf:[{required:['heading']},{required:['via']},{required:['retrace']}]}),
 closed({predicate:Type.Literal('knowledge_status'),topic:ref,status:StringEnum(['unknown','uncertain','withheld','nothing_more'])}),
 closed({predicate:Type.Literal('input_requirements'),topic:ref,fields:Type.Array(StringEnum(['subject_name','person_name','location','time_range','record_type','purpose','quantity','budget']),{minItems:1,maxItems:8,uniqueItems:true})})
]);
/** §258.4: how a selected item is said to a listener who was already told it; omitted, a told item is said as `refer`. */
export const TELLING=['new','refer','restate','clarify','update'] as const;
const strategy=Type.Optional(StringEnum([...TELLING]));
export const ExistingCommunicationFact=Type.Union([closed({fact_ref:ref,strategy}),closed({source_ref:ref,strategy}),closed({result_ref:StringEnum(['scene','outcomes','clock'])}),closed({exhibit_ref:ref,strategy})]);
export const CommunicationContent=Type.Union([ExistingCommunicationFact,closed({new:NewCommunicationFact,strategy})]);
const actor=Type.String({pattern:"^(npc_[1-9][0-9]*|new_[1-4])$",maxLength:32});
const to=Type.Array(ref,{minItems:1,maxItems:16,uniqueItems:true});
export const Interaction=Type.Union([
 closed({actor,act:Type.Literal('silent'),to:Type.Optional(to)}),
 closed({actor,to,act:StringEnum(['greet','refuse','acknowledge']),content:Type.Optional(Type.Array(CommunicationContent,{minItems:1,maxItems:8}))}),
 closed({actor,to,act:StringEnum(['answer','ask','offer','clarify','report','warn']),content:Type.Array(CommunicationContent,{minItems:1,maxItems:8})})
]);
export type InteractionDecision=Static<typeof Interaction>;
export type HydratedInteraction=InteractionDecision&{claims?:Row[]};
export interface DecisionBindings {entities:string[];people:string[];places:string[];facts:string[];sources:string[];narrationFacts?:string[];factActors?:Record<string,string>;
 /** §257.7: issued exhibit references, and the subsets a reveal and a person's speech may select. */
 exhibits?:string[];revealExhibits?:string[];speechExhibits?:string[]}
/** Prepared schemas and execution use the same issued reference vocabulary. */
export function bindCommunicationParameters(schema:TSchema,bindings:DecisionBindings,narration=false):TSchema {
 const result=structuredClone(schema) as Row;
 const selection=(values:string[],slots=false)=>Type.String({enum:[...new Set([...values,...(slots?['new_1','new_2','new_3','new_4']:[])])]});
 const owned=new Map<string,string[]>();
 for(const [ref,actor] of Object.entries(bindings.factActors??{}))owned.set(actor,[...owned.get(actor)??[],ref]);
 const visit=(value:unknown)=>{
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach(visit);return;}const row=value as Row,p=row.properties;
  if(p?.predicate){for(const key of ['provider','topic'])if(p[key])p[key]=selection(bindings.entities,true);
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
/** Epistemic material has one selectable catalog, not a second implicit disclosure path. */
export function decisionCharacter(person:Row):Row {
 const result=Object.fromEntries(Object.entries(person).filter(([key])=>!(MATERIAL_FIELDS as readonly string[]).includes(key)&&!['observed_documents','tried','last_public_rendering'].includes(key)));
 if(result.ledger&&typeof result.ledger==='object'){
  const {intents,...ledger}=result.ledger;result.ledger=ledger;
 }
 return result;
}
/** An exhibit selection the host refuses whole; the message is the repair the Keeper reads. */
export class ExhibitRefusal extends Error {reason:'unissued'|'carrier_absent'|'not_owner'|'testimony_revealed';ref:string;constructor(message:string,reason:'unissued'|'carrier_absent'|'not_owner'|'testimony_revealed',ref:string){super(message);this.reason=reason;this.ref=ref;}}
interface Fact {ref:string;actor?:string;kind:string;availability:'current'|'supplemental';value:unknown;revision:string;told?:Row;content:string}
/** §258.3: one selected item as the host records it: a stable content identity and how it is said. Host-only. */
export interface TellingUnit {content_id:string;kind:string;strategy:typeof TELLING[number];gist?:string;told_times?:number}
const counted=(counts:Row)=>TELLING.reduce((sum,key)=>sum+(Number(counts?.[key])||0),0);
const gistOf=(value:unknown):string|undefined=>{
 const row=value&&typeof value==='object'?value as Row:{};
 const text=typeof value==='string'?value:[row.statement,row.summary,row.text,row.writing,row.label].find(item=>typeof item==='string'&&item.trim());
 const chosen=typeof text==='string'?text:value&&typeof value==='object'?JSON.stringify(value):undefined;
 return chosen?[...chosen.trim()].slice(0,120).join(''):undefined;
};
const sorted=(value:unknown):unknown=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted((value as Row)[key])])):value;
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
 private reads=new Map<string,Row>();private told=new Map<string,Map<string,Row>>();private sourceRevision:unknown;private bytes=0;private omitted=0;private previous=new Set<string>();
 assertCurrent(capsule:Row):void {if(this.sourceRevision!==undefined&&this.sourceRevision!==(capsule._context?.task_source_revision??capsule._context?.source_revision))throw Error('Prepared communication source revision changed');}
 forScope(scope:string):void {if(scope!==this.scope){this.scope=scope;this.active.clear();this.entities.clear();this.people.clear();this.places.clear();this.listenerAliases.clear();this.entityLabels.clear();this.reads.clear();this.facts.clear();this.exhibitRows.clear();this.activeExhibits.clear();this.handleRefs.clear();}}
 observePerson(value:Row):void {if(isNpcReference(value.ref))this.reads.set(value.ref,structuredClone(value));}
 prepare(scope:string,capsule:Row,people:Row[],sources:Row[]=[],investigators:string[]=[],issuedPeople:string[]=[],prepared:Row[]=[],exhibits:Row[]=[]):Row {
  this.forScope(scope);this.active.clear();this.activeExhibits.clear();this.exhibitsOmitted=0;this.exhibitsGiven=exhibits.length>0;this.entities.clear();this.people.clear();this.places.clear();this.listenerAliases.clear();this.entityLabels.clear();this.bytes=0;this.omitted=0;this.sourceRevision=capsule._context?.task_source_revision??capsule._context?.source_revision;
  for(const [i,name] of investigators.entries()){
   const ref=`investigator_${i+1}`;this.entities.add(ref);this.people.add(ref);this.listenerAlias(name,ref);this.entityLabels.set(ref,name);
   const known=capsule.known?.investigator;
   if(known?.name===name&&typeof known.id==='string')this.listenerAlias(known.id,ref);
  }
  for(const ref of issuedPeople)if(isNpcReference(ref)){this.entities.add(ref);this.people.add(ref);}
  const cast=[...rows(capsule.npc_references?.people),...rows(capsule.present),...people,...this.reads.values()];
  // §258.4: what each present person already told whom, from their read; it marks the rows issued to them.
  this.told.clear();
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
   for(const field of MATERIAL_FIELDS){
    const values=Array.isArray(person[field])?person[field]:[];
    for(const value of values){const content=typeof value==='string'?value:typeof value?.statement==='string'||field==='knows'&&typeof value?.summary==='string'?value:undefined;
     if(content!==undefined)this.issue('fact',content,person.ref,ownPublicSpeech(content,person,field)?'public_speech_history':field);
    }
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
  for(const entry of rows(capsule.public_scene?.entries))if(typeof entry.text==='string'&&entry.text.trim())
   this.issue('fact',{turn:entry.turn,text:entry.text,...(entry.truncated?{truncated:true}:{})},undefined,'public_scene_history');
  const reused=[...this.active].filter(ref=>this.previous.has(ref)).length;this.previous=new Set(this.active);
  return {coverage:{issued:this.active.size,reused_refs:reused,omitted:this.omitted,byte_limit:32768,...(this.exhibitsGiven?{exhibits:{issued:this.activeExhibits.size,omitted:this.exhibitsOmitted}}:{})},facts:[...this.active].map(key=>{const {revision,content:_content,...fact}=this.facts.get(key)!;return fact;}),entities:[...this.entities],
   ...([...this.active].some(key=>this.facts.get(key)?.told)?{telling:'A fact marked told was already said by its actor to the listeners named (times, last turn). Select it again only when it serves this exchange, with strategy: refer (brief back-reference, the default), restate (the player asked to hear it again), clarify (explain what was misunderstood) or update (only beside a new item). told earlier means it was said before the counts began.'}:{}),
   ...(this.activeExhibits.size?{exhibits:[...this.activeExhibits].map(ref=>this.exhibitRows.get(ref)!.catalog)}:{}),
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
  if(content.new){id=contentId('n',{actor,value:content.new});kind=`new:${content.new.predicate}`;gist=gistOf(content.new);}
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
   ...(typeof state==='string'?{clue:state==='needs'&&needs?`needs ${needs}`:state}:{})};
  const cost=Buffer.byteLength(JSON.stringify(catalog))+160;
  if(this.activeExhibits.size>=48||this.bytes+cost>32768){this.exhibitsOmitted++;return;}
  if(!ref){if(this.aliases.size>=2048)this.aliases.delete(this.aliases.keys().next().value!);ref=`exhibit_${++this.exhibitOrdinal}`;this.aliases.set(identity,ref);}
  catalog.ref=ref;this.bytes+=cost;
  this.exhibitRows.set(ref,{exhibit_id:item.exhibit_id,kind:item.kind,label:item.label,carrier:item.carrier?.display_name,...(owners?{owners}:{}),catalog});this.activeExhibits.add(ref);
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
    const stance=typeof now.stance==='string'?now.stance:'fact',unreliable=['lie','deflection'].includes(stance);
    authors.set(ref,{kind:'exhibit',exhibit:{kind:'testimony',channel:now.channel,surface:surface.text,stance},
     authority:unreliable?'What this speaker says, in their terms; not world truth. Render as their speech; do not correct or expose it in narration.':'What this speaker says, in their terms.'});
    continue;
   }
   authors.set(ref,{kind:'exhibit',exhibit:{kind:now.kind,channel:now.channel,...(typeof now.carrier?.public_label==='string'?{carrier:now.carrier.public_label}:{}),surface:surface.text,...(typeof now.stance==='string'?{stance:now.stance}:{})},
    authority:['lie','deflection'].includes(now.stance)?'What this speaker says, in their terms; not world truth. Render as their speech; do not correct or expose it in narration.'
     :surface.verbatim===true?'Render faithfully in the play language; do not summarize.':'Perceivable book material; render it in the play language without adding what it does not show.'});
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
 resolve(content:unknown,actor?:string):Row {
  if(!content||typeof content!=='object'||Array.isArray(content))throw Error('Invalid communication content');
  const selected=content as Row;
  if(selected.result_ref)return {kind:'canonical_result',field:selected.result_ref,authority:'Use the actual post-settlement scene, clock or outcomes from the host; this reference does not assert success'};
  if(selected.new){
   const fact=selected.new;
   if(typeof fact.actor==='string'&&!this.people.has(fact.actor)&&!/^new_[1-4]$/.test(fact.actor))throw Error('A communication subject must select an issued person reference');
   if(typeof fact.to==='string'&&!this.places.has(fact.to))throw Error('A communication destination must select an issued place reference');
   for(const place of fact.via??[])if(!this.places.has(place))throw Error('A communication waypoint must select an issued place reference');
   for(const key of ['provider','actor','to','topic'])if(typeof fact[key]==='string'&&!this.entities.has(fact[key]))throw Error(`New communication content ${key} must select an issued entity reference`);
   for(const item of [...fact.items??[],...fact.via??[]])if(typeof item==='string'&&!this.entities.has(item))throw Error('New communication content uses an unissued item or waypoint reference');
   // §258.5: a service serves things; a person named as an item is an invented appointment.
   if(fact.predicate==='service_at'&&(fact.items??[]).some((item:unknown)=>typeof item==='string'&&(this.people.has(item)||/^new_[1-4]$/.test(item))))
    throw Error('service_at items are what is served, never a person; with nothing to offer, use greet or acknowledge, or answer with knowledge_status nothing_more');
   const refs=[fact.provider,fact.actor,fact.to,fact.topic,...fact.items??[],...fact.via??[]].filter((value):value is string=>typeof value==='string');
   return {kind:'proposed_claim',value:structuredClone(fact),entities:[...new Set(refs)].flatMap(ref=>this.entityLabels.has(ref)?[{ref,display_name:this.entityLabels.get(ref)}]:[]),authority:'Communication content only; not a receipt, truth, order or completed action'};
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
 hydrate(interactions:InteractionDecision[],reveal:unknown[]=[]):{responses:HydratedInteraction[];materials:Row[];units:TellingUnit[][]} {
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
    return item&&item.strategy!=='new'?{...claim,telling:{strategy:item.strategy,...(item.told_times?{times:item.told_times}:{})}}:claim;
   })}:{})};
  });
  return {responses,materials:reveal.map(content=>this.resolve(content)),units};
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
 const affinityTargets=new Set<string>();
 for(const relation of rows(person.relationships)){
  const target=refs.get(relation.toward);if(!target)continue;
  if(affinityTargets.has(target.ref))continue;
  for(const evidence of [relation,...rows(relation.evidence)]){
   let value:Row;try{value=JSON.parse(evidence.statement);}catch{continue;}
   if(value?.kind==='directed_relationship'&&['hostile','guarded','neutral','friendly'].includes(value.affinity)){
    relationships.push({toward:target.ref,affinity:value.affinity} as any);affinityTargets.add(target.ref);break;
   }
  }
 }
 const profile=person.personality?.profile?.profile??person.personality?.profile;
 const voice=Array.isArray(person.voice)?person.voice.filter((line:unknown)=>typeof line==='string'&&line.trim()).join('\n'):'';
 const speech=rows(person.recent_speech).filter(line=>line.authority==='conversation_report'&&line.attribution?.kind==='speech'&&line.attribution?.speaker?.kind==='npc'&&Number.isFinite(Number(line.turn))&&typeof line.statement==='string');
 const lastTurn=Math.max(...speech.map(line=>Number(line.turn)));
 const lastSpeech=speech.filter(line=>Number(line.turn)===lastTurn).slice(-6).map(line=>line.statement.slice(0,800));
 return {ref:person.ref,name:person.display_name,display_name:person.display_name,name_known:person.name_known===true,
  ...(typeof person.public_appearance==='string'&&person.public_appearance.trim()?{public_appearance:person.public_appearance}:{}),
  ...(person.last_public_rendering?{last_public_rendering:structuredClone(person.last_public_rendering)}:{}),
  ...(lastSpeech.length?{last_public_exchange:{turn:lastTurn,words:lastSpeech}}:{}),
  ...(voice?{speech_style:voice}:typeof profile?.expression==='string'?{speech_style:profile.expression}:{}),
  ...(typeof person.personality?.description==='string'?{personality:{description:person.personality.description,origin:person.personality.origin}}:{}),
  ...(person.variation?{variation:structuredClone(person.variation)}:{}),
  ...(person.activity?.current===true?{activity:Object.fromEntries(['current','summary','wakefulness','basis'].filter(key=>person.activity[key]!==undefined).map(key=>[key,person.activity[key]]))}:{}),
  ...(person.reunion?{reunion:Object.fromEntries(['status','required','elapsed_minutes'].filter(key=>person.reunion[key]!==undefined).map(key=>[key,person.reunion[key]]))}:{}),
  ...Object.fromEntries(['now','state','toward_party'].filter(key=>person[key]!==undefined).map(key=>[key,person[key]])),
  ...(relationships.length?{relationships}:{}),
  authority:'Current public identity and characterization only; relationships are directed and are not additional selected disclosure content'};
}
