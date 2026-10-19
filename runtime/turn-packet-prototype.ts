/** Opt-in decision commands; only the isolated author generates prose. */
import {normalizeToolArgumentSyntax} from './tool-argument-syntax.ts';
import {Type,type TSchema,type Static} from 'typebox';
import {Errors} from 'typebox/value';
import {StringEnum} from '@earendil-works/pi-ai';
import {NPC_REFERENCE_PATTERN,isNpcReference} from './npc-references.ts';
import {TurnEvent} from '../shared/turn-event.ts';
const atom=(maxLength=160)=>Type.String({minLength:1,maxLength});
const acts=['answer','greet','ask','refuse','offer','acknowledge','clarify','silent'] as const;
const move=Type.Object({kind:Type.Literal('move'),to:atom(),via:Type.Optional(atom()),travel_band:Type.Optional(atom(64))},{additionalProperties:false});
const actor=Type.String({pattern:NPC_REFERENCE_PATTERN,maxLength:32,description:'The supplied stable npc_N reference, never a display name.'});
const npc=Type.Object({kind:Type.Literal('npc'),actor,to:atom(),reason:atom()},{additionalProperties:false});
const slot=Type.String({pattern:'^new_[1-4]$'});
const walkOn=Type.Object({kind:Type.Literal('walk_on'),slot,label:atom(80),reason:atom()},{additionalProperties:false});
const services=['open','closed','limited','unknown'] as const,crowds=['empty','quiet','active','crowded','unknown'] as const;
const scene=Type.Object({kind:Type.Literal('scene'),service:StringEnum([...services]),crowd:StringEnum([...crowds]),review_after_minutes:Type.Optional(Type.Integer({minimum:1,maximum:60}))},{additionalProperties:false});
const time=Type.Object({kind:Type.Literal('time'),band:atom(64),reason:atom()},{additionalProperties:false});
const commandSchemas=[move,npc,walkOn,scene,time];
// Travel owns its time. This bounded wire has no beyond-travel operation.
const commands=Type.Union([Type.Array(Type.Union([move,npc,walkOn,scene]),{maxItems:12}),Type.Array(Type.Union([time,npc,walkOn,scene]),{maxItems:12})]);
const response=Type.Union([
 Type.Object({actor:Type.Union([actor,slot]),act:StringEnum(acts.filter(act=>act!=='silent')),points:Type.Array(atom(),{maxItems:12}),stance:Type.Optional(atom(64))},{additionalProperties:false}),
 Type.Object({actor:Type.Union([actor,slot]),act:Type.Literal('silent')},{additionalProperties:false})]);
