/**
 * Turn IR (docs/specs/turn-ir.md, contract §270): the Keeper's ordered actions in eight closed families, written with
 * names. The host binds the names, splits the list at its rule barriers and translates each segment into the v4 packet
 * the kernel already settles; the Keeper never chooses between apply, walk_on, reveal or a content reference kind.
 */
import {Type,type Static,type TSchema} from 'typebox';
import {Errors} from 'typebox/value';
import {StringEnum} from '@earendil-works/pi-ai';
import {NewCommunicationFact,MEANING_MAX,DELIVERY,ASKED_TOPIC} from './decision-content.ts';
import {DISPOSITIONS,CONTROLS,TABLE_NOTE} from './turn-packet-prototype.ts';
import {isNpcReference} from './npc-references.ts';
type Row=Record<string,any>;
const closed=<T extends Record<string,TSchema>>(fields:T,description?:string)=>Type.Object(fields,{additionalProperties:false,...(description?{description}:{})});
const text=(max=160,description?:string)=>Type.String({minLength:1,maxLength:max,pattern:'\\S',...(description?{description}:{})});
const who=text(80,'A person by name: the book\'s printed name, the table\'s word for them, an investigator\'s name, or an @alias this list introduced');
const people=Type.Array(who,{minItems:1,maxItems:12,uniqueItems:true});
const reference=Type.String({pattern:'^(fact|source|exhibit)_[1-9][0-9]*$',maxLength:32,description:'An issued fact_N, source_N or exhibit_N'});
const when=Type.Optional(closed({check:text(16,'The as name of an earlier rule action in this list'),passed:Type.Boolean()},
 'This action happens only when that check passed (true) or failed (false); otherwise it is dropped'));
const level=Type.Optional(Type.Integer({minimum:0,maximum:5}));
/** §270: what the Keeper is told about Turn IR; principles and the shape, not what the schema already says. */
export const TURN_IR_GUIDANCE='Submit one output {version:5,actions:[...]} listing what happens this turn in order. Name people, places and things by '
 +'name: the book\'s printed name, the table\'s word for them, an investigator\'s name, or an @alias a presence enter introduced. '
 +'move: who goes where (inside names the known place a new one lies in). presence: someone enters or leaves; only enter brings a person here, '
 +'and as gives a newcomer\'s public appellation. communicate: speaker, to, act; says is issued fact_N/source_N/exhibit_N, {claim} for what they '
 +'mean (said, not true), or {knowledge} (unknown, uncertain, withheld, nothing_more); a {new} constructor takes issued references only, so a '
 +'place or person without one is a {claim}; channel phone or letter reaches someone who is not here; an investigator\'s own words need no action. '
 +'perceive: what the investigators take in, as an issued reference, a clue by name, or {observe}. material: show, transfer, take, open or close '
 +'a thing; holder has it now; access says how much a reader takes in. time, relationship (only a real change), mood, learn_alias, scene. '
 +'rule: a check with its goal and stakes fixed before the roll, named by as. Everything before a rule action settles first, then the roll; an '
 +'action after it may carry when:{check,passed} and happens only on that result. End the list at a rule action when what follows needs its '
 +'result read first: the result comes back and you submit the rest. A settled check is final; never re-judge it. Pushing and Luck are the '
 +'player\'s own declarations. Record only what this turn changed; you decide what is meant, the author writes the words.';

