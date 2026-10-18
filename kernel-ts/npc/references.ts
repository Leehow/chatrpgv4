/** Compact aliases of canonical people, persisted by existing world write owners. */
import type {ModuleGraph} from '../read/module-graph.js';
import {RpcError} from '../errors.js';
import {row,type Row} from '../read/values.js';

export const isNpcReference=(value:unknown):value is string=>typeof value==='string'&&/^npc_[1-9][0-9]*$/.test(value);
function registry(world:Row):{next:number;by_node:Record<string,string>} {
    const saved=world.npc_references;
    if(saved===undefined)return {next:1,by_node:{}};
    const map=row(saved).by_node,refs=Object.values(row(map));
    if(row(saved).version!==1||!map||typeof map!=='object'||Array.isArray(map)
        ||!Number.isSafeInteger(saved.next)||saved.next<1||refs.some(ref=>!isNpcReference(ref))
        ||new Set(refs).size!==refs.length||refs.some(ref=>Number((ref as string).slice(4))>=saved.next))
        throw new RpcError('invalid_params','The persisted NPC reference registry is invalid');
    return {next:saved.next,by_node:map};
}
export function ensureNpcReferences(graph:ModuleGraph,world:Row):boolean {
    const saved=registry(world),by_node={...saved.by_node};let next=saved.next,changed=world.npc_references===undefined;
    const people=[...new Map(graph.kind('npc').map(node=>graph.find(node.node_id,['npc'])??node)
        .filter(node=>graph.isPerson(node)).map(node=>[String(node.node_id),node])).values()];
    people.sort((a,b)=>Number(row(world.npc_presence)[graph.handle(b)]===world.active_scene)
        -Number(row(world.npc_presence)[graph.handle(a)]===world.active_scene)||String(a.node_id).localeCompare(String(b.node_id),'en'));
    for(const node of people)if(!Object.hasOwn(by_node,node.node_id)){
        if(!Number.isSafeInteger(next+1))throw new RpcError('invalid_params','The NPC reference space is exhausted');
        by_node[node.node_id]='npc_'+next++;changed=true;
    }
    if(changed)world.npc_references={version:1,next,by_node};
    return changed;
}
export function npcReference(graph:ModuleGraph,world:Row,node:Row):string|undefined {
    const canonical=graph.find(node.node_id,['npc'])??node;
    return registry(world).by_node[canonical.node_id];
}
export function referencedNpc(graph:ModuleGraph,world:Row,reference:string):Row|null {
    if(!isNpcReference(reference))return null;
    const id=Object.entries(registry(world).by_node).find(([,ref])=>ref===reference)?.[0];
    // A canonical id is never a name query: a new person's alias must not revive a retired id.
    const node=id?graph.nodes.get(graph.survivorId(id)):null;
    if(!node||!graph.isPerson(node))throw new RpcError('unknown_entity','Unknown or retired NPC reference',{details:{reference}});
    return node;
}
