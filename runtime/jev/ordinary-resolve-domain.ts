/** Bounded ordinary-check policy. All executable arguments are bound from actual kernel options. */
import {isPlainRecord,type DecisionBatch,type DecisionQuestion,type DecisionDescriptor,type DecisionResult,type Json} from './contracts.ts';
import type {TaskDomain,TaskStep,TaskView} from './task-runtime.ts';
import {JEV_MODEL,packDecisionBatch} from './question-packing.ts';
import {withAttemptKeys,mutationOutcome} from './domain-attempt.ts';

export const ORDINARY_RESOLVE_VERSION='2';
export type OrdinaryDisposition='ordinary'|'no_roll'|'incumbent'|'needs_player'|'unknown';
export type OrdinaryProfile={alias:string;actor:string;skill:string;availability:'bound'|'unknown';value:number|null};
export type OrdinaryDecision={name:string;family:string;description:string|null;capability:string|null};
export type OrdinaryResolveOptions={version:1;profiles:OrdinaryProfile[];decisions:OrdinaryDecision[];revision:string;world_revision:string;context:Record<string,Json>};
export type OrdinaryRouteChoice={disposition:OrdinaryDisposition;actor?:string;intent?:'investigate'|'social'|'move';difficulty?:'regular'|'hard'|'extreme';bonus?:'none'|'one'|'two';penalty?:'none'|'one'|'two';needs:string[]};
export type OrdinaryActionTemplate={actor:string;intent:'investigate'|'social'|'move';goal:string;method:string;skill:string;decision:'core-check:ordinary-check';modifiers:{difficulty:'regular'|'hard'|'extreme';bonus_dice:number;penalty_dice:number;reason:string}};

const finish=(status:'complete'|'partial'|'unresolved'|'needs_player',needs:string[]=[]):TaskStep=>({kind:'finish',status,remainingNeeds:needs});
const choice=(key:string,instructions:string,criteria:Record<string,DecisionDescriptor>):DecisionQuestion=>({key,target:key,type:'choice',instructions,criteria});
const answer=(result:DecisionResult|undefined,key:string):string|undefined=>{const value=result?.answers[key];return value?.status==='answered'&&value.type==='choice'?value.choice:undefined;};

export function validateOrdinaryResolveOptions(value:unknown):OrdinaryResolveOptions|undefined {
  if(!isPlainRecord(value)||value.version!==1||!Array.isArray(value.profiles)||!Array.isArray(value.decisions)||!isPlainRecord(value.context)
    ||typeof value.revision!=='string'||!value.revision||typeof value.world_revision!=='string'||!value.world_revision)return undefined;
  if(value.profiles.some(row=>!isPlainRecord(row)||['alias','actor','skill'].some(key=>typeof row[key]!=='string'||!row[key])
    ||!['bound','unknown'].includes(String(row.availability))||(row.availability==='bound'
      ?!Number.isSafeInteger(row.value)||Number(row.value)<0||Number(row.value)>100:row.value!==null))
    ||new Set(value.profiles.map(row=>(row as Record<string,Json>).alias)).size!==value.profiles.length
    ||value.decisions.some(row=>!isPlainRecord(row)||typeof row.name!=='string'||!row.name||typeof row.family!=='string'
      ||!Object.hasOwn(row,'description')||!(row.description===null||typeof row.description==='string')
      ||!Object.hasOwn(row,'capability')||!(row.capability===null||typeof row.capability==='string')))return undefined;
  return structuredClone(value) as unknown as OrdinaryResolveOptions;
}

