/** Route the dedicated tool through the existing apply owner before any write gate. */
import type {CocToolName} from './tools.ts';
export function placeOperation(name:string,params:Record<string,unknown>):{name:CocToolName;params:Record<string,unknown>} {
    if(name==='place'&&params.op==='submit')return {name:'apply',params:{effects:[{...(params.change as Record<string,unknown>),kind:'place'}]}};
    return {name:name as CocToolName,params};
}
