/** Bind the owned carrier and exact quoted text; ordinary admission owns consent. */
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
export interface DocumentCandidate {name:string;owner:string;presentation?:string;version:string}
export interface DocumentBindingInput {
  campaign:string;turn:number;playerText:string;unfinished?:string;justTold?:string;recentTold?:Array<{turn:number|string;text:string}>;actor:string;
  requestedName?:string;suffix:string;documents:DocumentCandidate[];
  playerKnowledge?:{day:string;clues:Array<{label:string;how?:string}>;handouts:Array<{name:string|null;text:string}>;narrations:Array<{turn:number|string;text:string}>};
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
      {kind:'family',resource:DOCUMENT_BINDING_FAMILY,revision:'9'}]};
}
export async function bindDocumentAppend(input:DocumentBindingInput,decision:DecisionPort,lease:TaskLease):Promise<
  {status:'bound';document:DocumentCandidate;suffix:string;origin:'player_span'|'proposal';span?:{start:number;end:number};targetProbability:number;
    }
  |{status:'unresolved';reason:string;judgements?:Record<string,{value:string|number;probability:number;confidence?:number}>}> {
  const judgements:Record<string,{value:string|number;probability:number;confidence?:number}>={};
  const unresolved=(reason:string)=>({status:'unresolved' as const,reason,...(Object.keys(judgements).length?{judgements}:{})});
  try {
    if(!input.documents.length||input.documents.length>32)return unresolved('unsupported_catalog');
    const binding=documentBindingScope(input);
    if(digest(lease.context.scope)!==digest(binding.scope)||digest(lease.context.readSet)!==digest(binding.readSet))return unresolved('attempt_binding_mismatch');
    const literals=quotedSpans(input.playerText);
    if(literals.length>32)return unresolved('unsupported_literal_catalog');
    const canonical=input.documents.filter(entry=>entry.name.normalize('NFKC').trim().toLowerCase()===input.requestedName?.normalize('NFKC').trim().toLowerCase());
    if(canonical.length===1&&!literals.length)return {status:'bound',document:canonical[0]!,suffix:input.suffix,origin:'proposal',targetProbability:1};

    const role=(key:string,choices:string[],answers:DecisionResult['answers'])=>{
      const answer=answers[key];
      return answer?.status==='answered'&&answer.type==='choice'&&choices.includes(answer.choice)
        &&Number.isFinite(answer.confidence)&&answer.confidence>=0&&answer.confidence<=1
        &&choices.every(choice=>Number.isFinite(answer.probabilities[choice])&&answer.probabilities[choice]!>=0&&answer.probabilities[choice]!<=1)
        &&Object.keys(answer.probabilities).length===choices.length
        &&probabilityMassValid(choices.map(choice=>answer.probabilities[choice]!))?answer:null;
    };
    const identity:DecisionBatch={id:'document-append:'+input.turn+':'+digest(input).slice(0,16),model:JEV_MODEL,
      family:DOCUMENT_BINDING_FAMILY,familyVersion:'9',...binding,
      state:{playerWords:input.playerText,justTold:input.justTold??null,investigator:input.actor,
        documents:input.documents.map((entry,index)=>({alias:'document_'+index,name:entry.name,presentation:entry.presentation??null})),
        quotedPassages:literals.map((entry,index)=>({alias:'literal_'+index,text:entry.text})),
        policy:'Bind only the existing owned carrier and any complete dictated quotation. This is identity binding, not execution permission or world truth.'} as Json,
      questions:[...input.documents.map((_,index)=>({key:'document_'+index,target:'documents['+index+']',type:'noul' as const,
        instructions:'Does playerWords identify documents['+index+'] as the destination for the requested writing? Judge the referenced carrier, not whether writing should happen. All candidates belong to the investigator. A shortened personal reference can identify a registered name. A source or topic in the writing is not its destination.',
        criteria:{true:'This is the referenced writing destination.',false:'This is another carrier, a mentioned source or topic, or no writing destination is referred to.'}})),
        ...literals.map((_,index)=>({key:'literal_'+index,target:'playerWords',type:'choice' as const,
          instructions:'What role does quotedPassages['+index+'].text have in the player declaration? Classify its role, not world truth.',
          criteria:{addition_text:'The complete text the player supplies as the addition to write.',other_quote:'A name, topic, example, question, text to read, or only part of the addition rather than its complete text.'}}))]};
    packDecisionBatch(identity);
    const result=await decision.decide(identity,lease);
    if(result.status!=='complete')return unresolved(result.failure?.code??'identity_'+result.status);
    const selected:Array<{index:number;probability:number}>=[],ranked:Array<{index:number;probability:number}>=[];
    for(let index=0;index<input.documents.length;index++) {
      const answer=result.answers['document_'+index];
      if(answer?.status!=='answered'||answer.type!=='noul'||!Number.isFinite(answer.noul)||answer.noul<0||answer.noul>1)return unresolved('invalid_target_answer');
      judgements['document_'+index]={value:answer.noul,probability:answer.noul};
      ranked.push({index,probability:answer.noul});
      if(answer.noul>=DOCUMENT_BINDING_MIN)selected.push({index,probability:answer.noul});
    }
    if(!selected.length){ranked.sort((a,b)=>b.probability-a.probability);
      if(ranked[0]!.probability>=DOCUMENT_LEAD_MIN&&ranked.slice(1).every(entry=>entry.probability<=DOCUMENT_OTHER_MAX))selected.push(ranked[0]!);
    }
    if(selected.length!==1)return unresolved(selected.length?'ambiguous_target':'no_target');
    const chosen:Array<{index:number;probability:number;confidence:number}>=[];
    for(let index=0;index<literals.length;index++) {
      const answer=role('literal_'+index,['addition_text','other_quote'],result.answers);
      if(!answer)return unresolved('invalid_literal_answer');
      if(answer.choice==='addition_text'&&answer.probabilities.addition_text!<DOCUMENT_ROLE_PROBABILITY_MIN)
        return unresolved('literal_binding_uncertain');
      if(answer.choice==='addition_text'&&answer.probabilities.addition_text!>=DOCUMENT_ROLE_PROBABILITY_MIN)
        chosen.push({index,probability:answer.probabilities.addition_text!,confidence:answer.confidence});
    }
    if(chosen.length>1)return unresolved('ambiguous_literal');
    const document=input.documents[selected[0]!.index]!;
    let suffix=input.suffix,origin:'player_span'|'proposal'='proposal',span:{start:number;end:number}|undefined;
    if(chosen.length===1){const literal=literals[chosen[0]!.index]!;
      suffix=(input.suffix.match(/^[ \t\r\n]*/u)?.[0]??'')+literal.text;origin='player_span';span={start:literal.start,end:literal.end};
    }
    return {status:'bound',document,suffix,origin,...(span?{span}:{}),targetProbability:selected[0]!.probability};
  }catch{return unresolved('document_binding_unavailable');}
}
