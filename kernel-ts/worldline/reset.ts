/** Authored loop resets and engine-owned clock rebasing. */
import {join} from 'node:path';
import {RpcError,internalError} from '../errors.js';
import {isJsonObject,parsePythonJson} from '../json.js';
import {array,clone,entries,equal,normalize,number,row,string,truth,sorted,type Row} from '../read/values.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {nowIso} from '../write/store.js';
import {blob,tree,diskFiles,restoreTree,within,SAVE_KEEP,type WorldlineContext} from './history.js';
import {persistedHandles,persistedKeys} from './identity.js';
export interface ClockEngine {readonly name:string;readonly paths:readonly string[];rebase(state:Row,delta:number):Row}
export async function records(context:WorldlineContext):Promise<Row[]>{
    const root=join(context.campaign.directory,'turns'),result:Row[]=[];
    for(const name of await context.kernel.snapshots.sortedChildNames(root,path=>context.kernel.snapshots.isFile(path)))if(name.endsWith('.json'))result.push(row(await context.kernel.snapshots.readJson(join(root,name))));
    return result.sort((a,b)=>number(a.turn)-number(b.turn));
}
export async function readAnchor(context:WorldlineContext):Promise<Row|null>{try{const value=await context.campaign.readSave('worldlines/anchor.json');return isJsonObject(value)&&truth(value.world)?value:null;}catch{return null;}}
export async function anchorTurn(context:WorldlineContext,meta:Row,handle:string):Promise<Row|null>{
    if(string(meta.opening_scene||'')===handle){const commit=await context.kernel.git.rootCommit(context.campaign.id);return commit?{turn:0,commit}:null;}
    for(const record of await records(context))if(string(row(row(record.world).scene).name||'')===handle&&truth(record.commit))return {turn:record.turn,commit:string(record.commit)};
    return null;
}
export async function buildAnchor(context:WorldlineContext,scene:string,at:Row,line:string):Promise<Row>{
    const commit=string(at.commit),raw=await blob(context,commit,'world.json');
    if(raw==null)throw new RpcError('commit_failed',`the anchor commit ${commit} has no world.json`,{details:{anchor:scene,turn:at.turn??null}});
    const party:Row={};for(const path of await tree(context,commit,'party/')){const text=await blob(context,commit,path);if(text==null)continue;const sheet=parsePythonJson(text);if(isJsonObject(sheet)&&truth(sheet.id))party[string(sheet.id)]=sheet;}
    return {schema:1,scene,turn:number(at.turn),commit,line,world:parsePythonJson(raw),party,created_at:nowIso()};
}
export function resetWorld(anchor:Row,world:Row,graph:ModuleGraph,policy:Row):Row{
    const reset=clone(anchor.world),handles=persistedHandles(graph),discovered=[...array(reset.discovered_clues)];
    for(const clue of array(world.discovered_clues))if(handles.has(string(clue))&&!discovered.includes(clue))discovered.push(clue);
    reset.discovered_clues=discovered;const flags=clone(row(reset.flags));for(const [name,value] of entries(world.flags))if(handles.has(name))flags[name]=value;reset.flags=flags;
    if(policy.clock==='keep')reset.clock=clone(world.clock||{minutes:0});reset.active_scene=anchor.scene;return reset;
}
function carried(base:any,current:any,keys:Set<string>):any[]{const rows=[...array(base)],held=new Set(rows.filter(isJsonObject).map(value=>normalize(string(value.name||''))));for(const value of array(current).filter(isJsonObject)){const key=normalize(string(value.name||''));if(keys.has(key)&&!held.has(key)){rows.push(clone(value));held.add(key);}}return rows;}
export function resetSheets(anchor:Row,party:Row[],graph:ModuleGraph,policy:Row):Row[]{
    if(policy.investigators==='keep')return party.map(clone);
    const keys=persistedKeys(graph);return party.map(sheet=>{const base=row(anchor.party)[string(sheet.id)];if(!isJsonObject(base))return clone(sheet);const fresh=clone(base);if(keys.size){fresh.equipment=carried(fresh.equipment,sheet.equipment,keys);fresh.weapons=carried(fresh.weapons,sheet.weapons,keys);fresh.conditions=sorted(new Set([...array(fresh.conditions).map(string),...array(sheet.conditions).map(string).filter(value=>keys.has(normalize(value)))]));}return fresh;});
}
export const rewindsKept=(policy:Row)=>policy.investigators==='keep'&&policy.clock!=='keep';
export const clockMinutes=(world:Row)=>number(row(world.clock).minutes);
export async function anchorMinutes(context:WorldlineContext,at:Row):Promise<number>{const raw=await blob(context,string(at.commit),'world.json');return raw==null?0:clockMinutes(row(parsePythonJson(raw)));}
export async function rebaseSaves(context:WorldlineContext,engines:readonly ClockEngine[],delta:number,write:boolean):Promise<Row>{
    const unclaimed:string[]=[],refused:Row={},rebased:string[]=[],unchanged:string[]=[];
    for(const path of (await diskFiles(context,'save')).filter(path=>!within(path,SAVE_KEEP))){
        const engine=[...engines].sort((a,b)=>a.name.localeCompare(b.name)).find(engine=>within(path,engine.paths));
        if(!engine){unclaimed.push(path);continue;}
        let state:any;try{state=await context.kernel.snapshots.readJson(join(context.campaign.directory,path));}catch(error){refused[path]=`unreadable: ${error instanceof Error?error.message:string(error)}`;continue;}
        if(!isJsonObject(state)){refused[path]='not a JSON object';continue;}
        let moved:Row;try{moved=engine.rebase(state,delta);}catch(error){if((error as Error).name!=='ValueError')throw error;refused[path]=(error as Error).message;continue;}
        if(equal(moved,state)){unchanged.push(path);continue;}
        if(write)await context.campaign.writeSave(path.slice(5),moved);rebased.push(path);
    }
    if(unclaimed.length||Object.keys(refused).length){const reasons=[...unclaimed.map(path=>`${path}: no engine declares how its clock moves`),...entries(refused).map(([path,why])=>`${path}: ${why}`)];
        throw new RpcError('not_implemented',"this module's loop keeps the investigators and rewinds the clock, and state under save/ cannot follow the clock back -- "+reasons.join('; '),{fix:'settle or heal that state before the loop rewinds, or have the module declare reset.investigators: anchor (or reset.clock: keep); details.engine_contract is the engine\'s side of it (#78)',details:{clock_delta:delta,unclaimed,refused,engine_contract:'the module under coc.rules that writes the file declares SAVE_PATHS and rebase_clock(state, delta)'}});
    }
    return {rebased,unchanged};
}
export async function writeReset(context:WorldlineContext,graph:ModuleGraph,plan:Row,engines:readonly ClockEngine[]):Promise<void>{
    const anchor=await readAnchor(context);if(!anchor)throw new RpcError('commit_failed','the loop anchor snapshot is missing',{details:{anchor:plan.anchor??null}});
    const policy=isJsonObject(plan.reset)?plan.reset:{clock:'anchor',investigators:'anchor'},world=await context.campaign.readWorld(),party=await context.campaign.party();
    await context.campaign.writeWorld(resetWorld(anchor,world,graph,policy));for(const sheet of resetSheets(anchor,[...party],graph,policy))await context.campaign.writeSheet(sheet);
    if(policy.investigators!=='keep'){if(typeof anchor.commit==='string'&&anchor.commit)await restoreTree(context,anchor.commit,'save',SAVE_KEEP);}
    else if(rewindsKept(policy))await rebaseSaves(context,engines,clockMinutes(anchor.world)-clockMinutes(world),true);
}
