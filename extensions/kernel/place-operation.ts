/** Route the dedicated tool through the existing apply owner before any write gate. */
import type {CocToolName} from './tools.ts';
/** A conflicting read is refused, never upgraded into a world write. */
export function placeModeConflict(params:unknown):boolean {
    return !!params&&typeof params==='object'&&(params as Record<string,unknown>).op==='inspect'&&Object.hasOwn(params,'change');
}
export function placeOperation(name:string,params:Record<string,unknown>):{name:CocToolName;params:Record<string,unknown>} {
    if(name==='place'&&params.op==='submit')return {name:'apply',params:{effects:[{...(params.change as Record<string,unknown>),kind:'place'}]}};
    return {name:name as CocToolName,params};
}
