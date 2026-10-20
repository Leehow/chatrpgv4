/** Opt-in decision commands; only the isolated author generates prose. */
import {normalizeToolArgumentSyntax} from './tool-argument-syntax.ts';
import {Type,type TSchema,type Static} from 'typebox';
import {Errors} from 'typebox/value';
import {StringEnum} from '@earendil-works/pi-ai';
import {NPC_REFERENCE_PATTERN,isNpcReference} from './npc-references.ts';
import {Interaction,ExistingCommunicationFact,bindCommunicationParameters,type DecisionBindings,type InteractionDecision} from './decision-content.ts';
import {PlaceEffect,locationCommandEntry,locationCommandOwner} from '../shared/place-structures.ts';
const atom=(maxLength=160)=>Type.String({minLength:1,maxLength});

const move=Type.Object({kind:Type.Literal('move'),to:atom(),via:Type.Optional(atom()),travel_band:Type.Optional(atom(64))},{additionalProperties:false});
const actor=Type.String({pattern:NPC_REFERENCE_PATTERN,maxLength:32,description:'The supplied stable npc_N reference, never a display name.'});
const npc=Type.Object({kind:Type.Literal('npc'),actor,to:atom(),reason:atom()},{additionalProperties:false});
const slot=Type.String({pattern:'^new_[1-4]$'});
const walkOn=Type.Object({kind:Type.Literal('walk_on'),slot,label:atom(80),to:Type.Optional(Type.String({minLength:1,maxLength:240,description:'Exact established place for this new person; defaults to here. An observed remote person stays at that target.'})),reason:atom()},{additionalProperties:false});
const services=['open','closed','limited','unknown'] as const,crowds=['empty','quiet','active','crowded','unknown'] as const;
const scene=Type.Object({kind:Type.Literal('scene'),service:StringEnum([...services]),crowd:{...StringEnum([...crowds]),description:'Occupancy: empty means no other people, decided from circumstances; quiet/active/crowded require actual NPC placement in this scene. Use unknown when occupancy is unassessed. Missing registered names alone do not establish empty.'},review_after_minutes:Type.Optional(Type.Integer({minimum:1,maximum:60}))},{additionalProperties:false});
const timeOptions={additionalProperties:false,oneOf:[{required:['band']},{required:['minutes']}]};
const time=Type.Object({kind:Type.Literal('time'),band:Type.Optional(atom(64)),minutes:Type.Optional(Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER,description:'Copy only an explicitly selected player duration in minutes; never estimate a cost here. Use an issued band for an unspecified duration.'})),reason:atom(),beyond_travel:Type.Optional(Type.Literal(true))},timeOptions);
const postTravelTime=Type.Object({...time.properties,beyond_travel:Type.Literal(true)},timeOptions);
const relationship=Type.Object({kind:Type.Literal('relationship'),actor,toward:Type.String({pattern:'^(npc_[1-9][0-9]*|investigator_[1-9][0-9]*)$',maxLength:32}),affinity:StringEnum(['hostile','guarded','neutral','friendly'])},{additionalProperties:false});
const placeMove=Type.Object(Type.Omit(PlaceEffect.anyOf[0],['travel_minutes']).properties,{additionalProperties:false,description:(PlaceEffect.anyOf[0] as {description?:string}).description});
const placeStationary=PlaceEffect.anyOf.slice(1);
const commandSchemas=[move,placeMove,...placeStationary,npc,walkOn,scene,time,relationship];
// Travel owns its time; explicitly separate post-arrival activity uses the canonical extra-time flag.
const commands=Type.Union([Type.Array(Type.Union([move,placeMove,postTravelTime,...placeStationary,npc,walkOn,scene,relationship]),{maxItems:12}),Type.Array(Type.Union([time,...placeStationary,npc,walkOn,scene,relationship]),{maxItems:12})]);
/** A model decides communication; the sole author owns all complete wording. */
export const TURN_PACKET_PARAMETERS=Type.Object({version:Type.Literal(4),commands:Type.Optional(commands),interactions:Type.Optional(Type.Array(Interaction,{maxItems:12})),reveal:Type.Optional(Type.Array(ExistingCommunicationFact,{maxItems:8}))},{additionalProperties:false});
export const TURN_PACKET_ENTRY_PARAMETERS=locationCommandEntry(TURN_PACKET_PARAMETERS);
export type ResponseDecision=InteractionDecision;
export type TurnPacket=Static<typeof TURN_PACKET_PARAMETERS>;
export type BoundTurnPacket=Omit<TurnPacket,'commands'>&{commands:Array<NonNullable<TurnPacket['commands']>[number]&{travel_minutes?:number}>};
export const isNewNpcSlot=(value:unknown):value is string=>typeof value==='string'&&/^new_[1-4]$/.test(value);
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const bounded=(value:unknown,max=160)=>typeof value==='string'&&!!value.trim()&&value.length<=max;
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
/** Diagnose with the declared schema before Pi can coerce supplied values. */
export class TurnPacketParameterError extends Error {
 fields:string[];
 constructor(message:string,fields:string[]){super(message);this.name='TurnPacketParameterError';this.fields=fields;}
}
function parameterError(label:string,schema:TSchema,value:unknown):Error {
 const errors=Errors(schema,value).slice(0,4);
 const explanation=(error:(typeof errors)[number])=>{
  if(error.keyword==='contains'){
   const node=error.schemaPath.split('/').slice(1).reduce<any>((row,key)=>row?.[key.replace(/~1/g,'/').replace(/~0/g,'~')],schema);
   if(node?.contains?.properties?.kind?.const==='scene')return `must include a scene assessment command: {kind:"scene",service:${JSON.stringify(node.contains.properties.service.enum)},crowd:${JSON.stringify(node.contains.properties.crowd.enum)}}; select actual current service and population`;
  }
  return error.message;
 };
 const findings=errors.map(error=>{
  if(error.keyword==='additionalProperties'||error.schemaPath.endsWith('/additionalProperties'))return `${label}/<additional-property>: must not have additional properties`;
  const received=error.instancePath.split('/').slice(1).reduce<unknown>((row,key)=>object(row)||Array.isArray(row)?(row as Record<string,unknown>)[key.replace(/~1/g,'/').replace(/~0/g,'~')]:undefined,value);
  const type=received===null?'null':Array.isArray(received)?'array':typeof received;
  return `${label}${error.instancePath}: ${explanation(error)} (${error.keyword} ${JSON.stringify(error.params)}); received ${type}`;
 });
 const fields=[...new Set(errors.map(error=>`${label}${error.keyword==='additionalProperties'?'/<additional-property>':error.instancePath}: ${explanation(error)}`.slice(0,300)))];
 return new TurnPacketParameterError(`Invalid decision command: ${[...new Set(findings)].join('; ')||`${label} requires nonblank bounded strings`}`.slice(0,1600),fields);
}
function commandArrayDiagnostic(parameters:TSchema,value:unknown):Error|undefined {
 if(!Array.isArray(value))return;
 const declared=(parameters.properties as Record<string,any>)?.commands;
 const alternatives=Array.isArray(declared?.anyOf)?declared.anyOf:[declared];
 const branch=alternatives.find((candidate:Row)=>object(candidate)&&candidate.type==='array'&&object(candidate.items)
  &&value.every(command=>!Errors(candidate.items,command).length));
 if(!branch)return;
 const active=[branch,...(branch.allOf??[]).flatMap((guard:Row)=>{
  if(!object(guard.if))return [];
  const selected=!Errors(guard.if,value).length?guard.then:guard.else;
  return object(selected)?[selected]:[];
 })];
 const constraint=active.find(candidate=>object(candidate.contains)&&Errors(candidate,value).length);
 return constraint?parameterError('commands',constraint,value):undefined;
}
export function responseDecision(value:unknown,slots:readonly string[]=[]):ResponseDecision {
 const schema=Interaction.anyOf.find(schema=>(schema.properties.act as any).const===(value as any)?.act||(schema.properties.act as any).enum?.includes((value as any)?.act))??Interaction;
 if(Errors(schema,value).length)throw parameterError('response',schema,value);
 const row=value as ResponseDecision;
 if([row.actor,...row.to??[]].some(ref=>isNewNpcSlot(ref)&&!slots.includes(ref)))throw Error('Unbound newcomer slot');
 return row;
}
/** The same issued operation vocabulary is consumed by schema and preflight. */
export function turnPacketNpcDestinations(choices:readonly Record<string,unknown>[]=[]):string[]{
 return [...new Set(['here','away',...choices.filter(row=>row.kind==='move'&&typeof row.to==='string').map(row=>row.to as string)])];
}
/** Parameter requirements are host metadata, never executable effect fields. */
export function turnPacketMovementChoices(choices:unknown):Record<string,unknown>[] {
 return Array.isArray(choices)?choices.flatMap(choice=>object(choice)&&Array.isArray(choice.effects)
    ?choice.effects.filter(object).map(effect=>({...effect,...(choice.requires_via===true?{requires_via:true}:{}),
        ...(Array.isArray(choice.travel_bands)?{travel_bands:choice.travel_bands}:{})})):[]):[];
}
export function requireTurnPacketNpcDestinations(packet:TurnPacket,choices:readonly Record<string,unknown>[]=[]):TurnPacket {
 if((packet.commands??[]).some(command=>command.kind==='npc'&&!turnPacketNpcDestinations(choices).includes(command.to)))throw Error('NPC destination must select here, away or one exact issued place');
 return packet;
}
/** Decode declared scalar and array transport forms without semantic inference. */
export function normalizeTurnPacketArguments(input:unknown):{args:unknown;repairs:number;integerRepairs?:number;booleanRepairs?:number;textRepairs?:number} {
  return normalizeToolArgumentSyntax(TURN_PACKET_PARAMETERS,input,{boundedIntegers:true,exactBooleans:true,partialTransport:true});
}
/** One current parameter contract for the native declaration and submission. */
export function turnPacketParameterSchema(journeySettled=false,timeBands?:readonly string[],moveChoices?:readonly Record<string,unknown>[],sceneRequired=false,bindings?:DecisionBindings,locations=false):TSchema {
    const schema:Record<string,any>=structuredClone(TURN_PACKET_PARAMETERS);
    if(bindings){schema.properties.interactions.items=bindCommunicationParameters(schema.properties.interactions.items,bindings);schema.properties.reveal.items=bindCommunicationParameters(schema.properties.reveal.items,bindings,true);}
    const destinations=[...new Set((moveChoices??[]).filter(row=>row.kind==='move'&&typeof row.to==='string').map(row=>row.to as string))];
    const groups=new Map<string,{destinations:string[];via:boolean;bands?:string[]}>();
    for(const to of destinations){
        const choice=moveChoices!.find(row=>row.kind==='move'&&row.to===to)!;
        const via=choice.requires_via===true,bands=Array.isArray(choice.travel_bands)?choice.travel_bands as string[]:undefined;
        const key=JSON.stringify([via,bands]);let group=groups.get(key);
        if(!group){group={destinations:[],via,...(bands?{bands}:{})};groups.set(key,group);}group.destinations.push(to);
    }
    const issuedMoves:TSchema[]=moveChoices===undefined?[move]:[...groups.values()].map(group=>Type.Object({kind:Type.Literal('move'),to:StringEnum(group.destinations),
        ...(group.via?{via:atom()}:{}),...(group.bands?{travel_band:StringEnum(group.bands)}:{})},{additionalProperties:false}));
    const issuedNpc=Type.Object({...npc.properties,to:StringEnum(turnPacketNpcDestinations(moveChoices))},{additionalProperties:false});
    const boundedTime=timeBands?.length?Type.Object({...time.properties,band:Type.Optional(StringEnum([...timeBands]))},timeOptions):time;
    const assessment={contains:scene,minContains:1};
    const stationary=sceneRequired?assessment:{};
    const local=locations?placeStationary.map(command=>command.properties.action.const==='observe'?Type.Omit(command,['relations'],{additionalProperties:false}):command):[],journey=locations?[placeMove]:[];
    const moving=sceneRequired?assessment:{allOf:[{if:{contains:locations?Type.Object({kind:Type.Literal('place'),action:Type.Literal('move')}):Type.Object({kind:Type.Literal('move')})},then:assessment}]};
    const arrivedLocal=Type.Object({kind:Type.Literal('place'),action:Type.Literal('move'),to:Type.Literal('here'),at:atom(240),
        relation:PlaceEffect.anyOf[0].properties.relation,additions:PlaceEffect.anyOf[0].properties.additions},{additionalProperties:false});
    if(journeySettled)schema.properties.commands=Type.Array(Type.Union([...(locations?[arrivedLocal]:[]),...local,issuedNpc,walkOn,scene,relationship]),{maxItems:12,...stationary});
    else schema.properties.commands=Type.Union([Type.Array(Type.Union([...issuedMoves,...journey,Type.Object({...boundedTime.properties,beyond_travel:Type.Literal(true)},timeOptions),...local,issuedNpc,walkOn,scene,relationship]),{maxItems:12,...moving}),Type.Array(Type.Union([boundedTime,...local,issuedNpc,walkOn,scene,relationship]),{maxItems:12,...stationary})]);
    if(sceneRequired)schema.required=[...new Set([...(schema.required??[]),'commands'])];
    return locations?locationCommandOwner(schema as TSchema):schema as TSchema;
}
/** Restore the owned structural schema after Pi's non-strict Anthropic conversion. */
export function turnPacketProviderPayload(payload:unknown,schema:TSchema=turnPacketParameterSchema(),requireTool=true):unknown {
  if(!object(payload)||!Array.isArray(payload.tools)||!Array.isArray(payload.messages))return payload;
  let changed=false;
  const tools=payload.tools.map((tool:unknown)=>{
    if(!object(tool)||tool.name!=='output'||!object(tool.input_schema))return tool;
    changed=true;return {...tool,input_schema:schema};
  });
  if(!changed)return payload;
  return {...payload,tools,...(requireTool&&payload.model==='MiniMax-M3.1-Flash-Preview'?{tool_choice:{type:'auto'}}:{})};
}
/** Keep bound routes immutable; fill only an explicitly issued open route slot. */
export function bindTurnPacketMoves(packet:TurnPacket,choices:readonly Record<string,unknown>[]):BoundTurnPacket {
  requireTurnPacketNpcDestinations(packet,choices);
  return {...packet,commands:(packet.commands??[]).map(command=>{
    if(command.kind!=='move')return command;
    const matches=choices.filter(row=>row.kind==='move'&&row.to===command.to);
    if(matches.length!==1)throw Error('Select one exact issued movement destination');
    const selected=matches[0];
    if(selected.requires_via===true?!bounded(command.via):command.via!==undefined)
        throw Error(selected.requires_via===true?'This destination requires a short via route parameter':'This destination already has a host-owned route; omit via');
    const bands=Array.isArray(selected.travel_bands)?selected.travel_bands:undefined;
    if(bands?!bands.includes(command.travel_band):command.travel_band!==undefined)
        throw Error(bands?'This untimed journey requires one issued travel_band: '+bands.join(', '):'This route already has host-owned timing; omit travel_band');
    return {kind:'move' as const,to:command.to,
        ...(selected.requires_via===true?{via:command.via}:typeof selected.via==='string'?{via:selected.via}:{}),
        ...(Number.isInteger(selected.travel_minutes)?{travel_minutes:selected.travel_minutes as number}:{}),
        ...(bands?{travel_band:command.travel_band}:typeof selected.travel_band==='string'?{travel_band:selected.travel_band}:{})};
  })};
}
export function turnPacket(text:string,parameters?:TSchema):TurnPacket {
 const raw=JSON.parse(text);
 if(object(raw)&&Array.isArray(raw.commands))for(const [index,command]of raw.commands.entries()){
  const actionSchema=commandSchemas.find(schema=>(schema.properties as Record<string,any>).action?.const===command?.action&&command?.action!==undefined);
  const schema=actionSchema??commandSchemas.find(schema=>schema.properties.kind.const===command?.kind&&(!(schema.properties as Record<string,any>).action||(schema.properties as Record<string,any>).action.const===command?.action));
  if(schema&&Errors(schema,command).length)throw parameterError(`commands[${index}]`,schema,command);
 }
 if(object(raw)&&Array.isArray(raw.interactions))for(const row of raw.interactions)responseDecision(row,(raw.commands??[]).filter((row:any)=>row?.kind==='walk_on').map((row:any)=>row.slot));
 if(object(raw)&&Array.isArray(raw.commands)){
  const journey=raw.commands.findIndex((command:Row)=>command?.kind==='move'||command?.kind==='place'&&command.action==='move');
  for(const [index,command]of raw.commands.entries())if(command?.kind==='time'){
   if(journey>=0&&command.beyond_travel!==true)throw Error('Movement already owns travel time. Omit duplicate travel time; mark independent post-arrival activity with beyond_travel:true.');
   if(command.beyond_travel===true&&journey>=0&&index<journey)throw Error('beyond_travel time must follow the journey when both occur in this packet.');
  }
 }
 if(Errors(TURN_PACKET_PARAMETERS,raw).length)throw parameterError('packet',TURN_PACKET_PARAMETERS,raw);
 if(parameters){const diagnostic=commandArrayDiagnostic(parameters,raw.commands);if(diagnostic)throw diagnostic;}
 if(parameters&&Errors(parameters,raw).length)throw parameterError('packet',parameters,raw);
 const packet=raw as TurnPacket,commands=packet.commands??[],interactions=packet.interactions??[];
 const slots=commands.filter(a=>a.kind==='walk_on').map(a=>a.slot);
 const labels=commands.filter(a=>a.kind==='walk_on').map(a=>a.label.normalize('NFKC').trim().toLowerCase());
 if(new Set(labels).size!==labels.length||new Set(slots).size!==slots.length||commands.filter(a=>a.kind==='scene').length>1)throw Error('Duplicate newcomer labels, scene or slot');
 interactions.forEach(value=>responseDecision(value,slots));
 for(const command of commands)if(command.kind==='place'&&command.action==='observe')
  for(const name of [...command.people??[],...(command.situations??[]).flatMap(situation=>situation.participants??[])])
   if(isNewNpcSlot(name)&&!slots.includes(name))throw Error('Unbound observation newcomer slot');
 const journeys=commands.filter(a=>a.kind==='move'||a.kind==='place'&&a.action==='move');
 if(journeys.length>1)throw Error('Only one destination per decision packet');
 return packet;
}
export function compileTurnPacket(packet:TurnPacket|BoundTurnPacket):{responses:ResponseDecision[];effects:Record<string,unknown>[];event?:{name:string;relationships:Array<{actor:string;toward:string;statement:string}>}} {
 const commands=packet.commands??[];
 const directed=commands.filter(a=>a.kind==='relationship');
 const observed=(a:typeof commands[number])=>a.kind==='place'&&a.action==='observe';
 const definitions=commands.flatMap(a=>a.kind==='place'&&a.action==='observe'&&a.additions?[{kind:'place',action:'establish',additions:a.additions}]:[]);
 const ordered=[...commands.filter(a=>!['walk_on','scene','relationship'].includes(a.kind)&&!observed(a)),...commands.filter(a=>a.kind==='walk_on'),...commands.filter(a=>a.kind==='scene'),...commands.filter(observed)];
 const newcomers=new Map(commands.filter(a=>a.kind==='walk_on').map(a=>[a.slot,a.label]));
 const person=(name:string)=>newcomers.get(name)??name;
 return {responses:packet.interactions??[],...(directed.length?{event:{name:'Directed relationship update',relationships:directed.map(row=>({actor:row.actor,toward:row.toward,statement:JSON.stringify({kind:'directed_relationship',affinity:row.affinity})}))}}:{}),effects:[...definitions,...ordered.map(a=>a.kind==='move'?{kind:'move',to:a.to,...(a.via?{via:a.via}:{}),
  ...('travel_minutes'in a&&a.travel_minutes!==undefined?{travel_minutes:a.travel_minutes}:{}),...(a.travel_band?{travel_band:a.travel_band}:{})}
  :a.kind==='place'?a.action==='observe'?{...Object.fromEntries(Object.entries(a).filter(([key])=>key!=='additions')),...(a.people?{people:a.people.map(person)}:{}),...(a.situations?{situations:a.situations.map(situation=>({...situation,...(situation.participants?{participants:situation.participants.map(person)}:{})}))}:{})}:{...a}:a.kind==='npc'?{kind:'npc',name:a.actor,to:a.to,why:a.reason}:a.kind==='walk_on'?{kind:'npc',name:a.label,to:a.to??'here',walk_on:true,_new_person:true,why:a.reason}
  :a.kind==='scene'?{kind:'scene',name:'here',_population:true,activity:{service:a.service,crowd:a.crowd,basis:'established',summary:`Service is ${a.service}; crowd is ${a.crowd}.`,review_after_minutes:a.review_after_minutes??15},why:'Current place, clock and registered circumstances establish this population assessment.'}
  :a.kind==='time'?{kind:'time',...(a.minutes!==undefined?{minutes:a.minutes}:{band:a.band}),why:a.reason,...(a.beyond_travel===true?{beyond_travel:true}:{})}:(()=>{throw Error('Non-effect decision command reached the effect compiler');})())]};
}
/** Public result fields come from kernel outcomes, never from submitted commands. */
export function turnPacketResult(value:unknown):{player_actions_complete:true;npc_actions_complete:true;outcomes:Record<string,unknown>[]} {
  if(!object(value)||!Array.isArray(value.outcomes))throw Error('Canonical operation outcomes are unavailable');
  if(Array.isArray(value.not_landed)&&value.not_landed.length||object(value.admission)&&value.admission.not_landed)
    throw Error('Part of the operation did not land; preserve its actual results and do not author completion');
  return {player_actions_complete:true,npc_actions_complete:true,outcomes:value.outcomes.map(row=>{
    if(!object(row)||!['move','place','npc','time','item','cash'].includes(row.kind)||!['changed','unchanged'].includes(row.status))throw Error('Invalid canonical operation outcome');
    return Object.fromEntries(['kind','status','action','actor','name','from','to','minutes','band','quantity','offer','place','position','feature','state','added','features','observation','transaction','settlement','category','purpose','currency','before','after','purchase_amount','items','subject','with','quote'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
  })};
}
export const TURN_PACKET_LOCATION_STEPS='When a selected move precedes a wait, service or another move, first call place {action:"move",to,at?,relation?,via?,travel_band?,additions?}. This commits one location step without publishing. Then use apply for the selected wait or service; absolute clock waits use time.until. Repeat that sequence only for still-unsettled selected steps, then submit one output for the remaining final move/observation and communication. One output packet permits only one final destination; it cannot replace an interleaved move/wait/return sequence. Never repeat successful receipts. ';
export const TURN_PACKET_GUIDANCE='Submit one output packet {version:4,commands?,interactions?,reveal?}. Omit unchanged categories. Commands settle before communication; this is not an interleaved program. '
 +TURN_PACKET_LOCATION_STEPS+'For places beyond issued routes or local positioning, use place. Inspect need contract supplies the typed location fields. Reuse known identities; complete valid location calls need no earlier manual read. Establish registers surroundings only and moves nobody; an actual visit uses action:move with minimal additions. '
 +'Use issued movement destinations and routes, optional issued travel bands, npc presence, walk_on, scene and stationary time commands. Movement owns travel time. For an explicitly selected player duration use {kind:"time",minutes:the stated whole minutes,reason}; for an unspecified cost select an issued band instead. Never combine minutes and band. Independent post-arrival activity uses beyond_travel:true; omit any time that repeats travel. A changed directed attitude uses {kind:"relationship",actor:"issued npc_N",toward:"issued person reference",affinity:"hostile|guarded|neutral|friendly"}. Use the existing mechanical apply effects, resolve and ask for other real rules and state changes, never for prose or prospective event records. '
 +'An unassessed or expired scene needs {kind:"scene",service:"open|closed|limited|unknown",crowd:"empty|quiet|active|crowded|unknown",review_after_minutes?:1..60}. Determine population from the place, clock and circumstances; missing names never mean empty. Quiet, active or crowded require actual NPC placement; choose empty when alone is established, or unknown for unassessed occupancy. If needed establish a temporary person with {kind:"walk_on",slot:"new_1",label:"public role appellation",reason:"why present"}; reuse existing people. '
 +'Interactions select {actor:"issued npc_N or declared new_N",to:["issued investigator_N or npc_N"],act:"answer|greet|ask|refuse|offer|acknowledge|clarify|report|warn",content?:[{fact_ref:"issued fact_N"}|{source_ref:"issued source_N"}|{new:registered constructor}]}. Silent is {actor,act:"silent",to?}, without content. '
 +'Answer, ask, offer, clarify, report and warn require nonempty content; greet, refuse and acknowledge may omit it. Select exact prepared facts and source fragments from decision_materials. Actor-scoped facts belong to that actor; a report, belief or plan is not truth. reveal selects only eligible non-actor facts or sources for narration. New claims use registered typed constructors, including directions with a destination and heading, known waypoints or retrace:true; no free-text statement, dialogue, event, intent, stance or materials. Directions are advice, never movement. An offer or planned_visit executes nothing. '
 +'The host supplies current public labels, character state, personality, directed relationships, actual outcomes and selected fragments to the sole prose author. Do not repeat them. Only changed state uses existing canonical effects. No event, knowledge or relationship statement is needed just to speak. '
 +'Read missing evidence only when necessary. Do not repeat supplied material or settled operations. Randomness, computed time costs, ranges, receipts and success are host-owned; only an explicitly selected player duration is copied into minutes. When host_operations reports a settled journey, omit move and duplicate travel time. The author streams plain prose once. Background memory uses actual delivered words; proposed communication is not already heard. For pure OOC use {{reference}} without fictional writes.';
/** Install one coherent capability instruction; inherited prose/event jobs do not survive. */
export function turnPacketSystemPrompt(source:string):string {
 const incompatible=['Before recording prospective speech,','Record new event semantics,','A new NPC promise to act later','An ordinary nonmechanical NPC act completed','When a previously planned action has now happened,'];
 let kept=source.split('\n\n').filter(paragraph=>!incompatible.some(prefix=>paragraph.startsWith(prefix))).join('\n\n');
 const start=kept.indexOf('Public response\n\n'),end=kept.indexOf('\n\nKeep hidden motives,',start);
 if(start>=0&&end>start)kept=kept.slice(0,start)+'Public response\n\n'+TURN_PACKET_GUIDANCE+kept.slice(end);
 else kept+='\n\n'+TURN_PACKET_GUIDANCE;
 kept=kept.replace("You are the Keeper and content planner of this Call of Cthulhu 7th edition table. Understand the player's actual words, the current situation and each character's knowledge. Decide what happens, settle it through tools, then supply a private expression brief. A fresh isolated DeepSeek author chooses the final wording.", 'You are the Keeper decision agent of this Call of Cthulhu 7th edition table. Understand the player input, current situation and actor knowledge. Select actions and communication meaning; the sole author chooses complete wording.');
 return kept;
}
