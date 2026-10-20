/** Route the dedicated tool through the existing apply owner before any write gate. */
import type {CocToolName} from './tools.ts';
import {KernelError} from './client.ts';
/** A conflicting read is refused, never upgraded into a world write. */
export function placeModeConflict(params:unknown):boolean {
    if(!params||typeof params!=='object')return false;
    const read=(params as Record<string,unknown>).op==='inspect'||(params as Record<string,unknown>).action==='inspect';
    return read&&['change','to','relation'].some(field=>Object.hasOwn(params,field));
}
/** A fixed target-field alias for an already explicit write action, never intent inference. */
export function normalizePlaceTarget(input:unknown):unknown {
    if(!input||typeof input!=='object'||Array.isArray(input))return input;
    const params=input as Record<string,unknown>;
    if(typeof params.action!=='string'||!['move','feature','observe'].includes(params.action)||!Object.hasOwn(params,'name'))return input;
    if(Object.hasOwn(params,'to')&&params.to!==params.name)throw new KernelError({code:'invalid_params',message:'The explicit place action has conflicting name and to targets',fix:'Use one target name for this action, or identical name and to fields. Nothing was executed.'});
    if(typeof params.name!=='string')return input;
    const {name,...rest}=params;return {...rest,to:name};
}
export function placeOperation(name:string,params:Record<string,unknown>):{name:CocToolName;params:Record<string,unknown>} {
    if(name==='place')params=normalizePlaceTarget(params) as Record<string,unknown>;
    if(name==='place'&&params.action==='inspect'){
        const {action,using_skill,...read}=params;return {name:'place',params:{...read,op:'inspect'}};
    }
    if(name==='place'&&typeof params.action==='string'){
        const {using_skill,...change}=params;return {name:'apply',params:{effects:[{...change,kind:'place'}]}};
    }
    if(name==='place'&&params.op==='submit')return {name:'apply',params:{effects:[{...(params.change as Record<string,unknown>),kind:'place'}]}};
    return {name:name as CocToolName,params};
}
