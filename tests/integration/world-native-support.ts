import assert from 'node:assert/strict';
/** Collection adapters for one-time mechanically translated world regression assertions. */
export * from './npc-support.ts';
import {openTurn,narrateOpening,seedWound,firstFailure} from './world-support.ts';
import {TestPath,RpcClient as BaseRpcClient,pyDivide as nativeDivide} from './npc-support.ts';
import {pyIsInstance as nativeIsInstance,pyMethod as nativeMethod,pyDict,pyList,pyStr as nativeStr,pyInt,pyMin as nativeMin,pyMax as nativeMax,shutil as nativeShutil} from './npc-support.ts';
import {join,dirname,resolve as resolvePath,relative,parse} from 'node:path';
import {chmodSync,statSync,symlinkSync,mkdtempSync,mkdirSync,globSync,renameSync,copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ROOT,CONTENT_DIR as CONTENT_ROOT} from './support.ts';
export {MODULE} from './support.ts';
class WorldPath extends TestPath{
  get parent(){return new WorldPath(dirname(this.value));}
  get parents(){const rows:WorldPath[]=[];let path=dirname(this.value);while(path!==dirname(path)){rows.push(new WorldPath(path));path=dirname(path);}rows.push(new WorldPath(path));return rows;}
  get stem(){return parse(this.value).name;}
  get parts(){return this.value.split('/').filter(Boolean);}
  resolve(){return new WorldPath(resolvePath(this.value));}
  chmod(mode:number){chmodSync(this.value,mode);}
  stat(){const value=statSync(this.value);return{...value,st_mode:value.mode};}
  relative_to(other:any){return new WorldPath(relative(String(other),this.value));}
  with_name(name:string){return new WorldPath(join(dirname(this.value),name));}
  iterdir(){return super.iterdir().map(path=>new WorldPath(path.value));}
  glob(pattern:string){return globSync(pattern,{cwd:this.value}).map(name=>new WorldPath(join(this.value,name)));}
  with_suffix(suffix:string){const parsed=parse(this.value);return new WorldPath(join(parsed.dir,parsed.name+suffix));}
  rename(target:any){renameSync(this.value,String(target));return new WorldPath(String(target));}
}
export function Path(...values:any[]){return new WorldPath(join(...values.map(String)));}
export const KERNEL_DIR=Path(join(ROOT,'kernel-ts'));
export class RpcClient extends BaseRpcClient{readonly pooled=false;}
export const os={environ:process.env,symlink:(from:any,to:any)=>symlinkSync(String(from),String(to)),chmod:(path:any,mode:number)=>chmodSync(String(path),mode),getpid:()=>process.pid};
export const shutil={...nativeShutil,copyfile:(source:any,target:any)=>{copyFileSync(String(source),String(target));return String(target);}};
export const stat={S_IRUSR:0o400,S_IWUSR:0o200,S_IXUSR:0o100,S_IMODE:(mode:number)=>mode&0o7777};
export const subprocess={run:(argv:any[],options:Row={})=>{
 const result=spawnSync(String(argv[0]),argv.slice(1).map(String),{cwd:options.cwd&&String(options.cwd),env:options.env??process.env,input:options.input,encoding:options.text?'utf8':undefined,timeout:options.timeout?options.timeout*1000:undefined});
 if(result.error)throw result.error;if(options.check&&result.status!==0)throw new Error(`Process exit ${result.status}: ${result.stderr}`);return{stdout:result.stdout,stderr:result.stderr,returncode:result.status};
}};
export const pyType=(value:any)=>({__name__:value?.name??typeof value});
import {snapshot as nativeSnapshot} from './rpc-evidence.ts';
export {readCommand as read_command} from './rpc-evidence.ts';
export const snapshot=(workspace:any)=>nativeSnapshot(String(workspace));
class DateFields{readonly time:Date;constructor(time:Date){this.time=time;}get year(){return this.time.getUTCFullYear();}get month(){return this.time.getUTCMonth()+1;}get day(){return this.time.getUTCDate();}get hour(){return this.time.getUTCHours();}get minute(){return this.time.getUTCMinutes();}}
export const datetime=Object.assign((year:number,month:number,day:number,hour=0,minute=0)=>new DateFields(new Date(Date.UTC(year,month-1,day,hour,minute))),{fromisoformat:(text:string)=>new DateFields(new Date(text.endsWith('Z')?text:text+'Z'))});
export const timedelta=(options:Row={})=>({milliseconds:((options.minutes??0)*60+(options.seconds??0))*1000});
export const pyAdd=(a:any,b:any):any=>Buffer.isBuffer(a)&&Buffer.isBuffer(b)?Buffer.concat([a,b]):a instanceof DateFields?new DateFields(new Date(a.time.getTime()+b.milliseconds)):Array.isArray(a)&&Array.isArray(b)?[...a,...b]:a+b;
export function retainedFixture(_t:any){const root=join(ROOT,'.coc/test-runs');mkdirSync(root,{recursive:true});return(name:string)=>Path(mkdtempSync(join(root,'world-'+name+'-')));}
import type {RpcClient as KernelClient,Row} from './support.ts';
import * as moduleFixtures from './module-support.ts';
export const open_turn=(k:KernelClient,text?:string)=>openTurn(k,text);
export const narrate_opening=(k:KernelClient,text?:string)=>narrateOpening(k,text);
export const written=(rows:Row[])=>rows.filter(row=>row.trigger!=='presence');
export const CONFRONTATION=['corbitt-house-ground','basement-rites','corbitt-confrontation'];
export const seed_wound=(workspace:any,hp:number,options:any={},minutes_ago=0)=>seedWound(String(workspace),hp,Array.isArray(options)?options:options.conditions??[],Array.isArray(options)?minutes_ago:options.minutes_ago??0);
export const pyDivide=(a:any,b:any)=>typeof a==='string'||a instanceof TestPath?Path(join(String(a),String(b))):nativeDivide(a,b);
export const first_failure=(k:KernelClient,prefix:string,action:Row)=>firstFailure(k,prefix,action);
export async function first_success(k:KernelClient,prefix:string,action:Row){for(let n=1;n<=24;n++){const id=prefix+n,result=await k.table('resolve',{call_id:id,action});if(result.outcome.passed)return[id,result];}throw new Error('no success in 24 seeded rolls');}
export const bind=(k:KernelClient,root:any=k.workspace)=>moduleFixtures.bind(k,String(root));
export const indexed=(k:KernelClient,root:any=k.workspace)=>moduleFixtures.indexed(k,String(root));
export const opening=moduleFixtures.opening;
export const finish=moduleFixtures.finish;
export const request=moduleFixtures.request;
export const claim=moduleFixtures.claim;
export const observed=moduleFixtures.observed;
export const write=(path:any,value:unknown)=>moduleFixtures.write(String(path),value);
export const handle_of=moduleFixtures.handleOf;
export const pyMin=(...args:any[]):any=>nativeMin(...args);
export const pyMax=(...args:any[]):any=>nativeMax(...args);
export const pyStr=(value:any)=>value instanceof Error?String(value):nativeStr(value);
export const pyRound=(value:any,digits:any=0)=>Math.round(value*10**digits)/10**digits;
export const copy={deepcopy:(value:any)=>structuredClone(value)};
import {confirmedInvestigator as nativeConfirmedInvestigator} from './setup-support.ts';
export {profile} from './setup-support.ts';
export const confirmed_investigator=(k:KernelClient,campaign:any='c1',name='Ada')=>nativeConfirmedInvestigator(k,typeof campaign==='object'?campaign.campaign??'c1':campaign,typeof campaign==='object'?campaign.name??name:name);
export const pyMultiply=(a:any,b:any):any=>typeof a==='string'?a.repeat(b):Array.isArray(a)?Array.from({length:b},()=>a).flat():a*b;
export const pyLen=(value:any)=>typeof value==='string'?[...value].length:value?.length??value?.size??Object.keys(value).length;
export const pySlice=(value:any,start?:number,end?:number)=>typeof value==='string'?[...value].slice(start,end).join(''):value.slice(start,end);
export const CONFRONTATION_PATH=['corbitt-house-ground','basement-rites','corbitt-confrontation'];
export const pyIsInstance=(value:any,type:any):boolean=>Array.isArray(type)?type.some(t=>pyIsInstance(value,t)):type===pyInt||type===Number?typeof value==='number':type===pyStr?typeof value==='string':nativeIsInstance(value,type);
function ordered(value:any):any{return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;}
export const json={loads:(text:string)=>JSON.parse(text),dumps:(value:any,options:Row={})=>{
  const object=options.sort_keys?ordered(value):value;
  let text=JSON.stringify(object,null,options.indent);
  if(!options.indent){let inString=false,escape=false,out='';for(const c of text){out+=c;if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;}else if(c==='"')inString=true;else if(c===',')out+=(options.separators?.[0]??', ').slice(1);else if(c===':')out+=(options.separators?.[1]??': ').slice(1);}text=out;}
  return options.ensure_ascii===false?text:text.replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}};
