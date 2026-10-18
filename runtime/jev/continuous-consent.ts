/** Atomic current-action consent questions shared by prescreen and post-proposal admission. */
import type {DecisionBatch} from './contracts.ts';
export const CONTINUOUS_CONSENT_MIN=.6;
/** Read-only operation meaning shared by the two consent producers. */
export function continuousConsentLine<T>(line:T):T {
 if(!line||typeof line!=='object'||Array.isArray(line)||(line as {kind?:unknown}).kind!=='move')return line;
 return {...line,arrival_scope:{at:'destination approach or doorway',enter_building:false,open_door:false,start_interaction:false}};
}
export function continuousConsentDisposition(selection:unknown,veto:unknown):'authorized'|'not_authorized'|'uncertain' {
 if(typeof selection!=='number'||typeof veto!=='number'||!Number.isFinite(selection)||!Number.isFinite(veto)||selection<0||selection>1||veto<0||veto>1)return 'uncertain';
 if(selection<=1-CONTINUOUS_CONSENT_MIN||veto>=CONTINUOUS_CONSENT_MIN)return 'not_authorized';
 return selection>=CONTINUOUS_CONSENT_MIN&&veto<=1-CONTINUOUS_CONSENT_MIN?'authorized':'uncertain';
}
export function continuousConsentQuestions(kinds:readonly string[]):DecisionBatch['questions'] {
 const questions:DecisionBatch['questions']=kinds.map((kind,index)=>{
            const elapsed=kind==='time';
            return {key:'consent_'+index,target:'proposal.lines['+index+']',type:'noul' as const,
                instructions:elapsed
                    ?'Is the elapsed world time in this line part of the activity selected in current_player_words? This includes observing or waiting for an NPC task the player requests now while staying clear. The player need not personally perform the work or name its exact ordinary duration. Judge selection of the activity; explicit restrictions are evaluated separately.'
                    :'Does current_player_words select the investigator action in proposal.lines['+index+'], explicitly or as an ordinary step of the stated goal? Use previous_public only to resolve references. Judge whether the action and its target were selected; do not judge outcomes or factual correctness. A move establishes arrival at the graph location, including its approach or doorway; it does not itself enter a building, open a door or start an interaction.',
                criteria:elapsed
                    ?{true:'This is elapsed time of the selected activity, including requested NPC work the investigator observes.',
                        false:'The activity or waiting itself was not selected.'}
                    :{true:'The action and its target are selected explicitly or as a routine step of the current goal.',
                        false:'The action or target is not selected; interest, a quotation or an earlier plan alone is not execution.'}};
        });
    kinds.forEach((_,index)=>questions.push({key:'restriction_'+index,target:'proposal.lines['+index+']',type:'noul',
        instructions:'Does current_player_words forbid executing this proposed operation now? Evaluate only an explicit conflicting limit, an unmet prerequisite, future-only timing, or a required earlier step that has not happened. Use previous_public solely to resolve references, not as standing restrictions. A move establishes arrival at the graph location, including its approach or doorway; it does not itself enter a building, open a door or start an interaction. A limit on those separate acts does not forbid arrival.',
        criteria:{true:'Executing this operation now violates a restriction or unmet condition in the current declaration.',
            false:'No current restriction prevents this operation now. A restriction concerning a different operation is not a conflict.'}}));

 return questions;
}
