/** Atomic current-action consent questions shared by prescreen and post-proposal admission. */
import type {DecisionBatch} from './contracts.ts';
export const CONTINUOUS_CONSENT_MIN=.6;
/** Read-only operation meaning shared by the two consent producers. */
export function continuousConsentLine<T>(line:T):T {
 if(!line||typeof line!=='object'||Array.isArray(line))return line;
 const operation=line as {kind?:unknown;action?:unknown};
 if(operation.kind==='place'&&operation.action==='observe')return {...line,perception_scope:{at:'actual current position; to names the sensory target, not a journey',
  settles:['selected_perception_only'],additions:'Compatible layout and incident facts are Keeper authoring, never proof of player movement or construction.'}};
 if(operation.kind==='place'&&operation.action==='move')return {...line,arrival_scope:{at:'named destination and optional at feature position',settles:['party_arrival','local_position'],
  additions:'Keeper-authored observable surroundings, not an investigator construction action. A selected generic destination may bind to a compatible named instance; judge compatibility and all current restrictions.',
  references:'registered_destination supplies canonical observable identity, position and selected feature descriptions. Use these to resolve the target, never as permission or a claim that every feature is registered.'}};
 if(operation.kind!=='move')return line;
 return {...line,arrival_scope:{at:'destination approach or doorway',settles:['party_arrival']}};
}
export function continuousConsentDisposition(selection:unknown,veto:unknown):'authorized'|'not_authorized'|'uncertain' {
 if(typeof selection!=='number'||typeof veto!=='number'||!Number.isFinite(selection)||!Number.isFinite(veto)||selection<0||selection>1||veto<0||veto>1)return 'uncertain';
 if(selection<=1-CONTINUOUS_CONSENT_MIN||veto>=CONTINUOUS_CONSENT_MIN)return 'not_authorized';
 return selection>=CONTINUOUS_CONSENT_MIN&&veto<=1-CONTINUOUS_CONSENT_MIN?'authorized':'uncertain';
}
export function continuousConsentQuestions(kinds:readonly string[],actions:readonly (string|undefined)[]=[],timeForms:readonly ('band'|'until'|'minutes'|undefined)[]=[]):DecisionBatch['questions'] {
 const questions:DecisionBatch['questions']=kinds.map((kind,index)=>{
            const elapsed=kind==='time',location=kind==='place',move=location&&actions[index]==='move';
            return {key:'consent_'+index,target:'proposal.lines['+index+']',type:'noul' as const,
                instructions:elapsed&&timeForms[index]==='until'
                    ?'Does current_player_words select waiting now until the endpoint in this time line? Compare the selected stopping point with until, using current_clock only to interpret that endpoint. Selecting some waiting does not authorize another endpoint or extra duration. Do not use the Keeper reason as consent. Judge the actual requested wait and its endpoint; restrictions and prerequisites are evaluated separately.'
                    :elapsed&&timeForms[index]==='minutes'
                    ?'Does current_player_words explicitly select the duration stated in this time line? Compare the selected duration with minutes. Selecting some activity or waiting does not authorize a different duration. Do not use the Keeper reason as consent. Restrictions and prerequisites are evaluated separately.'
                    :elapsed&&timeForms[index]==='band'
                    ?'Does the current player declaration select the activity whose elapsed cost this time line represents? Ordinary elapsed cost of a chosen physical activity is not a separate request to pause or wait. The player need not name a mechanical time category. Use the current words, actual prior settlements and ordered operations to identify that activity; a Keeper reason or a neighboring proposal is not consent. Do not authorize a different task, a duplicate already settled cost, or an additional independent delay. If supplied, rule_time_cost describes the category meaning and extent, not permission.'
                    :elapsed?'Is the elapsed world time in this line part of the activity selected in current_player_words? This includes observing or waiting for an NPC task the player requests now while staying clear. The player need not personally perform the work or name its exact ordinary duration. Judge selection of the activity; explicit restrictions are evaluated separately.'
                    :move?'Does current_player_words select this proposed arrival or local position now? Compare execution_position.before with the named destination and optional at feature. When already in the destination place, judge only the selected local positioning; do not require a new journey to that same place. A statement of stopping or remaining at a local point selects that position, but does not authorize travel to a different place. Use registered_destination for identity and physical reference only, never consent. Other activities and past or unfinished declarations grant no current consent.'
                    :location?'Does current_player_words select this location action and target, explicitly or as an ordinary step of the stated goal? For action move, to is the actual destination and at is optional local positioning. For action observe, to is the sensory target seen/heard from the actual current position: it is not a journey or entry, and looking at somebody does not start a conversation. A player choosing an ordinary hotel need not supply its name: the Keeper can name a compatible instance. Additions, relations and compatible incident facts are Keeper-authored surroundings, not player construction or a requirement for earlier public mention. Judge the selected action and target scope, not factual correctness. Action feature changes an existing feature state and must correspond to a selected attempt. Use previous_public only to resolve references.'
                    :'Does current_player_words select the investigator action in proposal.lines['+index+'], explicitly or as an ordinary step of the stated goal? Use previous_public only to resolve references. Judge whether the action and its target were selected; do not judge outcomes or factual correctness. A move establishes arrival at the graph location, including its approach or doorway; it does not itself enter a building, open a door or start an interaction.',
                criteria:elapsed&&timeForms[index]==='until'
                    ?{true:'The player selects this wait and its stated endpoint now.',false:'The player does not select waiting now, or selects a different endpoint or only conditional future waiting.'}
                    :elapsed&&timeForms[index]==='minutes'
                    ?{true:'The player explicitly selects this duration now.',false:'The player selects no duration, a different duration, or only conditional future activity.'}
                    :elapsed&&timeForms[index]==='band'
                    ?{true:'The time is an ordinary elapsed cost of the activity actually selected now, or a duration the player explicitly selects.',
                        false:'The proposed time instead represents an unselected activity, an additional independent delay, a duplicate cost, or an extent outside the selected activity.'}
                    :elapsed?{true:'This is elapsed time of the selected activity, including requested NPC work the investigator observes.',false:'The activity or waiting itself was not selected.'}
                    :move?{true:'The player chooses this destination and local position now, directly or as an ordinary step of their goal.',false:'The player does not choose this destination or local position now.'}
                    :{true:'The action and its target are selected explicitly or as a routine step of the current goal.',
                        false:'The action or target is not selected; interest, a quotation or an earlier plan alone is not execution.'}};
        });
    kinds.forEach((kind,index)=>questions.push({key:'restriction_'+index,target:'proposal.lines['+index+']',type:'noul',
        instructions:'Does current_player_words forbid executing this proposed operation now? Evaluate only an explicit conflicting limit, an unmet prerequisite, future-only timing, or a required earlier step that has not happened. Use previous_public solely to resolve references, not as standing restrictions. '+(kind==='place'
            ?'A place move reaches its named destination and optional local feature position, including entry or boundary crossing when specified; review restrictions on those actual actions. The move itself establishes arrival; it does not require already being at its destination, and a later selected wait or service is not a prerequisite for this earlier move. A place observe only sees/hears its target from the current position; it grants no travel, entry, feature change or speech. Additions and relations are Keeper world authoring, not player construction.'
            :'A move establishes arrival at the graph location, including its approach or doorway; it does not itself enter a building, open a door or start an interaction. A limit on those separate acts does not forbid arrival.'),
        criteria:{true:'Executing this operation now violates a restriction or unmet condition in the current declaration.',
            false:'No current restriction prevents this operation now. A restriction concerning a different operation is not a conflict.'}}));

 return questions;
}
