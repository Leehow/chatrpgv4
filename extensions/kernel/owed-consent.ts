/** Separate a delivered recovery's authority from the current declaration. */
import {createHash} from 'node:crypto';
import {KernelError} from './client.ts';
type Row=Record<string,any>;
export function owedConsentPlan(effects:Row[],capsule:Row,_playerText:string):{effects:Row[];sources:Array<Row|null>;told:string[];identity:string} {
 const checked:Row[]=[],sources:Array<Row|null>=[],told:string[]=[],bindings:Row[]=[];
 for(const effect of effects){
  if(typeof effect.owed!=='string'){checked.push(effect);sources.push(null);continue;}
  const source=(capsule._context?.owed_sources??[]).find((row:Row)=>row.name===effect.owed);
  const open=(capsule.owed??[]).find((row:Row)=>row.name===effect.owed);
  const refuse=(reason:string)=>{throw new KernelError({code:'invalid_params',message:'Owed recovery source or position is unavailable',
   details:{reason,owed:effect.owed,recovery:'refresh_context'}});};
  if(!open||!source||typeof source.commit!=='string'||!source.commit||!Number.isSafeInteger(source.turn))refuse('owed_source_stale');
  bindings.push(source);
  if(source.mode==='effect'&&source.effect?.kind===effect.kind){told.push(effect.owed);continue;}
  if(source.mode!=='departure'||effect.kind!=='move'||typeof source.player_text!=='string'||!source.player_text.trim())refuse('owed_source_unresolved');
  if(source.from!==capsule.where?.scene)refuse('owed_position_stale');
  checked.push(effect);sources.push(source);
 }
 return {effects:checked,sources,told,identity:bindings.length?createHash('sha256').update(JSON.stringify([capsule._context?.worldline,capsule._context?.loop,bindings])).digest('hex'):'current'};
}
