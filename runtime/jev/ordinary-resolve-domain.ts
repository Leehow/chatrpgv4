/** Bounded ordinary-check policy. All executable arguments are bound from actual kernel options. */
import {isPlainRecord,type DecisionBatch,type DecisionQuestion,type DecisionDescriptor,type DecisionResult,type Json} from './contracts.ts';
import type {TaskDomain,TaskStep,TaskView} from './task-runtime.ts';
import {JEV_MODEL,packDecisionBatch} from './question-packing.ts';
import {withAttemptKeys,mutationOutcome} from './domain-attempt.ts';
import {clears} from './decision-gate.ts';

export const ORDINARY_RESOLVE_VERSION='2';
export type OrdinaryDisposition='ordinary'|'no_roll'|'incumbent'|'needs_player'|'unknown';
/** `held` (§135.28.1, SL-40): the sheet lists the skill, or it is a characteristic; `false` for a catalog skill at its base chance. */
export type OrdinaryProfile={alias:string;actor:string;skill:string;availability:'bound'|'unknown';value:number|null;held?:boolean};
export type OrdinaryDecision={name:string;family:string;description:string|null;capability:string|null};
export type OrdinaryResolveOptions={version:1;profiles:OrdinaryProfile[];decisions:OrdinaryDecision[];revision:string;world_revision:string;context:Record<string,Json>};
/**
 * How the single-loop binder took one of its defaulted parameters (contract §135.28, SL-31): Jev's answer when it cleared
 * the gates (`jev`), else the rules default (`rule-default`, with the rule), each with the answer's confidence and distribution.
 */
export type OrdinaryParameterPath={path:'jev'|'rule-default';value:string;rule?:string;confidence:number|null;distribution:Record<string,number>|null};
export type OrdinaryRouteChoice={disposition:OrdinaryDisposition;actor?:string;intent?:'investigate'|'social'|'move';difficulty?:'regular'|'hard'|'extreme';bonus?:'none'|'one'|'two';penalty?:'none'|'one'|'two';needs:string[];
  /** SL-31: the defaulted parameters (`difficulty`, `bonus`, `penalty`) as the binder took them; only with `defaults`. */
  paths?:Record<string,OrdinaryParameterPath>};
/**
 * The ordinary binder's rules defaults (contract §135.28, SL-31; the spec's ruling "The ordinary check's difficulty and dice
 * have rules defaults"): a regular difficulty (the ordinary-check row states none; a book's stated difficulty reaches the
 * check through the kernel's obligation fold, §134.17) and no dice modifier. Jev's cleared answer overrides each.
 */
export const ORDINARY_RULE_DEFAULTS={difficulty:{value:'regular',rule:'regular_difficulty'},bonus:{value:'none',rule:'no_modifier'},penalty:{value:'none',rule:'no_modifier'}} as const;
export type OrdinaryActionTemplate={actor:string;intent:'investigate'|'social'|'move';goal:string;method:string;skill:string;decision:'core-check:ordinary-check';modifiers:{difficulty:'regular'|'hard'|'extreme';bonus_dice:number;penalty_dice:number;reason:string}};

const finish=(status:'complete'|'partial'|'unresolved'|'needs_player',needs:string[]=[]):TaskStep=>({kind:'finish',status,remainingNeeds:needs});
const choice=(key:string,instructions:string,criteria:Record<string,DecisionDescriptor>):DecisionQuestion=>({key,target:key,type:'choice',instructions,criteria});
const answer=(result:DecisionResult|undefined,key:string):string|undefined=>{const value=result?.answers[key];return value?.status==='answered'&&value.type==='choice'?value.choice:undefined;};

/**
 * The ordinary binder's closed intent and dice-modifier questions, shared with the obligation check's closed binder
 * (contract §135.26), so the two binders cannot ask the same choice in two wordings.
 */
export const ORDINARY_CHOICES={
  intent:{instructions:'Bind the existing canonical intent to the declared ordinary action. Do not reinterpret its family to make it executable.',
    criteria:{investigate:'An investigative, observational or technical action.',social:'An interpersonal action.',move:'An uncertain movement action or obstacle.',unknown:'No ordinary-capable intent fits the declaration.'}},
  bonus:{instructions:'Select bonus dice supported by the declared method and established circumstances. Do not invent assistance or equipment.',
    criteria:{none:'No established bonus.',one:'One supported advantage die.',two:'Two supported advantage dice.',unknown:'The modifier cannot be determined.'}},
  penalty:{instructions:'Select penalty dice supported by established circumstances, independently of difficulty.',
    criteria:{none:'No established penalty.',one:'One supported penalty die.',two:'Two supported penalty dice.',unknown:'The modifier cannot be determined.'}},
} as const;

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
      choice('intent',ORDINARY_CHOICES.intent.instructions,ORDINARY_CHOICES.intent.criteria),
      choice('difficulty','Judge the ordinary check difficulty from established circumstances, without inventing adversity or modifiers.',
        {regular:'An ordinary uncertain attempt.',hard:'Established circumstances require a hard success.',extreme:'Established circumstances require an extreme success.',unknown:'The difficulty needs missing information.'}),
      choice('bonus',ORDINARY_CHOICES.bonus.instructions,ORDINARY_CHOICES.bonus.criteria),
      choice('penalty',ORDINARY_CHOICES.penalty.instructions,ORDINARY_CHOICES.penalty.criteria),
    ]};
}

