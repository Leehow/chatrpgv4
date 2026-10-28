/** Native migration conveniences for paths, collections, and RPC fixtures. */
import assert from 'node:assert/strict';
import {nativeStorageFixture} from './storage-support.ts';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {join,dirname,basename,relative,extname} from 'node:path';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,rmSync,cpSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {RpcClient as NativeRpcClient,ROOT,CONTENT_DIR as CONTENT_ROOT,CAMPAIGN,PREGEN,readJson,readJsonl,createCampaign,openTurn,type Row} from './support.ts';
import {walkToConfrontation} from './mod-fixtures.ts';
export {CAMPAIGN,PREGEN};
export const OPENING_SCENE='commission-briefing';
export class TestPath{
  readonly value:string;constructor(value:string){this.value=value;}
  toString(){return this.value;}
  get name(){return basename(this.value)}get suffix(){return extname(this.value)}get parent(){return new TestPath(dirname(this.value))}
  exists(){return existsSync(this.value)}is_file(){return this.exists()&&statSync(this.value).isFile()}is_dir(){return this.exists()&&statSync(this.value).isDirectory()}
  read_text(){return readFileSync(this.value,'utf8')}read_bytes(){return readFileSync(this.value)}
  write_text(text:string){writeFileSync(this.value,text);return text.length}write_bytes(bytes:any){writeFileSync(this.value,bytes);return bytes.length}
  mkdir(options:Row={}){mkdirSync(this.value,{recursive:options.parents??false})}unlink(){rmSync(this.value)}
  iterdir(){return readdirSync(this.value).sort().map(x=>new TestPath(join(this.value,x)))}
  glob(pattern:string){return this.iterdir().filter(x=>pattern==='*'||(pattern.startsWith('*.')&&x.value.endsWith(pattern.slice(1)))||x.name===pattern)}
  rglob(pattern:string){const result:TestPath[]=[];for(const p of this.iterdir()){if(pattern==='*'||(pattern.startsWith('*.')&&p.value.endsWith(pattern.slice(1))))result.push(p);if(p.is_dir())result.push(...p.rglob(pattern));}return result}
  relative_to(other:any){return new TestPath(relative(String(other),this.value))}as_posix(){return this.value}
}
export const Path=(value:any)=>new TestPath(String(value));
export const CONTENT_DIR=Path(CONTENT_ROOT),WORKTREE=Path(ROOT);
export class RpcClient extends NativeRpcClient{constructor(workspace:any,options:any={}){super(String(workspace),{...options,content:options.content&&String(options.content)})}}
export const campaign_dir=(workspace:any,campaign=CAMPAIGN)=>Path(join(String(workspace),'.coc/campaigns',campaign));
export const repo_dir=(workspace:any,campaign=CAMPAIGN)=>Path(join(String(workspace),'.coc/repos',campaign+'.git'));
export const read_json=(path:any)=>readJson(String(path));export const read_jsonl=(path:any)=>readJsonl(String(path));
export const create_campaign=(client:any,campaign=CAMPAIGN)=>createCampaign(client,campaign);
export async function open_turn(client:any,text='我仔细观察诺特。'){await createCampaign(client);await narrate_opening(client);return client.table('player_input',{text})}
export async function narrate(client:any,call_id:string,text:string,extra:any={}){return client.table('narrate',{call_id,text,...extra})}
export async function narrate_opening(client:any,text='开场。\n\n诺特把钥匙拍在桌上。'){await client.table('open');return narrate(client,'t0-c1',text)}
export const resolve=(client:any,call_id:string,action:any={})=>client.table('resolve',{call_id,action});
export const resolve_err=(client:any,call_id:string,action:any={})=>client.tableErr('resolve',{call_id,action});
export const walk_to_confrontation=walkToConfrontation;
/** Keep every genuine action receipt, including hidden checks; portrayal initialization is technical context. */
export const ordinaryReceipts=(rows:Row[])=>rows.filter(receipt=>receipt.family!=='npc-variation');
export const written=(rows:any[])=>ordinaryReceipts(rows).filter(x=>x.trigger!=='presence');
/** Ordinary card assertions retain the complete audit separately and hide only exact initialization ids. */
export function ordinaryMechanics(mechanics:Row[],receipts:Row[]):Row[]{
  const initialization=receipts.filter(receipt=>receipt.family==='npc-variation');
  const ids=new Set(initialization.map(receipt=>receipt.id));
  for(const receipt of initialization){assert.equal(receipt.kind,'roll');assert.equal(receipt.visibility,'keeper');}
  const portrayal=mechanics.filter(card=>ids.has(card.receipt));
  assert.deepEqual(portrayal.map(card=>card.receipt).sort(),initialization.map(receipt=>receipt.id).sort(),
    'Every canonical portrayal initialization retains its private audit card');
  for(const card of portrayal){assert.equal(card.family,'npc-variation');assert.equal(card.visibility,'keeper');}
  assert.ok(mechanics.filter(card=>card.family==='npc-variation').every(card=>ids.has(card.receipt)),
    'No portrayal card may lack its canonical initialization receipt');
  return mechanics.filter(card=>!ids.has(card.receipt));
}
export const git_log=(workspace:any,campaign=CAMPAIGN)=>execFileSync('git',[`--git-dir=${repo_dir(workspace,campaign)}`,'log','--format=%s'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
export function temporaryPath(t:any){const p=nativeStorageFixture(t);return Path(p)}
export const pyStr=(value:any)=>typeof value==='string'?value:value instanceof TestPath?value.value:typeof value==='object'?JSON.stringify(value):String(value);
export const pyLen=(v:any)=>typeof v==='string'?[...v].length:v?.length??v?.size??Object.keys(v).length;
export const pyBool=(v:any)=>v!=null&&(v instanceof TestPath?true:typeof v==='object'?pyLen(v)>0:Boolean(v));
export const pyInt=(v:any)=>Math.trunc(Number(v));
export const pyIterable=(v:any):any[]=>v instanceof Map?[...v.keys()]:v instanceof Set?[...v]:typeof v==='string'?[...v]:Array.isArray(v)?v:Object.keys(v);
export const pyList=(v:any=[])=>pyIterable(v);export const pySet=(v:any=[])=>new Set(pyIterable(v).filter((x,i,all)=>all.findIndex(y=>pyEqual(x,y))===i));export const pyDict=(v:any={},keywords:any={})=>({...Array.isArray(v)?Object.fromEntries(v):v,...keywords});
export async function pySorted(v:any,options:any={}){const entries=await Promise.all(pyIterable(v).map(async value=>({value,key:options.key?await options.key(value):value})));entries.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);const result=entries.map(x=>x.value);return options.reverse?result.reverse():result}
export function pyRange(a:number,b?:number,step=1){if(b===undefined){b=a;a=0}const out:number[]=[];for(let i=a;step>0?i<b:i>b;i+=step)out.push(i);return out}
export const pyEnumerate=(v:any,start:any=0)=>pyIterable(v).map((x,i)=>[i+(typeof start==='object'?start.start: start),x]);
export const pyIsInstance=(v:any,type:any)=>type===pyInt?(typeof v==='boolean'||Number.isInteger(v)):type===pyBool?typeof v==='boolean':type===pyDict?v!==null&&typeof v==='object'&&!Array.isArray(v):type===pyList?Array.isArray(v):type===pyStr?typeof v==='string':v instanceof type;
export const pyAny=(v:any)=>pyIterable(v).some(pyBool);export const pyAll=(v:any)=>pyIterable(v).every(pyBool);export const pySum=(v:any)=>pyIterable(v).reduce((a,b)=>a+b,0);
export function pyNext(v:any,fallback?:any){const rows=pyIterable(v);if(rows.length)return rows[0];if(arguments.length>1)return fallback;throw Error('Empty iterator')};
export const pyFormat=(v:any,format:string)=>format.endsWith('d')?String(v).padStart(Number(format.slice(0,-1)),'0'):String(v);
export const pyAt=(v:any,k:any)=>Array.isArray(v)&&typeof k==='number'&&k<0?v[v.length+k]:v[k];
export const pySlice=(v:any,start?:number,end?:number,step=1)=>{if(step===1)return v.slice(start,end);const out:any[]=[];for(let i=start??(step<0?v.length-1:0);step<0?i>(end??-1):i<(end??v.length);i+=step)out.push(v[i]);return typeof v==='string'?out.join(''):out};
export const pyEqual=(a:any,b:any)=>isDeepStrictEqual(a,b);
export const pyContains=(v:any,k:any)=>v instanceof Set?[...v].some(x=>pyEqual(x,k)):Array.isArray(v)?v.some(x=>pyEqual(x,k)):typeof v==='string'?v.includes(k):Object.hasOwn(v,k);
export const pyDivide=(a:any,b:any):any=>a instanceof TestPath||typeof a==='string'&&typeof b==='string'?Path(join(String(a),String(b))):a/b;
export const pyAdd=(a:any,b:any):any=>Array.isArray(a)&&Array.isArray(b)?[...a,...b]:a+b;
export const pyMultiply=(a:any,b:any):any=>typeof a==='string'?a.repeat(b):Array.isArray(a)?Array.from({length:b},()=>a).flat():a*b;
export const pyUnion=(a:any,b:any):any=>a instanceof Set&&b instanceof Set?pySet([...a,...b]):typeof a==='number'&&typeof b==='number'?(a|b):({...a,...b});export const pyIntersection=(a:any,b:any)=>pySet([...a].filter(x=>pyContains(b,x)));
export const deepcopy=(v:any)=>structuredClone(v);
export const json={loads:(s:any)=>JSON.parse(s),dumps:(v:any,options:any={})=>pyJson(v,options)};
export const hashlib={sha256:(data:any)=>({hexdigest:()=>createHash('sha256').update(data).digest('hex')})};
export const shutil={copytree:(src:any,dst:any)=>{cpSync(String(src),String(dst),{recursive:true});return dst},copy2:(src:any,dst:any)=>{cpSync(String(src),String(dst));return dst}};
export const re={I:'i',sub:(pattern:string,replacement:string,text:string)=>text.replace(new RegExp(pattern,'gu'),replacement),compile:(s:string)=>new RegExp(s,'u'),match:(pattern:string,text:string)=>new RegExp(pattern,'u').exec(text),search:(pattern:string,text:string,flags='')=>new RegExp(pattern,'u'+flags).exec(text),findall:(pattern:string,text:string)=>[...text.matchAll(new RegExp(pattern,'gu'))].map(x=>x.length>1?x[1]:x[0]),fullmatch:(pattern:string,text:string)=>new RegExp('^(?:'+pattern+')$','u').exec(text)};
export function Counter(v:any){const result=Object.fromEntries([...new Set(v)].map(x=>[String(x),v.filter((y:any)=>pyEqual(x,y)).length]));Object.defineProperty(result,'most_common',{value:(n:number)=>Object.entries(result).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,n)});return result}
export function pyParametrize(names:string|string[],rows:any[]){const keys=Array.isArray(names)?names:names.split(',').map(x=>x.trim());return rows.map(row=>Object.fromEntries(keys.map((k,i)=>[k,keys.length===1?row:row[i]])))}
export const pyMonkeypatch=(t:any)=>({setenv:(key:string,value:string)=>{const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old})},setattr:(obj:any,key:string,value:any)=>{const old=obj[key];obj[key]=value;t.after(()=>obj[key]=old)}});
export async function pyMethod(obj:any,name:string,args:any[],kwargs:any={}){
  if(obj instanceof NativeRpcClient){if(name==='table'||name==='table_err')return name==='table'?obj.table(args[0],{...(args[1]??{}),...kwargs}):obj.tableErr(args[0],{...(args[1]??{}),...kwargs});return (obj as any)[name](...args)}
  if(obj instanceof TestPath)return (obj as any)[name](...args,...(Object.keys(kwargs).length?[kwargs]:[]));
  if(name==='decode'&&Buffer.isBuffer(obj))return obj.toString((args[0]??'utf8').replaceAll('-',''));
  if(name==='issubset')return pyLessEqual(pySet(obj),pySet(args[0]));if(name==='issuperset')return pyLessEqual(pySet(args[0]),pySet(obj));
  if(obj instanceof Map){if(name==='items')return [...obj.entries()];if(name==='keys')return [...obj.keys()];if(name==='values')return [...obj.values()];if(name==='get')return obj.has(args[0])?obj.get(args[0]):args[1]??null;}
  if(name==='get')return Object.hasOwn(obj,args[0])?obj[args[0]]:args[1]??null;
  if(name==='setdefault')return Object.hasOwn(obj,args[0])?obj[args[0]]:(obj[args[0]]=args[1]??null);
  if(name==='update'){Object.assign(obj,args[0]??{},kwargs);return;}
  if(name==='items')return Object.entries(obj);if(name==='keys')return Object.keys(obj);if(name==='values')return Object.values(obj);
  if(name==='append'){obj.push(args[0]);return;}if(name==='extend'){obj.push(...args[0]);return;}if(name==='add'){obj.add(args[0]);return;}
  if(name==='index'){const index=Array.isArray(obj)?obj.findIndex((x:any)=>pyEqual(x,args[0])):obj.indexOf(args[0]);if(index<0)throw Error('value is not in sequence');return index;}
  if(name==='count')return obj.filter((x:any)=>pyEqual(x,args[0])).length;
  if(name==='pop'){if(Array.isArray(obj))return args.length?obj.splice(args[0],1)[0]:obj.pop();let v=obj[args[0]];delete obj[args[0]];return v??args[1];}
  if(name==='startswith')return (Array.isArray(args[0])?args[0]:[args[0]]).some(x=>obj.startsWith(x));if(name==='endswith')return (Array.isArray(args[0])?args[0]:[args[0]]).some(x=>obj.endsWith(x));if(name==='strip')return obj.trim();if(name==='lower')return obj.toLowerCase();
  if(name==='split'&&typeof obj==='string'){const separator=args[0],maximum=args[1]??-1;if(separator==null)return obj.trim().split(/\s+/);if(separator==='')throw Error('empty separator');if(maximum<0)return obj.split(separator);const out:string[]=[];let start=0;for(let i=0;i<maximum;i++){const at=obj.indexOf(separator,start);if(at<0)break;out.push(obj.slice(start,at));start=at+separator.length;}out.push(obj.slice(start));return out;}
  if(name==='format'){let index=0;return obj.replace(/\{([^{}]*)\}/g,(_m:string,field:string)=>{const [key,format]=field.split(':');const value=key===''?args[index++]:/^\d+$/.test(key)?args[Number(key)]:kwargs[key];return format?pyFormat(value,format):String(value)}); }
  if(name==='encode')return Buffer.from(obj,(args[0]??'utf8').replaceAll('-',''));if(name==='join')return args[0].join(obj);if(name==='splitlines')return obj.split(/\r?\n/);if(name==='replace')return obj.replaceAll(args[0],args[1]);
  if(obj instanceof RegExp&&['match','search','fullmatch'].includes(name)){const p=name==='fullmatch'?new RegExp('^(?:'+obj.source+')$',obj.flags):obj;return p.exec(args[0])}
  if(typeof obj[name]!=='function')throw Error(`Unsupported native helper ${name}`);return obj[name](...args,...(Object.keys(kwargs).length?[kwargs]:[]));
}

