/** Route the dedicated tool through the existing apply owner before any write gate. */
import type {CocToolName} from './tools.ts';
import {KernelError} from './client.ts';
import {LocationTravelBand,NativePlaceParameters} from '../../shared/place-structures.ts';
import {Check} from 'typebox/value';
/** Decode one complete declared array transport; no coercion or action inference. */
export function normalizePlaceArrayArguments(input:unknown):{args:unknown;fields:string[]} {
    if(!input||typeof input!=='object'||Array.isArray(input))return {args:input,fields:[]};
    const params=input as Record<string,unknown>;
    const branch=NativePlaceParameters.anyOf.find(schema=>schema.properties.action.const===params.action);
    if(!branch)return {args:input,fields:[]};
    let args=params;const fields:string[]=[];
    // §250.4: an optional field sent as a blank string says nothing; it is omitted before validation (live el-v2-20261021e
    // T8: via:"", travel_band:"" and relation:"" each refused a plain move).
    const required=new Set<string>(Array.isArray((branch as {required?:unknown}).required)?(branch as {required:string[]}).required:[]);
    for(const field of Object.keys(branch.properties))
        if(!required.has(field)&&typeof params[field]==='string'&&!(params[field] as string).trim()){
            const {[field]:_blank,...rest}=args;args=rest;fields.push(`${field}:blank`);
        }
    // §250.4: a read names its place by `to` the way every write does (live el-v2-20261021e T25: inspect with to, at and
    // need refused as a write); with no write field beside it, `to` is the read's `name`.
    if(params.action==='inspect'&&typeof args.to==='string'&&(args.name===undefined||args.name===args.to)){
        const {to,...rest}=args;
        if(!placeModeConflict(rest)){args={...rest,name:to};fields.push('to:name');}
    }
    for(const [field,schema] of Object.entries(branch.properties)){
        if(schema.type!=='array'||typeof params[field]!=='string')continue;
        let decoded:unknown;
        try{decoded=JSON.parse(params[field]);}catch{continue;}
        if(!Array.isArray(decoded)||!Check(schema,decoded))continue;
        args={...args,[field]:decoded};fields.push(field);
    }
    return {args,fields};
}
/** A conflicting read is refused, never upgraded into a world write. */
export function placeModeConflict(params:unknown):boolean {
    if(!params||typeof params!=='object')return false;
    const read=(params as Record<string,unknown>).op==='inspect'||(params as Record<string,unknown>).action==='inspect';
    return read&&['change','to','via','travel_band','additions','through','state','passable','access','scope','facts','view','people','situations','relations'].some(field=>Object.hasOwn(params,field));
}
/** Known preparation failures only; the message boundary must not classify arbitrary SDK errors. */
export function placeParameterRefusal(args:unknown):KernelError|undefined {
    if(placeModeConflict(args))return new KernelError({code:'invalid_params',message:'inspect is read-only; a move, feature or observe needs that action',
        fix:'Resend with action:"move" (or "observe"/"feature") and the same fields. Nothing executed.',
        details:{reason:'place_mode_conflict',field:'action',transaction_state:'uncommitted'}});
    const params=args as Record<string,unknown>|null;
    const branch=NativePlaceParameters.anyOf.find(schema=>schema.properties.action.const===params?.action);
    if(branch&&params)for(const [field,schema] of Object.entries(branch.properties)){
        if(schema.type==='array'&&typeof params[field]==='string')return new KernelError({code:'invalid_params',
            message:`place ${String(params.action)} requires ${field} to be an array, not a string`,
            fix:`Keep the explicit action and send ${field} as a JSON array, not quoted JSON. Rebuild the array from the intended arguments; do not complete or parse a partial string. Nothing executed; retain successful earlier receipts.`,
            details:{reason:'place_array_required',field,parameter_fields:[`${field}: expected a JSON array, received a string`],transaction_state:'uncommitted'}});
    }

    if(params?.action==='move'&&typeof params.travel_band==='string'&&!LocationTravelBand.enum.includes(params.travel_band))
        return new KernelError({code:'invalid_params',message:'The selected travel_band is not a registered road row',
            fix:'Keep action:"move" and choose one of the supplied travel_band options (travel_minutes may give this journey\'s own time within it). Do not invent a row.',
            details:{reason:'travel_band_unknown',field:'travel_band',options:[...LocationTravelBand.enum],transaction_state:'uncommitted'}});
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
