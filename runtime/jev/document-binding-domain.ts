/** Bind a chosen append to an existing owned carrier; never generate text, names or a plan. */
import {createHash} from 'node:crypto';
import type {DecisionBatch, Json, ReadSet, ScopeBinding} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import type {TaskLease} from './task-context.ts';
import {JEV_MODEL, packDecisionBatch} from './question-packing.ts';

export const DOCUMENT_BINDING_FAMILY = 'owned-document-binding';
export const DOCUMENT_BINDING_MIN = .9;
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
      {kind:'family',resource:DOCUMENT_BINDING_FAMILY,revision:'2'}]};
}
export async function bindDocumentAppend(input:DocumentBindingInput,decision:DecisionPort,lease:TaskLease):Promise<
  {status:'bound';document:DocumentCandidate;suffix:string;origin:'player_span'|'proposal';span?:{start:number;end:number};targetProbability:number;contentProbability:number}|{status:'unresolved';reason:string}> {
  const unresolved=(reason:string)=>({status:'unresolved' as const,reason});
  try {
    if(!input.documents.length||input.documents.length>32)return unresolved('unsupported_catalog');
    const binding=documentBindingScope(input);
    if(digest(lease.context.scope)!==digest(binding.scope)||digest(lease.context.readSet)!==digest(binding.readSet))return unresolved('attempt_binding_mismatch');
    const literals=quotedSpans(input.playerText);
    if(literals.length>32)return unresolved('unsupported_literal_catalog');
    const batch:DecisionBatch={id:`document-append:${input.turn}:${digest(input).slice(0,16)}`,model:JEV_MODEL,
      family:DOCUMENT_BINDING_FAMILY,familyVersion:'2',...binding,
      state:{playerWords:input.playerText,unfinishedDeclaration:input.unfinished??null,justTold:input.justTold??null,
        investigator:input.actor,proposedSuffix:input.suffix,
        documents:input.documents.map((row,index)=>({alias:`document_${index}`,name:row.name,presentation:row.presentation??null})),
        quotedPassages:literals.map((span,index)=>({alias:`literal_${index}`,text:span.text})),
        policy:'Only player words and their public context establish the chosen target and writing. The proposed suffix is a proposal, never evidence of consent. No prior document contents are supplied. Do not judge whether the written claim is true.'} as Json,
      questions:[...input.documents.map((_,index)=>({key:`document_${index}`,target:`documents[${index}]`,type:'noul' as const,
        instructions:`The player selected this existing document in documents[${index}] as the carrier for the addition they want written now. Judge the target from playerWords, unfinishedDeclaration and justTold; the investigator owns all offered carriers. Read current words as continuing, narrowing or withdrawing an unfinished declaration. A shared topic alone does not select a document; a request to read it is not a choice to add writing.`})),
        ...literals.map((_,index)=>({key:`literal_${index}`,target:`quotedPassages[${index}]`,type:'noul' as const,
          instructions:`The player explicitly selected the complete quotedPassages[${index}].text as the exact addition to write now. A quoted document name, topic, example or question is not the text to add. An earlier condition must already be met; reading, considering or quoting a suggestion is not choosing writing. Judge only the current playerWords and public context.`})),
        {key:'content',target:'proposedSuffix',type:'noul',instructions:'The proposedSuffix is within the addition the player chose to have written now. Judge only from playerWords and their public context; allow a separator newline, but not extra assertions, a replacement, an unchosen interpretation or content merely suggested by the Keeper. Reading, considering or asking about writing does not choose writing.'}]};
    packDecisionBatch(batch);
    const result=await decision.decide(batch,lease);
    if(result.status!=='complete')return unresolved(result.failure?.code??`decision_${result.status}`);
    const selected:Array<{index:number;probability:number}>=[];
    for(let index=0;index<input.documents.length;index++) {
      const answer=result.answers[`document_${index}`];
      if(answer?.status!=='answered'||answer.type!=='noul'||!Number.isFinite(answer.noul)||answer.noul<0||answer.noul>1)return unresolved('invalid_target_answer');
      if(answer.noul>=DOCUMENT_BINDING_MIN)selected.push({index,probability:answer.noul});
    }
    const content=result.answers.content;
    if(content?.status!=='answered'||content.type!=='noul'||!Number.isFinite(content.noul)||content.noul<0||content.noul>1)return unresolved('invalid_content_answer');
    if(selected.length!==1)return unresolved(selected.length?'ambiguous_target':'no_target');
    const chosenLiterals:Array<{index:number;probability:number}>=[];
    for(let index=0;index<literals.length;index++) {
      const answer=result.answers[`literal_${index}`];
      if(answer?.status!=='answered'||answer.type!=='noul'||!Number.isFinite(answer.noul)||answer.noul<0||answer.noul>1)return unresolved('invalid_literal_answer');
      if(answer.noul>=DOCUMENT_BINDING_MIN)chosenLiterals.push({index,probability:answer.noul});
    }
    if(chosenLiterals.length===1) {
      const literal=chosenLiterals[0]!;
      const separator=input.suffix.match(/^[ \t\r\n]*/u)?.[0]??'';
      return {status:'bound',document:input.documents[selected[0]!.index]!,suffix:separator+literals[literal.index]!.text,
        origin:'player_span',span:{start:literals[literal.index]!.start,end:literals[literal.index]!.end},
        targetProbability:selected[0]!.probability,contentProbability:literal.probability};
    }
    if(content.noul<DOCUMENT_BINDING_MIN)return unresolved('addition_not_cleared');
    return {status:'bound',document:input.documents[selected[0]!.index]!,suffix:input.suffix,origin:'proposal',
      targetProbability:selected[0]!.probability,contentProbability:content.noul};
  }catch{return unresolved('document_binding_unavailable');}
}