export const pySubtract=(a:any,b:any):any=>a instanceof Set?pySet([...a].filter(x=>!pyContains(b,x))):a-b;
export const pyLessEqual=(a:any,b:any)=>a instanceof Set?[...a].every(x=>pyContains(b,x)):a<=b;
export const pyLess=(a:any,b:any)=>a instanceof Set?a.size<b.size&&pyLessEqual(a,b):a<b;

export const pyCartesian=(a:any[],b:any[])=>a.flatMap(x=>b.map(y=>({...x,...y})));
export async function acquireFixture(t:any,factory:any){const iterator=factory();const first=await iterator.next();t.after(async()=>{await iterator.next()});return first.value;}
export function pyCompare(a:any,b:any,op:string){switch(op){case '<=':return pyLessEqual(a,b);case '<':return pyLess(a,b);case '>=':return pyLessEqual(b,a);case '>':return pyLess(b,a);case '==':return pyEqual(a,b);case '!=':return !pyEqual(a,b);case 'in':return pyContains(b,a);case 'not in':return !pyContains(b,a);case 'is':return a===b;case 'is not':return a!==b;default:throw Error('Unsupported comparison '+op)}}

export function pyZip(...rows:any[]){const options=!Array.isArray(rows.at(-1))?rows.pop():{};if(options.strict&&rows.some(row=>row.length!==rows[0].length))throw Error('zip lengths differ');return Array.from({length:Math.min(...rows.map(x=>x.length))},(_,i)=>rows.map(x=>x[i]))}
export function pyMin(...args:any[]){const rows=args.length===1?pyIterable(args[0]):args;return rows.reduce((a,b)=>a<b?a:b)}
export function pyMax(...args:any[]){const rows=args.length===1?pyIterable(args[0]):args;return rows.reduce((a,b)=>a>b?a:b)}

