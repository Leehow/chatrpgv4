/** Host syntax materialization only; no semantic classification or rule calculation. */
type Row=Record<string,any>;
/** Contract §186.3: the host task fields an author may repeat at the draft's top level; a byte-for-byte repeat is dropped. */
export const TASK_FIELD_COPIES=['task','focus','question','visual_asset','visual_scan','pages'] as const;
/** One change the host made to a draft before checking it: an entry of the check receipt's `normalized` (§186.3). */
export type Normalized={path:string;action:'task_field_copy'|'host_owned'|'critical_reference'|'zero_damage_bonus';value?:unknown};
const plain=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const same=(a:unknown,b:unknown)=>a!==undefined&&JSON.stringify(a)===JSON.stringify(b);
/** The value an author wrote, at most 80 characters, as the draft check's findings show one. */
const written=(value:unknown):unknown=>{
 const text=typeof value==='string'?value:JSON.stringify(value),chars=Array.from(text);
 if(chars.length<=80)return value;
 return chars.slice(0,77).join('')+'...';
};
/**
 * A top-level key repeats the host task when its value is byte for byte the task's field of that name; `task` repeats
 * the task itself when every field it holds is byte for byte the task's field of that name. Nothing is compared by meaning.
 */
function copiesTask(key:string,value:unknown,task:Row):boolean{
 if(key!=='task')return Object.hasOwn(task,key)&&same(value,task[key]);
 return plain(value)&&Object.keys(value).length>0&&Object.entries(value).every(([field,item])=>Object.hasOwn(task,field)&&same(item,task[field]));
}
/**
 * Normalize a candidate in place before the draft check and return what changed. `task` is the job's task.json: its
 * fields a draft repeats at the top level are dropped, and a visual discovery job's coverage is host-owned (`{}`), the
 * author's value listed as replaced (§186.3). A value outside a vocabulary is never mapped here; the check names it.
 */
export function normalizeSourceDraft(draft:Row,task:Row={}):Normalized[]{
 const changed:Normalized[]=[];
 if(!plain(draft))return changed;
 for(const key of TASK_FIELD_COPIES)if(Object.hasOwn(draft,key)&&copiesTask(key,draft[key],task)){
  delete draft[key];changed.push({path:'/'+key,action:'task_field_copy'});
 }
 // A visual scan (navigation, or the asset page it nominated) records no coverage: the host writes it.
 if(task.visual_scan||task.visual_asset){
  if(Object.hasOwn(draft,'coverage')&&!(plain(draft.coverage)&&!Object.keys(draft.coverage).length))
   changed.push({path:'/coverage',action:'host_owned',value:written(draft.coverage)});
  draft.coverage={};
 }
 if(Array.isArray(draft.critical))draft.critical=draft.critical.map((path:unknown,index:number)=>{
  if(typeof path!=='string')return path;
  const match=/^\/(nodes|claims)\/([^/]+)(.*)$/.exec(path);
  if(!match||/^[+-]?\d+$/.test(match[2]))return path;
  const field=match[1]==='nodes'?'node_id':'claim_id',identity=match[2].replaceAll('~1','/').replaceAll('~0','~');
  const hits=(Array.isArray(draft[match[1]])?draft[match[1]]:[]).map((row:Row,index:number)=>({row,index})).filter(({row}:Row)=>row?.[field]===identity);
  if(hits.length!==1)return path;
  const mapped='/'+match[1]+'/'+hits[0].index+match[3];changed.push({path:`/critical/${index}`,action:'critical_reference',value:path});return mapped;
 });
 for(const [index,node] of (Array.isArray(draft.nodes)?draft.nodes:[]).entries()){
  const props=node?.properties,projected=props?.runtime_projection?.record,record=projected??props,derived=record?.mechanics?.profile?.derived;
  if(derived&&typeof derived.DB==='string'&&/^[+-]?0+$/.test(derived.DB.trim())){
   changed.push({path:`/nodes/${index}/properties${projected?'/runtime_projection/record':''}/mechanics/profile/derived/DB`,action:'zero_damage_bonus',value:derived.DB});
   derived.DB=0;
  }
 }
 return changed;
}
