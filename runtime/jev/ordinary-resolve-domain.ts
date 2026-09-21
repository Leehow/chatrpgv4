/** Bounded ordinary-check policy. All executable arguments are bound from actual kernel options. */
import {isPlainRecord, type DecisionBatch, type DecisionQuestion, type DecisionDescriptor, type Json} from './contracts.ts';
import type {TaskDomain, TaskStep, TaskView} from './task-runtime.ts';
import {JEV_MODEL, packDecisionBatch} from './question-packing.ts';
import {withAttemptKeys, mutationOutcome} from './domain-attempt.ts';

export const ORDINARY_RESOLVE_VERSION = '2';
const finish = (status: 'complete'|'partial'|'unresolved'|'needs_player', needs: string[] = []): TaskStep => ({kind:'finish', status, remainingNeeds:needs});
const choose = (view: TaskView, key: string, question: string): string | undefined => {
  const answer = view.decisions.find(value => value.key === key)?.result.answers[question];
  return answer?.status === 'answered' && answer.type === 'choice' ? answer.choice : undefined;
};
const choice = (key: string, instructions: string, criteria: Record<string, DecisionDescriptor>): DecisionQuestion => ({key,target:key,type:'choice',instructions,criteria});
function batch(view: TaskView, key: string, state: Json, questions: DecisionQuestion[]): TaskStep {
  const value: Omit<DecisionBatch,'id'|'scope'|'readSet'> = {model:JEV_MODEL,family:'ordinary-resolve',familyVersion:ORDINARY_RESOLVE_VERSION,state,questions};
  try {packDecisionBatch({...value,id:'validation',scope:view.context.scope,readSet:view.context.readSet});}
  catch {return finish('partial',['The ordinary rule/profile choices exceed the bounded decision input.']);}
  return {kind:'decision',key,batch:value};
}
export function createOrdinaryResolveDomain(input: {rawInput(): string}): TaskDomain {
  return withAttemptKeys({id:'ordinary-resolve',version:ORDINARY_RESOLVE_VERSION,capabilities:['resolve'],next(view) {
    const outcome = mutationOutcome(view, 'resolve');
    if (outcome) return outcome;
    const prepared = view.observations.find(value => value.proposal.operation === 'resolve.options');
    if (!prepared) return {kind:'operation',key:'ordinary-options',operation:'resolve.options',capability:'resolve',args:{},basis:[]};
    if (prepared.packet.status !== 'succeeded' || !isPlainRecord(prepared.packet.result)) return finish('partial',['Current ordinary profiles are unavailable.']);
    const source = prepared.packet.result;
    if (!Array.isArray(source.profiles) || !Array.isArray(source.decisions) || !isPlainRecord(source.context)) return finish('partial',['Current ordinary profiles are malformed.']);
    if (source.profiles.some(value=>!isPlainRecord(value) || ['alias','actor','skill'].some(key=>typeof value[key] !== 'string' || !value[key])
      || !['bound','unknown'].includes(String(value.availability)) || (value.availability === 'bound'
        ? !Number.isSafeInteger(value.value) || Number(value.value)<0 || Number(value.value)>100 : value.value!==null))
      || new Set(source.profiles.map(value=>(value as Record<string,Json>).alias)).size !== source.profiles.length
      || source.decisions.some(value=>!isPlainRecord(value) || typeof value.name!=='string' || !value.name || typeof value.family!=='string'
        || !Object.hasOwn(value,'description') || !(value.description===null || typeof value.description==='string')
        || !Object.hasOwn(value,'capability') || !(value.capability===null || typeof value.capability==='string')))
      return finish('partial',['Current ordinary profiles are malformed.']);
    if (source.context.pending_choice) return finish('needs_player',['The existing pending mechanical choice must be resolved by its owner.']);
    if (source.context.session) return {kind:'handoff',verbs:['resolve'],remainingNeeds:['The active subsystem requires its existing resolution owner.']};
    const profiles = source.profiles.filter((value): value is Record<string, Json> => isPlainRecord(value)), actors = [...new Set(profiles.map(value => String(value.actor)))];
    const routeKey = 'ordinary-route';
    if (!view.decisions.some(value => value.key === routeKey)) return batch(view,routeKey,
      {rawInput:input.rawInput(),plan:view.plan as unknown as Json,context:source.context as Json,decisions:source.decisions as Json},[
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
    ]);
    const route = choose(view,routeKey,'route');
    if (route === 'no_roll') return finish('complete');
    if (route === 'needs_player' || choose(view,routeKey,'consent') === 'unselected') return finish('needs_player',['The player has not authorized this consequential action.']);
    if (route === 'incumbent') return {kind:'handoff',verbs:['resolve'],remainingNeeds:['Use the existing resolution owner for this specialized rule family.']};
    if (route === undefined) return finish('partial',['The ordinary rule decision is unavailable.']);
    if (route !== 'ordinary') return {kind:'replan',remainingNeeds:['Clarify the same declared method or retrieve missing rule evidence; its rule family is unresolved.']};
    if (choose(view,routeKey,'consent') !== 'authorized') return finish('partial',['Action authorization remains unknown.']);
    const actorChoice = choose(view,routeKey,'actor'), actor = actors.find((_,i)=>actorChoice===`actor_${i}`);
    const intent = choose(view,routeKey,'intent');
    const difficulty = choose(view,routeKey,'difficulty'), bonus = choose(view,routeKey,'bonus'), penalty = choose(view,routeKey,'penalty');
    if (!actor || !['investigate','social','move'].includes(intent??'') || !['regular','hard','extreme'].includes(difficulty??'') || !['none','one','two'].includes(bonus??'') || !['none','one','two'].includes(penalty??''))
      return finish('partial',['An actor, difficulty or modifier is not bound.']);
    const available = profiles.filter(value=>value.actor===actor), skillKey='ordinary-profile';
    if (!view.decisions.some(value=>value.key===skillKey)) return batch(view,skillKey,
      {rawInput:input.rawInput(),goal:view.plan.goal,context:source.context as Json,actor},[
      choice('profile','Select the single skill or characteristic that implements the player-chosen method. Do not substitute a similar skill for a missing required skill, choose by its percentage, or treat a missing binding as zero. More than one genuinely different method still needs clarification.',
        {...Object.fromEntries(available.map((value,i)=>[`profile_${i}`,{skill:String(value.skill),availability:String(value.availability)}])),unknown:'The required skill or method is unavailable or ambiguous.'})]);
    const selected = available.find((_,i)=>choose(view,skillKey,'profile')===`profile_${i}`);
    if (!selected || selected.availability !== 'bound' || !Number.isSafeInteger(selected.value)) return finish('partial',['The selected ordinary skill value is not bound by the kernel.']);
    if (!source.decisions.some(value=>isPlainRecord(value)&&value.name==='core-check:ordinary-check')) return finish('partial',['The ordinary decision is absent from the compiled rules.']);
    const dice = {none:0,one:1,two:2};
    return {kind:'operation',key:'ordinary-settlement',operation:'resolve',capability:'resolve',basis:[],args:{action:{
      actor, intent:intent!, goal:view.plan.goal, method:input.rawInput(), skill:String(selected.skill), decision:'core-check:ordinary-check',
      modifiers:{difficulty:difficulty!,bonus_dice:dice[bonus as keyof typeof dice],penalty_dice:dice[penalty as keyof typeof dice],reason:input.rawInput()}}}};
  }});
}
