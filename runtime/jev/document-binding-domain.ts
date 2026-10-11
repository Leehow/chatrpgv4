/** Bind a chosen append to an existing owned carrier; never generate text, names or a plan. */
import {createHash} from 'node:crypto';
import {probabilityMassValid,type DecisionBatch,type DecisionResult,type Json,type ReadSet,type ScopeBinding} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import type {TaskLease} from './task-context.ts';
import {JEV_MODEL, packDecisionBatch} from './question-packing.ts';

export const DOCUMENT_BINDING_FAMILY = 'owned-document-binding';
export const DOCUMENT_BINDING_MIN = .9;
export const DOCUMENT_ROLE_PROBABILITY_MIN = .9;
/**
 * §227.5: a clear leader below DOCUMENT_BINDING_MIN still names the carrier when every other candidate is far below it. 4d7's
 * sole notebook (the player's short word for its registered interview-notebook name) led .83-.89 with every other carrier at .04-.06, and each addition was lost.
 */
export const DOCUMENT_LEAD_MIN = .8, DOCUMENT_OTHER_MAX = .2;
/** §227.5: how much of the recent told text (player-visible deliveries, newest kept) the content questions read. */
export const DOCUMENT_TOLD_CHARS = 6000;
export interface DocumentCandidate {name:string;owner:string;presentation?:string;version:string}
export interface DocumentBindingInput {
  campaign:string;turn:number;playerText:string;unfinished?:string;justTold?:string;recentTold?:Array<{turn:number|string;text:string}>;actor:string;
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
/** §227.5: the recent told text, oldest first, newest kept whole within DOCUMENT_TOLD_CHARS. */
function told(input:DocumentBindingInput):Array<{turn:number|string;text:string}>|null {
  const out:Array<{turn:number|string;text:string}>=[];let room=DOCUMENT_TOLD_CHARS;
  for(const entry of [...input.recentTold??[]].reverse()){
    if(room<=0)break;const text=entry.text.slice(-room);room-=text.length;out.unshift({turn:entry.turn,text});
  }
  return out.length?out:null;
}
export function documentBindingScope(input:DocumentBindingInput):{scope:ScopeBinding;readSet:ReadSet} {
  return {scope:{owner:DOCUMENT_BINDING_FAMILY,campaign:input.campaign,audience:'player'},
    readSet:[{kind:'draft',resource:`turn:${input.turn}:document-append`,revision:digest(input)},
      {kind:'family',resource:DOCUMENT_BINDING_FAMILY,revision:'5'}]};
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
      family:DOCUMENT_BINDING_FAMILY,familyVersion:'5',...binding,
      state:{playerWords:input.playerText,unfinishedDeclaration:input.unfinished??null,justTold:input.justTold??null,recentTold:told(input),
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
          instructions:'Is proposedSuffix the writing the player chose? A player either dictates the words to write, names what to write down (people, places, facts, a text they read) and leaves the wording to the Keeper, or asks to copy out a text they read, or to write up or sort what they found. For named things, the chosen writing is what justTold, recentTold, unfinishedDeclaration or playerWords say about them; a copy of a text recentTold shows them reading is the chosen writing; for a write-up of their findings, a record of what recentTold says they found is the chosen writing; a shorter or reworded record of exactly that is the chosen writing. The proposal is not evidence of consent. Ignore a separator newline. Do not judge whether a claim is true in the world.',
          criteria:{within_selected_addition:'The suffix records only the dictated words, or only what the public context says about the people, places, facts or text the player named to write down or copy, or, for a write-up of findings, only what the public context says the investigator found (for example: the player says to note the clerk address, and the suffix records the address the clerk just gave, in shorter words).',outside_selected_addition:'The suffix adds something the player did not name or the public context does not say (another topic, a conclusion, a guess, a finding nobody told), replaces old text, or the player chose no writing.'}}]};
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
    if(!selected.length){
      const ranked=input.documents.map((_,index)=>({index,probability:(result.answers[`document_${index}`] as {noul:number}).noul})).sort((a,b)=>b.probability-a.probability);
      if(ranked[0]!.probability>=DOCUMENT_LEAD_MIN&&ranked.slice(1).every(entry=>entry.probability<=DOCUMENT_OTHER_MAX))selected.push(ranked[0]!);
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
      state:{playerWords:input.playerText,unfinishedDeclaration:input.unfinished??null,justTold:input.justTold??null,recentTold:told(input),
        playerControls:input.actor,ownedCarrier:{name:document.name,owner:input.actor,registered:true},
        operation:{kind:'append',writer:input.actor,document:document.name,text:suffix,existingText:'The kernel preserves every existing character exactly.',status:'unperformed_proposal'},
        policy:'Judge the player choice, not whether the operation is feasible or has already happened. The host has bound the registered carrier and ownership. A technical naming failure in a prior attempt is not a player withdrawal or an in-fiction prerequisite. A first-person declared action is a request to act. The proposed operation is not evidence of consent. Do not judge whether the written claim is true.'},
      questions:[{key:'execution',target:'operation',type:'choice',
        instructions:'Classify this exact append against what the player chooses, rather than whether it can be executed. Use the public context only to interpret the player request or the player own conditions. The carrier identity and ownership are already bound; a technical failure of an earlier attempt does not withdraw the request.',
        criteria:{selected_operation:'The player chooses to write this addition to this carrier now: the text is the player dictated words, a copy of a text the player asked to copy out, a write-up of what the public context says they found when they asked for one, or, when the player named what to write down, a record of what the public context says about those named things (for example: the player says to note the clerk address, and the text records the address the clerk just gave). Subsequent read-back is part of that request; preserving old writing is guaranteed by the kernel.',
          not_selected_operation:'The player only reads, discusses, withdraws or defers writing, sets a prerequisite not established by public context, chose another carrier, or the text records something the player did not name, copy or ask to write up.'}}]};
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