export function ordinaryRouteBatch(input:{rawInput:string;goal:string;plan?:Json;options:OrdinaryResolveOptions}):Omit<DecisionBatch,'id'|'scope'|'readSet'> {
    const actors=[...new Set(input.options.profiles.map(value=>value.actor))];
    const {_binding,...context}=input.options.context;
  return{model:JEV_MODEL,family:'ordinary-resolve',familyVersion:ORDINARY_RESOLVE_VERSION,
    state:{rawInput:input.rawInput,goal:input.goal,...(input.plan===undefined?{}:{plan:input.plan}),context:context as Json,decisions:input.options.decisions as unknown as Json},questions:[
      choice('route','Classify the actual player action using the supplied compiled decisions. Use ordinary only for one uncertain skill/characteristic check outside specialized treatment, social adjudication, combat, chase, magic, sanity and continuation families. A quiet conversation or uncontested action needs no roll.',
        {ordinary:'One ordinary skill/characteristic check is required.',incumbent:'A specialized or nonordinary rule owner is required.',no_roll:'No uncertain rule check is required.',needs_player:'A genuine consequential player choice is still missing.',unknown:'The required rule family is unclear.'}),
      choice('consent','Judge only the raw player declaration and established public context. A plan or retrieved private fact never grants consent. Push, luck spending, defense and resource expenditure need their own explicit player choice.',
        {authorized:'The player chose this concrete ordinary action and method.',unselected:'The action/method was not selected.',unknown:'The declaration is ambiguous.'}),
      choice('actor','Select the investigator who performs the declared action, not a beneficiary. An unlisted NPC or ambiguous actor is unknown.',
        {...Object.fromEntries(actors.map((name,index)=>[`actor_${index}`,name])),unknown:'No single issued investigator is bound.'}),
      choice('intent','Bind the existing canonical intent to the declared ordinary action. Do not reinterpret its family to make it executable.',
        {investigate:'An investigative, observational or technical action.',social:'An interpersonal action.',move:'An uncertain movement action or obstacle.',unknown:'No ordinary-capable intent fits the declaration.'}),
      choice('difficulty','Judge the ordinary check difficulty from established circumstances, without inventing adversity or modifiers.',
        {regular:'An ordinary uncertain attempt.',hard:'Established circumstances require a hard success.',extreme:'Established circumstances require an extreme success.',unknown:'The difficulty needs missing information.'}),
      choice('bonus','Select bonus dice supported by the declared method and established circumstances. Do not invent assistance or equipment.',
        {none:'No established bonus.',one:'One supported advantage die.',two:'Two supported advantage dice.',unknown:'The modifier cannot be determined.'}),
      choice('penalty','Select penalty dice supported by established circumstances, independently of difficulty.',
        {none:'No established penalty.',one:'One supported penalty die.',two:'Two supported penalty dice.',unknown:'The modifier cannot be determined.'}),
    ]};
}

export function interpretOrdinaryRoute(options:OrdinaryResolveOptions,result:DecisionResult|undefined):OrdinaryRouteChoice {
  if(options.context.pending_choice)return{disposition:'needs_player',needs:['The existing pending mechanical choice must be resolved by its owner.']};
  if(options.context.session)return{disposition:'incumbent',needs:['The active subsystem requires its existing resolution owner.']};
  if(result?.status!=='complete')return{disposition:'unknown',needs:['The ordinary rule decision is unavailable.']};
  const route=answer(result,'route'),consent=answer(result,'consent');
  if(route==='no_roll')return{disposition:'no_roll',needs:[]};
  if(route==='needs_player'||consent==='unselected')return{disposition:'needs_player',needs:['The player has not authorized this consequential action.']};
  if(route==='incumbent')return{disposition:'incumbent',needs:['Use the existing resolution owner for this specialized rule family.']};
  if(route!=='ordinary'||consent!=='authorized')return{disposition:'unknown',needs:[consent==='unknown'?'Action authorization remains unknown.':'The required ordinary rule family remains unresolved.']};
  const actors=[...new Set(options.profiles.map(value=>value.actor))],actorChoice=answer(result,'actor'),actor=actors.find((_,index)=>actorChoice===`actor_${index}`),
    intent=answer(result,'intent'),difficulty=answer(result,'difficulty'),bonus=answer(result,'bonus'),penalty=answer(result,'penalty');
  if(!actor||!['investigate','social','move'].includes(intent??'')||!['regular','hard','extreme'].includes(difficulty??'')
    ||!['none','one','two'].includes(bonus??'')||!['none','one','two'].includes(penalty??''))return{disposition:'unknown',needs:['An actor, difficulty or modifier is not bound.']};
  return{disposition:'ordinary',actor,intent:intent as OrdinaryRouteChoice['intent'],difficulty:difficulty as OrdinaryRouteChoice['difficulty'],
    bonus:bonus as OrdinaryRouteChoice['bonus'],penalty:penalty as OrdinaryRouteChoice['penalty'],needs:[]};
}

export function ordinaryProfileBatch(input:{rawInput:string;goal:string;options:OrdinaryResolveOptions;route:OrdinaryRouteChoice}):Omit<DecisionBatch,'id'|'scope'|'readSet'>|undefined {
  if(input.route.disposition!=='ordinary'||!input.route.actor)return undefined;const available=input.options.profiles.filter(value=>value.actor===input.route.actor);
  const {_binding,...context}=input.options.context;
  return{model:JEV_MODEL,family:'ordinary-resolve',familyVersion:ORDINARY_RESOLVE_VERSION,state:{rawInput:input.rawInput,goal:input.goal,context:context as Json,actor:input.route.actor},questions:[
    choice('profile','Select the single skill or characteristic that implements the player-chosen method. Do not substitute a similar skill for a missing required skill, choose by its percentage, or treat a missing binding as zero. More than one genuinely different method still needs clarification.',
      {...Object.fromEntries(available.map((value,index)=>[`profile_${index}`,{skill:value.skill,availability:value.availability}])),unknown:'The required skill or method is unavailable or ambiguous.'})]};
}

