/** Route the dedicated tool through the existing apply owner before any write gate. */
import type {CocToolName} from './tools.ts';
import {KernelError} from './client.ts';
/** A conflicting read is refused, never upgraded into a world write. */
export function placeModeConflict(params:unknown):boolean {
    if(!params||typeof params!=='object')return false;
    const read=(params as Record<string,unknown>).op==='inspect'||(params as Record<string,unknown>).action==='inspect';
    return read&&['change','to','relation','via','travel_band','additions','through','state','passable','access','scope','facts','view','people','situations','relations'].some(field=>Object.hasOwn(params,field));
}
/** Known preparation failures only; the message boundary must not classify arbitrary SDK errors. */
export function placeParameterRefusal(args:unknown):KernelError|undefined {
    if(placeModeConflict(args))return new KernelError({code:'invalid_params',message:'place inspect is read-only and cannot accept change',
        fix:'For a move, explicitly send {action:"move",to,via,additions?}; keep its destination and route. For a read, send {action:"inspect",name?,at?,sense?,need?} without write fields. No op or change wrapper. Nothing executed; retain successful earlier receipts.',
        details:{reason:'place_mode_conflict',field:'action',transaction_state:'uncommitted'}});
    try{normalizePlaceTarget(args);}catch(error){if(error instanceof KernelError)return error;throw error;}
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
