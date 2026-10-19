/** Opt-in decision commands; only the isolated author generates prose. */
import {normalizeToolArgumentSyntax} from './tool-argument-syntax.ts';
import {Type,type TSchema,type Static} from 'typebox';
import {Errors} from 'typebox/value';
import {StringEnum} from '@earendil-works/pi-ai';
import {NPC_REFERENCE_PATTERN,isNpcReference} from './npc-references.ts';
import {Interaction,ExistingCommunicationFact,bindCommunicationParameters,type DecisionBindings,type InteractionDecision} from './decision-content.ts';
const atom=(maxLength=160)=>Type.String({minLength:1,maxLength});

const move=Type.Object({kind:Type.Literal('move'),to:atom(),via:Type.Optional(atom()),travel_band:Type.Optional(atom(64))},{additionalProperties:false});
const actor=Type.String({pattern:NPC_REFERENCE_PATTERN,maxLength:32,description:'The supplied stable npc_N reference, never a display name.'});
const npc=Type.Object({kind:Type.Literal('npc'),actor,to:atom(),reason:atom()},{additionalProperties:false});
const slot=Type.String({pattern:'^new_[1-4]$'});
const walkOn=Type.Object({kind:Type.Literal('walk_on'),slot,label:atom(80),reason:atom()},{additionalProperties:false});
const services=['open','closed','limited','unknown'] as const,crowds=['empty','quiet','active','crowded','unknown'] as const;
const scene=Type.Object({kind:Type.Literal('scene'),service:StringEnum([...services]),crowd:StringEnum([...crowds]),review_after_minutes:Type.Optional(Type.Integer({minimum:1,maximum:60}))},{additionalProperties:false});
const time=Type.Object({kind:Type.Literal('time'),band:atom(64),reason:atom()},{additionalProperties:false});
const relationship=Type.Object({kind:Type.Literal('relationship'),actor,toward:Type.String({pattern:'^(npc_[1-9][0-9]*|investigator_[1-9][0-9]*)$',maxLength:32}),affinity:StringEnum(['hostile','guarded','neutral','friendly'])},{additionalProperties:false});
const commandSchemas=[move,npc,walkOn,scene,time,relationship];
// Travel owns its time. This bounded wire has no beyond-travel operation.
const commands=Type.Union([Type.Array(Type.Union([move,npc,walkOn,scene,relationship]),{maxItems:12}),Type.Array(Type.Union([time,npc,walkOn,scene,relationship]),{maxItems:12})]);
/** A model decides communication; the sole author owns all complete wording. */
export const TURN_PACKET_PARAMETERS=Type.Object({version:Type.Literal(4),commands:Type.Optional(commands),interactions:Type.Optional(Type.Array(Interaction,{maxItems:12})),reveal:Type.Optional(Type.Array(ExistingCommunicationFact,{maxItems:8}))},{additionalProperties:false});
export type ResponseDecision=InteractionDecision;
export type TurnPacket=Static<typeof TURN_PACKET_PARAMETERS>;
export type BoundTurnPacket=Omit<TurnPacket,'commands'>&{commands:Array<NonNullable<TurnPacket['commands']>[number]&{travel_minutes?:number}>};
export const isNewNpcSlot=(value:unknown):value is string=>typeof value==='string'&&/^new_[1-4]$/.test(value);
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const bounded=(value:unknown,max=160)=>typeof value==='string'&&!!value.trim()&&value.length<=max;
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
/** Diagnose with the declared schema before Pi can coerce supplied values. */
function parameterError(label:string,schema:TSchema,value:unknown):Error {
 const findings=Errors(schema,value).slice(0,4).map(error=>{
  if(error.keyword==='additionalProperties'||error.schemaPath.endsWith('/additionalProperties'))return `${label}/<additional-property>: must not have additional properties`;
  const received=error.instancePath.split('/').slice(1).reduce<unknown>((row,key)=>object(row)||Array.isArray(row)?(row as Record<string,unknown>)[key.replace(/~1/g,'/').replace(/~0/g,'~')]:undefined,value);
  const type=received===null?'null':Array.isArray(received)?'array':typeof received;
  return `${label}${error.instancePath}: ${error.message} (${error.keyword} ${JSON.stringify(error.params)}); received ${type}`;
 });
 return Error(`Invalid decision command: ${findings.join('; ')||`${label} requires nonblank bounded strings`}`.slice(0,1600));
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
/** Decode exact, bounded item envelopes only at declared array positions. */
export function normalizeTurnPacketArguments(input:unknown):{args:unknown;repairs:number;integerRepairs?:number} {
  return normalizeToolArgumentSyntax(TURN_PACKET_PARAMETERS,input,{boundedIntegers:true});
}
/** Restore this owned declaration after Pi's non-strict Anthropic conversion. */
export function turnPacketProviderPayload(payload:unknown,journeySettled=false,requireTool=true,timeBands?:readonly string[],moveChoices?:readonly Record<string,unknown>[],sceneRequired=false,bindings?:DecisionBindings):unknown {
  if(!object(payload)||!Array.isArray(payload.tools))return payload;
  let changed=false;
  const tools=payload.tools.map((tool:unknown)=>{
    if(!object(tool)||tool.name!=='output'||!object(tool.input_schema))return tool;
    const schema:Record<string,any>=structuredClone(TURN_PACKET_PARAMETERS);
    if(bindings){schema.properties.interactions.items=bindCommunicationParameters(schema.properties.interactions.items,bindings);schema.properties.reveal.items=bindCommunicationParameters(schema.properties.reveal.items,bindings);}
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
    const boundedTime=timeBands?.length?Type.Object({...time.properties,band:StringEnum([...timeBands])},{additionalProperties:false}):time;
    const assessment={contains:scene,minContains:1};
    const stationary=sceneRequired?assessment:{};
    const moving=sceneRequired?assessment:{allOf:[{if:{contains:Type.Object({kind:Type.Literal('move')})},then:assessment}]};
    if(journeySettled)schema.properties.commands=Type.Array(Type.Union([issuedNpc,walkOn,scene,relationship]),{maxItems:12,...stationary});
    else schema.properties.commands=Type.Union([Type.Array(Type.Union([...issuedMoves,issuedNpc,walkOn,scene,relationship]),{maxItems:12,...moving}),Type.Array(Type.Union([boundedTime,issuedNpc,walkOn,scene,relationship]),{maxItems:12,...stationary})]);
    if(sceneRequired)schema.required=[...new Set([...(schema.required??[]),'commands'])];
    changed=true;return {...tool,input_schema:schema};
  });
  return changed?{...payload,tools,...(requireTool&&payload.model==='MiniMax-M3.1-Flash-Preview'?{tool_choice:{type:'auto'}}:{})}:payload;
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
export function turnPacket(text:string):TurnPacket {
 const raw=JSON.parse(text);
 if(object(raw)&&Array.isArray(raw.commands))for(const [index,command]of raw.commands.entries()){
  const schema=commandSchemas.find(schema=>schema.properties.kind.const===command?.kind);
  if(schema&&Errors(schema,command).length)throw parameterError(`commands[${index}]`,schema,command);
 }
 if(object(raw)&&Array.isArray(raw.interactions))for(const row of raw.interactions)responseDecision(row,(raw.commands??[]).filter((row:any)=>row?.kind==='walk_on').map((row:any)=>row.slot));
 if(Errors(TURN_PACKET_PARAMETERS,raw).length)throw parameterError('packet',TURN_PACKET_PARAMETERS,raw);
 const packet=raw as TurnPacket,commands=packet.commands??[],interactions=packet.interactions??[];
 const slots=commands.filter(a=>a.kind==='walk_on').map(a=>a.slot);
 const labels=commands.filter(a=>a.kind==='walk_on').map(a=>a.label.normalize('NFKC').trim().toLowerCase());
 if(new Set(labels).size!==labels.length||new Set(slots).size!==slots.length||commands.filter(a=>a.kind==='scene').length>1)throw Error('Duplicate newcomer labels, scene or slot');
 interactions.forEach(value=>responseDecision(value,slots));
 if(commands.filter(a=>a.kind==='move').length>1)throw Error('Only one destination per decision packet');
 if(commands.some(a=>a.kind==='move')&&commands.some(a=>a.kind==='time'))throw Error('Movement already owns travel time');
 return packet;
}
export function compileTurnPacket(packet:TurnPacket|BoundTurnPacket):{responses:ResponseDecision[];effects:Record<string,unknown>[];event?:{name:string;relationships:Array<{actor:string;toward:string;statement:string}>}} {
 const commands=packet.commands??[];
 const directed=commands.filter(a=>a.kind==='relationship');
 const ordered=[...commands.filter(a=>!['walk_on','scene','relationship'].includes(a.kind)),...commands.filter(a=>a.kind==='walk_on'),...commands.filter(a=>a.kind==='scene')];
 return {responses:packet.interactions??[],...(directed.length?{event:{name:'Directed relationship update',relationships:directed.map(row=>({actor:row.actor,toward:row.toward,statement:JSON.stringify({kind:'directed_relationship',affinity:row.affinity})}))}}:{}),effects:ordered.map(a=>a.kind==='move'?{kind:'move',to:a.to,...(a.via?{via:a.via}:{}),
  ...('travel_minutes'in a&&a.travel_minutes!==undefined?{travel_minutes:a.travel_minutes}:{}),...(a.travel_band?{travel_band:a.travel_band}:{})}
  :a.kind==='npc'?{kind:'npc',name:a.actor,to:a.to,why:a.reason}:a.kind==='walk_on'?{kind:'npc',name:a.label,to:'here',walk_on:true,_new_person:true,why:a.reason}
  :a.kind==='scene'?{kind:'scene',name:'here',_population:true,activity:{service:a.service,crowd:a.crowd,basis:'established',summary:`Service is ${a.service}; crowd is ${a.crowd}.`,review_after_minutes:a.review_after_minutes??15},why:'Current place, clock and registered circumstances establish this population assessment.'}
  :a.kind==='time'?{kind:'time',band:a.band,why:a.reason}:(()=>{throw Error('Non-effect decision command reached the effect compiler');})())};
}
/** Public result fields come from kernel outcomes, never from submitted commands. */
export function turnPacketResult(value:unknown):{player_actions_complete:true;npc_actions_complete:true;outcomes:Record<string,unknown>[]} {
  if(!object(value)||!Array.isArray(value.outcomes))throw Error('Canonical operation outcomes are unavailable');
  if(Array.isArray(value.not_landed)&&value.not_landed.length||object(value.admission)&&value.admission.not_landed)
    throw Error('Part of the operation did not land; preserve its actual results and do not author completion');
  return {player_actions_complete:true,npc_actions_complete:true,outcomes:value.outcomes.map(row=>{
    if(!object(row)||!['move','npc','time','item'].includes(row.kind)||!['changed','unchanged'].includes(row.status))throw Error('Invalid canonical operation outcome');
    return Object.fromEntries(['kind','status','actor','name','from','to','minutes','band','quantity','offer'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
  })};
}
export const TURN_PACKET_GUIDANCE='Submit one output packet {version:4,commands?,interactions?,reveal?}. Omit unchanged categories. Commands settle before communication; this is not an interleaved program. '
 +'Use issued movement destinations and routes, optional issued travel bands, npc presence, walk_on, scene and stationary time commands. Movement owns travel time; never combine move and time. A changed directed attitude uses {kind:"relationship",actor:"issued npc_N",toward:"issued person reference",affinity:"hostile|guarded|neutral|friendly"}. Use the existing mechanical apply effects, resolve and ask for other real rules and state changes, never for prose or prospective event records. '
 +'An unassessed or expired scene needs {kind:"scene",service:"open|closed|limited|unknown",crowd:"empty|quiet|active|crowded|unknown",review_after_minutes?:1..60}. Determine population from the place, clock and circumstances; missing names never mean empty. If needed establish a temporary person with {kind:"walk_on",slot:"new_1",label:"public role appellation",reason:"why present"}; reuse existing people. '
 +'Interactions select {actor:"issued npc_N or declared new_N",to:["issued investigator_N or npc_N"],act:"answer|greet|ask|refuse|offer|acknowledge|clarify|report|warn",content?:[{fact_ref:"issued fact_N"}|{source_ref:"issued source_N"}|{new:registered constructor}]}. Silent is {actor,act:"silent",to?}, without content. '
 +'Answer, ask, offer, clarify, report and warn require nonempty content; greet, refuse and acknowledge may omit it. Select exact prepared facts and source fragments from decision_materials. Actor-scoped facts belong to that actor; a report, belief or plan is not truth. reveal selects only eligible non-actor facts or sources for narration. New claims use registered typed constructors, including directions with a destination and heading, known waypoints or retrace:true; no free-text statement, dialogue, event, intent, stance or materials. Directions are advice, never movement. An offer or planned_visit executes nothing. '
 +'The host supplies current public labels, character state, personality, directed relationships, actual outcomes and selected fragments to the sole prose author. Do not repeat them. Only changed state uses existing canonical effects. No event, knowledge or relationship statement is needed just to speak. '
 +'Read missing evidence only when necessary. Do not repeat supplied material or settled operations. Host-owned time, randomness, ranges, receipts and success are never model fields. When host_operations reports a settled journey, omit move and time. The author streams plain prose once. Background memory uses actual delivered words; proposed communication is not already heard. For pure OOC use {{reference}} without fictional writes.';
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
