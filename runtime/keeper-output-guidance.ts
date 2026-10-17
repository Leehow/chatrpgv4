/** One instruction owner for the existing same-Keeper record/public transport. */
export const SAME_KEEPER_AFTER_RESULT_GUIDANCE='After those results, put any remaining fully known effects or event record with the public text in the final JSON response; do not spend another tool continuation merely to record them. '
    +'This includes a supported NPC reunion: keep reunion alone in its NPC effect, and carry that effect beside the public text in the same final record. '
    +'An independently selected part may instead use ordinary apply first. Settle it before describing its completed result. '
    +'Use public-only {{public}} prose when no new write remains; public-only prose never settles an event or physical action.';
export const SAME_KEEPER_REFUSAL_CONTINUATION='All effects and the event in this rejected batch remain uncommitted. '
    +'An event in that batch has not been independently admitted. Do not automatically split or resend it, or carry out refused actions. '
    +'Only a genuinely independent part that the player selected and whose consequences are fully known may be proposed separately. '
    +SAME_KEEPER_AFTER_RESULT_GUIDANCE;
export const SAME_KEEPER_OUTPUT_GUIDANCE='For unchanged conversation, begin the final reply with {{public}} and write the public prose directly. '
    +'Ordinary NPC speech or a routine mood alone needs no new event: the accepted dialogue, memory and NPC journal already record the conversation. '
    +'Reuse current capsule, resident material and already returned evidence. Infer ordinary NPC replies from their known personality, knowledge and the current scene; consult source only for a genuinely missing authored fact. '
    +'For module lookup use one exact known handle, name or alias, or issued handles separated by spaces; do not combine several people, places and questions into one search phrase. A miss does not require repeating a broader version of the same query. '
    +'For pure OOC, use {{reference}} without fictional writes. '
    +'For fully specified non-random changes and event records, use the existing private record followed by public text in ONE response: '
    +'a JSON object with version:1, record and text in that order. record contains the existing apply.effects and/or apply.event; omit unused fields. '
    +'Put knowledge and relationships inside record.event. Omit campaign, scope and choice from this ordinary-world frame; use the existing ask tool for a real pending player choice. '
    +'Every event.materials entry requires explicit visibility (player or keeper), including speech. Never infer public visibility from its kind. '
    +'For a chosen destination without an issued route, carry the selected route in via; use establish only for compatible ordinary facts when needed. A known place is not automatically a reachable exit. '
    +'Root text is a string containing public prose directly, without an inner {{public}} marker; it is record\'s sibling, never inside record. Close record before starting text, and close the root object only after text. '
    +'The host applies the private record through the normal transaction before exposing text. An event is record.event, never an effect kind. '
    +'Do not call tools beside this final record. Include only actual selected changes; empty bookkeeping needs no record. '
    +'A selected ordinary object with a known physical description may use define plus object in that same transaction; a new note initializes document.text and presentation and omits document.action. write/append are for an existing carrier. '
    +'An item listed in mods.unregistered_equipment is a possession without an accepted definition. If the selected change needs its object record, include define plus object together using that listed name and physical row. '
    +'If an outcome is unknown, including a roll, missing source or a definition/document prerequisite that cannot be satisfied in the same transaction, use the normal tools first and read their actual results. '
    +SAME_KEEPER_AFTER_RESULT_GUIDANCE+' '
    +'Correct a refusal without repeating settled effects or rolls. Never invent a success or put private reasoning in public text. '
    +'Write the NPC meaning and actual wording once in this same context; no separate expression brief or second author is required. '
    +'Use only the public/reference prefix or the version-1 JSON frame described here. Emit no separate record marker, closing public marker, format placeholder or explanatory preamble. '
    +'After a public or reference prose reply, end the response. Never append {{compose}}, an expression brief, a private envelope or a second frame. '
    +'If a state record is needed, start with the single version-1 JSON frame instead; its text completes that response.';

/** Replace only the product prompt's closed, owned instruction paragraphs. */
export function sameKeeperSystemPrompt(source:string):string{
    const first='You are the Keeper and content planner of this Call of Cthulhu 7th edition table.';
    if(!source.startsWith(first))return source;
    let result='You are the sole Keeper and author of this Call of Cthulhu 7th edition table. Understand the player, current state and each character\'s knowledge; use bounded Jev choices and actual kernel results, then write the public response in this same context.'+source.slice(source.indexOf('\n'));
    const heading='Public response\n\n',after='\n\nKeep hidden motives,';
    const start=result.indexOf(heading),end=start<0?-1:result.indexOf(after,start+heading.length);
    if(start>=0&&end>start)result=result.slice(0,start+heading.length)+SAME_KEEPER_OUTPUT_GUIDANCE+result.slice(end);
    result=result.replace('For prospective replies, speech material.text contains intended meaning rather than finished wording. The isolated author chooses the actual words; an intended utterance is not already heard.',
        'For prospective replies, speech material.text contains the exact public words you will use. Choose them once and reuse them inside the actual speaker\'s say span. An intended utterance is not already heard.');
    const speech='Before recording prospective speech,';
    const speechStart=result.indexOf(speech),speechEnd=speechStart<0?-1:result.indexOf('\n\n',speechStart);
    if(speechStart>=0&&speechEnd>speechStart)result=result.slice(0,speechStart)
        +'For prospective heard knowledge, speech material.text contains the exact public words you will use. Choose them once and reuse them inside the actual speaker\'s say span. Unspoken words remain pending; already acquired player-input knowledge needs no future material binding.'
        +result.slice(speechEnd);
    return result;
}