/**
 * `compiled` (contract §135.30.3): the check the compile selected, with the act it read. The compile's cleared act settled
 * that the declared action is rolled (owner ruling 2026-09-24), so the route answer `no_roll` does not end the binding here
 * (the caller decides with the skill's answer), and it settled the intent, so the binder's intent answer does not decide
 * either. A single actor the kernel issues is stated (§135.28), whatever the actor question answered.
 *
 * `defaults` (contract §135.28, SL-31): the single-loop clerk's binder. The difficulty and the two dice take Jev's answer only
 * when it clears the gates (`gate`, the policy's), else their rules default (`ORDINARY_RULE_DEFAULTS`), and the single
 * investigator the kernel issues is the actor whatever the actor question answered. Without it (the legacy prescreen's
 * advice, the task domain) every answer is taken as given and an `unknown` leaves the check unbound, as before.
 */
export function interpretOrdinaryRoute(options:OrdinaryResolveOptions,result:DecisionResult|undefined,compiled?:{intent:'investigate'|'social'},defaults?:{gate:number}):OrdinaryRouteChoice {
  const rollSettled=compiled!==undefined;
  if(options.context.pending_choice)return{disposition:'needs_player',needs:['The existing pending mechanical choice must be resolved by its owner.']};
  if(options.context.session)return{disposition:'incumbent',needs:['The active subsystem requires its existing resolution owner.']};
  if(result?.status!=='complete')return{disposition:'unknown',needs:['The ordinary rule decision is unavailable.']};
  const route=answer(result,'route'),consent=answer(result,'consent');
  if(route==='no_roll'&&!rollSettled)return{disposition:'no_roll',needs:[]};
  if(route==='needs_player'||consent==='unselected')return{disposition:'needs_player',needs:['The player has not authorized this consequential action.']};
  if(route==='incumbent')return{disposition:'incumbent',needs:['Use the existing resolution owner for this specialized rule family.']};
  if((route!=='ordinary'&&!(rollSettled&&route==='no_roll'))||consent!=='authorized')return{disposition:'unknown',needs:[consent==='unknown'?'Action authorization remains unknown.':'The required ordinary rule family remains unresolved.']};
  const actors=[...new Set(options.profiles.map(value=>value.actor))],actorChoice=answer(result,'actor'),
    actor=(compiled||defaults)&&actors.length===1?actors[0]:actors.find((_,index)=>actorChoice===`actor_${index}`),
    intent=compiled?compiled.intent:answer(result,'intent');
  const values={difficulty:['regular','hard','extreme'],bonus:['none','one','two'],penalty:['none','one','two']} as const,paths:Record<string,OrdinaryParameterPath>={};
  const taken=(key:keyof typeof values):string|undefined=>{
    const value=answer(result,key);if(!defaults)return value;
    const given=result?.answers[key],confidence=given?.status==='answered'&&given.type==='choice'&&typeof given.confidence==='number'?given.confidence:null,
      distribution=given?.status==='answered'&&given.type==='choice'?given.probabilities??null:null;
    if(value!==undefined&&(values[key] as readonly string[]).includes(value)&&clears(result,key,value,confidence??undefined,defaults.gate)){
      paths[key]={path:'jev',value,confidence,distribution};return value;
    }
    const fallback=ORDINARY_RULE_DEFAULTS[key];paths[key]={path:'rule-default',value:fallback.value,rule:fallback.rule,confidence,distribution};return fallback.value;
  };
  const difficulty=taken('difficulty'),bonus=taken('bonus'),penalty=taken('penalty');
  const unbound=[...(actor?[]:['actor']),...(['investigate','social','move'].includes(intent??'')?[]:['intent']),
    ...((values.difficulty as readonly string[]).includes(difficulty??'')?[]:['difficulty']),
    ...((values.bonus as readonly string[]).includes(bonus??'')?[]:['bonus']),...((values.penalty as readonly string[]).includes(penalty??'')?[]:['penalty'])];
  // SL-31: the clerk's binder names what it could not bind (the long gate's rows said only the generic line below).
  if(unbound.length)return{disposition:'unknown',needs:[defaults?`The ordinary check's ${unbound.join(', ')} ${unbound.length===1?'is':'are'} not bound.`:'An actor, difficulty or modifier is not bound.']};
  return{disposition:'ordinary',actor,intent:intent as OrdinaryRouteChoice['intent'],difficulty:difficulty as OrdinaryRouteChoice['difficulty'],
    bonus:bonus as OrdinaryRouteChoice['bonus'],penalty:penalty as OrdinaryRouteChoice['penalty'],needs:[],...(defaults?{paths}:{})};
}

