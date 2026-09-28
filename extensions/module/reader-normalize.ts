/** Host syntax materialization only; no semantic classification or rule calculation. */
type Row=Record<string,any>;
export function normalizeSourceDraft(draft:Row):string[]{
 const changed:string[]=[];
 if(Array.isArray(draft.critical))draft.critical=draft.critical.map((path:unknown)=>{
  if(typeof path!=='string')return path;
  const match=/^\/(nodes|claims)\/([^/]+)(.*)$/.exec(path);
  if(!match||/^[+-]?\d+$/.test(match[2]))return path;
  const field=match[1]==='nodes'?'node_id':'claim_id',identity=match[2].replaceAll('~1','/').replaceAll('~0','~');
  const hits=(draft[match[1]]??[]).map((row:Row,index:number)=>({row,index})).filter(({row}:Row)=>row[field]===identity);
  if(hits.length!==1)return path;
  const mapped='/'+match[1]+'/'+hits[0].index+match[3];changed.push('critical_reference');return mapped;
 });
 for(const node of Array.isArray(draft.nodes)?draft.nodes:[]){
  const props=node?.properties,record=props?.runtime_projection?.record??props,derived=record?.mechanics?.profile?.derived;
  if(derived&&typeof derived.DB==='string'&&/^[+-]?0+$/.test(derived.DB.trim())){derived.DB=0;changed.push('zero_damage_bonus');}
 }
 return changed;
}
