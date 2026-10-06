/** Bind a chosen append to an existing owned carrier; never generate text, names or a plan. */
import {createHash} from 'node:crypto';
import {probabilityMassValid,type DecisionBatch,type DecisionResult,type Json,type ReadSet,type ScopeBinding} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import type {TaskLease} from './task-context.ts';
import {JEV_MODEL, packDecisionBatch} from './question-packing.ts';

export const DOCUMENT_BINDING_FAMILY = 'owned-document-binding';
export const DOCUMENT_BINDING_MIN = .9;
export const DOCUMENT_ROLE_PROBABILITY_MIN = .9;
export interface DocumentCandidate {name:string;owner:string;presentation?:string;version:string}
export interface DocumentBindingInput {
  campaign:string;turn:number;playerText:string;unfinished?:string;justTold?:string;actor:string;
  suffix:string;documents:DocumentCandidate[];
}
/** Closed quotation syntax only; Jev decides which, if any, passage is selected writing. */
function quotedSpans(text:string):Array<{start:number;end:number;text:string}> {
  const pairs:Record<string,string>={'"':'"',"'":"'",'“':'”','‘':'’','«':'»','‹':'›','\u300c':'\u300d','\u300e':'\u300f'};
  const spans:Array<{start:number;end:number;text:string}>=[];
  const escaped=(index:number)=>{
    let slashes=0;for(let before=index-1;before>=0&&text[before]==='\\';before--)slashes++;
    return slashes%2===1;
  };
  const boundary=(character:string|undefined,punctuation:string)=>character===undefined||/\s/u.test(character)||punctuation.includes(character);
  for(let index=0;index<text.length;index++) {
    const open=text[index]!,close=pairs[open];if(!close||escaped(index))continue;
    // Apostrophes inside a token are punctuation, not opening or closing quotation syntax.
    const apostrophe=open==="'"||open==='‘';
    if(apostrophe&&!boundary(text[index-1],'([{,:;!?—–-'))continue;
    let end=index+1;
    while(end<text.length&&(text[end]!==close||escaped(end)
      ||apostrophe&&!boundary(text[end+1],')]}.,:;!?—–-')))end++;
    if(end===text.length)continue;
    if(end>index+1)spans.push({start:index+1,end,text:text.slice(index+1,end)});
    if(spans.length>32)return spans;
    index=end;
  }
  return spans;
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function documentBindingScope(input:DocumentBindingInput):{scope:ScopeBinding;readSet:ReadSet} {
  return {scope:{owner:DOCUMENT_BINDING_FAMILY,campaign:input.campaign,audience:'player'},
    readSet:[{kind:'draft',resource:`turn:${input.turn}:document-append`,revision:digest(input)},
      {kind:'family',resource:DOCUMENT_BINDING_FAMILY,revision:'3'}]};
}
export async function bindDocumentAppend(input:DocumentBindingInput,decision:DecisionPort,lease:TaskLease):Promise<
  {status:'bound';document:DocumentCandidate;suffix:string;origin:'player_span'|'proposal';span?:{start:number;end:number};targetProbability:number;contentProbability:number;contentConfidence:number;executionProbability:number;executionConfidence:number}
  |{status:'unresolved';reason:string;judgements?:Record<string,{value:string|number;probability:number;confidence?:number}>}> {
  const judgements:Record<string,{value:string|number;probability:number;confidence?:number}>={};
  const unresolved=(reason:string)=>({status:'unresolved' as const,reason,...(Object.keys(judgements).length?{judgements}:{})});
  try {
    if(!input.documents.length||input.documents.length>32)return unresolved('unsupported_catalog');
    const binding=documentBindingScope(input);
    if(digest(lease.context.scope)!==digest(binding.scope)||digest(lease.context.readSet)!==digest(binding.readSet))return unresolved('attempt_binding_mismatch');
    const literals=quotedSpans(input.playerText);
    if(literals.length>32)return unresolved('unsupported_literal_catalog');
    const batch:DecisionBatch={id:`document-append:${input.turn}:${digest(input).slice(0,16)}`,model:JEV_MODEL,
      family:DOCUMENT_BINDING_FAMILY,familyVersion:'3',...binding,
      state:{playerWords:input.playerText,unfinishedDeclaration:input.unfinished??null,justTold:input.justTold??null,
        investigator:input.actor,proposedSuffix:input.suffix,
        documents:input.documents.map((row,index)=>({alias:`document_${index}`,name:row.name,presentation:row.presentation??null})),
        quotedPassages:literals.map((span,index)=>({alias:`literal_${index}`,text:span.text})),
        policy:'Only player words and their public context establish the chosen target and writing. The proposed suffix is a proposal, never evidence of consent. No prior document contents are supplied. Do not judge whether the written claim is true.'} as Json,
      questions:[...input.documents.map((_,index)=>({key:`document_${index}`,target:`documents[${index}]`,type:'noul' as const,
        instructions:`Does playerWords identify documents[${index}] as the destination for the requested writing? Judge the referenced carrier, not whether the writing should happen. All candidates belong to the current investigator. A shortened personal reference can identify a registered name; exact spelling is not required. A source or topic inside the words to be written is not the writing destination.`,
        criteria:{true:'This is the carrier referred to as the writing destination.',false:'This is another carrier, a mentioned topic/source, or no writing destination is referred to.'}})),
        ...literals.map((_,index)=>({key:`literal_${index}`,target:'playerWords',type:'choice' as const,
          instructions:`What role does quotedPassages[${index}].text have in the current player declaration? Classify its role, not whether the quoted claim is true.`,
          criteria:{addition_text:'The complete text the player supplies as the addition to write.',other_quote:'A name, topic, example, question, text to read, or only part of the addition rather than its complete text.'}})),
        {key:'content',target:'playerWords',type:'choice',
          instructions:'Classify proposedSuffix against the writing the player selects. The proposal is not evidence of consent. Ignore only a separator newline; do not judge whether the claim is true.',
          criteria:{within_selected_addition:'The suffix is the selected addition, without new claims or a replacement of old text.',outside_selected_addition:'The suffix includes unselected words or interpretation, replaces old text, or no addition is selected.'}}]};
    packDecisionBatch(batch);
    const result=await decision.decide(batch,lease);
    if(result.status!=='complete')return unresolved(result.failure?.code??`decision_${result.status}`);
    const observe=(answers:DecisionResult['answers'])=>{for(const [key,answer] of Object.entries(answers))if(answer.status==='answered') {
      if(answer.type==='noul'&&Number.isFinite(answer.noul))judgements[key]={value:answer.noul,probability:answer.noul};
      if(answer.type==='choice'&&Number.isFinite(answer.confidence)&&Number.isFinite(answer.probabilities[answer.choice]))
        judgements[key]={value:answer.choice,probability:answer.probabilities[answer.choice]!,confidence:answer.confidence};
    }};
    observe(result.answers);
    const role=(key:string,choices:string[],answers=result.answers)=>{
      const answer=answers[key];
      return answer?.status==='answered'&&answer.type==='choice'&&choices.includes(answer.choice)
        &&Number.isFinite(answer.confidence)&&answer.confidence>=0&&answer.confidence<=1
        &&choices.every(choice=>Number.isFinite(answer.probabilities[choice])&&answer.probabilities[choice]!>=0&&answer.probabilities[choice]!<=1)
        &&Object.keys(answer.probabilities).length===choices.length
        &&probabilityMassValid(choices.map(choice=>answer.probabilities[choice]!))?answer:null;
    };
    const selected:Array<{index:number;probability:number}>=[];
    for(let index=0;index<input.documents.length;index++) {
      const answer=result.answers[`document_${index}`];
      if(answer?.status!=='answered'||answer.type!=='noul'||!Number.isFinite(answer.noul)||answer.noul<0||answer.noul>1)return unresolved('invalid_target_answer');
      if(answer.noul>=DOCUMENT_BINDING_MIN)selected.push({index,probability:answer.noul});
    }
    const content=role('content',['within_selected_addition','outside_selected_addition']);
    if(!content)return unresolved('invalid_content_answer');
    if(selected.length!==1)return unresolved(selected.length?'ambiguous_target':'no_target');
    const chosenLiterals:Array<{index:number;probability:number;confidence:number}>=[];
    for(let index=0;index<literals.length;index++) {
      const answer=role(`literal_${index}`,['addition_text','other_quote']);
      if(!answer)return unresolved('invalid_literal_answer');
      if(answer.choice==='addition_text'&&answer.probabilities.addition_text!>=DOCUMENT_ROLE_PROBABILITY_MIN)
        chosenLiterals.push({index,probability:answer.probabilities.addition_text!,confidence:answer.confidence});
    }
    const document=input.documents[selected[0]!.index]!;
    let suffix=input.suffix,origin:'player_span'|'proposal'='proposal',span:{start:number;end:number}|undefined;
    let contentProbability=content.probabilities.within_selected_addition!,contentConfidence=content.confidence;
    if(chosenLiterals.length===1) {
      const literal=chosenLiterals[0]!;
      const separator=input.suffix.match(/^[ \t\r\n]*/u)?.[0]??'';
      suffix=separator+literals[literal.index]!.text;origin='player_span';
      span={start:literals[literal.index]!.start,end:literals[literal.index]!.end};
      contentProbability=literal.probability;contentConfidence=literal.confidence;
    }else if(content.choice!=='within_selected_addition'||contentProbability<DOCUMENT_ROLE_PROBABILITY_MIN)return unresolved('addition_not_cleared');
    const executionBatch:DecisionBatch={...batch,id:batch.id+':execution',
      state:{playerWords:input.playerText,unfinishedDeclaration:input.unfinished??null,justTold:input.justTold??null,
        playerControls:input.actor,ownedCarrier:{name:document.name,owner:input.actor},
        operation:{kind:'append',writer:input.actor,document:document.name,text:suffix,existingText:'The kernel preserves every existing character exactly.',status:'unperformed_proposal'},
        policy:'The operation has not happened. Judge whether performing it would fulfill the current declaration; a first-person declared action is a request to act, not proof of execution. The proposed operation is not evidence of consent. Do not judge whether the written claim is true.'},
      questions:[{key:'execution',target:'operation',type:'choice',
        instructions:'How does this exact append operation relate to the current player declaration, unfinished declaration and public context?',
        criteria:{selected_operation:'Performing this append fulfills the currently selected addition and its limits. A subsequent read-back is part of the chosen request; preserving old writing is guaranteed by the kernel.',
          not_selected_operation:'The current request only reads, discusses, withdraws or defers writing, has an unmet prerequisite, or this operation adds unselected words or uses an unselected carrier.'}}]};
    packDecisionBatch(executionBatch);
    const confirmation=await decision.decide(executionBatch,lease);
    if(confirmation.status!=='complete')return unresolved(confirmation.failure?.code??`execution_${confirmation.status}`);
    observe(confirmation.answers);
    const execution=role('execution',['selected_operation','not_selected_operation'],confirmation.answers);
    if(!execution)return unresolved('invalid_execution_answer');
    if(execution.choice!=='selected_operation'||execution.probabilities.selected_operation!<DOCUMENT_ROLE_PROBABILITY_MIN)return unresolved('execution_not_cleared');
    return {status:'bound',document,suffix,origin,...(span?{span}:{}),targetProbability:selected[0]!.probability,
      contentProbability,contentConfidence,executionProbability:execution.probabilities.selected_operation!,executionConfidence:execution.confidence};
  }catch{return unresolved('document_binding_unavailable');}
}
