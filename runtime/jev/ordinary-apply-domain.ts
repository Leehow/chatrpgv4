/** Select host-issued ordinary effects and commit one fully checked canonical batch. */
import {isPlainRecord, type DecisionBatch, type DecisionQuestion, type Json} from './contracts.ts';
import type {TaskDomain, TaskStep, TaskView} from './task-runtime.ts';
import {JEV_MODEL, packDecisionBatch} from './question-packing.ts';
import {fulfillmentStep} from './fulfillment-domain.ts';
import {withAttemptKeys, mutationOutcome} from './domain-attempt.ts';

export const ORDINARY_APPLY_VERSION='4';
const OPERATION_CONTRACT={phase:'before_delivery',
  clue:'apply clue records acquisition of the named knowledge; it does not transfer cash, keys or other physical items. Its supported briefing is narrated after this atomic effect batch settles.',
  move:'apply move changes the persistent location.',
  source_gate:'Gate text is advisory metadata. A missing check entry neither demands nor waives a check; the supplied delivery kind and authored content remain the evidence.',
  batch:'All selected effects pass the existing independent action-admission owner and kernel validation before commit.'};
const finish=(status:'complete'|'partial'|'needs_player'|'unresolved',remainingNeeds:string[]=[]):TaskStep=>({kind:'finish',status,remainingNeeds});
const answer=(view:TaskView,key:string,question:string)=>{
  const result=view.decisions.find(value=>value.key===key)?.result.answers[question];
  return result?.status==='answered'&&result.type==='choice'?result.choice:undefined;
};
function validBaseEffect(value:unknown):boolean {
  if(!isPlainRecord(value)||!['clue','move'].includes(String(value.kind)))return false;
  const field=value.kind==='clue'?'clue':'to';
  return Object.keys(value).every(key=>key==='kind'||key===field)&&typeof value[field]==='string'&&!!String(value[field]).trim();
}
function decision(view:TaskView,key:string,state:Json,questions:DecisionQuestion[]):TaskStep {
  const batch:Omit<DecisionBatch,'id'|'scope'|'readSet'>={model:JEV_MODEL,family:'ordinary-apply',familyVersion:ORDINARY_APPLY_VERSION,state,questions};
  try{packDecisionBatch({...batch,id:'validation',scope:view.context.scope,readSet:view.context.readSet});}
  catch{return finish('partial',['The available effect catalog exceeds the bounded decision input.']);}
  return {kind:'decision',key,batch};
}
export function createOrdinaryApplyDomain(input:{rawInput():string}):TaskDomain {
  return withAttemptKeys({id:'ordinary-apply',version:ORDINARY_APPLY_VERSION,capabilities:['apply'],next(view){
    const outcome=mutationOutcome(view,'apply');
    if(outcome)return outcome;
    const options=view.observations.find(value=>value.proposal.operation==='apply.options');
    if(!options)return {kind:'operation',key:'apply-options',operation:'apply.options',args:{},capability:'apply',basis:[]};
    if(options.packet.status!=='succeeded'||!isPlainRecord(options.packet.result))return finish('partial',['Current effect options are unavailable.']);
    const source=options.packet.result;
    if(!Array.isArray(source.candidates)||!isPlainRecord(source.context)||source.candidates.some(value=>!isPlainRecord(value)
      ||typeof value.alias!=='string'||!value.alias||!isPlainRecord(value.effect)||!isPlainRecord(value.description)
      ||!validBaseEffect(value.effect))
      ||new Set(source.candidates.map(value=>(value as Record<string,Json>).alias)).size!==source.candidates.length)
      return finish('partial',['Current ordinary effect options are malformed.']);
    if(source.context.pending_choice)return finish('needs_player',['The existing mechanical choice remains with the player.']);
    if(source.context.session)return {kind:'handoff',verbs:['apply'],remainingNeeds:['The active subsystem requires its existing effect owner.']};
    const fulfillment=fulfillmentStep(view,input.rawInput(),source);
    if(fulfillment)return fulfillment;
    const candidates=source.candidates as Array<{alias:string;effect:Record<string,Json>;description:Record<string,Json>}>;
    const key='apply-inclusion';
    if(!view.decisions.some(value=>value.key===key))return decision(view,key,
      {rawInput:input.rawInput(),plan:view.plan as unknown as Json,context:source.context as Json,operation_contract:OPERATION_CONTRACT,
        candidates:candidates.map(value=>({alias:value.alias,description:value.description}))},[
      ...candidates.map((candidate):DecisionQuestion=>({key:candidate.alias,target:candidate.alias,type:'choice',
        instructions:'Include this actual effect only when the current declared action and established observations support landing it now. An available route is not player consent; a private clue is not discovered merely because it exists. Respect failed rolls, costs, conditions and the original player method. Do not plan a new goal.',
        criteria:{include:'This effect is supported and required now.',exclude:'This effect is not part of the current authorized outcome.',unknown:'Its necessity, applicability or authorization is unresolved.'}})),
      {key:'scope',target:'available effect family coverage',type:'choice',
        instructions:'Can the supplied current effect catalog completely cover the actual required world changes for this bounded goal? Do not silently drop an unsupported resource, object, source preparation or intermediate step.',
        criteria:{covered:'The required effects are all represented.',no_effect:'The goal requires no world effect.',unsupported:'A required effect or parameter is outside this catalog.',needs_player:'A genuine consequential player choice is missing.',unknown:'Coverage remains unresolved.'}},
    ]);
    const scope=answer(view,key,'scope');
    if(scope==='needs_player')return finish('needs_player',['The required effect still needs a consequential player choice.']);
    if(scope==='no_effect')return finish('complete');
    if(scope==='unsupported')return {kind:'handoff',verbs:['apply'],remainingNeeds:['A required effect is outside the typed catalog; use the existing apply owner with the original player intent.']};
    if(scope===undefined)return finish('partial',['The effect coverage decision is unavailable.']);
    if(scope!=='covered')return {kind:'replan',remainingNeeds:['Resolve the missing effect evidence or refine this same goal against current options.']};
    const unresolved=candidates.filter(candidate=>!['include','exclude'].includes(answer(view,key,candidate.alias)??''));
    const selected=candidates.filter(candidate=>answer(view,key,candidate.alias)==='include');
    if(!selected.length||selected.length>8||selected.filter(candidate=>candidate.effect.kind==='move').length>1)
      return finish('partial',['The current goal has no single bounded, unambiguous effect batch.']);
    const check='apply-batch-coverage';
    if(!view.decisions.some(value=>value.key===check))return decision(view,check,
      {rawInput:input.rawInput(),plan:view.plan as unknown as Json,context:source.context as Json,operation_contract:OPERATION_CONTRACT,
        selected:selected.map(value=>({alias:value.alias,description:value.description})),
        unresolved:unresolved.map(value=>({alias:value.alias,description:value.description}))},[
      {key:'batch',target:'entire selected effect batch',type:'choice',
        instructions:'Review this selected batch as a whole against the original declaration and actual receipts. All needed effects must be present in causal order, with no unchosen destination, disclosure or extra goal. Unresolved candidates are never executed. They may be left out only when they are dispensable to this goal; if any unresolved candidate or missing parameter is required, the whole batch is unsupported or unknown. An optional additional disclosure does not create a requirement. The kernel still owns final admission and atomic legality.',
        criteria:{supported:'The complete selected batch follows the declared action; every unresolved candidate is dispensable.',unsupported:'The batch is incomplete, contradictory, includes an unselected effect, or omits a required unresolved effect.',unknown:'The whole batch or necessity of an unresolved candidate remains unresolved.'}},
    ]);
    if(answer(view,check,'batch')==='unknown')return {kind:'replan',remainingNeeds:['The full effect batch needs additional evidence or a corrected same-goal plan. Nothing is committed.']};
    if(answer(view,check,'batch')!=='supported')return finish('partial',['The whole effect batch is not supported; nothing is committed.']);
    return {kind:'operation',key:'apply-settlement',operation:'apply',capability:'apply',basis:[],
      args:{effects:selected.map(candidate=>structuredClone(candidate.effect))}};
  }});
}
