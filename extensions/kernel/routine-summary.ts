/** Contract §247.4: the routine summary the sole author renders, with the locked provider's author section. */
import type {RoutineSummary} from '../../runtime/turn-packet-prototype.ts';
type Row=Record<string,any>;
export const ROUTINE_AUTHOR_HEADING='Routine summary for the author';
/** A packet's routine element needs the active capability (§247.3). Its time is the Keeper's judgment (§249, §250.8):
 *  a missing or a second charge is recorded by `routineCharge`, never refused. */
export function routineRefusal(capsule:Row,routine:RoutineSummary|undefined,_effects:readonly Row[]=[],_journeySettled=false,_earlierCharges=0):{reason:string;message:string}|undefined {
 if(!routine)return;
 if(!capsule.mods?.routine_summary)return {reason:'routine_summary_inactive',message:'No active package issues a routine summary this turn; settle the acts or omit routine.'};
}
/** How this input's time charges the routine stretch: the packet's time commands, earlier time receipts or the settled journey. */
export function routineCharge(routine:RoutineSummary|undefined,effects:readonly Row[],journeySettled:boolean,earlierCharges=0):'none'|'look'|'charged'|'uncharged'|'several' {
 if(!routine)return 'none';
 // §250.4: a look at ambient things alone is no routine stretch to charge (live el-v2-20261021b T13).
 if(!routine.acts?.length)return 'look';
 if(journeySettled)return 'charged';
 const charges=effects.filter(effect=>effect.kind==='time').length+earlierCharges;
 return charges===0?'uncharged':charges===1?'charged':'several';
}
export async function routineDescription(capsule:Row,routine:RoutineSummary,read:(keys:string[])=>Promise<Row>):Promise<Row> {
 const provider=capsule.mods?.routine_summary;
 const owner=capsule.mods?.instructions?.find((row:Row)=>row.mod===provider?.mod&&row.version===provider?.version);
 const section=owner?.sections?.find((row:Row)=>row.heading===ROUTINE_AUTHOR_HEADING);
 if(typeof section?.key!=='string')throw Error('The locked routine summary section is unavailable');
 const result=await read([section.key]);
 const selected=result.sections?.find((row:Row)=>row.key===section.key&&row.mod===provider.mod&&row.version===provider.version&&row.heading===ROUTINE_AUTHOR_HEADING);
 if(typeof selected?.text!=='string'||!selected.text.trim())throw Error('The locked routine summary section is unavailable');
 return {acts:[...(routine.acts??[])],...(routine.ambient?.length?{ambient:routine.ambient.map(row=>({target:row.target,...(row.notes?.length?{notes:[...row.notes]}:{})}))}:{}),
  mod:provider.mod,version:provider.version,key:section.key,instruction:selected.text};
}