export async function pyMethod(obj:any,name:string,args:any[],kwargs:any={}){
  if(typeof obj==='string'&&name==='removeprefix')return obj.startsWith(args[0])?obj.slice(args[0].length):obj;
  if(typeof obj==='string'&&name==='removesuffix')return args[0]&&obj.endsWith(args[0])?obj.slice(0,-args[0].length):obj;
  if(obj===pyDict&&name==='fromkeys')return Object.fromEntries(Array.from(args[0],key=>[String(key),args[1]??null]));
  if(name==='to_json'&&typeof obj.toJson==='function')return obj.toJson();
  if(name==='which'&&args[0]==='node')return process.execPath;
  if(typeof obj==='string'&&['startswith','endswith'].includes(name)&&Array.isArray(args[0]))return args[0].some((text:string)=>name==='startswith'?obj.startsWith(text):obj.endsWith(text));
  if(typeof obj==='string'&&name==='rsplit'){const parts=obj.split(args[0]),count=args[1]??parts.length;if(parts.length<=count+1)return parts;return [parts.slice(0,parts.length-count).join(args[0]),...parts.slice(parts.length-count)];}
  return nativeMethod(obj,name,args,kwargs);
}
export function pyMonkeypatch(t:any){
 const make=()=>{const restores:Array<()=>void>=[];return{setattr:(object:any,key:string,value:any)=>{const name=key==='write_module'?'writeModule':key,prior=object[name];object[name]=value;restores.push(()=>object[name]=prior);},setenv:(key:string,value:string)=>{const prior=process.env[key];process.env[key]=value;restores.push(()=>{if(prior===undefined)delete process.env[key];else process.env[key]=prior;});},restore:()=>{for(const restore of restores.reverse())restore();restores.length=0;}};};
 const base=make();t.after(()=>base.restore());return{...base,context:make};
}
export function pyInvoke(fn:any,positional:any[],keywords:Row={}){
  const signature=fn.__pySignature;
  if(!signature)return fn(...positional,...(Object.keys(keywords).length?[keywords]:[]));
  const args:any[]=[],remaining={...keywords};let index=0;
  for(const parameter of signature){if(parameter.rest){args.push(remaining);break;}if(parameter.varargs){args.push(positional.slice(index));index=positional.length;continue;}if(index<positional.length)args.push(positional[index++]);else{args.push(remaining[parameter.name]);delete remaining[parameter.name];}}
  return fn(...args);
}

export function exactlyOne(rows:any[]):any[]{assert.equal(rows.length,1,'The original single-row unpack requires exactly one row');return rows;}
