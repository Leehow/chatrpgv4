/** Locked instruction routing, independent of package names or natural language. */
type Row=Record<string,any>;
/** Retire only known direct-author protocol sentences in the private request copy. */
export function keeperCapsuleHead(head:unknown,split:boolean):unknown {
 if(!split||typeof head!=='string')return head;
 return head.replace(
  'Read actual tool results before claiming their consequences, then write the final public response yourself. No separate prose author, material check or output handoff is needed.',
  'Read actual tool results before claiming their consequences, then select the remaining actions and communication through the current output contract. The sole prose author writes the public response; do not draft that prose here.')
 .replace(
  'so do not write this turn as if none of it happened; say what landed, in your own prose, ',
  'so select those actual settled consequences for output without repeating their effects; ')
 .replace(
  "Write what the book describes of the place, and of each person their looks, dress and manner, in this reply, in the play language, along the eye's path, before the turn's business.",
  'The sole prose author renders these supplied appearances in the public reply; the decision agent preserves their source and disclosure bounds.')
 .replace(
  'when they first come into view, give them one in your own words, in keeping with the place and the period (build, apparent age, dress, what their hands are doing, how they carry themselves);',
  'the sole prose author supplies a compatible first appearance when they come into view, within the place, period and selected action;');
}
/** Protected prior turns and degraded requests retain facts, not obsolete delivery duties. */
export function keeperCapsuleMessage(message:Row,split:boolean):Row {
 if(!split||message.role!=='custom'||!['coc-capsule','coc-capsule-update'].includes(message.customType)||typeof message.content!=='string')return message;
 let view:Row;try{view=JSON.parse(message.content);}catch{return message;}
 if(!view||typeof view!=='object'||typeof view.head!=='string')return message;
 const head=keeperCapsuleHead(view.head,true);
 const prior=view.kind==='capsule_update'?view.sections?.head:undefined;
 const sectionHead=keeperCapsuleHead(prior,true),changed=sectionHead!==prior;
 return head===view.head&&!changed?message:{...message,content:JSON.stringify({...view,head,
  ...(changed?{sections:{...view.sections,head:sectionHead}}:{})})};
}
