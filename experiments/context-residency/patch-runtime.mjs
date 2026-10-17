/** Isolated compiled experiment only. Never call this on the repository build or an App. */
import {reclamationPlan} from './reclamation.mjs';
export const SNAPSHOT_TYPE='coc-residency-prototype';
const once=(source,before,after)=>{
  if(source.split(before).length!==2)throw Error('Prototype patch anchor must occur exactly once: '+before);
  return source.replace(before,after);
};
export function journalSnapshotSource(source){
  return once(source,"'coc-prescreen','coc-workspace'","'coc-prescreen','coc-workspace','"+SNAPSHOT_TYPE+"'");
}
export function compiledTablePrototype(source){
  const extended=once(source,'"coc-prescreen", "coc-workspace"]','"coc-prescreen", "coc-workspace", "'+SNAPSHOT_TYPE+'"]');
  const anchor='    if (singleKeeper && policyFor(ctx.model) && !result.degraded && !result.overCeiling && !omission) {';
  const hook=`    // Isolated residency experiment: the ordinary journal still packs and commits the final view.
    if (!result.degraded && !result.overCeiling && !omission) {
      const residency = {messages: outgoing, binding: snapshot.binding, capsule: snapshot.capsule, ctx, project: undefined};
      pi.events.emit('coc:residency-projection', residency);
      if (typeof residency.project === 'function') {
        const supplied = await residency.project();
        if (ticket !== generation || preparationSignal.aborted) return superseded();
        if (supplied && Array.isArray(supplied.messages) && requestSize(supplied.messages) + systemBytes <= ceiling) outgoing = supplied.messages;
      }
    }
`;
  return once(extended,anchor,hook+anchor);
}

/** Stage 2 reuses the owner's existing projection; it never appends another source snapshot. */
export function journalRepairSource(source,{compiled=false,enabled='true'}={}){
  let result=source;
  if(compiled){
    result=once(result,'const state = { key: input.key, turn: input.turn, budget:',
      'const state = { key: input.key, turn: input.turn, checkpointTurn: input.turn, budget:');
  }else{
    result=once(result,'type State={key:string;turn:number;','type State={key:string;turn:number;checkpointTurn:number;');
    result=once(result,'const state:State={key:input.key,turn:input.turn,','const state:State={key:input.key,turn:input.turn,checkpointTurn:input.turn,');
  }
  const anchor=compiled?'    if (requestSize(next.messages) > input.budget) return checkpoint2("capacity");'
    :"    if(requestSize(next.messages)>input.budget)return checkpoint('capacity');";
  const checkpoint=compiled?'checkpoint2':'checkpoint';
  const reclaim=`
    if (${enabled}) {
      const reclaim = reclamationPlan(committed, input, next.messages, requestSize);
      if (reclaim) {
        const projected = ${checkpoint}('residency_reclaim');
        if (projected.observation.reset === 'residency_reclaim') Object.assign(projected.observation, reclaim,
          {reclaimed_bytes: reclaim.pre_reclaim_bytes-requestSize(projected.messages)});
        return projected;
      }
    }`;
  return reclamationPlan.toString()+'\n'+once(result,anchor,anchor+reclaim);
}

export function compiledTableRepair(source){
  const repaired=journalRepairSource(source,{compiled:true,enabled:"process.env.PI_COC_RESIDENCY_PROTOTYPE === 'on'"});
  const anchor='    if (singleKeeper && policyFor(ctx.model) && !result.degraded && !result.overCeiling && !omission) {';
  const hook=`    // Isolated stage 2: observe the admitted owner projection, before journal packing.
    if (!result.degraded && !result.overCeiling && !omission) {
      const residency = {messages: outgoing, binding: snapshot.binding, capsule: snapshot.capsule, ctx,
        key: JSON.stringify([snapshot.binding.campaign,snapshot.binding.worldline,snapshot.binding.loop,moduleId,ctx.model?.provider,ctx.model?.id,systemDigest]),
        budget: Math.max(0,Math.min(ceiling,available*BYTES_PER_TOKEN)-systemBytes), project: undefined};
      pi.events.emit('coc:residency-projection', residency);
      if (typeof residency.project === 'function') {
        const supplied = await residency.project();
        if (ticket !== generation || preparationSignal.aborted) return superseded();
        if (supplied && Array.isArray(supplied.messages) && requestSize(supplied.messages) + systemBytes <= ceiling) outgoing = supplied.messages;
      }
    }
`;
  return once(repaired,anchor,hook+anchor);
}
