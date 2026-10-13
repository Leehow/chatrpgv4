/** Current production starter registration and graph validation for migrated tests. */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {native,CONTENT_DIR} from './rules-engine-support.ts';
import {Path,pyDict,pyIsInstance as baseInstance,pyMethod as baseMethod} from './npc-support.ts';
import {subprocess,sys} from './rules-play-support.ts';
export {subprocess,sys};
const fsExt=createRequire(import.meta.url)('fs-ext');
const dossier=JSON.parse(readFileSync(join(CONTENT_DIR,'modules/module-graph-contract-v3.json'),'utf8')).actor_dossier,template=JSON.parse(readFileSync(join(CONTENT_DIR,'modules/module-graph-template-v1.json'),'utf8'));
export function ModuleGraph(id:string,path:any){return new native.ModuleGraph(id,JSON.parse(readFileSync(String(path),'utf8')),'migration-fixture',dossier);}
export async function ModuleStore(workspace:any){const locks=native.createAdvisoryLocks((fd:number,op:string)=>new Promise<void>((r,j)=>fsExt.flock(fd,op,(e:any)=>e?j(e):r()))),context=await native.createKernelContext({workspace:String(workspace),content:CONTENT_DIR,locks});return new native.ModuleStore(context);}
export const read_json=(path:any)=>native.parsePythonJson(readFileSync(String(path),'utf8'));
export const compute_graph_content_digest=(graph:any)=>native.jsonDigest(graph);
export const check=(graph:any)=>native.playability(graph,new native.ModuleGraph('mystery-house',graph,'migration-fixture',dossier),template,dossier);
export async function pyMethod(obj:any,name:string,args:any[]=[],kwargs:any={}){if(typeof obj==='string'&&name==='removeprefix')return obj.startsWith(args[0])?obj.slice(args[0].length):obj;if(obj instanceof native.ModuleStore){if(name==='register_starter')return obj.register(args[0]);if(name==='module_dir')return Path(obj.moduleDir(args[0]));if(name==='write_module')return obj.writeModule(args[0]);}if(obj instanceof native.ModuleGraph){const camel=name.replace(/_([a-z])/g,(_m,c)=>c.toUpperCase());return obj[camel](...args);}return baseMethod(obj,name,args,kwargs);}
export const copy={deepcopy:(value:any)=>native.parsePythonJson(native.pythonJsonDumps(value))};
import {isDeepStrictEqual} from 'node:util';
export const pyEqual=(a:any,b:any)=>{const plain=(x:any):any=>x instanceof Set?new Set([...x].map(plain)):x&&typeof x==='object'?JSON.parse(native.pythonJsonDumps(x)):x;return isDeepStrictEqual(plain(a),plain(b));};
export const pyIsInstance=(value:any,type:any)=>type===pyDict&&value instanceof native.PythonFloat?false:baseInstance(value,type);
