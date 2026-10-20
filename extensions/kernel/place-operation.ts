/** Route the dedicated tool through the existing apply owner before any write gate. */
import type {CocToolName} from './tools.ts';
/** A conflicting read is refused, never upgraded into a world write. */
export function placeModeConflict(params:unknown):boolean {
    if(!params||typeof params!=='object')return false;
    const read=(params as Record<string,unknown>).op==='inspect'||(params as Record<string,unknown>).action==='inspect';
    return read&&['change','to','relation'].some(field=>Object.hasOwn(params,field));
}
export function placeOperation(name:string,params:Record<string,unknown>):{name:CocToolName;params:Record<string,unknown>} {
    if(name==='place'&&params.action==='inspect'){
        const {action,using_skill,...read}=params;return {name:'place',params:{...read,op:'inspect'}};
    }
    if(name==='place'&&typeof params.action==='string'){
        const {using_skill,...change}=params;return {name:'apply',params:{effects:[{...change,kind:'place'}]}};
    }
    if(name==='place'&&params.op==='submit')return {name:'apply',params:{effects:[{...(params.change as Record<string,unknown>),kind:'place'}]}};
    return {name:name as CocToolName,params};
}
