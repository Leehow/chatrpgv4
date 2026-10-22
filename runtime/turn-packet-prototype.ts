/** Opt-in decision commands; only the isolated author generates prose. */
import {normalizeToolArgumentSyntax} from './tool-argument-syntax.ts';
import {Type,type TSchema,type Static} from 'typebox';
import {Errors} from 'typebox/value';
import {StringEnum} from '@earendil-works/pi-ai';
import {NPC_REFERENCE_PATTERN,isNpcReference} from './npc-references.ts';
import {Interaction,ExistingCommunicationFact,bindCommunicationParameters,type DecisionBindings,type InteractionDecision} from './decision-content.ts';
import {PlaceEffect,locationCommandEntry,locationCommandOwner} from '../shared/place-structures.ts';
import {availableOutputSchema,sharedOutputSchema} from './provider-output-schema.ts';
const atom=(maxLength=160)=>Type.String({minLength:1,maxLength});

const move=Type.Object({kind:Type.Literal('move'),to:atom(),via:Type.Optional(atom()),travel_band:Type.Optional(atom(64))},{additionalProperties:false});
const actor=Type.String({pattern:NPC_REFERENCE_PATTERN,maxLength:32,description:'The supplied stable npc_N reference, never a display name.'});
const npc=Type.Object({kind:Type.Literal('npc'),actor,to:atom(),reason:atom()},{additionalProperties:false});
const slot=Type.String({pattern:'^new_[1-4]$'});
const walkOn=Type.Object({kind:Type.Literal('walk_on'),slot,label:atom(80),to:Type.Optional(Type.String({minLength:1,maxLength:240,description:'Exact established place for this new person; defaults to here. An observed remote person stays at that target.'})),reason:atom()},{additionalProperties:false});
const services=['open','closed','limited','unknown'] as const,crowds=['empty','quiet','active','crowded','unknown'] as const;
const scene=Type.Object({kind:Type.Literal('scene'),service:StringEnum([...services]),crowd:{...StringEnum([...crowds]),description:'Occupancy: empty means no other people, decided from circumstances; quiet/active/crowded is an unnamed crowd unless someone in it is registered. Use unknown when occupancy is unassessed. Missing registered names alone do not establish empty.'},review_after_minutes:Type.Optional(Type.Integer({minimum:1,maximum:60}))},{additionalProperties:false});
const timeOptions={additionalProperties:false,oneOf:[{required:['band']},{required:['minutes']},{required:['until']}]};
// §250: a selected wait to a clock time is the kernel's arithmetic, in the same packet as the stops around it.
const until=Type.Object({time:Type.String({pattern:'^[0-9]{2}:[0-9]{2}$',description:'The local 24-hour time the wait reaches, HH:MM.'}),
 days:Type.Optional(Type.Integer({minimum:0,description:'0 is the day this turn began; omit for the next time the clock reaches it.'}))},{additionalProperties:false});
const time=Type.Object({kind:Type.Literal('time'),band:Type.Optional(atom(64)),minutes:Type.Optional(Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER,description:'Copy only an explicitly selected positive player duration in whole minutes; never estimate a cost here. No additional time means omit the time command, never minutes:0. Use an issued band for an unspecified activity cost; its computed outcome may be zero.'})),
 until:Type.Optional(until),reason:atom(),beyond_travel:Type.Optional(Type.Boolean({description:'Optional; a move already counts its own travel.'}))},timeOptions);