export function pyJson(value:any,options:any={}){let text=JSON.stringify(value,null,options.indent);if(!options.indent&&!options.separators){let out='',inside=false,escaped=false;for(const char of text){out+=char;if(inside){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inside=false;}else if(char==='"')inside=true;else if(char===','||char===':')out+=' ';}text=out;}if(options.ensure_ascii!==false)text=text.replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));return text;}
export async function pin_contact_impression(client:any,campaign=CAMPAIGN){await client.ok('mods.install',{path:join(ROOT,'tests/extension/fixtures/natural-npc-1.4.4')});await client.ok('mods.configure',{campaign,id:'natural-npc',version:'1.4.4'});}

import * as moduleSupport from './module-support.ts';
import {confirmedInvestigator} from './setup-support.ts';
export const bind=(k:any,root?:any)=>moduleSupport.bind(k,root?String(root):undefined);
export const indexed=(k:any,root?:any)=>moduleSupport.indexed(k,root?String(root):undefined);
export const opening=moduleSupport.opening,finish=moduleSupport.finish,request=moduleSupport.request,claim=moduleSupport.claim,observed=moduleSupport.observed;
export const write=(path:any,value:any)=>moduleSupport.write(String(path),value);
export const confirmed_investigator=(k:any,options:any={})=>confirmedInvestigator(k,typeof options==='object'?options.campaign:options,typeof options==='object'?options.name:undefined);

