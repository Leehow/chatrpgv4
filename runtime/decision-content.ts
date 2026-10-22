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
 closed({predicate:Type.Literal('knowledge_status'),topic:ref,status:StringEnum(['unknown','uncertain','withheld'])}),
 closed({predicate:Type.Literal('input_requirements'),topic:ref,fields:Type.Array(StringEnum(['subject_name','person_name','location','time_range','record_type','purpose','quantity','budget']),{minItems:1,maxItems:8,uniqueItems:true})})
]);
export const ExistingCommunicationFact=Type.Union([closed({fact_ref:ref}),closed({source_ref:ref}),closed({result_ref:StringEnum(['scene','outcomes','clock'])})]);
export const CommunicationContent=Type.Union([ExistingCommunicationFact,closed({new:NewCommunicationFact})]);
const actor=Type.String({pattern:"^(npc_[1-9][0-9]*|new_[1-4])$",maxLength:32});
const to=Type.Array(ref,{minItems:1,maxItems:16,uniqueItems:true});
export const Interaction=Type.Union([
 closed({actor,act:Type.Literal('silent'),to:Type.Optional(to)}),
 closed({actor,to,act:StringEnum(['greet','refuse','acknowledge']),content:Type.Optional(Type.Array(CommunicationContent,{minItems:1,maxItems:8}))}),
 closed({actor,to,act:StringEnum(['answer','ask','offer','clarify','report','warn']),content:Type.Array(CommunicationContent,{minItems:1,maxItems:8})})
]);
export type InteractionDecision=Static<typeof Interaction>;
export type HydratedInteraction=InteractionDecision&{claims?:Row[]};
export interface DecisionBindings {entities:string[];people:string[];places:string[];facts:string[];sources:string[];narrationFacts?:string[];factActors?:Record<string,string>}
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
   if(p.items)p.items.items=Type.Union([selection(bindings.entities,true),category]);
   if(p.via)p.via.items=selection(bindings.places);
  }else if(p?.actor&&p?.act){p.actor=selection(bindings.people.filter(isNpcReference),true);if(p.to)p.to.items=selection(bindings.people,true);}
  if(p?.fact_ref)p.fact_ref=selection(narration?bindings.narrationFacts??bindings.facts:bindings.facts);
  if(p?.source_ref)p.source_ref=selection(bindings.sources);
  for(const child of Object.values(row))visit(child);
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
interface Fact {ref:string;actor?:string;kind:string;availability:'current'|'supplemental';value:unknown;revision:string}
/** Aliases survive unchanged material; current issuance and scoped contents do not. */
export class DecisionContent {
 private scope='';private ordinal=0;private aliases=new Map<string,string>();
 private facts=new Map<string,Fact>();private active=new Set<string>();private entities=new Set<string>();
 private people=new Set<string>();private listenerAliases=new Map<string,string|null>();
 private places=new Set<string>();
 private entityLabels=new Map<string,string>();
 private reads=new Map<string,Row>();private sourceRevision:unknown;private bytes=0;private omitted=0;private previous=new Set<string>();
 assertCurrent(capsule:Row):void {if(this.sourceRevision!==undefined&&this.sourceRevision!==(capsule._context?.task_source_revision??capsule._context?.source_revision))throw Error('Prepared communication source revision changed');}
 forScope(scope:string):void {if(scope!==this.scope){this.scope=scope;this.active.clear();this.entities.clear();this.people.clear();this.places.clear();this.listenerAliases.clear();this.entityLabels.clear();this.reads.clear();this.facts.clear();}}
 observePerson(value:Row):void {if(isNpcReference(value.ref))this.reads.set(value.ref,structuredClone(value));}
 prepare(scope:string,capsule:Row,people:Row[],sources:Row[]=[],investigators:string[]=[],issuedPeople:string[]=[],prepared:Row[]=[]):Row {
  this.forScope(scope);this.active.clear();this.entities.clear();this.people.clear();this.places.clear();this.listenerAliases.clear();this.entityLabels.clear();this.bytes=0;this.omitted=0;this.sourceRevision=capsule._context?.task_source_revision??capsule._context?.source_revision;
  for(const [i,name] of investigators.entries()){
   const ref=`investigator_${i+1}`;this.entities.add(ref);this.people.add(ref);this.listenerAlias(name,ref);this.entityLabels.set(ref,name);
   const known=capsule.known?.investigator;
   if(known?.name===name&&typeof known.id==='string')this.listenerAlias(known.id,ref);
  }
  for(const ref of issuedPeople)if(isNpcReference(ref)){this.entities.add(ref);this.people.add(ref);}
  const cast=[...rows(capsule.npc_references?.people),...rows(capsule.present),...people,...this.reads.values()];
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
   this.entities.add(person.ref);this.people.add(person.ref);
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
  for(const material of rows(capsule.outcome?.public_materials))if(material.visibility==='player')this.issue('fact',material,undefined,'canonical_material','current');
  for(const source of sources)if(typeof source.text==='string'&&source.text.trim())this.issue('source',{name:source.name,text:source.text,authority:source.authority??'reference_only'},undefined,'reference_only');
  for(const entry of rows(capsule.public_scene?.entries))if(typeof entry.text==='string'&&entry.text.trim())
   this.issue('fact',{turn:entry.turn,text:entry.text,...(entry.truncated?{truncated:true}:{})},undefined,'public_scene_history');
  const reused=[...this.active].filter(ref=>this.previous.has(ref)).length;this.previous=new Set(this.active);
  return {coverage:{issued:this.active.size,reused_refs:reused,omitted:this.omitted,byte_limit:32768},facts:[...this.active].map(key=>{const {revision,...fact}=this.facts.get(key)!;return fact;}),entities:[...this.entities],
   authority:'Exact prepared content references only. Actor-scoped facts belong to that actor; a report, belief or plan is not world truth. A selection is not a transaction or proof of delivery.'};
 }
 private issue(kind:'fact'|'source',value:unknown,actor:string|undefined,evidence:string,availability:'current'|'supplemental'='supplemental'):void {
  const identity=digest({kind,value,actor,evidence});let ref=this.aliases.get(identity);
  if(ref&&this.active.has(ref))return;
  const cost=Buffer.byteLength(JSON.stringify(value))+320;
  if(this.active.size>=256||cost>16000||this.bytes+cost>32768){this.omitted++;return;}
  if(!ref){if(this.aliases.size>=2048)this.aliases.delete(this.aliases.keys().next().value!);ref=`${kind}_${++this.ordinal}`;this.aliases.set(identity,ref);}
  this.bytes+=cost;
  this.facts.set(ref,{ref,...(actor?{actor}:{}),kind:evidence,availability,value:structuredClone(value),revision:identity});this.active.add(ref);
 }
 addEntities(values:readonly string[]):void {for(const value of values)this.entities.add(value);}
 bindings():DecisionBindings {return {entities:[...this.entities],people:[...this.people],places:[...this.places],facts:[...this.active].filter(ref=>ref.startsWith('fact_')&&!['current_document','public_scene_history'].includes(this.facts.get(ref)?.kind??'')),narrationFacts:[...this.active].filter(ref=>ref.startsWith('fact_')&&!this.facts.get(ref)?.actor),sources:[...this.active].filter(ref=>ref.startsWith('source_')),factActors:Object.fromEntries([...this.active].flatMap(ref=>this.facts.get(ref)?.actor?[[ref,this.facts.get(ref)!.actor!]]:[]))};}
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
   const refs=[fact.provider,fact.actor,fact.to,fact.topic,...fact.items??[],...fact.via??[]].filter((value):value is string=>typeof value==='string');
   return {kind:'proposed_claim',value:structuredClone(fact),entities:[...new Set(refs)].flatMap(ref=>this.entityLabels.has(ref)?[{ref,display_name:this.entityLabels.get(ref)}]:[]),authority:'Communication content only; not a receipt, truth, order or completed action'};
  }
  const key=selected.fact_ref??selected.source_ref,fact=this.facts.get(key);
  if(!fact||!this.active.has(key)||(selected.source_ref!==undefined)!==key.startsWith('source_'))throw Error('Unissued, retired or wrong-kind communication reference');
  if(fact.actor&&fact.actor!==actor)throw Error('This fact belongs to another actor perspective');
  if(actor&&fact.kind==='current_document')throw Error('Private carried writing is narration material; select this actor observed document for its speech');
  if(actor&&fact.kind==='public_scene_history')throw Error('Prior public scene text is narration context, not an actor knowledge grant');
  const {revision,...hydrated}=fact;return structuredClone(hydrated);
 }
 hydrate(interactions:InteractionDecision[],reveal:unknown[]=[]):{responses:HydratedInteraction[];materials:Row[]} {
  const responses=interactions.map(response=>{
   const to=response.to?.map(listener=>{
    if(this.people.has(listener)||/^new_[1-4]$/.test(listener))return listener;
    const ref=this.listenerAliases.get(listener.normalize('NFKC').trim().toLowerCase());
    if(!ref)throw Error('Unissued or non-person communication audience');return ref;
   });
   if(to?.includes(response.actor))throw Error('A speaker cannot be its own addressee');
   return {...response,...(to?{to}:{}),...('content'in response?{claims:(response.content??[]).map(content=>this.resolve(content,response.actor))}:{})};
  });
  return {responses,materials:reveal.map(content=>this.resolve(content))};
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