const relationship=Type.Object({kind:Type.Literal('relationship'),actor,toward:Type.String({pattern:'^(npc_[1-9][0-9]*|investigator_[1-9][0-9]*)$',maxLength:32}),affinity:StringEnum(['hostile','guarded','neutral','friendly'])},{additionalProperties:false});
const placeMove=Type.Object(PlaceEffect.anyOf[0].properties,{additionalProperties:false,description:(PlaceEffect.anyOf[0] as {description?:string}).description});
const placeStationary=PlaceEffect.anyOf.slice(1);
const commandSchemas=[move,placeMove,...placeStationary,npc,walkOn,scene,time,relationship];
/** §250.4: field names the schema itself declares on some command; only these are ever named back in a refusal. */
const COMMAND_FIELDS=new Set(commandSchemas.flatMap(schema=>Object.keys((schema as Record<string,any>).properties??{})));
// §250: stops, waits and looks settle in their submitted order; a move counts its own travel, so time is always additional.
const commands=Type.Union([Type.Array(Type.Union([move,placeMove,time,...placeStationary,npc,walkOn,scene,relationship]),{maxItems:16})]);
/** Contract §247.3: a closed rendering selection for routine acts carried without per-act settlement; it writes nothing. */
export const ROUTINE_SUMMARY=Type.Object({
 acts:Type.Optional(Type.Array(atom(120),{minItems:1,maxItems:8,description:'Every routine act of this input you did not settle individually (ordering, eating, drinking, sitting, glancing), as short public phrases; the author renders them as one summary. Omit when the input only looks at ambient things.'})),
 ambient:Type.Optional(Type.Array(Type.Object({target:atom(80),notes:Type.Optional(Type.Array(atom(200),{maxItems:3,description:'Optional period detail for description only, never a new fact of the world.'}))},{additionalProperties:false}),
  {minItems:1,maxItems:3,description:'Each thing the player looks at or reads (a newspaper, a window) that carries nothing module-relevant; the author describes its ordinary period detail as texture. Relevant findings use the normal clue, observation or reveal path instead.'}))
},{additionalProperties:false,anyOf:[{required:['acts']},{required:['ambient']}],description:'Use whenever this input chains routine acts: they share one time charge (this packet\'s time command or an earlier one of this input) and get no per-act receipt; ambient looks alone need no time. Establishes no entity, clue, fact or receipt.'});
/** A model decides communication; the sole author owns all complete wording. */
/** §256.1: a short out-of-character table note the Keeper writes in the play language; it is never story material. */
export const TABLE_NOTE=Type.String({minLength:1,maxLength:400,description:'Optional out-of-character note to the player, in the play language, one or two sentences, shown apart from the story. Only to correct what the player misstated or misremembers of something the investigator knows, or to clarify a rule or choice. Never a secret, hint, lead, suggestion of what to do, or menu. The story and its people never repeat or make the correction.'});
export const TURN_PACKET_PARAMETERS=Type.Object({version:Type.Literal(4),commands:Type.Optional(commands),interactions:Type.Optional(Type.Array(Interaction,{maxItems:12})),reveal:Type.Optional(Type.Array(ExistingCommunicationFact,{maxItems:8})),ooc:Type.Optional(TABLE_NOTE)},{additionalProperties:false});
/** §247.3: the same packet with the routine element, issued only while a package declares the capability. */
export const TURN_PACKET_ROUTINE_PARAMETERS=Type.Object({...TURN_PACKET_PARAMETERS.properties,routine:Type.Optional(ROUTINE_SUMMARY)},{additionalProperties:false});
export const TURN_PACKET_ENTRY_PARAMETERS=locationCommandEntry(TURN_PACKET_PARAMETERS);
export type ResponseDecision=InteractionDecision;
export type RoutineSummary=Static<typeof ROUTINE_SUMMARY>;
export type TurnPacket=Static<typeof TURN_PACKET_PARAMETERS>&{routine?:RoutineSummary};
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
  // live el-v2-20261022h T12: a scene command carried a place command's action, and the refusal could not say which key.
  // A key is named only when the schema declares it on some command; any other key stays unnamed (it is model text).
  if(error.keyword==='additionalProperties'||error.schemaPath.endsWith('/additionalProperties')){
   const extra=(error.keyword==='additionalProperties'?[...((error.params as Record<string,any>)?.additionalProperties??[])]:[error.instancePath.split('/').at(-1)])
    .filter((key:unknown):key is string=>typeof key==='string'&&COMMAND_FIELDS.has(key));
   return `${label}/<additional-property>: must not have additional properties${extra.length?` (${[...new Set(extra)].join(', ')}, a field of another command kind)`:''}`;
  }
  const received=error.instancePath.split('/').slice(1).reduce<unknown>((row,key)=>object(row)||Array.isArray(row)?(row as Record<string,unknown>)[key.replace(/~1/g,'/').replace(/~0/g,'~')]:undefined,value);
  const type=received===null?'null':Array.isArray(received)?'array':typeof received;
  return `${label}${error.instancePath}: ${explanation(error)} (${error.keyword} ${JSON.stringify(error.params)}); received ${type}`;
 });
 const fields=[...new Set(errors.map(error=>`${label}${error.keyword==='additionalProperties'?'/<additional-property>':error.instancePath}: ${explanation(error)}`.slice(0,300)))];
 return new TurnPacketParameterError(`Invalid decision command: ${[...new Set(findings)].join('; ')||`${label} requires nonblank bounded strings`}`.slice(0,1600),fields);
}
/** §250.4: each command is checked against the variants its own kind (and action) names, so its real constraint is
 *  reported instead of every union branch (live el-v2-20261021d T21: an npc `to` was reported as a missing place action). */