/** Bridge retired test API names to the current production graph and ledger fold. */
import {importSource} from './support.ts';
const mapView=(map:Map<string,any>)=>new Proxy({}, {get:(_target,key)=>map.get(String(key)),set:(_target,key,value)=>{map.set(String(key),value);return true},ownKeys:()=>[...map.keys()],getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
export async function ModuleGraph(moduleId:string,path:any){
 const api=await importSource('kernel-ts/read/module-graph.ts');
 const raw=read_json(path),dossier=read_json(join(CONTENT_ROOT,'modules/module-graph-contract-v3.json')).actor_dossier;
 const graph=new api.ModuleGraph(moduleId,raw,createHash('sha256').update(JSON.stringify(raw)).digest('hex'),dossier);
 return new Proxy(graph,{get(target,key){if(key==='__native')return target;if(key==='nodes')return mapView(target.nodes);if(key==='out_rel')return mapView(target.out);if(key==='claims_by_subject')return mapView(target.claimsBySubject);const camel=String(key).replace(/_([a-z])/g,(_m,c)=>c.toUpperCase());const value=target[camel];if(typeof value==='function'){const fn=value.bind(target);if(key==='npc_ties')fn.__doc__='Graph relations';return fn;}return value;}});
}
export const RuleTables=(directory:any)=>({directory:String(directory),context:{content:dirname(dirname(dirname(String(directory)))),snapshots:{readJson:async(path:string)=>read_json(path)}}});
export async function StanceTable(tables:any){
 const api=await importSource('kernel-ts/write/contributions.ts');
 const context=tables.context??{content:CONTENT_ROOT,snapshots:{readJson:async()=>tables.load('npc-attitude')}};
 const table=await api.stanceTable(context);
 const graphApi=await importSource('kernel-ts/read/module-graph.ts');
 const raw=read_json(join(CONTENT_ROOT,'starters/the-haunting/module-graph.json'));
 const graph=new graphApi.ModuleGraph('the-haunting',raw,'test-digest',read_json(join(CONTENT_ROOT,'modules/module-graph-contract-v3.json')).actor_dossier);
 function fold(score:number,receipt:Row,extra:Row={}){const ledger:any={'npc-steven-knott':{...api.emptyLedgerEntry(),stance:{score,value:'neutral'}}};api.foldNpcTurn(ledger,graph,{turn:1,receipts:[receipt]}, {...table,...extra});return ledger['npc-steven-knott'].stance;}
 const probe=(score:number)=>fold(score-1,{kind:'roll',npc:'steven-knott',family:'social',approach:'native_test_probe',level:'regular'}, {social:{...table.social,native_test_probe:{regular:1}}});
 return {words:table.levels.map((x:Row)=>x.value),word:(score:number)=>probe(score).value,clamp:(score:number)=>probe(score).score,
 delta:(approach:string,level:string)=>fold(0,{kind:'roll',npc:'steven-knott',family:'social',approach,level}).score,
 floor_of:(word:string)=>fold(0,{kind:'npc',npc:'steven-knott',stance:word}).score};
}

export async function ModuleStore(workspace:any){const contextApi=await importSource('kernel-ts/context.ts');const context=await contextApi.createKernelContext({workspace:String(workspace),content:CONTENT_ROOT});const api=await importSource('kernel-ts/modules/store.ts');const store=new api.ModuleStore(context);return {graph_path:(id:string)=>store.graphPath(id)}}
export async function check_draft(draft:any,packet:any){const api=await importSource('kernel-ts/modules/visual.ts'),contracts=await importSource('kernel-ts/modules/contract.ts');const context={content:CONTENT_ROOT,snapshots:{readJson:async(path:string)=>read_json(path),pathExists:async(path:string)=>existsSync(path)}};return api.checkDraft(draft,packet,await contracts.loadModuleContract(context));}
export async function where_section(graph:any,world:any,scene:any,options:any={}){const api=await importSource('kernel-ts/read/capsule.ts');return api.whereSection(graph.__native,world,scene,options.material_of)}
export async function npc_entry(graph:any,world:any,node:any,ledger:any,memories:any){const api=await importSource('kernel-ts/read/capsule.ts');return api.npcEntry(graph.__native,world,node,ledger,new Map(Object.entries(memories)))}
export async function npc_view(graph:any,world:any,node:any){const api=await importSource('kernel-ts/read/capsule.ts');return api.npcView(graph.__native,world,node)}

export function pyObjectFromEntries(rows:any[][]):any{return rows.some(([key])=>typeof key==='object'&&key!==null)?new Map(rows as [any,any][]):Object.fromEntries(rows);}
