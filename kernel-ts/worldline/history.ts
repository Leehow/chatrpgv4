/** Worldline history through the single captured campaign Git capability. */
import {lstat,mkdir,writeFile,unlink} from 'node:fs/promises';
import {dirname,join,relative} from 'node:path';
import type {KernelContext} from '../context.js';
import type {CampaignWritePort} from '../transactions.js';
import {checked,commit} from '../write/history.js';
import {sorted} from '../read/values.js';
export interface WorldlineContext {kernel:KernelContext;campaign:CampaignWritePort}
export const SAVE_KEEP=['save/worldlines','save/continuation','save/house-rules.json'];
export const within=(path:string,prefixes:readonly string[])=>prefixes.some(prefix=>path===prefix||path.startsWith(prefix.replace(/\/$/,'')+'/'));
export const run=(context:WorldlineContext,args:string[])=>context.kernel.git.run(context.campaign.id,args);
export async function head(context:WorldlineContext):Promise<string|null>{const result=await run(context,['rev-parse','--short','HEAD']);return result.code===0?result.stdout.trim():null;}
export async function lineCommit(context:WorldlineContext,line:string):Promise<string|null>{const result=await run(context,['rev-parse','--short','--verify',`wl/${line}^{commit}`]);return result.code===0?result.stdout.trim():null;}
export async function currentLine(context:WorldlineContext):Promise<string|null>{const result=await run(context,['symbolic-ref','--quiet','HEAD']);return result.code===0&&result.stdout.trim().startsWith('refs/heads/wl/')?result.stdout.trim().slice(14):null;}
export async function checkout(context:WorldlineContext,line:string,force=false):Promise<void>{checked(await run(context,['checkout','--quiet',...(force?['--force']:[]),`wl/${line}`]),'checkout');}
export async function createBranch(context:WorldlineContext,line:string,sha:string):Promise<void>{checked(await run(context,['branch',`wl/${line}`,sha]),'branch');}
/** Rollback only: callers use this solely for the branch their failed transition created. */
export async function deleteBranch(context:WorldlineContext,line:string):Promise<void>{await run(context,['branch','-D',`wl/${line}`]);}
export async function abortMerge(context:WorldlineContext):Promise<void>{await run(context,['merge','--abort']);}
export async function mergeParents(context:WorldlineContext,lines:string[]):Promise<boolean>{
    if(!lines.length)return false;
    checked(await run(context,['merge','-s','ours','--no-commit','--no-ff',...lines.map(line=>`wl/${line}`)]),'merge');
    return context.kernel.snapshots.pathExists(join(context.kernel.stateRoot,'repos',`${context.campaign.id}.git`,'MERGE_HEAD'));
}
export async function commitIfDirty(context:WorldlineContext,message:string):Promise<string|null>{const state=checked(await run(context,['status','--porcelain']),'status');return state.stdout.trim()?commit(context.kernel,context.campaign.id,message):null;}
export async function blob(context:WorldlineContext,rev:string,path:string):Promise<string|null>{const result=await run(context,['show',`${rev}:${path}`]);return result.code===0?result.stdout:null;}
export async function tree(context:WorldlineContext,rev:string,prefix:string,recursive=false):Promise<string[]>{const result=await run(context,['ls-tree','--name-only',...(recursive?['-r']:[]),rev,prefix]);return result.code===0?sorted(result.stdout.trim().split(/\s+/).filter(Boolean)):[];}
export async function diskFiles(context:WorldlineContext,prefix:string):Promise<string[]>{
    const result:string[]=[];const visit=async(path:string)=>{for(const name of await context.kernel.snapshots.sortedChildNames(path,()=>Promise.resolve(true))){const full=join(path,name);if((await lstat(full)).isDirectory())await visit(full);else if(await context.kernel.snapshots.isFile(full))result.push(relative(context.campaign.directory,full).split('\\').join('/'));}};
    if(await context.kernel.snapshots.isDirectory(join(context.campaign.directory,prefix)))await visit(join(context.campaign.directory,prefix));return sorted(result);
}
export async function restoreTree(context:WorldlineContext,rev:string,prefix:string,keep:readonly string[]=[]):Promise<{written:string[];removed:string[]}>{
    const result=await run(context,['ls-tree','-r','--name-only',rev,'--',prefix]);
    const wanted=result.code===0?sorted(result.stdout.trim().split(/\s+/).filter(path=>path&&!within(path,keep))):[],written:string[]=[],removed:string[]=[];
    for(const path of wanted){const data=await blob(context,rev,path);if(data==null)continue;const destination=join(context.campaign.directory,path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,data,'utf8');written.push(path);}
    for(const path of await diskFiles(context,prefix))if(!wanted.includes(path)&&!within(path,keep)){await unlink(join(context.campaign.directory,path));removed.push(path);}
    return {written,removed};
}