export const TURN_IR_ACTIONS={
 move:closed({op:Type.Literal('move'),to:text(120,'Where they go: a known place\'s name, or a new place; here with spot to move within the current place'),actors:Type.Optional(people),
  spot:Type.Optional(text(160,'A free-text spot inside the destination (by the window)')),relation:Type.Optional(text(60,'standing, sitting, ...')),reason:Type.Optional(text(160)),
  inside:Type.Optional(text(120,'For a new place: the known place it lies inside (a room in a building)')),via:Type.Optional(text(120)),
  band:Type.Optional(text(64,'An issued travel band, for a journey whose length the fiction gives')),when}),
 presence:closed({op:Type.Literal('presence'),who,action:StringEnum(['enter','leave']),
  as:Type.Optional(text(80,'For someone new: their public appellation (the clerk, a fisherman)')),at:Type.Optional(text(120,'Where they enter or go; here by default')),
  reason:text(160),when}),
 communicate:closed({op:Type.Literal('communicate'),speaker:who,to:people,
  act:StringEnum(['answer','ask','offer','clarify','report','warn','greet','refuse','acknowledge','silent']),
  says:Type.Optional(Type.Array(Type.Union([reference,
   closed({claim:text(MEANING_MAX,`What they mean, at most ${MEANING_MAX} characters of reported meaning, never their words; said, not true`)}),
   closed({knowledge:StringEnum(['unknown','uncertain','withheld','nothing_more']),topic:Type.Optional(text(96,'Ignored: the topic is what the investigator just asked'))}),
   closed({new:NewCommunicationFact})]),{minItems:1,maxItems:12})),
  channel:Type.Optional(StringEnum(['in_person','aside','phone','letter'])),beat:Type.Optional(text(120,'What they visibly do; behavior only')),
  delivery:Type.Optional(StringEnum([...DELIVERY])),reason:Type.Optional(text(160)),when}),
 perceive:closed({op:Type.Literal('perceive'),what:Type.Array(Type.Union([reference,
  closed({clue:text(120,'A book clue\'s name as where.affordances lists it, or a new short name'),how:text(240),summary:Type.Optional(text(600,'Only for a clue the book does not have')),from:Type.Optional(who)}),
  closed({observe:text(240,'A short fact of what is perceived here')})]),{minItems:1,maxItems:8}),reason:Type.Optional(text(160)),when}),
 material:closed({op:Type.Literal('material'),action:StringEnum(['show','transfer','take','open','close']),item:text(120,'The object or paper by name'),
  holder:text(80,'Who has it now (show, open, close, transfer: the giver)'),to:Type.Optional(who),
  access:Type.Optional(StringEnum(['glimpse','inspect','read_full'],{description:'show: how much the reader takes in; read_full reads it whole'})),
  quote:Type.Optional(text(400,'glimpse: the exact visible passage')),reason:text(160),when}),
 time:closed({op:Type.Literal('time'),minutes:Type.Optional(Type.Integer({minimum:1})),until:Type.Optional(Type.String({pattern:'^[0-9]{2}:[0-9]{2}$'})),
  band:Type.Optional(text(64)),reason:text(160),when}),
 relationship:closed({op:Type.Literal('relationship'),who,toward:who,disposition:Type.Optional(StringEnum([...DISPOSITIONS])),trust:level,fear:level,pressure:level,
  control:Type.Optional(StringEnum([...CONTROLS])),reason:Type.Optional(text(160)),when}),
 rule:closed({op:Type.Literal('rule'),as:text(16),intent:Type.Optional(StringEnum(['investigate','social','move','combat','flee','cast'],{description:'The rule family; investigate by default'})),
  decision:Type.Optional(text(96,'An issued action.decision when one applies (a treatment, a combat move)')),actor:Type.Optional(who),skill:Type.Optional(text(64)),goal:text(200,'What success achieves, fixed before the roll'),
  stakes:text(200,'What failure costs, fixed before the roll'),method:Type.Optional(text(160)),target:Type.Optional(who),
  difficulty:Type.Optional(StringEnum(['regular','hard','extreme'])),reason:Type.Optional(text(160)),when}),
 mood:closed({op:Type.Literal('mood'),who,mood:text(200),reason:Type.Optional(text(160)),when}),
 learn_alias:closed({op:Type.Literal('learn_alias'),who,alias:text(60),reason:Type.Optional(text(160)),when}),
 scene:closed({op:Type.Literal('scene'),service:StringEnum(['open','closed','limited','unknown']),crowd:StringEnum(['empty','quiet','active','crowded','unknown']),reason:Type.Optional(text(160)),when})
};
export const TURN_IR_PARAMETERS=closed({version:Type.Literal(5),actions:Type.Array(Type.Union(Object.values(TURN_IR_ACTIONS)),{minItems:1,maxItems:24}),ooc:Type.Optional(TABLE_NOTE)});
export type TurnIr=Static<typeof TURN_IR_PARAMETERS>;
export type TurnIrAction=TurnIr['actions'][number];

