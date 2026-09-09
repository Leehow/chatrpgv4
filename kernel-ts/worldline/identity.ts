/** Closed worldline identity and authored loop declarations. */
import {RpcError} from '../errors.js';
import {sha256Text,compareUnicode} from '../json.js';
import {array,row,string,number,normalize,sorted,type Row} from '../read/values.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {nowIso} from '../write/store.js';
export {activeName,remembersAcrossLoops} from '../read/worldline.js';
export const registry=(meta:Row):Row=>row(meta.worldlines);
export const lineSeed=(campaign:string,name:string,commit:string|null)=>sha256Text(`${campaign}:${name}:${commit||''}`).slice(0,16);
export function newLine(campaign:string,name:string,kind:string,loop:number,forked:Row|null,options:Row={}):Row{
    return {name,kind,loop,forked_from:forked,seed:lineSeed(campaign,name,forked?.commit),status:options.status??'active',last_turn:options.last_turn??null,last_commit:options.last_commit??null,created_at:nowIso(),...(options.parents!=null?{parents:options.parents}:{})};
}
export function validateName(value:any,what:string):string{
    if(typeof value!=='string'||!(/^[a-z0-9][a-z0-9-]{0,39}$/).test(value.trim()))throw new RpcError('invalid_params',`${what} must be a short kebab name`,{fix:"lowercase letters, digits and '-', at most 40 characters, e.g. loop-2",details:{[what]:value??null}});return value.trim();
}
export const resetPolicy=(relation:Row|null):Row=>{const declared=row(row(relation?.properties).reset),policy:Row={clock:'anchor',investigators:'anchor'};for(const facet of ['clock','investigators'])if(['anchor','keep'].includes(declared[facet]))policy[facet]=declared[facet];return policy;};
function here(graph:ModuleGraph,scene:Row,id:string):boolean{return id===scene.node_id||[...graph.out.get(scene.node_id)||[],...graph.incoming.get(scene.node_id)||[]].some(rel=>['contains','occurs-at','present-in','located-in','discoverable-at'].includes(rel.relation_kind)&&[rel.from_node_id,rel.to_node_id].includes(id));}
export function loopAnchor(graph:ModuleGraph,scene:Row|null):[Row,Row]|null{
    const relations=array(graph.raw.relations).filter(rel=>rel.relation_kind==='resets-to').sort((a,b)=>compareUnicode(string(a.from_node_id),string(b.from_node_id))||compareUnicode(string(a.to_node_id),string(b.to_node_id)));
    const chosen=(scene?relations.find(rel=>here(graph,scene,string(rel.from_node_id))):null)||relations[0],anchor=chosen?graph.nodes.get(string(chosen.to_node_id)):null;
    return chosen&&anchor?[chosen,anchor]:null;
}
export function persistedNodes(graph:ModuleGraph):Row[]{return sorted(new Set(array(graph.raw.relations).filter(rel=>rel.relation_kind==='persists-across-loop').map(rel=>string(rel.from_node_id)))).filter(id=>graph.nodes.has(id)).map(id=>graph.nodes.get(id)!);}
export const persistedHandles=(graph:ModuleGraph)=>new Set(persistedNodes(graph).map(node=>graph.handle(node)));
export const persistedKeys=(graph:ModuleGraph)=>new Set(persistedNodes(graph).flatMap(node=>[normalize(graph.handle(node)),normalize(graph.displayName(node))]));