/** Names and selected claims remain material, so the declaration stays stable. */
export const TURN_PACKET_PARAMETERS=Type.Object({version:Type.Literal(3),commands,responses:Type.Array(response,{maxItems:12}),event:Type.Optional(TurnEvent)},{additionalProperties:false});
export type ResponseDecision = {actor:string;act:Exclude<typeof acts[number],'silent'>;points:string[];stance?:string}|{actor:string;act:'silent'};
export interface TurnPacket {version:3;commands:Array<{kind:'move';to:string;via?:string;travel_minutes?:number;travel_band?:string}|{kind:'time';band:string;reason:string}|{kind:'npc';actor:string;to:string;reason:string}|{kind:'walk_on';slot:string;label:string;reason:string}|{kind:'scene';service:typeof services[number];crowd:typeof crowds[number];review_after_minutes?:number}>;responses:ResponseDecision[];event?:Static<typeof TurnEvent>}
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
 if(!object(value)||!(isNpcReference(value.actor)||isNewNpcSlot(value.actor)&&slots.includes(value.actor))||!acts.includes(value.act))throw Error('Invalid response decision or unbound newcomer slot');
 if(value.act==='silent'){
  if(!keys(value,['actor','act']))throw Error('A silent response carries only actor and act; put actual world changes in commands');
 }else if(!keys(value,['actor','act','points','stance'])||(value.stance!==undefined&&!bounded(value.stance,64))||!Array.isArray(value.points)||value.points.length>12||!value.points.every((point:unknown)=>bounded(point)))throw Error('Invalid response decision');
 return value as ResponseDecision;
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
 if(packet.commands.some(command=>command.kind==='npc'&&!turnPacketNpcDestinations(choices).includes(command.to)))throw Error('NPC destination must select here, away or one exact issued place');
 return packet;
}
/** Decode exact, bounded item envelopes only at declared array positions. */
export function normalizeTurnPacketArguments(input:unknown):{args:unknown;repairs:number;integerRepairs?:number} {
  return normalizeToolArgumentSyntax(TURN_PACKET_PARAMETERS,input,{boundedIntegers:true});
}
/** Restore this owned declaration after Pi's non-strict Anthropic conversion. */
export function turnPacketProviderPayload(payload:unknown,journeySettled=false,requireTool=true,timeBands?:readonly string[],moveChoices?:readonly Record<string,unknown>[]):unknown {
  if(!object(payload)||!Array.isArray(payload.tools))return payload;
  let changed=false;
  const tools=payload.tools.map((tool:unknown)=>{
    if(!object(tool)||tool.name!=='output'||!object(tool.input_schema))return tool;
    const schema:Record<string,any>=structuredClone(TURN_PACKET_PARAMETERS);
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
    if(journeySettled)schema.properties.commands=Type.Array(Type.Union([issuedNpc,walkOn,scene]),{maxItems:12});
    else schema.properties.commands=Type.Union([Type.Array(Type.Union([...issuedMoves,issuedNpc,walkOn,scene]),{maxItems:12}),Type.Array(Type.Union([boundedTime,issuedNpc,walkOn,scene]),{maxItems:12})]);
    changed=true;return {...tool,input_schema:schema};
  });
  return changed?{...payload,tools,...(requireTool&&payload.model==='MiniMax-M3.1-Flash-Preview'?{tool_choice:{type:'auto'}}:{})}:payload;
}
/** Keep bound routes immutable; fill only an explicitly issued open route slot. */
export function bindTurnPacketMoves(packet:TurnPacket,choices:readonly Record<string,unknown>[]):TurnPacket {
  requireTurnPacketNpcDestinations(packet,choices);
  return {...packet,commands:packet.commands.map(command=>{
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
  if(!object(raw)||!keys(raw,['version','commands','responses','event'])||raw.version!==3||!Array.isArray(raw.commands)||raw.commands.length>12||!Array.isArray(raw.responses)||raw.responses.length>12)
    throw Error('Invalid decision packet');
  if(raw.event!==undefined&&Errors(TurnEvent,raw.event).length)throw parameterError('event',TurnEvent,raw.event);
  for(const [index,action] of raw.commands.entries()){
    if(!object(action))throw parameterError(`commands[${index}]`,Type.Object({}),action);
    const valid=action.kind==='move'?keys(action,['kind','to','via','travel_band'])&&bounded(action.to)&&(action.via===undefined||bounded(action.via))&&(action.travel_band===undefined||bounded(action.travel_band,64))
      :action.kind==='npc'?keys(action,['kind','actor','to','reason'])&&isNpcReference(action.actor)&&bounded(action.to)&&bounded(action.reason)
      :action.kind==='walk_on'?keys(action,['kind','slot','label','reason'])&&isNewNpcSlot(action.slot)&&bounded(action.label,80)&&bounded(action.reason)
      :action.kind==='scene'?keys(action,['kind','service','crowd','review_after_minutes'])&&services.includes(action.service)&&crowds.includes(action.crowd)&&(action.review_after_minutes===undefined||Number.isInteger(action.review_after_minutes)&&action.review_after_minutes>=1&&action.review_after_minutes<=60)
      :action.kind==='time'?keys(action,['kind','band','reason'])&&bounded(action.band,64)&&bounded(action.reason):false;
    if(!valid){
      const schema=commandSchemas.find(schema=>schema.properties.kind.const===action.kind);
      throw parameterError(`commands[${index}]`,schema??Type.Object({kind:StringEnum(['move','npc','walk_on','scene','time'])}),action);
    }
  }
  const slots=raw.commands.filter((a:Record<string,unknown>)=>a.kind==='walk_on').map((a:Record<string,unknown>)=>a.slot as string);
  const labels=raw.commands.filter((a:Record<string,unknown>)=>a.kind==='walk_on').map((a:Record<string,any>)=>a.label.normalize('NFKC').trim().toLowerCase());
  if(new Set(labels).size!==labels.length)throw Error('Duplicate newcomer labels');
  if(new Set(slots).size!==slots.length||raw.commands.filter((a:Record<string,unknown>)=>a.kind==='scene').length>1)throw Error('Duplicate scene or newcomer slot');
  raw.responses.forEach((value:unknown)=>responseDecision(value,slots));
  if(raw.commands.filter((a:Record<string,unknown>)=>a.kind==='move').length>1)throw Error('Only one destination per decision packet');
  if(raw.commands.some((a:Record<string,unknown>)=>a.kind==='move')&&raw.commands.some((a:Record<string,unknown>)=>a.kind==='time'))
    throw Error('Invalid decision command combination: movement already owns travel time; omit the time command');
  return raw as TurnPacket;
}
export function compileTurnPacket(packet:TurnPacket):{responses:ResponseDecision[];effects:Record<string,unknown>[];event?:Static<typeof TurnEvent>} {
  const ordered=[...packet.commands.filter(a=>!['walk_on','scene'].includes(a.kind)),...packet.commands.filter(a=>a.kind==='walk_on'),...packet.commands.filter(a=>a.kind==='scene')];
  return {responses:packet.responses,...(packet.event?{event:packet.event}:{}),effects:ordered.map(a=>a.kind==='move'?{kind:'move',to:a.to,...(a.via?{via:a.via}:{}),
    ...(a.travel_minutes!==undefined?{travel_minutes:a.travel_minutes}:{}),...(a.travel_band?{travel_band:a.travel_band}:{})}
    :a.kind==='npc'?{kind:'npc',name:a.actor,to:a.to,why:a.reason}:a.kind==='walk_on'?{kind:'npc',name:a.label,to:'here',walk_on:true,_new_person:true,why:a.reason}
    :a.kind==='scene'?{kind:'scene',name:'here',_population:true,activity:{service:a.service,crowd:a.crowd,basis:'established',summary:`Service is ${a.service}; crowd is ${a.crowd}.`,review_after_minutes:a.review_after_minutes??15},why:'The Keeper assessed current population from the place, clock and established circumstances.'}
    :{kind:'time',band:a.band,why:a.reason})};
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
export const TURN_PACKET_GUIDANCE='Submit ONE final native output call with {version:3,commands:[...],responses:[...]}. Commands settle before responses; this is not an interleaved program or a writing brief. '
  +'Use prepared state for routine movement and conversation. Missing evidence uses look/lookup/recall; other rules and state changes use the existing resolve/apply/ask tools first, then submit output once. Commands: {kind:"move",to:"exact issued destination",via?:"short selected route, only when required by this destination schema"}; {kind:"time",band:"supplied rule band",reason:"selected activity"}; {kind:"npc",actor:"supplied npc_N reference",to:"here|away|exact issued place",reason:"selected presence change"}. Reuse host-bound routes; fill via only for an issued destination whose schema requires it. '
  +'For unassessed/expired where.temporal, decide current population from place purpose, clock and circumstances, never from absence of module names. Add {kind:"scene",service:"open|closed|limited|unknown",crowd:"empty|quiet|active|crowded|unknown"}. A known upcoming change may set optional review_after_minutes within 1..60 instead of the system default 15. If people should be present but no supplied existing person fits, add {kind:"walk_on",slot:"new_1",label:"public role appellation",reason:"why here at this time"}; at most new_1 through new_4. Responses may use those declared slots, which the host binds to real NPC references. Reuse existing people and applicable scene assessments; move departing staff away explicitly when a shift changes. Do not recreate them. Empty is an explicit assessment, not a missing name. '
  +'Responses: {actor:"supplied npc_N reference or declared new_N slot",act:"answer|greet|ask|refuse|offer|acknowledge|clarify",points:["short meaning to convey"],stance?:"short attitude"}. '
  +'A silent response is only {actor,act:"silent"}, with no points or stance. Actual arrival/departure uses an npc command; use away for leaving the stage without a known destination. Response points contain only what the NPC communicates, not stage directions or a conditional execution plan. An offer states terms and awaits the player; it does not execute acceptance or its dependent consequences. Never write complete dialogue, scene prose, personality transcription or writing instructions. A claim is not automatic world truth. '
  +'Reuse supplied stable NPC refs; never invent or submit a display name as actor. Omit an NPC command when their position is already correct. Missing style does not require a new person or presence write. '
  +'When host_operations reports a settled journey, omit its move and time commands. Decide only the remaining NPC response or unresolved work. '
  +'Move proposes the current party destination, not success. Omit it for future plans, blocked travel and unchanged conversation. Source, actual duration, rule ranges, randomness and results are kernel-owned. '
  +'Never combine move and time in one packet. The move already charges its road time; separate activity timing is outside a journey packet. '
  +'The host supplies actual scene, clock, results, resolved speakers, optional style and recent public context to the sole author. Never fill success or receipt fields. '
  +'Ordinary speech costs no time. Do not turn a hypothetical inquiry into an order, quote, appointment or event. Resolve checks, purchases, inventory and new places through the existing rule and apply tools before final output; never imitate those operations inside response points or repeat effects that already landed. '
  +'For new findings, add optional event with the existing apply event schema: {name,summary,materials:[{name,text,kind:"fact|description|context",visibility:"player|keeper"}]}. Decide short observed facts or actual readable contents, not writing instructions; the same apply records them before the sole author writes. Reuse supplied evidence; event does not perform checks, movement or transfers, and an issued cause alone does not prove a quotation. Use existing knowledge fields only when needed. Empty commands/responses without event select no new information. The host publishes once; no acknowledgment inference is needed. For pure OOC use {{reference}} with no fictional writes.';
export function turnPacketSystemPrompt(source:string):string {
  const heading='Public response\n\n',end='\n\nKeep hidden motives,';
  const start=source.indexOf(heading),finish=start<0?-1:source.indexOf(end,start+heading.length);
  return start>=0&&finish>start?source.slice(0,start+heading.length)+TURN_PACKET_GUIDANCE+source.slice(finish):source;
}