function commandItemDiagnostic(parameters:TSchema,value:unknown):Error|undefined {
 if(!Array.isArray(value))return;
 const declared=(parameters.properties as Record<string,any>)?.commands;
 const items=variantsOf((Array.isArray(declared?.anyOf)?declared.anyOf:[declared]).find((candidate:Row)=>object(candidate)&&object(candidate.items))?.items);
 const names=(variant:Row,key:string):unknown[]=>{const field=variant.properties?.[key];return field?.const!==undefined?[field.const]:Array.isArray(field?.enum)?field.enum:[];};
 for(const [index,command] of value.entries()){
  if(!object(command)||typeof command.kind!=='string')continue;
  const own=items.filter(variant=>names(variant,'kind').includes(command.kind)
   &&(!variant.properties?.action||command.action===undefined||names(variant,'action').includes(command.action)));
  if(!own.length||own.some(variant=>!Errors(variant,command).length))continue;
  return parameterError(`commands[${index}]`,own[0],command);
 }
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
/** Object variants of a possibly nested union. */
// An object schema's own anyOf lists required alternatives (directions needs heading, via or retrace); it is one variant.
const variantsOf=(schema:any):any[]=>Array.isArray(schema?.anyOf)&&!schema.properties?schema.anyOf.flatMap(variantsOf):schema&&typeof schema==='object'?[schema]:[];
/** §250: each content item is checked against the one variant its own key names, so its real constraint is reported. */
function contentDiagnostic(parameters:TSchema,raw:unknown):Error|undefined {
 if(!object(raw)||!Array.isArray(raw.interactions))return;
 const declared=variantsOf((parameters as any).properties?.interactions?.items);
 for(const [index,row] of raw.interactions.entries()){
  if(!object(row)||!Array.isArray(row.content))continue;
  const schema=declared.find(variant=>variant.properties?.act&&(variant.properties.act.const===row.act||variant.properties.act.enum?.includes(row.act)));
  const items=variantsOf(schema?.properties?.content?.items);
  for(const [ordinal,item] of row.content.entries()){
   if(!object(item)||Object.keys(item).length!==1)continue;
   const key=Object.keys(item)[0],variant=items.find(candidate=>candidate.properties&&Object.hasOwn(candidate.properties,key));
   if(!variant)continue;
   const label=`interactions[${index}]/content/${ordinal}`;
   if(key==='new'&&object(item.new)){
    const constructors=variantsOf(variant.properties.new),constructor=constructors.find(candidate=>candidate.properties?.predicate?.const===item.new.predicate);
    if(!constructor)return new TurnPacketParameterError(`Invalid decision command: ${label}/new/predicate: must be one of ${JSON.stringify(constructors.map(candidate=>candidate.properties?.predicate?.const).filter(Boolean))}`,[`${label}/new/predicate`]);
    if(Errors(constructor,item.new).length)return parameterError(`${label}/new`,constructor,item.new);
   }else if(Errors(variant,item).length)return parameterError(label,variant,item);
  }
 }
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
const PLACE_ACTIONS=new Set(['move','establish','feature','relate','observe','inspect']);
/** The packet's own top-level fields and the kinds a command may carry, read off the declared schema. */
const PACKET_FIELDS=()=>new Set(Object.keys(TURN_PACKET_ROUTINE_PARAMETERS.properties));
const COMMAND_KINDS=()=>{const commands=(TURN_PACKET_ROUTINE_PARAMETERS.properties as Record<string,any>).commands;
 return new Set((commands.anyOf??[commands]).filter((list:any)=>list?.items).flatMap((list:any)=>variantsOf(list.items))
  .map((variant:any)=>variant.properties?.kind?.const).filter((kind:unknown)=>typeof kind==='string'));};
export function normalizeTurnPacketArguments(input:unknown):{args:unknown;repairs:number;integerRepairs?:number;booleanRepairs?:number;textRepairs?:number;placeKindRepairs?:number;npcHereRepairs?:number;strayCommandRepairs?:number} {
  const normalized=normalizeToolArgumentSyntax(TURN_PACKET_ROUTINE_PARAMETERS,input,{boundedIntegers:true,exactBooleans:true,partialTransport:true});
  let value=normalized.args;
  // §250.4: a command written as a field of its own beside commands (live el-v2-20261021g T32: item:{kind:"place",
  // action:"observe",...}) is that command, after the ones in commands. Only a value that is a command, or a list of
  // commands, of a declared kind moves; anything else stays for the schema's refusal.
  let strayCommandRepairs=0;
  if(object(value)){
   const fields=PACKET_FIELDS(),kinds=COMMAND_KINDS(),isCommand=(row:unknown)=>object(row)&&typeof row.kind==='string'&&kinds.has(row.kind);
   const stray=Object.entries(value).filter(([key,held])=>!fields.has(key)&&(isCommand(held)||Array.isArray(held)&&held.length>0&&held.every(isCommand)));
   if(stray.length&&(value.commands===undefined||Array.isArray(value.commands))){
    const moved=stray.flatMap(([,held])=>Array.isArray(held)?held:[held]);strayCommandRepairs=moved.length;
    value={...Object.fromEntries(Object.entries(value).filter(([key])=>!stray.some(([name])=>name===key))),commands:[...(value.commands as unknown[]??[]),...moved]};
   }
  }
  // §250.4: a command carrying a place action but no kind can only be a place command (live el-v2-20261021b T19).
  if(!object(value)||!Array.isArray(value.commands))return strayCommandRepairs?{...normalized,args:value,strayCommandRepairs}:normalized;
  let placeKindRepairs=0;
  const commands=value.commands.map(command=>{
   if(!object(command))return command;
   let row=command;
   if(row.kind===undefined&&typeof row.action==='string'&&PLACE_ACTIONS.has(row.action)){placeKindRepairs++;row={kind:'place',...row};}
   // A place command's optional field sent as a blank string says nothing (live el-v2-20261021e T8).
   if(row.kind==='place'){const blank=Object.keys(row).filter(key=>!['kind','action','to'].includes(key)&&typeof row[key]==='string'&&!(row[key] as string).trim());
    if(blank.length){placeKindRepairs+=blank.length;row=Object.fromEntries(Object.entries(row).filter(([key])=>!blank.includes(key)));}}
   return row;
  });
  // §250.4: after this packet's own move reaches a place, an NPC sent to that place is sent here (live el-v2-20261021d
  // T21). Before the move, here is still the departure, so an earlier command is left alone.
  let reached:string|undefined,npcHereRepairs=0;
  const bound=commands.map((command:unknown)=>{
   if(!object(command))return command;
   if((command.kind==='move'||command.kind==='place'&&command.action==='move')&&typeof command.to==='string'&&command.to!=='here'){reached=command.to;return command;}
   if(command.kind!=='npc'||typeof command.to!=='string'||reached===undefined||command.to!==reached)return command;
   npcHereRepairs++;return {...command,to:'here'};
  });
  return placeKindRepairs||npcHereRepairs||strayCommandRepairs?{...normalized,args:{...value,commands:bound},...(placeKindRepairs?{placeKindRepairs}:{}),...(npcHereRepairs?{npcHereRepairs}:{}),...(strayCommandRepairs?{strayCommandRepairs}:{})}:normalized;
}
/** One current parameter contract for the native declaration and submission. */
export function turnPacketParameterSchema(journeySettled=false,timeBands?:readonly string[],moveChoices?:readonly Record<string,unknown>[],sceneRequired=false,bindings?:DecisionBindings,locations=false,timeBandRows?:readonly {handle:string;covers?:string}[],routine=false,
    /** Whether location turns project the location provider's owner view; false leaves the raw commands for an entry view. */
    ownerView=true):TSchema {
    // §247.3: the routine element exists only while an active package declares the routine-summary capability.
    const schema:Record<string,any>=structuredClone(routine?TURN_PACKET_ROUTINE_PARAMETERS:TURN_PACKET_PARAMETERS);
    const meanings=timeBandRows?.filter(row=>timeBands?.includes(row.handle)&&row.covers).map(row=>`${row.handle}: ${row.covers}`);
    if(meanings?.length)schema.description=`Optional independent activity costs use the applicable current rule meaning; a category name alone is not its definition. No separate bookkeeping time is required for every command.\n${meanings.join("\n")}`;
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
    const arrivedFields={kind:Type.Literal('place'),action:Type.Literal('move'),to:Type.Literal('here'),
        relation:PlaceEffect.anyOf[0].properties.relation,additions:PlaceEffect.anyOf[0].properties.additions};
    const arrivedLocal=[Type.Object({...arrivedFields,at:atom(240)},{additionalProperties:false}),
        Type.Object({...arrivedFields,spot:Type.String({...PlaceEffect.anyOf[0].properties.spot})},{additionalProperties:false})];
    if(journeySettled)schema.properties.commands=Type.Array(Type.Union([...(locations?arrivedLocal:[]),...local,issuedNpc,walkOn,scene,relationship]),{maxItems:12,...stationary});
    else schema.properties.commands=Type.Union([Type.Array(Type.Union([...issuedMoves,...journey,boundedTime,...local,issuedNpc,walkOn,scene,relationship]),{maxItems:16,...stationary})]);
    if(sceneRequired)schema.required=[...new Set([...(schema.required??[]),'commands'])];
    return locations&&ownerView?locationCommandOwner(schema as TSchema):schema as TSchema;
}
/** Install the current execution contract after either supported provider conversion. */
export function turnPacketProviderPayload(payload:unknown,schema:TSchema=turnPacketParameterSchema(),requireTool=true):unknown {
  if(!object(payload)||!Array.isArray(payload.tools))return payload;
  const messages=Array.isArray(payload.messages),responses=Array.isArray(payload.input);
  if(!messages&&!responses)return payload;
  let available:TSchema|undefined;
  let changed=false;
  const tools=payload.tools.map((tool:unknown)=>{
    if(!object(tool)||tool.name!=='output')return tool;
    if(messages&&object(tool.input_schema)){changed=true;return {...tool,input_schema:schema};}
    if(responses&&object(tool.parameters)){changed=true;return {...tool,parameters:available??=(payload.model==='grok-4.5'?sharedOutputSchema(availableOutputSchema(schema)):availableOutputSchema(schema))};}
    return tool;
  });
  if(!changed)return payload;
  return {...payload,tools,...(messages&&requireTool&&payload.model==='MiniMax-M3.1-Flash-Preview'?{tool_choice:{type:'auto'}}:{})};
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
  // §250.4: the schema the command's own kind names and the one its action names compete; the one that declares more of
  // the command's keys is what it was written as, the kind's on a tie. A place observation under kind "move" is still
  // reported as a wrong kind, and a scene assessment carrying a stray action (live el-v2-20261022h T12) as a stray action,
  // not as a place observation missing its facts.
  const declared=(schema:TSchema)=>Object.keys(command??{}).filter(key=>Object.hasOwn((schema as Record<string,any>).properties??{},key)).length;
  const byKind=commandSchemas.filter(schema=>schema.properties.kind.const===command?.kind
   &&(!(schema.properties as Record<string,any>).action||(schema.properties as Record<string,any>).action.const===command?.action));
  const byAction=command?.action===undefined?[]:commandSchemas.filter(schema=>(schema.properties as Record<string,any>).action?.const===command.action);
  const schema=[...byKind,...byAction].reduce<TSchema|undefined>((best,candidate)=>!best||declared(candidate)>declared(best)?candidate:best,undefined);
  if(schema&&Errors(schema,command).length)throw parameterError(`commands[${index}]`,schema,command);
 }
 {const content=contentDiagnostic(TURN_PACKET_PARAMETERS,raw);if(content)throw content;}
 if(object(raw)&&Array.isArray(raw.interactions))for(const row of raw.interactions)responseDecision(row,(raw.commands??[]).filter((row:any)=>row?.kind==='walk_on').map((row:any)=>row.slot));
 if(object(raw)&&raw.routine!==undefined){
  // Issuance is the per-turn schema's; without one the host checks the active capability before execution (§247.3).
  if(parameters&&!object((parameters as Record<string,any>).properties?.routine))throw new TurnPacketParameterError('Invalid decision command: routine is not issued for this turn; settle or omit the routine acts',['packet/routine: not issued']);
  if(Errors(ROUTINE_SUMMARY,raw.routine).length)throw parameterError('routine',ROUTINE_SUMMARY,raw.routine);
 }
 const base=object(raw)&&raw.routine!==undefined?Object.fromEntries(Object.entries(raw).filter(([key])=>key!=='routine')):raw;
 if(Errors(TURN_PACKET_PARAMETERS,base).length)throw parameterError('packet',TURN_PACKET_PARAMETERS,base);
 if(parameters){const diagnostic=commandItemDiagnostic(parameters,raw.commands)??commandArrayDiagnostic(parameters,raw.commands)??contentDiagnostic(parameters,raw);if(diagnostic)throw diagnostic;}
 if(parameters&&Errors(parameters,raw).length)throw parameterError('packet',parameters,raw);
 const packet=raw as TurnPacket,commands=packet.commands??[],interactions=packet.interactions??[];
 const slots=commands.filter(a=>a.kind==='walk_on').map(a=>a.slot);
 const labels=commands.filter(a=>a.kind==='walk_on').map(a=>a.label.normalize('NFKC').trim().toLowerCase());
 if(new Set(labels).size!==labels.length||new Set(slots).size!==slots.length||sceneStops(commands).some(stop=>stop>1))throw Error('Duplicate newcomer labels, scene or slot');
 interactions.forEach(value=>responseDecision(value,slots));
 for(const command of commands)if(command.kind==='place'&&command.action==='observe')
  for(const name of [...command.people??[],...(command.situations??[]).flatMap(situation=>situation.participants??[])])
   if(isNewNpcSlot(name)&&!slots.includes(name))throw Error('Unbound observation newcomer slot');
 return packet;
}
/** A command that leaves the current place for another; a move to here stays. */
const departs=(command:NonNullable<TurnPacket['commands']>[number])=>command.kind==='move'||command.kind==='place'&&command.action==='move'&&command.to!=='here';
/**
 * §250.12: scene assessments per stop of the route. A scene command assesses the place the route stands at when it is
 * given, so one per stop; two in the same stop are a duplicate.
 */
function sceneStops(commands:NonNullable<TurnPacket['commands']>):number[] {
 const stops=[0];
 for(const command of commands){if(departs(command))stops.push(0);else if(command.kind==='scene')stops[stops.length-1]++;}
 return stops;
}
export function compileTurnPacket(packet:TurnPacket|BoundTurnPacket):{responses:ResponseDecision[];effects:Record<string,unknown>[];event?:{name:string;relationships:Array<{actor:string;toward:string;statement:string}>}} {
 const commands=packet.commands??[];
 const directed=commands.filter(a=>a.kind==='relationship');
 const definitions=commands.flatMap(a=>a.kind==='place'&&a.action==='observe'&&a.additions?[{kind:'place',action:'establish',additions:a.additions}]:[]);
 const ordered:typeof commands=[];
 const pending=commands.filter(a=>a.kind==='walk_on');
 const register=(slots?:readonly string[])=>{for(let i=0;i<pending.length;){const person=pending[i];if(slots&&!slots.includes(person.slot)){i++;continue;}ordered.push(person);pending.splice(i,1);}};
 // §250.12: one assessment is the final declaration for where the route ends, wherever it is written (as it always was);
 // with several, each settles at the end of its own stop, after the newcomers submitted before it and before the route
 // leaves, and the last stop's settles after everything.
 const perStop=commands.filter(a=>a.kind==='scene').length>1;
 let stop:typeof commands=[];
 const settleStop=()=>{for(const scene of stop){register(commands.slice(0,commands.indexOf(scene)).filter(a=>a.kind==='walk_on').map(a=>a.slot));ordered.push(scene);}stop=[];};
 for(const command of commands){
  if(command.kind==='scene'){stop.push(command);continue;}
  if(['walk_on','relationship'].includes(command.kind))continue;
  if(perStop&&departs(command)){
   // A newcomer written for here before the route leaves belongs to the stop it was written at, unless a later look names it.
   const at=commands.indexOf(command),later=new Set(commands.slice(at).flatMap(a=>a.kind==='place'&&a.action==='observe'?[...a.people??[],...(a.situations??[]).flatMap(situation=>situation.participants??[])]:[]));
   register(commands.slice(0,at).filter(a=>a.kind==='walk_on'&&(a.to===undefined||a.to==='here')&&!later.has(a.slot)).map(a=>a.slot));
   settleStop();
  }
  if(command.kind==='place'&&command.action==='observe')register([...command.people??[],...(command.situations??[]).flatMap(situation=>situation.participants??[])]);
  ordered.push(command);
 }
 register();ordered.push(...stop);
 const newcomers=new Map(commands.filter(a=>a.kind==='walk_on').map(a=>[a.slot,a.label]));
 const person=(name:string)=>newcomers.get(name)??name;
 return {responses:packet.interactions??[],...(directed.length?{event:{name:'Directed relationship update',relationships:directed.map(row=>({actor:row.actor,toward:row.toward,statement:JSON.stringify({kind:'directed_relationship',affinity:row.affinity})}))}}:{}),effects:[...definitions,...ordered.map(a=>a.kind==='move'?{kind:'move',to:a.to,...(a.via?{via:a.via}:{}),
  ...('travel_minutes'in a&&a.travel_minutes!==undefined?{travel_minutes:a.travel_minutes}:{}),...(a.travel_band?{travel_band:a.travel_band}:{})}
  :a.kind==='place'?a.action==='observe'?{...Object.fromEntries(Object.entries(a).filter(([key])=>key!=='additions')),...(a.people?{people:a.people.map(person)}:{}),...(a.situations?{situations:a.situations.map(situation=>({...situation,...(situation.participants?{participants:situation.participants.map(person)}:{})}))}:{})}:{...a}:a.kind==='npc'?{kind:'npc',name:a.actor,to:a.to,why:a.reason}:a.kind==='walk_on'?{kind:'npc',name:a.label,to:a.to??'here',walk_on:true,_new_person:true,why:a.reason}
  :a.kind==='scene'?{kind:'scene',name:'here',_population:true,activity:{service:a.service,crowd:a.crowd,basis:'established',summary:`Service is ${a.service}; crowd is ${a.crowd}.`,review_after_minutes:a.review_after_minutes??15},why:'Current place, clock and registered circumstances establish this population assessment.'}
  :a.kind==='time'?{kind:'time',...(a.minutes!==undefined?{minutes:a.minutes}:a.until!==undefined?{until:{...a.until}}:{band:a.band}),why:a.reason,...(a.beyond_travel===true?{beyond_travel:true}:{})}:(()=>{throw Error('Non-effect decision command reached the effect compiler');})())]};
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
export const TURN_PACKET_LOCATION_STEPS='Put the whole selected route in commands, in the order the player chose: kind:"place" action:"move" for each stop (a new place carries its minimal additions; inside the current place use to:"here" with at or a free-text spot, which takes no travel time), kind:"time" with minutes, until {time:"HH:MM"} or an issued band for each selected wait, and kind:"place" action:"observe" with short facts for what the investigator perceives. Several stops, waits and looks may share one packet; the kernel settles them in order and counts travel itself. Call the place tool first only when a roll must follow an arrival at another place. ';
export const TURN_PACKET_GUIDANCE='Submit one output packet {version:4,commands?,interactions?,reveal?}. Call earlier place/apply/resolve operations first and read their results; put no state-changing tool after output in the same assistant message. A remote place inspection never performs the selected journey: include its still-unsettled move before observing from that destination. Omit unchanged categories. Commands settle in their submitted order before communication; do not defer an earlier view until after a later move or wait. Put walk_on before observations using its slot and scene after relevant presence changes. Unknown outcomes still require separate tools. '
 +TURN_PACKET_LOCATION_STEPS+'Places beyond issued routes use the same place fields. Reuse known names; a different name for the same place is not a new place. Establish registers surroundings only and moves nobody. A place receipt lists any adjusted fields it repaired; continue from what it settled. '
 +'Use issued movement destinations and routes, optional issued travel bands, npc presence, walk_on, scene and stationary time commands. A move counts its own travel; never add that travel as time. For an explicitly selected player duration use {kind:"time",minutes:the stated whole minutes,reason}; for a wait to a clock time use until; only when an independent selected activity needs an unspecified cost, select an issued band by its current rule meaning instead. A glance or local return does not require a bookkeeping pause. Give one of minutes, until or band. A changed directed attitude uses {kind:"relationship",actor:"issued npc_N",toward:"issued person reference",affinity:"hostile|guarded|neutral|friendly"}. Use the existing mechanical apply effects, resolve and ask for other real rules and state changes, never for prose or prospective event records. '
 +'Assess an unassessed or expired scene with {kind:"scene",service:"open|closed|limited|unknown",crowd:"empty|quiet|active|crowded|unknown",review_after_minutes?:1..60}, at most one per stop, after that stop\'s move; left out, it is recorded as unknown and nothing is refused, and a room inside a place assessed empty is already empty. Only an empty assessment beside a registered person here must be corrected. Determine population from the place, clock and circumstances; missing names never mean empty. A quiet, active or crowded scene is an unnamed crowd: register a person with walk_on only when they act, speak or are singled out; choose empty when alone is established. If needed establish a temporary person with {kind:"walk_on",slot:"new_1",label:"public role appellation",reason:"why present"}; reuse existing people. '
 +'Interactions select {actor:"issued npc_N or declared new_N",to:["issued investigator_N or npc_N"],act:"answer|greet|ask|refuse|offer|acknowledge|clarify|report|warn",content?:[{fact_ref:"issued fact_N"}|{source_ref:"issued source_N"}|{new:registered constructor}]}. Silent is {actor,act:"silent",to?}, without content. '
 +'Answer, ask, offer, clarify, report and warn require nonempty content; greet, refuse and acknowledge may omit it. Select exact prepared facts and source fragments from decision_materials. Actor-scoped facts belong to that actor; a report, belief or plan is not truth. reveal selects only eligible non-actor facts or sources for narration, and exhibits: {exhibit_ref:"issued exhibit_N"} is a document or perception the investigators read or perceive now (decision_materials.exhibits lists carrier, label and clue state, never the text). When an exhibit exists for what is found, reveal the exhibit and do not apply the clue it teaches: revealing it discovers that clue once through the usual check of that clue, and the whole packet is refused with the missing check named when that check is not yet met or the carrier is not here. A testimony exhibit (catalog kind testimony, with owners and a stance) is what its owner says: select it as {exhibit_ref} in the interaction content of that owner, never in reveal; a non-owner is refused naming the owners, and a lie or deflection reaches the author as the words of that speaker, not world truth. New claims use registered typed constructors, including directions with a destination and heading, known waypoints or retrace:true; no free-text statement, dialogue, event, intent, stance or materials. Directions are advice, never movement. An offer or planned_visit executes nothing. '
 +'The host supplies current public labels, character state, personality, directed relationships, actual outcomes and selected fragments to the sole prose author. Do not repeat them. Only changed state uses existing canonical effects. No event, knowledge or relationship statement is needed just to speak. '
 +'Read missing evidence only when necessary. Do not repeat supplied material or settled operations. Randomness, computed time costs, ranges, receipts and success are host-owned; only an explicitly selected player duration is copied into minutes. When host_operations reports a settled journey, omit move and duplicate travel time. The author streams plain prose once. Background memory uses actual delivered words; proposed communication is not already heard. For pure OOC use {{reference}} without fictional writes.';
/** Install one coherent capability instruction; inherited prose/event jobs do not survive. */
export function turnPacketSystemPrompt(source:string):string {
 const incompatible=['Before recording prospective speech,','Record new event semantics,','A new NPC promise to act later','An ordinary nonmechanical NPC act completed','When a previously planned action has now happened,'];
 let kept=source.split('\n\n').filter(paragraph=>!incompatible.some(prefix=>paragraph.startsWith(prefix))).join('\n\n');
 kept=kept.replace('Use apply for physical changes, resources, clues, time, position and explicit semantic records.',
  'Use apply for physical changes, resources, clues, time, position.');
 const start=kept.indexOf('Public response\n\n'),end=kept.indexOf('\n\nKeep hidden motives,',start);
 if(start>=0&&end>start)kept=kept.slice(0,start)+'Public response\n\n'+TURN_PACKET_GUIDANCE+kept.slice(end);
 else kept+='\n\n'+TURN_PACKET_GUIDANCE;
 kept=kept.replace("You are the Keeper and content planner of this Call of Cthulhu 7th edition table. Understand the player's actual words, the current situation and each character's knowledge. Decide what happens, settle it through tools, then supply a private expression brief. A fresh isolated DeepSeek author chooses the final wording.", 'You are the Keeper decision agent of this Call of Cthulhu 7th edition table. Understand the player input, current situation and actor knowledge. Select actions and communication meaning; the sole author chooses complete wording.');
 return kept;
}
