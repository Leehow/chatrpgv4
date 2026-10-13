/** Shared native setup-test fixtures; no production rule calculation lives here. */
export * from './npc-support.ts';
export {profile} from './setup-support.ts';
import {profile} from './setup-support.ts';
import {CAMPAIGN,ROOT,importSource,readJson} from './support.ts';
import {join,dirname} from 'node:path';
import {renameSync} from 'node:fs';
import {Path,TestPath,pyDivide as nativeDivide,pyDict as nativeDict,pyContains as nativeContains,pyEqual,pyMethod as nativeMethod} from './npc-support.ts';
export async function pyMethod(value:any,name:string,args:any[],options:any={}){
  if(name==='with_name'&&value instanceof TestPath)return Path(join(dirname(String(value)),String(args[0])));
  if(name==='rename'&&value instanceof TestPath){renameSync(String(value),String(args[0]));return Path(String(args[0]));}
  if(name==='index'){const index=Array.isArray(value)?value.findIndex(item=>pyEqual(item,args[0])):value.indexOf(args[0]);if(index<0)throw new Error('Value is not present');return index;}
  if(name==='discard'&&value instanceof Set){for(const item of value)if(pyEqual(item,args[0]))value.delete(item);return;}
  return nativeMethod(value,name,args,options);
}
export {MODULE} from './support.ts';
export const KERNEL_DIR=Path(join(ROOT,'kernel-ts'));
export const pyContains=(value:any,key:any)=>value instanceof Set?[...value].some(item=>pyEqual(item,key)):nativeContains(value,key);
export const frozenset=(value:Iterable<any>)=>new Set(value);
export async function SetupSteps(path:any){const native=await importSource('kernel-ts/setup/steps.ts');return new native.SetupSteps(String(path),readJson(String(path)));}
export async function playability_check(graph:any){
  const [{ModuleGraph},{playability}]=await Promise.all([importSource('kernel-ts/read/module-graph.ts'),importSource('kernel-ts/write/source.ts')]);
  const contract=readJson(join(ROOT,'content/modules/module-graph-contract-v3.json')),template=readJson(join(ROOT,'content/modules/module-graph-template-v1.json')),dossier=contract.actor_dossier;
  return playability(graph,new ModuleGraph(graph.module_id??'fixture',graph,'',dossier),template,dossier);
}
export const pyDict=(value:any={},options:any={})=>({...nativeDict(value),...options});
export const pyDivide=(left:any,right:any)=>typeof left==='string'||left instanceof TestPath?Path(join(String(left),String(right))):nativeDivide(left,right);
export const copy={deepcopy:<T>(value:T):T=>structuredClone(value)};
export const pyReversed=(value:any[])=>[...value].reverse();
export const math=Math;
async function extremum(maximum:boolean,values:any[]){
  const tail=values.at(-1),options=tail&&typeof tail==='object'&&!Array.isArray(tail)&&typeof tail.key==='function'?values.pop():{};
  const list=values.length===1&&typeof values[0]!=='number'?[...values[0]]:values;
  if(!list.length)throw new Error('Empty extremum');
  let winner=list[0],key=options.key?await options.key(winner):winner;
  for(const value of list.slice(1)){const candidate=options.key?await options.key(value):value;if(maximum?candidate>key:candidate<key){winner=value;key=candidate;}}
  return winner;
}
export const pyMin=(...values:any[])=>extremum(false,values);
export const pyMax=(...values:any[])=>extremum(true,values);
export async function first_failure(client:any,prefix:string,action:any){
  for(let n=1;n<25;n++){const id=prefix+n,result=await client.table('resolve',{call_id:id,action});if(!result.outcome.passed&&result.outcome.level!=='fumble')return [id,result];}
  throw new Error('No ordinary failure in 24 seeded rolls');
}
export async function first_success(client:any,prefix:string,action:any){
  for(let n=1;n<25;n++){const id=prefix+n,result=await client.table('resolve',{call_id:id,action});if(result.outcome.passed)return [id,result];}
  throw new Error('No success in 24 seeded rolls');
}
export async function begin(client:any){
  await client.ok('campaign.create',{id:CAMPAIGN,module:'the-haunting',play_language:'en'});
  return client.ok('setup.draft',{campaign:CAMPAIGN,profile:profile()});
}