/**
 * §270.9: an action's fields as its own op declares them. A field another op (or the v4 packet) uses is dropped and
 * reported, not refused (live 1025g: reason on communicate, at/spot/relation on move, additions on move); a move's `at`
 * is its spot. Returns the cleaned list and what was dropped, by action index.
 */
export function normalizeTurnIr(value:unknown):{value:unknown;dropped:Array<{index:number;fields:string[]}>} {
 if(!value||typeof value!=='object'||!Array.isArray((value as Row).actions))return {value,dropped:[]};
 const dropped:Array<{index:number;fields:string[]}>=[];
 const actions=(value as Row).actions.map((action:unknown,index:number)=>{
  if(!action||typeof action!=='object'||Array.isArray(action))return action;
  const row={...(action as Row)},schema=(TURN_IR_ACTIONS as Record<string,any>)[String(row.op)];
  if(!schema)return row;
  if(row.op==='move'&&typeof row.at==='string'&&row.spot===undefined){row.spot=row.at;delete row.at;}
  // A reference written as an object ({fact_5: ...} or v4's {fact_ref:"fact_5"}) is the reference itself (live 1025h).
  const reference=(item:unknown)=>{
   if(!item||typeof item!=='object'||Array.isArray(item))return item;
   const keys=Object.keys(item as Row),ref=(item as Row).fact_ref??(item as Row).source_ref??(item as Row).exhibit_ref;
   if(typeof ref==='string'&&/^(fact|source|exhibit)_[1-9][0-9]*$/.test(ref))return ref;
   // {knowledge:{knowledge,topic}} is the knowledge item one level too deep (live 1025h Digging T2).
   const nested=(item as Row).knowledge;
   if(nested&&typeof nested==='object'&&!Array.isArray(nested))return {...(item as Row),...(nested as Row),knowledge:(nested as Row).knowledge??(nested as Row).status};
   return keys.length===1&&/^(fact|source|exhibit)_[1-9][0-9]*$/.test(keys[0])?keys[0]:item;
  };
  for(const key of ['says','what'])if(Array.isArray(row[key]))row[key]=row[key].map(reference);
  // A duration written as text or with a fraction is whole minutes; none at all is no duration (live 1025h T9, T11).
  if(row.op==='time'&&row.minutes!==undefined){const minutes=Math.round(Number(row.minutes));if(Number.isFinite(minutes)&&minutes>=1)row.minutes=minutes;else delete row.minutes;}
  const allowed=new Set(Object.keys(schema.properties)),extra=Object.keys(row).filter(key=>!allowed.has(key));
  for(const key of extra)delete row[key];
  if(extra.length)dropped.push({index,fields:extra});
  return row;
 });
 return {value:{...(value as Row),actions},dropped};
}
/** §270.9: the first problems of each action against its own op's schema, named by index, op and field. */
export function diagnoseTurnIr(value:unknown):string[] {
 const findings:string[]=[];
 if(!value||typeof value!=='object')return ['output must be an object {version:5,actions:[...]}'];
 const row=value as Row;
 if(row.version!==5)findings.push('version must be 5');
 if(!Array.isArray(row.actions)||!row.actions.length)return [...findings,'actions must be a non-empty list'];
 row.actions.forEach((action:unknown,index:number)=>{
  const op=action&&typeof action==='object'?(action as Row).op:undefined,schema=(TURN_IR_ACTIONS as Record<string,any>)[String(op)];
  if(!schema){findings.push(`actions[${index}].op must be one of ${Object.keys(TURN_IR_ACTIONS).join(', ')}`);return;}
  for(const error of [...Errors(schema,action)].slice(0,3))
   findings.push(`actions[${index}] (${op})${error.instancePath||''}: ${error.message}${error.keyword==='required'?' '+JSON.stringify((error.params as Row)?.requiredProperties??''):''}`);
 });
 return findings.slice(0,6);
}
/** A refusal naming the action it is about, what is wrong and how to fix it. */
export class TurnIrError extends Error {
 readonly index:number;readonly details:Row;
 constructor(index:number,message:string,details:Row={}){super(`actions[${index}]: ${message}`);this.name='TurnIrError';this.index=index;this.details=details;}
}
/** What a name is at this table: an issued person, an investigator, several (ambiguous), or nobody known. */
export type Binding={ref:string}|{investigator:string;name:string}|{ambiguous:string[]}|undefined;
export interface TurnIrDirectory {person(name:string):Binding;
 /** The one public name an issued npc_N carries, for writes that read names (object owners). */
 name?(ref:string):string|undefined;}

