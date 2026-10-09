/** Mod-owned finite advice tables; the kernel validates data, never decides social routines (§208.5). */
import {RpcError} from '../errors.js';
import {parsePythonJson} from '../json.js';
import {array,row,clone,number,numeric,type Row} from './values.js';
export const TEMPORAL_CAPABILITY='context.temporal.v1';
export function temporalItems(manifest:Row,files:ReadonlyMap<string,Uint8Array>):Row[] {
    const path=row(manifest.contributes).temporal_context;
    if(path==null)return [];
    const refuse=(message:string):never=>{throw new RpcError('invalid_params',`${manifest.id}: ${message}`,{details:{field:'contributes.temporal_context'}});};
    if(!array(manifest.requires).includes(TEMPORAL_CAPABILITY)||typeof path!=='string'||!array(manifest.package_files).includes(path)||!files.has(path))refuse('temporal_context requires its capability and a declared package JSON file');
    let data:Row;
    try{data=row(parsePythonJson(new TextDecoder('utf-8',{fatal:true}).decode(files.get(path)!)));}catch{return refuse('temporal_context must be valid JSON');}
    if(data.schema_version!==1||!Array.isArray(data.items)||!data.items.length||data.items.length>32||Object.keys(data).some(key=>!['schema_version','guidance','items'].includes(key)))refuse('temporal_context is schema_version 1 with one to 32 items');
    if(data.guidance!=null&&(typeof data.guidance!=='string'||!array(manifest.package_files).includes(data.guidance)||!data.guidance.endsWith('.md')||!files.has(data.guidance)))refuse('temporal guidance must name a declared Markdown file');
    if(typeof data.guidance==='string')try{new TextDecoder('utf-8',{fatal:true}).decode(files.get(data.guidance)!);}catch{return refuse('temporal guidance must be UTF-8 text');}
    const seen=new Set<string>();
    for(const value of data.items){
        const item=row(value);
        if(Object.keys(item).some(key=>!['id','label','applies_when','not_for','advice'].includes(key))||typeof item.id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(item.id)||seen.has(item.id))refuse('temporal item ids must be distinct semantic slugs with known fields');
        seen.add(item.id);
        for(const [key,limit]of [['label',100],['applies_when',1000],['not_for',1000],['advice',2000]] as const)
            if(typeof item[key]!=='string'||!item[key].trim()||Array.from(item[key]).length>limit)refuse(`temporal item ${item.id}.${key} must be nonempty text of at most ${limit} characters`);
    }
    return clone(data.items);
}
const settingsOf=(mod:Row,world:Row):Row=>row(row(row(row(world.mods).active)[mod.id]).settings);
export function temporalTables(active:Row[],world:Row):Row[] {
    return active.filter(mod=>row(mod.contributes).temporal_context).map(mod=>{
        const data=row(parsePythonJson(new TextDecoder('utf-8',{fatal:true}).decode(mod.files.get(mod.contributes.temporal_context))));
        return {mod:mod.id,version:mod.version,threshold:numeric(settingsOf(mod,world).threshold)?number(settingsOf(mod,world).threshold):0.5,
            ...(typeof data.guidance==='string'?{guidance:new TextDecoder('utf-8',{fatal:true}).decode(mod.files.get(data.guidance))}:{}),items:temporalItems(mod,mod.files)};
    });
}
export function temporalProviders(active:Row[],world:Row):Row|undefined {
    const providers=active.filter(mod=>row(mod.contributes).temporal_context).map(mod=>({mod:mod.id,version:mod.version,
        threshold:numeric(settingsOf(mod,world).threshold)?number(settingsOf(mod,world).threshold):0.5}));
    return providers.length?{providers,authority:'Optional Mod advice, not established facts or player actions'}:undefined;
}
