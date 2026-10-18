/** Cast registration is not a population census; the kernel owns clock applicability. */
export function scenePopulationRequired(capsule:Record<string,any>):boolean {
 const temporal=capsule.where?.temporal,people=(capsule.present??[]).filter((row:Record<string,any>)=>row.kind!=='creature');
 if(temporal?.current!==true||!['empty','quiet','active','crowded'].includes(temporal.crowd))return true;
 return temporal.crowd==='empty'?people.length>0:people.length===0;
}