/**
 * §135.28.1 (SL-40): the single-loop binder chooses among the skills the sheet holds. With `held` and an actor whose rows say
 * which the sheet holds (at least one held), the batch asks `profile` over the held rows only, for the declared act, and
 * `named` over the rows the sheet does not hold: the one the declaration names by name, or none. Aliases stay
 * `profile_<index>` over all of the actor's rows, so both answers read back the same way. Otherwise one question over
 * every row, as before.
 */
export function ordinaryProfileBatch(input:{rawInput:string;goal:string;options:OrdinaryResolveOptions;route:OrdinaryRouteChoice;held?:boolean}):Omit<DecisionBatch,'id'|'scope'|'readSet'>|undefined {
  if(input.route.disposition!=='ordinary'||!input.route.actor)return undefined;const available=input.options.profiles.filter(value=>value.actor===input.route.actor);
  const {_binding,...context}=input.options.context;
  const rows=(keep:(row:OrdinaryProfile)=>boolean)=>Object.fromEntries(available.flatMap((value,index)=>keep(value)?[[`profile_${index}`,{skill:value.skill,availability:value.availability}]]:[]));
  if(input.held&&heldMode(available)){
    return{model:JEV_MODEL,family:'ordinary-resolve',familyVersion:ORDINARY_RESOLVE_VERSION,
      state:{rawInput:input.rawInput,goal:input.goal,context:context as Json,actor:input.route.actor,...(input.route.intent?{act:input.route.intent}:{})},questions:[
        choice('profile','Select the single skill or characteristic on this investigator\'s sheet that implements the player-chosen method for the declared act. Choose by what the player does, never by its percentage. More than one genuinely different method still needs clarification.',
          {...rows(value=>value.held===true),unknown:'No skill or characteristic on the sheet implements the method, or it is ambiguous.'}),
        choice('named','Select the listed skill only when the player\'s declaration names that skill by name. These are skills the investigator does not hold. Choose none when the declaration names none of them.',
          {...rows(value=>value.held!==true),none:'The declaration names none of these skills by name.'}),
      ]};
  }
  return{model:JEV_MODEL,family:'ordinary-resolve',familyVersion:ORDINARY_RESOLVE_VERSION,state:{rawInput:input.rawInput,goal:input.goal,context:context as Json,actor:input.route.actor},questions:[
    choice('profile','Select the single skill or characteristic that implements the player-chosen method. Do not substitute a similar skill for a missing required skill, choose by its percentage, or treat a missing binding as zero. More than one genuinely different method still needs clarification.',
      {...rows(()=>true),unknown:'The required skill or method is unavailable or ambiguous.'})]};
}
/** §135.28.1: the actor's rows say which the sheet holds, and it holds at least one. */
const heldMode=(rows:OrdinaryProfile[]):boolean=>rows.some(row=>row.held===true)&&rows.every(row=>typeof row.held==='boolean');

/**
 * The profile the binder takes. `held` (§135.28.1, SL-40; the single-loop binder, with the policy's gate): a `named` answer
 * that clears the gates on a row the sheet does not hold is taken -- the declaration names that skill; otherwise the
 * `profile` answer, which offers only held rows. `from` says which answer it was.
 */
export function pickOrdinaryProfile(options:OrdinaryResolveOptions,route:OrdinaryRouteChoice,result:DecisionResult|undefined,held?:{gate:number}):{profile?:OrdinaryProfile;from:'profile'|'named'} {
  if(route.disposition!=='ordinary'||!route.actor||result?.status!=='complete')return{from:'profile'};
  const available=options.profiles.filter(value=>value.actor===route.actor),at=(key:string)=>{const selected=answer(result,key);return available.find((_,index)=>selected===`profile_${index}`);};
  if(held&&heldMode(available)){
    const named=at('named'),given=result.answers.named,confidence=given?.status==='answered'&&given.type==='choice'&&typeof given.confidence==='number'?given.confidence:undefined;
    if(named&&named.held!==true&&given?.status==='answered'&&given.type==='choice'&&clears(result,'named',given.choice,confidence,held.gate))return{profile:named,from:'named'};
    const profile=at('profile');
    return{...(profile&&profile.held===true?{profile}:{}),from:'profile'};
  }
  const profile=at('profile');return{...(profile?{profile}:{}),from:'profile'};
}
export function selectOrdinaryProfile(options:OrdinaryResolveOptions,route:OrdinaryRouteChoice,result:DecisionResult|undefined,held?:{gate:number}):OrdinaryProfile|undefined {
  return pickOrdinaryProfile(options,route,result,held).profile;
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
