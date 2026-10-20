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
