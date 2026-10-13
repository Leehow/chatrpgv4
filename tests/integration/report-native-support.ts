/** Filesystem and captured-output fixtures for native read-only report tools. */
export * from './setup-native-support.ts';
import {TestPath,pyMethod as baseMethod,pyDivide as baseDivide,pyEqual as baseEqual} from './setup-native-support.ts';
import {dirname,join} from 'node:path';
import {statSync} from 'node:fs';
class ReportPath extends TestPath{get parent(){return new ReportPath(dirname(this.value));}}
export const Path=(value:any)=>new ReportPath(String(value));
export const pyDivide=(left:any,right:any)=>typeof left==='string'||left instanceof TestPath?Path(join(String(left),String(right))):baseDivide(left,right);
export async function pyMethod(value:any,name:string,args:any[],options:any={}){
  if(name==='insert'&&Array.isArray(value)){value.splice(args[0],0,args[1]);return;}
  if(name==='stat'&&value instanceof TestPath){const stats=statSync(String(value),{bigint:true});return {st_size:stats.size,st_mtime_ns:stats.mtimeNs};}
  return baseMethod(value,name,args,options);
}
export const approximations={approx:(value:number)=>({nativeApproximation:true,value,relative:1e-6,absolute:1e-12})};
export const pyEqual=(left:any,right:any):boolean=>right?.nativeApproximation?typeof left==='number'&&Math.abs(left-right.value)<=Math.max(right.absolute,right.relative*Math.abs(right.value)):left?.nativeApproximation?pyEqual(right,left):baseEqual(left,right);
export function captureOutput(t:any){let out='';t.mock.method(console,'log',(...values:any[])=>{out+=values.map(String).join(' ')+'\n';});return {readouterr(){const result={out,err:''};out='';return result;}};}