/** The rule barriers split the list: each segment is the actions up to and including one rule action. */
export function segments(ir:TurnIr):TurnIrAction[][] {
 const out:TurnIrAction[][]=[[]];
 for(const action of ir.actions){out[out.length-1].push(action);if(action.op==='rule')out.push([]);}
 return out.filter(segment=>segment.length);
}
/** Drop the conditioned actions whose check came out the other way; a condition on a check not yet rolled is an error. */
export function applyConditions(actions:TurnIrAction[],results:ReadonlyMap<string,boolean>,offset=0):{kept:TurnIrAction[];dropped:number[]} {
 const kept:TurnIrAction[]=[],dropped:number[]=[];
 actions.forEach((action,i)=>{
  const condition=(action as Row).when;
  if(!condition)return kept.push(action);
  if(!results.has(condition.check))throw new TurnIrError(offset+i,`when names ${JSON.stringify(condition.check)}, which no earlier rule action rolled`,{field:'when.check'});
  if(results.get(condition.check)===condition.passed)kept.push(action);else dropped.push(offset+i);
 });
 return {kept,dropped};
}
export function ruleAction(action:Extract<TurnIrAction,{op:'rule'}>,bind:(name:string)=>string):Row {
 return {intent:action.intent??'investigate',...(action.decision?{decision:action.decision}:{}),goal:action.goal,method:action.method??action.goal,...(action.skill?{skill:action.skill}:{}),stakes:action.stakes,
  ...(action.actor?{actor:bind(action.actor)}:{}),...(action.target?{target:bind(action.target)}:{}),
  ...(action.difficulty&&action.difficulty!=='regular'?{modifiers:{difficulty:action.difficulty}}:{})};
}

/**
 * One segment's state actions and speech as a v4 packet. `aliases` carries the @aliases introduced so far across segments
 * (an alias keeps its slot once written); `material` commands ride in the route's order as `_object` effects.
 */
