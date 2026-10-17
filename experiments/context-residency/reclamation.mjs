/** Exact structural admission only. No semantic relevance or world-state caching. */
export function reclamationPlan(previous,input,nextMessages,measure){
  if(input.turn<=previous.turn)return;
  const capsule=message=>{
    try{return JSON.parse(message.content);}catch{return {};}
  };
  const current=input.messages.find(message=>message.customType==='coc-capsule');
  const before=previous.snapshots.get('coc-capsule');
  // These are owner-issued identities, never a linguistic scene classifier.
  const focus=value=>JSON.stringify([value?.where?.scene??null,
    (value?.present??[]).map(person=>person.id??person.name).sort()]);
  const focusChanged=!!current&&!!before&&focus(capsule(current))!==focus(before);
  if(!focusChanged&&input.turn-(previous.checkpointTurn??previous.turn)<2)return;
  const retained=measure(nextMessages),fresh=measure(input.messages),saved=retained-fresh;
  // Hysteresis pays for prefix invalidation only after material savings are substantial.
  if(saved<32*1024||saved/retained<0.25)return;
  return {pre_reclaim_bytes:retained,fresh_bytes:fresh,estimated_reclaimed_bytes:saved,focus_changed:focusChanged};
}
