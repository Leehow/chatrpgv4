/** Bounded public outcomes preserve prerequisite meaning beside existing receipt IDs. */
import {turnPacketResult} from '../../runtime/turn-packet-prototype.ts';
type Row=Record<string,any>;
const kinds=new Set(['move','place','npc','time','item','cash']);
export function settledAdmissionEvidence(result:Row):string|undefined {
 if(!Array.isArray(result.outcomes)||!result.outcomes.length)return;
 const outcomes:Row[]=[];let omitted=0;
 for(const outcome of result.outcomes){
  if(!outcome||!kinds.has(outcome.kind)||!['changed','unchanged'].includes(outcome.status)){omitted++;continue;}
  const projected=turnPacketResult({outcomes:[outcome]}).outcomes[0];
  if(Buffer.byteLength(JSON.stringify([...outcomes,projected]))>8192){omitted++;continue;}
  outcomes.push(projected);
 }
 return JSON.stringify({outcomes,...(omitted?{omitted}:{}),authority:'Actual current-input kernel outcomes only; omitted operations remain unknown.'});
}

export type CompletedTimeEvidence={elapsed_minutes:number;charges:Array<{minutes:number;clock_before:number;clock_after:number}>};
/** Read only current-input kernel time receipts. Missing or inconsistent evidence stays unknown. */
export function settledTimeEvidence(receipts:unknown):CompletedTimeEvidence|undefined {
 if(!Array.isArray(receipts))return;
 const known=new Map<string,string>(),charges:CompletedTimeEvidence['charges']=[];let elapsed=0;
 for(const receipt of receipts){
  if(!receipt||receipt.kind!=='time')continue;
  const {id,minutes,clock_before,clock_after}=receipt;
  if(typeof id!=='string'||!id||![minutes,clock_before,clock_after].every(value=>Number.isSafeInteger(value)&&value>=0)
   ||clock_before+minutes!==clock_after)return;
  const charge={minutes,clock_before,clock_after},identity=JSON.stringify(charge);
  if(known.has(id)){if(known.get(id)!==identity)return;continue;}
  known.set(id,identity);elapsed+=minutes;if(!Number.isSafeInteger(elapsed))return;charges.push(charge);
 }
 return charges.length?{elapsed_minutes:elapsed,charges}:undefined;
}