export function toPacket(actions:TurnIrAction[],directory:TurnIrDirectory,aliases:Map<string,string>,offset=0):Row {
 const commands:Row[]=[],interactions:Row[]=[],reveal:Row[]=[],investigators=new Map<string,string>();
 // An object write names an investigator by name (the kernel reads names and npc_N refs there, not investigator_N).
 const holderName=(ref:string)=>investigators.get(ref)??(isNpcReference(ref)?directory.name?.(ref):undefined)??ref;
 const person=(name:string,i:number,field:string,options:{newcomer?:boolean}={}):string=>{
  if(aliases.has(name))return aliases.get(name)!;
  if(name.startsWith('@'))throw new TurnIrError(i,`${field} ${JSON.stringify(name)} is an @alias no earlier presence enter introduced`,{field});
  if(isNpcReference(name))return name;
  const bound=directory.person(name);
  if(bound&&'ref' in bound)return bound.ref;
  if(bound&&'investigator' in bound){investigators.set(bound.investigator,bound.name);return bound.investigator;}
  if(bound&&'ambiguous' in bound)throw new TurnIrError(i,`${field} ${JSON.stringify(name)} names more than one person; write one of details.candidates`,{field,candidates:bound.ambiguous});
  if(options.newcomer)return '';
  throw new TurnIrError(i,`${field} ${JSON.stringify(name)} is nobody at this table; bring them in with presence enter first (phone or letter needs their issued name)`,{field});
 };
 const slots=()=>[...aliases.values()].filter(value=>/^new_[1-4]$/.test(value)).length;
 actions.forEach((action,j)=>{
  const i=offset+j;
  switch(action.op){
   case 'move':{
    const company=(action.actors??[]).map(name=>person(name,i,'actors')).filter(ref=>!/^investigator_/.test(ref));
    commands.push({kind:'place',action:'move',to:action.to,...(action.via?{via:action.via}:{}),...(action.band?{travel_band:action.band}:{}),
     ...(action.inside?{additions:[{name:action.to,within:action.inside}]}:{}),...(company.length?{with:company}:{}),
     ...(action.spot?{spot:action.spot}:{}),...(action.relation?{relation:action.relation}:{})});
    break;
   }
   case 'presence':{
    if(action.action==='leave'){
     const actor=person(action.who,i,'who'),seated=commands.find(row=>row.kind==='walk_on'&&row.slot===actor);
     // Someone who came in earlier in this same segment has no ref yet: their arrival takes them on to where they go.
     if(seated){seated.to=action.at??'away';break;}
     commands.push({kind:'npc',actor,to:action.at??'away',reason:action.reason});break;
    }
    const known=action.who.startsWith('@')?'':person(action.who,i,'who',{newcomer:true});
    if(known&&!/^investigator_/.test(known)){commands.push({kind:'npc',actor:known,to:action.at??'here',reason:action.reason});break;}
    if(known)throw new TurnIrError(i,'an investigator does not enter by presence; use move',{field:'who'});
    if(slots()>=4)throw new TurnIrError(i,'at most four new people enter in one turn',{field:'who'});
    const slot=`new_${slots()+1}`;
    // §267.2: a name the book prints seats that person; any other is a newcomer under their public appellation.
    const label=action.who.startsWith('@')?(action.as??action.who.slice(1)):action.who;
    aliases.set(action.who,slot);
    commands.push({kind:'walk_on',slot,label,...(action.at?{to:action.at}:{}),reason:action.reason});
    break;
   }
   case 'communicate':{
    const actor=person(action.speaker,i,'speaker');
    // An investigator's own words are the player's; the author renders them from the input, so nothing is recorded here.
    if(/^investigator_/.test(actor))break;
    const to=action.to.map(name=>person(name,i,'to'));
    if(action.act==='silent'){interactions.push({actor,act:'silent',to,...(action.beat?{beat:action.beat}:{})});break;}
    const content=(action.says??[]).map(item=>typeof item==='string'
     ?{[item.startsWith('fact_')?'fact_ref':item.startsWith('source_')?'source_ref':'exhibit_ref']:item}
     :'claim' in item?{new:{predicate:'meaning',meaning:item.claim}}
     // The topic is what the investigator just asked about: the packet's topic slot takes only issued entity references,
     // which the Keeper cannot tell apart from its fact and source numbers (live 1025i Digging T1, refused twice).
     :'knowledge' in item?{new:{predicate:'knowledge_status',topic:ASKED_TOPIC,status:item.knowledge}}:{new:item.new});
    if(!content.length&&!['greet','refuse','acknowledge'].includes(action.act))
     throw new TurnIrError(i,`${action.act} says something: give says (a reference, a claim or knowledge)`,{field:'says'});
    // The v4 interaction carries at most eight items; a longer answer is the same act in consecutive interactions.
    const extras={...(action.channel&&action.channel!=='in_person'?{channel:action.channel}:{}),...(action.delivery?{delivery:action.delivery}:{})};
    for(let at=0;at===0||at<content.length;at+=8)
     interactions.push({actor,to,act:action.act,...(content.length?{content:content.slice(at,at+8)}:{}),...extras,...(at===0&&action.beat?{beat:action.beat}:{})});
    break;
   }
   case 'perceive':
    for(const item of action.what){
     if(typeof item==='string')reveal.push({[item.startsWith('fact_')?'fact_ref':item.startsWith('source_')?'source_ref':'exhibit_ref']:item});
     else if('clue' in item)commands.push({kind:'clue',clue:item.clue,how:item.how,...(item.summary?{summary:item.summary}:{}),
      ...(item.from?{from:person(item.from,i,'what.from')}:{})});
     else commands.push({kind:'place',action:'observe',facts:[item.observe]});
    }
    break;
   case 'material':{
    const holder=holderName(person(action.holder,i,'holder')),reader=action.to?holderName(person(action.to,i,'to')):undefined;
    const effect:Row|undefined=action.action==='transfer'
     ?{kind:'object',name:action.item,from:holder,to:reader??(()=>{throw new TurnIrError(i,'transfer names to',{field:'to'});})(),handover:'given',why:action.reason}
     :action.action==='take'?{kind:'object',name:action.item,from:holder,to:reader??holder,why:action.reason}
     // A thing held up to be seen, not read, changes nothing: the author tells it from the action.
     :action.action==='show'&&!action.access?undefined
     :action.action==='show'?{kind:'object',name:action.item,from:holder,to:holder,
      document:action.access==='glimpse'?{action:'observe',access:'glimpse',reader:reader??(()=>{throw new TurnIrError(i,'show names to',{field:'to'});})(),quote:action.quote??''}
       :{action:'show',reader:reader??(()=>{throw new TurnIrError(i,'show names to',{field:'to'});})(),...(action.access==='read_full'?{read:true}:{})},why:action.reason}
     :{kind:'object',name:action.item,from:holder,to:holder,document:{action:action.action},why:action.reason};
    if(effect)commands.push({kind:'_object',effect});
    break;
   }
   case 'time':
    commands.push({kind:'time',...(action.minutes?{minutes:action.minutes}:action.until?{until:{time:action.until}}:{band:action.band}),reason:action.reason});
    break;
   case 'relationship':{
    const fields=Object.fromEntries(['disposition','trust','fear','pressure','control'].filter(key=>(action as Row)[key]!==undefined).map(key=>[key,(action as Row)[key]]));
    if(!Object.keys(fields).length)throw new TurnIrError(i,'a relationship action changes at least one field',{field:'disposition'});
    if(!('disposition' in fields)&&!('control' in fields))throw new TurnIrError(i,'a relationship change names the disposition after it (or a control)',{field:'disposition'});
    const actor=person(action.who,i,'who');
    // An investigator's own attitude is the player's to play; only a person's relationship is recorded.
    if(/^investigator_/.test(actor))break;
    commands.push({kind:'relationship',actor,toward:person(action.toward,i,'toward'),...fields});
    break;
   }
   case 'mood':commands.push({kind:'mood',actor:person(action.who,i,'who'),mood:action.mood});break;
   case 'learn_alias':commands.push({kind:'name',actor:person(action.who,i,'who'),name:action.alias});break;
   case 'scene':commands.push({kind:'scene',service:action.service,crowd:action.crowd});break;
   case 'rule':break;
  }
 });
 return {version:4,...(commands.length?{commands}:{}),...(interactions.length?{interactions}:{}),...(reveal.length?{reveal}:{})};
}