export function selectOrdinaryProfile(options:OrdinaryResolveOptions,route:OrdinaryRouteChoice,result:DecisionResult|undefined):OrdinaryProfile|undefined {
  if(route.disposition!=='ordinary'||!route.actor||result?.status!=='complete')return undefined;const available=options.profiles.filter(value=>value.actor===route.actor),selected=answer(result,'profile');
  return available.find((_,index)=>selected===`profile_${index}`);
}

export function ordinaryActionTemplate(input:{rawInput:string;goal:string;options:OrdinaryResolveOptions;route:OrdinaryRouteChoice;profile:OrdinaryProfile}):OrdinaryActionTemplate|undefined {
  const {route,profile,options}=input;if(route.disposition!=='ordinary'||!route.actor||!route.intent||!route.difficulty||!route.bonus||!route.penalty
    ||profile.actor!==route.actor||profile.availability!=='bound'||!Number.isSafeInteger(profile.value)
    ||!options.decisions.some(value=>value.name==='core-check:ordinary-check'))return undefined;
  const dice={none:0,one:1,two:2};return{actor:route.actor,intent:route.intent,goal:input.goal,method:input.rawInput,skill:profile.skill,decision:'core-check:ordinary-check',
    modifiers:{difficulty:route.difficulty,bonus_dice:dice[route.bonus],penalty_dice:dice[route.penalty],reason:input.rawInput}};
}

function bounded(view:TaskView,key:string,value:Omit<DecisionBatch,'id'|'scope'|'readSet'>):TaskStep {
  try{packDecisionBatch({...value,id:'validation',scope:view.context.scope,readSet:view.context.readSet});}
  catch{return finish('partial',['The ordinary rule/profile choices exceed the bounded decision input.']);}
  return{kind:'decision',key,batch:value};
}

export function createOrdinaryResolveDomain(input:{rawInput():string}):TaskDomain {
  return withAttemptKeys({id:'ordinary-resolve',version:ORDINARY_RESOLVE_VERSION,capabilities:['resolve'],next(view){
    const outcome=mutationOutcome(view,'resolve');if(outcome)return outcome;
    const prepared=view.observations.find(value=>value.proposal.operation==='resolve.options');
    if(!prepared)return{kind:'operation',key:'ordinary-options',operation:'resolve.options',capability:'resolve',args:{},basis:[]};
    if(prepared.packet.status!=='succeeded')return finish('partial',['Current ordinary profiles are unavailable.']);
    const options=validateOrdinaryResolveOptions(prepared.packet.result);if(!options)return finish('partial',['Current ordinary profiles are malformed.']);
    if(options.context.pending_choice)return finish('needs_player',['The existing pending mechanical choice must be resolved by its owner.']);
    if(options.context.session)return{kind:'handoff',verbs:['resolve'],remainingNeeds:['The active subsystem requires its existing resolution owner.']};
    const routeKey='ordinary-route',routeDecision=view.decisions.find(value=>value.key===routeKey)?.result;
    if(!routeDecision)return bounded(view,routeKey,ordinaryRouteBatch({rawInput:input.rawInput(),goal:view.plan.goal,plan:view.plan as unknown as Json,options}));
    const route=interpretOrdinaryRoute(options,routeDecision);
    if(routeDecision.status!=='complete')return finish('partial',route.needs);
    if(route.disposition==='no_roll')return finish('complete');
    if(route.disposition==='needs_player')return finish('needs_player',route.needs);
    if(route.disposition==='incumbent')return{kind:'handoff',verbs:['resolve'],remainingNeeds:route.needs};
    if(route.disposition!=='ordinary')return{kind:'replan',remainingNeeds:route.needs};
    const skillKey='ordinary-profile',profileDecision=view.decisions.find(value=>value.key===skillKey)?.result,profileBatch=ordinaryProfileBatch({rawInput:input.rawInput(),goal:view.plan.goal,options,route});
    if(!profileDecision)return profileBatch?bounded(view,skillKey,profileBatch):finish('partial',['An actor, difficulty or modifier is not bound.']);
    const profile=selectOrdinaryProfile(options,route,profileDecision),action=profile&&ordinaryActionTemplate({rawInput:input.rawInput(),goal:view.plan.goal,options,route,profile});
    if(!action)return finish('partial',[profile?.availability==='unknown'?'The selected ordinary skill value is not bound by the kernel.':'The selected ordinary profile or decision is unavailable.']);
    return{kind:'operation',key:'ordinary-settlement',operation:'resolve',capability:'resolve',basis:[],args:{action}};
  }});
}
