/** Cast registration is not a population census; the kernel owns clock applicability. */
export function scenePopulationRequired(capsule:Record<string,any>):boolean {
 const temporal=capsule.where?.temporal,people=(capsule.present??[]).filter((row:Record<string,any>)=>row.kind!=='creature');
 if(temporal?.current!==true||!['empty','quiet','active','crowded'].includes(temporal.crowd))return true;
 return temporal.crowd==='empty'?people.length>0:people.length===0;
}
/**
 * §250.6: a current empty assessment while a registered person is seated here. Only this contradicts the cast and needs
 * the Keeper's new assessment before prose; a populated scene with nobody registered is an unnamed crowd, and a missing
 * or expired assessment is recorded as unknown.
 */
export function scenePopulationConflict(capsule:Record<string,any>):boolean {
 const temporal=capsule.where?.temporal,people=(capsule.present??[]).filter((row:Record<string,any>)=>row.kind!=='creature');
 return temporal?.current===true&&temporal.crowd==='empty'&&people.length>0;
}
/** An expired optional view is unknown, not a reason to replay a settled stationary activity. */
export function sceneAssessmentExpiredDuringActivity(before:Record<string,any>,after:Record<string,any>,effects:Record<string,any>[]):boolean {
 const from=before.where??{},to=after.where??{},a=from.clock??{},b=to.clock??{};
 const date=(clock:Record<string,any>)=>typeof clock.at==='string'?clock.at.slice(0,10):Number.isInteger(clock.day)?clock.day:undefined;
 return !scenePopulationRequired(before)&&typeof from.scene==='string'&&from.scene===to.scene
  &&to.temporal?.current===false&&Number.isFinite(a.minutes)&&Number.isFinite(b.minutes)&&b.minutes>a.minutes
  &&date(a)!==undefined&&date(a)===date(b)&&typeof a.day_part==='string'&&a.day_part===b.day_part
  &&effects.some(effect=>effect.kind==='time')&&!effects.some(effect=>effect.kind==='move');
}
